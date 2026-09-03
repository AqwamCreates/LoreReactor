// src/hooks/storage.ts
import type {
  StopPattern, RawStopPattern, Sampler, RawSampler, Context, RawContext, LanguageModel, RawLanguageModel,
  Character, RawCharacter, ChatMessage, RawChatMessage, ChatData, RawChatData,
  BudgetStrategy, RawBudgetStrategy, InterjectableAction, Profile, RawProfile,
  SummarizationStep, RawSummarizationStep, Webpage, RawWebpage,
  Memory, RawMemory
} from '../types';

import { localURL } from '../configurations';
import { v4 as uuidv4 } from 'uuid';

const now = Date.now();

const DefaultSampler: Sampler = {
  id: "default-sampler",
  name: "Default",
  description: "Fallback sampler",
  parameters: { temperature: 0.8, top_k: 40, repeat_penalty: 1.15, n_predict: 512, stop: [], frequency_penalty: 0.0, presence_penalty: 0.0 },
  stopPatterns: [],
  maximumNumberOfTokens: 512,
  firstCreatedTimestamp: now,
  lastUpdatedTimestamp: now,
};

const DefaultModel: LanguageModel = {
  id: "default-model",
  name: "Default Model",
  description: "Fallback model",
  contextLength: 4096,
  firstCreatedTimestamp: now,
  lastUpdatedTimestamp: now,
};

const DEFAULT_ACTIONS: InterjectableAction[] = [
  { label: 'Hug', count: 0 }, { label: 'Kiss At', count: 0 }, { label: 'Slap', count: 0 },
  { label: 'Push Away', count: 0 }, { label: 'Touch', count: 0 }, { label: 'Grab', count: 0 },
  { label: 'Wave At', count: 0 }, { label: 'Poke', count: 0 }, { label: 'Fish', count: 0 },
  { label: 'Dance Near', count: 0 }, { label: 'Sing To', count: 0 }, { label: 'Whisper At', count: 0 },
  { label: 'Shout At', count: 0 }, { label: 'Whistle', count: 0 }, { label: 'Cough At', count: 0 },
  { label: 'Sneeze At', count: 0 }, { label: 'Laugh At', count: 0 }, { label: 'Cry At', count: 0 },
  { label: 'Sigh At', count: 0 }, { label: 'Stretch', count: 0 }, { label: 'Yawn At', count: 0 },
  { label: 'Bow At', count: 0 }, { label: 'Nod At', count: 0 }, { label: 'Shake At', count: 0 },
  { label: 'Point At', count: 0 }, { label: 'Wink At', count: 0 }, { label: 'Blush At', count: 0 },
  { label: 'Frown At', count: 0 }, { label: 'Smile At', count: 0 }, { label: 'Grin At', count: 0 },
  { label: 'Pout At', count: 0 }
];

function getDefaultSummarizationSteps(): SummarizationStep[] {
  const ts = Date.now();
  return [
    { id: 'step-sliding-window', name: 'Sliding Window Replace', strategyType: 'Sliding Window Replace', enabled: true, order: 0, slidingWindowSize: 10, summaryTokenBudget: 256, triggerTokenThreshold: 0, firstCreatedTimestamp: ts, lastUpdatedTimestamp: ts },
    { id: 'step-periodic-compression', name: 'Periodic Compression', strategyType: 'Periodic Compression', enabled: false, order: 1, compressionInterval: 20, compressionChunkSize: 10, summaryTokenBudget: 512, triggerTokenThreshold: 0, firstCreatedTimestamp: ts, lastUpdatedTimestamp: ts },
    { id: 'step-recursive-summary', name: 'Recursive Summary', strategyType: 'Recursive Summary', enabled: false, order: 2, recursiveChunkSize: 10, recursiveMaxDepth: 3, summaryTokenBudget: 1024, triggerTokenThreshold: 0, firstCreatedTimestamp: ts, lastUpdatedTimestamp: ts },
    { id: 'step-observation-masking', name: 'Observation Masking', strategyType: 'Observation Masking', enabled: false, order: 3, maskingRelevanceThreshold: 0.3, maskingKeywordWeight: 0.7, triggerTokenThreshold: 0, firstCreatedTimestamp: ts, lastUpdatedTimestamp: ts },
  ];
}

const PATHS = {
  characters: "/user_data/character_data",
  characterImages: "/user_data/character_images",
  characterVoices: "/user_data/character_voices",
  samplers: "/user_data/sampler_data",
  contexts: "/user_data/context_data",
  models: "/user_data/model_data",
  stopPatterns: "/user_data/stop_pattern_data",
  chatMessages: "/user_data/chat_messages",
  chatData: "/user_data/chat_data",
  kvCaches: "/user_data/kv_caches",
  budgetStrategies: "/user_data/budget_strategies",
  profiles: "/user_data/profile_data",
  webpages: "/user_data/webpage_data",
  memories: "/user_data/memory_data",
  actions: "/user_data/actions.json",
};
const MANIFEST_FILE = 'manifest.json';

