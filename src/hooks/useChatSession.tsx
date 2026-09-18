// src/hooks/useChatSession.tsx
import { useRef, useCallback, useEffect } from 'react';
import { useChatState } from './useChatState';
import { useChatEngine } from './useChatEngine';
import { useChatUI } from './useChatUI';
import { useToast } from '../context/ToastContext';
import { createChatMessage, addMessageToInteractionData, convertIdsToDisplayNames, createNewInteractionData } from './chatLogic';
import { processPendingToolActions } from '../services/ToolExecutor';
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
import { detectName } from './nameDetection';
import type { Character, InteractionData, PromptBlock, ChatMessage } from '../types';

const engine = getLanguageModelEngine();

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
        const wasRevealed = lastMsg.isNameRevealed ?? false;
        const isNameRevealed = wasRevealed || detectName(data, lastMsg.character, lastMsg.textContent);

        const finalizedHistory = [...history];
        finalizedHistory[finalizedHistory.length - 1] = {
            ...lastMsg,
            isPartial: false,
            isNameRevealed,
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
            const textContent = m.textContent;
            const wasRevealed = m.isNameRevealed ?? false;
            const isNameRevealed = wasRevealed || detectName(data, m.character, textContent);
            return {
                ...m,
                isPartial: false,
                isNameRevealed,
                lastUpdatedTimestamp: Date.now(),
            } as ChatMessage;
        }
        return m;
    });
    return { ...data, interactionHistory: history, lastUpdatedTimestamp: Date.now() };
}

/**
 * Find the last AI chat message and mark it as partial for resumption.
 * Returns the updated data and the message ID, or null if no suitable message found.
 */
function markLastAIMessageAsPartial(
    data: InteractionData,
    protagonistId: string,
): { data: InteractionData; messageId: string } | null {
    const history = [...data.interactionHistory];
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.messageType === 'chat' && msg.character.id !== protagonistId) {
            history[i] = {
                ...msg,
                isPartial: true,
                lastUpdatedTimestamp: Date.now(),
            } as ChatMessage;
            return {
                data: { ...data, interactionHistory: history, lastUpdatedTimestamp: Date.now() },
                messageId: msg.id,
            };
        }
    }
    return null;
}

