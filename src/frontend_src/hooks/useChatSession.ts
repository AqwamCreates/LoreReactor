// src/frontend_src/hooks/useChatSession.ts
import { useRef, useCallback, useEffect } from 'react';
import { useChatEngine } from './useChatEngine';
import { useChatUI } from './useChatUI';
import { useToast } from '../context/ToastContext';
import { useThrottledStream } from './useThrottledStream';
import { useCharacterResponseLock } from './useCharacterResponseLock';
import { useAmbientNarration } from './useAmbientNarration';
import { useSpeculativeStreamHandler } from './useSpeculativeStreamHandler';
import { useChatSessionEffects } from './useChatSessionEffects';
import { useChatSender } from './useChatSender';
import { useChatPipeline } from './useChatPipeline';
import { useFrontCamera } from './useFrontCamera';
import type { ToolExecutionContext } from '../services/ToolExecutor';

import { useChatStore } from './useChatStore';
import { useGenerationStore } from './useGenerationStore';

import type {
    Character, PromptBlock, Profile, InteractionData, Context, Location, AudioTrack,
    Sampler, StopPattern, RetrievalConfiguration, BudgetStrategy, World, Memory, Account,
    MultiplayerData, EntityFolder, RawInteractionData, HistoryMessage, LanguageModel
} from '../types';

