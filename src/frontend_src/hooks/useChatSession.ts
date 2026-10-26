// src/frontend_src/hooks/useChatSession.ts
import { useEffect, useCallback, useRef } from 'react';
import { useChatStore } from './useChatStore';
import { useGenerationStore } from './useGenerationStore';
import { useChatUI } from './useChatUI';
import { useToast } from '../context/ToastContext';
import { useFrontCamera } from './useFrontCamera';
import { chatCoordinator } from '../services/ChatSessionCoordinator';
import { MultiplayerEvents } from '../services/MultiplayerEvents';
import { createNewInteractionData } from '../utilities/interactionDataLogic';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getBudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { loadRawBudgetData } from '../storages/serverStorage';
import { getGlobalMessageHistory } from '../utilities/timelineLogic';
import { hasTextContent } from '../utilities/chatSessionLogic';
import { localURL } from '../../configurations';

import type {
    Character, PromptBlock, Profile, InteractionData, Context, Location, AudioTrack,
    Sampler, StopPattern, RetrievalConfiguration, BudgetStrategy, World, Memory, Account,
    MultiplayerData, EntityFolder, RawInteractionData, HistoryMessage, LanguageModel, InterjectableAction
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
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    allRawInteractionDataShells?: RawInteractionData[];
    allEntityFolders?: EntityFolder[];
    allExtensions: any[];
    allActions: InterjectableAction[];
    requestBorrowedModel?: () => Promise<LanguageModel | null>;
    requestPeerInference?: (peerAccountId: string, modelName: string, promptOrMessages: any, onToken: (token: string) => void, signal?: AbortSignal) => Promise<void>;
}

