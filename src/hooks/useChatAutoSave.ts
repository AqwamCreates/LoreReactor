// src/hooks/useChatAutoSave.ts
import { useRef, useEffect } from 'react';
import type { InteractionData, ChatMessage, RawInteractionData, WhisperMessage } from '../types';
import { saveRawInteractionData } from '../storages/serverStorage';
import { isChatSaveable } from '../utilities/chatSaveHelper';

function haveEntitiesChanged<T extends { id: string; lastUpdatedTimestamp?: number }>(
    prev: T[] | undefined, 
    curr: T[] | undefined
): boolean {
    if (!prev && !curr) return false;
    if (!prev || !curr) return true;
    if (prev.length !== curr.length) return true;
    
    const prevMap = new Map(prev.map(e => [e.id, e.lastUpdatedTimestamp]));
    for (const e of curr) {
        if (!prevMap.has(e.id)) return true;
        if (e.lastUpdatedTimestamp !== undefined && prevMap.get(e.id) !== e.lastUpdatedTimestamp) {
            return true;
        }
    }
    
    return false;
}

function haveMessagesChanged(prev: InteractionData | null, curr: InteractionData): boolean {
    if (!prev || !prev.interactionHistory || !curr.interactionHistory) return true;
    if (prev.interactionHistory.length !== curr.interactionHistory.length) return true;
    
    for (let i = 0; i < prev.interactionHistory.length; i++) {
        const p = prev.interactionHistory[i];
        const c = curr.interactionHistory[i];
        
        if (p.id !== c.id) return true;
        if (p.character.id !== c.character.id) return true;
        if (p.lastUpdatedTimestamp !== c.lastUpdatedTimestamp) return true;
        if (p.locationIndex !== c.locationIndex) return true;

        if ('textContent' in p && 'textContent' in c) {
            if ((p as ChatMessage | WhisperMessage).textContent !== (c as ChatMessage | WhisperMessage).textContent) {
                return true;
            }
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
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isFirstRun = useRef(true);

    useEffect(() => {
        if (!interactionData || !interactionData.id) return;
        if (!isChatSaveable(interactionData)) return;

        // Hydration: sync the reference without saving
        if (isFirstRun.current) {
            isFirstRun.current = false;
            prevDataRef.current = interactionData;
            return;
        }

        const prev = prevDataRef.current;

        // Switched to a different chat: update baseline without rewriting loaded data
        if (prev && prev.id !== interactionData.id) {
            prevDataRef.current = interactionData;
            return;
        }

        const hasActualChange = !prev
            || prev.name !== interactionData.name
            || prev.Profile?.id !== interactionData.Profile?.id
            || prev.Profile?.lastUpdatedTimestamp !== interactionData.Profile?.lastUpdatedTimestamp
            || haveEntitiesChanged(prev.protagonists, interactionData.protagonists)
            || haveEntitiesChanged(prev.participants, interactionData.participants)
            || haveEntitiesChanged(prev.contexts, interactionData.contexts)
            || haveEntitiesChanged(prev.locations, interactionData.locations)
            || haveEntitiesChanged(prev.audioTracks, interactionData.audioTracks)
            || haveMessagesChanged(prev, interactionData);

        if (hasActualChange) {
            prevDataRef.current = interactionData;

            // Debounce save to prevent disk flooding during rapid edits
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }

            const currentDataToSave = interactionData;
            saveTimerRef.current = setTimeout(() => {
                saveRawInteractionData(currentDataToSave).catch((e: unknown) => {
                    console.error('[useChatAutoSave] Failed to save chat:', e);
                });

                if (!rawChatShells.some((s: RawInteractionData) => s.id === currentDataToSave.id)) {
                    refreshChatList();
                }
            }, 600);
        }

        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
        };
    }, [interactionData, rawChatShells, refreshChatList]);
}