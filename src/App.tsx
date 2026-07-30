import React from 'react'
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'; 
import './App.css'

const userDataPath = `${import.meta.env.BASE_URL}user-data`;
const characterDataPath = `${userDataPath}/character-data`;
const characterImagesPath = `${userDataPath}/character-images`;
const samplerDataPath = `${userDataPath}/sampler-data`;
const chatDataPath = `${userDataPath}/chat-data`;
const kvCachesPath = `${userDataPath}/kv-caches`;

const NAME_TERMINATOR = String.raw`(?:\s+and|\s+but|\s+who|\.|,|!|\?|$)`;
const NAME_CAPTURE = String.raw`([\w\s]{1,50}?)`;

const NAME_REVEAL_PATTERNS_LOWERCASE = [
  new RegExp(`i am ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`i'm ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`my name is ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`my name's ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`${NAME_CAPTURE} is my name`, 'i'), // No terminator needed — sentence ends naturally.
  new RegExp(`they call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`people call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`you may call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
];

interface StopPattern { // For custom roleplay formats where the AI should stop generating text after a certain pattern.
  id: string;
  name: string;
  description?: string;
  patterns: string[];
}

interface Sampler {
  id: string;
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  stopPattern?: StopPattern;
  maxTokens?: number; // Optional max tokens for this sampler, if different from the default.
}

interface Character { // Shared by both AI and User.
  id: string;
  name: string;
  image?: string;
  description?: string;
  systemPrompt?: string; // Even though the user does not have a system prompt, it is useful to have this for talking to AI version of the user.
  initiativeWeight: number; // Optional initiative weight for AI characters.
  chatProbability: number; // Optional probability for AI characters to respond in a multi-character chat.
  sampler?: Sampler; // Optional sampler for AI characters.
}

interface ChatMessage {
  id: string;
  character: Character;
  textContent: string;
  isAppearanceRevealed?: boolean; // Optional flag to indicate if the character's appearance has been revealed in this message.
  isNameRevealed?: boolean;
  kvCachePath?: string;
  timestamp: number;
  parentMessageId?: string | null; // Only for cache invalidation on edit within THIS window
}

interface ChatData {
  id: string;
  title: string;
  protagonist: Character;
  participants: Character[];
  chatMessageHistory: ChatMessage[]; // ✅ Back to simple flat array
  first_created_timestamp: number;
  last_updated_timestamp: number;
}

async function loadCharacterFromLocalStorage(characterId: string): Promise<Character | null> {
  try {
    const response = await fetch(`${characterDataPath}/${characterId}.json`);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      id: data.id || characterId,
      name: data.name || 'Unknown',
      image: data.image,
      description: data.description,
      systemPrompt: data.systemPrompt,
      initiativeWeight: data.initiativeWeight ?? 1, // Default weight of 1.
      chatProbability: data.chatProbability ?? 0.5, // Default probability of 0.5.
      sampler: data.sampler, // Pass through as-is (dictionary + stopPattern).
    };
  } catch (error) {
    console.error(`Failed to load character ${characterId}:`, error);
    return null;
  }
}

async function loadAllCharactersFromLocalStorage(): Promise<Character[]> {
  try {
    const manifestResponse = await fetch(`${characterDataPath}/manifest.json`);
    if (!manifestResponse.ok) return [];
    const characterIds: string[] = await manifestResponse.json();

    const results = await Promise.allSettled(
      characterIds.map(id => loadCharacterFromLocalStorage(id))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<Character> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);
  } catch (error) {
    console.error('Failed to load character manifest:', error);
    return [];
  }
}

async function saveChatData(chatData: ChatData): Promise<void> {
  const response = await fetch(`${chatDataPath}/${chatData.id}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chatData),
  });
  if (!response.ok) throw new Error(`Failed to save chat ${chatData.id}`);
}

async function loadChatData(chatId: string): Promise<ChatData | null> {
  try {
    const response = await fetch(`${chatDataPath}/${chatId}.json`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`Failed to load chat ${chatId}:`, error);
    return null;
  }
}

