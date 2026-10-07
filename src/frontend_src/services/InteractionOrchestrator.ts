// frontend_src/services/InteractionOrchestrator.ts
import type { Character, InteractionData, HistoryMessage, InteractionMessage, ChatMessage, Location } from '../types';
import { getEffectiveChatProbability, consumeChatStaminaForMessage, consumeActionStaminaForMessage, generateActionStaminaForInteractionData, generateChatStaminaForInteractionData, getEffectiveChatImpatienceSensitivity } from '../utilities/characterLogic';
import { getCurrentLocationId, findLocationByRegularExpression, getReachableLocationsByCharacter, sampleReachableLocationByWeight, assignInitialLocationsIfNeeded } from '../utilities/locationLogic';
import { v4 as uuidv4 } from 'uuid';
import {
    countParagraphs,
    computeGlobalScore,
    computeChatScore,
    computeActionScore,
    weightedSample,
    computeModulatedStaminaRegenationAmounts,
    computeEffectiveSkip,
    computeChatStaminaConsumptionCost,
    computeMovementCost,
} from '../utilities/dynamicCharacterLogic';
import type { HandleServerResponseResult } from '../hooks/useChatEngine';

type TurnExecutor = (data: InteractionData, character: Character, signal: AbortSignal) => Promise<HandleServerResponseResult | null>;

export interface TurnSequenceOptions {
    singleTurn?: boolean; // When true (Autonomous mode), stops after 1 character acts/speaks
}

function hasTextContent(msg: HistoryMessage): msg is ChatMessage {
    return msg.messageType === 'chat';
}

