// src/services/ChatOrchestrator.ts
import type { Character, ChatData } from '../types';
import { getEffectiveInitiativeWeight, getEffectiveChatProbability } from '../hooks/chatLogic';
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
    
    const profile = currentChatData.Profile;
    let workingData = { ...currentChatData, chatMessageHistory: [...currentChatData.chatMessageHistory] };

    // ✅ Determine who spoke last (before this sequence started)
    const lastMsgBeforeSequence = workingData.chatMessageHistory.length > 0
        ? workingData.chatMessageHistory[workingData.chatMessageHistory.length - 1]
        : null;
    let lastSpeakerId: string | null = lastMsgBeforeSequence?.character.id ?? null;

    // ✅ Track which AIs have already spoken this sequence
    const spokenThisSequence = new Set<string>();

    // ✅ Multi-turn loop
    const maxTurnsPerSequence = 10;
    let turnCount = 0;

    while (!abortController.signal.aborted && turnCount < maxTurnsPerSequence) {
        turnCount++;

        // ✅ Get eligible AIs: exclude protagonist, last speaker, and anyone who already spoke
        const allAI = workingData.participants.filter(p => p.id !== workingData.protagonist.id);
        const eligible = allAI.filter(p => p.id !== lastSpeakerId && !spokenThisSequence.has(p.id));

        if (eligible.length === 0) break;

        // ✅ Pick one speaker by initiative weight
        let selectedSpeaker: Character | null = null;

        if (eligible.length === 1) {
            selectedSpeaker = eligible[0];
        } else {
            const initPool: { char: Character; weight: number }[] = [];
            let totalWeight = 0;
            for (const p of eligible) {
                const w = getEffectiveInitiativeWeight(p, profile);
                if (w > 0) {
                    initPool.push({ char: p, weight: w });
                    totalWeight += w;
                }
            }

            if (initPool.length === 0 || totalWeight <= 0) {
                selectedSpeaker = eligible[0];
            } else {
                let roll = Math.random() * totalWeight;
                selectedSpeaker = initPool[initPool.length - 1].char;
                for (const entry of initPool) {
                    roll -= entry.weight;
                    if (roll <= 0) {
                        selectedSpeaker = entry.char;
                        break;
                    }
                }
            }
        }

        if (!selectedSpeaker) break;

        // ✅ Probability gate: does this character want to speak?
        const effectiveProb = getEffectiveChatProbability(selectedSpeaker, profile);
        if (Math.random() >= effectiveProb) {
            // Character stays quiet — mark as spoken so we don't pick them again
            // but don't generate a message
            spokenThisSequence.add(selectedSpeaker.id);
            continue;
        }

        // ✅ Character speaks
        if (onSpeakerChange) onSpeakerChange(selectedSpeaker);

        const resultData = await executor(
            workingData, 
            selectedSpeaker, 
            abortController.signal, 
            onTokenStream || (() => {})
        );

        if (!resultData) break;

        workingData = resultData;
        lastSpeakerId = selectedSpeaker.id;
        spokenThisSequence.add(selectedSpeaker.id);

        try {
            await saveRawChatData(workingData);
            if (onMessageSaved) {
                onMessageSaved(workingData);
            }
        } catch (err) {
            console.error("Failed to save intermediate message:", err);
        }
    }

    return workingData;
}