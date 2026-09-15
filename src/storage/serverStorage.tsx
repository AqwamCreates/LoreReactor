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
 * Entity Registry - Single source of truth for all entity metadata.
 * Keys are used as both TypeScript identifiers and directory names.
 */
const ENTITY_REGISTRY = {
  characters: { dir: 'character_data', hasManifest: true },
  characterImages: { dir: 'character_images', hasManifest: false },
  characterVoices: { dir: 'character_voices', hasManifest: false },
  samplers: { dir: 'sampler_data', hasManifest: true },
  contexts: { dir: 'context_data', hasManifest: true },
  locations: { dir: 'location_data', hasManifest: true },
  models: { dir: 'model_data', hasManifest: true },
  stopPatterns: { dir: 'stop_pattern_data', hasManifest: true },
  interactionMessages: { dir: 'interaction_messages', hasManifest: false },
  interactionData: { dir: 'interaction_data', hasManifest: true },
  kvCaches: { dir: 'kv_caches', hasManifest: false },
  budgetStrategies: { dir: 'budget_strategies', hasManifest: true },
  profiles: { dir: 'profile_data', hasManifest: true },
  worlds: { dir: 'world_data', hasManifest: true },
  webpages: { dir: 'webpage_data', hasManifest: true },
  memories: { dir: 'memory_data', hasManifest: true },
  audioTracks: { dir: 'audio_track_data', hasManifest: true },
  promptBlocks: { dir: 'prompt_block_data', hasManifest: true },
} as const;

type EntityKey = keyof typeof ENTITY_REGISTRY;

// Derive PATHS from registry for backward compatibility
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
// MANIFEST MANAGEMENT (SELF-HEALING)
// =============================================================================

