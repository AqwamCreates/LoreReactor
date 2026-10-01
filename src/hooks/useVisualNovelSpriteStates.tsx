// src/hooks/useVisualNovelSpriteStates.ts
import { useEffect, useState, useCallback, useMemo } from 'react';
import type { ChatMessage } from '../types';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

export type BreathingPattern = 'calm' | 'fast' | 'heavy' | 'subtle' | 'tremble' | 'none';

export interface VisualNovelSpriteState {
    depth: number;
    screenX: number;
    facingTargetId: string | null;
    scale: number;
    verticalOffset: number;
    breathingPattern: BreathingPattern; // <-- Added
}

interface VisualNovelMovementEntry {
    messageId: string;
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
    viewedMessageIndex: number | null;
}

type MovementDirection = 'left' | 'right' | 'closer' | 'away' | 'forward' | 'backward';
type VerticalAction = 
    | 'crouch' | 'stand' | 'jump' | 'stretch' | 'sit' | 'lie' 
    | 'lean_forward' | 'lean_back' | 'tower' | 'shrink' 
    | 'sidestep_left' | 'sidestep_right' | 'center' | 'turn_away' 
    | 'hide_behind' | 'group_up'
    | 'breathe_fast' | 'breathe_heavy' | 'breathe_subtle' | 'breathe_tremble' | 'breathe_none' | 'breathe_calm'; // <-- Added

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

function getDistributedState(index: number, total: number): VisualNovelSpriteState {
    if (total <= 1) {
        return { depth: 0.5, screenX: 50, facingTargetId: null, scale: 1.0, verticalOffset: 0, breathingPattern: 'calm' };
    }
    const min = 15;
    const max = 85;
    const step = (max - min) / (total - 1);
    const screenX = min + step * index;
    const depth = 0.5 + (index % 2 === 0 ? -0.02 : 0.02);
    return {
        depth,
        screenX,
        facingTargetId: null,
        scale: computeScaleFromDepth(depth),
        verticalOffset: 0,
        breathingPattern: 'calm',
    };
}

