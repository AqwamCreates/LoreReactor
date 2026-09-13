// src/hooks/useChatListManager.ts
import { useState, useCallback, useRef } from 'react';
import type { RawInteractionData } from '../types';
import { loadAllRawInteractionDataShells, deleteRawInteractionData } from '../storage/serverStorage';

export function useChatListManager() {
    const [rawChatShells, setRawChatShells] = useState<RawInteractionData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const loadedRef = useRef(false);

    const loadChats = useCallback(async (force = false) => {
        if (!force && loadedRef.current) return;
        setIsLoading(true);
        try {
            const rawShells = await loadAllRawInteractionDataShells();
            const sorted = [...rawShells].sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp);
            setRawChatShells(sorted);
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
            await loadChats(true);
            return true;
        } catch (error) {
            console.error("Failed to delete chat", error);
            return false;
        }
    };

    const refresh = useCallback(() => loadChats(true), [loadChats]);

    return { rawChatShells, isLoading, deleteChat, refresh, ensureLoaded: loadChats };
}