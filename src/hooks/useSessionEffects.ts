// src/hooks/useSessionEffects.ts
import { useEffect } from 'react';
import type { BudgetData, BudgetStrategy, LanguageModel } from '../types';
import { getBudgetStrategyEngine, initializeBudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { cloudBackends } from '../dictionaries/languageModelInformation';
import type { cloudBackend } from '../types';
import { useSessionStore } from '../hooks/useSessionStore';

interface UseSessionEffectsOptions {
    interactionDataId: string | null | undefined;
    isMultiplayerClient: boolean;
    selectedModelId: string | null;
    setSelectedModelId: (id: string | null) => void;
    selectedBudgetStrategyId: string | null;
    allBudgetStrategies: BudgetStrategy[];
    setActiveBudgetStrategy: (strategy: BudgetStrategy) => void;
    allModels: LanguageModel[];
    runningModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    setSelectedGlobalModel: (model: LanguageModel | null) => void;
    defaultCharacterId: string | null;
    allCharacters: { id: string }[];
    currentCharacterId: string | null | undefined;
    setCurrentCharacter: (char: any) => void;
    activeStrategy: BudgetStrategy | null;
    budgetData: BudgetData | null;
    loadLocalModelForBudgetStrategyEngine: (modelId: string) => Promise<number | null>;
}

export function useSessionEffects(options: UseSessionEffectsOptions) {
    const {
        interactionDataId, isMultiplayerClient, selectedModelId, setSelectedModelId,
        selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy,
        allModels, runningModels, setSelectedGlobalModel,
        defaultCharacterId, allCharacters, currentCharacterId, setCurrentCharacter,
        activeStrategy, budgetData, loadLocalModelForBudgetStrategyEngine,
    } = options;

    const storeSetActiveChatId = useSessionStore(s => s.setActiveChatId);
    const storeSetSelectedModelId = useSessionStore(s => s.setSelectedModelId);
    const storeSetSelectedBudgetStrategyId = useSessionStore(s => s.setSelectedBudgetStrategyId);

    // Clear token cache when model or running models change
    useEffect(() => { void selectedModelId; void runningModels; getLanguageModelEngine().clearTokenCache(); }, [selectedModelId, runningModels]);

    // Persist active chat ID
    useEffect(() => {
        if (isMultiplayerClient) return;
        if (interactionDataId) storeSetActiveChatId(interactionDataId);
    }, [interactionDataId, isMultiplayerClient, storeSetActiveChatId]);

    // Persist selected model ID
    useEffect(() => { storeSetSelectedModelId(selectedModelId ?? null); }, [selectedModelId, storeSetSelectedModelId]);

    // Activate budget strategy from stored ID
    useEffect(() => {
        if (!selectedBudgetStrategyId || allBudgetStrategies.length === 0) return;
        const strategy = allBudgetStrategies.find(s => s.id === selectedBudgetStrategyId);
        if (!strategy) { storeSetSelectedBudgetStrategyId(null); return; }
        setActiveBudgetStrategy(strategy);
    }, [selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy, storeSetSelectedBudgetStrategyId]);

    // Clear selected model if it's no longer running (local models only)
    useEffect(() => {
        if (!selectedModelId || allModels.length === 0) return;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (!selectedModel) { setSelectedModelId(null); return; }
        const isCloudModel = !!selectedModel.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend as cloudBackend);
        if (isCloudModel) return;
        if (!runningModels[selectedModelId]?.isRunning) setSelectedModelId(null);
    }, [selectedModelId, allModels, runningModels, setSelectedModelId]);

    // Apply default character
    useEffect(() => {
        if (isMultiplayerClient) return;
        if (defaultCharacterId && allCharacters.length > 0) {
            const defaultChar = allCharacters.find(c => c.id === defaultCharacterId);
            if (defaultChar && currentCharacterId !== defaultChar.id) setCurrentCharacter(defaultChar);
        }
    }, [defaultCharacterId, allCharacters, currentCharacterId, setCurrentCharacter, isMultiplayerClient]);

    // Sync selected model to global model with runtime port
    useEffect(() => {
        if (selectedModelId && runningModels[selectedModelId]?.isRunning) {
            const foundModel = allModels.find(m => m.id === selectedModelId);
            const portNumber = runningModels[selectedModelId].port;
            if (foundModel && portNumber) setSelectedGlobalModel({ ...foundModel, parameters: { ...foundModel.parameters, _runtimePort: portNumber } });
        } else if (selectedModelId) {
            setSelectedGlobalModel(allModels.find(m => m.id === selectedModelId) || null);
        } else setSelectedGlobalModel(null);
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