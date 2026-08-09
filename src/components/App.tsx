// src/App.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useChatSession } from '../hooks/useChatSession';
import { useChatListManager } from '../hooks/useChatListManager';
import { useCharacterManager } from '../hooks/useCharacterManager';
import { useContextManager } from '../hooks/useContextManager';
import { useSamplerManager } from '../hooks/useSamplerManager';
import { useStopPatternManager } from '../hooks/useStopPatternManager';
import { useModelManager } from '../hooks/useModelManager';
import { useBudgetStrategyManager } from '../hooks/useBudgetStrategyManager';
import { useExtensionManager } from '../hooks/useExtensionManager';
import { useProfileManager } from '../hooks/useProfileManager';
import { useEntityModal } from '../hooks/useEntityModal';
import { useToast } from '../context/ToastContext';
import { loadChatMessages, loadInterjectableActions, saveInterjectableActions, saveRawChatData, loadRawChatData, getCharacterImageUrl } from '../hooks/storage';

import { deleteMessage, massDeleteMessages, editMessage, branchMessage, cloneChatUpToMessage } from '../hooks/messageLogic';
import { getDelayedDisplayName } from '../hooks/immersionLogic';
import { ChatStatisticsBar } from './ChatStatisticsBar';
import { ManagerModal } from './ManagerModal';
import { CharacterEditorModal } from './CharacterEditorModal';
import { ModelEditorModal } from './ModelEditorModal';
import { SamplerEditorModal } from './SamplerEditorModal';
import { ContextEditorModal } from './ContextEditorModal';
import { StopPatternEditorModal } from './StopPatternEditorModal';
import { BudgetStrategyEditorModal } from './BudgetStrategyEditorModal';
import { ProfileEditorModal } from './ProfileEditorModal';
import './main.css';

import { formatMessageText } from '../utilities/textFormatter';

import type { 
  Character, Context, Sampler, StopPattern, LanguageModel, BudgetStrategy, 
  ChatData, RawChatData, Extension, InterjectableAction, Profile 
} from '../types';


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

// ✅ Loading progress step definition
interface LoadStep {
  id: string;
  label: string;
  icon: string;
  done: boolean;
}

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

