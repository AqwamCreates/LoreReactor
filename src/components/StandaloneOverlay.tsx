// src/components/StandaloneOverlay.tsx
import type React from 'react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { formatDisplayMessageText } from '../utilities/textDisplayFormatter';
import { computeSlashAutocomplete, applySlashSelection } from '../utilities/slashCommandLogic';
import { detectFormatSegments, buildCategoryConversionsWithLearning, applyConversions } from '../utilities/textDisplayReformatter';
import { StandaloneOverlayProfileEditor } from './StandaloneOverlayProfileEditor';
import { speechToTextEngine } from '../services/SpeechToTextEngine';
import type { InteractionData, Character, LanguageModel, BudgetStrategy, Profile, World, Sampler, StopPattern, PromptBlock, Memory } from '../types';

type ActionWrap = '*' | '()' | 'none';
type ActionCase = 'first' | 'pascal' | 'lower';
type ActionPunctuation = '.' | '-' | 'none';

interface InterjectableAction {
    id: string;
    label: string;
    count: number;
}

interface CompanionState {
    avatarUrl: string | null;
    charName: string;
    activeText: string;
    isUser: boolean;
    isLoading: boolean;
    streamingText: string;
    locationBackgroundUrl: string | null;
    allActions: InterjectableAction[];
    interactionData: InteractionData | null;
    localProtagonist: Character | null;
    allModels?: LanguageModel[];
    selectedModelId?: string | null;
    allBudgetStrategies?: BudgetStrategy[];
    selectedBudgetStrategyId?: string | null;
    allProfiles?: Profile[];
    activeProfileId?: string | null;
    lastMessageId?: string | null;
    allWorlds?: World[];
    allSamplers?: Sampler[];
    allStopPatterns?: StopPattern[];
    allPromptBlocks?: PromptBlock[];
    allMemories?: Memory[];
}

