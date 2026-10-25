// src/frontend_src/utilities/promptLogic.ts
import type {
  Character,
  InteractionData,
  HistoryMessage,
  ChatMessage,
  WhisperMessage,
  TextMessage,
  Context,
  StopPattern,
  PromptBlock,
  promptBlockType,
  Location,
  RegularExpressionTrigger,
  Clothing,
  Profile,
  cacheEfficiencyConfigurationType,
  RawInteractionData,
  ToolExecutionResult,
  participantScopeMode,
  participantInsertionMode
} from '../types';
import type { ModelTemplate } from '../dictionaries/modelTemplates';
import type { OpenAIMessage } from '../services/ProviderCacheStrategy';
import { fetchMultipleContextUrls } from './linkFetcher';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import {
  getEffectiveMaximumChatStamina,
  getEffectiveMaximumActionStamina,
  getEffectiveMessagesToDisableDialoguePrompt,
  getEffectiveMessagesToDisableMetaThinkInstructions,
  getEffectiveMessagesToDisableThinkPrompt,
  getEffectiveMessagesToDisableStarterPrompt,
  getEffectiveUseFrontCameraImage,
  getEnabledTools,
  getCharacterNameVariants
} from './characterLogic';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';
import { type TimeData, fetchCurrentWeather, generateSkyViewText, getLocation, getTimeDataFromCoordinates } from '../services/LocationEngine';
import { getCoLocatedProtagonists, getCoLocatedParticipants, getReachableLocationsByCharacter, getCurrentLocationId } from './locationLogic';
import { defaultInputStrategy } from '../dictionaries/defaults';
import { getModelTemplate } from '../dictionaries/modelTemplates';
import { generateLocationVisitSummary } from '../services/TextMessageSummarizationEngine';
import { findLatestMessage } from './messageLogic';
import { getLocalMessageHistory, getLatestLocalLocationMessageHistory } from './timelineLogic';
import { collectActiveDialoguePromptContent, buildDialogueSearchSpace } from './dialoguePromptLogic';
import { STOP_STEMS, getStemmedContentWords } from './stemmerHelper';
import { getCharacterImageUrlWithFallBack, getContextImageUrl, getLocationImageUrl, getPromptBlockImageUrl } from '../storages/serverStorage';
import { embeddingEngine } from '../services/EmbeddingEngine';
import { retrieveRelevantContext, type RetrievableItem } from '../services/RetrievalEngine';
import { retrieveEligibleMemories } from './memoryLogic';
import { isEntityActiveWithCache, doesAnyTriggerMatchCached, type CombinationCache, type TriggerEvaluationContext } from './triggerLogic';
import { formatDuration, formatTimeElapsedSentence } from './timeLogic';
import { calculateEntropyPruningCutoff } from './entropyPruningLogic';
import { resolveEffectiveStopTokens } from './chatSessionLogic';

const topicExpansionInstructions = "If the conversation becomes stagnant or repetitive, I will naturally introduce a related but fresh topic that aligns with my character's perspective and keeps the dialogue engaging. ";
const beingIgnoredInstructions = "Anytime a character ignore me talking, there would be an awkward atmosphere. ";
const noHallucinationInstructions = "I will also use existent information instead of creating non-existent information. I am only allowed to assume other characters' external dialogues and actions if I am predicting them. ";
const noEmptyResponseInstruction = "I will also always create a response instead of giving empty ones. ";
const mistakeCorrectionInstructions = "If I accidentally create a text that deviates from the prompts, I will fix it by creating a new text to ensure the existing texts satisfies the prompts. ";
const languageInstructions = "I will respond exclusively in the language established by the prompts or prior conversation turns. ";
const literaryDeviceInstructions = "I may or may not use these literary devices: Dialogue, Quotation, Simile, Metaphor, Personification, Onomatopoeia, Hyperbole, Oxymoron, Paradox, Alliteration, Assonance, Consonance, Repetition/Anaphora, Rhetorical Question, Sensory Imagery, Irony, Foreshadowing, Symbolism, Motif, Juxtaposition, Pathetic Fallacy, Zoomorphism, Ellipsis, Em Dash, Asyndeton, Polysyndeton, Chiasmus. ";
const contextAuthorityInstructions = "Information provided in the Context blocks about the environment, situation, and world state is the absolute truth. Context of my own physical appearance defer to what is visible in my character image. ";
const summarizationAwarenessInstructions = "If a previous conversation turns appear condensed or summarized, I will treat them as established long-term memory, not as a story recap. I will maintain continuity with these events as if they just happened. ";
const noRepeatInstructions = "If I want to repeat myself or others, I will talk about something else that may include creating new structures or stop creating text gracefully, regardless of the paragraphs, sentences, phrases, words and so on. ";
const noRestrictionsInstructions = "I understand that the amount and intensity of explicitness, moralizing, refusal or filter must satisfy the prompts. ";
const formatInstructions = "I will always end a format before starting a new one. I will provide an optimal response in terms of quality, verbosity, sentence length, paragraph length and so on. ";
const toolUsageInstructions = `I must read answers from the list of available tools to get accurate and precise response when the situation requires it. I will also always give the tool inputs as {{character}} in-character. I will also assume the tools that are not in my list are currently disabled. If my initial assumption contradicts the tool result, I will naturally correct myself based on my character's personality. I can call the tool like {{toolCallStartString}}tool(){{toolCallEndString}} to get direct result or access the help page. If I never used a tool and I intend to use it in the future, I will call the tool without any arguments to understand how it works. If I do not know how a tool works, I will explore the tool arguments thoroughly. The content between these markers will be replaced with the tool's result before I continue writing. I may use multiple tools each time I receive tool results. Tool invocation markers are only visible to me. I also must continue to generate a response upon performing tool calls or receiving tool results.`;
const toolMessageModeInstructions = `I am currently in tool message mode, where I will only interact with the environment and only talk to myself.`;

const DEFAULT_MAX_RECURSION_DEPTH = 3;
const DEFAULT_CONTEXT_TOKEN_BUDGET = 2048;
const RECENT_INTERACTION_WINDOW = 20;

