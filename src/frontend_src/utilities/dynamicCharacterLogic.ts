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
 * without ANY other participant (protagonist or another AI) interjecting.
 */
export function getConsecutiveTurnsByCharacter(
    history: HistoryMessage[],
    characterId: string
): number {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].character.id === characterId) {
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
        : Math.max(0, (remainingAction + remainingChat) / maxTotal);

    if (staminaRatio <= 0) return 0;

    const baseInitiative = Math.max(0.1, getEffectiveInitiativeWeight(character, profile));
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(getLocalMessageHistory(data, character, ['chat']), character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeSince = getTimeSinceLastActionMs(data, character);
    const timeMultiplier = 1 + Math.log1p(timeSince / 1000);

    return staminaRatio * effectiveInitiative * timeMultiplier;
}

/**
 * Continuous Exhaustion Curve:
 * Rather than a hard stop, willingness decays gracefully with output volume
 * and consecutive monologue turns.
 */
export function computeChatScore(character: Character, data: InteractionData): number {
    const profile = data.profile;
    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;

    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const remainingChat = lastMsg?.remainingChatStamina ?? maxChat;

    // Hard floor: fully depleted stamina yields cleanly
    if (maxChat > 0 && maxChat !== Number.POSITIVE_INFINITY && remainingChat <= 0) {
        return 0;
    }

    const rawStaminaRatio = (maxChat <= 0 || maxChat === Number.POSITIVE_INFINITY)
        ? 1.0
        : Math.max(0, Math.min(1, remainingChat / maxChat));

    // 1. Continuous Stamina Decay (Power curve)
    const staminaWillingness = Math.pow(rawStaminaRatio, 1.5);

    // 2. Monologue Fatigue Curve:
    // Turn 0 (responding to another): factor = 1.0 (Fresh)
    // Turn 1 (adding follow-up):      factor ≈ 0.45
    // Turn 2 (rambling):             factor ≈ 0.28
    const thread = getLocalMessageHistory(data, character, ['chat', 'whisper']);
    const consecutiveTurns = getConsecutiveTurnsByCharacter(thread, character.id);
    const impatience = Math.max(0.1, getEffectiveChatImpatienceSensitivity(character, profile));
    const monologueResistance = 0.8 + (impatience * 0.4);
    const monologueFatigue = 1 / (1 + (consecutiveTurns * 1.5) / monologueResistance);

    const baseInitiative = Math.max(0.1, getEffectiveInitiativeWeight(character, profile));
    const localRank = getLocalInitiativeRank(character, data);
    const momentum = getParticipationMomentum(getLocalMessageHistory(data, character, ['chat']), character.id);
    const effectiveInitiative = baseInitiative * localRank * (1 + momentum);

    const timeSince = getTimeSinceLastActionMs(data, character);
    const timeMultiplier = 1 + Math.log1p(timeSince / 1000);

    const turnsSince = getTurnsSinceLastSpoken(getLocalMessageHistory(data, character, ['chat']), character.id);

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

    return staminaWillingness * monologueFatigue * effectiveInitiative * timeMultiplier * compressedImpatience * nameMentionBoost;
}

export function computeActionScore(character: Character, data: InteractionData, triggeringMessageText?: string): number {
    const profile = data.profile;
    const latest = findLatestMessage(data, character);
    const lastMsg = latest?.message;

    const maxAction = getEffectiveMaximumActionStamina(character, profile);
    const remainingAction = lastMsg?.remainingActionStamina ?? maxAction;

    if (maxAction > 0 && maxAction !== Number.POSITIVE_INFINITY && remainingAction <= 0) {
        return 0;
    }

    const staminaRatio = (maxAction <= 0 || maxAction === Number.POSITIVE_INFINITY)
        ? 1.0
        : remainingAction / maxAction;

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

/**
 * Stamina Modulation:
 * Physical action stamina (movement) regenerates passively with time.
 * Chat stamina ONLY trickle-recharges after prolonged silence (> 25s) to allow ambient silence breaking,
 * not every 1-second tick!
 */
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

    // Movement stamina recovers over a 30s window
    const actionRegenRate = (maxAction > 0 && maxAction !== Number.POSITIVE_INFINITY)
        ? (maxAction / 30)
        : 1;
    const actionRegen = Math.max(0, Math.round(elapsedSeconds * actionRegenRate));

    // Conversational stamina does NOT refill on an arbitrary 1-second clock.
    // It only trickles in after a prolonged quiet lull (> 25 seconds) to break silence.
    let chatRegen = 0;
    if (elapsedSeconds > 20) {
        chatRegen = 1;
    }

    return {
        chatRegen,
        actionRegen,
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

    // Conversational Pause: Each consecutive turn increases the natural urge to yield the floor
    const thread = getLocalMessageHistory(data, character, ['chat', 'whisper']);
    const consecutiveTurns = getConsecutiveTurnsByCharacter(thread, character.id);
    const monologuePause = consecutiveTurns > 0 ? Math.min(0.55, consecutiveTurns * 0.25) : 0;

    const depletion = staminaRatio < 0.25 ? (0.25 - staminaRatio) * 1.5 : 0;

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

    return Math.min(0.85, Math.max(0, baseSkip + depletion + monologuePause + escapeModifier));
}

export function computeChatStaminaConsumptionCost(
    speaker: Character,
    data: InteractionData,
    paragraphs: number,
): number {
    if (paragraphs <= 0) return 0;

    const hasLocations = data.locations && data.locations.length > 0;
    let coLocatedCount;

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
 * Organic Pacing:
 * Couples exhaustion directly to pacing:
 * - Fresh (responding to another person): fast tempo (baseInterval).
 * - Follow-up thought: natural hesitation pause (1.5x - 2.0x baseInterval).
 * - Trailing off (monologue): long pause before continuing (3.0x+ baseInterval).
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

    // Pacing hesitation scales with consecutive monologue turns
    const thread = getLocalMessageHistory(data, character, ['chat', 'whisper']);
    const consecutiveTurns = getConsecutiveTurnsByCharacter(thread, character.id);
    const cadenceHesitation = 1 + (consecutiveTurns * 1.5);

    const dynamicDelay = targetDelay * impatienceFactor * nameFactor * cadenceHesitation;

    // Base interval is the strict floor
    return Math.max(baseInterval, Math.min(baseInterval * 8, dynamicDelay));
}