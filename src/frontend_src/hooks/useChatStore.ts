// src/frontend_src/hooks/useChatStore.ts
import { create } from 'zustand';
import type { Character, InteractionData, BudgetStrategy, LanguageModel, BudgetData, MultiplayerData, EntityFolder } from '../types';
import { loadRawSessionData, saveRawSessionData, saveRawInteractionData } from '../storages/serverStorage';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { deleteMessage, branchMessage, cloneChatUpToMessage } from '../utilities/messageLogic';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';

const engine = getLanguageModelEngine();

interface ChatState {
    interactionData: InteractionData | null;
    localProtagonist: Character | null;
    selectedLanguageModel: LanguageModel | null;
    runningLanguageModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    activeStrategy: BudgetStrategy | null;
    selectedModelId: string | null;
    budgetData: BudgetData | null;
    numberOfTokens: number;
    sessionStartTimestamp: number | null;
    currentAccountId: string | null;
    multiplayerData: MultiplayerData | null;
    selectedBudgetStrategyId: string | null;
    selectedCharacterId: string | null;
    selectedProfileId: string | null;
    activeExtensionIds: string[];
    allEntityFolders: EntityFolder[];
    saveEntityFolder: ((folder: EntityFolder) => Promise<boolean>) | null;
    sessionLoaded: boolean;

    setInteractionData: (data: InteractionData | null | ((prev: InteractionData | null) => InteractionData | null)) => void;
    setLocalProtagonist: (character: Character | null) => void;
    setActiveStrategy: (strategy: BudgetStrategy | null) => void;
    setSelectedModel: (model: LanguageModel | null) => void;
    updateRunningModels: (models: Record<string, any>) => void;
    setBudgetData: (data: BudgetData | null) => void;
    setLastSelectedModelId: (id: string | null) => void;
    setNumberOfTokens: (count: number) => void;
    setAllEntityFolders: (folders: EntityFolder[]) => void;
    setSaveEntityFolder: (fn: ((folder: EntityFolder) => Promise<boolean>) | null) => void;
    setSelectedCharacterId: (id: string | null) => void;
    setSelectedModelId: (id: string | null) => void;
    setSelectedProfileId: (id: string | null) => void;
    setSelectedBudgetStrategyId: (id: string | null) => void;
    setActiveChatId: (id: string | null) => void;
    setCurrentAccountId: (id: string | null) => void;
    setActiveExtensionIds: (ids: string[]) => void;
    
