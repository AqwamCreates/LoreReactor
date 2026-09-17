// src/components/views/CinematicView.tsx
import React, { useEffect } from 'react';
import type { ViewModeProps } from './types';
import { MessageBubble } from '../MessageBubble';
import { StreamingIndicators } from '../StreamingIndicators';
import { resolveDelayedDisplayNameFromCache } from '../../hooks/immersionLogic';

export const CinematicView = React.memo(function CinematicView(props: ViewModeProps) {
    const {
        displayMessages, currentCharacterId,
        editingId, editDraft, massDeleteId, isMassActive, massStartIndex,
        activeToolbarId, portraitUrlCache, displayNameCache,
        centerAvatar, streamingPortraitUrl, formattedStreamingText,
        isLoading, chatHistoryRef, messageEndRef, editTextareaRef,
        parentInteractionMessageId,
        focusedMessageId,
        onAvatarClick, onStartEditing, onCancelEditing, onSaveEdit,
        onRegenerateFromEdit, onResumeGeneration, onCopyText,
        onRegenerateFromMessage, onBranch, onClone, onDelete,
        onSetMassDelete, onMassDeleteConfirm, onCancelMassDelete,
        onTouchStart, onTouchEnd, onTouchMove,
        suppressNextClickRef, setEditDraft, onNavigateToBranchSource,
    } = props;

    const centerAvatarUrl = centerAvatar
        ? portraitUrlCache.get(`character:${centerAvatar.id}`) ?? null
        : null;

    // Scroll to focused message when it changes
    useEffect(() => {
        if (focusedMessageId && chatHistoryRef.current) {
            const msgElement = document.getElementById(`message-${focusedMessageId}`);
            if (msgElement) {
                msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [focusedMessageId, chatHistoryRef]);

    return (
        <>
            {centerAvatar && centerAvatarUrl && (
                <div
                    className="cinematic-stage active"
                    onClick={e => { e.stopPropagation(); onAvatarClick(e, centerAvatar.id || 'cinematic-bg', centerAvatar); }}
                    title="Click character to interject action"
                >
                    <img
                        src={centerAvatarUrl}
                        alt={centerAvatar.name}
                        className="cinematic-avatar-img"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                </div>
            )}

            <div className="chat-history" ref={chatHistoryRef}>
                <StreamingIndicators
                    formattedStreamingText={formattedStreamingText}
                    viewMode="cinematic"
                    currentCharacterId={currentCharacterId}
                    streamingPortraitUrl={streamingPortraitUrl}
                    messagesLength={displayMessages.length}
                    onAvatarClick={onAvatarClick}
                />

                {displayMessages.map((message, renderIndex) => {
                    if (!message.character) return null;
                    const index = renderIndex;
                    const dn = resolveDelayedDisplayNameFromCache(displayNameCache, index, message.character.id);
                    
                    const stem = (() => {
                        if (!parentInteractionMessageId) return false;
                        const bi = displayMessages.findIndex(m => m.id === parentInteractionMessageId);
                        if (bi === -1) return false;
                        const ci = displayMessages.findIndex(m => m.id === message.id);
                        return ci !== -1 && ci <= bi;
                    })();
                    
                    const branchOffIndex = parentInteractionMessageId
                        ? displayMessages.findIndex(m => m.id === parentInteractionMessageId)
                        : -1;
                    const beforeBranch = !!(parentInteractionMessageId && index === branchOffIndex);

                    const messagePortraitUrl = portraitUrlCache.get(message.id)
                        ?? portraitUrlCache.get(`character:${message.character.id}`)
                        ?? null;

                    return (
                        <div key={message.id} id={`message-${message.id}`}>
                            <MessageBubble
                                message={message}
                                index={index}
                                viewMode="cinematic"
                                currentCharacterId={currentCharacterId}
                                editingId={editingId}
                                editDraft={editDraft}
                                massDeleteId={massDeleteId}
                                isMassActive={isMassActive}
                                massStartIndex={massStartIndex}
                                activeToolbarId={activeToolbarId}
                                portraitUrl={messagePortraitUrl}
                                displayName={dn}
                                isStem={stem}
                                beforeBranch={beforeBranch}
                                onAvatarClick={onAvatarClick}
                                onStartEditing={onStartEditing}
                                onCancelEditing={onCancelEditing}
                                onSaveEdit={onSaveEdit}
                                onRegenerateFromEdit={onRegenerateFromEdit}
                                onResumeGeneration={onResumeGeneration}
                                onCopyText={onCopyText}
                                onRegenerateFromMessage={onRegenerateFromMessage}
                                onBranch={onBranch}
                                onClone={onClone}
                                onDelete={onDelete}
                                onSetMassDelete={onSetMassDelete}
                                onMassDeleteConfirm={onMassDeleteConfirm}
                                onCancelMassDelete={onCancelMassDelete}
                                onTouchStart={onTouchStart}
                                onTouchEnd={onTouchEnd}
                                onTouchMove={onTouchMove}
                                suppressNextClickRef={suppressNextClickRef}
                                editTextareaRef={editTextareaRef}
                                setEditDraft={setEditDraft}
                                onNavigateToBranchSource={onNavigateToBranchSource}
                            />
                        </div>
                    );
                })}

                {displayMessages.length === 0 && !isLoading && (
                    <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}>
                        <p>Add characters to the chat and start chatting.</p>
                    </div>
                )}
                <div ref={messageEndRef} style={{ height: '1px' }} />
            </div>
        </>
    );
});