// src/components/MessageBubble.tsx
import React from 'react';
import type { Character, ChatMessage } from '../types';
import { MemoizedMessageText } from './MemoizedMessageText';
import { useSessionStore } from '../store/useSessionStore';

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

type FormatCategory = 'plain' | 'italics' | 'bold' | 'strikethrough' | 'quotes' | 'parentheses' | 'brackets';
type TargetFormat = FormatCategory;

interface DetectedSegment {
    start: number;
    end: number;
    category: FormatCategory;
    innerText: string;
    rawMatch: string;
}

interface CategoryConversion {
    detected: FormatCategory;
    label: string;
    target: TargetFormat;
    count: number;
}

const CATEGORY_LABELS: Record<FormatCategory, string> = {
    plain: 'Plain Text',
    italics: 'Italics',
    bold: 'Bold',
    strikethrough: 'Strikethrough',
    quotes: 'Quotation Marks',
    parentheses: 'Parentheses',
    brackets: 'Square Brackets',
};

const TARGET_OPTIONS: { value: TargetFormat; label: string }[] = [
    { value: 'plain', label: 'Plain Text' },
    { value: 'italics', label: 'Italics' },
    { value: 'parentheses', label: 'Parentheses' },
    { value: 'brackets', label: 'Square Brackets' },
    { value: 'quotes', label: 'Quotation Marks' },
    { value: 'bold', label: 'Bold' },
    { value: 'strikethrough', label: 'Strikethrough' },
    
];

const DEFAULT_CONVERSIONS: Record<FormatCategory, TargetFormat> = {
    plain: 'plain',
    italics: 'italics',
    parentheses: 'parentheses',
    brackets: 'brackets',
    quotes: 'quotes',
    bold: 'bold',
    strikethrough: 'strikethrough',
};

function detectFormatSegments(text: string): DetectedSegment[] {
    const patterns: { regex: RegExp; category: FormatCategory; innerGroup: number }[] = [
        { regex: /\*\*(.+?)\*\*/gs, category: 'bold', innerGroup: 1 },
        { regex: /__(.+?)__/gs, category: 'bold', innerGroup: 1 },
        { regex: /~~(.+?)~~/gs, category: 'strikethrough', innerGroup: 1 },
        { regex: /\*(.+?)\*/gs, category: 'italics', innerGroup: 1 },
        { regex: /_(.+?)_/gs, category: 'italics', innerGroup: 1 },
        { regex: /["\u201C](.+?)["\u201D]/gs, category: 'quotes', innerGroup: 1 },
        { regex: /\(([^)]+)\)/gs, category: 'parentheses', innerGroup: 1 },
        { regex: /\[([^\]]+)\]/gs, category: 'brackets', innerGroup: 1 },
    ];

    interface RawMatch {
        start: number;
        end: number;
        category: FormatCategory;
        innerText: string;
        rawMatch: string;
    }

    const allMatches: RawMatch[] = [];

    for (const { regex, category, innerGroup } of patterns) {
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            if (match[0].length === 0) {
                regex.lastIndex++;
                continue;
            }

            allMatches.push({
                start: match.index,
                end: match.index + match[0].length,
                category,
                innerText: match[innerGroup] || '',
                rawMatch: match[0],
            });
        }
    }

    allMatches.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return (b.end - b.start) - (a.end - a.start);
    });

    const accepted: RawMatch[] = [];
    let cursor = 0;

    for (const match of allMatches) {
        if (match.start < cursor) continue;
        accepted.push(match);
        cursor = match.end;
    }

    const segments: DetectedSegment[] = [];
    let pos = 0;

    for (const match of accepted) {
        if (match.start > pos) {
            const plainGap = text.slice(pos, match.start);

            if (plainGap.trim().length > 0) {
                segments.push({
                    start: pos,
                    end: match.start,
                    category: 'plain',
                    innerText: plainGap,
                    rawMatch: plainGap,
                });
            }
        }

        segments.push({
            start: match.start,
            end: match.end,
            category: match.category,
            innerText: match.innerText,
            rawMatch: match.rawMatch,
        });

        pos = match.end;
    }

    if (pos < text.length) {
        const trailing = text.slice(pos);

        if (trailing.trim().length > 0) {
            segments.push({
                start: pos,
                end: text.length,
                category: 'plain',
                innerText: trailing,
                rawMatch: trailing,
            });
        }
    }

    return segments;
}

