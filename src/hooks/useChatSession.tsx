// src/hooks/useChatSession.ts
import { useRef, useCallback, useEffect } from 'react';
import type { Character, InteractionData, BudgetStrategy, BudgetData, LanguageModel, PromptBlock } from '../types';
import { saveRawInteractionData, loadRawBudgetData } from './storage';
import { createChatMessage, addMessageToInteractionData, convertIdsToDisplayNames, createNewInteractionData, editInteractionMessageInInteractionData } from './chatLogic';
import { runTurnSequence } from '../services/InteractionOrchestrator';
import { AutonomousSimulationEngine } from '../services/AutonomousSimulationEngine';
import { editMessage, clearPartialFlag } from './messageLogic';
import { consumeChatStaminaForMessage } from './characterLogic';
import { getCurrentLocationIndex, findLocationByRegex } from '../hooks/locationLogic';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../context/ToastContext';
import { localURL } from '../configurations';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getAudioEngine } from '../services/AudioEngine';
import { useThrottledStream } from './useThrottledStream';
import { useCharacterResponseLock } from './useCharacterResponseLock';
import { useAmbientNarration } from './useAmbientNarration';
import { useCharacterVoice } from './useCharacterVoice';
import { useMemoryTrigger } from './useMemoryTrigger';
import { useCharacterResponse } from './useCharacterResponse';
import { runSummarization } from '../services/SummarizationEngine';
import { useSessionStore } from '../store/useSessionStore';

const engine = getLanguageModelEngine();

type RunningModelStatus = Record<string, { isRunning: boolean; port?: number }>;
type StatsState = { numberOfCacheInvalidations: number; numberOfRequests: number; totalCost: number; costWithoutCacheMisses: number };

