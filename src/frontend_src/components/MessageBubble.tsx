// frontend_src/components/MessageBubble.tsx
import React from 'react';
import type { Character, ChatMessage, WhisperMessage } from '../types';
import { MemoizedMessageText } from './MemoizedMessageText';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { useSessionStore } from '../hooks/useSessionStore';
import { compileMessageDisplayText } from '../utilities/messageDisplayCompiler';
import {
    detectFormatSegments,
    applyConversions,
    buildCategoryConversions,
    buildCategoryConversionsWithLearning,
    recordCategoryCorrection,
    learnFromManualEdits,
    TARGET_OPTIONS,
    type CategoryConversion,
    type FormatCategory,
} from '../utilities/textDisplayReformatter';

interface MessageBubbleProps {
    message: ChatMessage | WhisperMessage;
    index: number;
    viewMode: 'ladder' | 'cinematic';
    protagonistIds: string[];
    localProtagonistId: string | null;
    editingId: string | null;
    editDraft: string;
    massDeleteId: string | null;
    isMassActive: boolean;
    massStartIndex: number | null;
    activeToolbarId: string | null;
    portraitUrl: string | null;
    displayName: string;
    isStem: boolean;
    beforeBranch: boolean;
    parentInteractionDataName?: string | null;
    onAvatarClick: (e: React.MouseEvent, id: string, character: Character) => void;
    onStartEditing: (id: string, text: string) => void;
    onCancelEditing: () => void;
    onSaveEdit: () => void;
    onRegenerateFromEdit: () => void;
    onResumeGeneration: (id: string) => void;
    onRegenerateFromMessage: (id: string, protagonistIds: string[]) => void;
    onSetMassDelete: (id: string) => void;
    onMassDeleteConfirm: () => void;
    onCancelMassDelete: () => void;
    onTouchStart: (e: React.TouchEvent, id: string) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    suppressNextClickRef: React.MutableRefObject<boolean>;
    editTextAreaRef: React.RefObject<HTMLTextAreaElement | null>;
    setEditDraft: (text: string) => void;
    onNavigateToBranchSource: () => void;
    canDelete: boolean;
}

const AMBIENT_NARRATOR_ID = '___ambient_narrator___';

