import { useState, useEffect } from 'react';
import type { StopPattern } from '../types';
import { loadAllRawStopPatterns, saveRawStopPattern, deleteRawStopPattern } from '../storage/storage';

export function useStopPatternManager() {
    const [stopPatterns, setStopPatterns] = useState<StopPattern[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadStopPatterns = async () => {
        setIsLoading(true);
        try {
        const data = await loadAllRawStopPatterns();
        setStopPatterns(data);
        } catch (error) {
        console.error("Failed to load stop patterns", error);
        } finally {
        setIsLoading(false);
        }
    };

    const saveStopPattern = async (pattern: StopPattern) => {
        try {
        await saveRawStopPattern(pattern);
        await loadStopPatterns();
        return true;
        } catch (error) {
        console.error("Failed to save stop pattern", error);
        return false;
        }
    };

    const deleteStopPattern = async (id: string) => {
        try {
        await deleteRawStopPattern(id);
        await loadStopPatterns();
        return true;
        } catch (error) {
        console.error("Failed to delete stop pattern", error);
        return false;
        }
    };

    useEffect(() => {
        loadStopPatterns();
    }, []);

    return { stopPatterns, isLoading, saveStopPattern, deleteStopPattern, refresh: loadStopPatterns };
}