// src/components/MessageBubble.tsx
import React from 'react';
import type { Character, ChatMessage } from '../types';
import { MemoizedMessageText } from './MemoizedMessageText';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { useSessionStore } from '../hooks/useSessionStore';
import {
    detectFormatSegments,
    applyConversions,
    buildCategoryConversions,
    TARGET_OPTIONS,
    type CategoryConversion,
    type FormatCategory,
    type TargetFormat,
} from '../utilities/textReformatter';

interface MessageBubbleProps {
    message: ChatMessage;
    index: number;
    viewMode: 'ladder' | 'cinematic';
    currentCharacterId: string | undefined;
    editingId: string | null;
    editDraft: string;
    massDeleteId: string | null;
    isMassActive: boolean;
    massStartIndex: number;
    activeToolbarId: string | null;
    portraitUrl: string | null;
    displayName: string;
    isStem: boolean;
    beforeBranch: boolean;
    onAvatarClick: (e: React.MouseEvent, id: string, char: Character) => void;
    onStartEditing: (id: string, text: string) => void;
    onCancelEditing: () => void;
    onSaveEdit: () => void;
    onRegenerateFromEdit: () => void;
    onResumeGeneration: (id: string) => void;
    onCopyText: (text: string) => void;
    onRegenerateFromMessage: (id: string, type: 'ai' | 'user') => void;
    onBranch: (id: string) => void;
    onClone: (id: string) => void;
    onDelete: (id: string) => void;
    onSetMassDelete: (id: string) => void;
    onMassDeleteConfirm: () => void;
    onCancelMassDelete: () => void;
    onTouchStart: (e: React.TouchEvent, id: string) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchMove: () => void;
    suppressNextClickRef: React.MutableRefObject<boolean>;
    editTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
    setEditDraft: (text: string) => void;
    onNavigateToBranchSource?: () => void;
}

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