function wrapCoreText(core: string, target: TargetFormat): string {
    switch (target) {
        case 'italics':
            return `*${core}*`;
        case 'bold':
            return `**${core}**`;
        case 'strikethrough':
            return `~~${core}~~`;
        case 'quotes':
            return `"${core}"`;
        case 'parentheses':
            return `(${core})`;
        case 'brackets':
            return `[${core}]`;
        case 'plain':
        default:
            return core;
    }
}

function convertPlainSegmentPreservingSpacing(raw: string, target: TargetFormat): string {
    if (target === 'plain') return raw;

    const parts = raw.split(/(\r?\n)/);

    return parts.map(part => {
        if (part === '\n' || part === '\r\n') return part;
        if (part.trim().length === 0) return part;

        const match = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
        if (!match) return part;

        const leading = match[1] ?? '';
        const core = match[2] ?? '';
        const trailing = match[3] ?? '';

        if (!core) return part;

        return `${leading}${wrapCoreText(core, target)}${trailing}`;
    }).join('');
}

function convertFormattedSegmentPreservingSpacing(seg: DetectedSegment, target: TargetFormat): string {
    if (target === seg.category) return seg.rawMatch;

    if (target === 'plain') {
        return seg.innerText;
    }

    return wrapCoreText(seg.innerText, target);
}

function applyConversions(
    text: string,
    conversions: Record<FormatCategory, TargetFormat>,
): string {
    const segments = detectFormatSegments(text);
    if (segments.length === 0) return text;

    const replacements: { start: number; end: number; replacement: string }[] = [];

    for (const seg of segments) {
        const target = conversions[seg.category];

        if (target === seg.category) continue;

        const replacement = seg.category === 'plain'
            ? convertPlainSegmentPreservingSpacing(seg.rawMatch, target)
            : convertFormattedSegmentPreservingSpacing(seg, target);

        if (replacement !== seg.rawMatch) {
            replacements.push({
                start: seg.start,
                end: seg.end,
                replacement,
            });
        }
    }

    if (replacements.length === 0) return text;

    let output = text;

    for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        output = output.slice(0, r.start) + r.replacement + output.slice(r.end);
    }

    return output;
}

