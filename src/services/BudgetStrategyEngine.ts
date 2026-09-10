// src/services/BudgetStrategyEngine.ts
import type { BudgetStrategy, BudgetData, Character, InteractionData, LanguageModel } from '../types';
import { getLanguageModelEngine, type StreamCallbacks, type StreamResult } from './LanguageModelEngine';
import { prepareRequestBody } from '../hooks/chatLogic';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { buildContextFromModel } from '../utilities/modelContextResolver';

// ─── Types ───────────────────────────────────────────────────────────

export interface RunningModelState {
    isRunning: boolean;
    port?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

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

function isCensorshipRefusal(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    const lower = text.toLowerCase().trim();
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
    private failedOnlineIds = new Set<string>();
    private failedLocalIds = new Set<string>();
    private engine = getLanguageModelEngine();

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

    // ─── Setters ─────────────────────────────────────────────────────

    setStrategy(strategy: BudgetStrategy): void {
        this.strategy = strategy;
        this.failedOnlineIds.clear();
        this.failedLocalIds.clear();
    }

    setBudgetData(budgetData: BudgetData): void {
        this.budgetData = budgetData;
        if (!this.budgetData.modelCensorshipHitCount) this.budgetData.modelCensorshipHitCount = {};
        if (!this.budgetData.modelBrokenCount) this.budgetData.modelBrokenCount = {};
        applyResetIfDue(this.budgetData);
    }

    setRunningModels(runningModels: Record<string, RunningModelState>): void {
        this.runningModels = runningModels;
    }

    setLoadLocalModel(loadLocalModel: (id: string) => Promise<number | null>): void {
        this.loadLocalModel = loadLocalModel;
    }

    getBudgetData(): BudgetData {
        return this.budgetData;
    }

    // ─── Streaming Generation ────────────────────────────────────────

    async generateStream(
        interactionData: InteractionData,
        character: Character,
        abortController: AbortController,
        callbacks?: StreamCallbacks,
        userFilesBase64?: string[],
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

            const primaryCtx = buildContextFromModel(selectedModel, this.runningModels);
            const pricing = buildPricing(selectedModel);
            const runtimePort = primaryCtx.runtimePort;
            const sessionStart = Date.now();

            try {
                const { body: rawBody } = await prepareRequestBody(interactionData, character, accumulatedPartialText, userFilesBase64, runtimePort);
                const body = rawBody as Record<string, unknown>;

                const { controller: timeoutCtrl, cleanup: cleanupTimeout } = this.createTimeoutController(abortController.signal);
                let result: StreamResult;
                try {
                    result = await this.engine.generateStream(
                        body,
                        timeoutCtrl,
                        wrappedCallbacks,
                        primaryCtx,
                    );
                } catch (e) {
                    cleanupTimeout();
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

                const sessionDuration = Date.now() - sessionStart;
                this.recordSessionDuration(selectedModel.id, sessionDuration);

                if (result.msPerToken && result.msPerToken > 0) {
                    this.recordLatency(selectedModel.id, result.msPerToken);
                }
                if (result.timeToFirstToken && result.timeToFirstToken > 0) {
                    this.recordTTFT(selectedModel.id, result.timeToFirstToken);
                }

                const promptTokens = await this.engine.countTokens((body.prompt as string) || '');
                const completionTokens = await this.engine.countTokens(result.text);
                const cost = calculateRequestCost(promptTokens, completionTokens, false, pricing);
                this.recordSuccess(selectedModel.id, cost.totalCost);

                // Check for broken response — rotate to next model
                const fullOutput = accumulatedPartialText + result.text;
                if (!fullOutput.trim()) {
                    this.recordBroken(selectedModel.id);
                    primaryFailedSet.add(selectedModel.id);
                    console.warn(`Model ${selectedModel.name} returned empty/broken response, rotating.`);
                    continue;
                }

                // Check for censorship refusal — rotate to next model
                if (isCensorshipRefusal(result.text)) {
                    this.recordCensorship(selectedModel.id);
                    primaryFailedSet.add(selectedModel.id);
                    console.warn(`Model ${selectedModel.name} returned censorship refusal, rotating.`);
                    continue;
                }

                return fullOutput;
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

                const fallbackCtx = buildContextFromModel(selectedModel, this.runningModels);
                const fallbackPricing = buildPricing(selectedModel);
                const fallbackPort = fallbackCtx.runtimePort;
                const sessionStart = Date.now();

                try {
                    const { body: rawFallbackBody } = await prepareRequestBody(interactionData, character, accumulatedPartialText, userFilesBase64, fallbackPort);
                    const fallbackBody = rawFallbackBody as Record<string, unknown>;

                    const { controller: timeoutCtrl, cleanup: cleanupTimeout } = this.createTimeoutController(abortController.signal);
                    let result: StreamResult;
                    try {
                        result = await this.engine.generateStream(
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

                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

                    if (result.msPerToken && result.msPerToken > 0) {
                        this.recordLatency(selectedModel.id, result.msPerToken);
                    }
                    if (result.timeToFirstToken && result.timeToFirstToken > 0) {
                        this.recordTTFT(selectedModel.id, result.timeToFirstToken);
                    }

                    const promptTokens = await this.engine.countTokens((fallbackBody.prompt as string) || '');
                    const completionTokens = await this.engine.countTokens(result.text);
                    const cost = calculateRequestCost(promptTokens, completionTokens, false, fallbackPricing);
                    this.recordSuccess(selectedModel.id, cost.totalCost);

                    // Check for broken response — rotate to next model
                    const fullOutput = accumulatedPartialText + result.text;
                    if (!fullOutput.trim()) {
                        this.recordBroken(selectedModel.id);
                        fallbackFailedSet.add(selectedModel.id);
                        console.warn(`Fallback model ${selectedModel.name} returned empty/broken response, rotating.`);
                        continue;
                    }

                    // Check for censorship refusal — rotate to next model
                    if (isCensorshipRefusal(result.text)) {
                        this.recordCensorship(selectedModel.id);
                        fallbackFailedSet.add(selectedModel.id);
                        console.warn(`Fallback model ${selectedModel.name} returned censorship refusal, rotating.`);
                        continue;
                    }

                    return fullOutput;
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

        // ─── Both pools exhausted — try free models as last resort ───
        if (!abortController.signal.aborted) {
            const allFailedIds = new Set([...this.failedOnlineIds, ...this.failedLocalIds]);

            while (true) {
                const freeModel = this.selectFreeModel(allFailedIds);
                if (!freeModel) break;

                const loaded = await this.ensureModelLoaded(freeModel);
                if (!loaded) {
                    allFailedIds.add(freeModel.id);
                    this.recordError(freeModel.id);
                    console.warn(`Free model ${freeModel.name} could not be loaded, skipping.`);
                    continue;
                }

                const freeCtx = buildContextFromModel(freeModel, this.runningModels);
                const freePort = freeCtx.runtimePort;
                const sessionStart = Date.now();

                try {
                    const { body: rawFreeBody } = await prepareRequestBody(interactionData, character, accumulatedPartialText, userFilesBase64, freePort);
                    const freeBody = rawFreeBody as Record<string, unknown>;

                    const { controller: timeoutCtrl, cleanup: cleanupTimeout } = this.createTimeoutController(abortController.signal);
                    let result: StreamResult;
                    try {
                        result = await this.engine.generateStream(
                            freeBody,
                            timeoutCtrl,
                            wrappedCallbacks,
                            freeCtx,
                        );
                    } catch (e) {
                        cleanupTimeout();
                        if (timeoutCtrl.signal.aborted && !abortController.signal.aborted) {
                            const sessionDuration = Date.now() - sessionStart;
                            this.recordSessionDuration(freeModel.id, sessionDuration);
                            allFailedIds.add(freeModel.id);
                            this.recordError(freeModel.id);
                            console.warn(`Free model ${freeModel.name} timed out after ${this.strategy.fallbackOnTimeoutInSeconds}s, rotating.`);
                            continue;
                        }
                        throw e;
                    } finally {
                        cleanupTimeout();
                    }

                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(freeModel.id, sessionDuration);

                    if (result.msPerToken && result.msPerToken > 0) {
                        this.recordLatency(freeModel.id, result.msPerToken);
                    }
                    if (result.timeToFirstToken && result.timeToFirstToken > 0) {
                        this.recordTTFT(freeModel.id, result.timeToFirstToken);
                    }

                    this.recordSuccess(freeModel.id, 0);

                    // Check for broken response — rotate to next free model
                    const fullOutput = accumulatedPartialText + result.text;
                    if (!fullOutput.trim()) {
                        this.recordBroken(freeModel.id);
                        allFailedIds.add(freeModel.id);
                        console.warn(`Free model ${freeModel.name} returned empty/broken response, rotating.`);
                        continue;
                    }

                    // Check for censorship refusal — rotate to next free model
                    if (isCensorshipRefusal(result.text)) {
                        this.recordCensorship(freeModel.id);
                        allFailedIds.add(freeModel.id);
                        console.warn(`Free model ${freeModel.name} returned censorship refusal, rotating.`);
                        continue;
                    }

                    console.info(`[BudgetEngine] Using free model ${freeModel.name} — budget exhausted or all paid models failed.`);
                    return fullOutput;
                } catch (e) {
                    if (abortController.signal.aborted) throw e;

                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(freeModel.id, sessionDuration);

                    allFailedIds.add(freeModel.id);
                    this.recordError(freeModel.id);
                    console.warn(`Free model ${freeModel.name} failed, trying next free model.`);
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

    // ─── Non-Streaming Completion ────────────────────────────────────

    async generateCompletion(
        requestBody: Record<string, unknown>,
        abortSignal?: AbortSignal,
    ): Promise<{ text: string; modelId: string }> {
        this.failedOnlineIds.clear();
        this.failedLocalIds.clear();

        const useOnline = await this.shouldUseOnline(undefined);
        const primaryPool = useOnline ? this.strategy.onlineModels : this.strategy.localModels;
        const fallbackPool = useOnline ? this.strategy.localModels : this.strategy.onlineModels;
        const primaryFailedSet = useOnline ? this.failedOnlineIds : this.failedLocalIds;
        const fallbackFailedSet = useOnline ? this.failedLocalIds : this.failedOnlineIds;

        // ─── Try primary pool ───
        while (true) {
            const selectedModel = this.selectFromPool(primaryPool, primaryFailedSet);
            if (!selectedModel) break;

            if (abortSignal?.aborted) throw new Error('Aborted');

            const loaded = await this.ensureModelLoaded(selectedModel);
            if (!loaded) {
                primaryFailedSet.add(selectedModel.id);
                this.recordError(selectedModel.id);
                continue;
            }

            const ctx = buildContextFromModel(selectedModel, this.runningModels);
            const pricing = buildPricing(selectedModel);
            const sessionStart = Date.now();

            try {
                const result = await this.engine.generateCompletion(requestBody, ctx);
                const sessionDuration = Date.now() - sessionStart;
                this.recordSessionDuration(selectedModel.id, sessionDuration);

                const promptTokens = await this.engine.countTokens((requestBody.prompt as string) || '');
                const completionTokens = await this.engine.countTokens(result.text);
                const cost = calculateRequestCost(promptTokens, completionTokens, false, pricing);
                this.recordSuccess(selectedModel.id, cost.totalCost);

                // Check for broken response — rotate
                if (!result.text.trim()) {
                    this.recordBroken(selectedModel.id);
                    primaryFailedSet.add(selectedModel.id);
                    console.warn(`Completion model ${selectedModel.name} returned empty/broken response, rotating.`);
                    continue;
                }

                // Check for censorship refusal — rotate
                if (isCensorshipRefusal(result.text)) {
                    this.recordCensorship(selectedModel.id);
                    primaryFailedSet.add(selectedModel.id);
                    console.warn(`Completion model ${selectedModel.name} returned censorship refusal, rotating.`);
                    continue;
                }

                return { text: result.text, modelId: selectedModel.id };
            } catch (e) {
                const sessionDuration = Date.now() - sessionStart;
                this.recordSessionDuration(selectedModel.id, sessionDuration);

                if (!isQuotaError(e)) {
                    this.recordError(selectedModel.id);
                    throw e;
                }

                primaryFailedSet.add(selectedModel.id);
                this.recordQuotaError(selectedModel.id);
            }
        }

        // ─── Fallback pool ───
        if (this.strategy.fallbackOnLocalFailure) {
            while (true) {
                const selectedModel = this.selectFromPool(fallbackPool, fallbackFailedSet);
                if (!selectedModel) break;

                if (abortSignal?.aborted) throw new Error('Aborted');

                const loaded = await this.ensureModelLoaded(selectedModel);
                if (!loaded) {
                    fallbackFailedSet.add(selectedModel.id);
                    this.recordError(selectedModel.id);
                    continue;
                }

                const ctx = buildContextFromModel(selectedModel, this.runningModels);
                const pricing = buildPricing(selectedModel);
                const sessionStart = Date.now();

                try {
                    const result = await this.engine.generateCompletion(requestBody, ctx);
                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

                    const promptTokens = await this.engine.countTokens((requestBody.prompt as string) || '');
                    const completionTokens = await this.engine.countTokens(result.text);
                    const cost = calculateRequestCost(promptTokens, completionTokens, false, pricing);
                    this.recordSuccess(selectedModel.id, cost.totalCost);

                    // Check for broken response — rotate
                    if (!result.text.trim()) {
                        this.recordBroken(selectedModel.id);
                        fallbackFailedSet.add(selectedModel.id);
                        console.warn(`Fallback completion model ${selectedModel.name} returned empty/broken response, rotating.`);
                        continue;
                    }

                    // Check for censorship refusal — rotate
                    if (isCensorshipRefusal(result.text)) {
                        this.recordCensorship(selectedModel.id);
                        fallbackFailedSet.add(selectedModel.id);
                        console.warn(`Fallback completion model ${selectedModel.name} returned censorship refusal, rotating.`);
                        continue;
                    }

                    return { text: result.text, modelId: selectedModel.id };
                } catch (e) {
                    const sessionDuration = Date.now() - sessionStart;
                    this.recordSessionDuration(selectedModel.id, sessionDuration);

                    if (!isQuotaError(e)) {
                        this.recordError(selectedModel.id);
                        throw e;
                    }

                    fallbackFailedSet.add(selectedModel.id);
                    this.recordQuotaError(selectedModel.id);
                }
            }
        }

        // ─── Free models ───
        const allFailedIds = new Set([...this.failedOnlineIds, ...this.failedLocalIds]);
        while (true) {
            const freeModel = this.selectFreeModel(allFailedIds);
            if (!freeModel) break;

            if (abortSignal?.aborted) throw new Error('Aborted');

            const loaded = await this.ensureModelLoaded(freeModel);
            if (!loaded) {
                allFailedIds.add(freeModel.id);
                this.recordError(freeModel.id);
                continue;
            }

            const ctx = buildContextFromModel(freeModel, this.runningModels);
            const sessionStart = Date.now();

            try {
                const result = await this.engine.generateCompletion(requestBody, ctx);
                const sessionDuration = Date.now() - sessionStart;
                this.recordSessionDuration(freeModel.id, sessionDuration);
                this.recordSuccess(freeModel.id, 0);

                // Check for broken response — rotate
                if (!result.text.trim()) {
                    this.recordBroken(freeModel.id);
                    allFailedIds.add(freeModel.id);
                    console.warn(`Free completion model ${freeModel.name} returned empty/broken response, rotating.`);
                    continue;
                }

                // Check for censorship refusal — rotate
                if (isCensorshipRefusal(result.text)) {
                    this.recordCensorship(freeModel.id);
                    allFailedIds.add(freeModel.id);
                    console.warn(`Free completion model ${freeModel.name} returned censorship refusal, rotating.`);
                    continue;
                }

                return { text: result.text, modelId: freeModel.id };
            } catch {
                const sessionDuration = Date.now() - sessionStart;
                this.recordSessionDuration(freeModel.id, sessionDuration);
                allFailedIds.add(freeModel.id);
                this.recordError(freeModel.id);
            }
        }

        throw new Error('All models exhausted for completion request.');
    }

    // ─── Pool Selection ──────────────────────────────────────────────

    private getTier(model: LanguageModel): number {
        return this.strategy.modelCostTiers?.[model.id] ?? 0;
    }

    private isInQuotaCooldown(modelId: string): boolean {
        const lastQuotaHit = this.budgetData.modelLastQuotaHitTimeStamps[modelId];
        if (!lastQuotaHit) return false;
        return (Date.now() - lastQuotaHit) < 60_000;
    }

    private getModelSpeed(modelId: string): number {
        return this.budgetData.modelAverageLatencyMsPerToken?.[modelId] ?? Number.POSITIVE_INFINITY;
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

    private computeCompositeQuality(modelId: string): number {
        const speed = this.getModelSpeed(modelId);
        const ttft = this.getModelTTFT(modelId);
        const totalDuration = this.getModelQualityScore(modelId);
        const usedCount = this.budgetData.modelUsedCount?.[modelId] ?? 0;
        const quotaHits = this.budgetData.modelQuotaHitCount?.[modelId] ?? 0;
        const errorHits = this.budgetData.modelErrorHitCount?.[modelId] ?? 0;
        const censorshipHits = this.budgetData.modelCensorshipHitCount?.[modelId] ?? 0;
        const brokenHits = this.budgetData.modelBrokenCount?.[modelId] ?? 0;

        const speedFactor = Number.isFinite(speed) && speed > 0 ? 1 / speed : 0;
        const ttftFactor = Number.isFinite(ttft) && ttft > 0 ? 1 / ttft : 0;
        const avgSessionSeconds = usedCount > 0 ? (totalDuration / usedCount) / 1000 : 0;
        const totalFailures = quotaHits + errorHits + censorshipHits + brokenHits;
        const reliabilityFactor = usedCount > 0 ? Math.max(0, (usedCount - totalFailures) / usedCount) : 0;

        return speedFactor * ttftFactor * avgSessionSeconds * reliabilityFactor;
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
                const aBelowThreshold = this.isBelowQualityThreshold(a.id) ? 1 : 0;
                const bBelowThreshold = this.isBelowQualityThreshold(b.id) ? 1 : 0;
                if (aBelowThreshold !== bBelowThreshold) return aBelowThreshold - bBelowThreshold;

                const scoreA = this.computeCompositeQuality(a.id);
                const scoreB = this.computeCompositeQuality(b.id);
                if (Math.abs(scoreA - scoreB) > 0.0001) return scoreB - scoreA;

                return Math.random() - 0.5;
            });
            if (candidates.length > 0) {
                return candidates[0];
            }
        }

        return null;
    }

    private selectFreeModel(failedIds: Set<string>): LanguageModel | null {
        const allModels = [...this.strategy.onlineModels, ...this.strategy.localModels];
        const freeModels = allModels.filter(m => isFreeModel(m));
        if (freeModels.length === 0) return null;
        return this.selectFromPool(freeModels, failedIds);
    }

    // ─── Stats Recording ─────────────────────────────────────────────

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
        if (!this.budgetData.modelCensorshipHitCount) {
            this.budgetData.modelCensorshipHitCount = {};
        }
        this.budgetData.modelCensorshipHitCount[modelId] =
            (this.budgetData.modelCensorshipHitCount[modelId] ?? 0) + 1;
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    private recordBroken(modelId: string): void {
        if (!this.budgetData.modelBrokenCount) {
            this.budgetData.modelBrokenCount = {};
        }
        this.budgetData.modelBrokenCount[modelId] =
            (this.budgetData.modelBrokenCount[modelId] ?? 0) + 1;
        this.budgetData.lastUpdatedTimestamp = Date.now();
    }

    private recordLatency(modelId: string, observedMsPerToken: number): void {
        if (!this.budgetData.modelAverageLatencyMsPerToken) {
            this.budgetData.modelAverageLatencyMsPerToken = {};
        }
        const alpha = this.budgetData.averageLatencyMsPerTokenExponentialMovingAverageSmoothing ?? 0.3;
        const previous = this.budgetData.modelAverageLatencyMsPerToken[modelId];
        if (previous === undefined) {
            this.budgetData.modelAverageLatencyMsPerToken[modelId] = observedMsPerToken;
        } else {
            this.budgetData.modelAverageLatencyMsPerToken[modelId] =
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

    // ─── Online vs Local Decision ────────────────────────────────────

    private async shouldUseOnline(interactionData?: InteractionData): Promise<boolean> {
        if (this.strategy.onlineModels.length === 0) return false;
        if (this.strategy.localModels.length === 0) return true;
        if (this.budgetData.budgetSpent >= this.strategy.maximumBudget) return false;

        if (interactionData) {
            let numberOfTokens = 0;
            for (const m of interactionData.interactionHistory) {
                if (m.kind === 'chat') numberOfTokens += await this.engine.countTokens(m.textContent);
            }

            if (numberOfTokens >= this.strategy.switchOnContextSize) return true;

            const complexityScore = computeComplexityScore(interactionData);
            if (complexityScore !== undefined && complexityScore >= this.strategy.switchOnComplexityScore) return true;
        }

        const roll = Math.random() * 100;
        return roll < this.strategy.switchProbability;
    }
}

// ─── Singleton Accessor ──────────────────────────────────────────────

let instance: BudgetStrategyEngine | null = null;

export function getBudgetStrategyEngine(): BudgetStrategyEngine {
    if (!instance) {
        throw new Error('BudgetStrategyEngine not initialized. Call initializeBudgetStrategyEngine() first.');
    }
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

export function reset(): void {
    instance = null;
}