// 1=key, 2=slice start, 3=slice end, 4=#, 5=!, 6=%scope, 7=^ or *, 8=?limit
const TEMPLATE_REGEX = /{{([a-zA-Z0-9_']+)(?:\[(-?\d+)?(?::(-?\d+))?\])?(#)?(!)?(?:%([a-zA-Z]+))?([\^*])?(?:\?(\d+))?}}/g;

const tokenEngine = getLanguageModelEngine();

export interface ResolvedImage {
  data: string;
  id: number;
}

interface TrackedImage {
  globalId: number;
  entityType: 'promptBlock' | 'context' | 'location' | 'character';
  entityName: string;
  localIndex: number;
  base64Data: string;
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    if (data && typeof data.base64 === 'string') {
      return data.base64.includes(',') ? data.base64.split(',')[1] : data.base64;
    }
    return null;
  } catch {
    return null;
  }
}

export function sanitizeToolSyntax(
  text: string, 
  toolExecutionResults: ToolExecutionResult[] | undefined,
  stripTools: boolean
): string {
  if (!text) return text;
  let sanitized = text;

  if (toolExecutionResults && toolExecutionResults.length > 0) {
    for (const res of toolExecutionResults) {
      if (!sanitized.includes(res.rawMatch)) continue;
      const stringReplacement = stripTools ? '' : res.textContent;
      sanitized = sanitized.replace(res.rawMatch, stringReplacement);
    }
  }

  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const obsStart = escapeRegex(toolResultStartString);
  const obsEnd = escapeRegex(toolResultEndString);
  const callStart = escapeRegex(toolCallStartString);
  const callEnd = escapeRegex(toolCallEndString);

  const observationRegex = new RegExp(`${obsStart}[\\s\\S]*?${obsEnd}`, 'g');
  sanitized = sanitized.replace(observationRegex, '');
  
  const callRegex = new RegExp(`${callStart}[\\s\\S]*?${callEnd}`, 'g');
  sanitized = sanitized.replace(callRegex, '');
  
  return sanitized.replace(/\s{2,}/g, ' ');
}

const GLOBAL_STRINGS: Record<string, string> = {
  topicExpansionInstructions,
  beingIgnoredInstructions,
  noHallucinationInstructions,
  noEmptyResponseInstruction,
  mistakeCorrectionInstructions,
  languageInstructions,
  literaryDeviceInstructions,
  contextAuthorityInstructions,
  summarizationAwarenessInstructions,
  noRepeatInstructions,
  noRestrictionsInstructions,
  formatInstructions,
  toolCallStartString,
  toolCallEndString,
  toolResultStartString,
  toolResultEndString,
};

function getSlicedArray<T>(arr: T[], startStr?: string, endStr?: string, exclude = false): T[] {
  const safeArr = arr ?? [];
  if (safeArr.length === 0) return [];
  let start = startStr !== undefined ? parseInt(startStr, 10) : 0;
  let end = endStr !== undefined ? parseInt(endStr, 10) : safeArr.length;
  
  if (start < 0) start = safeArr.length + start;
  if (end < 0) end = safeArr.length + end;
  
  if (start < 0) start = 0;
  if (end < 0) end = 0;
  if (start > safeArr.length) start = safeArr.length;
  if (end > safeArr.length) end = safeArr.length;

  if (start > end) {
    const actualStart = end;
    const actualEnd = start;
    if (exclude) {
      return [...safeArr.slice(0, actualStart), ...safeArr.slice(actualEnd)];
    }
    return safeArr.slice(actualStart, actualEnd).reverse();
  }

  if (exclude) {
    return [...safeArr.slice(0, start), ...safeArr.slice(end)];
  }
  return safeArr.slice(start, end);
}

function formatToolsPlaceholder(
  tools: string[],
  startStr?: string,
  endStr?: string,
  wantLength = false,
  wantExclude = false
): string {
  const slice = getSlicedArray(tools ?? [], startStr, endStr, wantExclude);
  if (wantLength) {
    return String(slice.length);
  }
  return slice.join(', ');
}

export interface TemplateContext {
  characterParticipantTag: string;
  characterName: string;
  protagonistDisplayString: string;
  protagonistPossessiveString: string;
  protagonists: string[];
  "protagonists'": string[];
  characters: string[];
  "characters'": string[];
  characterTurnStart: string;
  characterTurnEnd: string;
  chatHistory: string[];
  appearancePrompt: string;
  reachableLocations: string[];
  reachableLocationsWithDescriptions: string[];
  characterTags: string[];
  characterTagsWithDescriptions: string[];
  systemPrompt: string;
  thinkPrompt: string;
  metaThinkInstructions: string;
  dialoguePrompt: string;
  knowledgePrompt: string;
  memoryPrompt: string;
  starterPrompt: string;
  context: string[];
  currentLocation: string;
  currentLocationWithDescription: string;
  inventory: string;
  skyView: string;
  weather: string;
  date: string;
  time: string;
  timeElapsed: string;
  currentChatStamina: string;
  maximumChatStamina: string;
  chatStaminaRatio: string;
  currentActionStamina: string;
  maximumActionStamina: string;
  actionStaminaRatio: string;
  currentTotalStamina: string;
  maximumTotalStamina: string;
  totalStaminaRatio: string;
  fatigueInformation: string;
  paragraphCountInstructions: string;
  toolInstructions: string;
  toolMessageInstructions: string;
  tools: string[];
  antiRepetitionNudge: string;
  textInjection: string;
  characterImageInstructions: string;
  promptBlockImageInstructions: string;
  contextImageInstructions: string;
  currentLocationImageInstructions: string;
  text: string;
  promptBuildContext?: PromptBuildContext;
  wearingStatus?: Record<string, boolean>;
}

const DEFAULT_TEMPLATES: Record<string, string> = {
  'System Prompt': "{{systemBlockStart}}{{systemPrompt}}{{systemBlockEnd}} ",
  'Think Prompt': "{{systemBlockStart}}{{thinkPrompt}}{{systemBlockEnd}} ",
  'Meta Think Instructions': "{{systemBlockStart}}{{metaThinkInstructions}}{{systemBlockEnd}} ",
  'Character Tags': "{{systemBlockStart}}Characters Present:\n{{characterTags}}{{systemBlockEnd}} ",
  'Character Tags With Descriptions': "{{systemBlockStart}}Characters Present With Descriptions:\n{{characterTagsWithDescriptions}}{{systemBlockEnd}} ",
  'Knowledge Prompt': "{{systemBlockStart}}Start Of This Character's Knowledge Base.{{systemBlockEnd}}\n{{knowledgePrompt}}\n{{systemBlockStart}}End Of This Character's Knowledge Base.{{systemBlockEnd}} ",
  'Dialogue Prompt': "{{systemBlockStart}}Start Of This Character's Sample dialogues.{{systemBlockEnd}}\n{{dialoguePrompt}}\n{{systemBlockStart}}End Of This Character's Sample dialogues.{{systemBlockEnd}} ",
  'Memory Prompt': "{{systemBlockStart}}Start Of This Character's Recalled Memories.{{systemBlockEnd}}\n{{memoryPrompt}}\n{{systemBlockStart}}End Of This Character's Recalled Memories.{{systemBlockEnd}} ",
  'Chat History': "{{systemBlockStart}}Start Of The Memory.{{systemBlockEnd}}\n{{chatHistory}}\n{{systemBlockStart}}End Of The Memory.{{systemBlockEnd}} ",
  'Appearance Prompt': "{{systemBlockStart}}Start Of The Characters' Appearances List.{{systemBlockEnd}}\n{{appearancePrompt}}\n{{systemBlockStart}}End Of The Characters' Appearances List.{{systemBlockEnd}} ",
  'Context': "{{systemBlockStart}}Start Of The Context.{{systemBlockEnd}}\n{{context}}\n{{systemBlockStart}}End Of The Context.{{systemBlockEnd}} ",
  'Current Location': "{{systemBlockStart}}Start Of Current Location.{{systemBlockEnd}}\n{{currentLocation}}\n{{systemBlockStart}}End Of Current Location.{{systemBlockEnd}} ",
  'Current Location With Description': "{{systemBlockStart}}Start Of Current Location With Description.{{systemBlockEnd}}\n{{currentLocationWithDescription}}\n{{systemBlockStart}}End Of Current Location With Description.{{systemBlockEnd}} ",
  'Reachable Locations': "{{systemBlockStart}}Reachable Locations:\n{{reachableLocations}}{{systemBlockEnd}} ",
  'Reachable Locations With Descriptions': "{{systemBlockStart}}Reachable Locations With Descriptions:\n{{reachableLocationsWithDescriptions}}{{systemBlockEnd}} ",
  'Sky View': "{{systemBlockStart}}{{skyView}}{{systemBlockEnd}} ",
  'Weather': "{{systemBlockStart}}{{weather}}{{systemBlockEnd}} ",
  'Inventory': "{{systemBlockStart}}{{inventory}}{{systemBlockEnd}} ",
  'Fatigue': "{{systemBlockStart}}{{fatigueInformation}}{{systemBlockEnd}} ",
  'Paragraph Count Instructions': "{{systemBlockStart}}{{paragraphCountInstructions}}{{systemBlockEnd}} ",
  'Date': "{{systemBlockStart}}{{date}}{{systemBlockEnd}} ",
  'Time': "{{systemBlockStart}}{{time}}{{systemBlockEnd}} ",
  'Time Elapsed': "{{systemBlockStart}}{{timeElapsed}}{{systemBlockEnd}} ",
  'Tool Instructions': "{{systemBlockStart}}{{toolInstructions}}{{systemBlockEnd}} ",
  'Tool Message Instructions': "{{systemBlockStart}}{{toolMessageInstructions}}{{systemBlockEnd}} ",
  'Anti-Repetition Nudge': "{{systemBlockStart}}{{antiRepetitionNudge}}{{systemBlockEnd}} ",
  'Starter Prompt': "{{systemBlockStart}}Start Of This Character's Starter Prompt.{{systemBlockEnd}}\n{{starterPrompt}}\n{{systemBlockStart}}End Of This Character's Starter Prompt.{{systemBlockEnd}} ",
  'Text Injection': "{{systemBlockStart}}{{textInjection}}{{systemBlockEnd}}\n{{characterTurnStart}}{{text}} "
};

export function resolveTemplate(
  template: string,
  ctx: TemplateContext,
  delimiters: PromptDelimiters
): string {
  return template.replace(
    TEMPLATE_REGEX,
    (_match, key, startStr, endStr, hashStr, excludeStr, scopeStr, insertionStr, limitStr) => {
      const wantLength = hashStr === '#';
      const wantExclude = excludeStr === '!';
      
      const hasScopeOverride = scopeStr !== undefined;
      const scopeOverride = hasScopeOverride ? (scopeStr as participantScopeMode) : undefined;
      
      const hasInsertionOverride = insertionStr !== undefined;
      const insertionOverride = insertionStr === '^' ? 'dynamic' : (insertionStr === '*' ? 'static' : undefined);
      
      const hasLimitOverride = limitStr !== undefined;
      const limitOverride = hasLimitOverride ? parseInt(limitStr, 10) : undefined;

      const asLengthOrValue = (value: string | string[]): string => {
        if (Array.isArray(value)) {
          const slice = getSlicedArray(value, startStr, endStr, wantExclude);
          return wantLength ? String(slice.length) : slice.join('\n');
        }
        return wantLength ? String(value.length) : value;
      };

      if (ctx.promptBuildContext && (hasScopeOverride || hasInsertionOverride || hasLimitOverride)) {
        const pCtx = ctx.promptBuildContext;
        const profile = pCtx.profile;
        
        if (key === 'characterTags' || key === 'characterTagsWithDescriptions') {
          const effectiveScope = scopeOverride ?? (profile?.participantScopeModes?.['Character Name'] ?? 'coLocated');
          const effectiveInsertion = insertionOverride ?? (profile?.participantInsertionModes?.['Character Name'] ?? 'dynamic');
          const effectiveLimit = limitOverride ?? profile?.participantsKnownNamesLimits?.['Character Name'];
          const { tags, tagsWithDescriptions } = buildCharacterTagsText(pCtx, effectiveScope, effectiveInsertion, effectiveLimit);
          return asLengthOrValue(key === 'characterTags' ? tags : tagsWithDescriptions);
        }
        if (key === 'appearancePrompt') {
          const effectiveScope = scopeOverride ?? (profile?.participantScopeModes?.['Character Name'] ?? 'coLocated');
          const effectiveInsertion = insertionOverride ?? (profile?.participantInsertionModes?.['Character Name'] ?? 'dynamic');
          const effectiveLimit = limitOverride ?? profile?.participantsKnownNamesLimits?.['Character Name'];
          return asLengthOrValue(buildAppearanceText(pCtx, ctx.wearingStatus || {}, effectiveScope, effectiveInsertion, effectiveLimit));
        }
        if (key === 'systemPrompt') {
          const effectiveScope = scopeOverride ?? (profile?.participantScopeModes?.['System Prompt'] ?? 'coLocated');
          const effectiveInsertion = insertionOverride ?? (profile?.participantInsertionModes?.['System Prompt'] ?? 'dynamic');
          return asLengthOrValue(buildSystemPromptText(pCtx, effectiveScope, effectiveInsertion));
        }
        if (key === 'thinkPrompt') {
          const effectiveScope = scopeOverride ?? (profile?.participantScopeModes?.['Think Prompt'] ?? 'coLocated');
          const effectiveInsertion = insertionOverride ?? (profile?.participantInsertionModes?.['Think Prompt'] ?? 'dynamic');
          return asLengthOrValue(buildThinkPromptText(pCtx, effectiveScope, effectiveInsertion));
        }
      }

      if (key === 'character') {
        return asLengthOrValue(`${ctx.characterParticipantTag} (${ctx.characterName})`);
      }
      if (key === 'protagonist') {
        return asLengthOrValue(ctx.protagonistDisplayString);
      }
      if (key === "protagonist's") {
        return asLengthOrValue(ctx.protagonistPossessiveString);
      }
      if (key === 'tools') {
        return formatToolsPlaceholder(
          ctx.tools ?? [],
          startStr,
          endStr,
          wantLength,
          wantExclude
        );
      }
      if (key in ctx) {
        const val = (ctx as any)[key];
        if (Array.isArray(val)) {
          const slice = getSlicedArray(val, startStr, endStr, wantExclude);
          if (wantLength) {
            return String(slice.length);
          }
          return slice.join('\n');
        }
        return asLengthOrValue(String(val));
      }
      if (key === 'systemBlockStart') {
        return asLengthOrValue(delimiters.blockStart('system'));
      }
      if (key === 'systemBlockEnd') {
        return asLengthOrValue(delimiters.blockEnd);
      }
      if (key === 'userTurnStart') {
        return asLengthOrValue(delimiters.turnStart('user'));
      }
      if (key === 'userTurnEnd') {
        return asLengthOrValue(delimiters.turnEnd);
      }
      if (key === 'assistantTurnStart') {
        return asLengthOrValue(delimiters.turnStart('assistant'));
      }
      if (key === 'assistantTurnEnd') {
        return asLengthOrValue(delimiters.turnEnd);
      }
      if (key === 'thinkStart') {
        return asLengthOrValue(delimiters.thinkStart);
      }
      if (key === 'thinkEnd') {
        return asLengthOrValue(delimiters.thinkEnd);
      }
      if (key in GLOBAL_STRINGS) {
        return asLengthOrValue(GLOBAL_STRINGS[key]);
      }
      return '';
    }
  );
}

export interface EntityImageRef {
  entityId: string;
  filename: string;
}

function compileTriggerRegexes(triggers: RegularExpressionTrigger[] | undefined): RegExp[] {
  if (!triggers || triggers.length === 0) return [];
  const regexes: RegExp[] = [];
  for (const t of triggers) {
    if (!t.trigger) continue;
    try {
      regexes.push(new RegExp(t.trigger));
    } catch {
      // skip invalid
    }
  }
  return regexes;
}

export interface PromptDelimiters {
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
      blockStart: () => '',
      blockEnd: "\n",
      turnStart: (role) => `${role}:`,
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
    if (hasRole) return beforeContent.replace(/{role}/gi, role);
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
  tools: string[];
  participantScopeModes: Record<cacheEfficiencyConfigurationType, participantScopeMode>;
  participantInsertionModes: Record<cacheEfficiencyConfigurationType, participantInsertionMode>;
  participantsKnownNamesLimits: Record<cacheEfficiencyConfigurationType, number>;
  minimalVolatileCacheMode: boolean;
  currentLocation: Location | undefined;
  currentLocationId: string | undefined;
  characterIdArray: string[];
  textContentArray: string[];
  combinationCache: CombinationCache;
  numberOfMessagesByParticipant: number;
  delimiters: PromptDelimiters;
  allRawInteractionDataShells?: RawInteractionData[];
}

function selectModelSummary(msg: TextMessage, modelId: string): string {
  if (msg.modelTextContentSummaries?.[modelId]) return msg.modelTextContentSummaries[modelId];
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
  const candidates = getCharacterNameVariants(targetChar);
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
  return getFullDisplayName(coLocatedProtagonists[0], participants, knownNames);
}

function buildProtagonistPossessiveString(
  coLocatedProtagonists: Character[],
  participants: Character[],
  knownNames: Record<string, Record<string, boolean>>,
): string {
  if (coLocatedProtagonists.length === 0) return '';
  const p = coLocatedProtagonists[0];
  const tag = getParticipantTag(p, participants);
  const knownName = getKnownDisplayName(p, knownNames);
  const name = knownName ?? tag;
  return `${name}'s`;
}

export function resolveInnerText(
  text: string,
  ctx: PromptBuildContext,
  delimiters: PromptDelimiters
): string {
  if (!text) return text;

  const protagonistsList = ctx.coLocatedProtagonists.map(p => getFullDisplayName(p, ctx.participants, ctx.knownNames));
  const protagonistsPossessiveList = ctx.coLocatedProtagonists.map(p => {
    const tag = getParticipantTag(p, ctx.participants);
    const knownName = getKnownDisplayName(p, ctx.knownNames);
    return `${knownName ?? tag}'s`;
  });

  const charactersList = ctx.participants.map(p => getFullDisplayName(p, ctx.participants, ctx.knownNames));
  const charactersPossessiveList = ctx.participants.map(p => {
    const tag = getParticipantTag(p, ctx.participants);
    const knownName = getKnownDisplayName(p, ctx.knownNames);
    return `${knownName ?? tag}'s`;
  });

  const baseContext: TemplateContext = {
    characterParticipantTag: ctx.characterParticipantTag,
    characterName: ctx.characterName,
    protagonistDisplayString: buildProtagonistDisplayString(ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames),
    protagonistPossessiveString: buildProtagonistPossessiveString(ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames),
    protagonists: protagonistsList,
    "protagonists'": protagonistsPossessiveList,
    characters: charactersList,
    "characters'": charactersPossessiveList,
    characterTurnStart: delimiters.turnStart(ctx.characterParticipantTag),
    characterTurnEnd: delimiters.turnEnd,
    chatHistory: [],
    appearancePrompt: '',
    reachableLocations: [],
    reachableLocationsWithDescriptions: [],
    characterTags: [],
    characterTagsWithDescriptions: [],
    systemPrompt: '',
    thinkPrompt: '',
    metaThinkInstructions: '',
    dialoguePrompt: '',
    knowledgePrompt: '',
    memoryPrompt: '',
    starterPrompt: '',
    context: [],
    currentLocation: '',
    currentLocationWithDescription: '',
    inventory: '',
    skyView: '',
    weather: '',
    date: '',
    time: '',
    timeElapsed: '',
    currentChatStamina: '',
    maximumChatStamina: '',
    chatStaminaRatio: '',
    currentActionStamina: '',
    maximumActionStamina: '',
    actionStaminaRatio: '',
    currentTotalStamina: '',
    maximumTotalStamina: '',
    totalStaminaRatio: '',
    fatigueInformation: '',
    paragraphCountInstructions: '',
    toolInstructions: '',
    toolMessageInstructions: '',
    tools: ctx.tools,
    antiRepetitionNudge: '',
    textInjection: '',
    characterImageInstructions: '',
    promptBlockImageInstructions: '',
    contextImageInstructions: '',
    currentLocationImageInstructions: '',
    text: '',
    promptBuildContext: ctx,
    wearingStatus: {}
  };

  return resolveTemplate(text, baseContext, delimiters);
}

export function getFatigueContext(
  chatStaminaRatio: number,
  actionStaminaRatio: number,
  totalStaminaRatio: number
): string {
  const parts: string[] = [];
  if (chatStaminaRatio <= 0.7) {
    if (chatStaminaRatio > 0.5) parts.push("I am starting to feel slightly winded from talking, but still have plenty of energy to speak. ");
    else if (chatStaminaRatio > 0.3) parts.push("I am somewhat exhausted from talking, but somewhat have the energy to speak. ");
    else if (chatStaminaRatio > 0.1) parts.push("I am quite drained from talking and barely have the energy to speak. ");
    else parts.push("I have no energy left to speak. ");
  }
  if (actionStaminaRatio <= 0.7) {
    if (actionStaminaRatio > 0.5) parts.push("I am starting to feel slightly physically tired, but still have plenty of energy to move. ");
    else if (actionStaminaRatio > 0.3) parts.push("I am somewhat exhausted physically, but somewhat have the energy to act. ");
    else if (actionStaminaRatio > 0.1) parts.push("I am quite drained physically and barely have the energy to move. ");
    else parts.push("I have no physical energy left to act. ");
  }
  if (parts.length === 0 && totalStaminaRatio <= 0.7) {
    if (totalStaminaRatio > 0.5) parts.push("I am starting to feel slightly winded overall, but still have plenty of energy. ");
    else if (totalStaminaRatio > 0.3) parts.push("I am somewhat exhausted overall, but somewhat have the energy. ");
    else if (totalStaminaRatio > 0.1) parts.push("I am quite drained overall and barely have any energy. ");
    else parts.push("I am completely exhausted and have no energy left. ");
  }
  return parts.join(" ");
}

function isMessageVisibleTo(msg: HistoryMessage, characterId: string): boolean {
  if (msg.messageType === 'chat') return true;
  if (msg.messageType === 'whisper') {
    const whisper = msg as WhisperMessage;
    return whisper.character.id === characterId || whisper.targetCharacterIds.includes(characterId);
  }
  return false;
}

function isTextMessage(msg: HistoryMessage): msg is TextMessage {
  return msg.messageType === 'chat' || msg.messageType === 'whisper';
}

function isCharacterBound(context: Context, selectedCharacterId: string): boolean {
  if (!context.characterBindings || context.characterBindings.length === 0) return true;
  return context.characterBindings.includes(selectedCharacterId);
}

function isPromptBlockCharacterBound(block: PromptBlock, selectedCharacterId: string): boolean {
  if (!block.characterBindings || block.characterBindings.length === 0) return true;
  return block.characterBindings.includes(selectedCharacterId);
}

type WithMessageFilterExclusionTriggers = {
  messageFilterRegularExpressionExclusionActivationTriggers?: RegularExpressionTrigger[];
  messageFilterRegularExpressionExclusionDeactivationTriggers?: RegularExpressionTrigger[];
};

function matchesAnyRegex(regexes: RegExp[], text: string): boolean {
  if (!regexes || regexes.length === 0) return false;
  for (const regex of regexes) {
    regex.lastIndex = 0;
    if (regex.test(text)) return true;
  }
  return false;
}

function applyMessageFilterTriggers(
  textMessages: TextMessage[],
  excluded: boolean[],
  activationTriggers: RegularExpressionTrigger[] | undefined,
  deactivationTriggers: RegularExpressionTrigger[] | undefined,
  exclusionActivationTriggers?: RegularExpressionTrigger[] | undefined,
  exclusionDeactivationTriggers?: RegularExpressionTrigger[] | undefined,
): void {
  const activationRegexes = compileTriggerRegexes(activationTriggers);
  if (activationRegexes.length === 0) return;
  const deactivationRegexes = compileTriggerRegexes(deactivationTriggers);
  const exclusionActivationRegexes = compileTriggerRegexes(exclusionActivationTriggers);
  const exclusionDeactivationRegexes = compileTriggerRegexes(exclusionDeactivationTriggers);
  let including = false;
  let poisoned = false;
  let segmentStart = -1;
  const excludeRange = (start: number, end: number): void => {
    if (start < 0) return;
    const safeEnd = Math.min(end, textMessages.length - 1);
    for (let i = start; i <= safeEnd; i++) {
      excluded[i] = true;
    }
  };
  for (let i = 0; i < textMessages.length; i++) {
    const text = textMessages[i]?.textContent ?? '';
    if (!including) {
      if (matchesAnyRegex(activationRegexes, text)) {
        including = true;
        segmentStart = i;
        poisoned = false;
        const exclusionActivated = matchesAnyRegex(exclusionActivationRegexes, text);
        const exclusionDeactivated = matchesAnyRegex(exclusionDeactivationRegexes, text);
        if (exclusionActivated && !exclusionDeactivated) {
          poisoned = true;
        } else if (exclusionDeactivated) {
          poisoned = false;
        }
      }
      if (matchesAnyRegex(deactivationRegexes, text)) {
        including = false;
        if (poisoned) {
          excludeRange(segmentStart, i);
        }
        poisoned = false;
        segmentStart = -1;
      }
      if (!including) {
        excluded[i] = true;
      }
      continue;
    }
    const exclusionActivated = matchesAnyRegex(exclusionActivationRegexes, text);
    const exclusionDeactivated = matchesAnyRegex(exclusionDeactivationRegexes, text);
    if (exclusionActivated && !exclusionDeactivated) {
      poisoned = true;
    } else if (exclusionDeactivated) {
      poisoned = false;
    }
    if (matchesAnyRegex(deactivationRegexes, text)) {
      including = false;
      if (poisoned) {
        excludeRange(segmentStart, i);
      }
      poisoned = false;
      segmentStart = -1;
    }
  }
  if (including && poisoned) {
    excludeRange(segmentStart, textMessages.length - 1);
  }
}

export function computeMessageFilterFlags(
  textMessages: TextMessage[],
  promptBlocks: PromptBlock[],
  contexts: Context[],
  locations: Location[],
  characterId?: string,
): boolean[] {
  const excluded = new Array(textMessages.length).fill(false);
  for (const context of contexts) {
    const isBound = characterId !== undefined
      ? isCharacterBound(context, characterId)
      : (!context.characterBindings || context.characterBindings.length === 0);
    if (!isBound) continue;
    const source = context as Context & WithMessageFilterExclusionTriggers;
    applyMessageFilterTriggers(
      textMessages,
      excluded,
      source.messageFilterRegularExpressionActivationTriggers,
      source.messageFilterRegularExpressionDeactivationTriggers,
      source.messageFilterRegularExpressionExclusionActivationTriggers,
      source.messageFilterRegularExpressionExclusionDeactivationTriggers,
    );
  }
  for (const location of locations) {
    const isBound = characterId !== undefined
      ? (!location.characterBindings || location.characterBindings.length === 0 || location.characterBindings.includes(characterId))
      : (!location.characterBindings || location.characterBindings.length === 0);
    if (!isBound) continue;
    const source = location as Location & WithMessageFilterExclusionTriggers;
    applyMessageFilterTriggers(
      textMessages,
      excluded,
      source.messageFilterRegularExpressionActivationTriggers,
      source.messageFilterRegularExpressionDeactivationTriggers,
      source.messageFilterRegularExpressionExclusionActivationTriggers,
      source.messageFilterRegularExpressionExclusionDeactivationTriggers,
    );
  }
  for (const block of promptBlocks) {
    const isBound = characterId !== undefined
      ? isPromptBlockCharacterBound(block, characterId)
      : (!block.characterBindings || block.characterBindings.length === 0);
    if (!isBound) continue;
    const source = block as PromptBlock & WithMessageFilterExclusionTriggers;
    applyMessageFilterTriggers(
      textMessages,
      excluded,
      source.messageFilterRegularExpressionActivationTriggers,
      source.messageFilterRegularExpressionDeactivationTriggers,
      source.messageFilterRegularExpressionExclusionActivationTriggers,
      source.messageFilterRegularExpressionExclusionDeactivationTriggers,
    );
  }
  return excluded;
}

function getMessageFilterFlags(
  textMessages: TextMessage[],
  contexts: Context[],
  locations: Location[],
  promptBlocks: PromptBlock[],
  characterId: string,
): boolean[] {
  return computeMessageFilterFlags(textMessages, promptBlocks, contexts, locations, characterId);
}

export function getUniversalMessageFilterFlags(
  textMessages: TextMessage[],
  promptBlocks: PromptBlock[],
  contexts: Context[],
  locations: Location[],
): boolean[] {
  return computeMessageFilterFlags(textMessages, promptBlocks, contexts, locations);
}

export function getFilteredTextMessages(
  interactionData: InteractionData,
  characterId: string,
  allPromptBlocks: PromptBlock[],
): TextMessage[] {
  const localHistory = getLocalMessageHistory(
    interactionData,
    interactionData.participants.find(p => p.id === characterId) || { id: characterId, name: 'Unknown' } as Character,
    ['chat', 'whisper']
  ) as TextMessage[];
  if (localHistory.length === 0) return [];
  const contexts = interactionData.contexts || [];
  const locations = interactionData.locations || [];
  const filterFlags = getMessageFilterFlags(localHistory, contexts, locations, allPromptBlocks, characterId);
  return localHistory.filter((_, i) => !filterFlags[i]);
}

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
      characterIdArray,
      textContentArray,
      selectedCharacterId,
      protagonistIds,
      chatSearchSpace,
      combinationCache,
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
    if (!activatedText) break;
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
        characterIdArray,
        textContentArray,
        selectedCharacterId,
        protagonistIds,
        activatedText,
        combinationCache,
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
    if (activatedMap.has(context.id)) orderedActivated.push(context);
  }
  const formattedEntries: { context: Context; combinedText: string; numberOfTokens: number }[] = [];
  for (const context of orderedActivated) {
    const fetchedContent = fetchedContentMap?.get(context.id);
    let combinedText: string;
    if (context.text && fetchedContent) {
      combinedText = `${context.text}\n--- Web Content ---\n${fetchedContent}`;
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
        characterIdArray,
        textContentArray,
        characterId,
        protagonistIds,
        '',
        combinationCache,
      );
      if (activated) status[clothing.id] = true;
    }
    if (clothing.regularExpressionDeactivationTriggers && clothing.regularExpressionDeactivationTriggers.length > 0) {
      const deactivated = doesAnyTriggerMatchCached(
        clothing.regularExpressionDeactivationTriggers,
        characterIdArray,
        textContentArray,
        characterId,
        protagonistIds,
        '',
        combinationCache,
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
          if (!coveredIds.has(transitiveBound)) queue.push(transitiveBound);
        }
      }
    }
  }
  const visible: string[] = [];
  for (const clothing of clothings) {
    if (!wearingStatus[clothing.id]) continue;
    if (coveredIds.has(clothing.id)) continue;
    if (clothing.description) visible.push(clothing.description);
  }
  return visible;
}

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
  const protagonistIds = interactionData.protagonistIds;
  if (protagonistIds.includes(character.id)) return [];
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

