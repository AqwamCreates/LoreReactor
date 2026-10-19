// src/frontend_src/services/CharacterActor.ts
import type { 
    Character, InteractionData, BudgetStrategy, BudgetData, 
    PromptBlock, tool, ChatMessage, LanguageModel, Profile, 
    ToolExecutionResult, toolUsageDisplayMode, toolUsageDisplayPlacementMode,
    ActiveToolActions, PendingToolAction, Inventory
} from '../types';
import { saveRawBudgetData } from '../storages/serverStorage';
import { buildRequestBody, createChatMessage, createToolMessage, isToolMessageText, addMessageToInteractionData } from '../utilities/interactionDataLogic';
import { detectName } from '../utilities/nameDetection';
import { getFilteredTextMessages } from '../utilities/promptLogic';
import { getBudgetStrategyEngine, type RequestMetadata } from './BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { getEffectiveTools, initializeClothingWearingStatuses } from '../utilities/characterLogic';
import { sentimentEngine } from './SentimentAnalysisEngine';
import { getLanguageModelEngine, type StreamCallbacks } from './LanguageModelEngine';
import { ToolInvocationParser, type ToolInvocation } from './ToolInvocationParser';
import { defaultBudgetData } from '../dictionaries/defaults';
import { executeTools, formatToolDisplay, type ToolExecutionContext, type ToolResult } from './ToolExecutor';
import { findLatestMessage } from '../utilities/messageLogic';
import { getCurrentLocationId } from '../utilities/locationLogic';
import { toolResultStartString, toolResultEndString } from '../dictionaries/stringList';
import type { StreamingVoiceTracker } from './StreamingVoiceTracker';
import { compileMessageDisplayText } from '../utilities/messageDisplayCompiler';

// ─── Result Types ───────────────────────────────────────────────────

export interface TurnStats {
    numberOfRequests: number;
    numberOfCacheInvalidations: number;
    totalCost: number;
    costWithoutCacheMisses: number;
}

export interface TurnResult {
    updatedData: InteractionData;
    budgetData: BudgetData | null;
    statsDelta: TurnStats;
    latencyMsPerToken: number;
    timeToFirstTokenMs: number;
    expression: string | null;
    rawText: string;
    displayText: string;
    isCompleted: boolean;
    promptText?: string;
}

export interface TurnError {
    message: string;
    type: 'network' | 'inference' | 'budget' | 'no_model' | 'aborted' | 'client_no_generate';
}

export interface TurnStreamCallbacks {
    onDisplayText: (text: string) => void;
    onLatency: (msPerToken: number) => void;
    onTimeToFirstToken: (ms: number) => void;
    onExpression: (expression: string) => void;
}

export interface TurnExecutionParams {
    data: InteractionData;
    character: Character;
    signal: AbortSignal;
    selectedModel: LanguageModel | null;
    runningModels: Record<string, { isRunning: boolean; port?: number }>;
    activeStrategy: BudgetStrategy | null;
    strategyOverride?: BudgetStrategy | null;
    existingCharacterText?: string;
    allPromptBlocks: PromptBlock[];
    callbacks?: TurnStreamCallbacks;
    isMultiplayerClient?: boolean;
    borrowedModel?: LanguageModel | null;
    metadata?: RequestMetadata;
    toolContext: ToolExecutionContext;
    voiceTracker?: StreamingVoiceTracker;
}

export interface ProcessedReplacements {
    rawReplacements: { rawMatch: string; resultText: string }[];
    displayReplacements: { rawMatch: string; displayText: string }[];
    executionResults: ToolExecutionResult[];
}

export interface DisplayContext {
    displayMode: toolUsageDisplayMode;
    placementMode: toolUsageDisplayPlacementMode;
    participants: Character[];
    character: Character;
}

// ─── Dual-Text Tool Processing ──────────────────────────────────────

