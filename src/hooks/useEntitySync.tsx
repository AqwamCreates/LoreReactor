// src/hooks/useEntitySync.tsx
import { useEffect, useRef } from 'react';
import type { Character, Context, Profile, InteractionData } from '../types';

interface UseEntitySyncOptions {
    activeChatRestored: boolean;
    interactionDataRef: React.MutableRefObject<InteractionData | null>;
    allCharacters: Character[];
    allContexts: Context[];
    allProfiles: Profile[];
    currentCharacter: Character | null;
    setInteractionData: (data: InteractionData) => void;
    setCurrentCharacter: (char: Character | null) => void;
}

export function useEntitySync(options: UseEntitySyncOptions) {
    const {
        activeChatRestored, interactionDataRef,
        allCharacters, allContexts, allProfiles,
        currentCharacter, setInteractionData, setCurrentCharacter,
    } = options;

    const initialSyncSkippedRef = useRef(false);

    useEffect(() => {
        if (!activeChatRestored) return;
        if (!initialSyncSkippedRef.current) { initialSyncSkippedRef.current = true; return; }

        const currentChat = interactionDataRef.current;
        if (!currentChat) return;

        let changed = false;
        const updated = { ...currentChat };

        // Sync protagonist
        const freshProtag = allCharacters.find(c => c.id === currentChat.protagonist?.id);
        if (!freshProtag && currentChat.protagonist) {
            const fallback = allCharacters[0];
            if (fallback) { updated.protagonist = fallback; changed = true; }
        } else if (freshProtag && freshProtag.lastUpdatedTimestamp !== currentChat.protagonist?.lastUpdatedTimestamp) {
            updated.protagonist = freshProtag; changed = true;
        }

        // Sync participants
        const validParticipants = currentChat.participants.filter(p => allCharacters.some(c => c.id === p.id));
        const freshParticipants = validParticipants.map(p => {
            const fresh = allCharacters.find(c => c.id === p.id);
            return (fresh && fresh.lastUpdatedTimestamp !== p.lastUpdatedTimestamp) ? fresh : p;
        });
        if (freshParticipants.length !== currentChat.participants.length || freshParticipants.some((p, i) => p !== currentChat.participants[i])) {
            updated.participants = freshParticipants; changed = true;
        }

        // Sync contexts
        if (currentChat.contexts?.length) {
            const validContexts = currentChat.contexts.filter(ctx => allContexts.some(c => c.id === ctx.id));
            const freshContexts = validContexts.map(ctx => {
                const fresh = allContexts.find(c => c.id === ctx.id);
                return (fresh && fresh.lastUpdatedTimestamp !== ctx.lastUpdatedTimestamp) ? fresh : ctx;
            });
            if (freshContexts.length !== currentChat.contexts.length || freshContexts.some((c, i) => c !== currentChat.contexts?.[i])) {
                updated.contexts = freshContexts; changed = true;
            }
        }

        // Sync profile
        if (currentChat.Profile) {
            const freshProfile = allProfiles.find(p => p.id === currentChat.Profile?.id);
            if (!freshProfile) { updated.Profile = undefined; changed = true; }
            else if (freshProfile.lastUpdatedTimestamp !== currentChat.Profile.lastUpdatedTimestamp) { updated.Profile = freshProfile; changed = true; }
        }

        // Sync current character
        if (currentCharacter) {
            const freshCurrent = allCharacters.find(c => c.id === currentCharacter.id);
            if (!freshCurrent) setCurrentCharacter(updated.protagonist);
            else if (freshCurrent.lastUpdatedTimestamp !== currentCharacter.lastUpdatedTimestamp) setCurrentCharacter(freshCurrent);
        }

        if (changed) setInteractionData(updated);
    }, [activeChatRestored, allCharacters, allContexts, allProfiles, currentCharacter, setInteractionData, setCurrentCharacter, interactionDataRef]);
}