// src/hooks/promptLogic.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage, WhisperMessage, Context, StopPattern, PromptBlock, PromptBlockType, regularExpressionContext, regularExpressionTarget, tool, Location, RegularExpressionTrigger, Clothing, Profile } from '../types';
import type { ModelTemplate } from '../dictionaries/modelTemplates';
import { fetchMultipleContextUrls } from '../services/linkFetcher';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getEffectiveTools, getEffectiveMaximumChatStamina, getEffectiveMessagesToDisableDialoguePrompt, getEffectiveMessagesToDisableMetaThinkInstructions, getEffectiveMessagesToDisableThinkPrompt, getEffectiveMessagesToDisableStarterPrompt } from './characterLogic';
import { toolStartSring, toolEndString } from '../dictionaries/stringList';
import { fetchCurrentWeather, getLocation, getLocalTimeFromCoordinates } from '../services/LocationEngine';
import { getCoLocatedProtagonists, getReachableLocationsByCharacter } from './locationLogic';
import { defaultInputStrategy } from '../dictionaries/defaults';
import { getModelTemplate } from '../dictionaries/modelTemplates';
import { generateLocationVisitSummary } from '../services/ChatMessageSummarizationEngine';
import { compileTriggerRegexes, findPreviousMessage } from './chatLogic';
import { collectActiveDialoguePromptContent, buildDialogueSearchSpace } from './dialoguePromptLogic';

const topicExpansionInstructions = "If the conversation becomes stagnant or repetitive, I will naturally introduce a related but fresh topic that aligns with my character's perspective and keeps the dialogue engaging.";
const beingIgnoredInstructions = "Anytime a character ignores me talking, there would be an awkward atmosphere.";
const noHallucinationInstructions = "I will also use existent information instead of creating non-existent information. I am only allowed to assume other characters' external dialogues and actions if I am predicting them.";
const noEmptyResponseInstructions = "I will also always create a response instead of giving empty ones.";
const mistakeCorrectionInstructions = "If I accidentally create a text that deviates from the prompts, I will fix it by creating a new text to ensure the existing texts satisfies the prompts.";
const languageInstructions = "I will respond exclusively in the language established by the prompts or prior conversation turns.";
const literaryDeviceInstructions = "I may or may not use these literary devices: Dialogue, Quotation, Simile, Metaphor, Personification, Onomatopoeia, Hyperbole, Oxymoron, Paradox, Alliteration, Assonance, Consonance, Repetition/Anaphora, Rhetorical Question, Sensory Imagery, Irony, Foreshadowing, Symbolism, Motif, Juxtaposition, Pathetic Fallacy, Zoomorphism, Ellipsis, Em Dash, Asyndeton, Polysyndeton, Chiasmus.";

const contextAuthorityInstructions = "Information provided in the Context blocks about the environment, situation, and world state is the absolute truth. Context of my own physical appearance defer to what is visible in my character image.";
const summarizationAwarenessInstructions = "If a previous conversation turns appear condensed or summarized, I will treat them as established long-term memory, not as a story recap. I will maintain continuity with these events as if they just happened.";
const noRepeatInstructions = "If I want to repeat myself or others, I will talk about something else that may include creating new structures or stop creating text gracefully, regardless of the paragraphs, sentences, phrases, words and so on.";
const noRestrictionsInstructions = "I understand that the amount and intensity of explicitness, moralizing, refusal or filter must satisfy the prompts.";
const formatInstructions = "I will always end a format before starting a new one. I will provide an optimal response in terms of quality, verbosity, sentence length, paragraph length and so on.";

const DEFAULT_MAX_RECURSION_DEPTH = 5;
const DEFAULT_CONTEXT_TOKEN_BUDGET = 2048;

const tokenEngine = getLanguageModelEngine();

type CombinationCache = Record<string, Record<string, { characterIdArray: string[]; textContentArray: string[] }>>;

// ─── Image Reference Type ──────────────────────────────────────────

export interface EntityImageRef {
    entityId: string;
    filename: string;
}

// ─── Dynamic Prompt Delimiters ─────────────────────────────────────

interface PromptDelimiters {
    blockStart: (role: string) => string;
    blockEnd: string;
    turnStart: (role: string) => string;
    turnEnd: string;
    thinkStart: string;
    thinkEnd: string;
}

export function deriveDelimiters(template?: ModelTemplate): PromptDelimiters {
    const thinkStart = template?.thinkStart || '<think>';
    const thinkEnd = template?.thinkEnd || '</think>';
    const chatTemplate = template?.chatTemplate;

    if (!chatTemplate) {
        return {
            blockStart: (role) => `[${role}]\n`,
            blockEnd: "\n",
            turnStart: (role) => `${role}: `,
            turnEnd: "\n",
            thinkStart,
            thinkEnd,
        };
    }

    const contentPlaceholder = chatTemplate.includes('{content}') ? '{content}' : '{Content}';
    const parts = chatTemplate.split(contentPlaceholder);
    const beforeContent = parts[0] || '';
    const afterContent = parts[1] || '';
    
    const hasRole = /{role}/i.test(beforeContent);

    const blockStart = (role: string) => {
        if (hasRole) {
            return beforeContent.replace(/{role}/gi, role);
        }
        return beforeContent;
    };

    return {
        blockStart,
        blockEnd: afterContent,
        turnStart: blockStart,
        turnEnd: afterContent,
        thinkStart,
        thinkEnd,
    };
}

// ─── Prompt Build Context ─────────────────────────────────────────

interface PromptBuildContext {
    interactionData: InteractionData;
    character: Character;
    knownNames: Record<string, Record<string, boolean>>;
    modelId: string;
    allPromptBlocks: PromptBlock[];
    existingCharacterText: string;

    interactionHistory: HistoryMessage[];
    participants: Character[];
    coLocatedProtagonists: Character[];
    protagonistIds: Set<string>;
    characterId: string;
    characterParticipantId: number;
    characterParticipantTag: string;
    characterName: string;
    profile: Profile | undefined;
    cacheLevel: number;
    currentLocation: Location | undefined;
    currentLocationIndex: number | undefined;

    characterIdArray: string[];
    textContentArray: string[];
    combinationCache: CombinationCache;
    numberOfMessagesByParticipant: number;
    
    delimiters: PromptDelimiters;
}

// ─── Small Helpers ────────────────────────────────────────────────

