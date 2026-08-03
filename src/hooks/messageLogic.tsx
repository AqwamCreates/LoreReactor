// src/hooks/messageLogic.ts
import { deleteRawChatMessage, saveRawChatData, loadAllRawChatData } from './storage';
import { deleteChatMessage as calculateDelete, editChatMessageInChatData } from './chatLogic';
import type { ChatData } from '../types';

// ✅ Helper: Returns a Set of all Message IDs in this chat that are branch points for OTHER chats
async function getParentChatMessageIds(chatId: string): Promise<Set<string>> {
    const allChats = await loadAllRawChatData();
    const points = new Set<string>();
    
    for (const c of allChats) {
        // If another chat branches FROM this chatId AT a specific message
        if (c && c.parentChatDataId === chatId && c.parentChatMessageId) {
            points.add(c.parentChatMessageId);
        }
    }
    return points;
}

export async function deleteMessage(currentChat: ChatData, messageId: string): Promise<ChatData> {
    const parentChatMessageIds = await getParentChatMessageIds(currentChat.id);
    
    // ✅ Safety: Prevent deleting if this message is a branch point
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

    // ✅ Safety: Prevent editing if this message is a branch point
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
    // Find the branch point
    const branchIndex = currentChat.chatMessageHistory.findIndex(m => m.id === messageId);
    if (branchIndex === -1) {
        throw new Error("Message not found");
    }

    // Create a deep copy of the chat data up to the branch point
    const branchedChat: ChatData = {
        ...currentChat,
        id: crypto.randomUUID(), // New ID for the branch
        name: `${currentChat.name} (Branch)`,
        // ✅ Copy all contexts and participants from the source
        contexts: [...(currentChat.contexts || [])],
        participants: [...currentChat.participants],
        protagonist: currentChat.protagonist,
        // ✅ Only keep messages up to the branch point
        chatMessageHistory: currentChat.chatMessageHistory.slice(0, branchIndex + 1),
        parentChatDataId: currentChat.id,
        parentChatMessageId: messageId,
        firstCreatedTimestamp: Date.now(),
        lastUpdatedTimestamp: Date.now(),
    };

    // Save the new branch chat
    await saveRawChatData(branchedChat);
    
    return branchedChat;
}