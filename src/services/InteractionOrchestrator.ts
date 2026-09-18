// src/services/InteractionOrchestrator.ts
import type { Character, InteractionData, HistoryMessage, InteractionMessage, ChatMessage } from '../types';
import { getEffectiveChatProbability, consumeChatStaminaForMessage, consumeActionStaminaForMessage, generateActionStaminaForInteractionData, generateChatStaminaForInteractionData, getEffectiveChatImpatienceSensitivity } from '../hooks/characterLogic';
import { getCurrentLocationIndex, findLocationByRegex, getReachableLocationsByCharacter, sampleReachableLocationByWeight, assignInitialLocationsIfNeeded } from '../hooks/locationLogic';
import { saveRawInteractionData } from '../storage/serverStorage';
import { v4 as uuidv4 } from 'uuid';
import {
    countParagraphs,
    computeGlobalScore,
    computeChatScore,
    computeActionScore,
    weightedSample,
    computeModulatedRegenAmounts,
    computeEffectiveSkip,
    computeChatStaminaConsumptionCost,
    computeMovementCost,
} from '../hooks/dynamicCharacterLogic';
import { findPreviousMessage } from '../hooks/chatLogic';
import type { HandleServerResponseResult } from '../hooks/useChatEngine';

type TurnExecutor = (data: InteractionData, character: Character, signal: AbortSignal, onToken: (t: string) => void) => Promise<HandleServerResponseResult | null>

function hasTextContent(msg: HistoryMessage): msg is ChatMessage {
    return msg.messageType === 'chat';
}