async function listChatIds(): Promise<string[]> {
  try {
    const response = await fetch(`${chatDataPath}/manifest.json`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

function detectNameReveal(text: string, characterName: string): boolean {
  const characterNameLower = characterName.toLowerCase();
  
  for (const pattern of NAME_REVEAL_PATTERNS_LOWERCASE) {
    const match = text.match(pattern);
    if (match) {
      const capturedName = match[1].toLowerCase();
      // Check if the character name is part of the captured phrase.
      if (capturedName.includes(characterNameLower) || 
          characterNameLower.includes(capturedName)) {
        return true;
      }
    }
  }
  return false;
}

function findPreviousChatMessage(chatMessageHistory: ChatMessage[], characterId: string): ChatMessage | null {

  for (let i = chatMessageHistory.length - 1; i >= 0; i--) {
    if (chatMessageHistory[i].character.id === characterId) {
      return chatMessageHistory[i];
    }
  }

  return null;
}

function createChatMessage(chatData: ChatData, character: Character, textContent: string): ChatMessage {

  const characterId = character.id;

  const characterName = character.name;

  const chatMessageHistory = chatData.chatMessageHistory;

  const previousMessage = findPreviousChatMessage(chatMessageHistory, characterId);

  const isAppearancePreviouslyRevealed = previousMessage ? previousMessage.isAppearanceRevealed : false;

  const isAppearanceRevealed = isAppearancePreviouslyRevealed || !!previousMessage;

  const isNamePreviouslyRevealed = previousMessage ? previousMessage.isNameRevealed : false;

  const previousTextContent = previousMessage ? previousMessage.textContent : '';

  const isNameRevealed = isNamePreviouslyRevealed || detectNameReveal(previousTextContent, characterName);

  const chatDataLength = chatMessageHistory.length;

  const hasChatData = chatDataLength > 0;

  const parentMessageId = hasChatData ? chatMessageHistory[chatDataLength - 1].id : null;

  return {
    id: uuidv4(),
    character: { ...character },
    textContent,
    isAppearanceRevealed,
    isNameRevealed,
    timestamp: Date.now(),
    parentMessageId,
  };
}

function addMessageToChatData(chatData: ChatData, newChatMessage: ChatMessage): ChatData {

  const updatedMessages = [...chatData.chatMessageHistory, newChatMessage];

  return {
    ...chatData,
    chatMessageHistory: updatedMessages,
    last_updated_timestamp: Date.now(),
  };

}

function getCharacterPromptId(character: Character, participants: Character[]): string {
  const index = participants.findIndex(p => p.id === character.id);
  return index !== -1 ? `Character ${index + 1}` : 'Unknown';
}

function buildPromptFromHistory(chatData: ChatData, character: Character, triggerText: string): string {
  const lines: string[] = [];

  // System context uses ID if name never revealed.
  const characterEverRevealed = chatData.chatMessageHistory.some(
    m => m.character.id === character.id && m.isNameRevealed
  );
  const characterId = getCharacterPromptId(character, chatData.participants);
  const characterLabel = characterEverRevealed ? character.name : characterId;

  if (character.systemPrompt) {
    lines.push(`[System: ${character.systemPrompt}]`);
  }
  if (character.description) {
    lines.push(`[${characterLabel} Info: ${character.description}]`);
  }

  // Identity map so model learns real names while using safe IDs.
  const mappings = chatData.participants
    .map(p => {
      const id = getCharacterPromptId(p, chatData.participants);
      const nameRevealed = chatData.chatMessageHistory.some(m => m.character.id === p.id && m.isNameRevealed);
      const appearanceRevealed = chatData.chatMessageHistory.some(m => m.character.id === p.id && m.isAppearanceRevealed);

      const namePart = nameRevealed ? p.name : '[name unknown]';
      const appearancePart = appearanceRevealed ? '[appearance known]' : '[appearance unknown]';
      return `${id} = ${namePart}, ${appearancePart}`;
    })
    .join('; ');
  lines.push(`[Identity Map: ${mappings}]`);

  // All previous messages use stable IDs
  for (const msg of chatData.chatMessageHistory) {
    const promptId = getCharacterPromptId(msg.character, chatData.participants);
    lines.push(`${promptId}: ${msg.textContent}`);
  }

  const protagonistId = getCharacterPromptId(chatData.protagonist, chatData.participants);
  lines.push(`${protagonistId}: ${triggerText}`);
  lines.push(`${characterId}:`);

  return lines.join('\n');
}

function convertIdsToDisplayNames(text: string, chatData: ChatData): string {
  let result = text;
  chatData.participants.forEach((p, i) => {
    const id = `Character ${i + 1}`;
    const everRevealed = chatData.chatMessageHistory.some(
      m => m.character.id === p.id && m.isNameRevealed
    );
    if (everRevealed) {
      result = result.replace(new RegExp(`\\b${id}\\b`, 'g'), p.name);
    }
  });
  return result;
}

async function handleAIResponse(chatData: ChatData, aiCharacter: Character, userText: string): Promise<ChatData> {
  const sampler = aiCharacter.sampler;
  const params = sampler?.parameters ?? {};
  const prompt = buildPromptFromHistory(chatData, aiCharacter, userText);

  // ✅ Check if this is the character's FIRST revealed appearance
  const everAppearedBefore = chatData.chatMessageHistory.some(
    m => m.character.id === aiCharacter.id && m.isAppearanceRevealed
  );
  const shouldInjectImage = !everAppearedBefore && !!aiCharacter.image;

  const stopSequences = [
    ...chatData.participants
      .filter(p => p.id !== aiCharacter.id)
      .flatMap(p => {
        const id = getCharacterPromptId(p, chatData.participants);
        return [`\n${id}:`, `\n${p.name}:`];
      }),
    ...(sampler?.stopPattern?.patterns ?? []),
  ];

  const response = await fetch('/api/completion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      n_predict: sampler?.maxTokens ?? 512,
      stop: stopSequences,
      character_image: shouldInjectImage ? aiCharacter.image : undefined, // Conditional injection.
      ...params,
    }),
  });

  const result = await response.json();
  const displayText = convertIdsToDisplayNames(result.content.trim(), chatData);

  const aiMessage = createChatMessage(chatData, aiCharacter, displayText);
  const aiMessageWithCache: ChatMessage = {
    ...aiMessage,
    kvCachePath: result.kv_cache_path,
  };

  return addMessageToChatData(chatData, aiMessageWithCache);
}

