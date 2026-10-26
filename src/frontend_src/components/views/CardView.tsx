// src/frontend_src/components/views/CardView.tsx
import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import type { ViewModeProps } from './types';
import type { Character, TextMessage, textType } from '../../types';
import { MemoizedMessageText } from '../MemoizedMessageText';
import { resolveDelayedDisplayNameFromCache } from '../../utilities/immersionLogic';
import { useChatStore } from '../../hooks/useChatStore';
import { useGenerationStore } from '../../hooks/useGenerationStore';
import { useUIStore } from '../../hooks/useUIStore';
import { useCompiledMessageText } from '../../hooks/useMessageDisplay';
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
} from '../../utilities/textDisplayReformatter';

export const CardView = React.memo(function CardView(props: ViewModeProps) {
    const {
        locationBackgroundUrl,
        displayMessages,
        displayNameCache,
        streamingText,
        editTextAreaRef,
        onSaveEdit,
        onResumeGeneration,
        onRegenerateFromMessage,
        onPlayVoice,
        onMassDeleteConfirm,
        onNavigateToBranchSource,
        parentInteractionDataName,
        focusedMessageId,
        setFocusedMessageId,
        canDelete,
    } = props;

    const interactionData = useChatStore(s => s.interactionData);
    const localProtagonistId = useChatStore(s => s.localProtagonist?.id ?? s.interactionData?.protagonistIds?.[0] ?? null);
    const isLoading = useGenerationStore(s => s.isLoading);
    const streamingMessageId = useGenerationStore(s => s.streamingMessageId);
    const stopGeneration = useGenerationStore(s => s.stopGeneration);

    const editingId = useUIStore(s => s.editingId);
    const editDraft = useUIStore(s => s.editDraft);
    const setEditDraft = useUIStore(s => s.setEditDraft);
    const setEditingState = useUIStore(s => s.setEditingState);

    const massDeleteId = useUIStore(s => s.massDeleteId);
    const setMassDeleteId = useUIStore(s => s.setMassDeleteId);

    const copyToClipboard = useChatStore(s => s.copyToClipboard);
    const deleteMessage = useChatStore(s => s.deleteMessage);
    const branchChat = useChatStore(s => s.branchChat);
    const cloneChat = useChatStore(s => s.cloneChat);

    const onStartEditing = useCallback((id: string, text: string) => setEditingState(id, text), [setEditingState]);
    const onCancelEditing = useCallback(() => setEditingState(null, ''), [setEditingState]);
    const onSetMassDelete = useCallback((id: string) => setMassDeleteId(id), [setMassDeleteId]);
    const onCancelMassDelete = useCallback(() => setMassDeleteId(null), [setMassDeleteId]);

    // ── Single Source of Truth Cards ───────────────────────────────────────
    const allCards = useMemo(() => {
        const all = displayMessages.filter((m): m is TextMessage => m.messageType === 'chat' || m.messageType === 'whisper');
        const seen = new Set<string>();
        return all.filter(m => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        });
    }, [displayMessages]);

    // ── View index resolution ──────────────────────────────────────────────
    const viewIndex = useMemo(() => {
        if (!focusedMessageId) return allCards.length - 1;
        const idx = allCards.findIndex(m => m.id === focusedMessageId);
        return idx !== -1 ? idx : allCards.length - 1;
    }, [focusedMessageId, allCards]);

    const prevCountRef = useRef(allCards.length);
    useEffect(() => {
        if (allCards.length > prevCountRef.current && focusedMessageId) {
            setFocusedMessageId(null);
        }
        prevCountRef.current = allCards.length;
    }, [allCards.length, focusedMessageId, setFocusedMessageId]);

    // ── Clean Dealing Animation ──────────────────────────────────────────
    const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());
    const prevIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        const currentIds = new Set(allCards.map(c => c.id));
        const newIds = new Set<string>();
        
        currentIds.forEach(id => {
            if (!prevIdsRef.current.has(id) && prevIdsRef.current.size > 0) {
                newIds.add(id);
            }
        });
        
        if (newIds.size > 0) {
            setEnteringIds(newIds);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        setEnteringIds(new Set());
                    }, 50);
                });
            });
        }
        
        prevIdsRef.current = currentIds;
    }, [allCards]);

    const activeTextBodyRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (isLoading && viewIndex === allCards.length - 1 && activeTextBodyRef.current) {
            activeTextBodyRef.current.scrollTop = activeTextBodyRef.current.scrollHeight;
        }
    }, [isLoading, streamingText, viewIndex, allCards.length]);

    // ── Navigation handlers ────────────────────────────────────────────────
    const canGoBack = viewIndex > 0;
    const canGoForward = viewIndex < allCards.length - 1;

    const handleGoBack = useCallback(() => {
        if (viewIndex > 0) {
            setFocusedMessageId(allCards[viewIndex - 1].id);
        }
    }, [viewIndex, allCards, setFocusedMessageId]);

    const handleGoForward = useCallback(() => {
        if (viewIndex < allCards.length - 1) {
            if (viewIndex + 1 === allCards.length - 1) {
                setFocusedMessageId(null);
            } else {
                setFocusedMessageId(allCards[viewIndex + 1].id);
            }
        }
    }, [viewIndex, allCards, setFocusedMessageId]);

    const handleSkipToFirst = useCallback(() => {
        if (allCards.length > 0) setFocusedMessageId(allCards[0].id);
    }, [allCards, setFocusedMessageId]);

    const handleSkipToLatest = useCallback(() => {
        setFocusedMessageId(null);
    }, [setFocusedMessageId]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }
            if (e.key === 'ArrowUp' || e.key === 'PageUp') {
                e.preventDefault();
                handleGoBack();
            } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
                e.preventDefault();
                handleGoForward();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleGoBack, handleGoForward]);

    const bgStyle: React.CSSProperties = useMemo(() => {
        if (locationBackgroundUrl) {
            return { background: 'transparent' };
        }
        return {
            background: 'radial-gradient(ellipse at 50% 40%, #1e1b2e 0%, #0c0b12 100%)',
        };
    }, [locationBackgroundUrl]);

    const hasParentBranch = !!interactionData?.parentInteractionDataId;

    const renderedCards = useMemo(() => {
        const minIdx = Math.max(0, viewIndex - 3);
        const maxIdx = Math.min(allCards.length - 1, viewIndex + 2);
        return allCards.slice(minIdx, maxIdx + 1).map(c => ({
            card: c,
            index: allCards.indexOf(c),
        }));
    }, [allCards, viewIndex]);

    return (
        <div className="card-stage-container" style={bgStyle}>
            {hasParentBranch && onNavigateToBranchSource && (
                <div className="card-branch-indicator">
                    <button type="button" className="card-branch-btn" onClick={onNavigateToBranchSource}>
                        🌿 Timeline branches from {parentInteractionDataName || 'Source'}
                    </button>
                </div>
            )}

            {/* 3D Deck Viewport */}
            <div className="card-deck-viewport">
                {allCards.length === 0 ? (
                    <div className="fate-card fate-card-active fate-card-empty" />
                ) : (
                    renderedCards.map(({ card, index }) => {
                        const isCurrent = index === viewIndex;
                        const isDiscardedUp = index > viewIndex;
                        const depthBelow = viewIndex - index;

                        let positionClass = 'fate-card-active';
                        if (isDiscardedUp) {
                            positionClass = 'fate-card-discarded-up';
                        } else if (depthBelow === 1) {
                            positionClass = 'fate-card-stack-1';
                        } else if (depthBelow === 2) {
                            positionClass = 'fate-card-stack-2';
                        } else if (depthBelow > 2) {
                            positionClass = 'fate-card-buried';
                        }

                        const isUserCard = localProtagonistId ? card.character.id === localProtagonistId : false;
                        const isStreamingThis = isCurrent && isLoading && streamingMessageId === card.id;

                        return (
                            <SingleCard
                                key={card.id}
                                card={card}
                                index={index}
                                allCardsCount={allCards.length}
                                isCurrent={isCurrent}
                                positionClass={positionClass}
                                isUserCard={isUserCard}
                                isStreamingThis={isStreamingThis}
                                textBodyRef={isCurrent ? activeTextBodyRef : undefined}
                                displayNameCache={displayNameCache}
                                editingId={editingId}
                                editDraft={editDraft}
                                setEditDraft={setEditDraft}
                                editTextAreaRef={editTextAreaRef}
                                onStartEditing={onStartEditing}
                                onCancelEditing={onCancelEditing}
                                onSaveEdit={onSaveEdit}
                                onRegenerateFromMessage={onRegenerateFromMessage}
                                onResumeGeneration={onResumeGeneration}
                                onPlayVoice={onPlayVoice}
                                onBranch={branchChat}
                                onClone={cloneChat}
                                onDelete={deleteMessage}
                                onCopyText={copyToClipboard}
                                onStopGeneration={stopGeneration}
                                massDeleteId={massDeleteId}
                                onSetMassDelete={onSetMassDelete}
                                onMassDeleteConfirm={onMassDeleteConfirm}
                                onCancelMassDelete={onCancelMassDelete}
                                canDelete={canDelete}
                                isEntering={enteringIds.has(card.id)}
                                onGoBack={handleGoBack}
                                onGoForward={handleGoForward}
                                onSkipToFirst={handleSkipToFirst}
                                onSkipToLatest={handleSkipToLatest}
                                canGoBack={canGoBack}
                                canGoForward={canGoForward}
                            />
                        );
                    })
                )}
            </div>
        </div>
    );
});