export function useChatSession(allCharacters: Character[]) {
    const { addToast } = useToast();

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
        if (autonomousMode && interactionData) {
            const checkCanAct = () => !isLoadingRef.current && !abortControllerRef.current;
            chatEngine.startAutonomousMode(
                checkCanAct,
                () => getState().interactionData,
                (data) => { setState({ interactionData: data }); },
                resetStream
            );
        } else {
            chatEngine.stopAutonomousMode();
        }
        return () => { chatEngine.stopAutonomousMode(); };
    }, [autonomousMode, interactionData, chatEngine, isLoadingRef, resetStream, getState, setState]);

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
                    isPartial: true,
                };
                return { ...base, interactionHistory: ph, lastUpdatedTimestamp: Date.now() };
            }
        }
        const chatMessage = createChatMessage(base, p.character, dt, { isPartial: true });
        chatMessage.isNameRevealed = false;
        return addMessageToInteractionData(base, chatMessage);
    }, []);

    // Auto-resume helper: marks last AI message as partial and triggers resumeGeneration
    const autoResumeOnCutoff = useCallback((data: InteractionData, protagonistId: string, allPromptBlocks?: PromptBlock[]) => {
        const marked = markLastAIMessageAsPartial(data, protagonistId);
        if (!marked) return;

        setInteractionData(marked.data);
        saveRawInteractionData(marked.data);

        // Use setTimeout to avoid re-entrancy issues with the current callback stack
        setTimeout(() => {
            resumeGeneration(marked.messageId, allPromptBlocks);
        }, 0);
    }, [setInteractionData]);

    const sendMessage = useCallback(async (text: string, files?: File[], allPromptBlocks?: PromptBlock[]) => {
        const currentState = getState();
        if (!currentState.interactionData || !currentState.currentCharacter || (!text.trim() && (!files || !files.length))) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;
        wasStoppedRef.current = false;
        resetStream();
        setStreamingState(null, '');
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const convertFileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result as string); reader.onerror = error => reject(error); });
            const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;

            const chatMessage = createChatMessage(currentState.interactionData, currentState.currentCharacter, text, { files: encodedFiles });
            let td = addMessageToInteractionData(currentState.interactionData, chatMessage);

            const hasLocations = td.locations && td.locations.length > 0;
            if (hasLocations) {
                const protagonistMsg = td.interactionHistory[td.interactionHistory.length - 1];
                if (protagonistMsg && protagonistMsg.character.id === currentState.currentCharacter.id && protagonistMsg.messageType === 'chat') {
                    const currentLoc = getCurrentLocationIndex(td, currentState.currentCharacter);
                    const regexLoc = findLocationByRegex(td.locations, protagonistMsg.textContent, currentState.currentCharacter);
                    const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                    td = { ...td, interactionHistory: td.interactionHistory.map((m, i) => i === td.interactionHistory.length - 1 ? { ...m, locationIndex: finalLoc } : m) };
                }
            }

            setInteractionData(td);
            await saveRawInteractionData(td);

            const turnResult = await chatEngine.runTurn(td, ctrl, allPromptBlocks);
            const ud = turnResult.interactionData;

            if (pendingPartialRef.current) {
                const fd = await applyPendingPartial(ud, currentState.currentCharacter.id);
                await saveRawInteractionData(fd);
                setInteractionData(fd);
                return;
            }

            if (ud.interactionHistory.length > td.interactionHistory.length) {
                const processed = processPendingToolActions(ud, allCharacters, { onToast: addToast });
                const finalized = finalizeLastAIMessage(processed, currentState.currentCharacter.id, wasStoppedRef.current);

                await saveRawInteractionData(finalized);
                setInteractionData(finalized);

                // Auto-resume if model cut off mid-generation
                if (!turnResult.isCompleted && !wasStoppedRef.current) {
                    autoResumeOnCutoff(finalized, currentState.currentCharacter.id, allPromptBlocks);
                    return;
                }

                runSummarization({
                    data: finalized,
                    setData: setInteractionData,
                    addToast,
                });

                const lm = finalized.interactionHistory[finalized.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== currentState.currentCharacter?.id) {
                    ui.playVoice(lm.textContent, lm.character);
                }
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud;
                await saveRawInteractionData(sd);
                setInteractionData(sd);
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
    }, [getState, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration, setStreamingState, setStats, setInteractionData, allCharacters, autoResumeOnCutoff]);

    const sendActionAndGetResponse = useCallback(async (actionText: string, targetChar: Character) => {
        const currentState = getState();
        if (!currentState.interactionData) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;
        wasStoppedRef.current = false;
        resetStream();
        setStreamingState(null, '');
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const chatMessage = createChatMessage(currentState.interactionData, targetChar, actionText);
            const td = addMessageToInteractionData(currentState.interactionData, chatMessage);

            setInteractionData(td);
            await saveRawInteractionData(td);

            const turnResult = await chatEngine.runTurn(td, ctrl);
            const ud = turnResult.interactionData;

            if (pendingPartialRef.current) {
                const fd = await applyPendingPartial(ud, currentState.interactionData.protagonist?.id ?? '');
                await saveRawInteractionData(fd);
                setInteractionData(fd);
                return;
            }

            if (ud.interactionHistory.length > td.interactionHistory.length) {
                const processed = processPendingToolActions(ud, allCharacters, { onToast: addToast });
                const finalized = finalizeLastAIMessage(processed, currentState.interactionData.protagonist?.id ?? '', wasStoppedRef.current);
                await saveRawInteractionData(finalized);
                setInteractionData(finalized);

                // Auto-resume if model cut off mid-generation
                if (!turnResult.isCompleted && !wasStoppedRef.current) {
                    autoResumeOnCutoff(finalized, currentState.interactionData.protagonist?.id ?? '');
                    return;
                }

                runSummarization({ data: finalized, setData: setInteractionData, addToast });

                const lm = finalized.interactionHistory[finalized.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== currentState.interactionData.protagonist?.id) {
                    ui.playVoice(lm.textContent, lm.character);
                }
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud;
                await saveRawInteractionData(sd);
                setInteractionData(sd);
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
    }, [getState, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration, setStreamingState, setStats, setInteractionData, allCharacters, autoResumeOnCutoff]);

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

                const withPartial = [...currentData.interactionHistory];
                withPartial[idx] = {
                    ...targetMsg,
                    textContent,
                    isPartial: true,
                    lastUpdatedTimestamp: Date.now()
                } as ChatMessage;

                if (paragraphs > 0) consumeChatStaminaForMessage(withPartial[idx], paragraphs);

                setState({
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
    }, [resetStream, getState, setState, streamingTextRef, isLoadingRef]);

    const resumeGeneration = useCallback(async (messageId: string, allPromptBlocks?: PromptBlock[]) => {
        const currentInteractionData = getState().interactionData;
        if (!currentInteractionData) return;
        const msgIndex = currentInteractionData.interactionHistory.findIndex(m => m.id === messageId);
        if (msgIndex === -1) { addToast('Message not found.', 'error'); return; }
        const msg = currentInteractionData.interactionHistory[msgIndex];
        if (msg.messageType !== 'chat' || !msg.isPartial) { addToast('Not partial — use Regenerate.', 'info'); return; }

        if (isLoadingRef.current) { abortControllerRef.current?.abort(); abortControllerRef.current = null; await new Promise(r => setTimeout(r, 100)); }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        const currentState = getState();
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const existingText = msg.textContent;
        const char = msg.character;
        resumingMessageIdRef.current = messageId;
        resumingExistingTextRef.current = existingText;
        wasStoppedRef.current = false;
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;

        setStreamingText(existingText);
        streamingTextRef.current = existingText;
        setStreamingState(char, existingText);
        setStats({ latency: 0, timeToFirstToken: 0 });
        isAtBottomRef.current = true;

        try {
            const result = await chatEngine.handleServerResponse(
                currentInteractionData, char, ctrl.signal,
                throttledSetStreamingText, undefined, existingText, allPromptBlocks
            );
            if (!result) return;

            const finalized = finalizeMessageById(result.interactionData, messageId, wasStoppedRef.current);

            setState({
                interactionData: finalized,
                streamingCharacter: null,
                streamingText: '',
            });

            await saveRawInteractionData(finalized);

            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';

            // Auto-resume if model cut off again during resume
            if (!result.isCompleted && !wasStoppedRef.current) {
                setTimeout(() => {
                    const reMarked = markLastAIMessageAsPartial(finalized, currentInteractionData.protagonist?.id ?? '');
                    if (reMarked) {
                        setInteractionData(reMarked.data);
                        saveRawInteractionData(reMarked.data);
                        resumeGeneration(reMarked.messageId, allPromptBlocks);
                    }
                }, 0);
                return;
            }

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
    }, [getState, setState, isLoadingRef, acquireLock, isModelReadyForGeneration, setStreamingText, streamingTextRef, addToast, releaseLock, chatEngine, throttledSetStreamingText, ui, setStreamingState, setStats, setInteractionData]);

    const regenerateFromMessage = useCallback(async (messageId: string, type: 'ai' | 'user', allPromptBlocks?: PromptBlock[]) => {
        const currentInteractionData = getState().interactionData;
        if (!currentInteractionData) { addToast('Chat data missing.', 'error'); return; }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        const currentState = getState();
        if (!currentState.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const protagonistId = currentInteractionData.protagonist?.id;
        if (!protagonistId) { addToast('No protagonist set.', 'error'); releaseLock(); return; }

        const history = currentInteractionData.interactionHistory;
        const ti = history.findIndex(m => m.id === messageId);
        if (ti === -1) { addToast('Message not found.', 'error'); releaseLock(); return; }
        const tm = history[ti];
        const isUserMessage = tm.character.id === protagonistId;
        let trimIdx: number;
        if (type === 'ai' && !isUserMessage) {
            trimIdx = ti;
        } else if (type === 'user' && isUserMessage) {
            trimIdx = ti + 1;
        } else {
            addToast(`Cannot regenerate a ${isUserMessage ? 'user' : 'AI'} message as ${type}.`, 'error');
            releaseLock();
            return;
        }

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

        try {
            const turnResult = await chatEngine.runTurn(td, ctrl, allPromptBlocks);
            const ud = turnResult.interactionData;
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, protagonistId); await saveRawInteractionData(fd); setInteractionData(fd); return; }

            if (ud.interactionHistory.length > preCount) {
                const processed = processPendingToolActions(ud, allCharacters, { onToast: addToast });
                const finalized = finalizeLastAIMessage(processed, protagonistId, wasStoppedRef.current);

                await saveRawInteractionData(finalized);
                setInteractionData(finalized);

                // Auto-resume if model cut off mid-generation
                if (!turnResult.isCompleted && !wasStoppedRef.current) {
                    autoResumeOnCutoff(finalized, protagonistId, allPromptBlocks);
                    return;
                }

                runSummarization({
                    data: finalized,
                    setData: setInteractionData,
                    addToast,
                });

                const lm = finalized.interactionHistory[finalized.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== protagonistId) ui.playVoice(lm.textContent, lm.character);
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud; await saveRawInteractionData(sd); setInteractionData(sd);
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Regen failed:', e); addToast(`Regen error: ${(e as Error).message}`, 'error'); } }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [getState, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration, setInteractionData, setStreamingState, setStats, allCharacters, autoResumeOnCutoff]);

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
        setActiveBudgetStrategy: setActiveStrategy,
        setSelectedGlobalModel: setSelectedModel,
        updateRunningModels,
    };
}