// src/hooks/useVisualNovelSpriteStates.ts
import { useRef, useEffect, useState, useCallback } from 'react';
import type { ChatMessage } from '../types';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

export interface VisualNovelSpriteState {
    depth: number;
    screenX: number;
    facingTargetId: string | null;
    scale: number;
}

interface VisualNovelMovementEntry {
    messageIndex: number;
    characterId: string;
    previousState: VisualNovelSpriteState;
    newState: VisualNovelSpriteState;
    type: 'move' | 'face' | 'swap';
}

interface UseVisualNovelSpriteStatesOptions {
    chatMessages: ChatMessage[];
    visibleCharacterIds: string[];
    protagonistId: string | undefined;
}

interface ParsedMovement {
    characterId: string;
    type: 'move' | 'face' | 'swap';
    direction?: 'left' | 'right' | 'closer' | 'away';
    targetCharacterId?: string;
}

function cloneState(state: VisualNovelSpriteState): VisualNovelSpriteState {
    return { ...state };
}

function getDefaultState(): VisualNovelSpriteState {
    return { depth: 0.5, screenX: 50, facingTargetId: null, scale: 1.0 };
}

function computeScaleFromDepth(depth: number): number {
    return 0.5 + (1 - depth) * 1.0;
}

function parseMovementFromText(text: string, speakerId: string, participantIds: string[]): ParsedMovement[] {
    const movements: ParsedMovement[] = [];
    const lowerText = text.toLowerCase();

    // Find mentioned characters (excluding speaker and ambient narrator)
    const mentionedChars = participantIds.filter(id => id !== speakerId && id !== AMBIENT_NARRATOR_ID);

    // Movement toward/away from another character
    for (const targetId of mentionedChars) {
        const targetNamePattern = targetId; // In real usage, match by name from participant data
        // For now, we parse directional keywords relative to speaker

        if (/\b(moves?|steps?|walks?|goes?|moves?)\s+(closer\s+to|toward|towards|approaches?|next\s+to|beside)\b/i.test(lowerText)) {
            // Find which character is being approached
            // Simple heuristic: first mentioned character that isn't the speaker
            if (mentionedChars.length > 0) {
                movements.push({ characterId: speakerId, type: 'move', direction: 'closer', targetCharacterId: mentionedChars[0] });
            }
        }

        if (/\b(moves?|steps?|backs?|retreats?|moves?)\s+(away\s+from|back\s+from|from)\b/i.test(lowerText)) {
            if (mentionedChars.length > 0) {
                movements.push({ characterId: speakerId, type: 'move', direction: 'away', targetCharacterId: mentionedChars[0] });
            }
        }

        // Facing / looking at
        if (/\b(faces?|looks?\s+at|turns?\s+toward|turns?\s+to|stares?\s+at|glances?\s+at|watches?)\b/i.test(lowerText)) {
            if (mentionedChars.length > 0) {
                movements.push({ characterId: speakerId, type: 'face', targetCharacterId: mentionedChars[0] });
            }
        }
    }

    // Absolute left/right movement (no target character needed)
    if (movements.length === 0 || movements.every(m => m.type === 'face')) {
        if (/\b(moves?|steps?|walks?|goes?|shifts?|slides?|drifts?)\s+(to\s+the\s+)?right\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'right' });
        } else if (/\b(moves?|steps?|walks?|goes?|shifts?|slides?|drifts?)\s+(to\s+the\s+)?left\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'left' });
        }
    }

    return movements;
}

