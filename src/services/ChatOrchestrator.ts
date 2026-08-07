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
        const effectiveMax = getEffectiveMaxChatStamina(p, profile);
        // ✅ Cap stored stamina to effective max so profile overrides take effect immediately
        const storedStamina = prev?.remainingChatStamina ?? effectiveMax;
        staminaMap.set(p.id, Math.min(storedStamina, effectiveMax));
    }

    while (hasActivity && !abortController.signal.aborted) {
        hasActivity = false;

        // Stamina regeneration pass
        for (const p of workingData.participants) {
            if (p.id === workingData.protagonist.id) continue;
            const current = staminaMap.get(p.id) || 0;
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

        // ✅ FIXED: Use weighted random selection instead of sequential probability check.
        // The old approach had a chance of selecting NO speaker when all probability rolls failed,
        // causing silent generation failures that required double-clicking.
        let selectedSpeaker: Character | null = null;

        // Build weighted pool: weight = initiativeWeight * (currentStamina / maxStamina) * chatProbability
        const weightedPool: { char: Character; weight: number }[] = [];
        let totalWeight = 0;

        for (const participant of eligible) {
            const effectiveProb = getEffectiveChatProbability(participant, profile);
            if (effectiveProb <= 0) continue; // Skip characters with 0 probability

            const initWeight = getEffectiveInitiativeWeight(participant, profile);
            const currentStamina = staminaMap.get(participant.id) || 0;
            const maxStamina = getEffectiveMaxChatStamina(participant, profile);
            const staminaRatio = maxStamina > 0 ? currentStamina / maxStamina : 1;

            const weight = initWeight * staminaRatio * effectiveProb;
            if (weight > 0) {
                weightedPool.push({ char: participant, weight });
                totalWeight += weight;
            }
        }

        if (weightedPool.length === 0 || totalWeight <= 0) {
            // No valid speakers — fall back to highest-weighted eligible participant
            selectedSpeaker = eligible[0] || null;
        } else {
            // Weighted random selection — GUARANTEES a speaker is chosen
            let roll = Math.random() * totalWeight;
            for (const entry of weightedPool) {
                roll -= entry.weight;
                if (roll <= 0) {
                    selectedSpeaker = entry.char;
                    break;
                }
            }
            // Fallback for floating point edge cases
            if (!selectedSpeaker) selectedSpeaker = weightedPool[weightedPool.length - 1].char;
        }

        if (!selectedSpeaker) break;

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