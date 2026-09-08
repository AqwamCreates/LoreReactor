// src/services/BackgroundSummarization.ts
import type { InteractionData, BudgetStrategy } from '../types';
import { saveRawInteractionData } from '../hooks/storage';
import { LanguageModelEngine, type LanguageModelContext } from './LanguageModelEngine';
import { checkTriggerThreshold, generateMissingSummaries, generatePeriodicCompression, generateRecursiveSummary } from './ChatMessageSummarizationEngine';
import { useSessionStore } from '../store/useSessionStore';

const languageModelEngine = new LanguageModelEngine();

interface BackgroundSummarizationContext {
    data: InteractionData;
    setData: (d: InteractionData) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    activeStrategy?: BudgetStrategy | null;
}

export async function runBackgroundSummarization(ctx: BackgroundSummarizationContext): Promise<void> {
    const { data, setData, addToast, activeStrategy } = ctx;

    try {
        const model = useSessionStore.getState().selectedModel;
        const runningModels = useSessionStore.getState().runningModels;
        const ctxLen = model?.contextLength || 8192;
        let tokens = 0;
        for (const m of data.interactionHistory) {
            if (m.kind === 'chat') tokens += await languageModelEngine.countTokens(m.textContent);
        }

        const triggered = checkTriggerThreshold(data, tokens, ctxLen);
        if (!triggered) return;

        addToast(`Running ${triggered.strategyType}...`, 'info');

        const port = model?.id ? runningModels[model.id]?.port : undefined;
        const effectivePort = port || (model?.parameters as any)?._runtimePort;
        const lmCtx: LanguageModelContext = {
            apiKey: model?.apiKey,
            backend: model?.backend,
            modelPath: model?.model,
            runtimePort: effectivePort,
        };
        if (!effectivePort && !model?.apiKey) return;

        const strat = activeStrategy ?? null;

        let updated = data;

        if (triggered.strategyType === 'Sliding Window Replace' && triggered.slidingWindowSize) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Sliding Window Replace' && s.enabled)?.summaryTokenBudget ?? 256;
            const summaries = await generateMissingSummaries(updated, triggered.slidingWindowSize, lmCtx, budget, strat, runningModels);
            if (summaries.size > 0) {
                updated = {
                    ...updated,
                    interactionHistory: updated.interactionHistory.map(m => {
                        const s = summaries.get(m.id);
                        if (s && m.kind === 'chat') return { ...m, textContentSummary: s };
                        return m;
                    }),
                };
            }
        }

        if (triggered.strategyType === 'Periodic Compression' && triggered.compressionInterval && triggered.compressionChunkSize) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Periodic Compression' && s.enabled)?.summaryTokenBudget ?? 512;
            const nc = await generatePeriodicCompression(updated, triggered.compressionInterval, triggered.compressionChunkSize, lmCtx, budget, strat, runningModels);
            if (nc.length > 0) updated = { ...updated, contexts: [...(updated.contexts || []), ...nc] };
        }

        if (triggered.strategyType === 'Recursive Summary' && triggered.recursiveChunkSize && triggered.recursiveMaxDepth) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Recursive Summary' && s.enabled)?.summaryTokenBudget ?? 1024;
            const nc = await generateRecursiveSummary(updated, triggered.recursiveChunkSize, triggered.recursiveMaxDepth, lmCtx, budget, strat, runningModels);
            if (nc.length > 0) updated = { ...updated, contexts: [...(updated.contexts || []), ...nc] };
        }

        if (updated !== data) {
            await saveRawInteractionData(updated);
            setData(updated);

            const ns = triggered.strategyType === 'Sliding Window Replace'
                ? updated.interactionHistory.filter(m => m.kind === 'chat' && m.textContentSummary).length - data.interactionHistory.filter(m => m.kind === 'chat' && m.textContentSummary).length
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
    } catch (err) {
        console.warn('Background summarization failed:', err);
        addToast(`Summarization failed: ${(err as Error).message}`, 'error');
    }
}