interface UseChatSessionOptions {
    onMessageBroadcast: (message: HistoryMessage) => void;
    onStateBroadcast: (state: Partial<InteractionData>) => void;
    isMultiplayerClient: boolean;
    joinProtagonist: Character | null;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allPromptBlocks: PromptBlock[];
    allLanguageModels: LanguageModel[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allRetrievalConfigurations: RetrievalConfiguration[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allWorlds: World[];
    allMemories: Memory[];
    allExtensions: any[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    allRawInteractionDataShells?: RawInteractionData[];
    allEntityFolders?: EntityFolder[];
    allActions: any[];
    requestBorrowedModel?: () => Promise<LanguageModel | null>;
    requestPeerInference?: (peerAccountId: string, modelName: string, promptOrMessages: any, onToken: (token: string) => void, signal?: AbortSignal) => Promise<void>;
}

export function useChatSession(options: UseChatSessionOptions) {
    const { addToast } = useToast();
    const isMultiplayerClient = options?.isMultiplayerClient ?? false;
    const requestBorrowedModel = options?.requestBorrowedModel;

    // ─── Refs for Options Stabilization ────────────────────────────────
    const onMessageBroadcastRef = useRef(options?.onMessageBroadcast);
    const onStateBroadcastRef = useRef(options?.onStateBroadcast);
    const requestPeerInferenceRef = useRef(options?.requestPeerInference);
    const joinProtagonistRef = useRef(options?.joinProtagonist ?? null);
    const allCharactersRef = useRef(options?.allCharacters ?? []);
    const allContextsRef = useRef(options?.allContexts ?? []);
    const allLocationsRef = useRef(options?.allLocations ?? []);
    const allAudioTracksRef = useRef(options?.allAudioTracks ?? []);
    const allPromptBlocksRef = useRef(options?.allPromptBlocks ?? []);
    const allLanguageModelsRef = useRef(options?.allLanguageModels ?? []);
    const allSamplersRef = useRef(options?.allSamplers ?? []);
    const allStopPatternsRef = useRef(options?.allStopPatterns ?? []);
    const allRetrievalConfigurationsRef = useRef(options?.allRetrievalConfigurations ?? []);
    const allBudgetStrategiesRef = useRef(options?.allBudgetStrategies ?? []);
    const allProfilesRef = useRef(options?.allProfiles ?? []);
    const allWorldsRef = useRef(options?.allWorlds ?? []);
    const allMemoriesRef = useRef(options?.allMemories ?? []);
    const allExtensionsRef = useRef(options?.allExtensions ?? []);
    const allAccountsRef = useRef(options?.allAccounts ?? []);
    const allMultiplayerDataRef = useRef(options?.allMultiplayerData ?? []);
    const allRawInteractionDataShellsRef = useRef(options?.allRawInteractionDataShells ?? []);
    const allEntityFoldersRef = useRef(options?.allEntityFolders ?? []);
    const allActionsRef = useRef(options?.allActions ?? []);

    useEffect(() => { onMessageBroadcastRef.current = options?.onMessageBroadcast; }, [options?.onMessageBroadcast]);
    useEffect(() => { onStateBroadcastRef.current = options?.onStateBroadcast; }, [options?.onStateBroadcast]);
    useEffect(() => { requestPeerInferenceRef.current = options?.requestPeerInference; }, [options?.requestPeerInference]);
    useEffect(() => { joinProtagonistRef.current = options?.joinProtagonist ?? null; }, [options?.joinProtagonist]);
    useEffect(() => { allCharactersRef.current = options?.allCharacters ?? []; }, [options?.allCharacters]);
    useEffect(() => { allContextsRef.current = options?.allContexts ?? []; }, [options?.allContexts]);
    useEffect(() => { allLocationsRef.current = options?.allLocations ?? []; }, [options?.allLocations]);
    useEffect(() => { allAudioTracksRef.current = options?.allAudioTracks ?? []; }, [options?.allAudioTracks]);
    useEffect(() => { allPromptBlocksRef.current = options?.allPromptBlocks ?? []; }, [options?.allPromptBlocks]);
    useEffect(() => { allLanguageModelsRef.current = options?.allLanguageModels ?? []; }, [options?.allLanguageModels]);
    useEffect(() => { allSamplersRef.current = options?.allSamplers ?? []; }, [options?.allSamplers]);
    useEffect(() => { allStopPatternsRef.current = options?.allStopPatterns ?? []; }, [options?.allStopPatterns]);
    useEffect(() => { allRetrievalConfigurationsRef.current = options?.allRetrievalConfigurations ?? []; }, [options?.allRetrievalConfigurations]);
    useEffect(() => { allBudgetStrategiesRef.current = options?.allBudgetStrategies ?? []; }, [options?.allBudgetStrategies]);
    useEffect(() => { allProfilesRef.current = options?.allProfiles ?? []; }, [options?.allProfiles]);
    useEffect(() => { allWorldsRef.current = options?.allWorlds ?? []; }, [options?.allWorlds]);
    useEffect(() => { allMemoriesRef.current = options?.allMemories ?? []; }, [options?.allMemories]);
    useEffect(() => { allExtensionsRef.current = options?.allExtensions ?? []; }, [options?.allExtensions]);
    useEffect(() => { allAccountsRef.current = options?.allAccounts ?? []; }, [options?.allAccounts]);
    useEffect(() => { allMultiplayerDataRef.current = options?.allMultiplayerData ?? []; }, [options?.allMultiplayerData]);
    useEffect(() => { allRawInteractionDataShellsRef.current = options?.allRawInteractionDataShells ?? []; }, [options?.allRawInteractionDataShells]);
    useEffect(() => { allEntityFoldersRef.current = options?.allEntityFolders ?? []; }, [options?.allEntityFolders]);
    useEffect(() => { allActionsRef.current = options?.allActions ?? []; }, [options?.allActions]);

    // Domain & Config (useChatStore)
    const interactionData = useChatStore(s => s.interactionData);
    const localProtagonist = useChatStore(s => s.localProtagonist);
    const activeStrategy = useChatStore(s => s.activeStrategy);
    const selectedModel = useChatStore(s => s.selectedModel);
    const runningModels = useChatStore(s => s.runningModels);
    const budgetData = useChatStore(s => s.budgetData);
    const selectedModelId = useChatStore(s => s.selectedModelId);

    // Ephemeral Streaming State (useGenerationStore)
    const isLoading = useGenerationStore(s => s.isLoading);
    const currentCharacterExpression = useGenerationStore(s => s.currentCharacterExpression);
    const streamingCharacter = useGenerationStore(s => s.streamingCharacter);

    // Actions
    const setInteractionData = useChatStore(s => s.setInteractionData);
    const setStreamingState = useGenerationStore(s => s.setStreamingState);
    const setStats = useGenerationStore(s => s.setStats);
    const setSelectedCharacterExpression = useGenerationStore(s => s.setSelectedCharacterExpression);
    const setLastSelectedModelId = useChatStore(s => s.setLastSelectedModelId);
    const setActiveStrategy = useChatStore(s => s.setActiveStrategy);
    const setSelectedModel = useChatStore(s => s.setSelectedModel);
    const setSelectedCharacter = useChatStore(s => s.setLocalProtagonist);
    const setBudgetData = useChatStore(s => s.setBudgetData);
    const updateRunningModels = useChatStore(s => s.updateRunningModels);
    const setNumberOfTokens = useChatStore(s => s.setNumberOfTokens);

    const getState = useChatStore.getState;
    const setState = useChatStore.setState;

    const autonomousMode = interactionData?.profile?.autonomousMode ?? false;
    const isAtBottomRef = useRef(true);

    // ─── Sub-Hooks Initialization ────────────────────────────────────
    const ui = useChatUI(interactionData, isAtBottomRef, options.allCharacters);
    const { throttledSetStreamingText, setStreamingText, streamingTextRef, resetStream } = useThrottledStream();
    const { acquireLock, releaseLock, isLoadingRef } = useCharacterResponseLock();
    const { generateAmbientNarration } = useAmbientNarration(setStreamingState, setStreamingText, streamingTextRef);
    const { captureFrontCameraImage } = useFrontCamera(addToast);

    const { throttledSetStreamingTextWithBroadcast, isSpeculatingRef } = useSpeculativeStreamHandler({
        throttledSetStreamingText, streamingTextRef, streamingCharacterRef: useRef(null), streamingMessageIdRef: useRef(null),
        abortControllerRef: useRef(null), resumeGenerationRef: useRef(null), onMessageBroadcastRef, getState, setInteractionData,
    });

    const getActivePromptBlocks = useCallback((data: InteractionData | null | undefined): PromptBlock[] => {
        const profile = data?.profile;
        return profile?.inputStrategy 
            ? allPromptBlocksRef.current.filter(pb => profile.inputStrategy.includes(pb.id))
            : allPromptBlocksRef.current;
    }, []);

    const buildToolContext = useCallback((): ToolExecutionContext => ({
        allCharacters: allCharactersRef.current, allContexts: allContextsRef.current, allLocations: allLocationsRef.current,
        allAudioTracks: allAudioTracksRef.current, allPromptBlocks: allPromptBlocksRef.current, allLanguageModels: allLanguageModelsRef.current,
        allSamplers: allSamplersRef.current, allStopPatterns: allStopPatternsRef.current, allRetrievalConfigurations: allRetrievalConfigurationsRef.current,
        allBudgetStrategies: allBudgetStrategiesRef.current, allProfiles: allProfilesRef.current, allWorlds: allWorldsRef.current,
        allMemories: allMemoriesRef.current, allAccounts: allAccountsRef.current, allMultiplayerData: allMultiplayerDataRef.current,
        allRawInteractionDataShells: allRawInteractionDataShellsRef.current, allExtensions: allExtensionsRef.current,
        allEntityFolders: allEntityFoldersRef.current, captureFrontCameraImage, addToast,
    }), [captureFrontCameraImage, addToast]);

    const isModelReadyForGeneration = useCallback((): boolean => {
        const m = getState().selectedModel;
        if (!m) return false;
        if (m.apiKey || m.id?.startsWith('borrowed-')) return true;
        const models = getState().runningModels;
        return !!(m.id && models[m.id]?.port);
    }, [getState]);

    // ─── Core Engine & Effects ─────────────────────────────────────
    const chatEngine = useChatEngine({
        getState, setInteractionData, setStreamingState, setBudgetData, setStats, setSelectedCharacterExpression,
        setLastSelectedModelId, addToast, requestBorrowedModel, getToolContext: buildToolContext, acquireLock, releaseLock,
    });

    useChatSessionEffects({
        interactionData, selectedModel, autonomousMode, isMultiplayerClient, requestPeerInferenceRef, isLoadingRef,
        abortControllerRef: useRef(null), setBudgetData, updateRunningModels, setNumberOfTokens, getState, setState, resetStream, chatEngine, addToast,
    });

    // ─── Pipeline Initialization ───────────────────────────────────
    const pipeline = useChatPipeline({
        isMultiplayerClient, chatEngine, acquireLock, releaseLock, isLoadingRef, throttledSetStreamingTextWithBroadcast,
        isSpeculatingRef, setStreamingText, streamingTextRef, resetStream, setStreamingState, setStats, setInteractionData,
        generateAmbientNarration, addToast, onMessageBroadcastRef, onStateBroadcastRef, allCharactersRef, getActivePromptBlocks,
        isModelReadyForGeneration, isAtBottomRef
    });

    // ─── Sender Initialization ─────────────────────────────────────
    const { sendMessage, sendActionAndGetResponse } = useChatSender({
        isMultiplayerClient, joinProtagonistRef, allCharactersRef, allActionsRef, onMessageBroadcastRef, onStateBroadcastRef,
        buildToolContext, executeTurnPipeline: pipeline.executeTurnPipeline, acquireLock, releaseLock, addToast, setInteractionData, getState,
    });

    return {
        interactionData, localProtagonist, activeStrategy, selectedModel, runningModels, budgetData, selectedModelId,
        isLoading, currentCharacterExpression, streamingCharacter,
        setInteractionData, setSelectedCharacter, setActiveBudgetStrategy: setActiveStrategy,
        setSelectedGlobalModel: setSelectedModel, updateRunningModels,
        ...ui,
        sendMessage,
        stopGeneration: pipeline.stopGeneration,
        resumeGeneration: pipeline.resumeGeneration,
        regenerateFromMessage: pipeline.regenerateFromMessage,
        startNewChat: pipeline.startNewChat,
        sendActionAndGetResponse,
        triggerHostResponse: pipeline.triggerHostResponse,
    };
}