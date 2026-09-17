// src/components/views/VisualNovelView.tsx
import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { ViewModeProps } from './types';
import type { ChatMessage } from '../../types';
import { MemoizedMessageText } from '../MemoizedMessageText';
import { useVisualNovelSpriteStates } from '../../hooks/useVisualNovelSpriteStates';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

// =============================================================================
// TEXT REFORMAT SYSTEM
// =============================================================================
type FormatCategory = 'plain' | 'italics' | 'bold' | 'strikethrough' | 'quotes' | 'parentheses' | 'brackets';
type TargetFormat = FormatCategory;

interface DetectedSegment { start: number; end: number; category: FormatCategory; innerText: string; rawMatch: string; }
interface CategoryConversion { detected: FormatCategory; label: string; target: TargetFormat; count: number; }

const CATEGORY_LABELS: Record<FormatCategory, string> = {
    plain: 'Plain Text', italics: 'Italics', bold: 'Bold', strikethrough: 'Strikethrough',
    quotes: 'Quotation Marks', parentheses: 'Parentheses', brackets: 'Square Brackets',
};

const TARGET_OPTIONS: { value: TargetFormat; label: string }[] = [
    { value: 'plain', label: 'Plain Text' }, { value: 'italics', label: 'Italics' },
    { value: 'parentheses', label: 'Parentheses' }, { value: 'brackets', label: 'Square Brackets' },
    { value: 'quotes', label: 'Quotation Marks' }, { value: 'bold', label: 'Bold' },
    { value: 'strikethrough', label: 'Strikethrough' },
];

const DEFAULT_CONVERSIONS: Record<FormatCategory, TargetFormat> = {
    plain: 'plain', italics: 'italics', parentheses: 'parentheses', brackets: 'brackets',
    quotes: 'quotes', bold: 'bold', strikethrough: 'strikethrough',
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
    interface RawMatch { start: number; end: number; category: FormatCategory; innerText: string; rawMatch: string; }
    const allMatches: RawMatch[] = [];
    for (const { regex, category, innerGroup } of patterns) {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            if (match[0].length === 0) { regex.lastIndex++; continue; }
            allMatches.push({ start: match.index, end: match.index + match[0].length, category, innerText: match[innerGroup] || '', rawMatch: match[0] });
        }
    }
    allMatches.sort((a, b) => a.start !== b.start ? a.start - b.start : (b.end - b.start) - (a.end - a.start));
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
            if (plainGap.trim().length > 0) segments.push({ start: pos, end: match.start, category: 'plain', innerText: plainGap, rawMatch: plainGap });
        }
        segments.push({ start: match.start, end: match.end, category: match.category, innerText: match.innerText, rawMatch: match.rawMatch });
        pos = match.end;
    }
    if (pos < text.length) {
        const trailing = text.slice(pos);
        if (trailing.trim().length > 0) segments.push({ start: pos, end: text.length, category: 'plain', innerText: trailing, rawMatch: trailing });
    }
    return segments;
}

function wrapCoreText(core: string, target: TargetFormat): string {
    switch (target) {
        case 'italics': return `*${core}*`;
        case 'bold': return `**${core}**`;
        case 'strikethrough': return `~~${core}~~`;
        case 'quotes': return `"${core}"`;
        case 'parentheses': return `(${core})`;
        case 'brackets': return `[${core}]`;
        default: return core;
    }
}

function convertPlainSegmentPreservingSpacing(raw: string, target: TargetFormat): string {
    if (target === 'plain') return raw;
    return raw.split(/(\r?\n)/).map(part => {
        if (part === '\n' || part === '\r\n' || part.trim().length === 0) return part;
        const match = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
        if (!match) return part;
        const core = match[2] ?? '';
        if (!core) return part;
        return `${match[1] ?? ''}${wrapCoreText(core, target)}${match[3] ?? ''}`;
    }).join('');
}

function convertFormattedSegmentPreservingSpacing(seg: DetectedSegment, target: TargetFormat): string {
    if (target === seg.category) return seg.rawMatch;
    if (target === 'plain') return seg.innerText;
    return wrapCoreText(seg.innerText, target);
}

