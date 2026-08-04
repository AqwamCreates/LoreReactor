import type { Character, ChatData } from '../types';
import { findPreviousChatMessage } from '../hooks/chatLogic';
import { saveRawChatData } from '../hooks/storage';

interface TurnExecutor {
    (data: ChatData, character: Character, signal: AbortSignal, onToken: (t: string) => void): Promise<ChatData | null>;
}

export async function runTurnSequence(
    currentChatData: ChatData,
    executor: TurnExecutor,
    abortController: AbortController,
    onSpeakerChange?: (char: Character | null) => void,
    onTokenStream?: (text: string) => void,
    onMessageSaved?: (data: ChatData) => void // <--- Callback to update UI
    ): Promise<ChatData> {
    
    let workingData = { ...currentChatData, chatMessageHistory: [...currentChatData.chatMessageHistory] };
    let hasActivity = true;

    const staminaMap = new Map<string, number>();
    for (const p of workingData.participants) {
        if (p.id === workingData.protagonist.id) continue;
        const prev = findPreviousChatMessage(workingData, p.id);
        staminaMap.set(p.id, prev?.remainingChatStamina ?? (p.maximumChatStamina ?? Number.POSITIVE_INFINITY));
    }

    while (hasActivity && !abortController.signal.aborted) {
        hasActivity = false;

        for (const p of workingData.participants) {
        if (p.id === workingData.protagonist.id) continue;
        const current = staminaMap.get(p.id) || 0;
        const max = p.maximumChatStamina ?? Number.POSITIVE_INFINITY;
        if (current <= 0) {
            staminaMap.set(p.id, Math.min(max, current + 1));
        }
        }

        const eligible = workingData.participants
        .filter(p => p.id !== workingData.protagonist.id && (staminaMap.get(p.id) || 0) > 0)
        .sort((a, b) => {
            const wA = (a.initiativeWeight ?? 1) * ((staminaMap.get(a.id) || 0) / (a.maximumChatStamina ?? 1));
            const wB = (b.initiativeWeight ?? 1) * ((staminaMap.get(b.id) || 0) / (b.maximumChatStamina ?? 1));
            return wB - wA;
        });

        if (eligible.length === 0) break;

        let selectedSpeaker: Character | null = null;
        for (const participant of eligible) {
        if (Math.random() < (participant.chatProbability ?? 0.5)) {
            selectedSpeaker = participant;
            break;
        }
        const current = staminaMap.get(participant.id) || 0;
        const max = participant.maximumChatStamina ?? Number.POSITIVE_INFINITY;
        staminaMap.set(participant.id, Math.min(max, current + 1));
        }

        if (!selectedSpeaker) continue;

        if (onSpeakerChange) onSpeakerChange(selectedSpeaker);

        const tempDataForCall = { ...workingData, chatMessageHistory: [...workingData.chatMessageHistory] };
        
        const resultData = await executor(tempDataForCall, selectedSpeaker, abortController.signal, onTokenStream || (() => {}));

        // If resultData is null (e.g., empty text), stop the loop
        if (!resultData) break;

        const newMessage = resultData.chatMessageHistory[resultData.chatMessageHistory.length - 1];
        const currentChatStamina = staminaMap.get(selectedSpeaker.id) || 0;
        const newCurrentChatStamina = Math.max(0, currentChatStamina - 1);
        staminaMap.set(selectedSpeaker.id, newCurrentChatStamina);

        const messageWithNewCurrentChatStamina = { ...newMessage, remainingChatStamina: newCurrentChatStamina };

        workingData = {
        ...resultData,
        chatMessageHistory: [...resultData.chatMessageHistory.slice(0, -1), messageWithNewCurrentChatStamina]
        };

        hasActivity = true;

        // 🚀 SAVE AND NOTIFY IMMEDIATELY
        try {
        await saveRawChatData(workingData);
        if (onMessageSaved) {
            onMessageSaved(workingData);
        }
        } catch (err) {
        console.error("Failed to save intermediate message:", err);
        }
    }

    return { ...workingData, lastUpdatedTimestamp: Date.now() };
}