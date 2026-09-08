// src/App.tsx
import type React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
import { saveRawInteractionData, loadRawInteractionData } from '../hooks/storage';
import { createChatMessage, addMessageToInteractionData } from '../hooks/chatLogic';
import { getDelayedDisplayName } from '../hooks/immersionLogic';
import { sentimentEngine } from '../services/SentimentAnalysisEngine';
import { ChatStatisticsBar } from './ChatStatisticsBar';
import { LanguageModelEngine } from '../services/LanguageModelEngine';
import { speechToTextEngine } from '../services/SpeechToTextEngine';
import { formatMessageText } from '../utilities/textFormatter';
import { cloudBackends } from '../languageModelInformation';
import type { Character, Context, Sampler, LanguageModel, BudgetStrategy, InteractionData } from '../types';
import { useChatRestoration } from '../hooks/useChatRestoration';
import { useEntitySync } from '../hooks/useEntitySync';
import { useActionMenu } from '../hooks/useActionMenu';
import { useMessageActions } from '../hooks/useMessageActions';
import { useChatOperations } from '../hooks/useChatOperations';
import { useEntityToggles } from '../hooks/useEntityToggles';
import { useCinematicMode } from '../hooks/useCinematicMode';
import { useMessageToolbar } from '../hooks/useMessageToolbar';
import { useModalVisibility } from '../hooks/useModalVisibility';
import { useActiveExtensions } from '../hooks/useActiveExtensions';
import { MessageBubble } from './MessageBubble';
import { StreamingIndicators } from './StreamingIndicators';
import { ActionMenu } from './ActionMenu';
import { AppModals } from './AppModals';
import { ChatInput } from './ChatInput';
import { ContextBar } from './ContextBar';
import { LoadingScreen } from './LoadingScreen';
import './main.css';

const STORAGE_KEY_ACTIVE_CHAT = 'loreReactor_activeChatId';
const STORAGE_KEY_BUDGET_STRATEGY = 'loreReactor_selectedBudgetStrategyId';
const STORAGE_KEY_DEFAULT_CHARACTER = 'loreReactor_defaultCharacterId';
const STORAGE_KEY_SELECTED_MODEL = 'loreReactor_selectedModelId';
const MIN_LOADING_SCREEN_MS = 900;

