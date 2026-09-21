// src/hooks/useMultiplayerDataManager.ts
import { useState, useCallback } from 'react';
import type { MultiplayerData } from '../types';
import { loadAllRawMultiplayerData, saveRawMultiplayerData, deleteRawMultiplayerData } from '../storage/serverStorage';
import { useSessionStore } from './useSessionStore';

export function useMultiplayerDataManager() {
    const [multiplayerDataList, setMultiplayerDataList] = useState<MultiplayerData[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawMultiplayerData();
            setMultiplayerDataList(data);
        } catch (error) {
            console.error('Failed to load multiplayer data', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const save = useCallback(async (data: MultiplayerData) => {
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

    const remove = useCallback(async (id: string) => {
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
        return multiplayerDataList.find(md => md.interactionDataIds.includes(chatId)) ?? null;
    }, [multiplayerDataList]);

    /** Load multiplayer data for a specific chat into the store */
    const loadForChat = useCallback(async (chatId: string) => {
        // Check if already loaded in store
        const current = useSessionStore.getState().multiplayerData;
        if (current?.interactionDataIds?.includes(chatId)) return current;

        // Search already-loaded list first
        const found = findByChatId(chatId);
        if (found) {
            useSessionStore.setState({ multiplayerData: found });
            return found;
        }

        // Full reload if not found in cached list
        await loadAll();
        const reloaded = multiplayerDataList.find(md => md.interactionDataIds.includes(chatId)) ?? null;
        if (reloaded) {
            useSessionStore.setState({ multiplayerData: reloaded });
        }
        return reloaded;
    }, [findByChatId, loadAll, multiplayerDataList]);

    useState(() => { loadAll(); });

    return {
        multiplayerDataList,
        isLoading,
        save,
        delete: remove,
        refresh: loadAll,
        findByChatId,
        loadForChat,
    };
}