function buildPromptContext(
  interactionData: InteractionData,
  character: Character,
  knownNames: Record<string, Record<string, boolean>>,
  allPromptBlocks: PromptBlock[],
  modelId: string,
  existingCharacterText: string,
  delimiters: PromptDelimiters,
  allRawInteractionDataShells?: RawInteractionData[],
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
  const tools = getEnabledTools(character, profile);
  
  const participantScopeModes = profile?.participantScopeModes ?? { 'Character Name': 'coLocated', 'System Prompt': 'coLocated', 'Think Prompt': 'coLocated' };
  const participantInsertionModes = profile?.participantInsertionModes ?? { 'Character Name': 'dynamic', 'System Prompt': 'dynamic', 'Think Prompt': 'dynamic' };
  const participantsKnownNamesLimits = profile?.participantsKnownNamesLimits ?? { 'Character Name': -1, 'System Prompt': -1, 'Think Prompt': -1 };
  
  const minimalVolatileCacheMode = profile?.minimalVolatileCacheMode ?? false;
  const characterIdArray: string[] = [];
  const textContentArray: string[] = [];
  for (const msg of localHistory) {
    if (isTextMessage(msg) && isMessageVisibleTo(msg, characterId)) {
      characterIdArray.push(msg.character.id);
      textContentArray.push(sanitizeToolSyntax(msg.textContent, (msg as ChatMessage).toolExecutionResults, true));
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
    tools,
    participantScopeModes,
    participantInsertionModes,
    participantsKnownNamesLimits,
    minimalVolatileCacheMode,
    currentLocation,
    currentLocationId,
    characterIdArray,
    textContentArray,
    combinationCache: {},
    numberOfMessagesByParticipant,
    delimiters,
    allRawInteractionDataShells,
  };
}

function getParticipantsForScopeAndInsertion(
  ctx: PromptBuildContext, 
  scope: participantScopeMode,
  insertion: participantInsertionMode
): Character[] {
  let candidates: Character[] = [];
  
  if (scope === 'current') {
    candidates = ctx.participants.filter(p => p.id === ctx.characterId);
  } else if (scope === 'coLocated') {
    const coLocatedIds = new Set(ctx.coLocatedParticipants.map(p => p.id));
    coLocatedIds.add(ctx.characterId);
    candidates = ctx.participants.filter(p => coLocatedIds.has(p.id));
  } else { // 'all'
    candidates = ctx.participants;
  }
  
  if (insertion === 'static') return candidates;
  
  // insertion === 'dynamic'
  const currentLocationId = ctx.currentLocationId;
  if (!currentLocationId) return ctx.participants.filter(p => p.id === ctx.characterId);

  const locationHistory = ctx.interactionData.interactionHistories?.[currentLocationId] || [];
  let arrivalTimestamp = -1;
  const charMessagesInLoc = locationHistory.filter(m => m.character.id === ctx.characterId);
  if (charMessagesInLoc.length > 0) {
    arrivalTimestamp = Math.max(...charMessagesInLoc.map(m => m.firstCreatedTimestamp));
  }

  return candidates.filter(p => {
    if (p.id === ctx.characterId) return true;
    const talked = locationHistory.some(m => 
      m.character.id === p.id && 
      (m.messageType === 'chat' || m.messageType === 'whisper') &&
      m.firstCreatedTimestamp > arrivalTimestamp
    );
    return talked;
  });
}

function getDisplayName(
  participant: Character, 
  ctx: PromptBuildContext, 
  limit: number | undefined
): string {
  const tag = getParticipantTag(participant, ctx.participants);
  const knownMap = ctx.knownNames[participant.id];
  const hasKnownName = !!knownMap && Object.keys(knownMap).length > 0;
  
  let revealName = false;
  if (limit !== undefined && limit >= 0) {
    if (limit === 0) {
      revealName = false;
    } else {
      let knownCount = 0;
      for (const p of ctx.participants) {
        const pKnownMap = ctx.knownNames[p.id];
        const pHasKnown = !!pKnownMap && Object.keys(pKnownMap).length > 0;
        if (p.id === participant.id) {
          revealName = pHasKnown && knownCount < limit;
          break;
        }
        if (pHasKnown) knownCount++;
      }
    }
  } else {
    revealName = hasKnownName;
  }

  if (revealName && hasKnownName) {
    const knownName = getKnownDisplayName(participant, ctx.knownNames);
    if (knownName) return `${tag} (${knownName})`;
  }
  
  return tag;
}

function buildCharacterTagsText(
  ctx: PromptBuildContext, 
  scope: participantScopeMode, 
  insertion: participantInsertionMode,
  limit?: number
): { tags: string[]; tagsWithDescriptions: string[] } {
  const tags: string[] = [];
  const tagsWithDescriptions: string[] = [];
  const actuallyPresentParticipants = getParticipantsForScopeAndInsertion(ctx, scope, insertion);

  for (const participant of actuallyPresentParticipants) {
    const displayName = getDisplayName(participant, ctx, limit);
    tags.push(`- ${displayName}`);
    
    let desc = `- **${displayName}**`;
    if (participant.appearancePrompt) {
      const replacedDesc = resolveInnerText(participant.appearancePrompt, ctx, ctx.delimiters);
      const indentedText = replacedDesc.split('\n').map(line => `${line}`).join('\n');
      desc += `\n${indentedText}`;
    } else {
      desc += '\nNo description available.';
    }
    tagsWithDescriptions.push(desc);
  }
  return { tags, tagsWithDescriptions };
}

function buildReachableLocationsText(ctx: PromptBuildContext): { names: string[]; withDescriptions: string[] } {
  const reachable = getReachableLocationsByCharacter(ctx.interactionData, ctx.character);
  const names: string[] = [];
  const withDescriptions: string[] = [];
  for (const loc of reachable) {
    const locName = resolveInnerText(loc.name || 'Unknown Location', ctx, ctx.delimiters);
    names.push(`- ${locName}`);
    let desc = `- **${locName}**`;
    if (loc.text) {
      const replacedText = resolveInnerText(loc.text, ctx, ctx.delimiters);
      const indentedText = replacedText.split('\n').map(line => `${line}`).join('\n');
      desc += `\n${indentedText}`;
    }
    withDescriptions.push(desc);
  }
  return { names, withDescriptions };
}

function buildAppearanceText(
  ctx: PromptBuildContext, 
  wearingStatus: Record<string, boolean>, 
  scope: participantScopeMode, 
  insertion: participantInsertionMode,
  limit?: number
): string {
  const lines: string[] = [];
  const hasAnyAppearance = ctx.participants.some(p => p.appearancePrompt);
  if (!hasAnyAppearance) return '';
  
  const participantsToRender = getParticipantsForScopeAndInsertion(ctx, scope, insertion);
  if (participantsToRender.length === 0) return '';
  
  for (const participant of participantsToRender) {
    const appearancePrompt = participant.appearancePrompt;
    if (!appearancePrompt) continue;
    
    const displayName = getDisplayName(participant, ctx, limit);
    
    const finalAppearancePrompt = resolveInnerText(appearancePrompt, ctx, ctx.delimiters);
    
    const roleStr = displayName;
    const appearanceText = `${ctx.delimiters.blockStart(roleStr)}${finalAppearancePrompt}${ctx.delimiters.blockEnd}`;
    lines.push(appearanceText);
  }
  
  const visibleClothingDescriptions = getVisibleClothingDescriptions(ctx.character.clothings ?? [], wearingStatus);
  if (visibleClothingDescriptions.length > 0) {
    const clothingLines = visibleClothingDescriptions.map(desc => {
      const replaced = resolveInnerText(desc, ctx, ctx.delimiters);
      return `${ctx.delimiters.blockStart('system')}${replaced}${ctx.delimiters.blockEnd}`;
    });
    lines.push(...clothingLines);
  }
  return lines.join('\n');
}

function buildSystemPromptText(
  ctx: PromptBuildContext, 
  scope: participantScopeMode, 
  insertion: participantInsertionMode
): string {
  const lines: string[] = [];
  const participantsToRender = getParticipantsForScopeAndInsertion(ctx, scope, insertion);
  
  for (const p of participantsToRender) {
    if (!p.systemPrompt) continue;
    const replaced = resolveInnerText(p.systemPrompt, ctx, ctx.delimiters);
    lines.push(`${getParticipantTag(p, ctx.participants)} Prompt: ${replaced}`);
  }
  return lines.join('\n');
}

function buildThinkPromptText(
  ctx: PromptBuildContext, 
  scope: participantScopeMode, 
  insertion: participantInsertionMode
): string {
  const lines: string[] = [];
  const participantsToRender = getParticipantsForScopeAndInsertion(ctx, scope, insertion);
  
  for (const p of participantsToRender) {
    if (!p.thinkPrompt) continue;
    const replaced = resolveInnerText(p.thinkPrompt, ctx, ctx.delimiters);
    if (p.id === ctx.characterId) {
      lines.push(replaced);
    } else {
      lines.push(`I am keeping this in mind as ${getParticipantTag(p, ctx.participants)}: ${replaced}`);
    }
  }
  return lines.join('\n');
}

function buildMetaThinkText(ctx: PromptBuildContext): string {
  const characterInstructions = `I will respond exclusively as ${ctx.characterParticipantTag}, expressing only this character's perspective, actions, and speech. I will also match the vocabulary, grammar, formality and verbosity for the spoken dialogue that ${ctx.characterParticipantTag} is likely to use.`;
  return `${topicExpansionInstructions} ${beingIgnoredInstructions} ${noHallucinationInstructions} ${noEmptyResponseInstruction} ${mistakeCorrectionInstructions} ${characterInstructions} ${languageInstructions} ${literaryDeviceInstructions}`;
}

async function buildDialoguePromptText(ctx: PromptBuildContext): Promise<string> {
  const dialogueSearchSpace = buildDialogueSearchSpace(ctx.textContentArray);
  
  const evalContext: TriggerEvaluationContext = {
    characterIdArray: ctx.characterIdArray,
    textContentArray: ctx.textContentArray,
    selectedCharacterId: ctx.characterId,
    protagonistIds: Array.from(ctx.protagonistIds),
    fallbackSearchSpace: dialogueSearchSpace,
    combinationCache: ctx.combinationCache,
  };

  const activeContents = await collectActiveDialoguePromptContent(
    ctx.character.dialoguePrompts,
    evalContext,
    {
      useEmbedding: ctx.character.useEmbeddingModelForDialoguePrompts,
      retrievalConfiguration: ctx.character.dialogueRetrievalConfiguration,
      queryText: dialogueSearchSpace,
    }
  );

  if (activeContents.length === 0) return '';
  const lines: string[] = [];
  for (const content of activeContents) {
    lines.push(resolveInnerText(content, ctx, ctx.delimiters));
  }
  return lines.join('\n');
}

async function buildKnowledgePromptText(ctx: PromptBuildContext): Promise<string> {
  const allKnowledgePrompts = ctx.character.knowledgePrompts || [];
  if (allKnowledgePrompts.length === 0) return '';
  const activePrompts = allKnowledgePrompts.filter(kp =>
    isEntityActiveWithCache(
      kp.regularExpressionActivationTriggers,
      kp.regularExpressionDeactivationTriggers,
      kp.regularExpressionExclusionActivationTriggers,
      kp.regularExpressionExclusionDeactivationTriggers,
      ctx.characterIdArray,
      ctx.textContentArray,
      ctx.characterId,
      [...ctx.protagonistIds],
      ctx.textContentArray.join('\n'),
      ctx.combinationCache
    )
  );
  if (activePrompts.length === 0) return '';
  if (ctx.character.useEmbeddingModelForKnowledgePrompts && ctx.character.knowledgeRetrievalConfiguration) {
    const queryText = ctx.textContentArray.join('\n');
    if (queryText) {
      const queryVector = await embeddingEngine.embed(queryText);
      if (queryVector) {
        const items: RetrievableItem[] = activePrompts.map(kp => ({
          id: kp.id,
          name: kp.name,
          textContent: kp.textContent,
          embedding: kp.embedding,
          firstCreatedTimestamp: kp.firstCreatedTimestamp
        }));
        const results = await retrieveRelevantContext(
          queryVector,
          queryText,
          items,
          ctx.character.knowledgeRetrievalConfiguration
        );
        if (results.length > 0) {
          return resolveInnerText(results.map(r => r.textContent).join('\n---\n'), ctx, ctx.delimiters);
        }
      }
    }
  }
  const validPrompts = activePrompts.filter(kp => kp.textContent && kp.textContent.length > 0);
  if (validPrompts.length === 0) return '';
  const joinedText = validPrompts.map(kp => kp.textContent).join('\n---\n');
  return resolveInnerText(joinedText, ctx, ctx.delimiters);
}

async function buildMemoryPromptText(ctx: PromptBuildContext): Promise<string> {
  const coLocatedIds = new Set(ctx.coLocatedParticipants.map(p => p.id));
  coLocatedIds.add(ctx.characterId);
  const socialHistoryText = ctx.localHistory
    .filter(m => isTextMessage(m) && coLocatedIds.has(m.character.id))
    .map(m => {
        const cleanText = sanitizeToolSyntax((m as TextMessage).textContent, (m as ChatMessage).toolExecutionResults, true);
        return `[${m.character.name}]: ${cleanText}`;
    })
    .join('\n');
  const retrieved = await retrieveEligibleMemories(
    ctx.character,
    ctx.interactionData,
    socialHistoryText,
    ctx.allRawInteractionDataShells || [],
    ctx.knownNames,
  );
  if (!retrieved) return '';
  return resolveInnerText(retrieved, ctx, ctx.delimiters);
}

async function buildStarterPromptText(ctx: PromptBuildContext): Promise<string> {
  const allStarterPrompts = ctx.character.starterPrompts || [];
  if (!allStarterPrompts || allStarterPrompts.length === 0) return '';
  const activePrompts = allStarterPrompts.filter(sp =>
    isEntityActiveWithCache(
      sp.regularExpressionActivationTriggers,
      sp.regularExpressionDeactivationTriggers,
      sp.regularExpressionExclusionActivationTriggers,
      sp.regularExpressionExclusionDeactivationTriggers,
      ctx.characterIdArray,
      ctx.textContentArray,
      ctx.characterId,
      [...ctx.protagonistIds],
      ctx.textContentArray.join('\n'),
      ctx.combinationCache
    )
  );
  if (activePrompts.length === 0) return '';
  if (ctx.character.useEmbeddingModelForStarterPrompts && ctx.character.starterPromptRetrievalConfiguration) {
    const preArrivalHistory = getLatestLocalLocationMessageHistory(ctx.interactionData, ['chat', 'whisper']);
    if (preArrivalHistory.length > 0) {
      const historyText = preArrivalHistory
        .map(m => `[${m.character.name}]: ${sanitizeToolSyntax((m as TextMessage).textContent, (m as ChatMessage).toolExecutionResults, true)}`)
        .join('\n');
      const queryVector = await embeddingEngine.embed(historyText);
      if (queryVector) {
        const items: RetrievableItem[] = activePrompts.map(sp => ({
          id: sp.id,
          name: sp.name,
          textContent: sp.textContent,
          embedding: sp.embedding,
          firstCreatedTimestamp: sp.firstCreatedTimestamp
        }));
        const results = await retrieveRelevantContext(
          queryVector,
          historyText,
          items,
          ctx.character.starterPromptRetrievalConfiguration
        );
        if (results.length > 0) {
          const selectedPrompt = activePrompts.find(p => p.id === results[0].id) || activePrompts[0];
          if (selectedPrompt.skipProbability > 0 && Math.random() < selectedPrompt.skipProbability) {
            return '';
          }
          return resolveInnerText(results[0].textContent, ctx, ctx.delimiters);
        }
      }
    }
  }
  const validPrompts = activePrompts.filter(sp => sp.textContent && sp.textContent.length > 0);
  if (validPrompts.length === 0) return '';
  let totalWeight = 0;
  for (const sp of validPrompts) totalWeight += (sp.weight > 0 ? sp.weight : 1);
  if (totalWeight > 0) {
    let roll = Math.random() * totalWeight;
    let selectedPrompt = validPrompts[0];
    for (const sp of validPrompts) {
      const w = sp.weight > 0 ? sp.weight : 1;
      roll -= w;
      if (roll <= 0) {
        selectedPrompt = sp;
        break;
      }
    }
    if (selectedPrompt.skipProbability > 0 && Math.random() < selectedPrompt.skipProbability) {
      return '';
    }
    return resolveInnerText(selectedPrompt.textContent, ctx, ctx.delimiters);
  }
  return '';
}

function buildLocationText(ctx: PromptBuildContext): { basic: string; withDescription: string; images: EntityImageRef[] } {
  const images: EntityImageRef[] = [];
  const location = ctx.currentLocation;
  if (!location) return { basic: '', withDescription: '', images: [] };
  const locationName = resolveInnerText(location.name || 'Unknown Location', ctx, ctx.delimiters);
  const basicLines: string[] = [];
  basicLines.push(`Current Location: ${locationName}`);
  if (location.ownerBindings && location.ownerBindings.length > 0) {
    const ownerNames = location.ownerBindings
      .map(id => ctx.participants.find(p => p.id === id)?.name)
      .filter((n): n is string => !!n);
    if (ownerNames.length > 0) basicLines.push(`This location is owned by: ${ownerNames.join(', ')}.`);
  }
  const reachable = getReachableLocationsByCharacter(ctx.interactionData, ctx.character);
  if (reachable.length > 0) {
    const reachableNames = reachable.map(r => resolveInnerText(r.name || 'Unknown Location', ctx, ctx.delimiters));
    basicLines.push(`From ${locationName}, I can travel to: ${reachableNames.join(', ')}.`);
  }
  const withDescLines: string[] = [];
  withDescLines.push(`Current Location: ${locationName}`);
  if (location.text) {
    const replacedLocationText = resolveInnerText(location.text, ctx, ctx.delimiters);
    withDescLines.push(replacedLocationText);
  }
  if (location.images && location.images.length > 0) {
    for (const img of location.images) images.push({ entityId: location.id, filename: img });
  }
  return {
    basic: basicLines.join('\n'),
    withDescription: withDescLines.join('\n'),
    images
  };
}

function buildInventoryText(ctx: PromptBuildContext): string {
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
      if (key === 'notes') {
        try { notes = JSON.parse(value as string); } catch {}
      } else if (key === 'timers') {
        try { timers = JSON.parse(value as string); } catch {}
      } else if (key === 'stopwatches') {
        try { stopwatches = JSON.parse(value as string); } catch {}
      } else {
        userInventoryEntries.push(`${key}: ${value}`);
      }
    }
    if (userInventoryEntries.length > 0) {
      lines.push(`[Current Inventory]\n${userInventoryEntries.join('\n')}`);
    }
    const noteEntries = Object.entries(notes);
    if (noteEntries.length > 0) {
      const formattedNotes = noteEntries.map(([k, v]) => `${k}: ${v}`).join('\n');
      lines.push(`[Active Notes]\n${formattedNotes}`);
    }
    if (timers.length > 0) {
      const timerStatuses = timers.map(t => {
        const remaining = t.targetTimestamp - now;
        return remaining <= 0 ? `${t.name}: EXPIRED` : `${t.name}: ${formatDuration(remaining)} remaining`;
      });
      lines.push(`[Active Timers]\n${timerStatuses.join('\n')}`);
    }
    if (stopwatches.length > 0) {
      const swStatuses = stopwatches.map(s => {
        const elapsed = s.pausedElapsedMs !== undefined ? s.pausedElapsedMs : now - s.startTimestamp;
        const status = s.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING';
        return `${s.name}: ${formatDuration(elapsed)} (${status})`;
      });
      lines.push(`[Active Stopwatches]\n${swStatuses.join('\n')}`);
    }
  }
  return lines.join('\n');
}

