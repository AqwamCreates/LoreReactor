// src/services/DataPortabilityEngine.ts
import type {
    Character, Context, Location, AudioTrack, Sampler, StopPattern, LanguageModel,
    BudgetStrategy, Profile, InteractionData, InterjectableAction, World, PromptBlock,
} from '../types';
import {
    loadRawCharacter, saveRawCharacter,
    loadRawContext, saveRawContext,
    loadRawLocation, saveRawLocation,
    loadRawAudioTrack, saveRawAudioTrack,
    loadRawSampler, saveRawSampler,
    loadRawStopPattern, saveRawStopPattern,
    loadRawModel, saveRawModel,
    loadRawBudgetStrategy, saveRawBudgetStrategy,
    loadRawProfile, saveRawProfile,
    loadRawWorld, saveRawWorld,
    loadRawPromptBlock, saveRawPromptBlock,
    loadInterjectableActions, saveInterjectableActions,
    loadRawInteractionData, saveRawInteractionData,
    loadInteractionMessages,
} from '../storage/serverStorage';

export interface LoreReactorExport {
    version: 1;
    exportedAt: number;
    characters: Character[];
    contexts: Context[];
    locations: Location[];
    audioTracks: AudioTrack[];
    promptBlocks: PromptBlock[];
    samplers: Sampler[];
    stopPatterns: StopPattern[];
    models: LanguageModel[];
    budgetStrategies: BudgetStrategy[];
    profiles: Profile[];
    worlds: World[];
    interjectableActions: InterjectableAction[];
    chats: InteractionData[];
}

export interface ImportResult {
    success: boolean;
    counts: {
        characters: number; contexts: number; locations: number; audioTracks: number;
        promptBlocks: number; samplers: number; stopPatterns: number; models: number;
        budgetStrategies: number; profiles: number; worlds: number;
        interjectableActions: number; chats: number;
    };
    errors: string[];
}

export function validateExport(data: unknown): data is LoreReactorExport {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    if (d.version !== 1) return false;
    if (typeof d.exportedAt !== 'number') return false;
    if (!Array.isArray(d.characters)) return false;
    if (!Array.isArray(d.contexts)) return false;
    if (!Array.isArray(d.locations)) return false;
    if (!Array.isArray(d.audioTracks)) return false;
    if (!Array.isArray(d.promptBlocks)) return false;
    if (!Array.isArray(d.samplers)) return false;
    if (!Array.isArray(d.stopPatterns)) return false;
    if (!Array.isArray(d.models)) return false;
    if (!Array.isArray(d.budgetStrategies)) return false;
    if (!Array.isArray(d.profiles)) return false;
    if (!Array.isArray(d.worlds)) return false;
    if (!Array.isArray(d.interjectableActions)) return false;
    if (!Array.isArray(d.chats)) return false;
    return true;
}

/**
 * Exports only the selected entity IDs. Fully hydrates each entity.
 */
export async function exportSelectedData(selection: {
    characterIds: string[];
    contextIds: string[];
    locationIds: string[];
    audioTrackIds: string[];
    promptBlockIds: string[];
    samplerIds: string[];
    stopPatternIds: string[];
    modelIds: string[];
    budgetStrategyIds: string[];
    profileIds: string[];
    worldIds: string[];
    includeActions: boolean;
    chatIds: string[];
}): Promise<LoreReactorExport> {
    const data: LoreReactorExport = {
        version: 1, exportedAt: Date.now(),
        characters: [], contexts: [], locations: [], audioTracks: [],
        promptBlocks: [], samplers: [], stopPatterns: [], models: [],
        budgetStrategies: [], profiles: [], worlds: [],
        interjectableActions: [], chats: [],
    };

    // Load individual entities by ID
    for (const id of selection.characterIds) {
        const full = await loadRawCharacter(id);
        if (full) data.characters.push(full);
    }
    for (const id of selection.contextIds) {
        const full = await loadRawContext(id);
        if (full) data.contexts.push(full);
    }
    for (const id of selection.locationIds) {
        const full = await loadRawLocation(id);
        if (full) data.locations.push(full);
    }
    for (const id of selection.audioTrackIds) {
        const full = await loadRawAudioTrack(id);
        if (full) data.audioTracks.push(full);
    }
    for (const id of selection.promptBlockIds) {
        const full = await loadRawPromptBlock(id);
        if (full) data.promptBlocks.push(full);
    }
    for (const id of selection.samplerIds) {
        const full = await loadRawSampler(id);
        if (full) data.samplers.push(full);
    }
    for (const id of selection.stopPatternIds) {
        const full = await loadRawStopPattern(id);
        if (full) data.stopPatterns.push(full);
    }
    for (const id of selection.modelIds) {
        const full = await loadRawModel(id);
        if (full) data.models.push(full);
    }
    for (const id of selection.budgetStrategyIds) {
        const full = await loadRawBudgetStrategy(id);
        if (full) data.budgetStrategies.push(full);
    }
    for (const id of selection.profileIds) {
        const full = await loadRawProfile(id);
        if (full) data.profiles.push(full);
    }
    for (const id of selection.worldIds) {
        const full = await loadRawWorld(id);
        if (full) data.worlds.push(full);
    }

    if (selection.includeActions) {
        try { data.interjectableActions = await loadInterjectableActions(); } catch { /* empty */ }
    }

    for (const id of selection.chatIds) {
        let full = await loadRawInteractionData(id, data.characters);
        if (!full) continue;
        if (!full.interactionHistory.length && (full.numberOfMessages ?? 0) > 0) {
            try { full = await loadInteractionMessages(full); } catch { /* use shell */ }
        }
        data.chats.push(full);
    }

    return data;
}

