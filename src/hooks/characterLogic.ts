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

function getEffectiveRecordStringBoolean(key: string, character: Character, profile?: Profile): Record<string, boolean> {
    const charAny = character as unknown as Record<string, unknown>;
    const characterRecord = (charAny[key] ?? {}) as Record<string, boolean>;
    if (!profile) return characterRecord;
    const profAny = profile as unknown as Record<string, unknown>;
    const profileRecord = profAny[key] as Record<string, number> | undefined;

    if (!profileRecord) return { ...characterRecord };

    const result = {} as Record<string, boolean>;

    for (const k of Object.keys(characterRecord)) {
        const profileValue = profileRecord[k];
        if (profileValue === undefined || profileValue === 0) {
            result[k] = characterRecord[k];
        } else if (profileValue < 0) {
            result[k] = false;
        } else {
            result[k] = true;
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
    return getEffectiveRecordStringBoolean("tools", character, profile);
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
    if (interactionMessage.remainingChatStamina === undefined) return;
    interactionMessage.remainingChatStamina = Math.max(0, interactionMessage.remainingChatStamina - amountOfChatStaminaConsumed);
}

export function consumeActionStaminaForMessage(interactionMessage: HistoryMessage, amountOfActionStaminaConsumed: number) {
    if (interactionMessage.remainingActionStamina === undefined) return;
    interactionMessage.remainingActionStamina = Math.max(0, interactionMessage.remainingActionStamina - amountOfActionStaminaConsumed);
}

export function generateChatStaminaForMessage(interactionMessage: HistoryMessage, amountOfChatStaminaGenerated: number, character: Character, profile?: Profile) {
    const maximumChatStamina = getEffectiveMaximumChatStamina(character, profile);
    const remainingChatStamina = interactionMessage.remainingChatStamina;

    if (maximumChatStamina === Number.POSITIVE_INFINITY) return;
    if (remainingChatStamina === undefined) return;
    if (remainingChatStamina >= maximumChatStamina) return;

    const newRemainingChatStamina = Math.min(
        maximumChatStamina,
        remainingChatStamina + amountOfChatStaminaGenerated
    );

    interactionMessage.remainingChatStamina = newRemainingChatStamina
}

export function generateActionStaminaForMessage(interactionMessage: HistoryMessage,  amountOfActionStaminaGenerated: number, character: Character, profile?: Profile) {
    const maximumActionStamina = getEffectiveMaximumActionStamina(character, profile);
    const remainingActionStamina = interactionMessage.remainingActionStamina;

    if (maximumActionStamina === Number.POSITIVE_INFINITY) return;
    if (remainingActionStamina === undefined) return;
    if (remainingActionStamina >= maximumActionStamina) return;

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
export function generateChatStaminaForInteractionData(data: InteractionData, amountOfChatStamina: number, character: Character) {
    const maximumChatStamina = getEffectiveMaximumChatStamina(character, data.Profile);
    if (maximumChatStamina === Number.POSITIVE_INFINITY) return
    const previousMessage = findPreviousMessage(data, character.id)
    if (!previousMessage) return
    generateChatStaminaForMessage(previousMessage, amountOfChatStamina, character, data.Profile);
}

/**
 * Regenerate action stamina for a character based on their previous interaction.
 * Mutates the interactionHistory in place by updating the character's last entry.
 */
export function generateActionStaminaForInteractionData(data: InteractionData, amountOfActionStamina: number, character: Character) {
    const maximumActionStamina = getEffectiveMaximumActionStamina(character, data.Profile);
    if (maximumActionStamina === Number.POSITIVE_INFINITY) return
    const previousMessage = findPreviousMessage(data, character.id)
    if (!previousMessage) return
    generateActionStaminaForMessage(previousMessage, amountOfActionStamina, character, data.Profile);
}

/**
 * Count how many times a character's name (full or partial) appears in the
 * most recent chat message, excluding mentions that overlap with other
 * participants' names.
 * 
 * Returns 0 if:
 * - History is empty
 * - Latest message is not a chat message
 * - Latest message was sent by this character (self-mentions don't count)
 * - nameSensitivity = 0
 * - Name doesn't appear in the message text
 */
export function getNameMentionCount(character: Character, interactionData: InteractionData): number {
    const sensitivity = getEffectiveNameSensitivity(character, interactionData.Profile);
    if (sensitivity === 0) return 0;

    const history = interactionData.interactionHistory;
    if (history.length === 0) return 0;

    const latestMessage = history[history.length - 1];
    if (latestMessage.messageType !== 'chat') return 0;
    if (latestMessage.character.id === character.id) return 0;

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

    // Full name scan
    let searchIndex = 0;
    while (true) {
        const foundIndex = textLower.indexOf(fullNameLower, searchIndex);
        if (foundIndex === -1) break;
        if (!isIgnored(foundIndex, fullNameLower.length)) {
            mentionCount++;
        }
        searchIndex = foundIndex + fullNameLower.length;
    }

    // Partial name scan (min 2 chars, excluding full name itself)
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

    return mentionCount;
}