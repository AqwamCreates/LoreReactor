// src/App.tsx
import type React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useChatSession } from '../hooks/useChatSession';
import { useChatListManager } from '../hooks/useChatListManager';
import { useCharacterManager } from '../hooks/useCharacterManager';
import { useContextManager } from '../hooks/useContextManager';
import { useLocationManager } from '../hooks/useLocationManager';
import { useAudioTrackManager } from '../hooks/useAudioTrackManager';
import { useWorldManager } from '../hooks/useWorldManager';
import { useModelManager } from '../hooks/useModelManager';
import { useSamplerManager } from '../hooks/useSamplerManager';
import { usePromptBlockManager } from '../hooks/usePromptBlockManager';
import { useStopPatternManager } from '../hooks/useStopPatternManager';
import { useBudgetStrategyManager } from '../hooks/useBudgetStrategyManager';
import { useProfileManager } from '../hooks/useProfileManager';
import { useExtensionManager } from '../hooks/useExtensionManager';
import { useMemoryManager } from '../hooks/useMemoryManager';
import { useAccountManager } from '../hooks/useAccountManager';
import { useMultiplayerDataManager } from '../hooks/useMultiplayerDataManager';
import { useMultiplayerSync } from '../hooks/useMultiplayerSync';
import { useEntityModal } from '../hooks/useEntityModal';
import { useToast } from '../context/ToastContext';
import { saveRawInteractionData, loadRawInteractionData } from '../storage/serverStorage';
import { createChatMessage, addMessageToInteractionData } from '../hooks/chatLogic';
import { assignInitialLocationsIfNeeded } from '../hooks/locationLogic';
import { useDisplayNameCache, resolveDelayedDisplayNameFromCache } from '../hooks/immersionLogic';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getBudgetStrategyEngine, initializeBudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { buildModelLoadArguments } from '../hooks/modelLoadArguments';
import { localURL } from '../configurations';
import { speechToTextEngine } from '../services/SpeechToTextEngine';
import { formatDisplayMessageText } from '../utilities/textDisplayFormatter';
import { cloudBackends } from '../dictionaries/languageModelInformation';
import type { Character, Context, Location, AudioTrack, World, LanguageModel, Sampler, PromptBlock, StopPattern, BudgetStrategy, Profile, InteractionData, ChatMessage, MultiplayerData, Account, HistoryMessage, cloudBackend } from '../types';
import { useChatRestoration } from '../hooks/useChatRestoration';
import { useEntitySync } from '../hooks/useEntitySync';
import { useActionMenu } from '../hooks/useActionMenu';
import { useMessageActions } from '../hooks/useMessageActions';
import { useChatOperations } from '../hooks/useChatOperations';
import { useEntityToggles } from '../hooks/useEntityToggles';
import { useViewAssets } from '../hooks/useViewAssets';
import { useMessageToolbar } from '../hooks/useMessageToolbar';
import { useModalVisibility } from '../hooks/useModalVisibility';
import { useActiveExtensions } from '../hooks/useActiveExtensions';
import { useSessionStore } from '../hooks/useSessionStore';
import { ActionMenu } from './ActionMenu';
import { AppModals } from './AppModals';
import { ChatInput } from './ChatInput';
import { ContextBar } from './ContextBar';
import { LoadingScreen } from './LoadingScreen';
import { ChatInspectionModal } from './ChatInspectionModal';
import { ChatStatisticsBar } from './ChatStatisticsBar';
import { PendingJoinRequests } from './PendingJoinRequests';
import '../main.css';
import { ChatMinimap } from './ChatMinimap';

import { LadderView } from './views/LadderView';
import { CinematicView } from './views/CinematicView';
import { VisualNovelView } from './views/VisualNovelView';
import type { ViewModeProps } from './views/types';
import { defaultContextLength } from '../dictionaries/defaults';

const STORAGE_KEY_ACTIVE_CHAT = 'loreReactor_activeChatId';
const STORAGE_KEY_BUDGET_STRATEGY = 'loreReactor_selectedBudgetStrategyId';
const STORAGE_KEY_DEFAULT_CHARACTER = 'loreReactor_defaultCharacterId';
const STORAGE_KEY_SELECTED_MODEL = 'loreReactor_selectedModelId';
const MIN_LOADING_SCREEN_MS = 900;

interface LoadStep { id: string; label: string; icon: string; done: boolean }
type BudgetStrategyWithRawModelIds = BudgetStrategy & {
    _rawOnlineModelIds?: string[];
    _rawLocalModelIds?: string[];
};

function hasMessagesChanged(a: InteractionData | null, b: InteractionData): boolean {
    if (!a || !a.interactionHistory || !b.interactionHistory) return true;
    if (a.interactionHistory.length !== b.interactionHistory.length) return true;
    
    for (let i = 0; i < a.interactionHistory.length; i++) {
        const aMsg = a.interactionHistory[i];
        const bMsg = b.interactionHistory[i];
        
        if (aMsg.id !== bMsg.id) return true;
        if (aMsg.character.id !== bMsg.character.id) return true;
        
        if ('textContent' in aMsg && 'textContent' in bMsg) {
            if ((aMsg as ChatMessage).textContent !== (bMsg as ChatMessage).textContent) return true;
        }
    }
    
    return false;
}

function deriveCurrentProtagonist(
    interactionData: InteractionData | null,
    multiplayerData: MultiplayerData | null,
    currentAccountId: string | null,
): Character | null {
    if (!interactionData?.protagonists?.length) return null;
    if (!multiplayerData || !currentAccountId) {
        return interactionData.protagonists[0] ?? null;
    }
    const myCharIds = multiplayerData.accountIdCharacterIds?.[currentAccountId];
    if (myCharIds?.length) {
        const found = interactionData.protagonists.find(p => myCharIds.includes(p.id));
        if (found) return found;
    }
    return interactionData.protagonists[0] ?? null;
}

