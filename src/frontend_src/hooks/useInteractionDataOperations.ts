// src/frontend_src/hooks/useInteractionDataOperations.ts
import { useState, useCallback, useRef } from 'react';
import type { Character, InteractionData, RawInteractionData, HistoryMessage, TextMessage } from '../types';
import { saveRawInteractionData, loadRawInteractionData, saveRawSessionData } from '../storages/serverStorage';
import { clearFetchCache } from '../utilities/linkFetcher';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { isChatSaveable } from '../utilities/chatSaveHelper';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';

const tokenEngine = getLanguageModelEngine();

interface UseChatOperationsOptions {
    interactionData: InteractionData | null;
    currentCharacter: Character | null;
    localProtagonistId: string | null; // ✅ FIX: Changed from Character object to string ID
    selectedCharacterId: string | null;
    allCharacters: Character[];
    allRawInteractionDataShells?: RawInteractionData[];
    loadFullCharacter?: (id: string) => Promise<Character | null>;
    setInteractionData: (data: InteractionData) => void;
    setSelectedCharacter: (char: Character | null) => void;
    refreshChatList: () => void;
    startNewChat: (char: Character) => void;
    deleteChatFromList: (id: string) => Promise<boolean>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useInteractionDataOperations(options: UseChatOperationsOptions) {
    const {
        interactionData, currentCharacter, selectedCharacterId,
        allCharacters, loadFullCharacter,
        setInteractionData, setSelectedCharacter, refreshChatList,
        startNewChat, deleteChatFromList, addToast,
    } = options;

    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitleValue, setEditTitleValue] = useState('');
    
    // Request sequence tracker to prevent race conditions during rapid chat switching
    const switchSeqRef = useRef(0);

    const safeAutoSave = useCallback(async (data: InteractionData | null) => {
        if (!data || !isChatSaveable(data)) return;
        try { 
            await saveRawInteractionData(data); 
        } catch (e) { 
            console.error('[useInteractionDataOperations] Auto-save failed:', e); 
        }
    }, []);

    const hydrateCharacter = useCallback(async (char: Character | null): Promise<Character | null> => {
        if (!char) return null;
        if (!loadFullCharacter) return char;
        try {
            const full = await loadFullCharacter(char.id);
            return full || char;
        } catch (e) {
            console.warn(`[useInteractionDataOperations] Failed to hydrate character ${char.id}:`, e);
            return char;
        }
    }, [loadFullCharacter]);

    const handleSwitchInteractionData = useCallback(async (id: string) => {
        if (interactionData?.id === id) return;

        const currentSeq = ++switchSeqRef.current;
        
        tokenEngine.clearTokenCache();
        await safeAutoSave(interactionData);
        clearFetchCache();
        
        let chat: InteractionData | null = null;
        try {
            chat = await loadRawInteractionData(id, allCharacters);
        } catch (e) {
            console.warn('[useInteractionDataOperations] Failed to load chat:', e);
        }

        // If another switch request was initiated while loading, discard this stale result
        if (currentSeq !== switchSeqRef.current) return;

        if (chat) {
            let fullChat = chat;

            // Hydrate all participants with full data (samplers, stopPatterns, retrieval configs)
            if (loadFullCharacter && fullChat.participants.length > 0) {
                const hydratedParticipants = await Promise.all(
                    fullChat.participants.map(async (p) => {
                        const full = await loadFullCharacter(p.id);
                        return full || p;
                    })
                );

                if (currentSeq !== switchSeqRef.current) return;

                const participantMap = new Map<string, Character>();
                for (const p of hydratedParticipants) participantMap.set(p.id, p);

                const remappedHistories: Record<string, HistoryMessage[]> = {};
                for (const [locId, msgs] of Object.entries(fullChat.interactionHistories || {})) {
                    remappedHistories[locId] = msgs.map(m => {
                        const hydratedChar = m.character?.id ? participantMap.get(m.character.id) : undefined;
                        return hydratedChar ? { ...m, character: hydratedChar } : m;
                    });
                }

                fullChat = {
                    ...fullChat,
                    participants: hydratedParticipants,
                    interactionHistories: remappedHistories,
                };
            }

            if (currentSeq !== switchSeqRef.current) return;

            setInteractionData(fullChat);
            await saveRawSessionData({ activeChatId: id });

            // FIX: Replaced flat interactionHistory array with spatial interactionHistories Record reduction
            const allMessages = Object.values(fullChat.interactionHistories || {}).flat();
            
            // Prime the Markov Engine for all characters in the switched chat
            if (fullChat.id && allMessages.length > 0) {
                const trainingMessages = allMessages
                    .filter((m): m is TextMessage => 
                        (m.messageType === 'chat' || m.messageType === 'whisper') && !!m.character?.id && !!(m as TextMessage).textContent
                    )
                    .map(m => ({
                        textContent: (m as TextMessage).textContent,
                        lastUpdatedTimestamp: m.lastUpdatedTimestamp || m.firstCreatedTimestamp || 0,
                        characterId: m.character.id,
                    }));

                speculativeMarkovEngine.fullTrain(trainingMessages, fullChat.id);
            } else if (fullChat.id) {
                speculativeMarkovEngine.clearSession(fullChat.id);
            }

            const activeProtagonistId = fullChat.protagonistIds?.[0];
            const activeProtagonist = activeProtagonistId 
                ? fullChat.participants.find(p => p.id === activeProtagonistId) 
                : (fullChat.participants?.[0] || null);
                
            if (activeProtagonist) {
                setSelectedCharacter(activeProtagonist);
            }
        } else {
            addToast('Failed to load chat.', 'error');
        }
    }, [allCharacters, interactionData, loadFullCharacter, setInteractionData, setSelectedCharacter, addToast, safeAutoSave]);

