// src/services/BudgetStrategyEngine.ts
import type { BudgetStrategy, Character, ChatData } from '../types';
import { LanguageModelEngine, estimateTokens, type LanguageModelContext, type StreamCallbacks } from './LanguageModelEngine';
import { prepareRequestBody } from '../hooks/chatLogic';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';

const engine = new LanguageModelEngine();

function buildModelContext(model: any): LanguageModelContext {
    return {
        apiKey: model.apiKey,
        backend: model.backend,
        modelPath: model.model,
        runtimePort: (model.parameters as any)?._runtimePort,
    };
}

/**
 * Estimates prompt complexity as a 0-100 score.
 * Based on: token count relative to context length, number of active contexts,
 * message count, and average message length variance.
 */
function computeComplexityScore(chatData: ChatData): number {
    const history = chatData.chatMessageHistory;
    if (history.length === 0) return 0;

    // Token density: how full is the context window
    const totalTokens = history.reduce((sum, m) => sum + estimateTokens(m.textContent), 0);
    const ctxLen = 8192; // Default; budget strategy models may differ
    const tokenDensity = Math.min(1, totalTokens / ctxLen);

    // Message count factor (more messages = more complex conversation state)
    const msgFactor = Math.min(1, history.length / 50);

    // Context count factor
    const contextFactor = Math.min(1, (chatData.contexts?.length ?? 0) / 10);

    // Average message length variance (long messages = more complex content)
    const avgLen = totalTokens / history.length;
    const lenFactor = Math.min(1, avgLen / 500);

    // Weighted combination scaled to 0-100
    const raw = (tokenDensity * 0.35) + (msgFactor * 0.25) + (contextFactor * 0.20) + (lenFactor * 0.20);
    return Math.round(raw * 100);
}

export class BudgetStrategyEngine {
    private strategy: BudgetStrategy;
    public currentCost = 0;

    constructor(strategy: BudgetStrategy, initialCost = 0) {
        this.strategy = strategy;
        this.currentCost = initialCost;
    }

    async generateStream(
        chatData: ChatData,
        character: Character,
        abortController: AbortController,
        callbacks?: StreamCallbacks,
        userImagesBase64?: string[],
    ): Promise<string> {
        const onlineCtx = buildModelContext(this.strategy.onlineModel);
        const localCtx = buildModelContext(this.strategy.localModel);

        const complexityScore = computeComplexityScore(chatData)

        const useOnline = this.shouldUseOnline(chatData, complexityScore);
        const primaryCtx = useOnline ? onlineCtx : localCtx;
        const fallbackCtx = useOnline ? localCtx : onlineCtx;
        const primaryModel = useOnline ? this.strategy.onlineModel : this.strategy.localModel;

        const runtimePort = primaryCtx.runtimePort;
        const { body } = await prepareRequestBody(chatData, character, '', userImagesBase64, runtimePort);

        // Build pricing from the selected model's cost fields
        const pricing: ModelPricing = {
            cacheHitPerMillion: primaryModel.cacheHitCostPerOneMillionOfTokens ?? 0,
            cacheMissPerMillion: primaryModel.cacheMissCostPerOneMillionOfTokens ?? 0,
            outputPerMillion: primaryModel.outputGenerationCostPerOneMillionOfTokens ?? 0,
        };

        // Wrap callbacks to capture cost from onFinish
        const wrappedCallbacks: StreamCallbacks | undefined = callbacks ? {
            onToken: callbacks.onToken,
        } : undefined;

        try {
            const result = await engine.generateStream(
                body,
                abortController,
                wrappedCallbacks,
                primaryCtx,
            );

            // Estimate cost from token counts in the result
            const promptTokens = estimateTokens(body.prompt || '');
            const completionTokens = estimateTokens(result.text);
            const cost = calculateRequestCost(promptTokens, completionTokens, false, pricing);
            this.currentCost += cost.totalCost;

            return result.text;
        } catch (e) {
            if (this.strategy.fallbackOnLocalFailure && !abortController.signal.aborted) {
                const fallbackPort = fallbackCtx.runtimePort;
                const fallbackModel = useOnline ? this.strategy.localModel : this.strategy.onlineModel;
                const fallbackPricing: ModelPricing = {
                    cacheHitPerMillion: fallbackModel.cacheHitCostPerOneMillionOfTokens ?? 0,
                    cacheMissPerMillion: fallbackModel.cacheMissCostPerOneMillionOfTokens ?? 0,
                    outputPerMillion: fallbackModel.outputGenerationCostPerOneMillionOfTokens ?? 0,
                };

                const { body: fallbackBody } = await prepareRequestBody(chatData, character, '', userImagesBase64, fallbackPort);
                const result = await engine.generateStream(
                    fallbackBody,
                    abortController,
                    wrappedCallbacks,
                    fallbackCtx,
                );

                const promptTokens = estimateTokens(fallbackBody.prompt || '');
                const completionTokens = estimateTokens(result.text);
                const cost = calculateRequestCost(promptTokens, completionTokens, false, fallbackPricing);
                this.currentCost += cost.totalCost;

                return result.text;
            }
            throw e;
        }
    }

    private shouldUseOnline(chatData: ChatData, complexityScore?: number): boolean {
        // Budget exceeded → force local
        if (this.currentCost >= this.strategy.maximumBudget) return false;

        // Context size threshold
        const tokenCount = chatData.chatMessageHistory.reduce((sum, m) => sum + estimateTokens(m.textContent), 0);
        if (tokenCount >= this.strategy.switchOnContextSize) return true;

        // Complexity score threshold
        if (complexityScore !== undefined && complexityScore >= this.strategy.switchOnComplexityScore) return true;

        // Probability-based switching
        const roll = Math.random() * 100;
        return roll < this.strategy.switchProbabilty;
    }
}