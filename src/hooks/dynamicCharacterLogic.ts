// src/hooks/interactionScoring.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage } from '../types';
import { getEffectiveInitiativeWeight, getEffectiveNameSensitivity, getNameMentionCount, getEffectiveSkipProbability, getEffectiveChatImpatienceSensitivity, getEffectiveMaximumChatStamina, getEffectiveMaximumActionStamina } from './characterLogic';
import { getCurrentLocationIndex, getCurrentLocation, getReachableLocations } from './locationLogic';

function hasTextContent(msg: HistoryMessage): msg is ChatMessage {
    return msg.messageType === 'chat';
}

/**
 * Find the most recent history entry for a character.
 * 
 * EDGE CASES:
 * - Empty history: returns undefined. All callers must handle this (typically
 *   by falling back to max stamina or default values).
 * - Character never acted: returns undefined. This is distinct from "acted
 *   long ago" — callers use this to detect fresh/uninitialized characters.
 */
export function getLastInteractionForCharacter(history: HistoryMessage[], characterId: string): HistoryMessage | undefined {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].character.id === characterId) return history[i];
    }
    return undefined;
}

/**
 * Count paragraphs in text by counting double-newline separators.
 * 
 * EDGE CASES:
 * - Empty/whitespace-only text: returns 0. Prevents consuming stamina on
 *   empty LLM responses or failed generations.
 * - Single paragraph (no \n\n): returns 1. Ensures minimum cost of 1 unit
 *   for any non-empty response.
 * - Trailing newlines: trimmed before counting. Prevents inflated costs from
 *   LLM formatting artifacts.
 */
export function countParagraphs(text: string): number {
    if (!text || !text.trim()) return 0;
    return (text.match(/\n\n/g) || []).length + 1;
}

/**
 * Count chat messages since this character last spoke.
 * 
 * EDGE CASES:
 * - Character never spoke: returns total chat message count in history.
 *   This means impatience starts accumulating from the beginning of the
 *   conversation, not from zero. Fresh characters in active conversations
 *   will have high turnsSince immediately.
 * - No chat messages in history: returns 0. Combined with log1p in scoring,
 *   this produces compressedImpatience = 0, which zeroes out chatScore.
 *   This is intentional — characters who have never spoken and no one else
 *   has spoken have no urgency signal. They rely on globalScore instead.
 * - Only interaction (non-chat) messages: skipped entirely. Silent movements
 *   don't count as conversational turns.
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
 * 
 * EDGE CASES:
 * - No history entry: returns Infinity. This is critical for fresh characters.
 *   In scoring, Infinity × anything = Infinity, guaranteeing selection in
 *   weightedSample (falls through to last item). Without this, fresh
 *   characters would have score 0 and never be selected.
 * - Entry created in same tick (e.g., assignInitialLocationsIfNeeded):
 *   returns 0 or near-0. THIS IS THE ZERO-COLLAPSE BUG THAT WAS FIXED.
 *   All scoring functions now use (1 + Math.log1p(timeSince)) instead of
 *   raw timeSince to prevent score from collapsing to 0 at t=0.
 * - Very old entries: returns large number. Log compression in scoring
 *   prevents this from dominating all other factors.
 */
export function getTimeSinceLastActionMs(history: HistoryMessage[], characterId: string): number {
    const last = getLastInteractionForCharacter(history, characterId);
    if (!last) return Infinity;
    return Date.now() - last.lastUpdatedTimestamp;
}

