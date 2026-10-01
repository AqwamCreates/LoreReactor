// src/services/DataPortabilityEngine.ts
import type {
    Character, Context, Location, AudioTrack, World, LanguageModel, Sampler, PromptBlock,
    StopPattern, BudgetStrategy, profile, InteractionData, InterjectableAction, Memory,
    Account, MultiplayerData, SessionData, MultiplayerJoinData, ActionFormatData, BudgetData,
} from '../types';
import type { FormatPreferenceData } from './FormatPreferenceEngine';
import {
    loadRawCharacter, saveRawCharacter,
    loadRawContext, saveRawContext,
    loadRawLocation, saveRawLocation,
    loadRawAudioTrack, saveRawAudioTrack,
    loadRawWorld, saveRawWorld,
    loadRawModel, saveRawModel,
    loadRawSampler, saveRawSampler,
    loadRawPromptBlock, saveRawPromptBlock,
    loadRawStopPattern, saveRawStopPattern,
    loadRawBudgetStrategy, saveRawBudgetStrategy,
    loadRawProfile, saveRawProfile,
    loadRawMemory, saveRawMemory,
    loadInterjectableActions, saveInterjectableActions,
    loadRawInteractionData, saveRawInteractionData,
    loadInteractionMessages,
    loadRawAccount, saveRawAccount,
    loadRawMultiplayerData, saveRawMultiplayerData,
    loadRawSessionData, saveRawSessionData,
    loadRawMultiplayerJoinData, saveRawMultiplayerJoinData,
    loadActionFormatData, saveActionFormatData,
    loadRawFormatPreferences, saveRawFormatPreferences,
    loadRawBudgetData, saveRawBudgetData,
} from '../storages/serverStorage';

export interface LoreReactorExport {
    version: 1;
    exportedAt: number;
    chats: InteractionData[];
    characters: Character[];
    contexts: Context[];
    locations: Location[];
    audioTracks: AudioTrack[];
    worlds: World[];
    models: LanguageModel[];
    samplers: Sampler[];
    promptBlocks: PromptBlock[];
    stopPatterns: StopPattern[];
    budgetStrategies: BudgetStrategy[];
    profiles: profile[];
    memories: Memory[];
    accounts: Account[];
    multiplayerData: MultiplayerData[];
    
    // STRICT ORDER: Actions -> Action Format -> Format Preferences -> Session -> Budget
    interjectableActions: InterjectableAction[];
    actionFormatData?: ActionFormatData;
    formatPreferences?: FormatPreferenceData;
    sessionData?: SessionData;
    multiplayerJoinData?: MultiplayerJoinData;
    budgetData?: BudgetData; // Includes Factorization Machine state
}

export interface ImportResult {
    success: boolean;
    counts: {
        chats: number; characters: number; contexts: number; locations: number; audioTracks: number;
        worlds: number; models: number; samplers: number; promptBlocks: number; stopPatterns: number;
        budgetStrategies: number; profiles: number; memories: number; accounts: number;
        multiplayerData: number; interjectableActions: number; preferences: number;
    };
    errors: string[];
}

