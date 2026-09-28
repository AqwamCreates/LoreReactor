// src/hooks/useChatRestoration.ts
import { useState, useRef, useEffect } from 'react';
import type { Character, InteractionData, RawInteractionData } from '../types';
import { loadRawInteractionData, loadRawSessionData, saveRawSessionData } from '../storages/serverStorage';
import { v4 as uuidv4 } from 'uuid';

interface UseChatRestorationOptions {
    charsLoading: boolean;
    chatsLoading: boolean;
    contextsLoading: boolean;
    locationsLoading: boolean;
    profilesLoading: boolean;
    allCharacters: Character[];
    rawChatShells: RawInteractionData[];
    loadFullCharacter: (id: string) => Promise<Character | null>;
    setInteractionData: (data: InteractionData) => void;
    setSelectedCharacter: (char: Character | null) => void;
    setSelectedModelId: (id: string | null) => void;
    startNewChat: (char: Character) => void;
    /** Skip active chat loading (e.g., when joiner has persisted join state) */
    skipRestoration?: boolean;
}

function createEmptyChat(): InteractionData {
    return {
        id: uuidv4(),
        name: 'Untitled Chat',
        protagonists: [],
        participants: [],
        contexts: [],
        locations: [],
        audioTracks: [],
        interactionHistory: [],
        numberOfMessages: 0,
        firstCreatedTimestamp: Date.now(),
        lastUpdatedTimestamp: Date.now(),
        parentInteractionDataId: null,
        parentInteractionMessageId: null,
    };
}

export function useChatRestoration(options: UseChatRestorationOptions) {
    const {
        charsLoading, chatsLoading, contextsLoading, locationsLoading, profilesLoading,
        allCharacters, rawChatShells, loadFullCharacter,
        setInteractionData, setSelectedCharacter, setSelectedModelId, startNewChat,
        skipRestoration = false,
    } = options;

    const [activeChatRestored, setActiveChatRestored] = useState(false);
    const restorationDoneRef = useRef(false);

    useEffect(() => {
        if (restorationDoneRef.current) return;
        if (charsLoading || chatsLoading || contextsLoading || locationsLoading || profilesLoading) return;
        restorationDoneRef.current = true;

        const activateChat = async (chat: InteractionData) => {
            const hydratedProtagonists = await Promise.all(
                (chat.protagonists || []).map(async (p) => {
                    const freshProtag = allCharacters.find(c => c.id === p.id);
                    if (freshProtag) {
                        const fullChar = await loadFullCharacter(freshProtag.id);
                        if (fullChar) return fullChar;
                    }
                    console.warn(`Protagonist ${p.id} not found or failed to load. Keeping shell.`);
                    return p;
                })
            );

            const hydratedParticipants = await Promise.all(
                (chat.participants || []).map(async (p) => {
                    const exists = allCharacters.some(c => c.id === p.id);
                    if (!exists) {
                        console.warn(`Participant ${p.id} not found in character list after load. Keeping shell.`);
                        return p;
                    }
                    if (p.systemPrompt) return p;
                    const fullChar = await loadFullCharacter(p.id);
                    return fullChar || p;
                })
            );

            const hydratedChat: InteractionData = {
                ...chat,
                protagonists: hydratedProtagonists,
                participants: hydratedParticipants,
            };

            setInteractionData(hydratedChat);

            if (hydratedProtagonists.length > 0) {
                setSelectedCharacter(hydratedProtagonists[0]);
            } else if (hydratedParticipants.length > 0) {
                setSelectedCharacter(hydratedParticipants[0]);
            } else {
                setSelectedCharacter(null);
            }
        };

        /** Fallback chain: first chat shell → first character → empty chat */
        const fallbackRestore = async () => {
            if (rawChatShells.length > 0) {
                const firstChatId = rawChatShells[0].id;
                if (firstChatId) {
                    const loaded = await loadRawInteractionData(firstChatId, allCharacters);
                    if (loaded) {
                        await activateChat(loaded);
                        await saveRawSessionData({ activeChatId: firstChatId });
                        return;
                    }
                }
            }
            if (allCharacters.length > 0) {
                startNewChat(allCharacters[0]);
            } else {
                setSelectedCharacter(null);
                setInteractionData(createEmptyChat());
            }
        };

        const restore = async () => {
            try {
                // Load session data from server (with browser fallback)
                const session = await loadRawSessionData();

                // If skipRestoration is true (joiner with persisted join state),
                // create an empty chat and wait for the host to send initial state
                if (skipRestoration) {
                    console.log('[Restoration] Skipping active chat restoration (joiner mode)');
                    setInteractionData(createEmptyChat());
                    return;
                }

                // Restore selected model from server session
                if (session.selectedModelId) {
                    setTimeout(() => setSelectedModelId(session.selectedModelId!), 0);
                }

                // If user explicitly initiated a new chat (activeChatId === null), start fresh
                if (session.activeChatId === null) {
                    if (allCharacters.length > 0) {
                        startNewChat(allCharacters[0]);
                    } else {
                        setSelectedCharacter(null);
                        setInteractionData(createEmptyChat());
                    }
                    return;
                }

                const savedChatId = session.activeChatId;

                if (!savedChatId) {
                    await fallbackRestore();
                    return;
                }

                const interactionDataResult = await loadRawInteractionData(savedChatId, allCharacters);
                if (interactionDataResult) {
                    await activateChat(interactionDataResult);
                } else {
                    console.warn('Active chat not found, falling back.');
                    await fallbackRestore();
                }
            } catch (e) {
                console.error('Failed to restore active chat:', e);
                await fallbackRestore();
            } finally {
                setActiveChatRestored(true);
            }
        };

        restore();
    }, [
        charsLoading, chatsLoading, contextsLoading, locationsLoading, profilesLoading, 
        allCharacters, rawChatShells, loadFullCharacter, setInteractionData, 
        setSelectedCharacter, setSelectedModelId, startNewChat, skipRestoration
    ]);

    return { activeChatRestored };
}