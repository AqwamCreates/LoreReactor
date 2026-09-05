// src/hooks/messageLogic.ts

import { v4 as uuidv4 } from 'uuid';
import { loadAllRawChatData, saveRawChatData, deleteRawChatMessage } from '../../infrastructure';
import type { ChatData } from '../../types';
import { editChatMessageInChatData } from './chatService';

// ✅ Helper: Returns a Set of all Message IDs in this chat that are branch points for OTHER chats
async function getParentChatMessageIds(chatId: string): Promise<Set<string>> {
    const allChats = await loadAllRawChatData();
    const points = new Set<string>();
    
    for (const c of allChats) {
        if (c && c.parentChatDataId === chatId && c.parentChatMessageId) {
            points.add(c.parentChatMessageId);
        }
    }
    return points;
}

export async function markLastMessageAsPartial(currentChat: ChatData): Promise<ChatData> {
    const history = currentChat.chatMessageHistory;
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
        chatMessageHistory: updatedHistory,
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawChatData(updatedChat);
    return updatedChat;
}

/**
 * ✅ Clears the partial flag on a message after successful resume completion.
 */
export async function clearPartialFlag(currentChat: ChatData, messageId: string): Promise<ChatData> {
    const index = currentChat.chatMessageHistory.findIndex(m => m.id === messageId);
    if (index === -1) return currentChat;

    const msg = currentChat.chatMessageHistory[index];
    if (!msg.isPartial) return currentChat;

    const updatedHistory = [...currentChat.chatMessageHistory];
    updatedHistory[index] = { ...msg, isPartial: false };

    const updatedChat = {
        ...currentChat,
        chatMessageHistory: updatedHistory,
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawChatData(updatedChat);
    return updatedChat;
}

export async function deleteMessage(currentChat: ChatData, messageId: string): Promise<ChatData> {
    const parentChatMessageIds = await getParentChatMessageIds(currentChat.id);
    
    if (parentChatMessageIds.has(messageId)) {
        throw new Error("Cannot delete: Other chat sessions branch from this message.");
    }

    await deleteRawChatMessage(messageId);
    const { newHistory } = calculateDelete(currentChat, messageId);
    
    return {
        ...currentChat,
        chatMessageHistory: newHistory,
        lastUpdatedTimestamp: Date.now(),
    };
}

export async function editMessage(currentChat: ChatData, messageId: string, newText: string): Promise<ChatData> {
    const parentChatMessageIds = await getParentChatMessageIds(currentChat.id);

    if (parentChatMessageIds.has(messageId)) {
        throw new Error("Cannot edit: Other chat sessions branch from this message.");
    }

    const updatedChatData = editChatMessageInChatData(currentChat, messageId, newText);
    await saveRawChatData(updatedChatData);
    return updatedChatData;
}

export async function massDeleteMessages(currentChat: ChatData, startIndex: number): Promise<ChatData> {
    const messagesToDelete = currentChat.chatMessageHistory.slice(startIndex);
    const parentChatMessageIds = await getParentChatMessageIds(currentChat.id);

    for (const msg of messagesToDelete) {
        if (parentChatMessageIds.has(msg.id)) {
            throw new Error("Cannot delete: Other chats branch from this message.");
        }
    }

    await Promise.all(messagesToDelete.map(m => deleteRawChatMessage(m.id)));
    const newHistory = currentChat.chatMessageHistory.slice(0, startIndex);
    
    return {
        ...currentChat,
        chatMessageHistory: newHistory,
        lastUpdatedTimestamp: Date.now(),
    };
}

export async function branchMessage(currentChat: ChatData, messageId: string): Promise<ChatData> {
    const branchIndex = currentChat.chatMessageHistory.findIndex(m => m.id === messageId);
    if (branchIndex === -1) {
        throw new Error("Message not found");
    }

    const branchedChat: ChatData = {
        ...currentChat,
        id: uuidv4(),
        name: `${currentChat.name} (Branch)`,
        contexts: [...(currentChat.contexts || [])],
        participants: [...currentChat.participants],
        protagonist: currentChat.protagonist,
        chatMessageHistory: currentChat.chatMessageHistory.slice(0, branchIndex + 1),
        parentChatDataId: currentChat.id,
        parentChatMessageId: messageId,
        Profile: currentChat.Profile, // ✅ Preserve active profile
        firstCreatedTimestamp: Date.now(),
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawChatData(branchedChat);
    
    return branchedChat;
}

// ✅ Clone creates an independent copy with NO parent link
// Unlike branch, clone is a fully standalone chat that doesn't remember its origin
export async function cloneChatUpToMessage(currentChat: ChatData, messageId: string): Promise<ChatData> {
    const cloneIndex = currentChat.chatMessageHistory.findIndex(m => m.id === messageId);
    if (cloneIndex === -1) {
        throw new Error("Message not found");
    }

    const now = Date.now();

    // Deep clone messages so they get new IDs and don't share references
    const clonedMessages = currentChat.chatMessageHistory.slice(0, cloneIndex + 1).map(msg => ({
        ...msg,
        id: uuidv4(),
        character: { ...msg.character },
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentChatMessageId: null, // No parent linkage
    }));

    const clonedChat: ChatData = {
        id: uuidv4(),
        name: `${currentChat.name} (Clone)`,
        protagonist: { ...currentChat.protagonist },
        participants: currentChat.participants.map(p => ({ ...p })),
        contexts: (currentChat.contexts || []).map(c => ({ ...c })),
        chatMessageHistory: clonedMessages,
        Profile: currentChat.Profile, // ✅ Preserve active profile
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentChatDataId: null,   // ✅ No parent — fully independent
        parentChatMessageId: null, // ✅ No branch point — fully independent
    };

    await saveRawChatData(clonedChat);

    return clonedChat;
}