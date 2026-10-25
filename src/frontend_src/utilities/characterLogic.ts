import type { Character, InteractionData, HistoryMessage, Profile, tool, ChatMessage } from "../types";
import { findLatestMessage } from "./messageLogic";
import { getLocalMessageHistory } from "./timelineLogic";
import { traverseStochasticGraph, type StochasticGraphNode } from "./graphLogic";
import { weightedSample } from "./dynamicCharacterLogic";

function getEffectiveTriStateBoolean<K extends keyof Character>(key: K, character: Character, profile?: Profile): boolean {
    const characterValue = character[key] as boolean;
    const profileValue = profile?.[key as keyof Profile] as number | undefined;
    if (profileValue === undefined || profileValue === 0) return characterValue;
    if (profileValue < 0) return false;
    return true;
}

export function getEffectiveUseFrontCameraImage(character: Character, profile?: Profile): boolean {
    return getEffectiveTriStateBoolean("useFrontCameraImage", character, profile);
}

export function getCharacterNameVariants(character: Character, toLowerCase = false): string[] {
    const variants = new Set<string>();
    if (character.name) variants.add(toLowerCase ? character.name.toLowerCase() : character.name);
    if (character.aliases) {
        for (const alias of character.aliases) {
            if (alias) variants.add(toLowerCase ? alias.toLowerCase() : alias);
        }
    }
    return Array.from(variants);
}