export function useChatSession(options: UseChatSessionOptions) {
    const { addToast } = useToast();
    const { captureFrontCameraImage } = useFrontCamera(addToast);
    const lmEngine = getLanguageModelEngine();

    // ─── 1. Bind Dependencies to Headless Coordinator ───
    useEffect(() => {
        chatCoordinator.setDependencies({
            isMultiplayerClient: options.isMultiplayerClient,
            joinProtagonist: options.joinProtagonist,
            allCharacters: options.allCharacters,
            allContexts: options.allContexts,
            allLocations: options.allLocations,
            allAudioTracks: options.allAudioTracks,
            allWorlds: options.allWorlds,
            allLanguageModels: options.allLanguageModels,
            allSamplers: options.allSamplers,
            allPromptBlocks: options.allPromptBlocks,
            allStopPatterns: options.allStopPatterns,
            allRetrievalConfigurations: options.allRetrievalConfigurations,
            allBudgetStrategies: options.allBudgetStrategies,
            allProfiles: options.allProfiles,
            allMemories: options.allMemories,
            allAccounts: options.allAccounts,
            allMultiplayerData: options.allMultiplayerData,
            allRawInteractionDataShells: options.allRawInteractionDataShells ?? [],
            allEntityFolders: options.allEntityFolders ?? [],
            allActions: options.allActions,
            requestBorrowedModel: options.requestBorrowedModel,
            requestPeerInference: options.requestPeerInference,
            addToast,
            captureFrontCameraImage,
            onMessageBroadcast: options.onMessageBroadcast,
            onStateBroadcast: options.onStateBroadcast,
        });
        chatCoordinator.setupPeerInference();
    }, [options, addToast, captureFrontCameraImage]);

    // ─── 2. Multiplayer Events ───
    useEffect(() => {
        if (options.isMultiplayerClient) return;
        const unsubscribe = MultiplayerEvents.on('peerMessageReceived', () => { 
            chatCoordinator.triggerHostResponse(); 
        });
        return unsubscribe;
    }, [options.isMultiplayerClient]);

    // ─── 3. Background Effects (Budget, Polling, Tokens, FM Unload) ───
    const interactionData = useChatStore(s => s.interactionData);
    const selectedLanguageModel = useChatStore(s => s.selectedLanguageModel);
    const setBudgetData = useChatStore(s => s.setBudgetData);
    const updateRunningModels = useChatStore(s => s.updateRunningModels);
    const setNumberOfTokens = useChatStore(s => s.setNumberOfTokens);

    // Budget Data Hydration
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const bd = await loadRawBudgetData();
                if (!cancelled && bd) setBudgetData(bd);
            } catch (e) {
                console.warn('Failed to load budget data:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [setBudgetData]);

    // Model Status Polling
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch(`${localURL}/language_models/status`);
                if (!response.ok || cancelled) return;
                const data = await response.json();
                const status: Record<string, { isRunning: boolean; port?: number }> = {};
                for (const m of data.activeModels || []) status[m.id] = { isRunning: true, port: m.port };
                if (!cancelled) updateRunningModels(status);
            } catch (e) {
                if (!cancelled) addToast(`Failed to fetch models status: ${e}`, 'error');
            }
        })();
        return () => { cancelled = true; };
    }, [updateRunningModels, addToast]);

    // Model Context Syncing
    useEffect(() => {
        if (selectedLanguageModel) lmEngine.setContext(selectedLanguageModel);
    }, [selectedLanguageModel, lmEngine]);

    // Context Token Accounting
    useEffect(() => {
        if (!interactionData) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            const history = getGlobalMessageHistory(interactionData);
            const fullText = history.filter(hasTextContent).map(m => m.textContent).join('\n\n');
            if (!fullText) {
                if (!cancelled) setNumberOfTokens(0);
                return;
            }
            const total = await lmEngine.countTokens(fullText);
            if (!cancelled) setNumberOfTokens(total);
        }, 300);

        return () => { cancelled = true; clearTimeout(timer); };
    }, [interactionData, setNumberOfTokens, lmEngine]);

    // Persist Factorization Machine Weights on Window Unload
    useEffect(() => {
        const handleBeforeUnload = () => {
            try {
                getBudgetStrategyEngine().persistFMs().catch(() => {});
            } catch { /* engine not initialized */ }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // ─── 4. State Subscriptions & UI Bindings ───
    const localProtagonist = useChatStore(s => s.localProtagonist);
    const activeStrategy = useChatStore(s => s.activeStrategy);
    const runningLanguageModels = useChatStore(s => s.runningLanguageModels);
    const budgetData = useChatStore(s => s.budgetData);
    const selectedModelId = useChatStore(s => s.selectedModelId);

    const isLoading = useGenerationStore(s => s.isLoading);
    const currentCharacterExpression = useGenerationStore(s => s.currentCharacterExpression);
    const streamingCharacter = useGenerationStore(s => s.streamingCharacter);

    const setInteractionData = useChatStore(s => s.setInteractionData);
    const setSelectedCharacter = useChatStore(s => s.setLocalProtagonist);
    const setActiveBudgetStrategy = useChatStore(s => s.setActiveStrategy);
    const setSelectedGlobalModel = useChatStore(s => s.setSelectedModel);

    const isAtBottomRef = useRef(true);
    const ui = useChatUI(interactionData, isAtBottomRef, options.allCharacters);

    const startNewChat = useCallback((char: Character) => {
        chatCoordinator.stopGeneration();
        const newSession = createNewInteractionData(char);
        newSession.name = 'Untitled Session';
        setInteractionData(newSession);
        setSelectedCharacter(char);
        isAtBottomRef.current = true;
        speculativeMarkovEngine.clearSession(newSession.id);
    }, [setInteractionData, setSelectedCharacter]);

    return {
        interactionData, localProtagonist, activeStrategy, selectedLanguageModel, 
        runningLanguageModels, budgetData, selectedModelId, isLoading, 
        currentCharacterExpression, streamingCharacter,
        
        setInteractionData, setSelectedCharacter, setActiveBudgetStrategy,
        setSelectedGlobalModel, updateRunningModels,
        ...ui,

        sendMessage: (text: string, files?: File[], frontCameraImageBase64?: string) => chatCoordinator.sendMessage(text, files, frontCameraImageBase64),
        sendActionAndGetResponse: (text: string, targetChar: Character) => chatCoordinator.sendDirectedAction(text, targetChar, localProtagonist!),
        stopGeneration: () => chatCoordinator.stopGeneration(),
        skipThinking: () => chatCoordinator.skipThinking(),
        resumeGeneration: (id: string) => chatCoordinator.resumeGeneration(id),
        regenerateFromMessage: (id: string, protagonistIds?: string[]) => chatCoordinator.regenerateFromMessage(id, protagonistIds || [localProtagonist!.id]),
        startNewChat,
    };
}