// src/hooks/characterLogic.ts
import type { Character, InteractionData, HistoryMessage, Profile, tool } from "../types";
import { findPreviousMessage } from "./chatLogic";

function getEffectiveNumeric<K extends keyof Character>(key: K, character: Character, profile?: Profile): number {
    const characterValue = character[key] as number;
    const profileValue = profile?.[key as keyof Profile] as number | undefined;
    if (profileValue === undefined || profileValue < 0) return characterValue;
    return profileValue;
}

function getEffectiveTriStateBoolean<K extends keyof Character>(key: K, character: Character, profile?: Profile): boolean {
    const characterValue = character[key] as boolean;
    const profileValue = profile?.[key as keyof Profile] as number | undefined;
    if (profileValue === undefined || profileValue === 0) return characterValue;
    if (profileValue < 0) return false;
    return true;
}

function getEffectiveToolRecord(character: Character, profile?: Profile): Record<tool, boolean> {
    const characterTools = character.tools;
    const profileTools = profile?.tools;

    if (!profileTools) return { ...characterTools };

    const result = {} as Record<tool, boolean>;
    for (const key of Object.keys(characterTools) as tool[]) {
        const profileValue = profileTools[key];
        if (profileValue === undefined || profileValue === 0) {
            // Defer to character setting
            result[key] = characterTools[key];
        } else if (profileValue < 0) {
            // Force off
            result[key] = false;
        } else {
            // Force on
            result[key] = true;
        }
    }
    return result;
}

export function getEffectiveChatProbability(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("chatProbability", character, profile);
}

export function getEffectiveMaximumChatStamina(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("maximumChatStamina", character, profile);
}

export function getEffectiveInitiativeWeight(character: Character, profile?: Profile): number {
    if (profile?.forceEqualInitiative) return 1;
    return character.initiativeWeight ?? 1;
}

export function getEffectiveNameSensitivity(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("nameSensitivity", character, profile);
}

export function getEffectiveChatImpatienceSensitivity(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("chatImpatienceSensitivity", character, profile);
}

export function getEffectiveSkipProbability(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("skipProbability", character, profile);
}

export function getEffectiveMemoryRetentionWeight(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("memoryRetentionWeight", character, profile);
}

export function getEffectiveContextSensitivity(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("contextSensitivity", character, profile);
}

export function getEffectiveMaximumActionStamina(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("maximumActionStamina", character, profile);
}

export function getEffectiveMessagesToDisableThinkPrompt(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("numberOfMessagesToDisableThinkPrompt", character, profile);
}

export function getEffectiveMessagesToDisableMetaThinkInstructions(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("numberOfMessagesToDisableMetaThinkInstructions", character, profile);
}

export function getEffectiveMessagesToDisableDialoguePrompt(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("numberOfMessagesToDisableDialoguePrompt", character, profile);
}

export function getEffectiveEnableMemoryWriting(character: Character, profile?: Profile): boolean {
    return getEffectiveTriStateBoolean("enableMemoryWriting", character, profile);
}

export function getEffectiveEnableMemoryReading(character: Character, profile?: Profile): boolean {
    return getEffectiveTriStateBoolean("enableMemoryReading", character, profile);
}

export function getEffectiveTools(character: Character, profile?: Profile): Record<tool, boolean> {
    return getEffectiveToolRecord(character, profile);
}

export function isToolEnabled(character: Character, toolName: tool, profile?: Profile): boolean {
    const effectiveTools = getEffectiveTools(character, profile);
    return effectiveTools[toolName] ?? false;
}

