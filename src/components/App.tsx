// src/App.tsx
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
import { loadChatMessages, loadInterjectableActions, saveInterjectableActions, saveRawChatData, loadRawChatData, getCharacterImageUrl, loadRawContext } from '../hooks/storage';
import { deleteMessage, massDeleteMessages, editMessage, branchMessage, cloneChatUpToMessage } from '../hooks/messageLogic';
import { clearFetchCache } from '../hooks/chatLogic';
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
import { LanguageModelEngine } from '../services/LanguageModelEngine';
import './main.css';
import { formatMessageText } from '../utilities/textFormatter';
import { cloudBackends } from '../languageModelInformation';
import type {
  Character, Context, Sampler, StopPattern, LanguageModel, BudgetStrategy,
  ChatData, Extension, InterjectableAction, Profile
} from '../types';

// ─── Constants & Types ──────────────────────────────────────────────

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';
const STORAGE_KEY_ACTIVE_CHAT = 'loreReactor_activeChatId';
const STORAGE_KEY_BUDGET_STRATEGY = 'loreReactor_selectedBudgetStrategyId';
const STORAGE_KEY_DEFAULT_CHARACTER = 'loreReactor_defaultCharacterId';
const STORAGE_KEY_SELECTED_MODEL = 'loreReactor_selectedModelId';

const tokenEngine = new LanguageModelEngine();

interface NavButtonProps { icon: string; label: string; onClick: () => void }
interface LoadStep { id: string; label: string; icon: string; done: boolean }

// ─── Sub-components ─────────────────────────────────────────────────

function NavButton({ icon, label, onClick }: NavButtonProps) {
  return (
    <button type="button" className="nav-btn" onClick={onClick}>
      <span style={{ marginRight: '6px' }}>{icon}</span>{label}
    </button>
  );
}

const MemoizedMessageText = React.memo(({ text }: { text: string }) => (
  <span className="message-text">{formatMessageText(text)}</span>
));

// ─── Render Helpers ─────────────────────────────────────────────────

function renderModelSubtext(model: LanguageModel, runningModels: Record<string, { isRunning?: boolean; isIdle?: boolean }>, selectedModelId: string | null) {
  const ms = runningModels[model.id];
  const isCloud = !!model.apiKey && model.backend && cloudBackends.includes(model.backend);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8, flexWrap: 'wrap' }}>
      {!!model.mmproj && <span style={{ fontSize: '0.7rem', background: '#8b5cf6', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Multi-Modal</span>}
      {isCloud && <span style={{ fontSize: '0.7rem', background: '#3b82f6', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Cloud</span>}
      {ms?.isRunning && ms?.isIdle && <span style={{ fontSize: '0.7rem', background: '#10b981', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Idle</span>}
      {ms?.isRunning && !ms?.isIdle && <span style={{ fontSize: '0.7rem', background: '#f59e0b', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Loading</span>}
      {selectedModelId === model.id && !ms?.isRunning && !isCloud && <span style={{ fontSize: '0.7rem', background: '#6b7280', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Selected (Not Loaded)</span>}
      <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Context: {(model.contextLength / 1024).toFixed(0)}k</span>
      <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Backend: {model.backend || 'other'}</span>
      <span>{model.description}</span>
    </span>
  );
}

function renderBudgetStrategySubtext(strategy: BudgetStrategy) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 }}>
      <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Online: {strategy.switchProbabilty}% • Budget: ${strategy.maximumBudget}</span>
    </span>
  );
}

function renderProfileSubtext(profile: Profile) {
  const flags: string[] = [];
  if (profile.forceNameReveal) flags.push('Force Names');
  if (profile.useCurrentDateAndTime) flags.push('Clock');
  if (profile.cacheInvalidationReductionLevel >= 1) flags.push(`Cache L${profile.cacheInvalidationReductionLevel}`);
  if (profile.enableMemoryReading) flags.push('Memory Read');
  if (profile.enableMemoryWriting) flags.push('Memory Write');
  if (profile.forceEqualInitiative || profile.chatProbability !== -1 || profile.maximumChatStamina !== -1 || profile.nameSensitivity !== -1 || profile.responseDelayWeight !== -1 || profile.memoryRetentionWeight !== -1 || profile.contextSensitivity !== -1) flags.push('Character Stats Override');

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.8, flexWrap: 'wrap' }}>
      {flags.length > 0
        ? flags.map((f, i) => <span key={i} style={{ fontSize: '0.65rem', background: 'var(--accent-bg)', color: 'var(--accent)', padding: '1px 5px', borderRadius: '3px' }}>{f}</span>)
        : <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>No special settings</span>}
    </span>
  );
}

function renderChatSubtext(c: {
  parentChatDataId?: string;
  numberOfMessages?: number;
  chatMessageHistory: unknown[];
  participants?: unknown[];
  contexts?: unknown[];
}) {
  const parts: string[] = [];
  if (c.parentChatDataId) parts.push(`Branch of ${c.parentChatDataId.substring(0, 8)}...`);
  parts.push(`${c.numberOfMessages ?? c.chatMessageHistory.length} message${(c.numberOfMessages ?? c.chatMessageHistory.length) > 1 ? 's' : ''}`);
  parts.push(`${c.participants?.length ?? 0} character${(c.participants?.length ?? 0) !== 1 ? 's' : ''}`);
  if ((c.contexts?.length ?? 0) > 0) parts.push(`${c.contexts?.length} context${c.contexts?.length !== 1 ? 's' : ''}`);
  return parts.join(' • ');
}

function renderContextSubtext(i: {
  regularExpressionActivationTrigger?: string;
  images?: unknown[];
  searchTerms?: unknown[];
  urls?: unknown[];
  text?: string;
}) {
  const parts: string[] = [];
  const imageCount = i.images?.length ?? 0;
  const searchTermCount = i.searchTerms?.length ?? 0;
  const urlCount = i.urls?.length ?? 0;
  if (!i.regularExpressionActivationTrigger) parts.push('📌'); else parts.push('⚡');
  if (imageCount > 0) parts.push(`🖼️${imageCount}`);
  if (searchTermCount > 0) parts.push(`🔎${searchTermCount}`);
  if (urlCount > 0) parts.push(`🔗${urlCount}`);
  parts.push(`${i.text?.substring(0, 50) || ''}...`);
  return parts.join(' ');
}

function renderExtensionSubtext(ext: { extensionType: string; description: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '3px', opacity: 0.8 }}>
      <span style={{ fontSize: '0.65rem', background: 'var(--border)', padding: '2px 3px', borderRadius: '4px', textTransform: 'uppercase' }}>{ext.extensionType.replace(/_/g, ' ')}</span>
      <span>{ext.description}</span>
    </span>
  );
}

// ─── Loading Screen ─────────────────────────────────────────────────

function LoadingScreen({ steps, isFadeOut }: { steps: LoadStep[]; isFadeOut: boolean }) {
  const done = steps.filter(s => s.done).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', width: '100vw', background: 'var(--bg)', color: 'var(--text-h)', fontFamily: 'monospace', zIndex: 9999, opacity: isFadeOut ? 0 : 1, transition: 'opacity 0.3s ease-out', pointerEvents: isFadeOut ? 'none' : 'auto' }}>
      <div style={{ fontSize: '2rem', marginBottom: '32px', fontWeight: 'bold', color: 'var(--accent)' }}>⚛️ LoreReactor</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '320px', maxWidth: '90vw' }}>
        {steps.map(step => (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', flexShrink: 0, background: step.done ? 'var(--accent)' : 'transparent', border: `1px solid ${step.done ? 'var(--accent)' : 'var(--border)'}`, color: step.done ? '#fff' : 'var(--text-h)', transition: 'all 0.3s ease', opacity: step.done ? 1 : 0.5 }}>
              {step.done ? '✓' : step.icon}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '0.7rem', opacity: step.done ? 1 : 0.5, color: step.done ? 'var(--accent)' : 'var(--text-h)', transition: 'all 0.3s ease', fontWeight: step.done ? 'bold' : 'normal' }}>{step.label}</span>
              <div style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ width: step.done ? '100%' : '0%', height: '100%', borderRadius: '2px', background: 'var(--accent)', transition: 'width 0.4s ease-out', boxShadow: step.done ? '0 0 6px rgba(var(--accent-rgb, 100, 200, 255), 0.5)' : 'none' }} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: '24px', fontSize: '0.75rem', opacity: 0.5 }}>{done}/{steps.length} systems initialized</div>
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────────

