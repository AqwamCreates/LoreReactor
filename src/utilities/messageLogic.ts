// src/utilities/messageLogic.ts
import { deleteRawMessage, saveRawInteractionData, loadAllRawInteractionDataShells } from '../storages/serverStorage';
import type { InteractionData, HistoryMessage, ChatMessage, Character } from '../types';
import { v4 as uuidv4 } from 'uuid';

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
                if (msg.messageType === 'interaction' && !msg.isPresent) break;
                
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
export async function clearPartialFlag(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const updatedHistories = { ...currentChat.interactionHistories };
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

    if (!found) return currentChat;

    const updatedChat = {
        ...currentChat,
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

    return {
        ...currentChat,
        interactionHistories: updatedHistories,
        lastUpdatedTimestamp: Date.now(),
    };
}

export async function editChatMessage(currentChat: InteractionData, messageId: string, newText: string): Promise<InteractionData> {
    const parentInteractionMessageIds = await getParentMessageIds(currentChat.id);

    if (parentInteractionMessageIds.has(messageId)) {
        throw new Error("Cannot edit: Other chat sessions branch from this message.");
    }

    const updatedHistories = { ...currentChat.interactionHistories };
    let found = false;

    for (const [locId, messages] of Object.entries(updatedHistories)) {
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            const msg = messages[index];
            if (msg.messageType === 'chat') {
                updatedHistories[locId] = [...messages];
                updatedHistories[locId][index] = { 
                    ...msg, 
                    textContent: newText, 
                    lastUpdatedTimestamp: Date.now() 
                } as ChatMessage;
            }
            found = true;
            break;
        }
    }

    if (!found) return currentChat;

    const updatedChat = {
        ...currentChat,
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
export async function massDeleteMessages(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const target = getMessageById(currentChat, messageId);
    if (!target) {
        throw new Error("Message not found.");
    }
    
    const locationId = target.locationId;
    const messages = currentChat.interactionHistories[locationId] || [];
    const deleteIndex = messages.findIndex(m => m.id === messageId);
    
    if (deleteIndex === -1) {
        throw new Error("Message not found in this location.");
    }

    const messagesToDelete = messages.slice(deleteIndex);
    const parentInteractionMessageIds = await getParentMessageIds(currentChat.id);

    for (const msg of messagesToDelete) {
        if (parentInteractionMessageIds.has(msg.id)) {
            throw new Error("Cannot delete: Other chats branch from this message.");
        }
    }

    await Promise.all(messagesToDelete.map(m => deleteRawMessage(m.id)));
    
    const updatedHistories = { ...currentChat.interactionHistories };
    updatedHistories[locationId] = messages.slice(0, deleteIndex);

    return {
        ...currentChat,
        interactionHistories: updatedHistories,
        lastUpdatedTimestamp: Date.now(),
    };
}

/**
 * Branches the chat at the target message.
 * Automatically resolves the locationId from the messageId.
 */
export async function branchMessage(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const target = getMessageById(currentChat, messageId);
    if (!target) {
        throw new Error("Message not found");
    }
    
    const locationId = target.locationId;
    const messages = currentChat.interactionHistories[locationId] || [];
    const branchIndex = messages.findIndex(m => m.id === messageId);
    
    if (branchIndex === -1) {
        throw new Error("Message not found in this location");
    }

    const branchedHistories: Record<string, HistoryMessage[]> = {};
    
    for (const [locId, msgs] of Object.entries(currentChat.interactionHistories)) {
        if (locId === locationId) {
            branchedHistories[locId] = msgs.slice(0, branchIndex + 1);
        } else {
            branchedHistories[locId] = [...msgs];
        }
    }

    const branchedChat: InteractionData = {
        ...currentChat,
        id: uuidv4(),
        name: `${currentChat.name} (Branch)`,
        interactionHistories: branchedHistories,
        parentInteractionDataId: currentChat.id,
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
export async function cloneChatUpToMessage(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const target = getMessageById(currentChat, messageId);
    if (!target) {
        throw new Error("Message not found");
    }
    
    const locationId = target.locationId;
    const messages = currentChat.interactionHistories[locationId] || [];
    const cloneIndex = messages.findIndex(m => m.id === messageId);
    
    if (cloneIndex === -1) {
        throw new Error("Message not found in this location");
    }

    const now = Date.now();
    const clonedHistories: Record<string, HistoryMessage[]> = {};

    for (const [locId, msgs] of Object.entries(currentChat.interactionHistories)) {
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
        name: `${currentChat.name} (Clone)`,
        protagonists: currentChat.protagonists.map(p => ({ ...p })),
        participants: currentChat.participants.map(p => ({ ...p })),
        contexts: (currentChat.contexts || []).map(c => ({ ...c })),
        locations: (currentChat.locations || []).map(l => ({ ...l })),
        audioTracks: (currentChat.audioTracks || []).map(a => ({ ...a })),
        interactionHistories: clonedHistories,
        Profile: currentChat.Profile,
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