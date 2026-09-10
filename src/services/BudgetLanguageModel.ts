// src/services/BudgetLanguageModel.ts
import {
    BaseLanguageModel,
    type GenerationRequest,
    type GenerationResponse,
    type StreamCallbacks,
    type ModelPortResolver,
} from './BaseLanguageModel';
import { LanguageModel, streamFromBackend } from './LanguageModel';
import type { BudgetStrategy, BudgetData, LanguageModelData, LanguageModelDataContext } from '../types';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';

function buildPricing(model: LanguageModelData): ModelPricing {
    return {
        cacheHitPerMillion: model.cacheHitCostPerOneMillionOfTokens ?? 0,
        cacheMissPerMillion: model.cacheMissCostPerOneMillionOfTokens ?? 0,
        outputPerMillion: model.outputGenerationCostPerOneMillionOfTokens ?? 0,
    };
}

function isFreeModel(model: LanguageModelData): boolean {
    const pricing = buildPricing(model);
    return pricing.cacheHitPerMillion <= 0 &&
           pricing.cacheMissPerMillion <= 0 &&
           pricing.outputPerMillion <= 0;
}

function isQuotaError(e: unknown): boolean {
    const obj = e as Record<string, unknown>;
    const status = obj?.status ?? obj?.statusCode;
    const message = ((e as Error)?.message || '').toLowerCase();
    return status === 429 || status === 403 || status === 503 ||
        message.includes('rate limit') || message.includes('quota') ||
        message.includes('exceeded') || message.includes('insufficient') ||
        message.includes('billing') || message.includes('too many requests') ||
        message.includes('failed to fetch') || message.includes('networkerror') ||
        message.includes('502') || message.includes('503') || message.includes('504') ||
        message.includes('service unavailable') || message.includes('429');
}

/**
 * Budget-aware multi-model generation strategy.
 * Selects models based on cost tiers, quality scores, and budget state.
 * Tracks latency, TTFT, costs, and quota errors internally.
 * Loading delegated to injected ModelPortResolver.
 */
export class BudgetLanguageModel extends BaseLanguageModel {
    readonly name = 'BudgetStrategy';

    private strategy: BudgetStrategy;
    private budgetData: BudgetData;
    private portResolver: ModelPortResolver;
    private failedOnlineIds = new Set<string>();
    private failedLocalIds = new Set<string>();

    constructor(
        strategy: BudgetStrategy,
        budgetData: BudgetData,
        portResolver: ModelPortResolver,
    ) {
        super();
        this.strategy = strategy;
        this.budgetData = budgetData;
        this.portResolver = portResolver;
        this.applyResetIfDue();
    }

    getBudgetData(): BudgetData {
        return this.budgetData;
    }

    async generateCompletion(
        request: GenerationRequest,
        signal?: AbortSignal,
    ): Promise<GenerationResponse> {
        let fullText = '';
        const result = await this.generateStream(request, {
            onToken: async (stats) => { fullText = stats.fullText; },
        }, signal);
        return result;
    }

    async generateStream(
        request: GenerationRequest,
        callbacks?: StreamCallbacks,
        signal?: AbortSignal,
    ): Promise<GenerationResponse> {
        this.failedOnlineIds.clear();
        this.failedLocalIds.clear();

        const useOnline = this.shouldUseOnline();
        const primaryPool = useOnline ? this.strategy.onlineModels : this.strategy.localModels;
        const fallbackPool = useOnline ? this.strategy.localModels : this.strategy.onlineModels;
        const primaryFailedSet = useOnline ? this.failedOnlineIds : this.failedLocalIds;
        const fallbackFailedSet = useOnline ? this.failedLocalIds : this.failedOnlineIds;

        let accumulatedText = '';

        const wrappedCallbacks: StreamCallbacks = {
            onToken: async (stats) => {
                accumulatedText = stats.fullText;
                if (callbacks?.onToken) await callbacks.onToken(stats);
            },
            onFinish: callbacks?.onFinish,
        };

        // ─── Primary pool ───
        const primaryResult = await this.tryPool(
            primaryPool, primaryFailedSet, request, wrappedCallbacks, signal,
        );
        if (primaryResult) return primaryResult;

        // ─── Fallback pool ───
        if (this.strategy.fallbackOnLocalFailure && !signal?.aborted) {
            const fallbackResult = await this.tryPool(
                fallbackPool, fallbackFailedSet, request, wrappedCallbacks, signal,
            );
            if (fallbackResult) return fallbackResult;
        }

        // ─── Free models as last resort ───
        if (!signal?.aborted) {
            const allFailed = new Set([...this.failedOnlineIds, ...this.failedLocalIds]);
            const allModels = [...this.strategy.onlineModels, ...this.strategy.localModels];
            const freeModels = allModels.filter(m => isFreeModel(m));

            if (freeModels.length > 0) {
                const isBudgetExhausted = this.budgetData.budgetSpent >= this.strategy.maximumBudget;
                if (isBudgetExhausted) {
                    console.info('[BudgetEngine] Budget exhausted — falling back to free models.');
                } else {
                    console.info('[BudgetEngine] All paid models failed — trying free models.');
                }

                const freeResult = await this.tryPool(
                    freeModels, allFailed, request, wrappedCallbacks, signal, true,
                );
                if (freeResult) return freeResult;
            }
        }

        if (accumulatedText.trim()) {
            return { text: accumulatedText, modelUsed: this.name };
        }

        throw new Error('All models exhausted.');
    }