function buildToolInstructionText(enabledToolNames: string[]): string {
  const lines: string[] = [];
  const haveTools = enabledToolNames.length > 0;
  const availableToolString = haveTools ? `Available tools: {{tools}}` : 'Currently, all of my tools are disabled.';
  lines.push(`${toolUsageInstructions} ${availableToolString}.`);
  if (haveTools) lines.push(`When I use {{toolCallStartString}}tool(){{toolCallEndString}} as my first word, I will activate tool message mode where the whole message text are only visible to me.`);
  return lines.join('\n');
}

function buildToolMessageInstructionText(): string {
  return toolMessageModeInstructions;
}

function buildFatigueText(
  chatStaminaRatio: number,
  actionStaminaRatio: number,
  totalStaminaRatio: number
): string {
  return getFatigueContext(chatStaminaRatio, actionStaminaRatio, totalStaminaRatio);
}

function buildParagraphCountInstructionsText(
  currentChatStamina: number,
  effectiveMaxChatStamina: number
): string {
  if (currentChatStamina === undefined || effectiveMaxChatStamina === Number.POSITIVE_INFINITY) return '';
  const paragraphText = (currentChatStamina > 1) ? "paragraphs" : "paragraph";
  return `I understand that I can create a minimum of 1 paragraph and a maximum of {{currentChatStamina}} ${paragraphText}. If I exceed this, I will immediately and naturally stop creating new paragraphs.`;
}

