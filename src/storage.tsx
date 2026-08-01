
// src/repositories/DataRepository.ts

import type { 
  StopPattern, 
  RawStopPattern,
  Sampler,
  RawSampler,
  Instruction,
  RawInstruction, 
  Character,
  RawCharacter,
  ChatMessage,
  RawChatMessage,
  ChatData,
  RawChatData,
} from './types';

export const DefaultSampler: Sampler = {
  id: "0",
  name: "Default",
  description: undefined,
  parameters: {
    temperature: 0.8,
    top_k: 40,
    repeat_penalty: 1.15,
    n_predict: 512,
    stop: [], 
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
  },
  stopPatterns: [], 
  maximumNumberOfTokens: 512
};

export const DefaultInstruction: Instruction = {

  id: "0",
  name: "Default",
  description: undefined,
  content: "This is a conversation between a group of people."

}

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
  
  // Fetch existing IDs. If it returns null (due to HTML error or 404), start fresh.
  let currentIds = await fetchJson<string[]>(manifestUrl);
  
  if (!currentIds) {
    currentIds = []; // File didn't exist or was invalid, start new list
  }
  
  let newIds: string[];
  if (action === 'add') {
    if (currentIds.includes(id)) return; 
    newIds = [...currentIds, id];
  } else {
    newIds = currentIds.filter(existingId => existingId !== id);
  }

  // This PUT request will create the file if it doesn't exist
  await putJson(manifestUrl, newIds);
}

// --- Stop Pattern Repository ---

export async function loadStopPatternManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.stopPatterns}/${MANIFEST_FILE}`) || [];
}

export async function loadStopPattern(id: string): Promise<StopPattern | null> {
  const rawPattern = await fetchJson<RawStopPattern>(`${PATHS.stopPatterns}/${id}.json`);

  if (!rawPattern) return null;

  // Perform any necessary conversions or validations here
  const pattern: StopPattern = {
    id,
    name: rawPattern.name,
    description: rawPattern.description,
    pattern: rawPattern.pattern, // Assuming pattern is a string; adjust if it's an array or other type
    // Add other properties as needed
  };

  return pattern;
}

export async function saveStopPattern(pattern: StopPattern): Promise<void> {
  // Strip the ID before saving to ensure the file content is "Raw"
  const { id, ...rawPattern } = pattern; 
  
  await putJson(`${PATHS.stopPatterns}/${id}.json`, rawPattern);
  await updateManifest(PATHS.stopPatterns, id, 'add');
}

export async function deleteStopPattern(id: string): Promise<void> {
  await deleteResource(`${PATHS.stopPatterns}/${id}.json`);
  await updateManifest(PATHS.stopPatterns, id, 'remove');
}

// --- Sampler Repository ---

export async function loadSamplerManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.samplers}/${MANIFEST_FILE}`) || [];
}

export async function loadSampler(id: string): Promise<Sampler | null> {
  const rawSampler = await fetchJson<RawSampler>(`${PATHS.samplers}/${id}.json`);
  if (!rawSampler) return null;

  // Hydrate Stop Patterns from IDs
  const stopPatternIds = rawSampler.stopPatternIds || [];
  const stopPatterns = (await Promise.all(
    stopPatternIds.map(sid => loadStopPattern(sid))
  )).filter((p): p is StopPattern => p !== null);

  return {
    id,
    name: rawSampler.name,
    description: rawSampler.description,
    parameters: rawSampler.parameters || {},
    maximumNumberOfTokens: rawSampler.maximumNumberOfTokens,
    stopPatterns, // Now contains full objects, not just IDs
  };
}

export async function loadAllSamplers(): Promise<Sampler[]> {
  const ids = await loadSamplerManifest();
  const results = await Promise.all(ids.map(id => loadSampler(id)));
  return results.filter((s): s is Sampler => s !== null);
}

export async function saveSampler(sampler: Sampler): Promise<void> {
  // Strip 'id' and the hydrated 'stopPatterns' array
  const { id, stopPatterns, ...rawSampler } = sampler; 
  
  const payload: RawSampler = {
    ...rawSampler,
    stopPatternIds: stopPatterns.map(sp => sp.id),
  };

  await putJson(`${PATHS.samplers}/${id}.json`, payload);
  await updateManifest(PATHS.samplers, id, 'add');
}