    // Domain Actions
    copyToClipboard: (text: string) => Promise<void>;
    deleteMessage: (id: string) => Promise<void>;
    branchChat: (messageId: string) => Promise<void>;
    cloneChat: (messageId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>()((set, get) => {
    loadRawSessionData()
        .then((session) => {
            const updates: Partial<ChatState> = { sessionLoaded: true };
            if (session.selectedModelId !== undefined) updates.selectedModelId = session.selectedModelId;
            if (session.selectedBudgetStrategyId !== undefined) updates.selectedBudgetStrategyId = session.selectedBudgetStrategyId;
            if (session.selectedCharacterId !== undefined) updates.selectedCharacterId = session.selectedCharacterId;
            if (session.currentAccountId !== undefined) updates.currentAccountId = session.currentAccountId;
            set(updates);
        })
        .catch((e) => {
            console.warn('[useChatStore] Failed to load session data:', e);
            set({ sessionLoaded: true });
        });

    return {
        interactionData: null, localProtagonist: null, selectedLanguageModel: null, runningLanguageModels: {},
        activeStrategy: null, selectedModelId: null, budgetData: null, numberOfTokens: 0,
        sessionStartTimestamp: null, currentAccountId: null, multiplayerData: null,
        selectedBudgetStrategyId: null, selectedCharacterId: null, selectedProfileId: null,
        activeExtensionIds: [], allEntityFolders: [], saveEntityFolder: null, sessionLoaded: false,

        setInteractionData: (data) => {
            set((state) => {
                const nextData = typeof data === 'function' ? data(state.interactionData) : data;
                return { interactionData: nextData, ...(nextData ? {} : { numberOfTokens: 0 }) };
            });
        },
        setLocalProtagonist: (character) => set({ localProtagonist: character }),
        setActiveStrategy: (strategy) => set({ activeStrategy: strategy }),
        setSelectedModel: (model) => set({ selectedLanguageModel: model }),
        updateRunningModels: (models) => {
            set({ runningLanguageModels: models });
            engine.setRunningModels(models);
        },
        setBudgetData: (data) => set({ budgetData: data }),
        setLastSelectedModelId: (id) => set({ selectedModelId: id }),
        setNumberOfTokens: (count) => set({ numberOfTokens: count }),
        setAllEntityFolders: (folders) => set({ allEntityFolders: folders }),
        setSaveEntityFolder: (fn) => set({ saveEntityFolder: fn }),
        setSelectedCharacterId: (id) => { set({ selectedCharacterId: id }); saveRawSessionData({ selectedCharacterId: id }); },
        setSelectedModelId: (id) => { set({ selectedModelId: id }); saveRawSessionData({ selectedModelId: id }); },
        setSelectedProfileId: (id) => { set({ selectedProfileId: id }); saveRawSessionData({ selectedProfileId: id }); },
        setSelectedBudgetStrategyId: (id) => { set({ selectedBudgetStrategyId: id }); saveRawSessionData({ selectedBudgetStrategyId: id }); },
        setActiveChatId: (id) => { saveRawSessionData({ activeChatId: id }); },
        setCurrentAccountId: (id) => { set({ currentAccountId: id }); saveRawSessionData({ currentAccountId: id }); },
        setActiveExtensionIds: (ids) => { set({ activeExtensionIds: ids }); saveRawSessionData({ activeExtensionIds: ids }); },

        copyToClipboard: async (text) => {
            try { await navigator.clipboard.writeText(text); } 
            catch (e) { console.error('Failed to copy text', e); }
        },
        deleteMessage: async (id) => {
            const { interactionData } = get();
            if (!interactionData) return;
            try {
                const updated = await deleteMessage(interactionData, id);
                set({ interactionData: updated });
            } catch (e) { console.error('Failed to delete message', e); }
        },
        branchChat: async (messageId) => {
            const { interactionData, allEntityFolders, saveEntityFolder } = get();
            if (!interactionData) return;
            try {
                const branchedChat = await branchMessage(interactionData, messageId);
                await saveRawInteractionData(branchedChat);
                await saveRawSessionData({ activeChatId: branchedChat.id });
                if (saveEntityFolder) {
                    const parentFolder = allEntityFolders.find(f => f.entityType === 'interactionData' && f.itemIds.includes(interactionData.id));
                    if (parentFolder) {
                        await saveEntityFolder({ ...parentFolder, itemIds: [...parentFolder.itemIds, branchedChat.id], lastUpdatedTimestamp: Date.now() });
                    }
                }
                set({ interactionData: branchedChat });
                speculativeMarkovEngine.clearSession(branchedChat.id);
            } catch (e) { console.error('Failed to branch chat', e); }
        },
        cloneChat: async (messageId) => {
            const { interactionData, allEntityFolders, saveEntityFolder } = get();
            if (!interactionData) return;
            try {
                const clonedChat = await cloneChatUpToMessage(interactionData, messageId);
                await saveRawInteractionData(clonedChat);
                await saveRawSessionData({ activeChatId: clonedChat.id });
                if (saveEntityFolder) {
                    const parentFolder = allEntityFolders.find(f => f.entityType === 'interactionData' && f.itemIds.includes(interactionData.id));
                    if (parentFolder) {
                        await saveEntityFolder({ ...parentFolder, itemIds: [...parentFolder.itemIds, clonedChat.id], lastUpdatedTimestamp: Date.now() });
                    }
                }
                set({ interactionData: clonedChat });
                speculativeMarkovEngine.clearSession(clonedChat.id);
            } catch (e) { console.error('Failed to clone chat', e); }
        },
    };
});