// src/hooks/immersionLogic.ts
import type { ChatMessage, InteractionData } from "../types";

/**
 * Get the display name for a character at a given point in the chat message history.
 * 
 * @param interactionData - The full chat data
 * @param interactionMessageIndex - Index into the FILTERED chat messages array (not interactionHistory)
 * @param characterId - The character whose name to resolve
 */
export function getDelayedDisplayName(interactionData: InteractionData, interactionMessageIndex: number, characterId: string): string {

    const participants = interactionData.participants;

    // forceNameReveal is DISPLAY-ONLY: always show name in UI regardless of reveal state
    const forceNameReveal = interactionData.Profile?.forceNameReveal ?? false;
    if (forceNameReveal) {
        const character = participants.find(p => p.id === characterId);
        return character ? character.name : 'Unknown';
    }

    // Build filtered chat messages list to map the display index to the actual message
    const chatMessages = interactionData.interactionHistory.filter((m): m is ChatMessage => m.kind === 'chat');

    if (!interactionData || chatMessages.length === 0 || interactionMessageIndex < 0 || interactionMessageIndex >= chatMessages.length) {
        const index = participants.findIndex(p => p.id === characterId);
        return index !== -1 ? `Character ${index + 1}` : 'Unknown';
    }

    const targetMessage = chatMessages[interactionMessageIndex];

    // Find this message's position in the FULL interactionHistory
    const fullIndex = interactionData.interactionHistory.indexOf(targetMessage);
    if (fullIndex === -1) {
        const index = participants.findIndex(p => p.id === characterId);
        return index !== -1 ? `Character ${index + 1}` : 'Unknown';
    }

    // Scan backwards through the FULL interactionHistory from this message's position
    // to find if this character had their name revealed in a prior entry
    for (let i = fullIndex - 1; i >= 0; i--) {
        const historyMessage = interactionData.interactionHistory[i];
        const character = historyMessage.character;

        if (character.id === characterId) {
            // Found a previous entry by this character — check if name was revealed
            if (historyMessage.isNameRevealed) {
                return character.name;
            }
            break;
        }
    }

    // Default: Show the generic ID if no previous reveal was found
    const index = participants.findIndex(p => p.id === characterId);
    return index !== -1 ? `Character ${index + 1}` : 'Unknown';
}