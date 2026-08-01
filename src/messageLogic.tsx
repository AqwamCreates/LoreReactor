import { deleteRawChatMessage, saveRawChatData } from './storage';
import { deleteChatMessage, editChatMessageInChatData, branchChatMessage } from './chatLogic';
import type { ChatData } from './types';

export async function deleteMessage(currentChat: ChatData, messageId: string): Promise<ChatData> {
    await deleteRawChatMessage(messageId);
    const { newHistory } = deleteChatMessage(currentChat, messageId);
    
    return {
        ...currentChat,
        chatMessageHistory: newHistory,
        last_updated_timestamp: Date.now(),
    };
}

export async function massDeleteMessages(currentChat: ChatData, startIndex: number): Promise<ChatData> {
    const messagesToDelete = currentChat.chatMessageHistory.slice(startIndex);
    await Promise.all(messagesToDelete.map(message => deleteRawChatMessage(message.id)));
    
    const newHistory = currentChat.chatMessageHistory.slice(0, startIndex);
    
    return {
        ...currentChat,
        chatMessageHistory: newHistory,
        last_updated_timestamp: Date.now(),
    };
}

export async function editMessage(currentChat: ChatData, messageId: string, newText: string): Promise<ChatData> {
    const updatedChatData = editChatMessageInChatData(currentChat, messageId, newText);
    await saveRawChatData(updatedChatData);
    return updatedChatData;
}

export async function branchMessage(currentChat: ChatData, messageId: string): Promise<ChatData> {
    const branchedChat = branchChatMessage(currentChat, messageId);
    await saveRawChatData(branchedChat);
    return branchedChat;
}