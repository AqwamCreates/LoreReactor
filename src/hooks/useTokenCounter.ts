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

interface CachedTokenEntry {
    tokenCount: number;
    timestamp: number;
    modelId: string;
}

export function useTokenCounter(options: UseTokenCounterOptions) {
    const { messages, interactionData, selectedModelId, allModels, runningModels, activeStrategy } = options;
    const [maxTokens, setMaxTokens] = useState(0);

    const abortRef = useRef<AbortController | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    // Persistent message token cache: messageId -> { tokenCount, timestamp, modelId }
    const tokenCacheRef = useRef<Map<string, CachedTokenEntry>>(new Map());

    useEffect(() => {
        if (timerRef.current) { 
            clearTimeout(timerRef.current); 
            timerRef.current = null; 
        }
        if (abortRef.current) { 
            abortRef.current.abort(); 
            abortRef.current = null; 
        }

        timerRef.current = setTimeout(async () => {
            if (messages.length === 0 || !interactionData?.participants?.length) {
                setMaxTokens(0);
                return;
            }

            // Determine active tokenizer model
            let tokenizer: LanguageModel | undefined;
            if (selectedModelId) {
                tokenizer = allModels.find(m => m.id === selectedModelId);
            }
            if (!tokenizer && activeStrategy && activeStrategy.modelIds.length > 0) {
                tokenizer = allModels.find(m => m.id === activeStrategy.modelIds[0]);
            }
            if (!tokenizer) return;

            const abort = new AbortController();
            abortRef.current = abort;

            try {
                const engine = getLanguageModelEngine();
                engine.setRunningModels(runningModels);
                engine.setContext(tokenizer);

                const cache = tokenCacheRef.current;
                const currentModelId = tokenizer.id;

                // 1. Identify which messages need fresh token counting (new, edited, or model switched)
                const messagesToCount: ChatMessage[] = [];
                for (const msg of messages) {
                    if (msg.messageType !== 'chat' || !msg.textContent) continue;

                    const cached = cache.get(msg.id);
                    if (
                        !cached ||
                        cached.timestamp !== msg.lastUpdatedTimestamp ||
                        cached.modelId !== currentModelId
                    ) {
                        messagesToCount.push(msg);
                    }
                }

                // 2. Tokenize only uncached / modified messages
                for (const msg of messagesToCount) {
                    if (abort.signal.aborted) return;
                    const tokens = await engine.countTokens(msg.textContent);
                    if (abort.signal.aborted) return;

                    cache.set(msg.id, {
                        tokenCount: tokens,
                        timestamp: msg.lastUpdatedTimestamp,
                        modelId: currentModelId,
                    });
                }

                if (abort.signal.aborted) return;

                // 3. Prune deleted messages from cache to prevent unbounded memory growth
                if (cache.size > messages.length + 50) {
                    const activeIds = new Set(messages.map(m => m.id));
                    for (const id of cache.keys()) {
                        if (!activeIds.has(id)) {
                            cache.delete(id);
                        }
                    }
                }

                // 4. Sum up total tokens per participant accurately
                const participantCounts: Record<string, number> = {};
                for (const p of interactionData.participants) {
                    participantCounts[p.id] = 0;
                }

                for (const msg of messages) {
                    if (msg.messageType !== 'chat') continue;
                    const charId = msg.character?.id;

                    if (charId && participantCounts[charId] !== undefined) {
                        const entry = cache.get(msg.id);
                        if (entry) {
                            participantCounts[charId] += entry.tokenCount;
                        }
                    }
                }

                // 5. Update highest participant token total
                const highestTotal = Math.max(...Object.values(participantCounts), 0);
                setMaxTokens(highestTotal);
            } catch (e) {
                if ((e as Error).name !== 'AbortError') {
                    console.error('[useTokenCounter] Token counting failed:', e);
                }
            }
        }, 350);

        return () => {
            if (timerRef.current) { 
                clearTimeout(timerRef.current); 
                timerRef.current = null; 
            }
            if (abortRef.current) { 
                abortRef.current.abort(); 
                abortRef.current = null; 
            }
        };
    }, [messages, selectedModelId, allModels, runningModels, activeStrategy, interactionData]);

    return maxTokens;
}