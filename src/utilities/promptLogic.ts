// src/utilities/promptLogic.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage, WhisperMessage, Context, StopPattern, PromptBlock, promptBlockType, regularExpressionContext, regularExpressionTarget, tool, Location, RegularExpressionTrigger, Clothing, Profile, cacheEfficiencyConfigurationType } from '../types';
import type { ModelTemplate } from '../dictionaries/modelTemplates';
import type { OpenAIMessage } from '../services/ProviderCachingStrategy';
import { fetchMultipleContextUrls } from './linkFetcher';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getEffectiveTools, getEffectiveMaximumChatStamina, getEffectiveMessagesToDisableDialoguePrompt, getEffectiveMessagesToDisableMetaThinkInstructions, getEffectiveMessagesToDisableThinkPrompt, getEffectiveMessagesToDisableStarterPrompt } from './characterLogic';
import { toolStartString, toolEndString } from '../dictionaries/stringList';
import { type TimeData, fetchCurrentWeather, getLocation, getTimeDataFromCoordinates } from '../services/LocationEngine';
import { getCoLocatedProtagonists, getCoLocatedParticipants, getReachableLocationsByCharacter, getCurrentLocationId, } from './locationLogic';
import { defaultInputStrategy } from '../dictionaries/defaults';
import { getModelTemplate } from '../dictionaries/modelTemplates';
import { generateLocationVisitSummary } from '../services/ChatMessageSummarizationEngine';
import { findLatestMessage } from './messageLogic';
import { getLocalMessageHistory } from './timelineLogic';
import { collectActiveDialoguePromptContent, buildDialogueSearchSpace } from './dialoguePromptLogic';
import { STOP_STEMS, getStemmedContentWords } from './stemmerHelper';

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

const DEFAULT_MAX_RECURSION_DEPTH = 3;
const DEFAULT_CONTEXT_TOKEN_BUDGET = 2048;

const tokenEngine = getLanguageModelEngine();

type CombinationCache = Record<string, Record<string, { characterIdArray: string[]; textContentArray: string[] }>>;

// ─── Image Reference Type ──────────────────────────────────────────

export interface EntityImageRef {
    entityId: string;
    filename: string;
}

// ─── Compile Trigger Regexes Helper ─────────────────────────────────

function compileTriggerRegexes(triggers: RegularExpressionTrigger[] | undefined): RegExp[] {
    if (!triggers || triggers.length === 0) return [];
    const regexes: RegExp[] = [];
    for (const t of triggers) {
        if (!t.trigger.trim()) continue;
        try { regexes.push(new RegExp(t.trigger)); } catch { /* skip invalid */ }
    }
    return regexes;
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
    const thinkStart = template?.thinkStart || '';
    const thinkEnd = template?.thinkEnd || '';
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

    localHistory: HistoryMessage[];
    participants: Character[];
    coLocatedProtagonists: Character[];
    coLocatedParticipants: Character[];
    protagonistIds: Set<string>;
    characterId: string;
    characterParticipantId: number;
    characterParticipantTag: string;
    characterName: string;
    profile: Profile | undefined;
    cacheEfficiencyLevels: Record<cacheEfficiencyConfigurationType, number>;
    minimalVolatileCacheMode: boolean;
    currentLocation: Location | undefined;
    currentLocationId: string | undefined;

    characterIdArray: string[];
    textContentArray: string[];
    combinationCache: CombinationCache;
    numberOfMessagesByParticipant: number;

    delimiters: PromptDelimiters;
}

// ─── Small Helpers ────────────────────────────────────────────────

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
        if (knownMap[candidate]) return candidate;
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

// ─── Whisper Visibility Helpers ─────────────────────────────────────

function isMessageVisibleTo(msg: HistoryMessage, characterId: string): boolean {
    if (msg.messageType === 'chat') return true;
    if (msg.messageType === 'whisper') {
        const whisper = msg as WhisperMessage;
        return whisper.character.id === characterId || whisper.targetCharacterIds.includes(characterId);
    }
    return false;
}

function isTextMessage(msg: HistoryMessage): msg is ChatMessage | WhisperMessage {
    return msg.messageType === 'chat' || msg.messageType === 'whisper';
}

// ─── Regex / Filter Helpers ───────────────────────────────────────

