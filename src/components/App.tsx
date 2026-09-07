// src/App.tsx
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useChatSession } from '../hooks/useChatSession';
import { useChatListManager } from '../hooks/useChatListManager';
import { useCharacterManager } from '../hooks/useCharacterManager';
import { useContextManager } from '../hooks/useContextManager';
import { useLocationManager } from '../hooks/useLocationManager';
import { useSamplerManager } from '../hooks/useSamplerManager';
import { useStopPatternManager } from '../hooks/useStopPatternManager';
import { useModelManager } from '../hooks/useModelManager';
import { useBudgetStrategyManager } from '../hooks/useBudgetStrategyManager';
import { useExtensionManager } from '../hooks/useExtensionManager';
import { useProfileManager } from '../hooks/useProfileManager';
import { useEntityModal } from '../hooks/useEntityModal';
import { useToast } from '../context/ToastContext';
import { loadInteractionMessages, loadInterjectableActions, saveInterjectableActions, saveRawInteractionData, loadRawInteractionData, getCharacterImageUrl, getLocationImageUrl, loadRawContext, loadRawLocation } from '../hooks/storage';
import { deleteMessage, massDeleteMessages, editMessage, branchMessage, cloneChatUpToMessage } from '../hooks/messageLogic';
import { createChatMessage, addMessageToInteractionData } from '../hooks/chatLogic';
import { getDelayedDisplayName } from '../hooks/immersionLogic';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { ChatStatisticsBar } from './ChatStatisticsBar';
import { ManagerModal } from './ManagerModal';
import { CharacterEditorModal } from './CharacterEditorModal';
import { ModelEditorModal } from './ModelEditorModal';
import { SamplerEditorModal } from './SamplerEditorModal';
import { ContextEditorModal } from './ContextEditorModal';
import { LocationEditorModal } from './LocationEditorModal';
import { StopPatternEditorModal } from './StopPatternEditorModal';
import { BudgetStrategyEditorModal } from './BudgetStrategyEditorModal';
import { ProfileEditorModal } from './ProfileEditorModal';
import { SettingsModal } from './SettingsModal';
import { BudgetControlModal } from './BudgetControlModal';
import { CharacterCardImportModal } from './CharacterCardImportModal';
import { AIRecommendationModal } from './AIRecommendationModal';
import { ParticipantControlModal } from './ParticipantControlModal';
import { DataExportModal } from './DataExportModal';
import { DataImportModal } from './DataImportModal';
import { LanguageModelEngine } from '../services/LanguageModelEngine';
import { speechToTextEngine } from '../services/SpeechToTextEngine';
import './main.css';
import { formatMessageText } from '../utilities/textFormatter';
import { cloudBackends } from '../languageModelInformation';
import { v4 as uuidv4 } from 'uuid';
import type {
  Character, Context, Location, Sampler, StopPattern, LanguageModel, BudgetStrategy,
  InteractionData, Extension, InterjectableAction, Profile,
  ChatMessage
} from '../types';
import { clearFetchCache } from '../services/linkFetcher';

// ─── Constants & Types ──────────────────────────────────────────────

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';
const STORAGE_KEY_ACTIVE_CHAT = 'loreReactor_activeChatId';
const STORAGE_KEY_BUDGET_STRATEGY = 'loreReactor_selectedBudgetStrategyId';
const STORAGE_KEY_DEFAULT_CHARACTER = 'loreReactor_defaultCharacterId';
const STORAGE_KEY_SELECTED_MODEL = 'loreReactor_selectedModelId';
const STORAGE_KEY_ACTION_WRAP = 'loreReactor_actionWrap';
const STORAGE_KEY_ACTION_CASE = 'loreReactor_actionCase';
const STORAGE_KEY_ACTION_PUNCTUATION = 'loreReactor_actionPunctuation';
const MIN_LOADING_SCREEN_MS = 900;

type ActionWrap = '*' | '()' | 'none';
type ActionCase = 'first' | 'pascal' | 'lower';
type ActionPunctuation = '.' | '-' | 'none';

const tokenEngine = new LanguageModelEngine();

interface NavButtonProps { icon: string; label: string; onClick: () => void }
interface LoadStep { id: string; label: string; icon: string; done: boolean }

// ─── Helpers ────────────────────────────────────────────────────────

function isChatMessage(msg: ChatMessage): msg is ChatMessage {
    return 'textContent' in msg && typeof (msg as ChatMessage).textContent === 'string';
}

/* Formats an interjected action string according to user preferences. */
function formatActionString(label: string, targetName: string, wrap: ActionWrap, casing: ActionCase, punctuation: ActionPunctuation): string {
    let raw = `${label} ${targetName}`;

    switch (casing) {
        case 'first':
            raw = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
            break;
        case 'pascal':
            raw = raw.replace(/\b\w/g, c => c.toUpperCase());
            break;
        case 'lower':
            raw = raw.toLowerCase();
            break;
    }

    switch (wrap) {
        case '*':
            raw = `*${raw}*`;
            break;
        case '()':
            raw = `(${raw})`;
            break;
        case 'none':
            break;
    }

    switch (punctuation) {
        case '.':
            raw += '.';
            break;
        case '-':
            raw += '-';
            break;
        case 'none':
            break;
    }

    return raw;
}

// ─── Sub-components ─────────────────────────────────────────────────

function NavButton({ icon, label, onClick }: NavButtonProps) {
  return (
    <button type="button" className="nav-btn nav-btn-icon-only" onClick={onClick} title={label}>
      <span>{icon}</span>
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
      <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Online: {strategy.switchProbability}% • Budget: ${strategy.maximumBudget}</span>
    </span>
  );
}

function getRenderSubTextForTriStates(value: number, text: string){

  if (value === 0) return null;

  if (value < 0) return `${text} Disabled`

  return `${text} Enabled`

}

function renderProfileSubtext(profile: Profile) {

  const enableWebSearchText = getRenderSubTextForTriStates(profile.enableWebSearch, "Web Search")
  const enableCalculatorText = getRenderSubTextForTriStates(profile.enableCalculator, "Calculator")
  const enableMemoryReadingText = getRenderSubTextForTriStates(profile.enableMemoryReading, "Memory Read")
  const enableMemoryWritingText = getRenderSubTextForTriStates(profile.enableMemoryWriting, "Memory Write")

  const flags: string[] = [];
  if (profile.forceNameReveal) flags.push('Force Names');
  if (profile.enableCharacterExpression) flags.push('Expressions');
  if (profile.useCurrentDateAndTime) flags.push('Clock');
  if (profile.useWeather) flags.push('Weather');
  if (profile.useTimeElapsed) flags.push('Time Elapsed');
  if (profile.cacheInvalidationReductionLevel >= 1) flags.push(`Cache L${profile.cacheInvalidationReductionLevel}`);
  if (enableWebSearchText) flags.push(enableWebSearchText);
  if (enableCalculatorText) flags.push(enableCalculatorText);
  if (enableMemoryReadingText) flags.push(enableMemoryReadingText);
  if (enableMemoryWritingText) flags.push(enableMemoryWritingText);
  if (profile.forceEqualInitiative || profile.chatProbability !== -1 || profile.maximumChatStamina !== -1 || profile.nameSensitivity !== -1 || profile.chatImpatienceSensitivity !== -1 || profile.skipProbability !== -1 || profile.memoryRetentionWeight !== -1 || profile.contextSensitivity !== -1) flags.push('Chat Stats Override');

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.8, flexWrap: 'wrap' }}>
      {flags.length > 0
        ? flags.map((f, i) => <span key={i} style={{ fontSize: '0.65rem', background: 'var(--accent-bg)', color: 'var(--accent)', padding: '1px 5px', borderRadius: '3px' }}>{f}</span>)
        : <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>No special settings</span>}
    </span>
  );
}