    const handleNewInteractionData = useCallback(async () => {
        const currentSeq = ++switchSeqRef.current;

        tokenEngine.clearTokenCache();
        await safeAutoSave(interactionData);
        clearFetchCache();
        
        // Clear active chat in server session so restoration starts fresh
        await saveRawSessionData({ activeChatId: null });

        const fallbackChar = currentCharacter
            || (selectedCharacterId ? allCharacters.find(x => x.id === selectedCharacterId) : null)
            || allCharacters[0]
            || null;

        const targetChar = await hydrateCharacter(fallbackChar);
        if (currentSeq !== switchSeqRef.current) return;

        if (targetChar) {
            startNewChat(targetChar);
        } else {
            addToast('No characters available to start a chat.', 'error');
        }
    }, [interactionData, currentCharacter, selectedCharacterId, allCharacters, hydrateCharacter, startNewChat, safeAutoSave, addToast]);

    const handleDeleteInteractionData = useCallback(async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        await safeAutoSave(interactionData);

        if (await deleteChatFromList(id)) {
            speculativeMarkovEngine.clearSession(id);
            addToast('Chat session deleted.', 'info');

            if (interactionData?.id === id) {
                const currentSeq = ++switchSeqRef.current;
                await saveRawSessionData({ activeChatId: null });
                const fallbackChar = currentCharacter
                    || (selectedCharacterId ? allCharacters.find(x => x.id === selectedCharacterId) : null)
                    || allCharacters[0]
                    || null;
                const nextChar = await hydrateCharacter(fallbackChar);
                if (currentSeq !== switchSeqRef.current) return;
                if (nextChar) startNewChat(nextChar);
            }
        } else {
            addToast('Failed to delete chat.', 'error');
        }
    }, [interactionData, currentCharacter, selectedCharacterId, allCharacters, hydrateCharacter, deleteChatFromList, startNewChat, addToast, safeAutoSave]);

    const handleStartEditTitle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setEditTitleValue(interactionData?.name || '');
        setIsEditingTitle(true);
    }, [interactionData]);

    const handleSaveTitle = useCallback(async () => {
        if (!interactionData) return;
        const newTitle = editTitleValue || 'Untitled Session';
        const updatedChat = { 
            ...interactionData, 
            name: newTitle, 
            lastUpdatedTimestamp: Date.now() 
        };

        setInteractionData(updatedChat);
        setIsEditingTitle(false);

        try {
            await saveRawInteractionData(updatedChat);
            refreshChatList();
            addToast('Chat title updated', 'success');
        } catch (e) {
            console.error('[useInteractionDataOperations] Failed to save title:', e);
            addToast('Failed to save title update.', 'error');
        }
    }, [interactionData, editTitleValue, setInteractionData, refreshChatList, addToast]);

    const cancelEditTitle = useCallback(() => {
        setIsEditingTitle(false);
    }, []);

    return {
        isEditingTitle, setIsEditingTitle,
        editTitleValue, setEditTitleValue,
        safeAutoSave,
        handleSwitchInteractionData,
        handleNewInteractionData,
        handleDeleteInteractionData,
        handleStartEditTitle,
        handleSaveTitle,
        cancelEditTitle,
    };
}