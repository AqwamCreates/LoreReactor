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
  new RegExp(`they call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`people call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`you may call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
];

const NAME_REVEAL_QUESTION_PATTERNS_LOWERCASE = [
  // 1. Explicit Name Questions.
  /\b(?:what|may\s+i\s+have)\s+(?:is|'s|be)?\s*(?:your|thy)\s+name\b/i,
  
  // 2. Identity Questions.
  /\bwho\s+(?:are|is)\s+(?:you|thy|thee)\b/i,
  
  // 3. "How to call/address" Generalization (Your original request).
  /\b(?:how|what).*?\b(?:call|address|refer\s+to)\s+(?:you|thy|thee)\b/i,
  
  // 4. THE MISSING PIECE: Reciprocal/Elliptical Questions.
  // Matches: "And you?", "And you are?", "And yourself?", "What about you?".
  /\b(?:and|so)\s+(?:you|yourself|what\s+about\s+you)\b/i,
  
  // 5. Direct "You are?" (Often used after a pause or as a prompt).
  /\b(?:you\s+are\??|and\s+who\s+are\s+you)\b/i
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
  initiativeWeight: number;
  chatProbability: number;
  sampler?: Sampler;
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
  const isAiAffirmation = lastMessage.character.id !== currentCharacterId && 
                          NAME_AFFIRMATION_PATTERNS.some(p => p.test(lastMessage.textContent));

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

  // System context for current speaker
  const characterEverRevealed = chatData.chatMessageHistory.some(
    m => m.character.id === character.id && m.isNameRevealed
  );
  const characterId = getCharacterPromptId(character, chatData.participants);
  const characterLabel = characterEverRevealed ? name : characterId;

  if (!characterEverRevealed) lines.push(`[${characterLabel} Identity: ${name}]`);
  if (systemPrompt) lines.push(`[${characterLabel} System Prompt: ${systemPrompt}]`);
  if (description) lines.push(`[${characterLabel} Description: ${description}]`);

  if (chatData.instructions?.length) {
    const instructionBlock = chatData.instructions
      .map(i => `[Instruction: ${i.content}]`)
      .join('\n');
    lines.push(instructionBlock);
  }

  const mappings = chatData.participants
    .map(p => {
      const id = getCharacterPromptId(p, chatData.participants);
      const nameRevealed = chatData.chatMessageHistory.some(
        m => m.character.id === p.id && m.isNameRevealed
      );
      const appearanceRevealed = chatData.chatMessageHistory.some(
        m => m.character.id === p.id && m.isAppearanceRevealed
      );
      const namePart = nameRevealed ? p.name : '[name unknown]';
      const appearancePart = appearanceRevealed 
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

async function handleAIResponse(chatData: ChatData, aiCharacter: Character, abortController?: AbortController): Promise<ChatData | null> {
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

  // ✅ PREPARE IMAGE DATA FOR LLAMA.CPP (mmproj)
  let imageData: any = undefined;

  if (aiCharacter.image) {
    const imageUrl = `${characterImagesPath}/${aiCharacter.image}`;
    
    try {
      // ✅ FIX: Added 'await' here to wait for the file reading to complete
      const imageBase64Data = await getImageBase64(imageUrl);
      
      if (imageBase64Data) {
        // llama.cpp server expects an array of objects with 'data' (base64 string)
        // Some versions also accept 'id' to cache the image, but 'data' is essential.
        imageData = [
          {
            data: imageBase64Data, 
            id: 12 // Optional: ID for caching if supported by your server version
          }
        ];
      }
    } catch (err) {
      console.error("Failed to load image for multimodal input:", err);
    }
  }

  const prompt = buildPromptFromHistory(chatData, aiCharacter);

  console.log(`${prompt}\n`);

  try {
    const requestBody: any = {
      prompt,
      n_predict: sampler?.maxTokens ?? 512,
      stop: stopSequences,
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
      const errorText = await response.text();
      console.error("LLM API Error:", errorText);
      throw new Error(`API Error: ${response.status}`);
    }

    const result = await response.json();
    
    const content = result.content || result.choices?.[0]?.text || "";
    
    const displayText = convertIdsToDisplayNames(content.trim(), chatData);
    const aiMessage = createChatMessage(chatData, aiCharacter, displayText);

    return addMessageToChatData(chatData, { ...aiMessage, kvCachePath: result.kv_cache_path });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.log('Generation stopped by user');
      return null;
    }
    console.error("Error in handleAIResponse:", error);
    throw error;
  }
}

async function handleAllParticipantsResponseExceptTheProtagonist(chatData: ChatData, abortController: AbortController): Promise<ChatData> {
  let updatedChatData = chatData;
  const eligible = updatedChatData.participants.filter(
    p => p.id !== updatedChatData.protagonist.id && (p.chatProbability ?? 0.5) > 0
  );
  if (eligible.length === 0) return updatedChatData;

  const responders = eligible.filter(p => Math.random() < (p.chatProbability ?? 0.5));
  if (responders.length === 0 && eligible.length > 0) {
    const highestProb = eligible.reduce((best, p) =>
      (p.chatProbability ?? 0.5) > (best.chatProbability ?? 0.5) ? p : best
    );
    responders.push(highestProb);
  }

  responders.sort((a, b) => (b.initiativeWeight ?? 1) - (a.initiativeWeight ?? 1));
  
  for (const responder of responders) {
    if (abortController.signal.aborted) break; 
    
    const result = await handleAIResponse(updatedChatData, responder, abortController);
    
    // If result is null (aborted), stop the loop.
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

function App() {
  const [chatData, setChatData] = useState<ChatData | null>(null);
  const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
  const [inputText, setInputText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [generatingMessageId, setGeneratingMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const fileInputReference = React.useRef<HTMLInputElement>(null);
  const messagesEndReference = React.useRef<HTMLDivElement>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

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
    messagesEndReference.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatData?.chatMessageHistory.length, editingMessageId]);

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setPendingFiles(prev => [...prev, ...Array.from(e.target.files!)]);
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

    // ✅ Initialize new AbortController
    abortControllerRef.current = new AbortController();
    
    const protagonistChatMessage = createChatMessage(chatData, chatData.protagonist, inputText);
    const chatDataWithUserMessage = addMessageToChatData(chatData, protagonistChatMessage);
    
    setChatData(chatDataWithUserMessage);
    setInputText('');
    setPendingFiles([]);
    setIsLoading(true);
    setGeneratingMessageId(null); // Reset until AI starts

    try {
      const updatedChatData = await handleAllParticipantsResponseExceptTheProtagonist(
        chatDataWithUserMessage, 
        abortControllerRef.current
      );
      
      // Only save and update if not aborted (updatedChatData might be partial or same as input if aborted immediately).
      if (!abortControllerRef.current?.signal.aborted) {
        await saveChatData(updatedChatData);
        setChatData(updatedChatData);
      } else {
        // If aborted, we might want to keep the partial state or revert depending on preference.
        // Here we just ensure the UI reflects the stop.
        setChatData(prev => prev ? { ...prev, last_updated_timestamp: Date.now() } : null);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('AI response failed:', error);
      }
    } finally {
      setIsLoading(false);
      setGeneratingMessageId(null);
      abortControllerRef.current = null;
    }
  };

  const onRegenerateLastAI = async () => {
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
    
    setChatData(trimmedChatData);
    setIsLoading(true);

    try {
      let regeneratedChatData = trimmedChatData;
      
      // Re-generate each responder sequentially with updated context.
      for (const responder of originalResponders) {
        if (abortControllerRef.current?.signal.aborted) break;
        const result = await handleAIResponse(regeneratedChatData, responder);
        if (!result) break;
        regeneratedChatData = result;
      }
      
      await saveChatData(regeneratedChatData);
      setChatData(regeneratedChatData);
    } catch (error) {
      console.error('Regeneration failed:', error);
    } finally {
      setIsLoading(false);
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
          const isProtagonist = msg.character.id === currentCharacter.id;
          
          // Name logic remains: Show ID if name not revealed, else Show Name.
          const displayName = msg.isNameRevealed
            ? msg.character.name
            : getCharacterPromptId(msg.character, chatData.participants);
          
          // Image logic: Always attempt to get the URL if the character has one.
          const avatarUrl = !isProtagonist ? getCharacterAvatarUrl(msg.character) : null;
          
          const aiParticipantIds = new Set(
            chatData.participants.filter(p => p.id !== chatData.protagonist.id).map(p => p.id)
          );
          const isLastAIMessage = !isProtagonist && 
            !chatData.chatMessageHistory.slice(index + 1).some(m => aiParticipantIds.has(m.character.id));
          const isEditing = editingMessageId === msg.id;

          return (
            <div key={msg.id} className={`message-row ${isProtagonist ? 'message-right' : 'message-left'}`}>
              {/* ✅ ALWAYS SHOW AVATAR COLUMN FOR NON-PROTAGONISTS IF IMAGE EXISTS */}
              {!isProtagonist && avatarUrl && (
                <div className="avatar-column">
                  <img 
                    src={avatarUrl} 
                    alt={displayName} 
                    className="character-avatar" 
                    onError={(e) => {
                      // Optional: Handle broken image links gracefully.
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <span className="avatar-name">{displayName}</span>
                </div>
              )}
              
              {/* Fallback if no image exists but you still want the column layout (Optional) */}
              {!isProtagonist && !avatarUrl && (
                <div className="avatar-column">
                  <div className="character-avatar placeholder" /> 
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
                    <span className="message-text">{msg.textContent}</span>
                    <div className="message-toolbar">
                      <button type="button" onClick={() => onStartEdit(msg.id, msg.textContent)} title="Edit" className="toolbar-btn">✎</button>
                      {isLastAIMessage && (
                        <button type="button" onClick={onRegenerateLastAI} title="Regenerate" className="toolbar-btn">↻</button>
                      )}
                      <button type="button" onClick={() => onBranchAtMessage(msg.id)} title="Branch" className="toolbar-btn">⑂</button>
                      <button 
                        type="button"
                        onClick={() => onDeleteMessage(msg.id)} 
                        title="Delete" 
                        className="toolbar-btn delete-btn"
                        style={{ color: '#ff4444' }}
                      >
                        🗑
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="message-row message-left">
            <div className="typing-indicator">The characters are responding...</div>
          </div>
        )}
        <div ref={messagesEndReference} style={{ height: '1px' }} />
      </div>

      <div className="input-wrapper">
        {/* ✅ Pending file previews */}
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

        {/* ✅ Input row: attach button + textarea + send */}
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
          {/* ✅ Dynamic Send / Stop Button */}
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