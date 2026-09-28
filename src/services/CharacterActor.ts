// src/services/CharacterActor.ts
import type { Character, InteractionData, BudgetStrategy, BudgetData, PromptBlock, tool, ChatMessage, LanguageModel, Profile } from '../types';
import { loadRawBudgetData, saveRawBudgetData } from '../storages/serverStorage';
import { buildChatRequestBody, convertIdsToDisplayNames, createChatMessage, addMessageToInteractionData } from '../hooks/chatLogic';
import { detectName } from '../hooks/nameDetection';
import { getFilteredChatMessages } from '../hooks/promptLogic';
import { getBudgetStrategyEngine, type RequestMetadata } from './BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { getEffectiveTools, initializeClothingWearingStatuses } from '../hooks/characterLogic';
import { sentimentEngine } from './SentimentAnalysisEngine';
import { getLanguageModelEngine, type StreamCallbacks } from './LanguageModelEngine';
import { ToolInvocationParser } from './ToolInvocationParser';
import { defaultBudgetData } from '../dictionaries/defaults';
import { executeTools, formatToolDisplay } from './ToolExecutor';
import { StreamingAccumulator } from './StreamingAccumulator';

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
    promptText?: string; // Captured prompt for FM regeneration correction
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
    /** When true, this client is a multiplayer joiner and must not generate locally */
    isMultiplayerClient?: boolean;
    /** Optional borrowed model from a peer for shared language model feature */
    borrowedModel?: LanguageModel | null;
    /** Metadata for FM feature extraction */
    metadata?: RequestMetadata;
}


