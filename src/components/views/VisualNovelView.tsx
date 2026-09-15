// src/components/views/VisualNovelView.tsx
import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { ViewModeProps } from './types';
import type { ChatMessage, Character } from '../../types';
import { MemoizedMessageText } from '../MemoizedMessageText';

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
// MOVEMENT TRIGGERS
// =============================================================================
interface MovementTrigger { regex: RegExp; scaleDelta: number; speed: 'instant' | 'fast' | 'normal' | 'slow'; }

const MOVEMENT_TRIGGERS: MovementTrigger[] = [
    { regex: /\b(rushes|sprints|dashes|charges|lunges|leaps)\b/i, scaleDelta: 0.4, speed: 'fast' },
    { regex: /\b(runs|jogs|hurries|steps closer|approaches|walks over|moves closer|comes closer)\b/i, scaleDelta: 0.2, speed: 'normal' },
    { regex: /\b(leans in|steps forward|inch(es)? closer|bends down)\b/i, scaleDelta: 0.1, speed: 'slow' },
    { regex: /\b(steps back|back(s)? away|retreats|recoils|stumbles back|moves away)\b/i, scaleDelta: -0.2, speed: 'normal' },
    { regex: /\b(flees|bolts|runs away|scrambles back|retreats quickly)\b/i, scaleDelta: -0.4, speed: 'fast' },
];

function calculateCharacterScale(characterId: string, messages: ChatMessage[]): { scale: number; transitionSpeed: string } {
    let currentScale = 1.0;
    let currentSpeed = '0.5s';
    const myMessages = messages.filter(m => m.character.id === characterId && m.messageType === 'chat');
    const scanStart = Math.max(0, myMessages.length - 10);
    for (let i = scanStart; i < myMessages.length; i++) {
        const msg = myMessages[i];
        if (msg.messageType !== 'chat' || !msg.textContent) continue;
        let moved = false;
        for (const trigger of MOVEMENT_TRIGGERS) {
            if (trigger.regex.test(msg.textContent)) {
                currentScale += trigger.scaleDelta;
                switch (trigger.speed) {
                    case 'instant': currentSpeed = '0s'; break;
                    case 'fast': currentSpeed = '0.2s'; break;
                    case 'normal': currentSpeed = '0.8s'; break;
                    case 'slow': currentSpeed = '2s'; break;
                }
                moved = true;
                break;
            }
        }
        if (!moved && currentScale !== 1.0) currentScale += (1.0 - currentScale) * 0.05;
    }
    currentScale = Math.max(0.4, Math.min(2.5, currentScale));
    return { scale: currentScale, transitionSpeed: currentSpeed };
}