function getDateAndTimeString(localTimestamp: number): string {
    const dateAndTime = new Date(localTimestamp);
    return dateAndTime.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function formatTimerDuration(ms: number): string {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
}

function selectModelSummary(msg: ChatMessage | WhisperMessage, modelId: string): string {
    if (msg.modelTextContentSummaries?.[modelId]) {
        return msg.modelTextContentSummaries[modelId];
    }
    return msg.textContent;
}

export function getParticipantId(character: Character, participants: Character[]): number {
    return participants.findIndex(p => p.id === character.id);
}

export function getParticipantTag(character: Character, participants: Character[]): string {
    const participantId = getParticipantId(character, participants);
    return participantId !== -1 ? `Character ${participantId + 1}` : 'Unknown';
}

export function getKnownDisplayName(
    targetChar: Character,
    knownNames: Record<string, Record<string, boolean>>,
): string | null {
    const candidates = [targetChar.name, ...(targetChar.aliases ?? [])];
    const knownMap = knownNames[targetChar.id];
    if (!knownMap) return null;
    for (const candidate of candidates) {
        if (knownMap[candidate] === true) return candidate;
    }
    return null;
}

function getFullDisplayName(
    targetChar: Character,
    participants: Character[],
    knownNames: Record<string, Record<string, boolean>>,
): string {
    const tag = getParticipantTag(targetChar, participants);
    const knownName = getKnownDisplayName(targetChar, knownNames);
    return knownName ? `${tag} (${knownName})` : tag;
}

function buildProtagonistDisplayString(
    coLocatedProtagonists: Character[],
    participants: Character[],
    knownNames: Record<string, Record<string, boolean>>,
): string {
    if (coLocatedProtagonists.length === 0) return '';
    const parts = coLocatedProtagonists.map(p => getFullDisplayName(p, participants, knownNames));
    return parts.join(' and ');
}

function buildProtagonistPossessiveString(
    coLocatedProtagonists: Character[],
    participants: Character[],
    knownNames: Record<string, Record<string, boolean>>,
): string {
    if (coLocatedProtagonists.length === 0) return '';
    const parts = coLocatedProtagonists.map(p => {
        const tag = getParticipantTag(p, participants);
        const knownName = getKnownDisplayName(p, knownNames);
        const name = knownName ?? tag;
        return `${name}'s`;
    });
    return parts.join(' and ');
}

export function replacePlaceholders(
    text: string,
    characterParticipantTag: string,
    characterName: string,
    coLocatedProtagonists: Character[],
    participants: Character[],
    knownNames: Record<string, Record<string, boolean>>,
): string {
    if (!text) return text;

    const protagonistString = buildProtagonistDisplayString(coLocatedProtagonists, participants, knownNames);
    const protagonistPossessive = buildProtagonistPossessiveString(coLocatedProtagonists, participants, knownNames);

    let result = text;
    result = result.replace(/\{\{char\}\}/g, `${characterParticipantTag} (${characterName})`);
    result = result.replace(/\{\{user\}\}'s/g, protagonistPossessive);
    result = result.replace(/\{\{user\}\}/g, protagonistString);
    return result;
}

export function getFatigueContext(currentChatStamina: number, maximumChatStamina: number): string {
    if (maximumChatStamina === Number.POSITIVE_INFINITY) return "";
    const ratio = currentChatStamina / maximumChatStamina;
    if (ratio > 0.7) return "";

    if (ratio > 0.5) return "I am starting to feel slightly winded, but still have plenty of energy to speak.";
    if (ratio > 0.3) return "I am somewhat exhausted from talking, but somewhat have the energy to speak.";
    if (ratio > 0.1) return "I am quite drained from talking and barely have the energy to speak.";
    return "I have no energy left to speak.";
}

export function findAllMessages(interactionData: InteractionData, characterId: string): HistoryMessage[] {
    return interactionData.interactionHistory.filter(m => m.character.id === characterId);
}

// ─── Whisper Visibility Helpers ─────────────────────────────────────

/** Check if a message is visible to a given character.
 *  ChatMessages are visible to all co-located participants.
 *  WhisperMessages are only visible to the sender and targets. */
function isMessageVisibleTo(msg: HistoryMessage, characterId: string): boolean {
    if (msg.messageType === 'chat') return true;
    if (msg.messageType === 'whisper') {
        const whisper = msg as WhisperMessage;
        return whisper.character.id === characterId || whisper.targetCharacterIds.includes(characterId);
    }
    return false;
}

/** Type guard: is this a text-bearing message (chat or whisper)? */
function isTextMessage(msg: HistoryMessage): msg is ChatMessage | WhisperMessage {
    return msg.messageType === 'chat' || msg.messageType === 'whisper';
}

// ─── Regex / Filter Helpers ───────────────────────────────────────

function filterArrayBasedOnContext(
    characterIdArray: string[],
    textContentArray: string[],
    currentCharacterId: string,
    contextType: regularExpressionContext
): { characterIdArray: string[]; textContentArray: string[] } {
    const length = characterIdArray.length;
    if (length === 0) return { characterIdArray: [], textContentArray: [] };

    if (contextType === "global") return { characterIdArray, textContentArray };

    if (contextType === "previous") {
        for (let i = length - 1; i >= 0; i--) {
            if (characterIdArray[i] === currentCharacterId) {
                return { characterIdArray: [characterIdArray[i]], textContentArray: [textContentArray[i]] };
            }
        }
        return { characterIdArray: [], textContentArray: [] };
    }

    if (contextType === "local") {
        let targetIndex = -1;
        const endIndex = length - 1;
        for (let i = endIndex; i >= 0; i--) {
            if ((characterIdArray[i] === currentCharacterId) && (i === endIndex)) continue;
            if ((characterIdArray[i] !== currentCharacterId) && (i === endIndex)) { targetIndex = i; break; }
            if ((characterIdArray[i] === currentCharacterId) && (characterIdArray[i + 1] !== currentCharacterId)) { targetIndex = i; break; }
        }
        if (targetIndex === -1) return { characterIdArray: [], textContentArray: [] };
        const startIndex = targetIndex + 1;
        if (startIndex >= length) return { characterIdArray: [], textContentArray: [] };
        return { characterIdArray: characterIdArray.slice(startIndex), textContentArray: textContentArray.slice(startIndex) };
    }

    return { characterIdArray: [], textContentArray: [] };
}

function filterArrayBasedOnTarget(
    characterIdArray: string[],
    textContentArray: string[],
    currentCharacterId: string,
    targetType: regularExpressionTarget,
    protagonistIds: string[],
): { characterIdArray: string[]; textContentArray: string[] } {
    const length = characterIdArray.length;
    if (length === 0) return { characterIdArray: [], textContentArray: [] };
    if (targetType === "everyone") return { characterIdArray, textContentArray };

    const protagonistIdSet = new Set(protagonistIds);

    const extractedCharacterIdArray: string[] = [];
    const extractedTextContentArray: string[] = [];

    if (targetType === "self") {
        for (let i = 0; i < length; i++) {
            if (characterIdArray[i] === currentCharacterId) {
                extractedCharacterIdArray.push(characterIdArray[i]);
                extractedTextContentArray.push(textContentArray[i]);
            }
        }
    } else if (targetType === "listener") {
        for (let i = length - 1; i >= 0; i--) {
            if (characterIdArray[i] !== currentCharacterId) {
                extractedCharacterIdArray.push(characterIdArray[i]);
                extractedTextContentArray.push(textContentArray[i]);
                break;
            }
        }
    } else if (targetType === "protagonist") {
        for (let i = 0; i < length; i++) {
            if (protagonistIdSet.has(characterIdArray[i])) {
                extractedCharacterIdArray.push(characterIdArray[i]);
                extractedTextContentArray.push(textContentArray[i]);
            }
        }
    } else if (targetType === "narrator") {
        for (let i = 0; i < length; i++) {
            if (characterIdArray[i] === '__ambient_narrator__') {
                extractedCharacterIdArray.push(characterIdArray[i]);
                extractedTextContentArray.push(textContentArray[i]);
            }
        }
    }

    return { characterIdArray: extractedCharacterIdArray, textContentArray: extractedTextContentArray };
}

function doesRegexMatch(regexString: string | undefined, searchSpace: string, sensitivityMultiplier = 1): boolean {
    if (!regexString) return true;
    try {
        const regex = new RegExp(regexString);
        const matched = regex.test(searchSpace);
        if (!matched) return false;
        if (sensitivityMultiplier >= 1) return true;
        return Math.random() < sensitivityMultiplier;
    } catch (e) {
        console.warn(`Invalid regex: ${regexString}`, e);
        return false;
    }
}

function isCharacterBound(context: Context, currentCharacterId: string): boolean {
    if (!context.characterBindings || context.characterBindings.length === 0) return true;
    return context.characterBindings.includes(currentCharacterId);
}

function isPromptBlockCharacterBound(block: PromptBlock, currentCharacterId: string): boolean {
    if (!block.characterBindings || block.characterBindings.length === 0) return true;
    return block.characterBindings.includes(currentCharacterId);
}

function isBuiltInBlockType(value: string): value is PromptBlockType {
    return (defaultInputStrategy as string[]).includes(value)
        || value === 'Model Chat Template'
        || value === 'Model Instruction Template'
        || value === 'Model Chat-Instruction Template';
}

function getFilteredDataCached(
    cache: CombinationCache,
    characterIdArray: string[],
    textContentArray: string[],
    characterId: string,
    protagonistIds: string[],
    ctxType: regularExpressionContext,
    tgtType: regularExpressionTarget,
): { characterIdArray: string[]; textContentArray: string[] } {
    const cacheKey = protagonistIds.join(',');
    if (!cache[ctxType]) cache[ctxType] = {};
    const subCache = cache[ctxType];
    if (!subCache[`${tgtType}:${cacheKey}`]) {
        const step1 = filterArrayBasedOnContext(characterIdArray, textContentArray, characterId, ctxType);
        const step2 = filterArrayBasedOnTarget(step1.characterIdArray, step1.textContentArray, characterId, tgtType, protagonistIds);
        subCache[`${tgtType}:${cacheKey}`] = step2;
    }
    return subCache[`${tgtType}:${cacheKey}`];
}

function doesAnyTriggerMatchCached(
    triggers: RegularExpressionTrigger[] | undefined,
    characterIdArray: string[],
    textContentArray: string[],
    currentCharacterId: string,
    protagonistIds: string[],
    fallbackSearchSpace: string,
    combinationCache: CombinationCache,
    sensitivityMultiplier?: number,
): boolean {
    if (!triggers || triggers.length === 0) return false;
    for (const trigger of triggers) {
        if (!trigger.trigger.trim()) continue;
        const { textContentArray: filteredTexts } = getFilteredDataCached(
            combinationCache, characterIdArray, textContentArray,
            currentCharacterId, protagonistIds,
            trigger.context || 'global', trigger.target || 'everyone'
        );
        const searchSpace = filteredTexts.length > 0
            ? `${filteredTexts.join('\n')}\n${fallbackSearchSpace}`
            : fallbackSearchSpace;
        if (doesRegexMatch(trigger.trigger, searchSpace, sensitivityMultiplier)) {
            return true;
        }
    }
    return false;
}

function isEntityActiveWithCache(
    activationTriggers: RegularExpressionTrigger[] | undefined,
    deactivationTriggers: RegularExpressionTrigger[] | undefined,
    exclusionActivationTriggers: RegularExpressionTrigger[] | undefined,
    exclusionDeactivationTriggers: RegularExpressionTrigger[] | undefined,
    characterIdArray: string[],
    textContentArray: string[],
    currentCharacterId: string,
    protagonistIds: string[],
    fallbackSearchSpace: string,
    combinationCache: CombinationCache,
    sensitivityMultiplier?: number,
): boolean {
    if (!activationTriggers || activationTriggers.length === 0) return true;

    if (!doesAnyTriggerMatchCached(
        activationTriggers, characterIdArray, textContentArray,
        currentCharacterId, protagonistIds, fallbackSearchSpace,
        combinationCache, sensitivityMultiplier
    )) {
        return false;
    }

    if (doesAnyTriggerMatchCached(
        deactivationTriggers, characterIdArray, textContentArray,
        currentCharacterId, protagonistIds, fallbackSearchSpace,
        combinationCache
    )) {
        return false;
    }

    if (doesAnyTriggerMatchCached(
        exclusionActivationTriggers, characterIdArray, textContentArray,
        currentCharacterId, protagonistIds, fallbackSearchSpace,
        combinationCache
    )) {
        if (!doesAnyTriggerMatchCached(
            exclusionDeactivationTriggers, characterIdArray, textContentArray,
            currentCharacterId, protagonistIds, fallbackSearchSpace,
            combinationCache
        )) {
            return false;
        }
    }

    return true;
}

function getMessageFilterFlags(
    chatMessages: (ChatMessage | WhisperMessage)[],
    contexts: Context[],
    locations: Location[],
    promptBlocks: PromptBlock[],
    characterId: string,
): boolean[] {
    const excluded = new Array(chatMessages.length).fill(false);

    const applyFilterTriggers = (
        activationTriggers: RegularExpressionTrigger[] | undefined,
        deactivationTriggers: RegularExpressionTrigger[] | undefined,
    ): void => {
        const activationRegexes = compileTriggerRegexes(activationTriggers);
        if (activationRegexes.length === 0) return;
        const deactivationRegexes = compileTriggerRegexes(deactivationTriggers);

        let including = false;

        for (let i = 0; i < chatMessages.length; i++) {
            const msg = chatMessages[i];

            if (including) {
                if (deactivationRegexes.some(r => r.test(msg.textContent))) {
                    return;
                }
            } else {
                if (activationRegexes.some(r => r.test(msg.textContent))) {
                    including = true;
                } else {
                    excluded[i] = true;
                }
            }
        }
    };

    for (const context of contexts) {
        if (!isCharacterBound(context, characterId)) continue;
        applyFilterTriggers(
            context.messageFilterRegularExpressionActivationTriggers,
            context.messageFilterRegularExpressionDeactivationTriggers,
        );
    }

    for (const location of locations) {
        if (location.characterBindings && location.characterBindings.length > 0) {
            if (!location.characterBindings.includes(characterId)) continue;
        }
        applyFilterTriggers(
            location.messageFilterRegularExpressionActivationTriggers,
            location.messageFilterRegularExpressionDeactivationTriggers,
        );
    }

    for (const block of promptBlocks) {
        if (!isPromptBlockCharacterBound(block, characterId)) continue;
        applyFilterTriggers(
            block.messageFilterRegularExpressionActivationTriggers,
            block.messageFilterRegularExpressionDeactivationTriggers,
        );
    }

    return excluded;
}

export function getFilteredChatMessages(
    interactionData: InteractionData,
    characterId: string,
    allPromptBlocks: PromptBlock[],
): (ChatMessage | WhisperMessage)[] {
    const textMessages = interactionData.interactionHistory.filter(
        (m): m is ChatMessage | WhisperMessage => isTextMessage(m) && isMessageVisibleTo(m, characterId)
    );
    if (textMessages.length === 0) return [];

    const contexts = interactionData.contexts || [];
    const locations = interactionData.locations || [];
    const filterFlags = getMessageFilterFlags(textMessages, contexts, locations, allPromptBlocks, characterId);
    return textMessages.filter((_, i) => !filterFlags[i]);
}

// ─── Context Resolution ──────────────────────────────────────────

async function resolveContextEntries(
    contexts: Context[],
    chatSearchSpace: string,
    currentCharacterId: string,
    protagonistIds: string[],
    characterIdArray: string[],
    textContentArray: string[],
    combinationCache: CombinationCache,
    fetchedContentMap?: Map<string, string>,
    contextSensitivity?: number
): Promise<{ context: Context; combinedText: string }[]> {
    const sensitivityForCharacter = contextSensitivity ?? 1;
    const activated = new Set<string>();
    const activatedMap = new Map<string, Context>();

    for (const context of contexts) {
        if (activated.has(context.id)) continue;
        if (!isCharacterBound(context, currentCharacterId)) continue;

        if (isEntityActiveWithCache(
            context.regularExpressionActivationTriggers,
            context.regularExpressionDeactivationTriggers,
            context.regularExpressionExclusionActivationTriggers,
            context.regularExpressionExclusionDeactivationTriggers,
            characterIdArray, textContentArray,
            currentCharacterId, protagonistIds,
            chatSearchSpace, combinationCache,
            sensitivityForCharacter,
        )) {
            activated.add(context.id);
            activatedMap.set(context.id, context);
        }
    }

    const activationDepth = new Map<string, number>();
    for (const id of activated) {
        activationDepth.set(id, 0);
    }

    let recursionDepth = 0;
    let newActivations = true;

    while (newActivations && recursionDepth < DEFAULT_MAX_RECURSION_DEPTH) {
        newActivations = false;
        recursionDepth++;

        const activatedTextParts: string[] = [];
        for (const c of activatedMap.values()) {
            if (c.text) activatedTextParts.push(c.text);
            const fetched = fetchedContentMap?.get(c.id);
            if (fetched) activatedTextParts.push(fetched);
        }
        const activatedText = activatedTextParts.join('\n');

        if (!activatedText.trim()) break;

        for (const context of contexts) {
            if (activated.has(context.id)) continue;
            if (!isCharacterBound(context, currentCharacterId)) continue;

            const contextMaxDepth = context.maximumRecursionDepth ?? DEFAULT_MAX_RECURSION_DEPTH;
            if (contextMaxDepth === 0) continue;
            if (recursionDepth > contextMaxDepth) continue;

            if (isEntityActiveWithCache(
                context.regularExpressionActivationTriggers,
                context.regularExpressionDeactivationTriggers,
                context.regularExpressionExclusionActivationTriggers,
                context.regularExpressionExclusionDeactivationTriggers,
                characterIdArray, textContentArray,
                currentCharacterId, protagonistIds,
                activatedText, combinationCache,
                sensitivityForCharacter,
            )) {
                activated.add(context.id);
                activatedMap.set(context.id, context);
                activationDepth.set(context.id, recursionDepth);
                newActivations = true;
            }
        }
    }

    const orderedActivated: Context[] = [];
    for (const context of contexts) {
        if (activatedMap.has(context.id)) {
            orderedActivated.push(context);
        }
    }

    const formattedEntries: { context: Context; combinedText: string; numberOfTokens: number }[] = [];

    for (const context of orderedActivated) {
        const fetchedContent = fetchedContentMap?.get(context.id);
        let combinedText: string;

        if (context.text && fetchedContent) {
            combinedText = `${context.text}\n\n--- Web Content ---\n\n${fetchedContent}`;
        } else if (fetchedContent) {
            combinedText = fetchedContent;
        } else if (context.text) {
            combinedText = context.text;
        } else {
            continue;
        }

        let numberOfTokens: number;
        if (context.tokenBudget && context.tokenBudget > 0) {
            numberOfTokens = context.tokenBudget;
        } else {
            numberOfTokens = await tokenEngine.countTokens(combinedText);
        }

        formattedEntries.push({ context, combinedText, numberOfTokens });
    }

    let totalTokens = 0;
    const budgetEntries: typeof formattedEntries = [];

    for (const entry of formattedEntries) {
        if (totalTokens + entry.numberOfTokens <= DEFAULT_CONTEXT_TOKEN_BUDGET) {
            totalTokens += entry.numberOfTokens;
            budgetEntries.push(entry);
        }
    }

    budgetEntries.sort((a, b) => {
        const depthA = a.context.insertionDepth ?? 0;
        const depthB = b.context.insertionDepth ?? 0;
        return depthA - depthB;
    });

    return budgetEntries.map(e => ({ context: e.context, combinedText: e.combinedText }));
}

// ─── Clothing ─────────────────────────────────────────────────────

function resolveClothingWearingStatus(
    character: Character,
    interactionData: InteractionData,
    characterIdArray: string[],
    textContentArray: string[],
    combinationCache: CombinationCache,
): Record<string, boolean> {
    const clothings = character.clothings;
    if (!clothings || clothings.length === 0) return {};

    const coLocatedProtagonists = getCoLocatedProtagonists(interactionData, character);
    const protagonistIds = coLocatedProtagonists.map(p => p.id);
    const characterId = character.id;

    const prevMsg = findPreviousMessage(interactionData, characterId);
    const prevStatus = (prevMsg as ChatMessage)?.characterClothingWearingStatuses ?? {};

    const status: Record<string, boolean> = {};

    for (const clothing of clothings) {
        if (clothing.id in prevStatus) {
            status[clothing.id] = prevStatus[clothing.id];
        } else {
            const prob = clothing.initialWearingProbability ?? 1;
            status[clothing.id] = prob >= 1 ? true : prob <= 0 ? false : Math.random() < prob;
        }

        if (clothing.regularExpressionActivationTriggers && clothing.regularExpressionActivationTriggers.length > 0) {
            const activated = doesAnyTriggerMatchCached(
                clothing.regularExpressionActivationTriggers,
                characterIdArray, textContentArray,
                characterId, protagonistIds,
                '', combinationCache,
            );
            if (activated) status[clothing.id] = true;
        }

        if (clothing.regularExpressionDeactivationTriggers && clothing.regularExpressionDeactivationTriggers.length > 0) {
            const deactivated = doesAnyTriggerMatchCached(
                clothing.regularExpressionDeactivationTriggers,
                characterIdArray, textContentArray,
                characterId, protagonistIds,
                '', combinationCache,
            );
            if (deactivated) status[clothing.id] = false;
        }
    }

    return status;
}

function getVisibleClothingDescriptions(
    clothings: Clothing[],
    wearingStatus: Record<string, boolean>,
): string[] {
    if (!clothings || clothings.length === 0) return [];

    const coveredIds = new Set<string>();
    const clothingMap = new Map<string, Clothing>();
    for (const c of clothings) {
        clothingMap.set(c.id, c);
    }

    for (const clothing of clothings) {
        if (!wearingStatus[clothing.id]) continue;
        const queue = [...clothing.clothingBindings];
        while (queue.length > 0) {
            const boundId = queue.shift();
            if (boundId === undefined) break;
            if (coveredIds.has(boundId)) continue;
            coveredIds.add(boundId);
            const boundClothing = clothingMap.get(boundId);
            if (boundClothing) {
                for (const transitiveBound of boundClothing.clothingBindings) {
                    if (!coveredIds.has(transitiveBound)) {
                        queue.push(transitiveBound);
                    }
                }
            }
        }
    }

    const visible: string[] = [];
    for (const clothing of clothings) {
        if (!wearingStatus[clothing.id]) continue;
        if (coveredIds.has(clothing.id)) continue;
        if (clothing.description?.trim()) {
            visible.push(clothing.description.trim());
        }
    }

    return visible;
}

// ─── Location Visit Segments ──────────────────────────────────────

export interface LocationVisitSegment {
    characterId: string;
    locationIndex: number;
    startIdx: number;
    endIdx: number;
    lastMessageId: string;
}

export function detectUnsummarizedLocationDepartures(
    interactionData: InteractionData,
    characterId: string,
    modelId: string,
): LocationVisitSegment[] {
    const history = interactionData.interactionHistory;
    const locs = interactionData.locations;
    if (!locs || locs.length === 0) return [];

    const protagonistIds = new Set(interactionData.protagonists?.map(p => p.id) ?? []);
    if (protagonistIds.has(characterId)) return [];

    let currentLocationIndex: number | undefined;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].locationIndex !== undefined) {
            currentLocationIndex = history[i].locationIndex;
            break;
        }
    }

    const segments: LocationVisitSegment[] = [];

    const charMessages: { msg: ChatMessage | WhisperMessage; historyIdx: number }[] = [];
    for (let i = 0; i < history.length; i++) {
        const m = history[i];
        if (isTextMessage(m) && m.character.id === characterId) {
            charMessages.push({ msg: m, historyIdx: i });
        }
    }

    if (charMessages.length === 0) return [];

    let segStart = 0;
    for (let i = 1; i <= charMessages.length; i++) {
        const prevLoc = charMessages[i - 1].msg.locationIndex;
        const currLoc = i < charMessages.length ? charMessages[i].msg.locationIndex : undefined;

        const segmentEnded = i === charMessages.length || prevLoc !== currLoc;

        if (segmentEnded && prevLoc !== undefined) {
            const segEnd = i - 1;
            const lastMsg = charMessages[segEnd].msg;

            if (currentLocationIndex !== undefined && prevLoc === currentLocationIndex) continue;

            const existingSummary = (lastMsg as ChatMessage).modelInteractionTextContentSummaries?.[modelId];
            if (existingSummary) continue;

            segments.push({
                characterId,
                locationIndex: prevLoc,
                startIdx: charMessages[segStart].historyIdx,
                endIdx: charMessages[segEnd].historyIdx,
                lastMessageId: lastMsg.id,
            });
        }

        if (i < charMessages.length && (prevLoc !== currLoc || prevLoc === undefined)) {
            segStart = i;
        }
    }

    return segments;
}

