// src/services/ChatOrchestrator.ts
import type { Character, ChatData } from '../types';
import { getEffectiveInitiativeWeight, getEffectiveChatProbability } from '../hooks/characterLogic';
import { saveRawChatData } from '../hooks/storage';

type TurnExecutor = (data: ChatData, character: Character, signal: AbortSignal, onToken: (t: string) => void) => Promise<ChatData | null>

function getEffectiveNameSensitivity(character: Character, profile: ChatData['Profile']): number {
    const profileValue = profile?.nameSensitivity;
    if (profileValue === undefined || profileValue === -1) return character.nameSensitivity ?? 1;
    return profileValue;
}

function getEffectiveResponseDelayWeight(character: Character, profile: ChatData['Profile']): number {
    const profileValue = profile?.responseDelayWeight;
    if (profileValue === undefined || profileValue === -1) return character.responseDelayWeight ?? 0;
    return profileValue;
}

function getNameSensitivityMultiplier(character: Character, chatData: ChatData): number {
    const sensitivity = getEffectiveNameSensitivity(character, chatData.Profile);
    if (sensitivity === 0 || sensitivity === 1) return 1;

    const history = chatData.chatMessageHistory;
    if (history.length === 0) return 1;

    const latestMessage = history[history.length - 1];
    if (latestMessage.character.id === character.id) return 1;

    const nameLower = character.name.toLowerCase();
    const textLower = latestMessage.textContent.toLowerCase();

    let mentionCount = 0;
    let searchIndex = 0;
    while (true) {
        const foundIndex = textLower.indexOf(nameLower, searchIndex);
        if (foundIndex === -1) break;
        mentionCount++;
        searchIndex = foundIndex + nameLower.length;
    }

    if (mentionCount === 0) return 1;

    return mentionCount * sensitivity;
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

    const lastMsgBeforeSequence = workingData.chatMessageHistory.length > 0
        ? workingData.chatMessageHistory[workingData.chatMessageHistory.length - 1]
        : null;
    let lastSpeakerId: string | null = lastMsgBeforeSequence?.character.id ?? null;

    const spokenThisSequence = new Set<string>();

    while (!abortController.signal.aborted) {

        const allAI = workingData.participants.filter(p => p.id !== workingData.protagonist.id);
        const eligible = allAI.filter(p => p.id !== lastSpeakerId && !spokenThisSequence.has(p.id));

        if (eligible.length === 0) break;

        // ✅ Pick one speaker by initiative weight × name sensitivity
        let selectedSpeaker: Character | null;

        if (eligible.length === 1) {
            selectedSpeaker = eligible[0];
        } else {
            const initPool: { char: Character; weight: number }[] = [];
            let totalWeight = 0;
            for (const p of eligible) {
                const baseWeight = getEffectiveInitiativeWeight(p, profile);
                const nameMultiplier = getNameSensitivityMultiplier(p, workingData);
                const w = baseWeight * nameMultiplier;
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
            spokenThisSequence.add(selectedSpeaker.id);
            continue;
        }

        // ✅ Response delay gate: higher weight = more likely to skip this turn
        const delayWeight = getEffectiveResponseDelayWeight(selectedSpeaker, profile);
        if (delayWeight > 0 && Math.random() < delayWeight) {
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