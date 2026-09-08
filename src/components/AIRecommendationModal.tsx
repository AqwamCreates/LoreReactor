// src/components/AIRecommendationModal.tsx
import type React from 'react';
import { useState, useRef, useCallback, useMemo } from 'react';
import type { Character, Context, Location, Sampler, LanguageModel, Profile, World, PromptBlockType, SummarizationStrategyType } from '../types';
import { EntitySelectList } from './EntitySelectList';
import { LanguageModelEngine } from '../services/LanguageModelEngine';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

type EntityType = 'Character' | 'Context' | 'Location' | 'Profile' | 'World';
type ViewTab = 'raw' | 'Character' | 'Context' | 'Location' | 'Profile' | 'World';

interface GeneratedCharacter {
    name: string;
    description?: string;
    systemPrompt?: string;
    thinkPrompt?: string;
    appearancePrompt?: string;
    dialoguePrompt?: string;
    initiativeWeight?: number;
    chatProbability?: number;
    maximumChatStamina?: number;
    nameSensitivity?: number;
    chatImpatienceSensitivity?: number;
    skipProbability?: number;
    memoryRetentionWeight?: number;
    contextSensitivity?: number;
    doNotInjectCharacterImage?: boolean;
    numberOfMessagesToDisableThinkPrompt?: number;
    numberOfMessagesToDisableMetaThinkInstructions?: number;
    numberOfMessagesToDisableDialoguePrompt?: number;
    enableWebSearch?: boolean;
    enableCalculator?: boolean;
    enableMemoryWriting?: boolean;
    enableMemoryReading?: boolean;
}

interface GeneratedContext {
    name: string;
    description?: string;
    text?: string;
    searchTerms?: string[];
    urls?: string[];
    includeLinkImages?: boolean;
    maximumLinkDepth?: number;
    linkFetchMode?: 'full' | 'summary' | 'extract';
    limitLinksToSubdirectory?: boolean;
    fetchCacheTimeToLiveMs?: number;
    regularExpressionActivationTrigger?: string;
    regularExpressionDeactivationTrigger?: string;
    regularExpressionContext?: 'global' | 'local' | 'previous';
    regularExpressionTarget?: 'everyone' | 'listener' | 'self';
    tokenBudget?: number;
    maximumRecursionDepth?: number;
    insertionDepth?: number;
    characterBindings?: string[];
    useBase64Encoding?: boolean;
}

interface GeneratedLocation {
    name: string;
    description?: string;
    text?: string;
    regularExpressionActivationTrigger?: string;
    locationBindings?: string[];
    locationBindingRegularExpressionTriggers?: Record<string, string>;
    characterBindings?: string[];
    globalWeight?: number;
    characterWeights?: Record<string, number>;
    useBase64Encoding?: boolean;
}

interface GeneratedSummarizationStep {
    strategyType: SummarizationStrategyType;
    enabled: boolean;
    order: number;
    slidingWindowSize?: number;
    compressionInterval?: number;
    compressionChunkSize?: number;
    recursiveChunkSize?: number;
    recursiveMaxDepth?: number;
    maskingRelevanceThreshold?: number;
    maskingKeywordWeight?: number;
    summaryTokenBudget?: number;
    triggerTokenThreshold?: number;
}

interface GeneratedProfile {
    name: string;
    description?: string;
    forceNameReveal?: boolean;
    enableCharacterExpression?: boolean;
    forceNoCharacterImageInjection?: boolean;
    forceNoContextImageInjection?: boolean;
    useCurrentDateAndTime?: boolean;
    useWeather?: boolean;
    useTimeElapsed?: boolean;
    numberOfMessagesToDisableThinkPrompt?: number;
    numberOfMessagesToDisableMetaThinkInstructions?: number;
    numberOfMessagesToDisableDialoguePrompt?: number;
    forceEqualInitiative?: boolean;
    chatProbability?: number;
    maximumChatStamina?: number;
    nameSensitivity?: number;
    chatImpatienceSensitivity?: number;
    skipProbability?: number;
    memoryRetentionWeight?: number;
    contextSensitivity?: number;
    cacheInvalidationReductionLevel?: number;
    narrateNormalText?: boolean;
    narrateQuotedText?: boolean;
    narrateBoldedText?: boolean;
    narrateItalicizedText?: boolean;
    stripThinkTokens?: boolean;
    enableWebSearch?: number;
    enableCalculator?: number;
    enableMemoryWriting?: number;
    enableMemoryReading?: number;
    inputStrategy?: PromptBlockType[];
    summarizationSteps?: GeneratedSummarizationStep[];
}

interface GeneratedWorldDefinition {
    name: string;
    description?: string;
    characters: GeneratedCharacter[];
    contexts: GeneratedContext[];
    locations: GeneratedLocation[];
    profile?: GeneratedProfile;
}

interface GeneratedOutput {
    character?: GeneratedCharacter;
    context?: GeneratedContext;
    location?: GeneratedLocation;
    profile?: GeneratedProfile;
    world?: GeneratedWorldDefinition;
}

const ENTITY_OPTIONS: { type: EntityType; label: string; icon: string }[] = [
    { type: 'Character', label: 'Character', icon: '🎭' },
    { type: 'Context', label: 'Context', icon: '📜' },
    { type: 'Location', label: 'Location', icon: '📍' },
    { type: 'Profile', label: 'Profile', icon: '👤' },
    { type: 'World', label: 'World', icon: '🌍' },
];

const recommendationEngine = new LanguageModelEngine();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * When World is selected alongside individual entity types, those individual types
 * are absorbed into the World generation. The schema only shows "world" (which contains
 * arrays of all sub-entity types) rather than duplicating them at the top level.
 */
function getEffectiveSchemaEntities(selectedEntities: EntityType[]): EntityType[] {
    const hasWorld = selectedEntities.includes('World');
    if (!hasWorld) return selectedEntities;

    // World absorbs Character, Context, Location, Profile — only show "world" in schema
    return ['World'];
}