async function processToolInvocations(
    invocations: ToolInvocation[],
    character: Character,
    profile: Profile | undefined,
    targetMessage: ChatMessage,
    interactionData: InteractionData,
    context: ToolExecutionContext,
): Promise<ProcessedReplacements | null> {
    if (!invocations || invocations.length === 0) return null;

    const effectiveTools = getEffectiveTools(character, profile);
    const displayMode = profile?.toolUsageDisplayMode ?? 'none';

    const rawReplacements: { rawMatch: string; resultText: string }[] = [];
    const displayReplacements: { rawMatch: string; displayText: string }[] = [];
    const executionResults: ToolExecutionResult[] = [];

    for (const inv of invocations) {
        const isEnabled = effectiveTools[inv.toolType as tool] ?? false;

        let toolResult: ToolResult;
        if (!isEnabled) {
            toolResult = {
                toolType: inv.toolType,
                args: inv.args,
                textContent: "Tool disabled",
                displayReplacement: ""
            };
        } else {
            try {
                const results = await executeTools([inv], targetMessage, interactionData, context, displayMode);
                toolResult = results[0] || {
                    toolType: inv.toolType,
                    args: inv.args,
                    textContent: 'Something went wrong',
                    displayReplacement: ''
                };
            } catch (e) {
                console.error('[CharacterActor] executeTools failed:', e);
                toolResult = {
                    toolType: inv.toolType,
                    args: inv.args,
                    textContent: 'Something went wrong',
                    displayReplacement: ''
                };
            }
        }

        const resultContent = toolResult.textContent || 'Something went wrong';

        rawReplacements.push({
            rawMatch: inv.rawMatch,
            resultText: resultContent,
        });

        displayReplacements.push({
            rawMatch: inv.rawMatch,
            displayText: formatToolDisplay(toolResult, inv.rawMatch, displayMode),
        });

        executionResults.push({
            rawMatch: inv.rawMatch,
            toolType: toolResult.toolType,
            args: toolResult.args,
            textContent: resultContent,
            displayReplacement: toolResult.displayReplacement
        });
    }

    return { rawReplacements, displayReplacements, executionResults };
}

function applyToolReplacements(
    accState: ReturnType<typeof createTextAccumulationState>,
    replacements: ProcessedReplacements,
    callbacks?: TurnStreamCallbacks,
    displayContext?: DisplayContext,
): void {
    const acc = accState.get();
    let currentRaw = acc.raw;

    for (let i = 0; i < replacements.rawReplacements.length; i++) {
        const { rawMatch, resultText } = replacements.rawReplacements[i];

        // Raw prompt context: delimited observation boundary (⟪tool()⟫⟦result: ...⟧)
        const rawReplacement = `${rawMatch}${toolResultStartString}result: ${resultText}${toolResultEndString} `;
        if (currentRaw.includes(rawMatch)) {
            currentRaw = currentRaw.replace(rawMatch, rawReplacement);
        } else {
            const trimmedRaw = currentRaw.trimEnd();
            currentRaw = (trimmedRaw ? `${trimmedRaw} ` : '') + rawReplacement;
        }
    }

    acc.setRaw(currentRaw);

    if (displayContext) {
        // Compile display representation dynamically adhering to the configured placement mode
        const compiled = compileMessageDisplayText(
            currentRaw,
            displayContext.displayMode,
            displayContext.placementMode,
            displayContext.participants,
            displayContext.character,
            acc.collectedExecutionResults
        );
        acc.setDisplay(compiled);
        callbacks?.onDisplayText(compiled);
    }
}

function classifyError(error: unknown, signal: AbortSignal): TurnError {
    if (signal.aborted) {
        return { message: 'Aborted', type: 'aborted' };
    }
    if (!error) {
        return { message: 'Unknown error (null)', type: 'inference' };
    }
    const e = error as Error;
    const message = e.message || String(error);
    if (e.name === 'AbortError') {
        return { message: 'Aborted', type: 'aborted' };
    }
    const isNet = ['Failed to fetch', 'NetworkError', 'ERR_ABORTED', '502', '503', '504'].some(s => message.includes(s));
    if (isNet) {
        return { message: 'Backend Connection Failed', type: 'network' };
    }
    return { message, type: 'inference' };
}