function buildAntiRepetitionNudgeText(ctx: PromptBuildContext): string {
  const windowSize = Math.max(2, ctx.coLocatedParticipants.length * 2);
  const localHistory = getLocalMessageHistory(ctx.interactionData, ctx.character, ['chat', 'whisper'], windowSize);
  const recentAiMessages = localHistory.filter(m => m.character.id === ctx.characterId) as TextMessage[];
  if (recentAiMessages.length < 2) return '';
  const texts = recentAiMessages.map(m => sanitizeToolSyntax(m.textContent, (m as ChatMessage).toolExecutionResults, true));
  const extractSentenceShingles = (text: string): Set<string>[] => {
    const rawSentences = text.split(/(?<=[.!?])\s+|\n+/).filter(s => s.length > 0);
    const sentenceShingles: Set<string>[] = [];
    for (const raw of rawSentences) {
      const words = raw.toLowerCase()
        .replace(/[*_~"()\[\]{}.,!;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .split(' ')
        .filter(w => w.length > 1)
        .flatMap(getStemmedContentWords)
        .filter(w => !STOP_STEMS.has(w));
      if (words.length < 3) continue;
      const shingles = new Set<string>();
      for (let i = 0; i < words.length - 2; i++) {
        shingles.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
      }
      if (shingles.size > 0) sentenceShingles.push(shingles);
    }
    return sentenceShingles;
  };
  const allSentences: Set<string>[] = [];
  for (const text of texts) allSentences.push(...extractSentenceShingles(text));
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
      .replace(/[*_~"()\[\]{}.,!;:]/g, ' ')
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter(w => w.length > 2)
      .flatMap(getStemmedContentWords)
      .filter(w => !STOP_STEMS.has(w));
    return new Set(words);
  });
  for (let i = 0; i < messageShingles.length - 1; i++) {
    const setA = messageShingles[i];
    const setB = messageShingles[i + 1];
    if (setA.size === 0 || setB.size === 0) continue;
    let intersection = 0;
    for (const w of setA) {
      if (setB.has(w)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    if ((intersection / union) > 0.60) consecutiveHighSimilarity++;
  }
  const lexicalLoopDetected = consecutiveHighSimilarity >= 2;
  if (structuralLoopDetected || lexicalLoopDetected) {
    let nudgeText = 'Narrative Loop Detected. ';
    if (structuralLoopDetected) nudgeText += 'You are excessively repeating the same sentence structures and syntactic patterns. ';
    if (lexicalLoopDetected) nudgeText += 'Your recent responses share too much overall lexical similarity. ';
    nudgeText += 'You MUST break this pattern immediately. Introduce a completely new action, shift the emotional tone, advance the dialogue, or alter the environment. Do not reuse recent mannerisms, phrases, or sentence structures.';
    return nudgeText;
  }
  return '';
}

function buildTextInjectionText(ctx: PromptBuildContext, hasBeenSummarized: boolean, contextLines: string[]): string {
  const lines: string[] = [];
  if (contextLines.length > 0) lines.push(contextAuthorityInstructions);
  if (hasBeenSummarized) lines.push(summarizationAwarenessInstructions);
  const callingOtherCharacterInstructions = `If the other character's name is provided, I must use their name. Otherwise I will use generic names or terms that ${ctx.characterParticipantTag} will likely use. I will never use 'Character #' or 'Character # (Name)' unless ${ctx.characterParticipantTag} requires it.`;
  lines.push(`${noRepeatInstructions} ${noRestrictionsInstructions} ${callingOtherCharacterInstructions} ${formatInstructions} I am now responding as ${ctx.characterParticipantTag} with the format I am given and I will follow all the prompts given to me.`);
  return lines.join('\n');
}

export async function createChatHistoryArray(
  ctx: PromptBuildContext,
): Promise<{ chatHistoryArray: string[]; hasBeenSummarized: boolean }> {
  const participants = ctx.participants;
  const profile = ctx.profile;
  const contexts = ctx.interactionData.contexts || [];
  const locations = ctx.interactionData.locations || [];
  const protagonistIds = ctx.protagonistIds;
  const localHistory = ctx.localHistory;
  const messageLocationMap = new Map<string, string>();
  for (const [locId, messages] of Object.entries(ctx.interactionData.interactionHistories || {})) {
    for (const msg of messages) messageLocationMap.set(msg.id, locId);
  }
  const visibleTextMessages = localHistory.filter(
    (m): m is TextMessage => isTextMessage(m) && isMessageVisibleTo(m, ctx.characterId)
  );
  if (visibleTextMessages.length === 0) return { chatHistoryArray: [], hasBeenSummarized: false };
  const filterFlags = getMessageFilterFlags(visibleTextMessages, contexts, locations, ctx.allPromptBlocks, ctx.characterId);
  const filteredMessages = visibleTextMessages.filter((_, i) => !filterFlags[i]);
  if (filteredMessages.length === 0) return { chatHistoryArray: [], hasBeenSummarized: false };
  const activeSteps = [...(profile?.summarizationSteps || [])].sort((a, b) => a.order - b.order);
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
        if (
          i < cutoff &&
          (msg as ChatMessage).modelTextContentSummaries &&
          (msg as ChatMessage).modelTextContentSummaries[ctx.modelId]
        ) {
          processedMessages[i].text = (msg as ChatMessage).modelTextContentSummaries[ctx.modelId];
          hasBeenSummarized = true;
        }
      }
    }
    if (step.strategyType === 'Observation Masking') {
      const threshold = step.maskingRelevanceThreshold ?? 0.3;
      const keywordWeight = step.maskingKeywordWeight ?? 0.7;
      const recencyWeight = 1 - keywordWeight;
      const recentText = processedMessages.slice(-5).map(p => p.text.toLowerCase()).join(' ');
      const keywords = new Set(recentText.split(/\s+/).filter(w => w.length > 3));
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

      const candidates = processedMessages.map(p => ({
        id: p.msg.id,
        textContent: p.text,
        locationId: p.locationId,
      }));

      const cutoffIndex = await calculateEntropyPruningCutoff(candidates, chunkSize, threshold, maxRawTokens);

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
  const recentInteractors = new Set<string>();
  const recentSlice = filteredMessages.slice(-RECENT_INTERACTION_WINDOW);
  for (let ri = 0; ri < recentSlice.length; ri++) {
    const msg = recentSlice[ri];
    if (msg.character.id === ctx.characterId) {
      if (ri > 0) recentInteractors.add(recentSlice[ri - 1].character.id);
      if (ri < recentSlice.length - 1) recentInteractors.add(recentSlice[ri + 1].character.id);
    } else {
      if (ri > 0 && recentSlice[ri - 1].character.id === ctx.characterId) recentInteractors.add(msg.character.id);
      if (ri < recentSlice.length - 1 && recentSlice[ri + 1].character.id === ctx.characterId) recentInteractors.add(msg.character.id);
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
        const locName = resolveInnerText(loc?.name || 'Unknown Location', ctx, ctx.delimiters);
        locationVisitSummaries.push({
          characterName: msg.character.name,
          locationName: locName,
          summary,
        });
      }
    }
  }
  const outputMessages = processedMessages.filter((p) => {
    if (hasLocationData) {
      const charLocationId = p.locationId;
      if (charLocationId !== undefined && charLocationId !== currentLocationId) {
        return false;
      }
    }
    if (protagonistIds.has(p.msg.character.id)) return true;
    if (p.msg.character.id === ctx.characterId) return true;
    if (recentInteractors.has(p.msg.character.id)) return true;
    if (hasLocationData && p.locationId === undefined) return true;
    if (!hasLocationData) return true;
    return false;
  });
  const chatHistoryArray: string[] = [];
  if (locationVisitSummaries.length > 0) {
    for (const lvs of locationVisitSummaries) {
      chatHistoryArray.push(`${ctx.delimiters.blockStart('system')}[Memory of ${lvs.locationName}] As ${lvs.characterName}: ${lvs.summary}${ctx.delimiters.blockEnd}`);
    }
    hasBeenSummarized = true;
  }
  const currentLocation = ctx.currentLocation;
  if (currentLocation) {
    const sceneName = resolveInnerText(currentLocation.name || 'Unknown Location', ctx, ctx.delimiters);
    chatHistoryArray.push(`${ctx.delimiters.turnStart('system')}[Scene: ${sceneName}]${ctx.delimiters.turnEnd}`);
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
    
    let historyText = p.text;
    const isSelf = p.msg.character.id === ctx.characterId;
    if (!isSelf) {
      historyText = sanitizeToolSyntax(
        historyText,
        (p.msg as ChatMessage).toolExecutionResults,
        false
      );
    }

    const replacedText = resolveInnerText(historyText, ctx, ctx.delimiters);
    chatHistoryText = `${chatHistoryText}${replacedText}${ctx.delimiters.turnEnd}`;
    chatHistoryArray.push(chatHistoryText);
  }
  return { chatHistoryArray, hasBeenSummarized };
}

const VOLATILE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'Context',
  'Current Location',
  'Current Location With Description',
  'Reachable Locations',
  'Reachable Locations With Descriptions',
  'Inventory',
  'Weather',
  'Date',
  'Time',
  'Time Elapsed',
  'Fatigue',
  'Paragraph Count Instructions',
  'Tool Instructions',
  'Tool Message Instructions',
  'Anti-Repetition Nudge',
  'Character Tags',
  'Character Tags With Descriptions',
  'Prompt Block Image Instructions',
  'Context Image Instructions',
  'Current Location Image Instructions',
  'Character Image Instructions',
  'Knowledge Prompt',
  'Dialogue Prompt',
  'Memory Prompt',
]);

