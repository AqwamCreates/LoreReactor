// src/services/SummarizationEngine.ts
import type { InteractionData, ChatMessage } from '../types';
import { 
    checkTriggerThreshold, 
    generateMissingSummaries, 
    generatePeriodicCompression, 
    generateRecursiveSummary, 
    generateEntropyPruningSummaries 
} from './ChatMessageSummarizationEngine';
import { getLanguageModelEngine } from './LanguageModelEngine';

interface RunSummarizationOptions {
    data: InteractionData;
    setData: (data: InteractionData) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export async function runSummarization({ data, setData, addToast }: RunSummarizationOptions): Promise<void> {
    const engine = getLanguageModelEngine();
    const activeModel = engine.getContext();
    const contextLength = activeModel?.contextLength ?? 4096;
    const modelId = activeModel?.id ?? 'default';
    
    let currentTokens = 0;
    for (const m of data.interactionHistory) {
        if (m.messageType === 'chat') {
            currentTokens += await engine.countTokens((m as ChatMessage).textContent);
        }
    }

    // checkTriggerThreshold now returns an array of all triggered steps
    const triggeredSteps = checkTriggerThreshold(data, currentTokens, contextLength);
    if (triggeredSteps.length === 0) return;

    let updated = data;

    // Process each triggered strategy sequentially
    for (const step of triggeredSteps) {
        addToast(`Running ${step.strategyType}...`, 'info');
        
        let ns = 0;
        let nc = 0;

        if (step.strategyType === 'Sliding Window Replace' && step.slidingWindowSize) {
            const summaries = await generateMissingSummaries(updated, step.slidingWindowSize, modelId, 256);
            if (summaries.size > 0) {
                const newHistory = updated.interactionHistory.map(m => {
                    const summary = summaries.get(m.id);
                    if (summary && m.messageType === 'chat') {
                        return {
                            ...m,
                            modelTextContentSummaries: {
                                ...(m as ChatMessage).modelTextContentSummaries,
                                [modelId]: summary,
                            },
                        } as ChatMessage;
                    }
                    return m;
                });
                updated = { ...updated, interactionHistory: newHistory, lastUpdatedTimestamp: Date.now() };
                ns = summaries.size;
            }
        } else if (step.strategyType === 'Periodic Compression' && step.periodicCompressionInterval && step.periodicCompressionChunkSize) {
            const newContexts = await generatePeriodicCompression(updated, step.periodicCompressionInterval, step.periodicCompressionChunkSize, 512);
            if (newContexts.length > 0) {
                updated = { ...updated, contexts: [...(updated.contexts || []), ...newContexts], lastUpdatedTimestamp: Date.now() };
                nc = newContexts.length;
            }
        } else if (step.strategyType === 'Recursive Summary' && step.recursiveSummaryChunkSize && step.recursiveSummaryMaximumDepth) {
            const newContexts = await generateRecursiveSummary(updated, step.recursiveSummaryChunkSize, step.recursiveSummaryMaximumDepth, 1024);
            if (newContexts.length > 0) {
                updated = { ...updated, contexts: [...(updated.contexts || []), ...newContexts], lastUpdatedTimestamp: Date.now() };
                nc = newContexts.length;
            }
        } else if (step.strategyType === 'Entropy Pruning') {
            const summaries = await generateEntropyPruningSummaries(
                updated, modelId, 256,
                step.entropyPruningChunkSize, step.entropyPruningThreshold, step.entropyPruningTokenBudget
            );
            if (summaries.size > 0) {
                const newHistory = updated.interactionHistory.map(m => {
                    const summary = summaries.get(m.id);
                    if (summary && m.messageType === 'chat') {
                        return {
                            ...m,
                            modelTextContentSummaries: {
                                ...(m as ChatMessage).modelTextContentSummaries,
                                [modelId]: summary,
                            },
                        } as ChatMessage;
                    }
                    return m;
                });
                updated = { ...updated, interactionHistory: newHistory, lastUpdatedTimestamp: Date.now() };
                ns = summaries.size;
            }
        }

        if (ns > 0) {
            addToast(`Summarized ${ns} message${ns !== 1 ? 's' : ''} (${step.strategyType})`, 'success');
        } else if (nc > 0) {
            addToast(`Generated ${nc} context${nc !== 1 ? 's' : ''} (${step.strategyType})`, 'success');
        } else {
            addToast(`${step.strategyType} complete`, 'info');
        }
    }

    setData(updated);
}