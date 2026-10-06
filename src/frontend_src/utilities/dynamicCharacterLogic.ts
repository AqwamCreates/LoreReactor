// frontend-src/utilities/dynamicCharacterLogic.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage, Location } from '../types';
import { 
    getEffectiveInitiativeWeight, 
    getEffectiveNameSensitivity, 
    getNameMentionCount, 
    getEffectiveSkipProbability, 
    getEffectiveChatImpatienceSensitivity, 
    getEffectiveMaximumChatStamina, 
    getEffectiveMaximumActionStamina 
} from './characterLogic';
import { findLatestMessage } from './messageLogic';
import { getCurrentLocationId, getCurrentLocation, getReachableLocations, isLocationOwner } from './locationLogic';
import { getLocalMessageHistory, getLocationMessageHistory } from './timelineLogic';

function hasTextContent(msg: HistoryMessage): msg is ChatMessage {
    return msg.messageType === 'chat';
}

export function countParagraphs(text: string): number {
    if (!text || !text.trim()) return 0;
    return (text.match(/\n\n/g) || []).length + 1;
}

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

export function getTimeSinceLastActionMs(data: InteractionData, character: Character): number {
    const latest = findLatestMessage(data, character);
    if (!latest) return Number.POSITIVE_INFINITY;
    return Date.now() - latest.message.lastUpdatedTimestamp;
}

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

export function getLocalInitiativeRank(character: Character, data: InteractionData): number {
    const charLocId = getCurrentLocationId(data, character);
    if (!charLocId) return 1;

    const coLocated = data.participants.filter(p => {
        if (p.id === character.id) return false;
        const pLocId = getCurrentLocationId(data, p);
        return pLocId === charLocId;
    });

    if (coLocated.length === 0) return 1;

    const locObj = getCurrentLocation(data, character);
    let exclusivityBoost = 0;
    if (locObj?.characterBindings && locObj.characterBindings.length > 0) {
        const totalParticipants = data.participants.length + 1;
        const boundCount = locObj.characterBindings.length;
        const exclusivity = 1 - (boundCount / totalParticipants);
        if (locObj.characterBindings.includes(character.id)) {
            exclusivityBoost = exclusivity;
        }
    }

    if (isLocationOwner(character, locObj)) {
        const totalParticipants = data.participants.length + 1;
        const ownerCount = locObj?.ownerBindings?.length ?? 0;
        const ownerExclusivity = ownerCount > 0 ? 1 - (ownerCount / totalParticipants) : 0;
        exclusivityBoost = Math.max(exclusivityBoost, ownerExclusivity);
    }

    const charInit = getEffectiveInitiativeWeight(character, data.profile);
    let outrankedBy = 0;
    for (const other of coLocated) {
        if (getEffectiveInitiativeWeight(other, data.profile) > charInit) outrankedBy++;
    }

    return 1 / (1 + outrankedBy * (1 - exclusivityBoost));
}

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