// ─── Context Builder ──────────────────────────────────────────────

function buildPromptContext(
    interactionData: InteractionData,
    character: Character,
    knownNames: Record<string, Record<string, boolean>>,
    modelId: string,
    allPromptBlocks: PromptBlock[],
    existingCharacterText: string,
    delimiters: PromptDelimiters,
): PromptBuildContext {
    const interactionHistory = interactionData.interactionHistory;
    const participants = interactionData.participants;
    const coLocatedProtagonists = getCoLocatedProtagonists(interactionData, character);
    const protagonistIds = new Set(coLocatedProtagonists.map(p => p.id));
    const characterId = character.id;
    const characterParticipantId = getParticipantId(character, participants);
    const characterParticipantTag = getParticipantTag(character, participants);
    const characterName = character.name;
    const profile = interactionData.Profile;
    const cacheLevel = profile?.cacheInvalidationReductionLevel ?? 0;

    const characterIdArray: string[] = [];
    const textContentArray: string[] = [];
    for (const msg of interactionHistory) {
        if (isTextMessage(msg) && isMessageVisibleTo(msg, characterId)) {
            characterIdArray.push(msg.character.id);
            textContentArray.push(msg.textContent);
        }
    }

    let currentLocationIndex: number | undefined;
    for (let i = interactionHistory.length - 1; i >= 0; i--) {
        if (interactionHistory[i].locationIndex !== undefined) {
            currentLocationIndex = interactionHistory[i].locationIndex;
            break;
        }
    }

    const locs = interactionData.locations;
    const currentLocation = currentLocationIndex !== undefined && locs && locs.length > 0
        ? locs[currentLocationIndex]
        : undefined;

    const numberOfMessagesByParticipant = interactionHistory.filter(
        msg => msg.character.id === characterId && isTextMessage(msg)
    ).length;

    return {
        interactionData,
        character,
        knownNames,
        modelId,
        allPromptBlocks,
        existingCharacterText,
        interactionHistory,
        participants,
        coLocatedProtagonists,
        protagonistIds,
        characterId,
        characterParticipantId,
        characterParticipantTag,
        characterName,
        profile,
        cacheLevel,
        currentLocation,
        currentLocationIndex,
        characterIdArray,
        textContentArray,
        combinationCache: {},
        numberOfMessagesByParticipant,
        delimiters,
    };
}