async function handleAllParticipantsResponseExceptTheProtagonist(chatData: ChatData, userText: string): Promise<ChatData> {

  let updatedChatData = chatData;

  const eligible = updatedChatData.participants.filter(
    p => p.id !== updatedChatData.protagonist.id && (p.chatProbability ?? 0.5) > 0
  );

  if (eligible.length === 0) return updatedChatData;

  // Step 1: Independent Bernoulli trial per character using chatProbability.
  const responders = eligible.filter(p => Math.random() < (p.chatProbability ?? 0.5));

  // Fallback: guarantee at least one responder if everyone failed their roll.
  if (responders.length === 0 && eligible.length > 0) {
    const highestProb = eligible.reduce((best, p) =>
      (p.chatProbability ?? 0.5) > (best.chatProbability ?? 0.5) ? p : best
    );
    responders.push(highestProb);
  }

  // Step 2: Sort responders by initiativeWeight DESCENDING (highest initiative speaks first).
  responders.sort((a, b) => (b.initiativeWeight ?? 1) - (a.initiativeWeight ?? 1));

  // Step 3: Generate sequentially so each character sees previous responses in prompt.
  for (const responder of responders) {
    updatedChatData = await handleAIResponse(updatedChatData, responder, userText);
  }

  return updatedChatData;

}

function editChatMessage(chatData: ChatData, messageId: string, newText: string): ChatData {
  const editIndex = chatData.chatMessageHistory.findIndex(m => m.id === messageId);
  if (editIndex === -1) return chatData;

  const updatedHistory = chatData.chatMessageHistory.map((msg, idx) => {
    if (idx === editIndex) {
      return { ...msg, textContent: newText, kvCachePath: undefined };
    }
    if (idx > editIndex) {
      return { ...msg, kvCachePath: undefined }; // Only destroy cache, NOT reveal state.
    }
    return msg;
  });

  return {
    ...chatData,
    chatMessageHistory: updatedHistory,
    last_updated_timestamp: Date.now(),
  };
}

function branchChatAtMessage(sourceChatData: ChatData, branchPointMessageId: string): ChatData {

  const branchIndex = sourceChatData.chatMessageHistory.findIndex(
    m => m.id === branchPointMessageId
  );
  if (branchIndex === -1) throw new Error('Branch point message not found');

  const branchedHistory = sourceChatData.chatMessageHistory.slice(0, branchIndex + 1);
  const currentTimestamp = Date.now();

  // ✅ Human-readable position label (1-indexed for natural reading).
  const branchPosition = branchIndex + 1;

  return {
    id: uuidv4(),
    title: `${sourceChatData.title} [#${branchPosition}]`,
    protagonist: sourceChatData.protagonist,
    participants: sourceChatData.participants,
    chatMessageHistory: branchedHistory,
    first_created_timestamp: currentTimestamp,
    last_updated_timestamp: currentTimestamp,
  };
}

// When creating/loading a chat session, check if protagonist has an image.
// and inject it as part of the root KV cache prefix.
async function initializeChatSession(chatData: ChatData): Promise<ChatData> {
  if (!chatData.protagonist.image) return chatData;

  // Backend processes protagonist image once at session start.
  // This becomes part of the immutable root KV cache.
  const response = await fetch('/api/session/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: chatData.id,
      protagonistImage: chatData.protagonist.image,
      participants: chatData.participants.map(p => ({
        id: p.id,
        image: p.image,
      })),
    }),
  });

  // Root KV cache now contains protagonist + all participant visual embeddings.
  // Subsequent turns load this root cache and append conversation text only.
  return chatData;
}

function App() {
  const [chatData, setChatData] = useState<ChatData | null>(null);
  const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const onProtagonistSendMessage = async () => {

    if (!inputText.trim() || !currentCharacter || !chatData) return;

    setIsLoading(true);

    try {
      const protagonistChatMessage = createChatMessage(chatData, chatData.protagonist, inputText);
      let updatedChatData = addMessageToChatData(chatData, protagonistChatMessage);
      updatedChatData = await handleAllParticipantsResponseExceptTheProtagonist(updatedChatData, inputText);
      setChatData(updatedChatData);
      await saveChatData(updatedChatData); // Persist after full turn completes.
      setInputText('');
    } finally {
      setIsLoading(false); // Critical: always reset loading state.
    }
  };

  const onEditMessage = async (messageId: string, newText: string) => {
    if (!chatData) return;
    const updatedChatData = editChatMessage(chatData, messageId, newText);
    setChatData(updatedChatData);
    await saveChatData(updatedChatData); // Persist edit.
  };

  const onBranchAtMessage = async (messageId: string) => {
    if (!chatData) return;
    const branchedChatData = branchChatAtMessage(chatData, messageId);
    await saveChatData(branchedChatData); // Persist new branch.
    // Optionally open in new window/tab here.
  };

  return (
    // Your JSX here
  );
}

export default App