function computeScaleFromDepth(depth: number): number {
    return 0.5 + (1 - depth) * 1.0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function splitIntoClauses(text: string): string[] {
    const parts = text.split(/\s*(?:;\s*|\.\s+(?=(?:she|he|they|it|i)\s)|\s+then\s+|\s+before\s+|\s+after\s+)/i);
    return parts.map(p => p.trim()).filter(p => p.length > 0);
}

function parseMovementsFromClause(clause: string, speakerId: string, participantIds: string[]): ParsedMovement[] {
    const movements: ParsedMovement[] = [];
    const lowerClause = clause.toLowerCase();

    const mentionedChars = participantIds.filter(id => id !== speakerId && id !== AMBIENT_NARRATOR_ID);
    const firstMentioned = mentionedChars.length > 0 ? mentionedChars[0] : undefined;

    // --- Dynamic Breathing Control Detection ---
    if (/\b(pant|panting|panted|gasp|gasping|gasped|out\s+of\s+breath|short\s+of\s+breath|hyperventilat|breathless)/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_fast' });
    }
    if (/\b(sigh|sighed|sighing|heavy\s+breath|deep\s+breath|breathe\s+deeply|breathed\s+heavily|exhaust|winded)/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_heavy' });
    }
    if (/\b(shiver|shivering|shivered|trembl|shudder|quiver|teeth\s+chatter)/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_tremble' });
    }
    if (/\b(calm|steady\s+breath|slow\s+breath|relax|asleep|sleep|peaceful)/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_subtle' });
    }
    if (/\b(held\s+(her|his|their)\s+breath|hold\s+(her|his|their)\s+breath|freeze|froze|motionless|statue|stopped\s+breathing)/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_none' });
    }

    // --- Standard Actions ---
    if (/\bcrouch|kneel|bow|duck|lower\s+(herself|himself|themselves|down)|bend\s+(her|his|their)\s+knee/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'crouch' });
    }
    if (/\bstand\s+up|rise|straighten|get\s+up|push\s+(herself|himself|themselves)\s+up|unfold/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'stand' });
    }
    if (/\bjump|leap|hop|bounce|vault/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'jump' });
    }
    if (/\bstretch|reach\s+up|raise\s+(her|his|their)\s+arm|extend\s+upward/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'stretch' });
    }
    if (/\bsit|take\s+a\s+seat|settle\s+down|perch|plop\s+down/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'sit' });
    }
    if (/\blie\s+down|collaps|fall|slump|drop\s+to\s+the\s+(ground|floor)|crumple/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'lie' });
    }
    if (/\blean\s+(forward|in)|tilt\s+forward/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'lean_forward' });
    }
    if (/\blean\s+back|recoil|flinch\s+back|shrink\s+back/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'lean_back' });
    }
    if (/\btower|loom|stand\s+tall|draw\s+(herself|himself|themselves)\s+up/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'tower' });
    }
    if (/\bshrink|cower|hunch|make\s+(herself|himself|themselves)\s+small|curl\s+up/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'shrink' });
    }
    if (/\bsidestep|shuffle|edge|slide\s+sideway/i.test(lowerClause)) {
        const dir = /\bleft/i.test(lowerClause) ? 'sidestep_left' : 'sidestep_right';
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: dir });
    }
    if (/\bstep\s+into\s+(the\s+)?center|take\s+center\s+stage|move\s+to\s+(the\s+)?middle/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'center' });
    }
    if (/\bturn\s+away|look\s+away|face\s+away|turn\s+(her|his|their)\s+back/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'turn_away' });
    }

    if (firstMentioned) {
        if (/\b(move|step|walk|go|approach)\s+(closer\s+to|toward|towards|next\s+to|beside)/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'closer', targetCharacterId: firstMentioned });
        }
        if (/\b(move|step|back|retreat)\s+(away\s+from|back\s+from|from)/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'away', targetCharacterId: firstMentioned });
        }
        if (/\bhide\s+behind|duck\s+behind|take\s+cover\s+behind/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'hide_behind', targetCharacterId: firstMentioned });
        }
        if (/\bpush|shove|nudge|bump\s+into/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'push', targetCharacterId: firstMentioned });
        }
        if (/\bpull|drag|grab\s+and\s+pull|tug/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'pull', targetCharacterId: firstMentioned });
        }
        if (/\bblock|stand\s+between|intercept|step\s+in\s+front\s+of/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'block', targetCharacterId: firstMentioned });
        }
        if (/\bgather|group\s+up|huddle|cluster\s+together/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'gather', targetCharacterId: firstMentioned });
        }
        if (/\bface|look\s+at|turn\s+toward|turn\s+to|stare\s+at|glance\s+at|watch|eye/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'face', targetCharacterId: firstMentioned });
        }
    }

    if (/\b(move|step|walk|go|shift|slide|drift)\s+(to\s+the\s+)?right/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'move', direction: 'right' });
    }
    if (/\b(move|step|walk|go|shift|slide|drift)\s+(to\s+the\s+)?left/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'move', direction: 'left' });
    }
    if (/\bstep\s+forward|advance|move\s+forward|close\s+the\s+distance/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'move', direction: 'forward' });
    }
    if (/\bstep\s+back|retreat|back\s+away|create\s+distance/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'move', direction: 'backward' });
    }

    return movements;
}

function parseMovementFromText(text: string, speakerId: string, participantIds: string[]): ParsedMovement[] {
    const allMovements: ParsedMovement[] = [];
    const clauses = splitIntoClauses(text);
    for (const clause of clauses) {
        allMovements.push(...parseMovementsFromClause(clause, speakerId, participantIds));
    }
    return allMovements;
}