function App() {

    const { addToast } = useToast();

    // ─── Manager Hooks ───────────────────────────────────────────────
    const { rawChatShells, isLoading: chatsLoading, deleteChat: deleteChatFromList, refresh: refreshChatList, ensureLoaded: ensureChatsLoaded } = useChatListManager();
    const { characters: allCharacters, isLoading: charsLoading, saveCharacter, deleteCharacter, loadFullCharacter } = useCharacterManager();
    const { contexts: allContexts, isLoading: contextsLoading, saveContext, deleteContext } = useContextManager();
    const { locations: allLocations, isLoading: locationsLoading, saveLocation, deleteLocation } = useLocationManager();
    const { audioTracks: allAudioTracks, isLoading: audioTracksLoading, saveAudioTrack, deleteAudioTrack } = useAudioTrackManager();
    const { worlds: allWorlds, isLoading: worldsLoading, saveWorld, deleteWorld } = useWorldManager();
    const { promptBlocks: allPromptBlocks, isLoading: promptBlocksLoading, savePromptBlock, deletePromptBlock } = usePromptBlockManager();
    const { models: allModels, isLoading: modelsLoading, saveModel, deleteModel, runningModels, toggleModelLoad, selectedModelId, setSelectedModelId } = useModelManager();
    const { Samplers: allSamplers, isLoading: samplersLoading, saveSampler, deleteSampler } = useSamplerManager();
    const { stopPatterns: allStopPatterns, isLoading: stopLoading, saveStopPattern, deleteStopPattern } = useStopPatternManager();
    const { strategies: allBudgetStrategies, isLoading: budgetLoading, saveStrategy: saveBudgetStrategy, deleteStrategy: deleteBudgetStrategy } = useBudgetStrategyManager();
    const { profiles: allProfiles, isLoading: profilesLoading, saveProfile, deleteProfile } = useProfileManager();
    const { extensions: allExtensions, deleteExtension } = useExtensionManager();
    const { memories: allMemories, deleteMemory } = useMemoryManager();
    const { accounts: allAccounts, isLoading: accountsLoading, saveAccount, deleteAccount } = useAccountManager();
    const { multiplayerDatas: allMultiplayerData, isLoading: multiplayerDataLoading, saveMultiplayerData, deleteMultiplayerData } = useMultiplayerDataManager();

    const { activeIds: activeExtensionIds, setActiveIds: setActiveExtensionIds } = useActiveExtensions(allExtensions);

    // ─── Multiplayer Broadcast Bridge ────────────────────────────────
    const broadcastMessageRef = useRef<((message: HistoryMessage) => void) | undefined>(undefined);
    const onMessageBroadcast = useCallback((message: HistoryMessage) => {
        broadcastMessageRef.current?.(message);
    }, []);

    // ─── Session Hook ────────────────────────────────────────────────
    const session = useChatSession(allCharacters, { onMessageBroadcast });
    const {
        interactionData, setInteractionData, setCurrentCharacter,
        isLoading, streamingText, streamingCharacter, currentCharacterExpression, sendMessage, stopGeneration,
        resumeGeneration, regenerateFromMessage, messageEndRef, chatHistoryRef,
        startNewChat,
        sendActionAndGetResponse, setActiveBudgetStrategy, setSelectedGlobalModel,
        activeStrategy, budgetData,
    } = session;

    const currentAccountId = useSessionStore(s => s.currentAccountId);
    const multiplayerData = useSessionStore(s => s.multiplayerData);
    const defaultCharacterId = useSessionStore(s => s.defaultCharacterId);
    const selectedBudgetStrategyId = useSessionStore(s => s.selectedBudgetStrategyId);

    // ─── Join Session State ──────────────────────────────────────────
    const [joinSessionId, setJoinSessionId] = useState<string | null>(null);
    const [joinPassword, setJoinPassword] = useState<string>('');
    const [joinProtagonist, setJoinProtagonist] = useState<Character | null>(null);

    const handleJoinAccepted = useCallback(() => {
        addToast('Joined session successfully.', 'success');
    }, [addToast]);

    const handleJoinRejected = useCallback((reason: string) => {
        addToast(`Join rejected: ${reason}`, 'error');
        setJoinSessionId(null);
        setJoinPassword('');
        setJoinProtagonist(null);
    }, [addToast]);

    const handleJoinSession = useCallback((sessionId: string, password: string, protagonist: Character) => {
        if (!currentAccountId) {
            addToast('No account configured. Create an account first.', 'error');
            return;
        }
        setJoinSessionId(sessionId);
        setJoinPassword(password);
        setJoinProtagonist(protagonist);
    }, [currentAccountId, addToast]);

    // ─── Multiplayer Sync ────────────────────────────────────────────
    const multiplayerSync = useMultiplayerSync({
        interactionData,
        multiplayerData,
        currentAccountId,
        setInteractionData,
        allCharacters,
        joinSessionId,
        joinPassword,
        joinProtagonist,
        onJoinAccepted: handleJoinAccepted,
        onJoinRejected: handleJoinRejected,
    });

    useEffect(() => {
        broadcastMessageRef.current = multiplayerSync.isConnected ? multiplayerSync.broadcastMessage : undefined;
    }, [multiplayerSync.isConnected, multiplayerSync.broadcastMessage]);

    // ─── Disconnect On Chat Switch ──────────────────────────────────
    const previousChatIdRef = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        const currentChatId = interactionData?.id ?? null;
        const previousChatId = previousChatIdRef.current;

        if (previousChatId !== undefined && previousChatId !== null && previousChatId !== currentChatId) {
            multiplayerSync.disconnect();
            setJoinSessionId(null);
            setJoinPassword('');
            setJoinProtagonist(null);
        }

        previousChatIdRef.current = currentChatId;
    }, [interactionData?.id, multiplayerSync]);

    // ─── Auto-load Multiplayer Data For Active Chat ─────────────────
    useEffect(() => {
        if (!interactionData?.id) return;

        // If already loaded and matches current chat, do nothing
        if (multiplayerData?.interactionDataIds?.includes(interactionData.id)) return;

        // Find matching multiplayer session for this chat
        const matchingMpData = allMultiplayerData.find(md =>
            md.interactionDataIds.includes(interactionData.id!)
        );

        if (matchingMpData) {
            useSessionStore.setState({ multiplayerData: matchingMpData });
        } else if (multiplayerData && !joinSessionId) {
            // Clear multiplayer data when switching to a non-multiplayer chat
            // (but not when joining — join uses synthetic effectiveMultiplayerData)
            useSessionStore.setState({ multiplayerData: null });
        }
    }, [interactionData?.id, allMultiplayerData, multiplayerData, joinSessionId]);

    const localProtagonist = useMemo(
        () => deriveCurrentProtagonist(interactionData, multiplayerData, currentAccountId),
        [interactionData, multiplayerData, currentAccountId],
    );

    const currentCharacter = localProtagonist;

    const setDefaultCharacterId = useCallback((id: string | null) => {
        useSessionStore.setState({ defaultCharacterId: id });
        if (id) localStorage.setItem(STORAGE_KEY_DEFAULT_CHARACTER, id);
        else localStorage.removeItem(STORAGE_KEY_DEFAULT_CHARACTER);
    }, []);

    const setSelectedBudgetStrategyId = useCallback((id: string | null) => {
        useSessionStore.setState({ selectedBudgetStrategyId: id });
        if (id) localStorage.setItem(STORAGE_KEY_BUDGET_STRATEGY, id);
        else localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY);
    }, []);

    const charModal = useEntityModal<Character>(saveCharacter, deleteCharacter, 'Character');
    const contextModal = useEntityModal<Context>(saveContext, deleteContext, 'Context');
    const locationModal = useEntityModal<Location>(saveLocation, deleteLocation, 'Location');
    const audioTrackModal = useEntityModal<AudioTrack>(saveAudioTrack, deleteAudioTrack, 'Audio Track');
    const worldModal = useEntityModal<World>(saveWorld, deleteWorld, 'World');
    const modelModal = useEntityModal<LanguageModel>(saveModel, deleteModel, 'Model');
    const samplerModal = useEntityModal<Sampler>(saveSampler, deleteSampler, 'Sampler');
    const promptBlockModal = useEntityModal<PromptBlock>(savePromptBlock, deletePromptBlock, 'Prompt Block');
    const stopModal = useEntityModal<StopPattern>(saveStopPattern, deleteStopPattern, 'Stop Pattern');
    const budgetModal = useEntityModal<BudgetStrategy>(saveBudgetStrategy, deleteBudgetStrategy, 'Budget Strategy');
    const profileModal = useEntityModal<Profile>(saveProfile, deleteProfile, 'Profile');
    const accountModal = useEntityModal<Account>(saveAccount, deleteAccount, 'Account');
    const multiplayerDataModal = useEntityModal<MultiplayerData>(saveMultiplayerData, deleteMultiplayerData, 'Multiplayer Data');

    const [inspectionStack, setInspectionStack] = useState<InteractionData[]>([]);
    const [isInspectionOpen, setIsInspectionOpen] = useState(false);

    const { modals } = useModalVisibility();
    const [maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens, setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens] = useState<number>(0);
    const [isRecording, setIsRecording] = useState(false);
    const [viewMode, setViewMode] = useState<'ladder' | 'cinematic' | 'vn'>('ladder');
    const [inputText, setInputText] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);

    const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);

    const { activeChatRestored } = useChatRestoration({
        charsLoading, chatsLoading, contextsLoading, locationsLoading, profilesLoading,
        allCharacters, rawChatShells, loadFullCharacter,
        setInteractionData, setCurrentCharacter, setSelectedModelId, startNewChat,
    });

    useEntitySync({
        activeChatRestored,
        allCharacters, allContexts, allProfiles,
        currentCharacter, setInteractionData, setCurrentCharacter,
    });

    const isModelReady = useMemo(() => {
        if (activeStrategy) return true;
        if (!selectedModelId) return false;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend as cloudBackend)) return true;
        return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle === true;
    }, [selectedModelId, allModels, runningModels, activeStrategy]);

    const {
        actionMenuTarget, menuSearchQuery, setMenuSearchQuery,
        actionsLoading, showActionFormat, setShowActionFormat,
        actionWrap, setActionWrap, actionCase, setActionCase, actionPunctuation, setActionPunctuation,
        handleAddAction, handleDeleteAction, handleActionInterject,
        getFilteredActions, handleAvatarClick, closeActionMenu,
    } = useActionMenu({
        interactionData, currentCharacter, isLoading, isModelReady,
        allCharacters, stopGeneration,
        sendActionAndGetResponse,
        addToast,
    });

    const {
        editingId, editDraft, setEditDraft, massDeleteId, setMassDeleteId,
        handleSaveEdit, handleRegenerateFromEdit, handleDelete, handleMassDeleteConfirm,
        handleBranch, handleClone, handleCopyText, startEditing, cancelEditing,
    } = useMessageActions({
        interactionData, localProtagonist, isModelReady, isLoading,
        setInteractionData, setCurrentCharacter, refreshChatList,
        regenerateFromMessage,
        addToast,
    });

    const {
        isEditingTitle, editTitleValue, setEditTitleValue,
        handleSwitchChat, handleNewChat, handleDeleteChat,
        handleStartEditTitle, handleSaveTitle, cancelEditTitle,
    } = useChatOperations({
        interactionData, currentCharacter, localProtagonist, defaultCharacterId,
        allCharacters, rawChatShells, setInteractionData, setCurrentCharacter,
        refreshChatList, startNewChat, deleteChatFromList, addToast,
    });

    const {
        handleToggleParticipant, handleToggleContext, handleToggleLocation, handleToggleAudioTrack,
        handleSetChatProtagonist, handleToggleExtension,
        handleActivateBudgetStrategy, handleActivateProfile,
    } = useEntityToggles({
        interactionData, allCharacters,
        activeExtensionIds,
        setActiveExtensionIds,
        allProfiles, allBudgetStrategies, selectedBudgetStrategyId,
        setInteractionData, setCurrentCharacter, setActiveBudgetStrategy,
        setSelectedBudgetStrategyId, setDefaultCharacterId,
        loadFullCharacter, addToast,
    });

    const {
        centerAvatar, lastViewedMessageIdRef, suppressAutoScrollRef,
        chatMessages, portraitUrlCache, streamingPortraitUrl, locationBackgroundUrl,
    } = useViewAssets({
        viewMode, interactionData, localProtagonist, currentCharacter,
        streamingCharacter, currentCharacterExpression, chatHistoryRef,
    });

    const {
        activeToolbarId, deactivateToolbar,
        handleBubbleTouchStart, handleBubbleTouchEnd, handleBubbleTouchMove,
        suppressNextClickRef,
    } = useMessageToolbar({ chatHistoryRef });

    const displayNameCache = useDisplayNameCache(interactionData);

    const formattedStreamingText = useMemo(() => {
        if (!streamingText) return null;
        return formatDisplayMessageText(streamingText);
    }, [streamingText]);

    const isModelLoading = useMemo(() => {
        if (!selectedModelId) return false;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend as cloudBackend)) return false;
        return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle !== true;
    }, [selectedModelId, allModels, runningModels]);

    const modelStatusMessage = !selectedModelId ? 'No model selected — open Language Models to load one' : isModelLoading ? 'Model is warming up... please wait' : '';
    const isMassActive = massDeleteId !== null;
    const safeInteractionMessages = useMemo(() => chatMessages || [], [chatMessages]);

    const maximumNumberOfContextTokens = useMemo(() => {
        if (!interactionData?.contexts?.length) return 0;
        let total = 0;
        for (const ctx of interactionData.contexts) { if (ctx.text) total += Math.ceil(ctx.text.length / 4); }
        return total;
    }, [interactionData]);

    const maximumContextLength = useMemo(() => {
        if (activeStrategy) {
            let max = 0;
            for (const m of activeStrategy.onlineModels) {
                if (m.contextLength > max) max = m.contextLength;
            }
            for (const m of activeStrategy.localModels) {
                if (m.contextLength > max) max = m.contextLength;
            }
            return max || defaultContextLength;
        }
        if (selectedModelId) {
            const m = allModels.find(x => x.id === selectedModelId);
            return m?.contextLength || defaultContextLength;
        }
        return defaultContextLength;
    }, [activeStrategy, selectedModelId, allModels]);

    const parentInteractionDataName = useMemo(() => {
        if (!interactionData?.parentInteractionDataId) return null;
        const parentShell = rawChatShells.find(s => s.id === interactionData.parentInteractionDataId);
        return parentShell?.name ?? null;
    }, [interactionData, rawChatShells]);

    const loadLocalModelForBudgetStrategyEngine = useCallback(async (modelId: string): Promise<number | null> => {
        const existing = runningModels[modelId];
        if (existing?.port) return existing.port;
        const targetModel =
            activeStrategy?.localModels.find(m => m.id === modelId) ||
            activeStrategy?.onlineModels.find(m => m.id === modelId) ||
            allModels.find(m => m.id === modelId);
        if (!targetModel) return null;
        if (targetModel.apiKey && targetModel.backend) return null;
        try {
            const modelPath = targetModel.model || '';
            const args = buildModelLoadArguments(targetModel);
            const response = await fetch(`${localURL}/models/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: targetModel.id, modelPath, args }),
            });
            if (!response.ok) return null;
            const responseData = await response.json();
            return responseData.port ?? null;
        } catch (error) {
            console.warn(`Auto-load of model ${targetModel.name} failed:`, error);
            return null;
        }
    }, [runningModels, activeStrategy, allModels]);

    // ─── Effects ────────────────────────────────────────────────────
    useEffect(() => {
        const enabled = interactionData?.Profile?.enableCharacterExpression ?? false;
        if (enabled) sentimentEngine.initialize(); else sentimentEngine.unload();
    }, [interactionData?.Profile?.enableCharacterExpression]);

    useEffect(() => { void selectedModelId; void runningModels; getLanguageModelEngine().clearTokenCache(); }, [selectedModelId, runningModels]);
    useEffect(() => { if (interactionData?.id) localStorage.setItem(STORAGE_KEY_ACTIVE_CHAT, interactionData.id); }, [interactionData?.id]);
    useEffect(() => { if (selectedModelId) localStorage.setItem(STORAGE_KEY_SELECTED_MODEL, selectedModelId); else localStorage.removeItem(STORAGE_KEY_SELECTED_MODEL); }, [selectedModelId]);

    useEffect(() => {
        if (!selectedBudgetStrategyId || allBudgetStrategies.length === 0) return;
        const strategy = allBudgetStrategies.find(s => s.id === selectedBudgetStrategyId);
        if (!strategy) { localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY); return; }
        const modelMap = new Map(allModels.map(m => [m.id, m]));
        const freshOnline = strategy.onlineModels.map(m => modelMap.get(m.id)).filter((m): m is LanguageModel => !!m);
        const freshLocal = strategy.localModels.map(m => modelMap.get(m.id)).filter((m): m is LanguageModel => !!m);
        setActiveBudgetStrategy({ ...strategy, onlineModels: freshOnline, localModels: freshLocal });
    }, [selectedBudgetStrategyId, allBudgetStrategies, allModels, setActiveBudgetStrategy]);

    useEffect(() => {
        if (!selectedModelId || allModels.length === 0) return;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (!selectedModel) { setSelectedModelId(null); return; }
        const isCloudModel = !!selectedModel.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend as cloudBackend);
        if (isCloudModel) return;
        if (!runningModels[selectedModelId]?.isRunning) setSelectedModelId(null);
    }, [selectedModelId, allModels, runningModels, setSelectedModelId]);

    useEffect(() => {
        if (defaultCharacterId && allCharacters.length > 0) {
            const c = allCharacters.find(x => x.id === defaultCharacterId);
            if (c && currentCharacter?.id !== c.id) setCurrentCharacter(c);
        }
    }, [defaultCharacterId, allCharacters, currentCharacter?.id, setCurrentCharacter]);

    useEffect(() => {
        if (selectedModelId && runningModels[selectedModelId]?.isRunning) {
            const m = allModels.find(x => x.id === selectedModelId);
            const p = runningModels[selectedModelId].port;
            if (m && p) setSelectedGlobalModel({ ...m, parameters: { ...m.parameters, _runtimePort: p } });
        } else if (selectedModelId) {
            setSelectedGlobalModel(allModels.find(x => x.id === selectedModelId) || null);
        } else setSelectedGlobalModel(null);
    }, [selectedModelId, runningModels, allModels, setSelectedGlobalModel]);

    useEffect(() => {
        if (!activeStrategy) return;
        let stratChanged = false;
        const updatedStrat = { ...activeStrategy };
        const strategyWithRawModelIds = activeStrategy as BudgetStrategyWithRawModelIds;
        const savedOnlineIds = strategyWithRawModelIds._rawOnlineModelIds || activeStrategy.onlineModels.map((m: LanguageModel) => m.id);
        const freshOnlineModels: LanguageModel[] = [];
        for (const mid of savedOnlineIds) { const fresh = allModels.find(x => x.id === mid); if (fresh) freshOnlineModels.push(fresh); }
        if (freshOnlineModels.length !== activeStrategy.onlineModels.length || freshOnlineModels.some((m, i) => m.id !== activeStrategy.onlineModels[i]?.id)) { updatedStrat.onlineModels = freshOnlineModels; stratChanged = true; }
        const savedLocalIds = strategyWithRawModelIds._rawLocalModelIds || activeStrategy.localModels.map((m: LanguageModel) => m.id);
        const freshLocalModels: LanguageModel[] = [];
        for (const mid of savedLocalIds) { const fresh = allModels.find(x => x.id === mid); if (fresh) freshLocalModels.push(fresh); }
        if (freshLocalModels.length !== activeStrategy.localModels.length || freshLocalModels.some((m, i) => m.id !== activeStrategy.localModels[i]?.id)) { updatedStrat.localModels = freshLocalModels; stratChanged = true; }
        if (stratChanged) setActiveBudgetStrategy(updatedStrat);
    }, [activeStrategy, allModels, setActiveBudgetStrategy]);

    useEffect(() => {
        if (!activeStrategy || !budgetData) return;
        try {
            const budgetStrategyEngine = getBudgetStrategyEngine();
            budgetStrategyEngine.setStrategy(activeStrategy);
            budgetStrategyEngine.setBudgetData(budgetData);
            budgetStrategyEngine.setRunningModels(runningModels);
            budgetStrategyEngine.setLoadLocalModel(loadLocalModelForBudgetStrategyEngine);
        } catch {
            initializeBudgetStrategyEngine(activeStrategy, budgetData, runningModels, loadLocalModelForBudgetStrategyEngine);
        }
    }, [activeStrategy, budgetData, runningModels, loadLocalModelForBudgetStrategyEngine]);

    const loadSteps = useMemo<LoadStep[]>(() => [
        { id: 'chats', label: 'Chat Sessions', icon: '💬', done: !chatsLoading },
        { id: 'characters', label: 'Characters', icon: '🎭', done: !charsLoading },
        { id: 'actions', label: 'Actions', icon: '⚡', done: !actionsLoading },
        { id: 'contexts', label: 'Contexts', icon: '📜', done: !contextsLoading },
        { id: 'locations', label: 'Locations', icon: '📍', done: !locationsLoading },
        { id: 'audioTracks', label: 'Audio Tracks', icon: '🔊', done: !audioTracksLoading },
        { id: 'worlds', label: 'Worlds', icon: '🌍', done: !worldsLoading },
        { id: 'promptBlocks', label: 'Prompt Blocks', icon: '🧱', done: !promptBlocksLoading },
        { id: 'models', label: 'Language Models', icon: '🤖', done: !modelsLoading },
        { id: 'samplers', label: 'Samplers', icon: '🎚️', done: !samplersLoading },
        { id: 'stopPatterns', label: 'Stop Patterns', icon: '🛑', done: !stopLoading },
        { id: 'budget', label: 'Budget', icon: '💰', done: !budgetLoading },
        { id: 'profiles', label: 'Profiles', icon: '👤', done: !profilesLoading },
        { id: 'accounts', label: 'Accounts', icon: '🔑', done: !accountsLoading },
        { id: 'multiplayerData', label: 'Multiplayer Data', icon: '👥', done: !multiplayerDataLoading },
    ], [chatsLoading, charsLoading, actionsLoading, contextsLoading, locationsLoading, audioTracksLoading, worldsLoading, promptBlocksLoading, modelsLoading, samplersLoading, stopLoading, budgetLoading, profilesLoading, accountsLoading, multiplayerDataLoading]);

    const [isInitializing, setIsInitializing] = useState(true);
    const [isFadeOut, setIsFadeOut] = useState(false);
    const loadingStartedAtRef = useRef<number | null>(null);
    const chatModifiedRef = useRef(false);
    const previousMessageCountRef = useRef<number>(0);
    const previousInteractionDataRef = useRef<InteractionData | null>(null);

    useEffect(() => {
        if (!isInitializing) return;
        const allDone = loadSteps.every(s => s.done);
        if (!allDone || !activeChatRestored || !interactionData) return;
        const loadingStartedAt = loadingStartedAtRef.current ?? Date.now();
        loadingStartedAtRef.current = loadingStartedAt;
        const remaining = Math.max(0, MIN_LOADING_SCREEN_MS - (Date.now() - loadingStartedAt));
        const hold = setTimeout(() => { setIsFadeOut(true); const fade = setTimeout(() => { setIsInitializing(false); setIsFadeOut(false); }, 300); return () => clearTimeout(fade); }, remaining);
        return () => clearTimeout(hold);
    }, [loadSteps, isInitializing, activeChatRestored, interactionData]);

    useEffect(() => {
        if (!isInitializing && activeChatRestored) ensureChatsLoaded();
    }, [isInitializing, activeChatRestored, ensureChatsLoaded]);

    useEffect(() => {
        chatModifiedRef.current = false;
        previousMessageCountRef.current = interactionData?.interactionHistory?.length ?? 0;
    }, [interactionData?.interactionHistory?.length]);

    useEffect(() => {
        if (!interactionData || !interactionData.id) return;
        
        const historyLength = interactionData.interactionHistory?.length ?? 0;
        const protagonistIds = new Set(interactionData.protagonists?.map(p => p.id) ?? []);
        const nonProtagParticipants = interactionData.participants.filter(p => !protagonistIds.has(p.id));
        const hasContent = nonProtagParticipants.length > 0 || historyLength > 0 || (interactionData.contexts?.length ?? 0) > 0 || (interactionData.locations?.length ?? 0) > 0 || (interactionData.audioTracks?.length ?? 0) > 0 || !!interactionData.Profile;
        
        if (!chatModifiedRef.current && hasContent) chatModifiedRef.current = true;
        
        if (chatModifiedRef.current && historyLength !== previousMessageCountRef.current) {
            const previousData = previousInteractionDataRef.current;
            
            const prevProtagonistIds = new Set(previousData?.protagonists?.map(p => p.id) ?? []);
            const currProtagonistIds = new Set(interactionData.protagonists?.map(p => p.id) ?? []);
            const protagonistsChanged = prevProtagonistIds.size !== currProtagonistIds.size ||
                [...prevProtagonistIds].some(id => !currProtagonistIds.has(id));

            const hasActualChange = !previousData || 
                previousData.interactionHistory?.length !== historyLength ||
                previousData.name !== interactionData.name ||
                protagonistsChanged ||
                previousData.participants.length !== interactionData.participants.length ||
                previousData.contexts?.length !== interactionData.contexts?.length ||
                previousData.locations?.length !== interactionData.locations?.length ||
                previousData.audioTracks?.length !== interactionData.audioTracks?.length ||
                hasMessagesChanged(previousData, interactionData);
            
            if (hasActualChange) {
                previousMessageCountRef.current = historyLength;
                previousInteractionDataRef.current = interactionData;
                saveRawInteractionData(interactionData).catch(e => console.error('Failed to save chat:', e));
                
                if (!rawChatShells.some(c => c.id === interactionData.id)) {
                    refreshChatList();
                }
            }
        }
    }, [interactionData, rawChatShells, refreshChatList]);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const editTextareaRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { if (!textareaRef.current) return; textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, window.innerHeight * 0.3)}px`; });
    useEffect(() => { if (!editTextareaRef.current || !editingId) return; editTextareaRef.current.style.height = 'auto'; editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`; });

    const tokenCountAbortRef = useRef<AbortController | null>(null);
    const tokenCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastCountedMessageIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (tokenCountTimerRef.current) { clearTimeout(tokenCountTimerRef.current); tokenCountTimerRef.current = null; }
        if (tokenCountAbortRef.current) { tokenCountAbortRef.current.abort(); tokenCountAbortRef.current = null; }
        tokenCountTimerRef.current = setTimeout(async () => {
            if (safeInteractionMessages.length === 0 || !interactionData?.participants) {
                setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens(0);
                lastCountedMessageIdsRef.current.clear();
                return;
            }
            const abort = new AbortController();
            tokenCountAbortRef.current = abort;
            try {
                const participantCounts: Record<string, number> = {};
                for (const p of interactionData.participants) participantCounts[p.id] = 0;
                let tokenizerModel: LanguageModel | undefined;
                if (selectedModelId) tokenizerModel = allModels.find(m => m.id === selectedModelId);
                if (!tokenizerModel && activeStrategy && activeStrategy.onlineModels.length > 0) tokenizerModel = activeStrategy.onlineModels[0];
                if (!tokenizerModel && activeStrategy && activeStrategy.localModels.length > 0) tokenizerModel = activeStrategy.localModels[0];
                const engine = getLanguageModelEngine();
                if (tokenizerModel) { engine.setRunningModels(runningModels); engine.setContext(tokenizerModel); } else return;
                const prevCountedIds = lastCountedMessageIdsRef.current;
                const currentMessageIds = new Set<string>();
                let hasNewMessages = false;
                for (const msg of safeInteractionMessages) { currentMessageIds.add(msg.id); if (!prevCountedIds.has(msg.id)) hasNewMessages = true; }
                if (!hasNewMessages && prevCountedIds.size === currentMessageIds.size) return;
                for (const msg of safeInteractionMessages) {
                    if (abort.signal.aborted) return;
                    if (prevCountedIds.has(msg.id)) continue;
                    if (msg.character && (msg as ChatMessage).textContent) {
                        const charId = msg.character.id;
                        if (participantCounts[charId] !== undefined || charId === '__ambient_narrator__') {
                            const tokens = await engine.countTokens((msg as ChatMessage).textContent);
                            if (abort.signal.aborted) return;
                            if (participantCounts[charId] !== undefined) participantCounts[charId] += tokens;
                        }
                    }
                }
                lastCountedMessageIdsRef.current = currentMessageIds;
                if (!abort.signal.aborted) setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens(Math.max(...Object.values(participantCounts), 0));
            } catch (e) { if ((e as Error).name !== 'AbortError') console.error('Token counting failed:', e); }
        }, 500);
        return () => { if (tokenCountTimerRef.current) { clearTimeout(tokenCountTimerRef.current); tokenCountTimerRef.current = null; } if (tokenCountAbortRef.current) { tokenCountAbortRef.current.abort(); tokenCountAbortRef.current = null; } };
    }, [safeInteractionMessages, interactionData?.participants, selectedModelId, allModels, runningModels, activeStrategy]);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        const newFiles = fileList ? Array.from(fileList) : [];
        if (newFiles.length > 0) { setPendingFiles(prev => [...prev, ...newFiles]); addToast(`${newFiles.length} file${newFiles.length !== 1 ? 's' : ''} attached.`); }
        requestAnimationFrame(() => { if (fileInputRef.current) fileInputRef.current.value = ''; });
    };

    const handleToggleMicrophone = useCallback(async () => {
        if (isRecording) { await speechToTextEngine.stopRecording(); setIsRecording(false); }
        else {
            const started = await speechToTextEngine.startRecording((text) => { setInputText(prev => prev + (prev ? ' ' : '') + text); });
            if (!started) { addToast('Failed to start voice input. Check microphone permissions.', 'error'); return; }
            setIsRecording(true);
        }
    }, [isRecording, addToast]);

    const handleSend = useCallback(() => {
        if (!inputText.trim() && !pendingFiles.length) return;
        sendMessage(inputText, pendingFiles);
        setInputText('');
        setPendingFiles([]);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }, [inputText, pendingFiles, sendMessage]);

    const toggleViewMode = () => {
        setViewMode(prev => prev === 'ladder' ? 'cinematic' : prev === 'cinematic' ? 'vn' : 'ladder');
        const container = chatHistoryRef.current;
        let targetIdx = -1;
        if (container && interactionData) {
            const cr = container.getBoundingClientRect();
            const ids = new Set(safeInteractionMessages.map(m => m.id));
            let bestTop = Number.POSITIVE_INFINITY;
            for (const el of container.querySelectorAll('[data-message-id]')) {
                const id = el.getAttribute('data-message-id'); if (!id || !ids.has(id)) continue;
                const r = el.getBoundingClientRect();
                if (r.top < cr.bottom && r.bottom > cr.top && r.top < bestTop) { bestTop = r.top; targetIdx = safeInteractionMessages.findIndex(m => m.id === id); }
            }
        }
        if (targetIdx === -1 && lastViewedMessageIdRef.current && interactionData) targetIdx = safeInteractionMessages.findIndex(m => m.id === lastViewedMessageIdRef.current);
        if (targetIdx >= 0 && interactionData) lastViewedMessageIdRef.current = safeInteractionMessages[targetIdx].id;
        suppressAutoScrollRef.current = true;
        setTimeout(() => {
            if (targetIdx >= 0 && interactionData && chatHistoryRef.current) {
                const el = chatHistoryRef.current.querySelector(`[data-message-id="${safeInteractionMessages[targetIdx].id}"]`) as HTMLElement | null;
                if (el) { el.scrollIntoView({ block: 'start' }); setTimeout(() => { suppressAutoScrollRef.current = false; }, 400); return; }
            }
            messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setTimeout(() => { suppressAutoScrollRef.current = false; }, 400);
        }, 50);
    };

    const handleImportComplete = useCallback(() => { getLanguageModelEngine().clearTokenCache(); refreshChatList(); }, [refreshChatList]);

    const handleForceFirstMessage = useCallback(async (character: Character) => {
        if (!interactionData) return;
        const chatMessage = createChatMessage(interactionData, character, `*${character.name} enters the scene.*`);
        const updated = addMessageToInteractionData(interactionData, chatMessage);
        setInteractionData(updated);
        await saveRawInteractionData(updated); addToast(`Sent first message as ${character.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleSendCustomMessage = useCallback(async (character: Character, text: string) => {
        if (!interactionData) return;
        const chatMessage = createChatMessage(interactionData, character, text);
        const updated = addMessageToInteractionData(interactionData, chatMessage);
        setInteractionData(updated);
        await saveRawInteractionData(updated); addToast(`Sent message as ${character.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleInjectCustomMessage = useCallback(async (character: Character, text: string) => {
        if (!interactionData) return;
        const injectedContext: Context = { id: crypto.randomUUID(), name: `[Injected] ${character.name}`, description: 'User-injected message for LLM context', text: `${character.name}: ${text}`, isAutoGenerated: true, useBase64Encoding: false, insertionDepth: 0, tokenBudget: 512, limitLinksToSubdirectory: false, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now() };
        const updated: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), injectedContext], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updated);
        await saveRawInteractionData(updated); addToast(`Injected custom message as ${character.name} into LLM context`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleInjectFirstMessage = useCallback(async (character: Character) => {
        if (!interactionData) return;
        const injectedContext: Context = { id: crypto.randomUUID(), name: `[Injected First] ${character.name}`, description: 'User-injected first message for LLM context', text: `${character.name}: *${character.name} enters the scene.*`, isAutoGenerated: true, useBase64Encoding: false, insertionDepth: 0, tokenBudget: 512, limitLinksToSubdirectory: false, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now() };
        const updated: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), injectedContext], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updated);
        await saveRawInteractionData(updated); addToast(`Injected first message as ${character.name} into LLM context`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const onDeleteChatForModals = useCallback((id: string) => {
        handleDeleteChat({ stopPropagation: () => {} } as React.MouseEvent, id);
    }, [handleDeleteChat]);

    const handleRenameChat = useCallback(async (id: string, name: string) => {
        const loaded = await loadRawInteractionData(id, allCharacters);
        if (!loaded) { addToast('Chat not found.', 'error'); return; }
        const updated = { ...loaded, name, lastUpdatedTimestamp: Date.now() };
        await saveRawInteractionData(updated);
        refreshChatList();
        if (interactionData?.id === id) setInteractionData({ ...interactionData, name, lastUpdatedTimestamp: Date.now() });
        addToast(`Renamed to "${name}"`, 'success');
    }, [allCharacters, interactionData, setInteractionData, refreshChatList, addToast]);

    const handleNavigateToBranchSource = useCallback(async () => {
        if (!interactionData?.parentInteractionDataId) return;
        try {
            const source = await loadRawInteractionData(interactionData.parentInteractionDataId, allCharacters);
            if (source) {
                setInteractionData(source);
                const sourceMultiplayerData = useSessionStore.getState().multiplayerData;
                const sourceProtagonist = deriveCurrentProtagonist(source, sourceMultiplayerData, currentAccountId);
                if (sourceProtagonist) setCurrentCharacter(sourceProtagonist);
                refreshChatList();
                addToast(`Returned to source: "${source.name}"`, 'info');
            }
            else addToast('Source chat not found.', 'error');
        } catch { addToast('Failed to load source chat.', 'error'); }
    }, [interactionData, allCharacters, currentAccountId, setInteractionData, setCurrentCharacter, refreshChatList, addToast]);

    const handleLoadWorld = useCallback(async (world: World) => {
        if (!interactionData) return;
        const resolvedChars = world.characterIds.map(id => allCharacters.find(c => c.id === id)).filter((c): c is Character => !!c);
        const resolvedCtxs = world.contextIds.map(id => allContexts.find(c => c.id === id)).filter((c): c is Context => !!c);
        const resolvedLocs = world.locationIds.map(id => allLocations.find(l => l.id === id)).filter(l => l !== undefined);
        const resolvedAudioTracks = (world.audioTrackIds || []).map(id => allAudioTracks.find(t => t.id === id)).filter((t): t is AudioTrack => !!t);
        const resolvedProfile = world.profileId ? allProfiles.find(p => p.id === world.profileId) : undefined;
        let updated: InteractionData = { ...interactionData, participants: resolvedChars.length > 0 ? resolvedChars : interactionData.participants, contexts: resolvedCtxs, locations: resolvedLocs, audioTracks: resolvedAudioTracks.length > 0 ? resolvedAudioTracks : [], Profile: resolvedProfile, lastUpdatedTimestamp: Date.now() };
        if (updated.protagonists) {
            for (const protag of updated.protagonists) {
                if (!updated.participants.find(p => p.id === protag.id)) {
                    updated.participants = [protag, ...updated.participants];
                }
            }
        }
        updated = assignInitialLocationsIfNeeded(updated);
        setInteractionData(updated);
        await saveRawInteractionData(updated);
        addToast(`Loaded world "${world.name}"`, 'success');
    }, [interactionData, allCharacters, allContexts, allLocations, allAudioTracks, allProfiles, setInteractionData, addToast]);

    const handleInspectParentInteractionData = useCallback(async (parentId: string): Promise<InteractionData> => {
        const loaded = await loadRawInteractionData(parentId, allCharacters);
        if (!loaded) throw new Error(`Failed to load parent chat ${parentId}`);
        return loaded;
    }, [allCharacters]);

    const handleOpenChatInspection = useCallback(async (chatId: string) => {
        const loaded = await loadRawInteractionData(chatId, allCharacters);
        if (!loaded) { addToast('Failed to load chat for inspection.', 'error'); return; }
        setInspectionStack([loaded]);
        setIsInspectionOpen(true);
    }, [allCharacters, addToast]);

    // ─── Render ────────────────────────────────────────────────────

    const displayMessages = useMemo(() => {
        const base = [...safeInteractionMessages];

        if (isLoading && streamingText && streamingCharacter) {
            const last = base[base.length - 1];
            const isLastMessagePartial = last?.isPartial && last.character.id === streamingCharacter.id;
            const isNewTurn = !last || last.character.id !== streamingCharacter.id;

            if (isLastMessagePartial) {
                const lastIndex = base.length - 1;
                const resolvedName = resolveDelayedDisplayNameFromCache(
                    displayNameCache,
                    lastIndex,
                    streamingCharacter.id
                );
                (base[lastIndex] as any).textContent = streamingText;
                (base[lastIndex] as any).character = { ...last!.character, name: resolvedName };
            } else if (isNewTurn) {
                const streamingIndex = base.length;
                const resolvedName = resolveDelayedDisplayNameFromCache(
                    displayNameCache,
                    streamingIndex,
                    streamingCharacter.id
                );

                base.push({
                    id: `streaming-${streamingCharacter.id}`,
                    messageType: 'chat',
                    character: { ...streamingCharacter, name: resolvedName },
                    textContent: streamingText,
                    isPartial: true,
                    files: [],
                    firstCreatedTimestamp: 0,
                    lastUpdatedTimestamp: 0,
                    locationIndex: undefined,
                    characterLockedLocations: {},
                    parentInteractionMessageId: null,
                } as any);
            }
        }
        return base;
    }, [safeInteractionMessages, isLoading, streamingText, streamingCharacter, displayNameCache]);

    const massStartIndex = isMassActive ? displayMessages.findIndex(m => m.id === massDeleteId) : -1;

    // Derived state — computed during render, not via effect
    const timeUntilReset = useMemo(() => {
        if (budgetData && activeStrategy && budgetData.resetDuration > 0) {
            return Math.max(0, budgetData.resetDuration - (Date.now() - budgetData.lastResetTimestamp));
        }
        return undefined;
    }, [budgetData, activeStrategy]);

    const viewProps: ViewModeProps = {
        interactionData: interactionData!,
        localProtagonist: localProtagonist!,
        displayMessages,
        currentCharacterId: currentCharacter?.id,
        editingId,
        editDraft,
        massDeleteId,
        isMassActive,
        massStartIndex,
        activeToolbarId,
        portraitUrlCache,
        displayNameCache,
        characterScales: new Map(),
        centerAvatar,
        streamingPortraitUrl,
        formattedStreamingText,
        locationBackgroundUrl,
        isLoading,
        isEditingTitle,
        editTitleValue,
        parentInteractionMessageId: interactionData?.parentInteractionMessageId ?? null,
        parentInteractionDataName,
        streamingCharacter,
        chatHistoryRef,
        messageEndRef,
        editTextareaRef,
        focusedMessageId,
        setFocusedMessageId,
        onAvatarClick: handleAvatarClick,
        onStartEditing: startEditing,
        onCancelEditing: cancelEditing,
        onSaveEdit: handleSaveEdit,
        onRegenerateFromEdit: handleRegenerateFromEdit,
        onResumeGeneration: (id: string) => { resumeGeneration(id); },
        onCopyText: handleCopyText,
        onRegenerateFromMessage: regenerateFromMessage,
        onBranch: handleBranch,
        onClone: handleClone,
        onDelete: handleDelete,
        onSetMassDelete: setMassDeleteId,
        onMassDeleteConfirm: handleMassDeleteConfirm,
        onCancelMassDelete: () => setMassDeleteId(null),
        onTouchStart: handleBubbleTouchStart,
        onTouchEnd: handleBubbleTouchEnd,
        onTouchMove: handleBubbleTouchMove,
        suppressNextClickRef,
        setEditDraft,
        onNavigateToBranchSource: handleNavigateToBranchSource,
        onStartEditTitle: handleStartEditTitle,
        onSaveTitle: handleSaveTitle,
        onCancelEditTitle: cancelEditTitle,
        setEditTitleValue,
        closeActionMenu,
        deactivateToolbar,
        onStopGeneration: stopGeneration,
    };

    const containerClass = [
        'chat-container',
        viewMode === 'cinematic' ? 'mode-cinematic' : '',
        viewMode === 'vn' ? 'mode-vn' : '',
        viewMode === 'ladder' ? 'mode-ladder' : '',
        locationBackgroundUrl ? 'has-location-bg' : '',
    ].filter(Boolean).join(' ');

    return (
        <>
            {isInitializing && <LoadingScreen steps={loadSteps} isFadeOut={isFadeOut} />}
            
            <div 
                className={containerClass} 
                style={locationBackgroundUrl && viewMode !== 'vn' ? { '--location-bg': `url(${locationBackgroundUrl})` } as React.CSSProperties : undefined} 
                onClick={() => { closeActionMenu(); deactivateToolbar(); }}
            >
                {!interactionData && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', opacity: 0.5, gap: '12px' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent)' }}>⚛️ LoreReactor</div>
                        <div style={{ fontSize: '0.85rem' }}>Create a character to begin.</div>
                        <button type="button" onClick={() => charModal.open()} style={{ marginTop: '8px', padding: '8px 20px', fontSize: '0.85rem', fontWeight: 'bold', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>🎭 Create Character</button>
                    </div>
                )}

                {interactionData && (
                    <>
                        <header className="app-header">
                            <div className="header-content">
                                <div className="header-top">
                                    {viewMode === 'ladder' && interactionData && safeInteractionMessages.length > 5 && (
                                        <ChatMinimap
                                            messages={safeInteractionMessages.filter((m): m is ChatMessage => m.messageType === 'chat')}
                                            containerRef={chatHistoryRef}
                                            currentCharacterId={currentCharacter?.id}
                                        />
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                        {isEditingTitle
                                            ? <input ref={el => el?.focus()} type="text" value={editTitleValue} onChange={e => setEditTitleValue(e.target.value)} onBlur={handleSaveTitle} onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') cancelEditTitle(); }} style={{ background: 'var(--social-bg)', border: '1px solid var(--accent)', color: 'var(--text-h)', padding: '4px 8px', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', flexGrow: 1, maxWidth: '200px', outline: 'none' }} />
                                            : <><span onClick={handleStartEditTitle} title="Edit Title" style={{ fontSize: '0.9em', opacity: 0.3, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.3'}>✎</span><div className="header-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{interactionData?.name || 'Untitled Chat'}</div></>}
                                    </div>
                                    <div className="header-controls-group">
                                        <button type="button" className="view-mode-toggle" onClick={modals.settings.open} title="Settings" style={{ padding: '6px 10px' }}><span>⚙️</span></button>
                                        <button type="button" className="view-mode-toggle" onClick={() => interactionData && modals.extList.open()} title="Extensions" style={{ padding: '6px 10px' }}><span>🧩</span></button>
                                        <button type="button" onClick={toggleViewMode} className={`view-mode-toggle ${viewMode !== 'ladder' ? 'active' : ''}`} title="Switch View Mode">
                                            <span>{viewMode === 'ladder' ? '📜' : viewMode === 'cinematic' ? '🎥' : '📖'}</span>
                                            <span>{viewMode === 'ladder' ? 'Ladder' : viewMode === 'cinematic' ? 'Cinematic' : 'Visual Novel'}</span>
                                        </button>
                                        <ChatStatisticsBar
                                            numberOfMessages={interactionData?.numberOfMessages ?? safeInteractionMessages.length}
                                            maximumNumberOfTokens={maximumContextLength}
                                            maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens={maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens}
                                            maximumNumberOfContextTokens={maximumNumberOfContextTokens}
                                            budgetSpent={budgetData?.budgetSpent}
                                            maximumBudget={activeStrategy?.maximumBudget}
                                            timeUntilReset={timeUntilReset}
                                        />
                                        {multiplayerSync.isConnected && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '12px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', fontSize: '0.7rem', color: '#22c55e', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                                <span>🟢</span>
                                                <span>{multiplayerSync.connectedPeers.length} peer{multiplayerSync.connectedPeers.length !== 1 ? 's' : ''}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </header>

                        {viewMode === 'ladder' && <LadderView {...viewProps} />}
                        {viewMode === 'cinematic' && <CinematicView {...viewProps} />}
                        {viewMode === 'vn' && <VisualNovelView {...viewProps} />}

                        <ContextBar 
                            viewMode={viewMode} 
                            onOpenChatList={modals.chatList.open} 
                            onOpenCharacters={modals.charList.open} 
                            onOpenContexts={modals.contextList.open} 
                            onOpenLocations={modals.locationList.open} 
                            onOpenAudioTracks={modals.audioTrackList.open} 
                            onOpenWorlds={modals.worldManager.open} 
                            onOpenPromptBlocks={modals.promptBlockList.open} 
                            onOpenModels={modals.modelList.open} 
                            onOpenSamplers={modals.samplerList.open} 
                            onOpenStopPatterns={modals.stopList.open} 
                            onOpenBudgets={modals.budgetStrategyList.open} 
                            onOpenProfiles={modals.profileList.open} 
                        />

                        <ChatInput 
                            inputText={inputText} 
                            setInputText={setInputText} 
                            pendingFiles={pendingFiles} 
                            setPendingFiles={setPendingFiles} 
                            isRecording={isRecording} 
                            isLoading={isLoading} 
                            isModelReady={isModelReady} 
                            isModelLoading={isModelLoading} 
                            modelStatusMessage={modelStatusMessage} 
                            localProtagonist={localProtagonist} 
                            activeStrategy={activeStrategy ?? undefined} 
                            selectedModelId={selectedModelId} 
                            fileInputRef={fileInputRef} 
                            textareaRef={textareaRef} 
                            onFileSelected={handleFileSelected} 
                            onToggleMicrophone={handleToggleMicrophone} 
                            onSend={handleSend} 
                            onStopGeneration={stopGeneration} 
                            onOpenModels={modals.modelList.open} 
                        />
                    </>
                )}

                <AppModals
                    modals={modals}
                    runningModels={runningModels}
                    rawChatShells={rawChatShells}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                    allAudioTracks={allAudioTracks}
                    allWorlds={allWorlds}
                    allModels={allModels}
                    allSamplers={allSamplers}
                    allPromptBlocks={allPromptBlocks}
                    allStopPatterns={allStopPatterns}
                    allBudgetStrategies={allBudgetStrategies}
                    allProfiles={allProfiles}
                    allExtensions={allExtensions}
                    allMemories={allMemories}
                    allAccounts={allAccounts}
                    allMultiplayerData={allMultiplayerData}
                    charModal={charModal}
                    contextModal={contextModal}
                    locationModal={locationModal}
                    audioTrackModal={audioTrackModal}
                    worldModal={worldModal}
                    modelModal={modelModal}
                    samplerModal={samplerModal}
                    promptBlockModal={promptBlockModal}
                    stopModal={stopModal}
                    budgetModal={budgetModal}
                    profileModal={profileModal}
                    accountModal={accountModal}
                    multiplayerDataModal={multiplayerDataModal}
                    onSwitchChat={handleSwitchChat}
                    onInspectChat={handleOpenChatInspection}
                    onDeleteChat={onDeleteChatForModals}
                    onNewChat={handleNewChat}
                    onRenameChat={handleRenameChat}
                    onDeleteCharacter={charModal.handleDelete}
                    onLoadFullCharacter={loadFullCharacter}
                    onToggleParticipant={handleToggleParticipant}
                    onSetProtagonist={handleSetChatProtagonist}
                    onSaveCharacter={saveCharacter}
                    onDeleteContext={contextModal.handleDelete}
                    onToggleContext={handleToggleContext}
                    onSaveContext={saveContext}
                    onDeleteLocation={locationModal.handleDelete}
                    onToggleLocation={handleToggleLocation}
                    onSaveLocation={saveLocation}
                    onDeleteAudioTrack={audioTrackModal.handleDelete}
                    onToggleAudioTrack={handleToggleAudioTrack}
                    onSaveAudioTrack={saveAudioTrack}
                    onSaveWorld={saveWorld}
                    onLoadWorld={handleLoadWorld}
                    onDeleteWorld={worldModal.handleDelete}
                    onDeleteModel={modelModal.handleDelete}
                    onToggleModelLoad={toggleModelLoad}
                    onDeleteSampler={samplerModal.handleDelete}
                    onDeletePromptBlock={promptBlockModal.handleDelete}
                    onDeleteStopPattern={stopModal.handleDelete}
                    onDeleteBudgetStrategy={budgetModal.handleDelete}
                    onActivateBudgetStrategy={handleActivateBudgetStrategy}
                    onDeleteProfile={profileModal.handleDelete}
                    onActivateProfile={handleActivateProfile}
                    onSaveProfile={saveProfile}
                    onDeleteExtension={deleteExtension}
                    onToggleExtension={handleToggleExtension}
                    onDeleteMemory={deleteMemory}
                    onDeleteAccount={accountModal.handleDelete}
                    onToggleAccount={(id: string) => {
                        const newId = currentAccountId === id ? null : id;
                        useSessionStore.setState({ currentAccountId: newId });
                        if (newId) localStorage.setItem('loreReactor_currentAccountId', newId);
                        else localStorage.removeItem('loreReactor_currentAccountId');
                        addToast(newId ? `Activated account "${allAccounts.find(a => a.id === newId)?.name || newId}"` : 'Deactivated account.', newId ? 'success' : 'info');
                    }}
                    onDeleteMultiplayerData={multiplayerDataModal.handleDelete}
                    onJoinSession={handleJoinSession}
                    onUpdateInteractionData={(data) => {
                        const withLocations = assignInitialLocationsIfNeeded(data);
                        setInteractionData(withLocations);
                        saveRawInteractionData(withLocations);
                    }}
                    onForceFirstMessage={handleForceFirstMessage}
                    onSendCustomMessage={handleSendCustomMessage}
                    onInjectCustomMessage={handleInjectCustomMessage}
                    onInjectFirstMessage={handleInjectFirstMessage}
                    onImportComplete={handleImportComplete}
                    addToast={addToast}
                    ensureChatsLoaded={ensureChatsLoaded}
                />
            </div>

            <ChatInspectionModal
                isOpen={isInspectionOpen}
                onClose={() => { setIsInspectionOpen(false); setInspectionStack([]); }}
                inspectionStack={inspectionStack}
                onInspectingParentInteractionData={handleInspectParentInteractionData}
            />

            <PendingJoinRequests
                pendingRequests={multiplayerSync.pendingJoinRequests}
                onAccept={multiplayerSync.acceptJoinRequest}
                onReject={multiplayerSync.rejectJoinRequest}
            />

            <ActionMenu 
                actionMenuTarget={actionMenuTarget} 
                interactionDataExists={!!interactionData} 
                menuSearchQuery={menuSearchQuery} 
                setMenuSearchQuery={setMenuSearchQuery} 
                showActionFormat={showActionFormat} 
                setShowActionFormat={setShowActionFormat} 
                actionWrap={actionWrap} 
                setActionWrap={setActionWrap} 
                actionCase={actionCase} 
                setActionCase={setActionCase} 
                actionPunctuation={actionPunctuation} 
                setActionPunctuation={setActionPunctuation} 
                filteredActions={getFilteredActions()} 
                isModelReady={isModelReady} 
                allCharacters={allCharacters}
                localProtagonist={localProtagonist}
                onAddAction={handleAddAction} 
                onDeleteAction={handleDeleteAction} 
                onActionInterject={handleActionInterject} 
            />
        </>
    );
}

export default App;