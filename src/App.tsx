import React from 'react'
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid';
import type {Character, ChatMessage, ChatData} from "./types"
import {saveRawChatData, loadAllRawChatData, deleteRawChatMessage, getCharacterImageUrl} from "./storage"
import './App.css'
import { LargeLanguageModelInferenceEngine } from './LargeLanguageModelInferenceEngine';
import { runTurnSequence } from './ChatOrchestrator';
import { createChatMessage, prepareRequestBody, convertIdsToDisplayNames, addMessageToChatData } from './chatLogic';
import { deleteMessage, massDeleteMessages, editMessage, branchMessage } from './messageLogic';

const LLInferenceEngine = new LargeLanguageModelInferenceEngine();

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
  abortController: AbortController,
  onStreamUpdate?: (text: string) => void
): Promise<ChatData | null> {
  
  let imageData: string | null = null;
  if (aiCharacter.image) {
    const imageUrl = getCharacterImageUrl(aiCharacter.image);
    if (imageUrl) {
      try {
        imageData = await getImageBase64(imageUrl);
      } catch (err) {
        console.error("Failed to load image:", err);
      }
    }
  }

  const requestBody = prepareRequestBody(chatData, aiCharacter, imageData);

  try {
    const rawText = await LLInferenceEngine.generateStream(requestBody, abortController, {
      onToken: (fullText) => {if (onStreamUpdate) onStreamUpdate(fullText)}
    });

    const displayText = convertIdsToDisplayNames(rawText, chatData);
    const aiMessage = createChatMessage(chatData, aiCharacter, displayText);

    return addMessageToChatData(chatData, aiMessage);

  } catch (error) {
    if ((error as Error).name === 'AbortError') return null;
    console.error("Inference failed:", error);
    return null;
  }
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

  const processProtagonistImageSilently = async (chatData: ChatData, character: Character) => {

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
        chatData, 
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
      loadAllRawChatData().then(async (chatDataArray) => {
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
        const chatDataArray = await loadAllRawChatData();
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

      const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => {
        const tempController = new AbortController();
        signal.addEventListener('abort', () => tempController.abort());
        return await handleServerResponse(data, char, tempController, onToken);
      };

      const updatedChatData = await runTurnSequence(
        chatDataWithUserMessage,
        executor,
        abortControllerRef.current,
        setStreamingCharacter,
        setStreamingText // Pass the updater down
      );
      
      if (!abortControllerRef.current?.signal.aborted) {
        await saveRawChatData(updatedChatData);
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
      await Promise.all(oldMessages.map(message => deleteRawChatMessage(message.id)));
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
        await saveRawChatData(regeneratedChatData);
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
      await Promise.all(oldMessages.map(message => deleteRawChatMessage(message.id)));
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

      const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => {
        const tempController = new AbortController();
        signal.addEventListener('abort', () => tempController.abort());
        return await handleServerResponse(data, char, tempController, onToken);
      };

      const updatedChatData = await runTurnSequence(
        chatDataWithUserMessage, 
        executor,
        abortControllerRef.current,
        setStreamingCharacter,
        setStreamingText // Pass the updater down
      );
      
      if (!abortControllerRef.current?.signal.aborted) {
        await saveRawChatData(updatedChatData);
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
    try {
      const updatedChat = await editMessage(chatData, editingMessageId, editDraft);
      setChatData(updatedChat);
      setEditingMessageId(null);
      setEditDraft('');
    } catch (err) {
      console.error("Edit failed:", err);
    }
  };

  const onCancelEdit = () => {
    setEditingMessageId(null);
    setEditDraft('');
  };

  const onDeleteMessage = async (messageId: string) => {
    if (!chatData || isLoading) return;
    if (generatingMessageId === messageId) onStopGeneration();

    try {
      const updatedChat = await deleteMessage(chatData, messageId);
      setChatData(updatedChat);
    } catch (err) {
      console.error("Failed to delete message:", err);
    }
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
    const startIndex = chatData.chatMessageHistory.findIndex(m => m.id === massDeleteStartId);
    if (startIndex === -1) return;

    try {
      const updatedChat = await massDeleteMessages(chatData, startIndex);
      setChatData(updatedChat);
      setMassDeleteStartId(null);
    } catch (err) {
      console.error("Mass delete failed:", err);
    }
  };

  const onCancelMassDelete = () => {
    setMassDeleteStartId(null);
  };

  const onBranchAtMessage = async (messageId: string) => {
    if (!chatData) return;
    try {
      const branchedChat = await branchMessage(chatData, messageId);
      // Optional: Switch to the new branch or just open it
      await saveRawChatData(branchedChat); // Already saved inside service, but if you need to do something else...
      window.open(window.location.href, '_blank'); 
    } catch (err) {
      console.error("Branching failed:", err);
    }
  };

  if (!chatData || !currentCharacter) {
    return <div className="loading-screen">Loading chat session...</div>;
  }

  return (
    <div className="chat-container">
      <div className="chat-history">
        {chatData.chatMessageHistory.map((message, index) => {
          const currentCharacterId = currentCharacter.id;
          const isProtagonist = message.character.id === currentCharacterId;
          const isNotAProtagonist = !isProtagonist

          const displayText = message.textContent;

          const displayName = getDelayedDisplayName(chatData.chatMessageHistory, index, message.character.id, chatData.participants);
          
          const characterImage = isNotAProtagonist ? getCharacterImageUrl(message.character.image) : null;
          
          const aiParticipantIds = new Set(
            chatData.participants.filter(p => p.id !== chatData.protagonist.id).map(p => p.id)
          );
          
          const isLastAIMessage = isNotAProtagonist && 
            !chatData.chatMessageHistory.slice(index + 1).some(m => aiParticipantIds.has(m.character.id));

          const isLastProtagonistMessage = isProtagonist 
            
          const isEditing = editingMessageId === message.id;

          const isMassDeleteActive = massDeleteStartId !== null;
          const isMassDeleteStart = message.id === massDeleteStartId;
          const messageIndex = index; 
          const startIndex = isMassDeleteActive 
            ? chatData.chatMessageHistory.findIndex(m => m.id === massDeleteStartId) 
            : -1;
          const isInDeletionRange = isMassDeleteActive && startIndex !== -1 && messageIndex >= startIndex;

          return (
            <div key={message.id} className={`message-row ${isProtagonist ? 'message-right' : 'message-left'}`}>
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
                      {!isMassDeleteActive ? (
                        <>
                          <button type="button" onClick={() => onStartEdit(message.id, message.textContent)} title="Edit" className="toolbar-btn">✎</button>
                          {isLastAIMessage && (
                            <button type="button" onClick={onRegenerateLastAIMessage} title="Regenerate" className="toolbar-btn">↻</button>
                          ) || isLastProtagonistMessage && (
                            <button type="button" onClick={onRegenerateLastProtagonistMessage} title="Regenerate" className="toolbar-btn">↻</button>
                          )
                          
                          }
                          <button type="button" onClick={() => onBranchAtMessage(message.id)} title="Branch" className="toolbar-btn">⑂</button>

                          <button 
                            type="button"
                            onClick={() => onDeleteMessage(message.id)} 
                            title="Delete only this message" 
                            className="toolbar-btn delete-btn"
                            style={{ color: '#ff4444' }}
                          >
                            🗑
                          </button>
                          
                          <button 
                            type="button"
                            onClick={() => onStartMassDelete(message.id)} 
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