function App() {
  // Session
  const {
    chatData, setChatData, currentCharacter, setCurrentCharacter,
    isLoading, streamingText, streamingCharacter, sendMessage, stopGeneration,
    resumeGeneration, regenerateFromMessage, messageEndRef, chatHistoryRef,
    generationSpeed, timeToFirstToken, numberOfMessages, numberOfTokens, maximumNumberOfTokens, startNewChat,
    numberOfCacheInvalidations, numberOfRequests, totalCost, costWithoutCacheMisses,
    sendActionAndGetResponse, setActiveBudgetStrategy, setSelectedGlobalModel, updateRunningModels,
    activeStrategy, processProtagonistImageSilently,
  } = useChatSession();

  const { addToast } = useToast();

  // Managers
  const { chats: allChats, deleteChat: deleteChatFromList, refresh: refreshChatList } = useChatListManager();
  const { characters: allCharacters, saveCharacter, deleteCharacter, loadFullCharacter } = useCharacterManager();
  const { contexts: allContexts, saveContext, deleteContext } = useContextManager();
  const { Samplers: allSamplers, saveSampler, deleteSampler } = useSamplerManager();
  const { stopPatterns: allStopPatterns, saveStopPattern, deleteStopPattern } = useStopPatternManager();
  const { models: allModels, saveModel, deleteModel, runningModels, toggleModelLoad, selectedModelId, setSelectedModelId } = useModelManager();
  const { strategies: allBudgetStrategies, saveStrategy: saveBudgetStrategy, deleteStrategy: deleteBudgetStrategy } = useBudgetStrategyManager();
  const { extensions: allExtensions, deleteExtension } = useExtensionManager();
  const { profiles: allProfiles, saveProfile, deleteProfile } = useProfileManager();

  // Entity modals
  const charModal = useEntityModal<Character>(saveCharacter, deleteCharacter, 'Character');
  const contextModal = useEntityModal<Context>(saveContext, deleteContext, 'Context');
  const stopModal = useEntityModal<StopPattern>(saveStopPattern, deleteStopPattern, 'Stop Pattern');
  const modelModal = useEntityModal<LanguageModel>(saveModel, deleteModel, 'Model');
  const budgetModal = useEntityModal<BudgetStrategy>(saveBudgetStrategy, deleteBudgetStrategy, 'Budget Strategy');
  const profileModal = useEntityModal<Profile>(saveProfile, deleteProfile, 'Profile');

  // UI state
  const [viewMode, setViewMode] = useState<'ladder' | 'cinematic'>('ladder');
  const [inputText, setInputText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [massDeleteId, setMassDeleteId] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [actionMenuTarget, setActionMenuTarget] = useState<{ messageId: string; charId: string; x: number; y: number } | null>(null);
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const [actions, setActions] = useState<InterjectableAction[]>([]);
  const [centerAvatar, setCenterAvatar] = useState<Character | null>(null);
  const [branchSourceTitle, setBranchSourceTitle] = useState<string | null>(null);
  const [defaultCharacterId, setDefaultCharacterId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY_DEFAULT_CHARACTER)
  );
  const [selectedBudgetStrategyId, setSelectedBudgetStrategyId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY_BUDGET_STRATEGY)
  );
  
  const [maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens, setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens] = useState<number>(0);

  // Panel visibility
  const [isChatListOpen, setIsChatListOpen] = useState(false);
  const [isCharListOpen, setIsCharListOpen] = useState(false);
  const [isContextListOpen, setIsContextListOpen] = useState(false);
  const [isSamplerListOpen, setIsSamplerListOpen] = useState(false);
  const [isExtListOpen, setIsExtListOpen] = useState(false);
  const [isModelListOpen, setIsModelListOpen] = useState(false);
  const [isStopListOpen, setIsStopListOpen] = useState(false);
  const [isBudgetStrategyListOpen, setIsBudgetStrategyListOpen] = useState(false);
  const [isProfileListOpen, setIsProfileListOpen] = useState(false);
  const [isSamplerEditorOpen, setIsSamplerEditorOpen] = useState(false);
  const [samplerToEdit, setSamplerToEdit] = useState<Sampler | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lastViewedMessageIdRef = useRef<string | null>(null);
  const suppressAutoScrollRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressingRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const [activeToolbarId, setActiveToolbarId] = useState<string | null>(null);
  const chatDataRef = useRef<ChatData | null>(null);

  useEffect(() => {
    chatDataRef.current = chatData;
  }, [chatData]);

  // Loading state
  const loadSteps = useMemo<LoadStep[]>(() => [
    { id: 'characters', label: 'Characters', icon: '🎭', done: allCharacters.length > 0 },
    { id: 'models', label: 'Models', icon: '🤖', done: allModels.length > 0 },
    { id: 'contexts', label: 'Contexts', icon: '🌍', done: allContexts.length > 0 },
    { id: 'samplers', label: 'Samplers', icon: '🎚️', done: allSamplers.length > 0 },
    { id: 'stopPatterns', label: 'Stop Patterns', icon: '🛑', done: allStopPatterns.length > 0 },
    { id: 'budget', label: 'Budget', icon: '💰', done: allBudgetStrategies.length > 0 },
    { id: 'profiles', label: 'Profiles', icon: '⚙️', done: allProfiles.length > 0 },
    { id: 'chats', label: 'Chat Sessions', icon: '💬', done: allChats.length > 0 },
  ], [allCharacters, allModels, allContexts, allSamplers, allStopPatterns, allBudgetStrategies, allProfiles, allChats]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isFadeOut, setIsFadeOut] = useState(false);

  // ✅ Derived model readiness
  const isModelReady = useMemo(() => {
    if (!selectedModelId) return false;
    const selectedModel = allModels.find(m => m.id === selectedModelId);
    if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend)) {
      return true;
    }
    return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle === true;
  }, [selectedModelId, allModels, runningModels]);

  const isModelLoading = useMemo(() => {
    if (!selectedModelId) return false;
    const selectedModel = allModels.find(m => m.id === selectedModelId);
    if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend)) {
      return false;
    }
    return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle !== true;
  }, [selectedModelId, allModels, runningModels]);

  const modelStatusMessage = !selectedModelId ? 'No model selected — open Models to load one' : isModelLoading ? 'Model is warming up... please wait' : '';
  const hasSession = !!currentCharacter && !!chatData;
  const isMassActive = massDeleteId !== null;
  const massStartIndex = isMassActive && chatData ? chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId) : -1;
  const branchOffIndex = chatData?.parentChatMessageId ? chatData.chatMessageHistory.findIndex(m => m.id === chatData.parentChatMessageId) : -1;
  const cinematicAvatarUrl = centerAvatar ? getCharacterImageUrl(centerAvatar.image) : null;
  const formattedStreamingText = useMemo(() => formatMessageText(streamingText), [streamingText]);

  const maximumNumberOfContextTokens = useMemo(() => {
    if (!chatData?.contexts?.length) return 0;
    let total = 0;
    for (const ctx of chatData.contexts) {
      if (ctx.text) total += Math.ceil(ctx.text.length / 4);
    }
    return total;
  }, [chatData]);

  // ─── Effects: Persistence & Restoration ───────────────────────────

  useEffect(() => { 
    loadInterjectableActions().then(setActions); 
  }, []);
  
  useEffect(() => { 
    if (actions.length > 0) saveInterjectableActions(actions); 
  }, [actions]);

  // ✅ Load Saved Chat on Mount
  useEffect(() => {
    const savedChatId = localStorage.getItem(STORAGE_KEY_ACTIVE_CHAT);
    const savedModelId = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL);

    if (savedModelId) {
      setTimeout(() => setSelectedModelId(savedModelId), 0);
    }

    if (savedChatId) {
      (async () => {
        try {
          const chatData = await loadRawChatData(savedChatId);
          if (chatData) {
            let fullChat = chatData;
            if (!chatData.chatMessageHistory || chatData.chatMessageHistory.length === 0) {
              fullChat = await loadChatMessages(chatData as ChatData);
            }
            
            if (fullChat) {
              const chatData = fullChat as ChatData;
              let protagonist = chatData.protagonist;
              if (protagonist && !protagonist.systemPrompt) {
                  const fullChar = await loadFullCharacter(protagonist.id);
                  if (fullChar) protagonist = fullChar;
              }

              setChatData({ ...chatData, protagonist });
              if (protagonist) setCurrentCharacter(protagonist);
            }
          }
        } catch (e) {
          console.error('Failed to restore active chat:', e);
          localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
        }
      })();
    }
  }, [loadFullCharacter, setChatData, setCurrentCharacter, setSelectedModelId]);

  // ✅ Save Active Chat ID when it changes
  useEffect(() => {
    if (chatData?.id) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_CHAT, chatData.id);
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
    }
  }, [chatData?.id]);

  useEffect(() => {
    if (selectedBudgetStrategyId) {
      localStorage.setItem(STORAGE_KEY_BUDGET_STRATEGY, selectedBudgetStrategyId);
    } else {
      localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY);
    }
  }, [selectedBudgetStrategyId]);

  useEffect(() => {
    if (!selectedBudgetStrategyId || allBudgetStrategies.length === 0) return;
    const strategy = allBudgetStrategies.find(s => s.id === selectedBudgetStrategyId);
    if (strategy) {
      setActiveBudgetStrategy(strategy);
    } else {
      localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY);
    }
  }, [selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy]);

  useEffect(() => {
    if (defaultCharacterId) {
      localStorage.setItem(STORAGE_KEY_DEFAULT_CHARACTER, defaultCharacterId);
    } else {
      localStorage.removeItem(STORAGE_KEY_DEFAULT_CHARACTER);
    }
  }, [defaultCharacterId]);

  useEffect(() => {
    if (selectedModelId) {
      localStorage.setItem(STORAGE_KEY_SELECTED_MODEL, selectedModelId);
    } else {
      localStorage.removeItem(STORAGE_KEY_SELECTED_MODEL);
    }
  }, [selectedModelId]);

  useEffect(() => {
    if (!selectedModelId || allModels.length === 0) return;
    const selectedModel = allModels.find(m => m.id === selectedModelId);
    if (!selectedModel) {
      setSelectedModelId(null);
      return;
    }
    const isCloudModel = !!selectedModel.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend);
    if (isCloudModel) return; 
    const isRunning = runningModels[selectedModelId]?.isRunning;
    if (!isRunning) {
      setSelectedModelId(null);
    }
  }, [selectedModelId, allModels, runningModels]);

  useEffect(() => {
    const parentChatDataId = chatData?.parentChatDataId;
    if (!parentChatDataId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await loadRawChatData(parentChatDataId);
        if (!cancelled) setBranchSourceTitle(s ? (s.name || 'Untitled Chat') : null);
      } catch {
        if (!cancelled) setBranchSourceTitle(null);
      }
    })();
    return () => { cancelled = true; };
  }, [chatData?.parentChatDataId]);

  useEffect(() => {
    if (defaultCharacterId && allCharacters.length > 0) {
      const c = allCharacters.find(x => x.id === defaultCharacterId);
      if (c && currentCharacter?.id !== c.id) setCurrentCharacter(c);
    }
  }, [defaultCharacterId, allCharacters, currentCharacter?.id, setCurrentCharacter]);

  useEffect(() => {
    if (selectedModelId && runningModels[selectedModelId]?.isRunning) {
      const m = allModels.find(x => x.id === selectedModelId);
      const p = runningModels[selectedModelId].port;
      if (m && p) setSelectedGlobalModel({ ...m, parameters: { ...m.parameters, _runtimePort: p } });
    } else if (selectedModelId) {
      setSelectedGlobalModel(allModels.find(x => x.id === selectedModelId) || null);
    } else setSelectedGlobalModel(null);
  }, [selectedModelId, runningModels, allModels, setSelectedGlobalModel]);

  useEffect(() => { updateRunningModels(runningModels); }, [runningModels, updateRunningModels]);

  // ✅ Robust Entity Synchronization & Deletion Handling
  useEffect(() => {
    const currentChat = chatDataRef.current;
    if (!currentChat) return;

    let changed = false;
    const updated = { ...currentChat };

    const freshProtag = allCharacters.find(c => c.id === currentChat.protagonist.id);
    if (!freshProtag) {
      console.warn(`Protagonist ${currentChat.protagonist.id} was deleted. Resetting.`);
      const fallback = allCharacters[0]; 
      if (fallback) {
        updated.protagonist = fallback;
        changed = true;
      }
    } else if (freshProtag.lastUpdatedTimestamp !== currentChat.protagonist.lastUpdatedTimestamp) {
      updated.protagonist = freshProtag;
      changed = true;
    }

    const validParticipants = currentChat.participants.filter(p => {
      const exists = allCharacters.some(c => c.id === p.id);
      if (!exists) {
        console.warn(`Participant ${p.id} was deleted. Removing from chat.`);
        changed = true;
      }
      return exists;
    });

    const freshParticipants = validParticipants.map(p => {
      const fresh = allCharacters.find(c => c.id === p.id);
      return (fresh && fresh.lastUpdatedTimestamp !== p.lastUpdatedTimestamp) ? fresh : p;
    });

    if (freshParticipants.length !== currentChat.participants.length || 
        freshParticipants.some((p, i) => p !== currentChat.participants[i])) {
      updated.participants = freshParticipants;
      changed = true;
    }

    if (currentChat.contexts?.length) {
      const validContexts = currentChat.contexts.filter(ctx => {
        const exists = allContexts.some(c => c.id === ctx.id);
        if (!exists) {
          console.warn(`Context ${ctx.id} was deleted. Removing from chat.`);
          changed = true;
        }
        return exists;
      });

      const freshContexts = validContexts.map(ctx => {
        const fresh = allContexts.find(c => c.id === ctx.id);
        return (fresh && fresh.lastUpdatedTimestamp !== ctx.lastUpdatedTimestamp) ? fresh : ctx;
      });

      if (freshContexts.length !== currentChat.contexts.length ||
          freshContexts.some((c, i) => c !== currentChat.contexts?.[i])) {
        updated.contexts = freshContexts;
        changed = true;
      }
    }

    if (currentChat.Profile) {
      const freshProfile = allProfiles.find(p => p.id === currentChat.Profile?.id);
      if (!freshProfile) {
        console.warn(`Profile ${currentChat.Profile.id} was deleted. Clearing from chat.`);
        updated.Profile = undefined;
        changed = true;
      } else if (freshProfile.lastUpdatedTimestamp !== currentChat.Profile.lastUpdatedTimestamp) {
        updated.Profile = freshProfile;
        changed = true;
      }
    }

    if (currentCharacter) {
      const freshCurrent = allCharacters.find(c => c.id === currentCharacter.id);
      if (!freshCurrent) {
         setCurrentCharacter(updated.protagonist);
      } else if (freshCurrent.lastUpdatedTimestamp !== currentCharacter.lastUpdatedTimestamp) {
        setCurrentCharacter(freshCurrent);
      }
    }

    if (changed) setChatData(updated);
  }, [allCharacters, allContexts, allProfiles, currentCharacter, setChatData, setCurrentCharacter]);

  useEffect(() => {
    if (!activeStrategy) return;
    let stratChanged = false;
    const updatedStrat = { ...activeStrategy };
    const freshOnline = allModels.find(m => m.id === activeStrategy.onlineModel.id);
    if (freshOnline && freshOnline.lastUpdatedTimestamp !== activeStrategy.onlineModel.lastUpdatedTimestamp) {
      updatedStrat.onlineModel = freshOnline;
      stratChanged = true;
    }
    const freshLocal = allModels.find(m => m.id === activeStrategy.localModel.id);
    if (freshLocal && freshLocal.lastUpdatedTimestamp !== activeStrategy.localModel.lastUpdatedTimestamp) {
      updatedStrat.localModel = freshLocal;
      stratChanged = true;
    }
    if (stratChanged) setActiveBudgetStrategy(updatedStrat);
  }, [activeStrategy, allModels, setActiveBudgetStrategy]);

  useEffect(() => {
    if (!isInitializing) return;
    if (loadSteps.every(s => s.done)) {
      const t = setTimeout(() => { setIsFadeOut(true); setTimeout(() => { setIsInitializing(false); setIsFadeOut(false); }, 300); }, 200);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => { setIsFadeOut(true); setTimeout(() => { setIsInitializing(false); setIsFadeOut(false); }, 300); }, 4000);
    return () => clearTimeout(t);
  }, [loadSteps, isInitializing]);

  // ─── Effects: DOM Behavior ──────────────────────────────────────

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, window.innerHeight * 0.3)}px`;
  });

  useEffect(() => {
    if (!editTextareaRef.current || !editingId) return;
    editTextareaRef.current.style.height = 'auto';
    editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`;
  });

  useEffect(() => {
    const chatHistoryElement = chatHistoryRef.current;
    if (viewMode !== 'cinematic' || !chatHistoryElement || !chatData || !chatData.chatMessageHistory.length) {
      const resetAvatar = window.setTimeout(() => setCenterAvatar(null), 0);
      return () => window.clearTimeout(resetAvatar);
    }
    const opts = { root: chatHistoryElement, threshold: [0.5, 0.8, 1.0], rootMargin: '-10% 0px -60% 0px' };
    const obs = new IntersectionObserver(entries => {
      const best = entries.reduce((p, c) => p.intersectionRatio > c.intersectionRatio ? p : c);
      if (best.intersectionRatio <= 0.5) return;
      const mid = best.target.getAttribute('data-message-id'); if (!mid) return;
      const msg = chatData.chatMessageHistory.find(m => m.id === mid);
      if (!msg?.character || msg.character.id === AMBIENT_NARRATOR_ID) return;
      let avatar: Character | null = msg.character;
      if (msg.character.id === currentCharacter?.id) {
        const ci = chatData.chatMessageHistory.indexOf(msg);
        const prev = ci > 0 ? chatData.chatMessageHistory[ci - 1] : null;
        avatar = prev?.character && prev.character.id !== currentCharacter?.id && prev.character.id !== AMBIENT_NARRATOR_ID ? prev.character : null;
      }
      setCenterAvatar(avatar);
      for (const el of document.querySelectorAll('.message-row')) {
        el.classList.remove('is-active');
      }
      (best.target as HTMLElement).classList.add('is-active');
      lastViewedMessageIdRef.current = mid;
    }, opts);
    for (const el of chatHistoryElement.querySelectorAll('[data-message-id]')) {
      obs.observe(el);
    }
    let fallbackTimer: number | undefined;
    if (!centerAvatar) {
      fallbackTimer = window.setTimeout(() => {
        for (let i = chatData.chatMessageHistory.length - 1; i >= 0; i--) {
          const m = chatData.chatMessageHistory[i];
          if (m.character && m.character.id !== currentCharacter?.id && m.character.id !== AMBIENT_NARRATOR_ID) {
            setCenterAvatar(m.character);
            break;
          }
        }
      }, 0);
    }
    return () => {
      obs.disconnect();
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    };
  }, [viewMode, currentCharacter?.id, centerAvatar, chatData, chatHistoryRef]);

  useEffect(() => {
    const chatHistoryElement = chatHistoryRef.current;
    if (viewMode !== 'cinematic' || !chatHistoryElement || suppressAutoScrollRef.current) return;
    chatHistoryElement.scrollTop = 0;
  }, [viewMode, chatHistoryRef]);

  const deactivateToolbar = useCallback(() => {
    if (toolbarAutoHideRef.current) clearTimeout(toolbarAutoHideRef.current);
    setActiveToolbarId(null);
  }, []);

  useEffect(() => {
    const el = chatHistoryRef.current; if (!el) return;
    const fn = () => { if (activeToolbarId) deactivateToolbar(); };
    el.addEventListener('scroll', fn, { passive: true }); return () => el.removeEventListener('scroll', fn);
  }, [activeToolbarId, deactivateToolbar, chatHistoryRef]);

  useEffect(() => () => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); if (toolbarAutoHideRef.current) clearTimeout(toolbarAutoHideRef.current); }, []);

  useEffect(() => {
    if (!chatData?.chatMessageHistory || !chatData.participants) return;
    let isCancelled = false;
    const calculateMaxTokens = async () => {
      const participantCounts: Record<string, number> = {};
      for (const p of chatData.participants) {
        participantCounts[p.id] = 0;
      }
      if (chatData.protagonist && participantCounts[chatData.protagonist.id] === undefined) {
        participantCounts[chatData.protagonist.id] = 0;
      }
      const selectedModel = allModels.find(m => m.id === selectedModelId);
      const runtimePort = selectedModelId ? runningModels[selectedModelId]?.port : undefined;
      const modelContext = selectedModel ? {
        apiKey: selectedModel.apiKey,
        backend: selectedModel.backend,
        modelPath: typeof selectedModel.parameters?.modelPath === 'string'
          ? selectedModel.parameters.modelPath
          : undefined,
        runtimePort,
      } : undefined;
      for (const msg of chatData.chatMessageHistory) {
        if (msg.character && msg.textContent) {
          const charId = msg.character.id;
          if (participantCounts[charId] !== undefined || charId === AMBIENT_NARRATOR_ID) {
              const tokens = await tokenEngine.countTokens(msg.textContent, modelContext);
              if (participantCounts[charId] !== undefined) {
                participantCounts[charId] += tokens;
              }
          }
        }
      }
      if (isCancelled) return;
      const maxTokens = Math.max(...Object.values(participantCounts), 0);
      setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens(maxTokens);
    };
    calculateMaxTokens();
    return () => { isCancelled = true; };
  }, [chatData?.chatMessageHistory, chatData?.participants, chatData?.protagonist, selectedModelId, allModels, runningModels]);

  // ─── Toolbar Handlers ───────────────────────────────────────────

  const activateToolbar = useCallback((mid: string) => {
    if (toolbarAutoHideRef.current) clearTimeout(toolbarAutoHideRef.current);
    setActiveToolbarId(mid);
    toolbarAutoHideRef.current = setTimeout(() => setActiveToolbarId(p => p === mid ? null : p), 8000);
  }, []);

  const handleBubbleTouchStart = useCallback((e: React.TouchEvent, mid: string) => {
    isLongPressingRef.current = false; suppressNextClickRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressingRef.current = true; suppressNextClickRef.current = true;
      const b = (e.target as HTMLElement).closest('.message-bubble');
      b?.classList.add('toolbar-longpress-hold');
      activateToolbar(mid);
      setTimeout(() => b?.classList.remove('toolbar-longpress-hold'), 300);
      navigator.vibrate?.(30);
    }, 500);
  }, [activateToolbar]);

  const handleBubbleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    (e.target as HTMLElement).closest('.message-bubble')?.classList.remove('toolbar-longpress-hold');
    if (isLongPressingRef.current) { e.preventDefault(); isLongPressingRef.current = false; }
  }, []);

  const handleBubbleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }, []);

  // ─── Chat Operations ────────────────────────────────────────────

  const safeAutoSave = useCallback(async (data: ChatData | null) => {
    if (!data) return;
    if (data.chatMessageHistory.length === 0 && (data.numberOfMessages ?? 0) > 0) return;
    try { await saveRawChatData(data); } catch (e) { console.error('Auto-save failed:', e); }
  }, []);

  const handleSwitchChat = useCallback(async (id: string) => {
    const sel = allChats.find(c => c.id === id); if (!sel) return;
    await safeAutoSave(chatData); clearFetchCache();
    let chat = sel;
    if (!sel.chatMessageHistory.length) try { chat = await loadChatMessages(sel); } catch { addToast('Failed to load chat messages.', 'error'); }
    setChatData(chat); if (chat.protagonist) setCurrentCharacter(chat.protagonist);
    refreshChatList(); setIsChatListOpen(false); lastViewedMessageIdRef.current = null;
  }, [allChats, chatData, setChatData, setCurrentCharacter, refreshChatList, addToast, safeAutoSave]);

  const handleNewChat = useCallback(async () => {
    await safeAutoSave(chatData); 
    clearFetchCache();
    localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);

    let c = currentCharacter;
    if (!c && defaultCharacterId) c = allCharacters.find(x => x.id === defaultCharacterId) || null;
    if (!c && allChats.length) c = allChats[0].protagonist;
    
    if (c) { 
      startNewChat(c); 
      // Save immediately so it appears in the list
      // We need to wait for state to update slightly or save the object directly if startNewChat returns it
      // For now, we rely on the effect in useChatSession or manual save if needed. 
      // Since startNewChat sets state, we can't save immediately synchronously.
      // We'll let the user interact or add a useEffect to save new chats.
    }
  }, [chatData, currentCharacter, defaultCharacterId, allCharacters, allChats, startNewChat, safeAutoSave]);

  // Save new chats when they are created (detected by empty history and new ID)
  useEffect(() => {
    if (chatData && chatData.chatMessageHistory.length === 0 && chatData.id) {
       saveRawChatData(chatData).catch(e => console.error('Failed to save new chat:', e));
    }
  }, [chatData?.id, chatData?.chatMessageHistory.length]);


  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); await safeAutoSave(chatData);
    if (await deleteChatFromList(id)) { addToast('Chat session deleted.', 'info'); if (chatData?.id === id && currentCharacter) startNewChat(currentCharacter); }
    else addToast('Failed to delete chat.', 'error');
  };

  const handleToggleParticipant = async (charId: string) => {
    if (!chatData) return;
    if (charId === chatData.protagonist.id) { addToast('Cannot remove the protagonist.', 'error'); return; }
    const ids = chatData.participants.map(p => p.id);
    let np: Character[];
    if (ids.includes(charId)) { np = chatData.participants.filter(p => p.id !== charId); }
    else {
      const sh = allCharacters.find(c => c.id === charId); if (!sh) return;
      const ch = sh.sampler ? sh : await loadFullCharacter(charId); if (!ch) return;
      np = [...chatData.participants, ch];
    }
    if (!np.find(p => p.id === chatData.protagonist.id)) np.unshift(chatData.protagonist);
    const uc = { ...chatData, participants: np };
    setChatData(uc);
    if (!np.find(p => p.id === currentCharacter?.id)) setCurrentCharacter(uc.protagonist);
    addToast('Participants updated.', 'info');
  };

  const handleToggleContext = async (contextId: string) => {
    if (!chatData?.contexts) return;
    const ids = chatData.contexts.map(c => c.id);
    const nc = ids.includes(contextId)
      ? chatData.contexts.filter(c => c.id !== contextId)
      : [...chatData.contexts, await loadRawContext(contextId)].filter(Boolean) as Context[];
    setChatData({ ...chatData, contexts: nc });
    addToast('Contexts updated.', 'info');
  };

  const handleSetChatProtagonist = async (charId: string) => {
    if (!chatData) return;
    const sh = allCharacters.find(c => c.id === charId); if (!sh) return;
    const ch = sh.sampler ? sh : await loadFullCharacter(charId); if (!ch) return;
    const uc = { ...chatData, protagonist: ch };
    if (!uc.participants.find(p => p.id === charId)) uc.participants = [ch, ...uc.participants];
    setChatData(uc); setCurrentCharacter(ch); addToast('Protagonist switched.', 'info');
  };

  const handleToggleExtension = async (extId: string) => {
    if (!chatData) return;
    const extensionValue = Object.getOwnPropertyDescriptor(chatData, 'extensions')?.value;
    const currentExtensions = Array.isArray(extensionValue)
      ? extensionValue.filter((extension): extension is Extension => {
          if (typeof extension !== 'object' || extension === null || !('id' in extension)) return false;
          return typeof extension.id === 'string';
        })
      : [];
    const currentExtensionIds = currentExtensions.map(extension => extension.id);
    const nextExtensionIds = currentExtensionIds.includes(extId)
      ? currentExtensionIds.filter(id => id !== extId)
      : [...currentExtensionIds, extId];
    const uc = { ...chatData, extensions: allExtensions.filter(extension => nextExtensionIds.includes(extension.id)) };
    setChatData(uc); addToast('Extensions updated.', 'info');
  };

  const handleActivateBudgetStrategy = (sid: string) => {
    if (selectedBudgetStrategyId === sid) { setSelectedBudgetStrategyId(null); addToast('Budget strategy deactivated.', 'info'); }
    else { setSelectedBudgetStrategyId(sid); addToast(`Budget strategy "${allBudgetStrategies.find(s => s.id === sid)?.name}" activated!`, 'success'); }
  };

  const handleActivateProfile = async (pid: string) => {
    if (!chatData) return;
    if (chatData.Profile?.id === pid) {
      const uc = { ...chatData, Profile: undefined }; setChatData(uc); await saveRawChatData(uc); addToast('Profile deactivated.', 'info');
    } else {
      const p = allProfiles.find(x => x.id === pid); if (!p) return;
      const uc = { ...chatData, Profile: p }; setChatData(uc); await saveRawChatData(uc); addToast(`Profile "${p.name}" activated!`, 'success');
    }
  };

  const handleStartEditTitle = (e: React.MouseEvent) => { e.stopPropagation(); setEditTitleValue(chatData?.name || ''); setIsEditingTitle(true); };
  const handleSaveTitle = () => {
    if (!chatData) return;
    const t = editTitleValue.trim() || 'Untitled Chat';
    setChatData({ ...chatData, name: t } as ChatData);
    saveRawChatData({ ...chatData, name: t });
    refreshChatList(); setIsEditingTitle(false); addToast('Chat title updated', 'success');
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) setPendingFiles(p => [...p, ...Array.from(files)]);
    e.target.value = '';
  };

  const handleSaveEdit = async () => {
    if (!chatData || !editingId) return;
    try { setChatData(await editMessage(chatData, editingId, editDraft)); setEditingId(null); setEditDraft(''); addToast('Message edited.', 'success'); }
    catch (e) { addToast((e as Error).message, 'error'); }
  };

  const handleDelete = async (id: string) => {
    if (!chatData) return;
    try { setChatData(await deleteMessage(chatData, id)); addToast('Message deleted.', 'info'); }
    catch (e) { addToast((e as Error).message, 'error'); }
  };

  const handleMassDeleteConfirm = async () => {
    if (!chatData || !massDeleteId) return;
    const idx = chatData.chatMessageHistory.findIndex(m => m.id === massDeleteId);
    if (idx === -1) return;
    try { setChatData(await massDeleteMessages(chatData, idx)); setMassDeleteId(null); addToast('Messages deleted.', 'info'); }
    catch (e) { addToast((e as Error).message, 'error'); }
  };

  const handleBranch = async (id: string) => {
    if (!chatData) return;
    try { const b = await branchMessage(chatData, id); setChatData(b); if (b.protagonist) setCurrentCharacter(b.protagonist); refreshChatList(); addToast(`Branched to "${b.name}"`, 'success'); }
    catch { addToast('Failed to branch chat.', 'error'); }
  };

  const handleClone = async (id: string) => {
    if (!chatData) return;
    try { const c = await cloneChatUpToMessage(chatData, id); setChatData(c); if (c.protagonist) setCurrentCharacter(c.protagonist); refreshChatList(); addToast(`Cloned to "${c.name}"`, 'success'); }
    catch { addToast('Failed to clone chat.', 'error'); }
  };

  const handleNavigateToSource = async () => {
    if (!chatData?.parentChatDataId) return;
    try {
      const s = await loadRawChatData(chatData.parentChatDataId);
      if (s) { const f = s as unknown as ChatData; setChatData(f); if (f.protagonist) setCurrentCharacter(f.protagonist); refreshChatList(); addToast(`Navigated back to "${f.name || 'Untitled Chat'}"`, 'info'); }
      else addToast('Source chat not found.', 'error');
    } catch { addToast('Failed to navigate to source chat.', 'error'); }
  };

  const handleCopyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); addToast('Copied to clipboard', 'success'); }
    catch { addToast('Failed to copy text', 'error'); }
  };

  const handleSend = () => {
    if (!inputText.trim() && !pendingFiles.length) return;
    sendMessage(inputText, pendingFiles); setInputText(''); setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleAvatarClick = (e: React.MouseEvent, mid: string, char: Character) => {
    e.stopPropagation();
    setActionMenuTarget(prev => prev?.messageId === mid ? null : { messageId: mid, charId: char.id, x: e.clientX, y: e.clientY });
  };

  const incrementActionCount = async (label: string) => {
    setActions(prev => {
      const ex = prev.find(a => a.label === label);
      const na = ex ? prev.map(a => a.label === label ? { ...a, count: a.count + 1 } : a) : [...prev, { label, count: 1 }];
      saveInterjectableActions(na); return na;
    });
  };

  const handleAddAction = (label: string) => {
    const t = label.trim(); if (!t) return;
    if (actions.some(a => a.label.toLowerCase() === t.toLowerCase())) { addToast(`Action "${t}" already exists.`, 'info'); return; }
    const na = [...actions, { label: t, count: 0 }];
    setActions(na); saveInterjectableActions(na); setMenuSearchQuery(''); addToast(`Added action "${t}".`, 'success');
  };

  const handleDeleteAction = (label: string) => {
    const na = actions.filter(a => a.label !== label); setActions(na); saveInterjectableActions(na); addToast(`Removed action "${label}".`, 'info');
  };

  const handleActionInterject = async (label: string, targetChar: Character) => {
    setActionMenuTarget(null); setMenuSearchQuery('');
    if (!chatData || !currentCharacter) return;
    await incrementActionCount(label);
    if (isLoading) { stopGeneration(); await new Promise(r => setTimeout(r, 200)); }
    try { await sendActionAndGetResponse(`*${label} ${targetChar.name}.*`, targetChar); }
    catch { addToast('Failed to interject action.', 'error'); }
  };

  const getFilteredActions = () => actions
    .filter(a => a.label.toLowerCase().includes(menuSearchQuery.toLowerCase()))
    .sort((a, b) => b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label));

  const isStemMessage = (mid: string): boolean => {
    if (!chatData?.parentChatMessageId) return false;
    const bi = chatData.chatMessageHistory.findIndex(m => m.id === chatData.parentChatMessageId);
    if (bi === -1) return false;
    const ci = chatData.chatMessageHistory.findIndex(m => m.id === mid);
    return ci !== -1 && ci <= bi;
  };

  const toggleViewMode = () => {
    const container = chatHistoryRef.current;
    let targetIdx = -1;
    if (container && chatData) {
      const cr = container.getBoundingClientRect();
      const ids = new Set(chatData.chatMessageHistory.map(m => m.id));
      let bestTop = Number.POSITIVE_INFINITY;
      for (const el of container.querySelectorAll('[data-message-id]')) {
        const id = el.getAttribute('data-message-id'); if (!id || !ids.has(id)) continue;
        const r = el.getBoundingClientRect();
        if (r.top < cr.bottom && r.bottom > cr.top && r.top < bestTop) { bestTop = r.top; targetIdx = chatData.chatMessageHistory.findIndex(m => m.id === id); }
      }
    }
    if (targetIdx === -1 && lastViewedMessageIdRef.current && chatData) targetIdx = chatData.chatMessageHistory.findIndex(m => m.id === lastViewedMessageIdRef.current);
    if (targetIdx >= 0 && chatData) lastViewedMessageIdRef.current = chatData.chatMessageHistory[targetIdx].id;
    suppressAutoScrollRef.current = true;
    setViewMode(p => p === 'ladder' ? 'cinematic' : 'ladder');
    setTimeout(() => {
      if (targetIdx >= 0 && chatData && chatHistoryRef.current) {
        const el = chatHistoryRef.current.querySelector(`[data-message-id="${chatData.chatMessageHistory[targetIdx].id}"]`) as HTMLElement | null;
        if (el) { el.scrollIntoView({ block: 'start' }); setTimeout(() => { suppressAutoScrollRef.current = false; }, 400); return; }
      }
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => { suppressAutoScrollRef.current = false; }, 400);
    }, 50);
  };

  const handleOpenSamplerEditor = (sampler?: Sampler | null) => { setSamplerToEdit(sampler || null); setIsSamplerListOpen(false); setIsSamplerEditorOpen(true); };
  const handleSaveSampler = (sampler: Sampler) => { saveSampler(sampler); setIsSamplerEditorOpen(false); setSamplerToEdit(null); };

  // ─── Loading Screen ─────────────────────────────────────────────

  if (isInitializing) return <LoadingScreen steps={loadSteps} isFadeOut={isFadeOut} />;

  // ─── Streaming Indicators ───────────────────────────────────────

  const streamingIndicators = (
    <>
      {isLoading && streamingCharacter && !streamingText && (
        <div className={`message-row ${viewMode === 'cinematic' ? '' : 'message-left'}`} data-message-id="thinking-message">
          {viewMode === 'ladder' && streamingCharacter.id !== currentCharacter?.id && streamingCharacter.id !== AMBIENT_NARRATOR_ID && (
            <div className="avatar-column"><div style={{ position: 'relative' }}>{getCharacterImageUrl(streamingCharacter.image) ? <img src={getCharacterImageUrl(streamingCharacter.image)!} alt={streamingCharacter.name} className="character-avatar" onClick={e => handleAvatarClick(e, 'thinking-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} /> : <div className="character-avatar placeholder" onClick={e => handleAvatarClick(e, 'thinking-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} />}</div><span className="avatar-name" style={{ opacity: 0.5 }}>{getDelayedDisplayName(chatData, Math.max(0, chatData.chatMessageHistory.length - 1), streamingCharacter.id)}</span></div>
          )}
          <div className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} bubble-ai thinking-bubble`}>
            {viewMode === 'cinematic' && <div className="cinematic-bubble-header"><span>{getDelayedDisplayName(chatData, Math.max(0, chatData.chatMessageHistory.length - 1), streamingCharacter.id)}</span></div>}
            <span className="thinking-indicator"><span className="thinking-text">Thinking</span><span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span></span>
          </div>
        </div>
      )}
      {isLoading && streamingCharacter && streamingText && (
        <div className={`message-row ${viewMode === 'cinematic' ? '' : 'message-left'}`} data-message-id="streaming-message">
          {viewMode === 'ladder' && streamingCharacter.id !== currentCharacter?.id && streamingCharacter.id !== AMBIENT_NARRATOR_ID && (
            <div className="avatar-column"><div style={{ position: 'relative' }}>{getCharacterImageUrl(streamingCharacter.image) ? <img src={getCharacterImageUrl(streamingCharacter.image)!} alt={streamingCharacter.name} className="character-avatar" onClick={e => handleAvatarClick(e, 'streaming-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} /> : <div className="character-avatar placeholder" onClick={e => handleAvatarClick(e, 'streaming-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} />}</div><span className="avatar-name">{getDelayedDisplayName(chatData, Math.max(0, chatData.chatMessageHistory.length - 1), streamingCharacter.id)}</span></div>
          )}
          <div className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} ${streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'bubble-ambient' : 'bubble-ai'}`}>
            {viewMode === 'cinematic' && <div className={`cinematic-bubble-header ${streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'cinematic-bubble-header-ambient' : ''}`}><span>{streamingCharacter.id === AMBIENT_NARRATOR_ID ? '✦' : getDelayedDisplayName(chatData, Math.max(0, chatData.chatMessageHistory.length - 1), streamingCharacter.id)}</span></div>}
            <div style={{ display: 'inline', whiteSpace: 'pre-wrap' }}><span className="message-text" style={{ display: 'inline' }}>{formattedStreamingText}</span><span className="cursor-blink" style={{ display: 'inline' }}>&nbsp;▋</span></div>
          </div>
        </div>
      )}
    </>
  );

  // ─── Main Render ────────────────────────────────────────────────

  return (
    <>
      <div className={`chat-container ${viewMode === 'cinematic' ? 'mode-cinematic' : 'mode-ladder'}`} onClick={() => { setActionMenuTarget(null); setMenuSearchQuery(''); deactivateToolbar(); }}>
        {!hasSession && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', opacity: 0.5, gap: '12px' }}><div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent)' }}>⚛️ LoreReactor</div><div style={{ fontSize: '0.85rem' }}>Loading workspace...</div></div>}

        {hasSession && <>
          {viewMode === 'cinematic' && centerAvatar && cinematicAvatarUrl && <div className="cinematic-stage active" onClick={e => { e.stopPropagation(); handleAvatarClick(e, centerAvatar.id || 'cinematic-bg', centerAvatar); }} title="Click character to interject action"><img src={cinematicAvatarUrl} alt={centerAvatar.name} className="cinematic-avatar-img" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /></div>}

          <header className="app-header"><div className="header-content"><div className="header-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              {isEditingTitle
                ? <input type="text" value={editTitleValue} onChange={e => setEditTitleValue(e.target.value)} onBlur={handleSaveTitle} onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false); }} autoFocus style={{ background: 'var(--social-bg)', border: '1px solid var(--accent)', color: 'var(--text-h)', padding: '4px 8px', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', flexGrow: 1, maxWidth: '200px', outline: 'none' }} />
                : <><div className="header-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{chatData?.name || 'Untitled Chat'}</div><span onClick={handleStartEditTitle} title="Edit Title" style={{ fontSize: '0.9em', opacity: 0.3, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.3'}>✎</span></>}
            </div>
            <div className="header-controls-group">
              <button type="button" className="view-mode-toggle" onClick={() => chatData && setIsExtListOpen(true)} title="Extensions" style={{ padding: '6px 10px' }}><span>🧩</span></button>
              <button type="button" onClick={toggleViewMode} className={`view-mode-toggle ${viewMode === 'cinematic' ? 'active' : ''}`} title="Switch View Mode"><span>{viewMode === 'ladder' ? '🎥' : '📜'}</span><span>{viewMode === 'ladder' ? 'Cinematic' : 'Ladder'}</span></button>
              <ChatStatisticsBar
                generationSpeed={generationSpeed}
                timeToFirstToken={timeToFirstToken}
                numberOfMessages={numberOfMessages}
                numberOfTokens={numberOfTokens}
                maximumNumberOfTokens={maximumNumberOfTokens}
                maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens={maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens}
                maximumNumberOfContextTokens={maximumNumberOfContextTokens}
                numberOfCacheInvalidations={numberOfCacheInvalidations}
                numberOfRequests={numberOfRequests}
                totalCost={totalCost}
                costWithoutCacheMisses={costWithoutCacheMisses}
              />
            </div>
          </div></div></header>

          <div className="chat-history" ref={chatHistoryRef}>
            {viewMode === 'cinematic' && streamingIndicators}
            {(viewMode === 'cinematic' ? [...chatData.chatMessageHistory].reverse() : chatData.chatMessageHistory).map((message, renderIndex) => {
              const index = viewMode === 'cinematic' ? chatData.chatMessageHistory.length - 1 - renderIndex : renderIndex;
              if (!message.character) return null;
              const isAmbient = message.character.id === AMBIENT_NARRATOR_ID;
              const isProtag = message.character.id === currentCharacter?.id;
              const dn = getDelayedDisplayName(chatData, index, message.character.id);
              const isEditing = editingId === message.id;
              const isMassStart = message.id === massDeleteId;
              const inDelRange = isMassActive && massStartIndex !== -1 && index >= massStartIndex;
              const stem = isStemMessage(message.id);
              const beforeBranch = chatData.parentChatMessageId && index === branchOffIndex;
              const showAvatar = viewMode === 'ladder' && !isProtag && !isAmbient;

              const isResumingThisMessage = isLoading && streamingCharacter && message.isPartial
                && message.character.id === streamingCharacter.id
                && !isProtag;

              if (isResumingThisMessage) return null;

              return (
                <React.Fragment key={message.id}>
                  <div className={`message-row ${viewMode === 'cinematic' ? '' : isProtag ? 'message-right' : 'message-left'} ${inDelRange ? 'message-fading-out' : ''}`} data-message-id={message.id}>
                    {showAvatar && <div className="avatar-column"><div style={{ position: 'relative' }}>{getCharacterImageUrl(message.character.image) ? <img src={getCharacterImageUrl(message.character.image)!} alt={dn} className="character-avatar" onClick={e => handleAvatarClick(e, message.id, message.character)} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} style={{ cursor: 'pointer' }} /> : <div className="character-avatar placeholder" onClick={e => handleAvatarClick(e, message.id, message.character)} style={{ cursor: 'pointer' }} />}</div><span className="avatar-name">{dn}</span></div>}
                    <div
                      className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} ${isProtag ? 'bubble-user' : 'bubble-ai'} ${isAmbient ? 'bubble-ambient' : ''} ${isEditing ? 'bubble-editing' : ''} ${inDelRange ? 'bubble-marked-for-delete' : ''} ${stem ? 'bubble-stem' : ''} ${activeToolbarId === message.id ? 'toolbar-active' : ''}`}
                      onTouchStart={e => handleBubbleTouchStart(e, message.id)}
                      onTouchEnd={handleBubbleTouchEnd}
                      onTouchMove={handleBubbleTouchMove}
                      onClick={e => { if (suppressNextClickRef.current) { e.preventDefault(); e.stopPropagation(); suppressNextClickRef.current = false; } }}
                    >
                      {viewMode === 'cinematic' && <div className={`cinematic-bubble-header ${isAmbient ? 'cinematic-bubble-header-ambient' : ''}`}><span>{isAmbient ? '✦' : dn}</span></div>}
                      {isEditing ? (
                        <div className="edit-mode">
                          <textarea ref={editTextareaRef} value={editDraft} onChange={e => setEditDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); } if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); } }} className="edit-textarea" />
                          <div className="edit-actions">
                            <button type="button" onClick={() => { setEditingId(null); setEditDraft(''); }} className="edit-btn edit-btn-cancel">Cancel</button>
                            <button type="button" onClick={handleSaveEdit} className="edit-btn edit-btn-save">Save</button>
                          </div>
                        </div>
                      ) : <>
                        <MemoizedMessageText text={message.textContent} />
                        <div className="message-toolbar">
                          {stem ? <span className="toolbar-lock">🔒 Locked</span> : !isMassActive ? <>
                            {!isProtag && message.isPartial && <button type="button" onClick={() => resumeGeneration(message.id)} disabled={!isModelReady} className="toolbar-btn" title="Resume interrupted generation" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>▶</button>}
                            <button type="button" onClick={() => handleCopyText(message.textContent)} className="toolbar-btn" title="Copy text to clipboard">📋</button>
                            <button type="button" onClick={() => { setEditingId(message.id); setEditDraft(message.textContent); }} className="toolbar-btn">✎</button>
                            {!isProtag && <button type="button" onClick={() => regenerateFromMessage(message.id, 'ai')} disabled={!isModelReady} className="toolbar-btn" title="Regenerate this Response" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>↻</button>}
                            {isProtag && <button type="button" onClick={() => regenerateFromMessage(message.id, 'user')} disabled={!isModelReady} className="toolbar-btn" title="Regenerate Your Input" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>↻</button>}
                            <button type="button" onClick={() => handleBranch(message.id)} className="toolbar-btn" title="Branch from here">🌿</button>
                            <button type="button" onClick={() => handleClone(message.id)} className="toolbar-btn" title="Clone chat up to here">⑂</button>
                            <button type="button" onClick={() => handleDelete(message.id)} className="toolbar-btn delete-btn" style={{ color: '#ff4444' }}>🗑</button>
                            <button type="button" onClick={() => setMassDeleteId(message.id)} className="toolbar-btn mass-delete-btn" style={{ color: '#ff9900' }}>🗑️↓</button>
                          </> : isMassStart ? <div className="mass-delete-confirm-bar"><span>Delete from here?</span><button type="button" onClick={handleMassDeleteConfirm} className="toolbar-btn btn-confirm">Confirm</button><button type="button" onClick={() => setMassDeleteId(null)} className="toolbar-btn btn-cancel">Cancel</button></div> : inDelRange ? <span className="deleted-preview-label">Will be deleted</span> : null}
                        </div>
                      </>}
                    </div>
                  </div>
                  {beforeBranch && <div className="branch-separator-line clickable" onClick={handleNavigateToSource} title={`Click to go back to "${branchSourceTitle || 'source chat'}"`} style={{ cursor: 'pointer' }}><div className="branch-separator-content"><span className="branch-separator-icon">🌿</span><span className="branch-separator-text">{branchSourceTitle ? `Branches From "${branchSourceTitle}"` : 'Conversation Branches Here'}</span><span className="branch-separator-icon">🌿</span></div></div>}
                </React.Fragment>
              );
            })}
            {viewMode === 'ladder' && streamingIndicators}
            {chatData && !chatData.chatMessageHistory.length && <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}><p>Add characters to the chat and start chatting.</p></div>}
            <div ref={messageEndRef} style={{ height: '1px' }} />
          </div>

          <div className="context-bar" style={{ display: viewMode === 'cinematic' ? 'none' : 'flex' }}>
            <NavButton icon="💬" label="Chat List" onClick={() => setIsChatListOpen(true)} />
            <NavButton icon="🎭" label="Characters" onClick={() => setIsCharListOpen(true)} />
            <NavButton icon="🌍" label="Contexts" onClick={() => setIsContextListOpen(true)} />
            <NavButton icon="🤖" label="Models" onClick={() => setIsModelListOpen(true)} />
            <NavButton icon="🎚️" label="Samplers" onClick={() => setIsSamplerListOpen(true)} />
            <NavButton icon="🛑" label="Stop Patterns" onClick={() => setIsStopListOpen(true)} />
            <NavButton icon="💰" label="Budgets" onClick={() => setIsBudgetStrategyListOpen(true)} />
            <NavButton icon="⚙️" label="Profiles" onClick={() => setIsProfileListOpen(true)} />
          </div>

          <div className="input-wrapper">
            {!isModelReady && <div className={`model-status-banner ${!selectedModelId ? 'model-status-warning' : 'model-status-loading'}`}>{!selectedModelId && <span className="model-status-icon">🤖</span>}{isModelLoading && <span className="model-status-spinner" />}<span className="model-status-text">{modelStatusMessage}</span>{!selectedModelId && <button type="button" className="model-status-action-btn" onClick={() => setIsModelListOpen(true)}>Open Models</button>}</div>}
            {pendingFiles.length > 0 && <div className="attachment-strip">{pendingFiles.map((f, i) => <div key={`${f.name}-${i}`} className="attachment-chip"><span className="attachment-name">{f.name}</span><span className="attachment-size">{(f.size / 1024).toFixed(1)} KB</span><button type="button" onClick={() => setPendingFiles(p => p.filter((_, j) => j !== i))} className="attachment-remove">×</button></div>)}</div>}
            <div className="input-area">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading || !isModelReady} className="attach-button toolbar-btn">📎</button>
              <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelected} />
              <textarea ref={textareaRef} value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder={isModelReady ? `Chat as ${currentCharacter?.name || 'User'}.` : isModelLoading ? 'Warming up... please wait' : 'Load a model to start chatting...'} className={`chat-input ${!isModelReady ? 'chat-input-disabled' : ''}`} disabled={isLoading || !chatData || !isModelReady} />
              <button type="button" onClick={isLoading ? stopGeneration : handleSend} disabled={!isLoading && (!inputText.trim() && !pendingFiles.length) || (!isLoading && !isModelReady)} className={`send-button counter ${!isLoading && !isModelReady ? 'send-button-disabled' : ''}`}>{isLoading ? '⏹ Stop' : !isModelReady ? '⏳ Wait' : 'Send'}</button>
            </div>
          </div>
        </>}

        {/* ─── Modals ─────────────────────────────────────────────── */}

        {isChatListOpen && <ManagerModal title="Chat Sessions" items={allChats} isOpen={isChatListOpen} onClose={() => setIsChatListOpen(false)} onSelect={c => handleSwitchChat(c.id)} onDelete={id => handleDeleteChat({ stopPropagation: () => {} } as any, id)} onCreateNew={handleNewChat} renderSubtext={renderChatSubtext} emptyMessage="No saved chat sessions found." />}

        {isCharListOpen && <ManagerModal title="Characters" items={allCharacters} isOpen={isCharListOpen} onClose={() => setIsCharListOpen(false)} onSelect={async c => { const f = c.sampler ? c : await loadFullCharacter(c.id); charModal.open(f || c); }} onDelete={deleteCharacter} onCreateNew={() => charModal.open()} renderSubtext={c => c.description || 'No description'} emptyMessage="No characters found." actionLabel="Delete" orderedListMode={!!chatData} currentOrderIds={chatData?.participants.map(p => p.id) || []} onToggleOrder={handleToggleParticipant} specialActionIcon="★" onSpecialAction={handleSetChatProtagonist} specialActionTooltip={c => `set ${c.name} as the protagonist`} activeSpecialActionId={chatData?.protagonist.id} />}
        {charModal.isOpen && <CharacterEditorModal isOpen={charModal.isOpen} onClose={charModal.close} onSave={charModal.handleSave} existingCharacter={charModal.itemToEdit} allSamplers={allSamplers} selectedModel={allModels.find(m => m.id === selectedModelId) || null} runningModels={runningModels} />}

        {isContextListOpen && <ManagerModal title="Contexts" items={allContexts} isOpen={isContextListOpen} onClose={() => setIsContextListOpen(false)} onSelect={c => contextModal.open(c)} onDelete={contextModal.handleDelete} onCreateNew={() => contextModal.open()} renderSubtext={renderContextSubtext} emptyMessage="No contexts found." actionLabel="Delete" orderedListMode={true} currentOrderIds={chatData?.contexts?.map(i => i.id) || []} onToggleOrder={handleToggleContext} />}
        {contextModal.isOpen && <ContextEditorModal isOpen={contextModal.isOpen} onClose={contextModal.close} onSave={contextModal.handleSave} existingContext={contextModal.itemToEdit} allCharacters={allCharacters} />}

        {isModelListOpen && <ManagerModal title="Models" items={allModels} isOpen={isModelListOpen} onClose={() => setIsModelListOpen(false)} onSelect={m => modelModal.open(m)} onDelete={deleteModel} onCreateNew={() => modelModal.open()} renderSubtext={m => renderModelSubtext(m, runningModels, selectedModelId)} emptyMessage="No models available." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={selectedModelId || undefined} specialActionIcon="★" onSpecialAction={id => toggleModelLoad(id)} specialActionTooltip={m => { const ms = runningModels[m.id]; const isCloud = !!m.apiKey && m.backend && cloudBackends.includes(m.backend); if (isCloud && selectedModelId === m.id) return '☁️ Cloud Model — Click to Deselect'; if (isCloud) return '☁️ Cloud Model — Click to Select'; if (ms?.isRunning && ms?.isIdle && selectedModelId === m.id) return '⏹ Stop & Deselect'; if (ms?.isRunning && ms?.isIdle) return '⏹ Stop Model'; if (ms?.isRunning && !ms?.isIdle) return '⏳ Loading...'; if (selectedModelId === m.id) return '✓ Already Selected — Click to Load'; return '▶ Load & Select Model'; }} />}
        {modelModal.isOpen && <ModelEditorModal isOpen={modelModal.isOpen} onClose={modelModal.close} onSave={modelModal.handleSave} existingModel={modelModal.itemToEdit} allStopPatterns={allStopPatterns} />}

        {isSamplerListOpen && <ManagerModal title="Samplers" items={allSamplers} isOpen={isSamplerListOpen} onClose={() => setIsSamplerListOpen(false)} onSelect={s => handleOpenSamplerEditor(s)} onDelete={deleteSampler} onCreateNew={() => handleOpenSamplerEditor(null)} renderSubtext={s => `Temp: ${s?.parameters?.temperature}, TopP: ${s?.parameters?.top_p}, Tokens: ${s?.maximumNumberOfTokens}`} emptyMessage="No samplers found." actionLabel="Delete" />}
        {isSamplerEditorOpen && <SamplerEditorModal isOpen={isSamplerEditorOpen} onClose={() => { setIsSamplerEditorOpen(false); setSamplerToEdit(null); }} onSave={handleSaveSampler} existingSampler={samplerToEdit} allStopPatterns={allStopPatterns} />}

        {isStopListOpen && <ManagerModal title="Stop Patterns" items={allStopPatterns} isOpen={isStopListOpen} onClose={() => setIsStopListOpen(false)} onSelect={s => stopModal.open(s)} onDelete={stopModal.handleDelete} onCreateNew={() => stopModal.open()} renderSubtext={s => <span style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block' }}>{s.regularExpressionActivationTrigger ? '⚡' : '📌'} Pattern: {s.pattern}</span>} emptyMessage="No stop patterns found." actionLabel="Delete" orderedListMode={false} />}
        {stopModal.isOpen && <StopPatternEditorModal isOpen={stopModal.isOpen} onClose={stopModal.close} onSave={stopModal.handleSave} existingStopPattern={stopModal.itemToEdit} />}

        {isBudgetStrategyListOpen && <ManagerModal title="Budget Strategies" items={allBudgetStrategies} isOpen={isBudgetStrategyListOpen} onClose={() => setIsBudgetStrategyListOpen(false)} onSelect={s => budgetModal.open(s)} onDelete={budgetModal.handleDelete} onCreateNew={() => budgetModal.open()} renderSubtext={renderBudgetStrategySubtext} emptyMessage="No budget strategies found." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={selectedBudgetStrategyId || undefined} specialActionIcon="★" onSpecialAction={handleActivateBudgetStrategy} specialActionTooltip={s => selectedBudgetStrategyId === s.id ? `Deactivate ${s.name}` : `Activate ${s.name}`} />}
        {budgetModal.isOpen && <BudgetStrategyEditorModal isOpen={budgetModal.isOpen} onClose={budgetModal.close} onSave={budgetModal.handleSave} existingStrategy={budgetModal.itemToEdit} allModels={allModels} />}

        {isProfileListOpen && <ManagerModal title="Profiles" items={allProfiles} isOpen={isProfileListOpen} onClose={() => setIsProfileListOpen(false)} onSelect={p => profileModal.open(p)} onDelete={deleteProfile} onCreateNew={() => profileModal.open()} renderSubtext={renderProfileSubtext} emptyMessage="No profiles found." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={chatData?.Profile?.id || undefined} specialActionIcon="★" onSpecialAction={handleActivateProfile} specialActionTooltip={p => chatData?.Profile?.id === p.id ? `Deactivate ${p.name}` : `Activate ${p.name}`} />}
        {profileModal.isOpen && <ProfileEditorModal isOpen={profileModal.isOpen} onClose={profileModal.close} onSave={profileModal.handleSave} existingProfile={profileModal.itemToEdit} />}

        {isExtListOpen && <ManagerModal title="Extensions" items={allExtensions} isOpen={isExtListOpen} onClose={() => setIsExtListOpen(false)} onSelect={undefined} onDelete={deleteExtension} onCreateNew={() => addToast('Create Extension Modal coming soon!', 'info')} renderSubtext={renderExtensionSubtext} emptyMessage="No extensions available." actionLabel="Delete" orderedListMode={true} currentOrderIds={(chatData as any)?.extensions?.map((e: any) => e.id) || []} onToggleOrder={handleToggleExtension} />}
      </div>

      {actionMenuTarget && hasSession && (
        <div className="action-menu-container" style={{ left: `${actionMenuTarget.x + 10}px`, top: `${actionMenuTarget.y}px`, zIndex: 9999 }} onClick={e => e.stopPropagation()}>
          <div className="action-menu-header"><span>Interject Action</span></div>
          <input className="action-menu-search" type="text" value={menuSearchQuery} onChange={e => setMenuSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddAction(menuSearchQuery); }} placeholder="Filter or type new & Enter..." onClick={e => e.stopPropagation()} />
          <div className="action-menu-list">
            {getFilteredActions().map(action => (
              <div key={action.label} className={`action-menu-item ${!isModelReady ? 'action-menu-item-disabled' : ''}`} role="button" tabIndex={isModelReady ? 0 : -1}
                onClick={e => { e.stopPropagation(); if (!isModelReady) return; const tc = allCharacters.find(c => c.id === actionMenuTarget.charId); if (tc) handleActionInterject(action.label, tc); }}
                onKeyDown={e => { if (!isModelReady) return; if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); const tc = allCharacters.find(c => c.id === actionMenuTarget.charId); if (tc) handleActionInterject(action.label, tc); } }}>
                <span className="action-menu-item-label">{action.label}</span>
                <div className="action-meta-container"><span className="action-count-badge" onClick={e => { e.stopPropagation(); handleDeleteAction(action.label); }} title="Click to remove action"><span className="badge-count">{action.count || 0}</span><span className="badge-delete">×</span></span></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default App;