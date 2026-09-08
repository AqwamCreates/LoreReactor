// src/components/MessageBubble.tsx
import React from 'react';
import type { Character, InteractionData, ChatMessage } from '../types';
import { MemoizedMessageText } from './MemoizedMessageText';

interface MessageBubbleProps {
    message: ChatMessage;
    index: number;
    viewMode: 'ladder' | 'cinematic';
    interactionData: InteractionData;
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
    isModelReady: boolean;
    isLoading: boolean;
    // callbacks
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
}

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

export const MessageBubble = React.memo(function MessageBubble({
    message, index, viewMode, interactionData, currentCharacterId,
    editingId, editDraft, massDeleteId, isMassActive, massStartIndex,
    activeToolbarId, portraitUrl, displayName, isStem, beforeBranch,
    isModelReady, isLoading,
    onAvatarClick, onStartEditing, onCancelEditing, onSaveEdit, onRegenerateFromEdit,
    onResumeGeneration, onCopyText, onRegenerateFromMessage,
    onBranch, onClone, onDelete, onSetMassDelete,
    onMassDeleteConfirm, onCancelMassDelete,
    onTouchStart, onTouchEnd, onTouchMove,
    suppressNextClickRef, editTextareaRef, setEditDraft,
}: MessageBubbleProps) {
    const isAmbient = message.character.id === AMBIENT_NARRATOR_ID;
    const isProtag = message.character.id === currentCharacterId;
    const isEditing = editingId === message.id;
    const inDelRange = isMassActive && massStartIndex !== -1 && index >= massStartIndex;
    const showAvatar = viewMode === 'ladder' && !isProtag && !isAmbient;
    const isResumingThisMessage = isLoading && message.isPartial && !isProtag;

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
                                ? <img src={portraitUrl} alt={displayName} className="character-avatar" onClick={e => onAvatarClick(e, message.id, message.character)} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} style={{ cursor: 'pointer' }} />
                                : <div className="character-avatar placeholder" onClick={e => onAvatarClick(e, message.id, message.character)} style={{ cursor: 'pointer' }} />}
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
                            <textarea
                                ref={editTextareaRef}
                                value={editDraft}
                                onChange={e => setEditDraft(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(); }
                                    if (e.key === 'Escape') onCancelEditing();
                                }}
                                className="edit-textarea"
                            />
                            <div className="edit-actions">
                                <button type="button" onClick={onCancelEditing} className="edit-btn edit-btn-cancel">Cancel</button>
                                <button
                                    type="button"
                                    onClick={onRegenerateFromEdit}
                                    disabled={!isModelReady || isLoading}
                                    className="edit-btn edit-btn-regenerate"
                                    title="Save changes and regenerate response"
                                    style={!isModelReady || isLoading ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                                >Regenerate</button>
                                <button type="button" onClick={onSaveEdit} className="edit-btn edit-btn-save">Save</button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <MemoizedMessageText text={message.textContent} />
                            {(message as ChatMessage).files?.length > 0 && (
                                <div className="message-attachment-indicator" title={`${(message as ChatMessage).files!.length} attached file${(message as ChatMessage).files!.length !== 1 ? 's' : ''}`}>
                                    📎 {(message as ChatMessage).files!.length}
                                </div>
                            )}
                            <div className="message-toolbar">
                                {isStem ? (
                                    <span className="toolbar-lock">🔒 Locked</span>
                                ) : !isMassActive ? (
                                    <>
                                        {!isProtag && message.isPartial && (
                                            <button type="button" onClick={() => onResumeGeneration(message.id)} disabled={!isModelReady} className="toolbar-btn" title="Resume interrupted generation" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>▶</button>
                                        )}
                                        <button type="button" onClick={() => onCopyText(message.textContent)} className="toolbar-btn" title="Copy text to clipboard">📋</button>
                                        <button type="button" onClick={() => onStartEditing(message.id, message.textContent)} className="toolbar-btn">✎</button>
                                        {!isProtag && (
                                            <button type="button" onClick={() => onRegenerateFromMessage(message.id, 'ai')} disabled={!isModelReady} className="toolbar-btn" title="Regenerate this Response" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>↻</button>
                                        )}
                                        {isProtag && (
                                            <button type="button" onClick={() => onRegenerateFromMessage(message.id, 'user')} disabled={!isModelReady} className="toolbar-btn" title="Regenerate Your Input" style={!isModelReady ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>↻</button>
                                        )}
                                        <button type="button" onClick={() => onBranch(message.id)} className="toolbar-btn" title="Branch from here">🌿</button>
                                        <button type="button" onClick={() => onClone(message.id)} className="toolbar-btn" title="Clone chat up to here">⑂</button>
                                        <button type="button" onClick={() => onDelete(message.id)} className="toolbar-btn delete-btn" style={{ color: '#ff4444' }}>🗑</button>
                                        <button type="button" onClick={() => onSetMassDelete(message.id)} className="toolbar-btn mass-delete-btn" style={{ color: '#ff9900' }}>🗑️↓</button>
                                    </>
                                ) : massDeleteId === message.id ? (
                                    <div className="mass-delete-confirm-bar">
                                        <span>Delete from here?</span>
                                        <button type="button" onClick={onMassDeleteConfirm} className="toolbar-btn btn-confirm">Confirm</button>
                                        <button type="button" onClick={onCancelMassDelete} className="toolbar-btn btn-cancel">Cancel</button>
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
                <div className="branch-separator-line clickable" style={{ cursor: 'pointer' }}>
                    <div className="branch-separator-content">
                        <span className="branch-separator-icon">🌿</span>
                        <span className="branch-separator-text">Conversation Branches Here</span>
                        <span className="branch-separator-icon">🌿</span>
                    </div>
                </div>
            )}
        </React.Fragment>
    );
});