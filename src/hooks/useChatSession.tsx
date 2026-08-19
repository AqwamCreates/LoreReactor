// src/hooks/useChatSession.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Character, ChatData, ChatMessage, BudgetStrategy, LanguageModel } from '../types';
import { saveRawChatData, loadAllRawChatData, deleteRawChatMessage, getCharacterImageUrl, getCharacterVoiceUrl } from './storage';
import { createChatMessage, addMessageToChatData, convertIdsToDisplayNames, createNewChatData, prepareRequestBody } from './chatLogic';
import { runTurnSequence } from '../services/ChatOrchestrator';
import { BudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { generateMissingSummaries, generatePeriodicCompression, checkTriggerThreshold, generateRecursiveSummary } from '../services/ChatMessageSummarizationEngine';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../context/ToastContext';
import { localAddress, localURL } from '../configurations';

import { LanguageModelEngine, estimateTokens, type LanguageModelContext, type StreamCallbacks } from '../services/LanguageModelEngine';
import { TextToSpeechModelEngine, type TextToSpeedLanguageModelContext } from '../services/TextToSpeechModelEngine';
import { clearPartialFlag } from './messageLogic';

const languageModelEngine = new LanguageModelEngine();
const textToSpeechModelEngine = new TextToSpeechModelEngine();

const now = Date.now();

const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

const AMBIENT_NARRATOR: Character = {
    id: '__ambient_narrator__',
    name: '',
    description: 'Ambient environment narration',
    systemPrompt: '',
    initiativeWeight: 0,
    chatProbability: 1,
    maximumChatStamina: 1,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
};

const AMBIENT_POOL: { keywords: string[]; lines: string[] }[] = [
    {
        keywords: ['hello', 'hi', 'hey', 'greet', 'good morning', 'good evening', 'good night', 'howdy', 'yo', '?'],
        lines: [
            "A tentative quiet hangs in the air, waiting to be shaped.",
            "The space between them hums with the possibility of conversation.",
            "Words hover at the edge of silence, not yet committed.",
            "The air shifts subtly, acknowledging a presence.",
            "Something stirs in the stillness — an opening.",
            "The moment balances on the edge of beginning.",
        ]
    },
    {
        keywords: ['night', 'dark', 'moon', 'star', 'midnight', 'dusk', 'evening', 'twilight'],
        lines: [
            "Crickets hum softly beyond the walls.",
            "The darkness outside presses gently against the windows.",
            "A cool night breeze carries distant sounds through the stillness.",
            "Moonlight traces pale shapes across the floor.",
            "The night holds its breath around them.",
            "Somewhere outside, an owl calls once and falls silent.",
        ]
    },
    {
        keywords: ['morning', 'dawn', 'sunrise', 'sun', 'daybreak', 'early'],
        lines: [
            "Pale light filters through the gaps in the curtains.",
            "Birdsong drifts in from somewhere far away.",
            "The first warmth of morning touches the edges of the room.",
            "Dew-laden air seeps through the cracks, fresh and quiet.",
            "The world outside is just beginning to stir.",
        ]
    },
    {
        keywords: ['rain', 'storm', 'thunder', 'lightning', 'pouring', 'drizzle', 'wet'],
        lines: [
            "Rain taps a steady rhythm against the glass.",
            "Thunder rumbles low and distant, then fades.",
            "Water streaks down the windows in silver threads.",
            "The storm mutters to itself beyond the walls.",
            "Each raindrop sounds impossibly loud in the quiet.",
        ]
    },
    {
        keywords: ['room', 'inside', 'indoors', 'house', 'hall', 'chamber', 'apartment'],
        lines: [
            "The room settles into its own particular silence.",
            "Dust motes drift lazily through a shaft of light.",
            "The walls seem to absorb the quiet, holding it close.",
            "Something in the room creaks softly, then stills.",
            "The space between them feels measured and deliberate.",
        ]
    },
    {
        keywords: ['outside', 'garden', 'forest', 'tree', 'wind', 'grass', 'field', 'path'],
        lines: [
            "Leaves rustle in a wind that carries no warmth.",
            "Branches sway overhead in slow, patient arcs.",
            "The outdoors hums with a life that doesn't need words.",
            "Grass bends and rises in waves of quiet motion.",
            "The horizon holds still, watching.",
        ]
    },
    {
        keywords: ['footstep', 'walk', 'pace', 'approach', 'tread', 'floorboard'],
        lines: [
            "Footsteps echo faintly, then stop.",
            "The floor groans under shifting weight somewhere nearby.",
            "A measured tread passes and fades into distance.",
            "Each step lands carefully, as if the walker doesn't want to be heard.",
        ]
    },
    {
        keywords: ['creak', 'groan', 'settle', 'shift', 'wood', 'old'],
        lines: [
            "Wood settles with a long, patient sigh.",
            "Something old shifts its weight and goes still again.",
            "A creak rises and dissolves into the silence.",
            "The structure around them breathes in its own slow way.",
        ]
    },
    {
        keywords: ['fire', 'flame', 'hearth', 'warm', 'candle', 'ember', 'glow'],
        lines: [
            "Embers pop softly, casting brief orange light.",
            "The fire murmurs to itself in a language of heat.",
            "Warmth radiates outward in gentle, invisible waves.",
            "A candle flickers though nothing has moved the air.",
        ]
    },
    {
        keywords: ['water', 'river', 'sea', 'ocean', 'wave', 'stream', 'lake', 'shore'],
        lines: [
            "Water moves endlessly in the distance, indifferent and constant.",
            "Waves fold over themselves in a rhythm older than memory.",
            "The sound of water fills the silence without breaking it.",
            "Current pulls at something unseen beneath the surface.",
        ]
    },
    {
        keywords: ['crowd', 'people', 'voices', 'busy', 'market', 'street', 'city'],
        lines: [
            "Distant voices blur into a murmur that means nothing.",
            "Life continues somewhere else, oblivious.",
            "The noise of others fades to a hum, then less than a hum.",
            "Footsteps pass without stopping, belonging to strangers.",
        ]
    },
    {
        keywords: ['cold', 'frost', 'ice', 'snow', 'winter', 'freeze', 'chill'],
        lines: [
            "Cold seeps in through places you can't quite find.",
            "Frost crystals form silently on the other side of the glass.",
            "The air bites at exposed skin, patient and persistent.",
            "Ice shifts somewhere with a sound like a whisper.",
        ]
    },
    {
        keywords: ['book', 'page', 'read', 'paper', 'library', 'shelf', 'ink'],
        lines: [
            "Pages settle against each other with a papery sigh.",
            "The weight of unread words hangs quietly in the air.",
            "Ink and paper hold their stories in patient silence.",
            "A book lies open, waiting for eyes that have looked away.",
        ]
    },
];

const AMBIENT_FALLBACK = [
    "A heavy silence settles over everything.",
    "The air grows still, thick with unspoken words.",
    "Quiet stretches between them like a held breath.",
    "The moment lingers, neither comfortable nor cruel.",
    "Stillness fills the space where words should be.",
    "Time seems to slow in the absence of sound.",
    "The pause grows teeth.",
    "Nothing moves. Nothing breaks the stillness.",
    "The silence has a texture now, rough and unresolved.",
    "A beat passes. Then another.",
];

function getDefaultCharacter(): Character {
    const now = Date.now();
    return {
        id: 'default-user',
        name: 'User',
        description: 'Default user character',
        systemPrompt: '',
        initiativeWeight: 1,
        chatProbability: 0.5,
        maximumChatStamina: 5,
        sampler: {
            id: 'default-sampler',
            name: 'Default',
            parameters: { temperature: 0.7, top_p: 0.9 },
            stopPatterns: [],
            maximumNumberOfTokens: 256,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

async function runBackgroundSummarization(
    data: ChatData,
    setData: (d: ChatData) => void,
    dataRef: React.MutableRefObject<ChatData | null>,
    modelRef: React.MutableRefObject<LanguageModel | null>,
    runningModelsRef: React.MutableRefObject<Record<string, { isRunning: boolean; port?: number }>>,
    addToast: (message: string, type: 'success' | 'error' | 'info') => void
): Promise<void> {
    try {
        const modelCtxLen = modelRef.current?.contextLength || 8192;
        const currentTokens = data.chatMessageHistory.reduce(
            (acc, m) => acc + estimateTokens(m.textContent), 0
        );
        const triggered = checkTriggerThreshold(data, currentTokens, modelCtxLen);

        if (!triggered) return;

        addToast(`Running ${triggered.strategyType}...`, "info");

        const port = modelRef.current?.id
            ? runningModelsRef.current[modelRef.current.id]?.port
            : undefined;
        const effectivePort = port || (modelRef.current?.parameters as any)?._runtimePort;

        const LanguageModelContext: LanguageModelContext = {
            apiKey: modelRef.current?.apiKey,
            backend: modelRef.current?.backend,
            modelPath: modelRef.current?.model,
            runtimePort: effectivePort,
        };

        if (!effectivePort && !modelRef.current?.apiKey) return;

        let updatedData = data;

        if (triggered.strategyType === 'Sliding Window Replace' && triggered.slidingWindowSize) {
            const budgetStep = data.Profile?.summarizationSteps?.find(
                s => s.strategyType === 'Sliding Window Replace' && s.enabled
            );
            const summaryBudget = budgetStep?.summaryTokenBudget ?? 256;

            const summaries = await generateMissingSummaries(
                updatedData,
                triggered.slidingWindowSize,
                LanguageModelContext,
                summaryBudget
            );

            if (summaries.size > 0) {
                updatedData = {
                    ...updatedData,
                    chatMessageHistory: updatedData.chatMessageHistory.map(m => {
                        const summary = summaries.get(m.id);
                        if (summary) return { ...m, textContentSummary: summary };
                        return m;
                    }),
                };
            }
        }

        if (triggered.strategyType === 'Periodic Compression' && triggered.compressionInterval && triggered.compressionChunkSize) {
            const budgetStep = data.Profile?.summarizationSteps?.find(
                s => s.strategyType === 'Periodic Compression' && s.enabled
            );
            const summaryBudget = budgetStep?.summaryTokenBudget ?? 512;

            const newContexts = await generatePeriodicCompression(
                updatedData,
                triggered.compressionInterval,
                triggered.compressionChunkSize,
                LanguageModelContext,
                summaryBudget
            );

            if (newContexts.length > 0) {
                const existingContexts = updatedData.contexts || [];
                updatedData = {
                    ...updatedData,
                    contexts: [...existingContexts, ...newContexts],
                };
            }
        }

        if (triggered.strategyType === 'Recursive Summary' && triggered.recursiveChunkSize && triggered.recursiveMaxDepth) {
            const budgetStep = data.Profile?.summarizationSteps?.find(
                s => s.strategyType === 'Recursive Summary' && s.enabled
            );
            const summaryBudget = budgetStep?.summaryTokenBudget ?? 1024;

            const newContexts = await generateRecursiveSummary(
                updatedData,
                triggered.recursiveChunkSize,
                triggered.recursiveMaxDepth,
                LanguageModelContext,
                summaryBudget
            );

            if (newContexts.length > 0) {
                const existingContexts = updatedData.contexts || [];
                updatedData = {
                    ...updatedData,
                    contexts: [...existingContexts, ...newContexts],
                };
            }
        }

        if (updatedData !== data) {
            await saveRawChatData(updatedData);
            setData(updatedData);
            dataRef.current = updatedData;

            const newSummaries = triggered.strategyType === 'Sliding Window Replace'
                ? updatedData.chatMessageHistory.filter(m => m.textContentSummary).length - data.chatMessageHistory.filter(m => m.textContentSummary).length
                : 0;
            const newContexts = (triggered.strategyType === 'Periodic Compression' || triggered.strategyType === 'Recursive Summary')
                ? (updatedData.contexts?.length ?? 0) - (data.contexts?.length ?? 0)
                : 0;

            if (newSummaries > 0) {
                addToast(`Summarized ${newSummaries} message${newSummaries !== 1 ? 's' : ''}`, "success");
            } else if (newContexts > 0) {
                addToast(`Generated ${newContexts} context${newContexts !== 1 ? 's' : ''} (${triggered.strategyType})`, "success");
            } else {
                addToast(`${triggered.strategyType} complete`, "info");
            }
        } else {
            addToast(`${triggered.strategyType} complete`, "info");
        }
    } catch (err) {
        console.warn('Background summarization failed:', err);
        addToast(`Summarization failed: ${(err as Error).message}`, "error");
    }
}

export function useChatSession() {
    const [chatData, setChatData] = useState<ChatData | null>(null);
    const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [streamingCharacter, setStreamingCharacter] = useState<Character | null>(null);
    const [isInitialImageProcessed, setIsInitialImageProcessed] = useState(false);
    const [generationSpeed, setGenerationSpeed] = useState<number>(0);
    const [parentChatMessageIds, setParentChatMessageIds] = useState<Set<string>>(new Set());

    const [activeStrategy, setActiveStrategy] = useState<BudgetStrategy | null>(null);
    const [selectedModel, setSelectedModel] = useState<LanguageModel | null>(null);

    const [runningModelsMap, setRunningModelsMap] = useState<Record<string, { isRunning: boolean; port?: number }>>({});

    const [stats, setStats] = useState({
        numberOfCacheInvalidations: 0,
        numberOfRequests: 0,
        totalCost: 0,
        costWithoutCacheMisses: 0,
    });

    const abortControllerRef = useRef<AbortController | null>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    
    const selectedModelRef = useRef<LanguageModel | null>(null);
    const runningModelsMapRef = useRef<Record<string, { isRunning: boolean; port?: number }>>({});
    const activeStrategyRef = useRef<BudgetStrategy | null>(null);
    const isLoadingRef = useRef(false);
    const isProcessingSilentlyRef = useRef(false);

    const streamingTextRef = useRef("");
    const streamingCharacterRef = useRef<Character | null>(null);
    const chatDataRef = useRef<ChatData | null>(null);

    // ✅ Tracks text captured when generation is interrupted (stop, error, network failure).
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);

    // ✅ Track whether user is scrolled to bottom — only auto-scroll when at bottom
    const isAtBottomRef = useRef(true);

    const uploadedTtsVoicesRef = useRef<Set<string>>(new Set());

    // ✅ FIX #1: 30fps throttled streaming text updates
    const STREAMING_THROTTLE_MS = 60;
    const lastFlushRef = useRef(0);
    const pendingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingStreamingTextRef = useRef("");
    
    useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
    useEffect(() => { runningModelsMapRef.current = runningModelsMap; }, [runningModelsMap]);
    useEffect(() => { activeStrategyRef.current = activeStrategy; }, [activeStrategy]);
    useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
    useEffect(() => { streamingTextRef.current = streamingText; }, [streamingText]);
    useEffect(() => { streamingCharacterRef.current = streamingCharacter; }, [streamingCharacter]);
    useEffect(() => { chatDataRef.current = chatData; }, [chatData]);
    
    const { addToast } = useToast();

    const [ttsServerUrl] = useState<string>(`${localAddress}:7860`);

    useEffect(() => {
        const fetchRunningModels = async () => {
            try {
                const res = await fetch(`${localURL}/models/status`);
                if (!res.ok) return;
                const data = await res.json();
                const status: Record<string, { isRunning: boolean; port?: number }> = {};
                for (const m of data.activeModels || []) {
                    status[m.id] = { isRunning: true, port: m.port };
                }
                setRunningModelsMap(status);
            } catch {
                // Server not ready yet
            }
        };
        fetchRunningModels();
    }, []);

    const isModelReadyForGeneration = useCallback((): boolean => {
        const model = selectedModelRef.current;
        if (!model) return false;
        if (model.apiKey) return true;
        const models = runningModelsMapRef.current;
        return !!(model.id && models[model.id]?.port);
    }, []);

    const acquireGenerationLock = useCallback((): boolean => {
        if (isLoadingRef.current) return false;
        isLoadingRef.current = true;
        setIsLoading(true);
        return true;
    }, []);

    // ✅ FIX #1: Cancel any pending flush timeout on lock release
    const releaseGenerationLock = useCallback(() => {
        isLoadingRef.current = false;
        setIsLoading(false);
        setStreamingText("");
        setStreamingCharacter(null);
        streamingTextRef.current = "";
        streamingCharacterRef.current = null;
        pendingStreamingTextRef.current = "";
        lastFlushRef.current = 0;
        if (pendingFlushRef.current) {
            clearTimeout(pendingFlushRef.current);
            pendingFlushRef.current = null;
        }
    }, []);

    // ✅ FIX #1: Throttled streaming text setter — caps React re-renders to ~30fps
    const setStreamingTextThrottled = useCallback((text: string) => {
        streamingTextRef.current = text;
        pendingStreamingTextRef.current = text;

        const now = performance.now();
        const elapsed = now - lastFlushRef.current;

        if (elapsed >= STREAMING_THROTTLE_MS) {
            lastFlushRef.current = now;
            setStreamingText(text);
        } else if (!pendingFlushRef.current) {
            pendingFlushRef.current = setTimeout(() => {
                lastFlushRef.current = performance.now();
                setStreamingText(pendingStreamingTextRef.current);
                pendingFlushRef.current = null;
            }, STREAMING_THROTTLE_MS - elapsed);
        }
    }, []);

    const speakMessage = useCallback((text: string, character: Character) => {
        if (!character.voice) return;

        const profile = chatDataRef.current?.Profile;
        if (profile) {
            let filteredParts: string[] = [];

            if (profile.narrateNormalText !== false) {
                let normal = text;
                normal = normal.replace(/"[^"]*"|'[^']*'/g, '');
                normal = normal.replace(/\*\*[^*]+\*\*/g, '');
                normal = normal.replace(/\*[^*]+\*/g, '');
                const trimmed = normal.trim();
                if (trimmed) filteredParts.push(trimmed);
            }

            if (profile.narrateQuotedText) {
                const matches = text.match(/"[^"]*"|'[^']*'/g);
                if (matches) filteredParts.push(matches.map(m => m.replace(/^["']|["']$/g, '')).join(' '));
            }

            if (profile.narrateBoldedText) {
                const matches = text.match(/\*\*[^*]+\*\*/g);
                if (matches) filteredParts.push(matches.map(m => m.replace(/\*\*/g, '')).join(' '));
            }

            if (profile.narrateItalicizedText) {
                const matches = text.match(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g);
                if (matches) filteredParts.push(matches.map(m => m.replace(/\*/g, '')).join(' '));
            }

            const filteredText = filteredParts.join(' ').trim();
            if (!filteredText) return;
            text = filteredText;
        }

        (async () => {
            try {
                const ttsContext: TextToSpeedLanguageModelContext = {
                    serverUrl: ttsServerUrl || undefined,
                    backend: 'Qwen3-TTS',
                };

                const voiceLabel = character.id; 

                if (!uploadedTtsVoicesRef.current.has(voiceLabel)) {
                    const voiceUrl = getCharacterVoiceUrl(character.voice);
                    if (!voiceUrl) return;

                    const res = await fetch(voiceUrl);
                    if (!res.ok) return;

                    const blob = await res.blob();
                    const file = new File([blob], `${voiceLabel}.wav`, { type: blob.type || 'audio/wav' });

                    const uploaded = await textToSpeechModelEngine.uploadVoice(voiceLabel, file, ttsContext);
                    if (!uploaded) return;

                    uploadedTtsVoicesRef.current.add(voiceLabel);
                }

                await new Promise(resolve => setTimeout(resolve, 500)); 

                const blob = await textToSpeechModelEngine.synthesize(text, ttsContext, {
                    voice: voiceLabel, 
                });

                if (blob) {
                    const audioUrl = URL.createObjectURL(blob);
                    const audio = new Audio(audioUrl);
                    audio.onended = () => URL.revokeObjectURL(audioUrl);
                    audio.play().catch(e => console.warn('TTS playback failed:', e));
                }
            } catch (e) {
                console.warn('TTS speak failed:', e);
            }
        })();
    }, [ttsServerUrl]);

    const getImageBase64 = async (url: string): Promise<string | null> => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.error(`Failed to convert image: ${url}`, error);
            return null;
        }
    };

    const getDynamicParagraphLimit = useCallback((character: Character, data: ChatData): number => {
        const maxStamina = character.maximumChatStamina ?? 4;
        const aiParticipants = data.participants.filter(p => p.id !== data.protagonist.id);
        if (aiParticipants.length > 1) return maxStamina;
        const prevMsg = data.chatMessageHistory.length > 0 
            ? [...data.chatMessageHistory].reverse().find(m => m.character.id === character.id)
            : null;
        const currentStamina = prevMsg?.remainingChatStamina ?? maxStamina;
        const ratio = Math.max(0, Math.min(1, currentStamina / maxStamina));
        return Math.max(1, Math.round(maxStamina * ratio));
    }, []);

    const generateAmbientNarration = useCallback(async (data: ChatData, _signal: AbortSignal): Promise<ChatData | null> => {
        const recentText = data.chatMessageHistory
            .filter(m => m.character.id !== '__ambient_narrator__')
            .slice(-8)
            .map(m => m.textContent.toLowerCase())
            .join(' ');

        let bestCategory: typeof AMBIENT_POOL[0] | null = null;
        let bestScore = 0;

        for (const category of AMBIENT_POOL) {
            let score = 0;
            for (const keyword of category.keywords) {
                if (recentText.includes(keyword)) score++;
            }
            if (score > bestScore) {
                bestScore = score;
                bestCategory = category;
            }
        }

        const pool = bestCategory ? bestCategory.lines : AMBIENT_FALLBACK;

        const recentAmbient = data.chatMessageHistory
            .filter(m => m.character.id === '__ambient_narrator__')
            .slice(-3)
            .map(m => m.textContent);

        const available = pool.filter(line => !recentAmbient.includes(line));
        const finalPool = available.length > 0 ? available : pool;
        const selected = finalPool[Math.floor(Math.random() * finalPool.length)];

        setStreamingCharacter(AMBIENT_NARRATOR);
        streamingCharacterRef.current = AMBIENT_NARRATOR;
        setStreamingText("");
        streamingTextRef.current = "";

        const chars = selected.split('');
        for (let i = 0; i < chars.length; i++) {
            const partial = selected.substring(0, i + 1);
            streamingTextRef.current = partial;
            setStreamingText(partial);
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        const ambientMessage = createChatMessage(data, AMBIENT_NARRATOR, selected);
        return addMessageToChatData(data, ambientMessage);
    }, []);

    const handleServerResponse = useCallback(async (
        data: ChatData, 
        character: Character, 
        signal: AbortSignal, 
        onToken?: (text: string) => void,
        userImagesBase64?: string[],
        strategy?: BudgetStrategy | null,
        complexityScore?: number
    ): Promise<ChatData | null> => {
        
        let imageData: string | null = null;
        if (character.image) {
            const url = getCharacterImageUrl(character.image);
            if (url) imageData = await getImageBase64(url);
        }

        const pricing: ModelPricing = {
            cacheHitPerMillion: 0, 
            cacheMissPerMillion: 0, 
            outputPerMillion: 0
        };

        const currentModel = selectedModelRef.current;
        const currentRunningModels = runningModelsMapRef.current;
        const currentStrategy = strategy ?? activeStrategyRef.current;

        const maxParagraphs = getDynamicParagraphLimit(character, data);

        try {
            let rawText: string;

            if (currentStrategy) {
                const strategyEngine = new BudgetStrategyEngine(currentStrategy);
                
                const wrappedCallbacks: StreamCallbacks | undefined = onToken ? {
                    onToken: (stats) => {
                        setGenerationSpeed(stats.msPerToken);
                        streamingTextRef.current = stats.fullText;
                        onToken(stats.fullText);
                    }
                } : undefined;

                rawText = await strategyEngine.generateStream(
                    data, 
                    character, 
                    { signal } as AbortController, 
                    wrappedCallbacks, 
                    userImagesBase64,
                    complexityScore
                );

                if (strategyEngine.currentCost > 0) {
                    setStats(prev => ({
                        ...prev,
                        numberOfRequests: prev.numberOfRequests + 1,
                        totalCost: prev.totalCost + strategyEngine.currentCost,
                    }));
                }

            } else {
                if (!currentModel) {
                    if (!signal.aborted) {
                        addToast("No model selected. Please select a model from the Models list.", "error");
                    }
                    return null;
                }

                const runtimePort = currentModel?.id 
                    ? currentRunningModels[currentModel.id]?.port 
                    : undefined;
                
                const effectivePort = runtimePort || (currentModel.parameters as any)?._runtimePort;
                
                if (!effectivePort && !currentModel.apiKey) {
                    if (!signal.aborted) {
                        addToast("Model is not ready yet. Please wait.", "error");
                    }
                    return null;
                }

                const { body: requestBody } = await prepareRequestBody(data, character, imageData, userImagesBase64, effectivePort);
                
                const LanguageModelContext: LanguageModelContext = {
                    apiKey: currentModel.apiKey,
                    backend: currentModel.backend,
                    modelPath: currentModel.model,
                    runtimePort: effectivePort
                };

                rawText = await languageModelEngine.generateStream(
                    requestBody,
                    { signal } as AbortController,
                    {
                        onToken: (stats) => {
                            setGenerationSpeed(stats.msPerToken);
                            // ✅ FIX #1: Use throttled setter instead of direct state update
                            setStreamingTextThrottled(stats.fullText);
                            if (onToken) onToken(stats.fullText);
                        },
                        onFinish: (responseStats) => {
                            const promptTokens = responseStats.promptTokens || 0;
                            const completionTokens = responseStats.completionTokens || 0;
                            const isCacheMiss = responseStats.cacheMiss || false;
                            const costResult = calculateRequestCost(promptTokens, completionTokens, isCacheMiss, pricing);

                            setStats(prev => ({
                                numberOfRequests: prev.numberOfRequests + 1,
                                numberOfCacheInvalidations: prev.numberOfCacheInvalidations + (isCacheMiss ? 1 : 0),
                                totalCost: prev.totalCost + costResult.totalCost,
                                costWithoutCacheMisses: prev.costWithoutCacheMisses + costResult.potentialMaxCost,
                            }));
                        }
                    },
                    LanguageModelContext,
                    maxParagraphs
                );
            }
            
            if (!rawText || !rawText.trim()) {
                if (!signal.aborted) {
                    if (currentStrategy) {
                         addToast("All models failed according to budget strategy.", "error");
                    } else if (currentModel) {
                         const retryRuntimePort = currentModel.id ? currentRunningModels[currentModel.id]?.port : undefined;
                         const retryEffectivePort = retryRuntimePort || (currentModel.parameters as any)?._runtimePort;
                         
                         const { body: retryRequestBody } = await prepareRequestBody(data, character, imageData, userImagesBase64, retryEffectivePort);
                         
                         const retryLanguageModelContext: LanguageModelContext = {
                             apiKey: currentModel.apiKey,
                             backend: currentModel.backend,
                             modelPath: currentModel.model,
                             runtimePort: retryEffectivePort
                         };
                         rawText = await languageModelEngine.generateStream(
                             retryRequestBody,
                             { signal } as AbortController,
                             {
                                 onToken: (stats) => {
                                     setGenerationSpeed(stats.msPerToken);
                                     // ✅ FIX #1: Use throttled setter for retry path too
                                     setStreamingTextThrottled(stats.fullText);
                                     if (onToken) onToken(stats.fullText);
                                 },
                                 onFinish: (responseStats) => {
                                     const promptTokens = responseStats.promptTokens || 0;
                                     const completionTokens = responseStats.completionTokens || 0;
                                     const isCacheMiss = responseStats.cacheMiss || false;
                                     const costResult = calculateRequestCost(promptTokens, completionTokens, isCacheMiss, pricing);
                                     setStats(prev => ({
                                         numberOfRequests: prev.numberOfRequests + 1,
                                         numberOfCacheInvalidations: prev.numberOfCacheInvalidations + (isCacheMiss ? 1 : 0),
                                         totalCost: prev.totalCost + costResult.totalCost,
                                         costWithoutCacheMisses: prev.costWithoutCacheMisses + costResult.potentialMaxCost,
                                     }));
                                 }
                             },
                             retryLanguageModelContext,
                             maxParagraphs
                         );
                    }

                    if (!rawText || !rawText.trim()) {
                        return null;
                    }
                } else {
                    return null;
                }
            }

            const displayText = convertIdsToDisplayNames(rawText, data);
            const aiMessage = createChatMessage(data, character, displayText);
            return addMessageToChatData(data, aiMessage);
        } catch (error) {
            const err = error as Error;

            // ✅ On ANY error that interrupts generation, capture partial text for resume.
            const partialText = streamingTextRef.current;
            const partialChar = streamingCharacterRef.current;
            if (partialText && partialText.trim().length > 0 && partialChar) {
                pendingPartialRef.current = { text: partialText, character: partialChar };
            }
            
            if (err.name === 'AbortError') {
                return null;
            }

            const isNetworkError = err.message.includes('Failed to fetch') || 
                                    err.message.includes('NetworkError') ||
                                    err.message.includes('ERR_ABORTED') ||
                                    err.message.includes('502') ||
                                    err.message.includes('503') ||
                                    err.message.includes('504');

            if (isNetworkError) {
                if (!signal.aborted) {
                    addToast("⚠️ Backend Connection Failed. Could not connect to the AI server.", "error");
                }
                return null;
            }

            console.error("Inference failed:", err);
            if (!signal.aborted) {
                addToast(`Inference Error: ${err.message}`, "error");
            }
            return null;
        }
    }, [addToast, getDynamicParagraphLimit, setStreamingTextThrottled]);

    const updateRunningModels = useCallback((models: Record<string, { isRunning: boolean; port?: number }>) => {
        setRunningModelsMap(models);
    }, []);

    /**
     * ✅ Patches the last AI message in history with partial text and isPartial flag.
     * Falls back to creating a new message if no AI message exists yet.
     */
    const applyPendingPartial = useCallback(async (
        baseData: ChatData,
        protagonistId: string
    ): Promise<ChatData> => {
        const pending = pendingPartialRef.current;
        if (!pending) return baseData;

        pendingPartialRef.current = null;
        const displayText = convertIdsToDisplayNames(pending.text, baseData);
        const history = baseData.chatMessageHistory;

        if (history.length > 0) {
            const lastIdx = history.length - 1;
            const lastMsg = history[lastIdx];
            if (lastMsg.character.id !== protagonistId) {
                const patchedHistory = [...history];
                patchedHistory[lastIdx] = { ...lastMsg, textContent: displayText, isPartial: true };
                return { ...baseData, chatMessageHistory: patchedHistory, lastUpdatedTimestamp: Date.now() };
            }
        }

        const partialMsg = createChatMessage(baseData, pending.character, displayText, { isPartial: true });
        return addMessageToChatData(baseData, partialMsg);
    }, []);

    const sendActionAndGetResponse = useCallback(async (actionText: string, targetChar: Character): Promise<void> => {
        if (!chatData || !currentCharacter) return;
        
        if (isLoadingRef.current) {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        if (!acquireGenerationLock()) {
            addToast("Already generating...", "info");
            return;
        }
        if (!isModelReadyForGeneration()) {
            addToast("Model is not ready yet. Please wait.", "error");
            releaseGenerationLock();
            return;
        }
        try {
            const latestChatData = chatDataRef.current;
            if (!latestChatData) {
                releaseGenerationLock();
                return;
            }

            const actionMsg = createChatMessage(latestChatData, currentCharacter, actionText);
            const updatedData = addMessageToChatData(latestChatData, actionMsg);
            await saveRawChatData(updatedData);
            setChatData(updatedData);
            chatDataRef.current = updatedData;
            await new Promise(resolve => setTimeout(resolve, 50));
            
            const controller = new AbortController();
            abortControllerRef.current = controller;
            setStreamingText("");
            streamingTextRef.current = "";
            pendingStreamingTextRef.current = "";
            setStreamingCharacter(targetChar);
            streamingCharacterRef.current = targetChar;
            setGenerationSpeed(0);
            isAtBottomRef.current = true; // User initiated action — snap to bottom
            
            try {
                const result = await handleServerResponse(updatedData, targetChar, controller.signal, setStreamingTextThrottled, undefined, undefined);

                if (pendingPartialRef.current) {
                    const baseData = result || updatedData;
                    const finalData = await applyPendingPartial(baseData, currentCharacter.id);
                    await saveRawChatData(finalData);
                    setChatData(finalData);
                    chatDataRef.current = finalData;
                    return;
                }

                if (result) {
                    await saveRawChatData(result);
                    setChatData(result);
                    chatDataRef.current = result;

                    const lastMsg = result.chatMessageHistory[result.chatMessageHistory.length - 1];
                    if (lastMsg && lastMsg.character.id !== currentCharacter?.id) {
                        speakMessage(lastMsg.textContent, lastMsg.character);
                    }
                }
            } catch (err) {
                if ((err as Error).name !== 'AbortError') console.error("AI response failed:", err);
            } finally {
                if (abortControllerRef.current === controller) abortControllerRef.current = null;
                releaseGenerationLock();
            }
        } catch (error) {
            console.error("Failed to send action:", error);
            releaseGenerationLock();
        }
    }, [chatData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration, acquireGenerationLock, releaseGenerationLock, speakMessage, applyPendingPartial, setStreamingTextThrottled]);

    const processProtagonistImageSilently = useCallback(async (data: ChatData, character: Character) => {
        if (!character.image) {
            setIsInitialImageProcessed(true);
            return;
        }
        if (!isModelReadyForGeneration() || isLoadingRef.current || isProcessingSilentlyRef.current) {
            setIsInitialImageProcessed(true);
            return;
        }

        isProcessingSilentlyRef.current = true;
        const sampler = character.sampler;
        const silentCharacter: Character = {
            ...character,
            sampler: {
                ...sampler,
                id: sampler?.id || uuidv4(),
                name: sampler?.name || 'silent',
                maximumNumberOfTokens: 0,
                parameters: { ...sampler?.parameters, n_predict: 0 },
                stopPatterns: [],
                firstCreatedTimestamp: sampler?.firstCreatedTimestamp || Date.now(),
                lastUpdatedTimestamp: Date.now(),
            }
        };
        try {
            const controller = new AbortController();
            await handleServerResponse(data, silentCharacter, controller.signal, undefined, undefined, undefined);
        } catch (error) {
            console.warn("Silent image processing failed:", error);
        } finally {
            isProcessingSilentlyRef.current = false;
            setIsInitialImageProcessed(true);
        }
    }, [handleServerResponse, isModelReadyForGeneration]);

    useEffect(() => {
        const init = async () => {
            const arr = await loadAllRawChatData();
            const validChats = arr.filter((c): c is ChatData => c !== null);
            let charToUse: Character | null = null;
            let chatToLoad: ChatData | null = null;

            if (validChats.length > 0) {
                const sortedChats = [...validChats].sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp);
                const firstChat = sortedChats[0];
                if (firstChat.protagonist && firstChat.protagonist.id !== 'default-user') {
                    chatToLoad = firstChat;
                    charToUse = firstChat.protagonist;
                }
            }

            if (!charToUse) charToUse = getDefaultCharacter();
            if (!currentCharacter && charToUse) setCurrentCharacter(charToUse);

            if (!chatData && charToUse) {
                if (chatToLoad) setChatData(chatToLoad);
                else setChatData(createNewChatData(charToUse));
            }

            const dataToProcess = chatToLoad || (charToUse ? createNewChatData(charToUse) : null);
            if (dataToProcess && charToUse && !isInitialImageProcessed) {
                await processProtagonistImageSilently(dataToProcess, charToUse);
            }

            if (chatData || chatToLoad) {
                const activeChat = chatToLoad || chatData;
                if (activeChat) {
                    const allChats = await loadAllRawChatData();
                    const points = new Set<string>();
                    for (const c of allChats) {
                        if (c && c.parentChatDataId === activeChat.id && c.parentChatMessageId) points.add(c.parentChatMessageId);
                    }
                    setParentChatMessageIds(points);
                }
            }
        };
        init();
    }, []);

    // ✅ Track whether user is at bottom of chat history
    useEffect(() => {
        const chatEl = chatHistoryRef.current;
        if (!chatEl) return;
        const onScroll = () => {
            const threshold = 80;
            const atBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < threshold;
            isAtBottomRef.current = atBottom;
        };
        chatEl.addEventListener('scroll', onScroll, { passive: true });
        return () => chatEl.removeEventListener('scroll', onScroll);
    }, []);

    // ✅ Auto-scroll only when user is at bottom AND streaming/loading
    useEffect(() => {
        if (!isAtBottomRef.current) return;
        if (isLoading && streamingText && messageEndRef.current) {
            messageEndRef.current.scrollIntoView({ behavior: 'auto' });
        } else if (!isLoading && messageEndRef.current && chatData?.chatMessageHistory.length) {
            messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [streamingText, isLoading, chatData?.chatMessageHistory.length]);

    const stopGeneration = useCallback(() => {
        const savedText = streamingTextRef.current;
        const savedChar = streamingCharacterRef.current;

        if (savedText && savedText.trim().length > 0 && savedChar) {
            pendingPartialRef.current = { text: savedText, character: savedChar };
        } else {
            pendingPartialRef.current = null;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null; 
        }

        releaseGenerationLock();
        setGenerationSpeed(0);
    }, [releaseGenerationLock]);

    const startNewChat = useCallback((character: Character) => {
        const newChat = createNewChatData(character);
        newChat.name = "Untitled Chat";
        setChatData(newChat);
        setCurrentCharacter(character);
        setIsInitialImageProcessed(false);
        isAtBottomRef.current = true;
        saveRawChatData(newChat).catch(err => console.error("Failed to save new chat:", err));
    }, []);

    const setActiveBudgetStrategy = useCallback((strategy: BudgetStrategy | null) => {
        setActiveStrategy(strategy);
    }, []);

    const setSelectedGlobalModel = useCallback((model: LanguageModel | null) => {
        setSelectedModel(model);
    }, []);

    const sendMessage = useCallback(async (text: string, files?: File[]) => {
        if (!chatData || !currentCharacter || (!text.trim() && (!files || files.length === 0))) return;
        if (!acquireGenerationLock()) {
            addToast("Already generating...", "info");
            return;
        }
        if (!isModelReadyForGeneration()) {
            addToast("Model is not ready yet. Please wait.", "error");
            releaseGenerationLock();
            return;
        }
        
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setStreamingText("");
        streamingTextRef.current = "";
        pendingStreamingTextRef.current = "";
        setStreamingCharacter(null);
        streamingCharacterRef.current = null;
        setGenerationSpeed(0);
        isAtBottomRef.current = true; // User sent a message — snap to bottom
        
        try {
            let userImagesBase64: string[] | undefined = undefined;
            if (files && files.length > 0) {
                userImagesBase64 = await Promise.all(files.map(f => convertFileToBase64(f)));
            }

            const userMsg = createChatMessage(chatData, currentCharacter, text);
            const tempData = addMessageToChatData(chatData, userMsg);
            setChatData(tempData);
            chatDataRef.current = tempData;
            await saveRawChatData(tempData);

            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => {
                setStreamingText("");
                streamingTextRef.current = "";
                pendingStreamingTextRef.current = "";
                setStreamingCharacter(char);
                streamingCharacterRef.current = char;
                return handleServerResponse(data, char, signal, onToken, userImagesBase64, undefined);
            };
            
            const updatedData = await runTurnSequence(tempData, executor, controller, setStreamingCharacter, setStreamingTextThrottled, setChatData);

            // ✅ If interrupted (stop/error/network), patch last AI message as partial
            if (pendingPartialRef.current) {
                const finalData = await applyPendingPartial(updatedData, currentCharacter.id);
                await saveRawChatData(finalData);
                setChatData(finalData);
                chatDataRef.current = finalData;
                return;
            }

            const originalMsgCount = tempData.chatMessageHistory.length;
            const newMsgCount = updatedData.chatMessageHistory.length;
            const hasAIResponse = newMsgCount > originalMsgCount;

            if (hasAIResponse) {
                await saveRawChatData(updatedData);
                setChatData(updatedData);
                chatDataRef.current = updatedData;

                runBackgroundSummarization(updatedData, setChatData, chatDataRef, selectedModelRef, runningModelsMapRef, addToast);

                const lastMsg = updatedData.chatMessageHistory[updatedData.chatMessageHistory.length - 1];
                if (lastMsg && lastMsg.character.id !== currentCharacter?.id) {
                    speakMessage(lastMsg.textContent, lastMsg.character);
                }
            } else {
                const ambientData = await generateAmbientNarration(updatedData, controller.signal);
                
                if (ambientData) {
                    await saveRawChatData(ambientData);
                    setChatData(ambientData);
                    chatDataRef.current = ambientData;
                } else {
                    await saveRawChatData(updatedData);
                    setChatData(updatedData);
                    chatDataRef.current = updatedData;
                }
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                console.error("Send failed:", err);
                addToast(`Send failed: ${(err as Error).message}`, "error");
            }
        } finally {
            if (abortControllerRef.current === controller) abortControllerRef.current = null;
            releaseGenerationLock();
        }
    }, [chatData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration, acquireGenerationLock, releaseGenerationLock, generateAmbientNarration, speakMessage, applyPendingPartial, setStreamingTextThrottled]);

    const resumeGeneration = useCallback(async (messageId: string) => {
        if (!chatData) return;
        
        const msgIndex = chatData.chatMessageHistory.findIndex(m => m.id === messageId);
        if (msgIndex === -1) {
            addToast("Message not found.", "error");
            return;
        }

        const msg = chatData.chatMessageHistory[msgIndex];
        if (!msg.isPartial) {
            addToast("This message is not partial — use Regenerate instead.", "info");
            return;
        }

        if (!acquireGenerationLock()) {
            addToast("Already generating...", "info");
            return;
        }
        if (!isModelReadyForGeneration()) {
            addToast("Model is not ready yet. Please wait.", "error");
            releaseGenerationLock();
            return;
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setStreamingText(msg.textContent);
        streamingTextRef.current = msg.textContent;
        pendingStreamingTextRef.current = msg.textContent;
        setStreamingCharacter(msg.character);
        streamingCharacterRef.current = msg.character;
        setGenerationSpeed(0);
        isAtBottomRef.current = true; // User initiated resume — snap to bottom

        try {
            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t: string) => void) => {
                const existingText = msg.textContent;
                const wrappedOnToken = (t: string) => {
                    const combined = existingText + t;
                    streamingTextRef.current = combined;
                    onToken(combined);
                };
                return handleServerResponse(data, char, signal, wrappedOnToken, undefined, undefined);
            };

            const updatedData = await runTurnSequence(chatData, executor, controller, setStreamingCharacter, setStreamingTextThrottled, setChatData);

            if (pendingPartialRef.current) {
                const finalData = await applyPendingPartial(updatedData, chatData.protagonist.id);
                await saveRawChatData(finalData);
                setChatData(finalData);
                chatDataRef.current = finalData;
                return;
            }

            const hasNewContent = updatedData.chatMessageHistory.length > chatData.chatMessageHistory.length ||
                (updatedData.chatMessageHistory.length === chatData.chatMessageHistory.length &&
                    updatedData.chatMessageHistory[updatedData.chatMessageHistory.length - 1]?.textContent !== msg.textContent);

            if (hasNewContent) {
                const finalData = await clearPartialFlag(updatedData, 
                    updatedData.chatMessageHistory[updatedData.chatMessageHistory.length - 1]?.id || messageId
                );
                await saveRawChatData(finalData);
                setChatData(finalData);
                chatDataRef.current = finalData;

                const lastMsg = finalData.chatMessageHistory[finalData.chatMessageHistory.length - 1];
                if (lastMsg && lastMsg.character.id !== chatData.protagonist.id) {
                    speakMessage(lastMsg.textContent, lastMsg.character);
                }
            } else {
                await saveRawChatData(updatedData);
                setChatData(updatedData);
                chatDataRef.current = updatedData;
            }
        } catch (err) {
            const errorMsg = (err as Error).message;
            if (errorMsg !== 'AbortError') {
                console.error("Resume failed:", err);
                addToast(`Resume error: ${errorMsg}`, "error");
            }
        } finally {
            if (abortControllerRef.current === controller) abortControllerRef.current = null;
            releaseGenerationLock();
        }
    }, [chatData, handleServerResponse, addToast, isModelReadyForGeneration, acquireGenerationLock, releaseGenerationLock, applyPendingPartial, setStreamingTextThrottled]);

    const regenerateFromMessage = useCallback(async (messageId: string, type: 'ai' | 'user') => {
        if (!chatData) return;
        if (!acquireGenerationLock()) {
            addToast("Already generating...", "info");
            return;
        }
        if (!isModelReadyForGeneration()) {
            addToast("Model is not ready yet. Please wait.", "error");
            releaseGenerationLock();
            return;
        }
        
        const history = chatData.chatMessageHistory;
        const targetIndex = history.findIndex(m => m.id === messageId);

        if (targetIndex === -1) {
            addToast("Message not found.", "error");
            releaseGenerationLock();
            return;
        }

        const targetMessage = history[targetIndex];
        const isTargetAI = targetMessage.character.id !== chatData.protagonist.id;

        let trimIndex: number;
        let messagesToDelete: ChatMessage[];

        if (type === 'ai' && isTargetAI) {
            trimIndex = targetIndex;
            messagesToDelete = history.slice(trimIndex);
        } else if (type === 'user' && !isTargetAI) {
            trimIndex = targetIndex + 1;
            messagesToDelete = history.slice(trimIndex);
        } else {
            addToast("Mismatched regeneration type.", "error");
            releaseGenerationLock();
            return;
        }

        if (messagesToDelete.length > 0) {
            try { 
                await Promise.all(messagesToDelete.map(m => deleteRawChatMessage(m.id))); 
            } catch (err) { 
                console.error("Failed to delete old messages:", err); 
            }
        }

        const trimmedData: ChatData = { 
            ...chatData, 
            chatMessageHistory: history.slice(0, trimIndex), 
            lastUpdatedTimestamp: Date.now() 
        };
        
        setChatData(trimmedData);
        chatDataRef.current = trimmedData;
        setStreamingText("");
        streamingTextRef.current = "";
        pendingStreamingTextRef.current = "";
        setStreamingCharacter(null);
        streamingCharacterRef.current = null;
        setGenerationSpeed(0);
        isAtBottomRef.current = true; // User initiated regenerate — snap to bottom
        
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const preRegenMsgCount = trimmedData.chatMessageHistory.length;

        try {
            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => {
                setStreamingText("");
                streamingTextRef.current = "";
                pendingStreamingTextRef.current = "";
                setStreamingCharacter(char);
                streamingCharacterRef.current = char;
                return handleServerResponse(data, char, signal, onToken, undefined, undefined);
            };

            const updatedData = await runTurnSequence(trimmedData, executor, controller, setStreamingCharacter, setStreamingTextThrottled, setChatData);

            if (pendingPartialRef.current) {
                const finalData = await applyPendingPartial(updatedData, chatData.protagonist.id);
                await saveRawChatData(finalData);
                setChatData(finalData);
                chatDataRef.current = finalData;
                return;
            }

            const postRegenMsgCount = updatedData.chatMessageHistory.length;
            const hasAIResponse = postRegenMsgCount > preRegenMsgCount;

            if (hasAIResponse) {
                await saveRawChatData(updatedData);
                setChatData(updatedData);
                chatDataRef.current = updatedData;

                runBackgroundSummarization(updatedData, setChatData, chatDataRef, selectedModelRef, runningModelsMapRef, addToast);

                const lastMsg = updatedData.chatMessageHistory[updatedData.chatMessageHistory.length - 1];
                if (lastMsg && lastMsg.character.id !== currentCharacter?.id) {
                    speakMessage(lastMsg.textContent, lastMsg.character);
                }
            } else {
                const ambientData = await generateAmbientNarration(updatedData, controller.signal);
                
                if (ambientData) {
                    await saveRawChatData(ambientData);
                    setChatData(ambientData);
                    chatDataRef.current = ambientData;
                } else {
                    await saveRawChatData(updatedData);
                    setChatData(updatedData);
                    chatDataRef.current = updatedData;
                }
            }
        } catch (err) { 
            const errorMsg = (err as Error).message;
            if (errorMsg !== 'AbortError') {
                console.error("Regeneration failed:", err); 
                addToast(`Regeneration error: ${errorMsg}`, "error");
            }
        } finally { 
            if (abortControllerRef.current === controller) abortControllerRef.current = null; 
            releaseGenerationLock();
        }
    }, [chatData, handleServerResponse, addToast, isModelReadyForGeneration, acquireGenerationLock, releaseGenerationLock, generateAmbientNarration, speakMessage, applyPendingPartial, setStreamingTextThrottled]);

    const currentTokenCount = chatData ? chatData.chatMessageHistory.reduce((acc, msg) => acc + estimateTokens(msg.textContent), 0) : 0;
    const maxContextTokens = selectedModel?.contextLength || 8192;

    return {
        chatData, setChatData, currentCharacter, setCurrentCharacter, isLoading, streamingText, streamingCharacter,
        sendMessage, stopGeneration, resumeGeneration, regenerateFromMessage, messageEndRef, chatHistoryRef, parentChatMessageIds,
        generationSpeed, messageCount: chatData?.chatMessageHistory.length || 0, tokenCount: currentTokenCount,
        maximumNumberOfTokens: maxContextTokens, startNewChat,
        sendActionAndGetResponse,
        setActiveBudgetStrategy,
        setSelectedGlobalModel,
        updateRunningModels,
        numberOfCacheInvalidations: stats.numberOfCacheInvalidations,
        numberOfRequests: stats.numberOfRequests,
        totalCost: stats.totalCost,
        costWithoutCacheMisses: stats.costWithoutCacheMisses,
    };
}