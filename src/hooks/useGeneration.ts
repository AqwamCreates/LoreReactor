// src/hooks/useGeneration.ts
import { useCallback } from 'react';
import type { Character, InteractionData } from '../types';
import { loadRawBudgetData, saveRawBudgetData } from './storage';
import { prepareRequestBody, convertIdsToDisplayNames } from './chatLogic';
import { createChatMessage, addMessageToInteractionData } from './chatLogic';
import { BudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { consumeChatStamina, generateChatStamina, getEffectiveMaximumChatStamina } from './characterLogic';
import { findPreviousInteractionMessage } from './chatLogic';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { localURL } from '../configurations';
import { LanguageModelEngine, type LanguageModelContext, type StreamCallbacks } from '../services/LanguageModelEngine';
import { ToolInvocationParser } from '../services/ToolInvocationParser';
import { DefaultBudgetData } from '../defaults';
import { useSessionStore } from '../store/useSessionStore';
import { getEffectiveEnableWebSearch, getEffectiveEnableCalculator } from './characterLogic';
import { executeTools } from '../services/ToolExecutor'

const languageModelEngine = new LanguageModelEngine();

// ─── Shared Utilities ────────────────────────────────────────────────

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

// ─── Hook ────────────────────────────────────────────────────────────

interface UseGenerationOptions {
    setBudgetData: (bd: import('../types').BudgetData) => void;
    setStats: React.Dispatch<React.SetStateAction<{ numberOfCacheInvalidations: number; numberOfRequests: number; totalCost: number; costWithoutCacheMisses: number }>>;
    setGenerationSpeed: (speed: number) => void;
    setTimeToFirstToken: (ttft: number) => void;
    setCurrentCharacterExpression: (expr: string) => void;
    previousExpressionRef: React.MutableRefObject<string>;
    throttledSetStreamingText: (text: string) => void;
    streamingTextRef: React.MutableRefObject<string>;
    processMemoryTrigger: (rawText: string, character: Character, data: InteractionData) => Promise<void>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useGeneration(options: UseGenerationOptions) {
    const {
        setBudgetData, setStats, setGenerationSpeed, setTimeToFirstToken,
        setCurrentCharacterExpression, previousExpressionRef,
        throttledSetStreamingText, streamingTextRef,
        processMemoryTrigger, addToast,
    } = options;

    const handleServerResponse = useCallback(async (
        data: InteractionData, character: Character, signal: AbortSignal,
        onToken?: (text: string) => void,
        strategyOverride?: import('../types').BudgetStrategy | null,
        existingCharacterText?: string,
    ): Promise<InteractionData | null> => {
        const pricing: ModelPricing = { cacheHitPerMillion: 0, cacheMissPerMillion: 0, outputPerMillion: 0 };
        const model = useSessionStore.getState().selectedModel;
        const running = useSessionStore.getState().runningModels;
        const strat = strategyOverride ?? useSessionStore.getState().activeStrategy;

        const dataWithRegen = regenerateStaminaForTurn(data, character);
        const maxPara = getDynamicParagraphLimit(character, dataWithRegen);

        try {
            let rawText: string;
            let currentExistingText = existingCharacterText || '';
            let accumulatedDisplayText = '';

            // ─── Shared stream callback factory ──────────────────────
            const createStreamCallbacks = (
                streamToolParser: ToolInvocationParser,
                committedDisplayText: { value: string },
                liveDisplayText: { value: string },
                lastRawLength: { value: number },
            ): StreamCallbacks => ({
                onToken: async (s) => {
                    setGenerationSpeed(s.msPerToken);
                    if (s.timeToFirstToken > 0) setTimeToFirstToken(s.timeToFirstToken);

                    const newChunk = s.fullText.slice(lastRawLength.value);
                    lastRawLength.value = s.fullText.length;
                    const parsed = streamToolParser.processChunk(newChunk);
                    liveDisplayText.value += parsed.displayText;

                    const displayOut = committedDisplayText.value + liveDisplayText.value;
                    streamingTextRef.current = displayOut;
                    throttledSetStreamingText(displayOut);
                    onToken?.(displayOut);

                    const enableExpression = dataWithRegen.Profile?.enableCharacterExpression ?? false;
                    if (enableExpression && sentimentEngine.isReady() && s.fullText.length > 20) {
                        const sentiment = await sentimentEngine.analyze(s.fullText);
                        if (sentiment && sentiment.topEmotion !== previousExpressionRef.current) {
                            previousExpressionRef.current = sentiment.topEmotion;
                            setCurrentCharacterExpression(sentiment.topEmotion);
                        }
                    }
                },
            });

            if (strat) {
                // ─── Budget Strategy Path ────────────────────────────
                const loadLocalModel = async (modelId: string): Promise<number | null> => {
                    const currentRunning = useSessionStore.getState().runningModels;
                    const existing = currentRunning[modelId];
                    if (existing?.port) return existing.port;

                    const targetModel = strat.localModels.find(m => m.id === modelId) || strat.onlineModels.find(m => m.id === modelId);
                    if (!targetModel) return null;
                    if (targetModel.apiKey && targetModel.backend) return null;

                    try {
                        const modelPath = targetModel.model || '';
                        const params = targetModel.parameters || {};
                        const args: string[] = ['-c', targetModel.contextLength.toString()];
                        const ngl = params.gpu_layers !== undefined ? Number(params.gpu_layers) : 99;
                        args.push('-ngl', String(ngl));
                        if (targetModel.mmproj) args.push('--mmproj', String(targetModel.mmproj).trim());
                        if (targetModel.lora) args.push('--lora', String(targetModel.lora).trim());
                        if (params.cache_type_k) args.push('-ctk', String(params.cache_type_k));
                        if (params.cache_type_v) args.push('-ctv', String(params.cache_type_v));
                        if (params.batch_size && Number(params.batch_size) !== 1024) args.push('-b', String(params.batch_size));
                        if (params.ubatch_size && Number(params.ubatch_size) !== 1024) args.push('-ub', String(params.ubatch_size));
                        if (params.threads && Number(params.threads) > 0) args.push('-t', String(params.threads));
                        const extraFlags = params.extra_flags ? String(params.extra_flags).trim() : '';
                        if (extraFlags) args.push(...extraFlags.split(/\s+/));

                        const res = await fetch(`${localURL}/models/load`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: targetModel.id, modelPath, args }),
                        });

                        if (res.ok) {
                            const responseData = await res.json();
                            return responseData.port ?? null;
                        }
                    } catch (e) {
                        console.warn(`Auto-load of model ${targetModel.name} failed:`, e);
                    }
                    return null;
                };

                const streamToolParser = new ToolInvocationParser();
                const committedDisplayText = { value: '' };
                const liveDisplayText = { value: '' };
                const lastRawLength = { value: 0 };

                while (true) {
                    if (signal.aborted) return null;

                    let bd = useSessionStore.getState().budgetData;
                    if (!bd) {
                        try { bd = await loadRawBudgetData(); } catch (e) { console.warn('Failed to load budget data:', e); }
                        if (!bd) {
                            bd = { ...DefaultBudgetData, budgetStrategy: strat };
                            try {
                                await saveRawBudgetData(bd);
                                setBudgetData(bd);
                                addToast('Budget tracking initialized with daily reset.', 'info');
                            } catch (e) {
                                console.error('Failed to create budget data:', e);
                                addToast('Failed to initialize budget tracking.', 'error');
                                return null;
                            }
                        } else {
                            setBudgetData(bd);
                        }
                    }

                    const bse = new BudgetStrategyEngine(strat, bd, running, loadLocalModel);
                    const cb = onToken ? createStreamCallbacks(streamToolParser, committedDisplayText, liveDisplayText, lastRawLength) : undefined;
                    rawText = await bse.generateStream(dataWithRegen, character, { signal } as AbortController, cb);

                    const updatedBd = bse.getBudgetData();
                    setBudgetData(updatedBd);
                    await saveRawBudgetData(updatedBd);

                    const requestCost = updatedBd.budgetSpent - bd.budgetSpent;
                    if (requestCost > 0) setStats(p => ({ ...p, numberOfRequests: p.numberOfRequests + 1, totalCost: p.totalCost + requestCost }));

                    const toolResult = await processToolInvocations(rawText, character, dataWithRegen.Profile);
                    if (!toolResult) {
                        accumulatedDisplayText = committedDisplayText.value + liveDisplayText.value;
                        break;
                    }

                    committedDisplayText.value += liveDisplayText.value;
                    for (const rep of toolResult.displayReplacements) {
                        if (rep.type === 'calculator') committedDisplayText.value += rep.value;
                    }
                    throttledSetStreamingText(committedDisplayText.value);
                    onToken?.(committedDisplayText.value);

                    liveDisplayText.value = '';
                    streamToolParser.reset();
                    currentExistingText = toolResult.resumeText;
                    lastRawLength.value = 0;
                }
            } else {
                // ─── Direct Model Path ───────────────────────────────
                if (!model) { if (!signal.aborted) addToast('No model selected.', 'error'); return null; }
                const port = model.id ? running[model.id]?.port : undefined;
                const ep = port || (model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
                if (!ep && !model.apiKey) { if (!signal.aborted) addToast('Model not ready.', 'error'); return null; }

                const lmCtx: LanguageModelContext = { apiKey: model.apiKey, backend: model.backend, modelPath: model.model, runtimePort: ep };

                const streamToolParser = new ToolInvocationParser();
                const committedDisplayText = { value: '' };
                const liveDisplayText = { value: '' };
                const lastRawLength = { value: 0 };

                const doStream = async (reqBody: Record<string, unknown>, ctx: LanguageModelContext) => {
                    const result = await languageModelEngine.generateStream(reqBody, { signal } as AbortController, {
                        ...createStreamCallbacks(streamToolParser, committedDisplayText, liveDisplayText, lastRawLength),
                        onFinish: (rs: { promptTokens?: number; completionTokens?: number; cacheMiss?: boolean }): void => {
                            const cr = calculateRequestCost(rs.promptTokens || 0, rs.completionTokens || 0, rs.cacheMiss || false, pricing);
                            setStats(p => ({ ...p, numberOfRequests: p.numberOfRequests + 1, numberOfCacheInvalidations: p.numberOfCacheInvalidations + (rs.cacheMiss ? 1 : 0), totalCost: p.totalCost + cr.totalCost, costWithoutCacheMisses: p.costWithoutCacheMisses + cr.potentialMaxCost }));
                        },
                    }, ctx, maxPara);
                    return result.text;
                };

                while (true) {
                    if (signal.aborted) return null;

                    const { body } = await prepareRequestBody(dataWithRegen, character, currentExistingText, ep);
                    rawText = await doStream(body, lmCtx);

                    if ((!rawText || !rawText.trim()) && !signal.aborted) {
                        const currentRunning = useSessionStore.getState().runningModels;
                        const rp = model.id ? currentRunning[model.id]?.port : undefined;
                        const rep = rp || (model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
                        const { body: rb } = await prepareRequestBody(dataWithRegen, character, currentExistingText, ep);
                        const rc: LanguageModelContext = { apiKey: model.apiKey, backend: model.backend, modelPath: model.model, runtimePort: rep };
                        rawText = await doStream(rb, rc);
                        if (!rawText || !rawText.trim()) return null;
                    }

                    const toolResult = await processToolInvocations(rawText, character, dataWithRegen.Profile);
                    if (!toolResult) {
                        accumulatedDisplayText = committedDisplayText.value + liveDisplayText.value;
                        break;
                    }

                    committedDisplayText.value += liveDisplayText.value;
                    for (const rep of toolResult.displayReplacements) {
                        if (rep.type === 'calculator') committedDisplayText.value += rep.value;
                    }
                    throttledSetStreamingText(committedDisplayText.value);
                    onToken?.(committedDisplayText.value);

                    liveDisplayText.value = '';
                    streamToolParser.reset();
                    currentExistingText = toolResult.resumeText;
                    lastRawLength.value = 0;
                }
            }

            if (!rawText || !rawText.trim()) return null;

            await processMemoryTrigger(rawText, character, dataWithRegen);

            const finalDisplayText = accumulatedDisplayText || rawText;
            const displayText = convertIdsToDisplayNames(finalDisplayText, dataWithRegen);
            const aiMessage = createChatMessage(dataWithRegen, character, displayText);
            const paragraphs = countParagraphs(displayText);
            if (paragraphs > 0) consumeChatStamina(aiMessage, paragraphs);

            const enableExpression = dataWithRegen.Profile?.enableCharacterExpression ?? false;
            if (enableExpression && sentimentEngine.isReady()) {
                const sentiment = await sentimentEngine.analyze(rawText);
                if (sentiment) aiMessage.characterExpression = sentiment.topEmotion;
            }

            return addMessageToInteractionData(dataWithRegen, aiMessage);
        } catch (err) {
            const e = err as Error;
            if (e.name === 'AbortError') return null;
            const isNet = ['Failed to fetch', 'NetworkError', 'ERR_ABORTED', '502', '503', '504'].some(s => e.message.includes(s));
            if (isNet) { if (!signal.aborted) addToast('⚠️ Backend Connection Failed.', 'error'); return null; }
            console.error('Inference failed:', e);
            if (!signal.aborted) addToast(`Inference Error: ${e.message}`, 'error');
            return null;
        }
    }, [
        setBudgetData, setStats, setGenerationSpeed, setTimeToFirstToken,
        setCurrentCharacterExpression, previousExpressionRef,
        throttledSetStreamingText, streamingTextRef,
        processMemoryTrigger, addToast,
    ]);

    return { handleServerResponse };
}