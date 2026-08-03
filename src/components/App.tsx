// src/App.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useChatSession } from '../hooks/useChatSession';
import { useChatListManager } from '../hooks/useChatListManager';
import { useCharacterManager } from '../hooks/useCharacterManager';
import { useContextManager } from '../hooks/useContextManager';
import { useSamplerManager } from '../hooks/useSamplerManager';
import { useStopPatternManager } from '../hooks/useStopPatternManager';
import { useModelManager } from '../hooks/useModelManager';
import { useBudgetStrategyManager } from '../hooks/useBudgetStrategyManager';
import { useExtensionManager } from '../hooks/useExtensionManager';
import { useEntityModal } from '../hooks/useEntityModal';
import { useToast } from '../context/ToastContext';

import type { ChatData, Character, Context, Sampler, StopPattern, Extension, LanguageModel, BudgetStrategy } from '../types';
import { deleteMessage, massDeleteMessages, editMessage, branchMessage } from '../hooks/messageLogic';
import { saveRawChatData, loadRawChatData } from '../hooks/storage';
import { getCharacterImageUrl } from '../hooks/storage';
import { getDelayedDisplayName } from '../hooks/immersionLogic';
import { ChatStatisticsBar } from './ChatStatisticsBar';
import { ManagerModal } from './ManagerModal';
import { CharacterEditorModal } from './CharacterEditorModal';
import { ModelEditorModal } from './ModelEditorModal';
import { SamplerEditorModal } from './SamplerEditorModal';
import { ContextEditorModal } from './ContextEditorModal';
import { StopPatternEditorModal } from './StopPatternEditorModal';
import { BudgetStrategyEditorModal } from './BudgetStrategyEditorModal';
import './main.css';

// ✅ 1. Define the Action Labels - these are displayed as-is
const ACTION_LABELS = [
  'Hug', 'Kiss', 'Slap', 'Push Away', 'Touch', 'Grab',
  'Wave', 'Poke', 'Fish', 'Dance', 'Sing', 'Whisper',
  'Shout', 'Whistle', 'Cough', 'Sneeze', 'Laugh', 'Cry',
  'Sigh', 'Stretch', 'Yawn', 'Bow', 'Nod', 'Shake',
  'Point', 'Wink', 'Blush', 'Frown', 'Smile', 'Grin', 'Pout'
];

interface NavButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
}
function NavButton({ icon, label, onClick }: NavButtonProps) {
  return (
    <button type="button" className="nav-btn" onClick={onClick}>
      <span style={{ marginRight: '6px' }}>{icon}</span>
      {label}
    </button>
  );
}

