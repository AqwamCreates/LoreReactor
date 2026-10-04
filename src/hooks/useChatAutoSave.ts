// src/hooks/useChatAutoSave.ts
import { useRef, useEffect } from 'react';
import type { InteractionData, ChatMessage, RawInteractionData, WhisperMessage } from '../types';
import { saveRawInteractionData } from '../storages/serverStorage';
import { isChatSaveable } from '../utilities/chatSaveHelper';

// ✅ Helper to deeply clone state, protecting the baseline from in-place mutations
function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
}

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
    if (!prev || !prev.interactionHistories || !curr.interactionHistories) return true;

    const prevHistories = prev.interactionHistories;
    const currHistories = curr.interactionHistories;

    const prevLocIds = Object.keys(prevHistories);
    const currLocIds = Object.keys(currHistories);

    if (prevLocIds.length !== currLocIds.length) return true;
    for (const id of prevLocIds) {
        if (!Object.prototype.hasOwnProperty.call(currHistories, id)) return true;
    }

    for (const locId of currLocIds) {
        const prevMsgs = prevHistories[locId] || [];
        const currMsgs = currHistories[locId] || [];

        if (prevMsgs.length !== currMsgs.length) return true;

        for (let i = 0; i < prevMsgs.length; i++) {
            const p = prevMsgs[i];
            const c = currMsgs[i];

            if (p.id !== c.id) return true;
            if (p.character.id !== c.character.id) return true;
            if (p.lastUpdatedTimestamp !== c.lastUpdatedTimestamp) return true;

            if ('textContent' in p && 'textContent' in c) {
                if ((p as ChatMessage | WhisperMessage).textContent !== (c as ChatMessage | WhisperMessage).textContent) {
                    return true;
                }
            }
        }
    }
    return false;
}

interface UseChatAutoSaveOptions {
    interactionData: InteractionData | null;
    rawChatShells: RawInteractionData[];
    refreshChatList: () => Promise<unknown>;
}

export function useChatAutoSave(options: UseChatAutoSaveOptions) {
    const { interactionData, refreshChatList } = options;
    const prevDataRef = useRef<InteractionData | null>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isFirstRun = useRef(true);

    useEffect(() => {
        if (!interactionData || !interactionData.id) return;

        // Count total actual messages across all spatial location arrays
        const totalMessages = Object.values(interactionData.interactionHistories || {}).reduce(
            (acc, curr) => acc + curr.length, 
            0
        );

        // Always ensure numberOfMessages matches the real spatial message count
        const syncedData: InteractionData = {
            ...interactionData,
            numberOfMessages: totalMessages,
        };

        // Strictly gate via isChatSaveable: do not save if empty/unsaveable
        if (!isChatSaveable(syncedData)) return;

        // On initial hydration, set baseline
        if (isFirstRun.current) {
            isFirstRun.current = false;
            // ✅ Deep clone the initial baseline
            prevDataRef.current = deepClone(syncedData);
            return;
        }

        const prev = prevDataRef.current;

        // If user switched to an entirely different chat, reset baseline without auto-saving
        if (prev && prev.id !== syncedData.id) {
            // ✅ Deep clone the new baseline
            prevDataRef.current = deepClone(syncedData);
            return;
        }

        // 🛡️ SAFEGUARD: If we had messages and now have 0, DO NOT auto-save. 
        const prevMessageCount = prev ? Object.values(prev.interactionHistories || {}).reduce((acc, curr) => acc + curr.length, 0) : 0;
        const currMessageCount = totalMessages;

        if (prevMessageCount > 0 && currMessageCount === 0) {
            console.warn('[useChatAutoSave] Blocked save: Message count dropped to 0. Possible load failure.');
            return; 
        }

        const hasActualChange = !prev
            || prev.name !== syncedData.name
            || prev.profile?.id !== syncedData.profile?.id
            || prev.profile?.lastUpdatedTimestamp !== syncedData.profile?.lastUpdatedTimestamp
            || haveEntitiesChanged(prev.protagonists, syncedData.protagonists)
            || haveEntitiesChanged(prev.participants, syncedData.participants)
            || haveEntitiesChanged(prev.contexts, syncedData.contexts)
            || haveEntitiesChanged(prev.locations, syncedData.locations)
            || haveEntitiesChanged(prev.audioTracks, syncedData.audioTracks)
            || haveMessagesChanged(prev, syncedData);

        if (hasActualChange) {
            // ✅ CRITICAL FIX: Deep clone the state before storing it in the ref.
            // This ensures that if the original object is mutated later by another part of the app, 
            // our 'prev' reference remains untouched and will correctly detect the change.
            prevDataRef.current = deepClone(syncedData);

            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }

            const currentDataToSave = syncedData;
            saveTimerRef.current = setTimeout(async () => {
                try {
                    await saveRawInteractionData(currentDataToSave);
                    // Refresh chat list so modal shell always shows the updated message count & timestamps
                    await refreshChatList();
                } catch (e: unknown) {
                    console.error('[useChatAutoSave] Failed to save chat:', e);
                } finally {
                    saveTimerRef.current = null;
                }
            }, 600);
        }

        // 🛡️ CRITICAL FIX: DO NOT clear the timeout in the useEffect cleanup!
        // The cleanup runs on EVERY dependency change (i.e., every time interactionData updates).
        // If another state update happens within 600ms (e.g., from runSummarization, useEntitySync, 
        // or streaming state settling), the cleanup cancels the pending save.
        // Since prevDataRef was already updated, the next run sees hasActualChange=false and 
        // schedules no new timeout, permanently losing the AI message save.
        // We intentionally leave the timeout running across re-renders.
    }, [interactionData, refreshChatList]);

    // Separate effect to clear timeout ONLY on component unmount
    useEffect(() => {
        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
        };
    }, []);
}