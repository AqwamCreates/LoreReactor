// src/hooks/useViewAssets.ts
import { useState, useRef, useEffect, useMemo } from 'react';
import type { Character, InteractionData, ChatMessage } from '../types';
import { getCharacterImageUrl, getLocationImageUrl, getMultiplayerCharacterImageUrl } from '../storage/serverStorage';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

interface UseViewAssetsOptions {
    viewMode: 'ladder' | 'cinematic' | 'vn';
    interactionData: InteractionData | null;
    currentCharacter: Character | null;
    localProtagonist: Character | null;
    streamingCharacter: Character | null;
    currentCharacterExpression: string;
    chatHistoryRef: React.RefObject<HTMLDivElement | null>;
    isMultiplayerChat?: boolean; // <-- ADDED
}

// UPDATED: Added isMultiplayerChat for the || fallback chain
function resolvePortrait(characterId: string, images: Record<string, string> | undefined, expression?: string, isMultiplayerChat?: boolean): string | null {
    const expr = expression || 'neutral';
    const filename = images?.[expr] || images?.neutral;
    if (!filename) return null;
    
    // YOUR EXACT LOGIC: Try main folder, fallback to multiplayer folder if session is multiplayer
    return getCharacterImageUrl(characterId, filename) || (isMultiplayerChat ? getMultiplayerCharacterImageUrl(characterId, filename) : null);
}

function resolveLocationBackgroundUrl(interactionData: InteractionData, localProtagonist: Character): string | null {
    const locations = interactionData.locations;
    if (!locations || locations.length === 0) return null;
    let currentLocIndex: number | undefined;
    const history = interactionData.interactionHistory;
    for (let i = history.length - 1; i >= 0; i--) {
        const locationIndex = history[i].locationIndex;
        if (locationIndex !== undefined && locationIndex >= 0) {
            currentLocIndex = history[i].locationIndex;
            break;
        }
    }
    if (currentLocIndex === undefined) return null;
    const loc = locations[currentLocIndex];
    if (!loc?.images || loc.images.length === 0) return null;
    const protagonistId = localProtagonist.id;
    let lastUserText = '';
    if (protagonistId) {
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.messageType === 'chat' && msg.character.id === protagonistId) {
                lastUserText = msg.textContent;
                break;
            }
        }
    }
    const regexTriggers = loc.backgroundImageRegularExpressionActivationTriggers;
    if (regexTriggers && Object.keys(regexTriggers).length > 0 && lastUserText) {
        for (const [idxStr, pattern] of Object.entries(regexTriggers)) {
            if (!pattern.trim()) continue;
            try {
                const regex = new RegExp(pattern);
                if (regex.test(lastUserText)) {
                    const idx = Number(idxStr);
                    if (idx >= 0 && idx < loc.images.length && loc.images[idx]) {
                        return getLocationImageUrl(loc.id, loc.images[idx]);
                    }
                }
            } catch {}
        }
    }
    const weights = loc.backgroundImageWeights;
    if (weights && Object.keys(weights).length > 0) {
        const pool: { index: number; weight: number }[] = [];
        let totalWeight = 0;
        for (const [idxStr, w] of Object.entries(weights)) {
            const idx = Number(idxStr);
            if (idx >= 0 && idx < loc.images.length && loc.images[idx] && w > 0) {
                pool.push({ index: idx, weight: w });
                totalWeight += w;
            }
        }
        if (pool.length > 0 && totalWeight > 0) {
            let randomValue = Math.random() * totalWeight;
            for (const entry of pool) {
                randomValue -= entry.weight;
                if (randomValue <= 0) return getLocationImageUrl(loc.id, loc.images[entry.index]);
            }
            return getLocationImageUrl(loc.id, loc.images[pool[pool.length - 1].index]);
        }
    }
    if (loc.images[0]) return getLocationImageUrl(loc.id, loc.images[0]);
    return null;
}

