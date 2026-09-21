// src/hooks/useChatRestoration.ts
import { useState, useRef, useEffect } from 'react';
import type { Character, InteractionData, RawInteractionData, ChatMessage } from '../types';
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
}

/**
 * Finalizes any messages that were left in a partial state due to
 * a browser refresh or crash mid-generation. After a reload, there is
 * no active stream to complete them, so they must be treated as finished.
 */
function finalizeStalePartials(data: InteractionData): InteractionData {
    let changed = false;
    const history = data.interactionHistory.map(m => {
        if (m.messageType === 'chat' && (m as ChatMessage).isPartial) {
            changed = true;
            return {
                ...m,
                textContent: (m as ChatMessage).textContent.trimEnd(),
                isPartial: false,
                lastUpdatedTimestamp: Date.now(),
            } as ChatMessage;
        }
        return m;
    });

    if (!changed) return data;
    return { ...data, interactionHistory: history, lastUpdatedTimestamp: Date.now() };
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
        isMultiplayerEnabled: false,
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
    } = options;

    const [activeChatRestored, setActiveChatRestored] = useState(false);
    const restorationDoneRef = useRef(false);

    useEffect(() => {
        if (restorationDoneRef.current) return;
        if (charsLoading || chatsLoading || contextsLoading || locationsLoading || profilesLoading) return;
        restorationDoneRef.current = true;

        const savedChatId = localStorage.getItem(STORAGE_KEY_ACTIVE_CHAT);
        const savedModelId = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL);

        if (savedModelId) {
            setTimeout(() => setSelectedModelId(savedModelId), 0);
        }

        const activateChat = async (chat: InteractionData) => {
            let fullChat = chat;

            // Reload full message history if the shell has messages but empty history
            if (!fullChat.interactionHistory.length && (fullChat.numberOfMessages ?? 0) > 0) {
                try {
                    const reloaded = await loadRawInteractionData(fullChat.id, allCharacters);
                    if (reloaded) fullChat = reloaded;
                } catch (e) {
                    console.warn('Failed to reload chat messages:', e);
                }
            }

            // Finalize any stale partial messages left from a mid-generation refresh
            fullChat = finalizeStalePartials(fullChat);

            // Hydrate all protagonists with full character data
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

            // Hydrate all participants with full character data
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

            // Set current character to the first protagonist, or first participant, or null
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
                if (!savedChatId) {
                    if (rawChatShells.length > 0) {
                        const firstChatId = rawChatShells[0].id;
                        if (firstChatId) {
                            const loaded = await loadRawInteractionData(firstChatId, allCharacters);
                            if (loaded) { await activateChat(loaded); return; }
                        }
                    }
                    if (allCharacters.length > 0) {
                        startNewChat(allCharacters[0]);
                    } else {
                        setCurrentCharacter(null);
                        setInteractionData(createEmptyChat());
                    }
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
                            if (loaded) { await activateChat(loaded); return; }
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
                        if (loaded) { await activateChat(loaded); return; }
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
    }, [charsLoading, chatsLoading, contextsLoading, locationsLoading, profilesLoading, allCharacters, rawChatShells, loadFullCharacter, setInteractionData, setCurrentCharacter, setSelectedModelId, startNewChat]);

    return { activeChatRestored };
}