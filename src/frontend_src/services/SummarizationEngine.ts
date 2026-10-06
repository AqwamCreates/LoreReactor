// frontend-src/services/SummarizationEngine.ts
import type { InteractionData, ChatMessage, Character } from '../types';
import { 
    checkTriggerThreshold, 
    generateMissingSummaries, 
    generatePeriodicCompression, 
    generateRecursiveSummary, 
    generateEntropyPruningSummaries 
} from './ChatMessageSummarizationEngine';
import { getLanguageModelEngine } from './LanguageModelEngine';
import { getLocalMessageHistory } from '../utilities/timelineLogic';

interface RunSummarizationOptions {
    data: InteractionData;
    character: Character; // ADDED: Scope to character perspective
    setInteractionData: (data: InteractionData) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export async function runSummarization({ data, character, setInteractionData, addToast }: RunSummarizationOptions): Promise<void> {
    const engine = getLanguageModelEngine();
    const activeModel = engine.getContext();
    const contextLength = activeModel?.contextLength ?? 4096;
    const modelId = activeModel?.id ?? 'default';
    
    // STRICTLY USE LOCAL HISTORY FOR CHARACTER PERSPECTIVE TOKEN COUNTING
    const history = getLocalMessageHistory(data, character);
    let currentTokens = 0;
    for (const m of history) {
        if (m.messageType === 'chat') {
            currentTokens += await engine.countTokens((m as ChatMessage).textContent);
        }
    }

    const triggeredSteps = checkTriggerThreshold(data, currentTokens, contextLength);
    if (triggeredSteps.length === 0) return;

    let updated = data;

    for (const step of triggeredSteps) {
        addToast(`Running ${step.strategyType}...`, 'info');
        
        let ns = 0;
        let nc = 0;

        if (step.strategyType === 'Sliding Window Replace' && step.slidingWindowSize) {
            const summaries = await generateMissingSummaries(updated, character, step.slidingWindowSize, modelId, 256);
            if (summaries.size > 0) {
                const newHistories = { ...updated.interactionHistories };
                for (const [locId, msgs] of Object.entries(newHistories)) {
                    newHistories[locId] = msgs.map(m => {
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
                }
                updated = { ...updated, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
                ns = summaries.size;
            }
        } else if (step.strategyType === 'Periodic Compression' && step.periodicCompressionInterval && step.periodicCompressionChunkSize) {
            const newContexts = await generatePeriodicCompression(updated, character, step.periodicCompressionInterval, step.periodicCompressionChunkSize, 512);
            if (newContexts.length > 0) {
                updated = { ...updated, contexts: [...(updated.contexts || []), ...newContexts], lastUpdatedTimestamp: Date.now() };
                nc = newContexts.length;
            }
        } else if (step.strategyType === 'Recursive Summary' && step.recursiveSummaryChunkSize && step.recursiveSummaryMaximumDepth) {
            const newContexts = await generateRecursiveSummary(updated, character, step.recursiveSummaryChunkSize, step.recursiveSummaryMaximumDepth, 1024);
            if (newContexts.length > 0) {
                updated = { ...updated, contexts: [...(updated.contexts || []), ...newContexts], lastUpdatedTimestamp: Date.now() };
                nc = newContexts.length;
            }
        } else if (step.strategyType === 'Entropy Pruning') {
            const summaries = await generateEntropyPruningSummaries(
                updated, character, modelId, 256,
                step.entropyPruningChunkSize, step.entropyPruningThreshold, step.entropyPruningTokenBudget
            );
            if (summaries.size > 0) {
                const newHistories = { ...updated.interactionHistories };
                for (const [locId, msgs] of Object.entries(newHistories)) {
                    newHistories[locId] = msgs.map(m => {
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
                }
                updated = { ...updated, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
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

    setInteractionData(updated);
}