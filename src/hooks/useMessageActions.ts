// src/hooks/useMessageActions.ts
import { useCallback } from 'react';
import type { InteractionData } from '../types';
import { editChatMessage as editMessage } from '../utilities/messageLogic';
import { useSessionStore } from './useSessionStore';
import { learnFromManualEdits } from '../utilities/textReformat';

interface UseMessageActionsOptions {
    interactionData: InteractionData | null;
    isModelReady: boolean | undefined;
    isLoading: boolean;
    setInteractionData: (data: InteractionData) => void;
    regenerateFromMessage: (id: string, protagonistIds: string[], allPromptBlocks?: any[]) => Promise<void>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useMessageActions(options: UseMessageActionsOptions) {
    const {
        interactionData, isModelReady, isLoading,
        setInteractionData, regenerateFromMessage, addToast,
    } = options;

    const handleSaveEdit = useCallback(async () => {
        const { editingId, editDraft, setEditingState } = useSessionStore.getState();
        if (!interactionData || !editingId) return;
        
        try {
            let oldMsg: any = null;
            for (const msgs of Object.values(interactionData.interactionHistories || {})) {
                const found = msgs.find(m => m.id === editingId);
                if (found && 'textContent' in found) {
                    oldMsg = found;
                    break;
                }
            }
            
            if (oldMsg) learnFromManualEdits(oldMsg.textContent, editDraft);

            // Just save the raw text. The display text is compiled on the fly!
            const updated = await editMessage(interactionData, editingId, editDraft);
            
            setInteractionData(updated);
            setEditingState(null, '');
            addToast('Message edited.', 'success');
        } catch (e) {
            addToast((e as Error).message, 'error');
        }
    }, [interactionData, setInteractionData, addToast]);

    const handleRegenerateFromEdit = useCallback(async () => {
        const { editingId, editDraft, setEditingState } = useSessionStore.getState();
        if (!interactionData || !editingId) return;
        if (!isModelReady || isLoading) return;
        
        try {
            const updatedData = await editMessage(interactionData, editingId, editDraft);
            
            setInteractionData(updatedData);
            setEditingState(null, '');
            
            await regenerateFromMessage(editingId, updatedData.protagonistIds || []);
        } catch (e) {
            addToast((e as Error).message, 'error');
        }
    }, [interactionData, isModelReady, isLoading, setInteractionData, regenerateFromMessage, addToast]);

    return {
        handleSaveEdit,
        handleRegenerateFromEdit,
    };
}