function createSilentInteraction(
    character: Character,
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
        characterClothingWearingStatuses: clothingWearingStatuses,
        characterLockedLocations: { ...lockedLocations },
        parentMessageId: parentId ?? null,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

/** Check if a character is co-located with any protagonist */
function isCoLocatedWithAnyProtagonist(
    data: InteractionData,
    characterId: string,
    protagonistLocIds: Set<string>,
    hasLocations: boolean,
): boolean {
    if (!hasLocations || protagonistLocIds.size === 0) return true;
    const charLoc = getCurrentLocationId(data, { id: characterId } as Character);
    return charLoc !== undefined && protagonistLocIds.has(charLoc);
}

export async function runTurnSequence(
    currentInteractionData: InteractionData,
    executor: TurnExecutor,
    abortController: AbortController,
    onSpeakerChange?: (char: Character | null) => void,
    onIntermediateData?: (data: InteractionData) => void,
    options?: TurnSequenceOptions
): Promise<{ interactionData: InteractionData; isCompleted: boolean } | null> {

    const emitIntermediateData = (data: InteractionData) => {
        // Drop intermediate state emissions immediately if aborted
        if (!onIntermediateData || abortController.signal.aborted) return;
        const newHistories: Record<string, HistoryMessage[]> = {};
        for (const [locId, msgs] of Object.entries(data.interactionHistories || {})) {
            newHistories[locId] = [...msgs];
        }
        onIntermediateData({
            ...data,
            interactionHistories: newHistories,
        });
    };

    const profile = currentInteractionData.profile;
    
    const initialHistories: Record<string, HistoryMessage[]> = {};
    for (const [locId, msgs] of Object.entries(currentInteractionData.interactionHistories || {})) {
        initialHistories[locId] = [...msgs];
    }
    let workingData: InteractionData = { 
        ...currentInteractionData, 
        interactionHistories: initialHistories 
    };

    workingData = assignInitialLocationsIfNeeded(workingData);

    const allMessages = Object.values(workingData.interactionHistories || {}).flat().sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
    const lastChatEntry = [...allMessages].reverse().find(m => hasTextContent(m));
    const triggeringMessageText = lastChatEntry && hasTextContent(lastChatEntry) ? (lastChatEntry as ChatMessage).textContent : undefined;

    const spokenThisSequence = new Set<string>();
    const actedThisSequence = new Set<string>();
    let sequenceCompleted = true;

    while (!abortController.signal.aborted) {
        const protagonistIds = new Set(workingData.protagonistIds || []);
        const allAI = workingData.participants.filter(p => !protagonistIds.has(p.id));

        const hasLocations = workingData.locations && workingData.locations.length > 0;
        const protagonistLocIds = new Set<string>();
        if (hasLocations) {
            for (const pId of (workingData.protagonistIds || [])) {
                const p = workingData.participants.find(part => part.id === pId);
                if (p) {
                    const locId = getCurrentLocationId(workingData, p);
                    if (locId !== undefined) protagonistLocIds.add(locId);
                }
            }
        }

        const remaining = allAI.filter(p => !spokenThisSequence.has(p.id) && !actedThisSequence.has(p.id));
        if (remaining.length === 0) break;

        const chatRefusedThisIteration = new Set<string>();

        for (const char of remaining) {
            const { chatRegen, actionRegen } = computeModulatedStaminaRegenationAmounts(char, workingData);
            if (chatRegen > 0) generateChatStaminaForInteractionData(workingData, chatRegen, char);
            if (actionRegen > 0) generateActionStaminaForInteractionData(workingData, actionRegen, char);
        }

        const globalPool: { item: Character; weight: number }[] = [];
        for (const char of remaining) {
            if (chatRefusedThisIteration.has(char.id)) continue;
            const score = computeGlobalScore(char, workingData);
            if (score > 0) globalPool.push({ item: char, weight: score });
        }

        const globalWinner = weightedSample(globalPool);
        if (!globalWinner) break;

        const effectiveSkip = computeEffectiveSkip(globalWinner, workingData, triggeringMessageText);
        if (Math.random() < effectiveSkip) {
            actedThisSequence.add(globalWinner.id);
            if (options?.singleTurn) break;
            continue;
        }

        const winnerCoLocated = isCoLocatedWithAnyProtagonist(workingData, globalWinner.id, protagonistLocIds, !!hasLocations);

        if (winnerCoLocated) {
            const chatEligible = remaining.filter(p => {
                if (spokenThisSequence.has(p.id)) return false;
                if (chatRefusedThisIteration.has(p.id)) return false;
                return isCoLocatedWithAnyProtagonist(workingData, p.id, protagonistLocIds, !!hasLocations);
            });

            if (chatEligible.length === 0) {
                actedThisSequence.add(globalWinner.id);
                if (options?.singleTurn) break;
                continue;
            }

            const chatPool: { item: Character; weight: number }[] = [];
            for (const char of chatEligible) {
                const score = computeChatScore(char, workingData);
                if (score > 0) chatPool.push({ item: char, weight: score });
            }

            const speaker = weightedSample(chatPool);
            if (!speaker) {
                actedThisSequence.add(globalWinner.id);
                if (options?.singleTurn) break;
                continue;
            }

            const chatProb = getEffectiveChatProbability(speaker, profile);
            if (chatProb < 1 && Math.random() >= chatProb) {
                chatRefusedThisIteration.add(speaker.id);
                if (options?.singleTurn) break;
                continue;
            }

            if (onSpeakerChange) onSpeakerChange(speaker);

            const result = await executor(workingData, speaker, abortController.signal);

            if (!result) {
                sequenceCompleted = false;
                break;
            }

            if (!result.isCompleted) {
                sequenceCompleted = false;
            }

            const resultData = result.interactionData;
            const allResultMessages = Object.values(resultData.interactionHistories || {}).flat().sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
            const newLastEntry = allResultMessages.length > 0 ? allResultMessages[allResultMessages.length - 1] : undefined;
            
            if (newLastEntry && newLastEntry.character.id === speaker.id && hasTextContent(newLastEntry)) {
                const paragraphs = countParagraphs((newLastEntry as ChatMessage).textContent);
                const chatCost = computeChatStaminaConsumptionCost(speaker, resultData, paragraphs);
                
                if (chatCost > 0) {
                    for (const msgs of Object.values(resultData.interactionHistories || {})) {
                        const idx = msgs.findIndex(m => m.id === newLastEntry.id);
                        if (idx !== -1) {
                            consumeChatStaminaForMessage(msgs[idx], chatCost);
                            break;
                        }
                    }
                }

                if (hasLocations) {
                    const currentLocId = getCurrentLocationId(resultData, speaker);
                    const regexLoc = findLocationByRegularExpression(resultData.locations, (newLastEntry as ChatMessage).textContent, speaker);
                    const finalLoc = regexLoc !== undefined ? regexLoc : (currentLocId ? resultData.locations.find(l => l.id === currentLocId) : undefined);

                    if (regexLoc && currentLocId && regexLoc.id !== currentLocId) {
                        const movementCost = computeMovementCost(currentLocId, regexLoc.id, resultData.locations);
                        for (const msgs of Object.values(resultData.interactionHistories || {})) {
                            const idx = msgs.findIndex(m => m.id === newLastEntry.id);
                            if (idx !== -1) {
                                consumeActionStaminaForMessage(msgs[idx], movementCost);
                                break;
                            }
                        }
                    }

                    const targetLocationId = finalLoc ? finalLoc.id : currentLocId;
                    if (targetLocationId) {
                        for (const [locId, msgs] of Object.entries(resultData.interactionHistories || {})) {
                            const idx = msgs.findIndex(m => m.id === newLastEntry.id);
                            if (idx !== -1) {
                                if (locId !== targetLocationId) {
                                    const msg = msgs.splice(idx, 1)[0];
                                    if (!resultData.interactionHistories[targetLocationId]) {
                                        resultData.interactionHistories[targetLocationId] = [];
                                    }
                                    resultData.interactionHistories[targetLocationId].push(msg);
                                }
                                break;
                            }
                        }
                    }
                }
            }

            workingData = resultData;
            spokenThisSequence.add(speaker.id);
            emitIntermediateData(workingData);

            if (options?.singleTurn) {
                break;
            }

            if (!sequenceCompleted) break;
        } else {
            // Action/Movement branch for characters NOT with any protagonist
            const actionEligible = remaining.filter(p => {
                if (actedThisSequence.has(p.id)) return false;
                return !isCoLocatedWithAnyProtagonist(workingData, p.id, protagonistLocIds, !!hasLocations);
            });

            const actionPool: { item: Character; weight: number }[] = [];
            for (const char of actionEligible) {
                const score = computeActionScore(char, workingData, triggeringMessageText);
                if (score > 0) actionPool.push({ item: char, weight: score });
            }

            const mover = weightedSample(actionPool);
            if (!mover) {
                actedThisSequence.add(globalWinner.id);
                if (options?.singleTurn) break;
                continue;
            }

            const actionEffectiveSkip = computeEffectiveSkip(mover, workingData, triggeringMessageText);
            if (Math.random() < actionEffectiveSkip) {
                actedThisSequence.add(mover.id);
                if (options?.singleTurn) break;
                continue;
            }

            const moverLocId = getCurrentLocationId(workingData, mover);
            const coLocatedOthers = hasLocations && moverLocId !== undefined
                ? allAI.filter(p => p.id !== mover.id && getCurrentLocationId(workingData, p) === moverLocId)
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
                    if (options?.singleTurn) break;
                    continue;
                }

                const leavingSkip = computeEffectiveSkip(mover, workingData, triggeringMessageText);
                if (Math.random() < leavingSkip) {
                    actedThisSequence.add(mover.id);
                    if (options?.singleTurn) break;
                    continue;
                }
            }

            const allWorkingMsgs = Object.values(workingData.interactionHistories || {}).flat().sort((a, b) => b.firstCreatedTimestamp - a.firstCreatedTimestamp);
            const previousMessage = allWorkingMsgs.find(m => m.character.id === mover.id);
            
            const prevChatStamina = previousMessage?.remainingChatStamina;
            const prevActionStamina = previousMessage?.remainingActionStamina;
            const prevClothingStatuses = (previousMessage as ChatMessage)?.characterClothingWearingStatuses ?? {};
            const prevLockedLocations = previousMessage?.characterLockedLocations ?? {};

            const reachable = getReachableLocationsByCharacter(workingData, mover, triggeringMessageText);
            const newLoc: Location | undefined = sampleReachableLocationByWeight(reachable, mover);

            if (newLoc !== undefined && moverLocId && newLoc.id !== moverLocId) {
                const currentLocExists = workingData.locations.some(l => l.id === moverLocId);
                const newLocExists = workingData.locations.some(l => l.id === newLoc.id);
                
                let totalActionCost = 0;
                if (currentLocExists && newLocExists) {
                    totalActionCost = computeMovementCost(moverLocId, newLoc.id, workingData.locations);
                }

                let postRegenMsg: HistoryMessage | undefined = undefined;
                if (previousMessage) {
                    for (const msgs of Object.values(workingData.interactionHistories || {})) {
                        const idx = msgs.findIndex(m => m.id === previousMessage!.id);
                        if (idx !== -1) {
                            postRegenMsg = msgs[idx];
                            if (postRegenMsg.remainingActionStamina !== undefined) {
                                consumeActionStaminaForMessage(postRegenMsg, totalActionCost);
                            }
                            break;
                        }
                    }
                }

                const flatSortedMsgs = Object.values(workingData.interactionHistories || {}).flat().sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
                const lastParentId = flatSortedMsgs.length > 0 ? flatSortedMsgs[flatSortedMsgs.length - 1].id : null;

                const silent = createSilentInteraction(
                    mover,
                    prevChatStamina,
                    postRegenMsg?.remainingActionStamina ?? prevActionStamina,
                    prevClothingStatuses,
                    prevLockedLocations,
                    lastParentId,
                );

                if (!workingData.interactionHistories[newLoc.id]) {
                    workingData.interactionHistories[newLoc.id] = [];
                }
                workingData.interactionHistories[newLoc.id].push(silent);
            }

            actedThisSequence.add(mover.id);
            emitIntermediateData(workingData);

            if (options?.singleTurn) {
                break;
            }
        }
    }

    return { interactionData: workingData, isCompleted: sequenceCompleted };
}