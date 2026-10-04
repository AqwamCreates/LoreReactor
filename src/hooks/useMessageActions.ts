// src/hooks/useMessageActions.ts
import { useCallback } from 'react';
import type { Character, InteractionData, HistoryMessage, ChatMessage, WhisperMessage } from '../types';
import { editChatMessage as editMessage } from '../utilities/messageLogic';
import { convertIdsToDisplayNames } from '../utilities/chatLogic';
import { toolStartSring, toolEndString } from '../dictionaries/stringList';
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

        const resultRegex = new RegExp(`${startEsc}result:\\s*[\\s\\S]*?${endEsc}`, 'g');
        let processed = rawText.replace(resultRegex, '');

        const badgeMap = new Map<string, string>(); 
        const emojiMap = new Map<string, string>(); 

        if (oldProcessedText) {
            const oldBadges: string[] = [];
            const badgeRegex = /\[([^\]]*)\]/g;
            let bm: RegExpExecArray | null;
            
            while ((bm = badgeRegex.exec(oldProcessedText)) !== null) {
                const inner = bm[1];
                const emojiMatch = inner.match(/^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}⚡🔧💀🛠️✨📨🔒🔓👕🎙️📝📦🗺️🌐🔍🎲🪙📅⏱️❓💭🤫🔊🔇🔌🖥️🖱️📸📂⚙️🗑️🔗📁💻🔔📟❌])/u);
                if (emojiMatch) {
                    oldBadges.push(bm[0]);
                    const emoji = emojiMatch[1];
                    const rest = inner.slice(emojiMatch[0].length).trim();
                    const toolNameMatch = rest.match(/^([a-zA-Z_]\w*)/);
                    if (toolNameMatch) emojiMap.set(toolNameMatch[1].toLowerCase(), emoji);
                    continue;
                }
                
                const fullFormatMatch = inner.match(/^([a-zA-Z_]\w*)\(/);
                if (fullFormatMatch && inner.includes('→')) {
                    oldBadges.push(bm[0]);
                    emojiMap.set(fullFormatMatch[1].toLowerCase(), '🔧');
                }
            }

            if (oldRawText) {
                const oldClean = oldRawText.replace(resultRegex, '');
                const oldInners: string[] = [];
                const toolRe = new RegExp(`${startEsc}([\\s\\S]*?)${endEsc}`, 'g');
                let tm: RegExpExecArray | null;
                while ((tm = toolRe.exec(oldClean)) !== null) oldInners.push(tm[1].trim());

                const limit = Math.min(oldInners.length, oldBadges.length);
                for (let i = 0; i < limit; i++) badgeMap.set(oldInners[i], oldBadges[i]);
            }
        }

        const toolRegex = new RegExp(`${startEsc}([\\s\\S]*?)${endEsc}`, 'g');
        processed = processed.replace(toolRegex, (_match, inner) => {
            const trimmedInner = inner.trim();
            if (badgeMap.has(trimmedInner)) return badgeMap.get(trimmedInner)!;

            let toolType = trimmedInner.toLowerCase();
            const fnMatch = trimmedInner.match(/^([a-zA-Z_]\w*)\s*\(/);
            if (fnMatch) toolType = fnMatch[1].toLowerCase();
            else {
                const spaceIdx = trimmedInner.search(/\s/);
                if (spaceIdx !== -1) toolType = trimmedInner.slice(0, spaceIdx).toLowerCase();
            }

            const emoji = emojiMap.get(toolType) || '🔧';
            return `[${emoji} ${trimmedInner}]`;
        });

        processed = processed.replace(/  +/g, ' ').trim();
        return convertIdsToDisplayNames(processed, data, character);
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

        return changed ? { ...data, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() } : data;
    };

    const handleSaveEdit = useCallback(async () => {
        const { editingId, editDraft, setEditingState } = useSessionStore.getState();
        if (!interactionData || !editingId) return;
        
        try {
            const oldMsg = findMessageById(interactionData, editingId);
            const oldProcessed = oldMsg?.processedTextContent;
            const oldRaw = oldMsg?.textContent;

            const updated = await editMessage(interactionData, editingId, editDraft);
            const finalUpdated = updateMessageProcessedText(updated, editingId, editDraft, oldRaw, oldProcessed);

            if (oldMsg) learnFromManualEdits(oldMsg.textContent, editDraft);

            setInteractionData(finalUpdated);
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
            const oldMsg = findMessageById(interactionData, editingId);
            const oldProcessed = oldMsg?.processedTextContent;
            const oldRaw = oldMsg?.textContent;

            const updatedData = await editMessage(interactionData, editingId, editDraft);
            const finalUpdated = updateMessageProcessedText(updatedData, editingId, editDraft, oldRaw, oldProcessed);

            setInteractionData(finalUpdated);
            setEditingState(null, '');
            
            await regenerateFromMessage(editingId, finalUpdated.protagonistIds || []);
        } catch (e) {
            addToast((e as Error).message, 'error');
        }
    }, [interactionData, isModelReady, isLoading, setInteractionData, regenerateFromMessage, addToast]);

    return {
        handleSaveEdit,
        handleRegenerateFromEdit,
    };
}