// frontend_src/hooks/useSessionEffects.ts
import { useEffect, useRef } from 'react';
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
    allLanguageModels: LanguageModel[];
    runningModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    setSelectedGlobalModel: (model: LanguageModel | null) => void;
    selectedCharacterId: string | null;
    selectedProfileId: string | null | undefined;
    allCharacters: Character[];
    setSelectedCharacter: (char: Character | null) => void;
    activeStrategy: BudgetStrategy | null;
    budgetData: BudgetData | null;
    loadLocalModelForBudgetStrategyEngine: (modelId: string) => Promise<number | null>;
}

export function useSessionEffects(options: UseSessionEffectsOptions) {
    const {
        interactionDataId, isMultiplayerClient, selectedModelId, setSelectedModelId,
        selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy,
        allLanguageModels, runningModels, setSelectedGlobalModel,
        selectedCharacterId, selectedProfileId, allCharacters, setSelectedCharacter,
        activeStrategy, budgetData, loadLocalModelForBudgetStrategyEngine,
    } = options;

    const isInitialMount = useRef(true);

    // Persist active chat ID when it changes
    useEffect(() => {
        if (isMultiplayerClient) return;
        if (interactionDataId) {
            saveRawSessionData({ activeChatId: interactionDataId });
        }
    }, [interactionDataId, isMultiplayerClient]);

    // Persist active profile ID
    useEffect(() => {
        if (isMultiplayerClient) return;
        if (selectedProfileId) {
            saveRawSessionData({ selectedProfileId });
        }
    }, [selectedProfileId, isMultiplayerClient]);

    // Persist selected model ID (skips initial empty mount to avoid overwriting stored value)
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            if (selectedModelId) {
                saveRawSessionData({ selectedModelId });
            }
            return;
        }
        saveRawSessionData({ selectedModelId: selectedModelId ?? null });
    }, [selectedModelId]);

    // Activate or cleanly deactivate budget strategy when selectedBudgetStrategyId changes
    useEffect(() => {
        if (!selectedBudgetStrategyId) {
            // FIX: Explicitly nullify active strategy when no strategy is selected
            setActiveBudgetStrategy(null);
            return;
        }
        if (allBudgetStrategies.length === 0) return;

        const strategy = allBudgetStrategies.find(s => s.id === selectedBudgetStrategyId);
        if (!strategy) {
            setActiveBudgetStrategy(null);
            saveRawSessionData({ selectedBudgetStrategyId: null });
            return;
        }
        setActiveBudgetStrategy(strategy);
    }, [selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy]);

    // Clear selected model if it's no longer running (local models only)
    useEffect(() => {
        if (!selectedModelId || allLanguageModels.length === 0) return;
        const selectedModel = allLanguageModels.find(m => m.id === selectedModelId);
        if (!selectedModel) { 
            setSelectedModelId(null); 
            return; 
        }
        const isCloudModel = !!(selectedModel.apiKey && selectedModel.backend);
        if (isCloudModel) return;
        
        if (!runningModels[selectedModelId]?.isRunning) {
            setSelectedModelId(null);
        }
    }, [selectedModelId, allLanguageModels, runningModels, setSelectedModelId]);

    // Apply default character when selectedCharacterId changes
    useEffect(() => {
        if (isMultiplayerClient) return;
        if (selectedCharacterId && allCharacters.length > 0) {
            const defaultChar = allCharacters.find(c => c.id === selectedCharacterId);
            if (defaultChar) {
                setSelectedCharacter(defaultChar);
            }
        }
    }, [selectedCharacterId, allCharacters, setSelectedCharacter, isMultiplayerClient]);

    // Sync selected model to global model with runtime port
    useEffect(() => {
        if (selectedModelId && runningModels[selectedModelId]?.isRunning) {
            const foundModel = allLanguageModels.find(m => m.id === selectedModelId);
            const portNumber = runningModels[selectedModelId].port;
            if (foundModel && portNumber) {
                setSelectedGlobalModel({ ...foundModel, parameters: { ...foundModel.parameters, _runtimePort: portNumber } });
            }
        } else if (selectedModelId) {
            setSelectedGlobalModel(allLanguageModels.find(m => m.id === selectedModelId) || null);
        } else {
            setSelectedGlobalModel(null);
        }
    }, [selectedModelId, runningModels, allLanguageModels, setSelectedGlobalModel]);

    // Initialize/update budget strategy engine
    useEffect(() => {
        if (!activeStrategy || !budgetData) return;
        
        try {
            const engine = getBudgetStrategyEngine();
            engine.setStrategy(activeStrategy);
            engine.setBudgetData(budgetData);
            engine.setRunningModels(runningModels);
            engine.setallLanguageModels(allLanguageModels);
            engine.setLoadLocalModel(loadLocalModelForBudgetStrategyEngine);
        } catch {
            initializeBudgetStrategyEngine(activeStrategy, budgetData, runningModels, allLanguageModels, loadLocalModelForBudgetStrategyEngine);
        }
    }, [activeStrategy, budgetData, allLanguageModels, runningModels, loadLocalModelForBudgetStrategyEngine]);
}