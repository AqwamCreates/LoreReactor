// src/services/aiRecommendationConverters.ts
import type { Character, Context, Location, AudioTrack, Sampler, Profile, PromptBlock, tool } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { UUID_REGEX } from './aiRecommendationTypes';
import type { GeneratedOutput } from './aiRecommendationTypes';

const DEFAULT_CHARACTER_TOOLS: Record<tool, boolean> = {
    roll: true,
    pick: true,
    calculator: false,
    web: false,
};

const DEFAULT_PROFILE_TOOLS: Record<tool, number> = {
    roll: 0,
    pick: 0,
    calculator: 0,
    web: 0,
};

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

function fillCharacterDefaults(c: Record<string, unknown>, samplers: Sampler[]): Character {
    const now = Date.now();
    return {
        id: ensureId(c),
        name: (c.name as string) || 'Unnamed',
        description: (c.description as string) || '',
        systemPrompt: (c.systemPrompt as string) || '',
        thinkPrompt: (c.thinkPrompt as string) || undefined,
        appearancePrompt: (c.appearancePrompt as string) || undefined,
        dialoguePrompt: (c.dialoguePrompt as string) || undefined,
        images: {},
        sampler: samplers.length > 0 ? samplers[0] : undefined,
        initiativeWeight: (c.initiativeWeight as number) ?? 5,
        chatProbability: (c.chatProbability as number) ?? 0.8,
        maximumChatStamina: (c.maximumChatStamina as number) ?? 5,
        nameSensitivity: (c.nameSensitivity as number) ?? 0.3,
        chatImpatienceSensitivity: (c.chatImpatienceSensitivity as number) ?? 0.2,
        skipProbability: (c.skipProbability as number) ?? 0.1,
        memoryRetentionWeight: (c.memoryRetentionWeight as number) ?? 0.5,
        contextSensitivity: (c.contextSensitivity as number) ?? 0.5,
        doNotInjectCharacterImage: (c.doNotInjectCharacterImage as boolean) ?? false,
        numberOfMessagesToDisableThinkPrompt: (c.numberOfMessagesToDisableThinkPrompt as number) ?? 0,
        numberOfMessagesToDisableMetaThinkInstructions: (c.numberOfMessagesToDisableMetaThinkInstructions as number) ?? 0,
        numberOfMessagesToDisableDialoguePrompt: (c.numberOfMessagesToDisableDialoguePrompt as number) ?? 0,
        tools: parseToolsRecord(c.tools, DEFAULT_CHARACTER_TOOLS) as Record<tool, boolean>,
        enableMemoryWriting: (c.enableMemoryWriting as boolean) ?? false,
        enableMemoryReading: (c.enableMemoryReading as boolean) ?? false,
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
        searchTerms: (c.searchTerms as string[]) || undefined,
        urls: (c.urls as string[]) || undefined,
        includeLinkImages: (c.includeLinkImages as boolean) ?? false,
        maximumLinkDepth: (c.maximumLinkDepth as number) ?? 1,
        linkFetchMode: (c.linkFetchMode as Context['linkFetchMode']) ?? 'summary',
        limitLinksToSubdirectory: (c.limitLinksToSubdirectory as boolean) ?? false,
        fetchCacheTimeToLiveMs: (c.fetchCacheTimeToLiveMs as number) || undefined,
        regularExpressionActivationTrigger: (c.regularExpressionActivationTrigger as string) || undefined,
        regularExpressionDeactivationTrigger: (c.regularExpressionDeactivationTrigger as string) || undefined,
        regularExpressionContext: (c.regularExpressionContext as Context['regularExpressionContext']) ?? 'global',
        regularExpressionTarget: (c.regularExpressionTarget as Context['regularExpressionTarget']) ?? 'everyone',
        tokenBudget: (c.tokenBudget as number) ?? 512,
        maximumRecursionDepth: (c.maximumRecursionDepth as number) ?? 1,
        insertionDepth: (c.insertionDepth as number) ?? 0,
        characterBindings: (c.characterBindings as string[]) || [],
        useBase64Encoding: (c.useBase64Encoding as boolean) ?? false,
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
        regularExpressionActivationTrigger: (l.regularExpressionActivationTrigger as string) || undefined,
        backgroundImageRegularExpressionActivationTriggers: (l.backgroundImageRegularExpressionActivationTriggers as Record<number, string>) || {},
        backgroundImageWeights: (l.backgroundImageWeights as Record<number, number>) || {},
        locationBindings: (l.locationBindings as string[]) || [],
        locationBindingRegularExpressionTriggers: (l.locationBindingRegularExpressionTriggers as Record<string, string>) || undefined,
        characterBindings: (l.characterBindings as string[]) || [],
        globalWeight: (l.globalWeight as number) ?? 1,
        characterWeights: (l.characterWeights as Record<string, number>) || {},
        latitude: (l.latitude as number) ?? undefined,
        longitude: (l.longitude as number) ?? undefined,
        locationDistances: (l.locationDistances as Record<string, number>) || {},
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
        regularExpressionActivationTrigger: (t.regularExpressionActivationTrigger as string) || undefined,
        regularExpressionDeactivationTrigger: (t.regularExpressionDeactivationTrigger as string) || undefined,
        locationBindings: (t.locationBindings as string[]) || [],
        contextBindings: (t.contextBindings as string[]) || [],
        characterBindings: (t.characterBindings as string[]) || [],
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
        regularExpressionActivationTrigger: (b.regularExpressionActivationTrigger as string) || undefined,
        regularExpressionDeactivationTrigger: (b.regularExpressionDeactivationTrigger as string) || undefined,
        regularExpressionContext: (b.regularExpressionContext as PromptBlock['regularExpressionContext']) ?? 'global',
        regularExpressionTarget: (b.regularExpressionTarget as PromptBlock['regularExpressionTarget']) ?? 'everyone',
        characterBindings: (b.characterBindings as string[]) || [],
        contextBindings: (b.contextBindings as string[]) || [],
        locationBindings: (b.locationBindings as string[]) || [],
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function fillProfileDefaults(p: Record<string, unknown>): Profile {
    const now = Date.now();
    return {
        id: ensureId(p),
        name: (p.name as string) || 'Unnamed',
        description: (p.description as string) || undefined,
        volume: (p.volume as number) ?? -1,
        forceNameReveal: (p.forceNameReveal as boolean) ?? false,
        enableCharacterExpression: (p.enableCharacterExpression as boolean) ?? false,
        forceNoCharacterImageInjection: (p.forceNoCharacterImageInjection as boolean) ?? false,
        forceNoContextImageInjection: (p.forceNoContextImageInjection as boolean) ?? false,
        forceNoLocationImageInjection: (p.forceNoLocationImageInjection as boolean) ?? false,
        useCurrentDateAndTime: (p.useCurrentDateAndTime as boolean) ?? false,
        useWeather: (p.useWeather as boolean) ?? false,
        weatherApiKey: (p.weatherApiKey as string) || undefined,
        useTimeElapsed: (p.useTimeElapsed as boolean) ?? false,
        numberOfMessagesToDisableThinkPrompt: (p.numberOfMessagesToDisableThinkPrompt as number) ?? 0,
        numberOfMessagesToDisableMetaThinkInstructions: (p.numberOfMessagesToDisableMetaThinkInstructions as number) ?? 0,
        numberOfMessagesToDisableDialoguePrompt: (p.numberOfMessagesToDisableDialoguePrompt as number) ?? 0,
        forceEqualInitiative: (p.forceEqualInitiative as boolean) ?? false,
        chatProbability: (p.chatProbability as number) ?? 0.8,
        maximumChatStamina: (p.maximumChatStamina as number) ?? 5,
        nameSensitivity: (p.nameSensitivity as number) ?? 0.3,
        chatImpatienceSensitivity: (p.chatImpatienceSensitivity as number) ?? 0.2,
        skipProbability: (p.skipProbability as number) ?? 0.1,
        memoryRetentionWeight: (p.memoryRetentionWeight as number) ?? 0.5,
        contextSensitivity: (p.contextSensitivity as number) ?? 0.5,
        cacheInvalidationReductionLevel: (p.cacheInvalidationReductionLevel as number) ?? 0,
        narrateNormalText: (p.narrateNormalText as boolean) ?? true,
        narrateQuotedText: (p.narrateQuotedText as boolean) ?? false,
        narrateBoldedText: (p.narrateBoldedText as boolean) ?? false,
        narrateItalicizedText: (p.narrateItalicizedText as boolean) ?? false,
        stripThinkTokens: (p.stripThinkTokens as boolean) ?? true,
        tools: parseToolsRecord(p.tools, DEFAULT_PROFILE_TOOLS) as Record<tool, number>,
        enableMemoryWriting: (p.enableMemoryWriting as number) ?? 0,
        enableMemoryReading: (p.enableMemoryReading as number) ?? 0,
        inputStrategy: (p.inputStrategy as Profile['inputStrategy']) || ['System Prompt', 'Chat History', 'Context', 'Location'],
        summarizationSteps: ((p.summarizationSteps as Record<string, unknown>[]) || []).map(s => ({
            id: uuidv4(),
            name: (s.strategyType as string) || '',
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

    // Build name→ID maps for cross-reference resolution
    const charNameToId = new Map(characters.map(c => [c.name, c.id]));
    const locNameToId = new Map(world.locations.map(l => [l.name, l.id]));
    const ctxNameToId = new Map(contexts.map(c => [c.name, c.id]));

    const resolveCharRef = (ref: string): string | undefined => {
        if (charNameToId.has(ref)) return charNameToId.get(ref);
        if (UUID_REGEX.test(ref)) return ref;
        return undefined;
    };
    const resolveLocRef = (ref: string): string | undefined => {
        if (locNameToId.has(ref)) return locNameToId.get(ref);
        if (UUID_REGEX.test(ref)) return ref;
        return undefined;
    };
    const resolveCtxRef = (ref: string): string | undefined => {
        if (ctxNameToId.has(ref)) return ctxNameToId.get(ref);
        if (UUID_REGEX.test(ref)) return ref;
        return undefined;
    };

    // Resolve bindings on contexts
    for (const ctx of contexts) {
        ctx.characterBindings = (ctx.characterBindings ?? []).map(resolveCharRef).filter((id): id is string => !!id);
    }

    // Resolve bindings on locations
    const locations: Location[] = world.locations.map(l => {
        const rlb = l.locationBindings.map(resolveLocRef).filter((id): id is string => !!id);
        const rlrt: Record<string, string> = {};
        if (l.locationBindingRegularExpressionTriggers) {
            for (const [ref, regex] of Object.entries(l.locationBindingRegularExpressionTriggers)) {
                const rid = resolveLocRef(ref);
                if (rid) rlrt[rid] = regex;
            }
        }
        const rcb = (l.characterBindings ?? []).map(resolveCharRef).filter((id): id is string => !!id);
        const rcw: Record<string, number> = {};
        for (const [ref, w] of Object.entries(l.characterWeights)) {
            const rid = resolveCharRef(ref);
            if (rid) rcw[rid] = w;
        }
        const rld: Record<string, number> = {};
        for (const [ref, dist] of Object.entries(l.locationDistances)) {
            const rid = resolveLocRef(ref);
            if (rid) rld[rid] = dist;
        }
        return {
            ...l,
            images: injectLocationImages ? l.images : [],
            locationBindings: rlb,
            locationBindingRegularExpressionTriggers: Object.keys(rlrt).length > 0 ? rlrt : undefined,
            characterBindings: rcb,
            characterWeights: rcw,
            locationDistances: rld,
        };
    });

    // Resolve audio tracks — match existing by name/filename, resolve bindings
    const audioTracks: AudioTrack[] = world.audioTracks.map(t => {
        const existing = allAudioTracks.find(at => at.name === t.name || at.filename === t.filename);
        if (existing) return existing;
        return {
            ...t,
            locationBindings: (t.locationBindings ?? []).map(resolveLocRef).filter((id): id is string => !!id),
            contextBindings: (t.contextBindings ?? []).map(resolveCtxRef).filter((id): id is string => !!id),
            characterBindings: (t.characterBindings ?? []).map(resolveCharRef).filter((id): id is string => !!id),
        };
    });

    // Resolve prompt block bindings
    const promptBlocks: PromptBlock[] = world.promptBlocks.map(b => ({
        ...b,
        characterBindings: (b.characterBindings ?? []).map(resolveCharRef).filter((id): id is string => !!id),
        contextBindings: (b.contextBindings ?? []).map(resolveCtxRef).filter((id): id is string => !!id),
        locationBindings: (b.locationBindings ?? []).map(resolveLocRef).filter((id): id is string => !!id),
    }));

    return { characters, contexts, locations, audioTracks, promptBlocks, profile: world.profile };
}