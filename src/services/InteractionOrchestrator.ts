// src/services/InteractionOrchestrator.ts
import type { Character, InteractionData, Location, InteractionMessage } from '../types';
import { getEffectiveInitiativeWeight, getEffectiveChatProbability, getNameSensitivityMultiplier, getEffectiveSkipProbability, getEffectiveMaximumChatStamina, generateChatStamina, consumeChatStamina } from '../hooks/characterLogic';
import { sampleLocationByWeight, getCurrentLocationIndex, findLocationByRegex } from '../hooks/locationLogic';
import { saveRawInteractionData } from '../hooks/storage';
import { v4 as uuidv4 } from 'uuid';

type TurnExecutor = (data: InteractionData, character: Character, signal: AbortSignal, onToken: (t: string) => void) => Promise<InteractionData | null>

/**
 * Check if an InteractionMessage has text content (is a spoken message).
 */
function hasTextContent(msg: InteractionMessage): boolean {
    return 'textContent' in msg && typeof (msg as any).textContent === 'string';
}

/**
 * Get the last InteractionMessage for a character from interactionHistory.
 */
function getLastInteractionForCharacter(history: InteractionMessage[], characterId: string): InteractionMessage | undefined {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].character.id === characterId) return history[i];
    }
    return undefined;
}

/**
 * Count paragraphs in text. Returns 0 for empty/whitespace-only text.
 */
function countParagraphs(text: string): number {
    if (!text || !text.trim()) return 0;
    return (text.match(/\n\n/g) || []).length + 1;
}

/**
 * Regenerate stamina for a character based on their previous interaction.
 * Mutates the interactionHistory in place by updating the character's last entry.
 */
function regenerateStaminaForCharacter(data: InteractionData, character: Character): void {
    const maxStamina = getEffectiveMaximumChatStamina(character, data.Profile);
    if (maxStamina === Number.POSITIVE_INFINITY) return;

    for (let i = data.interactionHistory.length - 1; i >= 0; i--) {
        if (data.interactionHistory[i].character.id === character.id) {
            const entry = data.interactionHistory[i];
            if (entry.remainingChatStamina === undefined) return;
            if (entry.remainingChatStamina >= maxStamina) return;
            generateChatStamina(character, entry);
            return;
        }
    }
}

/**
 * Create a silent InteractionMessage (no text) to record location/state changes
 * for non-speaking characters.
 */
