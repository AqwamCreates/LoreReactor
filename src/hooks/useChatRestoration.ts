// src/hooks/useChatRestoration.ts
import { useState, useRef, useEffect } from 'react';
import type { Character, InteractionData } from '../types';
import { loadRawInteractionData, loadInteractionMessages } from './storage';
import { createNewInteractionData } from './chatLogic';
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
    allChats: InteractionData[];
    loadFullCharacter: (id: string) => Promise<Character | null>;
    setInteractionData: (data: InteractionData) => void;
    setCurrentCharacter: (char: Character | null) => void;
    setSelectedModelId: (id: string | null) => void;
    startNewChat: (char: Character) => void;
}

function createEmptyChat(): InteractionData {
    return {
        id: uuidv4(),
        name: 'Untitled Chat',
        protagonist: null as unknown as Character,
        participants: [],
        contexts: [],
        locations: [],
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
        allCharacters, allChats, loadFullCharacter,
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

            if (!chat.interactionHistory.length && (chat.numberOfMessages ?? 0) > 0) {
                try {
                    fullChat = await loadInteractionMessages(chat);
                } catch (e) {
                    console.warn('Failed to load chat messages for fallback:', e);
                }
            }

            if (fullChat.protagonist) {
                let protagonist = fullChat.protagonist;

                const freshProtag = allCharacters.find(c => c.id === protagonist.id);
                if (freshProtag) {
                    const fullChar = await loadFullCharacter(freshProtag.id);
                    if (fullChar) protagonist = fullChar;
                } else {
                    console.warn(`Protagonist ${protagonist.id} not found in character list after load.`);
                }

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

                setInteractionData({
                    ...fullChat,
                    protagonist,
                    participants: hydratedParticipants,
                });

                setCurrentCharacter(protagonist);
            } else {
                setInteractionData(fullChat);
            }
        };

        const restore = async () => {
            try {
                if (!savedChatId) {
                    if (allChats.length > 0) {
                        await activateChat(allChats[0]);
                    } else if (allCharacters.length > 0) {
                        startNewChat(allCharacters[0]);
                    } else {
                        setCurrentCharacter(null);
                        setInteractionData(createEmptyChat());
                    }
                    return;
                }

                const interactionDataResult = await loadRawInteractionData(savedChatId, allCharacters);

                if (interactionDataResult) {
                    let fullChat = interactionDataResult;
                    if (fullChat.numberOfMessages && fullChat.numberOfMessages > 0 && fullChat.interactionHistory.length === 0) {
                        try { fullChat = await loadInteractionMessages(interactionDataResult); } catch (e) { console.warn('Failed to load chat messages, using shell:', e); }
                    }
                    await activateChat(fullChat as InteractionData);
                } else {
                    console.warn('Active chat not found, falling back.');
                    localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
                    if (allChats.length > 0) { await activateChat(allChats[0]); }
                    else if (allCharacters.length > 0) { startNewChat(allCharacters[0]); }
                    else {
                        setCurrentCharacter(null);
                        setInteractionData(createEmptyChat());
                    }
                }
            } catch (e) {
                console.error('Failed to restore active chat:', e);
                localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
                if (allChats.length > 0) { await activateChat(allChats[0]); }
                else if (allCharacters.length > 0) { startNewChat(allCharacters[0]); }
                else {
                    setCurrentCharacter(null);
                    setInteractionData(createEmptyChat());
                }
            } finally {
                setActiveChatRestored(true);
            }
        };

        restore();
    }, [charsLoading, chatsLoading, contextsLoading, locationsLoading, profilesLoading, allCharacters, allChats, loadFullCharacter, setInteractionData, setCurrentCharacter, setSelectedModelId, startNewChat]);

    return { activeChatRestored };
}