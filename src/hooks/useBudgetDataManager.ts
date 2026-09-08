// src/hooks/useBudgetDataManager.ts
import { useState, useEffect, useCallback } from 'react';
import type { BudgetData, BudgetStrategy } from '../types';
import { loadRawBudgetData, saveRawBudgetData } from './storage';

const DEFAULT_RESET_DURATION_MS = 24 * 60 * 60 * 1000;

const BUDGET_DATA_UPDATED_EVENT = 'budget-data-updated';

function emitBudgetDataUpdated(data: BudgetData | null) {
    window.dispatchEvent(new CustomEvent(BUDGET_DATA_UPDATED_EVENT, { detail: data }));
}

function applyResetIfDue(data: BudgetData): BudgetData {
    if (data.resetDuration <= 0) return data;

    const now = Date.now();
    const elapsed = now - data.lastResetTimestamp;

    if (elapsed < data.resetDuration) return data;

    return {
        ...data,
        budgetSpent: 0,
        modelBudgetSpent: {},
        modelLastQuotaHitTimeStamps: {},
        modelLastErrorHitTimeStamps: {},
        lastResetTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function createDefaultBudgetData(strategy: BudgetStrategy, resetDuration = DEFAULT_RESET_DURATION_MS): BudgetData {
    const now = Date.now();

    return {
        id: 'global-budget-data',
        name: 'Global Budget Data',
        description: 'Persistent runtime budget tracking',
        budgetSpent: 0,
        resetDuration,
        averageGenerationSpeedMsPerTokenExponentialMovingAverageSmoothing: 0.3,
        averageTimeToFirstTokenExponentialMovingAverageSmoothing: 0.3,
        modelLastUsedTimestamps: {},
        modelLastQuotaHitTimeStamps: {},
        modelLastErrorHitTimeStamps: {},
        modelUsedCount: {},
        modelQuotaHitCount: {},
        modelErrorHitCount: {},
        lastResetTimestamp: now,
        budgetStrategy: strategy,
        modelBudgetSpent: {},
        modelAverageGenerationSpeedMsPerToken: {},
        modelAverageTimeToFirstToken: {},
        modelTotalSessionDuration: {},
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

export function useBudgetDataManager() {
    const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const loaded = await loadRawBudgetData();

            if (!loaded) {
                setBudgetData(null);
                emitBudgetDataUpdated(null);
                return null;
            }

            const resetChecked = applyResetIfDue(loaded);

            if (resetChecked !== loaded) {
                await saveRawBudgetData(resetChecked);
            }

            setBudgetData(resetChecked);
            emitBudgetDataUpdated(resetChecked);
            return resetChecked;
        } catch (err) {
            console.error('Failed to load budget data:', err);
            setBudgetData(null);
            emitBudgetDataUpdated(null);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const saveBudgetData = useCallback(async (data: BudgetData): Promise<boolean> => {
        try {
            const updated: BudgetData = {
                ...data,
                lastUpdatedTimestamp: Date.now(),
            };

            await saveRawBudgetData(updated);
            setBudgetData(updated);
            emitBudgetDataUpdated(updated);
            return true;
        } catch (err) {
            console.error('Failed to save budget data:', err);
            return false;
        }
    }, []);

    const createBudgetData = useCallback(async (
        strategy: BudgetStrategy,
        resetDuration = DEFAULT_RESET_DURATION_MS,
    ): Promise<boolean> => {
        try {
            const created = createDefaultBudgetData(strategy, resetDuration);
            await saveRawBudgetData(created);
            setBudgetData(created);
            emitBudgetDataUpdated(created);
            return true;
        } catch (err) {
            console.error('Failed to create budget data:', err);
            return false;
        }
    }, []);

    const updateBudgetData = useCallback(async (
        updater: (data: BudgetData) => BudgetData,
    ): Promise<boolean> => {
        if (!budgetData) return false;

        try {
            const updated = {
                ...updater(budgetData),
                lastUpdatedTimestamp: Date.now(),
            };

            await saveRawBudgetData(updated);
            setBudgetData(updated);
            emitBudgetDataUpdated(updated);
            return true;
        } catch (err) {
            console.error('Failed to update budget data:', err);
            return false;
        }
    }, [budgetData]);

    const resetBudget = useCallback(async (): Promise<boolean> => {
        if (!budgetData) return false;

        const now = Date.now();

        return updateBudgetData(data => ({
            ...data,
            budgetSpent: 0,
            modelBudgetSpent: {},
            modelLastQuotaHitTimeStamps: {},
            modelLastErrorHitTimeStamps: {},
            lastResetTimestamp: now,
        }));
    }, [budgetData, updateBudgetData]);

    const setBudgetSpent = useCallback(async (amount: number): Promise<boolean> => {
        return updateBudgetData(data => ({
            ...data,
            budgetSpent: Math.max(0, amount),
        }));
    }, [updateBudgetData]);

    const setResetDuration = useCallback(async (durationMs: number): Promise<boolean> => {
        return updateBudgetData(data => ({
            ...data,
            resetDuration: Math.max(0, durationMs),
        }));
    }, [updateBudgetData]);

    const setBudgetStrategy = useCallback(async (strategy: BudgetStrategy): Promise<boolean> => {
        return updateBudgetData(data => ({
            ...data,
            budgetStrategy: strategy,
        }));
    }, [updateBudgetData]);

    const clearModelLastUsedTimestamps = useCallback(async (): Promise<boolean> => {
        return updateBudgetData(data => ({
            ...data,
            modelLastUsedTimestamps: {},
        }));
    }, [updateBudgetData]);

    const clearQuotaTimestamps = useCallback(async (): Promise<boolean> => {
        return updateBudgetData(data => ({
            ...data,
            modelLastQuotaHitTimeStamps: {},
        }));
    }, [updateBudgetData]);

    const clearErrorTimestamps = useCallback(async (): Promise<boolean> => {
        return updateBudgetData(data => ({
            ...data,
            modelLastErrorHitTimeStamps: {},
        }));
    }, [updateBudgetData]);

    const clearDurationTimestamps = useCallback(async (): Promise<boolean> => {
        return updateBudgetData(data => ({
            ...data,
            modelTotalSessionDuration: {},
        }));
    }, [updateBudgetData]);

    const clearAllModelTelemetry = useCallback(async (): Promise<boolean> => {
        return updateBudgetData(data => ({
            ...data,
            modelLastUsedTimestamps: {},
            modelLastQuotaHitTimeStamps: {},
            modelLastErrorHitTimeStamps: {},
            modelUsedCount: {},
            modelQuotaHitCount: {},
            modelErrorHitCount: {},
            modelAverageGenerationSpeedMsPerToken: {},
            modelAverageTimeToFirstToken: {},
            modelBudgetSpent: {},
            modelTotalSessionDuration: {},
        }));
    }, [updateBudgetData]);

    const getTimeUntilReset = useCallback((): number | null => {
        if (!budgetData || budgetData.resetDuration <= 0) return null;

        const elapsed = Date.now() - budgetData.lastResetTimestamp;
        return Math.max(0, budgetData.resetDuration - elapsed);
    }, [budgetData]);

    const getBudgetUsagePercent = useCallback((): number => {
        if (!budgetData) return 0;

        const max = budgetData.budgetStrategy?.maximumBudget ?? 0;
        if (max <= 0) return 0;

        return Math.min(100, (budgetData.budgetSpent / max) * 100);
    }, [budgetData]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    return {
        budgetData,
        isLoading,

        refresh: loadData,
        saveBudgetData,
        createBudgetData,
        updateBudgetData,

        resetBudget,
        setBudgetSpent,
        setResetDuration,
        setBudgetStrategy,

        clearModelLastUsedTimestamps,
        clearQuotaTimestamps,
        clearErrorTimestamps,
        clearDurationTimestamps,
        clearAllModelTelemetry,

        getTimeUntilReset,
        getBudgetUsagePercent,
    };
}