function applyMovement(
    currentState: Map<string, VisualNovelSpriteState>,
    movement: ParsedMovement,
    allCharacterIds: string[]
): { newState: Map<string, VisualNovelSpriteState>; entries: Omit<VisualNovelMovementEntry, 'messageId' | 'messageIndex'>[] } {
    const newState = new Map(currentState);
    const entries: Omit<VisualNovelMovementEntry, 'messageId' | 'messageIndex'>[] = [];

    const charState = newState.get(movement.characterId);
    if (!charState) return { newState, entries };

    const previousCharState = cloneState(charState);

    if (movement.type === 'face' && movement.targetCharacterId) {
        const updatedState = cloneState(charState);
        updatedState.facingTargetId = movement.targetCharacterId;
        newState.set(movement.characterId, updatedState);
        entries.push({ characterId: movement.characterId, previousState: previousCharState, newState: cloneState(updatedState), type: 'face' });
        return { newState, entries };
    }

    if (movement.type === 'vertical' && movement.verticalAction) {
        const updatedState = cloneState(charState);

        switch (movement.verticalAction) {
            case 'breathe_fast': updatedState.breathingPattern = 'fast'; break;
            case 'breathe_heavy': updatedState.breathingPattern = 'heavy'; break;
            case 'breathe_subtle': updatedState.breathingPattern = 'subtle'; break;
            case 'breathe_tremble': updatedState.breathingPattern = 'tremble'; break;
            case 'breathe_none': updatedState.breathingPattern = 'none'; break;
            case 'breathe_calm': updatedState.breathingPattern = 'calm'; break;
            case 'crouch': updatedState.verticalOffset = clamp(updatedState.verticalOffset + 25, 0, 60); break;
            case 'stand': updatedState.verticalOffset = clamp(updatedState.verticalOffset - 30, 0, 60); break;
            case 'jump': break;
            case 'stretch':
                updatedState.verticalOffset = clamp(updatedState.verticalOffset - 8, -15, 60);
                updatedState.scale = clamp(updatedState.scale + 0.05, 0.4, 2.5);
                break;
            case 'sit': updatedState.verticalOffset = clamp(updatedState.verticalOffset + 40, 0, 60); break;
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
                updatedState.scale = clamp(computeScaleFromDepth(updatedState.depth) - 0.1, 0.3, 2.5);
                break;
            case 'sidestep_left': updatedState.screenX = clamp(updatedState.screenX - 8, 5, 95); break;
            case 'sidestep_right': updatedState.screenX = clamp(updatedState.screenX + 8, 5, 95); break;
            case 'center': updatedState.screenX = 50; break;
            case 'turn_away': updatedState.facingTargetId = null; break;
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
        entries.push({ characterId: movement.characterId, previousState: previousCharState, newState: cloneState(updatedState), type: 'vertical' });
        return { newState, entries };
    }

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
                entries.push({ characterId: movement.targetCharacterId, previousState: previousTargetState, newState: cloneState(pushedTarget), type: 'push' });
                break;
            }
            case 'pull': {
                const pulledTarget = cloneState(targetState);
                pulledTarget.screenX = pulledTarget.screenX + (updatedState.screenX - pulledTarget.screenX) * 0.4;
                pulledTarget.depth = pulledTarget.depth + (updatedState.depth - pulledTarget.depth) * 0.4;
                pulledTarget.scale = computeScaleFromDepth(pulledTarget.depth);
                newState.set(movement.targetCharacterId, pulledTarget);
                entries.push({ characterId: movement.targetCharacterId, previousState: previousTargetState, newState: cloneState(pulledTarget), type: 'push' });
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
                entries.push({ characterId: movement.targetCharacterId, previousState: previousTargetState, newState: cloneState(gatheredTarget), type: 'push' });
                break;
            }
        }

        newState.set(movement.characterId, updatedState);
        entries.push({ characterId: movement.characterId, previousState: previousCharState, newState: cloneState(updatedState), type: 'move' });
        return { newState, entries };
    }

    if (movement.type === 'move') {
        const updatedState = cloneState(charState);

        if (movement.direction === 'left') {
            let effectiveDirection: 'closer' | 'away' = 'away';
            if (updatedState.facingTargetId) {
                const targetState = newState.get(updatedState.facingTargetId);
                if (targetState && targetState.screenX < updatedState.screenX) effectiveDirection = 'closer';
            }
            updatedState.depth = clamp(updatedState.depth + (effectiveDirection === 'closer' ? -0.15 : 0.15), 0, 1);
            updatedState.screenX = clamp(updatedState.screenX - 15, 5, 95);
        } else if (movement.direction === 'right') {
            let effectiveDirection: 'closer' | 'away' = 'away';
            if (updatedState.facingTargetId) {
                const targetState = newState.get(updatedState.facingTargetId);
                if (targetState && targetState.screenX > updatedState.screenX) effectiveDirection = 'closer';
            }
            updatedState.depth = clamp(updatedState.depth + (effectiveDirection === 'closer' ? -0.15 : 0.15), 0, 1);
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
                        swappedOther.depth = clamp(moverDepth < targetDepth ? targetDepth + 0.2 : targetDepth - 0.2, 0, 1);
                        swappedOther.scale = computeScaleFromDepth(swappedOther.depth);
                        newState.set(otherId, swappedOther);
                        entries.push({ characterId: otherId, previousState: previousOtherState, newState: cloneState(swappedOther), type: 'swap' });
                    }
                }

                updatedState.depth = moverDepth + (targetDepth - moverDepth) * 0.4;
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
        entries.push({ characterId: movement.characterId, previousState: previousCharState, newState: cloneState(updatedState), type: 'move' });
    }

    return { newState, entries };
}

