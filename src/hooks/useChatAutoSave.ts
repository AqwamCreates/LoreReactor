// src/hooks/useChatAutoSave.ts
import { useRef, useEffect } from 'react';
import type { InteractionData, ChatMessage, RawInteractionData } from '../types';
import { saveRawInteractionData } from '../storages/serverStorage';
import { isChatSaveable } from '../utilities/chatSaveHelper';

/**
 * Robustly checks if an array of entities has changed.
 * Catches additions, removals, and replacements (same length, different IDs).
 */
function haveEntitiesChanged<T extends { id: string }>(prev: T[] | undefined, curr: T[] | undefined): boolean {
    if (!prev && !curr) return false;
    if (!prev || !curr) return true;
    if (prev.length !== curr.length) return true;
    
    const prevIds = new Set(prev.map(e => e.id));
    const currIds = new Set(curr.map(e => e.id));
    
    if (prevIds.size !== currIds.size) return true;
    for (const id of currIds) {
        if (!prevIds.has(id)) return true;
    }
    
    return false;
}

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
    const prevDataRef = useRef<InteractionData | null>(null);

    useEffect(() => {
        if (!interactionData || !interactionData.id) return;

        // STRICT RULE: Abort if the chat is pristine/empty.
        // Merely having a protagonist or default profile does NOT count as content.
        if (!isChatSaveable(interactionData)) return;

        const prev = prevDataRef.current;

        // Robust change detection that catches replacements, not just length changes
        const hasActualChange = !prev
            || prev.name !== interactionData.name
            || prev.Profile?.id !== interactionData.Profile?.id
            || haveEntitiesChanged(prev.protagonists, interactionData.protagonists)
            || haveEntitiesChanged(prev.participants, interactionData.participants)
            || haveEntitiesChanged(prev.contexts, interactionData.contexts)
            || haveEntitiesChanged(prev.locations, interactionData.locations)
            || haveEntitiesChanged(prev.audioTracks, interactionData.audioTracks)
            || hasMessagesChanged(prev, interactionData);

        if (hasActualChange) {
            // Update the ref ONLY after a successful change detection
            prevDataRef.current = interactionData;
            
            saveRawInteractionData(interactionData).catch((e: unknown) => console.error('Failed to save chat:', e));
            
            if (!rawChatShells.some((s: RawInteractionData) => s.id === interactionData.id)) {
                refreshChatList();
            }
        }
    }, [interactionData, rawChatShells, refreshChatList]);
}