export async function deleteSampler(id: string): Promise<void> {
  await deleteResource(`${PATHS.samplers}/${id}.json`);
  await updateManifest(PATHS.samplers, id, 'remove');
}

// --- Character Repository ---

export async function loadCharacterManifest(): Promise<string[]> {
  
  return await fetchJson<string[]>(`${PATHS.characters}/${MANIFEST_FILE}`) || [];
}

export async function loadCharacter(id: string): Promise<Character | null> {
  const rawCharacter = await fetchJson<RawCharacter>(`${PATHS.characters}/${id}.json`);
  if (!rawCharacter) return null;

  const samplerId = rawCharacter.samplerId;
  const sampler = samplerId ? (await loadSampler(samplerId) || DefaultSampler) : DefaultSampler;

  return {
    id,
    name: rawCharacter.name,
    image: rawCharacter.image,
    description: rawCharacter.description,
    systemPrompt: rawCharacter.systemPrompt,
    initiativeWeight: rawCharacter.initiativeWeight,
    chatProbability: rawCharacter.chatProbability,
    maximumChatStamina: rawCharacter.maximumChatStamina,
    sampler,
  };
}

export async function loadAllCharacters(): Promise<Character[]> {
  const ids = await loadCharacterManifest();
  const results = await Promise.all(ids.map(id => loadCharacter(id)));
  return results.filter((c): c is Character => c !== null);
}

export async function saveCharacter(character: Character): Promise<void> {
  const { id, sampler, ...rawCharacter } = character; 
  
  const payload: RawCharacter = {
    ...rawCharacter,
    samplerId: sampler?.id, // Only save the ID
  };

  await putJson(`${PATHS.characters}/${id}.json`, payload);
  await updateManifest(PATHS.characters, id, 'add');
}

export async function deleteCharacter(id: string): Promise<void> {
  await deleteResource(`${PATHS.characters}/${id}.json`);
  await updateManifest(PATHS.characters, id, 'remove');
  // Note: You may also want to delete associated images or KV caches here
}

// --- Instruction Repository ---

