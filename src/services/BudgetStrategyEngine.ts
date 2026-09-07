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
        message.includes('subscribe') || message.includes('too many requests') ||
        message.includes('per');
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

    /** Tracks which model IDs in each pool have been exhausted during the current generation attempt. */
    private failedOnlineIds = new Set<string>();
    private failedLocalIds = new Set<string>();

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

    /** Gets the cost tier for a model. Defaults to 0 if not assigned. */
    private getTier(model: LanguageModel): number {
        return this.strategy.modelCostTiers?.[model.id] ?? 0;
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
     * Selects the next available model from a pool using tier-aware selection.
     * Groups models by tier (highest first), tries all models in the highest
     * available tier before dropping to the next tier. Within a tier, rotates
     * through models that haven't failed yet.
     * Respects maxTier cap to prevent using expensive models for simple turns.
     */
    private selectFromPool(
        pool: LanguageModel[],
        failedIds: Set<string>,
        maxTier?: number,
    ): LanguageModel | null {
        if (pool.length === 0) return null;

        // Group models by tier, sorted highest-first
        const tierGroups = new Map<number, LanguageModel[]>();
        for (const model of pool) {
            if (failedIds.has(model.id)) continue;
            const tier = this.getTier(model);
            // Skip models above the per-turn tier cap
            if (maxTier !== undefined && tier > maxTier) continue;
            if (!tierGroups.has(tier)) tierGroups.set(tier, []);
            tierGroups.get(tier)!.push(model);
        }

        if (tierGroups.size === 0) return null;

        // Sort tiers descending — try highest tier first
        const sortedTiers = [...tierGroups.keys()].sort((a, b) => b - a);

        // Return the first available model from the highest non-empty tier
        for (const tier of sortedTiers) {
            const candidates = tierGroups.get(tier)!;
            if (candidates.length > 0) {
                return candidates[0];
            }
        }

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

        this.failedOnlineIds.clear();
        this.failedLocalIds.clear();

        const primaryPool = useOnline ? this.strategy.onlineModels : this.strategy.localModels;
        const fallbackPool = useOnline ? this.strategy.localModels : this.strategy.onlineModels;
        const primaryFailedSet = useOnline ? this.failedOnlineIds : this.failedLocalIds;
        const fallbackFailedSet = useOnline ? this.failedLocalIds : this.failedOnlineIds;

        // ─── Compute per-turn tier cap based on complexity relative to configured tiers ───
        const complexityScore = computeComplexityScore(interactionData);
        const tierValues = [...new Set(Object.values(this.strategy.modelCostTiers ?? {}))].sort((a, b) => a - b);
        let perTurnMaxTier: number | undefined;
        if (tierValues.length === 0) {
            // No tiers configured — no cap
            perTurnMaxTier = undefined;
        } else {
            // Map complexity (0-100) to a percentile index into the sorted unique tiers
            // complexity 0 → lowest tier, complexity 100 → highest tier
            const tierIndex = Math.min(
                tierValues.length - 1,
                Math.round((complexityScore / 100) * (tierValues.length - 1))
            );
            perTurnMaxTier = tierValues[tierIndex];
        }

        // Accumulates partial text across model rotations for seamless continuation
        let accumulatedPartialText = '';

        // Wrap callbacks to track partial output locally AND forward to UI
        const wrappedCallbacks: StreamCallbacks = {
            onToken: async (stats) => {
                accumulatedPartialText = stats.fullText;
                if (callbacks?.onToken) {
                    await callbacks.onToken(stats);
                }
            },
        };

        // ─── Try primary pool (tier-aware) ───
        while (true) {
            const selectedModel = this.selectFromPool(primaryPool, primaryFailedSet, perTurnMaxTier);
            if (!selectedModel) break;

            const loaded = await this.ensureModelLoaded(selectedModel);
            if (!loaded) {
                primaryFailedSet.add(selectedModel.id);
                console.warn(`Model ${selectedModel.name} could not be loaded, skipping.`);
                continue;
            }

            const primaryCtx = this.buildModelContext(selectedModel);
            const pricing = buildPricing(selectedModel);
            const runtimePort = primaryCtx.runtimePort;

            try {
                const { body } = await prepareRequestBody(interactionData, character, accumulatedPartialText, userImagesBase64, runtimePort);

                const result = await engine.generateStream(
                    body,
                    abortController,
                    wrappedCallbacks,
                    primaryCtx,
                );

                const promptTokens = await engine.countTokens(body.prompt || '');
                const completionTokens = await engine.countTokens(result.text);
                const cost = calculateRequestCost(promptTokens, completionTokens, false, pricing);
                this.currentCost += cost.totalCost;

                return accumulatedPartialText + result.text;
            } catch (e) {
                if (abortController.signal.aborted) throw e;

                if (!isQuotaError(e)) {
                    throw e;
                }

                primaryFailedSet.add(selectedModel.id);
                console.warn(`Model ${selectedModel.name} (tier ${this.getTier(selectedModel)}) hit quota/rate limit after partial output (${accumulatedPartialText.length} chars), rotating to next model for continuation.`);
            }
        }

        // ─── Primary pool exhausted — try fallback pool ───
        if (this.strategy.fallbackOnLocalFailure && !abortController.signal.aborted) {
            while (true) {
                const selectedModel = this.selectFromPool(fallbackPool, fallbackFailedSet, perTurnMaxTier);
                if (!selectedModel) break;

                const loaded = await this.ensureModelLoaded(selectedModel);
                if (!loaded) {
                    fallbackFailedSet.add(selectedModel.id);
                    console.warn(`Fallback model ${selectedModel.name} could not be loaded, skipping.`);
                    continue;
                }

                const fallbackCtx = this.buildModelContext(selectedModel);
                const fallbackPricing = buildPricing(selectedModel);
                const fallbackPort = fallbackCtx.runtimePort;

                try {
                    const { body: fallbackBody } = await prepareRequestBody(interactionData, character, accumulatedPartialText, userImagesBase64, fallbackPort);

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

                    return accumulatedPartialText + result.text;
                } catch (e) {
                    if (abortController.signal.aborted) throw e;

                    if (!isQuotaError(e)) throw e;

                    fallbackFailedSet.add(selectedModel.id);
                    console.warn(`Fallback model ${selectedModel.name} (tier ${this.getTier(selectedModel)}) also hit quota/rate limit, rotating.`);
                }
            }
        }

        // If we have partial text but all models exhausted, return what we got
        if (accumulatedPartialText.trim()) {
            return accumulatedPartialText;
        }

        throw new Error('All models in both primary and fallback pools have been exhausted.');
    }

    private async shouldUseOnline(interactionData: InteractionData): Promise<boolean> {
        if (this.strategy.onlineModels.length === 0) return false;
        if (this.strategy.localModels.length === 0) return true;
        if (this.currentCost >= this.strategy.maximumBudget) return false;

        let numberOfTokens = 0;
        for (const m of interactionData.interactionHistory) {
            numberOfTokens += await engine.countTokens(m.textContent);
        }

        if (numberOfTokens >= this.strategy.switchOnContextSize) return true;

        const complexityScore = computeComplexityScore(interactionData);

        if (complexityScore !== undefined && complexityScore >= this.strategy.switchOnComplexityScore) return true;

        const roll = Math.random() * 100;
        return roll < this.strategy.switchProbability;
    }
}