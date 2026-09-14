// src/storage/serverStorage.tsx
import type { 
  StopPattern, RawStopPattern, Sampler, RawSampler, Context, RawContext, LanguageModel, RawLanguageModel,
  Character, RawCharacter, InteractionMessage, RawInteractionMessage, InteractionData, RawInteractionData,
  BudgetStrategy, RawBudgetStrategy, InterjectableAction, Profile, RawProfile,
  SummarizationStep, RawSummarizationStep, Webpage, RawWebpage,
  Memory, RawMemory, Location, RawLocation, World,
  BudgetData, RawBudgetData,
  AudioTrack, RawAudioTrack,
  PromptBlock, RawPromptBlock,
  tool, textType,
} from '../types';

import { localURL } from '../configurations';
import { v4 as uuidv4 } from 'uuid';
import {
    browserReadJson, browserWriteJson, browserDeleteFile,
    browserListDirectory, isServerAvailable,
} from './browserStorage';

import { DefaultActions, DefaultSampler, defaultCharacterTools, defaultInputStrategy } from '../defaults';

// =============================================================================
// CONFIGURATION & CONSTANTS
// =============================================================================

const MANIFEST_FILE = 'manifest.json';
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 10;

/**
 * Entity Registry - Single source of truth for entity metadata.
 * Keys are used as TypeScript identifiers and match the PATHS object keys.
 */
const ENTITY_REGISTRY = {
  characters: { dir: 'character_data' },
  characterImages: { dir: 'character_images' },
  characterVoices: { dir: 'character_voices' },
  samplers: { dir: 'sampler_data' },
  contexts: { dir: 'context_data' },
  locations: { dir: 'location_data' },
  models: { dir: 'model_data' },
  stopPatterns: { dir: 'stop_pattern_data' },
  interactionMessages: { dir: 'interaction_messages' },
  interactionData: { dir: 'interaction_data' },
  kvCaches: { dir: 'kv_caches' },
  budgetStrategies: { dir: 'budget_strategies' },
  profiles: { dir: 'profile_data' },
  worlds: { dir: 'worlds' },
  webpages: { dir: 'webpage_data' },
  memories: { dir: 'memory_data' },
  audioTracks: { dir: 'audio_tracks' },
  promptBlocks: { dir: 'prompt_block_data' },
} as const;

type EntityKey = keyof typeof ENTITY_REGISTRY;

// Derive PATHS from registry
const PATHS = Object.fromEntries(
  Object.entries(ENTITY_REGISTRY).map(([key, config]) => [
    key,
    `/user_data/${config.dir}`
  ])
) as Record<EntityKey, string>;

// Special singleton paths
const ACTIONS_PATH = '/user_data/actions.json';
const BUDGET_DATA_PATH = '/user_data/budget_data.json';

// =============================================================================
// DEFAULTS & MIGRATIONS
// =============================================================================

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

const DEFAULT_NARRATE_TEXTS: Record<textType, boolean> = {
    normal: true,
    quoted: false,
    bolded: false,
    italicized: false,
    parenthesized: false,
    bracketed: false,
    braced: false,
};

// =============================================================================
// SERVER AVAILABILITY & HTTP HELPERS
// =============================================================================

let _serverAvailable: boolean | null = null;

async function getServerAvailable(): Promise<boolean> {
    if (_serverAvailable !== null) return _serverAvailable;
    _serverAvailable = await isServerAvailable();
    return _serverAvailable;
}

export function resetServerAvailability(): void {
    _serverAvailable = null;
}

