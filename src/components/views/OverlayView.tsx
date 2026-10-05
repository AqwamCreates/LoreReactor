// src/components/views/OverlayView.tsx
import { createPortal } from 'react-dom';
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type React from 'react';
import type { ViewModeProps } from './types';
import { useSessionStore } from '../../hooks/useSessionStore';
import { formatDisplayMessageText } from '../../utilities/textDisplayFormatter';
import { getCharacterImageUrl } from '../../storages/serverStorage';

interface OverlayViewProps extends ViewModeProps {
    pipWindow?: Window | null;
    isInAppOverlay?: boolean;
    onCloseInApp?: () => void;
    locationBackgroundUrl?: string | null;
}

export function OverlayView(props: OverlayViewProps) {
    const {
        displayMessages,
        portraitUrlCache,
        pipWindow,
        isInAppOverlay,
        onCloseInApp,
        locationBackgroundUrl,
    } = props;

    // Pull session state directly from Zustand
    const streamingText = useSessionStore((s) => s.streamingText);
    const streamingCharacter = useSessionStore((s) => s.streamingCharacter);
    const isLoading = useSessionStore((s) => s.isLoading);
    const localProtagonist = useSessionStore((s) => s.localProtagonist);
    const currentCharacterExpression = useSessionStore((s) => s.currentCharacterExpression);
    const interactionData = useSessionStore((s) => s.interactionData);

    // ─── Web UI Background Color Detection ───────────────────────────
    const webUiBgColor = useMemo(() => {
        if (typeof window === 'undefined') return '#16171d';
        const computed = window.getComputedStyle(document.body).backgroundColor;
        return computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent'
            ? computed
            : 'var(--bg, #16171d)';
    }, []);

    // ─── Stealth Input Logic ─────────────────────────────────────────
    const [inputText, setInputText] = useState('');
    const [isInputFocused, setIsInputFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSend = useCallback(() => {
        const trimmed = inputText.trim();
        if (!trimmed || isLoading) return;

        window.dispatchEvent(new CustomEvent('overlay-send-message', {
            detail: { text: trimmed }
        }));
        setInputText('');
        setIsInputFocused(false);
        inputRef.current?.blur();
    }, [inputText, isLoading]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        if (e.key === 'Escape') {
            inputRef.current?.blur();
            setIsInputFocused(false);
        }
    }, [handleSend]);

    // ─── Companion Character Resolution ──────────────────────────────
    const companionCharacter = useMemo(() => {
        const protagonistId = localProtagonist?.id ?? interactionData?.protagonistIds?.[0];
        const nonUser = interactionData?.participants?.find((p) => p.id !== protagonistId);
        return nonUser || interactionData?.participants?.[0] || null;
    }, [interactionData, localProtagonist]);

    const lastAiMessage = useMemo(() => {
        const protagonistId = localProtagonist?.id ?? interactionData?.protagonistIds?.[0];
        for (let i = displayMessages.length - 1; i >= 0; i--) {
            const msg = displayMessages[i];
            if ((msg.messageType === 'chat' || msg.messageType === 'whisper') && msg.character.id !== protagonistId) {
                return msg;
            }
        }
        return null;
    }, [displayMessages, localProtagonist, interactionData]);

    // ─── Active Speaker Logic (for Dialogue Box) ─────────────────────
    const { activeCharacter, activeText, isUser, activeMessageId } = useMemo(() => {
        if (isLoading && streamingCharacter) {
            return {
                activeCharacter: streamingCharacter,
                activeText: streamingText || '',
                isUser: false,
                activeMessageId: null,
            };
        }
        const protagonistId = localProtagonist?.id ?? interactionData?.protagonistIds?.[0];
        for (let i = displayMessages.length - 1; i >= 0; i--) {
            const msg = displayMessages[i];
            if (msg.messageType === 'chat' || msg.messageType === 'whisper') {
                return {
                    activeCharacter: msg.character,
                    activeText: msg.textContent || '',
                    isUser: protagonistId ? msg.character.id === protagonistId : false,
                    activeMessageId: msg.id,
                };
            }
        }
        return {
            activeCharacter: companionCharacter,
            activeText: '',
            isUser: false,
            activeMessageId: null,
        };
    }, [isLoading, streamingCharacter, streamingText, displayMessages, localProtagonist, interactionData, companionCharacter]);

    // ─── Active Avatar Character (for Stage) ─────────────────────────
    const avatarCharacter = useMemo(() => {
        if (isLoading && streamingCharacter) return streamingCharacter;
        if (activeCharacter && !isUser) return activeCharacter;
        return lastAiMessage?.character || companionCharacter || activeCharacter;
    }, [isLoading, streamingCharacter, activeCharacter, isUser, lastAiMessage, companionCharacter]);

    // ─── Portrait URL Resolution ─────────────────────────────────────
    const getCachedPortrait = useCallback((key: string): string | null => {
        if (!portraitUrlCache) return null;
        if (portraitUrlCache instanceof Map) {
            return portraitUrlCache.get(key) ?? null;
        }
        return (portraitUrlCache as any)[key] ?? null;
    }, [portraitUrlCache]);

    const avatarUrl = useMemo(() => {
        if (!avatarCharacter) return null;

        if (isLoading && streamingCharacter && avatarCharacter.id === streamingCharacter.id) {
            const streamedUrl = getCachedPortrait(`character:${streamingCharacter.id}`);
            if (streamedUrl) return streamedUrl;
        }

        if (activeMessageId && avatarCharacter.id === activeCharacter?.id) {
            const msgUrl = getCachedPortrait(activeMessageId);
            if (msgUrl) return msgUrl;
        }

        if (lastAiMessage && avatarCharacter.id === lastAiMessage.character.id) {
            const msgUrl = getCachedPortrait(lastAiMessage.id);
            if (msgUrl) return msgUrl;
        }

        const charUrl = getCachedPortrait(`character:${avatarCharacter.id}`);
        if (charUrl) return charUrl;

        const expr = (avatarCharacter.id === streamingCharacter?.id ? currentCharacterExpression : undefined) || 'neutral';
        const filename = avatarCharacter.images?.[expr] || avatarCharacter.images?.neutral || Object.values(avatarCharacter.images || {})[0];
        if (filename) {
            if (filename.startsWith('data:') || filename.startsWith('http://') || filename.startsWith('https://')) {
                return filename;
            }
            return getCharacterImageUrl(avatarCharacter.id, filename);
        }

        return null;
    }, [
        avatarCharacter,
        activeCharacter,
        activeMessageId,
        lastAiMessage,
        isLoading,
        streamingCharacter,
        currentCharacterExpression,
        getCachedPortrait,
    ]);

    const charName = activeCharacter?.name || companionCharacter?.name || 'Assistant';

    const formattedActiveText = useMemo(() => {
        if (!activeText) return null;
        return formatDisplayMessageText(activeText);
    }, [activeText]);

    // ─── Draggable Logic for In-App Fallback ─────────────────────────
    const dragRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x: typeof window !== 'undefined' ? window.innerWidth - 360 : 100, y: 80 });
    const [dragging, setDragging] = useState(false);
    const offset = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragging) return;
            setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
        };
        const handleMouseUp = () => setDragging(false);

        if (dragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragging]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.pip-inapp-header')) {
            offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
            setDragging(true);
        }
    };

    // ─── Sync Styles & Root Colors to PiP Window ─────────────────────
    useEffect(() => {
        if (!pipWindow || !pipWindow.document) return;
        const targetDoc = pipWindow.document;

        if (!targetDoc.title) {
            targetDoc.title = `${interactionData?.name || 'LoreReactor'} (Companion)`;
        }

        // Prevent browser canvas white bleed
        targetDoc.documentElement.style.height = '100%';
        targetDoc.documentElement.style.margin = '0';
        targetDoc.documentElement.style.padding = '0';
        targetDoc.documentElement.style.backgroundColor = webUiBgColor;

        targetDoc.body.style.height = '100%';
        targetDoc.body.style.margin = '0';
        targetDoc.body.style.padding = '0';
        targetDoc.body.style.overflow = 'hidden';
        targetDoc.body.style.backgroundColor = webUiBgColor;
        targetDoc.body.style.color = 'var(--text-h, #f3f4f6)';

        const existingStyles = targetDoc.head.querySelectorAll('style[data-pip-style], link[data-pip-style]');
        if (existingStyles.length === 0) {
            for (const sheet of Array.from(document.styleSheets)) {
                try {
                    if (sheet.cssRules) {
                        const newStyle = targetDoc.createElement('style');
                        newStyle.setAttribute('data-pip-style', 'true');
                        let rules = '';
                        for (const rule of Array.from(sheet.cssRules)) {
                            rules += rule.cssText;
                        }
                        newStyle.textContent = rules;
                        targetDoc.head.appendChild(newStyle);
                    }
                } catch {
                    if (sheet.href) {
                        const newLink = targetDoc.createElement('link');
                        newLink.setAttribute('data-pip-style', 'true');
                        newLink.rel = 'stylesheet';
                        newLink.href = sheet.href;
                        targetDoc.head.appendChild(newLink);
                    }
                }
            }
        }
    }, [pipWindow, interactionData?.name, webUiBgColor]);

    // ─── Core UI Content ─────────────────────────────────────────────
    const overlayContent = (
        <div 
            className="pip-overlay-container" 
            style={{ 
                backgroundColor: webUiBgColor,
                height: '100%',
                width: '100%',
            }}
            onMouseDown={handleMouseDown}
        >
            {/* In-App Drag Handle & Close Button */}
            {isInAppOverlay && (
                <div className="pip-inapp-header">
                    <span>⠿ COMPANION</span>
                    <button className="pip-inapp-close" onClick={(e) => { e.stopPropagation(); onCloseInApp?.(); }}>✕</button>
                </div>
            )}

            {/* Native PiP Header */}
            {!isInAppOverlay && (
                <div className="pip-header">
                    <div className="pip-header-title"><span>◆</span> COMPANION</div>
                    <div className="pip-status-indicator">
                        <div className={`pip-status-dot ${isLoading ? 'active' : ''}`} />
                        <span>{isLoading ? 'Streaming' : 'Idle'}</span>
                    </div>
                </div>
            )}

            {/* Avatar Stage */}
            <div 
                className="pip-avatar-stage"
                style={{
                    backgroundColor: locationBackgroundUrl ? 'transparent' : webUiBgColor,
                    position: 'relative',
                    overflow: 'hidden',
                }}
            >
                {/* 1. Location Background (if in a location) */}
                {locationBackgroundUrl ? (
                    <>
                        <div
                            className="pip-location-bg"
                            style={{
                                backgroundImage: `url(${locationBackgroundUrl})`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                                position: 'absolute',
                                inset: 0,
                                filter: 'brightness(0.55) contrast(1.05)',
                                zIndex: 0,
                                pointerEvents: 'none',
                            }}
                        />
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'linear-gradient(to bottom, rgba(13,13,18,0.15) 0%, rgba(13,13,18,0.75) 100%)',
                                zIndex: 1,
                                pointerEvents: 'none',
                            }}
                        />
                    </>
                ) : (
                    /* 2. No Location: Clean UI Background with subtle radial ambient glow */
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: `radial-gradient(circle at 50% 35%, var(--social-bg, rgba(255,255,255,0.04)) 0%, ${webUiBgColor} 85%)`,
                            zIndex: 0,
                            pointerEvents: 'none',
                        }}
                    />
                )}

                {/* 3. 9:16 Character Sprite (Enlarged and Grounded) */}
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt={avatarCharacter?.name || charName}
                        className={`pip-avatar-img ${isLoading ? 'speaking' : ''}`}
                        style={{
                            aspectRatio: '9 / 16',
                            objectFit: 'contain',
                            objectPosition: 'center bottom',
                            height: '100%',
                            width: 'auto',
                            maxWidth: '100%',
                            position: 'relative',
                            zIndex: 2,
                            transform: 'scale(1.18)',
                            transformOrigin: 'center bottom',
                            filter: 'drop-shadow(0 12px 28px rgba(0,0,0,0.65))',
                        }}
                    />
                ) : (
                    <div className="pip-avatar-placeholder" style={{ zIndex: 2 }}>🎭</div>
                )}
            </div>

            {/* Dialogue Box (Slightly more compact for greater avatar presence) */}
            <div className="pip-dialogue-box" style={{ height: '145px', flexShrink: 0 }}>
                <div className={`pip-dialogue-name ${isUser ? 'user' : ''}`}>{charName}</div>
                <div className="pip-dialogue-text">
                    {isLoading && !streamingText ? (
                        <div className="pip-thinking-dots"><span></span><span></span><span></span></div>
                    ) : formattedActiveText ? (
                        formattedActiveText
                    ) : (
                        <div className="pip-empty-state">Awaiting interaction...</div>
                    )}
                </div>
            </div>

            {/* Auto-Hide Stealth Chat Input */}
            <div className={`pip-stealth-input-wrapper ${isInputFocused ? 'focused' : ''}`}>
                <input
                    ref={inputRef}
                    type="text"
                    className="pip-stealth-input"
                    placeholder="Say something..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    autoComplete="off"
                    disabled={isLoading}
                />
            </div>
        </div>
    );

    // 1. Portal to Native OS Window
    if (pipWindow && pipWindow.document) {
        return createPortal(overlayContent, pipWindow.document.body);
    }

    // 2. Render In-App Draggable Fallback
    if (isInAppOverlay) {
        return (
            <div
                ref={dragRef}
                className="pip-inapp-wrapper"
                style={{
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    cursor: dragging ? 'grabbing' : 'default'
                }}
            >
                {overlayContent}
            </div>
        );
    }

    return null;
}