export function useChatSession() {
    // ─── Store selectors (individual primitives to avoid infinite loop) ─
    const interactionData = useSessionStore(s => s.interactionData);
    const currentCharacter = useSessionStore(s => s.currentCharacter);
    const streamingCharacter = useSessionStore(s => s.streamingCharacter);
    const currentCharacterExpression = useSessionStore(s => s.currentCharacterExpression);
    const latency = useSessionStore(s => s.latency);
    const timeToFirstToken = useSessionStore(s => s.timeToFirstToken);
    const activeStrategy = useSessionStore(s => s.activeStrategy);
    const selectedModel = useSessionStore(s => s.selectedModel);
    const numberOfCacheInvalidations = useSessionStore(s => s.numberOfCacheInvalidations);
    const numberOfRequests = useSessionStore(s => s.numberOfRequests);
    const totalCost = useSessionStore(s => s.totalCost);
    const costWithoutCacheMisses = useSessionStore(s => s.costWithoutCacheMisses);
    const numberOfTokens = useSessionStore(s => s.numberOfTokens);
    const budgetData = useSessionStore(s => s.budgetData);
    const isLoading = useSessionStore(s => s.isLoading);
    const streamingText = useSessionStore(s => s.streamingText);

    // ─── Setters (write directly to store) ──────────────────────────
    const setInteractionData = useCallback((data: InteractionData | null) => {
        useSessionStore.setState({ interactionData: data });
        if (!data) useSessionStore.setState({ numberOfTokens: 0 });
    }, []);

    const setCurrentCharacter = useCallback((char: Character | null) => {
        useSessionStore.setState({ currentCharacter: char });
    }, []);

    const setStreamingCharacter = useCallback((char: Character | null) => {
        useSessionStore.setState({ streamingCharacter: char });
    }, []);

    const setCurrentCharacterExpression = useCallback((expr: string) => {
        useSessionStore.setState({ currentCharacterExpression: expr });
    }, []);

    const setLatency = useCallback((speed: number) => {
        useSessionStore.setState({ latency: speed });
    }, []);

    const setTimeToFirstToken = useCallback((time: number) => {
        useSessionStore.setState({ timeToFirstToken: time });
    }, []);

    const setActiveStrategy = useCallback((strategy: BudgetStrategy | null) => {
        useSessionStore.setState({ activeStrategy: strategy });
    }, []);

    const setSelectedModel = useCallback((model: LanguageModel | null) => {
        useSessionStore.setState({ selectedModel: model });
    }, []);

    const setRunningModelsMap = useCallback((models: RunningModelStatus) => {
        useSessionStore.setState({ runningModels: models });
        // Keep engine's running models in sync so it can resolve runtime ports
        engine.setRunningModels(models);
    }, []);

    const setStats = useCallback((newStats: StatsState | ((prev: StatsState) => StatsState)) => {
        useSessionStore.setState(prev => {
            const current: StatsState = {
                numberOfCacheInvalidations: prev.numberOfCacheInvalidations,
                numberOfRequests: prev.numberOfRequests,
                totalCost: prev.totalCost,
                costWithoutCacheMisses: prev.costWithoutCacheMisses,
            };
            const next = typeof newStats === 'function' ? newStats(current) : newStats;
            return next;
        });
    }, []);

    const setNumberOfTokens = useCallback((count: number) => {
        useSessionStore.setState({ numberOfTokens: count });
    }, []);

    const setBudgetData = useCallback((data: BudgetData | null) => {
        useSessionStore.setState({ budgetData: data });
    }, []);

    // ─── Refs (only genuine imperative handles) ─────────────────────
    const abortControllerRef = useRef<AbortController | null>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const isProcessingSilentlyRef = useRef(false);
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);
    const isAtBottomRef = useRef(true);
    const previousExpressionRef = useRef<string>('neutral');
    const resumingMessageIdRef = useRef<string | null>(null);
    const resumingExistingTextRef = useRef<string>('');
    const activeStrategyIdRef = useRef<string | null>(null);
    const autonomousEngineRef = useRef(new AutonomousSimulationEngine());

    // ─── Extracted Hooks ─────────────────────────────────────────────
    const { throttledSetStreamingText, setStreamingText, streamingTextRef, resetStream } = useThrottledStream();
    const { acquireLock, releaseLock, isLoadingRef } = useCharacterResponseLock();
    const { generateAmbientNarration } = useAmbientNarration(setStreamingCharacter, setStreamingText, streamingTextRef);
    const { speakMessage } = useCharacterVoice();
    const { processMemoryTrigger } = useMemoryTrigger();
    const { handleServerResponse } = useCharacterResponse({
        setBudgetData,
        setStats,
        setLatency,
        setTimeToFirstToken,
        setCurrentCharacterExpression,
        previousExpressionRef,
        throttledSetStreamingText,
        streamingTextRef,
        processMemoryTrigger,
        addToast: useToast().addToast,
    });

    const { addToast } = useToast();

    // ─── Mount Effects ───────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const bd = await loadRawBudgetData();
                if (bd) setBudgetData(bd);
            } catch (e) { console.warn('Failed to load budget data:', e); }
        })();
    }, [setBudgetData]);

    useEffect(() => {
        const handler = (event: Event) => {
            const updated = (event as CustomEvent<BudgetData | null>).detail;
            setBudgetData(updated);
        };
        window.addEventListener('budget-data-updated', handler);
        return () => window.removeEventListener('budget-data-updated', handler);
    }, [setBudgetData]);

    useEffect(() => {
        (async () => {
            try {
                const response = await fetch(`${localURL}/models/status`);
                if (!response.ok) return;
                const data = await response.json();
                const status: Record<string, { isRunning: boolean; port?: number }> = {};
                for (const m of data.activeModels || []) status[m.id] = { isRunning: true, port: m.port };
                setRunningModelsMap(status);
            } catch (e) { addToast(`Failed to fetch models status: ${e}`); }
        })();
    }, [setRunningModelsMap, addToast]);

    // Sync engine context whenever selected model changes
    useEffect(() => {
        if (selectedModel) {
            engine.setContext(selectedModel);
        }
    }, [selectedModel]);

    useEffect(() => {
        if (!interactionData) return;
        let cancelled = false;
        (async () => {

            // Engine context is already set by the selectedModel sync effect above
            // Just count tokens using whatever model is currently active
            let total = 0;
            for (const m of interactionData.interactionHistory) {
                if (m.messageType === 'chat') total += await engine.countTokens(m.textContent);
            }
            if (!cancelled) setNumberOfTokens(total);
        })();
        return () => { cancelled = true; };
    }, [interactionData?.interactionHistory, interactionData, selectedModel, setNumberOfTokens]);

    // ─── Scroll Tracking ─────────────────────────────────────────────
    useEffect(() => {
        const el = chatHistoryRef.current; if (!el) return;
        const fn = () => { isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
        el.addEventListener('scroll', fn, { passive: true });
        return () => el.removeEventListener('scroll', fn);
    }, []);

    useEffect(() => {
        if (!isAtBottomRef.current) return;
        if (isLoading && streamingText && messageEndRef.current) messageEndRef.current.scrollIntoView({ behavior: 'auto' });
        else if (!isLoading && messageEndRef.current && interactionData?.interactionHistory.length) messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [streamingText, isLoading, interactionData?.interactionHistory.length]);

    // ─── Audio Engine ────────────────────────────────────────────────
    useEffect(() => {
        const audioEngine = getAudioEngine();
        audioEngine.startVolumeTicker();
        return () => {
            audioEngine.stopAll();
        };
    }, []);

    useEffect(() => {
        if (!interactionData) return;
        const audioEngine = getAudioEngine();

        // Apply global volume override from profile
        const profileVolume = interactionData.Profile?.volume ?? -1;
        audioEngine.setGlobalVolume(profileVolume);

        audioEngine.evaluate(interactionData);
    }, [interactionData]);

    // ─── Autonomous Simulation ───────────────────────────────────────
    useEffect(() => {
        const autonomousEngine = autonomousEngineRef.current;
        const autonomousEnabled = interactionData?.Profile?.autonomousMode ?? false;

        if (autonomousEnabled && interactionData) {
            const executor = async (d: InteractionData, c: Character, s: AbortSignal) => {
                resetStream();
                setStreamingCharacter(c);
                return handleServerResponse(d, c, s, throttledSetStreamingText, undefined, '');
            };

            const checkCanAct = () => !isLoadingRef.current && !abortControllerRef.current;

            autonomousEngine.start(
                executor,
                checkCanAct,
                () => useSessionStore.getState().interactionData,
                (data) => {
                    useSessionStore.setState({ interactionData: data });
                },
            );
        } else {
            autonomousEngine.stop();
        }

        return () => { autonomousEngine.stop(); };
    }, [interactionData?.Profile?.autonomousMode, handleServerResponse, throttledSetStreamingText, resetStream, setStreamingCharacter, interactionData, isLoadingRef]);

    // Pause autonomous simulation when tab is hidden
    useEffect(() => {
        const autonomousEngine = autonomousEngineRef.current;
        const handleVisibilityChange = () => {
            if (document.hidden) {
                autonomousEngine.stop();
            } else {
                // Re-start if autonomous mode is still enabled
                const data = useSessionStore.getState().interactionData;
                if (data?.Profile?.autonomousMode) {
                    const executor = async (d: InteractionData, c: Character, s: AbortSignal) => {
                        resetStream();
                        setStreamingCharacter(c);
                        return handleServerResponse(d, c, s, throttledSetStreamingText, undefined, '');
                    };
                    const checkCanAct = () => !isLoadingRef.current && !abortControllerRef.current;
                    autonomousEngine.start(
                        executor,
                        checkCanAct,
                        () => useSessionStore.getState().interactionData,
                        (data) => { useSessionStore.setState({ interactionData: data }); },
                    );
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [handleServerResponse, throttledSetStreamingText, resetStream, setStreamingCharacter, isLoadingRef]);

    // ─── Helpers ─────────────────────────────────────────────────────
    const isModelReadyForGeneration = useCallback((): boolean => {
        const m = useSessionStore.getState().selectedModel;
        if (!m) return false;
        if (m.apiKey) return true;
        const models = useSessionStore.getState().runningModels;
        return !!(m.id && models[m.id]?.port);
    }, []);

    const applyPendingPartial = useCallback(async (base: InteractionData, protagonistId: string): Promise<InteractionData> => {
        const p = pendingPartialRef.current; if (!p) return base;
        pendingPartialRef.current = null;
        const dt = convertIdsToDisplayNames(p.text, base);
        const h = base.interactionHistory;
        if (h.length > 0 && h[h.length - 1].character.id !== protagonistId) {
            const lastMsg = h[h.length - 1];
            if (lastMsg.messageType === 'chat') {
                const ph = [...h];
                ph[ph.length - 1] = { ...lastMsg, textContent: dt, isPartial: true };
                return { ...base, interactionHistory: ph, lastUpdatedTimestamp: Date.now() };
            }
        }
        return addMessageToInteractionData(base, createChatMessage(base, p.character, dt, { isPartial: true }));
    }, []);

    // ─── Public Actions ──────────────────────────────────────────────
    const updateRunningModels = useCallback((m: Record<string, { isRunning: boolean; port?: number }>) => setRunningModelsMap(m), [setRunningModelsMap]);

    const setActiveBudgetStrategy = useCallback((s: BudgetStrategy | null) => {
        const newId = s?.id ?? null;
        if (newId !== activeStrategyIdRef.current) activeStrategyIdRef.current = newId;
        setActiveStrategy(s);
    }, [setActiveStrategy]);

    const setSelectedGlobalModel = useCallback((m: LanguageModel | null) => setSelectedModel(m), [setSelectedModel]);

    const startNewChat = useCallback((char: Character) => {
        const c = createNewInteractionData(char);
        c.name = 'Untitled Chat';
        setInteractionData(c);
        setCurrentCharacter(char);
        isAtBottomRef.current = true;
        // Reset session timer for new chat
        useSessionStore.setState({ sessionStartTimestamp: Date.now() });
    }, [setInteractionData, setCurrentCharacter]);

    const stopGeneration = useCallback(() => {
        const t = streamingTextRef.current;
        const c = useSessionStore.getState().streamingCharacter;
        const resumeId = resumingMessageIdRef.current;
        const currentData = useSessionStore.getState().interactionData;

        if (resumeId && t && t.trim().length > 0 && currentData) {
            const updated = editInteractionMessageInInteractionData(currentData, resumeId, t);
            const idx = updated.interactionHistory.findIndex(m => m.id === resumeId);
            if (idx !== -1) {
                const paragraphs = (t.match(/\n\n/g) || []).length + 1;
                if (paragraphs > 0) consumeChatStaminaForMessage(updated.interactionHistory[idx], paragraphs);
                const withPartial = [...updated.interactionHistory];
                const targetMsg = withPartial[idx];
                if (targetMsg.messageType === 'chat') {
                    withPartial[idx] = { ...targetMsg, isPartial: true, lastUpdatedTimestamp: Date.now() };
                }
                setInteractionData({ ...updated, interactionHistory: withPartial, lastUpdatedTimestamp: Date.now() });
            }
            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';
            pendingPartialRef.current = null;
        } else {
            pendingPartialRef.current = (t?.trim() && c) ? { text: t, character: c } : null;
        }

        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        releaseLock();
        resetStream();
        setLatency(0);
    }, [releaseLock, resetStream, setLatency, setInteractionData, streamingTextRef]);

    const sendActionAndGetResponse = useCallback(async (actionText: string, targetChar: Character) => {
        const currentInteractionData = useSessionStore.getState().interactionData;
        const currentChar = useSessionStore.getState().currentCharacter;
        if (!currentInteractionData || !currentChar) return;
        if (isLoadingRef.current) { abortControllerRef.current?.abort(); abortControllerRef.current = null; await new Promise(r => setTimeout(r, 300)); }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!useSessionStore.getState().activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }
        const d = useSessionStore.getState().interactionData; if (!d) { releaseLock(); return; }

        // Initialize audio context on user gesture (browser autoplay policy)
        getAudioEngine().initialize();

        let ud = addMessageToInteractionData(d, createChatMessage(d, currentChar, actionText));

        const hasLocations = ud.locations && ud.locations.length > 0;
        if (hasLocations) {
            const protagonistMsg = ud.interactionHistory[ud.interactionHistory.length - 1];
            if (protagonistMsg && protagonistMsg.character.id === currentChar.id && protagonistMsg.messageType === 'chat') {
                const currentLoc = getCurrentLocationIndex(ud, currentChar);
                const regexLoc = findLocationByRegex(ud.locations, protagonistMsg.textContent, currentChar);
                const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                ud = { ...ud, interactionHistory: ud.interactionHistory.map((m, i) => i === ud.interactionHistory.length - 1 ? { ...m, locationIndex: finalLoc } : m) };
            }
        }

        await saveRawInteractionData(ud);
        setInteractionData(ud);

        await new Promise(r => setTimeout(r, 50));
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        resetStream();
        setStreamingCharacter(targetChar);
        setLatency(0); setTimeToFirstToken(0); isAtBottomRef.current = true;
        try {
            const result = await handleServerResponse(ud, targetChar, ctrl.signal, throttledSetStreamingText, undefined, '');
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(result || ud, currentChar.id); await saveRawInteractionData(fd); setInteractionData(fd); return; }
            if (result) {
                await saveRawInteractionData(result);
                setInteractionData(result);
                const lm = result.interactionHistory[result.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== currentChar?.id) speakMessage(lm.textContent, lm.character);
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') console.error('AI response failed:', e); }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [isLoadingRef, acquireLock, isModelReadyForGeneration, setInteractionData, resetStream, setStreamingCharacter, setLatency, setTimeToFirstToken, addToast, releaseLock, handleServerResponse, throttledSetStreamingText, applyPendingPartial, speakMessage]);

    const sendMessage = useCallback(async (text: string, files?: File[], allPromptBlocks?: PromptBlock[]) => {
        const currentInteractionData = useSessionStore.getState().interactionData;
        const currentChar = useSessionStore.getState().currentCharacter;
        if (!currentInteractionData || !currentChar || (!text.trim() && (!files || !files.length))) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!useSessionStore.getState().activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        // Initialize audio context on user gesture (browser autoplay policy)
        getAudioEngine().initialize();

        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        resetStream();
        setStreamingCharacter(null);
        setLatency(0); setTimeToFirstToken(0); isAtBottomRef.current = true;
        try {
            const convertFileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result as string); reader.onerror = error => reject(error); });
            const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;
            const chatMessage = createChatMessage(currentInteractionData, currentChar, text, { files: encodedFiles });
            let td = addMessageToInteractionData(currentInteractionData, chatMessage);

            const hasLocations = td.locations && td.locations.length > 0;
            if (hasLocations) {
                const protagonistMsg = td.interactionHistory[td.interactionHistory.length - 1];
                if (protagonistMsg && protagonistMsg.character.id === currentChar.id && protagonistMsg.messageType === 'chat') {
                    const currentLoc = getCurrentLocationIndex(td, currentChar);
                    const regexLoc = findLocationByRegex(td.locations, protagonistMsg.textContent, currentChar);
                    const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                    td = { ...td, interactionHistory: td.interactionHistory.map((m, i) => i === td.interactionHistory.length - 1 ? { ...m, locationIndex: finalLoc } : m) };
                }
            }

            setInteractionData(td);
            await saveRawInteractionData(td);

            const executor = async (d: InteractionData, c: Character, s: AbortSignal, ot: (t: string) => void) => {
                resetStream();
                setStreamingCharacter(c);
                return handleServerResponse(d, c, s, ot, undefined, '', allPromptBlocks);
            };
            const ud = await runTurnSequence(td, executor, ctrl, setStreamingCharacter, throttledSetStreamingText, setInteractionData);
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, currentChar.id); await saveRawInteractionData(fd); setInteractionData(fd); return; }
            if (ud.interactionHistory.length > td.interactionHistory.length) {
                await saveRawInteractionData(ud); setInteractionData(ud);
                runSummarization({
                    data: ud,
                    setData: setInteractionData,
                    addToast,
                    activeStrategy: useSessionStore.getState().activeStrategy,
                });
                const lm = ud.interactionHistory[ud.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== currentChar?.id) speakMessage(lm.textContent, lm.character);
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud; await saveRawInteractionData(sd); setInteractionData(sd);
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Send failed:', e); addToast(`Send failed: ${(e as Error).message}`, 'error'); } }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [handleServerResponse, addToast, isModelReadyForGeneration, acquireLock, releaseLock, generateAmbientNarration, speakMessage, applyPendingPartial, throttledSetStreamingText, resetStream, setStreamingCharacter, setInteractionData, setLatency, setTimeToFirstToken]);

    const resumeGeneration = useCallback(async (messageId: string, allPromptBlocks?: PromptBlock[]) => {
        const currentInteractionData = useSessionStore.getState().interactionData;
        if (!currentInteractionData) return;
        const msgIndex = currentInteractionData.interactionHistory.findIndex(m => m.id === messageId);
        if (msgIndex === -1) { addToast('Message not found.', 'error'); return; }
        const msg = currentInteractionData.interactionHistory[msgIndex];
        if (msg.messageType !== 'chat' || !msg.isPartial) { addToast('Not partial — use Regenerate.', 'info'); return; }
        if (isLoadingRef.current) { abortControllerRef.current?.abort(); abortControllerRef.current = null; await new Promise(r => setTimeout(r, 100)); }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        // Initialize audio context on user gesture (browser autoplay policy)
        getAudioEngine().initialize();

        const existingText = msg.textContent;
        const char = msg.character;
        resumingMessageIdRef.current = messageId;
        resumingExistingTextRef.current = existingText;

        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        setStreamingText(existingText); streamingTextRef.current = existingText;
        setStreamingCharacter(char);
        setLatency(0); setTimeToFirstToken(0); isAtBottomRef.current = true;

        try {
            const result = await handleServerResponse(currentInteractionData, char, ctrl.signal, throttledSetStreamingText, undefined, existingText, allPromptBlocks);
            if (!result) return;

            const foundMsg = result.interactionHistory.find(m => m.id === messageId);
            const msgText = foundMsg && foundMsg.messageType === 'chat' ? foundMsg.textContent : existingText;
            const edited = await editMessage(result, messageId, msgText);

            const foundEdited = edited.interactionHistory.find(m => m.id === messageId);
            if (foundEdited && foundEdited.messageType === 'chat' && !foundEdited.isPartial) {
                const finalData = await clearPartialFlag(edited, messageId);
                setInteractionData(finalData);
                await saveRawInteractionData(finalData);
            } else {
                setInteractionData(edited);
                await saveRawInteractionData(edited);
            }

            const finalText = foundEdited && foundEdited.messageType === 'chat' ? foundEdited.textContent : '';
            if (char.id !== currentInteractionData.protagonist.id) speakMessage(finalText, char);
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error('Resume failed:', e);
                addToast(`Resume error: ${(e as Error).message}`, 'error');
            }
            pendingPartialRef.current = null;
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
            releaseLock();
        }
    }, [isLoadingRef, acquireLock, isModelReadyForGeneration, setStreamingText, streamingTextRef, setStreamingCharacter, setLatency, setTimeToFirstToken, addToast, releaseLock, handleServerResponse, throttledSetStreamingText, speakMessage, setInteractionData]);

    const regenerateFromMessage = useCallback(async (messageId: string, type: 'ai' | 'user', allPromptBlocks?: PromptBlock[]) => {
        const currentInteractionData = useSessionStore.getState().interactionData;
        const currentChar = useSessionStore.getState().currentCharacter;
        if (!currentInteractionData || !acquireLock()) { addToast(acquireLock() ? 'Chat data missing.' : 'Already generating...', 'info'); return; }
        if (!useSessionStore.getState().activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        // Initialize audio context on user gesture (browser autoplay policy)
        getAudioEngine().initialize();

        const history = currentInteractionData.interactionHistory;
        const ti = history.findIndex(m => m.id === messageId);
        if (ti === -1) { addToast('Message not found.', 'error'); releaseLock(); return; }
        const tm = history[ti];
        const isAI = tm.character.id !== currentInteractionData.protagonist.id;
        let trimIdx: number;
        if (type === 'ai' && isAI) trimIdx = ti;
        else if (type === 'user' && !isAI) trimIdx = ti + 1;
        else { addToast('Mismatched regeneration type.', 'error'); releaseLock(); return; }
        const toDelete = history.slice(trimIdx);
        if (toDelete.length) try { await Promise.all(toDelete.map(m => import('./storage').then(s => s.deleteRawInteractionMessage(m.id)))); } catch (e) { console.error('Delete failed:', e); }
        const td: InteractionData = { ...currentInteractionData, interactionHistory: history.slice(0, trimIdx), lastUpdatedTimestamp: Date.now() };
        setInteractionData(td);
        await saveRawInteractionData(td);

        resetStream();
        setStreamingCharacter(null);
        setLatency(0); setTimeToFirstToken(0); isAtBottomRef.current = true;
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        const preCount = td.interactionHistory.length;
        try {
            const executor = async (d: InteractionData, c: Character, s: AbortSignal, ot: (t: string) => void) => {
                resetStream();
                setStreamingCharacter(c);
                return handleServerResponse(d, c, s, ot, undefined, '', allPromptBlocks);
            };
            const ud = await runTurnSequence(td, executor, ctrl, setStreamingCharacter, throttledSetStreamingText, setInteractionData);
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, currentInteractionData.protagonist.id); await saveRawInteractionData(fd); setInteractionData(fd); return; }
            if (ud.interactionHistory.length > preCount) {
                await saveRawInteractionData(ud); setInteractionData(ud);
                runSummarization({
                    data: ud,
                    setData: setInteractionData,
                    addToast,
                    activeStrategy: useSessionStore.getState().activeStrategy,
                });
                const lm = ud.interactionHistory[ud.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== currentChar?.id) speakMessage(lm.textContent, lm.character);
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud; await saveRawInteractionData(sd); setInteractionData(sd);
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Regen failed:', e); addToast(`Regen error: ${(e as Error).message}`, 'error'); } }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [handleServerResponse, addToast, isModelReadyForGeneration, acquireLock, releaseLock, generateAmbientNarration, speakMessage, applyPendingPartial, throttledSetStreamingText, resetStream, setStreamingCharacter, setInteractionData, setLatency, setTimeToFirstToken]);

    const processProtagonistImageSilently = useCallback(async (data: InteractionData, char: Character, allPromptBlocks?: PromptBlock[]) => {
        if (!data?.Profile?.forceNoCharacterImageInjection && Object.keys(char.images || {}).length === 0) return;
        if (!isModelReadyForGeneration() || isLoadingRef.current || isProcessingSilentlyRef.current) return;
        isProcessingSilentlyRef.current = true;
        const s = char.sampler;
        const silent: Character = { ...char, sampler: { ...s, id: s?.id || uuidv4(), name: s?.name || 'silent', maximumNumberOfTokens: 0, parameters: { ...s?.parameters, n_predict: 0 }, stopPatterns: [], firstCreatedTimestamp: s?.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: Date.now() } };
        try { await handleServerResponse(data, silent, new AbortController().signal, undefined, undefined, '', allPromptBlocks); }
        catch (e) { console.warn('Silent image processing failed:', e); }
        finally { isProcessingSilentlyRef.current = false; }
    }, [handleServerResponse, isLoadingRef, isModelReadyForGeneration]);

    // ─── Return ──────────────────────────────────────────────────────
    const maximumNumberOfTokens = engine.getContext()?.contextLength || 8192;

    return {
        interactionData, setInteractionData, currentCharacter, setCurrentCharacter,
        isLoading, streamingText, streamingCharacter, currentCharacterExpression,
        sendMessage, stopGeneration, resumeGeneration, regenerateFromMessage,
        messageEndRef, chatHistoryRef,
        latency, timeToFirstToken, numberOfMessages: interactionData?.interactionHistory.length || 0,
        numberOfTokens, maximumNumberOfTokens, startNewChat,
        sendActionAndGetResponse, setActiveBudgetStrategy, setSelectedGlobalModel, updateRunningModels,
        activeStrategy, budgetData,
        numberOfCacheInvalidations,
        numberOfRequests,
        totalCost,
        costWithoutCacheMisses,
        processProtagonistImageSilently,
    };
}