// src/utilities/characterLogic.ts
import type { Character, InteractionData, HistoryMessage, profile, tool, ChatMessage } from "../types";
import { findLatestMessage } from "./messageLogic";
import { getLocalMessageHistory } from "./timelineLogic";

function getEffectiveTriStateBoolean<K extends keyof Character>(key: K, character: Character, profile?: profile): boolean {
    const characterValue = character[key] as boolean;
    const profileValue = profile?.[key as keyof profile] as number | undefined;
    if (profileValue === undefined || profileValue === 0) return characterValue;
    if (profileValue < 0) return false;
    return true;
}

function getEffectiveNumeric<K extends keyof Character>(key: K, character: Character, profile?: profile): number {
    const characterValue = character[key] as number;
    const profileValue = profile?.[key as keyof profile] as number | undefined;
    if (profileValue === undefined || profileValue < 0) return characterValue;
    return profileValue;
}

function getEffectiveRecordStringBoolean(key: string, character: Character, profile?: profile): Record<string, boolean> {
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

export function getEffectiveUseFrontCameraImage(character: Character, profile?: profile){
    return getEffectiveTriStateBoolean("useFrontCameraImage", character, profile)
}

export function getEffectiveChatProbability(character: Character, profile?: profile): number {
    return getEffectiveNumeric("chatProbability", character, profile);
}

export function getEffectiveMaximumChatStamina(character: Character, profile?: profile): number {
    return getEffectiveNumeric("maximumChatStamina", character, profile);
}

export function getEffectiveInitiativeWeight(character: Character, profile?: profile): number {
    if (profile?.forceEqualInitiative) return 1;
    return character.initiativeWeight ?? 1;
}

export function getEffectiveNameSensitivity(character: Character, profile?: profile): number {
    return getEffectiveNumeric("nameSensitivity", character, profile);
}

export function getEffectiveChatImpatienceSensitivity(character: Character, profile?: profile): number {
    return getEffectiveNumeric("chatImpatienceSensitivity", character, profile);
}

export function getEffectiveSkipProbability(character: Character, profile?: profile): number {
    return getEffectiveNumeric("skipProbability", character, profile);
}

export function getEffectiveMemoryRetentionWeight(character: Character, profile?: profile): number {
    return getEffectiveNumeric("memoryRetentionWeight", character, profile);
}

export function getEffectiveContextSensitivity(character: Character, profile?: profile): number {
    return getEffectiveNumeric("contextSensitivity", character, profile);
}

export function getEffectiveMaximumActionStamina(character: Character, profile?: profile): number {
    return getEffectiveNumeric("maximumActionStamina", character, profile);
}

export function getEffectiveMessagesToDisableThinkPrompt(character: Character, profile?: profile): number {
    return getEffectiveNumeric("numberOfMessagesToDisableThinkPrompt", character, profile);
}

export function getEffectiveMessagesToDisableMetaThinkInstructions(character: Character, profile?: profile): number {
    return getEffectiveNumeric("numberOfMessagesToDisableMetaThinkInstructions", character, profile);
}

export function getEffectiveMessagesToDisableDialoguePrompt(character: Character, profile?: profile): number {
    return getEffectiveNumeric("numberOfMessagesToDisableDialoguePrompt", character, profile);
}

export function getEffectiveMessagesToDisableStarterPrompt(character: Character, profile?: profile): number {
    return getEffectiveNumeric("numberOfMessagesToDisableStarterPrompt", character, profile);
}

export function getEffectiveTools(character: Character, profile?: profile): Record<tool, boolean> {
    return getEffectiveRecordStringBoolean("tools", character, profile);
}

export function isToolEnabled(character: Character, toolName: tool, profile?: profile): boolean {
    const effectiveTools = getEffectiveTools(character, profile);
    return effectiveTools[toolName] ?? false;
}

export function getNameSensitivityMultiplier(character: Character, interactionData: InteractionData): number {
    const sensitivity = getEffectiveNameSensitivity(character, interactionData.profile);
    if (sensitivity === 0) return 1;

    const globalHistory = getLocalMessageHistory(interactionData, character, ['chat']);
    if (globalHistory.length === 0) return 1;

    const latestMessage = globalHistory[globalHistory.length - 1] as ChatMessage;
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

export function generateChatStaminaForMessage(interactionMessage: HistoryMessage, amountOfChatStaminaGenerated: number, character: Character, profile?: profile) {
    const maximumChatStamina = getEffectiveMaximumChatStamina(character, profile);
    const remainingChatStamina = interactionMessage.remainingChatStamina;

    if (maximumChatStamina === Number.POSITIVE_INFINITY) return;
    if (remainingChatStamina === undefined) return;
    if (remainingChatStamina >= maximumChatStamina) return;

    const newRemainingChatStamina = Math.min(
        maximumChatStamina,
        remainingChatStamina + amountOfChatStaminaGenerated
    );

    interactionMessage.remainingChatStamina = newRemainingChatStamina;
}

export function generateActionStaminaForMessage(interactionMessage: HistoryMessage, amountOfActionStaminaGenerated: number, character: Character, profile?: profile) {
    const maximumActionStamina = getEffectiveMaximumActionStamina(character, profile);
    const remainingActionStamina = interactionMessage.remainingActionStamina;

    if (maximumActionStamina === Number.POSITIVE_INFINITY) return;
    if (remainingActionStamina === undefined) return;
    if (remainingActionStamina >= maximumActionStamina) return;

    const newRemainingActionStamina = Math.min(
        maximumActionStamina,
        remainingActionStamina + amountOfActionStaminaGenerated
    );

    interactionMessage.remainingActionStamina = newRemainingActionStamina;
}

/**
 * Regenerate chat stamina for a character based on their previous interaction.
 * Mutates the interactionHistories in place by updating the character's last entry.
 */
export function generateChatStaminaForInteractionData(data: InteractionData, amountOfChatStamina: number, character: Character) {
    const maximumChatStamina = getEffectiveMaximumChatStamina(character, data.profile);
    if (maximumChatStamina === Number.POSITIVE_INFINITY) return;
    
    // FIX: Replaced obsolete findPreviousMessage with spatial findLatestMessage
    const latest = findLatestMessage(data, character);
    const previousMessage = latest?.message;
    if (!previousMessage) return;
    
    generateChatStaminaForMessage(previousMessage, amountOfChatStamina, character, data.profile);
}

/**
 * Regenerate action stamina for a character based on their previous interaction.
 * Mutates the interactionHistories in place by updating the character's last entry.
 */
export function generateActionStaminaForInteractionData(data: InteractionData, amountOfActionStamina: number, character: Character) {
    const maximumActionStamina = getEffectiveMaximumActionStamina(character, data.profile);
    if (maximumActionStamina === Number.POSITIVE_INFINITY) return;
    
    // FIX: Replaced obsolete findPreviousMessage with spatial findLatestMessage
    const latest = findLatestMessage(data, character);
    const previousMessage = latest?.message;
    if (!previousMessage) return;
    
    generateActionStaminaForMessage(previousMessage, amountOfActionStamina, character, data.profile);
}

/**
 * Count how many times a character's name (full or partial) appears in the
 * most recent chat message, excluding mentions that overlap with other
 * participants' names.
 */
export function getNameMentionCount(character: Character, interactionData: InteractionData): number {
    const sensitivity = getEffectiveNameSensitivity(character, interactionData.profile);
    if (sensitivity === 0) return 0;

    // FIX: Replaced flat interactionHistory array with spatial getLocalMessageHistory
    const localHistory = getLocalMessageHistory(interactionData, character, ['chat']);
    if (localHistory.length === 0) return 0;

    const latestMessage = localHistory[localHistory.length - 1] as ChatMessage;
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

export function initializeClothingWearingStatuses(character: Character): Record<string, boolean> {
    const clothings = character.clothings;
    if (!clothings || clothings.length === 0) return {};

    const statuses: Record<string, boolean> = {};
    for (const clothing of clothings) {
        const probability = clothing.initialWearingProbability ?? 1;
        statuses[clothing.id] = probability >= 1 ? true : probability <= 0 ? false : Math.random() < probability;
    }
    return statuses;
}

export function getCharacterStarterMessage(character: Character): string {
    const starterPrompts = character.starterPrompts;
    if (!starterPrompts) return `*${character.name} enters the scene.*`;

    const entries = Object.entries(starterPrompts).filter(([text]) => text.trim().length > 0);
    if (entries.length === 0) return `*${character.name} enters the scene.*`;

    const totalWeight = entries.reduce((sum, [, weight]) => sum + (weight > 0 ? weight : 1), 0);
    let random = Math.random() * totalWeight;
    let chosen = entries[0][0];

    for (const [text, weight] of entries) {
        const w = weight > 0 ? weight : 1;
        if (random < w) {
            chosen = text;
            break;
        }
        random -= w;
    }
    return chosen.replace(/\{\{char\}\}/gi, character.name);
}