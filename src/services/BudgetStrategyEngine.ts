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
    const combinedText = recentMessages
        .filter((m): m is import('../types').ChatMessage => m.kind === 'chat')
        .map(m => m.textContent)
        .join('\n');
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

function isQuotaError(e: unknown): boolean {
    const status = (e as any)?.status ?? (e as any)?.statusCode;
    const message = ((e as Error)?.message || '').toLowerCase();
    return status === 429 || status === 403 || status === 503 ||
        message.includes('rate limit') || message.includes('usage limit') ||
        message.includes('quota') || message.includes('credit') ||
        message.includes('exceeded') || message.includes('insufficient') ||
        message.includes('billing') || message.includes('allowance') ||
        message.includes('subscribe') || message.includes('too many requests') ||
        message.includes('per') ||
        message.includes('failed to fetch') || message.includes('networkerror') ||
        message.includes('err_aborted') || message.includes('econnrefused') ||
        message.includes('enotfound') || message.includes('etimedout') ||
        message.includes('socket hang up') || message.includes('abort') ||
        message.includes('timeout') || message.includes('502') ||
        message.includes('503') || message.includes('504') ||
        message.includes('service unavailable') ||
        message.includes('429') || message.includes('api error');
}

function isResetDue(data: BudgetData): boolean {
    if (data.resetDuration <= 0) return false;
    return Date.now() - data.lastResetTimestamp >= data.resetDuration;
}

function applyResetIfDue(data: BudgetData): void {
    if (!isResetDue(data)) return;
    data.budgetSpent = 0;
    data.modelLastQuotaHitTimeStamps = {};
    data.modelLastErrorHitTimeStamps = {};
    data.lastResetTimestamp = Date.now();
    // Don't reset speed/TTFT — they're persistent performance metrics
}

export interface RunningModelState {
    isRunning: boolean;
    port?: number;
}

