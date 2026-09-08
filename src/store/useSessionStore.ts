// src/store/useSessionStore.ts
import { create } from 'zustand';
import type { Character, InteractionData, BudgetStrategy, LanguageModel, BudgetData } from '../types';

interface SessionState {
    // Core chat state
    interactionData: InteractionData | null;
    currentCharacter: Character | null;

    // Generation state
    isLoading: boolean;
    streamingText: string;
    streamingCharacter: Character | null;
    currentCharacterExpression: string;

    // Model state
    selectedModel: LanguageModel | null;
    runningModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    activeStrategy: BudgetStrategy | null;

    // Budget state
    budgetData: BudgetData | null;

    // Stats
    generationSpeed: number;
    timeToFirstToken: number;
    numberOfCacheInvalidations: number;
    numberOfRequests: number;
    totalCost: number;
    costWithoutCacheMisses: number;
    numberOfTokens: number;

    // Actions
    setInteractionData: (data: InteractionData | null) => void;
    setCurrentCharacter: (char: Character | null) => void;
    setIsLoading: (loading: boolean) => void;
    setStreamingText: (text: string) => void;
    setStreamingCharacter: (char: Character | null) => void;
    setCurrentCharacterExpression: (expr: string) => void;
    setSelectedModel: (model: LanguageModel | null) => void;
    setRunningModels: (models: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>) => void;
    setActiveStrategy: (strategy: BudgetStrategy | null) => void;
    setBudgetData: (data: BudgetData | null) => void;
    updateStats: (stats: Partial<Pick<SessionState, 'generationSpeed' | 'timeToFirstToken' | 'numberOfCacheInvalidations' | 'numberOfRequests' | 'totalCost' | 'costWithoutCacheMisses' | 'numberOfTokens'>>) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
    interactionData: null,
    currentCharacter: null,
    isLoading: false,
    streamingText: '',
    streamingCharacter: null,
    currentCharacterExpression: 'neutral',
    selectedModel: null,
    runningModels: {},
    activeStrategy: null,
    budgetData: null,
    generationSpeed: 0,
    timeToFirstToken: 0,
    numberOfCacheInvalidations: 0,
    numberOfRequests: 0,
    totalCost: 0,
    costWithoutCacheMisses: 0,
    numberOfTokens: 0,

    setInteractionData: (data) => set({ interactionData: data }),
    setCurrentCharacter: (char) => set({ currentCharacter: char }),
    setIsLoading: (loading) => set({ isLoading: loading }),
    setStreamingText: (text) => set({ streamingText: text }),
    setStreamingCharacter: (char) => set({ streamingCharacter: char }),
    setCurrentCharacterExpression: (expr) => set({ currentCharacterExpression: expr }),
    setSelectedModel: (model) => set({ selectedModel: model }),
    setRunningModels: (models) => set({ runningModels: models }),
    setActiveStrategy: (strategy) => set({ activeStrategy: strategy }),
    setBudgetData: (data) => set({ budgetData: data }),
    updateStats: (stats) => set(stats),
}));