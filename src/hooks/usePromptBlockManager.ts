// src/hooks/usePromptBlockManager.ts
import { useState, useEffect } from 'react';
import type { PromptBlock } from '../types';
import { loadAllRawPromptBlocks, saveRawPromptBlock, deleteRawPromptBlock } from '../storage/storage';

export function usePromptBlockManager() {
    const [promptBlocks, setPromptBlocks] = useState<PromptBlock[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadPromptBlocks = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawPromptBlocks();
            setPromptBlocks(data);
        } catch (error) {
            console.error("Failed to load prompt blocks", error);
        } finally {
            setIsLoading(false);
        }
    };

    const savePromptBlock = async (block: PromptBlock) => {
        try {
            await saveRawPromptBlock(block);
            await loadPromptBlocks();
            return true;
        } catch (error) {
            console.error("Failed to save prompt block", error);
            return false;
        }
    };

    const deletePromptBlock = async (id: string) => {
        try {
            await deleteRawPromptBlock(id);
            await loadPromptBlocks();
            return true;
        } catch (error) {
            console.error("Failed to delete prompt block", error);
            return false;
        }
    };

    useEffect(() => {
        loadPromptBlocks();
    }, []);

    return { promptBlocks, isLoading, savePromptBlock, deletePromptBlock, refresh: loadPromptBlocks };
}