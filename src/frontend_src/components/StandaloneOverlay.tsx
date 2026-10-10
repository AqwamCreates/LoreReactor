// frontend_src/components/StandaloneOverlay.tsx
import type React from 'react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { formatDisplayMessageText } from '../utilities/textDisplayFormatter';
import { compileMessageDisplayText } from '../utilities/messageDisplayCompiler';
import { getLocalMessageHistory } from '../utilities/timelineLogic';
import { computeSlashAutocomplete, applySlashSelection } from '../utilities/slashCommandLogic';
import { detectFormatSegments, buildCategoryConversionsWithLearning, applyConversions } from '../utilities/textDisplayReformatter';
import { StandaloneOverlayProfileEditor } from './StandaloneOverlayProfileEditor';
import { speechToTextEngine } from '../services/SpeechToTextEngine';
import type { 
    InteractionData, Character, Context, Location, AudioTrack, LanguageModel, 
    BudgetStrategy, Profile, World, Sampler, StopPattern, PromptBlock, Memory, 
    Account, MultiplayerData, ChatMessage, WhisperMessage 
} from '../types';
import { ActionMenu } from './ActionMenu';

type ActionWrap = '*' | '()' | 'none';
type ActionCase = 'first' | 'pascal' | 'lower';
type ActionPunctuation = '.' | '-' | 'none';

interface InterjectableAction { id: string; label: string; count: number; }

interface CompanionState {
    avatarUrl: string | null; charName: string; isUser: boolean; isLoading: boolean;
    streamingText: string; locationBackgroundUrl: string | null; allActions: InterjectableAction[];
    interactionData: InteractionData | null; localProtagonist: Character | null;
    selectedModelId?: string | null; selectedBudgetStrategyId?: string | null;
    activeProfileId?: string | null; lastMessageId?: string | null;
    allCharacters?: Character[]; allContexts?: Context[]; allLocations?: Location[];
    allAudioTracks?: AudioTrack[]; allWorlds?: World[]; allProfiles?: Profile[];
    allPromptBlocks?: PromptBlock[]; allLanguageModels?: LanguageModel[];
    allSamplers?: Sampler[]; allStopPatterns?: StopPattern[]; allBudgetStrategies?: BudgetStrategy[];
    allMemories?: Memory[]; allAccounts?: Account[]; allMultiplayerData?: MultiplayerData[];
    streamingCharacter?: Character | null;
}

