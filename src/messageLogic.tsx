import { deleteRawChatMessage, loadAllRawChatData, saveRawChatData } from './storage';
import { deleteChatMessage, editChatMessageInChatData, branchChatMessage } from './chatLogic';
import type { ChatData } from './types';

async function isMessageABranchPoint(chatId: string, messageId: string): Promise<boolean> {
    const allChats = await loadAllRawChatData();
    // Check if any OTHER chat has this chatId as parent AND this messageId as branch point
    return allChats.some(c => 
        c !== null && 
        c.parentChatDataId === chatId && 
        c.parentChatMessageId === messageId
    );
}

export async function deleteMessage(currentChat: ChatData, messageId: string): Promise<ChatData> {
    // ✅ SAFETY CHECK: Prevent deleting branch points
    const isBranchPoint = await isMessageABranchPoint(currentChat.id, messageId);
    if (isBranchPoint) {
        throw new Error("Cannot delete this message: Other chat sessions branch from here.");
        // Or optionally: return currentChat without deleting, and show a toast in UI
    }

    await deleteRawChatMessage(messageId);
    const { newHistory } = deleteChatMessage(currentChat, messageId);
    
    return {
        ...currentChat,
        chatMessageHistory: newHistory,
        last_updated_timestamp: Date.now(),
    };
}

// ... (massDeleteMessages needs similar logic: iterate and check each message)
export async function massDeleteMessages(currentChat: ChatData, startIndex: number): Promise<ChatData> {
    const messagesToDelete = currentChat.chatMessageHistory.slice(startIndex);
    
    // ✅ Check ALL messages in range
    for (const msg of messagesToDelete) {
        if (await isMessageABranchPoint(currentChat.id, msg.id)) {
            throw new Error(`Cannot delete message "${msg.textContent.substring(0, 20)}...": Other chats branch from here.`);
        }
    }

    await Promise.all(messagesToDelete.map(m => deleteRawChatMessage(m.id)));
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
    
    // ✅ Set the lineage metadata
    branchedChat.parentChatDataId = currentChat.id;
    branchedChat.parentChatMessageId = messageId;
    
    await saveRawChatData(branchedChat);
    return branchedChat;
}