// src/services/CharacterActor.ts
import type { Character, InteractionData, BudgetStrategy, BudgetData, PromptBlock, tool, ChatMessage, LanguageModel, Profile } from '../types';
import { saveRawBudgetData } from '../storages/serverStorage';
import { buildChatRequestBody, convertIdsToDisplayNames, createChatMessage, addMessageToInteractionData } from '../utilities/chatLogic';
import { detectName } from '../utilities/nameDetection';
import { getFilteredChatMessages } from '../utilities/promptLogic';
import { getBudgetStrategyEngine, type RequestMetadata } from './BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { getEffectiveTools, initializeClothingWearingStatuses } from '../utilities/characterLogic';
import { sentimentEngine } from './SentimentAnalysisEngine';
import { getLanguageModelEngine, type StreamCallbacks } from './LanguageModelEngine';
import { ToolInvocationParser, type ToolInvocation } from './ToolInvocationParser';
import { defaultBudgetData } from '../dictionaries/defaults';
import { executeTools, formatToolDisplay, type ToolExecutionContext } from './ToolExecutor';
import { findLatestMessage } from '../utilities/messageLogic';

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
    toolContext?: ToolExecutionContext; // ✅ WIRED
}

export interface ProcessedReplacements {
    rawReplacements: { rawMatch: string; resultText: string }[];
    displayReplacements: { rawMatch: string; displayText: string }[];
}

// ─── Spacing Sanitizer ──────────────────────────────────────────────

function cleanSpacing(str: string): string {
    return str
        .replace(/\r\n/g, '\n')       // 1. Normalize Windows line breaks
        .replace(/\n{3,}/g, '\n\n')   // 2. Collapse 3+ newlines to clean double newlines
        .replace(/^\n+/, '');         // 3. Trim leading blank lines only
}

// ─── Dual-Text Tool Processing ──────────────────────────────────────

async function processToolInvocations(
    invocations: ToolInvocation[],
    character: Character,
    profile: Profile | undefined,
    targetMessage: ChatMessage,
    interactionData: InteractionData,
    context?: ToolExecutionContext, // ✅ WIRED
): Promise<ProcessedReplacements | null> {
    if (!invocations || invocations.length === 0) return null;

    const effectiveTools = getEffectiveTools(character, profile);
    const enabledInvocations = invocations.filter(inv => effectiveTools[inv.toolType as tool] ?? false);

    if (enabledInvocations.length === 0) return null;

    const displayMode = profile?.toolUsageDisplayMode ?? 'none';
    // ✅ PASS context INSTEAD OF undefined
    const toolResults = await executeTools(enabledInvocations, targetMessage, interactionData, context, displayMode);

    const rawReplacements: { rawMatch: string; resultText: string }[] = [];
    const displayReplacements: { rawMatch: string; displayText: string }[] = [];

    for (let i = 0; i < enabledInvocations.length; i++) {
        const toolResult = toolResults[i];
        const inv = enabledInvocations[i];

        rawReplacements.push({
            rawMatch: inv.rawMatch,
            resultText: toolResult.content,
        });

        displayReplacements.push({
            rawMatch: inv.rawMatch,
            displayText: formatToolDisplay(toolResult, inv.rawMatch, displayMode),
        });
    }

    return { rawReplacements, displayReplacements };
}

