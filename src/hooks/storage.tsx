import type { 
  StopPattern, RawStopPattern, Sampler, RawSampler, Context, RawContext, LanguageModel,
  Character, RawCharacter, ChatMessage, RawChatMessage, ChatData, RawChatData,
  BudgetStrategy, RawBudgetStrategy
} from '../types';

import { localURL } from '../configurations';

const DefaultSampler: Sampler = {
  id: "0", name: "Default", description: undefined,
  parameters: { temperature: 0.8, top_k: 40, repeat_penalty: 1.15, n_predict: 512, stop: [], frequency_penalty: 0.0, presence_penalty: 0.0 },
  stopPatterns: [], maximumNumberOfTokens: 512,
  firstCreatedTimestamp: Date.now(),
  lastUpdatedTimestamp: Date.now(),
};

const WRITE_API_URL = localURL; 
const PATHS = {
  characters: "/user_data/character_data", characterImages: "/user_data/character_images",
  samplers: "/user_data/sampler_data", contexts: "/user_data/context_data",
  models: "/user_data/model_data",
  stopPatterns: "/user_data/stop_patterns_data", chatMessages: "/user_data/chat_messages", 
  chatData: "/user_data/chat_data", kvCaches: "/user_data/kv_caches",
  budgetStrategies: "/user_data/budget_strategies",
};
const MANIFEST_FILE = 'manifest.json';

// --- Generic Helpers ---

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      if (response.status === 404 || response.status === 200) return null; 
    }
    if (!response.ok) return null;
    return await response.json();
  } catch (error) { console.warn(`Failed to parse JSON from ${url}.`, error); return null; }
}

async function putJson<T>(url: string, data: T): Promise<void> {
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const targetUrl = `${WRITE_API_URL}${cleanUrl}`;
  const response = await fetch(targetUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
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
  if (!currentIds) currentIds = []; 
  let newIds: string[];
  if (action === 'add') { if (currentIds.includes(id)) return; newIds = [...currentIds, id]; } 
  else { newIds = currentIds.filter(existingId => existingId !== id); }
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

// --- Stop Pattern Repository ---
export async function loadRawStopPatternManifest(): Promise<string[]> { 
  return await fetchJson<string[]>(`${PATHS.stopPatterns}/${MANIFEST_FILE}`) || []; 
}

export async function loadRawStopPattern(id: string): Promise<StopPattern | null> {
  const rawPattern = await fetchJson<RawStopPattern>(`${PATHS.stopPatterns}/${id}.json`);
  if (!rawPattern) return null;
  return { 
    id, 
    name: rawPattern.name, 
    description: rawPattern.description, 
    pattern: rawPattern.pattern,
    regularExpressionTrigger: rawPattern.regularExpressionTrigger,
    regularExpressionContext: rawPattern.regularExpressionContext,
    regularExpressionTarget: rawPattern.regularExpressionTarget,
    firstCreatedTimestamp: rawPattern.firstCreatedTimestamp,
    lastUpdatedTimestamp: rawPattern.lastUpdatedTimestamp,
  };
}

export async function loadAllRawStopPatterns(): Promise<StopPattern[]> {
  const ids = await loadRawStopPatternManifest();
  const results = await Promise.all(ids.map(id => loadRawStopPattern(id)));
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
  const rawSampler = await fetchJson<RawSampler>(`${PATHS.samplers}/${id}.json`);
  if (!rawSampler) return null;
  const stopPatternIds = rawSampler.stopPatternIds || [];
  const stopPatterns = (await Promise.all(stopPatternIds.map(sid => loadRawStopPattern(sid)))).filter((p): p is StopPattern => p !== null);
  return { 
    id, 
    name: rawSampler.name, 
    description: rawSampler.description, 
    parameters: rawSampler.parameters || {}, 
    maximumNumberOfTokens: rawSampler.maximumNumberOfTokens, 
    stopPatterns,
    firstCreatedTimestamp: rawSampler.firstCreatedTimestamp,
    lastUpdatedTimestamp: rawSampler.lastUpdatedTimestamp,
  };
}

export async function loadAllRawSamplers(): Promise<Sampler[]> {
  const ids = await loadRawSamplerManifest();
  const results = await Promise.all(ids.map(id => loadRawSampler(id)));
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
  const rawCharacter = await fetchJson<RawCharacter>(`${PATHS.characters}/${id}.json`);
  if (!rawCharacter) return null;
  const samplerId = rawCharacter.samplerId;
  const sampler = samplerId ? (await loadRawSampler(samplerId) || DefaultSampler) : DefaultSampler;
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
    firstCreatedTimestamp: rawCharacter.firstCreatedTimestamp,
    lastUpdatedTimestamp: rawCharacter.lastUpdatedTimestamp,
  };
}

export async function loadAllRawCharacters(): Promise<Character[]> {
  const ids = await loadRawCharacterManifest();
  const results = await Promise.all(ids.map(id => loadRawCharacter(id)));
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
        name: rawContext.name, 
        description: rawContext.description, 
        text: rawContext.text,
        images: rawContext.images,
        regularExpressionTrigger: rawContext.regularExpressionTrigger,
        regularExpressionContext: rawContext.regularExpressionContext,
        regularExpressionTarget: rawContext.regularExpressionTarget,
        firstCreatedTimestamp: rawContext.firstCreatedTimestamp,
        lastUpdatedTimestamp: rawContext.lastUpdatedTimestamp,
    };
}