export const MessageBubble = React.memo(function MessageBubble({
    message, index, viewMode, protagonistIds, localProtagonistId,
    editingId, editDraft, massDeleteId, isMassActive, massStartIndex,
    activeToolbarId, portraitUrl, displayName, isStem, beforeBranch,
    parentInteractionDataName,
    onAvatarClick, onStartEditing, onCancelEditing, onSaveEdit, onRegenerateFromEdit,
    onResumeGeneration, onRegenerateFromMessage,
    onSetMassDelete,
    onMassDeleteConfirm, onCancelMassDelete,
    onTouchStart, onTouchEnd, onTouchMove,
    suppressNextClickRef, editTextAreaRef, setEditDraft,
    onNavigateToBranchSource,
    canDelete,
}: MessageBubbleProps) {
    const isModelReady = useSessionStore(s => {
        if (s.activeStrategy) return true;
        const m = s.selectedModel;
        if (!m) return false;
        if (m.apiKey && m.backend) return true;
        const status = s.runningModels[m.id];
        return status?.isRunning && status?.isIdle;
    });

    const isLoading = useSessionStore(s => s.isLoading);
    
    // ✅ Pulled directly from Zustand to eliminate prop drilling
    const copyToClipboard = useSessionStore(s => s.copyToClipboard);
    const deleteMessage = useSessionStore(s => s.deleteMessage);
    const branchChat = useSessionStore(s => s.branchChat);
    const cloneChat = useSessionStore(s => s.cloneChat);

    // ✅ Read display preferences directly from Zustand for on-the-fly compilation
    const participants = useSessionStore(s => s.interactionData?.participants || []);
    const displayMode = useSessionStore(s => s.interactionData?.profile?.toolUsageDisplayMode);

    const [conversions, setConversions] = React.useState<CategoryConversion[]>([]);
    const [isRawEditing, setIsRawEditing] = React.useState(false);
    const [editTokenCount, setEditTokenCount] = React.useState(0);
    const rawDraftRef = React.useRef<string>('');
    const editTokenDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevIsEditingRef = React.useRef(false);

    const isAmbient = message.character.id === AMBIENT_NARRATOR_ID;
    const isLocalProtagonist = localProtagonistId ? message.character.id === localProtagonistId : false;
    const isEditing = editingId === message.id;
    const inDelRange = isMassActive && massStartIndex !== null && massStartIndex !== -1 && index >= massStartIndex;
    const showAvatar = viewMode === 'ladder' && !isLocalProtagonist && !isAmbient;
    const isWhisper = message.messageType === 'whisper';

    React.useEffect(() => {
        const justStartedEditing = isEditing && !prevIsEditingRef.current;
        prevIsEditingRef.current = isEditing;

        if (justStartedEditing) {
            const segments = detectFormatSegments(editDraft);
            setConversions(buildCategoryConversions(segments));
            setIsRawEditing(false);
            rawDraftRef.current = editDraft;
        }
    }, [isEditing, editDraft]);

    React.useEffect(() => {
        if (isRawEditing && editTextAreaRef.current) {
            editTextAreaRef.current.focus();
        }
    }, [isRawEditing, editTextAreaRef]);

    React.useEffect(() => {
        if (!isEditing || editingId !== message.id || !editDraft) {
            setEditTokenCount(0);
            return;
        }
        if (editTokenDebounceRef.current) clearTimeout(editTokenDebounceRef.current);
        let cancelled = false;
        editTokenDebounceRef.current = setTimeout(async () => {
            const count = await getLanguageModelEngine().countTokens(editDraft);
            if (!cancelled) setEditTokenCount(count);
        }, 400);
        return () => { cancelled = true; if (editTokenDebounceRef.current) clearTimeout(editTokenDebounceRef.current); };
    }, [isEditing, editingId, message.id, editDraft]);

    const conversionMap = React.useMemo(() => {
        const map: Record<FormatCategory, FormatCategory> = {} as Record<FormatCategory, FormatCategory>;
        for (const c of conversions) map[c.detected] = c.target;
        return map;
    }, [conversions]);

    const displayText = React.useMemo(() => {
        if (isRawEditing) return rawDraftRef.current;
        return applyConversions(rawDraftRef.current, conversionMap);
    }, [isRawEditing, conversionMap]);

    React.useEffect(() => {
        if (!isRawEditing && isEditing) {
            const converted = applyConversions(rawDraftRef.current, conversionMap);
            setEditDraft(converted);
        }
    }, [isRawEditing, conversionMap, isEditing, setEditDraft]);

    const handleEnterRawEdit = React.useCallback(() => {
        rawDraftRef.current = editDraft;
        setIsRawEditing(true);
    }, [editDraft]);

    const handleExitRawEdit = React.useCallback(() => {
        const converted = applyConversions(rawDraftRef.current, conversionMap);
        setEditDraft(converted);
        rawDraftRef.current = converted;
        setIsRawEditing(false);

        const segments = detectFormatSegments(converted);
        setConversions(buildCategoryConversions(segments));
    }, [conversionMap, setEditDraft]);

    const handleRawChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        rawDraftRef.current = e.target.value;
        setEditDraft(e.target.value);
    }, [setEditDraft]);

    const updateConversionTarget = React.useCallback((category: FormatCategory, target: FormatCategory) => {
        setConversions(prev => prev.map(c =>
            c.detected === category ? { ...c, target } : c
        ));
        recordCategoryCorrection(rawDraftRef.current, category, target);
    }, []);

    const handleAutoReformat = React.useCallback(() => {
        const segments = detectFormatSegments(rawDraftRef.current);
        setConversions(buildCategoryConversionsWithLearning(rawDraftRef.current, segments));
    }, []);

    const canAutoReformat = React.useMemo(() => {
        if (!editDraft || conversions.length === 0) return false;
        const segments = detectFormatSegments(editDraft);
        if (segments.length === 0) return false;

        const learned = buildCategoryConversionsWithLearning(editDraft, segments);
        return learned.some(c => {
            const current = conversions.find(curr => curr.detected === c.detected);
            return c.target !== c.detected && (!current || current.target !== c.target);
        });
    }, [editDraft, conversions]);

    const handleCancelEditing = React.useCallback(() => {
        setConversions([]);
        setIsRawEditing(false);
        setEditTokenCount(0);
        onCancelEditing();
    }, [onCancelEditing]);

    const handleSaveEdit = React.useCallback(() => {
        // Learns from raw textContent to raw editDraft
        learnFromManualEdits(message.textContent, editDraft);
        onSaveEdit();
    }, [message.textContent, editDraft, onSaveEdit]);

    const rowClass = [
        'message-row',
        viewMode === 'cinematic' ? '' : isLocalProtagonist ? 'message-right' : 'message-left',
        inDelRange ? 'message-fading-out' : '',
    ].filter(Boolean).join(' ');

    const bubbleClass = [
        'message-bubble',
        viewMode === 'cinematic' ? 'cinematic-bubble' : '',
        isLocalProtagonist ? 'bubble-user' : 'bubble-ai',
        isAmbient ? 'bubble-ambient' : '',
        isWhisper ? 'bubble-whisper' : '',
        isEditing ? 'bubble-editing' : '',
        inDelRange ? 'bubble-marked-for-delete' : '',
        isStem ? 'bubble-stem' : '',
        activeToolbarId === message.id ? 'toolbar-active' : '',
    ].filter(Boolean).join(' ');

    // ✅ Compile on the fly! 
    // This memoization ensures it only recompiles when the raw text, the display mode, 
    // or the participant list actually changes.
    const displayedTextContent = React.useMemo(() => {
        return compileMessageDisplayText(message.textContent, displayMode, participants, message.character, message.toolExecutionResults);
    }, [message.textContent, displayMode, participants, message.character]);

    return (
        <React.Fragment>
            <div className={rowClass} data-message-id={message.id}>
                {showAvatar && (
                    <div className="avatar-column">
                        <div style={{ position: 'relative' }}>
                            {portraitUrl
                                ? (
                                    <img
                                        src={portraitUrl}
                                        alt={displayName}
                                        className="character-avatar"
                                        onClick={e => onAvatarClick(e, message.id, message.character)}
                                        onError={e => { e.currentTarget.style.display = 'none'; }}
                                        style={{ cursor: 'pointer' }}
                                    />
                                )
                                : (
                                    <div
                                        className="character-avatar placeholder"
                                        onClick={e => onAvatarClick(e, message.id, message.character)}
                                        style={{ cursor: 'pointer' }}
                                    />
                                )}
                        </div>
                        <span className="avatar-name">{displayName}</span>
                    </div>
                )}

                <div
                    className={bubbleClass}
                    onTouchStart={e => onTouchStart(e, message.id)}
                    onTouchEnd={onTouchEnd}
                    onTouchMove={onTouchMove}
                    onClick={e => {
                        if (suppressNextClickRef.current) {
                            e.preventDefault();
                            e.stopPropagation();
                            suppressNextClickRef.current = false;
                        }
                    }}
                >
                    {viewMode === 'cinematic' && (
                        <div className={`cinematic-bubble-header ${isAmbient ? 'cinematic-bubble-header-ambient' : ''}`}>
                            <span>{isAmbient ? '✦' : displayName}</span>
                        </div>
                    )}

                    {isEditing ? (
                        <div className="edit-mode">
                            {isRawEditing ? (
                                <textarea
                                    ref={editTextAreaRef}
                                    value={rawDraftRef.current}
                                    onChange={handleRawChange}
                                    onBlur={handleExitRawEdit}
                                    onKeyDown={e => {
                                        if (e.key === 'Escape') {
                                            e.preventDefault();
                                            handleExitRawEdit();
                                        }
                                    }}
                                    className="edit-textarea"
                                />
                            ) : (
                                <div
                                    className="message-text edit-preview"
                                    onClick={handleEnterRawEdit}
                                    title="Click to edit raw text"
                                    style={{
                                        padding: '8px',
                                        minHeight: '60px',
                                        borderRadius: '6px',
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid var(--accent-border)',
                                        cursor: 'text',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                    }}
                                >
                                    <MemoizedMessageText text={displayText} />
                                </div>
                            )}

                            <div style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: '2px', textAlign: 'right' }}>
                                ~{editTokenCount} token(s)
                            </div>

                            <div className="message-reformat-panel">
                                {conversions.length === 0 ? (
                                    <div className="message-reformat-empty">
                                        No formatting detected. Click the text above to edit.
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={handleAutoReformat}
                                            disabled={!canAutoReformat}
                                            className="auto-reformat-button"
                                            title={canAutoReformat ? "Apply learned reformatting preferences to all text" : "No new learned formatting changes available"}
                                            style={!canAutoReformat ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                                        >
                                            Auto-Reformat
                                        </button>
                                        <div className="message-reformat-grid">
                                            {conversions.map(conversion => (
                                                <div key={conversion.detected} className="message-reformat-row">
                                                    <span className="message-reformat-label">
                                                        {conversion.label}
                                                        <span className="message-reformat-count">×{conversion.count}</span>
                                                    </span>
                                                    <span className="message-reformat-arrow">→</span>
                                                    <select
                                                        className="message-reformat-select"
                                                        value={conversion.target}
                                                        onChange={e => updateConversionTarget(conversion.detected, e.target.value as FormatCategory)}
                                                    >
                                                        {TARGET_OPTIONS.map(option => (
                                                            <option key={option.value} value={option.value}>
                                                                {option.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="edit-actions">
                                <button
                                    type="button"
                                    onClick={handleCancelEditing}
                                    className="edit-button edit-button-cancel"
                                >
                                    Cancel
                                </button>

                                <button
                                    type="button"
                                    onClick={onRegenerateFromEdit}
                                    disabled={!isModelReady || isLoading}
                                    className="edit-button edit-button-regenerate"
                                    title={isLoading ? 'Generation in progress...' : 'Save changes and regenerate response'}
                                    style={!isModelReady || isLoading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                                >
                                    Regenerate
                                </button>

                                <button
                                    type="button"
                                    onClick={handleSaveEdit}
                                    className="edit-button edit-button-save"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* DISPLAY LAYER: Compiles raw textContent on the fly based on current profile settings */}
                            <MemoizedMessageText text={displayedTextContent} />

                            {message.files && message.files.length > 0 && (
                                <div className="message-attachment-indicator" title={`${message.files.length} attached file${message.files.length !== 1 ? 's' : ''}`}>
                                    📎 {message.files.length}
                                </div>
                            )}

                            <div className="message-toolbar">
                                {isStem ? (
                                    <span className="toolbar-lock">🔒 Locked</span>
                                ) : !isMassActive ? (
                                    <>
                                        {!isLocalProtagonist && (
                                            <button
                                                type="button"
                                                onClick={() => onResumeGeneration(message.id)}
                                                disabled={!isModelReady || isLoading}
                                                className="toolbar-button"
                                                title={isLoading ? 'Generation in progress...' : 'Resume interrupted generation'}
                                                style={!isModelReady || isLoading ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                            >
                                                ▶
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => copyToClipboard(displayedTextContent)}
                                            className="toolbar-button"
                                            title="Copy text to clipboard"
                                        >
                                            📋
                                        </button>

                                        <button
                                            type="button"
                                            // EDIT LAYER: Always passes raw textContent to the editor
                                            onClick={() => onStartEditing(message.id, message.textContent)}
                                            disabled={isLoading}
                                            className="toolbar-button"
                                            title={isLoading ? 'Generation in progress...' : 'Edit message'}
                                            style={isLoading ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                        >
                                            ✎
                                        </button>

                                        {!isLocalProtagonist && (
                                            <button
                                                type="button"
                                                onClick={() => onRegenerateFromMessage(message.id, protagonistIds)}
                                                disabled={!isModelReady || isLoading}
                                                className="toolbar-button"
                                                title={isLoading ? 'Regeneration in progress...' : 'Regenerate this Response'}
                                                style={!isModelReady || isLoading ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                            >
                                                ↻
                                            </button>
                                        )}

                                        {isLocalProtagonist && (
                                            <button
                                                type="button"
                                                onClick={() => onRegenerateFromMessage(message.id, protagonistIds)}
                                                disabled={!isModelReady || isLoading}
                                                className="toolbar-button"
                                                title={isLoading ? 'Regeneration in progress...' : 'Regenerate Your Input'}
                                                style={!isModelReady || isLoading ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                            >
                                                ↻
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => branchChat(message.id)}
                                            className="toolbar-button"
                                            title="Branch from here"
                                        >
                                            🌿
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => cloneChat(message.id)}
                                            className="toolbar-button"
                                            title="Clone chat up to here"
                                        >
                                            ⑂
                                        </button>

                                        {canDelete && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => deleteMessage(message.id)}
                                                    className="toolbar-button delete-button"
                                                    style={{ color: '#ff4444' }}
                                                >
                                                    🗑
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => onSetMassDelete(message.id)}
                                                    className="toolbar-button mass-delete-button"
                                                    style={{ color: '#ff9900' }}
                                                >
                                                    🗑️↓
                                                </button>
                                            </>
                                        )}
                                    </>
                                ) : massDeleteId === message.id ? (
                                    <div className="mass-delete-confirm-bar">
                                        <span>Delete from here?</span>

                                        <button
                                            type="button"
                                            onClick={onMassDeleteConfirm}
                                            className="toolbar-button button-confirm"
                                        >
                                            Confirm
                                        </button>

                                        <button
                                            type="button"
                                            onClick={onCancelMassDelete}
                                            className="toolbar-button button-cancel"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : inDelRange ? (
                                    <span className="deleted-preview-label">Will be deleted</span>
                                ) : null}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {beforeBranch && (
                <div className="branch-separator-line">
                    <button
                        type="button"
                        className="branch-separator-content"
                        onClick={onNavigateToBranchSource}
                        title="Click to go back to source chat"
                    >
                        <span className="branch-separator-icon">🌿</span>
                        <span className="branch-separator-text">
                            Timeline Branches From {parentInteractionDataName || 'Unknown Chat'}
                        </span>
                        <span className="branch-separator-icon">🌿</span>
                    </button>
                </div>
            )}
        </React.Fragment>
    );
});