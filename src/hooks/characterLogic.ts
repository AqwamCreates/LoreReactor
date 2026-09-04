import type { Character, ChatData, ChatMessage, Profile } from "../types";

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

export function getEffectiveNameSensitivity(character: Character, profile?: Profile): number {
    const profileValue = profile?.nameSensitivity;
    if (profileValue === undefined || profileValue === -1) return character.nameSensitivity ?? 1;
    return profileValue;
}

export function getEffectiveResponseDelayWeight(character: Character, profile?: Profile): number {
    const profileValue = profile?.responseDelayWeight;
    if (profileValue === undefined || profileValue === -1) return character.responseDelayWeight ?? 0;
    return profileValue;
}

export function getNameSensitivityMultiplier(character: Character, chatData: ChatData): number {
    const sensitivity = getEffectiveNameSensitivity(character, chatData.Profile);
    if (sensitivity === 0) return 1;

    const history = chatData.chatMessageHistory;
    if (history.length === 0) return 1;

    const latestMessage = history[history.length - 1];
    if (latestMessage.character.id === character.id) return 1;

    const textLower = latestMessage.textContent.toLowerCase();
    const fullNameLower = character.name.toLowerCase().trim();

    // Build ignore list: other participants' full names
    const ignoreRanges: { start: number; end: number }[] = [];
    for (const participant of chatData.participants) {
        if (participant.id === character.id) continue;
        const otherNameLower = participant.name.toLowerCase().trim();
        if (otherNameLower === fullNameLower) continue;
        let searchIndex = 0;
        while (true) {
            const foundIndex = textLower.indexOf(otherNameLower, searchIndex);
            if (foundIndex === -1) break;
            ignoreRanges.push({ start: foundIndex, end: foundIndex + otherNameLower.length });
            searchIndex = foundIndex + otherNameLower.length;
        }
    }

    const isIgnored = (matchStart: number, matchLength: number): boolean => {
        const matchEnd = matchStart + matchLength;
        for (const range of ignoreRanges) {
            // Overlap check: match overlaps with ignore range if they share any characters
            if (matchStart < range.end && matchEnd > range.start) return true;
        }
        return false;
    };

    let mentionCount = 0;

    // Step 1: Scan for full name first
    let searchIndex = 0;
    while (true) {
        const foundIndex = textLower.indexOf(fullNameLower, searchIndex);
        const fullNameLength = fullNameLower.length;
        if (foundIndex === -1) break;
        if (!isIgnored(foundIndex, fullNameLength)) {
            mentionCount++;
        }
        searchIndex = foundIndex + fullNameLength;
    }

    // Step 2: Split into parts and scan for partial names (min 2 chars)
    const nameParts = new Set<string>();
    for (const part of fullNameLower.split(/\s+/)) {
        if (part.length >= 2 && part !== fullNameLower) nameParts.add(part);
    }

    for (const namePart of nameParts) {
        let partSearchIndex = 0;
        while (true) {
            const foundIndex = textLower.indexOf(namePart, partSearchIndex);
            if (foundIndex === -1) break;
            if (!isIgnored(foundIndex, namePart.length)) {
                mentionCount++;
            }
            partSearchIndex = foundIndex + namePart.length;
        }
    }

    const multiplier = (mentionCount * sensitivity) + 1;

    return multiplier;
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