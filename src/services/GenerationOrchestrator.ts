// src/services/GenerationOrchestrator.ts
import type { Character, InteractionData, BudgetStrategy, BudgetData, PromptBlock } from '../types';
import { loadRawBudgetData, saveRawBudgetData } from '../hooks/storage';
import { prepareRequestBody, convertIdsToDisplayNames } from '../hooks/chatLogic';
import { createChatMessage, addMessageToInteractionData } from '../hooks/chatLogic';
import { getBudgetStrategyEngine } from './BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { consumeChatStamina, generateChatStamina, getEffectiveMaximumChatStamina } from '../hooks/characterLogic';
import { findPreviousInteractionMessage } from '../hooks/chatLogic';
import { sentimentEngine } from './SentimentAnalysisEngine';
import { localURL } from '../configurations';
import { getLanguageModelEngine, type LanguageModelContext, type StreamCallbacks } from './LanguageModelEngine';
import { ToolInvocationParser } from './ToolInvocationParser';
import { DefaultBudgetData } from '../defaults';
import { getEffectiveEnableWebSearch, getEffectiveEnableCalculator } from '../hooks/characterLogic';
import { executeTools } from './ToolExecutor';
import { buildModelLoadArguments } from '../hooks/modelLoadArguments';
import { StreamingAccumulator } from './StreamingAccumulator';

// ─── Result Types ────────────────────────────────────────────────────

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

// ─── Internal Utilities ──────────────────────────────────────────────

function regenerateStaminaForTurn(data: InteractionData, character: Character): InteractionData {
    const maxStamina = getEffectiveMaximumChatStamina(character, data.Profile);
    if (maxStamina === Number.POSITIVE_INFINITY) return data;

    const prevMsg = findPreviousInteractionMessage(data, character.id);
    if (!prevMsg) return data;
    if (prevMsg.kind !== 'chat' || prevMsg.remainingChatStamina === undefined || prevMsg.remainingChatStamina >= maxStamina) return data;

    const idx = data.interactionHistory.findIndex(m => m.id === prevMsg.id);
    if (idx === -1) return data;

    generateChatStamina(character, data.interactionHistory[idx]);
    return data;
}

function getDynamicParagraphLimit(char: Character, data: InteractionData): number {
    const max = char.maximumChatStamina ?? 4;
    if (data.participants.filter(p => p.id !== data.protagonist.id).length > 1) return max;
    const prev = [...data.interactionHistory].reverse().find(m => m.character.id === char.id);
    const ratio = Math.max(0, Math.min(1, (prev?.remainingChatStamina ?? max) / max));
    return Math.max(1, Math.round(max * ratio));
}

async function processToolInvocations(
    rawText: string,
    character: Character,
    profile: InteractionData['Profile'],
): Promise<{ resumeText: string; displayText: string; displayReplacements: { type: string; value: string }[] } | null> {
    const webSearchEnabled = getEffectiveEnableWebSearch(character, profile);
    const calculatorEnabled = getEffectiveEnableCalculator(character, profile);

    if (!webSearchEnabled && !calculatorEnabled) return null;

    const parser = new ToolInvocationParser();
    const result = parser.processChunk(rawText);

    if (result.toolInvocations.length === 0) return null;

    const enabledInvocations = result.toolInvocations.filter(inv => {
        if (inv.toolType === 'search') return webSearchEnabled;
        if (inv.toolType === 'calculator') return calculatorEnabled;
        return false;
    });

    if (enabledInvocations.length === 0) return null;

    const toolResults = await executeTools(enabledInvocations);

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
        (m): m is import('../types').ChatMessage => m.character.id === data.protagonist.id && m.kind === 'chat'
    );
    if (lastUserMsg?.files?.length) return lastUserMsg.files;
    return undefined;
}

function classifyError(error: unknown, signal: AbortSignal): TurnError {
    const e = error as Error;
    if (e.name === 'AbortError' || signal.aborted) {
        return { message: 'Aborted', type: 'aborted' };
    }
    const isNet = ['Failed to fetch', 'NetworkError', 'ERR_ABORTED', '502', '503', '504'].some(s => e.message.includes(s));
    if (isNet) {
        return { message: 'Backend Connection Failed', type: 'network' };
    }
    return { message: e.message || 'Unknown inference error', type: 'inference' };
}

// ─── Orchestrator ────────────────────────────────────────────────────

export class GenerationOrchestrator {
    private languageModelEngine = getLanguageModelEngine();

