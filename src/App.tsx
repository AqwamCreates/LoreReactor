import React from 'react'
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'; 
import './App.css'

const userDataPath = `${import.meta.env.BASE_URL}user_data`;
const characterDataPath = `${userDataPath}/character_data`;
const characterImagesPath = `${userDataPath}/character_images`;
const samplerDataPath = `${userDataPath}/sampler_data`;
const instructionDataPath = `${userDataPath}/instruction_data`;
const chatDataPath = `${userDataPath}/chat_data`;
const kvCachesPath = `${userDataPath}/kv_caches`;

const NAME_TERMINATOR = String.raw`(?:\s+and|\s+but|\s+who|\.|,|!|\?|$)`;
const NAME_CAPTURE = String.raw`([\w\s]{1,50}?)`;

const NAME_REVEAL_PATTERNS_LOWERCASE = [
  new RegExp(`i am ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`i'm ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`my name is ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`my name's ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`${NAME_CAPTURE} is my name`, 'i'),
];

const NAME_REVEAL_QUESTION_PATTERNS_LOWERCASE = [
  // 1. ... name(s)?
  // Must end with "name?" or "names?"
  /\bnames?\?/i,

  // 2. ... call/address/refer you/thy?
  // Must contain the verb phrase AND end with a question mark
  /\b(?:call|address|refer\s+to)\s+(?:you|thy|thee).*?\?/i,

  // 3. ... about you?
  // Must contain "about you" AND end with a question mark
  /\babout\s+you.*?\?/i,

  // 4. ... are you?
  // Must contain "are you" AND end with a question mark
  /\bare\s+you.*?\?/i,

  // 5. ... you are?
  // Must contain "you are" AND end with a question mark
  /\byou\s+are.*?\?/i,
];

const NAME_PERMISSION_QUESTION_PATTERNS = [
  /\b(?:do|would|should|can|may)\s+(?:you|u)\s+(?:want|like|wish)\s+(?:to\s+)?(?:know|hear)\s+(?:my|our)\s+name\b/i,
  /\b(?:want|would\s+you\s+like)\s+(?:to\s+)?(?:know|hear)\s+(?:my|our)\s+name\b/i,
  /\b(?:shall|i\s+should)\s+(?:tell|say)\s+(?:you|u)\s+(?:my|our)\s+name\b/i,
  /\b(?:ready\s+for\s+my\s+name|should\s+i\s+introduce\s+myself)\b/i
];