export function computeGlobalScore(character: Character, data: InteractionData): number {
    const profile = data.profile;
    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;

    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const remainingAction = lastMsg?.remainingActionStamina ?? maxAction;
    const remainingChat = lastMsg?.remainingChatStamina ?? maxChat;

    const maxTotal = maxAction + maxChat;
    if (maxTotal <= 0 || maxTotal === Number.POSITIVE_INFINITY) return 0;

    const staminaRatio = (remainingAction + remainingChat) / maxTotal;
    const baseInitiative = getEffectiveInitiativeWeight(character, profile);
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(getLocalMessageHistory(data, character), character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeSince = getTimeSinceLastActionMs(data, character);
    const timeMultiplier = 1 + Math.log1p(timeSince);

    return staminaRatio * effectiveInitiative * timeMultiplier;
}

export function computeChatScore(character: Character, data: InteractionData): number {
    const profile = data.profile;
    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;

    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const remainingChat = lastMsg?.remainingChatStamina ?? maxChat;

    if (maxChat <= 0 || maxChat === Number.POSITIVE_INFINITY) return 0;

    const staminaRatio = remainingChat / maxChat;
    const baseInitiative = getEffectiveInitiativeWeight(character, profile);
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(getLocalMessageHistory(data, character), character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeSince = getTimeSinceLastActionMs(data, character);
    const timeMultiplier = 1 + Math.log1p(timeSince);

    const turnsSince = getTurnsSinceLastSpoken(getLocalMessageHistory(data, character), character.id);
    const impatience = getEffectiveChatImpatienceSensitivity(character, profile);

    const charLocId = getCurrentLocationId(data, character);
    let localActivityDensity = 0;
    
    if (charLocId) {
        const locHistory = getLocationMessageHistory(data, charLocId);
        for (let i = locHistory.length - 1; i >= 0; i--) {
            const msg = locHistory[i];
            if (!hasTextContent(msg)) continue;
            if (msg.character.id === character.id) continue;
            const age = locHistory.length - 1 - i;
            localActivityDensity += 1 / (1 + age);
        }
    }
    
    const patienceBoost = Math.log1p(localActivityDensity);
    const effectiveImpatience = impatience / (1 + patienceBoost);
    const compressedImpatience = Math.log1p(turnsSince * effectiveImpatience);

    const mentionCount = getNameMentionCount(character, data);
    const nameSensitivity = getEffectiveNameSensitivity(character, profile);
    const nameMentionBoost = 1 + Math.log1p(mentionCount * nameSensitivity);

    return staminaRatio * effectiveInitiative * timeMultiplier * compressedImpatience * nameMentionBoost;
}

export function computeActionScore(character: Character, data: InteractionData, triggeringMessageText?: string): number {
    const profile = data.profile;
    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;

    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const remainingAction = lastMsg?.remainingActionStamina ?? maxAction;

    if (maxAction <= 0 || maxAction === Number.POSITIVE_INFINITY) return 0;

    const staminaRatio = remainingAction / maxAction;
    const baseInitiative = getEffectiveInitiativeWeight(character, profile);
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(getLocalMessageHistory(data, character), character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeSince = getTimeSinceLastActionMs(data, character);
    const timeMultiplier = 1 + Math.log1p(timeSince);

    const moverLocId = getCurrentLocationId(data, character);
    const reachable = getReachableLocations(data.locations || [], moverLocId, triggeringMessageText);
    const totalLocs = data.locations?.length ?? 1;
    const reachabilitySignal = Math.log1p(reachable.length) / Math.log1p(totalLocs);

    return staminaRatio * effectiveInitiative * timeMultiplier * (0.5 + reachabilitySignal);
}

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

export function computeModulatedRegenAmounts(
    character: Character,
    data: InteractionData,
): { chatRegen: number; actionRegen: number } {
    const profile = data.profile;
    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;

    let chatRegen = sampleStochasticRegenAmount(maxChat);
    let actionRegen = sampleStochasticRegenAmount(maxAction);

    if (!lastMsg) return { chatRegen, actionRegen };

    const timeSinceMs = Date.now() - lastMsg.lastUpdatedTimestamp;
    if (maxChat !== Number.POSITIVE_INFINITY && maxChat > 0) {
        const chatIdleFactor = timeSinceMs / (timeSinceMs + maxChat * 1000);
        chatRegen *= (1 + chatIdleFactor);
    }
    if (maxAction !== Number.POSITIVE_INFINITY && maxAction > 0) {
        const actionIdleFactor = timeSinceMs / (timeSinceMs + maxAction * 1000);
        actionRegen *= (1 + actionIdleFactor);
    }

    const charLocId = getCurrentLocationId(data, character);
    const currentLoc = getCurrentLocation(data, character);
    const coLocatedCount = charLocId
        ? data.participants.filter(p => {
            if (p.id === character.id) return false;
            const pLocId = getCurrentLocationId(data, p);
            return pLocId === charLocId;
        }).length
        : 0;

    const baseSkip = getEffectiveSkipProbability(character, profile);
    const socialPolarity = 0.5 - baseSkip;
    let densitySignal = socialPolarity * Math.log1p(coLocatedCount);

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

export function computeEffectiveSkip(
    character: Character,
    data: InteractionData,
    triggeringMessageText?: string,
): number {
    const profile = data.profile;
    const baseSkip = getEffectiveSkipProbability(character, profile);

    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;
    const currentChat = lastMsg?.remainingChatStamina ?? maxChat;
    const staminaRatio = maxChat > 0 ? currentChat / maxChat : 1;
    const depletionRaw = (1 - staminaRatio) * (1 - staminaRatio);
    const dNorm = depletionRaw / (1 + depletionRaw);

    let verbosityRaw = 0;
    if (lastMsg && hasTextContent(lastMsg)) {
        verbosityRaw = Math.log1p(countParagraphs(lastMsg.textContent));
    }
    const vNorm = verbosityRaw / (1 + verbosityRaw);

    const winnerLocId = getCurrentLocationId(data, character);
    let weightedEscapeValue = 0;
    if (winnerLocId && data.locations) {
        const reachable = getReachableLocations(data.locations, winnerLocId, triggeringMessageText);
        for (const location of reachable) {
            const charWeight = location.characterWeights?.[character.id];
            const weight = charWeight !== undefined ? charWeight : (location.globalWeight ?? 0);
            weightedEscapeValue += Math.max(0, weight);
        }
    }
    const escapeRaw = Math.log1p(weightedEscapeValue);
    const eNorm = escapeRaw / (1 + escapeRaw);

    const currentLoc = getCurrentLocation(data, character);
    const homeWeight = currentLoc?.characterWeights?.[character.id] ?? 0;
    const globalWeight = currentLoc?.globalWeight ?? 1;
    let homeComfortRatio = globalWeight > 0 ? homeWeight / globalWeight : 0;

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

export function computeChatStaminaConsumptionCost(
    speaker: Character,
    data: InteractionData,
    paragraphs: number,
): number {
    if (paragraphs <= 0) return 0;

    const hasLocations = data.locations && data.locations.length > 0;
    
    let coLocatedCount: number;
    if (!hasLocations) {
        coLocatedCount = data.participants.filter(p => p.id !== speaker.id).length;
    } else {
        const speakerLocId = getCurrentLocationId(data, speaker);
        const speakerLocation = getCurrentLocation(data, speaker);
        coLocatedCount = speakerLocId
            ? data.participants.filter(p => {
                if (p.id === speaker.id) return false;
                const pLocId = getCurrentLocationId(data, p);
                return pLocId === speakerLocId;
            }).length
            : 0;

        if (isLocationOwner(speaker, speakerLocation)) {
            coLocatedCount = Math.floor(coLocatedCount * 0.5);
        }
    }
    
    const loadMultiplier = Math.sqrt(coLocatedCount);
    return paragraphs * loadMultiplier;
}

export function computeMovementCost(fromId: string, toId: string, locations: Location[]): number {
    if (fromId === toId) return 0;
    const fromLoc = locations.find(l => l.id === fromId);
    const distance = fromLoc?.locationDistances?.[toId];
    
    if (distance !== undefined) return Math.sqrt(Math.max(0, distance));
    return 1; 
}

/**
 * Computes the dynamic tick delay for autonomous actions based PURELY on character stats and live interaction data.
 * No hardcoded caps; bounds are derived directly from the character's initiative weight.
 */
export function computeAutonomousTickDelay(character: Character, data: InteractionData): number {
    const profile = data.profile;
    
    // 1. Base bounds derived entirely from character's initiative (higher initiative = faster potential reactions)
    const initiative = Math.max(0.1, getEffectiveInitiativeWeight(character, profile));
    const minDelay = 1000 / initiative;  // Scaling factor: high initiative chars can react in ~500ms, low in ~2000ms
    const maxDelay = 10000 / initiative; // Scaling factor: high initiative chars idle for ~5s, low for ~20s

    // 2. Impatience factor (higher impatience = faster ticks)
    const impatience = getEffectiveChatImpatienceSensitivity(character, profile);
    const impatienceFactor = 1 / (1 + impatience);

    // 3. Name mention factor (if called by name, react MUCH faster based on their sensitivity)
    const mentionCount = getNameMentionCount(character, data);
    const nameSensitivity = getEffectiveNameSensitivity(character, profile);
    const nameMentionBoost = 1 + Math.log1p(mentionCount * nameSensitivity);
    const nameFactor = 1 / nameMentionBoost;

    // 4. Time since last action factor (longer wait = higher urgency to act)
    const timeSinceMs = getTimeSinceLastActionMs(data, character);
    const timeFactor = 1 / (1 + Math.log1p(timeSinceMs / 5000)); // 5000ms is just a scaling constant for the log curve

    // Combine all dynamic factors
    const dynamicDelay = maxDelay * impatienceFactor * nameFactor * timeFactor;

    // Clamp strictly to the character's own derived min/max bounds
    return Math.max(minDelay, Math.min(maxDelay, dynamicDelay));
}