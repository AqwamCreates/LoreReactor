// src/hooks/useTextGeneration.ts
import { useCallback } from 'react';
import type { Character, InteractionData, PromptBlock } from '../types';
import { useSessionStore } from '../store/useSessionStore';
import { CharacterActor, type TurnStreamCallbacks } from '../services/CharacterActor';

interface UseTextGenerationOptions {
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

const orchestrator = new CharacterActor();

export function useTextGeneration(options: UseTextGenerationOptions) {
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
        allPromptBlocks?: PromptBlock[],
    ): Promise<InteractionData | null> => {

        const selectedModel = useSessionStore.getState().selectedModel;
        const runningModels = useSessionStore.getState().runningModels;
        const activeStrategy = useSessionStore.getState().activeStrategy;

        const callbacks: TurnStreamCallbacks = {
            onDisplayText: (text: string) => {
                streamingTextRef.current = text;
                throttledSetStreamingText(text);
                onToken?.(text);
            },
            onLatency: (ms: number) => setLatency(ms),
            onTimeToFirstToken: (ms: number) => setTimeToFirstToken(ms),
            onExpression: (expr: string) => {
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
            allPromptBlocks: allPromptBlocks ?? [],
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