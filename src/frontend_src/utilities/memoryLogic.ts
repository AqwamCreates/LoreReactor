// src/frontend_src/utilities/memoryLogic.ts
import type { InteractionData, Character, TextMessage, memorySearchSpace } from '../types';
import { getGlobalMessageHistory, getLocalMessageHistory } from './timelineLogic';
import { getCoLocatedParticipants } from './locationLogic';

const DEFAULT_MEMORY_SEARCH_SPACES: memorySearchSpace[] = [
    'co-located protagonists',
    'co-located non-protagonists'
];

/**
 * Builds the exact text string used to generate the embedding query vector for memory retrieval.
 * Filters chat history based on strict spatial location (co-located vs non-co-located) 
 * and narrative role (protagonist vs non-protagonist).
 */
export function buildMemoryQueryText(
    interactionData: InteractionData,
    character: Character,
    requestedSpaces?: memorySearchSpace[]
): string {
    const spaces = requestedSpaces && requestedSpaces.length > 0 
        ? requestedSpaces 
        : DEFAULT_MEMORY_SEARCH_SPACES;

    const protagonistIds = new Set(interactionData.protagonistIds || []);
    
    // Determine who is physically in the same room as the active character
    const coLocatedParticipants = getCoLocatedParticipants(interactionData, character);
    
    // STRICT WINDOW SIZE: Exactly the co-located participant count. No minimums, no multipliers.
    const windowSize = coLocatedParticipants.length;
    if (windowSize === 0) return '';

    const coLocatedIds = new Set(coLocatedParticipants.map(p => p.id));
    coLocatedIds.add(character.id); // The character is always co-located to themselves

    // We MUST use global history to access messages from other locations (non-co-located)
    const globalHistory = getLocalMessageHistory(interactionData, character, ['chat', 'whisper']);
    if (globalHistory.length === 0) return '';

    // Take only the most recent messages based on the strict window size
    const recentHistory = globalHistory.slice(-windowSize);
    
    const filteredTexts: string[] = [];

    for (const msg of recentHistory) {
        if (msg.messageType !== 'chat' && msg.messageType !== 'whisper') continue;
        const textMsg = msg as TextMessage;

        // Strict visibility check for whispers
        if (textMsg.messageType === 'whisper') {
            if (textMsg.character.id !== character.id && !textMsg.targetCharacterIds.includes(character.id)) continue;
        }

        const isProtagonist = protagonistIds.has(msg.character.id);
        const isNotProtagonist = !isProtagonist;
        const isCoLocated = coLocatedIds.has(msg.character.id);
        const isNotCoLocated = !isCoLocated;

        let include = false;

        // 1. Co-located Protagonists (In the room, Player)
        if (isCoLocated && isProtagonist && spaces.includes('co-located protagonists')) include = true;
        
        // 2. Non-co-located Protagonists (In another room, Player)
        if (isNotCoLocated && isProtagonist && spaces.includes('non-co-located protagonists')) include = true;
        
        // 3. Co-located Non-protagonists (In the room, NPC)
        if (isCoLocated && isNotProtagonist && spaces.includes('co-located non-protagonists')) include = true;
        
        // 4. Non-co-located Non-protagonists (In another room, NPC)
        if (isNotCoLocated && isNotProtagonist && spaces.includes('non-co-located non-protagonists')) include = true;

        // RAW PROSE: No speaker prefixes. Just the raw narrative text.
        if (include && textMsg.textContent) {
            filteredTexts.push(textMsg.textContent);
        }
    }

    if (filteredTexts.length === 0) return '';

    // FIRST-PERSON COGNITIVE ANCHOR: Frames the text as a trigger for past recall.
    const anchor = 'Reflecting on these recent events, I recall my past memories:\n\n';
    
    return anchor + filteredTexts.join('\n\n');
}