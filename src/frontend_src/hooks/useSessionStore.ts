// frontend_src/hooks/useSessionStore.ts
import { create } from 'zustand';
import type { Character, InteractionData, BudgetStrategy, LanguageModel, BudgetData, MultiplayerData } from '../types';
import { loadRawSessionData, saveRawSessionData, deleteRawMessage, saveRawInteractionData } from '../storages/serverStorage';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { deleteMessage, branchMessage, cloneChatUpToMessage } from '../utilities/messageLogic';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';

const engine = getLanguageModelEngine();

interface SessionState {
    // ── Core chat state ──────────────────────────────────────────────
    interactionData: InteractionData | null;
    localProtagonist: Character | null;

    // ── Generation state ─────────────────────────────────────────────
    isLoading: boolean;
    streamingText: string;
    streamingCharacter: Character | null;
    currentCharacterExpression: string;
    loadingLocations: Record<string, boolean>;
    abortController: AbortController | null;

    // ── Local UI State (Moved from props to eliminate drilling) ───────
    editingId: string | null;
    editDraft: string;
    massDeleteId: string | null;
    activeToolbarId: string | null;

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

    // ── UI preferences ───────────────────────────────────────────────
    selectedBudgetStrategyId: string | null;
    selectedCharacterId: string | null;
    selectedProfileId: string | null;
    activeExtensionIds: string[];

    // ── Bootstrap state ──────────────────────────────────────────────
    sessionLoaded: boolean;

    // ── Core Actions ─────────────────────────────────────────────────
    setInteractionData: (
        data: InteractionData | null | ((prev: InteractionData | null) => InteractionData | null)
    ) => void;
    setLocalProtagonist: (character: Character | null) => void;
    setActiveStrategy: (strategy: BudgetStrategy | null) => void;
    setSelectedModel: (model: LanguageModel | null) => void;
    updateRunningModels: (models: Record<string, any>) => void;
    setBudgetData: (data: BudgetData | null) => void;
    setLastSelectedModelId: (id: string | null) => void;
    setStats: (newStats: any) => void;
    setNumberOfTokens: (count: number) => void;
    setSelectedCharacterExpression: (expr: string) => void;

    // ── Local UI State Actions ───────────────────────────────────────
    setEditingState: (id: string | null, draft?: string) => void;
    setEditDraft: (draft: string) => void;
    setMassDeleteId: (id: string | null) => void;
    setActiveToolbarId: (id: string | null) => void;

    // ── Streaming Actions ────────────────────────────────────────────
    setStreamingState: (char: Character | null, text: string) => void;
    setStreamingText: (text: string) => void;
    setStreamingCharacter: (character: Character | null) => void;
    setIsLoading: (isLoading: boolean) => void;
    resetStreaming: () => void;
    setAbortController: (ctrl: AbortController | null) => void;
    stopGeneration: () => void;

    // ── Message & Chat Actions (Eliminates Prop Drilling) ────────────
    copyToClipboard: (text: string) => Promise<void>;
    deleteMessage: (id: string) => Promise<void>;
    branchChat: (messageId: string) => Promise<void>;
    cloneChat: (messageId: string) => Promise<void>;

    // ── Preference Actions (Server-Persisted) ─────────────────────────
    setSelectedCharacterId: (id: string | null) => void;
    setSelectedModelId: (id: string | null) => void;
    setSelectedProfileId: (id: string | null) => void;
    setSelectedBudgetStrategyId: (id: string | null) => void;
    setActiveChatId: (id: string | null) => void;
    setCurrentAccountId: (id: string | null) => void;
    setActiveExtensionIds: (ids: string[]) => void;
}