/**
 * Imports only the entities present in the export envelope.
 * Overwrites existing entities with matching IDs.
 */
export async function importSelectedData(data: LoreReactorExport): Promise<ImportResult> {
    const result: ImportResult = {
        success: true,
        counts: {
            characters: 0, contexts: 0, locations: 0, audioTracks: 0,
            promptBlocks: 0, samplers: 0, stopPatterns: 0, models: 0,
            budgetStrategies: 0, profiles: 0, worlds: 0,
            interjectableActions: 0, chats: 0,
        },
        errors: [],
    };

    // Import in dependency order: base entities first, then dependents
    for (const char of data.characters) {
        try { await saveRawCharacter(char); result.counts.characters++; }
        catch (e) { result.errors.push(`Character "${char.name || char.id}": ${(e as Error).message}`); }
    }
    for (const context of data.contexts) {
        try { await saveRawContext(context); result.counts.contexts++; }
        catch (e) { result.errors.push(`Context "${context.name || context.id}": ${(e as Error).message}`); }
    }
    for (const loc of data.locations) {
        try { await saveRawLocation(loc); result.counts.locations++; }
        catch (e) { result.errors.push(`Location "${loc.name || loc.id}": ${(e as Error).message}`); }
    }
    for (const t of data.audioTracks) {
        try { await saveRawAudioTrack(t); result.counts.audioTracks++; }
        catch (e) { result.errors.push(`Audio Track "${t.name || t.id}": ${(e as Error).message}`); }
    }
    for (const pb of data.promptBlocks) {
        try { await saveRawPromptBlock(pb); result.counts.promptBlocks++; }
        catch (e) { result.errors.push(`Prompt Block "${pb.name || pb.id}": ${(e as Error).message}`); }
    }
    for (const s of data.samplers) {
        try { await saveRawSampler(s); result.counts.samplers++; }
        catch (e) { result.errors.push(`Sampler "${s.name || s.id}": ${(e as Error).message}`); }
    }
    for (const sp of data.stopPatterns) {
        try { await saveRawStopPattern(sp); result.counts.stopPatterns++; }
        catch (e) { result.errors.push(`Stop Pattern "${sp.name || sp.id}": ${(e as Error).message}`); }
    }
    for (const m of data.models) {
        try { await saveRawModel(m); result.counts.models++; }
        catch (e) { result.errors.push(`Model "${m.name || m.id}": ${(e as Error).message}`); }
    }
    for (const b of data.budgetStrategies) {
        try { await saveRawBudgetStrategy(b); result.counts.budgetStrategies++; }
        catch (e) { result.errors.push(`Budget Strategy "${b.name || b.id}": ${(e as Error).message}`); }
    }
    for (const p of data.profiles) {
        try { await saveRawProfile(p); result.counts.profiles++; }
        catch (e) { result.errors.push(`Profile "${p.name || p.id}": ${(e as Error).message}`); }
    }
    for (const w of data.worlds) {
        try { await saveRawWorld(w); result.counts.worlds++; }
        catch (e) { result.errors.push(`World "${w.name || w.id}": ${(e as Error).message}`); }
    }
    if (data.interjectableActions.length > 0) {
        try { await saveInterjectableActions(data.interjectableActions); result.counts.interjectableActions = data.interjectableActions.length; }
        catch (e) { result.errors.push(`Interjectable Actions: ${(e as Error).message}`); }
    }
    // Chats last — they reference characters, contexts, locations, audio tracks
    for (const chat of data.chats) {
        try { await saveRawInteractionData(chat); result.counts.chats++; }
        catch (e) { result.errors.push(`Chat "${chat.name || chat.id}": ${(e as Error).message}`); }
    }

    if (result.errors.length > 0) result.success = false;
    return result;
}