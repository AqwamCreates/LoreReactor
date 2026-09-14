// src/hooks/useChatSession.tsx
import { useRef, useCallback, useEffect } from 'react';
import { useChatState } from './useChatState';
import { useChatEngine } from './useChatEngine';
import { useChatUI } from './useChatUI';
import { useToast } from '../context/ToastContext';
import { createChatMessage, addMessageToInteractionData, convertIdsToDisplayNames, createNewInteractionData, editInteractionMessageInInteractionData } from './chatLogic';
import { runSummarization } from '../services/SummarizationEngine';
import { clearPartialFlag } from './messageLogic';
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
import type { Character, InteractionData, PromptBlock } from '../types';

const engine = getLanguageModelEngine();

export function useChatSession() {
    const { addToast } = useToast();
    
    // 1. State
    const state = useChatState();
    
    // --- Refs (Defined here to be stable and mutable) ---
    const abortControllerRef = useRef<AbortController | null>(null);
    const isProcessingSilentlyRef = useRef(false);
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);
    const previousExpressionRef = useRef<string>('neutral');
    const resumingMessageIdRef = useRef<string | null>(null);
    const resumingExistingTextRef = useRef<string>('');
    const activeStrategyIdRef = useRef<string | null>(null);
    
    // THIS IS THE FIX: Define isAtBottomRef here
    const isAtBottomRef = useRef(true);

    // 2. UI (Scroll, Audio) - Pass the ref down
    const ui = useChatUI(state.interactionData, state.isLoading, state.streamingText, isAtBottomRef);
    
    // 3. Engine (Logic)
    const chatEngine = useChatEngine({
        getState: state.getState,
        setInteractionData: state.setInteractionData,
        setStreamingState: state.setStreamingState,
        setBudgetData: state.setBudgetData,
        setStats: state.setStats,
        setCurrentCharacterExpression: state.setCurrentCharacterExpression,
        addToast,
    });

    // --- Local Hooks ---
    const { throttledSetStreamingText, setStreamingText, streamingTextRef, resetStream } = useThrottledStream();
    const { acquireLock, releaseLock, isLoadingRef } = useCharacterResponseLock();
    const { generateAmbientNarration } = useAmbientNarration(state.setStreamingState, setStreamingText, streamingTextRef);
    const { processMemoryTrigger } = useMemoryTrigger();

    // --- Mount Effects ---
    useEffect(() => {
        (async () => {
            try {
                const bd = await loadRawBudgetData();
                if (bd) state.setBudgetData(bd);
            } catch (e) { console.warn('Failed to load budget data:', e); }
        })();
    }, [state.setBudgetData]);

    useEffect(() => {
        (async () => {
            try {
                const response = await fetch(`${localURL}/models/status`);
                if (!response.ok) return;
                const data = await response.json();
                const status: Record<string, { isRunning: boolean; port?: number }> = {};
                for (const m of data.activeModels || []) status[m.id] = { isRunning: true, port: m.port };
                state.updateRunningModels(status);
            } catch (e) { addToast(`Failed to fetch models status: ${e}`); }
        })();
    }, [state.updateRunningModels, addToast]);

    useEffect(() => {
        if (state.selectedModel) engine.setContext(state.selectedModel);
    }, [state.selectedModel]);

    useEffect(() => {
        if (!state.interactionData) return;
        let cancelled = false;
        (async () => {
            let total = 0;
            for (const m of state.interactionData.interactionHistory) {
                if (m.messageType === 'chat') total += await engine.countTokens(m.textContent);
            }
            if (!cancelled) state.setNumberOfTokens(total);
        })();
        return () => { cancelled = true; };
    }, [state.interactionData?.interactionHistory, state.interactionData, state.setNumberOfTokens]);

    // --- Autonomous Mode ---
    useEffect(() => {
        const autonomousEnabled = state.interactionData?.Profile?.autonomousMode ?? false;
        if (autonomousEnabled && state.interactionData) {
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
    }, [state.interactionData?.Profile?.autonomousMode, chatEngine, isLoadingRef, resetStream, state.getState, state.setState]);

    // --- Helpers ---
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
                ph[ph.length - 1] = { ...lastMsg, textContent: dt, isPartial: true };
                return { ...base, interactionHistory: ph, lastUpdatedTimestamp: Date.now() };
            }
        }
        const chatMessage = createChatMessage(base, p.character, dt, { isPartial: true });
        return addMessageToInteractionData(base, chatMessage);
    }, []);

    // --- Public Actions ---
    const sendMessage = useCallback(async (text: string, files?: File[], allPromptBlocks?: PromptBlock[]) => {
        if (!state.interactionData || !state.currentCharacter || (!text.trim() && (!files || !files.length))) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!state.activeStrategy && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const ctrl = new AbortController(); 
        abortControllerRef.current = ctrl;
        resetStream();
        state.setStreamingState(null, '');
        state.setStats({ latency: 0, timeToFirstToken: 0 }); 
        
        // SAFE: Modifying the ref defined in this scope
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
                // processPendingTools is now in chatEngine
                const processed = await chatEngine.processPendingTools(ud);
                await saveRawInteractionData(processed); 
                state.setInteractionData(processed);
                
                runSummarization({
                    data: processed,
                    setData: state.setInteractionData,
                    addToast,
                });
                
                const lm = processed.interactionHistory[processed.interactionHistory.length - 1];
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
    }, [state, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration, isAtBottomRef]);

    const stopGeneration = useCallback(() => {
        const t = streamingTextRef.current;
        const c = state.getState().streamingCharacter;
        const resumeId = resumingMessageIdRef.current;
        const currentData = state.getState().interactionData;

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
                state.setInteractionData({ ...updated, interactionHistory: withPartial, lastUpdatedTimestamp: Date.now() });
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
        state.setStats({ latency: 0, timeToFirstToken: 0 });
    }, [releaseLock, resetStream, state, streamingTextRef]);

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
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        
        setStreamingText(existingText); 
        streamingTextRef.current = existingText;
        state.setStreamingState(char, '');
        state.setStats({ latency: 0, timeToFirstToken: 0 }); 
        
        // SAFE
        isAtBottomRef.current = true;

        try {
            const result = await chatEngine.handleServerResponse(currentInteractionData, char, ctrl.signal, throttledSetStreamingText, undefined, existingText, allPromptBlocks);
            if (!result) return;
            const finalData = await clearPartialFlag(result, messageId);
            const processed = await chatEngine.processPendingTools(finalData);
            state.setInteractionData(processed);
            await saveRawInteractionData(processed);
            
            const finalMsg = processed.interactionHistory.find(m => m.id === messageId);
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
        
        // SAFE
        isAtBottomRef.current = true;
        
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        const preCount = td.interactionHistory.length;

        try {
            const ud = await chatEngine.runTurn(td, ctrl, allPromptBlocks);
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, currentInteractionData.protagonist.id); await saveRawInteractionData(fd); state.setInteractionData(fd); return; }
            
            if (ud.interactionHistory.length > preCount) {
                const processed = await chatEngine.processPendingTools(ud);
                await saveRawInteractionData(processed); state.setInteractionData(processed);
                runSummarization({
                    data: processed,
                    setData: state.setInteractionData,
                    addToast,
                });
                const lm = processed.interactionHistory[processed.interactionHistory.length - 1];
                if (lm && lm.messageType === 'chat' && lm.character.id !== currentChar?.id) ui.playVoice(lm.textContent, lm.character);
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud; await saveRawInteractionData(sd); state.setInteractionData(sd);
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Regen failed:', e); addToast(`Regen error: ${(e as Error).message}`, 'error'); } }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [state, chatEngine, ui, addToast, acquireLock, releaseLock, isModelReadyForGeneration, resetStream, applyPendingPartial, generateAmbientNarration, isAtBottomRef]);

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
        sendActionAndGetResponse: sendMessage,
        setActiveBudgetStrategy: state.setActiveStrategy,
        setSelectedGlobalModel: state.setSelectedModel,
        updateRunningModels: state.updateRunningModels,
        processProtagonistImageSilently,
    };
}