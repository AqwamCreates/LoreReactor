// frontend_src/hooks/useChatEngine.ts
import { useCallback, useMemo } from 'react';
import type { Character, InteractionData, PromptBlock, BudgetStrategy, BudgetData, LanguageModel } from '../types';
import { CharacterActor } from '../services/CharacterActor';
import { runTurnSequence } from '../services/InteractionOrchestrator';
import { CharacterSoul } from '../services/CharacterSoul';
import { getBudgetStrategyEngine, type RequestMetadata } from '../services/BudgetStrategyEngine';
import { updatePartialMessageInInteractionData } from '../utilities/chatLogic';
import type { ToolExecutionContext } from '../services/ToolExecutor';

const characterActor = new CharacterActor();
const characterSoul = new CharacterSoul();

export interface HandleServerResponseResult {
    interactionData: InteractionData;
    isCompleted: boolean;
    promptText?: string;
    rawText?: string;
    displayText?: string;
}

interface EngineDependencies {
    getState: () => any;
    setInteractionData: (d: InteractionData) => void;
    setStreamingState: (c: Character | null, t: string) => void;
    setBudgetData: (d: BudgetData) => void;
    setStats: (l: any) => void;
    setSelectedCharacterExpression: (e: string) => void;
    setLastSelectedModelId: (id: string | null) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    requestBorrowedModel?: () => Promise<LanguageModel | null>;
    getToolContext?: () => ToolExecutionContext;
    acquireLock?: () => boolean;
    releaseLock?: () => void;
}

export function useChatEngine(deps: EngineDependencies) {
    const { 
        getState, setInteractionData, setStreamingState, 
        setBudgetData, setStats, setSelectedCharacterExpression,
        setLastSelectedModelId, addToast, requestBorrowedModel,
        acquireLock, releaseLock,
    } = deps;

    const handleServerResponse = useCallback(async (
        data: InteractionData, 
        character: Character, 
        signal: AbortSignal,
        onToken?: (text: string) => void,
        strategyOverride?: BudgetStrategy | null,
        existingCharacterText?: string,
        allPromptBlocks?: PromptBlock[],
        metadata?: RequestMetadata,
    ): Promise<HandleServerResponseResult | null> => {
        const selectedModel = getState().selectedModel;
        const runningModels = getState().runningModels;
        const activeStrategy = getState().activeStrategy;

        const isResuming = !!existingCharacterText && existingCharacterText.length > 0;

        let borrowedModel: LanguageModel | null = null;
        if (requestBorrowedModel) {
            try {
                borrowedModel = await requestBorrowedModel();
            } catch (e) {
                console.warn('Failed to borrow model from peer:', e);
            }
        }

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
            onExpression: (expr: string) => setSelectedCharacterExpression(expr),
        };

        const outcome = await characterActor.executeTurn({
            data, character, signal, selectedModel, runningModels, activeStrategy,
            strategyOverride, existingCharacterText, allPromptBlocks: allPromptBlocks ?? [], 
            callbacks,
            borrowedModel,
            metadata,
            toolContext: deps.getToolContext?.(),
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
        
        return {
            interactionData: effectiveData,
            isCompleted: result.isCompleted,
            promptText: result.promptText,
            rawText: result.rawText,
            displayText: result.displayText,
        };
    }, [getState, setStreamingState, setStats, setSelectedCharacterExpression, setBudgetData, setLastSelectedModelId, setInteractionData, addToast, requestBorrowedModel, deps.getToolContext]);

    const runTurn = useCallback(async (
        initialData: InteractionData,
        signal: AbortController,
        promptBlocks?: PromptBlock[],
        metadata?: RequestMetadata,
        existingCharacterText?: string,
    ): Promise<{ interactionData: InteractionData; isCompleted: boolean; promptText?: string }> => {
        let lastPromptText: string | undefined = undefined;

        const executor = async (d: InteractionData, c: Character, s: AbortSignal, onToken?: (t: string) => void) => {
            setStreamingState(c, '');
            const result = await handleServerResponse(d, c, s, onToken, undefined, existingCharacterText || '', promptBlocks, metadata);
            
            if (result?.promptText) {
                lastPromptText = result.promptText;
            }
            
            return result;
        };

        const result = await runTurnSequence(
            initialData,
            executor,
            signal, 
            (character) => setStreamingState(character ?? null, ''),
            (data) => setInteractionData(data)
        );

        if (result) {
            setInteractionData(result.interactionData);
            return {
                interactionData: result.interactionData,
                isCompleted: result.isCompleted,
                promptText: lastPromptText,
            };
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
            return handleServerResponse(d, c, s, undefined, undefined, '', undefined, {});
        };
        
        characterSoul.start(
            executor, 
            checkCanAct, 
            getData, 
            setData,
            (character) => setStreamingState(character ?? null, ''),
            acquireLock,
            releaseLock
        );
    }, [handleServerResponse, setStreamingState, acquireLock, releaseLock]);

    const stopAutonomousMode = useCallback(() => {
        characterSoul.stop();
    }, []);

    return useMemo(() => ({
        handleServerResponse,
        runTurn,
        startAutonomousMode,
        stopAutonomousMode,
    }), [handleServerResponse, runTurn, startAutonomousMode, stopAutonomousMode]);
}