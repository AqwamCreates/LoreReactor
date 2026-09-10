// src/hooks/useGeneration.ts
import { useCallback } from 'react';
import type { Character, InteractionData } from '../types';
import { useSessionStore } from '../store/useSessionStore';
import { GenerationOrchestrator, type TurnStreamCallbacks } from '../services/GenerationOrchestrator';

interface UseGenerationOptions {
    setBudgetData: (bd: import('../types').BudgetData) => void;
    setStats: React.Dispatch<React.SetStateAction<{ numberOfCacheInvalidations: number; numberOfRequests: number; totalCost: number; costWithoutCacheMisses: number }>>;
    setLatency: (speed: number) => void;
    setTimeToFirstToken: (ttft: number) => void;
    setCurrentCharacterExpression: (expr: string) => void;
    previousExpressionRef: React.MutableRefObject<string>;
    throttledSetStreamingText: (text: string) => void;
    streamingTextRef: React.MutableRefObject<string>;
    processMemoryTrigger: (rawText: string, character: Character, data: InteractionData) => Promise<void>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const orchestrator = new GenerationOrchestrator();

export function useGeneration(options: UseGenerationOptions) {
    const {
        setBudgetData, setStats, setLatency, setTimeToFirstToken,
        setCurrentCharacterExpression, previousExpressionRef,
        throttledSetStreamingText, streamingTextRef,
        processMemoryTrigger, addToast,
    } = options;

    const handleServerResponse = useCallback(async (
        data: InteractionData, character: Character, signal: AbortSignal,
        onToken?: (text: string) => void,
        strategyOverride?: import('../types').BudgetStrategy | null,
        existingCharacterText?: string,
    ): Promise<InteractionData | null> => {

        const selectedModel = useSessionStore.getState().selectedModel;
        const runningModels = useSessionStore.getState().runningModels;
        const activeStrategy = useSessionStore.getState().activeStrategy;

        const callbacks: TurnStreamCallbacks = {
            onDisplayText: (text) => {
                streamingTextRef.current = text;
                throttledSetStreamingText(text);
                onToken?.(text);
            },
            onLatency: (ms) => setLatency(ms),
            onTimeToFirstToken: (ms) => setTimeToFirstToken(ms),
            onExpression: (expr) => {
                previousExpressionRef.current = expr;
                setCurrentCharacterExpression(expr);
            },
        };

        const outcome = await orchestrator.executeTurn({
            data,
            character,
            signal,
            selectedModel,
            runningModels,
            activeStrategy,
            strategyOverride,
            existingCharacterText,
            callbacks,
        });

        if ('error' in outcome) {
            const { error } = outcome;
            if (error.type === 'aborted') return null;
            if (error.type === 'network') {
                addToast('⚠️ Backend Connection Failed.', 'error');
                return null;
            }
            if (error.type === 'no_model') {
                addToast(error.message, 'error');
                return null;
            }
            if (error.type === 'budget') {
                addToast(error.message, 'error');
                return null;
            }
            console.error('Inference failed:', error.message);
            addToast(`Inference Error: ${error.message}`, 'error');
            return null;
        }

        const { result } = outcome;

        // Apply state updates from result
        if (result.budgetData) setBudgetData(result.budgetData);

        setStats(prev => ({
            numberOfCacheInvalidations: prev.numberOfCacheInvalidations + result.statsDelta.numberOfCacheInvalidations,
            numberOfRequests: prev.numberOfRequests + result.statsDelta.numberOfRequests,
            totalCost: prev.totalCost + result.statsDelta.totalCost,
            costWithoutCacheMisses: prev.costWithoutCacheMisses + result.statsDelta.costWithoutCacheMisses,
        }));

        // Memory trigger runs post-generation in the hook layer
        // because it may involve additional UI side effects
        await processMemoryTrigger(result.rawText, character, result.updatedData);

        return result.updatedData;
    }, [
        setBudgetData, setStats, setLatency, setTimeToFirstToken,
        setCurrentCharacterExpression, previousExpressionRef,
        throttledSetStreamingText, streamingTextRef,
        processMemoryTrigger, addToast,
    ]);

    return { handleServerResponse };
}