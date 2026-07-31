
// src/repositories/DataRepository.ts

import type { 
  StopPattern, 
  Sampler, 
  Instruction, 
  Character, 
  ChatMessage, 
  ChatData 
} from './types';

// --- Configuration ---
const BASE_URL = import.meta.env.BASE_URL;
const USER_DATA_PATH = `${BASE_URL}user_data`;

const PATHS = {
  characters: `${USER_DATA_PATH}/character_data`,
  characterImages: `${USER_DATA_PATH}/character_images`,
  samplers: `${USER_DATA_PATH}/sampler_data`,
  instructions: `${USER_DATA_PATH}/instruction_data`,
  stopPatterns: `${USER_DATA_PATH}/stop_patterns_data`,
  // Assuming individual messages might be stored separately if you go full normalized, 
  // but usually ChatData contains the history. Keeping this for potential future use or large blobs.
  chatMessages: `${USER_DATA_PATH}/chat_messages`, 
  chatData: `${USER_DATA_PATH}/chat_data`,
  kvCaches: `${USER_DATA_PATH}/kv_caches`,
};

const MANIFEST_FILE = 'manifest.json';

// --- Generic Helpers ---

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) return null;
      console.warn(`Fetch failed for ${url}: ${response.statusText}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Network error fetching ${url}:`, error);
    return null;
  }
}

async function putJson<T>(url: string, data: T): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to save data to ${url}: HTTP ${response.status}`);
  }
}

async function deleteResource(url: string): Promise<void> {
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete resource at ${url}: HTTP ${response.status}`);
  }
}

// Helper to update manifests (add/remove IDs)
async function updateManifest(folderPath: string, id: string, action: 'add' | 'remove'): Promise<void> {
  const manifestUrl = `${folderPath}/${MANIFEST_FILE}`;
  const currentIds = await fetchJson<string[]>(manifestUrl) || [];
  
  let newIds: string[];
  if (action === 'add') {
    if (currentIds.includes(id)) return; // Already exists
    newIds = [...currentIds, id];
  } else {
    newIds = currentIds.filter(existingId => existingId !== id);
  }

  await putJson(manifestUrl, newIds);
}

// --- Character Repository ---

export async function loadCharacterManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.characters}/${MANIFEST_FILE}`) || [];
}

export async function loadCharacter(id: string): Promise<Character | null> {
  return await fetchJson<Character>(`${PATHS.characters}/${id}.json`);
}

export async function loadAllCharacters(): Promise<Character[]> {
  const ids = await loadCharacterManifest();
  const results = await Promise.all(ids.map(id => loadCharacter(id)));
  return results.filter((c): c is Character => c !== null);
}

export async function saveCharacter(character: Character): Promise<void> {
  await putJson(`${PATHS.characters}/${character.id}.json`, character);
  await updateManifest(PATHS.characters, character.id, 'add');
}

export async function deleteCharacter(id: string): Promise<void> {
  await deleteResource(`${PATHS.characters}/${id}.json`);
  await updateManifest(PATHS.characters, id, 'remove');
  // Note: You may also want to delete associated images or KV caches here
}

// --- Sampler Repository ---

export async function loadSamplerManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.samplers}/${MANIFEST_FILE}`) || [];
}

export async function loadSampler(id: string): Promise<Sampler | null> {
  return await fetchJson<Sampler>(`${PATHS.samplers}/${id}.json`);
}

export async function loadAllSamplers(): Promise<Sampler[]> {
  const ids = await loadSamplerManifest();
  const results = await Promise.all(ids.map(id => loadSampler(id)));
  return results.filter((s): s is Sampler => s !== null);
}

export async function saveSampler(sampler: Sampler): Promise<void> {
  await putJson(`${PATHS.samplers}/${sampler.id}.json`, sampler);
  await updateManifest(PATHS.samplers, sampler.id, 'add');
}

export async function deleteSampler(id: string): Promise<void> {
  await deleteResource(`${PATHS.samplers}/${id}.json`);
  await updateManifest(PATHS.samplers, id, 'remove');
}

// --- Instruction Repository ---