// ─── Prompt Section Builders ─────────────────────────────────────

function buildAppearanceLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    const hasAnyAppearance = ctx.participants.some(p => p.appearancePrompt?.trim());
    if (!hasAnyAppearance) return lines;

    lines.push(`${ctx.delimiters.blockStart('system')}Start Of The Characters' Appearances List.${ctx.delimiters.blockEnd}`);

    for (const participant of ctx.participants) {
        const appearancePrompt = participant.appearancePrompt;
        if (!appearancePrompt || !appearancePrompt.trim()) continue;

        const otherParticipantId = getParticipantId(participant, ctx.participants);
        const isCurrent = otherParticipantId === ctx.characterParticipantId;
        const otherTag = getParticipantTag(participant, ctx.participants);
        const knownName = getKnownDisplayName(participant, ctx.knownNames);
        const finalAppearancePrompt = replacePlaceholders(
            appearancePrompt, ctx.characterParticipantTag, ctx.characterName,
            ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames,
        );

        const roleStr = (ctx.cacheLevel > 0 || isCurrent || knownName) 
            ? `${otherTag} (${knownName ?? participant.name})` 
            : otherTag;

        const appearanceText = `${ctx.delimiters.blockStart(roleStr)}${finalAppearancePrompt}${ctx.delimiters.blockEnd}`;
        lines.push(appearanceText);
    }

    lines.push(`${ctx.delimiters.blockStart('system')}End Of The Characters' Appearances List.${ctx.delimiters.blockEnd}`);
    return lines;
}

function buildSystemPromptLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    let systemPrompt = ctx.character.systemPrompt;

    if (ctx.cacheLevel >= 2) {
        for (const p of ctx.participants) {
            if (p.systemPrompt) {
                lines.push(`${ctx.delimiters.blockStart('system')}${getParticipantTag(p, ctx.participants)} Prompt: ${replacePlaceholders(p.systemPrompt, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames)}${ctx.delimiters.blockEnd}`);
            }
        }
    } else if (systemPrompt) {
        systemPrompt = replacePlaceholders(systemPrompt, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames);
        lines.push(`${ctx.delimiters.blockStart('system')}${ctx.characterParticipantTag} Prompt: ${systemPrompt}${ctx.delimiters.blockEnd}`);
    }

    return lines;
}

function buildThinkPromptLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    let thinkPrompt = ctx.character.thinkPrompt;

    if (ctx.cacheLevel >= 3) {
        for (const p of ctx.interactionData.participants) {
            if (p.thinkPrompt) {
                lines.push(`${ctx.delimiters.blockStart('system')}I am keeping this in mind as ${getParticipantTag(p, ctx.participants)}: ${replacePlaceholders(p.thinkPrompt, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames)}${ctx.delimiters.blockEnd}`);
            }
        }
    } else if (thinkPrompt) {
        thinkPrompt = replacePlaceholders(thinkPrompt, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames);
        lines.push(`${ctx.delimiters.blockStart('system')}${thinkPrompt}${ctx.delimiters.blockEnd}`);
    }

    return lines;
}

function buildMetaThinkLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    const characterInstructions = `I will respond exclusively as ${ctx.characterParticipantTag}, expressing only this character's perspective, actions, and speech. I will also match the vocabulary, grammar, formality and verbosity for the spoken dialogue that ${ctx.characterParticipantTag} is likely to use.`;

    const constructed = `${ctx.delimiters.blockStart('system')}${topicExpansionInstructions} ${beingIgnoredInstructions} ${noHallucinationInstructions} ${noEmptyResponseInstructions} ${mistakeCorrectionInstructions} ${characterInstructions} ${languageInstructions} ${literaryDeviceInstructions}${ctx.delimiters.blockEnd}`;
    lines.push(constructed);
    return lines;
}

function buildDialoguePromptLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    const dialogueSearchSpace = buildDialogueSearchSpace(ctx.textContentArray);
    const activeDialogueContents = collectActiveDialoguePromptContent(ctx.character.dialoguePrompts, dialogueSearchSpace);

    if (activeDialogueContents.length > 0) {
        lines.push(`${ctx.delimiters.blockStart('system')}Start Of This Character's Sample dialogues.${ctx.delimiters.blockEnd}`);
        for (const content of activeDialogueContents) {
            const replacedDialogue = replacePlaceholders(content, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames);
            lines.push(`${ctx.delimiters.blockStart('system')}${replacedDialogue}${ctx.delimiters.blockEnd}`);
        }
        lines.push(`${ctx.delimiters.blockStart('system')}End Of This Character's Sample dialogues.${ctx.delimiters.blockEnd}`);
    }

    return lines;
}

function buildStarterPromptLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    const starterPrompts = ctx.character.starterPrompts;

    if (starterPrompts && Object.keys(starterPrompts).length > 0) {
        const entries = Object.entries(starterPrompts);
        let totalWeight = 0;
        for (const [, weight] of entries) totalWeight += weight;

        if (totalWeight > 0) {
            let roll = Math.random() * totalWeight;
            let selectedText = '';
            for (const [text, weight] of entries) {
                roll -= weight;
                if (roll <= 0) { selectedText = text; break; }
            }
            if (!selectedText) selectedText = entries[entries.length - 1][0];

            if (selectedText.trim()) {
                lines.push(`${ctx.delimiters.blockStart('system')}Start Of This Character's Starter Prompt.${ctx.delimiters.blockEnd}`);
                const replacedStarter = replacePlaceholders(selectedText, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames);
                lines.push(`${ctx.delimiters.blockStart('system')}${replacedStarter}${ctx.delimiters.blockEnd}`);
                lines.push(`${ctx.delimiters.blockStart('system')}End Of This Character's Starter Prompt.${ctx.delimiters.blockEnd}`);
            }
        }
    }

    return lines;
}

