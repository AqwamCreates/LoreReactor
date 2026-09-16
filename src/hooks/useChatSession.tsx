// src/hooks/useChatSession.tsx
import { useRef, useCallback, useEffect } from 'react';
import { useChatState } from './useChatState';
import { useChatEngine } from './useChatEngine';
import { useChatUI } from './useChatUI';
import { useToast } from '../context/ToastContext';
import { createChatMessage, addMessageToInteractionData, convertIdsToDisplayNames, createNewInteractionData } from './chatLogic';
import { runSummarization } from '../services/SummarizationEngine';
import { consumeChatStaminaForMessage } from './characterLogic';
import { getCurrentLocationIndex, findLocationByRegex } from './locationLogic';
import { saveRawInteractionData, loadRawBudgetData } from '../storage/serverStorage';
import { useThrottledStream } from './useThrottledStream';
import { useCharacterResponseLock } from './useCharacterResponseLock';
import { useAmbientNarration } from './useAmbientNarration';
import { useMemoryTrigger } from './useMemoryTrigger';
import { useSessionStore } from './useSessionStore';
import { localURL } from '../configurations';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import type { Character, InteractionData, PromptBlock, ChatMessage } from '../types';

const engine = getLanguageModelEngine();

function sanitizeStreamedText(text: string): string {
    return text.replace(/▋$/g, '').trimEnd();
}

function finalizeLastAIMessage(
    data: InteractionData,
    protagonistId: string,
    wasAborted: boolean
): InteractionData {
    if (wasAborted) return data;

    const history = data.interactionHistory;
    if (history.length === 0) return data;

    const lastMsg = history[history.length - 1];
    if (
        lastMsg.messageType === 'chat' &&
        lastMsg.character.id !== protagonistId &&
        (lastMsg as ChatMessage).isPartial
    ) {
        const finalizedHistory = [...history];
        finalizedHistory[finalizedHistory.length - 1] = {
            ...lastMsg,
            textContent: sanitizeStreamedText(lastMsg.textContent),
            isPartial: false,
            lastUpdatedTimestamp: Date.now(),
        } as ChatMessage;
        return { ...data, interactionHistory: finalizedHistory, lastUpdatedTimestamp: Date.now() };
    }

    return data;
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
                textContent: sanitizeStreamedText(m.textContent),
                isPartial: false,
                lastUpdatedTimestamp: Date.now(),
            } as ChatMessage;
        }
        return m;
    });
    return { ...data, interactionHistory: history, lastUpdatedTimestamp: Date.now() };
}

