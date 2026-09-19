// src/components/views/CinematicView.tsx
import React, { useEffect, useCallback, useRef } from 'react';
import type { ViewModeProps } from './types';
import type { ChatMessage } from '../../types';
import { MessageBubble } from '../MessageBubble';
import { StreamingIndicators } from '../StreamingIndicators';
import { ChatScrollButtons } from '../ChatScrollButtons';
import { ChatMinimap } from '../ChatMinimap';
import { resolveDelayedDisplayNameFromCache } from '../../hooks/immersionLogic';

export const CinematicView = React.memo(function CinematicView(props: ViewModeProps) {
    const {
        interactionData, displayMessages, currentCharacterId,
        editingId, editDraft, massDeleteId, isMassActive, massStartIndex,
        activeToolbarId, portraitUrlCache, displayNameCache,
        centerAvatar, streamingPortraitUrl, formattedStreamingText,
        isLoading, chatHistoryRef, messageEndRef, editTextareaRef,
        parentInteractionMessageId, parentInteractionDataName,
        focusedMessageId, setFocusedMessageId,
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

    const isScrollingRef = useRef(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const skipNextFocusScrollRef = useRef(false);

    useEffect(() => {
        if (skipNextFocusScrollRef.current) {
            skipNextFocusScrollRef.current = false;
            return;
        }

        if (focusedMessageId && chatHistoryRef.current && !isScrollingRef.current) {
            const msgElement = chatHistoryRef.current.querySelector(`[data-message-id="${focusedMessageId}"]`);
            if (msgElement) {
                isScrollingRef.current = true;
                msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => { isScrollingRef.current = false; }, 500);
            }
        }
    }, [focusedMessageId, chatHistoryRef]);

    const updateFocusedFromScroll = useCallback(() => {
        if (!chatHistoryRef.current || isScrollingRef.current) return;

        const container = chatHistoryRef.current;
        const containerRect = container.getBoundingClientRect();
        const elements = container.querySelectorAll('[data-message-id]');

        let bestId: string | null = null;
        let bestOverlap = Number.NEGATIVE_INFINITY;

        for (const el of elements) {
            const rect = el.getBoundingClientRect();
            const overlapTop = Math.max(rect.top, containerRect.top);
            const overlapBottom = Math.min(rect.bottom, containerRect.bottom);
            const overlap = overlapBottom - overlapTop;

            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestId = el.getAttribute('data-message-id');
            }
        }

        if (bestId && bestOverlap > 0 && bestId !== focusedMessageId) {
            skipNextFocusScrollRef.current = true;
            setFocusedMessageId(bestId);
        }
    }, [chatHistoryRef, focusedMessageId, setFocusedMessageId]);

    useEffect(() => {
        const container = chatHistoryRef.current;
        if (!container) return;

        const handleScroll = () => {
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = setTimeout(updateFocusedFromScroll, 100);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            container.removeEventListener('scroll', handleScroll);
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        };
    }, [chatHistoryRef, updateFocusedFromScroll]);

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

            {/* MOVED OUTSIDE: Minimap must be outside .chat-history because the CSS mask-image 
                on .chat-history breaks position:fixed containing blocks */}
            {interactionData && interactionData.interactionHistory.length > 5 && (
                <ChatMinimap
                    messages={interactionData.interactionHistory.filter((m): m is ChatMessage => m.messageType === 'chat')}
                    containerRef={chatHistoryRef}
                    currentCharacterId={currentCharacterId}
                />
            )}

            {/* MOVED OUTSIDE: Scroll buttons must also be outside .chat-history for the same reason */}
            {interactionData && interactionData.interactionHistory.length > 3 && (
                <ChatScrollButtons 
                    containerRef={chatHistoryRef} 
                    messageCount={displayMessages.length} 
                    useViewportBounds={true}
                />
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
                    const dn = displayNameCache
                        ? resolveDelayedDisplayNameFromCache(displayNameCache, index, message.character.id)
                        : message.character.name;
                    
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
                        <MessageBubble
                            key={message.id}
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
                            parentInteractionDataName={parentInteractionDataName}
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