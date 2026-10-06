// frontend_src/hooks/useChatRestoration.ts
import { useState, useRef, useEffect } from 'react';
import type { Character, InteractionData, RawInteractionData, ChatMessage, WhisperMessage } from '../types';
import { loadRawInteractionData, loadRawSessionData, saveRawSessionData } from '../storages/serverStorage';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';
import { v4 as uuidv4 } from 'uuid';

interface UseChatRestorationOptions {
    charsLoading: boolean;
    chatsLoading: boolean;
    contextsLoading: boolean;
    locationsLoading: boolean;
    profilesLoading: boolean;
    allCharacters: Character[];
    rawChatShells: RawInteractionData[];
    sessionLoaded: boolean;
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
        protagonistIds: [],
        participants: [],
        contexts: [],
        locations: [],
        audioTracks: [],
        interactionHistories: {},
        firstCreatedTimestamp: Date.now(),
        lastUpdatedTimestamp: Date.now(),
        parentInteractionDataId: null,
        parentMessageId: null,
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
            // Since protagonists are now just IDs, we only need to hydrate participants.
            // The protagonist Character objects will naturally be resolved from the participants array 
            // via the protagonistIds array when needed.
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
                participants: hydratedParticipants,
            };

            setInteractionData(hydratedChat);

            // FIX: Replaced flat interactionHistory array with spatial interactionHistories Record reduction
            const allMessages = Object.values(hydratedChat.interactionHistories || {}).flat();
            
            // Prime the Speculative Markov Engine with historical messages
            if (hydratedChat.id && allMessages.length > 0) {
                const trainingMessages = allMessages
                    .filter((m): m is ChatMessage | WhisperMessage => 
                        (m.messageType === 'chat' || m.messageType === 'whisper') && !!m.character?.id && !!(m as ChatMessage | WhisperMessage).textContent
                    )
                    .map(m => ({
                        textContent: (m as ChatMessage | WhisperMessage).textContent,
                        lastUpdatedTimestamp: m.lastUpdatedTimestamp || m.firstCreatedTimestamp || 0,
                        characterId: m.character.id,
                    }));

                speculativeMarkovEngine.fullTrain(trainingMessages, hydratedChat.id);
            }

            // Resolve the primary protagonist to set as selected character
            const primaryProtagonistId = hydratedChat.protagonistIds?.[0];
            const primaryProtagonist = primaryProtagonistId 
                ? hydratedParticipants.find(p => p.id === primaryProtagonistId) 
                : null;

            if (primaryProtagonist) {
                setSelectedCharacter(primaryProtagonist);
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