// ─── AGGRESSIVE HALLUCINATION NUKER ─────────────────────────────────
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startEsc = escapeRegex(toolResultStartString);
const endEsc = escapeRegex(toolResultEndString);
const hallucinationRegex = new RegExp(`${startEsc}[\\s\\S]*?${endEsc}`, 'g');

function nukeHallucinatedResults(text: string): string {
    // 1. Nuke complete fake observations
    let clean = text.replace(hallucinationRegex, '');
    
    // 2. Nuke trailing unclosed fake observations
    const lastOpen = clean.lastIndexOf(toolResultStartString);
    const lastClose = clean.lastIndexOf(toolResultEndString);
    if (lastOpen !== -1 && lastOpen > lastClose) {
        clean = clean.substring(0, lastOpen);
    }
    
    return clean;
}

function createTextAccumulationState(initialText: string) {
    const sanitizedText = nukeHallucinatedResults(initialText);

    let rawAcc = sanitizedText;
    let displayAcc = sanitizedText;
    let lastRawLen = sanitizedText.length;
    let pendingInvs: ToolInvocation[] = [];
    const collectedExecutionResults: ToolExecutionResult[] = [];

    return {
        get: () => ({
            raw: rawAcc,
            display: displayAcc,
            setRaw: (v: string) => { rawAcc = v; },
            setDisplay: (v: string) => { displayAcc = v; },
            getLastRawLen: () => lastRawLen,
            setLastRawLen: (v: number) => { lastRawLen = v; },
            pendingInvocations: pendingInvs,
            addPendingInvocation: (inv: ToolInvocation) => { pendingInvs.push(inv); },
            clearPendingInvocations: () => { pendingInvs = []; },
            collectedExecutionResults,
            addExecutionResults: (results: ToolExecutionResult[]) => { 
                collectedExecutionResults.push(...results); 
            },
        }),
        getRaw: () => rawAcc,
        getDisplay: () => displayAcc,
        getPending: () => pendingInvs,
        clearPending: () => { pendingInvs = []; },
        getCollectedExecutionResults: () => collectedExecutionResults,
    };
}

// ─── Orchestrator ───────────────────────────────────────────────────

export class CharacterActor {
    private engine = getLanguageModelEngine();

