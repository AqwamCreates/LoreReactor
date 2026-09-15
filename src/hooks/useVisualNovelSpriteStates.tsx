// src/hooks/useVisualNovelSpriteStates.ts
import { useRef, useEffect, useState, useCallback } from 'react';
import type { ChatMessage } from '../types';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

export interface VisualNovelSpriteState {
    depth: number;
    screenX: number;
    facingTargetId: string | null;
    scale: number;
    verticalOffset: number;
}

interface VisualNovelMovementEntry {
    messageIndex: number;
    characterId: string;
    previousState: VisualNovelSpriteState;
    newState: VisualNovelSpriteState;
    type: 'move' | 'face' | 'swap' | 'vertical' | 'push' | 'jump';
}

interface UseVisualNovelSpriteStatesOptions {
    chatMessages: ChatMessage[];
    visibleCharacterIds: string[];
    protagonistId: string | undefined;
}

type MovementDirection = 'left' | 'right' | 'closer' | 'away' | 'forward' | 'backward';
type VerticalAction = 'crouch' | 'stand' | 'jump' | 'stretch' | 'sit' | 'lie' | 'lean_forward' | 'lean_back' | 'tower' | 'shrink' | 'sidestep_left' | 'sidestep_right' | 'center' | 'turn_away' | 'hide_behind' | 'group_up';
type InteractionAction = 'push' | 'pull' | 'block' | 'gather';

interface ParsedMovement {
    characterId: string;
    type: 'move' | 'face' | 'vertical' | 'interaction';
    direction?: MovementDirection;
    verticalAction?: VerticalAction;
    interactionAction?: InteractionAction;
    targetCharacterId?: string;
}

function cloneState(state: VisualNovelSpriteState): VisualNovelSpriteState {
    return { ...state };
}

function getDefaultState(): VisualNovelSpriteState {
    return { depth: 0.5, screenX: 50, facingTargetId: null, scale: 1.0, verticalOffset: 0 };
}

