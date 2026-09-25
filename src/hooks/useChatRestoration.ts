// src/hooks/useChatRestoration.ts
import { useState, useRef, useEffect } from 'react';
import type { Character, InteractionData, RawInteractionData } from '../types';
import { loadRawInteractionData } from '../storage/serverStorage';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY_ACTIVE_CHAT = 'loreReactor_activeChatId';
const STORAGE_KEY_SELECTED_MODEL = 'loreReactor_selectedModelId';

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
    setCurrentCharacter: (char: Character | null) => void;
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
        setInteractionData, setCurrentCharacter, setSelectedModelId, startNewChat,
        skipRestoration = false,
    } = options;

    const [activeChatRestored, setActiveChatRestored] = useState(false);
    const restorationDoneRef = useRef(false);

    useEffect(() => {
        if (restorationDoneRef.current) return;
        if (charsLoading || chatsLoading || contextsLoading || locationsLoading || profilesLoading) return;
        restorationDoneRef.current = true;

        const savedModelId = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL);

        if (savedModelId) {
            setTimeout(() => setSelectedModelId(savedModelId), 0);
        }

        const activateChat = async (chat: InteractionData) => {
            let fullChat = chat;

            if (!fullChat.interactionHistory.length && (fullChat.numberOfMessages ?? 0) > 0) {
                try {
                    const reloaded = await loadRawInteractionData(fullChat.id, allCharacters);
                    if (reloaded) fullChat = reloaded;
                } catch (e) {
                    console.warn('Failed to reload chat messages:', e);
                }
            }

            const hydratedProtagonists = await Promise.all(
                fullChat.protagonists.map(async (p) => {
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
                fullChat.participants.map(async (p) => {
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

            const hydratedChat = {
                ...fullChat,
                protagonists: hydratedProtagonists,
                participants: hydratedParticipants,
            };

            setInteractionData(hydratedChat);

            if (hydratedProtagonists.length > 0) {
                setCurrentCharacter(hydratedProtagonists[0]);
            } else if (hydratedParticipants.length > 0) {
                setCurrentCharacter(hydratedParticipants[0]);
            } else {
                setCurrentCharacter(null);
            }
        };

        const restore = async () => {
            try {
                // If skipRestoration is true (joiner with persisted join state),
                // create an empty chat and wait for the host to send initial state
                if (skipRestoration) {
                    console.log('[Restoration] Skipping active chat restoration (joiner mode)');
                    setInteractionData(createEmptyChat());
                    setActiveChatRestored(true);
                    return;
                }

                const savedChatId = localStorage.getItem(STORAGE_KEY_ACTIVE_CHAT);

                if (!savedChatId) {
                    if (rawChatShells.length > 0) {
                        const firstChatId = rawChatShells[0].id;
                        if (firstChatId) {
                            const loaded = await loadRawInteractionData(firstChatId, allCharacters);
                            if (loaded) { await activateChat(loaded); setActiveChatRestored(true); return; }
                        }
                    }
                    if (allCharacters.length > 0) {
                        startNewChat(allCharacters[0]);
                    } else {
                        setCurrentCharacter(null);
                        setInteractionData(createEmptyChat());
                    }
                    setActiveChatRestored(true);
                    return;
                }

                const interactionDataResult = await loadRawInteractionData(savedChatId, allCharacters);
                if (interactionDataResult) {
                    await activateChat(interactionDataResult);
                } else {
                    console.warn('Active chat not found, falling back.');
                    localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
                    if (rawChatShells.length > 0) {
                        const firstChatId = rawChatShells[0].id;
                        if (firstChatId) {
                            const loaded = await loadRawInteractionData(firstChatId, allCharacters);
                            if (loaded) { await activateChat(loaded); setActiveChatRestored(true); return; }
                        }
                    }
                    if (allCharacters.length > 0) { startNewChat(allCharacters[0]); }
                    else {
                        setCurrentCharacter(null);
                        setInteractionData(createEmptyChat());
                    }
                }
            } catch (e) {
                console.error('Failed to restore active chat:', e);
                localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
                if (rawChatShells.length > 0) {
                    const firstChatId = rawChatShells[0].id;
                    if (firstChatId) {
                        const loaded = await loadRawInteractionData(firstChatId, allCharacters);
                        if (loaded) { await activateChat(loaded); setActiveChatRestored(true); return; }
                    }
                }
                if (allCharacters.length > 0) { startNewChat(allCharacters[0]); }
                else {
                    setCurrentCharacter(null);
                    setInteractionData(createEmptyChat());
                }
            } finally {
                setActiveChatRestored(true);
            }
        };

        restore();
    }, [charsLoading, chatsLoading, contextsLoading, locationsLoading, profilesLoading, allCharacters, rawChatShells, loadFullCharacter, setInteractionData, setCurrentCharacter, setSelectedModelId, startNewChat, skipRestoration]);

    return { activeChatRestored };
}