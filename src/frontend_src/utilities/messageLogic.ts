// frontend_src/utilities/messageLogic.ts
import { deleteRawMessage, saveRawInteractionData, loadAllRawInteractionDataShells } from '../storages/serverStorage';
import type { InteractionData, HistoryMessage, ChatMessage, Character } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getGlobalMessageHistory } from './timelineLogic';

// Helper: Returns a Set of all Message IDs in this chat that are branch points for OTHER chats
async function getParentMessageIds(chatId: string): Promise<Set<string>> {
    const allChats = await loadAllRawInteractionDataShells();
    const points = new Set<string>();
    
    for (const c of allChats) {
        if (c && c.parentInteractionDataId === chatId && c.parentMessageId) {
            points.add(c.parentMessageId);
        }
    }
    return points;
}

/**
 * Finds the most recent message where the character is currently present.
 * Returns both the message and the locationId it belongs to in a single pass.
 */
export function findLatestMessage(interactionData: InteractionData, character: Character, messageTypes?: string[]): { message: HistoryMessage; locationId: string } | undefined {
    let latestMessage: HistoryMessage | undefined = undefined;
    let latestLocationId: string | undefined = undefined;

    for (const [locationId, messages] of Object.entries(interactionData.interactionHistories || {})) {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.character.id === character.id) {
                // Only check isPresent for interaction messages where presence matters
                if (!msg.isPresent) break;
                
                if (messageTypes && messageTypes.length > 0 && !messageTypes.includes(msg.messageType)) {
                    continue;
                }
                
                latestMessage = msg;
                latestLocationId = locationId;
                break; 
            }
        }
        if (latestMessage) break;
    }

    if (latestMessage && latestLocationId) {
        return { message: latestMessage, locationId: latestLocationId };
    }
    
    return undefined;
}

/**
 * Clears the partial flag on a message after successful resume completion.
 */
export async function clearPartialFlag(interactionData: InteractionData, messageId: string): Promise<InteractionData> {
    const updatedHistories = { ...interactionData.interactionHistories };
    let found = false;

    for (const [locId, messages] of Object.entries(updatedHistories)) {
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            const msg = messages[index];
            if (msg.messageType === 'chat') {
                updatedHistories[locId] = [...messages];
                updatedHistories[locId][index] = { ...msg }; 
            }
            found = true;
            break;
        }
    }

    if (!found) return interactionData;

    const updatedChat = {
        ...interactionData,
        interactionHistories: updatedHistories,
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawInteractionData(updatedChat);
    return updatedChat;
}

export async function deleteMessage(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const parentInteractionMessageIds = await getParentMessageIds(currentChat.id);
    
    if (parentInteractionMessageIds.has(messageId)) {
        throw new Error("Cannot delete: Other chat sessions branch from this message.");
    }

    await deleteRawMessage(messageId);
    
    const updatedHistories = { ...currentChat.interactionHistories };
    let found = false;

    for (const [locId, messages] of Object.entries(updatedHistories)) {
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            updatedHistories[locId] = messages.filter(m => m.id !== messageId);
            found = true;
            break;
        }
    }

    if (!found) return currentChat;

    const updatedChat: InteractionData = {
        ...currentChat,
        interactionHistories: updatedHistories,
        numberOfMessages: Object.values(updatedHistories).reduce((acc, curr) => acc + curr.length, 0),
        lastUpdatedTimestamp: Date.now(),
    };

    // ✅ SAVE IMMEDIATELY: Prevents useServerSync from reloading the old chat shell
    await saveRawInteractionData(updatedChat);

    return updatedChat;
}

export async function editChatMessage(interactionData: InteractionData, messageId: string, newText: string): Promise<InteractionData> {
    const parentInteractionMessageIds = await getParentMessageIds(interactionData.id);

    if (parentInteractionMessageIds.has(messageId)) {
        throw new Error("Cannot edit: Other chat sessions branch from this message.");
    }

    const updatedHistories = { ...interactionData.interactionHistories };
    let found = false;

    for (const [locId, messages] of Object.entries(updatedHistories)) {
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            const msg = messages[index]
            const messageType = msg.messageType;
            if (messageType === 'chat' || messageType === "whisper") {
                updatedHistories[locId] = [...messages];
                updatedHistories[locId][index] = { 
                    ...msg, 
                    textContent: newText, 
                    // Clear fields tied to the old text
                    toolExecutionResults: [], 
                    lastUpdatedTimestamp: Date.now() 
                } as ChatMessage;
            }
            found = true;
            break;
        }
    }

    if (!found) return interactionData;

    const updatedChat = {
        ...interactionData,
        interactionHistories: updatedHistories,
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawInteractionData(updatedChat);
    return updatedChat;
}

/**
 * Mass deletes messages from the target message's location onwards.
 * Automatically resolves the locationId from the messageId.
 */