function normalizeUrl(url: string): string {
    return url.startsWith('/') ? url : `/${url}`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  if (!(await getServerAvailable())) {
    return browserReadJson<T>(url);
  }

  try {
    const targetUrl = `${localURL}${normalizeUrl(url)}`;
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
    const targetUrl = `${localURL}${normalizeUrl(url)}`;
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
    const targetUrl = `${localURL}${normalizeUrl(url)}`;
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

// =============================================================================
// MANIFEST MANAGEMENT
// =============================================================================

async function ensureManifest(entityKey: EntityKey): Promise<string[]> {
  const folderPath = PATHS[entityKey];
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

async function updateManifest(entityKey: EntityKey, id: string, action: 'add' | 'remove'): Promise<void> {
  const folderPath = PATHS[entityKey];
  const currentIds = await ensureManifest(entityKey);
  
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

// =============================================================================
// BATCH LOADING UTILITY
// =============================================================================

async function loadInBatches<T>(ids: string[], loader: (id: string) => Promise<T | null>): Promise<(T | null)[]> {
  const results: (T | null)[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(loader));
    results.push(...batchResults);
    if (i + BATCH_SIZE < ids.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  return results;
}

// =============================================================================
// FILE UTILITIES
// =============================================================================

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

function getCleanFileName(file: { name: string }): string {
  return file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function migrateNarrateTexts(rawProfile: RawProfile): Record<textType, boolean> {
    if (rawProfile.narrateTexts) return rawProfile.narrateTexts;

    return {
        normal: (rawProfile as any).narrateNormalText ?? DEFAULT_NARRATE_TEXTS.normal,
        quoted: (rawProfile as any).narrateQuotedText ?? DEFAULT_NARRATE_TEXTS.quoted,
        bolded: (rawProfile as any).narrateBoldedText ?? DEFAULT_NARRATE_TEXTS.bolded,
        italicized: (rawProfile as any).narrateItalicizedText ?? DEFAULT_NARRATE_TEXTS.italicized,
        parenthesized: DEFAULT_NARRATE_TEXTS.parenthesized,
        bracketed: DEFAULT_NARRATE_TEXTS.bracketed,
        braced: DEFAULT_NARRATE_TEXTS.braced,
    };
}

// =============================================================================
// GENERIC HYDRATION & SERIALIZATION
// =============================================================================

/**
 * Hydrates a raw entity into its full type.
 * 1. Spreads defaults
 * 2. Spreads raw data (overwriting defaults)
 * 3. Injects ID
 * 4. Ensures timestamps
 * 5. Applies specific transforms for complex fields
 */
function hydrateEntity<T extends { id: string }, R extends Record<string, any>>(
    raw: R,
    id: string,
    defaults?: Partial<T>,
    transforms?: Partial<Record<keyof T, (raw: R, id: string) => any>>
): T {
    const now = Date.now();
    
    // Base object: Defaults < Raw < System Fields
    const base = {
        ...defaults,
        ...raw,
        id,
        firstCreatedTimestamp: raw.firstCreatedTimestamp || now,
        lastUpdatedTimestamp: raw.lastUpdatedTimestamp || now,
    } as unknown as T;

    // Apply transforms for fields that need renaming or computation
    if (transforms) {
        for (const [key, fn] of Object.entries(transforms)) {
            (base as any)[key] = fn(raw, id);
        }
    }

    return base;
}

/**
 * Serializes a hydrated entity back to raw format.
 * 1. Strips system fields (id)
 * 2. Updates timestamp
 * 3. Applies specific transforms for de-hydration
 */
function serializeEntity<T, R>(
    entity: T,
    stripKeys: (keyof T)[],
    transforms?: Partial<Record<string, (entity: T) => any>>
): R {
    const result = { ...entity } as any;
    
    // Remove keys that shouldn't be in the raw file (like 'id' which is in filename)
    for (const key of stripKeys) {
        delete result[key];
    }
    
    result.lastUpdatedTimestamp = Date.now();

    // Apply transforms (e.g., converting objects back to IDs)
    if (transforms) {
        for (const [key, fn] of Object.entries(transforms)) {
            result[key] = fn(entity);
        }
    }

    return result as R;
}

// =============================================================================
// REPOSITORY FACTORY
// =============================================================================

interface RepositoryConfig<T, R> {
  entityKey: EntityKey;
  defaults?: Partial<T>;
  hydrateTransforms?: Partial<Record<keyof T, (raw: R, id: string) => any>>;
  serializeTransforms?: Partial<Record<string, (entity: T) => any>>;
  stripKeys?: (keyof T)[];
}

function createRepository<T extends { id: string }, R extends Record<string, any>>(config: RepositoryConfig<T, R>) {
  const { entityKey, defaults, hydrateTransforms, serializeTransforms, stripKeys = ['id'] } = config;
  const folderPath = PATHS[entityKey];

  async function loadManifest(): Promise<string[]> {
    return await ensureManifest(entityKey);
  }

  async function loadRaw(id: string): Promise<T | null> {
    try {
      const raw = await fetchJson<R>(`${folderPath}/${id}.json`);
      if (!raw) return null;
      return hydrateEntity<T, R>(raw, id, defaults, hydrateTransforms);
    } catch (e) {
      console.warn(`Failed to load ${entityKey} ${id}`, e);
      return null;
    }
  }

  async function loadAll(): Promise<T[]> {
    const ids = await loadManifest();
    const results = await loadInBatches(ids, loadRaw);
    return results.filter((item): item is T => item !== null);
  }

  async function save(entity: T): Promise<void> {
    const payload = serializeEntity<T, R>(entity, stripKeys, serializeTransforms);
    await putJson(`${folderPath}/${entity.id}.json`, payload);
    await updateManifest(entityKey, entity.id, 'add');
  }

  async function remove(id: string): Promise<void> {
    await deleteResource(`${folderPath}/${id}.json`);
    await updateManifest(entityKey, id, 'remove');
  }

  return { loadManifest, loadRaw, loadAll, save, remove };
}

// =============================================================================
// ENTITY REPOSITORIES
// =============================================================================

// --- Memory ---
const memoryRepo = createRepository<Memory, RawMemory>({
  entityKey: 'memories',
  defaults: { name: 'Untitled Memory' },
  hydrateTransforms: {
    interactionData: () => undefined as unknown as InteractionData, // Hydrated later
  },
  serializeTransforms: {
    interactionDataId: (m) => m.interactionData?.id ?? '',
  },
  stripKeys: ['id', 'interactionData'],
});

export const loadRawMemoryManifest = memoryRepo.loadManifest;
export const loadRawMemory = memoryRepo.loadRaw;
export const loadAllRawMemories = memoryRepo.loadAll;
export const saveRawMemory = memoryRepo.save;
export const deleteRawMemory = memoryRepo.remove;

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

// --- Stop Pattern ---
const stopPatternRepo = createRepository<StopPattern, RawStopPattern>({
  entityKey: 'stopPatterns',
  defaults: { name: 'Unknown Pattern' },
});

export const loadRawStopPatternManifest = stopPatternRepo.loadManifest;
export const loadRawStopPattern = stopPatternRepo.loadRaw;
export const loadAllRawStopPatterns = stopPatternRepo.loadAll;
export const saveRawStopPattern = stopPatternRepo.save;
export const deleteRawStopPattern = stopPatternRepo.remove;

// --- Sampler ---
// Samplers require async hydration for stop patterns, so we override loadRaw manually
const samplerRepoBase = createRepository<Sampler, RawSampler>({
  entityKey: 'samplers',
  defaults: { name: 'Unknown Sampler', parameters: {}, stopPatterns: [] },
  serializeTransforms: {
    stopPatternIds: (s) => s.stopPatterns.map(sp => sp.id),
  },
  stripKeys: ['id', 'stopPatterns'],
});

export const loadRawSamplerManifest = samplerRepoBase.loadManifest;
export const loadAllRawSamplers = samplerRepoBase.loadAll;
export const saveRawSampler = samplerRepoBase.save;
export const deleteRawSampler = samplerRepoBase.remove;

export async function loadRawSampler(id: string): Promise<Sampler | null> {
    const raw = await fetchJson<RawSampler>(`${PATHS.samplers}/${id}.json`);
    if (!raw) return null;
    
    // Hydrate stop patterns
    const stopPatternIds = raw.stopPatternIds || [];
    const stopPatternsResults = await Promise.all(stopPatternIds.map(sid => loadRawStopPattern(sid)));
    const stopPatterns = stopPatternsResults.filter((p): p is StopPattern => p !== null);

    return hydrateEntity<Sampler, RawSampler>(raw, id, samplerRepoBase.defaults, {
        stopPatterns: () => stopPatterns
    });
}

// --- Character ---
// Characters require async hydration for sampler and memories
const characterRepoBase = createRepository<Character, RawCharacter>({
  entityKey: 'characters',
  defaults: { 
      name: 'Unknown Character', 
      images: {}, 
      tools: { ...defaultCharacterTools },
      memories: {} 
  },
  serializeTransforms: {
    samplerId: (c) => c.sampler?.id,
    memories: (c) => serializeMemories(c.memories), // Returns Promise, handled in save override
  },
  stripKeys: ['id', 'sampler', 'memories'],
});

export const loadRawCharacterManifest = characterRepoBase.loadManifest;
export const loadAllRawCharacters = characterRepoBase.loadAll; // Note: This uses the simple hydrate, might need override if deep hydration needed for list
export const deleteRawCharacter = characterRepoBase.remove;

// Override Save to handle async memory serialization
export async function saveRawCharacter(character: Character): Promise<void> {
    const serializedMemories = await serializeMemories(character.memories);
    const payload = serializeEntity<Character, RawCharacter>(
        character, 
        ['id', 'sampler', 'memories'], 
        { 
            samplerId: (c) => c.sampler?.id,
            memories: () => serializedMemories 
        }
    );
    await putJson(`${PATHS.characters}/${character.id}.json`, payload);
    await updateManifest('characters', character.id, 'add');
}

export async function loadRawCharacter(id: string): Promise<Character | null> {
    const raw = await fetchJson<RawCharacter>(`${PATHS.characters}/${id}.json`);
    if (!raw) return null;

    // Async dependencies
    const sampler = raw.samplerId ? await loadRawSampler(raw.samplerId) : DefaultSampler;
    const memories = await hydrateMemories(raw.memories);
    
    // Legacy image migration
    const images: Record<string, string> = raw.images ?? {};
    const legacyImage = ('image' in raw && typeof raw.image === 'string') ? raw.image : undefined;
    if (Object.keys(images).length === 0 && legacyImage) {
      images.neutral = legacyImage;
    }

    return hydrateEntity<Character, RawCharacter>(raw, id, characterRepoBase.defaults, {
        sampler: () => sampler || DefaultSampler,
        memories: () => memories,
        images: () => images
    });
}

export async function loadCharacterShell(id: string): Promise<Character | null> {
    const raw = await fetchJson<RawCharacter>(`${PATHS.characters}/${id}.json`);
    if (!raw) return null;

    const memories = await hydrateMemories(raw.memories);
    const images: Record<string, string> = raw.images ?? {};
    if (Object.keys(images).length === 0 && 'image' in raw && typeof raw.image === 'string') {
      images.neutral = raw.image;
    }

    return hydrateEntity<Character, RawCharacter>(raw, id, { ...characterRepoBase.defaults, sampler: undefined }, {
        memories: () => memories,
        images: () => images
    });
}

export async function loadAllCharacterShells(): Promise<Character[]> {
    const ids = await loadRawCharacterManifest();
    const results = await loadInBatches(ids, loadCharacterShell);
    return results.filter((c): c is Character => c !== null);
}

// --- Context ---
const contextRepo = createRepository<Context, RawContext>({
  entityKey: 'contexts',
  defaults: { 
      name: 'Unknown Context', 
      searchTerms: [], 
      urls: [], 
      linkFetchMode: 'full' 
  },
});

export const loadRawContextManifest = contextRepo.loadManifest;
export const loadRawContext = contextRepo.loadRaw;
export const loadAllRawContexts = contextRepo.loadAll;
export const saveRawContext = contextRepo.save;
export const deleteRawContext = contextRepo.remove;

// --- Location ---
const locationRepo = createRepository<Location, RawLocation>({
  entityKey: 'locations',
  defaults: { 
      name: 'Unknown Location', 
      backgroundImageRegularExpressionActivationTriggers: {},
      backgroundImageWeights: {},
      playAudioTrackOnEnterWeights: {},
      locationBindings: [],
      locationBindingRegularExpressionTriggers: {},
      characterBindings: [],
      globalWeight: 1,
      characterWeights: {},
      ownerBindings: [],
      latitude: 0,
      longitude: 0,
      locationDistances: {},
      messageFilterNonCoLocatedParticipants: false,
      useBase64Encoding: false,
  },
});

export const loadRawLocationManifest = locationRepo.loadManifest;
export const loadRawLocation = locationRepo.loadRaw;
export const loadAllRawLocations = locationRepo.loadAll;
export const saveRawLocation = locationRepo.save;
export const deleteRawLocation = locationRepo.remove;

// --- Audio Track ---
const audioTrackRepo = createRepository<AudioTrack, RawAudioTrack>({
  entityKey: 'audioTracks',
  defaults: { 
      name: 'Untitled Track', 
      loop: false, 
      volume: 1, 
      audioCategory: 'ambient', 
      playableByParticipant: false, 
      startFadeDurationMs: 1000, 
      endFadeDurationMs: 1000,
      locationBindings: [],
      contextBindings: [],
      characterBindings: [],
      priority: 0,
  },
});

export const loadRawAudioTrackManifest = audioTrackRepo.loadManifest;
export const loadRawAudioTrack = audioTrackRepo.loadRaw;
export const loadAllRawAudioTracks = audioTrackRepo.loadAll;
export const saveRawAudioTrack = audioTrackRepo.save;
export const deleteRawAudioTrack = audioTrackRepo.remove;

// --- Prompt Block ---
const promptBlockRepo = createRepository<PromptBlock, RawPromptBlock>({
  entityKey: 'promptBlocks',
  defaults: { 
      name: 'Untitled Prompt Block', 
      textContent: '', 
      images: [],
      characterBindings: [],
      contextBindings: [],
      locationBindings: [],
  },
});

export const loadRawPromptBlockManifest = promptBlockRepo.loadManifest;
export const loadRawPromptBlock = promptBlockRepo.loadRaw;
export const loadAllRawPromptBlocks = promptBlockRepo.loadAll;
export const saveRawPromptBlock = promptBlockRepo.save;
export const deleteRawPromptBlock = promptBlockRepo.remove;

// --- Language Model ---
const modelRepo = createRepository<LanguageModel, RawLanguageModel>({
  entityKey: 'models',
  defaults: { name: 'Unknown Model' },
});

export const loadRawModelManifest = modelRepo.loadManifest;
export const loadRawModel = modelRepo.loadRaw;
export const loadAllRawModels = modelRepo.loadAll;
export const saveRawModel = modelRepo.save;
export const deleteRawModel = modelRepo.remove;

// --- Budget Strategy ---
// Requires async hydration for models
const budgetStrategyRepoBase = createRepository<BudgetStrategy, RawBudgetStrategy>({
  entityKey: 'budgetStrategies',
  defaults: { name: 'Unknown Strategy' },
  serializeTransforms: {
    onlineModelIds: (s) => s.onlineModels.map(m => m.id),
    localModelIds: (s) => s.localModels.map(m => m.id),
  },
  stripKeys: ['id', 'onlineModels', 'localModels'],
});

export const loadRawBudgetStrategyManifest = budgetStrategyRepoBase.loadManifest;
export const loadAllRawBudgetStrategies = budgetStrategyRepoBase.loadAll;
export const saveRawBudgetStrategy = budgetStrategyRepoBase.save;
export const deleteRawBudgetStrategy = budgetStrategyRepoBase.remove;

export async function loadRawBudgetStrategy(id: string): Promise<BudgetStrategy | null> {
    const raw = await fetchJson<RawBudgetStrategy>(`${PATHS.budgetStrategies}/${id}.json`);
    if (!raw) return null;

    const onlineModels = await Promise.all((raw.onlineModelIds || []).map(loadRawModel));
    const localModels = await Promise.all((raw.localModelIds || []).map(loadRawModel));

    return hydrateEntity<BudgetStrategy, RawBudgetStrategy>(raw, id, budgetStrategyRepoBase.defaults, {
        onlineModels: () => onlineModels.filter((m): m is LanguageModel => m !== null),
        localModels: () => localModels.filter((m): m is LanguageModel => m !== null),
    });
}

// --- Profile ---
const profileRepo = createRepository<Profile, RawProfile>({
  entityKey: 'profiles',
  defaults: { name: 'Unknown Profile' },
  hydrateTransforms: {
    summarizationSteps: (raw) => raw.summarizationSteps != null
      ? raw.summarizationSteps.map((step, i) => ({
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
          firstCreatedTimestamp: step.firstCreatedTimestamp || Date.now(),
          lastUpdatedTimestamp: step.lastUpdatedTimestamp || Date.now(),
      }))
      : getDefaultSummarizationSteps(),
    narrateTexts: (raw) => migrateNarrateTexts(raw),
    forceNameReveal: (raw) => raw.forceNameReveal ?? false,
    enableCharacterExpression: (raw) => raw.enableCharacterExpression ?? false,
    useCurrentDateAndTime: (raw) => raw.useCurrentDateAndTime ?? false,
    useTimeElapsed: (raw) => raw.useTimeElapsed ?? false,
    numberOfMessagesToDisableThinkPrompt: (raw) => raw.numberOfMessagesToDisableThinkPrompt ?? -1,
    numberOfMessagesToDisableMetaThinkInstructions: (raw) => raw.numberOfMessagesToDisableMetaThinkInstructions ?? -1,
    numberOfMessagesToDisableDialoguePrompt: (raw) => raw.numberOfMessagesToDisableDialoguePrompt ?? -1,
    numberOfMessagesToDisableStarterPrompt: (raw) => raw.numberOfMessagesToDisableStarterPrompt ?? -1,
    forceEqualInitiative: (raw) => raw.forceEqualInitiative ?? false,
    chatProbability: (raw) => raw.chatProbability ?? -1,
    maximumChatStamina: (raw) => raw.maximumChatStamina ?? -1,
    nameSensitivity: (raw) => raw.nameSensitivity ?? -1,
    chatImpatienceSensitivity: (raw) => raw.chatImpatienceSensitivity ?? -1,
    skipProbability: (raw) => raw.skipProbability ?? -1,
    memoryRetentionWeight: (raw) => raw.memoryRetentionWeight ?? -1,
    contextSensitivity: (raw) => raw.contextSensitivity ?? -1,
    maximumActionStamina: (raw) => raw.maximumActionStamina ?? -1,
    cacheInvalidationReductionLevel: (raw) => raw.cacheInvalidationReductionLevel ?? 0,
    doNotInjectDefaultStopTokens: (raw) => raw.doNotInjectDefaultStopTokens ?? false,
    stripThinkTokens: (raw) => raw.stripThinkTokens ?? false,
    tools: (raw) => raw.tools ?? {},
    enableMemoryWriting: (raw) => raw.enableMemoryWriting ?? 0,
    enableMemoryReading: (raw) => raw.enableMemoryReading ?? 0,
    inputStrategy: (raw) => raw.inputStrategy?.length ? raw.inputStrategy : [...defaultInputStrategy],
  },
  serializeTransforms: {
    summarizationSteps: (p) => p.summarizationSteps.map(({ ...rest }) => rest),
  },
  stripKeys: ['id', 'summarizationSteps'], // We re-add summarizationSteps via transform
});

// Override save to handle the strip/transform logic correctly for summarizationSteps
export async function saveRawProfile(profile: Profile): Promise<void> {
    const payload = serializeEntity<Profile, RawProfile>(
        profile, 
        ['id'], // Don't strip summarizationSteps here, let transform handle it
        { 
            summarizationSteps: (p) => p.summarizationSteps.map(({ ...rest }) => rest) 
        }
    );
    // Manually remove id if serializeEntity didn't (it should have based on stripKeys)
    delete (payload as any).id; 
    
    await putJson(`${PATHS.profiles}/${profile.id}.json`, payload);
    await updateManifest('profiles', profile.id, 'add');
}

export const loadRawProfileManifest = profileRepo.loadManifest;
export const loadRawProfile = profileRepo.loadRaw;
export const loadAllRawProfiles = profileRepo.loadAll;
export const deleteRawProfile = profileRepo.remove;

// --- Webpage ---
const webpageRepo = createRepository<Webpage, RawWebpage>({
  entityKey: 'webpages',
  defaults: { name: 'Untitled Webpage' },
});

export const loadRawWebpageManifest = webpageRepo.loadManifest;
export const loadRawWebpage = webpageRepo.loadRaw;
export const loadAllRawWebpages = webpageRepo.loadAll;
export const saveRawWebpage = webpageRepo.save;
export const deleteRawWebpage = webpageRepo.remove;

export async function findWebpageByUrl(url: string): Promise<Webpage | null> {
    const all = await loadAllRawWebpages();
    return all.find(w => w.url === url) || null;
}

// --- World ---
const worldRepo = createRepository<World, World>({
  entityKey: 'worlds',
  // World is same in Raw and Hydrated
});

export const loadRawWorldManifest = worldRepo.loadManifest;
export const loadRawWorld = worldRepo.loadRaw;
export const loadAllRawWorlds = worldRepo.loadAll;
export const saveRawWorld = worldRepo.save;
export const deleteRawWorld = worldRepo.remove;

// =============================================================================
// CHAT DATA & MESSAGES (Complex Logic)
// =============================================================================

export async function deleteRawInteractionMessage(id: string): Promise<void> { 
    await deleteResource(`${PATHS.interactionMessages}/${id}.json`); 
}

export async function loadRawChatManifest(): Promise<string[]> { 
    return await ensureManifest('interactionData'); 
}

function createDeletedCharacterStub(id: string, now: number): Character {
    return {
        id,
        name: '[Deleted Character]',
        description: 'This character has been deleted.',
        images: {},
        initiativeWeight: 1,
        chatProbability: 0.5,
        maximumChatStamina: 4,
        nameSensitivity: 1,
        chatImpatienceSensitivity: 0,
        skipProbability: 0,
        memoryRetentionWeight: 1,
        contextSensitivity: 1,
        maximumActionStamina: 5,
        numberOfMessagesToDisableThinkPrompt: 1,
        numberOfMessagesToDisableMetaThinkInstructions: 1,
        numberOfMessagesToDisableDialoguePrompt: 1,
        numberOfMessagesToDisableStarterPrompt: 1,
        tools: { ...defaultCharacterTools },
        enableMemoryWriting: false,
        enableMemoryReading: false,
        memories: {},
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
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
    protagonist = createDeletedCharacterStub(rawInteractionData.protagonistId, now);
  }

  const participants = rawInteractionData.participantIds
    .map(pid => charMap.get(pid) ?? createDeletedCharacterStub(pid, now));
    
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
                initiativeWeight: 1,
                chatProbability: 0.5,
                maximumChatStamina: 4,
                nameSensitivity: 1,
                chatImpatienceSensitivity: 0,
                skipProbability: 0,
                memoryRetentionWeight: 1,
                contextSensitivity: 1,
                maximumActionStamina: 5,
                numberOfMessagesToDisableThinkPrompt: 1,
                numberOfMessagesToDisableMetaThinkInstructions: 1,
                numberOfMessagesToDisableDialoguePrompt: 1,
                numberOfMessagesToDisableStarterPrompt: 1,
                tools: {} as Record<tool, boolean>,
                enableMemoryWriting: false,
                enableMemoryReading: false,
                memories: {},
                firstCreatedTimestamp: Date.now(),
                lastUpdatedTimestamp: Date.now()
            } as Character
        };
    });

    const interactionHistory = (await Promise.all(messagePromises)).filter((m): m is InteractionMessage => m !== null);

    return { ...interactionData, interactionHistory, numberOfMessages: interactionHistory.length };
}

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
        try { return await loadRawContext(cid); } catch { return null; }
      })
    );
    for (const c of ctxResults) { if (c) contextMap.set(c.id, c); }
  }

  const locationMap = new Map<string, Location>();
  if (rawInteractionData.locationIds?.length) {
    const locResults = await Promise.all(
      rawInteractionData.locationIds.map(async (lid) => {
        try { return await loadRawLocation(lid); } catch { return null; }
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
        try { return await loadRawAudioTrack(tid); } catch { return null; }
      })
    );
    for (const t of trackResults) { if (t) audioTrackMap.set(t.id, t); }
  }

  const shell = await buildInteractionDataShell(id, rawInteractionData, charMap, contextMap, locationMap, profileMap, audioTrackMap);
  if (!shell) return null;

  return loadInteractionMessages(shell);
}

