// src/components/views/VisualNovelView.tsx
import React, { useMemo } from 'react';
import type { ViewModeProps } from './types';
import type { ChatMessage } from '../../types';
import { MemoizedMessageText } from '../MemoizedMessageText';

interface MovementTrigger {
    regex: RegExp;
    scaleDelta: number;
    speed: 'instant' | 'fast' | 'normal' | 'slow';
}

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
        if (msg.messageType !== 'chat') continue;
        const text = msg.textContent;
        if (!text) continue;

        let moved = false;
        for (const trigger of MOVEMENT_TRIGGERS) {
            if (trigger.regex.test(text)) {
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

        if (!moved && currentScale !== 1.0) {
            currentScale += (1.0 - currentScale) * 0.05;
        }
    }

    currentScale = Math.max(0.4, Math.min(2.5, currentScale));
    return { scale: currentScale, transitionSpeed: currentSpeed };
}

export const VisualNovelView = React.memo(function VisualNovelView(props: ViewModeProps) {
    const {
        interactionData, displayMessages, currentCharacterId,
        portraitUrlCache, locationBackgroundUrl,
        formattedStreamingText, isLoading, streamingPortraitUrl,
        chatHistoryRef, messageEndRef,
    } = props;

    const protagonistId = interactionData.protagonist?.id;

    // Filter out protagonist — we are the camera, we never see ourselves
    const visibleCharacters = useMemo(() => {
        return interactionData.participants.filter(p => p.id !== protagonistId);
    }, [interactionData.participants, protagonistId]);

    // Get chat messages for scale calculation
    const chatMessages = useMemo(() => {
        return displayMessages.filter((m): m is ChatMessage => m.messageType === 'chat');
    }, [displayMessages]);

    // Calculate scales for each visible character
    const characterScales = useMemo(() => {
        const scales = new Map<string, { scale: number; transitionSpeed: string }>();
        for (const char of visibleCharacters) {
            scales.set(char.id, calculateCharacterScale(char.id, chatMessages));
        }
        return scales;
    }, [visibleCharacters, chatMessages]);

    // Find the last speaking character (for dialogue box)
    const lastSpeaker = useMemo(() => {
        for (let i = chatMessages.length - 1; i >= 0; i--) {
            const msg = chatMessages[i];
            if (msg.character.id !== protagonistId) {
                return msg;
            }
        }
        return null;
    }, [chatMessages, protagonistId]);

    // Background image
    const bgStyle: React.CSSProperties = locationBackgroundUrl
        ? { backgroundImage: `url(${locationBackgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : {};

    return (
        <div className="vn-stage-container" style={bgStyle}>
            {/* Character Sprites Layer */}
            <div className="vn-sprites-layer">
                {visibleCharacters.map((character, idx) => {
                    const portraitKey = `cinematic:${character.id}`;
                    const portraitUrl = portraitUrlCache.get(portraitKey)
                        || portraitUrlCache.get(character.id)
                        || null;

                    if (!portraitUrl) return null;

                    const scaleData = characterScales.get(character.id) || { scale: 1.0, transitionSpeed: '0.5s' };

                    // Spread characters horizontally so they don't overlap
                    const totalVisible = visibleCharacters.length;
                    const spacing = totalVisible === 1 ? 50 : (20 + (idx * (60 / Math.max(totalVisible - 1, 1))));

                    return (
                        <div
                            key={character.id}
                            className="vn-character-layer"
                            style={{
                                left: `${spacing}%`,
                                bottom: '0',
                                transform: `translateX(-50%) scale(${scaleData.scale})`,
                                transformOrigin: 'bottom center',
                                transition: `transform ${scaleData.transitionSpeed} ease-in-out`,
                                zIndex: Math.round(scaleData.scale * 10),
                            }}
                        >
                            <img
                                src={portraitUrl}
                                alt={character.name}
                                className="vn-sprite"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                        </div>
                    );
                })}

                {/* Streaming character overlay */}
                {isLoading && streamingPortraitUrl && lastSpeaker && (
                    <div
                        className="vn-character-layer vn-streaming-indicator"
                        style={{
                            left: '50%',
                            bottom: '0',
                            transform: 'translateX(-50%) scale(1.0)',
                            transformOrigin: 'bottom center',
                            zIndex: 100,
                            opacity: 0.6,
                        }}
                    >
                        <img
                            src={streamingPortraitUrl}
                            alt="Speaking..."
                            className="vn-sprite"
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                    </div>
                )}
            </div>

            {/* Dialogue Box Layer */}
            <div className="vn-dialogue-layer">
                {lastSpeaker && (
                    <div className="vn-dialogue-box">
                        <div className="vn-dialogue-speaker">
                            {lastSpeaker.character.name}
                        </div>
                        <div className="vn-dialogue-text">
                            <MemoizedMessageText text={lastSpeaker.textContent} />
                        </div>
                    </div>
                )}

                {/* Streaming text in dialogue box */}
                {isLoading && formattedStreamingText && (
                    <div className="vn-dialogue-box vn-dialogue-streaming">
                        <div className="vn-dialogue-speaker">
                            {lastSpeaker?.character.name || '...'}
                        </div>
                        <div className="vn-dialogue-text">
                            {formattedStreamingText}
                        </div>
                    </div>
                )}

                {!lastSpeaker && !isLoading && (
                    <div className="vn-dialogue-box vn-dialogue-empty">
                        <div className="vn-dialogue-text" style={{ opacity: 0.5, fontStyle: 'italic' }}>
                            Waiting for interaction...
                        </div>
                    </div>
                )}
            </div>

            {/* Hidden scroll anchor */}
            <div ref={messageEndRef} style={{ height: '1px', position: 'absolute', bottom: 0 }} />
        </div>
    );
});