function buildCategoryConversions(segments: DetectedSegment[]): CategoryConversion[] {
    const counts: Record<FormatCategory, number> = {
        plain: 0,
        italics: 0,
        bold: 0,
        strikethrough: 0,
        quotes: 0,
        parentheses: 0,
        brackets: 0,
    };

    for (const seg of segments) {
        counts[seg.category]++;
    }

    const order: FormatCategory[] = ['plain', 'italics', 'bold', 'strikethrough', 'quotes', 'parentheses', 'brackets'];

    return order
        .filter(category => counts[category] > 0)
        .map(category => ({
            detected: category,
            label: CATEGORY_LABELS[category],
            target: DEFAULT_CONVERSIONS[category],
            count: counts[category],
        }));
}

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

    const [showReformat, setShowReformat] = React.useState(false);
    const [conversions, setConversions] = React.useState<CategoryConversion[]>([]);
    const preReformatDraftRef = React.useRef<string | null>(null);

    const isAmbient = message.character.id === AMBIENT_NARRATOR_ID;
    const isProtag = message.character.id === currentCharacterId;
    const isEditing = editingId === message.id;
    const inDelRange = isMassActive && massStartIndex !== -1 && index >= massStartIndex;
    const showAvatar = viewMode === 'ladder' && !isProtag && !isAmbient;
    const isResumingThisMessage = isLoading && message.isPartial && !isProtag;

    React.useEffect(() => {
        if (isEditing) {
            setShowReformat(false);
            setConversions([]);
            preReformatDraftRef.current = null;
        }
    }, [isEditing, message.id]);

    const handleOpenReformat = React.useCallback(() => {
        preReformatDraftRef.current = editDraft;

        const segments = detectFormatSegments(editDraft);
        const detectedConversions = buildCategoryConversions(segments);

        setConversions(detectedConversions);

        const map: Record<FormatCategory, TargetFormat> = { ...DEFAULT_CONVERSIONS };
        for (const conversion of detectedConversions) {
            map[conversion.detected] = conversion.target;
        }

        const converted = applyConversions(editDraft, map);
        if (converted !== editDraft) setEditDraft(converted);

        setShowReformat(true);
    }, [editDraft, setEditDraft]);

    const updateConversionTarget = React.useCallback((category: FormatCategory, target: TargetFormat) => {
        setConversions(prev => {
            const next = prev.map(conversion =>
                conversion.detected === category
                    ? { ...conversion, target }
                    : conversion
            );

            const original = preReformatDraftRef.current;

            if (original !== null) {
                const map: Record<FormatCategory, TargetFormat> = { ...DEFAULT_CONVERSIONS };

                for (const conversion of next) {
                    map[conversion.detected] = conversion.target;
                }

                const converted = applyConversions(original, map);
                setEditDraft(converted);
            }

            return next;
        });
    }, [setEditDraft]);

    // Accept reformat: save immediately so the message renders with styled formatting
    const handleAcceptReformat = React.useCallback(() => {
        // Clear reformat state
        preReformatDraftRef.current = null;
        setConversions([]);
        setShowReformat(false);

        // Save the converted text — this exits edit mode and renders through MemoizedMessageText
        onSaveEdit();
    }, [onSaveEdit]);

    const handleCancelEditing = React.useCallback(() => {
        if (showReformat && preReformatDraftRef.current !== null) {
            setEditDraft(preReformatDraftRef.current);
            preReformatDraftRef.current = null;
            setShowReformat(false);
            setConversions([]);
        }

        onCancelEditing();
    }, [showReformat, setEditDraft, onCancelEditing]);

    if (isResumingThisMessage) return null;

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
                                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
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
                            {showReformat ? (
                                <>
                                    {/* Styled preview — read-only display of converted text */}
                                    <div
                                        className="message-text edit-preview"
                                        style={{
                                            padding: '8px',
                                            minHeight: '60px',
                                            borderRadius: '6px',
                                            background: 'rgba(255,255,255,0.04)',
                                            border: '1px solid rgba(120, 200, 255, 0.35)',
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word',
                                        }}
                                    >
                                        <MemoizedMessageText text={editDraft} />
                                    </div>

                                    {/* Conversion panel */}
                                    <div
                                        className="message-reformat-panel"
                                        style={{
                                            marginTop: '8px',
                                            padding: '10px',
                                            border: '1px solid rgba(120, 200, 255, 0.35)',
                                            borderRadius: '8px',
                                            background: 'rgba(0,0,0,0.18)',
                                        }}
                                    >
                                        <div className="entity-ref-hint" style={{ marginBottom: '8px', fontSize: '0.85em', opacity: 0.85 }}>
                                            Adjust target formats below. Preview updates live.
                                        </div>

                                        {conversions.length === 0 ? (
                                            <div style={{ fontSize: '0.85em', opacity: 0.6, padding: '4px 0' }}>
                                                No formatting detected in this message.
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                {conversions.map(conversion => (
                                                    <div
                                                        key={conversion.detected}
                                                        style={{
                                                            display: 'grid',
                                                            gridTemplateColumns: 'minmax(220px, 1fr) 24px 220px',
                                                            gap: '8px',
                                                            alignItems: 'center',
                                                        }}
                                                    >
                                                        <span style={{ fontSize: '0.85em', opacity: 0.9 }}>
                                                            {conversion.label}
                                                            <span style={{ opacity: 0.5, marginLeft: '6px' }}>×{conversion.count}</span>
                                                        </span>

                                                        <span style={{ opacity: 0.5, textAlign: 'center' }}>→</span>

                                                        <select
                                                            className="editor-input"
                                                            value={conversion.target}
                                                            onChange={e => updateConversionTarget(conversion.detected, e.target.value as TargetFormat)}
                                                            style={{
                                                                width: '220px',
                                                                minWidth: '220px',
                                                                maxWidth: '220px',
                                                            }}
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

                                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                                            <button
                                                type="button"
                                                className="edit-btn edit-btn-save"
                                                onClick={handleAcceptReformat}
                                                title="Save with formatting applied"
                                            >
                                                Accept Reformat
                                            </button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    {/* Raw textarea for normal editing */}
                                    <textarea
                                        ref={editTextareaRef}
                                        value={editDraft}
                                        onChange={e => setEditDraft(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                onSaveEdit();
                                            }

                                            if (e.key === 'Escape') handleCancelEditing();
                                        }}
                                        className="edit-textarea"
                                    />

                                    <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                                        <button
                                            type="button"
                                            className="edit-btn edit-btn-cancel"
                                            onClick={handleOpenReformat}
                                            title="Detect and convert message formatting"
                                        >
                                            Reformat
                                        </button>
                                    </div>
                                </>
                            )}

                            <div className="edit-actions">
                                <button
                                    type="button"
                                    onClick={handleCancelEditing}
                                    className="edit-btn edit-btn-cancel"
                                >
                                    Cancel
                                </button>

                                <button
                                    type="button"
                                    onClick={onRegenerateFromEdit}
                                    disabled={!isModelReady || isLoading}
                                    className="edit-btn edit-btn-regenerate"
                                    title="Save changes and regenerate response"
                                    style={!isModelReady || isLoading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                                >
                                    Regenerate
                                </button>

                                <button
                                    type="button"
                                    onClick={onSaveEdit}
                                    className="edit-btn edit-btn-save"
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
                                                disabled={!isModelReady}
                                                className="toolbar-btn"
                                                title="Resume interrupted generation"
                                                style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                            >
                                                ▶
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => onCopyText(message.textContent)}
                                            className="toolbar-btn"
                                            title="Copy text to clipboard"
                                        >
                                            📋
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onStartEditing(message.id, message.textContent)}
                                            className="toolbar-btn"
                                        >
                                            ✎
                                        </button>

                                        {!isProtag && (
                                            <button
                                                type="button"
                                                onClick={() => onRegenerateFromMessage(message.id, 'ai')}
                                                disabled={!isModelReady}
                                                className="toolbar-btn"
                                                title="Regenerate this Response"
                                                style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                            >
                                                ↻
                                            </button>
                                        )}

                                        {isProtag && (
                                            <button
                                                type="button"
                                                onClick={() => onRegenerateFromMessage(message.id, 'user')}
                                                disabled={!isModelReady}
                                                className="toolbar-btn"
                                                title="Regenerate Your Input"
                                                style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                                            >
                                                ↻
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => onBranch(message.id)}
                                            className="toolbar-btn"
                                            title="Branch from here"
                                        >
                                            🌿
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onClone(message.id)}
                                            className="toolbar-btn"
                                            title="Clone chat up to here"
                                        >
                                            ⑂
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onDelete(message.id)}
                                            className="toolbar-btn delete-btn"
                                            style={{ color: '#ff4444' }}
                                        >
                                            🗑
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onSetMassDelete(message.id)}
                                            className="toolbar-btn mass-delete-btn"
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
                                            className="toolbar-btn btn-confirm"
                                        >
                                            Confirm
                                        </button>

                                        <button
                                            type="button"
                                            onClick={onCancelMassDelete}
                                            className="toolbar-btn btn-cancel"
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
                        <span className="branch-separator-text">Conversation Branches Here</span>
                        <span className="branch-separator-icon">🌿</span>
                    </span>
                </button>
            )}
        </React.Fragment>
    );
});