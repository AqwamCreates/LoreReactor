// src/hooks/useChatEngine.ts
import { useCallback } from 'react';
import type { Character, InteractionData, PromptBlock, BudgetStrategy, BudgetData } from '../types';
import { CharacterActor } from '../services/CharacterActor';
import { runTurnSequence } from '../services/InteractionOrchestrator';
import { AutonomousSimulationEngine } from '../services/AutonomousSimulationEngine';
import { getBudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { saveRawInteractionData } from '../storage/serverStorage';
import { updatePartialMessageInInteractionData } from './chatLogic';

const characterActor = new CharacterActor();
const autonomousEngine = new AutonomousSimulationEngine();

export interface HandleServerResponseResult {
    interactionData: InteractionData;
    isCompleted: boolean;
}

interface EngineDependencies {
    getState: () => any;
    setInteractionData: (d: InteractionData) => void;
    setStreamingState: (c: Character | null, t: string) => void;
    setBudgetData: (d: BudgetData) => void;
    setStats: (l: any) => void;
    setCurrentCharacterExpression: (e: string) => void;
    setLastSelectedModelId: (id: string | null) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useChatEngine(deps: EngineDependencies) {
    const { 
        getState, setInteractionData, setStreamingState, 
        setBudgetData, setStats, setCurrentCharacterExpression,
        setLastSelectedModelId, addToast,
    } = deps;

    const handleServerResponse = useCallback(async (
        data: InteractionData, 
        character: Character, 
        signal: AbortSignal,
        onToken?: (text: string) => void,
        strategyOverride?: BudgetStrategy | null,
        existingCharacterText?: string,
        allPromptBlocks?: PromptBlock[],
        frontCameraImageBase64?: string,
    ): Promise<HandleServerResponseResult | null> => {
        const selectedModel = getState().selectedModel;
        const runningModels = getState().runningModels;
        const activeStrategy = getState().activeStrategy;

        const isResuming = !!existingCharacterText && existingCharacterText.length > 0;

        const callbacks = {
            onDisplayText: (text: string) => {
                setStreamingState(character, text);
                onToken?.(text);

                if (isResuming) {
                    const currentState = getState();
                    const currentData = currentState.interactionData;
                    if (currentData) {
                        const updated = updatePartialMessageInInteractionData(
                            currentData, character.id, text
                        );
                        if (updated !== currentData) {
                            setInteractionData(updated);
                        }
                    }
                }
            },
            onLatency: (ms: number) => setStats({ latency: ms }),
            onTimeToFirstToken: (ms: number) => setStats({ timeToFirstToken: ms }),
            onExpression: (expr: string) => setCurrentCharacterExpression(expr),
        };

        const outcome = await characterActor.executeTurn({
            data, character, signal, selectedModel, runningModels, activeStrategy,
            strategyOverride, existingCharacterText, allPromptBlocks: allPromptBlocks ?? [], frontCameraImageBase64, 
            callbacks,
        });

        if ('error' in outcome) {
            const { error } = outcome;
            if (error.type === 'aborted') return null;
            if (error.type === 'network') addToast('⚠️ Backend Connection Failed.', 'error');
            else if (error.type === 'no_model') addToast(error.message, 'error');
            else if (error.type === 'budget') addToast(error.message, 'error');
            else addToast(`Inference Error: ${error.message}`, 'error');
            return null;
        }

        const { result } = outcome;
        if (result.budgetData) setBudgetData(result.budgetData);

        if (activeStrategy) {
            try {
                const bse = getBudgetStrategyEngine();
                const lastId = bse.getLastSelectedModelId();
                if (lastId) setLastSelectedModelId(lastId);
            } catch { /* engine not initialized yet */ }
        }

        setStats((prev: any) => ({
            ...prev,
            numberOfCacheInvalidations: prev.numberOfCacheInvalidations + result.statsDelta.numberOfCacheInvalidations,
            numberOfRequests: prev.numberOfRequests + result.statsDelta.numberOfRequests,
            totalCost: prev.totalCost + result.statsDelta.totalCost,
            costWithoutCacheMisses: prev.costWithoutCacheMisses + result.statsDelta.costWithoutCacheMisses,
        }));

        const effectiveData = isResuming
            ? (getState().interactionData ?? result.updatedData)
            : result.updatedData;
        
        return { interactionData: effectiveData, isCompleted: result.isCompleted };
    }, [getState, setStreamingState, setStats, setCurrentCharacterExpression, setBudgetData, setLastSelectedModelId, setInteractionData, addToast]);

    const runTurn = useCallback(async (
        initialData: InteractionData,
        signal: AbortController,
        promptBlocks?: PromptBlock[],
        frontCameraImageBase64?: string,
    ): Promise<{ interactionData: InteractionData; isCompleted: boolean }> => {
        const executor = async (d: InteractionData, c: Character, s: AbortSignal, onToken: (t: string) => void) => {
            setStreamingState(c, '');
            return handleServerResponse(d, c, s, onToken, undefined, '', promptBlocks, frontCameraImageBase64);
        };

        const result = await runTurnSequence(
            initialData, 
            executor, 
            signal, 
            (char) => setStreamingState(char, ''), 
            () => {}, 
            (data) => setInteractionData(data)
        );

        if (result) {
            await saveRawInteractionData(result.interactionData);
            setInteractionData(result.interactionData);
            return result;
        }
        return { interactionData: initialData, isCompleted: true };
    }, [handleServerResponse, setStreamingState, setInteractionData]);

    const startAutonomousMode = useCallback((
        checkCanAct: () => boolean,
        getData: () => InteractionData | null,
        setData: (data: InteractionData) => void,
        resetStream: () => void
    ) => {
        const executor = async (d: InteractionData, c: Character, s: AbortSignal) => {
            resetStream();
            setStreamingState(c, '');
            return handleServerResponse(d, c, s, undefined, undefined, '');
        };
        autonomousEngine.start(executor, checkCanAct, getData, setData);
    }, [handleServerResponse, setStreamingState]);

    const stopAutonomousMode = useCallback(() => {
        autonomousEngine.stop();
    }, []);

    return {
        handleServerResponse,
        runTurn,
        startAutonomousMode,
        stopAutonomousMode,
    };
}