export async function loadInstructionManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.instructions}/${MANIFEST_FILE}`) || [];
}

export async function loadInstruction(id: string): Promise<Instruction | null> {
  const rawInstruction = await fetchJson<RawInstruction>(`${PATHS.instructions}/${id}.json`);

  if (!rawInstruction) return null;

  const instruction: Instruction = {
    id,
    name: rawInstruction.name,
    description: rawInstruction.description,
    content: rawInstruction.content,
  };

  return instruction;
}

export async function loadAllInstructions(): Promise<Instruction[]> {
  const ids = await loadInstructionManifest();
  const results = await Promise.all(ids.map(id => loadInstruction(id)));
  return results.filter((i): i is Instruction => i !== null);
}

export async function saveInstruction(instruction: Instruction): Promise<void> {
  // Strip the ID before saving to ensure the file content is "Raw"
  const { id, ...rawInstruction } = instruction; 
  
  await putJson(`${PATHS.instructions}/${id}.json`, rawInstruction);
  await updateManifest(PATHS.instructions, id, 'add');
}

export async function deleteInstruction(id: string): Promise<void> {
  await deleteResource(`${PATHS.instructions}/${id}.json`);
  await updateManifest(PATHS.instructions, id, 'remove');
}

// --- Chat Data Repository ---
// Note: In your normalized model, ChatData holds the message HISTORY (objects) 
// but references Characters/Instructions by ID.

export async function loadChatManifest(): Promise<string[]> {
  return await fetchJson<string[]>(`${PATHS.chatData}/${MANIFEST_FILE}`) || [];
}

export async function loadChatData(id: string): Promise<ChatData | null> {
  const rawChatData = await fetchJson<RawChatData>(`${PATHS.chatData}/${id}.json`);
  if (!rawChatData) return null;

  const [allCharacters, allInstructions] = await Promise.all([
    loadAllCharacters(),
    loadAllInstructions()
  ]);

  const charMap = new Map(allCharacters.map(c => [c.id, c]));
  const instMap = new Map(allInstructions.map(i => [i.id, i]));

  const protagonist = charMap.get(rawChatData.protagonistId);
  if (!protagonist) {
    console.error(`Protagonist ${rawChatData.protagonistId} not found for chat ${id}`);
    return null;
  }

  const participants = rawChatData.participantIds
    .map(pid => charMap.get(pid))
    .filter((c): c is Character => c !== undefined);

  const instructions = rawChatData.instructionIds
    .map(iid => instMap.get(iid))
    .filter((i): i is Instruction => i !== undefined);

  // 4. Resolve Message History
  // Load each message file by ID, then attach the full Character object to it
  const messagePromises = rawChatData.chatMessageIdHistory.map(async (msgId) => {
    const rawMessage = await fetchJson<RawChatMessage>(`${PATHS.chatMessages}/${msgId}.json`);
    if (!rawMessage) return null;

    const character = charMap.get(rawMessage.characterId);
    
    // Re-attach ID and Character object to create the Runtime ChatMessage
    const { characterId, ...msgWithoutCharId } = rawMessage;
    return {
      id: msgId, // Filename becomes ID
      ...msgWithoutCharId,
      character: character || { 
        // Fallback if character was deleted but message remains
        id: rawMessage.characterId, 
        name: '[Unknown Character]', 
        image: undefined 
      } as Character
    };
  });

  const chatMessageHistory = (await Promise.all(messagePromises)).filter(
    (m): m is ChatMessage => m !== null
  );

  const chatData: ChatData = {
    id,
    title: rawChatData.title,
    protagonist,
    participants,
    instructions,
    chatMessageHistory,
    first_created_timestamp: rawChatData.first_created_timestamp,
    last_updated_timestamp: rawChatData.last_updated_timestamp,
  };

  return chatData;
}

export async function loadAllChatData(): Promise<(ChatData | null)[]> {
  const ids = await loadChatManifest();
  return await Promise.all(ids.map(id => loadChatData(id)));
}

export async function saveChatData(chatData: ChatData): Promise<void> {
  const saveMessagePromises = chatData.chatMessageHistory.map(msg => {
    const { id, character, ...rawMsg } = msg; // Strip ID and hydrated Character
    
    const payload: RawChatMessage = {
      ...rawMsg,
      characterId: character.id
    };

    return putJson(`${PATHS.chatMessages}/${id}.json`, payload);
  });

  await Promise.all(saveMessagePromises);

  const { id, protagonist, participants, instructions, chatMessageHistory, ...rawChatData } = chatData;

  const payload: RawChatData = {
    ...rawChatData,
    protagonistId: protagonist.id,
    participantIds: participants.map(p => p.id),
    instructionIds: instructions?.map(i => i.id) || [],
    chatMessageIdHistory: chatMessageHistory.map(m => m.id), // Store only the IDs (Filenames)
  };

  await putJson(`${PATHS.chatData}/${id}.json`, payload);
  await updateManifest(PATHS.chatData, id, 'add');
}

export async function branchChatData(sourceChatId: string, branchPointMessageId: string): Promise<string> {
  const sourceChat = await loadChatData(sourceChatId);
  if (!sourceChat) throw new Error("Source chat not found");

  const branchIndex = sourceChat.chatMessageHistory.findIndex(m => m.id === branchPointMessageId);
  if (branchIndex === -1) throw new Error("Branch point message not found");

  const newChatId = crypto.randomUUID(); // or use uuidv4()

  // Create new metadata pointing to EXISTING message files (no copy)
  const newPayload: RawChatData = {
    title: `${sourceChat.title} (Branch)`,
    protagonistId: sourceChat.protagonist.id,
    participantIds: sourceChat.participants.map(p => p.id),
    instructionIds: sourceChat.instructions?.map(i => i.id) || [],
    // Slice the history IDs up to the branch point
    chatMessageIdHistory: sourceChat.chatMessageHistory.slice(0, branchIndex + 1).map(m => m.id),
    first_created_timestamp: Date.now(),
    last_updated_timestamp: Date.now(),
  };

  await putJson(`${PATHS.chatData}/${newChatId}.json`, newPayload);
  await updateManifest(PATHS.chatData, newChatId, 'add');

  return newChatId;
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