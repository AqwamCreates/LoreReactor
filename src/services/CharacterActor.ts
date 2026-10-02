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
import { executeTools, formatToolDisplay } from './ToolExecutor';

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
}

export interface ProcessedReplacements {
    rawReplacements: { rawMatch: string; resultText: string }[];
    displayReplacements: { rawMatch: string; displayText: string }[];
}

// ─── Spacing Sanitizer ──────────────────────────────────────────────

/**
 * Normalizes Windows line breaks, removes trailing whitespace on blank lines,
 * and collapses any gap larger than \n\n down to a single clean paragraph break.
 */
function cleanSpacing(str: string): string {
    return str
        .replace(/\r\n/g, '\n')             // 1. Normalize CRLF to LF
        .replace(/[ \t]+$/gm, '')           // 2. Strip spaces/tabs on empty lines
        .replace(/\n{3,}/g, '\n\n')         // 3. Collapse 3+ newlines to clean \n\n
        .replace(/^\n+/, '');               // 4. Trim leading blank lines
}

// ─── Dual-Text Tool Processing ──────────────────────────────────────

async function processToolInvocations(
    invocations: ToolInvocation[],
    character: Character,
    profile: Profile | undefined,
    nextMessage: ChatMessage,
    interactionData: InteractionData,
): Promise<ProcessedReplacements | null> {
    if (!invocations || invocations.length === 0) return null;

    const effectiveTools = getEffectiveTools(character, profile);
    const enabledInvocations = invocations.filter(inv => effectiveTools[inv.toolType as tool] ?? false);

    if (enabledInvocations.length === 0) return null;

    const displayMode = profile?.toolUsageDisplayMode ?? 'none';
    const toolResults = await executeTools(enabledInvocations, nextMessage, interactionData, undefined, displayMode);

    const rawReplacements: { rawMatch: string; resultText: string }[] = [];
    const displayReplacements: { rawMatch: string; displayText: string }[] = [];

    for (let i = 0; i < enabledInvocations.length; i++) {
        const toolResult = toolResults[i];
        const inv = enabledInvocations[i];

        // Raw tool result content for LLM continuation
        rawReplacements.push({
            rawMatch: inv.rawMatch,
            resultText: toolResult.content,
        });

        // Display representation for UI layer (returns '' when mode === 'none')
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
    // Keep currentDisplay based on acc.display so raw LLM numbers never bleed into UI
    let currentDisplay = acc.display;

    for (let i = 0; i < replacements.rawReplacements.length; i++) {
        const { rawMatch, resultText } = replacements.rawReplacements[i];
        const { displayText } = replacements.displayReplacements[i];

        // 1. Replace tool invocation in raw text so LLM continuation receives the result
        const rawIdx = currentRaw.indexOf(rawMatch);
        const beforeChar = rawIdx > 0 ? currentRaw[rawIdx - 1] : '';
        const afterChar = currentRaw[rawIdx + rawMatch.length] || '';

        const needsLeadingSpace = beforeChar !== '' && !/\s/.test(beforeChar) && resultText.length > 0;
        const needsTrailingSpace = afterChar !== '' && !/\s|[.,!?;:]/.test(afterChar) && resultText.length > 0;

        const formattedResult = (needsLeadingSpace ? ' ' : '') + resultText + (needsTrailingSpace ? ' ' : '');
        currentRaw = currentRaw.replace(rawMatch, () => formattedResult);

        // 2. In display text: if tool has display content (e.g. badges), insert it; if hidden ('none'), do not inject numbers
        if (displayText !== '') {
            if (currentDisplay.includes(rawMatch)) {
                currentDisplay = currentDisplay.replace(rawMatch, () => displayText);
            } else {
                currentDisplay += (currentDisplay.endsWith(' ') || displayText.startsWith(' ') ? '' : ' ') + displayText;
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
    let lastRawLen = initialText.length;
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

        const aiMessage = isResuming ? null : createChatMessage(data, character, '', {
            clothingWearingStatuses: resolvedClothingStatuses,
            knownCharacterNames,
        });

        try {
            let rawText = '';
            let currentExistingText = existingCharacterText || '';
            let finalBudgetData: BudgetData | null = null;
            let lastPromptText = '';

            const streamToolParser = new ToolInvocationParser();
            const accState = createAccState(currentExistingText);

            // ─── Shared Stream Callback Factory ─────────────────────
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

                    if (parsed.toolInvocations.length > 0) {
                        for (const inv of parsed.toolInvocations) {
                            acc.addPendingInvocation(inv);
                        }
                    }

                    if (parsed.displayText) {
                        const cleaned = cleanSpacing(acc.display + parsed.displayText);
                        acc.setDisplay(cleaned);
                        callbacks?.onDisplayText(cleaned);
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

            // ─── Borrowed Model Path ────────────────────────────────
            if (borrowedModel) {
                this.engine.setRunningModels(runningModels);
                this.engine.setContext(borrowedModel);

                const doStream = async (reqBody: Record<string, unknown>) => {
                    const result = await this.engine.generateStream(
                        reqBody, 
                        { signal } as AbortController, 
                        {
                            ...createStreamCallbacks(streamToolParser, accState.get),
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
                    lastIsCompleted = result.isCompleted;
                    return result.text;
                };

                const modelId = borrowedModel.id;

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    const { body } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                    rawText = await doStream(body);

                    if (!rawText && !signal.aborted) {
                        const { body: rb } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                        rawText = await doStream(rb);
                        if (!rawText) {
                            return { error: { message: 'Empty response from borrowed model', type: 'inference' } };
                        }
                    }

                    const pendingInvs = accState.getPending();
                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, aiMessage!, data);
                    
                    if (!toolResult) break;

                    applyToolReplacements(accState, toolResult, callbacks);

                    streamToolParser.reset();
                    accState.clearPending();
                    accState.get().setLastRawLen(0);
                    currentExistingText = accState.getRaw();
                }
                
                rawText = accState.getRaw();

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

                    const cb = callbacks ? createStreamCallbacks(streamToolParser, accState.get) : undefined;
                    const streamResult = await bse.generateStream(
                        body, 
                        { signal } as AbortController, 
                        cb, 
                        metadata, 
                        currentExistingText
                    );
                    rawText = streamResult.text;
                    lastIsCompleted = streamResult.isCompleted;

                    statsDelta.numberOfRequests++;
                    const cachedTokens = streamResult.cachedTokens ?? 0;
                    if (cachedTokens === 0) statsDelta.numberOfCacheInvalidations++;

                    finalBudgetData = bse.getBudgetData();
                    if (!finalBudgetData) {
                        return { error: { message: 'Failed to get budget data', type: 'budget' } };
                    }
                    await saveRawBudgetData(finalBudgetData);

                    const requestCost = finalBudgetData.budgetSpent - bd.budgetSpent;
                    statsDelta.totalCost += requestCost;

                    const pendingInvs = accState.getPending();
                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, aiMessage!, data);
                    
                    if (!toolResult) break;

                    applyToolReplacements(accState, toolResult, callbacks);

                    streamToolParser.reset();
                    accState.clearPending();
                    accState.get().setLastRawLen(0);
                    currentExistingText = accState.getRaw();
                }
                
                rawText = accState.getRaw();

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

                const doStream = async (reqBody: Record<string, unknown>) => {
                    const result = await this.engine.generateStream(
                        reqBody, 
                        { signal } as AbortController, 
                        {
                            ...createStreamCallbacks(streamToolParser, accState.get),
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
                    lastIsCompleted = result.isCompleted;
                    return result.text;
                };

                const modelId = selectedModel.id || '';

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    const { body } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                    rawText = await doStream(body);

                    if (!rawText && !signal.aborted) {
                        const { body: rb } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                        rawText = await doStream(rb);
                        if (!rawText) {
                            return { error: { message: 'Empty response from model', type: 'inference' } };
                        }
                    }

                    const pendingInvs = accState.getPending();
                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, aiMessage!, data);
                    
                    if (!toolResult) break;

                    applyToolReplacements(accState, toolResult, callbacks);

                    streamToolParser.reset();
                    accState.clearPending();
                    accState.get().setLastRawLen(0);
                    currentExistingText = accState.getRaw();
                }
                
                rawText = accState.getRaw();
            }

            if (!rawText) {
                return { error: { message: 'Empty response from model', type: 'inference' } };
            }

            // Final display text converts display accumulator (guarantees zero tool artifacts or raw numbers in UI)
            const cleanDisplay = cleanSpacing(accState.getDisplay());
            const finalDisplayText = convertIdsToDisplayNames(cleanDisplay, data, character);

            let updatedData: InteractionData;

            if (isResuming) {
                updatedData = data;
            } else {
                if (aiMessage) {
                    aiMessage.textContent = rawText;
                    if (finalDisplayText !== rawText) {
                        aiMessage.processedTextContent = finalDisplayText;
                    }
                    aiMessage.characterExpression = latestExpression ?? undefined;
                    updatedData = addMessageToInteractionData(data, aiMessage);
                } else {
                    updatedData = data;
                }
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
            console.log(error);
            return { error: classifyError(error, signal) };
        }
    }
}