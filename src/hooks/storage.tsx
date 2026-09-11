// src/hooks/storage.ts
import type { 
  StopPattern, RawStopPattern, Sampler, RawSampler, Context, RawContext, LanguageModel, RawLanguageModel,
  Character, RawCharacter, InteractionMessage, RawInteractionMessage, InteractionData, RawInteractionData,
  BudgetStrategy, RawBudgetStrategy, InterjectableAction, Profile, RawProfile,
  SummarizationStep, RawSummarizationStep, Webpage, RawWebpage,
  Memory, RawMemory, Location, RawLocation, World,
  BudgetData,
  RawBudgetData,
  AudioTrack, RawAudioTrack,
  PromptBlock, RawPromptBlock,
} from '../types';

import { localURL } from '../configurations';
import { v4 as uuidv4 } from 'uuid';
import {
    browserReadJson, browserWriteJson, browserDeleteFile,
    browserListDirectory, isServerAvailable,
} from './browserStorage';

import { DefaultActions, DefaultSampler } from '../defaults';

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

const PATHS = {
  characters: "/user_data/character_data", 
  characterImages: "/user_data/character_images",
  characterVoices: "/user_data/character_voices",
  samplers: "/user_data/sampler_data", 
  contexts: "/user_data/context_data",
  locations: "/user_data/location_data",
  models: "/user_data/model_data",
  stopPatterns: "/user_data/stop_pattern_data", 
  interactionMessages: "/user_data/interaction_messages", 
  interactionData: "/user_data/interaction_data", 
  kvCaches: "/user_data/kv_caches",
  budgetStrategies: "/user_data/budget_strategies",
  profiles: "/user_data/profile_data",
  actions: "/user_data/actions.json",
  worlds: "/user_data/worlds",
  budgetData: "/user_data/budget_data.json",
  webpages: "/user_data/webpage_data",
  memories: "/user_data/memory_data",
  audioTracks: "/user_data/audio_tracks",
  promptBlocks: "/user_data/prompt_block_data",
};
const MANIFEST_FILE = 'manifest.json';

// ─── Server Availability Cache ──────────────────────────────────────

let _serverAvailable: boolean | null = null;

async function getServerAvailable(): Promise<boolean> {
    if (_serverAvailable !== null) return _serverAvailable;
    _serverAvailable = await isServerAvailable();
    return _serverAvailable;
}

/** Force re-check server availability (e.g., after network change). */
export function resetServerAvailability(): void {
    _serverAvailable = null;
}

// --- Generic Helpers ---

async function fetchJson<T>(url: string): Promise<T | null> {
  if (!(await getServerAvailable())) {
    return browserReadJson<T>(url);
  }

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
    if (!contentType || (!contentType.includes("application/json") && !contentType.includes("text/plain"))) {
       if (contentType && contentType.includes("text")) {
           // Fall through to parse
       } else {
           return null;
       }
    }

    const text = await response.text();
    if (!text.trim()) return null;
    
    return JSON.parse(text) as T;
  } catch (error) { 
    if ((error as Error).message.includes('Failed to fetch')) {
      console.warn(`Network error for ${url}, falling back to browser storage`);
      resetServerAvailability();
      return browserReadJson<T>(url);
    } else {
      console.warn(`Failed to parse JSON from ${url}:`, error);
    }
    return null; 
  }
}

async function putJson<T>(url: string, data: T): Promise<void> {
  if (!(await getServerAvailable())) {
    await browserWriteJson(url, data);
    return;
  }

  try {
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    const targetUrl = `${localURL}${cleanUrl}`;
    const response = await fetch(targetUrl, { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(data) 
    });
    if (!response.ok) throw new Error(`Failed to save data to ${targetUrl}: HTTP ${response.status}`);
  } catch (e) {
    if ((e as Error).message.includes('Failed to fetch') || (e as Error).message.includes('NetworkError')) {
      console.warn(`Network error saving ${url}, falling back to browser storage`);
      resetServerAvailability();
      await browserWriteJson(url, data);
    } else {
      throw e;
    }
  }
}

