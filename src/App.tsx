import React from 'react'
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid';
import type {StopPattern, Sampler, Instruction, Character, ChatMessage, ChatData} from "./types"
import {detectName} from "./nameDetection"
import {loadChatData, saveChatData, getCharacterImageUrl, loadAllChatData} from "./storage"
import './App.css'

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
  const isAppearancePreviouslyRevealed = previousMessage ? previousMessage.isAppearanceRevealed : false;
  const isNamePreviouslyRevealed = previousMessage ? previousMessage.isNameRevealed : false;
  const isNameRevealed = isNamePreviouslyRevealed || detectName(chatMessageHistory, characterId, characterName, textContent)
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

function getDelayedDisplayName(chatMessageHistory: ChatMessage[], currentIndex: number, characterId: string, participants: Character[]): string {

  if (!chatMessageHistory || chatMessageHistory.length === 0 || currentIndex < 0 || currentIndex >= chatMessageHistory.length) {
    const index = participants.findIndex(p => p.id === characterId);
    return index !== -1 ? `Character ${index + 1}` : 'Unknown';
  }

  // Scan backwards from the current index to find the immediate predecessor.
  // We start at currentIndex - 1 because we want to look at PREVIOUS messages.
  for (let i = currentIndex - 1; i >= 0; i--) {

    const chatMessage = chatMessageHistory[i]

    const character = chatMessage.character

    if (character.id === characterId) {
      if (chatMessage.isNameRevealed) {
        // Be careful! This function are used by streaming LLMs, it will get the wrong message to get the names for if you choose the streaming message.
        if (chatMessageHistory[currentIndex]) {return character.name}
      }
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

      console.log(originalResponders)

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
          const isNotAProtagonist = !isProtagonist

          const displayText = msg.textContent;

          const displayName = getDelayedDisplayName(chatData.chatMessageHistory, index, msg.character.id, chatData.participants);

          console.log(displayName)
          
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