function buildLocationLines(ctx: PromptBuildContext): { lines: string[]; images: EntityImageRef[] } {
    const lines: string[] = [];
    const images: EntityImageRef[] = [];
    const location = ctx.currentLocation;

    if (location) {
        lines.push(`${ctx.delimiters.blockStart('system')}Start Of Current Location.${ctx.delimiters.blockEnd}`);

        const locationName = location.name || 'Unknown Location';
        const locationText = location.text?.trim();

        let locationContent = `${ctx.delimiters.blockStart('system')}Current Location: ${locationName}`;
        if (locationText) locationContent += `\n\n${locationText}`;
        locationContent += `${ctx.delimiters.blockEnd}`;
        lines.push(locationContent);

        if (location.ownerBindings && location.ownerBindings.length > 0) {
            const ownerNames = location.ownerBindings
                .map(id => ctx.participants.find(p => p.id === id)?.name)
                .filter((n): n is string => !!n);
            if (ownerNames.length > 0) {
                lines.push(`${ctx.delimiters.blockStart('system')}This location is owned by: ${ownerNames.join(', ')}.${ctx.delimiters.blockEnd}`);
            }
        }

        const reachable = getReachableLocationsByCharacter(ctx.interactionData, ctx.character);
        if (reachable.length > 0) {
            const reachableNames = reachable.map(r => r.location.name || 'Unknown Location');
            lines.push(`${ctx.delimiters.blockStart('system')}From ${locationName}, I can travel to: ${reachableNames.join(', ')}.${ctx.delimiters.blockEnd}`);
        }

        if (location.images && location.images.length > 0) {
            for (const img of location.images) {
                images.push({ entityId: location.id, filename: img });
            }
        }

        lines.push(`${ctx.delimiters.blockStart('system')}End Of Current Location.${ctx.delimiters.blockEnd}`);
    }

    return { lines, images };
}

function buildInventoryLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];

    let latestInventory: Record<string, string | number> | undefined;
    for (let i = ctx.interactionHistory.length - 1; i >= 0; i--) {
        const msg = ctx.interactionHistory[i];
        if (msg.character.id === ctx.characterId && msg.inventory && Object.keys(msg.inventory).length > 0) {
            latestInventory = msg.inventory;
            break;
        }
    }

    if (latestInventory && Object.keys(latestInventory).length > 0) {
        const now = Date.now();

        const userInventoryEntries: string[] = [];
        let notes: Record<string, string> = {};
        let timers: { name: string; targetTimestamp: number }[] = [];
        let stopwatches: { name: string; startTimestamp: number; pausedElapsedMs?: number }[] = [];

        for (const [key, value] of Object.entries(latestInventory)) {
            if (key === '__notes__') {
                try { notes = JSON.parse(value as string); } catch { }
            } else if (key === '__timers__') {
                try { timers = JSON.parse(value as string); } catch { }
            } else if (key === '__stopwatches__') {
                try { stopwatches = JSON.parse(value as string); } catch { }
            } else {
                userInventoryEntries.push(`${key}: ${value}`);
            }
        }

        if (userInventoryEntries.length > 0) {
            lines.push(`${ctx.delimiters.blockStart('system')}[Current Inventory]\n${userInventoryEntries.join('\n')}${ctx.delimiters.blockEnd}`);
        }

        const noteEntries = Object.entries(notes);
        if (noteEntries.length > 0) {
            const formattedNotes = noteEntries.map(([k, v]) => `${k}: ${v}`).join('\n');
            lines.push(`${ctx.delimiters.blockStart('system')}[Active Notes]\n${formattedNotes}${ctx.delimiters.blockEnd}`);
        }

        if (timers.length > 0) {
            const timerStatuses = timers.map(t => {
                const remaining = t.targetTimestamp - now;
                return remaining <= 0 ? `${t.name}: EXPIRED` : `${t.name}: ${formatTimerDuration(remaining)} remaining`;
            });
            lines.push(`${ctx.delimiters.blockStart('system')}[Active Timers]\n${timerStatuses.join('\n')}${ctx.delimiters.blockEnd}`);
        }

        if (stopwatches.length > 0) {
            const swStatuses = stopwatches.map(s => {
                const elapsed = s.pausedElapsedMs !== undefined ? s.pausedElapsedMs : now - s.startTimestamp;
                const status = s.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING';
                return `${s.name}: ${formatTimerDuration(elapsed)} (${status})`;
            });
            lines.push(`${ctx.delimiters.blockStart('system')}[Active Stopwatches]\n${swStatuses.join('\n')}${ctx.delimiters.blockEnd}`);
        }
    }

    return lines;
}

function buildToolInstructionLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    const effectiveTools = getEffectiveTools(ctx.character, ctx.profile);
    const enabledToolNames = (Object.keys(effectiveTools) as tool[]).filter(t => effectiveTools[t]);

    if (enabledToolNames.length > 0) {
        const firstTool = enabledToolNames[0];
        lines.push(`${ctx.delimiters.blockStart('system')}I understand that I can access the tools by calling the ${toolStartSring} marker followed by the tool name and arguments, then closing with ${toolEndString} like ${toolStartSring}${firstTool}}${toolEndString}. The content between these markers will be replaced with the tool's result before I continue writing. I may use multiple tools in sequence if I need intermediate results. Tool invocation markers are completely invisible to the user. Writing a tool name without arguments returns usage instructions for that tool. Available tools: ${enabledToolNames.join(', ')}.${ctx.delimiters.blockEnd}`);
    }

    return lines;
}

function buildFatigueLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    const previousMessage = findPreviousMessage(ctx.interactionData, ctx.character.id);
    const effectiveMaxStamina = getEffectiveMaximumChatStamina(ctx.character, ctx.profile);
    const currentChatStamina = previousMessage?.remainingChatStamina ?? effectiveMaxStamina;
    const paragraphText = (currentChatStamina > 1) ? "paragraphs" : "paragraph";

    if (currentChatStamina !== undefined && effectiveMaxStamina !== Number.POSITIVE_INFINITY) {
        const remainingChatStaminaInstructions = `${ctx.delimiters.blockStart('system')}I understand that I can create a minimum of 1 paragraph and a maximum of ${currentChatStamina} ${paragraphText}. If I exceed this, I will naturally stop my paragraphs.${ctx.delimiters.blockEnd}`;
        if (remainingChatStaminaInstructions) lines.push(remainingChatStaminaInstructions);
        const fatigue = getFatigueContext(currentChatStamina, effectiveMaxStamina);
        if (fatigue) lines.push(`${ctx.delimiters.blockStart('system')}${fatigue}${ctx.delimiters.blockEnd}`);
    }

    return lines;
}

function buildTextInjectionLines(ctx: PromptBuildContext, hasBeenSummarized: boolean, contextLines: string[]): string[] {
    const lines: string[] = [];

    if (contextLines.length > 0) {
        lines.push(`${ctx.delimiters.blockStart('system')}${contextAuthorityInstructions}${ctx.delimiters.blockEnd}`);
    }

    if (hasBeenSummarized) lines.push(`${ctx.delimiters.blockStart('system')}${summarizationAwarenessInstructions}${ctx.delimiters.blockEnd}`);

    const callingOtherCharacterInstructions = `If the other character's name is provided, I must use their name. Otherwise I will use generic names or terms that ${ctx.characterParticipantTag} will likely use. I will never use 'Character #' or 'Character # (Name)' unless ${ctx.characterParticipantTag} requires it.`;
    const characterResponsePriming = `${ctx.delimiters.blockStart('system')}${noRepeatInstructions} ${noRestrictionsInstructions} ${callingOtherCharacterInstructions} ${formatInstructions} I am now responding as ${ctx.characterParticipantTag} with the format I am given and I will follow all the prompts given to me.${ctx.delimiters.blockEnd}`;
    const characterTextInjection = `${ctx.delimiters.turnStart(ctx.characterParticipantTag)}{{text}}`;

    lines.push(characterResponsePriming);
    lines.push(characterTextInjection);

    return lines;
}

// ─── Chat History Prompt ──────────────────────────────────────────