function buildJsonSchema(effectiveEntities: EntityType[]): string {
    const parts: string[] = [];

    if (effectiveEntities.includes('Character')) {
        parts.push(`  "character": {
    "name": "string (required)",
    "description": "string",
    "systemPrompt": "string",
    "thinkPrompt": "string",
    "appearancePrompt": "string",
    "dialoguePrompt": "string",
    "initiativeWeight": "number (0-10, default 5)",
    "chatProbability": "number (0-1, default 0.8)",
    "maximumChatStamina": "number (1-20, default 5)",
    "nameSensitivity": "number (0-1, default 0.3)",
    "chatImpatienceSensitivity": "number (0-1, default 0.2)",
    "skipProbability": "number (0-1, default 0.1)",
    "memoryRetentionWeight": "number (0-1, default 0.5)",
    "contextSensitivity": "number (0-1, default 0.5)",
    "doNotInjectCharacterImage": "boolean (default false)",
    "numberOfMessagesToDisableThinkPrompt": "number (default 0)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (default 0)",
    "numberOfMessagesToDisableDialoguePrompt": "number (default 0)",
    "enableWebSearch": "boolean (default false)",
    "enableCalculator": "boolean (default false)",
    "enableMemoryWriting": "boolean (default false)",
    "enableMemoryReading": "boolean (default false)"
  }`);
    }

    if (effectiveEntities.includes('Context')) {
        parts.push(`  "context": {
    "name": "string (required)",
    "description": "string",
    "text": "string (required)",
    "searchTerms": ["string array"],
    "urls": ["string array"],
    "includeLinkImages": "boolean (default false)",
    "maximumLinkDepth": "number (default 1)",
    "linkFetchMode": "'full' | 'summary' | 'extract' (default 'summary')",
    "limitLinksToSubdirectory": "boolean (default false)",
    "fetchCacheTimeToLiveMs": "number",
    "regularExpressionActivationTrigger": "string (regex without delimiters)",
    "regularExpressionDeactivationTrigger": "string (regex without delimiters)",
    "regularExpressionContext": "'global' | 'local' | 'previous' (default 'global')",
    "regularExpressionTarget": "'everyone' | 'listener' | 'self' (default 'everyone')",
    "tokenBudget": "number (default 512)",
    "maximumRecursionDepth": "number (default 1)",
    "insertionDepth": "number (default 0, lower = closer to user message)",
    "characterBindings": ["character name or ID strings"],
    "useBase64Encoding": "boolean (default false)"
  }`);
    }

    if (effectiveEntities.includes('Location')) {
        parts.push(`  "location": {
    "name": "string (required)",
    "description": "string",
    "text": "string (required)",
    "regularExpressionActivationTrigger": "string (regex without delimiters)",
    "locationBindings": ["location name or ID strings this location is reachable from"],
    "locationBindingRegularExpressionTriggers": {"location name or ID": "regex pattern for conditional access"},
    "characterBindings": ["character name or ID strings allowed here"],
    "globalWeight": "number (0-10, default 1)",
    "characterWeights": {"character name or ID": weight number},
    "useBase64Encoding": "boolean (default false)"
  }`);
    }

    if (effectiveEntities.includes('Profile')) {
        parts.push(`  "profile": {
    "name": "string (required)",
    "description": "string",
    "forceNameReveal": "boolean (default false)",
    "enableCharacterExpression": "boolean (default false)",
    "forceNoCharacterImageInjection": "boolean (default false)",
    "forceNoContextImageInjection": "boolean (default false)",
    "useCurrentDateAndTime": "boolean (default false)",
    "useWeather": "boolean (default false)",
    "useTimeElapsed": "boolean (default false)",
    "numberOfMessagesToDisableThinkPrompt": "number (default 0)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (default 0)",
    "numberOfMessagesToDisableDialoguePrompt": "number (default 0)",
    "forceEqualInitiative": "boolean (default false)",
    "chatProbability": "number (0-1, default 0.8)",
    "maximumChatStamina": "number (1-20, default 5)",
    "nameSensitivity": "number (0-1, default 0.3)",
    "chatImpatienceSensitivity": "number (0-1, default 0.2)",
    "skipProbability": "number (0-1, default 0.1)",
    "memoryRetentionWeight": "number (0-1, default 0.5)",
    "contextSensitivity": "number (0-1, default 0.5)",
    "cacheInvalidationReductionLevel": "number (0-3, default 0)",
    "narrateNormalText": "boolean (default true)",
    "narrateQuotedText": "boolean (default false)",
    "narrateBoldedText": "boolean (default false)",
    "narrateItalicizedText": "boolean (default false)",
    "stripThinkTokens": "boolean (default true)",
    "enableWebSearch": "number (0 or 1, default 0)",
    "enableCalculator": "number (0 or 1, default 0)",
    "enableMemoryWriting": "number (0 or 1, default 0)",
    "enableMemoryReading": "number (0 or 1, default 0)",
    "inputStrategy": ["array of PromptBlockType: 'System Prompt' | 'Think Prompt' | 'Meta Think Instructions' | 'Appearance Prompt' | 'Dialogue Prompt' | 'Memory' | 'Chat History' | 'Context' | 'Location' | 'Fatigue Information' | 'Date And Time' | 'Weather' | 'Time Elapsed' | 'Tool Instructions' | 'Text Injection'"],
    "summarizationSteps": [{"strategyType": "'Sliding Window Replace' | 'Periodic Compression' | 'Recursive Summary' | 'Observation Masking'", "enabled": true, "order": 0, "slidingWindowSize": "number", "compressionInterval": "number", "compressionChunkSize": "number", "recursiveChunkSize": "number", "recursiveMaxDepth": "number", "maskingRelevanceThreshold": "number", "maskingKeywordWeight": "number", "summaryTokenBudget": "number", "triggerTokenThreshold": "number"}]
  }`);
    }

    if (effectiveEntities.includes('World')) {
        parts.push(`  "world": {
    "name": "string (required)",
    "description": "string",
    "characters": [/* array of character objects using the full character schema */],
    "contexts": [/* array of context objects using the full context schema */],
    "locations": [/* array of location objects using the full location schema */],
    "profile": {/* profile object using the full profile schema, optional */}
  }`);
    }

    return `{\n${parts.join(',\n')}\n}`;
}

function tryParseGeneratedOutput(text: string): GeneratedOutput | null {
    let jsonStr = text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    try {
        const parsed = JSON.parse(jsonStr);
        if (!parsed || typeof parsed !== 'object') return null;

        const result: GeneratedOutput = {};

        if (parsed.character && typeof parsed.character === 'object' && parsed.character.name) {
            result.character = parsed.character as GeneratedCharacter;
        }

        if (parsed.context && typeof parsed.context === 'object' && parsed.context.name && parsed.context.text) {
            result.context = parsed.context as GeneratedContext;
        }

        if (parsed.location && typeof parsed.location === 'object' && parsed.location.name && parsed.location.text) {
            result.location = parsed.location as GeneratedLocation;
        }

        if (parsed.profile && typeof parsed.profile === 'object' && parsed.profile.name) {
            result.profile = parsed.profile as GeneratedProfile;
        }

        if (parsed.world && typeof parsed.world === 'object' && parsed.world.name && Array.isArray(parsed.world.characters)) {
            result.world = parsed.world as GeneratedWorldDefinition;
        }

        if (!result.character && !result.context && !result.location && !result.profile && !result.world) return null;
        return result;
    } catch {
        return null;
    }
}

