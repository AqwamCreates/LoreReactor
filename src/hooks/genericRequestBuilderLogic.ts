import type { Sampler } from "../types";

function extractSamplerParameters(sampler: Sampler | undefined): Record<string, unknown> {
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
 * Builds a request body by merging sampler parameters with task-specific overrides.
 * Task overrides always take precedence over sampler defaults.
 */
export function buildRequestBody(
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