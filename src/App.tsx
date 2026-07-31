import React from 'react'
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'; 
import './App.css'

const userDataPath = `${import.meta.env.BASE_URL}user_data`;
const characterDataPath = `${userDataPath}/character_data`;
const characterImagesPath = `${userDataPath}/character_images`;
const samplerDataPath = `${userDataPath}/sampler_data`;
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
  const isAppearanceRevealed = isAppearancePreviouslyRevealed || !!previousMessage;
  const isNamePreviouslyRevealed = previousMessage ? previousMessage.isNameRevealed : false;
  const previousTextContent = previousMessage ? previousMessage.textContent : '';
  const isNameRevealed = isNamePreviouslyRevealed || detectNameReveal(previousTextContent, characterName);
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

function buildPromptFromHistory(chatData: ChatData, character: Character, triggerText: string): string {
  const lines: string[] = [];
  const characterEverRevealed = chatData.chatMessageHistory.some(
    m => m.character.id === character.id && m.isNameRevealed
  );
  const characterId = getCharacterPromptId(character, chatData.participants);
  const characterLabel = characterEverRevealed ? character.name : characterId;

  if (character.systemPrompt) lines.push(`[System: ${character.systemPrompt}]`);
  if (character.description) lines.push(`[${characterLabel} Info: ${character.description}]`);

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
    const everRevealed = chatData.chatMessageHistory.some(m => m.character.id === p.id && m.isNameRevealed);
    if (everRevealed) result = result.replace(new RegExp(`\\b${id}\\b`, 'g'), p.name);
  });
  return result;
}

async function handleAIResponse(chatData: ChatData, aiCharacter: Character, userText: string): Promise<ChatData> {
  const sampler = aiCharacter.sampler;
  const params = sampler?.parameters ?? {};
  const prompt = buildPromptFromHistory(chatData, aiCharacter, userText);

  const allParticipantStops = chatData.participants.flatMap(p => {
    const id = getCharacterPromptId(p, chatData.participants);
    return [`\n${id}:`, `\n${p.name}:`];
  });

  const stopSequences = [
    '<|end_of_turn|>',
    '<|start_of_turn|>',
    ...allParticipantStops,
    ...(sampler?.stopPattern?.patterns ?? []),
  ];

  const response = await fetch('/api/completion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      n_predict: sampler?.maxTokens ?? 512,
      stop: stopSequences,
      ...params,
    }),
  });

  const result = await response.json();
  const displayText = convertIdsToDisplayNames(result.content.trim(), chatData);
  const aiMessage = createChatMessage(chatData, aiCharacter, displayText);

  return addMessageToChatData(chatData, { ...aiMessage, kvCachePath: result.kv_cache_path });
}

async function handleAllParticipantsResponseExceptTheProtagonist(chatData: ChatData, userText: string): Promise<ChatData> {
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
    updatedChatData = await handleAIResponse(updatedChatData, responder, userText);
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
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

  const onProtagonistSendMessage = async () => {
    if (!inputText.trim() || !currentCharacter || !chatData || isLoading) return;

    const protagonistChatMessage = createChatMessage(chatData, chatData.protagonist, inputText);
    const chatDataWithUserMsg = addMessageToChatData(chatData, protagonistChatMessage);
    setChatData(chatDataWithUserMsg);
    setInputText('');
    setPendingFiles([]); // ✅ Clear attachments after send
    setIsLoading(true);

    try {
      const updatedChatData = await handleAllParticipantsResponseExceptTheProtagonist(chatDataWithUserMsg, inputText);
      await saveChatData(updatedChatData);
      setChatData(updatedChatData);
    } catch (error) {
      console.error('AI response failed:', error);
    } finally {
      setIsLoading(false);
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
    
    // Safety: don't regenerate if there are no AI messages or we're already at the end
    if (trimIndex === 0 || trimIndex === history.length) return;

    const triggerMessage = history[trimIndex - 1];
    
    // Get the original responders in their exact order
    const originalResponders = history
      .slice(trimIndex)
      .map(m => m.character)
      .filter((char, i, arr) => arr.findIndex(c => c.id === char.id) === i); // Deduplicate
    
    const trimmedChatData: ChatData = {
      ...chatData,
      chatMessageHistory: history.slice(0, trimIndex),
      last_updated_timestamp: Date.now(),
    };
    
    setChatData(trimmedChatData);
    setIsLoading(true);

    try {
      let regeneratedChatData = trimmedChatData;
      
      // Re-generate each responder sequentially with updated context
      for (const responder of originalResponders) {
        // Use the full updated history as context, passing trigger text only for the first responder
        const userTextForResponse = regeneratedChatData.chatMessageHistory.length === trimIndex 
          ? triggerMessage.textContent 
          : ''; // Subsequent responders use the accumulated prompt
        
        regeneratedChatData = await handleAIResponse(regeneratedChatData, responder, userTextForResponse);
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
          const displayName = msg.isNameRevealed
            ? msg.character.name
            : getCharacterPromptId(msg.character, chatData.participants);
          const avatarUrl = !isProtagonist ? getCharacterAvatarUrl(msg.character) : null;
          const aiParticipantIds = new Set(
            chatData.participants.filter(p => p.id !== chatData.protagonist.id).map(p => p.id)
          );
          const isLastAIMessage = !isProtagonist && 
            !chatData.chatMessageHistory.slice(index + 1).some(m => aiParticipantIds.has(m.character.id));
          const isEditing = editingMessageId === msg.id;

          return (
            <div key={msg.id} className={`message-row ${isProtagonist ? 'message-right' : 'message-left'}`}>
              {!isProtagonist && (
                <div className="avatar-column">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={displayName} className="character-avatar" />
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
                      autoFocus
                    />
                    <div className="edit-actions">
                      <button onClick={onCancelEdit} className="edit-btn edit-btn-cancel">Cancel</button>
                      <button onClick={onSaveEdit} className="edit-btn edit-btn-save">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="message-text">{msg.textContent}</span>
                    <div className="message-toolbar">
                      <button onClick={() => onStartEdit(msg.id, msg.textContent)} title="Edit" className="toolbar-btn">✎</button>
                      {isLastAIMessage && (
                        <button onClick={onRegenerateLastAI} title="Regenerate" className="toolbar-btn">↻</button>
                      )}
                      <button onClick={() => onBranchAtMessage(msg.id)} title="Branch" className="toolbar-btn">⑂</button>
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
        <div ref={messagesEndRef} style={{ height: '1px' }} />
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
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="attach-button toolbar-btn"
            title="Attach file"
          >📎</button>
          <input
            ref={fileInputRef}
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
            onClick={onProtagonistSendMessage}
            disabled={isLoading || (!inputText.trim() && pendingFiles.length === 0)}
            className="send-button counter"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default App
