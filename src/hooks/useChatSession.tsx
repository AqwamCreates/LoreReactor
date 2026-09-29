// src/hooks/useChatSession.tsx
import { useRef, useCallback, useEffect } from 'react';
import { useChatState } from './useChatState';
import { useChatEngine } from './useChatEngine';
import { useChatUI } from './useChatUI';
import { useToast } from '../context/ToastContext';
import { createChatMessage, addMessageToInteractionData, convertIdsToDisplayNames, createNewInteractionData } from '../utilities/chatLogic';
import { processPendingToolActions, executeTool, type ToolExecutionContext } from '../services/ToolExecutor';
import { parseSlashCommand } from '../services/ToolInvocationParser';
import { runSummarization } from '../services/SummarizationEngine';
import { consumeChatStaminaForMessage } from '../utilities/characterLogic';
import { getCurrentLocationIndex, findLocationByRegex } from '../utilities/locationLogic';
import { detectName } from '../utilities/nameDetection';
import { getFilteredChatMessages } from '../utilities/promptLogic';
import { loadRawBudgetData, saveRawBudgetData } from '../storages/serverStorage';
import { useThrottledStream } from './useThrottledStream';
import { useCharacterResponseLock } from './useCharacterResponseLock';
import { useAmbientNarration } from './useAmbientNarration';
import { useSessionStore } from './useSessionStore';
import { localURL } from '../configurations';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getBudgetStrategyEngine, type RequestMetadata } from '../services/BudgetStrategyEngine';
import { learnFromUserMessage } from '../services/ActionFormatEngine';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { MultiplayerEvents } from '../services/MultiplayerEvents';
import type { 
    Character, Context, Location, AudioTrack, World, 
    PromptBlock, Sampler, StopPattern, BudgetStrategy, 
    Profile, InteractionData, ChatMessage, WhisperMessage, 
    HistoryMessage, Memory, Extension, Account, 
    MultiplayerData, LanguageModel, InterjectableAction 
} from '../types';

const engine = getLanguageModelEngine();

const NO_ARG_TOOLS = ['coin', 'date'];
const HOST_ONLY_TOOLS = ['administrator', 'creator', 'destroyer'];

function calculateLatencyFactor(
    timeSinceLastTokenMs: number, 
    averageTTFTMs: number,
    msPerToken: number
): number {
    const painPoint = averageTTFTMs * 2;
    const zValue = timeSinceLastTokenMs - painPoint;
    const scaledZValue = zValue / msPerToken;
    return 1 / (1 + Math.exp(scaledZValue));
}

function finalizeMessageById(
    data: InteractionData,
    messageId: string,
    wasAborted: boolean
): InteractionData {
    if (wasAborted) return data;

    const history = data.interactionHistory.map(m => {
        if (m.id === messageId && m.messageType === 'chat') {
            return {
                ...m,
                lastUpdatedTimestamp: Date.now(),
            } as ChatMessage;
        }
        return m;
    });
    return { ...data, interactionHistory: history, lastUpdatedTimestamp: Date.now() };
}

function findLastAIMessageId(
    data: InteractionData,
    protagonistId: string,
): string | null {
    const history = data.interactionHistory;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.messageType === 'chat' && msg.character.id !== protagonistId) {
            return msg.id;
        }
    }
    return null;
}

interface UseChatSessionOptions {
    onMessageBroadcast?: (message: HistoryMessage) => void;
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
}

interface GenerationTurnOptions {
    data: InteractionData;
    protagonistId: string;
    allPromptBlocks?: PromptBlock[];
    responderCharacter?: Character;
    isProtagonistCharId?: (charId: string) => boolean;
    errorPrefix?: string;
    lockAlreadyAcquired?: boolean;
}