export function createChatHistoryPrompt(
    ctx: PromptBuildContext,
): { chatHistoryPrompt: string; hasBeenSummarized: boolean } {
    const interactionHistory = ctx.interactionHistory;
    const participants = ctx.participants;
    const profile = ctx.profile;
    const contexts = ctx.interactionData.contexts || [];
    const locations = ctx.interactionData.locations || [];

    const protagonistIds = ctx.protagonistIds;

    const visibleTextMessages = interactionHistory.filter(
        (m): m is ChatMessage | WhisperMessage => isTextMessage(m) && isMessageVisibleTo(m, ctx.characterId)
    );

    if (visibleTextMessages.length === 0) return { chatHistoryPrompt: '', hasBeenSummarized: false };

    const filterFlags = getMessageFilterFlags(visibleTextMessages, contexts, locations, ctx.allPromptBlocks, ctx.characterId);
    const filteredMessages = visibleTextMessages.filter((_, i) => !filterFlags[i]);

    if (filteredMessages.length === 0) return { chatHistoryPrompt: '', hasBeenSummarized: false };

    const activeSteps = [...(profile?.summarizationSteps || [])]
        .sort((a, b) => a.order - b.order);

    let processedMessages = filteredMessages.map((msg) => ({
        msg,
        idx: interactionHistory.indexOf(msg),
        text: selectModelSummary(msg, ctx.modelId),
    }));

    let hasBeenSummarized = false;

    for (const step of activeSteps) {
        if (step.strategyType === 'Sliding Window Replace') {
            const windowSize = step.slidingWindowSize ?? 10;
            const cutoff = Math.max(0, processedMessages.length - windowSize);
            for (let i = 0; i < processedMessages.length; i++) {
                const msg = processedMessages[i].msg;
                if (i < cutoff && (msg as ChatMessage).modelTextContentSummaries && (msg as ChatMessage).modelTextContentSummaries[ctx.modelId]) {
                    processedMessages[i].text = (msg as ChatMessage).modelTextContentSummaries[ctx.modelId];
                    hasBeenSummarized = true;
                }
            }
        }

        if (step.strategyType === 'Observation Masking') {
            const threshold = step.maskingRelevanceThreshold ?? 0.3;
            const keywordWeight = step.maskingKeywordWeight ?? 0.7;
            const recencyWeight = 1 - keywordWeight;

            const recentText = processedMessages
                .slice(-5)
                .map(p => p.text.toLowerCase())
                .join(' ');
            const keywords = new Set(
                recentText.split(/\s+/).filter(w => w.length > 3)
            );

            processedMessages = processedMessages.filter((p, i) => {
                const totalMessages = processedMessages.length;
                const recencyScore = (i + 1) / totalMessages;

                let keywordScore = 0;
                const words = p.text.toLowerCase().split(/\s+/);
                for (const word of words) {
                    if (keywords.has(word)) keywordScore++;
                }
                keywordScore = words.length > 0 ? keywordScore / words.length : 0;

                const combinedScore = (keywordWeight * keywordScore) + (recencyWeight * recencyScore);
                return combinedScore >= threshold;
            });
        }
    }

    const currentLocationIndex = ctx.currentLocationIndex;
    const locs = ctx.interactionData.locations;
    const currentLocation = ctx.currentLocation;

    const RECENT_INTERACTION_WINDOW = 20;
    const recentInteractors = new Set<string>();
    const recentSlice = filteredMessages.slice(-RECENT_INTERACTION_WINDOW);
    for (let ri = 0; ri < recentSlice.length; ri++) {
        const msg = recentSlice[ri];
        if (msg.character.id === ctx.characterId) {
            if (ri > 0) recentInteractors.add(recentSlice[ri - 1].character.id);
            if (ri < recentSlice.length - 1) recentInteractors.add(recentSlice[ri + 1].character.id);
        } else {
            if (ri > 0 && recentSlice[ri - 1].character.id === ctx.characterId) {
                recentInteractors.add(msg.character.id);
            }
            if (ri < recentSlice.length - 1 && recentSlice[ri + 1].character.id === ctx.characterId) {
                recentInteractors.add(msg.character.id);
            }
        }
    }

    const hasLocationData = !!locs && locs.length > 0 && currentLocationIndex !== undefined;

    const locationVisitSummaries: { characterName: string; locationName: string; summary: string }[] = [];
    if (hasLocationData) {
        const seenSummaries = new Set<string>();
        for (const msg of visibleTextMessages) {
            if (protagonistIds.has(msg.character.id)) continue;
            if (msg.character.id === ctx.characterId) continue;
            const summary = (msg as ChatMessage).modelInteractionTextContentSummaries?.[ctx.modelId];
            if (!summary) continue;
            if (seenSummaries.has(msg.id)) continue;
            seenSummaries.add(msg.id);
            const msgLoc = msg.locationIndex;
            if (msgLoc !== undefined && msgLoc !== currentLocationIndex) {
                const locName = locs[msgLoc]?.name || 'Unknown Location';
                locationVisitSummaries.push({
                    characterName: msg.character.name,
                    locationName: locName,
                    summary,
                });
            }
        }
    }

    const outputMessages = processedMessages.filter((p) => {
        if (protagonistIds.has(p.msg.character.id)) return true;
        if (p.msg.character.id === ctx.characterId) return true;
        if (recentInteractors.has(p.msg.character.id)) return true;
        if (hasLocationData) {
            const charLocationIndex = p.msg.locationIndex;
            if (charLocationIndex !== undefined && charLocationIndex === currentLocationIndex) return true;
            if (charLocationIndex === undefined) return true;
        }
        if (!hasLocationData) return true;
        return false;
    });

    const chatHistoryLines: string[] = [];
    chatHistoryLines.push(`${ctx.delimiters.blockStart('system')}Start Of The Memory.${ctx.delimiters.blockEnd}`);

    if (locationVisitSummaries.length > 0) {
        for (const lvs of locationVisitSummaries) {
            chatHistoryLines.push(`${ctx.delimiters.blockStart('system')}[Memory of ${lvs.locationName}] As ${lvs.characterName}: ${lvs.summary}${ctx.delimiters.blockEnd}`);
        }
        hasBeenSummarized = true;
    }

    if (currentLocation) {
        chatHistoryLines.push(`${ctx.delimiters.turnStart('system')}[Scene: ${currentLocation.name}]${ctx.delimiters.turnEnd}`);
    }

    for (const p of outputMessages) {
        const otherCharacter = p.msg.character;
        const otherTag = getParticipantTag(otherCharacter, participants);
        const knownName = getKnownDisplayName(otherCharacter, ctx.knownNames);

        const roleStr = knownName ? `${otherTag} (${knownName})` : otherTag;
        
        const isWhisper = p.msg.messageType === 'whisper';
        const whisperSuffix = isWhisper ? ' [Whisper]' : '';
        const finalRoleStr = `${roleStr}${whisperSuffix}`;
        
        let chatHistoryText = ctx.delimiters.turnStart(finalRoleStr);

        const replacedText = replacePlaceholders(
            p.text,
            ctx.characterParticipantTag,
            ctx.characterName,
            ctx.coLocatedProtagonists,
            participants,
            ctx.knownNames,
        );

        chatHistoryText = `${chatHistoryText}${replacedText}${ctx.delimiters.turnEnd}`;
        chatHistoryLines.push(chatHistoryText);
    }

    chatHistoryLines.push(`${ctx.delimiters.blockStart('system')}End Of The Memory.${ctx.delimiters.blockEnd}`);

    const chatHistoryPrompt = chatHistoryLines.join('\n');

    return { chatHistoryPrompt, hasBeenSummarized };
}

// ─── Main Orchestrator ────────────────────────────────────────────

interface BuildResult {
    prompt: string;
    stops: string[];
    contextImages: EntityImageRef[];
    locationImages: EntityImageRef[];
    promptBlockImages: EntityImageRef[];
    characterClothingWearingStatuses: Record<string, boolean>;
    fetchErrors: string[];
}

