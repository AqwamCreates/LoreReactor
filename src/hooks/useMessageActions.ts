// src/hooks/useMessageActions.ts
import { useState, useCallback } from 'react';
import type { Character, InteractionData } from '../types';
import { deleteMessage, massDeleteMessages, editMessage, branchMessage, cloneChatUpToMessage } from '../utilities/messageLogic';
import { saveRawInteractionData, saveRawSessionData } from '../storages/serverStorage';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';

interface UseMessageActionsOptions {
    interactionData: InteractionData | null;
    localProtagonist: Character | null;
    isModelReady: boolean;
    isLoading: boolean;
    setInteractionData: (data: InteractionData) => void;
    setSelectedCharacter: (char: Character | null) => void;
    refreshChatList: () => void;
    regenerateFromMessage: (id: string, protagonists: Character[]) => Promise<void>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useMessageActions(options: UseMessageActionsOptions) {
    const {
        interactionData, localProtagonist, isModelReady, isLoading,
        setInteractionData, setSelectedCharacter, refreshChatList,
        regenerateFromMessage, addToast,
    } = options;

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [massDeleteId, setMassDeleteId] = useState<string | null>(null);

    const handleSaveEdit = useCallback(async () => {
        if (!interactionData || !editingId) return;
        try {
            const updated = await editMessage(interactionData, editingId, editDraft);
            setInteractionData(updated);
            setEditingId(null);
            setEditDraft('');
            addToast('Message edited.', 'success');
        } catch (e) {
            addToast((e as Error).message, 'error');
        }
    }, [interactionData, editingId, editDraft, setInteractionData, addToast]);

    const handleRegenerateFromEdit = useCallback(async () => {
        if (!interactionData || !editingId) return;
        if (!isModelReady || isLoading) return;
        try {
            const targetId = editingId;
            const updatedData = await editMessage(interactionData, targetId, editDraft);

            setInteractionData(updatedData);
            setEditingId(null);
            setEditDraft('');

            // Deterministic immediate regeneration without fragile detached effect
            await regenerateFromMessage(targetId, updatedData.protagonists ?? []);
        } catch (e) {
            addToast((e as Error).message, 'error');
        }
    }, [interactionData, editingId, editDraft, isModelReady, isLoading, setInteractionData, regenerateFromMessage, addToast]);

    const handleDelete = useCallback(async (id: string) => {
        if (!interactionData) return;
        try {
            const updated = await deleteMessage(interactionData, id);
            setInteractionData(updated);
            addToast('Message deleted.', 'info');
        } catch (e) {
            addToast((e as Error).message, 'error');
        }
    }, [interactionData, setInteractionData, addToast]);

    const handleMassDeleteConfirm = useCallback(async () => {
        if (!interactionData || !massDeleteId) return;
        const targetId = massDeleteId;
        const idx = interactionData.interactionHistory.findIndex(m => m.id === targetId);
        
        if (idx === -1) {
            setMassDeleteId(null);
            return;
        }

        try {
            const updated = await massDeleteMessages(interactionData, idx);
            setInteractionData(updated);
            addToast('Messages deleted.', 'info');
        } catch (e) {
            addToast((e as Error).message, 'error');
        } finally {
            setMassDeleteId(null);
        }
    }, [interactionData, massDeleteId, setInteractionData, addToast]);

    const handleBranch = useCallback(async (id: string) => {
        if (!interactionData) return;
        try {
            const branchedChat = await branchMessage(interactionData, id);
            await saveRawInteractionData(branchedChat);
            await saveRawSessionData({ activeChatId: branchedChat.id });

            setInteractionData(branchedChat);
            if (localProtagonist) {
                setSelectedCharacter(localProtagonist);
            }

            // Prime Markov model for the newly created branch
            speculativeMarkovEngine.clearSession(branchedChat.id);

            refreshChatList();
            addToast(`Branched to "${branchedChat.name}"`, 'success');
        } catch (e) {
            console.error('[useMessageActions] Branch error:', e);
            addToast('Failed to branch chat.', 'error');
        }
    }, [interactionData, localProtagonist, setInteractionData, setSelectedCharacter, refreshChatList, addToast]);

    const handleClone = useCallback(async (id: string) => {
        if (!interactionData) return;
        try {
            const clonedChat = await cloneChatUpToMessage(interactionData, id);
            await saveRawInteractionData(clonedChat);
            await saveRawSessionData({ activeChatId: clonedChat.id });

            setInteractionData(clonedChat);
            if (localProtagonist) {
                setSelectedCharacter(localProtagonist);
            }

            speculativeMarkovEngine.clearSession(clonedChat.id);

            refreshChatList();
            addToast(`Cloned to "${clonedChat.name}"`, 'success');
        } catch (e) {
            console.error('[useMessageActions] Clone error:', e);
            addToast('Failed to clone chat.', 'error');
        }
    }, [interactionData, localProtagonist, setInteractionData, setSelectedCharacter, refreshChatList, addToast]);

    const handleCopyText = useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            addToast('Copied to clipboard', 'success');
        } catch {
            addToast('Failed to copy text', 'error');
        }
    }, [addToast]);

    const startEditing = useCallback((messageId: string, textContent: string) => {
        setEditingId(messageId);
        setEditDraft(textContent);
    }, []);

    const cancelEditing = useCallback(() => {
        setEditingId(null);
        setEditDraft('');
    }, []);

    return {
        editingId, editDraft, setEditDraft,
        massDeleteId, setMassDeleteId,
        handleSaveEdit,
        handleRegenerateFromEdit,
        handleDelete,
        handleMassDeleteConfirm,
        handleBranch,
        handleClone,
        handleCopyText,
        startEditing,
        cancelEditing,
    };
}