export function useChatSession() {
    const { addToast } = useToast();

    const state = useChatState();

    // Direct Zustand selectors for stable effect dependencies
    const interactionData = useSessionStore(s => s.interactionData);
    const selectedModel = useSessionStore(s => s.selectedModel);
    const autonomousMode = useSessionStore(s => s.interactionData?.Profile?.autonomousMode ?? false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const isProcessingSilentlyRef = useRef(false);
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);
    const resumingMessageIdRef = useRef<string | null>(null);
    const resumingExistingTextRef = useRef<string>('');
    const isAtBottomRef = useRef(true);
    const wasStoppedRef = useRef(false);

    const ui = useChatUI(state.interactionData, state.isLoading, state.streamingText, isAtBottomRef);

    const { processMemoryTrigger } = useMemoryTrigger();

    const chatEngine = useChatEngine({
        getState: state.getState,
        setInteractionData: state.setInteractionData,
        setStreamingState: state.setStreamingState,
        setBudgetData: state.setBudgetData,
        setStats: state.setStats,
        setCurrentCharacterExpression: state.setCurrentCharacterExpression,
        addToast,
        processMemoryTrigger,
    });

    const { throttledSetStreamingText, setStreamingText, streamingTextRef, resetStream } = useThrottledStream();
    const { acquireLock, releaseLock, isLoadingRef } = useCharacterResponseLock();
    const { generateAmbientNarration } = useAmbientNarration(state.setStreamingState, setStreamingText, streamingTextRef);

    // Load budget data once on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const bd = await loadRawBudgetData();
                if (!cancelled && bd) state.setBudgetData(bd);
            } catch (e) { console.warn('Failed to load budget data:', e); }
        })();
        return () => { cancelled = true; };
    }, [state.setBudgetData]);

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
                if (!cancelled) state.updateRunningModels(status);
            } catch (e) { if (!cancelled) addToast(`Failed to fetch models status: ${e}`); }
        })();
        return () => { cancelled = true; };
    }, [state.updateRunningModels, addToast]);

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
            if (!cancelled) state.setNumberOfTokens(total);
        })();
        return () => { cancelled = true; };
    }, [interactionData, state.setNumberOfTokens]);

    // Autonomous mode — depends on autonomousMode flag only
    useEffect(() => {
        if (autonomousMode && interactionData) {
            const checkCanAct = () => !isLoadingRef.current && !abortControllerRef.current;
            chatEngine.startAutonomousMode(
                checkCanAct,
                () => state.getState().interactionData,
                (data) => { state.setState({ interactionData: data }); },
                resetStream
            );
        } else {
            chatEngine.stopAutonomousMode();
        }
        return () => { chatEngine.stopAutonomousMode(); };
    }, [autonomousMode, interactionData, chatEngine, isLoadingRef, resetStream, state.getState, state.setState]);

    const isModelReadyForGeneration = useCallback((): boolean => {
        const m = state.getState().selectedModel;
        if (!m) return false;
        if (m.apiKey) return true;
        const models = state.getState().runningModels;
        return !!(m.id && models[m.id]?.port);
    }, [state.getState]);

    const applyPendingPartial = useCallback(async (base: InteractionData, protagonistId: string): Promise<InteractionData> => {
        const p = pendingPartialRef.current; if (!p) return base;
        pendingPartialRef.current = null;
        const dt = convertIdsToDisplayNames(p.text, base);
        const h = base.interactionHistory;
        if (h.length > 0 && h[h.length - 1].character.id !== protagonistId) {
            const lastMsg = h[h.length - 1];
            if (lastMsg.messageType === 'chat') {
                const ph = [...h];
                ph[ph.length - 1] = { ...lastMsg, textContent: sanitizeStreamedText(dt), isPartial: true };
                return { ...base, interactionHistory: ph, lastUpdatedTimestamp: Date.now() };
            }
        }
        const chatMessage = createChatMessage(base, p.character, sanitizeStreamedText(dt), { isPartial: true });
        return addMessageToInteractionData(base, chatMessage);
    }, []);

    const sendMessage = useCallback(async (text: string, files?: File[], allPromptBlocks?: PromptBlock[]) => {
        if (!state.interactionData || !state.currentCharacter || (!text.trim() && (!files || !files.length))) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!state.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;
        wasStoppedRef.current = false;
        resetStream();
        state.setStreamingState(null, '');
        state.setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const convertFileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result as string); reader.onerror = error => reject(error); });
            const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;

            const chatMessage = createChatMessage(state.interactionData, state.currentCharacter, text, { files: encodedFiles });
            let td = addMessageToInteractionData(state.interactionData, chatMessage);

            const hasLocations = td.locations && td.locations.length > 0;
            if (hasLocations) {
                const protagonistMsg = td.interactionHistory[td.interactionHistory.length - 1];
                if (protagonistMsg && protagonistMsg.character.id === state.currentCharacter.id && protagonistMsg.messageType === 'chat') {
                    const currentLoc = getCurrentLocationIndex(td, state.currentCharacter);
                    const regexLoc = findLocationByRegex(td.locations, protagonistMsg.textContent, state.currentCharacter);
                    const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                    td = { ...td, interactionHistory: td.interactionHistory.map((m, i) => i === td.interactionHistory.length - 1 ? { ...m, locationIndex: finalLoc } : m) };
                }
            }

            state.setInteractionData(td);
            await saveRawInteractionData(td);

            const ud = await chatEngine.runTurn(td, ctrl, allPromptBlocks);

            if (pendingPartialRef.current) {
                const fd = await applyPendingPartial(ud, state.currentCharacter.id);
                await saveRawInteractionData(fd);
                state.setInteractionData(fd);
                return;
            }

            if (ud.interactionHistory.length > td.interactionHistory.length) {
                const processed = await chatEngine.processPendingTools(ud);
                const finalized = finalizeLastAIMessage(processed, state.currentCharacter.id, wasStoppedRef.current);

                await saveRawInteractionData(finalized);
                state.setInteractionData(finalized);

                runSummarization({
                    data: finalized,
                    setData: state.setInteractionData,
                    addToast,
                });

                const lm = finalized.interactionHistory[finalized.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== state.currentCharacter?.id) {
                    ui.playVoice(lm.textContent, lm.character);
                }
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud;
                await saveRawInteractionData(sd);
                state.setInteractionData(sd);
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error('Send failed:', e);
                addToast(`Send failed: ${(e as Error).message}`, 'error');
            }
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
            releaseLock();
        }
    }, [state, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration]);

    const sendActionAndGetResponse = useCallback(async (actionText: string, targetChar: Character) => {
        if (!state.interactionData) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!state.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;
        wasStoppedRef.current = false;
        resetStream();
        state.setStreamingState(null, '');
        state.setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const chatMessage = createChatMessage(state.interactionData, targetChar, actionText);
            const td = addMessageToInteractionData(state.interactionData, chatMessage);

            state.setInteractionData(td);
            await saveRawInteractionData(td);

            const ud = await chatEngine.runTurn(td, ctrl);

            if (pendingPartialRef.current) {
                const fd = await applyPendingPartial(ud, state.interactionData.protagonist?.id ?? '');
                await saveRawInteractionData(fd);
                state.setInteractionData(fd);
                return;
            }

            if (ud.interactionHistory.length > td.interactionHistory.length) {
                const processed = await chatEngine.processPendingTools(ud);
                const finalized = finalizeLastAIMessage(processed, state.interactionData.protagonist?.id ?? '', wasStoppedRef.current);
                await saveRawInteractionData(finalized);
                state.setInteractionData(finalized);

                runSummarization({ data: finalized, setData: state.setInteractionData, addToast });

                const lm = finalized.interactionHistory[finalized.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== state.interactionData.protagonist?.id) {
                    ui.playVoice(lm.textContent, lm.character);
                }
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud;
                await saveRawInteractionData(sd);
                state.setInteractionData(sd);
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error('Action failed:', e);
                addToast(`Action failed: ${(e as Error).message}`, 'error');
            }
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
            releaseLock();
        }
    }, [state, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration]);
    
    const stopGeneration = useCallback(() => {
        wasStoppedRef.current = true;

        const resumeId = resumingMessageIdRef.current;
        const currentData = state.getState().interactionData;

        abortControllerRef.current?.abort();
        abortControllerRef.current = null;

        if (resumeId && currentData) {
            const idx = currentData.interactionHistory.findIndex(m => m.id === resumeId);
            if (idx !== -1) {
                const targetMsg = currentData.interactionHistory[idx] as ChatMessage;
                const cleanText = sanitizeStreamedText(targetMsg.textContent);
                const paragraphs = (cleanText.match(/\n\n/g) || []).length + 1;
                
                const withPartial = [...currentData.interactionHistory];
                withPartial[idx] = { 
                    ...targetMsg, 
                    textContent: cleanText,
                    isPartial: true, 
                    lastUpdatedTimestamp: Date.now() 
                } as ChatMessage;
                
                if (paragraphs > 0) consumeChatStaminaForMessage(withPartial[idx], paragraphs);

                state.setState({
                    interactionData: { ...currentData, interactionHistory: withPartial, lastUpdatedTimestamp: Date.now() },
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
            const c = state.getState().streamingCharacter;
            pendingPartialRef.current = (t?.trim() && c) ? { text: sanitizeStreamedText(t), character: c } : null;
            state.setState({
                streamingCharacter: null,
                streamingText: '',
                isLoading: false,
                latency: 0,
                timeToFirstToken: 0,
            });
        }

        isLoadingRef.current = false;
        resetStream();
    }, [resetStream, state, streamingTextRef, isLoadingRef]);

    const resumeGeneration = useCallback(async (messageId: string, allPromptBlocks?: PromptBlock[]) => {
        const currentInteractionData = state.getState().interactionData;
        if (!currentInteractionData) return;
        const msgIndex = currentInteractionData.interactionHistory.findIndex(m => m.id === messageId);
        if (msgIndex === -1) { addToast('Message not found.', 'error'); return; }
        const msg = currentInteractionData.interactionHistory[msgIndex];
        if (msg.messageType !== 'chat' || !msg.isPartial) { addToast('Not partial — use Regenerate.', 'info'); return; }

        if (isLoadingRef.current) { abortControllerRef.current?.abort(); abortControllerRef.current = null; await new Promise(r => setTimeout(r, 100)); }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!state.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const existingText = msg.textContent;
        const char = msg.character;
        resumingMessageIdRef.current = messageId;
        resumingExistingTextRef.current = existingText;
        wasStoppedRef.current = false;
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;

        setStreamingText(existingText);
        streamingTextRef.current = existingText;
        state.setStreamingState(char, existingText);
        state.setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const result = await chatEngine.handleServerResponse(
                currentInteractionData, char, ctrl.signal,
                throttledSetStreamingText, undefined, existingText, allPromptBlocks
            );
            if (!result) return;

            const finalized = finalizeMessageById(result, messageId, wasStoppedRef.current);

            state.setState({
                interactionData: finalized,
                streamingCharacter: null,
                streamingText: '',
            });

            await saveRawInteractionData(finalized);

            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';

            const finalMsg = finalized.interactionHistory.find(m => m.id === messageId);
            const finalText = finalMsg && finalMsg.messageType === 'chat' ? finalMsg.textContent : '';
            if (char.id !== currentInteractionData.protagonist.id) ui.playVoice(finalText, char);
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
            releaseLock();
        }
    }, [state, isLoadingRef, acquireLock, isModelReadyForGeneration, setStreamingText, streamingTextRef, addToast, releaseLock, chatEngine, throttledSetStreamingText, ui]);

    const regenerateFromMessage = useCallback(async (messageId: string, type: 'ai' | 'user', allPromptBlocks?: PromptBlock[]) => {
        const currentInteractionData = state.getState().interactionData;
        const currentChar = state.getState().currentCharacter;
        if (!currentInteractionData || !acquireLock()) { addToast(acquireLock() ? 'Chat data missing.' : 'Already generating...', 'info'); return; }
        if (!state.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

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
        if (toDelete.length) try { await Promise.all(toDelete.map(m => import('../storage/serverStorage').then(s => s.deleteRawInteractionMessage(m.id)))); } catch (e) { console.error('Delete failed:', e); }

        const td: InteractionData = { ...currentInteractionData, interactionHistory: history.slice(0, trimIdx), lastUpdatedTimestamp: Date.now() };
        state.setInteractionData(td);
        await saveRawInteractionData(td);

        resetStream();
        state.setStreamingState(null, '');
        state.setStats({ latency: 0, timeToFirstToken: 0 });
        wasStoppedRef.current = false;
        isAtBottomRef.current = true;

        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        const preCount = td.interactionHistory.length;

        try {
            const ud = await chatEngine.runTurn(td, ctrl, allPromptBlocks);
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, currentInteractionData.protagonist.id); await saveRawInteractionData(fd); state.setInteractionData(fd); return; }

            if (ud.interactionHistory.length > preCount) {
                const processed = await chatEngine.processPendingTools(ud);
                const finalized = finalizeLastAIMessage(processed, currentInteractionData.protagonist.id, wasStoppedRef.current);

                await saveRawInteractionData(finalized);
                state.setInteractionData(finalized);

                runSummarization({
                    data: finalized,
                    setData: state.setInteractionData,
                    addToast,
                });

                const lm = finalized.interactionHistory[finalized.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== currentChar?.id) ui.playVoice(lm.textContent, lm.character);
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud; await saveRawInteractionData(sd); state.setInteractionData(sd);
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Regen failed:', e); addToast(`Regen error: ${(e as Error).message}`, 'error'); } }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [state, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration]);

    const processProtagonistImageSilently = useCallback(async (data: InteractionData, char: Character, allPromptBlocks?: PromptBlock[]) => {
        if (!data?.Profile?.forceNoCharacterImageInjection && Object.keys(char.images || {}).length === 0) return;
        if (!isModelReadyForGeneration() || isLoadingRef.current || isProcessingSilentlyRef.current) return;
        isProcessingSilentlyRef.current = true;
        const s = char.sampler;
        const silent: Character = { ...char, sampler: { ...s, id: s?.id || 'silent-uuid', name: s?.name || 'silent', maximumNumberOfTokens: 0, parameters: { ...s?.parameters, n_predict: 0 }, stopPatterns: [], firstCreatedTimestamp: s?.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: Date.now() } };
        try { await chatEngine.handleServerResponse(data, silent, new AbortController().signal, undefined, undefined, '', allPromptBlocks); }
        catch (e) { console.warn('Silent image processing failed:', e); }
        finally { isProcessingSilentlyRef.current = false; }
    }, [chatEngine, isLoadingRef, isModelReadyForGeneration]);

    const startNewChat = useCallback((char: Character) => {
        const c = createNewInteractionData(char);
        c.name = 'Untitled Chat';
        state.setInteractionData(c);
        state.setCurrentCharacter(char);
        isAtBottomRef.current = true;
        state.setState({ sessionStartTimestamp: Date.now() });
    }, [state]);

    return {
        ...state,
        ...ui,
        sendMessage,
        stopGeneration,
        resumeGeneration,
        regenerateFromMessage,
        startNewChat,
        sendActionAndGetResponse,
        setActiveBudgetStrategy: state.setActiveStrategy,
        setSelectedGlobalModel: state.setSelectedModel,
        updateRunningModels: state.updateRunningModels,
        processProtagonistImageSilently,
    };
}