export function StandaloneOverlay() {
    const containerRef = useRef<HTMLDivElement>(null);

    const [state, setState] = useState<CompanionState>({
        avatarUrl: null, charName: 'Companion', isUser: false, isLoading: false,
        streamingText: '', locationBackgroundUrl: null, allActions: [],
        interactionData: null, localProtagonist: null, streamingCharacter: null,
    });

    const [inputText, setInputText] = useState('');
    const [isInputFocused, setIsInputFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [activeSettingsModal, setActiveSettingsModal] = useState<'profile-list' | 'profile-edit' | 'model' | 'budget' | null>(null);
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    const [modalSearchQuery, setModalSearchQuery] = useState('');
    const settingsMenuRef = useRef<HTMLDivElement>(null);

    const [pendingFiles, setPendingFiles] = useState<{ name: string; base64: string }[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isRecording, setIsRecording] = useState(false);

    const [isEditing, setIsEditing] = useState(false);
    const [editDraft, setEditDraft] = useState('');
    const editTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [isReformatToggled, setIsReformatToggled] = useState(false);

    useEffect(() => {
        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.onmessage = (e: MessageEvent) => {
            if (e.data?.type === 'STATE_UPDATE' && e.data?.data) {
                setState((prev) => ({ ...prev, ...e.data.data }));
            }
        };
        channel.postMessage({ type: 'REQUEST_STATE' });
        return () => { channel.close(); };
    }, []);

    const chatMessages = useMemo(() => {
        if (!state.interactionData) return [];
        const targetChar = state.localProtagonist || state.interactionData.participants?.[0];
        if (!targetChar) return [];
        return getLocalMessageHistory(state.interactionData, targetChar, ['chat', 'whisper']) as (ChatMessage | WhisperMessage)[];
    }, [state.interactionData, state.localProtagonist]);

    const displayedMessage = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;

    const activeSpeaker: Character = useMemo(() => {
        if (state.isLoading) {
            if (state.streamingCharacter) return state.streamingCharacter;
            const found = state.interactionData?.participants?.find(p => p.name === state.charName)
                || state.allCharacters?.find(c => c.name === state.charName);
            if (found) return found;
            const protagonistId = state.localProtagonist?.id ?? state.interactionData?.protagonistIds?.[0];
            const companionChar = state.interactionData?.participants?.find(p => p.id !== protagonistId);
            if (companionChar) return companionChar;
        }

        if (displayedMessage) return displayedMessage.character;
        if (state.localProtagonist) return state.localProtagonist;
        if (state.interactionData?.participants?.[0]) return state.interactionData.participants[0];
        return {
            id: 'companion', name: state.charName, initiativeWeight: 1, chatProbability: 1,
            maximumChatStamina: 5, nameSensitivity: 1, chatImpatienceSensitivity: 1, skipProbability: 0,
            memoryRetentionWeight: 1, contextSensitivity: 1, maximumActionStamina: 5,
            numberOfMessagesToDisableThinkPrompt: 0, numberOfMessagesToDisableMetaThinkInstructions: 0,
            numberOfMessagesToDisableDialoguePrompt: 0, numberOfMessagesToDisableStarterPrompt: 0,
            tools: {} as any, clothings: [], knownCharacterNames: {}, textCharacterInjections: [],
            memories: {}, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
        };
    }, [
        displayedMessage, state.localProtagonist, state.interactionData, 
        state.charName, state.isLoading, state.streamingCharacter, state.allCharacters
    ]);

    const currentMessage: ChatMessage | WhisperMessage | null = useMemo(() => {
        if (state.isLoading) {
            return {
                id: state.lastMessageId || 'streaming', character: activeSpeaker,
                textContent: state.streamingText, messageType: 'chat',
                characterClothingWearingStatuses: {}, characterLockedLocations: {},
                firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
            } as ChatMessage;
        }
        return displayedMessage;
    }, [state.isLoading, state.streamingText, state.lastMessageId, activeSpeaker, displayedMessage]);

    const activeProfile = useMemo(() => {
        return state.allProfiles?.find(p => p.id === state.activeProfileId) || state.interactionData?.profile;
    }, [state.allProfiles, state.activeProfileId, state.interactionData?.profile]);

    const displayMode = activeProfile?.toolUsageDisplayMode ?? 'simple';
    const participants = state.interactionData?.participants || state.allCharacters || [];

    const compiledDialogueText = useMemo(() => {
        if (!currentMessage) return '';
        return compileMessageDisplayText(currentMessage, displayMode, participants);
    }, [currentMessage, displayMode, participants]);

    const targetMessageId = currentMessage?.id || state.lastMessageId || null;

    useEffect(() => {
        setIsReformatToggled(false);
        setIsEditing(false);
    }, [targetMessageId]);

    const handleStartEdit = useCallback(() => {
        if (!currentMessage) return;
        const textToEdit = ('processedTextContent' in currentMessage && currentMessage.processedTextContent)
            ? currentMessage.processedTextContent
            : ('textContent' in currentMessage ? currentMessage.textContent : '');
        setEditDraft(textToEdit);
        setIsEditing(true);
    }, [currentMessage]);

    const handleCancelEdit = useCallback(() => { setIsEditing(false); setEditDraft(''); }, []);

    const handleSaveEdit = useCallback(() => {
        if (!targetMessageId) return;
        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({ type: 'SAVE_EDIT', messageId: targetMessageId, text: editDraft });
        channel.close();
        setIsEditing(false);
    }, [targetMessageId, editDraft]);

    useEffect(() => {
        if (isEditing && editTextareaRef.current) {
            editTextareaRef.current.focus();
            editTextareaRef.current.setSelectionRange(editDraft.length, editDraft.length);
        }
    }, [isEditing, editDraft.length]);

    const { rawDisplay, reformattedDisplay, hasFormats } = useMemo(() => {
        if (!compiledDialogueText) return { rawDisplay: null, reformattedDisplay: null, hasFormats: false };
        const rawDisplay = formatDisplayMessageText(compiledDialogueText);
        const segments = detectFormatSegments(compiledDialogueText);
        const hasSegments = segments.some(s => s.category !== 'plain');
        const conversions = buildCategoryConversionsWithLearning(compiledDialogueText, segments);
        const conversionMap: Record<string, string> = {};
        for (const c of conversions) conversionMap[c.detected] = c.target;
        const reformattedText = applyConversions(compiledDialogueText, conversionMap as any);
        const actuallyChangesText = reformattedText !== compiledDialogueText;
        return {
            rawDisplay,
            reformattedDisplay: formatDisplayMessageText(reformattedText),
            hasFormats: hasSegments && actuallyChangesText,
        };
    }, [compiledDialogueText]);

    const displayedText = isReformatToggled && hasFormats ? reformattedDisplay : rawDisplay;
    const displayedSpeakerName = state.isLoading
        ? (state.streamingCharacter?.name || activeSpeaker.name || state.charName)
        : (currentMessage ? currentMessage.character.name : state.charName);

    const displayedAvatarUrl = state.isLoading
        ? (state.avatarUrl || activeSpeaker.images?.default || null)
        : (state.avatarUrl || currentMessage?.character.images?.default || null);

    const isMessageFromUser = useMemo(() => {
        if (state.isLoading) return false;
        if (currentMessage && state.localProtagonist) return currentMessage.character.id === state.localProtagonist.id;
        return state.isUser;
    }, [state.isLoading, currentMessage, state.localProtagonist, state.isUser]);

    const dialogueTextRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (dialogueTextRef.current && !isEditing) {
            dialogueTextRef.current.scrollTop = dialogueTextRef.current.scrollHeight;
        }
    }, [compiledDialogueText, state.isLoading, isReformatToggled, isEditing]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) setShowSettingsMenu(false);
        };
        if (showSettingsMenu) document.addEventListener('mousedown', handleClickOutside);
        return () => { document.removeEventListener('mousedown', handleClickOutside); };
    }, [showSettingsMenu]);

    const filteredProfiles = useMemo(() => {
        const q = modalSearchQuery.toLowerCase().trim();
        if (!q) return state.allProfiles || [];
        return (state.allProfiles || []).filter(p => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)));
    }, [state.allProfiles, modalSearchQuery]);

    const filteredModels = useMemo(() => {
        const q = modalSearchQuery.toLowerCase().trim();
        if (!q) return state.allLanguageModels || [];
        return (state.allLanguageModels || []).filter(m => m.name.toLowerCase().includes(q) || (m.backend && m.backend.toLowerCase().includes(q)));
    }, [state.allLanguageModels, modalSearchQuery]);

    const filteredBudgets = useMemo(() => {
        const q = modalSearchQuery.toLowerCase().trim();
        if (!q) return state.allBudgetStrategies || [];
        return (state.allBudgetStrategies || []).filter(b => b.name.toLowerCase().includes(q));
    }, [state.allBudgetStrategies, modalSearchQuery]);

    const [selectedIndex, setSelectedIndex] = useState(0);
    const [lastResetKey, setLastResetKey] = useState('');
    const autocompleteRef = useRef<HTMLDivElement>(null);

    const { breadcrumbs, options, isComplete, isSlash, activeIndex, currentQuery } = useMemo(() => {
        return computeSlashAutocomplete(
            inputText, state.interactionData, state.allCharacters, state.allContexts, state.allLocations,
            state.allAudioTracks, state.allWorlds, state.allProfiles || [], state.allPromptBlocks,
            state.allLanguageModels, state.allSamplers, state.allStopPatterns, state.allBudgetStrategies,
            state.allMemories, state.allAccounts, state.allMultiplayerData, state.localProtagonist,
        );
    }, [inputText, state.interactionData, state.allCharacters, state.allLocations, state.allContexts, state.allAudioTracks, state.allWorlds, state.allProfiles, state.allPromptBlocks, state.allLanguageModels, state.allSamplers, state.allStopPatterns, state.allBudgetStrategies, state.allMemories, state.allAccounts, state.allMultiplayerData, state.localProtagonist]);

    const showAutocomplete = isSlash && !isComplete;
    const autocompleteKey = useMemo(() => {
        if (!showAutocomplete) return '';
        return `${breadcrumbs.join('|')}|${options.length}|${activeIndex}`;
    }, [showAutocomplete, breadcrumbs, options.length, activeIndex]);

    if (autocompleteKey && autocompleteKey !== lastResetKey) {
        setLastResetKey(autocompleteKey);
        setSelectedIndex(0);
    } else if (!autocompleteKey && lastResetKey !== '') {
        setLastResetKey('');
    }

    useEffect(() => {
        if (!showAutocomplete) return;
        const list = autocompleteRef.current?.querySelector('.slash-autocomplete-list');
        const selected = list?.querySelector('.slash-autocomplete-item-selected');
        selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [showAutocomplete]);

    const handleApplySlashSelection = (opt: { value: string }) => {
        const updated = applySlashSelection(opt, inputText, activeIndex);
        setInputText(updated);
        inputRef.current?.focus();
    };

    const [actionMenuTarget, setActionMenuTarget] = useState<{ x: number; y: number } | null>(null);
    const [menuSearchQuery, setMenuSearchQuery] = useState('');
    const [showActionFormat, setShowActionFormat] = useState(false);
    const [actionWrap, setActionWrap] = useState<ActionWrap>('*');
    const [actionCase, setActionCase] = useState<ActionCase>('first');
    const [actionPunctuation, setActionPunctuation] = useState<ActionPunctuation>('.');
    const [isAutoFormat, setIsAutoFormat] = useState(false);

    const handleClose = useCallback(async () => {
        try { await getCurrentWebviewWindow().hide(); } catch {}
    }, []);

    const handleActivateProfile = useCallback((profileId: string) => {
        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({ type: 'ACTIVATE_PROFILE', profileId });
        channel.close();
    }, []);

    const handleEditProfile = useCallback((profile: Profile) => {
        setEditingProfile(profile);
        setActiveSettingsModal('profile-edit');
    }, []);

    const handleSaveProfile = useCallback((updatedProfile: Profile) => {
        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({ type: 'UPDATE_PROFILE', profile: updatedProfile });
        channel.close();
        setActiveSettingsModal('profile-list');
        setEditingProfile(null);
    }, []);

    const handleToggleMic = useCallback(async () => {
        if (isRecording) {
            await speechToTextEngine.stopRecording();
            setIsRecording(false);
        } else {
            const sttDevice = activeProfile?.speechToTextDeviceType ?? 'auto';
            speechToTextEngine.setDevicePreference(sttDevice);

            const started = await speechToTextEngine.startRecording(
                (text: string) => setInputText(prev => prev + (prev ? ' ' : '') + text)
            );
            if (started) setIsRecording(true);
        }
    }, [isRecording, activeProfile]);

    const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = () => {
                setPendingFiles(prev => [...prev, { name: file.name, base64: reader.result as string }]);
            };
            reader.readAsDataURL(file);
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const removeFile = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleSend = useCallback(() => {
        const trimmed = inputText.trim();
        if (!trimmed && pendingFiles.length === 0) return;
        if (state.isLoading) return;
        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({ type: 'SEND_MESSAGE', text: trimmed, files: pendingFiles });
        channel.close();
        setInputText('');
        setPendingFiles([]);
        setIsInputFocused(false);
        inputRef.current?.blur();
    }, [inputText, pendingFiles, state.isLoading]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (showAutocomplete) {
            if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
                e.preventDefault();
                if (options.length > 0) setSelectedIndex(prev => (prev + 1) % options.length);
                return;
            }
            if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                e.preventDefault();
                if (options.length > 0) setSelectedIndex(prev => (prev - 1 + options.length) % options.length);
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (options.length > 0 && options[selectedIndex]) handleApplySlashSelection(options[selectedIndex]);
                else handleSend();
                return;
            }
            if (e.key === 'Escape') { e.preventDefault(); setInputText(inputText.trimEnd()); return; }
            if (e.key === 'Backspace' && currentQuery === '' && activeIndex > 0) {
                e.preventDefault();
                const currentParts = inputText.trim().split(/\s+/).filter(p => p.length > 0);
                currentParts.pop();
                setInputText(currentParts.length > 0 ? `${currentParts.join(' ')} ` : '/');
                return;
            }
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
        if (e.key === 'Escape') { inputRef.current?.blur(); setIsInputFocused(false); }
    };

    const handleInterject = useCallback((label: string) => {
        if (state.isLoading) return;
        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({
            type: 'INTERJECT_ACTION', label,
            format: isAutoFormat ? undefined : { wrap: actionWrap, casing: actionCase, punctuation: actionPunctuation },
        });
        channel.close();
        setActionMenuTarget(null);
    }, [state.isLoading, isAutoFormat, actionWrap, actionCase, actionPunctuation]);

    const onAddAction = useCallback((label: string) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        setState((prev) => {
            if (prev.allActions.some((a) => a.label.toLowerCase() === trimmed.toLowerCase())) {
                return prev;
            }
            return {
                ...prev,
                allActions: [...prev.allActions, { id: `custom-${Date.now()}`, label: trimmed, count: 0 }]
            };
        });
        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({ type: 'ADD_ACTION', label: trimmed });
        channel.close();
    }, []);

    const onDeleteAction = useCallback((label: string) => {
        setState((prev) => ({ ...prev, allActions: prev.allActions.filter((a) => a.label !== label) }));
        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({ type: 'DELETE_ACTION', label });
        channel.close();
    }, []);

    const filteredActions = useMemo(() => {
        const query = menuSearchQuery.trim().toLowerCase();
        const actions = state.allActions || [];
        if (!query) return actions.slice().sort((a, b) => b.count - a.count);
        return actions.filter((a) => a.label.toLowerCase().includes(query)).sort((a, b) => b.count - a.count);
    }, [state.allActions, menuSearchQuery]);

    const activeProfileId = state.activeProfileId || null;
    const isLive = state.selectedModelId || state.selectedBudgetStrategyId;
    const statusLabel = state.isLoading ? 'Responding' : (isLive ? 'Live' : 'Idle');
    const statusColorClass = state.isLoading ? 'active' : (isLive ? '' : 'idle');

    return (
        <div ref={containerRef} className="pip-overlay-container" onClick={() => setActionMenuTarget(null)}>
            <div className="pip-header" data-tauri-drag-region>
                <div className="pip-header-title" data-tauri-drag-region><span>◆</span> LoreReactor</div>
                <div className="pip-header-actions">
                    <div className="pip-status-indicator">
                        <div className={`pip-status-dot ${statusColorClass}`} />
                        <span>{statusLabel}</span>
                    </div>
                    <button type="button" className="pip-inapp-close pip-settings-btn" onClick={() => setShowSettingsMenu(prev => !prev)} title="Settings">⚙️</button>
                    <button type="button" className="pip-inapp-close pip-close-btn" onClick={handleClose} title="Close Overlay">✕</button>
                </div>
            </div>

            {showSettingsMenu && (
                <div ref={settingsMenuRef} className="pip-settings-menu">
                    <div className="pip-settings-menu-item" onClick={() => { setActiveSettingsModal('profile-list'); setShowSettingsMenu(false); setModalSearchQuery(''); }}>
                        <span>👤</span> Profile
                    </div>
                    <div className="pip-settings-menu-item" onClick={() => { setActiveSettingsModal('model'); setShowSettingsMenu(false); setModalSearchQuery(''); }}>
                        <span>🤖</span> Model
                    </div>
                    <div className="pip-settings-menu-item" onClick={() => { setActiveSettingsModal('budget'); setShowSettingsMenu(false); setModalSearchQuery(''); }}>
                        <span>💰</span> Budget Strategy
                    </div>
                </div>
            )}

            <div className="pip-avatar-stage">
                {displayedAvatarUrl && state.locationBackgroundUrl && (
                    <>
                        <div className="pip-location-bg" />
                        <div className="pip-location-vignette" />
                    </>
                )}
                {displayedAvatarUrl ? (
                    <img
                        src={displayedAvatarUrl} alt={displayedSpeakerName} title="Click to interact"
                        className={`pip-avatar-img ${state.isLoading ? 'speaking' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setActionMenuTarget((prev) => prev ? null : { x: e.clientX, y: e.clientY }); }}
                    />
                ) : (
                    <div
                        className={`pip-anonymous-fullscreen ${state.isLoading ? 'speaking' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setActionMenuTarget((prev) => prev ? null : { x: e.clientX, y: e.clientY }); }}
                        title="Click to interact"
                    >
                        <div className="pip-anonymous-dots"><span /><span /><span /></div>
                    </div>
                )}
            </div>

            {actionMenuTarget && (
                <ActionMenu
                    actionMenuTarget={actionMenuTarget}
                    interactionDataExists={!!state.interactionData}
                    menuSearchQuery={menuSearchQuery}
                    setMenuSearchQuery={setMenuSearchQuery}
                    showActionFormat={showActionFormat}
                    setShowActionFormat={setShowActionFormat}
                    actionWrap={actionWrap}
                    setActionWrap={setActionWrap}
                    actionCase={actionCase}
                    setActionCase={setActionCase}
                    actionPunctuation={actionPunctuation}
                    setActionPunctuation={setActionPunctuation}
                    isAutoFormat={isAutoFormat}
                    setIsAutoFormat={setIsAutoFormat}
                    filteredActions={filteredActions}
                    isModelReady={true}
                    allCharacters={state.allCharacters || []}
                    localProtagonist={state.localProtagonist}
                    onAddAction={onAddAction}
                    onDeleteAction={onDeleteAction}
                    onActionInterject={handleInterject}
                />
            )}

            <div className="pip-content-spacer" />

            <div className="pip-dialogue-box">
                <div className={`pip-dialogue-name ${isMessageFromUser ? 'user' : ''}`}>{displayedSpeakerName}</div>
                <div className="pip-dialogue-actions">
                    {isEditing ? (
                        <>
                            <button type="button" className="pip-dialogue-action-btn" onClick={handleCancelEdit} title="Cancel Edit">✕</button>
                            <button type="button" className="pip-dialogue-action-btn pip-dialogue-action-btn-save" onClick={handleSaveEdit} title="Save Edit">💾</button>
                        </>
                    ) : (
                        <>
                            {!state.isLoading && (
                                <button className={`pip-dialogue-action-btn ${isReformatToggled ? 'pip-dialogue-action-btn-active' : ''}`} onClick={() => setIsReformatToggled(prev => !prev)} title={isReformatToggled ? "Revert to Raw Text" : "Apply Auto-Reformat"} disabled={!hasFormats}>✨</button>
                            )}
                            {state.isLoading ? (
                                <button className="pip-dialogue-action-btn pip-dialogue-action-btn-stop" onClick={() => { const c = new BroadcastChannel('lorereactor-companion-sync'); c.postMessage({ type: 'STOP_GENERATION' }); c.close(); }} title="Stop Generation">⏹</button>
                            ) : (
                                <button className="pip-dialogue-action-btn" onClick={() => { if (!targetMessageId) return; const c = new BroadcastChannel('lorereactor-companion-sync'); c.postMessage({ type: 'RESUME_GENERATION', messageId: targetMessageId }); c.close(); }} title="Resume Generation" disabled={!targetMessageId}>▶</button>
                            )}
                            {!state.isLoading && (
                                <button className="pip-dialogue-action-btn" onClick={() => { if (!targetMessageId) return; const c = new BroadcastChannel('lorereactor-companion-sync'); c.postMessage({ type: 'RESTART_GENERATION', messageId: targetMessageId }); c.close(); }} title="Regenerate Response" disabled={!targetMessageId}>↻</button>
                            )}
                            {!state.isLoading && (
                                <button className="pip-dialogue-action-btn" onClick={handleStartEdit} title="Edit Message" disabled={!targetMessageId}>✎</button>
                            )}
                        </>
                    )}
                </div>

                <div className={`pip-dialogue-text ${isEditing ? 'pip-dialogue-text-editing' : ''}`} ref={dialogueTextRef}>
                    {state.isLoading && !state.streamingText ? (
                        <div className="pip-thinking-dots"><span></span><span></span><span></span></div>
                    ) : isEditing ? (
                        <textarea ref={editTextareaRef} value={editDraft} onChange={e => setEditDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); handleCancelEdit(); } }} className="pip-edit-textarea" />
                    ) : displayedText ? (
                        displayedText
                    ) : (
                        <div className="pip-empty-state">Awaiting interaction...</div>
                    )}
                </div>
            </div>

            {!isEditing && (
                <>
                    {pendingFiles.length > 0 && (
                        <div className="pip-file-chips-container">
                            {pendingFiles.map((file, i) => (
                                <div key={i} className="pip-file-chip">
                                    <span className="pip-file-chip-name">📎 {file.name}</span>
                                    <button onClick={() => removeFile(i)} className="pip-file-chip-remove">×</button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="pip-input-trigger-zone" />
                    <div className={`pip-stealth-input-wrapper ${isInputFocused || showAutocomplete || pendingFiles.length > 0 || isRecording ? 'focused has-autocomplete' : ''}`}>
                        {showAutocomplete && (
                            <div ref={autocompleteRef} className="slash-autocomplete">
                                <div className="slash-autocomplete-breadcrumbs">
                                    {breadcrumbs.map((b, i) => (
                                        <span key={i} className="slash-breadcrumb">{b} {i < breadcrumbs.length - 1 && <span className="slash-breadcrumb-sep">›</span>}</span>
                                    ))}
                                </div>
                                <div className="slash-autocomplete-list">
                                    {options.length === 0 && (<div className="slash-autocomplete-no-results">Type any text, then press Enter to send</div>)}
                                    {options.map((opt, i) => (
                                        <div key={`${opt.type}-${opt.value}-${opt.id}-${i}`} className={`slash-autocomplete-item ${i === selectedIndex ? 'slash-autocomplete-item-selected' : ''}`}
                                            onMouseDown={(e) => { e.preventDefault(); handleApplySlashSelection(opt); }} onMouseEnter={() => setSelectedIndex(i)}>
                                            <span className="slash-autocomplete-label">{opt.label}</span>
                                            {opt.id && opt.id !== 'example' && <span className="slash-autocomplete-id">({opt.id})</span>}
                                            {opt.desc && <span className="slash-autocomplete-desc">{opt.desc}</span>}
                                        </div>
                                    ))}
                                </div>
                                <div className="slash-autocomplete-hint">
                                    <span><kbd>Tab</kbd> scroll</span><span><kbd>Enter</kbd> select</span><span><kbd>Esc</kbd> close</span>
                                </div>
                            </div>
                        )}
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="pip-input-icon-btn" title="Attach File" disabled={state.isLoading}>📎</button>
                        <input type="file" ref={fileInputRef} className="pip-hidden-file-input" onChange={handleFileSelected} multiple />
                        <input ref={inputRef} type="text" className="pip-stealth-input" placeholder="Say something or type / for commands" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} onFocus={() => setIsInputFocused(true)} onBlur={() => setIsInputFocused(false)} autoComplete="off" disabled={state.isLoading} />
                        <button type="button" onClick={handleToggleMic} className={`pip-input-icon-btn ${isRecording ? 'recording' : ''}`} title={isRecording ? "Stop Recording" : "Record Audio"} disabled={state.isLoading}>🎙️</button>
                    </div>
                </>
            )}

            {activeSettingsModal === 'profile-list' && (
                <div className="modal-overlay pip-modal-overlay" onClick={() => setActiveSettingsModal(null)}>
                    <div className="modal-content pip-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header pip-modal-header">
                            <h2 className="pip-modal-title">Select Profile</h2>
                            <button className="close-button pip-modal-close" onClick={() => setActiveSettingsModal(null)}>×</button>
                        </div>
                        <div className="pip-modal-search-wrapper">
                            <input type="text" className="pip-settings-search" placeholder="Search profiles..." value={modalSearchQuery} onChange={(e) => setModalSearchQuery(e.target.value)} autoFocus />
                        </div>
                        <div className="pip-settings-list pip-settings-list-wrapper">
                            {filteredProfiles.map(profile => (
                                <div key={profile.id} className={`pip-settings-item ${activeProfileId === profile.id ? 'selected' : ''}`} onClick={() => handleActivateProfile(profile.id)}>
                                    <div className="pip-settings-item-info">
                                        <div className="pip-settings-item-title">{profile.name}</div>
                                        {profile.description && <div className="pip-settings-item-sub">{profile.description}</div>}
                                    </div>
                                    <div className="pip-settings-item-actions">
                                        <button className="pip-settings-item-btn" onClick={(e) => { e.stopPropagation(); handleEditProfile(profile); }} title="Edit Profile (General)">✎</button>
                                    </div>
                                </div>
                            ))}
                            {filteredProfiles.length === 0 && (<div className="pip-modal-empty">No profiles found.</div>)}
                        </div>
                    </div>
                </div>
            )}

            {activeSettingsModal === 'profile-edit' && editingProfile && (
                <StandaloneOverlayProfileEditor profile={editingProfile} onClose={() => { setActiveSettingsModal('profile-list'); setEditingProfile(null); }} onSave={handleSaveProfile} />
            )}

            {activeSettingsModal === 'model' && (
                <div className="modal-overlay pip-modal-overlay" onClick={() => setActiveSettingsModal(null)}>
                    <div className="modal-content pip-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header pip-modal-header">
                            <h2 className="pip-modal-title">Select Model</h2>
                            <button className="close-button pip-modal-close" onClick={() => setActiveSettingsModal(null)}>×</button>
                        </div>
                        <div className="pip-modal-search-wrapper">
                            <input type="text" className="pip-settings-search" placeholder="Search models..." value={modalSearchQuery} onChange={(e) => setModalSearchQuery(e.target.value)} autoFocus />
                        </div>
                        <div className="pip-settings-list pip-settings-list-wrapper">
                            {filteredModels.map(m => (
                                <div key={m.id} className={`pip-settings-item ${state.selectedModelId === m.id ? 'selected' : ''}`} onClick={() => { const c = new BroadcastChannel('lorereactor-companion-sync'); const newId = state.selectedModelId === m.id ? '' : m.id; c.postMessage({ type: 'SELECT_MODEL', modelId: newId }); c.close(); }}>
                                    <div className="pip-settings-item-info">
                                        <div className="pip-settings-item-title">{m.name}</div>
                                        {m.backend && <div className="pip-settings-item-sub">{m.backend}</div>}
                                    </div>
                                </div>
                            ))}
                            {filteredModels.length === 0 && (<div className="pip-modal-empty">No models found.</div>)}
                        </div>
                    </div>
                </div>
            )}

            {activeSettingsModal === 'budget' && (
                <div className="modal-overlay pip-modal-overlay" onClick={() => setActiveSettingsModal(null)}>
                    <div className="modal-content pip-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header pip-modal-header">
                            <h2 className="pip-modal-title">Select Budget Strategy</h2>
                            <button className="close-button pip-modal-close" onClick={() => setActiveSettingsModal(null)}>×</button>
                        </div>
                        <div className="pip-modal-search-wrapper">
                            <input type="text" className="pip-settings-search" placeholder="Search budgets..." value={modalSearchQuery} onChange={(e) => setModalSearchQuery(e.target.value)} autoFocus />
                        </div>
                        <div className="pip-settings-list pip-settings-list-wrapper">
                            {filteredBudgets.map(b => (
                                <div key={b.id} className={`pip-settings-item ${state.selectedBudgetStrategyId === b.id ? 'selected' : ''}`} onClick={() => { const c = new BroadcastChannel('lorereactor-companion-sync'); const newId = state.selectedBudgetStrategyId === b.id ? '' : b.id; c.postMessage({ type: 'SELECT_BUDGET', budgetId: newId }); c.close(); }}>
                                    <div className="pip-settings-item-info">
                                        <div className="pip-settings-item-title">{b.name}</div>
                                    </div>
                                </div>
                            ))}
                            {filteredBudgets.length === 0 && (<div className="pip-modal-empty">No budgets found.</div>)}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}