export async function loadInstructionManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.instructions}/${MANIFEST_FILE}`) || [];
}

export async function loadInstruction(id: string): Promise<Instruction | null> {
  return await fetchJson<Instruction>(`${PATHS.instructions}/${id}.json`);
}

export async function loadAllInstructions(): Promise<Instruction[]> {
  const ids = await loadInstructionManifest();
  const results = await Promise.all(ids.map(id => loadInstruction(id)));
  return results.filter((i): i is Instruction => i !== null);
}

export async function saveInstruction(instruction: Instruction): Promise<void> {
  await putJson(`${PATHS.instructions}/${instruction.id}.json`, instruction);
  await updateManifest(PATHS.instructions, instruction.id, 'add');
}

export async function deleteInstruction(id: string): Promise<void> {
  await deleteResource(`${PATHS.instructions}/${id}.json`);
  await updateManifest(PATHS.instructions, id, 'remove');
}

// --- Stop Pattern Repository ---

export async function loadStopPatternManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.stopPatterns}/${MANIFEST_FILE}`) || [];
}

export async function loadStopPattern(id: string): Promise<StopPattern | null> {
  return await fetchJson<StopPattern>(`${PATHS.stopPatterns}/${id}.json`);
}

export async function saveStopPattern(pattern: StopPattern): Promise<void> {
  await putJson(`${PATHS.stopPatterns}/${pattern.id}.json`, pattern);
  await updateManifest(PATHS.stopPatterns, pattern.id, 'add');
}

export async function deleteStopPattern(id: string): Promise<void> {
  await deleteResource(`${PATHS.stopPatterns}/${id}.json`);
  await updateManifest(PATHS.stopPatterns, id, 'remove');
}

// --- Chat Data Repository ---
// Note: In your normalized model, ChatData holds the message HISTORY (objects) 
// but references Characters/Instructions by ID.

export async function loadChatManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.chatData}/${MANIFEST_FILE}`) || [];
}

export async function loadChatData(id: string): Promise<ChatData | null> {
  return await fetchJson<ChatData>(`${PATHS.chatData}/${id}.json`);
}

export async function loadAllChatData(): Promise<(ChatData | null)[]> {
  const ids = await loadChatManifest();
  return await Promise.all(ids.map(id => loadChatData(id)));
}

export async function saveChatData(chatData: ChatData): Promise<void> {
  await putJson(`${PATHS.chatData}/${chatData.id}.json`, chatData);
  await updateManifest(PATHS.chatData, chatData.id, 'add');
}

export async function deleteChatData(id: string): Promise<void> {
  // Optional: Clean up associated KV Caches
  try {
    await deleteResource(`${PATHS.kvCaches}/${id}`); // Assuming folder or specific file logic needed here
  } catch (e) {
    console.warn("Could not clean up KV caches for deleted chat", e);
  }

  await deleteResource(`${PATHS.chatData}/${id}.json`);
  await updateManifest(PATHS.chatData, id, 'remove');
}

// --- Image & Asset Helpers ---

export function getCharacterImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  return `${PATHS.characterImages}/${imageFilename}`;
}

export async function loadKVCache(chatId: string, messageId?: string): Promise<any> {
  // Implementation depends on how you store KV caches (single file per chat? per message?)
  // Example assuming per-chat cache:
  const url = `${PATHS.kvCaches}/${chatId}.json`;
  return await fetchJson<any>(url);
}

export async function saveKVCache(chatId: string, cacheData: any): Promise<void> {
  const url = `${PATHS.kvCaches}/${chatId}.json`;
  await putJson(url, cacheData);
}

export const storage = {
  // Characters
  loadCharacterManifest,
  loadCharacter,
  loadAllCharacters,
  saveCharacter,
  deleteCharacter,
  
  // Samplers
  loadSamplerManifest,
  loadSampler,
  saveSampler,
  deleteSampler,
  
  // Chats
  loadChatManifest,
  loadChatData,
  loadAllChatData,
  saveChatData,
  deleteChatData,
  
  // Helpers
  getCharacterImageUrl,
  loadKVCache,
  saveKVCache,
};