// src/hooks/immersionLogic.ts
import { useMemo } from 'react';
import type { ChatMessage, InteractionData } from "../types";

export interface DisplayNameCache {
    chatMessages: ChatMessage[];
    chatToFullIndex: Map<ChatMessage, number>;
    revealThreshold: Map<string, number>;
    participantNameMap: Map<string, string>;
    participantIndexMap: Map<string, number>;
    forceNameReveal: boolean;
}

function buildDisplayNameCache(interactionData: InteractionData): DisplayNameCache {
    const participants = interactionData.participants;
    const forceNameReveal = interactionData.Profile?.forceNameReveal ?? false;

    const participantNameMap = new Map<string, string>();
    const participantIndexMap = new Map<string, number>();
    for (let i = 0; i < participants.length; i++) {
        participantNameMap.set(participants[i].id, participants[i].name);
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

    const revealThreshold = new Map<string, number>();
    for (let i = 0; i < interactionData.interactionHistory.length; i++) {
        const msg = interactionData.interactionHistory[i];
        if (msg.isNameRevealed && !revealThreshold.has(msg.character.id)) {
            revealThreshold.set(msg.character.id, i);
        }
    }

    return {
        chatMessages,
        chatToFullIndex,
        revealThreshold,
        participantNameMap,
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

export function resolveDelayedDisplayNameFromCache(
    cache: DisplayNameCache | null,
    chatMessageIndex: number,
    characterId: string
): string {
    if (!cache) return 'Unknown';

    if (cache.forceNameReveal) {
        return cache.participantNameMap.get(characterId) ?? 'Unknown';
    }

    if (chatMessageIndex < 0 || chatMessageIndex >= cache.chatMessages.length) {
        const idx = cache.participantIndexMap.get(characterId);
        return idx !== undefined ? `Character ${idx + 1}` : 'Unknown';
    }

    const targetMessage = cache.chatMessages[chatMessageIndex];
    const fullIndex = cache.chatToFullIndex.get(targetMessage);

    if (fullIndex === undefined) {
        const idx = cache.participantIndexMap.get(characterId);
        return idx !== undefined ? `Character ${idx + 1}` : 'Unknown';
    }

    const threshold = cache.revealThreshold.get(characterId);
    if (threshold !== undefined && threshold < fullIndex) {
        return cache.participantNameMap.get(characterId) ?? 'Unknown';
    }

    const idx = cache.participantIndexMap.get(characterId);
    return idx !== undefined ? `Character ${idx + 1}` : 'Unknown';
}

export function getDelayedDisplayName(interactionData: InteractionData, interactionMessageIndex: number, characterId: string): string {
    const cache = buildDisplayNameCache(interactionData);
    return resolveDelayedDisplayNameFromCache(cache, interactionMessageIndex, characterId);
}