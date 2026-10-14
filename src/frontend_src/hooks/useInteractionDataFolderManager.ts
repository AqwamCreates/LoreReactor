// src/frontend_src/hooks/useInteractionDataFolderManager.ts
import { useState } from 'react';
import type { InteractionDataFolder } from '../types';
import { loadAllRawInteractionDataFolders, saveRawInteractionDataFolder, deleteRawInteractionDataFolder } from '../storages/serverStorage';

export function useInteractionDataFolderManager() {
    const [interactionDataFolders, setInteractionDataFolders] = useState<InteractionDataFolder[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadFolders = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawInteractionDataFolders();
            setInteractionDataFolders(data);
        } catch (error) {
            console.error("Failed to load interaction data folders", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Load on mount without useEffect
    useState(() => { loadFolders(); });

    const saveFolder = async (folder: InteractionDataFolder) => {
        try {
            await saveRawInteractionDataFolder(folder);
            await loadFolders();
            return true;
        } catch (error) {
            console.error("Failed to save interaction data folder", error);
            return false;
        }
    };

    const deleteFolder = async (id: string) => {
        try {
            await deleteRawInteractionDataFolder(id);
            await loadFolders();
            return true;
        } catch (error) {
            console.error("Failed to delete interaction data folder", error);
            return false;
        }
    };

    return { interactionDataFolders, isLoading, saveFolder, deleteFolder, refresh: loadFolders };
}