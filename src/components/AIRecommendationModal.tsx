// src/components/AIRecommendationModal.tsx
import type React from 'react';
import { useState, useRef, useCallback, useMemo } from 'react';
import type { Character, Context, Location, Sampler, LanguageModel, Profile, World, PromptBlockType, SummarizationStrategyType } from '../types';
import { EntitySelectList } from './EntitySelectList';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

type EntityType = 'Character' | 'Context' | 'Location' | 'Profile' | 'World';
type ViewTab = 'raw' | 'Character' | 'Context' | 'Location' | 'Profile' | 'World';

const IMAGE_PRIORITY_ITEMS = ['reference', 'character', 'context', 'location'] as const;
type ImagePriorityItem = typeof IMAGE_PRIORITY_ITEMS[number];

const IMAGE_LABELS: Record<ImagePriorityItem, string> = {
    reference: '📷 Reference Images',
    character: '🎭 Character Images',
    context: '📜 Context Images',
    location: '📍 Location Images',
};

const IMAGE_SHORT_LABELS: Record<ImagePriorityItem, string> = {
    reference: '📷 Reference',
    character: '🎭 Character',
    context: '📜 Context',
    location: '📍 Location',
};

const IMAGE_PROMPT_DESCRIPTIONS: Record<ImagePriorityItem, string> = {
    reference: 'Reference images (user-uploaded visual references)',
    character: 'Character portrait/appearance details',
    context: 'Context visual descriptions',
    location: 'Location scenery/atmosphere visuals',
};

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

interface JsonHistoryEntry {
    id: string;
    timestamp: number;
    jsonText: string;
    parsedOutput: GeneratedOutput;
    label: string;
    isEdited: boolean;
}

const ENTITY_OPTIONS: { type: EntityType; label: string; icon: string }[] = [
    { type: 'Character', label: 'Character', icon: '🎭' },
    { type: 'Context', label: 'Context', icon: '📜' },
    { type: 'Location', label: 'Location', icon: '📍' },
    { type: 'Profile', label: 'Profile', icon: '👤' },
    { type: 'World', label: 'World', icon: '🌍' },
];

const recommendationEngine = getLanguageModelEngine();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getEffectiveSchemaEntities(selectedEntities: EntityType[]): EntityType[] {
    if (selectedEntities.includes('World')) return ['World'];
    return selectedEntities;
}

