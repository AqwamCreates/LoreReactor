// src/hooks/useChatListManager.ts
import { useState, useEffect } from 'react';
import type { ChatData } from '../types';
import { loadAllRawChatData, deleteRawChatData } from './storage';

export function useChatListManager() {
    const [chats, setChats] = useState<ChatData[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadChats = async () => {
        setIsLoading(true);
        try {
        const data = await loadAllRawChatData();
        // Sort by newest first
        const sorted = data.sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp);
        setChats(sorted);
        } catch (err) {
        console.error("Failed to load chats", err);
        } finally {
        setIsLoading(false);
        }
    };

    const deleteChat = async (id: string) => {
        try {
        await deleteRawChatData(id);
        await loadChats(); // Refresh list after deletion
        return true;
        } catch (err) {
        console.error("Failed to delete chat", err);
        return false;
        }
    };

    useEffect(() => {
        loadChats();
    }, []);

    return { chats, isLoading, deleteChat, refresh: loadChats };
}