// src/frontend_src/hooks/useChatPipeline.ts
import { useRef, useCallback, useEffect } from 'react';
import { convertIdsToDisplayNames, createNewInteractionData } from '../utilities/interactionDataLogic';
import { createMessage } from '../utilities/messageLogic';
import { processPendingToolActions } from '../services/ToolExecutor';
import { runSummarization } from '../services/SummarizationEngine';
import { consumeChatStaminaForMessage } from '../utilities/characterLogic';
import { getCurrentLocationId } from '../utilities/locationLogic';
import { getGlobalMessageHistory, getLocalMessageHistory } from '../utilities/timelineLogic';
import { deleteRawMessage, saveRawInteractionData } from '../storages/serverStorage';
import { useChatStore } from './useChatStore';
import { useGenerationStore } from './useGenerationStore';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';
import type { RequestMetadata } from '../services/BudgetStrategyEngine';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { MultiplayerEvents } from '../services/MultiplayerEvents';
import { StreamingVoiceTracker } from '../services/StreamingVoiceTracker';
import {
    hasTextContent,
    finalizeMessageById,
    findLastAIMessageId,
    broadcastToolStateChanges,
    evaluateAutoResumeSignals,
    injectStopSignals,
    type GenerationTurnOptions,
} from '../utilities/chatSessionLogic';
import type {
    Character, PromptBlock,
    InteractionData, ChatMessage,
    HistoryMessage, TextMessage,
} from '../types';

export interface PipelineDependencies {
    isMultiplayerClient: boolean;
    chatEngine: any; 
    acquireLock: () => boolean;
    releaseLock: () => void;
    isLoadingRef: React.MutableRefObject<boolean>;
    throttledSetStreamingTextWithBroadcast: (text: string) => void;
    isSpeculatingRef: React.MutableRefObject<boolean>;
    setStreamingText: (text: string) => void;
    streamingTextRef: React.MutableRefObject<string>;
    resetStream: () => void;
    setStreamingState: (c: Character | null, t: string) => void;
    setStats: (l: any) => void;
    setInteractionData: (d: InteractionData | null | ((prev: InteractionData | null) => InteractionData | null)) => void;
    generateAmbientNarration: any;
    addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
    onMessageBroadcastRef: React.MutableRefObject<((message: HistoryMessage) => void) | undefined>;
    onStateBroadcastRef: React.MutableRefObject<((state: Partial<InteractionData>) => void) | undefined>;
    allCharactersRef: React.MutableRefObject<Character[]>;
    getActivePromptBlocks: (data: InteractionData | null | undefined) => PromptBlock[];
    isModelReadyForGeneration: () => boolean;
    isAtBottomRef: React.MutableRefObject<boolean>;
}