function filterArrayBasedOnContext(
    characterIdArray: string[],
    textContentArray: string[],
    selectedCharacterId: string,
    contextType: regularExpressionContext
): { characterIdArray: string[]; textContentArray: string[] } {
    const length = characterIdArray.length;
    if (length === 0) return { characterIdArray: [], textContentArray: [] };

    if (contextType === "global") return { characterIdArray, textContentArray };

    if (contextType === "previous") {
        for (let i = length - 1; i >= 0; i--) {
            if (characterIdArray[i] === selectedCharacterId) {
                return { characterIdArray: [characterIdArray[i]], textContentArray: [textContentArray[i]] };
            }
        }
        return { characterIdArray: [], textContentArray: [] };
    }

    if (contextType === "local") {
        let targetIndex = -1;
        const endIndex = length - 1;
        for (let i = endIndex; i >= 0; i--) {
            if ((characterIdArray[i] === selectedCharacterId) && (i === endIndex)) continue;
            if ((characterIdArray[i] !== selectedCharacterId) && (i === endIndex)) { targetIndex = i; break; }
            if ((characterIdArray[i] === selectedCharacterId) && (characterIdArray[i + 1] !== selectedCharacterId)) { targetIndex = i; break; }
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
    selectedCharacterId: string,
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
            if (characterIdArray[i] === selectedCharacterId) {
                extractedCharacterIdArray.push(characterIdArray[i]);
                extractedTextContentArray.push(textContentArray[i]);
            }
        }
    } else if (targetType === "listener") {
        for (let i = length - 1; i >= 0; i--) {
            if (characterIdArray[i] !== selectedCharacterId) {
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

function isCharacterBound(context: Context, selectedCharacterId: string): boolean {
    if (!context.characterBindings || context.characterBindings.length === 0) return true;
    return context.characterBindings.includes(selectedCharacterId);
}

function isPromptBlockCharacterBound(block: PromptBlock, selectedCharacterId: string): boolean {
    if (!block.characterBindings || block.characterBindings.length === 0) return true;
    return block.characterBindings.includes(selectedCharacterId);
}

function isBuiltInBlockType(value: string): value is promptBlockType {
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
    selectedCharacterId: string,
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
            selectedCharacterId, protagonistIds,
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
    selectedCharacterId: string,
    protagonistIds: string[],
    fallbackSearchSpace: string,
    combinationCache: CombinationCache,
    sensitivityMultiplier?: number,
): boolean {
    if (!activationTriggers || activationTriggers.length === 0) return true;

    if (!doesAnyTriggerMatchCached(
        activationTriggers, characterIdArray, textContentArray,
        selectedCharacterId, protagonistIds, fallbackSearchSpace,
        combinationCache, sensitivityMultiplier
    )) {
        return false;
    }

    if (doesAnyTriggerMatchCached(
        deactivationTriggers, characterIdArray, textContentArray,
        selectedCharacterId, protagonistIds, fallbackSearchSpace,
        combinationCache
    )) {
        return false;
    }

    if (doesAnyTriggerMatchCached(
        exclusionActivationTriggers, characterIdArray, textContentArray,
        selectedCharacterId, protagonistIds, fallbackSearchSpace,
        combinationCache
    )) {
        if (!doesAnyTriggerMatchCached(
            exclusionDeactivationTriggers, characterIdArray, textContentArray,
            selectedCharacterId, protagonistIds, fallbackSearchSpace,
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
                if (deactivationRegexes.some((r: RegExp) => r.test(msg.textContent))) {
                    return;
                }
            } else {
                if (activationRegexes.some((r: RegExp) => r.test(msg.textContent))) {
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
    const localHistory = getLocalMessageHistory(
        interactionData, 
        interactionData.participants.find(p => p.id === characterId) || { id: characterId, name: 'Unknown' } as Character, 
        ['chat', 'whisper']
    ) as (ChatMessage | WhisperMessage)[];

    if (localHistory.length === 0) return [];

    const contexts = interactionData.contexts || [];
    const locations = interactionData.locations || [];
    const filterFlags = getMessageFilterFlags(localHistory, contexts, locations, allPromptBlocks, characterId);
    return localHistory.filter((_, i) => !filterFlags[i]);
}

// ─── Context Resolution ──────────────────────────────────────────

async function resolveContextEntries(
    contexts: Context[],
    chatSearchSpace: string,
    selectedCharacterId: string,
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
        if (!isCharacterBound(context, selectedCharacterId)) continue;

        if (isEntityActiveWithCache(
            context.regularExpressionActivationTriggers,
            context.regularExpressionDeactivationTriggers,
            context.regularExpressionExclusionActivationTriggers,
            context.regularExpressionExclusionDeactivationTriggers,
            characterIdArray, textContentArray,
            selectedCharacterId, protagonistIds,
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

    while (newActivations) {
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
            if (!isCharacterBound(context, selectedCharacterId)) continue;

            const contextMaxDepth = context.maximumRecursionDepth ?? DEFAULT_MAX_RECURSION_DEPTH;
            if (contextMaxDepth === 0) continue;
            if (recursionDepth > contextMaxDepth) continue;

            if (isEntityActiveWithCache(
                context.regularExpressionActivationTriggers,
                context.regularExpressionDeactivationTriggers,
                context.regularExpressionExclusionActivationTriggers,
                context.regularExpressionExclusionDeactivationTriggers,
                characterIdArray, textContentArray,
                selectedCharacterId, protagonistIds,
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

    const prevMsg = findLatestMessage(interactionData, character);
    const prevStatus = (prevMsg?.message as ChatMessage)?.characterClothingWearingStatuses ?? {};

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
    locationId: string;
    nextLocationId?: string;
    startIdx: number;
    endIdx: number;
    lastMessageId: string;
}

export function detectUnsummarizedLocationDepartures(
    interactionData: InteractionData,
    character: Character,
    modelId: string,
): LocationVisitSegment[] {
    const histories = interactionData.interactionHistories || {};
    const protagonistIds = new Set(interactionData.protagonists?.map(p => p.id) ?? []);
    if (protagonistIds.has(character.id)) return [];

    const latest = findLatestMessage(interactionData, character);
    const currentLocationId = latest?.locationId;

    const globalHistory = Object.values(histories).flat().sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
    const segments: LocationVisitSegment[] = [];

    for (const [locationId, messages] of Object.entries(histories)) {
        if (locationId === currentLocationId) continue;

        const charMessages = messages.filter(m => m.character.id === character.id && isTextMessage(m));
        if (charMessages.length === 0) continue;

        const lastMsg = charMessages[charMessages.length - 1];
        const existingSummary = (lastMsg as ChatMessage).modelInteractionTextContentSummaries?.[modelId];
        if (existingSummary) continue;

        const startIdx = globalHistory.findIndex(m => m.id === charMessages[0].id);
        const endIdx = globalHistory.findIndex(m => m.id === lastMsg.id);

        if (startIdx !== -1 && endIdx !== -1) {
            segments.push({
                characterId: character.id,
                locationId,
                nextLocationId: currentLocationId,
                startIdx,
                endIdx,
                lastMessageId: lastMsg.id,
            });
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
    const localHistory = getLocalMessageHistory(interactionData, character, ['chat', 'whisper']);
    const participants = interactionData.participants;
    const coLocatedProtagonists = getCoLocatedProtagonists(interactionData, character);
    const coLocatedParticipants = getCoLocatedParticipants(interactionData, character);
    const protagonistIds = new Set(coLocatedProtagonists.map(p => p.id));
    const characterId = character.id;
    const characterParticipantId = getParticipantId(character, participants);
    const characterParticipantTag = getParticipantTag(character, participants);
    const characterName = character.name;
    const profile = interactionData.profile;

    const cacheEfficiencyLevels: Record<cacheEfficiencyConfigurationType, number> =
        profile?.cacheEfficiencyLevels ?? { 'Character Name': 0, 'System Prompt': 0, 'Think Prompt': 0 };
    const minimalVolatileCacheMode = profile?.minimalVolatileCacheMode ?? false;

    const characterIdArray: string[] = [];
    const textContentArray: string[] = [];
    for (const msg of localHistory) {
        if (isTextMessage(msg) && isMessageVisibleTo(msg, characterId)) {
            characterIdArray.push(msg.character.id);
            textContentArray.push(msg.textContent);
        }
    }

    const currentLocationId = getCurrentLocationId(interactionData, character);
    const locs = interactionData.locations;
    const currentLocation = currentLocationId && locs ? locs.find(l => l.id === currentLocationId) : undefined;

    const numberOfMessagesByParticipant = localHistory.filter(
        msg => msg.character.id === characterId && isTextMessage(msg)
    ).length;

    return {
        interactionData,
        character,
        knownNames,
        modelId,
        allPromptBlocks,
        existingCharacterText,
        localHistory,
        participants,
        coLocatedProtagonists,
        coLocatedParticipants,
        protagonistIds,
        characterId,
        characterParticipantId,
        characterParticipantTag,
        characterName,
        profile,
        cacheEfficiencyLevels,
        minimalVolatileCacheMode,
        currentLocation,
        currentLocationId,
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

    const nameLevel = ctx.cacheEfficiencyLevels['Character Name'] ?? 0;

    let participantsToRender: Character[];
    if (nameLevel >= 2) {
        participantsToRender = ctx.participants;
    } else if (nameLevel >= 1) {
        const coLocatedIds = new Set(ctx.coLocatedParticipants.map(p => p.id));
        coLocatedIds.add(ctx.characterId);
        participantsToRender = ctx.participants.filter(p => coLocatedIds.has(p.id));
    } else {
        participantsToRender = ctx.participants.filter(p => p.id === ctx.characterId);
    }

    if (participantsToRender.length === 0) return lines;

    lines.push(`${ctx.delimiters.blockStart('system')}Start Of The Characters' Appearances List.${ctx.delimiters.blockEnd}`);

    for (const participant of participantsToRender) {
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

        const useFrozenName = nameLevel >= 1 && !isCurrent;
        const roleStr = useFrozenName
            ? `${otherTag} (${knownName ?? participant.name})`
            : (knownName ? `${otherTag} (${knownName})` : otherTag);

        const appearanceText = `${ctx.delimiters.blockStart(roleStr)}${finalAppearancePrompt}${ctx.delimiters.blockEnd}`;
        lines.push(appearanceText);
    }

    lines.push(`${ctx.delimiters.blockStart('system')}End Of The Characters' Appearances List.${ctx.delimiters.blockEnd}`);
    return lines;
}

function buildSystemPromptLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    const systemLevel = ctx.cacheEfficiencyLevels['System Prompt'] ?? 0;
    let systemPrompt = ctx.character.systemPrompt;

    if (systemLevel >= 2) {
        for (const p of ctx.participants) {
            if (p.systemPrompt) {
                lines.push(`${ctx.delimiters.blockStart('system')}${getParticipantTag(p, ctx.participants)} Prompt: ${replacePlaceholders(p.systemPrompt, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames)}${ctx.delimiters.blockEnd}`);
            }
        }
    } else if (systemLevel >= 1) {
        const coLocatedIds = new Set(ctx.coLocatedParticipants.map(p => p.id));
        coLocatedIds.add(ctx.characterId);
        for (const p of ctx.participants) {
            if (!coLocatedIds.has(p.id)) continue;
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
    const thinkLevel = ctx.cacheEfficiencyLevels['Think Prompt'] ?? 0;
    let thinkPrompt = ctx.character.thinkPrompt;

    if (thinkLevel >= 2) {
        for (const p of ctx.participants) {
            if (p.thinkPrompt) {
                lines.push(`${ctx.delimiters.blockStart('system')}I am keeping this in mind as ${getParticipantTag(p, ctx.participants)}: ${replacePlaceholders(p.thinkPrompt, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames)}${ctx.delimiters.blockEnd}`);
            }
        }
    } else if (thinkLevel >= 1) {
        const coLocatedIds = new Set(ctx.coLocatedParticipants.map(p => p.id));
        coLocatedIds.add(ctx.characterId);
        for (const p of ctx.participants) {
            if (!coLocatedIds.has(p.id)) continue;
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

        const locationName = replacePlaceholders(
            location.name || 'Unknown Location',
            ctx.characterParticipantTag, ctx.characterName,
            ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames,
        );
        const locationText = location.text?.trim();

        let locationContent = `${ctx.delimiters.blockStart('system')}Current Location: ${locationName}`;
        if (locationText) {
            const replacedLocationText = replacePlaceholders(
                locationText,
                ctx.characterParticipantTag, ctx.characterName,
                ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames,
            );
            locationContent += `\n\n${replacedLocationText}`;
        }
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
            const reachableNames = reachable.map(r => replacePlaceholders(
                r.name || 'Unknown Location',
                ctx.characterParticipantTag, ctx.characterName,
                ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames,
            ));
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

    const latest = findLatestMessage(ctx.interactionData, ctx.character);
    const latestInventory = latest?.message.inventory;

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
        const exampleTool = enabledToolNames.includes('dice' as tool)
            ? 'dice(sides: 6, count: 1)'
            : `${enabledToolNames[0]}()`;

        const toolInstructions = [
            `I have access to external tools: ${enabledToolNames.join(', ')}.`,
            `To invoke a tool, I must write ${toolStartString}tool_name(arguments)${toolEndString} (for example: ${toolStartString}${exampleTool}${toolEndString}). Calling a tool without arguments returns its usage instructions.`,
            `ACTION-FIRST PROTOCOL: Whenever an action, calculation, or external data is needed, I must output the ${toolStartString}...${toolEndString} invocation FIRST at the very start of my turn before speaking.`,
            `The tool will execute immediately and return its value inline as  <result>. I will then continue my dialogue directly on the same line incorporating the real result. I will never output raw tool result labels or add unnecessary blank lines.`
        ].join(' ');

        lines.push(`${ctx.delimiters.blockStart('system')}${toolInstructions}${ctx.delimiters.blockEnd}`);
    }

    return lines;
}

function buildFatigueLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    const previousMessage = findLatestMessage(ctx.interactionData, ctx.character);
    const effectiveMaxStamina = getEffectiveMaximumChatStamina(ctx.character, ctx.profile);
    const currentChatStamina = previousMessage?.message.remainingChatStamina ?? effectiveMaxStamina;
    const paragraphText = (currentChatStamina > 1) ? "paragraphs" : "paragraph";

    if (currentChatStamina !== undefined && effectiveMaxStamina !== Number.POSITIVE_INFINITY) {
        const remainingChatStaminaInstructions = `${ctx.delimiters.blockStart('system')}I understand that I can create a minimum of 1 paragraph and a maximum of ${currentChatStamina} ${paragraphText}. If I exceed this, I will naturally stop my paragraphs as soon as possible.${ctx.delimiters.blockEnd}`;
        if (remainingChatStaminaInstructions) lines.push(remainingChatStaminaInstructions);
        const fatigue = getFatigueContext(currentChatStamina, effectiveMaxStamina);
        if (fatigue) lines.push(`${ctx.delimiters.blockStart('system')}${fatigue}${ctx.delimiters.blockEnd}`);
    }

    return lines;
}

function buildAntiRepetitionNudgeLines(ctx: PromptBuildContext): string[] {
    const lines: string[] = [];
    const windowSize = Math.max(2, ctx.coLocatedParticipants.length * 2);

    const localHistory = getLocalMessageHistory(ctx.interactionData, ctx.character, ['chat', 'whisper'], windowSize);
    const recentAiMessages = localHistory.filter(m => m.character.id === ctx.characterId) as (ChatMessage | WhisperMessage)[];

    if (recentAiMessages.length < 2) return lines; 

    const texts = recentAiMessages.map(m => m.textContent);

    const extractSentenceShingles = (text: string): Set<string>[] => {
        const rawSentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 0);
        const sentenceShingles: Set<string>[] = [];

        for (const raw of rawSentences) {
            const words = raw.toLowerCase()
                .replace(/[*_~"()\[\]{}.,!?;:]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ')
                .filter(w => w.length > 1)
                .flatMap(getStemmedContentWords)
                .filter(w => !STOP_STEMS.has(w));

            if (words.length < 3) continue;

            const shingles = new Set<string>();
            for (let i = 0; i < words.length - 2; i++) {
                shingles.add(`${words[i]} ${words[i+1]} ${words[i+2]}`);
            }
            if (shingles.size > 0) {
                sentenceShingles.push(shingles);
            }
        }
        return sentenceShingles;
    };

    const allSentences: Set<string>[] = [];
    for (const text of texts) {
        allSentences.push(...extractSentenceShingles(text));
    }

    let structuralLoopDetected = false;
    for (let i = 0; i < allSentences.length; i++) {
        for (let j = i + 1; j < allSentences.length; j++) {
            const setA = allSentences[i];
            const setB = allSentences[j];
            let intersection = 0;
            for (const shingle of setA) {
                if (setB.has(shingle)) intersection++;
            }
            const union = setA.size + setB.size - intersection;
            const jaccard = intersection / union;
            if (jaccard > 0.45) { 
                structuralLoopDetected = true;
                break;
            }
        }
        if (structuralLoopDetected) break;
    }

    let consecutiveHighSimilarity = 0;
    const messageShingles: Set<string>[] = texts.map(t => {
        const words = t.toLowerCase()
            .replace(/[*_~"()\[\]{}.,!?;:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(w => w.length > 2)
            .flatMap(getStemmedContentWords)
            .filter(w => !STOP_STEMS.has(w));
        return new Set(words);
    });

    for (let i = 0; i < messageShingles.length - 1; i++) {
        const setA = messageShingles[i];
        const setB = messageShingles[i+1];
        if (setA.size === 0 || setB.size === 0) continue;
        let intersection = 0;
        for (const w of setA) {
            if (setB.has(w)) intersection++;
        }
        const union = setA.size + setB.size - intersection;
        if ((intersection / union) > 0.60) { 
            consecutiveHighSimilarity++;
        }
    }

    const lexicalLoopDetected = consecutiveHighSimilarity >= 2;

    if (structuralLoopDetected || lexicalLoopDetected) {
        let nudgeText = 'Narrative Loop Detected. ';
        if (structuralLoopDetected) {
            nudgeText += 'You are excessively repeating the same sentence structures and syntactic patterns. ';
        }
        if (lexicalLoopDetected) {
            nudgeText += 'Your recent responses share too much overall lexical similarity. ';
        }
        nudgeText += 'You MUST break this pattern immediately. Introduce a completely new action, shift the emotional tone, advance the dialogue, or alter the environment. Do not reuse recent mannerisms, phrases, or sentence structures.';
        lines.push(`${ctx.delimiters.blockStart('system')}${nudgeText}${ctx.delimiters.blockEnd}`);
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
    //const characterTextInjection = '{{text}}';

    lines.push(characterResponsePriming);
    lines.push(characterTextInjection);

    return lines;
}

// ─── Chat History Prompt ──────────────────────────────────────────

export function createChatHistoryPrompt(
    ctx: PromptBuildContext,
): { chatHistoryPrompt: string; hasBeenSummarized: boolean } {
    const participants = ctx.participants;
    const profile = ctx.profile;
    const contexts = ctx.interactionData.contexts || [];
    const locations = ctx.interactionData.locations || [];
    const protagonistIds = ctx.protagonistIds;

    const localHistory = ctx.localHistory;
    
    const messageLocationMap = new Map<string, string>();
    for (const [locId, messages] of Object.entries(ctx.interactionData.interactionHistories || {})) {
        for (const msg of messages) {
            messageLocationMap.set(msg.id, locId);
        }
    }

    const visibleTextMessages = localHistory.filter(
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
        locationId: messageLocationMap.get(msg.id),
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

        if (step.strategyType === 'Entropy Pruning') {
            const chunkSize = step.entropyPruningChunkSize ?? 3;
            const threshold = step.entropyPruningThreshold ?? 0.35;
            const maxRawTokens = step.entropyPruningTokenBudget ?? 2000;

            let accumulatedTokens = 0;
            let cutoffIndex = 0;

            for (let i = processedMessages.length; i > chunkSize; i -= chunkSize) {
                const chunkStart = Math.max(0, i - chunkSize);
                const currentChunk = processedMessages.slice(chunkStart, i);
                const previousChunk = processedMessages.slice(Math.max(0, chunkStart - chunkSize), chunkStart);

                for (const msg of currentChunk) accumulatedTokens += Math.ceil(msg.text.length / 4);

                let hardBoundary = false;
                for (let j = 1; j < currentChunk.length; j++) {
                    const prev = currentChunk[j - 1].msg;
                    const curr = currentChunk[j].msg;
                    const prevLoc = messageLocationMap.get(prev.id);
                    const currLoc = messageLocationMap.get(curr.id);
                    if (prevLoc !== undefined && currLoc !== undefined && prevLoc !== currLoc) {
                        hardBoundary = true;
                        break;
                    }
                }
                if (hardBoundary) { cutoffIndex = i; break; }
                if (accumulatedTokens >= maxRawTokens) { cutoffIndex = i; break; }

                if (previousChunk.length > 0) {
                    const currentWords = new Set<string>();
                    for (const msg of currentChunk) {
                        for (const w of getStemmedContentWords(msg.text)) currentWords.add(w);
                    }
                    
                    const previousWords = new Set<string>();
                    for (const msg of previousChunk) {
                        for (const w of getStemmedContentWords(msg.text)) previousWords.add(w);
                    }

                    let intersection = 0;
                    for (const w of currentWords) {
                        if (previousWords.has(w)) intersection++;
                    }
                    
                    const union = currentWords.size + previousWords.size - intersection;
                    const lexicalOverlap = union > 0 ? intersection / union : 0;
                    
                    if ((1 - lexicalOverlap) < threshold) {
                        cutoffIndex = chunkStart;
                        break;
                    }
                }
                cutoffIndex = chunkStart;
            }

            for (let i = 0; i < processedMessages.length; i++) {
                const msg = processedMessages[i].msg;
                if (i < cutoffIndex && (msg as ChatMessage).modelTextContentSummaries?.[ctx.modelId]) {
                    processedMessages[i].text = (msg as ChatMessage).modelTextContentSummaries[ctx.modelId];
                    hasBeenSummarized = true;
                }
            }
        }
    }

    const currentLocationId = ctx.currentLocationId;
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

    const hasLocationData = !!locs && locs.length > 0 && currentLocationId !== undefined;

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
            
            const msgLoc = messageLocationMap.get(msg.id);
            if (msgLoc !== undefined && msgLoc !== currentLocationId) {
                const loc = locs.find(l => l.id === msgLoc);
                const locName = replacePlaceholders(
                    loc?.name || 'Unknown Location',
                    ctx.characterParticipantTag, ctx.characterName,
                    ctx.coLocatedProtagonists, participants, ctx.knownNames,
                );
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
            const charLocationId = p.locationId;
            if (charLocationId !== undefined && charLocationId === currentLocationId) return true;
            if (charLocationId === undefined) return true;
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
        const sceneName = replacePlaceholders(
            currentLocation.name || 'Unknown Location',
            ctx.characterParticipantTag, ctx.characterName,
            ctx.coLocatedProtagonists, participants, ctx.knownNames,
        );
        chatHistoryLines.push(`${ctx.delimiters.turnStart('system')}[Scene: ${sceneName}]${ctx.delimiters.turnEnd}`);
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

// ─── Volatile Section Classification ─────────────────────────────

const VOLATILE_BLOCK_TYPES: ReadonlySet<string> = new Set([
    'Location',
    'Inventory',
    'Weather',
    'Date',
    'Time',
    'Time Elapsed',
    'Fatigue Information',
    'Tool Instructions',
    'Anti-Repetition Nudge',
]);

function buildStructuredMessages(
    blockMap: Record<string, string[] | undefined>,
    inputStrategy: (promptBlockType | string)[],
    minimalVolatileCacheMode: boolean,
    existingCharacterText: string,
): OpenAIMessage[] {
    const staticEntries: string[] = [];
    const volatileEntries: string[] = [];

    for (const entry of inputStrategy) {
        if (entry === 'Model Instruction Template' ||
            entry === 'Model Chat Template' ||
            entry === 'Model Chat-Instruction Template') {
            continue;
        }

        if (VOLATILE_BLOCK_TYPES.has(entry)) {
            volatileEntries.push(entry);
        } else {
            staticEntries.push(entry);
        }
    }

    const orderedEntries = minimalVolatileCacheMode
        ? [...staticEntries, ...volatileEntries]
        : inputStrategy.filter(e =>
            e !== 'Model Instruction Template' &&
            e !== 'Model Chat Template' &&
            e !== 'Model Chat-Instruction Template'
        );

    const staticLines: string[] = [];
    const semiStableLines: string[] = [];
    const historyLines: string[] = [];
    const volatileLines: string[] = [];
    const triggerLines: string[] = [];

    for (const entry of orderedEntries) {
        const lines = blockMap[entry];
        if (!lines || lines.length === 0) continue;

        if (entry === 'Chat History') {
            historyLines.push(...lines);
        } else if (entry === 'Text Injection') {
            triggerLines.push(...lines);
        } else if (VOLATILE_BLOCK_TYPES.has(entry)) {
            volatileLines.push(...lines);
        } else if (entry === 'Context' || entry === 'Starter Prompt') {
            semiStableLines.push(...lines);
        } else {
            staticLines.push(...lines);
        }
    }

    const messages: OpenAIMessage[] = [];

    if (staticLines.length > 0) {
        messages.push({ role: 'system', content: staticLines.join('\n') });
    }

    if (semiStableLines.length > 0) {
        messages.push({ role: 'system', content: semiStableLines.join('\n') });
    }

    if (historyLines.length > 0) {
        messages.push({ role: 'system', content: historyLines.join('\n') });
    }

    if (volatileLines.length > 0) {
        messages.push({ role: 'user', content: volatileLines.join('\n') });
    }

    if (triggerLines.length > 0) {
        const triggerContent = triggerLines.join('\n').replaceAll('{{text}}', existingCharacterText);
        messages.push({ role: 'assistant', content: triggerContent });
    }

    return messages;
}

// ─── Builder Registry ───────────────────────────────────────────────

interface BuilderContext {
    ctx: PromptBuildContext;
    activeContextIds: Set<string>;
    characterClothingWearingStatuses: Record<string, boolean>;
    contextLines: string[];
    hasBeenSummarized: boolean;
    latitude?: number;
    longitude?: number;
    timeData: TimeData | null;
    locationImages: EntityImageRef[];
}

const PROMPT_BUILDERS: Record<string, (b: BuilderContext) => Promise<string[]>> = {
    'System Prompt': async (b) => buildSystemPromptLines(b.ctx),
    'Think Prompt': async (b) => buildThinkPromptLines(b.ctx),
    'Meta Think Instructions': async (b) => buildMetaThinkLines(b.ctx),
    'Appearance Prompt': async (b) => {
        const lines = buildAppearanceLines(b.ctx);
        const visibleClothingDescriptions = getVisibleClothingDescriptions(
            b.ctx.character.clothings ?? [], 
            b.characterClothingWearingStatuses
        );
        
        if (visibleClothingDescriptions.length > 0) {
            const clothingLines = visibleClothingDescriptions.map(desc => {
                const replaced = replacePlaceholders(
                    desc, b.ctx.characterParticipantTag, b.ctx.characterName,
                    b.ctx.coLocatedProtagonists, b.ctx.participants, b.ctx.knownNames
                );
                return `${b.ctx.delimiters.blockStart('system')}${replaced}${b.ctx.delimiters.blockEnd}`;
            });
            
            if (lines.length >= 2) {
                lines.splice(lines.length - 1, 0, ...clothingLines);
            } else {
                lines.push(`${b.ctx.delimiters.blockStart('system')}Start Of The Characters' Appearances List.${b.ctx.delimiters.blockEnd}`);
                lines.push(...clothingLines);
                lines.push(`${b.ctx.delimiters.blockStart('system')}End Of The Characters' Appearances List.${b.ctx.delimiters.blockEnd}`);
            }
        }
        return lines;
    },
    'Dialogue Prompt': async (b) => buildDialoguePromptLines(b.ctx),
    'Starter Prompt': async (b) => buildStarterPromptLines(b.ctx),
    'Chat History': async (b) => {
        if (b.ctx.localHistory.length > 0) {
            const chatHistoryPrompt = createChatHistoryPrompt(b.ctx);
            b.hasBeenSummarized = chatHistoryPrompt.hasBeenSummarized;
            return [chatHistoryPrompt.chatHistoryPrompt];
        }
        return [];
    },
    'Context': async (b) => {
        if (b.contextLines.length > 0) {
            return [
                `${b.ctx.delimiters.blockStart('system')}Start Of The Context.${b.ctx.delimiters.blockEnd}`,
                ...b.contextLines,
                `${b.ctx.delimiters.blockStart('system')}End Of The Context.${b.ctx.delimiters.blockEnd}`
            ];
        }
        return [];
    },
    'Location': async (b) => {
        const result = buildLocationLines(b.ctx);
        b.locationImages.push(...result.images);
        return result.lines;
    },
    'Inventory': async (b) => buildInventoryLines(b.ctx),
    'Weather': async (b) => {
        const { profile } = b.ctx;
        if (profile?.weatherApiKey && b.latitude && b.longitude) {
            const weatherLine = await fetchCurrentWeather(b.latitude, b.longitude, profile.weatherApiKey);
            if (weatherLine) {
                return [`${b.ctx.delimiters.blockStart('system')}${weatherLine}${b.ctx.delimiters.blockEnd}`];
            }
        }
        return [];
    },
    'Date': async (b) => {
        if (b.timeData) {
            return [`${b.ctx.delimiters.blockStart('system')}Today's date is ${b.timeData.formattedDate}.${b.ctx.delimiters.blockEnd}`];
        }
        return [];
    },
    'Time': async (b) => {
        if (b.timeData) {
            return [`${b.ctx.delimiters.blockStart('system')}The current time is ${b.timeData.formattedTime}.${b.ctx.delimiters.blockEnd}`];
        }
        return [];
    },
    'Time Elapsed': async (b) => {
        if (b.timeData && b.ctx.localHistory.length > 0) {
            const lastMsgTimestamp = b.ctx.localHistory[b.ctx.localHistory.length - 1].lastUpdatedTimestamp;
            const diffMs = Math.max(0, b.timeData.rawTimestamp - lastMsgTimestamp);
            const totalSeconds = Math.floor(diffMs / 1000);
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
            return [`${b.ctx.delimiters.blockStart('system')}It has been ${timeSinceLastMessageString} since the last message in the real world. I may or may not acknowledge the time elapsed. I will update relevant information according to this information. For example, a previous time must be subtracted or added with the elapsed time to get current time.${b.ctx.delimiters.blockEnd}`];
        }
        return [];
    },
    'Fatigue Information': async (b) => buildFatigueLines(b.ctx),
    'Tool Instructions': async (b) => buildToolInstructionLines(b.ctx),
    'Anti-Repetition Nudge': async (b) => buildAntiRepetitionNudgeLines(b.ctx),
    'Text Injection': async (b) => buildTextInjectionLines(b.ctx, b.hasBeenSummarized, b.contextLines),
};

async function buildPromptBlocks(
    builderCtx: BuilderContext,
    inputStrategy: string[]
): Promise<Record<string, string[]>> {
    const blockMap: Record<string, string[]> = {};
    
    for (const blockType of inputStrategy) {
        const builder = PROMPT_BUILDERS[blockType];
        if (!builder) continue;
        
        const { ctx } = builderCtx;
        if (blockType === 'Think Prompt' && ctx.numberOfMessagesByParticipant >= getEffectiveMessagesToDisableThinkPrompt(ctx.character, ctx.profile)) continue;
        if (blockType === 'Meta Think Instructions' && ctx.numberOfMessagesByParticipant >= getEffectiveMessagesToDisableMetaThinkInstructions(ctx.character, ctx.profile)) continue;
        if (blockType === 'Dialogue Prompt' && ctx.numberOfMessagesByParticipant >= getEffectiveMessagesToDisableDialoguePrompt(ctx.character, ctx.profile)) continue;
        if (blockType === 'Starter Prompt' && ctx.numberOfMessagesByParticipant >= getEffectiveMessagesToDisableStarterPrompt(ctx.character, ctx.profile)) continue;
        
        const lines = await builder(builderCtx);
        if (lines.length > 0) {
            blockMap[blockType] = lines;
        }
    }
    
    return blockMap;
}

// ─── Main Orchestrator ────────────────────────────────────────────

interface BuildResult {
    messages: OpenAIMessage[];
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

    const profile = ctx.profile;
    const inputStrategy = profile?.inputStrategy ?? defaultInputStrategy;
    const effectiveContextSensitivity = (() => {
        const profileValue = profile?.contextSensitivity;
        if (profileValue === undefined || profileValue === -1) return character.contextSensitivity ?? 1;
        return profileValue;
    })();

    // 1. Location Summaries
    const segments = detectUnsummarizedLocationDepartures(interactionData, character, modelId);
    for (const segment of segments) {
        try {
            const summary = await generateLocationVisitSummary(
                interactionData, 
                character, 
                modelId, 
                segment.locationId, 
                segment.nextLocationId, 
                segment.startIdx, 
                segment.endIdx
            );
            if (summary) {
                for (const messages of Object.values(interactionData.interactionHistories || {})) {
                    const msg = messages.find(m => m.id === segment.lastMessageId);
                    if (msg && isTextMessage(msg)) {
                        const chatMsg = msg as ChatMessage;
                        if (!chatMsg.modelInteractionTextContentSummaries) chatMsg.modelInteractionTextContentSummaries = {};
                        chatMsg.modelInteractionTextContentSummaries[modelId] = summary;
                        break;
                    }
                }
            }
        } catch (e) {
            console.warn(`Failed to generate location visit summary for ${character.name}:`, e);
        }
    }

    // 2. Context Fetching
    const activeContextImages: EntityImageRef[] = [];
    const fetchErrors: string[] = [];
    const fetchedContentMap = new Map<string, string>();
    const contexts = ctx.interactionData.contexts || [];

    const webContexts = contexts.filter(c => (c.urls && c.urls.length > 0) || (c.searchTerms && c.searchTerms.length > 0));
    if (webContexts.length > 0) {
        await Promise.all(webContexts.map(async (context) => {
            const { results, errors } = await fetchMultipleContextUrls(context.urls ?? [], {
                maxDepth: context.maximumLinkDepth ?? 0,
                cacheTimeToLiveMs: context.fetchCacheTimeToLiveMs ?? 5 * 60 * 1000,
                fetchMode: context.linkFetchMode ?? 'full',
                searchTerms: context.searchTerms,
                searchEngine: context.searchEngine,
                sampler: profile?.webSummarizationSampler,
                stopPattern: profile?.webSummarizationStopPattern,
                includeImages: context.includeLinkImages ?? false,
                limitLinksToSubdirectory: context.limitLinksToSubdirectory ?? false,
            });

            for (const error of errors) fetchErrors.push(`${context.name}: ${error}`);

            const validResults = results.filter(r => !r.error && r.content.length > 0);
            if (validResults.length > 0) {
                fetchedContentMap.set(context.id, validResults.map(r => `[Source: ${r.url}]\n${r.content}`).join('\n\n---\n\n'));
            }
        }));
    }

    const resolvedContextsWithWeb = await resolveContextEntries(
        contexts, ctx.textContentArray.join('\n'), ctx.characterId, [...ctx.protagonistIds],
        ctx.characterIdArray, ctx.textContentArray, ctx.combinationCache, fetchedContentMap, effectiveContextSensitivity
    );

    const activeContextIds = new Set<string>();
    const contextLines: string[] = [];
    
    for (const { context, combinedText } of resolvedContextsWithWeb) {
        activeContextIds.add(context.id);
        const replacedText = replacePlaceholders(combinedText, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames);
        
        if (context.useBase64Encoding) {
            contextLines.push(`${delimiters.blockStart('system')}[base64:${btoa(unescape(encodeURIComponent(replacedText)))}]${delimiters.blockEnd}`);
        } else {
            contextLines.push(`${delimiters.blockStart('system')}${replacedText}${delimiters.blockEnd}`);
        }
        
        if (context.images) {
            for (const img of context.images) activeContextImages.push({ entityId: context.id, filename: img });
        }
    }

    // 3. Stop Patterns & Clothing
    const allTextSearchSpace = ctx.textContentArray.join('\n');
    const allStopPatterns = [...(character.sampler?.stopPatterns || []), ...(character.stopPatterns || [])];
    const activeStopPatterns: StopPattern[] = [];

    for (const stopPattern of allStopPatterns) {
        if (isEntityActiveWithCache(
            stopPattern.regularExpressionActivationTriggers, stopPattern.regularExpressionDeactivationTriggers,
            stopPattern.regularExpressionExclusionActivationTriggers, stopPattern.regularExpressionExclusionDeactivationTriggers,
            ctx.characterIdArray, ctx.textContentArray, ctx.characterId, [...ctx.protagonistIds], allTextSearchSpace, ctx.combinationCache
        )) {
            activeStopPatterns.push(stopPattern);
        }
    }

    const characterClothingWearingStatuses = resolveClothingWearingStatus(character, interactionData, ctx.characterIdArray, ctx.textContentArray, ctx.combinationCache);

    // 4. Pre-calculate async/shared dependencies for builders
    let latitude: number | undefined = ctx.currentLocation?.latitude;
    let longitude: number | undefined = ctx.currentLocation?.longitude;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        const geoLocation = await getLocation();
        if (geoLocation) { 
            latitude = geoLocation.latitude; 
            longitude = geoLocation.longitude; 
        }
    }

    const timeData = getTimeDataFromCoordinates(latitude, longitude)

    const builderCtx: BuilderContext = {
        ctx, activeContextIds, characterClothingWearingStatuses, contextLines,
        hasBeenSummarized: false, latitude, longitude, timeData, locationImages: []
    };

    // 5. Build blocks on-demand using registry (Lazy Evaluation)
    const blockMap = await buildPromptBlocks(builderCtx, inputStrategy);

    // 6. Custom Prompt Blocks
    const promptBlockById = new Map<string, PromptBlock>();
    for (const pb of allPromptBlocks) promptBlockById.set(pb.id, pb);

    const activePromptBlockImages: EntityImageRef[] = [];
    const protagonistIdSet = ctx.protagonistIds;
    const currentLocationId = ctx.currentLocation?.id;

    for (const block of allPromptBlocks) {
        if (!isPromptBlockCharacterBound(block, ctx.characterId)) continue;
        if (block.contextBindings?.length && !block.contextBindings.some(ctxId => activeContextIds.has(ctxId))) continue;
        if (block.locationBindings?.length && (!currentLocationId || !block.locationBindings.includes(currentLocationId))) continue;

        if (!isEntityActiveWithCache(
            block.regularExpressionActivationTriggers, block.regularExpressionDeactivationTriggers,
            block.regularExpressionExclusionActivationTriggers, block.regularExpressionExclusionDeactivationTriggers,
            ctx.characterIdArray, ctx.textContentArray, ctx.characterId, [...ctx.protagonistIds], allTextSearchSpace, ctx.combinationCache
        )) continue;

        if (block.images) {
            for (const img of block.images) activePromptBlockImages.push({ entityId: block.id, filename: img });
        }

        const replacedText = replacePlaceholders(block.textContent, ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames);
        const blockLines = [`${delimiters.blockStart('system')}${replacedText}${delimiters.blockEnd}`];

        if (!blockMap[block.id]) blockMap[block.id] = blockLines;
    }

    // 7. Message Assembly
    const hasTemplateOverride = inputStrategy.some(e => e === 'Model Chat Template' || e === 'Model Instruction Template' || e === 'Model Chat-Instruction Template');
    let messages: OpenAIMessage[];

    if (hasTemplateOverride) {
        const effectiveInstructionTemplateKey = activeModel?.instructionTemplate;
        const resolvedInstructionTemplate = effectiveInstructionTemplateKey ? getModelTemplate(effectiveInstructionTemplateKey) : undefined;

        const promptLines: string[] = [];

        for (const entry of inputStrategy) {
            if (entry === 'Model Instruction Template' && resolvedInstructionTemplate?.instructionTemplate) {
                const assembledSoFar = promptLines.join('\n');
                promptLines.length = 0;
                promptLines.push(resolvedInstructionTemplate.instructionTemplate.replace(/\{instruction\}/g, assembledSoFar).replace(/\{input\}/g, '').replace(/\{system\}/g, ctx.character.systemPrompt || ''));
            } else if (entry === 'Model Chat Template' && resolvedChatTemplate?.chatTemplate) {
                const chatHistoryForTemplate = ctx.localHistory.filter((m): m is ChatMessage | WhisperMessage => isTextMessage(m) && isMessageVisibleTo(m, ctx.characterId));
                for (const msg of chatHistoryForTemplate) {
                    const role = protagonistIdSet.has(msg.character.id) ? 'user' : 'assistant';
                    const content = replacePlaceholders(selectModelSummary(msg, modelId), ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames);
                    promptLines.push(resolvedChatTemplate.chatTemplate.replace(/\{role\}/gi, role).replace(/\{content\}/g, content));
                }
                promptLines.push(resolvedChatTemplate.chatTemplate.replace(/\{role\}/gi, 'assistant').replace(/\{content\}/g, ''));
            } else if (entry === 'Model Chat-Instruction Template' && resolvedInstructionTemplate?.instructionTemplate && resolvedChatTemplate?.chatTemplate) {
                const assembledSoFar = promptLines.join('\n');
                promptLines.length = 0;
                promptLines.push(resolvedInstructionTemplate.instructionTemplate.replace(/\{instruction\}/g, `Continue the chat dialogue below. Write a single reply for the character "${ctx.characterName}".\n\n${assembledSoFar}`).replace(/\{input\}/g, '').replace(/\{system\}/g, ctx.character.systemPrompt || ''));
                
                const chatHistoryForTemplate = ctx.localHistory.filter((m): m is ChatMessage | WhisperMessage => isTextMessage(m) && isMessageVisibleTo(m, ctx.characterId));
                for (const msg of chatHistoryForTemplate) {
                    const role = protagonistIdSet.has(msg.character.id) ? 'user' : 'assistant';
                    const content = replacePlaceholders(selectModelSummary(msg, modelId), ctx.characterParticipantTag, ctx.characterName, ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames);
                    promptLines.push(resolvedChatTemplate.chatTemplate.replace(/\{role\}/gi, role).replace(/\{content\}/g, content));
                }
                promptLines.push(resolvedChatTemplate.chatTemplate.replace(/\{role\}/gi, 'assistant').replace(/\{content\}/g, ''));
            } else if (isBuiltInBlockType(entry)) {
                const lines = blockMap[entry];
                if (lines?.length) promptLines.push(...lines);
            } else {
                const block = promptBlockById.get(entry);
                if (!block) continue;
                const lines = blockMap[block.id];
                if (lines?.length) promptLines.push(...lines);
            }
        }

        messages = [{ role: 'user', content: promptLines.join('\n').replaceAll('{{text}}', existingCharacterText) }];
    } else {
        messages = buildStructuredMessages(blockMap, inputStrategy, ctx.minimalVolatileCacheMode, existingCharacterText);
    }

    // 8. Stop Tokens
    let defaultStops: string[] = [];
    if (!profile?.doNotInjectDefaultStopTokens) {
        const templateStops = resolvedChatTemplate?.stopPatterns || [];
        const turnEndStop = delimiters.turnEnd.trim();
        defaultStops = [...templateStops, turnEndStop].filter(s => s.length > 0);
    }

    const stops = [...defaultStops, ...activeStopPatterns.map(sp => sp.pattern)];
    const uniqueStops = Array.from(new Set(stops)).filter(s => typeof s === 'string' && s.trim().length > 0);

    return { 
        messages, 
        stops: uniqueStops, 
        contextImages: activeContextImages, 
        locationImages: builderCtx.locationImages, 
        promptBlockImages: activePromptBlockImages, 
        characterClothingWearingStatuses, 
        fetchErrors 
    };
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
            if (deactivationRegexes.some((r: RegExp) => r.test(msg.textContent))) return;
        } else {
            if (activationRegexes.some((r: RegExp) => r.test(msg.textContent))) {
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