function resolveWorldCrossReferences(world: GeneratedWorldDefinition): {
    characters: Character[];
    contexts: Context[];
    locations: Location[];
    profile?: Profile;
} {
    const now = Date.now();
    const charNameToId = new Map<string, string>();

    const characters: Character[] = world.characters.map(c => {
        const id = uuidv4();
        charNameToId.set(c.name, id);
        return {
            id, name: c.name, description: c.description || '',
            systemPrompt: c.systemPrompt || '', thinkPrompt: c.thinkPrompt || undefined,
            appearancePrompt: c.appearancePrompt || undefined, dialoguePrompt: c.dialoguePrompt || undefined,
            images: {}, sampler: undefined,
            initiativeWeight: c.initiativeWeight ?? 5, chatProbability: c.chatProbability ?? 0.8,
            maximumChatStamina: c.maximumChatStamina ?? 5, nameSensitivity: c.nameSensitivity ?? 0.3,
            chatImpatienceSensitivity: c.chatImpatienceSensitivity ?? 0.2,
            skipProbability: c.skipProbability ?? 0.1, memoryRetentionWeight: c.memoryRetentionWeight ?? 0.5,
            contextSensitivity: c.contextSensitivity ?? 0.5,
            doNotInjectCharacterImage: c.doNotInjectCharacterImage ?? false,
            numberOfMessagesToDisableThinkPrompt: c.numberOfMessagesToDisableThinkPrompt ?? 0,
            numberOfMessagesToDisableMetaThinkInstructions: c.numberOfMessagesToDisableMetaThinkInstructions ?? 0,
            numberOfMessagesToDisableDialoguePrompt: c.numberOfMessagesToDisableDialoguePrompt ?? 0,
            enableWebSearch: c.enableWebSearch ?? false, enableCalculator: c.enableCalculator ?? false,
            enableMemoryWriting: c.enableMemoryWriting ?? false, enableMemoryReading: c.enableMemoryReading ?? false,
            memories: {}, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
        };
    });

    const resolveCharRef = (ref: string): string | undefined => {
        if (charNameToId.has(ref)) return charNameToId.get(ref);
        if (UUID_REGEX.test(ref)) return ref;
        return undefined;
    };

    const contexts: Context[] = (world.contexts || []).map(c => ({
        id: uuidv4(), name: c.name, description: c.description || undefined,
        text: c.text || '', searchTerms: c.searchTerms || undefined,
        urls: c.urls || undefined, includeLinkImages: c.includeLinkImages ?? false,
        maximumLinkDepth: c.maximumLinkDepth ?? 1, linkFetchMode: c.linkFetchMode ?? 'summary',
        limitLinksToSubdirectory: c.limitLinksToSubdirectory ?? false,
        fetchCacheTimeToLiveMs: c.fetchCacheTimeToLiveMs || undefined,
        regularExpressionActivationTrigger: c.regularExpressionActivationTrigger || undefined,
        regularExpressionDeactivationTrigger: c.regularExpressionDeactivationTrigger || undefined,
        regularExpressionContext: c.regularExpressionContext ?? 'global',
        regularExpressionTarget: c.regularExpressionTarget ?? 'everyone',
        tokenBudget: c.tokenBudget ?? 512, maximumRecursionDepth: c.maximumRecursionDepth ?? 1,
        insertionDepth: c.insertionDepth ?? 0,
        characterBindings: (c.characterBindings || []).map(resolveCharRef).filter((id): id is string => !!id),
        useBase64Encoding: c.useBase64Encoding ?? false,
        firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
    }));

    const locNameToId = new Map<string, string>();
    const rawLocations = world.locations || [];
    rawLocations.forEach(l => locNameToId.set(l.name, uuidv4()));

    const resolveLocRef = (ref: string): string | undefined => {
        if (locNameToId.has(ref)) return locNameToId.get(ref);
        if (UUID_REGEX.test(ref)) return ref;
        return undefined;
    };

    const locations: Location[] = rawLocations.map(l => {
        const id = locNameToId.get(l.name)!;
        const resolvedLocBindings = (l.locationBindings || []).map(resolveLocRef).filter((id): id is string => !!id);
        const resolvedLocRegexTriggers: Record<string, string> = {};
        if (l.locationBindingRegularExpressionTriggers) {
            for (const [ref, regex] of Object.entries(l.locationBindingRegularExpressionTriggers)) {
                const resolvedId = resolveLocRef(ref);
                if (resolvedId) resolvedLocRegexTriggers[resolvedId] = regex;
            }
        }
        const resolvedCharBindings = (l.characterBindings || []).map(resolveCharRef).filter((id): id is string => !!id);
        const resolvedCharWeights: Record<string, number> = {};
        if (l.characterWeights) {
            for (const [ref, weight] of Object.entries(l.characterWeights)) {
                const resolvedId = resolveCharRef(ref);
                if (resolvedId) resolvedCharWeights[resolvedId] = weight;
            }
        }
        return {
            id, name: l.name, description: l.description || undefined,
            text: l.text || '',
            regularExpressionActivationTrigger: l.regularExpressionActivationTrigger || undefined,
            locationBindings: resolvedLocBindings,
            locationBindingRegularExpressionTriggers: Object.keys(resolvedLocRegexTriggers).length > 0 ? resolvedLocRegexTriggers : undefined,
            characterBindings: resolvedCharBindings,
            globalWeight: l.globalWeight ?? 1,
            characterWeights: resolvedCharWeights,
            useBase64Encoding: l.useBase64Encoding ?? false,
            firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
        };
    });

    let profile: Profile | undefined;
    if (world.profile) {
        const p = world.profile;
        profile = {
            id: uuidv4(), name: p.name, description: p.description || undefined,
            forceNameReveal: p.forceNameReveal ?? false,
            enableCharacterExpression: p.enableCharacterExpression ?? false,
            forceNoCharacterImageInjection: p.forceNoCharacterImageInjection ?? false,
            forceNoContextImageInjection: p.forceNoContextImageInjection ?? false,
            useCurrentDateAndTime: p.useCurrentDateAndTime ?? false,
            useWeather: p.useWeather ?? false, useTimeElapsed: p.useTimeElapsed ?? false,
            numberOfMessagesToDisableThinkPrompt: p.numberOfMessagesToDisableThinkPrompt ?? 0,
            numberOfMessagesToDisableMetaThinkInstructions: p.numberOfMessagesToDisableMetaThinkInstructions ?? 0,
            numberOfMessagesToDisableDialoguePrompt: p.numberOfMessagesToDisableDialoguePrompt ?? 0,
            forceEqualInitiative: p.forceEqualInitiative ?? false,
            chatProbability: p.chatProbability ?? 0.8, maximumChatStamina: p.maximumChatStamina ?? 5,
            nameSensitivity: p.nameSensitivity ?? 0.3, chatImpatienceSensitivity: p.chatImpatienceSensitivity ?? 0.2,
            skipProbability: p.skipProbability ?? 0.1, memoryRetentionWeight: p.memoryRetentionWeight ?? 0.5,
            contextSensitivity: p.contextSensitivity ?? 0.5,
            cacheInvalidationReductionLevel: p.cacheInvalidationReductionLevel ?? 0,
            narrateNormalText: p.narrateNormalText ?? true, narrateQuotedText: p.narrateQuotedText ?? false,
            narrateBoldedText: p.narrateBoldedText ?? false, narrateItalicizedText: p.narrateItalicizedText ?? false,
            stripThinkTokens: p.stripThinkTokens ?? true,
            enableWebSearch: p.enableWebSearch ?? 0, enableCalculator: p.enableCalculator ?? 0,
            enableMemoryWriting: p.enableMemoryWriting ?? 0, enableMemoryReading: p.enableMemoryReading ?? 0,
            inputStrategy: p.inputStrategy || ['System Prompt', 'Chat History', 'Context', 'Location'],
            summarizationSteps: (p.summarizationSteps || []).map(s => ({
                id: uuidv4(), strategyType: s.strategyType, enabled: s.enabled, order: s.order,
                slidingWindowSize: s.slidingWindowSize, compressionInterval: s.compressionInterval,
                compressionChunkSize: s.compressionChunkSize, recursiveChunkSize: s.recursiveChunkSize,
                recursiveMaxDepth: s.recursiveMaxDepth, maskingRelevanceThreshold: s.maskingRelevanceThreshold,
                maskingKeywordWeight: s.maskingKeywordWeight, summaryTokenBudget: s.summaryTokenBudget,
                triggerTokenThreshold: s.triggerTokenThreshold,
                firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
            })),
            firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
        };
    }

    return { characters, contexts, locations, profile };
}

