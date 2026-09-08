// src/services/BackgroundSummarization.ts
import type { InteractionData, BudgetStrategy, LanguageModel } from '../types';
import { saveRawInteractionData } from '../hooks/storage';
import { LanguageModelEngine, type LanguageModelContext } from './LanguageModelEngine';
import { checkTriggerThreshold, generateMissingSummaries, generatePeriodicCompression, generateRecursiveSummary } from './ChatMessageSummarizationEngine';
import { isChatMessage } from '../components/typeGuard';

const languageModelEngine = new LanguageModelEngine();

interface BackgroundSummarizationContext {
    data: InteractionData;
    setData: (d: InteractionData) => void;
    dataRef: React.MutableRefObject<InteractionData | null>;
    modelRef: React.MutableRefObject<LanguageModel | null>;
    runningModelsRef: React.MutableRefObject<Record<string, { isRunning: boolean; port?: number }>>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    activeStrategy?: BudgetStrategy | null;
}

export async function runBackgroundSummarization(ctx: BackgroundSummarizationContext): Promise<void> {
    const { data, setData, dataRef, modelRef, runningModelsRef, addToast, activeStrategy } = ctx;

    try {
        const ctxLen = modelRef.current?.contextLength || 8192;
        let tokens = 0;
    for (const m of data.interactionHistory) {
        if (isChatMessage(m)) tokens += await languageModelEngine.countTokens(m.textContent);
    }

        const triggered = checkTriggerThreshold(data, tokens, ctxLen);
        if (!triggered) return;

        addToast(`Running ${triggered.strategyType}...`, 'info');

        const port = modelRef.current?.id ? runningModelsRef.current[modelRef.current.id]?.port : undefined;
        const effectivePort = port || (modelRef.current?.parameters as any)?._runtimePort;
        const lmCtx: LanguageModelContext = {
            apiKey: modelRef.current?.apiKey,
            backend: modelRef.current?.backend,
            modelPath: modelRef.current?.model,
            runtimePort: effectivePort,
        };
        if (!effectivePort && !modelRef.current?.apiKey) return;

        const running = runningModelsRef.current;
        const strat = activeStrategy ?? null;

        let updated = data;

        if (triggered.strategyType === 'Sliding Window Replace' && triggered.slidingWindowSize) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Sliding Window Replace' && s.enabled)?.summaryTokenBudget ?? 256;
            const summaries = await generateMissingSummaries(updated, triggered.slidingWindowSize, lmCtx, budget, strat, running);
            if (summaries.size > 0) {
                updated = {
                    ...updated,
                    interactionHistory: updated.interactionHistory.map(m => {
                        const s = summaries.get(m.id);
                        return s ? { ...m, textContentSummary: s } : m;
                    }),
                };
            }
        }

        if (triggered.strategyType === 'Periodic Compression' && triggered.compressionInterval && triggered.compressionChunkSize) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Periodic Compression' && s.enabled)?.summaryTokenBudget ?? 512;
            const nc = await generatePeriodicCompression(updated, triggered.compressionInterval, triggered.compressionChunkSize, lmCtx, budget, strat, running);
            if (nc.length > 0) updated = { ...updated, contexts: [...(updated.contexts || []), ...nc] };
        }

        if (triggered.strategyType === 'Recursive Summary' && triggered.recursiveChunkSize && triggered.recursiveMaxDepth) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Recursive Summary' && s.enabled)?.summaryTokenBudget ?? 1024;
            const nc = await generateRecursiveSummary(updated, triggered.recursiveChunkSize, triggered.recursiveMaxDepth, lmCtx, budget, strat, running);
            if (nc.length > 0) updated = { ...updated, contexts: [...(updated.contexts || []), ...nc] };
        }

        if (updated !== data) {
            await saveRawInteractionData(updated);
            setData(updated);
            dataRef.current = updated;

            const ns = triggered.strategyType === 'Sliding Window Replace'
                ? updated.interactionHistory.filter(m => isChatMessage(m) && m.textContentSummary).length - data.interactionHistory.filter(m => isChatMessage(m) && m.textContentSummary).length
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