    // ─── Private ─────────────────────────────────────────────────────

    private async tryPool(
        pool: LanguageModelData[],
        failedSet: Set<string>,
        request: GenerationRequest,
        callbacks: StreamCallbacks,
        signal?: AbortSignal,
        isFree = false,
    ): Promise<GenerationResponse | null> {
        while (true) {
            if (signal?.aborted) return null;

            const model = this.selectFromPool(pool, failedSet);
            if (!model) return null;

            const ready = await this.ensureLoaded(model);
            if (!ready) {
                failedSet.add(model.id);
                this.recordError(model.id);
                continue;
            }

            const sessionStart = Date.now();

            try {
                // Use shared streaming logic directly instead of instantiating SingleLanguageModel
                const ctx: LanguageModelDataContext = {
                    apiKey: model.apiKey,
                    backend: model.backend,
                    modelPath: model.model,
                    runtimePort: this.portResolver.getPort(model.id),
                };

                const result = await streamFromBackend(request, ctx, callbacks, signal);
                const sessionDuration = Date.now() - sessionStart;

                this.recordSessionDuration(model.id, sessionDuration);
                if (result.msPerToken && result.msPerToken > 0) this.recordLatency(model.id, result.msPerToken);
                if (result.timeToFirstToken && result.timeToFirstToken > 0) this.recordTTFT(model.id, result.timeToFirstToken);

                if (!isFree) {
                    const pricing = buildPricing(model);
                    const cost = calculateRequestCost(
                        result.promptTokens || 0,
                        result.completionTokens || 0,
                        result.cacheMiss || false,
                        pricing,
                    );
                    this.recordSuccess(model.id, cost.totalCost);
                } else {
                    this.recordSuccess(model.id, 0);
                }

                return { ...result, modelUsed: model.name };
            } catch (e) {
                if (signal?.aborted) throw e;

                const sessionDuration = Date.now() - sessionStart;
                this.recordSessionDuration(model.id, sessionDuration);

                if (!isQuotaError(e)) {
                    this.recordError(model.id);
                    throw e;
                }

                failedSet.add(model.id);
                this.recordQuotaError(model.id);
            }
        }
    }

    private selectFromPool(pool: LanguageModelData[], failedSet: Set<string>): LanguageModelData | null {
        const candidates = pool.filter(m =>
            !failedSet.has(m.id) && !this.isInQuotaCooldown(m.id),
        );
        if (candidates.length === 0) return null;

        candidates.sort((a, b) => {
            const scoreA = this.computeCompositeQuality(a.id);
            const scoreB = this.computeCompositeQuality(b.id);
            if (Math.abs(scoreA - scoreB) > 0.0001) return scoreB - scoreA;
            return Math.random() - 0.5;
        });

        return candidates[0];
    }

    private async ensureLoaded(model: LanguageModelData): Promise<boolean> {
        if (this.portResolver.isReady(model.id)) return true;
        if (model.apiKey && model.backend) return true;
        const port = await this.portResolver.loadModel(model.id);
        return port !== null;
    }

    private shouldUseOnline(): boolean {
        if (this.strategy.onlineModels.length === 0) return false;
        if (this.strategy.localModels.length === 0) return true;
        if (this.budgetData.budgetSpent >= this.strategy.maximumBudget) return false;
        const roll = Math.random() * 100;
        return roll < this.strategy.switchProbability;
    }

