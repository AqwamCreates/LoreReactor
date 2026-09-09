// src/hooks/useEntitySync.tsx
import { useEffect, useRef } from 'react';
import type { Character, Context, Profile, InteractionData } from '../types';
import { useSessionStore } from '../store/useSessionStore';

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
    // Track known participant IDs to prevent accidental drops during stale character list states
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

        let changed = false;
        const updated = { ...currentChat };

        // Sync protagonist — never remove, only update if fresher version exists
        const freshProtag = allCharacters.find(c => c.id === currentChat.protagonist?.id);
        if (freshProtag && freshProtag.lastUpdatedTimestamp !== currentChat.protagonist?.lastUpdatedTimestamp) {
            updated.protagonist = freshProtag; changed = true;
        }
        // If protagonist not found in allCharacters, KEEP the existing one (don't replace/drop)

        // Sync participants — NEVER filter out participants that aren't in allCharacters.
        // Only update participants that have a fresher version available.
        const freshParticipants = currentChat.participants.map(p => {
            const fresh = allCharacters.find(c => c.id === p.id);
            if (fresh && fresh.lastUpdatedTimestamp !== p.lastUpdatedTimestamp) return fresh;
            return p; // Keep existing even if not in allCharacters (may be temporarily missing)
        });

        // Track any new participants added externally
        for (const p of freshParticipants) knownParticipantIdsRef.current.add(p.id);

        if (freshParticipants.some((p, i) => p !== currentChat.participants[i])) {
            updated.participants = freshParticipants; changed = true;
        }

        // Sync contexts — same defensive approach: update but never drop
        if (currentChat.contexts?.length) {
            const freshContexts = currentChat.contexts.map(ctx => {
                const fresh = allContexts.find(c => c.id === ctx.id);
                if (fresh && fresh.lastUpdatedTimestamp !== ctx.lastUpdatedTimestamp) return fresh;
                return ctx;
            });
            if (freshContexts.some((c, i) => c !== currentChat.contexts?.[i])) {
                updated.contexts = freshContexts; changed = true;
            }
        }

        // Sync profile
        if (currentChat.Profile) {
            const freshProfile = allProfiles.find(p => p.id === currentChat.Profile?.id);
            if (freshProfile && freshProfile.lastUpdatedTimestamp !== currentChat.Profile.lastUpdatedTimestamp) {
                updated.Profile = freshProfile; changed = true;
            }
        }

        // Sync current character
        if (currentCharacter) {
            const freshCurrent = allCharacters.find(c => c.id === currentCharacter.id);
            if (freshCurrent && freshCurrent.lastUpdatedTimestamp !== currentCharacter.lastUpdatedTimestamp) {
                setCurrentCharacter(freshCurrent);
            }
        }

        if (changed) setInteractionData(updated);
    }, [activeChatRestored, allCharacters, allContexts, allProfiles, currentCharacter, setInteractionData, setCurrentCharacter]);
}