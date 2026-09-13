// src/hooks/dynamicCharacterLogic.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage } from '../types';
import { getEffectiveInitiativeWeight, getEffectiveNameSensitivity, getNameMentionCount, getEffectiveSkipProbability, getEffectiveChatImpatienceSensitivity, getEffectiveMaximumChatStamina, getEffectiveMaximumActionStamina } from './characterLogic';
import { findPreviousMessage } from './chatLogic';
import { getCurrentLocationIndex, getCurrentLocation, getReachableLocations, isLocationOwner } from './locationLogic';

function hasTextContent(msg: HistoryMessage): msg is ChatMessage {
    return msg.messageType === 'chat';
}

/**
 * Count paragraphs in text by counting double-newline separators.
 */
export function countParagraphs(text: string): number {
    if (!text || !text.trim()) return 0;
    return (text.match(/\n\n/g) || []).length + 1;
}

/**
 * Count chat messages since this character last spoke.
 */
export function getTurnsSinceLastSpoken(history: HistoryMessage[], characterId: string): number {
    let turns = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (!hasTextContent(msg)) continue;
        if (msg.character.id === characterId) return turns;
        turns++;
    }
    return turns;
}

/**
 * Milliseconds since character's last history entry.
 */
export function getTimeSinceLastActionMs(data: InteractionData, characterId: string): number {
    const last = findPreviousMessage(data, characterId);
    if (!last) return Infinity;
    return Date.now() - last.lastUpdatedTimestamp;
}

/**
 * Harmonic-decay-weighted participation ratio ∈ [0, 1].
 */