    private isInQuotaCooldown(modelId: string): boolean {
        const lastHit = this.budgetData.modelLastQuotaHitTimeStamps[modelId];
        if (!lastHit) return false;
        return (Date.now() - lastHit) < 60_000;
    }

    private computeCompositeQuality(modelId: string): number {
        const speed = this.budgetData.modelAverageLatencyMsPerToken?.[modelId] ?? Number.POSITIVE_INFINITY;
        const ttft = this.budgetData.modelAverageTimeToFirstToken?.[modelId] ?? Number.POSITIVE_INFINITY;
        const totalDuration = this.budgetData.modelTotalSessionDuration?.[modelId] ?? 0;
        const usedCount = this.budgetData.modelUsedCount?.[modelId] ?? 0;
        const quotaHits = this.budgetData.modelQuotaHitCount?.[modelId] ?? 0;
        const errorHits = this.budgetData.modelErrorHitCount?.[modelId] ?? 0;

        const speedFactor = Number.isFinite(speed) && speed > 0 ? 1 / speed : 0;
        const ttftFactor = Number.isFinite(ttft) && ttft > 0 ? 1 / ttft : 0;
        const avgSessionSeconds = usedCount > 0 ? (totalDuration / usedCount) / 1000 : 0;
        const reliabilityFactor = usedCount > 0 ? (usedCount - quotaHits - errorHits) / usedCount : 0;

        return speedFactor * ttftFactor * avgSessionSeconds * reliabilityFactor;
    }

    private applyResetIfDue(): void {
        if (this.budgetData.resetDuration <= 0) return;
        if (Date.now() - this.budgetData.lastResetTimestamp < this.budgetData.resetDuration) return;
        this.budgetData.budgetSpent = 0;
        this.budgetData.modelLastQuotaHitTimeStamps = {};
        this.budgetData.modelLastErrorHitTimeStamps = {};
        this.budgetData.lastResetTimestamp = Date.now();
    }

    private recordSuccess(modelId: string, cost: number): void {
        this.budgetData.budgetSpent += cost;
        this.budgetData.modelLastUsedTimestamps[modelId] = Date.now();
        this.budgetData.modelUsedCount[modelId] = (this.budgetData.modelUsedCount?.[modelId] ?? 0) + 1;
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    private recordQuotaError(modelId: string): void {
        this.budgetData.modelLastQuotaHitTimeStamps[modelId] = Date.now();
        this.budgetData.modelQuotaHitCount[modelId] = (this.budgetData.modelQuotaHitCount?.[modelId] ?? 0) + 1;
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    private recordError(modelId: string): void {
        this.budgetData.modelLastErrorHitTimeStamps[modelId] = Date.now();
        this.budgetData.modelErrorHitCount[modelId] = (this.budgetData.modelErrorHitCount?.[modelId] ?? 0) + 1;
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    private recordLatency(modelId: string, observedMsPerToken: number): void {
        if (!this.budgetData.modelAverageLatencyMsPerToken) this.budgetData.modelAverageLatencyMsPerToken = {};
        const alpha = this.budgetData.averageLatencyMsPerTokenExponentialMovingAverageSmoothing ?? 0.3;
        const previous = this.budgetData.modelAverageLatencyMsPerToken[modelId];
        this.budgetData.modelAverageLatencyMsPerToken[modelId] = previous === undefined
            ? observedMsPerToken
            : (alpha * observedMsPerToken) + ((1 - alpha) * previous);
    }

    private recordTTFT(modelId: string, observedMs: number): void {
        if (!this.budgetData.modelAverageTimeToFirstToken) this.budgetData.modelAverageTimeToFirstToken = {};
        const alpha = this.budgetData.averageTimeToFirstTokenExponentialMovingAverageSmoothing ?? 0.3;
        const previous = this.budgetData.modelAverageTimeToFirstToken[modelId];
        this.budgetData.modelAverageTimeToFirstToken[modelId] = previous === undefined
            ? observedMs
            : (alpha * observedMs) + ((1 - alpha) * previous);
    }

    private recordSessionDuration(modelId: string, durationMs: number): void {
        if (!this.budgetData.modelTotalSessionDuration) this.budgetData.modelTotalSessionDuration = {};
        this.budgetData.modelTotalSessionDuration[modelId] =
            (this.budgetData.modelTotalSessionDuration[modelId] ?? 0) + durationMs;
    }
}