function renderChatSubtext(c: {
  parentInteractionDataId?: string;
  numberOfMessages?: number;
  interactionHistory: unknown[];
  participants?: unknown[];
  contexts?: unknown[];
}) {
  const parts: string[] = [];
  if (c.parentInteractionDataId) parts.push(`Branch of ${c.parentInteractionDataId.substring(0, 8)}...`);
  parts.push(`${c.numberOfMessages ?? c.interactionHistory.length} message${(c.numberOfMessages ?? c.interactionHistory.length) > 1 ? 's' : ''}`);
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

function renderLocationSubtext(loc: {
  regularExpressionActivationTrigger?: string;
  images?: unknown[];
  text?: string;
  characterBindings?: string[];
}) {
  const parts: string[] = [];
  if (loc.regularExpressionActivationTrigger) parts.push('⚡');
  else parts.push('📍');
  const imageCount = loc.images?.length ?? 0;
  if (imageCount > 0) parts.push(`🖼️${imageCount}`);
  const bindingCount = loc.characterBindings?.length ?? 0;
  if (bindingCount > 0) parts.push(`👤${bindingCount}`);
  parts.push(`${loc.text?.substring(0, 50) || ''}...`);
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
  const current = steps.find(s => !s.done);

  const mid = Math.ceil(steps.length / 2);
  const renderTopRow = [...steps.slice(0, mid)];
  const renderBottomRow = steps.slice(mid);

  return (
    <div className={`loading-screen ${isFadeOut ? 'fade-out' : ''}`}>
      <div className="loading-screen-title">⚛️ LoreReactor</div>

      <div className="loading-screen-row loading-screen-row-top">
        {renderTopRow.map(step => (
          <div key={step.id} title={step.label} className={`loading-step-icon ${step.done ? 'done' : ''}`}>
            {step.icon}
          </div>
        ))}
      </div>

      <div className="loading-screen-row loading-screen-row-bottom">
        {renderBottomRow.map(step => (
          <div key={step.id} title={step.label} className={`loading-step-icon ${step.done ? 'done' : ''}`}>
            {step.icon}
          </div>
        ))}
      </div>

      <div className="loading-screen-status">
        {current ? `Loading ${current.label.toLowerCase()}...` : 'Finalizing...'}
      </div>
      <div className="loading-screen-progress-track">
        <div className="loading-screen-progress-fill" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <div className="loading-screen-counter">{done}/{steps.length}</div>
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────────

function App() {
  // ✅ 1. ALL HOOKS MUST BE CALLED HERE FIRST
  
  // Session Hook
  const {
    interactionData, setInteractionData, currentCharacter, setCurrentCharacter,
    isLoading, streamingText, streamingCharacter, currentCharacterExpression, sendMessage, stopGeneration,
    resumeGeneration, regenerateFromMessage, messageEndRef, chatHistoryRef,
    generationSpeed, timeToFirstToken, numberOfMessages, numberOfTokens, maximumNumberOfTokens, startNewChat,
    numberOfCacheInvalidations, numberOfRequests, totalCost, costWithoutCacheMisses,
    sendActionAndGetResponse, setActiveBudgetStrategy, setSelectedGlobalModel, updateRunningModels,
    activeStrategy, budgetData, processProtagonistImageSilently,
  } = useChatSession();

  // Toast Hook
  const { addToast } = useToast();

  // Manager Hooks
  const { chats: allChats, isLoading: chatsLoading, deleteChat: deleteChatFromList, refresh: refreshChatList } = useChatListManager();
  const { characters: allCharacters, isLoading: charsLoading, saveCharacter, deleteCharacter, loadFullCharacter } = useCharacterManager();
  const { contexts: allContexts, isLoading: contextsLoading, saveContext, deleteContext } = useContextManager();
  const { locations: allLocations, isLoading: locationsLoading, saveLocation, deleteLocation } = useLocationManager();
  const { Samplers: allSamplers, isLoading: samplersLoading, saveSampler, deleteSampler } = useSamplerManager();
  const { stopPatterns: allStopPatterns, isLoading: stopLoading, saveStopPattern, deleteStopPattern } = useStopPatternManager();
  const { models: allModels, isLoading: modelsLoading, saveModel, deleteModel, runningModels, toggleModelLoad, selectedModelId, setSelectedModelId } = useModelManager();
  const { strategies: allBudgetStrategies, isLoading: budgetLoading, saveStrategy: saveBudgetStrategy, deleteStrategy: deleteBudgetStrategy } = useBudgetStrategyManager();
  const { extensions: allExtensions, isLoading: extLoading, deleteExtension } = useExtensionManager();
  const { profiles: allProfiles, isLoading: profilesLoading, saveProfile, deleteProfile } = useProfileManager();

  // Entity modals
  const charModal = useEntityModal<Character>(saveCharacter, deleteCharacter, 'Character');
  const contextModal = useEntityModal<Context>(saveContext, deleteContext, 'Context');
  const locationModal = useEntityModal<Location>(saveLocation, deleteLocation, 'Location');
  const stopModal = useEntityModal<StopPattern>(saveStopPattern, deleteStopPattern, 'Stop Pattern');
  const modelModal = useEntityModal<LanguageModel>(saveModel, deleteModel, 'Model');
  const budgetModal = useEntityModal<BudgetStrategy>(saveBudgetStrategy, deleteBudgetStrategy, 'Budget Strategy');
  const profileModal = useEntityModal<Profile>(saveProfile, deleteProfile, 'Profile');

  // UI state hooks
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
  const [actionsLoading, setActionsLoading] = useState(true);
  const [centerAvatar, setCenterAvatar] = useState<Character | null>(null);
  const [branchSourceTitle, setBranchSourceTitle] = useState<string | null>(null);
  const [defaultCharacterId, setDefaultCharacterId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY_DEFAULT_CHARACTER)
  );
  const [selectedBudgetStrategyId, setSelectedBudgetStrategyId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY_BUDGET_STRATEGY)
  );
  
  const [maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens, setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens] = useState<number>(0);

  // Action formatting state — persisted to localStorage
  const [actionWrap, setActionWrap] = useState<ActionWrap>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ACTION_WRAP);
    return (saved === '*' || saved === '()' || saved === 'none') ? saved : '*';
  });
  const [actionCase, setActionCase] = useState<ActionCase>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ACTION_CASE);
    return (saved === 'first' || saved === 'pascal' || saved === 'lower') ? saved : 'first';
  });
  const [actionPunctuation, setActionPunctuation] = useState<ActionPunctuation>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ACTION_PUNCTUATION);
    return (saved === '.' || saved === '-' || saved === 'none') ? saved : '.';
  });
  const [showActionFormat, setShowActionFormat] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // Persist action formatting to localStorage on change
  useEffect(() => { localStorage.setItem(STORAGE_KEY_ACTION_WRAP, actionWrap); }, [actionWrap]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_ACTION_CASE, actionCase); }, [actionCase]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_ACTION_PUNCTUATION, actionPunctuation); }, [actionPunctuation]);

  // Panel visibility hooks
  const [isChatListOpen, setIsChatListOpen] = useState(false);
  const [isCharListOpen, setIsCharListOpen] = useState(false);
  const [isContextListOpen, setIsContextListOpen] = useState(false);
  const [isLocationListOpen, setIsLocationListOpen] = useState(false);
  const [isSamplerListOpen, setIsSamplerListOpen] = useState(false);
  const [isExtListOpen, setIsExtListOpen] = useState(false);
  const [isModelListOpen, setIsModelListOpen] = useState(false);
  const [isStopListOpen, setIsStopListOpen] = useState(false);
  const [isBudgetStrategyListOpen, setIsBudgetStrategyListOpen] = useState(false);
  const [isProfileListOpen, setIsProfileListOpen] = useState(false);
  const [isSamplerEditorOpen, setIsSamplerEditorOpen] = useState(false);
  const [samplerToEdit, setSamplerToEdit] = useState<Sampler | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBudgetControlOpen, setIsBudgetControlOpen] = useState(false);
  const [isAIRecommendationOpen, setIsAIRecommendationOpen] = useState(false);
  const [isCardImportOpen, setIsCardImportOpen] = useState(false);
  const [isExportDataOpen, setIsExportDataOpen] = useState(false);
  const [isImportDataOpen, setIsImportDataOpen] = useState(false);
  const [isParticipantControlOpen, setIsParticipantControlOpen] = useState(false);

  // ✅ Active chat restoration guard
  const [activeChatRestored, setActiveChatRestored] = useState(false);
  const restorationDoneRef = useRef(false);
  const initialSyncSkippedRef = useRef(false);
  const chatModifiedRef = useRef(false);
  const loadingStartedAtRef = useRef<number | null>(null);

  // ✅ NEW: Pending regeneration ref for Option A fix
  const pendingRegenRef = useRef<{ id: string; type: 'user' | 'ai' } | null>(null);

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
  const interactionDataRef = useRef<InteractionData | null>(null);

  useEffect(() => {
    interactionDataRef.current = interactionData;
  }, [interactionData]);

  // ✅ Load interjectable actions as part of loading screen
  useEffect(() => {
    loadInterjectableActions()
      .then(setActions)
      .finally(() => setActionsLoading(false));
  }, []);

  // ✅ Save actions when they change
  useEffect(() => { 
    if (actions.length > 0) saveInterjectableActions(actions); 
  }, [actions]);

  // ✅ Loading state hooks
  const loadSteps = useMemo<LoadStep[]>(() => [
    { id: 'characters', label: 'Characters', icon: '🎭', done: !charsLoading },
    { id: 'actions', label: 'Actions', icon: '⚡', done: !actionsLoading },
    { id: 'models', label: 'Models', icon: '🤖', done: !modelsLoading },
    { id: 'contexts', label: 'Contexts', icon: '🌍', done: !contextsLoading },
    { id: 'locations', label: 'Locations', icon: '📍', done: !locationsLoading },
    { id: 'samplers', label: 'Samplers', icon: '🎚️', done: !samplersLoading },
    { id: 'stopPatterns', label: 'Stop Patterns', icon: '🛑', done: !stopLoading },
    { id: 'budget', label: 'Budget', icon: '💰', done: !budgetLoading },
    { id: 'profiles', label: 'Profiles', icon: '👤', done: !profilesLoading },
    { id: 'chats', label: 'Chat Sessions', icon: '💬', done: !chatsLoading },
  ], [charsLoading, actionsLoading, modelsLoading, contextsLoading, locationsLoading, samplersLoading, stopLoading, budgetLoading, profilesLoading, chatsLoading]);
  
  const [isInitializing, setIsInitializing] = useState(true);
  const [isFadeOut, setIsFadeOut] = useState(false);

  // ✅ 2. LOGIC & DERIVED VALUES
  
  const isModelReady = useMemo(() => {
    if (activeStrategy) return true;
    if (!selectedModelId) return false;
    const selectedModel = allModels.find(m => m.id === selectedModelId);
    if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend)) {
      return true;
    }
    return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle === true;
  }, [selectedModelId, allModels, runningModels, activeStrategy]);

  const isModelLoading = useMemo(() => {
    if (!selectedModelId) return false;
    const selectedModel = allModels.find(m => m.id === selectedModelId);
    if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend)) {
      return false;
    }
    return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle !== true;
  }, [selectedModelId, allModels, runningModels]);

  const modelStatusMessage = !selectedModelId ? 'No model selected — open Models to load one' : isModelLoading ? 'Model is warming up... please wait' : '';
  const isMassActive = massDeleteId !== null;

  const InteractionMessages = useMemo(() => {
    if (!interactionData) return [];
    return interactionData.interactionHistory.filter(isChatMessage);
  }, [interactionData]);

  const massStartIndex = isMassActive && interactionData ? InteractionMessages.findIndex(m => m.id === massDeleteId) : -1;
  const branchOffIndex = interactionData?.parentInteractionMessageId ? InteractionMessages.findIndex(m => m.id === interactionData.parentInteractionMessageId) : -1;

  const formattedStreamingText = useMemo(() => formatMessageText(streamingText), [streamingText]);

  const portraitUrlCache = useMemo(() => {
    const cache = new Map<string, string | null>();

    const resolvePortrait = (characterId: string, images: Record<string, string> | undefined, expression?: string): string | null => {
      const expr = expression || 'neutral';
      const filename = images?.[expr] || images?.['neutral'];
      if (!filename) return null;
      return getCharacterImageUrl(characterId, filename);
    };

    for (const msg of InteractionMessages) {
      if (!cache.has(msg.id)) {
        cache.set(msg.id, resolvePortrait(msg.character.id, msg.character.images, msg.characterExpression));
      }
    }

    if (centerAvatar) {
      const key = `cinematic:${centerAvatar.id}`;
      if (!cache.has(key)) {
        cache.set(key, resolvePortrait(centerAvatar.id, centerAvatar.images, 'neutral'));
      }
    }

    return cache;
  }, [InteractionMessages, centerAvatar?.id]);

  const streamingPortraitUrl = useMemo(() => {
    if (!streamingCharacter) return null;
    const expr = currentCharacterExpression || 'neutral';
    const filename = streamingCharacter.images?.[expr] || streamingCharacter.images?.['neutral'];
    if (!filename) return null;
    return getCharacterImageUrl(streamingCharacter.id, filename);
  }, [streamingCharacter?.id, streamingCharacter?.images, currentCharacterExpression]);

  const locations = interactionData?.locations;
  const locationBackgroundUrl = (() => {
    if (!locations?.length) return null;

    for (let i = InteractionMessages.length - 1; i >= 0; i--) {
      const msg = InteractionMessages[i];
      if (msg.locationIndex !== undefined && msg.locationIndex >= 0) {
        const loc = locations[msg.locationIndex];
        if (loc?.images?.length && loc.images[0]) {
          return getLocationImageUrl(loc.images[0]);
        }
        return null;
      }
    }

    return null;
  })();

  const maximumNumberOfContextTokens = useMemo(() => {
    if (!interactionData?.contexts?.length) return 0;
    let total = 0;
    for (const ctx of interactionData.contexts) {
      if (ctx.text) total += Math.ceil(ctx.text.length / 4);
    }
    return total;
  }, [interactionData]);

  // ✅ 3. EFFECTS

  useEffect(() => {
    const enabled = interactionData?.Profile?.enableCharacterExpression ?? false;
    if (enabled) {
      sentimentEngine.initialize();
    } else {
      sentimentEngine.unload();
    }
  }, [interactionData?.Profile?.id, interactionData?.Profile?.enableCharacterExpression]);

  useEffect(() => {
    void selectedModelId;
    void runningModels;
    tokenEngine.clearTokenCache();
  }, [selectedModelId, runningModels]);

  // ✅ Active chat restoration
  useEffect(() => {
    if (restorationDoneRef.current) return;
    if (charsLoading || chatsLoading || contextsLoading || locationsLoading || profilesLoading) return;

    restorationDoneRef.current = true;

    const savedChatId = localStorage.getItem(STORAGE_KEY_ACTIVE_CHAT);
    const savedModelId = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL);

    if (savedModelId) {
      setTimeout(() => setSelectedModelId(savedModelId), 0);
    }

    const activateChat = async (chat: InteractionData) => {
      let fullChat = chat;

      if (!chat.interactionHistory.length && (chat.numberOfMessages ?? 0) > 0) {
        try {
          fullChat = await loadInteractionMessages(chat);
        } catch (e) {
          console.warn('Failed to load chat messages for fallback:', e);
        }
      }

      if (fullChat.protagonist) {
        let protagonist = fullChat.protagonist;

        const freshProtag = allCharacters.find(c => c.id === protagonist.id);
        if (freshProtag) {
          const fullChar = await loadFullCharacter(freshProtag.id);
          if (fullChar) protagonist = fullChar;
        } else {
          console.warn(`Protagonist ${protagonist.id} not found in character list after load.`);
        }

        const hydratedParticipants = await Promise.all(
          fullChat.participants.map(async (p) => {
            const exists = allCharacters.some(c => c.id === p.id);
            if (!exists) {
              console.warn(`Participant ${p.id} not found in character list after load. Keeping shell.`);
              return p;
            }
            if (p.systemPrompt) return p;
            const fullChar = await loadFullCharacter(p.id);
            return fullChar || p;
          })
        );

        setInteractionData({
          ...fullChat,
          protagonist,
          participants: hydratedParticipants,
        });

        setCurrentCharacter(protagonist);
      } else {
        setInteractionData(fullChat);
      }
    };

    const restore = async () => {
      try {
        if (!savedChatId) {
          if (allChats.length > 0) {
            await activateChat(allChats[0]);
          } else if (allCharacters.length > 0) {
            startNewChat(allCharacters[0]);
          } else {
            setCurrentCharacter(null);
            setInteractionData({
              id: uuidv4(), name: 'Untitled Chat', protagonist: null as unknown as Character,
              participants: [], contexts: [], locations: [], interactionHistory: [],
              numberOfMessages: 0, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
              parentInteractionDataId: null, parentInteractionMessageId: null,
            });
          }
          return;
        }

        const interactionDataResult = await loadRawInteractionData(savedChatId, allCharacters);

        if (interactionDataResult) {
          let fullChat = interactionDataResult;
          if (fullChat.numberOfMessages && fullChat.numberOfMessages > 0 && fullChat.interactionHistory.length === 0) {
            try { fullChat = await loadInteractionMessages(interactionDataResult); } catch (e) { console.warn('Failed to load chat messages, using shell:', e); }
          }
          await activateChat(fullChat as InteractionData);
        } else {
          console.warn('Active chat not found, falling back.');
          localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
          if (allChats.length > 0) { await activateChat(allChats[0]); }
          else if (allCharacters.length > 0) { startNewChat(allCharacters[0]); }
          else {
            setCurrentCharacter(null);
            setInteractionData({
              id: uuidv4(), name: 'Untitled Chat', protagonist: null as unknown as Character,
              participants: [], contexts: [], locations: [], interactionHistory: [],
              numberOfMessages: 0, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
              parentInteractionDataId: null, parentInteractionMessageId: null,
            });
          }
        }
      } catch (e) {
        console.error('Failed to restore active chat:', e);
        localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
        if (allChats.length > 0) { await activateChat(allChats[0]); }
        else if (allCharacters.length > 0) { startNewChat(allCharacters[0]); }
        else {
          setCurrentCharacter(null);
          setInteractionData({
            id: uuidv4(), name: 'Untitled Chat', protagonist: null as unknown as Character,
            participants: [], contexts: [], locations: [], interactionHistory: [],
            numberOfMessages: 0, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
            parentInteractionDataId: null, parentInteractionMessageId: null,
          });
        }
      } finally {
        setActiveChatRestored(true);
      }
    };

    restore();
  }, [charsLoading, chatsLoading, contextsLoading, locationsLoading, profilesLoading, allCharacters, allChats, loadFullCharacter, setInteractionData, setCurrentCharacter, setSelectedModelId, startNewChat]);

  useEffect(() => {
    if (interactionData?.id) localStorage.setItem(STORAGE_KEY_ACTIVE_CHAT, interactionData.id);
    else localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
  }, [interactionData?.id]);

  useEffect(() => {
    if (selectedBudgetStrategyId) localStorage.setItem(STORAGE_KEY_BUDGET_STRATEGY, selectedBudgetStrategyId);
    else localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY);
  }, [selectedBudgetStrategyId]);

  useEffect(() => {
    if (!selectedBudgetStrategyId || allBudgetStrategies.length === 0) return;
    const strategy = allBudgetStrategies.find(s => s.id === selectedBudgetStrategyId);
    if (strategy) setActiveBudgetStrategy(strategy);
    else localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY);
  }, [selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy]);

  useEffect(() => {
    if (defaultCharacterId) localStorage.setItem(STORAGE_KEY_DEFAULT_CHARACTER, defaultCharacterId);
    else localStorage.removeItem(STORAGE_KEY_DEFAULT_CHARACTER);
  }, [defaultCharacterId]);

  useEffect(() => {
    if (selectedModelId) localStorage.setItem(STORAGE_KEY_SELECTED_MODEL, selectedModelId);
    else localStorage.removeItem(STORAGE_KEY_SELECTED_MODEL);
  }, [selectedModelId]);

  useEffect(() => {
    if (!selectedModelId || allModels.length === 0) return;
    const selectedModel = allModels.find(m => m.id === selectedModelId);
    if (!selectedModel) { setSelectedModelId(null); return; }
    const isCloudModel = !!selectedModel.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend);
    if (isCloudModel) return;
    const isRunning = runningModels[selectedModelId]?.isRunning;
    if (!isRunning) setSelectedModelId(null);
  }, [selectedModelId, allModels, runningModels]);

  useEffect(() => {
    const parentInteractionDataId = interactionData?.parentInteractionDataId;
    if (!parentInteractionDataId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await loadRawInteractionData(parentInteractionDataId, allCharacters);
        if (!cancelled) setBranchSourceTitle(s ? (s.name || 'Untitled Chat') : null);
      } catch { if (!cancelled) setBranchSourceTitle(null); }
    })();
    return () => { cancelled = true; };
  }, [interactionData?.parentInteractionDataId, allCharacters]);

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

  // ✅ Sync effect
  useEffect(() => {
    if (!activeChatRestored) return;
    if (!initialSyncSkippedRef.current) { initialSyncSkippedRef.current = true; return; }

    const currentChat = interactionDataRef.current;
    if (!currentChat) return;

    let changed = false;
    const updated = { ...currentChat };

    const freshProtag = allCharacters.find(c => c.id === currentChat.protagonist?.id);
    if (!freshProtag && currentChat.protagonist) {
      const fallback = allCharacters[0];
      if (fallback) { updated.protagonist = fallback; changed = true; }
    } else if (freshProtag && freshProtag.lastUpdatedTimestamp !== currentChat.protagonist?.lastUpdatedTimestamp) {
      updated.protagonist = freshProtag; changed = true;
    }

    const validParticipants = currentChat.participants.filter(p => allCharacters.some(c => c.id === p.id));
    const freshParticipants = validParticipants.map(p => {
      const fresh = allCharacters.find(c => c.id === p.id);
      return (fresh && fresh.lastUpdatedTimestamp !== p.lastUpdatedTimestamp) ? fresh : p;
    });
    if (freshParticipants.length !== currentChat.participants.length || freshParticipants.some((p, i) => p !== currentChat.participants[i])) {
      updated.participants = freshParticipants; changed = true;
    }

    if (currentChat.contexts?.length) {
      const validContexts = currentChat.contexts.filter(ctx => allContexts.some(c => c.id === ctx.id));
      const freshContexts = validContexts.map(ctx => {
        const fresh = allContexts.find(c => c.id === ctx.id);
        return (fresh && fresh.lastUpdatedTimestamp !== ctx.lastUpdatedTimestamp) ? fresh : ctx;
      });
      if (freshContexts.length !== currentChat.contexts.length || freshContexts.some((c, i) => c !== currentChat.contexts?.[i])) {
        updated.contexts = freshContexts; changed = true;
      }
    }

    if (currentChat.Profile) {
      const freshProfile = allProfiles.find(p => p.id === currentChat.Profile?.id);
      if (!freshProfile) { updated.Profile = undefined; changed = true; }
      else if (freshProfile.lastUpdatedTimestamp !== currentChat.Profile.lastUpdatedTimestamp) { updated.Profile = freshProfile; changed = true; }
    }

    if (currentCharacter) {
      const freshCurrent = allCharacters.find(c => c.id === currentCharacter.id);
      if (!freshCurrent) setCurrentCharacter(updated.protagonist);
      else if (freshCurrent.lastUpdatedTimestamp !== currentCharacter.lastUpdatedTimestamp) setCurrentCharacter(freshCurrent);
    }

    if (changed) setInteractionData(updated);
  }, [activeChatRestored, allCharacters, allContexts, allProfiles, currentCharacter, setInteractionData, setCurrentCharacter]);

  // ✅ Budget strategy sync — multi-model pool aware
  useEffect(() => {
    if (!activeStrategy) return;
    let stratChanged = false;
    const updatedStrat = { ...activeStrategy };

    const freshOnlineModels = activeStrategy.onlineModels.map(m => {
      const fresh = allModels.find(x => x.id === m.id);
      return (fresh && fresh.lastUpdatedTimestamp !== m.lastUpdatedTimestamp) ? fresh : m;
    });
    if (freshOnlineModels.some((m, i) => m !== activeStrategy.onlineModels[i])) {
      updatedStrat.onlineModels = freshOnlineModels;
      stratChanged = true;
    }

    const freshLocalModels = activeStrategy.localModels.map(m => {
      const fresh = allModels.find(x => x.id === m.id);
      return (fresh && fresh.lastUpdatedTimestamp !== m.lastUpdatedTimestamp) ? fresh : m;
    });
    if (freshLocalModels.some((m, i) => m !== activeStrategy.localModels[i])) {
      updatedStrat.localModels = freshLocalModels;
      stratChanged = true;
    }

    if (stratChanged) setActiveBudgetStrategy(updatedStrat);
  }, [activeStrategy, allModels, setActiveBudgetStrategy]);

  // ✅ FIXED: Initialization completion check
  useEffect(() => {
    if (!isInitializing) return;
    const allDone = loadSteps.every(s => s.done);
    // Restoration guarantees interactionData is set to a valid state
    // (either a loaded chat, a new empty chat, or a fallback placeholder).
    // We only need to confirm it exists, not validate its content.
    const hasData = !!interactionData;

    if (!allDone || !activeChatRestored || !hasData) return;
    
    const loadingStartedAt = loadingStartedAtRef.current ?? Date.now();
    loadingStartedAtRef.current = loadingStartedAt;
    const elapsed = Date.now() - loadingStartedAt;
    const remaining = Math.max(0, MIN_LOADING_SCREEN_MS - elapsed);
    const hold = setTimeout(() => {
      setIsFadeOut(true);
      const fade = setTimeout(() => { setIsInitializing(false); setIsFadeOut(false); }, 300);
      return () => clearTimeout(fade);
    }, remaining);
    return () => clearTimeout(hold);
  }, [loadSteps, isInitializing, activeChatRestored, interactionData, allChats.length]);

  useEffect(() => { chatModifiedRef.current = false; }, []);

  useEffect(() => {
    if (!interactionData || !interactionData.id) return;
    if (chatModifiedRef.current) return;
    const protagId = interactionData.protagonist?.id;
    const nonProtagParticipants = interactionData.participants.filter(p => p.id !== protagId);
    if (nonProtagParticipants.length > 0 || InteractionMessages.length > 0 || (interactionData.contexts?.length ?? 0) > 0 || (interactionData.locations?.length ?? 0) > 0 || !!interactionData.Profile) {
      chatModifiedRef.current = true;
    }
  }, [interactionData, InteractionMessages]);

  useEffect(() => {
    if (!interactionData || !interactionData.id || !chatModifiedRef.current) return;
    const existsOnDisk = allChats.some(c => c.id === interactionData.id);
    if (!existsOnDisk) { saveRawInteractionData(interactionData).catch(e => console.error('Failed to save new chat:', e)); refreshChatList(); }
  }, [interactionData, allChats, refreshChatList]);

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
    if (viewMode !== 'cinematic' || !chatHistoryElement || !interactionData || InteractionMessages.length === 0) {
      const resetAvatar = window.setTimeout(() => setCenterAvatar(null), 0);
      return () => window.clearTimeout(resetAvatar);
    }
    const opts = { root: chatHistoryElement, threshold: [0.5, 0.8, 1.0], rootMargin: '-10% 0px -60% 0px' };
    const obs = new IntersectionObserver(entries => {
      const best = entries.reduce((p, c) => p.intersectionRatio > c.intersectionRatio ? p : c);
      if (best.intersectionRatio <= 0.5) return;
      const mid = best.target.getAttribute('data-message-id'); if (!mid) return;
      const msg = InteractionMessages.find(m => m.id === mid);
      if (!msg?.character || msg.character.id === AMBIENT_NARRATOR_ID) return;
      let avatar: Character | null = msg.character;
      if (msg.character.id === currentCharacter?.id) {
        const ci = InteractionMessages.indexOf(msg);
        const prev = ci > 0 ? InteractionMessages[ci - 1] : null;
        avatar = prev?.character && prev.character.id !== currentCharacter?.id && prev.character.id !== AMBIENT_NARRATOR_ID ? prev.character : null;
      }
      setCenterAvatar(avatar);
      for (const el of document.querySelectorAll('.message-row')) el.classList.remove('is-active');
      (best.target as HTMLElement).classList.add('is-active');
      lastViewedMessageIdRef.current = mid;
    }, opts);
    for (const el of chatHistoryElement.querySelectorAll('[data-message-id]')) obs.observe(el);
    let fallbackTimer: number | undefined;
    if (!centerAvatar) {
      fallbackTimer = window.setTimeout(() => {
        for (let i = InteractionMessages.length - 1; i >= 0; i--) {
          const m = InteractionMessages[i];
          if (m.character && m.character.id !== currentCharacter?.id && m.character.id !== AMBIENT_NARRATOR_ID) { setCenterAvatar(m.character); break; }
        }
      }, 0);
    }
    return () => { obs.disconnect(); if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer); };
  }, [viewMode, currentCharacter?.id, centerAvatar, interactionData, InteractionMessages, chatHistoryRef]);

  useEffect(() => {
    const chatHistoryElement = chatHistoryRef.current;
    if (viewMode !== 'cinematic' || !chatHistoryElement || suppressAutoScrollRef.current) return;
    chatHistoryElement.scrollTop = 0;
  }, [viewMode, chatHistoryRef]);

  useEffect(() => {
    if (InteractionMessages.length === 0 || !interactionData?.participants) return;
    let isCancelled = false;
    const calculateMaxTokens = async () => {
      const participantCounts: Record<string, number> = {};
      for (const p of interactionData.participants) participantCounts[p.id] = 0;
      if (interactionData.protagonist && participantCounts[interactionData.protagonist.id] === undefined) participantCounts[interactionData.protagonist.id] = 0;
      const selectedModel = allModels.find(m => m.id === selectedModelId);
      const runtimePort = selectedModelId ? runningModels[selectedModelId]?.port : undefined;
      const modelContext = selectedModel ? { apiKey: selectedModel.apiKey, backend: selectedModel.backend, modelPath: typeof selectedModel.parameters?.modelPath === 'string' ? selectedModel.parameters.modelPath : undefined, runtimePort } : undefined;
      for (const msg of InteractionMessages) {
        if (msg.character && msg.textContent) {
          const charId = msg.character.id;
          if (participantCounts[charId] !== undefined || charId === AMBIENT_NARRATOR_ID) {
            const tokens = await tokenEngine.countTokens(msg.textContent, modelContext);
            if (participantCounts[charId] !== undefined) participantCounts[charId] += tokens;
          }
        }
      }
      if (isCancelled) return;
      setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens(Math.max(...Object.values(participantCounts), 0));
    };
    calculateMaxTokens();
    return () => { isCancelled = true; };
  }, [InteractionMessages, interactionData?.participants, interactionData?.protagonist, selectedModelId, allModels, runningModels]);

  // ✅ NEW: Effect to trigger regeneration AFTER edit state has committed
  useEffect(() => {
    if (pendingRegenRef.current && interactionData) {
      const { id, type } = pendingRegenRef.current;
      pendingRegenRef.current = null; // Clear immediately to prevent loops
      
      // Verify the message actually exists in current state before regenerating
      const msg = interactionData.interactionHistory.find(m => m.id === id);
      if (msg) {
        regenerateFromMessage(id, type);
      }
    }
  }, [interactionData, regenerateFromMessage]);

  // ✅ 4. CALLBACKS

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

  const safeAutoSave = useCallback(async (data: InteractionData | null) => {
    if (!data) return;
    const msgs = data.interactionHistory.filter(isChatMessage);
    if (msgs.length === 0 && (data.numberOfMessages ?? 0) > 0) return;
    try { await saveRawInteractionData(data); } catch (e) { console.error('Auto-save failed:', e); }
  }, []);

  const handleSwitchChat = useCallback(async (id: string) => {
      tokenEngine.clearTokenCache();
      await safeAutoSave(interactionData); clearFetchCache();

      let chat: InteractionData | null = null;
      try {
          chat = await loadRawInteractionData(id, allCharacters);
      } catch (e) {
          console.warn('Failed to load chat:', e);
      }

      if (!chat) {
          // Fallback to shell if full load fails
          const sel = allChats.find(c => c.id === id);
          if (!sel) return;
          chat = sel;
          if (!sel.interactionHistory.length) {
              try { chat = await loadInteractionMessages(sel); } catch { addToast('Failed to load chat messages.', 'error'); }
          }
      }

      setInteractionData(chat);
      if (chat.protagonist) setCurrentCharacter(chat.protagonist);
      refreshChatList(); setIsChatListOpen(false); lastViewedMessageIdRef.current = null;
  }, [allChats, allCharacters, interactionData, setInteractionData, setCurrentCharacter, refreshChatList, addToast, safeAutoSave]);

  const handleNewChat = useCallback(async () => {
    await safeAutoSave(interactionData); clearFetchCache();
    localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
    setIsChatListOpen(false);
    let c = currentCharacter;
    if (!c && defaultCharacterId) c = allCharacters.find(x => x.id === defaultCharacterId) || null;
    if (!c && allChats.length) c = allChats[0].protagonist;
    if (c) startNewChat(c);
  }, [interactionData, currentCharacter, defaultCharacterId, allCharacters, allChats, startNewChat, safeAutoSave]);

  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); await safeAutoSave(interactionData);
    if (await deleteChatFromList(id)) { addToast('Chat session deleted.', 'info'); if (interactionData?.id === id && currentCharacter) startNewChat(currentCharacter); }
    else addToast('Failed to delete chat.', 'error');
  };

  const handleToggleParticipant = async (charId: string) => {
    if (!interactionData) return;
    if (charId === interactionData.protagonist?.id) { addToast('Cannot remove the protagonist.', 'error'); return; }
    const ids = interactionData.participants.map(p => p.id);
    let np: Character[];
    if (ids.includes(charId)) np = interactionData.participants.filter(p => p.id !== charId);
    else {
      const sh = allCharacters.find(c => c.id === charId); if (!sh) return;
      const ch = sh.sampler ? sh : await loadFullCharacter(charId); if (!ch) return;
      np = [...interactionData.participants, ch];
    }
    if (!np.find(p => p.id === interactionData.protagonist?.id)) np.unshift(interactionData.protagonist);
    const uc = { ...interactionData, participants: np };
    setInteractionData(uc);
    if (!np.find(p => p.id === currentCharacter?.id)) setCurrentCharacter(uc.protagonist);
    addToast('Participants updated.', 'info');
  };

  const handleToggleContext = async (contextId: string) => {
    if (!interactionData?.contexts) return;
    const ids = interactionData.contexts.map(c => c.id);
    const nc = ids.includes(contextId) ? interactionData.contexts.filter(c => c.id !== contextId) : [...interactionData.contexts, await loadRawContext(contextId)].filter(Boolean) as Context[];
    setInteractionData({ ...interactionData, contexts: nc }); addToast('Contexts updated.', 'info');
  };

  const handleToggleLocation = async (locationId: string) => {
    if (!interactionData) return;
    const currentLocations = interactionData.locations || [];
    const ids = currentLocations.map(l => l.id);
    const nl = ids.includes(locationId) ? currentLocations.filter(l => l.id !== locationId) : [...currentLocations, await loadRawLocation(locationId)].filter(Boolean) as Location[];
    setInteractionData({ ...interactionData, locations: nl }); addToast('Locations updated.', 'info');
  };

  const handleSetChatProtagonist = async (charId: string) => {
    if (!interactionData) return;
    const sh = allCharacters.find(c => c.id === charId); if (!sh) return;
    const ch = sh.sampler ? sh : await loadFullCharacter(charId); if (!ch) return;
    const uc = { ...interactionData, protagonist: ch };
    if (!uc.participants.find(p => p.id === charId)) uc.participants = [ch, ...uc.participants];
    setInteractionData(uc); setCurrentCharacter(ch); setDefaultCharacterId(charId);
    addToast('Protagonist switched.', 'info');
  };

  const handleToggleExtension = async (extId: string) => {
    if (!interactionData) return;
    const extensionValue = Object.getOwnPropertyDescriptor(interactionData, 'extensions')?.value;
    const currentExtensions = Array.isArray(extensionValue) ? extensionValue.filter((extension): extension is Extension => typeof extension === 'object' && extension !== null && 'id' in extension && typeof extension.id === 'string') : [];
    const currentExtensionIds = currentExtensions.map(extension => extension.id);
    const nextExtensionIds = currentExtensionIds.includes(extId) ? currentExtensionIds.filter(id => id !== extId) : [...currentExtensionIds, extId];
    setInteractionData({ ...interactionData, extensions: allExtensions.filter(extension => nextExtensionIds.includes(extension.id)) });
    addToast('Extensions updated.', 'info');
  };

  const handleActivateBudgetStrategy = (sid: string) => {
    if (selectedBudgetStrategyId === sid) { setSelectedBudgetStrategyId(null); addToast('Budget strategy deactivated.', 'info'); }
    else { setSelectedBudgetStrategyId(sid); addToast(`Budget strategy "${allBudgetStrategies.find(s => s.id === sid)?.name}" activated!`, 'success'); }
  };

  const handleActivateProfile = async (pid: string) => {
    if (!interactionData) return;
    if (interactionData.Profile?.id === pid) {
      const uc = { ...interactionData, Profile: undefined }; setInteractionData(uc); await saveRawInteractionData(uc); addToast('Profile deactivated.', 'info');
    } else {
      const p = allProfiles.find(x => x.id === pid); if (!p) return;
      const uc = { ...interactionData, Profile: p }; setInteractionData(uc); await saveRawInteractionData(uc); addToast(`Profile "${p.name}" activated!`, 'success');
    }
  };

  const handleStartEditTitle = (e: React.MouseEvent) => { e.stopPropagation(); setEditTitleValue(interactionData?.name || ''); setIsEditingTitle(true); };
  const handleSaveTitle = () => {
    if (!interactionData) return;
    const t = editTitleValue.trim() || 'Untitled Chat';
    chatModifiedRef.current = true;
    setInteractionData({ ...interactionData, name: t } as InteractionData);
    saveRawInteractionData({ ...interactionData, name: t });
    refreshChatList(); setIsEditingTitle(false); addToast('Chat title updated', 'success');
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    const newFiles = fileList ? Array.from(fileList) : [];
    if (newFiles.length > 0) { setPendingFiles(prev => [...prev, ...newFiles]); addToast(`${newFiles.length} file${newFiles.length !== 1 ? 's' : ''} attached.`); }
    requestAnimationFrame(() => { if (fileInputRef.current) fileInputRef.current.value = ''; });
  };

  const handleToggleMicrophone = useCallback(async () => {
    if (isRecording) {
        await speechToTextEngine.stopRecording();
        setIsRecording(false);
    } else {
        const started = await speechToTextEngine.startRecording((text) => {
            setInputText(prev => prev + (prev ? ' ' : '') + text);
        });
        if (!started) {
            addToast('Failed to start voice input. Check microphone permissions.', 'error');
            return;
        }
        setIsRecording(true);
    }
}, [isRecording, addToast]);

  const handleSaveEdit = async () => {
    if (!interactionData || !editingId) return;
    try { setInteractionData(await editMessage(interactionData, editingId, editDraft)); setEditingId(null); setEditDraft(''); addToast('Message edited.', 'success'); }
    catch (e) { addToast((e as Error).message, 'error'); }
  };

  // ✅ FIXED: Regenerate from edit now uses pendingRegenRef to avoid race condition
  const handleRegenerateFromEdit = async () => {
    if (!interactionData || !editingId) return;
    try {
      const updatedData = await editMessage(interactionData, editingId, editDraft);
      
      // Determine regeneration type BEFORE clearing editingId
      const editedMsg = updatedData.interactionHistory.find(m => m.id === editingId);
      const isUserMsg = editedMsg && 'character' in editedMsg && editedMsg.character?.id === currentCharacter?.id;
      
      // Set the flag so the useEffect triggers regeneration after state commit
      pendingRegenRef.current = { id: editingId, type: isUserMsg ? 'user' : 'ai' };
      
      setInteractionData(updatedData);
      setEditingId(null);
      setEditDraft('');
    } catch (e) {
      addToast((e as Error).message, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!interactionData) return;
    try { setInteractionData(await deleteMessage(interactionData, id)); addToast('Message deleted.', 'info'); }
    catch (e) { addToast((e as Error).message, 'error'); }
  };

  const handleMassDeleteConfirm = async () => {
    if (!interactionData || !massDeleteId) return;
    const idx = InteractionMessages.findIndex(m => m.id === massDeleteId);
    if (idx === -1) return;
    try { setInteractionData(await massDeleteMessages(interactionData, idx)); setMassDeleteId(null); addToast('Messages deleted.', 'info'); }
    catch (e) { addToast((e as Error).message, 'error'); }
  };

  const handleBranch = async (id: string) => {
    if (!interactionData) return;
    try { const b = await branchMessage(interactionData, id); setInteractionData(b); if (b.protagonist) setCurrentCharacter(b.protagonist); refreshChatList(); addToast(`Branched to "${b.name}"`, 'success'); }
    catch { addToast('Failed to branch chat.', 'error'); }
  };

  const handleClone = async (id: string) => {
    if (!interactionData) return;
    try { const c = await cloneChatUpToMessage(interactionData, id); setInteractionData(c); if (c.protagonist) setCurrentCharacter(c.protagonist); refreshChatList(); addToast(`Cloned to "${c.name}"`, 'success'); }
    catch { addToast('Failed to clone chat.', 'error'); }
  };

  const handleNavigateToSource = async () => {
    if (!interactionData?.parentInteractionDataId) return;
    try {
      const s = await loadRawInteractionData(interactionData.parentInteractionDataId, allCharacters);
      if (s) { const f = s as unknown as InteractionData; setInteractionData(f); if (f.protagonist) setCurrentCharacter(f.protagonist); refreshChatList(); addToast(`Navigated back to "${f.name || 'Untitled Chat'}"`, 'info'); }
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
    setActionMenuTarget(null); setMenuSearchQuery(''); setShowActionFormat(false);
    if (!interactionData || !currentCharacter) return;
    await incrementActionCount(label);
    if (isLoading) { stopGeneration(); await new Promise(r => setTimeout(r, 200)); }
    const formattedAction = formatActionString(label, targetChar.name, actionWrap, actionCase, actionPunctuation);
    try { await sendActionAndGetResponse(formattedAction, targetChar); }
    catch { addToast('Failed to interject action.', 'error'); }
  };

  const getFilteredActions = () => actions
    .filter(a => a.label.toLowerCase().includes(menuSearchQuery.toLowerCase()))
    .sort((a, b) => b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label));

  const isStemMessage = (mid: string): boolean => {
    if (!interactionData?.parentInteractionMessageId) return false;
    const bi = InteractionMessages.findIndex(m => m.id === interactionData.parentInteractionMessageId);
    if (bi === -1) return false;
    const ci = InteractionMessages.findIndex(m => m.id === mid);
    return ci !== -1 && ci <= bi;
  };

  const toggleViewMode = () => {
    const container = chatHistoryRef.current;
    let targetIdx = -1;
    if (container && interactionData) {
      const cr = container.getBoundingClientRect();
      const ids = new Set(InteractionMessages.map(m => m.id));
      let bestTop = Number.POSITIVE_INFINITY;
      for (const el of container.querySelectorAll('[data-message-id]')) {
        const id = el.getAttribute('data-message-id'); if (!id || !ids.has(id)) continue;
        const r = el.getBoundingClientRect();
        if (r.top < cr.bottom && r.bottom > cr.top && r.top < bestTop) { bestTop = r.top; targetIdx = InteractionMessages.findIndex(m => m.id === id); }
      }
    }
    if (targetIdx === -1 && lastViewedMessageIdRef.current && interactionData) targetIdx = InteractionMessages.findIndex(m => m.id === lastViewedMessageIdRef.current);
    if (targetIdx >= 0 && interactionData) lastViewedMessageIdRef.current = InteractionMessages[targetIdx].id;
    suppressAutoScrollRef.current = true;
    setViewMode(p => p === 'ladder' ? 'cinematic' : 'ladder');
    setTimeout(() => {
      if (targetIdx >= 0 && interactionData && chatHistoryRef.current) {
        const el = chatHistoryRef.current.querySelector(`[data-message-id="${InteractionMessages[targetIdx].id}"]`) as HTMLElement | null;
        if (el) { el.scrollIntoView({ block: 'start' }); setTimeout(() => { suppressAutoScrollRef.current = false; }, 400); return; }
      }
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => { suppressAutoScrollRef.current = false; }, 400);
    }, 50);
  };

  const handleOpenSamplerEditor = (sampler?: Sampler | null) => { setSamplerToEdit(sampler || null); setIsSamplerListOpen(false); setIsSamplerEditorOpen(true); };
  const handleSaveSampler = (sampler: Sampler) => { saveSampler(sampler); setIsSamplerEditorOpen(false); setSamplerToEdit(null); };

  const handleImportComplete = useCallback(() => {
    tokenEngine.clearTokenCache();
    refreshChatList();
  }, [refreshChatList]);

  // ✅ Participant Control callbacks
  const handleForceFirstMessage = useCallback(async (character: Character) => {
    if (!interactionData) return;
    const firstMsgText = `*${character.name} enters the scene.*`;
    const chatMessage = createChatMessage(interactionData, character, firstMsgText);
    const updated = addMessageToInteractionData(interactionData, chatMessage);
    setInteractionData(updated);
    interactionDataRef.current = updated;
    await saveRawInteractionData(updated);
    addToast(`Sent first message as ${character.name}`, 'success');
  }, [interactionData, addToast]);

  const handleSendCustomMessage = useCallback(async (character: Character, text: string) => {
    if (!interactionData) return;
    const chatMessage = createChatMessage(interactionData, character, text);
    const updated = addMessageToInteractionData(interactionData, chatMessage);
    setInteractionData(updated);
    interactionDataRef.current = updated;
    await saveRawInteractionData(updated);
    addToast(`Sent message as ${character.name}`, 'success');
  }, [interactionData, addToast]);

  const handleInjectCustomMessage = useCallback(async (character: Character, text: string) => {
    if (!interactionData) return;
    const injectedContext: Context = {
      id: `injected-${uuidv4()}`,
      name: `[Injected] ${character.name}`,
      description: 'User-injected message for LLM context',
      text: `${character.name}: ${text}`,
      isAutoGenerated: true,
      useBase64Encoding: false,
      insertionDepth: 0,
      tokenBudget: 512,
      firstCreatedTimestamp: Date.now(),
      lastUpdatedTimestamp: Date.now(),
    };
    const updated: InteractionData = {
      ...interactionData,
      contexts: [...(interactionData.contexts || []), injectedContext],
      lastUpdatedTimestamp: Date.now(),
    };
    setInteractionData(updated);
    interactionDataRef.current = updated;
    await saveRawInteractionData(updated);
    addToast(`Injected custom message as ${character.name} into LLM context`, 'success');
  }, [interactionData, addToast]);

  const handleInjectFirstMessage = useCallback(async (character: Character) => {
    if (!interactionData) return;
    const firstMsgText = `*${character.name} enters the scene.*`;
    const injectedContext: Context = {
      id: `injected-first-${uuidv4()}`,
      name: `[Injected First] ${character.name}`,
      description: 'User-injected first message for LLM context',
      text: `${character.name}: ${firstMsgText}`,
      isAutoGenerated: true,
      useBase64Encoding: false,
      insertionDepth: 0,
      tokenBudget: 512,
      firstCreatedTimestamp: Date.now(),
      lastUpdatedTimestamp: Date.now(),
    };
    const updated: InteractionData = {
      ...interactionData,
      contexts: [...(interactionData.contexts || []), injectedContext],
      lastUpdatedTimestamp: Date.now(),
    };
    setInteractionData(updated);
    interactionDataRef.current = updated;
    await saveRawInteractionData(updated);
    addToast(`Injected first message as ${character.name} into LLM context`, 'success');
  }, [interactionData, addToast]);

  // ✅ 5. RENDER RETURN

  const streamingIndicators = (
    <>
      {isLoading && streamingCharacter && !streamingText && (
        <div className={`message-row ${viewMode === 'cinematic' ? '' : 'message-left'}`} data-message-id="thinking-message">
          {viewMode === 'ladder' && streamingCharacter.id !== currentCharacter?.id && streamingCharacter.id !== AMBIENT_NARRATOR_ID && (
            <div className="avatar-column"><div style={{ position: 'relative' }}>{streamingPortraitUrl ? <img src={streamingPortraitUrl} alt={streamingCharacter.name} className="character-avatar" onClick={e => handleAvatarClick(e, 'thinking-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} /> : <div className="character-avatar placeholder" onClick={e => handleAvatarClick(e, 'thinking-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} />}</div><span className="avatar-name" style={{ opacity: 0.5 }}>{getDelayedDisplayName(interactionData, Math.max(0, InteractionMessages.length - 1), streamingCharacter.id)}</span></div>
          )}
          <div className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} bubble-ai thinking-bubble`}>
            {viewMode === 'cinematic' && <div className="cinematic-bubble-header"><span>{getDelayedDisplayName(interactionData, Math.max(0, InteractionMessages.length - 1), streamingCharacter.id)}</span></div>}
            <span className="thinking-indicator"><span className="thinking-text">Thinking</span><span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span></span>
          </div>
        </div>
      )}
      {isLoading && streamingCharacter && streamingText && (
        <div className={`message-row ${viewMode === 'cinematic' ? '' : 'message-left'}`} data-message-id="streaming-message">
          {viewMode === 'ladder' && streamingCharacter.id !== currentCharacter?.id && streamingCharacter.id !== AMBIENT_NARRATOR_ID && (
            <div className="avatar-column"><div style={{ position: 'relative' }}>{streamingPortraitUrl ? <img src={streamingPortraitUrl} alt={streamingCharacter.name} className="character-avatar" onClick={e => handleAvatarClick(e, 'streaming-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} /> : <div className="character-avatar placeholder" onClick={e => handleAvatarClick(e, 'streaming-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} />}</div><span className="avatar-name">{getDelayedDisplayName(interactionData, Math.max(0, InteractionMessages.length - 1), streamingCharacter.id)}</span></div>
          )}
          <div className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} ${streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'bubble-ambient' : 'bubble-ai'}`}>
            {viewMode === 'cinematic' && <div className={`cinematic-bubble-header ${streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'cinematic-bubble-header-ambient' : ''}`}><span>{streamingCharacter.id === AMBIENT_NARRATOR_ID ? '✦' : getDelayedDisplayName(interactionData, Math.max(0, InteractionMessages.length - 1), streamingCharacter.id)}</span></div>}
            <div style={{ display: 'inline', whiteSpace: 'pre-wrap' }}><span className="message-text" style={{ display: 'inline' }}>{formattedStreamingText}</span><span className="cursor-blink" style={{ display: 'inline' }}>&nbsp;▋</span></div>
          </div>
        </div>
      )}
    </>
  );

  const displayMessages = viewMode === 'cinematic' ? [...InteractionMessages].reverse() : InteractionMessages;

  return (
    <>
      {isInitializing && <LoadingScreen steps={loadSteps} isFadeOut={isFadeOut} />}
      <div
        className={`chat-container ${viewMode === 'cinematic' ? 'mode-cinematic' : 'mode-ladder'} ${locationBackgroundUrl ? 'has-location-bg' : ''}`}
        style={locationBackgroundUrl ? { '--location-bg': `url(${locationBackgroundUrl})` } as React.CSSProperties : undefined}
        onClick={() => { setActionMenuTarget(null); setMenuSearchQuery(''); setShowActionFormat(false); deactivateToolbar(); }}
      >
        {!interactionData && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', opacity: 0.5, gap: '12px' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent)' }}>⚛️ LoreReactor</div>
            <div style={{ fontSize: '0.85rem' }}>Create a character to begin.</div>
            <button type="button" onClick={() => charModal.open()} style={{ marginTop: '8px', padding: '8px 20px', fontSize: '0.85rem', fontWeight: 'bold', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>🎭 Create Character</button>
          </div>
        )}

        {interactionData && <>
          {viewMode === 'cinematic' && centerAvatar && portraitUrlCache.get(`cinematic:${centerAvatar.id}`) && <div className="cinematic-stage active" onClick={e => { e.stopPropagation(); handleAvatarClick(e, centerAvatar.id || 'cinematic-bg', centerAvatar); }} title="Click character to interject action"><img src={portraitUrlCache.get(`cinematic:${centerAvatar.id}`)!} alt={centerAvatar.name} className="cinematic-avatar-img" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /></div>}

          <header className="app-header"><div className="header-content"><div className="header-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              {isEditingTitle
                ? <input type="text" value={editTitleValue} onChange={e => setEditTitleValue(e.target.value)} onBlur={handleSaveTitle} onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false); }} autoFocus style={{ background: 'var(--social-bg)', border: '1px solid var(--accent)', color: 'var(--text-h)', padding: '4px 8px', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', flexGrow: 1, maxWidth: '200px', outline: 'none' }} />
                : <><div className="header-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{interactionData?.name || 'Untitled Chat'}</div><span onClick={handleStartEditTitle} title="Edit Title" style={{ fontSize: '0.9em', opacity: 0.3, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.3'}>✎</span></>}
            </div>
            <div className="header-controls-group">
              <button type="button" className="view-mode-toggle" onClick={() => setIsSettingsOpen(true)} title="Settings" style={{ padding: '6px 10px' }}><span>⚙️</span></button>
              <button type="button" className="view-mode-toggle" onClick={() => interactionData && setIsExtListOpen(true)} title="Extensions" style={{ padding: '6px 10px' }}><span>🧩</span></button>
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
                budgetSpent={budgetData?.budgetSpent}
                maximumBudget={activeStrategy?.maximumBudget}
                timeUntilReset={budgetData && activeStrategy && budgetData.resetDuration > 0
                    ? Math.max(0, budgetData.resetDuration - (Date.now() - budgetData.lastResetTimestamp))
                    : undefined}
              />
            </div>
          </div></div></header>

          <div className="chat-history" ref={chatHistoryRef}>
            {viewMode === 'cinematic' && streamingIndicators}
            {displayMessages.map((message, renderIndex) => {
              const index = viewMode === 'cinematic' ? InteractionMessages.length - 1 - renderIndex : renderIndex;
              if (!message.character) return null;
              const isAmbient = message.character.id === AMBIENT_NARRATOR_ID;
              const isProtag = message.character.id === currentCharacter?.id;
              const dn = getDelayedDisplayName(interactionData, index, message.character.id);
              const isEditing = editingId === message.id;
              const isMassStart = message.id === massDeleteId;
              const inDelRange = isMassActive && massStartIndex !== -1 && index >= massStartIndex;
              const stem = isStemMessage(message.id);
              const beforeBranch = interactionData.parentInteractionMessageId && index === branchOffIndex;
              const showAvatar = viewMode === 'ladder' && !isProtag && !isAmbient;
              const isResumingThisMessage = isLoading && streamingCharacter && message.isPartial && message.character.id === streamingCharacter.id && !isProtag;
              if (isResumingThisMessage) return null;
              const messagePortraitUrl = portraitUrlCache.get(message.id) ?? null;

              return (
                <React.Fragment key={message.id}>
                  <div className={`message-row ${viewMode === 'cinematic' ? '' : isProtag ? 'message-right' : 'message-left'} ${inDelRange ? 'message-fading-out' : ''}`} data-message-id={message.id}>
                    {showAvatar && <div className="avatar-column"><div style={{ position: 'relative' }}>{messagePortraitUrl ? <img src={messagePortraitUrl} alt={dn} className="character-avatar" onClick={e => handleAvatarClick(e, message.id, message.character)} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} style={{ cursor: 'pointer' }} /> : <div className="character-avatar placeholder" onClick={e => handleAvatarClick(e, message.id, message.character)} style={{ cursor: 'pointer' }} />}</div><span className="avatar-name">{dn}</span></div>}
                    <div className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} ${isProtag ? 'bubble-user' : 'bubble-ai'} ${isAmbient ? 'bubble-ambient' : ''} ${isEditing ? 'bubble-editing' : ''} ${inDelRange ? 'bubble-marked-for-delete' : ''} ${stem ? 'bubble-stem' : ''} ${activeToolbarId === message.id ? 'toolbar-active' : ''}`} onTouchStart={e => handleBubbleTouchStart(e, message.id)} onTouchEnd={handleBubbleTouchEnd} onTouchMove={handleBubbleTouchMove} onClick={e => { if (suppressNextClickRef.current) { e.preventDefault(); e.stopPropagation(); suppressNextClickRef.current = false; } }}>
                      {viewMode === 'cinematic' && <div className={`cinematic-bubble-header ${isAmbient ? 'cinematic-bubble-header-ambient' : ''}`}><span>{isAmbient ? '✦' : dn}</span></div>}
                      {isEditing ? (
                        <div className="edit-mode">
                          <textarea ref={editTextareaRef} value={editDraft} onChange={e => setEditDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); } if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); } }} className="edit-textarea" />
                          <div className="edit-actions">
                            <button type="button" onClick={() => { setEditingId(null); setEditDraft(''); }} className="edit-btn edit-btn-cancel">Cancel</button>
                            {/* ✅ Regenerate button positioned left of Save */}
                            <button 
                              type="button" 
                              onClick={handleRegenerateFromEdit} 
                              disabled={!isModelReady || isLoading}
                              className="edit-btn edit-btn-regenerate"
                              title="Save changes and regenerate response"
                              style={!isModelReady || isLoading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                            >
                              Regenerate
                            </button>
                            <button type="button" onClick={handleSaveEdit} className="edit-btn edit-btn-save">Save</button>
                          </div>
                        </div>
                      ) : <>
                        <MemoizedMessageText text={message.textContent} />
                        {(message as ChatMessage).files?.length > 0 && <div className="message-attachment-indicator" title={`${(message as ChatMessage).files.length} attached file${(message as ChatMessage).files.length !== 1 ? 's' : ''}`}>📎 {(message as ChatMessage).files.length}</div>}
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
            {interactionData && InteractionMessages.length === 0 && <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}><p>Add characters to the chat and start chatting.</p></div>}
            <div ref={messageEndRef} style={{ height: '1px' }} />
          </div>

          <div className="context-bar" style={{ display: viewMode === 'cinematic' ? 'none' : 'flex' }}>
            <NavButton icon="💬" label="Chat List" onClick={() => setIsChatListOpen(true)} />
            <NavButton icon="🎭" label="Characters" onClick={() => setIsCharListOpen(true)} />
            <NavButton icon="🌍" label="Contexts" onClick={() => setIsContextListOpen(true)} />
            <NavButton icon="📍" label="Locations" onClick={() => setIsLocationListOpen(true)} />
            <NavButton icon="🤖" label="Models" onClick={() => setIsModelListOpen(true)} />
            <NavButton icon="🎚️" label="Samplers" onClick={() => setIsSamplerListOpen(true)} />
            <NavButton icon="🛑" label="Stop Patterns" onClick={() => setIsStopListOpen(true)} />
            <NavButton icon="💰" label="Budgets" onClick={() => setIsBudgetStrategyListOpen(true)} />
            <NavButton icon="👤" label="Profiles" onClick={() => setIsProfileListOpen(true)} />
          </div>

          <div className="input-wrapper">
            {!activeStrategy && !isModelReady && <div className={`model-status-banner ${!selectedModelId ? 'model-status-warning' : 'model-status-loading'}`}>{!selectedModelId && <span className="model-status-icon">🤖</span>}{isModelLoading && <span className="model-status-spinner" />}<span className="model-status-text">{modelStatusMessage}</span>{!selectedModelId && <button type="button" className="model-status-action-btn" onClick={() => setIsModelListOpen(true)}>Open Models</button>}</div>}
            {pendingFiles.length > 0 && <div className="attachment-strip">{pendingFiles.map((f, i) => <div key={`${f.name}-${i}`} className="attachment-chip"><span className="attachment-name">{f.name}</span><span className="attachment-size">{(f.size / 1024).toFixed(1)} KB</span><button type="button" onClick={() => setPendingFiles(p => p.filter((_, j) => j !== i))} className="attachment-remove">×</button></div>)}</div>}
            <div className="input-area">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading || !isModelReady} className="attach-button toolbar-btn">📎</button>
                <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelected} />
                <button type="button" onClick={handleToggleMicrophone} disabled={isLoading ||!isModelReady} className={`attach-button toolbar-btn ${isRecording ? 'stt-mic-active' : ''}`} title={isRecording ? 'Stop recording' : 'Start voice input'}>{isRecording ? '⏹' : '🎙️'}</button>
                <textarea ref={textareaRef} value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder={isModelReady ? `Chat as ${currentCharacter?.name || 'User'}.` : isModelLoading ? 'Warming up... please wait' : 'Load a model to start chatting...'} className={`chat-input ${!isModelReady ? 'chat-input-disabled' : ''}`} disabled={isLoading || !interactionData || !isModelReady} />
                <button type="button" onClick={isLoading ? stopGeneration : handleSend} disabled={!isLoading && (!inputText.trim() && !pendingFiles.length) || (!isLoading && !isModelReady)} className={`send-button counter ${!isLoading && !isModelReady ? 'send-button-disabled' : ''}`}>{isLoading ? '⏹ Stop' : !isModelReady ? '⏳ Wait' : 'Send'}</button>
            </div>
          </div>
        </>}

        {/* ─── Modals ─────────────────────────────────────────────── */}

        {isChatListOpen && <ManagerModal title="Chat Sessions" items={allChats} isOpen={isChatListOpen} onClose={() => setIsChatListOpen(false)} onSelect={c => handleSwitchChat(c.id)} onDelete={id => handleDeleteChat({ stopPropagation: () => {} } as any, id)} onCreateNew={handleNewChat} renderSubtext={renderChatSubtext} emptyMessage="No saved chat sessions found." />}
        {isCharListOpen && <ManagerModal title="Characters" items={allCharacters} isOpen={isCharListOpen} onClose={() => setIsCharListOpen(false)} onSelect={async c => { const f = c.sampler ? c : await loadFullCharacter(c.id); charModal.open(f || c); }} onDelete={deleteCharacter} onCreateNew={() => charModal.open()} renderSubtext={c => c.description || 'No description'} emptyMessage="No characters found." actionLabel="Delete" orderedListMode={!!interactionData} currentOrderIds={interactionData?.participants.map(p => p.id) || []} onToggleOrder={handleToggleParticipant} specialActionIcon="★" onSpecialAction={handleSetChatProtagonist} specialActionTooltip={c => `set ${c.name} as the protagonist`} activeSpecialActionId={interactionData?.protagonist?.id} />}
        {charModal.isOpen && <CharacterEditorModal isOpen={charModal.isOpen} onClose={charModal.close} onSave={charModal.handleSave} existingCharacter={charModal.itemToEdit} allSamplers={allSamplers} selectedModel={allModels.find(m => m.id === selectedModelId) || null} runningModels={runningModels} />}
        {isContextListOpen && <ManagerModal title="Contexts" items={allContexts} isOpen={isContextListOpen} onClose={() => setIsContextListOpen(false)} onSelect={c => contextModal.open(c)} onDelete={contextModal.handleDelete} onCreateNew={() => contextModal.open()} renderSubtext={renderContextSubtext} emptyMessage="No contexts found." actionLabel="Delete" orderedListMode={true} currentOrderIds={interactionData?.contexts?.map(i => i.id) || []} onToggleOrder={handleToggleContext} />}
        {contextModal.isOpen && <ContextEditorModal isOpen={contextModal.isOpen} onClose={contextModal.close} onSave={contextModal.handleSave} existingContext={contextModal.itemToEdit} allCharacters={allCharacters} />}
        {isLocationListOpen && <ManagerModal title="Locations" items={allLocations} isOpen={isLocationListOpen} onClose={() => setIsLocationListOpen(false)} onSelect={l => locationModal.open(l)} onDelete={locationModal.handleDelete} onCreateNew={() => locationModal.open()} renderSubtext={renderLocationSubtext} emptyMessage="No locations found." actionLabel="Delete" orderedListMode={true} currentOrderIds={interactionData?.locations?.map(l => l.id) || []} onToggleOrder={handleToggleLocation} />}
        {locationModal.isOpen && <LocationEditorModal isOpen={locationModal.isOpen} onClose={locationModal.close} onSave={locationModal.handleSave} existingLocation={locationModal.itemToEdit} allCharacters={allCharacters} allLocations={allLocations} />}
        {isModelListOpen && <ManagerModal title="Models" items={allModels} isOpen={isModelListOpen} onClose={() => setIsModelListOpen(false)} onSelect={m => modelModal.open(m)} onDelete={deleteModel} onCreateNew={() => modelModal.open()} renderSubtext={m => renderModelSubtext(m, runningModels, selectedModelId)} emptyMessage="No models available." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={selectedModelId || undefined} specialActionIcon="★" onSpecialAction={id => toggleModelLoad(id)} specialActionTooltip={m => { const ms = runningModels[m.id]; const isCloud = !!m.apiKey && m.backend && cloudBackends.includes(m.backend); if (isCloud && selectedModelId === m.id) return '☁️ Cloud Model — Click to Deselect'; if (isCloud) return '☁️ Cloud Model — Click to Select'; if (ms?.isRunning && ms?.isIdle && selectedModelId === m.id) return '⏹ Stop & Deselect'; if (ms?.isRunning && ms?.isIdle) return '⏹ Stop Model'; if (ms?.isRunning && !ms?.isIdle) return '⏳ Loading...'; if (selectedModelId === m.id) return '✓ Already Selected — Click to Load'; return '▶ Load & Select Model'; }} />}
        {modelModal.isOpen && <ModelEditorModal isOpen={modelModal.isOpen} onClose={modelModal.close} onSave={modelModal.handleSave} existingModel={modelModal.itemToEdit} allStopPatterns={allStopPatterns} />}
        {isSamplerListOpen && <ManagerModal title="Samplers" items={allSamplers} isOpen={isSamplerListOpen} onClose={() => setIsSamplerListOpen(false)} onSelect={s => handleOpenSamplerEditor(s)} onDelete={deleteSampler} onCreateNew={() => handleOpenSamplerEditor(null)} renderSubtext={s => `Temp: ${s?.parameters?.temperature}, TopP: ${s?.parameters?.top_p}, Tokens: ${s?.maximumNumberOfTokens}`} emptyMessage="No samplers found." actionLabel="Delete" />}
        {isSamplerEditorOpen && <SamplerEditorModal isOpen={isSamplerEditorOpen} onClose={() => { setIsSamplerEditorOpen(false); setSamplerToEdit(null); }} onSave={handleSaveSampler} existingSampler={samplerToEdit} allStopPatterns={allStopPatterns} />}
        {isStopListOpen && <ManagerModal title="Stop Patterns" items={allStopPatterns} isOpen={isStopListOpen} onClose={() => setIsStopListOpen(false)} onSelect={s => stopModal.open(s)} onDelete={stopModal.handleDelete} onCreateNew={() => stopModal.open()} renderSubtext={s => <span style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block' }}>{s.regularExpressionActivationTrigger ? '⚡' : '📌'} Pattern: {s.pattern}</span>} emptyMessage="No stop patterns found." actionLabel="Delete" orderedListMode={false} />}
        {stopModal.isOpen && <StopPatternEditorModal isOpen={stopModal.isOpen} onClose={stopModal.close} onSave={stopModal.handleSave} existingStopPattern={stopModal.itemToEdit} />}
        {isBudgetStrategyListOpen && <ManagerModal title="Budget Strategies" items={allBudgetStrategies} isOpen={isBudgetStrategyListOpen} onClose={() => setIsBudgetStrategyListOpen(false)} onSelect={s => budgetModal.open(s)} onDelete={budgetModal.handleDelete} onCreateNew={() => budgetModal.open()} renderSubtext={renderBudgetStrategySubtext} emptyMessage="No budget strategies found." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={selectedBudgetStrategyId || undefined} specialActionIcon="★" onSpecialAction={handleActivateBudgetStrategy} specialActionTooltip={s => selectedBudgetStrategyId === s.id ? `Deactivate ${s.name}` : `Activate ${s.name}`} />}
        {budgetModal.isOpen && <BudgetStrategyEditorModal isOpen={budgetModal.isOpen} onClose={budgetModal.close} onSave={budgetModal.handleSave} existingStrategy={budgetModal.itemToEdit} allModels={allModels} />}
        {isProfileListOpen && <ManagerModal title="Profiles" items={allProfiles} isOpen={isProfileListOpen} onClose={() => setIsProfileListOpen(false)} onSelect={p => profileModal.open(p)} onDelete={deleteProfile} onCreateNew={() => profileModal.open()} renderSubtext={renderProfileSubtext} emptyMessage="No profiles found." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={interactionData?.Profile?.id || undefined} specialActionIcon="★" onSpecialAction={handleActivateProfile} specialActionTooltip={p => interactionData?.Profile?.id === p.id ? `Deactivate ${p.name}` : `Activate ${p.name}`} />}
        {profileModal.isOpen && <ProfileEditorModal isOpen={profileModal.isOpen} onClose={profileModal.close} onSave={profileModal.handleSave} existingProfile={profileModal.itemToEdit} />}
        {isExtListOpen && <ManagerModal title="Extensions" items={allExtensions} isOpen={isExtListOpen} onClose={() => setIsExtListOpen(false)} onSelect={undefined} onDelete={deleteExtension} onCreateNew={() => addToast('Create Extension Modal coming soon!', 'info')} renderSubtext={renderExtensionSubtext} emptyMessage="No extensions available." actionLabel="Delete" orderedListMode={true} currentOrderIds={(interactionData as any)?.extensions?.map((e: any) => e.id) || []} onToggleOrder={handleToggleExtension} />}

        {/* Settings & Tool Modals */}
        {isSettingsOpen && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onOpenImportCharacterCard={() => setIsCardImportOpen(true)}
            onOpenAIRecommendation={() => setIsAIRecommendationOpen(true)}
            onOpenExportData={() => setIsExportDataOpen(true)}
            onOpenImportData={() => setIsImportDataOpen(true)}
            onOpenParticipantControl={() => setIsParticipantControlOpen(true)}
            onOpenBudgetControl={() => setIsBudgetControlOpen(true)}
          />
        )}
        {isBudgetControlOpen && (
          <BudgetControlModal
            isOpen={isBudgetControlOpen}
            onClose={() => setIsBudgetControlOpen(false)}
            allBudgetStrategies={allBudgetStrategies}
            activeStrategy={activeStrategy}
          />
        )}
        {isParticipantControlOpen && <ParticipantControlModal isOpen={isParticipantControlOpen} onClose={() => setIsParticipantControlOpen(false)} interactionData={interactionData} onUpdateInteractionData={(data) => { setInteractionData(data); interactionDataRef.current = data; saveRawInteractionData(data); }} onForceFirstMessage={handleForceFirstMessage} onSendCustomMessage={handleSendCustomMessage} onInjectCustomMessage={handleInjectCustomMessage} onInjectFirstMessage={handleInjectFirstMessage} />}
        {isAIRecommendationOpen && <AIRecommendationModal isOpen={isAIRecommendationOpen} onClose={() => setIsAIRecommendationOpen(false)} onSaveCharacter={saveCharacter} onSaveContext={saveContext} onSaveLocation={saveLocation} allSamplers={allSamplers} allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations} selectedModel={allModels.find(m => m.id === selectedModelId) || null} runningModels={runningModels} activeStrategy={activeStrategy} />}
        {isCardImportOpen && <CharacterCardImportModal isOpen={isCardImportOpen} onClose={() => setIsCardImportOpen(false)} onSaveCharacter={saveCharacter} onSaveContext={saveContext} allSamplers={allSamplers} />}
        {isExportDataOpen && <DataExportModal isOpen={isExportDataOpen} onClose={() => setIsExportDataOpen(false)} />}
        {isImportDataOpen && <DataImportModal isOpen={isImportDataOpen} onClose={() => setIsImportDataOpen(false)} onImportComplete={handleImportComplete} />}
      </div>

      {/* ─── Action Menu with Format Panel ─── */}
      {actionMenuTarget && interactionData && (
        <div className="action-menu-container" style={{ left: `${actionMenuTarget.x + 10}px`, top: `${actionMenuTarget.y}px`, zIndex: 9999 }} onClick={e => e.stopPropagation()}>
          <div className="action-menu-header">
            <span>Interject Action</span>
            <button type="button" className={`action-format-toggle ${showActionFormat ? 'action-format-toggle-active' : ''}`} onClick={e => { e.stopPropagation(); setShowActionFormat(prev => !prev); }}>Format</button>
          </div>

          {showActionFormat && (
            <div className="action-format-panel" onClick={e => e.stopPropagation()}>
              <div className="action-format-row">
                <button type="button" className={`action-format-btn ${actionWrap === '*' ? 'action-format-btn-active' : ''}`} onClick={() => setActionWrap('*')}>*</button>
                <button type="button" className={`action-format-btn ${actionWrap === '()' ? 'action-format-btn-active' : ''}`} onClick={() => setActionWrap('()')}>()</button>
                <button type="button" className={`action-format-btn ${actionWrap === 'none' ? 'action-format-btn-active' : ''}`} onClick={() => setActionWrap('none')}>None</button>
              </div>
              <div className="action-format-row">
                <button type="button" className={`action-format-btn ${actionCase === 'first' ? 'action-format-btn-active' : ''}`} onClick={() => setActionCase('first')}>A*</button>
                <button type="button" className={`action-format-btn ${actionCase === 'pascal' ? 'action-format-btn-active' : ''}`} onClick={() => setActionCase('pascal')}>A* A*</button>
                <button type="button" className={`action-format-btn ${actionCase === 'lower' ? 'action-format-btn-active' : ''}`} onClick={() => setActionCase('lower')}>a*</button>
              </div>
              <div className="action-format-row">
                <button type="button" className={`action-format-btn ${actionPunctuation === '.' ? 'action-format-btn-active' : ''}`} onClick={() => setActionPunctuation('.')}>.</button>
                <button type="button" className={`action-format-btn ${actionPunctuation === '-' ? 'action-format-btn-active' : ''}`} onClick={() => setActionPunctuation('-')}>-</button>
                <button type="button" className={`action-format-btn ${actionPunctuation === 'none' ? 'action-format-btn-active' : ''}`} onClick={() => setActionPunctuation('none')}>None</button>
              </div>
            </div>
          )}

          {!showActionFormat && (
            <>
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
            </>
          )}
        </div>
      )}
    </>
  );
}

export default App;