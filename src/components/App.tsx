// src/components/App.tsx
import type React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../context/ToastContext';
import { saveRawInteractionData, loadRawInteractionData, flushSaveQueue, loadAllRawModels } from '../storages/serverStorage';
import { createChatMessage, addMessageToInteractionData } from '../hooks/chatLogic';
import { assignInitialLocationsIfNeeded } from '../hooks/locationLogic';
import { useDisplayNameCache, resolveDelayedDisplayNameFromCache } from '../hooks/immersionLogic';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { buildModelLoadArguments } from '../hooks/modelLoadArguments';
import { localURL } from '../configurations';
import { speechToTextEngine } from '../services/SpeechToTextEngine';
import { formatDisplayMessageText } from '../utilities/textDisplayFormatter';
import { cloudBackends } from '../dictionaries/languageModelInformation';
import { useFrontCamera } from '../hooks/useFrontCamera';
import type { Character, Context, InteractionData, ChatMessage, MultiplayerData, WhisperMessage, LanguageModel, HistoryMessage, RawInteractionData, Account, cloudBackend, InterjectableAction } from '../types';
import { useSessionStore } from '../hooks/useSessionStore';

// ─── Manager Hooks ──────────────────────────────────────────────────
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
import { useActiveExtensions } from '../hooks/useActiveExtensions';
import { useEntityModals } from '../hooks/useEntityModals';

// ─── Extracted Hooks ─────────────────────────────────────────────────
import { useMultiplayerSession } from '../hooks/useMultiplayerSession';
import { useSessionEffects } from '../hooks/useSessionEffects';
import { useChatAutoSave } from '../hooks/useChatAutoSave';
import { useTokenCounter } from '../hooks/useTokenCounter';

// ─── Feature Hooks ───────────────────────────────────────────────────
import { useChatSession } from '../hooks/useChatSession';
import { useChatRestoration } from '../hooks/useChatRestoration';
import { useEntitySync } from '../hooks/useEntitySync';
import { useActionMenu } from '../hooks/useActionMenu';
import { useMessageActions } from '../hooks/useMessageActions';
import { useChatOperations } from '../hooks/useChatOperations';
import { useEntityToggles } from '../hooks/useEntityToggles';
import { useViewAssets } from '../hooks/useViewAssets';
import { useMessageToolbar } from '../hooks/useMessageToolbar';
import { useAppModals } from '../hooks/useAppModals';

// ─── Components ──────────────────────────────────────────────────────
import { ActionMenu } from './ActionMenu';
import { AppModals } from './AppModals';
import { ChatInput } from './ChatInput';
import { ContextBar } from './ContextBar';
import { LoadingScreen } from './LoadingScreen';
import { ChatStatisticsBar } from './ChatStatisticsBar';
import { ChatMinimap } from './ChatMinimap';
import { LadderView } from './views/LadderView';
import { CinematicView } from './views/CinematicView';
import { VisualNovelView } from './views/VisualNovelView';
import type { ViewModeProps } from './views/types';
import { defaultContextLength } from '../dictionaries/defaults';
import '../main.css';

// ─── Types & Helpers ─────────────────────────────────────────────────

interface LoadStep { id: string; label: string; icon: string; done: boolean; }

function deriveCurrentProtagonist(
    interactionData: InteractionData | null,
    multiplayerData: MultiplayerData | null,
    currentAccountId: string | null,
): Character | null {
    if (!interactionData?.protagonists?.length) return null;
    if (!multiplayerData || !currentAccountId) return interactionData.protagonists[0] ?? null;
    const activeCharId = multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.activeCharacterId;
    if (activeCharId) {
        const found = interactionData.protagonists.find((p: Character) => p.id === activeCharId)
            || interactionData.participants.find((p: Character) => p.id === activeCharId);
        if (found) return found;
    }
    return interactionData.protagonists[0] ?? null;
}

// ─── App Component ───────────────────────────────────────────────────