function createSilentInteraction(
    character: Character,
    locationIndex: number | undefined,
    previousStamina: number | undefined,
    parentId: string | null | undefined,
): InteractionMessage {
    const now = Date.now();
    return {
        id: uuidv4(),
        character: { ...character },
        remainingChatStamina: previousStamina,
        locationIndex,
        parentInteractionMessageId: parentId ?? null,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

export async function runTurnSequence(
    currentInteractionData: InteractionData,
    executor: TurnExecutor,
    abortController: AbortController,
    onSpeakerChange?: (char: Character | null) => void,
    onTokenStream?: (text: string) => void,
    onMessageSaved?: (data: InteractionData) => void
): Promise<InteractionData> {
    
    const profile = currentInteractionData.Profile;
    let workingData = { ...currentInteractionData, interactionHistory: [...currentInteractionData.interactionHistory] };

    const lastEntry = workingData.interactionHistory.length > 0
        ? workingData.interactionHistory[workingData.interactionHistory.length - 1]
        : null;
    let lastSpeakerId: string | null = lastEntry && hasTextContent(lastEntry)
        ? lastEntry.character.id
        : null;

    const spokenThisSequence = new Set<string>();

    while (!abortController.signal.aborted) {

        const allAI = workingData.participants.filter(p => p.id !== workingData.protagonist.id);
        
        const protagonistLoc = getCurrentLocationIndex(workingData, workingData.protagonist);
        const hasLocations = workingData.locations && workingData.locations.length > 0;

        // ✅ Non-co-located AI participants roll location in initiative-weighted order
        if (hasLocations) {
            const lastParentId = workingData.interactionHistory.length > 0
                ? workingData.interactionHistory[workingData.interactionHistory.length - 1].id
                : null;

            // Collect non-co-located characters who haven't been processed
            const nonCoLocated = allAI.filter(p => {
                if (spokenThisSequence.has(p.id)) return false;
                const pLoc = getCurrentLocationIndex(workingData, p);
                return pLoc !== undefined && protagonistLoc !== undefined && pLoc !== protagonistLoc;
            });

            // Process them one at a time in weighted-random order
            const remaining = [...nonCoLocated];
            while (remaining.length > 0) {
                // Build weight pool from initiativeWeight only
                const pool: { char: Character; weight: number }[] = [];
                let totalWeight = 0;
                for (const p of remaining) {
                    const w = getEffectiveInitiativeWeight(p, profile);
                    if (w > 0) {
                        pool.push({ char: p, weight: w });
                        totalWeight += w;
                    }
                }

                if (pool.length === 0 || totalWeight <= 0) break;

                // Weighted random pick
                let roll = Math.random() * totalWeight;
                let picked: Character | null = null;
                for (const entry of pool) {
                    roll -= entry.weight;
                    if (roll <= 0) { picked = entry.char; break; }
                }
                if (!picked) picked = pool[pool.length - 1].char;

                // ✅ Skip probability gate — character may skip moving this turn
                const effectiveSkip = getEffectiveSkipProbability(picked, profile);
                if (effectiveSkip > 0 && Math.random() < effectiveSkip) {
                    const idx = remaining.indexOf(picked);
                    if (idx !== -1) remaining.splice(idx, 1);
                    continue;
                }

                // ✅ Regenerate stamina before recording movement
                regenerateStaminaForCharacter(workingData, picked);

                // Roll their location
                const pLoc = getCurrentLocationIndex(workingData, picked);
                const newLoc = sampleLocationByWeight(workingData.locations, picked);
                if (newLoc !== undefined && newLoc !== pLoc) {
                    const prevStamina = getLastInteractionForCharacter(workingData.interactionHistory, picked.id)?.remainingChatStamina;
                    const silent = createSilentInteraction(picked, newLoc, prevStamina, lastParentId);
                    workingData.interactionHistory.push(silent);
                }

                // Remove from remaining
                const idx = remaining.indexOf(picked);
                if (idx !== -1) remaining.splice(idx, 1);
            }
        }

        // ✅ Eligible speakers: co-located AI who haven't spoken this sequence
        const eligible = allAI.filter(p => {
            if (p.id === lastSpeakerId) return false;
            if (spokenThisSequence.has(p.id)) return false;
            if (!hasLocations || protagonistLoc === undefined) return true;
            const pLoc = getCurrentLocationIndex(workingData, p);
            return pLoc !== undefined && pLoc === protagonistLoc;
        });

        if (eligible.length === 0) break;

        // ✅ Pick speaker by initiative weight × name sensitivity
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

        regenerateStaminaForCharacter(workingData, selectedSpeaker);

        // ✅ Chat probability gate — does this character want to speak?
        const effectiveProb = getEffectiveChatProbability(selectedSpeaker, profile);
        if (Math.random() >= effectiveProb) {
            spokenThisSequence.add(selectedSpeaker.id);
            continue;
        }

        // ✅ Skip probability gate — does this character skip speaking even when willing?
        const effectiveSkip = getEffectiveSkipProbability(selectedSpeaker, profile);
        if (effectiveSkip > 0 && Math.random() < effectiveSkip) {
            spokenThisSequence.add(selectedSpeaker.id);
            continue;
        }

        // ✅ Character speaks — co-located
        if (onSpeakerChange) onSpeakerChange(selectedSpeaker);

        const resultData = await executor(
            workingData, 
            selectedSpeaker, 
            abortController.signal, 
            onTokenStream || (() => {})
        );

        if (!resultData) break;

        // ✅ Post-speech processing: consume stamina and resolve location
        const newLastEntry = resultData.interactionHistory[resultData.interactionHistory.length - 1];
        if (newLastEntry && newLastEntry.character.id === selectedSpeaker.id && hasTextContent(newLastEntry)) {
            // Consume stamina based on paragraph count
            const paragraphs = countParagraphs((newLastEntry as any).textContent);
            if (paragraphs > 0) {
                consumeChatStamina(newLastEntry, paragraphs);
            }

            // ✅ Resolve location: regex match moves character, otherwise stay at current location
            if (hasLocations) {
                const currentLoc = getCurrentLocationIndex(workingData, selectedSpeaker);
                const regexLoc = findLocationByRegex(workingData.locations, (newLastEntry as any).textContent, selectedSpeaker);
                const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                resultData.interactionHistory[resultData.interactionHistory.length - 1] = {
                    ...newLastEntry,
                    locationIndex: finalLoc,
                };
            }
        }

        workingData = resultData;
        lastSpeakerId = selectedSpeaker.id;
        spokenThisSequence.add(selectedSpeaker.id);

        try {
            await saveRawInteractionData(workingData);
            if (onMessageSaved) onMessageSaved(workingData);
        } catch (err) {
            console.error("Failed to save intermediate message:", err);
        }
    }

    return workingData;
}