async function deleteResource(url: string): Promise<void> {
  if (!(await getServerAvailable())) {
    await browserDeleteFile(url);
    return;
  }

  try {
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    const targetUrl = `${localURL}${cleanUrl}`;
    const response = await fetch(targetUrl, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error(`Failed to delete resource at ${targetUrl}: HTTP ${response.status}`);
  } catch (e) {
    if ((e as Error).message.includes('Failed to fetch') || (e as Error).message.includes('NetworkError')) {
      console.warn(`Network error deleting ${url}, falling back to browser storage`);
      resetServerAvailability();
      await browserDeleteFile(url);
    } else {
      throw e;
    }
  }
}

async function ensureManifest(folderPath: string): Promise<string[]> {
  const manifestUrl = `${folderPath}/${MANIFEST_FILE}`;
  
  const currentIds = await fetchJson<string[]>(manifestUrl);
  
  if (currentIds && Array.isArray(currentIds)) {
    return currentIds;
  }

  console.log(`Manifest missing for ${folderPath}. Scanning directory...`);
  try {
    if (!(await getServerAvailable())) {
      const entries = await browserListDirectory(folderPath);
      const ids = entries
        .filter(f => f.endsWith('.json') && f !== MANIFEST_FILE)
        .map(f => f.replace('.json', ''));
      
      if (ids.length > 0) {
        console.log(`Found ${ids.length} items in ${folderPath} (browser). Creating manifest.`);
        await putJson(manifestUrl, ids);
      }
      return ids;
    }

    const files = await fetchJson<string[]>(folderPath);
    
    if (files && Array.isArray(files)) {
      const ids = files
        .filter(f => f.endsWith('.json') && f !== MANIFEST_FILE)
        .map(f => f.replace('.json', ''));
      
      console.log(`Found ${ids.length} items in ${folderPath}. Creating manifest.`);
      
      await putJson(manifestUrl, ids);
      return ids;
    }
  } catch (e) {
    console.warn(`Failed to scan directory ${folderPath}:`, e);
  }

  return [];
}

async function updateManifest(folderPath: string, id: string, action: 'add' | 'remove'): Promise<void> {
  const currentIds = await ensureManifest(folderPath);
  
  let newIds: string[];
  if (action === 'add') { 
    if (currentIds.includes(id)) return; 
    newIds = [...currentIds, id]; 
  } else { 
    newIds = currentIds.filter(existingId => existingId !== id); 
  }
  
  const manifestUrl = `${folderPath}/${MANIFEST_FILE}`;
  await putJson(manifestUrl, newIds);
}

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

async function loadInBatches<T>(ids: string[], loader: (id: string) => Promise<T | null>): Promise<(T | null)[]> {
  const numberOfIds = ids.length
  const batchSize = Math.cbrt(numberOfIds)
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

function getCleanPath(path: string){
  return PATHS.contexts.startsWith('/') ? path : `/${path}`;
}

function getCleanFileName(file: { name: string }){
  return file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

// --- Memory Repository ---

export async function loadRawMemoryManifest(): Promise<string[]> { 
  return await ensureManifest(PATHS.memories); 
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
    interactionData: undefined as unknown as InteractionData,
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
  const { id, interactionData, ...rest } = memory;
  const payload: RawMemory = {
    ...rest,
    interactionDataId: interactionData?.id ?? '',
    lastUpdatedTimestamp: Date.now(),
  };
  await putJson(`${PATHS.memories}/${id}.json`, payload);
  await updateManifest(PATHS.memories, id, 'add');
}

export async function deleteRawMemory(id: string): Promise<void> {
  await deleteResource(`${PATHS.memories}/${id}.json`);
  await updateManifest(PATHS.memories, id, 'remove');
}

export function resolveMemoryInteractionData(character: Character, allChats: InteractionData[]): Character {
  if (!character.memories || Object.keys(character.memories).length === 0) return character;
  const chatMap = new Map(allChats.map(c => [c.id, c]));
  const resolved: Record<string, Memory[]> = {};
  for (const [key, mems] of Object.entries(character.memories)) {
    resolved[key] = mems.map(m => ({
      ...m,
      interactionData: m.interactionData ?? chatMap.get((m as unknown as RawMemory).interactionDataId) ?? undefined,
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
export async function loadRawStopPatternManifest(): Promise<string[]> { 
  return await ensureManifest(PATHS.stopPatterns); 
}

export async function loadRawStopPattern(id: string): Promise<StopPattern | null> {
  const rawPattern = await fetchJson<RawStopPattern>(`${PATHS.stopPatterns}/${id}.json`);
  if (!rawPattern) return null;
  return { 
    id, 
    name: rawPattern.name || 'Unknown Pattern', 
    description: rawPattern.description, 
    pattern: rawPattern.pattern,
    regularExpressionActivationTrigger: rawPattern.regularExpressionActivationTrigger,
    regularExpressionDeactivationTrigger: rawPattern.regularExpressionDeactivationTrigger,
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
  return await ensureManifest(PATHS.samplers); 
}

export async function loadRawSampler(id: string): Promise<Sampler | null> {
  try {
    const rawSampler = await fetchJson<RawSampler>(`${PATHS.samplers}/${id}.json`);
    if (!rawSampler) return null;
    
    const stopPatternIds = rawSampler.stopPatternIds || [];
    const stopPatternsResults = await Promise.all(stopPatternIds.map(sid => loadRawStopPattern(sid)));
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
  return await ensureManifest(PATHS.characters); 
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

    const memories = await hydrateMemories(rawCharacter.memories);

    const images: Record<string, string> = rawCharacter.images ?? {};
    const legacyImage = ('image' in rawCharacter && typeof rawCharacter.image === 'string') ? rawCharacter.image : undefined;
    if (Object.keys(images).length === 0 && legacyImage) {
      images.neutral = legacyImage;
    }

    return { 
      id, 
      name: rawCharacter.name || 'Unknown Character', 
      images,
      voice: rawCharacter.voice,
      description: rawCharacter.description, 
      systemPrompt: rawCharacter.systemPrompt,
      thinkPrompt: rawCharacter.thinkPrompt,
      appearancePrompt: rawCharacter.appearancePrompt,
      dialoguePrompt: rawCharacter.dialoguePrompt,
      initiativeWeight: rawCharacter.initiativeWeight,
      chatProbability: rawCharacter.chatProbability, 
      maximumChatStamina: rawCharacter.maximumChatStamina,
      nameSensitivity: rawCharacter.nameSensitivity,
      chatImpatienceSensitivity: rawCharacter.chatImpatienceSensitivity,
      skipProbability: rawCharacter.skipProbability,
      memoryRetentionWeight: rawCharacter.memoryRetentionWeight,
      contextSensitivity: rawCharacter.contextSensitivity,
      sampler,
      doNotInjectCharacterImage: rawCharacter.doNotInjectCharacterImage,
      numberOfMessagesToDisableThinkPrompt: rawCharacter.numberOfMessagesToDisableThinkPrompt,
      numberOfMessagesToDisableMetaThinkInstructions: rawCharacter.numberOfMessagesToDisableMetaThinkInstructions,
      numberOfMessagesToDisableDialoguePrompt: rawCharacter.numberOfMessagesToDisableDialoguePrompt,
      enableWebSearch: rawCharacter.enableWebSearch,
      enableCalculator: rawCharacter.enableCalculator,
      enableMemoryWriting: rawCharacter.enableMemoryWriting,
      enableMemoryReading: rawCharacter.enableMemoryReading,
      memories,
      firstCreatedTimestamp: rawCharacter.firstCreatedTimestamp,
      lastUpdatedTimestamp: rawCharacter.lastUpdatedTimestamp,
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
  const { id, sampler, memories, ...rawCharacter } = character; 
  const serializedMemories = await serializeMemories(memories);
  const payload: RawCharacter = { 
    ...rawCharacter, 
    samplerId: sampler?.id,
    memories: serializedMemories,
    lastUpdatedTimestamp: Date.now(),
  };
  await putJson(`${PATHS.characters}/${id}.json`, payload);
  await updateManifest(PATHS.characters, id, 'add');
}

export async function deleteRawCharacter(id: string): Promise<void> {
  await deleteResource(`${PATHS.characters}/${id}.json`);
  await updateManifest(PATHS.characters, id, 'remove');
}

export async function loadCharacterShell(id: string): Promise<Character | null> {
    const rawCharacter = await fetchJson<RawCharacter>(`${PATHS.characters}/${id}.json`);
    if (!rawCharacter) return null;

    const memories = await hydrateMemories(rawCharacter.memories);

    const images: Record<string, string> = rawCharacter.images ?? {};
    if (Object.keys(images).length === 0 && 'image' in rawCharacter && typeof rawCharacter.image === 'string') {
      images.neutral = rawCharacter.image;
    }

    return {
        id,
        name: rawCharacter.name || 'Unknown Character',
        images,
        voice: rawCharacter.voice,
        description: rawCharacter.description,
        systemPrompt: rawCharacter.systemPrompt,
        thinkPrompt: rawCharacter.thinkPrompt,
        initiativeWeight: rawCharacter.initiativeWeight,
        chatProbability: rawCharacter.chatProbability,
        maximumChatStamina: rawCharacter.maximumChatStamina,
        nameSensitivity: rawCharacter.nameSensitivity,
        chatImpatienceSensitivity: rawCharacter.chatImpatienceSensitivity,
        skipProbability: rawCharacter.skipProbability,
        memoryRetentionWeight: rawCharacter.memoryRetentionWeight,
        contextSensitivity: rawCharacter.contextSensitivity,
        numberOfMessagesToDisableThinkPrompt: rawCharacter.numberOfMessagesToDisableThinkPrompt,
        numberOfMessagesToDisableMetaThinkInstructions: rawCharacter.numberOfMessagesToDisableMetaThinkInstructions,
        numberOfMessagesToDisableDialoguePrompt: rawCharacter.numberOfMessagesToDisableDialoguePrompt,
        sampler: undefined,
        enableWebSearch: rawCharacter.enableWebSearch,
        enableCalculator: rawCharacter.enableCalculator,
        enableMemoryWriting: rawCharacter.enableMemoryWriting,
        enableMemoryReading: rawCharacter.enableMemoryReading,
        memories,
        firstCreatedTimestamp: rawCharacter.firstCreatedTimestamp,
        lastUpdatedTimestamp: rawCharacter.lastUpdatedTimestamp,
    };
}

export async function loadAllCharacterShells(): Promise<Character[]> {
    const ids = await loadRawCharacterManifest();
    const results = await loadInBatches(ids, loadCharacterShell);
    return results.filter((c): c is Character => c !== null);
}

// --- Context Repository ---
export async function loadRawContextManifest(): Promise<string[]> { 
    return await ensureManifest(PATHS.contexts); 
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
        searchTerms: rawContext.searchTerms || [],
        searchEngine: rawContext.searchEngine,
        urls: rawContext.urls || [],
        includeLinkImages: rawContext.includeLinkImages,
        maximumLinkDepth: rawContext.maximumLinkDepth,
        linkFetchMode: rawContext.linkFetchMode || 'full',
        limitLinksToSubdirectory: rawContext.limitLinksToSubdirectory,
        fetchCacheTimeToLiveMs: rawContext.fetchCacheTimeToLiveMs,
        regularExpressionActivationTrigger: rawContext.regularExpressionActivationTrigger,
        regularExpressionDeactivationTrigger: rawContext.regularExpressionDeactivationTrigger,
        regularExpressionContext: rawContext.regularExpressionContext,
        regularExpressionTarget: rawContext.regularExpressionTarget,
        tokenBudget: rawContext.tokenBudget,
        maximumRecursionDepth: rawContext.maximumRecursionDepth,
        insertionDepth: rawContext.insertionDepth,
        characterBindings: rawContext.characterBindings,
        useBase64Encoding: rawContext.useBase64Encoding,
        isAutoGenerated: rawContext.isAutoGenerated,
        firstCreatedTimestamp: rawContext.firstCreatedTimestamp,
        lastUpdatedTimestamp: rawContext.lastUpdatedTimestamp,
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

// --- Location Repository ---
export async function loadRawLocationManifest(): Promise<string[]> {
    return await ensureManifest(PATHS.locations);
}

export async function loadRawLocation(id: string): Promise<Location | null> {
    const rawLocation = await fetchJson<RawLocation>(`${PATHS.locations}/${id}.json`);
    if (!rawLocation) return null;

    const now = Date.now();

    return {
        id,
        name: rawLocation.name || 'Unknown Location',
        description: rawLocation.description,
        text: rawLocation.text,
        images: rawLocation.images,
        backgroundImageRegularExpressionActivationTriggers: rawLocation.backgroundImageRegularExpressionActivationTriggers ?? {},
        backgroundImageWeights: rawLocation.backgroundImageWeights ?? {},
        locationBindings: rawLocation.locationBindings ?? {},
        locationBindingRegularExpressionTriggers: rawLocation.locationBindingRegularExpressionTriggers ?? {},
        regularExpressionActivationTrigger: rawLocation.regularExpressionActivationTrigger,
        characterBindings: rawLocation.characterBindings,
        globalWeight: rawLocation.globalWeight ?? 1,
        characterWeights: rawLocation.characterWeights ?? {},
        latitude: rawLocation.latitude ?? 0,
        longitude: rawLocation.longitude ?? 0,
        locationDistances: rawLocation.locationDistances?? {},
        useBase64Encoding: rawLocation.useBase64Encoding ?? false,
        firstCreatedTimestamp: rawLocation.firstCreatedTimestamp || now,
        lastUpdatedTimestamp: rawLocation.lastUpdatedTimestamp || now,
    };
}

export async function loadAllRawLocations(): Promise<Location[]> {
    const ids = await loadRawLocationManifest();
    const results = await loadInBatches(ids, loadRawLocation);
    return results.filter((l): l is Location => l !== null);
}

export async function saveRawLocation(location: Location): Promise<void> {
    const { id, ...rawLocation } = location;
    const payload: RawLocation = {
        ...rawLocation,
        lastUpdatedTimestamp: Date.now(),
    };
    await putJson(`${PATHS.locations}/${id}.json`, payload);
    await updateManifest(PATHS.locations, id, 'add');
}

export async function deleteRawLocation(id: string): Promise<void> {
    await deleteResource(`${PATHS.locations}/${id}.json`);
    await updateManifest(PATHS.locations, id, 'remove');
}

// --- Audio Track Repository ---
export async function loadRawAudioTrackManifest(): Promise<string[]> {
    return await ensureManifest(PATHS.audioTracks);
}

export async function loadRawAudioTrack(id: string): Promise<AudioTrack | null> {
    const raw = await fetchJson<RawAudioTrack>(`${PATHS.audioTracks}/${id}.json`);
    if (!raw) return null;

    const now = Date.now();

    return {
        id,
        name: raw.name || 'Untitled Track',
        description: raw.description,
        filename: raw.filename,
        loop: raw.loop ?? false,
        volume: raw.volume ?? 1,
        startFadeDurationMs: raw.startFadeDurationMs ?? 1000,
        endFadeDurationMs: raw.endFadeDurationMs ?? 1000,
        regularExpressionActivationTrigger: raw.regularExpressionActivationTrigger,
        regularExpressionDeactivationTrigger: raw.regularExpressionDeactivationTrigger,
        locationBindings: raw.locationBindings ?? [],
        contextBindings: raw.contextBindings ?? [],
        characterBindings: raw.characterBindings ?? [],
        priority: raw.priority ?? 0,
        audioCategory: raw.audioCategory ?? 'ambient',
        firstCreatedTimestamp: raw.firstCreatedTimestamp || now,
        lastUpdatedTimestamp: raw.lastUpdatedTimestamp || now,
    };
}

export async function loadAllRawAudioTracks(): Promise<AudioTrack[]> {
    const ids = await loadRawAudioTrackManifest();
    const results = await loadInBatches(ids, loadRawAudioTrack);
    return results.filter((t): t is AudioTrack => t !== null);
}

export async function saveRawAudioTrack(track: AudioTrack): Promise<void> {
    const { id, ...rawTrack } = track;
    const payload: RawAudioTrack = {
        ...rawTrack,
        lastUpdatedTimestamp: Date.now(),
    };
    await putJson(`${PATHS.audioTracks}/${id}.json`, payload);
    await updateManifest(PATHS.audioTracks, id, 'add');
}

export async function deleteRawAudioTrack(id: string): Promise<void> {
    await deleteResource(`${PATHS.audioTracks}/${id}.json`);
    await updateManifest(PATHS.audioTracks, id, 'remove');
}

// --- Prompt Block Repository ---
export async function loadRawPromptBlockManifest(): Promise<string[]> {
    return await ensureManifest(PATHS.promptBlocks);
}

export async function loadRawPromptBlock(id: string): Promise<PromptBlock | null> {
    const raw = await fetchJson<RawPromptBlock>(`${PATHS.promptBlocks}/${id}.json`);
    if (!raw) return null;

    const now = Date.now();

    return {
        id,
        name: raw.name || 'Untitled Prompt Block',
        description: raw.description,
        textContent: raw.textContent ?? '',
        images: raw.images ?? [],
        regularExpressionActivationTrigger: raw.regularExpressionActivationTrigger,
        regularExpressionDeactivationTrigger: raw.regularExpressionDeactivationTrigger,
        regularExpressionContext: raw.regularExpressionContext,
        regularExpressionTarget: raw.regularExpressionTarget,
        characterBindings: raw.characterBindings ?? [],
        contextBindings: raw.contextBindings ?? [],
        locationBindings: raw.locationBindings ?? [],
        firstCreatedTimestamp: raw.firstCreatedTimestamp || now,
        lastUpdatedTimestamp: raw.lastUpdatedTimestamp || now,
    };
}

export async function loadAllRawPromptBlocks(): Promise<PromptBlock[]> {
    const ids = await loadRawPromptBlockManifest();
    const results = await loadInBatches(ids, loadRawPromptBlock);
    return results.filter((b): b is PromptBlock => b !== null);
}

export async function saveRawPromptBlock(block: PromptBlock): Promise<void> {
    const { id, ...rawBlock } = block;
    const payload: RawPromptBlock = {
        ...rawBlock,
        lastUpdatedTimestamp: Date.now(),
    };
    await putJson(`${PATHS.promptBlocks}/${id}.json`, payload);
    await updateManifest(PATHS.promptBlocks, id, 'add');
}

export async function deleteRawPromptBlock(id: string): Promise<void> {
    await deleteResource(`${PATHS.promptBlocks}/${id}.json`);
    await updateManifest(PATHS.promptBlocks, id, 'remove');
}

// --- Language Model Repository ---
export async function loadRawModelManifest(): Promise<string[]> {
    return await ensureManifest(PATHS.models);
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
        lora: rawModel.lora,
        apiKey: rawModel.apiKey,
        parameters: rawModel.parameters,
        cacheHitCostPerOneMillionOfTokens: rawModel.cacheHitCostPerOneMillionOfTokens,
        cacheMissCostPerOneMillionOfTokens: rawModel.cacheMissCostPerOneMillionOfTokens,
        outputGenerationCostPerOneMillionOfTokens: rawModel.outputGenerationCostPerOneMillionOfTokens,
        firstCreatedTimestamp: rawModel.firstCreatedTimestamp,
        lastUpdatedTimestamp: rawModel.lastUpdatedTimestamp,
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
    return await ensureManifest(PATHS.budgetStrategies);
}

export async function loadRawBudgetStrategy(id: string): Promise<BudgetStrategy | null> {
    const rawStrategy = await fetchJson<RawBudgetStrategy>(`${PATHS.budgetStrategies}/${id}.json`);
    if (!rawStrategy) return null;
    
    try {
      const onlineModelPromises = (rawStrategy.onlineModelIds || []).map(mid => loadRawModel(mid));
      const onlineModelsResults = await Promise.all(onlineModelPromises);
      const onlineModels = onlineModelsResults.filter((m): m is LanguageModel => m !== null);

      const localModelPromises = (rawStrategy.localModelIds || []).map(mid => loadRawModel(mid));
      const localModelsResults = await Promise.all(localModelPromises);
      const localModels = localModelsResults.filter((m): m is LanguageModel => m !== null);

      const strategy: BudgetStrategy & { _rawOnlineModelIds?: string[]; _rawLocalModelIds?: string[] } = {
          id,
          name: rawStrategy.name || 'Unknown Strategy',
          description: rawStrategy.description,
          onlineModels,
          localModels,
          modelCostTiers: rawStrategy.modelCostTiers,
          switchProbability: rawStrategy.switchProbability,
          switchOnContextSize: rawStrategy.switchOnContextSize,
          switchOnComplexityScore: rawStrategy.switchOnComplexityScore,
          fallbackOnLocalFailure: rawStrategy.fallbackOnLocalFailure,
          fallbackOnQualityThreshold: rawStrategy.fallbackOnQualityThreshold,
          fallbackOnTimeoutInSeconds: rawStrategy.fallbackOnTimeoutInSeconds,
          maximumBudget: rawStrategy.maximumBudget,
          firstCreatedTimestamp: rawStrategy.firstCreatedTimestamp || Date.now(),
          lastUpdatedTimestamp: rawStrategy.lastUpdatedTimestamp || Date.now(),
          _rawOnlineModelIds: rawStrategy.onlineModelIds || [],
          _rawLocalModelIds: rawStrategy.localModelIds || [],
      };

      return strategy;
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
    const { id, onlineModels, localModels, ...rawStrategy } = strategy;
    const payload: RawBudgetStrategy = {
        ...rawStrategy,
        onlineModelIds: onlineModels.map(m => m.id),
        localModelIds: localModels.map(m => m.id),
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
    return await ensureManifest(PATHS.profiles);
}

export async function loadRawProfile(id: string): Promise<Profile | null> {
    const rawProfile = await fetchJson<RawProfile>(`${PATHS.profiles}/${id}.json`);
    if (!rawProfile) return null;

    const now = Date.now();

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
        volume: rawProfile.volume,
        forceNameReveal: rawProfile.forceNameReveal ?? false,
        enableCharacterExpression: rawProfile.enableCharacterExpression ?? false,
        forceNoCharacterImageInjection: rawProfile.forceNoCharacterImageInjection,
        forceNoContextImageInjection: rawProfile.forceNoContextImageInjection,
        forceNoLocationImageInjection: rawProfile.forceNoLocationImageInjection,
        useCurrentDateAndTime: rawProfile.useCurrentDateAndTime ?? false,
        useWeather: rawProfile.useWeather,
        weatherApiKey: rawProfile.weatherApiKey,
        useTimeElapsed: rawProfile.useTimeElapsed ?? false,
        numberOfMessagesToDisableThinkPrompt: rawProfile.numberOfMessagesToDisableThinkPrompt ?? 1,
        numberOfMessagesToDisableMetaThinkInstructions: rawProfile.numberOfMessagesToDisableMetaThinkInstructions ?? 1,
        numberOfMessagesToDisableDialoguePrompt: rawProfile.numberOfMessagesToDisableDialoguePrompt ?? 1,
        forceEqualInitiative: rawProfile.forceEqualInitiative ?? false,
        chatProbability: rawProfile.chatProbability ?? -1,
        maximumChatStamina: rawProfile.maximumChatStamina ?? -1,
        nameSensitivity: rawProfile.nameSensitivity ?? -1,
        chatImpatienceSensitivity: rawProfile.chatImpatienceSensitivity ?? -1,
        skipProbability: rawProfile.skipProbability ?? -1,
        memoryRetentionWeight: rawProfile.memoryRetentionWeight ?? -1,
        contextSensitivity: rawProfile.contextSensitivity ?? -1,
        cacheInvalidationReductionLevel: rawProfile.cacheInvalidationReductionLevel ?? 0,
        narrateNormalText: rawProfile.narrateNormalText,
        narrateQuotedText: rawProfile.narrateQuotedText,
        narrateBoldedText: rawProfile.narrateBoldedText,
        narrateItalicizedText: rawProfile.narrateItalicizedText,
        stripThinkTokens: rawProfile.stripThinkTokens ?? false,
        enableWebSearch: rawProfile.enableWebSearch ?? 0,
        enableCalculator: rawProfile.enableCalculator ?? 0,
        enableMemoryWriting: rawProfile.enableMemoryWriting ?? 0,
        enableMemoryReading: rawProfile.enableMemoryReading ?? 0,
        inputStrategy: rawProfile.inputStrategy ?? [...getDefaultSummarizationSteps().map(() => 'System Prompt')].slice(0, 0).concat(['System Prompt', 'Think Prompt', 'Meta Think Instructions', 'Appearance Prompt', 'Dialogue Prompt', 'Memory', 'Chat History', 'Context', 'Location', 'Fatigue Information', 'Date And Time', 'Weather', 'Time Elapsed', 'Tool Instructions', 'Text Injection'] as const),
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
    const rawSteps: RawSummarizationStep[] = summarizationSteps.map(({...rest }) => rest);
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

// --- Webpage Repository ---
export async function loadRawWebpageManifest(): Promise<string[]> {
    return await ensureManifest(PATHS.webpages);
}

export async function loadRawWebpage(id: string): Promise<Webpage | null> {
    const rawWebpage = await fetchJson<RawWebpage>(`${PATHS.webpages}/${id}.json`);
    if (!rawWebpage) return null;

    return {
        id,
        name: rawWebpage.name || 'Untitled Webpage',
        description: rawWebpage.description,
        url: rawWebpage.url,
        content: rawWebpage.content,
        firstCreatedTimestamp: rawWebpage.firstCreatedTimestamp || Date.now(),
        lastUpdatedTimestamp: rawWebpage.lastUpdatedTimestamp || Date.now(),
    };
}

export async function loadAllRawWebpages(): Promise<Webpage[]> {
    const ids = await loadRawWebpageManifest();
    const results = await loadInBatches(ids, loadRawWebpage);
    return results.filter((w): w is Webpage => w !== null);
}

export async function saveRawWebpage(webpage: Webpage): Promise<void> {
    const { id, ...rawWebpage } = webpage;
    const payload: RawWebpage = {
        ...rawWebpage,
        lastUpdatedTimestamp: Date.now(),
    };
    await putJson(`${PATHS.webpages}/${id}.json`, payload);
    await updateManifest(PATHS.webpages, id, 'add');
}

export async function deleteRawWebpage(id: string): Promise<void> {
    await deleteResource(`${PATHS.webpages}/${id}.json`);
    await updateManifest(PATHS.webpages, id, 'remove');
}

export async function findWebpageByUrl(url: string): Promise<Webpage | null> {
    const all = await loadAllRawWebpages();
    return all.find(w => w.url === url) || null;
}

// --- Chat Message Repository ---
export async function deleteRawInteractionMessage(id: string): Promise<void> { 
    await deleteResource(`${PATHS.interactionMessages}/${id}.json`); 
}

// --- Chat Data Repository ---
export async function loadRawChatManifest(): Promise<string[]> { 
    return await ensureManifest(PATHS.interactionData); 
}

async function buildInteractionDataShell(
  id: string, 
  rawInteractionData: RawInteractionData, 
  charMap: Map<string, Character>, 
  contextMap: Map<string, Context>,
  locationMap: Map<string, Location>,
  profileMap: Map<string, Profile>,
  audioTrackMap?: Map<string, AudioTrack>,
): Promise<InteractionData | null> {

  const now = Date.now();
  
  let protagonist = charMap.get(rawInteractionData.protagonistId);
  if (!protagonist) {
    protagonist = {
      id: rawInteractionData.protagonistId,
      name: '[Deleted Character]',
      description: 'This character has been deleted.',
      images: {},
      initiativeWeight: 1,
      chatProbability: 0.5,
      maximumChatStamina: 4,
      nameSensitivity: 1,
      chatImpatienceSensitivity: 1,
      skipProbability: 1,
      memoryRetentionWeight: 1,
      contextSensitivity: 1,
      numberOfMessagesToDisableThinkPrompt: 0,
      numberOfMessagesToDisableMetaThinkInstructions: 0,
      numberOfMessagesToDisableDialoguePrompt: 0,
      enableWebSearch: false,
      enableCalculator: false,
      enableMemoryWriting: false,
      enableMemoryReading: false,
      memories: {},
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    };
  }

  const participants = rawInteractionData.participantIds
    .map(pid => {
      const found = charMap.get(pid);
      if (found) return found;
      return {
        id: pid,
        name: '[Deleted Character]',
        description: 'This character has been deleted.',
        images: {},
        initiativeWeight: 1,
        chatProbability: 0.5,
        maximumChatStamina: 4,
        nameSensitivity: 1,
        skipProbability: 1,
        memoryRetentionWeight: 1,
        contextSensitivity: 1,
        numberOfMessagesToDisableThinkPrompt: 0,
        numberOfMessagesToDisableMetaThinkInstructions: 0,
        numberOfMessagesToDisableDialoguePrompt: 0,
        enableWebSearch: false,
        enableCalculator: false,
        enableMemoryWriting: false,
        enableMemoryReading: false,
        memories: {},
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
      } as Character;
    });
    
  if (!participants.find(p => p.id === protagonist.id)) {
    participants.push(protagonist);
  }

  const contexts = (rawInteractionData.contextIds || [])
    .map(iid => contextMap.get(iid))
    .filter((i): i is Context => i !== undefined);

  const locations = (rawInteractionData.locationIds || [])
    .map(lid => locationMap.get(lid))
    .filter((l): l is Location => l !== undefined);

  const profile = rawInteractionData.ProfileId ? profileMap.get(rawInteractionData.ProfileId) : undefined;

  const audioTracks = audioTrackMap
    ? (rawInteractionData.audioTrackIds || [])
        .map(tid => audioTrackMap.get(tid))
        .filter((t): t is AudioTrack => t !== undefined)
    : [];

  return {
    id, 
    name: rawInteractionData.name || "Untitled Chat", 
    protagonist, 
    participants, 
    contexts,
    locations,
    audioTracks,
    interactionHistory: [],
    numberOfMessages: rawInteractionData.interactionIdHistory?.length ?? 0,
    firstCreatedTimestamp: rawInteractionData.firstCreatedTimestamp || Date.now(), 
    lastUpdatedTimestamp: rawInteractionData.lastUpdatedTimestamp || Date.now(),
    parentInteractionDataId: rawInteractionData.parentInteractionDataId || null, 
    parentInteractionMessageId: rawInteractionData.parentInteractionMessageId || null,
    Profile: profile,
  };
}

export async function loadInteractionMessages(interactionData: InteractionData): Promise<InteractionData> {
    if (interactionData.interactionHistory.length > 0) return interactionData;

    const rawInteractionData = await fetchJson<RawInteractionData>(`${PATHS.interactionData}/${interactionData.id}.json`);
    if (!rawInteractionData || !rawInteractionData.interactionIdHistory || rawInteractionData.interactionIdHistory.length === 0) {
        return interactionData;
    }

    const charMap = new Map<string, Character>();
    if (interactionData.protagonist) charMap.set(interactionData.protagonist.id, interactionData.protagonist);
    for (const p of interactionData.participants) {
        charMap.set(p.id, p);
    }

    const messagePromises = rawInteractionData.interactionIdHistory.map(async (messageId) => {
        const rawMessage = await fetchJson<RawInteractionMessage>(`${PATHS.interactionMessages}/${messageId}.json`);
        if (!rawMessage) return null;

        const character = charMap.get(rawMessage.characterId);
        const { characterId, ...messageWithoutCharId } = rawMessage;

        return {
            id: messageId,
            ...messageWithoutCharId,
            character: character || {
                id: characterId,
                name: '[Unknown]',
                images: {},
                firstCreatedTimestamp: Date.now(),
                lastUpdatedTimestamp: Date.now()
            } as Character
        };
    });

    const interactionHistory = (await Promise.all(messagePromises)).filter((m): m is InteractionMessage => m !== null);

    return { ...interactionData, interactionHistory, numberOfMessages: interactionHistory.length };
}

/** Loads full interaction data including all messages. */
export async function loadRawInteractionData(
  id: string,
  existingCharShells?: Character[]
): Promise<InteractionData | null> {
  const rawInteractionData = await fetchJson<RawInteractionData>(`${PATHS.interactionData}/${id}.json`);
  if (!rawInteractionData) return null;

  const charMap = new Map<string, Character>();
  if (existingCharShells && existingCharShells.length > 0) {
    for (const c of existingCharShells) charMap.set(c.id, c);
  } else {
    const neededIds = [...new Set([rawInteractionData.protagonistId, ...(rawInteractionData.participantIds || [])])];
    const shells = await Promise.all(neededIds.map(loadCharacterShell));
    for (const s of shells) { if (s) charMap.set(s.id, s); }
  }

  const contextMap = new Map<string, Context>();
  if (rawInteractionData.contextIds?.length) {
    const ctxResults = await Promise.all(
      rawInteractionData.contextIds.map(async (cid) => {
        try {
          return await loadRawContext(cid);
        } catch {
          console.warn(`Context ${cid} not found, skipping.`);
          return null;
        }
      })
    );
    for (const c of ctxResults) { if (c) contextMap.set(c.id, c); }
  }

  const locationMap = new Map<string, Location>();
  if (rawInteractionData.locationIds?.length) {
    const locResults = await Promise.all(
      rawInteractionData.locationIds.map(async (lid) => {
        try {
          return await loadRawLocation(lid);
        } catch {
          console.warn(`Location ${lid} not found, skipping.`);
          return null;
        }
      })
    );
    for (const l of locResults) { if (l) locationMap.set(l.id, l); }
  }

  const profileMap = new Map<string, Profile>();
  if (rawInteractionData.ProfileId) {
    const p = await loadRawProfile(rawInteractionData.ProfileId);
    if (p) profileMap.set(p.id, p);
  }

  const audioTrackMap = new Map<string, AudioTrack>();
  if (rawInteractionData.audioTrackIds?.length) {
    const trackResults = await Promise.all(
      rawInteractionData.audioTrackIds.map(async (tid) => {
        try {
          return await loadRawAudioTrack(tid);
        } catch {
          console.warn(`Audio track ${tid} not found, skipping.`);
          return null;
        }
      })
    );
    for (const t of trackResults) { if (t) audioTrackMap.set(t.id, t); }
  }

  const shell = await buildInteractionDataShell(id, rawInteractionData, charMap, contextMap, locationMap, profileMap, audioTrackMap);
  if (!shell) return null;

  return loadInteractionMessages(shell);
}

export async function loadAllRawInteractionDataShells(): Promise<InteractionData[]> {
  const ids = await loadRawChatManifest();
  if (ids.length === 0) return [];

  const allCharShells = await loadAllCharacterShells();
  const charMap = new Map(allCharShells.map(c => [c.id, c]));

  const results: (InteractionData | null)[] = [];
  
  for (let i = 0; i < ids.length; i += 5) {
    const batchIds = ids.slice(i, i + 5);
    const batchPromises = batchIds.map(async (id) => {
      const raw = await fetchJson<RawInteractionData>(`${PATHS.interactionData}/${id}.json`);
      if (!raw) return null;

      const emptyContextMap = new Map<string, Context>();
      const emptyLocationMap = new Map<string, Location>();
      const emptyProfileMap = new Map<string, Profile>();
      const emptyAudioTrackMap = new Map<string, AudioTrack>();
      return buildInteractionDataShell(id, raw, charMap, emptyContextMap, emptyLocationMap, emptyProfileMap, emptyAudioTrackMap);
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    if (i + 5 < ids.length) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  return results.filter((c): c is InteractionData => c !== null);
}

export async function saveRawInteractionData(interactionData: InteractionData): Promise<void> {
  if (!interactionData.protagonist?.id) return;

  const saveMessagePromises = interactionData.interactionHistory.map(message => {
    const { id, character, ...rawMsg } = message;
    const payload = {
      ...rawMsg,
      characterId: character.id,
      lastUpdatedTimestamp: Date.now(),
    };
    return putJson(`${PATHS.interactionMessages}/${id}.json`, payload);
  });
  
  for (let i = 0; i < saveMessagePromises.length; i += 10) {
    await Promise.all(saveMessagePromises.slice(i, i + 10));
  }

  const { id, protagonist, participants, contexts, locations, audioTracks, interactionHistory, parentInteractionDataId, parentInteractionMessageId, Profile, ...rawInteractionData } = interactionData;
  const payload: RawInteractionData = {
    ...rawInteractionData, 
    protagonistId: protagonist.id, 
    participantIds: participants.map(p => p.id),
    contextIds: contexts?.map(i => i.id) || [],
    locationIds: locations?.map(l => l.id) || [],
    audioTrackIds: audioTracks?.map(t => t.id) || [],
    interactionIdHistory: interactionHistory.map(m => m.id),
    parentInteractionDataId: parentInteractionDataId || null, 
    parentInteractionMessageId: parentInteractionMessageId || null,
    ProfileId: Profile?.id,
    lastUpdatedTimestamp: Date.now(),
  };
  await putJson(`${PATHS.interactionData}/${id}.json`, payload);
  await updateManifest(PATHS.interactionData, id, 'add');
}

export async function branchRawInteractionData(parentInteractionDataId: string, parentInteractionMessageId: string): Promise<string> {
  const sourceChat = await loadRawInteractionData(parentInteractionDataId);
  if (!sourceChat) throw new Error("Source chat not found");
  const branchIndex = sourceChat.interactionHistory.findIndex(m => m.id === parentInteractionMessageId);
  if (branchIndex === -1) throw new Error("Branch point message not found");
  const newChatId = uuidv4();
  const newPayload: RawInteractionData = {
    name: `${sourceChat.name} (Branch)`, 
    protagonistId: sourceChat.protagonist.id,
    participantIds: sourceChat.participants.map(p => p.id), 
    contextIds: sourceChat.contexts?.map(i => i.id) || [],
    locationIds: sourceChat.locations?.map(l => l.id) || [],
    audioTrackIds: sourceChat.audioTracks?.map(t => t.id) || [],
    interactionIdHistory: sourceChat.interactionHistory.slice(0, branchIndex + 1).map(m => m.id),
    firstCreatedTimestamp: Date.now(), 
    lastUpdatedTimestamp: Date.now(), 
    parentInteractionDataId, 
    parentInteractionMessageId,
    ProfileId: sourceChat.Profile?.id,
  };
  await putJson(`${PATHS.interactionData}/${newChatId}.json`, newPayload);
  await updateManifest(PATHS.interactionData, newChatId, 'add');
  return newChatId;
}

export async function deleteRawInteractionData(id: string): Promise<void> {
  try { await deleteResource(`${PATHS.kvCaches}/${id}`); } catch (e) { console.warn("KV cache cleanup failed", e); }
  await deleteResource(`${PATHS.interactionData}/${id}.json`);
  await updateManifest(PATHS.interactionData, id, 'remove');
}

export async function loadInterjectableActions(): Promise<InterjectableAction[]> {
  const actions = await fetchJson<InterjectableAction[]>(PATHS.actions);
  return actions && actions.length > 0 ? actions : DefaultActions;
}

export async function saveInterjectableActions(actions: InterjectableAction[]): Promise<void> {
  await putJson(PATHS.actions, actions);
}

// --- World Repository ---
export async function loadRawWorldManifest(): Promise<string[]> {
    return await ensureManifest(PATHS.worlds);
}

export async function loadRawWorld(id: string): Promise<World | null> {
    const raw = await fetchJson<World>(`${PATHS.worlds}/${id}.json`);
    if (!raw) return null;
    return raw;
}

export async function loadAllRawWorlds(): Promise<World[]> {
    const ids = await loadRawWorldManifest();
    const results = await loadInBatches(ids, loadRawWorld);
    return results.filter((w): w is World => w !== null);
}

export async function saveRawWorld(world: World): Promise<void> {
    await putJson(`${PATHS.worlds}/${world.id}.json`, world);
    await updateManifest(PATHS.worlds, world.id, 'add');
}

export async function deleteRawWorld(id: string): Promise<void> {
    await deleteResource(`${PATHS.worlds}/${id}.json`);
    await updateManifest(PATHS.worlds, id, 'remove');
}

// --- Budget Data Repository (Global Singleton) ---

export async function loadRawBudgetData(): Promise<BudgetData | null> {
    const raw = await fetchJson<RawBudgetData>(PATHS.budgetData);
    if (!raw) return null;

    try {
        const strategy = raw.budgetStrategyId ? await loadRawBudgetStrategy(raw.budgetStrategyId) : null;
        if (!strategy) return null;

        const now = Date.now()

        return {
            id: raw.id || 'global-budget-data',
            name: 'Global Budget Data',
            description: 'Persistent runtime budget tracking',
            budgetSpent: raw.budgetSpent ?? 0,
            resetDuration: raw.resetDuration,
            averageLatencyMsPerTokenExponentialMovingAverageSmoothing: raw.averageLatencyMsPerTokenExponentialMovingAverageSmoothing,
            averageTimeToFirstTokenExponentialMovingAverageSmoothing: raw.averageTimeToFirstTokenExponentialMovingAverageSmoothing,
            modelLastUsedTimestamps: raw.modelLastUsedTimestamps ?? {},
            modelLastQuotaHitTimeStamps: raw.modelLastQuotaHitTimeStamps ?? {},
            modelLastErrorHitTimeStamps: raw.modelLastErrorHitTimeStamps ?? {},
            modelUsedCount: raw.modelUsedCount ?? {},
            modelCensorshipHitCount: raw.modelCensorshipHitCount ?? {},
            modelBrokenCount: raw.modelBrokenCount ??{},
            modelQuotaHitCount: raw.modelQuotaHitCount ?? {},
            modelErrorHitCount: raw.modelErrorHitCount ?? {},
            lastResetTimestamp: raw.lastResetTimestamp,
            budgetStrategy: strategy,
            modelBudgetSpent: raw.modelBudgetSpent,
            modelAverageLatencyMsPerToken: raw.modelAverageLatencyMsPerToken || {},
            modelAverageTimeToFirstToken: raw.modelAverageTimeToFirstToken ||{},
            modelTotalSessionDuration: raw.modelTotalSessionDuration || {},
            firstCreatedTimestamp: raw.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: raw.lastUpdatedTimestamp || now,
        };
    } catch (e) {
        console.warn('Failed to load budget data:', e);
        return null;
    }
}

export async function saveRawBudgetData(data: BudgetData): Promise<void> {
    const payload: RawBudgetData = {
        id: data.id,
        name: data.name,
        description: data.description,
        budgetSpent: data.budgetSpent,
        resetDuration: data.resetDuration,
        averageLatencyMsPerTokenExponentialMovingAverageSmoothing: data.averageLatencyMsPerTokenExponentialMovingAverageSmoothing,
        averageTimeToFirstTokenExponentialMovingAverageSmoothing: data.averageTimeToFirstTokenExponentialMovingAverageSmoothing,
        modelLastUsedTimestamps: data.modelLastUsedTimestamps,
        modelLastQuotaHitTimeStamps: data.modelLastQuotaHitTimeStamps,
        modelLastErrorHitTimeStamps: data.modelLastErrorHitTimeStamps,
        modelUsedCount: data.modelUsedCount,
        modelCensorshipHitCount: data.modelCensorshipHitCount,
        modelBrokenCount: data.modelBrokenCount,
        modelQuotaHitCount: data.modelQuotaHitCount,
        modelErrorHitCount: data.modelErrorHitCount,
        lastResetTimestamp: data.lastResetTimestamp,
        budgetStrategyId: data.budgetStrategy.id,
        modelBudgetSpent: data.modelBudgetSpent,
        modelAverageLatencyMsPerToken: data.modelAverageLatencyMsPerToken,
        modelAverageTimeToFirstToken: data.modelAverageTimeToFirstToken,
        modelTotalSessionDuration: data.modelTotalSessionDuration,
        firstCreatedTimestamp: data.firstCreatedTimestamp,
        lastUpdatedTimestamp: Date.now(),
    };
    await putJson(PATHS.budgetData, payload);
}

// --- Image & Voice Helpers ---

export function getCharacterImageUrl(characterId: string, characterExpression?: string): string | null {
    const effectiveCharacterExpression = characterExpression || "neutral";
    const cleanPath = PATHS.characterImages.startsWith('/') ? PATHS.characterImages : `/${PATHS.characterImages}`;
    return `${localURL}${cleanPath}/${characterId}/${effectiveCharacterExpression}`;
}

export async function getCharacterImageUrlWithFallBack(characterId: string, characterExpression?: string): Promise<string | null> {
    const characterImageUrl = getCharacterImageUrl(characterId, characterExpression);
    if (!characterImageUrl) return null;

    try {
        const response = await fetch(characterImageUrl, { method: 'HEAD' });
        if (response.ok) return characterImageUrl;
    } catch {
        // File doesn't exist or network error — fall through to neutral
    }

    const effectiveExpression = characterExpression || "neutral";
    if (effectiveExpression !== 'neutral') {
        const neutralUrl = getCharacterImageUrl(characterId, 'neutral');
        if (neutralUrl) {
            try {
                const response = await fetch(neutralUrl, { method: 'HEAD' });
                if (response.ok) return neutralUrl;
            } catch {
                // Neutral doesn't exist either
            }
        }
    }

    return null;
}

export async function uploadCharacterImage(characterId: string, file: File): Promise<string> {
    const base64 = await fileToBase64(file);
    const filename = getCleanFileName(file);
    const imagePath = `${PATHS.characterImages}/${characterId}/${filename}`;
    await putJson(imagePath, { base64 });
    return filename;
}

export function getCharacterVoiceUrl(voiceFileName: string | undefined): string | null {
  if (!voiceFileName) return null;
  const cleanPath = PATHS.characterVoices.startsWith('/') ? PATHS.characterVoices : `/${PATHS.characterVoices}`;
  return `${localURL}${cleanPath}/${voiceFileName}`;
}

export async function uploadCharacterVoice(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = getCleanFileName(file);
  const voicePath = `${PATHS.characterVoices}/${filename}`;
  await putJson(voicePath, { base64 });
  return filename;
}

export function getContextImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  const cleanPath = getCleanPath(PATHS.contexts);
  return `${localURL}${cleanPath}/${imageFilename}`;
}

export async function uploadContextImage(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = getCleanFileName(file);
  const imagePath = `${PATHS.contexts}/${filename}`;
  await putJson(imagePath, { base64 });
  return filename;
}

export function getLocationImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  const cleanPath = getCleanPath(PATHS.locations);
  return `${localURL}${cleanPath}/${imageFilename}`;
}

export async function uploadLocationImage(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = getCleanFileName(file);
  const imagePath = `${PATHS.locations}/${filename}`;
  await putJson(imagePath, { base64 });
  return filename;
}

export function getAudioTrackUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  const cleanPath = getCleanPath(PATHS.audioTracks);
  return `${localURL}${cleanPath}/${imageFilename}`;
}

export async function uploadAudioTrack(file: File): Promise<string> {
    const base64 = await fileToBase64(file);
    const filename = getCleanFileName(file);
    const audioPath = `${PATHS.audioTracks}/${filename}`;
    await putJson(audioPath, { base64 });
    return filename;
}

export function getPromptBlockImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  const cleanPath = getCleanPath(PATHS.promptBlocks);
  return `${localURL}${cleanPath}/${imageFilename}`;
}

export async function uploadPromptBlockImage(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = getCleanFileName(file);
  const imagePath = `${PATHS.promptBlocks}/${filename}`;
  await putJson(imagePath, { base64 });
  return filename;
}