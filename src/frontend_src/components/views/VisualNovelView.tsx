// frontend_src/components/views/VisualNovelView.tsx
import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { ViewModeProps } from './types';
import type { Character } from '../../types';
import { MemoizedMessageText } from '../MemoizedMessageText';
import { useVisualNovelSpriteStates } from '../../hooks/useVisualNovelSpriteStates';
import { resolveDelayedDisplayNameFromCache } from '../../utilities/immersionLogic';
import { useSessionStore } from '../../hooks/useSessionStore';
import { compileMessageDisplayText } from '../../utilities/messageDisplayCompiler';
import {
    detectFormatSegments,
    applyConversions,
    buildCategoryConversions,
    buildCategoryConversionsWithLearning,
    recordCategoryCorrection,
    learnFromManualEdits,
    DEFAULT_CONVERSIONS,
    TARGET_OPTIONS,
    type CategoryConversion,
    type FormatCategory,
} from '../../utilities/textDisplayReformatter';

const AMBIENT_NARRATOR_ID = '___ambient_narrator___';

export const VisualNovelView = React.memo(function VisualNovelView(props: ViewModeProps) {
    const {
        displayMessages,
        portraitUrlCache,
        formattedStreamingText,
        centerAvatar, displayNameCache,
        messageEndRef, editTextAreaRef,
        onSaveEdit,
        onResumeGeneration, onRegenerateFromMessage,
        onNavigateToBranchSource,
        parentInteractionDataName,
        focusedMessageId,
        setFocusedMessageId,
        canDelete,
    } = props;

    // ✅ Read directly from Zustand!
    const interactionData = useSessionStore(s => s.interactionData);
    const localProtagonistId = useSessionStore(s => s.localProtagonist?.id ?? s.interactionData?.protagonistIds?.[0] ?? null);
    const isLoading = useSessionStore(s => s.isLoading);
    const streamingCharacter = useSessionStore(s => s.streamingCharacter);

    // ✅ Read display preferences directly from Zustand for on-the-fly compilation
    const participants = useSessionStore(s => s.interactionData?.participants || []);
    const displayMode = useSessionStore(s => s.interactionData?.profile?.toolUsageDisplayMode);

    const editingId = useSessionStore(s => s.editingId);
    const editDraft = useSessionStore(s => s.editDraft);
    const setEditDraft = useSessionStore(s => s.setEditDraft);
    const setEditingState = useSessionStore(s => s.setEditingState);

    const massDeleteId = useSessionStore(s => s.massDeleteId);
    const setMassDeleteId = useSessionStore(s => s.setMassDeleteId);

    const copyToClipboard = useSessionStore(s => s.copyToClipboard);
    const deleteMessage = useSessionStore(s => s.deleteMessage);
    const branchChat = useSessionStore(s => s.branchChat);
    const cloneChat = useSessionStore(s => s.cloneChat);
    const stopGeneration = useSessionStore(s => s.stopGeneration);

    // Derived state & Local wrappers for Zustand actions
    const isMassActive = massDeleteId !== null;
    const onStartEditing = useCallback((id: string, text: string) => setEditingState(id, text), [setEditingState]);
    const onCancelEditing = useCallback(() => setEditingState(null, ''), [setEditingState]);
    const onSetMassDelete = useCallback((id: string) => setMassDeleteId(id), [setMassDeleteId]);
    const onMassDeleteConfirm = useCallback(() => { /* handled in parent or hook */ }, []);
    const onCancelMassDelete = useCallback(() => setMassDeleteId(null), [setMassDeleteId]);
    
    const onCopyText = copyToClipboard;
    const onBranch = branchChat;
    const onClone = cloneChat;
    const onDelete = deleteMessage;
    const onStopGeneration = stopGeneration;

    // FIX: Use state instead of ref so UI updates trigger re-renders properly
    const [rawDraft, setRawDraft] = useState('');
    const [conversions, setConversions] = useState<CategoryConversion[]>([]);
    const [isRawEditing, setIsRawEditing] = useState(false);
    const prevIsEditingRef = useRef(false);

    const chatMessages = useMemo(() => {
        const all = displayMessages.filter((m) => m.messageType === 'chat' || m.messageType === 'whisper');
        const seen = new Set<string>();
        return all.filter(m => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        });
    }, [displayMessages]);

    const viewIndex = useMemo(() => {
        if (!focusedMessageId) return null;
        const idx = chatMessages.findIndex(m => m.id === focusedMessageId);
        return idx !== -1 ? idx : null;
    }, [focusedMessageId, chatMessages]);

    const prevChatLengthRef = useRef(chatMessages.length);
    useEffect(() => {
        if (chatMessages.length > prevChatLengthRef.current && focusedMessageId) {
            setFocusedMessageId(null);
        }
        prevChatLengthRef.current = chatMessages.length;
    }, [chatMessages.length, focusedMessageId, setFocusedMessageId]);

    const lastMsg = displayMessages[displayMessages.length - 1];
    const isStreamingInList = isLoading && streamingCharacter !== null && lastMsg?.character.id === streamingCharacter.id;

    // STREAMING LAYER: Compiles raw text on the fly
    const activeStreamingText: string | null = useMemo(() => {
        if (isStreamingInList && lastMsg) {
            return compileMessageDisplayText(lastMsg.textContent, displayMode, participants, lastMsg.character);
        }
        return isLoading && formattedStreamingText ? String(formattedStreamingText) : null;
    }, [isStreamingInList, lastMsg, displayMode, participants, isLoading, formattedStreamingText]);

    const visibleCharacters = useMemo(() => {
        return interactionData?.participants || [];
    }, [interactionData]);

    const lastSpeaker = useMemo(() => {
        return chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
    }, [chatMessages]);

    const displayedMessage = useMemo(() => {
        if (viewIndex !== null && viewIndex >= 0 && viewIndex < chatMessages.length) {
            return chatMessages[viewIndex];
        }
        return lastSpeaker;
    }, [viewIndex, chatMessages, lastSpeaker]);

    const activeSpeaker = useMemo(() => {
        if (viewIndex !== null && displayedMessage) return displayedMessage.character;
        if (isLoading && streamingCharacter) return streamingCharacter;
        if (isStreamingInList && lastMsg?.character) return lastMsg.character;
        if (displayedMessage?.character) return displayedMessage.character;
        if (centerAvatar) return centerAvatar;
        return visibleCharacters.find((c: Character) => c.id !== AMBIENT_NARRATOR_ID && c.id !== localProtagonistId)
            || visibleCharacters[0]
            || null;
    }, [viewIndex, displayedMessage, isLoading, streamingCharacter, isStreamingInList, lastMsg, centerAvatar, visibleCharacters, localProtagonistId]);

    // Compute the resolved display name for the active speaker using the immersion cache (one message behind)
    const activeSpeakerDisplayName = useMemo(() => {
        if (!activeSpeaker || activeSpeaker.id === AMBIENT_NARRATOR_ID) return 'System';
        const msgIdx = displayedMessage ? chatMessages.findIndex(m => m.id === displayedMessage.id) : chatMessages.length - 1;
        return resolveDelayedDisplayNameFromCache(displayNameCache, msgIdx, activeSpeaker.id);
    }, [displayNameCache, displayedMessage, chatMessages, activeSpeaker]);

    const isWaitingForGeneration = isLoading && !activeStreamingText && viewIndex === null;
    const isEditingLastSpeaker = editingId !== null && displayedMessage?.id === editingId;
    const isAmbientSpeaker = displayedMessage?.character.id === AMBIENT_NARRATOR_ID;

    const hasParentBranch = !!interactionData?.parentInteractionDataId;

    const canGoBack = chatMessages.length > 1 && (viewIndex === null ? true : viewIndex > 0);
    const canGoForward = viewIndex !== null && viewIndex < chatMessages.length - 1;
    const currentIndex = viewIndex !== null ? viewIndex : chatMessages.length - 1;

    const handleGoBack = useCallback(() => {
        if (viewIndex === null) {
            if (chatMessages.length >= 2) {
                setFocusedMessageId(chatMessages[chatMessages.length - 2].id);
            }
        } else if (viewIndex > 0) {
            setFocusedMessageId(chatMessages[viewIndex - 1].id);
        }
    }, [viewIndex, chatMessages, setFocusedMessageId]);

    const handleGoForward = useCallback(() => {
        if (viewIndex !== null) {
            if (viewIndex < chatMessages.length - 2) {
                setFocusedMessageId(chatMessages[viewIndex + 1].id);
            } else {
                setFocusedMessageId(null);
            }
        }
    }, [viewIndex, chatMessages, setFocusedMessageId]);

    const handleSkipToFirst = useCallback(() => {
        if (chatMessages.length > 0) {
            setFocusedMessageId(chatMessages[0].id);
        }
    }, [chatMessages, setFocusedMessageId]);

    const handleSkipToLatest = useCallback(() => {
        setFocusedMessageId(null);
    }, [setFocusedMessageId]);

    const spriteCharacterIds = useMemo(() => {
        return visibleCharacters
            .filter((c: Character) => c.id !== AMBIENT_NARRATOR_ID && c.id !== localProtagonistId)
            .map((c: Character) => c.id);
    }, [visibleCharacters, localProtagonistId]);

    const { spriteStates, rollbackToMessage, isInitialLoad, jumpingCharacterIds } = useVisualNovelSpriteStates({
        chatMessages,
        visibleCharacterIds: spriteCharacterIds,
        // ✅ FIX: Coerce null to undefined to satisfy the hook's type signature
        protagonistId: localProtagonistId ?? undefined,
        viewedMessageIndex: viewIndex,
    });

    // ✅ FIX: Updated to accept protagonistIds (string[]) instead of Character[]
    const handleRegenerateFromMessageWithRollback = useCallback((id: string, protagonistIds: string[]) => {
        const msgIndex = chatMessages.findIndex(m => m.id === id);
        if (msgIndex !== -1) rollbackToMessage(msgIndex);
        setFocusedMessageId(null);
        onRegenerateFromMessage(id, protagonistIds);
    }, [chatMessages, rollbackToMessage, onRegenerateFromMessage, setFocusedMessageId]);

    const handleBranchWithRollback = useCallback((id: string) => {
        const msgIndex = chatMessages.findIndex(m => m.id === id);
        if (msgIndex !== -1) rollbackToMessage(msgIndex);
        setFocusedMessageId(null);
        onBranch(id);
    }, [chatMessages, rollbackToMessage, onBranch, setFocusedMessageId]);

    useEffect(() => {
        const justStarted = isEditingLastSpeaker && !prevIsEditingRef.current;
        prevIsEditingRef.current = isEditingLastSpeaker;

        if (justStarted) {
            setRawDraft(editDraft);
            const segments = detectFormatSegments(editDraft);
            setConversions(buildCategoryConversions(segments));
            setIsRawEditing(false);
        } else if (!isEditingLastSpeaker) {
            setRawDraft('');
            setConversions([]);
            setIsRawEditing(false);
        }
    }, [isEditingLastSpeaker, editDraft]);

    const conversionMap = useMemo(() => {
        const map: Record<FormatCategory, FormatCategory> = { ...DEFAULT_CONVERSIONS };
        for (const c of conversions) map[c.detected] = c.target;
        return map;
    }, [conversions]);

    const displayEditText = useMemo(() => {
        if (isRawEditing) return rawDraft;
        return editDraft;
    }, [isRawEditing, rawDraft, editDraft]);

    // FIX: Sync the parent's editDraft whenever rawDraft or conversions change
    useEffect(() => {
        if (isEditingLastSpeaker) {
            const converted = applyConversions(rawDraft, conversionMap);
            if (converted !== editDraft) {
                setEditDraft(converted);
            }
        }
    }, [rawDraft, conversionMap, isEditingLastSpeaker, editDraft, setEditDraft]);

    useEffect(() => {
        if (isRawEditing && editTextAreaRef.current) {
            editTextAreaRef.current.focus();
        }
    }, [isRawEditing, editTextAreaRef]);

    const handleEnterRawEdit = useCallback(() => {
        setIsRawEditing(true);
    }, []);

    const handleExitRawEdit = useCallback(() => {
        setIsRawEditing(false);
    }, []);

    const handleRawChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setRawDraft(e.target.value);
    }, []);

    const updateConversionTarget = useCallback((category: FormatCategory, target: FormatCategory) => {
        setConversions(prev => prev.map(c => c.detected === category ? { ...c, target } : c));
        recordCategoryCorrection(rawDraft, category, target);
    }, [rawDraft]);

    const handleAutoReformat = useCallback(() => {
        const segments = detectFormatSegments(rawDraft);
        setConversions(buildCategoryConversionsWithLearning(rawDraft, segments));
    }, [rawDraft]);

    const canAutoReformat = useMemo(() => {
        if (conversions.length === 0) return false;
        if (!rawDraft) return false;

        const segments = detectFormatSegments(rawDraft);
        if (segments.length === 0) return false;

        const learned = buildCategoryConversionsWithLearning(rawDraft, segments);
        return learned.some(c => {
            const current = conversions.find(curr => curr.detected === c.detected);
            return c.target !== c.detected && (!current || current.target !== c.target);
        });
    }, [rawDraft, conversions]);

    const handleCancelEditing = useCallback(() => {
        setConversions([]);
        setIsRawEditing(false);
        onCancelEditing();
    }, [onCancelEditing]);

    const handleSaveEdit = useCallback(() => {
        if (displayedMessage) {
            // Learns from raw textContent to raw edited text
            learnFromManualEdits(displayedMessage.textContent, rawDraft);
        }
        onSaveEdit();
    }, [displayedMessage, rawDraft, onSaveEdit]);

    // Fallback background since locationBackgroundUrl was removed from props
    const bgStyle: React.CSSProperties = { background: 'linear-gradient(to bottom, #1a1a2e, #16213e)' };

    const isMassDeletingThis = isMassActive && massDeleteId === displayedMessage?.id;

    const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        e.currentTarget.style.display = 'none';
    }, []);

    // ✅ DISPLAY LAYER: Compiles raw textContent on the fly based on current profile settings
    const displayedTextContent = useMemo(() => {
        if (!displayedMessage) return null;
        return compileMessageDisplayText(displayedMessage.textContent, displayMode, participants, displayedMessage.character, displayedMessage.toolExecutionResults);
    }, [displayedMessage, displayMode, participants]);

    const displayText = useMemo(() => {
        if (isEditingLastSpeaker) return null;
        if (viewIndex !== null && displayedTextContent) return displayedTextContent;
        if (activeStreamingText) return activeStreamingText;
        if (displayedTextContent) return displayedTextContent;
        return null;
    }, [isEditingLastSpeaker, viewIndex, displayedTextContent, activeStreamingText]);

    return (
        <div className="vn-stage-container" style={bgStyle}>
            <div className="vn-sprites-layer">
                {spriteCharacterIds.map((characterId: string) => {
                    const portraitUrl = portraitUrlCache.get(`character:${characterId}`) ?? null;
                    if (!portraitUrl) return null;

                    const state = spriteStates.get(characterId);
                    if (!state) return null;

                    const character = visibleCharacters.find((c: Character) => c.id === characterId);
                    if (!character) return null;

                    const isSpeaking = activeSpeaker?.id === characterId;
                    const isJumping = jumpingCharacterIds.has(characterId);
                    const breatheClass = `vn-breathe-${state.breathingPattern || 'calm'}`;

                    const classNames = [
                        'vn-character-layer',
                        isInitialLoad ? 'vn-no-transition' : '',
                        isJumping ? 'vn-jumping' : '',
                    ].filter(Boolean).join(' ');

                    return (
                        <div key={characterId} className={classNames} style={{
                            left: `${state.screenX}%`,
                            bottom: `${state.verticalOffset}px`,
                            transform: `translateX(-50%) scale(${state.scale})`,
                            transformOrigin: 'bottom center',
                            zIndex: Math.round((1 - state.depth) * 100),
                            opacity: state.facingTargetId === null && !isSpeaking ? 0.5 : (isSpeaking ? 1 : 0.7),
                            filter: isSpeaking ? 'none' : 'brightness(0.8)',
                        }}>
                            <img 
                                src={portraitUrl} 
                                alt={character.name} 
                                className={`vn-sprite ${breatheClass}`}
                                onError={handleImageError} 
                            />
                        </div>
                    );
                })}
            </div>

            {hasParentBranch && onNavigateToBranchSource && (
                <div className="vn-branch-indicator">
                    <button type="button" className="vn-branch-button" onClick={onNavigateToBranchSource}>
                        🌿 Timeline branches from {parentInteractionDataName || 'Source'}
                    </button>
                </div>
            )}

            {chatMessages.length > 1 && (
                <div className="vn-nav-arrows">
                    <div className="vn-nav-group">
                        <button
                            type="button"
                            className="vn-nav-arrow"
                            onClick={handleSkipToFirst}
                            disabled={currentIndex === 0}
                            title="Skip to first message"
                        >
                            <span>⏮</span>
                        </button>
                        <button
                            type="button"
                            className="vn-nav-arrow"
                            onClick={handleGoBack}
                            disabled={!canGoBack}
                            title="Previous message"
                        >
                            <span>◀</span>
                        </button>
                    </div>
                    <div className="vn-nav-group">
                        <button
                            type="button"
                            className="vn-nav-arrow"
                            onClick={handleGoForward}
                            disabled={!canGoForward}
                            title={!canGoForward ? 'Already at latest' : 'Next message'}
                        >
                            <span>▶</span>
                        </button>
                        <button
                            type="button"
                            className="vn-nav-arrow"
                            onClick={handleSkipToLatest}
                            disabled={!canGoForward}
                            title={!canGoForward ? 'Already at latest' : 'Skip to latest message'}
                        >
                            <span>⏭</span>
                        </button>
                    </div>
                </div>
            )}

            <div className="vn-dialogue-layer">
                <div className={`vn-dialogue-box ${isAmbientSpeaker ? 'vn-dialogue-box-ambient' : ''}`} style={{
                    opacity: isWaitingForGeneration ? 0 : 1,
                    pointerEvents: isWaitingForGeneration ? 'none' : 'auto',
                    transition: 'opacity 0.3s ease'
                }}>
                    <div className="vn-name-plate">
                        {isAmbientSpeaker ? '✦ Narration' : activeSpeakerDisplayName}
                    </div>

                    <div className="vn-message-toolbar">
                        {isEditingLastSpeaker ? (
                            <>
                                <button type="button" className="vn-toolbar-btn vn-toolbar-cancel" onClick={handleCancelEditing} title="Cancel Edit">✕</button>
                                <button type="button" className="vn-toolbar-btn vn-toolbar-confirm" onClick={handleSaveEdit} title="Save Edit">💾</button>
                            </>
                        ) : (
                            <>
                                {isLoading && !isAmbientSpeaker && viewIndex === null && (
                                    <button type="button" className="vn-toolbar-btn vn-toolbar-danger" onClick={onStopGeneration} title="Stop Generation">⏹</button>
                                )}
                                {displayedMessage && (
                                    <>
                                        <button type="button" className="vn-toolbar-btn" onClick={() => onCopyText(displayedTextContent || '')} title="Copy Text">📋</button>
                                        <button type="button" className="vn-toolbar-btn" onClick={() => onResumeGeneration(displayedMessage.id)} title="Continue Generation">▶</button>
                                        <button 
                                            type="button" 
                                            className="vn-toolbar-btn" 
                                            // ✅ FIX: Pass protagonistIds array directly
                                            onClick={() => handleRegenerateFromMessageWithRollback(displayedMessage.id, interactionData?.protagonistIds || [])} 
                                            title="Regenerate"
                                        >
                                            ↻
                                        </button>
                                        <button
                                            type="button"
                                            className="vn-toolbar-btn"
                                            // EDIT LAYER: Always passes raw textContent to the editor
                                            onClick={() => onStartEditing(displayedMessage.id, displayedMessage.textContent)}
                                            disabled={isLoading}
                                            title={isLoading ? 'Generation in progress...' : 'Edit Message'}
                                            style={isLoading ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                        >
                                            ✎
                                        </button>
                                        <button type="button" className="vn-toolbar-btn" onClick={() => handleBranchWithRollback(displayedMessage.id)} title="Branch Timeline">🌿</button>
                                        <button type="button" className="vn-toolbar-btn" onClick={() => onClone(displayedMessage.id)} title="Clone Chat">⑂</button>

                                        {canDelete && (
                                            <button type="button" className="vn-toolbar-btn vn-toolbar-danger" onClick={() => onDelete(displayedMessage.id)} title="Delete Message">🗑</button>
                                        )}

                                        {isMassDeletingThis ? (
                                            <>
                                                <button type="button" className="vn-toolbar-btn vn-toolbar-confirm" onClick={onMassDeleteConfirm} title="Confirm Mass Delete">✓</button>
                                                <button type="button" className="vn-toolbar-btn vn-toolbar-cancel" onClick={onCancelMassDelete} title="Cancel Mass Delete">✕</button>
                                            </>
                                        ) : (
                                            canDelete && (
                                                <button type="button" className="vn-toolbar-btn vn-toolbar-warn" onClick={() => onSetMassDelete(displayedMessage.id)} title="Mass Delete From Here">🗑️↓</button>
                                            )
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </div>

                    <div className="vn-dialogue-content">
                        <div className="vn-dialogue-text">
                            {isEditingLastSpeaker ? (
                                isRawEditing ? (
                                    <textarea ref={editTextAreaRef} value={rawDraft} onChange={handleRawChange}
                                        onBlur={handleExitRawEdit}
                                        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); handleExitRawEdit(); } }}
                                        className="vn-edit-textarea" />
                                ) : (
                                    <div className="vn-edit-preview" onClick={handleEnterRawEdit} title="Click to edit raw text">
                                        <MemoizedMessageText text={displayEditText} />
                                    </div>
                                )
                            ) : displayText ? (
                                // DISPLAY LAYER: Renders the compiled text
                                <MemoizedMessageText text={displayText} />
                            ) : (
                                <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Waiting for an interaction...</span>
                            )}
                        </div>

                        {isEditingLastSpeaker && (
                            <div className="vn-reformat-panel">
                                {conversions.length === 0 ? (
                                    <div className="vn-reformat-empty">No formatting detected. Click the text above to edit.</div>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={handleAutoReformat}
                                            disabled={!canAutoReformat}
                                            className="vn-auto-reformat-button"
                                            title={canAutoReformat ? "Apply learned reformatting preferences to all text" : "No new learned formatting changes available"}
                                            style={!canAutoReformat ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                                        >
                                            Auto-Reformat
                                        </button>
                                        <div className="vn-reformat-grid">
                                            {conversions.map(conversion => (
                                                <div key={conversion.detected} className="vn-reformat-row">
                                                    <span className="vn-reformat-label">
                                                        {conversion.label}<span className="vn-reformat-count">×{conversion.count}</span>
                                                    </span>
                                                    <span className="vn-reformat-arrow">→</span>
                                                    <select className="vn-reformat-select" value={conversion.target}
                                                        onChange={e => updateConversionTarget(conversion.detected, e.target.value as FormatCategory)}>
                                                        {TARGET_OPTIONS.map(option => (
                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="vn-message-counter">
                        {currentIndex + 1} / {chatMessages.length}
                    </div>
                </div>
            </div>

            <div ref={messageEndRef} style={{ height: '1px', position: 'absolute', bottom: 0 }} />
        </div>
    );
});