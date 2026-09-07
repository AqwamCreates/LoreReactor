// src/services/BudgetStrategyEngine.ts
import type { BudgetStrategy, BudgetData, Character, InteractionData, LanguageModel } from '../types';
import { LanguageModelEngine, type LanguageModelContext, type StreamCallbacks } from './LanguageModelEngine';
import { prepareRequestBody } from '../hooks/chatLogic';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';

const engine = new LanguageModelEngine();

/** Default cache TTL assumption for online models (5 minutes). */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Tier bonus applied to models whose cache is likely still warm. */
const CACHE_WARMTH_TIER_BONUS = 1;

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

/** Checks if a budget reset is due based on resetDuration. */
function isResetDue(data: BudgetData): boolean {
    if (data.resetDuration <= 0) return false;
    return Date.now() - data.lastResetTimestamp >= data.resetDuration;
}

/** Applies a budget reset if due. Mutates the data in place. */
function applyResetIfDue(data: BudgetData): void {
    if (!isResetDue(data)) return;
    data.budgetSpent = 0;
    data.modelLastQuotaHitTimeStamps = {};
    data.modelLastErrorHitTimeStamps = {};
    data.lastResetTimestamp = Date.now();
}

export interface RunningModelState {
    isRunning: boolean;
    port?: number;
}

export class BudgetStrategyEngine {
    private strategy: BudgetStrategy;
    private budgetData: BudgetData;

    /** Snapshot of running models at time of construction */
    private runningModels: Record<string, RunningModelState>;

    /** Callback to load a local model by ID. Returns the port on success, null on failure. */
    private loadLocalModel: ((id: string) => Promise<number | null>) | null;

    /** Tracks which model IDs in each pool have been exhausted during the current generation attempt. */
    private failedOnlineIds = new Set<string>();
    private failedLocalIds = new Set<string>();

    constructor(
        strategy: BudgetStrategy,
        budgetData: BudgetData,
        runningModels: Record<string, RunningModelState>,
        loadLocalModel?: (id: string) => Promise<number | null>,
    ) {
        this.strategy = strategy;
        this.budgetData = budgetData;
        this.runningModels = runningModels;
        this.loadLocalModel = loadLocalModel ?? null;

        // Apply reset if due at construction time
        applyResetIfDue(this.budgetData);
    }

    /** Gets the cost tier for a model. Defaults to 0 if not assigned. */
    private getTier(model: LanguageModel): number {
        return this.strategy.modelCostTiers?.[model.id] ?? 0;
    }

    /** Checks if a model's cache is likely still warm based on last usage timestamp. */
    private isCacheWarm(modelId: string): boolean {
        const lastUsed = this.budgetData.modelLastUsedTimestamps[modelId];
        if (!lastUsed) return false;
        return (Date.now() - lastUsed) < DEFAULT_CACHE_TTL_MS;
    }

    /** Checks if a model is in quota cooldown. */
    private isInQuotaCooldown(modelId: string): boolean {
        const lastQuotaHit = this.budgetData.modelLastQuotaHitTimeStamps[modelId];
        if (!lastQuotaHit) return false;
        // Cooldown for 60 seconds after quota hit
        return (Date.now() - lastQuotaHit) < 60_000;
    }

    /** Gets the effective tier for selection, including cache warmth bonus. */
    private getEffectiveTier(model: LanguageModel): number {
        let tier = this.getTier(model);
        // Only apply cache warmth bonus to cloud models
        const isCloud = !!model.apiKey && model.backend;
        if (isCloud && this.isCacheWarm(model.id)) {
            tier += CACHE_WARMTH_TIER_BONUS;
        }
        return tier;
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
     * Groups models by effective tier (highest first), tries all models in the highest
     * available tier before dropping to the next tier. Within a tier, prefers
     * cache-warm models. Skips models in quota cooldown.
     * Respects maxTier cap to prevent using expensive models for simple turns.
     */
    private selectFromPool(
        pool: LanguageModel[],
        failedIds: Set<string>,
        maxTier?: number,
    ): LanguageModel | null {
        if (pool.length === 0) return null;

        // Group models by effective tier, sorted highest-first
        const tierGroups = new Map<number, LanguageModel[]>();
        for (const model of pool) {
            if (failedIds.has(model.id)) continue;
            if (this.isInQuotaCooldown(model.id)) continue;
            const tier = this.getEffectiveTier(model);
            // Skip models above the per-turn tier cap (use base tier for cap comparison)
            if (maxTier !== undefined && this.getTier(model) > maxTier) continue;
            if (!tierGroups.has(tier)) tierGroups.set(tier, []);
            tierGroups.get(tier)!.push(model);
        }

        if (tierGroups.size === 0) return null;

        // Sort tiers descending — try highest effective tier first
        const sortedTiers = [...tierGroups.keys()].sort((a, b) => b - a);

        // Within the highest tier, prefer cache-warm models
        for (const tier of sortedTiers) {
            const candidates = tierGroups.get(tier)!;
            // Sort candidates: cache-warm first, then by base tier descending
            candidates.sort((a, b) => {
                const aWarm = this.isCacheWarm(a.id) ? 1 : 0;
                const bWarm = this.isCacheWarm(b.id) ? 1 : 0;
                if (aWarm !== bWarm) return bWarm - aWarm;
                return this.getTier(b) - this.getTier(a);
            });
            if (candidates.length > 0) {
                return candidates[0];
            }
        }

        return null;
    }

    /** Records a successful model usage in budget data. */
    private recordSuccess(modelId: string, cost: number): void {
        this.budgetData.budgetSpent += cost;
        this.budgetData.modelLastUsedTimestamps[modelId] = Date.now();
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    /** Records a quota error in budget data. */
    private recordQuotaError(modelId: string): void {
        this.budgetData.modelLastQuotaHitTimeStamps[modelId] = Date.now();
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    /** Records a non-quota error in budget data. */
    private recordError(modelId: string): void {
        this.budgetData.modelLastErrorHitTimeStamps[modelId] = Date.now();
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    /** Returns the updated budget data for persistence after generation. */
    getBudgetData(): BudgetData {
        return this.budgetData;
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
            perTurnMaxTier = undefined;
        } else {
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
                this.recordError(selectedModel.id);
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
                this.recordSuccess(selectedModel.id, cost.totalCost);

                return accumulatedPartialText + result.text;
            } catch (e) {
                if (abortController.signal.aborted) throw e;

                if (!isQuotaError(e)) {
                    this.recordError(selectedModel.id);
                    throw e;
                }

                primaryFailedSet.add(selectedModel.id);
                this.recordQuotaError(selectedModel.id);
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
                    this.recordError(selectedModel.id);
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
                    this.recordSuccess(selectedModel.id, cost.totalCost);

                    return accumulatedPartialText + result.text;
                } catch (e) {
                    if (abortController.signal.aborted) throw e;

                    if (!isQuotaError(e)) {
                        this.recordError(selectedModel.id);
                        throw e;
                    }

                    fallbackFailedSet.add(selectedModel.id);
                    this.recordQuotaError(selectedModel.id);
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
        if (this.budgetData.budgetSpent >= this.strategy.maximumBudget) return false;

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