// Patterns that affirm/accept the offer (Short positive responses).
const NAME_AFFIRMATION_PATTERNS = [
  /\b(?:yes|yeah|yep|sure|certainly|absolutely|please|go\s+ahead|ok|okay|i\s+would\s+love\s+to|i'\s+d\s+like\s+that)\b/i,
  /\b(?:tell\s+me|let'\s+s\s+hear\s+it|I'\s+m\s+listening)\b/i
];

// Patterns indicating the user is proceeding to say their name regardless of context.
const NAME_REVEAL_INTENT_PATTERNS = [
  /\b(?:i'll|i will|i shall|let me|i'm gonna|i am going to)\s+(?:tell|say|give)\s+(?:you|u|them)\s+(?:my|the)\s+name\b/i,
  /\b(?:anyway|regardless|either way|in any case|fine|alright|ok),?\s*(?:i'm|i am|my name is|call me)\b/i,
  /\b(?:here(?:'s| is)|it is|that is)\s+(?:my|the)\s+name\b/i,
  /\b(?:never mind|doesn't matter),?\s*(?:i'm|i am|my name is)\b/i,
  /\b(?:just)\s+(?:know|call me|remember)\s+(?:that)?\s*i['']?m\b/i,
  /\b(?:by the way|btw),?\s*(?:i'm|i am|my name is)\b/i
];

interface StopPattern {
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
  maxTokens?: number;
}

interface Instruction {
  id: string;
  name: string;
  description?: string;
  content: string;
}

interface Character {
  id: string;
  name: string;
  image?: string;
  description?: string;
  systemPrompt?: string;
  initiativeWeight?: number | undefined;
  chatProbability?: number | undefined;
  sampler?: Sampler | undefined;
}

interface ChatMessage {
  id: string;
  character: Character;
  textContent: string;
  isAppearanceRevealed?: boolean;
  isNameRevealed?: boolean;
  kvCachePath?: string;
  timestamp: number;
  parentMessageId?: string | null;
}

interface ChatData {
  id: string;
  title: string;
  protagonist: Character;
  participants: Character[];
  instructions?: Instruction[]; // ← Session-level, applies to all
  chatMessageHistory: ChatMessage[];
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
      initiativeWeight: data.initiativeWeight ?? 1,
      chatProbability: data.chatProbability ?? 0.5,
      sampler: data.sampler,
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
      if (capturedName.includes(characterNameLower) || characterNameLower.includes(capturedName)) {
        return true;
      }
    }
  }
  return false;
}

function detectNamePermissionSequence(
  chatHistory: ChatMessage[], 
  currentCharacterId: string, 
  currentText: string, 
  characterName: string
): boolean {
  if (chatHistory.length < 2) return false;

  const lastMessage = chatHistory[chatHistory.length - 1];
  const secondLastMessage = chatHistory[chatHistory.length - 2];

  // Scenario: 
  // Msg[-2] (User): "Do you want to know my name?"
  // Msg[-1] (AI):   "Yes!"
  // Msg[Current] (User): "Aqwam"

  // 1. Check if the second-to-last message contains a permission question
  const hasPermissionQuestion = NAME_PERMISSION_QUESTION_PATTERNS.some(p => p.test(secondLastMessage.textContent));
  
  // 2. Check if the last message (AI) is an affirmation
  // Ensure the last message is NOT from the current character (it must be the AI responding to the user)
  const isAiAffirmation = lastMessage.character.id !== currentCharacterId && NAME_AFFIRMATION_PATTERNS.some(p => p.test(lastMessage.textContent));

  if (hasPermissionQuestion && isAiAffirmation) {
    // 3. Check if current text is likely the name
    const isLikelyJustAName = currentText.trim().split(/\s+/).length <= 3 && !/[.!?]/.test(currentText);
    const isDirectReveal = detectNameReveal(currentText, characterName);
    
    if (isLikelyJustAName || isDirectReveal) {
      return true;
    }
  }

  return false;
}

function detectIntentToReveal(text: string, characterName: string): boolean {
  const characterNameLower = characterName.toLowerCase();
  
  // 1. Check if any intent pattern exists in the text
  const hasIntent = NAME_REVEAL_INTENT_PATTERNS.some(pattern => pattern.test(text));
  
  if (!hasIntent) return false;

  // 2. Try strict detection first ("I'm Aqwam", "My name is Aqwam").
  if (detectNameReveal(text, characterName)) {
    return true;
  }

  // 3. FALLBACK: If intent is present but strict regex failed (e.g., "Fine. Aqwam").
  // Assume the last significant word(s) are the name.
  const cleanText = text.replace(/[.,!?;]/g, '').trim();
  const words = cleanText.split(/\s+/);
  
  // Get the last 1 or 2 words as potential name candidates
  const potentialCandidates = [];
  if (words.length > 0) potentialCandidates.push(words[words.length - 1]);
  if (words.length > 1) potentialCandidates.push(words.slice(words.length - 2).join(' '));

  for (const candidate of potentialCandidates) {
    const candidateLower = candidate.toLowerCase();
    // Check for inclusion or exact match
    if (candidateLower === characterNameLower || 
        characterNameLower.includes(candidateLower) || 
        candidateLower.includes(characterNameLower)) {
      return true;
    }
  }

  return false;
}

function findPreviousChatMessage(chatMessageHistory: ChatMessage[], characterId: string): ChatMessage | null {
  for (let i = chatMessageHistory.length - 1; i >= 0; i--) {
    if (chatMessageHistory[i].character.id === characterId) return chatMessageHistory[i];
  }
  return null;
}

function createChatMessage(chatData: ChatData, character: Character, textContent: string): ChatMessage {
  const characterId = character.id;
  const characterName = character.name;
  const chatMessageHistory = chatData.chatMessageHistory;
  
  // 1. Find previous message by this character to check existing state.
  const previousMessage = findPreviousChatMessage(chatMessageHistory, characterId);
  
  // 2. Determine baseline states from history
  const isAppearancePreviouslyRevealed = previousMessage ? previousMessage.isAppearanceRevealed : false;
  const isNamePreviouslyRevealed = previousMessage ? previousMessage.isNameRevealed : false;
  
  // 3. Check for direct name declaration in the CURRENT message (Standard: "My name is X").
  const isDirectNameReveal = detectNameReveal(textContent, characterName);

  // 4. Check for "Intent to Reveal" regardless of history (e.g., "I'll tell you anyway. Aqwam").
  const isIntentionalReveal = detectIntentToReveal(textContent, characterName);

  // 5. Contextual Check: Answering a standard question from history
  let isAnsweringStandardQuestion = false;
  if (!isNamePreviouslyRevealed && !isDirectNameReveal && !isIntentionalReveal) {
    const questionAskedPreviously = chatMessageHistory.some(msg => {
      return NAME_REVEAL_QUESTION_PATTERNS_LOWERCASE.some(pattern => 
        pattern.test(msg.textContent)
      );
    });

    if (questionAskedPreviously) {
      const isLikelyJustAName = textContent.trim().split(/\s+/).length <= 3 && !/[.!?]/.test(textContent);
      if (isLikelyJustAName) {
        isAnsweringStandardQuestion = true;
      }
    }
  }

  // 6. Contextual Check: The Permission Sequence (Optional backup)
  // Even if we have intentional reveal, this catches cases where they say just "Aqwam" after "Yes"
  let isAnsweringPermissionSequence = false;
  if (!isNamePreviouslyRevealed && !isDirectNameReveal && !isIntentionalReveal && !isAnsweringStandardQuestion) {
    isAnsweringPermissionSequence = detectNamePermissionSequence(chatMessageHistory, characterId, textContent, characterName);
  }

  // Combine ALL conditions
  const isNameRevealed = 
    isNamePreviouslyRevealed || 
    isDirectNameReveal || 
    isIntentionalReveal ||       // <-- Handles "No." -> "I'll tell you anyway. Aqwam"
    isAnsweringStandardQuestion || 
    isAnsweringPermissionSequence;
  
  // Appearance logic remains unchanged
  const isAppearanceRevealed = isAppearancePreviouslyRevealed || !!previousMessage;

  const hasChatData = chatMessageHistory.length > 0;
  const parentMessageId = hasChatData ? chatMessageHistory[chatMessageHistory.length - 1].id : null;

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
  return {
    ...chatData,
    chatMessageHistory: [...chatData.chatMessageHistory, newChatMessage],
    last_updated_timestamp: Date.now(),
  };
}

function getCharacterPromptId(character: Character, participants: Character[]): string {
  const index = participants.findIndex(p => p.id === character.id);
  return index !== -1 ? `Character ${index + 1}` : 'Unknown';
}

function buildPromptFromHistory(chatData: ChatData, character: Character): string {
  const lines: string[] = [];

  const name = character.name
  const systemPrompt = character.systemPrompt
  const description = character.description

  if (chatData.instructions?.length) {
    const instructionBlock = chatData.instructions
      .map(i => `[Instruction: ${i.content}]`)
      .join('\n');
    lines.push(instructionBlock);
  }

  if (systemPrompt) lines.push(`[${name} System Prompt: ${systemPrompt}]`);
  if (description) lines.push(`[${name} Description: ${description}]`);

  const characterId = getCharacterPromptId(character, chatData.participants);

  const mappings = chatData.participants
    .map(p => {
      const id = getCharacterPromptId(p, chatData.participants);

      const isCurrentParticipant = id === characterId

      const nameRevealed = chatData.chatMessageHistory.some(
        m => m.character.id === p.id && m.isNameRevealed
      );
      const appearanceRevealed = chatData.chatMessageHistory.some(
        m => m.character.id === p.id && m.isAppearanceRevealed
      );
      const namePart = nameRevealed || isCurrentParticipant ? p.name : '[name unknown]';
      const appearancePart = appearanceRevealed || isCurrentParticipant
        ? '[appearance known]' 
        : '[appearance unknown]';
      return `${id} = ${namePart}, ${appearancePart}`;
    })
    .join('; ');
  lines.push(`[Identity Map: ${mappings}]`);

  for (const msg of chatData.chatMessageHistory) {
    const promptId = getCharacterPromptId(msg.character, chatData.participants);
    lines.push(`${promptId}: ${msg.textContent}`);
  }

  lines.push(`${characterId}:`);
  return lines.join('\n');
}

function convertIdsToDisplayNames(text: string, chatData: ChatData): string {
  let result = text;
  chatData.participants.forEach((p, i) => {
    const id = `Character ${i + 1}`;
    const everRevealed = chatData.chatMessageHistory.some(m => m.character.id === p.id && m.isNameRevealed);
    if (everRevealed) result = result.replace(new RegExp(`\\b${id}\\b`, 'g'), p.name);
  });
  return result;
}

async function getImageBase64(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`Failed to convert image to base64: ${imageUrl}`, error);
    return null;
  }
}

async function handleServerResponse(
  chatData: ChatData, 
  aiCharacter: Character, 
  abortController?: AbortController,
  onStreamUpdate?: (text: string) => void // Callback to update UI in real-time
): Promise<ChatData | null> {
  const sampler = aiCharacter.sampler;
  const params = sampler?.parameters ?? {};

  const stopPatterns = chatData.participants.flatMap(p => {
    const id = getCharacterPromptId(p, chatData.participants);
    return [`\n${id}:`, `\n${p.name}:`];
  });

  const stopSequences = [
    '<|end_of_turn|>',
    '<|start_of_turn|>',
    ...stopPatterns,
    ...(sampler?.stopPattern?.patterns ?? []),
  ];

  // ... [Image Data Logic remains exactly the same as your original code] ...
  let imageData: any = undefined;
  if (aiCharacter.image) {
    const imageUrl = `${characterImagesPath}/${aiCharacter.image}`;
    try {
      const imageBase64Data = await getImageBase64(imageUrl);
      if (imageBase64Data) {
        imageData = [{ data: imageBase64Data, id: 12 }];
      }
    } catch (err) {
      console.error("Failed to load image for multimodal input:", err);
    }
  }

  const prompt = buildPromptFromHistory(chatData, aiCharacter);

  try {
    const requestBody: any = {
      prompt,
      n_predict: sampler?.maxTokens ?? 512,
      stop: stopSequences,
      stream: true, // ⚠️ CRITICAL: Tell the backend to stream
      ...params,
    };

    if (imageData) {
      requestBody.image_data = imageData;
    }

    const response = await fetch('/api/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: abortController?.signal,
    });

    if (!response.ok) {
      if (abortController?.signal.aborted) return null;
      throw new Error(`API Error: ${response.status}`);
    }

    // ⚠️ CRITICAL: Handle Streaming Response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    
    let fullContent = "";
    let done = false;

    while (!done && reader) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        
        // Parse the chunk (Assuming standard SSE format: "data: {...}\n\n")
        // If your backend sends raw JSON lines, adjust parsing logic here.
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr.trim() === '[DONE]') break;
            
            try {
              const json = JSON.parse(jsonStr);
              // Adjust based on your backend's specific response structure
              const token = json.content || json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || "";
              
              if (token) {
                fullContent += token;
                
                // 🔥 Update the UI immediately with the accumulated text
                if (onStreamUpdate) {
                  onStreamUpdate(fullContent);
                }
              }
            } catch (e) {
              console.warn("Error parsing stream chunk", e);
            }
          }
        }
      }
    }

    // Final cleanup and state creation
    const displayText = convertIdsToDisplayNames(fullContent.trim(), chatData);
    const aiMessage = createChatMessage(chatData, aiCharacter, displayText);

    return addMessageToChatData(chatData, { ...aiMessage, kvCachePath: undefined }); // KV Cache usually not returned in streaming unless supported
    
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.log('Generation stopped by user');
      return null;
    }
    console.error("Error in handleAIResponse:", error);
    throw error;
  }
}

