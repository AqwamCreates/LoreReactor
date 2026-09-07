// src/hooks/useChatSession.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Character, InteractionData, BudgetStrategy, BudgetData, LanguageModel, Memory, InteractionMessage, ChatMessage } from '../types';
import { saveRawInteractionData, getCharacterVoiceUrl, saveRawCharacter, deleteRawInteractionMessage, loadRawBudgetData, saveRawBudgetData } from './storage';
import { createChatMessage, addMessageToInteractionData, convertIdsToDisplayNames, createNewInteractionData, prepareRequestBody, editInteractionMessageInInteractionData, findPreviousInteractionMessage } from './chatLogic';
import { runTurnSequence } from '../services/InteractionOrchestrator';
import { BudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator';
import { generateMissingSummaries, generatePeriodicCompression, checkTriggerThreshold, generateRecursiveSummary, makeCharacterMemory } from '../services/ChatMessageSummarizationEngine';
import { editMessage, clearPartialFlag } from './messageLogic';
import { consumeChatStamina, generateChatStamina, getEffectiveEnableMemoryWriting, getEffectiveMaximumChatStamina, getEffectiveEnableWebSearch, getEffectiveEnableCalculator } from './characterLogic';
import { getCurrentLocationIndex, findLocationByRegex } from '../hooks/locationLogic';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../context/ToastContext';
import { localAddress, localURL } from '../configurations';
import { LanguageModelEngine, type LanguageModelContext, type StreamCallbacks } from '../services/LanguageModelEngine';
import { TextToSpeechModelEngine, type TextToSpeedLanguageModelContext } from '../services/TextToSpeechModelEngine';
import { memoryWriteTrigger } from '../stringList';
import { ToolInvocationParser } from '../services/ToolInvocationParser';
import { executeTools } from '../services/ToolExecutor';
import { DefaultBudgetData } from '../defaults';

const languageModelEngine = new LanguageModelEngine();
const textToSpeechModelEngine = new TextToSpeechModelEngine();
const now = Date.now();

const convertFileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });

function hasTextContent(msg: InteractionMessage): boolean {
    return 'textContent' in msg && typeof (msg as any).textContent === 'string';
}

// ─── Ambient Narration ───────────────────────────────────────────────

const AMBIENT_NARRATOR: Character = {
    id: '__ambient_narrator__', name: '', description: 'Ambient environment narration',
    systemPrompt: '', initiativeWeight: 0, chatProbability: 1, maximumChatStamina: 1,
    memories: {},
    numberOfMessagesToDisableThinkPrompt: 0,
    numberOfMessagesToDisableMetaThinkInstructions: 0,
    numberOfMessagesToDisableDialoguePrompt: 0,
    firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
} as Character;

const AMBIENT_POOL: { keywords: string[]; lines: string[] }[] = [
    { keywords: ['hello', 'hi', 'hey', 'greet', 'good morning', 'good evening', 'good night', 'howdy', 'yo', '?'], lines: ["A tentative quiet hangs in the air, waiting to be shaped.", "The space between them hums with the possibility of conversation.", "Words hover at the edge of silence, not yet committed.", "The air shifts subtly, acknowledging a presence.", "Something stirs in the stillness — an opening.", "The moment balances on the edge of beginning."] },
    { keywords: ['night', 'dark', 'moon', 'star', 'midnight', 'dusk', 'evening', 'twilight'], lines: ["Crickets hum softly beyond the walls.", "The darkness outside presses gently against the windows.", "A cool night breeze carries distant sounds through the stillness.", "Moonlight traces pale shapes across the floor.", "The night holds its breath around them.", "Somewhere outside, an owl calls once and falls silent."] },
    { keywords: ['morning', 'dawn', 'sunrise', 'sun', 'daybreak', 'early'], lines: ["Pale light filters through the gaps in the curtains.", "Birdsong drifts in from somewhere far away.", "The first warmth of morning touches the edges of the room.", "Dew-laden air seeps through the cracks, fresh and quiet.", "The world outside is just beginning to stir."] },
    { keywords: ['rain', 'storm', 'thunder', 'lightning', 'pouring', 'drizzle', 'wet'], lines: ["Rain taps a steady rhythm against the glass.", "Thunder rumbles low and distant, then fades.", "Water streaks down the windows in silver threads.", "The storm mutters to itself beyond the walls.", "Each raindrop sounds impossibly loud in the quiet."] },
    { keywords: ['room', 'inside', 'indoors', 'house', 'hall', 'chamber', 'apartment'], lines: ["The room settles into its own particular silence.", "Dust motes drift lazily through a shaft of light.", "The walls seem to absorb the quiet, holding it close.", "Something in the room creaks softly, then stills.", "The space between them feels measured and deliberate."] },
    { keywords: ['outside', 'garden', 'forest', 'tree', 'wind', 'grass', 'field', 'path'], lines: ["Leaves rustle in a wind that carries no warmth.", "Branches sway overhead in slow, patient arcs.", "The outdoors hums with a life that doesn't need words.", "Grass bends and rises in waves of quiet motion.", "The horizon holds still, watching."] },
    { keywords: ['footstep', 'walk', 'pace', 'approach', 'tread', 'floorboard'], lines: ["Footsteps echo faintly, then stop.", "The floor groans under shifting weight somewhere nearby.", "A measured tread passes and fades into distance.", "Each step lands carefully, as if the walker doesn't want to be heard."] },
    { keywords: ['creak', 'groan', 'settle', 'shift', 'wood', 'old'], lines: ["Wood settles with a long, patient sigh.", "Something old shifts its weight and goes still again.", "A creak rises and dissolves into the silence.", "The structure around them breathes in its own slow way."] },
    { keywords: ['fire', 'flame', 'hearth', 'warm', 'candle', 'ember', 'glow'], lines: ["Embers pop softly, casting brief orange light.", "The fire murmurs to itself in a language of heat.", "Warmth radiates outward in gentle, invisible waves.", "A candle flickers though nothing has moved the air."] },
    { keywords: ['water', 'river', 'sea', 'ocean', 'wave', 'stream', 'lake', 'shore'], lines: ["Water moves endlessly in the distance, indifferent and constant.", "Waves fold over themselves in a rhythm older than memory.", "The sound of water fills the silence without breaking it.", "Current pulls at something unseen beneath the surface."] },
    { keywords: ['crowd', 'people', 'voices', 'busy', 'market', 'street', 'city'], lines: ["Distant voices blur into a murmur that means nothing.", "Life continues somewhere else, oblivious.", "The noise of others fades to a hum, then less than a hum.", "Footsteps pass without stopping, belonging to strangers."] },
    { keywords: ['cold', 'frost', 'ice', 'snow', 'winter', 'freeze', 'chill'], lines: ["Cold seeps in through places you can't quite find.", "Frost crystals form silently on the other side of the glass.", "The air bites at exposed skin, patient and persistent.", "Ice shifts somewhere with a sound like a whisper."] },
    { keywords: ['book', 'page', 'read', 'paper', 'library', 'shelf', 'ink'], lines: ["Pages settle against each other with a papery sigh.", "The weight of unread words hangs quietly in the air.", "Ink and paper hold their stories in patient silence.", "A book lies open, waiting for eyes that have looked away."] },
];

