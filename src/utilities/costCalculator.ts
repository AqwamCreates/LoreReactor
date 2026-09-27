// src/utils/costCalculator.ts

export interface ModelPricing {
    cacheHitPerMillion: number;
    cacheMissPerMillion: number;
    outputPerMillion: number;
}

export interface CostResult {
    totalCost: number;
    potentialMaxCost: number;
    cachedTokens: number;
    freshTokens: number;
    completionTokens: number;
}

export function calculateRequestCost(
    promptTokens: number,
    cachedTokens: number,
    completionTokens: number,
    pricing: ModelPricing
): CostResult {
    const million = 1000000;

    const freshTokens = Math.max(0, promptTokens - cachedTokens);

    const freshCost = (freshTokens / million) * pricing.cacheMissPerMillion;
    const cachedCost = (cachedTokens / million) * pricing.cacheHitPerMillion;
    const completionCost = (completionTokens / million) * pricing.outputPerMillion;

    const totalCost = cachedCost + freshCost + completionCost;

    const maxPromptCost = (promptTokens / million) * pricing.cacheMissPerMillion;
    const potentialMaxCost = maxPromptCost + completionCost;

    return {
        totalCost,
        potentialMaxCost,
        cachedTokens,
        freshTokens,
        completionTokens,
    };
}