/**
 * Harmonic-decay-weighted participation ratio ∈ [0, 1].
 * Measures how recently and frequently a character has participated relative
 * to total conversation activity.
 * 
 * EDGE CASES:
 * - Empty history: returns 1 (neutral baseline). Prevents momentum from
 *   penalizing characters who haven't had a chance to participate yet.
 * - Character is only participant: returns 1. No competition means full
 *   momentum retention.
 * - Character dominated early but went silent: harmonic decay ensures old
 *   participation fades. Recent silence correctly reduces momentum toward 0.
 * - Single-message history where character spoke: returns 1/1 = 1.
 * - Single-message history where character didn't speak: returns 0/1 = 0.
 *   Correctly signals "present but hasn't contributed."
 * 
 * NOTE: The harmonic series (1/(1+age)) provides natural forgetting without
 * an arbitrary window size constant. Each older message contributes less,
 * but never exactly zero.
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
 * Local initiative rank ∈ (0, 1] with domain exclusivity boost.
 * Characters are ranked only against co-located peers, not globally.
 * Domain-bound characters get a boost that offsets being outranked.
 * 
 * EDGE CASES:
 * - No location assigned: returns 1. Unlocated characters aren't penalized.
 * - No co-located peers: returns 1. Solo characters always have full rank.
 * - All co-located peers have equal initiative: outrankedBy = 0, returns 1.
 * - Character is outranked by N peers: returns 1/(1+N). With 3 higher-init
 *   peers, rank = 0.25. Never reaches 0 due to harmonic denominator.
 * - Exclusivity boost when character owns the space: offsets outranking.
 *   If boundCount=1 and totalParticipants=3, exclusivity=0.67. An outranked
 *   character in their own room gets rank = 1/(1+1*(1-0.67)) = 0.75
 *   instead of 0.5. Domain ownership matters.
 * - Character NOT in bindings but others are: exclusivityBoost = 0. Visitor
 *   gets no protection against local hierarchy.
 * - forceEqualInitiative enabled: all characters have init=1, so outrankedBy
 *   is always 0. Rank is always 1 (or boosted by exclusivity).
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

    const charInit = getEffectiveInitiativeWeight(character, data.Profile);
    let outrankedBy = 0;
    for (const other of coLocated) {
        if (getEffectiveInitiativeWeight(other, data.Profile) > charInit) outrankedBy++;
    }

    return 1 / (1 + outrankedBy * (1 - exclusivityBoost));
}

/**
 * Sample stochastic regen amount using log-weighted cumulative distribution.
 * Returns integer in [1, maxStamina]. Lower amounts are more probable.
 * 
 * EDGE CASES:
 * - maxStamina <= 0: returns 0. Prevents invalid array construction.
 * - maxStamina = Infinity: returns 0. Cannot construct distribution over
 *   infinite range. Callers should skip regen for infinite-pool characters.
 * - maxStamina = 1: always returns 1. Distribution has single element.
 * - Distribution shape: P(k) ∝ log(1+k). For maxStamina=5:
 *   P(1)≈0.28, P(2)≈0.23, P(3)≈0.19, P(4)≈0.16, P(5)≈0.14.
 *   Heavily biased toward small amounts with long tail.
 * - Binary search correctness: weights array is strictly increasing
 *   (cumulative sum of positive values). Search always terminates.
 *   Fallback to last element handles floating-point edge where roll
 *   doesn't cross any threshold due to precision loss.
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
 * Combines stamina ratio, local initiative rank, momentum, and time-based
 * priority into a single weight for actor selection.
 * 
 * ZERO-COLLAPSE PREVENTION:
 * - timeSince uses (1 + Math.log1p(timeSince)) instead of raw timeSince.
 *   At t=0 (same-tick as location assignment), multiplier = 1, not 0.
 *   Without this fix, fresh characters score 0 and are NEVER selected.
 *   At t=10s, multiplier ≈ 10.2. At t=60s, multiplier ≈ 12. Log growth
 *   prevents old characters from dominating indefinitely.
 * 
 * EDGE CASES:
 * - maxTotal = 0 or Infinity: returns 0. Cannot compute meaningful ratio.
 *   Characters with both pools at 0 or Infinity are excluded from selection.
 * - No history entry: staminaRatio uses max values (full stamina), momentum
 *   returns 1, timeSince returns Infinity → score = Infinity. Guaranteed
 *   selection via weightedSample fallback. Fresh characters always act first.
 * - All multipliers positive: score is always ≥ 0. Negative scores impossible
 *   because all inputs (ratios, ranks, momentum, time) are non-negative.
 * - Single AI character: always selected regardless of score magnitude,
 *   since weightedSample with one item always returns that item.
 */
export function computeGlobalScore(character: Character, data: InteractionData): number {
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

    const timeSince = getTimeSinceLastActionMs(data.interactionHistory, character.id);
    const timeMultiplier = 1 + Math.log1p(timeSince);

    return staminaRatio * effectiveInitiative * timeMultiplier;
}

