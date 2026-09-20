// src/services/dataConverters.ts
import type { Character, Context, Location, AudioTrack, Sampler, Profile, PromptBlock, Clothing, TextCharacterInjection, DialoguePrompt, KnowledgePrompt, tool, toolUsageDisplayMode, RegularExpressionTrigger, regularExpressionContext, regularExpressionTarget } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { UUID_REGEX } from './dataTypes';
import type { GeneratedOutput } from './dataTypes';
import { defaultCharacterTools, defaultProfileTools, defaultNarrateTexts } from '../dictionaries/defaults'

function ensureId(obj: Record<string, unknown>): string {
    return (typeof obj.id === 'string' && obj.id.length > 0) ? obj.id : uuidv4();
}

function parseToolsRecord(raw: unknown, defaults: Record<tool, boolean>): Record<tool, boolean>;
function parseToolsRecord(raw: unknown, defaults: Record<tool, number>): Record<tool, number>;
function parseToolsRecord(raw: unknown, defaults: Record<string, boolean | number>): Record<string, boolean | number> {
    if (!raw || typeof raw !== 'object') return { ...defaults };
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
        if (key in (raw as Record<string, unknown>)) {
            (result as Record<string, unknown>)[key] = (raw as Record<string, unknown>)[key];
        }
    }
    return result;
}

function parseRegexTriggers(
    raw: unknown,
    fallbackContext: regularExpressionContext = 'global',
    fallbackTarget: regularExpressionTarget = 'everyone',
): RegularExpressionTrigger[] | undefined {
    if (!raw) return undefined;

    if (Array.isArray(raw)) {
        const triggers: RegularExpressionTrigger[] = [];
        for (const item of raw) {
            if (!item || typeof item !== 'object') continue;
            const entry = item as Record<string, unknown>;
            const trigger = entry.trigger;
            if (typeof trigger !== 'string' || !trigger.trim()) continue;
            triggers.push({
                trigger: trigger.trim(),
                context: (entry.context as regularExpressionContext) || fallbackContext,
                target: (entry.target as regularExpressionTarget) || fallbackTarget,
            });
        }
        return triggers.length > 0 ? triggers : undefined;
    }

    return undefined;
}

function filterValidUuids(refs: string[] | undefined): string[] {
    if (!refs) return [];
    return refs.filter((id): id is string => typeof id === 'string' && UUID_REGEX.test(id));
}

function filterRecordKeysByUuid<T>(record: Record<string, T> | undefined): Record<string, T> {
    if (!record) return {};
    const result: Record<string, T> = {};
    for (const [key, value] of Object.entries(record)) {
        if (UUID_REGEX.test(key)) result[key] = value;
    }
    return result;
}

/**
 * Parses starterPrompts: Record<string, number> from AI-generated JSON.
 * Keys are text strings, values are numeric weights.
 */
