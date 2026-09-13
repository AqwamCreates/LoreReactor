// src/hooks/useChatOperations.ts
import { useState, useCallback } from 'react';
import type { Character, InteractionData, RawInteractionData } from '../types';
import { saveRawInteractionData, loadRawInteractionData } from '../storage/serverStorage';
import { clearFetchCache } from '../services/linkFetcher';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';

const STORAGE_KEY_ACTIVE_CHAT = 'loreReactor_activeChatId';

const tokenEngine = getLanguageModelEngine();

interface UseChatOperationsOptions {
    interactionData: InteractionData | null;
    currentCharacter: Character | null;
    defaultCharacterId: string | null;
    allCharacters: Character[];
    rawChatShells: RawInteractionData[];
    setInteractionData: (data: InteractionData) => void;
    setCurrentCharacter: (char: Character | null) => void;
    refreshChatList: () => void;
    startNewChat: (char: Character) => void;
    deleteChatFromList: (id: string) => Promise<boolean>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useChatOperations(options: UseChatOperationsOptions) {
    const {
        interactionData, currentCharacter, defaultCharacterId,
        allCharacters, rawChatShells,
        setInteractionData, setCurrentCharacter, refreshChatList,
        startNewChat, deleteChatFromList, addToast,
    } = options;

    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitleValue, setEditTitleValue] = useState('');

    const safeAutoSave = useCallback(async (data: InteractionData | null) => {
        if (!data) return;
        const msgs = data.interactionHistory.filter(m => m.messageType === 'chat');
        if (msgs.length === 0 && (data.numberOfMessages ?? 0) > 0) return;
        try { await saveRawInteractionData(data); } catch (e) { console.error('Auto-save failed:', e); }
    }, []);

    const handleSwitchChat = useCallback(async (id: string) => {
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
            setInteractionData(chat);
            if (chat.protagonist) setCurrentCharacter(chat.protagonist);
        } else {
            addToast('Failed to load chat.', 'error');
        }
        refreshChatList();
    }, [allCharacters, interactionData, setInteractionData, setCurrentCharacter, refreshChatList, addToast, safeAutoSave]);

    const handleNewChat = useCallback(async () => {
        await safeAutoSave(interactionData);
        clearFetchCache();
        localStorage.removeItem(STORAGE_KEY_ACTIVE_CHAT);
        let c = currentCharacter;
        if (!c && defaultCharacterId) c = allCharacters.find(x => x.id === defaultCharacterId) || null;
        if (!c && rawChatShells.length) {
            // Load the first raw shell to get its protagonist
            const firstId = rawChatShells[0].id;
            if (firstId) {
                const loaded = await loadRawInteractionData(firstId, allCharacters);
                if (loaded?.protagonist) c = loaded.protagonist;
            }
        }
        if (c) startNewChat(c);
    }, [interactionData, currentCharacter, defaultCharacterId, allCharacters, rawChatShells, startNewChat, safeAutoSave]);

    const handleDeleteChat = useCallback(async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        await safeAutoSave(interactionData);
        if (await deleteChatFromList(id)) {
            addToast('Chat session deleted.', 'info');
            if (interactionData?.id === id && currentCharacter) startNewChat(currentCharacter);
        } else {
            addToast('Failed to delete chat.', 'error');
        }
    }, [interactionData, currentCharacter, deleteChatFromList, startNewChat, addToast, safeAutoSave]);

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