function createSilentInteraction(
    character: Character,
    locationIndex: number | undefined,
    previousChatStamina: number | undefined,
    previousActionStamina: number | undefined,
    clothingWearingStatuses: Record<string, boolean>,
    lockedLocations: Record<string, string[]>,
    parentId: string | null | undefined,
): InteractionMessage {
    const now = Date.now();
    return {
        messageType: 'interaction',
        id: uuidv4(),
        character: { ...character },
        remainingChatStamina: previousChatStamina,
        remainingActionStamina: previousActionStamina,
        locationIndex,
        characterClothingWearingStatuses: clothingWearingStatuses,
        characterLockedLocations: { ...lockedLocations },
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
): Promise<{ interactionData: InteractionData; isCompleted: boolean } | null> {

    const profile = currentInteractionData.Profile;
    let workingData = { ...currentInteractionData, interactionHistory: [...currentInteractionData.interactionHistory] };

    workingData = assignInitialLocationsIfNeeded(workingData);

    const lastChatEntry = [...workingData.interactionHistory].reverse().find(m => hasTextContent(m));
    const triggeringMessageText = lastChatEntry && hasTextContent(lastChatEntry) ? lastChatEntry.textContent : undefined;

    const spokenThisSequence = new Set<string>();
    const actedThisSequence = new Set<string>();
    let sequenceCompleted = true;

    while (!abortController.signal.aborted) {
        const allAI = workingData.participants.filter(p => p.id !== workingData.protagonist.id);
        const protagonistLoc = getCurrentLocationIndex(workingData, workingData.protagonist);
        const hasLocations = workingData.locations && workingData.locations.length > 0;

        const remaining = allAI.filter(p => !spokenThisSequence.has(p.id) && !actedThisSequence.has(p.id));
        if (remaining.length === 0) break;

        const chatRefusedThisIteration = new Set<string>();

        // ─── REGEN PHASE ───
        for (const char of remaining) {
            const { chatRegen, actionRegen } = computeModulatedRegenAmounts(char, workingData);
            if (chatRegen > 0) generateChatStaminaForInteractionData(workingData, chatRegen, char);
            if (actionRegen > 0) generateActionStaminaForInteractionData(workingData, actionRegen, char);
        }

        // ─── Global scoring ───
        const globalPool: { item: Character; weight: number }[] = [];
        for (const char of remaining) {
            if (chatRefusedThisIteration.has(char.id)) continue;
            const score = computeGlobalScore(char, workingData);
            if (score > 0) globalPool.push({ item: char, weight: score });
        }

        const globalWinner = weightedSample(globalPool);
        if (!globalWinner) break;

        // ─── Skip check ───
        const effectiveSkip = computeEffectiveSkip(globalWinner, workingData, triggeringMessageText);
        if (Math.random() < effectiveSkip) {
            actedThisSequence.add(globalWinner.id);
            continue;
        }

        // ─── Co-location determines category ───
        const winnerLoc = hasLocations ? getCurrentLocationIndex(workingData, globalWinner) : undefined;
        const isCoLocated = !hasLocations || (winnerLoc !== undefined && protagonistLoc !== undefined && winnerLoc === protagonistLoc);

        if (isCoLocated) {
            // ─── CHAT PATH ───
            const chatEligible = remaining.filter(p => {
                if (spokenThisSequence.has(p.id)) return false;
                if (chatRefusedThisIteration.has(p.id)) return false;
                const pLoc = hasLocations ? getCurrentLocationIndex(workingData, p) : undefined;
                return !hasLocations || (pLoc !== undefined && protagonistLoc !== undefined && pLoc === protagonistLoc);
            });

            if (chatEligible.length === 0) {
                actedThisSequence.add(globalWinner.id);
                continue;
            }

            let speaker: Character;
            if (chatEligible.length === 1) {
                speaker = chatEligible[0];
            } else {
                const chatPool: { item: Character; weight: number }[] = [];
                for (const char of chatEligible) {
                    const score = computeChatScore(char, workingData);
                    if (score > 0) chatPool.push({ item: char, weight: score });
                }
                speaker = weightedSample(chatPool) ?? chatEligible[0];
            }

            // Chat probability gate
            const chatProb = getEffectiveChatProbability(speaker, profile);
            if (chatProb < 1 && Math.random() >= chatProb) {
                chatRefusedThisIteration.add(speaker.id);
                continue;
            }

            if (onSpeakerChange) onSpeakerChange(speaker);

            const result = await executor(
                workingData,
                speaker,
                abortController.signal,
                onTokenStream || (() => {})
            );

            if (!result) {
                sequenceCompleted = false;
                break;
            }

            if (!result.isCompleted) {
                sequenceCompleted = false;
            }

            const resultData = result.interactionData;

            // Post-speech: consume stamina, resolve location
            const newLastEntry = resultData.interactionHistory[resultData.interactionHistory.length - 1];
            if (newLastEntry && newLastEntry.character.id === speaker.id && hasTextContent(newLastEntry)) {
                const paragraphs = countParagraphs(newLastEntry.textContent);
                const chatCost = computeChatStaminaConsumptionCost(speaker, resultData, paragraphs);
                if (chatCost > 0) consumeChatStaminaForMessage(newLastEntry, chatCost);

                if (hasLocations) {
                    const currentLoc = getCurrentLocationIndex(resultData, speaker);
                    const regexLoc = findLocationByRegex(resultData.locations, newLastEntry.textContent, speaker);
                    const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;

                    if (regexLoc !== undefined && regexLoc !== currentLoc) {
                        const movementCost = computeMovementCost(currentLoc!, regexLoc);
                        consumeActionStaminaForMessage(newLastEntry, movementCost);
                    }

                    resultData.interactionHistory[resultData.interactionHistory.length - 1] = {
                        ...newLastEntry,
                        locationIndex: finalLoc,
                    };
                }
            }

            workingData = resultData;
            spokenThisSequence.add(speaker.id);

            try {
                await saveRawInteractionData(workingData);
                if (onMessageSaved) onMessageSaved(workingData);
            } catch (error) {
                console.error("Failed to save intermediate message:", error);
            }

            // If the last generation was incomplete, stop the sequence so caller can auto-resume
            if (!sequenceCompleted) break;
        } else {
            // ─── ACTION PATH ───
            const actionEligible = remaining.filter(p => {
                if (actedThisSequence.has(p.id)) return false;
                const pLoc = hasLocations ? getCurrentLocationIndex(workingData, p) : undefined;
                return hasLocations && pLoc !== undefined && protagonistLoc !== undefined && pLoc !== protagonistLoc;
            });

            let mover: Character;
            if (actionEligible.length === 1) {
                mover = actionEligible[0];
            } else {
                const actionPool: { item: Character; weight: number }[] = [];
                for (const char of actionEligible) {
                    const score = computeActionScore(char, workingData, triggeringMessageText);
                    if (score > 0) actionPool.push({ item: char, weight: score });
                }
                mover = weightedSample(actionPool) ?? actionEligible[0];
            }

            const actionEffectiveSkip = computeEffectiveSkip(mover, workingData, triggeringMessageText);
            if (Math.random() < actionEffectiveSkip) {
                actedThisSequence.add(mover.id);
                continue;
            }

            const moverLoc = getCurrentLocationIndex(workingData, mover);
            const coLocatedOthers = hasLocations && moverLoc !== undefined
                ? allAI.filter(p => p.id !== mover.id && getCurrentLocationIndex(workingData, p) === moverLoc)
                : [];

            if (coLocatedOthers.length > 0) {
                const leaveGroup = [mover, ...coLocatedOthers];
                const leavePool: { item: Character; weight: number }[] = [];
                for (const char of leaveGroup) {
                    const impatience = getEffectiveChatImpatienceSensitivity(char, profile);
                    const leaveWeight = impatience > 0 ? 1 / impatience : Number.POSITIVE_INFINITY;
                    leavePool.push({ item: char, weight: leaveWeight });
                }

                const leaver = weightedSample(leavePool);
                if (!leaver || leaver.id !== mover.id) {
                    actedThisSequence.add(mover.id);
                    continue;
                }

                const leavingSkip = computeEffectiveSkip(mover, workingData, triggeringMessageText);
                if (Math.random() < leavingSkip) {
                    actedThisSequence.add(mover.id);
                    continue;
                }
            }

            const previousMessage = findPreviousMessage(workingData, mover.id);
            const prevChatStamina = previousMessage?.remainingChatStamina;
            const prevActionStamina = previousMessage?.remainingActionStamina;
            const prevClothingStatuses = (previousMessage as ChatMessage)?.characterClothingWearingStatuses ?? {};
            const prevLockedLocations = previousMessage?.characterLockedLocations ?? {};

            const reachable = getReachableLocationsByCharacter(workingData, mover, triggeringMessageText);
            const newLoc = sampleReachableLocationByWeight(reachable, mover);

            if (newLoc !== undefined && newLoc !== moverLoc) {
                const totalActionCost = computeMovementCost(moverLoc!, newLoc);

                const postRegenMsg = previousMessage;
                if (postRegenMsg && postRegenMsg.remainingActionStamina !== undefined) {
                    consumeActionStaminaForMessage(postRegenMsg, totalActionCost);
                }

                const lastParentId = workingData.interactionHistory.length > 0
                    ? workingData.interactionHistory[workingData.interactionHistory.length - 1].id
                    : null;

                const silent = createSilentInteraction(
                    mover,
                    newLoc,
                    prevChatStamina,
                    postRegenMsg?.remainingActionStamina ?? prevActionStamina,
                    prevClothingStatuses,
                    prevLockedLocations,
                    lastParentId,
                );
                workingData.interactionHistory.push(silent);
            }

            actedThisSequence.add(mover.id);

            try {
                await saveRawInteractionData(workingData);
                if (onMessageSaved) onMessageSaved(workingData);
            } catch (e) {
                console.error('Failed to save autonomous movement:', e);
            }
        }
    }

    return { interactionData: workingData, isCompleted: sequenceCompleted };
}