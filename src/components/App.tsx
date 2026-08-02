import React, { useState, useRef, useEffect } from 'react';
import { useChatSession } from '../hooks/useChatSession';
import type { ChatData, Character, Instruction, Sampler, StopPattern } from '../types';
import { deleteMessage, massDeleteMessages, editMessage, branchMessage } from '../hooks/messageLogic';
import { deleteRawChatData, loadAllRawChatData, loadAllRawCharacters, loadAllRawInstructions, loadAllRawSamplers, loadAllRawStopPatterns } from '../hooks/storage';
import { getCharacterImageUrl } from '../hooks/storage';
import { getDelayedDisplayName } from '../hooks/immersionLogic';
import { ChatStatisticsBar } from './ChatStatisticsBar';
import { ManagerModal } from './ManagerModal';
import './App.css';

function App() {
  const { 
    chatData, setChatData, currentCharacter, setCurrentCharacter,
    isLoading, streamingText, streamingCharacter, sendMessage, stopGeneration,
    regenerateLastAI, regenerateLastProtagonist, messageEndRef, parentChatMessageIds,
    generationSpeed, messageCount, tokenCount, maximumNumberOfTokens, startNewChat
  } = useChatSession();

  // --- UI State ---
  const [isChatListOpen, setIsChatListOpen] = useState(false);
  const [isCharListOpen, setIsCharListOpen] = useState(false);
  const [isInstListOpen, setIsInstListOpen] = useState(false);
  const [isSampListOpen, setIsSampListOpen] = useState(false);
  const [isStopListOpen, setIsStopListOpen] = useState(false);

  const [allChats, setAllChats] = useState<ChatData[]>([]);
  const [allCharacters, setAllCharacters] = useState<Character[]>([]);
  const [allInstructions, setAllInstructions] = useState<Instruction[]>([]);
  const [allSamplers, setAllSamplers] = useState<Sampler[]>([]);
  const [allStopPatterns, setAllStopPatterns] = useState<StopPattern[]>([]);
  
  const [inputText, setInputText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [massDeleteId, setMassDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Load Data for Modals ---
  useEffect(() => {
    const loadData = async () => {
      if (isChatListOpen) {
        const chats = await loadAllRawChatData();
        setAllChats(chats.sort((a, b) => b.last_updated_timestamp - a.last_updated_timestamp));
      }
      if (isCharListOpen) {
        const chars = await loadAllRawCharacters();
        setAllCharacters(chars);
      }
      if (isInstListOpen) {
        const insts = await loadAllRawInstructions();
        setAllInstructions(insts);
      }
      if (isSampListOpen) {
        const samps = await loadAllRawSamplers();
        setAllSamplers(samps);
      }
      if (isStopListOpen) {
        const stops = await loadAllRawStopPatterns();
        setAllStopPatterns(stops);
      }
    };

    if (isChatListOpen || isCharListOpen || isInstListOpen || isSampListOpen || isStopListOpen) {
      loadData();
    }
  }, [isChatListOpen, isCharListOpen, isInstListOpen, isSampListOpen, isStopListOpen]);

  // --- Handlers ---

  const handleSwitchChat = (id: string) => {
    const selected = allChats.find(c => c.id === id);
    if (selected) { setChatData(selected); setCurrentCharacter(selected.protagonist); setIsChatListOpen(false); }
  };
  const handleNewChat = () => {
    const charToUse = currentCharacter || (allChats.length > 0 ? allChats[0].protagonist : null);
    if (charToUse) { startNewChat(charToUse); setIsChatListOpen(false); }
  };
  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this session?")) return;
    await deleteRawChatData(id);
    const updated = await loadAllRawChatData();
    setAllChats(updated.sort((a, b) => b.last_updated_timestamp - a.last_updated_timestamp));
    if (chatData?.id === id) startNewChat(currentCharacter!);
  };

  const handleSelectCharacter = (char: Character) => {
    if (chatData) {
      const updatedChat = { ...chatData, protagonist: char };
      if (!updatedChat.participants.find(p => p.id === char.id)) updatedChat.participants = [...updatedChat.participants, char];
      setChatData(updatedChat);
      setCurrentCharacter(char);
    } else { setCurrentCharacter(char); startNewChat(char); }
    setIsCharListOpen(false);
  };
  const handleCreateCharacter = () => alert("Create Character Modal coming soon!");
  const handleDeleteCharacter = async (id: string) => {
    if (!window.confirm("Delete this character?")) return;
    // await deleteRawCharacter(id); // Implement if needed
    setAllCharacters(prev => prev.filter(c => c.id !== id));
  };

  const handleSelectInstruction = (inst: Instruction) => { alert(`Selected: ${inst.name}`); setIsInstListOpen(false); };
  const handleCreateInstruction = () => alert("Create Instruction Modal coming soon!");
  const handleDeleteInstruction = async (id: string) => {
    if (!window.confirm("Delete?")) return;
    setAllInstructions(prev => prev.filter(i => i.id !== id));
  };

  const handleSelectSampler = (samp: Sampler) => {
    if (currentCharacter) {
      const updatedChar = { ...currentCharacter, sampler: samp };
      setCurrentCharacter(updatedChar);
      if (chatData) {
        const updatedParticipants = chatData.participants.map(p => p.id === updatedChar.id ? updatedChar : p);
        setChatData({ ...chatData, protagonist: updatedChar.id === chatData.protagonist.id ? updatedChar : chatData.protagonist, participants: updatedParticipants });
      }
    }
    setIsSampListOpen(false);
  };
  const handleCreateSampler = () => alert("Create Sampler Modal coming soon!");
  const handleDeleteSampler = async (id: string) => {
    if (!window.confirm("Delete?")) return;
    setAllSamplers(prev => prev.filter(s => s.id !== id));
  };

  const handleSelectStopPattern = (stop: StopPattern) => { alert(`Selected: ${stop.pattern}`); setIsStopListOpen(false); };
  const handleCreateStopPattern = () => alert("Create Stop Pattern Modal coming soon!");
  const handleDeleteStopPattern = async (id: string) => {
    if (!window.confirm("Delete?")) return;
    setAllStopPatterns(prev => prev.filter(s => s.id !== id));
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setPendingFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    e.target.value = '';
  };
  const handleSaveEdit = async () => {
    if (!chatData || !editingId) return;
    try { const updated = await editMessage(chatData, editingId, editDraft); setChatData(updated); setEditingId(null); setEditDraft(''); } 
    catch (err) { if ((err as Error).message.includes("branch") || (err as Error).message.includes("stem")) alert((err as Error).message); else console.error(err); }
  };
  const handleDelete = async (id: string) => {
    if (!chatData) return;
    try { const updated = await deleteMessage(chatData, id); setChatData(updated); } 
    catch (err) { if ((err as Error).message.includes("branch") || (err as Error).message.includes("stem")) alert((err as Error).message); else console.error(err); }
  };
  const handleMassDeleteConfirm = async () => {
    if (!chatData || !massDeleteId) return;
    const idx = chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId);
    if (idx === -1) return;
    try { const updated = await massDeleteMessages(chatData, idx); setChatData(updated); setMassDeleteId(null); } 
    catch (err) { if ((err as Error).message.includes("branch") || (err as Error).message.includes("stem")) alert((err as Error).message); else console.error(err); }
  };
  const handleBranch = async (id: string) => {
    if (!chatData) return;
    try { await branchMessage(chatData, id); window.open(window.location.href, '_blank'); } catch (err) { console.error(err); }
  };
  const handleSend = () => { if (!inputText.trim()) return; sendMessage(inputText); setInputText(''); setPendingFiles([]); };

  if (!currentCharacter) return <div className="loading-screen">Initializing...</div>;

  const isMassActive = massDeleteId !== null;
  const startIndex = isMassActive ? chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId) : -1;
  const branchOffIndex = chatData.parentChatMessageId ? chatData.chatMessageHistory.findIndex(m => m.id === chatData.parentChatMessageId) : -1;

  return (
    <div className="chat-container">
      <header className="app-header">
        <div className="header-content">
          <div className="header-top">
            <div className="header-title">{chatData?.title || "New Chat Draft"}</div>
            <ChatStatisticsBar generationSpeed={generationSpeed} messageCount={messageCount} tokenCount={tokenCount} maximumNumberOfTokens={maximumNumberOfTokens} />
          </div>
          <nav className="header-nav">
            <button type="button" className="nav-btn" onClick={() => setIsChatListOpen(true)}>💬 Chat List</button>
            <button type="button" className="nav-btn" onClick={() => setIsCharListOpen(true)}>🎭 Characters</button>
            <button type="button" className="nav-btn" onClick={() => setIsInstListOpen(true)}>📜 Instructions</button>
            <button type="button" className="nav-btn" onClick={() => setIsSampListOpen(true)}>🎚️ Samplers</button>
            <button type="button" className="nav-btn" onClick={() => setIsStopListOpen(true)}>🛑 Stop Patterns</button>
          </nav>
        </div>
      </header>

      <div className="chat-history">
        {chatData?.chatMessageHistory.map((message, index) => {
          const isProtagonist = message.character.id === currentCharacter.id;
          const displayName = getDelayedDisplayName(chatData, index, message.character.id, chatData.participants);
          const avatarSrc = !isProtagonist ? getCharacterImageUrl(message.character.image) : null;
          const aiParticipantIds = new Set(chatData.participants.filter(p => p.id !== currentCharacter.id).map(p => p.id));
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
                    {avatarSrc ? (<img src={avatarSrc} alt={displayName} className="character-avatar" onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />) : (<div className="character-avatar placeholder" />)}
                    <span className="avatar-name">{displayName}</span>
                  </div>
                )}
                <div className={`message-bubble ${isProtagonist ? 'bubble-user' : 'bubble-ai'} ${isEditing ? 'bubble-editing' : ''} ${isInDeletionRange ? 'bubble-marked-for-delete' : ''} ${isStemMessage ? 'bubble-stem' : ''}`}>
                  {isEditing ? (
                    <div className="edit-mode">
                      <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); } if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); } }} className="edit-textarea" rows={Math.max(3, editDraft.split('\n').length)} />
                      <div className="edit-actions"><button type="button" onClick={() => { setEditingId(null); setEditDraft(''); }} className="edit-btn edit-btn-cancel">Cancel</button><button type="button" onClick={handleSaveEdit} className="edit-btn edit-btn-save">Save</button></div>
                    </div>
                  ) : (
                    <>
                      <span className="message-text">{message.textContent}</span>
                      <div className="message-toolbar">
                        {isStemMessage ? (<span className="toolbar-lock">🔒 Locked</span>) : !isMassActive ? (
                          <>
                            <button type="button" onClick={() => { setEditingId(message.id); setEditDraft(message.textContent); }} className="toolbar-btn">✎</button>
                            {(isLastAI || isLastProtag) && (<button type="button" onClick={isLastAI ? regenerateLastAI : regenerateLastProtagonist} className="toolbar-btn">↻</button>)}
                            <button type="button" onClick={() => handleBranch(message.id)} className="toolbar-btn">⑂</button>
                            <button type="button" onClick={() => handleDelete(message.id)} className="toolbar-btn delete-btn" style={{ color: '#ff4444' }}>🗑</button>
                            <button type="button" onClick={() => setMassDeleteId(message.id)} className="toolbar-btn mass-delete-btn" style={{ color: '#ff9900' }}>🗑️↓</button>
                          </>
                        ) : isMassStart ? (<div className="mass-delete-confirm-bar"><span>Delete from here?</span><button type="button" onClick={handleMassDeleteConfirm} className="toolbar-btn btn-confirm">Confirm</button><button type="button" onClick={() => setMassDeleteId(null)} className="toolbar-btn btn-cancel">Cancel</button></div>) : isInDeletionRange ? (<span className="deleted-preview-label">Will be deleted</span>) : null}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {isJustBeforeBranchOff && (<div className="branch-separator-line"><div className="branch-separator-content"><span className="branch-separator-icon">🌿</span><span className="branch-separator-text">Conversation Branches Here</span><span className="branch-separator-icon">🌿</span></div></div>)}
            </React.Fragment>
          );
        })}
        {isLoading && streamingCharacter && (
          <div className="message-row message-left">
            <div className="avatar-column">{streamingCharacter.image ? (<img src={getCharacterImageUrl(streamingCharacter.image)!} alt={streamingCharacter.name} className="character-avatar" />) : (<div className="character-avatar placeholder" />)}<span className="avatar-name">{streamingCharacter.name}</span></div>
            <div className="message-bubble bubble-ai"><div style={{ display: 'inline', whiteSpace: 'pre-wrap' }}><span className="message-text" style={{ display: 'inline' }}>{streamingText}</span><span className="cursor-blink" style={{ display: 'inline' }}>&nbsp;▋</span></div></div>
          </div>
        )}
        {chatData && chatData.chatMessageHistory.length === 0 && (<div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}><p>Start the conversation with {currentCharacter.name}...</p></div>)}
        <div ref={messageEndRef} style={{ height: '1px' }} />
      </div>

      <div className="context-bar">
        <button type="button" className="context-btn" onClick={() => setIsCharListOpen(true)}>👥 Participants ({chatData?.participants.length || 0})</button>
        <button type="button" className="context-btn" onClick={() => setIsInstListOpen(true)}>📜 Instructions ({chatData?.instructions?.length || 0})</button>
        <button type="button" className="context-btn" onClick={() => alert("Search coming soon!")}>🔍 Search</button>
      </div>

      <div className="input-wrapper">
        {pendingFiles.length > 0 && (<div className="attachment-strip">{pendingFiles.map((file, idx) => (<div key={`${file.name}-${idx}`} className="attachment-chip"><span className="attachment-name">{file.name}</span><span className="attachment-size">{(file.size / 1024).toFixed(1)} KB</span><button type="button" onClick={() => setPendingFiles(p => p.filter((_, i) => i !== idx))} className="attachment-remove">×</button></div>))}</div>)}
        <div className="input-area">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading} className="attach-button toolbar-btn">📎</button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelected} />
          <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder={`Message as ${currentCharacter.name}...`} rows={3} className="chat-input" disabled={isLoading || !chatData} />
          <button type="button" onClick={isLoading ? stopGeneration : handleSend} disabled={!isLoading && (!inputText.trim() && pendingFiles.length === 0)} className="send-button counter">{isLoading ? '⏹ Stop' : 'Send'}</button>
        </div>
      </div>

      {isChatListOpen && (<ManagerModal title="Chat Sessions" items={allChats} isOpen={isChatListOpen} onClose={() => setIsChatListOpen(false)} onSelect={(c) => handleSwitchChat(c.id)} onDelete={(id) => handleDeleteChat({ stopPropagation: ()=>{} } as any, id)} onCreateNew={handleNewChat} renderSubtext={(c) => c.parentChatDataId ? `Branch of ${c.parentChatDataId.substring(0,8)}...` : `${c.chatMessageHistory.length} messages`} emptyMessage="No saved chat sessions found." />)}
      {isCharListOpen && (<ManagerModal title="Characters" items={allCharacters} isOpen={isCharListOpen} onClose={() => setIsCharListOpen(false)} onSelect={handleSelectCharacter} onDelete={handleDeleteCharacter} onCreateNew={handleCreateCharacter} renderSubtext={(c) => c.description || "No description"} emptyMessage="No characters found." />)}
      {isInstListOpen && (<ManagerModal title="Instructions" items={allInstructions} isOpen={isInstListOpen} onClose={() => setIsInstListOpen(false)} onSelect={handleSelectInstruction} onDelete={handleDeleteInstruction} onCreateNew={handleCreateInstruction} renderSubtext={(i) => i.content?.substring(0, 50) + "..."} emptyMessage="No instructions found." />)}
      {isSampListOpen && (<ManagerModal title="Samplers" items={allSamplers} isOpen={isSampListOpen} onClose={() => setIsSampListOpen(false)} onSelect={handleSelectSampler} onDelete={handleDeleteSampler} onCreateNew={handleCreateSampler} renderSubtext={(s) => `Temp: ${s.parameters?.temperature}, TopP: ${s.parameters?.top_p}`} emptyMessage="No samplers found." />)}
      {isStopListOpen && (<ManagerModal title="Stop Patterns" items={allStopPatterns} isOpen={isStopListOpen} onClose={() => setIsStopListOpen(false)} onSelect={handleSelectStopPattern} onDelete={handleDeleteStopPattern} onCreateNew={handleCreateStopPattern} renderSubtext={(s) => s.description || `Pattern: ${s.pattern}`} emptyMessage="No stop patterns found." />)}
    </div>
  );
}

export default App;