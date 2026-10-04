// src/hooks/useChatState.ts
import { useSessionStore } from './useSessionStore';

export function useChatState() {
    // --- Stable Structural Selectors (Does NOT subscribe to streaming text or live stats) ---
    const interactionData = useSessionStore(s => s.interactionData);
    const localProtagonist = useSessionStore(s => s.localProtagonist); // ✅ RENAMED from currentCharacter
    const activeStrategy = useSessionStore(s => s.activeStrategy);
    const selectedModel = useSessionStore(s => s.selectedModel);
    const runningModels = useSessionStore(s => s.runningModels);
    const budgetData = useSessionStore(s => s.budgetData);
    const selectedModelId = useSessionStore(s => s.selectedModelId);
    const isLoading = useSessionStore(s => s.isLoading);
    const currentCharacterExpression = useSessionStore(s => s.currentCharacterExpression);
    // Added back: only flips on turn start/stop, safe from per-token re-renders
    const streamingCharacter = useSessionStore(s => s.streamingCharacter);

    // --- Direct Store Actions (Identity stable, zero re-renders) ---
    const setInteractionData = useSessionStore(s => s.setInteractionData);
    
    // ✅ RENAMED internally to setLocalProtagonist, but exported as setSelectedCharacter 
    // to prevent breaking the hundreds of call sites that destructure it from this hook.
    const setSelectedCharacter = useSessionStore(s => s.setLocalProtagonist);
    
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
        // State
        interactionData,
        localProtagonist, // ✅ RENAMED in return object
        activeStrategy,
        selectedModel,
        runningModels,
        budgetData,
        selectedModelId,
        isLoading,
        currentCharacterExpression,
        streamingCharacter, // Expose to session & viewAssets
        
        // Actions
        setInteractionData,
        setSelectedCharacter, // Kept as setSelectedCharacter for API stability
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