function applyToolReplacements(
    accState: ReturnType<typeof createAccState>,
    replacements: ProcessedReplacements,
    callbacks?: TurnStreamCallbacks,
): void {
    const acc = accState.get();
    let currentRaw = acc.raw;
    let currentDisplay = acc.display;

    for (let i = 0; i < replacements.rawReplacements.length; i++) {
        const { rawMatch, resultText } = replacements.rawReplacements[i];
        const { displayText } = replacements.displayReplacements[i];

        // 1. Raw prompt context: delimited observation boundary (<|tool()|><|result: ...|>)
        const rawReplacement = `${rawMatch}<|result: ${resultText}|> `;
        if (currentRaw.includes(rawMatch)) {
            currentRaw = currentRaw.replace(rawMatch, rawReplacement);
        } else {
            const trimmedRaw = currentRaw.trimEnd();
            currentRaw = (trimmedRaw ? `${trimmedRaw} ` : '') + rawReplacement;
        }

        // 2. UI Display representation: insert badge cleanly with a single trailing space
        if (displayText !== '') {
            if (currentDisplay.includes(rawMatch)) {
                currentDisplay = currentDisplay.replace(rawMatch, `${displayText} `);
            } else {
                const trimmedDisplay = currentDisplay.trimEnd();
                currentDisplay = (trimmedDisplay ? `${trimmedDisplay} ` : '') + `${displayText} `;
            }
        } else if (currentDisplay.includes(rawMatch)) {
            currentDisplay = currentDisplay.replace(rawMatch, '');
        }
    }

    currentDisplay = cleanSpacing(currentDisplay);
    acc.setRaw(currentRaw);
    acc.setDisplay(currentDisplay);
    callbacks?.onDisplayText(acc.display);
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

function createAccState(initialText: string) {
    let rawAcc = initialText;
    let displayAcc = initialText;
    let lastRawLen = 0;
    let pendingInvs: ToolInvocation[] = [];

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
        }),
        getRaw: () => rawAcc,
        getDisplay: () => displayAcc,
        getPending: () => pendingInvs,
        clearPending: () => { pendingInvs = []; },
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
            toolContext, // ✅ WIRED
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

        const filteredMessages = getFilteredChatMessages(data, character.id, allPromptBlocks);
        const knownCharacterNames = detectName(character, filteredMessages);

        let resolvedClothingStatuses: Record<string, boolean> = initializeClothingWearingStatuses(character);
        if (!isResuming) {
            const probeModelId = borrowedModel
                ? borrowedModel.id
                : strat
                    ? ((await getBudgetStrategyEngine().selectModelForRequest({ prompt: '' }, metadata))?.modelId || '')
                    : (selectedModel?.id || '');
            if (probeModelId) {
                try {
                    const probeResult = await buildChatRequestBody(data, character, knownCharacterNames, '', allPromptBlocks, probeModelId);
                    resolvedClothingStatuses = probeResult.characterClothingWearingStatuses;
                } catch { /* non-critical */ }
            }
        }

        let targetMessage: ChatMessage;
        if (isResuming) {
            const latest = findLatestMessage(data, character);
            targetMessage = (latest?.message && latest.message.messageType === 'chat'
                ? latest.message
                : createChatMessage(data, character, existingCharacterText || '', {
                    clothingWearingStatuses: resolvedClothingStatuses,
                    knownCharacterNames,
                })) as ChatMessage;
        } else {
            targetMessage = createChatMessage(data, character, '', {
                clothingWearingStatuses: resolvedClothingStatuses,
                knownCharacterNames,
            });
        }

        try {
            let currentExistingText = existingCharacterText || '';
            let finalBudgetData: BudgetData | null = null;
            let lastPromptText = '';
            let isFirstChunkAfterTool = false;

            const streamToolParser = new ToolInvocationParser();
            const accState = createAccState(currentExistingText);

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
                },
                turnAbortCtrl: AbortController
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

                    const parsed = parser.processChunk(delta);
                    acc.setRaw(acc.raw + delta);

                    // 1. Flush any text that occurred before the tool call
                    if (parsed.displayText) {
                        let incoming = parsed.displayText;

                        if (isFirstChunkAfterTool) {
                            incoming = incoming.replace(/^[\r\n]+/, '');
                            if (incoming.length > 0) {
                                isFirstChunkAfterTool = false;
                            }
                        }

                        if (incoming.length > 0) {
                            // Prevent double spaces between badge and incoming text
                            if (acc.display.endsWith(' ') && incoming.startsWith(' ')) {
                                incoming = incoming.trimStart();
                            }
                            const cleaned = cleanSpacing(acc.display + incoming);
                            acc.setDisplay(cleaned);
                            callbacks?.onDisplayText(cleaned);
                        }
                    }

                    // 2. Stop stream immediately upon complete tool call
                    if (parsed.toolInvocations.length > 0) {
                        for (const inv of parsed.toolInvocations) {
                            acc.addPendingInvocation(inv);
                        }
                        turnAbortCtrl.abort();
                        return;
                    }

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

                const streamCallbacks = createStreamCallbacks(streamToolParser, accState.get, turnAbortCtrl);

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
                    const { body } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                    await runSingleStreamPass(body, false);

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    // ✅ PASS toolContext
                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, targetMessage, data, toolContext);
                    if (!toolResult) break;

                    applyToolReplacements(accState, toolResult, callbacks);
                    isFirstChunkAfterTool = true;

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
                    const { body: probeBody } = await buildChatRequestBody(
                        data, character, knownCharacterNames, currentExistingText, allPromptBlocks, ''
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

                    const { body } = await buildChatRequestBody(
                        data, character, knownCharacterNames, currentExistingText, allPromptBlocks, activeModelId
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

                    // ✅ PASS toolContext
                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, targetMessage, data, toolContext);
                    if (!toolResult) break;

                    applyToolReplacements(accState, toolResult, callbacks);
                    isFirstChunkAfterTool = true;

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
                    const { body } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                    await runSingleStreamPass(body, false);

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    // ✅ PASS toolContext
                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, targetMessage, data, toolContext);
                    if (!toolResult) break;

                    applyToolReplacements(accState, toolResult, callbacks);
                    isFirstChunkAfterTool = true;

                    streamToolParser.reset();
                    accState.clearPending();
                    currentExistingText = accState.getRaw();
                }
            }

            const rawText = accState.getRaw();
            if (!rawText) {
                return { error: { message: 'Empty response from model', type: 'inference' } };
            }

            const cleanDisplay = cleanSpacing(accState.getDisplay());
            const finalDisplayText = convertIdsToDisplayNames(cleanDisplay, data, character);

            let updatedData: InteractionData;

            if (isResuming) {
                updatedData = data;
            } else {
                targetMessage.textContent = rawText;
                if (finalDisplayText !== rawText) {
                    targetMessage.processedTextContent = finalDisplayText;
                }
                targetMessage.characterExpression = latestExpression ?? undefined;
                updatedData = addMessageToInteractionData(data, targetMessage);
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