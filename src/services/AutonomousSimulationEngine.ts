// src/services/AutonomousSimulationEngine.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage } from '../types';
import { getEffectiveInitiativeWeight, getEffectiveChatProbability, getEffectiveSkipProbability, getEffectiveChatImpatienceSensitivity, getEffectiveMaximumChatStamina, getEffectiveMaximumActionStamina, generateChatStaminaForInteractionData, generateActionStaminaForInteractionData, consumeChatStaminaForMessage, consumeActionStaminaForMessage, getNameSensitivityMultiplier } from '../hooks/characterLogic';
import { getCurrentLocationIndex, findLocationByRegex, getReachableLocations, sampleReachableLocationByWeight, assignInitialLocationsIfNeeded, getCurrentLocation } from '../hooks/locationLogic';
import { saveRawInteractionData } from '../storage/serverStorage';
import { v4 as uuidv4 } from 'uuid';

type AutonomousExecutor = (data: InteractionData, character: Character, signal: AbortSignal) => Promise<InteractionData | null>;

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

function getLastInteractionForCharacter(history: HistoryMessage[], characterId: string): HistoryMessage | undefined {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].character.id === characterId) return history[i];
    }
    return undefined;
}

function getTurnsSinceLastSpoken(history: HistoryMessage[], characterId: string): number {
    let turns = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (!hasTextContent(msg)) continue;
        if (msg.character.id === characterId) return turns;
        turns++;
    }
    return turns;
}

function getTimeSinceLastActionMs(history: HistoryMessage[], characterId: string): number {
    const last = getLastInteractionForCharacter(history, characterId);
    if (!last) return Infinity;
    return Date.now() - last.lastUpdatedTimestamp;
}

function countParagraphs(text: string): number {
    if (!text || !text.trim()) return 0;
    return (text.match(/\n\n/g) || []).length + 1;
}

