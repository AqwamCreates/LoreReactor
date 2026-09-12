// src/hooks/useEntitySync.tsx
import { useEffect, useRef } from 'react';
import type { Character, Context, Profile, InteractionData } from '../types';
import { useSessionStore } from './useSessionStore';

interface UseEntitySyncOptions {
    activeChatRestored: boolean;
    allCharacters: Character[];
    allContexts: Context[];
    allProfiles: Profile[];
    currentCharacter: Character | null;
    setInteractionData: (data: InteractionData) => void;
    setCurrentCharacter: (char: Character | null) => void;
}

export function useEntitySync(options: UseEntitySyncOptions) {
    const {
        activeChatRestored,
        allCharacters, allContexts, allProfiles,
        currentCharacter, setInteractionData, setCurrentCharacter,
    } = options;

    const initialSyncSkippedRef = useRef(false);
    const knownParticipantIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!activeChatRestored) return;
        if (!initialSyncSkippedRef.current) { initialSyncSkippedRef.current = true; return; }

        const currentChat = useSessionStore.getState().interactionData;
        if (!currentChat) return;

        // Seed known participants on first real sync
        if (knownParticipantIdsRef.current.size === 0 && currentChat.participants.length > 0) {
            for (const p of currentChat.participants) knownParticipantIdsRef.current.add(p.id);
        }

        // Build O(1) lookup maps instead of repeated .find() calls
        const charMap = new Map<string, Character>();
        for (const c of allCharacters) charMap.set(c.id, c);

        const contextMap = new Map<string, Context>();
        for (const c of allContexts) contextMap.set(c.id, c);

        const profileMap = new Map<string, Profile>();
        for (const p of allProfiles) profileMap.set(p.id, p);

        let changed = false;
        const updated = { ...currentChat };

        // Sync protagonist — never remove, only update if fresher version exists
        const freshProtag = charMap.get(currentChat.protagonist?.id ?? '');
        if (freshProtag && freshProtag.lastUpdatedTimestamp !== currentChat.protagonist?.lastUpdatedTimestamp) {
            updated.protagonist = freshProtag; changed = true;
        }

        // Sync participants — NEVER filter out participants that aren't in allCharacters.
        // Only update participants that have a fresher version available.
        let participantsChanged = false;
        const freshParticipants = currentChat.participants.map(p => {
            const fresh = charMap.get(p.id);
            if (fresh && fresh.lastUpdatedTimestamp !== p.lastUpdatedTimestamp) {
                participantsChanged = true;
                return fresh;
            }
            return p;
        });

        // Track any new participants added externally
        for (const p of freshParticipants) knownParticipantIdsRef.current.add(p.id);

        if (participantsChanged) {
            updated.participants = freshParticipants; changed = true;
        }

        // Sync contexts — same defensive approach: update but never drop
        if (currentChat.contexts?.length) {
            let contextsChanged = false;
            const freshContexts = currentChat.contexts.map(context => {
                const fresh = contextMap.get(context.id);
                if (fresh && fresh.lastUpdatedTimestamp !== context.lastUpdatedTimestamp) {
                    contextsChanged = true;
                    return fresh;
                }
                return context;
            });
            if (contextsChanged) {
                updated.contexts = freshContexts; changed = true;
            }
        }

        // Sync profile
        if (currentChat.Profile) {
            const freshProfile = profileMap.get(currentChat.Profile.id);
            if (freshProfile && freshProfile.lastUpdatedTimestamp !== currentChat.Profile.lastUpdatedTimestamp) {
                updated.Profile = freshProfile; changed = true;
            }
        }

        // Sync current character
        if (currentCharacter) {
            const freshCurrent = charMap.get(currentCharacter.id);
            if (freshCurrent && freshCurrent.lastUpdatedTimestamp !== currentCharacter.lastUpdatedTimestamp) {
                setCurrentCharacter(freshCurrent);
            }
        }

        if (changed) setInteractionData(updated);
    }, [activeChatRestored, allCharacters, allContexts, allProfiles, currentCharacter, setInteractionData, setCurrentCharacter]);
}