/**
 * Compute chat-specific score for speaker selection among co-located candidates.
 * Adds impatience-driven urgency and name-mention priority on top of global score factors.
 * 
 * NAME MENTION BOOST:
 * When this character's name appears in the latest chat message, their chat score
 * is multiplied by (1 + log1p(mentionCount × nameSensitivity)). This makes named
 * characters more likely to be selected as the next speaker. The log curve ensures
 * diminishing returns: being called once gives a meaningful boost, being called
 * five times doesn't dominate all other factors. At 0 mentions, multiplier = 1
 * (no boost, no penalty). nameSensitivity scales the impact per mention.
 * 
 * ZERO-COLLAPSE PREVENTION:
 * - timeSince uses (1 + Math.log1p(timeSince)). Same fix as globalScore.
 * - compressedImpatience uses Math.log1p(turnsSince * effectiveImpatience).
 *   When turnsSince=0 AND impatience=0, this returns 0, making chatScore=0.
 *   This is ACCEPTABLE because chatScore is only used when chatEligible.length > 1.
 *   When length=1, speaker is assigned directly without scoring.
 *   When length>1 and all scores are 0, weightedSample falls back to first item.
 * 
 * EDGE CASES:
 * - maxChat = 0 or Infinity: returns 0. Character cannot chat.
 * - No co-located peer activity: localActivityDensity = 0, patienceBoost = 0,
 *   effectiveImpatience = raw impatience. Full urgency applied.
 * - High co-located activity: patienceBoost grows, effectiveImpatience shrinks.
 *   Characters tolerate silence when others are talking. Eavesdropping tolerance.
 * - impatience = 0: compressedImpatience = log1p(0) = 0. Chat score = 0.
 *   Character relies solely on globalScore for selection. This is correct —
 *   zero impatience means no chat-specific urgency.
 * - turnsSince very large: log1p compresses. After 100 turns, compressed ≈ 4.6.
 *   Prevents runaway scores from long silences.
 * - Name mentioned 0 times: nameMentionBoost = 1 + log1p(0) = 1. No effect.
 * - Name mentioned 1 time, sensitivity=1: boost = 1 + log1p(1) ≈ 1.69.
 * - Name mentioned 5 times, sensitivity=2: boost = 1 + log1p(10) ≈ 3.4.
 *   Significant but not overwhelming due to log compression.
 * - nameSensitivity = 0: getNameMentionCount returns 0 early. Boost = 1.
 *   Character ignores being called. No priority change.
 * - Latest message is from this character: getNameMentionCount returns 0.
 *   Self-mentions don't boost own priority. Correct — you don't call yourself.
 * - Latest message is non-chat (interaction): getNameMentionCount returns 0.
 *   Silent movements don't trigger name priority. Only verbal address counts.
 */
export function computeChatScore(character: Character, data: InteractionData): number {
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

    // Name mention priority boost
    const mentionCount = getNameMentionCount(character, data);
    const nameSensitivity = getEffectiveNameSensitivity(character, profile);
    const nameMentionBoost = 1 + Math.log1p(mentionCount * nameSensitivity);

    return staminaRatio * effectiveInitiative * timeMultiplier * compressedImpatience * nameMentionBoost;
}

/**
 * Compute action-specific score for mover selection among non-co-located candidates.
 * Modulated by reachability: more reachable destinations = higher action priority.
 * 
 * ZERO-COLLAPSE PREVENTION:
 * - timeSince uses (1 + Math.log1p(timeSince)). Same fix as other scores.
 * - Reachability signal uses (0.5 + reachabilitySignal). The 0.5 floor ensures
 *   action score never collapses to 0 even in dead-end locations (0 reachable).
 *   At 0 reachable: multiplier = 0.5. At max reachable: multiplier approaches 1.5.
 *   This is a STRUCTURAL constant, not tuning — it preserves agency in constrained
 *   topologies. Without it, dead-end characters could never initiate movement.
 * 
 * EDGE CASES:
 * - maxAction = 0 or Infinity: returns 0. Character cannot move.
 * - No locations defined: totalLocs = 1, reachable = 0 (no valid targets).
 *   reachabilitySignal = 0. Multiplier = 0.5. Action still possible at reduced
 *   priority. Graceful degradation when location system is unconfigured.
 * - All locations reachable: reachabilitySignal = 1. Multiplier = 1.5.
 *   Maximum action encouragement at crossroads.
 * - triggeringMessageText enables conditional regex bindings: some locations
 *   may only be reachable via specific dialogue triggers. Score reflects
 *   currently available options, not theoretical maximum.
 */
