// src/services/BudgetStrategyEngine.ts
import type { BudgetStrategy, BudgetData, LanguageModel } from '../types';
import { getLanguageModelEngine, type StreamCallbacks, type StreamResult } from './LanguageModelEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';

// ─── Types ───────────────────────────────────────────────────────────

export interface RunningModelState {
    isRunning: boolean;
    port?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

function buildPricing(model: LanguageModel): ModelPricing {
    return {
        cacheHitPerMillion: model.cacheHitCostPerOneMillionOfTokens ?? 0,
        cacheMissPerMillion: model.cacheMissCostPerOneMillionOfTokens ?? 0,
        outputPerMillion: model.outputGenerationCostPerOneMillionOfTokens ?? 0,
    };
}

function isQuotaError(e: unknown): boolean {
    const obj = e as Record<string, unknown>;
    const status = obj?.status ?? obj?.statusCode;
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

function isInputFilterError(e: unknown): boolean {
    const obj = e as Record<string, unknown>;
    const status = obj?.status ?? obj?.statusCode;
    const message = ((e as Error)?.message || '').toLowerCase();

    if (status === 400) return true;
    if (message.includes('api error: 400')) return true;

    return message.includes('prompt is too long') ||
           message.includes('content policy') ||
           message.includes('safety') ||
           message.includes('filter') ||
           message.includes('blocked') ||
           message.includes('violates') ||
           message.includes('invalid prompt') ||
           message.includes('prompt blocked') ||
           message.includes('input filtered') ||
           message.includes('prompt was filtered') ||
           message.includes('flagged') ||
           message.includes('prohibited');
}

function isCensorshipRefusal(text: string): boolean {
    if (!text || text.length === 0) return false;

    const lower = text.toLowerCase();
    const refusalPatterns = [
        /^i can'?t (help|assist|provide|generate|create|write|produce|fulfill)/,
        /^i'?m (unable|not able|sorry)/,
        /^as an? (ai|language model|assistant)/,
        /i (must|have to|need to) decline/,
        /that (request|prompt|content) (violates|goes against|is against)/,
        /i (cannot|won'?t|will not) (generate|create|produce|write|provide)/,
        /(policy|guidelines?|terms of service|content policy)/,
        /inappropriate|unsafe|harmful|illegal|explicit/,
        /^sorry[,.]/,
        /refuse|refused|refusing/,
    ];

    for (const pattern of refusalPatterns) {
        if (pattern.test(lower)) return true;
    }

    return false;
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
}

function isFreeModel(model: LanguageModel): boolean {
    const pricing = buildPricing(model);
    return pricing.cacheHitPerMillion <= 0 &&
           pricing.cacheMissPerMillion <= 0 &&
           pricing.outputPerMillion <= 0;
}

// ─── Engine ──────────────────────────────────────────────────────────

export class BudgetStrategyEngine {
    private strategy: BudgetStrategy;
    private budgetData: BudgetData;
    private runningModels: Record<string, RunningModelState>;
    private loadLocalModel: ((id: string) => Promise<number | null>) | null;
    private engine = getLanguageModelEngine();
    private _lastSelectedModelId: string | null = null;
    private _lastCacheMiss = false;

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

        if (!this.budgetData.modelCensorshipHitCount) this.budgetData.modelCensorshipHitCount = {};
        if (!this.budgetData.modelBrokenCount) this.budgetData.modelBrokenCount = {};

        applyResetIfDue(this.budgetData);
    }

    setStrategy(strategy: BudgetStrategy): void { this.strategy = strategy; }

    setBudgetData(budgetData: BudgetData): void {
        this.budgetData = budgetData;
        if (!this.budgetData.modelCensorshipHitCount) this.budgetData.modelCensorshipHitCount = {};
        if (!this.budgetData.modelBrokenCount) this.budgetData.modelBrokenCount = {};
        applyResetIfDue(this.budgetData);
    }

    setRunningModels(runningModels: Record<string, RunningModelState>): void {
        this.runningModels = runningModels;
        this.engine.setRunningModels(runningModels);
    }

    setLoadLocalModel(loadLocalModel: (id: string) => Promise<number | null>): void { this.loadLocalModel = loadLocalModel; }
    getBudgetData(): BudgetData { return this.budgetData; }
    getLastSelectedModelId(): string | null { return this._lastSelectedModelId; }
    getLastCacheMiss(): boolean { return this._lastCacheMiss; }

    /**
     * Get all models from the unified list (online + local combined).
     */
    private getAllModels(): LanguageModel[] {
        return [...this.strategy.onlineModels, ...this.strategy.localModels];
    }

    /**
     * Determine which models are currently active based on per-model
     * activation/deactivation context size windows.
     * A model is active when:
     *   - currentTokens >= modelActivationContextSize[id] (or activation is 0/undefined = always active)
     *   - AND (modelDeactivationContextSize[id] is undefined/Infinity OR currentTokens < deactivation)
     */
    private getActiveModels(currentTokens: number): LanguageModel[] {
        const allModels = this.getAllModels();
        return allModels.filter(model => {
            const activationThreshold = this.strategy.modelActivationContextSize?.[model.id] ?? 0;
            const deactivationThreshold = this.strategy.modelDeactivationContextSize?.[model.id];

            // Below activation threshold → not yet eligible
            if (currentTokens < activationThreshold) return false;

            // Above deactivation threshold → no longer eligible
            if (deactivationThreshold !== undefined && currentTokens >= deactivationThreshold) return false;

            return true;
        });
    }

    async selectModelForRequest(requestBody: Record<string, unknown>): Promise<{ model: LanguageModel; modelId: string } | null> {
        const failedIds = new Set<string>();

        const promptText = (requestBody.prompt as string) || '';
        const requiredContextTokens = promptText.length > 0 ? await this.engine.countTokens(promptText) : 0;

        const candidates = this.getEligibleCandidates(requiredContextTokens, failedIds);
        if (candidates.length === 0) {
            // All tiered models exhausted or out of budget — try free models
            const freeModel = this.selectFreeModel(failedIds, requiredContextTokens);
            if (freeModel) {
                const loaded = await this.ensureModelLoaded(freeModel);
                if (loaded) {
                    this.engine.setContext(freeModel);
                    this._lastSelectedModelId = freeModel.id;
                    return { model: freeModel, modelId: freeModel.id };
                }
            }
            return null;
        }

        // Pick best candidate by composite quality score
        const best = this.rankCandidates(candidates, requiredContextTokens)[0];
        if (!best) return null;

        const loaded = await this.ensureModelLoaded(best);
        if (!loaded) return null;

        this.engine.setContext(best);
        this._lastSelectedModelId = best.id;
        return { model: best, modelId: best.id };
    }

    /**
     * Get eligible model candidates considering:
     * - Activation/deactivation context windows
     * - Budget constraints (skip paid models if budget exceeded)
     * - Failed model exclusions
     */
    private getEligibleCandidates(currentTokens: number, failedIds: Set<string>): LanguageModel[] {
        const activeModels = this.getActiveModels(currentTokens);
        const budgetExceeded = this.budgetData.budgetSpent >= this.strategy.maximumBudget;

        return activeModels.filter(model => {
            if (failedIds.has(model.id)) return false;
            // If budget exceeded, only allow free models through
            if (budgetExceeded && !isFreeModel(model)) return false;
            return true;
        });
    }

    /**
     * Rank candidates using the four-tier system and observed performance metrics.
     * Primary sort: quality tier (higher = better quality, prefer first).
     * Secondary sort: cost tier (lower = cheaper, prefer when same quality).
     * Tertiary: observed composite quality from latency, TTFT, reliability.
     * Quaternary: context fit factor.
     */
    private rankCandidates(candidates: LanguageModel[], requiredContextTokens: number): LanguageModel[] {
        const sorted = [...candidates];
        sorted.sort((a, b) => {
            // Primary: Quality tier (higher = better quality, prefer first)
            const qualityA = this.strategy.modelQualityTiers?.[a.id] ?? 0;
            const qualityB = this.strategy.modelQualityTiers?.[b.id] ?? 0;
            if (qualityA !== qualityB) return qualityB - qualityA;

            // Secondary: Cost tier (lower = cheaper, prefer when same quality)
            const costA = this.strategy.modelCostTiers?.[a.id] ?? 0;
            const costB = this.strategy.modelCostTiers?.[b.id] ?? 0;
            if (costA !== costB) return costA - costB;

            // Tertiary: Observed composite quality
            const scoreA = this.computeCompositeQuality(a, requiredContextTokens);
            const scoreB = this.computeCompositeQuality(b, requiredContextTokens);
            if (Math.abs(scoreA - scoreB) > 0.0001) return scoreB - scoreA;

            // Quaternary: Context fit
            const fitA = this.getContextFitFactor(a, requiredContextTokens);
            const fitB = this.getContextFitFactor(b, requiredContextTokens);
            if (Math.abs(fitA - fitB) > 0.01) return fitB - fitA;

            return Math.random() - 0.5;
        });
        return sorted;
    }

    async generateStream(
        requestBody: Record<string, unknown>,
        abortController: AbortController,
        callbacks?: StreamCallbacks,
    ): Promise<StreamResult> {
        this._lastCacheMiss = false;

        const failedIds = new Set<string>();

        const promptText = (requestBody.prompt as string) || '';
        const requiredContextTokens = promptText.length > 0 ? await this.engine.countTokens(promptText) : 0;

        let accumulatedPartialText = '';

        const wrappedCallbacks: StreamCallbacks = {
            onToken: async (stats) => {
                accumulatedPartialText = stats.fullText;
                if (callbacks?.onToken) await callbacks.onToken(stats);
            },
            onFinish: (rs) => {
                this._lastCacheMiss = rs.cacheMiss ?? false;
                if (callbacks?.onFinish) callbacks.onFinish(rs);
            },
        };

        // ─── Main retry loop across all eligible models ───
        while (!abortController.signal.aborted) {
            const candidates = this.getEligibleCandidates(requiredContextTokens, failedIds);
            const ranked = this.rankCandidates(candidates, requiredContextTokens);

            if (ranked.length === 0) {
                // Try free models as last resort
                const freeModel = this.selectFreeModel(failedIds, requiredContextTokens);
                if (!freeModel) break;
                ranked.push(freeModel);
            }

            const selectedModel = ranked[0];

            // Inner loop for injection retries on the same model
            while (true) {
                const loaded = await this.ensureModelLoaded(selectedModel);
                if (!loaded) {
                    failedIds.add(selectedModel.id);
                    this.recordError(selectedModel.id);
                    console.warn(`Model ${selectedModel.name} could not be loaded, skipping.`);
                    break;
                }

                this.engine.setContext(selectedModel);
                this._lastSelectedModelId = selectedModel.id;
                const pricing = buildPricing(selectedModel);
                const sessionStart = Date.now();

                try {
                    let result: StreamResult;

                    try {
                        result = await this.engine.generateStream(requestBody, abortController, wrappedCallbacks);
                    } catch (e) {
                        if (abortController.signal.aborted) throw e;

                        if (isInputFilterError(e) && Array.isArray(requestBody._injectionStrings) && requestBody._injectionStrings.length > 0 && typeof requestBody._basePrompt === 'string') {
                            const nextInjection = requestBody._injectionStrings.shift();
                            requestBody.prompt = nextInjection + requestBody._basePrompt;
                            console.warn(`Model ${selectedModel.name} hit input filter. Retrying with randomized injection (${requestBody._injectionStrings.length} retries left).`);
                            continue;
                        }

                        throw e;
                    }

                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

                    if (result.msPerToken && result.msPerToken > 0) this.recordLatency(selectedModel.id, result.msPerToken);
                    if (result.timeToFirstToken && result.timeToFirstToken > 0) this.recordTTFT(selectedModel.id, result.timeToFirstToken);

                    const promptTokens = requiredContextTokens || await this.engine.countTokens(promptText);
                    const completionTokens = await this.engine.countTokens(result.text);
                    const cost = calculateRequestCost(promptTokens, completionTokens, this._lastCacheMiss, pricing);
                    this.recordSuccess(selectedModel.id, cost.totalCost);

                    const fullOutput = accumulatedPartialText + result.text;

                    if (!fullOutput) {
                        this.recordBroken(selectedModel.id);
                        failedIds.add(selectedModel.id);
                        console.warn(`Model ${selectedModel.name} returned empty/broken response, rotating.`);
                        break;
                    }

                    if (isCensorshipRefusal(result.text)) {
                        this.recordCensorship(selectedModel.id);
                        console.warn(`Model ${selectedModel.name} returned censorship refusal — returning text as-is.`);
                    }

                    return { text: fullOutput, isCompleted: result.isCompleted };
                } catch (e) {
                    if (abortController.signal.aborted) throw e;

                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

                    if (!isQuotaError(e)) {
                        this.recordError(selectedModel.id);
                        throw e;
                    }

                    failedIds.add(selectedModel.id);
                    this.recordQuotaError(selectedModel.id);
                    console.warn(`Model ${selectedModel.name} hit quota/rate limit after partial output (${accumulatedPartialText.length} chars), rotating.`);
                    break;
                }
            }
        }

        if (accumulatedPartialText) return { text: accumulatedPartialText, isCompleted: false };

        console.warn('[BudgetEngine] All models exhausted. Returning empty response.');
        return { text: "", isCompleted: false };
    }

    async generateCompletion(
        requestBody: Record<string, unknown>,
        abortSignal?: AbortSignal,
    ): Promise<{ text: string; modelId: string }> {
        const failedIds = new Set<string>();

        const promptText = (requestBody.prompt as string) || '';
        const requiredContextTokens = promptText.length > 0 ? await this.engine.countTokens(promptText) : 0;

        while (!abortSignal?.aborted) {
            const candidates = this.getEligibleCandidates(requiredContextTokens, failedIds);
            const ranked = this.rankCandidates(candidates, requiredContextTokens);

            if (ranked.length === 0) {
                const freeModel = this.selectFreeModel(failedIds, requiredContextTokens);
                if (!freeModel) break;
                ranked.push(freeModel);
            }

            const selectedModel = ranked[0];

            while (true) {
                const loaded = await this.ensureModelLoaded(selectedModel);
                if (!loaded) {
                    failedIds.add(selectedModel.id);
                    this.recordError(selectedModel.id);
                    break;
                }

                this.engine.setContext(selectedModel);
                this._lastSelectedModelId = selectedModel.id;
                const pricing = buildPricing(selectedModel);
                const sessionStart = Date.now();

                try {
                    const result = await this.engine.generateCompletion(requestBody);
                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

                    const promptTokens = requiredContextTokens || await this.engine.countTokens(promptText);
                    const completionTokens = await this.engine.countTokens(result.text);
                    const cost = calculateRequestCost(promptTokens, completionTokens, false, pricing);
                    this.recordSuccess(selectedModel.id, cost.totalCost);

                    if (!result.text) {
                        this.recordBroken(selectedModel.id);
                        failedIds.add(selectedModel.id);
                        console.warn(`Completion model ${selectedModel.name} returned empty/broken response, rotating.`);
                        break;
                    }

                    if (isCensorshipRefusal(result.text)) {
                        this.recordCensorship(selectedModel.id);
                        console.warn(`Completion model ${selectedModel.name} returned censorship refusal — returning text as-is.`);
                    }

                    return { text: result.text, modelId: selectedModel.id };
                } catch (e) {
                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

                    if (isInputFilterError(e) && Array.isArray(requestBody._injectionStrings) && requestBody._injectionStrings.length > 0 && typeof requestBody._basePrompt === 'string') {
                        const nextInjection = requestBody._injectionStrings.shift();
                        requestBody.prompt = nextInjection + requestBody._basePrompt;
                        console.warn(`Completion model ${selectedModel.name} hit input filter. Retrying with randomized injection (${requestBody._injectionStrings.length} retries left).`);
                        continue;
                    }

                    if (!isQuotaError(e)) {
                        this.recordError(selectedModel.id);
                        throw e;
                    }

                    failedIds.add(selectedModel.id);
                    this.recordQuotaError(selectedModel.id);
                    break;
                }
            }
        }

        console.warn('[BudgetEngine] All models exhausted for completion. Returning empty result.');
        return { text: '', modelId: '' };
    }

    // ─── Observed Performance Metrics ────────────────────────────────

    private getModelSpeed(modelId: string): number { return this.budgetData.modelAverageLatencyMsPerToken?.[modelId] ?? Number.POSITIVE_INFINITY; }
    private getModelTTFT(modelId: string): number { return this.budgetData.modelAverageTimeToFirstToken?.[modelId] ?? Number.POSITIVE_INFINITY; }
    private getModelQualityScore(modelId: string): number { return this.budgetData.modelTotalSessionDuration?.[modelId] ?? 0; }

    private getContextFitFactor(model: LanguageModel, requiredContextTokens?: number): number {
        if (!requiredContextTokens || requiredContextTokens <= 0) return 1;
        const contextLength = model.contextLength ?? 0;
        if (!contextLength || contextLength <= 0) return 1;
        if (contextLength >= requiredContextTokens) return 1;
        return Math.max(0.05, contextLength / requiredContextTokens);
    }

    private computeCompositeQuality(model: LanguageModel, requiredContextTokens?: number): number {
        const modelId = model.id;
        const speed = this.getModelSpeed(modelId);
        const ttft = this.getModelTTFT(modelId);
        const totalDuration = this.getModelQualityScore(modelId);
        const usedCount = this.budgetData.modelUsedCount?.[modelId] ?? 0;
        const quotaHits = this.budgetData.modelQuotaHitCount?.[modelId] ?? 0;
        const errorHits = this.budgetData.modelErrorHitCount?.[modelId] ?? 0;
        const censorshipHits = this.budgetData.modelCensorshipHitCount?.[modelId] ?? 0;
        const brokenHits = this.budgetData.modelBrokenCount?.[modelId] ?? 0;

        const speedFactor = Number.isFinite(speed) && speed > 0 ? 1 / speed : 1;
        const ttftFactor = Number.isFinite(ttft) && ttft > 0 ? 1 / ttft : 1;
        const avgSessionSeconds = usedCount > 0 ? Math.max(0.1, (totalDuration / usedCount) / 1000) : 1;

        const totalFailures = quotaHits + errorHits + censorshipHits + brokenHits;
        const reliabilityFactor = usedCount > 0 ? Math.max(0.05, (usedCount - totalFailures) / usedCount) : 1;
        const contextFitFactor = this.getContextFitFactor(model, requiredContextTokens);

        return speedFactor * ttftFactor * avgSessionSeconds * reliabilityFactor * contextFitFactor;
    }

    private selectFreeModel(failedIds: Set<string>, requiredContextTokens?: number): LanguageModel | null {
        const allModels = this.getAllModels();
        const freeModels = allModels.filter(m => isFreeModel(m) && !failedIds.has(m.id));
        if (freeModels.length === 0) return null;

        // Rank free models by composite quality
        const ranked = [...freeModels].sort((a, b) => {
            const scoreA = this.computeCompositeQuality(a, requiredContextTokens);
            const scoreB = this.computeCompositeQuality(b, requiredContextTokens);
            if (Math.abs(scoreA - scoreB) > 0.0001) return scoreB - scoreA;
            return Math.random() - 0.5;
        });

        return ranked[0] ?? null;
    }

    // ─── Recording ───────────────────────────────────────────────────

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

    private recordCensorship(modelId: string): void {
        if (!this.budgetData.modelCensorshipHitCount) this.budgetData.modelCensorshipHitCount = {};
        this.budgetData.modelCensorshipHitCount[modelId] = (this.budgetData.modelCensorshipHitCount[modelId] ?? 0) + 1;
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    private recordBroken(modelId: string): void {
        if (!this.budgetData.modelBrokenCount) this.budgetData.modelBrokenCount = {};
        this.budgetData.modelBrokenCount[modelId] = (this.budgetData.modelBrokenCount[modelId] ?? 0) + 1;
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    private recordLatency(modelId: string, observedMsPerToken: number): void {
        if (!this.budgetData.modelAverageLatencyMsPerToken) this.budgetData.modelAverageLatencyMsPerToken = {};
        const alpha = this.budgetData.averageLatencyMsPerTokenExponentialMovingAverageSmoothing ?? 0.3;
        const previous = this.budgetData.modelAverageLatencyMsPerToken[modelId];
        if (previous === undefined) this.budgetData.modelAverageLatencyMsPerToken[modelId] = observedMsPerToken;
        else this.budgetData.modelAverageLatencyMsPerToken[modelId] = (alpha * observedMsPerToken) + ((1 - alpha) * previous);
    }

    private recordTTFT(modelId: string, observedMs: number): void {
        if (!this.budgetData.modelAverageTimeToFirstToken) this.budgetData.modelAverageTimeToFirstToken = {};
        const alpha = this.budgetData.averageTimeToFirstTokenExponentialMovingAverageSmoothing ?? 0.3;
        const previous = this.budgetData.modelAverageTimeToFirstToken[modelId];
        if (previous === undefined) this.budgetData.modelAverageTimeToFirstToken[modelId] = observedMs;
        else this.budgetData.modelAverageTimeToFirstToken[modelId] = (alpha * observedMs) + ((1 - alpha) * previous);
    }

    private recordSessionDuration(modelId: string, durationMs: number): void {
        if (!this.budgetData.modelTotalSessionDuration) this.budgetData.modelTotalSessionDuration = {};
        this.budgetData.modelTotalSessionDuration[modelId] = (this.budgetData.modelTotalSessionDuration[modelId] ?? 0) + durationMs;
    }

    // ─── Model Loading ───────────────────────────────────────────────

    private isModelReady(model: LanguageModel): boolean {
        const isCloud = !!model.apiKey && !!model.backend;
        if (isCloud) return true;
        const running = this.runningModels[model.id];
        return !!(running?.port || (model.parameters as Record<string, unknown>)?._runtimePort);
    }

    private async ensureModelLoaded(model: LanguageModel): Promise<boolean> {
        if (this.isModelReady(model)) return true;
        const isCloud = !!model.apiKey && !!model.backend;
        if (isCloud) return true;
        if (!this.loadLocalModel) return false;
        try {
            const port = await this.loadLocalModel(model.id);
            if (port) {
                this.runningModels = { ...this.runningModels, [model.id]: { isRunning: true, port } };
                this.engine.setRunningModels(this.runningModels);
                return true;
            }
        } catch (e) { console.warn(`Failed to auto-load model ${model.name}:`, e); }
        return false;
    }
}

let instance: BudgetStrategyEngine | null = null;

export function getBudgetStrategyEngine(): BudgetStrategyEngine {
    if (!instance) throw new Error('BudgetStrategyEngine not initialized. Call initializeBudgetStrategyEngine() first.');
    return instance;
}

export function initializeBudgetStrategyEngine(
    strategy: BudgetStrategy,
    budgetData: BudgetData,
    runningModels: Record<string, RunningModelState>,
    loadLocalModel?: (id: string) => Promise<number | null>,
): BudgetStrategyEngine {
    instance = new BudgetStrategyEngine(strategy, budgetData, runningModels, loadLocalModel);
    return instance;
}

export function reset(): void { instance = null; }