async function ensureManifest(entityKey: EntityKey): Promise<string[]> {
  const folderPath = PATHS[entityKey];
  const manifestUrl = `${folderPath}/${MANIFEST_FILE}`;
  
  const currentIds = await fetchJson<string[]>(manifestUrl);
  
  if (currentIds && Array.isArray(currentIds)) {
    // SELF-HEALING: Verify that files for these IDs actually exist
    // This prevents 404 spam when loading lists if files were deleted manually
    const validIds: string[] = [];
    let hasChanges = false;

    // Check in batches to avoid overwhelming the server
    for (let i = 0; i < currentIds.length; i += BATCH_SIZE) {
        const batch = currentIds.slice(i, i + BATCH_SIZE);
        // We use fetchJson to check existence. If it returns null, the file is gone.
        // Note: fetchJson returns null for 404s.
        const checks = await Promise.all(batch.map(id => fetchJson(`${folderPath}/${id}.json`)));
        
        batch.forEach((id, index) => {
            if (checks[index] !== null) {
                validIds.push(id);
            } else {
                console.warn(`[Manifest Repair] Removing missing ID ${id} from ${entityKey} manifest`);
                hasChanges = true;
            }
        });
    }

    if (hasChanges) {
        console.log(`[Manifest Repair] Updating ${entityKey} manifest: ${currentIds.length} -> ${validIds.length} items`);
        await putJson(manifestUrl, validIds);
    }

    return validIds;
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
// GENERIC HYDRATION UTILITY
// =============================================================================

/**
 * Hydrates a raw entity into its full type using a key mapping.
 * This reduces boilerplate by automatically copying fields that share the same name
 * and applying defaults for missing fields.
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
            if (fn) (base as any)[key] = fn(raw, id);
        }
    }

    return base;
}

// =============================================================================
// GENERIC REPOSITORY FACTORY
// =============================================================================

interface RepositoryConfig<T, R> {
  entityKey: EntityKey;
  hydrate: (raw: R, id: string) => T | Promise<T>;
  serialize?: (entity: T) => R | Promise<R>;
  postLoad?: (entity: T) => T | Promise<T>;
  preSave?: (entity: T) => T | Promise<T>;
}

function createRepository<T extends { id: string }, R>(config: RepositoryConfig<T, R>) {
  const { entityKey, hydrate, serialize, postLoad, preSave } = config;
  const folderPath = PATHS[entityKey];

  async function loadManifest(): Promise<string[]> {
    return await ensureManifest(entityKey);
  }

  async function loadRaw(id: string): Promise<T | null> {
    try {
      const raw = await fetchJson<R>(`${folderPath}/${id}.json`);
      if (!raw) return null;
      
      let entity = await hydrate(raw, id);
      if (postLoad) entity = await postLoad(entity);
      return entity;
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
    let processed = entity;
    if (preSave) processed = await preSave(processed);
    
    const { id, ...rest } = processed as any;
    const payload = serialize 
      ? await serialize(processed)
      : { ...rest, lastUpdatedTimestamp: Date.now() };
    
    await putJson(`${folderPath}/${id}.json`, payload);
    await updateManifest(entityKey, id, 'add');
  }

  async function remove(id: string): Promise<void> {
    await deleteResource(`${folderPath}/${id}.json`);
    await updateManifest(entityKey, id, 'remove');
  }

  return { loadManifest, loadRaw, loadAll, save, remove };
}

// =============================================================================
// MEMORY REPOSITORY
// =============================================================================

const memoryRepo = createRepository<Memory, RawMemory>({
  entityKey: 'memories',
  hydrate: (raw, id) => {
    return hydrateEntity<Memory, RawMemory>(raw, id, {
        name: 'Untitled Memory',
        interactionData: undefined as unknown as InteractionData,
    }, {
        interactionData: () => undefined as unknown as InteractionData, // Hydrated later
    });
  },
  serialize: (memory) => {
    const { interactionData, ...rest } = memory;
    return {
      ...rest,
      interactionDataId: interactionData?.id ?? '',
      lastUpdatedTimestamp: Date.now(),
    } as RawMemory;
  },
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

// =============================================================================
// STOP PATTERN REPOSITORY
// =============================================================================

const stopPatternRepo = createRepository<StopPattern, RawStopPattern>({
  entityKey: 'stopPatterns',
  hydrate: (raw, id) => hydrateEntity<StopPattern, RawStopPattern>(raw, id, {
    name: 'Unknown Pattern',
  }),
});

export const loadRawStopPatternManifest = stopPatternRepo.loadManifest;
export const loadRawStopPattern = stopPatternRepo.loadRaw;
export const loadAllRawStopPatterns = stopPatternRepo.loadAll;
export const saveRawStopPattern = stopPatternRepo.save;
export const deleteRawStopPattern = stopPatternRepo.remove;

// =============================================================================
// SAMPLER REPOSITORY
// =============================================================================

const samplerRepo = createRepository<Sampler, RawSampler>({
  entityKey: 'samplers',
  hydrate: async (raw, id) => {
    const stopPatternIds = raw.stopPatternIds || [];
    const stopPatternsResults = await Promise.all(stopPatternIds.map(sid => loadRawStopPattern(sid)));
    const stopPatterns = stopPatternsResults.filter((p): p is StopPattern => p !== null);

    return hydrateEntity<Sampler, RawSampler>(raw, id, {
        name: 'Unknown Sampler',
        parameters: {},
        stopPatterns: [],
    }, {
        stopPatterns: () => stopPatterns
    });
  },
  serialize: (sampler) => {
    const { id, stopPatterns, ...rest } = sampler;
    return {
      ...rest,
      stopPatternIds: stopPatterns.map(sp => sp.id),
      lastUpdatedTimestamp: Date.now(),
    } as RawSampler;
  },
});

export const loadRawSamplerManifest = samplerRepo.loadManifest;
export const loadRawSampler = samplerRepo.loadRaw;
export const loadAllRawSamplers = samplerRepo.loadAll;
export const saveRawSampler = samplerRepo.save;
export const deleteRawSampler = samplerRepo.remove;

// =============================================================================
// CHARACTER REPOSITORY
// =============================================================================

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

const characterRepo = createRepository<Character, RawCharacter>({
  entityKey: 'characters',
  hydrate: async (raw, id) => {
    const samplerId = raw.samplerId;
    let sampler: Sampler = DefaultSampler;
    
    if (samplerId) {
      const loadedSampler = await loadRawSampler(samplerId);
      if (loadedSampler) sampler = loadedSampler;
    }

    const memories = await hydrateMemories(raw.memories);

    const images: Record<string, string> = raw.images ?? {};
    const legacyImage = ('image' in raw && typeof raw.image === 'string') ? raw.image : undefined;
    if (Object.keys(images).length === 0 && legacyImage) {
      images.neutral = legacyImage;
    }

    return hydrateEntity<Character, RawCharacter>(raw, id, {
        name: 'Unknown Character',
        images: {},
        tools: { ...defaultCharacterTools },
        memories: {},
    }, {
        sampler: () => sampler,
        memories: () => memories,
        images: () => images,
    });
  },
  serialize: async (character) => {
    const { id, sampler, memories, ...rest } = character;
    const serializedMemories = await serializeMemories(memories);
    return {
      ...rest,
      samplerId: sampler?.id,
      memories: serializedMemories,
      lastUpdatedTimestamp: Date.now(),
    } as RawCharacter;
  },
});

export const loadRawCharacterManifest = characterRepo.loadManifest;
export const loadRawCharacter = characterRepo.loadRaw;
export const loadAllRawCharacters = characterRepo.loadAll;
export const saveRawCharacter = characterRepo.save;
export const deleteRawCharacter = characterRepo.remove;

export async function loadCharacterShell(id: string): Promise<Character | null> {
    const rawCharacter = await fetchJson<RawCharacter>(`${PATHS.characters}/${id}.json`);
    if (!rawCharacter) return null;

    const memories = await hydrateMemories(rawCharacter.memories);

    const images: Record<string, string> = rawCharacter.images ?? {};
    if (Object.keys(images).length === 0 && 'image' in rawCharacter && typeof rawCharacter.image === 'string') {
      images.neutral = rawCharacter.image;
    }

    return hydrateEntity<Character, RawCharacter>(rawCharacter, id, {
        name: 'Unknown Character',
        images: {},
        tools: { ...defaultCharacterTools },
        memories: {},
        sampler: undefined,
    }, {
        memories: () => memories,
        images: () => images,
    });
}

export async function loadAllCharacterShells(): Promise<Character[]> {
    const ids = await loadRawCharacterManifest();
    const results = await loadInBatches(ids, loadCharacterShell);
    return results.filter((c): c is Character => c !== null);
}

// =============================================================================
// CONTEXT REPOSITORY
// =============================================================================

const contextRepo = createRepository<Context, RawContext>({
  entityKey: 'contexts',
  hydrate: (raw, id) => hydrateEntity<Context, RawContext>(raw, id, {
    name: 'Unknown Context',
    searchTerms: [],
    urls: [],
    linkFetchMode: 'full',
    limitLinksToSubdirectory: false,
    useBase64Encoding: false,
    isAutoGenerated: false,
  }),
});

export const loadRawContextManifest = contextRepo.loadManifest;
export const loadRawContext = contextRepo.loadRaw;
export const loadAllRawContexts = contextRepo.loadAll;
export const saveRawContext = contextRepo.save;
export const deleteRawContext = contextRepo.remove;

// =============================================================================
// LOCATION REPOSITORY
// =============================================================================

const locationRepo = createRepository<Location, RawLocation>({
  entityKey: 'locations',
  hydrate: (raw, id) => hydrateEntity<Location, RawLocation>(raw, id, {
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
  }),
});

export const loadRawLocationManifest = locationRepo.loadManifest;
export const loadRawLocation = locationRepo.loadRaw;
export const loadAllRawLocations = locationRepo.loadAll;
export const saveRawLocation = locationRepo.save;
export const deleteRawLocation = locationRepo.remove;

// =============================================================================
// AUDIO TRACK REPOSITORY
// =============================================================================

const audioTrackRepo = createRepository<AudioTrack, RawAudioTrack>({
  entityKey: 'audioTracks',
  hydrate: (raw, id) => hydrateEntity<AudioTrack, RawAudioTrack>(raw, id, {
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
  }),
});

export const loadRawAudioTrackManifest = audioTrackRepo.loadManifest;
export const loadRawAudioTrack = audioTrackRepo.loadRaw;
export const loadAllRawAudioTracks = audioTrackRepo.loadAll;
export const saveRawAudioTrack = audioTrackRepo.save;
export const deleteRawAudioTrack = audioTrackRepo.remove;

// =============================================================================
// PROMPT BLOCK REPOSITORY
// =============================================================================

const promptBlockRepo = createRepository<PromptBlock, RawPromptBlock>({
  entityKey: 'promptBlocks',
  hydrate: (raw, id) => hydrateEntity<PromptBlock, RawPromptBlock>(raw, id, {
    name: 'Untitled Prompt Block',
    textContent: '',
    images: [],
    characterBindings: [],
    contextBindings: [],
    locationBindings: [],
  }),
});

export const loadRawPromptBlockManifest = promptBlockRepo.loadManifest;
export const loadRawPromptBlock = promptBlockRepo.loadRaw;
export const loadAllRawPromptBlocks = promptBlockRepo.loadAll;
export const saveRawPromptBlock = promptBlockRepo.save;
export const deleteRawPromptBlock = promptBlockRepo.remove;

// =============================================================================
// LANGUAGE MODEL REPOSITORY
// =============================================================================

const modelRepo = createRepository<LanguageModel, RawLanguageModel>({
  entityKey: 'models',
  hydrate: (raw, id) => hydrateEntity<LanguageModel, RawLanguageModel>(raw, id, {
    name: 'Unknown Model',
  }),
});

export const loadRawModelManifest = modelRepo.loadManifest;
export const loadRawModel = modelRepo.loadRaw;
export const loadAllRawModels = modelRepo.loadAll;
export const saveRawModel = modelRepo.save;
export const deleteRawModel = modelRepo.remove;

// =============================================================================
// BUDGET STRATEGY REPOSITORY
// =============================================================================

const budgetStrategyRepo = createRepository<BudgetStrategy, RawBudgetStrategy>({
  entityKey: 'budgetStrategies',
  hydrate: async (raw, id) => {
    const onlineModelPromises = (raw.onlineModelIds || []).map(mid => loadRawModel(mid));
    const onlineModelsResults = await Promise.all(onlineModelPromises);
    const onlineModels = onlineModelsResults.filter((m): m is LanguageModel => m !== null);

    const localModelPromises = (raw.localModelIds || []).map(mid => loadRawModel(mid));
    const localModelsResults = await Promise.all(localModelPromises);
    const localModels = localModelsResults.filter((m): m is LanguageModel => m !== null);

    return hydrateEntity<BudgetStrategy, RawBudgetStrategy>(raw, id, {
        name: 'Unknown Strategy',
    }, {
        onlineModels: () => onlineModels,
        localModels: () => localModels,
    });
  },
  serialize: (strategy) => {
    const { id, onlineModels, localModels, ...rest } = strategy;
    return {
      ...rest,
      onlineModelIds: onlineModels.map(m => m.id),
      localModelIds: localModels.map(m => m.id),
      lastUpdatedTimestamp: Date.now(),
    } as RawBudgetStrategy;
  },
});

export const loadRawBudgetStrategyManifest = budgetStrategyRepo.loadManifest;
export const loadRawBudgetStrategy = budgetStrategyRepo.loadRaw;
export const loadAllRawBudgetStrategies = budgetStrategyRepo.loadAll;
export const saveRawBudgetStrategy = budgetStrategyRepo.save;
export const deleteRawBudgetStrategy = budgetStrategyRepo.remove;

// =============================================================================
// PROFILE REPOSITORY
// =============================================================================

const profileRepo = createRepository<Profile, RawProfile>({
  entityKey: 'profiles',
  hydrate: (raw, id) => {
    const now = Date.now();

    const summarizationSteps: SummarizationStep[] = raw.summarizationSteps != null
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
          firstCreatedTimestamp: step.firstCreatedTimestamp || now,
          lastUpdatedTimestamp: step.lastUpdatedTimestamp || now,
      }))
      : getDefaultSummarizationSteps();

    const narrateTexts = migrateNarrateTexts(raw);

    return hydrateEntity<Profile, RawProfile>(raw, id, {
        name: 'Unknown Profile',
        forceNameReveal: false,
        enableCharacterExpression: false,
        useCurrentDateAndTime: false,
        useTimeElapsed: false,
        numberOfMessagesToDisableThinkPrompt: -1,
        numberOfMessagesToDisableMetaThinkInstructions: -1,
        numberOfMessagesToDisableDialoguePrompt: -1,
        numberOfMessagesToDisableStarterPrompt: -1,
        forceEqualInitiative: false,
        chatProbability: -1,
        maximumChatStamina: -1,
        nameSensitivity: -1,
        chatImpatienceSensitivity: -1,
        skipProbability: -1,
        memoryRetentionWeight: -1,
        contextSensitivity: -1,
        maximumActionStamina: -1,
        cacheInvalidationReductionLevel: 0,
        doNotInjectDefaultStopTokens: false,
        stripThinkTokens: false,
        tools: {} as Record<tool, number>,
        enableMemoryWriting: 0,
        enableMemoryReading: 0,
        inputStrategy: [...defaultInputStrategy],
    }, {
        summarizationSteps: () => summarizationSteps,
        narrateTexts: () => narrateTexts,
    });
  },
  serialize: (profile) => {
    const { id, summarizationSteps, ...rest } = profile;
    const rawSteps: RawSummarizationStep[] = summarizationSteps.map(({ ...stepRest }) => stepRest);
    return {
      ...rest,
      summarizationSteps: rawSteps,
      lastUpdatedTimestamp: Date.now(),
    } as RawProfile;
  },
});

export const loadRawProfileManifest = profileRepo.loadManifest;
export const loadRawProfile = profileRepo.loadRaw;
export const loadAllRawProfiles = profileRepo.loadAll;
export const saveRawProfile = profileRepo.save;
export const deleteRawProfile = profileRepo.remove;

// =============================================================================
// WEBPAGE REPOSITORY
// =============================================================================

const webpageRepo = createRepository<Webpage, RawWebpage>({
  entityKey: 'webpages',
  hydrate: (raw, id) => hydrateEntity<Webpage, RawWebpage>(raw, id, {
    name: 'Untitled Webpage',
  }),
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

// =============================================================================
// WORLD REPOSITORY
// =============================================================================

const worldRepo = createRepository<World, World>({
  entityKey: 'worlds',
  hydrate: (raw) => raw, // World is already in final form
  serialize: (world) => world,
});

export const loadRawWorldManifest = worldRepo.loadManifest;
export const loadRawWorld = worldRepo.loadRaw;
export const loadAllRawWorlds = worldRepo.loadAll;
export const saveRawWorld = worldRepo.save;
export const deleteRawWorld = worldRepo.remove;

// =============================================================================
// CHAT MESSAGE REPOSITORY (Special - no manifest)
// =============================================================================

export async function deleteRawInteractionMessage(id: string): Promise<void> { 
    await deleteResource(`${PATHS.interactionMessages}/${id}.json`); 
}

// =============================================================================
// CHAT DATA REPOSITORY (Complex hydration)
// =============================================================================

export async function loadRawChatManifest(): Promise<string[]> { 
    return await ensureManifest('interactionData'); 
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
// SINGLETON REPOSITORIES (Actions, Budget Data)
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

        return hydrateEntity<BudgetData, RawBudgetData>(raw as any, raw.id || 'global-budget-data', {
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
            modelBudgetSpent: (r) => r.modelBudgetSpent ?? {},
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
    await putJson(BUDGET_DATA_PATH, payload);
}

// =============================================================================
// IMAGE & VOICE HELPERS (Generic utilities)
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