function getEffectiveNumeric<K extends keyof Character>(key: K, character: Character, profile?: Profile): number {
    const characterValue = character[key] as number;
    const profileValue = profile?.[key as keyof Profile] as number | undefined;
    if (profileValue === undefined || profileValue < 0) return characterValue;
    return profileValue;
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
export function getEffectiveChatStaminaRegenerationRate(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("chatStaminaRegenerationRate", character, profile);
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
export function getEffectiveActionStaminaRegenerationRate(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("actionStaminaRegenerationRate", character, profile);
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
export function getEffectiveMessagesToDisableStarterPrompt(character: Character, profile?: Profile): number {
    return getEffectiveNumeric("numberOfMessagesToDisableStarterPrompt", character, profile);
}
export function getEffectiveTools(character: Character, profile?: Profile): Record<tool, boolean> {
    return getEffectiveRecordStringBoolean("tools", character, profile);
}
export function isToolEnabled(character: Character, toolName: tool, profile?: Profile): boolean {
    return getEffectiveTools(character, profile)[toolName] ?? false;
}
export function getEnabledTools(character: Character, profile: Profile | undefined): string[] {
    const effectiveTools = getEffectiveTools(character, profile);
    return (Object.keys(effectiveTools) as tool[]).filter(t => effectiveTools[t]);
}

export function getNameSensitivityMultiplier(character: Character, interactionData: InteractionData): number {
    const sensitivity = getEffectiveNameSensitivity(character, interactionData.profile);
    if (sensitivity === 0) return 1;
    const mentionCount = getNameMentionCount(character, interactionData);
    return (mentionCount * sensitivity) + 1;
}

export function getNameMentionCount(character: Character, interactionData: InteractionData): number {
    const sensitivity = getEffectiveNameSensitivity(character, interactionData.profile);
    if (sensitivity === 0) return 0;

    const localHistory = getLocalMessageHistory(interactionData, character, ['chat']);
    if (localHistory.length === 0) return 0;

    const latestMessage = localHistory[localHistory.length - 1] as ChatMessage;
    if (latestMessage.character.id === character.id) return 0;

    const textLower = latestMessage.textContent.toLowerCase();
    const fullNameLower = character.name.toLowerCase();

    const ignoreRanges: { start: number; end: number }[] = [];
    for (const participant of interactionData.participants) {
        if (participant.id === character.id) continue;
        const otherNameLower = participant.name.toLowerCase();
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
    let searchIndex = 0;
    while (true) {
        const foundIndex = textLower.indexOf(fullNameLower, searchIndex);
        if (foundIndex === -1) break;
        if (!isIgnored(foundIndex, fullNameLower.length)) mentionCount++;
        searchIndex = foundIndex + fullNameLower.length;
    }

    const nameParts = new Set<string>();
    for (const part of fullNameLower.split(/\s+/)) {
        if (part.length >= 2 && part !== fullNameLower) nameParts.add(part);
    }

    for (const namePart of nameParts) {
        let partSearchIndex = 0;
        while (true) {
            const foundIndex = textLower.indexOf(namePart, partSearchIndex);
            if (foundIndex === -1) break;
            if (!isIgnored(foundIndex, namePart.length)) mentionCount++;
            partSearchIndex = foundIndex + namePart.length;
        }
    }

    return mentionCount;
}

export function consumeChatStaminaForMessage(interactionMessage: HistoryMessage, amount: number) {
    if (interactionMessage.remainingChatStamina === undefined) return;
    interactionMessage.remainingChatStamina = Math.max(0, interactionMessage.remainingChatStamina - amount);
}

export function consumeActionStaminaForMessage(interactionMessage: HistoryMessage, amount: number) {
    if (interactionMessage.remainingActionStamina === undefined) return;
    interactionMessage.remainingActionStamina = Math.max(0, interactionMessage.remainingActionStamina - amount);
}

export function generateChatStaminaForInteractionData(data: InteractionData, amount: number, character: Character) {
    const maximum = getEffectiveMaximumChatStamina(character, data.profile);
    if (maximum === Number.POSITIVE_INFINITY) return;
    const latest = findLatestMessage(data, character)?.message;
    if (!latest || latest.remainingChatStamina === undefined || latest.remainingChatStamina >= maximum) return;
    latest.remainingChatStamina = Math.min(maximum, latest.remainingChatStamina + amount);
}

export function generateActionStaminaForInteractionData(data: InteractionData, amount: number, character: Character) {
    const maximum = getEffectiveMaximumActionStamina(character, data.profile);
    if (maximum === Number.POSITIVE_INFINITY) return;
    const latest = findLatestMessage(data, character)?.message;
    if (!latest || latest.remainingActionStamina === undefined || latest.remainingActionStamina >= maximum) return;
    latest.remainingActionStamina = Math.min(maximum, latest.remainingActionStamina + amount);
}

export function initializeClothingWearingStatuses(character: Character): Record<string, boolean> {
    const clothings = character.clothings;
    if (!clothings || clothings.length === 0) return {};
    const statuses: Record<string, boolean> = {};
    for (const clothing of clothings) {
        const prob = clothing.initialWearingProbability ?? 1;
        statuses[clothing.id] = prob >= 1 ? true : prob <= 0 ? false : Math.random() < prob;
    }
    return statuses;
}

export function getCharacterStarterMessage(character: Character): string {
    const starterPrompts = character.starterPrompts;
    if (!starterPrompts || starterPrompts.length === 0) return `*${character.name} enters the scene.*`;
    const entries = starterPrompts.filter(sp => sp.textContent && sp.textContent.length > 0);
    if (entries.length === 0) return `*${character.name} enters the scene.*`;

    const pool = entries.map(sp => ({ item: sp.textContent, weight: sp.weight > 0 ? sp.weight : 1 }));
    const chosen = weightedSample(pool) ?? entries[0].textContent;
    return chosen.replace(/\{\{char\}\}/gi, character.name);
}

export function generateInitialCharacterText(character: Character): string {
    const injections = character.textCharacterInjections;
    if (!injections || injections.length === 0) return '';

    const nodes: StochasticGraphNode<string>[] = injections.map(inj => {
        let picked = '';
        if (inj.textCharacters && inj.textCharacters.length > 0) {
            const charPool = inj.textCharacters.map((text, idx) => ({
                item: text,
                weight: inj.textCharacterWeights?.[idx] ?? 1,
            }));
            picked = weightedSample(charPool) ?? inj.textCharacters[0];
        }
        return {
            id: inj.id,
            weight: inj.textCharacterInjectionWeight ?? 1,
            skipProbability: inj.textCharacterSkipProbability ?? 0,
            breakProbability: inj.textCharacterBreakProbability ?? 0,
            bindings: inj.textCharacterInjectionBindings,
            payload: picked,
        };
    });

    const segments = traverseStochasticGraph(nodes);
    return segments.join('');
}