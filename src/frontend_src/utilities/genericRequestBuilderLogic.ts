import type { Sampler } from "../types";

export function extractSamplerParameters(sampler: Sampler | undefined): Record<string, unknown> {
    if (!sampler?.parameters) return {};
    const params = sampler.parameters;
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Builds a generic completion payload for auxiliary tasks (summarization, memories, etc.).
 * Renamed from buildRequestBody to avoid naming collision with interactionDataLogic.ts.
 */
export function buildGenericCompletionBody(
    prompt: string,
    maxTokens: number,
    sampler: Sampler | undefined,
    stopSequences: string[],
): Record<string, unknown> {
    const samplerParams = extractSamplerParameters(sampler);
    return {
        ...samplerParams,
        prompt,
        n_predict: maxTokens,
        stop: stopSequences,
    };
}