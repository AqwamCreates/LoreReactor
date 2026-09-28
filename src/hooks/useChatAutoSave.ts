// src/hooks/useChatAutoSave.ts
import { useRef, useEffect } from 'react';
import type { InteractionData, ChatMessage, RawInteractionData, Character } from '../types';
import { saveRawInteractionData } from '../storages/serverStorage';

function hasMessagesChanged(prev: InteractionData | null, curr: InteractionData): boolean {
    if (!prev || !prev.interactionHistory || !curr.interactionHistory) return true;
    if (prev.interactionHistory.length !== curr.interactionHistory.length) return true;
    for (let i = 0; i < prev.interactionHistory.length; i++) {
        const p = prev.interactionHistory[i];
        const c = curr.interactionHistory[i];
        if (p.id !== c.id) return true;
        if (p.character.id !== c.character.id) return true;
        if ('textContent' in p && 'textContent' in c) {
            if ((p as ChatMessage).textContent !== (c as ChatMessage).textContent) return true;
        }
    }
    return false;
}

interface UseChatAutoSaveOptions {
    interactionData: InteractionData | null;
    rawChatShells: RawInteractionData[];
    refreshChatList: () => void;
}

export function useChatAutoSave(options: UseChatAutoSaveOptions) {
    const { interactionData, rawChatShells, refreshChatList } = options;
    const chatModifiedRef = useRef(false);
    const prevMsgCountRef = useRef(0);
    const prevDataRef = useRef<InteractionData | null>(null);

    useEffect(() => {
        chatModifiedRef.current = false;
        prevMsgCountRef.current = interactionData?.interactionHistory?.length ?? 0;
    }, [interactionData?.interactionHistory?.length]);

    useEffect(() => {
        if (!interactionData || !interactionData.id) return;
        const historyLength = interactionData.interactionHistory?.length ?? 0;
        const protagonistIds = new Set(interactionData.protagonists?.map((p: Character) => p.id) ?? []);
        const nonProtagonistParticipants = interactionData.participants.filter((p: Character) => !protagonistIds.has(p.id));
        const hasContent = nonProtagonistParticipants.length > 0 || historyLength > 0
            || (interactionData.contexts?.length ?? 0) > 0 || (interactionData.locations?.length ?? 0) > 0
            || (interactionData.audioTracks?.length ?? 0) > 0 || !!interactionData.Profile;

        if (!chatModifiedRef.current && hasContent) chatModifiedRef.current = true;

        if (chatModifiedRef.current && historyLength !== prevMsgCountRef.current) {
            const prev = prevDataRef.current;
            const prevProtagIds = new Set(prev?.protagonists?.map((p: Character) => p.id) ?? []);
            const currProtagIds = new Set(interactionData.protagonists?.map((p: Character) => p.id) ?? []);
            const protagsChanged = prevProtagIds.size !== currProtagIds.size || [...prevProtagIds].some((id: string) => !currProtagIds.has(id));

            const hasActualChange = !prev
                || prev.interactionHistory?.length !== historyLength
                || prev.name !== interactionData.name
                || protagsChanged
                || prev.participants.length !== interactionData.participants.length
                || prev.contexts?.length !== interactionData.contexts?.length
                || prev.locations?.length !== interactionData.locations?.length
                || prev.audioTracks?.length !== interactionData.audioTracks?.length
                || hasMessagesChanged(prev, interactionData);

            if (hasActualChange) {
                prevMsgCountRef.current = historyLength;
                prevDataRef.current = interactionData;
                saveRawInteractionData(interactionData).catch((e: unknown) => console.error('Failed to save chat:', e));
                if (!rawChatShells.some((s: RawInteractionData) => s.id === interactionData.id)) refreshChatList();
            }
        }
    }, [interactionData, rawChatShells, refreshChatList]);
}