function createSilentInteraction(
    character: Character,
    locationIndex: number | undefined,
    previousChatStamina: number | undefined,
    previousActionStamina: number | undefined,
    parentId: string | null | undefined,
): HistoryMessage {
    const now = Date.now();
    return {
        messageType: 'interaction',
        id: uuidv4(),
        character: { ...character },
        remainingChatStamina: previousChatStamina,
        remainingActionStamina: previousActionStamina,
        locationIndex,
        parentInteractionMessageId: parentId ?? null,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

/**
 * Harmonic-decay-weighted participation ratio.
 */
function getParticipationMomentum(history: HistoryMessage[], charId: string): number {
    let recentWeight = 0;
    let totalWeight = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        const age = history.length - 1 - i;
        const decay = 1 / (1 + age);
        totalWeight += decay;
        if (history[i].character.id === charId) recentWeight += decay;
    }
    return totalWeight === 0 ? 1 : recentWeight / totalWeight;
}

/**
 * Local initiative rank with domain exclusivity boost.
 */
function getLocalInitiativeRank(character: Character, data: InteractionData): number {
    const charLoc = getCurrentLocationIndex(data, character);
    if (charLoc === undefined) return 1;

    const coLocated = data.participants.filter(p => {
        if (p.id === character.id) return false;
        const pLoc = getCurrentLocationIndex(data, p);
        return pLoc !== undefined && pLoc === charLoc;
    });

    if (coLocated.length === 0) return 1;

    const locObj = data.locations?.[charLoc];
    let exclusivityBoost = 0;
    if (locObj?.characterBindings && locObj.characterBindings.length > 0) {
        const totalParticipants = data.participants.length + 1;
        const boundCount = locObj.characterBindings.length;
        const exclusivity = 1 - (boundCount / totalParticipants);
        if (locObj.characterBindings.includes(character.id)) {
            exclusivityBoost = exclusivity;
        }
    }

    const charInit = getEffectiveInitiativeWeight(character, data.Profile);
    let outrankedBy = 0;
    for (const other of coLocated) {
        if (getEffectiveInitiativeWeight(other, data.Profile) > charInit) outrankedBy++;
    }

    return 1 / (1 + outrankedBy * (1 - exclusivityBoost));
}

/**
 * Sample stochastic regen amount using log-weighted cumulative distribution.
 */
function sampleStochasticRegenAmount(maxStamina: number): number {
    if (maxStamina <= 0 || maxStamina === Number.POSITIVE_INFINITY) return 0;

    const weights: number[] = [];
    let cumulativeWeight = 0;

    for (let k = 1; k <= maxStamina; k++) {
        cumulativeWeight += Math.log(1 + k);
        weights.push(cumulativeWeight);
    }

    const randomValue = Math.random() * cumulativeWeight;

    let lo = 0;
    let hi = weights.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (weights[mid] < randomValue) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    return lo + 1;
}

/**
 * Compute global turn score with local rank and momentum.
 */
function computeGlobalScore(character: Character, data: InteractionData): number {
    const profile = data.Profile;
    const lastMsg = getLastInteractionForCharacter(data.interactionHistory, character.id);

    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const remainingAction = lastMsg?.remainingActionStamina ?? maxAction;
    const remainingChat = lastMsg?.remainingChatStamina ?? maxChat;

    const maxTotal = maxAction + maxChat;
    if (maxTotal <= 0 || maxTotal === Number.POSITIVE_INFINITY) return 0;

    const staminaRatio = (remainingAction + remainingChat) / maxTotal;
    const baseInitiative = getEffectiveInitiativeWeight(character, profile);
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(data.interactionHistory, character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);
    
    // FIX: Soft time scaling. 1 + log1p ensures multiplier is >= 1, never 0.
    const timeSince = getTimeSinceLastActionMs(data.interactionHistory, character.id);
    const timeMultiplier = 1 + Math.log1p(timeSince);

    return staminaRatio * effectiveInitiative * timeMultiplier;
}

/**
 * Compute chat-specific score with impatience dampened by local activity.
 */
function computeChatScore(character: Character, data: InteractionData): number {
    const profile = data.Profile;
    const lastMsg = getLastInteractionForCharacter(data.interactionHistory, character.id);

    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const remainingChat = lastMsg?.remainingChatStamina ?? maxChat;

    if (maxChat <= 0 || maxChat === Number.POSITIVE_INFINITY) return 0;

    const staminaRatio = remainingChat / maxChat;
    const baseInitiative = getEffectiveInitiativeWeight(character, profile);
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(data.interactionHistory, character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);
    
    // FIX: Soft time scaling
    const timeSince = getTimeSinceLastActionMs(data.interactionHistory, character.id);
    const timeMultiplier = 1 + Math.log1p(timeSince);
    
    const turnsSince = getTurnsSinceLastSpoken(data.interactionHistory, character.id);
    const impatience = getEffectiveChatImpatienceSensitivity(character, profile);

    const charLoc = getCurrentLocationIndex(data, character);
    let localActivityDensity = 0;
    if (charLoc !== undefined) {
        for (let i = data.interactionHistory.length - 1; i >= 0; i--) {
            const msg = data.interactionHistory[i];
            if (!hasTextContent(msg)) continue;
            if (msg.character.id === character.id) continue;
            if (msg.locationIndex !== charLoc) continue;
            const age = data.interactionHistory.length - 1 - i;
            localActivityDensity += 1 / (1 + age);
        }
    }
    const patienceBoost = Math.log1p(localActivityDensity);
    const effectiveImpatience = impatience / (1 + patienceBoost);
    const compressedImpatience = Math.log1p(turnsSince * effectiveImpatience);

    return staminaRatio * effectiveInitiative * timeMultiplier * compressedImpatience;
}

/**
 * Compute action-specific score with reachability modulation.
 */
function computeActionScore(character: Character, data: InteractionData, triggeringMessageText?: string): number {
    const profile = data.Profile;
    const lastMsg = getLastInteractionForCharacter(data.interactionHistory, character.id);

    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const remainingAction = lastMsg?.remainingActionStamina ?? maxAction;

    if (maxAction <= 0 || maxAction === Number.POSITIVE_INFINITY) return 0;

    const staminaRatio = remainingAction / maxAction;
    const baseInitiative = getEffectiveInitiativeWeight(character, profile);
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(data.interactionHistory, character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);
    
    // FIX: Soft time scaling
    const timeSince = getTimeSinceLastActionMs(data.interactionHistory, character.id);
    const timeMultiplier = 1 + Math.log1p(timeSince);

    const moverLoc = getCurrentLocationIndex(data, character);
    const reachable = getReachableLocations(data.locations, moverLoc, triggeringMessageText);
    const totalLocs = data.locations?.length ?? 1;
    const reachabilitySignal = Math.log1p(reachable.length) / Math.log1p(totalLocs);

    return staminaRatio * effectiveInitiative * timeMultiplier * (0.5 + reachabilitySignal);
}

/**
 * Weighted random selection from a pool of candidates.
 */
function weightedSample<T>(pool: { item: T; weight: number }[]): T | null {
    if (pool.length === 0) return null;
    const totalWeight = pool.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
    if (totalWeight <= 0) return pool[pool.length - 1].item;

    let roll = Math.random() * totalWeight;
    for (const entry of pool) {
        roll -= Math.max(0, entry.weight);
        if (roll <= 0) return entry.item;
    }
    return pool[pool.length - 1].item;
}

/**
 * Compute contextually modulated regen amounts.
 * Base from stochastic log-weighted sampler, modulated by idle acceleration and social polarity.
 */
function computeModulatedRegenAmounts(
    character: Character,
    data: InteractionData,
): { chatRegen: number; actionRegen: number } {
    const profile = data.Profile;
    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const lastMsg = getLastInteractionForCharacter(data.interactionHistory, character.id);

    let chatRegen = sampleStochasticRegenAmount(maxChat);
    let actionRegen = sampleStochasticRegenAmount(maxAction);

    if (!lastMsg) return { chatRegen, actionRegen };

    // Idle acceleration
    const timeSinceMs = Date.now() - lastMsg.lastUpdatedTimestamp;
    if (maxChat !== Number.POSITIVE_INFINITY && maxChat > 0) {
        const chatIdleFactor = timeSinceMs / (timeSinceMs + maxChat * 1000);
        chatRegen *= (1 + chatIdleFactor);
    }
    if (maxAction !== Number.POSITIVE_INFINITY && maxAction > 0) {
        const actionIdleFactor = timeSinceMs / (timeSinceMs + maxAction * 1000);
        actionRegen *= (1 + actionIdleFactor);
    }

    // Social polarity
    const charLoc = getCurrentLocationIndex(data, character);
    const coLocatedCount = charLoc !== undefined
        ? data.participants.filter(p => {
            if (p.id === character.id) return false;
            const pLoc = getCurrentLocationIndex(data, p);
            return pLoc !== undefined && pLoc === charLoc;
          }).length
        : 0;

    const baseSkip = getEffectiveSkipProbability(character, profile);
    const socialPolarity = 0.5 - baseSkip;
    const densitySignal = socialPolarity * Math.log1p(coLocatedCount);

    const rawSocialMult = 1 / (1 + Math.exp(-6 * (densitySignal - 0.3)));
    const neutralBaseline = 1 / (1 + Math.exp(6 * 0.3));
    const socialMultiplier = rawSocialMult / neutralBaseline;

    chatRegen *= socialMultiplier;
    actionRegen *= socialMultiplier;

    return {
        chatRegen: Math.max(0, chatRegen),
        actionRegen: Math.max(0, actionRegen),
    };
}

/**
 * Compute effective skip probability with all modulators.
 */
function computeEffectiveSkip(
    character: Character,
    data: InteractionData,
    triggeringMessageText?: string,
): number {
    const profile = data.Profile;
    const baseSkip = getEffectiveSkipProbability(character, profile);

    // Depletion coupling
    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const lastMsg = getLastInteractionForCharacter(data.interactionHistory, character.id);
    const currentChat = lastMsg?.remainingChatStamina ?? maxChat;
    const staminaRatio = maxChat > 0 ? currentChat / maxChat : 1;
    const depletionRaw = (1 - staminaRatio) * (1 - staminaRatio);
    const dNorm = depletionRaw / (1 + depletionRaw);

    // Verbosity coupling
    let verbosityRaw = 0;
    if (lastMsg && hasTextContent(lastMsg)) {
        verbosityRaw = Math.log1p(countParagraphs(lastMsg.textContent));
    }
    const vNorm = verbosityRaw / (1 + verbosityRaw);

    // Weighted escape route valuation
    const winnerLoc = getCurrentLocationIndex(data, character);
    let weightedEscapeValue = 0;
    if (winnerLoc !== undefined && data.locations) {
        const reachable = getReachableLocations(data.locations, winnerLoc, triggeringMessageText);
        for (const { location } of reachable) {
            const charWeight = location.characterWeights?.[character.id];
            const weight = charWeight !== undefined ? charWeight : (location.globalWeight ?? 0);
            weightedEscapeValue += Math.max(0, weight);
        }
    }
    const escapeRaw = Math.log1p(weightedEscapeValue);
    const eNorm = escapeRaw / (1 + escapeRaw);

    // Home comfort skip reduction
    const currentLoc = getCurrentLocation(data, character);
    const homeWeight = currentLoc?.characterWeights?.[character.id] ?? 0;
    const globalWeight = currentLoc?.globalWeight ?? 1;
    const homeComfortRatio = globalWeight > 0 ? homeWeight / globalWeight : 0;
    const comfortRaw = Math.log1p(Math.max(0, homeComfortRatio - 1));
    const comfortNorm = comfortRaw / (1 + comfortRaw);

    const combinedModulation = (dNorm + vNorm + eNorm) / 3;
    const effectiveSkip = baseSkip
        + (1 - baseSkip) * combinedModulation
        - comfortNorm * baseSkip;

    return 1 / (1 + Math.exp(-10 * (effectiveSkip - 0.5)));
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

        const allAI = workingData.participants.filter(p => p.id !== workingData.protagonist.id);
        if (allAI.length === 0) return;

        const protagonistLoc = getCurrentLocationIndex(workingData, workingData.protagonist);
        const hasLocations = workingData.locations && workingData.locations.length > 0;

        const lastChatEntry = [...workingData.interactionHistory].reverse().find(m => hasTextContent(m));
        const triggeringMessageText = lastChatEntry && hasTextContent(lastChatEntry) ? lastChatEntry.textContent : undefined;

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

            // Per-iteration chat refusal tracker
            const chatRefusedThisIteration = new Set<string>();

            // ─── REGEN PHASE: All remaining candidates regenerate BEFORE any selection ───
            for (const char of remaining) {
                const { chatRegen, actionRegen } = computeModulatedRegenAmounts(char, workingData);
                if (chatRegen > 0) generateChatStaminaForInteractionData(workingData, chatRegen, char);
                if (actionRegen > 0) generateActionStaminaForInteractionData(workingData, actionRegen, char);
            }

            // ─── Step 1: Global scoring ───
            const globalPool: { item: Character; weight: number }[] = [];
            for (const char of remaining) {
                if (chatRefusedThisIteration.has(char.id)) continue;
                const score = computeGlobalScore(char, workingData);
                if (score > 0) globalPool.push({ item: char, weight: score });
            }

            const globalWinner = weightedSample(globalPool);
            if (!globalWinner) break;

            // ─── Step 2: Skip check ───
            const effectiveSkip = computeEffectiveSkip(globalWinner, workingData, triggeringMessageText);
            if (Math.random() < effectiveSkip) {
                processedThisTick.add(globalWinner.id);
                continue;
            }

            // ─── Step 3: Co-location check ───
            const winnerLoc = hasLocations ? getCurrentLocationIndex(workingData, globalWinner) : undefined;
            const isCoLocated = !hasLocations || (winnerLoc !== undefined && protagonistLoc !== undefined && winnerLoc === protagonistLoc);

            if (isCoLocated) {
                // ─── CHAT PATH ───
                const chatEligible = remaining.filter(p => {
                    if (chatRefusedThisIteration.has(p.id)) return false;
                    const pLoc = hasLocations ? getCurrentLocationIndex(workingData, p) : undefined;
                    return !hasLocations || (pLoc !== undefined && protagonistLoc !== undefined && pLoc === protagonistLoc);
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

                // Speak
                const resultData = await this.executor(workingData, speaker, this.abortController.signal);
                if (!resultData) {
                    processedThisTick.add(speaker.id);
                    continue;
                }

                // Post-speech: consume chat stamina for speech, resolve location, consume action stamina for movement
                const newLastEntry = resultData.interactionHistory[resultData.interactionHistory.length - 1];
                if (newLastEntry && newLastEntry.character.id === speaker.id && hasTextContent(newLastEntry)) {
                    const paragraphs = countParagraphs(newLastEntry.textContent);
                    if (paragraphs > 0) {
                        // Chat stamina: speech cost (attention + group load)
                        const attentionCost = getNameSensitivityMultiplier(speaker, resultData);

                        const speakerLoc = getCurrentLocationIndex(resultData, speaker);
                        const coLocatedCount = speakerLoc !== undefined
                            ? resultData.participants.filter(p => {
                                if (p.id === speaker.id) return false;
                                const pLoc = getCurrentLocationIndex(resultData, p);
                                return pLoc !== undefined && pLoc === speakerLoc;
                              }).length
                            : 0;
                        const loadMultiplier = Math.sqrt(coLocatedCount);

                        consumeChatStaminaForMessage(newLastEntry, paragraphs * loadMultiplier * attentionCost);
                    }

                    if (hasLocations) {
                        const currentLoc = getCurrentLocationIndex(resultData, speaker);
                        const regexLoc = findLocationByRegex(resultData.locations, newLastEntry.textContent, speaker);
                        const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;

                        // Regex-triggered movement: action stamina cost (physical traversal)
                        if (regexLoc !== undefined && regexLoc !== currentLoc) {
                            const distance = Math.abs(regexLoc - currentLoc!);
                            const movementCost = Math.sqrt(distance);
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

                // Action skip check
                const actionEffectiveSkip = computeEffectiveSkip(mover, workingData, triggeringMessageText);
                if (Math.random() < actionEffectiveSkip) {
                    processedThisTick.add(mover.id);
                    continue;
                }

                // Co-located others check
                const moverLoc = getCurrentLocationIndex(workingData, mover);
                const coLocatedOthers = hasLocations && moverLoc !== undefined
                    ? allAI.filter(p => p.id !== mover.id && getCurrentLocationIndex(workingData, p) === moverLoc)
                    : [];

                if (coLocatedOthers.length > 0) {
                    const leaveGroup = [mover, ...coLocatedOthers];
                    const leavePool: { item: Character; weight: number }[] = [];
                    for (const char of leaveGroup) {
                        const impatience = getEffectiveChatImpatienceSensitivity(char, profile);
                        const leaveWeight = impatience > 0 ? 1 / impatience : Infinity;
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

                // Perform movement
                const prevChatStamina = getLastInteractionForCharacter(workingData.interactionHistory, mover.id)?.remainingChatStamina;
                const prevActionStamina = getLastInteractionForCharacter(workingData.interactionHistory, mover.id)?.remainingActionStamina;

                const reachable = getReachableLocations(workingData.locations, moverLoc!, triggeringMessageText);
                const newLoc = sampleReachableLocationByWeight(reachable, mover);

                if (newLoc !== undefined && newLoc !== moverLoc) {
                    // Pure distance cost
                    const distance = Math.abs(newLoc - moverLoc!);
                    const totalActionCost = Math.sqrt(distance);

                    const postRegenMsg = getLastInteractionForCharacter(workingData.interactionHistory, mover.id);
                    if (postRegenMsg && postRegenMsg.remainingActionStamina !== undefined) {
                        consumeActionStaminaForMessage(postRegenMsg, totalActionCost);
                    }

                    const silent = createSilentInteraction(
                        mover,
                        newLoc,
                        prevChatStamina,
                        postRegenMsg?.remainingActionStamina ?? prevActionStamina,
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