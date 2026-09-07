// src/hooks/useBudgetDataManager.ts
import { useState, useEffect, useCallback } from 'react';
import type { BudgetData } from '../types';
import { loadRawBudgetData, saveRawBudgetData } from './storage';

export function useBudgetDataManager() {
    const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await loadRawBudgetData();
            setBudgetData(data);
        } catch (err) {
            console.error('Failed to load budget data:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const updateBudgetData = useCallback(async (updater: (data: BudgetData) => BudgetData): Promise<boolean> => {
        if (!budgetData) return false;
        try {
            const updated = updater(budgetData);
            await saveRawBudgetData(updated);
            setBudgetData(updated);
            return true;
        } catch (err) {
            console.error('Failed to update budget data:', err);
            return false;
        }
    }, [budgetData]);

    const resetBudget = useCallback(async (): Promise<boolean> => {
        if (!budgetData) return false;
        try {
            const now = Date.now();
            const updated: BudgetData = {
                ...budgetData,
                budgetSpent: 0,
                modelLastQuotaHitTimeStamps: {},
                modelLastErrorHitTimeStamps: {},
                lastResetTimestamp: now,
                lastUpdatedTimestamp: now,
            };
            await saveRawBudgetData(updated);
            setBudgetData(updated);
            return true;
        } catch (err) {
            console.error('Failed to reset budget data:', err);
            return false;
        }
    }, [budgetData]);

    const setResetDuration = useCallback(async (durationMs: number): Promise<boolean> => {
        if (!budgetData) return false;
        try {
            const updated: BudgetData = {
                ...budgetData,
                resetDuration: durationMs,
                lastUpdatedTimestamp: Date.now(),
            };
            await saveRawBudgetData(updated);
            setBudgetData(updated);
            return true;
        } catch (err) {
            console.error('Failed to set reset duration:', err);
            return false;
        }
    }, [budgetData]);

    /** Returns time in ms until next automatic reset, or null if no auto-reset configured. */
    const getTimeUntilReset = useCallback((): number | null => {
        if (!budgetData || budgetData.resetDuration <= 0) return null;
        const elapsed = Date.now() - budgetData.lastResetTimestamp;
        const remaining = budgetData.resetDuration - elapsed;
        return Math.max(0, remaining);
    }, [budgetData]);

    /** Returns the percentage of budget spent (0-100). */
    const getBudgetUsagePercent = useCallback((maximumBudget: number): number => {
        if (!budgetData || maximumBudget <= 0) return 0;
        return Math.min(100, (budgetData.budgetSpent / maximumBudget) * 100);
    }, [budgetData]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    return {
        budgetData,
        isLoading,
        refresh: loadData,
        updateBudgetData,
        resetBudget,
        setResetDuration,
        getTimeUntilReset,
        getBudgetUsagePercent,
    };
}