// src/hooks/useChatSession.ts
import { useRef, useCallback, useEffect } from 'react';
import { useChatState } from './useChatState';
import { useChatEngine } from './useChatEngine';
import { useChatUI } from './useChatUI';
import { useToast } from '../context/ToastContext';
import { createChatMessage, convertIdsToDisplayNames, createNewInteractionData } from '../utilities/chatLogic';
import { processPendingToolActions, executeTool, type ToolExecutionContext } from '../services/ToolExecutor';
import { parseSlashCommand } from '../services/ToolInvocationParser';
import { runSummarization } from '../services/SummarizationEngine';
import { consumeChatStaminaForMessage } from '../utilities/characterLogic';
import { getCurrentLocationId, findReachableLocationByRegularExpression } from '../utilities/locationLogic';
import { detectName } from '../utilities/nameDetection';
import { getFilteredChatMessages } from '../utilities/promptLogic';
import { deleteRawMessage } from '../storages/serverStorage';
import { useThrottledStream } from './useThrottledStream';
import { useCharacterResponseLock } from './useCharacterResponseLock';
import { useAmbientNarration } from './useAmbientNarration';
import { useSessionStore } from './useSessionStore';
import { type RequestMetadata } from '../services/BudgetStrategyEngine';
import { learnFromUserMessage } from '../services/ActionFormatEngine';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { MultiplayerEvents } from '../services/MultiplayerEvents';
import { getGlobalMessageHistory, getLocalMessageHistory } from '../utilities/timelineLogic';
import {
    computeModulatedRegenAmounts,
    computeChatStaminaConsumptionCost,
    computeMovementCost
} from '../utilities/dynamicCharacterLogic';
import {
    generateChatStaminaForInteractionData,
    generateActionStaminaForInteractionData
} from '../utilities/characterLogic';
import { v4 as uuidv4 } from 'uuid';

import {
    NO_ARG_TOOLS,
    HOST_ONLY_TOOLS,
    hasTextContent,
    finalizeMessageById,
    findLastAIMessageId,
    broadcastToolStateChanges,
    evaluateAutoResumeSignals,
    injectStopSignals,
    type GenerationTurnOptions,
} from '../utilities/chatSessionLogic';
import { useSpeculativeStreamHandler } from './useSpeculativeStreamHandler';
import { useChatSessionEffects } from './useChatSessionEffects';

import type {
    Character, Context, Location, AudioTrack, World,
    PromptBlock, Sampler, StopPattern, BudgetStrategy,
    Profile, InteractionData, ChatMessage, WhisperMessage,
    HistoryMessage, Memory, Extension, Account,
    MultiplayerData, LanguageModel, InterjectableAction
} from '../types';
import { useFrontCamera } from './useFrontCamera';

interface UseChatSessionOptions {
    onMessageBroadcast?: (message: HistoryMessage) => void;
    onStateBroadcast?: (state: Partial<InteractionData>) => void;
    isMultiplayerClient?: boolean;
    joinProtagonist?: Character | null;
    allCharacters?: Character[];
    allContexts?: Context[];
    allLocations?: Location[];
    allAudioTracks?: AudioTrack[];
    allPromptBlocks?: PromptBlock[];
    allSamplers?: Sampler[];
    allStopPatterns?: StopPattern[];
    allBudgetStrategies?: BudgetStrategy[];
    allProfiles?: Profile[];
    allWorlds?: World[];
    allMemories?: Memory[];
    allExtensions?: Extension[];
    allAccounts?: Account[];
    allMultiplayerData?: MultiplayerData[];
    allActions?: InterjectableAction[];
    requestBorrowedModel?: () => Promise<LanguageModel | null>;
    requestPeerInference?: (peerAccountId: string, modelName: string, promptOrMessages: any, onToken: (token: string) => void, signal?: AbortSignal) => Promise<void>;
}