export async function loadAllRawInteractionDataShells(): Promise<RawInteractionData[]> {
  const ids = await loadRawChatManifest();
  if (ids.length === 0) return [];

  const results: (RawInteractionData | null)[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const batchPromises = batchIds.map(async (id): Promise<RawInteractionData | null> => {
      const raw = await fetchJson<RawInteractionData>(`${PATHS.interactionData}/${id}.json`);
      if (!raw) return null;
      raw.id = id;
      return raw;
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    if (i + BATCH_SIZE < ids.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS / 2));
    }
  }

  return results.filter((r): r is RawInteractionData => r !== null);
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
  
  for (let i = 0; i < saveMessagePromises.length; i += BATCH_SIZE) {
    await Promise.all(saveMessagePromises.slice(i, i + BATCH_SIZE));
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
  await updateManifest('interactionData', id, 'add');
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
  await updateManifest('interactionData', newChatId, 'add');
  return newChatId;
}

export async function deleteRawInteractionData(id: string): Promise<void> {
  try { await deleteResource(`${PATHS.kvCaches}/${id}`); } catch (e) { console.warn("KV cache cleanup failed", e); }
  await deleteResource(`${PATHS.interactionData}/${id}.json`);
  await updateManifest('interactionData', id, 'remove');
}

// =============================================================================
// SINGLETONS (Actions, Budget Data)
// =============================================================================

export async function loadInterjectableActions(): Promise<InterjectableAction[]> {
  const actions = await fetchJson<InterjectableAction[]>(ACTIONS_PATH);
  return actions && actions.length > 0 ? actions : DefaultActions;
}

export async function saveInterjectableActions(actions: InterjectableAction[]): Promise<void> {
  await putJson(ACTIONS_PATH, actions);
}

export async function loadRawBudgetData(): Promise<BudgetData | null> {
    const raw = await fetchJson<RawBudgetData>(BUDGET_DATA_PATH);
    if (!raw) return null;

    try {
        const strategy = raw.budgetStrategyId ? await loadRawBudgetStrategy(raw.budgetStrategyId) : null;
        if (!strategy) return null;
        return hydrateEntity<BudgetData, RawBudgetData>(raw as unk, raw.id || 'global-budget-data', {
            name: 'Global Budget Data',
            description: 'Persistent runtime budget tracking',
            budgetSpent: 0,
            modelLastUsedTimestamps: {},
            modelLastQuotaHitTimeStamps: {},
            modelLastErrorHitTimeStamps: {},
            modelUsedCount: {},
            modelCensorshipHitCount: {},
            modelBrokenCount: {},
            modelQuotaHitCount: {},
            modelErrorHitCount: {},
            modelBudgetSpent: {},
            modelAverageLatencyMsPerToken: {},
            modelAverageTimeToFirstToken: {},
            modelTotalSessionDuration: {},
        }, {
            budgetStrategy: () => strategy,
            budgetSpent: (r) => r.budgetSpent ?? 0,
            modelLastUsedTimestamps: (r) => r.modelLastUsedTimestamps ?? {},
            modelLastQuotaHitTimeStamps: (r) => r.modelLastQuotaHitTimeStamps ?? {},
            modelLastErrorHitTimeStamps: (r) => r.modelLastErrorHitTimeStamps ?? {},
            modelUsedCount: (r) => r.modelUsedCount ?? {},
            modelCensorshipHitCount: (r) => r.modelCensorshipHitCount ?? {},
            modelBrokenCount: (r) => r.modelBrokenCount ?? {},
            modelQuotaHitCount: (r) => r.modelQuotaHitCount ?? {},
            modelErrorHitCount: (r) => r.modelErrorHitCount ?? {},
            modelBudgetSpent: (r) => r.modelBudgetSpent ?? {}, // Wait, raw has this? Yes.
            modelAverageLatencyMsPerToken: (r) => r.modelAverageLatencyMsPerToken ?? {},
            modelAverageTimeToFirstToken: (r) => r.modelAverageTimeToFirstToken ?? {},
            modelTotalSessionDuration: (r) => r.modelTotalSessionDuration ?? {},
        });
    } catch (e) {
        console.warn('Failed to load budget data:', e);
        return null;
    }
}

export async function saveRawBudgetData(data: BudgetData): Promise<void> {
    const payload = serializeEntity<BudgetData, RawBudgetData>(data, ['id', 'budgetStrategy'], {
        budgetStrategyId: (d) => d.budgetStrategy.id,
    });
    // Ensure ID is present for singleton if needed, or handled by putJson path
    // Actually RawBudgetData has optional id.
    await putJson(BUDGET_DATA_PATH, payload);
}

// =============================================================================
// IMAGE & VOICE HELPERS
// =============================================================================

function getImageUrl(entityKey: EntityKey, ...pathParts: string[]): string | null {
  const basePath = PATHS[entityKey];
  const cleanPath = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return `${localURL}${cleanPath}/${pathParts.join('/')}`;
}

async function uploadImage(entityKey: EntityKey, file: File, ...pathParts: string[]): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = getCleanFileName(file);
  const imagePath = `${PATHS[entityKey]}/${[...pathParts, filename].join('/')}`;
  await putJson(imagePath, { base64 });
  return filename;
}

export function getCharacterImageUrl(characterId: string, characterExpression?: string): string | null {
    return getImageUrl('characterImages', characterId, characterExpression || 'neutral');
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
    return uploadImage('characterImages', file, characterId);
}

export function getCharacterVoiceUrl(voiceFileName: string | undefined): string | null {
  if (!voiceFileName) return null;
  return getImageUrl('characterVoices', voiceFileName);
}

export async function uploadCharacterVoice(file: File): Promise<string> {
  return uploadImage('characterVoices', file);
}

export function getContextImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  return getImageUrl('contexts', imageFilename);
}

export async function uploadContextImage(file: File): Promise<string> {
  return uploadImage('contexts', file);
}

export function getLocationImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  return getImageUrl('locations', imageFilename);
}

export async function uploadLocationImage(file: File): Promise<string> {
  return uploadImage('locations', file);
}

export function getAudioTrackUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  return getImageUrl('audioTracks', imageFilename);
}

export async function uploadAudioTrack(file: File): Promise<string> {
    return uploadImage('audioTracks', file);
}

export function getPromptBlockImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  return getImageUrl('promptBlocks', imageFilename);
}

export async function uploadPromptBlockImage(file: File): Promise<string> {
  return uploadImage('promptBlocks', file);
}