// =============================================================================
// COMPONENT
// =============================================================================
export const VisualNovelView = React.memo(function VisualNovelView(props: ViewModeProps) {
    const {
        interactionData, displayMessages, currentCharacterId,
        portraitUrlCache, locationBackgroundUrl,
        formattedStreamingText, isLoading, streamingPortraitUrl, streamingCharacter,
        centerAvatar,
        chatHistoryRef, messageEndRef, editTextareaRef,
        editingId, editDraft, setEditDraft,
        onSaveEdit, onCancelEditing, onRegenerateFromEdit,
        onCopyText, onRegenerateFromMessage, onBranch,
        onStartEditing, onResumeGeneration, onClone, onDelete,
        onSetMassDelete, onMassDeleteConfirm, onCancelMassDelete,
        massDeleteId, isMassActive,
        onStopGeneration,
    } = props;

    const protagonistId = interactionData.protagonist?.id;

    // --- Reformat State ---
    const [conversions, setConversions] = useState<CategoryConversion[]>([]);
    const [isRawEditing, setIsRawEditing] = useState(false);
    const rawDraftRef = useRef<string>('');

    const lastMsg = displayMessages[displayMessages.length - 1];
    const isStreamingInList = lastMsg?.isPartial === true;

    const activeStreamingText = isStreamingInList
        ? lastMsg.textContent
        : (isLoading ? formattedStreamingText : null);

    // FIX #1: visibleCharacters includes ALL participants (for dialogue/toolbar)
    // but spriteCharacters EXCLUDES protagonist (you are the camera)
    const visibleCharacters = useMemo(() => {
        return interactionData.participants;
    }, [interactionData.participants]);

    const chatMessages = useMemo(() => {
        return displayMessages.filter((m): m is ChatMessage => m.messageType === 'chat');
    }, [displayMessages]);

    const characterScales = useMemo(() => {
        const scales = new Map<string, { scale: number; transitionSpeed: string }>();
        for (const character of visibleCharacters) {
            if (character.id === AMBIENT_NARRATOR_ID) continue;
            if (character.id === protagonistId) continue; // No scale tracking for protagonist
            scales.set(character.id, calculateCharacterScale(character.id, chatMessages));
        }
        return scales;
    }, [visibleCharacters, chatMessages, protagonistId]);

    // Find last speaker INCLUDING all characters (protagonist, ambient, everyone)
    const lastSpeaker = useMemo(() => {
        for (let i = chatMessages.length - 1; i >= 0; i--) {
            return chatMessages[i];
        }
        return null;
    }, [chatMessages]);

    // Active speaker for dialogue box (can be anyone including protagonist)
    const activeSpeaker = useMemo(() => {
        if (isLoading && streamingCharacter) return streamingCharacter;
        if (isStreamingInList && lastMsg?.character) return lastMsg.character;
        if (lastSpeaker?.character) return lastSpeaker.character;
        if (centerAvatar) return centerAvatar;
        return visibleCharacters.find(c => c.id !== AMBIENT_NARRATOR_ID && c.id !== protagonistId)
            || visibleCharacters[0]
            || null;
    }, [isLoading, streamingCharacter, isStreamingInList, lastMsg, lastSpeaker, centerAvatar, visibleCharacters, protagonistId]);

    const isWaitingForGeneration = isLoading && !activeStreamingText;
    const isEditingLastSpeaker = editingId !== null && lastSpeaker?.id === editingId;
    const isAmbientSpeaker = lastSpeaker?.character.id === AMBIENT_NARRATOR_ID;

    // FIX #2: Toolbar should show for ambient narration even during streaming
    // Ambient messages are narrated text — user should always be able to copy/edit/regenerate them
    const showToolbar = lastSpeaker && (!isStreamingInList || isAmbientSpeaker);

    // --- Reformat Effects ---
    useEffect(() => {
        if (isEditingLastSpeaker) {
            const segments = detectFormatSegments(editDraft);
            setConversions(buildCategoryConversions(segments));
            setIsRawEditing(false);
            rawDraftRef.current = editDraft;
        } else {
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

    const handleEnterRawEdit = useCallback(() => {
        rawDraftRef.current = editDraft;
        setIsRawEditing(true);
        setTimeout(() => editTextareaRef.current?.focus(), 0);
    }, [editDraft, editTextareaRef]);

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

    // FIX #1: Sprite characters exclude BOTH protagonist AND ambient narrator
    const spriteCharacters = useMemo(() => {
        return visibleCharacters.filter(c => c.id !== AMBIENT_NARRATOR_ID && c.id !== protagonistId);
    }, [visibleCharacters, protagonistId]);

    const spritePositions = useMemo(() => {
        const positions = new Map<string, 'left' | 'center' | 'right'>();
        // For sprite positioning, use activeSpeaker only if they're not protagonist/ambient
        const spriteActiveSpeaker = (activeSpeaker && activeSpeaker.id !== protagonistId && activeSpeaker.id !== AMBIENT_NARRATOR_ID)
            ? activeSpeaker
            : null;
        const others = spriteCharacters.filter(c => c.id !== spriteActiveSpeaker?.id);
        if (spriteActiveSpeaker) {
            positions.set(spriteActiveSpeaker.id, 'center');
        }
        others.forEach((character, idx) => {
            positions.set(character.id, idx % 2 === 0 ? 'left' : 'right');
        });
        return positions;
    }, [spriteCharacters, activeSpeaker, protagonistId]);

    const bgStyle: React.CSSProperties = locationBackgroundUrl
        ? { backgroundImage: `url(${locationBackgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: 'linear-gradient(to bottom, #1a1a2e, #16213e)' };

    const isMassDeletingThis = isMassActive && massDeleteId === lastSpeaker?.id;

    // Single canonical key lookup
    const resolvedPortraits = useMemo(() => {
        const map = new Map<string, string | null>();
        for (const character of spriteCharacters) {
            map.set(character.id, portraitUrlCache.get(`character:${character.id}`) ?? null);
        }
        return map;
    }, [spriteCharacters, portraitUrlCache]);

    return (
        <div className="vn-stage-container" style={bgStyle}>
            {/* --- SPRITE LAYER (no protagonist, no ambient) --- */}
            <div className="vn-sprites-layer">
                {spriteCharacters.map((character) => {
                    const portraitUrl = resolvedPortraits.get(character.id);
                    if (!portraitUrl) return null;

                    const scaleData = characterScales.get(character.id) || { scale: 1.0, transitionSpeed: '0.5s' };
                    const position = spritePositions.get(character.id) || 'center';
                    const isSpeaking = activeSpeaker?.id === character.id;

                    let leftPos = '50%';
                    let zIndex = 10;
                    let opacity = 1;

                    if (position === 'left') { leftPos = '25%'; zIndex = 5; opacity = isSpeaking ? 1 : 0.6; }
                    else if (position === 'right') { leftPos = '75%'; zIndex = 5; opacity = isSpeaking ? 1 : 0.6; }
                    else { zIndex = 20; opacity = 1; }

                    return (
                        <div key={character.id} className="vn-character-layer" style={{
                            left: leftPos,
                            transform: `translateX(-50%) scale(${scaleData.scale})`,
                            transformOrigin: 'bottom center',
                            transition: `all ${scaleData.transitionSpeed} ease-out`,
                            zIndex, opacity,
                            filter: isSpeaking ? 'none' : 'brightness(0.7)',
                        }}>
                            <img src={portraitUrl} alt={character.name} className="vn-sprite"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        </div>
                    );
                })}
            </div>

            {/* --- DIALOGUE BOX LAYER --- */}
            <div className="vn-dialogue-layer">
                <div className={`vn-dialogue-box ${isAmbientSpeaker ? 'vn-dialogue-box-ambient' : ''}`} style={{
                    opacity: isWaitingForGeneration ? 0 : 1,
                    pointerEvents: isWaitingForGeneration ? 'none' : 'auto',
                    transition: 'opacity 0.3s ease'
                }}>
                    <div className="vn-name-plate">
                        {isAmbientSpeaker ? '✦ Narration' : (activeSpeaker ? activeSpeaker.name : 'System')}
                    </div>

                    {/* FIX #2: Toolbar shows for ambient narration even during streaming */}
                    <div className="vn-message-toolbar">
                        {isEditingLastSpeaker ? (
                            <>
                                <button className="vn-toolbar-btn vn-toolbar-cancel" onClick={handleCancelEditing} title="Cancel Edit">✕</button>
                                <button className="vn-toolbar-btn vn-toolbar-confirm" onClick={onSaveEdit} title="Save Edit">💾</button>
                                <button className="vn-toolbar-btn vn-toolbar-warn" onClick={onRegenerateFromEdit} title="Save & Regenerate">↻</button>
                            </>
                        ) : (
                            <>
                                {isLoading && !isAmbientSpeaker && (
                                    <button className="vn-toolbar-btn vn-toolbar-danger" onClick={onStopGeneration} title="Stop Generation">⏹</button>
                                )}
                                {showToolbar && (
                                    <>
                                        <button className="vn-toolbar-btn" onClick={() => onCopyText(lastSpeaker.textContent)} title="Copy Text">📋</button>
                                        <button className="vn-toolbar-btn" onClick={() => onStartEditing(lastSpeaker.id, lastSpeaker.textContent)} title="Edit Message">✎</button>
                                        {lastSpeaker.isPartial ? (
                                            <button className="vn-toolbar-btn" onClick={() => onResumeGeneration(lastSpeaker.id)} title="Resume Generation">▶</button>
                                        ) : (
                                            <button className="vn-toolbar-btn" onClick={() => onRegenerateFromMessage(lastSpeaker.id, 'ai')} title="Regenerate">↻</button>
                                        )}
                                        <button className="vn-toolbar-btn" onClick={() => onBranch(lastSpeaker.id)} title="Branch Timeline">🌿</button>
                                        <button className="vn-toolbar-btn" onClick={() => onClone(lastSpeaker.id)} title="Clone Chat">⑂</button>
                                        <button className="vn-toolbar-btn vn-toolbar-danger" onClick={() => onDelete(lastSpeaker.id)} title="Delete Message">🗑</button>
                                        {isMassDeletingThis ? (
                                            <>
                                                <button className="vn-toolbar-btn vn-toolbar-confirm" onClick={onMassDeleteConfirm} title="Confirm Mass Delete">✓</button>
                                                <button className="vn-toolbar-btn vn-toolbar-cancel" onClick={onCancelMassDelete} title="Cancel Mass Delete">✕</button>
                                            </>
                                        ) : (
                                            <button className="vn-toolbar-btn vn-toolbar-warn" onClick={() => onSetMassDelete(lastSpeaker.id)} title="Mass Delete From Here">🗑️↓</button>
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
                                        className="vn-edit-textarea" autoFocus />
                                ) : (
                                    <div className="vn-edit-preview" onClick={handleEnterRawEdit} title="Click to edit raw text">
                                        <MemoizedMessageText text={displayEditText} />
                                    </div>
                                )
                            ) : activeStreamingText ? (
                                <MemoizedMessageText text={activeStreamingText} />
                            ) : lastSpeaker ? (
                                <MemoizedMessageText text={lastSpeaker.textContent} />
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
                </div>
            </div>

            <div ref={messageEndRef} style={{ height: '1px', position: 'absolute', bottom: 0 }} />
        </div>
    );
});