async function handleAllParticipantsResponseExceptTheProtagonist(
  chatData: ChatData, 
  abortController: AbortController,
  onSetSpeaker?: (character: Character | null) => void ,
  onStreamUpdate?: (text: string) => void // Add this argument
): Promise<ChatData> {
  
  let updatedChatData = chatData;
  
  const eligible = updatedChatData.participants.filter(
    p => p.id !== updatedChatData.protagonist.id && (p.chatProbability ?? 0.5) > 0
  );

  if (eligible.length === 0) return updatedChatData;

  const potentialSpeakers = eligible.filter(p => Math.random() < (p.chatProbability ?? 0.5));
  const speakersToProcess = potentialSpeakers.length === 0
    ? [eligible.reduce((best, p) =>
        (p.chatProbability ?? 0.5) > (best.chatProbability ?? 0.5) ? p : best
      )]
    : potentialSpeakers;

  const queue = [...speakersToProcess];
  const orderedResponders: Character[] = [];

  while (queue.length > 0) {
    const totalWeight = queue.reduce((sum, p) => sum + (p.initiativeWeight ?? 1), 0);
    let randomPoint = Math.random() * totalWeight;
    
    for (const character of queue) {
      const weight = character.initiativeWeight ?? 1;
      if (randomPoint < weight) {
        orderedResponders.push(character);
        queue.splice(queue.indexOf(character), 1);
        break;
      }
      randomPoint -= weight;
    }
  }

  for (const responder of orderedResponders) {
    if (abortController.signal.aborted) break; 

    if (onStreamUpdate && onSetSpeaker) {
      onSetSpeaker(responder);
    }
    
    // Pass the callback here
    const result = await handleServerResponse(updatedChatData, responder, abortController, onStreamUpdate);
    
    if (!result) break; 
    
    updatedChatData = result;
  }

  return updatedChatData;
}

