// src/hooks/messageLogic.ts
import { deleteRawInteractionMessage, saveRawInteractionData, loadAllRawInteractionDataShells } from './storage';
import { deleteInteractionMessage as calculateDelete, editInteractionMessageInInteractionData } from './chatLogic';
import type { InteractionData } from '../types';
import { v4 as uuidv4 } from 'uuid';

// ✅ Helper: Returns a Set of all Message IDs in this chat that are branch points for OTHER chats
async function getParentInteractionMessageIds(chatId: string): Promise<Set<string>> {
    const allChats = await loadAllRawInteractionDataShells();
    const points = new Set<string>();
    
    for (const c of allChats) {
        if (c && c.parentInteractionDataId === chatId && c.parentInteractionMessageId) {
            points.add(c.parentInteractionMessageId);
        }
    }
    return points;
}

export async function markLastMessageAsPartial(currentChat: InteractionData): Promise<InteractionData> {
    const history = currentChat.interactionHistory;
    if (history.length === 0) return currentChat;

    const lastIndex = history.length - 1;
    const lastMsg = history[lastIndex];

    // Only mark AI messages (not user messages) as partial
    if (lastMsg.character.id === currentChat.protagonist.id) return currentChat;
    if (lastMsg.isPartial) return currentChat; // Already marked

    const updatedHistory = [...history];
    updatedHistory[lastIndex] = { ...lastMsg, isPartial: true };

    const updatedChat = {
        ...currentChat,
        interactionHistory: updatedHistory,
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawInteractionData(updatedChat);
    return updatedChat;
}

/**
 * ✅ Clears the partial flag on a message after successful resume completion.
 */
export async function clearPartialFlag(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const index = currentChat.interactionHistory.findIndex(m => m.id === messageId);
    if (index === -1) return currentChat;

    const msg = currentChat.interactionHistory[index];
    if (!msg.isPartial) return currentChat;

    const updatedHistory = [...currentChat.interactionHistory];
    updatedHistory[index] = { ...msg, isPartial: false };

    const updatedChat = {
        ...currentChat,
        interactionHistory: updatedHistory,
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawInteractionData(updatedChat);
    return updatedChat;
}

export async function deleteMessage(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const parentInteractionMessageIds = await getParentInteractionMessageIds(currentChat.id);
    
    if (parentInteractionMessageIds.has(messageId)) {
        throw new Error("Cannot delete: Other chat sessions branch from this message.");
    }

    await deleteRawInteractionMessage(messageId);
    const { newHistory } = calculateDelete(currentChat, messageId);
    
    return {
        ...currentChat,
        interactionHistory: newHistory,
        lastUpdatedTimestamp: Date.now(),
    };
}

export async function editMessage(currentChat: InteractionData, messageId: string, newText: string): Promise<InteractionData> {
    const parentInteractionMessageIds = await getParentInteractionMessageIds(currentChat.id);

    if (parentInteractionMessageIds.has(messageId)) {
        throw new Error("Cannot edit: Other chat sessions branch from this message.");
    }

    const updatedInteractionData = editInteractionMessageInInteractionData(currentChat, messageId, newText);
    await saveRawInteractionData(updatedInteractionData);
    return updatedInteractionData;
}

export async function massDeleteMessages(currentChat: InteractionData, startIndex: number): Promise<InteractionData> {
    const messagesToDelete = currentChat.interactionHistory.slice(startIndex);
    const parentInteractionMessageIds = await getParentInteractionMessageIds(currentChat.id);

    for (const msg of messagesToDelete) {
        if (parentInteractionMessageIds.has(msg.id)) {
            throw new Error("Cannot delete: Other chats branch from this message.");
        }
    }

    await Promise.all(messagesToDelete.map(m => deleteRawInteractionMessage(m.id)));
    const newHistory = currentChat.interactionHistory.slice(0, startIndex);
    
    return {
        ...currentChat,
        interactionHistory: newHistory,
        lastUpdatedTimestamp: Date.now(),
    };
}

export async function branchMessage(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const branchIndex = currentChat.interactionHistory.findIndex(m => m.id === messageId);
    if (branchIndex === -1) {
        throw new Error("Message not found");
    }

    const branchedChat: InteractionData = {
        ...currentChat,
        id: uuidv4(),
        name: `${currentChat.name} (Branch)`,
        contexts: [...(currentChat.contexts || [])],
        participants: [...currentChat.participants],
        protagonist: currentChat.protagonist,
        interactionHistory: currentChat.interactionHistory.slice(0, branchIndex + 1),
        parentInteractionDataId: currentChat.id,
        parentInteractionMessageId: messageId,
        Profile: currentChat.Profile, // ✅ Preserve active profile
        firstCreatedTimestamp: Date.now(),
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawInteractionData(branchedChat);
    
    return branchedChat;
}

// ✅ Clone creates an independent copy with NO parent link
// Unlike branch, clone is a fully standalone chat that doesn't remember its origin
export async function cloneChatUpToMessage(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const cloneIndex = currentChat.interactionHistory.findIndex(m => m.id === messageId);
    if (cloneIndex === -1) {
        throw new Error("Message not found");
    }

    const now = Date.now();

    // Deep clone messages so they get new IDs and don't share references
    const clonedMessages = currentChat.interactionHistory.slice(0, cloneIndex + 1).map(msg => ({
        ...msg,
        id: uuidv4(),
        character: { ...msg.character },
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentInteractionMessageId: null, // No parent linkage
    }));

    const clonedChat: InteractionData = {
        id: uuidv4(),
        name: `${currentChat.name} (Clone)`,
        protagonist: { ...currentChat.protagonist },
        participants: currentChat.participants.map(p => ({ ...p })),
        contexts: (currentChat.contexts || []).map(c => ({ ...c })),
        interactionHistory: clonedMessages,
        Profile: currentChat.Profile, // ✅ Preserve active profile
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentInteractionDataId: null,   // ✅ No parent — fully independent
        parentInteractionMessageId: null, // ✅ No branch point — fully independent
    };

    await saveRawInteractionData(clonedChat);

    return clonedChat;
}