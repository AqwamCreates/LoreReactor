// src/hooks/useChatListManager.ts
import { useState, useCallback, useRef } from 'react';
import type { InteractionData } from '../types';
import { loadAllRawInteractionDataShells, deleteRawInteractionData } from '../store/storage';

export function useChatListManager() {
    const [chats, setChats] = useState<InteractionData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const loadedRef = useRef(false);

    const loadChats = useCallback(async (force = false) => {
        if (!force && loadedRef.current) return;
        setIsLoading(true);
        try {
            const data = await loadAllRawInteractionDataShells();
            const sorted = data.sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp);
            setChats(sorted);
            loadedRef.current = true;
        } catch (error) {
            console.error("Failed to load chats", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const deleteChat = async (id: string) => {
        try {
            await deleteRawInteractionData(id);
            // After deletion, force reload to reflect changes
            await loadChats(true);
            return true;
        } catch (error) {
            console.error("Failed to delete chat", error);
            return false;
        }
    };

    // refresh always forces a reload (used after save/import/etc.)
    const refresh = useCallback(() => loadChats(true), [loadChats]);

    return { chats, isLoading, deleteChat, refresh, ensureLoaded: loadChats };
}