const AMBIENT_FALLBACK = [
    "A heavy silence settles over everything.", "The air grows still, thick with unspoken words.",
    "Quiet stretches between them like a held breath.", "The moment lingers, neither comfortable nor cruel.",
    "Stillness fills the space where words should be.", "Time seems to slow in the absence of sound.",
    "The pause grows teeth.", "Nothing moves. Nothing breaks the stillness.",
    "The silence has a texture now, rough and unresolved.", "A beat passes. Then another.",
];

// ─── Background Summarization ────────────────────────────────────────

async function runBackgroundSummarization(
    data: InteractionData, setData: (d: InteractionData) => void,
    dataRef: React.MutableRefObject<InteractionData | null>,
    modelRef: React.MutableRefObject<LanguageModel | null>,
    runningModelsRef: React.MutableRefObject<Record<string, { isRunning: boolean; port?: number }>>,
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void,
    activeStrategy?: BudgetStrategy | null,
): Promise<void> {
    try {
        const ctxLen = modelRef.current?.contextLength || 8192;
        let tokens = 0;
        for (const m of data.interactionHistory) {
            tokens += await languageModelEngine.countTokens(m.textContent);
        }

        const triggered = checkTriggerThreshold(data, tokens, ctxLen);
        if (!triggered) return;

        addToast(`Running ${triggered.strategyType}...`, 'info');
        const port = modelRef.current?.id ? runningModelsRef.current[modelRef.current.id]?.port : undefined;
        const effectivePort = port || (modelRef.current?.parameters as any)?._runtimePort;
        const lmCtx: LanguageModelContext = { apiKey: modelRef.current?.apiKey, backend: modelRef.current?.backend, modelPath: modelRef.current?.model, runtimePort: effectivePort };
        if (!effectivePort && !modelRef.current?.apiKey) return;

        const running = runningModelsRef.current;
        const strat = activeStrategy ?? null;

        let updated = data;
        if (triggered.strategyType === 'Sliding Window Replace' && triggered.slidingWindowSize) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Sliding Window Replace' && s.enabled)?.summaryTokenBudget ?? 256;
            const summaries = await generateMissingSummaries(updated, triggered.slidingWindowSize, lmCtx, budget, strat, running);
            if (summaries.size > 0) updated = { ...updated, interactionHistory: updated.interactionHistory.map(m => { const s = summaries.get(m.id); return s ? { ...m, textContentSummary: s } : m; }) };
        }
        if (triggered.strategyType === 'Periodic Compression' && triggered.compressionInterval && triggered.compressionChunkSize) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Periodic Compression' && s.enabled)?.summaryTokenBudget ?? 512;
            const nc = await generatePeriodicCompression(updated, triggered.compressionInterval, triggered.compressionChunkSize, lmCtx, budget, strat, running);
            if (nc.length > 0) updated = { ...updated, contexts: [...(updated.contexts || []), ...nc] };
        }
        if (triggered.strategyType === 'Recursive Summary' && triggered.recursiveChunkSize && triggered.recursiveMaxDepth) {
            const budget = data.Profile?.summarizationSteps?.find(s => s.strategyType === 'Recursive Summary' && s.enabled)?.summaryTokenBudget ?? 1024;
            const nc = await generateRecursiveSummary(updated, triggered.recursiveChunkSize, triggered.recursiveMaxDepth, lmCtx, budget, strat, running);
            if (nc.length > 0) updated = { ...updated, contexts: [...(updated.contexts || []), ...nc] };
        }

        if (updated !== data) {
            await saveRawInteractionData(updated); 
            setData(updated); 
            dataRef.current = updated;
            
            const ns = triggered.strategyType === 'Sliding Window Replace' ? updated.interactionHistory.filter(m => m.textContentSummary).length - data.interactionHistory.filter(m => m.textContentSummary).length : 0;
            const nc = (triggered.strategyType === 'Periodic Compression' || triggered.strategyType === 'Recursive Summary') ? (updated.contexts?.length ?? 0) - (data.contexts?.length ?? 0) : 0;
            if (ns > 0) addToast(`Summarized ${ns} message${ns !== 1 ? 's' : ''}`, 'success');
            else if (nc > 0) addToast(`Generated ${nc} context${nc !== 1 ? 's' : ''} (${triggered.strategyType})`, 'success');
            else addToast(`${triggered.strategyType} complete`, 'info');
        } else { addToast(`${triggered.strategyType} complete`, 'info'); }
    } catch (err) { console.warn('Background summarization failed:', err); addToast(`Summarization failed: ${(err as Error).message}`, 'error'); }
}

// ─── Tool Invocation Processing ──────────────────────────────────────

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

// ─── Hook ───────────────────────────────────────────────────────────