function buildProfileFromGenerated(p: GeneratedProfile): Profile {
    const now = Date.now();
    return {
        id: uuidv4(), name: p.name, description: p.description || undefined,
        forceNameReveal: p.forceNameReveal ?? false,
        enableCharacterExpression: p.enableCharacterExpression ?? false,
        forceNoCharacterImageInjection: p.forceNoCharacterImageInjection ?? false,
        forceNoContextImageInjection: p.forceNoContextImageInjection ?? false,
        useCurrentDateAndTime: p.useCurrentDateAndTime ?? false,
        useWeather: p.useWeather ?? false, useTimeElapsed: p.useTimeElapsed ?? false,
        numberOfMessagesToDisableThinkPrompt: p.numberOfMessagesToDisableThinkPrompt ?? 0,
        numberOfMessagesToDisableMetaThinkInstructions: p.numberOfMessagesToDisableMetaThinkInstructions ?? 0,
        numberOfMessagesToDisableDialoguePrompt: p.numberOfMessagesToDisableDialoguePrompt ?? 0,
        forceEqualInitiative: p.forceEqualInitiative ?? false,
        chatProbability: p.chatProbability ?? 0.8, maximumChatStamina: p.maximumChatStamina ?? 5,
        nameSensitivity: p.nameSensitivity ?? 0.3, chatImpatienceSensitivity: p.chatImpatienceSensitivity ?? 0.2,
        skipProbability: p.skipProbability ?? 0.1, memoryRetentionWeight: p.memoryRetentionWeight ?? 0.5,
        contextSensitivity: p.contextSensitivity ?? 0.5,
        cacheInvalidationReductionLevel: p.cacheInvalidationReductionLevel ?? 0,
        narrateNormalText: p.narrateNormalText ?? true, narrateQuotedText: p.narrateQuotedText ?? false,
        narrateBoldedText: p.narrateBoldedText ?? false, narrateItalicizedText: p.narrateItalicizedText ?? false,
        stripThinkTokens: p.stripThinkTokens ?? true,
        enableWebSearch: p.enableWebSearch ?? 0, enableCalculator: p.enableCalculator ?? 0,
        enableMemoryWriting: p.enableMemoryWriting ?? 0, enableMemoryReading: p.enableMemoryReading ?? 0,
        inputStrategy: p.inputStrategy || ['System Prompt', 'Chat History', 'Context', 'Location'],
        summarizationSteps: (p.summarizationSteps || []).map(s => ({
            id: uuidv4(), strategyType: s.strategyType, enabled: s.enabled, order: s.order,
            slidingWindowSize: s.slidingWindowSize, compressionInterval: s.compressionInterval,
            compressionChunkSize: s.compressionChunkSize, recursiveChunkSize: s.recursiveChunkSize,
            recursiveMaxDepth: s.recursiveMaxDepth, maskingRelevanceThreshold: s.maskingRelevanceThreshold,
            maskingKeywordWeight: s.maskingKeywordWeight, summaryTokenBudget: s.summaryTokenBudget,
            triggerTokenThreshold: s.triggerTokenThreshold,
            firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
        })),
        firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
    };
}

interface AIRecommendationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaveCharacter: (char: Character) => Promise<boolean>;
    onSaveContext: (ctx: Context) => Promise<boolean>;
    onSaveLocation: (loc: Location) => Promise<boolean>;
    onSaveProfile: (profile: Profile) => Promise<boolean>;
    onSaveWorld: (world: World) => Promise<boolean>;
    allSamplers: Sampler[];
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    selectedModel: LanguageModel | null;
    runningModels: Record<string, { isRunning?: boolean; port?: number }>;
}