// ── Single Card Face ───────────────────────────────────────────────────────
interface SingleCardProps {
    card: TextMessage;
    index: number;
    allCardsCount: number;
    isCurrent: boolean;
    positionClass: string;
    isUserCard: boolean;
    isStreamingThis: boolean;
    textBodyRef?: React.RefObject<HTMLDivElement | null>;
    displayNameCache: any;
    editingId: string | null;
    editDraft: string;
    setEditDraft: (val: string) => void;
    editTextAreaRef: React.RefObject<HTMLTextAreaElement | null>;
    onStartEditing: (id: string, text: string) => void;
    onCancelEditing: () => void;
    onSaveEdit: () => void;
    onRegenerateFromMessage: (id: string, protagonistIds: string[]) => void;
    onResumeGeneration: (id: string) => void;
    onPlayVoice?: (text: string, character: Character) => void;
    onBranch: (id: string) => void;
    onClone: (id: string) => void;
    onDelete: (id: string) => void;
    onCopyText: (text: string) => void;
    onStopGeneration: () => void;
    massDeleteId: string | null;
    onSetMassDelete: (id: string) => void;
    onMassDeleteConfirm: () => void;
    onCancelMassDelete: () => void;
    canDelete: boolean;
    isEntering: boolean;
    onGoBack: () => void;
    onGoForward: () => void;
    onSkipToFirst: () => void;
    onSkipToLatest: () => void;
    canGoBack: boolean;
    canGoForward: boolean;
}

