// src/hooks/useMultiplayerDataManager.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import type { MultiplayerData } from '../types';
import { loadAllRawMultiplayerData, saveRawMultiplayerData, deleteRawMultiplayerData } from '../storages/serverStorage';
import { useSessionStore } from './useSessionStore';

export function useMultiplayerDataManager() {
    const [multiplayerData, setMultiplayerData] = useState<MultiplayerData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const isMountedRef = useRef(true);

    const loadAll = useCallback(async (): Promise<MultiplayerData[]> => {
        setIsLoading(true);
        try {
            const data = await loadAllRawMultiplayerData();
            if (isMountedRef.current) {
                setMultiplayerData(data);
            }
            return data;
        } catch (error) {
            console.error('Failed to load multiplayer data', error);
            return [];
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        loadAll();
        return () => {
            isMountedRef.current = false;
        };
    }, [loadAll]);

    const saveMultiplayerData = useCallback(async (data: MultiplayerData): Promise<boolean> => {
        try {
            await saveRawMultiplayerData(data);
            useSessionStore.setState({ multiplayerData: data });
            await loadAll();
            return true;
        } catch (error) {
            console.error('Failed to save multiplayer data', error);
            return false;
        }
    }, [loadAll]);

    const deleteMultiplayerData = useCallback(async (id: string): Promise<boolean> => {
        try {
            await deleteRawMultiplayerData(id);
            const current = useSessionStore.getState().multiplayerData;
            if (current?.id === id) {
                useSessionStore.setState({ multiplayerData: null });
            }
            await loadAll();
            return true;
        } catch (error) {
            console.error('Failed to delete multiplayer data', error);
            return false;
        }
    }, [loadAll]);

    /** Find the MultiplayerData that contains a given chat ID */
    const findByChatId = useCallback((chatId: string): MultiplayerData | null => {
        return multiplayerData.find(md => md.interactionDataIds.includes(chatId)) ?? null;
    }, [multiplayerData]);

    /** Load multiplayer data for a specific chat into the store */
    const loadForChat = useCallback(async (chatId: string): Promise<MultiplayerData | null> => {
        // Check if already loaded in store
        const current = useSessionStore.getState().multiplayerData;
        if (current?.interactionDataIds?.includes(chatId)) return current;

        // Search already-loaded list first
        const found = findByChatId(chatId);
        if (found) {
            useSessionStore.setState({ multiplayerData: found });
            return found;
        }

        // Reload fresh data from storage and inspect the result directly (avoids stale state closure)
        const freshData = await loadAll();
        const reloaded = freshData.find(md => md.interactionDataIds.includes(chatId)) ?? null;
        if (reloaded) {
            useSessionStore.setState({ multiplayerData: reloaded });
        }
        return reloaded;
    }, [findByChatId, loadAll]);

    return {
        multiplayerData,
        isLoading,
        saveMultiplayerData,
        deleteMultiplayerData,
        refresh: loadAll,
        findByChatId,
        loadForChat,
    };
}