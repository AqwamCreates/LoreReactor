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
import { findLatestMessage } from '../utilities/messageLogic';

const MAX_TOOL_ITERATIONS = 5;

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

function cleanSpacing(str: string): string {
    return str
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+/, '');
}

// ─── Dual-Text Tool Processing ──────────────────────────────────────

async function processToolInvocations(
    invocations: ToolInvocation[],
    character: Character,
    profile: Profile | undefined,
    targetMessage: ChatMessage,
    interactionData: InteractionData,
): Promise<ProcessedReplacements | null> {
    if (!invocations || invocations.length === 0) return null;

    const effectiveTools = getEffectiveTools(character, profile);
    const enabledInvocations = invocations.filter(inv => effectiveTools[inv.toolType as tool] ?? false);

    if (enabledInvocations.length === 0) return null;

    const displayMode = profile?.toolUsageDisplayMode ?? 'none';
    const toolResults = await executeTools(enabledInvocations, targetMessage, interactionData, undefined, displayMode);

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

        // 1. Clean dangling markdown opening delimiters (`, *, _, [) right before the tool invocation in raw context
        let rawIdx = currentRaw.indexOf(rawMatch);
        if (rawIdx > 0) {
            const prevChar = currentRaw[rawIdx - 1];
            if (prevChar === '`' || prevChar === '*' || prevChar === '_' || prevChar === '[') {
                currentRaw = currentRaw.slice(0, rawIdx - 1) + currentRaw.slice(rawIdx);
                rawIdx--;
            }
        }

        // Format tool result as an unambiguous observation for the model's continuation
        const formattedResult = ` [Result: ${resultText}] `;
        if (rawIdx !== -1) {
            currentRaw = currentRaw.slice(0, rawIdx) + formattedResult + currentRaw.slice(rawIdx + rawMatch.length);
        } else {
            currentRaw += formattedResult;
        }

        // 2. Clean dangling markdown opening delimiters from the display accumulator as well
        const displayIdx = currentDisplay.indexOf(rawMatch);
        if (displayIdx !== -1) {
            const beforeDisplay = currentDisplay.slice(0, displayIdx);
            const cleanBefore = beforeDisplay.replace(/[`*_\[\s]+$/, '');
            currentDisplay = cleanBefore + (displayText !== '' ? ` ${displayText} ` : ' ') + currentDisplay.slice(displayIdx + rawMatch.length);
        } else {
            const cleanDisplay = currentDisplay.replace(/[`*_\[\s]+$/, '');
            currentDisplay = cleanDisplay + (displayText !== '' ? ` ${displayText} ` : ' ');
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

            const streamToolParser = new ToolInvocationParser();
            const accState = createAccState(currentExistingText);

            // Stream callbacks that abort active token generation immediately upon encountering a completed tool call
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

                    if (parsed.toolInvocations.length > 0) {
                        for (const inv of parsed.toolInvocations) {
                            acc.addPendingInvocation(inv);
                        }
                        // Interrupt active generation pass at the end of the tool invocation
                        turnAbortCtrl.abort();
                        return;
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

            // ─── Single Stream Execution Handler ────────────────────
            const runSingleStreamPass = async (
                reqBody: Record<string, unknown>,
                isBudget: boolean,
                activeModelId?: string
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
                let iteration = 0;

                while (iteration++ < MAX_TOOL_ITERATIONS) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    accState.get().setLastRawLen(0);
                    const { body } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                    await runSingleStreamPass(body, false);

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, targetMessage, data);
                    if (!toolResult) break;

                    applyToolReplacements(accState, toolResult, callbacks);

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

                let iteration = 0;

                while (iteration++ < MAX_TOOL_ITERATIONS) {
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

                    await runSingleStreamPass(body, true, activeModelId);

                    finalBudgetData = bse.getBudgetData();
                    if (!finalBudgetData) {
                        return { error: { message: 'Failed to get budget data', type: 'budget' } };
                    }
                    await saveRawBudgetData(finalBudgetData);
                    statsDelta.totalCost += (finalBudgetData.budgetSpent - bd.budgetSpent);

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, targetMessage, data);
                    if (!toolResult) break;

                    applyToolReplacements(accState, toolResult, callbacks);

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
                let iteration = 0;

                while (iteration++ < MAX_TOOL_ITERATIONS) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    accState.get().setLastRawLen(0);
                    const { body } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                    await runSingleStreamPass(body, false);

                    const pendingInvs = accState.getPending();
                    if (pendingInvs.length === 0) break;

                    const toolResult = await processToolInvocations(pendingInvs, character, data.profile, targetMessage, data);
                    if (!toolResult) break;

                    applyToolReplacements(accState, toolResult, callbacks);

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