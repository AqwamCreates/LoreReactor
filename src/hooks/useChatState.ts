// src/hooks/useChatState.ts
import { useSessionStore } from './useSessionStore';

export function useChatState() {
    // --- Stable Structural Selectors Only (Does NOT subscribe to streaming text or stats) ---
    const interactionData = useSessionStore(s => s.interactionData);
    const currentCharacter = useSessionStore(s => s.currentCharacter);
    const activeStrategy = useSessionStore(s => s.activeStrategy);
    const selectedModel = useSessionStore(s => s.selectedModel);
    const runningModels = useSessionStore(s => s.runningModels);
    const budgetData = useSessionStore(s => s.budgetData);
    const selectedModelId = useSessionStore(s => s.selectedModelId);
    const isLoading = useSessionStore(s => s.isLoading);
    const currentCharacterExpression = useSessionStore(s => s.currentCharacterExpression);

    // --- Direct Store Actions (Identity stable, zero re-renders) ---
    const setInteractionData = useSessionStore(s => s.setInteractionData);
    const setSelectedCharacter = useSessionStore(s => s.setCurrentCharacter);
    const setStreamingState = useSessionStore(s => s.setStreamingState);
    const updateRunningModels = useSessionStore(s => s.updateRunningModels);
    const setActiveStrategy = useSessionStore(s => s.setActiveStrategy);
    const setSelectedModel = useSessionStore(s => s.setSelectedModel);
    const setBudgetData = useSessionStore(s => s.setBudgetData);
    const setLastSelectedModelId = useSessionStore(s => s.setLastSelectedModelId);
    const setStats = useSessionStore(s => s.setStats);
    const setNumberOfTokens = useSessionStore(s => s.setNumberOfTokens);
    const setSelectedCharacterExpression = useSessionStore(s => s.setSelectedCharacterExpression);

    return {
        // State (Only changes when session structure changes)
        interactionData,
        currentCharacter,
        activeStrategy,
        selectedModel,
        runningModels,
        budgetData,
        selectedModelId,
        isLoading,
        currentCharacterExpression,
        
        // Actions
        setInteractionData,
        setSelectedCharacter,
        setStreamingState,
        updateRunningModels,
        setActiveStrategy,
        setSelectedModel,
        setBudgetData,
        setLastSelectedModelId,
        setStats,
        setNumberOfTokens,
        setSelectedCharacterExpression,
        
        // Store primitives
        setState: useSessionStore.setState,
        getState: useSessionStore.getState,
    };
}