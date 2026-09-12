// src/services/CharacterActor.ts
import type { Character, InteractionData, BudgetStrategy, BudgetData, PromptBlock, tool, ChatMessage } from '../types';
import { loadRawBudgetData, saveRawBudgetData } from '../store/storage';
import { prepareRequestBody, convertIdsToDisplayNames, createChatMessage, addMessageToInteractionData, updatePartialMessageInInteractionData } from '../hooks/chatLogic';
import { getBudgetStrategyEngine } from './BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { consumeChatStaminaForMessage, getEffectiveMaximumChatStamina, getEffectiveTools, generateChatStaminaForInteractionData } from '../hooks/characterLogic';
import { sentimentEngine } from './SentimentAnalysisEngine';
import { localURL } from '../configurations';
import { getLanguageModelEngine, type StreamCallbacks } from './LanguageModelEngine';
import { ToolInvocationParser } from './ToolInvocationParser';
import { DefaultBudgetData } from '../defaults';
import { executeTools } from './ToolExecutor';
import { buildModelLoadArguments } from '../hooks/modelLoadArguments';
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
}

export interface TurnError {
    message: string;
    type: 'network' | 'inference' | 'budget' | 'no_model' | 'aborted';
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
    selectedModel: import('../types').LanguageModel | null;
    runningModels: Record<string, { isRunning: boolean; port?: number }>;
    activeStrategy: BudgetStrategy | null;
    strategyOverride?: BudgetStrategy | null;
    existingCharacterText?: string;
    allPromptBlocks: PromptBlock[];
    callbacks?: TurnStreamCallbacks;
}

function getDynamicParagraphLimit(char: Character, data: InteractionData): number {
    const max = getEffectiveMaximumChatStamina(char, data.Profile) ?? 4;
    if (data.participants.filter(p => p.id !== data.protagonist.id).length > 1) return max;
    const prev = [...data.interactionHistory].reverse().find(m => m.character.id === char.id);
    const ratio = Math.max(0, Math.min(1, (prev?.remainingChatStamina ?? max) / max));
    return Math.max(1, Math.round(max * ratio));
}

async function processToolInvocations(
    rawText: string,
    character: Character,
    profile: InteractionData['Profile'],
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

    const toolResults = await executeTools(enabledInvocations, nextMessage, interactionData);

    let resumeText = rawText;
    let displayText = rawText;
    const displayReplacements: { type: string; value: string }[] = [];

    for (let i = 0; i < enabledInvocations.length; i++) {
        const invocation = enabledInvocations[i];
        const toolResult = toolResults[i];
        resumeText = resumeText.replace(invocation.rawMatch, toolResult.content);
        displayText = displayText.replace(invocation.rawMatch, toolResult.displayReplacement);
        displayReplacements.push({ type: invocation.toolType, value: toolResult.displayReplacement });
    }

    return { resumeText, displayText, displayReplacements };
}

function countParagraphs(text: string): number {
    if (!text || !text.trim()) return 0;
    return (text.match(/\n\n/g) || []).length + 1;
}