export const MessageBubble = React.memo(function MessageBubble({
    message, index, viewMode, currentCharacterId,
    editingId, editDraft, massDeleteId, isMassActive, massStartIndex,
    activeToolbarId, portraitUrl, displayName, isStem, beforeBranch,
    onAvatarClick, onStartEditing, onCancelEditing, onSaveEdit, onRegenerateFromEdit,
    onResumeGeneration, onCopyText, onRegenerateFromMessage,
    onBranch, onClone, onDelete, onSetMassDelete,
    onMassDeleteConfirm, onCancelMassDelete,
    onTouchStart, onTouchEnd, onTouchMove,
    suppressNextClickRef, editTextareaRef, setEditDraft,
    onNavigateToBranchSource,
}: MessageBubbleProps) {
    const isModelReady = useSessionStore(s => {
        if (s.activeStrategy) return true;
        const m = s.selectedModel;
        if (!m) return false;
        if (m.apiKey && m.backend) return true;
        const status = s.runningModels[m.id];
        return status?.isRunning === true && status?.isIdle === true;
    });

    const isLoading = useSessionStore(s => s.isLoading);

    const [conversions, setConversions] = React.useState<CategoryConversion[]>([]);
    const [isRawEditing, setIsRawEditing] = React.useState(false);
    const [editTokenCount, setEditTokenCount] = React.useState(0);
    const rawDraftRef = React.useRef<string>('');
    const editTokenDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const isAmbient = message.character.id === AMBIENT_NARRATOR_ID;
    const isProtag = message.character.id === currentCharacterId;
    const isEditing = editingId === message.id;
    const inDelRange = isMassActive && massStartIndex !== -1 && index >= massStartIndex;
    const showAvatar = viewMode === 'ladder' && !isProtag && !isAmbient;

    React.useEffect(() => {
        if (isEditing) {
            const segments = detectFormatSegments(editDraft);
            setConversions(buildCategoryConversions(segments));
            setIsRawEditing(false);
            rawDraftRef.current = editDraft;
        }
    }, [isEditing, editDraft]);

    // Focus textarea when entering raw edit mode
    React.useEffect(() => {
        if (isRawEditing && editTextareaRef.current) {
            editTextareaRef.current.focus();
        }
    }, [isRawEditing, editTextareaRef]);

    // Debounced token count during editing
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
        const map: Record<FormatCategory, TargetFormat> = {};
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

    const updateConversionTarget = React.useCallback((category: FormatCategory, target: TargetFormat) => {
        setConversions(prev => prev.map(c =>
            c.detected === category ? { ...c, target } : c
        ));
    }, []);

    const handleCancelEditing = React.useCallback(() => {
        setConversions([]);
        setIsRawEditing(false);
        setEditTokenCount(0);
        onCancelEditing();
    }, [onCancelEditing]);

    const rowClass = [
        'message-row',
        viewMode === 'cinematic' ? '' : isProtag ? 'message-right' : 'message-left',
        inDelRange ? 'message-fading-out' : '',
    ].filter(Boolean).join(' ');

    const bubbleClass = [
        'message-bubble',
        viewMode === 'cinematic' ? 'cinematic-bubble' : '',
        isProtag ? 'bubble-user' : 'bubble-ai',
        isAmbient ? 'bubble-ambient' : '',
        isEditing ? 'bubble-editing' : '',
        inDelRange ? 'bubble-marked-for-delete' : '',
        isStem ? 'bubble-stem' : '',
        activeToolbarId === message.id ? 'toolbar-active' : '',
    ].filter(Boolean).join(' ');

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
                                    ref={editTextareaRef}
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

                            {/* Token count */}
                            <div style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: '2px', textAlign: 'right' }}>
                                ~{editTokenCount} token(s)
                            </div>

                            {/* Conversion panel */}
                            <div className="message-reformat-panel">
                                {conversions.length === 0 ? (
                                    <div className="message-reformat-empty">
                                        No formatting detected. Click the text above to edit.
                                    </div>
                                ) : (
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
                                                    onChange={e => updateConversionTarget(conversion.detected, e.target.value as TargetFormat)}
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
                                    onClick={onSaveEdit}
                                    className="edit-button edit-button-save"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <MemoizedMessageText text={message.textContent} />

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
                                        {!isProtag && message.isPartial && (
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
                                            onClick={() => onCopyText(message.textContent)}
                                            className="toolbar-button"
                                            title="Copy text to clipboard"
                                        >
                                            📋
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onStartEditing(message.id, message.textContent)}
                                            className="toolbar-button"
                                        >
                                            ✎
                                        </button>

                                        {!isProtag && (
                                            <button
                                                type="button"
                                                onClick={() => onRegenerateFromMessage(message.id, 'ai')}
                                                disabled={!isModelReady || isLoading}
                                                className="toolbar-button"
                                                title={isLoading ? 'Regeneration in progress...' : 'Regenerate this Response'}
                                                style={!isModelReady || isLoading ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                            >
                                                ↻
                                            </button>
                                        )}

                                        {isProtag && (
                                            <button
                                                type="button"
                                                onClick={() => onRegenerateFromMessage(message.id, 'user')}
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
                                            onClick={() => onBranch(message.id)}
                                            className="toolbar-button"
                                            title="Branch from here"
                                        >
                                            🌿
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onClone(message.id)}
                                            className="toolbar-button"
                                            title="Clone chat up to here"
                                        >
                                            ⑂
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onDelete(message.id)}
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
                <button
                    type="button"
                    className="branch-separator-line clickable"
                    onClick={onNavigateToBranchSource}
                    title="Click to go back to source chat"
                    style={{ cursor: 'pointer' }}
                >
                    <span className="branch-separator-content">
                        <span className="branch-separator-icon">🌿</span>
                        <span className="branch-separator-text">Timeline Branches Here</span>
                        <span className="branch-separator-icon">🌿</span>
                    </span>
                </button>
            )}
        </React.Fragment>
    );
});