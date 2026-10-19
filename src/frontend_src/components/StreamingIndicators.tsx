// src/frontend_src/components/StreamingIndicators.tsx
import type React from 'react';
import type { Character } from '../types';
import { getDelayedDisplayName } from '../utilities/immersionLogic';
import { useSessionStore } from '../hooks/useSessionStore';
import { MemoizedMessageText } from './MemoizedMessageText';

const AMBIENT_NARRATOR_ID = '___ambient_narrator___';

interface StreamingIndicatorsProps {
    streamingText: string | null; // ✅ CHANGED
    viewMode: 'ladder' | 'cinematic' | 'vn';
    selectedCharacterId: string | undefined;
    streamingPortraitUrl: string | null;
    messagesLength: number;
    onAvatarClick: (e: React.MouseEvent, id: string, char: Character) => void;
}

export function StreamingIndicators({
    streamingText,
    viewMode, streamingPortraitUrl,
    messagesLength, onAvatarClick,
}: StreamingIndicatorsProps) {
    const isLoading = useSessionStore(s => s.isLoading);
    const streamingCharacter = useSessionStore(s => s.streamingCharacter);
    const streamingText = useSessionStore(s => s.streamingText);
    const interactionData = useSessionStore(s => s.interactionData);

    const localProtagonistId = useSessionStore(s => s.localProtagonist?.id ?? s.interactionData?.protagonistIds?.[0] ?? null);
    const protagonistIds = useSessionStore(s => s.interactionData?.protagonistIds || []);

    if (!isLoading || !streamingCharacter) return null;

    const isProtagonist = localProtagonistId ? streamingCharacter.id === localProtagonistId : protagonistIds.includes(streamingCharacter.id);
    const isNotProtagOrAmbient = !isProtagonist && streamingCharacter.id !== AMBIENT_NARRATOR_ID;
    
    const dn = interactionData
        ? getDelayedDisplayName(interactionData, streamingCharacter, Math.max(0, messagesLength - 1), localProtagonistId)
        : streamingCharacter.name;

    const avatarColumn = isNotProtagOrAmbient && viewMode === 'ladder' && (
        <div className="avatar-column">
            <div style={{ position: 'relative' }}>
                {streamingPortraitUrl ? (
                    <img src={streamingPortraitUrl} alt={streamingCharacter.name} className="character-avatar"
                        onClick={e => onAvatarClick(e, streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'thinking-message' : 'streaming-message', streamingCharacter)}
                        onError={e => { e.currentTarget.style.display = 'none'; }} style={{ cursor: 'pointer', opacity: 0.5 }} />
                ) : (
                    <div className="character-avatar placeholder"
                        onClick={e => onAvatarClick(e, streamingCharacter.id === AMBIENT_NARRATOR_ID ? 'thinking-message' : 'streaming-message', streamingCharacter)}
                        style={{ cursor: 'pointer', opacity: 0.5 }} />
                )}
            </div>
            <span className="avatar-name" style={{ opacity: streamingText ? 1 : 0.5 }}>{dn}</span>
        </div>
    );

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
                    <span className="message-text" style={{ display: 'inline' }}>
                        {/* ✅ Render the raw string through the universal memoized formatter */}
                        {streamingText ? <MemoizedMessageText text={streamingText} /> : null}
                    </span>
                    <span className="cursor-blink" style={{ display: 'inline' }}>&nbsp;▋</span>
                </div>
            </div>
        </div>
    );
}