// src/hooks/useChatSession.tsx
import { useRef, useCallback, useEffect } from 'react';
import { useChatState } from './useChatState';
import { useChatEngine } from './useChatEngine';
import { useChatUI } from './useChatUI';
import { useToast } from '../context/ToastContext';
import { createChatMessage, addMessageToInteractionData, convertIdsToDisplayNames, createNewInteractionData } from './chatLogic';
import { processPendingToolActions, executeTool, type ToolExecutionContext } from '../services/ToolExecutor';
import { parseSlashCommand } from '../services/ToolInvocationParser';
import { runSummarization } from '../services/SummarizationEngine';
import { consumeChatStaminaForMessage } from './characterLogic';
import { getCurrentLocationIndex, findLocationByRegex } from './locationLogic';
import { saveRawInteractionData, loadRawBudgetData } from '../storage/serverStorage';
import { useThrottledStream } from './useThrottledStream';
import { useCharacterResponseLock } from './useCharacterResponseLock';
import { useAmbientNarration } from './useAmbientNarration';
import { useSessionStore } from './useSessionStore';
import { localURL } from '../configurations';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import type { Character, Context, Location, AudioTrack, World, PromptBlock, Sampler, StopPattern, BudgetStrategy, Profile, InteractionData, ChatMessage, HistoryMessage, Memory, Extension } from '../types';

const engine = getLanguageModelEngine();

/** Tools that are valid without any arguments */
const NO_ARG_TOOLS = ['coin', 'date'];

/** Meta-tools that require administrator privileges for joiners */
const HOST_ONLY_TOOLS = ['administrator', 'creator', 'destroyer'];

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

/**
 * Find the last AI chat message ID for resumption.
 * Returns the message ID, or null if no suitable message found.
 */
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
    /** When true, this client is a multiplayer joiner and should not generate locally */
    isMultiplayerClient?: boolean;
    /** The character assigned to this client by the host. Used to lock message authoring. */
    joinProtagonist?: Character | null;
    /** All entity collections for tool execution context */
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
}

