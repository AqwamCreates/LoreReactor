// src/frontend_src/hooks/useInteractionDataManager.ts
import { useState, useCallback, useRef } from 'react';
import type { RawInteractionData, InteractionData } from '../types';
import { loadAllRawInteractionDataShells, deleteRawInteractionData, saveRawInteractionData } from '../storages/serverStorage';

// Minimum time the loading bar stays visible to prevent jarring visual flickers on fast fetches
const MIN_LOADING_MS = 400; 

export function useInteractionDataManager() {
    const [allRawInteractionDataShells, setAllRawInteractionDataShells] = useState<RawInteractionData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const loadedRef = useRef(false);

    const loadInteractionDatas = useCallback(async (force = false) => {
        if (!force && loadedRef.current) return;
        
        setIsLoading(true);
        const startTime = Date.now();
        
        try {
            const rawShells = await loadAllRawInteractionDataShells();
            const sorted = [...rawShells].sort((a, b) => (b.lastUpdatedTimestamp ?? 0) - (a.lastUpdatedTimestamp ?? 0));
            setAllRawInteractionDataShells(sorted);
            loadedRef.current = true;
        } catch (error) {
            console.error("Failed to load interaction data", error);
        } finally {
            const elapsed = Date.now() - startTime;
            if (elapsed < MIN_LOADING_MS) {
                await new Promise(resolve => setTimeout(resolve, MIN_LOADING_MS - elapsed));
            }
            setIsLoading(false);
        }
    }, []);

    // ✅ ENCAPSULATED SAVE (Mirrors saveFolder in useEntityFolderManager)
    const saveInteractionData = useCallback(async (data: InteractionData) => {
        try {
            await saveRawInteractionData(data);
            await loadInteractionDatas(true);
            return true;
        } catch (error) {
            console.error("Failed to save interaction data", error);
            return false;
        }
    }, [loadInteractionDatas]);

    const deleteInteractionData = useCallback(async (id: string) => {
        try {
            await deleteRawInteractionData(id);
            await loadInteractionDatas(true);
            return true;
        } catch (error) {
            console.error("Failed to delete interaction data", error);
            return false;
        }
    }, [loadInteractionDatas]);

    const refresh = useCallback(() => loadInteractionDatas(true), [loadInteractionDatas]);

    return { 
        allRawInteractionDataShells, 
        isLoading, 
        saveInteractionData, // ✅ EXPORTED
        deleteInteractionData, 
        refresh, 
        load: loadInteractionDatas 
    };
}