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
import { useEntityModals } from '../hooks/useEntityModals';
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
import { useFrontCamera } from '../hooks/useFrontCamera';
import type { Character, Context, Location, AudioTrack, World, LanguageModel, InteractionData, ChatMessage, MultiplayerData, HistoryMessage, cloudBackend, WhisperMessage } from '../types';
import { useChatRestoration } from '../hooks/useChatRestoration';
import { useEntitySync } from '../hooks/useEntitySync';
import { useActionMenu } from '../hooks/useActionMenu';
import { useMessageActions } from '../hooks/useMessageActions';
import { useChatOperations } from '../hooks/useChatOperations';
import { useEntityToggles } from '../hooks/useEntityToggles';
import { useViewAssets } from '../hooks/useViewAssets';
import { useMessageToolbar } from '../hooks/useMessageToolbar';
import { useAppModals } from '../hooks/useAppModals';
import { useActiveExtensions } from '../hooks/useActiveExtensions';
import { useSessionStore } from '../hooks/useSessionStore';
import { ActionMenu } from './ActionMenu';
import { AppModals } from './AppModals';
import { ChatInput } from './ChatInput';
import { ContextBar } from './ContextBar';
import { LoadingScreen } from './LoadingScreen';
import { ChatStatisticsBar } from './ChatStatisticsBar';
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
const STORAGE_KEY_JOIN_SESSION_ID = 'loreReactor_joinSessionId';
const STORAGE_KEY_JOIN_PASSWORD = 'loreReactor_joinPassword';
const STORAGE_KEY_JOIN_PROTAGONIST = 'loreReactor_joinProtagonist';
const MINIMUM_LOADING_SCREEN_MILLISECONDS = 900;

interface LoadStep { 
    id: string; 
    label: string; 
    icon: string; 
    done: boolean; 
}