export function getNameSensitivityMultiplier(character: Character, interactionData: InteractionData): number {
    const sensitivity = getEffectiveNameSensitivity(character, interactionData.Profile);
    if (sensitivity === 0) return 1;

    const history = interactionData.interactionHistory;
    if (history.length === 0) return 1;

    const latestMessage = history[history.length - 1];
    if (latestMessage.messageType !== 'chat') return 1;
    if (latestMessage.character.id === character.id) return 1;

    const textLower = latestMessage.textContent.toLowerCase();
    const fullNameLower = character.name.toLowerCase().trim();

    // Build ignore list: other participants' full names
    const ignoreRanges: { start: number; end: number }[] = [];
    for (const participant of interactionData.participants) {
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

export function consumeChatStaminaForMessage(interactionMessage: HistoryMessage, amountOfChatStaminaConsumed: number) {
    if (interactionMessage.messageType === 'interaction' || interactionMessage.remainingChatStamina === undefined) return;
    interactionMessage.remainingChatStamina = Math.max(0, interactionMessage.remainingChatStamina - amountOfChatStaminaConsumed);
}

export function consumeActionStaminaForMessage(interactionMessage: HistoryMessage, amountOfActionStaminaConsumed: number) {
    if (interactionMessage.messageType === 'chat' || interactionMessage.remainingActionStamina === undefined) return;
    interactionMessage.remainingActionStamina = Math.max(0, interactionMessage.remainingActionStamina - amountOfActionStaminaConsumed);
}

export function generateChatStaminaForMessage(character: Character, interactionMessage: HistoryMessage, profile?: Profile) {
    const maximumChatStamina = getEffectiveMaximumChatStamina(character, profile);
    const remainingChatStamina = interactionMessage.remainingChatStamina;

    if (maximumChatStamina === Number.POSITIVE_INFINITY) return;
    if (remainingChatStamina === undefined) return;
    if (remainingChatStamina >= maximumChatStamina) return;

    const weights: number[] = [];
    let cumulativeWeight = 0;

    for (let k = 1; k <= maximumChatStamina; k++) {
        const weight = Math.log(1 + k);
        cumulativeWeight += weight;
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

    const amountOfChatStaminaGenerated = lo + 1;

    const newRemainingChatStamina = Math.min(
        maximumChatStamina,
        remainingChatStamina + amountOfChatStaminaGenerated
    );

    interactionMessage.remainingChatStamina = newRemainingChatStamina
}

export function generateActionStaminaForMessage(character: Character, interactionMessage: HistoryMessage, profile?: Profile) {
    const maximumActionStamina = getEffectiveMaximumActionStamina(character, profile);
    const remainingActionStamina = interactionMessage.remainingActionStamina;

    if (maximumActionStamina === Number.POSITIVE_INFINITY) return;
    if (remainingActionStamina === undefined) return;
    if (remainingActionStamina >= maximumActionStamina) return;

    const weights: number[] = [];
    let cumulativeWeight = 0;

    for (let k = 1; k <= maximumActionStamina; k++) {
        const weight = Math.log(1 + k);
        cumulativeWeight += weight;
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

    const amountOfActionStaminaGenerated = lo + 1;

    const newRemainingActionStamina = Math.min(
        maximumActionStamina,
        remainingActionStamina + amountOfActionStaminaGenerated
    );

    interactionMessage.remainingActionStamina = newRemainingActionStamina

}

/**
 * Regenerate chat stamina for a character based on their previous interaction.
 * Mutates the interactionHistory in place by updating the character's last entry.
 */
export function generateChatStaminaForInteractionData(data: InteractionData, character: Character) {
    const maxStamina = getEffectiveMaximumChatStamina(character, data.Profile);
    if (maxStamina === Number.POSITIVE_INFINITY) return
    const previousMessage = findPreviousMessage(data, character.id)
    if (!previousMessage) return
    generateChatStaminaForMessage(character, previousMessage);
}

/**
 * Regenerate action stamina for a character based on their previous interaction.
 * Mutates the interactionHistory in place by updating the character's last entry.
 */
export function generateActionStaminaForInteractionData(data: InteractionData, character: Character) {
    const maxStamina = getEffectiveMaximumActionStamina(character, data.Profile);
    if (maxStamina === Number.POSITIVE_INFINITY) return
    const previousMessage = findPreviousMessage(data, character.id)
    if (!previousMessage) return
    generateActionStaminaForMessage(character, previousMessage);
}