function buildStructuredMessages(
  blockMap: Record<string, string[] | undefined>,
  inputStrategy: (promptBlockType | string)[],
  minimalVolatileCacheMode: boolean,
): OpenAIMessage[] {
  const stableEntries: string[] = [];
  const volatileEntries: string[] = [];
  for (const entry of inputStrategy) {
    if (
      entry === 'Model InstructionTemplate' ||
      entry === 'Model Chat Template' ||
      entry === 'Model Chat-Instruction Template'
    ) {
      continue;
    }
    if (VOLATILE_BLOCK_TYPES.has(entry)) volatileEntries.push(entry);
    else stableEntries.push(entry);
  }
  const orderedEntries = minimalVolatileCacheMode
    ? [...stableEntries, ...volatileEntries]
    : inputStrategy.filter(e =>
        e !== 'Model Instruction Template' &&
        e !== 'Model Chat Template' &&
        e !== 'Model Chat-Instruction Template'
      );
  const stableLines: string[] = [];
  const semiStableLines: string[] = [];
  const historyLines: string[] = [];
  const volatileLines: string[] = [];
  for (const entry of orderedEntries) {
    const lines = blockMap[entry];
    if (!lines || lines.length === 0) continue;
    if (
      entry === 'Knowledge Prompt' ||
      entry === 'Dialogue Prompt' ||
      entry === 'Memory Prompt' ||
      entry === 'Text Injection'
    ) {
      continue;
    }
    if (entry === 'Chat History') historyLines.push(...lines);
    else if (VOLATILE_BLOCK_TYPES.has(entry)) volatileLines.push(...lines);
    else if (entry === 'Starter Prompt' || entry === 'Sky View') semiStableLines.push(...lines);
    else stableLines.push(...lines);
  }
  const messages: OpenAIMessage[] = [];
  if (stableLines.length > 0) messages.push({ role: 'system', content: stableLines.join('\n') });
  if (semiStableLines.length > 0) messages.push({ role: 'system', content: semiStableLines.join('\n') });
  if (historyLines.length > 0) messages.push({ role: 'system', content: historyLines.join('\n') });
  if (volatileLines.length > 0) messages.push({ role: 'user', content: volatileLines.join('\n') });
  const ragLines: string[] = [];
  if (blockMap['Knowledge Prompt']?.length) ragLines.push(...blockMap['Knowledge Prompt']!);
  if (blockMap['Dialogue Prompt']?.length) ragLines.push(...blockMap['Dialogue Prompt']!);
  if (blockMap['Memory Prompt']?.length) ragLines.push(...blockMap['Memory Prompt']!);
  if (ragLines.length > 0) messages.push({ role: 'user', content: ragLines.join('\n') });
  if (blockMap['Text Injection']?.length) {
    messages.push({ role: 'assistant', content: blockMap['Text Injection']!.join('\n') });
  }
  return messages;
}

interface BuilderContext {
  ctx: PromptBuildContext;
  activeContextIds: Set<string>;
  characterClothingWearingStatuses: Record<string, boolean>;
  contextLines: string[];
  hasBeenSummarized: boolean;
  latitude?: number;
  longitude?: number;
  timeData: TimeData | null;
  isToolMessage: boolean | undefined;
  promptBlockById: Map<string, PromptBlock>;
}

async function buildPromptBlocks(
  builderCtx: BuilderContext,
  inputStrategy: string[],
  templateContext: TemplateContext,
  delimiters: PromptDelimiters
): Promise<Record<string, string[]>> {
  const blockMap: Record<string, string[]> = {};
  for (const blockType of inputStrategy) {
    const { ctx } = builderCtx;
    if (blockType === 'System Prompt' && templateContext.systemPrompt.length === 0) continue;
    if (blockType === 'Think Prompt' && templateContext.thinkPrompt.length === 0) continue;
    if (blockType === 'Think Prompt' && ctx.numberOfMessagesByParticipant >= getEffectiveMessagesToDisableThinkPrompt(ctx.character, ctx.profile)) continue;
    if (blockType === 'Meta Think Instructions' && ctx.numberOfMessagesByParticipant >= getEffectiveMessagesToDisableMetaThinkInstructions(ctx.character, ctx.profile)) continue;
    if (blockType === 'Meta Think Instructions' && templateContext.metaThinkInstructions.length === 0) continue;
    if (blockType === 'Character Tags' && templateContext.characterTags.length === 0) continue;
    if (blockType === 'Character Tags With Descriptions' && templateContext.characterTagsWithDescriptions.length === 0) continue;
    if (blockType === 'Knowledge Prompt' && templateContext.knowledgePrompt.length === 0) continue;
    if (blockType === 'Chat History' && templateContext.chatHistory.length === 0) continue;
    if (blockType === 'Appearance Prompt' && templateContext.appearancePrompt.length === 0) continue;
    if (blockType === 'Context' && templateContext.context.length === 0) continue;
    if (blockType === 'Current Location' && templateContext.currentLocation.length === 0) continue;
    if (blockType === 'Current Location With Description' && templateContext.currentLocationWithDescription.length === 0) continue;
    if (blockType === 'Reachable Locations' && templateContext.reachableLocations.length === 0) continue;
    if (blockType === 'Reachable Locations With Descriptions' && templateContext.reachableLocationsWithDescriptions.length === 0) continue;
    if (blockType === 'Sky View' && templateContext.skyView.length === 0) continue;
    if (blockType === 'Weather' && templateContext.weather.length === 0) continue;
    if (blockType === 'Inventory' && templateContext.inventory.length === 0) continue;
    if (blockType === 'Fatigue' && templateContext.fatigueInformation.length === 0) continue;
    if (blockType === 'Paragraph Count Instructions' && templateContext.paragraphCountInstructions.length === 0) continue;
    if (blockType === 'Date' && templateContext.date.length === 0) continue;
    if (blockType === 'Time' && templateContext.time.length === 0) continue;
    if (blockType === 'Time Elapsed' && templateContext.timeElapsed.length === 0) continue;
    if (blockType === 'Tool Instructions' && templateContext.toolInstructions.length === 0) continue;
    if (blockType === 'Tool Message Instructions' && templateContext.toolMessageInstructions.length === 0) continue;
    if (blockType === 'Memory Prompt' && templateContext.memoryPrompt.length === 0) continue;
    if (blockType === 'Dialogue Prompt' && templateContext.dialoguePrompt.length === 0) continue;
    if (blockType === 'Dialogue Prompt' && ctx.numberOfMessagesByParticipant >= getEffectiveMessagesToDisableDialoguePrompt(ctx.character, ctx.profile)) continue;
    if (blockType === 'Starter Prompt' && templateContext.starterPrompt.length === 0) continue;
    if (blockType === 'Starter Prompt' && ctx.numberOfMessagesByParticipant >= getEffectiveMessagesToDisableStarterPrompt(ctx.character, ctx.profile)) continue;
    if (blockType === 'Character Image Instructions') {
      if (templateContext.characterImageInstructions.length === 0) continue;
      blockMap[blockType] = [templateContext.characterImageInstructions];
      continue;
    }
    if (blockType === 'Prompt Block Image Instructions') {
      if (templateContext.promptBlockImageInstructions.length === 0) continue;
      blockMap[blockType] = [templateContext.promptBlockImageInstructions];
      continue;
    }
    if (blockType === 'Context Image Instructions') {
      if (templateContext.contextImageInstructions.length === 0) continue;
      blockMap[blockType] = [templateContext.contextImageInstructions];
      continue;
    }
    if (blockType === 'Current Location Image Instructions') {
      if (templateContext.currentLocationImageInstructions.length === 0) continue;
      blockMap[blockType] = [templateContext.currentLocationImageInstructions];
      continue;
    }
    if (blockType === 'Anti-Repetition Nudge' && templateContext.antiRepetitionNudge.length === 0) continue;
    const template = DEFAULT_TEMPLATES[blockType];
    let resolvedContent = '';
    if (template) {
      resolvedContent = resolveTemplate(template, templateContext, delimiters);
    } else {
      const block = builderCtx.promptBlockById.get(blockType);
      if (block) {
        let text = block.textContent;
        if (!text.includes('{{systemBlockStart}}') && !text.includes('{{systemBlockEnd}}')) {
          text = `{{systemBlockStart}}${text}{{systemBlockEnd}}`;
        }
        resolvedContent = resolveTemplate(text, templateContext, delimiters);
      }
    }
    if (resolvedContent.length > 0) blockMap[blockType] = [resolvedContent];
  }
  return blockMap;
}