export class BudgetStrategyEngine {
    private strategy: BudgetStrategy;
    private budgetData: BudgetData;
    private runningModels: Record<string, RunningModelState>;
    private loadLocalModel: ((id: string) => Promise<number | null>) | null;
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
        applyResetIfDue(this.budgetData);
    }

    private getTier(model: LanguageModel): number {
        return this.strategy.modelCostTiers?.[model.id] ?? 0;
    }

    private isCacheWarm(modelId: string): boolean {
        const lastUsed = this.budgetData.modelLastUsedTimestamps[modelId];
        if (!lastUsed) return false;
        return (Date.now() - lastUsed) < DEFAULT_CACHE_TTL_MS;
    }

    private isInQuotaCooldown(modelId: string): boolean {
        const lastQuotaHit = this.budgetData.modelLastQuotaHitTimeStamps[modelId];
        if (!lastQuotaHit) return false;
        return (Date.now() - lastQuotaHit) < 60_000;
    }

    /** Gets the average generation speed (ms/token) for a model. Returns Infinity if no data. */
    private getModelSpeed(modelId: string): number {
        return this.budgetData.modelAverageGenerationSpeedMsPerToken?.[modelId] ?? Infinity;
    }

    /** Gets the average TTFT (ms) for a model. Returns Infinity if no data. */
    private getModelTTFT(modelId: string): number {
        return this.budgetData.modelAverageTimeToFirstToken?.[modelId] ?? Infinity;
    }

    /** Updates the rolling average generation speed for a model using configurable EMA alpha. */
    private recordGenerationSpeed(modelId: string, observedMsPerToken: number): void {
        if (!this.budgetData.modelAverageGenerationSpeedMsPerToken) {
            this.budgetData.modelAverageGenerationSpeedMsPerToken = {};
        }
        const alpha = this.budgetData.averageGenerationSpeedMsPerTokenExponentialMovingAverageSmoothing ?? 0.3;
        const previous = this.budgetData.modelAverageGenerationSpeedMsPerToken[modelId];
        if (previous === undefined) {
            this.budgetData.modelAverageGenerationSpeedMsPerToken[modelId] = observedMsPerToken;
        } else {
            this.budgetData.modelAverageGenerationSpeedMsPerToken[modelId] =
                (alpha * observedMsPerToken) + ((1 - alpha) * previous);
        }
    }

    /** Updates the rolling average TTFT for a model using configurable EMA alpha. */
    private recordTTFT(modelId: string, observedMs: number): void {
        if (!this.budgetData.modelAverageTimeToFirstToken) {
            this.budgetData.modelAverageTimeToFirstToken = {};
        }
        const alpha = this.budgetData.averageTimeToFirstTokenExponentialMovingAverageSmoothing ?? 0.3;
        const previous = this.budgetData.modelAverageTimeToFirstToken[modelId];
        if (previous === undefined) {
            this.budgetData.modelAverageTimeToFirstToken[modelId] = observedMs;
        } else {
            this.budgetData.modelAverageTimeToFirstToken[modelId] =
                (alpha * observedMs) + ((1 - alpha) * previous);
        }
    }

    private getEffectiveTier(model: LanguageModel): number {
        let tier = this.getTier(model);
        const isCloud = !!model.apiKey && model.backend;
        if (isCloud && this.isCacheWarm(model.id)) {
            tier += CACHE_WARMTH_TIER_BONUS;
        }
        return tier;
    }

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

    private isModelReady(model: LanguageModel): boolean {
        const isCloud = !!model.apiKey && model.backend;
        if (isCloud) return true;
        const running = this.runningModels[model.id];
        return !!(running?.port || (model.parameters as any)?._runtimePort);
    }

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
     * Selects the next available model from a pool.
     * Groups by effective tier (highest first), then within each tier sorts by:
     *   1. Cache warmth (warm first)
     *   2. Generation speed (faster first — lower ms/token is better)
     *   3. TTFT (lower first — snappier response preferred)
     *   4. Base tier descending as tiebreaker
     */
    private selectFromPool(
        pool: LanguageModel[],
        failedIds: Set<string>,
        maxTier?: number,
    ): LanguageModel | null {
        if (pool.length === 0) return null;

        const tierGroups = new Map<number, LanguageModel[]>();
        for (const model of pool) {
            if (failedIds.has(model.id)) continue;
            if (this.isInQuotaCooldown(model.id)) continue;
            const tier = this.getEffectiveTier(model);
            if (maxTier !== undefined && this.getTier(model) > maxTier) continue;
            if (!tierGroups.has(tier)) tierGroups.set(tier, []);
            tierGroups.get(tier)!.push(model);
        }

        if (tierGroups.size === 0) return null;

        const sortedTiers = [...tierGroups.keys()].sort((a, b) => b - a);

        for (const tier of sortedTiers) {
            const candidates = tierGroups.get(tier)!;
            candidates.sort((a, b) => {
                // 1. Cache warmth
                const aWarm = this.isCacheWarm(a.id) ? 1 : 0;
                const bWarm = this.isCacheWarm(b.id) ? 1 : 0;
                if (aWarm !== bWarm) return bWarm - aWarm;

                // 2. Generation speed (lower ms/token = faster = preferred)
                const aSpeed = this.getModelSpeed(a.id);
                const bSpeed = this.getModelSpeed(b.id);
                if (aSpeed !== bSpeed) return aSpeed - bSpeed;

                // 3. TTFT (lower = snappier = preferred)
                const aTTFT = this.getModelTTFT(a.id);
                const bTTFT = this.getModelTTFT(b.id);
                if (aTTFT !== bTTFT) return aTTFT - bTTFT;

                // 4. Base tier as tiebreaker
                return this.getTier(b) - this.getTier(a);
            });
            if (candidates.length > 0) {
                return candidates[0];
            }
        }

        return null;
    }

    private recordSuccess(modelId: string, cost: number): void {
        this.budgetData.budgetSpent += cost;
        this.budgetData.modelLastUsedTimestamps[modelId] = Date.now();
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    private recordQuotaError(modelId: string): void {
        this.budgetData.modelLastQuotaHitTimeStamps[modelId] = Date.now();
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    private recordError(modelId: string): void {
        this.budgetData.modelLastErrorHitTimeStamps[modelId] = Date.now();
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

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

        let accumulatedPartialText = '';

        const wrappedCallbacks: StreamCallbacks = {
            onToken: async (stats) => {
                accumulatedPartialText = stats.fullText;
                if (callbacks?.onToken) {
                    await callbacks.onToken(stats);
                }
            },
        };

        // ─── Try primary pool ───
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

                // Record generation speed and TTFT from observed stats
                if (result.msPerToken && result.msPerToken > 0) {
                    this.recordGenerationSpeed(selectedModel.id, result.msPerToken);
                }
                if (result.timeToFirstToken && result.timeToFirstToken > 0) {
                    this.recordTTFT(selectedModel.id, result.timeToFirstToken);
                }

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

                    if (result.msPerToken && result.msPerToken > 0) {
                        this.recordGenerationSpeed(selectedModel.id, result.msPerToken);
                    }
                    if (result.timeToFirstToken && result.timeToFirstToken > 0) {
                        this.recordTTFT(selectedModel.id, result.timeToFirstToken);
                    }

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

        if (accumulatedPartialText.trim()) {
            return accumulatedPartialText;
        }

        const exhaustedError = new Error('All models in both primary and fallback pools have been exhausted.');
        console.error('[BudgetEngine] Exhausted. Primary failed:', [...this.failedOnlineIds], 'Fallback failed:', [...this.failedLocalIds]);
        throw exhaustedError;
    }

    private async shouldUseOnline(interactionData: InteractionData): Promise<boolean> {
        if (this.strategy.onlineModels.length === 0) return false;
        if (this.strategy.localModels.length === 0) return true;
        if (this.budgetData.budgetSpent >= this.strategy.maximumBudget) return false;

        let numberOfTokens = 0;
        for (const m of interactionData.interactionHistory) {
            if (m.kind === 'chat') numberOfTokens += await engine.countTokens(m.textContent);
        }

        if (numberOfTokens >= this.strategy.switchOnContextSize) return true;

        const complexityScore = computeComplexityScore(interactionData);
        if (complexityScore !== undefined && complexityScore >= this.strategy.switchOnComplexityScore) return true;

        const roll = Math.random() * 100;
        return roll < this.strategy.switchProbability;
    }
}