// frontend_src/hooks/useChatListManager.ts
import { useState, useCallback, useRef } from 'react';
import type { RawInteractionData } from '../types';
import { loadAllRawInteractionDataShells, deleteRawInteractionData } from '../storages/serverStorage';

// Minimum time the loading bar stays visible to prevent jarring visual flickers on fast fetches
const MIN_LOADING_MS = 400; 

export function useChatListManager() {
    const [rawChatShells, setRawChatShells] = useState<RawInteractionData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const loadedRef = useRef(false);

    const loadChats = useCallback(async (force = false) => {
        if (!force && loadedRef.current) return;
        
        setIsLoading(true);
        const startTime = Date.now();
        
        try {
            const rawShells = await loadAllRawInteractionDataShells();
            const sorted = [...rawShells].sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp);
            setRawChatShells(sorted);
            loadedRef.current = true;
        } catch (error) {
            console.error("Failed to load chats", error);
        } finally {
            const elapsed = Date.now() - startTime;
            if (elapsed < MIN_LOADING_MS) {
                await new Promise(resolve => setTimeout(resolve, MIN_LOADING_MS - elapsed));
            }
            setIsLoading(false);
        }
    }, []);

    const deleteChat = useCallback(async (id: string) => {
        try {
            await deleteRawInteractionData(id);
            await loadChats(true);
            return true;
        } catch (error) {
            console.error("Failed to delete chat", error);
            return false;
        }
    }, [loadChats]);

    const refresh = useCallback(() => loadChats(true), [loadChats]);

    return { 
        rawChatShells, 
        isLoading, 
        deleteChat, 
        refresh, 
        ensureLoaded: loadChats 
    };
}