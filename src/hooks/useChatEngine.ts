// src/hooks/useChatEngine.ts
import { useCallback } from 'react';
import type { Character, InteractionData, PromptBlock, BudgetStrategy, ChatMessage, BudgetData } from '../types';
import { CharacterActor } from '../services/CharacterActor';
import { runTurnSequence } from '../services/InteractionOrchestrator';
import { AutonomousSimulationEngine } from '../services/AutonomousSimulationEngine';
import { getBudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { saveRawInteractionData } from '../storage/serverStorage';
import { findPreviousMessage, updatePartialMessageInInteractionData } from './chatLogic';
import { getCurrentLocationIndex } from './locationLogic';
import { v4 as uuidv4 } from 'uuid';
import { loadPendingToolActions } from '../services/ToolExecutor';

const characterActor = new CharacterActor();
const autonomousEngine = new AutonomousSimulationEngine();

interface EngineDependencies {
    getState: () => any;
    setInteractionData: (d: InteractionData) => void;
    setStreamingState: (c: Character | null, t: string) => void;
    setBudgetData: (d: BudgetData) => void;
    setStats: (l: any) => void;
    setCurrentCharacterExpression: (e: string) => void;
    setLastSelectedModelId: (id: string | null) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    processMemoryTrigger: (rawText: string, character: Character, data: InteractionData) => Promise<void>;
}

export function useChatEngine(deps: EngineDependencies) {
    const { 
        getState, setInteractionData, setStreamingState, 
        setBudgetData, setStats, setCurrentCharacterExpression,
        setLastSelectedModelId, addToast, processMemoryTrigger,
    } = deps;

    const processPendingTools = useCallback(async (data: InteractionData): Promise<InteractionData> => {
        let lastAiCharId: string | null = null;
        for (let i = data.interactionHistory.length - 1; i >= 0; i--) {
            const msg = data.interactionHistory[i];
            if (msg.messageType === 'chat' && msg.character.id !== data.protagonist.id) {
                lastAiCharId = msg.character.id;
                break;
            }
        }
        if (!lastAiCharId) return data;

        const charLastMsg = findPreviousMessage(data, lastAiCharId);
        if (!charLastMsg || charLastMsg.messageType !== 'chat') return data;
        const targetMsg = charLastMsg as ChatMessage;
        const actions = loadPendingToolActions(targetMsg.inventory);
        if (actions.length === 0) return data;

        const targetMsgIdx = data.interactionHistory.findIndex(m => m.id === targetMsg.id);
        if (targetMsgIdx === -1) return data;

        let updatedData = { ...data, interactionHistory: [...data.interactionHistory] };
        let changed = false;

        for (const action of actions) {
            switch (action.type) {
                case 'summon': {
                    const charId = action.payload.characterId;
                    if (!updatedData.participants.some(p => p.id === charId)) {
                        const placeholder: Character = {
                            id: charId, name: action.payload.characterName || 'Unknown', images: {},
                            initiativeWeight: 1, chatProbability: 0.5, maximumChatStamina: 4,
                            nameSensitivity: 1, chatImpatienceSensitivity: 0, skipProbability: 0,
                            memoryRetentionWeight: 1, contextSensitivity: 1, maximumActionStamina: 5,
                            tools: {} as Record<string, boolean>, enableMemoryWriting: false, enableMemoryReading: false,
                            clothings: [], memories: {}, numberOfMessagesToDisableThinkPrompt: 0, numberOfMessagesToDisableMetaThinkInstructions: 0,
                            numberOfMessagesToDisableDialoguePrompt: 0, numberOfMessagesToDisableStarterPrompt: 0,
                            firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
                        };
                        updatedData = { ...updatedData, participants: [...updatedData.participants, placeholder] };
                        changed = true;
                        addToast(`✨ ${action.payload.characterName} joined the session.`, 'info');
                    }
                    break;
                }
                case 'kick': {
                    updatedData = { ...updatedData, participants: updatedData.participants.filter(p => p.id !== action.payload.characterId) };
                    changed = true;
                    addToast(`👢 ${action.payload.characterName} was kicked from the session.`, 'info');
                    break;
                }
                case 'invite': {
                    const currentLocIdx = getCurrentLocationIndex(updatedData, targetMsg.character);
                    if (currentLocIdx !== undefined) {
                        const invitedChar = updatedData.participants.find(p => p.id === action.payload.characterId);
                        if (invitedChar) {
                            const inviteMsg = {
                                messageType: 'interaction' as const, id: uuidv4(), character: { ...invitedChar },
                                locationIndex: currentLocIdx, characterLockedLocations: {},
                                parentInteractionMessageId: updatedData.interactionHistory[updatedData.interactionHistory.length - 1]?.id ?? null,
                                firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
                            };
                            updatedData = { ...updatedData, interactionHistory: [...updatedData.interactionHistory, inviteMsg] };
                            changed = true;
                            addToast(`📨 ${action.payload.characterName} arrived at the current location.`, 'info');
                        }
                    }
                    break;
                }
                case 'administrator_move_protagonist': addToast("🔧 Transfer requested.", 'info'); break;
                case 'administrator_switch_model': addToast("🔧 Model switch requested.", 'info'); break;
                case 'creator': addToast("🛠️ Creation requested.", 'info'); break;
                case 'destroyer': addToast("💀 Deletion requested.", 'info'); break;
            }
        }

        if (!changed) return data;

        const cleanedHistory = [...updatedData.interactionHistory];
        const cleanedMsg = { ...cleanedHistory[targetMsgIdx] } as ChatMessage;
        const cleanedInventory = cleanedMsg.inventory ? { ...cleanedMsg.inventory } : {};
        delete cleanedInventory['__pending_tool_actions__'];
        if (Object.keys(cleanedInventory).length === 0) delete cleanedMsg.inventory;
        else cleanedMsg.inventory = cleanedInventory;
        
        cleanedHistory[targetMsgIdx] = cleanedMsg;
        return { ...updatedData, interactionHistory: cleanedHistory, lastUpdatedTimestamp: Date.now() };
    }, [addToast]);

    const handleServerResponse = useCallback(async (
        data: InteractionData, 
        character: Character, 
        signal: AbortSignal,
        onToken?: (text: string) => void,
        strategyOverride?: BudgetStrategy | null,
        existingCharacterText?: string,
        allPromptBlocks?: PromptBlock[],
    ): Promise<InteractionData | null> => {
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
            strategyOverride, existingCharacterText, allPromptBlocks: allPromptBlocks ?? [], callbacks,
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

        // Surface last selected model from budget engine to store
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

        if (result.rawText) {
            await processMemoryTrigger(result.rawText, character, effectiveData);
        }
        
        return effectiveData;
    }, [getState, setStreamingState, setStats, setCurrentCharacterExpression, setBudgetData, setLastSelectedModelId, setInteractionData, addToast, processMemoryTrigger]);

    const runTurn = useCallback(async (
        initialData: InteractionData,
        signal: AbortController,
        promptBlocks?: PromptBlock[]
    ) => {
        const executor = async (d: InteractionData, c: Character, s: AbortSignal, onToken: (t: string) => void) => {
            setStreamingState(c, '');
            return handleServerResponse(d, c, s, onToken, undefined, '', promptBlocks);
        };

        const finalData = await runTurnSequence(
            initialData, 
            executor, 
            signal, 
            (char) => setStreamingState(char, ''), 
            () => {}, 
            (data) => setInteractionData(data)
        );

        if (finalData) {
            const processed = await processPendingTools(finalData);
            await saveRawInteractionData(processed);
            setInteractionData(processed);
            return processed;
        }
        return initialData;
    }, [handleServerResponse, setStreamingState, setInteractionData, processPendingTools]);

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
        processPendingTools,
    };
}