function App() {
  // --- Session & Managers ---
  const { 
    chatData, setChatData, currentCharacter, setCurrentCharacter,
    isLoading, streamingText, streamingCharacter, sendMessage, stopGeneration,
    regenerateFromMessage, messageEndRef,
    generationSpeed, messageCount, tokenCount, maximumNumberOfTokens, startNewChat,
    numberOfCacheInvalidations, numberOfRequests, totalCost, costWithoutCacheMisses,
    sendActionAndGetResponse, setActiveBudgetStrategy, setSelectedGlobalModel,
    updateRunningModels
  } = useChatSession();

  const { addToast } = useToast();

  const { chats: allChats, deleteChat: deleteChatFromList, refresh: refreshChatList } = useChatListManager();
  const { characters: allCharacters, saveCharacter, deleteCharacter } = useCharacterManager();
  const { contexts: allContexts, saveContext, deleteContext } = useContextManager();
  const { Samplers: allSamplers, saveSampler, deleteSampler } = useSamplerManager();
  const { stopPatterns: allStopPatterns, saveStopPattern, deleteStopPattern } = useStopPatternManager();
  
  const { 
    models: allModels, saveModel, deleteModel, 
    runningModels, toggleModelLoad,
    selectedModelId
  } = useModelManager();
  
  const { strategies: allBudgetStrategies, saveStrategy: saveBudgetStrategy, deleteStrategy: deleteBudgetStrategy } = useBudgetStrategyManager();
  const { extensions: allExtensions, deleteExtension } = useExtensionManager();
  const { profiles: allProfiles, saveProfile, deleteProfile } = useProfileManager();

  // ✅ Model readiness: requires BOTH running AND idle (slots available)
  const isModelReady = selectedModelId 
    ? runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle === true
    : false;
  
  const isModelLoading = selectedModelId
    ? runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle !== true
    : false;
  
  const modelStatusMessage = !selectedModelId 
    ? "No model selected — open Models to load one"
    : isModelLoading
      ? "Model is warming up... please wait"
      : "";

  // --- UI State ---
  const [isChatListOpen, setIsChatListOpen] = useState(false);
  const [isCharListOpen, setIsCharListOpen] = useState(false);
  const [isContextListMode, setIsContextListMode] = useState(false);
  const [isSamplerListOpen, setIsSampListOpen] = useState(false);
  const [isExtListOpen, setIsExtListOpen] = useState(false);
  const [isModelListOpen, setIsModelListOpen] = useState(false);
  const [isStopListOpen, setIsStopListOpen] = useState(false);
  const [isBudgetStrategyListOpen, setIsBudgetStrategyListOpen] = useState(false);
  const [isProfileListOpen, setIsProfileListOpen] = useState(false);
  
  const [selectedBudgetStrategyId, setSelectedBudgetStrategyId] = useState<string | null>(null);
  const [defaultCharacterId, setDefaultCharacterId] = useState<string | null>(null);
  const [defaultContextIds, setDefaultContextIds] = useState<string[]>([]);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  
  const [actionMenuTarget, setActionMenuTarget] = useState<{ messageId: string, charId: string, x: number, y: number } | null>(null);
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const [actions, setActions] = useState<InterjectableAction[]>([]);

  const [viewMode, setViewMode] = useState<'ladder' | 'cinematic'>('ladder');
  const [centerAvatar, setCenterAvatar] = useState<Character | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  const charModal = useEntityModal<Character>(saveCharacter, deleteCharacter, 'Character');
  const contextModal = useEntityModal<Context>(saveContext, deleteContext, 'Context');
  const stopModal = useEntityModal<StopPattern>(saveStopPattern, deleteStopPattern, 'Stop Pattern');
  const modelModal = useEntityModal<LanguageModel>(saveModel, deleteModel, 'Model');
  const budgetModal = useEntityModal<BudgetStrategy>(saveBudgetStrategy, deleteBudgetStrategy, 'Budget Strategy');
  const profileModal = useEntityModal<Profile>(saveProfile, deleteProfile, 'Profile');

  // ✅ Sampler editor uses dedicated state instead of broken entity modal
  const [isSamplerEditorOpen, setIsSamplerEditorOpen] = useState(false);
  const [samplerToEdit, setSamplerToEdit] = useState<Sampler | null>(null);
  
  const [inputText, setInputText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [massDeleteId, setMassDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [branchSourceTitle, setBranchSourceTitle] = useState<string | null>(null);

  // ✅ Horizontal progress loading state — all 8 subsystems
  const [loadSteps, setLoadSteps] = useState<LoadStep[]>([
    { id: 'characters', label: 'Characters', icon: '🎭', done: false },
    { id: 'models', label: 'Models', icon: '🤖', done: false },
    { id: 'contexts', label: 'Contexts', icon: '🌍', done: false },
    { id: 'samplers', label: 'Samplers', icon: '🎚️', done: false },
    { id: 'stopPatterns', label: 'Stop Patterns', icon: '🛑', done: false },
    { id: 'budget', label: 'Budget', icon: '💰', done: false },
    { id: 'profiles', label: 'Profiles', icon: '⚙️', done: false },
    { id: 'chats', label: 'Chat Sessions', icon: '💬', done: false },
  ]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isFadeOut, setIsFadeOut] = useState(false);

  // --- Effects ---

  useEffect(() => {
    loadInterjectableActions().then(setActions);
  }, []);

  useEffect(() => {
    if (actions.length > 0) {
      saveInterjectableActions(actions);
    }
  }, [actions]);

  useEffect(() => {
    const loadData = async () => {
      const storedDefaultChar = localStorage.getItem('defaultCharacterId');
      if (storedDefaultChar) setDefaultCharacterId(storedDefaultChar);
      const storedDefaultContexts = localStorage.getItem('defaultContextIds');
      if (storedDefaultContexts) {
        try { setDefaultContextIds(JSON.parse(storedDefaultContexts)); } catch (e) { console.error(e); }
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    const loadBranchSource = async () => {
      if (chatData?.parentChatDataId) {
        try {
          const sourceChat = await loadRawChatData(chatData.parentChatDataId);
          setBranchSourceTitle(sourceChat ? (sourceChat.name || 'Untitled Chat') : null);
        } catch (err) { setBranchSourceTitle(null); }
      } else { setBranchSourceTitle(null); }
    };
    loadBranchSource();
  }, [chatData?.parentChatDataId]);

  useEffect(() => {
      if(defaultCharacterId && allCharacters.length > 0) {
          const char = allCharacters.find(c => c.id === defaultCharacterId);
          if(char && currentCharacter?.id !== char.id) setCurrentCharacter(char);
      }
  }, [defaultCharacterId, allCharacters, currentCharacter?.id, setCurrentCharacter]);

  useEffect(() => {
    if (selectedBudgetStrategyId) {
      const strategy = allBudgetStrategies.find(s => s.id === selectedBudgetStrategyId);
      setActiveBudgetStrategy(strategy || null);
    } else { setActiveBudgetStrategy(null); }
  }, [selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy]);

  // ✅ Sync selected model with chat session AND inject runtime port
  useEffect(() => {
    if (selectedModelId && runningModels[selectedModelId]?.isRunning) {
      const model = allModels.find(m => m.id === selectedModelId);
      const port = runningModels[selectedModelId].port;
      if (model && port) {
        const modelWithPort = { 
          ...model, 
          parameters: { 
            ...model.parameters, 
            _runtimePort: port 
          } 
        };
        setSelectedGlobalModel(modelWithPort);
      }
    } else if (selectedModelId) {
      const model = allModels.find(m => m.id === selectedModelId);
      setSelectedGlobalModel(model || null);
    } else {
      setSelectedGlobalModel(null);
    }
  }, [selectedModelId, runningModels, allModels, setSelectedGlobalModel]);

  // ✅ Keep chat session's runningModelsMap in sync to prevent double-click bug
  useEffect(() => {
    updateRunningModels(runningModels);
  }, [runningModels, updateRunningModels]);

  // ✅ Track loading progress per subsystem — all 8
  useEffect(() => {
    setLoadSteps(prev => prev.map(step => {
      switch (step.id) {
        case 'characters': return { ...step, done: allCharacters.length > 0 };
        case 'models': return { ...step, done: allModels.length > 0 };
        case 'contexts': return { ...step, done: allContexts.length > 0 };
        case 'samplers': return { ...step, done: allSamplers.length > 0 };
        case 'stopPatterns': return { ...step, done: allStopPatterns.length > 0 };
        case 'budget': return { ...step, done: allBudgetStrategies.length > 0 };
        case 'profiles': return { ...step, done: allProfiles.length > 0 };
        case 'chats': return { ...step, done: allChats.length > 0 };
        default: return step;
      }
    }));
  }, [allCharacters, allModels, allContexts, allSamplers, allStopPatterns, allBudgetStrategies, allProfiles, allChats]);

  // ✅ Dismiss loading screen once all steps complete OR timeout for empty collections
  useEffect(() => {
    if (!isInitializing) return;

    const allDone = loadSteps.every(s => s.done);
    if (allDone) {
      const timer = setTimeout(() => {
        setIsFadeOut(true);
        setTimeout(() => {
          setIsInitializing(false);
          setIsFadeOut(false);
        }, 300);
      }, 200);
      return () => clearTimeout(timer);
    }

    // ✅ Safety timeout — force dismiss after 4 seconds even if some steps never complete
    // This handles empty collections (0 models, 0 budget strategies, etc.)
    const fallbackTimer = setTimeout(() => {
      setIsFadeOut(true);
      setTimeout(() => {
        setIsInitializing(false);
        setIsFadeOut(false);
      }, 300);
    }, 4000);

    return () => clearTimeout(fallbackTimer);
  }, [loadSteps, isInitializing]);

  // ✅ FIXED: Cinematic avatar observer
  useEffect(() => {
    if (viewMode !== 'cinematic' || !chatHistoryRef.current || !chatData || chatData.chatMessageHistory.length === 0) {
      setCenterAvatar(null);
      return;
    }

    const options = {
      root: chatHistoryRef.current,
      threshold: [0.5, 0.8, 1.0],
      rootMargin: '-10% 0px -60% 0px', 
    };

    const observer = new IntersectionObserver((entries) => {
      const mostVisible = entries.reduce((prev, current) => 
        (prev.intersectionRatio > current.intersectionRatio) ? prev : current
      );
      
      if (mostVisible && mostVisible.intersectionRatio > 0.5) {
        const messageId = mostVisible.target.getAttribute('data-message-id');
        if (!messageId) return;
        
        const msg = chatData.chatMessageHistory.find(m => m.id === messageId);
        if (!msg || !msg.character) return;

        // ✅ Skip ambient narrator messages for cinematic avatar
        if (msg.character.id === AMBIENT_NARRATOR_ID) return;

        let avatarToShow: Character | null = msg.character;
        
        if (msg.character.id === currentCharacter?.id) {
          const currentIndex = chatData.chatMessageHistory.indexOf(msg);
          const prevMessage = currentIndex > 0 ? chatData.chatMessageHistory[currentIndex - 1] : null;
          if (prevMessage && prevMessage.character && prevMessage.character.id !== currentCharacter?.id && prevMessage.character.id !== AMBIENT_NARRATOR_ID) {
            avatarToShow = prevMessage.character;
          } else {
            avatarToShow = null;
          }
        }
        
        setCenterAvatar(avatarToShow);
        document.querySelectorAll('.message-row').forEach(el => el.classList.remove('is-active'));
        (mostVisible.target as HTMLElement).classList.add('is-active');
      }
    }, options);

    const messages = chatHistoryRef.current.querySelectorAll('[data-message-id]');
    messages.forEach((msg) => observer.observe(msg));
    
    if (messages.length > 0 && !centerAvatar) {
      for (let i = chatData.chatMessageHistory.length - 1; i >= 0; i--) {
        const msg = chatData.chatMessageHistory[i];
        if (msg.character && msg.character.id !== currentCharacter?.id && msg.character.id !== AMBIENT_NARRATOR_ID) {
          setCenterAvatar(msg.character);
          break;
        }
      }
    }
    
    return () => observer.disconnect();
  }, [viewMode, chatData?.chatMessageHistory, chatData?.chatMessageHistory.length, currentCharacter?.id]);

  // --- Handlers ---

  const handleSwitchChat = useCallback(async (id: string) => {
    const selected = allChats.find(c => c.id === id);
    if (!selected) return;

    let chatWithMessages = selected;
    if (selected.chatMessageHistory.length === 0) {
      try {
        chatWithMessages = await loadChatMessages(selected);
      } catch (err) {
        console.error("Failed to load chat messages:", err);
        addToast("Failed to load chat messages.", "error");
      }
    }

    setChatData(chatWithMessages); 
    if (chatWithMessages.protagonist) setCurrentCharacter(chatWithMessages.protagonist);
    refreshChatList();
    setIsChatListOpen(false);
  }, [allChats, setChatData, setCurrentCharacter, refreshChatList, addToast]);

  const handleNewChat = useCallback(() => {
    let charToUse = currentCharacter;
    if (!charToUse && defaultCharacterId) charToUse = allCharacters.find(c => c.id === defaultCharacterId) || null;
    if (!charToUse && allChats.length > 0) charToUse = allChats[0].protagonist;
    if (charToUse) { startNewChat(charToUse); refreshChatList(); setIsChatListOpen(false); }
  }, [currentCharacter, defaultCharacterId, allCharacters, allChats, startNewChat, refreshChatList]);

  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this session?")) return;
    const success = await deleteChatFromList(id);
    if (success) {
      addToast("Chat session deleted.", "info");
      if (chatData?.id === id && currentCharacter) startNewChat(currentCharacter);
    } else { addToast("Failed to delete chat.", "error"); }
  };

  const handleOpenCharacterManager = () => setIsCharListOpen(true);

  const handleToggleParticipant = async (charId: string) => {
    if (!chatData) return;
    if (charId === chatData.protagonist.id) { addToast("Cannot remove the protagonist.", "error"); return; }
    const currentIds = chatData.participants.map(p => p.id);
    const newIds = currentIds.includes(charId) ? currentIds.filter(id => id !== charId) : [...currentIds, charId];
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
    setChatData({ ...chatData, contexts: newContexts });
    addToast("Contexts updated (Session Only).", "info");
  };

  const getChatExtensions = (): string[] => {
      if (!chatData) return [];
      const dataWithExtensions = chatData as unknown as { extensions?: { id: string }[] };
      return dataWithExtensions.extensions?.map(e => e.id) || [];
  };

  const handleOpenExtensions = () => { if (!chatData) return; setIsExtListOpen(true); };
  
  const handleToggleExtension = async (extId: string) => {
    if (!chatData) return;
    const currentIds = getChatExtensions();
    let newIds = currentIds.includes(extId) ? currentIds.filter(id => id !== extId) : [...currentIds, extId];
    const newExtensions = allExtensions.filter(e => newIds.includes(e.id));
    const updatedChat = { ...chatData } as any;
    updatedChat.extensions = newExtensions;
    setChatData(updatedChat);
    addToast("Extensions updated (Session Only).", "info");
  };

  const handleCreateExtension = () => addToast("Create Extension Modal coming soon!", "info");

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

  const handleActivateProfile = async (profileId: string) => {
    if (!chatData) return;
    const currentProfileId = chatData.Profile?.id;
    if (currentProfileId === profileId) {
      const updatedChat = { ...chatData, Profile: undefined };
      setChatData(updatedChat);
      await saveRawChatData(updatedChat);
      addToast("Profile deactivated.", "info");
    } else {
      const profile = allProfiles.find(p => p.id === profileId);
      if (!profile) return;
      const updatedChat = { ...chatData, Profile: profile };
      setChatData(updatedChat);
      await saveRawChatData(updatedChat);
      addToast(`Profile "${profile.name}" activated!`, "success");
    }
  };

  const handleOpenSamplerEditor = (sampler?: Sampler | null) => {
    setSamplerToEdit(sampler || null);
    setIsSamplerEditorOpen(true);
    setIsSampListOpen(false);
  };

  const handleSaveSampler = (sampler: Sampler) => {
    saveSampler(sampler);
    setIsSamplerEditorOpen(false);
    setSamplerToEdit(null);
  };

  const handleDeleteSampler = (id: string) => {
    deleteSampler(id);
    setIsSamplerEditorOpen(false);
    setSamplerToEdit(null);
  };

  const handleStartEditTitle = (e: React.MouseEvent) => { e.stopPropagation(); setEditTitleValue(chatData?.name || ''); setIsEditingTitle(true); };
  const handleSaveTitle = () => {
    if (!chatData) return;
    const newTitle = editTitleValue.trim() || 'Untitled Chat';
    setChatData({ ...chatData, name: newTitle } as ChatData);
    saveRawChatData({ ...chatData, name: newTitle } as RawChatData);
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
      setChatData(updated); setEditingId(null); setEditDraft(''); addToast("Message edited.", "success");
    } catch (err) { addToast((err as Error).message, "error"); }
  };

  const handleDelete = async (id: string) => {
    if (!chatData) return;
    try { 
      const updated = await deleteMessage(chatData, id); 
      setChatData(updated); addToast("Message deleted.", "info");
    } catch (err) { addToast((err as Error).message, "error"); }
  };

  const handleMassDeleteConfirm = async () => {
    if (!chatData || !massDeleteId) return;
    const idx = chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId);
    if (idx === -1) return;
    try { 
      const updated = await massDeleteMessages(chatData, idx); 
      setChatData(updated); setMassDeleteId(null); addToast("Messages deleted.", "info");
    } catch (err) { addToast((err as Error).message, "error"); }
  };

  const handleBranch = async (id: string) => {
    if (!chatData) return;
    try { 
      const branchedChat = await branchMessage(chatData, id);
      setChatData(branchedChat);
      if(branchedChat.protagonist) setCurrentCharacter(branchedChat.protagonist);
      refreshChatList();
      addToast(`Branched to "${branchedChat.name}"`, "success");
    } catch (err) { addToast("Failed to branch chat.", "error"); }
  };

  const handleClone = async (id: string) => {
    if (!chatData) return;
    try {
      const clonedChat = await cloneChatUpToMessage(chatData, id);
      setChatData(clonedChat);
      if(clonedChat.protagonist) setCurrentCharacter(clonedChat.protagonist);
      refreshChatList();
      addToast(`Cloned to "${clonedChat.name}"`, "success");
    } catch (err) {
      addToast("Failed to clone chat.", "error");
    }
  };

  const handleNavigateToSource = async () => {
    if (!chatData?.parentChatDataId) return;
    try {
      const sourceChat = await loadRawChatData(chatData.parentChatDataId);
      if (sourceChat) {
        const fullChat = sourceChat as unknown as ChatData; 
        setChatData(fullChat);
        if(fullChat.protagonist) setCurrentCharacter(fullChat.protagonist);
        refreshChatList();
        addToast(`Navigated back to "${sourceChat.name || 'Untitled Chat'}"`, "info");
      } else { addToast("Source chat not found.", "error"); }
    } catch (err) { addToast("Failed to navigate to source chat.", "error"); }
  };

  const handleSend = () => { 
    if (!inputText.trim() && pendingFiles.length === 0) return; 
    sendMessage(inputText, pendingFiles); 
    setInputText(''); setPendingFiles([]); 
  };

  const handleAvatarClick = (e: React.MouseEvent, messageId: string, char: Character) => {
    e.stopPropagation();
    if (actionMenuTarget?.messageId === messageId) { setActionMenuTarget(null); } 
    else { setActionMenuTarget({ messageId, charId: char.id, x: e.clientX, y: e.clientY }); }
  };

  const incrementActionCount = async (label: string) => {
    setActions(prev => {
      const exists = prev.find(a => a.label === label);
      const newActions = exists ? prev.map(a => a.label === label ? { ...a, count: a.count + 1 } : a) : [...prev, { label, count: 1 }];
      saveInterjectableActions(newActions);
      return newActions;
    });
  };

  const handleAddAction = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (actions.some(a => a.label.toLowerCase() === trimmed.toLowerCase())) { addToast(`Action "${trimmed}" already exists.`, "info"); return; }
    const newActions = [...actions, { label: trimmed, count: 0 }];
    setActions(newActions);
    saveInterjectableActions(newActions);
    setMenuSearchQuery('');
    addToast(`Added action "${trimmed}".`, "success");
  };

  const handleDeleteAction = (label: string) => {
    const newActions = actions.filter(a => a.label !== label);
    setActions(newActions);
    saveInterjectableActions(newActions);
    addToast(`Removed action "${label}".`, "info");
  };

  const handleActionInterject = async (actionLabel: string, targetChar: Character) => {
    setActionMenuTarget(null);
    setMenuSearchQuery('');
    if (!chatData || !currentCharacter) return;
    await incrementActionCount(actionLabel);
    const actionText = `*${actionLabel} ${targetChar.name}.*`;
    if (isLoading) { stopGeneration(); await new Promise(resolve => setTimeout(resolve, 200)); }
    try { await sendActionAndGetResponse(actionText, targetChar); } 
    catch (error) { console.error("Interjection failed:", error); addToast("Failed to interject action.", "error"); }
  };

  const getFilteredActions = () => actions
    .filter(a => a.label.toLowerCase().includes(menuSearchQuery.toLowerCase()))
    .sort((a, b) => b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label));

  const isStemMessage = (messageId: string): boolean => {
    if (!chatData?.parentChatMessageId) return false;
    const branchIndex = chatData.chatMessageHistory.findIndex(m => m.id === chatData.parentChatMessageId);
    if (branchIndex === -1) return false;
    const currentIndex = chatData.chatMessageHistory.findIndex(m => m.id === messageId);
    return currentIndex !== -1 && currentIndex <= branchIndex;
  };

  const toggleViewMode = () => {
    setViewMode(prev => prev === 'ladder' ? 'cinematic' : 'ladder');
    if (viewMode === 'ladder') setTimeout(() => messageEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  // ✅ HORIZONTAL PROGRESS LOADING SCREEN — 8 subsystems
  if (isInitializing) {
    const completedCount = loadSteps.filter(s => s.done).length;
    const totalCount = loadSteps.length;

    return (
      <div style={{ 
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', 
        height: '100vh', width: '100vw', background: 'var(--bg)', color: 'var(--text-h)',
        fontFamily: 'monospace', zIndex: 9999,
        opacity: isFadeOut ? 0 : 1,
        transition: 'opacity 0.3s ease-out',
        pointerEvents: isFadeOut ? 'none' : 'auto'
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '32px', fontWeight: 'bold', color: 'var(--accent)' }}>
          ⚛️ LoreReactor
        </div>

        {/* Horizontal progress rows */}
        <div style={{ 
          display: 'flex', flexDirection: 'column', gap: '10px',
          width: '320px', maxWidth: '90vw'
        }}>
          {loadSteps.map((step) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* Icon */}
              <div style={{
                width: '28px', height: '28px', borderRadius: '6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.85rem', flexShrink: 0,
                background: step.done ? 'var(--accent)' : 'transparent',
                border: `1px solid ${step.done ? 'var(--accent)' : 'var(--border)'}`,
                color: step.done ? '#fff' : 'var(--text-h)',
                transition: 'all 0.3s ease',
                opacity: step.done ? 1 : 0.5
              }}>
                {step.done ? '✓' : step.icon}
              </div>

              {/* Label + bar container */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ 
                  fontSize: '0.7rem', 
                  opacity: step.done ? 1 : 0.5,
                  color: step.done ? 'var(--accent)' : 'var(--text-h)',
                  transition: 'all 0.3s ease',
                  fontWeight: step.done ? 'bold' : 'normal'
                }}>
                  {step.label}
                </span>
                
                {/* Progress bar track */}
                <div style={{
                  width: '100%', height: '4px', borderRadius: '2px',
                  background: 'var(--border)', overflow: 'hidden'
                }}>
                  {/* Progress bar fill */}
                  <div style={{
                    width: step.done ? '100%' : '0%',
                    height: '100%', borderRadius: '2px',
                    background: 'var(--accent)',
                    transition: 'width 0.4s ease-out',
                    boxShadow: step.done ? '0 0 6px rgba(var(--accent-rgb, 100, 200, 255), 0.5)' : 'none'
                  }} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '24px', fontSize: '0.75rem', opacity: 0.5 }}>
          {completedCount}/{totalCount} systems initialized
        </div>
      </div>
    );
  }

  const hasSession = !!currentCharacter && !!chatData;

  const isMassActive = massDeleteId !== null;
  const startIndex = isMassActive && chatData ? chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId) : -1;
  const branchOffIndex = chatData?.parentChatMessageId && chatData ? chatData.chatMessageHistory.findIndex(m => m.id === chatData.parentChatMessageId) : -1;

  const renderModelSubtext = (model: LanguageModel) => {
    const isMultiModal = !!model.mmproj; 
    const modelState = runningModels[model.id];
    const isRunning = modelState?.isRunning === true;
    const isIdle = modelState?.isIdle === true;
    const isSelected = selectedModelId === model.id;
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8, flexWrap: 'wrap' }}>
        {isMultiModal && <span style={{ fontSize: '0.7rem', background: '#8b5cf6', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Multi-Modal</span>}
        {isRunning && isIdle && <span style={{ fontSize: '0.7rem', background: '#10b981', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Idle</span>}
        {isRunning && !isIdle && <span style={{ fontSize: '0.7rem', background: '#f59e0b', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Loading...</span>}
        {isSelected && !isRunning && <span style={{ fontSize: '0.7rem', background: '#6b7280', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Selected (Not Loaded)</span>}
        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Context: {(model.contextLength / 1024).toFixed(0)}k</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Backend: {model.backend || 'other'}</span>
        <span>{model.description}</span>
      </span>
    );
  };

  const renderBudgetStrategySubtext = (strategy: BudgetStrategy) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 }}>
      <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Online: {strategy.switchProbabilty}% • Budget: ${strategy.maximumBudget}</span>
    </span>
  );

  const renderProfileSubtext = (profile: Profile) => {
    const flags: string[] = [];
    if (profile.forceNameReveal) flags.push('Force Names');
    if (profile.cacheInvalidationReductionLevel === 1) flags.push('Cache L1');
    if (profile.cacheInvalidationReductionLevel === 2) flags.push('Cache L2');
    if (profile.cacheInvalidationReductionLevel === 3) flags.push('Cache L3');
    if (profile.stripThinkTokens) flags.push('Strip Think');
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.8, flexWrap: 'wrap' }}>
        {flags.length > 0 ? flags.map((f, i) => (
          <span key={i} style={{ fontSize: '0.65rem', background: 'var(--accent-bg)', color: 'var(--accent)', padding: '1px 5px', borderRadius: '3px' }}>{f}</span>
        )) : <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>No special settings</span>}
      </span>
    );
  };

  const cinematicAvatarUrl = centerAvatar ? getCharacterImageUrl(centerAvatar.image) : null;

  return (
    <>
      <div 
        className={`chat-container ${viewMode === 'cinematic' ? 'mode-cinematic' : 'mode-ladder'}`} 
        onClick={() => { setActionMenuTarget(null); setMenuSearchQuery(''); }}
      >
        {!hasSession && (
          <div style={{ 
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', width: '100%', opacity: 0.5, gap: '12px'
          }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent)' }}>⚛️ LoreReactor</div>
            <div style={{ fontSize: '0.85rem' }}>Loading workspace...</div>
          </div>
        )}
        {hasSession && (
          <>
            {viewMode === 'cinematic' && centerAvatar && cinematicAvatarUrl && (
              <div 
                className="cinematic-stage active" 
                onClick={(e) => { e.stopPropagation(); handleAvatarClick(e, centerAvatar.id || 'cinematic-bg', centerAvatar); }} 
                title="Click character to interject action"
              >
                <img 
                  src={cinematicAvatarUrl} 
                  alt={centerAvatar.name} 
                  className="cinematic-avatar-img" 
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} 
                />
              </div>
            )}

            <header className="app-header">
              <div className="header-content">
                <div className="header-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    {isEditingTitle ? (
                      <input type="text" value={editTitleValue} onChange={(e) => setEditTitleValue(e.target.value)} onBlur={handleSaveTitle} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false); }} autoFocus style={{ background: 'var(--social-bg)', border: '1px solid var(--accent)', color: 'var(--text-h)', padding: '4px 8px', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', flexGrow: 1, maxWidth: '200px', outline: 'none' }} />
                    ) : (
                      <>
                        <div className="header-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{chatData?.name || "Untitled Chat"}</div>
                        <span onClick={handleStartEditTitle} title="Edit Title" style={{ fontSize: '0.9em', opacity: 0.3, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.opacity = '1'} onMouseLeave={(e) => e.currentTarget.style.opacity = '0.3'}>✎</span>
                      </>
                    )}
                  </div>
                  <div className="header-controls-group">
                      <button 
                        type="button"
                        className="view-mode-toggle"
                        onClick={handleOpenExtensions}
                        title="Extensions"
                        style={{ padding: '6px 10px' }}
                      >
                        <span>🧩</span>
                      </button>
                      <button onClick={toggleViewMode} className={`view-mode-toggle ${viewMode === 'cinematic' ? 'active' : ''}`} title="Switch View Mode">
                        <span>{viewMode === 'ladder' ? '🎥' : '📜'}</span>
                        <span>{viewMode === 'ladder' ? 'Cinematic' : 'Ladder'}</span>
                      </button>
                      <ChatStatisticsBar generationSpeed={generationSpeed} messageCount={messageCount} tokenCount={tokenCount} maximumNumberOfTokens={maximumNumberOfTokens} numberOfCacheInvalidations={numberOfCacheInvalidations} numberOfRequests={numberOfRequests} totalCost={totalCost} costWithoutCacheMisses={costWithoutCacheMisses} />
                  </div>
                </div>
              </div>
            </header>

            <div className="chat-history" ref={chatHistoryRef}>
              {chatData?.chatMessageHistory.map((message, index) => {
                if (!message.character) return null;
                const isAmbient = message.character.id === AMBIENT_NARRATOR_ID;
                const isProtagonist = message.character.id === currentCharacter?.id;
                const displayName = getDelayedDisplayName(chatData, index, message.character.id);
                const isEditing = editingId === message.id;
                const isMassStart = message.id === massDeleteId;
                const isInDeletionRange = isMassActive && startIndex !== -1 && index >= startIndex;
                const isStem = isStemMessage(message.id);
                const isJustBeforeBranchOff = chatData.parentChatMessageId && index === branchOffIndex;
                const showSideAvatar = viewMode === 'ladder' && !isProtagonist && !isAmbient;

                return (
                  <React.Fragment key={message.id}>
                    <div className={`message-row ${viewMode === 'cinematic' ? '' : (isProtagonist ? 'message-right' : 'message-left')} ${isInDeletionRange ? 'message-fading-out' : ''}`} data-message-id={message.id}>
                      {showSideAvatar && (
                        <div className="avatar-column">
                          <div style={{ position: 'relative' }}>
                              {getCharacterImageUrl(message.character.image) ? (
                                  <img src={getCharacterImageUrl(message.character.image)!} alt={displayName} className="character-avatar" onClick={(e) => handleAvatarClick(e, message.id, message.character)} onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} style={{ cursor: 'pointer' }} />
                              ) : (
                                  <div className="character-avatar placeholder" onClick={(e) => handleAvatarClick(e, message.id, message.character)} style={{ cursor: 'pointer' }} />
                              )}
                          </div>
                          <span className="avatar-name">{displayName}</span>
                        </div>
                      )}
                      <div className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} ${isProtagonist ? 'bubble-user' : 'bubble-ai'} ${isAmbient ? 'bubble-ambient' : ''} ${isEditing ? 'bubble-editing' : ''} ${isInDeletionRange ? 'bubble-marked-for-delete' : ''} ${isStem ? 'bubble-stem' : ''}`}>
                        {viewMode === 'cinematic' && (<div className={`cinematic-bubble-header ${isAmbient ? 'cinematic-bubble-header-ambient' : ''}`}><span>{isAmbient ? '✦' : getDelayedDisplayName(chatData, index, message.character.id)}</span></div>)}
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
                            <span className="message-text">{formatMessageText(message.textContent)}</span>
                            <div className="message-toolbar">
                              {isStem ? (<span className="toolbar-lock">🔒 Locked</span>) : !isMassActive ? (
                                <>
                                  <button type="button" onClick={() => { setEditingId(message.id); setEditDraft(message.textContent); }} className="toolbar-btn">✎</button>
                                  {!isProtagonist && <button type="button" onClick={() => regenerateFromMessage(message.id, 'ai')} disabled={!isModelReady} className="toolbar-btn" title="Regenerate this Response" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>↻</button>}
                                  {isProtagonist && <button type="button" onClick={() => regenerateFromMessage(message.id, 'user')} disabled={!isModelReady} className="toolbar-btn" title="Regenerate Your Input" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>↻</button>}
                                  <button type="button" onClick={() => handleBranch(message.id)} className="toolbar-btn" title="Branch from here">⑂</button>
                                  <button type="button" onClick={() => handleClone(message.id)} className="toolbar-btn" title="Clone chat up to here">📋</button>
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
                      <div className="branch-separator-line clickable" onClick={handleNavigateToSource} title={`Click to go back to "${branchSourceTitle || 'source chat'}"`} style={{ cursor: 'pointer' }}>
                        <div className="branch-separator-content">
                          <span className="branch-separator-icon">🌿</span>
                          <span className="branch-separator-text">{branchSourceTitle ? `Branches From "${branchSourceTitle}"` : 'Conversation Branches Here'}</span>
                          <span className="branch-separator-icon">🌿</span>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
              {/* ✅ Thinking indicator — shows while waiting for first token during cache invalidation */}
              {isLoading && streamingCharacter && !streamingText && (
                <div className={`message-row ${viewMode === 'cinematic' ? '' : 'message-left'}`} data-message-id="thinking-message">
                  {viewMode === 'ladder' && streamingCharacter.id !== currentCharacter?.id && streamingCharacter.id !== AMBIENT_NARRATOR_ID && (
                    <div className="avatar-column">
                      <div style={{ position: 'relative' }}>
                        {getCharacterImageUrl(streamingCharacter.image) ? (
                          <img 
                            src={getCharacterImageUrl(streamingCharacter.image)!} 
                            alt={streamingCharacter.name} 
                            className="character-avatar" 
                            onClick={(e) => handleAvatarClick(e, 'thinking-message', streamingCharacter)}
                            style={{ cursor: 'pointer', opacity: 0.5 }} 
                          />
                        ) : (
                          <div 
                            className="character-avatar placeholder" 
                            onClick={(e) => handleAvatarClick(e, 'thinking-message', streamingCharacter)}
                            style={{ cursor: 'pointer', opacity: 0.5 }} 
                          />
                        )}
                      </div>
                      <span className="avatar-name" style={{ opacity: 0.5 }}>{getDelayedDisplayName(chatData, chatData.chatMessageHistory.length, streamingCharacter.id)}</span>
                    </div>
                  )}
                  <div className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} bubble-ai thinking-bubble`}>
                    {viewMode === 'cinematic' && <div className="cinematic-bubble-header"><span>{getDelayedDisplayName(chatData, chatData.chatMessageHistory.length, streamingCharacter.id)}</span></div>}
                    <span className="thinking-indicator">
                      <span className="thinking-text">Thinking</span>
                      <span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                    </span>
                  </div>
                </div>
              )}
              {isLoading && streamingCharacter && streamingText && (
                <div className={`message-row ${viewMode === 'cinematic' ? '' : 'message-left'}`} data-message-id="streaming-message">
                  {viewMode === 'ladder' && streamingCharacter.id !== currentCharacter?.id && streamingCharacter.id !== AMBIENT_NARRATOR_ID && (
                    <div className="avatar-column">
                      <div style={{ position: 'relative' }}>
                        {getCharacterImageUrl(streamingCharacter.image) ? (
                          <img 
                            src={getCharacterImageUrl(streamingCharacter.image)!} 
                            alt={streamingCharacter.name} 
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
                      </div>
                      <span className="avatar-name">{getDelayedDisplayName(chatData, chatData.chatMessageHistory.length, streamingCharacter.id)}</span>
                    </div>
                  )}
                  <div className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} ${streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'bubble-ambient' : 'bubble-ai'}`}>
                    {viewMode === 'cinematic' && <div className={`cinematic-bubble-header ${streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'cinematic-bubble-header-ambient' : ''}`}><span>{streamingCharacter.id === AMBIENT_NARRATOR_ID ? '✦' : getDelayedDisplayName(chatData, chatData.chatMessageHistory.length, streamingCharacter.id)}</span></div>}
                    <div style={{ display: 'inline', whiteSpace: 'pre-wrap' }}>
                      <span className="message-text" style={{ display: 'inline' }}>{formatMessageText(streamingText)}</span>
                      <span className="cursor-blink" style={{ display: 'inline' }}>&nbsp;▋</span>
                    </div>
                  </div>
                </div>
              )}
              {chatData && chatData.chatMessageHistory.length === 0 && (<div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}><p>Add characters to the chat and start chatting as {currentCharacter.name}.</p></div>)}
              <div ref={messageEndRef} style={{ height: '1px' }} />
            </div>

            <div className="context-bar" style={{ display: viewMode === 'cinematic' ? 'none' : 'flex' }}>
              <NavButton icon="💬" label="Chat List" onClick={() => setIsChatListOpen(true)} />
              <NavButton icon="🎭" label="Characters" onClick={handleOpenCharacterManager} />
              <NavButton icon="🌍" label="Contexts" onClick={() => { setIsContextListMode(true); }} />
              <NavButton icon="🤖" label="Models" onClick={() => setIsModelListOpen(true)} />
              <NavButton icon="🎚️" label="Samplers" onClick={() => setIsSampListOpen(true)} />
              <NavButton icon="🛑" label="Stop Patterns" onClick={() => setIsStopListOpen(true)} />
              <NavButton icon="💰" label="Budget" onClick={() => setIsBudgetStrategyListOpen(true)} />
              <NavButton icon="⚙️" label="Profiles" onClick={() => setIsProfileListOpen(true)} />
            </div>

            <div className="input-wrapper">
              {!isModelReady && (
                <div className={`model-status-banner ${!selectedModelId ? 'model-status-warning' : 'model-status-loading'}`}>
                  {!selectedModelId && <span className="model-status-icon">🤖</span>}
                  {isModelLoading && (
                    <span className="model-status-spinner" />
                  )}
                  <span className="model-status-text">{modelStatusMessage}</span>
                  {!selectedModelId && (
                    <button
                      type="button"
                      className="model-status-action-btn"
                      onClick={() => setIsModelListOpen(true)}
                    >
                      Open Models
                    </button>
                  )}
                </div>
              )}

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
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading || !isModelReady} className="attach-button toolbar-btn">📎</button>
                <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelected} />
                <textarea 
                  value={inputText} 
                  onChange={(e) => setInputText(e.target.value)} 
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} 
                  placeholder={isModelReady ? `Chat as ${currentCharacter.name}.` : isModelLoading ? "Warming up... please wait" : "Load a model to start chatting..."} 
                  rows={3} 
                  className={`chat-input ${!isModelReady ? 'chat-input-disabled' : ''}`} 
                  disabled={isLoading || !chatData || !isModelReady} 
                />
                <button 
                  type="button" 
                  onClick={isLoading ? stopGeneration : handleSend} 
                  disabled={!isLoading && (!inputText.trim() && pendingFiles.length === 0) || (!isLoading && !isModelReady)} 
                  className={`send-button counter ${!isLoading && !isModelReady ? 'send-button-disabled' : ''}`}
                >
                  {isLoading ? '⏹ Stop' : !isModelReady ? '⏳ Wait' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}

        {isChatListOpen && (<ManagerModal title="Chat Sessions" items={allChats} isOpen={isChatListOpen} onClose={() => setIsChatListOpen(false)} onSelect={(c) => handleSwitchChat(c.id)} onDelete={(id) => handleDeleteChat({ stopPropagation: ()=>{} } as any, id)} onCreateNew={handleNewChat}         renderSubtext={(c) => {
            const msgCount = c.messageCount ?? c.chatMessageHistory.length;
            const participantCount = c.participants?.length ?? 0;
            const contextCount = c.contexts?.length ?? 0;
            const parts: string[] = [];
            if (c.parentChatDataId) parts.push(`Branch of ${c.parentChatDataId.substring(0,8)}...`);
            parts.push(`${msgCount} message${msgCount !== 1 ? 's' : ''}`);
            parts.push(`${participantCount} character${participantCount !== 1 ? 's' : ''}`);
            if (contextCount > 0) parts.push(`${contextCount} context${contextCount !== 1 ? 's' : ''}`);
            return parts.join(' • ');
        }} emptyMessage="No saved chat sessions found." />)}
        
        {isCharListOpen && (
          <ManagerModal title="Characters" items={allCharacters} isOpen={isCharListOpen} onClose={() => setIsCharListOpen(false)} onSelect={(char) => charModal.open(char)} onDelete={deleteCharacter} onCreateNew={() => charModal.open()} renderSubtext={(c) => c.description || "No description"} emptyMessage="No characters found." actionLabel="Delete" orderedListMode={!!chatData} currentOrderIds={chatData?.participants.map(p => p.id) || []} onToggleOrder={handleToggleParticipant} specialActionIcon="★" onSpecialAction={handleSetChatProtagonist} specialActionTooltip={(c) => `set ${c.name} as the protagonist`} activeSpecialActionId={chatData?.protagonist.id} />
        )}
        {charModal.isOpen && (<CharacterEditorModal isOpen={charModal.isOpen} onClose={charModal.close} onSave={charModal.handleSave} existingCharacter={charModal.itemToEdit} allSamplers={allSamplers} />)}
        
        {(contextModal.isOpen || isContextListMode) && (
          <ManagerModal title={"Contexts"} items={allContexts} isOpen={isContextListMode} onClose={() => { setIsContextListMode(false); }} onSelect={(context) => contextModal.open(context)} onDelete={contextModal.handleDelete} onCreateNew={() => contextModal.open()} renderSubtext={(i) => { const contentPreview = i.text?.substring(0, 50) || ''; const hasRegex = i.regularExpressionTrigger ? '🔍' : '📌'; const hasImages = i.images && i.images.length > 0 ? '🖼️' : ''; return `${hasRegex} ${hasImages} ${contentPreview}...`; }} emptyMessage="No contexts found." actionLabel="Delete" orderedListMode={isContextListMode} currentOrderIds={isContextListMode ? (chatData?.contexts?.map(i => i.id) || []) : defaultContextIds} onToggleOrder={isContextListMode ? handleToggleChatContext : handleToggleDefaultContext} />
        )}
        {contextModal.isOpen && (<ContextEditorModal isOpen={contextModal.isOpen} onClose={contextModal.close} onSave={contextModal.handleSave} onDelete={contextModal.handleDelete} existingContext={contextModal.itemToEdit} allCharacters={allCharacters} />)}
        
        {isModelListOpen && (
          <ManagerModal 
            title="Models" 
            items={allModels} 
            isOpen={isModelListOpen} 
            onClose={() => setIsModelListOpen(false)} 
            onSelect={(model) => modelModal.open(model)} 
            onDelete={deleteModel} 
            onCreateNew={() => modelModal.open()} 
            renderSubtext={renderModelSubtext} 
            emptyMessage="No models available." 
            actionLabel="Delete" 
            orderedListMode={false} 
            activeSpecialActionId={selectedModelId || undefined} 
            specialActionIcon="★" 
            onSpecialAction={(id) => toggleModelLoad(id)} 
            specialActionTooltip={(m) => {
                const modelState = runningModels[m.id];
                const isRunning = modelState?.isRunning === true;
                const isIdle = modelState?.isIdle === true;
                const isSelected = selectedModelId === m.id;
                if (isRunning && isIdle && isSelected) return `⏹ Stop & Deselect`;
                if (isRunning && isIdle) return `⏹ Stop Model`;
                if (isRunning && !isIdle) return `⏳ Loading...`;
                if (isSelected) return `✓ Already Selected — Click to Load`;
                return `▶ Load & Select Model`;
            }} 
          />
        )}
        {modelModal.isOpen && (<ModelEditorModal isOpen={modelModal.isOpen} onClose={modelModal.close} onSave={modelModal.handleSave} onDelete={modelModal.handleDelete} existingModel={modelModal.itemToEdit} allStopPatterns={allStopPatterns} />)}
        
        {isSamplerListOpen && (
          <ManagerModal 
            title="Samplers" 
            items={allSamplers} 
            isOpen={isSamplerListOpen} 
            onClose={() => setIsSampListOpen(false)} 
            onSelect={(sampler) => handleOpenSamplerEditor(sampler)} 
            onDelete={deleteSampler} 
            onCreateNew={() => handleOpenSamplerEditor(null)} 
            renderSubtext={(s) => `Temp: ${s?.parameters?.temperature}, TopP: ${s?.parameters?.top_p}, Tokens: ${s?.maximumNumberOfTokens}`} 
            emptyMessage="No samplers found." 
            actionLabel="Delete" 
          />
        )}
        {isSamplerEditorOpen && (
          <SamplerEditorModal 
            isOpen={isSamplerEditorOpen} 
            onClose={() => { setIsSamplerEditorOpen(false); setSamplerToEdit(null); }} 
            onSave={handleSaveSampler} 
            existingSampler={samplerToEdit} 
            allStopPatterns={allStopPatterns} 
          />
        )}
        
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

        {isProfileListOpen && (
          <ManagerModal
            title="Profiles"
            items={allProfiles}
            isOpen={isProfileListOpen}
            onClose={() => setIsProfileListOpen(false)}
            onSelect={(profile) => profileModal.open(profile)}
            onDelete={deleteProfile}
            onCreateNew={() => profileModal.open()}
            renderSubtext={renderProfileSubtext}
            emptyMessage="No profiles found."
            actionLabel="Delete"
            orderedListMode={false}
            activeSpecialActionId={chatData?.Profile?.id || undefined}
            specialActionIcon="★"
            onSpecialAction={handleActivateProfile}
            specialActionTooltip={(p) => chatData?.Profile?.id === p.id ? `Deactivate ${p.name}` : `Activate ${p.name}`}
          />
        )}
        {profileModal.isOpen && (
          <ProfileEditorModal
            isOpen={profileModal.isOpen}
            onClose={profileModal.close}
            onSave={profileModal.handleSave}
            existingProfile={profileModal.itemToEdit}
          />
        )}
        
        {isExtListOpen && (<ManagerModal title="Extensions" items={allExtensions} isOpen={isExtListOpen} onClose={() => setIsExtListOpen(false)} onSelect={undefined} onDelete={deleteExtension} onCreateNew={handleCreateExtension} renderSubtext={(ext) => (<span style={{ display: 'flex', alignItems: 'center', gap: '3px', opacity: 0.8 }}><span style={{ fontSize: '0.65rem', background: 'var(--border)', padding: '2px 3px', borderRadius: '4px', textTransform: 'uppercase' }}>{ext.extensionType.replace(/_/g, ' ')}</span><span>{ext.description}</span></span>)} emptyMessage="No extensions available." actionLabel="Delete" orderedListMode={true} currentOrderIds={getChatExtensions()} onToggleOrder={handleToggleExtension} />)}
      </div>

      {actionMenuTarget && hasSession && (
          <div className="action-menu-container" style={{ left: `${actionMenuTarget.x + 10}px`, top: `${actionMenuTarget.y}px`, zIndex: 9999 }} onClick={(e) => e.stopPropagation()}>
            <div className="action-menu-header"><span>Interject Action</span></div>
            <input className="action-menu-search" type="text" value={menuSearchQuery} onChange={(e) => setMenuSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddAction(menuSearchQuery); }} placeholder="Filter or type new & Enter..." onClick={(e) => e.stopPropagation()} />
            <div className="action-menu-list">
              {getFilteredActions().map((action) => (
                <div 
                  key={action.label} 
                  className={`action-menu-item ${!isModelReady ? 'action-menu-item-disabled' : ''}`} 
                  role="button" 
                  tabIndex={isModelReady ? 0 : -1} 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    if (!isModelReady) return;
                    const targetChar = allCharacters.find(c => c.id === actionMenuTarget.charId); 
                    if (targetChar) handleActionInterject(action.label, targetChar); 
                  }} 
                  onKeyDown={(e) => { 
                    if (!isModelReady) return;
                    if (e.key === 'Enter' || e.key === ' ') { 
                      e.stopPropagation(); 
                      const targetChar = allCharacters.find(c => c.id === actionMenuTarget.charId); 
                      if (targetChar) handleActionInterject(action.label, targetChar); 
                    } 
                  }}
                >
                  <span className="action-menu-item-label">{action.label}</span>
                  <div className="action-meta-container">
                    <span className="action-count-badge" onClick={(e) => { e.stopPropagation(); handleDeleteAction(action.label); }} title="Click to remove action">
                      <span className="badge-count">{action.count || 0}</span>
                      <span className="badge-delete">×</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
      )}
    </>
  );
}

export default App;