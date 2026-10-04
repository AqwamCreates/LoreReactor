// src/hooks/useMessageActions.ts
import { useState, useCallback } from 'react';
import type { Character, InteractionData, HistoryMessage, ChatMessage, WhisperMessage, PromptBlock } from '../types';
import { 
    deleteMessage, 
    massDeleteMessages, 
    editChatMessage as editMessage, 
    branchMessage, 
    cloneChatUpToMessage 
} from '../utilities/messageLogic';
import { convertIdsToDisplayNames } from '../utilities/chatLogic';
import { toolStartSring, toolEndString } from '../dictionaries/stringList';
import { saveRawInteractionData, saveRawSessionData } from '../storages/serverStorage';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';

interface UseMessageActionsOptions {
    interactionData: InteractionData | null;
    localProtagonistId: string | null; // ✅ FIX: Changed from Character object to string ID
    isModelReady: boolean | undefined;
    isLoading: boolean;
    setInteractionData: (data: InteractionData) => void;
    setSelectedCharacter: (char: Character | null) => void;
    refreshChatList: () => void;
    regenerateFromMessage: (id: string, protagonistIds: string[], allPromptBlocks?: PromptBlock[]) => Promise<void>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useMessageActions(options: UseMessageActionsOptions) {
    const {
        interactionData, localProtagonistId, isModelReady, isLoading,
        setInteractionData, setSelectedCharacter, refreshChatList,
        regenerateFromMessage, addToast,
    } = options;

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [massDeleteId, setMassDeleteId] = useState<string | null>(null);

    const findMessageById = (data: InteractionData, messageId: string): (ChatMessage | WhisperMessage) | null => {
        for (const msgs of Object.values(data.interactionHistories || {})) {
            const found = msgs.find(m => m.id === messageId);
            if (found && 'textContent' in found) return found as ChatMessage | WhisperMessage;
        }
        return null;
    };

    const regenerateProcessedText = (
        rawText: string,
        oldRawText: string | undefined,
        oldProcessedText: string | undefined,
        data: InteractionData,
        character: Character
    ): string => {
        if (!rawText) return '';

        const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const startEsc = escapeRegex(toolStartSring);
        const endEsc = escapeRegex(toolEndString);

        // 1. Strip LLM-only result tags
        const resultRegex = new RegExp(`${startEsc}result:\\s*[\\s\\S]*?${endEsc}`, 'g');
        let processed = rawText.replace(resultRegex, '');

        const badgeMap = new Map<string, string>(); // exact old inner text -> exact old badge
        const emojiMap = new Map<string, string>(); // tool type -> extracted emoji

        if (oldProcessedText) {
            const oldBadges: string[] = [];
            const badgeRegex = /\[([^\]]*)\]/g;
            let bm: RegExpExecArray | null;
            
            // Collect all actual tool badges from the old processed text (ignoring natural text brackets like [sighs])
            while ((bm = badgeRegex.exec(oldProcessedText)) !== null) {
                const inner = bm[1];
                
                // Check if it starts with an emoji
                const emojiMatch = inner.match(/^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}⚡🔧💀🛠️✨📨🔒🔓👕🎙️📝📦🗺️🌐🔍🎲🪙📅⏱️❓💭🤫🔊🔇🔌🖥️🖱️📸📂⚙️🗑️🔗📁💻🔔📟❌])/u);
                if (emojiMatch) {
                    oldBadges.push(bm[0]);
                    const emoji = emojiMatch[1];
                    const rest = inner.slice(emojiMatch[0].length).trim();
                    const toolNameMatch = rest.match(/^([a-zA-Z_]\w*)/);
                    if (toolNameMatch) {
                        emojiMap.set(toolNameMatch[1].toLowerCase(), emoji);
                    }
                    continue;
                }
                
                // Check if it matches the 'full' display mode format: toolType(args) → content
                const fullFormatMatch = inner.match(/^([a-zA-Z_]\w*)\(/);
                if (fullFormatMatch && inner.includes('→')) {
                    oldBadges.push(bm[0]);
                    emojiMap.set(fullFormatMatch[1].toLowerCase(), '🔧');
                    continue;
                }
            }