function computeScaleFromDepth(depth: number): number {
    return 0.5 + (1 - depth) * 1.0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

// =============================================================================
// MOVEMENT PARSING
// =============================================================================
function parseMovementFromText(text: string, speakerId: string, participantIds: string[]): ParsedMovement[] {
    const movements: ParsedMovement[] = [];
    const lowerText = text.toLowerCase();

    const mentionedChars = participantIds.filter(id => id !== speakerId && id !== AMBIENT_NARRATOR_ID);
    const firstMentioned = mentionedChars.length > 0 ? mentionedChars[0] : undefined;

    // --- VERTICAL ACTIONS ---
    if (/\b(crouches?|kneels?|bows?|ducks?|lowers?\s+(herself|himself|themselves|down)|bends?\s+(her|his|their)\s+knees?)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'crouch' });
    } else if (/\b(stands?\s+up|rises?|straightens?|gets?\s+up|pushes?\s+(herself|himself|themselves)\s+up|unfolds?)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'stand' });
    } else if (/\b(jumps?|leaps?|hops?|bounces?|vaults?)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'jump' });
    } else if (/\b(stretches?|reaches?\s+up|raises?\s+(her|his|their)\s+arms?|extends?\s+upward|stretches?\s+(her|his|their)\s+body)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'stretch' });
    } else if (/\b(sits?\s*(down)?|takes?\s+a\s+seat|settles?\s+down|perches?|plops?\s+down)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'sit' });
    } else if (/\b(lies?\s+down|collapses?|falls?\s*(down|to\s+the\s+(ground|floor))?|slumps?|drops?\s+to\s+the\s+(ground|floor)|crumples?)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'lie' });
    }

    // --- DEPTH/SCALE ACTIONS ---
    if (/\b(leans?\s+(forward|in)|tilts?\s+forward)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'lean_forward' });
    } else if (/\b(leans?\s+back|recoils?|flinches?\s+back|shrinks?\s+back)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'lean_back' });
    } else if (/\b(towers?\s+over|looms?|stands?\s+tall|draws?\s+(herself|himself|themselves)\s+up)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'tower' });
    } else if (/\b(shrinks?|cowers?|hunches?|makes?\s+(herself|himself|themselves)\s+small|curls?\s+up)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'shrink' });
    }

    // --- HORIZONTAL FINE-TUNING ---
    if (/\b(sidesteps?|shuffles?|edges?|slides?\s+sideways)\b/i.test(lowerText)) {
        const dir = /\b(left)\b/i.test(lowerText) ? 'sidestep_left' : 'sidestep_right';
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: dir });
    } else if (/\b(steps?\s+into\s+(the\s+)?center|takes?\s+center\s+stage|moves?\s+to\s+(the\s+)?middle)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'center' });
    } else if (/\b(turns?\s+away|looks?\s+away|faces?\s+away|turns?\s+(her|his|their)\s+back)\b/i.test(lowerText)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'turn_away' });
    }

    // --- RELATIVE MOVEMENT TOWARD/AWAY FROM TARGET ---
    if (firstMentioned) {
        if (/\b(moves?|steps?|walks?|goes?|approaches?|moves?)\s+(closer\s+to|toward|towards|next\s+to|beside)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'closer', targetCharacterId: firstMentioned });
        } else if (/\b(moves?|steps?|backs?|retreats?|moves?)\s+(away\s+from|back\s+from|from)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'away', targetCharacterId: firstMentioned });
        } else if (/\b(hides?\s+behind|ducks?\s+behind|takes?\s+cover\s+behind)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'hide_behind', targetCharacterId: firstMentioned });
        }

        // --- MULTI-CHARACTER INTERACTIONS ---
        if (/\b(pushes?|shoves?|nudges?|bumps?\s+into)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'push', targetCharacterId: firstMentioned });
        } else if (/\b(pulls?|drags?|grabs?\s+and\s+pulls?|tugs?)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'pull', targetCharacterId: firstMentioned });
        } else if (/\b(blocks?|stands?\s+between|intercepts?|steps?\s+in\s+front\s+of)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'block', targetCharacterId: firstMentioned });
        } else if (/\b(gathers?|groups?\s+up|huddles?|clusters?\s+together)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'gather', targetCharacterId: firstMentioned });
        }

        // --- FACING ---
        if (/\b(faces?|looks?\s+at|turns?\s+toward|turns?\s+to|stares?\s+at|glances?\s+at|watches?|eyes?)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'face', targetCharacterId: firstMentioned });
        }
    }

    // --- ABSOLUTE LEFT/RIGHT (fallback if no other movement detected) ---
    if (movements.length === 0 || movements.every(m => m.type === 'face')) {
        if (/\b(moves?|steps?|walks?|goes?|shifts?|slides?|drifts?)\s+(to\s+the\s+)?right\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'right' });
        } else if (/\b(moves?|steps?|walks?|goes?|shifts?|slides?|drifts?)\s+(to\s+the\s+)?left\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'left' });
        } else if (/\b(steps?\s+forward|advances?|moves?\s+forward|closes?\s+the\s+distance)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'forward' });
        } else if (/\b(steps?\s+back|retreats?|backs?\s+away|creates?\s+distance)\b/i.test(lowerText)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'backward' });
        }
    }

    return movements;
}

