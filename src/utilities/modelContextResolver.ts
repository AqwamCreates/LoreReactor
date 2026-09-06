// src/utilities/modelContextResolver.ts
import type { BudgetStrategy } from '../types';
import type { LanguageModelContext } from '../services/LanguageModelEngine';

/**
 * Resolves a model context from a budget strategy's pool, preferring local models.
 * Falls back to the provided context if no strategy is active or no models are ready.
 */
export function resolveModelContext(
    fallbackCtx: LanguageModelContext,
    strategy?: BudgetStrategy | null,
    runningModels?: Record<string, { isRunning: boolean; port?: number }>,
): LanguageModelContext {
    if (!strategy || !runningModels) return fallbackCtx;

    const pool = strategy.localModels.length > 0 ? strategy.localModels : strategy.onlineModels;
    if (pool.length === 0) return fallbackCtx;

    for (const model of pool) {
        const isCloud = !!model.apiKey && model.backend;
        if (isCloud) {
            return { apiKey: model.apiKey, backend: model.backend, modelPath: model.model };
        }
        const running = runningModels[model.id];
        if (running?.port) {
            return { runtimePort: running.port, modelPath: model.model };
        }
    }

    return fallbackCtx;
}