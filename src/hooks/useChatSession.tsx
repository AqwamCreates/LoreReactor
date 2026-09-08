// src/hooks/useChatSession.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Character, InteractionData, BudgetStrategy, BudgetData, LanguageModel } from '../types';
import { saveRawInteractionData, loadRawBudgetData } from './storage';
import { createChatMessage, addMessageToInteractionData, convertIdsToDisplayNames, createNewInteractionData, editInteractionMessageInInteractionData } from './chatLogic';
import { runTurnSequence } from '../services/InteractionOrchestrator';
import { editMessage, clearPartialFlag } from './messageLogic';
import { consumeChatStamina } from './characterLogic';
import { getCurrentLocationIndex, findLocationByRegex } from '../hooks/locationLogic';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../context/ToastContext';
import { localURL } from '../configurations';
import { LanguageModelEngine } from '../services/LanguageModelEngine';
import { useThrottledStream } from './useThrottledStream';
import { useGenerationLock } from './useGenerationLock';
import { useAmbientNarration } from './useAmbientNarration';
import { useCharacterVoice } from './useCharacterVoice';
import { useMemoryTrigger } from './useMemoryTrigger';
import { useGeneration } from './useGeneration';
import { runBackgroundSummarization } from '../services/BackgroundSummarization';
import { isChatMessage } from '../typeGuard';
import { useSessionStore } from '../store/useSessionStore';

const languageModelEngine = new LanguageModelEngine();

