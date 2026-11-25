// src/frontend_src/services/CharacterActor.ts
import type { 
    Character, InteractionData, BudgetStrategy, BudgetData, 
    PromptBlock, tool, ChatMessage, LanguageModel, Profile, 
    ToolExecutionResult, toolUsageDisplayMode, toolUsageDisplayPlacementMode,
    WhisperMessage,
    NarrationMessage,
    ToolMessage,
    HistoryMessage
} from '../types';
import { saveRawBudgetData } from '../storages/serverStorage';
import { buildTurnRequestBody, addMessageToInteractionData } from '../utilities/interactionDataLogic';
import { detectName } from '../utilities/nameDetection';
import {
    getFilteredTextMessages,
    detectUnsummarizedLocationDepartures,
    prepareTurnPromptSnapshot,
    type PreparedTurnPromptSnapshot,
    type TurnWorkingState,
    type EphemeralVisualAttachment,
} from '../utilities/promptLogic';
import { getBudgetStrategyEngine, type RequestMetadata } from './BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { getEffectiveTools, initializeClothingWearingStatuses } from '../utilities/characterLogic';
import { sentimentEngine } from './SentimentAnalysisEngine';
import { getLanguageModelEngine, type StreamCallbacks } from './LanguageModelEngine';
import { ToolInvocationParser, type ToolInvocation } from './ToolInvocationParser';
import { defaultBudgetData } from '../dictionaries/defaults';
import { executeTools, formatToolDisplay, type ToolExecutionContext, type ToolResult } from './ToolExecutor';
import { findLatestMessage, createMessage, getMessageById } from '../utilities/messageLogic';
import { getCurrentLocationId } from '../utilities/locationLogic';
import { getGlobalMessageHistory, clearTimelineCache } from '../utilities/timelineLogic';
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
    onRawText?: (rawText: string) => void;
    onLatency: (msPerToken: number) => void;
    onTimeToFirstToken: (ms: number) => void;
    onExpression: (expression: string) => void;
}