export function useChatSession(options: UseChatSessionOptions) {
    const { addToast } = useToast();
    const onMessageBroadcastRef = useRef(options?.onMessageBroadcast);
    const isMultiplayerClient = options?.isMultiplayerClient ?? false;
    const requestBorrowedModel = options?.requestBorrowedModel;
    
    useEffect(() => { onMessageBroadcastRef.current = options?.onMessageBroadcast; }, [options?.onMessageBroadcast]);

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

    const interactionData = useSessionStore(s => s.interactionData);
    const selectedModel = useSessionStore(s => s.selectedModel);
    const autonomousMode = useSessionStore(s => s.interactionData?.Profile?.autonomousMode ?? false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);
    const resumingMessageIdRef = useRef<string | null>(null);
    const resumingExistingTextRef = useRef<string>('');
    const isAtBottomRef = useRef(true);
    const wasStoppedRef = useRef(false);
    const isSpeculatingRef = useRef(false);

    const resumeGenerationRef = useRef<(messageId: string, allPromptBlocks?: PromptBlock[]) => Promise<void>>(null);
    const streamingMessageIdRef = useRef<string | null>(null);
    const streamingCharacterRef = useRef<Character | null>(null);

    const pendingHostResponseRef = useRef(false);
    const triggerHostResponseRef = useRef<() => Promise<void>>(null);
    const pendingResumeRef = useRef<{ messageId: string; allPromptBlocks?: PromptBlock[] } | null>(null);

    const lastTurnContextRef = useRef<{ modelId: string; prompt: string; metadata: RequestMetadata } | null>(null);
    const requestTimestampsRef = useRef<number[]>([]);
    const lastTokenTimestampRef = useRef<number>(0);

    const getRequestsLastHour = useCallback(() => {
        const now = Date.now();
        const cutoff = now - 60 * 60 * 1000;
        requestTimestampsRef.current = requestTimestampsRef.current.filter(t => t > cutoff);
        return requestTimestampsRef.current.length;
    }, []);

    const ui = useChatUI(state.interactionData, state.isLoading, state.streamingText, isAtBottomRef);

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
    });

    const { throttledSetStreamingText, setStreamingText, streamingTextRef, resetStream } = useThrottledStream();
    const { acquireLock, releaseLock, isLoadingRef } = useCharacterResponseLock();
    const { generateAmbientNarration } = useAmbientNarration(setStreamingState, setStreamingText, streamingTextRef);

    const throttledSetStreamingTextWithBroadcast = useCallback((text: string) => {
        throttledSetStreamingText(text);
        const char = streamingCharacterRef.current;
        const msgId = streamingMessageIdRef.current;
        
        const now = Date.now();
        const timeSinceLastToken = lastTokenTimestampRef.current > 0 ? (now - lastTokenTimestampRef.current) : 25;
        lastTokenTimestampRef.current = now;

        const profile = getState().interactionData?.Profile;
        if (profile?.enableSpeculativeMarkov && char && msgId && abortControllerRef.current && !isSpeculatingRef.current) {
            const model = getState().selectedModel;
            const currentData = getState().interactionData;
            const currentDataId = currentData?.id || 'unknown';
            const budgetData = getState().budgetData;
            
            const outputCost = model?.outputGenerationCostPerOneMillionOfTokens || 15;
            const cacheMissCost = model?.cacheMissCostPerOneMillionOfTokens || 3;

            const profileTemp = Number(profile.characterSampler?.parameters?.temperature);
            const charTemp = Number(char.sampler?.parameters?.temperature);
            
            let temperature = 1.0;
            if (!Number.isNaN(profileTemp)) {
                temperature = profileTemp;
            } else if (!Number.isNaN(charTemp)) {
                temperature = charTemp;
            }
            temperature = Math.max(0.1, temperature);

            if (text.endsWith(' ') || text.endsWith('\n') || text.match(/[.!?]$/)) {
                const prediction = speculativeMarkovEngine.predictSequence(
                    text, outputCost, cacheMissCost, temperature, char.id, currentDataId
                );
                
                if (prediction) {
                    const estimatedTokens = prediction.trim().split(/\s+/).length;
                    const costRatio = cacheMissCost / outputCost;
                    
                    let minimumTokensThreshold = Number.POSITIVE_INFINITY;
                    if (costRatio < 1) {
                        const modelId = model?.id || '';
                        const TTFT_ms = budgetData?.modelAverageTimeToFirstToken?.[modelId] ?? 500;
                        const msPerToken = budgetData?.modelAverageLatencyMsPerToken?.[modelId] ?? 25;

                        const latencyFactor = calculateLatencyFactor(timeSinceLastToken, TTFT_ms, msPerToken);
                        
                        const TTFT_seconds = TTFT_ms / 1000;
                        const TPS = 1000 / msPerToken;
                        
                        const baseThreshold = (TTFT_seconds * TPS) / (1 - costRatio);
                        minimumTokensThreshold = Math.ceil(baseThreshold * latencyFactor);
                    }
                    
                    if (estimatedTokens >= minimumTokensThreshold) {
                        isSpeculatingRef.current = true;
                        const completedText = text + prediction;
                        throttledSetStreamingText(completedText);
                        abortControllerRef.current?.abort();

                        const freshData = getState().interactionData;
                        if (freshData && char) {
                            const existingMsgIdx = freshData.interactionHistory.findIndex(m => m.id === msgId);
                            let updatedData: InteractionData;
                            if (existingMsgIdx === -1) {
                                const speculativeMsg = createChatMessage(freshData, char, completedText);
                                speculativeMsg.id = msgId;
                                updatedData = addMessageToInteractionData(freshData, speculativeMsg);
                            } else {
                                const updatedHistory = [...freshData.interactionHistory];
                                updatedHistory[existingMsgIdx] = {
                                    ...updatedHistory[existingMsgIdx],
                                    textContent: completedText,
                                    lastUpdatedTimestamp: Date.now(),
                                } as ChatMessage;
                                updatedData = { ...freshData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() };
                            }
                            setInteractionData(updatedData);

                            setTimeout(() => {
                                isSpeculatingRef.current = false;
                                resumeGenerationRef.current?.(msgId, undefined);
                            }, 60);
                        } else {
                            isSpeculatingRef.current = false;
                        }
                        return;
                    }
                }
            }
        }

        if (char && msgId && onMessageBroadcastRef.current) {
            const partialMsg: ChatMessage = {
                id: msgId,
                messageType: 'chat',
                character: char,
                textContent: text,
                files: [],
                modelTextContentSummaries: {},
                modelInteractionTextContentSummaries: {},
                kvCacheTextContentPaths: {},
                kvCacheTextContentSummaryPaths: {},
                kvCacheInteractionTextContentSummaries: {},
                characterClothingWearingStatuses: {},
                characterLockedLocations: {},
                parentInteractionMessageId: null,
                firstCreatedTimestamp: Date.now(),
                lastUpdatedTimestamp: Date.now(),
            };
            onMessageBroadcastRef.current(partialMsg);
        }
    }, [throttledSetStreamingText, getState, setInteractionData]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const bd = await loadRawBudgetData();
                if (!cancelled && bd) setBudgetData(bd);
            } catch (e) { console.warn('Failed to load budget data:', e); }
        })();
        return () => { cancelled = true; };
    }, [setBudgetData]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch(`${localURL}/models/status`);
                if (!response.ok || cancelled) return;
                const data = await response.json();
                const status: Record<string, { isRunning: boolean; port?: number }> = {};
                for (const m of data.activeModels || []) status[m.id] = { isRunning: true, port: m.port };
                if (!cancelled) updateRunningModels(status);
            } catch (e) { if (!cancelled) addToast(`Failed to fetch models status: ${e}`); }
        })();
        return () => { cancelled = true; };
    }, [updateRunningModels, addToast]);

    useEffect(() => {
        if (selectedModel) engine.setContext(selectedModel);
    }, [selectedModel]);

    useEffect(() => {
        if (!interactionData) return;
        let cancelled = false;
        (async () => {
            let total = 0;
            for (const m of interactionData.interactionHistory) {
                if (m.messageType === 'chat') total += await engine.countTokens(m.textContent);
            }
            if (!cancelled) setNumberOfTokens(total);
        })();
        return () => { cancelled = true; };
    }, [interactionData, setNumberOfTokens]);

    useEffect(() => {
        if (autonomousMode && interactionData && !isMultiplayerClient) {
            const checkCanAct = () => !isLoadingRef.current && !abortControllerRef.current;
            chatEngine.startAutonomousMode(
                checkCanAct,
                () => getState().interactionData,
                (data: InteractionData) => { setState({ interactionData: data }); },
                resetStream
            );
        } else {
            chatEngine.stopAutonomousMode();
        }
        return () => { chatEngine.stopAutonomousMode(); };
    }, [autonomousMode, interactionData, chatEngine, isLoadingRef, resetStream, getState, setState, isMultiplayerClient]);

    useEffect(() => {
        const handleBeforeUnload = () => {
            try {
                getBudgetStrategyEngine().persistFMs().catch(() => {});
            } catch (e) {
                console.warn('Failed to persist FMs on unload:', e);
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    const isModelReadyForGeneration = useCallback((): boolean => {
        const m = getState().selectedModel;
        if (!m) return false;
        if (m.apiKey) return true;
        const models = getState().runningModels;
        return !!(m.id && models[m.id]?.port);
    }, [getState]);

    const applyPendingPartial = useCallback(async (base: InteractionData, protagonistId: string): Promise<InteractionData> => {
        const p = pendingPartialRef.current;
        if (!p) return base;
        pendingPartialRef.current = null;
        const dt = convertIdsToDisplayNames(p.text, base);
        const h = base.interactionHistory;
        if (h.length > 0 && h[h.length - 1].character.id !== protagonistId) {
            const lastMsg = h[h.length - 1];
            if (lastMsg.messageType === 'chat') {
                const ph = [...h];
                ph[ph.length - 1] = {
                    ...lastMsg,
                    textContent: dt,
                };
                return { ...base, interactionHistory: ph, lastUpdatedTimestamp: Date.now() };
            }
        }
        const chatMessage = createChatMessage(base, p.character, dt);
        return addMessageToInteractionData(base, chatMessage);
    }, []);

    const autoResumeOnCutoff = useCallback((data: InteractionData, protagonistId: string, allPromptBlocks?: PromptBlock[]) => {
        const messageId = findLastAIMessageId(data, protagonistId);
        if (!messageId) return;

        setTimeout(() => {
            resumeGenerationRef.current?.(messageId, allPromptBlocks);
        }, 0);
    }, []);

    const broadcastNewMessages = useCallback((beforeCount: number, afterData: InteractionData) => {
        if (!onMessageBroadcastRef.current) return;
        const newMessages = afterData.interactionHistory.slice(beforeCount);
        for (const msg of newMessages) {
            onMessageBroadcastRef.current(msg);
        }
    }, []);

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
        addToast,
    }), [addToast]);

    // ─── Unified Generation Pipeline ─────────────────────────────────
    const executeTurnPipeline = useCallback(async ({
        data,
        protagonistId,
        allPromptBlocks,
        responderCharacter,
        isProtagonistCharId,
        errorPrefix = 'Generation failed',
        lockAlreadyAcquired = false,
    }: GenerationTurnOptions) => {
        if (!lockAlreadyAcquired && !acquireLock()) return;
        if (!data.Profile || !data.Profile?.enableCharacterExpression) sentimentEngine.unload();

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
        resetStream();
        setStreamingState(null, '');
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;
        lastTokenTimestampRef.current = Date.now();

        const preTurnCount = data.interactionHistory.length;
        const isProtagonist = isProtagonistCharId || ((id: string) => id === protagonistId);
        const responderChar = responderCharacter
            || data.participants.find(p => !isProtagonist(p.id))
            || data.participants[0]
            || currentState.currentCharacter;

        streamingCharacterRef.current = responderChar ?? null;
        streamingMessageIdRef.current = `gen-${responderChar?.id || 'ai'}-${Date.now()}`;

        try {
            requestTimestampsRef.current.push(Date.now());
            const metadata: RequestMetadata = {
                numberOfMessages: data.interactionHistory.length,
                numberOfRequestsDuringTheLastHour: getRequestsLastHour(),
            };

            const interactionDataId = data.id || 'unknown';
            for (const participant of data.participants) {
                const charHistory = data.interactionHistory.filter(
                    (m): m is ChatMessage | WhisperMessage =>
                        m.character.id === participant.id && (m.messageType === 'chat' || m.messageType === 'whisper')
                );
                speculativeMarkovEngine.syncMessages(
                    charHistory.map(m => ({ textContent: m.textContent, lastUpdatedTimestamp: m.lastUpdatedTimestamp })),
                    participant.id,
                    interactionDataId
                );
            }

            const turnResult = await chatEngine.runTurn(data, ctrl, allPromptBlocks, metadata);
            let ud = turnResult.interactionData;

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

            ud = processPendingToolActions(ud, allCharactersRef.current, { onToast: addToast });

            if (ud.interactionHistory.length > preTurnCount) {
                setInteractionData(ud);
                broadcastNewMessages(preTurnCount, ud);

                if (!turnResult.isCompleted && !wasStoppedRef.current) {
                    autoResumeOnCutoff(ud, protagonistId, allPromptBlocks);
                    return;
                }

                runSummarization({
                    data: ud,
                    setData: setInteractionData,
                    addToast,
                });

                const lm = ud.interactionHistory[ud.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && !isProtagonist(lm.character.id)) {
                    ui.playVoice(lm.textContent, lm.character);
                }
            } else {
                const enableAmbientNarration = ud?.Profile?.enableAmbientNarration ?? false;
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
            releaseLock();

            if (pendingResumeRef.current) {
                const { messageId, allPromptBlocks: blocks } = pendingResumeRef.current;
                pendingResumeRef.current = null;
                setTimeout(() => resumeGenerationRef.current?.(messageId, blocks), 0);
            } else if (pendingHostResponseRef.current) {
                pendingHostResponseRef.current = false;
                setTimeout(() => triggerHostResponseRef.current?.(), 0);
            }
        }
    }, [
        acquireLock, getState, isModelReadyForGeneration, addToast, releaseLock, 
        resetStream, setStreamingState, setStats, getRequestsLastHour, chatEngine, 
        applyPendingPartial, setInteractionData, broadcastNewMessages, 
        autoResumeOnCutoff, ui, generateAmbientNarration
    ]);

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
                const isAdmin = accountConfig?.isAdministrator === true;
                
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
                    currentState.interactionData.Profile?.toolUsageDisplayMode
                );

                slashMessage.textContent = toolResult.displayReplacement || toolResult.content || `[${slashInvocation.toolType}]`;

                let updatedData = addMessageToInteractionData(currentState.interactionData, slashMessage);
                updatedData = processPendingToolActions(updatedData, allCharactersRef.current, { onToast: addToast });
                
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
            const convertFileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = error => reject(error);
            });
            const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;

            const filteredMessages = getFilteredChatMessages(currentInteractionData, activeCharacter.id, allPromptBlocks || []);
            const knownCharacterNames = detectName(activeCharacter, filteredMessages);

            const chatMessage = createChatMessage(currentInteractionData, activeCharacter, text, { 
                files: encodedFiles, 
                frontCameraImage: frontCameraImageBase64,
                knownCharacterNames
            });
            let td = addMessageToInteractionData(currentInteractionData, chatMessage);

            onMessageBroadcastRef.current?.(chatMessage);

            if (allActionsRef.current.length > 0) {
                let prevWrap: '*' | '()' | 'none' | 'unknown' = 'unknown';
                for (let i = td.interactionHistory.length - 2; i >= 0; i--) {
                    const prevMsg = td.interactionHistory[i];
                    if (prevMsg.character.id === activeCharacter.id && prevMsg.messageType === 'chat') {
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
                const protagonistMsg = td.interactionHistory[td.interactionHistory.length - 1];
                if (protagonistMsg && protagonistMsg.character.id === activeCharacter.id && protagonistMsg.messageType === 'chat') {
                    const currentLoc = getCurrentLocationIndex(td, activeCharacter);
                    const regexLoc = findLocationByRegex(td.locations, protagonistMsg.textContent, activeCharacter);
                    const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                    td = { ...td, interactionHistory: td.interactionHistory.map((m, i) => i === td.interactionHistory.length - 1 ? { ...m, locationIndex: finalLoc } : m) };
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

        await executeTurnPipeline({
            data: currentState.interactionData,
            protagonistId: currentState.currentCharacter.id,
            errorPrefix: 'Host response failed',
            lockAlreadyAcquired: true,
        });
    }, [getState, acquireLock, executeTurnPipeline]);

    useEffect(() => {
        triggerHostResponseRef.current = triggerHostResponse;
    }, [triggerHostResponse]);

    // Single source of truth: Listener for peer messages to trigger the AI response
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
        const td = addMessageToInteractionData(currentInteractionData, chatMessage);

        onMessageBroadcastRef.current?.(chatMessage);
        setInteractionData(td);

        if (isMultiplayerClient) {
            releaseLock();
            return;
        }

        await executeTurnPipeline({
            data: td,
            protagonistId: protagonist.id,
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
            const idx = currentData.interactionHistory.findIndex(m => m.id === resumeId);
            if (idx !== -1) {
                const targetMsg = currentData.interactionHistory[idx] as ChatMessage;
                const textContent = targetMsg.textContent;
                const paragraphs = (textContent.match(/\n\n/g) || []).length + 1;

                const updatedHistory = [...currentData.interactionHistory];
                updatedHistory[idx] = {
                    ...targetMsg,
                    textContent,
                    lastUpdatedTimestamp: Date.now()
                } as ChatMessage;

                if (paragraphs > 0) consumeChatStaminaForMessage(updatedHistory[idx], paragraphs);

                setState({
                    interactionData: { ...currentData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() },
                    streamingCharacter: null,
                    streamingText: '',
                    isLoading: false,
                    latency: 0,
                    timeToFirstToken: 0,
                });
            }
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

        isLoadingRef.current = false;
        resetStream();
        streamingCharacterRef.current = null;
        streamingMessageIdRef.current = null;
    }, [resetStream, getState, setState, streamingTextRef, isLoadingRef]);

    const resumeGeneration = useCallback(async (messageId: string, allPromptBlocks: PromptBlock[] | undefined) => {
        if (isMultiplayerClient) {
            addToast('Generation is handled by the host.', 'info');
            return;
        }
        
        const currentInteractionData = getState().interactionData;
        if (!currentInteractionData) return;
        if (!currentInteractionData.Profile || !currentInteractionData.Profile?.enableCharacterExpression) sentimentEngine.unload();
        const msgIndex = currentInteractionData.interactionHistory.findIndex(m => m.id === messageId);
        if (msgIndex === -1) { addToast('Message not found.', 'error'); return; }
        const msg = currentInteractionData.interactionHistory[msgIndex];
        if (msg.messageType !== "chat") return;

        if (isLoadingRef.current) { abortControllerRef.current?.abort(); abortControllerRef.current = null; await new Promise(r => setTimeout(r, 100)); }
        if (!acquireLock()) { 
            addToast('Already generating...', 'info'); 
            pendingResumeRef.current = { messageId, allPromptBlocks };
            return; 
        }
        const currentState = getState();
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

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

        setStreamingText(existingText);
        streamingTextRef.current = existingText;
        setStreamingState(char, existingText);
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;
        lastTokenTimestampRef.current = Date.now();

        try {
            const result = await chatEngine.handleServerResponse(
                currentInteractionData, char, ctrl.signal,
                throttledSetStreamingTextWithBroadcast, undefined, existingText, allPromptBlocks
            );
            if (!result) return;

            const finalized = finalizeMessageById(result.interactionData, messageId, wasStoppedRef.current);

            setState({
                interactionData: finalized,
                streamingCharacter: null,
                streamingText: '',
            });

            const finalizedMsg = finalized.interactionHistory.find(m => m.id === messageId);
            if (finalizedMsg) onMessageBroadcastRef.current?.(finalizedMsg);

            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';

            if (!result.isCompleted && !wasStoppedRef.current) {
                setTimeout(() => {
                    const reMarkedId = findLastAIMessageId(finalized, char.id);
                    if (reMarkedId) {
                        resumeGenerationRef.current?.(reMarkedId, allPromptBlocks);
                    }
                }, 0);
                return;
            }

            const finalMsg = finalized.interactionHistory.find(m => m.id === messageId);
            const finalText = finalMsg && finalMsg.messageType === 'chat' ? finalMsg.textContent : '';
            const protagonistIds = new Set(currentInteractionData.protagonists?.map(p => p.id) ?? []);
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
            releaseLock();
            
            if (pendingResumeRef.current) {
                const { messageId, allPromptBlocks: blocks } = pendingResumeRef.current;
                pendingResumeRef.current = null;
                setTimeout(() => resumeGenerationRef.current?.(messageId, blocks), 0);
            } else if (pendingHostResponseRef.current) {
                pendingHostResponseRef.current = false;
                setTimeout(() => triggerHostResponseRef.current?.(), 0);
            }
        }
    }, [
        getState, setState, isLoadingRef, acquireLock, isModelReadyForGeneration, 
        setStreamingText, streamingTextRef, addToast, releaseLock, chatEngine, 
        throttledSetStreamingTextWithBroadcast, ui, setStreamingState, setStats, isMultiplayerClient
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
        const history = currentInteractionData.interactionHistory;
        const ti = history.findIndex(m => m.id === messageId);
        if (ti === -1) { addToast('Message not found.', 'error'); releaseLock(); return; }
        
        const lastModelId = useSessionStore.getState().selectedModelId;
        const ctx = lastTurnContextRef.current;
        
        if (lastModelId && ctx && ctx.modelId === lastModelId) {
            try {
                const budgetEngine = getBudgetStrategyEngine();
                budgetEngine.recordRegeneration(lastModelId, ctx.prompt, ctx.metadata);
                
                const budgetData = budgetEngine.getBudgetData();
                if (budgetData) {
                    await saveRawBudgetData(budgetData);
                }
                budgetEngine.persistFMs();
            } catch (e) {
                console.warn('Failed to record regeneration:', e);
            }
        } else if (lastModelId) {
            try {
                const budgetEngine = getBudgetStrategyEngine();
                const bd = budgetEngine.getBudgetData();
                if (bd) {
                    bd.modelRegenerationCount = bd.modelRegenerationCount || {};
                    bd.modelRegenerationCount[lastModelId] = (bd.modelRegenerationCount[lastModelId] ?? 0) + 1;
                    bd.lastUpdatedTimestamp = Date.now();
                    await saveRawBudgetData(bd);
                }
            } catch (e) {
                console.warn('Failed to record regeneration (fallback):', e);
            }
        }

        const tm = history[ti];
        const isProtagonistMessage = protagonistIds.has(tm.character.id);
        const trimIdx = isProtagonistMessage ? ti + 1 : ti;
        const toDelete = history.slice(trimIdx);
        if (toDelete.length) {
            try { 
                await Promise.all(toDelete.map(m => import('../storages/serverStorage').then(s => s.deleteRawInteractionMessage(m.id)))); 
            } catch (e) { 
                console.error('Delete failed:', e); 
            }
        }

        const td: InteractionData = { 
            ...currentInteractionData, 
            interactionHistory: history.slice(0, trimIdx), 
            lastUpdatedTimestamp: Date.now() 
        };
        setInteractionData(td);

        const primaryProtagonistId = protagonists[0]?.id ?? '';
        const responderChar = td.participants.find(p => !protagonistIds.has(p.id)) || protagonists[0];

        await executeTurnPipeline({
            data: td,
            protagonistId: primaryProtagonistId,
            allPromptBlocks,
            responderCharacter: responderChar,
            isProtagonistCharId: (id: string) => protagonistIds.has(id),
            errorPrefix: 'Regen failed',
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