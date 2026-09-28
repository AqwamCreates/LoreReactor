// src/hooks/useSessionEffects.ts
import { useEffect } from 'react';
import type { BudgetData, BudgetStrategy, Character, LanguageModel } from '../types';
import { saveRawSessionData } from '../storages/serverStorage';
import { getBudgetStrategyEngine, initializeBudgetStrategyEngine } from '../services/BudgetStrategyEngine';

interface UseSessionEffectsOptions {
    interactionDataId: string | null | undefined;
    isMultiplayerClient: boolean;
    selectedModelId: string | null;
    setSelectedModelId: (id: string | null) => void;
    selectedBudgetStrategyId: string | null;
    allBudgetStrategies: BudgetStrategy[];
    setActiveBudgetStrategy: (strategy: BudgetStrategy | null) => void;
    allModels: LanguageModel[];
    runningModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    setSelectedGlobalModel: (model: LanguageModel | null) => void;
    selectedCharacterId: string | null;
    allCharacters: Character[];
    currentCharacterId: string | null | undefined;
    setCurrentCharacter: (char: Character | null) => void;
    activeStrategy: BudgetStrategy | null;
    budgetData: BudgetData | null;
    loadLocalModelForBudgetStrategyEngine: (modelId: string) => Promise<number | null>;
}

export function useSessionEffects(options: UseSessionEffectsOptions) {
    const {
        interactionDataId, isMultiplayerClient, selectedModelId, setSelectedModelId,
        selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy,
        allModels, runningModels, setSelectedGlobalModel,
        selectedCharacterId, allCharacters, currentCharacterId, setCurrentCharacter,
        activeStrategy, budgetData, loadLocalModelForBudgetStrategyEngine,
    } = options;

    // Persist active chat ID when it changes
    useEffect(() => {
        if (isMultiplayerClient) return;
        if (interactionDataId) {
            saveRawSessionData({ activeChatId: interactionDataId });
        }
    }, [interactionDataId, isMultiplayerClient]);

    // Persist selected model ID when it changes
    useEffect(() => {
        saveRawSessionData({ selectedModelId: selectedModelId ?? null });
    }, [selectedModelId]);

    // Activate budget strategy when selectedBudgetStrategyId changes
    useEffect(() => {
        if (!selectedBudgetStrategyId || allBudgetStrategies.length === 0) return;
        const strategy = allBudgetStrategies.find(s => s.id === selectedBudgetStrategyId);
        if (!strategy) {
            saveRawSessionData({ selectedBudgetStrategyId: null });
            return;
        }
        setActiveBudgetStrategy(strategy);
    }, [selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy]);

    // Clear selected model if it's no longer running (local models only)
    useEffect(() => {
        if (!selectedModelId || allModels.length === 0) return;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (!selectedModel) { setSelectedModelId(null); return; }
        const isCloudModel = selectedModel.apiKey && selectedModel.backend;
        if (isCloudModel) return;
        if (!runningModels[selectedModelId]?.isRunning) setSelectedModelId(null);
    }, [selectedModelId, allModels, runningModels, setSelectedModelId]);

    // Apply default character when it changes
    useEffect(() => {
        if (isMultiplayerClient) return;
        if (selectedCharacterId && allCharacters.length > 0) {
            const defaultChar = allCharacters.find(c => c.id === selectedCharacterId);
            if (defaultChar && currentCharacterId !== defaultChar.id) {
                setCurrentCharacter(defaultChar);
            }
        }
    }, [selectedCharacterId, allCharacters, currentCharacterId, setCurrentCharacter, isMultiplayerClient]);

    // Sync selected model to global model with runtime port
    useEffect(() => {
        if (selectedModelId && runningModels[selectedModelId]?.isRunning) {
            const foundModel = allModels.find(m => m.id === selectedModelId);
            const portNumber = runningModels[selectedModelId].port;
            if (foundModel && portNumber) {
                setSelectedGlobalModel({ ...foundModel, parameters: { ...foundModel.parameters, _runtimePort: portNumber } });
            }
        } else if (selectedModelId) {
            setSelectedGlobalModel(allModels.find(m => m.id === selectedModelId) || null);
        } else {
            setSelectedGlobalModel(null);
        }
    }, [selectedModelId, runningModels, allModels, setSelectedGlobalModel]);

    // Initialize/update budget strategy engine
    useEffect(() => {
        if (!activeStrategy || !budgetData) return;
        
        try {
            const engine = getBudgetStrategyEngine();
            engine.setStrategy(activeStrategy);
            engine.setBudgetData(budgetData);
            engine.setRunningModels(runningModels);
            engine.setAllModels(allModels);
            engine.setLoadLocalModel(loadLocalModelForBudgetStrategyEngine);
        } catch {
            initializeBudgetStrategyEngine(activeStrategy, budgetData, runningModels, allModels, loadLocalModelForBudgetStrategyEngine);
        }
    }, [activeStrategy, budgetData, allModels, runningModels, loadLocalModelForBudgetStrategyEngine]);
}