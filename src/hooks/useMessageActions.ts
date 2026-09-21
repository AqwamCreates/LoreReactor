// src/hooks/useMessageActions.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Character, InteractionData } from '../types';
import { deleteMessage, massDeleteMessages, editMessage, branchMessage, cloneChatUpToMessage } from './messageLogic';

interface UseMessageActionsOptions {
    interactionData: InteractionData | null;
    localProtagonist: Character | null;
    isModelReady: boolean;
    isLoading: boolean;
    setInteractionData: (data: InteractionData) => void;
    setCurrentCharacter: (char: Character | null) => void;
    refreshChatList: () => void;
    regenerateFromMessage: (id: string, protagonists: Character[]) => Promise<void>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useMessageActions(options: UseMessageActionsOptions) {
    const {
        interactionData, localProtagonist, isModelReady, isLoading,
        setInteractionData, setCurrentCharacter, refreshChatList,
        regenerateFromMessage, addToast,
    } = options;

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [massDeleteId, setMassDeleteId] = useState<string | null>(null);
    const pendingRegenRef = useRef<{ id: string; type: 'user' | 'ai' } | null>(null);

    // Trigger regeneration AFTER edit state has committed
    useEffect(() => {
        if (pendingRegenRef.current && interactionData) {
            const { id } = pendingRegenRef.current;
            pendingRegenRef.current = null;

            const msg = interactionData.interactionHistory.find(m => m.id === id);
            if (msg) {
                regenerateFromMessage(id, interactionData.protagonists ?? []);
            }
        }
    }, [interactionData, regenerateFromMessage]);

    const handleSaveEdit = useCallback(async () => {
        if (!interactionData || !editingId) return;
        try {
            setInteractionData(await editMessage(interactionData, editingId, editDraft));
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
            const updatedData = await editMessage(interactionData, editingId, editDraft);

            const editedMsg = updatedData.interactionHistory.find(m => m.id === editingId);
            const protagonistIds = new Set(interactionData.protagonists?.map(p => p.id) ?? []);
            const isUserMsg = editedMsg && 'character' in editedMsg && protagonistIds.has(editedMsg.character?.id);

            pendingRegenRef.current = { id: editingId, type: isUserMsg ? 'user' : 'ai' };

            setInteractionData(updatedData);
            setEditingId(null);
            setEditDraft('');
        } catch (e) {
            addToast((e as Error).message, 'error');
        }
    }, [interactionData, editingId, editDraft, isModelReady, isLoading, setInteractionData, addToast]);

    const handleDelete = useCallback(async (id: string) => {
        if (!interactionData) return;
        try {
            setInteractionData(await deleteMessage(interactionData, id));
            addToast('Message deleted.', 'info');
        } catch (e) {
            addToast((e as Error).message, 'error');
        }
    }, [interactionData, setInteractionData, addToast]);

    const handleMassDeleteConfirm = useCallback(async () => {
        if (!interactionData || !massDeleteId) return;
        const idx = interactionData.interactionHistory.findIndex(m => m.id === massDeleteId);
        if (idx === -1) return;
        try {
            setInteractionData(await massDeleteMessages(interactionData, idx));
            setMassDeleteId(null);
            addToast('Messages deleted.', 'info');
        } catch (e) {
            addToast((e as Error).message, 'error');
        }
    }, [interactionData, massDeleteId, setInteractionData, addToast]);

    const handleBranch = useCallback(async (id: string) => {
        if (!interactionData) return;
        try {
            const b = await branchMessage(interactionData, id);
            setInteractionData(b);
            if (localProtagonist) setCurrentCharacter(localProtagonist);
            refreshChatList();
            addToast(`Branched to "${b.name}"`, 'success');
        } catch {
            addToast('Failed to branch chat.', 'error');
        }
    }, [interactionData, localProtagonist, setInteractionData, setCurrentCharacter, refreshChatList, addToast]);

    const handleClone = useCallback(async (id: string) => {
        if (!interactionData) return;
        try {
            const c = await cloneChatUpToMessage(interactionData, id);
            setInteractionData(c);
            if (localProtagonist) setCurrentCharacter(localProtagonist);
            refreshChatList();
            addToast(`Cloned to "${c.name}"`, 'success');
        } catch {
            addToast('Failed to clone chat.', 'error');
        }
    }, [interactionData, localProtagonist, setInteractionData, setCurrentCharacter, refreshChatList, addToast]);

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