export function useChatPipeline(deps: PipelineDependencies) {
    const {
        isMultiplayerClient, chatEngine, acquireLock, releaseLock, isLoadingRef,
        throttledSetStreamingTextWithBroadcast, isSpeculatingRef, setStreamingText,
        streamingTextRef, resetStream, setStreamingState, setStats, setInteractionData,
        generateAmbientNarration, addToast, onMessageBroadcastRef, onStateBroadcastRef,
        allCharactersRef, getActivePromptBlocks, isModelReadyForGeneration,
        isAtBottomRef
    } = deps;

    const getState = useChatStore.getState;
    const setChatState = useChatStore.setState;
    const setGenerationState = useGenerationStore.setState;
    const setSelectedCharacter = useChatStore(s => s.setLocalProtagonist);

    const abortControllerRef = useRef<AbortController | null>(null);
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);
    const resumingMessageIdRef = useRef<string | null>(null);
    const resumingExistingTextRef = useRef<string>('');
    const wasStoppedRef = useRef(false);
    const autoResumeCountRef = useRef<number>(0);
    const resumeGenerationRef = useRef<((messageId: string) => Promise<void>) | null>(null);
    const streamingMessageIdRef = useRef<string | null>(null);
    const streamingCharacterRef = useRef<Character | null>(null);
    const currentVoiceTrackerRef = useRef<StreamingVoiceTracker | null>(null);
    const pendingHostResponseRef = useRef(false);
    const triggerHostResponseRef = useRef<(() => Promise<void>) | null>(null);
    const pendingResumeRef = useRef<{ messageId: string } | null>(null);
    const lastTurnContextRef = useRef<{ modelId: string; prompt: string; metadata: RequestMetadata } | null>(null);
    const requestTimestampsRef = useRef<number[]>([]);
    const scheduledTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
    const triggerDelayedResponseRef = useRef<(characterId: string, thought?: string) => Promise<void>>(null);

    const getRequestsLastHour = useCallback(() => {
        const now = Date.now();
        const cutoff = now - 60 * 60 * 1000;
        requestTimestampsRef.current = requestTimestampsRef.current.filter(t => t > cutoff);
        return requestTimestampsRef.current.length;
    }, []);

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
                        newHistories[locId][idx] = { ...lastMsg, textContent: dt } as TextMessage;
                        break;
                    }
                }
                return { ...base, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
            }
        }

        const currentLocId = getCurrentLocationId(base, p.character) || 'global';
        const newHistories = { ...base.interactionHistories };
        const currentLocMessages = newHistories[currentLocId] || [];
        const chatMessage = createMessage(p.character, {
            textContent: dt,
            interactionData: base,
        });
        newHistories[currentLocId] = [...currentLocMessages, chatMessage];
        return { ...base, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
    }, []);

    const autoResumeOnCutoff = useCallback((data: InteractionData, protagonistId: string) => {
        const allProtagonistIds = new Set(data.protagonistIds || [protagonistId]);
        const messageId = findLastAIMessageId(data, allProtagonistIds);
        if (!messageId) return;
        setTimeout(() => { resumeGenerationRef.current?.(messageId); }, 0);
    }, []);

    const broadcastNewMessages = useCallback((beforeCount: number, afterData: InteractionData) => {
        if (!onMessageBroadcastRef.current) return;
        const history = getGlobalMessageHistory(afterData);
        const newMessages = history.slice(beforeCount);
        for (const msg of newMessages) onMessageBroadcastRef.current(msg);
    }, [onMessageBroadcastRef]);

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

    const extractAndScheduleResponses = useCallback((data: InteractionData) => {
        const history = getGlobalMessageHistory(data);
        const protagonistIds = new Set(data.protagonistIds || []);
        
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (hasTextContent(msg) && !protagonistIds.has(msg.character.id)) {
                const chatMsg = msg as ChatMessage;
                const tasks = chatMsg.activeToolActions?.scheduledResponses;
                if (tasks && tasks.length > 0) {
                    const timeouts: ReturnType<typeof setTimeout>[] = [];
                    for (const task of tasks) {
                        const delay = task.durationMs;
                        const charId = task.characterId;
                        const charName = task.characterName;
                        const thought = task.thought;
                        
                        const tid = setTimeout(() => {
                            triggerDelayedResponseRef.current?.(charId, thought);
                            const existing = scheduledTimeoutsRef.current.get(chatMsg.id) || [];
                            const remaining = existing.filter(t => t !== tid);
                            if (remaining.length > 0) scheduledTimeoutsRef.current.set(chatMsg.id, remaining);
                            else scheduledTimeoutsRef.current.delete(chatMsg.id);
                        }, delay);
                        
                        timeouts.push(tid);
                        addToast(`⏰ ${charName} scheduled a follow-up in ${formatDelay(delay)}`, 'info');
                    }
                    
                    const existingList = scheduledTimeoutsRef.current.get(chatMsg.id) || [];
                    scheduledTimeoutsRef.current.set(chatMsg.id, [...existingList, ...timeouts]);

                    const updatedHistories = { ...data.interactionHistories };
                    for (const [locId, msgs] of Object.entries(updatedHistories) as [string, HistoryMessage[]][]) {
                        const idx = msgs.findIndex(m => m.id === chatMsg.id);
                        if (idx !== -1) {
                            const cleanMsg = { ...msgs[idx] } as ChatMessage;
                            if (cleanMsg.activeToolActions) {
                                const cleanActive = { ...cleanMsg.activeToolActions };
                                delete cleanActive.scheduledResponses;
                                if (Object.keys(cleanActive).length === 0) delete cleanMsg.activeToolActions;
                                else cleanMsg.activeToolActions = cleanActive;
                            }
                            updatedHistories[locId] = [...msgs];
                            updatedHistories[locId][idx] = cleanMsg;
                        }
                    }
                    setInteractionData({ ...data, interactionHistories: updatedHistories });
                }
                break; 
            }
        }
    }, [addToast, setInteractionData]);

    useEffect(() => {
        const timeoutsMap = scheduledTimeoutsRef.current;
        const interactionData = getState().interactionData;
        if (!interactionData) {
            for (const timeouts of timeoutsMap.values()) for (const t of timeouts) clearTimeout(t);
            timeoutsMap.clear();
            return;
        }
        const activeMessageIds = new Set(getGlobalMessageHistory(interactionData).map(m => m.id));
        for (const [msgId, timeouts] of timeoutsMap.entries()) {
            if (!activeMessageIds.has(msgId)) {
                for (const t of timeouts) clearTimeout(t);
                timeoutsMap.delete(msgId);
            }
        }
    }, [getState]);

    useEffect(() => {
        const timeoutsMap = scheduledTimeoutsRef.current;
        return () => {
            for (const timeouts of timeoutsMap.values()) for (const t of timeouts) clearTimeout(t);
            timeoutsMap.clear();
        };
    }, []);

    const executeTurnPipeline = useCallback(async ({
        data, protagonistId, existingCharacterText = '', respondingCharacter,
        isProtagonistCharId, errorPrefix = 'Generation failed', lockAlreadyAcquired = false, prefillText = '',
        excludeFromSequence,
    }: GenerationTurnOptions & { prefillText?: string; excludeFromSequence?: Set<string> }) => {
        if (!lockAlreadyAcquired && !acquireLock()) return;
        if (!data.profile || !data.profile?.enableCharacterExpression) sentimentEngine.unload();

        const profile = data.profile;
        const narrationBehaviour = profile?.textGenerationBehaviourOnNarration ?? 'wait';

        if (narrationBehaviour === 'interrupt' && currentVoiceTrackerRef.current) {
            currentVoiceTrackerRef.current.stopImmediate();
            currentVoiceTrackerRef.current = null;
        } else if (narrationBehaviour === 'wait' && currentVoiceTrackerRef.current) {
            try { await currentVoiceTrackerRef.current.waitForPlaybackCompletion(); } 
            catch (e) { console.warn('[useChatPipeline] Waiting for previous voice playback failed:', e); } 
            finally {
                if (currentVoiceTrackerRef.current) {
                    currentVoiceTrackerRef.current.stopImmediate();
                    currentVoiceTrackerRef.current = null;
                }
            }
        }

        const promptBlocks = getActivePromptBlocks(data);
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

        const rawRespondingChar = respondingCharacter
            || data.participants.find(p => !isProtagonist(p.id))
            || data.participants[0]
            || currentState.localProtagonist;

        const respondingChar = allCharactersRef.current.find(c => c.id === rawRespondingChar?.id) || rawRespondingChar;

        streamingCharacterRef.current = respondingChar ?? null;
        streamingMessageIdRef.current = `gen-${respondingChar?.id || 'ai'}-${Date.now()}`;

        if (currentVoiceTrackerRef.current && narrationBehaviour !== 'continue') {
            currentVoiceTrackerRef.current.stopImmediate();
            currentVoiceTrackerRef.current = null;
        }

        const voiceTracker = new StreamingVoiceTracker(respondingChar, allCharactersRef.current);
        if (existingCharacterText) voiceTracker.seed(existingCharacterText);
        else if (prefillText) voiceTracker.seed(prefillText);
        currentVoiceTrackerRef.current = voiceTracker;
        
        await voiceTracker.start().catch(err => console.warn('[useChatPipeline] VoiceTracker start failed:', err));

        useGenerationStore.setState({ isLoading: true, streamingCharacter: respondingChar ?? null, streamingText: '' });

        try {
            requestTimestampsRef.current.push(Date.now());
            const metadata: RequestMetadata = {
                numberOfMessages: getGlobalMessageHistory(data).length,
                numberOfRequestsDuringTheLastHour: getRequestsLastHour(),
            };

            const interactionDataId = data.id || 'unknown';
            for (const participant of data.participants) {
                const charHistory = getLocalMessageHistory(data, participant, ['chat', 'whisper']) as TextMessage[];
                speculativeMarkovEngine.syncMessages(
                    charHistory.map(m => ({ textContent: m.textContent, lastUpdatedTimestamp: m.lastUpdatedTimestamp })),
                    participant.id, interactionDataId
                );
            }

            let turnResult: { interactionData: InteractionData; isCompleted: boolean; promptText?: string } | null = null;
            
            try {
                if (respondingCharacter) {
                    turnResult = await chatEngine.runDirectedTurn(
                        data, 
                        respondingChar, 
                        ctrl, 
                        promptBlocks, 
                        metadata, 
                        existingCharacterText, 
                        voiceTracker,
                        prefillText
                    );
                } else {
                    turnResult = await chatEngine.runTurn(
                        data, 
                        ctrl, 
                        promptBlocks, 
                        metadata, 
                        existingCharacterText, 
                        voiceTracker,
                        prefillText,
                        excludeFromSequence
                    );
                }
            } catch (e) {
                if ((e as Error).name === 'AbortError') turnResult = { interactionData: data, isCompleted: false };
                else throw e;
            }

            if (!turnResult) {
                if (!pendingPartialRef.current && streamingTextRef.current && respondingChar) {
                    pendingPartialRef.current = { text: streamingTextRef.current, character: respondingChar };
                }
                if (pendingPartialRef.current) {
                    const fd = await applyPendingPartial(data, protagonistId);
                    setInteractionData(fd);
                    broadcastNewMessages(preTurnCount, fd);
                    saveRawInteractionData(fd).catch(e => console.error('Failed to save partial on null result:', e));
                }
                return;
            }

            useGenerationStore.setState({ streamingText: '' });

            let ud = turnResult.interactionData;
            if (ud === data) ud = { ...ud, interactionHistories: { ...ud.interactionHistories }, lastUpdatedTimestamp: Date.now() };

            if (turnResult.promptText) {
                const currentModelId = useChatStore.getState().selectedModelId;
                if (currentModelId) lastTurnContextRef.current = { modelId: currentModelId, prompt: turnResult.promptText, metadata };
            }

            if (pendingPartialRef.current) {
                const fd = await applyPendingPartial(ud, protagonistId);
                setInteractionData(fd);
                broadcastNewMessages(preTurnCount, fd);
                saveRawInteractionData(fd).catch(e => console.error('Failed to save partial:', e));
                return;
            }

            if (getGlobalMessageHistory(ud).length <= preTurnCount) {
                const liveText = streamingTextRef.current;
                if (liveText && respondingChar) {
                    const currentLocId = getCurrentLocationId(ud, respondingChar) || 'global';
                    const fallbackMsg = createMessage(respondingChar, {
                        textContent: liveText,
                        interactionData: ud,
                    });
                    if (streamingMessageIdRef.current) fallbackMsg.id = streamingMessageIdRef.current;
                    const newHistories = { ...ud.interactionHistories };
                    const currentLocMessages = newHistories[currentLocId] || [];
                    newHistories[currentLocId] = [...currentLocMessages, fallbackMsg];
                    ud = { ...ud, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
                }
            }

            const preToolData = ud;
            ud = processPendingToolActions(ud, allCharactersRef.current, { onToast: addToast });
            broadcastToolStateChanges(preToolData, ud, onStateBroadcastRef.current);

            if (getGlobalMessageHistory(ud).length > preTurnCount) {
                setInteractionData(ud);
                broadcastNewMessages(preTurnCount, ud);
                saveRawInteractionData(ud).catch(e => console.error('Failed to save after turn:', e));
                extractAndScheduleResponses(ud);

                const history = getGlobalMessageHistory(ud);
                const lastMsg = history[history.length - 1];
                const text = hasTextContent(lastMsg) ? lastMsg.textContent : '';

                // ─── TOOL EXECUTION AUDITOR & AUTO-RESUME ─────────────────
                const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                const callRegex = new RegExp(`${escapeRegex(toolCallStartString)}[\\s\\S]*?${escapeRegex(toolCallEndString)}`, 'g');
                const resultRegex = new RegExp(`${escapeRegex(toolResultStartString)}[\\s\\S]*?${escapeRegex(toolResultEndString)}`, 'g');
                
                const calls = (text.match(callRegex) || []).length;
                const resultsInText = (text.match(resultRegex) || []).length;
                
                const resultsInArray = (hasTextContent(lastMsg) && (lastMsg as ChatMessage).toolExecutionResults) 
                    ? (lastMsg as ChatMessage).toolExecutionResults!.length 
                    : 0;
                
                const totalResults = resultsInText + resultsInArray;
                const hasUnexecutedTools = calls > totalResults;
                
                const lastCallStart = text.lastIndexOf(toolCallStartString);
                const lastCallEnd = text.lastIndexOf(toolCallEndString);
                const hasUnclosedCall = lastCallStart !== -1 && lastCallStart > lastCallEnd;

                const stripRegex = new RegExp(
                    `${escapeRegex(toolCallStartString)}[\\s\\S]*?${escapeRegex(toolCallEndString)}|` +
                    `${escapeRegex(toolResultStartString)}[\\s\\S]*?${escapeRegex(toolResultEndString)}`,
                    'g'
                );
                const narrativeText = text.replace(stripRegex, '');
                const isToolOnlyResponse = (calls > 0) && narrativeText.length === 0;

                let evaluation = evaluateAutoResumeSignals(ud.profile, text, autoResumeCountRef.current);
                
                if ((isToolOnlyResponse || hasUnexecutedTools || hasUnclosedCall) && !wasStoppedRef.current) {
                    evaluation = { ...evaluation, shouldResume: true };
                }

                if (evaluation.shouldResume && !wasStoppedRef.current) {
                    autoResumeCountRef.current += 1;
                    const injectedData = injectStopSignals(ud, evaluation.patternsToInject);
                    setInteractionData(injectedData);
                    saveRawInteractionData(injectedData).catch(e => console.error('Failed to save stop signals:', e));
                    autoResumeOnCutoff(injectedData, protagonistId);
                    return;
                }

                const isVoiceEnabledInProfile = profile?.narrateTexts 
                    ? Object.values(profile.narrateTexts).some(v => v === true) 
                    : false;

                if (voiceTracker && narrationBehaviour === 'wait' && isVoiceEnabledInProfile) {
                    try {
                        await voiceTracker.waitForPlaybackCompletion();
                    } catch (e) {
                        console.warn('[useChatPipeline] Voice playback completion error:', e);
                    }
                }

                runSummarization({ data: ud, character: respondingChar, promptBlocks, setInteractionData, addToast });
            } else {
                const enableAmbientNarration = ud?.profile?.enableAmbientNarration ?? false;
                if (enableAmbientNarration) {
                    const ad = await generateAmbientNarration(ud, ctrl.signal, promptBlocks, protagonistId);
                    const sd = ad || ud;
                    setInteractionData(sd);

                    const currentLocId = getCurrentLocationId(sd, respondingChar) || 'global';
                    const locationMessages = sd.interactionHistories[currentLocId] || [];
                    const lastMsg = locationMessages[locationMessages.length - 1];

                    broadcastNewMessages(preTurnCount, sd);
                    saveRawInteractionData(sd).catch(e => console.error('Failed to save ambient narration:', e));

                    if (lastMsg && 'textContent' in lastMsg && lastMsg.textContent) {
                        if (narrationBehaviour === 'interrupt' && currentVoiceTrackerRef.current) {
                            currentVoiceTrackerRef.current.stopImmediate();
                            currentVoiceTrackerRef.current = null;
                        }

                        const baseChar = allCharactersRef.current[0] || sd.participants[0];
                        if (baseChar) {
                            const ambientTracker = new StreamingVoiceTracker(baseChar, allCharactersRef.current);
                            currentVoiceTrackerRef.current = ambientTracker;
                            const started = await ambientTracker.start().catch(() => false);
                            if (started) {
                                ambientTracker.feed(lastMsg.textContent);
                            }
                        }
                    }
                } else {
                    setInteractionData(ud);
                    broadcastNewMessages(preTurnCount, ud);
                    saveRawInteractionData(ud).catch(e => console.error('Failed to save data:', e));
                }
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error(`${errorPrefix}:`, e);
                addToast(`${errorPrefix}: ${(e as Error).message}`, 'error');
            }
            
            if (!pendingPartialRef.current && streamingTextRef.current && respondingChar) {
                pendingPartialRef.current = { text: streamingTextRef.current, character: respondingChar };
            }

            if (pendingPartialRef.current) {
                try {
                    const fd = await applyPendingPartial(data, protagonistId);
                    setInteractionData(fd);
                    broadcastNewMessages(preTurnCount, fd);
                    saveRawInteractionData(fd).catch(err => console.error('Failed to save partial on error catch:', err));
                } catch (partialErr) { console.error('Failed to apply pending partial on error:', partialErr); }
            }
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
            isSpeculatingRef.current = false;
            streamingCharacterRef.current = null;
            streamingMessageIdRef.current = null;

            resetStream();
            useGenerationStore.setState({ isLoading: false, streamingCharacter: null, streamingText: '' });
            releaseLock();

            if (pendingResumeRef.current) {
                const { messageId } = pendingResumeRef.current;
                pendingResumeRef.current = null;
                setTimeout(() => resumeGenerationRef.current?.(messageId), 0);
            } else if (pendingHostResponseRef.current && isMultiplayerClient) {
                pendingHostResponseRef.current = false;
                setTimeout(() => triggerHostResponseRef.current?.(), 0);
            } else {
                pendingHostResponseRef.current = false;
            }
        }
    }, [
        acquireLock, getState, isModelReadyForGeneration, addToast, releaseLock, resetStream, setStreamingState, 
        setStats, getRequestsLastHour, chatEngine, applyPendingPartial, setInteractionData, broadcastNewMessages,
        autoResumeOnCutoff, generateAmbientNarration, isMultiplayerClient, isSpeculatingRef, streamingTextRef, 
        extractAndScheduleResponses, getActivePromptBlocks, onStateBroadcastRef, allCharactersRef, isAtBottomRef
    ]);

    const triggerDelayedResponse = useCallback(async (characterId: string, thought?: string) => {
        const currentState = getState();
        const currentData = currentState.interactionData;
        if (!currentData || isLoadingRef.current) return;
        
        const rawCharacter = currentData.participants.find(p => p.id === characterId);
        if (!rawCharacter) return;

        if (!acquireLock()) return;
        
        const internalThoughtString = thought ? ` Your internal thought was: "${thought}".` : '';
        const prefillText = `${toolResultStartString}System Note: You scheduled this follow-up earlier.${internalThoughtString}${toolResultEndString} `
        
        const voiceTracker = new StreamingVoiceTracker(rawCharacter, allCharactersRef.current);
        if (prefillText) voiceTracker.seed(prefillText);
        await voiceTracker.start().catch(() => {});

        useGenerationStore.setState({ isLoading: true, streamingCharacter: rawCharacter, streamingText: '' });

        try {
            const promptBlocks = getActivePromptBlocks(currentData);
            await chatEngine.runDirectedTurn(
                currentData, 
                rawCharacter, 
                abortControllerRef.current || new AbortController(), 
                promptBlocks, 
                undefined, 
                undefined, 
                voiceTracker, 
                prefillText
            );

            useGenerationStore.setState({ streamingText: '' });
            
        } catch (e) {
            console.error('Delayed response error:', e);
        } finally {
            useGenerationStore.setState({ isLoading: false, streamingCharacter: null, streamingText: '' });
            releaseLock();
        }
    }, [getState, acquireLock, releaseLock, chatEngine, isLoadingRef, getActivePromptBlocks, allCharactersRef]);

    useEffect(() => { triggerDelayedResponseRef.current = triggerDelayedResponse; }, [triggerDelayedResponse]);

    const triggerHostResponse = useCallback(async () => {
        const currentState = getState();
        if (!currentState.interactionData || !currentState.localProtagonist) return;
        if (!acquireLock()) { pendingHostResponseRef.current = true; return; }

        const allProtagonistIds = new Set(currentState.interactionData.protagonistIds || [currentState.localProtagonist.id]);
        
        await executeTurnPipeline({
            data: currentState.interactionData,
            protagonistId: currentState.localProtagonist.id,
            isProtagonistCharId: (id: string) => allProtagonistIds.has(id),
            errorPrefix: 'Host response failed',
            lockAlreadyAcquired: true,
        });
    }, [getState, acquireLock, executeTurnPipeline]);

    useEffect(() => { triggerHostResponseRef.current = triggerHostResponse; }, [triggerHostResponse]);

    useEffect(() => {
        if (isMultiplayerClient) return;
        const unsubscribe = MultiplayerEvents.on('peerMessageReceived', async () => { await triggerHostResponse(); });
        return unsubscribe;
    }, [isMultiplayerClient, triggerHostResponse]);

    const stopGeneration = useCallback(() => {
        wasStoppedRef.current = true;
        isSpeculatingRef.current = false;

        const resumeId = resumingMessageIdRef.current;
        const currentData = getState().interactionData;

        const t = streamingTextRef.current;
        const c = useGenerationStore.getState().streamingCharacter || streamingCharacterRef.current;

        abortControllerRef.current?.abort();
        abortControllerRef.current = null;

        if (currentVoiceTrackerRef.current) {
            currentVoiceTrackerRef.current.stopImmediate();
            currentVoiceTrackerRef.current = null;
        }

        if (resumeId && currentData) {
            const streamedText = t || resumingExistingTextRef.current;
            const updatedHistories = { ...currentData.interactionHistories };
            for (const [locId, msgs] of Object.entries(updatedHistories) as [string, HistoryMessage[]][]) {
                const idx = msgs.findIndex((m: HistoryMessage) => m.id === resumeId && hasTextContent(m));
                if (idx !== -1) {
                    const targetMsg = msgs[idx] as TextMessage;
                    const textContent = streamedText || targetMsg.textContent;
                    const paragraphs = (textContent.match(/\n\n/g) || []).length + 1;

                    updatedHistories[locId] = [...msgs];
                    updatedHistories[locId][idx] = { ...targetMsg, textContent, lastUpdatedTimestamp: Date.now() } as TextMessage;

                    if (paragraphs > 0) consumeChatStaminaForMessage(updatedHistories[locId][idx], paragraphs);
                    break;
                }
            }

            const updatedData = { ...currentData, interactionHistories: updatedHistories, lastUpdatedTimestamp: Date.now() };
            setChatState({ interactionData: updatedData });
            setGenerationState({ streamingCharacter: null, streamingText: '', isLoading: false, latency: 0, timeToFirstToken: 0 });
            saveRawInteractionData(updatedData).catch(e => console.error('Failed to save on stop:', e));
            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';
            pendingPartialRef.current = null;
        } else {
            pendingPartialRef.current = (t && c) ? { text: t, character: c } : null;
            setGenerationState({ streamingCharacter: null, streamingText: '', isLoading: false, latency: 0, timeToFirstToken: 0 });
        }

        useGenerationStore.setState({ isLoading: false, streamingCharacter: null, streamingText: '' });
        isLoadingRef.current = false;
        resetStream();
        streamingCharacterRef.current = null;
        streamingMessageIdRef.current = null;
    }, [resetStream, getState, setChatState, setGenerationState, streamingTextRef, isLoadingRef, isSpeculatingRef]);

    const resumeGeneration = useCallback(async (messageId: string) => {
        if (isMultiplayerClient) { addToast('Generation is handled by the host.', 'info'); return; }

        const currentInteractionData = getState().interactionData;
        if (!currentInteractionData) return;
        if (!currentInteractionData.profile || !currentInteractionData.profile?.enableCharacterExpression) sentimentEngine.unload();

        const profile = currentInteractionData.profile;
        const narrationBehaviour = profile?.textGenerationBehaviourOnNarration ?? 'wait';

        if (narrationBehaviour === 'interrupt' && currentVoiceTrackerRef.current) {
            currentVoiceTrackerRef.current.stopImmediate();
            currentVoiceTrackerRef.current = null;
        } else if (narrationBehaviour === 'wait' && currentVoiceTrackerRef.current) {
            try { await currentVoiceTrackerRef.current.waitForPlaybackCompletion(); } 
            catch (e) { console.warn('[useChatPipeline] Waiting for previous voice playback failed in resume:', e); } 
            finally {
                if (currentVoiceTrackerRef.current) {
                    currentVoiceTrackerRef.current.stopImmediate();
                    currentVoiceTrackerRef.current = null;
                }
            }
        }

        const history = getGlobalMessageHistory(currentInteractionData);
        const msg = history.find(m => m.id === messageId);
        if (!msg || !hasTextContent(msg)) { addToast('Message not found or has no text content.', 'error'); return; }

        if (isLoadingRef.current) {
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
            await new Promise(r => setTimeout(r, 100));
        }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        
        const currentState = getState();
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const existingText = msg.textContent;
        const rawChar = msg.character;
        const char = allCharactersRef.current.find(c => c.id === rawChar?.id) || rawChar;

        if (currentVoiceTrackerRef.current && narrationBehaviour !== 'continue') {
            currentVoiceTrackerRef.current.stopImmediate();
            currentVoiceTrackerRef.current = null;
        }

        const voiceTracker = new StreamingVoiceTracker(char, allCharactersRef.current);
        if (existingText) voiceTracker.seed(existingText);
        currentVoiceTrackerRef.current = voiceTracker;
        
        await voiceTracker.start().catch(err => console.warn('[useChatPipeline] Resume VoiceTracker start failed:', err));

        resumingMessageIdRef.current = messageId;
        resumingExistingTextRef.current = existingText;
        wasStoppedRef.current = false;
        isSpeculatingRef.current = false;
        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;

        streamingCharacterRef.current = char;
        streamingMessageIdRef.current = messageId;
        streamingTextRef.current = existingText;

        useGenerationStore.setState({ isLoading: true, streamingCharacter: char, streamingText: existingText });
        setStreamingText(existingText);
        setStreamingState(char, existingText);
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const promptBlocks = getActivePromptBlocks(currentInteractionData);
            const result = await chatEngine.handleServerResponse(
                currentInteractionData, char, promptBlocks, ctrl.signal,
                throttledSetStreamingTextWithBroadcast, undefined, existingText, undefined, voiceTracker,
                undefined,
                messageId
            );

            useGenerationStore.setState({ streamingText: '' });

            const liveStreamedText = streamingTextRef.current || existingText;
            const dataToFinalize = result?.interactionData || currentInteractionData;
            const finalized = finalizeMessageById(dataToFinalize, messageId, wasStoppedRef.current, result?.rawText || liveStreamedText);
            const finalizedMsg = getGlobalMessageHistory(finalized).find(m => m.id === messageId);
            if (finalizedMsg) onMessageBroadcastRef.current?.(finalizedMsg);

            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';

            const finalText = finalizedMsg && hasTextContent(finalizedMsg) ? finalizedMsg.textContent : liveStreamedText;
            let evaluation = evaluateAutoResumeSignals(finalized.profile, finalText, autoResumeCountRef.current);
            let dataToSave = finalized;

            const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            const callRegex = new RegExp(`${escapeRegex(toolCallStartString)}[\\s\\S]*?${escapeRegex(toolCallEndString)}`, 'g');
            const resultRegex = new RegExp(`${escapeRegex(toolResultStartString)}[\\s\\S]*?${escapeRegex(toolResultEndString)}`, 'g');
            
            const calls = (finalText.match(callRegex) || []).length;
            const resultsInText = (finalText.match(resultRegex) || []).length;
            
            const resultsInArray = (finalizedMsg && hasTextContent(finalizedMsg) && (finalizedMsg as ChatMessage).toolExecutionResults) 
                ? (finalizedMsg as ChatMessage).toolExecutionResults!.length 
                : 0;
            
            const totalResults = resultsInText + resultsInArray;
            
            const hasUnexecutedTools = calls > totalResults;
            
            const lastCallStart = finalText.lastIndexOf(toolCallStartString);
            const lastCallEnd = finalText.lastIndexOf(toolCallEndString);
            const hasUnclosedCall = lastCallStart !== -1 && lastCallStart > lastCallEnd;

            const stripRegex = new RegExp(
                `${escapeRegex(toolCallStartString)}[\\s\\S]*?${escapeRegex(toolCallEndString)}|` +
                `${escapeRegex(toolResultStartString)}[\\s\\S]*?${escapeRegex(toolResultEndString)}`,
                'g'
            );
            const narrativeText = finalText.replace(stripRegex, '');
            const isToolOnlyResponse = (calls > 0) && narrativeText.length === 0;

            if ((isToolOnlyResponse || hasUnexecutedTools || hasUnclosedCall) && !wasStoppedRef.current) {
                evaluation = { ...evaluation, shouldResume: true };
            }

            if (evaluation.shouldResume && !wasStoppedRef.current) {
                autoResumeCountRef.current += 1;
                dataToSave = injectStopSignals(finalized, evaluation.patternsToInject);
                setChatState({ interactionData: dataToSave });
                setGenerationState({ streamingCharacter: null, streamingText: '' });
                saveRawInteractionData(dataToSave).catch(e => console.error('Failed to save on resume stop signals:', e));
                setTimeout(() => {
                    const allProtagonistIds = new Set(dataToSave.protagonistIds || [char.id]);
                    const reMarkedId = findLastAIMessageId(dataToSave, allProtagonistIds);
                    if (reMarkedId) resumeGenerationRef.current?.(reMarkedId);
                }, 0);
                return;
            }

            setChatState({ interactionData: dataToSave });
            setGenerationState({ streamingCharacter: null, streamingText: '' });
            saveRawInteractionData(dataToSave).catch(e => console.error('Failed to save on resume completion:', e));
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

            resetStream();
            useGenerationStore.setState({ isLoading: false, streamingCharacter: null, streamingText: '' });
            releaseLock();
        }
    }, [
        getState, setChatState, setGenerationState, isLoadingRef, acquireLock, isModelReadyForGeneration, setStreamingText, streamingTextRef, 
        addToast, releaseLock, chatEngine, throttledSetStreamingTextWithBroadcast, setStreamingState, setStats, 
        isMultiplayerClient, isSpeculatingRef, resetStream, getActivePromptBlocks, onMessageBroadcastRef, allCharactersRef, isAtBottomRef
    ]);

    useEffect(() => { resumeGenerationRef.current = resumeGeneration; }, [resumeGeneration]);

    const regenerateFromMessage = useCallback(async (messageId: string, protagonistIds: string[]) => {
        if (isMultiplayerClient) { addToast('Generation is handled by the host.', 'info'); return; }

        const currentInteractionData = getState().interactionData;
        if (!currentInteractionData) { addToast('Chat data missing.', 'error'); return; }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }

        const protagonistIdSet = new Set(protagonistIds);
        const sortedHistory = getGlobalMessageHistory(currentInteractionData);
        const ti = sortedHistory.findIndex(m => m.id === messageId);
        if (ti === -1) { addToast('Message not found.', 'error'); releaseLock(); return; }

        const tm = sortedHistory[ti];
        const isProtagonistMessage = protagonistIdSet.has(tm.character.id);

        let lastProtagonistIdx = -1;
        for (let i = ti - 1; i >= 0; i--) {
            if (protagonistIdSet.has(sortedHistory[i].character.id)) {
                lastProtagonistIdx = i;
                break;
            }
        }

        const keptAIs = new Set<string>();
        if (!isProtagonistMessage && lastProtagonistIdx !== -1) {
            for (let i = lastProtagonistIdx + 1; i < ti; i++) {
                if (!protagonistIdSet.has(sortedHistory[i].character.id)) {
                    keptAIs.add(sortedHistory[i].character.id);
                }
            }
        }

        const trimIdx = isProtagonistMessage ? ti + 1 : ti;
        const toDelete = sortedHistory.slice(trimIdx);

        if (toDelete.length) {
            try { await Promise.all(toDelete.map(m => deleteRawMessage(m.id))); } 
            catch (e) { console.error('Delete failed:', e); }
        }

        const updatedHistories: Record<string, HistoryMessage[]> = {};
        for (const locId of Object.keys(currentInteractionData.interactionHistories || {})) {
            const msgs = currentInteractionData.interactionHistories[locId] || [];
            const keptMsgs = msgs.filter((m: { id: string }) => {
                const globalIdx = sortedHistory.findIndex(hm => hm.id === m.id);
                return globalIdx !== -1 && globalIdx < trimIdx;
            });
            updatedHistories[locId] = keptMsgs;
        }

        const td: InteractionData = { ...currentInteractionData, interactionHistories: updatedHistories, lastUpdatedTimestamp: Date.now() };
        setInteractionData(td);
        await saveRawInteractionData(td).catch(e => console.error('Failed to save trimmed chat before regeneration:', e));

        const primaryProtagonistId = protagonistIds[0] ?? '';

        if (isProtagonistMessage) {
            await executeTurnPipeline({
                data: td, protagonistId: primaryProtagonistId, 
                respondingCharacter: undefined, 
                isProtagonistCharId: (id: string) => protagonistIdSet.has(id), 
                errorPrefix: 'Regeneration failed', lockAlreadyAcquired: true,
            });
        } else {
            const forcedChar = td.participants.find(p => p.id === tm.character.id) || tm.character;
            
            await executeTurnPipeline({
                data: td, protagonistId: primaryProtagonistId, 
                respondingCharacter: forcedChar, 
                isProtagonistCharId: (id: string) => protagonistIdSet.has(id), 
                errorPrefix: 'Regeneration failed', lockAlreadyAcquired: true,
            });

            const currentDataAfterSniper = getState().interactionData;
            if (currentDataAfterSniper && !abortControllerRef.current?.signal.aborted) {
                await executeTurnPipeline({
                    data: currentDataAfterSniper, 
                    protagonistId: primaryProtagonistId,
                    respondingCharacter: undefined,
                    isProtagonistCharId: (id: string) => protagonistIdSet.has(id),
                    errorPrefix: 'Cascade failed',
                    lockAlreadyAcquired: true,
                    excludeFromSequence: keptAIs,
                });
            }
        }
    }, [getState, isMultiplayerClient, addToast, acquireLock, releaseLock, setInteractionData, executeTurnPipeline]);

    const startNewChat = useCallback((char: Character) => {
        const timeoutsMap = scheduledTimeoutsRef.current;
        for (const timeouts of timeoutsMap.values()) for (const t of timeouts) clearTimeout(t);
        timeoutsMap.clear();

        const c = createNewInteractionData(char);
        c.name = 'Untitled Session';
        setInteractionData(c);
        setSelectedCharacter(char);
        isAtBottomRef.current = true;
        setChatState({ sessionStartTimestamp: Date.now() } as any);
        speculativeMarkovEngine.clearSession(c.id);
    }, [setInteractionData, setSelectedCharacter, setChatState, isAtBottomRef]);

    return {
        executeTurnPipeline,
        triggerHostResponse,
        stopGeneration,
        resumeGeneration,
        regenerateFromMessage,
        startNewChat,
    };
}