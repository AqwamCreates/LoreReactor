import type React from 'react';
import { useState, useRef } from 'react';
import { useChatSession } from './useChatSession';
import type { Character, ChatMessage } from './types';
import { deleteMessage, massDeleteMessages, editMessage, branchMessage } from './messageLogic';
import { getCharacterImageUrl } from './storage';
import './App.css';

function getDelayedDisplayName(chatMessageHistory: ChatMessage[], index: number, characterId: string, participants: Character[]): string {
  const len = chatMessageHistory.length;
  if (!len || index < 0 || index >= len) {
    const idx = participants.findIndex(p => p.id === characterId);
    return idx !== -1 ? `Character ${idx + 1}` : 'Unknown';
  }

  const target = chatMessageHistory[index];
  for (let i = index - 1; i >= 0; i--) {
    const msg = chatMessageHistory[i];
    if (msg.character.id === characterId) {
      if (msg.isNameRevealed && target) return msg.character.name;
      break;
    }
  }
  
  const idx = participants.findIndex(p => p.id === characterId);
  return idx !== -1 ? `Character ${idx + 1}` : 'Unknown';
}

function App() {
  const { 
    chatData, 
    setChatData, 
    currentCharacter, 
    isLoading, 
    streamingText, 
    streamingCharacter, 
    sendMessage, 
    stopGeneration,
    regenerateLastAI,
    regenerateLastProtagonist,
    messageEndRef,
    branchChatMessageIds
  } = useChatSession();

  const [inputText, setInputText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [massDeleteId, setMassDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setPendingFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    e.target.value = '';
  };

  const handleSaveEdit = async () => {
    if (!chatData || !editingId) return;
    try {
      const updated = await editMessage(chatData, editingId, editDraft);
      setChatData(updated);
      setEditingId(null);
      setEditDraft('');
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id: string) => {
    if (!chatData) return;
    try {
      const updated = await deleteMessage(chatData, id);
      setChatData(updated);
    } catch (err) { 
        // Show specific error if it's a branch point
        if ((err as Error).message.includes("branch")) {
            alert((err as Error).message);
        } else {
            console.error(err); 
        }
    }
  };

  const handleMassDeleteConfirm = async () => {
    if (!chatData || !massDeleteId) return;
    const idx = chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId);
    if (idx === -1) return;
    try {
      const updated = await massDeleteMessages(chatData, idx);
      setChatData(updated);
      setMassDeleteId(null);
    } catch (err) { 
        if ((err as Error).message.includes("branch")) {
            alert((err as Error).message);
        } else {
            console.error(err); 
        }
    }
  };

  const handleBranch = async (id: string) => {
    if (!chatData) return;
    try {
      await branchMessage(chatData, id);
      window.open(window.location.href, '_blank');
    } catch (err) { console.error(err); }
  };

  const handleSend = () => {
    if (!inputText.trim()) return;
    sendMessage(inputText);
    setInputText('');
    setPendingFiles([]);
  };

  if (!chatData || !currentCharacter) return <div className="loading-screen">Loading chat session...</div>;

  const isMassActive = massDeleteId !== null;
  const startIndex = isMassActive ? chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId) : -1;

  return (
    <div className="chat-container">
      <div className="chat-history">
        
        {/* ✅ 2. Render "Branched From" Header if this chat is a branch */}
        {chatData.parentChatId && (
          <div className="branch-origin-header">
            <span>↩️ Viewing a branch started from message ID: {chatData.branchPointMessageId?.substring(0, 8)}...</span>
          </div>
        )}

        {chatData.chatMessageHistory.map((message, index) => {
          const isProtagonist = message.character.id === currentCharacter.id;
          const displayName = getDelayedDisplayName(chatData.chatMessageHistory, index, message.character.id, chatData.participants);
          const avatarSrc = !isProtagonist ? getCharacterImageUrl(message.character.image) : null;
          
          const aiParticipantIds = new Set(
            chatData.participants.filter(p => p.id !== currentCharacter.id).map(p => p.id)
          );
          const isLastAI = !isProtagonist && !chatData.chatMessageHistory.slice(index + 1).some(m => aiParticipantIds.has(m.character.id));
          const isLastProtag = isProtagonist;
          
          const isEditing = editingId === message.id;
          const isMassStart = message.id === massDeleteId;
          const isInDeletionRange = isMassActive && startIndex !== -1 && index >= startIndex;
          
          // ✅ 3. Check if this specific message is a branch point
          const isBranchPoint = branchChatMessageIds.has(message.id);

          return (
            <div key={message.id} className={`message-row ${isProtagonist ? 'message-right' : 'message-left'} ${isInDeletionRange ? 'message-fading-out' : ''}`}>
              {!isProtagonist && (
                <div className="avatar-column">
                  {avatarSrc ? (
                    <img src={avatarSrc} alt={displayName} className="character-avatar" onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
                  ) : (
                    <div className="character-avatar placeholder" />
                  )}
                  <span className="avatar-name">{displayName}</span>
                </div>
              )}
              <div className={`message-bubble ${isProtagonist ? 'bubble-user' : 'bubble-ai'} ${isEditing ? 'bubble-editing' : ''} ${isInDeletionRange ? 'bubble-marked-for-delete' : ''}`}>
                {isEditing ? (
                  <div className="edit-mode">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                        if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); }
                      }}
                      className="edit-textarea"
                      rows={Math.max(3, editDraft.split('\n').length)}
                    />
                    <div className="edit-actions">
                      <button type="button" onClick={() => { setEditingId(null); setEditDraft(''); }} className="edit-btn edit-btn-cancel">Cancel</button>
                      <button type="button" onClick={handleSaveEdit} className="edit-btn edit-btn-save">Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="message-text">{message.textContent}</span>
                    
                    <div className="message-toolbar">
                      {!isMassActive ? (
                        <>
                          <button type="button" onClick={() => { setEditingId(message.id); setEditDraft(message.textContent); }} title="Edit" className="toolbar-btn">✎</button>
                          {(isLastAI || isLastProtag) && (
                            <button type="button" onClick={isLastAI ? regenerateLastAI : regenerateLastProtagonist} title="Regenerate" className="toolbar-btn">↻</button>
                          )}
                          <button type="button" onClick={() => handleBranch(message.id)} title="Branch" className="toolbar-btn">⑂</button>
                          
                          {/* ✅ 4. Disable Delete if it's a branch point */}
                          <button 
                            type="button" 
                            onClick={() => handleDelete(message.id)} 
                            title={isBranchPoint ? "Cannot delete: Other chats branch from here" : "Delete only this message"} 
                            className="toolbar-btn delete-btn" 
                            style={{ color: isBranchPoint ? '#ccc' : '#ff4444', cursor: isBranchPoint ? 'not-allowed' : 'pointer' }}
                            disabled={isBranchPoint}
                          >
                            🗑
                          </button>

                          <button 
                            type="button" 
                            onClick={() => setMassDeleteId(message.id)} 
                            title="Delete this and all following" 
                            className="toolbar-btn mass-delete-btn" 
                            style={{ color: isBranchPoint ? '#ccc' : '#ff9900', cursor: isBranchPoint ? 'not-allowed' : 'pointer' }}
                            disabled={isBranchPoint}
                          >
                            🗑️↓
                          </button>
                        </>
                      ) : isMassStart ? (
                        <div className="mass-delete-confirm-bar">
                          <span style={{fontSize: '0.8em', marginRight: '5px'}}>Delete from here?</span>
                          <button type="button" onClick={handleMassDeleteConfirm} className="toolbar-btn btn-confirm" style={{backgroundColor: '#ff4444', color: 'white'}}>Confirm</button>
                          <button type="button" onClick={() => setMassDeleteId(null)} className="toolbar-btn btn-cancel" style={{backgroundColor: '#ccc'}}>Cancel</button>
                        </div>
                      ) : isInDeletionRange ? (
                        <span className="deleted-preview-label">Will be deleted</span>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
              
              {/* ✅ 5. Render Branch Indicator BELOW the message if it's a branch point */}
              {isBranchPoint && (
                <div className="branch-indicator">
                  <span className="branch-icon">🌿</span>
                  <span className="branch-text">Branch exists from here</span>
                </div>
              )}
            </div>
          );
        })}

        {isLoading && streamingCharacter && (
          <div className="message-row message-left">
            <div className="avatar-column">
              {streamingCharacter.image ? (
                <img src={getCharacterImageUrl(streamingCharacter.image)!} alt={streamingCharacter.name} className="character-avatar" />
              ) : (
                <div className="character-avatar placeholder" />
              )}
              <span className="avatar-name">
                {getDelayedDisplayName(chatData.chatMessageHistory, chatData.chatMessageHistory.length > 0 ? chatData.chatMessageHistory.length - 1 : 0, streamingCharacter.id, chatData.participants)}
              </span>
            </div>
            <div className="message-bubble bubble-ai">
              <div style={{ display: 'inline', whiteSpace: 'pre-wrap' }}>
                <span className="message-text" style={{ display: 'inline' }}>{streamingText}</span>
                <span className="cursor-blink" style={{ display: 'inline' }}>&nbsp;▋</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messageEndRef} style={{ height: '1px' }} />
      </div>

      <div className="input-wrapper">
        {pendingFiles.length > 0 && (
          <div className="attachment-strip">
            {pendingFiles.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="attachment-chip">
                <span className="attachment-name" title={file.name}>{file.name}</span>
                <span className="attachment-size">{(file.size / 1024).toFixed(1)} KB</span>
                <button type="button" onClick={() => setPendingFiles(p => p.filter((_, i) => i !== idx))} className="attachment-remove">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="input-area">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading} className="attach-button toolbar-btn" title="Attach file">📎</button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelected} />
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!isLoading) handleSend();
              }
            }}
            placeholder={`Message as ${currentCharacter.name}...`}
            rows={3}
            className="chat-input"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={isLoading ? stopGeneration : handleSend}
            disabled={!isLoading && (!inputText.trim() && pendingFiles.length === 0)}
            className="send-button counter"
            title={isLoading ? "Stop Generating" : "Send Message"}
          >
            {isLoading ? '⏹ Stop' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;