import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { ViewModeProps } from './types';
import type { Character, ChatMessage } from '../../types';
import { MemoizedMessageText } from '../MemoizedMessageText';
import { useVisualNovelSpriteStates } from '../../hooks/useVisualNovelSpriteStates';
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
} from '../../utilities/textReformat';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

export const VisualNovelView = React.memo(function VisualNovelView(props: ViewModeProps) {
    const {
        interactionData, localProtagonist, displayMessages,
        portraitUrlCache, locationBackgroundUrl,
        formattedStreamingText, isLoading, streamingCharacter,
        centerAvatar,
        messageEndRef, editTextAreaRef,
        editingId, editDraft, setEditDraft,
        onSaveEdit, onCancelEditing, onRegenerateFromEdit,
        onCopyText, onRegenerateFromMessage, onBranch,
        onStartEditing, onResumeGeneration, onClone, onDelete,
        onSetMassDelete, onMassDeleteConfirm, onCancelMassDelete,
        massDeleteId, isMassActive,
        onStopGeneration,
        onNavigateToBranchSource,
        parentInteractionDataName,
        focusedMessageId,
        setFocusedMessageId,
        canDelete,
    } = props;

    const protagonistId = localProtagonist?.id;

    const [conversions, setConversions] = useState<CategoryConversion[]>([]);
    const [isRawEditing, setIsRawEditing] = useState(false);
    const rawDraftRef = useRef<string>('');

    const chatMessages = useMemo(() => {
        const all = displayMessages.filter((m): m is ChatMessage => m.messageType === 'chat' || m.messageType === 'whisper');
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
    const isStreamingInList = isLoading && streamingCharacter !== null && lastMsg?.character?.id === streamingCharacter.id;

    const activeStreamingText: string | null = isStreamingInList
        ? lastMsg.textContent
        : (isLoading && formattedStreamingText ? String(formattedStreamingText) : null);

    const visibleCharacters = useMemo(() => {
        return interactionData.participants;
    }, [interactionData.participants]);

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
        return visibleCharacters.find(c => c.id !== AMBIENT_NARRATOR_ID && c.id !== protagonistId)
            || visibleCharacters[0]
            || null;
    }, [viewIndex, displayedMessage, isLoading, streamingCharacter, isStreamingInList, lastMsg, centerAvatar, visibleCharacters, protagonistId]);

    const isWaitingForGeneration = isLoading && !activeStreamingText && viewIndex === null;
    const isEditingLastSpeaker = editingId !== null && displayedMessage?.id === editingId;
    const isAmbientSpeaker = displayedMessage?.character.id === AMBIENT_NARRATOR_ID;

    const hasParentBranch = !!interactionData.parentInteractionDataId;

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
            .filter(c => c.id !== AMBIENT_NARRATOR_ID && c.id !== protagonistId)
            .map(c => c.id);
    }, [visibleCharacters, protagonistId]);

    const { spriteStates, rollbackToMessage, isInitialLoad, jumpingCharacterIds } = useVisualNovelSpriteStates({
        chatMessages,
        visibleCharacterIds: spriteCharacterIds,
        protagonistId,
        viewedMessageIndex: viewIndex,
    });

    const handleRegenerateFromMessageWithRollback = useCallback((id: string, protagonists: Character[]) => {
        const msgIndex = chatMessages.findIndex(m => m.id === id);
        if (msgIndex !== -1) rollbackToMessage(msgIndex);
        setFocusedMessageId(null);
        onRegenerateFromMessage(id, protagonists);
    }, [chatMessages, rollbackToMessage, onRegenerateFromMessage, setFocusedMessageId]);

    const handleBranchWithRollback = useCallback((id: string) => {
        const msgIndex = chatMessages.findIndex(m => m.id === id);
        if (msgIndex !== -1) rollbackToMessage(msgIndex);
        setFocusedMessageId(null);
        onBranch(id);
    }, [chatMessages, rollbackToMessage, onBranch, setFocusedMessageId]);

    const prevIsEditingRef = useRef(false);
    useEffect(() => {
        const justStarted = isEditingLastSpeaker && !prevIsEditingRef.current;
        prevIsEditingRef.current = isEditingLastSpeaker;

        if (justStarted) {
            const segments = detectFormatSegments(editDraft);
            setConversions(buildCategoryConversions(segments));
            setIsRawEditing(false);
            rawDraftRef.current = editDraft;
        } else if (!isEditingLastSpeaker) {
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
        if (isRawEditing) return rawDraftRef.current;
        return applyConversions(rawDraftRef.current, conversionMap);
    }, [isRawEditing, conversionMap]);

    useEffect(() => {
        if (!isRawEditing && isEditingLastSpeaker) {
            const converted = applyConversions(rawDraftRef.current, conversionMap);
            setEditDraft(converted);
        }
    }, [isRawEditing, conversionMap, isEditingLastSpeaker, setEditDraft]);

    useEffect(() => {
        if (isRawEditing && editTextAreaRef.current) {
            editTextAreaRef.current.focus();
        }
    }, [isRawEditing, editTextAreaRef]);

    const handleEnterRawEdit = useCallback(() => {
        rawDraftRef.current = editDraft;
        setIsRawEditing(true);
    }, [editDraft]);

    const handleExitRawEdit = useCallback(() => {
        const converted = applyConversions(rawDraftRef.current, conversionMap);
        setEditDraft(converted);
        rawDraftRef.current = converted;
        setIsRawEditing(false);
        const segments = detectFormatSegments(converted);
        setConversions(buildCategoryConversions(segments));
    }, [conversionMap, setEditDraft]);

    const handleRawChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        rawDraftRef.current = e.target.value;
        setEditDraft(e.target.value);
    }, [setEditDraft]);

    const updateConversionTarget = useCallback((category: FormatCategory, target: FormatCategory) => {
        setConversions(prev => prev.map(c => c.detected === category ? { ...c, target } : c));
        recordCategoryCorrection(rawDraftRef.current, category, target);
    }, []);

    const handleAutoReformat = useCallback(() => {
        const segments = detectFormatSegments(rawDraftRef.current);
        setConversions(buildCategoryConversionsWithLearning(rawDraftRef.current, segments));
    }, []);

    const handleCancelEditing = useCallback(() => {
        setConversions([]);
        setIsRawEditing(false);
        onCancelEditing();
    }, [onCancelEditing]);

    const handleSaveEdit = useCallback(() => {
        if (displayedMessage) {
            learnFromManualEdits(displayedMessage.textContent, editDraft);
        }
        onSaveEdit();
    }, [displayedMessage, editDraft, onSaveEdit]);

    const bgStyle: React.CSSProperties = locationBackgroundUrl
        ? { backgroundImage: `url(${locationBackgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: 'linear-gradient(to bottom, #1a1a2e, #16213e)' };

    const isMassDeletingThis = isMassActive && massDeleteId === displayedMessage?.id;

    const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        e.currentTarget.style.display = 'none';
    }, []);

    const displayText = useMemo(() => {
        if (isEditingLastSpeaker) return null;
        if (viewIndex !== null && displayedMessage) return displayedMessage.textContent;
        if (activeStreamingText) return activeStreamingText;
        if (displayedMessage) return displayedMessage.textContent;
        return null;
    }, [isEditingLastSpeaker, viewIndex, displayedMessage, activeStreamingText]);

    return (
        <div className="vn-stage-container" style={bgStyle}>
            <div className="vn-sprites-layer">
                {spriteCharacterIds.map((characterId) => {
                    const portraitUrl = portraitUrlCache.get(`character:${characterId}`) ?? null;
                    if (!portraitUrl) return null;

                    const state = spriteStates.get(characterId);
                    if (!state) return null;

                    const character = visibleCharacters.find(c => c.id === characterId);
                    if (!character) return null;

                    const isSpeaking = activeSpeaker?.id === characterId;
                    const isJumping = jumpingCharacterIds.has(characterId);

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
                            <img src={portraitUrl} alt={character.name} className="vn-sprite"
                                onError={handleImageError} />
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
                        {isAmbientSpeaker ? '✦ Narration' : (activeSpeaker ? activeSpeaker.name : 'System')}
                    </div>

                    <div className="vn-message-toolbar">
                        {isEditingLastSpeaker ? (
                            <>
                                <button type="button" className="vn-toolbar-btn vn-toolbar-cancel" onClick={handleCancelEditing} title="Cancel Edit">✕</button>
                                <button type="button" className="vn-toolbar-btn vn-toolbar-confirm" onClick={handleSaveEdit} title="Save Edit">💾</button>
                                <button type="button" className="vn-toolbar-btn vn-toolbar-warn" onClick={onRegenerateFromEdit} title="Save & Regenerate">↻</button>
                            </>
                        ) : (
                            <>
                                {isLoading && !isAmbientSpeaker && viewIndex === null && (
                                    <button type="button" className="vn-toolbar-btn vn-toolbar-danger" onClick={onStopGeneration} title="Stop Generation">⏹</button>
                                )}
                                {displayedMessage && (
                                    <>
                                        <button type="button" className="vn-toolbar-btn" onClick={() => onCopyText(displayedMessage.textContent)} title="Copy Text">📋</button>
                                        <button type="button" className="vn-toolbar-btn" onClick={() => onResumeGeneration(displayedMessage.id)} title="Continue Generation">▶</button>
                                        <button type="button" className="vn-toolbar-btn" onClick={() => handleRegenerateFromMessageWithRollback(displayedMessage.id, interactionData.protagonists)} title="Regenerate">↻</button>
                                        <button
                                            type="button"
                                            className="vn-toolbar-btn"
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
                                    <textarea ref={editTextAreaRef} value={rawDraftRef.current} onChange={handleRawChange}
                                        onBlur={handleExitRawEdit}
                                        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); handleExitRawEdit(); } }}
                                        className="vn-edit-textarea" />
                                ) : (
                                    <div className="vn-edit-preview" onClick={handleEnterRawEdit} title="Click to edit raw text">
                                        <MemoizedMessageText text={displayEditText} />
                                    </div>
                                )
                            ) : displayText ? (
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
                                            className="vn-auto-reformat-button"
                                            title="Apply learned reformatting preferences to all text"
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