            // Align old badges 1:1 with old tool invocations
            if (oldRawText) {
                const oldClean = oldRawText.replace(resultRegex, '');
                const oldInners: string[] = [];
                const toolRe = new RegExp(`${startEsc}([\\s\\S]*?)${endEsc}`, 'g');
                let tm: RegExpExecArray | null;
                while ((tm = toolRe.exec(oldClean)) !== null) {
                    oldInners.push(tm[1].trim());
                }

                const limit = Math.min(oldInners.length, oldBadges.length);
                for (let i = 0; i < limit; i++) {
                    badgeMap.set(oldInners[i], oldBadges[i]);
                }
            }
        }

        // 2. Replace tool invocations in the new text
        const toolRegex = new RegExp(`${startEsc}([\\s\\S]*?)${endEsc}`, 'g');
        processed = processed.replace(toolRegex, (_match, inner) => {
            const trimmedInner = inner.trim();
            
            // If the exact tool call hasn't changed, place the exact old badge back
            if (badgeMap.has(trimmedInner)) {
                return badgeMap.get(trimmedInner)!;
            }

            // If the arguments changed, extract the tool type and use the collected emoji
            let toolType = trimmedInner.toLowerCase();
            const fnMatch = trimmedInner.match(/^([a-zA-Z_]\w*)\s*\(/);
            if (fnMatch) {
                toolType = fnMatch[1].toLowerCase();
            } else {
                const spaceIdx = trimmedInner.search(/\s/);
                if (spaceIdx !== -1) {
                    toolType = trimmedInner.slice(0, spaceIdx).toLowerCase();
                }
            }

            const emoji = emojiMap.get(toolType) || '🔧';
            return `[${emoji} ${trimmedInner}]`;
        });

        // 3. Clean up spaces and resolve IDs
        processed = processed.replace(/  +/g, ' ').trim();
        processed = convertIdsToDisplayNames(processed, data, character);

        return processed;
    };

    const updateMessageProcessedText = (
        data: InteractionData,
        messageId: string,
        newRawText: string,
        oldRawText: string | undefined,
        oldProcessedText: string | undefined
    ): InteractionData => {
        const newHistories = { ...data.interactionHistories };
        let changed = false;

        for (const [locId, msgs] of Object.entries(newHistories) as [string, HistoryMessage[]][]) {
            const idx = msgs.findIndex(m => m.id === messageId);
            if (idx !== -1) {
                const msg = msgs[idx] as ChatMessage | WhisperMessage;
                if ('textContent' in msg) {
                    const newProcessed = regenerateProcessedText(newRawText, oldRawText, oldProcessedText, data, msg.character);
                    const updatedMsg = {
                        ...msg,
                        textContent: newRawText,
                        processedTextContent: newProcessed !== newRawText ? newProcessed : undefined,
                    };
                    newHistories[locId] = [...msgs];
                    newHistories[locId][idx] = updatedMsg;
                    changed = true;
                }
                break;
            }
        }

        return changed
            ? { ...data, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() }
            : data;
    };

    const handleSaveEdit = useCallback(async () => {
        if (!interactionData || !editingId) return;
        try {
            const oldMsg = findMessageById(interactionData, editingId);
            const oldProcessed = oldMsg?.processedTextContent;
            const oldRaw = oldMsg?.textContent;

            const updated = await editMessage(interactionData, editingId, editDraft);
            const finalUpdated = updateMessageProcessedText(updated, editingId, editDraft, oldRaw, oldProcessed);

            setInteractionData(finalUpdated);
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
            const oldMsg = findMessageById(interactionData, targetId);
            const oldProcessed = oldMsg?.processedTextContent;
            const oldRaw = oldMsg?.textContent;

            const updatedData = await editMessage(interactionData, targetId, editDraft);
            const finalUpdated = updateMessageProcessedText(updatedData, targetId, editDraft, oldRaw, oldProcessed);

            setInteractionData(finalUpdated);
            setEditingId(null);
            setEditDraft('');

            // ✅ FIX: Pass the ID array directly instead of mapping to Character objects
            await regenerateFromMessage(targetId, finalUpdated.protagonistIds || []);
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
        try {
            const updated = await massDeleteMessages(interactionData, targetId);
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
            
            // ✅ FIX: Resolve the Character object from the new chat's participants using the ID
            const protagChar = localProtagonistId ? branchedChat.participants.find(p => p.id === localProtagonistId) ?? null : null;
            if (protagChar) setSelectedCharacter(protagChar);
            
            speculativeMarkovEngine.clearSession(branchedChat.id);
            refreshChatList();
            addToast(`Branched to "${branchedChat.name}"`, 'success');
        } catch (e) {
            console.error('[useMessageActions] Branch error:', e);
            addToast('Failed to branch chat.', 'error');
        }
    }, [interactionData, localProtagonistId, setInteractionData, setSelectedCharacter, refreshChatList, addToast]);

    const handleClone = useCallback(async (id: string) => {
        if (!interactionData) return;
        try {
            const clonedChat = await cloneChatUpToMessage(interactionData, id);
            await saveRawInteractionData(clonedChat);
            await saveRawSessionData({ activeChatId: clonedChat.id });
            setInteractionData(clonedChat);
            
            // ✅ FIX: Resolve the Character object from the new chat's participants using the ID
            const protagChar = localProtagonistId ? clonedChat.participants.find(p => p.id === localProtagonistId) ?? null : null;
            if (protagChar) setSelectedCharacter(protagChar);
            
            speculativeMarkovEngine.clearSession(clonedChat.id);
            refreshChatList();
            addToast(`Cloned to "${clonedChat.name}"`, 'success');
        } catch (e) {
            console.error('[useMessageActions] Clone error:', e);
            addToast('Failed to clone chat.', 'error');
        }
    }, [interactionData, localProtagonistId, setInteractionData, setSelectedCharacter, refreshChatList, addToast]);

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