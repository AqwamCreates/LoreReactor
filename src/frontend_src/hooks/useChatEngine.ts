// src/frontend_src/hooks/useChatEngine.ts
import { useCallback, useMemo } from 'react';
import type { Character, InteractionData, PromptBlock, BudgetStrategy, BudgetData, LanguageModel } from '../types';
import { CharacterActor } from '../services/CharacterActor';
import { runTurnSequence } from '../services/InteractionOrchestrator';
import { CharacterSoul } from '../services/CharacterSoul';
import { getBudgetStrategyEngine, type RequestMetadata } from '../services/BudgetStrategyEngine';
import { updatePartialMessageInInteractionData } from '../utilities/interactionDataLogic';
import type { ToolExecutionContext } from '../services/ToolExecutor';
import type { StreamingVoiceTracker } from '../services/StreamingVoiceTracker';
import { useSessionStore } from './useSessionStore';

const characterActor = new CharacterActor();
const characterSoul = new CharacterSoul();

export interface HandleServerResponseResult {
    interactionData: InteractionData;
    isCompleted: boolean;
    promptText?: string;
    rawText?: string;
    displayText?: string;
}

// ✅ PHASE 1: Unified Context Object for the Generation Pipeline
export interface TurnContext {
    promptBlocks: PromptBlock[];
    metadata?: RequestMetadata;
    existingText?: string;
    prefillText?: string;
    voiceTracker?: StreamingVoiceTracker;
    forcedSpeakerId?: string;
    toolContext: ToolExecutionContext;
    strategyOverride?: BudgetStrategy | null;
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
        context: TurnContext,
        onToken?: (text: string) => void,
    ): Promise<HandleServerResponseResult | null> => {
        const selectedModel = getState().selectedModel;
        const runningModels = getState().runningModels;
        const activeStrategy = getState().activeStrategy;

        const isResuming = !!context.existingText && context.existingText.length > 0;

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

        // Map the unified TurnContext to the Actor's specific execution params
        const outcome = await characterActor.executeTurn({
            data, 
            character, 
            signal, 
            selectedModel, 
            runningModels, 
            activeStrategy,
            strategyOverride: context.strategyOverride, 
            existingCharacterText: context.existingText, 
            prefillText: context.prefillText,
            allPromptBlocks: context.promptBlocks, 
            callbacks,
            borrowedModel,
            metadata: context.metadata,
            toolContext: context.toolContext,
            voiceTracker: context.voiceTracker,
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

        const liveProfile = getState().interactionData?.profile;
        const baseUpdated = isResuming
            ? (getState().interactionData ?? result.updatedData)
            : result.updatedData;

        const effectiveData: InteractionData = {
            ...baseUpdated,
            profile: liveProfile ?? baseUpdated.profile,
        };
        
        setInteractionData(effectiveData);

        useSessionStore.setState({
            isLoading: false,
            streamingCharacter: null,
            streamingText: '',
        });

        const narrationBehaviour = data.profile?.textGenerationBehaviourOnNarration ?? 'wait';
        if (context.voiceTracker && narrationBehaviour === 'wait') {
            try {
                await context.voiceTracker.waitForPlaybackCompletion();
            } catch (e) {
                console.warn('[useChatEngine] Voice playback completion error:', e);
            }
        }

        return {
            interactionData: effectiveData,
            isCompleted: result.isCompleted,
            promptText: result.promptText,
            rawText: result.rawText,
            displayText: result.displayText,
        };
    }, [getState, setStreamingState, setStats, setSelectedCharacterExpression, setBudgetData, setLastSelectedModelId, setInteractionData, addToast, requestBorrowedModel]);

    const runTurn = useCallback(async (
        initialData: InteractionData,
        signal: AbortController,
        context: TurnContext,
    ): Promise<{ interactionData: InteractionData; isCompleted: boolean; promptText?: string }> => {
        let lastPromptText: string | undefined = undefined;

        const executor = async (d: InteractionData, c: Character, s: AbortSignal, onToken?: (t: string) => void) => {
            setStreamingState(c, '');
            const result = await handleServerResponse(d, c, s, context, onToken);
            
            if (result?.promptText) {
                lastPromptText = result.promptText;
            }
            
            return result;
        };

        const result = await runTurnSequence(
            initialData,
            executor,
            signal, 
            context, // ✅ Pass context to orchestrator
            (character) => setStreamingState(character ?? null, ''),
            (data) => setInteractionData(data),
            { forcedSpeakerId: context.forcedSpeakerId }
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
        resetStream: () => void,
        toolContext: ToolExecutionContext
    ) => {
        const executor = async (d: InteractionData, c: Character, s: AbortSignal, ctx: TurnContext) => {
            resetStream();
            setStreamingState(c, '');
            return handleServerResponse(d, c, s, ctx);
        };
        
        // Create a base context for autonomous mode
        const autoContext: TurnContext = {
            promptBlocks: [],
            toolContext,
        };

        characterSoul.start(
            executor, 
            checkCanAct, 
            getData, 
            setData,
            autoContext,
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