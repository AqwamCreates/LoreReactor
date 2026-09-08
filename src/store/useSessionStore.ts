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
}

export const useSessionStore = create<SessionState>()(() => ({
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
}));