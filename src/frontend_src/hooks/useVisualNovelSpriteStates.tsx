// frontend_src/hooks/useVisualNovelSpriteStates.ts
import { useEffect, useState, useCallback, useMemo } from 'react';
import type { ChatMessage } from '../types';

const AMBIENT_NARRATOR_ID = '___ambient_narrator___';

export type BreathingPattern = 'calm' | 'fast' | 'heavy' | 'subtle' | 'tremble' | 'none';

export interface VisualNovelSpriteState {
    depth: number;
    screenX: number;
    facingTargetId: string | null;
    scale: number;
    verticalOffset: number;
    breathingPattern: BreathingPattern;
}

interface VisualNovelMovementEntry {
    messageId: string;
    messageIndex: number;
    characterId: string;
    previousState: VisualNovelSpriteState;
    newState: VisualNovelSpriteState;
    type: 'move' | 'face' | 'swap' | 'vertical' | 'push' | 'jump' | 'shake' | 'fall';
}

interface UseVisualNovelSpriteStatesOptions {
    chatMessages: ChatMessage[];
    visibleCharacterIds: string[];
    protagonistId: string | undefined;
    viewedMessageIndex: number | null;
}

type MovementDirection = 'left' | 'right' | 'closer' | 'away' | 'forward' | 'backward';
type VerticalAction = 
    | 'crouch' | 'stand' | 'jump' | 'stretch' | 'sit' | 'sit_up' | 'lie' 
    | 'faint' | 'fall' | 'trip' | 'stumble'
    | 'steady' | 'wake'
    | 'lean_forward' | 'lean_back' | 'tower' | 'shrink' 
    | 'sidestep_left' | 'sidestep_right' | 'center' | 'turn_away' 
    | 'hide_behind' | 'group_up'
    | 'shake' | 'shudder' | 'tremble'
    | 'breathe_fast' | 'breathe_heavy' | 'breathe_subtle' | 'breathe_tremble' | 'breathe_none' | 'breathe_calm';