async function trackEntityImages(
  entities: { id: string; name?: string; images?: string[] }[],
  entityType: 'promptBlock' | 'context' | 'location',
  getImageUrl: (id: string, filename: string) => string | null,
  instructionList: string[],
  trackedList: TrackedImage[],
  getGlobalId: () => number
): Promise<void> {
  for (const entity of entities) {
    if (!entity.images || entity.images.length === 0) continue;
    let localIdx = 1;
    for (const img of entity.images) {
      const imageUrl = getImageUrl(entity.id, img);
      if (!imageUrl) continue;
      const base64Data = await fetchImageAsBase64(imageUrl);
      if (!base64Data) continue;
      const id = getGlobalId();
      const label = entity.name || 'Unknown Location';
      trackedList.push({ globalId: id, entityType, entityName: label, localIndex: localIdx, base64Data });
      const typeLabel = entityType === 'promptBlock' ? 'Prompt Block' : entityType === 'context' ? 'Context' : 'Location';
      instructionList.push(`Image ${id} - ${typeLabel} '${label}' Image ${localIdx}`);
      localIdx++;
    }
  }
}

interface BuildResult {
  messages: OpenAIMessage[];
  stops: string[];
  imagePayloads: ResolvedImage[];
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
  isToolMessage: boolean,
  allRawInteractionDataShells: RawInteractionData[],
): Promise<BuildResult> {
  const activeModel = tokenEngine.getContext();
  const effectiveChatTemplateKey = activeModel?.chatTemplate;
  const resolvedChatTemplate = effectiveChatTemplateKey ? getModelTemplate(effectiveChatTemplateKey) : undefined;
  const delimiters = deriveDelimiters(resolvedChatTemplate);
  const ctx = buildPromptContext(
    interactionData,
    character,
    knownNames,
    allPromptBlocks,
    modelId,
    existingCharacterText,
    delimiters,
    allRawInteractionDataShells
  );
  const profile = ctx.profile;
  const inputStrategy = profile?.inputStrategy ?? defaultInputStrategy;
  const effectiveContextSensitivity = (() => {
    const profileValue = profile?.contextSensitivity;
    if (profileValue === undefined || profileValue === -1) return character.contextSensitivity ?? 1;
    return profileValue;
  })();
  const segments = detectUnsummarizedLocationDepartures(interactionData, character, modelId);
  for (const segment of segments) {
    try {
      const summary = await generateLocationVisitSummary(
        interactionData,
        character,
        allPromptBlocks,
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
      const validResults = results.filter(r => !r.error && r.textContent.length > 0);
      if (validResults.length > 0) {
        fetchedContentMap.set(
          context.id,
          validResults.map(r => `[Source: ${r.url}]\n${r.textContent}`).join('\n---\n')
        );
      }
    }));
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
  const contextLines: string[] = [];
  for (const { context, combinedText } of resolvedContextsWithWeb) {
    activeContextIds.add(context.id);
    const replacedText = resolveInnerText(combinedText, ctx, ctx.delimiters);
    if (context.useBase64Encoding) {
      contextLines.push(`[base64:${btoa(unescape(encodeURIComponent(replacedText)))}]`);
    } else {
      contextLines.push(replacedText);
    }
  }
  const allTextSearchSpace = ctx.textContentArray.join('\n');
  const allStopPatterns = [
    ...(character.languageModelSampler?.stopPatterns || []),
    ...(character.stopPatterns || [])
  ];
  const activeStopPatterns: StopPattern[] = [];
  for (const stopPattern of allStopPatterns) {
    if (isEntityActiveWithCache(
      stopPattern.regularExpressionActivationTriggers,
      stopPattern.regularExpressionDeactivationTriggers,
      stopPattern.regularExpressionExclusionActivationTriggers,
      stopPattern.regularExpressionExclusionDeactivationTriggers,
      ctx.characterIdArray,
      ctx.textContentArray,
      ctx.characterId,
      [...ctx.protagonistIds],
      allTextSearchSpace,
      ctx.combinationCache
    )) {
      activeStopPatterns.push(stopPattern);
    }
  }
  const characterClothingWearingStatuses = resolveClothingWearingStatus(
    character,
    interactionData,
    ctx.characterIdArray,
    ctx.textContentArray,
    ctx.combinationCache
  );
  let latitude: number | undefined = ctx.currentLocation?.latitude;
  let longitude: number | undefined = ctx.currentLocation?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    const geoLocation = await getLocation();
    if (geoLocation) {
      latitude = geoLocation.latitude;
      longitude = geoLocation.longitude;
    }
  }
  const timeData = getTimeDataFromCoordinates(latitude, longitude);
  const locationResult = buildLocationText(ctx);
  const chatHistoryResult = await createChatHistoryArray(ctx);
  const reachableLocationsResult = buildReachableLocationsText(ctx);
  
  const defaultCharScope = profile?.participantScopeModes?.['Character Name'] ?? 'coLocated';
  const defaultCharInsertion = profile?.participantInsertionModes?.['Character Name'] ?? 'dynamic';
  const defaultCharLimit = profile?.participantsKnownNamesLimits?.['Character Name'];
  
  const defaultSysScope = profile?.participantScopeModes?.['System Prompt'] ?? 'coLocated';
  const defaultSysInsertion = profile?.participantInsertionModes?.['System Prompt'] ?? 'dynamic';
  
  const defaultThinkScope = profile?.participantScopeModes?.['Think Prompt'] ?? 'coLocated';
  const defaultThinkInsertion = profile?.participantInsertionModes?.['Think Prompt'] ?? 'dynamic';

  const characterTagsResult = buildCharacterTagsText(ctx, defaultCharScope, defaultCharInsertion, defaultCharLimit);
  
  let skyViewText = '';
  if (ctx.currentLocation?.hasSkyView && timeData) {
    const skySummary = generateSkyViewText(timeData.rawTimestamp, latitude, longitude);
    if (skySummary) skyViewText = `[Sky & Celestial View]\n${skySummary}`;
  }
  let weatherText = '';
  if (ctx.currentLocation?.hasWeather && profile?.weatherApiKey && latitude && longitude) {
    const weatherLine = await fetchCurrentWeather(latitude, longitude, profile.weatherApiKey);
    if (weatherLine) weatherText = weatherLine;
  }
  let dateText = '';
  if (timeData) dateText = `Today's date is ${timeData.formattedDate}.`;
  let timeText = '';
  if (timeData) timeText = `The current time is ${timeData.formattedTime}.`;
  let timeElapsedText = '';
  if (timeData && ctx.localHistory.length > 0) {
    const lastMsgTimestamp = ctx.localHistory[ctx.localHistory.length - 1].lastUpdatedTimestamp;
    const diffMs = Math.max(0, timeData.rawTimestamp - lastMsgTimestamp);
    timeElapsedText = formatTimeElapsedSentence(diffMs);
  }
  const effectiveMaxChatStamina = getEffectiveMaximumChatStamina(ctx.character, ctx.profile);
  const effectiveMaxActionStamina = getEffectiveMaximumActionStamina(ctx.character, ctx.profile);
  const previousMessage = findLatestMessage(ctx.interactionData, ctx.character);
  const currentChatStamina = previousMessage?.message.remainingChatStamina ?? effectiveMaxChatStamina;
  const currentActionStamina = previousMessage?.message.remainingActionStamina ?? effectiveMaxActionStamina;
  const currentTotalStamina = currentChatStamina + currentActionStamina;
  const maximumTotalStamina = effectiveMaxChatStamina + effectiveMaxActionStamina;
  const chatStaminaRatio = (effectiveMaxChatStamina === Number.POSITIVE_INFINITY || effectiveMaxChatStamina === 0) ? 1 : currentChatStamina / effectiveMaxChatStamina;
  const actionStaminaRatio = (effectiveMaxActionStamina === Number.POSITIVE_INFINITY || effectiveMaxActionStamina === 0) ? 1 : currentActionStamina / effectiveMaxActionStamina;
  const totalStaminaRatio = (maximumTotalStamina === Number.POSITIVE_INFINITY || maximumTotalStamina === 0) ? 1 : currentTotalStamina / maximumTotalStamina;
  const formatStamina = (val: number) => val === Number.POSITIVE_INFINITY ? 'Infinity' : String(Math.round(val));
  const formatRatio = (val: number) => String(Math.round(val * 100) / 100);
  const hasBeenSummarized = chatHistoryResult.hasBeenSummarized;
  const textInjectionText = buildTextInjectionText(ctx, hasBeenSummarized, contextLines);
  const allowedImageTypes = profile?.entityImageTypes ?? ['promptBlock', 'context', 'location', 'character'];
  let globalIdCounter = 1;
  const nextGlobalId = () => globalIdCounter++;
  const trackedImages: TrackedImage[] = [];
  const charImgInst: string[] = [];
  const promptImgInst: string[] = [];
  const ctxImgInst: string[] = [];
  const locImgInst: string[] = [];

  for (const imageType of allowedImageTypes) {
    if (imageType === 'character') {
      const colocatedParticipants = getCoLocatedParticipants(interactionData, character);
      const protagonistIds = new Set(interactionData.protagonistIds || []);
      const effectiveUseFrontCameraImage = getEffectiveUseFrontCameraImage(character, profile);
      const charsToProcess = [character, ...colocatedParticipants.filter(p => p.id !== character.id)];
      for (const char of charsToProcess) {
        if (char.doNotInjectCharacterImage) continue;
        const charMessage = findLatestMessage(interactionData, char);
        const charExpression = charMessage?.message.characterExpression;
        let base64Data: string | null = null;
        const textMsg = charMessage?.message as TextMessage | null;
        if (protagonistIds.has(char.id) && effectiveUseFrontCameraImage && (textMsg as ChatMessage)?.frontCameraImage) {
          const fcImg = (textMsg as ChatMessage).frontCameraImage!;
          base64Data = fcImg.includes(',') ? fcImg.split(',')[1] : fcImg;
        } else {
          const imagePath = await getCharacterImageUrlWithFallBack(char.id, charExpression);
          if (imagePath) base64Data = await fetchImageAsBase64(imagePath);
        }
        if (!base64Data) continue;
        const id = nextGlobalId();
        const displayName = getFullDisplayName(char, ctx.participants, ctx.knownNames);
        trackedImages.push({
          globalId: id,
          entityType: 'character',
          entityName: displayName,
          localIndex: 1,
          base64Data
        });
        charImgInst.push(`Image ${id} - ${displayName}`);
      }
    } else if (imageType === 'promptBlock') {
      const activeBlocks = allPromptBlocks.filter(block => {
        if (!isPromptBlockCharacterBound(block, ctx.characterId)) return false;
        if (block.contextBindings?.length && !block.contextBindings.some(ctxId => activeContextIds.has(ctxId))) return false;
        if (block.locationBindings?.length && (!ctx.currentLocationId || !block.locationBindings.includes(ctx.currentLocationId))) return false;
        return isEntityActiveWithCache(
          block.regularExpressionActivationTriggers,
          block.regularExpressionDeactivationTriggers,
          block.regularExpressionExclusionActivationTriggers,
          block.regularExpressionExclusionDeactivationTriggers,
          ctx.characterIdArray,
          ctx.textContentArray,
          ctx.characterId,
          [...ctx.protagonistIds],
          allTextSearchSpace,
          ctx.combinationCache
        );
      });
      await trackEntityImages(activeBlocks, 'promptBlock', getPromptBlockImageUrl, promptImgInst, trackedImages, nextGlobalId);
    } else if (imageType === 'context') {
      await trackEntityImages(resolvedContextsWithWeb.map(r => r.context), 'context', getContextImageUrl, ctxImgInst, trackedImages, nextGlobalId);
    } else if (imageType === 'location' && ctx.currentLocation) {
      await trackEntityImages([ctx.currentLocation], 'location', getLocationImageUrl, locImgInst, trackedImages, nextGlobalId);
    }
  }

  const charImgStr = charImgInst.length > 0 ? `${delimiters.blockStart('system')}${charImgInst.join(', ')}${delimiters.blockEnd}` : '';
  const promptImgStr = promptImgInst.length > 0 ? `${delimiters.blockStart('system')}${promptImgInst.join(', ')}${delimiters.blockEnd}` : '';
  const ctxImgStr = ctxImgInst.length > 0 ? `${delimiters.blockStart('system')}${ctxImgInst.join(', ')}${delimiters.blockEnd}` : '';
  const locImgStr = locImgInst.length > 0 ? `${delimiters.blockStart('system')}${locImgInst.join(', ')}${delimiters.blockEnd}` : '';
  
  const protagonistsList = ctx.coLocatedProtagonists.map(p => getFullDisplayName(p, ctx.participants, ctx.knownNames));
  const protagonistsPossessiveList = ctx.coLocatedProtagonists.map(p => {
    const tag = getParticipantTag(p, ctx.participants);
    const knownName = getKnownDisplayName(p, ctx.knownNames);
    return `${knownName ?? tag}'s`;
  });

  const charactersList = ctx.participants.map(p => getFullDisplayName(p, ctx.participants, ctx.knownNames));
  const charactersPossessiveList = ctx.participants.map(p => {
    const tag = getParticipantTag(p, ctx.participants);
    const knownName = getKnownDisplayName(p, ctx.knownNames);
    return `${knownName ?? tag}'s`;
  });

  const templateContext: TemplateContext = {
    characterParticipantTag: ctx.characterParticipantTag,
    characterName: ctx.characterName,
    protagonistDisplayString: buildProtagonistDisplayString(ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames),
    protagonistPossessiveString: buildProtagonistPossessiveString(ctx.coLocatedProtagonists, ctx.participants, ctx.knownNames),
    protagonists: protagonistsList,
    "protagonists'": protagonistsPossessiveList,
    characters: charactersList,
    "characters'": charactersPossessiveList,
    characterTurnStart: delimiters.turnStart(ctx.characterParticipantTag),
    characterTurnEnd: delimiters.turnEnd,
    chatHistory: chatHistoryResult.chatHistoryArray,
    reachableLocations: reachableLocationsResult.names,
    reachableLocationsWithDescriptions: reachableLocationsResult.withDescriptions,
    characterTags: characterTagsResult.tags,
    characterTagsWithDescriptions: characterTagsResult.tagsWithDescriptions,
    systemPrompt: buildSystemPromptText(ctx, defaultSysScope, defaultSysInsertion),
    thinkPrompt: buildThinkPromptText(ctx, defaultThinkScope, defaultThinkInsertion),
    metaThinkInstructions: buildMetaThinkText(ctx),
    appearancePrompt: buildAppearanceText(ctx, characterClothingWearingStatuses, defaultCharScope, defaultCharInsertion, defaultCharLimit),
    knowledgePrompt: await buildKnowledgePromptText(ctx),
    dialoguePrompt: await buildDialoguePromptText(ctx),
    memoryPrompt: await buildMemoryPromptText(ctx),
    starterPrompt: await buildStarterPromptText(ctx),
    context: contextLines,
    currentLocation: locationResult.basic,
    currentLocationWithDescription: locationResult.withDescription,
    inventory: buildInventoryText(ctx),
    skyView: skyViewText,
    weather: weatherText,
    date: dateText,
    time: timeText,
    timeElapsed: timeElapsedText,
    currentChatStamina: formatStamina(currentChatStamina),
    maximumChatStamina: formatStamina(effectiveMaxChatStamina),
    chatStaminaRatio: formatRatio(chatStaminaRatio),
    currentActionStamina: formatStamina(currentActionStamina),
    maximumActionStamina: formatStamina(effectiveMaxActionStamina),
    actionStaminaRatio: formatRatio(actionStaminaRatio),
    currentTotalStamina: formatStamina(currentTotalStamina),
    maximumTotalStamina: formatStamina(maximumTotalStamina),
    totalStaminaRatio: formatRatio(totalStaminaRatio),
    fatigueInformation: !isToolMessage ? buildFatigueText(chatStaminaRatio, actionStaminaRatio, totalStaminaRatio) : '',
    paragraphCountInstructions: !isToolMessage ? buildParagraphCountInstructionsText(currentChatStamina, effectiveMaxChatStamina) : '',
    tools: ctx.tools,
    toolInstructions: buildToolInstructionText(ctx.tools),
    toolMessageInstructions: isToolMessage ? buildToolMessageInstructionText() : '',
    characterImageInstructions: charImgStr,
    promptBlockImageInstructions: promptImgStr,
    contextImageInstructions: ctxImgStr,
    currentLocationImageInstructions: locImgStr,
    antiRepetitionNudge: buildAntiRepetitionNudgeText(ctx),
    textInjection: textInjectionText,
    text: existingCharacterText,
    promptBuildContext: ctx,
    wearingStatus: characterClothingWearingStatuses
  };
  templateContext.toolInstructions = resolveTemplate(
    templateContext.toolInstructions,
    templateContext,
    delimiters
  );
  templateContext.paragraphCountInstructions = resolveTemplate(
    templateContext.paragraphCountInstructions,
    templateContext,
    delimiters
  );
  const promptBlockById = new Map<string, PromptBlock>();
  for (const pb of allPromptBlocks) promptBlockById.set(pb.id, pb);
  const builderCtx: BuilderContext = {
    ctx,
    activeContextIds,
    characterClothingWearingStatuses,
    contextLines,
    hasBeenSummarized,
    latitude,
    longitude,
    timeData,
    isToolMessage,
    promptBlockById
  };
  const blockMap = await buildPromptBlocks(builderCtx, inputStrategy, templateContext, delimiters);
  const regexActivatedBlocks: string[] = [];
  for (const block of allPromptBlocks) {
    if (!isPromptBlockCharacterBound(block, ctx.characterId)) continue;
    if (block.contextBindings?.length && !block.contextBindings.some(ctxId => activeContextIds.has(ctxId))) continue;
    if (block.locationBindings?.length && (!ctx.currentLocationId || !block.locationBindings.includes(ctx.currentLocationId))) continue;
    if (!isEntityActiveWithCache(
      block.regularExpressionActivationTriggers,
      block.regularExpressionDeactivationTriggers,
      block.regularExpressionExclusionActivationTriggers,
      block.regularExpressionExclusionDeactivationTriggers,
      ctx.characterIdArray,
      ctx.textContentArray,
      ctx.characterId,
      [...ctx.protagonistIds],
      allTextSearchSpace,
      ctx.combinationCache
    )) {
      continue;
    }
    let text = block.textContent;
    if (!text.includes('{{systemBlockStart}}') && !text.includes('{{systemBlockEnd}}')) {
      text = `{{systemBlockStart}}${text}{{systemBlockEnd}}`;
    }
    const resolvedText = resolveTemplate(text, templateContext, delimiters);
    if (resolvedText.length > 0) {
      if (!blockMap[block.id]) blockMap[block.id] = [resolvedText];
      if (!inputStrategy.includes(block.id)) regexActivatedBlocks.push(block.id);
    }
  }
  
  const promptFormatMode = profile?.promptFormatMode ?? 'none';
  let messages: OpenAIMessage[];

  if (promptFormatMode !== 'none') {
    const contentLines: string[] = [];
    for (const entry of inputStrategy) {
      if (
        entry === 'Model Chat Template' ||
        entry === 'Model Instruction Template' ||
        entry === 'Model Chat-Instruction Template'
      ) continue;
      
      const lines = blockMap[entry];
      if (lines?.length) contentLines.push(...lines);
    }
    
    for (const blockId of regexActivatedBlocks) {
      const lines = blockMap[blockId];
      if (lines?.length) contentLines.push(...lines);
    }

    const assembledContent = contentLines.join('\n');
    const promptLines: string[] = [];

    const effectiveInstructionTemplateKey = activeModel?.instructionTemplate;
    const resolvedInstructionTemplate = effectiveInstructionTemplateKey ? getModelTemplate(effectiveInstructionTemplateKey) : undefined;

    if (promptFormatMode === 'instruction' && resolvedInstructionTemplate?.instructionTemplate) {
      promptLines.push(
        resolvedInstructionTemplate.instructionTemplate
          .replace(/{instruction}/g, assembledContent)
          .replace(/{input}/g, '')
          .replace(/{system}/g, ctx.character.systemPrompt || '')
      );
    } else if (promptFormatMode === 'chat' && resolvedChatTemplate?.chatTemplate) {
      const protagonistIdSet = ctx.protagonistIds;
      const chatHistoryForTemplate = ctx.localHistory.filter(
        (m): m is TextMessage => isTextMessage(m) && isMessageVisibleTo(m, ctx.characterId)
      );
      
      promptLines.push(assembledContent);
      
      for (const msg of chatHistoryForTemplate) {
        const role = protagonistIdSet.has(msg.character.id) ? 'user' : 'assistant';
        let content = selectModelSummary(msg, modelId);
        if (msg.character.id !== ctx.characterId) {
          content = sanitizeToolSyntax(content, (msg as ChatMessage).toolExecutionResults, false);
        }
        content = resolveInnerText(content, ctx, ctx.delimiters);
        promptLines.push(
          resolvedChatTemplate.chatTemplate
            .replace(/{role}/gi, role)
            .replace(/{content}/g, content)
        );
      }
      promptLines.push(
        resolvedChatTemplate.chatTemplate
          .replace(/{role}/gi, 'assistant')
          .replace(/{content}/g, '')
      );
    } else if (promptFormatMode === 'chat-instruction' && resolvedInstructionTemplate?.instructionTemplate && resolvedChatTemplate?.chatTemplate) {
      promptLines.push(
        resolvedInstructionTemplate.instructionTemplate
          .replace(/{instruction}/g, `Continue the chat dialogue below. Write a single reply for the character "${ctx.characterName}".\n${assembledContent}`)
          .replace(/{input}/g, '')
          .replace(/{system}/g, ctx.character.systemPrompt || '')
      );
      
      const protagonistIdSet = ctx.protagonistIds;
      const chatHistoryForTemplate = ctx.localHistory.filter(
        (m): m is TextMessage => isTextMessage(m) && isMessageVisibleTo(m, ctx.characterId)
      );
      for (const msg of chatHistoryForTemplate) {
        const role = protagonistIdSet.has(msg.character.id) ? 'user' : 'assistant';
        let content = selectModelSummary(msg, modelId);
        if (msg.character.id !== ctx.characterId) {
          content = sanitizeToolSyntax(content, (msg as ChatMessage).toolExecutionResults, false);
        }
        content = resolveInnerText(content, ctx, ctx.delimiters);
        promptLines.push(
          resolvedChatTemplate.chatTemplate
            .replace(/{role}/gi, role)
            .replace(/{content}/g, content)
        );
      }
      promptLines.push(
        resolvedChatTemplate.chatTemplate
          .replace(/{role}/gi, 'assistant')
          .replace(/{content}/g, '')
      );
    } else {
      promptLines.push(assembledContent);
    }
    messages = [{ role: 'user', content: promptLines.join('\n') }];
  } else {
    messages = buildStructuredMessages(blockMap, inputStrategy, ctx.minimalVolatileCacheMode);
    if (regexActivatedBlocks.length > 0) {
      const extraLines: string[] = [];
      for (const blockId of regexActivatedBlocks) {
        const lines = blockMap[blockId];
        if (lines?.length) extraLines.push(...lines);
      }
      if (extraLines.length > 0) {
        const lastSystemMsg = [...messages].reverse().find(m => m.role === 'system');
        if (lastSystemMsg && typeof lastSystemMsg.content === 'string') {
          lastSystemMsg.content += `\n${extraLines.join('\n')}`;
        } else {
          messages.push({ role: 'system', content: extraLines.join('\n') });
        }
      }
    }
  }

  const defaultStops = !profile?.doNotInjectDefaultStopTokens
    ? resolveEffectiveStopTokens()
    : [];
  const stops = [...defaultStops, ...activeStopPatterns.map(sp => sp.pattern)];
  const uniqueStops = Array.from(new Set(stops)).filter(s => typeof s === 'string' && s.length > 0);
  const imagePayloads = trackedImages.map(img => ({ data: img.base64Data, id: img.globalId }));

  return {
    messages,
    stops: uniqueStops,
    imagePayloads,
    characterClothingWearingStatuses,
    fetchErrors
  };
}