function App() {
    const { addToast } = useToast();
    const { captureImage: captureFrontCameraImage } = useFrontCamera(addToast);

    // ─── Manager Hooks ───────────────────────────────────────────────
    const chatList = useChatListManager();
    const characters = useCharacterManager();
    const contexts = useContextManager();
    const locations = useLocationManager();
    const audioTracks = useAudioTrackManager();
    const worlds = useWorldManager();
    const models = useModelManager();
    const samplers = useSamplerManager();
    const promptBlocks = usePromptBlockManager();
    const stopPatterns = useStopPatternManager();
    const budgetStrategies = useBudgetStrategyManager();
    const profiles = useProfileManager();
    const extensions = useExtensionManager();
    const memories = useMemoryManager();
    const accounts = useAccountManager();
    const multiplayerDataManager = useMultiplayerDataManager();

    const activeExtensions = useActiveExtensions(extensions.extensions);

    const allModels = models.models;

    const entityModals = useEntityModals({
        character: { saveFunction: characters.saveCharacter, deleteFunction: characters.deleteCharacter, entityLabel: 'Character' },
        context: { saveFunction: contexts.saveContext, deleteFunction: contexts.deleteContext, entityLabel: 'Context' },
        location: { saveFunction: locations.saveLocation, deleteFunction: locations.deleteLocation, entityLabel: 'Location' },
        audioTrack: { saveFunction: audioTracks.saveAudioTrack, deleteFunction: audioTracks.deleteAudioTrack, entityLabel: 'Audio Track' },
        world: { saveFunction: worlds.saveWorld, deleteFunction: worlds.deleteWorld, entityLabel: 'World' },
        model: { saveFunction: models.saveModel, deleteFunction: models.deleteModel, entityLabel: 'Model' },
        sampler: { saveFunction: samplers.saveSampler, deleteFunction: samplers.deleteSampler, entityLabel: 'Sampler' },
        promptBlock: { saveFunction: promptBlocks.savePromptBlock, deleteFunction: promptBlocks.deletePromptBlock, entityLabel: 'Prompt Block' },
        stopPattern: { saveFunction: stopPatterns.saveStopPattern, deleteFunction: stopPatterns.deleteStopPattern, entityLabel: 'Stop Pattern' },
        budgetStrategy: { saveFunction: budgetStrategies.saveStrategy, deleteFunction: budgetStrategies.deleteStrategy, entityLabel: 'Budget Strategy' },
        profile: { saveFunction: profiles.saveProfile, deleteFunction: profiles.deleteProfile, entityLabel: 'Profile' },
        account: { saveFunction: accounts.saveAccount, deleteFunction: accounts.deleteAccount, entityLabel: 'Account' },
        multiplayerData: { saveFunction: multiplayerDataManager.saveMultiplayerData, deleteFunction: multiplayerDataManager.deleteMultiplayerData, entityLabel: 'Multiplayer Data' },
    });

    // ─── Session Store Selectors & Actions ───────────────────────────
    const selectedCharacterId = useSessionStore((s: any) => s.selectedCharacterId);
    const selectedBudgetStrategyId = useSessionStore((s: any) => s.selectedBudgetStrategyId);
    const storeSetCurrentAccountId = useSessionStore((s: any) => s.setCurrentAccountId);
    const storesetSelectedCharacterId = useSessionStore((s: any) => s.setSelectedCharacterId);
    const storeSetSelectedBudgetStrategyId = useSessionStore((s: any) => s.setSelectedBudgetStrategyId);

    // ─── Multiplayer Session ─────────────────────────────────────────
    const mp = useMultiplayerSession({
        allCharacters: characters.characters,
        saveMultiplayerData: multiplayerDataManager.saveMultiplayerData,
        addToast,
    });

    // ─── State Bridge for Actions ────────────────────────────────────
    // useChatSession needs the actions to learn from manual typing.
    // Since useActionMenu loads them and is declared after useChatSession,
    // we use a state bridge to pass them down safely without circular dependencies.
    const [allActionsState, setAllActionsState] = useState<InterjectableAction[]>([]);

    // ─── Chat Session ────────────────────────────────────────────────
    const session = useChatSession({
        onMessageBroadcast: mp.broadcastMessageRef.current ? (msg: HistoryMessage) => mp.broadcastMessageRef.current?.(msg) : undefined,
        isMultiplayerClient: mp.isMultiplayerClient,
        joinProtagonist: mp.joinProtagonist,
        allCharacters: characters.characters,
        allContexts: contexts.contexts,
        allLocations: locations.locations,
        allAudioTracks: audioTracks.audioTracks,
        allPromptBlocks: promptBlocks.promptBlocks,
        allSamplers: samplers.Samplers,
        allStopPatterns: stopPatterns.stopPatterns,
        allBudgetStrategies: budgetStrategies.strategies,
        allProfiles: profiles.profiles,
        allWorlds: worlds.worlds,
        allMemories: memories.memories,
        allExtensions: extensions.extensions,
        allAccounts: accounts.accounts,
        allMultiplayerData: multiplayerDataManager.multiplayerDatas,
        allActions: allActionsState,
        requestBorrowedModel: () => mp.requestBorrowedModelRef.current(),
    });

    const {
        interactionData, setInteractionData, setSelectedCharacter,
        isLoading, streamingText, streamingCharacter, currentCharacterExpression,
        sendMessage, stopGeneration, resumeGeneration, regenerateFromMessage,
        messageEndRef, chatHistoryRef, startNewChat, sendActionAndGetResponse,
        triggerHostResponse, setActiveBudgetStrategy, setSelectedGlobalModel,
        activeStrategy, budgetData,
    } = session;

    // Wire triggerHostResponse into multiplayer session
    useEffect(() => { mp.triggerHostResponseRef.current = triggerHostResponse; }, [mp.triggerHostResponseRef, triggerHostResponse]);

    // ─── Chat Restoration ────────────────────────────────────────────
    const { activeChatRestored } = useChatRestoration({
        charsLoading: characters.isLoading,
        chatsLoading: chatList.isLoading,
        contextsLoading: contexts.isLoading,
        locationsLoading: locations.isLoading,
        profilesLoading: profiles.isLoading,
        allCharacters: characters.characters,
        rawChatShells: chatList.rawChatShells,
        loadFullCharacter: characters.loadFullCharacter,
        setInteractionData, setSelectedCharacter,
        setSelectedModelId: models.setSelectedModelId,
        startNewChat,
        skipRestoration: mp.isMultiplayerClient,
    });

    // Restore join protagonist after chat restoration
    useEffect(() => {
        if (!activeChatRestored || !mp.isMultiplayerClient || !mp.joinProtagonist) return;
        const stored = useSessionStore.getState().currentCharacter;
        if (!stored || stored.id !== mp.joinProtagonist.id) setSelectedCharacter(mp.joinProtagonist);
    }, [activeChatRestored, mp.isMultiplayerClient, mp.joinProtagonist, setSelectedCharacter]);

    // Disconnect multiplayer when chat changes
    const prevChatIdRef = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        if (!activeChatRestored) return;
        const currentChatId = interactionData?.id ?? null;
        if (prevChatIdRef.current !== undefined && prevChatIdRef.current !== null && prevChatIdRef.current !== currentChatId) {
            mp.multiplayerSync.disconnect();
            mp.clearJoinState();
        }
        prevChatIdRef.current = currentChatId;
    }, [interactionData?.id, mp, activeChatRestored]);

    // Auto-associate multiplayer data with current chat
    useEffect(() => {
        if (!interactionData?.id || mp.joinSessionId) return;
        const mpData = useSessionStore.getState().multiplayerData;
        if (mpData?.interactionDataIds?.includes(interactionData.id)) return;
        const match = multiplayerDataManager.multiplayerDatas.find((m: MultiplayerData) => m.interactionDataIds.includes(interactionData.id!));
        if (match) useSessionStore.setState({ multiplayerData: match });
        else if (!mpData && multiplayerDataManager.multiplayerDatas.length > 0) useSessionStore.setState({ multiplayerData: multiplayerDataManager.multiplayerDatas[0] });
    }, [interactionData?.id, multiplayerDataManager.multiplayerDatas, mp.joinSessionId]);

    useEffect(() => {
        const handleBeforeUnload = () => {
            flushSaveQueue();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // ─── Derived Protagonist ─────────────────────────────────────────
    const localProtagonist = useMemo(
        () => deriveCurrentProtagonist(interactionData, mp.multiplayerData, mp.currentAccountId),
        [interactionData, mp.multiplayerData, mp.currentAccountId],
    );
    const currentCharacter = mp.isMultiplayerClient && mp.joinProtagonist ? mp.joinProtagonist : localProtagonist;

    // ─── Entity Sync ─────────────────────────────────────────────────
    useEntitySync({
        activeChatRestored,
        allCharacters: characters.characters,
        allContexts: contexts.contexts,
        allProfiles: profiles.profiles,
        currentCharacter, setInteractionData, setSelectedCharacter,
    });

    // ─── Session Persistence Effects ─────────────────────────────────
    const loadLocalModelForBudgetEngine = useCallback(async (modelId: string): Promise<number | null> => {
        const existing = models.runningModels[modelId];
        if (existing?.port) return existing.port;
        const target = allModels.find((m: LanguageModel) => m.id === modelId);
        if (!target || (target.apiKey && target.backend)) return null;
        try {
            const args = buildModelLoadArguments(target);
            const res = await fetch(`${localURL}/models/load`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: target.id, modelPath: target.model || '', args }),
            });
            if (!res.ok) return null;
            return (await res.json()).port ?? null;
        } catch (e) { console.warn(`Auto-load of model ${target.name} failed:`, e); return null; }
    }, [allModels, models]);

    useSessionEffects({
        interactionDataId: interactionData?.id,
        isMultiplayerClient: mp.isMultiplayerClient,
        selectedModelId: models.selectedModelId,
        setSelectedModelId: models.setSelectedModelId,
        selectedBudgetStrategyId,
        allBudgetStrategies: budgetStrategies.strategies,
        setActiveBudgetStrategy,
        allModels,
        runningModels: models.runningModels,
        setSelectedGlobalModel,
        selectedCharacterId,
        allCharacters: characters.characters,
        selectedProfileId: interactionData?.Profile?.id,
        setSelectedCharacter,
        activeStrategy, budgetData,
        loadLocalModelForBudgetStrategyEngine: loadLocalModelForBudgetEngine,
    });

    // ─── Sentiment Engine ────────────────────────────────────────────
    useEffect(() => {
        const enabled = interactionData?.Profile?.enableCharacterExpression ?? false;
        if (enabled) sentimentEngine.initialize(); else sentimentEngine.unload();
    }, [interactionData?.Profile?.enableCharacterExpression]);

    // ─── Chat Auto-Save ──────────────────────────────────────────────
    useChatAutoSave({
        interactionData,
        rawChatShells: chatList.rawChatShells,
        refreshChatList: chatList.refresh,
    });

    // ─── Model Readiness ─────────────────────────────────────────────
    const isModelReady = useMemo(() => {
        if (mp.isMultiplayerClient) return true;
        if (activeStrategy) return true;
        if (!models.selectedModelId) return false;
        const sel = allModels.find((m: LanguageModel) => m.id === models.selectedModelId);
        if (sel?.apiKey && sel.backend && cloudBackends.includes(sel.backend as cloudBackend)) return true;
        return models.runningModels[models.selectedModelId]?.isRunning === true
            && models.runningModels[models.selectedModelId]?.isIdle === true;
    }, [allModels, activeStrategy, mp.isMultiplayerClient, models]);

    const isModelLoading = useMemo(() => {
        if (mp.isMultiplayerClient || !models.selectedModelId) return false;
        const sel = allModels.find((m: LanguageModel) => m.id === models.selectedModelId);
        if (sel?.apiKey && sel.backend && cloudBackends.includes(sel.backend as cloudBackend)) return false;
        return models.runningModels[models.selectedModelId]?.isRunning === true
            && models.runningModels[models.selectedModelId]?.isIdle !== true;
    }, [allModels, mp.isMultiplayerClient, models]);

    const modelStatusMessage = mp.isMultiplayerClient ? ''
        : (!models.selectedModelId ? 'No model selected — open Language Models to load one'
            : isModelLoading ? 'Model is warming up... please wait' : '');

    // ─── Feature Hooks ───────────────────────────────────────────────
    const actionMenu = useActionMenu({
        interactionData, currentCharacter, isLoading, isModelReady,
        allCharacters: characters.characters, stopGeneration, sendActionAndGetResponse, addToast,
    });

    // Sync loaded actions back to the state bridge for useChatSession
    useEffect(() => {
        setAllActionsState(actionMenu.allActions);
    }, [actionMenu.allActions]);

    const messageActions = useMessageActions({
        interactionData, localProtagonist, isModelReady, isLoading,
        setInteractionData, setSelectedCharacter,
        refreshChatList: chatList.refresh, regenerateFromMessage, addToast,
    });

    const chatOps = useChatOperations({
        interactionData, currentCharacter, localProtagonist, selectedCharacterId,
        allCharacters: characters.characters, rawChatShells: chatList.rawChatShells,
        setInteractionData, setSelectedCharacter,
        refreshChatList: chatList.refresh, startNewChat,
        deleteChatFromList: chatList.deleteChat, addToast,
    });

    const entityToggles = useEntityToggles({
        interactionData,
        allCharacters: characters.characters,
        activeExtensionIds: activeExtensions.activeIds,
        setActiveExtensionIds: activeExtensions.setActiveIds,
        allProfiles: profiles.profiles,
        allBudgetStrategies: budgetStrategies.strategies,
        selectedBudgetStrategyId,
        setInteractionData, setSelectedCharacter, setActiveBudgetStrategy,
        setSelectedBudgetStrategyId: storeSetSelectedBudgetStrategyId,
        setSelectedCharacterId: storesetSelectedCharacterId,
        loadFullCharacter: characters.loadFullCharacter, addToast,
    });

    const isMultiplayerChat = mp.isMultiplayerClient || !!(mp.multiplayerData && interactionData?.id && mp.multiplayerData.interactionDataIds.includes(interactionData.id));

    // ─── Local Refs for View Assets ──────────────────────────────────
    const lastViewedMessageIdRef = useRef<string | null>(null);
    const suppressAutoScrollRef = useRef(false);

    const viewAssets = useViewAssets({
        viewMode: undefined as any,
        interactionData, localProtagonist, currentCharacter,
        streamingCharacter, currentCharacterExpression, chatHistoryRef,
        isMultiplayerChat,
        lastViewedMessageIdRef,
        suppressAutoScrollRef,
    });

    const messageToolbar = useMessageToolbar({ chatHistoryRef });
    const displayNameCache = useDisplayNameCache(interactionData);
    const { modals } = useAppModals();

    // ─── Token Counter ───────────────────────────────────────────────
    const maxParticipantTokens = useTokenCounter({
        messages: viewAssets.chatMessages || [],
        interactionData,
        selectedModelId: models.selectedModelId,
        allModels,
        runningModels: models.runningModels,
        activeStrategy,
    });

    // ─── Local UI State ──────────────────────────────────────────────
    const [viewMode, setViewMode] = useState<'ladder' | 'cinematic' | 'vn'>('ladder');
    const [inputText, setInputText] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const editTextAreaRef = useRef<HTMLTextAreaElement>(null);

    // Textarea auto-resize
    useEffect(() => { if (!textareaRef.current) return; textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, window.innerHeight * 0.3)}px`; });
    useEffect(() => { if (!editTextAreaRef.current || !messageActions.editingId) return; editTextAreaRef.current.style.height = 'auto'; editTextAreaRef.current.style.height = `${editTextAreaRef.current.scrollHeight}px`; }, [messageActions.editingId]);

    // ─── Derived Display Values ──────────────────────────────────────
    const canDelete = (!isMultiplayerChat || mp.multiplayerSync.isHost || mp.multiplayerSync.isAdmin) && !isLoading;
    const safeMessages = useMemo(() => viewAssets.chatMessages || [], [viewAssets.chatMessages]);
    const formattedStreamingText = useMemo(() => streamingText ? formatDisplayMessageText(streamingText) : null, [streamingText]);

    const maxContextTokens = useMemo(() => {
        if (!interactionData?.contexts?.length) return 0;
        let total = 0;
        for (const ctx of interactionData.contexts) { if (ctx.text) total += Math.ceil(ctx.text.length / 4); }
        return total;
    }, [interactionData]);

    const maxContextLength = useMemo(() => {
        if (activeStrategy) {
            let max = 0;
            for (const mid of activeStrategy.modelIds) {
                const m = allModels.find((x: LanguageModel) => x.id === mid);
                if (m && m.contextLength > max) max = m.contextLength;
            }
            return max || defaultContextLength;
        }
        if (models.selectedModelId) {
            const m = allModels.find((x: LanguageModel) => x.id === models.selectedModelId);
            return m?.contextLength || defaultContextLength;
        }
        return defaultContextLength;
    }, [activeStrategy, allModels, models]);

    const parentChatName = useMemo(() => {
        if (!interactionData?.parentInteractionDataId) return null;
        return chatList.rawChatShells.find((s: RawInteractionData) => s.id === interactionData.parentInteractionDataId)?.name ?? null;
    }, [interactionData, chatList]);

    // ─── Display Messages (with streaming injection + whisper filtering) ──
    const displayMessages = useMemo(() => {
        let base = [...safeMessages] as (ChatMessage | WhisperMessage)[];
        if (isMultiplayerChat && localProtagonist) {
            base = base.filter((msg: ChatMessage | WhisperMessage) => {
                if (msg.messageType === 'whisper') {
                    const w = msg as WhisperMessage;
                    return w.character.id === localProtagonist.id || w.targetCharacterIds.includes(localProtagonist.id);
                }
                return true;
            });
        }
        if (isLoading && streamingText && streamingCharacter) {
            const last = base[base.length - 1];
            const isLastStreaming = last?.character.id === streamingCharacter.id;
            if (isLastStreaming) {
                const idx = base.length - 1;
                const name = resolveDelayedDisplayNameFromCache(displayNameCache, idx, streamingCharacter.id);
                (base[idx] as any).textContent = streamingText;
                (base[idx] as any).character = { ...last!.character, name };
            } else if (!last || last.character.id !== streamingCharacter.id) {
                const name = resolveDelayedDisplayNameFromCache(displayNameCache, base.length, streamingCharacter.id);
                base.push({
                    id: `streaming-${streamingCharacter.id}`, messageType: 'chat',
                    character: { ...streamingCharacter, name }, textContent: streamingText,
                    files: [], firstCreatedTimestamp: 0, lastUpdatedTimestamp: 0,
                    locationIndex: undefined, characterLockedLocations: {}, parentInteractionMessageId: null,
                } as any);
            }
        }
        return base;
    }, [safeMessages, isLoading, streamingText, streamingCharacter, displayNameCache, isMultiplayerChat, localProtagonist]);

    const massStartIndex = messageActions.massDeleteId !== null
        ? displayMessages.findIndex((m: ChatMessage | WhisperMessage) => m.id === messageActions.massDeleteId) : -1;

    // ─── Budget Reset Timer ──────────────────────────────────────────
    const timeUntilResetRef = useRef<number | undefined>(undefined);
    const [timeUntilReset, setTimeUntilReset] = useState<number | undefined>(undefined);
    useEffect(() => {
        if (!budgetData || !activeStrategy || budgetData.resetDuration <= 0) { timeUntilResetRef.current = undefined; return; }
        const compute = () => Math.max(0, budgetData.resetDuration - (Date.now() - budgetData.lastResetTimestamp));
        timeUntilResetRef.current = compute();
        const interval = setInterval(() => { timeUntilResetRef.current = compute(); setTimeUntilReset(timeUntilResetRef.current); }, 1000);
        const raf = requestAnimationFrame(() => setTimeUntilReset(timeUntilResetRef.current));
        return () => { clearInterval(interval); cancelAnimationFrame(raf); };
    }, [budgetData, activeStrategy]);

    // ─── Loading Screen ──────────────────────────────────────────────
    const loadSteps = useMemo<LoadStep[]>(() => [
        { id: 'chats', label: 'Chat Sessions', icon: '💬', done: !chatList.isLoading },
        { id: 'characters', label: 'Characters', icon: '🎭', done: !characters.isLoading },
        { id: 'actions', label: 'Actions', icon: '⚡', done: !actionMenu.actionsLoading },
        { id: 'contexts', label: 'Contexts', icon: '📜', done: !contexts.isLoading },
        { id: 'locations', label: 'Locations', icon: '📍', done: !locations.isLoading },
        { id: 'audioTracks', label: 'Audio Tracks', icon: '🔊', done: !audioTracks.isLoading },
        { id: 'worlds', label: 'Worlds', icon: '🌍', done: !worlds.isLoading },
        { id: 'promptBlocks', label: 'Prompt Blocks', icon: '🧱', done: !promptBlocks.isLoading },
        { id: 'models', label: 'Language Models', icon: '🤖', done: !models.isLoading },
        { id: 'samplers', label: 'Samplers', icon: '🎚️', done: !samplers.isLoading },
        { id: 'stopPatterns', label: 'Stop Patterns', icon: '🛑', done: !stopPatterns.isLoading },
        { id: 'budget', label: 'Budget', icon: '💰', done: !budgetStrategies.isLoading },
        { id: 'profiles', label: 'Profiles', icon: '👤', done: !profiles.isLoading },
        { id: 'accounts', label: 'Accounts', icon: '🔑', done: !accounts.isLoading },
        { id: 'multiplayerData', label: 'Multiplayer Data', icon: '👥', done: !multiplayerDataManager.isLoading },
    ], [chatList, characters, actionMenu.actionsLoading, contexts, locations, audioTracks, worlds, promptBlocks, models, samplers, stopPatterns, budgetStrategies, profiles, accounts, multiplayerDataManager]);

    const [isInitializing, setIsInitializing] = useState(true);
    const [isFadeOut, setIsFadeOut] = useState(false);
    const loadingStartedAtRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isInitializing) return;
        if (!loadSteps.every((s: LoadStep) => s.done) || !activeChatRestored || !interactionData) return;
        const started = loadingStartedAtRef.current ?? Date.now();
        loadingStartedAtRef.current = started;
        const remaining = Math.max(0, 900 - (Date.now() - started));
        const timer = setTimeout(() => {
            setIsFadeOut(true);
            setTimeout(() => { setIsInitializing(false); setIsFadeOut(false); }, 300);
        }, remaining);
        return () => clearTimeout(timer);
    }, [loadSteps, isInitializing, activeChatRestored, interactionData]);

    useEffect(() => { if (!isInitializing && activeChatRestored) chatList.ensureLoaded(); }, [isInitializing, activeChatRestored, chatList]);

    // ─── Wrapped Multiplayer-Aware Handlers ──────────────────────────
    const wrappedSaveEdit = useCallback(async () => {
        await messageActions.handleSaveEdit();
        if (isMultiplayerChat && messageActions.editingId) mp.multiplayerSync.broadcastMessageEdit(messageActions.editingId, messageActions.editDraft);
    }, [messageActions, isMultiplayerChat, mp.multiplayerSync]);

    const wrappedDelete = useCallback(async (id: string) => {
        await messageActions.handleDelete(id);
        if (isMultiplayerChat) mp.multiplayerSync.broadcastMessageDelete(id);
    }, [messageActions, isMultiplayerChat, mp.multiplayerSync]);

    const wrappedBranch = useCallback((id: string) => {
        if (isMultiplayerChat) mp.multiplayerSync.initiateBranch();
        else messageActions.handleBranch(id);
    }, [messageActions, isMultiplayerChat, mp.multiplayerSync]);

    // ─── Input Handlers ──────────────────────────────────────────────
    const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        if (files.length > 0) { setPendingFiles(prev => [...prev, ...files]); addToast(`${files.length} file${files.length !== 1 ? 's' : ''} attached.`); }
        requestAnimationFrame(() => { if (fileInputRef.current) fileInputRef.current.value = ''; });
    };

    const handleToggleMic = useCallback(async () => {
        if (isRecording) { await speechToTextEngine.stopRecording(); setIsRecording(false); }
        else {
            const started = await speechToTextEngine.startRecording((text: string) => setInputText(prev => prev + (prev ? ' ' : '') + text));
            if (!started) { addToast('Failed to start voice input.', 'error'); return; }
            setIsRecording(true);
        }
    }, [isRecording, addToast]);

    const handleSend = useCallback(async () => {
        if (!inputText.trim() && !pendingFiles.length) return;
        let frontCam: string | undefined;
        const profileCam = interactionData?.Profile?.useFrontCameraImage;
        if (profileCam === 1) { const img = await captureFrontCameraImage(); if (img) frontCam = img; }
        else if (profileCam === 0 && currentCharacter?.useFrontCameraImage) { const img = await captureFrontCameraImage(); if (img) frontCam = img; }
        sendMessage(inputText, promptBlocks.promptBlocks, pendingFiles, frontCam);
        setInputText(''); setPendingFiles([]);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }, [inputText, pendingFiles, sendMessage, promptBlocks, captureFrontCameraImage, interactionData, currentCharacter]);

    const toggleViewMode = () => {
        setViewMode(prev => prev === 'ladder' ? 'cinematic' : prev === 'cinematic' ? 'vn' : 'ladder');
        const container = chatHistoryRef.current;
        let targetIdx = -1;
        if (container && interactionData) {
            const rect = container.getBoundingClientRect();
            const ids = new Set(safeMessages.map((m: ChatMessage | WhisperMessage) => m.id));
            let bestTop = Number.POSITIVE_INFINITY;
            for (const el of container.querySelectorAll('[data-message-id]')) {
                const mid = el.getAttribute('data-message-id');
                if (!mid || !ids.has(mid)) continue;
                const r = el.getBoundingClientRect();
                if (r.top < rect.bottom && r.bottom > rect.top && r.top < bestTop) { 
                    bestTop = r.top; 
                    targetIdx = safeMessages.findIndex((m: ChatMessage | WhisperMessage) => m.id === mid); 
                }
            }
        }
        if (targetIdx === -1 && lastViewedMessageIdRef.current && interactionData)
            targetIdx = safeMessages.findIndex((m: ChatMessage | WhisperMessage) => m.id === lastViewedMessageIdRef.current);
        if (targetIdx >= 0 && interactionData) lastViewedMessageIdRef.current = safeMessages[targetIdx].id;
        suppressAutoScrollRef.current = true;
        setTimeout(() => {
            if (targetIdx >= 0 && chatHistoryRef.current) {
                const el = chatHistoryRef.current.querySelector(`[data-message-id="${safeMessages[targetIdx].id}"]`) as HTMLElement | null;
                if (el) { 
                    el.scrollIntoView({ block: 'start' }); 
                    setTimeout(() => { suppressAutoScrollRef.current = false; }, 400); 
                    return; 
                }
            }
            messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setTimeout(() => { suppressAutoScrollRef.current = false; }, 400);
        }, 50);
    };

    // ─── Chat Management Handlers ────────────────────────────────────
    const handleImportComplete = useCallback(() => { getLanguageModelEngine().clearTokenCache(); chatList.refresh(); }, [chatList]);

    const handleForceFirstMessage = useCallback(async (char: Character) => {
        if (!interactionData) return;
        const msg = createChatMessage(interactionData, char, `*${char.name} enters the scene.*`);
        const updated = addMessageToInteractionData(interactionData, msg);
        setInteractionData(updated);
        await saveRawInteractionData(updated);
        addToast(`Sent first message as ${char.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleSendCustom = useCallback(async (char: Character, text: string) => {
        if (!interactionData) return;
        const msg = createChatMessage(interactionData, char, text);
        const updated = addMessageToInteractionData(interactionData, msg);
        setInteractionData(updated);
        await saveRawInteractionData(updated);
        addToast(`Sent message as ${char.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleInjectCustom = useCallback(async (char: Character, text: string) => {
        if (!interactionData) return;
        const ctx: Context = { id: crypto.randomUUID(), name: `[Injected] ${char.name}`, description: 'User-injected message for LLM context', text: `${char.name}: ${text}`, isAutoGenerated: true, useBase64Encoding: false, insertionDepth: 0, tokenBudget: 512, limitLinksToSubdirectory: false, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now() };
        const updated: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), ctx], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updated);
        await saveRawInteractionData(updated);
        addToast(`Injected custom message as ${char.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleInjectFirst = useCallback(async (char: Character) => {
        if (!interactionData) return;
        const ctx: Context = { id: crypto.randomUUID(), name: `[Injected First] ${char.name}`, description: 'User-injected first message', text: `${char.name}: *${char.name} enters the scene.*`, isAutoGenerated: true, useBase64Encoding: false, insertionDepth: 0, tokenBudget: 512, limitLinksToSubdirectory: false, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now() };
        const updated: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), ctx], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updated);
        await saveRawInteractionData(updated);
        addToast(`Injected first message as ${char.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const onDeleteChatForModals = useCallback((id: string) => {
        chatOps.handleDeleteChat({ stopPropagation: () => {} } as React.MouseEvent, id);
    }, [chatOps]);

    const handleRenameChat = useCallback(async (id: string, name: string) => {
        const loaded = await loadRawInteractionData(id, characters.characters);
        if (!loaded) { addToast('Chat not found.', 'error'); return; }
        const updated = { ...loaded, name, lastUpdatedTimestamp: Date.now() };
        await saveRawInteractionData(updated);
        chatList.refresh();
        if (interactionData?.id === id) setInteractionData({ ...interactionData, name, lastUpdatedTimestamp: Date.now() });
        addToast(`Renamed to "${name}"`, 'success');
    }, [characters, interactionData, setInteractionData, chatList, addToast]);

    const handleNavigateToBranchSource = useCallback(async () => {
        if (!interactionData?.parentInteractionDataId) return;
        try {
            const source = await loadRawInteractionData(interactionData.parentInteractionDataId, characters.characters);
            if (source) {
                setInteractionData(source);
                const srcMp = useSessionStore.getState().multiplayerData;
                const srcProtag = deriveCurrentProtagonist(source, srcMp, mp.currentAccountId);
                if (srcProtag) setSelectedCharacter(srcProtag);
                chatList.refresh();
                addToast(`Returned to source: "${source.name}"`, 'info');
            } else addToast('Source chat not found.', 'error');
        } catch { addToast('Failed to load source chat.', 'error'); }
    }, [interactionData, characters, mp.currentAccountId, setInteractionData, setSelectedCharacter, chatList, addToast]);

    const handleLoadWorld = useCallback(async (world: any) => {
        if (!interactionData) return;
        const resolvedChars = world.characterIds.map((id: string) => characters.characters.find((c: Character) => c.id === id)).filter(Boolean);
        const resolvedCtxs = world.contextIds.map((id: string) => contexts.contexts.find((c: Context) => c.id === id)).filter(Boolean);
        const resolvedLocs = world.locationIds.map((id: string) => locations.locations.find((l: any) => l.id === id)).filter(Boolean);
        const resolvedAudio = (world.audioTrackIds || []).map((id: string) => audioTracks.audioTracks.find((t: any) => t.id === id)).filter(Boolean);
        const resolvedProfile = world.profileId ? profiles.profiles.find((p: any) => p.id === world.profileId) : undefined;
        let updated: InteractionData = {
            ...interactionData,
            participants: resolvedChars.length > 0 ? resolvedChars : interactionData.participants,
            contexts: resolvedCtxs, locations: resolvedLocs,
            audioTracks: resolvedAudio.length > 0 ? resolvedAudio : [],
            Profile: resolvedProfile, lastUpdatedTimestamp: Date.now(),
        };
        if (updated.protagonists) {
            for (const p of updated.protagonists) {
                if (!updated.participants.find((x: Character) => x.id === p.id)) updated.participants = [p, ...updated.participants];
            }
        }
        updated = assignInitialLocationsIfNeeded(updated);
        setInteractionData(updated);
        await saveRawInteractionData(updated);
        addToast(`Loaded world "${world.name}"`, 'success');
    }, [interactionData, characters, contexts, locations, audioTracks, profiles, setInteractionData, addToast]);

    // ─── View Props ──────────────────────────────────────────────────
    const viewProps: ViewModeProps & { canDelete: boolean } = {
        interactionData: interactionData!,
        localProtagonist: localProtagonist!,
        displayMessages: displayMessages as ChatMessage[],
        selectedCharacterId: currentCharacter?.id,
        editingId: messageActions.editingId, editDraft: messageActions.editDraft,
        massDeleteId: messageActions.massDeleteId, isMassActive: messageActions.massDeleteId !== null,
        massStartIndex, activeToolbarId: messageToolbar.activeToolbarId,
        portraitUrlCache: viewAssets.portraitUrlCache, displayNameCache,
        characterScales: new Map(), centerAvatar: viewAssets.centerAvatar,
        streamingPortraitUrl: viewAssets.streamingPortraitUrl,
        formattedStreamingText, locationBackgroundUrl: viewAssets.locationBackgroundUrl, isLoading,
        isEditingTitle: chatOps.isEditingTitle, editTitleValue: chatOps.editTitleValue,
        parentInteractionMessageId: interactionData?.parentInteractionMessageId ?? null,
        parentInteractionDataName: parentChatName,
        streamingCharacter, chatHistoryRef, messageEndRef,
        editTextAreaRef, focusedMessageId, setFocusedMessageId,
        onAvatarClick: actionMenu.handleAvatarClick,
        onStartEditing: messageActions.startEditing, onCancelEditing: messageActions.cancelEditing,
        onSaveEdit: wrappedSaveEdit, onRegenerateFromEdit: messageActions.handleRegenerateFromEdit,
        onResumeGeneration: (id: string) => resumeGeneration(id, promptBlocks.promptBlocks),
        onCopyText: messageActions.handleCopyText, onRegenerateFromMessage: regenerateFromMessage,
        onBranch: wrappedBranch, onClone: messageActions.handleClone, onDelete: wrappedDelete,
        onSetMassDelete: messageActions.setMassDeleteId,
        onMassDeleteConfirm: messageActions.handleMassDeleteConfirm,
        onCancelMassDelete: () => messageActions.setMassDeleteId(null),
        onTouchStart: messageToolbar.handleBubbleTouchStart,
        onTouchEnd: messageToolbar.handleBubbleTouchEnd,
        onTouchMove: messageToolbar.handleBubbleTouchMove,
        suppressNextClickRef: messageToolbar.suppressNextClickRef,
        setEditDraft: messageActions.setEditDraft,
        onNavigateToBranchSource: handleNavigateToBranchSource,
        onStartEditTitle: chatOps.handleStartEditTitle, onSaveTitle: chatOps.handleSaveTitle,
        onCancelEditTitle: chatOps.cancelEditTitle, setEditTitleValue: chatOps.setEditTitleValue,
        closeActionMenu: actionMenu.closeActionMenu, deactivateToolbar: messageToolbar.deactivateToolbar,
        onStopGeneration: stopGeneration, canDelete,
    };

    const containerClass = [
        'chat-container',
        viewMode === 'cinematic' ? 'mode-cinematic' : '',
        viewMode === 'vn' ? 'mode-vn' : '',
        viewMode === 'ladder' ? 'mode-ladder' : '',
        viewAssets.locationBackgroundUrl ? 'has-location-bg' : '',
    ].filter(Boolean).join(' ');

    // ─── Render ──────────────────────────────────────────────────────
    return (
        <>
            {isInitializing && <LoadingScreen steps={loadSteps} isFadeOut={isFadeOut} />}

            <div
                className={containerClass}
                style={viewAssets.locationBackgroundUrl && viewMode !== 'vn' ? { '--location-bg': `url(${viewAssets.locationBackgroundUrl})` } as React.CSSProperties : undefined}
                onClick={() => { actionMenu.closeActionMenu(); messageToolbar.deactivateToolbar(); }}
            >
                {interactionData && (
                    <>
                        <header className="app-header">
                            <div className="header-content">
                                <div className="header-top">
                                    {viewMode === 'ladder' && safeMessages.length > 5 && (
                                        <ChatMinimap messages={safeMessages.filter((m: ChatMessage | WhisperMessage): m is ChatMessage => m.messageType === 'chat')} containerRef={chatHistoryRef} selectedCharacterId={currentCharacter?.id} />
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                        {chatOps.isEditingTitle
                                            ? <input ref={el => el?.focus()} type="text" value={chatOps.editTitleValue} onChange={e => chatOps.setEditTitleValue(e.target.value)} onBlur={chatOps.handleSaveTitle} onKeyDown={e => { if (e.key === 'Enter') chatOps.handleSaveTitle(); if (e.key === 'Escape') chatOps.cancelEditTitle(); }} style={{ background: 'var(--social-bg)', border: '1px solid var(--accent)', color: 'var(--text-h)', padding: '4px 8px', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', flexGrow: 1, maxWidth: '200px', outline: 'none' }} />
                                            : <><span onClick={chatOps.handleStartEditTitle} title="Edit Title" style={{ fontSize: '0.9em', opacity: 0.3, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.3'}>✎</span><div className="header-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{interactionData?.name || 'Untitled Chat'}</div></>}
                                    </div>
                                    <div className="header-controls-group">
                                        <button type="button" className="view-mode-toggle" onClick={modals.settings.open} title="Settings" style={{ padding: '6px 10px' }}><span>⚙️</span></button>
                                        <button type="button" className="view-mode-toggle" onClick={() => modals.extList.open()} title="Extensions" style={{ padding: '6px 10px' }}><span>🧩</span></button>
                                        <button type="button" onClick={toggleViewMode} className={`view-mode-toggle ${viewMode !== 'ladder' ? 'active' : ''}`} title="Switch View Mode">
                                            <span>{viewMode === 'ladder' ? '📜' : viewMode === 'cinematic' ? '🎥' : '📖'}</span>
                                            <span>{viewMode === 'ladder' ? 'Ladder' : viewMode === 'cinematic' ? 'Cinematic' : 'Visual Novel'}</span>
                                        </button>
                                        <ChatStatisticsBar
                                            numberOfMessages={interactionData?.numberOfMessages ?? safeMessages.length}
                                            maximumNumberOfTokens={maxContextLength}
                                            maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens={maxParticipantTokens}
                                            maximumNumberOfContextTokens={maxContextTokens}
                                            budgetSpent={budgetData?.budgetSpent}
                                            maximumBudget={activeStrategy?.maximumBudget}
                                            timeUntilReset={timeUntilReset}
                                        />
                                        {mp.multiplayerSync.isConnected && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '12px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', fontSize: '0.7rem', color: '#22c55e', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                                <span>🟢</span>
                                                <span>{mp.multiplayerSync.connectedPeers.length} Peer{mp.multiplayerSync.connectedPeers.length !== 1 ? 's' : ''}</span>
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
                            onOpenChatList={modals.chatList.open} onOpenCharacters={modals.charList.open}
                            onOpenContexts={modals.contextList.open} onOpenLocations={modals.locationList.open}
                            onOpenAudioTracks={modals.audioTrackList.open} onOpenWorlds={modals.worldManager.open}
                            onOpenPromptBlocks={modals.promptBlockList.open} onOpenModels={modals.modelList.open}
                            onOpenSamplers={modals.samplerList.open} onOpenStopPatterns={modals.stopList.open}
                            onOpenBudgets={modals.budgetStrategyList.open} onOpenProfiles={modals.profileList.open}
                        />

                        <ChatInput
                            inputText={inputText} setInputText={setInputText}
                            pendingFiles={pendingFiles} setPendingFiles={setPendingFiles}
                            isRecording={isRecording} isLoading={isLoading} isModelReady={isModelReady}
                            isModelLoading={isModelLoading} modelStatusMessage={modelStatusMessage}
                            localProtagonist={localProtagonist} activeStrategy={activeStrategy ?? undefined}
                            selectedModelId={models.selectedModelId} interactionData={interactionData}
                            allCharacters={characters.characters} allLocations={locations.locations} allContexts={contexts.contexts}
                            allAudioTracks={audioTracks.audioTracks} allWorlds={worlds.worlds} allPromptBlocks={promptBlocks.promptBlocks}
                            allSamplers={samplers.Samplers} allStopPatterns={stopPatterns.stopPatterns} allProfiles={profiles.profiles}
                            allMemories={memories.memories} allAccounts={accounts.accounts} allMultiplayerData={multiplayerDataManager.multiplayerDatas}
                            fileInputRef={fileInputRef} textareaRef={textareaRef} onFileSelected={handleFileSelected}
                            onToggleMicrophone={handleToggleMic} onSend={handleSend}
                            onStopGeneration={stopGeneration} onOpenModels={modals.modelList.open}
                        />
                    </>
                )}

                <AppModals
                    isMultiplayerClient={mp.isMultiplayerClient}
                    modals={modals} entityModals={entityModals}
                    runningModels={models.runningModels} rawChatShells={chatList.rawChatShells}
                    allCharacters={characters.characters} allContexts={contexts.contexts} allLocations={locations.locations}
                    allAudioTracks={audioTracks.audioTracks} allWorlds={worlds.worlds} allModels={allModels}
                    allSamplers={samplers.Samplers} allPromptBlocks={promptBlocks.promptBlocks} allStopPatterns={stopPatterns.stopPatterns}
                    allBudgetStrategies={budgetStrategies.strategies} allProfiles={profiles.profiles} allExtensions={extensions.extensions}
                    allMemories={memories.memories} allAccounts={accounts.accounts} allMultiplayerData={multiplayerDataManager.multiplayerDatas}
                    onSwitchChat={chatOps.handleSwitchChat} onDeleteChat={onDeleteChatForModals} onNewChat={chatOps.handleNewChat}
                    onRenameChat={handleRenameChat}
                    onDeleteCharacter={entityModals.getModalProperties('character').delete}
                    onLoadFullCharacter={characters.loadFullCharacter} onToggleParticipant={entityToggles.handleToggleParticipant}
                    onSetProtagonist={entityToggles.handleSetChatProtagonist} onSaveCharacter={characters.saveCharacter}
                    onDeleteContext={entityModals.getModalProperties('context').delete} onToggleContext={entityToggles.handleToggleContext} onSaveContext={contexts.saveContext}
                    onDeleteLocation={entityModals.getModalProperties('location').delete} onToggleLocation={entityToggles.handleToggleLocation} onSaveLocation={locations.saveLocation}
                    onDeleteAudioTrack={entityModals.getModalProperties('audioTrack').delete} onToggleAudioTrack={entityToggles.handleToggleAudioTrack} onSaveAudioTrack={audioTracks.saveAudioTrack}
                    onSaveWorld={worlds.saveWorld} onLoadWorld={handleLoadWorld} onDeleteWorld={entityModals.getModalProperties('world').delete}
                    onDeleteModel={entityModals.getModalProperties('model').delete} onToggleModelLoad={models.toggleModelLoad}
                    onDeleteSampler={entityModals.getModalProperties('sampler').delete} onDeletePromptBlock={entityModals.getModalProperties('promptBlock').delete}
                    onDeleteStopPattern={entityModals.getModalProperties('stopPattern').delete} onDeleteBudgetStrategy={entityModals.getModalProperties('budgetStrategy').delete}
                    onActivateBudgetStrategy={entityToggles.handleActivateBudgetStrategy} onDeleteProfile={entityModals.getModalProperties('profile').delete}
                    onActivateProfile={entityToggles.handleActivateProfile} onSaveProfile={profiles.saveProfile}
                    onDeleteExtension={extensions.deleteExtension} onToggleExtension={entityToggles.handleToggleExtension}
                    onDeleteMemory={memories.deleteMemory} onDeleteAccount={entityModals.getModalProperties('account').delete}
                    onToggleAccount={(id: string) => {
                        const newId = mp.currentAccountId === id ? null : id;
                        storeSetCurrentAccountId(newId);
                        addToast(newId ? `Activated account "${accounts.accounts.find((a: Account) => a.id === newId)?.name || newId}"` : 'Deactivated account.', newId ? 'success' : 'info');
                    }}
                    onDeleteMultiplayerData={entityModals.getModalProperties('multiplayerData').delete}
                    onJoinSession={mp.handleJoinSession}
                    onUpdateInteractionData={(data: InteractionData) => { setInteractionData(assignInitialLocationsIfNeeded(data)); saveRawInteractionData(assignInitialLocationsIfNeeded(data)); }}
                    onForceFirstMessage={handleForceFirstMessage} onSendCustomMessage={handleSendCustom}
                    onInjectCustomMessage={handleInjectCustom} onInjectFirstMessage={handleInjectFirst}
                    onImportComplete={handleImportComplete} addToast={addToast} ensureChatsLoaded={chatList.ensureLoaded}
                    pendingJoinRequests={mp.multiplayerSync.pendingJoinRequests}
                    onAcceptJoinRequest={mp.multiplayerSync.acceptJoinRequest}
                    onRejectJoinRequest={mp.multiplayerSync.rejectJoinRequest}
                />
            </div>

            <ActionMenu
                actionMenuTarget={actionMenu.actionMenuTarget} interactionDataExists={!!interactionData}
                menuSearchQuery={actionMenu.menuSearchQuery} setMenuSearchQuery={actionMenu.setMenuSearchQuery}
                showActionFormat={actionMenu.showActionFormat} setShowActionFormat={actionMenu.setShowActionFormat}
                actionWrap={actionMenu.actionWrap} setActionWrap={actionMenu.setActionWrap}
                actionCase={actionMenu.actionCase} setActionCase={actionMenu.setActionCase}
                actionPunctuation={actionMenu.actionPunctuation} setActionPunctuation={actionMenu.setActionPunctuation}
                isAutoFormat={actionMenu.isAutoFormat} setIsAutoFormat={actionMenu.setIsAutoFormat}
                filteredActions={actionMenu.getFilteredActions()} isModelReady={isModelReady}
                allCharacters={characters.characters} localProtagonist={localProtagonist}
                onAddAction={actionMenu.handleAddAction} onDeleteAction={actionMenu.handleDeleteAction} onActionInterject={actionMenu.handleActionInterject}
            />
        </>
    );
}

export default App;