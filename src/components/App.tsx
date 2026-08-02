import React, { useState, useRef, useEffect } from 'react';
import { useChatSession } from '../hooks/useChatSession';
import type { ChatData } from '../types';
import { deleteMessage, massDeleteMessages, editMessage, branchMessage } from '../hooks/messageLogic';
import { deleteRawChatData, loadAllRawChatData, saveRawChatData } from '../hooks/storage';
import { getCharacterImageUrl } from '../hooks/storage';
import { getDelayedDisplayName } from '../hooks/immersionLogic';
import { ChatStatisticsBar } from './ChatStatisticsBar';
import './App.css';

function App() {
  const { 
    chatData, 
    setChatData, 
    currentCharacter, 
    setCurrentCharacter,
    isLoading, 
    streamingText, 
    streamingCharacter, 
    sendMessage, 
    stopGeneration,
    regenerateLastAI,
    regenerateLastProtagonist,
    messageEndRef,
    parentChatMessageIds,
    generationSpeed,
    messageCount,
    tokenCount,
    maximumNumberOfTokens,
    startNewChat
  } = useChatSession();

  const [isChatListOpen, setIsChatListOpen] = useState(false);
  const [allChats, setAllChats] = useState<ChatData[]>([]);
  
  const [inputText, setInputText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [massDeleteId, setMassDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isChatListOpen) {
      loadAllRawChatData().then(data => {
        const validChats = data.filter((c): c is ChatData => c !== null);
        
        // ✅ Sort by last_updated_timestamp (Highest/Newest first)
        const sortedChats = validChats.sort((a, b) => {
          return b.last_updated_timestamp - a.last_updated_timestamp;
        });

        setAllChats(sortedChats);
      });
    }
  }, [isChatListOpen]);

  const handleSwitchChat = (id: string) => {
    const selected = allChats.find(c => c.id === id);
    if (selected) {
      setChatData(selected);
      setCurrentCharacter(selected.protagonist);
      setIsChatListOpen(false);
    }
  };

  const handleNewChat = async () => {
    const charToUse = currentCharacter || (allChats.length > 0 ? allChats[0].protagonist : null);
    if (!charToUse) {
        alert("No character available.");
        return;
    }
    startNewChat(charToUse);
    setIsChatListOpen(false);
  };

  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this session?")) return;
    try {
      await deleteRawChatData(id);
      const updated = await loadAllRawChatData();
      setAllChats(updated.filter((c): c is ChatData => c !== null));
      if (chatData && chatData.id === id) {
        // If deleting current, start a fresh draft immediately so UI doesn't break
        const nextChar = currentCharacter || (updated.length > 0 ? updated[0].protagonist : null);
        if(nextChar) startNewChat(nextChar);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete.");
    }
  };

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
    } catch (err) { 
        if ((err as Error).message.includes("branch") || (err as Error).message.includes("stem")) {
            alert((err as Error).message);
        } else { console.error(err); }
    }
  };

  const handleDelete = async (id: string) => {
    if (!chatData) return;
    try {
      const updated = await deleteMessage(chatData, id);
      setChatData(updated);
    } catch (err) { 
        if ((err as Error).message.includes("branch") || (err as Error).message.includes("stem")) {
            alert((err as Error).message);
        } else { console.error(err); }
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
        if ((err as Error).message.includes("branch") || (err as Error).message.includes("stem")) {
            alert((err as Error).message);
        } else { console.error(err); }
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

  const handleManageParticipants = () => alert("Participant management coming soon!");
  const handleManageInstructions = () => alert("Instruction management coming soon!");
  const handleSearch = () => alert("Search functionality coming soon!");

  // ✅ ALWAYS RENDER UI
  if (!currentCharacter) {
      // Only show loading if we don't even have a character selected yet
      return <div className="loading-screen">Initializing...</div>;
  }

  const isMassActive = massDeleteId !== null;
  const startIndex = isMassActive ? chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId) : -1;
  const branchOffIndex = chatData.parentChatMessageId 
    ? chatData.chatMessageHistory.findIndex(m => m.id === chatData.parentChatMessageId) 
    : -1;

  return (
    <div className="chat-container">
      <header className="app-header">
        <div className="header-content">
          <div className="header-top">
            <div className="header-title">{chatData?.title || "New Chat Draft"}</div>
            <ChatStatisticsBar 
              generationSpeed={generationSpeed}
              messageCount={messageCount}
              tokenCount={tokenCount}
              maximumNumberOfTokens={maximumNumberOfTokens}
            />
          </div>
          <nav className="header-nav">
            <button type="button" className="nav-btn active" onClick={() => setIsChatListOpen(true)}>💬 Chat List</button>
            <button type="button" className="nav-btn" disabled>🎭 Characters</button>
            <button type="button" className="nav-btn" disabled>📜 Instructions</button>
            <button type="button" className="nav-btn" disabled>🎚️ Samplers</button>
            <button type="button" className="nav-btn" disabled>🛑 Stop Patterns</button>
          </nav>
        </div>
      </header>

      <div className="chat-history">
        {chatData?.chatMessageHistory.map((message, index) => {
          const isProtagonist = message.character.id === currentCharacter.id;
          const displayName = getDelayedDisplayName(chatData, index, message.character.id, chatData.participants);
          const avatarSrc = !isProtagonist ? getCharacterImageUrl(message.character.image) : null;
          
          const aiParticipantIds = new Set(
            chatData.participants.filter(p => p.id !== currentCharacter.id).map(p => p.id)
          );
          const isLastAI = !isProtagonist && !chatData.chatMessageHistory.slice(index + 1).some(m => aiParticipantIds.has(m.character.id));
          const isLastProtag = isProtagonist;
          
          const isEditing = editingId === message.id;
          const isMassStart = message.id === massDeleteId;
          const isInDeletionRange = isMassActive && startIndex !== -1 && index >= startIndex;
          const isStemMessage = parentChatMessageIds.has(message.id);
          const isJustBeforeBranchOff = chatData.parentChatMessageId && index === branchOffIndex;

          return (
            <React.Fragment key={message.id}>
              <div className={`message-row ${isProtagonist ? 'message-right' : 'message-left'} ${isInDeletionRange ? 'message-fading-out' : ''}`}>
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
                <div className={`message-bubble ${isProtagonist ? 'bubble-user' : 'bubble-ai'} ${isEditing ? 'bubble-editing' : ''} ${isInDeletionRange ? 'bubble-marked-for-delete' : ''} ${isStemMessage ? 'bubble-stem' : ''}`}>
                  {isEditing ? (
                    <div className="edit-mode">
                      <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); } if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); } }} className="edit-textarea" rows={Math.max(3, editDraft.split('\n').length)} />
                      <div className="edit-actions">
                        <button type="button" onClick={() => { setEditingId(null); setEditDraft(''); }} className="edit-btn edit-btn-cancel">Cancel</button>
                        <button type="button" onClick={handleSaveEdit} className="edit-btn edit-btn-save">Save</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="message-text">{message.textContent}</span>
                      <div className="message-toolbar">
                        {isStemMessage ? (
                          <span className="toolbar-lock" title="Locked: Other chats branch from here">🔒 Locked</span>
                        ) : !isMassActive ? (
                          <>
                            <button type="button" onClick={() => { setEditingId(message.id); setEditDraft(message.textContent); }} title="Edit" className="toolbar-btn">✎</button>
                            {(isLastAI || isLastProtag) && (<button type="button" onClick={isLastAI ? regenerateLastAI : regenerateLastProtagonist} title="Regenerate" className="toolbar-btn">↻</button>)}
                            <button type="button" onClick={() => handleBranch(message.id)} title="Branch" className="toolbar-btn">⑂</button>
                            <button type="button" onClick={() => handleDelete(message.id)} title="Delete" className="toolbar-btn delete-btn" style={{ color: '#ff4444' }}>🗑</button>
                            <button type="button" onClick={() => setMassDeleteId(message.id)} title="Mass Delete" className="toolbar-btn mass-delete-btn" style={{ color: '#ff9900' }}>🗑️↓</button>
                          </>
                        ) : isMassStart ? (
                          <div className="mass-delete-confirm-bar">
                            <span style={{fontSize: '0.8em', marginRight: '5px'}}>Delete from here?</span>
                            <button type="button" onClick={handleMassDeleteConfirm} className="toolbar-btn btn-confirm" style={{backgroundColor: '#ff4444', color: 'white'}}>Confirm</button>
                            <button type="button" onClick={() => setMassDeleteId(null)} className="toolbar-btn btn-cancel" style={{backgroundColor: 'var(--border)', color: 'var(--text-h)', border: '1px solid var(--border)'}}>Cancel</button>
                          </div>
                        ) : isInDeletionRange ? (<span className="deleted-preview-label">Will be deleted</span>) : null}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {isJustBeforeBranchOff && (
                <div className="branch-separator-line">
                  <div className="branch-separator-content">
                    <span className="branch-separator-icon">🌿</span>
                    <span className="branch-separator-text">Conversation Branches Here</span>
                    <span className="branch-separator-icon">🌿</span>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}

        {isLoading && streamingCharacter && (
          <div className="message-row message-left">
            <div className="avatar-column">
              {streamingCharacter.image ? (<img src={getCharacterImageUrl(streamingCharacter.image)!} alt={getDelayedDisplayName(chatData!, chatData!.chatMessageHistory.length - 1, streamingCharacter.id, chatData!.participants)} className="character-avatar" />) : (<div className="character-avatar placeholder" />)}
              <span className="avatar-name">{getDelayedDisplayName(chatData!, chatData!.chatMessageHistory.length - 1, streamingCharacter.id, chatData!.participants)}</span>
            </div>
            <div className="message-bubble bubble-ai">
              <div style={{ display: 'inline', whiteSpace: 'pre-wrap' }}>
                <span className="message-text" style={{ display: 'inline' }}>{streamingText}</span>
                <span className="cursor-blink" style={{ display: 'inline' }}>&nbsp;▋</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Empty State Hint inside chat history if no messages */}
        {chatData && chatData.chatMessageHistory.length === 0 && (
            <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}>
                <p>Start the conversation as {currentCharacter.name}...</p>
                <p style={{fontSize: '0.8em'}}>Messages will be saved automatically after the first response.</p>
            </div>
        )}

        <div ref={messageEndRef} style={{ height: '1px' }} />
      </div>

      <div className="context-bar">
        <button type="button" className="context-btn" onClick={handleManageParticipants} title="Manage Participants (Coming Soon)">
          👥 Participants ({chatData?.participants.length || 0})
        </button>
        <button type="button" className="context-btn" onClick={handleManageInstructions} title="Manage Instructions (Coming Soon)">
          📜 Instructions ({chatData?.instructions?.length || 0})
        </button>
        <button type="button" className="context-btn" onClick={handleSearch} title="Search Messages (Coming Soon)">
          🔍 Search
        </button>
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
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} 
            placeholder={`Message as ${currentCharacter.name}...`} 
            rows={3} 
            className="chat-input" 
            disabled={isLoading || !chatData} 
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

      {isChatListOpen && (
        <div className="modal-overlay" onClick={() => setIsChatListOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Chat Sessions</h2>
              <div className="modal-header-actions">
                <button type="button" className="new-chat-btn" onClick={handleNewChat} title="Create New Chat">
                  ➕ New Chat
                </button>
                <button type="button" className="close-btn" onClick={() => setIsChatListOpen(false)}>×</button>
              </div>
            </div>
            <div className="modal-body">
              {allChats.length === 0 ? (
                <p className="empty-state">No saved chat sessions found.</p>
              ) : (
                <ul className="chat-list">
                  {allChats.map(chat => {
                    const isCurrent = chatData && chatData.id === chat.id;
                    const isBranch = !!chat.parentChatDataId;
                    return (
                      <li key={chat.id} className={`chat-list-item ${isCurrent ? 'active' : ''}`} onClick={() => handleSwitchChat(chat.id)}>
                        <div className="chat-item-main">
                          <span className="chat-icon">{isBranch ? '🌿' : '💬'}</span>
                          <div className="chat-item-info">
                            <div className="chat-item-title">{chat.title}</div>
                            {isBranch && chat.parentChatDataId && <div className="chat-item-sub">Branch of {chat.parentChatDataId.substring(0,8)}...</div>}
                          </div>
                        </div>
                        <button type="button" className="delete-chat-btn" onClick={(e) => handleDeleteChat(e, chat.id)} title="Delete Chat">🗑️</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;