// In src/utilities/messageLogic.ts
export async function massDeleteMessages(interactionData: InteractionData, messageId: string): Promise<InteractionData> {
    const parentInteractionMessageIds = await getParentMessageIds(interactionData.id);
    
    // 1. Get the global flattened history to find chronological order
    const globalHistory = getGlobalMessageHistory(interactionData);
    const targetGlobalIndex = globalHistory.findIndex(m => m.id === messageId);
    
    if (targetGlobalIndex === -1) {
        throw new Error("Message not found.");
    }

    // 2. Identify all messages from this message onwards in the global timeline
    const messagesToDelete = globalHistory.slice(targetGlobalIndex);

    for (const msg of messagesToDelete) {
        if (parentInteractionMessageIds.has(msg.id)) {
            throw new Error("Cannot delete: Other chats branch from this message.");
        }
    }

    // 3. Delete raw messages from server storage
    await Promise.all(messagesToDelete.map(m => deleteRawMessage(m.id)));
    
    // 4. Rebuild all location histories keeping only messages BEFORE targetGlobalIndex
    const updatedHistories: Record<string, HistoryMessage[]> = {};
    for (const [locId, messages] of Object.entries(interactionData.interactionHistories || {})) {
        const keptMsgs = messages.filter(m => {
            const globalIdx = globalHistory.findIndex(hm => hm.id === m.id);
            return globalIdx !== -1 && globalIdx < targetGlobalIndex;
        });
        
        updatedHistories[locId] = keptMsgs;
    }

    const totalMessages = Object.values(updatedHistories).reduce((acc, curr) => acc + curr.length, 0);

    return {
        ...interactionData,
        interactionHistories: updatedHistories,
        numberOfMessages: totalMessages,
        lastUpdatedTimestamp: Date.now(),
    };
}

/**
 * Branches the chat at the target message.
 * Automatically resolves the locationId from the messageId.
 */
export async function branchMessage(interactionData: InteractionData, messageId: string): Promise<InteractionData> {
    const target = getMessageById(interactionData, messageId);
    if (!target) {
        throw new Error("Message not found");
    }
    
    const locationId = target.locationId;
    const messages = interactionData.interactionHistories[locationId] || [];
    const branchIndex = messages.findIndex(m => m.id === messageId);
    
    if (branchIndex === -1) {
        throw new Error("Message not found in this location");
    }

    const branchedHistories: Record<string, HistoryMessage[]> = {};
    
    for (const [locId, msgs] of Object.entries(interactionData.interactionHistories)) {
        if (locId === locationId) {
            branchedHistories[locId] = msgs.slice(0, branchIndex + 1);
        } else {
            branchedHistories[locId] = [...msgs];
        }
    }

    const branchedChat: InteractionData = {
        ...interactionData,
        id: uuidv4(),
        name: `${interactionData.name} (Branch)`,
        interactionHistories: branchedHistories,
        parentInteractionDataId: interactionData.id,
        parentMessageId: messageId,
        firstCreatedTimestamp: Date.now(),
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawInteractionData(branchedChat);
    return branchedChat;
}

/**
 * Clones the chat up to the target message.
 * Automatically resolves the locationId from the messageId.
 */
export async function cloneChatUpToMessage(interactionData: InteractionData, messageId: string): Promise<InteractionData> {
    const target = getMessageById(interactionData, messageId);
    if (!target) {
        throw new Error("Message not found");
    }
    
    const locationId = target.locationId;
    const messages = interactionData.interactionHistories[locationId] || [];
    const cloneIndex = messages.findIndex(m => m.id === messageId);
    
    if (cloneIndex === -1) {
        throw new Error("Message not found in this location");
    }

    const now = Date.now();
    const clonedHistories: Record<string, HistoryMessage[]> = {};

    for (const [locId, msgs] of Object.entries(interactionData.interactionHistories)) {
        if (locId === locationId) {
            clonedHistories[locId] = msgs.slice(0, cloneIndex + 1).map(msg => ({
                ...msg,
                id: uuidv4(),
                character: { ...msg.character },
                firstCreatedTimestamp: now,
                lastUpdatedTimestamp: now,
                parentMessageId: null,
            }));
        } else {
            clonedHistories[locId] = msgs.map(msg => ({
                ...msg,
                id: uuidv4(),
                character: { ...msg.character },
                firstCreatedTimestamp: now,
                lastUpdatedTimestamp: now,
                parentMessageId: null,
            }));
        }
    }

    const clonedChat: InteractionData = {
        id: uuidv4(),
        name: `${interactionData.name} (Clone)`,
        protagonistIds: [...(interactionData.protagonistIds || [])],
        participants: interactionData.participants.map(p => ({ ...p })),
        contexts: (interactionData.contexts || []).map(c => ({ ...c })),
        locations: (interactionData.locations || []).map(l => ({ ...l })),
        audioTracks: (interactionData.audioTracks || []).map(a => ({ ...a })),
        interactionHistories: clonedHistories,
        profile: interactionData.profile,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentInteractionDataId: null,
        parentMessageId: null,
    };

    await saveRawInteractionData(clonedChat);
    return clonedChat;
}

/**
 * Finds a specific message by its ID across all locations.
 * Returns the message and the locationId it belongs to.
 */
export function getMessageById(interactionData: InteractionData, messageId: string): { message: HistoryMessage; locationId: string } | undefined {
    for (const [locationId, messages] of Object.entries(interactionData.interactionHistories || {})) {
        const msg = messages.find(m => m.id === messageId);
        if (msg) {
            return { message: msg, locationId };
        }
    }
    return undefined;
}