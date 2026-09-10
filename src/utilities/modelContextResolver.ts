// src/utilities/modelContextResolver.ts
import type { BudgetStrategy, LanguageModel, backend } from '../types';
import type { LanguageModelContext } from '../services/LanguageModelEngine';

/**
 * Builds a LanguageModelContext from a LanguageModel definition and runtime state.
 * This is the single canonical way to construct a model context from a model object.
 */
export function buildContextFromModel(
    model: LanguageModel,
    runningModels?: Record<string, { isRunning: boolean; port?: number }>,
): LanguageModelContext {
    const isCloud = !!model.apiKey && !!model.backend;

    if (isCloud) {
        return {
            apiKey: model.apiKey,
            backend: model.backend,
            modelPath: model.model,
        };
    }

    const running = model.id ? runningModels?.[model.id] : undefined;
    const runtimePort = running?.port
        ?? (model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;

    return {
        runtimePort,
        modelPath: model.model,
    };
}

/**
 * Resolves a model context with the following priority:
 * 1. Budget strategy pool (local preferred, then online) — if strategy + runningModels provided
 * 2. Explicit fallback context — if it has actionable fields (apiKey or runtimePort)
 * 3. Empty context — last resort
 *
 * Used by summarization engines and any caller that may or may not have an active strategy.
 */
export function resolveModelContext(
    fallbackCtx: LanguageModelContext,
    strategy?: BudgetStrategy | null,
    runningModels?: Record<string, { isRunning: boolean; port?: number }>,
): LanguageModelContext {
    if (strategy && runningModels) {
        const pool = strategy.localModels.length > 0 ? strategy.localModels : strategy.onlineModels;
        for (const model of pool) {
            const ctx = buildContextFromModel(model, runningModels);
            if (ctx.apiKey || ctx.runtimePort) return ctx;
        }
    }

    if (fallbackCtx.apiKey || fallbackCtx.runtimePort) return fallbackCtx;

    return {};
}

/**
 * Resolves a model context from sampler parameters embedded in a Character's sampler.
 * Used exclusively by PromptBuilder (chatLogic.ts) where the model reference lives
 * inside sampler.parameters._selectedModel rather than in the session store.
 */
export function resolveModelContextFromSamplerParameters(
    samplerParams: Record<string, unknown> | undefined,
    runtimePortOverride?: number,
): LanguageModelContext {
    const selectedModel = samplerParams?._selectedModel as Record<string, unknown> | undefined;
    if (!selectedModel) {
        return runtimePortOverride !== undefined ? { runtimePort: runtimePortOverride } : {};
    }

    const apiKey = selectedModel.apiKey as string | undefined;
    const backend = selectedModel.backend as backend | undefined;
    const modelPath = selectedModel.model as string | undefined;
    const runtimePort = runtimePortOverride
        ?? (selectedModel.parameters as Record<string, unknown>)?._runtimePort as number | undefined;

    if (apiKey && backend) {
        return { apiKey, backend, modelPath, runtimePort };
    }

    return { runtimePort, modelPath };
}