function editChatMessage(chatData: ChatData, messageId: string, newText: string): ChatData {
  const editIndex = chatData.chatMessageHistory.findIndex(m => m.id === messageId);
  if (editIndex === -1) return chatData;

  const updatedHistory = chatData.chatMessageHistory.map((msg, idx) => {
    if (idx === editIndex) return { ...msg, textContent: newText, kvCachePath: undefined };
    if (idx > editIndex) return { ...msg, kvCachePath: undefined };
    return msg;
  });

  return { ...chatData, chatMessageHistory: updatedHistory, last_updated_timestamp: Date.now() };
}

function branchChatAtMessage(sourceChatData: ChatData, branchPointMessageId: string): ChatData {
  const branchIndex = sourceChatData.chatMessageHistory.findIndex(m => m.id === branchPointMessageId);
  if (branchIndex === -1) throw new Error('Branch point message not found');

  const currentTimestamp = Date.now();
  return {
    id: uuidv4(),
    title: `${sourceChatData.title} [#${branchIndex + 1}]`,
    protagonist: sourceChatData.protagonist,
    participants: sourceChatData.participants,
    chatMessageHistory: sourceChatData.chatMessageHistory.slice(0, branchIndex + 1),
    first_created_timestamp: currentTimestamp,
    last_updated_timestamp: currentTimestamp,
  };
}

function getCharacterAvatarUrl(character: Character): string | null {
  if (!character.image) return null;
  return `${characterImagesPath}/${character.image}`;
}