export function getParticipationMomentum(history: HistoryMessage[], charId: string): number {
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
 * Check if a character is an owner of the given location.
 */


/**
 * Local initiative rank ∈ (0, 1] with domain exclusivity boost.
 * Characters are ranked only against co-located peers, not globally.
 * Domain-bound characters get a boost that offsets being outranked.
 * 
 * OWNER BINDINGS INTERACTION:
 * Owners receive a stronger exclusivity boost than characters merely in
 * characterBindings. An owner's exclusivityBoost uses the full exclusivity
 * value directly, while non-owners use the original formula. This means
 * owners maintain higher local rank even when outranked by visitors with
 * higher raw initiative weight. Domain authority matters.
 */
export function getLocalInitiativeRank(character: Character, data: InteractionData): number {
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

    // Owner bindings provide a stronger exclusivity boost
    if (isLocationOwner(character, locObj)) {
        const totalParticipants = data.participants.length + 1;
        const ownerCount = locObj?.ownerBindings?.length ?? 0;
        // Owners get a boost proportional to how exclusive their ownership is
        // Fewer owners = higher boost. Single owner gets max boost.
        const ownerExclusivity = ownerCount > 0 ? 1 - (ownerCount / totalParticipants) : 0;
        // Owner boost is always at least as strong as characterBindings boost
        exclusivityBoost = Math.max(exclusivityBoost, ownerExclusivity);
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
export function sampleStochasticRegenAmount(maxStamina: number): number {
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
 * Compute global turn score for weighted selection.
 */
export function computeGlobalScore(character: Character, data: InteractionData): number {
    const profile = data.Profile;
    const lastMsg = findPreviousMessage(data, character.id);

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

    const timeSince = getTimeSinceLastActionMs(data, character.id);
    const timeMultiplier = 1 + Math.log1p(timeSince);

    return staminaRatio * effectiveInitiative * timeMultiplier;
}

/**
 * Compute chat-specific score for speaker selection among co-located candidates.
 */
export function computeChatScore(character: Character, data: InteractionData): number {
    const profile = data.Profile;
    const lastMsg = findPreviousMessage(data, character.id);

    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const remainingChat = lastMsg?.remainingChatStamina ?? maxChat;

    if (maxChat <= 0 || maxChat === Number.POSITIVE_INFINITY) return 0;

    const staminaRatio = remainingChat / maxChat;
    const baseInitiative = getEffectiveInitiativeWeight(character, profile);
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(data.interactionHistory, character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeSince = getTimeSinceLastActionMs(data, character.id);
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

    // Name mention priority boost
    const mentionCount = getNameMentionCount(character, data);
    const nameSensitivity = getEffectiveNameSensitivity(character, profile);
    const nameMentionBoost = 1 + Math.log1p(mentionCount * nameSensitivity);

    return staminaRatio * effectiveInitiative * timeMultiplier * compressedImpatience * nameMentionBoost;
}

/**
 * Compute action-specific score for mover selection among non-co-located candidates.
 */
export function computeActionScore(character: Character, data: InteractionData, triggeringMessageText?: string): number {
    const profile = data.Profile;
    const lastMsg = findPreviousMessage(data, character.id);

    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const remainingAction = lastMsg?.remainingActionStamina ?? maxAction;

    if (maxAction <= 0 || maxAction === Number.POSITIVE_INFINITY) return 0;

    const staminaRatio = remainingAction / maxAction;
    const baseInitiative = getEffectiveInitiativeWeight(character, profile);
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(data.interactionHistory, character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeSince = getTimeSinceLastActionMs(data, character.id);
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
export function weightedSample<T>(pool: { item: T; weight: number }[]): T | null {
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
 * Compute contextually modulated regen amounts for both stamina pools.
 * Base amount from stochastic sampler, then scaled by idle acceleration
 * and social polarity.
 * 
 * OWNER BINDINGS INTERACTION:
 * Owners in their own space receive a regen bonus. The density signal is
 * shifted positively by log1p(ownerBonus) where ownerBonus scales with
 * how many co-located peers are present. More peers in an owned space =
 * faster recovery. This represents the comfort and confidence of being
 * in one's own domain accelerating stamina restoration.
 */
export function computeModulatedRegenAmounts(
    character: Character,
    data: InteractionData,
): { chatRegen: number; actionRegen: number } {
    const profile = data.Profile;
    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const lastMsg = findPreviousMessage(data, character.id);

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
    const currentLoc = charLoc !== undefined ? data.locations?.[charLoc] : undefined;
    const coLocatedCount = charLoc !== undefined
        ? data.participants.filter(p => {
            if (p.id === character.id) return false;
            const pLoc = getCurrentLocationIndex(data, p);
            return pLoc !== undefined && pLoc === charLoc;
        }).length
        : 0;

    const baseSkip = getEffectiveSkipProbability(character, profile);
    const socialPolarity = 0.5 - baseSkip;
    let densitySignal = socialPolarity * Math.log1p(coLocatedCount);

    // Owner regen bonus: shift density signal positively when in owned space
    if (isLocationOwner(character, currentLoc) && coLocatedCount > 0) {
        const ownerBonus = Math.log1p(coLocatedCount) * 0.3;
        densitySignal += ownerBonus;
    }

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
 * Compute effective skip probability with depletion, verbosity, escape
 * valuation, and home comfort modulators.
 * 
 * OWNER BINDINGS INTERACTION:
 * Owners in their own space have their home comfort ratio floored at 1.0
 * minimum. This means owners always feel at home regardless of weight
 * configuration, making them significantly less likely to skip when in
 * their own domain. The comfortNorm subtraction from effectiveSkip is
 * maximized for owners, reducing withdrawal tendency proportionally to
 * their domain authority.
 */
export function computeEffectiveSkip(
    character: Character,
    data: InteractionData,
    triggeringMessageText?: string,
): number {
    const profile = data.Profile;
    const baseSkip = getEffectiveSkipProbability(character, profile);

    // Depletion coupling
    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const lastMsg = findPreviousMessage(data, character.id);
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
    let homeComfortRatio = globalWeight > 0 ? homeWeight / globalWeight : 0;

    // Owner bindings: floor comfort ratio at 1.0 — owners always feel at home
    if (isLocationOwner(character, currentLoc)) {
        homeComfortRatio = Math.max(homeComfortRatio, 1.0);
    }

    const comfortRaw = Math.log1p(Math.max(0, homeComfortRatio - 1));
    const comfortNorm = comfortRaw / (1 + comfortRaw);

    const combinedModulation = (dNorm + vNorm + eNorm) / 3;
    const effectiveSkip = baseSkip
        + (1 - baseSkip) * combinedModulation
        - comfortNorm * baseSkip;

    return 1 / (1 + Math.exp(-10 * (effectiveSkip - 0.5)));
}

/**
 * Compute total chat stamina consumption cost for a speech act.
 * Combines paragraph count and group load.
 * 
 * OWNER BINDINGS INTERACTION:
 * When speaking in an owned location, the social load multiplier is
 * reduced by half. Owners are socially dominant in their space — speaking
 * costs less stamina because they're not competing for conversational
 * territory. The coLocatedCount is multiplied by 0.5 when the speaker
 * is an owner of the current location.
 */
export function computeChatStaminaConsumptionCost(
    speaker: Character,
    data: InteractionData,
    paragraphs: number,
): number {
    if (paragraphs <= 0) return 0;

    const hasLocations = data.locations && data.locations.length > 0;
    
    let coLocatedCount: number;
    if (!hasLocations) {
        // No location system: all participants are effectively co-located
        coLocatedCount = data.participants.filter(p => p.id !== speaker.id).length;
    } else {
        const speakerLoc = getCurrentLocationIndex(data, speaker);
        const speakerLocation = speakerLoc !== undefined ? data.locations?.[speakerLoc] : undefined;
        coLocatedCount = speakerLoc !== undefined
            ? data.participants.filter(p => {
                if (p.id === speaker.id) return false;
                const pLoc = getCurrentLocationIndex(data, p);
                return pLoc !== undefined && pLoc === speakerLoc;
            }).length
            : 0;

        // Owner social load reduction: halve the co-located count for owners
        if (isLocationOwner(speaker, speakerLocation)) {
            coLocatedCount = Math.floor(coLocatedCount * 0.5);
        }
    }
    
    const loadMultiplier = Math.sqrt(coLocatedCount);
    return paragraphs * loadMultiplier;
}

/**
 * Compute movement action stamina cost based on distance.
 */
export function computeMovementCost(fromIndex: number, toIndex: number): number {
    return Math.sqrt(Math.abs(toIndex - fromIndex));
}