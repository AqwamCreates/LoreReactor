// src/hooks/immersionLogic.ts
import { useMemo } from 'react';
import type { ChatMessage, InteractionData } from "../types";

export interface DisplayNameCache {
    chatMessages: ChatMessage[];
    chatToFullIndex: Map<ChatMessage, number>;
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

    const chatToFullIndex = new Map<ChatMessage, number>();
    for (let i = 0; i < interactionData.interactionHistory.length; i++) {
        if (interactionData.interactionHistory[i].messageType === 'chat') {
            chatToFullIndex.set(interactionData.interactionHistory[i] as ChatMessage, i);
        }
    }

    return {
        chatMessages,
        chatToFullIndex,
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
 * Resolve the display name for a character at a given chat message index.
 * 
 * Logic:
 * - If forceNameReveal is on, always show the real name.
 * - Check the current message's knownCharacterNames to see if the author knows this character.
 * - If yes, show the name in format "Character N (KnownName)".
 * - If no, show just "Character N".
 * 
 * Each message carries its own knownCharacterNames snapshot from when it was sent,
 * so we don't need to walk backwards through history.
 */
export function resolveDelayedDisplayNameFromCache(
    cache: DisplayNameCache | null,
    chatMessageIndex: number,
    characterId: string
): string {
    if (!cache) return 'Unknown';

    const idx = cache.participantIndexMap.get(characterId);
    const tag = idx !== undefined ? `Character ${idx + 1}` : 'Unknown';

    if (cache.forceNameReveal) {
        const name = cache.participantNameMap.get(characterId);
        return name ? `${tag} (${name})` : tag;
    }

    if (chatMessageIndex < 0 || chatMessageIndex >= cache.chatMessages.length) {
        return tag;
    }

    // Check the current message's knownCharacterNames
    const currentMsg = cache.chatMessages[chatMessageIndex];
    if (!currentMsg.knownCharacterNames) {
        return tag;
    }

    const knownMap = currentMsg.knownCharacterNames[characterId];
    if (!knownMap) {
        return tag;
    }

    // Build candidate list: [name, ...aliases]
    const name = cache.participantNameMap.get(characterId);
    const aliases = cache.participantAliasesMap.get(characterId) ?? [];
    const candidates: string[] = [];
    if (name) candidates.push(name);
    for (const alias of aliases) {
        if (alias && !candidates.includes(alias)) candidates.push(alias);
    }

    // Check candidates in priority order
    for (const candidate of candidates) {
        if (knownMap[candidate] === true) {
            return `${tag} (${candidate})`;
        }
    }

    return tag;
}

export function getDelayedDisplayName(interactionData: InteractionData, interactionMessageIndex: number, characterId: string): string {
    const cache = buildDisplayNameCache(interactionData);
    return resolveDelayedDisplayNameFromCache(cache, interactionMessageIndex, characterId);
}