function computeStatesAtHistoryIndex(
    history: VisualNovelMovementEntry[],
    upToIndex: number,
    visibleCharacterIds: string[],
): Map<string, VisualNovelSpriteState> {
    const states = new Map<string, VisualNovelSpriteState>();
    const total = visibleCharacterIds.length;
    for (let i = 0; i < visibleCharacterIds.length; i++) {
        states.set(visibleCharacterIds[i], getDistributedState(i, total));
    }
    for (const entry of history) {
        if (entry.messageIndex > upToIndex) break;
        states.set(entry.characterId, cloneState(entry.newState));
    }
    return states;
}

export function useVisualNovelSpriteStates(options: UseVisualNovelSpriteStatesOptions) {
    const { chatMessages, visibleCharacterIds, viewedMessageIndex } = options;

    const { movementHistory, finalStates, jumpSignature } = useMemo(() => {
        const history: VisualNovelMovementEntry[] = [];
        const states = new Map<string, VisualNovelSpriteState>();
        const total = visibleCharacterIds.length;

        for (let i = 0; i < visibleCharacterIds.length; i++) {
            states.set(visibleCharacterIds[i], getDistributedState(i, total));
        }

        let lastJumpMessageId = '';

        for (let i = 0; i < chatMessages.length; i++) {
            const message = chatMessages[i];
            if (message.messageType !== 'chat') continue;

            const speakerId = message.character.id;
            if (speakerId === AMBIENT_NARRATOR_ID) continue;
            if (!states.has(speakerId)) continue;

            const movements = parseMovementFromText(message.textContent, speakerId, visibleCharacterIds);

            for (const movement of movements) {
                const result = applyMovement(states, movement, visibleCharacterIds);
                for (const [key, val] of result.newState) states.set(key, val);
                for (const partial of result.entries) {
                    history.push({ ...partial, messageId: message.id, messageIndex: i });
                }
                if (movement.type === 'vertical' && movement.verticalAction === 'jump') {
                    lastJumpMessageId = message.id;
                }
            }
        }

        return { movementHistory: history, finalStates: states, jumpSignature: lastJumpMessageId };
    }, [chatMessages, visibleCharacterIds]);

    const [rollbackOverride, setRollbackOverride] = useState<{ index: number; chatRef: ChatMessage[] } | null>(null);

    const rollbackToMessage = useCallback((messageIndex: number) => {
        setRollbackOverride({ index: messageIndex, chatRef: chatMessages });
    }, [chatMessages]);

    const spriteStates = useMemo(() => {
        let effectiveIndex: number | null = viewedMessageIndex;
        if (rollbackOverride && rollbackOverride.chatRef === chatMessages) {
            effectiveIndex = rollbackOverride.index;
        }
        
        const isLatest = effectiveIndex === null || effectiveIndex >= chatMessages.length - 1;
        if (isLatest || effectiveIndex === null) return new Map(finalStates);
        
        return computeStatesAtHistoryIndex(movementHistory, effectiveIndex, visibleCharacterIds);
    }, [movementHistory, finalStates, viewedMessageIndex, rollbackOverride, chatMessages, visibleCharacterIds]);

    const [isInitialLoad, setIsInitialLoad] = useState(true);
    useEffect(() => {
        const id = requestAnimationFrame(() => setIsInitialLoad(false));
        return () => cancelAnimationFrame(id);
    }, []);

    const [jumpingCharacterIds, setJumpingCharacterIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!jumpSignature) return;

        const jumpers = new Set<string>();
        for (const entry of movementHistory) {
            if (entry.messageId === jumpSignature) {
                jumpers.add(entry.characterId);
            }
        }
        if (jumpers.size === 0) return;

        const showTimer = setTimeout(() => setJumpingCharacterIds(jumpers), 16);
        const hideTimer = setTimeout(() => setJumpingCharacterIds(new Set()), 600);

        return () => {
            clearTimeout(showTimer);
            clearTimeout(hideTimer);
        };
    }, [jumpSignature, movementHistory]);

    return {
        spriteStates,
        rollbackToMessage,
        isInitialLoad,
        jumpingCharacterIds,
    };
}