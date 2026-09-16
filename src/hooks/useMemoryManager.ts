// src/hooks/useMemoryManager.ts
import { useState } from 'react';
import type { Memory } from '../types';
import { loadAllRawMemories, saveRawMemory, deleteRawMemory } from '../storage/serverStorage';

export function useMemoryManager() {
    const [memories, setMemories] = useState<Memory[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadMemories = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawMemories();
            setMemories(data);
        } catch (error) {
            console.error("Failed to load memories", error);
        } finally {
            setIsLoading(false);
        }
    };

    const saveMemory = async (memory: Memory) => {
        try {
            await saveRawMemory(memory);
            await loadMemories();
            return true;
        } catch (error) {
            console.error("Failed to save memory", error);
            return false;
        }
    };

    const deleteMemory = async (id: string) => {
        try {
            await deleteRawMemory(id);
            await loadMemories();
            return true;
        } catch (error) {
            console.error("Failed to delete memory", error);
            return false;
        }
    };

    useState(() => { loadMemories() });

    return { memories, isLoading, saveMemory, deleteMemory, refresh: loadMemories };
}