export interface TurnExecutionParams {
    data: InteractionData;
    character: Character;
    signal: AbortSignal;
    selectedLanguageModel: LanguageModel | null;
    runningLanguageModels: Record<string, { isRunning: boolean; port?: number }>;
    activeStrategy: BudgetStrategy | null;
    strategyOverride?: BudgetStrategy | null;
    existingCharacterText?: string;
    prefillText?: string;
    allPromptBlocks: PromptBlock[];
    callbacks?: TurnStreamCallbacks;
    isMultiplayerClient?: boolean;
    borrowedModel?: LanguageModel | null;
    metadata?: RequestMetadata;
    toolContext: ToolExecutionContext;
    voiceTracker?: StreamingVoiceTracker;
    resumingMessageId?: string;
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

type ToolCarrierMessage = ChatMessage & {
    _ephemeralVisuals?: EphemeralVisualAttachment[];
};

// ─── Helpers ────────────────────────────────────────────────────────

function hasModelSpecificSummaries(data: InteractionData, modelId: string): boolean {
    if (!modelId) return false;
    for (const msgs of Object.values(data.interactionHistories || {})) {
        for (const msg of msgs) {
            if (msg.messageType === 'chat' || msg.messageType === 'whisper') {
                if (msg.modelTextContentSummaries?.[modelId] || msg.modelInteractionTextContentSummaries?.[modelId]) {
                    return true;
                }
            }
        }
    }
    return false;
}

function extractPromptTextFromBody(body: Record<string, unknown>): string {
    if (typeof body.prompt === 'string') return body.prompt;
    if (Array.isArray(body.messages)) {
        return body.messages
            .map((m: any) => {
                if (typeof m?.content === 'string') return m.content;
                if (Array.isArray(m?.content)) {
                    return m.content
                        .map((part: any) => (part && typeof part === 'object' && part.type === 'text' ? String(part.text || '') : ''))
                        .filter(Boolean)
                        .join('\n');
                }
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }
    return '';
}

// ─── Dual-Text Tool Processing ──────────────────────────────────────

async function processToolInvocations(
    invocations: ToolInvocation[],
    character: Character,
    profile: Profile | undefined,
    targetMessage: ToolCarrierMessage,
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
                textContent: 'Tool is currently disabled',
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
        const rawReplacement = `${rawMatch}${toolResultStartString}result: ${resultText}${toolResultEndString} `;

        let matchIdx = -1;
        let searchStart = 0;
        while (searchStart < currentRaw.length) {
            const idx = currentRaw.indexOf(rawMatch, searchStart);
            if (idx === -1) break;
            const afterIdx = idx + rawMatch.length;
            if (!currentRaw.startsWith(toolResultStartString, afterIdx)) {
                matchIdx = idx;
                break;
            }
            searchStart = afterIdx;
        }

        if (matchIdx !== -1) {
            currentRaw = currentRaw.slice(0, matchIdx) + rawReplacement + currentRaw.slice(matchIdx + rawMatch.length);
        } else {
            currentRaw = currentRaw + rawReplacement;
        }
    }

    acc.setRaw(currentRaw);
    callbacks?.onRawText?.(currentRaw);

    if (displayContext) {
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

// ─── UNCLOSED HALLUCINATION NUKER ───────────────────────────────────

function nukeHallucinatedResults(text: string): string {
    let clean = text;
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
            selectedLanguageModel, runningLanguageModels, activeStrategy,
            strategyOverride, existingCharacterText, prefillText, allPromptBlocks, callbacks,
            isMultiplayerClient, borrowedModel, metadata,
            toolContext,
            resumingMessageId,
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

        const isResuming = Boolean(resumingMessageId || (existingCharacterText && existingCharacterText.length > 0));
        const seedText = existingCharacterText || prefillText || '';

        // ─── CAUSAL SHADOW CONTEXT EXTRACTION ─────────────────────────
        let dataForPrompt = data;
        let shadowCacheId: string | null = null;

        if (resumingMessageId) {
            const globalHistory = getGlobalMessageHistory(data);
            const targetIdx = globalHistory.findIndex(m => m.id === resumingMessageId);

            if (targetIdx !== -1) {
                const validPastIds = new Set(globalHistory.slice(0, targetIdx).map(m => m.id));

                const truncatedHistories: Record<string, HistoryMessage[]> = {};
                for (const [locId, msgs] of Object.entries(data.interactionHistories || {})) {
                    const filtered = msgs.filter(m => validPastIds.has(m.id));
                    if (filtered.length > 0) {
                        truncatedHistories[locId] = filtered;
                    }
                }

                shadowCacheId = `${data.id}__shadow__${resumingMessageId}__${Date.now()}`;
                dataForPrompt = {
                    ...data,
                    id: shadowCacheId,
                    interactionHistories: truncatedHistories,
                    lastUpdatedTimestamp: Date.now(),
                };
            }
        }

        const filteredMessages = getFilteredTextMessages(dataForPrompt, character.id, allPromptBlocks);
        const knownCharacterNames = detectName(character, filteredMessages);

        const latestMsg = resumingMessageId
            ? getMessageById(data, resumingMessageId)?.message
            : findLatestMessage(data, character)?.message;
            
        const isToolMessage = latestMsg?.messageType === 'tool';

        const displayContext: DisplayContext = {
            displayMode: data.profile?.toolUsageDisplayMode ?? 'simple',
            placementMode: data.profile?.toolUsageDisplayPlacementMode ?? 'inline',
            participants: data.participants,
            character,
        };

        const initialFiles =
            latestMsg && (latestMsg.messageType === 'chat' || latestMsg.messageType === 'whisper' || latestMsg.messageType === 'tool') && latestMsg.files
                ? [...latestMsg.files]
                : [];

        const workingState: TurnWorkingState = {
            inventory: latestMsg?.inventory ? { ...latestMsg.inventory } : {},
            activeToolActions: latestMsg?.activeToolActions ? { ...latestMsg.activeToolActions } : {},
            pendingToolActions: [],
            clothingWearingStatuses: latestMsg?.characterClothingWearingStatuses
                ? { ...latestMsg.characterClothingWearingStatuses }
                : initializeClothingWearingStatuses(character),
            lockedLocations: latestMsg?.characterLockedLocations ? { ...latestMsg.characterLockedLocations } : {},
            attachedFiles: initialFiles,
            ephemeralImages: [],
        };

        const isFreshTurn = !existingCharacterText || existingCharacterText.length === 0;
        let hasResolvedClothing = false;

        // Snapshot cache per modelId so tool-call continuation passes never re-run RAG, web fetch, or random rolls.
        const snapshotCache = new Map<string, PreparedTurnPromptSnapshot>();

        const getOrPrepareSnapshot = async (modelId: string): Promise<PreparedTurnPromptSnapshot> => {
            const cached = snapshotCache.get(modelId);
            if (cached) return cached;

            const snapshot = await prepareTurnPromptSnapshot(
                dataForPrompt,
                character,
                knownCharacterNames,
                allPromptBlocks,
                modelId,
                isToolMessage,
                toolContext.allRawInteractionDataShells,
            );

            if (!hasResolvedClothing) {
                if (isFreshTurn) {
                    workingState.clothingWearingStatuses = { ...snapshot.characterClothingWearingStatuses };
                }
                hasResolvedClothing = true;
            }

            snapshotCache.set(modelId, snapshot);
            return snapshot;
        };

        const executeToolsAndSyncState = async (pendingInvs: ToolInvocation[]): Promise<ProcessedReplacements | null> => {
            const dummyTargetMsg = createMessage(character, {
                textContent: '',
                files: [...workingState.attachedFiles],
                clothingWearingStatuses: { ...workingState.clothingWearingStatuses },
                knownCharacterNames,
                activeToolActions: { ...workingState.activeToolActions },
                pendingToolActions: [...workingState.pendingToolActions],
                inventory: { ...workingState.inventory },
                characterLockedLocations: { ...workingState.lockedLocations },
                interactionData: dataForPrompt,
                previousMessage: latestMsg,
            }) as ToolCarrierMessage;

            dummyTargetMsg._ephemeralVisuals = [];

            const prevFilesCount = dummyTargetMsg.files?.length ?? 0;
            const toolResult = await processToolInvocations(
                pendingInvs,
                character,
                data.profile,
                dummyTargetMsg,
                dataForPrompt,
                toolContext,
            );
            if (!toolResult) return null;

            if (dummyTargetMsg.activeToolActions) workingState.activeToolActions = { ...dummyTargetMsg.activeToolActions };
            if (dummyTargetMsg.pendingToolActions) workingState.pendingToolActions = [...dummyTargetMsg.pendingToolActions];
            if (dummyTargetMsg.characterClothingWearingStatuses) workingState.clothingWearingStatuses = { ...dummyTargetMsg.characterClothingWearingStatuses };
            if (dummyTargetMsg.characterLockedLocations) workingState.lockedLocations = { ...dummyTargetMsg.characterLockedLocations };
            if (dummyTargetMsg.inventory) workingState.inventory = { ...dummyTargetMsg.inventory };

            if (dummyTargetMsg.files) {
                workingState.attachedFiles = [...dummyTargetMsg.files];
                if (dummyTargetMsg.files.length > prevFilesCount && (!dummyTargetMsg._ephemeralVisuals || dummyTargetMsg._ephemeralVisuals.length === 0)) {
                    for (const newFile of dummyTargetMsg.files.slice(prevFilesCount)) {
                        workingState.ephemeralImages.push({
                            source: 'user_file',
                            label: 'Tool Attachment',
                            dataUrl: newFile,
                        });
                    }
                }
            }

            if (dummyTargetMsg._ephemeralVisuals && dummyTargetMsg._ephemeralVisuals.length > 0) {
                workingState.ephemeralImages.push(...dummyTargetMsg._ephemeralVisuals);
            }

            return toolResult;
        };

        try {
            let currentExistingText = seedText;
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
                    if (turnAbortCtrl.signal.aborted) return;

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

                    if (parsed.toolInvocations.length > 0) {
                        const lastInv = parsed.toolInvocations[parsed.toolInvocations.length - 1];
                        const lastMatchIdx = newRaw.lastIndexOf(lastInv.rawMatch);
                        if (lastMatchIdx !== -1) {
                            const cutEnd = lastMatchIdx + lastInv.rawMatch.length;
                            const hallucinationBeforeTool = newRaw.indexOf(toolResultStartString, baseLength);
                            if (hallucinationBeforeTool !== -1 && hallucinationBeforeTool < lastMatchIdx) {
                                newRaw = newRaw.substring(0, hallucinationBeforeTool);
                                acc.setRaw(newRaw);
                                callbacks?.onRawText?.(newRaw);
                                turnAbortCtrl.abort();
                                return;
                            }
                            newRaw = newRaw.substring(0, cutEnd);
                        }
                        acc.setRaw(newRaw);
                        callbacks?.onRawText?.(newRaw);

                        const compiledOnTool = compileMessageDisplayText(
                            newRaw,
                            displayCtx.displayMode,
                            displayCtx.placementMode,
                            displayCtx.participants,
                            displayCtx.character,
                            acc.collectedExecutionResults
                        );
                        acc.setDisplay(compiledOnTool);
                        callbacks?.onDisplayText(compiledOnTool);

                        for (const inv of parsed.toolInvocations) {
                            acc.addPendingInvocation(inv);
                        }
                        turnAbortCtrl.abort();
                        return;
                    }

                    const hallucinationIdx = newRaw.indexOf(toolResultStartString, baseLength);
                    if (hallucinationIdx !== -1) {
                        newRaw = newRaw.substring(0, hallucinationIdx);
                        acc.setRaw(newRaw);
                        callbacks?.onRawText?.(newRaw);
                        turnAbortCtrl.abort();
                        return;
                    }

                    acc.setRaw(newRaw);
                    callbacks?.onRawText?.(newRaw);

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
                        sentimentEngine.analyze(s.fullText).then((sentiment) => {
                            if (!signal.aborted && sentiment && sentiment.topEmotion !== previousExpression) {
                                previousExpression = sentiment.topEmotion;
                                latestExpression = sentiment.topEmotion;
                                callbacks?.onExpression(sentiment.topEmotion);
                            }
                        }).catch(() => {});
                    }
                },
            });

            const runSingleStreamPass = async (
                reqBody: Record<string, unknown>,
                isBudget: boolean
            ): Promise<string> => {
                const turnAbortCtrl = new AbortController();
                const onParentAbort = () => turnAbortCtrl.abort();
                signal.addEventListener('abort', onParentAbort, { once: true });

                const baseLength = accState.getRaw().length;
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

            if (borrowedModel) {
                this.engine.setRunningModels(runningLanguageModels);
                this.engine.setContext(borrowedModel);

                const modelId = borrowedModel.id;

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    accState.get().setLastRawLen(0);
                    const snapshot = await getOrPrepareSnapshot(modelId);
                    const { body } = buildTurnRequestBody(snapshot, workingState, currentExistingText);
                    body.session_id = data.id;
                    await runSingleStreamPass(body, false);
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    const toolResult = await executeToolsAndSyncState(pendingInvs);
                    if (!toolResult) break;

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
                const bse = getBudgetStrategyEngine();
                bse.setStrategy(strat);
                bse.setRunningModels(runningLanguageModels);

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

                    const initialSelection = await bse.selectModelForRequest({ prompt: '' }, metadata);
                    const initialModelId = initialSelection?.modelId || '';

                    const initialSnapshot = await getOrPrepareSnapshot(initialModelId);
                    const initialResult = buildTurnRequestBody(initialSnapshot, workingState, currentExistingText);

                    const promptText = extractPromptTextFromBody(initialResult.body);
                    lastPromptText = promptText;

                    const selection = await bse.selectModelForRequest({ prompt: promptText }, metadata);
                    const activeModelId = selection?.modelId || '';

                    const needsRebuild =
                        activeModelId !== initialModelId &&
                        (
                            hasModelSpecificSummaries(dataForPrompt, activeModelId) ||
                            detectUnsummarizedLocationDepartures(dataForPrompt, character, activeModelId).length > 0
                        );

                    const activeSnapshot = needsRebuild
                        ? await getOrPrepareSnapshot(activeModelId)
                        : initialSnapshot;

                    const { body } = needsRebuild
                        ? buildTurnRequestBody(activeSnapshot, workingState, currentExistingText)
                        : initialResult;

                    body.session_id = data.id;

                    await runSingleStreamPass(body, true);
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    finalBudgetData = bse.getBudgetData();
                    if (!finalBudgetData) {
                        return { error: { message: 'Failed to get budget data', type: 'budget' } };
                    }
                    await saveRawBudgetData(finalBudgetData);
                    statsDelta.totalCost += (finalBudgetData.budgetSpent - bd.budgetSpent);

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    const toolResult = await executeToolsAndSyncState(pendingInvs);
                    if (!toolResult) break;

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
                if (!selectedLanguageModel) {
                    return { error: { message: 'No model selected', type: 'no_model' } };
                }

                const port = selectedLanguageModel.id ? runningLanguageModels[selectedLanguageModel.id]?.port : undefined;
                const ep = port || (selectedLanguageModel.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
                if (!ep && !selectedLanguageModel.apiKey) {
                    return { error: { message: 'Model not ready', type: 'no_model' } };
                }

                this.engine.setRunningModels(runningLanguageModels);
                this.engine.setContext(selectedLanguageModel);

                const modelId = selectedLanguageModel.id || '';

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    accState.get().setLastRawLen(0);
                    const snapshot = await getOrPrepareSnapshot(modelId);
                    const { body } = buildTurnRequestBody(snapshot, workingState, currentExistingText);
                    body.session_id = data.id;
                    await runSingleStreamPass(body, false);
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    const toolResult = await executeToolsAndSyncState(pendingInvs);
                    if (!toolResult) break;

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

            if (signal.aborted) {
                return { error: { message: 'Aborted', type: 'aborted' } };
            }

            const rawText = accState.getRaw();
            if (!rawText) {
                return { error: { message: 'Empty response from model', type: 'inference' } };
            }

            const finalDisplayText = compileMessageDisplayText(
                rawText,
                displayContext.displayMode,
                displayContext.placementMode,
                displayContext.participants,
                character,
                accState.get().collectedExecutionResults
            );

            let updatedData: InteractionData;

            if (isResuming) {
                const allExecutionResults = accState.getCollectedExecutionResults();
                const newHistories = { ...data.interactionHistories };
                for (const [locId, msgs] of Object.entries(newHistories)) {
                    const targetIdx = latestMsg 
                        ? msgs.findIndex(m => m.id === latestMsg.id)
                        : -1; 
                        
                    if (targetIdx !== -1) {
                        newHistories[locId] = [...msgs];
                        const targetMsg = { ...msgs[targetIdx] } as ChatMessage | WhisperMessage | ToolMessage | NarrationMessage;
                        targetMsg.textContent = rawText;

                        if (allExecutionResults.length > 0 && targetMsg.messageType !== 'narration') {
                            targetMsg.toolExecutionResults = [
                                ...(targetMsg.toolExecutionResults || []),
                                ...allExecutionResults,
                            ];
                        }
                        if (workingState.attachedFiles.length > 0 && targetMsg.messageType !== 'narration') {
                            targetMsg.files = [...workingState.attachedFiles];
                        }
                        if (latestExpression) {
                            targetMsg.characterExpression = latestExpression;
                        }
                        if (workingState.pendingToolActions.length > 0) {
                            targetMsg.pendingToolActions = [
                                ...(targetMsg.pendingToolActions || []),
                                ...workingState.pendingToolActions,
                            ];
                        }
                        if (Object.keys(workingState.activeToolActions).length > 0) {
                            targetMsg.activeToolActions = workingState.activeToolActions;
                        }
                        if (Object.keys(workingState.inventory).length > 0) {
                            targetMsg.inventory = workingState.inventory;
                        }
                        targetMsg.characterClothingWearingStatuses = workingState.clothingWearingStatuses;
                        targetMsg.characterLockedLocations = workingState.lockedLocations;

                        newHistories[locId][targetIdx] = targetMsg;
                        break;
                    }
                }
                updatedData = { ...data, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
            } else {
                const hasPending = workingState.pendingToolActions.length > 0;
                const hasActive = Object.keys(workingState.activeToolActions).length > 0;
                const hasInv = Object.keys(workingState.inventory).length > 0;
                const allExecutionResults = accState.getCollectedExecutionResults();

                const msg = createMessage(character, {
                    textContent: rawText,
                    files: workingState.attachedFiles.length > 0 ? workingState.attachedFiles : undefined,
                    clothingWearingStatuses: workingState.clothingWearingStatuses,
                    knownCharacterNames,
                    characterLockedLocations: workingState.lockedLocations,
                    pendingToolActions: hasPending ? workingState.pendingToolActions : undefined,
                    activeToolActions: hasActive ? workingState.activeToolActions : undefined,
                    inventory: hasInv ? workingState.inventory : undefined,
                    toolExecutionResults: allExecutionResults.length > 0 ? allExecutionResults : undefined,
                    characterExpression: latestExpression ?? undefined,
                    interactionData: data,
                    previousMessage: latestMsg,
                });

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
        } finally {
            if (shadowCacheId) {
                clearTimelineCache(shadowCacheId);
            }
        }
    }
}