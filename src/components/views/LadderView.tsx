// src/components/views/LadderView.tsx
import React from 'react';
import type { ViewModeProps } from './types';
import { MessageBubble } from '../MessageBubble';
import { StreamingIndicators } from '../StreamingIndicators';
import { ChatScrollButtons } from '../ChatScrollButtons';
import { resolveDelayedDisplayNameFromCache } from '../../hooks/immersionLogic';

export const LadderView = React.memo(function LadderView(props: ViewModeProps) {
    const {
        interactionData, displayMessages, currentCharacterId,
        editingId, editDraft, massDeleteId, isMassActive, massStartIndex,
        activeToolbarId, portraitUrlCache, displayNameCache,
        formattedStreamingText, isLoading, streamingPortraitUrl,
        chatHistoryRef, messageEndRef, editTextareaRef,
        parentInteractionMessageId,
        onAvatarClick, onStartEditing, onCancelEditing, onSaveEdit,
        onRegenerateFromEdit, onResumeGeneration, onCopyText,
        onRegenerateFromMessage, onBranch, onClone, onDelete,
        onSetMassDelete, onMassDeleteConfirm, onCancelMassDelete,
        onTouchStart, onTouchEnd, onTouchMove,
        suppressNextClickRef, setEditDraft, onNavigateToBranchSource,
    } = props;

    const lastMsg = displayMessages[displayMessages.length - 1];
    const isStreamingInList = lastMsg?.isPartial === true;

    return (
        <div className="chat-history" ref={chatHistoryRef}>
            {interactionData.interactionHistory.length > 3 && (
                <ChatScrollButtons containerRef={chatHistoryRef} />
            )}

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
                
                // Unified cache lookup: message ID first, then canonical character key
                const messagePortraitUrl = portraitUrlCache.get(message.id)
                    ?? portraitUrlCache.get(`character:${message.character.id}`)
                    ?? null;

                return (
                    <MessageBubble
                        key={message.id}
                        message={message}
                        index={index}
                        viewMode="ladder"
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
                );
            })}

            {!isStreamingInList && (
                <StreamingIndicators
                    formattedStreamingText={formattedStreamingText}
                    viewMode="ladder"
                    currentCharacterId={currentCharacterId}
                    streamingPortraitUrl={streamingPortraitUrl}
                    messagesLength={displayMessages.length}
                    onAvatarClick={onAvatarClick}
                />
            )}

            {displayMessages.length === 0 && !isLoading && (
                <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '50px' }}>
                    <p>Add characters to the chat and start chatting.</p>
                </div>
            )}
            <div ref={messageEndRef} style={{ height: '1px' }} />
        </div>
    );
});