interface LoadStep { id: string; label: string; icon: string; done: boolean }
type BudgetStrategyWithRawModelIds = BudgetStrategy & {
    _rawOnlineModelIds?: string[];
    _rawLocalModelIds?: string[];
};

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
    const { extensions: allExtensions, deleteExtension } = useExtensionManager();
    const { profiles: allProfiles, isLoading: profilesLoading, saveProfile, deleteProfile } = useProfileManager();

    // ─── Active Extensions ───────────────────────────────────────────
    const { activeIds: activeExtensionIds } = useActiveExtensions(allExtensions);
    const [activeExtensionIdsState, setActiveExtensionIdsState] = useState<string[]>(activeExtensionIds);
    useEffect(() => {
        const syncActiveExtensionIds = setTimeout(() => {
            setActiveExtensionIdsState(activeExtensionIds);
        }, 0);
        return () => clearTimeout(syncActiveExtensionIds);
    }, [activeExtensionIds]);

    // ─── Entity Modals ───────────────────────────────────────────────
    const charModal = useEntityModal<Character>(saveCharacter, deleteCharacter, 'Character');
    const contextModal = useEntityModal<Context>(saveContext, deleteContext, 'Context');
    const locationModal = useEntityModal(saveLocation, deleteLocation, 'Location');
    const stopModal = useEntityModal(saveStopPattern, deleteStopPattern, 'Stop Pattern');
    const modelModal = useEntityModal<LanguageModel>(saveModel, deleteModel, 'Model');
    const budgetModal = useEntityModal<BudgetStrategy>(saveBudgetStrategy, deleteBudgetStrategy, 'Budget Strategy');
    const profileModal = useEntityModal(saveProfile, deleteProfile, 'Profile');

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
    const initialImageProcessedChatIdRef = useRef<string | null>(null);

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

    const isModelReady = useMemo(() => {
        if (activeStrategy) return true;
        if (!selectedModelId) return false;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend)) return true;
        return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle === true;
    }, [selectedModelId, allModels, runningModels, activeStrategy]);

    const {
        actionMenuTarget, menuSearchQuery, setMenuSearchQuery,
        actionsLoading, showActionFormat, setShowActionFormat,
        actionWrap, setActionWrap, actionCase, setActionCase, actionPunctuation, setActionPunctuation,
        handleAddAction, handleDeleteAction, handleActionInterject,
        getFilteredActions, handleAvatarClick, closeActionMenu,
    } = useActionMenu({
        interactionData, currentCharacter, isLoading, isModelReady,
        allCharacters, stopGeneration, sendActionAndGetResponse, addToast,
    });

    const {
        editingId, editDraft, setEditDraft, massDeleteId, setMassDeleteId,
        handleSaveEdit, handleRegenerateFromEdit, handleDelete, handleMassDeleteConfirm,
        handleBranch, handleClone, handleCopyText, startEditing, cancelEditing,
    } = useMessageActions({
        interactionData, currentCharacter, isModelReady, isLoading,
        setInteractionData, setCurrentCharacter, refreshChatList,
        regenerateFromMessage, addToast,
    });

    const {
        isEditingTitle, editTitleValue, setEditTitleValue,
        handleSwitchChat, handleNewChat, handleDeleteChat,
        handleStartEditTitle, handleSaveTitle, cancelEditTitle,
    } = useChatOperations({
        interactionData, currentCharacter, defaultCharacterId,
        allCharacters, allChats, setInteractionData, setCurrentCharacter,
        refreshChatList, startNewChat, deleteChatFromList, addToast,
    });

    const {
        handleToggleParticipant, handleToggleContext, handleToggleLocation,
        handleSetChatProtagonist, handleToggleExtension,
        handleActivateBudgetStrategy, handleActivateProfile,
    } = useEntityToggles({
        interactionData, allCharacters,
        activeExtensionIds: activeExtensionIdsState,
        setActiveExtensionIds: setActiveExtensionIdsState,
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
    const isModelLoading = useMemo(() => {
        if (!selectedModelId) return false;
        const selectedModel = allModels.find(m => m.id === selectedModelId);
        if (selectedModel?.apiKey && selectedModel.backend && cloudBackends.includes(selectedModel.backend)) return false;
        return runningModels[selectedModelId]?.isRunning === true && runningModels[selectedModelId]?.isIdle !== true;
    }, [selectedModelId, allModels, runningModels]);

    const modelStatusMessage = !selectedModelId ? 'No model selected — open Models to load one' : isModelLoading ? 'Model is warming up... please wait' : '';
    const isMassActive = massDeleteId !== null;
    const massStartIndex = isMassActive && interactionData ? InteractionMessages.findIndex(m => m.id === massDeleteId) : -1;
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
        const strategyWithRawModelIds = activeStrategy as BudgetStrategyWithRawModelIds;
        const savedOnlineIds = strategyWithRawModelIds._rawOnlineModelIds || activeStrategy.onlineModels.map((m: LanguageModel) => m.id);
        const freshOnlineModels: LanguageModel[] = [];
        for (const mid of savedOnlineIds) { const fresh = allModels.find(x => x.id === mid); if (fresh) freshOnlineModels.push(fresh); }
        if (freshOnlineModels.length !== activeStrategy.onlineModels.length || freshOnlineModels.some((m, i) => m.id !== activeStrategy.onlineModels[i]?.id)) { updatedStrat.onlineModels = freshOnlineModels; stratChanged = true; }
        const savedLocalIds = strategyWithRawModelIds._rawLocalModelIds || activeStrategy.localModels.map((m: LanguageModel) => m.id);
        const freshLocalModels: LanguageModel[] = [];
        for (const mid of savedLocalIds) { const fresh = allModels.find(x => x.id === mid); if (fresh) freshLocalModels.push(fresh); }
        if (freshLocalModels.length !== activeStrategy.localModels.length || freshLocalModels.some((m, i) => m.id !== activeStrategy.localModels[i]?.id)) { updatedStrat.localModels = freshLocalModels; stratChanged = true; }
        if (stratChanged) setActiveBudgetStrategy(updatedStrat);
    }, [activeStrategy, allModels, setActiveBudgetStrategy]);

    // Process protagonist image on new/restored chat
    useEffect(() => {
        if (interactionData && currentCharacter && interactionData.id !== initialImageProcessedChatIdRef.current) {
            const chatId = interactionData.id;
            processProtagonistImageSilently(interactionData, currentCharacter).then(() => {
                initialImageProcessedChatIdRef.current = chatId;
            });
        }
    }, [currentCharacter, interactionData, processProtagonistImageSilently]);

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
        if (!allDone || !activeChatRestored || !interactionData) return;
        const loadingStartedAt = loadingStartedAtRef.current ?? Date.now();
        loadingStartedAtRef.current = loadingStartedAt;
        const remaining = Math.max(0, MIN_LOADING_SCREEN_MS - (Date.now() - loadingStartedAt));
        const hold = setTimeout(() => { setIsFadeOut(true); const fade = setTimeout(() => { setIsInitializing(false); setIsFadeOut(false); }, 300); return () => clearTimeout(fade); }, remaining);
        return () => clearTimeout(hold);
    }, [loadSteps, isInitializing, activeChatRestored, interactionData]);

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
        let isCancelled = false;
        (async () => {
            if (activeStrategy) {
                if (!isCancelled) setMaximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens(0);
                return;
            }
            const participantCounts: Record<string, number> = {};
            for (const p of interactionData.participants) participantCounts[p.id] = 0;
            if (interactionData.protagonist && participantCounts[interactionData.protagonist.id] === undefined) participantCounts[interactionData.protagonist.id] = 0;
            const selectedModel = allModels.find(m => m.id === selectedModelId);
            const runtimePort = selectedModelId ? runningModels[selectedModelId]?.port : undefined;
            const modelContext = selectedModel ? { apiKey: selectedModel.apiKey, backend: selectedModel.backend, modelPath: typeof selectedModel.parameters?.modelPath === 'string' ? selectedModel.parameters.modelPath : undefined, runtimePort } : undefined;
            for (const msg of InteractionMessages) {
                if (msg.character && msg.textContent) {
                    const charId = msg.character.id;
                    if (participantCounts[charId] !== undefined || charId === '__ambient_narrator__') {
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

    const handleForceFirstMessage = useCallback(async (character: Character) => {
        if (!interactionData) return;
        const chatMessage = createChatMessage(interactionData, character, `*${character.name} enters the scene.*`);
        const updated = addMessageToInteractionData(interactionData, chatMessage);
        setInteractionData(updated); interactionDataRef.current = updated;
        await saveRawInteractionData(updated); addToast(`Sent first message as ${character.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleSendCustomMessage = useCallback(async (character: Character, text: string) => {
        if (!interactionData) return;
        const chatMessage = createChatMessage(interactionData, character, text);
        const updated = addMessageToInteractionData(interactionData, chatMessage);
        setInteractionData(updated); interactionDataRef.current = updated;
        await saveRawInteractionData(updated); addToast(`Sent message as ${character.name}`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleInjectCustomMessage = useCallback(async (character: Character, text: string) => {
        if (!interactionData) return;
        const injectedContext: Context = {
            id: crypto.randomUUID(),
            name: `[Injected] ${character.name}`,
            description: 'User-injected message for LLM context',
            text: `${character.name}: ${text}`,
            isAutoGenerated: true,
            useBase64Encoding: false,
            insertionDepth: 0,
            tokenBudget: 512,
            limitLinksToSubdirectory: false,
            firstCreatedTimestamp: Date.now(),
            lastUpdatedTimestamp: Date.now(),
        };
        const updated: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), injectedContext], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updated); interactionDataRef.current = updated;
        await saveRawInteractionData(updated); addToast(`Injected custom message as ${character.name} into LLM context`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    const handleInjectFirstMessage = useCallback(async (character: Character) => {
        if (!interactionData) return;
        const injectedContext: Context = {
            id: crypto.randomUUID(),
            name: `[Injected First] ${character.name}`,
            description: 'User-injected first message for LLM context',
            text: `${character.name}: *${character.name} enters the scene.*`,
            isAutoGenerated: true,
            useBase64Encoding: false,
            insertionDepth: 0,
            tokenBudget: 512,
            limitLinksToSubdirectory: false,
            firstCreatedTimestamp: Date.now(),
            lastUpdatedTimestamp: Date.now(),
        };
        const updated: InteractionData = { ...interactionData, contexts: [...(interactionData.contexts || []), injectedContext], lastUpdatedTimestamp: Date.now() };
        setInteractionData(updated); interactionDataRef.current = updated;
        await saveRawInteractionData(updated); addToast(`Injected first message as ${character.name} into LLM context`, 'success');
    }, [interactionData, addToast, setInteractionData]);

    // ─── Delete chat wrapper for AppModals ───────────────────────────
    const onDeleteChatForModals = useCallback((id: string) => {
        handleDeleteChat({ stopPropagation: () => {} } as React.MouseEvent, id);
    }, [handleDeleteChat]);

    // ─── Branch source navigation ────────────────────────────────────
    const handleNavigateToBranchSource = useCallback(async () => {
        if (!interactionData?.parentInteractionDataId) return;
        try {
            const source = await loadRawInteractionData(interactionData.parentInteractionDataId, allCharacters);
            if (source) {
                setInteractionData(source);
                interactionDataRef.current = source;
                if (source.protagonist) setCurrentCharacter(source.protagonist);
                refreshChatList();
                addToast(`Returned to source: "${source.name}"`, 'info');
            } else {
                addToast('Source chat not found.', 'error');
            }
        } catch {
            addToast('Failed to load source chat.', 'error');
        }
    }, [interactionData, allCharacters, setInteractionData, setCurrentCharacter, refreshChatList, addToast]);

    // ─── Render ──────────────────────────────────────────────────────
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
                    {viewMode === 'cinematic' && centerAvatar && portraitUrlCache.get(`cinematic:${centerAvatar.id}`) && (
                        <div className="cinematic-stage active" onClick={e => { e.stopPropagation(); handleAvatarClick(e, centerAvatar.id || 'cinematic-bg', centerAvatar); }} title="Click character to interject action">
                            <img src={portraitUrlCache.get(`cinematic:${centerAvatar.id}`)!} alt={centerAvatar.name} className="cinematic-avatar-img" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        </div>
                    )}

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
                        {viewMode === 'cinematic' && <StreamingIndicators isLoading={isLoading} streamingCharacter={streamingCharacter} streamingText={streamingText} formattedStreamingText={formattedStreamingText} viewMode={viewMode} currentCharacterId={currentCharacter?.id} streamingPortraitUrl={streamingPortraitUrl} interactionData={interactionData} messagesLength={InteractionMessages.length} onAvatarClick={handleAvatarClick} />}
                        {displayMessages.map((message, renderIndex) => {
                            const index = viewMode === 'cinematic' ? InteractionMessages.length - 1 - renderIndex : renderIndex;
                            if (!message.character) return null;
                            const dn = getDelayedDisplayName(interactionData, index, message.character.id);
                            const stem = isStemMessage(message.id);
                            const branchOffIndex = interactionData.parentInteractionMessageId ? InteractionMessages.findIndex(m => m.id === interactionData.parentInteractionMessageId) : -1;
                            const beforeBranch = !!(interactionData.parentInteractionMessageId && index === branchOffIndex);
                            const messagePortraitUrl = portraitUrlCache.get(message.id) ?? null;
                            return (
                                <MessageBubble key={message.id} message={message} index={index} viewMode={viewMode} currentCharacterId={currentCharacter?.id} editingId={editingId} editDraft={editDraft} massDeleteId={massDeleteId} isMassActive={isMassActive} massStartIndex={massStartIndex} activeToolbarId={activeToolbarId} portraitUrl={messagePortraitUrl} displayName={dn} isStem={stem} beforeBranch={beforeBranch} isModelReady={isModelReady} isLoading={isLoading} onAvatarClick={handleAvatarClick} onStartEditing={startEditing} onCancelEditing={cancelEditing} onSaveEdit={handleSaveEdit} onRegenerateFromEdit={handleRegenerateFromEdit} onResumeGeneration={resumeGeneration} onCopyText={handleCopyText} onRegenerateFromMessage={regenerateFromMessage} onBranch={handleBranch} onClone={handleClone} onDelete={handleDelete} onSetMassDelete={setMassDeleteId} onMassDeleteConfirm={handleMassDeleteConfirm} onCancelMassDelete={() => setMassDeleteId(null)} onTouchStart={handleBubbleTouchStart} onTouchEnd={handleBubbleTouchEnd} onTouchMove={handleBubbleTouchMove} suppressNextClickRef={suppressNextClickRef} editTextareaRef={editTextareaRef} setEditDraft={setEditDraft} onNavigateToBranchSource={handleNavigateToBranchSource} />
                            );
                        })}
                        {viewMode === 'ladder' && <StreamingIndicators isLoading={isLoading} streamingCharacter={streamingCharacter} streamingText={streamingText} formattedStreamingText={formattedStreamingText} viewMode={viewMode} currentCharacterId={currentCharacter?.id} streamingPortraitUrl={streamingPortraitUrl} interactionData={interactionData} messagesLength={InteractionMessages.length} onAvatarClick={handleAvatarClick} />}
                        {InteractionMessages.length === 0 && <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}><p>Add characters to the chat and start chatting.</p></div>}
                        <div ref={messageEndRef} style={{ height: '1px' }} />
                    </div>

                    <ContextBar viewMode={viewMode} onOpenChatList={modals.chatList.open} onOpenCharacters={modals.charList.open} onOpenContexts={modals.contextList.open} onOpenLocations={modals.locationList.open} onOpenModels={modals.modelList.open} onOpenSamplers={modals.samplerList.open} onOpenStopPatterns={modals.stopList.open} onOpenBudgets={modals.budgetStrategyList.open} onOpenProfiles={modals.profileList.open} />

                    <ChatInput inputText={inputText} setInputText={setInputText} pendingFiles={pendingFiles} setPendingFiles={setPendingFiles} isRecording={isRecording} isLoading={isLoading} isModelReady={isModelReady} isModelLoading={isModelLoading} modelStatusMessage={modelStatusMessage} currentCharacterName={currentCharacter?.name} activeStrategy={activeStrategy} selectedModelId={selectedModelId} fileInputRef={fileInputRef} textareaRef={textareaRef} onFileSelected={handleFileSelected} onToggleMicrophone={handleToggleMicrophone} onSend={handleSend} onStopGeneration={stopGeneration} onOpenModels={modals.modelList.open} />
                </>}

                <AppModals
                    modals={modals as unknown as Record<string, { isOpen: boolean; open: () => void; close: () => void }>}
                    allChats={allChats} allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations} allSamplers={allSamplers} allStopPatterns={allStopPatterns} allModels={allModels} allBudgetStrategies={allBudgetStrategies} allProfiles={allProfiles} allExtensions={allExtensions} runningModels={runningModels} samplerToEdit={samplerToEdit} charModal={charModal} contextModal={contextModal} locationModal={locationModal} stopModal={stopModal} modelModal={modelModal} budgetModal={budgetModal} profileModal={profileModal} onSwitchChat={handleSwitchChat} onDeleteChat={onDeleteChatForModals} onNewChat={handleNewChat} onDeleteCharacter={deleteCharacter} onLoadFullCharacter={loadFullCharacter} onToggleParticipant={handleToggleParticipant} onSetProtagonist={handleSetChatProtagonist} onDeleteContext={contextModal.handleDelete} onToggleContext={handleToggleContext} onDeleteLocation={locationModal.handleDelete} onToggleLocation={handleToggleLocation} onDeleteModel={deleteModel} onToggleModelLoad={toggleModelLoad} onDeleteSampler={deleteSampler} onSaveSampler={handleSaveSampler} onOpenSamplerEditor={handleOpenSamplerEditor} onDeleteStopPattern={stopModal.handleDelete} onDeleteBudgetStrategy={budgetModal.handleDelete} onActivateBudgetStrategy={handleActivateBudgetStrategy} onDeleteProfile={deleteProfile} onActivateProfile={handleActivateProfile} onDeleteExtension={deleteExtension} onToggleExtension={handleToggleExtension} onUpdateInteractionData={(data) => { setInteractionData(data); interactionDataRef.current = data; saveRawInteractionData(data); }} onForceFirstMessage={handleForceFirstMessage} onSendCustomMessage={handleSendCustomMessage} onInjectCustomMessage={handleInjectCustomMessage} onInjectFirstMessage={handleInjectFirstMessage} onSaveCharacter={saveCharacter} onSaveContext={saveContext} onSaveLocation={saveLocation} onImportComplete={handleImportComplete} addToast={addToast}
                />
            </div>

            <ActionMenu actionMenuTarget={actionMenuTarget} interactionDataExists={!!interactionData} menuSearchQuery={menuSearchQuery} setMenuSearchQuery={setMenuSearchQuery} showActionFormat={showActionFormat} setShowActionFormat={setShowActionFormat} actionWrap={actionWrap} setActionWrap={setActionWrap} actionCase={actionCase} setActionCase={setActionCase} actionPunctuation={actionPunctuation} setActionPunctuation={setActionPunctuation} filteredActions={getFilteredActions()} isModelReady={isModelReady} allCharacters={allCharacters} onAddAction={handleAddAction} onDeleteAction={handleDeleteAction} onActionInterject={handleActionInterject} />
        </>
    );
}

export default App;