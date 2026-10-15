// src/frontend_src/hooks/useEntityFolderManager.ts
import { useState } from 'react';
import type { EntityFolder } from '../types';
import { loadAllRawEntityFolders, saveRawEntityFolder, deleteRawEntityFolder } from '../storages/serverStorage';

export function useEntityFolderManager() {
    const [entityFolders, setEntityFolders] = useState<EntityFolder[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadFolders = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawEntityFolders();
            setEntityFolders(data as EntityFolder[]);
        } catch (error) {
            console.error("Failed to load entity folders", error);
        } finally {
            setIsLoading(false);
        }
    };

    useState(() => { loadFolders(); });

    const saveFolder = async (folder: EntityFolder) => {
        try {
            await saveRawEntityFolder(folder);
            await loadFolders();
            return true;
        } catch (error) {
            console.error("Failed to save entity folder", error);
            return false;
        }
    };

    const deleteFolder = async (id: string) => {
        try {
            await deleteRawEntityFolder(id);
            await loadFolders();
            return true;
        } catch (error) {
            console.error("Failed to delete entity folder", error);
            return false;
        }
    };

    return { entityFolders, isLoading, saveFolder, deleteFolder, refresh: loadFolders };
}