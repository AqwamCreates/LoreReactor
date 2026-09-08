// src/hooks/useCinematicMode.ts
import { useState, useRef, useEffect, useMemo } from 'react';
import type { Character, InteractionData, ChatMessage } from '../types';
import { getCharacterImageUrl, getLocationImageUrl } from './storage';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

interface UseCinematicModeOptions {
    viewMode: 'ladder' | 'cinematic';
    interactionData: InteractionData | null;
    currentCharacter: Character | null;
    streamingCharacter: Character | null;
    currentCharacterExpression: string;
    chatHistoryRef: React.RefObject<HTMLDivElement | null>;
}

export function useCinematicMode(options: UseCinematicModeOptions) {
    const {
        viewMode, interactionData, currentCharacter,
        streamingCharacter, currentCharacterExpression, chatHistoryRef,
    } = options;

    const [centerAvatar, setCenterAvatar] = useState<Character | null>(null);
    const lastViewedMessageIdRef = useRef<string | null>(null);
    const suppressAutoScrollRef = useRef(false);

    // Filter to only chat messages using discriminated union
    const chatMessages = useMemo(() => {
        if (!interactionData) return [];
        return interactionData.interactionHistory.filter((m): m is ChatMessage => m.kind === 'chat');
    }, [interactionData]);

    const portraitUrlCache = useMemo(() => {
        const cache = new Map<string, string | null>();

        const resolvePortrait = (characterId: string, images: Record<string, string> | undefined, expression?: string): string | null => {
            const expr = expression || 'neutral';
            const filename = images?.[expr] || images?.['neutral'];
            if (!filename) return null;
            return getCharacterImageUrl(characterId, filename);
        };

        for (const msg of chatMessages) {
            if (!cache.has(msg.id)) {
                cache.set(msg.id, resolvePortrait(msg.character.id, msg.character.images, msg.characterExpression));
            }
        }

        if (centerAvatar) {
            const key = `cinematic:${centerAvatar.id}`;
            if (!cache.has(key)) {
                cache.set(key, resolvePortrait(centerAvatar.id, centerAvatar.images, 'neutral'));
            }
        }

        return cache;
    }, [chatMessages, centerAvatar?.id]);

    const streamingPortraitUrl = useMemo(() => {
        if (!streamingCharacter) return null;
        const expr = currentCharacterExpression || 'neutral';
        const filename = streamingCharacter.images?.[expr] || streamingCharacter.images?.['neutral'];
        if (!filename) return null;
        return getCharacterImageUrl(streamingCharacter.id, filename);
    }, [streamingCharacter?.id, streamingCharacter?.images, currentCharacterExpression]);

    const locationBackgroundUrl = useMemo(() => {
        if (!interactionData) return null;
        const locations = interactionData.locations;
        if (!locations?.length) return null;

        // Search backwards through full history (not just chat messages) for location changes
        const history = interactionData.interactionHistory;
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.locationIndex !== undefined && msg.locationIndex >= 0) {
                const loc = locations[msg.locationIndex];
                if (loc?.images?.length && loc.images[0]) {
                    return getLocationImageUrl(loc.images[0]);
                }
                return null;
            }
        }

        return null;
    }, [interactionData]);

    // IntersectionObserver for cinematic avatar selection
    useEffect(() => {
        const chatHistoryElement = chatHistoryRef.current;
        if (viewMode !== 'cinematic' || !chatHistoryElement || !interactionData || chatMessages.length === 0) {
            const resetAvatar = window.setTimeout(() => setCenterAvatar(null), 0);
            return () => window.clearTimeout(resetAvatar);
        }
        const opts = { root: chatHistoryElement, threshold: [0.5, 0.8, 1.0], rootMargin: '-10% 0px -60% 0px' };
        const obs = new IntersectionObserver(entries => {
            const best = entries.reduce((p, c) => p.intersectionRatio > c.intersectionRatio ? p : c);
            if (best.intersectionRatio <= 0.5) return;
            const mid = best.target.getAttribute('data-message-id');
            if (!mid) return;
            const msg = chatMessages.find(m => m.id === mid);
            if (!msg?.character || msg.character.id === AMBIENT_NARRATOR_ID) return;
            let avatar: Character | null = msg.character;
            if (msg.character.id === currentCharacter?.id) {
                const ci = chatMessages.indexOf(msg);
                const prev = ci > 0 ? chatMessages[ci - 1] : null;
                avatar = prev?.character && prev.character.id !== currentCharacter?.id && prev.character.id !== AMBIENT_NARRATOR_ID ? prev.character : null;
            }
            setCenterAvatar(avatar);
            for (const el of document.querySelectorAll('.message-row')) el.classList.remove('is-active');
            (best.target as HTMLElement).classList.add('is-active');
            lastViewedMessageIdRef.current = mid;
        }, opts);
        for (const el of chatHistoryElement.querySelectorAll('[data-message-id]')) obs.observe(el);
        let fallbackTimer: number | undefined;
        if (!centerAvatar) {
            fallbackTimer = window.setTimeout(() => {
                for (let i = chatMessages.length - 1; i >= 0; i--) {
                    const m = chatMessages[i];
                    if (m.character && m.character.id !== currentCharacter?.id && m.character.id !== AMBIENT_NARRATOR_ID) {
                        setCenterAvatar(m.character);
                        break;
                    }
                }
            }, 0);
        }
        return () => { obs.disconnect(); if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer); };
    }, [viewMode, currentCharacter?.id, centerAvatar, interactionData, chatMessages, chatHistoryRef]);

    // Reset scroll on view mode change
    useEffect(() => {
        const chatHistoryElement = chatHistoryRef.current;
        if (viewMode !== 'cinematic' || !chatHistoryElement || suppressAutoScrollRef.current) return;
        chatHistoryElement.scrollTop = 0;
    }, [viewMode, chatHistoryRef]);

    return {
        centerAvatar, setCenterAvatar,
        lastViewedMessageIdRef,
        suppressAutoScrollRef,
        InteractionMessages: chatMessages,
        portraitUrlCache,
        streamingPortraitUrl,
        locationBackgroundUrl,
    };
}