function getDelayedDisplayName(
  history: ChatMessage[], 
  currentIndex: number, 
  characterId: string, 
  participants: Character[]
): string {
  // ✅ SAFETY CHECK: If history is empty or index is out of bounds, fallback immediately
  if (!history || history.length === 0 || currentIndex < 0 || currentIndex >= history.length) {
    const index = participants.findIndex(p => p.id === characterId);
    return index !== -1 ? `Character ${index + 1}` : 'Unknown';
  }

  // Scan backwards from the current index to find the immediate predecessor
  // We start at currentIndex - 1 because we want to look at PREVIOUS messages
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (history[i].character.id === characterId) {
      // If the previous message had the name revealed, show the real name now
      if (history[i].isNameRevealed) {
        // ✅ SAFETY: Ensure current message exists before accessing .character
        if (history[currentIndex]) {
          return history[currentIndex].character.name;
        }
      }
      // Otherwise, fall through to show the ID
      break; 
    }
  }
  
  // Default: Show the generic ID if no previous reveal was found
  const index = participants.findIndex(p => p.id === characterId);
  return index !== -1 ? `Character ${index + 1}` : 'Unknown';
}

function App() {
  const [chatData, setChatData] = useState<ChatData | null>(null);
  const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
  const [inputText, setInputText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [generatingMessageId, setGeneratingMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [massDeleteStartId, setMassDeleteStartId] = useState<string | null>(null);
  const fileInputReference = React.useRef<HTMLInputElement>(null);
  const messageEndReference = React.useRef<HTMLDivElement>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const [streamingCharacter, setStreamingCharacter] = useState<Character | null>(null);
  const [streamingText, setStreamingText] = useState<string>("");
  const [isInitialImageProcessed, setIsInitialImageProcessed] = useState(false);

  const processProtagonistImageSilently = async (currentChatData: ChatData, character: Character) => {
    if (!character.image) {
      setIsInitialImageProcessed(true);
      return;
    }

    const sampler = character.sampler

    const silentCharacter: Character = {
      ...character,
      sampler: {
        ...sampler,
        id: sampler?.id || uuidv4(),
        name: sampler?.name || 'silent',
        maxTokens: 0,
        parameters: { ...sampler?.parameters, n_predict: 0 }
      }
    };

    try {
      const silentController = new AbortController();
      
      await handleServerResponse(
        currentChatData, 
        silentCharacter, 
        silentController, 
        undefined // onStreamUpdate: undefined ensures no text appears in UI
      );

      setIsInitialImageProcessed(true);
    } catch (error) {
      console.warn("Silent image processing failed (non-critical):", error);
      setIsInitialImageProcessed(true);
    }
  };

  React.useEffect(() => {
    if (!chatData || !currentCharacter) {
      listChatIds().then(async (ids) => {
        if (ids.length > 0) {
          const loaded = await loadChatData(ids[0]);
          if (loaded) {
            setChatData(loaded);
            setCurrentCharacter(loaded.protagonist);
          }
        }
      });
    }
    messageEndReference.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatData?.chatMessageHistory.length, editingMessageId]);

  React.useEffect(() => {

    const initializeSession = async () => {
      // 1. If we already have chat data and haven't processed the image yet, process it.
      if (chatData && currentCharacter && !isInitialImageProcessed) {
        await processProtagonistImageSilently(chatData, currentCharacter);
        return;
      }

      // 2. If we don't have chat data yet, try to load it.
      if (!chatData || !currentCharacter) {
        const ids = await listChatIds();
        if (ids.length > 0) {
          const loaded = await loadChatData(ids[0]);
          if (loaded) {
            setChatData(loaded);
            setCurrentCharacter(loaded.protagonist);
            // Note: We do NOT call processProtagonistImageSilently here directly.
            // Setting the state will trigger a re-render, which will run this effect again.
            // On the next run, condition #1 will catch it and process the image.
            // This prevents state update conflicts during the initial load.
          } else {
            // No chat found, mark as processed so we don't keep trying
            setIsInitialImageProcessed(true);
          }
        } else {
          // No chats exist at all, mark as processed
          setIsInitialImageProcessed(true);
        }
      }
    };

    initializeSession();

    if (isLoading && streamingText && messageEndReference.current) {
      messageEndReference.current.scrollIntoView({ behavior: 'auto' }); // 'auto' is instant/snappy for typing
    }
  }, [streamingText, isLoading]);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const files = e.target.files;
    if (files) {
      setPendingFiles(prev => [...prev, ...Array.from(files)]);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const onStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setGeneratingMessageId(null);
  };

  const onProtagonistSendMessage = async () => {
    if (!inputText.trim() || !currentCharacter || !chatData || isLoading) return;

    abortControllerRef.current = new AbortController();
    
    // 1. Create User Message
    const protagonistChatMessage = createChatMessage(chatData, chatData.protagonist, inputText);
    const chatDataWithUserMessage = addMessageToChatData(chatData, protagonistChatMessage);
    
    setChatData(chatDataWithUserMessage);
    setInputText('');
    setPendingFiles([]);
    setIsLoading(true);
    setGeneratingMessageId(null);
    setStreamingText(""); // Reset streaming buffer

    try {
      // 2. Define how to update the UI when a chunk arrives

      // 3. Run generation with the callback
      // Note: We don't await the full result immediately for UI updates, 
      // but we still await the function to manage the loading state correctly.
      const updatedChatData = await handleAllParticipantsResponseExceptTheProtagonist(
        chatDataWithUserMessage, 
        abortControllerRef.current,
        setStreamingCharacter,
        setStreamingText // Pass the updater down
      );
      
      if (!abortControllerRef.current?.signal.aborted) {
        await saveChatData(updatedChatData);
        setChatData(updatedChatData);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('AI response failed:', error);
      }
    } finally {
      setIsLoading(false);
      setGeneratingMessageId(null);
      setStreamingText("");
      setStreamingCharacter(null);
      abortControllerRef.current = null;
    }
  };

  const onRegenerateLastAIMessage = async () => {
    if (!chatData || isLoading) return;

    const history = chatData.chatMessageHistory;
    
    // Find the boundary: first AI message in the trailing block
    let trimIndex = history.length;
    while (trimIndex > 0 && history[trimIndex - 1].character.id !== chatData.protagonist.id) {
      trimIndex--;
    }
    
    // Safety: don't regenerate if there are no AI messages or we're already at the end.
    if (trimIndex === 0 || trimIndex === history.length) return;
    
    // Get the original responders in their exact order
    const originalResponders = history
      .slice(trimIndex)
      .map(m => m.character)
      .filter((char, i, arr) => arr.findIndex(c => c.id === char.id) === i); // Deduplicate.
    
    const trimmedChatData: ChatData = {
      ...chatData,
      chatMessageHistory: history.slice(0, trimIndex),
      last_updated_timestamp: Date.now(),
    };
    
    // 1. Prepare State for Streaming
    setChatData(trimmedChatData);
    setIsLoading(true);
    setStreamingText(""); 
    setStreamingCharacter(null); // Will be set by the first responder
    
    // 2. Create Abort Controller
    abortControllerRef.current = new AbortController();

    try {
      let regeneratedChatData = trimmedChatData;
      
      // Define Stream Handlers (Same as SendMessage)

      // 3. Re-generate each responder sequentially WITH streaming
      for (const responder of originalResponders) {
        if (abortControllerRef.current?.signal.aborted) break;

        setStreamingCharacter(responder);
        
        // 👇 PASS THE CALLBACKS HERE
        const result = await handleServerResponse(
          regeneratedChatData, 
          responder, 
          abortControllerRef.current, 
          setStreamingText // Use the generic updater
        );
        
        if (!result) break; 
        regeneratedChatData = result;
      }
      
      if (!abortControllerRef.current?.signal.aborted) {
        await saveChatData(regeneratedChatData);
        setChatData(regeneratedChatData);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Regeneration failed:', error);
      }
    } finally {
      // 4. Cleanup State
      setIsLoading(false);
      setGeneratingMessageId(null);
      setStreamingText("");
      setStreamingCharacter(null);
      abortControllerRef.current = null;
    }
  };

  const onRegenerateLastProtagonistMessage = async () => {
    if (!chatData || isLoading) return;

    const history = chatData.chatMessageHistory;
    
    // Find the boundary: first AI message in the trailing block
    let trimIndex = history.length;
    while (trimIndex > 0 && history[trimIndex - 1].character.id !== chatData.protagonist.id) {
      trimIndex--;
    }
    
    // Safety: don't regenerate if there are no AI messages or we're already at the end.
    if (trimIndex === 0 || trimIndex === history.length) return;
    
    // Get the original responders in their exact order
    const originalResponders = history
      .slice(trimIndex)
      .map(m => m.character)
      .filter((char, i, arr) => arr.findIndex(c => c.id === char.id) === i); // Deduplicate.
    
    const trimmedChatData: ChatData = {
      ...chatData,
      chatMessageHistory: history.slice(0, trimIndex),
      last_updated_timestamp: Date.now(),
    };
    
    // 1. Prepare State for Streaming
    setChatData(trimmedChatData);
    setIsLoading(true);
    setStreamingText(""); 
    setStreamingCharacter(null); // Will be set by the first responder
    
    // 2. Create Abort Controller
    abortControllerRef.current = new AbortController();

    try {
      let regeneratedChatData = trimmedChatData;
      
      // Define Stream Handlers (Same as SendMessage)

      // 3. Re-generate each responder sequentially WITH streaming
      for (const responder of originalResponders) {
        if (abortControllerRef.current?.signal.aborted) break;

        setStreamingCharacter(responder);
        
        // 👇 PASS THE CALLBACKS HERE
        const result = await handleServerResponse(
          regeneratedChatData, 
          responder, 
          abortControllerRef.current, 
          setStreamingText // Use the generic updater
        );
        
        if (!result) break; 
        regeneratedChatData = result;
      }
      
      if (!abortControllerRef.current?.signal.aborted) {
        await saveChatData(regeneratedChatData);
        setChatData(regeneratedChatData);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Regeneration failed:', error);
      }
    } finally {
      // 4. Cleanup State
      setIsLoading(false);
      setGeneratingMessageId(null);
      setStreamingText("");
      setStreamingCharacter(null);
      abortControllerRef.current = null;
    }
  };

  const onStartEdit = (messageId: string, currentText: string) => {
    if (isLoading) return;
    setEditingMessageId(messageId);
    setEditDraft(currentText);
  };

  const onSaveEdit = async () => {
    if (!chatData || !editingMessageId) return;
    const updatedChatData = editChatMessage(chatData, editingMessageId, editDraft);
    setChatData(updatedChatData);
    await saveChatData(updatedChatData);
    setEditingMessageId(null);
    setEditDraft('');
  };

  const onCancelEdit = () => {
    setEditingMessageId(null);
    setEditDraft('');
  };

  const onDeleteMessage = async (messageId: string) => {
    if (!chatData || isLoading) return;
    
    // Prevent deleting while generating if it's the current message being written.
    if (generatingMessageId === messageId) {
      onStopGeneration();
    }

    const updatedHistory = chatData.chatMessageHistory.filter(m => m.id !== messageId);
    
    // Invalidate KV caches for all subsequent messages since context changed.
    const finalHistory = updatedHistory.map((msg) => {
      const originalIndex = chatData.chatMessageHistory.findIndex(m => m.id === msg.id);
      // If this message originally came after the deleted one, clear its cache.
      if (originalIndex > chatData.chatMessageHistory.findIndex(m => m.id === messageId)) {
        return { ...msg, kvCachePath: undefined };
      }
      return msg;
    });

    const updatedChatData: ChatData = {
      ...chatData,
      chatMessageHistory: finalHistory,
      last_updated_timestamp: Date.now(),
    };

    setChatData(updatedChatData);
    await saveChatData(updatedChatData);
  };

  const onStartMassDelete = (messageId: string) => {
    if (isLoading) return;
    // If clicking the same message again, cancel the operation
    if (massDeleteStartId === messageId) {
      setMassDeleteStartId(null);
    } else {
      setMassDeleteStartId(messageId);
    }
  };

  const onConfirmMassDelete = async () => {
    if (!chatData || !massDeleteStartId || isLoading) return;

    const startIndex = chatData.chatMessageHistory.findIndex(
      m => m.id === massDeleteStartId
    );

    if (startIndex === -1) {
      setMassDeleteStartId(null);
      return;
    }

    // Stop generation if it's happening in the range being deleted.
    if (generatingMessageId) {
      onStopGeneration();
    }

    // Keep messages FROM index 0 UP TO (but not including) startIndex? 
    // OR keep UP TO AND INCLUDING startIndex?
    // Usually "Delete from X to end" means X is also deleted.
    // So we keep 0 to startIndex.
    
    const updatedHistory = chatData.chatMessageHistory.slice(0, startIndex);

    const updatedChatData: ChatData = {
      ...chatData,
      chatMessageHistory: updatedHistory,
      last_updated_timestamp: Date.now(),
    };

    setChatData(updatedChatData);
    await saveChatData(updatedChatData);
    
    // Reset state.
    setMassDeleteStartId(null);
  };

  const onCancelMassDelete = () => {
    setMassDeleteStartId(null);
  };

  const onBranchAtMessage = async (messageId: string) => {
    if (!chatData) return;
    const branchedChatData = branchChatAtMessage(chatData, messageId);
    await saveChatData(branchedChatData);
    window.open(window.location.href, '_blank');
  };

  if (!chatData || !currentCharacter) {
    return <div className="loading-screen">Loading chat session...</div>;
  }

  return (
    <div className="chat-container">
      <div className="chat-history">
        {chatData.chatMessageHistory.map((msg, index) => {
          const currentCharacterId = currentCharacter.id;
          const isProtagonist = msg.character.id === currentCharacterId;

          const displayText = msg.textContent;

          const displayName = getDelayedDisplayName(chatData.chatMessageHistory, index, msg.character.id, chatData.participants);
          
          // Image logic
          const avatarUrl = !isProtagonist ? getCharacterAvatarUrl(msg.character) : null;
          
          const aiParticipantIds = new Set(
            chatData.participants.filter(p => p.id !== chatData.protagonist.id).map(p => p.id)
          );
          
          const isLastAIMessage = !isProtagonist && 
            !chatData.chatMessageHistory.slice(index + 1).some(m => aiParticipantIds.has(m.character.id));

          const isLastProtagonistMessage = isProtagonist 
            
          const isEditing = editingMessageId === msg.id;

          const isMassDeleteActive = massDeleteStartId !== null;
          const isMassDeleteStart = msg.id === massDeleteStartId;
          const msgIndex = index; 
          const startIndex = isMassDeleteActive 
            ? chatData.chatMessageHistory.findIndex(m => m.id === massDeleteStartId) 
            : -1;
          const isInDeletionRange = isMassDeleteActive && startIndex !== -1 && msgIndex >= startIndex;

          return (
            <div key={msg.id} className={`message-row ${isProtagonist ? 'message-right' : 'message-left'}`}>
              {/* Avatar Column */}
              {!isProtagonist && (
                <div className="avatar-column">
                  {avatarUrl ? (
                    <img 
                      src={avatarUrl} 
                      alt={displayName} 
                      className="character-avatar" 
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div className="character-avatar placeholder" /> 
                  )}
                  <span className="avatar-name">{displayName}</span>
                </div>
              )}

              <div className={`message-bubble ${isProtagonist ? 'bubble-user' : 'bubble-ai'} ${isEditing ? 'bubble-editing' : ''}`}>
                {isEditing ? (
                  <div className="edit-mode">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(); }
                        if (e.key === 'Escape') onCancelEdit();
                      }}
                      className="edit-textarea"
                      rows={Math.max(3, editDraft.split('\n').length)}
                    />
                    <div className="edit-actions">
                      <button type="button" onClick={onCancelEdit} className="edit-btn edit-btn-cancel">Cancel</button>
                      <button type="button" onClick={onSaveEdit} className="edit-btn edit-btn-save">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="message-text">{displayText}</span>
                    
                    <div className="message-toolbar">
                      {/* Hide standard tools if we are in mass delete mode to avoid confusion, or keep them */}
                      {!isMassDeleteActive ? (
                        <>
                          <button type="button" onClick={() => onStartEdit(msg.id, msg.textContent)} title="Edit" className="toolbar-btn">✎</button>
                          {isLastAIMessage && (
                            <button type="button" onClick={onRegenerateLastAIMessage} title="Regenerate" className="toolbar-btn">↻</button>
                          ) || isLastProtagonistMessage && (
                            <button type="button" onClick={onRegenerateLastProtagonistMessage} title="Regenerate" className="toolbar-btn">↻</button>
                          )
                          
                          }
                          <button type="button" onClick={() => onBranchAtMessage(msg.id)} title="Branch" className="toolbar-btn">⑂</button>

                          <button 
                            type="button"
                            onClick={() => onDeleteMessage(msg.id)} 
                            title="Delete only this message" 
                            className="toolbar-btn delete-btn"
                            style={{ color: '#ff4444' }}
                          >
                            🗑
                          </button>
                          
                          <button 
                            type="button"
                            onClick={() => onStartMassDelete(msg.id)} 
                            title="Delete this and all following messages" 
                            className="toolbar-btn mass-delete-btn"
                            style={{ color: '#ff9900' }} // Orange to distinguish from single delete
                          >
                            🗑️↓
                          </button>

                        </>
                      ) : (
                        isMassDeleteStart ? (
                          <div className="mass-delete-confirm-bar">
                            <span style={{fontSize: '0.8em', marginRight: '5px'}}>Delete from here to end?</span>
                            <button type="button" onClick={onConfirmMassDelete} className="toolbar-btn" style={{backgroundColor: '#ff4444', color: 'white'}}>Confirm</button>
                            <button type="button" onClick={onCancelMassDelete} className="toolbar-btn" style={{backgroundColor: '#ccc'}}>Cancel</button>
                          </div>
                        ) : isInDeletionRange ? (
                          <span className="deleted-preview-label">Will be deleted</span>
                        ) : null
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && streamingCharacter && streamingText && (
          <div className="message-row message-left">
            <div className="avatar-column">
              {streamingCharacter.image ? (
                <img 
                  src={`${characterImagesPath}/${streamingCharacter.image}`} 
                  alt={streamingCharacter.name} 
                  className="character-avatar" 
                />
              ) : (
                <div className="character-avatar placeholder" /> 
              )}
              <span className="avatar-name">
                {(() => {
                  // Try to get the delayed name based on history
                  // We pass history.length - 1 because the streaming message isn't in history yet
                  const safeIndex = chatData.chatMessageHistory.length > 0 ? chatData.chatMessageHistory.length - 1 : 0;
                  
                  return getDelayedDisplayName(
                    chatData.chatMessageHistory, 
                    safeIndex, 
                    streamingCharacter.id, 
                    chatData.participants
                  );
                })()}
              </span>
            </div>
            
            <div className="message-bubble bubble-ai">
              <span className="message-text">{streamingText}</span>
              <span className="cursor-blink">▋</span>
            </div>
          </div>
        )}
        <div ref={messageEndReference} style={{ height: '1px' }} />
      </div>

      <div className="input-wrapper">
        {pendingFiles.length > 0 && (
          <div className="attachment-strip">
            {pendingFiles.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="attachment-chip">
                <span className="attachment-name" title={file.name}>
                  {file.name}
                </span>
                <span className="attachment-size">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removePendingFile(idx)}
                  className="attachment-remove"
                  title="Remove"
                >×</button>
              </div>
            ))}
          </div>
        )}
        <div className="input-area">
          <button
            type="button"
            onClick={() => fileInputReference.current?.click()}
            disabled={isLoading}
            className="attach-button toolbar-btn"
            title="Attach file"
          >📎</button>
          <input
            ref={fileInputReference}
            type="file"
            multiple
            onChange={onFileSelected}
            className="file-input-hidden"
          />
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!isLoading) onProtagonistSendMessage();
              }
            }}
            placeholder={`Message as ${currentCharacter.name}...`}
            rows={3}
            className="chat-input"
          />
          <button
            type="button"
            onClick={isLoading ? onStopGeneration : onProtagonistSendMessage}
            disabled={!isLoading && (!inputText.trim() && pendingFiles.length === 0)}
            className={"send-button counter"}
            title={isLoading ? "Stop Generating" : "Send Message"}
          >
            {isLoading ? '⏹ Stop' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App