export const useSessionStore = create<SessionState>()((set, get) => {
    loadRawSessionData()
        .then((session) => {
            const updates: Partial<SessionState> = { sessionLoaded: true };
            if (session.selectedCharacterId !== undefined) updates.selectedCharacterId = session.selectedCharacterId;
            if (session.currentAccountId !== undefined) updates.currentAccountId = session.currentAccountId;

            // Mutual exclusivity on bootstrap hydration:
            // If both were previously saved, resolve conflicts cleanly
            if (session.selectedBudgetStrategyId) {
                updates.selectedBudgetStrategyId = session.selectedBudgetStrategyId;
                updates.selectedModelId = null;
            } else if (session.selectedModelId) {
                updates.selectedModelId = session.selectedModelId;
                updates.selectedBudgetStrategyId = null;
            }

            set(updates);
        })
        .catch((e) => {
            console.warn('[useSessionStore] Failed to load session data:', e);
            set({ sessionLoaded: true });
        });

    return {
        interactionData: null,
        localProtagonist: null,

        isLoading: false,
        streamingText: '',
        streamingCharacter: null,
        currentCharacterExpression: 'neutral',
        loadingLocations: {},
        abortController: null,

        editingId: null,
        editDraft: '',
        massDeleteId: null,
        activeToolbarId: null,

        selectedModel: null,
        runningModels: {},
        activeStrategy: null,
        selectedModelId: null,

        budgetData: null,

        latency: 0,
        timeToFirstToken: 0,
        numberOfCacheInvalidations: 0,
        numberOfRequests: 0,
        totalCost: 0,
        costWithoutCacheMisses: 0,
        numberOfTokens: 0,
        sessionStartTimestamp: null,

        currentAccountId: null,
        multiplayerData: null,

        selectedBudgetStrategyId: null,
        selectedCharacterId: null,
        selectedProfileId: null,
        activeExtensionIds: [],

        sessionLoaded: false,

        // ── Core Actions ─────────────────────────────────────────────
        setInteractionData: (data) => {
            set((state) => {
                const nextData = typeof data === 'function' ? data(state.interactionData) : data;
                return {
                    interactionData: nextData,
                    ...(nextData ? {} : { numberOfTokens: 0 }),
                };
            });
        },

        setLocalProtagonist: (character) => {
            set({ localProtagonist: character });
        },

        setActiveStrategy: (strategy) => {
            set({ 
                activeStrategy: strategy,
                ...(strategy ? { selectedModel: null, selectedModelId: null } : {})
            });
        },

        setSelectedModel: (model) => {
            set({ 
                selectedModel: model,
                ...(model ? { activeStrategy: null, selectedBudgetStrategyId: null } : {})
            });
        },

        updateRunningModels: (models) => {
            set({ runningModels: models });
            engine.setRunningModels(models);
        },

        setBudgetData: (data) => {
            set({ budgetData: data });
        },

        setLastSelectedModelId: (id) => {
            // Internal telemetry reported by BudgetStrategyEngine — does not clear strategy
            set({ selectedModelId: id });
        },

        setStats: (newStats) => {
            set((prev) => {
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
        },

        setNumberOfTokens: (count) => {
            set({ numberOfTokens: count });
        },

        setSelectedCharacterExpression: (expr) => {
            set({ currentCharacterExpression: expr });
        },

        // ── Local UI State Actions ───────────────────────────────────────
        setEditingState: (id, draft = '') => {
            set({ 
                editingId: id, 
                editDraft: draft,
                activeToolbarId: id ? null : get().activeToolbarId 
            });
        },
        setEditDraft: (draft) => set({ editDraft: draft }),
        setMassDeleteId: (id) => set({ massDeleteId: id }),
        setActiveToolbarId: (id) => set({ activeToolbarId: id }),

        // ── Streaming Actions ────────────────────────────────────────
        setStreamingState: (char, text) => {
            set({ 
                streamingCharacter: char, 
                streamingText: text,
                isLoading: char !== null 
            });
        },

        setStreamingText: (text) => set({ streamingText: text }),
        setStreamingCharacter: (character) => set({ streamingCharacter: character }),
        setIsLoading: (isLoading) => set({ isLoading }),
        resetStreaming: () => set({ streamingText: '', streamingCharacter: null, isLoading: false }),
        
        setAbortController: (ctrl) => set({ abortController: ctrl }),
        
        stopGeneration: () => {
            const { abortController } = get();
            if (abortController) {
                abortController.abort();
            }
            set({ 
                streamingText: '', 
                streamingCharacter: null, 
                isLoading: false,
                abortController: null 
            });
        },

        // ── Message & Chat Actions ────────────────────────────────────
        copyToClipboard: async (text: string) => {
            try {
                await navigator.clipboard.writeText(text);
            } catch (e) {
                console.error('Failed to copy text', e);
            }
        },

        deleteMessage: async (id: string) => {
            const { interactionData } = get();
            if (!interactionData) return;
            try {
                await deleteRawMessage(id);
                const updated = await deleteMessage(interactionData, id);
                set({ interactionData: updated });
            } catch (e) {
                console.error('Failed to delete message', e);
            }
        },

        branchChat: async (messageId: string) => {
            const { interactionData } = get();
            if (!interactionData) return;
            try {
                const branchedChat = await branchMessage(interactionData, messageId);
                await saveRawInteractionData(branchedChat);
                await saveRawSessionData({ activeChatId: branchedChat.id });
                set({ interactionData: branchedChat });
                speculativeMarkovEngine.clearSession(branchedChat.id);
            } catch (e) {
                console.error('Failed to branch chat', e);
            }
        },

        cloneChat: async (messageId: string) => {
            const { interactionData } = get();
            if (!interactionData) return;
            try {
                const clonedChat = await cloneChatUpToMessage(interactionData, messageId);
                await saveRawInteractionData(clonedChat);
                await saveRawSessionData({ activeChatId: clonedChat.id });
                set({ interactionData: clonedChat });
                speculativeMarkovEngine.clearSession(clonedChat.id);
            } catch (e) {
                console.error('Failed to clone chat', e);
            }
        },

        // ── Preference Actions (Mutually Exclusive Model & Strategy) ───
        setSelectedCharacterId: (id) => {
            set({ selectedCharacterId: id });
            saveRawSessionData({ selectedCharacterId: id });
        },

        setSelectedModelId: (id) => {
            set({ 
                selectedModelId: id,
                // Selecting a manual model deselects and deactivates any budget strategy
                ...(id ? { selectedBudgetStrategyId: null, activeStrategy: null } : { selectedModel: null }),
            });
            saveRawSessionData({ 
                selectedModelId: id,
                ...(id ? { selectedBudgetStrategyId: null } : {}),
            });
        },

        setSelectedProfileId: (id) => {
            set({ selectedProfileId: id });
            saveRawSessionData({ selectedProfileId: id });
        },

        setSelectedBudgetStrategyId: (id) => {
            set({ 
                selectedBudgetStrategyId: id,
                // Activating a budget strategy deselects any manual model
                ...(id ? { selectedModelId: null, selectedModel: null } : { activeStrategy: null }),
            });
            saveRawSessionData({ 
                selectedBudgetStrategyId: id,
                ...(id ? { selectedModelId: null } : {}),
            });
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