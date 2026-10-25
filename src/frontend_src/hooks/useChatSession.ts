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

import type {
    Character, PromptBlock, Profile, InteractionData, Context, Location, AudioTrack,
    Sampler, StopPattern, RetrievalConfiguration, BudgetStrategy, World, Memory, Account,
    MultiplayerData, EntityFolder, RawInteractionData, HistoryMessage, LanguageModel, InterjectableAction
} from '../types';

interface UseChatSessionOptions {
    onMessageBroadcast: (message: HistoryMessage) => void;
    onStateBroadcast: (state: Partial<InteractionData>) => void;
    isMultiplayerClient: boolean;
    joinProtagonist: Character | null; // <--- FIX
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
    allRawInteractionDataShells: RawInteractionData[];
    allEntityFolders: EntityFolder[];
    allActions: InterjectableAction[];
}

export function useChatSession(options: UseChatSessionOptions) {
    const { addToast } = useToast();
    const { captureFrontCameraImage } = useFrontCamera(addToast);

    useEffect(() => {
        chatCoordinator.setDependencies({
            isMultiplayerClient: options.isMultiplayerClient,
            joinProtagonist: options.joinProtagonist, // <--- FIX
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
            allRawInteractionDataShells: options.allRawInteractionDataShells,
            allEntityFolders: options.allEntityFolders,
            allActions: options.allActions,
            addToast,
            captureFrontCameraImage,
            onMessageBroadcast: options.onMessageBroadcast,
            onStateBroadcast: options.onStateBroadcast,
        });
    }, [options, addToast, captureFrontCameraImage]);

    useEffect(() => {
        if (options.isMultiplayerClient) return;
        const unsubscribe = MultiplayerEvents.on('peerMessageReceived', () => { 
            chatCoordinator.triggerHostResponse(); 
        });
        return unsubscribe;
    }, [options.isMultiplayerClient]);

    const interactionData = useChatStore(s => s.interactionData);
    const localProtagonist = useChatStore(s => s.localProtagonist);
    const activeStrategy = useChatStore(s => s.activeStrategy);
    const selectedModel = useChatStore(s => s.selectedModel);
    const runningModels = useChatStore(s => s.runningModels);
    const budgetData = useChatStore(s => s.budgetData);
    const selectedModelId = useChatStore(s => s.selectedModelId);

    const isLoading = useGenerationStore(s => s.isLoading);
    const currentCharacterExpression = useGenerationStore(s => s.currentCharacterExpression);
    const streamingCharacter = useGenerationStore(s => s.streamingCharacter);

    const setInteractionData = useChatStore(s => s.setInteractionData);
    const setSelectedCharacter = useChatStore(s => s.setLocalProtagonist);
    const setActiveBudgetStrategy = useChatStore(s => s.setActiveStrategy);
    const setSelectedGlobalModel = useChatStore(s => s.setSelectedModel);
    const updateRunningModels = useChatStore(s => s.updateRunningModels);

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
        interactionData, localProtagonist, activeStrategy, selectedModel, 
        runningModels, budgetData, selectedModelId, isLoading, 
        currentCharacterExpression, streamingCharacter,
        
        setInteractionData, setSelectedCharacter, setActiveBudgetStrategy,
        setSelectedGlobalModel, updateRunningModels,
        ...ui,

        sendMessage: (text: string, files?: File[], frontCameraImageBase64?: string) => chatCoordinator.sendMessage(text, files, frontCameraImageBase64),
        sendActionAndGetResponse: (text: string, targetChar: Character) => chatCoordinator.sendDirectedAction(text, targetChar, localProtagonist!),
        stopGeneration: () => chatCoordinator.stopGeneration(),
        resumeGeneration: (id: string) => chatCoordinator.resumeGeneration(id),
        // FIX: Match array parameter signature provided by App.tsx
        regenerateFromMessage: (id: string, protagonistIds?: string[]) => chatCoordinator.regenerateFromMessage(id, protagonistIds || [localProtagonist!.id]),
        startNewChat,
    };
}