function buildJsonSchema(effectiveEntities: EntityType[]): string {
    const parts: string[] = [];
    if (effectiveEntities.includes('Character')) {
        parts.push(`  "character": {
    "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "systemPrompt": "string", "thinkPrompt": "string",
    "appearancePrompt": "string", "dialoguePrompt": "string",
    "initiativeWeight": "number (0-10, default 5)", "chatProbability": "number (0-1, default 0.8)",
    "maximumChatStamina": "number (1-20, default 5)", "nameSensitivity": "number (0-1, default 0.3)",
    "chatImpatienceSensitivity": "number (0-1, default 0.2)", "skipProbability": "number (0-1, default 0.1)",
    "memoryRetentionWeight": "number (0-1, default 0.5)", "contextSensitivity": "number (0-1, default 0.5)",
    "doNotInjectCharacterImage": "boolean (default false)",
    "numberOfMessagesToDisableThinkPrompt": "number (default 0)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (default 0)",
    "numberOfMessagesToDisableDialoguePrompt": "number (default 0)",
    "enableWebSearch": "boolean (default false)", "enableCalculator": "boolean (default false)",
    "enableMemoryWriting": "boolean (default false)", "enableMemoryReading": "boolean (default false)"
  }`);
    }
    if (effectiveEntities.includes('Context')) {
        parts.push(`  "context": {
    "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "text": "string (required)",
    "searchTerms": ["string array"], "urls": ["string array"],
    "includeLinkImages": "boolean (default false)", "maximumLinkDepth": "number (default 1)",
    "linkFetchMode": "'full' | 'summary' | 'extract' (default 'summary')",
    "limitLinksToSubdirectory": "boolean (default false)", "fetchCacheTimeToLiveMs": "number",
    "regularExpressionActivationTrigger": "string (regex without delimiters)",
    "regularExpressionDeactivationTrigger": "string (regex without delimiters)",
    "regularExpressionContext": "'global' | 'local' | 'previous' (default 'global')",
    "regularExpressionTarget": "'everyone' | 'listener' | 'self' (default 'everyone')",
    "tokenBudget": "number (default 512)", "maximumRecursionDepth": "number (default 1)",
    "insertionDepth": "number (default 0)", "characterBindings": ["character name or ID strings"],
    "useBase64Encoding": "boolean (default false)"
  }`);
    }
    if (effectiveEntities.includes('Location')) {
        parts.push(`  "location": {
    "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "text": "string (required)",
    "regularExpressionActivationTrigger": "string (regex without delimiters)",
    "locationBindings": ["location name or ID strings"],
    "locationBindingRegularExpressionTriggers": {"location name or ID": "regex pattern"},
    "characterBindings": ["character name or ID strings"],
    "globalWeight": "number (0-10, default 1)", "characterWeights": {"character name or ID": weight},
    "useBase64Encoding": "boolean (default false)"
  }`);
    }
    if (effectiveEntities.includes('Profile')) {
        parts.push(`  "profile": {
    "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "forceNameReveal": "boolean (default false)", "enableCharacterExpression": "boolean (default false)",
    "forceNoCharacterImageInjection": "boolean (default false)", "forceNoContextImageInjection": "boolean (default false)",
    "useCurrentDateAndTime": "boolean (default false)", "useWeather": "boolean (default false)",
    "useTimeElapsed": "boolean (default false)",
    "numberOfMessagesToDisableThinkPrompt": "number (default 0)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (default 0)",
    "numberOfMessagesToDisableDialoguePrompt": "number (default 0)",
    "forceEqualInitiative": "boolean (default false)",
    "chatProbability": "number (0-1, default 0.8)", "maximumChatStamina": "number (1-20, default 5)",
    "nameSensitivity": "number (0-1, default 0.3)", "chatImpatienceSensitivity": "number (0-1, default 0.2)",
    "skipProbability": "number (0-1, default 0.1)", "memoryRetentionWeight": "number (0-1, default 0.5)",
    "contextSensitivity": "number (0-1, default 0.5)", "cacheInvalidationReductionLevel": "number (0-3, default 0)",
    "narrateNormalText": "boolean (default true)", "narrateQuotedText": "boolean (default false)",
    "narrateBoldedText": "boolean (default false)", "narrateItalicizedText": "boolean (default false)",
    "stripThinkTokens": "boolean (default true)",
    "enableWebSearch": "number (0 or 1, default 0)", "enableCalculator": "number (0 or 1, default 0)",
    "enableMemoryWriting": "number (0 or 1, default 0)", "enableMemoryReading": "number (0 or 1, default 0)",
    "inputStrategy": ["PromptBlockType array"],
    "summarizationSteps": [{"strategyType": "string", "enabled": true, "order": 0}]
  }`);
    }
    if (effectiveEntities.includes('World')) {
        parts.push(`  "world": {
    "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "characters": [/* character objects */], "contexts": [/* context objects */],
    "locations": [/* location objects */], "profile": {/* profile object, optional */}
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
        if (parsed.character && typeof parsed.character === 'object' && parsed.character.name) result.character = parsed.character;
        if (parsed.context && typeof parsed.context === 'object' && parsed.context.name && parsed.context.text) result.context = parsed.context;
        if (parsed.location && typeof parsed.location === 'object' && parsed.location.name && parsed.location.text) result.location = parsed.location;
        if (parsed.profile && typeof parsed.profile === 'object' && parsed.profile.name) result.profile = parsed.profile;
        if (parsed.world && typeof parsed.world === 'object' && parsed.world.name && Array.isArray(parsed.world.characters)) result.world = parsed.world;
        if (!result.character && !result.context && !result.location && !result.profile && !result.world) return null;
        return result;
    } catch { return null; }
}

function deriveHistoryLabel(output: GeneratedOutput): string {
    if (output.world) return `🌍 ${output.world.name}`;
    if (output.character) return `🎭 ${output.character.name}`;
    if (output.context) return `📜 ${output.context.name}`;
    if (output.location) return `📍 ${output.location.name}`;
    if (output.profile) return `👤 ${output.profile.name}`;
    return 'Unknown';
}

function generatedCharacterToEntity(c: GeneratedCharacter, samplers: Sampler[]): Character {
    const now = Date.now();
    return {
        id: uuidv4(), name: c.name, description: c.description || '',
        systemPrompt: c.systemPrompt || '', thinkPrompt: c.thinkPrompt || undefined,
        appearancePrompt: c.appearancePrompt || undefined, dialoguePrompt: c.dialoguePrompt || undefined,
        images: {}, sampler: samplers.length > 0 ? samplers[0] : undefined,
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
}

function characterEntityToGenerated(c: Character): GeneratedCharacter {
    return {
        name: c.name, description: c.description || undefined,
        systemPrompt: c.systemPrompt || undefined, thinkPrompt: c.thinkPrompt,
        appearancePrompt: c.appearancePrompt, dialoguePrompt: c.dialoguePrompt,
        initiativeWeight: c.initiativeWeight, chatProbability: c.chatProbability,
        maximumChatStamina: c.maximumChatStamina, nameSensitivity: c.nameSensitivity,
        chatImpatienceSensitivity: c.chatImpatienceSensitivity, skipProbability: c.skipProbability,
        memoryRetentionWeight: c.memoryRetentionWeight, contextSensitivity: c.contextSensitivity,
        doNotInjectCharacterImage: c.doNotInjectCharacterImage,
        numberOfMessagesToDisableThinkPrompt: c.numberOfMessagesToDisableThinkPrompt,
        numberOfMessagesToDisableMetaThinkInstructions: c.numberOfMessagesToDisableMetaThinkInstructions,
        numberOfMessagesToDisableDialoguePrompt: c.numberOfMessagesToDisableDialoguePrompt,
        enableWebSearch: c.enableWebSearch, enableCalculator: c.enableCalculator,
        enableMemoryWriting: c.enableMemoryWriting, enableMemoryReading: c.enableMemoryReading,
    };
}

function generatedContextToEntity(c: GeneratedContext): Context {
    const now = Date.now();
    return {
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
        characterBindings: c.characterBindings || [], useBase64Encoding: c.useBase64Encoding ?? false,
        firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
    };
}

function contextEntityToGenerated(c: Context): GeneratedContext {
    return {
        name: c.name, description: c.description, text: c.text,
        searchTerms: c.searchTerms, urls: c.urls, includeLinkImages: c.includeLinkImages,
        maximumLinkDepth: c.maximumLinkDepth, linkFetchMode: c.linkFetchMode,
        limitLinksToSubdirectory: c.limitLinksToSubdirectory, fetchCacheTimeToLiveMs: c.fetchCacheTimeToLiveMs,
        regularExpressionActivationTrigger: c.regularExpressionActivationTrigger,
        regularExpressionDeactivationTrigger: c.regularExpressionDeactivationTrigger,
        regularExpressionContext: c.regularExpressionContext, regularExpressionTarget: c.regularExpressionTarget,
        tokenBudget: c.tokenBudget, maximumRecursionDepth: c.maximumRecursionDepth,
        insertionDepth: c.insertionDepth, characterBindings: c.characterBindings,
        useBase64Encoding: c.useBase64Encoding,
    };
}

function generatedLocationToEntity(l: GeneratedLocation): Location {
    const now = Date.now();
    return {
        id: uuidv4(), name: l.name, description: l.description || undefined,
        text: l.text || '',
        regularExpressionActivationTrigger: l.regularExpressionActivationTrigger || undefined,
        locationBindings: l.locationBindings || [],
        locationBindingRegularExpressionTriggers: l.locationBindingRegularExpressionTriggers || undefined,
        characterBindings: l.characterBindings || [], globalWeight: l.globalWeight ?? 1,
        characterWeights: l.characterWeights || {}, useBase64Encoding: l.useBase64Encoding ?? false,
        firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
    };
}

function locationEntityToGenerated(l: Location): GeneratedLocation {
    return {
        name: l.name, description: l.description, text: l.text,
        regularExpressionActivationTrigger: l.regularExpressionActivationTrigger,
        locationBindings: l.locationBindings,
        locationBindingRegularExpressionTriggers: l.locationBindingRegularExpressionTriggers,
        characterBindings: l.characterBindings, globalWeight: l.globalWeight,
        characterWeights: l.characterWeights, useBase64Encoding: l.useBase64Encoding,
    };
}

function buildProfileFromGenerated(p: GeneratedProfile): Profile {
    const now = Date.now();
    return {
        id: uuidv4(), name: p.name, description: p.description || undefined,
        forceNameReveal: p.forceNameReveal ?? false, enableCharacterExpression: p.enableCharacterExpression ?? false,
        forceNoCharacterImageInjection: p.forceNoCharacterImageInjection ?? false,
        forceNoContextImageInjection: p.forceNoContextImageInjection ?? false,
        useCurrentDateAndTime: p.useCurrentDateAndTime ?? false, useWeather: p.useWeather ?? false,
        useTimeElapsed: p.useTimeElapsed ?? false,
        numberOfMessagesToDisableThinkPrompt: p.numberOfMessagesToDisableThinkPrompt ?? 0,
        numberOfMessagesToDisableMetaThinkInstructions: p.numberOfMessagesToDisableMetaThinkInstructions ?? 0,
        numberOfMessagesToDisableDialoguePrompt: p.numberOfMessagesToDisableDialoguePrompt ?? 0,
        forceEqualInitiative: p.forceEqualInitiative ?? false,
        chatProbability: p.chatProbability ?? 0.8, maximumChatStamina: p.maximumChatStamina ?? 5,
        nameSensitivity: p.nameSensitivity ?? 0.3, chatImpatienceSensitivity: p.chatImpatienceSensitivity ?? 0.2,
        skipProbability: p.skipProbability ?? 0.1, memoryRetentionWeight: p.memoryRetentionWeight ?? 0.5,
        contextSensitivity: p.contextSensitivity ?? 0.5, cacheInvalidationReductionLevel: p.cacheInvalidationReductionLevel ?? 0,
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

function profileEntityToGenerated(p: Profile): GeneratedProfile {
    return {
        name: p.name, description: p.description,
        forceNameReveal: p.forceNameReveal, enableCharacterExpression: p.enableCharacterExpression,
        forceNoCharacterImageInjection: p.forceNoCharacterImageInjection,
        forceNoContextImageInjection: p.forceNoContextImageInjection,
        useCurrentDateAndTime: p.useCurrentDateAndTime, useWeather: p.useWeather,
        useTimeElapsed: p.useTimeElapsed,
        numberOfMessagesToDisableThinkPrompt: p.numberOfMessagesToDisableThinkPrompt,
        numberOfMessagesToDisableMetaThinkInstructions: p.numberOfMessagesToDisableMetaThinkInstructions,
        numberOfMessagesToDisableDialoguePrompt: p.numberOfMessagesToDisableDialoguePrompt,
        forceEqualInitiative: p.forceEqualInitiative,
        chatProbability: p.chatProbability, maximumChatStamina: p.maximumChatStamina,
        nameSensitivity: p.nameSensitivity, chatImpatienceSensitivity: p.chatImpatienceSensitivity,
        skipProbability: p.skipProbability, memoryRetentionWeight: p.memoryRetentionWeight,
        contextSensitivity: p.contextSensitivity, cacheInvalidationReductionLevel: p.cacheInvalidationReductionLevel,
        narrateNormalText: p.narrateNormalText, narrateQuotedText: p.narrateQuotedText,
        narrateBoldedText: p.narrateBoldedText, narrateItalicizedText: p.narrateItalicizedText,
        stripThinkTokens: p.stripThinkTokens,
        enableWebSearch: p.enableWebSearch, enableCalculator: p.enableCalculator,
        enableMemoryWriting: p.enableMemoryWriting, enableMemoryReading: p.enableMemoryReading,
        inputStrategy: p.inputStrategy,
        summarizationSteps: p.summarizationSteps?.map(s => ({
            strategyType: s.strategyType, enabled: s.enabled, order: s.order,
            slidingWindowSize: s.slidingWindowSize, compressionInterval: s.compressionInterval,
            compressionChunkSize: s.compressionChunkSize, recursiveChunkSize: s.recursiveChunkSize,
            recursiveMaxDepth: s.recursiveMaxDepth, maskingRelevanceThreshold: s.maskingRelevanceThreshold,
            maskingKeywordWeight: s.maskingKeywordWeight, summaryTokenBudget: s.summaryTokenBudget,
            triggerTokenThreshold: s.triggerTokenThreshold,
        })),
    };
}

function resolveWorldCrossReferences(world: GeneratedWorldDefinition): { characters: Character[]; contexts: Context[]; locations: Location[]; profile?: Profile } {
    const now = Date.now();
    const charNameToId = new Map<string, string>();
    const characters: Character[] = world.characters.map(c => {
        const id = uuidv4(); charNameToId.set(c.name, id);
        return { id, name: c.name, description: c.description || '', systemPrompt: c.systemPrompt || '', thinkPrompt: c.thinkPrompt || undefined, appearancePrompt: c.appearancePrompt || undefined, dialoguePrompt: c.dialoguePrompt || undefined, images: {}, sampler: undefined, initiativeWeight: c.initiativeWeight ?? 5, chatProbability: c.chatProbability ?? 0.8, maximumChatStamina: c.maximumChatStamina ?? 5, nameSensitivity: c.nameSensitivity ?? 0.3, chatImpatienceSensitivity: c.chatImpatienceSensitivity ?? 0.2, skipProbability: c.skipProbability ?? 0.1, memoryRetentionWeight: c.memoryRetentionWeight ?? 0.5, contextSensitivity: c.contextSensitivity ?? 0.5, doNotInjectCharacterImage: c.doNotInjectCharacterImage ?? false, numberOfMessagesToDisableThinkPrompt: c.numberOfMessagesToDisableThinkPrompt ?? 0, numberOfMessagesToDisableMetaThinkInstructions: c.numberOfMessagesToDisableMetaThinkInstructions ?? 0, numberOfMessagesToDisableDialoguePrompt: c.numberOfMessagesToDisableDialoguePrompt ?? 0, enableWebSearch: c.enableWebSearch ?? false, enableCalculator: c.enableCalculator ?? false, enableMemoryWriting: c.enableMemoryWriting ?? false, enableMemoryReading: c.enableMemoryReading ?? false, memories: {}, firstCreatedTimestamp: now, lastUpdatedTimestamp: now };
    });
    const resolveCharRef = (ref: string): string | undefined => { if (charNameToId.has(ref)) return charNameToId.get(ref); if (UUID_REGEX.test(ref)) return ref; return undefined; };
    const contexts: Context[] = (world.contexts || []).map(c => ({ id: uuidv4(), name: c.name, description: c.description || undefined, text: c.text || '', searchTerms: c.searchTerms || undefined, urls: c.urls || undefined, includeLinkImages: c.includeLinkImages ?? false, maximumLinkDepth: c.maximumLinkDepth ?? 1, linkFetchMode: c.linkFetchMode ?? 'summary', limitLinksToSubdirectory: c.limitLinksToSubdirectory ?? false, fetchCacheTimeToLiveMs: c.fetchCacheTimeToLiveMs || undefined, regularExpressionActivationTrigger: c.regularExpressionActivationTrigger || undefined, regularExpressionDeactivationTrigger: c.regularExpressionDeactivationTrigger || undefined, regularExpressionContext: c.regularExpressionContext ?? 'global', regularExpressionTarget: c.regularExpressionTarget ?? 'everyone', tokenBudget: c.tokenBudget ?? 512, maximumRecursionDepth: c.maximumRecursionDepth ?? 1, insertionDepth: c.insertionDepth ?? 0, characterBindings: (c.characterBindings || []).map(resolveCharRef).filter((id): id is string => !!id), useBase64Encoding: c.useBase64Encoding ?? false, firstCreatedTimestamp: now, lastUpdatedTimestamp: now }));
    const locNameToId = new Map<string, string>();
    (world.locations || []).forEach(l => locNameToId.set(l.name, uuidv4()));
    const resolveLocRef = (ref: string): string | undefined => { if (locNameToId.has(ref)) return locNameToId.get(ref); if (UUID_REGEX.test(ref)) return ref; return undefined; };
    const locations: Location[] = (world.locations || []).map(l => {
        const id = locNameToId.get(l.name)!;
        const rlb = (l.locationBindings || []).map(resolveLocRef).filter((id): id is string => !!id);
        const rlrt: Record<string, string> = {};
        if (l.locationBindingRegularExpressionTriggers) for (const [ref, regex] of Object.entries(l.locationBindingRegularExpressionTriggers)) { const rid = resolveLocRef(ref); if (rid) rlrt[rid] = regex; }
        const rcb = (l.characterBindings || []).map(resolveCharRef).filter((id): id is string => !!id);
        const rcw: Record<string, number> = {};
        if (l.characterWeights) for (const [ref, w] of Object.entries(l.characterWeights)) { const rid = resolveCharRef(ref); if (rid) rcw[rid] = w; }
        return { id, name: l.name, description: l.description || undefined, text: l.text || '', regularExpressionActivationTrigger: l.regularExpressionActivationTrigger || undefined, locationBindings: rlb, locationBindingRegularExpressionTriggers: Object.keys(rlrt).length > 0 ? rlrt : undefined, characterBindings: rcb, globalWeight: l.globalWeight ?? 1, characterWeights: rcw, useBase64Encoding: l.useBase64Encoding ?? false, firstCreatedTimestamp: now, lastUpdatedTimestamp: now };
    });
    let profile: Profile | undefined;
    if (world.profile) profile = buildProfileFromGenerated(world.profile);
    return { characters, contexts, locations, profile };
}

interface AIRecommendationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaveCharacter: (char: Character) => Promise<boolean>;
    onSaveContext: (ctx: Context) => Promise<boolean>;
    onSaveLocation: (loc: Location) => Promise<boolean>;
    onSaveProfile: (profile: Profile) => Promise<boolean>;
    onSaveWorld: (world: World) => Promise<boolean>;
    onOpenCharacterEditor?: (char: Character | null, onApplyToRecommendation: (c: Character) => void) => void;
    onOpenContextEditor?: (ctx: Context | null, onApplyToRecommendation: (c: Context) => void) => void;
    onOpenLocationEditor?: (loc: Location | null, onApplyToRecommendation: (l: Location) => void) => void;
    onOpenProfileEditor?: (profile: Profile | null, onApplyToRecommendation: (p: Profile) => void) => void;
    allSamplers: Sampler[];
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    selectedModel: LanguageModel | null;
    runningModels: Record<string, { isRunning?: boolean; port?: number }>;
}

export function AIRecommendationModal({
    isOpen, onClose, onSaveCharacter, onSaveContext, onSaveLocation, onSaveProfile, onSaveWorld,
    onOpenCharacterEditor, onOpenContextEditor, onOpenLocationEditor, onOpenProfileEditor,
    allSamplers, allCharacters, allContexts, allLocations, selectedModel, runningModels,
}: AIRecommendationModalProps) {
    const [selectedEntities, setSelectedEntities] = useState<EntityType[]>(['Character']);
    const [userPrompt, setUserPrompt] = useState('');
    const [maxTokens, setMaxTokens] = useState(2048);
    const [error, setError] = useState<string | null>(null);
    const [showSchemaPreview, setShowSchemaPreview] = useState(false);
    const [schemaCopied, setSchemaCopied] = useState(false);
    const [imageInjectionPriority, setImageInjectionPriority] = useState<ImagePriorityItem[]>(['reference', 'character', 'context', 'location']);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [jsonHistory, setJsonHistory] = useState<JsonHistoryEntry[]>([]);
    const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
    const [editingJsonText, setEditingJsonText] = useState('');
    const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
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

    const effectiveSchemaEntities = useMemo(() => getEffectiveSchemaEntities(selectedEntities), [selectedEntities]);
    const injectCharacterImages = imageInjectionPriority.includes('character');
    const injectContextImages = imageInjectionPriority.includes('context');
    const injectLocationImages = imageInjectionPriority.includes('location');

    const resetForm = useCallback(() => {
        setError(null); setUserPrompt(''); setMaxTokens(2048);
        setShowSchemaPreview(false); setSchemaCopied(false);
        setImageInjectionPriority(['reference', 'character', 'context', 'location']);
        setDragIndex(null); setDragOverIndex(null);
        setJsonHistory([]); setEditingHistoryId(null); setEditingJsonText(''); setExpandedHistoryId(null);
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
        if (streamingText.trim()) { const p = tryParseGeneratedOutput(streamingText); setParsedOutput(p); if (!p) setResultError('Stopped. Output was not valid JSON.'); }
    }, [streamingText]);

    const toggleEntity = (type: EntityType) => setSelectedEntities(prev => prev.includes(type) ? prev.filter(e => e !== type) : [...prev, type]);
    const toggleInOrderedList = (ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    const toggleImagePriorityItem = (item: ImagePriorityItem) => setImageInjectionPriority(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);
    const handleDragStart = (i: number) => setDragIndex(i);
    const handleDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) setDragOverIndex(i); };
    const handleDrop = (i: number) => { if (dragIndex === null || dragIndex === i) { setDragIndex(null); setDragOverIndex(null); return; } setImageInjectionPriority(prev => { const n = [...prev]; const [m] = n.splice(dragIndex, 1); n.splice(i, 0, m); return n; }); setDragIndex(null); setDragOverIndex(null); };
    const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null); };

    const handleReferenceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) { const f = Array.from(e.target.files); setReferenceImages(prev => [...prev, ...f]); setReferenceImagePreviews(prev => [...prev, ...f.map(x => URL.createObjectURL(x))]); } e.target.value = ''; };
    const handleRemoveReferenceImage = (i: number) => { setReferenceImages(prev => prev.filter((_, j) => j !== i)); if (!referenceImagePreviews[i].startsWith('data:image')) URL.revokeObjectURL(referenceImagePreviews[i]); setReferenceImagePreviews(prev => prev.filter((_, j) => j !== i)); };

    const handleCopySchema = useCallback(() => { navigator.clipboard.writeText(buildJsonSchema(effectiveSchemaEntities)).then(() => { setSchemaCopied(true); setTimeout(() => setSchemaCopied(false), 2000); }).catch(() => setError('Failed to copy.')); }, [effectiveSchemaEntities]);

    const addToHistory = useCallback((jsonText: string, parsed: GeneratedOutput, isEdited = false) => {
        setJsonHistory(prev => [{ id: uuidv4(), timestamp: Date.now(), jsonText, parsedOutput: parsed, label: deriveHistoryLabel(parsed), isEdited }, ...prev]);
    }, []);

    const deleteHistoryEntry = useCallback((id: string) => { setJsonHistory(prev => prev.filter(e => e.id !== id)); if (editingHistoryId === id) { setEditingHistoryId(null); setEditingJsonText(''); } if (expandedHistoryId === id) setExpandedHistoryId(null); }, [editingHistoryId, expandedHistoryId]);
    const startEditingHistory = useCallback((entry: JsonHistoryEntry) => { setEditingHistoryId(entry.id); setEditingJsonText(entry.jsonText); setExpandedHistoryId(entry.id); }, []);
    const saveHistoryEdit = useCallback(() => { if (!editingHistoryId) return; const p = tryParseGeneratedOutput(editingJsonText); if (!p) { setError('Edited JSON is not valid.'); return; } setJsonHistory(prev => prev.map(e => e.id === editingHistoryId ? { ...e, jsonText: editingJsonText, parsedOutput: p, label: deriveHistoryLabel(p), isEdited: true } : e)); setEditingHistoryId(null); setEditingJsonText(''); setError(null); }, [editingHistoryId, editingJsonText]);
    const cancelHistoryEdit = useCallback(() => { setEditingHistoryId(null); setEditingJsonText(''); }, []);
    const loadHistoryToResult = useCallback((entry: JsonHistoryEntry) => { setStreamingText(entry.jsonText); setParsedOutput(entry.parsedOutput); setResultError(null); setIsResultOpen(true); setActiveTab('raw'); }, []);
    const refineFromHistory = useCallback((entry: JsonHistoryEntry) => { setUserPrompt(prev => { const b = prev.trim(); const r = `\n\nREFINE THIS EXISTING OUTPUT:\n${entry.jsonText}`; return b ? `${b}${r}` : `Refine and improve this JSON output.${r}`; }); setError(null); }, []);

    const applyRefinedCharacter = useCallback((refined: Character, worldIndex?: number) => {
        setParsedOutput(prev => {
            if (!prev) return prev;
            const gen = characterEntityToGenerated(refined);
            if (worldIndex !== undefined && prev.world) {
                const chars = [...prev.world.characters];
                chars[worldIndex] = gen;
                const next: GeneratedOutput = { ...prev, world: { ...prev.world, characters: chars } };
                setStreamingText(JSON.stringify(next, null, 2));
                return next;
            }
            const next: GeneratedOutput = { ...prev, character: gen };
            setStreamingText(JSON.stringify(next, null, 2));
            return next;
        });
    }, []);

    const applyRefinedContext = useCallback((refined: Context, worldIndex?: number) => {
        setParsedOutput(prev => {
            if (!prev) return prev;
            const gen = contextEntityToGenerated(refined);
            if (worldIndex !== undefined && prev.world) {
                const ctxs = [...(prev.world.contexts || [])];
                ctxs[worldIndex] = gen;
                const next: GeneratedOutput = { ...prev, world: { ...prev.world, contexts: ctxs } };
                setStreamingText(JSON.stringify(next, null, 2));
                return next;
            }
            const next: GeneratedOutput = { ...prev, context: gen };
            setStreamingText(JSON.stringify(next, null, 2));
            return next;
        });
    }, []);

    const applyRefinedLocation = useCallback((refined: Location, worldIndex?: number) => {
        setParsedOutput(prev => {
            if (!prev) return prev;
            const gen = locationEntityToGenerated(refined);
            if (worldIndex !== undefined && prev.world) {
                const locs = [...(prev.world.locations || [])];
                locs[worldIndex] = gen;
                const next: GeneratedOutput = { ...prev, world: { ...prev.world, locations: locs } };
                setStreamingText(JSON.stringify(next, null, 2));
                return next;
            }
            const next: GeneratedOutput = { ...prev, location: gen };
            setStreamingText(JSON.stringify(next, null, 2));
            return next;
        });
    }, []);

    const applyRefinedProfile = useCallback((refined: Profile, isWorldProfile = false) => {
        setParsedOutput(prev => {
            if (!prev) return prev;
            const gen = profileEntityToGenerated(refined);
            if (isWorldProfile && prev.world) {
                const next: GeneratedOutput = { ...prev, world: { ...prev.world, profile: gen } };
                setStreamingText(JSON.stringify(next, null, 2));
                return next;
            }
            const next: GeneratedOutput = { ...prev, profile: gen };
            setStreamingText(JSON.stringify(next, null, 2));
            return next;
        });
    }, []);

    const buildExistingReferenceBlock = (): string => {
        const parts: string[] = [];
        if (selectedCharacterIds.length > 0) { parts.push('EXISTING CHARACTERS:'); selectedCharacterIds.forEach((id, i) => { const c = allCharacters.find(ch => ch.id === id); if (c) parts.push(`${i + 1}. ID: ${c.id} | Name: ${c.name}${c.description ? ` | ${c.description.substring(0, 200)}` : ''}`); }); parts.push(''); }
        if (selectedContextIds.length > 0) { parts.push('EXISTING CONTEXTS:'); selectedContextIds.forEach((id, i) => { const c = allContexts.find(x => x.id === id); if (c) parts.push(`${i + 1}. ID: ${c.id} | Name: ${c.name}${c.text ? ` | ${c.text.substring(0, 200)}` : ''}`); }); parts.push(''); }
        if (selectedLocationIds.length > 0) { parts.push('EXISTING LOCATIONS:'); selectedLocationIds.forEach((id, i) => { const l = allLocations.find(x => x.id === id); if (l) parts.push(`${i + 1}. ID: ${l.id} | Name: ${l.name}${l.text ? ` | ${l.text.substring(0, 200)}` : ''}`); }); parts.push(''); }
        return parts.join('\n');
    };

    const buildSystemPrompt = (): string => {
        const parts: string[] = [];
        const hasWorld = selectedEntities.includes('World');
        parts.push('You are a creative writing assistant for roleplay. Generate exactly ONE of each requested entity type.');
        parts.push('You MUST output ONLY valid JSON matching the schema below. No markdown, no commentary, no code fences.');
        parts.push('Use {{user}} to refer to the user. Use {{char}} instead of character names in prompts.');
        parts.push('The "description" field is for UI display only. It is NOT injected into prompts or used as AI input. Write it as a short human-readable summary.');
        parts.push('Do not make references to the existing entities at all costs and at all times unless stated otherwise.');
        if (hasWorld) {
            parts.push('For World generation: use EITHER entity names OR entity IDs in bindings. Existing IDs are in references above. New entities use names for cross-reference.');
            parts.push('Generate ALL sub-entities INSIDE the "world" object only.');
            const exclusions: string[] = [];
            if (!selectedEntities.includes('Character')) exclusions.push('characters');
            if (!selectedEntities.includes('Context')) exclusions.push('contexts');
            if (!selectedEntities.includes('Location')) exclusions.push('locations');
            if (!selectedEntities.includes('Profile')) exclusions.push('profile');
            if (exclusions.length > 0) {
                parts.push(`Do NOT generate the following inside the world object: ${exclusions.join(', ')}. Omit those keys entirely.`);
            }
        } else {
            const allTypes: EntityType[] = ['Character', 'Context', 'Location', 'Profile'];
            const notSelected = allTypes.filter(t => !selectedEntities.includes(t));
            if (notSelected.length > 0) {
                const keyMap: Record<string, string> = { Character: 'character', Context: 'context', Location: 'location', Profile: 'profile' };
                const excludedKeys = notSelected.map(t => `"${keyMap[t]}"`);
                parts.push(`Do NOT include these top-level keys in your output: ${excludedKeys.join(', ')}. Only generate the entity types shown in the schema.`);
            }
        }
        parts.push('');
        const eb = buildExistingReferenceBlock(); if (eb) parts.push(eb);
        parts.push('OUTPUT JSON SCHEMA:', buildJsonSchema(effectiveSchemaEntities), '');
        parts.push('Fill all required fields. Omit optional fields if not applicable.');
        return parts.join('\n');
    };

    const handleGenerate = async () => {
        if (selectedEntities.length === 0) { setError('Select at least one entity type.'); return; }
        if (!selectedModel) { setError('No model selected.'); return; }
        const port = selectedModel.id ? runningModels[selectedModel.id]?.port : undefined;
        const rp = (selectedModel.parameters && typeof selectedModel.parameters === 'object' && '_runtimePort' in selectedModel.parameters) ? (selectedModel.parameters as Record<string, number>)._runtimePort : undefined;
        const ep = port || rp;
        if (!ep && !selectedModel.apiKey) { setError('Model not loaded and has no API key.'); return; }

        let imgDesc = '';
        if (referenceImages.length > 0) { setIsUploadingImages(true); imgDesc = `\nREFERENCE IMAGES:\n${referenceImages.map((f, i) => `[Image ${i + 1}: ${f.name}]`).join('\n')}\n`; setIsUploadingImages(false); }

        const injNotes: string[] = [];
        if (imageInjectionPriority.length > 0) { injNotes.push('IMAGE INJECTION PRIORITY:'); imageInjectionPriority.forEach((item, i) => injNotes.push(`${i + 1}. ${IMAGE_PROMPT_DESCRIPTIONS[item]}`)); const dis = IMAGE_PRIORITY_ITEMS.filter(x => !imageInjectionPriority.includes(x)); if (dis.length > 0) injNotes.push(`DISABLED: ${dis.map(d => IMAGE_PROMPT_DESCRIPTIONS[d]).join(', ')}`); } else { injNotes.push('ALL IMAGE TYPES DISABLED.'); }
        const injBlock = injNotes.length > 0 ? `\n${injNotes.join('\n')}\n` : '';

        setError(null); resetResult(); setIsResultOpen(true); setIsGenerating(true);
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        try {
            const sp = buildSystemPrompt();
            const urp = userPrompt.trim() ? `\n\nUser Request: ${userPrompt.trim()}` : '\n\nUser Request: Generate freely.';
            const fp = `${sp}${urp}${imgDesc}${injBlock}`;
            const mc = { apiKey: selectedModel.apiKey, backend: selectedModel.backend, modelPath: (selectedModel.model || selectedModel.parameters?.modelPath) as string | undefined, runtimePort: ep };
            let acc = '';
            const res = await recommendationEngine.generateStream({ prompt: fp, n_predict: maxTokens, temperature: 0.7, top_p: 0.9, stream: true }, ctrl, { onToken: (s) => { acc = s.fullText; setStreamingText(s.fullText); const p = tryParseGeneratedOutput(s.fullText); if (p) setParsedOutput(p); } }, mc, 0, undefined);
            const ft = res.text || acc; setStreamingText(ft);
            const parsed = tryParseGeneratedOutput(ft); setParsedOutput(parsed);
            if (!parsed) setResultError('AI response was not valid JSON.');
            else if (!ft.trim()) setResultError('AI returned empty response.');
            else addToHistory(ft, parsed, false);
        } catch (err) { if ((err as Error).name !== 'AbortError') setResultError(`Generation failed: ${(err as Error).message}`); }
        finally { setIsGenerating(false); abortControllerRef.current = null; }
    };

    const handleSave = async () => {
        if (!parsedOutput) { setResultError('No parsed output to save.'); return; }
        setIsSaving(true); setResultError(null); const now = Date.now();
        try {
            if (parsedOutput.character) { const c = parsedOutput.character; const char = generatedCharacterToEntity(c, allSamplers); char.doNotInjectCharacterImage = !injectCharacterImages; if (!await onSaveCharacter(char)) throw new Error('Failed to save character.'); }
            if (parsedOutput.context) { const ctx = generatedContextToEntity(parsedOutput.context); if (!injectContextImages) ctx.includeLinkImages = false; if (!await onSaveContext(ctx)) throw new Error('Failed to save context.'); }
            if (parsedOutput.location) { const loc = generatedLocationToEntity(parsedOutput.location); if (!await onSaveLocation(loc)) throw new Error('Failed to save location.'); }
            if (parsedOutput.profile) { const p = buildProfileFromGenerated(parsedOutput.profile); p.forceNoCharacterImageInjection = !injectCharacterImages; p.forceNoContextImageInjection = !injectContextImages; if (!await onSaveProfile(p)) throw new Error('Failed to save profile.'); }
            if (parsedOutput.world) {
                const resolved = resolveWorldCrossReferences(parsedOutput.world);
                if (!injectCharacterImages) resolved.characters.forEach(c => { c.doNotInjectCharacterImage = true; });
                if (resolved.profile) { resolved.profile.forceNoCharacterImageInjection = !injectCharacterImages; resolved.profile.forceNoContextImageInjection = !injectContextImages; }
                for (const ch of resolved.characters) if (!await onSaveCharacter(ch)) throw new Error(`Failed to save "${ch.name}".`);
                for (const cx of resolved.contexts) if (!await onSaveContext(cx)) throw new Error(`Failed to save "${cx.name}".`);
                for (const lo of resolved.locations) if (!await onSaveLocation(lo)) throw new Error(`Failed to save "${lo.name}".`);
                if (resolved.profile && !await onSaveProfile(resolved.profile)) throw new Error(`Failed to save "${resolved.profile.name}".`);
                const world: World = { id: uuidv4(), name: parsedOutput.world.name, description: parsedOutput.world.description || undefined, characterIds: resolved.characters.map(c => c.id), contextIds: resolved.contexts.map(c => c.id), locationIds: resolved.locations.map(l => l.id), profileId: resolved.profile?.id, firstCreatedTimestamp: now, lastUpdatedTimestamp: now };
                if (!await onSaveWorld(world)) throw new Error('Failed to save world.');
            }
            resetResult(); setIsResultOpen(false);
        } catch (err) { setResultError((err as Error).message); } finally { setIsSaving(false); }
    };

    if (!isOpen) return null;

    const hasChar = !!parsedOutput?.character, hasCtx = !!parsedOutput?.context, hasLoc = !!parsedOutput?.location, hasProf = !!parsedOutput?.profile, hasWorld = !!parsedOutput?.world;
    const hasAnyParsed = hasChar || hasCtx || hasLoc || hasProf || hasWorld;
    const hasOutput = streamingText.trim().length > 0;
    const availableTabs: ViewTab[] = ['raw'];
    if (hasChar) availableTabs.push('Character'); if (hasCtx) availableTabs.push('Context'); if (hasLoc) availableTabs.push('Location'); if (hasProf) availableTabs.push('Profile'); if (hasWorld) availableTabs.push('World');
    const effectiveTab = availableTabs.includes(activeTab) ? activeTab : 'raw';
    const disabledImageItems = IMAGE_PRIORITY_ITEMS.filter(item => !imageInjectionPriority.includes(item));

    const renderFieldList = (entries: [string, unknown][], excludeKeys: string[] = []) => entries.filter(([k, v]) => v !== undefined && v !== null && !excludeKeys.includes(k)).map(([key, val]) => (
        <div key={key} className="entity-field-block">
            <div className="entity-field-title">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</div>
            <div className="entity-field-content">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</div>
        </div>
    ));

    const renderSummary = (desc?: string) => desc ? (
        <div className="entity-field-block" style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '10px', marginBottom: '12px' }}>
            <div className="entity-field-title" style={{ opacity: 0.6, fontSize: '0.65rem' }}>AI SUMMARY (display only)</div>
            <div className="entity-field-content" style={{ fontStyle: 'italic', opacity: 0.9 }}>{desc}</div>
        </div>
    ) : null;

    const editBtnStyle = { fontSize: '0.7rem', padding: '4px 14px', minHeight: '28px' };
    const worldEditBtnStyle = { fontSize: '0.65rem', padding: '3px 10px', minHeight: '24px', justifyContent: 'flex-start' as const };

    return (
        <>
            {/* FORM MODAL */}
            <div className="modal-overlay" onClick={handleCloseForm}>
                <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h2>Get AI Recommendation</h2><div className="editor-modal-actions"><button type="button" className="editor-btn editor-btn-cancel" onClick={handleCloseForm} disabled={isGenerating || isUploadingImages}>Cancel</button></div></div>
                    <div className="modal-body editor-modal-body">
                        <div className="editor-section">
                            <span className="editor-section-title">Generate</span>
                            <div className="entity-type-buttons">{ENTITY_OPTIONS.map(opt => (<button key={opt.type} type="button" onClick={() => toggleEntity(opt.type)} className={`editor-btn ${selectedEntities.includes(opt.type) ? 'editor-btn-save' : 'editor-btn-cancel'} entity-type-btn`}>{opt.icon} {opt.label}</button>))}</div>
                            <div className="entity-type-hint">Select entity types. World absorbs co-selected types.</div>
                            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}><button type="button" className={`editor-btn ${showSchemaPreview ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setShowSchemaPreview(!showSchemaPreview)} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>{showSchemaPreview ? '🔽 Hide JSON Schema' : '📋 Show JSON Schema'}</button></div>
                            {showSchemaPreview && <div style={{ marginTop: '8px' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}><span style={{ fontSize: '0.6rem', opacity: 0.6 }}>Copy schema for external AI tools</span><button type="button" className="editor-btn editor-btn-cancel" onClick={handleCopySchema} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px' }}>{schemaCopied ? '✅ Copied!' : '📋 Copy'}</button></div><pre style={{ background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px', fontSize: '0.65rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '300px', overflowY: 'auto', color: 'var(--text-h)', margin: 0 }}>{buildJsonSchema(effectiveSchemaEntities)}</pre></div>}
                        </div>
                        <div className="editor-section"><span className="editor-section-title">Reference Existing Entities (Optional)</span><div className="entity-ref-hint">Select existing entities for consistency.</div><EntitySelectList label="Characters" items={allCharacters} selectedIds={selectedCharacterIds} onToggle={(id) => toggleInOrderedList(selectedCharacterIds, setSelectedCharacterIds, id)} searchQuery={charSearch} onSearchChange={setCharSearch} /><EntitySelectList label="Contexts" items={allContexts} selectedIds={selectedContextIds} onToggle={(id) => toggleInOrderedList(selectedContextIds, setSelectedContextIds, id)} searchQuery={ctxSearch} onSearchChange={setCtxSearch} /><EntitySelectList label="Locations" items={allLocations} selectedIds={selectedLocationIds} onToggle={(id) => toggleInOrderedList(selectedLocationIds, setSelectedLocationIds, id)} searchQuery={locSearch} onSearchChange={setLocSearch} /></div>
                        <div className="editor-section"><label className="editor-label">Describe what you want <span className="optional-label">(optional)</span></label><textarea value={userPrompt} onChange={e => setUserPrompt(e.target.value)} className="editor-textarea" placeholder={selectedEntities.includes('World') ? "e.g., A haunted Victorian mansion with 5 NPCs..." : "Leave empty for free generation..."} rows={3} /></div>
                        <div className="editor-section"><span className="editor-section-title">Reference Images <span className="optional-label">(optional)</span></span><div className="entity-ref-hint">Upload images as visual reference.</div><div className="editor-image-grid">{referenceImagePreviews.map((p, i) => (<div key={p} className="editor-image-square active"><img src={p} alt={`Ref ${i + 1}`} /><button type="button" onClick={() => handleRemoveReferenceImage(i)} className="editor-image-remove-btn">×</button></div>))}<div className={`editor-image-square editor-upload-square ${isUploadingImages ? 'disabled' : ''}`} onClick={() => !isUploadingImages && imageInputRef.current?.click()}><div className="context-image-placeholder"><div className="context-image-placeholder-icon">{isUploadingImages ? '⏳' : '📷'}</div><div className="context-image-placeholder-text">{isUploadingImages ? 'Processing...' : 'Upload'}</div></div></div></div><input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={handleReferenceImageChange} disabled={isUploadingImages} /></div>
                        <div className="editor-section"><span className="editor-section-title">Image Injection Priority</span><div className="entity-ref-hint">Drag to reorder. × to disable.</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>{imageInjectionPriority.map((item, index) => (<div key={item} draggable onDragStart={() => handleDragStart(index)} onDragOver={(e) => handleDragOver(e, index)} onDrop={() => handleDrop(index)} onDragEnd={handleDragEnd} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', background: dragIndex === index ? 'var(--accent-dim, rgba(255,255,255,0.05))' : 'var(--social-bg)', border: dragOverIndex === index ? '2px dashed var(--accent)' : '1px solid var(--border)', borderRadius: '4px', fontSize: '0.75rem', cursor: 'grab', opacity: dragIndex === index ? 0.5 : 1, transition: 'border 0.15s, background 0.15s, opacity 0.15s', userSelect: 'none' }}><span style={{ opacity: 0.3, fontSize: '0.8rem', minWidth: '16px', textAlign: 'center' }}>☰</span><span style={{ opacity: 0.5, minWidth: '16px', textAlign: 'center' }}>{index + 1}</span><span style={{ flex: 1 }}>{IMAGE_LABELS[item]}</span><button type="button" onClick={() => toggleImagePriorityItem(item)} className="context-character-binding-remove" title="Remove">×</button></div>))}</div>{disabledImageItems.length > 0 && <div style={{ marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>{disabledImageItems.map(item => (<button key={item} type="button" onClick={() => toggleImagePriorityItem(item)} className="editor-btn editor-btn-cancel" style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px', opacity: 0.6 }}>+ {IMAGE_SHORT_LABELS[item]}</button>))}</div>}</div>
                        {jsonHistory.length > 0 && <div className="editor-section"><span className="editor-section-title">Generated Output History ({jsonHistory.length})</span><div className="entity-ref-hint">Previous generations. Edit, refine, or preview.</div><div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto' }}>{jsonHistory.map(entry => { const isEditing = editingHistoryId === entry.id; const isExpanded = expandedHistoryId === entry.id; return (<div key={entry.id} style={{ border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--social-bg)', overflow: 'hidden' }}><div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', cursor: 'pointer', background: isExpanded ? 'var(--accent-dim, rgba(255,255,255,0.03))' : undefined }} onClick={() => setExpandedHistoryId(isExpanded ? null : entry.id)}><span style={{ fontSize: '0.7rem', opacity: 0.5 }}>{isExpanded ? '▼' : '▶'}</span><span style={{ flex: 1, fontSize: '0.75rem', fontWeight: 600 }}>{entry.label}</span>{entry.isEdited && <span style={{ fontSize: '0.55rem', background: '#f59e0b', color: '#000', padding: '1px 4px', borderRadius: '3px' }}>Edited</span>}<span style={{ fontSize: '0.6rem', opacity: 0.4 }}>{new Date(entry.timestamp).toLocaleTimeString()}</span></div>{isExpanded && <div style={{ padding: '0 8px 8px' }}>{isEditing ? <><textarea value={editingJsonText} onChange={e => setEditingJsonText(e.target.value)} className="editor-textarea" style={{ fontFamily: 'monospace', fontSize: '0.65rem', minHeight: '120px', maxHeight: '300px' }} rows={8} /><div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}><button type="button" className="editor-btn editor-btn-save" onClick={saveHistoryEdit} style={{ fontSize: '0.65rem', padding: '3px 10px', minHeight: '24px' }}>✅ Save</button><button type="button" className="editor-btn editor-btn-cancel" onClick={cancelHistoryEdit} style={{ fontSize: '0.65rem', padding: '3px 10px', minHeight: '24px' }}>Cancel</button></div></> : <><pre style={{ background: 'var(--bg, #000)', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px', fontSize: '0.6rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '200px', overflowY: 'auto', color: 'var(--text-h)', margin: '4px 0' }}>{entry.jsonText.length > 2000 ? entry.jsonText.substring(0, 2000) + '\n...(truncated)' : entry.jsonText}</pre><div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}><button type="button" className="editor-btn editor-btn-cancel" onClick={() => startEditingHistory(entry)} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px' }}>✏️ Edit</button><button type="button" className="editor-btn editor-btn-save" onClick={() => refineFromHistory(entry)} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px' }}>🔄 Refine</button><button type="button" className="editor-btn editor-btn-cancel" onClick={() => loadHistoryToResult(entry)} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px' }}>👁️ Preview</button><button type="button" className="editor-btn editor-btn-cancel" onClick={() => deleteHistoryEntry(entry.id)} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px', color: '#ef4444' }}>🗑️</button></div></>}</div>}</div>); })}</div></div>}
                        <div className="editor-section"><label className="editor-label editor-label-small">Max Tokens</label><input type="number" className="editor-input context-input-small" min={256} max={16384} step={256} value={maxTokens} onChange={e => setMaxTokens(Math.max(256, Math.min(16384, Number(e.target.value) || 2048)))} /><div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Default: 2048. Range: 256–16384.</div></div>
                        <button type="button" className="editor-btn editor-btn-save entity-generate-btn" onClick={handleGenerate} disabled={selectedEntities.length === 0 || isUploadingImages}>✨ Generate Recommendation</button>
                        {error && <div className="editor-error-message editor-error-centered entity-error-below">{error}</div>}
                    </div>
                </div>
            </div>

            {/* RESULT MODAL */}
            {isResultOpen && (
                <div className="modal-overlay" onClick={handleCloseResult}>
                    <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h2>Recommendation Result</h2><div className="editor-modal-actions"><button type="button" className="editor-btn editor-btn-cancel" onClick={handleCloseResult} disabled={isGenerating || isSaving}>{hasOutput ? 'Back to Form' : 'Cancel'}</button></div></div>
                        <div className="modal-body editor-modal-body">
                            {hasAnyParsed && <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                                {parsedOutput?.character && <button type="button" className={`editor-btn ${activeTab === 'Character' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('Character')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>🎭 {parsedOutput.character.name}</button>}
                                {parsedOutput?.context && <button type="button" className={`editor-btn ${activeTab === 'Context' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('Context')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>📜 {parsedOutput.context.name}</button>}
                                {parsedOutput?.location && <button type="button" className={`editor-btn ${activeTab === 'Location' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('Location')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>📍 {parsedOutput.location.name}</button>}
                                {parsedOutput?.profile && <button type="button" className={`editor-btn ${activeTab === 'Profile' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('Profile')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>👤 {parsedOutput.profile.name}</button>}
                                {parsedOutput?.world && <button type="button" className={`editor-btn ${activeTab === 'World' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('World')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>🌍 {parsedOutput.world.name}</button>}
                                <button type="button" className={`editor-btn ${activeTab === 'raw' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('raw')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>📄 Raw JSON</button>
                            </div>}

                            {effectiveTab === 'raw' && <div className="entity-raw-output"><pre className="entity-raw-pre">{streamingText || (isGenerating ? '⏳ Waiting...' : '')}</pre></div>}

                            {effectiveTab === 'Character' && parsedOutput?.character && <div className="entity-field-list">{renderSummary(parsedOutput.character.description)}{renderFieldList(Object.entries(parsedOutput.character), ['description'])}{onOpenCharacterEditor && <div style={{ marginTop: '12px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenCharacterEditor(generatedCharacterToEntity(parsedOutput.character!, allSamplers), (c) => applyRefinedCharacter(c))} style={editBtnStyle}>✏️ Open in Character Editor</button></div>}</div>}

                            {effectiveTab === 'Context' && parsedOutput?.context && <div className="entity-field-list">{renderSummary(parsedOutput.context.description)}{renderFieldList(Object.entries(parsedOutput.context), ['description'])}{onOpenContextEditor && <div style={{ marginTop: '12px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenContextEditor(generatedContextToEntity(parsedOutput.context!), (c) => applyRefinedContext(c))} style={editBtnStyle}>✏️ Open in Context Editor</button></div>}</div>}

                            {effectiveTab === 'Location' && parsedOutput?.location && <div className="entity-field-list">{renderSummary(parsedOutput.location.description)}{renderFieldList(Object.entries(parsedOutput.location), ['description'])}{onOpenLocationEditor && <div style={{ marginTop: '12px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenLocationEditor(generatedLocationToEntity(parsedOutput.location!), (l) => applyRefinedLocation(l))} style={editBtnStyle}>✏️ Open in Location Editor</button></div>}</div>}

                            {effectiveTab === 'Profile' && parsedOutput?.profile && <div className="entity-field-list">{renderSummary(parsedOutput.profile.description)}{renderFieldList(Object.entries(parsedOutput.profile), ['description'])}{onOpenProfileEditor && <div style={{ marginTop: '12px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenProfileEditor(buildProfileFromGenerated(parsedOutput.profile!), (p) => applyRefinedProfile(p))} style={editBtnStyle}>✏️ Open in Profile Editor</button></div>}</div>}

                            {effectiveTab === 'World' && parsedOutput?.world && <div className="entity-field-list">
                                {renderSummary(parsedOutput.world.description)}
                                <div className="entity-field-block"><div className="entity-field-title">Name</div><div className="entity-field-content">{parsedOutput.world.name}</div></div>
                                <div className="entity-field-block"><div className="entity-field-title">Characters ({parsedOutput.world.characters.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>{parsedOutput.world.characters.map((c, i) => <div key={i} style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem' }}><div style={{ fontWeight: 600 }}>🎭 {c.name}</div>{c.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{c.description.length > 150 ? c.description.substring(0, 150) + '...' : c.description}</div>}</div>)}</div></div>
                                {(parsedOutput.world.contexts?.length ?? 0) > 0 && <div className="entity-field-block"><div className="entity-field-title">Contexts ({parsedOutput.world.contexts!.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>{parsedOutput.world.contexts!.map((c, i) => <div key={i} style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem' }}><div style={{ fontWeight: 600 }}>📜 {c.name}</div>{c.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{c.description.length > 150 ? c.description.substring(0, 150) + '...' : c.description}</div>}</div>)}</div></div>}
                                {(parsedOutput.world.locations?.length ?? 0) > 0 && <div className="entity-field-block"><div className="entity-field-title">Locations ({parsedOutput.world.locations!.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>{parsedOutput.world.locations!.map((l, i) => <div key={i} style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem' }}><div style={{ fontWeight: 600 }}>📍 {l.name}</div>{l.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{l.description.length > 150 ? l.description.substring(0, 150) + '...' : l.description}</div>}</div>)}</div></div>}
                                {parsedOutput.world.profile && <div className="entity-field-block"><div className="entity-field-title">Profile</div><div style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem', marginTop: '4px' }}><div style={{ fontWeight: 600 }}>👤 {parsedOutput.world.profile.name}</div>{parsedOutput.world.profile.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{parsedOutput.world.profile.description.length > 150 ? parsedOutput.world.profile.description.substring(0, 150) + '...' : parsedOutput.world.profile.description}</div>}</div></div>}
                                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {onOpenCharacterEditor && parsedOutput.world.characters.map((c, i) => <button key={`wc-${i}`} type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenCharacterEditor(generatedCharacterToEntity(c, allSamplers), (refined) => applyRefinedCharacter(refined, i))} style={worldEditBtnStyle}>✏️ Edit 🎭 {c.name}</button>)}
                                    {onOpenContextEditor && (parsedOutput.world.contexts || []).map((c, i) => <button key={`wx-${i}`} type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenContextEditor(generatedContextToEntity(c), (refined) => applyRefinedContext(refined, i))} style={worldEditBtnStyle}>✏️ Edit 📜 {c.name}</button>)}
                                    {onOpenLocationEditor && (parsedOutput.world.locations || []).map((l, i) => <button key={`wl-${i}`} type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenLocationEditor(generatedLocationToEntity(l), (refined) => applyRefinedLocation(refined, i))} style={worldEditBtnStyle}>✏️ Edit 📍 {l.name}</button>)}
                                    {onOpenProfileEditor && parsedOutput.world.profile && <button type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenProfileEditor(buildProfileFromGenerated(parsedOutput.world!.profile!), (refined) => applyRefinedProfile(refined, true))} style={worldEditBtnStyle}>✏️ Edit 👤 {parsedOutput.world.profile.name}</button>}
                                </div>
                            </div>}

                            <div className="entity-action-buttons">{isGenerating ? <button type="button" className="editor-btn editor-btn-cancel" onClick={handleStopGeneration} style={{ flex: 1 }}>⏹ Stop</button> : <><button type="button" className="editor-btn editor-btn-cancel" onClick={resetResult} disabled={isSaving} style={{ flex: 1 }}>Regenerate</button>{hasAnyParsed && <button type="button" className="editor-btn editor-btn-save" onClick={handleSave} disabled={isSaving} style={{ flex: 1 }}>{isSaving ? 'Saving...' : hasWorld ? '💾 Save World + All' : '💾 Save All'}</button>}</>}</div>
                            {resultError && <div className="editor-error-message editor-error-centered entity-error-below">{resultError}</div>}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}