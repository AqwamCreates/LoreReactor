// frontend_src/hooks/useChatSessionEffects.ts
import { useEffect, type MutableRefObject } from 'react';
import type { InteractionData, LanguageModel, BudgetData } from '../types';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getBudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { loadRawBudgetData } from '../storages/serverStorage';
import { getGlobalMessageHistory } from '../utilities/timelineLogic';
import { hasTextContent } from '../utilities/chatSessionLogic';
import { localURL } from '../../configurations';

interface ChatSessionEffectsParams {
    interactionData: InteractionData | null;
    selectedModel: LanguageModel | null;
    autonomousMode: boolean;
    isMultiplayerClient: boolean;
    requestPeerInferenceRef: MutableRefObject<((peerAccountId: string, modelName: string, promptOrMessages: any, onToken: (token: string) => void, signal?: AbortSignal) => Promise<void>) | undefined>;
    isLoadingRef: MutableRefObject<boolean>;
    abortControllerRef: MutableRefObject<AbortController | null>;
    setBudgetData: (data: BudgetData) => void;
    updateRunningModels: (models: Record<string, { isRunning: boolean; port?: number }>) => void;
    setNumberOfTokens: (tokens: number) => void;
    getState: () => any;
    setState: (state: any) => void;
    resetStream: () => void;
    chatEngine: any;
    addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function useChatSessionEffects({
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
}: ChatSessionEffectsParams) {
    const engine = getLanguageModelEngine();

    // 1. Peer Inference Protocol Binding
    useEffect(() => {
        const engineInstance = getLanguageModelEngine();
        if (typeof (engineInstance as any).setPeerInferenceHandler === 'function') {
            (engineInstance as any).setPeerInferenceHandler(async (modelId: string, prompt: any, onToken: (token: string) => void, signal?: AbortSignal) => {
                if (modelId.startsWith('borrowed-')) {
                    const parts = modelId.split('-');
                    const ownerAccountId = parts[1];
                    if (ownerAccountId && requestPeerInferenceRef.current) {
                        await requestPeerInferenceRef.current(ownerAccountId, modelId, prompt, onToken, signal);
                        return true;
                    }
                }
                return false;
            });
        }
        return () => {
            if (typeof (engineInstance as any).setPeerInferenceHandler === 'function') {
                (engineInstance as any).setPeerInferenceHandler(undefined);
            }
        };
    }, [requestPeerInferenceRef]);

    // 2. Budget Data Hydration
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const bd = await loadRawBudgetData();
                if (!cancelled && bd) setBudgetData(bd);
            } catch (e) {
                console.warn('Failed to load budget data:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [setBudgetData]);

    // 3. Model Status Polling
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch(`${localURL}/language_models/status`);
                if (!response.ok || cancelled) return;
                const data = await response.json();
                const status: Record<string, { isRunning: boolean; port?: number }> = {};
                for (const m of data.activeModels || []) status[m.id] = { isRunning: true, port: m.port };
                if (!cancelled) updateRunningModels(status);
            } catch (e) {
                if (!cancelled) addToast(`Failed to fetch models status: ${e}`);
            }
        })();
        return () => { cancelled = true; };
    }, [updateRunningModels, addToast]);

    // 4. Model Context Sync
    useEffect(() => {
        if (selectedModel) engine.setContext(selectedModel);
    }, [selectedModel, engine]);

    // 5. Context Token Accounting (Debounced to prevent cloud tokenize API spamming)
    useEffect(() => {
        if (!interactionData) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            let total = 0;
            const history = getGlobalMessageHistory(interactionData);
            for (const m of history) {
                if (hasTextContent(m)) total += await engine.countTokens(m.textContent);
            }
            if (!cancelled) setNumberOfTokens(total);
        }, 300);

        return () => { 
            cancelled = true; 
            clearTimeout(timer);
        };
    }, [interactionData, setNumberOfTokens, engine]);

    // 6. Autonomous Simulation Lifecycle
    const activeChatId = interactionData?.id;
    const { startAutonomousMode, stopAutonomousMode } = chatEngine;

    useEffect(() => {
        if (autonomousMode && activeChatId && !isMultiplayerClient) {
            const checkCanAct = () => !isLoadingRef.current && !abortControllerRef.current;
            startAutonomousMode(
                checkCanAct,
                () => getState().interactionData,
                (data: InteractionData) => { setState({ interactionData: data }); },
                resetStream
            );
        } else {
            stopAutonomousMode();
        }
        return () => { stopAutonomousMode(); };
    }, [autonomousMode, activeChatId, isMultiplayerClient, startAutonomousMode, stopAutonomousMode, isLoadingRef, abortControllerRef, resetStream, getState, setState]);

    // 7. Persist Factorization Machine Weights on Window Unload
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
}