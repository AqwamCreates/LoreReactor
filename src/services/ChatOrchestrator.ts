// src/services/ChatOrchestrator.ts
import type { Character, ChatData } from '../types';
import { findPreviousChatMessage, getEffectiveInitiativeWeight, getEffectiveChatProbability, getEffectiveMaxChatStamina } from '../hooks/chatLogic';
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
    onMessageSaved?: (data: ChatData) => void
): Promise<ChatData> {
    
    let workingData = { ...currentChatData, chatMessageHistory: [...currentChatData.chatMessageHistory] };
    let hasActivity = true;

    // ✅ Read profile for turn sequencing overrides
    const profile = workingData.Profile;

    const staminaMap = new Map<string, number>();
    for (const p of workingData.participants) {
        if (p.id === workingData.protagonist.id) continue;
        const prev = findPreviousChatMessage(workingData, p.id);
        // ✅ Use profile-overridden max stamina for initial stamina value
        const effectiveMax = getEffectiveMaxChatStamina(p, profile);
        staminaMap.set(p.id, prev?.remainingChatStamina ?? effectiveMax);
    }

    while (hasActivity && !abortController.signal.aborted) {
        hasActivity = false;

        // Stamina regeneration pass
        for (const p of workingData.participants) {
            if (p.id === workingData.protagonist.id) continue;
            const current = staminaMap.get(p.id) || 0;
            // ✅ Use profile-overridden max stamina for regen cap
            const max = getEffectiveMaxChatStamina(p, profile);
            if (current <= 0) {
                staminaMap.set(p.id, Math.min(max, current + 1));
            }
        }

        // ✅ Sort eligible participants using profile-overridden initiative weights
        const eligible = workingData.participants
            .filter(p => p.id !== workingData.protagonist.id && (staminaMap.get(p.id) || 0) > 0)
            .sort((a, b) => {
                const wA = getEffectiveInitiativeWeight(a, profile) * ((staminaMap.get(a.id) || 0) / (getEffectiveMaxChatStamina(a, profile) || 1));
                const wB = getEffectiveInitiativeWeight(b, profile) * ((staminaMap.get(b.id) || 0) / (getEffectiveMaxChatStamina(b, profile) || 1));
                return wB - wA;
            });

        if (eligible.length === 0) break;

        let selectedSpeaker: Character | null = null;
        for (const participant of eligible) {
            // ✅ Use profile-overridden chat probability
            const effectiveProb = getEffectiveChatProbability(participant, profile);
            if (Math.random() < effectiveProb) {
                selectedSpeaker = participant;
                break;
            }
            // Not selected — regenerate stamina using profile-overridden max
            const current = staminaMap.get(participant.id) || 0;
            const max = getEffectiveMaxChatStamina(participant, profile);
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