type InteractionAction = 
    | 'push' | 'pull' | 'block' | 'gather'
    | 'crash' | 'touch' | 'embrace' | 'cling' | 'lean_on';

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

    // --- Dynamic Breathing & Recovery Detection ---
    if (/\b(pant|panting|panted|gasp|gasping|gasped|out\s+of\s+breath|short\s+of\s+breath|hyperventilat\w*|breathless)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_fast' });
    }
    if (/\b(sigh|sighed|sighing|heavy\s+breath|deep\s+breath|breathe\s+deeply|breathed\s+heavily|exhaust\w*|winded)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_heavy' });
    }
    if (/\b(shiver|shivering|shivered|shivers|shivery|trembl\w*|tremor\w*|tremulous\w*|shudder\w*|quiver\w*|teeth\s+chatter\w*|chatter\w*\s+teeth|shak(e|ing|es|y|ily)|shook|convuls\w*|quak\w*|jitter\w*|spasm\w*)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_tremble' });
    }
    if (/\b(calm|steady\s+breath|slow\s+breath|relax\w*|asleep|sleep|peaceful)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_subtle' });
    }
    if (/\b(held\s+(?:her|his|their|my|our)\s+breath|hold\s+(?:her|his|their|my|our)\s+breath|freeze|froze|motionless|statue|stopped\s+breathing)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_none' });
    }
    if (/\b(catch\w*\s+(?:her|his|their|my|our)\s+breath|caught\s+(?:her|his|their|my|our)\s+breath|breath\w*\s+evened\s+out|breathing\s+evened\s+out|breath\w*\s+slowed|breathing\s+slowed|compose\w*\s+(?:her|his|their|my|our|one's)\s+self|composed\s+(?:her|his|their|my|our|one's)\s+self|calm\w*\s+down|calmed\s+down|stop\w*\s+(?:shaking|trembling|shivering|hyperventilating)|stopped\s+(?:shaking|trembling|shivering|hyperventilating))\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'breathe_calm' });
    }

    // --- Shudder, Tremble & Shake Physical Reactions ---
    if (/\b(shudder|shuddered|shuddering|shudders|a\s+shudder)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'shudder' });
    }
    if (/\b(trembl\w*|tremor\w*|tremulous\w*|quiver\w*|teeth\s+chatter\w*)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'tremble' });
    }
    if (/\b(shak(e|ing|es|y|ily)|shook|convuls\w*|quak\w*|vibrat\w*|spasm\w*|rattl\w*)\b/i.test(lowerClause) &&
        !/\b(shak|shook)\w*\s+(?:his|her|their|my|our|one's)?\s*head\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'shake' });
    }
    if (/\b(shak|shook)\w*\s+(?:his|her|their|my|our|one's)?\s*head\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'turn_away' });
    }

    // --- Faint, Pass Out & Loss of Consciousness ---
    if (/\b(faint\w*|pass\w*\s+out|passed\s+out|swoon\w*|black\w*\s+out|blacked\s+out|lost\s+consciousness|lose\s+consciousness|losing\s+consciousness|fell\s+unconscious|fall\s+unconscious|unconscious)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'faint' });
    }

    // --- Fall, Collapse, Slump & Crumple ---
    if (/\b(fall\w*\s+(?:down|over|flat|backwards?|forwards?)|fell\s+(?:down|over|flat|backwards?|forwards?)|fall\w*\s+to\s+the\s+(?:ground|floor|earth|knees)|fell\s+to\s+the\s+(?:ground|floor|earth|knees)|drop\w*\s+to\s+the\s+(?:ground|floor|earth)|dropped\s+to\s+the\s+(?:ground|floor|earth)|collaps\w*|slump\w*|crumpl\w*|tumbl\w*|toppl\w*|hit\s+the\s+(?:ground|floor))\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'fall' });
    }

    // --- Trip, Stumble, Slip & Loss of Balance ---
    if (/\b(trip|tripped|tripping|trips|stumble\w*|stagger\w*|lurch\w*|slipped|slipping|lost\s+(?:her|his|their|my|our|one's)\s+(?:balance|footing)|lose\s+(?:her|his|their|my|our|one's)\s+(?:balance|footing)|losing\s+(?:balance|footing)|off\s+balance|pitch\w*\s+forward)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'trip' });
    }

    // --- Recovery Actions ---
    if (/\b(catch\w*\s+(?:her|his|their|my|our|one's)\s+self|caught\s+(?:her|his|their|my|our|one's)\s+self|steady\w*\s+(?:her|his|their|my|our|one's)\s+self|steadied\s+(?:her|his|their|my|our|one's)\s+self|regain\w*\s+(?:her|his|their|my|our|one's)\s+(?:balance|footing)|regained\s+(?:her|his|their|my|our|one's)\s+(?:balance|footing)|find\w*\s+(?:her|his|their|my|our|one's)\s+(?:balance|footing)|found\s+(?:her|his|their|my|our|one's)\s+(?:balance|footing)|brace\w*\s+(?:her|his|their|my|our|one's)\s+self|braced\s+(?:her|his|their|my|our|one's)\s+self)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'steady' });
    }
    if (/\b(wake\w*\s+up|woke\s+up|woken\s+up|come\w*\s+to|came\s+to|regain\w*\s+consciousness|regained\s+consciousness|open\w*\s+(?:her|his|their|my|our)\s+eyes|opened\s+(?:her|his|their|my|our)\s+eyes|stir\w*|blink\w*\s+awake|blinked\s+awake)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'wake' });
    }
    if (/\b(sit\w*\s+up|sat\s+up|groan\w*\s+and\s+sit\s+up|groaned\s+and\s+sat\s+up)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'sit_up' });
    }
    if (/\b(stand\w*\s+(?:up|back\s+up)|stood\s+(?:up|back\s+up)|get\w*\s+(?:up|back\s+up)|got\s+(?:up|back\s+up)|getting\s+back\s+up|rise\w*|rose\b|straighten\w*|straightened|push\w*\s+(?:her|his|their|my|our|one's)\s+self\s+up|pushed\s+(?:her|his|their|my|our|one's)\s+self\s+up|pull\w*\s+(?:her|his|their|my|our|one's)\s+self\s+up|pulled\s+(?:her|his|their|my|our|one's)\s+self\s+up|scramble\w*\s+to\s+(?:her|his|their|my|our|one's)\s+feet|stagger\w*\s+to\s+(?:her|his|their|my|our|one's)\s+feet|back\s+on\s+(?:her|his|their|my|our|one's)\s+feet|pick\w*\s+(?:her|his|their|my|our|one's)\s+self\s+up|picked\s+(?:her|his|their|my|our|one's)\s+self\s+up|dust\w*\s+(?:her|his|their|my|our|one's)\s+self\s+off|dusted\s+(?:her|his|their|my|our|one's)\s+self\s+off|unfold\w*)\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'stand' });
    }

    // --- Standard Actions ---
    if (/\bcrouch|kneel|bow|duck|lower\s+(herself|himself|themselves|down)|bend\s+(her|his|their)\s+knee/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'crouch' });
    }
    if (/\bjump|leap|hop|bounce|vault\b/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'jump' });
    }
    if (/\bstretch|reach\s+up|raise\s+(her|his|their)\s+arm|extend\s+upward/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'stretch' });
    }
    if (/\bsit|take\s+a\s+seat|settle\s+down|perch|plop\s+down/i.test(lowerClause) && !/\bsit\s+up|sat\s+up/i.test(lowerClause)) {
        movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'sit' });
    }
    if (/\blie\s+down|lay\s+down|lying\s+down/i.test(lowerClause)) {
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

    // --- Interpersonal Interactions (Collisions, Physical Contact, Embraces, etc.) ---
    if (firstMentioned) {
        // 1. Helping Another Character Up
        if (/\b(help\w*|pull\w*|lift\w*|drag\w*)\s+(?:her|him|them|up)\s+(?:up|to\s+(?:her|his|their)\s+feet|back\s+up)/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'pull', targetCharacterId: firstMentioned });
            movements.push({ characterId: firstMentioned, type: 'vertical', verticalAction: 'stand' });
        }

        // 2. Crashing, Tackling, Slamming Into, Knocking Down
        if (/\b(crash\w*\s+into|crashed\s+into|collide\w*\s+with|collided\s+with|tackle\w*|tackled|slam\w*\s+into|slammed\s+into|smash\w*\s+into|knock\w*\s+(?:her|him|them|down|over)|knocked\s+(?:her|him|them|down|over)|plow\w*\s+into|plowed\s+into|barrel\w*\s+into|barreled\s+into|run\w*\s+into|ran\s+into|bump\w*\s+hard\s+into|trip\w*\s+and\s+fall\w*\s+onto)\b/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'crash', targetCharacterId: firstMentioned });
        }

        // 3. Hugging, Embracing, Clinging to, Leaning on, Cuddling
        if (/\b(hug\w*|hugged|hugging|embrace\w*|embraced|embracing|wrap\w*\s+(?:her|his|their|my|our)\s+arms\s+around|wrapped\s+(?:her|his|their|my|our)\s+arms\s+around|cling\w*\s+to|clung\s+to|clinging\s+to|lean\w*\s+(?:against|on|onto)\s+(?:her|him|them)|leaned\s+(?:against|on|onto)\s+(?:her|him|them)|cuddle\w*|cuddled|cuddling|snuggle\w*|snuggled|snuggling|hold\w*\s+(?:her|him|them)\s+close|held\s+(?:her|him|them)\s+close|bury\w*\s+(?:her|his|their|my)\s+face\s+in|buried\s+(?:her|his|their|my)\s+face\s+in)\b/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'embrace', targetCharacterId: firstMentioned });
        }

        // 4. Touching, Tapping, Patting, Holding Hands, Resting Hand On, Caressing
        if (/\b(touch\w*|touched|touching|tap\w*\s+(?:her|him|them|on)|tapped\s+(?:her|him|them|on)|poke\w*|poked|poking|pat\w*|patted|patting|pat\w*\s+(?:her|his|their|on)\s+(?:head|shoulder|back|arm)|rest\w*\s+(?:her|his|their|my)\s+hand\s+on|rested\s+(?:her|his|their|my)\s+hand\s+on|place\w*\s+(?:her|his|their|my)\s+hand\s+on|placed\s+(?:her|his|their|my)\s+hand\s+on|brush\w*\s+(?:against|her|him|them)|brushed\s+against|caress\w*|caressed|hold\w*\s+(?:her|his|their)\s+hand|held\s+(?:her|his|their)\s+hand|take\w*\s+(?:her|his|their)\s+hand|took\s+(?:her|his|their)\s+hand|interlock\w*\s+fingers|intertwine\w*\s+fingers|grab\w*\s+(?:her|his|their)\s+(?:hand|arm|wrist|shoulder)|grabbed\s+(?:her|his|their)\s+(?:hand|arm|wrist|shoulder))\b/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'touch', targetCharacterId: firstMentioned });
        }

        // 5. Existing Generic Push / Pull / Block / Gather / Approach / Face
        if (/\b(push|shove|nudge|bump\s+into)\b/i.test(lowerClause) && !/\b(bump\s+hard|knock|crash|slam|tackle)\b/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'push', targetCharacterId: firstMentioned });
        }
        if (/\b(pull|drag|grab\s+and\s+pull|tug)\b/i.test(lowerClause) && !/\bhelp/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'pull', targetCharacterId: firstMentioned });
        }
        if (/\b(block|stand\s+between|intercept|step\s+in\s+front\s+of)\b/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'block', targetCharacterId: firstMentioned });
        }
        if (/\b(gather|group\s+up|huddle|cluster\s+together)\b/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'interaction', interactionAction: 'gather', targetCharacterId: firstMentioned });
        }
        if (/\b(move|step|walk|go|approach)\s+(closer\s+to|toward|towards|next\s+to|beside)\b/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'closer', targetCharacterId: firstMentioned });
        }
        if (/\b(move|step|back|retreat)\s+(away\s+from|back\s+from|from)\b/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'move', direction: 'away', targetCharacterId: firstMentioned });
        }
        if (/\b(hide\s+behind|duck\s+behind|take\s+cover\s+behind)\b/i.test(lowerClause)) {
            movements.push({ characterId: speakerId, type: 'vertical', verticalAction: 'hide_behind', targetCharacterId: firstMentioned });
        }
        if (/\b(face|look\s+at|turn\s+toward|turn\s+to|stare\s+at|glance\s+at|watch|eye)\b/i.test(lowerClause)) {
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
            case 'shake':
            case 'shudder':
            case 'tremble':
                updatedState.breathingPattern = 'tremble';
                break;
            case 'faint':
                updatedState.verticalOffset = 60;
                updatedState.scale = clamp(updatedState.scale * 0.65, 0.3, 2.5);
                updatedState.breathingPattern = 'subtle';
                break;
            case 'fall':
                updatedState.verticalOffset = 55;
                updatedState.scale = clamp(updatedState.scale * 0.7, 0.3, 2.5);
                break;
            case 'trip':
            case 'stumble':
                updatedState.verticalOffset = clamp(updatedState.verticalOffset + 18, 0, 60);
                updatedState.depth = clamp(updatedState.depth - 0.05, 0, 1);
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                break;
            case 'steady':
                updatedState.verticalOffset = 0;
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                break;
            case 'wake':
                updatedState.verticalOffset = 45;
                updatedState.scale = computeScaleFromDepth(updatedState.depth) * 0.85;
                updatedState.breathingPattern = 'subtle';
                break;
            case 'sit_up':
                updatedState.verticalOffset = 40;
                updatedState.scale = computeScaleFromDepth(updatedState.depth) * 0.9;
                if (updatedState.breathingPattern === 'none') {
                    updatedState.breathingPattern = 'calm';
                }
                break;
            case 'stand':
                updatedState.verticalOffset = 0;
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                if (updatedState.breathingPattern === 'none') {
                    updatedState.breathingPattern = 'calm';
                }
                break;
            case 'crouch': updatedState.verticalOffset = clamp(updatedState.verticalOffset + 25, 0, 60); break;
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
            case 'crash': {
                const impactDir = updatedState.screenX < targetState.screenX ? 1 : -1;
                
                // Speaker rushes directly to target position
                updatedState.screenX = clamp(targetState.screenX - impactDir * 8, 5, 95);
                updatedState.depth = targetState.depth;
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                updatedState.facingTargetId = movement.targetCharacterId;

                // Target experiences heavy pushback and depth recoil
                const pushedTarget = cloneState(targetState);
                pushedTarget.screenX = clamp(targetState.screenX + impactDir * 18, 5, 95);
                pushedTarget.depth = clamp(targetState.depth + 0.12, 0, 1);
                pushedTarget.scale = computeScaleFromDepth(pushedTarget.depth);
                pushedTarget.facingTargetId = movement.characterId;

                newState.set(movement.targetCharacterId, pushedTarget);
                entries.push({ characterId: movement.targetCharacterId, previousState: previousTargetState, newState: cloneState(pushedTarget), type: 'push' });
                break;
            }
            case 'touch': {
                const side = updatedState.screenX < targetState.screenX ? -1 : 1;
                
                // Moves to close proximity for physical contact (~11% spacing)
                updatedState.screenX = clamp(targetState.screenX + side * 11, 5, 95);
                updatedState.depth = targetState.depth + 0.01;
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                updatedState.facingTargetId = movement.targetCharacterId;

                // Target turns to face
                const turnedTarget = cloneState(targetState);
                turnedTarget.facingTargetId = movement.characterId;
                newState.set(movement.targetCharacterId, turnedTarget);
                entries.push({ characterId: movement.targetCharacterId, previousState: previousTargetState, newState: cloneState(turnedTarget), type: 'face' });
                break;
            }
            case 'embrace':
            case 'cling':
            case 'lean_on': {
                const side = updatedState.screenX < targetState.screenX ? -1 : 1;
                
                // Moves into intimate embrace distance (~7% spacing)
                updatedState.screenX = clamp(targetState.screenX + side * 7, 5, 95);
                updatedState.depth = targetState.depth;
                updatedState.scale = computeScaleFromDepth(updatedState.depth);
                updatedState.facingTargetId = movement.targetCharacterId;

                // Target embraces back / turns facing
                const touchedTarget = cloneState(targetState);
                touchedTarget.facingTargetId = movement.characterId;
                newState.set(movement.targetCharacterId, touchedTarget);
                entries.push({ characterId: movement.targetCharacterId, previousState: previousTargetState, newState: cloneState(touchedTarget), type: 'face' });
                break;
            }
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

    const { movementHistory, finalStates, jumpSignature, shakeSignature, fallSignature } = useMemo(() => {
        const history: VisualNovelMovementEntry[] = [];
        const states = new Map<string, VisualNovelSpriteState>();
        const total = visibleCharacterIds.length;

        for (let i = 0; i < visibleCharacterIds.length; i++) {
            states.set(visibleCharacterIds[i], getDistributedState(i, total));
        }

        let lastJumpMessageId = '';
        let lastShakeMessageId = '';
        let lastFallMessageId = '';

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
                if (movement.type === 'vertical') {
                    if (movement.verticalAction === 'jump') {
                        lastJumpMessageId = message.id;
                    }
                    if (
                        movement.verticalAction === 'shake' ||
                        movement.verticalAction === 'shudder' ||
                        movement.verticalAction === 'tremble'
                    ) {
                        lastShakeMessageId = message.id;
                    }
                    if (
                        movement.verticalAction === 'fall' ||
                        movement.verticalAction === 'faint' ||
                        movement.verticalAction === 'trip' ||
                        movement.verticalAction === 'stumble'
                    ) {
                        lastFallMessageId = message.id;
                    }
                }
                // Impact shake trigger on collision / crash
                if (movement.type === 'interaction' && movement.interactionAction === 'crash') {
                    lastShakeMessageId = message.id;
                }
            }
        }

        return { 
            movementHistory: history, 
            finalStates: states, 
            jumpSignature: lastJumpMessageId,
            shakeSignature: lastShakeMessageId,
            fallSignature: lastFallMessageId,
        };
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
    const [shakingCharacterIds, setShakingCharacterIds] = useState<Set<string>>(new Set());
    const [fallingCharacterIds, setFallingCharacterIds] = useState<Set<string>>(new Set());

    // Jump transient animation trigger (600ms)
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

    // Shake/shudder/tremble/crash impact transient reaction trigger (600ms)
    useEffect(() => {
        if (!shakeSignature) return;

        const shakers = new Set<string>();
        for (const entry of movementHistory) {
            if (entry.messageId === shakeSignature) {
                shakers.add(entry.characterId);
            }
        }
        if (shakers.size === 0) return;

        const showTimer = setTimeout(() => setShakingCharacterIds(shakers), 16);
        const hideTimer = setTimeout(() => setShakingCharacterIds(new Set()), 600);

        return () => {
            clearTimeout(showTimer);
            clearTimeout(hideTimer);
        };
    }, [shakeSignature, movementHistory]);

    // Fall/faint/trip/stumble transient reaction trigger (600ms)
    useEffect(() => {
        if (!fallSignature) return;

        const fallers = new Set<string>();
        for (const entry of movementHistory) {
            if (entry.messageId === fallSignature) {
                fallers.add(entry.characterId);
            }
        }
        if (fallers.size === 0) return;

        const showTimer = setTimeout(() => setFallingCharacterIds(fallers), 16);
        const hideTimer = setTimeout(() => setFallingCharacterIds(new Set()), 600);

        return () => {
            clearTimeout(showTimer);
            clearTimeout(hideTimer);
        };
    }, [fallSignature, movementHistory]);

    return {
        spriteStates,
        rollbackToMessage,
        isInitialLoad,
        jumpingCharacterIds,
        shakingCharacterIds,
        fallingCharacterIds,
    };
}