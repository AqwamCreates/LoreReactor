// src/hooks/useTokenCounter.ts
import { useState, useRef, useEffect } from 'react';
import type { InteractionData, ChatMessage, LanguageModel, BudgetStrategy } from '../types';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';

interface UseTokenCounterOptions {
    messages: ChatMessage[];
    interactionData: InteractionData | null;
    selectedModelId: string | null;
    allModels: LanguageModel[];
    runningModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    activeStrategy: BudgetStrategy | null;
}

export function useTokenCounter(options: UseTokenCounterOptions) {
    const { messages, interactionData, selectedModelId, allModels, runningModels, activeStrategy } = options;
    const [maxTokens, setMaxTokens] = useState(0);
    const abortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastCountedIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }

        timerRef.current = setTimeout(async () => {
            if (messages.length === 0 || !interactionData?.participants) {
                setMaxTokens(0);
                lastCountedIdsRef.current.clear();
                return;
            }
            const abort = new AbortController();
            abortRef.current = abort;
            try {
                const counts: Record<string, number> = {};
                for (const p of interactionData.participants) counts[p.id] = 0;

                let tokenizer: LanguageModel | undefined;
                if (selectedModelId) tokenizer = allModels.find(m => m.id === selectedModelId);
                if (!tokenizer && activeStrategy && activeStrategy.modelIds.length > 0) {
                    tokenizer = allModels.find(m => m.id === activeStrategy.modelIds[0]);
                }
                const engine = getLanguageModelEngine();
                if (tokenizer) { engine.setRunningModels(runningModels); engine.setContext(tokenizer); } else return;

                const prevIds = lastCountedIdsRef.current;
                const currIds = new Set<string>();
                let hasNew = false;
                for (const msg of messages) { currIds.add(msg.id); if (!prevIds.has(msg.id)) hasNew = true; }
                if (!hasNew && prevIds.size === currIds.size) return;

                for (const msg of messages) {
                    if (abort.signal.aborted) return;
                    if (prevIds.has(msg.id)) continue;
                    if (msg.character && (msg as ChatMessage).textContent) {
                        const charId = msg.character.id;
                        if (counts[charId] !== undefined || charId === '__ambient_narrator__') {
                            const tokens = await engine.countTokens((msg as ChatMessage).textContent);
                            if (abort.signal.aborted) return;
                            if (counts[charId] !== undefined) counts[charId] += tokens;
                        }
                    }
                }
                lastCountedIdsRef.current = currIds;
                if (!abort.signal.aborted) setMaxTokens(Math.max(...Object.values(counts), 0));
            } catch (e) { if ((e as Error).name !== 'AbortError') console.error('Token counting failed:', e); }
        }, 500);

        return () => {
            if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
            if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
        };
    }, [messages, interactionData?.participants, selectedModelId, allModels, runningModels, activeStrategy]);

    return maxTokens;
}