    async executeTurn(params: TurnExecutionParams): Promise<{ result: TurnResult } | { error: TurnError }> {
        const {
            data, character, signal,
            selectedModel, runningModels, activeStrategy,
            strategyOverride, existingCharacterText, allPromptBlocks, callbacks,
            isMultiplayerClient, borrowedModel, metadata,
            toolContext,
        } = params;

        if (isMultiplayerClient) {
            return { error: { message: 'Multiplayer client cannot generate locally', type: 'client_no_generate' } };
        }

        const strat = strategyOverride ?? activeStrategy;
        const pricing: ModelPricing = { cacheHitPerMillion: 0, cacheMissPerMillion: 0, outputPerMillion: 0 };

        const statsDelta: TurnStats = {
            numberOfRequests: 0,
            numberOfCacheInvalidations: 0,
            totalCost: 0,
            costWithoutCacheMisses: 0,
        };
        let latestLatency = 0;
        let latestTtft = 0;
        let latestExpression: string | null = null;
        let previousExpression: string | null = null;
        let lastIsCompleted = true;

        const isResuming = !!existingCharacterText && existingCharacterText.length > 0;

        const filteredMessages = getFilteredTextMessages(data, character.id, allPromptBlocks);
        const knownCharacterNames = detectName(character, filteredMessages);

        const latestMsg = findLatestMessage(data, character)?.message;
        const isToolMessage = latestMsg?.messageType === 'tool';

        const displayContext: DisplayContext = {
            displayMode: data.profile?.toolUsageDisplayMode ?? 'simple',
            placementMode: data.profile?.toolUsageDisplayPlacementMode ?? 'inline',
            participants: data.participants,
            character,
        };

        // Track persistent state across passes
        let resolvedClothingStatuses: Record<string, boolean> = initializeClothingWearingStatuses(character);
        let accumulatedActiveToolActions: ActiveToolActions = latestMsg?.activeToolActions ? { ...latestMsg.activeToolActions } : {};
        let accumulatedPendingActions: PendingToolAction[] = [];
        let accumulatedLockedLocations: Record<string, string[]> = latestMsg?.characterLockedLocations ? { ...latestMsg.characterLockedLocations } : {};
        let accumulatedInventory: Inventory = latestMsg?.inventory ? { ...latestMsg.inventory } : {};

        if (!isResuming) {
            const probeModelId = borrowedModel
                ? borrowedModel.id
                : strat
                    ? ((await getBudgetStrategyEngine().selectModelForRequest({ prompt: '' }, metadata))?.modelId || '')
                    : (selectedModel?.id || '');
            if (probeModelId) {
                try {
                    const probeResult = await buildRequestBody(data, character, knownCharacterNames, '', allPromptBlocks, probeModelId, isToolMessage, toolContext.allRawInteractionDataShells);
                    resolvedClothingStatuses = probeResult.characterClothingWearingStatuses;
                } catch { /* non-critical */ }
            }
        }

        try {
            let currentExistingText = existingCharacterText || '';
            let finalBudgetData: BudgetData | null = null;
            let lastPromptText = '';

            const streamToolParser = new ToolInvocationParser();
            const accState = createTextAccumulationState(currentExistingText);

            const createStreamCallbacks = (
                parser: ToolInvocationParser,
                getAccumulators: () => { 
                    raw: string; 
                    display: string; 
                    setRaw: (v: string) => void; 
                    setDisplay: (v: string) => void; 
                    getLastRawLen: () => number; 
                    setLastRawLen: (v: number) => void;
                    pendingInvocations: ToolInvocation[];
                    addPendingInvocation: (inv: ToolInvocation) => void;
                    clearPendingInvocations: () => void;
                    collectedExecutionResults: ToolExecutionResult[];
                },
                turnAbortCtrl: AbortController,
                baseLength: number,
                displayCtx: DisplayContext
            ): StreamCallbacks => ({
                onToken: async (s) => {
                    latestLatency = s.msPerToken;
                    callbacks?.onLatency(s.msPerToken);

                    if (s.timeToFirstToken > 0) {
                        latestTtft = s.timeToFirstToken;
                        callbacks?.onTimeToFirstToken(s.timeToFirstToken);
                    }

                    const acc = getAccumulators();
                    const lastLen = acc.getLastRawLen();
                    const delta = s.fullText.slice(lastLen);
                    acc.setLastRawLen(s.fullText.length);

                    if (params.voiceTracker) params.voiceTracker.feed(s.fullText);

                    const parsed = parser.processChunk(delta);
                    let newRaw = acc.raw + delta;

                    // Truncate fake hallucinations immediately
                    const hallucinationIdx = newRaw.indexOf(toolResultStartString, baseLength);
                    if (hallucinationIdx !== -1) {
                        newRaw = newRaw.substring(0, hallucinationIdx);
                        acc.setRaw(newRaw);
                        turnAbortCtrl.abort();
                        return;
                    }

                    acc.setRaw(newRaw);

                    // 1. Stop stream immediately upon complete tool call
                    if (parsed.toolInvocations.length > 0) {
                        for (const inv of parsed.toolInvocations) {
                            acc.addPendingInvocation(inv);
                        }
                        turnAbortCtrl.abort();
                        return;
                    }

                    // 2. Compile display text dynamically from raw text adhering to placement mode
                    const compiled = compileMessageDisplayText(
                        newRaw,
                        displayCtx.displayMode,
                        displayCtx.placementMode,
                        displayCtx.participants,
                        displayCtx.character,
                        acc.collectedExecutionResults
                    );
                    acc.setDisplay(compiled);
                    callbacks?.onDisplayText(compiled);

                    const enableExpression = data.profile?.enableCharacterExpression ?? false;
                    if (enableExpression && sentimentEngine.isReady() && s.fullText.length > 20) {
                        const sentiment = await sentimentEngine.analyze(s.fullText);
                        if (sentiment && sentiment.topEmotion !== previousExpression) {
                            previousExpression = sentiment.topEmotion;
                            latestExpression = sentiment.topEmotion;
                            callbacks?.onExpression(sentiment.topEmotion);
                        }
                    }
                },
            });

            // ─── Single Stream Pass Execution Handler ───────────────
            const runSingleStreamPass = async (
                reqBody: Record<string, unknown>,
                isBudget: boolean
            ): Promise<string> => {
                const turnAbortCtrl = new AbortController();
                const onParentAbort = () => turnAbortCtrl.abort();
                signal.addEventListener('abort', onParentAbort, { once: true });

                const baseLength = currentExistingText.length; 
                const streamCallbacks = createStreamCallbacks(streamToolParser, accState.get, turnAbortCtrl, baseLength, displayContext);

                try {
                    let resultText = '';
                    if (isBudget) {
                        const bse = getBudgetStrategyEngine();
                        const streamResult = await bse.generateStream(
                            reqBody,
                            turnAbortCtrl,
                            streamCallbacks,
                            metadata,
                            currentExistingText
                        );
                        resultText = streamResult.text;
                        lastIsCompleted = streamResult.isCompleted;

                        statsDelta.numberOfRequests++;
                        const cachedTokens = streamResult.cachedTokens ?? 0;
                        if (cachedTokens === 0) statsDelta.numberOfCacheInvalidations++;
                    } else {
                        const streamResult = await this.engine.generateStream(
                            reqBody,
                            turnAbortCtrl,
                            {
                                ...streamCallbacks,
                                onFinish: (rs) => {
                                    const promptTokens = rs.promptTokens || 0;
                                    const cachedTokens = rs.cachedTokens ?? 0;
                                    const completionTokens = rs.completionTokens || 0;
                                    const cr = calculateRequestCost(promptTokens, cachedTokens, completionTokens, pricing);
                                    statsDelta.numberOfRequests++;
                                    if (promptTokens > 0 && cachedTokens === 0) statsDelta.numberOfCacheInvalidations++;
                                    statsDelta.totalCost += cr.totalCost;
                                    statsDelta.costWithoutCacheMisses += cr.potentialMaxCost;
                                },
                            },
                            undefined,
                            currentExistingText
                        );
                        resultText = streamResult.text;
                        lastIsCompleted = streamResult.isCompleted;
                    }
                    return resultText;
                } finally {
                    signal.removeEventListener('abort', onParentAbort);
                }
            };

            // ─── Borrowed Model Path ────────────────────────────────
            if (borrowedModel) {
                this.engine.setRunningModels(runningModels);
                this.engine.setContext(borrowedModel);

                const modelId = borrowedModel.id;

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    accState.get().setLastRawLen(0);
                    const { body } = await buildRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId, isToolMessage, toolContext.allRawInteractionDataShells);
                    await runSingleStreamPass(body, false);

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    const dummyTargetMsg = createChatMessage(data, character, '', { 
                        clothingWearingStatuses: resolvedClothingStatuses, 
                        knownCharacterNames,
                        activeToolActions: accumulatedActiveToolActions,
                        pendingToolActions: accumulatedPendingActions,
                        inventory: accumulatedInventory,
                        characterLockedLocations: accumulatedLockedLocations,
                    });

                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, dummyTargetMsg, data, toolContext);
                    if (!toolResult) break;

                    // Preserve state mutations made by tools on dummyTargetMsg across stream passes
                    if (dummyTargetMsg.activeToolActions) accumulatedActiveToolActions = { ...dummyTargetMsg.activeToolActions };
                    if (dummyTargetMsg.pendingToolActions) accumulatedPendingActions = [...dummyTargetMsg.pendingToolActions];
                    if (dummyTargetMsg.characterClothingWearingStatuses) resolvedClothingStatuses = { ...dummyTargetMsg.characterClothingWearingStatuses };
                    if (dummyTargetMsg.characterLockedLocations) accumulatedLockedLocations = { ...dummyTargetMsg.characterLockedLocations };
                    if (dummyTargetMsg.inventory) accumulatedInventory = { ...dummyTargetMsg.inventory };

                    accState.get().addExecutionResults(toolResult.executionResults);

                    applyToolReplacements(accState, toolResult, callbacks, displayContext);

                    if (params.voiceTracker) {
                        params.voiceTracker.resetPass();
                        params.voiceTracker.seed(accState.getRaw());
                    }

                    streamToolParser.reset();
                    accState.clearPending();
                    currentExistingText = accState.getRaw();
                }

            } else if (strat) {
                // ─── Budget Strategy Path ───────────────────────────
                const bse = getBudgetStrategyEngine();
                bse.setStrategy(strat);
                bse.setRunningModels(runningModels);

                let bd: BudgetData | null = bse.getBudgetData();
                if (!bd) {
                    const newBd: BudgetData = { ...defaultBudgetData, budgetStrategy: strat };
                    bse.setBudgetData(newBd);
                    bd = newBd;
                    saveRawBudgetData(newBd).catch(e => console.warn('Failed to save initial budget data:', e));
                }

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    accState.get().setLastRawLen(0);
                    const { body: probeBody } = await buildRequestBody(
                        data, character, knownCharacterNames, currentExistingText, allPromptBlocks, '', isToolMessage, toolContext.allRawInteractionDataShells
                    );
                    let promptText = '';
                    if (typeof probeBody.prompt === 'string') {
                        promptText = probeBody.prompt;
                    } else if (Array.isArray(probeBody.messages)) {
                        promptText = probeBody.messages
                            .map((m: any) => (typeof m.content === 'string' ? m.content : ''))
                            .join('\n');
                    }
                    lastPromptText = promptText;

                    const selection = await bse.selectModelForRequest({ prompt: promptText }, metadata);
                    const activeModelId = selection?.modelId || '';

                    const { body } = await buildRequestBody(
                        data, character, knownCharacterNames, currentExistingText, allPromptBlocks, activeModelId, isToolMessage, toolContext.allRawInteractionDataShells
                    );

                    await runSingleStreamPass(body, true);

                    finalBudgetData = bse.getBudgetData();
                    if (!finalBudgetData) {
                        return { error: { message: 'Failed to get budget data', type: 'budget' } };
                    }
                    await saveRawBudgetData(finalBudgetData);
                    statsDelta.totalCost += (finalBudgetData.budgetSpent - bd.budgetSpent);

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    const dummyTargetMsg = createChatMessage(data, character, '', { 
                        clothingWearingStatuses: resolvedClothingStatuses, 
                        knownCharacterNames,
                        activeToolActions: accumulatedActiveToolActions,
                        pendingToolActions: accumulatedPendingActions,
                        inventory: accumulatedInventory,
                        characterLockedLocations: accumulatedLockedLocations,
                    });

                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, dummyTargetMsg, data, toolContext);
                    if (!toolResult) break;

                    // Preserve state mutations made by tools on dummyTargetMsg across stream passes
                    if (dummyTargetMsg.activeToolActions) accumulatedActiveToolActions = { ...dummyTargetMsg.activeToolActions };
                    if (dummyTargetMsg.pendingToolActions) accumulatedPendingActions = [...dummyTargetMsg.pendingToolActions];
                    if (dummyTargetMsg.characterClothingWearingStatuses) resolvedClothingStatuses = { ...dummyTargetMsg.characterClothingWearingStatuses };
                    if (dummyTargetMsg.characterLockedLocations) accumulatedLockedLocations = { ...dummyTargetMsg.characterLockedLocations };
                    if (dummyTargetMsg.inventory) accumulatedInventory = { ...dummyTargetMsg.inventory };

                    accState.get().addExecutionResults(toolResult.executionResults);

                    applyToolReplacements(accState, toolResult, callbacks, displayContext);

                    if (params.voiceTracker) {
                        params.voiceTracker.resetPass();
                        params.voiceTracker.seed(accState.getRaw());
                    }

                    streamToolParser.reset();
                    accState.clearPending();
                    currentExistingText = accState.getRaw();
                }

            } else {
                // ─── Direct Model Path ──────────────────────────────
                if (!selectedModel) {
                    return { error: { message: 'No model selected', type: 'no_model' } };
                }

                const port = selectedModel.id ? runningModels[selectedModel.id]?.port : undefined;
                const ep = port || (selectedModel.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
                if (!ep && !selectedModel.apiKey) {
                    return { error: { message: 'Model not ready', type: 'no_model' } };
                }

                this.engine.setRunningModels(runningModels);
                this.engine.setContext(selectedModel);

                const modelId = selectedModel.id || '';

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    accState.get().setLastRawLen(0);
                    const { body } = await buildRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId, isToolMessage, toolContext.allRawInteractionDataShells);
                    await runSingleStreamPass(body, false);

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    const dummyTargetMsg = createChatMessage(data, character, '', { 
                        clothingWearingStatuses: resolvedClothingStatuses, 
                        knownCharacterNames,
                        activeToolActions: accumulatedActiveToolActions,
                        pendingToolActions: accumulatedPendingActions,
                        inventory: accumulatedInventory,
                        characterLockedLocations: accumulatedLockedLocations,
                    });

                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, dummyTargetMsg, data, toolContext);
                    if (!toolResult) break;

                    // Preserve state mutations made by tools on dummyTargetMsg across stream passes
                    if (dummyTargetMsg.activeToolActions) accumulatedActiveToolActions = { ...dummyTargetMsg.activeToolActions };
                    if (dummyTargetMsg.pendingToolActions) accumulatedPendingActions = [...dummyTargetMsg.pendingToolActions];
                    if (dummyTargetMsg.characterClothingWearingStatuses) resolvedClothingStatuses = { ...dummyTargetMsg.characterClothingWearingStatuses };
                    if (dummyTargetMsg.characterLockedLocations) accumulatedLockedLocations = { ...dummyTargetMsg.characterLockedLocations };
                    if (dummyTargetMsg.inventory) accumulatedInventory = { ...dummyTargetMsg.inventory };

                    accState.get().addExecutionResults(toolResult.executionResults);

                    applyToolReplacements(accState, toolResult, callbacks, displayContext);

                    if (params.voiceTracker) {
                        params.voiceTracker.resetPass();
                        params.voiceTracker.seed(accState.getRaw());
                    }

                    streamToolParser.reset();
                    accState.clearPending();
                    currentExistingText = accState.getRaw();
                }
            }

            const rawText = accState.getRaw();
            if (!rawText) {
                return { error: { message: 'Empty response from model', type: 'inference' } };
            }

            // Final display text compilation ensures 100% parity with saved message rendering
            const finalDisplayText = compileMessageDisplayText(
                rawText,
                displayContext.displayMode,
                displayContext.placementMode,
                displayContext.participants,
                character,
                accState.get().collectedExecutionResults
            );

            let updatedData: InteractionData;
            const isTool = isToolMessageText(rawText);

            if (isResuming) {
                const allExecutionResults = accState.getCollectedExecutionResults();
                const newHistories = { ...data.interactionHistories };
                for (const [locId, msgs] of Object.entries(newHistories)) {
                    const targetIdx = latestMsg 
                        ? msgs.findIndex(m => m.id === latestMsg.id)
                        : msgs.findIndex(m => m.character.id === character.id && (m.messageType === 'chat' || m.messageType === 'whisper'));
                    if (targetIdx !== -1) {
                        newHistories[locId] = [...msgs];
                        const targetMsg = { ...msgs[targetIdx] } as ChatMessage;
                        if (allExecutionResults.length > 0) {
                            targetMsg.toolExecutionResults = [
                                ...(targetMsg.toolExecutionResults || []),
                                ...allExecutionResults,
                            ];
                        }
                        if (latestExpression) {
                            targetMsg.characterExpression = latestExpression;
                        }
                        if (accumulatedPendingActions.length > 0) {
                            targetMsg.pendingToolActions = [
                                ...(targetMsg.pendingToolActions || []),
                                ...accumulatedPendingActions,
                            ];
                        }
                        if (Object.keys(accumulatedActiveToolActions).length > 0) {
                            targetMsg.activeToolActions = accumulatedActiveToolActions;
                        }
                        if (Object.keys(accumulatedInventory).length > 0) {
                            targetMsg.inventory = accumulatedInventory;
                        }
                        targetMsg.characterClothingWearingStatuses = resolvedClothingStatuses;
                        targetMsg.characterLockedLocations = accumulatedLockedLocations;

                        newHistories[locId][targetIdx] = targetMsg;
                        break;
                    }
                }
                updatedData = { ...data, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
            } else {
                const hasPending = accumulatedPendingActions.length > 0;
                const hasActive = Object.keys(accumulatedActiveToolActions).length > 0;
                const hasInv = Object.keys(accumulatedInventory).length > 0;

                const msg = isTool
                    ? createToolMessage(data, character, rawText, {
                        clothingWearingStatuses: resolvedClothingStatuses,
                        knownCharacterNames,
                        characterLockedLocations: accumulatedLockedLocations,
                        pendingToolActions: hasPending ? accumulatedPendingActions : undefined,
                        activeToolActions: hasActive ? accumulatedActiveToolActions : undefined,
                        inventory: hasInv ? accumulatedInventory : undefined,
                    })
                    : createChatMessage(data, character, rawText, {
                        clothingWearingStatuses: resolvedClothingStatuses,
                        knownCharacterNames,
                        characterLockedLocations: accumulatedLockedLocations,
                        pendingToolActions: hasPending ? accumulatedPendingActions : undefined,
                        activeToolActions: hasActive ? accumulatedActiveToolActions : undefined,
                        inventory: hasInv ? accumulatedInventory : undefined,
                    });

                const allExecutionResults = accState.getCollectedExecutionResults();
                if (allExecutionResults.length > 0) {
                    msg.toolExecutionResults = allExecutionResults;
                }

                if (!isTool) {
                    (msg as ChatMessage).characterExpression = latestExpression ?? undefined;
                }

                const speakerLocationId = getCurrentLocationId(data, character) || 'global';
                updatedData = addMessageToInteractionData(data, msg, speakerLocationId);
            }

            return {
                result: {
                    updatedData,
                    budgetData: finalBudgetData,
                    statsDelta,
                    latencyMsPerToken: latestLatency,
                    timeToFirstTokenMs: latestTtft,
                    expression: latestExpression,
                    rawText: rawText,
                    displayText: finalDisplayText,
                    isCompleted: lastIsCompleted,
                    promptText: lastPromptText,
                },
            };
        } catch (error) {
            console.error('CharacterActor turn execution failed:', error);
            return { error: classifyError(error, signal) };
        }
    }
}