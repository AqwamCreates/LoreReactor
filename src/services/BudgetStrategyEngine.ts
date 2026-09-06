// src/services/BudgetStrategyEngine.ts
import type { BudgetStrategy, Character, InteractionData, LanguageModel } from '../types';
import { LanguageModelEngine, type LanguageModelContext, type StreamCallbacks } from './LanguageModelEngine';
import { prepareRequestBody } from '../hooks/chatLogic';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';

const engine = new LanguageModelEngine();

function buildPricing(model: LanguageModel): ModelPricing {
    return {
        cacheHitPerMillion: model.cacheHitCostPerOneMillionOfTokens ?? 0,
        cacheMissPerMillion: model.cacheMissCostPerOneMillionOfTokens ?? 0,
        outputPerMillion: model.outputGenerationCostPerOneMillionOfTokens ?? 0,
    };
}

function computeComplexityScore(interactionData: InteractionData): number {
    const history = interactionData.interactionHistory;
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

/** Checks whether an error is a quota/rate-limit error that warrants rotating to the next model. */
function isQuotaError(e: unknown): boolean {
    const status = (e as any)?.status ?? (e as any)?.statusCode;
    const message = ((e as Error)?.message || '').toLowerCase();
    return status === 429 || status === 403 || status === 503 ||
        message.includes('rate limit') || message.includes('usage limit') ||
        message.includes('quota') || message.includes('credit') || 
        message.includes('exceeded') || message.includes('insufficient') ||
        message.includes('billing') || message.includes('allowance') ||
        message.includes('subscribe') || message.includes('too many requests');
}

export interface RunningModelState {
    isRunning: boolean;
    port?: number;
}

export class BudgetStrategyEngine {
    private strategy: BudgetStrategy;
    public currentCost = 0;

    /** Snapshot of running models at time of construction */
    private runningModels: Record<string, RunningModelState>;

    /** Callback to load a local model by ID. Returns the port on success, null on failure. */
    private loadLocalModel: ((id: string) => Promise<number | null>) | null;

    /** Index into each pool — exhaust-first means we stay on the same index until it fails. */
    private onlineIndex = 0;
    private localIndex = 0;

    /** Tracks which models in each pool have been exhausted during the current generation attempt. */
    private failedOnlineIndices = new Set<number>();
    private failedLocalIndices = new Set<number>();

    constructor(
        strategy: BudgetStrategy,
        runningModels: Record<string, RunningModelState>,
        initialCost = 0,
        loadLocalModel?: (id: string) => Promise<number | null>,
    ) {
        this.strategy = strategy;
        this.runningModels = runningModels;
        this.currentCost = initialCost;
        this.loadLocalModel = loadLocalModel ?? null;
    }

    /** Builds a model context, resolving runtimePort from the running models map. */
    private buildModelContext(model: LanguageModel): LanguageModelContext {
        const isCloud = !!model.apiKey && model.backend;
        const running = this.runningModels[model.id];
        const runtimePort = isCloud ? undefined : (running?.port || (model.parameters as any)?._runtimePort);

        return {
            apiKey: model.apiKey,
            backend: model.backend,
            modelPath: model.model,
            runtimePort,
        };
    }

    /** Checks if a model is ready to use (cloud models are always ready, local models need a port). */
    private isModelReady(model: LanguageModel): boolean {
        const isCloud = !!model.apiKey && model.backend;
        if (isCloud) return true;
        const running = this.runningModels[model.id];
        return !!(running?.port || (model.parameters as any)?._runtimePort);
    }

    /** Attempts to load a local model if it's not already running. Returns true if ready after call. */
    private async ensureModelLoaded(model: LanguageModel): Promise<boolean> {
        if (this.isModelReady(model)) return true;

        const isCloud = !!model.apiKey && model.backend;
        if (isCloud) return true;

        if (!this.loadLocalModel) return false;

        try {
            const port = await this.loadLocalModel(model.id);
            if (port) {
                // Update our local snapshot so subsequent calls see the new port
                this.runningModels = {
                    ...this.runningModels,
                    [model.id]: { isRunning: true, port },
                };
                return true;
            }
        } catch (e) {
            console.warn(`Failed to auto-load model ${model.name}:`, e);
        }

        return false;
    }

    /**
     * Selects the next available model from a pool.
     * Exhaust-first: stays on currentIndex until it's marked failed, then advances.
     */
    private selectFromPool(
        pool: LanguageModel[],
        currentIndex: number,
        failedIndices: Set<number>,
    ): { model: LanguageModel; index: number } | null {
        if (pool.length === 0) return null;

        // If current index hasn't failed, use it
        if (!failedIndices.has(currentIndex % pool.length)) {
            const idx = currentIndex % pool.length;
            return { model: pool[idx], index: idx };
        }

        // Current index failed — find next non-failed model
        for (let attempt = 1; attempt < pool.length; attempt++) {
            const idx = (currentIndex + attempt) % pool.length;
            if (!failedIndices.has(idx)) {
                return { model: pool[idx], index: idx };
            }
        }

        // All models in pool have been exhausted
        return null;
    }

    async generateStream(
        interactionData: InteractionData,
        character: Character,
        abortController: AbortController,
        callbacks?: StreamCallbacks,
        userImagesBase64?: string[],
    ): Promise<string> {
        const useOnline = await this.shouldUseOnline(interactionData);

        // Reset per-attempt failure tracking
        this.failedOnlineIndices.clear();
        this.failedLocalIndices.clear();

        const primaryPool = useOnline ? this.strategy.onlineModels : this.strategy.localModels;
        const fallbackPool = useOnline ? this.strategy.localModels : this.strategy.onlineModels;
        const primaryIndex = useOnline ? this.onlineIndex : this.localIndex;
        const primaryFailedSet = useOnline ? this.failedOnlineIndices : this.failedLocalIndices;
        const fallbackFailedSet = useOnline ? this.failedLocalIndices : this.failedOnlineIndices;

        const wrappedCallbacks: StreamCallbacks | undefined = callbacks ? {
            onToken: callbacks.onToken,
        } : undefined;

        // ─── Try primary pool (exhaust-first) ───
        while (true) {
            const selection = this.selectFromPool(primaryPool, primaryIndex, primaryFailedSet);
            if (!selection) break;

            // Auto-load local model if not already running
            const loaded = await this.ensureModelLoaded(selection.model);
            if (!loaded) {
                primaryFailedSet.add(selection.index);
                console.warn(`Model ${selection.model.name} could not be loaded, skipping.`);
                continue;
            }

            const primaryCtx = this.buildModelContext(selection.model);
            const pricing = buildPricing(selection.model);
            const runtimePort = primaryCtx.runtimePort;

            try {
                const { body } = await prepareRequestBody(interactionData, character, '', userImagesBase64, runtimePort);

                const result = await engine.generateStream(
                    body,
                    abortController,
                    wrappedCallbacks,
                    primaryCtx,
                );

                // Success — update persistent index to this model for next request
                if (useOnline) {
                    this.onlineIndex = selection.index;
                } else {
                    this.localIndex = selection.index;
                }

                // Track cost
                const promptTokens = await engine.countTokens(body.prompt || '');
                const completionTokens = await engine.countTokens(result.text);
                const cost = calculateRequestCost(promptTokens, completionTokens, false, pricing);
                this.currentCost += cost.totalCost;

                return result.text;
            } catch (e) {
                if (abortController.signal.aborted) throw e;

                // Only rotate on quota/rate-limit errors
                if (!isQuotaError(e)) {
                    throw e;
                }

                // Mark this model as exhausted and try next in pool
                primaryFailedSet.add(selection.index);
                console.warn(`Model ${selection.model.name} hit quota/rate limit, rotating to next in pool.`);
            }
        }

        // ─── Primary pool exhausted — try fallback pool ───
        if (this.strategy.fallbackOnLocalFailure && !abortController.signal.aborted) {
            const fallbackIndex = useOnline ? this.localIndex : this.onlineIndex;

            while (true) {
                const selection = this.selectFromPool(fallbackPool, fallbackIndex, fallbackFailedSet);
                if (!selection) break;

                // Auto-load fallback model if not already running
                const loaded = await this.ensureModelLoaded(selection.model);
                if (!loaded) {
                    fallbackFailedSet.add(selection.index);
                    console.warn(`Fallback model ${selection.model.name} could not be loaded, skipping.`);
                    continue;
                }

                const fallbackCtx = this.buildModelContext(selection.model);
                const fallbackPricing = buildPricing(selection.model);
                const fallbackPort = fallbackCtx.runtimePort;

                try {
                    const { body: fallbackBody } = await prepareRequestBody(interactionData, character, '', userImagesBase64, fallbackPort);

                    const result = await engine.generateStream(
                        fallbackBody,
                        abortController,
                        wrappedCallbacks,
                        fallbackCtx,
                    );

                    // Update persistent fallback index
                    if (useOnline) {
                        this.localIndex = selection.index;
                    } else {
                        this.onlineIndex = selection.index;
                    }

                    const promptTokens = await engine.countTokens(fallbackBody.prompt || '');
                    const completionTokens = await engine.countTokens(result.text);
                    const cost = calculateRequestCost(promptTokens, completionTokens, false, fallbackPricing);
                    this.currentCost += cost.totalCost;

                    return result.text;
                } catch (e) {
                    if (abortController.signal.aborted) throw e;

                    if (!isQuotaError(e)) throw e;

                    fallbackFailedSet.add(selection.index);
                    console.warn(`Fallback model ${selection.model.name} also hit quota/rate limit, rotating.`);
                }
            }
        }

        throw new Error('All models in both primary and fallback pools have been exhausted.');
    }

    private async shouldUseOnline(interactionData: InteractionData): Promise<boolean> {
        // No online models available → force local
        if (this.strategy.onlineModels.length === 0) return false;

        // No local models available → force online
        if (this.strategy.localModels.length === 0) return true;

        // Budget exceeded → force local
        if (this.currentCost >= this.strategy.maximumBudget) return false;

        // Count tokens in history
        let numberOfTokens = 0;
        for (const m of interactionData.interactionHistory) {
            numberOfTokens += await engine.countTokens(m.textContent);
        }

        // Context size threshold
        if (numberOfTokens >= this.strategy.switchOnContextSize) return true;

        const complexityScore = computeComplexityScore(interactionData);

        // Complexity score threshold
        if (complexityScore !== undefined && complexityScore >= this.strategy.switchOnComplexityScore) return true;

        // Probability-based switching
        const roll = Math.random() * 100;
        return roll < this.strategy.switchProbability;
    }
}