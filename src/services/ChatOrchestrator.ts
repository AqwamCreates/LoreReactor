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

    const profile = workingData.Profile;

    // ✅ Track the last speaker ID — updated after each successful generation
    let lastSpeakerId: string | null = workingData.chatMessageHistory.length > 0
        ? workingData.chatMessageHistory[workingData.chatMessageHistory.length - 1].character.id
        : null;

    // ✅ Determine if the sequence started with a user message
    const startedWithUser = lastSpeakerId === workingData.protagonist.id;

    // ✅ Track whether we've guaranteed at least one response after user input
    let hasGuaranteedResponse = false;

    // ✅ Stamina map: tracks current stamina for each AI participant
    const staminaMap = new Map<string, number>();

    for (const p of workingData.participants) {
        if (p.id === workingData.protagonist.id) continue;
        const prev = findPreviousChatMessage(workingData, p.id);
        const effectiveMax = getEffectiveMaxChatStamina(p, profile);
        const storedStamina = prev?.remainingChatStamina ?? effectiveMax;
        staminaMap.set(p.id, Math.min(storedStamina, effectiveMax));
    }

    // ✅ Safety counter to prevent infinite loops
    const maxTurnsPerSequence = 20;
    let turnCount = 0;

    while (hasActivity && !abortController.signal.aborted && turnCount < maxTurnsPerSequence) {
        hasActivity = false;
        turnCount++;

        // ✅ Stamina regeneration pass: only regens AIs that did NOT speak last turn
        for (const p of workingData.participants) {
            if (p.id === workingData.protagonist.id) continue;
            const current = staminaMap.get(p.id) || 0;
            const max = getEffectiveMaxChatStamina(p, profile);
            const wasLastSpeaker = lastSpeakerId === p.id;
            if (current < max && !wasLastSpeaker) {
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

        // ✅ Weighted random selection
        let selectedSpeaker: Character | null = null;

        const weightedPool: { char: Character; weight: number }[] = [];
        let totalWeight = 0;

        for (const participant of eligible) {
            const effectiveProb = getEffectiveChatProbability(participant, profile);
            if (effectiveProb <= 0) continue;

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
            selectedSpeaker = eligible[0] || null;
        } else {
            let roll = Math.random() * totalWeight;
            for (const entry of weightedPool) {
                roll -= entry.weight;
                if (roll <= 0) {
                    selectedSpeaker = entry.char;
                    break;
                }
            }
            if (!selectedSpeaker) selectedSpeaker = weightedPool[weightedPool.length - 1].char;
        }

        if (!selectedSpeaker) break;

        // ✅ Probability gate: should this character actually speak this turn?
        const effectiveProb = getEffectiveChatProbability(selectedSpeaker, profile);
        const isGuaranteedTurn = startedWithUser && !hasGuaranteedResponse;

        if (!isGuaranteedTurn && Math.random() >= effectiveProb) {
            // AI stays quiet this turn — zero stamina temporarily to try others
            const currentStamina = staminaMap.get(selectedSpeaker.id) || 0;
            staminaMap.set(selectedSpeaker.id, 0);

            const othersEligible = eligible.filter(p => p.id !== selectedSpeaker.id && (staminaMap.get(p.id) || 0) > 0);
            if (othersEligible.length === 0) {
                // No one else can speak — restore stamina and exit
                staminaMap.set(selectedSpeaker.id, currentStamina);
                break;
            }
            // Try another speaker next iteration
            hasActivity = true;
            continue;
        }

        if (isGuaranteedTurn) {
            hasGuaranteedResponse = true;
        }

        if (onSpeakerChange) onSpeakerChange(selectedSpeaker);

        const tempDataForCall = { ...workingData, chatMessageHistory: [...workingData.chatMessageHistory] };
        
        const resultData = await executor(tempDataForCall, selectedSpeaker, abortController.signal, onTokenStream || (() => {}));

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

        // ✅ CRITICAL: Update lastSpeakerId so regen pass knows who just spoke
        lastSpeakerId = selectedSpeaker.id;

        hasActivity = true;

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