function hasMessagesChanged(previousInteractionData: InteractionData | null, currentInteractionData: InteractionData): boolean {
    if (!previousInteractionData || !previousInteractionData.interactionHistory || !currentInteractionData.interactionHistory) return true;
    if (previousInteractionData.interactionHistory.length !== currentInteractionData.interactionHistory.length) return true;
    
    for (let index = 0; index < previousInteractionData.interactionHistory.length; index++) {
        const previousMessage = previousInteractionData.interactionHistory[index];
        const currentMessage = currentInteractionData.interactionHistory[index];
        
        if (previousMessage.id !== currentMessage.id) return true;
        if (previousMessage.character.id !== currentMessage.character.id) return true;
        
        if ('textContent' in previousMessage && 'textContent' in currentMessage) {
            if ((previousMessage as ChatMessage).textContent !== (currentMessage as ChatMessage).textContent) return true;
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
    const activeCharacterIdentifier = multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.activeCharacterId;
    if (activeCharacterIdentifier) {
        const foundProtagonist = interactionData.protagonists.find(protagonist => protagonist.id === activeCharacterIdentifier) || 
                                 interactionData.participants.find(participant => participant.id === activeCharacterIdentifier);
        if (foundProtagonist) return foundProtagonist;
    }
    return interactionData.protagonists[0] ?? null;
}

function clearJoinState() {
    localStorage.removeItem(STORAGE_KEY_JOIN_SESSION_ID);
    localStorage.removeItem(STORAGE_KEY_JOIN_PASSWORD);
    localStorage.removeItem(STORAGE_KEY_JOIN_PROTAGONIST);
    localStorage.removeItem('loreReactor_joinCharId');
    localStorage.removeItem('loreReactor_joinCharData');
}

function App() {
    const { addToast } = useToast();
    const { captureImage: captureFrontCameraImage } = useFrontCamera(addToast);

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

    // ─── Unified Modal Management Hooks ──────────────────────────────
    const { modals } = useAppModals();
    const entityModals = useEntityModals({
        character: { saveFunction: saveCharacter, deleteFunction: deleteCharacter, entityLabel: 'Character' },
        context: { saveFunction: saveContext, deleteFunction: deleteContext, entityLabel: 'Context' },
        location: { saveFunction: saveLocation, deleteFunction: deleteLocation, entityLabel: 'Location' },
        audioTrack: { saveFunction: saveAudioTrack, deleteFunction: deleteAudioTrack, entityLabel: 'Audio Track' },
        world: { saveFunction: saveWorld, deleteFunction: deleteWorld, entityLabel: 'World' },
        model: { saveFunction: saveModel, deleteFunction: deleteModel, entityLabel: 'Model' },
        sampler: { saveFunction: saveSampler, deleteFunction: deleteSampler, entityLabel: 'Sampler' },
        promptBlock: { saveFunction: savePromptBlock, deleteFunction: deletePromptBlock, entityLabel: 'Prompt Block' },
        stopPattern: { saveFunction: saveStopPattern, deleteFunction: deleteStopPattern, entityLabel: 'Stop Pattern' },
        budgetStrategy: { saveFunction: saveBudgetStrategy, deleteFunction: deleteBudgetStrategy, entityLabel: 'Budget Strategy' },
        profile: { saveFunction: saveProfile, deleteFunction: deleteProfile, entityLabel: 'Profile' },
        account: { saveFunction: saveAccount, deleteFunction: deleteAccount, entityLabel: 'Account' },
        multiplayerData: { saveFunction: saveMultiplayerData, deleteFunction: deleteMultiplayerData, entityLabel: 'Multiplayer Data' },
    });

    // ─── Multiplayer Broadcast Bridge ────────────────────────────────
    const broadcastMessageReference = useRef<((message: HistoryMessage) => void) | undefined>(undefined);
    const onMessageBroadcast = useCallback((message: HistoryMessage) => {
        broadcastMessageReference.current?.(message);
    }, []);

    const requestBorrowedModelReference = useRef<() => Promise<LanguageModel | null>>(async () => null);

    const currentAccountId = useSessionStore(state => state.currentAccountId);
    const multiplayerData = useSessionStore(state => state.multiplayerData);
    const defaultCharacterId = useSessionStore(state => state.defaultCharacterId);
    const selectedBudgetStrategyId = useSessionStore(state => state.selectedBudgetStrategyId);

    // ─── Join Session State ──────────────────────────────────────────
    const [joinSessionId, setJoinSessionId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY_JOIN_SESSION_ID));
    const [joinPassword, setJoinPassword] = useState<string>(() => localStorage.getItem(STORAGE_KEY_JOIN_PASSWORD) || '');
    
    const [joinProtagonist, setJoinProtagonist] = useState<Character | null>(() => {
        const stored = localStorage.getItem(STORAGE_KEY_JOIN_PROTAGONIST);
        if (stored) {
            try { return JSON.parse(stored); } catch { return null; }
        }
        return null;
    });

    const [joinRequestedCharacterId, setJoinRequestedCharacterId] = useState<string | null>(() => localStorage.getItem('loreReactor_joinCharId'));
    const [joinRequestedCharacterData, setJoinRequestedCharacterData] = useState<Character | null>(() => {
        const stored = localStorage.getItem('loreReactor_joinCharData');
        try { return stored ? JSON.parse(stored) : null; } catch { return null; }
    });

    const isMultiplayerClient = !!joinSessionId;

    // ─── Session Hook ────────────────────────────────────────────────
    const session = useChatSession({ 
        onMessageBroadcast, 
        isMultiplayerClient, 
        joinProtagonist,
        allCharacters, allContexts, allLocations, allAudioTracks,
        allPromptBlocks, allSamplers, allStopPatterns, allBudgetStrategies,
        allProfiles, allWorlds, allMemories, allExtensions, allAccounts, allMultiplayerData,
        requestBorrowedModel: () => requestBorrowedModelReference.current(),
    });
    const {
        interactionData, setInteractionData, setCurrentCharacter,
        isLoading, streamingText, streamingCharacter, currentCharacterExpression, sendMessage, stopGeneration,
        resumeGeneration, regenerateFromMessage, messageEndRef, chatHistoryRef,
        startNewChat, sendActionAndGetResponse, triggerHostResponse, setActiveBudgetStrategy, setSelectedGlobalModel,
        activeStrategy, budgetData,
    } = session;

    const handleJoinAccepted = useCallback((assignedCharacter: Character) => {
        addToast(`Joined session as ${assignedCharacter.name}.`, 'success');
        if (joinSessionId) localStorage.setItem(STORAGE_KEY_JOIN_SESSION_ID, joinSessionId);
        if (joinPassword) localStorage.setItem(STORAGE_KEY_JOIN_PASSWORD, joinPassword);
        
        setJoinProtagonist(assignedCharacter);
        setCurrentCharacter(assignedCharacter);
        localStorage.setItem(STORAGE_KEY_JOIN_PROTAGONIST, JSON.stringify(assignedCharacter));
    }, [addToast, joinSessionId, joinPassword, setCurrentCharacter]);

    const handleJoinRejected = useCallback((reason: string) => {
        addToast(`Join rejected: ${reason}`, 'error');
        setJoinSessionId(null);
        setJoinPassword('');
        setJoinProtagonist(null);
        setJoinRequestedCharacterId(null);
        setJoinRequestedCharacterData(null);
        clearJoinState();
    }, [addToast]);

    const handleJoinSession = useCallback((sessionId: string, password: string, requestedCharacterIdentifier: string | null, requestedCharacterData: Character | null) => {
        if (!currentAccountId) {
            addToast('No account configured. Create an account first.', 'error');
            return;
        }
        setJoinSessionId(sessionId);
        setJoinPassword(password);
        setJoinRequestedCharacterId(requestedCharacterIdentifier);
        setJoinRequestedCharacterData(requestedCharacterData);

        localStorage.setItem(STORAGE_KEY_JOIN_SESSION_ID, sessionId);
        if (password) localStorage.setItem(STORAGE_KEY_JOIN_PASSWORD, password);
        if (requestedCharacterIdentifier) localStorage.setItem('loreReactor_joinCharId', requestedCharacterIdentifier);
        else localStorage.removeItem('loreReactor_joinCharId');
        if (requestedCharacterData) localStorage.setItem('loreReactor_joinCharData', JSON.stringify(requestedCharacterData));
        else localStorage.removeItem('loreReactor_joinCharData');
    }, [currentAccountId, addToast]);

    const handlePeerChatMessage = useCallback((message: ChatMessage, senderAccountId: string) => {
        if (!message?.id || message.messageType !== 'chat') return;
        const localAccountId = currentAccountId ? currentAccountId.replace(/[^A-Za-z0-9]/g, '') : null;
        if (localAccountId && senderAccountId === localAccountId) return;

        const hasContent = (message.textContent?.trim().length ?? 0) > 0 || (message.files?.length ?? 0) > 0 || Boolean(message.frontCameraImage);
        if (!hasContent) return;
        triggerHostResponse();
    }, [currentAccountId, triggerHostResponse]);

    const handleConnectionFailed = useCallback(() => {
        addToast('Could not connect to host. Returning to local mode.', 'error');
        setJoinSessionId(null);
        setJoinPassword('');
        setJoinProtagonist(null);
        setJoinRequestedCharacterId(null);
        setJoinRequestedCharacterData(null);
        clearJoinState();
    }, [addToast]);

    // ─── Multiplayer Sync ────────────────────────────────────────────
    const multiplayerSync = useMultiplayerSync({
        interactionData, multiplayerData, currentAccountId, setInteractionData,
        allCharacters, joinSessionId, joinPassword, joinRequestedCharacterId, joinRequestedCharacterData,
        onJoinAccepted: handleJoinAccepted,
        onJoinRejected: handleJoinRejected,
        onPeerChatMessage: handlePeerChatMessage,
        onSaveMultiplayerData: saveMultiplayerData,
        onConnectionFailed: handleConnectionFailed,
    });

    useEffect(() => {
        requestBorrowedModelReference.current = multiplayerSync.requestAndAwaitBorrowedModel;
    }, [multiplayerSync.requestAndAwaitBorrowedModel]);

    useEffect(() => {
        broadcastMessageReference.current = multiplayerSync.isConnected ? multiplayerSync.broadcastMessage : undefined;
    }, [multiplayerSync.isConnected, multiplayerSync.broadcastMessage]);

    const { activeChatRestored } = useChatRestoration({
        charsLoading, chatsLoading, contextsLoading, locationsLoading, profilesLoading,
        allCharacters, rawChatShells, loadFullCharacter,
        setInteractionData, setCurrentCharacter, setSelectedModelId, startNewChat,
        skipRestoration: isMultiplayerClient,
    });

    useEffect(() => {
        if (!activeChatRestored) return;
        if (!isMultiplayerClient || !joinProtagonist) return;
        const storedCharacter = useSessionStore.getState().currentCharacter;
        if (!storedCharacter || storedCharacter.id !== joinProtagonist.id) {
            setCurrentCharacter(joinProtagonist);
        }
    }, [activeChatRestored, isMultiplayerClient, joinProtagonist, setCurrentCharacter]);

    const previousChatIdentifierReference = useRef<string | null | undefined>(undefined);
    useEffect(() => {
        if (!activeChatRestored) return;
        const currentChatId = interactionData?.id ?? null;
        const previousChatId = previousChatIdentifierReference.current;

        if (previousChatId !== undefined && previousChatId !== null && previousChatId !== currentChatId) {
            multiplayerSync.disconnect();
            setJoinSessionId(null);
            setJoinPassword('');
            setJoinProtagonist(null);
            setJoinRequestedCharacterId(null);
            setJoinRequestedCharacterData(null);
            clearJoinState();
        }
        previousChatIdentifierReference.current = currentChatId;
    }, [interactionData?.id, multiplayerSync, activeChatRestored]);

    useEffect(() => {
        if (!interactionData?.id || joinSessionId) return;
        if (multiplayerData?.interactionDataIds?.includes(interactionData.id)) return;
        const matchingMultiplayerData = allMultiplayerData.find(multiplayerDataEntry => multiplayerDataEntry.interactionDataIds.includes(interactionData.id!));
        if (matchingMultiplayerData) {
            useSessionStore.setState({ multiplayerData: matchingMultiplayerData });
        } else if (!multiplayerData && allMultiplayerData.length > 0) {
            useSessionStore.setState({ multiplayerData: allMultiplayerData[0] });
        }
    }, [interactionData?.id, allMultiplayerData, multiplayerData, joinSessionId]);

    const localProtagonist = useMemo(
        () => deriveCurrentProtagonist(interactionData, multiplayerData, currentAccountId),
        [interactionData, multiplayerData, currentAccountId],
    );

    const currentCharacter = isMultiplayerClient && joinProtagonist ? joinProtagonist : localProtagonist;

    const setDefaultCharacterId = useCallback((identifier: string | null) => {
        useSessionStore.setState({ defaultCharacterId: identifier });
        if (identifier) localStorage.setItem(STORAGE_KEY_DEFAULT_CHARACTER, identifier);
        else localStorage.removeItem(STORAGE_KEY_DEFAULT_CHARACTER);
    }, []);

    const setSelectedBudgetStrategyId = useCallback((identifier: string | null) => {
        useSessionStore.setState({ selectedBudgetStrategyId: identifier });
        if (identifier) localStorage.setItem(STORAGE_KEY_BUDGET_STRATEGY, identifier);
        else localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY);
    }, []);

    const [maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens, setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens] = useState<number>(0);
    const [isRecording, setIsRecording] = useState(false);
    const [viewMode, setViewMode] = useState<'ladder' | 'cinematic' | 'vn'>('ladder');
    const [inputText, setInputText] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);

    useEntitySync({
        activeChatRestored, allCharacters, allContexts, allProfiles,
        currentCharacter, setInteractionData, setCurrentCharacter,
    });

    const isModelReady = useMemo(() => {
        if (isMultiplayerClient) return true;
        if (activeStrategy) return true;
        if (!selectedModelId) return false;
        const selectedModel = allModels.find(model => model.id === selectedModelId);
        if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend as cloudBackend)) return true;
        return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle === true;
    }, [selectedModelId, allModels, runningModels, activeStrategy, isMultiplayerClient]);

    const {
        actionMenuTarget, menuSearchQuery, setMenuSearchQuery,
        actionsLoading, showActionFormat, setShowActionFormat,
        actionWrap, setActionWrap, actionCase, setActionCase, actionPunctuation, setActionPunctuation,
        handleAddAction, handleDeleteAction, handleActionInterject,
        getFilteredActions, handleAvatarClick, closeActionMenu,
    } = useActionMenu({
        interactionData, currentCharacter, isLoading, isModelReady,
        allCharacters, stopGeneration, sendActionAndGetResponse, addToast,
    });

    const {
        editingId, editDraft, setEditDraft, massDeleteId, setMassDeleteId,
        handleSaveEdit, handleRegenerateFromEdit, handleDelete, handleMassDeleteConfirm,
        handleBranch, handleClone, handleCopyText, startEditing, cancelEditing,
    } = useMessageActions({
        interactionData, localProtagonist, isModelReady, isLoading,
        setInteractionData, setCurrentCharacter, refreshChatList, regenerateFromMessage, addToast,
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
        handleSetChatProtagonist, handleToggleExtension, handleActivateBudgetStrategy, handleActivateProfile,
    } = useEntityToggles({
        interactionData, allCharacters, activeExtensionIds, setActiveExtensionIds,
        allProfiles, allBudgetStrategies, selectedBudgetStrategyId,
        setInteractionData, setCurrentCharacter, setActiveBudgetStrategy,
        setSelectedBudgetStrategyId, setDefaultCharacterId, loadFullCharacter, addToast,
    });

    const isMultiplayerChat = isMultiplayerClient || !!(multiplayerData && interactionData?.id && multiplayerData.interactionDataIds.includes(interactionData.id));
    const canDelete = (!isMultiplayerChat || multiplayerSync.isHost || multiplayerSync.isAdmin) && !isLoading;

    const wrappedHandleSaveEdit = useCallback(async () => {
        await handleSaveEdit();
        if (isMultiplayerChat && editingId) {
            multiplayerSync.broadcastMessageEdit(editingId, editDraft);
        }
    }, [handleSaveEdit, editingId, editDraft, isMultiplayerChat, multiplayerSync]);

    const wrappedHandleDelete = useCallback(async (identifier: string) => {
        await handleDelete(identifier);
        if (isMultiplayerChat) {
            multiplayerSync.broadcastMessageDelete(identifier);
        }
    }, [handleDelete, isMultiplayerChat, multiplayerSync]);

    const wrappedHandleBranch = useCallback((identifier: string) => {
        if (isMultiplayerChat) {
            multiplayerSync.initiateBranch();
        } else {
            handleBranch(identifier);
        }
    }, [handleBranch, isMultiplayerChat, multiplayerSync]);

    const {
        centerAvatar, lastViewedMessageIdRef, suppressAutoScrollRef,
        chatMessages, portraitUrlCache, streamingPortraitUrl, locationBackgroundUrl,
    } = useViewAssets({
        viewMode, interactionData, localProtagonist, currentCharacter,
        streamingCharacter, currentCharacterExpression, chatHistoryRef, isMultiplayerChat,
    });

    const {
        activeToolbarId, deactivateToolbar,
        handleBubbleTouchStart, handleBubbleTouchEnd, handleBubbleTouchMove, suppressNextClickRef,
    } = useMessageToolbar({ chatHistoryRef });

    const displayNameCache = useDisplayNameCache(interactionData);

    const formattedStreamingText = useMemo(() => {
        if (!streamingText) return null;
        return formatDisplayMessageText(streamingText);
    }, [streamingText]);

    const isModelLoading = useMemo(() => {
        if (isMultiplayerClient) return false;
        if (!selectedModelId) return false;
        const selectedModel = allModels.find(model => model.id === selectedModelId);
        if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend as cloudBackend)) return false;
        return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle !== true;
    }, [selectedModelId, allModels, runningModels, isMultiplayerClient]);

    const modelStatusMessage = isMultiplayerClient
        ? ''
        : (!selectedModelId ? 'No model selected — open Language Models to load one' : isModelLoading ? 'Model is warming up... please wait' : '');
    
    const isMassActive = massDeleteId !== null;
    const safeInteractionMessages = useMemo(() => chatMessages || [], [chatMessages]);

    const maximumNumberOfContextTokens = useMemo(() => {
        if (!interactionData?.contexts?.length) return 0;
        let totalTokens = 0;
        for (const context of interactionData.contexts) { if (context.text) totalTokens += Math.ceil(context.text.length / 4); }
        return totalTokens;
    }, [interactionData]);

    const maximumContextLength = useMemo(() => {
        if (activeStrategy) {
            let maxLength = 0;
            for (const modelId of activeStrategy.modelIds) {
                const model = allModels.find(m => m.id === modelId);
                if (model && model.contextLength > maxLength) maxLength = model.contextLength;
            }
            return maxLength || defaultContextLength;
        }
        if (selectedModelId) {
            const foundModel = allModels.find(model => model.id === selectedModelId);
            return foundModel?.contextLength || defaultContextLength;
        }
        return defaultContextLength;
    }, [activeStrategy, selectedModelId, allModels]);

    const parentInteractionDataName = useMemo(() => {
        if (!interactionData?.parentInteractionDataId) return null;
        const parentShell = rawChatShells.find(shell => shell.id === interactionData.parentInteractionDataId);
        return parentShell?.name ?? null;
    }, [interactionData, rawChatShells]);

    const loadLocalModelForBudgetStrategyEngine = useCallback(async (modelId: string): Promise<number | null> => {
        const existingRunningModel = runningModels[modelId];
        if (existingRunningModel?.port) return existingRunningModel.port;
        const targetModel = allModels.find(model => model.id === modelId);
        if (!targetModel) return null;
        if (targetModel.apiKey && targetModel.backend) return null;
        try {
            const modelPath = targetModel.model || '';
            const loadArguments = buildModelLoadArguments(targetModel);
            const response = await fetch(`${localURL}/models/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: targetModel.id, modelPath, args: loadArguments }),
            });
            if (!response.ok) return null;
            const responseData = await response.json();
            return responseData.port ?? null;
        } catch (error) {
            console.warn(`Auto-load of model ${targetModel.name} failed:`, error);
            return null;
        }
    }, [runningModels, allModels]);

    // ─── Effects ────────────────────────────────────────────────────
    useEffect(() => {
        const isCharacterExpressionEnabled = interactionData?.Profile?.enableCharacterExpression ?? false;
        if (isCharacterExpressionEnabled) sentimentEngine.initialize(); else sentimentEngine.unload();
    }, [interactionData?.Profile?.enableCharacterExpression]);

    useEffect(() => { void selectedModelId; void runningModels; getLanguageModelEngine().clearTokenCache(); }, [selectedModelId, runningModels]);
    
    useEffect(() => {
        if (isMultiplayerClient) return;
        if (interactionData?.id) localStorage.setItem(STORAGE_KEY_ACTIVE_CHAT, interactionData.id);
    }, [interactionData?.id, isMultiplayerClient]);
    
    useEffect(() => { if (selectedModelId) localStorage.setItem(STORAGE_KEY_SELECTED_MODEL, selectedModelId); else localStorage.removeItem(STORAGE_KEY_SELECTED_MODEL); }, [selectedModelId]);

    useEffect(() => {
        if (!selectedBudgetStrategyId || allBudgetStrategies.length === 0) return;
        const strategy = allBudgetStrategies.find(strategyItem => strategyItem.id === selectedBudgetStrategyId);
        if (!strategy) { localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY); return; }
        setActiveBudgetStrategy(strategy);
    }, [selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy]);

    useEffect(() => {
        if (!selectedModelId || allModels.length === 0) return;
        const selectedModel = allModels.find(model => model.id === selectedModelId);
        if (!selectedModel) { setSelectedModelId(null); return; }
        const isCloudModel = !!selectedModel.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend as cloudBackend);
        if (isCloudModel) return;
        if (!runningModels[selectedModelId]?.isRunning) setSelectedModelId(null);
    }, [selectedModelId, allModels, runningModels, setSelectedModelId]);

    useEffect(() => {
        if (isMultiplayerClient) return;
        if (defaultCharacterId && allCharacters.length > 0) {
            const defaultCharacter = allCharacters.find(character => character.id === defaultCharacterId);
            if (defaultCharacter && currentCharacter?.id !== defaultCharacter.id) setCurrentCharacter(defaultCharacter);
        }
    }, [defaultCharacterId, allCharacters, currentCharacter?.id, setCurrentCharacter, isMultiplayerClient]);

    useEffect(() => {
        if (selectedModelId && runningModels[selectedModelId]?.isRunning) {
            const foundModel = allModels.find(model => model.id === selectedModelId);
            const portNumber = runningModels[selectedModelId].port;
            if (foundModel && portNumber) setSelectedGlobalModel({ ...foundModel, parameters: { ...foundModel.parameters, _runtimePort: portNumber } });
        } else if (selectedModelId) {
            setSelectedGlobalModel(allModels.find(model => model.id === selectedModelId) || null);
        } else setSelectedGlobalModel(null);
    }, [selectedModelId, runningModels, allModels, setSelectedGlobalModel]);

    useEffect(() => {
        if (!activeStrategy || !budgetData) return;
        try {
            const budgetStrategyEngine = getBudgetStrategyEngine();
            budgetStrategyEngine.setStrategy(activeStrategy);
            budgetStrategyEngine.setBudgetData(budgetData);
            budgetStrategyEngine.setRunningModels(runningModels);
            budgetStrategyEngine.setAllModels(allModels);
            budgetStrategyEngine.setLoadLocalModel(loadLocalModelForBudgetStrategyEngine);
        } catch {
            initializeBudgetStrategyEngine(activeStrategy, budgetData, runningModels, allModels, loadLocalModelForBudgetStrategyEngine);
        }
    }, [activeStrategy, budgetData, allModels, runningModels, loadLocalModelForBudgetStrategyEngine]);

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
    const loadingStartedAtReference = useRef<number | null>(null);
    const chatModifiedReference = useRef(false);
    const previousMessageCountReference = useRef<number>(0);
    const previousInteractionDataReference = useRef<InteractionData | null>(null);

    useEffect(() => {
        if (!isInitializing) return;
        const areAllStepsDone = loadSteps.every(step => step.done);
        if (!areAllStepsDone || !activeChatRestored || !interactionData) return;
        const loadingStartedAt = loadingStartedAtReference.current ?? Date.now();
        loadingStartedAtReference.current = loadingStartedAt;
        const remainingTime = Math.max(0, MINIMUM_LOADING_SCREEN_MILLISECONDS - (Date.now() - loadingStartedAt));
        const holdTimer = setTimeout(() => { 
            setIsFadeOut(true); 
            const fadeTimer = setTimeout(() => { setIsInitializing(false); setIsFadeOut(false); }, 300); 
            return () => clearTimeout(fadeTimer); 
        }, remainingTime);
        return () => clearTimeout(holdTimer);
    }, [loadSteps, isInitializing, activeChatRestored, interactionData]);

    useEffect(() => {
        if (!isInitializing && activeChatRestored) ensureChatsLoaded();
    }, [isInitializing, activeChatRestored, ensureChatsLoaded]);

    useEffect(() => {
        chatModifiedReference.current = false;
        previousMessageCountReference.current = interactionData?.interactionHistory?.length ?? 0;
    }, [interactionData?.interactionHistory?.length]);

    useEffect(() => {
        if (!interactionData || !interactionData.id) return;
        const historyLength = interactionData.interactionHistory?.length ?? 0;
        const protagonistIdentifiers = new Set(interactionData.protagonists?.map(protagonist => protagonist.id) ?? []);
        const nonProtagonistParticipants = interactionData.participants.filter(participant => !protagonistIdentifiers.has(participant.id));
        const hasContent = nonProtagonistParticipants.length > 0 || historyLength > 0 || (interactionData.contexts?.length ?? 0) > 0 || (interactionData.locations?.length ?? 0) > 0 || (interactionData.audioTracks?.length ?? 0) > 0 || !!interactionData.Profile;
        
        if (!chatModifiedReference.current && hasContent) chatModifiedReference.current = true;
        
        if (chatModifiedReference.current && historyLength !== previousMessageCountReference.current) {
            const previousData = previousInteractionDataReference.current;
            const previousProtagonistIdentifiers = new Set(previousData?.protagonists?.map(protagonist => protagonist.id) ?? []);
            const currentProtagonistIdentifiers = new Set(interactionData.protagonists?.map(protagonist => protagonist.id) ?? []);
            const hasProtagonistsChanged = previousProtagonistIdentifiers.size !== currentProtagonistIdentifiers.size || [...previousProtagonistIdentifiers].some(identifier => !currentProtagonistIdentifiers.has(identifier));

            const hasActualChange = !previousData || 
                previousData.interactionHistory?.length !== historyLength ||
                previousData.name !== interactionData.name ||
                hasProtagonistsChanged ||
                previousData.participants.length !== interactionData.participants.length ||
                previousData.contexts?.length !== interactionData.contexts?.length ||
                previousData.locations?.length !== interactionData.locations?.length ||
                previousData.audioTracks?.length !== interactionData.audioTracks?.length ||
                hasMessagesChanged(previousData, interactionData);
            
            if (hasActualChange) {
                previousMessageCountReference.current = historyLength;
                previousInteractionDataReference.current = interactionData;
                saveRawInteractionData(interactionData).catch(error => console.error('Failed to save chat:', error));
                if (!rawChatShells.some(shell => shell.id === interactionData.id)) {
                    refreshChatList();
                }
            }
        }
    }, [interactionData, rawChatShells, refreshChatList]);

    const textareaReference = useRef<HTMLTextAreaElement>(null);
    const editTextAreaRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { if (!textareaReference.current) return; textareaReference.current.style.height = 'auto'; textareaReference.current.style.height = `${Math.min(textareaReference.current.scrollHeight, window.innerHeight * 0.3)}px`; });
    useEffect(() => { if (!editTextAreaRef.current || !editingId) return; editTextAreaRef.current.style.height = 'auto'; editTextAreaRef.current.style.height = `${editTextAreaRef.current.scrollHeight}px`; });

    const tokenCountAbortReference = useRef<AbortController | null>(null);
    const tokenCountTimerReference = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastCountedMessageIdentifiersReference = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (tokenCountTimerReference.current) { clearTimeout(tokenCountTimerReference.current); tokenCountTimerReference.current = null; }
        if (tokenCountAbortReference.current) { tokenCountAbortReference.current.abort(); tokenCountAbortReference.current = null; }
        tokenCountTimerReference.current = setTimeout(async () => {
            if (safeInteractionMessages.length === 0 || !interactionData?.participants) {
                setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens(0);
                lastCountedMessageIdentifiersReference.current.clear();
                return;
            }
            const abortController = new AbortController();
            tokenCountAbortReference.current = abortController;
            try {
                const participantCounts: Record<string, number> = {};
                for (const participant of interactionData.participants) participantCounts[participant.id] = 0;
                let tokenizerModel: LanguageModel | undefined;
                if (selectedModelId) tokenizerModel = allModels.find(model => model.id === selectedModelId);
                if (!tokenizerModel && activeStrategy && activeStrategy.modelIds.length > 0) {
                    tokenizerModel = allModels.find(m => m.id === activeStrategy.modelIds[0]);
                }
                const languageModelEngine = getLanguageModelEngine();
                if (tokenizerModel) { languageModelEngine.setRunningModels(runningModels); languageModelEngine.setContext(tokenizerModel); } else return;
                const previouslyCountedIdentifiers = lastCountedMessageIdentifiersReference.current;
                const currentMessageIdentifiers = new Set<string>();
                let hasNewMessages = false;
                for (const message of safeInteractionMessages) { currentMessageIdentifiers.add(message.id); if (!previouslyCountedIdentifiers.has(message.id)) hasNewMessages = true; }
                if (!hasNewMessages && previouslyCountedIdentifiers.size === currentMessageIdentifiers.size) return;
                for (const message of safeInteractionMessages) {
                    if (abortController.signal.aborted) return;
                    if (previouslyCountedIdentifiers.has(message.id)) continue;
                    if (message.character && (message as ChatMessage).textContent) {
                        const characterId = message.character.id;
                        if (participantCounts[characterId] !== undefined || characterId === '__ambient_narrator__') {
                            const tokens = await languageModelEngine.countTokens((message as ChatMessage).textContent);
                            if (abortController.signal.aborted) return;
                            if (participantCounts[characterId] !== undefined) participantCounts[characterId] += tokens;
                        }
                    }
                }
                lastCountedMessageIdentifiersReference.current = currentMessageIdentifiers;
                if (!abortController.signal.aborted) setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens(Math.max(...Object.values(participantCounts), 0));
            } catch (error) { if ((error as Error).name !== 'AbortError') console.error('Token counting failed:', error); }
        }, 500);
        return () => { 
            if (tokenCountTimerReference.current) { clearTimeout(tokenCountTimerReference.current); tokenCountTimerReference.current = null; } 
            if (tokenCountAbortReference.current) { tokenCountAbortReference.current.abort(); tokenCountAbortReference.current = null; } 
        };
    }, [safeInteractionMessages, interactionData?.participants, selectedModelId, allModels, runningModels, activeStrategy]);

    const fileInputReference = useRef<HTMLInputElement>(null);

    const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = event.target.files;
        const newFiles = fileList ? Array.from(fileList) : [];
        if (newFiles.length > 0) { setPendingFiles(previousFiles => [...previousFiles, ...newFiles]); addToast(`${newFiles.length} file${newFiles.length !== 1 ? 's' : ''} attached.`); }
        requestAnimationFrame(() => { if (fileInputReference.current) fileInputReference.current.value = ''; });
    };

    const handleToggleMicrophone = useCallback(async () => {
        if (isRecording) { await speechToTextEngine.stopRecording(); setIsRecording(false); }
        else {
            const hasRecordingStarted = await speechToTextEngine.startRecording((text) => { setInputText(previousText => previousText + (previousText ? ' ' : '') + text); });
            if (!hasRecordingStarted) { addToast('Failed to start voice input. Check microphone permissions.', 'error'); return; }
            setIsRecording(true);
        }
    }, [isRecording, addToast]);

    const handleSend = useCallback(async () => {
        if (!inputText.trim() && !pendingFiles.length) return;
        let frontCameraImage: string | undefined = undefined;
        const profileUseFrontCamera = interactionData?.Profile?.useFrontCameraImage;
        
        if (profileUseFrontCamera === 1) {
            const capturedImage = await captureFrontCameraImage();
            if (capturedImage) frontCameraImage = capturedImage;
        } else if (profileUseFrontCamera === 0) {
            const characterUseFrontCamera = currentCharacter?.useFrontCameraImage;
            if (characterUseFrontCamera) {
                const capturedImage = await captureFrontCameraImage();
                if (capturedImage) frontCameraImage = capturedImage;
            }
        }
        sendMessage(inputText, allPromptBlocks, pendingFiles, frontCameraImage);
        setInputText('');
        setPendingFiles([]);
        if (textareaReference.current) textareaReference.current.style.height = 'auto';
    }, [inputText, pendingFiles, sendMessage, allPromptBlocks, captureFrontCameraImage, interactionData, currentCharacter]);

    const toggleViewMode = () => {
        setViewMode(previousMode => previousMode === 'ladder' ? 'cinematic' : previousMode === 'cinematic' ? 'vn' : 'ladder');
        const container = chatHistoryRef.current;
        let targetIndex = -1;
        if (container && interactionData) {
            const containerRectangle = container.getBoundingClientRect();
            const messageIdentifiers = new Set(safeInteractionMessages.map(message => message.id));
            let bestTop = Number.POSITIVE_INFINITY;
            for (const element of container.querySelectorAll('[data-message-id]')) {
                const messageId = element.getAttribute('data-message-id'); if (!messageId || !messageIdentifiers.has(messageId)) continue;
                const elementRectangle = element.getBoundingClientRect();
                if (elementRectangle.top < containerRectangle.bottom && elementRectangle.bottom > containerRectangle.top && elementRectangle.top < bestTop) { bestTop = elementRectangle.top; targetIndex = safeInteractionMessages.findIndex(message => message.id === messageId); }
            }
        }
        if (targetIndex === -1 && lastViewedMessageIdRef.current && interactionData) targetIndex = safeInteractionMessages.findIndex(message => message.id === lastViewedMessageIdRef.current);
        if (targetIndex >= 0 && interactionData) lastViewedMessageIdRef.current = safeInteractionMessages[targetIndex].id;
        suppressAutoScrollRef.current = true;
        setTimeout(() => {
            if (targetIndex >= 0 && interactionData && chatHistoryRef.current) {
                const element = chatHistoryRef.current.querySelector(`[data-message-id="${safeInteractionMessages[targetIndex].id}"]`) as HTMLElement | null;
                if (element) { element.scrollIntoView({ block: 'start' }); setTimeout(() => { suppressAutoScrollRef.current = false; }, 400); return; }
            }
            messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setTimeout(() => { suppressAutoScrollRef.current = false; }, 400);
        }, 50);
    };

    const handleImportComplete = useCallback(() => { getLanguageModelEngine().clearTokenCache(); refreshChatList(); }, [refreshChatList]);

    const handleForceFirstMessage = useCallback(async (character: Character) => {
        if (!interactionData) return;
        const chatMessage = createChatMessage(interactionData, character, `*${character.name} enters the scene.*`);
        const updatedInteractionData = addMessageToInteractionData(interactionData, chatMessage);
        setInteractionData(updatedInteractionData);
        await saveRawInteractionData(updatedInteractionData); addToast(`Sent first message as ${character.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleSendCustomMessage = useCallback(async (character: Character, text: string) => {
        if (!interactionData) return;
        const chatMessage = createChatMessage(interactionData, character, text);
        const updatedInteractionData = addMessageToInteractionData(interactionData, chatMessage);
        setInteractionData(updatedInteractionData);
        await saveRawInteractionData(updatedInteractionData); addToast(`Sent message as ${character.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleInjectCustomMessage = useCallback(async (character: Character, text: string) => {
        if (!interactionData) return;
        const injectedContext: Context = { id: crypto.randomUUID(), name: `[Injected] ${character.name}`, description: 'User-injected message for LLM context', text: `${character.name}: ${text}`, isAutoGenerated: true, useBase64Encoding: false, insertionDepth: 0, tokenBudget: 512, limitLinksToSubdirectory: false, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now() };
        const updatedInteractionData: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), injectedContext], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updatedInteractionData);
        await saveRawInteractionData(updatedInteractionData); addToast(`Injected custom message as ${character.name} into LLM context`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleInjectFirstMessage = useCallback(async (character: Character) => {
        if (!interactionData) return;
        const injectedContext: Context = { id: crypto.randomUUID(), name: `[Injected First] ${character.name}`, description: 'User-injected first message for LLM context', text: `${character.name}: *${character.name} enters the scene.*`, isAutoGenerated: true, useBase64Encoding: false, insertionDepth: 0, tokenBudget: 512, limitLinksToSubdirectory: false, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now() };
        const updatedInteractionData: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), injectedContext], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updatedInteractionData);
        await saveRawInteractionData(updatedInteractionData); addToast(`Injected first message as ${character.name} into LLM context`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const onDeleteChatForModals = useCallback((identifier: string) => {
        handleDeleteChat({ stopPropagation: () => {} } as React.MouseEvent, identifier);
    }, [handleDeleteChat]);

    const handleRenameChat = useCallback(async (identifier: string, name: string) => {
        const loadedInteraction = await loadRawInteractionData(identifier, allCharacters);
        if (!loadedInteraction) { addToast('Chat not found.', 'error'); return; }
        const updatedInteraction = { ...loadedInteraction, name, lastUpdatedTimestamp: Date.now() };
        await saveRawInteractionData(updatedInteraction);
        refreshChatList();
        if (interactionData?.id === identifier) setInteractionData({ ...interactionData, name, lastUpdatedTimestamp: Date.now() });
        addToast(`Renamed to "${name}"`, 'success');
    }, [allCharacters, interactionData, setInteractionData, refreshChatList, addToast]);

    const handleNavigateToBranchSource = useCallback(async () => {
        if (!interactionData?.parentInteractionDataId) return;
        try {
            const sourceInteraction = await loadRawInteractionData(interactionData.parentInteractionDataId, allCharacters);
            if (sourceInteraction) {
                setInteractionData(sourceInteraction);
                const sourceMultiplayerData = useSessionStore.getState().multiplayerData;
                const sourceProtagonist = deriveCurrentProtagonist(sourceInteraction, sourceMultiplayerData, currentAccountId);
                if (sourceProtagonist) setCurrentCharacter(sourceProtagonist);
                refreshChatList();
                addToast(`Returned to source: "${sourceInteraction.name}"`, 'info');
            } else addToast('Source chat not found.', 'error');
        } catch { addToast('Failed to load source chat.', 'error'); }
    }, [interactionData, allCharacters, currentAccountId, setInteractionData, setCurrentCharacter, refreshChatList, addToast]);

    const handleLoadWorld = useCallback(async (world: World) => {
        if (!interactionData) return;
        const resolvedCharacters = world.characterIds.map(identifier => allCharacters.find(character => character.id === identifier)).filter((character): character is Character => !!character);
        const resolvedContexts = world.contextIds.map(identifier => allContexts.find(context => context.id === identifier)).filter((context): context is Context => !!context);
        const resolvedLocations = world.locationIds.map(identifier => allLocations.find(location => location.id === identifier)).filter((location): location is Location => location !== undefined);
        const resolvedAudioTracks = (world.audioTrackIds || []).map(identifier => allAudioTracks.find(track => track.id === identifier)).filter((track): track is AudioTrack => !!track);
        const resolvedProfile = world.profileId ? allProfiles.find(profile => profile.id === world.profileId) : undefined;
        let updatedInteraction: InteractionData = { ...interactionData, participants: resolvedCharacters.length > 0 ? resolvedCharacters : interactionData.participants, contexts: resolvedContexts, locations: resolvedLocations, audioTracks: resolvedAudioTracks.length > 0 ? resolvedAudioTracks : [], Profile: resolvedProfile, lastUpdatedTimestamp: Date.now() };
        if (updatedInteraction.protagonists) {
            for (const protagonist of updatedInteraction.protagonists) {
                if (!updatedInteraction.participants.find(participant => participant.id === protagonist.id)) {
                    updatedInteraction.participants = [protagonist, ...updatedInteraction.participants];
                }
            }
        }
        updatedInteraction = assignInitialLocationsIfNeeded(updatedInteraction);
        setInteractionData(updatedInteraction);
        await saveRawInteractionData(updatedInteraction);
        addToast(`Loaded world "${world.name}"`, 'success');
    }, [interactionData, allCharacters, allContexts, allLocations, allAudioTracks, allProfiles, setInteractionData, addToast]);

    const displayMessages = useMemo(() => {
        let baseMessages = [...safeInteractionMessages] as (ChatMessage | WhisperMessage)[];
        if (isMultiplayerChat && localProtagonist) {
            baseMessages = baseMessages.filter(message => {
                if (message.messageType === 'whisper') {
                    const whisperMessage = message as WhisperMessage;
                    const isSender = whisperMessage.character.id === localProtagonist.id;
                    const isTarget = whisperMessage.targetCharacterIds.includes(localProtagonist.id);
                    return isSender || isTarget;
                }
                return true;
            });
        }

        if (isLoading && streamingText && streamingCharacter) {
            const lastMessage = baseMessages[baseMessages.length - 1];
            const isLastMessageStreaming = lastMessage?.character.id === streamingCharacter.id;
            const isNewTurn = !lastMessage || lastMessage.character.id !== streamingCharacter.id;

            if (isLastMessageStreaming) {
                const lastIndex = baseMessages.length - 1;
                const resolvedName = resolveDelayedDisplayNameFromCache(displayNameCache, lastIndex, streamingCharacter.id);
                (baseMessages[lastIndex] as any).textContent = streamingText;
                (baseMessages[lastIndex] as any).character = { ...lastMessage!.character, name: resolvedName };
            } else if (isNewTurn) {
                const streamingIndex = baseMessages.length;
                const resolvedName = resolveDelayedDisplayNameFromCache(displayNameCache, streamingIndex, streamingCharacter.id);
                baseMessages.push({
                    id: `streaming-${streamingCharacter.id}`,
                    messageType: 'chat',
                    character: { ...streamingCharacter, name: resolvedName },
                    textContent: streamingText,
                    files: [],
                    firstCreatedTimestamp: 0,
                    lastUpdatedTimestamp: 0,
                    locationIndex: undefined,
                    characterLockedLocations: {},
                    parentInteractionMessageId: null,
                } as any);
            }
        }
        return baseMessages;
    }, [safeInteractionMessages, isLoading, streamingText, streamingCharacter, displayNameCache, isMultiplayerChat, localProtagonist]);

    const massStartIndex = isMassActive ? displayMessages.findIndex(message => message.id === massDeleteId) : -1;

    const timeUntilResetReference = useRef<number | undefined>(undefined);
    const [timeUntilReset, setTimeUntilReset] = useState<number | undefined>(undefined);

    useEffect(() => {
        if (!budgetData || !activeStrategy || budgetData.resetDuration <= 0) {
            timeUntilResetReference.current = undefined;
            return;
        }
        const computeRemainingTime = () => Math.max(0, budgetData.resetDuration - (Date.now() - budgetData.lastResetTimestamp));
        timeUntilResetReference.current = computeRemainingTime();
        const intervalIdentifier = setInterval(() => {
            const remainingTime = computeRemainingTime();
            timeUntilResetReference.current = remainingTime;
            setTimeUntilReset(remainingTime);
        }, 1000);
        const animationFrameIdentifier = requestAnimationFrame(() => { setTimeUntilReset(timeUntilResetReference.current); });
        return () => { clearInterval(intervalIdentifier); cancelAnimationFrame(animationFrameIdentifier); };
    }, [budgetData, activeStrategy]);

    const viewProps: ViewModeProps & { canDelete: boolean } = {
        interactionData: interactionData!,
        localProtagonist: localProtagonist!,
        displayMessages: displayMessages as ChatMessage[],
        currentCharacterId: currentCharacter?.id,
        editingId, editDraft, massDeleteId, isMassActive, massStartIndex, activeToolbarId,
        portraitUrlCache, displayNameCache, characterScales: new Map(), centerAvatar,
        streamingPortraitUrl, formattedStreamingText, locationBackgroundUrl, isLoading,
        isEditingTitle, editTitleValue,
        parentInteractionMessageId: interactionData?.parentInteractionMessageId ?? null,
        parentInteractionDataName, streamingCharacter, chatHistoryRef, messageEndRef,
        editTextAreaRef, focusedMessageId, setFocusedMessageId,
        onAvatarClick: handleAvatarClick, onStartEditing: startEditing, onCancelEditing: cancelEditing,
        onSaveEdit: wrappedHandleSaveEdit, onRegenerateFromEdit: handleRegenerateFromEdit,
        onResumeGeneration: (identifier: string) => { resumeGeneration(identifier, allPromptBlocks); },
        onCopyText: handleCopyText, onRegenerateFromMessage: regenerateFromMessage,
        onBranch: wrappedHandleBranch, onClone: handleClone, onDelete: wrappedHandleDelete,
        onSetMassDelete: setMassDeleteId, onMassDeleteConfirm: handleMassDeleteConfirm,
        onCancelMassDelete: () => setMassDeleteId(null),
        onTouchStart: handleBubbleTouchStart, onTouchEnd: handleBubbleTouchEnd, onTouchMove: handleBubbleTouchMove,
        suppressNextClickRef, setEditDraft, onNavigateToBranchSource: handleNavigateToBranchSource,
        onStartEditTitle: handleStartEditTitle, onSaveTitle: handleSaveTitle, onCancelEditTitle: cancelEditTitle,
        setEditTitleValue, closeActionMenu, deactivateToolbar, onStopGeneration: stopGeneration, canDelete,
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
                        <button type="button" onClick={() => entityModals.getModalProperties('character').open()} style={{ marginTop: '8px', padding: '8px 20px', fontSize: '0.85rem', fontWeight: 'bold', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>🎭 Create Character</button>
                    </div>
                )}

                {interactionData && (
                    <>
                        <header className="app-header">
                            <div className="header-content">
                                <div className="header-top">
                                    {viewMode === 'ladder' && interactionData && safeInteractionMessages.length > 5 && (
                                        <ChatMinimap
                                            messages={safeInteractionMessages.filter((message): message is ChatMessage => message.messageType === 'chat')}
                                            containerRef={chatHistoryRef}
                                            currentCharacterId={currentCharacter?.id}
                                        />
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                        {isEditingTitle
                                            ? <input ref={element => element?.focus()} type="text" value={editTitleValue} onChange={event => setEditTitleValue(event.target.value)} onBlur={handleSaveTitle} onKeyDown={event => { if (event.key === 'Enter') handleSaveTitle(); if (event.key === 'Escape') cancelEditTitle(); }} style={{ background: 'var(--social-bg)', border: '1px solid var(--accent)', color: 'var(--text-h)', padding: '4px 8px', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', flexGrow: 1, maxWidth: '200px', outline: 'none' }} />
                                            : <><span onClick={handleStartEditTitle} title="Edit Title" style={{ fontSize: '0.9em', opacity: 0.3, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={event => event.currentTarget.style.opacity = '1'} onMouseLeave={event => event.currentTarget.style.opacity = '0.3'}>✎</span><div className="header-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{interactionData?.name || 'Untitled Chat'}</div></>}
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
                                                <span>{multiplayerSync.connectedPeers.length} Peer{multiplayerSync.connectedPeers.length !== 1 ? 's' : ''}</span>
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
                            inputText={inputText} setInputText={setInputText} 
                            pendingFiles={pendingFiles} setPendingFiles={setPendingFiles} 
                            isRecording={isRecording} isLoading={isLoading} isModelReady={isModelReady} 
                            isModelLoading={isModelLoading} modelStatusMessage={modelStatusMessage} 
                            localProtagonist={localProtagonist} activeStrategy={activeStrategy ?? undefined} 
                            selectedModelId={selectedModelId} interactionData={interactionData}
                            allCharacters={allCharacters} allLocations={allLocations} allContexts={allContexts}
                            allAudioTracks={allAudioTracks} allWorlds={allWorlds} allPromptBlocks={allPromptBlocks}
                            allSamplers={allSamplers} allStopPatterns={allStopPatterns} allProfiles={allProfiles}
                            allMemories={allMemories} allAccounts={allAccounts} allMultiplayerData={allMultiplayerData}
                            fileInputRef={fileInputReference} textareaRef={textareaReference} onFileSelected={handleFileSelected} 
                            onToggleMicrophone={handleToggleMicrophone} onSend={handleSend} 
                            onStopGeneration={stopGeneration} onOpenModels={modals.modelList.open} 
                        />
                    </>
                )}

                <AppModals
                    isMultiplayerClient={isMultiplayerClient}
                    modals={modals}
                    entityModals={entityModals}
                    runningModels={runningModels}
                    rawChatShells={rawChatShells}
                    allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations}
                    allAudioTracks={allAudioTracks} allWorlds={allWorlds} allModels={allModels}
                    allSamplers={allSamplers} allPromptBlocks={allPromptBlocks} allStopPatterns={allStopPatterns}
                    allBudgetStrategies={allBudgetStrategies} allProfiles={allProfiles} allExtensions={allExtensions}
                    allMemories={allMemories} allAccounts={allAccounts} allMultiplayerData={allMultiplayerData}
                    onSwitchChat={handleSwitchChat} onDeleteChat={onDeleteChatForModals} onNewChat={handleNewChat}
                    onRenameChat={handleRenameChat} onDeleteCharacter={entityModals.getModalProperties('character').delete}
                    onLoadFullCharacter={loadFullCharacter} onToggleParticipant={handleToggleParticipant}
                    onSetProtagonist={handleSetChatProtagonist} onSaveCharacter={saveCharacter}
                    onDeleteContext={entityModals.getModalProperties('context').delete} onToggleContext={handleToggleContext} onSaveContext={saveContext}
                    onDeleteLocation={entityModals.getModalProperties('location').delete} onToggleLocation={handleToggleLocation} onSaveLocation={saveLocation}
                    onDeleteAudioTrack={entityModals.getModalProperties('audioTrack').delete} onToggleAudioTrack={handleToggleAudioTrack} onSaveAudioTrack={saveAudioTrack}
                    onSaveWorld={saveWorld} onLoadWorld={handleLoadWorld} onDeleteWorld={entityModals.getModalProperties('world').delete}
                    onDeleteModel={entityModals.getModalProperties('model').delete} onToggleModelLoad={toggleModelLoad}
                    onDeleteSampler={entityModals.getModalProperties('sampler').delete} onDeletePromptBlock={entityModals.getModalProperties('promptBlock').delete}
                    onDeleteStopPattern={entityModals.getModalProperties('stopPattern').delete} onDeleteBudgetStrategy={entityModals.getModalProperties('budgetStrategy').delete}
                    onActivateBudgetStrategy={handleActivateBudgetStrategy} onDeleteProfile={entityModals.getModalProperties('profile').delete}
                    onActivateProfile={handleActivateProfile} onSaveProfile={saveProfile}
                    onDeleteExtension={deleteExtension} onToggleExtension={handleToggleExtension}
                    onDeleteMemory={deleteMemory} onDeleteAccount={entityModals.getModalProperties('account').delete}
                    onToggleAccount={(identifier: string) => {
                        const newAccountId = currentAccountId === identifier ? null : identifier;
                        useSessionStore.setState({ currentAccountId: newAccountId });
                        if (newAccountId) localStorage.setItem('loreReactor_currentAccountId', newAccountId);
                        else localStorage.removeItem('loreReactor_currentAccountId');
                        addToast(newAccountId ? `Activated account "${allAccounts.find(account => account.id === newAccountId)?.name || newAccountId}"` : 'Deactivated account.', newAccountId ? 'success' : 'info');
                    }}
                    onDeleteMultiplayerData={entityModals.getModalProperties('multiplayerData').delete}
                    onJoinSession={handleJoinSession}
                    onUpdateInteractionData={(data) => {
                        const dataWithLocations = assignInitialLocationsIfNeeded(data);
                        setInteractionData(dataWithLocations);
                        saveRawInteractionData(dataWithLocations);
                    }}
                    onForceFirstMessage={handleForceFirstMessage} onSendCustomMessage={handleSendCustomMessage}
                    onInjectCustomMessage={handleInjectCustomMessage} onInjectFirstMessage={handleInjectFirstMessage}
                    onImportComplete={handleImportComplete} addToast={addToast} ensureChatsLoaded={ensureChatsLoaded}
                    pendingJoinRequests={multiplayerSync.pendingJoinRequests}
                    onAcceptJoinRequest={multiplayerSync.acceptJoinRequest}
                    onRejectJoinRequest={multiplayerSync.rejectJoinRequest}
                />
            </div>

            <ActionMenu 
                actionMenuTarget={actionMenuTarget} interactionDataExists={!!interactionData} 
                menuSearchQuery={menuSearchQuery} setMenuSearchQuery={setMenuSearchQuery} 
                showActionFormat={showActionFormat} setShowActionFormat={setShowActionFormat} 
                actionWrap={actionWrap} setActionWrap={setActionWrap} 
                actionCase={actionCase} setActionCase={setActionCase} 
                actionPunctuation={actionPunctuation} setActionPunctuation={setActionPunctuation} 
                filteredActions={getFilteredActions()} isModelReady={isModelReady} 
                allCharacters={allCharacters} localProtagonist={localProtagonist}
                onAddAction={handleAddAction} onDeleteAction={handleDeleteAction} onActionInterject={handleActionInterject} 
            />
        </>
    );
}

export default App