function applyMovement(
    currentState: Map<string, VisualNovelSpriteState>,
    movement: ParsedMovement,
    allCharacterIds: string[]
): { newState: Map<string, VisualNovelSpriteState>; entries: VisualNovelMovementEntry[] } {
    const newState = new Map(currentState);
    const entries: VisualNovelMovementEntry[] = [];

    const charState = newState.get(movement.characterId);
    if (!charState) return { newState, entries };

    const previousCharState = cloneState(charState);

    if (movement.type === 'face' && movement.targetCharacterId) {
        const updatedState = cloneState(charState);
        updatedState.facingTargetId = movement.targetCharacterId;
        newState.set(movement.characterId, updatedState);
        entries.push({
            messageIndex: -1, // Set by caller
            characterId: movement.characterId,
            previousState: previousCharState,
            newState: cloneState(updatedState),
            type: 'face',
        });
        return { newState, entries };
    }

    if (movement.type === 'move') {
        const updatedState = cloneState(charState);

        if (movement.direction === 'left') {
            // If facing a target to the left, moving left = closer (larger)
            // If facing a target to the right, moving left = away (smaller)
            let effectiveDirection: 'closer' | 'away' = 'away';
            if (updatedState.facingTargetId) {
                const targetState = newState.get(updatedState.facingTargetId);
                if (targetState && targetState.screenX < updatedState.screenX) {
                    effectiveDirection = 'closer';
                }
            }
            if (effectiveDirection === 'closer') {
                updatedState.depth = Math.max(0, updatedState.depth - 0.15);
            } else {
                updatedState.depth = Math.min(1, updatedState.depth + 0.15);
            }
            updatedState.screenX = Math.max(5, updatedState.screenX - 15);
        } else if (movement.direction === 'right') {
            let effectiveDirection: 'closer' | 'away' = 'away';
            if (updatedState.facingTargetId) {
                const targetState = newState.get(updatedState.facingTargetId);
                if (targetState && targetState.screenX > updatedState.screenX) {
                    effectiveDirection = 'closer';
                }
            }
            if (effectiveDirection === 'closer') {
                updatedState.depth = Math.max(0, updatedState.depth - 0.15);
            } else {
                updatedState.depth = Math.min(1, updatedState.depth + 0.15);
            }
            updatedState.screenX = Math.min(95, updatedState.screenX + 15);
        } else if (movement.direction === 'closer' && movement.targetCharacterId) {
            const targetState = newState.get(movement.targetCharacterId);
            if (targetState) {
                // Check for characters between mover and target — swap if needed
                const moverDepth = updatedState.depth;
                const targetDepth = targetState.depth;
                const minDepth = Math.min(moverDepth, targetDepth);
                const maxDepth = Math.max(moverDepth, targetDepth);

                for (const otherId of allCharacterIds) {
                    if (otherId === movement.characterId || otherId === movement.targetCharacterId) continue;
                    const otherState = newState.get(otherId);
                    if (!otherState) continue;
                    if (otherState.depth > minDepth && otherState.depth < maxDepth) {
                        // Swap: move the blocking character out of the way
                        const previousOtherState = cloneState(otherState);
                        const swappedOther = cloneState(otherState);
                        // Move blocker to opposite side of target from mover
                        if (moverDepth < targetDepth) {
                            swappedOther.depth = Math.min(1, targetDepth + 0.2);
                        } else {
                            swappedOther.depth = Math.max(0, targetDepth - 0.2);
                        }
                        swappedOther.scale = computeScaleFromDepth(swappedOther.depth);
                        newState.set(otherId, swappedOther);
                        entries.push({
                            messageIndex: -1,
                            characterId: otherId,
                            previousState: previousOtherState,
                            newState: cloneState(swappedOther),
                            type: 'swap',
                        });
                    }
                }

                // Now move closer
                const stepSize = (targetDepth - moverDepth) * 0.4;
                updatedState.depth = moverDepth + stepSize;
                // Interpolate screenX toward target
                updatedState.screenX = updatedState.screenX + (targetState.screenX - updatedState.screenX) * 0.4;
            }
        } else if (movement.direction === 'away' && movement.targetCharacterId) {
            const targetState = newState.get(movement.targetCharacterId);
            if (targetState) {
                const stepSize = (updatedState.depth - targetState.depth) * 0.3;
                updatedState.depth = Math.min(1, Math.max(0, updatedState.depth + (stepSize > 0 ? 0.15 : -0.15)));
                updatedState.screenX = Math.max(5, Math.min(95, updatedState.screenX + (updatedState.screenX > targetState.screenX ? 10 : -10)));
            }
        }

        updatedState.scale = computeScaleFromDepth(updatedState.depth);
        newState.set(movement.characterId, updatedState);
        entries.push({
            messageIndex: -1,
            characterId: movement.characterId,
            previousState: previousCharState,
            newState: cloneState(updatedState),
            type: 'move',
        });
    }

    return { newState, entries };
}