export function useChatSession() {
    const [interactionData, setInteractionData] = useState<InteractionData | null>(null);
    const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [streamingCharacter, setStreamingCharacter] = useState<Character | null>(null);
    const [currentCharacterExpression, setCurrentCharacterExpression] = useState<string>('neutral');
    const [isInitialImageProcessed, setIsInitialImageProcessed] = useState(false);
    const [generationSpeed, setGenerationSpeed] = useState(0);
    const [timeToFirstToken, setTimeToFirstToken] = useState(0);
    const [parentInteractionMessageIds, setParentInteractionMessageIds] = useState<Set<string>>(new Set());
    const [activeStrategy, setActiveStrategy] = useState<BudgetStrategy | null>(null);
    const [selectedModel, setSelectedModel] = useState<LanguageModel | null>(null);
    const [runningModelsMap, setRunningModelsMap] = useState<Record<string, { isRunning: boolean; port?: number }>>({});
    const [stats, setStats] = useState({ numberOfCacheInvalidations: 0, numberOfRequests: 0, totalCost: 0, costWithoutCacheMisses: 0 });
    const [numberOfTokens, setnumberOfTokens] = useState(0);
    const [budgetData, setBudgetData] = useState<BudgetData | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const selectedModelRef = useRef<LanguageModel | null>(null);
    const runningModelsMapRef = useRef<Record<string, { isRunning: boolean; port?: number }>>({});
    const activeStrategyRef = useRef<BudgetStrategy | null>(null);
    const budgetDataRef = useRef<BudgetData | null>(null);
    const isLoadingRef = useRef(false);
    const isProcessingSilentlyRef = useRef(false);
    const streamingTextRef = useRef('');
    const streamingCharacterRef = useRef<Character | null>(null);
    const interactionDataRef = useRef<InteractionData | null>(null);
    const pendingPartialRef = useRef<{ text: string; character: Character } | null>(null);
    const isAtBottomRef = useRef(true);
    const uploadedTtsVoicesRef = useRef<Set<string>>(new Set());
    const previousExpressionRef = useRef<string>('neutral');

    const resumingMessageIdRef = useRef<string | null>(null);
    const resumingExistingTextRef = useRef<string>('');

    const activeStrategyIdRef = useRef<string | null>(null);

    const THROTTLE_MS = 60;
    const lastFlushRef = useRef(0);
    const pendingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingStreamingTextRef = useRef('');

    useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
    useEffect(() => { runningModelsMapRef.current = runningModelsMap; }, [runningModelsMap]);
    useEffect(() => { activeStrategyRef.current = activeStrategy; }, [activeStrategy]);
    useEffect(() => { budgetDataRef.current = budgetData; }, [budgetData]);
    useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
    useEffect(() => { streamingTextRef.current = streamingText; }, [streamingText]);
    useEffect(() => { streamingCharacterRef.current = streamingCharacter; }, [streamingCharacter]);
    useEffect(() => { interactionDataRef.current = interactionData; }, [interactionData]);

    const { addToast } = useToast();
    const [ttsServerUrl] = useState(`${localAddress}:7860`);

    // ✅ Load budget data on mount
    useEffect(() => {
        (async () => {
            try {
                const bd = await loadRawBudgetData();
                if (bd) {
                    setBudgetData(bd);
                    budgetDataRef.current = bd;
                }
            } catch (e) {
                console.warn('Failed to load budget data:', e);
            }
        })();
    }, []);

    // ✅ Sync budget data from external updates (e.g., BudgetControlModal)
    useEffect(() => {
        const handleBudgetDataUpdated = (event: Event) => {
            const customEvent = event as CustomEvent<BudgetData | null>;
            const updated = customEvent.detail;
            setBudgetData(updated);
            budgetDataRef.current = updated;
        };

        window.addEventListener('budget-data-updated', handleBudgetDataUpdated);
        return () => {
            window.removeEventListener('budget-data-updated', handleBudgetDataUpdated);
        };
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${localURL}/models/status`);
                if (!res.ok) return;
                const data = await res.json();
                const status: Record<string, { isRunning: boolean; port?: number }> = {};
                for (const m of data.activeModels || []) status[m.id] = { isRunning: true, port: m.port };
                setRunningModelsMap(status);
            } catch { }
        })();
    }, []);

    useEffect(() => {
        if (!interactionData) { setnumberOfTokens(0); return; }
        let cancelled = false;
        (async () => {
            const model = selectedModelRef.current;
            const port = model?.id ? runningModelsMapRef.current[model.id]?.port : undefined;
            const ep = port || (model?.parameters as any)?._runtimePort;
            const lmCtx = ep ? { runtimePort: ep } : undefined;

            let total = 0;
            for (const m of interactionData.interactionHistory) {
                total += await languageModelEngine.countTokens(m.textContent, lmCtx);
            }
            if (!cancelled) setnumberOfTokens(total);
        })();
        return () => { cancelled = true; };
    }, [interactionData?.interactionHistory]);

    // ─── Helpers ─────────────────────────────────────────────────────

    const isModelReadyForGeneration = useCallback((): boolean => {
        const m = selectedModelRef.current;
        if (!m) return false;
        if (m.apiKey) return true;
        return !!(m.id && runningModelsMapRef.current[m.id]?.port);
    }, []);

    const acquireLock = useCallback((): boolean => {
        if (isLoadingRef.current) return false;
        isLoadingRef.current = true; setIsLoading(true); return true;
    }, []);

    const releaseLock = useCallback(() => {
        isLoadingRef.current = false; setIsLoading(false);
        setStreamingText(''); setStreamingCharacter(null);
        streamingTextRef.current = ''; streamingCharacterRef.current = null;
        pendingStreamingTextRef.current = ''; lastFlushRef.current = 0;
        resumingMessageIdRef.current = null; resumingExistingTextRef.current = '';
        previousExpressionRef.current = 'neutral'; setCurrentCharacterExpression('neutral');
        if (pendingFlushRef.current) { clearTimeout(pendingFlushRef.current); pendingFlushRef.current = null; }
    }, []);

    const throttledSetStreamingText = useCallback((text: string) => {
        streamingTextRef.current = text; pendingStreamingTextRef.current = text;
        const elapsed = performance.now() - lastFlushRef.current;
        if (elapsed >= THROTTLE_MS) { lastFlushRef.current = performance.now(); setStreamingText(text); }
        else if (!pendingFlushRef.current) {
            pendingFlushRef.current = setTimeout(() => { lastFlushRef.current = performance.now(); setStreamingText(pendingStreamingTextRef.current); pendingFlushRef.current = null; }, THROTTLE_MS - elapsed);
        }
    }, []);

    const countParagraphs = useCallback((text: string): number => {
        if (!text || !text.trim()) return 0;
        return (text.match(/\n\n/g) || []).length + 1;
    }, []);

    const regenerateStaminaForTurn = useCallback((data: InteractionData, character: Character): InteractionData => {
        const maxStamina = getEffectiveMaximumChatStamina(character, data.Profile);
        if (maxStamina === Number.POSITIVE_INFINITY) return data;

        const prevMsg = findPreviousInteractionMessage(data, character.id);
        if (!prevMsg) return data;
        if (prevMsg.remainingChatStamina >= maxStamina) return data;

        const idx = data.interactionHistory.findIndex(m => m.id === prevMsg.id);
        if (idx === -1) return data;

        generateChatStamina(character, data.interactionHistory[idx]);
        return data;
    }, []);

    const speakMessage = useCallback((text: string, character: Character) => {
        if (!character.voice) return;
        const profile = interactionDataRef.current?.Profile;
        if (profile) {
            const parts: string[] = [];
            if (profile.narrateNormalText !== false) { let n = text.replace(/"[^"]*"|'[^']*'/g, '').replace(/\*\*[^*]+\*\*/g, '').replace(/\*[^*]+\*/g, '').trim(); if (n) parts.push(n); }
            if (profile.narrateQuotedText) { const m = text.match(/"[^"]*"|'[^']*'/g); if (m) parts.push(m.map(x => x.replace(/^["']|["']$/g, '')).join(' ')); }
            if (profile.narrateBoldedText) { const m = text.match(/\*\*[^*]+\*\*/g); if (m) parts.push(m.map(x => x.replace(/\*\*/g, '')).join(' ')); }
            if (profile.narrateItalicizedText) { const m = text.match(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g); if (m) parts.push(m.map(x => x.replace(/\*/g, '')).join(' ')); }
            const filtered = parts.join(' ').trim(); if (!filtered) return; text = filtered;
        }
        (async () => {
            try {
                const ctx: TextToSpeedLanguageModelContext = { serverUrl: ttsServerUrl || undefined, backend: 'Qwen3-TTS' };
                const label = character.id;
                if (!uploadedTtsVoicesRef.current.has(label)) {
                    const url = getCharacterVoiceUrl(character.voice); if (!url) return;
                    const res = await fetch(url); if (!res.ok) return;
                    const blob = await res.blob();
                    const file = new File([blob], `${label}.wav`, { type: blob.type || 'audio/wav' });
                    if (!await textToSpeechModelEngine.uploadVoice(label, file, ctx)) return;
                    uploadedTtsVoicesRef.current.add(label);
                }
                await new Promise(r => setTimeout(r, 500));
                const blob = await textToSpeechModelEngine.synthesize(text, ctx, { voice: label });
                if (blob) { const u = URL.createObjectURL(blob); const a = new Audio(u); a.onended = () => URL.revokeObjectURL(u); a.play().catch(e => console.warn('TTS playback failed:', e)); }
            } catch (e) { console.warn('TTS speak failed:', e); }
        })();
    }, [ttsServerUrl]);

    const getDynamicParagraphLimit = useCallback((char: Character, data: InteractionData): number => {
        const max = char.maximumChatStamina ?? 4;
        if (data.participants.filter(p => p.id !== data.protagonist.id).length > 1) return max;
        const prev = [...data.interactionHistory].reverse().find(m => m.character.id === char.id);
        const ratio = Math.max(0, Math.min(1, (prev?.remainingChatStamina ?? max) / max));
        return Math.max(1, Math.round(max * ratio));
    }, []);

    const generateAmbientNarration = useCallback(async (data: InteractionData, _signal: AbortSignal): Promise<InteractionData | null> => {
        const recent = data.interactionHistory.filter(m => m.character.id !== '__ambient_narrator__').slice(-8).map(m => m.textContent.toLowerCase()).join(' ');
        let best: typeof AMBIENT_POOL[0] | null = null, bestScore = 0;
        for (const cat of AMBIENT_POOL) { let s = 0; for (const kw of cat.keywords) if (recent.includes(kw)) s++; if (s > bestScore) { bestScore = s; best = cat; } }
        const pool = best ? best.lines : AMBIENT_FALLBACK;
        const recentAmbient = data.interactionHistory.filter(m => m.character.id === '__ambient_narrator__').slice(-3).map(m => m.textContent);
        const avail = pool.filter(l => !recentAmbient.includes(l));
        const final = avail.length > 0 ? avail : pool;
        const selected = final[Math.floor(Math.random() * final.length)];
        setStreamingCharacter(AMBIENT_NARRATOR); streamingCharacterRef.current = AMBIENT_NARRATOR;
        setStreamingText(''); streamingTextRef.current = '';
        for (let i = 0; i < selected.length; i++) { const p = selected.substring(0, i + 1); streamingTextRef.current = p; setStreamingText(p); await new Promise(r => setTimeout(r, 20)); }
        return addMessageToInteractionData(data, createChatMessage(data, AMBIENT_NARRATOR, selected));
    }, []);

    // ─── Memory Trigger Processing ──────────────────────────────────

    const processMemoryTrigger = useCallback(async (
        rawText: string,
        character: Character,
        data: InteractionData,
    ): Promise<void> => {
        const profile = data.Profile;

        const enableMemoryWriting = getEffectiveEnableMemoryWriting(character, profile);
        if (!enableMemoryWriting) return;

        const triggerIndex = rawText.indexOf(memoryWriteTrigger);
        if (triggerIndex === -1) return;

        const otherParticipants = data.participants.filter(p => p.id !== character.id);
        if (otherParticipants.length === 0) return;

        const model = selectedModelRef.current;
        const port = model?.id ? runningModelsMapRef.current[model.id]?.port : undefined;
        const ep = port || (model?.parameters as any)?._runtimePort;
        if (!ep && !model?.apiKey) return;
        const lmCtx: LanguageModelContext = { apiKey: model.apiKey, backend: model.backend, modelPath: model.model, runtimePort: ep };

        const effectiveRetentionWeight = (() => {
            const profileValue = profile?.memoryRetentionWeight;
            if (profileValue === undefined || profileValue === -1) return character.memoryRetentionWeight ?? 1;
            return profileValue;
        })();

        const ts = Date.now();
        const strat = activeStrategyRef.current;
        const running = runningModelsMapRef.current;

        for (const other of otherParticipants) {
            const allRelevant = data.interactionHistory.filter(
                m => m.character.id === character.id || m.character.id === other.id
            );

            let relevantMessages: typeof allRelevant;
            if (effectiveRetentionWeight <= 0) {
                relevantMessages = allRelevant.slice(-2);
            } else if (effectiveRetentionWeight < 1) {
                const count = Math.max(2, Math.round(allRelevant.length * effectiveRetentionWeight));
                relevantMessages = allRelevant.slice(-count);
            } else {
                relevantMessages = allRelevant;
            }

            if (relevantMessages.length === 0) continue;

            const summaryContext = await makeCharacterMemory(data, character, lmCtx, 512, strat, running);
            if (!summaryContext || !summaryContext.text) continue;

            const newMemory: Memory = {
                id: uuidv4(),
                name: `Memory with ${other.name}`,
                content: summaryContext.text,
                interactionData: data,
                firstCreatedTimestamp: ts,
                lastUpdatedTimestamp: ts,
            };

            if (!character.memories) character.memories = {};
            character.memories[other.id] = [newMemory];
        }

        const globalSummaryContext = await makeCharacterMemory(data, character, lmCtx, 512, strat, running);
        if (globalSummaryContext?.text) {
            const globalMemory: Memory = {
                id: uuidv4(),
                name: 'Global Memory',
                content: globalSummaryContext.text,
                interactionData: data,
                firstCreatedTimestamp: ts,
                lastUpdatedTimestamp: ts,
            };
            if (!character.memories) character.memories = {};
            character.memories.global = [globalMemory];
        }

        try { await saveRawCharacter(character); } catch (e) { console.warn('Failed to save character memories:', e); }
    }, []);

    // ─── Core Generation ─────────────────────────────────────────────

    const handleServerResponse = useCallback(async (
        data: InteractionData, character: Character, signal: AbortSignal,
        onToken?: (text: string) => void,
        strategy?: BudgetStrategy | null,
        existingCharacterText?: string,
    ): Promise<InteractionData | null> => {
        const pricing: ModelPricing = { cacheHitPerMillion: 0, cacheMissPerMillion: 0, outputPerMillion: 0 };
        const model = selectedModelRef.current;
        const running = runningModelsMapRef.current;
        const strat = strategy ?? activeStrategyRef.current;

        const dataWithRegen = regenerateStaminaForTurn(data, character);
        const maxPara = getDynamicParagraphLimit(character, dataWithRegen);

        try {
            let rawText: string;
            let currentExistingText = existingCharacterText || '';
            let accumulatedDisplayText = '';

            if (strat) {
                const loadLocalModel = async (modelId: string): Promise<number | null> => {
                    const existing = running[modelId];
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

                // ✅ Per-generation tool parser for real-time display filtering
                const streamToolParser = new ToolInvocationParser();
                let committedDisplayText = '';
                let liveDisplayText = '';
                let lastRawLength = 0;

                // ✅ Tool invocation loop for budget strategy path
                while (true) {
                    if (signal.aborted) return null;

                    // ✅ Use persistent budget data, lazy-load or auto-create if not yet available
                    let bd = budgetDataRef.current;
                    if (!bd) {
                        try {
                            bd = await loadRawBudgetData();
                        } catch (e) {
                            console.warn('Failed to load budget data:', e);
                        }
                        if (!bd) {
                            // Auto-create budget data from the active strategy with sensible defaults
                            
                            bd = DefaultBudgetData

                            try {
                                await saveRawBudgetData(bd);
                                setBudgetData(bd);
                                budgetDataRef.current = bd;
                                addToast('Budget tracking initialized with daily reset.', 'info');
                            } catch (e) {
                                console.error('Failed to create budget data:', e);
                                addToast('Failed to initialize budget tracking.', 'error');
                                return null;
                            }
                        } else {
                            setBudgetData(bd);
                            budgetDataRef.current = bd;
                        }
                    }

                    const bse = new BudgetStrategyEngine(strat, bd, running, loadLocalModel);
                    const cb: StreamCallbacks | undefined = onToken ? { onToken: async (s) => {
                        setGenerationSpeed(s.msPerToken);
                        if (s.timeToFirstToken > 0) setTimeToFirstToken(s.timeToFirstToken);

                        const newChunk = s.fullText.slice(lastRawLength);
                        lastRawLength = s.fullText.length;
                        const parsed = streamToolParser.processChunk(newChunk);
                        liveDisplayText += parsed.displayText;

                        const displayOut = committedDisplayText + liveDisplayText;
                        streamingTextRef.current = displayOut;
                        throttledSetStreamingText(displayOut);
                        onToken(displayOut);

                        const enableExpression = dataWithRegen.Profile?.enableCharacterExpression ?? false;
                        if (enableExpression && sentimentEngine.isReady() && s.fullText.length > 20) {
                            const sentiment = await sentimentEngine.analyze(s.fullText);
                            if (sentiment && sentiment.topEmotion !== previousExpressionRef.current) {
                                previousExpressionRef.current = sentiment.topEmotion;
                                setCurrentCharacterExpression(sentiment.topEmotion);
                            }
                        }
                    }} : undefined;
                    rawText = await bse.generateStream(dataWithRegen, character, { signal } as AbortController, cb);

                    // ✅ Persist updated budget data after generation
                    const updatedBd = bse.getBudgetData();
                    setBudgetData(updatedBd);
                    budgetDataRef.current = updatedBd;
                    await saveRawBudgetData(updatedBd);

                    const requestCost = updatedBd.budgetSpent - (bd.budgetSpent);
                    if (requestCost > 0) setStats(p => ({ ...p, numberOfRequests: p.numberOfRequests + 1, totalCost: p.totalCost + requestCost }));

                    const toolResult = await processToolInvocations(rawText, character, dataWithRegen.Profile);
                    if (!toolResult) {
                        accumulatedDisplayText = committedDisplayText + liveDisplayText;
                        break;
                    }

                    committedDisplayText += liveDisplayText;
                    for (const rep of toolResult.displayReplacements) {
                        if (rep.type === 'calculator') {
                            committedDisplayText += rep.value;
                        }
                    }
                    throttledSetStreamingText(committedDisplayText);
                    onToken?.(committedDisplayText);

                    liveDisplayText = '';
                    streamToolParser.reset();
                    currentExistingText = toolResult.resumeText;
                    lastRawLength = 0;
                }
            } else {
                if (!model) { if (!signal.aborted) addToast('No model selected.', 'error'); return null; }
                const port = model.id ? running[model.id]?.port : undefined;
                const ep = port || (model.parameters as any)?._runtimePort;
                if (!ep && !model.apiKey) { if (!signal.aborted) addToast('Model not ready.', 'error'); return null; }

                const lmCtx: LanguageModelContext = { apiKey: model.apiKey, backend: model.backend, modelPath: model.model, runtimePort: ep };

                const streamToolParser = new ToolInvocationParser();
                let committedDisplayText = '';
                let liveDisplayText = '';
                let lastRawLength = 0;

                const doStream = async (reqBody: any, ctx: LanguageModelContext) => {
                    const result = await languageModelEngine.generateStream(reqBody, { signal } as AbortController, {
                        onToken: async (s) => {
                            setGenerationSpeed(s.msPerToken);
                            if (s.timeToFirstToken > 0) setTimeToFirstToken(s.timeToFirstToken);

                            const newChunk = s.fullText.slice(lastRawLength);
                            lastRawLength = s.fullText.length;
                            const parsed = streamToolParser.processChunk(newChunk);
                            liveDisplayText += parsed.displayText;

                            const displayOut = committedDisplayText + liveDisplayText;
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
                        onFinish: (rs) => {
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
                        const rp = model.id ? running[model.id]?.port : undefined;
                        const rep = rp || (model.parameters as any)?._runtimePort;
                        const { body: rb } = await prepareRequestBody(dataWithRegen, character, currentExistingText, rep);
                        const rc: LanguageModelContext = { apiKey: model.apiKey, backend: model.backend, modelPath: model.model, runtimePort: rep };
                        rawText = await doStream(rb, rc);
                        if (!rawText || !rawText.trim()) return null;
                    }

                    const toolResult = await processToolInvocations(rawText, character, dataWithRegen.Profile);
                    if (!toolResult) {
                        accumulatedDisplayText = committedDisplayText + liveDisplayText;
                        break;
                    }

                    committedDisplayText += liveDisplayText;
                    for (const rep of toolResult.displayReplacements) {
                        if (rep.type === 'calculator') {
                            committedDisplayText += rep.value;
                        }
                    }
                    throttledSetStreamingText(committedDisplayText);
                    onToken?.(committedDisplayText);

                    liveDisplayText = '';
                    streamToolParser.reset();
                    currentExistingText = toolResult.resumeText;
                    lastRawLength = 0;
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
                if (sentiment) {
                    aiMessage.characterExpression = sentiment.topEmotion;
                }
            }

            return addMessageToInteractionData(dataWithRegen, aiMessage);
        } catch (err) {
            const e = err as Error;
            const pt = streamingTextRef.current;
            const pc = streamingCharacterRef.current;
            if (pt?.trim() && pc) pendingPartialRef.current = { text: pt, character: pc };
            if (e.name === 'AbortError') return null;
            const isNet = ['Failed to fetch', 'NetworkError', 'ERR_ABORTED', '502', '503', '504'].some(s => e.message.includes(s));
            if (isNet) { if (!signal.aborted) addToast('⚠️ Backend Connection Failed.', 'error'); return null; }
            console.error('Inference failed:', e);
            if (!signal.aborted) addToast(`Inference Error: ${e.message}`, 'error');
            return null;
        }
    }, [addToast, getDynamicParagraphLimit, throttledSetStreamingText, countParagraphs, regenerateStaminaForTurn, processMemoryTrigger]);

    // ─── Pending Partial Helper ──────────────────────────────────────

    const applyPendingPartial = useCallback(async (base: InteractionData, protagonistId: string): Promise<InteractionData> => {
        const p = pendingPartialRef.current; if (!p) return base;
        pendingPartialRef.current = null;
        const dt = convertIdsToDisplayNames(p.text, base);
        const h = base.interactionHistory;
        if (h.length > 0 && h[h.length - 1].character.id !== protagonistId) {
            const ph = [...h]; ph[ph.length - 1] = { ...ph[ph.length - 1], textContent: dt, isPartial: true };
            return { ...base, interactionHistory: ph, lastUpdatedTimestamp: Date.now() };
        }
        return addMessageToInteractionData(base, createChatMessage(base, p.character, dt, { isPartial: true }));
    }, []);

    // ─── Public Actions ──────────────────────────────────────────────

    const updateRunningModels = useCallback((m: Record<string, { isRunning: boolean; port?: number }>) => setRunningModelsMap(m), []);

    const setActiveBudgetStrategy = useCallback((s: BudgetStrategy | null) => {
        const newId = s?.id ?? null;
        if (newId !== activeStrategyIdRef.current) {
            activeStrategyIdRef.current = newId;
        }
        setActiveStrategy(s);
    }, []);

    const setSelectedGlobalModel = useCallback((m: LanguageModel | null) => setSelectedModel(m), []);

    const startNewChat = useCallback((char: Character) => {
        const c = createNewInteractionData(char); 
        c.name = 'Untitled Chat';
        setInteractionData(c); 
        setCurrentCharacter(char); 
        setIsInitialImageProcessed(false); 
        isAtBottomRef.current = true;
    }, []);

    const stopGeneration = useCallback(() => {
        const t = streamingTextRef.current, c = streamingCharacterRef.current;
        const resumeId = resumingMessageIdRef.current;

        if (resumeId && t && t.trim().length > 0 && interactionDataRef.current) {
            const updated = editInteractionMessageInInteractionData(interactionDataRef.current, resumeId, t);
            const idx = updated.interactionHistory.findIndex(m => m.id === resumeId);
            if (idx !== -1) {
                const paragraphs = countParagraphs(t);
                if (paragraphs > 0) consumeChatStamina(updated.interactionHistory[idx], paragraphs);
                const withPartial = [...updated.interactionHistory];
                withPartial[idx] = { ...withPartial[idx], isPartial: true, lastUpdatedTimestamp: Date.now() };
                const final: InteractionData = { ...updated, interactionHistory: withPartial, lastUpdatedTimestamp: Date.now() };
                setInteractionData(final);
                interactionDataRef.current = final;
            }
            resumingMessageIdRef.current = null;
            resumingExistingTextRef.current = '';
            pendingPartialRef.current = null;
        } else {
            pendingPartialRef.current = (t && t.trim() && c) ? { text: t, character: c } : null;
        }

        abortControllerRef.current?.abort(); abortControllerRef.current = null;
        releaseLock(); setGenerationSpeed(0);
    }, [releaseLock, countParagraphs]);

    const sendActionAndGetResponse = useCallback(async (actionText: string, targetChar: Character) => {
        if (!interactionData || !currentCharacter) return;
        if (isLoadingRef.current) { abortControllerRef.current?.abort(); abortControllerRef.current = null; await new Promise(r => setTimeout(r, 300)); }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!activeStrategyRef.current && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }
        const d = interactionDataRef.current; if (!d) { releaseLock(); return; }
        let ud = addMessageToInteractionData(d, createChatMessage(d, currentCharacter, actionText));

        const hasLocations = ud.locations && ud.locations.length > 0;
        if (hasLocations) {
            const protagonistMsg = ud.interactionHistory[ud.interactionHistory.length - 1];
            if (protagonistMsg && protagonistMsg.character.id === currentCharacter.id && hasTextContent(protagonistMsg)) {
                const currentLoc = getCurrentLocationIndex(ud, currentCharacter);
                const regexLoc = findLocationByRegex(ud.locations, (protagonistMsg as any).textContent, currentCharacter);
                const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                ud = {
                    ...ud,
                    interactionHistory: ud.interactionHistory.map((m, i) =>
                        i === ud.interactionHistory.length - 1 ? { ...m, locationIndex: finalLoc } : m
                    ),
                };
            }
        }

        await saveRawInteractionData(ud); 
        setInteractionData(ud); 
        interactionDataRef.current = ud;
        
        await new Promise(r => setTimeout(r, 50));
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        setStreamingText(''); streamingTextRef.current = ''; pendingStreamingTextRef.current = '';
        setStreamingCharacter(targetChar); streamingCharacterRef.current = targetChar;
        setGenerationSpeed(0); setTimeToFirstToken(0); isAtBottomRef.current = true;
        try {
            const result = await handleServerResponse(ud, targetChar, ctrl.signal, throttledSetStreamingText, undefined, '');
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(result || ud, currentCharacter.id); await saveRawInteractionData(fd); setInteractionData(fd); interactionDataRef.current = fd; return; }
            if (result) { 
                await saveRawInteractionData(result); 
                setInteractionData(result); 
                interactionDataRef.current = result; 
                const lm = result.interactionHistory[result.interactionHistory.length - 1]; 
                if (lm && lm.character.id !== currentCharacter?.id) speakMessage(lm.textContent, lm.character); 
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') console.error('AI response failed:', e); }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [interactionData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration, acquireLock, releaseLock, speakMessage, applyPendingPartial, throttledSetStreamingText]);

    const sendMessage = useCallback(async (text: string, files?: File[]) => {
        if (!interactionData || !currentCharacter || (!text.trim() && (!files || !files.length))) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        if (!activeStrategyRef.current && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        setStreamingText(''); streamingTextRef.current = ''; pendingStreamingTextRef.current = '';
        setStreamingCharacter(null); streamingCharacterRef.current = null;
        setGenerationSpeed(0); setTimeToFirstToken(0); isAtBottomRef.current = true;
        try {
            const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;
            const chatMessage = createChatMessage(interactionData, currentCharacter, text, { files: encodedFiles });
            let td = addMessageToInteractionData(interactionData, chatMessage);

            const hasLocations = td.locations && td.locations.length > 0;
            if (hasLocations) {
                const protagonistMsg = td.interactionHistory[td.interactionHistory.length - 1];
                if (protagonistMsg && protagonistMsg.character.id === currentCharacter.id && hasTextContent(protagonistMsg)) {
                    const currentLoc = getCurrentLocationIndex(td, currentCharacter);
                    const regexLoc = findLocationByRegex(td.locations, (protagonistMsg as any).textContent, currentCharacter);
                    const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                    td = {
                        ...td,
                        interactionHistory: td.interactionHistory.map((m, i) =>
                            i === td.interactionHistory.length - 1 ? { ...m, locationIndex: finalLoc } : m
                        ),
                    };
                }
            }

            setInteractionData(td); interactionDataRef.current = td; 
            await saveRawInteractionData(td);
            
            const executor = async (d: InteractionData, c: Character, s: AbortSignal, ot: (t: string) => void) => {
                setStreamingText(''); streamingTextRef.current = ''; pendingStreamingTextRef.current = '';
                setStreamingCharacter(c); streamingCharacterRef.current = c;
                return handleServerResponse(d, c, s, ot, undefined, '');
            };
            const ud = await runTurnSequence(td, executor, ctrl, setStreamingCharacter, throttledSetStreamingText, setInteractionData);
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, currentCharacter.id); await saveRawInteractionData(fd); setInteractionData(fd); interactionDataRef.current = fd; return; }
            if (ud.interactionHistory.length > td.interactionHistory.length) {
                await saveRawInteractionData(ud); setInteractionData(ud); interactionDataRef.current = ud;
                runBackgroundSummarization(ud, setInteractionData, interactionDataRef, selectedModelRef, runningModelsMapRef, addToast, activeStrategyRef.current);
                const lm = ud.interactionHistory[ud.interactionHistory.length - 1];
                if (lm && lm.character.id !== currentCharacter?.id) speakMessage(lm.textContent, lm.character);
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud; await saveRawInteractionData(sd); setInteractionData(sd); interactionDataRef.current = sd;
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Send failed:', e); addToast(`Send failed: ${(e as Error).message}`, 'error'); } }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [interactionData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration, acquireLock, releaseLock, generateAmbientNarration, speakMessage, applyPendingPartial, throttledSetStreamingText]);

    // ─── Resume Generation ───────────────────────────────────────────

    const resumeGeneration = useCallback(async (messageId: string) => {
        if (!interactionData) return;
        const msgIndex = interactionData.interactionHistory.findIndex(m => m.id === messageId);
        if (msgIndex === -1) { addToast('Message not found.', 'error'); return; }
        const msg = interactionData.interactionHistory[msgIndex];
        if (!msg.isPartial) { addToast('Not partial — use Regenerate.', 'info'); return; }
        if (isLoadingRef.current) {
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
            await new Promise(r => setTimeout(r, 100));
        }
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }
        const model = selectedModelRef.current;
        if (!isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }

        const existingText = msg.textContent;
        const char = msg.character;

        resumingMessageIdRef.current = messageId;
        resumingExistingTextRef.current = existingText;

        const dataWithRegen = regenerateStaminaForTurn(interactionData, char);

        const ctrl = new AbortController(); abortControllerRef.current = ctrl;

        setStreamingText(existingText); streamingTextRef.current = existingText; pendingStreamingTextRef.current = existingText;
        setStreamingCharacter(char); streamingCharacterRef.current = char;
        setGenerationSpeed(0); setTimeToFirstToken(0); isAtBottomRef.current = true;

        try {
            const port = model?.id ? runningModelsMapRef.current[model.id]?.port : undefined;
            const ep = port || (model?.parameters as any)?._runtimePort;
            if (!ep && !model?.apiKey) { addToast('Model not ready.', 'error'); releaseLock(); return; }

            const { body } = await prepareRequestBody(dataWithRegen, char, existingText, ep);
            const lmCtx: LanguageModelContext = { apiKey: model?.apiKey, backend: model?.backend, modelPath: model?.model, runtimePort: ep };

            const result = await languageModelEngine.generateStream(body, ctrl, {
                onToken: async (s) => {
                    setGenerationSpeed(s.msPerToken);
                    if (s.timeToFirstToken > 0) setTimeToFirstToken(s.timeToFirstToken);
                    const displayText = existingText + s.fullText;
                    streamingTextRef.current = displayText;
                    throttledSetStreamingText(displayText);

                    const enableExpression = dataWithRegen.Profile?.enableCharacterExpression ?? false;
                    if (enableExpression && sentimentEngine.isReady() && displayText.length > 20) {
                        const sentiment = await sentimentEngine.analyze(displayText);
                        if (sentiment && sentiment.topEmotion !== previousExpressionRef.current) {
                            previousExpressionRef.current = sentiment.topEmotion;
                            setCurrentCharacterExpression(sentiment.topEmotion);
                        }
                    }
                },
            }, lmCtx, getDynamicParagraphLimit(char, dataWithRegen));

            const rawOutput = result.text;

            if (!rawOutput?.trim()) { addToast('Resume produced no output.', 'info'); return; }

            const newText = rawOutput.startsWith(existingText) ? rawOutput.slice(existingText.length) : rawOutput;
            if (!newText.trim()) { addToast('No new content generated.', 'info'); return; }

            const combined = existingText + convertIdsToDisplayNames(newText, dataWithRegen);

            const edited = await editMessage(dataWithRegen, messageId, combined);

            const existingParagraphs = countParagraphs(existingText);
            const totalParagraphs = countParagraphs(combined);
            const newParagraphs = Math.max(0, totalParagraphs - existingParagraphs);
            if (newParagraphs > 0) {
                const editedIdx = edited.interactionHistory.findIndex(m => m.id === messageId);
                if (editedIdx !== -1) consumeChatStamina(edited.interactionHistory[editedIdx], newParagraphs);
            }

            const enableExpression = dataWithRegen.Profile?.enableCharacterExpression ?? false;
            if (enableExpression && sentimentEngine.isReady()) {
                const sentiment = await sentimentEngine.analyze(rawOutput);
                if (sentiment) {
                    const editedIdx = edited.interactionHistory.findIndex(m => m.id === messageId);
                    if (editedIdx !== -1) {
                        (edited.interactionHistory[editedIdx] as ChatMessage).characterExpression = sentiment.topEmotion;
                    }
                }
            }

            if (result.isCompleted) {
                const finalData = await clearPartialFlag(edited, messageId);
                setInteractionData(finalData); interactionDataRef.current = finalData;
                await saveRawInteractionData(finalData);
            } else {
                setInteractionData(edited); interactionDataRef.current = edited;
                await saveRawInteractionData(edited);
            }

            if (char.id !== interactionData.protagonist.id) speakMessage(combined, char);
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                console.error('Resume failed:', e);
                addToast(`Resume error: ${(e as Error).message}`, 'error');
                const currentStreamedText = streamingTextRef.current;
                if (currentStreamedText && currentStreamedText.trim().length > 0 && currentStreamedText !== existingText) {
                    try {
                        const currentData = interactionDataRef.current || dataWithRegen;
                        await editMessage(currentData, messageId, currentStreamedText);
                        await saveRawInteractionData(currentData);
                    } catch { }
                }
            }
            pendingPartialRef.current = null;
        } finally {
            if (abortControllerRef.current === ctrl) abortControllerRef.current = null;
            releaseLock();
        }
    }, [interactionData, addToast, isModelReadyForGeneration, acquireLock, releaseLock, getDynamicParagraphLimit, throttledSetStreamingText, speakMessage, countParagraphs, regenerateStaminaForTurn]);

    // ─── Regenerate ──────────────────────────────────────────────────

    const regenerateFromMessage = useCallback(async (messageId: string, type: 'ai' | 'user') => {
        if (!interactionData || !acquireLock()) { addToast(acquireLock() ? 'Chat data missing.' : 'Already generating...', 'info'); return; }
        if (!activeStrategyRef.current && !isModelReadyForGeneration()) { addToast('Model not ready.', 'error'); releaseLock(); return; }
        const history = interactionData.interactionHistory;
        const ti = history.findIndex(m => m.id === messageId);
        if (ti === -1) { addToast('Message not found.', 'error'); releaseLock(); return; }
        const tm = history[ti];
        const isAI = tm.character.id !== interactionData.protagonist.id;
        let trimIdx: number;
        if (type === 'ai' && isAI) trimIdx = ti;
        else if (type === 'user' && !isAI) trimIdx = ti + 1;
        else { addToast('Mismatched regeneration type.', 'error'); releaseLock(); return; }
        const toDelete = history.slice(trimIdx);
        if (toDelete.length) try { await Promise.all(toDelete.map(m => deleteRawInteractionMessage(m.id))); } catch (e) { console.error('Delete failed:', e); }
        const td: InteractionData = { ...interactionData, interactionHistory: history.slice(0, trimIdx), lastUpdatedTimestamp: Date.now() };
        setInteractionData(td); interactionDataRef.current = td;
        await saveRawInteractionData(td);
        
        setStreamingText(''); streamingTextRef.current = ''; pendingStreamingTextRef.current = '';
        setStreamingCharacter(null); streamingCharacterRef.current = null;
        setGenerationSpeed(0); setTimeToFirstToken(0); isAtBottomRef.current = true;
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        const preCount = td.interactionHistory.length;
        try {
            const executor = async (d: InteractionData, c: Character, s: AbortSignal, ot: (t: string) => void) => {
                setStreamingText(''); streamingTextRef.current = ''; pendingStreamingTextRef.current = '';
                setStreamingCharacter(c); streamingCharacterRef.current = c;
                return handleServerResponse(d, c, s, ot, undefined, '');
            };
            const ud = await runTurnSequence(td, executor, ctrl, setStreamingCharacter, throttledSetStreamingText, setInteractionData);
            if (pendingPartialRef.current) { const fd = await applyPendingPartial(ud, interactionData.protagonist.id); await saveRawInteractionData(fd); setInteractionData(fd); interactionDataRef.current = fd; return; }
            if (ud.interactionHistory.length > preCount) {
                await saveRawInteractionData(ud); setInteractionData(ud); interactionDataRef.current = ud;
                runBackgroundSummarization(ud, setInteractionData, interactionDataRef, selectedModelRef, runningModelsMapRef, addToast, activeStrategyRef.current);
                const lm = ud.interactionHistory[ud.interactionHistory.length - 1] as ChatMessage;
                if (lm && lm.character.id !== currentCharacter?.id) speakMessage(lm.textContent, lm.character);
            } else {
                const ad = await generateAmbientNarration(ud, ctrl.signal);
                const sd = ad || ud; await saveRawInteractionData(sd); setInteractionData(sd); interactionDataRef.current = sd;
            }
        } catch (e) { if ((e as Error).name !== 'AbortError') { console.error('Regen failed:', e); addToast(`Regen error: ${(e as Error).message}`, 'error'); } }
        finally { if (abortControllerRef.current === ctrl) abortControllerRef.current = null; releaseLock(); }
    }, [interactionData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration, acquireLock, releaseLock, generateAmbientNarration, speakMessage, applyPendingPartial, throttledSetStreamingText]);

    // ─── Silent Image Processing ─────────────────────────────────────

    const processProtagonistImageSilently = useCallback(async (data: InteractionData, char: Character) => {
        if (!data?.Profile?.forceNoCharacterImageInjection && Object.keys(char.images || {}).length === 0) { setIsInitialImageProcessed(true); return; }
        if (!isModelReadyForGeneration() || isLoadingRef.current || isProcessingSilentlyRef.current) { setIsInitialImageProcessed(true); return; }
        isProcessingSilentlyRef.current = true;
        const s = char.sampler;
        const silent: Character = { ...char, sampler: { ...s, id: s?.id || uuidv4(), name: s?.name || 'silent', maximumNumberOfTokens: 0, parameters: { ...s?.parameters, n_predict: 0 }, stopPatterns: [], firstCreatedTimestamp: s?.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: Date.now() } };
        try { await handleServerResponse(data, silent, new AbortController().signal, undefined, undefined, ''); }
        catch (e) { console.warn('Silent image processing failed:', e); }
        finally { isProcessingSilentlyRef.current = false; setIsInitialImageProcessed(true); }
    }, [handleServerResponse, isModelReadyForGeneration]);

    // ─── Scroll Tracking ────────────────────────────────────────────

    useEffect(() => {
        const el = chatHistoryRef.current; if (!el) return;
        const fn = () => { isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
        el.addEventListener('scroll', fn, { passive: true }); return () => el.removeEventListener('scroll', fn);
    }, []);

    useEffect(() => {
        if (!isAtBottomRef.current) return;
        if (isLoading && streamingText && messageEndRef.current) messageEndRef.current.scrollIntoView({ behavior: 'auto' });
        else if (!isLoading && messageEndRef.current && interactionData?.interactionHistory.length) messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }, [streamingText, isLoading, interactionData?.interactionHistory.length]);

    // ─── Return ──────────────────────────────────────────────────────

    const maxCtx = selectedModel?.contextLength || 8192;

    return {
        interactionData, setInteractionData, currentCharacter, setCurrentCharacter,
        isLoading, streamingText, streamingCharacter, currentCharacterExpression,
        sendMessage, stopGeneration, resumeGeneration, regenerateFromMessage,
        messageEndRef, chatHistoryRef, parentInteractionMessageIds,
        generationSpeed, timeToFirstToken, numberOfMessages: interactionData?.interactionHistory.length || 0,
        numberOfTokens, maximumNumberOfTokens: maxCtx, startNewChat,
        sendActionAndGetResponse, setActiveBudgetStrategy, setSelectedGlobalModel, updateRunningModels,
        activeStrategy, budgetData,
        numberOfCacheInvalidations: stats.numberOfCacheInvalidations,
        numberOfRequests: stats.numberOfRequests,
        totalCost: stats.totalCost,
        costWithoutCacheMisses: stats.costWithoutCacheMisses,
        processProtagonistImageSilently,
    };
}