export function useChatSession() {
    // ─── Core State (dual-write with store during Phase 1) ──────────
    const [interactionData, _setInteractionData] = useState<InteractionData | null>(null);
    const [currentCharacter, _setCurrentCharacter] = useState<Character | null>(null);
    const [streamingCharacter, _setStreamingCharacter] = useState<Character | null>(null);
    const [currentCharacterExpression, _setCurrentCharacterExpression] = useState<string>('neutral');
    const [generationSpeed, _setGenerationSpeed] = useState(0);
    const [timeToFirstToken, _setTimeToFirstToken] = useState(0);
    const [activeStrategy, _setActiveStrategy] = useState<BudgetStrategy | null>(null);
    const [selectedModel, _setSelectedModel] = useState<LanguageModel | null>(null);
    const [runningModelsMap, _setRunningModelsMap] = useState<Record<string, { isRunning: boolean; port?: number }>>({});
    const [stats, _setStats] = useState({ numberOfCacheInvalidations: 0, numberOfRequests: 0, totalCost: 0, costWithoutCacheMisses: 0 });
    const [numberOfTokens, _setNumberOfTokens] = useState(0);
    const [budgetData, _setBudgetData] = useState<BudgetData | null>(null);

    // Dual-write setters — write to both local state AND store (no subscription)
    const setInteractionData = useCallback((data: InteractionData | null) => {
        _setInteractionData(data);
        useSessionStore.setState({ interactionData: data });
    }, []);

    const setCurrentCharacter = useCallback((char: Character | null) => {
        _setCurrentCharacter(char);
        useSessionStore.setState({ currentCharacter: char });
    }, []);

    const setStreamingCharacter = useCallback((char: Character | null) => {
        _setStreamingCharacter(char);
        useSessionStore.setState({ streamingCharacter: char });
    }, []);

    const setCurrentCharacterExpression = useCallback((expr: string) => {
        _setCurrentCharacterExpression(expr);
        useSessionStore.setState({ currentCharacterExpression: expr });
    }, []);

    const setGenerationSpeed = useCallback((speed: number) => {
        _setGenerationSpeed(speed);
        useSessionStore.setState({ generationSpeed: speed });
    }, []);

    const setTimeToFirstToken = useCallback((time: number) => {
        _setTimeToFirstToken(time);
        useSessionStore.setState({ timeToFirstToken: time });
    }, []);

    const setActiveStrategy = useCallback((strategy: BudgetStrategy | null) => {
        _setActiveStrategy(strategy);
        useSessionStore.setState({ activeStrategy: strategy });
    }, []);

    const setSelectedModel = useCallback((model: LanguageModel | null) => {
        _setSelectedModel(model);
        useSessionStore.setState({ selectedModel: model });
    }, []);

    const setRunningModelsMap = useCallback((models: Record<string, { isRunning: boolean; port?: number }>) => {
        _setRunningModelsMap(models);
        useSessionStore.setState({ runningModels: models });
    }, []);

    const setStats = useCallback((newStats: typeof stats) => {
        _setStats(newStats);
        useSessionStore.setState(newStats);
    }, []);

    const setNumberOfTokens = useCallback((count: number) => {
        _setNumberOfTokens(count);
        useSessionStore.setState({ numberOfTokens: count });
    }, []);

    const setBudgetData = useCallback((data: BudgetData | null) => {
        _setBudgetData(data);
        useSessionStore.setState({ budgetData: data });
    }, []);

    // ─── Refs (kept for Phase 1, removed in Phase 2) ────────────────
    const abortControllerRef = useRef<AbortController | null>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const selectedModelRef = useRef<LanguageModel | null>(null);
    const runningModelsMapRef = useRef<Record<string, { isRunning: boolean; port?: number }>>({});
    const activeStrategyRef = useRef<BudgetStrategy | null>(null);
    const budgetDataRef = useRef<BudgetData | null>(null);
    const isProcessingSilentlyRef = useRef(false);
    const streamingCharacterRef = useRef<Character | null>(null);
    const interactionDataRef = useRef<InteractionData | null>(null);
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);
    const isAtBottomRef = useRef(true);
    const previousExpressionRef = useRef<string>('neutral');
    const resumingMessageIdRef = useRef<string | null>(null);
    const resumingExistingTextRef = useRef<string>('');
    const activeStrategyIdRef = useRef<string | null>(null);

    // ─── Extracted Hooks ─────────────────────────────────────────────
    const { throttledSetStreamingText, streamingText, setStreamingText, streamingTextRef, resetStream } = useThrottledStream();
    const { isLoading, acquireLock, releaseLock, isLoadingRef } = useGenerationLock();
    const { generateAmbientNarration } = useAmbientNarration(setStreamingCharacter, streamingCharacterRef, setStreamingText, streamingTextRef);
    const { speakMessage } = useCharacterVoice(interactionDataRef);
    const { processMemoryTrigger } = useMemoryTrigger(selectedModelRef, runningModelsMapRef, activeStrategyRef);
    const { handleServerResponse } = useGeneration({
        selectedModelRef, runningModelsMapRef, activeStrategyRef, budgetDataRef,
        setBudgetData, setStats, setGenerationSpeed, setTimeToFirstToken,
        setCurrentCharacterExpression, previousExpressionRef,
        throttledSetStreamingText, streamingTextRef,
        processMemoryTrigger, addToast: useToast().addToast,
    });

    const { addToast } = useToast();

    // ─── Ref Sync Effects (kept for Phase 1, removed in Phase 2) ────
    useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
    useEffect(() => { runningModelsMapRef.current = runningModelsMap; }, [runningModelsMap]);
    useEffect(() => { activeStrategyRef.current = activeStrategy; }, [activeStrategy]);
    useEffect(() => { budgetDataRef.current = budgetData; }, [budgetData]);
    useEffect(() => { streamingCharacterRef.current = streamingCharacter; }, [streamingCharacter]);
    useEffect(() => { interactionDataRef.current = interactionData; }, [interactionData]);

    // ─── Mount Effects ───────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const bd = await loadRawBudgetData();
                if (bd) { setBudgetData(bd); }
            } catch (e) { console.warn('Failed to load budget data:', e); }
        })();
    }, []);

    useEffect(() => {
        const handler = (event: Event) => {
            const updated = (event as CustomEvent<BudgetData | null>).detail;
            setBudgetData(updated);
        };
        window.addEventListener('budget-data-updated', handler);
        return () => window.removeEventListener('budget-data-updated', handler);
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${localURL}/models/status`);
                if (!res.ok) return;
                const data = await res.json();
                const status: Record<string, { isRunning: boolean; port?: number }> = {};
                for (const m of data.activeModels || []) status[m.id] = { isRunning: true, port: m.port };
                setRunningModelsMap(status);
            } catch { }
        })();
    }, []);

    useEffect(() => {
        if (!interactionData) { setNumberOfTokens(0); return; }
        let cancelled = false;
        (async () => {
            const model = selectedModelRef.current;
            const port = model?.id ? runningModelsMapRef.current[model.id]?.port : undefined;
            const ep = port || (model?.parameters as any)?._runtimePort;
            const lmCtx = ep ? { runtimePort: ep } : undefined;
            let total = 0;
            for (const m of interactionData.interactionHistory) {
                if (isChatMessage(m)) total += await languageModelEngine.countTokens(m.textContent, lmCtx);
            }
            if (!cancelled) setNumberOfTokens(total);
        })();
        return () => { cancelled = true; };
    }, [interactionData?.interactionHistory, interactionData]);

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

    // ─── Helpers ─────────────────────────────────────────────────────
    const isModelReadyForGeneration = useCallback((): boolean => {
        const m = selectedModelRef.current;
        if (!m) return false;
        if (m.apiKey) return true;
        return !!(m.id && runningModelsMapRef.current[m.id]?.port);
    }, []);

    const applyPendingPartial = useCallback(async (base: InteractionData, protagonistId: string): Promise<InteractionData> => {
        const p = pendingPartialRef.current; if (!p) return base;
        pendingPartialRef.current = null;
        const dt = convertIdsToDisplayNames(p.text, base);
        const h = base.interactionHistory;
        if (h.length > 0 && h[h.length - 1].character.id !== protagonistId) {
            const ph = [...h]; ph[ph.length - 1] = { ...ph[ph.length - 1], textContent: dt, isPartial: true };
            return { ...base, interactionHistory: ph, lastUpdatedTimestamp: Date.now() };
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
    }, [setInteractionData, setCurrentCharacter]);

    const stopGeneration = useCallback(() => {
        const t = streamingTextRef.current, c = streamingCharacterRef.current;
        const resumeId = resumingMessageIdRef.current;

        if (resumeId && t && t.trim().length > 0 && interactionDataRef.current) {
            const updated = editInteractionMessageInInteractionData(interactionDataRef.current, resumeId, t);
            const idx = updated.interactionHistory.findIndex(m => m.id === resumeId);
            if (idx !== -1) {
                const paragraphs = (t.match(/\n\n/g) || []).length + 1;
                if (paragraphs > 0) consumeChatStamina(updated.interactionHistory[idx], paragraphs);
                const withPartial = [...updated.interactionHistory];
                withPartial[idx] = { ...withPartial[idx], isPartial: true, lastUpdatedTimestamp: Date.now() };
                setInteractionData({ ...updated, interactionHistory: withPartial, lastUpdatedTimestamp: Date.now() });
            }
            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';
            pendingPartialRef.current = null;
        } else {
            pendingPartialRef.current = (t && t.trim() && c) ? { text: t, character: c } : null;
        }

        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        releaseLock();
        resetStream();
        setGenerationSpeed(0);
    }, [releaseLock, resetStream, setInteractionData, setGenerationSpeed]);

    const sendActionAndGetResponse = useCallback(async (actionText: string, targetChar: Character) => {
        if (!interactionData || !currentCharacter) return;
        if (isLoadingRef.current) { abortControllerRef.current?.abort(); abortControllerRef.current = null; await new Promise(r => setTimeout(r, 300)); }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!activeStrategyRef.current && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }
        const d = interactionDataRef.current; if (!d) { releaseLock(); return; }
        let ud = addMessageToInteractionData(d, createChatMessage(d, currentCharacter, actionText));

        const hasLocations = ud.locations && ud.locations.length > 0;
        if (hasLocations) {
            const protagonistMsg = ud.interactionHistory[ud.interactionHistory.length - 1];
            if (protagonistMsg && protagonistMsg.character.id === currentCharacter.id && isChatMessage(protagonistMsg)) {
                const currentLoc = getCurrentLocationIndex(ud, currentCharacter);
                const regexLoc = findLocationByRegex(ud.locations, protagonistMsg.textContent, currentCharacter);
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
        setGenerationSpeed(0); setTimeToFirstToken(0); isAtBottomRef.current = true;
        try {
            const result = await handleServerResponse(ud, targetChar, ctrl.signal, throttledSetStreamingText, undefined, '');
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(result || ud, currentCharacter.id); await saveRawInteractionData(fd); setInteractionData(fd); return; }
            if (result) {
                await saveRawInteractionData(result);
                setInteractionData(result);
                const lm = result.interactionHistory[result.interactionHistory.length - 1];
                if (lm && isChatMessage(lm) && lm.character.id !== currentCharacter?.id) speakMessage(lm.textContent, lm.character);
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') console.error('AI response failed:', e); }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [interactionData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration, acquireLock, releaseLock, speakMessage, applyPendingPartial, throttledSetStreamingText, resetStream, setStreamingCharacter, setInteractionData, setGenerationSpeed, setTimeToFirstToken]);

    const sendMessage = useCallback(async (text: string, files?: File[]) => {
        if (!interactionData || !currentCharacter || (!text.trim() && (!files || !files.length))) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!activeStrategyRef.current && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        resetStream();
        setStreamingCharacter(null);
        setGenerationSpeed(0); setTimeToFirstToken(0); isAtBottomRef.current = true;
        try {
            const convertFileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result as string); reader.onerror = error => reject(error); });
            const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;
            const chatMessage = createChatMessage(interactionData, currentCharacter, text, { files: encodedFiles });
            let td = addMessageToInteractionData(interactionData, chatMessage);

            const hasLocations = td.locations && td.locations.length > 0;
            if (hasLocations) {
                const protagonistMsg = td.interactionHistory[td.interactionHistory.length - 1];
                if (protagonistMsg && protagonistMsg.character.id === currentCharacter.id && isChatMessage(protagonistMsg)) {
                    const currentLoc = getCurrentLocationIndex(td, currentCharacter);
                    const regexLoc = findLocationByRegex(td.locations, protagonistMsg.textContent, currentCharacter);
                    const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                    td = { ...td, interactionHistory: td.interactionHistory.map((m, i) => i === td.interactionHistory.length - 1 ? { ...m, locationIndex: finalLoc } : m) };
                }
            }

            setInteractionData(td);
            await saveRawInteractionData(td);

            const executor = async (d: InteractionData, c: Character, s: AbortSignal, ot: (t: string) => void) => {
                resetStream();
                setStreamingCharacter(c);
                return handleServerResponse(d, c, s, ot, undefined, '');
            };
            const ud = await runTurnSequence(td, executor, ctrl, setStreamingCharacter, throttledSetStreamingText, setInteractionData);
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, currentCharacter.id); await saveRawInteractionData(fd); setInteractionData(fd); return; }
            if (ud.interactionHistory.length > td.interactionHistory.length) {
                await saveRawInteractionData(ud); setInteractionData(ud);
                runBackgroundSummarization({
                    data: ud, setData: setInteractionData, dataRef: interactionDataRef,
                    modelRef: selectedModelRef, runningModelsRef: runningModelsMapRef,
                    addToast, activeStrategy: activeStrategyRef.current,
                });
                const lm = ud.interactionHistory[ud.interactionHistory.length - 1];
                if (lm && isChatMessage(lm) && lm.character.id !== currentCharacter?.id) speakMessage(lm.textContent, lm.character);
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud; await saveRawInteractionData(sd); setInteractionData(sd);
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Send failed:', e); addToast(`Send failed: ${(e as Error).message}`, 'error'); } }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [interactionData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration, acquireLock, releaseLock, generateAmbientNarration, speakMessage, applyPendingPartial, throttledSetStreamingText, resetStream, setStreamingCharacter, setInteractionData, setGenerationSpeed, setTimeToFirstToken]);

    const resumeGeneration = useCallback(async (messageId: string) => {
        if (!interactionData) return;
        const msgIndex = interactionData.interactionHistory.findIndex(m => m.id === messageId);
        if (msgIndex === -1) { addToast('Message not found.', 'error'); return; }
        const msg = interactionData.interactionHistory[msgIndex];
        if (!isChatMessage(msg) || !msg.isPartial) { addToast('Not partial — use Regenerate.', 'info'); return; }
        if (isLoadingRef.current) { abortControllerRef.current?.abort(); abortControllerRef.current = null; await new Promise(r => setTimeout(r, 100)); }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const existingText = msg.textContent;
        const char = msg.character;
        resumingMessageIdRef.current = messageId;
        resumingExistingTextRef.current = existingText;

        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        setStreamingText(existingText); streamingTextRef.current = existingText;
        setStreamingCharacter(char);
        setGenerationSpeed(0); setTimeToFirstToken(0); isAtBottomRef.current = true;

        try {
            const result = await handleServerResponse(interactionData, char, ctrl.signal, throttledSetStreamingText, undefined, existingText);
            if (!result) return;

            const foundMsg = result.interactionHistory.find(m => m.id === messageId);
            const msgText = foundMsg && isChatMessage(foundMsg) ? foundMsg.textContent : existingText;
            const edited = await editMessage(result, messageId, msgText);

            const foundEdited = edited.interactionHistory.find(m => m.id === messageId);
            if (foundEdited && isChatMessage(foundEdited) && !foundEdited.isPartial) {
                const finalData = await clearPartialFlag(edited, messageId);
                setInteractionData(finalData);
                await saveRawInteractionData(finalData);
            } else {
                setInteractionData(edited);
                await saveRawInteractionData(edited);
            }

            const finalText = foundEdited && isChatMessage(foundEdited) ? foundEdited.textContent : '';
            if (char.id !== interactionData.protagonist.id) speakMessage(finalText, char);
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
    }, [interactionData, addToast, isModelReadyForGeneration, acquireLock, releaseLock, throttledSetStreamingText, speakMessage, handleServerResponse, setStreamingText, setStreamingCharacter, setInteractionData, setGenerationSpeed, setTimeToFirstToken]);

    const regenerateFromMessage = useCallback(async (messageId: string, type: 'ai' | 'user') => {
        if (!interactionData || !acquireLock()) { addToast(acquireLock() ? 'Chat data missing.' : 'Already generating...', 'info'); return; }
        if (!activeStrategyRef.current && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }
        const history = interactionData.interactionHistory;
        const ti = history.findIndex(m => m.id === messageId);
        if (ti === -1) { addToast('Message not found.', 'error'); releaseLock(); return; }
        const tm = history[ti];
        const isAI = tm.character.id !== interactionData.protagonist.id;
        let trimIdx: number;
        if (type === 'ai' && isAI) trimIdx = ti;
        else if (type === 'user' && !isAI) trimIdx = ti + 1;
        else { addToast('Mismatched regeneration type.', 'error'); releaseLock(); return; }
        const toDelete = history.slice(trimIdx);
        if (toDelete.length) try { await Promise.all(toDelete.map(m => import('./storage').then(s => s.deleteRawInteractionMessage(m.id)))); } catch (e) { console.error('Delete failed:', e); }
        const td: InteractionData = { ...interactionData, interactionHistory: history.slice(0, trimIdx), lastUpdatedTimestamp: Date.now() };
        setInteractionData(td);
        await saveRawInteractionData(td);

        resetStream();
        setStreamingCharacter(null);
        setGenerationSpeed(0); setTimeToFirstToken(0); isAtBottomRef.current = true;
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        const preCount = td.interactionHistory.length;
        try {
            const executor = async (d: InteractionData, c: Character, s: AbortSignal, ot: (t: string) => void) => {
                resetStream();
                setStreamingCharacter(c);
                return handleServerResponse(d, c, s, ot, undefined, '');
            };
            const ud = await runTurnSequence(td, executor, ctrl, setStreamingCharacter, throttledSetStreamingText, setInteractionData);
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, interactionData.protagonist.id); await saveRawInteractionData(fd); setInteractionData(fd); return; }
            if (ud.interactionHistory.length > preCount) {
                await saveRawInteractionData(ud); setInteractionData(ud);
                runBackgroundSummarization({
                    data: ud, setData: setInteractionData, dataRef: interactionDataRef,
                    modelRef: selectedModelRef, runningModelsRef: runningModelsMapRef,
                    addToast, activeStrategy: activeStrategyRef.current,
                });
                const lm = ud.interactionHistory[ud.interactionHistory.length - 1];
                if (lm && isChatMessage(lm) && lm.character.id !== currentCharacter?.id) speakMessage(lm.textContent, lm.character);
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud; await saveRawInteractionData(sd); setInteractionData(sd);
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Regen failed:', e); addToast(`Regen error: ${(e as Error).message}`, 'error'); } }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [interactionData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration, acquireLock, releaseLock, generateAmbientNarration, speakMessage, applyPendingPartial, throttledSetStreamingText, resetStream, setStreamingCharacter, setInteractionData, setGenerationSpeed, setTimeToFirstToken]);

    const processProtagonistImageSilently = useCallback(async (data: InteractionData, char: Character) => {
        if (!data?.Profile?.forceNoCharacterImageInjection && Object.keys(char.images || {}).length === 0) return;
        if (!isModelReadyForGeneration() || isLoadingRef.current || isProcessingSilentlyRef.current) return;
        isProcessingSilentlyRef.current = true;
        const s = char.sampler;
        const silent: Character = { ...char, sampler: { ...s, id: s?.id || uuidv4(), name: s?.name || 'silent', maximumNumberOfTokens: 0, parameters: { ...s?.parameters, n_predict: 0 }, stopPatterns: [], firstCreatedTimestamp: s?.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: Date.now() } };
        try { await handleServerResponse(data, silent, new AbortController().signal, undefined, undefined, ''); }
        catch (e) { console.warn('Silent image processing failed:', e); }
        finally { isProcessingSilentlyRef.current = false; }
    }, [handleServerResponse, isModelReadyForGeneration]);

    // ─── Return (unchanged — App.tsx keeps working identically) ─────
    const maxCtx = selectedModel?.contextLength || 8192;

    return {
        interactionData, setInteractionData, currentCharacter, setCurrentCharacter,
        isLoading, streamingText, streamingCharacter, currentCharacterExpression,
        sendMessage, stopGeneration, resumeGeneration, regenerateFromMessage,
        messageEndRef, chatHistoryRef,
        generationSpeed, timeToFirstToken, numberOfMessages: interactionData?.interactionHistory.length || 0,
        numberOfTokens, maximumNumberOfTokens: maxCtx, startNewChat,
        sendActionAndGetResponse, setActiveBudgetStrategy, setSelectedGlobalModel, updateRunningModels,
        activeStrategy, budgetData,
        numberOfCacheInvalidations: stats.numberOfCacheInvalidations,
        numberOfRequests: stats.numberOfRequests,
        totalCost: stats.totalCost,
        costWithoutCacheMisses: stats.costWithoutCacheMisses,
        processProtagonistImageSilently,
    };
}