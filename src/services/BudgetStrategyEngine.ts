// src/services/BudgetStrategyEngine.ts
import type { BudgetStrategy, BudgetData, Character, InteractionData, LanguageModel } from '../types';
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

    private isInQuotaCooldown(modelId: string): boolean {
        const lastQuotaHit = this.budgetData.modelLastQuotaHitTimeStamps[modelId];
        if (!lastQuotaHit) return false;
        return (Date.now() - lastQuotaHit) < 60_000;
    }

    private getModelSpeed(modelId: string): number {
        return this.budgetData.modelAverageGenerationSpeedMsPerToken?.[modelId] ?? Number.POSITIVE_INFINITY;
    }

    private getModelTTFT(modelId: string): number {
        return this.budgetData.modelAverageTimeToFirstToken?.[modelId] ?? Number.POSITIVE_INFINITY;
    }

    private getModelQualityScore(modelId: string): number {
        return this.budgetData.modelTotalSessionDuration?.[modelId] ?? 0;
    }

    private isBelowQualityThreshold(modelId: string): boolean {
        const threshold = this.strategy.fallbackOnQualityThreshold;
        if (!threshold || threshold <= 0) return false;

        const usedCount = this.budgetData.modelUsedCount?.[modelId] ?? 0;
        if (usedCount < 3) return false;

        const totalDuration = this.budgetData.modelTotalSessionDuration?.[modelId] ?? 0;
        const avgDurationSeconds = (totalDuration / usedCount) / 1000;

        return avgDurationSeconds < threshold;
    }

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

    private recordSessionDuration(modelId: string, durationMs: number): void {
        if (!this.budgetData.modelTotalSessionDuration) {
            this.budgetData.modelTotalSessionDuration = {};
        }
        this.budgetData.modelTotalSessionDuration[modelId] =
            (this.budgetData.modelTotalSessionDuration[modelId] ?? 0) + durationMs;
    }

    private buildModelContext(model: LanguageModel): LanguageModelContext {
        const isCloud = !!model.apiKey && model.backend;
        const running = this.runningModels[model.id];
        const runtimePort = isCloud ? undefined : (running?.port || (model.parameters as Record<string, unknown>)?._runtimePort as number | undefined);

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
        return !!(running?.port || (model.parameters as Record<string, unknown>)?._runtimePort);
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
     * Creates a timeout abort controller linked to the parent signal.
     * If fallbackOnTimeoutInSeconds > 0, aborts after that many seconds.
     * Caller MUST call cleanup() when done to prevent leaks.
     */
    private createTimeoutController(parentSignal: AbortSignal): { controller: AbortController; cleanup: () => void } {
        const timeoutSeconds = this.strategy.fallbackOnTimeoutInSeconds;
        const controller = new AbortController();

        const onParentAbort = () => controller.abort();
        parentSignal.addEventListener('abort', onParentAbort);

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (timeoutSeconds > 0) {
            timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
        }

        return {
            controller,
            cleanup: () => {
                if (timeoutId !== undefined) clearTimeout(timeoutId);
                parentSignal.removeEventListener('abort', onParentAbort);
            },
        };
    }

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
            const tier = this.getTier(model);
            if (maxTier !== undefined && tier > maxTier) continue;
            if (!tierGroups.has(tier)) tierGroups.set(tier, []);
            const tierModels = tierGroups.get(tier);
            if (tierModels) tierModels.push(model);
        }

        if (tierGroups.size === 0) return null;

        const sortedTiers = [...tierGroups.keys()].sort((a, b) => b - a);

        for (const tier of sortedTiers) {
            const candidates = tierGroups.get(tier);
            if (!candidates) continue;
            candidates.sort((a, b) => {
                // 1. Quality threshold gate
                const aBelowThreshold = this.isBelowQualityThreshold(a.id) ? 1 : 0;
                const bBelowThreshold = this.isBelowQualityThreshold(b.id) ? 1 : 0;
                if (aBelowThreshold !== bBelowThreshold) return aBelowThreshold - bBelowThreshold;

                // 2. Quality score (higher total session duration = preferred)
                const aQuality = this.getModelQualityScore(a.id);
                const bQuality = this.getModelQualityScore(b.id);
                if (aQuality !== bQuality) return bQuality - aQuality;

                // 3. Generation speed (lower ms/token = faster = preferred)
                const aSpeed = this.getModelSpeed(a.id);
                const bSpeed = this.getModelSpeed(b.id);
                if (aSpeed !== bSpeed) return aSpeed - bSpeed;

                // 4. TTFT (lower = snappier = preferred)
                const aTTFT = this.getModelTTFT(a.id);
                const bTTFT = this.getModelTTFT(b.id);
                if (aTTFT !== bTTFT) return aTTFT - bTTFT;

                // 5. Reliability (lower error rate = more stable = preferred)
                const aUsed = this.budgetData.modelUsedCount?.[a.id] ?? 0;
                const bUsed = this.budgetData.modelUsedCount?.[b.id] ?? 0;
                const aErrors = (this.budgetData.modelQuotaHitCount?.[a.id] ?? 0) + (this.budgetData.modelErrorHitCount?.[a.id] ?? 0);
                const bErrors = (this.budgetData.modelQuotaHitCount?.[b.id] ?? 0) + (this.budgetData.modelErrorHitCount?.[b.id] ?? 0);
                const aReliability = aUsed > 0 ? aErrors / aUsed : 0;
                const bReliability = bUsed > 0 ? bErrors / bUsed : 0;
                if (aReliability !== bReliability) return aReliability - bReliability;

                // 6. Recency (more recently used = warmer cache = preferred)
                const aLastUsed = this.budgetData.modelLastUsedTimestamps?.[a.id] ?? 0;
                const bLastUsed = this.budgetData.modelLastUsedTimestamps?.[b.id] ?? 0;
                if (aLastUsed !== bLastUsed) return bLastUsed - aLastUsed;

                // 7. Base tier as final tiebreaker
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
            const sessionStart = Date.now();

            try {
                const { body } = await prepareRequestBody(interactionData, character, accumulatedPartialText, userImagesBase64, runtimePort);

                // Wrap with timeout controller
                const { controller: timeoutCtrl, cleanup: cleanupTimeout } = this.createTimeoutController(abortController.signal);
                let result;
                try {
                    result = await engine.generateStream(
                        body,
                        timeoutCtrl,
                        wrappedCallbacks,
                        primaryCtx,
                    );
                } catch (e) {
                    cleanupTimeout();
                    // Check if it was our timeout (not the parent abort)
                    if (timeoutCtrl.signal.aborted && !abortController.signal.aborted) {
                        const sessionDuration = Date.now() - sessionStart;
                        this.recordSessionDuration(selectedModel.id, sessionDuration);
                        primaryFailedSet.add(selectedModel.id);
                        this.recordError(selectedModel.id);
                        console.warn(`Model ${selectedModel.name} timed out after ${this.strategy.fallbackOnTimeoutInSeconds}s, rotating.`);
                        continue;
                    }
                    throw e;
                } finally {
                    cleanupTimeout();
                }

                // Record session duration
                const sessionDuration = Date.now() - sessionStart;
                this.recordSessionDuration(selectedModel.id, sessionDuration);

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

                const sessionDuration = Date.now() - sessionStart;
                this.recordSessionDuration(selectedModel.id, sessionDuration);

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
                const sessionStart = Date.now();

                try {
                    const { body: fallbackBody } = await prepareRequestBody(interactionData, character, accumulatedPartialText, userImagesBase64, fallbackPort);

                    // Wrap with timeout controller
                    const { controller: timeoutCtrl, cleanup: cleanupTimeout } = this.createTimeoutController(abortController.signal);
                    let result;
                    try {
                        result = await engine.generateStream(
                            fallbackBody,
                            timeoutCtrl,
                            wrappedCallbacks,
                            fallbackCtx,
                        );
                    } catch (e) {
                        cleanupTimeout();
                        if (timeoutCtrl.signal.aborted && !abortController.signal.aborted) {
                            const sessionDuration = Date.now() - sessionStart;
                            this.recordSessionDuration(selectedModel.id, sessionDuration);
                            fallbackFailedSet.add(selectedModel.id);
                            this.recordError(selectedModel.id);
                            console.warn(`Fallback model ${selectedModel.name} timed out after ${this.strategy.fallbackOnTimeoutInSeconds}s, rotating.`);
                            continue;
                        }
                        throw e;
                    } finally {
                        cleanupTimeout();
                    }

                    // Record session duration
                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

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

                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

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