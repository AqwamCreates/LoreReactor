// src/store/useSessionStore.ts
import { create } from 'zustand';
import type { Character, InteractionData, BudgetStrategy, LanguageModel, BudgetData, MultiplayerData } from '../types';

interface SessionState {
    // ── Core chat state ──────────────────────────────────────────────
    interactionData: InteractionData | null;
    currentCharacter: Character | null;

    // ── Generation state ─────────────────────────────────────────────
    isLoading: boolean;
    streamingText: string;
    streamingCharacter: Character | null;
    currentCharacterExpression: string;

    // ── Model state ──────────────────────────────────────────────────
    selectedModel: LanguageModel | null;
    runningModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    activeStrategy: BudgetStrategy | null;
    lastSelectedModelId: string | null;

    // ── Budget state ─────────────────────────────────────────────────
    budgetData: BudgetData | null;

    // ── Stats ────────────────────────────────────────────────────────
    latency: number;
    timeToFirstToken: number;
    numberOfCacheInvalidations: number;
    numberOfRequests: number;
    totalCost: number;
    costWithoutCacheMisses: number;
    numberOfTokens: number;
    sessionStartTimestamp: number | null;

    // ── Multiplayer state ────────────────────────────────────────────
    currentAccountId: string | null;
    multiplayerData: MultiplayerData | null;

    // ── UI preferences (server-persisted via serverStorage) ──────────
    selectedBudgetStrategyId: string | null;
    defaultCharacterId: string | null;
    activeExtensionIds: string[];

    // ── Actions ──────────────────────────────────────────────────────
    setCurrentAccountId: (id: string | null) => void;
    setSelectedBudgetStrategyId: (id: string | null) => void;
    setDefaultCharacterId: (id: string | null) => void;
    setActiveExtensionIds: (ids: string[]) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
    // ── Core chat state ──────────────────────────────────────────────
    interactionData: null,
    currentCharacter: null,

    // ── Generation state ─────────────────────────────────────────────
    isLoading: false,
    streamingText: '',
    streamingCharacter: null,
    currentCharacterExpression: 'neutral',

    // ── Model state ──────────────────────────────────────────────────
    selectedModel: null,
    runningModels: {},
    activeStrategy: null,
    lastSelectedModelId: null,

    // ── Budget state ─────────────────────────────────────────────────
    budgetData: null,

    // ── Stats ────────────────────────────────────────────────────────
    latency: 0,
    timeToFirstToken: 0,
    numberOfCacheInvalidations: 0,
    numberOfRequests: 0,
    totalCost: 0,
    costWithoutCacheMisses: 0,
    numberOfTokens: 0,
    sessionStartTimestamp: null,

    // ── Multiplayer state ────────────────────────────────────────────
    // Initialized as null — populated asynchronously by loadRawSessionData()
    currentAccountId: null,
    multiplayerData: null,

    // ── UI preferences ───────────────────────────────────────────────
    // Initialized as null/empty — populated asynchronously by loadRawSessionData()
    selectedBudgetStrategyId: null,
    defaultCharacterId: null,
    activeExtensionIds: [],

    // ── Actions ──────────────────────────────────────────────────────
    setCurrentAccountId: (id) => set({ currentAccountId: id }),
    setSelectedBudgetStrategyId: (id) => set({ selectedBudgetStrategyId: id }),
    setDefaultCharacterId: (id) => set({ defaultCharacterId: id }),
    setActiveExtensionIds: (ids) => set({ activeExtensionIds: ids }),
}));