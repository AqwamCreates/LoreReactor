// src/services/BudgetStrategyEngine.ts

import type { LanguageModelContext, StreamCallbacks } from ".";
import { prepareRequestBody } from "../../application/usecases/chatService";
import { type ModelPricing, calculateRequestCost } from "../../core/utils/costCalculator";
import type { ChatData, BudgetStrategy, Character } from "../../types";
import { LanguageModelEngine } from "./languageModelEngine";

const engine = new LanguageModelEngine();

function buildModelContext(model: any): LanguageModelContext {
    return {
        apiKey: model.apiKey,
        backend: model.backend,
        modelPath: model.model,
        runtimePort: (model.parameters as any)?._runtimePort,
    };
}

function computeComplexityScore(chatData: ChatData): number {
    const history = chatData.chatMessageHistory;
    if (history.length === 0) return 0;

    const recentMessages = history.slice(-20);
    const combinedText = recentMessages.map(m => m.textContent).join('\n');
    const totalLen = combinedText.length || 1;

    const curlyBrackets = (combinedText.match(/[{}]/g) || []).length;
    const squareBrackets = (combinedText.match(/[\[\]]/g) || []).length;
    const colons = (combinedText.match(/:/g) || []).length;
    const asterisks = (combinedText.match(/\*/g) || []).length;
    const underscores = (combinedText.match(/_/g) || []).length;
    const backticks = (combinedText.match(/`/g) || []).length;
    const pipes = (combinedText.match(/\|/g) || []).length;
    const angleBrackets = (combinedText.match(/[<>]/g) || []).length;
    const hashMarks = (combinedText.match(/#/g) || []).length;
    const dashes = (combinedText.match(/---+/g) || []).length;
    const tabs = (combinedText.match(/\t/g) || []).length;
    const carriageReturns = (combinedText.match(/\r/g) || []).length;
    const carets = (combinedText.match(/\^/g) || []).length;
    const slashes = (combinedText.match(/[\\/]/g) || []).length;
    const atSigns = (combinedText.match(/@/g) || []).length;

    const syntaxSymbolCount = curlyBrackets + squareBrackets + colons +
        asterisks + underscores + backticks + pipes + angleBrackets +
        hashMarks + dashes + tabs + carriageReturns + carets + slashes + atSigns;

    const syntaxDensity = Math.min(1, syntaxSymbolCount / (totalLen * 0.1));

    return Math.round(syntaxDensity * 100);
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

        const complexityScore = computeComplexityScore(chatData);

        const useOnline = await this.shouldUseOnline(chatData, complexityScore);
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
            const promptTokens = await engine.countTokens(body.prompt || '');
            const completionTokens = await engine.countTokens(result.text);
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

                const promptTokens = await engine.countTokens(fallbackBody.prompt || '');
                const completionTokens = await engine.countTokens(result.text);
                const cost = calculateRequestCost(promptTokens, completionTokens, false, fallbackPricing);
                this.currentCost += cost.totalCost;

                return result.text;
            }
            throw e;
        }
    }

    private async shouldUseOnline(chatData: ChatData, complexityScore?: number): Promise<boolean> {
        // Budget exceeded → force local
        if (this.currentCost >= this.strategy.maximumBudget) return false;

        // ✅ Fixed: use for loop instead of await inside reduce
        let numberOfTokens = 0;
        for (const m of chatData.chatMessageHistory) {
            numberOfTokens += await engine.countTokens(m.textContent);
        }

        // Context size threshold
        if (numberOfTokens >= this.strategy.switchOnContextSize) return true;

        // Complexity score threshold
        if (complexityScore !== undefined && complexityScore >= this.strategy.switchOnComplexityScore) return true;

        // Probability-based switching
        const roll = Math.random() * 100;
        return roll < this.strategy.switchProbabilty;
    }
}