export function AIRecommendationModal({
    isOpen, onClose, onSaveCharacter, onSaveContext, onSaveLocation, onSaveProfile, onSaveWorld,
    allSamplers, allCharacters, allContexts, allLocations, selectedModel, runningModels,
}: AIRecommendationModalProps) {
    const [selectedEntities, setSelectedEntities] = useState<EntityType[]>(['Character']);
    const [userPrompt, setUserPrompt] = useState('');
    const [maxTokens, setMaxTokens] = useState<number>(2048);
    const [error, setError] = useState<string | null>(null);
    const [showSchemaPreview, setShowSchemaPreview] = useState(false);
    const [schemaCopied, setSchemaCopied] = useState(false);

    const [injectCharacterImages, setInjectCharacterImages] = useState(true);
    const [injectContextImages, setInjectContextImages] = useState(true);
    const [injectLocationImages, setInjectLocationImages] = useState(true);

    const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
    const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
    const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
    const [charSearch, setCharSearch] = useState('');
    const [ctxSearch, setCtxSearch] = useState('');
    const [locSearch, setLocSearch] = useState('');

    const [referenceImages, setReferenceImages] = useState<File[]>([]);
    const [referenceImagePreviews, setReferenceImagePreviews] = useState<string[]>([]);
    const [isUploadingImages, setIsUploadingImages] = useState(false);
    const imageInputRef = useRef<HTMLInputElement>(null);

    const [isResultOpen, setIsResultOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [parsedOutput, setParsedOutput] = useState<GeneratedOutput | null>(null);
    const [activeTab, setActiveTab] = useState<ViewTab>('raw');
    const [resultError, setResultError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Compute effective schema entities: World absorbs co-selected individual types
    const effectiveSchemaEntities = useMemo(() => getEffectiveSchemaEntities(selectedEntities), [selectedEntities]);

    const resetForm = useCallback(() => {
        setError(null); setUserPrompt(''); setMaxTokens(2048);
        setShowSchemaPreview(false); setSchemaCopied(false);
        setInjectCharacterImages(true); setInjectContextImages(true); setInjectLocationImages(true);
        setSelectedCharacterIds([]); setSelectedContextIds([]); setSelectedLocationIds([]);
        setCharSearch(''); setCtxSearch(''); setLocSearch('');
        setReferenceImages([]);
        setReferenceImagePreviews(prev => { prev.forEach(p => { if (!p.startsWith('data:image')) URL.revokeObjectURL(p); }); return []; });
    }, []);

    const resetResult = useCallback(() => {
        setStreamingText(''); setParsedOutput(null); setResultError(null);
        setIsGenerating(false); setIsSaving(false); setActiveTab('raw');
    }, []);

    const handleCloseForm = useCallback(() => {
        if (isGenerating) abortControllerRef.current?.abort();
        resetForm(); resetResult(); setIsResultOpen(false); onClose();
    }, [isGenerating, resetForm, resetResult, onClose]);

    const handleCloseResult = useCallback(() => {
        if (isGenerating) abortControllerRef.current?.abort();
        resetResult(); setIsResultOpen(false);
    }, [isGenerating, resetResult]);

    const handleStopGeneration = useCallback(() => {
        abortControllerRef.current?.abort(); abortControllerRef.current = null;
        setIsGenerating(false);
        if (streamingText.trim()) {
            const parsed = tryParseGeneratedOutput(streamingText);
            setParsedOutput(parsed);
            if (!parsed) setResultError('Stopped. Output was not valid JSON.');
        }
    }, [streamingText]);

    const toggleEntity = (type: EntityType) => {
        setSelectedEntities(prev => prev.includes(type) ? prev.filter(e => e !== type) : [...prev, type]);
    };

    const toggleInOrderedList = (ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const handleReferenceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            const files = Array.from(e.target.files);
            setReferenceImages(prev => [...prev, ...files]);
            setReferenceImagePreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
        }
        e.target.value = '';
    };

    const handleRemoveReferenceImage = (index: number) => {
        setReferenceImages(prev => prev.filter((_, i) => i !== index));
        if (!referenceImagePreviews[index].startsWith('data:image')) URL.revokeObjectURL(referenceImagePreviews[index]);
        setReferenceImagePreviews(prev => prev.filter((_, i) => i !== index));
    };

    const handleCopySchema = useCallback(() => {
        const schema = buildJsonSchema(effectiveSchemaEntities);
        navigator.clipboard.writeText(schema).then(() => {
            setSchemaCopied(true);
            setTimeout(() => setSchemaCopied(false), 2000);
        }).catch(() => {
            setError('Failed to copy. Manually select and copy the schema text.');
        });
    }, [effectiveSchemaEntities]);

    const buildExistingReferenceBlock = (): string => {
        const parts: string[] = [];
        if (selectedCharacterIds.length > 0) {
            parts.push('EXISTING CHARACTERS (use these IDs in characterBindings and characterWeights):');
            selectedCharacterIds.forEach((id, i) => {
                const c = allCharacters.find(ch => ch.id === id);
                if (!c) return;
                parts.push(`${i + 1}. ID: ${c.id} | Name: ${c.name}${c.description ? ` | Description: ${c.description.substring(0, 200)}` : ''}`);
            });
            parts.push('');
        }
        if (selectedContextIds.length > 0) {
            parts.push('EXISTING CONTEXTS:');
            selectedContextIds.forEach((id, i) => {
                const ctx = allContexts.find(c => c.id === id);
                if (!ctx) return;
                parts.push(`${i + 1}. ID: ${ctx.id} | Name: ${ctx.name}${ctx.text ? ` | Content: ${ctx.text.substring(0, 200)}` : ''}`);
            });
            parts.push('');
        }
        if (selectedLocationIds.length > 0) {
            parts.push('EXISTING LOCATIONS (use these IDs in locationBindings and locationBindingRegularExpressionTriggers):');
            selectedLocationIds.forEach((id, i) => {
                const loc = allLocations.find(l => l.id === id);
                if (!loc) return;
                parts.push(`${i + 1}. ID: ${loc.id} | Name: ${loc.name}${loc.text ? ` | Content: ${loc.text.substring(0, 200)}` : ''}`);
            });
            parts.push('');
        }
        return parts.join('\n');
    };

    const buildSystemPrompt = (): string => {
        const parts: string[] = [];
        const hasWorld = selectedEntities.includes('World');
        parts.push('You are a creative writing assistant for roleplay. Generate exactly ONE of each requested entity type.');
        parts.push('You MUST output ONLY valid JSON matching the schema below. No markdown, no commentary, no code fences.');
        parts.push('Use {{user}} to refer to the user. Use {{char}} instead of character names in prompts.');
        if (hasWorld) {
            parts.push('For World generation: you may use EITHER entity names OR entity IDs in characterBindings, locationBindings, characterWeights, and locationBindingRegularExpressionTriggers. Existing entity IDs are provided in the reference section above. Newly generated entities within the same world should use names for cross-reference (the system resolves them to IDs automatically). Mixing is allowed.');
            parts.push('Generate ALL sub-entities (characters, contexts, locations, profile) INSIDE the "world" object. Do NOT output them as separate top-level keys.');
        }
        parts.push('');
        const existingBlock = buildExistingReferenceBlock();
        if (existingBlock) parts.push(existingBlock);
        parts.push('OUTPUT JSON SCHEMA:');
        parts.push(buildJsonSchema(effectiveSchemaEntities));
        parts.push('');
        parts.push('Fill all required fields. Omit optional fields if not applicable. Regex patterns should be valid JavaScript RegExp without delimiters or flags.');
        return parts.join('\n');
    };

    const handleGenerate = async () => {
        if (selectedEntities.length === 0) { setError('Select at least one entity type.'); return; }
        if (!selectedModel) { setError('No model selected.'); return; }

        const port = selectedModel.id ? runningModels[selectedModel.id]?.port : undefined;
        const runtimePort = (selectedModel.parameters && typeof selectedModel.parameters === 'object' && '_runtimePort' in selectedModel.parameters)
            ? (selectedModel.parameters as Record<string, number>)._runtimePort : undefined;
        const effectivePort = port || runtimePort;
        if (!effectivePort && !selectedModel.apiKey) { setError('Model not loaded and has no API key.'); return; }

        let imageDescriptions = '';
        const hasReferenceImages = referenceImages.length > 0;

        if (hasReferenceImages) {
            setIsUploadingImages(true);
            const descriptions = referenceImages.map((f, i) => `[Reference Image ${i + 1}: ${f.name}]`);
            imageDescriptions = `\nREFERENCE IMAGES (highest priority — use these as primary visual reference):\n${descriptions.join('\n')}\n`;
            setIsUploadingImages(false);
        }

        const injectionNotes: string[] = [];
        if (hasReferenceImages) {
            injectionNotes.push('- Reference images take HIGHEST priority. When reference images are provided, they override entity-specific images for visual context.');
        }
        if (injectCharacterImages) {
            injectionNotes.push('- Character images: ENABLED. Include character portrait/appearance details in descriptions.');
        } else {
            injectionNotes.push('- Character images: DISABLED. Do NOT generate or reference character portraits.');
        }
        if (injectContextImages) {
            injectionNotes.push('- Context images: ENABLED. Include relevant visual context in descriptions.');
        } else {
            injectionNotes.push('- Context images: DISABLED. Do NOT generate or reference context images.');
        }
        if (injectLocationImages) {
            injectionNotes.push('- Location images: ENABLED. Include location scenery/atmosphere visuals in descriptions.');
        } else {
            injectionNotes.push('- Location images: DISABLED. Do NOT generate or reference location images.');
        }

        const injectionBlock = injectionNotes.length > 0
            ? `\nIMAGE INJECTION PRIORITY (highest to lowest: Reference > Character > Context > Location):\n${injectionNotes.join('\n')}\n`
            : '';

        setError(null); resetResult(); setIsResultOpen(true); setIsGenerating(true);
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;

        try {
            const systemPrompt = buildSystemPrompt();
            const userRequestPart = userPrompt.trim()
                ? `\n\nUser Request: ${userPrompt.trim()}`
                : '\n\nUser Request: Generate freely based on the schema and references above.';
            const fullPrompt = `${systemPrompt}${userRequestPart}${imageDescriptions}${injectionBlock}`;

            const modelContext = {
                apiKey: selectedModel.apiKey, backend: selectedModel.backend,
                modelPath: (selectedModel.model || selectedModel.parameters?.modelPath) as string | undefined,
                runtimePort: effectivePort,
            };

            let accumulated = '';
            const result = await recommendationEngine.generateStream(
                { prompt: fullPrompt, n_predict: maxTokens, temperature: 0.7, top_p: 0.9, stream: true },
                ctrl,
                { onToken: (stats) => { accumulated = stats.fullText; setStreamingText(stats.fullText); const p = tryParseGeneratedOutput(stats.fullText); if (p) setParsedOutput(p); } },
                modelContext, 0, undefined,
            );

            const finalText = result.text || accumulated;
            setStreamingText(finalText);
            const parsed = tryParseGeneratedOutput(finalText);
            setParsedOutput(parsed);
            if (!parsed) setResultError('AI response was not valid JSON. Try regenerating.');
            else if (!finalText.trim()) setResultError('AI returned empty response.');
        } catch (err) {
            if ((err as Error).name !== 'AbortError') setResultError(`Generation failed: ${(err as Error).message}`);
        } finally { setIsGenerating(false); abortControllerRef.current = null; }
    };

    const handleSave = async () => {
        if (!parsedOutput) { setResultError('No parsed output to save.'); return; }
        setIsSaving(true); setResultError(null);
        const now = Date.now();

        try {
            if (parsedOutput.character) {
                const c = parsedOutput.character;
                const char: Character = {
                    id: uuidv4(), name: c.name, description: c.description || '',
                    systemPrompt: c.systemPrompt || '', thinkPrompt: c.thinkPrompt || undefined,
                    appearancePrompt: c.appearancePrompt || undefined, dialoguePrompt: c.dialoguePrompt || undefined,
                    images: {}, sampler: allSamplers.length > 0 ? allSamplers[0] : undefined,
                    initiativeWeight: c.initiativeWeight ?? 5, chatProbability: c.chatProbability ?? 0.8,
                    maximumChatStamina: c.maximumChatStamina ?? 5, nameSensitivity: c.nameSensitivity ?? 0.3,
                    chatImpatienceSensitivity: c.chatImpatienceSensitivity ?? 0.2,
                    skipProbability: c.skipProbability ?? 0.1, memoryRetentionWeight: c.memoryRetentionWeight ?? 0.5,
                    contextSensitivity: c.contextSensitivity ?? 0.5,
                    doNotInjectCharacterImage: !injectCharacterImages,
                    numberOfMessagesToDisableThinkPrompt: c.numberOfMessagesToDisableThinkPrompt ?? 0,
                    numberOfMessagesToDisableMetaThinkInstructions: c.numberOfMessagesToDisableMetaThinkInstructions ?? 0,
                    numberOfMessagesToDisableDialoguePrompt: c.numberOfMessagesToDisableDialoguePrompt ?? 0,
                    enableWebSearch: c.enableWebSearch ?? false, enableCalculator: c.enableCalculator ?? false,
                    enableMemoryWriting: c.enableMemoryWriting ?? false, enableMemoryReading: c.enableMemoryReading ?? false,
                    memories: {}, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveCharacter(char)) throw new Error('Failed to save character.');
            }
            if (parsedOutput.context) {
                const c = parsedOutput.context;
                const ctx: Context = {
                    id: uuidv4(), name: c.name, description: c.description || undefined,
                    text: c.text || '', searchTerms: c.searchTerms || undefined,
                    urls: c.urls || undefined, includeLinkImages: injectContextImages ? (c.includeLinkImages ?? false) : false,
                    maximumLinkDepth: c.maximumLinkDepth ?? 1, linkFetchMode: c.linkFetchMode ?? 'summary',
                    limitLinksToSubdirectory: c.limitLinksToSubdirectory ?? false,
                    fetchCacheTimeToLiveMs: c.fetchCacheTimeToLiveMs || undefined,
                    regularExpressionActivationTrigger: c.regularExpressionActivationTrigger || undefined,
                    regularExpressionDeactivationTrigger: c.regularExpressionDeactivationTrigger || undefined,
                    regularExpressionContext: c.regularExpressionContext ?? 'global',
                    regularExpressionTarget: c.regularExpressionTarget ?? 'everyone',
                    tokenBudget: c.tokenBudget ?? 512, maximumRecursionDepth: c.maximumRecursionDepth ?? 1,
                    insertionDepth: c.insertionDepth ?? 0,
                    characterBindings: c.characterBindings || [], useBase64Encoding: c.useBase64Encoding ?? false,
                    firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveContext(ctx)) throw new Error('Failed to save context.');
            }
            if (parsedOutput.location) {
                const l = parsedOutput.location;
                const loc: Location = {
                    id: uuidv4(), name: l.name, description: l.description || undefined,
                    text: l.text || '',
                    regularExpressionActivationTrigger: l.regularExpressionActivationTrigger || undefined,
                    locationBindings: l.locationBindings || [],
                    locationBindingRegularExpressionTriggers: l.locationBindingRegularExpressionTriggers || undefined,
                    characterBindings: l.characterBindings || [], globalWeight: l.globalWeight ?? 1,
                    characterWeights: l.characterWeights || {}, useBase64Encoding: l.useBase64Encoding ?? false,
                    firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveLocation(loc)) throw new Error('Failed to save location.');
            }
            if (parsedOutput.profile) {
                const profile = buildProfileFromGenerated(parsedOutput.profile);
                profile.forceNoCharacterImageInjection = !injectCharacterImages;
                profile.forceNoContextImageInjection = !injectContextImages;
                if (!await onSaveProfile(profile)) throw new Error('Failed to save profile.');
            }

            if (parsedOutput.world) {
                const resolved = resolveWorldCrossReferences(parsedOutput.world);

                if (!injectCharacterImages) {
                    resolved.characters.forEach(c => { c.doNotInjectCharacterImage = true; });
                }
                if (resolved.profile) {
                    resolved.profile.forceNoCharacterImageInjection = !injectCharacterImages;
                    resolved.profile.forceNoContextImageInjection = !injectContextImages;
                }

                for (const char of resolved.characters) {
                    if (!await onSaveCharacter(char)) throw new Error(`Failed to save character "${char.name}".`);
                }
                for (const ctx of resolved.contexts) {
                    if (!await onSaveContext(ctx)) throw new Error(`Failed to save context "${ctx.name}".`);
                }
                for (const loc of resolved.locations) {
                    if (!await onSaveLocation(loc)) throw new Error(`Failed to save location "${loc.name}".`);
                }
                if (resolved.profile) {
                    if (!await onSaveProfile(resolved.profile)) throw new Error(`Failed to save profile "${resolved.profile.name}".`);
                }

                const world: World = {
                    id: uuidv4(), name: parsedOutput.world.name,
                    description: parsedOutput.world.description || undefined,
                    characterIds: resolved.characters.map(c => c.id),
                    contextIds: resolved.contexts.map(c => c.id),
                    locationIds: resolved.locations.map(l => l.id),
                    profileId: resolved.profile?.id,
                    firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveWorld(world)) throw new Error('Failed to save world.');
            }

            resetResult(); setIsResultOpen(false);
        } catch (err) { setResultError((err as Error).message); }
        finally { setIsSaving(false); }
    };

    if (!isOpen) return null;

    const hasCharacter = !!parsedOutput?.character;
    const hasContext = !!parsedOutput?.context;
    const hasLocation = !!parsedOutput?.location;
    const hasProfile = !!parsedOutput?.profile;
    const hasWorld = !!parsedOutput?.world;
    const hasAnyParsed = hasCharacter || hasContext || hasLocation || hasProfile || hasWorld;
    const hasOutput = streamingText.trim().length > 0;

    const availableTabs: ViewTab[] = ['raw'];
    if (hasCharacter) availableTabs.push('Character');
    if (hasContext) availableTabs.push('Context');
    if (hasLocation) availableTabs.push('Location');
    if (hasProfile) availableTabs.push('Profile');
    if (hasWorld) availableTabs.push('World');
    const effectiveTab = availableTabs.includes(activeTab) ? activeTab : 'raw';

    return (
        <>
            {/* FORM MODAL */}
            <div className="modal-overlay" onClick={handleCloseForm}>
                <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>Get AI Recommendation</h2>
                        <div className="editor-modal-actions">
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleCloseForm} disabled={isGenerating || isUploadingImages}>Cancel</button>
                        </div>
                    </div>
                    <div className="modal-body editor-modal-body">
                        <div className="editor-section">
                            <span className="editor-section-title">Generate</span>
                            <div className="entity-type-buttons">
                                {ENTITY_OPTIONS.map(opt => (
                                    <button key={opt.type} type="button" onClick={() => toggleEntity(opt.type)}
                                        className={`editor-btn ${selectedEntities.includes(opt.type) ? 'editor-btn-save' : 'editor-btn-cancel'} entity-type-btn`}>
                                        {opt.icon} {opt.label}
                                    </button>
                                ))}
                            </div>
                            <div className="entity-type-hint">
                                Select entity types. When World is selected alongside other types, they are generated as part of the world (not separately).
                            </div>
                            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}>
                                <button
                                    type="button"
                                    className={`editor-btn ${showSchemaPreview ? 'editor-btn-save' : 'editor-btn-cancel'}`}
                                    onClick={() => setShowSchemaPreview(!showSchemaPreview)}
                                    style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}
                                >
                                    {showSchemaPreview ? '🔽 Hide JSON Schema' : '📋 Show JSON Schema'}
                                </button>
                            </div>
                            {showSchemaPreview && (
                                <div style={{ marginTop: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>Copy this schema to use with external AI tools (ChatGPT, Claude, etc.)</span>
                                        <button
                                            type="button"
                                            className="editor-btn editor-btn-cancel"
                                            onClick={handleCopySchema}
                                            style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px' }}
                                        >
                                            {schemaCopied ? '✅ Copied!' : '📋 Copy'}
                                        </button>
                                    </div>
                                    <pre style={{
                                        background: 'var(--social-bg)',
                                        border: '1px solid var(--border)',
                                        borderRadius: '6px',
                                        padding: '10px',
                                        fontSize: '0.65rem',
                                        fontFamily: 'monospace',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        maxHeight: '300px',
                                        overflowY: 'auto',
                                        color: 'var(--text-h)',
                                        margin: 0,
                                    }}>{buildJsonSchema(effectiveSchemaEntities)}</pre>
                                </div>
                            )}
                        </div>

                        <div className="editor-section">
                            <span className="editor-section-title">Reference Existing Entities (Optional)</span>
                            <div className="entity-ref-hint">Select existing entities for consistency or integration into generated worlds. The AI receives their IDs for cross-referencing.</div>
                            <EntitySelectList label="Characters" items={allCharacters} selectedIds={selectedCharacterIds}
                                onToggle={(id) => toggleInOrderedList(selectedCharacterIds, setSelectedCharacterIds, id)} searchQuery={charSearch} onSearchChange={setCharSearch} />
                            <EntitySelectList label="Contexts" items={allContexts} selectedIds={selectedContextIds}
                                onToggle={(id) => toggleInOrderedList(selectedContextIds, setSelectedContextIds, id)} searchQuery={ctxSearch} onSearchChange={setCtxSearch} />
                            <EntitySelectList label="Locations" items={allLocations} selectedIds={selectedLocationIds}
                                onToggle={(id) => toggleInOrderedList(selectedLocationIds, setSelectedLocationIds, id)} searchQuery={locSearch} onSearchChange={setLocSearch} />
                        </div>

                        <div className="editor-section">
                            <label className="editor-label">Describe what you want <span className="optional-label">(optional)</span></label>
                            <textarea value={userPrompt} onChange={e => setUserPrompt(e.target.value)} className="editor-textarea"
                                placeholder={selectedEntities.includes('World') ? "e.g., A haunted Victorian mansion with 5 NPCs, interconnected rooms, hidden passages..." : "Leave empty for free generation..."} rows={3} />
                        </div>

                        <div className="editor-section">
                            <span className="editor-section-title">Reference Images <span className="optional-label">(optional)</span></span>
                            <div className="entity-ref-hint">Upload images as visual reference. These take highest priority over entity-specific images.</div>
                            <div className="editor-image-grid">
                                {referenceImagePreviews.map((preview, index) => (
                                    <div key={preview} className="editor-image-square active">
                                        <img src={preview} alt={`Ref ${index + 1}`} />
                                        <button type="button" onClick={() => handleRemoveReferenceImage(index)} className="editor-image-remove-btn">×</button>
                                    </div>
                                ))}
                                <div className={`editor-image-square editor-upload-square ${isUploadingImages ? 'disabled' : ''}`} onClick={() => !isUploadingImages && imageInputRef.current?.click()}>
                                    <div className="context-image-placeholder">
                                        <div className="context-image-placeholder-icon">{isUploadingImages ? '⏳' : '📷'}</div>
                                        <div className="context-image-placeholder-text">{isUploadingImages ? 'Processing...' : 'Upload'}</div>
                                    </div>
                                </div>
                            </div>
                            <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={handleReferenceImageChange} disabled={isUploadingImages} />
                        </div>

                        <div className="editor-section">
                            <span className="editor-section-title">Image Injection</span>
                            <div className="entity-ref-hint">Control which entity images are included. Priority: Reference Images &gt; Character &gt; Context &gt; Location.</div>
                            <label className="editor-checkbox-label">
                                <input type="checkbox" checked={injectCharacterImages} onChange={e => setInjectCharacterImages(e.target.checked)} className="editor-checkbox-input" />
                                <span>🎭 Inject Character Images</span>
                            </label>
                            <label className="editor-checkbox-label">
                                <input type="checkbox" checked={injectContextImages} onChange={e => setInjectContextImages(e.target.checked)} className="editor-checkbox-input" />
                                <span>📜 Inject Context Images</span>
                            </label>
                            <label className="editor-checkbox-label">
                                <input type="checkbox" checked={injectLocationImages} onChange={e => setInjectLocationImages(e.target.checked)} className="editor-checkbox-input" />
                                <span>📍 Inject Location Images</span>
                            </label>
                        </div>

                        <div className="editor-section">
                            <label className="editor-label editor-label-small">Max Tokens to Generate</label>
                            <input
                                type="number"
                                className="editor-input context-input-small"
                                min={256}
                                max={16384}
                                step={256}
                                value={maxTokens}
                                onChange={e => setMaxTokens(Math.max(256, Math.min(16384, Number(e.target.value) || 2048)))}
                            />
                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                Default: 2048. Increase for larger worlds or more detailed entities. Range: 256–16384.
                            </div>
                        </div>

                        <button type="button" className="editor-btn editor-btn-save entity-generate-btn"
                            onClick={handleGenerate} disabled={selectedEntities.length === 0 || isUploadingImages}>
                            ✨ Generate Recommendation
                        </button>
                        {error && <div className="editor-error-message editor-error-centered entity-error-below">{error}</div>}
                    </div>
                </div>
            </div>

            {/* RESULT MODAL */}
            {isResultOpen && (
                <div className="modal-overlay" style={{ zIndex: 1001 }} onClick={handleCloseResult}>
                    <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Recommendation Result</h2>
                            <div className="editor-modal-actions">
                                <button type="button" className="editor-btn editor-btn-cancel" onClick={handleCloseResult} disabled={isGenerating || isSaving}>
                                    {hasOutput ? 'Back to Form' : 'Cancel'}
                                </button>
                            </div>
                        </div>
                        <div className="modal-body editor-modal-body">
                            {hasAnyParsed && (
                                <div className="entity-tab-bar">
                                    {availableTabs.map(tab => (
                                        <button key={tab} type="button" className={`entity-tab-btn ${effectiveTab === tab ? 'entity-tab-btn-active' : ''}`} onClick={() => setActiveTab(tab)}>
                                            {tab === 'raw' ? '📄 Raw JSON' : tab === 'Character' ? '🎭 Character' : tab === 'Context' ? '📜 Context' : tab === 'Location' ? '📍 Location' : tab === 'Profile' ? '👤 Profile' : '🌍 World'}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {effectiveTab === 'raw' && (
                                <div className="entity-raw-output"><pre className="entity-raw-pre">{streamingText || (isGenerating ? '⏳ Waiting...' : '')}</pre></div>
                            )}

                            {effectiveTab === 'Character' && parsedOutput?.character && (
                                <div className="entity-field-list">
                                    {Object.entries(parsedOutput.character).map(([key, val]) => val !== undefined && val !== null && (
                                        <div key={key} className="entity-field-block">
                                            <div className="entity-field-title">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</div>
                                            <div className="entity-field-content">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {effectiveTab === 'Context' && parsedOutput?.context && (
                                <div className="entity-field-list">
                                    {Object.entries(parsedOutput.context).map(([key, val]) => val !== undefined && val !== null && (
                                        <div key={key} className="entity-field-block">
                                            <div className="entity-field-title">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</div>
                                            <div className="entity-field-content">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {effectiveTab === 'Location' && parsedOutput?.location && (
                                <div className="entity-field-list">
                                    {Object.entries(parsedOutput.location).map(([key, val]) => val !== undefined && val !== null && (
                                        <div key={key} className="entity-field-block">
                                            <div className="entity-field-title">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</div>
                                            <div className="entity-field-content">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {effectiveTab === 'Profile' && parsedOutput?.profile && (
                                <div className="entity-field-list">
                                    {Object.entries(parsedOutput.profile).map(([key, val]) => val !== undefined && val !== null && (
                                        <div key={key} className="entity-field-block">
                                            <div className="entity-field-title">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</div>
                                            <div className="entity-field-content">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {effectiveTab === 'World' && parsedOutput?.world && (
                                <div className="entity-field-list">
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Name</div>
                                        <div className="entity-field-content">{parsedOutput.world.name}</div>
                                    </div>
                                    {parsedOutput.world.description && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Description</div>
                                            <div className="entity-field-content">{parsedOutput.world.description}</div>
                                        </div>
                                    )}
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Characters ({parsedOutput.world.characters.length})</div>
                                        <div className="entity-field-content">{parsedOutput.world.characters.map(c => c.name).join(', ')}</div>
                                    </div>
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Contexts ({parsedOutput.world.contexts?.length || 0})</div>
                                        <div className="entity-field-content">{(parsedOutput.world.contexts || []).map(c => c.name).join(', ') || 'None'}</div>
                                    </div>
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Locations ({parsedOutput.world.locations?.length || 0})</div>
                                        <div className="entity-field-content">{(parsedOutput.world.locations || []).map(l => l.name).join(', ') || 'None'}</div>
                                    </div>
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Profile</div>
                                        <div className="entity-field-content">{parsedOutput.world.profile?.name || 'None'}</div>
                                    </div>
                                </div>
                            )}

                            <div className="entity-action-buttons">
                                {isGenerating ? (
                                    <button type="button" className="editor-btn editor-btn-cancel" onClick={handleStopGeneration} style={{ flex: 1 }}>⏹ Stop Generation</button>
                                ) : (
                                    <>
                                        <button type="button" className="editor-btn editor-btn-cancel" onClick={resetResult} disabled={isSaving} style={{ flex: 1 }}>Regenerate</button>
                                        {hasAnyParsed && (
                                            <button type="button" className="editor-btn editor-btn-save" onClick={handleSave} disabled={isSaving} style={{ flex: 1 }}>
                                                {isSaving ? 'Saving...' : hasWorld ? '💾 Save World + All Entities' : '💾 Save All'}
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                            {resultError && <div className="editor-error-message editor-error-centered entity-error-below">{resultError}</div>}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}