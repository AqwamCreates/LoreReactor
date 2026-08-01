import type {Character, ChatData } from "./types";

export function getDelayedDisplayName(chatData: ChatData, chatMessageHistoryIndex: number, characterId: string, participants: Character[]): string {

    const chatMessageHistory = chatData.chatMessageHistory

    const chatMessageHistoryLength = chatMessageHistory.length

    if (!chatMessageHistory || chatMessageHistoryLength === 0 || chatMessageHistoryIndex < 0 || chatMessageHistoryIndex >= chatMessageHistoryLength) {
        const index = participants.findIndex(p => p.id === characterId);
        return index !== -1 ? `Character ${index + 1}` : 'Unknown';
    }

    // Scan backwards from the current index to find the immediate predecessor.
    // We start at currentIndex - 1 because we want to look at PREVIOUS messages.

    const targetChatMessage = chatMessageHistory[chatMessageHistoryIndex]

    for (let i = chatMessageHistoryIndex - 1; i >= 0; i--) {

        const chatMessage = chatMessageHistory[i]

        const character = chatMessage.character

        if (character.id === characterId) {
        console.log(`2 Found previous message from character ${character.name} at index ${i}. isNameRevealed: ${chatMessage.isNameRevealed}`)
        console.log(`targetChatMessage: ${JSON.stringify(targetChatMessage)}`)
        // Be careful! This function are used by streaming LLMs, it will get the wrong message to get the names for if you choose the streaming message.
        if (chatMessage.isNameRevealed && targetChatMessage) {return character.name}
        break; 
        }
    }
    
    // Default: Show the generic ID if no previous reveal was found
    const index = participants.findIndex(p => p.id === characterId);
    return index !== -1 ? `Character ${index + 1}` : 'Unknown';
}