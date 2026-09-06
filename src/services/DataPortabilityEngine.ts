// src/services/DataPortabilityEngine.ts
import type {
    Character, Context, Location, Sampler, StopPattern, LanguageModel,
    BudgetStrategy, Profile, InteractionData, InterjectableAction,
} from '../types';
import {
    loadRawCharacter, saveRawCharacter,
    loadRawContext, saveRawContext,
    loadRawLocation, saveRawLocation,
    loadAllRawSamplers, saveRawSampler,
    loadAllRawStopPatterns, saveRawStopPattern,
    loadAllRawModels, saveRawModel,
    loadAllRawBudgetStrategies, saveRawBudgetStrategy,
    loadAllRawProfiles, saveRawProfile,
    loadInterjectableActions, saveInterjectableActions,
    loadRawInteractionData, saveRawInteractionData,
    loadInteractionMessages,
} from '../hooks/storage';

export interface LoreReactorExport {
    version: 1;
    exportedAt: number;
    characters: Character[];
    contexts: Context[];
    locations: Location[];
    samplers: Sampler[];
    stopPatterns: StopPattern[];
    models: LanguageModel[];
    budgetStrategies: BudgetStrategy[];
    profiles: Profile[];
    interjectableActions: InterjectableAction[];
    chats: InteractionData[];
}

export interface ImportResult {
    success: boolean;
    counts: {
        characters: number; contexts: number; locations: number; samplers: number;
        stopPatterns: number; models: number; budgetStrategies: number; profiles: number;
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
    if (!Array.isArray(d.samplers)) return false;
    if (!Array.isArray(d.stopPatterns)) return false;
    if (!Array.isArray(d.models)) return false;
    if (!Array.isArray(d.budgetStrategies)) return false;
    if (!Array.isArray(d.profiles)) return false;
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
    samplerIds: string[];
    stopPatternIds: string[];
    modelIds: string[];
    budgetStrategyIds: string[];
    profileIds: string[];
    includeActions: boolean;
    chatIds: string[];
}): Promise<LoreReactorExport> {
    const data: LoreReactorExport = {
        version: 1, exportedAt: Date.now(),
        characters: [], contexts: [], locations: [], samplers: [], stopPatterns: [],
        models: [], budgetStrategies: [], profiles: [], interjectableActions: [], chats: [],
    };

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

    // Samplers, stop patterns, models, budget strategies, profiles — filter from full lists
    if (selection.samplerIds.length > 0) {
        const all = await loadAllRawSamplers();
        for (const s of all) { if (selection.samplerIds.includes(s.id)) data.samplers.push(s as Sampler); }
    }
    if (selection.stopPatternIds.length > 0) {
        const all = await loadAllRawStopPatterns();
        for (const s of all) { if (selection.stopPatternIds.includes(s.id)) data.stopPatterns.push(s as StopPattern); }
    }
    if (selection.modelIds.length > 0) {
        const all = await loadAllRawModels();
        for (const m of all) { if (selection.modelIds.includes(m.id)) data.models.push(m as LanguageModel); }
    }
    if (selection.budgetStrategyIds.length > 0) {
        const all = await loadAllRawBudgetStrategies();
        for (const b of all) { if (selection.budgetStrategyIds.includes(b.id)) data.budgetStrategies.push(b as BudgetStrategy); }
    }
    if (selection.profileIds.length > 0) {
        const all = await loadAllRawProfiles();
        for (const p of all) { if (selection.profileIds.includes(p.id)) data.profiles.push(p as Profile); }
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
        counts: { characters: 0, contexts: 0, locations: 0, samplers: 0, stopPatterns: 0, models: 0, budgetStrategies: 0, profiles: 0, interjectableActions: 0, chats: 0 },
        errors: [],
    };

    for (const char of data.characters) {
        try { await saveRawCharacter(char); result.counts.characters++; }
        catch (e) { result.errors.push(`Character "${char.name || char.id}": ${(e as Error).message}`); }
    }
    for (const ctx of data.contexts) {
        try { await saveRawContext(ctx); result.counts.contexts++; }
        catch (e) { result.errors.push(`Context "${ctx.name || ctx.id}": ${(e as Error).message}`); }
    }
    for (const loc of data.locations) {
        try { await saveRawLocation(loc); result.counts.locations++; }
        catch (e) { result.errors.push(`Location "${loc.name || loc.id}": ${(e as Error).message}`); }
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
    if (data.interjectableActions.length > 0) {
        try { await saveInterjectableActions(data.interjectableActions); result.counts.interjectableActions = data.interjectableActions.length; }
        catch (e) { result.errors.push(`Interjectable Actions: ${(e as Error).message}`); }
    }
    for (const chat of data.chats) {
        try { await saveRawInteractionData(chat); result.counts.chats++; }
        catch (e) { result.errors.push(`Chat "${chat.name || chat.id}": ${(e as Error).message}`); }
    }

    if (result.errors.length > 0) result.success = false;
    return result;
}