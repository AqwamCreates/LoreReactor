// src/utils/costCalculator.ts

export interface ModelPricing {
    cacheHitPerMillion: number;
    cacheMissPerMillion: number;
    outputPerMillion: number;
}

export interface CostResult {
    totalCost: number;
    potentialMaxCost: number;
    isCacheMiss: boolean;
}

export function calculateRequestCost(
    promptTokens: number,
    completionTokens: number,
    isCacheMiss: boolean,
    pricing: ModelPricing
    ): CostResult {
    const million = 1000000;

    const promptCost = isCacheMiss
        ? (promptTokens / million) * pricing.cacheMissPerMillion
        : (promptTokens / million) * pricing.cacheHitPerMillion;

    const completionCost = (completionTokens / million) * pricing.outputPerMillion;

    const totalCost = promptCost + completionCost;

    const maxPromptCost = (promptTokens / million) * pricing.cacheMissPerMillion;
    const potentialMaxCost = maxPromptCost + completionCost;

    return {
        totalCost,
        potentialMaxCost,
        isCacheMiss,
    };
}