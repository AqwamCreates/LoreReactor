// src/utilities/modelContextResolver.ts
import type { LanguageModel } from '../types';
import type { LanguageModelContext } from '../services/LanguageModelEngine';

/**
 * Builds a LanguageModelContext from a LanguageModel definition and runtime state.
 * This is the single canonical way to construct a model context from a model object.
 * All callers use this function, then pass the result to engine.setContext().
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
        modelPath: model.model,
        runtimePort,
    };
}