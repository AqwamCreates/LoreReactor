// src/hooks/useMultiplayerDataManager.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import type { MultiplayerData } from '../types';
import { loadAllRawMultiplayerData, saveRawMultiplayerData, deleteRawMultiplayerData } from '../storages/serverStorage';
import { useSessionStore } from './useSessionStore';

export function useMultiplayerDataManager() {
    const [multiplayerData, setMultiplayerData] = useState<MultiplayerData[]>([]);
    // Initialize as true on mount so we never need a synchronous setIsLoading(true) inside an effect
    const [isLoading, setIsLoading] = useState(true);
    const isMountedRef = useRef(true);

    // Initial mount effect: fetches asynchronously without synchronous setState in effect body
    useEffect(() => {
        isMountedRef.current = true;
        let isIgnored = false;

        loadAllRawMultiplayerData()
            .then((data) => {
                if (!isIgnored) {
                    setMultiplayerData(data);
                    setIsLoading(false);
                }
            })
            .catch((error) => {
                console.error('Failed to load multiplayer data on mount:', error);
                if (!isIgnored) {
                    setIsLoading(false);
                }
            });

        return () => {
            isIgnored = true;
            isMountedRef.current = false;
        };
    }, []);

    // Imperative loader for user actions (refresh, save, delete, chat switch)
    const loadAll = useCallback(async (): Promise<MultiplayerData[]> => {
        setIsLoading(true);
        try {
            const data = await loadAllRawMultiplayerData();
            if (isMountedRef.current) {
                setMultiplayerData(data);
            }
            return data;
        } catch (error) {
            console.error('Failed to reload multiplayer data:', error);
            return [];
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    const saveMultiplayerData = useCallback(async (data: MultiplayerData): Promise<boolean> => {
        try {
            await saveRawMultiplayerData(data);
            useSessionStore.setState({ multiplayerData: data });
            await loadAll();
            return true;
        } catch (error) {
            console.error('Failed to save multiplayer data:', error);
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
            console.error('Failed to delete multiplayer data:', error);
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