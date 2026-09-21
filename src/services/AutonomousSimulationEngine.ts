// src/services/AutonomousSimulationEngine.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage, InteractionMessage } from '../types';
import { getEffectiveChatProbability, getEffectiveChatImpatienceSensitivity, generateChatStaminaForInteractionData, generateActionStaminaForInteractionData, consumeChatStaminaForMessage, consumeActionStaminaForMessage } from '../hooks/characterLogic';
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

type AutonomousExecutor = (data: InteractionData, character: Character, signal: AbortSignal) => Promise<HandleServerResponseResult | null>;

interface AutonomousConfig {
    tickIntervalMs: number;
    maxActionsPerTick: number;
}

const DEFAULT_CONFIG: AutonomousConfig = {
    tickIntervalMs: 10000,
    maxActionsPerTick: 3,
};

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

/** Check if a character is co-located with any protagonist */
function isCoLocatedWithAnyProtagonist(
    data: InteractionData,
    characterId: string,
    protagonistLocIndices: Set<number>,
    hasLocations: boolean,
): boolean {
    if (!hasLocations || protagonistLocIndices.size === 0) return true;
    const charLoc = getCurrentLocationIndex(data, { id: characterId } as Character);
    return charLoc !== undefined && protagonistLocIndices.has(charLoc);
}

export class AutonomousSimulationEngine {
    private timerId: ReturnType<typeof setInterval> | null = null;
    private abortController: AbortController | null = null;
    private config: AutonomousConfig;
    private executor: AutonomousExecutor | null = null;
    private isRunning = false;

    constructor(config?: Partial<AutonomousConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    start(
        executor: AutonomousExecutor,
        checkCanAct: () => boolean,
        getData: () => InteractionData | null,
        setData: (data: InteractionData) => void,
    ): void {
        if (this.isRunning) return;
        this.executor = executor;
        this.isRunning = true;
        this.abortController = new AbortController();

        this.timerId = setInterval(async () => {
            if (!this.isRunning) return;
            if (!checkCanAct()) return;

            const data = getData();
            if (!data || !data.Profile?.autonomousMode) return;

            try {
                await this.tick(data, setData, checkCanAct);
            } catch (e) {
                if ((e as Error).name !== 'AbortError') {
                    console.warn('Autonomous simulation tick failed:', e);
                }
            }
        }, this.config.tickIntervalMs);
    }

    stop(): void {
        this.isRunning = false;
        if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.executor = null;
    }

    getIsRunning(): boolean {
        return this.isRunning;
    }

    private async tick(
        currentData: InteractionData,
        setData: (data: InteractionData) => void,
        checkCanAct: () => boolean,
    ): Promise<void> {
        if (!this.executor || !this.abortController) return;

        let workingData = { ...currentData, interactionHistory: [...currentData.interactionHistory] };
        workingData = assignInitialLocationsIfNeeded(workingData);

        const profile = workingData.Profile;
        if (!profile) return;

        // Filter out all protagonists — only AI participants act autonomously
        const protagonistIds = new Set(workingData.protagonists.map(p => p.id));
        const allAI = workingData.participants.filter(p => !protagonistIds.has(p.id));
        if (allAI.length === 0) return;

        // Pre-compute protagonist location indices for co-location checks
        const hasLocations = workingData.locations && workingData.locations.length > 0;
        const protagonistLocIndices = new Set<number>();
        if (hasLocations) {
            for (const p of workingData.protagonists) {
                const locIdx = getCurrentLocationIndex(workingData, p);
                if (locIdx !== undefined) protagonistLocIndices.add(locIdx);
            }
        }

        const lastChatEntry = [...workingData.interactionHistory].reverse().find(m => hasTextContent(m));
        const triggeringMessageText = lastChatEntry && hasTextContent(lastChatEntry) ? (lastChatEntry as ChatMessage).textContent : undefined;

        const lastParentId = workingData.interactionHistory.length > 0
            ? workingData.interactionHistory[workingData.interactionHistory.length - 1].id
            : null;

        let actionsThisTick = 0;
        const processedThisTick = new Set<string>();

        while (actionsThisTick < this.config.maxActionsPerTick) {
            if (!this.isRunning || !checkCanAct()) break;
            if (this.abortController.signal.aborted) break;

            const remaining = allAI.filter(p => !processedThisTick.has(p.id));
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
                processedThisTick.add(globalWinner.id);
                continue;
            }

            // ─── Co-location check ───
            const winnerCoLocated = isCoLocatedWithAnyProtagonist(workingData, globalWinner.id, protagonistLocIndices, !!hasLocations);

            if (winnerCoLocated) {
                // ─── CHAT PATH ───
                const chatEligible = remaining.filter(p => {
                    if (chatRefusedThisIteration.has(p.id)) return false;
                    return isCoLocatedWithAnyProtagonist(workingData, p.id, protagonistLocIndices, !!hasLocations);
                });

                if (chatEligible.length === 0) {
                    processedThisTick.add(globalWinner.id);
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

                const result = await this.executor(workingData, speaker, this.abortController.signal);
                if (!result) {
                    processedThisTick.add(speaker.id);
                    continue;
                }

                const resultData = result.interactionData;

                // Post-speech: consume stamina, resolve location
                const newLastEntry = resultData.interactionHistory[resultData.interactionHistory.length - 1];
                if (newLastEntry && newLastEntry.character.id === speaker.id && hasTextContent(newLastEntry)) {
                    const paragraphs = countParagraphs((newLastEntry as ChatMessage).textContent);
                    const chatCost = computeChatStaminaConsumptionCost(speaker, resultData, paragraphs);
                    if (chatCost > 0) consumeChatStaminaForMessage(newLastEntry, chatCost);

                    if (hasLocations) {
                        const currentLoc = getCurrentLocationIndex(resultData, speaker);
                        const regexLoc = findLocationByRegex(resultData.locations, (newLastEntry as ChatMessage).textContent, speaker);
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
                processedThisTick.add(speaker.id);
                actionsThisTick++;

                try {
                    await saveRawInteractionData(workingData);
                    setData(workingData);
                } catch (e) {
                    console.error('Failed to save autonomous speech:', e);
                }
            } else {
                // ─── ACTION PATH ───
                const actionEligible = remaining.filter(p => {
                    return !isCoLocatedWithAnyProtagonist(workingData, p.id, protagonistLocIndices, !!hasLocations);
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
                    processedThisTick.add(mover.id);
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
                        processedThisTick.add(mover.id);
                        continue;
                    }

                    const leavingSkip = computeEffectiveSkip(mover, workingData, triggeringMessageText);
                    if (Math.random() < leavingSkip) {
                        processedThisTick.add(mover.id);
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

                processedThisTick.add(mover.id);
                actionsThisTick++;

                try {
                    await saveRawInteractionData(workingData);
                    setData(workingData);
                } catch (e) {
                    console.error('Failed to save autonomous movement:', e);
                }
            }
        }
    }
}