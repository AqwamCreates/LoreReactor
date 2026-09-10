// src/services/aiRecommendationConverters.ts
import type { Character, Context, Location, AudioTrack, Sampler, Profile } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { UUID_REGEX } from './aiRecommendationTypes';
import type { GeneratedOutput } from './aiRecommendationTypes';

function ensureId(obj: Record<string, unknown>): string {
    return (typeof obj.id === 'string' && obj.id.length > 0) ? obj.id : uuidv4();
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
        enableWebSearch: (c.enableWebSearch as boolean) ?? false,
        enableCalculator: (c.enableCalculator as boolean) ?? false,
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

function fillProfileDefaults(p: Record<string, unknown>): Profile {
    const now = Date.now();
    return {
        id: ensureId(p),
        name: (p.name as string) || 'Unnamed',
        description: (p.description as string) || undefined,
        forceNameReveal: (p.forceNameReveal as boolean) ?? false,
        enableCharacterExpression: (p.enableCharacterExpression as boolean) ?? false,
        forceNoCharacterImageInjection: (p.forceNoCharacterImageInjection as boolean) ?? false,
        forceNoContextImageInjection: (p.forceNoContextImageInjection as boolean) ?? false,
        useCurrentDateAndTime: (p.useCurrentDateAndTime as boolean) ?? false,
        useWeather: (p.useWeather as boolean) ?? false,
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
        enableWebSearch: (p.enableWebSearch as number) ?? 0,
        enableCalculator: (p.enableCalculator as number) ?? 0,
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
                audioTracks: Array.isArray(w.audioTracks) ? w.audioTracks.map((t: Record<string, unknown>) => fillAudioTrackDefaults(t)) : undefined,
                profile: w.profile && typeof w.profile === 'object' ? fillProfileDefaults(w.profile as Record<string, unknown>) : undefined,
            };
        }

        if (!result.characters && !result.contexts && !result.locations && !result.profile && !result.world) return null;
        return result;
    } catch { return null; }
}

export function deriveHistoryLabel(output: GeneratedOutput): string {
    if (output.world) return `🌍 ${output.world.name}`;
    if (output.characters?.length) return `🎭 ${output.characters[0].name}${output.characters.length > 1 ? ` +${output.characters.length - 1}` : ''}`;
    if (output.contexts?.length) return `📜 ${output.contexts[0].name}${output.contexts.length > 1 ? ` +${output.contexts.length - 1}` : ''}`;
    if (output.locations?.length) return `📍 ${output.locations[0].name}${output.locations.length > 1 ? ` +${output.locations.length - 1}` : ''}`;
    if (output.profile) return `👤 ${output.profile.name}`;
    return 'Unknown';
}

export function resolveWorldCrossReferences(
    world: NonNullable<GeneratedOutput['world']>,
    injectLocationImages: boolean,
    allAudioTracks: AudioTrack[],
): { characters: Character[]; contexts: Context[]; locations: Location[]; audioTracks: AudioTrack[]; profile?: Profile } {
    // Characters and contexts already have IDs from parsing
    const characters = world.characters;
    const contexts = world.contexts;

    // Build name→ID maps for cross-reference resolution
    const charNameToId = new Map(characters.map(c => [c.name, c.id]));
    const locNameToId = new Map(world.locations.map(l => [l.name, l.id]));

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
            characterWeights: rcw,
            locationDistances: rld,
        };
    });

    // Resolve audio tracks — match existing by name/filename or keep generated
    const audioTracks: AudioTrack[] = (world.audioTracks || []).map(t => {
        const existing = allAudioTracks.find(at => at.name === t.name || at.filename === t.filename);
        return existing || t;
    });

    return { characters, contexts, locations, audioTracks, profile: world.profile };
}