export function StandaloneOverlay() {
    const [state, setState] = useState<CompanionState>({
        avatarUrl: null,
        charName: 'Companion',
        activeText: '',
        isUser: false,
        isLoading: false,
        streamingText: '',
        locationBackgroundUrl: null,
        allActions: [],
        interactionData: null,
        localProtagonist: null,
    });

    const [inputText, setInputText] = useState('');
    const [isInputFocused, setIsInputFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // ─── Settings & Modal States ────────────────────────────────────
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [activeSettingsModal, setActiveSettingsModal] = useState<'profile-list' | 'profile-edit' | 'model' | 'budget' | null>(null);
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    const [modalSearchQuery, setModalSearchQuery] = useState('');
    const settingsMenuRef = useRef<HTMLDivElement>(null);

    const [pendingFiles, setPendingFiles] = useState<{ name: string; base64: string }[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ─── Voice Recording State ──────────────────────────────────────
    const [isRecording, setIsRecording] = useState(false);

    // ─── Single-Message Reformat Toggle State ───────────────────────
    const [isReformatToggled, setIsReformatToggled] = useState(false);
    const prevMessageIdRef = useRef<string | null | undefined>(undefined);

    // Auto-reset the toggle when a new message starts streaming or we switch chats
    useEffect(() => {
        const currentId = state.lastMessageId;
        const prevId = prevMessageIdRef.current;

        if (prevId !== undefined && prevId !== currentId) {
            if (prevId !== null && currentId === null) {
                setIsReformatToggled(false);
            } else if (prevId !== null && currentId !== null && prevId !== currentId) {
                setIsReformatToggled(false);
            }
        }
        
        prevMessageIdRef.current = currentId;
    }, [state.lastMessageId]);

    // ─── Auto-Scroll Dialogue Text ──────────────────────────────────
    const dialogueTextRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (dialogueTextRef.current) {
            dialogueTextRef.current.scrollTop = dialogueTextRef.current.scrollHeight;
        }
    }, [state.activeText, state.isLoading, isReformatToggled]);

    // Close settings menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
                setShowSettingsMenu(false);
            }
        };
        if (showSettingsMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showSettingsMenu]);

    // ─── Modal Search Filters ───────────────────────────────────────
    const filteredProfiles = useMemo(() => {
        const q = modalSearchQuery.toLowerCase().trim();
        if (!q) return state.allProfiles || [];
        return (state.allProfiles || []).filter(p =>
            p.name.toLowerCase().includes(q) ||
            (p.description && p.description.toLowerCase().includes(q))
        );
    }, [state.allProfiles, modalSearchQuery]);

    const filteredModels = useMemo(() => {
        const q = modalSearchQuery.toLowerCase().trim();
        if (!q) return state.allModels || [];
        return (state.allModels || []).filter(m =>
            m.name.toLowerCase().includes(q) ||
            (m.backend && m.backend.toLowerCase().includes(q))
        );
    }, [state.allModels, modalSearchQuery]);

    const filteredBudgets = useMemo(() => {
        const q = modalSearchQuery.toLowerCase().trim();
        if (!q) return state.allBudgetStrategies || [];
        return (state.allBudgetStrategies || []).filter(b =>
            b.name.toLowerCase().includes(q)
        );
    }, [state.allBudgetStrategies, modalSearchQuery]);

    // ─── Slash Autocomplete State ────────────────────────────────────
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [lastResetKey, setLastResetKey] = useState('');
    const autocompleteRef = useRef<HTMLDivElement>(null);

    const { breadcrumbs, options, isComplete, isSlash, activeIndex, currentQuery } = useMemo(() => {
        return computeSlashAutocomplete(
            inputText,
            state.interactionData,
            state.interactionData?.participants || [],
            state.interactionData?.locations || [],
            state.interactionData?.contexts || [],
            state.interactionData?.audioTracks || [],
            state.allWorlds || [],
            state.allModels || [],
            state.allProfiles || [],
            state.allBudgetStrategies || [],
            state.allSamplers || [],
            state.allStopPatterns || [],
            state.allPromptBlocks || [],
            state.allMemories || [],
            state.localProtagonist
        );
    }, [
        inputText,
        state.interactionData,
        state.allWorlds,
        state.allModels,
        state.allProfiles,
        state.allBudgetStrategies,
        state.allSamplers,
        state.allStopPatterns,
        state.allPromptBlocks,
        state.allMemories,
        state.localProtagonist
    ]);

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

    // ─── ActionMenu State & Cursor Target ────────────────────────────
    const [actionMenuTarget, setActionMenuTarget] = useState<{ x: number; y: number } | null>(null);
    const [menuSearchQuery, setMenuSearchQuery] = useState('');
    const [showActionFormat, setShowActionFormat] = useState(false);

    const [actionWrap, setActionWrap] = useState<ActionWrap>('*');
    const [actionCase, setActionCase] = useState<ActionCase>('first');
    const [actionPunctuation, setActionPunctuation] = useState<ActionPunctuation>('.');
    const [isAutoFormat, setIsAutoFormat] = useState(false);

    // ─── Listen for Real-Time State Sync from Main Window ───────────
    useEffect(() => {
        const channel = new BroadcastChannel('lorereactor-companion-sync');

        channel.onmessage = (e: MessageEvent) => {
            if (e.data?.type === 'STATE_UPDATE' && e.data?.data) {
                setState((prev) => ({
                    ...prev,
                    ...e.data.data,
                }));
            }
        };

        channel.postMessage({ type: 'REQUEST_STATE' });

        return () => {
            channel.close();
        };
    }, []);

    // ─── Native Window Close ─────────────────────────────────────────
    const handleClose = useCallback(async () => {
        try {
            const win = getCurrentWebviewWindow();
            await win.hide();
        } catch {
            window.close();
        }
    }, []);

    // ─── Profile Actions ────────────────────────────────────────────
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

    // ─── Voice Recording Handlers ───────────────────────────────────
    const handleToggleMic = useCallback(async () => {
        if (isRecording) {
            await speechToTextEngine.stopRecording();
            setIsRecording(false);
        } else {
            const started = await speechToTextEngine.startRecording(
                (text: string) => setInputText(prev => prev + (prev ? ' ' : '') + text)
            );
            if (started) {
                setIsRecording(true);
            }
        }
    }, [isRecording]);

    // ─── File Attachment Handlers ───────────────────────────────────
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

    // ─── Stealth Chat Send ───────────────────────────────────────────
    const handleSend = useCallback(() => {
        const trimmed = inputText.trim();
        if (!trimmed && pendingFiles.length === 0) return;
        if (state.isLoading) return;

        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({
            type: 'SEND_MESSAGE',
            text: trimmed,
            files: pendingFiles
        });
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
                if (options.length > 0) {
                    setSelectedIndex(prev => (prev + 1) % options.length);
                }
                return;
            }
            if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                e.preventDefault();
                if (options.length > 0) {
                    setSelectedIndex(prev => (prev - 1 + options.length) % options.length);
                }
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (options.length > 0 && options[selectedIndex]) {
                    handleApplySlashSelection(options[selectedIndex]);
                } else {
                    handleSend();
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setInputText(inputText.trimEnd());
                return;
            }
            if (e.key === 'Backspace' && currentQuery === '' && activeIndex > 0) {
                e.preventDefault();
                const currentParts = inputText.trim().split(/\s+/).filter(p => p.length > 0);
                currentParts.pop();
                setInputText(currentParts.length > 0 ? `${currentParts.join(' ')} ` : '/');
                return;
            }
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        if (e.key === 'Escape') {
            inputRef.current?.blur();
            setIsInputFocused(false);
        }
    };

    // ─── Action Interjection Handlers ────────────────────────────────
    const handleInterject = useCallback((label: string) => {
        if (state.isLoading) return;

        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({
            type: 'INTERJECT_ACTION',
            label,
            format: isAutoFormat ? undefined : { wrap: actionWrap, casing: actionCase, punctuation: actionPunctuation },
        });
        channel.close();

        setActionMenuTarget(null);
    }, [state.isLoading, isAutoFormat, actionWrap, actionCase, actionPunctuation]);

    const onAddAction = useCallback((label: string) => {
        const trimmed = label.trim();
        if (!trimmed) return;

        setState((prev) => ({
            ...prev,
            allActions: [...prev.allActions, { id: `custom-${Date.now()}`, label: trimmed, count: 1 }],
        }));

        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({ type: 'ADD_ACTION', label: trimmed });
        channel.close();

        handleInterject(trimmed);
    }, [handleInterject]);

    const onDeleteAction = useCallback((label: string) => {
        setState((prev) => ({
            ...prev,
            allActions: prev.allActions.filter((a) => a.label !== label),
        }));

        const channel = new BroadcastChannel('lorereactor-companion-sync');
        channel.postMessage({ type: 'DELETE_ACTION', label });
        channel.close();
    }, []);

    // Filter & Sort Actions
    const filteredActions = useMemo(() => {
        const query = menuSearchQuery.trim().toLowerCase();
        const actions = state.allActions || [];
        if (!query) {
            return actions.slice().sort((a, b) => b.count - a.count);
        }
        return actions
            .filter((a) => a.label.toLowerCase().includes(query))
            .sort((a, b) => b.count - a.count);
    }, [state.allActions, menuSearchQuery]);

    // ─── Consistent 10px Gap on Both Left & Right ────────────────────
    const menuPositionStyle = useMemo<React.CSSProperties>(() => {
        if (!actionMenuTarget) return { display: 'none' };

        const winWidth = typeof window !== 'undefined' ? window.innerWidth : 360;
        const winHeight = typeof window !== 'undefined' ? window.innerHeight : 540;
        const menuWidth = 190;
        const menuHeight = 240;

        const isFlippedLeft = actionMenuTarget.x + menuWidth + 10 > winWidth;

        let left: number;
        let transform: string;

        if (isFlippedLeft) {
            left = Math.max(menuWidth + 8, actionMenuTarget.x - 10);
            transform = 'translateX(-100%)';
        } else {
            left = Math.min(actionMenuTarget.x + 10, winWidth - menuWidth - 8);
            transform = 'none';
        }

        let top = actionMenuTarget.y;
        if (top + menuHeight > winHeight - 10) {
            top = Math.max(40, winHeight - menuHeight - 10);
        }
        top = Math.max(40, top);

        return {
            left: `${left}px`,
            top: `${top}px`,
            transform,
            zIndex: 9999,
        };
    }, [actionMenuTarget]);

    // ─── Text Reformatter Logic (FIXED: Checks if reformat actually changes text) ──
    const { rawDisplay, reformattedDisplay, hasFormats } = useMemo(() => {
        if (!state.activeText) return { rawDisplay: null, reformattedDisplay: null, hasFormats: false };
        
        const rawDisplay = formatDisplayMessageText(state.activeText);
        const segments = detectFormatSegments(state.activeText);
        const hasSegments = segments.some(s => s.category !== 'plain');
        
        const conversions = buildCategoryConversionsWithLearning(state.activeText, segments);
        const conversionMap: Record<string, string> = {};
        for (const c of conversions) conversionMap[c.detected] = c.target;
        const reformattedText = applyConversions(state.activeText, conversionMap as any);
        
        // ✅ FIX: Only consider it "has formats" if the reformatting will ACTUALLY change the text
        const actuallyChangesText = reformattedText !== state.activeText;
        
        return {
            rawDisplay,
            reformattedDisplay: formatDisplayMessageText(reformattedText),
            hasFormats: hasSegments && actuallyChangesText
        };
    }, [state.activeText]);

    const displayedText = isReformatToggled && hasFormats ? reformattedDisplay : rawDisplay;

    // ─── Derived ────────────────────────────────────────────────────
    const activeProfileId = state.activeProfileId || null;

    const statusLabel = state.isLoading 
        ? 'Responding' 
        : (state.selectedModelId ? 'Live' : 'Idle');
    
    const statusColorClass = state.isLoading 
        ? 'active' 
        : (state.selectedModelId ? '' : 'idle');

    return (
        <div className="pip-overlay-container" onClick={() => setActionMenuTarget(null)}>
            {/* Header */}
            <div className="pip-header" data-tauri-drag-region style={{ cursor: 'grab' }}>
                <div className="pip-header-title" data-tauri-drag-region>
                    <span>◆</span> LoreReactor
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="pip-status-indicator">
                        <div className={`pip-status-dot ${statusColorClass}`} />
                        <span>{statusLabel}</span>
                    </div>

                    {/* Settings Gear */}
                    <button
                        type="button"
                        className="pip-inapp-close"
                        onClick={() => setShowSettingsMenu(prev => !prev)}
                        title="Settings"
                        style={{ fontSize: '0.9rem' }}
                    >
                        ⚙️
                    </button>

                    <button
                        type="button"
                        className="pip-inapp-close"
                        onClick={handleClose}
                        title="Close Overlay"
                        style={{ cursor: 'pointer', marginLeft: '6px' }}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Settings Dropdown Menu */}
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

            {/* Avatar & Scene Stage */}
            <div className="pip-avatar-stage">
                {state.avatarUrl && state.locationBackgroundUrl && (
                    <>
                        <div
                            className="pip-location-bg"
                            style={{ backgroundImage: `url(${state.locationBackgroundUrl})` }}
                        />
                        <div className="pip-location-vignette" />
                    </>
                )}

                {state.avatarUrl ? (
                    <img
                        src={state.avatarUrl}
                        alt={state.charName}
                        title="Click to interact"
                        className={`pip-avatar-img ${state.isLoading ? 'speaking' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            setActionMenuTarget((prev) =>
                                prev ? null : { x: e.clientX, y: e.clientY }
                            );
                        }}
                    />
                ) : (
                    <div
                        className={`pip-anonymous-fullscreen ${state.isLoading ? 'speaking' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            setActionMenuTarget((prev) =>
                                prev ? null : { x: e.clientX, y: e.clientY }
                            );
                        }}
                        style={{ cursor: 'pointer' }}
                        title="Click to interact"
                    >
                        <div className="pip-anonymous-dots">
                            <span />
                            <span />
                            <span />
                        </div>
                    </div>
                )}
            </div>

            {/* ActionMenu */}
            {actionMenuTarget && (
                <div
                    className="action-menu-container"
                    style={menuPositionStyle}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="action-menu-header">
                        <span>Interject Action</span>
                        <button
                            type="button"
                            className={`action-format-toggle ${showActionFormat ? 'action-format-toggle-active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowActionFormat(!showActionFormat);
                            }}
                        >
                            Format
                        </button>
                    </div>

                    {showActionFormat ? (
                        <div className="action-format-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="action-format-row">
                                <button
                                    type="button"
                                    className={`action-format-button ${isAutoFormat ? 'action-format-button-active' : ''}`}
                                    onClick={() => setIsAutoFormat(!isAutoFormat)}
                                    style={{ gridColumn: '1 / -1', fontWeight: 'bold' }}
                                >
                                    {isAutoFormat ? 'Auto-Format' : 'Manual Format'}
                                </button>
                            </div>
                            <div
                                className="action-format-row"
                                style={{
                                    opacity: isAutoFormat ? 0.4 : 1,
                                    pointerEvents: isAutoFormat ? 'none' : 'auto',
                                    transition: 'opacity 0.2s',
                                }}
                            >
                                <button type="button" className={`action-format-button ${actionWrap === '*' ? 'action-format-button-active' : ''}`} onClick={() => setActionWrap('*')}>*</button>
                                <button type="button" className={`action-format-button ${actionWrap === '()' ? 'action-format-button-active' : ''}`} onClick={() => setActionWrap('()')}>()</button>
                                <button type="button" className={`action-format-button ${actionWrap === 'none' ? 'action-format-button-active' : ''}`} onClick={() => setActionWrap('none')}>None</button>
                            </div>
                            <div
                                className="action-format-row"
                                style={{
                                    opacity: isAutoFormat ? 0.4 : 1,
                                    pointerEvents: isAutoFormat ? 'none' : 'auto',
                                    transition: 'opacity 0.2s',
                                }}
                            >
                                <button type="button" className={`action-format-button ${actionCase === 'first' ? 'action-format-button-active' : ''}`} onClick={() => setActionCase('first')}>A*</button>
                                <button type="button" className={`action-format-button ${actionCase === 'pascal' ? 'action-format-button-active' : ''}`} onClick={() => setActionCase('pascal')}>A* A*</button>
                                <button type="button" className={`action-format-button ${actionCase === 'lower' ? 'action-format-button-active' : ''}`} onClick={() => setActionCase('lower')}>a*</button>
                            </div>
                            <div
                                className="action-format-row"
                                style={{
                                    opacity: isAutoFormat ? 0.4 : 1,
                                    pointerEvents: isAutoFormat ? 'none' : 'auto',
                                    transition: 'opacity 0.2s',
                                }}
                            >
                                <button type="button" className={`action-format-button ${actionPunctuation === '.' ? 'action-format-button-active' : ''}`} onClick={() => setActionPunctuation('.')}>.</button>
                                <button type="button" className={`action-format-button ${actionPunctuation === '-' ? 'action-format-button-active' : ''}`} onClick={() => setActionPunctuation('-')}>-</button>
                                <button type="button" className={`action-format-button ${actionPunctuation === 'none' ? 'action-format-button-active' : ''}`} onClick={() => setActionPunctuation('none')}>None</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <input
                                className="action-menu-search"
                                type="text"
                                value={menuSearchQuery}
                                onChange={(e) => setMenuSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        onAddAction(menuSearchQuery);
                                        setMenuSearchQuery('');
                                    }
                                    if (e.key === 'Escape') {
                                        setActionMenuTarget(null);
                                    }
                                }}
                                placeholder="Filter or type new & Enter..."
                                onClick={(e) => e.stopPropagation()}
                            />
                            <div className="action-menu-list">
                                {filteredActions.map((action) => (
                                    <div
                                        key={action.label}
                                        className="action-menu-item"
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleInterject(action.label);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.stopPropagation();
                                                handleInterject(action.label);
                                            }
                                        }}
                                    >
                                        <span className="action-menu-item-label">{action.label}</span>
                                        <div className="action-meta-container">
                                            <span
                                                className="action-count-badge"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDeleteAction(action.label);
                                                }}
                                                title="Click to remove action"
                                            >
                                                <span className="badge-count">{action.count || 0}</span>
                                                <span className="badge-delete">×</span>
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Flex spacer */}
            <div className="pip-content-spacer" />

            {/* Frosted Dialogue Box */}
            <div className="pip-dialogue-box">
                <div className={`pip-dialogue-name ${state.isUser ? 'user' : ''}`}>
                    {state.charName}
                </div>
                
                {/* ✅ Resume, Regenerate, and Reformat Toggle Buttons */}
                <div className="pip-dialogue-actions">
                    <button 
                        className="pip-dialogue-action-btn" 
                        onClick={() => {
                            if (!state.lastMessageId) return;
                            const channel = new BroadcastChannel('lorereactor-companion-sync');
                            channel.postMessage({ type: 'RESUME_GENERATION', messageId: state.lastMessageId });
                            channel.close();
                        }}
                        title="Resume Generation"
                        disabled={!state.lastMessageId || state.isLoading}
                    >
                        ▶
                    </button>
                    <button 
                        className="pip-dialogue-action-btn" 
                        onClick={() => {
                            if (!state.lastMessageId) return;
                            const channel = new BroadcastChannel('lorereactor-companion-sync');
                            channel.postMessage({ type: 'RESTART_GENERATION', messageId: state.lastMessageId });
                            channel.close();
                        }}
                        title="Regenerate Response"
                        disabled={!state.lastMessageId || state.isLoading}
                    >
                        ↻
                    </button>
                    <button 
                        className={`pip-dialogue-action-btn ${isReformatToggled ? 'pip-dialogue-action-btn-active' : ''}`}
                        onClick={() => setIsReformatToggled(prev => !prev)}
                        title={isReformatToggled ? "Revert to Raw Text" : "Apply Auto-Reformat"}
                        disabled={!hasFormats}
                    >
                        ✨
                    </button>
                </div>

                <div className="pip-dialogue-text" ref={dialogueTextRef}>
                    {state.isLoading && !state.streamingText ? (
                        <div className="pip-thinking-dots"><span></span><span></span><span></span></div>
                    ) : displayedText ? (
                        displayedText
                    ) : (
                        <div className="pip-empty-state">Awaiting interaction...</div>
                    )}
                </div>
            </div>

            {/* File Attachment Chips */}
            {pendingFiles.length > 0 && (
                <div style={{ position: 'absolute', bottom: '55px', left: '12px', right: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap', zIndex: 45 }}>
                    {pendingFiles.map((file, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 8px', background: 'rgba(192, 132, 252, 0.2)', border: '1px solid rgba(192, 132, 252, 0.5)', borderRadius: '12px', fontSize: '0.65rem', color: '#fff' }}>
                            <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📎 {file.name}</span>
                            <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: '#ff4444', cursor: 'pointer', padding: '0 2px', fontSize: '0.8rem' }}>×</button>
                        </div>
                    ))}
                </div>
            )}

            {/* Invisible Hover Net */}
            <div className="pip-input-trigger-zone" />

            {/* Stealth Input: Paperclip LEFT | Text MIDDLE | Mic RIGHT */}
            <div className={`pip-stealth-input-wrapper ${isInputFocused || showAutocomplete || pendingFiles.length > 0 || isRecording ? 'focused has-autocomplete' : ''}`}>
                {showAutocomplete && (
                    <div ref={autocompleteRef} className="slash-autocomplete">
                        <div className="slash-autocomplete-breadcrumbs">
                            {breadcrumbs.map((b, i) => (
                                <span key={i} className="slash-breadcrumb">
                                    {b} {i < breadcrumbs.length - 1 && <span className="slash-breadcrumb-sep">›</span>}
                                </span>
                            ))}
                        </div>
                        <div className="slash-autocomplete-list">
                            {options.length === 0 && (
                                <div className="slash-autocomplete-no-results">
                                    Type any text, then press Enter to send
                                </div>
                            )}
                            {options.map((opt, i) => (
                                <div
                                    key={`${opt.type}-${opt.value}-${opt.id}-${i}`}
                                    className={`slash-autocomplete-item ${i === selectedIndex ? 'slash-autocomplete-item-selected' : ''}`}
                                    onMouseDown={(e) => { e.preventDefault(); handleApplySlashSelection(opt); }}
                                    onMouseEnter={() => setSelectedIndex(i)}
                                >
                                    <span className="slash-autocomplete-label">{opt.label}</span>
                                    {opt.id && opt.id !== 'example' && <span className="slash-autocomplete-id">({opt.id})</span>}
                                    {opt.desc && <span className="slash-autocomplete-desc">{opt.desc}</span>}
                                </div>
                            ))}
                        </div>
                        <div className="slash-autocomplete-hint">
                            <span><kbd>Tab</kbd> scroll</span>
                            <span><kbd>Enter</kbd> select</span>
                            <span><kbd>Esc</kbd> close</span>
                        </div>
                    </div>
                )}

                {/* Paperclip — LEFT */}
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="pip-input-icon-btn"
                    title="Attach File"
                    disabled={state.isLoading}
                >
                    📎
                </button>
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileSelected} multiple />

                {/* Text Input — MIDDLE */}
                <input
                    ref={inputRef}
                    type="text"
                    className="pip-stealth-input"
                    placeholder="Say something or type / for commands"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    autoComplete="off"
                    disabled={state.isLoading}
                />

                {/* Mic — RIGHT */}
                <button
                    type="button"
                    onClick={handleToggleMic}
                    className={`pip-input-icon-btn ${isRecording ? 'recording' : ''}`}
                    title={isRecording ? "Stop Recording" : "Record Audio"}
                    disabled={state.isLoading}
                >
                    🎙️
                </button>
            </div>

            {/* ─── Settings Modals ───────────────────────────────────────── */}

            {/* Profile List Modal */}
            {activeSettingsModal === 'profile-list' && (
                <div className="modal-overlay" onClick={() => setActiveSettingsModal(null)} style={{ zIndex: 10000 }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '360px' }}>
                        <div className="modal-header" style={{ padding: '12px 16px' }}>
                            <h2 style={{ fontSize: '1rem', margin: 0 }}>Select Profile</h2>
                            <button className="close-button" onClick={() => setActiveSettingsModal(null)} style={{ minWidth: '32px', minHeight: '32px', fontSize: '1.2rem' }}>×</button>
                        </div>
                        <div className="modal-body" style={{ padding: '12px 16px' }}>
                            <input
                                type="text"
                                className="pip-settings-search"
                                placeholder="Search profiles..."
                                value={modalSearchQuery}
                                onChange={(e) => setModalSearchQuery(e.target.value)}
                                autoFocus
                            />
                            <div className="pip-settings-list">
                                {filteredProfiles.map(profile => (
                                    <div
                                        key={profile.id}
                                        className={`pip-settings-item ${activeProfileId === profile.id ? 'selected' : ''}`}
                                        onClick={() => handleActivateProfile(profile.id)}
                                    >
                                        <div className="pip-settings-item-info">
                                            <div className="pip-settings-item-title">{profile.name}</div>
                                            {profile.description && <div className="pip-settings-item-sub">{profile.description}</div>}
                                        </div>
                                        <div className="pip-settings-item-actions">
                                            <button
                                                className="pip-settings-item-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleEditProfile(profile);
                                                }}
                                                title="Edit Profile (General)"
                                            >
                                                ✎
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {filteredProfiles.length === 0 && (
                                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', padding: '16px 0', opacity: 0.6 }}>No profiles found.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Profile Editor Modal */}
            {activeSettingsModal === 'profile-edit' && editingProfile && (
                <StandaloneOverlayProfileEditor
                    profile={editingProfile}
                    onClose={() => { setActiveSettingsModal('profile-list'); setEditingProfile(null); }}
                    onSave={handleSaveProfile}
                />
            )}

            {/* Model Selector */}
            {activeSettingsModal === 'model' && (
                <div className="modal-overlay" onClick={() => setActiveSettingsModal(null)} style={{ zIndex: 10000 }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '360px' }}>
                        <div className="modal-header" style={{ padding: '12px 16px' }}>
                            <h2 style={{ fontSize: '1rem', margin: 0 }}>Select Model</h2>
                            <button className="close-button" onClick={() => setActiveSettingsModal(null)} style={{ minWidth: '32px', minHeight: '32px', fontSize: '1.2rem' }}>×</button>
                        </div>
                        <div className="modal-body" style={{ padding: '12px 16px' }}>
                            <input
                                type="text"
                                className="pip-settings-search"
                                placeholder="Search models..."
                                value={modalSearchQuery}
                                onChange={(e) => setModalSearchQuery(e.target.value)}
                                autoFocus
                            />
                            <div className="pip-settings-list">
                                {filteredModels.map(m => (
                                    <div
                                        key={m.id}
                                        className={`pip-settings-item ${state.selectedModelId === m.id ? 'selected' : ''}`}
                                        onClick={() => {
                                            const channel = new BroadcastChannel('lorereactor-companion-sync');
                                            const newId = state.selectedModelId === m.id ? '' : m.id;
                                            channel.postMessage({ type: 'SELECT_MODEL', modelId: newId });
                                            channel.close();
                                        }}
                                    >
                                        <div className="pip-settings-item-info">
                                            <div className="pip-settings-item-title">{m.name}</div>
                                            {m.backend && <div className="pip-settings-item-sub">{m.backend}</div>}
                                        </div>
                                    </div>
                                ))}
                                {filteredModels.length === 0 && (
                                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', padding: '16px 0', opacity: 0.6 }}>No models found.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Budget Strategy Selector */}
            {activeSettingsModal === 'budget' && (
                <div className="modal-overlay" onClick={() => setActiveSettingsModal(null)} style={{ zIndex: 10000 }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '360px' }}>
                        <div className="modal-header" style={{ padding: '12px 16px' }}>
                            <h2 style={{ fontSize: '1rem', margin: 0 }}>Select Budget Strategy</h2>
                            <button className="close-button" onClick={() => setActiveSettingsModal(null)} style={{ minWidth: '32px', minHeight: '32px', fontSize: '1.2rem' }}>×</button>
                        </div>
                        <div className="modal-body" style={{ padding: '12px 16px' }}>
                            <input
                                type="text"
                                className="pip-settings-search"
                                placeholder="Search budgets..."
                                value={modalSearchQuery}
                                onChange={(e) => setModalSearchQuery(e.target.value)}
                                autoFocus
                            />
                            <div className="pip-settings-list">
                                {filteredBudgets.map(b => (
                                    <div
                                        key={b.id}
                                        className={`pip-settings-item ${state.selectedBudgetStrategyId === b.id ? 'selected' : ''}`}
                                        onClick={() => {
                                            const channel = new BroadcastChannel('lorereactor-companion-sync');
                                            const newId = state.selectedBudgetStrategyId === b.id ? '' : b.id;
                                            channel.postMessage({ type: 'SELECT_BUDGET', budgetId: newId });
                                            channel.close();
                                        }}
                                    >
                                        <div className="pip-settings-item-info">
                                            <div className="pip-settings-item-title">{b.name}</div>
                                        </div>
                                    </div>
                                ))}
                                {filteredBudgets.length === 0 && (
                                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', padding: '16px 0', opacity: 0.6 }}>No budgets found.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}