export function useChatSession(options?: UseChatSessionOptions) {
    const { addToast } = useToast();
    const onMessageBroadcastRef = useRef(options?.onMessageBroadcast);
    const isMultiplayerClient = options?.isMultiplayerClient ?? false;
    
    useEffect(() => { onMessageBroadcastRef.current = options?.onMessageBroadcast; }, [options?.onMessageBroadcast]);

    // LOCK: Keep the assigned multiplayer character in a ref so callbacks always use the locked identity
    const joinProtagonistRef = useRef(options?.joinProtagonist ?? null);
    useEffect(() => { joinProtagonistRef.current = options?.joinProtagonist ?? null; }, [options?.joinProtagonist]);

    // ─── Entity Collections (refs to avoid stale closures) ──────────
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

    const state = useChatState();
    const {
        setBudgetData, updateRunningModels, setNumberOfTokens,
        setInteractionData, setStreamingState, setStats,
        setCurrentCharacterExpression, setLastSelectedModelId,
        getState, setState, setActiveStrategy, setSelectedModel, setCurrentCharacter,
    } = state;

    // Direct Zustand selectors for stable effect dependencies
    const interactionData = useSessionStore(s => s.interactionData);
    const selectedModel = useSessionStore(s => s.selectedModel);
    const autonomousMode = useSessionStore(s => s.interactionData?.Profile?.autonomousMode ?? false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);
    const resumingMessageIdRef = useRef<string | null>(null);
    const resumingExistingTextRef = useRef<string>('');
    const isAtBottomRef = useRef(true);
    const wasStoppedRef = useRef(false);

    // Ref to hold resumeGeneration for use in autoResumeOnCutoff (breaks circular dependency)
    const resumeGenerationRef = useRef<(messageId: string, allPromptBlocks?: PromptBlock[]) => Promise<void>>(null);

    // Track the current streaming message ID for broadcast during streaming
    const streamingMessageIdRef = useRef<string | null>(null);
    const streamingCharacterRef = useRef<Character | null>(null);

    // ─── Lock Queueing Refs ──────────────────────────────────────────
    const pendingHostResponseRef = useRef(false);
    const triggerHostResponseRef = useRef<() => Promise<void>>(null);
    const pendingResumeRef = useRef<{messageId: string, allPromptBlocks?: PromptBlock[]} | null>(null);

    const ui = useChatUI(state.interactionData, state.isLoading, state.streamingText, isAtBottomRef);

    const chatEngine = useChatEngine({
        getState,
        setInteractionData,
        setStreamingState,
        setBudgetData,
        setStats,
        setCurrentCharacterExpression,
        setLastSelectedModelId,
        addToast,
    });

    const { throttledSetStreamingText, setStreamingText, streamingTextRef, resetStream } = useThrottledStream();
    const { acquireLock, releaseLock, isLoadingRef } = useCharacterResponseLock();
    const { generateAmbientNarration } = useAmbientNarration(setStreamingState, setStreamingText, streamingTextRef);

    // Wrapped throttled stream setter that also broadcasts partial messages
    const throttledSetStreamingTextWithBroadcast = useCallback((text: string) => {
        throttledSetStreamingText(text);
        const char = streamingCharacterRef.current;
        const msgId = streamingMessageIdRef.current;
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
    }, [throttledSetStreamingText]);

    // Load budget data once on mount
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

    // Fetch model status once on mount
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

    // Token counting — depends on interactionData changes only
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

    // Autonomous mode — depends on autonomousMode flag only
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

    // Auto-resume helper: finds last AI message and triggers resumeGeneration
    const autoResumeOnCutoff = useCallback((data: InteractionData, protagonistId: string, allPromptBlocks?: PromptBlock[]) => {
        const messageId = findLastAIMessageId(data, protagonistId);
        if (!messageId) return;

        // Use setTimeout to avoid re-entrancy issues with the current callback stack
        setTimeout(() => {
            resumeGenerationRef.current?.(messageId, allPromptBlocks);
        }, 0);
    }, []);

    // Helper to broadcast new messages added by a turn
    const broadcastNewMessages = useCallback((beforeCount: number, afterData: InteractionData) => {
        if (!onMessageBroadcastRef.current) return;
        const newMessages = afterData.interactionHistory.slice(beforeCount);
        for (const msg of newMessages) {
            onMessageBroadcastRef.current(msg);
        }
    }, []);

    /** Build the ToolExecutionContext from current refs */
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
        allExtensions: allExtensionsRef.current,
        addToast,
    }), [addToast]);

    const sendMessage = useCallback(async (text: string, allPromptBlocks: PromptBlock[] | undefined, files: File[] | undefined, frontCameraImageBase64: string | undefined) => {
        const currentState = getState();
        
        // LOCK: Force multiplayer clients to use their assigned protagonist, ignoring local UI state
        const activeCharacter = isMultiplayerClient 
            ? (joinProtagonistRef.current || currentState.currentCharacter)
            : currentState.currentCharacter;

        if (!currentState.interactionData || !activeCharacter || (!text.trim() && (!files || !files.length))) return;

        // ─── SLASH COMMAND DETECTION ───────────────────────────────
        const slashInvocation = parseSlashCommand(text);
        const isSlashCommand = !!(slashInvocation && !files?.length && !frontCameraImageBase64);

        if (isSlashCommand && slashInvocation) {
            // ─── GATE HOST-ONLY META-TOOLS FROM NON-ADMIN JOINERS ─────────────
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

            // ─── VALIDATE ARGS ──────────────────────────────────────
            if (!slashInvocation.args.trim() && !NO_ARG_TOOLS.includes(slashInvocation.toolType)) {
                addToast(`/${slashInvocation.toolType} requires arguments.`, 'error');
                return;
            }

            // ─── EXECUTE TOOL ────────────────────────────────────────
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

                // Use the raw mechanical display replacement directly
                slashMessage.textContent = toolResult.displayReplacement || toolResult.content || `[${slashInvocation.toolType}]`;

                const updatedData = addMessageToInteractionData(currentState.interactionData, slashMessage);
                setInteractionData(updatedData);
                await saveRawInteractionData(updatedData);

                if (isMultiplayerClient) {
                    onMessageBroadcastRef.current?.(slashMessage);
                }
            } catch (e) {
                console.error('Slash command failed:', e);
                addToast(`Command failed: ${(e as Error).message}`, 'error');
                releaseLock();
                return;
            }

            // ─── MULTIPLAYER: tool executed locally, host handles AI ─
            if (isMultiplayerClient) {
                releaseLock();
                return;
            }

            // ─── FALL THROUGH TO AI GENERATION ─────────────────────
            // Tool result is already in chat history. AI will see it and respond.
        }

        // ─── NORMAL MESSAGE OR POST-SLASH AI GENERATION ─────────────

        if (!isSlashCommand && !acquireLock()) { addToast('Already generating...', 'info'); return; }
        
        // Multiplayer clients only send the user message, host handles generation
        if (isMultiplayerClient && !isSlashCommand) {
            try {
                const convertFileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result as string); reader.onerror = error => reject(error); });
                const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;

                const chatMessage = createChatMessage(currentState.interactionData, activeCharacter, text, { files: encodedFiles, frontCameraImage: frontCameraImageBase64 });
                let td = addMessageToInteractionData(currentState.interactionData, chatMessage);

                // Broadcast user message to host
                onMessageBroadcastRef.current?.(chatMessage);

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
                await saveRawInteractionData(td);
            } finally {
                releaseLock();
            }
            return;
        }
        
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;
        wasStoppedRef.current = false;
        resetStream();
        setStreamingState(null, '');
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            // Get the latest interaction data (may have been updated by slash command)
            const latestState = getState();
            let td = latestState.interactionData!;

            // If NOT a slash command, add the user's text as a chat message
            if (!isSlashCommand) {
                const convertFileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result as string); reader.onerror = error => reject(error); });
                const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;

                const chatMessage = createChatMessage(td, activeCharacter, text, { files: encodedFiles, frontCameraImage: frontCameraImageBase64 });
                td = addMessageToInteractionData(td, chatMessage);

                // Broadcast user message
                onMessageBroadcastRef.current?.(chatMessage);

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
                await saveRawInteractionData(td);
            }

            // Set up streaming broadcast tracking
            const preTurnCount = td.interactionHistory.length;
            streamingCharacterRef.current = null;
            streamingMessageIdRef.current = null;

            const turnResult = await chatEngine.runTurn(td, ctrl, allPromptBlocks);
            const ud = turnResult.interactionData;

            if (pendingPartialRef.current) {
                const fd = await applyPendingPartial(ud, activeCharacter.id);
                await saveRawInteractionData(fd);
                setInteractionData(fd);
                broadcastNewMessages(preTurnCount, fd);
                return;
            }

            if (ud.interactionHistory.length > td.interactionHistory.length) {
                const processed = processPendingToolActions(ud, allCharactersRef.current, { onToast: addToast });

                await saveRawInteractionData(processed);
                setInteractionData(processed);

                // Broadcast finalized AI messages
                broadcastNewMessages(preTurnCount, processed);

                // Auto-resume if model cut off mid-generation
                if (!turnResult.isCompleted && !wasStoppedRef.current) {
                    autoResumeOnCutoff(processed, activeCharacter.id, allPromptBlocks);
                    return;
                }

                runSummarization({
                    data: processed,
                    setData: setInteractionData,
                    addToast,
                });

                const lm = processed.interactionHistory[processed.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== activeCharacter.id) {
                    ui.playVoice(lm.textContent, lm.character);
                }
            } else {
                // Check if ambient narration is enabled in the profile
                const enableAmbientNarration = td?.Profile?.enableAmbientNarration ?? false;
                
                if (enableAmbientNarration) {
                    const ad = await generateAmbientNarration(ud, ctrl.signal);
                    const sd = ad || ud;
                    await saveRawInteractionData(sd);
                    setInteractionData(sd);
                    broadcastNewMessages(preTurnCount, sd);
                } else {
                    await saveRawInteractionData(ud);
                    setInteractionData(ud);
                    broadcastNewMessages(preTurnCount, ud);
                }
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error('Send failed:', e);
                addToast(`Send failed: ${(e as Error).message}`, 'error');
            }
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
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
    }, [getState, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration, setStreamingState, setStats, setInteractionData, autoResumeOnCutoff, broadcastNewMessages, isMultiplayerClient, buildToolContext]);

    // Trigger host response when a peer sends a message
    const triggerHostResponse = useCallback(async () => {
        console.log('[MP] triggerHostResponse called');
        const currentState = getState();
        if (!currentState.interactionData || !currentState.currentCharacter) {
            console.log('[MP] triggerHostResponse: No interactionData or currentCharacter');
            return;
        }
        if (!acquireLock()) { 
            console.warn('[MP] Host: Already generating, queueing peer response'); 
            pendingHostResponseRef.current = true;
            return; 
        }
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { 
            console.log('[MP] triggerHostResponse: Model not ready');
            addToast('Model not ready.', 'error'); 
            releaseLock(); 
            return; 
        }

        console.log('[MP] triggerHostResponse: Starting generation...');
        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;
        wasStoppedRef.current = false;
        resetStream();
        setStreamingState(null, '');
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const td = currentState.interactionData;
            
            const preTurnCount = td.interactionHistory.length;
            streamingCharacterRef.current = null;
            streamingMessageIdRef.current = null;

            const turnResult = await chatEngine.runTurn(td, ctrl);
            const ud = turnResult.interactionData;

            if (pendingPartialRef.current) {
                const fd = await applyPendingPartial(ud, currentState.currentCharacter.id);
                await saveRawInteractionData(fd);
                setInteractionData(fd);
                broadcastNewMessages(preTurnCount, fd);
                return;
            }

            if (ud.interactionHistory.length > td.interactionHistory.length) {
                const processed = processPendingToolActions(ud, allCharactersRef.current, { onToast: addToast });

                await saveRawInteractionData(processed);
                setInteractionData(processed);

                broadcastNewMessages(preTurnCount, processed);

                if (!turnResult.isCompleted && !wasStoppedRef.current) {
                    autoResumeOnCutoff(processed, currentState.currentCharacter.id);
                    return;
                }

                runSummarization({
                    data: processed,
                    setData: setInteractionData,
                    addToast,
                });

                const lm = processed.interactionHistory[processed.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== currentState.currentCharacter?.id) {
                    ui.playVoice(lm.textContent, lm.character);
                }
            } else {
                const enableAmbientNarration = currentState.interactionData?.Profile?.enableAmbientNarration ?? false;
                
                if (enableAmbientNarration) {
                    const ad = await generateAmbientNarration(ud, ctrl.signal);
                    const sd = ad || ud;
                    await saveRawInteractionData(sd);
                    setInteractionData(sd);
                    broadcastNewMessages(preTurnCount, sd);
                } else {
                    await saveRawInteractionData(ud);
                    setInteractionData(ud);
                    broadcastNewMessages(preTurnCount, ud);
                }
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error('[MP] Host response failed:', e);
                addToast(`Host response failed: ${(e as Error).message}`, 'error');
            }
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
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
    }, [getState, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration, setStreamingState, setStats, setInteractionData, autoResumeOnCutoff, broadcastNewMessages]);

    const sendActionAndGetResponse = useCallback(async (actionText: string, _targetChar: Character, protagonist: Character) => {
        const currentState = getState();
        if (!currentState.interactionData) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        
        const activeProtagonist = isMultiplayerClient 
            ? (joinProtagonistRef.current || protagonist) 
            : protagonist;

        if (isMultiplayerClient) {
            try {
                const chatMessage = createChatMessage(currentState.interactionData, activeProtagonist, actionText);
                const td = addMessageToInteractionData(currentState.interactionData, chatMessage);

                onMessageBroadcastRef.current?.(chatMessage);

                setInteractionData(td);
                await saveRawInteractionData(td);
            } finally {
                releaseLock();
            }
            return;
        }
        
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;
        wasStoppedRef.current = false;
        resetStream();
        setStreamingState(null, '');
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const chatMessage = createChatMessage(currentState.interactionData, protagonist, actionText);
            const td = addMessageToInteractionData(currentState.interactionData, chatMessage);

            onMessageBroadcastRef.current?.(chatMessage);

            setInteractionData(td);
            await saveRawInteractionData(td);

            const preTurnCount = td.interactionHistory.length;
            streamingCharacterRef.current = null;
            streamingMessageIdRef.current = null;

            const turnResult = await chatEngine.runTurn(td, ctrl);
            const ud = turnResult.interactionData;

            if (pendingPartialRef.current) {
                const fd = await applyPendingPartial(ud, protagonist.id);
                await saveRawInteractionData(fd);
                setInteractionData(fd);
                broadcastNewMessages(preTurnCount, fd);
                return;
            }

            if (ud.interactionHistory.length > td.interactionHistory.length) {
                const processed = processPendingToolActions(ud, allCharactersRef.current, { onToast: addToast });
                await saveRawInteractionData(processed);
                setInteractionData(processed);

                broadcastNewMessages(preTurnCount, processed);

                if (!turnResult.isCompleted && !wasStoppedRef.current) {
                    autoResumeOnCutoff(processed, protagonist.id);
                    return;
                }

                runSummarization({ data: processed, setData: setInteractionData, addToast });

                const lm = processed.interactionHistory[processed.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== protagonist.id) {
                    ui.playVoice(lm.textContent, lm.character);
                }
            } else {
                const enableAmbientNarration = currentState.interactionData?.Profile?.enableAmbientNarration ?? false;
                
                if (enableAmbientNarration) {
                    const ad = await generateAmbientNarration(ud, ctrl.signal);
                    const sd = ad || ud;
                    await saveRawInteractionData(sd);
                    setInteractionData(sd);
                    broadcastNewMessages(preTurnCount, sd);
                } else {
                    await saveRawInteractionData(ud);
                    setInteractionData(ud);
                    broadcastNewMessages(preTurnCount, ud);
                }
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error('Action failed:', e);
                addToast(`Action failed: ${(e as Error).message}`, 'error');
            }
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
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
    }, [getState, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration, setStreamingState, setStats, setInteractionData, autoResumeOnCutoff, broadcastNewMessages, isMultiplayerClient]);

    const stopGeneration = useCallback(() => {
        wasStoppedRef.current = true;

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
            pendingPartialRef.current = (t?.trim() && c) ? { text: t, character: c } : null;
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
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;

        streamingCharacterRef.current = char;
        streamingMessageIdRef.current = messageId;

        setStreamingText(existingText);
        streamingTextRef.current = existingText;
        setStreamingState(char, existingText);
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

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

            await saveRawInteractionData(finalized);

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
    }, [getState, setState, isLoadingRef, acquireLock, isModelReadyForGeneration, setStreamingText, streamingTextRef, addToast, releaseLock, chatEngine, throttledSetStreamingTextWithBroadcast, ui, setStreamingState, setStats, isMultiplayerClient]);

    useEffect(() => {
        resumeGenerationRef.current = resumeGeneration;
    }, [resumeGeneration]);
    
    useEffect(() => {
        triggerHostResponseRef.current = triggerHostResponse;
    }, [triggerHostResponse]);

    const regenerateFromMessage = useCallback(async (messageId: string, protagonists: Character[], allPromptBlocks?: PromptBlock[]) => {
        if (isMultiplayerClient) {
            addToast('Generation is handled by the host.', 'info');
            return;
        }
        
        const currentInteractionData = getState().interactionData;
        if (!currentInteractionData) { addToast('Chat data missing.', 'error'); return; }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        const currentState = getState();
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const protagonistIds = new Set(protagonists.map(p => p.id));

        const history = currentInteractionData.interactionHistory;
        const ti = history.findIndex(m => m.id === messageId);
        if (ti === -1) { addToast('Message not found.', 'error'); releaseLock(); return; }
        const tm = history[ti];
        const isProtagonistMessage = protagonistIds.has(tm.character.id);
        let trimIdx = ti;
        if (isProtagonistMessage) trimIdx = trimIdx + 1;
        const toDelete = history.slice(trimIdx);
        if (toDelete.length) try { await Promise.all(toDelete.map(m => import('../storage/serverStorage').then(s => s.deleteRawInteractionMessage(m.id)))); } catch (e) { console.error('Delete failed:', e); }

        const td: InteractionData = { ...currentInteractionData, interactionHistory: history.slice(0, trimIdx), lastUpdatedTimestamp: Date.now() };
        setInteractionData(td);
        await saveRawInteractionData(td);

        resetStream();
        setStreamingState(null, '');
        setStats({ latency: 0, timeToFirstToken: 0 });
        wasStoppedRef.current = false;
        isAtBottomRef.current = true;

        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        const preCount = td.interactionHistory.length;

        streamingCharacterRef.current = null;
        streamingMessageIdRef.current = null;

        try {
            const turnResult = await chatEngine.runTurn(td, ctrl, allPromptBlocks);
            const ud = turnResult.interactionData;
            const primaryProtagonistId = protagonists[0]?.id ?? '';
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, primaryProtagonistId); await saveRawInteractionData(fd); setInteractionData(fd); broadcastNewMessages(preCount, fd); return; }

            if (ud.interactionHistory.length > preCount) {
                const processed = processPendingToolActions(ud, allCharactersRef.current, { onToast: addToast });

                await saveRawInteractionData(processed);
                setInteractionData(processed);

                broadcastNewMessages(preCount, processed);

                if (!turnResult.isCompleted && !wasStoppedRef.current) {
                    autoResumeOnCutoff(processed, primaryProtagonistId, allPromptBlocks);
                    return;
                }

                runSummarization({
                    data: processed,
                    setData: setInteractionData,
                    addToast,
                });

                const lm = processed.interactionHistory[processed.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && !protagonistIds.has(lm.character.id)) ui.playVoice(lm.textContent, lm.character);
            } else {
                const enableAmbientNarration = currentState.interactionData?.Profile?.enableAmbientNarration ?? false;
                
                if (enableAmbientNarration) {
                    const ad = await generateAmbientNarration(ud, ctrl.signal);
                    const sd = ad || ud;
                    await saveRawInteractionData(sd);
                    setInteractionData(sd);
                    broadcastNewMessages(preCount, sd);
                } else {
                    await saveRawInteractionData(ud);
                    setInteractionData(ud);
                    broadcastNewMessages(preCount, ud);
                }
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Regen failed:', e); addToast(`Regen error: ${(e as Error).message}`, 'error'); } }
        finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
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
    }, [getState, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration, setInteractionData, setStreamingState, setStats, autoResumeOnCutoff, broadcastNewMessages, isMultiplayerClient]);

    const startNewChat = useCallback((char: Character) => {
        const c = createNewInteractionData(char);
        c.name = 'Untitled Chat';
        setInteractionData(c);
        setCurrentCharacter(char);
        isAtBottomRef.current = true;
        setState({ sessionStartTimestamp: Date.now() });
    }, [setInteractionData, setCurrentCharacter, setState]);

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