export function useViewAssets(options: UseViewAssetsOptions) {
    const {
        viewMode, interactionData, currentCharacter, localProtagonist,
        streamingCharacter, currentCharacterExpression, chatHistoryRef,
        isMultiplayerChat, // <-- ADDED
    } = options;

    const [centerAvatar, setCenterAvatar] = useState<Character | null>(null);
    const centerAvatarRef = useRef<Character | null>(null);
    const lastViewedMessageIdRef = useRef<string | null>(null);
    const suppressAutoScrollRef = useRef(false);

    useEffect(() => { centerAvatarRef.current = centerAvatar; }, [centerAvatar]);

    const chatMessages = useMemo(() => {
        if (!interactionData) return [];
        return interactionData.interactionHistory.filter((m): m is ChatMessage => m.messageType === 'chat');
    }, [interactionData]);

    const portraitUrlCache = useMemo(() => {
        const cache = new Map<string, string | null>();

        if (interactionData) {
            for (const participant of interactionData.participants) {
                // Pass isMultiplayerChat to all resolvePortrait calls
                const url = resolvePortrait(participant.id, participant.images, 'neutral', isMultiplayerChat);
                cache.set(`character:${participant.id}`, url);
            }
        }

        for (const msg of chatMessages) {
            const url = resolvePortrait(msg.character.id, msg.character.images, msg.characterExpression, isMultiplayerChat);
            cache.set(`character:${msg.character.id}`, url);
            cache.set(msg.id, url);
        }

        if (centerAvatar) {
            const url = resolvePortrait(centerAvatar.id, centerAvatar.images, 'neutral', isMultiplayerChat);
            cache.set(`character:${centerAvatar.id}`, url);
        }

        if (streamingCharacter) {
            const url = resolvePortrait(streamingCharacter.id, streamingCharacter.images, currentCharacterExpression, isMultiplayerChat);
            cache.set(`character:${streamingCharacter.id}`, url);
        }

        return cache;
    }, [chatMessages, centerAvatar, streamingCharacter, currentCharacterExpression, interactionData, isMultiplayerChat]);

    const streamingPortraitUrl = useMemo(() => {
        if (!streamingCharacter) return null;
        return portraitUrlCache.get(`character:${streamingCharacter.id}`) || null;
    }, [streamingCharacter, portraitUrlCache]);

    const locationBackgroundUrl = interactionData && localProtagonist
        ? resolveLocationBackgroundUrl(interactionData, localProtagonist)
        : null;

    useEffect(() => {
        const chatHistoryElement = chatHistoryRef.current;
        if (viewMode !== 'cinematic' || !chatHistoryElement || !interactionData || chatMessages.length === 0) {
            setCenterAvatar(null);
            return;
        }

        const updateAvatarFromScroll = () => {
            const containerRect = chatHistoryElement.getBoundingClientRect();
            const elements = chatHistoryElement.querySelectorAll('[data-message-id]');

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

            if (!bestId || bestOverlap <= 0) return;

            const msg = chatMessages.find(m => m.id === bestId);
            if (!msg?.character) return;

            for (const el of document.querySelectorAll('.message-row')) el.classList.remove('is-active');
            const activeEl = chatHistoryElement.querySelector(`[data-message-id="${bestId}"]`);
            if (activeEl) activeEl.classList.add('is-active');
            lastViewedMessageIdRef.current = bestId;

            if (msg.character.id === currentCharacter?.id || msg.character.id === AMBIENT_NARRATOR_ID) {
                setCenterAvatar(null);
            } else {
                setCenterAvatar(msg.character);
            }
        };

        const rafId = requestAnimationFrame(() => {
            updateAvatarFromScroll();

            if (!centerAvatarRef.current) {
                for (let i = chatMessages.length - 1; i >= 0; i--) {
                    const m = chatMessages[i];
                    if (m.character && m.character.id !== currentCharacter?.id && m.character.id !== AMBIENT_NARRATOR_ID) {
                        setCenterAvatar(m.character);
                        break;
                    }
                }
            }
        });

        chatHistoryElement.addEventListener('scroll', updateAvatarFromScroll, { passive: true });

        return () => {
            cancelAnimationFrame(rafId);
            chatHistoryElement.removeEventListener('scroll', updateAvatarFromScroll);
        };
    }, [viewMode, currentCharacter?.id, interactionData, chatMessages, chatHistoryRef]);

    useEffect(() => {
        const chatHistoryElement = chatHistoryRef.current;
        if (viewMode !== 'cinematic' || !chatHistoryElement || suppressAutoScrollRef.current) return;
        chatHistoryElement.scrollTop = 0;
    }, [viewMode, chatHistoryRef]);

    return {
        centerAvatar, setCenterAvatar,
        lastViewedMessageIdRef,
        suppressAutoScrollRef,
        chatMessages,
        portraitUrlCache,
        streamingPortraitUrl,
        locationBackgroundUrl,
    };
}