function getProtagonistFileBase64s(data: InteractionData): string[] | undefined {
    const lastUserMsg = [...data.interactionHistory].reverse().find(
        (m): m is import('../types').ChatMessage => m.character.id === data.protagonist.id && m.messageType === 'chat'
    );
    if (lastUserMsg?.files?.length) return lastUserMsg.files;
    return undefined;
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
        } = params;

        const strat = strategyOverride ?? activeStrategy;
        const pricing: ModelPricing = { cacheHitPerMillion: 0, cacheMissPerMillion: 0, outputPerMillion: 0 };

        generateChatStaminaForInteractionData(data, character);
        const maxPara = getDynamicParagraphLimit(character, data);
        const protagonistFileBase64s = getProtagonistFileBase64s(data);

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

        // Create the message upfront so tool executors can mutate it (inventory, audio, etc.)
        const aiMessage = createChatMessage(data, character, '');

        try {
            let rawText: string;
            let currentExistingText = existingCharacterText || '';
            let accumulatedDisplayText = '';
            let finalBudgetData: BudgetData | null = null;

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

            if (strat) {
                // ─── Budget Strategy Path ────────────────────────────
                const loadLocalModel = async (modelId: string): Promise<number | null> => {
                    const existing = runningModels[modelId];
                    if (existing?.port) return existing.port;

                    const targetModel = strat.localModels.find(m => m.id === modelId) || strat.onlineModels.find(m => m.id === modelId);
                    if (!targetModel) return null;
                    if (targetModel.apiKey && targetModel.backend) return null;

                    try {
                        const modelPath = targetModel.model || '';
                        const args = buildModelLoadArguments(targetModel);

                        const response = await fetch(`${localURL}/models/load`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: targetModel.id, modelPath, args }),
                        });

                        if (response.ok) {
                            const responseData = await response.json();
                            return responseData.port ?? null;
                        }
                    } catch (e) {
                        console.warn(`Auto-load of model ${targetModel.name} failed:`, e);
                    }
                    return null;
                };

                const bse = getBudgetStrategyEngine();
                bse.setStrategy(strat);
                bse.setRunningModels(runningModels);
                bse.setLoadLocalModel(loadLocalModel);

                let bd: BudgetData | null = finalBudgetData;
                if (!bd) {
                    try { bd = await loadRawBudgetData(); } catch (e) { console.warn('Failed to load budget data:', e); }
                    if (!bd) {
                        const newBd: BudgetData = { ...DefaultBudgetData, budgetStrategy: strat };
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

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    const selection = await bse.selectModelForRequest({ prompt: '' });
                    const activeModelId = selection?.modelId || '';

                    const { body } = await prepareRequestBody(data, character, currentExistingText, allPromptBlocks, activeModelId, protagonistFileBase64s);

                    const cb = callbacks ? createStreamCallbacks(streamToolParser, accumulator) : undefined;
                    rawText = await bse.generateStream(body, { signal } as AbortController, cb);

                    finalBudgetData = bse.getBudgetData();
                    if (!finalBudgetData) {
                        return { error: { message: 'Failed to get budget data', type: 'budget' } };
                    }
                    await saveRawBudgetData(finalBudgetData);

                    const requestCost = finalBudgetData.budgetSpent - bd.budgetSpent;
                    if (requestCost > 0) statsDelta.numberOfRequests++;
                    statsDelta.totalCost += requestCost;

                    const toolResult = await processToolInvocations(rawText, character, data.Profile, aiMessage, data);
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

                const doStream = async (reqBody: Record<string, unknown>) => {
                    const result = await this.engine.generateStream(reqBody, { signal } as AbortController, {
                        ...createStreamCallbacks(streamToolParser, accumulator),
                        onFinish: (rs: { promptTokens?: number; completionTokens?: number; cacheMiss?: boolean }): void => {
                            const cr = calculateRequestCost(rs.promptTokens || 0, rs.completionTokens || 0, rs.cacheMiss || false, pricing);
                            statsDelta.numberOfRequests++;
                            if (rs.cacheMiss) statsDelta.numberOfCacheInvalidations++;
                            statsDelta.totalCost += cr.totalCost;
                            statsDelta.costWithoutCacheMisses += cr.potentialMaxCost;
                        },
                    }, maxPara);
                    return result.text;
                };

                const modelId = selectedModel.id || '';

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    const { body } = await prepareRequestBody(data, character, currentExistingText, allPromptBlocks, modelId, protagonistFileBase64s);
                    rawText = await doStream(body);

                    if ((!rawText || !rawText.trim()) && !signal.aborted) {
                        const { body: rb } = await prepareRequestBody(data, character, currentExistingText, allPromptBlocks, modelId, protagonistFileBase64s);
                        rawText = await doStream(rb);
                        if (!rawText || !rawText.trim()) {
                            return { error: { message: 'Empty response from model', type: 'inference' } };
                        }
                    }

                    const toolResult = await processToolInvocations(rawText, character, data.Profile, aiMessage, data);
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

            if (!rawText || !rawText.trim()) {
                return { error: { message: 'Empty response from model', type: 'inference' } };
            }

            const finalDisplayText = accumulatedDisplayText || rawText;
            const displayText = convertIdsToDisplayNames(finalDisplayText, data);

            // Finalize the message with the completed text
            aiMessage.textContent = displayText;
            const paragraphs = countParagraphs(displayText);
            if (paragraphs > 0) consumeChatStaminaForMessage(aiMessage, paragraphs);

            const enableExpression = data.Profile?.enableCharacterExpression ?? false;
            if (enableExpression && sentimentEngine.isReady()) {
                const sentiment = await sentimentEngine.analyze(rawText);
                if (sentiment) {
                    aiMessage.characterExpression = sentiment.topEmotion;
                    latestExpression = sentiment.topEmotion;
                }
            }

            let updatedData: InteractionData;

            if (existingCharacterText) {
                // Resume mode: update existing partial message via helper
                updatedData = updatePartialMessageInInteractionData(
                    data,
                    character.id,
                    displayText,
                    aiMessage.characterExpression ?? undefined,
                );
                // Fallback: no partial message found, add as new
                if (updatedData === data) {
                    updatedData = addMessageToInteractionData(data, aiMessage);
                }
            } else {
                // Normal mode: add new message
                updatedData = addMessageToInteractionData(data, aiMessage);
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
                },
            };
        } catch (error) {
            console.log(error);
            return { error: classifyError(error, signal) };
        }
    }
}