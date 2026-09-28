// src/hooks/useSessionStore.ts
import { create } from 'zustand';
import type { Character, InteractionData, BudgetStrategy, LanguageModel, BudgetData, MultiplayerData } from '../types';
import { loadRawSessionData, saveRawSessionData } from '../storages/serverStorage';

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

    // ── Bootstrap state ──────────────────────────────────────────────
    sessionLoaded: boolean;

    // ── Actions (update store + persist to server atomically) ────────
    setCurrentAccountId: (id: string | null) => void;
    setSelectedBudgetStrategyId: (id: string | null) => void;
    setDefaultCharacterId: (id: string | null) => void;
    setActiveExtensionIds: (ids: string[]) => void;
    setActiveChatId: (id: string | null) => void;
    setSelectedModelId: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>()((set) => {
    // Fire-and-forget async bootstrap
    loadRawSessionData()
        .then((session) => {
            const updates: Partial<SessionState> = { sessionLoaded: true };
            if (session.selectedModelId !== undefined) updates.lastSelectedModelId = session.selectedModelId;
            if (session.selectedBudgetStrategyId !== undefined) updates.selectedBudgetStrategyId = session.selectedBudgetStrategyId;
            if (session.defaultCharacterId !== undefined) updates.defaultCharacterId = session.defaultCharacterId;
            if (session.currentAccountId !== undefined) updates.currentAccountId = session.currentAccountId;
            set(updates);
        })
        .catch((e) => {
            console.warn('[useSessionStore] Failed to load session data:', e);
            set({ sessionLoaded: true });
        });

    return {
        // ── Core chat state ──────────────────────────────────────────
        interactionData: null,
        currentCharacter: null,

        // ── Generation state ─────────────────────────────────────────
        isLoading: false,
        streamingText: '',
        streamingCharacter: null,
        currentCharacterExpression: 'neutral',

        // ── Model state ──────────────────────────────────────────────
        selectedModel: null,
        runningModels: {},
        activeStrategy: null,
        lastSelectedModelId: null,

        // ── Budget state ─────────────────────────────────────────────
        budgetData: null,

        // ── Stats ────────────────────────────────────────────────────
        latency: 0,
        timeToFirstToken: 0,
        numberOfCacheInvalidations: 0,
        numberOfRequests: 0,
        totalCost: 0,
        costWithoutCacheMisses: 0,
        numberOfTokens: 0,
        sessionStartTimestamp: null,

        // ── Multiplayer state ────────────────────────────────────────
        currentAccountId: null,
        multiplayerData: null,

        // ── UI preferences ───────────────────────────────────────────
        selectedBudgetStrategyId: null,
        defaultCharacterId: null,
        activeExtensionIds: [],

        // ── Bootstrap state ──────────────────────────────────────────
        sessionLoaded: false,

        // ── Actions ──────────────────────────────────────────────────
        setDefaultCharacterId: (id) => {
            set({ defaultCharacterId: id });
            saveRawSessionData({ defaultCharacterId: id });
        },

        setSelectedModelId: (id) => {
            set({ lastSelectedModelId: id });
            saveRawSessionData({ selectedModelId: id });
        },

        setSelectedBudgetStrategyId: (id) => {
            set({ selectedBudgetStrategyId: id });
            saveRawSessionData({ selectedBudgetStrategyId: id });
        },

        setActiveChatId: (id) => {
            saveRawSessionData({ activeChatId: id });
        },

        setCurrentAccountId: (id) => {
            set({ currentAccountId: id });
            saveRawSessionData({ currentAccountId: id });
        },

        setActiveExtensionIds: (ids) => {
            set({ activeExtensionIds: ids });
            saveRawSessionData({ activeExtensionIds: ids });
        },

    };
});