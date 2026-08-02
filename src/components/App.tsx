import React, { useState, useRef, useEffect } from 'react';
import { useChatSession } from '../hooks/useChatSession';
import type { ChatData, Character, Instruction, Sampler, StopPattern, Extension, ExtensionType } from '../types'; // ✅ Import Extension types
import { deleteMessage, massDeleteMessages, editMessage, branchMessage } from '../hooks/messageLogic';
import { deleteRawChatData, loadAllRawChatData, loadAllRawCharacters, loadAllRawInstructions, loadAllRawSamplers, loadAllRawStopPatterns, saveRawChatData } from '../hooks/storage';
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
  const [isParticipantsMode, setIsParticipantsMode] = useState(false);
  const [isInstListOpen, setIsInstListOpen] = useState(false);
  const [isInstManageMode, setIsInstManageMode] = useState(false);
  const [isExtListOpen, setIsExtListOpen] = useState(false);
  const [isSampListOpen, setIsSampListOpen] = useState(false);
  const [isStopListOpen, setIsStopListOpen] = useState(false);

  // ✅ Global Defaults
  const [defaultCharacterId, setDefaultCharacterId] = useState<string | null>(null);
  const [defaultInstructionIds, setDefaultInstructionIds] = useState<string[]>([]);

  const [allChats, setAllChats] = useState<ChatData[]>([]);
  const [allCharacters, setAllCharacters] = useState<Character[]>([]);
  const [allInstructions, setAllInstructions] = useState<Instruction[]>([]);
  const [allSamplers, setAllSamplers] = useState<Sampler[]>([]);
  const [allStopPatterns, setAllStopPatterns] = useState<StopPattern[]>([]);
  
  // ✅ Typed Mock Extensions
  const [allExtensions, setAllExtensions] = useState<Extension[]>([
    { id: 'ext_1', name: 'Auto-Translate', description: 'Translate responses to your language', extensionType: 'language_model_api' },
    { id: 'ext_2', name: 'TTS Reader', description: 'Read aloud using browser speech', extensionType: 'accessibility' },
    { id: 'ext_3', name: 'Scene Illustrator', description: 'Generate images from scene descriptions', extensionType: 'image_generation_api' },
    { id: 'ext_4', name: 'Dark Mode Toggle', description: 'Force dark mode for this session', extensionType: 'extra' },
    { id: 'ext_5', name: 'Sentiment Analysis', description: 'Tag messages with emotional context', extensionType: 'extra' },
  ]);
  
  const [inputText, setInputText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [massDeleteId, setMassDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Load Data & Defaults ---
  useEffect(() => {
    const loadData = async () => {
      const storedDefaultChar = localStorage.getItem('defaultCharacterId');
      if (storedDefaultChar) setDefaultCharacterId(storedDefaultChar);

      const storedDefaultInsts = localStorage.getItem('defaultInstructionIds');
      if (storedDefaultInsts) {
        try { setDefaultInstructionIds(JSON.parse(storedDefaultInsts)); } 
        catch (e) { console.error("Failed to parse default instructions", e); }
      }

      if (isChatListOpen) {
        const chats = await loadAllRawChatData();
        setAllChats(chats.sort((a, b) => b.last_updated_timestamp - a.last_updated_timestamp));
      }
      if (isCharListOpen || isParticipantsMode) {
        const chars = await loadAllRawCharacters();
        setAllCharacters(chars);
      }
      if (isInstListOpen || isInstManageMode) {
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

    if (isChatListOpen || isCharListOpen || isInstListOpen || isSampListOpen || isStopListOpen || isParticipantsMode || isInstManageMode || isExtListOpen) {
      loadData();
    }
  }, [isChatListOpen, isCharListOpen, isInstListOpen, isSampListOpen, isStopListOpen, isParticipantsMode, isInstManageMode, isExtListOpen]);

  // --- Handlers ---

  // 1. Chat Handlers
  const handleSwitchChat = (id: string) => {
    const selected = allChats.find(c => c.id === id);
    if (selected) { setChatData(selected); setCurrentCharacter(selected.protagonist); setIsChatListOpen(false); }
  };
  const handleNewChat = () => {
    let charToUse = currentCharacter;
    if (!charToUse && defaultCharacterId) {
        charToUse = allCharacters.find(c => c.id === defaultCharacterId) || null;
    }
    if (!charToUse && allChats.length > 0) {
        charToUse = allChats[0].protagonist;
    }
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

  // 2. Character Handlers
  const handleSelectCharacter = (char: Character) => {
    if (!isParticipantsMode) {
        if (chatData) {
          const updatedChat = { ...chatData, protagonist: char };
          if (!updatedChat.participants.find(p => p.id === char.id)) updatedChat.participants = [...updatedChat.participants, char];
          setChatData(updatedChat);
          setCurrentCharacter(char);
        } else { setCurrentCharacter(char); startNewChat(char); }
        setIsCharListOpen(false);
    }
  };
  const handleCreateCharacter = () => alert("Create Character Modal coming soon!");
  const handleDeleteCharacter = async (id: string) => {
    if (!window.confirm("Delete permanently?")) return;
    setAllCharacters(prev => prev.filter(c => c.id !== id));
  };

  const handleSetDefaultCharacter = (charId: string) => {
    setDefaultCharacterId(charId);
    localStorage.setItem('defaultCharacterId', charId);
    if (!isParticipantsMode) {
        const char = allCharacters.find(c => c.id === charId);
        if (char) setCurrentCharacter(char);
    }
  };

  // 3. Participant Handlers
  const handleOpenParticipants = () => {
    if (!chatData) return;
    setIsParticipantsMode(true);
  };

  const handleToggleParticipant = async (charId: string) => {
    if (!chatData) return;
    if (charId === chatData.protagonist.id) { alert("Cannot remove the protagonist."); return; }
    const currentIds = chatData.participants.map(p => p.id);
    let newIds = currentIds.includes(charId) ? currentIds.filter(id => id !== charId) : [...currentIds, charId];
    const newParticipants = allCharacters.filter(c => newIds.includes(c.id));
    if (!newParticipants.find(p => p.id === chatData.protagonist.id)) newParticipants.unshift(chatData.protagonist);
    const updatedChat = { ...chatData, participants: newParticipants };
    await saveRawChatData(updatedChat);
    setChatData(updatedChat);
    if (!newIds.includes(currentCharacter?.id)) setCurrentCharacter(updatedChat.protagonist);
  };

  const handleSetChatProtagonist = async (charId: string) => {
    if (!chatData) return;
    const char = allCharacters.find(c => c.id === charId);
    if (!char) return;
    const updatedChat = { ...chatData, protagonist: char };
    if (!updatedChat.participants.find(p => p.id === charId)) updatedChat.participants = [char, ...updatedChat.participants];
    await saveRawChatData(updatedChat);
    setChatData(updatedChat);
    setCurrentCharacter(char);
  };

  // 4. Instruction Handlers
  const handleOpenDefaultInstructions = () => { setIsInstListOpen(true); setIsInstManageMode(false); };
  const handleToggleDefaultInstruction = (instId: string) => {
    let newIds = defaultInstructionIds.includes(instId) ? defaultInstructionIds.filter(id => id !== instId) : [...defaultInstructionIds, instId];
    setDefaultInstructionIds(newIds);
    localStorage.setItem('defaultInstructionIds', JSON.stringify(newIds));
  };
  const handleOpenInstructionsManage = () => { if (!chatData) return; setIsInstManageMode(true); setIsInstListOpen(false); };
  const handleToggleChatInstruction = async (instId: string) => {
    if (!chatData) return;
    const currentIds = chatData.instructions?.map(i => i.id) || [];
    let newIds = currentIds.includes(instId) ? currentIds.filter(id => id !== instId) : [...currentIds, instId];
    const newInstructions = allInstructions.filter(i => newIds.includes(i.id));
    const updatedChat = { ...chatData, instructions: newInstructions };
    await saveRawChatData(updatedChat);
    setChatData(updatedChat);
  };
  const handleCreateInstruction = () => alert("Create Instruction Modal coming soon!");
  const handleDeleteInstruction = async (id: string) => {
    if (!window.confirm("Delete permanently?")) return;
    setAllInstructions(prev => prev.filter(i => i.id !== id));
  };

  // ✅ 5. Extension Handlers
  const handleOpenExtensions = () => { if (!chatData) return; setIsExtListOpen(true); };

  const handleToggleExtension = async (extId: string) => {
    if (!chatData) return;
    const currentIds = (chatData as any).extensions?.map((e: any) => e.id) || [];
    let newIds = currentIds.includes(extId) ? currentIds.filter(id => id !== extId) : [...currentIds, extId];
    const newExtensions = allExtensions.filter(e => newIds.includes(e.id));
    const updatedChat = { ...chatData, extensions: newExtensions } as any;
    await saveRawChatData(updatedChat);
    setChatData(updatedChat);
  };

  const handleCreateExtension = () => alert("Create Extension Modal coming soon!");
  const handleDeleteExtension = async (id: string) => {
    if (!window.confirm("Delete extension permanently?")) return;
    setAllExtensions(prev => prev.filter(e => e.id !== id));
  };

  // 6. Sampler Handlers
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

  // 7. Stop Pattern Handlers
  const handleSelectStopPattern = (stop: StopPattern) => { alert(`Selected: ${stop.pattern}`); setIsStopListOpen(false); };
  const handleCreateStopPattern = () => alert("Create Stop Pattern Modal coming soon!");
  const handleDeleteStopPattern = async (id: string) => {
    if (!window.confirm("Delete?")) return;
    setAllStopPatterns(prev => prev.filter(s => s.id !== id));
  };

  // Standard Message Handlers
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

  // ✅ Helper to format Type Badge
  const renderExtensionSubtext = (ext: Extension) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: '3px', opacity: 0.8 }}>
      <span style={{ fontSize: '0.65rem', background: 'var(--border)', padding: '2px 3px', borderRadius: '4px', textTransform: 'uppercase' }}>
        {/* ✅ Use Regex with 'g' flag to replace ALL underscores */}
        {ext.extensionType.replace(/_/g, ' ')}
      </span>
      <span>{ext.description}</span>
    </span>
  );

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
            <button type="button" className="nav-btn" onClick={() => { setIsParticipantsMode(false); setIsCharListOpen(true); }}>🎭 Characters</button>
            <button type="button" className="nav-btn" onClick={handleOpenDefaultInstructions}>📜 Instructions</button>
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
        <button type="button" className="context-btn" onClick={handleOpenParticipants}>👥 Participants ({chatData?.participants.length || 0})</button>
        <button type="button" className="context-btn" onClick={handleOpenInstructionsManage}>📜 Instructions ({chatData?.instructions?.length || 0})</button>
        <button type="button" className="context-btn" onClick={handleOpenExtensions}>
          🧩 Extensions ({(chatData as any)?.extensions?.length || 0})
        </button>
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

      {/* === MODALS === */}
      
      {/* Chat List */}
      {isChatListOpen && (<ManagerModal title="Chat Sessions" items={allChats} isOpen={isChatListOpen} onClose={() => setIsChatListOpen(false)} onSelect={(c) => handleSwitchChat(c.id)} onDelete={(id) => handleDeleteChat({ stopPropagation: ()=>{} } as any, id)} onCreateNew={handleNewChat} renderSubtext={(c) => c.parentChatDataId ? `Branch of ${c.parentChatDataId.substring(0,8)}...` : `${c.chatMessageHistory.length} messages`} emptyMessage="No saved chat sessions found." />)}

      {/* Characters */}
      {(isCharListOpen || isParticipantsMode) && (
        <ManagerModal
          title="Characters"
          items={allCharacters}
          isOpen={isCharListOpen || isParticipantsMode}
          onClose={() => { setIsCharListOpen(false); setIsParticipantsMode(false); }}
          onSelect={isParticipantsMode ? undefined : handleSelectCharacter}
          onDelete={isParticipantsMode ? undefined : handleDeleteCharacter}
          onCreateNew={handleCreateCharacter}
          renderSubtext={(c) => c.description || "No description"}
          emptyMessage="No characters found."
          actionLabel="Delete"
          orderedListMode={isParticipantsMode}
          currentOrderIds={chatData?.participants.map(p => p.id) || []}
          onToggleOrder={handleToggleParticipant}
          specialActionIcon="★"
          onSpecialAction={isParticipantsMode ? handleSetChatProtagonist : handleSetDefaultCharacter}
          specialActionTooltip={(c) => isParticipantsMode ? `set ${c.name} as the protagonist` : `set ${c.name} as the default for new chats`}
          activeSpecialActionId={isParticipantsMode ? chatData?.protagonist.id : defaultCharacterId || undefined}
        />
      )}

      {/* Instructions */}
      {(isInstListOpen || isInstManageMode) && (
        <ManagerModal
          title="Instructions"
          items={allInstructions}
          isOpen={isInstListOpen || isInstManageMode}
          onClose={() => { setIsInstListOpen(false); setIsInstManageMode(false); }}
          onSelect={undefined}
          onDelete={undefined}
          onCreateNew={handleCreateInstruction}
          renderSubtext={(i) => `${i.content?.substring(0, 50)}...`}
          emptyMessage="No instructions found."
          actionLabel="Delete"
          orderedListMode={true}
          currentOrderIds={isInstManageMode ? (chatData?.instructions?.map(i => i.id) || []) : defaultInstructionIds}
          onToggleOrder={isInstManageMode ? handleToggleChatInstruction : handleToggleDefaultInstruction}
        />
      )}

      {/* ✅ Extensions Modal with Type Badges */}
      {isExtListOpen && (
        <ManagerModal
          title="Extensions"
          items={allExtensions}
          isOpen={isExtListOpen}
          onClose={() => setIsExtListOpen(false)}
          onSelect={undefined}
          onDelete={handleDeleteExtension}
          onCreateNew={handleCreateExtension}
          renderSubtext={renderExtensionSubtext}
          emptyMessage="No extensions available."
          actionLabel="Delete"
          orderedListMode={true}
          currentOrderIds={(chatData as any)?.extensions?.map((e: any) => e.id) || []}
          onToggleOrder={handleToggleExtension}
        />
      )}

      {/* Samplers */}
      {isSampListOpen && (<ManagerModal title="Samplers" items={allSamplers} isOpen={isSampListOpen} onClose={() => setIsSampListOpen(false)} onSelect={handleSelectSampler} onDelete={handleDeleteSampler} onCreateNew={handleCreateSampler} renderSubtext={(s) => `Temp: ${s.parameters?.temperature}, TopP: ${s.parameters?.top_p}`} emptyMessage="No samplers found." />)}

      {/* Stop Patterns */}
      {isStopListOpen && (<ManagerModal title="Stop Patterns" items={allStopPatterns} isOpen={isStopListOpen} onClose={() => setIsStopListOpen(false)} onSelect={handleSelectStopPattern} onDelete={handleDeleteStopPattern} onCreateNew={handleCreateStopPattern} renderSubtext={(s) => s.description || `Pattern: ${s.pattern}`} emptyMessage="No stop patterns found." />)}
    </div>
  );
}

export default App;