// frontend_src/utilities/immersionLogic.ts
import { useMemo } from 'react';
import type { Character, ChatMessage, InteractionData } from "../types";
import { getLocalMessageHistory } from './timelineLogic';

export interface DisplayNameCache {
    chatMessages: ChatMessage[];
    participantNameMap: Map<string, string>;
    participantAliasesMap: Map<string, string[]>;
    participantIndexMap: Map<string, number>;
    forceNameReveal: boolean;
}

function buildDisplayNameCache(interactionData: InteractionData, protagonistId?: string | null): DisplayNameCache {
    const participants = interactionData.participants;
    const forceNameReveal = interactionData.profile?.forceNameReveal ?? false;

    const participantNameMap = new Map<string, string>();
    const participantAliasesMap = new Map<string, string[]>();
    const participantIndexMap = new Map<string, number>();

    for (let i = 0; i < participants.length; i++) {
        participantNameMap.set(participants[i].id, participants[i].name);
        participantAliasesMap.set(participants[i].id, participants[i].aliases ?? []);
        participantIndexMap.set(participants[i].id, i);
    }

    // ✅ FIX: Use the protagonistId to trace the exact chronological thread.
    // This prevents picking up names from alternate branches or locations the protagonist hasn't visited.
    const activeProtagonistId = protagonistId ?? interactionData.protagonistIds?.[0];
    
    // getLocalMessageHistory only requires the `.id` property, so we pass a lightweight stub
    const activeProtagonistStub = activeProtagonistId ? { id: activeProtagonistId } as Character : null;
    
    const chatMessages = activeProtagonistStub 
        ? getLocalMessageHistory(interactionData, activeProtagonistStub, ['chat']) as ChatMessage[]
        : [];

    return {
        chatMessages,
        participantNameMap,
        participantAliasesMap,
        participantIndexMap,
        forceNameReveal,
    };
}

export function useDisplayNameCache(interactionData: InteractionData | null, protagonistId?: string | null): DisplayNameCache | null {
    return useMemo(() => {
        if (!interactionData) return null;
        return buildDisplayNameCache(interactionData, protagonistId);
    }, [interactionData, protagonistId]);
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
    character: Character,
    messageIndex: number,
    protagonistId?: string | null
): string {
    const cache = buildDisplayNameCache(interactionData, protagonistId);
    return resolveDelayedDisplayNameFromCache(cache, messageIndex, character.id);
}