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
    /** Only observe these message IDs (from virtualization) */
    renderedMessageIds?: Set<string>;
}

function resolvePortrait(characterId: string, images: Record<string, string> | undefined, expression?: string): string | null {
    const expr = expression || 'neutral';
    const filename = images?.[expr] || images?.neutral;
    if (!filename) return null;
    return getCharacterImageUrl(characterId, filename);
}

/**
 * Resolve the background image URL for the current location.
 * Priority:
 * 1. If backgroundImageRegularExpressionActivationTriggers has a match against
 *    the last user/protagonist message, use that specific image index.
 * 2. If backgroundImageWeights has entries, sample by weight.
 * 3. Fall back to images[0].
 */
function resolveLocationBackgroundUrl(interactionData: InteractionData): string | null {
    const locations = interactionData.locations;
    if (!locations || locations.length === 0) return null;

    // Find current location from last message with locationIndex
    let currentLocIndex: number | undefined;
    const history = interactionData.interactionHistory;
    for (let i = history.length - 1; i >= 0; i--) {
        const locationIndex = history[i].locationIndex
        if (locationIndex !== undefined && locationIndex >= 0) {
            currentLocIndex = history[i].locationIndex;
            break;
        }
    }
    if (currentLocIndex === undefined) return null;

    const loc = locations[currentLocIndex];
    if (!loc?.images || loc.images.length === 0) return null;

    // Find last protagonist/user message text
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

    // 1. Check regex triggers against last user message
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
            } catch {
                // Invalid regex — skip
            }
        }
    }

    // 2. Sample by weight
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
                if (randomValue <= 0) {
                    return getLocationImageUrl(loc.images[entry.index]);
                }
            }
            return getLocationImageUrl(loc.images[pool[pool.length - 1].index]);
        }
    }

    // 3. Fallback to first image
    if (loc.images[0]) {
        return getLocationImageUrl(loc.images[0]);
    }

    return null;
}

export function useCinematicMode(options: UseCinematicModeOptions) {
    const {
        viewMode, interactionData, currentCharacter,
        streamingCharacter, currentCharacterExpression, chatHistoryRef,
        renderedMessageIds,
    } = options;

    const [centerAvatar, setCenterAvatar] = useState<Character | null>(null);
    const lastViewedMessageIdRef = useRef<string | null>(null);
    const suppressAutoScrollRef = useRef(false);

    // Filter to only chat messages using discriminated union
    const chatMessages = useMemo(() => {
        if (!interactionData) return [];
        return interactionData.interactionHistory.filter((m): m is ChatMessage => m.messageType === 'chat');
    }, [interactionData]);

    // Portrait URL cache — memoized so it only rebuilds when chatMessages
    // or centerAvatar changes. During streaming, interactionData keeps the
    // same identity so chatMessages stays stable and this is skipped entirely.
    const portraitUrlCache = useMemo(() => {
        const cache = new Map<string, string | null>();

        for (const msg of chatMessages) {
            cache.set(msg.id, resolvePortrait(msg.character.id, msg.character.images, msg.characterExpression));
        }

        if (centerAvatar) {
            const key = `cinematic:${centerAvatar.id}`;
            cache.set(key, resolvePortrait(centerAvatar.id, centerAvatar.images, 'neutral'));
        }

        return cache;
    }, [chatMessages, centerAvatar]);

    const streamingPortraitUrl = useMemo(() => {
        if (!streamingCharacter) return null;
        const expr = currentCharacterExpression || 'neutral';
        const filename = streamingCharacter.images?.[expr] || streamingCharacter.images?.neutral;
        if (!filename) return null;
        return getCharacterImageUrl(streamingCharacter.id, filename);
    }, [streamingCharacter, currentCharacterExpression]);

    const locationBackgroundUrl = interactionData ? resolveLocationBackgroundUrl(interactionData) : null;

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

        const elements = chatHistoryElement.querySelectorAll('[data-message-id]');
        for (const el of elements) {
            const id = el.getAttribute('data-message-id');
            if (!renderedMessageIds || (id && renderedMessageIds.has(id))) {
                obs.observe(el);
            }
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