export function useChatSession(options: UseChatSessionOptions) {
    const { addToast } = useToast();
    const onMessageBroadcastRef = useRef(options?.onMessageBroadcast);
    const onStateBroadcastRef = useRef(options?.onStateBroadcast);
    const isMultiplayerClient = options?.isMultiplayerClient ?? false;
    const requestBorrowedModel = options?.requestBorrowedModel;

    const requestPeerInferenceRef = useRef(options?.requestPeerInference);
    useEffect(() => { requestPeerInferenceRef.current = options?.requestPeerInference; }, [options?.requestPeerInference]);
    useEffect(() => { onMessageBroadcastRef.current = options?.onMessageBroadcast; }, [options?.onMessageBroadcast]);
    useEffect(() => { onStateBroadcastRef.current = options?.onStateBroadcast; }, [options?.onStateBroadcast]);

    const joinProtagonistRef = useRef(options?.joinProtagonist ?? null);
    useEffect(() => { joinProtagonistRef.current = options?.joinProtagonist ?? null; }, [options?.joinProtagonist]);

    const allCharactersRef = useRef(options?.allCharacters ?? []);
    const allContextsRef = useRef(options?.allContexts ?? []);
    const allLocationsRef = useRef(options?.allLocations ?? []);
    const allAudioTracksRef = useRef(options?.allAudioTracks ?? []);
    const allPromptBlocksRef = useRef(options?.allPromptBlocks ?? []);
    const allSamplersRef = useRef(options?.allSamplers ?? []);
    const allStopPatternsRef = useRef(options?.allStopPatterns ?? []);
    const allBudgetStrategiesRef = useRef(options?.allBudgetStrategies ?? []);
    const allProfilesRef = useRef(options?.allProfiles ?? []);
    const allWorldsRef = useRef(options?.allWorlds ?? []);
    const allMemoriesRef = useRef(options?.allMemories ?? []);
    const allExtensionsRef = useRef(options?.allExtensions ?? []);
    const allAccountsRef = useRef(options?.allAccounts ?? []);
    const allMultiplayerDataRef = useRef(options?.allMultiplayerData ?? []);
    const allActionsRef = useRef(options?.allActions ?? []);

    useEffect(() => { allCharactersRef.current = options?.allCharacters ?? []; }, [options?.allCharacters]);
    useEffect(() => { allContextsRef.current = options?.allContexts ?? []; }, [options?.allContexts]);
    useEffect(() => { allLocationsRef.current = options?.allLocations ?? []; }, [options?.allLocations]);
    useEffect(() => { allAudioTracksRef.current = options?.allAudioTracks ?? []; }, [options?.allAudioTracks]);
    useEffect(() => { allPromptBlocksRef.current = options?.allPromptBlocks ?? []; }, [options?.allPromptBlocks]);
    useEffect(() => { allSamplersRef.current = options?.allSamplers ?? []; }, [options?.allSamplers]);
    useEffect(() => { allStopPatternsRef.current = options?.allStopPatterns ?? []; }, [options?.allStopPatterns]);
    useEffect(() => { allBudgetStrategiesRef.current = options?.allBudgetStrategies ?? []; }, [options?.allBudgetStrategies]);
    useEffect(() => { allProfilesRef.current = options?.allProfiles ?? []; }, [options?.allProfiles]);
    useEffect(() => { allWorldsRef.current = options?.allWorlds ?? []; }, [options?.allWorlds]);
    useEffect(() => { allMemoriesRef.current = options?.allMemories ?? []; }, [options?.allMemories]);
    useEffect(() => { allExtensionsRef.current = options?.allExtensions ?? []; }, [options?.allExtensions]);
    useEffect(() => { allAccountsRef.current = options?.allAccounts ?? []; }, [options?.allAccounts]);
    useEffect(() => { allMultiplayerDataRef.current = options?.allMultiplayerData ?? []; }, [options?.allMultiplayerData]);
    useEffect(() => { allActionsRef.current = options?.allActions ?? []; }, [options?.allActions]);

    const state = useChatState();
    const {
        setBudgetData, updateRunningModels, setNumberOfTokens,
        setInteractionData, setStreamingState, setStats,
        setSelectedCharacterExpression, setLastSelectedModelId,
        getState, setState, setActiveStrategy, setSelectedModel, setSelectedCharacter,
    } = state;

    const interactionData = useSessionStore((s: { interactionData: any }) => s.interactionData);
    const selectedModel = useSessionStore((s: { selectedModel: any }) => s.selectedModel);
    const autonomousMode = interactionData?.profile?.autonomousMode ?? false;

    const abortControllerRef = useRef<AbortController | null>(null);
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);
    const resumingMessageIdRef = useRef<string | null>(null);
    const resumingExistingTextRef = useRef<string>('');
    const isAtBottomRef = useRef(true);
    const wasStoppedRef = useRef(false);
    const autoResumeCountRef = useRef<number>(0);

    const resumeGenerationRef = useRef<((messageId: string, allPromptBlocks?: PromptBlock[]) => Promise<void>) | null>(null);
    const streamingMessageIdRef = useRef<string | null>(null);
    const streamingCharacterRef = useRef<Character | null>(null);

    const pendingHostResponseRef = useRef(false);
    const triggerHostResponseRef = useRef<(() => Promise<void>) | null>(null);
    const pendingResumeRef = useRef<{ messageId: string; allPromptBlocks?: PromptBlock[] } | null>(null);

    const lastTurnContextRef = useRef<{ modelId: string; prompt: string; metadata: RequestMetadata } | null>(null);
    const requestTimestampsRef = useRef<number[]>([]);

    const getRequestsLastHour = useCallback(() => {
        const now = Date.now();
        const cutoff = now - 60 * 60 * 1000;
        requestTimestampsRef.current = requestTimestampsRef.current.filter(t => t > cutoff);
        return requestTimestampsRef.current.length;
    }, []);

    const ui = useChatUI(state.interactionData, isAtBottomRef);

    const { throttledSetStreamingText, setStreamingText, streamingTextRef, resetStream } = useThrottledStream();
    const { acquireLock, releaseLock, isLoadingRef } = useCharacterResponseLock();
    const { generateAmbientNarration } = useAmbientNarration(setStreamingState, setStreamingText, streamingTextRef);

    const { throttledSetStreamingTextWithBroadcast, isSpeculatingRef } = useSpeculativeStreamHandler({
        throttledSetStreamingText,
        streamingTextRef,
        streamingCharacterRef,
        streamingMessageIdRef,
        abortControllerRef,
        resumeGenerationRef,
        onMessageBroadcastRef,
        getState,
        setInteractionData,
    });

    const { captureFrontCameraImage } = useFrontCamera(addToast);

    const buildToolContext = useCallback((): ToolExecutionContext => ({
        allCharacters: allCharactersRef.current,
        allContexts: allContextsRef.current,
        allLocations: allLocationsRef.current,
        allAudioTracks: allAudioTracksRef.current,
        allPromptBlocks: allPromptBlocksRef.current,
        allSamplers: allSamplersRef.current,
        allStopPatterns: allStopPatternsRef.current,
        allBudgetStrategies: allBudgetStrategiesRef.current,
        allProfiles: allProfilesRef.current,
        allWorlds: allWorldsRef.current,
        allMemories: allMemoriesRef.current,
        allAccounts: allAccountsRef.current,
        allMultiplayerData: allMultiplayerDataRef.current,
        allExtensions: allExtensionsRef.current,
        captureFrontCameraImage,
        addToast,
    }), [captureFrontCameraImage, addToast]);

    const chatEngine = useChatEngine({
        getState,
        setInteractionData,
        setStreamingState,
        setBudgetData,
        setStats,
        setSelectedCharacterExpression,
        setLastSelectedModelId,
        addToast,
        requestBorrowedModel,
        getToolContext: buildToolContext,
    });

    useChatSessionEffects({
        interactionData,
        selectedModel,
        autonomousMode,
        isMultiplayerClient,
        requestPeerInferenceRef,
        isLoadingRef,
        abortControllerRef,
        setBudgetData,
        updateRunningModels,
        setNumberOfTokens,
        getState,
        setState,
        resetStream,
        chatEngine,
        addToast,
    });

    const isModelReadyForGeneration = useCallback((): boolean => {
        const m = getState().selectedModel;
        if (!m) return false;
        if (m.apiKey || m.id?.startsWith('borrowed-')) return true;
        const models = getState().runningModels;
        return !!(m.id && models[m.id]?.port);
    }, [getState]);

    const applyPendingPartial = useCallback(async (base: InteractionData, protagonistId: string): Promise<InteractionData> => {
        const p = pendingPartialRef.current;
        if (!p) return base;
        pendingPartialRef.current = null;

        const dt = convertIdsToDisplayNames(p.text, base, p.character);
        const history = getGlobalMessageHistory(base);

        const allProtagonistIds = new Set(base.protagonists?.map(pr => pr.id) ?? [protagonistId]);
        if (history.length > 0 && !allProtagonistIds.has(history[history.length - 1].character.id)) {
            const lastMsg = history[history.length - 1];
            if (hasTextContent(lastMsg)) {
                const newHistories = { ...base.interactionHistories };
                for (const [locId, msgs] of Object.entries(newHistories) as [string, HistoryMessage[]][]) {
                    const idx = msgs.findIndex(m => m.id === lastMsg.id);
                    if (idx !== -1) {
                        newHistories[locId] = [...msgs];
                        newHistories[locId][idx] = {
                            ...lastMsg,
                            textContent: dt,
                            processedTextContent: dt !== lastMsg.textContent ? dt : undefined
                        } as ChatMessage | WhisperMessage;
                        break;
                    }
                }
                return { ...base, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
            }
        }

        const currentLocId = getCurrentLocationId(base, p.character) || 'global';
        const newHistories = { ...base.interactionHistories };
        if (!newHistories[currentLocId]) newHistories[currentLocId] = [];

        const chatMessage = createChatMessage(base, p.character, dt);
        chatMessage.processedTextContent = dt;
        newHistories[currentLocId].push(chatMessage);

        return { ...base, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
    }, []);

    const autoResumeOnCutoff = useCallback((data: InteractionData, protagonistId: string, allPromptBlocks?: PromptBlock[]) => {
        const allProtagonistIds = new Set(data.protagonists?.map(p => p.id) ?? [protagonistId]);
        const messageId = findLastAIMessageId(data, allProtagonistIds);
        if (!messageId) return;

        setTimeout(() => {
            resumeGenerationRef.current?.(messageId, allPromptBlocks);
        }, 0);
    }, []);

    const broadcastNewMessages = useCallback((beforeCount: number, afterData: InteractionData) => {
        if (!onMessageBroadcastRef.current) return;
        const history = getGlobalMessageHistory(afterData);
        const newMessages = history.slice(beforeCount);
        for (const msg of newMessages) {
            onMessageBroadcastRef.current(msg);
        }
    }, []);

    const formatDelay = (ms: number): string => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const parts: string[] = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
        return parts.join(' ');
    };

    const triggerDelayedResponseRef = useRef<(characterId: string, thought?: string) => Promise<void>>(null);

    const extractAndScheduleResponses = useCallback((data: InteractionData) => {
        const history = getGlobalMessageHistory(data);
        const protagonistIds = new Set(data.protagonists?.map(p => p.id) ?? []);
        
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (hasTextContent(msg) && !protagonistIds.has(msg.character.id)) {
                const chatMsg = msg as ChatMessage;
                if (chatMsg.inventory?.__scheduled_responses__) {
                    try {
                        const tasks = JSON.parse(chatMsg.inventory.__scheduled_responses__ as string);
                        for (const task of tasks) {
                            const delay = task.durationMs;
                            const charId = task.characterId;
                            const charName = task.characterName;
                            const thought = task.thought;
                            
                            setTimeout(() => {
                                triggerDelayedResponseRef.current?.(charId, thought);
                            }, delay);
                            
                            addToast(`⏰ ${charName} scheduled a follow-up in ${formatDelay(delay)}`, 'info');
                        }
                    } catch (e) {
                        console.warn('Failed to parse scheduled responses', e);
                    }
                    
                    const updatedHistories = { ...data.interactionHistories };
                    for (const [locId, msgs] of Object.entries(updatedHistories) as [string, HistoryMessage[]][]) {
                        const idx = msgs.findIndex(m => m.id === chatMsg.id);
                        if (idx !== -1) {
                            const cleanMsg = { ...msgs[idx] } as ChatMessage;
                            const cleanInv = cleanMsg.inventory ? { ...cleanMsg.inventory } : {};
                            delete cleanInv['__scheduled_responses__'];
                            if (Object.keys(cleanInv).length === 0) delete cleanMsg.inventory;
                            else cleanMsg.inventory = cleanInv;
                            
                            updatedHistories[locId] = [...msgs];
                            updatedHistories[locId][idx] = cleanMsg;
                        }
                    }
                    
                    const cleanedData = { ...data, interactionHistories: updatedHistories };
                    setInteractionData(cleanedData);
                }
                break; 
            }
        }
    }, [addToast, setInteractionData]);

    const executeTurnPipeline = useCallback(async ({
        data,
        protagonistId,
        existingCharacterText = '',
        allPromptBlocks,
        respondingCharacter,
        isProtagonistCharId,
        errorPrefix = 'Generation failed',
        lockAlreadyAcquired = false,
    }: GenerationTurnOptions) => {
        if (!lockAlreadyAcquired && !acquireLock()) return;
        if (!data.profile || !data.profile?.enableCharacterExpression) sentimentEngine.unload();

        const currentState = getState();
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) {
            addToast('Model not ready.', 'error');
            releaseLock();
            return;
        }

        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;
        wasStoppedRef.current = false;
        isSpeculatingRef.current = false;
        autoResumeCountRef.current = 0;
        resetStream();
        setStreamingState(null, '');
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        const preTurnCount = getGlobalMessageHistory(data).length;

        const allProtagonistIds = new Set(data.protagonists?.map(p => p.id) ?? [protagonistId]);
        const isProtagonist = isProtagonistCharId || ((id: string) => allProtagonistIds.has(id));

        const respondingChar = respondingCharacter
            || data.participants.find(p => !isProtagonist(p.id))
            || data.participants[0]
            || currentState.currentCharacter;

        streamingCharacterRef.current = respondingChar ?? null;
        streamingMessageIdRef.current = `gen-${respondingChar?.id || 'ai'}-${Date.now()}`;

        useSessionStore.setState({
            isLoading: true,
            streamingCharacter: respondingChar ?? null,
            streamingText: '',
        });

        try {
            requestTimestampsRef.current.push(Date.now());
            const metadata: RequestMetadata = {
                numberOfMessages: getGlobalMessageHistory(data).length,
                numberOfRequestsDuringTheLastHour: getRequestsLastHour(),
            };

            const interactionDataId = data.id || 'unknown';
            for (const participant of data.participants) {
                const charHistory = getLocalMessageHistory(data, participant, ['chat', 'whisper']) as (ChatMessage | WhisperMessage)[];
                speculativeMarkovEngine.syncMessages(
                    charHistory.map(m => ({ textContent: m.textContent, lastUpdatedTimestamp: m.lastUpdatedTimestamp })),
                    participant.id,
                    interactionDataId
                );
            }

            const turnResult = await chatEngine.runTurn(data, ctrl, allPromptBlocks, metadata, existingCharacterText);
            let ud = turnResult.interactionData;

            // 🛡️ CRITICAL FIX: Force a new reference if the orchestrator returned the exact same object reference.
            // In-place mutations by the CharacterActor/Orchestrator will cause Zustand to ignore the update,
            // preventing useChatAutoSave from firing and leaving AI messages unsaved on disk.
            if (ud === data) {
                ud = { 
                    ...ud, 
                    interactionHistories: { ...ud.interactionHistories }, 
                    lastUpdatedTimestamp: Date.now() 
                };
            }

            if (turnResult.promptText) {
                const currentModelId = useSessionStore.getState().selectedModelId;
                if (currentModelId) {
                    lastTurnContextRef.current = {
                        modelId: currentModelId,
                        prompt: turnResult.promptText,
                        metadata,
                    };
                }
            }

            if (pendingPartialRef.current) {
                const fd = await applyPendingPartial(ud, protagonistId);
                setInteractionData(fd);
                broadcastNewMessages(preTurnCount, fd);
                return;
            }

            if (getGlobalMessageHistory(ud).length <= preTurnCount) {
                const liveText = streamingTextRef.current?.trim();
                if (liveText && respondingChar) {
                    const currentLocId = getCurrentLocationId(ud, respondingChar) || 'global';
                    const fallbackMsg = createChatMessage(ud, respondingChar, liveText);
                    if (streamingMessageIdRef.current) fallbackMsg.id = streamingMessageIdRef.current;
                    fallbackMsg.processedTextContent = liveText;
                    const newHistories = { ...ud.interactionHistories };
                    if (!newHistories[currentLocId]) newHistories[currentLocId] = [];
                    newHistories[currentLocId].push(fallbackMsg);
                    ud = { ...ud, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
                }
            }

            const preToolData = ud;
            ud = processPendingToolActions(ud, allCharactersRef.current, { onToast: addToast });
            broadcastToolStateChanges(preToolData, ud, onStateBroadcastRef.current);

            if (getGlobalMessageHistory(ud).length > preTurnCount) {
                setInteractionData(ud);
                broadcastNewMessages(preTurnCount, ud);

                extractAndScheduleResponses(ud);

                const history = getGlobalMessageHistory(ud);
                const lastMsg = history[history.length - 1];
                const text = hasTextContent(lastMsg) ? lastMsg.textContent : '';

                const evaluation = evaluateAutoResumeSignals(ud.profile, text, autoResumeCountRef.current);

                if (evaluation.shouldResume && !wasStoppedRef.current) {
                    autoResumeCountRef.current += 1;
                    const injectedData = injectStopSignals(ud, evaluation.patternsToInject);
                    setInteractionData(injectedData);
                    autoResumeOnCutoff(injectedData, protagonistId, allPromptBlocks);
                    return;
                }

                runSummarization({
                    data: ud,
                    character: respondingChar,
                    setInteractionData,
                    addToast,
                });

                const lm = getGlobalMessageHistory(ud)[getGlobalMessageHistory(ud).length - 1];
                if (lm && hasTextContent(lm) && !isProtagonist(lm.character.id)) {
                    ui.playVoice(lm.textContent, lm.character);
                }
            } else {
                const enableAmbientNarration = ud?.profile?.enableAmbientNarration ?? false;
                if (enableAmbientNarration) {
                    const ad = await generateAmbientNarration(ud, ctrl.signal);
                    const sd = ad || ud;
                    setInteractionData(sd);
                    broadcastNewMessages(preTurnCount, sd);
                } else {
                    setInteractionData(ud);
                    broadcastNewMessages(preTurnCount, ud);
                }
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error(`${errorPrefix}:`, e);
                addToast(`${errorPrefix}: ${(e as Error).message}`, 'error');
            }
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
            isSpeculatingRef.current = false;
            streamingCharacterRef.current = null;
            streamingMessageIdRef.current = null;

            resetStream();

            useSessionStore.setState({
                isLoading: false,
                streamingCharacter: null,
                streamingText: '',
            });

            releaseLock();

            if (pendingResumeRef.current) {
                const { messageId, allPromptBlocks: blocks } = pendingResumeRef.current;
                pendingResumeRef.current = null;
                setTimeout(() => resumeGenerationRef.current?.(messageId, blocks), 0);
            } else if (pendingHostResponseRef.current && isMultiplayerClient) {
                pendingHostResponseRef.current = false;
                setTimeout(() => triggerHostResponseRef.current?.(), 0);
            } else {
                pendingHostResponseRef.current = false;
            }
        }
    }, [
        acquireLock, getState, isModelReadyForGeneration, addToast, releaseLock,
        resetStream, setStreamingState, setStats, getRequestsLastHour, chatEngine,
        applyPendingPartial, setInteractionData, broadcastNewMessages,
        autoResumeOnCutoff, ui, generateAmbientNarration, isMultiplayerClient, isSpeculatingRef, streamingTextRef, extractAndScheduleResponses
    ]);

    const triggerDelayedResponse = useCallback(async (characterId: string, thought?: string) => {
        const currentState = getState();
        const currentData = currentState.interactionData;
        if (!currentData || isLoadingRef.current) return;
        
        const character = currentData.participants.find(p => p.id === characterId);
        if (!character) return;

        if (!acquireLock()) return;
        
        const prefillText = thought ? `[System Note: You scheduled this follow-up earlier. Your internal thought was: "${thought}". Continue naturally from this premise.]\n\n` : '';

        try {
            await executeTurnPipeline({
                data: currentData,
                protagonistId: currentData.protagonists[0]?.id || '',
                respondingCharacter: character,
                existingCharacterText: prefillText, 
                isProtagonistCharId: (id) => currentData.protagonists.some(p => p.id === id),
                errorPrefix: 'Delayed response failed',
                lockAlreadyAcquired: true,
            });
        } catch (e) {
            console.error('Delayed response error:', e);
        }
    }, [getState, acquireLock, executeTurnPipeline]);

    useEffect(() => {
        triggerDelayedResponseRef.current = triggerDelayedResponse;
    }, [triggerDelayedResponse]);

    const sendMessage = useCallback(async (
        text: string,
        allPromptBlocks: PromptBlock[] | undefined,
        files: File[] | undefined,
        frontCameraImageBase64: string | undefined
    ) => {
        const currentState = getState();
        const activeCharacter = isMultiplayerClient
            ? (joinProtagonistRef.current || currentState.currentCharacter)
            : currentState.currentCharacter;

        if (!currentState.interactionData || !activeCharacter || (!text && (!files || !files.length))) return;

        const slashInvocation = parseSlashCommand(text);
        const isSlashCommand = !!(slashInvocation && !files?.length && !frontCameraImageBase64);

        if (isSlashCommand && slashInvocation) {
            if (isMultiplayerClient && HOST_ONLY_TOOLS.includes(slashInvocation.toolType)) {
                const mpData = useSessionStore.getState().multiplayerData;
                const accountId = useSessionStore.getState().currentAccountId;
                const accountConfig = accountId ? mpData?.multiplayerDataAccountConfigurations[accountId] : undefined;
                const isAdmin = accountConfig?.isAdministrator;

                if (!isAdmin) {
                    addToast(`/${slashInvocation.toolType} requires administrator privileges.`, 'error');
                    return;
                }
            }

            if (!slashInvocation.args && !NO_ARG_TOOLS.includes(slashInvocation.toolType)) {
                addToast(`/${slashInvocation.toolType} requires arguments.`, 'error');
                return;
            }

            if (!acquireLock()) { addToast('Already processing...', 'info'); return; }
            try {
                const slashMessage = createChatMessage(currentState.interactionData, activeCharacter, '', {});
                const toolContext = buildToolContext();
                const toolResult = await executeTool(
                    slashInvocation,
                    slashMessage,
                    currentState.interactionData,
                    toolContext,
                    currentState.interactionData.profile?.toolUsageDisplayMode
                );

                const rawCmd = text;
                const displayResult = toolResult.displayReplacement || toolResult.content || `[${slashInvocation.toolType}]`;

                slashMessage.textContent = rawCmd;
                slashMessage.processedTextContent = displayResult !== rawCmd ? displayResult : undefined;

                const preSlashData = currentState.interactionData;
                const currentLocId = getCurrentLocationId(currentState.interactionData, activeCharacter) || 'global';
                const newHistories = { ...currentState.interactionData.interactionHistories };
                if (!newHistories[currentLocId]) newHistories[currentLocId] = [];
                newHistories[currentLocId].push(slashMessage);

                let updatedData = { ...currentState.interactionData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
                updatedData = processPendingToolActions(updatedData, allCharactersRef.current, { onToast: addToast });

                broadcastToolStateChanges(preSlashData, updatedData, onStateBroadcastRef.current);
                setInteractionData(updatedData);

                if (isMultiplayerClient) {
                    onMessageBroadcastRef.current?.(slashMessage);
                    releaseLock();
                    return;
                }

                await executeTurnPipeline({
                    data: updatedData,
                    protagonistId: activeCharacter.id,
                    allPromptBlocks,
                    errorPrefix: 'Send failed',
                    lockAlreadyAcquired: true,
                });
                return;
            } catch (e) {
                console.error('Slash command failed:', e);
                addToast(`Command failed: ${(e as Error).message}`, 'error');
                releaseLock();
                return;
            }
        }

        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }

        try {
            const currentInteractionData = currentState.interactionData;

            const { chatRegen, actionRegen } = computeModulatedRegenAmounts(activeCharacter, currentInteractionData);
            if (chatRegen > 0) {
                generateChatStaminaForInteractionData(currentInteractionData, chatRegen, activeCharacter);
            }
            if (actionRegen > 0) {
                generateActionStaminaForInteractionData(currentInteractionData, actionRegen, activeCharacter);
            }

            const convertFileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = error => reject(error);
            });
            const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;

            const filteredMessages = getFilteredChatMessages(currentInteractionData, activeCharacter.id, allPromptBlocks || []);
            const knownCharacterNames = detectName(activeCharacter, filteredMessages, text);

            const chatMessage = createChatMessage(currentInteractionData, activeCharacter, text, {
                files: encodedFiles,
                frontCameraImage: frontCameraImageBase64,
                knownCharacterNames
            });

            const paragraphs = (text.match(/\n\n/g) || []).length + 1;
            const chatCost = computeChatStaminaConsumptionCost(activeCharacter, currentInteractionData, paragraphs);
            if (chatCost > 0) {
                consumeChatStaminaForMessage(chatMessage, chatCost);
            }

            const currentLocId = getCurrentLocationId(currentInteractionData, activeCharacter) || 'global';
            const newHistories = { ...currentInteractionData.interactionHistories };
            if (!newHistories[currentLocId]) newHistories[currentLocId] = [];
            newHistories[currentLocId].push(chatMessage);

            let td = { ...currentInteractionData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };

            onMessageBroadcastRef.current?.(chatMessage);

            if (allActionsRef.current.length > 0) {
                let prevWrap: '*' | '()' | 'none' | 'unknown' = 'unknown';
                const localHistory = getLocalMessageHistory(td, activeCharacter);
                for (let i = localHistory.length - 2; i >= 0; i--) {
                    const prevMsg = localHistory[i];
                    if (hasTextContent(prevMsg)) {
                        const prevText = prevMsg.textContent;
                        if (prevText.includes('*')) prevWrap = '*';
                        else if (prevText.includes('(') && prevText.includes(')')) prevWrap = '()';
                        else prevWrap = 'none';
                        break;
                    }
                }
                learnFromUserMessage(text, allActionsRef.current.map(a => a.label), prevWrap);
            }

            const hasLocations = td.locations && td.locations.length > 0;
            if (hasLocations) {
                const currentLocId = getCurrentLocationId(td, activeCharacter);
                const regexLoc = findReachableLocationByRegularExpression(td, chatMessage.textContent, activeCharacter);
                const finalLocId = regexLoc?.id ?? currentLocId;

                if (currentLocId && finalLocId && finalLocId !== currentLocId) {
                    let currentActionStamina = chatMessage.remainingActionStamina;
                    const movementCost = computeMovementCost(currentLocId, finalLocId, td.locations);
                    if (movementCost > 0 && currentActionStamina !== undefined) {
                        currentActionStamina = Math.max(0, currentActionStamina - movementCost);
                    }

                    const arrivalInteraction: HistoryMessage = {
                        messageType: 'interaction',
                        id: uuidv4(),
                        character: { ...activeCharacter },
                        isPresent: true,
                        remainingChatStamina: chatMessage.remainingChatStamina,
                        remainingActionStamina: currentActionStamina,
                        characterClothingWearingStatuses: chatMessage.characterClothingWearingStatuses,
                        characterLockedLocations: chatMessage.characterLockedLocations,
                        parentMessageId: chatMessage.id,
                        firstCreatedTimestamp: chatMessage.firstCreatedTimestamp + 1,
                        lastUpdatedTimestamp: chatMessage.firstCreatedTimestamp + 1,
                    };

                    onMessageBroadcastRef.current?.(arrivalInteraction);

                    const updatedHistories = { ...td.interactionHistories };
                    if (!updatedHistories[finalLocId]) {
                        updatedHistories[finalLocId] = [];
                    }
                    updatedHistories[finalLocId].push(arrivalInteraction);
                    td = { ...td, interactionHistories: updatedHistories, lastUpdatedTimestamp: Date.now() };
                }
            }

            setInteractionData(td);

            if (isMultiplayerClient) {
                releaseLock();
                return;
            }

            await executeTurnPipeline({
                data: td,
                protagonistId: activeCharacter.id,
                allPromptBlocks,
                errorPrefix: 'Send failed',
                lockAlreadyAcquired: true,
            });
        } catch (e) {
            console.error('Send error:', e);
            releaseLock();
        }
    }, [
        getState, isMultiplayerClient, buildToolContext, addToast,
        acquireLock, releaseLock, executeTurnPipeline, setInteractionData
    ]);

    const triggerHostResponse = useCallback(async () => {
        const currentState = getState();
        if (!currentState.interactionData || !currentState.currentCharacter) return;
        if (!acquireLock()) {
            pendingHostResponseRef.current = true;
            return;
        }

        const allProtagonistIds = new Set(currentState.interactionData.protagonists?.map((p: Character) => p.id) ?? [currentState.currentCharacter.id]);

        await executeTurnPipeline({
            data: currentState.interactionData,
            protagonistId: currentState.currentCharacter.id,
            isProtagonistCharId: (id: string) => allProtagonistIds.has(id),
            errorPrefix: 'Host response failed',
            lockAlreadyAcquired: true,
        });
    }, [getState, acquireLock, executeTurnPipeline]);

    useEffect(() => {
        triggerHostResponseRef.current = triggerHostResponse;
    }, [triggerHostResponse]);

    useEffect(() => {
        if (isMultiplayerClient) return;

        const unsubscribe = MultiplayerEvents.on('peerMessageReceived', async () => {
            await triggerHostResponse();
        });

        return unsubscribe;
    }, [isMultiplayerClient, triggerHostResponse]);

    const sendActionAndGetResponse = useCallback(async (
        actionText: string,
        _targetChar: Character,
        protagonist: Character
    ) => {
        const currentState = getState();
        const currentInteractionData = currentState.interactionData;
        if (!currentInteractionData) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }

        const activeProtagonist = isMultiplayerClient
            ? (joinProtagonistRef.current || protagonist)
            : protagonist;

        const filteredMessages = getFilteredChatMessages(currentInteractionData, activeProtagonist.id, allPromptBlocksRef.current || []);
        const knownCharacterNames = detectName(activeProtagonist, filteredMessages);

        const chatMessage = createChatMessage(currentInteractionData, activeProtagonist, actionText, { knownCharacterNames });

        const currentLocId = getCurrentLocationId(currentInteractionData, activeProtagonist) || 'global';
        const newHistories = { ...currentInteractionData.interactionHistories };
        if (!newHistories[currentLocId]) newHistories[currentLocId] = [];
        newHistories[currentLocId].push(chatMessage);

        const td = { ...currentInteractionData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };

        onMessageBroadcastRef.current?.(chatMessage);
        setInteractionData(td);

        if (isMultiplayerClient) {
            releaseLock();
            return;
        }

        const allProtagonistIds = new Set(td.protagonists?.map((p: Character) => p.id) ?? [protagonist.id]);

        await executeTurnPipeline({
            data: td,
            protagonistId: protagonist.id,
            isProtagonistCharId: (id: string) => allProtagonistIds.has(id),
            errorPrefix: 'Action failed',
            lockAlreadyAcquired: true,
        });
    }, [getState, acquireLock, addToast, isMultiplayerClient, setInteractionData, executeTurnPipeline, releaseLock]);

    const stopGeneration = useCallback(() => {
        wasStoppedRef.current = true;
        isSpeculatingRef.current = false;

        const resumeId = resumingMessageIdRef.current;
        const currentData = getState().interactionData;

        abortControllerRef.current?.abort();
        abortControllerRef.current = null;

        if (resumeId && currentData) {
            const streamedText = streamingTextRef.current || resumingExistingTextRef.current;
            const updatedHistories = { ...currentData.interactionHistories };
            for (const [locId, msgs] of Object.entries(updatedHistories) as [string, HistoryMessage[]][]) {
                const idx = msgs.findIndex((m: HistoryMessage) => m.id === resumeId && hasTextContent(m));
                if (idx !== -1) {
                    const targetMsg = msgs[idx] as ChatMessage | WhisperMessage;
                    const textContent = streamedText || targetMsg.textContent;
                    const paragraphs = (textContent.match(/\n\n/g) || []).length + 1;

                    const isProcessed = streamedText && streamedText !== targetMsg.textContent;

                    updatedHistories[locId] = [...msgs];
                    updatedHistories[locId][idx] = {
                        ...targetMsg,
                        textContent: targetMsg.textContent || textContent,
                        processedTextContent: isProcessed ? textContent : targetMsg.processedTextContent,
                        lastUpdatedTimestamp: Date.now()
                    } as ChatMessage | WhisperMessage;

                    if (paragraphs > 0) consumeChatStaminaForMessage(updatedHistories[locId][idx], paragraphs);
                    break;
                }
            }

            setState({
                interactionData: { ...currentData, interactionHistories: updatedHistories, lastUpdatedTimestamp: Date.now() },
                streamingCharacter: null,
                streamingText: '',
                isLoading: false,
                latency: 0,
                timeToFirstToken: 0,
            });
            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';
            pendingPartialRef.current = null;
        } else {
            const t = streamingTextRef.current;
            const c = getState().streamingCharacter;
            pendingPartialRef.current = (t && c) ? { text: t, character: c } : null;
            setState({
                streamingCharacter: null,
                streamingText: '',
                isLoading: false,
                latency: 0,
                timeToFirstToken: 0,
            });
        }

        useSessionStore.setState({
            isLoading: false,
            streamingCharacter: null,
            streamingText: '',
        });

        isLoadingRef.current = false;
        resetStream();
        streamingCharacterRef.current = null;
        streamingMessageIdRef.current = null;
    }, [resetStream, getState, setState, streamingTextRef, isLoadingRef, isSpeculatingRef]);

    const resumeGeneration = useCallback(async (messageId: string, allPromptBlocks: PromptBlock[] | undefined) => {
        if (isMultiplayerClient) {
            addToast('Generation is handled by the host.', 'info');
            return;
        }

        const currentInteractionData = getState().interactionData;
        if (!currentInteractionData) return;
        if (!currentInteractionData.profile || !currentInteractionData.profile?.enableCharacterExpression) sentimentEngine.unload();

        const history = getGlobalMessageHistory(currentInteractionData);
        const msg = history.find(m => m.id === messageId);
        if (!msg || !hasTextContent(msg)) {
            addToast('Message not found or has no text content.', 'error');
            return;
        }

        if (isLoadingRef.current) {
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
            await new Promise(r => setTimeout(r, 100));
        }
        if (!acquireLock()) {
            addToast('Already generating...', 'info');
            return;
        }
        const currentState = getState();
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) {
            addToast('Model not ready.', 'error');
            releaseLock();
            return;
        }

        const existingText = msg.textContent;
        const char = msg.character;
        resumingMessageIdRef.current = messageId;
        resumingExistingTextRef.current = existingText;
        wasStoppedRef.current = false;
        isSpeculatingRef.current = false;
        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;

        streamingCharacterRef.current = char;
        streamingMessageIdRef.current = messageId;
        streamingTextRef.current = existingText;

        useSessionStore.setState({
            isLoading: true,
            streamingCharacter: char,
            streamingText: existingText,
        });

        setStreamingText(existingText);
        setStreamingState(char, existingText);
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const result = await chatEngine.handleServerResponse(
                currentInteractionData, char, ctrl.signal,
                throttledSetStreamingTextWithBroadcast, undefined, existingText, allPromptBlocks
            );

            const liveStreamedText = streamingTextRef.current || existingText;
            const dataToFinalize = result?.interactionData || currentInteractionData;

            const finalized = finalizeMessageById(
                dataToFinalize,
                messageId,
                wasStoppedRef.current,
                result?.rawText || liveStreamedText,
                result?.displayText
            );

            const finalizedMsg = getGlobalMessageHistory(finalized).find(m => m.id === messageId);
            if (finalizedMsg) onMessageBroadcastRef.current?.(finalizedMsg);

            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';

            const finalText = finalizedMsg && hasTextContent(finalizedMsg) ? finalizedMsg.textContent : liveStreamedText;
            const evaluation = evaluateAutoResumeSignals(finalized.profile, finalText, autoResumeCountRef.current);

            let dataToSave = finalized;

            if (evaluation.shouldResume && !wasStoppedRef.current) {
                autoResumeCountRef.current += 1;
                dataToSave = injectStopSignals(finalized, evaluation.patternsToInject);
                setState({
                    interactionData: dataToSave,
                    streamingCharacter: null,
                    streamingText: '',
                });
                setTimeout(() => {
                    const allProtagonistIds = new Set(dataToSave.protagonists?.map(p => p.id) ?? [char.id]);
                    const reMarkedId = findLastAIMessageId(dataToSave, allProtagonistIds);
                    if (reMarkedId) {
                        resumeGenerationRef.current?.(reMarkedId, allPromptBlocks);
                    }
                }, 0);
                return;
            }

            setState({
                interactionData: dataToSave,
                streamingCharacter: null,
                streamingText: '',
            });

            const protagonistIds = new Set(currentInteractionData.protagonists?.map((p: Character) => p.id) ?? []);
            if (!protagonistIds.has(char.id)) ui.playVoice(finalText, char);
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error('Resume failed:', e);
                addToast(`Resume error: ${(e as Error).message}`, 'error');
            }
            pendingPartialRef.current = null;
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
            isSpeculatingRef.current = false;
            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';
            streamingCharacterRef.current = null;
            streamingMessageIdRef.current = null;

            useSessionStore.setState({
                isLoading: false,
                streamingCharacter: null,
                streamingText: '',
            });

            releaseLock();
        }
    }, [
        getState, setState, isLoadingRef, acquireLock, isModelReadyForGeneration,
        setStreamingText, streamingTextRef, addToast, releaseLock, chatEngine,
        throttledSetStreamingTextWithBroadcast, ui, setStreamingState, setStats, isMultiplayerClient, isSpeculatingRef
    ]);

    useEffect(() => {
        resumeGenerationRef.current = resumeGeneration;
    }, [resumeGeneration]);

    const regenerateFromMessage = useCallback(async (
        messageId: string,
        protagonists: Character[],
        allPromptBlocks?: PromptBlock[]
    ) => {
        if (isMultiplayerClient) {
            addToast('Generation is handled by the host.', 'info');
            return;
        }

        const currentInteractionData = getState().interactionData;
        if (!currentInteractionData) { addToast('Chat data missing.', 'error'); return; }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }

        const protagonistIds = new Set(protagonists.map(p => p.id));
        const sortedHistory = getGlobalMessageHistory(currentInteractionData);
        const ti = sortedHistory.findIndex(m => m.id === messageId);
        if (ti === -1) { addToast('Message not found.', 'error'); releaseLock(); return; }

        const tm = sortedHistory[ti];
        const isProtagonistMessage = protagonistIds.has(tm.character.id);
        const trimIdx = isProtagonistMessage ? ti + 1 : ti;
        const toDelete = sortedHistory.slice(trimIdx);

        if (toDelete.length) {
            try {
                await Promise.all(toDelete.map(m => deleteRawMessage(m.id)));
            } catch (e) {
                console.error('Delete failed:', e);
            }
        }

        const updatedHistories: Record<string, HistoryMessage[]> = {};
        for (const [locId, msgs] of Object.entries(currentInteractionData.interactionHistories || {}) as [string, HistoryMessage[]][]) {
            const keptMsgs = msgs.filter((m: { id: string }) => {
                const globalIdx = sortedHistory.findIndex(hm => hm.id === m.id);
                return globalIdx !== -1 && globalIdx < trimIdx;
            });
            if (keptMsgs.length > 0) {
                updatedHistories[locId] = keptMsgs;
            }
        }

        const td: InteractionData = {
            ...currentInteractionData,
            interactionHistories: updatedHistories,
            lastUpdatedTimestamp: Date.now()
        };
        setInteractionData(td);

        const primaryProtagonistId = protagonists[0]?.id ?? '';
        const respondingChar = td.participants.find(p => !protagonistIds.has(p.id)) || protagonists[0];

        await executeTurnPipeline({
            data: td,
            protagonistId: primaryProtagonistId,
            allPromptBlocks,
            respondingCharacter: respondingChar,
            isProtagonistCharId: (id: string) => protagonistIds.has(id),
            errorPrefix: 'Regeneration failed',
            lockAlreadyAcquired: true,
        });
    }, [getState, isMultiplayerClient, addToast, acquireLock, releaseLock, setInteractionData, executeTurnPipeline]);

    const startNewChat = useCallback((char: Character) => {
        const c = createNewInteractionData(char);
        c.name = 'Untitled Chat';
        setInteractionData(c);
        setSelectedCharacter(char);
        isAtBottomRef.current = true;
        setState({ sessionStartTimestamp: Date.now() });

        speculativeMarkovEngine.clearSession(c.id);
    }, [setInteractionData, setSelectedCharacter, setState]);

    return {
        ...state,
        ...ui,
        sendMessage,
        stopGeneration,
        resumeGeneration,
        regenerateFromMessage,
        startNewChat,
        sendActionAndGetResponse,
        triggerHostResponse,
        setActiveBudgetStrategy: setActiveStrategy,
        setSelectedGlobalModel: setSelectedModel,
        updateRunningModels,
    };
}