export function useVisualNovelSpriteStates(options: UseVisualNovelSpriteStatesOptions) {
    const { chatMessages, visibleCharacterIds, protagonistId } = options;

    const [spriteStates, setSpriteStates] = useState<Map<string, VisualNovelSpriteState>>(new Map());
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    const movementHistoryRef = useRef<VisualNovelMovementEntry[]>([]);
    const lastParsedIndexRef = useRef<number>(-1);
    const statesRef = useRef<Map<string, VisualNovelSpriteState>>(new Map());

    // Initialize default states for all visible characters
    useEffect(() => {
        const currentStates = statesRef.current;
        for (const characterId of visibleCharacterIds) {
            if (!currentStates.has(characterId)) {
                currentStates.set(characterId, getDefaultState());
            }
        }
        // Remove states for characters no longer visible
        for (const characterId of currentStates.keys()) {
            if (!visibleCharacterIds.includes(characterId)) {
                currentStates.delete(characterId);
            }
        }
    }, [visibleCharacterIds]);

    // Parse messages and update states
    useEffect(() => {
        if (chatMessages.length === 0) return;

        const isFullReload = lastParsedIndexRef.current >= chatMessages.length || lastParsedIndexRef.current === -1;

        if (isFullReload) {
            // Full reload: reset everything and parse all messages without animation
            statesRef.current = new Map();
            movementHistoryRef.current = [];
            for (const characterId of visibleCharacterIds) {
                statesRef.current.set(characterId, getDefaultState());
            }
            lastParsedIndexRef.current = 0;
        }

        const participantIds = visibleCharacterIds;
        let currentStates = statesRef.current;

        for (let i = lastParsedIndexRef.current; i < chatMessages.length; i++) {
            const message = chatMessages[i];
            if (message.messageType !== 'chat') continue;

            const speakerId = message.character.id;
            if (speakerId === AMBIENT_NARRATOR_ID) continue;
            if (!currentStates.has(speakerId)) continue;

            const movements = parseMovementFromText(message.textContent, speakerId, participantIds);

            for (const movement of movements) {
                const result = applyMovement(currentStates, movement, participantIds);
                currentStates = result.newState;
                for (const entry of result.entries) {
                    entry.messageIndex = i;
                    movementHistoryRef.current.push(entry);
                }
            }
        }

        lastParsedIndexRef.current = chatMessages.length;
        statesRef.current = currentStates;
        setSpriteStates(new Map(currentStates));

        if (isFullReload) {
            // Disable transitions during initial load, enable on next frame
            requestAnimationFrame(() => {
                setIsInitialLoad(false);
            });
        } else {
            setIsInitialLoad(false);
        }
    }, [chatMessages, visibleCharacterIds]);

    // Reset initial load flag when session changes
    useEffect(() => {
        setIsInitialLoad(true);
        lastParsedIndexRef.current = -1;
        movementHistoryRef.current = [];
    }, []);

    const rollbackToMessage = useCallback((messageIndex: number) => {
        const history = movementHistoryRef.current;
        const entriesToRevert: VisualNovelMovementEntry[] = [];

        // Collect entries to revert in reverse order
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].messageIndex >= messageIndex) {
                entriesToRevert.push(history[i]);
            }
        }

        // Apply reverts
        const currentStates = new Map(statesRef.current);
        for (const entry of entriesToRevert) {
            currentStates.set(entry.characterId, cloneState(entry.previousState));
        }

        // Remove reverted entries from history
        movementHistoryRef.current = history.filter(e => e.messageIndex < messageIndex);
        statesRef.current = currentStates;
        lastParsedIndexRef.current = messageIndex;
        setSpriteStates(new Map(currentStates));
    }, []);

    return {
        spriteStates,
        rollbackToMessage,
        isInitialLoad,
    };
}