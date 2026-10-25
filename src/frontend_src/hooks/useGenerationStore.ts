// src/frontend_src/hooks/useGenerationStore.ts
import { create } from 'zustand';
import type { Character } from '../types';

interface GenerationState {
    isLoading: boolean;
    isNarrating: boolean;
    streamingText: string;
    streamingCharacter: Character | null;
    streamingMessageId: string | null; // 👈 ADD THIS
    currentCharacterExpression: string;
    loadingLocations: Record<string, boolean>;
    abortController: AbortController | null;
    
    latency: number;
    timeToFirstToken: number;
    numberOfCacheInvalidations: number;
    numberOfRequests: number;
    totalCost: number;
    costWithoutCacheMisses: number;

    setStreamingState: (char: Character | null, text: string) => void;
    setStreamingText: (text: string) => void;
    setStreamingCharacter: (character: Character | null) => void;
    setStreamingMessageId: (msgId: string | null) => void; // 👈 ADD THIS
    setIsLoading: (isLoading: boolean) => void;
    setIsNarrating: (isNarrating: boolean) => void;
    resetStreaming: () => void;
    setAbortController: (ctrl: AbortController | null) => void;
    stopGeneration: () => void;
    setSelectedCharacterExpression: (expr: string) => void;
    setStats: (newStats: any) => void;
}

export const useGenerationStore = create<GenerationState>()((set, get) => ({
    isLoading: false,
    isNarrating: false,
    streamingText: '',
    streamingCharacter: null,
    streamingMessageId: null, // 👈 ADD THIS
    currentCharacterExpression: 'neutral',
    loadingLocations: {},
    abortController: null,
    latency: 0,
    timeToFirstToken: 0,
    numberOfCacheInvalidations: 0,
    numberOfRequests: 0,
    totalCost: 0,
    costWithoutCacheMisses: 0,

    setStreamingState: (char, text) => set({ streamingCharacter: char, streamingText: text, isLoading: char !== null }),
    setStreamingText: (text) => set({ streamingText: text }),
    setStreamingCharacter: (character) => set({ streamingCharacter: character }),
    setStreamingMessageId: (streamingMessageId) => set({ streamingMessageId }), // 👈 ADD THIS
    setIsLoading: (isLoading) => set({ isLoading }),
    setIsNarrating: (isNarrating) => set({ isNarrating }),
    resetStreaming: () => set({ streamingText: '', streamingCharacter: null, streamingMessageId: null, isLoading: false, isNarrating: false }), // 👈 UPDATE THIS
    setAbortController: (ctrl) => set({ abortController: ctrl }),
    setSelectedCharacterExpression: (expr) => set({ currentCharacterExpression: expr }),
    
    setStats: (newStats) => {
        set((prev) => {
            const current = {
                numberOfCacheInvalidations: prev.numberOfCacheInvalidations,
                numberOfRequests: prev.numberOfRequests,
                totalCost: prev.totalCost,
                costWithoutCacheMisses: prev.costWithoutCacheMisses,
                latency: prev.latency,
                timeToFirstToken: prev.timeToFirstToken,
            };
            return typeof newStats === 'function' ? newStats(current) : { ...current, ...newStats };
        });
    },

    stopGeneration: () => {
        const { abortController } = get();
        if (abortController) abortController.abort();
        set({ streamingText: '', streamingCharacter: null, streamingMessageId: null, isLoading: false, isNarrating: false, abortController: null });
    },
}));