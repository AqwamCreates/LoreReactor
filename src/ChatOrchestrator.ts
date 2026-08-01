// src/services/ChatOrchestrator.ts
import type { Character, ChatData } from './types';
import { findPreviousChatMessage } from './chatLogic';

type TurnExecutor = (data: ChatData, character: Character, signal: AbortSignal, onToken: (t: string) => void) => Promise<ChatData | null>

export async function runTurnSequence(
    chatData: ChatData,
    executor: TurnExecutor,
    abortController: AbortController,
    onSpeakerChange?: (char: Character | null) => void,
    onTokenStream?: (text: string) => void
    ): Promise<ChatData> {
    
    let workingData = { ...chatData, chatMessageHistory: [...chatData.chatMessageHistory] };
    let hasActivity = true;

    // Track stamina locally to avoid mutating history during calculation
    const staminaMap = new Map<string, number>();
    for (const p of workingData.participants) {
        if (p.id === workingData.protagonist.id) continue;
        const prev = findPreviousChatMessage(workingData, p.id);
        staminaMap.set(p.id, prev?.remainingChatStamina ?? (p.maximumChatStamina ?? Number.POSITIVE_INFINITY));
    }

    while (hasActivity && !abortController.signal.aborted) {
        hasActivity = false;

        // Recharge tired NPCs
        for (const p of workingData.participants) {
            if (p.id === workingData.protagonist.id) continue;
            const current = staminaMap.get(p.id) || 0;
            const maximumChatStamina = p.maximumChatStamina ?? Number.POSITIVE_INFINITY;
            if (current <= 0) {
                staminaMap.set(p.id, Math.min(maximumChatStamina, current + 1));
            }
        }

        // Sort Eligible Speakers
        const eligible = workingData.participants
        .filter(p => p.id !== workingData.protagonist.id && (staminaMap.get(p.id) || 0) > 0)
        .sort((a, b) => {
            const wA = (a.initiativeWeight ?? 1) * ((staminaMap.get(a.id) || 0) / (a.maximumChatStamina ?? 1));
            const wB = (b.initiativeWeight ?? 1) * ((staminaMap.get(b.id) || 0) / (b.maximumChatStamina ?? 1));
            return wB - wA;
        });

        if (eligible.length === 0) break;

        // Pick Speaker
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

        if (!resultData || abortController.signal.aborted) break;

        // Update State
        const newMessage = resultData.chatMessageHistory[resultData.chatMessageHistory.length - 1];
        const currentStamina = staminaMap.get(selectedSpeaker.id) || 0;
        const newStamina = Math.max(0, currentStamina - 1);
        staminaMap.set(selectedSpeaker.id, newStamina);

        const messageWithStamina = { ...newMessage, remainingChatStamina: newStamina };

        workingData = {
        ...resultData,
        chatMessageHistory: [...resultData.chatMessageHistory.slice(0, -1), messageWithStamina]
        };

        hasActivity = true;
    }

    return { ...workingData, last_updated_timestamp: Date.now() };
}