function App() {
  const { 
    chatData, setChatData, currentCharacter, setCurrentCharacter,
    isLoading, streamingText, streamingCharacter, sendMessage, stopGeneration,
    regenerateLastAI, regenerateLastProtagonist, messageEndRef, parentChatMessageIds,
    generationSpeed, messageCount, tokenCount, maximumNumberOfTokens, startNewChat,
    numberOfCacheInvalidations,
    numberOfRequests,
    totalCost,
    costWithoutCacheMisses,
    sendActionAndGetResponse
  } = useChatSession();

  const { addToast } = useToast();

  // --- Data Managers ---
  const { chats: allChats, deleteChat: deleteChatFromList, refresh: refreshChatList } = useChatListManager();
  const { characters: allCharacters, saveCharacter, deleteCharacter } = useCharacterManager();
  const { contexts: allContexts, saveContext, deleteContext } = useContextManager();
  const { Samplers: allSamplers, saveSampler, deleteSampler } = useSamplerManager();
  const { stopPatterns: allStopPatterns, saveStopPattern, deleteStopPattern } = useStopPatternManager();
  const { models: allModels, saveModel, deleteModel } = useModelManager();
  const { strategies: allBudgetStrategies, saveStrategy: saveBudgetStrategy, deleteStrategy: deleteBudgetStrategy } = useBudgetStrategyManager();
  const { extensions: allExtensions, deleteExtension } = useExtensionManager();

  // --- UI State ---
  const [isChatListOpen, setIsChatListOpen] = useState(false);
  const [isCharListOpen, setIsCharListOpen] = useState(false);
  const [isContextListMode, setIsContextListMode] = useState(false);
  const [isSampListOpen, setIsSampListOpen] = useState(false);
  const [isExtListOpen, setIsExtListOpen] = useState(false);
  const [isModelListOpen, setIsModelListOpen] = useState(false);
  const [isStopListOpen, setIsStopListOpen] = useState(false);
  const [isBudgetStrategyListOpen, setIsBudgetStrategyListOpen] = useState(false);
  
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedBudgetStrategyId, setSelectedBudgetStrategyId] = useState<string | null>(null);
  const [defaultCharacterId, setDefaultCharacterId] = useState<string | null>(null);
  const [defaultContextIds, setDefaultContextIds] = useState<string[]>([]);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');

  // ✅ 2. Action Menu State - use message ID to uniquely identify which avatar was clicked
  const [actionMenuTarget, setActionMenuTarget] = useState<{ messageId: string, charId: string, x: number, y: number } | null>(null);

  // --- Generic Modal Hooks ---
  const charModal = useEntityModal<Character>(saveCharacter, deleteCharacter, 'Character');
  const contextModal = useEntityModal<Context>(saveContext, deleteContext, 'Context');
  const sampleModal = useEntityModal<Sampler>(saveSampler, deleteSampler, 'Sampler');
  const stopModal = useEntityModal<StopPattern>(saveStopPattern, deleteStopPattern, 'Stop Pattern');
  const modelModal = useEntityModal<LanguageModel>(saveModel, deleteModel, 'Model');
  const budgetModal = useEntityModal<BudgetStrategy>(saveBudgetStrategy, deleteBudgetStrategy, 'Budget Strategy');

  const [isSamplerEditorOpen, setIsSamplerEditorOpen] = useState(false);
  const [samplerToEdit, setSamplerToEdit] = useState<Sampler | null>(null);
  
  const [inputText, setInputText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [massDeleteId, setMassDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- State for branch source chat title
  const [branchSourceTitle, setBranchSourceTitle] = useState<string | null>(null);

  // --- Load Non-Hook Data ---
  useEffect(() => {
    const loadData = async () => {
      const storedDefaultChar = localStorage.getItem('defaultCharacterId');
      if (storedDefaultChar) setDefaultCharacterId(storedDefaultChar);
    };
    loadData();
  }, []);

  // ✅ Load branch source chat title when chatData changes
  useEffect(() => {
    const loadBranchSource = async () => {
      if (chatData?.parentChatDataId) {
        try {
          const sourceChat = await loadRawChatData(chatData.parentChatDataId);
          if (sourceChat) {
            setBranchSourceTitle(sourceChat.title || 'Untitled Chat');
          } else {
            setBranchSourceTitle(null);
          }
        } catch (err) {
          console.error("Failed to load branch source:", err);
          setBranchSourceTitle(null);
        }
      } else {
        setBranchSourceTitle(null);
      }
    };
    loadBranchSource();
  }, [chatData?.parentChatDataId]);

  useEffect(() => {
      if(defaultCharacterId) {
          const char = allCharacters.find(c => c.id === defaultCharacterId);
          if(char && currentCharacter?.id !== char.id) setCurrentCharacter(char);
      }
  }, [defaultCharacterId, allCharacters, currentCharacter?.id, setCurrentCharacter]);

  // --- Handlers ---

  const handleSwitchChat = (id: string) => {
    const selected = allChats.find(c => c.id === id);
    if (selected) { 
      setChatData(selected); 
      setCurrentCharacter(selected.protagonist);
      refreshChatList();
      setIsChatListOpen(false);
    }
  };

  const handleNewChat = () => {
    let charToUse = currentCharacter;
    if (!charToUse && defaultCharacterId) charToUse = allCharacters.find(c => c.id === defaultCharacterId) || null;
    if (!charToUse && allChats.length > 0) charToUse = allChats[0].protagonist;
    if (charToUse) { 
      startNewChat(charToUse);
      refreshChatList();
      setIsChatListOpen(false);
    }
  };

  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this session?")) return;
    const success = await deleteChatFromList(id);
    if (success) {
      addToast("Chat session deleted.", "info");
      if (chatData?.id === id) startNewChat(currentCharacter!);
    } else {
      addToast("Failed to delete chat.", "error");
    }
  };

  const handleSetDefaultCharacter = (charId: string) => {
    setDefaultCharacterId(charId);
    localStorage.setItem('defaultCharacterId', charId);
    const char = allCharacters.find(c => c.id === charId);
    if (char) {
      setCurrentCharacter(char);
      addToast(`Default character set to ${char.name}`, "info");
    }
  };

  const handleOpenCharacterManager = () => {
    setIsCharListOpen(true);
  };

  const handleToggleParticipant = async (charId: string) => {
    if (!chatData) return;
    if (charId === chatData.protagonist.id) { 
      addToast("Cannot remove the protagonist.", "error"); 
      return; 
    }
    const currentIds = chatData.participants.map(p => p.id);
    let newIds = currentIds.includes(charId) ? currentIds.filter(id => id !== charId) : [...currentIds, charId];
    const newParticipants = allCharacters.filter(c => newIds.includes(c.id));
    if (!newParticipants.find(p => p.id === chatData.protagonist.id)) newParticipants.unshift(chatData.protagonist);
    
    const updatedChat = { ...chatData, participants: newParticipants };
    setChatData(updatedChat);
    
    if (!newIds.includes(currentCharacter?.id)) setCurrentCharacter(updatedChat.protagonist);
    addToast("Participants updated (Session Only).", "info");
  };

  const handleSetChatProtagonist = async (charId: string) => {
    if (!chatData) return;
    const char = allCharacters.find(c => c.id === charId);
    if (!char) return;
    const updatedChat = { ...chatData, protagonist: char };
    if (!updatedChat.participants.find(p => p.id === charId)) updatedChat.participants = [char, ...updatedChat.participants];
    
    setChatData(updatedChat);
    setCurrentCharacter(char);
    addToast("Protagonist switched (Session Only).", "info");
  };

  const handleToggleDefaultContext = (contextId: string) => {
    let newIds = defaultContextIds.includes(contextId) ? defaultContextIds.filter(id => id !== contextId) : [...defaultContextIds, contextId];
    setDefaultContextIds(newIds);
    localStorage.setItem('defaultContextIds', JSON.stringify(newIds));
    addToast("Default contexts updated.", "info");
  };

  const handleToggleChatContext = async (contextId: string) => {
    if (!chatData) return;
    const currentIds = chatData.contexts?.map(i => i.id) || [];
    let newIds = currentIds.includes(contextId) ? currentIds.filter(id => id !== contextId) : [...currentIds, contextId];
    const newContexts = allContexts.filter(i => newIds.includes(i.id));
    
    const updatedChat = { ...chatData, contexts: newContexts };
    setChatData(updatedChat);
    addToast("Contexts updated (Session Only).", "info");
  };

  const handleOpenExtensions = () => { if (!chatData) return; setIsExtListOpen(true); };
  const handleToggleExtension = async (extId: string) => {
    if (!chatData) return;
    const currentIds = (chatData as any).extensions?.map((e: any) => e.id) || [];
    let newIds = currentIds.includes(extId) ? currentIds.filter(id => id !== extId) : [...currentIds, extId];
    const newExtensions = allExtensions.filter(e => newIds.includes(e.id));
    
    const updatedChat = { ...chatData, extensions: newExtensions } as any;
    setChatData(updatedChat);
    addToast("Extensions updated (Session Only).", "info");
  };
  const handleCreateExtension = () => addToast("Create Extension Modal coming soon!", "info");
  
  const handleSelectModel = (model: LanguageModel) => {
    setSelectedModelId(model.id);
    addToast(`Switched to ${model.name}.`, "info");
    setIsModelListOpen(false);
  };

  const handleOpenSamplerEditor = (sampler?: Sampler) => {
    setSamplerToEdit(sampler || null);
    setIsSamplerEditorOpen(true);
    setIsSampListOpen(false);
  };

  const handleActivateBudgetStrategy = (strategyId: string) => {
    if (selectedBudgetStrategyId === strategyId) {
      setSelectedBudgetStrategyId(null);
      addToast("Budget strategy deactivated.", "info");
    } else {
      setSelectedBudgetStrategyId(strategyId);
      const strategy = allBudgetStrategies.find(s => s.id === strategyId);
      addToast(`Budget strategy "${strategy?.name}" activated!`, "success");
    }
  };

  const handleStartEditTitle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitleValue(chatData?.title || '');
    setIsEditingTitle(true);
  };

  const handleSaveTitle = () => {
    if (!chatData) return;
    const newTitle = editTitleValue.trim() || 'Untitled Chat';
    const updatedChat = { ...chatData, title: newTitle };
    setChatData(updatedChat);
    saveRawChatData(updatedChat);
    refreshChatList();
    setIsEditingTitle(false);
    addToast("Chat title updated", "success");
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
      addToast("Message edited.", "success");
    } catch (err) { 
      if ((err as Error).message.includes("branch") || (err as Error).message.includes("stem")) {
        addToast((err as Error).message, "error");
      } else {
        addToast("Failed to edit message.", "error");
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!chatData) return;
    try { 
      const updated = await deleteMessage(chatData, id); 
      setChatData(updated); 
      addToast("Message deleted.", "info");
    } catch (err) { 
      if ((err as Error).message.includes("branch") || (err as Error).message.includes("stem")) {
        addToast((err as Error).message, "error");
      } else {
        addToast("Failed to delete message.", "error");
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
      addToast("Messages deleted.", "info");
    } catch (err) { 
      if ((err as Error).message.includes("branch") || (err as Error).message.includes("stem")) {
        addToast((err as Error).message, "error");
      } else {
        addToast("Failed to delete messages.", "error");
      }
    }
  };

  // ✅ In-app branch switching - no page reload
  const handleBranch = async (id: string) => {
    if (!chatData) return;
    try { 
      const branchedChat = await branchMessage(chatData, id);
      // ✅ Switch in-app
      setChatData(branchedChat);
      setCurrentCharacter(branchedChat.protagonist);
      refreshChatList();
      addToast(`Branched to "${branchedChat.title}"`, "success");
    } catch (err) { 
      addToast("Failed to branch chat.", "error");
    }
  };

  // ✅ In-app navigation back to source chat - no page reload
  const handleNavigateToSource = async () => {
    if (!chatData?.parentChatDataId) return;
    try {
      const sourceChat = await loadRawChatData(chatData.parentChatDataId);
      if (sourceChat) {
        setChatData(sourceChat);
        setCurrentCharacter(sourceChat.protagonist);
        refreshChatList();
        addToast(`Navigated back to "${sourceChat.title || 'Untitled Chat'}"`, "info");
      } else {
        addToast("Source chat not found.", "error");
      }
    } catch (err) {
      console.error("Failed to load source chat:", err);
      addToast("Failed to navigate to source chat.", "error");
    }
  };

  const handleSend = () => { if (!inputText.trim()) return; sendMessage(inputText); setInputText(''); setPendingFiles([]); };

  // ✅ 3. Action Interjection Handler - uses the label directly
  const handleActionInterject = async (actionLabel: string, targetChar: Character) => {
    setActionMenuTarget(null); // Close menu

    if (!chatData || !currentCharacter) return;

    const actionText = `*${actionLabel} ${targetChar.name}.*`;

    // Scenario A: Mid-Sentence Interruption - AI is currently generating
    if (isLoading && streamingCharacter && streamingCharacter.id === targetChar.id) {
      // 1. Stop the generation immediately
      stopGeneration();
      
      // 2. Wait for the stream to fully stop
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 3. Send the action and get AI response
      await sendActionAndGetResponse(actionText, targetChar);
    } else {
      // Scenario B: Idle State (Normal Action)
      // Just send the action as a normal message
      sendMessage(actionText);
    }
  };

  // ✅ 4. Avatar Click Handler - uses message ID to uniquely identify which avatar was clicked
  const handleAvatarClick = (e: React.MouseEvent, messageId: string, char: Character) => {
    e.stopPropagation();
    // Toggle menu if clicking same message, else open new
    if (actionMenuTarget?.messageId === messageId) {
      setActionMenuTarget(null);
    } else {
      setActionMenuTarget({
        messageId: messageId,
        charId: char.id,
        x: e.clientX,
        y: e.clientY
      });
    }
  };

  // ✅ 5. Render Action Menu Component (reusable) - with scrollable action list
  const renderActionMenu = (messageId: string, character: Character) => {
    if (!actionMenuTarget || actionMenuTarget.messageId !== messageId) return null;
    
    return (
      <div style={{
        position: 'absolute',
        left: '100%',
        top: '0',
        marginLeft: '10px',
        width: '180px',
        maxHeight: '400px',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <div style={{ 
          padding: '6px 10px', 
          fontSize: '0.65rem', 
          fontWeight: 'bold', 
          borderBottom: '1px solid var(--border)', 
          opacity: 0.7, 
          background: 'var(--social-bg)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <span>{'INTERJECT ACTION'}</span>
        </div>
        <div style={{
          overflowY: 'auto',
          maxHeight: '340px',
          flexShrink: 1
        }}>
          {ACTION_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => handleActionInterject(label, character)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                padding: '8px 10px',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--text-h)',
                fontSize: '0.8rem',
                transition: 'all 0.2s',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--social-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ✅ 6. Helper function to check if a message is a stem (locked) message
  const isStemMessage = (messageId: string): boolean => {
    // If there's no parent chat message, there's no branch
    if (!chatData?.parentChatMessageId) return false;
    
    // Find the index of the branch point
    const branchIndex = chatData.chatMessageHistory.findIndex(
      m => m.id === chatData.parentChatMessageId
    );
    
    // If branch point not found, nothing is a stem
    if (branchIndex === -1) return false;
    
    // Find the index of the current message
    const currentIndex = chatData.chatMessageHistory.findIndex(
      m => m.id === messageId
    );
    
    // Messages from index 0 to branchIndex (inclusive) are stems
    return currentIndex !== -1 && currentIndex <= branchIndex;
  };

  if (!currentCharacter || !chatData) return <div className="loading-screen">Initializing...</div>;

  const isMassActive = massDeleteId !== null;
  const startIndex = isMassActive ? chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId) : -1;
  const branchOffIndex = chatData.parentChatMessageId ? chatData.chatMessageHistory.findIndex(m => m.id === chatData.parentChatMessageId) : -1;

  const renderModelSubtext = (model: LanguageModel) => {
    const isMultiModal = !!model.mmproj; 
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 }}>
        {isMultiModal && <span style={{ fontSize: '0.7rem', background: '#8b5cf6', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Multi-Modal</span>}
        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Context: {(model.contextLength / 1024).toFixed(0)}k</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Backend: {model.backend || 'other'}</span>
        <span>{model.description}</span>
      </span>
    );
  };

  const renderBudgetStrategySubtext = (strategy: BudgetStrategy) => {
    const isActive = selectedBudgetStrategyId === strategy.id;
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 }}>
        {isActive && <span style={{ fontSize: '0.7rem', background: '#ffd700', color: '#000', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>Active</span>}
        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Online: {strategy.switchProbabilty}% • Budget: ${strategy.maximumBudget}</span>
      </span>
    );
  };

  return (
    <div className="chat-container" onClick={() => setActionMenuTarget(null)}>
      <header className="app-header">
        <div className="header-content">
          <div className="header-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'flex-start' }}>
              {isEditingTitle ? (
                <input
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  autoFocus
                  style={{
                    background: 'var(--social-bg)',
                    border: '1px solid var(--accent)',
                    color: 'var(--text-h)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    flexGrow: 1,
                    maxWidth: '300px',
                    outline: 'none',
                  }}
                />
              ) : (
                <>
                  <div className="header-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>
                    {chatData?.name || "Untitled Chat"}
                  </div>
                  <span onClick={handleStartEditTitle} title="Edit Title" style={{ fontSize: '0.9em', opacity: 0.5, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.opacity = '1'} onMouseLeave={(e) => e.currentTarget.style.opacity = '0.5'}>✎</span>
                </>
              )}
            </div>

            <ChatStatisticsBar generationSpeed={generationSpeed} messageCount={messageCount} tokenCount={tokenCount} maximumNumberOfTokens={maximumNumberOfTokens} numberOfCacheInvalidations={numberOfCacheInvalidations} numberOfRequests={numberOfRequests} totalCost={totalCost} costWithoutCacheMisses={costWithoutCacheMisses} />
          </div>
        </div>
      </header>

      <div className="chat-history">
        {chatData?.chatMessageHistory.map((message, index) => {
          const isProtagonist = message.character.id === currentCharacter.id;
          const displayName = getDelayedDisplayName(chatData, index, message.character.id);
          const avatarSrc = !isProtagonist ? getCharacterImageUrl(message.character.image) : null;
          const aiParticipantIds = new Set(chatData.participants.filter(p => p.id !== currentCharacter.id).map(p => p.id));
          const isLastAI = !isProtagonist && !chatData.chatMessageHistory.slice(index + 1).some(m => aiParticipantIds.has(m.character.id));
          const isLastProtag = isProtagonist;
          const isEditing = editingId === message.id;
          const isMassStart = message.id === massDeleteId;
          const isInDeletionRange = isMassActive && startIndex !== -1 && index >= startIndex;
          
          // ✅ Use the helper function to check if this message is a stem
          const isStem = isStemMessage(message.id);
          
          const isJustBeforeBranchOff = chatData.parentChatMessageId && index === branchOffIndex;

          return (
            <React.Fragment key={message.id}>
              <div className={`message-row ${isProtagonist ? 'message-right' : 'message-left'} ${isInDeletionRange ? 'message-fading-out' : ''}`}>
                {!isProtagonist && (
                  <div className="avatar-column">
                    <div style={{ position: 'relative' }}>
                      {avatarSrc ? (
                        <img 
                          src={avatarSrc} 
                          alt={displayName} 
                          className="character-avatar" 
                          onClick={(e) => handleAvatarClick(e, message.id, message.character)}
                          onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} 
                          style={{ cursor: 'pointer' }}
                        />
                      ) : (
                        <div 
                          className="character-avatar placeholder" 
                          onClick={(e) => handleAvatarClick(e, message.id, message.character)}
                          style={{ cursor: 'pointer' }}
                        />
                      )}
                      {renderActionMenu(message.id, message.character)}
                    </div>
                    <span className="avatar-name">{displayName}</span>
                  </div>
                )}
                <div className={`message-bubble ${isProtagonist ? 'bubble-user' : 'bubble-ai'} ${isEditing ? 'bubble-editing' : ''} ${isInDeletionRange ? 'bubble-marked-for-delete' : ''} ${isStem ? 'bubble-stem' : ''}`}>
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
                        {isStem ? (
                          <span className="toolbar-lock">🔒 Locked</span>
                        ) : !isMassActive ? (
                          <>
                            <button type="button" onClick={() => { setEditingId(message.id); setEditDraft(message.textContent); }} className="toolbar-btn">✎</button>
                            {(isLastAI || isLastProtag) && (<button type="button" onClick={isLastAI ? regenerateLastAI : regenerateLastProtagonist} className="toolbar-btn">↻</button>)}
                            <button type="button" onClick={() => handleBranch(message.id)} className="toolbar-btn">⑂</button>
                            <button type="button" onClick={() => handleDelete(message.id)} className="toolbar-btn delete-btn" style={{ color: '#ff4444' }}>🗑</button>
                            <button type="button" onClick={() => setMassDeleteId(message.id)} className="toolbar-btn mass-delete-btn" style={{ color: '#ff9900' }}>🗑️↓</button>
                          </>
                        ) : isMassStart ? (
                          <div className="mass-delete-confirm-bar">
                            <span>Delete from here?</span>
                            <button type="button" onClick={handleMassDeleteConfirm} className="toolbar-btn btn-confirm">Confirm</button>
                            <button type="button" onClick={() => setMassDeleteId(null)} className="toolbar-btn btn-cancel">Cancel</button>
                          </div>
                        ) : isInDeletionRange ? (<span className="deleted-preview-label">Will be deleted</span>) : null}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {isJustBeforeBranchOff && (
                <div 
                  className="branch-separator-line clickable" 
                  onClick={handleNavigateToSource}
                  title={`Click to go back to "${branchSourceTitle || 'source chat'}"`}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="branch-separator-content">
                    <span className="branch-separator-icon">🌿</span>
                    <span className="branch-separator-text">
                      {branchSourceTitle ? `Branches From "${branchSourceTitle}"` : 'Conversation Branches Here'}
                    </span>
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
              <div style={{ position: 'relative' }}>
                {streamingCharacter.image ? (
                  <img 
                    src={getCharacterImageUrl(streamingCharacter.image)!} 
                    alt={getDelayedDisplayName(chatData, chatData.chatMessageHistory.length, streamingCharacter.id)} 
                    className="character-avatar" 
                    onClick={(e) => handleAvatarClick(e, 'streaming-message', streamingCharacter)}
                    style={{ cursor: 'pointer' }}
                  />
                ) : (
                  <div 
                    className="character-avatar placeholder" 
                    onClick={(e) => handleAvatarClick(e, 'streaming-message', streamingCharacter)}
                    style={{ cursor: 'pointer' }}
                  />
                )}
                {renderActionMenu('streaming-message', streamingCharacter)}
              </div>
              <span className="avatar-name">{getDelayedDisplayName(chatData, chatData.chatMessageHistory.length, streamingCharacter.id)}</span>
            </div>
            <div className="message-bubble bubble-ai">
              <div style={{ display: 'inline', whiteSpace: 'pre-wrap' }}>
                <span className="message-text" style={{ display: 'inline' }}>{streamingText}</span>
                <span className="cursor-blink" style={{ display: 'inline' }}>&nbsp;▋</span>
              </div>
            </div>
          </div>
        )}
        {chatData && chatData.chatMessageHistory.length === 0 && (<div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}><p>Start the conversation as {currentCharacter.name}.</p></div>)}
        <div ref={messageEndRef} style={{ height: '1px' }} />
      </div>

      {/* ✅ Bottom Bar - All navigation buttons moved here */}
      <div className="context-bar">
        <NavButton icon="💬" label="Chat List" onClick={() => setIsChatListOpen(true)} />
        <NavButton icon="🎭" label="Characters" onClick={handleOpenCharacterManager} />
        <NavButton icon="🌍" label="Contexts" onClick={() => { setIsContextListMode(true) }} />
        <NavButton icon="🤖" label="Models" onClick={() => setIsModelListOpen(true)} />
        <NavButton icon="🎚️" label="Samplers" onClick={() => setIsSampListOpen(true)} />
        <NavButton icon="🛑" label="Stop Patterns" onClick={() => setIsStopListOpen(true)} />
        <NavButton icon="💰" label="Budget" onClick={() => setIsBudgetStrategyListOpen(true)} />
        <NavButton icon="🧩" label="Extensions" onClick={handleOpenExtensions} />
      </div>

      <div className="input-wrapper">
        {pendingFiles.length > 0 && (
          <div className="attachment-strip">
            {pendingFiles.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="attachment-chip">
                <span className="attachment-name">{file.name}</span>
                <span className="attachment-size">{(file.size / 1024).toFixed(1)} KB</span>
                <button type="button" onClick={() => setPendingFiles(p => p.filter((_, i) => i !== idx))} className="attachment-remove">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="input-area">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading} className="attach-button toolbar-btn">📎</button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelected} />
          <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder={`Message as ${currentCharacter.name}...`} rows={3} className="chat-input" disabled={isLoading || !chatData} />
          <button type="button" onClick={isLoading ? stopGeneration : handleSend} disabled={!isLoading && (!inputText.trim() && pendingFiles.length === 0)} className="send-button counter">{isLoading ? '⏹ Stop' : 'Send'}</button>
        </div>
      </div>

      {/* Modals */}
      {isChatListOpen && (<ManagerModal title="Chat Sessions" items={allChats} isOpen={isChatListOpen} onClose={() => setIsChatListOpen(false)} onSelect={(c) => handleSwitchChat(c.id)} onDelete={(id) => handleDeleteChat({ stopPropagation: ()=>{} } as any, id)} onCreateNew={handleNewChat} renderSubtext={(c) => c.parentChatDataId ? `Branch of ${c.parentChatDataId.substring(0,8)}...` : `${c.chatMessageHistory.length} messages`} emptyMessage="No saved chat sessions found." />)}
      
      {/* ✅ Characters modal - always shows participants functionality when in a chat */}
      {isCharListOpen && (
        <ManagerModal 
          title="Characters" 
          items={allCharacters} 
          isOpen={isCharListOpen} 
          onClose={() => setIsCharListOpen(false)} 
          onSelect={(char) => charModal.open(char)} 
          onDelete={deleteCharacter} 
          onCreateNew={() => charModal.open()} 
          renderSubtext={(c) => c.description || "No description"} 
          emptyMessage="No characters found." 
          actionLabel="Delete" 
          orderedListMode={!!chatData} 
          currentOrderIds={chatData?.participants.map(p => p.id) || []} 
          onToggleOrder={handleToggleParticipant} 
          specialActionIcon="★" 
          onSpecialAction={handleSetChatProtagonist} 
          specialActionTooltip={(c) => `set ${c.name} as the protagonist`} 
          activeSpecialActionId={chatData?.protagonist.id} 
        />
      )}
      {charModal.isOpen && (<CharacterEditorModal isOpen={charModal.isOpen} onClose={charModal.close} onSave={charModal.handleSave} existingCharacter={charModal.itemToEdit} allSamplers={allSamplers} />)}
      
      {/* ✅ Contexts modal - always shows active contexts functionality when in a chat */}
      {(contextModal.isOpen || isContextListMode) && (
        <ManagerModal 
          title={"Contexts"} 
          items={allContexts} 
          isOpen={isContextListMode} 
          onClose={() => { setIsContextListMode(false); }} 
          onSelect={(context) => contextModal.open(context)} 
          onDelete={contextModal.handleDelete} 
          onCreateNew={() => contextModal.open()} 
          renderSubtext={(i) => { const contentPreview = i.text?.substring(0, 50) || ''; const hasRegex = i.regularExpressionTrigger ? '🔍' : '📌'; const hasImages = i.images && i.images.length > 0 ? '🖼️' : ''; return `${hasRegex} ${hasImages} ${contentPreview}...`; }} 
          emptyMessage="No contexts found." 
          actionLabel="Delete" 
          orderedListMode={isContextListMode} 
          currentOrderIds={isContextListMode ? (chatData?.contexts?.map(i => i.id) || []) : defaultContextIds} 
          onToggleOrder={isContextListMode ? handleToggleChatContext : handleToggleDefaultContext} 
        />
      )}
      {contextModal.isOpen && (<ContextEditorModal isOpen={contextModal.isOpen} onClose={contextModal.close} onSave={contextModal.handleSave} onDelete={contextModal.handleDelete} existingContext={contextModal.itemToEdit} />)}
      
      {isModelListOpen && (<ManagerModal title="Models" items={allModels} isOpen={isModelListOpen} onClose={() => setIsModelListOpen(false)} onSelect={(model) => modelModal.open(model)} onDelete={modelModal.handleDelete} onCreateNew={() => modelModal.open()} renderSubtext={renderModelSubtext} emptyMessage="No models available." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={selectedModelId || undefined} specialActionIcon="✓" onSpecialAction={(id) => { const model = allModels.find(m => m.id === id); if (model) handleSelectModel(model); }} specialActionTooltip={(m) => `Use ${m.name}`} />)}
      {modelModal.isOpen && (<ModelEditorModal isOpen={modelModal.isOpen} onClose={modelModal.close} onSave={modelModal.handleSave} onDelete={modelModal.handleDelete} existingModel={modelModal.itemToEdit} allStopPatterns={allStopPatterns} />)}
      
      {isSampListOpen && (<ManagerModal title="Samplers" items={allSamplers} isOpen={isSampListOpen} onClose={() => setIsSampListOpen(false)} onSelect={(sampler) => sampleModal.open(sampler)} onDelete={sampleModal.handleDelete} onCreateNew={() => sampleModal.open()} renderSubtext={(s) => `Temp: ${s?.parameters?.temperature}, TopP: ${s?.parameters?.top_p}, Tokens: ${s?.maximumNumberOfTokens}`} emptyMessage="No samplers found." actionLabel="Delete" />)}
      {isSamplerEditorOpen && (<SamplerEditorModal isOpen={isSamplerEditorOpen} onClose={sampleModal.close} onSave={sampleModal.handleSave} existingSampler={samplerToEdit} allStopPatterns={allStopPatterns} />)}
      
      {isStopListOpen && (<ManagerModal title="Stop Patterns" items={allStopPatterns} isOpen={isStopListOpen} onClose={() => setIsStopListOpen(false)} onSelect={(stopPattern) => stopModal.open(stopPattern)} onDelete={stopModal.handleDelete} onCreateNew={() => stopModal.open()} renderSubtext={(s) => { const hasRegex = s.regularExpressionTrigger ? '🔍' : '📌'; return (<span style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block' }}>{hasRegex} Pattern: {s.pattern}</span>); }} emptyMessage="No stop patterns found." actionLabel="Delete" orderedListMode={false} />)}
      {stopModal.isOpen && (<StopPatternEditorModal isOpen={stopModal.isOpen} onClose={stopModal.close} onSave={stopModal.handleSave} onDelete={stopModal.handleDelete} existingStopPattern={stopModal.itemToEdit} />)}
      
      {isBudgetStrategyListOpen && (
        <ManagerModal 
          title="Budget Strategies" 
          items={allBudgetStrategies} 
          isOpen={isBudgetStrategyListOpen} 
          onClose={() => setIsBudgetStrategyListOpen(false)} 
          onSelect={(strategy) => budgetModal.open(strategy)} 
          onDelete={budgetModal.handleDelete} 
          onCreateNew={() => budgetModal.open()} 
          renderSubtext={renderBudgetStrategySubtext} 
          emptyMessage="No budget strategies found." 
          actionLabel="Delete" 
          orderedListMode={false} 
          activeSpecialActionId={selectedBudgetStrategyId || undefined} 
          specialActionIcon="★" 
          onSpecialAction={handleActivateBudgetStrategy} 
          specialActionTooltip={(s) => selectedBudgetStrategyId === s.id ? `Deactivate ${s.name}` : `Activate ${s.name}`} 
        />
      )}
      {budgetModal.isOpen && (<BudgetStrategyEditorModal isOpen={budgetModal.isOpen} onClose={budgetModal.close} onSave={budgetModal.handleSave} onDelete={budgetModal.handleDelete} existingStrategy={budgetModal.itemToEdit} allModels={allModels} />)}
      
      {isExtListOpen && (<ManagerModal title="Extensions" items={allExtensions} isOpen={isExtListOpen} onClose={() => setIsExtListOpen(false)} onSelect={undefined} onDelete={deleteExtension} onCreateNew={handleCreateExtension} renderSubtext={(ext) => (<span style={{ display: 'flex', alignItems: 'center', gap: '3px', opacity: 0.8 }}><span style={{ fontSize: '0.65rem', background: 'var(--border)', padding: '2px 3px', borderRadius: '4px', textTransform: 'uppercase' }}>{ext.extensionType.replace(/_/g, ' ')}</span><span>{ext.description}</span></span>)} emptyMessage="No extensions available." actionLabel="Delete" orderedListMode={true} currentOrderIds={(chatData as any)?.extensions?.map((e: any) => e.id) || []} onToggleOrder={handleToggleExtension} />)}
    </div>
  );
}

export default App;