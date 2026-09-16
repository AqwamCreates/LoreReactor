import type { Sampler } from "../types";

/**
 * Extracts OpenAI-compatible sampler parameters from a Sampler object.
 * Maps llama.cpp / OpenRouter parameter names to a flat Record suitable
 * for inclusion in API request bodies.
 *
 * Supported parameters (union of OpenAI, OpenRouter, and llama.cpp):
 *   temperature, top_p, top_k, min_p, top_a,
 *   frequency_penalty, presence_penalty, repetition_penalty,
 *   repeat_last_n, seed,
 *   dry_multiplier, dry_allowed_length, dry_base, dry_sequence_breaker, dry_penalty_last_n,
 *   xtc_probability, xtc_threshold,
 *   dynatemp_range, dynatemp_exp,
 *   mirostat, mirostat_lr, mirostat_tau,
 *   adaptive_target, adaptive_decay
 */
function extractSamplerParams(sampler: Sampler | undefined): Record<string, unknown> {
    if (!sampler?.parameters) return {};
    const params = sampler.parameters;
    const result: Record<string, unknown> = {};

    // Standard OpenAI-compatible params
    const directKeys = [
        'temperature', 'top_p', 'top_k', 'min_p', 'top_a',
        'frequency_penalty', 'presence_penalty', 'repetition_penalty',
        'repeat_penalty', 'repeat_last_n', 'seed',
        // DRY
        'dry_multiplier', 'dry_allowed_length', 'dry_base',
        'dry_sequence_breaker', 'dry_penalty_last_n',
        // XTC
        'xtc_probability', 'xtc_threshold',
        // Dynamic temperature
        'dynatemp_range', 'dynatemp_exp',
        // Mirostat
        'mirostat', 'mirostat_lr', 'mirostat_tau', 'mirostat_ent',
        // Adaptive-P
        'adaptive_target', 'adaptive_decay',
    ] as const;

    for (const key of directKeys) {
        if (params[key] !== undefined && params[key] !== null) {
            result[key] = params[key];
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
    const samplerParams = extractSamplerParams(sampler);
    return {
        ...samplerParams,
        prompt,
        n_predict: maxTokens,
        stop: stopSequences,
    };
}