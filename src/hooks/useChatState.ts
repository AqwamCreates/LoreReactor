// src/hooks/useChatState.ts
import { useCallback } from 'react';
import { useSessionStore } from './useSessionStore';
import type { Character, InteractionData, BudgetStrategy, LanguageModel, BudgetData } from '../types';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';

const engine = getLanguageModelEngine();

export function useChatState() {
    // --- Selectors ---
    const interactionData = useSessionStore(s => s.interactionData);
    const currentCharacter = useSessionStore(s => s.currentCharacter);
    const activeStrategy = useSessionStore(s => s.activeStrategy);
    const selectedModel = useSessionStore(s => s.selectedModel);
    const runningModels = useSessionStore(s => s.runningModels);
    const budgetData = useSessionStore(s => s.budgetData);
    const lastSelectedModelId = useSessionStore(s => s.lastSelectedModelId);
    
    // Streaming State
    const streamingText = useSessionStore(s => s.streamingText);
    const streamingCharacter = useSessionStore(s => s.streamingCharacter);
    const isLoading = useSessionStore(s => s.isLoading);
    const currentCharacterExpression = useSessionStore(s => s.currentCharacterExpression);

    // Stats
    const latency = useSessionStore(s => s.latency);
    const timeToFirstToken = useSessionStore(s => s.timeToFirstToken);
    const numberOfTokens = useSessionStore(s => s.numberOfTokens);
    const numberOfCacheInvalidations = useSessionStore(s => s.numberOfCacheInvalidations);
    const numberOfRequests = useSessionStore(s => s.numberOfRequests);
    const totalCost = useSessionStore(s => s.totalCost);
    const costWithoutCacheMisses = useSessionStore(s => s.costWithoutCacheMisses);

    // --- Setters ---
    const setInteractionData = useCallback((data: InteractionData | null) => {
        useSessionStore.setState({ interactionData: data });
        if (!data) useSessionStore.setState({ numberOfTokens: 0 });
    }, []);

    const setCurrentCharacter = useCallback((char: Character | null) => {
        useSessionStore.setState({ currentCharacter: char });
    }, []);

    const setStreamingState = useCallback((char: Character | null, text: string) => {
        useSessionStore.setState({ 
            streamingCharacter: char, 
            streamingText: text,
            isLoading: char !== null 
        });
    }, []);

    const updateRunningModels = useCallback((models: Record<string, any>) => {
        useSessionStore.setState({ runningModels: models });
        engine.setRunningModels(models);
    }, []);

    const setActiveStrategy = useCallback((strategy: BudgetStrategy | null) => {
        useSessionStore.setState({ activeStrategy: strategy });
    }, []);

    const setSelectedModel = useCallback((model: LanguageModel | null) => {
        useSessionStore.setState({ selectedModel: model });
    }, []);

    const setBudgetData = useCallback((data: BudgetData | null) => {
        useSessionStore.setState({ budgetData: data });
    }, []);

    const setLastSelectedModelId = useCallback((id: string | null) => {
        useSessionStore.setState({ lastSelectedModelId: id });
    }, []);

    const setStats = useCallback((newStats: any) => {
        useSessionStore.setState(prev => {
            const current = {
                numberOfCacheInvalidations: prev.numberOfCacheInvalidations,
                numberOfRequests: prev.numberOfRequests,
                totalCost: prev.totalCost,
                costWithoutCacheMisses: prev.costWithoutCacheMisses,
                latency: prev.latency,
                timeToFirstToken: prev.timeToFirstToken,
            };
            const next = typeof newStats === 'function' ? newStats(current) : { ...current, ...newStats };
            return next;
        });
    }, []);

    const setNumberOfTokens = useCallback((count: number) => {
        useSessionStore.setState({ numberOfTokens: count });
    }, []);

    const setCurrentCharacterExpression = useCallback((expr: string) => {
        useSessionStore.setState({ currentCharacterExpression: expr });
    }, []);

    return {
        // State
        interactionData,
        currentCharacter,
        activeStrategy,
        selectedModel,
        runningModels,
        budgetData,
        lastSelectedModelId,
        streamingText,
        streamingCharacter,
        isLoading,
        currentCharacterExpression,
        latency,
        timeToFirstToken,
        numberOfTokens,
        numberOfCacheInvalidations,
        numberOfRequests,
        totalCost,
        costWithoutCacheMisses,
        
        // Actions
        setInteractionData,
        setCurrentCharacter,
        setStreamingState,
        updateRunningModels,
        setActiveStrategy,
        setSelectedModel,
        setBudgetData,
        setLastSelectedModelId,
        setStats,
        setNumberOfTokens,
        setCurrentCharacterExpression,
        
        // Raw store access
        setState: useSessionStore.setState,
        getState: useSessionStore.getState,
    };
}