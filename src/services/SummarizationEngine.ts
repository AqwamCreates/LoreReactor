// src/services/BackgroundSummarization.ts
import type { InteractionData, BudgetStrategy, ChatMessage } from '../types';
import { saveRawInteractionData } from '../hooks/storage';
import { getLanguageModelEngine } from './LanguageModelEngine';
import { getBudgetStrategyEngine } from './BudgetStrategyEngine';
import { checkTriggerThreshold, generateMissingSummaries, generatePeriodicCompression, generateRecursiveSummary } from './ChatMessageSummarizationEngine';
import { useSessionStore } from '../store/useSessionStore';

interface SummarizationContext {
    data: InteractionData;
    setData: (d: InteractionData) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    activeStrategy?: BudgetStrategy | null;
}

export async function runSummarization(context: SummarizationContext): Promise<void> {
    const { data, setData, addToast, activeStrategy } = context;

    try {
        const engine = getLanguageModelEngine();
        const runningModels = useSessionStore.getState().runningModels;

        // Read model and context length from engine — works in both direct and budget mode
        let ctxLen = engine.getContext()?.contextLength || 0;
        let modelId = engine.getContext()?.id || '';

        // If engine has no model set yet, fall back to store
        if (!ctxLen) {
            const model = useSessionStore.getState().selectedModel;
            ctxLen = model?.contextLength || 8192;
            modelId = model?.id || '';
            if (model) {
                engine.setRunningModels(runningModels);
                engine.setContext(model);
            }
        }

        let tokens = 0;
        for (const m of data.interactionHistory) {
            if (m.messageType === 'chat') tokens += await engine.countTokens(m.textContent);
        }

        const triggered = checkTriggerThreshold(data, tokens, ctxLen);
        if (!triggered) return;

        addToast(`Running ${triggered.strategyType}...`, 'info');

        // Ensure BudgetStrategyEngine singleton is initialized for summarization
        const budgetData = useSessionStore.getState().budgetData;
        const strat = activeStrategy ?? useSessionStore.getState().activeStrategy;

        if (strat && budgetData) {
            const bse = getBudgetStrategyEngine();
            bse.setStrategy(strat);
            bse.setBudgetData(budgetData);
            bse.setRunningModels(runningModels);
        }

        let updated = data;

        if (triggered.strategyType === 'Sliding Window Replace' && triggered.slidingWindowSize) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Sliding Window Replace' && s.enabled)?.summaryTokenBudget ?? 256;
            const summaries = await generateMissingSummaries(updated, triggered.slidingWindowSize, modelId, budget);
            if (summaries.size > 0) {
                updated = {
                    ...updated,
                    interactionHistory: updated.interactionHistory.map(m => {
                        const s = summaries.get(m.id);
                        if (s && m.messageType === 'chat') {
                            const chatMsg = m as ChatMessage;
                            return {
                                ...chatMsg,
                                modelTextContentSummaries: {
                                    ...chatMsg.modelTextContentSummaries,
                                    [modelId]: s,
                                },
                            };
                        }
                        return m;
                    }),
                };
            }
        }

        if (triggered.strategyType === 'Periodic Compression' && triggered.compressionInterval && triggered.compressionChunkSize) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Periodic Compression' && s.enabled)?.summaryTokenBudget ?? 512;
            const nc = await generatePeriodicCompression(updated, triggered.compressionInterval, triggered.compressionChunkSize, budget);
            if (nc.length > 0) updated = { ...updated, contexts: [...(updated.contexts || []), ...nc] };
        }

        if (triggered.strategyType === 'Recursive Summary' && triggered.recursiveChunkSize && triggered.recursiveMaxDepth) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Recursive Summary' && s.enabled)?.summaryTokenBudget ?? 1024;
            const nc = await generateRecursiveSummary(updated, triggered.recursiveChunkSize, triggered.recursiveMaxDepth, budget);
            if (nc.length > 0) updated = { ...updated, contexts: [...(updated.contexts || []), ...nc] };
        }

        if (updated !== data) {
            await saveRawInteractionData(updated);
            setData(updated);

            const countModelSummaries = (history: typeof data.interactionHistory) =>
                history.filter(m => m.messageType === 'chat' && (m as ChatMessage).modelTextContentSummaries?.[modelId]).length;

            const ns = triggered.strategyType === 'Sliding Window Replace'
                ? countModelSummaries(updated.interactionHistory) - countModelSummaries(data.interactionHistory)
                : 0;
            const nc = (triggered.strategyType === 'Periodic Compression' || triggered.strategyType === 'Recursive Summary')
                ? (updated.contexts?.length ?? 0) - (data.contexts?.length ?? 0)
                : 0;

            if (ns > 0) addToast(`Summarized ${ns} message${ns !== 1 ? 's' : ''}`, 'success');
            else if (nc > 0) addToast(`Generated ${nc} context${nc !== 1 ? 's' : ''} (${triggered.strategyType})`, 'success');
            else addToast(`${triggered.strategyType} complete`, 'info');
        } else {
            addToast(`${triggered.strategyType} complete`, 'info');
        }
    } catch (error) {
        console.warn('Background summarization failed:', error);
        addToast(`Summarization failed: ${(error as Error).message}`, 'error');
    }
}