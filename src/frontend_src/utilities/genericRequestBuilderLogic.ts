import type { TokenSampler } from "../types";

export function extractTokenSamplerParameters(tokenSampler: TokenSampler | undefined): Record<string, unknown> {
    if (!tokenSampler?.parameters) return {};
    const params = tokenSampler.parameters;
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
    tokenSampler: TokenSampler | undefined,
    stopSequences: string[],
): Record<string, unknown> {
    const tokenSamplerParams = extractTokenSamplerParameters(tokenSampler);
    return {
        ...tokenSamplerParams,
        prompt,
        n_predict: maxTokens,
        stop: stopSequences,
    };
}