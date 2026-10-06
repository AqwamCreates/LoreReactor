// frontend_src/utilities/dynamicCharacterLogic.ts
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

/**
 * Counts consecutive messages this character sent at the tip of the provided thread
 * without ANY other participant (protagonist or another AI in the room) interjecting.
 */
export function getConsecutiveTurnsByCharacter(
    history: HistoryMessage[],
    characterId: string
): number {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.character.id === characterId) {
            count++;
        } else {
            break;
        }
    }
    return count;
}

/** Measures elapsed real time since this character's last message was first created */
export function getTimeSinceLastActionMs(data: InteractionData, character: Character): number {
    const latest = findLatestMessage(data, character);
    if (!latest) return Number.POSITIVE_INFINITY;
    const stamp = latest.message.firstCreatedTimestamp || latest.message.lastUpdatedTimestamp;
    return Math.max(0, Date.now() - stamp);
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

export function computeGlobalScore(character: Character, data: InteractionData): number {
    const profile = data.profile;
    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;

    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const remainingAction = lastMsg?.remainingActionStamina ?? maxAction;
    const remainingChat = lastMsg?.remainingChatStamina ?? maxChat;

    const maxTotal = maxAction + maxChat;
    const staminaRatio = (maxTotal <= 0 || maxTotal === Number.POSITIVE_INFINITY)
        ? 1.0
        : Math.max(0.15, (remainingAction + remainingChat) / maxTotal);

    const baseInitiative = Math.max(0.1, getEffectiveInitiativeWeight(character, profile));
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(getLocalMessageHistory(data, character, ['chat']), character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeSince = getTimeSinceLastActionMs(data, character);
    const timeMultiplier = 1 + Math.log1p(timeSince / 1000);

    return staminaRatio * effectiveInitiative * timeMultiplier;
}

/**
 * TURN-TAKING CALIBRATION:
 * When co-located with the protagonist, characters take turns reacting.
 * If this character spoke last, they yield the floor and return 0 (stopping API spam)
 * until someone else speaks or a substantial silence threshold passes.
 */
export function computeChatScore(character: Character, data: InteractionData): number {
    const profile = data.profile;
    const localThread = getLocalMessageHistory(data, character, ['chat', 'whisper']);
    
    // Check if THIS character was the last one to speak in the thread
    const monologueStreak = getConsecutiveTurnsByCharacter(localThread, character.id);
    const timeSinceLastSpokeMs = getTimeSinceLastActionMs(data, character);
    const impatience = Math.max(0.1, getEffectiveChatImpatienceSensitivity(character, profile));

    // If character spoke last, enforce a silence cooldown before they are allowed to monologue again
    if (monologueStreak > 0) {
        // Base follow-up threshold: 15 seconds, reduced by high impatience (e.g. 6s for hyper-fixated, 30s for patient)
        const monologueCooldownMs = Math.max(4000, 15000 / impatience);
        
        // If cooldown hasn't passed, yield the floor completely (ZERO API calls)
        if (timeSinceLastSpokeMs < monologueCooldownMs) {
            return 0;
        }
    }

    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;

    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const remainingChat = lastMsg?.remainingChatStamina ?? maxChat;

    const staminaRatio = (maxChat <= 0 || maxChat === Number.POSITIVE_INFINITY)
        ? 1.0
        : Math.max(0.1, remainingChat / maxChat);

    const baseInitiative = Math.max(0.1, getEffectiveInitiativeWeight(character, profile));
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(localThread, character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeMultiplier = 1 + Math.log1p(timeSinceLastSpokeMs / 1000);

    const turnsSince = getTurnsSinceLastSpoken(localThread, character.id);
    const charLocId = getCurrentLocationId(data, character);
    let localActivityDensity = 0;
    
    if (charLocId) {
        const locHistory = getLocationMessageHistory(data, charLocId, ['chat']);
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

    const compressedImpatience = 1 + Math.log1p((turnsSince + 0.5) * effectiveImpatience);

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

    const staminaRatio = (maxAction <= 0 || maxAction === Number.POSITIVE_INFINITY)
        ? 1.0
        : Math.max(0.1, remainingAction / maxAction);

    const baseInitiative = Math.max(0.1, getEffectiveInitiativeWeight(character, profile));
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(getLocalMessageHistory(data, character, ['chat']), character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeSince = getTimeSinceLastActionMs(data, character);
    const timeMultiplier = 1 + Math.log1p(timeSince / 1000);

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

/** Time-based stamina regeneration using firstCreatedTimestamp */
export function computeModulatedStaminaRegenationAmounts(
    character: Character,
    data: InteractionData,
): { chatRegen: number; actionRegen: number } {
    const profile = data.profile;
    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;

    if (!lastMsg) {
        return { chatRegen: Math.max(1, maxChat), actionRegen: Math.max(1, maxAction) };
    }

    const stamp = lastMsg.firstCreatedTimestamp || lastMsg.lastUpdatedTimestamp;
    const elapsedSeconds = Math.max(0.5, (Date.now() - stamp) / 1000);

    const REGEN_TIME_WINDOW_SEC = 15;
    const chatRegenRate = (maxChat > 0 && maxChat !== Number.POSITIVE_INFINITY)
        ? (maxChat / REGEN_TIME_WINDOW_SEC)
        : 1;
    const actionRegenRate = (maxAction > 0 && maxAction !== Number.POSITIVE_INFINITY)
        ? (maxAction / REGEN_TIME_WINDOW_SEC)
        : 1;

    let chatRegen = Math.max(1, Math.round(elapsedSeconds * chatRegenRate));
    let actionRegen = Math.max(1, Math.round(elapsedSeconds * actionRegenRate));

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
        densitySignal += Math.log1p(coLocatedCount) * 0.3;
    }

    const rawSocialMult = 1 / (1 + Math.exp(-4 * (densitySignal - 0.2)));
    const neutralBaseline = 1 / (1 + Math.exp(4 * 0.2));
    const socialMultiplier = rawSocialMult / neutralBaseline;

    chatRegen = Math.round(chatRegen * socialMultiplier);
    actionRegen = Math.round(actionRegen * socialMultiplier);

    return {
        chatRegen: Math.max(1, chatRegen),
        actionRegen: Math.max(1, actionRegen),
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

    const depletion = staminaRatio < 0.2 ? (0.2 - staminaRatio) * 1.5 : 0;

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
    const escapeModifier = Math.min(0.2, Math.log1p(weightedEscapeValue) * 0.05);

    return Math.min(0.75, Math.max(0, baseSkip + depletion + escapeModifier));
}

export function computeChatStaminaConsumptionCost(
    speaker: Character,
    data: InteractionData,
    paragraphs: number,
): number {
    if (paragraphs <= 0) return 0;

    const hasLocations = data.locations && data.locations.length > 0;
    let coLocatedCount = 1;

    if (!hasLocations) {
        coLocatedCount = Math.max(1, data.participants.filter(p => p.id !== speaker.id).length);
    } else {
        const speakerLocId = getCurrentLocationId(data, speaker);
        coLocatedCount = speakerLocId
            ? Math.max(1, data.participants.filter(p => p.id !== speaker.id && getCurrentLocationId(data, p) === speakerLocId).length)
            : 1;
    }

    return Math.max(1, Math.round((paragraphs * 0.5) * Math.sqrt(coLocatedCount)));
}

export function computeMovementCost(fromId: string, toId: string, locations: Location[]): number {
    if (fromId === toId) return 0;
    const fromLoc = locations.find(l => l.id === fromId);
    const distance = fromLoc?.locationDistances?.[toId];

    if (distance !== undefined) return Math.max(1, Math.round(Math.sqrt(Math.max(0, distance))));
    return 1; 
}

/**
 * Pacing calculation:
 * Uses cached local thread history to evaluate pacing.
 */
export function computeAutonomousTickDelay(character: Character, data: InteractionData): number {
    const profile = data.profile;
    
    const baseInterval = profile?.autonomousInteractionIntervalMs && profile.autonomousInteractionIntervalMs > 0
        ? profile.autonomousInteractionIntervalMs
        : 1000;

    const initiative = Math.max(0.1, getEffectiveInitiativeWeight(character, profile));
    const targetDelay = baseInterval / initiative;

    const impatience = Math.max(0.1, getEffectiveChatImpatienceSensitivity(character, profile));
    const impatienceFactor = 1 / (0.5 + 0.5 * impatience);

    const mentionCount = getNameMentionCount(character, data);
    const nameSensitivity = getEffectiveNameSensitivity(character, profile);
    const nameMentionBoost = 1 + Math.log1p(mentionCount * nameSensitivity * 2);
    const nameFactor = 1 / nameMentionBoost;

    const thread = getLocalMessageHistory(data, character, ['chat', 'whisper']);
    const consecutiveMonologueTurns = getConsecutiveTurnsByCharacter(thread, character.id);
    const backoffResistance = impatience;
    const backoffMultiplier = 1 + (consecutiveMonologueTurns * 0.75) / backoffResistance;

    const dynamicDelay = targetDelay * impatienceFactor * nameFactor * backoffMultiplier;

    return Math.max(baseInterval * 0.5, Math.min(baseInterval * 5, dynamicDelay));
}