// =============================================================================
// MOVEMENT APPLICATION
// =============================================================================
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

    // --- FACE ---
    if (movement.type === 'face' && movement.targetCharacterId) {
        const updatedState = cloneState(charState);
        updatedState.facingTargetId = movement.targetCharacterId;
        newState.set(movement.characterId, updatedState);
        entries.push({ messageIndex: -1, characterId: movement.characterId, previousState: previousCharState, newState: cloneState(updatedState), type: 'face' });
        return { newState, entries };
    }

    // --- VERTICAL ACTIONS ---
    if (movement.type === 'vertical' && movement.verticalAction) {
        const updatedState = cloneState(charState);

        switch (movement.verticalAction) {
            case 'crouch':
                updatedState.verticalOffset = clamp(updatedState.verticalOffset + 25, 0, 60);
                break;
            case 'stand':
                updatedState.verticalOffset = clamp(updatedState.verticalOffset - 30, 0, 60);
                break;
            case 'jump':
                // Jump is handled via CSS animation class, state stays same
                // The view will detect this entry type and apply animation
                break;
            case 'stretch':
                updatedState.verticalOffset = clamp(updatedState.verticalOffset - 8, -15, 60);
                updatedState.scale = clamp(updatedState.scale + 0.05, 0.4, 2.5);
                break;
            case 'sit':
                updatedState.verticalOffset = clamp(updatedState.verticalOffset + 40, 0, 60);
                break;
            case 'lie':
                updatedState.verticalOffset = 55;
                updatedState.scale = clamp(updatedState.scale * 0.7, 0.3, 2.5);
                break;
            case 'lean_forward':
                updatedState.depth = clamp(updatedState.depth - 0.08, 0, 1);
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                break;
            case 'lean_back':
                updatedState.depth = clamp(updatedState.depth + 0.08, 0, 1);
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                break;
            case 'tower':
                updatedState.depth = clamp(updatedState.depth - 0.15, 0, 1);
                updatedState.scale = computeScaleFromDepth(updatedState.depth) + 0.1;
                break;
            case 'shrink':
                updatedState.depth = clamp(updatedState.depth + 0.15, 0, 1);
                updatedState.scale = computeScaleFromDepth(updatedState.depth) - 0.1;
                updatedState.scale = clamp(updatedState.scale, 0.3, 2.5);
                break;
            case 'sidestep_left':
                updatedState.screenX = clamp(updatedState.screenX - 8, 5, 95);
                break;
            case 'sidestep_right':
                updatedState.screenX = clamp(updatedState.screenX + 8, 5, 95);
                break;
            case 'center':
                updatedState.screenX = 50;
                break;
            case 'turn_away':
                updatedState.facingTargetId = null;
                break;
            case 'hide_behind':
                if (movement.targetCharacterId) {
                    const targetState = newState.get(movement.targetCharacterId);
                    if (targetState) {
                        updatedState.depth = targetState.depth + 0.05;
                        updatedState.screenX = targetState.screenX + 3;
                        updatedState.scale = computeScaleFromDepth(updatedState.depth);
                    }
                }
                break;
        }

        newState.set(movement.characterId, updatedState);
        entries.push({ messageIndex: -1, characterId: movement.characterId, previousState: previousCharState, newState: cloneState(updatedState), type: 'vertical' });
        return { newState, entries };
    }

    // --- MULTI-CHARACTER INTERACTIONS ---
    if (movement.type === 'interaction' && movement.interactionAction && movement.targetCharacterId) {
        const targetState = newState.get(movement.targetCharacterId);
        if (!targetState) return { newState, entries };

        const updatedState = cloneState(charState);
        const previousTargetState = cloneState(targetState);

        switch (movement.interactionAction) {
            case 'push': {
                const pushDir = updatedState.screenX < targetState.screenX ? 1 : -1;
                const pushedTarget = cloneState(targetState);
                pushedTarget.screenX = clamp(pushedTarget.screenX + pushDir * 15, 5, 95);
                pushedTarget.depth = clamp(pushedTarget.depth + 0.1, 0, 1);
                pushedTarget.scale = computeScaleFromDepth(pushedTarget.depth);
                newState.set(movement.targetCharacterId, pushedTarget);
                entries.push({ messageIndex: -1, characterId: movement.targetCharacterId, previousState: previousTargetState, newState: cloneState(pushedTarget), type: 'push' });
                break;
            }
            case 'pull': {
                const pulledTarget = cloneState(targetState);
                pulledTarget.screenX = pulledTarget.screenX + (updatedState.screenX - pulledTarget.screenX) * 0.4;
                pulledTarget.depth = pulledTarget.depth + (updatedState.depth - pulledTarget.depth) * 0.4;
                pulledTarget.scale = computeScaleFromDepth(pulledTarget.depth);
                newState.set(movement.targetCharacterId, pulledTarget);
                entries.push({ messageIndex: -1, characterId: movement.targetCharacterId, previousState: previousTargetState, newState: cloneState(pulledTarget), type: 'push' });
                break;
            }
            case 'block': {
                const blockerDepth = (updatedState.depth + targetState.depth) / 2;
                updatedState.depth = blockerDepth;
                updatedState.screenX = (updatedState.screenX + targetState.screenX) / 2;
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                break;
            }
            case 'gather': {
                // Move both characters toward their average position
                const avgDepth = (updatedState.depth + targetState.depth) / 2;
                const avgScreenX = (updatedState.screenX + targetState.screenX) / 2;
                updatedState.depth = updatedState.depth + (avgDepth - updatedState.depth) * 0.5;
                updatedState.screenX = updatedState.screenX + (avgScreenX - updatedState.screenX) * 0.5;
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                const gatheredTarget = cloneState(targetState);
                gatheredTarget.depth = targetState.depth + (avgDepth - targetState.depth) * 0.5;
                gatheredTarget.screenX = targetState.screenX + (avgScreenX - targetState.screenX) * 0.5;
                gatheredTarget.scale = computeScaleFromDepth(gatheredTarget.depth);
                newState.set(movement.targetCharacterId, gatheredTarget);
                entries.push({ messageIndex: -1, characterId: movement.targetCharacterId, previousState: previousTargetState, newState: cloneState(gatheredTarget), type: 'push' });
                break;
            }
        }

        newState.set(movement.characterId, updatedState);
        entries.push({ messageIndex: -1, characterId: movement.characterId, previousState: previousCharState, newState: cloneState(updatedState), type: 'move' });
        return { newState, entries };
    }

    // --- STANDARD MOVEMENT ---
    if (movement.type === 'move') {
        const updatedState = cloneState(charState);

        if (movement.direction === 'left') {
            let effectiveDirection: 'closer' | 'away' = 'away';
            if (updatedState.facingTargetId) {
                const targetState = newState.get(updatedState.facingTargetId);
                if (targetState && targetState.screenX < updatedState.screenX) effectiveDirection = 'closer';
            }
            if (effectiveDirection === 'closer') {
                updatedState.depth = clamp(updatedState.depth - 0.15, 0, 1);
            } else {
                updatedState.depth = clamp(updatedState.depth + 0.15, 0, 1);
            }
            updatedState.screenX = clamp(updatedState.screenX - 15, 5, 95);
        } else if (movement.direction === 'right') {
            let effectiveDirection: 'closer' | 'away' = 'away';
            if (updatedState.facingTargetId) {
                const targetState = newState.get(updatedState.facingTargetId);
                if (targetState && targetState.screenX > updatedState.screenX) effectiveDirection = 'closer';
            }
            if (effectiveDirection === 'closer') {
                updatedState.depth = clamp(updatedState.depth - 0.15, 0, 1);
            } else {
                updatedState.depth = clamp(updatedState.depth + 0.15, 0, 1);
            }
            updatedState.screenX = clamp(updatedState.screenX + 15, 5, 95);
        } else if (movement.direction === 'forward') {
            updatedState.depth = clamp(updatedState.depth - 0.15, 0, 1);
            updatedState.screenX = clamp(updatedState.screenX + (50 - updatedState.screenX) * 0.2, 5, 95);
        } else if (movement.direction === 'backward') {
            updatedState.depth = clamp(updatedState.depth + 0.15, 0, 1);
        } else if (movement.direction === 'closer' && movement.targetCharacterId) {
            const targetState = newState.get(movement.targetCharacterId);
            if (targetState) {
                const moverDepth = updatedState.depth;
                const targetDepth = targetState.depth;
                const minDepth = Math.min(moverDepth, targetDepth);
                const maxDepth = Math.max(moverDepth, targetDepth);

                for (const otherId of allCharacterIds) {
                    if (otherId === movement.characterId || otherId === movement.targetCharacterId) continue;
                    const otherState = newState.get(otherId);
                    if (!otherState) continue;
                    if (otherState.depth > minDepth && otherState.depth < maxDepth) {
                        const previousOtherState = cloneState(otherState);
                        const swappedOther = cloneState(otherState);
                        if (moverDepth < targetDepth) {
                            swappedOther.depth = clamp(targetDepth + 0.2, 0, 1);
                        } else {
                            swappedOther.depth = clamp(targetDepth - 0.2, 0, 1);
                        }
                        swappedOther.scale = computeScaleFromDepth(swappedOther.depth);
                        newState.set(otherId, swappedOther);
                        entries.push({ messageIndex: -1, characterId: otherId, previousState: previousOtherState, newState: cloneState(swappedOther), type: 'swap' });
                    }
                }

                const stepSize = (targetDepth - moverDepth) * 0.4;
                updatedState.depth = moverDepth + stepSize;
                updatedState.screenX = updatedState.screenX + (targetState.screenX - updatedState.screenX) * 0.4;
            }
        } else if (movement.direction === 'away' && movement.targetCharacterId) {
            const targetState = newState.get(movement.targetCharacterId);
            if (targetState) {
                const awayDir = updatedState.depth > targetState.depth ? 1 : -1;
                updatedState.depth = clamp(updatedState.depth + awayDir * 0.15, 0, 1);
                updatedState.screenX = clamp(updatedState.screenX + (updatedState.screenX > targetState.screenX ? 10 : -10), 5, 95);
            }
        }

        updatedState.scale = computeScaleFromDepth(updatedState.depth);
        newState.set(movement.characterId, updatedState);
        entries.push({ messageIndex: -1, characterId: movement.characterId, previousState: previousCharState, newState: cloneState(updatedState), type: 'move' });
    }

    return { newState, entries };
}

