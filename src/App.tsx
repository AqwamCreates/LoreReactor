import React from 'react'
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid';
import type {StopPattern, Sampler, Instruction, Character, ChatMessage, ChatData} from "./types"
import {detectName} from "./nameDetection"
import {saveChatData, getCharacterImageUrl, loadAllChatData, loadSampler} from "./storage"
import './App.css'

const sampler = loadSampler("UniversalCharacterCognition") as Sampler;

function convertSamplerForAPI(sampler: Sampler): any {



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
  const previousMessage = findPreviousChatMessage(chatMessageHistory, characterId);
  const isNamePreviouslyRevealed = previousMessage ? previousMessage.isNameRevealed : false;
  const isNameRevealed = isNamePreviouslyRevealed || detectName(chatMessageHistory, characterId, characterName, textContent)
  const hasChatData = chatMessageHistory.length > 0;
  const parentMessageId = hasChatData ? chatMessageHistory[chatMessageHistory.length - 1].id : null;

  const remainingChatStamina = previousMessage?.remainingChatStamina || character.maximumChatStamina || Number.POSITIVE_INFINITY

  return {
    id: uuidv4(),
    character: { ...character },
    textContent,
    remainingChatStamina,
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

function getFatigueInstruction(character: Character, currentChatStamina: number, maximumChatStamina: number): string {
  if (maximumChatStamina === Number.POSITIVE_INFINITY) return ""; // Gods don't get tired

  const ratio = currentChatStamina / maximumChatStamina;

  if (ratio > 0.7) {
    return ""; // Full energy, no instruction needed
  }if (ratio > 0.4) {
    return "[System Note: You are starting to feel slightly winded. Keep your responses concise and focused. Don't ramble.]";
  }if (ratio > 0.1) {
    return "[System Note: You are quite exhausted. Your speech should be halting, brief, or you might suggest someone else take over. Avoid long monologues.]";
  }
    // Critical fatigue (0-10%)
  return "[System Note: You are completely drained. You barely have the energy to speak. If you must reply, make it a whisper, a grunt, or defer entirely to another character. Do not initiate new topics.]";
}

function buildPromptFromHistory(chatData: ChatData, character: Character): string {
  const lines: string[] = [];

  const name = character.name
  const systemPrompt = character.systemPrompt
  const description = character.description
  const maximumChatStamina = character.maximumChatStamina ?? Number.POSITIVE_INFINITY;

  const characterId = getCharacterPromptId(character, chatData.participants);

  if (chatData.instructions?.length) {
    const instructionBlock = chatData.instructions
      .map(i => `[Instruction: ${i.content}]`)
      .join('\n');
    lines.push(instructionBlock);
  }

  if (systemPrompt) lines.push(`[${name} System Prompt: ${systemPrompt}]`);
  if (description) lines.push(`[${name} Description: ${description}]`);

  const previousMessage = findPreviousChatMessage(chatData.chatMessageHistory, characterId);
  const currentChatStamina = previousMessage?.remainingChatStamina ?? maximumChatStamina;

  if (currentChatStamina !== undefined && maximumChatStamina !== Number.POSITIVE_INFINITY) {
    const fatigueInstruction = getFatigueInstruction(character, currentChatStamina, maximumChatStamina);
    if (fatigueInstruction) {lines.push(fatigueInstruction);}
  }

  lines.push(`[Continue the conversation as ${characterId} / ${name}. Stay in character at all costs and at all times.]`);

  const mappings = chatData.participants
    .map(p => {
      const id = getCharacterPromptId(p, chatData.participants);

      const isCurrentParticipant = id === characterId

      const nameRevealed = chatData.chatMessageHistory.some(
        m => m.character.id === p.id && m.isNameRevealed
      );
      const namePart = nameRevealed || isCurrentParticipant ? p.name : '[name unknown]';
      return `${id} = ${namePart}`;
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
): Promise<ChatData | null | undefined> {
  const sampler = aiCharacter.sampler;
  const params = sampler?.parameters ?? sampler?.parameters;

  const stopPatterns = chatData.participants.flatMap(p => {
    const id = getCharacterPromptId(p, chatData.participants);
    return [`\n${id}:`, `\n${p.name}:`];
  });

  const stopSequences = [
    '<|end_of_turn|>',
    '<|start_of_turn|>',
    ...stopPatterns,
    ...(sampler?.stopPatterns?.map((sp: StopPattern) => sp.pattern) ?? []),
  ];

  let imageData: any = undefined;
  const aiCharacterImage = aiCharacter.image;
  if (aiCharacterImage) {
    const imageUrl = getCharacterImageUrl(aiCharacterImage);

    if (imageUrl){
      try {
            const imageBase64Data = await getImageBase64(imageUrl);
            if (imageBase64Data) {
              imageData = [{ data: imageBase64Data, id: 12 }];
            }
      } catch (err) {
          console.error("Failed to load image for multimodal input:", err);
      }
    } 
  }

  const prompt = buildPromptFromHistory(chatData, aiCharacter);

  try {
    const requestBody: any = {
      prompt,
      n_predict: sampler?.maximumNumberOfTokens ?? 512,
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
      return null;
    }
    console.error("Error in handleAIResponse:", error);
  }
}

async function respondToMessages(
  chatData: ChatData, 
  aiCharacter: Character, 
  abortController?: AbortController,
  onStreamUpdate?: (text: string) => void
): Promise<ChatData | null | undefined> {
  // This function remains purely responsible for hitting the API and returning ONE new message appended to ChatData.
  const sampler = aiCharacter.sampler;
  const params = sampler?.parameters ?? sampler?.parameters;

  const stopPatterns = chatData.participants.flatMap(p => {
    const id = getCharacterPromptId(p, chatData.participants);
    return [`\n${id}:`, `\n${p.name}:`];
  });

  const stopSequences = [
    '<|end_of_turn|>',
    '<|start_of_turn|>',
    ...stopPatterns,
    ...(sampler?.stopPatterns?.map((sp: StopPattern) => sp.pattern) ?? []),
  ];

  let imageData: any = undefined;
  if (aiCharacter.image) {
    const imageUrl = getCharacterImageUrl(aiCharacter.image);
    if (imageUrl) {
      try {
        const imageBase64Data = await getImageBase64(imageUrl);
        if (imageBase64Data) imageData = [{ data: imageBase64Data, id: 12 }];
      } catch (err) {
        console.error("Failed to load image:", err);
      }
    }
  }

  const prompt = buildPromptFromHistory(chatData, aiCharacter);

  try {
    const requestBody: any = {
      prompt,
      n_predict: sampler?.maximumNumberOfTokens ?? 512,
      stop: stopSequences,
      stream: true,
      ...params,
    };
    if (imageData) requestBody.image_data = imageData;

    const response = await fetch('/api/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: abortController?.signal,
    });

    if (!response.ok) {
      if (abortController?.signal.aborted) return null;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullContent = "";
    let done = false;

    while (!done && reader) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr.trim() === '[DONE]') break;
            try {
              const json = JSON.parse(jsonStr);
              const token = json.content || json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || "";
              if (token) {
                fullContent += token;
                if (onStreamUpdate) onStreamUpdate(fullContent);
              }
            } catch (e) {
              console.warn("Parse error", e);
            }
          }
        }
      }
    }

    const displayText = convertIdsToDisplayNames(fullContent.trim(), chatData);
    const newMessage = createChatMessage(chatData, aiCharacter, displayText);
    
    return addMessageToChatData(chatData, { ...newMessage, kvCachePath: undefined });

  } catch (error) {
    if ((error as Error).name === 'AbortError') return null;
    console.error("Response generation failed:", error);
  }
}

