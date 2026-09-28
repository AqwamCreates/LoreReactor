// src/services/BudgetStrategyEngine.ts
import type { BudgetStrategy, BudgetData, LanguageModel } from '../types';
import { getLanguageModelEngine, type StreamCallbacks, type StreamResult } from './LanguageModelEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { FactorizationMachine, type SparseVector } from '../libraries/factorizationMachine';
import { FeatureExtractor } from './FeatureExtractor';
import {
    loadRawFactorizationMachine,
    saveRawFactorizationMachine,
} from '../storages/serverStorage';

// ─── Types ───────────────────────────────────────────────────────────

export interface RunningModelState {
    isRunning: boolean;
    port?: number;
}

/** Per-request metadata fed to the FM for feature extraction */
export interface RequestMetadata {
    numberOfImages?: number;
    numberOfMessages?: number;
    numberOfRequestsDuringTheLastHour?: number;
}

/** Outcome of a single model request, used for online FM training */
export interface RequestOutcome {
    modelId: string;
    prompt: string;
    metadata: RequestMetadata;
    success: boolean;
    accepted: boolean;
    censored: boolean;
    rateLimited: boolean;
    broken: boolean;
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
        message.includes('429') || message.includes('api error');
}

function isNetworkError(e: unknown): boolean {
    const message = ((e as Error)?.message || '').toLowerCase();

    return message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('err_aborted') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('etimedout') ||
        message.includes('socket hang up') ||
        message.includes('abort') ||
        message.includes('timeout') ||
        message.includes('502') ||
        message.includes('504') ||
        message.includes('service unavailable');
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

// ─── Sliding Window Rate Limiter ─────────────────────────────────────

/** Cooldown duration after a 429 before retrying a model */
const RATE_LIMIT_COOLDOWN_MS = 30_000;

/** Window size for counting recent requests per model */
const SLIDING_WINDOW_MS = 60_000;

/** Maximum requests per model within the sliding window before soft-throttling */
const MAX_REQUESTS_PER_WINDOW = 30;

interface RateLimitState {
    /** Timestamps of recent requests (pruned to window) */
    requestTimestamps: number[];
    /** Timestamp of last 429 received; model is on cooldown until + RATE_LIMIT_COOLDOWN_MS */
    lastRateLimitTimestamp: number;
}

// ─── Engine ──────────────────────────────────────────────────────────

/** Number of uses at which quality score confidence saturates to 1.0 */
const QUALITY_CONFIDENCE_THRESHOLD = 20;

/** Weight of the FM signal in the final rank score (0 = pure tier, 1 = pure FM) */
const FM_BLEND_WEIGHT = 0.4;

/** Minimum total samples before FM signal is trusted (below this, falls back to aggregate) */
const FM_MIN_SAMPLES_FOR_CONFIDENCE = 5;

export class BudgetStrategyEngine {
    private strategy: BudgetStrategy;
    private budgetData: BudgetData;
    private runningModels: Record<string, RunningModelState>;
    private loadLocalModel: ((id: string) => Promise<number | null>) | null;
    private allModelsById: Map<string, LanguageModel>;
    private engine = getLanguageModelEngine();
    private _lastSelectedModelId: string | null = null;

    // ── Factorization Machines (online-learned, per-outcome) ──
    private censorshipFM: FactorizationMachine;
    private acceptanceFM: FactorizationMachine;
    private featureExtractor: FeatureExtractor;
    private factorizationMachineSampleCounter = 0;

    /** Promise that resolves once FMs have been loaded from server storage */
    private factorizationMachineLoadPromise: Promise<void> | null = null;

    /** Debounce save so we don't hammer the server on every sample */
    private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly SAVE_DEBOUNCE_MS = 5000;

    // ── Sliding Window Rate Limiting (replaces rateLimitFM) ──
    private rateLimitStates: Map<string, RateLimitState> = new Map();

    constructor(
        strategy: BudgetStrategy,
        budgetData: BudgetData,
        runningModels: Record<string, RunningModelState>,
        allModels: LanguageModel[],
        loadLocalModel?: (id: string) => Promise<number | null>,
    ) {
        this.strategy = strategy;
        this.budgetData = budgetData;
        this.runningModels = runningModels;
        this.allModelsById = new Map(allModels.map(m => [m.id, m]));
        this.loadLocalModel = loadLocalModel ?? null;

        if (!this.budgetData.modelCensorshipHitCount) this.budgetData.modelCensorshipHitCount = {};
        if (!this.budgetData.modelBrokenCount) this.budgetData.modelBrokenCount = {};
        if (!this.budgetData.modelRegenerationCount) this.budgetData.modelRegenerationCount = {};

        applyResetIfDue(this.budgetData);

        // Initialize FMs: 8 latent factors, Adam optimizer
        const factorizationMachineConfig = {
            numFactors: 8,
            regBias: 0.0001,
            regWeight: 0.001,
            regLatent: 0.001,
            epochs: 1,
            initLatentSigma: 0.01,
            batchSize: 1,
            verbose: false,
            adamLearningRate: 0.001,
            adamBeta1: 0.9,
            adamBeta2: 0.999,
            adamEpsilon: 1e-8,
        } as const;

        this.censorshipFM = new FactorizationMachine({ ...factorizationMachineConfig, task: 'classification' });
        this.acceptanceFM = new FactorizationMachine({ ...factorizationMachineConfig, task: 'classification' });
        this.featureExtractor = new FeatureExtractor();

        // Fire-and-forget async load. First predictions may use fresh FMs
        // (predicting ~0.5), which is harmless since ranking falls back to
        // tiers + aggregate when FM confidence is low.
        this.factorizationMachineLoadPromise = this.loadFactorizationMachinesFromStorage();
    }

    // ── Setters ───────────────────────────────────────────────────────

    setStrategy(strategy: BudgetStrategy): void { this.strategy = strategy; }

    setBudgetData(budgetData: BudgetData): void {
        this.budgetData = budgetData;
        if (!this.budgetData.modelCensorshipHitCount) this.budgetData.modelCensorshipHitCount = {};
        if (!this.budgetData.modelBrokenCount) this.budgetData.modelBrokenCount = {};
        if (!this.budgetData.modelRegenerationCount) this.budgetData.modelRegenerationCount = {};
        applyResetIfDue(this.budgetData);
    }

    setRunningModels(runningModels: Record<string, RunningModelState>): void {
        this.runningModels = runningModels;
        this.engine.setRunningModels(runningModels);
    }

    setAllModels(allModels: LanguageModel[]): void {
        this.allModelsById = new Map(allModels.map(m => [m.id, m]));
    }

    setLoadLocalModel(loadLocalModel: (id: string) => Promise<number | null>): void {
        this.loadLocalModel = loadLocalModel;
    }

    getBudgetData(): BudgetData { return this.budgetData; }
    getLastSelectedModelId(): string | null { return this._lastSelectedModelId; }

    // ── FM Persistence (server-backed) ────────────────────────────────

    /**
     * Await this if you need FMs loaded before proceeding.
     * Subsequent calls resolve immediately once loading completes.
     */
    async ensureFMsLoaded(): Promise<void> {
        if (this.factorizationMachineLoadPromise) {
            await this.factorizationMachineLoadPromise;
            this.factorizationMachineLoadPromise = null;
        }
    }

    private async loadFactorizationMachinesFromStorage(): Promise<void> {
        try {
            const [censorRaw, acceptRaw] = await Promise.all([
                loadRawFactorizationMachine("censorship"),
                loadRawFactorizationMachine("acceptance"),
            ]);
            if (censorRaw) this.censorshipFM = FactorizationMachine.fromJSON(censorRaw);
            if (acceptRaw) this.acceptanceFM = FactorizationMachine.fromJSON(acceptRaw);
        } catch (e) {
            console.warn('[BudgetEngine] Failed to load FM models from server:', e);
        }
    }

    private async saveFactorizationMachinesToStorage(): Promise<void> {
        try {
            await Promise.all([
                saveRawFactorizationMachine("censorship", this.censorshipFM.toJSON()),
                saveRawFactorizationMachine("acceptance", this.acceptanceFM.toJSON()),
            ]);
        } catch (e) {
            console.warn('[BudgetEngine] Failed to persist FM models to server:', e);
        }
    }

    /**
     * Debounced save: coalesces rapid successive calls (e.g., many trainOne calls
     * in quick succession) into a single server write every SAVE_DEBOUNCE_MS.
     */
    private scheduleSave(): void {
        if (this.saveDebounceTimer !== null) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveDebounceTimer = null;
            this.saveFactorizationMachinesToStorage().catch(e =>
                console.warn('[BudgetEngine] Debounced save failed:', e)
            );
        }, this.SAVE_DEBOUNCE_MS);
    }

    // ── Sliding Window Rate Limit Logic ───────────────────────────────

    private getRateLimitState(modelId: string): RateLimitState {
        let state = this.rateLimitStates.get(modelId);
        if (!state) {
            state = { requestTimestamps: [], lastRateLimitTimestamp: 0 };
            this.rateLimitStates.set(modelId, state);
        }
        return state;
    }

    private recordRequestTimestamp(modelId: string): void {
        const state = this.getRateLimitState(modelId);
        const now = Date.now();
        state.requestTimestamps.push(now);
        // Prune old entries outside the window
        const cutoff = now - SLIDING_WINDOW_MS;
        while (state.requestTimestamps.length > 0 && state.requestTimestamps[0] < cutoff) {
            state.requestTimestamps.shift();
        }
    }

    private recordRateLimitHit(modelId: string): void {
        const state = this.getRateLimitState(modelId);
        state.lastRateLimitTimestamp = Date.now();
    }

    private isModelOnCooldown(modelId: string): boolean {
        const state = this.getRateLimitState(modelId);
        if (state.lastRateLimitTimestamp === 0) return false;
        return Date.now() - state.lastRateLimitTimestamp < RATE_LIMIT_COOLDOWN_MS;
    }

    private isModelThrottled(modelId: string): boolean {
        const state = this.getRateLimitState(modelId);
        const now = Date.now();
        const cutoff = now - SLIDING_WINDOW_MS;
        const recentCount = state.requestTimestamps.filter(t => t >= cutoff).length;
        return recentCount >= MAX_REQUESTS_PER_WINDOW;
    }

    // ── Model resolution ──────────────────────────────────────────────

    private getSelectedModels(): LanguageModel[] {
        const models: LanguageModel[] = [];
        for (const id of this.strategy.modelIds) {
            const model = this.allModelsById.get(id);
            if (model) models.push(model);
        }
        return models;
    }

    private getActiveModels(currentTokens: number): LanguageModel[] {
        const selectedModels = this.getSelectedModels();
        return selectedModels.filter(model => {
            const activationThreshold = this.strategy.modelActivationContextSize?.[model.id] ?? 0;
            const deactivationThreshold = this.strategy.modelDeactivationContextSize?.[model.id];

            if (currentTokens < activationThreshold) return false;
            if (deactivationThreshold !== undefined && currentTokens >= deactivationThreshold) return false;

            return true;
        });
    }

    // ── Feature extraction ────────────────────────────────────────────

    private buildFeaturesForModel(
        model: LanguageModel,
        prompt: string,
        metadata: RequestMetadata,
    ): SparseVector {
        const baseFeatures = this.featureExtractor.extract(model, prompt, metadata);
        return this.censorshipFM.buildSparseVector(baseFeatures);
    }

    // ── FM prediction ─────────────────────────────────────────────────

    private predictFMScore(
        model: LanguageModel,
        prompt: string,
        metadata: RequestMetadata,
    ): number {
        const x = this.buildFeaturesForModel(model, prompt, metadata);
        const pAccept   = this.acceptanceFM.predictOne(x);
        const pCensor   = this.censorshipFM.predictOne(x);
        return pAccept * (1 - pCensor);
    }

    private factorizationMachineConfidenceFor(modelId: string): number {
        const uses = this.budgetData.modelUsedCount?.[modelId] ?? 0;
        return Math.min(1, uses / FM_MIN_SAMPLES_FOR_CONFIDENCE);
    }

    // ── Online learning ───────────────────────────────────────────────

    recordOutcome(outcome: RequestOutcome): void {
        const model = this.allModelsById.get(outcome.modelId);
        if (!model) return;

        const x = this.buildFeaturesForModel(model, outcome.prompt, outcome.metadata);

        this.censorshipFM.trainOne(x, outcome.censored    ? 1 : 0);
        this.acceptanceFM.trainOne(x, outcome.accepted    ? 1 : 0);

        this.factorizationMachineSampleCounter++;
        // Debounced save instead of every-10-samples to reduce server writes
        this.scheduleSave();
    }

    // ── Candidate selection ───────────────────────────────────────────

    async selectModelForRequest(
        requestBody: Record<string, unknown>,
        metadata: RequestMetadata = {},
    ): Promise<{ model: LanguageModel; modelId: string } | null> {
        const failedIds = new Set<string>();

        const promptText = (requestBody.prompt as string) || '';
        const requiredContextTokens = promptText.length > 0 ? await this.engine.countTokens(promptText) : 0;

        const candidates = this.getEligibleCandidates(requiredContextTokens, failedIds);
        if (candidates.length === 0) {
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

        const best = this.rankCandidates(candidates, requiredContextTokens, promptText, metadata)[0];
        if (!best) return null;

        const loaded = await this.ensureModelLoaded(best);
        if (!loaded) return null;

        this.engine.setContext(best);
        this._lastSelectedModelId = best.id;
        return { model: best, modelId: best.id };
    }

    private getEligibleCandidates(currentTokens: number, failedIds: Set<string>): LanguageModel[] {
        const activeModels = this.getActiveModels(currentTokens);
        const budgetExceeded = this.budgetData.budgetSpent >= this.strategy.maximumBudget;

        return activeModels.filter(model => {
            if (failedIds.has(model.id)) return false;
            if (budgetExceeded && !isFreeModel(model)) return false;

            // Hard-block: context length exceeded
            const contextLength = model.contextLength ?? 0;
            if (contextLength > 0 && currentTokens > contextLength) return false;

            // Hard-block: model is on rate-limit cooldown
            if (this.isModelOnCooldown(model.id)) return false;

            // Soft-throttle: too many requests in the sliding window
            if (this.isModelThrottled(model.id)) return false;

            return true;
        });
    }

    // ── Quality scores ────────────────────────────────────────────────

    getModelQualityScore(modelId: string): number {
        const used = this.budgetData.modelUsedCount?.[modelId] ?? 0;
        const regens = this.budgetData.modelRegenerationCount?.[modelId] ?? 0;

        if (used === 0) return 0;

        const effectiveRegens = Math.min(regens, used);
        const acceptanceRate = (used - effectiveRegens) / used;
        const confidence = Math.min(1, used / QUALITY_CONFIDENCE_THRESHOLD);

        return acceptanceRate * confidence;
    }

    getModelQualityScores(): Record<string, number> {
        const scores: Record<string, number> = {};
        const usedCounts = this.budgetData.modelUsedCount || {};

        for (const modelId of Object.keys(usedCounts)) {
            scores[modelId] = this.getModelQualityScore(modelId);
        }

        return scores;
    }

    recordRegeneration(modelId: string, prompt: string, metadata: RequestMetadata): void {
        if (!this.budgetData.modelRegenerationCount) {
            this.budgetData.modelRegenerationCount = {};
        }
        this.budgetData.modelRegenerationCount[modelId] =
            (this.budgetData.modelRegenerationCount[modelId] ?? 0) + 1;
        this.budgetData.lastUpdatedTimestamp = Date.now();

        const model = this.allModelsById.get(modelId);
        if (model) {
            const x = this.buildFeaturesForModel(model, prompt, metadata);
            this.acceptanceFM.trainOne(x, 0);
            this.factorizationMachineSampleCounter++;
            this.scheduleSave();
        }
    }

    // ── Ranking ───────────────────────────────────────────────────────

    private rankCandidates(
        candidates: LanguageModel[],
        requiredContextTokens: number,
        prompt: string,
        metadata: RequestMetadata,
    ): LanguageModel[] {
        const sorted = [...candidates];
        sorted.sort((a, b) => {
            const qualityA = this.strategy.modelQualityTiers?.[a.id] ?? 0;
            const qualityB = this.strategy.modelQualityTiers?.[b.id] ?? 0;
            if (qualityA !== qualityB) return qualityB - qualityA;

            const costA = this.strategy.modelCostTiers?.[a.id] ?? 0;
            const costB = this.strategy.modelCostTiers?.[b.id] ?? 0;
            if (costA !== costB) return costA - costB;

            const latencyA = this.strategy.modelLatencyMsPerTokenTiers?.[a.id] ?? 0;
            const latencyB = this.strategy.modelLatencyMsPerTokenTiers?.[b.id] ?? 0;
            if (latencyA !== latencyB) return latencyB - latencyA;

            const ttftA = this.strategy.modelTimeToFirstTokenTiers?.[a.id] ?? 0;
            const ttftB = this.strategy.modelTimeToFirstTokenTiers?.[b.id] ?? 0;
            if (ttftA !== ttftB) return ttftB - ttftA;

            const confA = this.factorizationMachineConfidenceFor(a.id);
            const confB = this.factorizationMachineConfidenceFor(b.id);

            const factorizationMachineScoreA = this.predictFMScore(a, prompt, metadata);
            const factorizationMachineScoreB = this.predictFMScore(b, prompt, metadata);

            const aggA = this.getModelQualityScore(a.id);
            const aggB = this.getModelQualityScore(b.id);

            const compA = this.computeCompositeQuality(a, requiredContextTokens);
            const compB = this.computeCompositeQuality(b, requiredContextTokens);

            const w = FM_BLEND_WEIGHT;
            const blendA = (w * confA) * factorizationMachineScoreA + (1 - w * confA) * aggA + 0.1 * compA;
            const blendB = (w * confB) * factorizationMachineScoreB + (1 - w * confB) * aggB + 0.1 * compB;

            if (Math.abs(blendA - blendB) > 0.0001) return blendB - blendA;

            const fitA = this.getContextFitFactor(a, requiredContextTokens);
            const fitB = this.getContextFitFactor(b, requiredContextTokens);
            if (Math.abs(fitA - fitB) > 0.01) return fitB - fitA;

            return Math.random() - 0.5;
        });
        return sorted;
    }

    // ── Streaming generation ──────────────────────────────────────────

    async generateStream(
        requestBody: Record<string, unknown>,
        abortController: AbortController,
        callbacks?: StreamCallbacks,
        metadata: RequestMetadata = {},
    ): Promise<StreamResult> {
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
                if (callbacks?.onFinish) callbacks.onFinish(rs);
            },
        };

        while (!abortController.signal.aborted) {
            const candidates = this.getEligibleCandidates(requiredContextTokens, failedIds);
            const ranked = this.rankCandidates(candidates, requiredContextTokens, promptText, metadata);

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
                    this.recordOutcome({
                        modelId: selectedModel.id,
                        prompt: promptText,
                        metadata,
                        success: false, accepted: false,
                        censored: false, rateLimited: false, broken: false,
                    });
                    console.warn(`Model ${selectedModel.name} could not be loaded, skipping.`);
                    break;
                }

                this.engine.setContext(selectedModel);
                this._lastSelectedModelId = selectedModel.id;
                this.recordRequestTimestamp(selectedModel.id);
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
                    const cachedTokens = result.cachedTokens ?? 0;
                    const cost = calculateRequestCost(promptTokens, cachedTokens, completionTokens, pricing);
                    this.recordSuccess(selectedModel.id, cost.totalCost);

                    const fullOutput = accumulatedPartialText + result.text;

                    if (!fullOutput) {
                        this.recordBroken(selectedModel.id);
                        failedIds.add(selectedModel.id);
                        this.recordOutcome({
                            modelId: selectedModel.id,
                            prompt: promptText,
                            metadata,
                            success: false, accepted: false,
                            censored: false, rateLimited: false, broken: true,
                        });
                        console.warn(`Model ${selectedModel.name} returned empty/broken response, rotating.`);
                        break;
                    }

                    const censored = isCensorshipRefusal(result.text);
                    if (censored) {
                        this.recordCensorship(selectedModel.id);
                        console.warn(`Model ${selectedModel.name} returned censorship refusal — returning text as-is.`);
                    }

                    this.recordOutcome({
                        modelId: selectedModel.id,
                        prompt: promptText,
                        metadata,
                        success: true,
                        accepted: true,
                        censored,
                        rateLimited: false,
                        broken: false,
                    });

                    return { text: fullOutput, isCompleted: result.isCompleted, cachedTokens: result.cachedTokens };
                } catch (e) {
                    if (abortController.signal.aborted) throw e;

                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

                    // Network errors: propagate immediately, do NOT penalize the model
                    if (isNetworkError(e)) {
                        throw e;
                    }

                    if (!isQuotaError(e)) {
                        this.recordError(selectedModel.id);
                        this.recordOutcome({
                            modelId: selectedModel.id,
                            prompt: promptText,
                            metadata,
                            success: false, accepted: false,
                            censored: false, rateLimited: false, broken: false,
                        });
                        throw e;
                    }

                    failedIds.add(selectedModel.id);
                    this.recordRateLimitHit(selectedModel.id);
                    this.recordQuotaError(selectedModel.id);
                    this.recordOutcome({
                        modelId: selectedModel.id,
                        prompt: promptText,
                        metadata,
                        success: false, accepted: false,
                        censored: false, rateLimited: true, broken: false,
                    });
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
        metadata: RequestMetadata = {},
    ): Promise<{ text: string; modelId: string }> {
        const failedIds = new Set<string>();

        const promptText = (requestBody.prompt as string) || '';
        const requiredContextTokens = promptText.length > 0 ? await this.engine.countTokens(promptText) : 0;

        while (!abortSignal?.aborted) {
            const candidates = this.getEligibleCandidates(requiredContextTokens, failedIds);
            const ranked = this.rankCandidates(candidates, requiredContextTokens, promptText, metadata);

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
                this.recordRequestTimestamp(selectedModel.id);
                const pricing = buildPricing(selectedModel);
                const sessionStart = Date.now();

                try {
                    const result = await this.engine.generateCompletion(requestBody);
                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

                    const promptTokens = requiredContextTokens || await this.engine.countTokens(promptText);
                    const completionTokens = await this.engine.countTokens(result.text);
                    const cachedTokens = result.cachedTokens ?? 0;
                    const cost = calculateRequestCost(promptTokens, cachedTokens, completionTokens, pricing);
                    this.recordSuccess(selectedModel.id, cost.totalCost);

                    if (!result.text) {
                        this.recordBroken(selectedModel.id);
                        failedIds.add(selectedModel.id);
                        console.warn(`Completion model ${selectedModel.name} returned empty/broken response, rotating.`);
                        break;
                    }

                    const censored = isCensorshipRefusal(result.text);
                    if (censored) {
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

                    // Network errors: propagate immediately, do NOT penalize the model
                    if (isNetworkError(e)) {
                        throw e;
                    }

                    if (!isQuotaError(e)) {
                        this.recordError(selectedModel.id);
                        throw e;
                    }

                    failedIds.add(selectedModel.id);
                    this.recordRateLimitHit(selectedModel.id);
                    this.recordQuotaError(selectedModel.id);
                    break;
                }
            }
        }

        console.warn('[BudgetEngine] All models exhausted for completion. Returning empty result.');
        return { text: '', modelId: '' };
    }

    // ── Observed Performance Metrics ────────────────────────────────

    private getModelSpeed(modelId: string): number { return this.budgetData.modelAverageLatencyMsPerToken?.[modelId] ?? Number.POSITIVE_INFINITY; }
    private getModelTTFT(modelId: string): number { return this.budgetData.modelAverageTimeToFirstToken?.[modelId] ?? Number.POSITIVE_INFINITY; }
    private getModelSessionScore(modelId: string): number { return this.budgetData.modelTotalSessionDuration?.[modelId] ?? 0; }

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
        const totalDuration = this.getModelSessionScore(modelId);
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
        const selectedModels = this.getSelectedModels();
        const freeModels = selectedModels.filter(m => {
            if (!isFreeModel(m)) return false;
            if (failedIds.has(m.id)) return false;
            // Hard-block: context length exceeded
            const contextLength = m.contextLength ?? 0;
            if (contextLength > 0 && (requiredContextTokens ?? 0) > contextLength) return false;
            // Hard-block: rate-limit cooldown
            if (this.isModelOnCooldown(m.id)) return false;
            // Soft-throttle: sliding window
            if (this.isModelThrottled(m.id)) return false;
            return true;
        });
        if (freeModels.length === 0) return null;

        const ranked = [...freeModels].sort((a, b) => {
            const scoreA = this.computeCompositeQuality(a, requiredContextTokens);
            const scoreB = this.computeCompositeQuality(b, requiredContextTokens);
            if (Math.abs(scoreA - scoreB) > 0.0001) return scoreB - scoreA;
            return Math.random() - 0.5;
        });

        return ranked[0] ?? null;
    }

    // ── Recording ───────────────────────────────────────────────────

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

    // ── Model Loading ───────────────────────────────────────────────

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

    // ── Introspection ─────────────────────────────────────────────────

    getCensorshipFeatureImportance(): Map<string, number> {
        return this.censorshipFM.featureImportance();
    }

    getCensorshipFM(): FactorizationMachine { return this.censorshipFM; }
    getAcceptanceFM(): FactorizationMachine { return this.acceptanceFM; }

    /**
     * Force-persist FM models to server immediately.
     * Useful for graceful shutdown hooks (e.g., beforeunload).
     * Note: beforeunload cannot reliably await async work — use this
     * as best-effort alongside the periodic debounced saves.
     */
    async persistFMs(): Promise<void> {
        if (this.saveDebounceTimer !== null) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }
        await this.saveFactorizationMachinesToStorage();
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
    allModels: LanguageModel[],
    loadLocalModel?: (id: string) => Promise<number | null>,
): BudgetStrategyEngine {
    instance = new BudgetStrategyEngine(strategy, budgetData, runningModels, allModels, loadLocalModel);
    return instance;
}

export function reset(): void { instance = null; }