function applyConversions(text: string, conversions: Record<FormatCategory, TargetFormat>): string {
    const segments = detectFormatSegments(text);
    if (segments.length === 0) return text;
    const replacements: { start: number; end: number; replacement: string }[] = [];
    for (const seg of segments) {
        const target = conversions[seg.category];
        if (target === seg.category) continue;
        const replacement = seg.category === 'plain'
            ? convertPlainSegmentPreservingSpacing(seg.rawMatch, target)
            : convertFormattedSegmentPreservingSpacing(seg, target);
        if (replacement !== seg.rawMatch) replacements.push({ start: seg.start, end: seg.end, replacement });
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
    const counts: Record<FormatCategory, number> = { plain: 0, italics: 0, bold: 0, strikethrough: 0, quotes: 0, parentheses: 0, brackets: 0 };
    for (const seg of segments) counts[seg.category]++;
    return (['plain', 'italics', 'bold', 'strikethrough', 'quotes', 'parentheses', 'brackets'] as FormatCategory[])
        .filter(c => counts[c] > 0)
        .map(c => ({ detected: c, label: CATEGORY_LABELS[c], target: DEFAULT_CONVERSIONS[c], count: counts[c] }));
}

// =============================================================================
// COMPONENT
// =============================================================================
export const VisualNovelView = React.memo(function VisualNovelView(props: ViewModeProps) {
    const {
        interactionData, displayMessages,
        portraitUrlCache, locationBackgroundUrl,
        formattedStreamingText, isLoading, streamingCharacter,
        centerAvatar,
        messageEndRef, editTextareaRef,
        editingId, editDraft, setEditDraft,
        onSaveEdit, onCancelEditing, onRegenerateFromEdit,
        onCopyText, onRegenerateFromMessage, onBranch,
        onStartEditing, onResumeGeneration, onClone, onDelete,
        onSetMassDelete, onMassDeleteConfirm, onCancelMassDelete,
        massDeleteId, isMassActive,
        onStopGeneration,
        onNavigateToBranchSource,
    } = props;

    const protagonistId = interactionData.protagonist?.id;

    // --- Rewind/Forward State ---
    const [viewIndex, setViewIndex] = useState<number | null>(null); // null = live (latest)

    // --- Reformat State ---
    const [conversions, setConversions] = useState<CategoryConversion[]>([]);
    const [isRawEditing, setIsRawEditing] = useState(false);
    const rawDraftRef = useRef<string>('');

    const chatMessages = useMemo(() => {
        return displayMessages.filter((m): m is ChatMessage => m.messageType === 'chat');
    }, [displayMessages]);

    // Reset viewIndex when new messages arrive (stay live)
    const prevChatLengthRef = useRef(chatMessages.length);
    useEffect(() => {
        if (chatMessages.length > prevChatLengthRef.current && viewIndex !== null) {
            // New message arrived while rewound — snap back to live
            setViewIndex(null);
        }
        prevChatLengthRef.current = chatMessages.length;
    }, [chatMessages.length, viewIndex]);

    const lastMsg = displayMessages[displayMessages.length - 1];
    const isStreamingInList = lastMsg?.isPartial === true;

    const activeStreamingText: string | null = isStreamingInList
        ? lastMsg.textContent
        : (isLoading && formattedStreamingText ? String(formattedStreamingText) : null);

    const visibleCharacters = useMemo(() => {
        return interactionData.participants;
    }, [interactionData.participants]);

    const lastSpeaker = useMemo(() => {
        return chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
    }, [chatMessages]);

    // The message currently being displayed (either rewound or live)
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
    const isLive = viewIndex === null;

    const showToolbar = displayedMessage && (isLive || isAmbientSpeaker || !isStreamingInList);

    // Check if this message is a branch point
    const isBranchPoint = displayedMessage?.parentInteractionMessageId !== null && displayedMessage?.parentInteractionMessageId !== undefined;
    const hasParentBranch = !!interactionData.parentInteractionDataId;

    // --- Navigation ---
    const canGoBack = chatMessages.length > 1 && (viewIndex === null ? true : viewIndex > 0);
    const canGoForward = viewIndex !== null && viewIndex < chatMessages.length - 1;

    const handleGoBack = useCallback(() => {
        if (viewIndex === null) {
            setViewIndex(chatMessages.length - 2);
        } else if (viewIndex > 0) {
            setViewIndex(viewIndex - 1);
        }
    }, [viewIndex, chatMessages.length]);

    const handleGoForward = useCallback(() => {
        if (viewIndex !== null) {
            if (viewIndex < chatMessages.length - 1) {
                setViewIndex(viewIndex + 1);
            } else {
                setViewIndex(null); // Back to live
            }
        }
    }, [viewIndex, chatMessages.length]);

    const handleGoToLive = useCallback(() => {
        setViewIndex(null);
    }, []);

    // --- Sprite States ---
    const spriteCharacterIds = useMemo(() => {
        return visibleCharacters
            .filter(c => c.id !== AMBIENT_NARRATOR_ID && c.id !== protagonistId)
            .map(c => c.id);
    }, [visibleCharacters, protagonistId]);

    const { spriteStates, rollbackToMessage, isInitialLoad, jumpingCharacterIds } = useVisualNovelSpriteStates({
        chatMessages,
        visibleCharacterIds: spriteCharacterIds,
        protagonistId,
    });

    const handleRegenerateFromMessageWithRollback = useCallback((id: string, type: 'ai' | 'user') => {
        const msgIndex = chatMessages.findIndex(m => m.id === id);
        if (msgIndex !== -1) rollbackToMessage(msgIndex);
        setViewIndex(null);
        onRegenerateFromMessage(id, type);
    }, [chatMessages, rollbackToMessage, onRegenerateFromMessage]);

    const handleBranchWithRollback = useCallback((id: string) => {
        const msgIndex = chatMessages.findIndex(m => m.id === id);
        if (msgIndex !== -1) rollbackToMessage(msgIndex);
        setViewIndex(null);
        onBranch(id);
    }, [chatMessages, rollbackToMessage, onBranch]);

    // --- Reformat Effects ---
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
        const map: Record<FormatCategory, TargetFormat> = { ...DEFAULT_CONVERSIONS };
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
        if (isRawEditing && editTextareaRef.current) {
            editTextareaRef.current.focus();
        }
    }, [isRawEditing, editTextareaRef]);

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

    const updateConversionTarget = useCallback((category: FormatCategory, target: TargetFormat) => {
        setConversions(prev => prev.map(c => c.detected === category ? { ...c, target } : c));
    }, []);

    const handleCancelEditing = useCallback(() => {
        setConversions([]);
        setIsRawEditing(false);
        onCancelEditing();
    }, [onCancelEditing]);

    const bgStyle: React.CSSProperties = locationBackgroundUrl
        ? { backgroundImage: `url(${locationBackgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: 'linear-gradient(to bottom, #1a1a2e, #16213e)' };

    const isMassDeletingThis = isMassActive && massDeleteId === displayedMessage?.id;

    const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        e.currentTarget.style.display = 'none';
    }, []);

    // Determine what text to show
    const displayText = useMemo(() => {
        if (isEditingLastSpeaker) return null; // Handled by edit UI
        if (!isLive && displayedMessage) return displayedMessage.textContent;
        if (activeStreamingText) return activeStreamingText;
        if (displayedMessage) return displayedMessage.textContent;
        return null;
    }, [isEditingLastSpeaker, isLive, displayedMessage, activeStreamingText]);

    const currentIndex = viewIndex !== null ? viewIndex : chatMessages.length - 1;

    return (
        <div className="vn-stage-container" style={bgStyle}>
            {/* --- SPRITE LAYER --- */}
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

            {/* --- BRANCH INDICATOR --- */}
            {hasParentBranch && onNavigateToBranchSource && (
                <div className="vn-branch-indicator">
                    <button type="button" className="vn-branch-button" onClick={onNavigateToBranchSource}>
                        🌿 Return to Source
                    </button>
                </div>
            )}

            {/* --- NAVIGATION ARROWS --- */}
            {chatMessages.length > 1 && (
                <div className="vn-nav-arrows">
                    <button
                        type="button"
                        className="vn-nav-arrow"
                        onClick={handleGoBack}
                        disabled={!canGoBack}
                        title="Previous message"
                    >
                        ◀
                    </button>
                    <button
                        type="button"
                        className="vn-nav-arrow"
                        onClick={handleGoForward}
                        disabled={!canGoForward && isLive}
                        title={isLive ? 'Already at latest' : 'Next message'}
                    >
                        ▶
                    </button>
                </div>
            )}

            {/* --- DIALOGUE BOX LAYER --- */}
            <div className="vn-dialogue-layer">
                <div className={`vn-dialogue-box ${isAmbientSpeaker ? 'vn-dialogue-box-ambient' : ''}`} style={{
                    opacity: isWaitingForGeneration ? 0 : 1,
                    pointerEvents: isWaitingForGeneration ? 'none' : 'auto',
                    transition: 'opacity 0.3s ease'
                }}>
                    <div className="vn-name-plate">
                        {isAmbientSpeaker ? '✦ Narration' : (activeSpeaker ? activeSpeaker.name : 'System')}
                        {!isLive && <span style={{ opacity: 0.6, fontSize: '0.7em', marginLeft: '8px' }}>[Rewound]</span>}
                    </div>

                    <div className="vn-message-toolbar">
                        {isEditingLastSpeaker ? (
                            <>
                                <button type="button" className="vn-toolbar-btn vn-toolbar-cancel" onClick={handleCancelEditing} title="Cancel Edit">✕</button>
                                <button type="button" className="vn-toolbar-btn vn-toolbar-confirm" onClick={onSaveEdit} title="Save Edit">💾</button>
                                <button type="button" className="vn-toolbar-btn vn-toolbar-warn" onClick={onRegenerateFromEdit} title="Save & Regenerate">↻</button>
                            </>
                        ) : (
                            <>
                                {isLoading && !isAmbientSpeaker && isLive && (
                                    <button type="button" className="vn-toolbar-btn vn-toolbar-danger" onClick={onStopGeneration} title="Stop Generation">⏹</button>
                                )}
                                {showToolbar && displayedMessage && (
                                    <>
                                        <button type="button" className="vn-toolbar-btn" onClick={() => onCopyText(displayedMessage.textContent)} title="Copy Text">📋</button>
                                        {isLive && (
                                            <button type="button" className="vn-toolbar-btn" onClick={() => onStartEditing(displayedMessage.id, displayedMessage.textContent)} title="Edit Message">✎</button>
                                        )}
                                        {isLive && displayedMessage.isPartial ? (
                                            <button type="button" className="vn-toolbar-btn" onClick={() => onResumeGeneration(displayedMessage.id)} title="Resume Generation">▶</button>
                                        ) : isLive ? (
                                            <button type="button" className="vn-toolbar-btn" onClick={() => handleRegenerateFromMessageWithRollback(displayedMessage.id, displayedMessage.character.id === protagonistId ? 'user' : 'ai')} title="Regenerate">↻</button>
                                        ) : null}
                                        {isLive && (
                                            <>
                                                <button type="button" className="vn-toolbar-btn" onClick={() => handleBranchWithRollback(displayedMessage.id)} title="Branch Timeline">🌿</button>
                                                <button type="button" className="vn-toolbar-btn" onClick={() => onClone(displayedMessage.id)} title="Clone Chat">⑂</button>
                                                <button type="button" className="vn-toolbar-btn vn-toolbar-danger" onClick={() => onDelete(displayedMessage.id)} title="Delete Message">🗑</button>
                                                {isMassDeletingThis ? (
                                                    <>
                                                        <button type="button" className="vn-toolbar-btn vn-toolbar-confirm" onClick={onMassDeleteConfirm} title="Confirm Mass Delete">✓</button>
                                                        <button type="button" className="vn-toolbar-btn vn-toolbar-cancel" onClick={onCancelMassDelete} title="Cancel Mass Delete">✕</button>
                                                    </>
                                                ) : (
                                                    <button type="button" className="vn-toolbar-btn vn-toolbar-warn" onClick={() => onSetMassDelete(displayedMessage.id)} title="Mass Delete From Here">🗑️↓</button>
                                                )}
                                            </>
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
                                    <textarea ref={editTextareaRef} value={rawDraftRef.current} onChange={handleRawChange}
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
                                <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Waiting for interaction...</span>
                            )}
                        </div>

                        {isEditingLastSpeaker && (
                            <div className="vn-reformat-panel">
                                {conversions.length === 0 ? (
                                    <div className="vn-reformat-empty">No formatting detected. Click the text above to edit.</div>
                                ) : (
                                    <div className="vn-reformat-grid">
                                        {conversions.map(conversion => (
                                            <div key={conversion.detected} className="vn-reformat-row">
                                                <span className="vn-reformat-label">
                                                    {conversion.label}<span className="vn-reformat-count">×{conversion.count}</span>
                                                </span>
                                                <span className="vn-reformat-arrow">→</span>
                                                <select className="vn-reformat-select" value={conversion.target}
                                                    onChange={e => updateConversionTarget(conversion.detected, e.target.value as TargetFormat)}>
                                                    {TARGET_OPTIONS.map(option => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Message counter */}
                    <div className="vn-message-counter">
                        {currentIndex + 1} / {chatMessages.length}
                        {!isLive && <span onClick={handleGoToLive} style={{ cursor: 'pointer', marginLeft: '8px', opacity: 0.7 }}>● LIVE</span>}
                    </div>
                </div>
            </div>

            <div ref={messageEndRef} style={{ height: '1px', position: 'absolute', bottom: 0 }} />
        </div>
    );
});