export async function buildPrompt(
    interactionData: InteractionData,
    character: Character,
    knownNames: Record<string, Record<string, boolean>>,
    existingCharacterText: string,
    allPromptBlocks: PromptBlock[],
    modelId: string,
): Promise<BuildResult> {

    const activeModel = tokenEngine.getContext();
    const effectiveChatTemplateKey = activeModel?.chatTemplate;
    const resolvedChatTemplate = effectiveChatTemplateKey ? getModelTemplate(effectiveChatTemplateKey) : undefined;
    
    const delimiters = deriveDelimiters(resolvedChatTemplate);

    const ctx = buildPromptContext(interactionData, character, knownNames, modelId, allPromptBlocks, existingCharacterText, delimiters);

    const sampler = character.sampler;
    const samplerStopPatterns = sampler?.stopPatterns || [];
    const characterStopPatterns = character.stopPatterns || [];
    const allStopPatterns = [...samplerStopPatterns, ...characterStopPatterns];

    const profile = ctx.profile;
    const useCurrentDateAndTime = profile?.useCurrentDateAndTime;
    const useWeather = profile?.useWeather;
    const weatherApiKey = profile?.weatherApiKey;
    const useTimeElapsed = profile?.useTimeElapsed;
    const inputStrategy = profile?.inputStrategy ?? defaultInputStrategy;

    const effectiveContextSensitivity = (() => {
        const profileValue = profile?.contextSensitivity;
        if (profileValue === undefined || profileValue === -1) return character.contextSensitivity ?? 1;
        return profileValue;
    })();

    const segments = detectUnsummarizedLocationDepartures(interactionData, ctx.characterId, modelId);
    for (const segment of segments) {
        try {
            const summary = await generateLocationVisitSummary(
                interactionData, character, modelId,
                segment.startIdx, segment.endIdx,
            );
            if (summary) {
                const lastMsg = ctx.interactionHistory[segment.endIdx];
                if (lastMsg && isTextMessage(lastMsg)) {
                    const chatMsg = lastMsg as ChatMessage;
                    if (!chatMsg.modelInteractionTextContentSummaries) {
                        chatMsg.modelInteractionTextContentSummaries = {};
                    }
                    chatMsg.modelInteractionTextContentSummaries[modelId] = summary;
                }
            }
        } catch (e) {
            console.warn(`Failed to generate location visit summary for ${ctx.characterName}:`, e);
        }
    }

    const activeContextImages: EntityImageRef[] = [];
    const fetchErrors: string[] = [];
    const fetchedContentMap = new Map<string, string>();
    const contexts = ctx.interactionData.contexts || [];

    const webContexts = contexts.filter(c =>
        (c.urls && c.urls.length > 0) ||
        (c.searchTerms && c.searchTerms.length > 0)
    );

    if (webContexts.length > 0) {
        const fetchPromises = webContexts.map(async (context) => {
            const cacheTimeToLive = context.fetchCacheTimeToLiveMs ?? 5 * 60 * 1000;
            const maxDepth = context.maximumLinkDepth ?? 0;
            const fetchMode = context.linkFetchMode ?? 'full';

            const { results, errors } = await fetchMultipleContextUrls(
                context.urls ?? [],
                {
                    maxDepth,
                    cacheTimeToLiveMs: cacheTimeToLive,
                    fetchMode,
                    searchTerms: context.searchTerms,
                    searchEngine: context.searchEngine,
                    model: activeModel,
                    includeImages: context.includeLinkImages ?? false,
                    limitLinksToSubdirectory: context.limitLinksToSubdirectory ?? false,
                }
            );

            for (const error of errors) {
                fetchErrors.push(`${context.name}: ${error}`);
            }

            const validResults = results.filter(r => !r.error && r.content.length > 0);

            if (validResults.length === 0) return;

            const combinedContent = validResults
                .map(r => `[Source: ${r.url}]\n${r.content}`)
                .join('\n\n---\n\n');

            if (combinedContent.length > 0) {
                fetchedContentMap.set(context.id, combinedContent);
            }
        });

        await Promise.all(fetchPromises);
    }

    const resolvedContextsWithWeb = await resolveContextEntries(
        contexts,
        ctx.textContentArray.join('\n'),
        ctx.characterId,
        [...ctx.protagonistIds],
        ctx.characterIdArray,
        ctx.textContentArray,
        ctx.combinationCache,
        fetchedContentMap,
        effectiveContextSensitivity
    );

    const activeContextIds = new Set<string>();
    for (const { context } of resolvedContextsWithWeb) {
        activeContextIds.add(context.id);
    }

    let contextLines: string[] = [];

    for (const { context, combinedText } of resolvedContextsWithWeb) {
        const replacedText = replacePlaceholders(combinedText, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames);

        let line: string;
        if (context.useBase64Encoding) {
            const encodedText = btoa(unescape(encodeURIComponent(replacedText)));
            line = `${delimiters.blockStart('system')}[base64:${encodedText}]${delimiters.blockEnd}`;
        } else {
            line = `${delimiters.blockStart('system')}${replacedText}${delimiters.blockEnd}`;
        }

        contextLines.push(line);

        if (context.images && context.images.length > 0) {
            for (const img of context.images) {
                activeContextImages.push({ entityId: context.id, filename: img });
            }
        }
    }

    const allTextSearchSpace = ctx.textContentArray.join('\n');
    const activeStopPatterns: StopPattern[] = [];

    for (const stopPattern of allStopPatterns) {
        if (isEntityActiveWithCache(
            stopPattern.regularExpressionActivationTriggers,
            stopPattern.regularExpressionDeactivationTriggers,
            stopPattern.regularExpressionExclusionActivationTriggers,
            stopPattern.regularExpressionExclusionDeactivationTriggers,
            ctx.characterIdArray, ctx.textContentArray,
            ctx.characterId, [...ctx.protagonistIds],
            allTextSearchSpace, ctx.combinationCache,
        )) {
            activeStopPatterns.push(stopPattern);
        }
    }

    const characterClothingWearingStatuses = resolveClothingWearingStatus(
        character, interactionData,
        ctx.characterIdArray, ctx.textContentArray,
        ctx.combinationCache,
    );

    const appearancePromptLines = buildAppearanceLines(ctx);

    const visibleClothingDescriptions = getVisibleClothingDescriptions(
        character.clothings ?? [], characterClothingWearingStatuses,
    );
    if (visibleClothingDescriptions.length > 0) {
        const clothingLines = visibleClothingDescriptions.map(desc =>
            `${delimiters.blockStart('system')}${desc}${delimiters.blockEnd}`
        );
        if (appearancePromptLines.length >= 2) {
            appearancePromptLines.splice(appearancePromptLines.length - 1, 0, ...clothingLines);
        } else {
            appearancePromptLines.push(`${delimiters.blockStart('system')}Start Of The Characters' Appearances List.${delimiters.blockEnd}`);
            appearancePromptLines.push(...clothingLines);
            appearancePromptLines.push(`${delimiters.blockStart('system')}End Of The Characters' Appearances List.${delimiters.blockEnd}`);
        }
    }

    const systemPromptLines = buildSystemPromptLines(ctx);
    const thinkPromptLines = buildThinkPromptLines(ctx);
    const metaThinkLines = buildMetaThinkLines(ctx);
    const dialoguePromptLines = buildDialoguePromptLines(ctx);
    const starterPromptLines = buildStarterPromptLines(ctx);
    const locationResult = buildLocationLines(ctx);
    const locationLines = locationResult.lines;
    const activeLocationImages = locationResult.images;
    const inventoryLines = buildInventoryLines(ctx);
    const toolInstructions = buildToolInstructionLines(ctx);
    const fatigueLines = buildFatigueLines(ctx);

    const chatHistoryLines: string[] = [];
    let hasBeenSummarized = false;

    if (ctx.interactionHistory.length > 0) {
        const chatHistoryPrompt = createChatHistoryPrompt(ctx);
        chatHistoryLines.push(chatHistoryPrompt.chatHistoryPrompt);
        hasBeenSummarized = chatHistoryPrompt.hasBeenSummarized;
    }

    let latitude: number | undefined = ctx.currentLocation?.latitude;
    let longitude: number | undefined = ctx.currentLocation?.longitude;

    if (!latitude || !longitude) {
        const geoLocation = await getLocation();
        if (geoLocation) {
            latitude = geoLocation.latitude;
            longitude = geoLocation.longitude;
        }
    }

    let localTimestamp: number | null = null;
    if (latitude && longitude) localTimestamp = getLocalTimeFromCoordinates(latitude, longitude);

    const dateAndTimeLines: string[] = [];
    if (useCurrentDateAndTime && localTimestamp) {
        const dateAndTime = getDateAndTimeString(localTimestamp);
        dateAndTimeLines.push(`${delimiters.blockStart('system')}Today's date and time is ${dateAndTime}.${delimiters.blockEnd}`);
    }

    const weatherLines: string[] = [];
    if (useWeather && weatherApiKey && latitude && longitude) {
        const weatherLine = await fetchCurrentWeather(latitude, longitude, weatherApiKey);
        if (weatherLine) {
            weatherLines.push(`${delimiters.blockStart('system')}${weatherLine}${delimiters.blockEnd}`);
        }
    }

    const timeElapsedLines: string[] = [];
    if (useTimeElapsed && localTimestamp && ctx.interactionHistory.length > 0) {
        const lastMsgTimestamp = ctx.interactionHistory[ctx.interactionHistory.length - 1].lastUpdatedTimestamp;
        const diffMs = Math.max(0, localTimestamp - lastMsgTimestamp);

        const totalSeconds = Math.floor(diffMs / 86400);
        const numberOfDays = Math.floor(totalSeconds / 86400);
        const numberOfHours = Math.floor((totalSeconds % 86400) / 3600);
        const numberOfMinutes = Math.floor((totalSeconds % 3600) / 60);
        const numberOfSeconds = totalSeconds % 60;

        const parts: string[] = [];
        if (numberOfDays > 0) parts.push(`${numberOfDays} day${numberOfDays !== 1 ? 's' : ''}`);
        if (numberOfHours > 0) parts.push(`${numberOfHours} hour${numberOfHours !== 1 ? 's' : ''}`);
        if (numberOfMinutes > 0 && numberOfDays === 0) parts.push(`${numberOfMinutes} minute${numberOfMinutes !== 1 ? 's' : ''}`);
        if (numberOfSeconds > 0 && numberOfDays === 0 && numberOfHours === 0) parts.push(`${numberOfSeconds} second${numberOfSeconds !== 1 ? 's' : ''}`);

        const timeSinceLastMessageString = (parts.length > 0) ? parts.join(', ') : 'just now';

        timeElapsedLines.push(`${delimiters.blockStart('system')}It has been ${timeSinceLastMessageString} since the last message in the real world. I may or may not acknowledge the time elapsed. I will update relevant information according to this information. For example, a previous time must be subtracted or added with the elapsed time to get current time.${delimiters.blockEnd}`);
    }

    if (contextLines.length > 0) {
        contextLines = [`${delimiters.blockStart('system')}Start Of The Context.${delimiters.blockEnd}`, ...contextLines, `${delimiters.blockStart('system')}End Of The Context.${delimiters.blockEnd}`];
    }
    const textInjectionLines = buildTextInjectionLines(ctx, hasBeenSummarized, contextLines);

    const blockMap: Record<string, (string[] | undefined)> = {
        'System Prompt': systemPromptLines,
        'Think Prompt': thinkPromptLines,
        'Meta Think Instructions': metaThinkLines,
        'Appearance Prompt': appearancePromptLines,
        'Dialogue Prompt': dialoguePromptLines,
        'Chat History': chatHistoryLines,
        'Context': contextLines,
        'Location': locationLines,
        'Inventory': inventoryLines,
        'Weather': weatherLines,
        'Date And Time': dateAndTimeLines,
        'Time Elapsed': timeElapsedLines,
        'Fatigue Information': fatigueLines,
        'Starter Prompt': starterPromptLines,
        'Tool Instructions': toolInstructions,
        'Text Injection': textInjectionLines,
    };

    const numberOfMessagesToDisableThinkPrompt = getEffectiveMessagesToDisableThinkPrompt(character, profile);
    const numberOfMessagesToDisableMetaThinkInstructions = getEffectiveMessagesToDisableMetaThinkInstructions(character, profile);
    const numberOfMessagesToDisableDialoguePrompt = getEffectiveMessagesToDisableDialoguePrompt(character, profile);
    const numberOfMessagesToDisableStarterPrompt = getEffectiveMessagesToDisableStarterPrompt(character, profile);

    if (ctx.numberOfMessagesByParticipant >= numberOfMessagesToDisableThinkPrompt) {
        blockMap['Think Prompt'] = undefined;
    }
    if (ctx.numberOfMessagesByParticipant >= numberOfMessagesToDisableMetaThinkInstructions) {
        blockMap['Meta Think Instructions'] = undefined;
    }
    if (ctx.numberOfMessagesByParticipant >= numberOfMessagesToDisableDialoguePrompt) {
        blockMap['Dialogue Prompt'] = undefined;
    }
    if (ctx.numberOfMessagesByParticipant >= numberOfMessagesToDisableStarterPrompt) {
        blockMap['Starter Prompt'] = undefined;
    }

    const promptBlockById = new Map<string, PromptBlock>();
    for (const pb of allPromptBlocks) {
        promptBlockById.set(pb.id, pb);
    }

    const activePromptBlockImages: EntityImageRef[] = [];
    const protagonistIdSet = ctx.protagonistIds;
    const currentLocationId = ctx.currentLocation?.id;

    for (const block of allPromptBlocks) {
        if (!isPromptBlockCharacterBound(block, ctx.characterId)) continue;
        if (block.contextBindings && block.contextBindings.length > 0) {
            if (!block.contextBindings.some(ctxId => activeContextIds.has(ctxId))) continue;
        }
        if (block.locationBindings && block.locationBindings.length > 0) {
            if (!currentLocationId || !block.locationBindings.includes(currentLocationId)) continue;
        }

        if (!isEntityActiveWithCache(
            block.regularExpressionActivationTriggers,
            block.regularExpressionDeactivationTriggers,
            block.regularExpressionExclusionActivationTriggers,
            block.regularExpressionExclusionDeactivationTriggers,
            ctx.characterIdArray, ctx.textContentArray,
            ctx.characterId, [...ctx.protagonistIds],
            allTextSearchSpace, ctx.combinationCache,
        )) {
            continue;
        }

        if (block.images && block.images.length > 0) {
            for (const img of block.images) {
                activePromptBlockImages.push({ entityId: block.id, filename: img });
            }
        }
    }

    const effectiveInstructionTemplateKey = activeModel?.instructionTemplate;
    const resolvedInstructionTemplate = effectiveInstructionTemplateKey ? getModelTemplate(effectiveInstructionTemplateKey) : undefined;

    const promptLines: string[] = [];
    const usedBuiltInTypes = new Set<string>();

    for (const entry of inputStrategy) {
        if (entry === 'Model Instruction Template') {
            if (resolvedInstructionTemplate?.instructionTemplate) {
                const assembledSoFar = promptLines.join('\n');
                const systemPrompt = ctx.character.systemPrompt || '';
                const wrapped = resolvedInstructionTemplate.instructionTemplate
                    .replace(/\{instruction\}/g, assembledSoFar)
                    .replace(/\{input\}/g, '')
                    .replace(/\{system\}/g, systemPrompt);
                promptLines.length = 0;
                promptLines.push(wrapped);
            }
            usedBuiltInTypes.add(entry);
        } else if (entry === 'Model Chat Template') {
            if (resolvedChatTemplate?.chatTemplate) {
                const chatHistoryForTemplate = ctx.interactionHistory.filter(
                    (m): m is ChatMessage | WhisperMessage => isTextMessage(m) && isMessageVisibleTo(m, ctx.characterId)
                );
                for (const msg of chatHistoryForTemplate) {
                    const role = protagonistIdSet.has(msg.character.id) ? 'user' : 'assistant';
                    const content = replacePlaceholders(
                        selectModelSummary(msg, modelId),
                        ctx.characterParticipantTag, ctx.characterName,
                        ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames,
                    );
                    const wrapped = resolvedChatTemplate.chatTemplate
                        .replace(/\{role\}/gi, role)
                        .replace(/\{content\}/g, content);
                    promptLines.push(wrapped);
                }
                const genPrompt = resolvedChatTemplate.chatTemplate
                    .replace(/\{role\}/gi, 'assistant')
                    .replace(/\{content\}/g, '');
                promptLines.push(genPrompt);
            }
            usedBuiltInTypes.add(entry);
        } else if (entry === 'Model Chat-Instruction Template') {
            if (resolvedInstructionTemplate?.instructionTemplate && resolvedChatTemplate?.chatTemplate) {
                const assembledSoFar = promptLines.join('\n');
                const systemPrompt = ctx.character.systemPrompt || '';
                const instructionWrapped = resolvedInstructionTemplate.instructionTemplate
                    .replace(/\{instruction\}/g, `Continue the chat dialogue below. Write a single reply for the character "${ctx.characterName}".\n\n${assembledSoFar}`)
                    .replace(/\{input\}/g, '')
                    .replace(/\{system\}/g, systemPrompt);
                promptLines.length = 0;
                promptLines.push(instructionWrapped);
                const chatHistoryForTemplate = ctx.interactionHistory.filter(
                    (m): m is ChatMessage | WhisperMessage => isTextMessage(m) && isMessageVisibleTo(m, ctx.characterId)
                );
                for (const msg of chatHistoryForTemplate) {
                    const role = protagonistIdSet.has(msg.character.id) ? 'user' : 'assistant';
                    const content = replacePlaceholders(
                        selectModelSummary(msg, modelId),
                        ctx.characterParticipantTag, ctx.characterName,
                        ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames,
                    );
                    const wrapped = resolvedChatTemplate.chatTemplate
                        .replace(/\{role\}/gi, role)
                        .replace(/\{content\}/g, content);
                    promptLines.push(wrapped);
                }
                const genPrompt = resolvedChatTemplate.chatTemplate
                    .replace(/\{role\}/gi, 'assistant')
                    .replace(/\{content\}/g, '');
                promptLines.push(genPrompt);
            }
            usedBuiltInTypes.add(entry);
        } else if (isBuiltInBlockType(entry)) {
            const lines = blockMap[entry];
            if (lines && lines.length > 0) {
                promptLines.push(...lines);
            }
            usedBuiltInTypes.add(entry);
        } else {
            const block = promptBlockById.get(entry);
            if (!block) continue;
            if (!block.textContent || !block.textContent.trim()) continue;

            if (!isPromptBlockCharacterBound(block, ctx.characterId)) continue;

            if (block.contextBindings && block.contextBindings.length > 0) {
                if (!block.contextBindings.some(ctxId => activeContextIds.has(ctxId))) continue;
            }

            if (block.locationBindings && block.locationBindings.length > 0) {
                if (!currentLocationId || !block.locationBindings.includes(currentLocationId)) continue;
            }

            if (!isEntityActiveWithCache(
                block.regularExpressionActivationTriggers,
                block.regularExpressionDeactivationTriggers,
                block.regularExpressionExclusionActivationTriggers,
                block.regularExpressionExclusionDeactivationTriggers,
                ctx.characterIdArray, ctx.textContentArray,
                ctx.characterId, [...ctx.protagonistIds],
                allTextSearchSpace, ctx.combinationCache,
            )) {
                continue;
            }

            const replacedText = replacePlaceholders(
                block.textContent,
                ctx.characterParticipantTag,
                ctx.characterName,
                ctx.coLocatedProtagonists,
                ctx.participants,
                ctx.knownNames,
            );

            promptLines.push(`${delimiters.blockStart('system')}${replacedText}${delimiters.blockEnd}`);
        }
    }

    const templatePrompt = promptLines.join('\n');
    const prompt = templatePrompt.replaceAll("{{text}}", `${existingCharacterText}`);

    let defaultStops: string[] = [];

    if (!profile?.doNotInjectDefaultStopTokens) {
        const templateStops = resolvedChatTemplate?.stopPatterns || [];
        const turnEndStop = delimiters.turnEnd.trim();
        
        defaultStops = [
            ...templateStops,
            turnEndStop,
        ].filter(s => s.length > 0);
    }

    const stops = [
        ...defaultStops,
        ...activeStopPatterns.map(sp => sp.pattern),
    ];

    const uniqueStops = Array.from(new Set(stops)).filter(s => typeof s === 'string' && s.trim().length > 0);

    return { prompt, stops: uniqueStops, contextImages: activeContextImages, locationImages: activeLocationImages, promptBlockImages: activePromptBlockImages, characterClothingWearingStatuses, fetchErrors };
}