const SingleCard = React.memo(function SingleCard(props: SingleCardProps) {
    const {
        card, index, allCardsCount, isCurrent, positionClass, isUserCard, isStreamingThis,
        textBodyRef, displayNameCache,
        editingId, editDraft, setEditDraft, editTextAreaRef,
        onStartEditing, onCancelEditing, onSaveEdit,
        onRegenerateFromMessage, onResumeGeneration, onPlayVoice,
        onBranch, onClone, onDelete, onCopyText, onStopGeneration,
        massDeleteId, onSetMassDelete, onMassDeleteConfirm, onCancelMassDelete,
        canDelete, isEntering,
        onGoBack, onGoForward, onSkipToFirst, onSkipToLatest,
        canGoBack, canGoForward,
    } = props;

    const interactionData = useChatStore(s => s.interactionData);
    const compiledContent = useCompiledMessageText(card);

    const displayName = useMemo(() => {
        if (!card.character) return 'Unknown';
        return resolveDelayedDisplayNameFromCache(displayNameCache, index, card.character.id);
    }, [displayNameCache, index, card.character]);

    const isEditing = editingId === card.id;
    const isMassDeleting = massDeleteId === card.id;
    const renderedText = compiledContent || card.textContent || '';

    // ── Text Reformatter State ─────────────────────────────────────────────
    const [rawDraft, setRawDraft] = useState('');
    const [conversions, setConversions] = useState<CategoryConversion[]>([]);
    const [isRawEditing, setIsRawEditing] = useState(false);
    const prevIsEditingRef = useRef(false);

    useEffect(() => {
        const justStarted = isEditing && !prevIsEditingRef.current;
        prevIsEditingRef.current = isEditing;

        if (justStarted) {
            setRawDraft(editDraft);
            const segments = detectFormatSegments(editDraft);
            setConversions(buildCategoryConversions(segments));
            setIsRawEditing(false);
        } else if (!isEditing) {
            setRawDraft('');
            setConversions([]);
            setIsRawEditing(false);
        }
    }, [isEditing, editDraft]);

    const conversionMap = useMemo(() => {
        const map: Record<textType, textType> = { ...DEFAULT_CONVERSIONS };
        for (const c of conversions) map[c.detected] = c.target;
        return map;
    }, [conversions]);

    const displayEditText = useMemo(() => {
        if (isRawEditing) return rawDraft;
        return editDraft;
    }, [isRawEditing, rawDraft, editDraft]);

    useEffect(() => {
        if (isEditing) {
            const converted = applyConversions(rawDraft, conversionMap);
            if (converted !== editDraft) {
                setEditDraft(converted);
            }
        }
    }, [rawDraft, conversionMap, isEditing, editDraft, setEditDraft]);

    useEffect(() => {
        if (isRawEditing && editTextAreaRef.current) {
            editTextAreaRef.current.focus();
            editTextAreaRef.current.style.height = 'auto';
            editTextAreaRef.current.style.height = `${editTextAreaRef.current.scrollHeight}px`;
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

    const updateConversionTarget = useCallback((category: textType, target: textType) => {
        setConversions(prev => prev.map(c => c.detected === category ? { ...c, target } : c));
        recordCategoryCorrection(rawDraft, category, target);
    }, [rawDraft]);

    const handleAutoReformat = useCallback(() => {
        const segments = detectFormatSegments(rawDraft);
        setConversions(buildCategoryConversionsWithLearning(rawDraft, segments));
    }, [rawDraft]);

    const canAutoReformat = useMemo(() => {
        if (conversions.length === 0 || !rawDraft) return false;
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
        learnFromManualEdits(card.textContent, rawDraft);
        setConversions([]);
        setIsRawEditing(false);
        onSaveEdit();
    }, [card.textContent, rawDraft, onSaveEdit]);

    const cardClasses = [
        'fate-card',
        positionClass,
        isUserCard ? 'fate-card-user' : 'fate-card-fate',
        isStreamingThis && !renderedText ? 'fate-card-blank-waiting' : '',
        isEntering ? 'fate-card-entering' : '',
    ].filter(Boolean).join(' ');

    const isFirst = index === 0;
    const isLatest = index === allCardsCount - 1;

    return (
        <div className={cardClasses}>
            {/* Header: Navigation Flanking the Centered Name Plate */}
            <div className="fate-card-header">
                {allCardsCount > 1 ? (
                    <div className="fate-card-header-nav fate-card-header-nav-left">
                        <button
                            type="button"
                            className="fate-card-nav-btn"
                            onClick={onSkipToFirst}
                            disabled={!isCurrent || isFirst}
                            title="Skip to first card (⏮)"
                        >
                            ⏮
                        </button>
                        <button
                            type="button"
                            className="fate-card-nav-btn"
                            onClick={onGoBack}
                            disabled={!isCurrent || !canGoBack}
                            title="Previous older card (▲)"
                        >
                            ▲
                        </button>
                    </div>
                ) : (
                    <div className="fate-card-header-nav-spacer" />
                )}

                <div className="fate-card-header-center">
                    <span className="fate-card-name-plate">
                        {displayName}
                    </span>
                    {allCardsCount > 1 && (
                        <span className="fate-card-nav-counter">
                            {index + 1} / {allCardsCount}
                        </span>
                    )}
                </div>

                {allCardsCount > 1 ? (
                    <div className="fate-card-header-nav fate-card-header-nav-right">
                        <button
                            type="button"
                            className="fate-card-nav-btn"
                            onClick={onGoForward}
                            disabled={!isCurrent || !canGoForward}
                            title="Next newer card (▼)"
                        >
                            ▼
                        </button>
                        <button
                            type="button"
                            className="fate-card-nav-btn"
                            onClick={onSkipToLatest}
                            disabled={!isCurrent || isLatest}
                            title="Skip to latest card (⏭)"
                        >
                            ⏭
                        </button>
                    </div>
                ) : (
                    <div className="fate-card-header-nav-spacer" />
                )}
            </div>

            {/* Card Body */}
            <div 
                className={`fate-card-body ${isEditing ? 'is-editing' : ''}`} 
                ref={textBodyRef}
                style={isEditing ? { overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' } : undefined}
            >
                {isEditing ? (
                    <>
                        {isRawEditing ? (
                            <textarea
                                ref={editTextAreaRef}
                                className="vn-edit-textarea"
                                value={rawDraft}
                                onChange={handleRawChange}
                                onBlur={handleExitRawEdit}
                                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); handleExitRawEdit(); } }}
                                placeholder="Inscribe edits..."
                                style={{ minHeight: '140px', fontSize: '0.85rem' }}
                            />
                        ) : (
                            <div className="vn-edit-preview" onClick={handleEnterRawEdit} title="Click to edit raw text" style={{ minHeight: '100px', fontSize: '0.85rem' }}>
                                <MemoizedMessageText text={displayEditText} />
                            </div>
                        )}

                        <div className="vn-reformat-panel" style={{ width: '100%', boxSizing: 'border-box' }}>
                            {conversions.length === 0 ? (
                                <div className="vn-reformat-empty">No formatting detected. Click the text above to edit.</div>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={handleAutoReformat}
                                        disabled={!canAutoReformat}
                                        className="vn-auto-reformat-button"
                                        title={canAutoReformat ? "Apply learned reformatting preferences to card text" : "No new learned reformatting changes available"}
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
                                                <select 
                                                    className="vn-reformat-select" 
                                                    value={conversion.target}
                                                    onChange={e => updateConversionTarget(conversion.detected, e.target.value as textType)}
                                                >
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
                    </>
                ) : (
                    <div className="fate-card-text">
                        {renderedText ? (
                            <MemoizedMessageText text={renderedText} />
                        ) : isStreamingThis ? (
                            <div className="thinking-indicator" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', margin: '20px auto' }}>
                                <span className="thinking-text">Thinking</span>
                                <span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            {/* Footer Toolbar Buttons */}
            <div className="fate-card-footer">
                {isCurrent && (
                    <div className="fate-card-actions">
                        {isEditing ? (
                            <>
                                <button type="button" className="fate-card-btn fate-card-btn-cancel" onClick={handleCancelEditing} title="Cancel Edit">✕</button>
                                <button type="button" className="fate-card-btn fate-card-btn-save" onClick={handleSaveEdit} title="Save Edit">💾</button>
                            </>
                        ) : (
                            <>
                                {isStreamingThis && (
                                    <button type="button" className="fate-card-btn fate-card-btn-danger" onClick={onStopGeneration} title="Stop">⏹</button>
                                )}
                                <button type="button" className="fate-card-btn" onClick={() => onCopyText(renderedText)} title="Copy Text">📋</button>
                                
                                {onPlayVoice && card.character && (
                                    <button type="button" className="fate-card-btn" onClick={() => onPlayVoice(renderedText, card.character)} title="Narrate with Voice">🔊</button>
                                )}

                                {!isStreamingThis && (
                                    <>
                                        <button type="button" className="fate-card-btn" onClick={() => onResumeGeneration(card.id)} title="Continue Generation">▶</button>
                                        <button type="button" className="fate-card-btn" onClick={() => onRegenerateFromMessage(card.id, interactionData?.protagonistIds || [])} title="Regenerate">↻</button>
                                        <button type="button" className="fate-card-btn" onClick={() => onStartEditing(card.id, card.textContent)} title="Edit Message">✎</button>
                                        <button type="button" className="fate-card-btn" onClick={() => onBranch(card.id)} title="Branch Timeline">🌿</button>
                                        <button type="button" className="fate-card-btn" onClick={() => onClone(card.id)} title="Clone Session">⑂</button>
                                        
                                        {canDelete && (
                                            <button type="button" className="fate-card-btn fate-card-btn-danger" onClick={() => onDelete(card.id)} title="Delete Card">🗑</button>
                                        )}

                                        {isMassDeleting ? (
                                            <>
                                                <button type="button" className="fate-card-btn fate-card-btn-save" onClick={onMassDeleteConfirm} title="Confirm Mass Delete">✓</button>
                                                <button type="button" className="fate-card-btn fate-card-btn-cancel" onClick={onCancelMassDelete} title="Cancel Mass Delete">✕</button>
                                            </>
                                        ) : (
                                            canDelete && (
                                                <button type="button" className="fate-card-btn fate-card-btn-warn" onClick={() => onSetMassDelete(card.id)} title="Mass Delete From Here">🗑️↓</button>
                                            )
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

export default CardView;