export async function loadAllRawContexts(): Promise<Context[]> {
    const ids = await loadRawContextManifest();
    const results = await Promise.all(ids.map(id => loadRawContext(id)));
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
    const rawModel = await fetchJson<LanguageModel>(`${PATHS.models}/${id}.json`);
    if (!rawModel) return null;
    return {
        ...rawModel,
        firstCreatedTimestamp: rawModel.firstCreatedTimestamp,
        lastUpdatedTimestamp: rawModel.lastUpdatedTimestamp,
    };
}

export async function loadAllRawModels(): Promise<LanguageModel[]> {
    const ids = await loadRawModelManifest();
    const results = await Promise.all(ids.map(id => loadRawModel(id)));
    return results.filter((m): m is LanguageModel => m !== null);
}

export async function saveRawModel(model: LanguageModel): Promise<void> {
    const { id, ...rawModel } = model;
    const payload = {
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
    
    // Load the referenced models
    const [onlineModel, localModel] = await Promise.all([
        loadRawModel(rawStrategy.onlineModelId),
        loadRawModel(rawStrategy.localModelId)
    ]);

    if (!onlineModel || !localModel) {
        console.warn(`Failed to load models for budget strategy ${id}`);
        return null;
    }

    return {
        id,
        name: rawStrategy.name,
        description: rawStrategy.description,
        onlineModel,
        localModel,
        switchProbabilty: rawStrategy.switchProbabilty,
        switchOnContextSize: rawStrategy.switchOnContextSize,
        switchOnComplexityScore: rawStrategy.switchOnComplexityScore,
        fallbackOnLocalFailure: rawStrategy.fallbackOnLocalFailure,
        fallbackOnQualityThreshold: rawStrategy.fallbackOnQualityThreshold,
        fallbackOnTimeoutInSeconds: rawStrategy.fallbackOnTimeoutInSeconds,
        maximumBudget: rawStrategy.maximumBudget,
        firstCreatedTimestamp: rawStrategy.firstCreatedTimestamp,
        lastUpdatedTimestamp: rawStrategy.lastUpdatedTimestamp,
    };
}

export async function loadAllRawBudgetStrategies(): Promise<BudgetStrategy[]> {
    const ids = await loadRawBudgetStrategyManifest();
    const results = await Promise.all(ids.map(id => loadRawBudgetStrategy(id)));
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

// --- Chat Message Repository ---
export async function deleteRawChatMessage(id: string): Promise<void> { 
    await deleteResource(`${PATHS.chatMessages}/${id}.json`); 
}

// --- Chat Data Repository ---
export async function loadRawChatManifest(): Promise<string[]> { 
    return await fetchJson<string[]>(`${PATHS.chatData}/${MANIFEST_FILE}`) || []; 
}

export async function loadRawChatData(id: string): Promise<ChatData | null> {
  const rawChatData = await fetchJson<RawChatData>(`${PATHS.chatData}/${id}.json`);
  if (!rawChatData) return null;
  const [allCharacters, allContexts] = await Promise.all([ loadAllRawCharacters(), loadAllRawContexts() ]);
  const charMap = new Map(allCharacters.map(c => [c.id, c]));
  const contextMap = new Map(allContexts.map(i => [i.id, i]));
  const protagonist = charMap.get(rawChatData.protagonistId);
  if (!protagonist) return null;
  const participants = rawChatData.participantIds.map(pid => charMap.get(pid)).filter((c): c is Character => c !== undefined);
  const contexts = rawChatData.contextIds.map(iid => contextMap.get(iid)).filter((i): i is Context => i !== undefined);
  const messagePromises = rawChatData.chatMessageIdHistory.map(async (messageId) => {
    const rawMessage = await fetchJson<RawChatMessage>(`${PATHS.chatMessages}/${messageId}.json`);
    if (!rawMessage) return null;
    const character = charMap.get(rawMessage.characterId);
    const { characterId, ...messageWithoutCharId } = rawMessage;
    return { 
      id: messageId, 
      ...messageWithoutCharId, 
      character: character || { id: rawMessage.characterId, name: '[Unknown]', image: undefined } as Character 
    };
  });
  const chatMessageHistory = (await Promise.all(messagePromises)).filter((m): m is ChatMessage => m !== null);
  return {
    id, 
    title: rawChatData.title, 
    protagonist, 
    participants, 
    contexts, 
    chatMessageHistory,
    firstCreatedTimestamp: rawChatData.firstCreatedTimestamp, 
    lastUpdatedTimestamp: rawChatData.lastUpdatedTimestamp,
    parentChatDataId: rawChatData.parentChatDataId || null, 
    parentChatMessageId: rawChatData.parentChatMessageId || null
  };
}

export async function loadAllRawChatData(): Promise<ChatData[]> {
  const ids = await loadRawChatManifest();
  const results = await Promise.all(ids.map(id => loadRawChatData(id)));
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
  await Promise.all(saveMessagePromises);
  const { id, protagonist, participants, contexts, chatMessageHistory, parentChatDataId, parentChatMessageId, ...rawChatData } = chatData;
  const payload: RawChatData = {
    ...rawChatData, 
    protagonistId: protagonist.id, 
    participantIds: participants.map(p => p.id),
    contextIds: contexts?.map(i => i.id) || [], 
    chatMessageIdHistory: chatMessageHistory.map(m => m.id),
    parentChatDataId: parentChatDataId || null, 
    parentChatMessageId: parentChatMessageId || null,
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
  const newChatId = crypto.randomUUID();
  const newPayload: RawChatData = {
    title: `${sourceChat.title} (Branch)`, 
    protagonistId: sourceChat.protagonist.id,
    participantIds: sourceChat.participants.map(p => p.id), 
    contextIds: sourceChat.contexts?.map(i => i.id) || [],
    chatMessageIdHistory: sourceChat.chatMessageHistory.slice(0, branchIndex + 1).map(m => m.id),
    firstCreatedTimestamp: Date.now(), 
    lastUpdatedTimestamp: Date.now(), 
    parentChatDataId, 
    parentChatMessageId
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

// --- Helpers ---
export function getCharacterImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  return `${PATHS.characterImages}/${imageFilename}`;
}

export async function uploadCharacterImage(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const imagePath = `${PATHS.characterImages}/${filename}`;
  await putJson(imagePath, { base64 });
  return filename;
}

export function getContextImageUrl(imageFilename: string | undefined): string | null {
  if (!imageFilename) return null;
  return `${PATHS.contexts}/${imageFilename}`;
}

export async function uploadContextImage(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const imagePath = `${PATHS.contexts}/${filename}`;
  await putJson(imagePath, { base64 });
  return filename;
}