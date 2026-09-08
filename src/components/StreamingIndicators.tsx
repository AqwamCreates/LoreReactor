// src/components/StreamingIndicators.tsx
import type React from 'react';
import type { Character } from '../types';
import { getDelayedDisplayName } from '../hooks/immersionLogic';
import { useSessionStore } from '../store/useSessionStore';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

interface StreamingIndicatorsProps {
    formattedStreamingText: React.ReactNode;
    viewMode: 'ladder' | 'cinematic';
    currentCharacterId: string | undefined;
    streamingPortraitUrl: string | null;
    messagesLength: number;
    onAvatarClick: (e: React.MouseEvent, id: string, char: Character) => void;
}

export function StreamingIndicators({
    formattedStreamingText,
    viewMode, currentCharacterId, streamingPortraitUrl,
    messagesLength, onAvatarClick,
}: StreamingIndicatorsProps) {
    const isLoading = useSessionStore(s => s.isLoading);
    const streamingCharacter = useSessionStore(s => s.streamingCharacter);
    const streamingText = useSessionStore(s => s.streamingText);
    const interactionData = useSessionStore(s => s.interactionData);

    if (!isLoading || !streamingCharacter) return null;

    const isNotProtagOrAmbient = streamingCharacter.id !== currentCharacterId && streamingCharacter.id !== AMBIENT_NARRATOR_ID;
    const dn = interactionData
        ? getDelayedDisplayName(interactionData, Math.max(0, messagesLength - 1), streamingCharacter.id)
        : streamingCharacter.name;

    const avatarColumn = isNotProtagOrAmbient && viewMode === 'ladder' && (
        <div className="avatar-column">
            <div style={{ position: 'relative' }}>
                {streamingPortraitUrl
                    ? <img src={streamingPortraitUrl} alt={streamingCharacter.name} className="character-avatar" onClick={e => onAvatarClick(e, streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'thinking-message' : 'streaming-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} />
                    : <div className="character-avatar placeholder" onClick={e => onAvatarClick(e, streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'thinking-message' : 'streaming-message', streamingCharacter)} style={{ cursor: 'pointer', opacity: 0.5 }} />}
            </div>
            <span className="avatar-name" style={{ opacity: streamingText ? 1 : 0.5 }}>{dn}</span>
        </div>
    );

    // Thinking indicator (no text yet)
    if (!streamingText) {
        return (
            <div className={`message-row ${viewMode === 'cinematic' ? '' : 'message-left'}`} data-message-id="thinking-message">
                {avatarColumn}
                <div className={`message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} bubble-ai thinking-bubble`}>
                    {viewMode === 'cinematic' && <div className="cinematic-bubble-header"><span>{dn}</span></div>}
                    <span className="thinking-indicator">
                        <span className="thinking-text">Thinking</span>
                        <span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                    </span>
                </div>
            </div>
        );
    }

    // Active streaming
    const isAmbient = streamingCharacter.id === AMBIENT_NARRATOR_ID;
    const bubbleClass = `message-bubble ${viewMode === 'cinematic' ? 'cinematic-bubble' : ''} ${isAmbient ? 'bubble-ambient' : 'bubble-ai'}`;

    return (
        <div className={`message-row ${viewMode === 'cinematic' ? '' : 'message-left'}`} data-message-id="streaming-message">
            {avatarColumn}
            <div className={bubbleClass}>
                {viewMode === 'cinematic' && (
                    <div className={`cinematic-bubble-header ${isAmbient ? 'cinematic-bubble-header-ambient' : ''}`}>
                        <span>{isAmbient ? '✦' : dn}</span>
                    </div>
                )}
                <div style={{ display: 'inline', whiteSpace: 'pre-wrap' }}>
                    <span className="message-text" style={{ display: 'inline' }}>{formattedStreamingText}</span>
                    <span className="cursor-blink" style={{ display: 'inline' }}>&nbsp;▋</span>
                </div>
            </div>
        </div>
    );
}