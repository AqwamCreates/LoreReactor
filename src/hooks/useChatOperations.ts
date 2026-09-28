// src/hooks/useChatOperations.ts
import { useState, useCallback } from 'react';
import type { Character, InteractionData, RawInteractionData } from '../types';
import { saveRawInteractionData, loadRawInteractionData, saveRawSessionData } from '../storages/serverStorage';
import { clearFetchCache } from '../services/linkFetcher';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { isChatSaveable } from '../utilities/chatSaveHelper';

const tokenEngine = getLanguageModelEngine();

interface UseChatOperationsOptions {
    interactionData: InteractionData | null;
    currentCharacter: Character | null;
    localProtagonist: Character | null;
    selectedCharacterId: string | null;
    allCharacters: Character[];
    rawChatShells?: RawInteractionData[];
    loadFullCharacter?: (id: string) => Promise<Character | null>;
    setInteractionData: (data: InteractionData) => void;
    setSelectedCharacter: (char: Character | null) => void;
    refreshChatList: () => void;
    startNewChat: (char: Character) => void;
    deleteChatFromList: (id: string) => Promise<boolean>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useChatOperations(options: UseChatOperationsOptions) {
    const {
        interactionData, currentCharacter, selectedCharacterId,
        allCharacters, loadFullCharacter,
        setInteractionData, setSelectedCharacter, refreshChatList,
        startNewChat, deleteChatFromList, addToast,
    } = options;

    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitleValue, setEditTitleValue] = useState('');

    const safeAutoSave = useCallback(async (data: InteractionData | null) => {
        if (!data || !isChatSaveable(data)) return;
        try { 
            await saveRawInteractionData(data); 
        } catch (e) { 
            console.error('Auto-save failed:', e); 
        }
    }, []);

    const handleSwitchChat = useCallback(async (id: string) => {
        if (interactionData?.id === id) return;
        tokenEngine.clearTokenCache();
        await safeAutoSave(interactionData);
        clearFetchCache();

        let chat: InteractionData | null = null;
        try {
            chat = await loadRawInteractionData(id, allCharacters);
        } catch (e) {
            console.warn('Failed to load chat:', e);
        }

        if (chat) {
            let fullChat = chat;

            // Hydrate protagonists with full data (system prompts, samplers) if available
            if (loadFullCharacter && fullChat.protagonists?.length) {
                const hydratedProtagonists = await Promise.all(
                    fullChat.protagonists.map(async (p) => {
                        const full = await loadFullCharacter(p.id);
                        return full || p;
                    })
                );
                fullChat = { ...fullChat, protagonists: hydratedProtagonists };
            }

            setInteractionData(fullChat);
            await saveRawSessionData({ activeChatId: id });
            
            const firstProtagonist = fullChat.protagonists?.[0] ?? null;
            if (firstProtagonist) setSelectedCharacter(firstProtagonist);
        } else {
            addToast('Failed to load chat.', 'error');
        }
        refreshChatList();
    }, [allCharacters, interactionData, loadFullCharacter, setInteractionData, setSelectedCharacter, refreshChatList, addToast, safeAutoSave]);

    const handleNewChat = useCallback(async () => {
        await safeAutoSave(interactionData);
        clearFetchCache();

        // Clear active chat in server session so restoration picks up the new chat
        await saveRawSessionData({ activeChatId: null });

        // Resolve protagonist directly without reading whole chat files from disk
        const targetChar = currentCharacter
            || (selectedCharacterId ? allCharacters.find(x => x.id === selectedCharacterId) : null)
            || allCharacters[0]
            || null;

        if (targetChar) {
            startNewChat(targetChar);
        } else {
            addToast('No characters available to start a chat.', 'error');
        }
    }, [interactionData, currentCharacter, selectedCharacterId, allCharacters, startNewChat, safeAutoSave, addToast]);

    const handleDeleteChat = useCallback(async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        await safeAutoSave(interactionData);
        if (await deleteChatFromList(id)) {
            addToast('Chat session deleted.', 'info');
            if (interactionData?.id === id) {
                // Deleted active chat — clear session and start fresh with fallback character
                await saveRawSessionData({ activeChatId: null });
                const nextChar = currentCharacter
                    || (selectedCharacterId ? allCharacters.find(x => x.id === selectedCharacterId) : null)
                    || allCharacters[0]
                    || null;

                if (nextChar) startNewChat(nextChar);
            }
        } else {
            addToast('Failed to delete chat.', 'error');
        }
    }, [interactionData, currentCharacter, selectedCharacterId, allCharacters, deleteChatFromList, startNewChat, addToast, safeAutoSave]);

    const handleStartEditTitle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setEditTitleValue(interactionData?.name || '');
        setIsEditingTitle(true);
    }, [interactionData]);

    const handleSaveTitle = useCallback(() => {
        if (!interactionData) return;
        const t = editTitleValue.trim() || 'Untitled Chat';
        setInteractionData({ ...interactionData, name: t } as InteractionData);
        saveRawInteractionData({ ...interactionData, name: t });
        refreshChatList();
        setIsEditingTitle(false);
        addToast('Chat title updated', 'success');
    }, [interactionData, editTitleValue, setInteractionData, refreshChatList, addToast]);

    const cancelEditTitle = useCallback(() => {
        setIsEditingTitle(false);
    }, []);

    return {
        isEditingTitle, setIsEditingTitle,
        editTitleValue, setEditTitleValue,
        safeAutoSave,
        handleSwitchChat,
        handleNewChat,
        handleDeleteChat,
        handleStartEditTitle,
        handleSaveTitle,
        cancelEditTitle,
    };
}