function parseStarterPrompts(raw: unknown): Record<string, number> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof key === 'string' && typeof value === 'number') {
            result[key] = value;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

const VALID_TOOL_USAGE_DISPLAY_MODES: toolUsageDisplayMode[] = ['none', 'icon', 'simple', 'detailed', 'full', 'raw'];

function parseToolUsageDisplayMode(raw: unknown): toolUsageDisplayMode {
    if (typeof raw === 'string' && VALID_TOOL_USAGE_DISPLAY_MODES.includes(raw as toolUsageDisplayMode)) {
        return raw as toolUsageDisplayMode;
    }
    return 'none';
}

function fillDialoguePromptDefaults(d: Record<string, unknown>): DialoguePrompt {
    const now = Date.now();
    return {
        id: ensureId(d),
        name: (d.name as string) || 'Unnamed Dialogue',
        description: (d.description as string) || '',
        content: (d.content as string) || '',
        dialoguePromptBindings: filterValidUuids(d.dialoguePromptBindings as string[] | undefined),
        dialoguePromptWeight: (d.dialoguePromptWeight as number) ?? 1,
        dialoguePromptBreakProbability: (d.dialoguePromptBreakProbability as number) ?? 0,
        dialoguePromptSkipProbability: (d.dialoguePromptSkipProbability as number) ?? 0,
        regularExpressionActivationTriggers: parseRegexTriggers(d.regularExpressionActivationTriggers),
        regularExpressionDeactivationTriggers: parseRegexTriggers(d.regularExpressionDeactivationTriggers),
        regularExpressionExclusionActivationTriggers: parseRegexTriggers(d.regularExpressionExclusionActivationTriggers),
        regularExpressionExclusionDeactivationTriggers: parseRegexTriggers(d.regularExpressionExclusionDeactivationTriggers),
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillKnowledgePromptDefaults(k: Record<string, unknown>): KnowledgePrompt {
    const now = Date.now();
    return {
        id: ensureId(k),
        name: (k.name as string) || 'Unnamed Knowledge',
        description: (k.description as string) || '',
        content: (k.content as string) || '',
        knowledgePromptBindings: filterValidUuids(k.knowledgePromptBindings as string[] | undefined),
        regularExpressionActivationTriggers: parseRegexTriggers(k.regularExpressionActivationTriggers),
        regularExpressionDeactivationTriggers: parseRegexTriggers(k.regularExpressionDeactivationTriggers),
        regularExpressionExclusionActivationTriggers: parseRegexTriggers(k.regularExpressionExclusionActivationTriggers),
        regularExpressionExclusionDeactivationTriggers: parseRegexTriggers(k.regularExpressionExclusionDeactivationTriggers),
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillTextCharacterInjectionDefaults(t: Record<string, unknown>): TextCharacterInjection {
    const now = Date.now();
    return {
        id: ensureId(t),
        name: (t.name as string) || 'Unnamed Injection',
        description: (t.description as string) || '',
        textCharacters: Array.isArray(t.textCharacters) ? (t.textCharacters as string[]).filter(c => typeof c === 'string') : [],
        textCharacterWeights: filterRecordKeysByUuid(t.textCharacterWeights as Record<string, number> | undefined),
        textCharacterInjectionBindings: filterValidUuids(t.textCharacterInjectionBindings as string[] | undefined),
        textCharacterInjectionWeight: (t.textCharacterInjectionWeight as number) ?? 1,
        textCharacterBreakProbability: (t.textCharacterBreakProbability as number) ?? 0,
        textCharacterSkipProbability: (t.textCharacterSkipProbability as number) ?? 0,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillClothingDefaults(c: Record<string, unknown>): Clothing {
    const now = Date.now();
    return {
        id: ensureId(c),
        name: (c.name as string) || 'Unnamed Clothing',
        description: (c.description as string) || '',
        initialWearingProbability: (c.initialWearingProbability as number) ?? 1,
        regularExpressionActivationTriggers: parseRegexTriggers(c.regularExpressionActivationTriggers),
        regularExpressionDeactivationTriggers: parseRegexTriggers(c.regularExpressionDeactivationTriggers),
        clothingBindings: filterValidUuids(c.clothingBindings as string[] | undefined),
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillCharacterDefaults(c: Record<string, unknown>, samplers: Sampler[]): Character {
    const now = Date.now();
    const rawClothings = Array.isArray(c.clothings) ? c.clothings as Record<string, unknown>[] : [];
    const rawTextInjections = Array.isArray(c.textCharacterInjections) ? c.textCharacterInjections as Record<string, unknown>[] : [];
    const rawDialoguePrompts = Array.isArray(c.dialoguePrompts) ? c.dialoguePrompts as Record<string, unknown>[] : [];
    const rawKnowledgePrompts = Array.isArray(c.knowledgePrompts) ? c.knowledgePrompts as Record<string, unknown>[] : [];
    return {
        id: ensureId(c),
        name: (c.name as string) || 'Unnamed',
        description: (c.description as string) || '',
        images: (c.images && typeof c.images === 'object' ? c.images as Record<string, string> : {}) as Record<string, string>,
        useFrontCameraImage: (c.useFrontCameraImage as boolean) ?? false,
        voice: (c.voice as string) || undefined,
        systemPrompt: (c.systemPrompt as string) || '',
        thinkPrompt: (c.thinkPrompt as string) || undefined,
        appearancePrompt: (c.appearancePrompt as string) || undefined,
        dialoguePrompts: rawDialoguePrompts.map(item => fillDialoguePromptDefaults(item)),
        knowledgePrompts: rawKnowledgePrompts.map(item => fillKnowledgePromptDefaults(item)),
        starterPrompts: parseStarterPrompts(c.starterPrompts),
        sampler: samplers.length > 0 ? samplers[0] : undefined,
        initiativeWeight: (c.initiativeWeight as number) ?? 5,
        chatProbability: (c.chatProbability as number) ?? 0.8,
        maximumChatStamina: (c.maximumChatStamina as number) ?? 5,
        maximumActionStamina: (c.maximumActionStamina as number) ?? 5,
        nameSensitivity: (c.nameSensitivity as number) ?? 0.3,
        chatImpatienceSensitivity: (c.chatImpatienceSensitivity as number) ?? 0.2,
        skipProbability: (c.skipProbability as number) ?? 0.1,
        memoryRetentionWeight: (c.memoryRetentionWeight as number) ?? 0.5,
        contextSensitivity: (c.contextSensitivity as number) ?? 0.5,
        doNotInjectCharacterImage: (c.doNotInjectCharacterImage as boolean) ?? false,
        numberOfMessagesToDisableThinkPrompt: (c.numberOfMessagesToDisableThinkPrompt as number) ?? 0,
        numberOfMessagesToDisableMetaThinkInstructions: (c.numberOfMessagesToDisableMetaThinkInstructions as number) ?? 0,
        numberOfMessagesToDisableDialoguePrompt: (c.numberOfMessagesToDisableDialoguePrompt as number) ?? 0,
        numberOfMessagesToDisableStarterPrompt: (c.numberOfMessagesToDisableStarterPrompt as number) ?? 0,
        tools: parseToolsRecord(c.tools, defaultCharacterTools) as Record<tool, boolean>,
        clothings: rawClothings.map(item => fillClothingDefaults(item)),
        textCharacterInjections: rawTextInjections.map(item => fillTextCharacterInjectionDefaults(item)),
        memories: {},
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillContextDefaults(c: Record<string, unknown>): Context {
    const now = Date.now();
    return {
        id: ensureId(c),
        name: (c.name as string) || 'Unnamed',
        description: (c.description as string) || undefined,
        text: (c.text as string) || '',
        images: (c.images as string[]) || undefined,
        searchTerms: (c.searchTerms as string[]) || undefined,
        searchEngine: (c.searchEngine as Context['searchEngine']) || undefined,
        urls: (c.urls as string[]) || undefined,
        includeLinkImages: (c.includeLinkImages as boolean) ?? false,
        maximumLinkDepth: (c.maximumLinkDepth as number) ?? 1,
        linkFetchMode: (c.linkFetchMode as Context['linkFetchMode']) ?? 'summary',
        limitLinksToSubdirectory: (c.limitLinksToSubdirectory as boolean) ?? false,
        fetchCacheTimeToLiveMs: (c.fetchCacheTimeToLiveMs as number) || undefined,
        regularExpressionActivationTriggers: parseRegexTriggers(c.regularExpressionActivationTriggers),
        regularExpressionDeactivationTriggers: parseRegexTriggers(c.regularExpressionDeactivationTriggers),
        regularExpressionExclusionActivationTriggers: parseRegexTriggers(c.regularExpressionExclusionActivationTriggers),
        regularExpressionExclusionDeactivationTriggers: parseRegexTriggers(c.regularExpressionExclusionDeactivationTriggers),
        messageFilterRegularExpressionActivationTriggers: parseRegexTriggers(c.messageFilterRegularExpressionActivationTriggers),
        messageFilterRegularExpressionDeactivationTriggers: parseRegexTriggers(c.messageFilterRegularExpressionDeactivationTriggers),
        messageFilterRegularExpressionExclusionActivationTriggers: parseRegexTriggers(c.messageFilterRegularExpressionExclusionActivationTriggers),
        messageFilterRegularExpressionExclusionDeactivationTriggers: parseRegexTriggers(c.messageFilterRegularExpressionExclusionDeactivationTriggers),
        tokenBudget: (c.tokenBudget as number) ?? 512,
        maximumRecursionDepth: (c.maximumRecursionDepth as number) ?? 1,
        insertionDepth: (c.insertionDepth as number) ?? 0,
        characterBindings: filterValidUuids(c.characterBindings as string[] | undefined),
        useBase64Encoding: (c.useBase64Encoding as boolean) ?? false,
        isAutoGenerated: (c.isAutoGenerated as boolean) || undefined,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillLocationDefaults(l: Record<string, unknown>): Location {
    const now = Date.now();
    return {
        id: ensureId(l),
        name: (l.name as string) || 'Unnamed',
        description: (l.description as string) || undefined,
        text: (l.text as string) || '',
        images: (l.images as string[]) || [],
        regularExpressionActivationTriggers: parseRegexTriggers(l.regularExpressionActivationTriggers),
        regularExpressionDeactivationTriggers: parseRegexTriggers(l.regularExpressionDeactivationTriggers),
        regularExpressionExclusionActivationTriggers: parseRegexTriggers(l.regularExpressionExclusionActivationTriggers),
        regularExpressionExclusionDeactivationTriggers: parseRegexTriggers(l.regularExpressionExclusionDeactivationTriggers),
        backgroundImageRegularExpressionActivationTriggers: (l.backgroundImageRegularExpressionActivationTriggers as Record<number, string>) || {},
        backgroundImageWeights: (l.backgroundImageWeights as Record<number, number>) || {},
        playAudioTrackOnEnterWeights: (l.playAudioTrackOnEnterWeights as Record<string, number>) || undefined,
        locationBindings: filterValidUuids(l.locationBindings as string[] | undefined),
        locationBindingRegularExpressionTriggers: filterRecordKeysByUuid(l.locationBindingRegularExpressionTriggers as Record<string, string> | undefined),
        characterBindings: filterValidUuids(l.characterBindings as string[] | undefined),
        globalWeight: (l.globalWeight as number) ?? 1,
        characterWeights: filterRecordKeysByUuid(l.characterWeights as Record<string, number> | undefined),
        ownerBindings: filterValidUuids(l.ownerBindings as string[] | undefined),
        latitude: (l.latitude as number) ?? 0,
        longitude: (l.longitude as number) ?? 0,
        locationDistances: filterRecordKeysByUuid(l.locationDistances as Record<string, number> | undefined),
        messageFilterNonCoLocatedParticipants: (l.messageFilterNonCoLocatedParticipants as boolean) ?? true,
        messageFilterRegularExpressionActivationTriggers: parseRegexTriggers(l.messageFilterRegularExpressionActivationTriggers),
        messageFilterRegularExpressionDeactivationTriggers: parseRegexTriggers(l.messageFilterRegularExpressionDeactivationTriggers),
        messageFilterRegularExpressionExclusionActivationTriggers: parseRegexTriggers(l.messageFilterRegularExpressionExclusionActivationTriggers),
        messageFilterRegularExpressionExclusionDeactivationTriggers: parseRegexTriggers(l.messageFilterRegularExpressionExclusionDeactivationTriggers),
        useBase64Encoding: (l.useBase64Encoding as boolean) ?? false,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillAudioTrackDefaults(t: Record<string, unknown>): AudioTrack {
    const now = Date.now();
    return {
        id: ensureId(t),
        name: (t.name as string) || 'Unnamed',
        description: (t.description as string) || undefined,
        filename: (t.filename as string) || '',
        loop: (t.loop as boolean) ?? true,
        volume: (t.volume as number) ?? 1,
        startFadeDurationMs: (t.startFadeDurationMs as number) ?? 1000,
        endFadeDurationMs: (t.endFadeDurationMs as number) ?? 1000,
        audioCategory: (t.audioCategory as AudioTrack['audioCategory']) ?? 'ambient',
        priority: (t.priority as number) ?? 0,
        playableByParticipants: (t.playableByParticipants as boolean) ?? false,
        regularExpressionActivationTriggers: parseRegexTriggers(t.regularExpressionActivationTriggers),
        regularExpressionDeactivationTriggers: parseRegexTriggers(t.regularExpressionDeactivationTriggers),
        regularExpressionExclusionActivationTriggers: parseRegexTriggers(t.regularExpressionExclusionActivationTriggers),
        regularExpressionExclusionDeactivationTriggers: parseRegexTriggers(t.regularExpressionExclusionDeactivationTriggers),
        locationBindings: filterValidUuids(t.locationBindings as string[] | undefined),
        contextBindings: filterValidUuids(t.contextBindings as string[] | undefined),
        characterBindings: filterValidUuids(t.characterBindings as string[] | undefined),
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillPromptBlockDefaults(b: Record<string, unknown>): PromptBlock {
    const now = Date.now();
    return {
        id: ensureId(b),
        name: (b.name as string) || 'Unnamed',
        description: (b.description as string) || undefined,
        textContent: (b.textContent as string) || '',
        images: (b.images as string[]) || [],
        regularExpressionActivationTriggers: parseRegexTriggers(b.regularExpressionActivationTriggers),
        regularExpressionDeactivationTriggers: parseRegexTriggers(b.regularExpressionDeactivationTriggers),
        regularExpressionExclusionActivationTriggers: parseRegexTriggers(b.regularExpressionExclusionActivationTriggers),
        regularExpressionExclusionDeactivationTriggers: parseRegexTriggers(b.regularExpressionExclusionDeactivationTriggers),
        messageFilterRegularExpressionActivationTriggers: parseRegexTriggers(b.messageFilterRegularExpressionActivationTriggers),
        messageFilterRegularExpressionDeactivationTriggers: parseRegexTriggers(b.messageFilterRegularExpressionDeactivationTriggers),
        messageFilterRegularExpressionExclusionActivationTriggers: parseRegexTriggers(b.messageFilterRegularExpressionExclusionActivationTriggers),
        messageFilterRegularExpressionExclusionDeactivationTriggers: parseRegexTriggers(b.messageFilterRegularExpressionExclusionDeactivationTriggers),
        characterBindings: filterValidUuids(b.characterBindings as string[] | undefined),
        contextBindings: filterValidUuids(b.contextBindings as string[] | undefined),
        locationBindings: filterValidUuids(b.locationBindings as string[] | undefined),
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillProfileDefaults(p: Record<string, unknown>): Profile {
    const now = Date.now();
    const rawNarrateTexts = (p.narrateTexts && typeof p.narrateTexts === 'object') ? p.narrateTexts as Record<string, unknown> : {};
    return {
        id: ensureId(p),
        name: (p.name as string) || 'Unnamed',
        description: (p.description as string) || undefined,
        autonomousMode: (p.autonomousMode as boolean) ?? false,
        autonomousInteractionIntervalMs: (p.autonomousInteractionIntervalMs as number) ?? 10000,
        volume: (p.volume as number) ?? -1,
        forceNameReveal: (p.forceNameReveal as boolean) ?? false,
        toolUsageDisplayMode: parseToolUsageDisplayMode(p.toolUsageDisplayMode),
        enableCharacterExpression: (p.enableCharacterExpression as boolean) ?? false,
        randomizeTextCharacterInjection: (p.randomizeTextCharacterInjection as boolean) ?? false,
        randomizeTextCharacterInjectionOnRetry: (p.randomizeTextCharacterInjectionOnRetry as boolean) ?? true,
        maximumNumberOfTextCharacterRandomizationPerModel: (p.maximumNumberOfTextCharacterRandomizationPerModel as number) ?? 1,
        forceNoCharacterImageInjection: (p.forceNoCharacterImageInjection as boolean) ?? false,
        forceNoContextImageInjection: (p.forceNoContextImageInjection as boolean) ?? false,
        forceNoLocationImageInjection: (p.forceNoLocationImageInjection as boolean) ?? false,
        useCurrentDateAndTime: (p.useCurrentDateAndTime as boolean) ?? false,
        useWeather: (p.useWeather as boolean) ?? false,
        weatherApiKey: (p.weatherApiKey as string) || undefined,
        useTimeElapsed: (p.useTimeElapsed as boolean) ?? false,
        useFrontCameraImage: (p.useFrontCameraImage as number) ?? 0,
        numberOfMessagesToDisableThinkPrompt: (p.numberOfMessagesToDisableThinkPrompt as number) ?? 0,
        numberOfMessagesToDisableMetaThinkInstructions: (p.numberOfMessagesToDisableMetaThinkInstructions as number) ?? 0,
        numberOfMessagesToDisableDialoguePrompt: (p.numberOfMessagesToDisableDialoguePrompt as number) ?? 0,
        numberOfMessagesToDisableStarterPrompt: (p.numberOfMessagesToDisableStarterPrompt as number) ?? 0,
        forceEqualInitiative: (p.forceEqualInitiative as boolean) ?? false,
        chatProbability: (p.chatProbability as number) ?? 0.8,
        maximumChatStamina: (p.maximumChatStamina as number) ?? 5,
        maximumActionStamina: (p.maximumActionStamina as number) ?? 5,
        nameSensitivity: (p.nameSensitivity as number) ?? 0.3,
        chatImpatienceSensitivity: (p.chatImpatienceSensitivity as number) ?? 0.2,
        skipProbability: (p.skipProbability as number) ?? 0.1,
        memoryRetentionWeight: (p.memoryRetentionWeight as number) ?? 0.5,
        contextSensitivity: (p.contextSensitivity as number) ?? 0.5,
        cacheInvalidationReductionLevel: (p.cacheInvalidationReductionLevel as number) ?? 0,
        doNotInjectDefaultStopTokens: (p.doNotInjectDefaultStopTokens as boolean) ?? false,
        narrateTexts: {
            normal: (rawNarrateTexts.normal as boolean) ?? defaultNarrateTexts.normal,
            quoted: (rawNarrateTexts.quoted as boolean) ?? defaultNarrateTexts.quoted,
            bolded: (rawNarrateTexts.bolded as boolean) ?? defaultNarrateTexts.bolded,
            italicized: (rawNarrateTexts.italicized as boolean) ?? defaultNarrateTexts.italicized,
            parenthesized: (rawNarrateTexts.parenthesized as boolean) ?? defaultNarrateTexts.parenthesized,
            bracketed: (rawNarrateTexts.bracketed as boolean) ?? defaultNarrateTexts.bracketed,
            braced: (rawNarrateTexts.braced as boolean) ?? defaultNarrateTexts.braced,
        },
        stripThinkTokens: (p.stripThinkTokens as boolean) ?? true,
        tools: parseToolsRecord(p.tools, defaultProfileTools) as Record<tool, number>,
        inputStrategy: (p.inputStrategy as Profile['inputStrategy']) || ['System Prompt', 'Chat History', 'Context', 'Location'],
        summarizationSteps: ((p.summarizationSteps as Record<string, unknown>[]) || []).map(s => ({
            id: ensureId(s),
            name: (s.name as string) || (s.strategyType as string) || '',
            description: (s.description as string) || undefined,
            strategyType: (s.strategyType as Profile['summarizationSteps'] extends (infer T)[] ? T : never)['strategyType'] ?? 'Sliding Window Replace',
            enabled: (s.enabled as boolean) ?? true,
            order: (s.order as number) ?? 0,
            slidingWindowSize: s.slidingWindowSize as number | undefined,
            compressionInterval: s.compressionInterval as number | undefined,
            compressionChunkSize: s.compressionChunkSize as number | undefined,
            recursiveChunkSize: s.recursiveChunkSize as number | undefined,
            recursiveMaxDepth: s.recursiveMaxDepth as number | undefined,
            maskingRelevanceThreshold: s.maskingRelevanceThreshold as number | undefined,
            maskingKeywordWeight: s.maskingKeywordWeight as number | undefined,
            summaryTokenBudget: s.summaryTokenBudget as number | undefined,
            summaryModelId: (s.summaryModelId as string) || undefined,
            triggerTokenThreshold: s.triggerTokenThreshold as number | undefined,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        })),
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

export function tryParseGeneratedOutput(text: string, samplers: Sampler[]): GeneratedOutput | null {
    let jsonStr = text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
    try {
        const parsed = JSON.parse(jsonStr);
        if (!parsed || typeof parsed !== 'object') return null;

        const result: GeneratedOutput = {};

        if (Array.isArray(parsed.characters)) {
            result.characters = parsed.characters.map((c: Record<string, unknown>) => fillCharacterDefaults(c, samplers));
        }
        if (Array.isArray(parsed.contexts)) {
            result.contexts = parsed.contexts.map((c: Record<string, unknown>) => fillContextDefaults(c));
        }
        if (Array.isArray(parsed.locations)) {
            result.locations = parsed.locations.map((l: Record<string, unknown>) => fillLocationDefaults(l));
        }
        if (Array.isArray(parsed.audioTracks)) {
            result.audioTracks = parsed.audioTracks.map((t: Record<string, unknown>) => fillAudioTrackDefaults(t));
        }
        if (Array.isArray(parsed.promptBlocks)) {
            result.promptBlocks = parsed.promptBlocks.map((b: Record<string, unknown>) => fillPromptBlockDefaults(b));
        }
        if (parsed.profile && typeof parsed.profile === 'object') {
            result.profile = fillProfileDefaults(parsed.profile as Record<string, unknown>);
        }
        if (parsed.world && typeof parsed.world === 'object') {
            const w = parsed.world as Record<string, unknown>;
            result.world = {
                name: (w.name as string) || 'Unnamed World',
                description: (w.description as string) || undefined,
                characters: Array.isArray(w.characters) ? w.characters.map((c: Record<string, unknown>) => fillCharacterDefaults(c, samplers)) : [],
                contexts: Array.isArray(w.contexts) ? w.contexts.map((c: Record<string, unknown>) => fillContextDefaults(c)) : [],
                locations: Array.isArray(w.locations) ? w.locations.map((l: Record<string, unknown>) => fillLocationDefaults(l)) : [],
                audioTracks: Array.isArray(w.audioTracks) ? w.audioTracks.map((t: Record<string, unknown>) => fillAudioTrackDefaults(t)) : [],
                promptBlocks: Array.isArray(w.promptBlocks) ? w.promptBlocks.map((b: Record<string, unknown>) => fillPromptBlockDefaults(b)) : [],
                profile: w.profile && typeof w.profile === 'object' ? fillProfileDefaults(w.profile as Record<string, unknown>) : undefined,
            };
        }

        if (!result.characters && !result.contexts && !result.locations && !result.audioTracks && !result.promptBlocks && !result.profile && !result.world) return null;
        return result;
    } catch { return null; }
}

export function deriveHistoryLabel(output: GeneratedOutput): string {
    if (output.world) return `🌍 ${output.world.name}`;
    if (output.characters?.length) return `🎭 ${output.characters[0].name}${output.characters.length > 1 ? ` +${output.characters.length - 1}` : ''}`;
    if (output.contexts?.length) return `📜 ${output.contexts[0].name}${output.contexts.length > 1 ? ` +${output.contexts.length - 1}` : ''}`;
    if (output.locations?.length) return `📍 ${output.locations[0].name}${output.locations.length > 1 ? ` +${output.locations.length - 1}` : ''}`;
    if (output.audioTracks?.length) return `🔊 ${output.audioTracks[0].name}${output.audioTracks.length > 1 ? ` +${output.audioTracks.length - 1}` : ''}`;
    if (output.promptBlocks?.length) return `🧱 ${output.promptBlocks[0].name}${output.promptBlocks.length > 1 ? ` +${output.promptBlocks.length - 1}` : ''}`;
    if (output.profile) return `👤 ${output.profile.name}`;
    return 'Unknown';
}

export function resolveWorldCrossReferences(
    world: NonNullable<GeneratedOutput['world']>,
    injectLocationImages: boolean,
    allAudioTracks: AudioTrack[],
): { characters: Character[]; contexts: Context[]; locations: Location[]; audioTracks: AudioTrack[]; promptBlocks: PromptBlock[]; profile?: Profile } {
    const characters = world.characters;
    const contexts = world.contexts;
    const locations = world.locations;

    for (const context of contexts) {
        context.characterBindings = filterValidUuids(context.characterBindings);
    }

    for (const character of characters) {
        for (const clothing of character.clothings) {
            clothing.clothingBindings = filterValidUuids(clothing.clothingBindings);
        }
        for (const injection of character.textCharacterInjections) {
            injection.textCharacterInjectionBindings = filterValidUuids(injection.textCharacterInjectionBindings);
        }
        if (character.dialoguePrompts) {
            for (const dp of character.dialoguePrompts) {
                dp.dialoguePromptBindings = filterValidUuids(dp.dialoguePromptBindings);
            }
        }
        if (character.knowledgePrompts) {
            for (const kp of character.knowledgePrompts) {
                kp.knowledgePromptBindings = filterValidUuids(kp.knowledgePromptBindings);
            }
        }
    }

    const resolvedLocations: Location[] = locations.map(l => ({
        ...l,
        images: injectLocationImages ? l.images : [],
        locationBindings: filterValidUuids(l.locationBindings),
        locationBindingRegularExpressionTriggers: filterRecordKeysByUuid(l.locationBindingRegularExpressionTriggers),
        characterBindings: filterValidUuids(l.characterBindings),
        characterWeights: filterRecordKeysByUuid(l.characterWeights),
        ownerBindings: filterValidUuids(l.ownerBindings),
        locationDistances: filterRecordKeysByUuid(l.locationDistances),
        playAudioTrackOnEnterWeights: filterRecordKeysByUuid(l.playAudioTrackOnEnterWeights),
    }));

    const audioTracks: AudioTrack[] = world.audioTracks.map(t => {
        const existing = allAudioTracks.find(at => at.id === t.id);
        if (existing) return existing;
        return {
            ...t,
            locationBindings: filterValidUuids(t.locationBindings),
            contextBindings: filterValidUuids(t.contextBindings),
            characterBindings: filterValidUuids(t.characterBindings),
        };
    });

    const promptBlocks: PromptBlock[] = world.promptBlocks.map(b => ({
        ...b,
        characterBindings: filterValidUuids(b.characterBindings),
        contextBindings: filterValidUuids(b.contextBindings),
        locationBindings: filterValidUuids(b.locationBindings),
    }));

    return { characters, contexts, locations: resolvedLocations, audioTracks, promptBlocks, profile: world.profile };
}