async function startRecursiveAIChat(
  chatData: ChatData, 
  abortController: AbortController,
  onSetSpeaker?: (character: Character | null) => void,
  onStreamUpdate?: (text: string) => void
): Promise<ChatData> {
  
  const protagonist = chatData.protagonist;
  const participants = chatData.participants;
  const chatMessageHistory = chatData.chatMessageHistory;

  // 1. Calculate Current Stamina
  const remainingChatStaminaArray: Record<string, number> = {};
  
  for (const participant of participants) {
    if (participant.id === protagonist.id) continue;

    const characterId = participant.id;
    const previousChatMessage = findPreviousChatMessage(chatMessageHistory, characterId);
    
    // Safe fallback if maximumChatStamina is undefined
    const maxStamina = participant.maximumChatStamina ?? Number.POSITIVE_INFINITY;
    const remainingChatStamina = previousChatMessage?.remainingChatStamina ?? maxStamina;
    
    remainingChatStaminaArray[characterId] = remainingChatStamina;
  }

  // 2. Filter Eligible
  const eligibleParticipants = participants.filter(participant => 
    participant.id !== protagonist.id && 
    remainingChatStaminaArray[participant.id] > 0
  );

  const nonEligibleParticipants = participants.filter(participant => 
    participant.id !== protagonist.id && 
    remainingChatStaminaArray[participant.id] <= 0
  );

  for (const participant of nonEligibleParticipants) {
    const characterId = participant.id;
    const remainingStamina = remainingChatStaminaArray[characterId];
    const maximumChatStamina = participant.maximumChatStamina ?? Number.POSITIVE_INFINITY;
    remainingChatStaminaArray[characterId] = Math.min(maximumChatStamina, remainingStamina + 1);
    const previousChatMessage = findPreviousChatMessage(chatMessageHistory, characterId);
    if (previousChatMessage) {
      previousChatMessage.remainingChatStamina = remainingChatStaminaArray[characterId];
    }
  }

  if (eligibleParticipants.length === 0) {
    return chatData;
  }

  // 3. Sort by Initiative
  const sortedParticipants = [...eligibleParticipants].sort((a, b) => {
    const characterIdA = a.id;
    const characterIdB = b.id;

    // 1. Get Base Weights
    const baseWeightA = a.initiativeWeight ?? 1;
    const baseWeightB = b.initiativeWeight ?? 1;

    // 2. Get Stamina Stats
    const currentStaminaA = remainingChatStaminaArray[characterIdA];
    const maxStaminaA = a.maximumChatStamina ?? currentStaminaA; // Fallback if undefined
    
    const currentStaminaB = remainingChatStaminaArray[characterIdB];
    const maxStaminaB = b.maximumChatStamina ?? currentStaminaB;

    // 3. Calculate FATIGUE FACTOR (0.0 to 1.0)
    // If maxStamina is Infinity, factor is 1.0 (never gets tired)
    const fatigueFactorA = maxStaminaA === Number.POSITIVE_INFINITY ? 1 : Math.max(0, currentStaminaA / maxStaminaA);
    const fatigueFactorB = maxStaminaB === Number.POSITIVE_INFINITY ? 1 : Math.max(0, currentStaminaB / maxStaminaB);

    // 4. Calculate EFFECTIVE WEIGHT
    const effectiveWeightA = baseWeightA * fatigueFactorA;
    const effectiveWeightB = baseWeightB * fatigueFactorB;

    // 5. Sort Descending (Highest Effective Weight first)
    return effectiveWeightB - effectiveWeightA;
  });

  let hasAParticipantTalked = false;
  
  // We will build the NEW history array incrementally.
  let currentHistory = [...chatMessageHistory]; 

  for (const participant of sortedParticipants) {
    if (abortController.signal.aborted) break;

    const characterId = participant.id;
    const maximumChatStamina = participant.maximumChatStamina ?? Number.POSITIVE_INFINITY;
    const currentStamina = remainingChatStaminaArray[characterId];

    // Check Stamina
    if (currentStamina <= 0) {
      remainingChatStaminaArray[characterId] = Math.min(maximumChatStamina, currentStamina + 1);
      continue;
    }

    // Probability Check
    const randomValue = Math.random();
    const chatProbability = participant.chatProbability ?? 0.5;

    if (randomValue >= chatProbability) {
      remainingChatStaminaArray[characterId] = Math.min(maximumChatStamina, currentStamina + 1);
      continue;
    }

    // --- GENERATE RESPONSE ---
    if (onSetSpeaker) onSetSpeaker(participant);

    // Create a temporary chatData object with the CURRENT history for the API call
    const tempChatDataForCall: ChatData = {
      ...chatData,
      chatMessageHistory: currentHistory,
      participants: participants // Ensure participants are passed correctly
    };

    const resultChatData = await respondToMessages(
      tempChatDataForCall, 
      participant, 
      abortController, 
      onStreamUpdate
    );

    if (!resultChatData) break;

    // Extract the NEW message from the result
    // resultChatData contains the old history + 1 new message
    const newMessage = resultChatData.chatMessageHistory[resultChatData.chatMessageHistory.length - 1];
    
    // Update Stamina
    const newStamina = currentStamina - 1;
    remainingChatStaminaArray[characterId] = newStamina;

    // Attach stamina to the message
    const messageWithStamina: ChatMessage = {
      ...newMessage,
      remainingChatStamina: newStamina
    };

    // UPDATE HISTORY IMMUTABLY
    currentHistory = [...currentHistory, messageWithStamina];
    
    hasAParticipantTalked = true;

    // BREAK after one speaker to recurse
    break; 
  }

  if (hasAParticipantTalked && !abortController.signal.aborted) {
    // Construct the FULL updated ChatData for the next recursion
    const nextIterationChatData: ChatData = {
      ...chatData,
      chatMessageHistory: currentHistory,
      last_updated_timestamp: Date.now()
    };
    
    // RECURSE
    return startRecursiveAIChat(nextIterationChatData, abortController, onSetSpeaker, onStreamUpdate);
  }

  // Return final state
  return {
    ...chatData,
    chatMessageHistory: currentHistory,
    last_updated_timestamp: Date.now()
  };
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

function getDelayedDisplayName(chatMessageHistory: ChatMessage[], chatMessageHistoryIndex: number, characterId: string, participants: Character[]): string {

  const chatMessageHistoryLength = chatMessageHistory.length

  if (!chatMessageHistory || chatMessageHistoryLength === 0 || chatMessageHistoryIndex < 0 || chatMessageHistoryIndex >= chatMessageHistoryLength) {
    const index = participants.findIndex(p => p.id === characterId);
    return index !== -1 ? `Character ${index + 1}` : 'Unknown';
  }

  // Scan backwards from the current index to find the immediate predecessor.
  // We start at currentIndex - 1 because we want to look at PREVIOUS messages.

  const targetChatMessage = chatMessageHistory[chatMessageHistoryIndex]

  for (let i = chatMessageHistoryIndex - 1; i >= 0; i--) {

    const chatMessage = chatMessageHistory[i]

    const character = chatMessage.character

    if (character.id === characterId) {
       // Be careful! This function are used by streaming LLMs, it will get the wrong message to get the names for if you choose the streaming message.
      if (chatMessage.isNameRevealed && targetChatMessage) {return character.name}
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
        maximumNumberOfTokens: 0,
        parameters: { ...sampler?.parameters, n_predict: 0 },
        stopPatterns: [],
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
      loadAllChatData().then(async (chatDataArray) => {
        if (chatDataArray.length > 0) {
          const chatData = chatDataArray[0];
          if (chatData) {
            setChatData(chatData);
            setCurrentCharacter(chatData.protagonist);
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
      if (!chatData || !currentCharacter) {
        const chatDataArray = await loadAllChatData();
        if (chatDataArray.length > 0) {
          const chatData = chatDataArray[0];
          if (chatData) {
            setChatData(chatData);
            setCurrentCharacter(chatData.protagonist);
          } else {
            setIsInitialImageProcessed(true);
          }
        } else {
          setIsInitialImageProcessed(true);
        }
      }
    };

    initializeSession();

    if (isLoading && streamingText && messageEndReference.current) {
      messageEndReference.current.scrollIntoView({ behavior: 'auto' }); // 'auto' is instant/snappy for typing
    }
  }, [streamingText, isLoading, chatData, currentCharacter, isInitialImageProcessed]);

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

      const updatedChatData = await startRecursiveAIChat(
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

    const oldMessages = history.slice(trimIndex);

    // 2. Delete Old Files First 🗑️
    try {
      const { deleteChatMessage } = await import("./storage");
      await Promise.all(oldMessages.map(msg => deleteChatMessage(msg.id)));
    } catch (err) {
      console.error("Failed to delete old regeneration files:", err);
    }
    
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

      // 3. Re-generate each responder sequentially WITH streaming
      for (const responder of originalResponders) {
        if (abortControllerRef.current?.signal.aborted) break;

        setStreamingCharacter(responder);
        
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

    const oldMessages = history.slice(trimIndex);

    try {
      const { deleteChatMessage } = await import("./storage");
      await Promise.all(oldMessages.map(msg => deleteChatMessage(msg.id)));
    } catch (err) {
      console.error("Failed to delete old regeneration files:", err);
    }
    
    // Get the original responders in their exact order
    
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

      const chatDataWithUserMessage = trimmedChatData

      const updatedChatData = await startRecursiveAIChat(
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

    try {
      await import("./storage").then(({ deleteChatMessage }) => deleteChatMessage(messageId));
    } catch (err) {
      console.error("Failed to delete message file:", err);
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
          const isNotAProtagonist = !isProtagonist

          const displayText = msg.textContent;

          const displayName = getDelayedDisplayName(chatData.chatMessageHistory, index, msg.character.id, chatData.participants);
          
          const characterImage = isNotAProtagonist ? getCharacterImageUrl(msg.character.image) : null;
          
          const aiParticipantIds = new Set(
            chatData.participants.filter(p => p.id !== chatData.protagonist.id).map(p => p.id)
          );
          
          const isLastAIMessage = isNotAProtagonist && 
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
                  {characterImage ? (
                    <img 
                      src={characterImage} 
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
                  src={`${getCharacterImageUrl(streamingCharacter.image)}`} 
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