    async executeTurn(params: TurnExecutionParams): Promise<{ result: TurnResult } | { error: TurnError }> {
        const {
            data, character, signal,
            selectedModel, runningModels, activeStrategy,
            strategyOverride, existingCharacterText, allPromptBlocks, callbacks,
        } = params;

        const strat = strategyOverride ?? activeStrategy;
        const pricing: ModelPricing = { cacheHitPerMillion: 0, cacheMissPerMillion: 0, outputPerMillion: 0 };

        const dataWithRegen = regenerateStaminaForTurn(data, character);
        const maxPara = getDynamicParagraphLimit(character, dataWithRegen);
        const protagonistFileBase64s = getProtagonistFileBase64s(dataWithRegen);

        // Determine model ID for per-model summary selection
        const modelId = selectedModel?.id || '';

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

        try {
            let rawText: string;
            let currentExistingText = existingCharacterText || '';
            let accumulatedDisplayText = '';
            let finalBudgetData: BudgetData | null = null;

            // ─── Shared stream callback factory ──────────────────────
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

                    const enableExpression = dataWithRegen.Profile?.enableCharacterExpression ?? false;
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

                // Load or initialize budget data
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

                    const { body } = await prepareRequestBody(dataWithRegen, character, currentExistingText, allPromptBlocks, modelId, protagonistFileBase64s);

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

                    const toolResult = await processToolInvocations(rawText, character, dataWithRegen.Profile);
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

                const lmCtx: LanguageModelContext = {
                    apiKey: selectedModel.apiKey,
                    backend: selectedModel.backend,
                    modelPath: selectedModel.model,
                    runtimePort: ep,
                };

                const streamToolParser = new ToolInvocationParser();
                const accumulator = new StreamingAccumulator();

                const doStream = async (reqBody: Record<string, unknown>, ctx: LanguageModelContext) => {
                    const result = await this.languageModelEngine.generateStream(reqBody, { signal } as AbortController, {
                        ...createStreamCallbacks(streamToolParser, accumulator),
                        onFinish: (rs: { promptTokens?: number; completionTokens?: number; cacheMiss?: boolean }): void => {
                            const cr = calculateRequestCost(rs.promptTokens || 0, rs.completionTokens || 0, rs.cacheMiss || false, pricing);
                            statsDelta.numberOfRequests++;
                            if (rs.cacheMiss) statsDelta.numberOfCacheInvalidations++;
                            statsDelta.totalCost += cr.totalCost;
                            statsDelta.costWithoutCacheMisses += cr.potentialMaxCost;
                        },
                    }, ctx, maxPara);
                    return result.text;
                };

                while (true) {
                    if (signal.aborted) return { error: { message: 'Aborted', type: 'aborted' } };

                    const { body } = await prepareRequestBody(dataWithRegen, character, currentExistingText, allPromptBlocks, modelId, protagonistFileBase64s, ep);
                    rawText = await doStream(body, lmCtx);

                    if ((!rawText || !rawText.trim()) && !signal.aborted) {
                        const rp = selectedModel.id ? runningModels[selectedModel.id]?.port : undefined;
                        const rep = rp || (selectedModel.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
                        const { body: rb } = await prepareRequestBody(dataWithRegen, character, currentExistingText, allPromptBlocks, modelId, protagonistFileBase64s, ep);
                        const rc: LanguageModelContext = { apiKey: selectedModel.apiKey, backend: selectedModel.backend, modelPath: selectedModel.model, runtimePort: rep };
                        rawText = await doStream(rb, rc);
                        if (!rawText || !rawText.trim()) {
                            return { error: { message: 'Empty response from model', type: 'inference' } };
                        }
                    }

                    const toolResult = await processToolInvocations(rawText, character, dataWithRegen.Profile);
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
            const displayText = convertIdsToDisplayNames(finalDisplayText, dataWithRegen);
            const aiMessage = createChatMessage(dataWithRegen, character, displayText);
            const paragraphs = countParagraphs(displayText);
            if (paragraphs > 0) consumeChatStamina(aiMessage, paragraphs);

            const enableExpression = dataWithRegen.Profile?.enableCharacterExpression ?? false;
            if (enableExpression && sentimentEngine.isReady()) {
                const sentiment = await sentimentEngine.analyze(rawText);
                if (sentiment) {
                    aiMessage.characterExpression = sentiment.topEmotion;
                    latestExpression = sentiment.topEmotion;
                }
            }

            const updatedData = addMessageToInteractionData(dataWithRegen, aiMessage);

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
            return { error: classifyError(error, signal) };
        }
    }
}