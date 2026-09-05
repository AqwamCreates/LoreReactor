import { useState, useEffect } from 'react';
import type { StopPattern } from '../types';
import { loadAllRawStopPatterns, saveRawStopPattern, deleteRawStopPattern } from './storage';

export function useStopPatternManager() {
    const [stopPatterns, setStopPatterns] = useState<StopPattern[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadStopPatterns = async () => {
        setIsLoading(true);
        try {
        const data = await loadAllRawStopPatterns();
        setStopPatterns(data);
        } catch (err) {
        console.error("Failed to load stop patterns", err);
        } finally {
        setIsLoading(false);
        }
    };

    const saveStopPattern = async (pattern: StopPattern) => {
        try {
        await saveRawStopPattern(pattern);
        await loadStopPatterns();
        return true;
        } catch (err) {
        console.error("Failed to save stop pattern", err);
        return false;
        }
    };

    const deleteStopPattern = async (id: string) => {
        try {
        await deleteRawStopPattern(id);
        await loadStopPatterns();
        return true;
        } catch (err) {
        console.error("Failed to delete stop pattern", err);
        return false;
        }
    };

    useEffect(() => {
        loadStopPatterns();
    }, []);

    return { stopPatterns, isLoading, saveStopPattern, deleteStopPattern, refresh: loadStopPatterns };
}