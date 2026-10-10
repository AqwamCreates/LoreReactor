// frontend_src/components/App.tsx
import type React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../context/ToastContext';
import { saveRawInteractionData, loadRawInteractionData, flushSaveQueue, getCharacterImageUrl } from '../storages/serverStorage';
import { createChatMessage, addMessageToInteractionData } from '../utilities/chatLogic';
import { assignInitialLocationsIfNeeded } from '../utilities/locationLogic';
import { useDisplayNameCache } from '../utilities/immersionLogic';
import { getCharacterStarterMessage } from '../utilities/characterLogic';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { textToSpeechModelEngine } from '../services/TextToSpeechEngine';
import { voiceCloningEngine } from '../services/VoiceCloningEngine';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { buildModelLoadArguments } from '../utilities/modelLoadArguments';
import { localURL } from '../../configurations';
import { speechToTextEngine } from '../services/SpeechToTextEngine';
import { cloudBackends } from '../dictionaries/languageModelInformation';
import { useFrontCamera } from '../hooks/useFrontCamera';
import type { Character, Context, Location, AudioTrack, World, LanguageModel, Account, MultiplayerData, InteractionData, ChatMessage, WhisperMessage, HistoryMessage, RawInteractionData, cloudBackend } from '../types';
import { useSessionStore } from '../hooks/useSessionStore';

// ─── Manager Hooks ──────────────────────────────────────────────────
import { useChatListManager } from '../hooks/useChatListManager';
import { useCharacterManager } from '../hooks/useCharacterManager';
import { useActionManager } from '../hooks/useActionManager';
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
import { useMultiplayerBroadcast } from '../hooks/useMultiplayerBroadcast';
import { useServerSync } from '../hooks/useServerSync';

// ─── Feature Hooks ───────────────────────────────────────────────────
import { useChatSession } from '../hooks/useChatSession';
import { useChatRestoration } from '../hooks/useChatRestoration';
import { useEntitySync } from '../hooks/useEntitySync';
import { useActionMenu } from '../hooks/useActionMenu';
import { useChatOperations } from '../hooks/useChatOperations';
import { useEntityToggles } from '../hooks/useEntityToggles';
import { useViewAssets } from '../hooks/useViewAssets';
import { useMessageToolbar } from '../hooks/useMessageToolbar';
import { useAppModals } from '../hooks/useAppModals';
import { useMessageActions } from '../hooks/useMessageActions';

// ─── Components ──────────────────────────────────────────────────────
import { ActionMenu } from './ActionMenu';
import AppModals from './AppModals';
import { ChatInput } from './ChatInput';
import { ContextBar } from './ContextBar';
import { LoadingScreen } from './LoadingScreen';
import { ChatStatisticsBar } from './ChatStatisticsBar';
import { ChatMinimap } from './ChatMinimap';
import { ChatViewArea } from './views/ChatViewArea';
import type { ViewModeProps, viewMode } from './views/types';
import { defaultContextLength } from '../dictionaries/defaults';
import '../main.css';

// ─── Types & Helpers ─────────────────────────────────────────────────

interface LoadStep { id: string; label: string; icon: string; done: boolean; }

function deriveCurrentProtagonistId(
    interactionData: InteractionData | null,
    multiplayerData: MultiplayerData | null,
    currentAccountId: string | null,
): string | null {
    if (!interactionData?.protagonistIds?.length) return null;
    if (!multiplayerData || !currentAccountId) return interactionData.protagonistIds[0] ?? null;
    
    const activeCharId = multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.protagonistCharacterId;
    if (activeCharId) {
        const isProtagonist = interactionData.protagonistIds.includes(activeCharId);
        const isParticipant = interactionData.participants?.some((p: Character) => p.id === activeCharId);
        if (isProtagonist || isParticipant) return activeCharId;
    }
    return interactionData.protagonistIds[0] ?? null;
}

// ─── App Component ───────────────────────────────────────────────────

