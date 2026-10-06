// frontend_src/hooks/useChatSession.ts
import { useRef, useCallback, useEffect } from 'react';
import { useChatEngine } from './useChatEngine';
import { useChatUI } from './useChatUI';
import { useToast } from '../context/ToastContext';
import { createChatMessage, convertIdsToDisplayNames, createNewInteractionData } from '../utilities/chatLogic';
import { processPendingToolActions, type ToolExecutionContext } from '../services/ToolExecutor';
import { runSummarization } from '../services/SummarizationEngine';
import { consumeChatStaminaForMessage } from '../utilities/characterLogic';
import { getCurrentLocationId } from '../utilities/locationLogic';
import { getGlobalMessageHistory, getLocalMessageHistory } from '../utilities/timelineLogic';
import { deleteRawMessage } from '../storages/serverStorage';
import { useThrottledStream } from './useThrottledStream';
import { useCharacterResponseLock } from './useCharacterResponseLock';
import { useAmbientNarration } from './useAmbientNarration';
import { useSessionStore } from './useSessionStore';
import type { RequestMetadata } from '../services/BudgetStrategyEngine';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { MultiplayerEvents } from '../services/MultiplayerEvents';

import {
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
import { useChatSender } from './useChatSender';

import type {
    Character, PromptBlock,
    Profile, InteractionData, ChatMessage, WhisperMessage,
    HistoryMessage, LanguageModel
} from '../types';
import { useFrontCamera } from './useFrontCamera';

interface UseChatSessionOptions {
    onMessageBroadcast?: (message: HistoryMessage) => void;
    onStateBroadcast?: (state: Partial<InteractionData>) => void;
    isMultiplayerClient?: boolean;
    joinProtagonist?: Character | null;
    allCharacters?: Character[];
    allContexts?: any[];
    allLocations?: any[];
    allAudioTracks?: any[];
    allPromptBlocks?: PromptBlock[];
    allSamplers?: any[];
    allStopPatterns?: any[];
    allBudgetStrategies?: any[];
    allProfiles?: Profile[];
    allWorlds?: any[];
    allMemories?: any[];
    allExtensions?: any[];
    allAccounts?: any[];
    allMultiplayerData?: any[];
    allActions?: any[];
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

    // ─── Zustand Selectors ───────────────────────────────────────────
    const interactionData = useSessionStore(s => s.interactionData);
    const localProtagonist = useSessionStore(s => s.localProtagonist);
    const activeStrategy = useSessionStore(s => s.activeStrategy);
    const selectedModel = useSessionStore(s => s.selectedModel);
    const runningModels = useSessionStore(s => s.runningModels);
    const budgetData = useSessionStore(s => s.budgetData);
    const selectedModelId = useSessionStore(s => s.selectedModelId);
    const isLoading = useSessionStore(s => s.isLoading);
    const currentCharacterExpression = useSessionStore(s => s.currentCharacterExpression);
    const streamingCharacter = useSessionStore(s => s.streamingCharacter);

    const setInteractionData = useSessionStore(s => s.setInteractionData);
    const setStreamingState = useSessionStore(s => s.setStreamingState);
    const setStats = useSessionStore(s => s.setStats);
    const setSelectedCharacterExpression = useSessionStore(s => s.setSelectedCharacterExpression);
    const setLastSelectedModelId = useSessionStore(s => s.setLastSelectedModelId);
    const setActiveStrategy = useSessionStore(s => s.setActiveStrategy);
    const setSelectedModel = useSessionStore(s => s.setSelectedModel);
    const setSelectedCharacter = useSessionStore(s => s.setLocalProtagonist);
    const setBudgetData = useSessionStore(s => s.setBudgetData);
    const updateRunningModels = useSessionStore(s => s.updateRunningModels);
    const setNumberOfTokens = useSessionStore(s => s.setNumberOfTokens);

    const getState = useSessionStore.getState;
    const setState = useSessionStore.setState;

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

    const ui = useChatUI(interactionData, isAtBottomRef);

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

        const allProtagonistIds = new Set(base.protagonistIds || [protagonistId]);
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
        const allProtagonistIds = new Set(data.protagonistIds || [protagonistId]);
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
        const protagonistIds = new Set(data.protagonistIds || []);
        
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (hasTextContent(msg) && !protagonistIds.has(msg.character.id)) {
                const chatMsg = msg as ChatMessage;
                if (chatMsg.inventory?.___scheduled_responses___) {
                    try {
                        const tasks = JSON.parse(chatMsg.inventory.___scheduled_responses___ as string);
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
                            delete cleanInv['___scheduled_responses___'];
                            if (Object.keys(cleanInv).length === 0) cleanMsg.inventory = undefined;
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

        const allProtagonistIds = new Set(data.protagonistIds || [protagonistId]);
        const isProtagonist = isProtagonistCharId || ((id: string) => allProtagonistIds.has(id));

        const respondingChar = respondingCharacter
            || data.participants.find(p => !isProtagonist(p.id))
            || data.participants[0]
            || currentState.localProtagonist;

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
                    const ad = await generateAmbientNarration(ud, ctrl.signal, protagonistId);
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
            await chatEngine.runTurn(
                currentData,
                abortControllerRef.current || new AbortController(),
                allPromptBlocksRef.current,
                undefined,
                prefillText
            );
        } catch (e) {
            console.error('Delayed response error:', e);
        } finally {
            releaseLock();
        }
    }, [getState, acquireLock, releaseLock, chatEngine, isLoadingRef]);

    useEffect(() => {
        triggerDelayedResponseRef.current = triggerDelayedResponse;
    }, [triggerDelayedResponse]);

    // ─── Message Input Sender (Extracted) ────────────────────────────
    const { sendMessage, sendActionAndGetResponse } = useChatSender({
        isMultiplayerClient,
        joinProtagonistRef,
        allCharactersRef,
        allActionsRef,
        allPromptBlocksRef,
        onMessageBroadcastRef,
        onStateBroadcastRef,
        buildToolContext,
        executeTurnPipeline,
        acquireLock,
        releaseLock,
        addToast,
        setInteractionData,
        getState,
    });

    const triggerHostResponse = useCallback(async () => {
        const currentState = getState();
        if (!currentState.interactionData || !currentState.localProtagonist) return;
        if (!acquireLock()) {
            pendingHostResponseRef.current = true;
            return;
        }

        const allProtagonistIds = new Set(currentState.interactionData.protagonistIds || [currentState.localProtagonist.id]);

        await executeTurnPipeline({
            data: currentState.interactionData,
            protagonistId: currentState.localProtagonist.id,
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
                    const allProtagonistIds = new Set(dataToSave.protagonistIds || [char.id]);
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

            const protagonistIds = new Set(currentInteractionData.protagonistIds || []);
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
        protagonistIds: string[],
        allPromptBlocks?: PromptBlock[]
    ) => {
        if (isMultiplayerClient) {
            addToast('Generation is handled by the host.', 'info');
            return;
        }

        const currentInteractionData = getState().interactionData;
        if (!currentInteractionData) { addToast('Chat data missing.', 'error'); return; }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }

        const protagonistIdSet = new Set(protagonistIds);
        const sortedHistory = getGlobalMessageHistory(currentInteractionData);
        const ti = sortedHistory.findIndex(m => m.id === messageId);
        if (ti === -1) { addToast('Message not found.', 'error'); releaseLock(); return; }

        const tm = sortedHistory[ti];
        const isProtagonistMessage = protagonistIdSet.has(tm.character.id);
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

        const primaryProtagonistId = protagonistIds[0] ?? '';
        const respondingChar = td.participants.find(p => !protagonistIdSet.has(p.id)) 
            || td.participants.find(p => p.id === primaryProtagonistId) 
            || td.participants[0];

        await executeTurnPipeline({
            data: td,
            protagonistId: primaryProtagonistId,
            allPromptBlocks,
            respondingCharacter: respondingChar,
            isProtagonistCharId: (id: string) => protagonistIdSet.has(id),
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
        interactionData,
        localProtagonist,
        activeStrategy,
        selectedModel,
        runningModels,
        budgetData,
        selectedModelId,
        isLoading,
        currentCharacterExpression,
        streamingCharacter,

        setInteractionData,
        setSelectedCharacter,
        setActiveBudgetStrategy: setActiveStrategy,
        setSelectedGlobalModel: setSelectedModel,
        updateRunningModels,

        ...ui,
        sendMessage,
        stopGeneration,
        resumeGeneration,
        regenerateFromMessage,
        startNewChat,
        sendActionAndGetResponse,
        triggerHostResponse,
    };
}