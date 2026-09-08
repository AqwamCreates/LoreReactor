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
import { saveRawInteractionData, loadRawInteractionData, getCharacterImageUrl } from '../hooks/storage';
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
    InteractionData, Extension, Profile, ChatMessage
} from '../types';
import { renderModelSubtext, renderBudgetStrategySubtext, renderProfileSubtext, renderChatSubtext, renderContextSubtext, renderLocationSubtext, renderExtensionSubtext } from './renderHelpers';
import { useChatRestoration } from '../hooks/useChatRestoration';
import { useEntitySync } from '../hooks/useEntitySync';
import { useActionMenu } from '../hooks/useActionMenu';
import { useMessageActions } from '../hooks/useMessageActions';
import { useChatOperations } from '../hooks/useChatOperations';
import { useEntityToggles } from '../hooks/useEntityToggles';
import { useCinematicMode } from '../hooks/useCinematicMode';
import { useMessageToolbar } from '../hooks/useMessageToolbar';
import { useModalVisibility } from '../hooks/useModalVisibility';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';
const STORAGE_KEY_ACTIVE_CHAT = 'loreReactor_activeChatId';
const STORAGE_KEY_BUDGET_STRATEGY = 'loreReactor_selectedBudgetStrategyId';
const STORAGE_KEY_DEFAULT_CHARACTER = 'loreReactor_defaultCharacterId';
const STORAGE_KEY_SELECTED_MODEL = 'loreReactor_selectedModelId';
const MIN_LOADING_SCREEN_MS = 900;

interface NavButtonProps { icon: string; label: string; onClick: () => void }
interface LoadStep { id: string; label: string; icon: string; done: boolean }

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
                    <div key={step.id} title={step.label} className={`loading-step-icon ${step.done ? 'done' : ''}`}>{step.icon}</div>
                ))}
            </div>
            <div className="loading-screen-row loading-screen-row-bottom">
                {renderBottomRow.map(step => (
                    <div key={step.id} title={step.label} className={`loading-step-icon ${step.done ? 'done' : ''}`}>{step.icon}</div>
                ))}
            </div>
            <div className="loading-screen-status">{current ? `Loading ${current.label.toLowerCase()}...` : 'Finalizing...'}</div>
            <div className="loading-screen-progress-track"><div className="loading-screen-progress-fill" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
            <div className="loading-screen-counter">{done}/{steps.length}</div>
        </div>
    );
}

