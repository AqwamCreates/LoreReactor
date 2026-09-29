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
    selectedModelId: string | null;

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
    selectedCharacterId: string | null;
    selectedProfileId: string | null;
    activeExtensionIds: string[];

    // ── Bootstrap state ──────────────────────────────────────────────
    sessionLoaded: boolean;

    // ── Core State Actions ───────────────────────────────────────────
    setInteractionData: (
        data: InteractionData | null | ((prev: InteractionData | null) => InteractionData | null)
    ) => void;
    setCurrentCharacter: (character: Character | null) => void;

    // ── Preference Actions (update store + persist to server atomically)
    setSelectedCharacterId: (id: string | null) => void;
    setSelectedModelId: (id: string | null) => void;
    setSelectedProfileId: (id: string | null) => void;
    setSelectedBudgetStrategyId: (id: string | null) => void;
    setActiveChatId: (id: string | null) => void;
    setCurrentAccountId: (id: string | null) => void;
    setActiveExtensionIds: (ids: string[]) => void;
}

export const useSessionStore = create<SessionState>()((set) => {
    // Fire-and-forget async bootstrap
    loadRawSessionData()
        .then((session) => {
            const updates: Partial<SessionState> = { sessionLoaded: true };
            if (session.selectedModelId !== undefined) updates.selectedModelId = session.selectedModelId;
            if (session.selectedBudgetStrategyId !== undefined) updates.selectedBudgetStrategyId = session.selectedBudgetStrategyId;
            if (session.selectedCharacterId !== undefined) updates.selectedCharacterId = session.selectedCharacterId;
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
        selectedModelId: null,

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
        selectedCharacterId: null,
        selectedProfileId: null,
        activeExtensionIds: [],

        // ── Bootstrap state ──────────────────────────────────────────
        sessionLoaded: false,

        // ── Core State Actions ───────────────────────────────────────
        setInteractionData: (data) => {
            set((state) => ({
                interactionData: typeof data === 'function' ? data(state.interactionData) : data,
            }));
        },

        setCurrentCharacter: (character) => {
            set({ currentCharacter: character });
        },

        // ── Preference Actions ───────────────────────────────────────
        setSelectedCharacterId: (id) => {
            set({ selectedCharacterId: id });
            saveRawSessionData({ selectedCharacterId: id });
        },

        setSelectedModelId: (id) => {
            set({ selectedModelId: id });
            saveRawSessionData({ selectedModelId: id });
        },

        setSelectedProfileId: (id) => {
            set({ selectedProfileId: id });
            saveRawSessionData({ selectedProfileId: id });
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