export function validateExport(data: unknown): data is LoreReactorExport {
    if (!data || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    if (d.version !== 1) return false;
    if (typeof d.exportedAt !== 'number' && typeof d.exportedAt !== 'string') return false;
    if (!Array.isArray(d.chats)) return false;
    if (!Array.isArray(d.characters)) return false;
    if (!Array.isArray(d.contexts)) return false;
    if (!Array.isArray(d.locations)) return false;
    if (!Array.isArray(d.audioTracks)) return false;
    if (!Array.isArray(d.worlds)) return false;
    if (!Array.isArray(d.models)) return false;
    if (!Array.isArray(d.samplers)) return false;
    if (!Array.isArray(d.promptBlocks)) return false;
    if (!Array.isArray(d.stopPatterns)) return false;
    if (!Array.isArray(d.budgetStrategies)) return false;
    if (!Array.isArray(d.profiles)) return false;
    if (d.memories !== undefined && !Array.isArray(d.memories)) return false;
    if (d.accounts !== undefined && !Array.isArray(d.accounts)) return false;
    if (d.multiplayerData !== undefined && !Array.isArray(d.multiplayerData)) return false;
    if (!Array.isArray(d.interjectableActions)) return false;
    return true;
}

export function normalizeExport(data: LoreReactorExport): LoreReactorExport {
    if (typeof data.exportedAt === 'string') {
        data.exportedAt = new Date(data.exportedAt).getTime() || Date.now();
    }
    return data;
}

export async function exportSelectedData(selection: {
    chatIds: string[];
    characterIds: string[];
    contextIds: string[];
    locationIds: string[];
    audioTrackIds: string[];
    worldIds: string[];
    modelIds: string[];
    samplerIds: string[];
    promptBlockIds: string[];
    stopPatternIds: string[];
    budgetStrategyIds: string[];
    profileIds: string[];
    memoryIds: string[];
    accountIds: string[];
    multiplayerDataIds: string[];
    includeActions: boolean;
    includeActionFormatData: boolean;
    includeFormatPreferences: boolean;
    includeSessionData: boolean;
    includeBudgetData: boolean;
}): Promise<LoreReactorExport> {
    const data: LoreReactorExport = {
        version: 1, exportedAt: Date.now(),
        chats: [], characters: [], contexts: [], locations: [], audioTracks: [],
        worlds: [], models: [], samplers: [], promptBlocks: [], stopPatterns: [],
        budgetStrategies: [], profiles: [], memories: [], accounts: [],
        multiplayerData: [], interjectableActions: [],
    };

    for (const id of selection.chatIds) {
        let full = await loadRawInteractionData(id, []);
        if (!full) continue;
        
        // FIX: Replaced the non-existent flat `interactionHistory` array with a reduction 
        // over the spatially-partitioned `interactionHistories` Record.
        const messageCount = Object.values(full.interactionHistories || {}).reduce((sum, msgs) => sum + msgs.length, 0);
        if (messageCount === 0 && (full.numberOfMessages ?? 0) > 0) {
            try { full = await loadInteractionMessages(full); } catch { /* use shell */ }
        }
        data.chats.push(full as InteractionData);
    }
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
    for (const id of selection.worldIds) {
        const full = await loadRawWorld(id);
        if (full) data.worlds.push(full);
    }
    for (const id of selection.modelIds) {
        const full = await loadRawModel(id);
        if (full) data.models.push(full);
    }
    for (const id of selection.samplerIds) {
        const full = await loadRawSampler(id);
        if (full) data.samplers.push(full);
    }
    for (const id of selection.promptBlockIds) {
        const full = await loadRawPromptBlock(id);
        if (full) data.promptBlocks.push(full);
    }
    for (const id of selection.stopPatternIds) {
        const full = await loadRawStopPattern(id);
        if (full) data.stopPatterns.push(full);
    }
    for (const id of selection.budgetStrategyIds) {
        const full = await loadRawBudgetStrategy(id);
        if (full) data.budgetStrategies.push(full);
    }
    for (const id of selection.profileIds) {
        const full = await loadRawProfile(id);
        if (full) data.profiles.push(full);
    }
    for (const id of selection.memoryIds) {
        const full = await loadRawMemory(id);
        if (full) data.memories.push(full);
    }
    for (const id of selection.accountIds) {
        const full = await loadRawAccount(id);
        if (full) data.accounts.push(full);
    }
    for (const id of selection.multiplayerDataIds) {
        const full = await loadRawMultiplayerData(id);
        if (full) data.multiplayerData.push(full);
    }

    // STRICT ORDER: Actions -> Action Format -> Format Preferences -> Session -> Budget
    if (selection.includeActions) {
        try { data.interjectableActions = await loadInterjectableActions(); } catch { /* empty */ }
    }
    if (selection.includeActionFormatData) {
        try { data.actionFormatData = await loadActionFormatData(); } catch { /* empty */ }
    }
    if (selection.includeFormatPreferences) {
        try { 
            const fp = await loadRawFormatPreferences(); 
            if (fp) data.formatPreferences = fp; 
        } catch { /* empty */ }
    }
    if (selection.includeSessionData) {
        try { data.sessionData = await loadRawSessionData(); } catch { /* empty */ }
        try { data.multiplayerJoinData = await loadRawMultiplayerJoinData(); } catch { /* empty */ }
    }
    if (selection.includeBudgetData) {
        try { 
            const bd = await loadRawBudgetData(); 
            if (bd) data.budgetData = bd; // Includes Factorization Machine state
        } catch { /* empty */ }
    }

    return data;
}

export async function importSelectedData(data: LoreReactorExport): Promise<ImportResult> {
    const result: ImportResult = {
        success: true,
        counts: {
            chats: 0, characters: 0, contexts: 0, locations: 0, audioTracks: 0,
            worlds: 0, models: 0, samplers: 0, promptBlocks: 0, stopPatterns: 0,
            budgetStrategies: 0, profiles: 0, memories: 0, accounts: 0,
            multiplayerData: 0, interjectableActions: 0, preferences: 0,
        },
        errors: [],
    };

    // Base entities first
    for (const mem of (data.memories ?? [])) {
        try { await saveRawMemory(mem); result.counts.memories++; }
        catch (e) { result.errors.push(`Memory "${mem.name || mem.id}": ${(e as Error).message}`); }
    }
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
    for (const w of data.worlds) {
        try { await saveRawWorld(w); result.counts.worlds++; }
        catch (e) { result.errors.push(`World "${w.name || w.id}": ${(e as Error).message}`); }
    }
    for (const m of data.models) {
        try { await saveRawModel(m); result.counts.models++; }
        catch (e) { result.errors.push(`Model "${m.name || m.id}": ${(e as Error).message}`); }
    }
    for (const s of data.samplers) {
        try { await saveRawSampler(s); result.counts.samplers++; }
        catch (e) { result.errors.push(`Sampler "${s.name || s.id}": ${(e as Error).message}`); }
    }
    for (const pb of data.promptBlocks) {
        try { await saveRawPromptBlock(pb); result.counts.promptBlocks++; }
        catch (e) { result.errors.push(`Prompt Block "${pb.name || pb.id}": ${(e as Error).message}`); }
    }
    for (const sp of data.stopPatterns) {
        try { await saveRawStopPattern(sp); result.counts.stopPatterns++; }
        catch (e) { result.errors.push(`Stop Pattern "${sp.name || sp.id}": ${(e as Error).message}`); }
    }
    for (const b of data.budgetStrategies) {
        try { await saveRawBudgetStrategy(b); result.counts.budgetStrategies++; }
        catch (e) { result.errors.push(`Budget Strategy "${b.name || b.id}": ${(e as Error).message}`); }
    }
    for (const p of data.profiles) {
        try { await saveRawProfile(p); result.counts.profiles++; }
        catch (e) { result.errors.push(`profile "${p.name || p.id}": ${(e as Error).message}`); }
    }
    for (const acc of (data.accounts ?? [])) {
        try { await saveRawAccount(acc); result.counts.accounts++; }
        catch (e) { result.errors.push(`Account "${acc.name || acc.id}": ${(e as Error).message}`); }
    }
    for (const md of (data.multiplayerData ?? [])) {
        try { await saveRawMultiplayerData(md); result.counts.multiplayerData++; }
        catch (e) { result.errors.push(`Multiplayer Data "${md.name || md.id}": ${(e as Error).message}`); }
    }

    // STRICT ORDER: Actions -> Action Format -> Format Preferences -> Session -> Budget
    if (data.interjectableActions.length > 0) {
        try { await saveInterjectableActions(data.interjectableActions); result.counts.interjectableActions = data.interjectableActions.length; }
        catch (e) { result.errors.push(`Interjectable Actions: ${(e as Error).message}`); }
    }
    if (data.actionFormatData) {
        try { await saveActionFormatData(data.actionFormatData); result.counts.preferences++; }
        catch (e) { result.errors.push(`Action Format Data: ${(e as Error).message}`); }
    }
    if (data.formatPreferences) {
        try { await saveRawFormatPreferences(data.formatPreferences); result.counts.preferences++; }
        catch (e) { result.errors.push(`Format Preferences: ${(e as Error).message}`); }
    }
    if (data.sessionData) {
        try { await saveRawSessionData(data.sessionData); result.counts.preferences++; }
        catch (e) { result.errors.push(`Session Data: ${(e as Error).message}`); }
    }
    if (data.multiplayerJoinData) {
        try { await saveRawMultiplayerJoinData(data.multiplayerJoinData); result.counts.preferences++; }
        catch (e) { result.errors.push(`Multiplayer Join Data: ${(e as Error).message}`); }
    }
    if (data.budgetData) {
        try { await saveRawBudgetData(data.budgetData); result.counts.preferences++; }
        catch (e) { result.errors.push(`Budget Data: ${(e as Error).message}`); }
    }

    // Chats last
    for (const chat of data.chats) {
        try { await saveRawInteractionData(chat); result.counts.chats++; }
        catch (e) { result.errors.push(`Chat "${chat.name || chat.id}": ${(e as Error).message}`); }
    }

    if (result.errors.length > 0) result.success = false;
    return result;
}