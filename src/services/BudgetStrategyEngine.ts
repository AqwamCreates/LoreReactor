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

function computeComplexityScore(chatData: ChatData): number {
    const history = chatData.chatMessageHistory;
    if (history.length === 0) return 0;

    // Concatenate recent messages (last 20 to avoid scanning entire history)
    const recentMessages = history.slice(-20);
    const combinedText = recentMessages.map(m => m.textContent).join('\n');
    const totalLen = combinedText.length || 1;

    // Count syntax-heavy symbols that break small models
    const curlyBrackets = (combinedText.match(/[{}]/g) || []).length;
    const squareBrackets = (combinedText.match(/[\[\]]/g) || []).length;
    const colons = (combinedText.match(/:/g) || []).length;
    const asterisks = (combinedText.match(/\*/g) || []).length;       // italics/bold markers
    const underscores = (combinedText.match(/_/g) || []).length;      // alt italics/code
    const backticks = (combinedText.match(/`/g) || []).length;        // code blocks
    const pipes = (combinedText.match(/\|/g) || []).length;           // tables
    const angleBrackets = (combinedText.match(/[<>]/g) || []).length; // HTML/XML tags
    const hashMarks = (combinedText.match(/#/g) || []).length;        // markdown headers
    const dashes = (combinedText.match(/---+/g) || []).length;        // horizontal rules / YAML

    const syntaxSymbolCount = curlyBrackets + squareBrackets + colons +
        asterisks + underscores + backticks + pipes + angleBrackets + hashMarks + dashes;

    // Syntax density: ratio of syntax symbols to total text length
    const syntaxDensity = Math.min(1, syntaxSymbolCount / (totalLen * 0.1));

    // Token density still matters but weighted lower
    const totalTokens = recentMessages.reduce((sum, m) => sum + estimateTokens(m.textContent), 0);
    const ctxLen = 8192;
    const tokenDensity = Math.min(1, totalTokens / ctxLen);

    // Message count factor
    const msgFactor = Math.min(1, history.length / 50);

    // Weighted: syntax density dominates, tokens and message count secondary
    const raw = (syntaxDensity * 0.50) + (tokenDensity * 0.30) + (msgFactor * 0.20);
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