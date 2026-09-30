// src/utilities/immersionLogic.ts
import { useMemo } from 'react';
import type { ChatMessage, InteractionData } from "../types";

export interface DisplayNameCache {
    chatMessages: ChatMessage[];
    participantNameMap: Map<string, string>;
    participantAliasesMap: Map<string, string[]>;
    participantIndexMap: Map<string, number>;
    forceNameReveal: boolean;
}

function buildDisplayNameCache(interactionData: InteractionData): DisplayNameCache {
    const participants = interactionData.participants;
    const forceNameReveal = interactionData.Profile?.forceNameReveal ?? false;

    const participantNameMap = new Map<string, string>();
    const participantAliasesMap = new Map<string, string[]>();
    const participantIndexMap = new Map<string, number>();

    for (let i = 0; i < participants.length; i++) {
        participantNameMap.set(participants[i].id, participants[i].name);
        participantAliasesMap.set(participants[i].id, participants[i].aliases ?? []);
        participantIndexMap.set(participants[i].id, i);
    }

    const chatMessages = interactionData.interactionHistory.filter(
        (m): m is ChatMessage => m.messageType === 'chat'
    );

    return {
        chatMessages,
        participantNameMap,
        participantAliasesMap,
        participantIndexMap,
        forceNameReveal,
    };
}

export function useDisplayNameCache(interactionData: InteractionData | null): DisplayNameCache | null {
    return useMemo(() => {
        if (!interactionData) return null;
        return buildDisplayNameCache(interactionData);
    }, [interactionData]);
}

/**
 * Resolve the display name for a character up to a given chat message index,
 * offset by one message so that the reveal takes effect strictly AFTER the message where it occurred.
 */
export function resolveDelayedDisplayNameFromCache(
    cache: DisplayNameCache | null,
    chatMessageIndex: number,
    characterId: string
): string {
    if (!cache) return 'Unknown';

    const idx = cache.participantIndexMap.get(characterId);
    const defaultTag = idx !== undefined ? `Character ${idx + 1}` : 'Unknown';
    const realName = cache.participantNameMap.get(characterId);

    // 1. Force reveal setting
    if (cache.forceNameReveal) {
        return realName || defaultTag;
    }

    // We scan strictly UP TO `chatMessageIndex - 1` (one message behind)
    const maxIdx = Math.min(chatMessageIndex - 1, cache.chatMessages.length - 1);
    if (maxIdx < 0) return defaultTag;

    // 2. Build candidate list: [realName, ...aliases]
    const aliases = cache.participantAliasesMap.get(characterId) ?? [];
    const candidates: string[] = [];
    if (realName) candidates.push(realName);
    for (const alias of aliases) {
        if (alias && !candidates.includes(alias)) candidates.push(alias);
    }

    // 3. Scan chat history from message 0 up to maxIdx (one message behind)
    for (let i = 0; i <= maxIdx; i++) {
        const msg = cache.chatMessages[i];
        
        if (msg.knownCharacterNames?.[characterId]) {
            const knownMap = msg.knownCharacterNames[characterId];
            for (const candidate of candidates) {
                if (knownMap[candidate]) {
                    return candidate; // Replaces "Character 2" with the known name
                }
            }
        }
    }

    return defaultTag;
}

export function getDelayedDisplayName(
    interactionData: InteractionData, 
    interactionMessageIndex: number, 
    characterId: string
): string {
    const cache = buildDisplayNameCache(interactionData);
    return resolveDelayedDisplayNameFromCache(cache, interactionMessageIndex, characterId);
}