// =============================================================================
// HOOK
// =============================================================================
export function useVisualNovelSpriteStates(options: UseVisualNovelSpriteStatesOptions) {
    const { chatMessages, visibleCharacterIds } = options;

    const [spriteStates, setSpriteStates] = useState<Map<string, VisualNovelSpriteState>>(new Map());
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [jumpingCharacterIds, setJumpingCharacterIds] = useState<Set<string>>(new Set());

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
            statesRef.current = new Map();
            movementHistoryRef.current = [];
            for (const characterId of visibleCharacterIds) {
                statesRef.current.set(characterId, getDefaultState());
            }
            lastParsedIndexRef.current = 0;
        }

        const participantIds = visibleCharacterIds;
        let currentStates = statesRef.current;
        const newJumpingIds = new Set<string>();

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
                    if (entry.type === 'jump') {
                        newJumpingIds.add(entry.characterId);
                    }
                }
                // Check if the movement itself was a jump
                if (movement.type === 'vertical' && movement.verticalAction === 'jump') {
                    newJumpingIds.add(movement.characterId);
                }
            }
        }

        lastParsedIndexRef.current = chatMessages.length;
        statesRef.current = currentStates;
        setSpriteStates(new Map(currentStates));

        if (newJumpingIds.size > 0 && !isFullReload) {
            setJumpingCharacterIds(newJumpingIds);
            // Clear jump animation flag after animation completes
            setTimeout(() => {
                setJumpingCharacterIds(new Set());
            }, 600);
        }

        if (isFullReload) {
            requestAnimationFrame(() => {
                setIsInitialLoad(false);
            });
        } else {
            setIsInitialLoad(false);
        }
    }, [chatMessages, visibleCharacterIds]);

    // Reset on session change
    useEffect(() => {
        setIsInitialLoad(true);
        lastParsedIndexRef.current = -1;
        movementHistoryRef.current = [];
        setJumpingCharacterIds(new Set());
    }, [visibleCharacterIds]);

    const rollbackToMessage = useCallback((messageIndex: number) => {
        const history = movementHistoryRef.current;
        const entriesToRevert: VisualNovelMovementEntry[] = [];

        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].messageIndex >= messageIndex) {
                entriesToRevert.push(history[i]);
            }
        }

        const currentStates = new Map(statesRef.current);
        for (const entry of entriesToRevert) {
            currentStates.set(entry.characterId, cloneState(entry.previousState));
        }

        movementHistoryRef.current = history.filter(e => e.messageIndex < messageIndex);
        statesRef.current = currentStates;
        lastParsedIndexRef.current = messageIndex;
        setSpriteStates(new Map(currentStates));
        setJumpingCharacterIds(new Set());
    }, []);

    return {
        spriteStates,
        rollbackToMessage,
        isInitialLoad,
        jumpingCharacterIds,
    };
}