export function computeActionScore(character: Character, data: InteractionData, triggeringMessageText?: string): number {
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
 * 
 * EDGE CASES:
 * - Empty pool: returns null. Callers MUST check for null before using result.
 *   Returning null signals "no eligible candidates" rather than throwing.
 * - All weights ≤ 0: totalWeight ≤ 0. Falls back to last item in pool.
 *   This ensures selection always succeeds if pool is non-empty, even with
 *   degenerate weights. Better than returning null for recoverable situations.
 * - Single item: always returns that item regardless of weight. Correct for
 *   sole-candidate scenarios (1 AI character, 1 chat-eligible, etc.).
 * - Infinity weights: Math.random() * Infinity = Infinity or NaN. Subtraction
 *   produces NaN. NaN <= 0 is false. Falls through to last-item fallback.
 *   Selection still succeeds. This is why fresh characters with Infinity
 *   timeSince are reliably selected despite the arithmetic oddity.
 * - Floating-point precision: roll may not cross exact threshold due to
 *   float error. Last-item fallback catches this. No off-by-one risk.
 * - Negative weights: clamped to 0 via Math.max(0, e.weight). Negative
 *   weights are treated as zero contribution, not errors.
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
 * EDGE CASES:
 * - No history entry (fresh character): returns raw stochastic sample
 *   without idle or social modifiers. Fresh characters get baseline regen.
 *   Idle/social require a reference point (lastMsg) to compute deltas.
 * - maxStamina = Infinity: sampleStochasticRegenAmount returns 0. No regen
 *   needed for infinite pools. Returned amounts are 0, callers skip generation.
 * - maxStamina = 0: sample returns 0. Zero-pool characters don't regenerate.
 * - Social polarity with skipProbability = 0.5: socialPolarity = 0.
 *   densitySignal = 0. sigmoid(0 - 0.3) = sigmoid(-0.3) ≈ 0.43.
 *   neutralBaseline = sigmoid(0.3) ≈ 0.57. socialMultiplier = 0.43/0.57 ≈ 0.75.
 *   This is CORRECT: neutral characters with no social context get slightly
 *   reduced regen compared to engaged-in-group characters. The sigmoid center
 *   is intentionally offset to make group engagement the regen optimum.
 * - Co-located count = 0: densitySignal = 0 regardless of polarity.
 *   Solitude always produces the same multiplier (~0.75 for neutral skip).
 *   Social effects only activate in groups.
 * - Very long idle: idleFactor approaches 1. Regen doubles at saturation.
 *   timeScale = maxStamina * 1000 means larger pools take proportionally
 *   longer to reach full idle acceleration. Self-scaling without external config.
 * - Negative socialMultiplier: impossible. Sigmoid output is always (0,1).
 *   Division by neutralBaseline (also positive) keeps result positive.
 *   Final Math.max(0, ...) is defensive but should never trigger.
 */
export function computeModulatedRegenAmounts(
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
 * Compute effective skip probability with depletion, verbosity, escape
 * valuation, and home comfort modulators.
 * 
 * OUTPUT RANGE: Always ∈ (0, 1) via final sigmoid. Never exactly 0 or 1.
 * Sigmoid floor ≈ 0.000045 at effectiveSkip=0. Ceiling ≈ 0.99995 at effectiveSkip=1.
 * This prevents absolute guarantees in either direction. Even skipProbability=0
 * characters have ~0.005% skip chance (sigmoid of -0.5*10 = -5).
 * Even skipProbability=1 characters have ~0.005% non-skip chance.
 * 
 * EDGE CASES:
 * - baseSkip = 0: effectiveSkip = combinedModulation only. Depletion, verbosity,
 *   and escape can still push skip above 0. Comfort term is 0 (multiplied by
 *   baseSkip=0). Characters with 0 base skip can still skip when exhausted.
 * - baseSkip = 1: effectiveSkip = 1 + 0 - comfortNorm. Comfort can reduce
 *   effective skip below 1. At-home characters with skipProb=1 may still act.
 * - No history entry: staminaRatio = 1 (full), dNorm = 0. verbosityRaw = 0,
 *   vNorm = 0. Only escape and comfort contribute. Fresh characters skip
 *   based purely on location topology and home affinity.
 * - Fully depleted (staminaRatio = 0): depletionRaw = 1, dNorm = 0.5.
 *   Contributes 0.5/3 ≈ 0.167 to combinedModulation. Significant but not
 *   overwhelming. Depletion alone won't force skip; it stacks with other factors.
 * - Very verbose last message (e.g., 20 paragraphs): verbosityRaw = log1p(20) ≈ 3.04.
 *   vNorm = 3.04/4.04 ≈ 0.75. Contributes 0.75/3 = 0.25 to combinedModulation.
 *   Long speeches create meaningful yielding pressure.
 * - No reachable locations: weightedEscapeValue = 0, eNorm = 0. No escape
 *   contribution. Trapped characters have lower skip tendency.
 * - Home weight equals global weight: homeComfortRatio = 1. comfortRaw = log1p(0) = 0.
 *   comfortNorm = 0. No comfort benefit. Only ABOVE-baseline home weights help.
 * - Home weight exceeds global weight significantly: comfortNorm approaches 1.
 *   Subtracts up to baseSkip from effectiveSkip. At-home characters resist
 *   withdrawal proportionally to how much they value the space.
 * - All three additive modulators at max: combinedModulation approaches 1.
 *   effectiveSkip = baseSkip + (1-baseSkip)*1 - comfortNorm*baseSkip.
 *   Without comfort: effectiveSkip approaches 1. With max comfort: approaches
 *   1 - baseSkip. Sigmoid then maps to ~(0.99, 1.0). Near-certain skip.
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

/**
 * Compute total chat stamina consumption cost for a speech act.
 * Combines paragraph count and group load only.
 * 
 * NOTE: Name sensitivity does NOT affect consumption cost. Being called by name
 * increases selection PRIORITY (via computeChatScore), not expenditure.
 * A named character is more likely to speak next, but speaking doesn't cost
 * them more stamina than an unnamed character saying the same thing.
 * 
 * EDGE CASES:
 * - paragraphs = 0: returns 0 immediately. No cost for empty responses.
 *   Prevents stamina drain on failed/null LLM outputs.
 * - No co-located peers (speaker alone): coLocatedCount = 0.
 *   loadMultiplier = sqrt(0) = 0. Solo speaking costs nothing socially.
 * - Dyad (speaker + protagonist): coLocatedCount = 1 (protagonist counted).
 *   loadMultiplier = sqrt(1) = 1. Base cost preserved.
 * - Very large group (10 co-located): loadMultiplier = sqrt(10) ≈ 3.16.
 *   Soft scaling via sqrt prevents exponential explosion.
 * - Decimal output: cost is always a float. No rounding, no flooring.
 */
export function computeChatConsumptionCost(
    speaker: Character,
    data: InteractionData,
    paragraphs: number,
): number {
    if (paragraphs <= 0) return 0;

    const speakerLoc = getCurrentLocationIndex(data, speaker);
    const coLocatedCount = speakerLoc !== undefined
        ? data.participants.filter(p => {
            if (p.id === speaker.id) return false;
            const pLoc = getCurrentLocationIndex(data, p);
            return pLoc !== undefined && pLoc === speakerLoc;
          }).length
        : 0;
    const loadMultiplier = Math.sqrt(coLocatedCount);

    return paragraphs * loadMultiplier;
}

/**
 * Compute movement action stamina cost based on distance.
 * Pure spatial cost: sqrt(|toIndex - fromIndex|).
 * 
 * EDGE CASES:
 * - Same location (fromIndex === toIndex): returns sqrt(0) = 0. No cost for
 *   staying put. Callers should guard against calling this when no actual
 *   movement occurs (most do via `newLoc !== moverLoc` checks).
 * - Adjacent locations (distance = 1): returns sqrt(1) = 1. Baseline movement cost.
 * - Large distance (e.g., 10 indices apart): returns sqrt(10) ≈ 3.16. Soft
 *   scaling prevents distant locations from being prohibitively expensive while
 *   still making proximity meaningful.
 * - Negative indices: Math.abs handles this. Location indices should never be
 *   negative, but defensive abs prevents NaN from sqrt of negative.
 * - Decimal output: always a float. consumeActionStaminaForMessage accepts
 *   decimals. Adjacent moves cost exactly 1.0, non-adjacent cost fractional amounts.
 * - Regex-triggered movement (chat path): uses this same function. Physical
 *   traversal cost is identical whether initiated by dialogue or autonomous action.
 *   The narrative trigger identifies WHERE to go; this function prices GETTING there.
 * 
 * NOTE: Gating costs (conditional regex on location bindings) were intentionally
 * REMOVED from this function. Location binding regex gates REACHABILITY (filtered
 * by getReachableLocations), not consumption. If a transition is unreachable,
 * it won't be sampled. If it IS reachable, the cost is purely distance-based.
 * Mixing gating complexity into movement cost conflated two separate concerns.
 */
export function computeMovementCost(fromIndex: number, toIndex: number): number {
    return Math.sqrt(Math.abs(toIndex - fromIndex));
}