import { useState, useEffect, useCallback } from 'react';
import type { World } from '../types';
import { loadAllRawWorlds, saveRawWorld, deleteRawWorld } from '../storage/serverStorage';
import { v4 as uuidv4 } from 'uuid';

export function useWorldManager() {
    const [worlds, setWorlds] = useState<World[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        try { setWorlds(await loadAllRawWorlds()); }
        catch (e) { console.error('Failed to load worlds:', e); }
        finally { setIsLoading(false); }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const saveWorld = useCallback(async (world: World): Promise<boolean> => {
        try { await saveRawWorld(world); await refresh(); return true; }
        catch (e) { console.error('Failed to save world:', e); return false; }
    }, [refresh]);

    const deleteWorld = useCallback(async (id: string): Promise<boolean> => {
        try { await deleteRawWorld(id); await refresh(); return true; }
        catch (e) { console.error('Failed to delete world:', e); return false; }
    }, [refresh]);

    const createWorld = useCallback(async (name: string): Promise<World | null> => {
        const now = Date.now();
        const world: World = {
            id: uuidv4(), name, description: '',
            characterIds: [], contextIds: [], locationIds: [], audioTrackIds: [],
            promptBlockIds: [],
            firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
        };
        return await saveWorld(world) ? world : null;
    }, [saveWorld]);

    const snapshotFromChat = useCallback(async (
        name: string, characterIds: string[], contextIds: string[],
        locationIds: string[], audioTrackIds: string[], promptBlockIds: string[], profileId?: string, 
    ): Promise<World | null> => {
        const now = Date.now();
        const world: World = {
            id: uuidv4(), name, description: 'Snapshot from chat',
            characterIds: [...characterIds], contextIds: [...contextIds],
            locationIds: [...locationIds], audioTrackIds: [...audioTrackIds],
            promptBlockIds: [...promptBlockIds],
            profileId,
            firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
        };
        return await saveWorld(world) ? world : null;
    }, [saveWorld]);

    return { worlds, isLoading, refresh, saveWorld, deleteWorld, createWorld, snapshotFromChat };
}