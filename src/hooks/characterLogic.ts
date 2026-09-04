import type { Character, ChatMessage, Profile } from "../types";

export function getEffectiveChatProbability(character: Character, profile?: Profile): number {
    const profileOverride = profile?.chatProbability ?? 0;
    if (profileOverride > 0) return profileOverride;
    return character.chatProbability ?? 0.5;
}

export function getEffectiveMaximumChatStamina(character: Character, profile?: Profile): number {
    const profileOverride = profile?.maximumChatStamina ?? 0;
    if (profileOverride > 0) return profileOverride;
    return character.maximumChatStamina ?? Number.POSITIVE_INFINITY;
}

export function getEffectiveInitiativeWeight(character: Character, profile?: Profile): number {
    if (profile?.forceEqualInitiative) return 1;
    return character.initiativeWeight ?? 1;
}

export function consumeChatStamina(chatMessage: ChatMessage, amountOfChatStaminaConsumed: number) {
    chatMessage.remainingChatStamina = Math.max(0, chatMessage.remainingChatStamina - amountOfChatStaminaConsumed);
}

export function generateChatStamina(character: Character, chatMessage: ChatMessage) {
    const maximumChatStamina = character.maximumChatStamina;
    const remainingChatStamina = chatMessage.remainingChatStamina

    if (maximumChatStamina === Number.POSITIVE_INFINITY) return;
    if (remainingChatStamina === undefined) return; // Treat undefined as infinite stamina, so no generation needed.
    if (remainingChatStamina >= maximumChatStamina) return;
    // Build cumulative distribution using logarithmic weights.
    // Weight for recovering k points = ln(1 + k) where k goes from 1 to deficit.
    // This makes small k values have steeply higher weight than large k values.
    const weights: number[] = [];
    let cumulativeWeight = 0;

    for (let k = 1; k <= maximumChatStamina; k++) {
        const weight = Math.log(1 + k);
        cumulativeWeight += weight;
        weights.push(cumulativeWeight);
    }

    // Sample from the distribution
    const roll = Math.random() * cumulativeWeight;

    // Binary search for the sampled value
    let lo = 0;
    let hi = weights.length - 1;

    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (weights[mid] < roll) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    const amountOfChatStaminaGenerated = lo + 1; // k is 1-indexed

    chatMessage.remainingChatStamina = Math.min(
        maximumChatStamina,
        remainingChatStamina + amountOfChatStaminaGenerated
    );
}