function App() {
    const { addToast } = useToast();
    const { captureFrontCameraImage } = useFrontCamera(addToast);

    // ─── Manager Hooks ───────────────────────────────────────────────
    const chatList = useChatListManager();
    const characters = useCharacterManager();
    const actionManager = useActionManager(addToast);
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
    const allLanguageModels = models.models;

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
    const sessionLoaded = useSessionStore((s: any) => s.sessionLoaded);
    const selectedCharacterId = useSessionStore((s: any) => s.selectedCharacterId);
    const selectedBudgetStrategyId = useSessionStore((s: any) => s.selectedBudgetStrategyId);
    const streamingText = useSessionStore((s: any) => s.streamingText);
    const storeSetCurrentAccountId = useSessionStore((s: any) => s.setCurrentAccountId);
    const storeSetSelectedCharacterId = useSessionStore((s: any) => s.setSelectedCharacterId);
    const storeSetSelectedBudgetStrategyId = useSessionStore((s: any) => s.setSelectedBudgetStrategyId);

    // ─── Multiplayer Session ─────────────────────────────────────────
    const mp = useMultiplayerSession({
        allCharacters: characters.characters,
        saveMultiplayerData: multiplayerDataManager.saveMultiplayerData,
        addToast,
    });

    const handleBroadcastMessage = useCallback((msg: HistoryMessage) => {
        mp.broadcastMessageRef.current?.(msg);
    }, [mp.broadcastMessageRef]);

    const handleRequestBorrowedModel = useCallback(() => {
        return mp.requestBorrowedModelRef.current();
    }, [mp.requestBorrowedModelRef]);

    // ─── Chat Session ────────────────────────────────────────────────
    const session = useChatSession({
        onMessageBroadcast: handleBroadcastMessage,
        onStateBroadcast: (state) => {
            if (canBroadcastState) mp.multiplayerSync.broadcastStateSync?.(state as any);
        },
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
        allMultiplayerData: multiplayerDataManager.multiplayerData,
        allActions: actionManager.allActions,
        requestBorrowedModel: handleRequestBorrowedModel,
        requestPeerInference: mp.multiplayerSync.requestPeerInference,
    });

    const {
        interactionData, setInteractionData, setSelectedCharacter,
        isLoading, currentCharacterExpression,
        sendMessage, stopGeneration, resumeGeneration, regenerateFromMessage,
        messageEndRef, chatHistoryRef, startNewChat, sendActionAndGetResponse,
        setActiveBudgetStrategy, setSelectedGlobalModel,
        activeStrategy, budgetData,
    } = session;

    // ─── Chat Restoration ────────────────────────────────────
    const { activeChatRestored } = useChatRestoration({
        sessionLoaded,
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
        const stored = useSessionStore.getState().localProtagonist;
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

    // ─── Auto-Associate Multiplayer Room (Strict Match or Reset to Solo) ──
    useEffect(() => {
        if (!interactionData?.id || mp.joinSessionId) return;

        const currentStoreMpData = useSessionStore.getState().multiplayerData;
        const match = multiplayerDataManager.multiplayerData.find(
            (m: MultiplayerData) => m.interactionDataIds.includes(interactionData.id!)
        ) ?? null;

        if (currentStoreMpData?.id !== match?.id) {
            useSessionStore.setState({ multiplayerData: match });
        }
    }, [interactionData?.id, multiplayerDataManager.multiplayerData, mp.joinSessionId]);

    // ─── Graceful Window Close & Host Failover ────────────────────────
    const mpSyncRef = useRef(mp.multiplayerSync);
    useEffect(() => {
        mpSyncRef.current = mp.multiplayerSync;
    }, [mp.multiplayerSync]);

    useEffect(() => {
        const handleBeforeUnload = () => {
            flushSaveQueue();

            const sync = mpSyncRef.current;
            if (sync?.isConnected) {
                if (sync.isHost && sync.connectedPeers.length > 0) {
                    sync.initiateBranch();
                } else {
                    sync.disconnect();
                }
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // ─── Derived Protagonist ─────────────────────────────────────────
    const localProtagonistId = useMemo(
        () => deriveCurrentProtagonistId(interactionData, mp.multiplayerData, mp.currentAccountId),
        [interactionData, mp.multiplayerData, mp.currentAccountId],
    );

    const localProtagonist = useMemo(
        () => localProtagonistId ? interactionData?.participants.find(p => p.id === localProtagonistId) ?? null : null,
        [localProtagonistId, interactionData]
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
        const target = allLanguageModels.find((m: LanguageModel) => m.id === modelId);
        if (!target || (target.apiKey && target.backend)) return null;
        try {
            const args = buildModelLoadArguments(target);
            const res = await fetch(`${localURL}/language_models/load`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: target.id, modelPath: target.model || '', args }),
            });
            if (!res.ok) return null;
            return (await res.json()).port ?? null;
        } catch (e) { console.warn(`Auto-load of model ${target.name} failed:`, e); return null; }
    }, [allLanguageModels, models]);

    useSessionEffects({
        interactionDataId: interactionData?.id,
        isMultiplayerClient: mp.isMultiplayerClient,
        selectedModelId: models.selectedModelId,
        setSelectedModelId: models.setSelectedModelId,
        selectedBudgetStrategyId,
        allBudgetStrategies: budgetStrategies.strategies,
        setActiveBudgetStrategy,
        allLanguageModels,
        runningModels: models.runningModels,
        setSelectedGlobalModel,
        selectedCharacterId,
        allCharacters: characters.characters,
        selectedProfileId: interactionData?.profile?.id,
        setSelectedCharacter,
        activeStrategy, budgetData,
        loadLocalModelForBudgetStrategyEngine: loadLocalModelForBudgetEngine,
    });

    // ─── Sentiment Engine ────────────────────────────────────
    useEffect(() => {
        const profile = interactionData?.profile;
        const enabled = profile?.enableCharacterExpression ?? false;
        const devicePref = profile?.sentimentalAnalysisDeviceType ?? 'auto';
        
        sentimentEngine.setDevicePreference(devicePref);

        if (enabled) {
            sentimentEngine.initialize();
        } else {
            sentimentEngine.unload();
        }
    }, [interactionData]);

    // ─── TTS & Voice Cloning Engine Device Preferences ───────────────
    useEffect(() => {
        const profile = interactionData?.profile;
        const ttsDevice = profile?.textToSpeechDeviceType ?? 'auto';
        const vcDevice = profile?.voiceCloningDeviceType ?? 'auto';
        
        textToSpeechModelEngine.setDevicePreference(ttsDevice);
        voiceCloningEngine.setDevicePreference(vcDevice);
    }, [interactionData]);

    // ─── TTS Preloading & Unloading based on Narration Settings ────
    useEffect(() => {
        const profile = interactionData?.profile;
        
        // Check if ANY text type is set to be narrated
        const isNarrationEnabled = profile?.narrateTexts 
            ? Object.values(profile.narrateTexts).some(v => v === true) 
            : false;
        
        if (isNarrationEnabled) {
            // Preload the TTS model in the background while the user is typing/reading.
            // This eliminates the "loading model" delay when the AI finishes generating text.
            textToSpeechModelEngine.load(); 
        } else {
            // If no narration is enabled, aggressively unload the TTS model to free VRAM/RAM.
            textToSpeechModelEngine.unload();
        }
    }, [interactionData]);

    // ─── Chat Auto-Save ──────────────────────────────────────────────
    useChatAutoSave({
        interactionData,
        rawChatShells: chatList.rawChatShells,
        refreshChatList: chatList.refresh,
    });

    // ─── Server Sync (Multi-Device State Updates) ────────────────────
    useServerSync({
        refreshers: {
            characters: characters.refresh,
            chats: chatList.refresh,
            contexts: contexts.refresh,
            locations: locations.refresh,
            models: models.refresh,
            samplers: samplers.refresh,
            worlds: worlds.refresh,
            profiles: profiles.refresh,
            promptBlocks: promptBlocks.refresh,
            audioTracks: audioTracks.refresh,
            budgetStrategies: budgetStrategies.refresh,
            stopPatterns: stopPatterns.refresh,
            memories: memories.refresh,
            accounts: accounts.refresh,
            multiplayerData: multiplayerDataManager.refresh,
        },
    });

    // ─── Model Readiness ─────────────────────────────────────────────
    const isModelReady = useMemo(() => {
        if (mp.isMultiplayerClient) return true;
        if (activeStrategy) return true;
        if (!models.selectedModelId) return false;
        if (models.selectedModelId.startsWith('borrowed-')) return true;
        const sel = allLanguageModels.find((m: LanguageModel) => m.id === models.selectedModelId);
        if (sel?.apiKey && sel.backend && cloudBackends.includes(sel.backend as cloudBackend)) return true;
        return models.runningModels[models.selectedModelId]?.isRunning
            && models.runningModels[models.selectedModelId]?.isIdle;
    }, [allLanguageModels, activeStrategy, mp.isMultiplayerClient, models]);

    const isModelLoading = useMemo(() => {
        if (mp.isMultiplayerClient || !models.selectedModelId) return false;
        if (models.selectedModelId.startsWith('borrowed-')) return false;
        const sel = allLanguageModels.find((m: LanguageModel) => m.id === models.selectedModelId);
        if (sel?.apiKey && sel.backend && cloudBackends.includes(sel.backend as cloudBackend)) return false;
        return models.runningModels[models.selectedModelId]?.isRunning
            && models.runningModels[models.selectedModelId]?.isIdle !== true;
    }, [allLanguageModels, mp.isMultiplayerClient, models]);

    const modelStatusMessage = mp.isMultiplayerClient ? ''
        : (!models.selectedModelId ? 'No model selected — open Language Models to load one.'
            : isModelLoading ? 'Model is warming up... please wait.' : '');

    // ─── Feature Hooks ───────────────────────────────────────────────
    const actionMenu = useActionMenu({
        actionManager,
        interactionData, currentCharacter, isLoading, isModelReady,
        allCharacters: characters.characters, stopGeneration, sendActionAndGetResponse, addToast,
    });

    const messageActions = useMessageActions({
        interactionData, isModelReady, isLoading,
        setInteractionData, regenerateFromMessage, addToast,
    });

    const chatOps = useChatOperations({
        interactionData, currentCharacter, localProtagonistId, selectedCharacterId,
        allCharacters: characters.characters, rawChatShells: chatList.rawChatShells,
        loadFullCharacter: characters.loadFullCharacter,
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
        setSelectedCharacterId: storeSetSelectedCharacterId,
        setSelectedModelId: models.setSelectedModelId,
        loadFullCharacter: characters.loadFullCharacter, addToast,
    });

    const isMultiplayerChat = mp.isMultiplayerClient || !!(mp.multiplayerData && interactionData?.id && mp.multiplayerData.interactionDataIds.includes(interactionData.id));
    const canBroadcastState = isMultiplayerChat && mp.multiplayerSync.isConnected && (mp.multiplayerSync.isHost || mp.multiplayerSync.isAdministrator);

    // ─── Multiplayer Broadcast Handlers ──────────────────────────────
    const mpBroadcast = useMultiplayerBroadcast({
        handleSetChatProtagonist: entityToggles.handleSetChatProtagonist,
        handleToggleParticipant: entityToggles.handleToggleParticipant,
        handleToggleContext: entityToggles.handleToggleContext,
        handleToggleLocation: entityToggles.handleToggleLocation,
        handleToggleAudioTrack: entityToggles.handleToggleAudioTrack,
        handleActivateProfile: entityToggles.handleActivateProfile,
        isMultiplayerChat,
        canBroadcastState,
        multiplayerSync: mp.multiplayerSync,
        interactionData,
        allCharacters: characters.characters,
        allContexts: contexts.contexts,
        allLocations: locations.locations,
        allAudioTracks: audioTracks.audioTracks,
        allProfiles: profiles.profiles,
    });

    // ─── Local UI State ──────────────────────────────────────────────
    const editingId = useSessionStore(s => s.editingId);
    const editDraft = useSessionStore(s => s.editDraft);

    const [viewMode, setViewMode] = useState<viewMode>('ladder');
    const [isOverlayOpen, setIsOverlayOpen] = useState(false);

    const [inputText, setInputText] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const editTextAreaRef = useRef<HTMLTextAreaElement>(null);

    const lastViewedMessageIdRef = useRef<string | null>(null);
    const suppressAutoScrollRef = useRef(false);

    const viewAssets = useViewAssets({
        viewMode,
        interactionData, localProtagonist, currentCharacter,
        streamingCharacter: session.streamingCharacter, currentCharacterExpression, chatHistoryRef,
        isMultiplayerChat,
        lastViewedMessageIdRef,
        suppressAutoScrollRef,
    });

    const messageToolbar = useMessageToolbar({ chatHistoryRef });
    const displayNameCache = useDisplayNameCache(interactionData, localProtagonistId);
    const { modals } = useAppModals();

    useEffect(() => {
        if (mp.needsCharacterSelection) {
            modals.charList.open();
            addToast('Select a character from the Session or Local tab and click the ★ icon to join.', 'info');
            mp.clearNeedsCharacterSelection();
        }
    }, [mp.needsCharacterSelection, modals.charList, addToast, mp]);

    const maxParticipantTokens = useTokenCounter({
        messages: (viewAssets.chatMessages || []).filter((m): m is ChatMessage => m.messageType === 'chat'),
        interactionData,
        selectedModelId: models.selectedModelId,
        allLanguageModels,
        runningModels: models.runningModels,
        activeStrategy,
    });

    useEffect(() => { 
        if (!textareaRef.current) return; 
        textareaRef.current.style.height = 'auto'; 
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, window.innerHeight * 0.3)}px`; 
    }, []);

    useEffect(() => { 
        if (!editTextAreaRef.current || !editingId) return; 
        editTextAreaRef.current.style.height = 'auto'; 
        editTextAreaRef.current.style.height = `${editTextAreaRef.current.scrollHeight}px`; 
    }, [editingId]);

    const canDelete = (!isMultiplayerChat || mp.multiplayerSync.isHost || mp.multiplayerSync.isAdministrator) && !isLoading;
    const safeMessages = useMemo(() => viewAssets.chatMessages || [], [viewAssets.chatMessages]);

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
                const m = allLanguageModels.find((x: LanguageModel) => x.id === mid);
                if (m && m.contextLength > max) max = m.contextLength;
            }
            return max || defaultContextLength;
        }
        if (models.selectedModelId) {
            const m = allLanguageModels.find((x: LanguageModel) => x.id === models.selectedModelId);
            return m?.contextLength || defaultContextLength;
        }
        return defaultContextLength;
    }, [activeStrategy, allLanguageModels, models]);

    const parentInteractionDataId = interactionData?.parentInteractionDataId;

    const parentChatName = useMemo(() => {
        if (!parentInteractionDataId) return null;
        return chatList.rawChatShells.find((s: RawInteractionData) => s.id === parentInteractionDataId)?.name ?? null;
    }, [parentInteractionDataId, chatList.rawChatShells]);

    const committedMessages = useMemo(() => {
        let base = safeMessages.filter((m): m is ChatMessage | WhisperMessage => m.messageType === 'chat' || m.messageType === 'whisper');
        if (isMultiplayerChat && localProtagonist) {
            base = base.filter((msg) => {
                if (msg.messageType === 'whisper') {
                    const w = msg as WhisperMessage;
                    return w.character.id === localProtagonist.id || w.targetCharacterIds.includes(localProtagonist.id);
                }
                return true;
            });
        }
        return base;
    }, [safeMessages, isMultiplayerChat, localProtagonist]);

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

    const loadSteps = useMemo<LoadStep[]>(() => [
        { id: 'session', label: 'Session Data', icon: '⚙️', done: sessionLoaded },
        { id: 'chats', label: 'Chat Sessions', icon: '💬', done: !chatList.isLoading },
        { id: 'characters', label: 'Characters', icon: '🎭', done: !characters.isLoading },
        { id: 'actions', label: 'Actions', icon: '⚡', done: !actionManager.actionsLoading },
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
    ], [sessionLoaded, chatList, characters, actionManager.actionsLoading, contexts, locations, audioTracks, worlds, promptBlocks, models, samplers, stopPatterns, budgetStrategies, profiles, accounts, multiplayerDataManager]);

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

    const ensureChatsLoaded = chatList.load;

    useEffect(() => { 
        if (!isInitializing && activeChatRestored) {
            ensureChatsLoaded(); 
        } 
    }, [isInitializing, activeChatRestored, ensureChatsLoaded]);

    const wrappedSaveEdit = useCallback(async () => {
        await messageActions.handleSaveEdit();
        if (isMultiplayerChat && editingId) mp.multiplayerSync.broadcastMessageEdit(editingId, editDraft);
    }, [messageActions, isMultiplayerChat, mp.multiplayerSync, editingId, editDraft]);

    const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        if (files.length > 0) { setPendingFiles(prev => [...prev, ...files]); addToast(`${files.length} file${files.length !== 1 ? 's' : ''} attached.`); }
        requestAnimationFrame(() => { if (fileInputRef.current) fileInputRef.current.value = ''; });
    };

    const handleSend = useCallback(async (overrideText?: string) => {
        const textToSend = overrideText !== undefined ? overrideText : inputText;
        if (!textToSend.trim() && !pendingFiles.length) return;
        let frontCam: string | undefined;
        const profileCam = interactionData?.profile?.useFrontCameraImage;
        if (profileCam === 1) { const img = await captureFrontCameraImage(); if (img) frontCam = img; }
        else if (profileCam === 0 && currentCharacter?.useFrontCameraImage) { const img = await captureFrontCameraImage(); if (img) frontCam = img; }
        sendMessage(textToSend, promptBlocks.promptBlocks, pendingFiles, frontCam);
        setInputText(''); setPendingFiles([]);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }, [inputText, pendingFiles, sendMessage, promptBlocks, captureFrontCameraImage, interactionData, currentCharacter]);

    const handleToggleMic = useCallback(async () => {
        if (isRecording) { 
            await speechToTextEngine.stopRecording(); 
            setIsRecording(false); 
        } else {
            const profile = interactionData?.profile;
            const isAuto = profile?.enableAutoSpeechDetection ?? false;

            const sttDevice = profile?.speechToTextDeviceType ?? 'auto';
            speechToTextEngine.setDevicePreference(sttDevice);

            if (isAuto) {
                const actThreshold = profile?.speechVolumeActivationThreshold ?? 15;
                const silThreshold = profile?.speechSilenceVolumeActivationThreshold ?? 8;
                const silenceMs = profile?.speechSilenceThresholdMs ?? 1500;
                const vadProbThreshold = profile?.voiceActivityProbabilityThreshold ?? 0.5;
                const vadDevice = profile?.voiceActivityDetectionDeviceType ?? 'auto';

                const started = await speechToTextEngine.startAutoListening(
                    (partialText: string) => {
                        setInputText(prev => prev + (prev ? ' ' : '') + partialText);
                    },
                    (finalText: string) => {
                        setIsRecording(false);
                        setInputText('');
                        if (finalText && finalText.trim().length > 0) {
                            handleSend(finalText.trim());
                        }
                    },
                    { 
                        volumeActivationThresholdPercent: actThreshold,
                        silenceVolumeActivationThresholdPercent: silThreshold,
                        silenceThresholdMs: silenceMs,
                        voiceActivityProbabilityThreshold: vadProbThreshold,
                        vadDevicePreference: vadDevice
                    }
                );

                if (!started) { 
                    addToast('Failed to start voice activity detection.', 'error'); 
                    return; 
                }
                setIsRecording(true);
                addToast('🎙️ Hands-free listening active...', 'info');
            } else {
                const started = await speechToTextEngine.startRecording(
                    (text: string) => setInputText(prev => prev + (prev ? ' ' : '') + text)
                );
                if (!started) { 
                    addToast('Failed to start voice input.', 'error'); 
                    return; 
                }
                setIsRecording(true);
            }
        }
    }, [isRecording, interactionData?.profile, handleSend, addToast]);

    const handleToggleOverlay = async () => {
        try {
            const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
            let overlayWin = await WebviewWindow.getByLabel('companion-overlay');
            if (overlayWin) {
                const isVisible = await overlayWin.isVisible();
                if (isVisible) {
                    await overlayWin.hide();
                    setIsOverlayOpen(false);
                } else {
                    await overlayWin.show();
                    try {
                        await overlayWin.setFocus();
                    } catch {}
                    setIsOverlayOpen(true);
                }
            } else {
                overlayWin = new WebviewWindow('companion-overlay', {
                    url: 'index.html',
                    title: 'LoreReactor Companion',
                    width: 360,
                    height: 540,
                    transparent: true,
                    decorations: false,
                    alwaysOnTop: true,
                });
                setIsOverlayOpen(true);
            }
        } catch (err) {
            console.warn('[App] Tauri overlay toggle failed:', err);
        }
    };

    const toggleViewMode = () => {
        setViewMode(prev => 
            prev === 'ladder' ? 'cinematic' : 
            prev === 'cinematic' ? 'visual novel' : 'ladder'
        );

        const container = chatHistoryRef.current;
        let targetIdx = -1;
        if (container && interactionData) {
            const rect = container.getBoundingClientRect();
            const ids = new Set(safeMessages.map(m => m.id));
            let bestTop = Number.POSITIVE_INFINITY;
            for (const el of container.querySelectorAll('[data-message-id]')) {
                const mid = el.getAttribute('data-message-id');
                if (!mid || !ids.has(mid)) continue;
                const r = el.getBoundingClientRect();
                if (r.top < rect.bottom && r.bottom > rect.top && r.top < bestTop) { 
                    bestTop = r.top; 
                    targetIdx = safeMessages.findIndex(m => m.id === mid); 
                }
            }
        }
        if (targetIdx === -1 && lastViewedMessageIdRef.current && interactionData) {
            targetIdx = safeMessages.findIndex(m => m.id === lastViewedMessageIdRef.current);
        }
        if (targetIdx >= 0 && interactionData) {
            lastViewedMessageIdRef.current = safeMessages[targetIdx].id;
        }
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

    const handleImportComplete = useCallback(() => { getLanguageModelEngine().clearTokenCache(); chatList.refresh(); }, [chatList]);

    const handleForceFirstMessage = useCallback((char: Character) => {
        if (!interactionData || mp.isMultiplayerClient) return;
        const text = getCharacterStarterMessage(char);
        const msg = createChatMessage(interactionData, char, text);
        const updated = addMessageToInteractionData(interactionData, msg);
        setInteractionData(updated);
        addToast(`Sent first message as ${char.name}`, 'success');

        if (isMultiplayerChat && mp.multiplayerSync.isConnected) {
            handleBroadcastMessage({ ...msg, doNotRespond: true });
        }
    }, [interactionData, mp.isMultiplayerClient, addToast, setInteractionData, isMultiplayerChat, mp.multiplayerSync.isConnected, handleBroadcastMessage]);

    const handleSendCustom = useCallback((char: Character, text: string) => {
        if (!interactionData || mp.isMultiplayerClient) return;
        const msg = createChatMessage(interactionData, char, text);
        const updated = addMessageToInteractionData(interactionData, msg);
        setInteractionData(updated);
        addToast(`Sent message as ${char.name}`, 'success');

        if (isMultiplayerChat && mp.multiplayerSync.isConnected) {
            handleBroadcastMessage(msg);
        }
    }, [interactionData, mp.isMultiplayerClient, addToast, setInteractionData, isMultiplayerChat, mp.multiplayerSync.isConnected, handleBroadcastMessage]);

    const handleInjectCustom = useCallback((char: Character, text: string) => {
        if (!interactionData || mp.isMultiplayerClient) return;
        const msg = createChatMessage(interactionData, char, text);
        const updated = addMessageToInteractionData(interactionData, msg);
        setInteractionData(updated);
        addToast(`Injected message as ${char.name}`, 'success');

        if (isMultiplayerChat && mp.multiplayerSync.isConnected) {
            handleBroadcastMessage({ ...msg, doNotRespond: true });
        }
    }, [interactionData, mp.isMultiplayerClient, addToast, setInteractionData, isMultiplayerChat, mp.multiplayerSync.isConnected, handleBroadcastMessage]);

    const handleInjectFirst = useCallback((char: Character) => {
        if (!interactionData || mp.isMultiplayerClient) return;
        const text = getCharacterStarterMessage(char);
        const msg = createChatMessage(interactionData, char, text);
        const updated = addMessageToInteractionData(interactionData, msg);
        setInteractionData(updated);
        addToast(`Injected first message as ${char.name}`, 'success');

        if (isMultiplayerChat && mp.multiplayerSync.isConnected) {
            handleBroadcastMessage({ ...msg, doNotRespond: true });
        }
    }, [interactionData, mp.isMultiplayerClient, addToast, setInteractionData, isMultiplayerChat, mp.multiplayerSync.isConnected, handleBroadcastMessage]);

    const onDeleteChatForModals = useCallback((id: string) => {
        chatOps.handleDeleteChat({ stopPropagation: () => {} } as React.MouseEvent, id);
    }, [chatOps]);

    const handleRenameChat = useCallback(async (id: string, name: string) => {
        const currentInteractionData = useSessionStore.getState().interactionData;
        
        const loaded = (currentInteractionData?.id === id)
            ? currentInteractionData
            : await loadRawInteractionData(id);

        if (!loaded) { addToast('Chat not found.', 'error'); return; }
        const updated = { ...loaded, name, lastUpdatedTimestamp: Date.now() };
        await saveRawInteractionData(updated);
        chatList.refresh();
        if (currentInteractionData?.id === id) {
            useSessionStore.getState().setInteractionData(updated);
        }
        addToast(`Renamed to "${name}"`, 'success');
    }, [chatList, addToast]);

    const handleNavigateToBranchSource = useCallback(async () => {
        if (!parentInteractionDataId) return;
        await chatOps.handleSwitchChat(parentInteractionDataId);
    }, [parentInteractionDataId, chatOps]);

    const handleLoadWorlds = useCallback((activeWorlds: World[]) => {
        if (!interactionData) return;

        const prevWorldIds: string[] = interactionData?.worldIds || [];
        const prevWorlds = worlds.worlds.filter((w: World) => prevWorldIds.includes(w.id));

        const prevWorldCharIds = new Set(prevWorlds.flatMap(w => w.characterIds || []));
        const prevWorldCtxIds = new Set(prevWorlds.flatMap(w => w.contextIds || []));
        const prevWorldLocIds = new Set(prevWorlds.flatMap(w => w.locationIds || []));
        const prevWorldAudioIds = new Set(prevWorlds.flatMap(w => w.audioTrackIds || []));

        const nextWorldIds = activeWorlds.map(w => w.id);
        const nextWorldCharIds = new Set(activeWorlds.flatMap(w => w.characterIds || []));
        const nextWorldCtxIds = new Set(activeWorlds.flatMap(w => w.contextIds || []));
        const nextWorldLocIds = new Set(activeWorlds.flatMap(w => w.locationIds || []));
        const nextWorldAudioIds = new Set(activeWorlds.flatMap(w => w.audioTrackIds || []));

        const retainedParticipants = (interactionData.participants || []).filter(p => {
            if (prevWorldCharIds.has(p.id)) return nextWorldCharIds.has(p.id);
            return true;
        });
        const existingParticipantIds = new Set(retainedParticipants.map(p => p.id));
        const newCharsToAdd = Array.from(nextWorldCharIds)
            .filter(id => !existingParticipantIds.has(id))
            .map(id => characters.characters.find(c => c.id === id))
            .filter((c): c is Character => !!c);
        const mergedParticipants = [...retainedParticipants, ...newCharsToAdd];

        const retainedContexts = (interactionData.contexts || []).filter(c => {
            if (prevWorldCtxIds.has(c.id)) return nextWorldCtxIds.has(c.id);
            return true;
        });
        const existingContextIds = new Set(retainedContexts.map(c => c.id));
        const newContextsToAdd = Array.from(nextWorldCtxIds)
            .filter(id => !existingContextIds.has(id))
            .map(id => contexts.contexts.find(c => c.id === id))
            .filter((c): c is Context => !!c);
        const mergedContexts = [...retainedContexts, ...newContextsToAdd];

        const retainedLocations = (interactionData.locations || []).filter(l => {
            if (prevWorldLocIds.has(l.id)) return nextWorldLocIds.has(l.id);
            return true;
        });
        const existingLocationIds = new Set(retainedLocations.map(l => l.id));
        const newLocsToAdd = Array.from(nextWorldLocIds)
            .filter(id => !existingLocationIds.has(id))
            .map(id => locations.locations.find(l => l.id === id))
            .filter((l): l is Location => !!l);
        const mergedLocations = [...retainedLocations, ...newLocsToAdd];

        const retainedAudio = (interactionData.audioTracks || []).filter(t => {
            if (prevWorldAudioIds.has(t.id)) return nextWorldAudioIds.has(t.id);
            return true;
        });
        const existingAudioIds = new Set(retainedAudio.map(t => t.id));
        const newAudiosToAdd = Array.from(nextWorldAudioIds)
            .filter(id => !existingAudioIds.has(id))
            .map(id => audioTracks.audioTracks.find(t => t.id === id))
            .filter((t): t is AudioTrack => !!t);
        const mergedAudioTracks = [...retainedAudio, ...newAudiosToAdd];

        let mergedProfile = interactionData.profile;
        const activeProfileId = activeWorlds.find(w => w.profileId)?.profileId;
        if (activeProfileId) {
            mergedProfile = profiles.profiles.find(p => p.id === activeProfileId) || mergedProfile;
        } else if (prevWorlds.some(w => w.profileId && w.profileId === interactionData.profile?.id)) {
            mergedProfile = undefined;
        }

        let mergedProtagonistIds = interactionData.protagonistIds || [];
        const participantIdSet = new Set(mergedParticipants.map(p => p.id));
        mergedProtagonistIds = mergedProtagonistIds.filter(id => participantIdSet.has(id));
        if (mergedProtagonistIds.length === 0 && mergedParticipants.length > 0) {
            mergedProtagonistIds = [mergedParticipants[0].id];
        }

        let updated: InteractionData = {
            ...interactionData,
            participants: mergedParticipants,
            protagonistIds: mergedProtagonistIds,
            contexts: mergedContexts,
            locations: mergedLocations,
            audioTracks: mergedAudioTracks,
            profile: mergedProfile,
            worldIds: nextWorldIds,
            lastUpdatedTimestamp: Date.now(),
        };

        updated = assignInitialLocationsIfNeeded(updated);
        setInteractionData(updated);

        if (canBroadcastState) {
            (mp.multiplayerSync as any).broadcastStateSync?.({
                participants: updated.participants,
                protagonistIds: updated.protagonistIds,
                contexts: updated.contexts,
                locations: updated.locations,
                audioTracks: updated.audioTracks,
                profile: updated.profile,
            });
        }
    }, [
        interactionData, worlds.worlds, characters.characters, contexts.contexts,
        locations.locations, audioTracks.audioTracks, profiles.profiles,
        setInteractionData, canBroadcastState, mp.multiplayerSync
    ]);

    const baseViewProps: ViewModeProps = {
        displayMessages: committedMessages as ChatMessage[],
        portraitUrlCache: viewAssets.portraitUrlCache, 
        displayNameCache,
        formattedStreamingText: null,
        centerAvatar: viewAssets.centerAvatar,
        parentMessageId: interactionData?.parentMessageId ?? null,
        parentInteractionDataName: parentChatName,
        chatHistoryRef, 
        messageEndRef,
        editTextAreaRef, 
        focusedMessageId, 
        setFocusedMessageId,
        onAvatarClick: actionMenu.handleAvatarClick,
        onSaveEdit: wrappedSaveEdit,
        onRegenerateFromEdit: messageActions.handleRegenerateFromEdit,
        onResumeGeneration: (id: string) => resumeGeneration(id, promptBlocks.promptBlocks), 
        onRegenerateFromMessage: regenerateFromMessage,
        onMassDeleteConfirm: messageActions.handleConfirmMassDelete,
        onTouchStart: messageToolbar.handleBubbleTouchStart,
        onTouchEnd: messageToolbar.handleBubbleTouchEnd,
        onTouchMove: messageToolbar.handleBubbleTouchMove,
        suppressNextClickRef: messageToolbar.suppressNextClickRef,
        onNavigateToBranchSource: handleNavigateToBranchSource,
        canDelete,
    };

    const containerClass = [
        'chat-container',
        viewMode === 'cinematic' ? 'mode-cinematic' : '',
        viewMode === 'visual novel' ? 'mode-vn' : '',
        viewMode === 'ladder' ? 'mode-ladder' : '',
        viewAssets.locationBackgroundUrl ? 'has-location-bg' : '',
    ].filter(Boolean).join(' ');

    const getCompanionStateSnapshot = useCallback(() => {
        const protagonistId = localProtagonist?.id ?? interactionData?.protagonistIds?.[0];
        
        const companionChar = interactionData?.participants?.find((p: Character) => p.id !== protagonistId) 
            || interactionData?.participants?.find((p: Character) => p.id !== currentCharacter?.id)
            || null;
        
        let activeChar = companionChar;
        let isUser = false;
        let activeMsgId: string | null = null;

        if (isLoading && session.streamingCharacter) {
            activeChar = session.streamingCharacter;
            isUser = false;
        } else if (viewAssets.chatMessages && viewAssets.chatMessages.length > 0) {
            for (let i = viewAssets.chatMessages.length - 1; i >= 0; i--) {
                const msg = viewAssets.chatMessages[i];
                if (msg.messageType === 'chat' || msg.messageType === 'whisper') {
                    activeChar = msg.character;
                    isUser = protagonistId ? msg.character.id === protagonistId : false;
                    activeMsgId = msg.id;
                    break;
                }
            }
        }

        const avatarChar = (isLoading && session.streamingCharacter && session.streamingCharacter.id !== protagonistId)
            ? session.streamingCharacter
            : (!isUser && activeChar && activeChar.id !== protagonistId)
            ? activeChar
            : companionChar;

        let avatarUrl: string | null = null;
        if (avatarChar && avatarChar.id !== protagonistId) {
            const cache = viewAssets.portraitUrlCache;
            if (activeMsgId && !isUser && cache.get(activeMsgId)) {
                avatarUrl = cache.get(activeMsgId) ?? null;
            } else if (cache.get(`character:${avatarChar.id}`)) {
                avatarUrl = cache.get(`character:${avatarChar.id}`) ?? null;
            } else if (avatarChar.images) {
                const expr = (avatarChar.id === session.streamingCharacter?.id ? currentCharacterExpression : undefined) || 'neutral';
                const filename = avatarChar.images[expr] || avatarChar.images['neutral'] || Object.values(avatarChar.images)[0];
                if (filename) {
                    avatarUrl = filename.startsWith('data:') || filename.startsWith('http')
                        ? filename
                        : getCharacterImageUrl(avatarChar.id, filename);
                }
            }
        }

        return {
            avatarUrl,
            charName: activeChar?.name || companionChar?.name || 'Companion',
            isUser,
            isLoading,
            streamingText: streamingText || '',
            streamingCharacter: session.streamingCharacter || null,
            locationBackgroundUrl: avatarUrl ? viewAssets.locationBackgroundUrl : null,
            allActions: actionManager.allActions || [],
            allCharacters: characters.characters,
            allLocations: locations.locations,
            allContexts: contexts.contexts,
            allAudioTracks: audioTracks.audioTracks,
            allAccounts: accounts.accounts,
            allMultiplayerData: multiplayerDataManager.multiplayerData,
            interactionData,
            localProtagonist,
            allLanguageModels: allLanguageModels,
            selectedModelId: models.selectedModelId,
            allBudgetStrategies: budgetStrategies.strategies,
            selectedBudgetStrategyId: selectedBudgetStrategyId,
            allProfiles: profiles.profiles,
            activeProfileId: interactionData?.profile?.id || null,
            allWorlds: worlds.worlds,
            allSamplers: samplers.Samplers,
            allStopPatterns: stopPatterns.stopPatterns,
            allPromptBlocks: promptBlocks.promptBlocks,
            allMemories: memories.memories,
            lastMessageId: activeMsgId,
        };
    }, [
        isLoading, session.streamingCharacter, streamingText, currentCharacterExpression, 
        interactionData, localProtagonist, currentCharacter, viewAssets.chatMessages, 
        viewAssets.portraitUrlCache, viewAssets.locationBackgroundUrl, actionManager.allActions,
        characters.characters, locations.locations, contexts.contexts, audioTracks.audioTracks,
        accounts.accounts, multiplayerDataManager.multiplayerData,
        allLanguageModels, models.selectedModelId, budgetStrategies.strategies, selectedBudgetStrategyId,
        profiles.profiles, worlds.worlds, samplers.Samplers, stopPatterns.stopPatterns,
        promptBlocks.promptBlocks, memories.memories
    ]);

    const companionChannelRef = useRef<BroadcastChannel | null>(null);
    const getCompanionStateSnapshotRef = useRef(getCompanionStateSnapshot);

    useEffect(() => {
        getCompanionStateSnapshotRef.current = getCompanionStateSnapshot;
    }, [getCompanionStateSnapshot]);

    const { setSelectedModelId: setGlobalModelId, toggleModelLoad } = models;
    const { handleActivateBudgetStrategy } = entityToggles;
    const { saveProfile } = profiles;

    useEffect(() => {
        const channel = new BroadcastChannel('lorereactor-companion-sync');
        companionChannelRef.current = channel;

        const handleChannelMessage = (e: MessageEvent) => {
            if (e.data?.type === 'REQUEST_STATE') {
                channel.postMessage({
                    type: 'STATE_UPDATE',
                    data: getCompanionStateSnapshotRef.current(),
                });
            } else if (e.data?.type === 'SEND_MESSAGE' && e.data?.text !== undefined) {
                sendMessage(e.data.text, promptBlocks.promptBlocks, e.data.files || [], undefined);
            } else if (e.data?.type === 'INTERJECT_ACTION' && e.data?.label) {
                const protagonistId = localProtagonist?.id ?? interactionData?.protagonistIds?.[0];
                const companionChar = interactionData?.participants?.find((p: Character) => p.id !== protagonistId) 
                    || interactionData?.participants?.find((p: Character) => p.id !== currentCharacter?.id)
                    || null;
                if (companionChar && localProtagonist) {
                    actionMenu.handleActionInterject(e.data.label, companionChar, localProtagonist);
                }
            } else if (e.data?.type === 'ADD_ACTION' && e.data?.label) {
                actionManager.handleAddAction(e.data.label);
            } else if (e.data?.type === 'DELETE_ACTION' && e.data?.label) {
                actionManager.handleDeleteAction(e.data.label);
            } else if (e.data?.type === 'SELECT_MODEL' && e.data?.modelId !== undefined) {
                const targetModelId = e.data.modelId || null;
                setGlobalModelId(targetModelId);
                if (targetModelId) {
                    toggleModelLoad(targetModelId);
                    handleActivateBudgetStrategy(null);
                }
            } else if (e.data?.type === 'SELECT_BUDGET' && e.data?.budgetId !== undefined) {
                const targetBudgetId = e.data.budgetId || null;
                handleActivateBudgetStrategy(targetBudgetId);
                if (targetBudgetId) {
                    setGlobalModelId(null);
                }
            } else if (e.data?.type === 'UPDATE_PROFILE' && e.data?.profile) {
                saveProfile(e.data.profile).then(() => {
                    if (interactionData?.profile?.id === e.data.profile.id && interactionData) {
                        const updatedData = { ...interactionData, profile: e.data.profile, lastUpdatedTimestamp: Date.now() };
                        setInteractionData(updatedData);
                    }
                    addToast('Profile updated from overlay.', 'success');
                }).catch(() => {
                    addToast('Failed to update profile from overlay.', 'error');
                });
            } else if (e.data?.type === 'ACTIVATE_PROFILE' && e.data?.profileId) {
                const targetProfile = profiles.profiles.find(p => p.id === e.data.profileId);
                if (targetProfile && interactionData) {
                    const updatedData = { ...interactionData, profile: targetProfile, lastUpdatedTimestamp: Date.now() };
                    setInteractionData(updatedData);
                    addToast(`Activated profile "${targetProfile.name}"`, 'success');
                }
            } else if (e.data?.type === 'RESUME_GENERATION' && e.data?.messageId) {
                resumeGeneration(e.data.messageId, promptBlocks.promptBlocks);
            } else if (e.data?.type === 'RESTART_GENERATION' && e.data?.messageId) {
                regenerateFromMessage(e.data.messageId, interactionData?.protagonistIds || [], promptBlocks.promptBlocks);
            } else if (e.data?.type === 'STOP_GENERATION') {
                stopGeneration();
            } else if (e.data?.type === 'SAVE_EDIT' && e.data?.messageId && e.data?.text !== undefined) {
                useSessionStore.getState().setEditingState(e.data.messageId, e.data.text);
                wrappedSaveEdit();
            }
        };

        channel.addEventListener('message', handleChannelMessage);
        return () => {
            channel.removeEventListener('message', handleChannelMessage);
            channel.close();
            companionChannelRef.current = null;
        };
    }, [
        sendMessage, promptBlocks.promptBlocks, actionMenu, actionManager, localProtagonist, 
        interactionData, currentCharacter, setGlobalModelId, toggleModelLoad, 
        handleActivateBudgetStrategy, saveProfile, setInteractionData, addToast, 
        profiles.profiles, resumeGeneration, regenerateFromMessage, stopGeneration, 
        wrappedSaveEdit
    ]);

    useEffect(() => {
        if (companionChannelRef.current) {
            companionChannelRef.current.postMessage({
                type: 'STATE_UPDATE',
                data: getCompanionStateSnapshot(),
            });
        }
    }, [getCompanionStateSnapshot]);

    return (
        <>
            {isInitializing && <LoadingScreen steps={loadSteps} isFadeOut={isFadeOut} />}

            <div
                className={containerClass}
                style={viewAssets.locationBackgroundUrl && viewMode !== 'visual novel' ? { '--location-bg': `url(${viewAssets.locationBackgroundUrl})` } as React.CSSProperties : undefined}
                onClick={() => { actionMenu.closeActionMenu(); messageToolbar.deactivateToolbar(); }}
            >
                {interactionData && (
                    <>
                        <header className="app-header">
                            <div className="header-content">
                                <div className="header-top">
                                    {viewMode === 'ladder' && safeMessages.length > 5 && (
                                        <ChatMinimap messages={safeMessages.filter((m: HistoryMessage): m is ChatMessage => m.messageType === 'chat')} containerRef={chatHistoryRef} selectedCharacterId={currentCharacter?.id} />
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                        {chatOps.isEditingTitle
                                            ? <input ref={el => el?.focus()} type="text" value={chatOps.editTitleValue} onChange={e => chatOps.setEditTitleValue(e.target.value)} onBlur={chatOps.handleSaveTitle} onKeyDown={e => { if (e.key === 'Enter') chatOps.handleSaveTitle(); if (e.key === 'Escape') chatOps.cancelEditTitle(); }} style={{ background: 'var(--social-bg)', border: '1px solid var(--accent)', color: 'var(--text-h)', padding: '4px 8px', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', flexGrow: 1, maxWidth: '200px', outline: 'none' }} />
                                            : <><span onClick={chatOps.handleStartEditTitle} title="Edit Title" style={{ fontSize: '0.9em', opacity: 0.3, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.3'}>✎</span><div className="header-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{interactionData?.name || 'Untitled Chat'}</div></>}
                                    </div>
                                    <div className="header-controls-group">
                                        <button
                                            type="button"
                                            className={`view-mode-toggle ${isOverlayOpen ? 'active' : ''}`}
                                            onClick={handleToggleOverlay}
                                            title={isOverlayOpen ? "Close Companion Overlay" : "Open Companion Overlay"}
                                            style={{ padding: '6px 10px' }}
                                        >
                                            <span>🪟</span>
                                        </button>

                                        <button type="button" className="view-mode-toggle" onClick={modals.settings.open} title="Settings" style={{ padding: '6px 10px' }}><span>⚙️</span></button>

                                        <button type="button" className="view-mode-toggle" onClick={() => modals.extensionList.open()} title="Extensions" style={{ padding: '6px 10px' }}><span>🧩</span></button>

                                        <button type="button" onClick={toggleViewMode} className="view-mode-toggle" title="Switch View Mode">
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

                        <ChatViewArea
                            viewMode={viewMode}
                            baseProps={baseViewProps}
                            safeMessages={committedMessages}
                            displayNameCache={displayNameCache}
                            isMultiplayerChat={isMultiplayerChat}
                        />

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
                            allMemories={memories.memories} allAccounts={accounts.accounts} allMultiplayerData={multiplayerDataManager.multiplayerData}
                            fileInputRef={fileInputRef} textareaRef={textareaRef} onFileSelected={handleFileSelected}
                            onToggleMicrophone={handleToggleMic} onSend={() => handleSend()}
                            onStopGeneration={stopGeneration} onOpenModels={modals.modelList.open} allLanguageModels={models.models} allBudgetStrategies={budgetStrategies.strategies}
                        />
                    </>
                )}

                <AppModals
                    isMultiplayerClient={mp.isMultiplayerClient}
                    modals={modals} entityModals={entityModals}
                    runningModels={models.runningModels} rawChatShells={chatList.rawChatShells}
                    allCharacters={characters.characters} allContexts={contexts.contexts} allLocations={locations.locations}
                    allAudioTracks={audioTracks.audioTracks} allWorlds={worlds.worlds} allLanguageModels={allLanguageModels}
                    allSamplers={samplers.Samplers} allPromptBlocks={promptBlocks.promptBlocks} allStopPatterns={stopPatterns.stopPatterns}
                    allBudgetStrategies={budgetStrategies.strategies} allProfiles={profiles.profiles} allExtensions={extensions.extensions}
                    allMemories={memories.memories} allAccounts={accounts.accounts} allMultiplayerData={multiplayerDataManager.multiplayerData}
                    onSwitchChat={chatOps.handleSwitchChat} onDeleteChat={onDeleteChatForModals} onNewChat={chatOps.handleNewChat}
                    onRenameChat={handleRenameChat}
                    onDeleteCharacter={entityModals.getModalProperties('character').delete}
                    onLoadFullCharacter={characters.loadFullCharacter} 
                    onToggleParticipant={mpBroadcast.handleToggleParticipantAndBroadcast}
                    onSetProtagonist={mpBroadcast.handleSetProtagonistAndBroadcast} 
                    onSaveCharacter={characters.saveCharacter}
                    onDeleteContext={entityModals.getModalProperties('context').delete} 
                    onToggleContext={mpBroadcast.handleToggleContextAndBroadcast} 
                    onSaveContext={contexts.saveContext}
                    onDeleteLocation={entityModals.getModalProperties('location').delete} 
                    onToggleLocation={mpBroadcast.handleToggleLocationAndBroadcast} 
                    onSaveLocation={locations.saveLocation}
                    onDeleteAudioTrack={entityModals.getModalProperties('audioTrack').delete} 
                    onToggleAudioTrack={mpBroadcast.handleToggleAudioTrackAndBroadcast} 
                    onSaveAudioTrack={audioTracks.saveAudioTrack}
                    onSaveWorld={worlds.saveWorld} 
                    onToggleWorlds={handleLoadWorlds} 
                    onDeleteWorld={entityModals.getModalProperties('world').delete}
                    onDeleteModel={entityModals.getModalProperties('model').delete} 
                    onToggleModelLoad={models.toggleModelLoad}
                    onDeleteSampler={entityModals.getModalProperties('sampler').delete} 
                    onDeletePromptBlock={entityModals.getModalProperties('promptBlock').delete}
                    onDeleteStopPattern={entityModals.getModalProperties('stopPattern').delete} 
                    onDeleteBudgetStrategy={entityModals.getModalProperties('budgetStrategy').delete}
                    onActivateBudgetStrategy={entityToggles.handleActivateBudgetStrategy} 
                    onDeleteProfile={entityModals.getModalProperties('profile').delete}
                    onActivateProfile={mpBroadcast.handleActivateProfileAndBroadcast} 
                    onSaveProfile={profiles.saveProfile}
                    onDeleteExtension={extensions.deleteExtension} 
                    onToggleExtension={entityToggles.handleToggleExtension}
                    onDeleteMemory={memories.deleteMemory} 
                    onDeleteAccount={entityModals.getModalProperties('account').delete}
                    onToggleAccount={(id: string) => {
                        const newId = mp.currentAccountId === id ? null : id;
                        storeSetCurrentAccountId(newId);
                        addToast(newId ? `Activated account "${accounts.accounts.find((a: Account) => a.id === newId)?.name || newId}"` : 'Deactivated account.', newId ? 'success' : 'info');
                    }}
                    onDeleteMultiplayerData={entityModals.getModalProperties('multiplayerData').delete}
                    onJoinSession={mp.handleJoinSession}
                    onUpdateInteractionData={(data: InteractionData) => { 
                        const assigned = assignInitialLocationsIfNeeded(data);
                        setInteractionData(assigned);
                        if (canBroadcastState) {
                            (mp.multiplayerSync as any).broadcastStateSync?.({
                                participants: assigned.participants,
                                contexts: assigned.contexts,
                                locations: assigned.locations,
                                audioTracks: assigned.audioTracks,
                                profile: assigned.profile,
                            });
                        }
                    }}
                    onForceFirstMessage={handleForceFirstMessage} 
                    onSendCustomMessage={handleSendCustom}
                    onInjectCustomMessage={handleInjectCustom} 
                    onInjectFirstMessage={handleInjectFirst}
                    onImportComplete={handleImportComplete} 
                    addToast={addToast} 
                    ensureChatsLoaded={chatList.load}
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