function App() {
    // ─── Session Hook ────────────────────────────────────────────────
    const {
        interactionData, setInteractionData, currentCharacter, setCurrentCharacter,
        isLoading, streamingText, streamingCharacter, currentCharacterExpression, sendMessage, stopGeneration,
        resumeGeneration, regenerateFromMessage, messageEndRef, chatHistoryRef,
        generationSpeed, timeToFirstToken, numberOfMessages, numberOfTokens, maximumNumberOfTokens, startNewChat,
        numberOfCacheInvalidations, numberOfRequests, totalCost, costWithoutCacheMisses,
        sendActionAndGetResponse, setActiveBudgetStrategy, setSelectedGlobalModel, updateRunningModels,
        activeStrategy, budgetData, processProtagonistImageSilently,
    } = useChatSession();

    const { addToast } = useToast();

    // ─── Manager Hooks ───────────────────────────────────────────────
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

    // ─── Entity Modals ───────────────────────────────────────────────
    const charModal = useEntityModal<Character>(saveCharacter, deleteCharacter, 'Character');
    const contextModal = useEntityModal<Context>(saveContext, deleteContext, 'Context');
    const locationModal = useEntityModal<Location>(saveLocation, deleteLocation, 'Location');
    const stopModal = useEntityModal<StopPattern>(saveStopPattern, deleteStopPattern, 'Stop Pattern');
    const modelModal = useEntityModal<LanguageModel>(saveModel, deleteModel, 'Model');
    const budgetModal = useEntityModal<BudgetStrategy>(saveBudgetStrategy, deleteBudgetStrategy, 'Budget Strategy');
    const profileModal = useEntityModal<Profile>(saveProfile, deleteProfile, 'Profile');

    // ─── Extracted Hooks ─────────────────────────────────────────────
    const modals = useModalVisibility();
    const [samplerToEdit, setSamplerToEdit] = useState<Sampler | null>(null);
    const [defaultCharacterId, setDefaultCharacterId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY_DEFAULT_CHARACTER));
    const [selectedBudgetStrategyId, setSelectedBudgetStrategyId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY_BUDGET_STRATEGY));
    const [maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens, setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens] = useState<number>(0);
    const [isRecording, setIsRecording] = useState(false);
    const [viewMode, setViewMode] = useState<'ladder' | 'cinematic'>('ladder');
    const [inputText, setInputText] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);

    const { activeChatRestored } = useChatRestoration({
        charsLoading, chatsLoading, contextsLoading, locationsLoading, profilesLoading,
        allCharacters, allChats, loadFullCharacter,
        setInteractionData, setCurrentCharacter, setSelectedModelId, startNewChat,
    });

    const interactionDataRef = useRef<InteractionData | null>(null);
    useEffect(() => { interactionDataRef.current = interactionData; }, [interactionData]);

    useEntitySync({
        activeChatRestored, interactionDataRef,
        allCharacters, allContexts, allProfiles,
        currentCharacter, setInteractionData, setCurrentCharacter,
    });

    const {
        actionMenuTarget, menuSearchQuery, setMenuSearchQuery,
        actionsLoading,
        showActionFormat, setShowActionFormat,
        actionWrap, setActionWrap, actionCase, setActionCase, actionPunctuation, setActionPunctuation,
        handleAddAction, handleDeleteAction, handleActionInterject,
        getFilteredActions, handleAvatarClick, closeActionMenu,
    } = useActionMenu({
        interactionData, currentCharacter, isLoading, isModelReady: !!activeStrategy || !!selectedModelId,
        allCharacters, stopGeneration, sendActionAndGetResponse, addToast,
    });

    const {
        editingId, editDraft, setEditDraft,
        massDeleteId, setMassDeleteId,
        handleSaveEdit, handleRegenerateFromEdit,
        handleDelete, handleMassDeleteConfirm,
        handleBranch, handleClone, handleCopyText,
        startEditing, cancelEditing,
    } = useMessageActions({
        interactionData, currentCharacter,
        isModelReady: !!activeStrategy || !!selectedModelId, isLoading,
        setInteractionData, setCurrentCharacter, refreshChatList,
        regenerateFromMessage, addToast,
    });

    const {
        isEditingTitle, editTitleValue, setEditTitleValue,
        handleSwitchChat, handleNewChat, handleDeleteChat,
        handleStartEditTitle, handleSaveTitle, cancelEditTitle,
    } = useChatOperations({
        interactionData, currentCharacter, defaultCharacterId,
        allCharacters, allChats,
        setInteractionData, setCurrentCharacter, refreshChatList,
        startNewChat, deleteChatFromList, addToast,
    });

    const {
        handleToggleParticipant, handleToggleContext, handleToggleLocation,
        handleSetChatProtagonist, handleToggleExtension,
        handleActivateBudgetStrategy, handleActivateProfile,
    } = useEntityToggles({
        interactionData, allCharacters, allContexts, allExtensions,
        allProfiles, allBudgetStrategies, selectedBudgetStrategyId,
        setInteractionData, setCurrentCharacter, setActiveBudgetStrategy,
        setSelectedBudgetStrategyId, setDefaultCharacterId,
        loadFullCharacter, addToast,
    });

    const {
        centerAvatar, lastViewedMessageIdRef, suppressAutoScrollRef,
        InteractionMessages, portraitUrlCache, streamingPortraitUrl, locationBackgroundUrl,
    } = useCinematicMode({
        viewMode, interactionData, currentCharacter,
        streamingCharacter, currentCharacterExpression, chatHistoryRef,
    });

    const {
        activeToolbarId, deactivateToolbar,
        handleBubbleTouchStart, handleBubbleTouchEnd, handleBubbleTouchMove,
        suppressNextClickRef,
    } = useMessageToolbar({ chatHistoryRef });

    // ─── Derived Values ──────────────────────────────────────────────
    const isModelReady = useMemo(() => {
        if (activeStrategy) return true;
        if (!selectedModelId) return false;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend)) return true;
        return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle === true;
    }, [selectedModelId, allModels, runningModels, activeStrategy]);

    const isModelLoading = useMemo(() => {
        if (!selectedModelId) return false;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend)) return false;
        return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle !== true;
    }, [selectedModelId, allModels, runningModels]);

    const modelStatusMessage = !selectedModelId ? 'No model selected — open Models to load one' : isModelLoading ? 'Model is warming up... please wait' : '';
    const isMassActive = massDeleteId !== null;
    const massStartIndex = isMassActive && interactionData ? InteractionMessages.findIndex(m => m.id === massDeleteId) : -1;
    const branchOffIndex = interactionData?.parentInteractionMessageId ? InteractionMessages.findIndex(m => m.id === interactionData.parentInteractionMessageId) : -1;
    const formattedStreamingText = useMemo(() => formatMessageText(streamingText), [streamingText]);

    const maximumNumberOfContextTokens = useMemo(() => {
        if (!interactionData?.contexts?.length) return 0;
        let total = 0;
        for (const ctx of interactionData.contexts) { if (ctx.text) total += Math.ceil(ctx.text.length / 4); }
        return total;
    }, [interactionData]);

    // ─── Effects ─────────────────────────────────────────────────────
    useEffect(() => {
        const enabled = interactionData?.Profile?.enableCharacterExpression ?? false;
        if (enabled) sentimentEngine.initialize(); else sentimentEngine.unload();
    }, [interactionData?.Profile?.enableCharacterExpression]);

    useEffect(() => { void selectedModelId; void runningModels; new LanguageModelEngine().clearTokenCache(); }, [selectedModelId, runningModels]);

    useEffect(() => { if (interactionData?.id) localStorage.setItem(STORAGE_KEY_ACTIVE_CHAT, interactionData.id); else localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT); }, [interactionData?.id]);
    useEffect(() => { if (selectedBudgetStrategyId) localStorage.setItem(STORAGE_KEY_BUDGET_STRATEGY, selectedBudgetStrategyId); else localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY); }, [selectedBudgetStrategyId]);
    useEffect(() => { if (defaultCharacterId) localStorage.setItem(STORAGE_KEY_DEFAULT_CHARACTER, defaultCharacterId); else localStorage.removeItem(STORAGE_KEY_DEFAULT_CHARACTER); }, [defaultCharacterId]);
    useEffect(() => { if (selectedModelId) localStorage.setItem(STORAGE_KEY_SELECTED_MODEL, selectedModelId); else localStorage.removeItem(STORAGE_KEY_SELECTED_MODEL); }, [selectedModelId]);

    useEffect(() => {
        if (!selectedBudgetStrategyId || allBudgetStrategies.length === 0) return;
        const strategy = allBudgetStrategies.find(s => s.id === selectedBudgetStrategyId);
        if (strategy) setActiveBudgetStrategy(strategy); else localStorage.removeItem(STORAGE_KEY_BUDGET_STRATEGY);
    }, [selectedBudgetStrategyId, allBudgetStrategies, setActiveBudgetStrategy]);

    useEffect(() => {
        if (!selectedModelId || allModels.length === 0) return;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (!selectedModel) { setSelectedModelId(null); return; }
        const isCloudModel = !!selectedModel.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend);
        if (isCloudModel) return;
        if (!runningModels[selectedModelId]?.isRunning) setSelectedModelId(null);
    }, [selectedModelId, allModels, runningModels, setSelectedModelId]);

    useEffect(() => {
        const parentInteractionDataId = interactionData?.parentInteractionDataId;
        if (!parentInteractionDataId) return;
        let cancelled = false;
        (async () => { try { const s = await loadRawInteractionData(parentInteractionDataId, allCharacters); if (!cancelled) { /* branchSourceTitle handled elsewhere */ } } catch { } })();
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

    // Budget strategy sync
    useEffect(() => {
        if (!activeStrategy) return;
        let stratChanged = false;
        const updatedStrat = { ...activeStrategy };
        const savedOnlineIds = (activeStrategy as any)._rawOnlineModelIds || activeStrategy.onlineModels.map((m: LanguageModel) => m.id);
        const freshOnlineModels: LanguageModel[] = [];
        for (const mid of savedOnlineIds) { const fresh = allModels.find(x => x.id === mid); if (fresh) freshOnlineModels.push(fresh); }
        if (freshOnlineModels.length !== activeStrategy.onlineModels.length || freshOnlineModels.some((m, i) => m.id !== activeStrategy.onlineModels[i]?.id)) { updatedStrat.onlineModels = freshOnlineModels; stratChanged = true; }
        const savedLocalIds = (activeStrategy as any)._rawLocalModelIds || activeStrategy.localModels.map((m: LanguageModel) => m.id);
        const freshLocalModels: LanguageModel[] = [];
        for (const mid of savedLocalIds) { const fresh = allModels.find(x => x.id === mid); if (fresh) freshLocalModels.push(fresh); }
        if (freshLocalModels.length !== activeStrategy.localModels.length || freshLocalModels.some((m, i) => m.id !== activeStrategy.localModels[i]?.id)) { updatedStrat.localModels = freshLocalModels; stratChanged = true; }
        if (stratChanged) setActiveBudgetStrategy(updatedStrat);
    }, [activeStrategy, allModels, setActiveBudgetStrategy]);

    // Loading screen
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
    const loadingStartedAtRef = useRef<number | null>(null);
    const chatModifiedRef = useRef(false);

    useEffect(() => {
        if (!isInitializing) return;
        const allDone = loadSteps.every(s => s.done);
        const hasData = !!interactionData;
        if (!allDone || !activeChatRestored || !hasData) return;
        const loadingStartedAt = loadingStartedAtRef.current ?? Date.now();
        loadingStartedAtRef.current = loadingStartedAt;
        const remaining = Math.max(0, MIN_LOADING_SCREEN_MS - (Date.now() - loadingStartedAt));
        const hold = setTimeout(() => { setIsFadeOut(true); const fade = setTimeout(() => { setIsInitializing(false); setIsFadeOut(false); }, 300); return () => clearTimeout(fade); }, remaining);
        return () => clearTimeout(hold);
    }, [loadSteps, isInitializing, activeChatRestored, interactionData, allChats.length]);

    useEffect(() => { chatModifiedRef.current = false; }, []);
    useEffect(() => {
        if (!interactionData || !interactionData.id || chatModifiedRef.current) return;
        const protagId = interactionData.protagonist?.id;
        const nonProtagParticipants = interactionData.participants.filter(p => p.id !== protagId);
        if (nonProtagParticipants.length > 0 || InteractionMessages.length > 0 || (interactionData.contexts?.length ?? 0) > 0 || (interactionData.locations?.length ?? 0) > 0 || !!interactionData.Profile) chatModifiedRef.current = true;
    }, [interactionData, InteractionMessages]);
    useEffect(() => {
        if (!interactionData || !interactionData.id || !chatModifiedRef.current) return;
        if (!allChats.some(c => c.id === interactionData.id)) { saveRawInteractionData(interactionData).catch(e => console.error('Failed to save new chat:', e)); refreshChatList(); }
    }, [interactionData, allChats, refreshChatList]);

    // Textarea auto-resize
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const editTextareaRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { if (!textareaRef.current) return; textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, window.innerHeight * 0.3)}px`; });
    useEffect(() => { if (!editTextareaRef.current || !editingId) return; editTextareaRef.current.style.height = 'auto'; editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`; });

    // Max tokens calculation
    useEffect(() => {
        if (InteractionMessages.length === 0 || !interactionData?.participants) return;
        if (activeStrategy) { setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens(0); return; }
        let isCancelled = false;
        (async () => {
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
                        const tokens = await new LanguageModelEngine().countTokens(msg.textContent, modelContext);
                        if (participantCounts[charId] !== undefined) participantCounts[charId] += tokens;
                    }
                }
            }
            if (!isCancelled) setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens(Math.max(...Object.values(participantCounts), 0));
        })();
        return () => { isCancelled = true; };
    }, [InteractionMessages, interactionData?.participants, interactionData?.protagonist, selectedModelId, allModels, runningModels, activeStrategy]);

    // ─── Callbacks ───────────────────────────────────────────────────
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileList = e.target.files;
        const newFiles = fileList ? Array.from(fileList) : [];
        if (newFiles.length > 0) { setPendingFiles(prev => [...prev, ...newFiles]); addToast(`${newFiles.length} file${newFiles.length !== 1 ? 's' : ''} attached.`); }
        requestAnimationFrame(() => { if (fileInputRef.current) fileInputRef.current.value = ''; });
    };

    const handleToggleMicrophone = useCallback(async () => {
        if (isRecording) { await speechToTextEngine.stopRecording(); setIsRecording(false); }
        else {
            const started = await speechToTextEngine.startRecording((text) => { setInputText(prev => prev + (prev ? ' ' : '') + text); });
            if (!started) { addToast('Failed to start voice input. Check microphone permissions.', 'error'); return; }
            setIsRecording(true);
        }
    }, [isRecording, addToast]);

    const handleSend = () => {
        if (!inputText.trim() && !pendingFiles.length) return;
        sendMessage(inputText, pendingFiles); setInputText(''); setPendingFiles([]);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    };

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

    const handleOpenSamplerEditor = (sampler?: Sampler | null) => { setSamplerToEdit(sampler || null); modals.samplerList.close(); modals.samplerEditor.open(); };
    const handleSaveSampler = (sampler: Sampler) => { saveSampler(sampler); modals.samplerEditor.close(); setSamplerToEdit(null); };
    const handleImportComplete = useCallback(() => { new LanguageModelEngine().clearTokenCache(); refreshChatList(); }, [refreshChatList]);

    // Participant Control callbacks
    const handleForceFirstMessage = useCallback(async (character: Character) => {
        if (!interactionData) return;
        const chatMessage = createChatMessage(interactionData, character, `*${character.name} enters the scene.*`);
        const updated = addMessageToInteractionData(interactionData, chatMessage);
        setInteractionData(updated); interactionDataRef.current = updated;
        await saveRawInteractionData(updated); addToast(`Sent first message as ${character.name}`, 'success');
    }, [interactionData, addToast]);

    const handleSendCustomMessage = useCallback(async (character: Character, text: string) => {
        if (!interactionData) return;
        const chatMessage = createChatMessage(interactionData, character, text);
        const updated = addMessageToInteractionData(interactionData, chatMessage);
        setInteractionData(updated); interactionDataRef.current = updated;
        await saveRawInteractionData(updated); addToast(`Sent message as ${character.name}`, 'success');
    }, [interactionData, addToast]);

    const handleInjectCustomMessage = useCallback(async (character: Character, text: string) => {
        if (!interactionData) return;
        const injectedContext: Context = { id: `injected-${uuidv4()}`, name: `[Injected] ${character.name}`, description: 'User-injected message for LLM context', text: `${character.name}: ${text}`, isAutoGenerated: true, useBase64Encoding: false, insertionDepth: 0, tokenBudget: 512, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now() };
        const updated: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), injectedContext], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updated); interactionDataRef.current = updated;
        await saveRawInteractionData(updated); addToast(`Injected custom message as ${character.name} into LLM context`, 'success');
    }, [interactionData, addToast]);

    const handleInjectFirstMessage = useCallback(async (character: Character) => {
        if (!interactionData) return;
        const injectedContext: Context = { id: `injected-first-${uuidv4()}`, name: `[Injected First] ${character.name}`, description: 'User-injected first message for LLM context', text: `${character.name}: *${character.name} enters the scene.*`, isAutoGenerated: true, useBase64Encoding: false, insertionDepth: 0, tokenBudget: 512, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now() };
        const updated: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), injectedContext], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updated); interactionDataRef.current = updated;
        await saveRawInteractionData(updated); addToast(`Injected first message as ${character.name} into LLM context`, 'success');
    }, [interactionData, addToast]);

    // ─── Render ──────────────────────────────────────────────────────
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
            <div className={`chat-container ${viewMode === 'cinematic' ? 'mode-cinematic' : 'mode-ladder'} ${locationBackgroundUrl ? 'has-location-bg' : ''}`} style={locationBackgroundUrl ? { '--location-bg': `url(${locationBackgroundUrl})` } as React.CSSProperties : undefined} onClick={() => { closeActionMenu(); deactivateToolbar(); }}>
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
                                ? <input type="text" value={editTitleValue} onChange={e => setEditTitleValue(e.target.value)} onBlur={handleSaveTitle} onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') cancelEditTitle(); }} autoFocus style={{ background: 'var(--social-bg)', border: '1px solid var(--accent)', color: 'var(--text-h)', padding: '4px 8px', borderRadius: '4px', fontSize: '1rem', fontWeight: 'bold', flexGrow: 1, maxWidth: '200px', outline: 'none' }} />
                                : <><div className="header-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'default' }}>{interactionData?.name || 'Untitled Chat'}</div><span onClick={handleStartEditTitle} title="Edit Title" style={{ fontSize: '0.9em', opacity: 0.3, cursor: 'pointer', transition: 'opacity 0.2s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.3'}>✎</span></>}
                        </div>
                        <div className="header-controls-group">
                            <button type="button" className="view-mode-toggle" onClick={modals.settings.open} title="Settings" style={{ padding: '6px 10px' }}><span>⚙️</span></button>
                            <button type="button" className="view-mode-toggle" onClick={() => interactionData && modals.extList.open()} title="Extensions" style={{ padding: '6px 10px' }}><span>🧩</span></button>
                            <button type="button" onClick={toggleViewMode} className={`view-mode-toggle ${viewMode === 'cinematic' ? 'active' : ''}`} title="Switch View Mode"><span>{viewMode === 'ladder' ? '🎥' : '📜'}</span><span>{viewMode === 'ladder' ? 'Cinematic' : 'Ladder'}</span></button>
                            <ChatStatisticsBar generationSpeed={generationSpeed} timeToFirstToken={timeToFirstToken} numberOfMessages={numberOfMessages} numberOfTokens={numberOfTokens} maximumNumberOfTokens={maximumNumberOfTokens} maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens={maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens} maximumNumberOfContextTokens={maximumNumberOfContextTokens} numberOfCacheInvalidations={numberOfCacheInvalidations} numberOfRequests={numberOfRequests} totalCost={totalCost} costWithoutCacheMisses={costWithoutCacheMisses} budgetSpent={budgetData?.budgetSpent} maximumBudget={activeStrategy?.maximumBudget} timeUntilReset={budgetData && activeStrategy && budgetData.resetDuration > 0 ? Math.max(0, budgetData.resetDuration - (Date.now() - budgetData.lastResetTimestamp)) : undefined} />
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
                                                    <textarea ref={editTextareaRef} value={editDraft} onChange={e => setEditDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); } if (e.key === 'Escape') cancelEditing(); }} className="edit-textarea" />
                                                    <div className="edit-actions">
                                                        <button type="button" onClick={cancelEditing} className="edit-btn edit-btn-cancel">Cancel</button>
                                                        <button type="button" onClick={handleRegenerateFromEdit} disabled={!isModelReady || isLoading} className="edit-btn edit-btn-regenerate" title="Save changes and regenerate response" style={!isModelReady || isLoading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>Regenerate</button>
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
                                                        <button type="button" onClick={() => startEditing(message.id, message.textContent)} className="toolbar-btn">✎</button>
                                                        {!isProtag && <button type="button" onClick={() => regenerateFromMessage(message.id, 'ai')} disabled={!isModelReady} className="toolbar-btn" title="Regenerate this Response" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>↻</button>}
                                                        {isProtag && <button type="button" onClick={() => regenerateFromMessage(message.id, 'user')} disabled={!isModelReady} className="toolbar-btn" title="Regenerate Your Input" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>↻</button>}
                                                        <button type="button" onClick={() => handleBranch(message.id)} className="toolbar-btn" title="Branch from here">🌿</button>
                                                        <button type="button" onClick={() => handleClone(message.id)} className="toolbar-btn" title="Clone chat up to here">⑂</button>
                                                        <button type="button" onClick={() => handleDelete(message.id)} className="toolbar-btn delete-btn" style={{ color: '#ff4444' }}>🗑</button>
                                                        <button type="button" onClick={() => setMassDeleteId(message.id)} className="toolbar-btn mass-delete-btn" style={{ color: '#ff9900' }}>🗑️↓</button>
                                                    </> : massDeleteId === message.id ? <div className="mass-delete-confirm-bar"><span>Delete from here?</span><button type="button" onClick={handleMassDeleteConfirm} className="toolbar-btn btn-confirm">Confirm</button><button type="button" onClick={() => setMassDeleteId(null)} className="toolbar-btn btn-cancel">Cancel</button></div> : inDelRange ? <span className="deleted-preview-label">Will be deleted</span> : null}
                                                </div>
                                            </>}
                                        </div>
                                    </div>
                                    {beforeBranch && <div className="branch-separator-line clickable" onClick={() => { /* navigate to source */ }} title="Click to go back to source chat" style={{ cursor: 'pointer' }}><div className="branch-separator-content"><span className="branch-separator-icon">🌿</span><span className="branch-separator-text">Conversation Branches Here</span><span className="branch-separator-icon">🌿</span></div></div>}
                                </React.Fragment>
                            );
                        })}
                        {viewMode === 'ladder' && streamingIndicators}
                        {interactionData && InteractionMessages.length === 0 && <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}><p>Add characters to the chat and start chatting.</p></div>}
                        <div ref={messageEndRef} style={{ height: '1px' }} />
                    </div>

                    <div className="context-bar" style={{ display: viewMode === 'cinematic' ? 'none' : 'flex' }}>
                        <NavButton icon="💬" label="Chat List" onClick={modals.chatList.open} />
                        <NavButton icon="🎭" label="Characters" onClick={modals.charList.open} />
                        <NavButton icon="🌍" label="Contexts" onClick={modals.contextList.open} />
                        <NavButton icon="📍" label="Locations" onClick={modals.locationList.open} />
                        <NavButton icon="🤖" label="Models" onClick={modals.modelList.open} />
                        <NavButton icon="🎚️" label="Samplers" onClick={modals.samplerList.open} />
                        <NavButton icon="🛑" label="Stop Patterns" onClick={modals.stopList.open} />
                        <NavButton icon="💰" label="Budgets" onClick={modals.budgetStrategyList.open} />
                        <NavButton icon="👤" label="Profiles" onClick={modals.profileList.open} />
                    </div>

                    <div className="input-wrapper">
                        {!activeStrategy && !isModelReady && <div className={`model-status-banner ${!selectedModelId ? 'model-status-warning' : 'model-status-loading'}`}>{!selectedModelId && <span className="model-status-icon">🤖</span>}{isModelLoading && <span className="model-status-spinner" />}<span className="model-status-text">{modelStatusMessage}</span>{!selectedModelId && <button type="button" className="model-status-action-btn" onClick={modals.modelList.open}>Open Models</button>}</div>}
                        {pendingFiles.length > 0 && <div className="attachment-strip">{pendingFiles.map((f, i) => <div key={`${f.name}-${i}`} className="attachment-chip"><span className="attachment-name">{f.name}</span><span className="attachment-size">{(f.size / 1024).toFixed(1)} KB</span><button type="button" onClick={() => setPendingFiles(p => p.filter((_, j) => j !== i))} className="attachment-remove">×</button></div>)}</div>}
                        <div className="input-area">
                            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading || !isModelReady} className="attach-button toolbar-btn">📎</button>
                            <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileSelected} />
                            <button type="button" onClick={handleToggleMicrophone} disabled={isLoading || !isModelReady} className={`attach-button toolbar-btn ${isRecording ? 'stt-mic-active' : ''}`} title={isRecording ? 'Stop recording' : 'Start voice input'}>{isRecording ? '⏹' : '🎙️'}</button>
                            <textarea ref={textareaRef} value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder={isModelReady ? `Chat as ${currentCharacter?.name || 'User'}.` : isModelLoading ? 'Warming up... please wait' : 'Load a model to start chatting...'} className={`chat-input ${!isModelReady ? 'chat-input-disabled' : ''}`} disabled={isLoading || !interactionData || !isModelReady} />
                            <button type="button" onClick={isLoading ? stopGeneration : handleSend} disabled={!isLoading && (!inputText.trim() && !pendingFiles.length) || (!isLoading && !isModelReady)} className={`send-button counter ${!isLoading && !isModelReady ? 'send-button-disabled' : ''}`}>{isLoading ? '⏹ Stop' : !isModelReady ? '⏳ Wait' : 'Send'}</button>
                        </div>
                    </div>
                </>}

                {/* ─── Modals ─────────────────────────────────────────────── */}
                {modals.chatList.isOpen && <ManagerModal title="Chat Sessions" items={allChats} isOpen={modals.chatList.isOpen} onClose={modals.chatList.close} onSelect={c => handleSwitchChat(c.id)} onDelete={id => handleDeleteChat({ stopPropagation: () => {} } as any, id)} onCreateNew={handleNewChat} renderSubtext={renderChatSubtext} emptyMessage="No saved chat sessions found." />}
                {modals.charList.isOpen && <ManagerModal title="Characters" items={allCharacters} isOpen={modals.charList.isOpen} onClose={modals.charList.close} onSelect={async c => { const f = c.sampler ? c : await loadFullCharacter(c.id); charModal.open(f || c); }} onDelete={deleteCharacter} onCreateNew={() => charModal.open()} renderSubtext={c => c.description || 'No description'} emptyMessage="No characters found." actionLabel="Delete" orderedListMode={!!interactionData} currentOrderIds={interactionData?.participants.map(p => p.id) || []} onToggleOrder={handleToggleParticipant} specialActionIcon="★" onSpecialAction={handleSetChatProtagonist} specialActionTooltip={c => `set ${c.name} as the protagonist`} activeSpecialActionId={interactionData?.protagonist?.id} />}
                {charModal.isOpen && <CharacterEditorModal isOpen={charModal.isOpen} onClose={charModal.close} onSave={charModal.handleSave} existingCharacter={charModal.itemToEdit} allSamplers={allSamplers} selectedModel={allModels.find(m => m.id === selectedModelId) || null} runningModels={runningModels} />}
                {modals.contextList.isOpen && <ManagerModal title="Contexts" items={allContexts} isOpen={modals.contextList.isOpen} onClose={modals.contextList.close} onSelect={c => contextModal.open(c)} onDelete={contextModal.handleDelete} onCreateNew={() => contextModal.open()} renderSubtext={renderContextSubtext} emptyMessage="No contexts found." actionLabel="Delete" orderedListMode={true} currentOrderIds={interactionData?.contexts?.map(i => i.id) || []} onToggleOrder={handleToggleContext} />}
                {contextModal.isOpen && <ContextEditorModal isOpen={contextModal.isOpen} onClose={contextModal.close} onSave={contextModal.handleSave} existingContext={contextModal.itemToEdit} allCharacters={allCharacters} />}
                {modals.locationList.isOpen && <ManagerModal title="Locations" items={allLocations} isOpen={modals.locationList.isOpen} onClose={modals.locationList.close} onSelect={l => locationModal.open(l)} onDelete={locationModal.handleDelete} onCreateNew={() => locationModal.open()} renderSubtext={renderLocationSubtext} emptyMessage="No locations found." actionLabel="Delete" orderedListMode={true} currentOrderIds={interactionData?.locations?.map(l => l.id) || []} onToggleOrder={handleToggleLocation} />}
                {locationModal.isOpen && <LocationEditorModal isOpen={locationModal.isOpen} onClose={locationModal.close} onSave={locationModal.handleSave} existingLocation={locationModal.itemToEdit} allCharacters={allCharacters} allLocations={allLocations} />}
                {modals.modelList.isOpen && <ManagerModal title="Models" items={allModels} isOpen={modals.modelList.isOpen} onClose={modals.modelList.close} onSelect={m => modelModal.open(m)} onDelete={deleteModel} onCreateNew={() => modelModal.open()} renderSubtext={m => renderModelSubtext(m, runningModels, selectedModelId, activeStrategy)} emptyMessage="No models available." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={selectedModelId || undefined} specialActionIcon="★" onSpecialAction={id => toggleModelLoad(id)} specialActionTooltip={m => { const ms = runningModels[m.id]; const isCloud = !!m.apiKey && m.backend && cloudBackends.includes(m.backend); if (isCloud && selectedModelId === m.id) return '☁️ Cloud Model — Click to Deselect'; if (isCloud) return '☁️ Cloud Model — Click to Select'; if (ms?.isRunning && ms?.isIdle && selectedModelId === m.id) return '⏹ Stop & Deselect'; if (ms?.isRunning && ms?.isIdle) return '⏹ Stop Model'; if (ms?.isRunning && !ms?.isIdle) return '⏳ Loading...'; if (selectedModelId === m.id) return '✓ Already Selected — Click to Load'; return '▶ Load & Select Model'; }} />}
                {modelModal.isOpen && <ModelEditorModal isOpen={modelModal.isOpen} onClose={modelModal.close} onSave={modelModal.handleSave} existingModel={modelModal.itemToEdit} allStopPatterns={allStopPatterns} />}
                {modals.samplerList.isOpen && <ManagerModal title="Samplers" items={allSamplers} isOpen={modals.samplerList.isOpen} onClose={modals.samplerList.close} onSelect={s => handleOpenSamplerEditor(s)} onDelete={deleteSampler} onCreateNew={() => handleOpenSamplerEditor(null)} renderSubtext={s => `Temp: ${s?.parameters?.temperature}, TopP: ${s?.parameters?.top_p}, Tokens: ${s?.maximumNumberOfTokens}`} emptyMessage="No samplers found." actionLabel="Delete" />}
                {modals.samplerEditor.isOpen && <SamplerEditorModal isOpen={modals.samplerEditor.isOpen} onClose={() => { modals.samplerEditor.close(); setSamplerToEdit(null); }} onSave={handleSaveSampler} existingSampler={samplerToEdit} allStopPatterns={allStopPatterns} />}
                {modals.stopList.isOpen && <ManagerModal title="Stop Patterns" items={allStopPatterns} isOpen={modals.stopList.isOpen} onClose={modals.stopList.close} onSelect={s => stopModal.open(s)} onDelete={stopModal.handleDelete} onCreateNew={() => stopModal.open()} renderSubtext={s => <span style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block' }}>{s.regularExpressionActivationTrigger ? '⚡' : '📌'} Pattern: {s.pattern}</span>} emptyMessage="No stop patterns found." actionLabel="Delete" orderedListMode={false} />}
                {stopModal.isOpen && <StopPatternEditorModal isOpen={stopModal.isOpen} onClose={stopModal.close} onSave={stopModal.handleSave} existingStopPattern={stopModal.itemToEdit} />}
                {modals.budgetStrategyList.isOpen && <ManagerModal title="Budget Strategies" items={allBudgetStrategies} isOpen={modals.budgetStrategyList.isOpen} onClose={modals.budgetStrategyList.close} onSelect={s => budgetModal.open(s)} onDelete={budgetModal.handleDelete} onCreateNew={() => budgetModal.open()} renderSubtext={renderBudgetStrategySubtext} emptyMessage="No budget strategies found." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={selectedBudgetStrategyId || undefined} specialActionIcon="★" onSpecialAction={handleActivateBudgetStrategy} specialActionTooltip={s => selectedBudgetStrategyId === s.id ? `Deactivate ${s.name}` : `Activate ${s.name}`} />}
                {budgetModal.isOpen && <BudgetStrategyEditorModal isOpen={budgetModal.isOpen} onClose={budgetModal.close} onSave={budgetModal.handleSave} existingStrategy={budgetModal.itemToEdit} allModels={allModels} />}
                {modals.profileList.isOpen && <ManagerModal title="Profiles" items={allProfiles} isOpen={modals.profileList.isOpen} onClose={modals.profileList.close} onSelect={p => profileModal.open(p)} onDelete={deleteProfile} onCreateNew={() => profileModal.open()} renderSubtext={renderProfileSubtext} emptyMessage="No profiles found." actionLabel="Delete" orderedListMode={false} activeSpecialActionId={interactionData?.Profile?.id || undefined} specialActionIcon="★" onSpecialAction={handleActivateProfile} specialActionTooltip={p => interactionData?.Profile?.id === p.id ? `Deactivate ${p.name}` : `Activate ${p.name}`} />}
                {profileModal.isOpen && <ProfileEditorModal isOpen={profileModal.isOpen} onClose={profileModal.close} onSave={profileModal.handleSave} existingProfile={profileModal.itemToEdit} />}
                {modals.extList.isOpen && <ManagerModal title="Extensions" items={allExtensions} isOpen={modals.extList.isOpen} onClose={modals.extList.close} onSelect={undefined} onDelete={deleteExtension} onCreateNew={() => addToast('Create Extension Modal coming soon!', 'info')} renderSubtext={renderExtensionSubtext} emptyMessage="No extensions available." actionLabel="Delete" orderedListMode={true} currentOrderIds={(interactionData as any)?.extensions?.map((e: any) => e.id) || []} onToggleOrder={handleToggleExtension} />}

                {modals.settings.isOpen && <SettingsModal isOpen={modals.settings.isOpen} onClose={modals.settings.close} onOpenImportCharacterCard={modals.cardImport.open} onOpenAIRecommendation={modals.aiRecommendation.open} onOpenExportData={modals.exportData.open} onOpenImportData={modals.importData.open} onOpenParticipantControl={modals.participantControl.open} onOpenBudgetControl={modals.budgetControl.open} />}
                {modals.budgetControl.isOpen && <BudgetControlModal isOpen={modals.budgetControl.isOpen} onClose={modals.budgetControl.close} allBudgetStrategies={allBudgetStrategies} activeStrategy={activeStrategy} />}
                {modals.participantControl.isOpen && <ParticipantControlModal isOpen={modals.participantControl.isOpen} onClose={modals.participantControl.close} interactionData={interactionData} onUpdateInteractionData={(data) => { setInteractionData(data); interactionDataRef.current = data; saveRawInteractionData(data); }} onForceFirstMessage={handleForceFirstMessage} onSendCustomMessage={handleSendCustomMessage} onInjectCustomMessage={handleInjectCustomMessage} onInjectFirstMessage={handleInjectFirstMessage} />}
                {modals.aiRecommendation.isOpen && <AIRecommendationModal isOpen={modals.aiRecommendation.isOpen} onClose={modals.aiRecommendation.close} onSaveCharacter={saveCharacter} onSaveContext={saveContext} onSaveLocation={saveLocation} allSamplers={allSamplers} allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations} selectedModel={allModels.find(m => m.id === selectedModelId) || null} runningModels={runningModels} activeStrategy={activeStrategy} />}
                {modals.cardImport.isOpen && <CharacterCardImportModal isOpen={modals.cardImport.isOpen} onClose={modals.cardImport.close} onSaveCharacter={saveCharacter} onSaveContext={saveContext} allSamplers={allSamplers} />}
                {modals.exportData.isOpen && <DataExportModal isOpen={modals.exportData.isOpen} onClose={modals.exportData.close} />}
                {modals.importData.isOpen && <DataImportModal isOpen={modals.importData.isOpen} onClose={modals.importData.close} onImportComplete={handleImportComplete} />}
            </div>

            {/* ─── Action Menu ─── */}
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