// ─── Universal Message Filter ─────────────────────────────────────

function applyFilterTriggersUniversal(
    chatMessages: (ChatMessage | WhisperMessage)[],
    excluded: boolean[],
    activationTriggers: RegularExpressionTrigger[] | undefined,
    deactivationTriggers: RegularExpressionTrigger[] | undefined,
): void {
    const activationRegexes = compileTriggerRegexes(activationTriggers);
    if (activationRegexes.length === 0) return;
    const deactivationRegexes = compileTriggerRegexes(deactivationTriggers);

    let including = false;
    for (let i = 0; i < chatMessages.length; i++) {
        const msg = chatMessages[i];
        if (including) {
            if (deactivationRegexes.some(r => r.test(msg.textContent))) return;
        } else {
            if (activationRegexes.some(r => r.test(msg.textContent))) {
                including = true;
            } else {
                excluded[i] = true;
            }
        }
    }
}

export function getUniversalMessageFilterFlags(
    chatMessages: (ChatMessage | WhisperMessage)[],
    contexts: Context[],
    locations: Location[],
    promptBlocks: PromptBlock[],
): boolean[] {
    const excluded = new Array(chatMessages.length).fill(false);

    for (const context of contexts) {
        if (context.characterBindings && context.characterBindings.length > 0) continue;
        applyFilterTriggersUniversal(
            chatMessages,
            excluded,
            context.messageFilterRegularExpressionActivationTriggers,
            context.messageFilterRegularExpressionDeactivationTriggers,
        );
    }

    for (const location of locations) {
        if (location.characterBindings && location.characterBindings.length > 0) continue;
        applyFilterTriggersUniversal(
            chatMessages,
            excluded,
            location.messageFilterRegularExpressionActivationTriggers,
            location.messageFilterRegularExpressionDeactivationTriggers,
        );
    }

    for (const block of promptBlocks) {
        if (block.characterBindings && block.characterBindings.length > 0) continue;
        applyFilterTriggersUniversal(
            chatMessages,
            excluded,
            block.messageFilterRegularExpressionActivationTriggers,
            block.messageFilterRegularExpressionDeactivationTriggers,
        );
    }

    return excluded;
}