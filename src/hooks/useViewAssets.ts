// src/hooks/useViewAssets.ts
import { useState, useRef, useEffect, useMemo } from 'react';
import type { Character, InteractionData, ChatMessage } from '../types';
import { getCharacterImageUrl, getLocationImageUrl } from '../storage/serverStorage';

const AMBIENT_NARRATOR_ID = '__ambient_narrator__';

interface UseViewAssetsOptions {
    viewMode: 'ladder' | 'cinematic' | 'vn';
    interactionData: InteractionData | null;
    currentCharacter: Character | null;
    streamingCharacter: Character | null;
    currentCharacterExpression: string;
    chatHistoryRef: React.RefObject<HTMLDivElement | null>;
    renderedMessageIds?: Set<string>;
}

function resolvePortrait(characterId: string, images: Record<string, string> | undefined, expression?: string): string | null {
    const expr = expression || 'neutral';
    const filename = images?.[expr] || images?.neutral;
    if (!filename) return null;
    return getCharacterImageUrl(characterId, filename);
}

function resolveLocationBackgroundUrl(interactionData: InteractionData): string | null {
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
    const protagonistId = interactionData.protagonist?.id;
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
                        return getLocationImageUrl(loc.images[idx]);
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
                if (randomValue <= 0) return getLocationImageUrl(loc.images[entry.index]);
            }
            return getLocationImageUrl(loc.images[pool[pool.length - 1].index]);
        }
    }
    if (loc.images[0]) return getLocationImageUrl(loc.images[0]);
    return null;
}

export function useViewAssets(options: UseViewAssetsOptions) {
    const {
        viewMode, interactionData, currentCharacter,
        streamingCharacter, currentCharacterExpression, chatHistoryRef,
        renderedMessageIds,
    } = options;

    const [centerAvatar, setCenterAvatar] = useState<Character | null>(null);
    const lastViewedMessageIdRef = useRef<string | null>(null);
    const suppressAutoScrollRef = useRef(false);

    const chatMessages = useMemo(() => {
        if (!interactionData) return [];
        return interactionData.interactionHistory.filter((m): m is ChatMessage => m.messageType === 'chat');
    }, [interactionData]);

    // Single unified portrait cache: one key per character ID
    const portraitUrlCache = useMemo(() => {
        const cache = new Map<string, string | null>();

        // All participants — always present
        if (interactionData) {
            for (const participant of interactionData.participants) {
                const url = resolvePortrait(participant.id, participant.images, 'neutral');
                cache.set(`character:${participant.id}`, url);
            }
        }

        // History messages — update with expression-specific portraits
        for (const msg of chatMessages) {
            const url = resolvePortrait(msg.character.id, msg.character.images, msg.characterExpression);
            cache.set(`character:${msg.character.id}`, url);
            cache.set(msg.id, url);
        }

        // Center Avatar
        if (centerAvatar) {
            const url = resolvePortrait(centerAvatar.id, centerAvatar.images, 'neutral');
            cache.set(`character:${centerAvatar.id}`, url);
        }

        // Streaming Character — highest priority, live expression
        if (streamingCharacter) {
            const url = resolvePortrait(streamingCharacter.id, streamingCharacter.images, currentCharacterExpression);
            cache.set(`character:${streamingCharacter.id}`, url);
        }

        return cache;
    }, [chatMessages, centerAvatar, streamingCharacter, currentCharacterExpression, interactionData]);

    const streamingPortraitUrl = useMemo(() => {
        if (!streamingCharacter) return null;
        return portraitUrlCache.get(`character:${streamingCharacter.id}`) || null;
    }, [streamingCharacter, portraitUrlCache]);

    const locationBackgroundUrl = interactionData ? resolveLocationBackgroundUrl(interactionData) : null;

    // Center avatar selection — only active in cinematic mode
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
        const elements = chatHistoryElement.querySelectorAll('[data-message-id]');
        for (const el of elements) {
            const id = el.getAttribute('data-message-id');
            if (!renderedMessageIds || (id && renderedMessageIds.has(id))) obs.observe(el);
        }
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
    }, [viewMode, currentCharacter?.id, centerAvatar, interactionData, chatMessages, chatHistoryRef, renderedMessageIds]);

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