// --- Generic Helpers ---

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    const targetUrl = `${localURL}${cleanUrl}`;
    const response = await fetch(targetUrl);
    if (!response.ok) {
      if (response.status === 404) return null;
      console.warn(`HTTP Error ${response.status} for ${url}`);
      return null;
    }
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  } catch (error) {
    if ((error as Error).message.includes('Failed to fetch')) { /* network */ }
    else console.warn(`Failed to parse JSON from ${url}:`, error);
    return null;
  }
}

async function putJson<T>(url: string, data: T): Promise<void> {
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const targetUrl = `${localURL}${cleanUrl}`;
  const response = await fetch(targetUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(`Failed to save data to ${targetUrl}: HTTP ${response.status}`);
}

async function deleteResource(url: string): Promise<void> {
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const targetUrl = `${localURL}${cleanUrl}`;
  const response = await fetch(targetUrl, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Failed to delete resource at ${targetUrl}: HTTP ${response.status}`);
}

async function updateManifest(folderPath: string, id: string, action: 'add' | 'remove'): Promise<void> {
  const manifestUrl = `${folderPath}/${MANIFEST_FILE}`;
  let currentIds = await fetchJson<string[]>(manifestUrl);
  if (!currentIds || !Array.isArray(currentIds)) currentIds = [];
  let newIds: string[];
  if (action === 'add') { if (currentIds.includes(id)) return; newIds = [...currentIds, id]; }
  else newIds = currentIds.filter(existingId => existingId !== id);
  await putJson(manifestUrl, newIds);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const result = reader.result as string; resolve(result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadInBatches<T>(ids: string[], loader: (id: string) => Promise<T | null>, batchSize: number = 5): Promise<(T | null)[]> {
  const results: (T | null)[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(loader));
    results.push(...batchResults);
    if (i + batchSize < ids.length) await new Promise(resolve => setTimeout(resolve, 10));
  }
  return results;
}

// --- Memory Repository ---

export async function loadRawMemoryManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.memories}/${MANIFEST_FILE}`) || [];
}

export async function loadRawMemory(id: string): Promise<Memory | null> {
  const raw = await fetchJson<RawMemory>(`${PATHS.memories}/${id}.json`);
  if (!raw) return null;
  const ts = Date.now();
  return {
    id,
    name: raw.name || 'Untitled Memory',
    description: raw.description,
    content: raw.content,
    chatData: undefined as unknown as ChatData, // Deferred — resolved via resolveMemoryChatData
    firstCreatedTimestamp: raw.firstCreatedTimestamp || ts,
    lastUpdatedTimestamp: raw.lastUpdatedTimestamp || ts,
  };
}

export async function loadAllRawMemories(): Promise<Memory[]> {
  const ids = await loadRawMemoryManifest();
  const results = await loadInBatches(ids, loadRawMemory);
  return results.filter((m): m is Memory => m !== null);
}

export async function saveRawMemory(memory: Memory): Promise<void> {
  const { id, chatData, ...rest } = memory;
  const payload: RawMemory = {
    ...rest,
    chatDataId: chatData?.id ?? '',
    lastUpdatedTimestamp: Date.now(),
  };
  await putJson(`${PATHS.memories}/${id}.json`, payload);
  await updateManifest(PATHS.memories, id, 'add');
}

export async function deleteRawMemory(id: string): Promise<void> {
  await deleteResource(`${PATHS.memories}/${id}.json`);
  await updateManifest(PATHS.memories, id, 'remove');
}

/**
 * Resolves deferred chatData references in a character's memories.
 * Call only when entering editor/UI inspection — never during prompt building.
 */
export function resolveMemoryChatData(character: Character, allChats: ChatData[]): Character {
  if (!character.memories || Object.keys(character.memories).length === 0) return character;
  const chatMap = new Map(allChats.map(c => [c.id, c]));
  const resolved: Record<string, Memory[]> = {};
  for (const [key, mems] of Object.entries(character.memories)) {
    resolved[key] = mems.map(m => ({
      ...m,
      chatData: m.chatData ?? chatMap.get((m as any)._chatDataId) ?? undefined,
    }));
  }
  return { ...character, memories: resolved };
}

// --- Memory Hydration Helpers ---

async function hydrateMemories(rawMemoryIds: Record<string, string[]> | undefined): Promise<Record<string, Memory[]>> {
  const memories: Record<string, Memory[]> = {};
  if (!rawMemoryIds) return memories;
  for (const [key, ids] of Object.entries(rawMemoryIds)) {
    const loaded: Memory[] = [];
    for (const id of ids) {
      const mem = await loadRawMemory(id);
      if (mem) loaded.push(mem);
    }
    memories[key] = loaded;
  }
  return memories;
}

async function serializeMemories(memories: Record<string, Memory[]> | undefined): Promise<Record<string, string[]>> {
  const rawMemories: Record<string, string[]> = {};
  if (!memories) return rawMemories;
  for (const [key, mems] of Object.entries(memories)) {
    const ids: string[] = [];
    for (const mem of mems) {
      await saveRawMemory(mem);
      ids.push(mem.id);
    }
    rawMemories[key] = ids;
  }
  return rawMemories;
}

// --- Stop Pattern Repository ---
export async function loadRawStopPatternManifest(): Promise<string[]> { return await fetchJson<string[]>(`${PATHS.stopPatterns}/${MANIFEST_FILE}`) || []; }
export async function loadRawStopPattern(id: string): Promise<StopPattern | null> {
  const raw = await fetchJson<RawStopPattern>(`${PATHS.stopPatterns}/${id}.json`);
  if (!raw) return null;
  return { id, name: raw.name || 'Unknown Pattern', description: raw.description, pattern: raw.pattern, regularExpressionTrigger: raw.regularExpressionTrigger, regularExpressionContext: raw.regularExpressionContext, regularExpressionTarget: raw.regularExpressionTarget, firstCreatedTimestamp: raw.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: raw.lastUpdatedTimestamp || Date.now() };
}
export async function loadAllRawStopPatterns(): Promise<StopPattern[]> { const ids = await loadRawStopPatternManifest(); return (await loadInBatches(ids, loadRawStopPattern)).filter((p): p is StopPattern => p !== null); }
export async function saveRawStopPattern(pattern: StopPattern): Promise<void> { const { id, ...raw } = pattern; await putJson(`${PATHS.stopPatterns}/${id}.json`, { ...raw, lastUpdatedTimestamp: Date.now() }); await updateManifest(PATHS.stopPatterns, id, 'add'); }
export async function deleteRawStopPattern(id: string): Promise<void> { await deleteResource(`${PATHS.stopPatterns}/${id}.json`); await updateManifest(PATHS.stopPatterns, id, 'remove'); }

// --- Sampler Repository ---
export async function loadRawSamplerManifest(): Promise<string[]> { return await fetchJson<string[]>(`${PATHS.samplers}/${MANIFEST_FILE}`) || []; }
export async function loadRawSampler(id: string): Promise<Sampler | null> {
  try {
    const raw = await fetchJson<RawSampler>(`${PATHS.samplers}/${id}.json`);
    if (!raw) return null;
    const spIds = raw.stopPatternIds || [];
    const sps = (await Promise.all(spIds.map(sid => loadRawStopPattern(sid)))).filter((p): p is StopPattern => p !== null);
    return { id, name: raw.name || 'Unknown Sampler', description: raw.description, parameters: raw.parameters || {}, maximumNumberOfTokens: raw.maximumNumberOfTokens, stopPatterns: sps, firstCreatedTimestamp: raw.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: raw.lastUpdatedTimestamp || Date.now() };
  } catch (e) { console.warn(`Failed to load sampler ${id}`, e); return null; }
}
export async function loadAllRawSamplers(): Promise<Sampler[]> { const ids = await loadRawSamplerManifest(); return (await loadInBatches(ids, loadRawSampler)).filter((s): s is Sampler => s !== null); }
export async function saveRawSampler(sampler: Sampler): Promise<void> { const { id, stopPatterns, ...raw } = sampler; await putJson(`${PATHS.samplers}/${id}.json`, { ...raw, stopPatternIds: stopPatterns.map(sp => sp.id), lastUpdatedTimestamp: Date.now() } as RawSampler); await updateManifest(PATHS.samplers, id, 'add'); }
export async function deleteRawSampler(id: string): Promise<void> { await deleteResource(`${PATHS.samplers}/${id}.json`); await updateManifest(PATHS.samplers, id, 'remove'); }

// --- Character Repository ---
export async function loadRawCharacterManifest(): Promise<string[]> { return await fetchJson<string[]>(`${PATHS.characters}/${MANIFEST_FILE}`) || []; }
export async function loadRawCharacter(id: string): Promise<Character | null> {
  try {
    const raw = await fetchJson<RawCharacter>(`${PATHS.characters}/${id}.json`);
    if (!raw) return null;
    let sampler: Sampler = DefaultSampler;
    if (raw.samplerId) { const loaded = await loadRawSampler(raw.samplerId); if (loaded) sampler = loaded; }
    const ts = Date.now();
    const memories = await hydrateMemories(raw.memories);
    return {
      id, name: raw.name || 'Unknown Character', image: raw.image, voice: raw.voice, description: raw.description,
      systemPrompt: raw.systemPrompt, thinkPrompt: raw.thinkPrompt, appearancePrompt: raw.appearancePrompt, dialoguePrompt: raw.dialoguePrompt,
      initiativeWeight: raw.initiativeWeight, chatProbability: raw.chatProbability, maximumChatStamina: raw.maximumChatStamina,
      sampler, doNotInjectCharacterImage: raw.doNotInjectCharacterImage,
      numberOfMessagesToDisableThinkPrompt: raw.numberOfMessagesToDisableThinkPrompt || 1,
      numberOfMessagesToDisableMetaThinkInstructions: raw.numberOfMessagesToDisableMetaThinkInstructions || 1,
      numberOfMessagesToDisableDialoguePrompt: raw.numberOfMessagesToDisableDialoguePrompt || 1,
      memories,
      firstCreatedTimestamp: raw.firstCreatedTimestamp || ts,
      lastUpdatedTimestamp: raw.lastUpdatedTimestamp || ts,
    };
  } catch (e) { console.warn(`Failed to load character ${id}`, e); return null; }
}
export async function loadAllRawCharacters(): Promise<Character[]> { const ids = await loadRawCharacterManifest(); return (await loadInBatches(ids, loadRawCharacter)).filter((c): c is Character => c !== null); }
export async function saveRawCharacter(character: Character): Promise<void> {
  const { id, sampler, memories, ...rest } = character;
  const serializedMemories = await serializeMemories(memories);
  await putJson(`${PATHS.characters}/${id}.json`, { ...rest, samplerId: sampler?.id, memories: serializedMemories, lastUpdatedTimestamp: Date.now() } as RawCharacter);
  await updateManifest(PATHS.characters, id, 'add');
}
export async function deleteRawCharacter(id: string): Promise<void> { await deleteResource(`${PATHS.characters}/${id}.json`); await updateManifest(PATHS.characters, id, 'remove'); }

export async function loadCharacterShell(id: string): Promise<Character | null> {
  const raw = await fetchJson<RawCharacter>(`${PATHS.characters}/${id}.json`);
  if (!raw) return null;
  const ts = Date.now();
  // Shell: hydrate memories but skip sampler
  const memories = await hydrateMemories(raw.memories);
  return {
    id, name: raw.name || 'Unknown Character', image: raw.image, voice: raw.voice, description: raw.description,
    systemPrompt: raw.systemPrompt, thinkPrompt: raw.thinkPrompt,
    initiativeWeight: raw.initiativeWeight, chatProbability: raw.chatProbability, maximumChatStamina: raw.maximumChatStamina,
    numberOfMessagesToDisableThinkPrompt: raw.numberOfMessagesToDisableThinkPrompt || 1,
    numberOfMessagesToDisableMetaThinkInstructions: raw.numberOfMessagesToDisableMetaThinkInstructions || 1,
    numberOfMessagesToDisableDialoguePrompt: raw.numberOfMessagesToDisableDialoguePrompt || 1,
    sampler: undefined,
    memories,
    firstCreatedTimestamp: raw.firstCreatedTimestamp || ts,
    lastUpdatedTimestamp: raw.lastUpdatedTimestamp || ts,
  };
}
export async function loadAllCharacterShells(): Promise<Character[]> { const ids = await loadRawCharacterManifest(); return (await loadInBatches(ids, loadCharacterShell)).filter((c): c is Character => c !== null); }

// --- Context Repository ---
export async function loadRawContextManifest(): Promise<string[]> { return await fetchJson<string[]>(`${PATHS.contexts}/${MANIFEST_FILE}`) || []; }
export async function loadRawContext(id: string): Promise<Context | null> {
  const raw = await fetchJson<RawContext>(`${PATHS.contexts}/${id}.json`);
  if (!raw) return null;
  const n = Date.now();
  return { id, name: raw.name || 'Unknown Context', description: raw.description, text: raw.text, images: raw.images, searchTerms: raw.searchTerms || [], searchEngine: raw.searchEngine, urls: raw.urls || [], includeLinkImages: raw.includeLinkImages, maximumLinkDepth: raw.maximumLinkDepth, linkFetchMode: raw.linkFetchMode || 'full', limitLinksToSubdirectory: raw.limitLinksToSubdirectory, fetchCacheTimeToLiveMs: raw.fetchCacheTimeToLiveMs, regularExpressionTrigger: raw.regularExpressionTrigger, regularExpressionContext: raw.regularExpressionContext, regularExpressionTarget: raw.regularExpressionTarget, tokenBudget: raw.tokenBudget, maximumRecursionDepth: raw.maximumRecursionDepth, insertionDepth: raw.insertionDepth, characterBindings: raw.characterBindings, useBase64Encoding: raw.useBase64Encoding ?? false, isAutoGenerated: raw.isAutoGenerated, firstCreatedTimestamp: raw.firstCreatedTimestamp || n, lastUpdatedTimestamp: raw.lastUpdatedTimestamp || n };
}
export async function loadAllRawContexts(): Promise<Context[]> { const ids = await loadRawContextManifest(); return (await loadInBatches(ids, loadRawContext)).filter((i): i is Context => i !== null); }
export async function saveRawContext(context: Context): Promise<void> { const { id, ...raw } = context; await putJson(`${PATHS.contexts}/${id}.json`, { ...raw, lastUpdatedTimestamp: Date.now() }); await updateManifest(PATHS.contexts, id, 'add'); }
export async function deleteRawContext(id: string): Promise<void> { await deleteResource(`${PATHS.contexts}/${id}.json`); await updateManifest(PATHS.contexts, id, 'remove'); }

// --- Language Model Repository ---
export async function loadRawModelManifest(): Promise<string[]> { return await fetchJson<string[]>(`${PATHS.models}/${MANIFEST_FILE}`) || []; }
export async function loadRawModel(id: string): Promise<LanguageModel | null> {
  const raw = await fetchJson<RawLanguageModel>(`${PATHS.models}/${id}.json`);
  if (!raw) return null;
  return { id, name: raw.name || 'Unknown Model', description: raw.description, backend: raw.backend, contextLength: raw.contextLength, model: raw.model, mmproj: raw.mmproj, lora: raw.lora, apiKey: raw.apiKey, parameters: raw.parameters, cacheHitCostPerOneMillionOfTokens: raw.cacheHitCostPerOneMillionOfTokens, cacheMissCostPerOneMillionOfTokens: raw.cacheMissCostPerOneMillionOfTokens, outputGenerationCostPerOneMillionOfTokens: raw.outputGenerationCostPerOneMillionOfTokens, firstCreatedTimestamp: raw.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: raw.lastUpdatedTimestamp || Date.now() };
}
export async function loadAllRawModels(): Promise<LanguageModel[]> { const ids = await loadRawModelManifest(); return (await loadInBatches(ids, loadRawModel)).filter((m): m is LanguageModel => m !== null); }
export async function saveRawModel(model: LanguageModel): Promise<void> { const { id, ...raw } = model; await putJson(`${PATHS.models}/${id}.json`, { ...raw, lastUpdatedTimestamp: Date.now() } as RawLanguageModel); await updateManifest(PATHS.models, id, 'add'); }
export async function deleteRawModel(id: string): Promise<void> { await deleteResource(`${PATHS.models}/${id}.json`); await updateManifest(PATHS.models, id, 'remove'); }

// --- Budget Strategy Repository ---
export async function loadRawBudgetStrategyManifest(): Promise<string[]> { return await fetchJson<string[]>(`${PATHS.budgetStrategies}/${MANIFEST_FILE}`) || []; }
export async function loadRawBudgetStrategy(id: string): Promise<BudgetStrategy | null> {
  const raw = await fetchJson<RawBudgetStrategy>(`${PATHS.budgetStrategies}/${id}.json`);
  if (!raw) return null;
  try {
    const [online, local] = await Promise.all([loadRawModel(raw.onlineModelId), loadRawModel(raw.localModelId)]);
    return { id, name: raw.name || 'Unknown Strategy', description: raw.description, onlineModel: online || DefaultModel, localModel: local || DefaultModel, switchProbabilty: raw.switchProbabilty, switchOnContextSize: raw.switchOnContextSize, switchOnComplexityScore: raw.switchOnComplexityScore, fallbackOnLocalFailure: raw.fallbackOnLocalFailure, fallbackOnQualityThreshold: raw.fallbackOnQualityThreshold, fallbackOnTimeoutInSeconds: raw.fallbackOnTimeoutInSeconds, maximumBudget: raw.maximumBudget, firstCreatedTimestamp: raw.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: raw.lastUpdatedTimestamp || Date.now() };
  } catch (e) { console.warn(`Failed to load budget strategy ${id}`, e); return null; }
}
export async function loadAllRawBudgetStrategies(): Promise<BudgetStrategy[]> { const ids = await loadRawBudgetStrategyManifest(); return (await loadInBatches(ids, loadRawBudgetStrategy)).filter((s): s is BudgetStrategy => s !== null); }
export async function saveRawBudgetStrategy(strategy: BudgetStrategy): Promise<void> { const { id, onlineModel, localModel, ...raw } = strategy; await putJson(`${PATHS.budgetStrategies}/${id}.json`, { ...raw, onlineModelId: onlineModel.id, localModelId: localModel.id, lastUpdatedTimestamp: Date.now() } as RawBudgetStrategy); await updateManifest(PATHS.budgetStrategies, id, 'add'); }
export async function deleteRawBudgetStrategy(id: string): Promise<void> { await deleteResource(`${PATHS.budgetStrategies}/${id}.json`); await updateManifest(PATHS.budgetStrategies, id, 'remove'); }

// --- Profile Repository ---
export async function loadRawProfileManifest(): Promise<string[]> { return await fetchJson<string[]>(`${PATHS.profiles}/${MANIFEST_FILE}`) || []; }
export async function loadRawProfile(id: string): Promise<Profile | null> {
  const raw = await fetchJson<RawProfile>(`${PATHS.profiles}/${id}.json`);
  if (!raw) return null;
  const n = Date.now();
  const rawSteps = raw.summarizationSteps || [];
  const steps: SummarizationStep[] = rawSteps.length > 0 ? rawSteps.map((s, i) => ({ id: s.id || `step-${uuidv4()}`, name: s.name || s.strategyType, description: s.description, strategyType: s.strategyType, enabled: s.enabled ?? false, order: s.order ?? i, slidingWindowSize: s.slidingWindowSize, compressionInterval: s.compressionInterval, compressionChunkSize: s.compressionChunkSize, recursiveChunkSize: s.recursiveChunkSize, recursiveMaxDepth: s.recursiveMaxDepth, maskingRelevanceThreshold: s.maskingRelevanceThreshold, maskingKeywordWeight: s.maskingKeywordWeight, summaryTokenBudget: s.summaryTokenBudget, summaryModelId: s.summaryModelId, triggerTokenThreshold: s.triggerTokenThreshold, firstCreatedTimestamp: s.firstCreatedTimestamp || n, lastUpdatedTimestamp: s.lastUpdatedTimestamp || n })) : getDefaultSummarizationSteps();
  return { id, name: raw.name || 'Unknown Profile', description: raw.description, forceNameReveal: raw.forceNameReveal ?? false, forceNoCharacterImageInjection: raw.forceNoCharacterImageInjection, forceNoContextImageInjection: raw.forceNoContextImageInjection, useCurrentDateAndTime: raw.useCurrentDateAndTime ?? false, numberOfMessagesToDisableThinkPrompt: raw.numberOfMessagesToDisableThinkPrompt ?? 1, numberOfMessagesToDisableMetaThinkInstructions: raw.numberOfMessagesToDisableMetaThinkInstructions ?? 1, numberOfMessagesToDisableDialoguePrompt: raw.numberOfMessagesToDisableDialoguePrompt ?? 1, forceEqualInitiative: raw.forceEqualInitiative ?? false, chatProbability: raw.chatProbability ?? 0, maximumChatStamina: raw.maximumChatStamina ?? 0, cacheInvalidationReductionLevel: raw.cacheInvalidationReductionLevel ?? 0, narrateNormalText: raw.narrateNormalText, narrateQuotedText: raw.narrateQuotedText, narrateBoldedText: raw.narrateBoldedText, narrateItalicizedText: raw.narrateItalicizedText, stripThinkTokens: raw.stripThinkTokens ?? false, enableMemoryWriting: raw.enableMemoryWriting ?? false, enableMemoryReading: raw.enableMemoryReading ?? false, inputStrategy: raw.inputStrategy?.length ? raw.inputStrategy : ['Context', 'System Prompt', 'Think Prompt', 'Chat History'], summarizationSteps: steps, firstCreatedTimestamp: raw.firstCreatedTimestamp || n, lastUpdatedTimestamp: raw.lastUpdatedTimestamp || n };
}
export async function loadAllRawProfiles(): Promise<Profile[]> { const ids = await loadRawProfileManifest(); return (await loadInBatches(ids, loadRawProfile)).filter((p): p is Profile => p !== null); }
export async function saveRawProfile(profile: Profile): Promise<void> { const { id, summarizationSteps, ...raw } = profile; await putJson(`${PATHS.profiles}/${id}.json`, { ...raw, summarizationSteps: summarizationSteps.map(({ id: _id, ...rest }) => rest), lastUpdatedTimestamp: Date.now() } as RawProfile); await updateManifest(PATHS.profiles, id, 'add'); }
export async function deleteRawProfile(id: string): Promise<void> { await deleteResource(`${PATHS.profiles}/${id}.json`); await updateManifest(PATHS.profiles, id, 'remove'); }

// --- Webpage Repository ---
export async function loadRawWebpageManifest(): Promise<string[]> { return await fetchJson<string[]>(`${PATHS.webpages}/${MANIFEST_FILE}`) || []; }
export async function loadRawWebpage(id: string): Promise<Webpage | null> { const raw = await fetchJson<RawWebpage>(`${PATHS.webpages}/${id}.json`); if (!raw) return null; return { id, name: raw.name || 'Untitled Webpage', description: raw.description, url: raw.url, content: raw.content, firstCreatedTimestamp: raw.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: raw.lastUpdatedTimestamp || Date.now() }; }
export async function loadAllRawWebpages(): Promise<Webpage[]> { const ids = await loadRawWebpageManifest(); return (await loadInBatches(ids, loadRawWebpage)).filter((w): w is Webpage => w !== null); }
export async function saveRawWebpage(webpage: Webpage): Promise<void> { const { id, ...raw } = webpage; await putJson(`${PATHS.webpages}/${id}.json`, { ...raw, lastUpdatedTimestamp: Date.now() }); await updateManifest(PATHS.webpages, id, 'add'); }
export async function deleteRawWebpage(id: string): Promise<void> { await deleteResource(`${PATHS.webpages}/${id}.json`); await updateManifest(PATHS.webpages, id, 'remove'); }
export async function findWebpageByUrl(url: string): Promise<Webpage | null> { return (await loadAllRawWebpages()).find(w => w.url === url) || null; }

// --- Chat Message Repository ---
export async function deleteRawChatMessage(id: string): Promise<void> { await deleteResource(`${PATHS.chatMessages}/${id}.json`); }

// --- Chat Data Repository ---
export async function loadRawChatManifest(): Promise<string[]> { return await fetchJson<string[]>(`${PATHS.chatData}/${MANIFEST_FILE}`) || []; }

async function buildChatDataShell(id: string, raw: RawChatData, charMap: Map<string, Character>, ctxMap: Map<string, Context>, profMap: Map<string, Profile>): Promise<ChatData | null> {
  const protag = charMap.get(raw.protagonistId);
  if (!protag) { console.warn(`Protagonist ${raw.protagonistId} not found for chat ${id}`); return null; }
  const participants = raw.participantIds.map(pid => charMap.get(pid)).filter((c): c is Character => c !== undefined);
  if (!participants.find(p => p.id === protag.id)) participants.unshift(protag);
  const contexts = (raw.contextIds || []).map(iid => ctxMap.get(iid)).filter((i): i is Context => i !== undefined);
  const profile = raw.ProfileId ? profMap.get(raw.ProfileId) : undefined;
  return { id, name: raw.name || "Untitled Chat", protagonist: protag, participants, contexts, chatMessageHistory: [], numberOfMessages: raw.chatMessageIdHistory?.length ?? 0, firstCreatedTimestamp: raw.firstCreatedTimestamp || Date.now(), lastUpdatedTimestamp: raw.lastUpdatedTimestamp || Date.now(), parentChatDataId: raw.parentChatDataId || null, parentChatMessageId: raw.parentChatMessageId || null, Profile: profile };
}

export async function loadChatMessages(chatData: ChatData): Promise<ChatData> {
  if (chatData.chatMessageHistory.length > 0) return chatData;
  const raw = await fetchJson<RawChatData>(`${PATHS.chatData}/${chatData.id}.json`);
  if (!raw || !raw.chatMessageIdHistory?.length) return chatData;
  const charMap = new Map<string, Character>();
  charMap.set(chatData.protagonist.id, chatData.protagonist);
  for (const p of chatData.participants) charMap.set(p.id, p);
  const msgs = (await Promise.all(raw.chatMessageIdHistory.map(async (mid) => {
    const rm = await fetchJson<RawChatMessage>(`${PATHS.chatMessages}/${mid}.json`);
    if (!rm) return null;
    const char = charMap.get(rm.characterId);
    const { characterId, ...rest } = rm;
    return { id: mid, ...rest, character: char || { id: rm.characterId, name: '[Unknown]', firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(), memories: {}, numberOfMessagesToDisableThinkPrompt: 0, numberOfMessagesToDisableMetaThinkInstructions: 0, numberOfMessagesToDisableDialoguePrompt: 0, initiativeWeight: 0, chatProbability: 0, maximumChatStamina: 0 } as Character };
  }))).filter((m): m is ChatMessage => m !== null);
  return { ...chatData, chatMessageHistory: msgs, numberOfMessages: msgs.length };
}

export async function loadRawChatData(id: string): Promise<ChatData | null> {
  const raw = await fetchJson<RawChatData>(`${PATHS.chatData}/${id}.json`);
  if (!raw) return null;
  const [chars, ctxs, profs] = await Promise.all([loadAllRawCharacters(), loadAllRawContexts(), loadAllRawProfiles()]);
  const cm = new Map(chars.map(c => [c.id, c]));
  const xm = new Map(ctxs.map(i => [i.id, i]));
  const pm = new Map(profs.map(p => [p.id, p]));
  const shell = await buildChatDataShell(id, raw, cm, xm, pm);
  if (!shell) return null;
  return loadChatMessages(shell);
}

export async function loadAllRawChatData(): Promise<ChatData[]> {
  const ids = await loadRawChatManifest();
  if (ids.length === 0) return [];
  const [chars, ctxs, profs] = await Promise.all([loadAllRawCharacters(), loadAllRawContexts(), loadAllRawProfiles()]);
  const cm = new Map(chars.map(c => [c.id, c]));
  const xm = new Map(ctxs.map(i => [i.id, i]));
  const pm = new Map(profs.map(p => [p.id, p]));
  const results: (ChatData | null)[] = [];
  for (let i = 0; i < ids.length; i += 3) {
    const batch = ids.slice(i, i + 3);
    const batchResults = await Promise.all(batch.map(async (id) => { const r = await fetchJson<RawChatData>(`${PATHS.chatData}/${id}.json`); if (!r) return null; return buildChatDataShell(id, r, cm, xm, pm); }));
    results.push(...batchResults);
    if (i + 3 < ids.length) await new Promise(resolve => setTimeout(resolve, 20));
  }
  return results.filter((c): c is ChatData => c !== null);
}

export async function saveRawChatData(chatData: ChatData): Promise<void> {
  const msgPromises = chatData.chatMessageHistory.map(msg => { const { id, character, ...raw } = msg; return putJson(`${PATHS.chatMessages}/${id}.json`, { ...raw, characterId: character.id, lastUpdatedTimestamp: Date.now() }); });
  for (let i = 0; i < msgPromises.length; i += 10) await Promise.all(msgPromises.slice(i, i + 10));
  const { id, protagonist, participants, contexts, chatMessageHistory, numberOfMessages, parentChatDataId, parentChatMessageId, Profile, ...raw } = chatData;
  await putJson(`${PATHS.chatData}/${id}.json`, { ...raw, protagonistId: protagonist.id, participantIds: participants.map(p => p.id), contextIds: contexts?.map(i => i.id) || [], chatMessageIdHistory: chatMessageHistory.map(m => m.id), parentChatDataId: parentChatDataId || null, parentChatMessageId: parentChatMessageId || null, ProfileId: Profile?.id, lastUpdatedTimestamp: Date.now() } as RawChatData);
  await updateManifest(PATHS.chatData, id, 'add');
}

export async function branchRawChatData(parentChatDataId: string, parentChatMessageId: string): Promise<string> {
  const source = await loadRawChatData(parentChatDataId);
  if (!source) throw new Error("Source chat not found");
  const idx = source.chatMessageHistory.findIndex(m => m.id === parentChatMessageId);
  if (idx === -1) throw new Error("Branch point message not found");
  const newId = uuidv4();
  await putJson(`${PATHS.chatData}/${newId}.json`, { name: `${source.name} (Branch)`, protagonistId: source.protagonist.id, participantIds: source.participants.map(p => p.id), contextIds: source.contexts?.map(i => i.id) || [], chatMessageIdHistory: source.chatMessageHistory.slice(0, idx + 1).map(m => m.id), firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(), parentChatDataId, parentChatMessageId, ProfileId: source.Profile?.id } as RawChatData);
  await updateManifest(PATHS.chatData, newId, 'add');
  return newId;
}

export async function deleteRawChatData(id: string): Promise<void> {
  try { await deleteResource(`${PATHS.kvCaches}/${id}`); } catch (e) { console.warn("KV cache cleanup failed", e); }
  await deleteResource(`${PATHS.chatData}/${id}.json`);
  await updateManifest(PATHS.chatData, id, 'remove');
}

export async function loadInterjectableActions(): Promise<InterjectableAction[]> { const a = await fetchJson<InterjectableAction[]>(PATHS.actions); return a && a.length > 0 ? a : DEFAULT_ACTIONS; }
export async function saveInterjectableActions(actions: InterjectableAction[]): Promise<void> { await putJson(PATHS.actions, actions); }

// --- Helpers ---
export function getCharacterImageUrl(f: string | undefined): string | null { if (!f) return null; const p = PATHS.characterImages.startsWith('/') ? PATHS.characterImages : `/${PATHS.characterImages}`; return `${localURL}${p}/${f}`; }
export async function uploadCharacterImage(file: File): Promise<string> { const b = await fileToBase64(file); const f = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'); await putJson(`${PATHS.characterImages}/${f}`, { base64: b }); return f; }
export function getCharacterVoiceUrl(f: string | undefined): string | null { if (!f) return null; const p = PATHS.characterVoices.startsWith('/') ? PATHS.characterVoices : `/${PATHS.characterVoices}`; return `${localURL}${p}/${f}`; }
export async function uploadCharacterVoice(file: File): Promise<string> { const b = await fileToBase64(file); const f = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'); await putJson(`${PATHS.characterVoices}/${f}`, { base64: b }); return f; }
export function getContextImageUrl(f: string | undefined): string | null { if (!f) return null; const p = PATHS.contexts.startsWith('/') ? PATHS.contexts : `/${PATHS.contexts}`; return `${localURL}${p}/${f}`; }
export async function uploadContextImage(file: File): Promise<string> { const b = await fileToBase64(file); const f = file.name.replace(/[^a-zA-Z0-9._-]/g, '_'); await putJson(`${PATHS.contexts}/${f}`, { base64: b }); return f; }