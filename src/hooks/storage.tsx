// src/hooks/storage.ts
import type { 
  StopPattern, RawStopPattern, Sampler, RawSampler, Context, RawContext, LanguageModel, RawLanguageModel,
  Character, RawCharacter, ChatMessage, RawChatMessage, ChatData, RawChatData,
  BudgetStrategy, RawBudgetStrategy, InterjectableAction, Profile, RawProfile,
  SummarizationStep, RawSummarizationStep
} from '../types';

import { localURL } from '../configurations';
import { v4 as uuidv4 } from 'uuid';

const now = Date.now()

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

// ✅ Default summarization steps for new profiles or profiles without steps
function getDefaultSummarizationSteps(): SummarizationStep[] {
    const now = Date.now();
    return [
        {
            id: 'step-sliding-window',
            name: 'Sliding Window Replace',
            strategyType: 'Sliding Window Replace',
            enabled: true,
            order: 0,
            slidingWindowSize: 10,
            summaryTokenBudget: 256,
            triggerTokenThreshold: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
        {
            id: 'step-periodic-compression',
            name: 'Periodic Compression',
            strategyType: 'Periodic Compression',
            enabled: false,
            order: 1,
            compressionInterval: 20,
            compressionChunkSize: 10,
            summaryTokenBudget: 512,
            triggerTokenThreshold: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
        {
            id: 'step-recursive-summary',
            name: 'Recursive Summary',
            strategyType: 'Recursive Summary',
            enabled: false,
            order: 2,
            recursiveChunkSize: 10,
            recursiveMaxDepth: 3,
            summaryTokenBudget: 1024,
            triggerTokenThreshold: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
        {
            id: 'step-observation-masking',
            name: 'Observation Masking',
            strategyType: 'Observation Masking',
            enabled: false,
            order: 3,
            maskingRelevanceThreshold: 0.3,
            maskingKeywordWeight: 0.7,
            triggerTokenThreshold: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
    ];
}

const WRITE_API_URL = localURL; 
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
  actions: "/user_data/actions.json",
};
const MANIFEST_FILE = 'manifest.json';

// --- Generic Helpers ---

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    const targetUrl = `${WRITE_API_URL}${cleanUrl}`;
    
    const response = await fetch(targetUrl);
    
    if (!response.ok) {
      if (response.status === 404) return null;
      console.warn(`HTTP Error ${response.status} for ${url}`);
      return null;
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      return null; 
    }

    const text = await response.text();
    if (!text.trim()) return null;
    
    return JSON.parse(text) as T;
  } catch (error) { 
    if ((error as Error).message.includes('Failed to fetch')) {
      // Network error usually handled by caller or global handler
    } else {
      console.warn(`Failed to parse JSON from ${url}:`, error);
    }
    return null; 
  }
}

async function putJson<T>(url: string, data: T): Promise<void> {
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const targetUrl = `${WRITE_API_URL}${cleanUrl}`;
  const response = await fetch(targetUrl, { 
    method: 'PUT', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(data) 
  });
  if (!response.ok) throw new Error(`Failed to save data to ${targetUrl}: HTTP ${response.status}`);
}

async function deleteResource(url: string): Promise<void> {
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const targetUrl = `${WRITE_API_URL}${cleanUrl}`;
  const response = await fetch(targetUrl, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Failed to delete resource at ${targetUrl}: HTTP ${response.status}`);
}

async function updateManifest(folderPath: string, id: string, action: 'add' | 'remove'): Promise<void> {
  const manifestUrl = `${folderPath}/${MANIFEST_FILE}`;
  let currentIds = await fetchJson<string[]>(manifestUrl);
  
  if (!currentIds || !Array.isArray(currentIds)) {
    currentIds = [];
  }

  let newIds: string[];
  if (action === 'add') { 
    if (currentIds.includes(id)) return; 
    newIds = [...currentIds, id]; 
  } else { 
    newIds = currentIds.filter(existingId => existingId !== id); 
  }
  
  await putJson(manifestUrl, newIds);
}

// Image Upload Helper
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Batch Loading Utility ---
async function loadInBatches<T>(ids: string[], loader: (id: string) => Promise<T | null>, batchSize: number = 5): Promise<(T | null)[]> {
  const results: (T | null)[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(loader));
    results.push(...batchResults);
    if (i + batchSize < ids.length) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  return results;
}

// --- Stop Pattern Repository ---
export async function loadRawStopPatternManifest(): Promise<string[]> { 
  return await fetchJson<string[]>(`${PATHS.stopPatterns}/${MANIFEST_FILE}`) || []; 
}

export async function loadRawStopPattern(id: string): Promise<StopPattern | null> {
  const rawPattern = await fetchJson<RawStopPattern>(`${PATHS.stopPatterns}/${id}.json`);
  if (!rawPattern) return null;
  return { 
    id, 
    name: rawPattern.name || 'Unknown Pattern', 
    description: rawPattern.description, 
    pattern: rawPattern.pattern,
    regularExpressionTrigger: rawPattern.regularExpressionTrigger,
    regularExpressionContext: rawPattern.regularExpressionContext,
    regularExpressionTarget: rawPattern.regularExpressionTarget,
    firstCreatedTimestamp: rawPattern.firstCreatedTimestamp || Date.now(),
    lastUpdatedTimestamp: rawPattern.lastUpdatedTimestamp || Date.now(),
  };
}

export async function loadAllRawStopPatterns(): Promise<StopPattern[]> {
  const ids = await loadRawStopPatternManifest();
  const results = await loadInBatches(ids, loadRawStopPattern);
  return results.filter((p): p is StopPattern => p !== null);
}

export async function saveRawStopPattern(pattern: StopPattern): Promise<void> {
  const { id, ...rawPattern } = pattern; 
  const payload = {
    ...rawPattern,
    lastUpdatedTimestamp: Date.now(),
  };
  await putJson(`${PATHS.stopPatterns}/${id}.json`, payload);
  await updateManifest(PATHS.stopPatterns, id, 'add');
}

export async function deleteRawStopPattern(id: string): Promise<void> {
  await deleteResource(`${PATHS.stopPatterns}/${id}.json`);
  await updateManifest(PATHS.stopPatterns, id, 'remove');
}

// --- Sampler Repository ---
export async function loadRawSamplerManifest(): Promise<string[]> { 
  return await fetchJson<string[]>(`${PATHS.samplers}/${MANIFEST_FILE}`) || []; 
}

export async function loadRawSampler(id: string): Promise<Sampler | null> {
  try {
    const rawSampler = await fetchJson<RawSampler>(`${PATHS.samplers}/${id}.json`);
    if (!rawSampler) return null;
    
    const stopPatternIds = rawSampler.stopPatternIds || [];
    const stopPatternsPromises = stopPatternIds.map(sid => loadRawStopPattern(sid));
    const stopPatternsResults = await Promise.all(stopPatternsPromises);
    const stopPatterns = stopPatternsResults.filter((p): p is StopPattern => p !== null);

    return { 
      id, 
      name: rawSampler.name || 'Unknown Sampler', 
      description: rawSampler.description, 
      parameters: rawSampler.parameters || {}, 
      maximumNumberOfTokens: rawSampler.maximumNumberOfTokens, 
      stopPatterns,
      firstCreatedTimestamp: rawSampler.firstCreatedTimestamp || Date.now(),
      lastUpdatedTimestamp: rawSampler.lastUpdatedTimestamp || Date.now(),
    };
  } catch (e) {
    console.warn(`Failed to load sampler ${id}`, e);
    return null;
  }
}

export async function loadAllRawSamplers(): Promise<Sampler[]> {
  const ids = await loadRawSamplerManifest();
  const results = await loadInBatches(ids, loadRawSampler);
  return results.filter((s): s is Sampler => s !== null);
}

export async function saveRawSampler(sampler: Sampler): Promise<void> {
  const { id, stopPatterns, ...rawSampler } = sampler; 
  const payload: RawSampler = { 
    ...rawSampler, 
    stopPatternIds: stopPatterns.map(sp => sp.id),
    lastUpdatedTimestamp: Date.now(),
  };
  await putJson(`${PATHS.samplers}/${id}.json`, payload);
  await updateManifest(PATHS.samplers, id, 'add');
}

export async function deleteRawSampler(id: string): Promise<void> {
  await deleteResource(`${PATHS.samplers}/${id}.json`);
  await updateManifest(PATHS.samplers, id, 'remove');
}

// --- Character Repository ---
export async function loadRawCharacterManifest(): Promise<string[]> { 
  return await fetchJson<string[]>(`${PATHS.characters}/${MANIFEST_FILE}`) || []; 
}

export async function loadRawCharacter(id: string): Promise<Character | null> {
  try {
    const rawCharacter = await fetchJson<RawCharacter>(`${PATHS.characters}/${id}.json`);
    if (!rawCharacter) return null;

    const samplerId = rawCharacter.samplerId;
    let sampler: Sampler = DefaultSampler;
    
    if (samplerId) {
      const loadedSampler = await loadRawSampler(samplerId);
      if (loadedSampler) sampler = loadedSampler;
    }

    return { 
      id, 
      name: rawCharacter.name || 'Unknown Character', 
      image: rawCharacter.image,
      voice: rawCharacter.voice,
      description: rawCharacter.description, 
      systemPrompt: rawCharacter.systemPrompt,
      thinkPrompt: rawCharacter.thinkPrompt, 
      initiativeWeight: rawCharacter.initiativeWeight, 
      chatProbability: rawCharacter.chatProbability, 
      maximumChatStamina: rawCharacter.maximumChatStamina, 
      sampler,
      firstCreatedTimestamp: rawCharacter.firstCreatedTimestamp || Date.now(),
      lastUpdatedTimestamp: rawCharacter.lastUpdatedTimestamp || Date.now(),
    };
  } catch (e) {
    console.warn(`Failed to load character ${id}`, e);
    return null;
  }
}

export async function loadAllRawCharacters(): Promise<Character[]> {
  const ids = await loadRawCharacterManifest();
  const results = await loadInBatches(ids, loadRawCharacter);
  return results.filter((c): c is Character => c !== null);
}

export async function saveRawCharacter(character: Character): Promise<void> {
  const { id, sampler, ...rawCharacter } = character; 
  const payload: RawCharacter = { 
    ...rawCharacter, 
    samplerId: sampler?.id,
    lastUpdatedTimestamp: Date.now(),
  };
  await putJson(`${PATHS.characters}/${id}.json`, payload);
  await updateManifest(PATHS.characters, id, 'add');
}

export async function deleteRawCharacter(id: string): Promise<void> {
  await deleteResource(`${PATHS.characters}/${id}.json`);
  await updateManifest(PATHS.characters, id, 'remove');
}

// --- Context Repository ---
export async function loadRawContextManifest(): Promise<string[]> { 
    return await fetchJson<string[]>(`${PATHS.contexts}/${MANIFEST_FILE}`) || []; 
}

export async function loadRawContext(id: string): Promise<Context | null> {
    const rawContext = await fetchJson<RawContext>(`${PATHS.contexts}/${id}.json`);
    if (!rawContext) return null;
    return { 
        id, 
        name: rawContext.name || 'Unknown Context', 
        description: rawContext.description, 
        text: rawContext.text,
        images: rawContext.images,
        regularExpressionTrigger: rawContext.regularExpressionTrigger,
        regularExpressionContext: rawContext.regularExpressionContext,
        regularExpressionTarget: rawContext.regularExpressionTarget,
        tokenBudget: rawContext.tokenBudget,
        recursiveScan: rawContext.recursiveScan,
        maximumRecursionDepth: rawContext.maximumRecursionDepth,
        insertionDepth: rawContext.insertionDepth,
        characterBindings: rawContext.characterBindings,
        useBase64Encoding: rawContext.useBase64Encoding ?? false,
        isAutoGenerated: rawContext.isAutoGenerated,
        firstCreatedTimestamp: rawContext.firstCreatedTimestamp || Date.now(),
        lastUpdatedTimestamp: rawContext.lastUpdatedTimestamp || Date.now(),
    };
}

export async function loadAllRawContexts(): Promise<Context[]> {
    const ids = await loadRawContextManifest();
    const results = await loadInBatches(ids, loadRawContext);
    return results.filter((i): i is Context => i !== null);
}

export async function saveRawContext(context: Context): Promise<void> {
    const { id, ...rawContext } = context; 
    const payload = {
        ...rawContext,
        lastUpdatedTimestamp: Date.now(),
    };
    await putJson(`${PATHS.contexts}/${id}.json`, payload);
    await updateManifest(PATHS.contexts, id, 'add');
}

export async function deleteRawContext(id: string): Promise<void> {
    await deleteResource(`${PATHS.contexts}/${id}.json`);
    await updateManifest(PATHS.contexts, id, 'remove');
}

// --- Language Model Repository ---
export async function loadRawModelManifest(): Promise<string[]> {
    return await fetchJson<string[]>(`${PATHS.models}/${MANIFEST_FILE}`) || [];
}

export async function loadRawModel(id: string): Promise<LanguageModel | null> {
    const rawModel = await fetchJson<RawLanguageModel>(`${PATHS.models}/${id}.json`);
    if (!rawModel) return null;
    
    return {
        id,
        name: rawModel.name || 'Unknown Model',
        description: rawModel.description,
        backend: rawModel.backend,
        contextLength: rawModel.contextLength,
        model: rawModel.model,
        mmproj: rawModel.mmproj,
        apiKey: rawModel.apiKey,
        parameters: rawModel.parameters,
        cacheHitCostPerOneMillionOfTokens: rawModel.cacheHitCostPerOneMillionOfTokens,
        cacheMissCostPerOneMillionOfTokens: rawModel.cacheMissCostPerOneMillionOfTokens,
        outputGenerationCostPerOneMillionOfTokens: rawModel.outputGenerationCostPerOneMillionOfTokens,
        firstCreatedTimestamp: rawModel.firstCreatedTimestamp || Date.now(),
        lastUpdatedTimestamp: rawModel.lastUpdatedTimestamp || Date.now(),
    };
}

export async function loadAllRawModels(): Promise<LanguageModel[]> {
    const ids = await loadRawModelManifest();
    const results = await loadInBatches(ids, loadRawModel);
    return results.filter((m): m is LanguageModel => m !== null);
}

export async function saveRawModel(model: LanguageModel): Promise<void> {
    const { id, ...rawModel } = model;
    const payload: RawLanguageModel = {
        ...rawModel,
        lastUpdatedTimestamp: Date.now(),
    };
    await putJson(`${PATHS.models}/${id}.json`, payload);
    await updateManifest(PATHS.models, id, 'add');
}

export async function deleteRawModel(id: string): Promise<void> {
    await deleteResource(`${PATHS.models}/${id}.json`);
    await updateManifest(PATHS.models, id, 'remove');
}

// --- Budget Strategy Repository ---
export async function loadRawBudgetStrategyManifest(): Promise<string[]> {
    return await fetchJson<string[]>(`${PATHS.budgetStrategies}/${MANIFEST_FILE}`) || [];
}

export async function loadRawBudgetStrategy(id: string): Promise<BudgetStrategy | null> {
    const rawStrategy = await fetchJson<RawBudgetStrategy>(`${PATHS.budgetStrategies}/${id}.json`);
    if (!rawStrategy) return null;
    
    try {
      const [onlineModel, localModel] = await Promise.all([
          loadRawModel(rawStrategy.onlineModelId),
          loadRawModel(rawStrategy.localModelId)
      ]);

      const finalOnline = onlineModel || DefaultModel;
      const finalLocal = localModel || DefaultModel;

      return {
          id,
          name: rawStrategy.name || 'Unknown Strategy',
          description: rawStrategy.description,
          onlineModel: finalOnline,
          localModel: finalLocal,
          switchProbabilty: rawStrategy.switchProbabilty,
          switchOnContextSize: rawStrategy.switchOnContextSize,
          switchOnComplexityScore: rawStrategy.switchOnComplexityScore,
          fallbackOnLocalFailure: rawStrategy.fallbackOnLocalFailure,
          fallbackOnQualityThreshold: rawStrategy.fallbackOnQualityThreshold,
          fallbackOnTimeoutInSeconds: rawStrategy.fallbackOnTimeoutInSeconds,
          maximumBudget: rawStrategy.maximumBudget,
          firstCreatedTimestamp: rawStrategy.firstCreatedTimestamp || Date.now(),
          lastUpdatedTimestamp: rawStrategy.lastUpdatedTimestamp || Date.now(),
      };
    } catch (e) {
      console.warn(`Failed to load budget strategy ${id}`, e);
      return null;
    }
}

export async function loadAllRawBudgetStrategies(): Promise<BudgetStrategy[]> {
    const ids = await loadRawBudgetStrategyManifest();
    const results = await loadInBatches(ids, loadRawBudgetStrategy);
    return results.filter((s): s is BudgetStrategy => s !== null);
}

export async function saveRawBudgetStrategy(strategy: BudgetStrategy): Promise<void> {
    const { id, onlineModel, localModel, ...rawStrategy } = strategy;
    const payload: RawBudgetStrategy = {
        ...rawStrategy,
        onlineModelId: onlineModel.id,
        localModelId: localModel.id,
        lastUpdatedTimestamp: Date.now(),
    };
    await putJson(`${PATHS.budgetStrategies}/${id}.json`, payload);
    await updateManifest(PATHS.budgetStrategies, id, 'add');
}

export async function deleteRawBudgetStrategy(id: string): Promise<void> {
    await deleteResource(`${PATHS.budgetStrategies}/${id}.json`);
    await updateManifest(PATHS.budgetStrategies, id, 'remove');
}

// --- Profile Repository ---
export async function loadRawProfileManifest(): Promise<string[]> {
    return await fetchJson<string[]>(`${PATHS.profiles}/${MANIFEST_FILE}`) || [];
}

export async function loadRawProfile(id: string): Promise<Profile | null> {
    const rawProfile = await fetchJson<RawProfile>(`${PATHS.profiles}/${id}.json`);
    if (!rawProfile) return null;

    const now = Date.now();

    // ✅ Hydrate summarization steps — add ids/timestamps if missing, fall back to defaults
    const rawSteps = rawProfile.summarizationSteps || [];
    const summarizationSteps: SummarizationStep[] = rawSteps.length > 0
        ? rawSteps.map((step, i) => ({
            id: step.id || `step-${uuidv4()}`,
            name: step.name || step.strategyType,
            description: step.description,
            strategyType: step.strategyType,
            enabled: step.enabled ?? false,
            order: step.order ?? i,
            slidingWindowSize: step.slidingWindowSize,
            compressionInterval: step.compressionInterval,
            compressionChunkSize: step.compressionChunkSize,
            recursiveChunkSize: step.recursiveChunkSize,
            recursiveMaxDepth: step.recursiveMaxDepth,
            maskingRelevanceThreshold: step.maskingRelevanceThreshold,
            maskingKeywordWeight: step.maskingKeywordWeight,
            summaryTokenBudget: step.summaryTokenBudget,
            summaryModelId: step.summaryModelId,
            triggerTokenThreshold: step.triggerTokenThreshold,
            firstCreatedTimestamp: step.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: step.lastUpdatedTimestamp || now,
        }))
        : getDefaultSummarizationSteps();

    return {
        id,
        name: rawProfile.name || 'Unknown Profile',
        description: rawProfile.description,
        forceNameReveal: rawProfile.forceNameReveal ?? false,
        useCurrentTime: rawProfile.useCurrentTime ?? false,
        forceEqualInitiative: rawProfile.forceEqualInitiative ?? false,
        chatProbability: rawProfile.chatProbability ?? 0,
        maximumChatStamina: rawProfile.maximumChatStamina ?? 0,
        cacheInvalidationReductionLevel: rawProfile.cacheInvalidationReductionLevel ?? 0,
        narrateNormalText: rawProfile.narrateNormalText,
        narrateQuotedText: rawProfile.narrateQuotedText,
        narrateBoldedText: rawProfile.narrateBoldedText,
        narrateItalicizedText: rawProfile.narrateItalicizedText,
        stripThinkTokens: rawProfile.stripThinkTokens ?? false,
        inputStrategy: rawProfile.inputStrategy?.length
            ? rawProfile.inputStrategy
            : ['Context', 'System Prompt', 'Think Prompt', 'Chat History'],
        summarizationSteps,
        firstCreatedTimestamp: rawProfile.firstCreatedTimestamp || now,
        lastUpdatedTimestamp: rawProfile.lastUpdatedTimestamp || now,
    };
}

export async function loadAllRawProfiles(): Promise<Profile[]> {
    const ids = await loadRawProfileManifest();
    const results = await loadInBatches(ids, loadRawProfile);
    return results.filter((p): p is Profile => p !== null);
}

export async function saveRawProfile(profile: Profile): Promise<void> {
    const { id, summarizationSteps, ...rawProfile } = profile;
    // ✅ Strip id from each step since RawSummarizationStep extends RawData (no id)
    const rawSteps: RawSummarizationStep[] = summarizationSteps.map(({ id: _stepId, ...rest }) => rest);
    const payload: RawProfile = {
        ...rawProfile,
        summarizationSteps: rawSteps,
        lastUpdatedTimestamp: Date.now(),
    };
    await putJson(`${PATHS.profiles}/${id}.json`, payload);
    await updateManifest(PATHS.profiles, id, 'add');
}

export async function deleteRawProfile(id: string): Promise<void> {
    await deleteResource(`${PATHS.profiles}/${id}.json`);
    await updateManifest(PATHS.profiles, id, 'remove');
}

// --- Chat Message Repository ---
export async function deleteRawChatMessage(id: string): Promise<void> { 
    await deleteResource(`${PATHS.chatMessages}/${id}.json`); 
}

// --- Chat Data Repository ---
export async function loadRawChatManifest(): Promise<string[]> { 
    return await fetchJson<string[]>(`${PATHS.chatData}/${MANIFEST_FILE}`) || []; 
}

/**
 * ✅ Builds a ChatData shell WITHOUT loading messages.
 * Messages are loaded separately via loadChatMessages() on demand.
 */
async function buildChatDataShell(
  id: string, 
  rawChatData: RawChatData, 
  charMap: Map<string, Character>, 
  contextMap: Map<string, Context>,
  profileMap: Map<string, Profile>
): Promise<ChatData | null> {
  
  const protagonist = charMap.get(rawChatData.protagonistId);
  if (!protagonist) {
    console.warn(`Protagonist ${rawChatData.protagonistId} not found for chat ${id}`);
    return null; 
  }

  const participants = rawChatData.participantIds
    .map(pid => charMap.get(pid))
    .filter((c): c is Character => c !== undefined);
    
  if (!participants.find(p => p.id === protagonist.id)) {
    participants.unshift(protagonist);
  }

  const contexts = (rawChatData.contextIds || [])
    .map(iid => contextMap.get(iid))
    .filter((i): i is Context => i !== undefined);

  const profile = rawChatData.ProfileId ? profileMap.get(rawChatData.ProfileId) : undefined;

  return {
    id, 
    name: rawChatData.name || "Untitled Chat", 
    protagonist, 
    participants, 
    contexts, 
    chatMessageHistory: [], // ✅ Empty — loaded on demand
    messageCount: rawChatData.chatMessageIdHistory?.length ?? 0, // ✅ Available without loading messages
    firstCreatedTimestamp: rawChatData.firstCreatedTimestamp || Date.now(), 
    lastUpdatedTimestamp: rawChatData.lastUpdatedTimestamp || Date.now(),
    parentChatDataId: rawChatData.parentChatDataId || null, 
    parentChatMessageId: rawChatData.parentChatMessageId || null,
    Profile: profile,
  };
}

/**
 * ✅ Loads chat messages for a specific chat on demand.
 * Called when user selects a chat, not during bulk init.
 */
export async function loadChatMessages(chatData: ChatData): Promise<ChatData> {
    // Already loaded — skip
    if (chatData.chatMessageHistory.length > 0) return chatData;

    // Get message IDs from storage
    const rawChatData = await fetchJson<RawChatData>(`${PATHS.chatData}/${chatData.id}.json`);
    if (!rawChatData || !rawChatData.chatMessageIdHistory?.length) return chatData;

    // Build character map from current participants for resolving message authors
    const charMap = new Map<string, Character>();
    charMap.set(chatData.protagonist.id, chatData.protagonist);
    for (const p of chatData.participants) {
        charMap.set(p.id, p);
    }

    const messagePromises = rawChatData.chatMessageIdHistory.map(async (messageId) => {
        const rawMessage = await fetchJson<RawChatMessage>(`${PATHS.chatMessages}/${messageId}.json`);
        if (!rawMessage) return null;
        
        const character = charMap.get(rawMessage.characterId);
        const { characterId, ...messageWithoutCharId } = rawMessage;
        
        return { 
            id: messageId, 
            ...messageWithoutCharId, 
            character: character || { 
                id: rawMessage.characterId, 
                name: '[Unknown]', 
                firstCreatedTimestamp: Date.now(), 
                lastUpdatedTimestamp: Date.now() 
            } as Character 
        };
    });

    const chatMessageHistory = (await Promise.all(messagePromises)).filter((m): m is ChatMessage => m !== null);

    return { ...chatData, chatMessageHistory, messageCount: chatMessageHistory.length };
}

/**
 * ✅ Loads a single chat's full data including messages.
 * Used when switching to a specific chat or for operations needing messages.
 */
export async function loadRawChatData(id: string): Promise<ChatData | null> {
  const rawChatData = await fetchJson<RawChatData>(`${PATHS.chatData}/${id}.json`);
  if (!rawChatData) return null;

  const [allCharacters, allContexts, allProfiles] = await Promise.all([ 
    loadAllRawCharacters(), 
    loadAllRawContexts(),
    loadAllRawProfiles()
  ]);
  
  const charMap = new Map(allCharacters.map(c => [c.id, c]));
  const contextMap = new Map(allContexts.map(i => [i.id, i]));
  const profileMap = new Map(allProfiles.map(p => [p.id, p]));

  const shell = await buildChatDataShell(id, rawChatData, charMap, contextMap, profileMap);
  if (!shell) return null;

  // ✅ Load messages inline for single-chat loads
  return loadChatMessages(shell);
}

/**
 * ✅ Bulk loads ALL chats WITHOUT messages for list display.
 * Messages are loaded on demand when user selects a chat.
 */
export async function loadAllRawChatData(): Promise<ChatData[]> {
  const ids = await loadRawChatManifest();
  if (ids.length === 0) return [];

  // Only load metadata dependencies — NOT messages
  const [allCharacters, allContexts, allProfiles] = await Promise.all([
    loadAllRawCharacters(),
    loadAllRawContexts(),
    loadAllRawProfiles()
  ]);

  const charMap = new Map(allCharacters.map(c => [c.id, c]));
  const contextMap = new Map(allContexts.map(i => [i.id, i]));
  const profileMap = new Map(allProfiles.map(p => [p.id, p]));

  const results: (ChatData | null)[] = [];
  
  for (let i = 0; i < ids.length; i += 3) {
    const batchIds = ids.slice(i, i + 3);
    const batchPromises = batchIds.map(async (id) => {
      const raw = await fetchJson<RawChatData>(`${PATHS.chatData}/${id}.json`);
      if (!raw) return null;
      return buildChatDataShell(id, raw, charMap, contextMap, profileMap);
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    if (i + 3 < ids.length) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  return results.filter((c): c is ChatData => c !== null);
}

export async function saveRawChatData(chatData: ChatData): Promise<void> {
  const saveMessagePromises = chatData.chatMessageHistory.map(message => {
    const { id, character, ...rawMsg } = message;
    const payload = {
      ...rawMsg,
      characterId: character.id,
      lastUpdatedTimestamp: Date.now(),
    };
    return putJson(`${PATHS.chatMessages}/${id}.json`, payload);
  });
  
  for (let i = 0; i < saveMessagePromises.length; i += 10) {
    await Promise.all(saveMessagePromises.slice(i, i + 10));
  }

  const { id, protagonist, participants, contexts, chatMessageHistory, messageCount, parentChatDataId, parentChatMessageId, Profile, ...rawChatData } = chatData;
  const payload: RawChatData = {
    ...rawChatData, 
    protagonistId: protagonist.id, 
    participantIds: participants.map(p => p.id),
    contextIds: contexts?.map(i => i.id) || [], 
    chatMessageIdHistory: chatMessageHistory.map(m => m.id),
    parentChatDataId: parentChatDataId || null, 
    parentChatMessageId: parentChatMessageId || null,
    ProfileId: Profile?.id,
    lastUpdatedTimestamp: Date.now(),
  };
  await putJson(`${PATHS.chatData}/${id}.json`, payload);
  await updateManifest(PATHS.chatData, id, 'add');
}

export async function branchRawChatData(parentChatDataId: string, parentChatMessageId: string): Promise<string> {
  const sourceChat = await loadRawChatData(parentChatDataId);
  if (!sourceChat) throw new Error("Source chat not found");
  const branchIndex = sourceChat.chatMessageHistory.findIndex(m => m.id === parentChatMessageId);
  if (branchIndex === -1) throw new Error("Branch point message not found");
  const newChatId = uuidv4();
  const newPayload: RawChatData = {
    name: `${sourceChat.name} (Branch)`, 
    protagonistId: sourceChat.protagonist.id,
    participantIds: sourceChat.participants.map(p => p.id), 
    contextIds: sourceChat.contexts?.map(i => i.id) || [],
    chatMessageIdHistory: sourceChat.chatMessageHistory.slice(0, branchIndex + 1).map(m => m.id),
    firstCreatedTimestamp: Date.now(), 
    lastUpdatedTimestamp: Date.now(), 
    parentChatDataId, 
    parentChatMessageId,
    ProfileId: sourceChat.Profile?.id,
  };
  await putJson(`${PATHS.chatData}/${newChatId}.json`, newPayload);
  await updateManifest(PATHS.chatData, newChatId, 'add');
  return newChatId;
}

export async function deleteRawChatData(id: string): Promise<void> {
  try { await deleteResource(`${PATHS.kvCaches}/${id}`); } catch (e) { console.warn("KV cache cleanup failed", e); }
  await deleteResource(`${PATHS.chatData}/${id}.json`);
  await updateManifest(PATHS.chatData, id, 'remove');
}

export async function loadInterjectableActions(): Promise<InterjectableAction[]> {
  const actions = await fetchJson<InterjectableAction[]>(PATHS.actions);
  return actions && actions.length > 0 ? actions : DEFAULT_ACTIONS;
}

export async function saveInterjectableActions(actions: InterjectableAction[]): Promise<void> {
  await putJson(PATHS.actions, actions);
}

// --- Helpers ---
export function getCharacterImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  const cleanPath = PATHS.characterImages.startsWith('/') ? PATHS.characterImages : `/${PATHS.characterImages}`;
  return `${WRITE_API_URL}${cleanPath}/${imageFilename}`;
}

export async function uploadCharacterImage(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const imagePath = `${PATHS.characterImages}/${filename}`;
  await putJson(imagePath, { base64 });
  return filename;
}

export function getCharacterVoiceUrl(voiceFileName: string | undefined): string | null {
  if (!voiceFileName) return null;
  const cleanPath = PATHS.characterVoices.startsWith('/') ? PATHS.characterVoices : `/${PATHS.characterVoices}`;
  return `${WRITE_API_URL}${cleanPath}/${voiceFileName}`;
}

export async function uploadCharacterVoice(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const voicePath = `${PATHS.characterVoices}/${filename}`;
  await putJson(voicePath, { base64 });
  return filename;
}

export function getContextImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  const cleanPath = PATHS.contexts.startsWith('/') ? PATHS.contexts : `/${PATHS.contexts}`;
  return `${WRITE_API_URL}${cleanPath}/${imageFilename}`;
}

export async function uploadContextImage(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const imagePath = `${PATHS.contexts}/${filename}`;
  await putJson(imagePath, { base64 });
  return filename;
}