async function processToolInvocations(
    rawText: string,
    character: Character,
    profile: Profile | undefined,
    nextMessage: ChatMessage,
    interactionData: InteractionData,
): Promise<{ resumeText: string; displayText: string; displayReplacements: { type: string; value: string }[] } | null> {
    const effectiveTools = getEffectiveTools(character, profile);

    const anyToolEnabled = Object.values(effectiveTools).some(v => v);
    if (!anyToolEnabled) return null;

    const parser = new ToolInvocationParser();
    const result = parser.processChunk(rawText);

    if (result.toolInvocations.length === 0) return null;

    const enabledInvocations = result.toolInvocations.filter(inv => {
        const toolName = inv.toolType as tool;
        return effectiveTools[toolName] ?? false;
    });

    if (enabledInvocations.length === 0) return null;

    const displayMode = profile?.toolUsageDisplayMode ?? 'none';
    const toolResults = await executeTools(enabledInvocations, nextMessage, interactionData, undefined, displayMode);

    let resumeText = rawText;
    let displayText = rawText;
    const displayReplacements: { type: string; value: string }[] = [];

    for (let i = 0; i < enabledInvocations.length; i++) {
        const invocation = enabledInvocations[i];
        const toolResult = toolResults[i];
        // resumeText always gets the actual tool result content for continued generation
        resumeText = resumeText.replace(invocation.rawMatch, toolResult.content);

        // Format display based on mode
        const formattedDisplay = formatToolDisplay(toolResult, invocation.rawMatch, displayMode);
        displayText = displayText.replace(invocation.rawMatch, formattedDisplay);
        displayReplacements.push({ type: invocation.toolType, value: formattedDisplay });
    }

    return { resumeText, displayText, displayReplacements };
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

        // Multiplayer clients must never generate locally.
        // Generation is handled exclusively by the host and synced via PeerJS.
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

        // Only create a new message for non-resume turns.
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
                } catch { /* non-critical, keep initializeClothingWearingStatuses fallback */ }
            }
        }

        const aiMessage = isResuming ? null : createChatMessage(data, character, '', {
            clothingWearingStatuses: resolvedClothingStatuses,
            knownCharacterNames,
        });

        try {
            let rawText: string;
            let currentExistingText = existingCharacterText || '';
            let accumulatedDisplayText = '';
            let finalBudgetData: BudgetData | null = null;
            let lastPromptText = ''; // Capture prompt for FM regeneration correction

            const createStreamCallbacks = (
                streamToolParser: ToolInvocationParser,
                accumulator: StreamingAccumulator,
            ): StreamCallbacks => ({
                onToken: async (s) => {
                    latestLatency = s.msPerToken;
                    callbacks?.onLatency(s.msPerToken);

                    if (s.timeToFirstToken > 0) {
                        latestTtft = s.timeToFirstToken;
                        callbacks?.onTimeToFirstToken(s.timeToFirstToken);
                    }

                    const newChunk = s.fullText.slice(accumulator.getLastRawLength());
                    const parsed = streamToolParser.processChunk(newChunk);
                    const displayOut = accumulator.appendChunk(s.fullText, parsed.displayText);

                    callbacks?.onDisplayText(displayOut);

                    const enableExpression = data.Profile?.enableCharacterExpression ?? false;
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

            // ─── Borrowed Model Path (Shared Language Model) ─────────
            if (borrowedModel) {
                this.engine.setRunningModels(runningModels);
                this.engine.setContext(borrowedModel);

                const streamToolParser = new ToolInvocationParser();
                const accumulator = new StreamingAccumulator();

                if (currentExistingText) {
                    accumulator.initializeWithExisting(currentExistingText);
                }

                const doStream = async (reqBody: Record<string, unknown>) => {
                    const result = await this.engine.generateStream(reqBody, { signal } as AbortController, {
                        ...createStreamCallbacks(streamToolParser, accumulator),
                        onFinish: (rs: { promptTokens?: number; completionTokens?: number; cachedTokens?: number }): void => {
                            const promptTokens = rs.promptTokens || 0;
                            const cachedTokens = rs.cachedTokens ?? 0;
                            const completionTokens = rs.completionTokens || 0;
                            const cr = calculateRequestCost(promptTokens, cachedTokens, completionTokens, pricing);
                            statsDelta.numberOfRequests++;
                            if (promptTokens > 0 && cachedTokens === 0) statsDelta.numberOfCacheInvalidations++;
                            statsDelta.totalCost += cr.totalCost;
                            statsDelta.costWithoutCacheMisses += cr.potentialMaxCost;
                        },
                    });
                    lastIsCompleted = result.isCompleted;
                    return result.text;
                };

                const modelId = borrowedModel.id;

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    const { body } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                    rawText = await doStream(body);

                    if ((!rawText || !rawText) && !signal.aborted) {
                        const { body: rb } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                        rawText = await doStream(rb);
                        if (!rawText || !rawText) {
                            return { error: { message: 'Empty response from borrowed model', type: 'inference' } };
                        }
                    }

                    const toolResult = await processToolInvocations(rawText, character, data.Profile, aiMessage!, data);
                    if (!toolResult) {
                        accumulatedDisplayText = accumulator.getDisplayText();
                        break;
                    }

                    accumulator.commitLive();
                    for (const rep of toolResult.displayReplacements) {
                        if (rep.type === 'calculator') accumulator.appendCommitted(rep.value);
                    }
                    callbacks?.onDisplayText(accumulator.getDisplayText());

                    accumulator.resetLive();
                    streamToolParser.reset();
                    currentExistingText = toolResult.resumeText;
                }
            } else if (strat) {
                // ─── Budget Strategy Path ────────────────────────────
                const bse = getBudgetStrategyEngine();
                bse.setStrategy(strat);
                bse.setRunningModels(runningModels);

                let bd: BudgetData | null = finalBudgetData;
                if (!bd) {
                    try { bd = await loadRawBudgetData(); } catch (e) { console.warn('Failed to load budget data:', e); }
                    if (!bd) {
                        const newBd: BudgetData = { ...defaultBudgetData, budgetStrategy: strat };
                        try {
                            await saveRawBudgetData(newBd);
                            bd = newBd;
                        } catch (e) {
                            console.error('Failed to create budget data:', e);
                            return { error: { message: 'Failed to initialize budget tracking', type: 'budget' } };
                        }
                    }
                }
                bse.setBudgetData(bd);

                const streamToolParser = new ToolInvocationParser();
                const accumulator = new StreamingAccumulator();

                if (currentExistingText) {
                    accumulator.initializeWithExisting(currentExistingText);
                }

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    // Build a probe body to extract the raw prompt text for FM feature extraction
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
                    lastPromptText = promptText; // Store for return

                    // Select model with FM metadata
                    const selection = await bse.selectModelForRequest({ prompt: promptText }, metadata);
                    const activeModelId = selection?.modelId || '';

                    const { body } = await buildChatRequestBody(
                        data, character, knownCharacterNames, currentExistingText, allPromptBlocks, activeModelId
                    );

                    const cb = callbacks ? createStreamCallbacks(streamToolParser, accumulator) : undefined;
                    
                    // Generate stream with FM metadata. 
                    // Note: BudgetStrategyEngine internally calls recordOutcome() on success/failure/censorship.
                    const streamResult = await bse.generateStream(body, { signal } as AbortController, cb, metadata);
                    rawText = streamResult.text;
                    lastIsCompleted = streamResult.isCompleted;

                    // Track cache invalidation from stream result cached token count
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

                    const toolResult = await processToolInvocations(rawText, character, data.Profile, aiMessage!, data);
                    if (!toolResult) {
                        accumulatedDisplayText = accumulator.getDisplayText();
                        break;
                    }

                    accumulator.commitLive();
                    for (const rep of toolResult.displayReplacements) {
                        if (rep.type === 'calculator') accumulator.appendCommitted(rep.value);
                    }
                    callbacks?.onDisplayText(accumulator.getDisplayText());

                    accumulator.resetLive();
                    streamToolParser.reset();
                    currentExistingText = toolResult.resumeText;
                }
            } else {
                // ─── Direct Model Path ───────────────────────────────
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

                const streamToolParser = new ToolInvocationParser();
                const accumulator = new StreamingAccumulator();

                if (currentExistingText) {
                    accumulator.initializeWithExisting(currentExistingText);
                }

                const doStream = async (reqBody: Record<string, unknown>) => {
                    const result = await this.engine.generateStream(reqBody, { signal } as AbortController, {
                        ...createStreamCallbacks(streamToolParser, accumulator),
                        onFinish: (rs: { promptTokens?: number; completionTokens?: number; cachedTokens?: number }): void => {
                            const promptTokens = rs.promptTokens || 0;
                            const cachedTokens = rs.cachedTokens ?? 0;
                            const completionTokens = rs.completionTokens || 0;
                            const cr = calculateRequestCost(promptTokens, cachedTokens, completionTokens, pricing);
                            statsDelta.numberOfRequests++;
                            if (promptTokens > 0 && cachedTokens === 0) statsDelta.numberOfCacheInvalidations++;
                            statsDelta.totalCost += cr.totalCost;
                            statsDelta.costWithoutCacheMisses += cr.potentialMaxCost;
                        },
                    });
                    lastIsCompleted = result.isCompleted;
                    return result.text;
                };

                const modelId = selectedModel.id || '';

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    const { body } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                    rawText = await doStream(body);

                    if ((!rawText || !rawText) && !signal.aborted) {
                        const { body: rb } = await buildChatRequestBody(data, character, knownCharacterNames, currentExistingText, allPromptBlocks, modelId);
                        rawText = await doStream(rb);
                        if (!rawText || !rawText) {
                            return { error: { message: 'Empty response from model', type: 'inference' } };
                        }
                    }

                    const toolResult = await processToolInvocations(rawText, character, data.Profile, aiMessage!, data);
                    if (!toolResult) {
                        accumulatedDisplayText = accumulator.getDisplayText();
                        break;
                    }

                    accumulator.commitLive();
                    for (const rep of toolResult.displayReplacements) {
                        if (rep.type === 'calculator') accumulator.appendCommitted(rep.value);
                    }
                    callbacks?.onDisplayText(accumulator.getDisplayText());

                    accumulator.resetLive();
                    streamToolParser.reset();
                    currentExistingText = toolResult.resumeText;
                }
            }

            if (!rawText || !rawText) {
                return { error: { message: 'Empty response from model', type: 'inference' } };
            }

            const finalDisplayText = accumulatedDisplayText || rawText;
            const displayText = convertIdsToDisplayNames(finalDisplayText, data);

            let updatedData: InteractionData;

            if (isResuming) {
                updatedData = data;
            } else {
                // Normal mode: finalize the pre-created message and add to history.
                if (aiMessage) {
                    aiMessage.textContent = displayText;
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
                    displayText,
                    isCompleted: lastIsCompleted,
                    promptText: lastPromptText, // Pass prompt back for FM regeneration correction
                },
            };
        } catch (error) {
            console.log(error);
            return { error: classifyError(error, signal) };
        }
    }
}