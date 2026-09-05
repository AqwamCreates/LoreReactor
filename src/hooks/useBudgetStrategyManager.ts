import { useState, useEffect } from 'react';
import type { BudgetStrategy } from '../types';
import { loadAllRawBudgetStrategies, saveRawBudgetStrategy, deleteRawBudgetStrategy } from './storage';

export function useBudgetStrategyManager() {
    const [strategies, setStrategies] = useState<BudgetStrategy[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadStrategies = async () => {
        setIsLoading(true);
        try {
        const data = await loadAllRawBudgetStrategies();
        setStrategies(data);
        } catch (err) {
        console.error("Failed to load budget strategies", err);
        } finally {
        setIsLoading(false);
        }
    };

    const saveStrategy = async (strategy: BudgetStrategy) => {
        try {
        await saveRawBudgetStrategy(strategy);
        await loadStrategies();
        return true;
        } catch (err) {
        console.error("Failed to save budget strategy", err);
        return false;
        }
    };

    const deleteStrategy = async (id: string) => {
        try {
        await deleteRawBudgetStrategy(id);
        await loadStrategies();
        return true;
        } catch (err) {
        console.error("Failed to delete budget strategy", err);
        return false;
        }
    };

    useEffect(() => {
        loadStrategies();
    }, []);

    return { strategies, isLoading, saveStrategy, deleteStrategy, refresh: loadStrategies };
}