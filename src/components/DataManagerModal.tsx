// src/components/DataManagerModal.tsx
import { useState, useCallback, useMemo } from 'react';
import type { Character, Context, Location, AudioTrack, World, PromptBlock, LanguageModel, Sampler, StopPattern, BudgetStrategy, Profile, Memory, RawInteractionData, Account, MultiplayerData } from '../types';
import { useToast } from '../context/ToastContext';
import '../main.css';

interface DataManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allPromptBlocks: PromptBlock[];
    allModels: LanguageModel[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allMemories: Memory[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    rawChatShells: RawInteractionData[];
    onDeleteCharacter: (id: string) => void;
    onDeleteContext: (id: string) => void;
    onDeleteLocation: (id: string) => void;
    onDeleteAudioTrack: (id: string) => void;
    onDeleteWorld: (id: string) => void;
    onDeletePromptBlock: (id: string) => void;
    onDeleteModel: (id: string) => void;
    onDeleteSampler: (id: string) => void;
    onDeleteStopPattern: (id: string) => void;
    onDeleteBudgetStrategy: (id: string) => void;
    onDeleteProfile: (id: string) => void;
    onDeleteMemory: (id: string) => void;
    onDeleteAccount: (id: string) => void;
    onDeleteMultiplayerData: (id: string) => void;
    onDeleteChat: (id: string) => void;
}

type TabId = 'storage' | 'cleanup' | 'integrity' | 'cache' | 'bulk' | 'danger';

type EntityType = 'character' | 'context' | 'location' | 'audioTrack' | 'world' | 'promptBlock' | 'model' | 'sampler' | 'stopPattern' | 'budgetStrategy' | 'profile' | 'memory' | 'account' | 'multiplayerData';

type SortField = 'name' | 'type' | 'lastUpdated' | 'flags';
type SortDirection = 'asc' | 'desc';

interface CleanupItem {
    type: EntityType;
    id: string;
    name: string;
    lastUpdatedTimestamp: number;
    isOrphan: boolean;
    isHollow: boolean;
    isStale: boolean;
}

interface IntegrityIssue {
    entityType: string;
    entityName: string;
    issue: string;
    refType?: string;
    refId?: string;
}

interface StorageBreakdown {
    label: string;
    icon: string;
    count: number;
    estimatedSizeKb: number;
}

type ExclusionEntityType = 'character' | 'context' | 'location' | 'audioTrack' | 'profile';

interface ExclusionEntry {
    entityType: ExclusionEntityType;
    id: string;
    name: string;
}

const ENTITY_TYPE_META: Record<EntityType, { icon: string; label: string }> = {
    character: { icon: '🎭', label: 'Characters' },
    context: { icon: '📜', label: 'Contexts' },
    location: { icon: '📍', label: 'Locations' },
    audioTrack: { icon: '🔊', label: 'Audio Tracks' },
    world: { icon: '🌍', label: 'Worlds' },
    promptBlock: { icon: '🧱', label: 'Prompt Blocks' },
    model: { icon: '🤖', label: 'Language Models' },
    sampler: { icon: '🎚️', label: 'Samplers' },
    stopPattern: { icon: '🛑', label: 'Stop Patterns' },
    budgetStrategy: { icon: '💰', label: 'Budget Strategies' },
    profile: { icon: '👤', label: 'Profiles' },
    memory: { icon: '🧠', label: 'Memories' },
    account: { icon: '🔑', label: 'Accounts' },
    multiplayerData: { icon: '👥', label: 'Multiplayer Data' },
};

const EXCLUSION_TYPE_META: Record<ExclusionEntityType, { icon: string; label: string }> = {
    character: { icon: '🎭', label: 'Characters' },
    context: { icon: '📜', label: 'Contexts' },
    location: { icon: '📍', label: 'Locations' },
    audioTrack: { icon: '🔊', label: 'Audio Tracks' },
    profile: { icon: '👤', label: 'Profiles' },
};

function isEntityHollow(
    type: EntityType,
    entity: unknown,
    nameIsMeaningful: boolean,
    descriptionIsMeaningful: boolean,
): boolean {
    const e = entity as { name?: string; description?: string };
    if (nameIsMeaningful && e.name && e.name.trim().length > 0) return false;
    if (descriptionIsMeaningful && e.description && e.description.trim().length > 0) return false;

    switch (type) {
        case 'character': {
            const c = entity as Character;
            const hasTextInjections = c.textCharacterInjections && c.textCharacterInjections.length > 0;
            const hasNonEmptyTextInjection = hasTextInjections && c.textCharacterInjections.some(ti =>
                (ti.textCharacters && ti.textCharacters.length > 0) ||
                (ti.textCharacterInjectionBindings && ti.textCharacterInjectionBindings.length > 0) ||
                (ti.textCharacterWeights && Object.keys(ti.textCharacterWeights).length > 0)
            );
            const hasDialoguePrompts = c.dialoguePrompts && c.dialoguePrompts.length > 0;
            const hasNonEmptyDialoguePrompt = hasDialoguePrompts && c.dialoguePrompts?.some(dp => dp.content?.trim());
            const hasKnowledgePrompts = c.knowledgePrompts && c.knowledgePrompts.length > 0;
            const hasNonEmptyKnowledgePrompt = hasKnowledgePrompts && c.knowledgePrompts?.some(kp => kp.content?.trim());
            const hasStarterPrompts = c.starterPrompts && Object.keys(c.starterPrompts).length > 0;
            return !(c.systemPrompt?.trim() || c.appearancePrompt?.trim() || hasNonEmptyDialoguePrompt || hasNonEmptyKnowledgePrompt || c.thinkPrompt?.trim() || hasStarterPrompts)
                && !(c.images && Object.keys(c.images).length > 0)
                && !c.voice?.trim()
                && !(c.memories && Object.values(c.memories).some(arr => arr.length > 0))
                && !(c.tools && Object.values(c.tools).some(v => v))
                && !(c.clothings && c.clothings.length > 0)
                && !hasNonEmptyTextInjection;
        }
        case 'context': {
            const c = entity as Context;
            return !c.text?.trim() && !(c.urls?.length) && !(c.searchTerms?.length) && !(c.images?.length) && !c.searchEngine;
        }
        case 'location': {
            const l = entity as Location;
            return !l.text?.trim() && !(l.images?.length) && !(l.locationBindings?.length) && !(l.characterWeights && Object.keys(l.characterWeights).length > 0);
        }
        case 'audioTrack': {
            const a = entity as AudioTrack;
            return !a.filename || !a.filename.trim();
        }
        case 'world': {
            const w = entity as World;
            return !w.characterIds?.length && !w.contextIds?.length && !w.locationIds?.length && !w.audioTrackIds?.length && !w.promptBlockIds?.length;
        }
        case 'promptBlock': {
            const p = entity as PromptBlock;
            return !p.textContent?.trim() && !(p.images?.length);
        }
        case 'model': {
            const m = entity as LanguageModel;
            return !m.model?.trim() && !m.apiKey?.trim();
        }
        case 'sampler': {
            const s = entity as Sampler;
            const hasParams = s.parameters && Object.keys(s.parameters).length > 0;
            return !hasParams && !(s.stopPatterns?.length);
        }
        case 'stopPattern': {
            const sp = entity as StopPattern;
            return !sp.pattern?.trim();
        }
        case 'budgetStrategy': {
            const bs = entity as BudgetStrategy;
            return !(bs.onlineModels?.length) && !(bs.localModels?.length);
        }
        case 'memory': {
            const m = entity as Memory;
            return !m.content?.trim();
        }
        case 'account': {
            const a = entity as Account;
            return !a.username?.trim();
        }
        case 'multiplayerData': {
            const md = entity as MultiplayerData;
            return !(md.interactionDataIds?.length) && !(md.whiteListedAccountIds?.length) && !(md.blacklistedAccountIds?.length) && !(md.administratorAccountIds?.length) && !(md.accountIdCharacterIds && Object.keys(md.accountIdCharacterIds).length > 0);
        }
        case 'profile':
            return false;
    }
}

function formatDate(ts: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysAgo(ts: number): number {
    if (!ts) return Number.POSITIVE_INFINITY;
    return Math.floor((Date.now() - ts) / 86400000);
}

export function DataManagerModal({
    isOpen,
    onClose,
    allCharacters,
    allContexts,
    allLocations,
    allAudioTracks,
    allWorlds,
    allPromptBlocks,
    allModels,
    allSamplers,
    allStopPatterns,
    allBudgetStrategies,
    allProfiles,
    allMemories,
    allAccounts,
    allMultiplayerData,
    rawChatShells,
    onDeleteCharacter,
    onDeleteContext,
    onDeleteLocation,
    onDeleteAudioTrack,
    onDeleteWorld,
    onDeletePromptBlock,
    onDeleteModel,
    onDeleteSampler,
    onDeleteStopPattern,
    onDeleteBudgetStrategy,
    onDeleteProfile,
    onDeleteMemory,
    onDeleteAccount,
    onDeleteMultiplayerData,
    onDeleteChat,
}: DataManagerModalProps) {
    const [activeTab, setActiveTab] = useState<TabId>('storage');
    const [cleanupItems, setCleanupItems] = useState<CleanupItem[]>([]);
    const [integrityIssues, setIntegrityIssues] = useState<IntegrityIssue[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [showOrphans, setShowOrphans] = useState(true);
    const [showHollows, setShowHollows] = useState(true);
    const [showStale, setShowStale] = useState(true);
    const [staleDaysCleanup, setStaleDaysCleanup] = useState(90);
    const [nameIsMeaningful, setNameIsMeaningful] = useState(false);
    const [descriptionIsMeaningful, setDescriptionIsMeaningful] = useState(false);
    const [sortField, setSortField] = useState<SortField>('name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [staleDaysThreshold, setStaleDaysThreshold] = useState(30);
    const [minMessagesThreshold, setMinMessagesThreshold] = useState(3);
    const [includeStale, setIncludeStale] = useState(true);
    const [includeLowMessage, setIncludeLowMessage] = useState(false);
    const [exclusions, setExclusions] = useState<ExclusionEntry[]>([]);
    const [exclusionDropdownType, setExclusionDropdownType] = useState<ExclusionEntityType>('character');
    const [exclusionSearchQuery, setExclusionSearchQuery] = useState('');
    const [isExclusionDropdownOpen, setIsExclusionDropdownOpen] = useState(false);
    const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
    const [confirmDangerAction, setConfirmDangerAction] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const { addToast } = useToast();

    // ─── Anchor timestamp for stale calculations (captured once at mount via lazy initializer) ────
    const [anchorTimeMs] = useState(() => Date.now());
    const staleCutoffMs = anchorTimeMs - staleDaysThreshold * 86400000;

    // ─── Storage Breakdown ──────────────────────────────────────────
    const storageBreakdown = useMemo<StorageBreakdown[]>(() => {
        const estimateKb = (items: unknown[], avgBytesPerItem: number) =>
            Math.round((items.length * avgBytesPerItem) / 1024);
        return [
            { label: 'Characters', icon: '🎭', count: allCharacters.length, estimatedSizeKb: estimateKb(allCharacters, 4096) },
            { label: 'Contexts', icon: '📜', count: allContexts.length, estimatedSizeKb: estimateKb(allContexts, 2048) },
            { label: 'Locations', icon: '📍', count: allLocations.length, estimatedSizeKb: estimateKb(allLocations, 2048) },
            { label: 'Audio Tracks', icon: '🔊', count: allAudioTracks.length, estimatedSizeKb: estimateKb(allAudioTracks, 512) },
            { label: 'Worlds', icon: '🌍', count: allWorlds.length, estimatedSizeKb: estimateKb(allWorlds, 1024) },
            { label: 'Prompt Blocks', icon: '🧱', count: allPromptBlocks.length, estimatedSizeKb: estimateKb(allPromptBlocks, 1536) },
            { label: 'Language Models', icon: '🤖', count: allModels.length, estimatedSizeKb: estimateKb(allModels, 1024) },
            { label: 'Samplers', icon: '🎚️', count: allSamplers.length, estimatedSizeKb: estimateKb(allSamplers, 512) },
            { label: 'Stop Patterns', icon: '🛑', count: allStopPatterns.length, estimatedSizeKb: estimateKb(allStopPatterns, 256) },
            { label: 'Budget Strategies', icon: '💰', count: allBudgetStrategies.length, estimatedSizeKb: estimateKb(allBudgetStrategies, 1024) },
            { label: 'Profiles', icon: '👤', count: allProfiles.length, estimatedSizeKb: estimateKb(allProfiles, 2048) },
            { label: 'Memories', icon: '🧠', count: allMemories.length, estimatedSizeKb: estimateKb(allMemories, 1024) },
            { label: 'Accounts', icon: '🔑', count: allAccounts.length, estimatedSizeKb: estimateKb(allAccounts, 512) },
            { label: 'Multiplayer Data', icon: '👥', count: allMultiplayerData.length, estimatedSizeKb: estimateKb(allMultiplayerData, 1024) },
            { label: 'Chat Sessions', icon: '💬', count: rawChatShells.length, estimatedSizeKb: estimateKb(rawChatShells, 8192) },
        ];
    }, [allCharacters, allContexts, allLocations, allAudioTracks, allWorlds, allPromptBlocks, allModels, allSamplers, allStopPatterns, allBudgetStrategies, allProfiles, allMemories, allAccounts, allMultiplayerData, rawChatShells]);

    // ─── Cleanup Scan ───────────────────────────────────────────────
    const scanCleanup = useCallback(() => {
        setIsScanning(true);

        const charIdSet = new Set(allCharacters.map(c => c.id));
        const ctxIdSet = new Set(allContexts.map(c => c.id));
        const locIdSet = new Set(allLocations.map(l => l.id));
        const audioIdSet = new Set(allAudioTracks.map(a => a.id));
        const pbIdSet = new Set(allPromptBlocks.map(b => b.id));
        const modelIdSet = new Set(allModels.map(m => m.id));
        const samplerIdSet = new Set(allSamplers.map(s => s.id));
        const stopPatternIdSet = new Set(allStopPatterns.map(sp => sp.id));
        const profileIdSet = new Set(allProfiles.map(p => p.id));
        const memoryIdSet = new Set(allMemories.map(m => m.id));
        const accountIdSet = new Set(allAccounts.map(a => a.id));
        const chatIdSet = new Set(rawChatShells.filter(s => s.id).map(s => s.id));

        const referencedCharIds = new Set<string>();
        const referencedCtxIds = new Set<string>();
        const referencedLocIds = new Set<string>();
        const referencedAudioIds = new Set<string>();
        const referencedPbIds = new Set<string>();
        const referencedModelIds = new Set<string>();
        const referencedSamplerIds = new Set<string>();
        const referencedStopPatternIds = new Set<string>();
        const referencedProfileIds = new Set<string>();
        const referencedMemoryIds = new Set<string>();
        const referencedAccountIds = new Set<string>();
        const referencedMultiplayerDataIds = new Set<string>();

        for (const world of allWorlds) {
            for (const id of world.characterIds) if (charIdSet.has(id)) referencedCharIds.add(id);
            for (const id of world.contextIds) if (ctxIdSet.has(id)) referencedCtxIds.add(id);
            for (const id of world.locationIds) if (locIdSet.has(id)) referencedLocIds.add(id);
            for (const id of world.audioTrackIds) if (audioIdSet.has(id)) referencedAudioIds.add(id);
            for (const id of world.promptBlockIds) if (pbIdSet.has(id)) referencedPbIds.add(id);
            if (world.profileId && profileIdSet.has(world.profileId)) referencedProfileIds.add(world.profileId);
        }

        for (const shell of rawChatShells) {
            for (const id of (shell.participantIds || [])) if (charIdSet.has(id)) referencedCharIds.add(id);
            for (const id of (shell.contextIds || [])) if (ctxIdSet.has(id)) referencedCtxIds.add(id);
            for (const id of (shell.locationIds || [])) if (locIdSet.has(id)) referencedLocIds.add(id);
            for (const id of (shell.audioTrackIds || [])) if (audioIdSet.has(id)) referencedAudioIds.add(id);
            if (shell.ProfileId && profileIdSet.has(shell.ProfileId)) referencedProfileIds.add(shell.ProfileId);
        }

        for (const c of allCharacters) {
            if (c.sampler?.id && samplerIdSet.has(c.sampler.id)) referencedSamplerIds.add(c.sampler.id);
            if (c.memories) {
                for (const memArr of Object.values(c.memories)) {
                    for (const mem of memArr) {
                        if (mem.id && memoryIdSet.has(mem.id)) referencedMemoryIds.add(mem.id);
                    }
                }
            }
        }
        for (const s of allSamplers) {
            if (referencedSamplerIds.has(s.id)) {
                for (const sp of (s.stopPatterns || [])) {
                    if (stopPatternIdSet.has(sp.id)) referencedStopPatternIds.add(sp.id);
                }
            }
        }

        for (const bs of allBudgetStrategies) {
            for (const m of (bs.onlineModels || [])) if (modelIdSet.has(m.id)) referencedModelIds.add(m.id);
            for (const m of (bs.localModels || [])) if (modelIdSet.has(m.id)) referencedModelIds.add(m.id);
        }

        for (const ctx of allContexts) {
            for (const binding of (ctx.characterBindings || [])) {
                if (charIdSet.has(binding)) referencedCharIds.add(binding);
            }
        }

        for (const loc of allLocations) {
            for (const binding of (loc.characterBindings || [])) if (charIdSet.has(binding)) referencedCharIds.add(binding);
            for (const binding of (loc.locationBindings || [])) if (locIdSet.has(binding)) referencedLocIds.add(binding);
            for (const binding of (loc.ownerBindings || [])) if (charIdSet.has(binding)) referencedCharIds.add(binding);
        }

        for (const at of allAudioTracks) {
            for (const binding of (at.characterBindings || [])) if (charIdSet.has(binding)) referencedCharIds.add(binding);
            for (const binding of (at.contextBindings || [])) if (ctxIdSet.has(binding)) referencedCtxIds.add(binding);
            for (const binding of (at.locationBindings || [])) if (locIdSet.has(binding)) referencedLocIds.add(binding);
        }

        for (const pb of allPromptBlocks) {
            for (const binding of pb.characterBindings) if (charIdSet.has(binding)) referencedCharIds.add(binding);
            for (const binding of pb.contextBindings) if (ctxIdSet.has(binding)) referencedCtxIds.add(binding);
            for (const binding of pb.locationBindings) if (locIdSet.has(binding)) referencedLocIds.add(binding);
        }

        for (const md of allMultiplayerData) {
            for (const id of md.whiteListedAccountIds) if (accountIdSet.has(id)) referencedAccountIds.add(id);
            for (const id of md.blacklistedAccountIds) if (accountIdSet.has(id)) referencedAccountIds.add(id);
            for (const id of md.pendingAccountIds) if (accountIdSet.has(id)) referencedAccountIds.add(id);
            for (const id of md.administratorAccountIds) if (accountIdSet.has(id)) referencedAccountIds.add(id);
            for (const id of Object.keys(md.accountIdCharacterIds)) if (accountIdSet.has(id)) referencedAccountIds.add(id);
        }

        for (const md of allMultiplayerData) {
            for (const chatId of md.interactionDataIds) {
                if (chatIdSet.has(chatId)) referencedMultiplayerDataIds.add(md.id);
            }
        }

        const staleCutoff = Date.now() - staleDaysCleanup * 86400000;
        const found: CleanupItem[] = [];

        const check = (type: EntityType, id: string, name: string, lastUpdated: number, isReferenced: boolean, entity: unknown) => {
            const isOrphan = !isReferenced;
            const isHollow = isEntityHollow(type, entity, nameIsMeaningful, descriptionIsMeaningful);
            const isStale = lastUpdated < staleCutoff;
            if (isOrphan || isHollow || isStale) {
                found.push({ type, id, name, lastUpdatedTimestamp: lastUpdated, isOrphan, isHollow, isStale });
            }
        };

        for (const c of allCharacters) check('character', c.id, c.name, c.lastUpdatedTimestamp, referencedCharIds.has(c.id), c);
        for (const c of allContexts) check('context', c.id, c.name, c.lastUpdatedTimestamp, referencedCtxIds.has(c.id), c);
        for (const l of allLocations) check('location', l.id, l.name, l.lastUpdatedTimestamp, referencedLocIds.has(l.id), l);
        for (const a of allAudioTracks) check('audioTrack', a.id, a.filename || a.name, a.lastUpdatedTimestamp, referencedAudioIds.has(a.id), a);
        for (const w of allWorlds) check('world', w.id, w.name, w.lastUpdatedTimestamp, true, w);
        for (const b of allPromptBlocks) check('promptBlock', b.id, b.name, b.lastUpdatedTimestamp, referencedPbIds.has(b.id), b);
        for (const m of allModels) check('model', m.id, m.name, m.lastUpdatedTimestamp, referencedModelIds.has(m.id), m);
        for (const s of allSamplers) check('sampler', s.id, s.name, s.lastUpdatedTimestamp, referencedSamplerIds.has(s.id), s);
        for (const sp of allStopPatterns) check('stopPattern', sp.id, sp.name, sp.lastUpdatedTimestamp, referencedStopPatternIds.has(sp.id), sp);
        for (const bs of allBudgetStrategies) check('budgetStrategy', bs.id, bs.name, bs.lastUpdatedTimestamp, true, bs);
        for (const p of allProfiles) check('profile', p.id, p.name, p.lastUpdatedTimestamp, referencedProfileIds.has(p.id), p);
        for (const m of allMemories) check('memory', m.id, m.name, m.lastUpdatedTimestamp, referencedMemoryIds.has(m.id), m);
        for (const a of allAccounts) check('account', a.id, a.name, a.lastUpdatedTimestamp, referencedAccountIds.has(a.id), a);
        for (const md of allMultiplayerData) check('multiplayerData', md.id, md.name, md.lastUpdatedTimestamp, referencedMultiplayerDataIds.has(md.id), md);

        setCleanupItems(found);
        setSelectedIds(new Set());
        setSearchQuery('');
        setIsScanning(false);
    }, [allCharacters, allContexts, allLocations, allAudioTracks, allWorlds, allPromptBlocks, allModels, allSamplers, allStopPatterns, allBudgetStrategies, allProfiles, allMemories, allAccounts, allMultiplayerData, rawChatShells, nameIsMeaningful, descriptionIsMeaningful, staleDaysCleanup]);

    // ─── Integrity Check ────────────────────────────────────────────
    const scanIntegrity = useCallback(() => {
        setIsScanning(true);
        const issues: IntegrityIssue[] = [];
        const charIdSet = new Set(allCharacters.map(c => c.id));
        const ctxIdSet = new Set(allContexts.map(c => c.id));
        const locIdSet = new Set(allLocations.map(l => l.id));
        const audioIdSet = new Set(allAudioTracks.map(a => a.id));
        const pbIdSet = new Set(allPromptBlocks.map(b => b.id));
        const modelIdSet = new Set(allModels.map(m => m.id));
        const samplerIdSet = new Set(allSamplers.map(s => s.id));
        const stopPatternIdSet = new Set(allStopPatterns.map(sp => sp.id));
        const profileIdSet = new Set(allProfiles.map(p => p.id));
        const memoryIdSet = new Set(allMemories.map(m => m.id));
        const accountIdSet = new Set(allAccounts.map(a => a.id));
        const chatIdSet = new Set(rawChatShells.filter(s => s.id).map(s => s.id));

        for (const ctx of allContexts) {
            for (const binding of (ctx.characterBindings || [])) {
                if (!charIdSet.has(binding)) issues.push({ entityType: 'Context', entityName: ctx.name, issue: 'References missing character binding', refType: 'Character', refId: binding });
            }
        }
        for (const loc of allLocations) {
            for (const binding of (loc.characterBindings || [])) {
                if (!charIdSet.has(binding)) issues.push({ entityType: 'Location', entityName: loc.name, issue: 'References missing character binding', refType: 'Character', refId: binding });
            }
            for (const binding of (loc.locationBindings || [])) {
                if (!locIdSet.has(binding)) issues.push({ entityType: 'Location', entityName: loc.name, issue: 'References missing location binding', refType: 'Location', refId: binding });
            }
            for (const ownerId of (loc.ownerBindings || [])) {
                if (!charIdSet.has(ownerId)) issues.push({ entityType: 'Location', entityName: loc.name, issue: 'References missing owner character', refType: 'Character', refId: ownerId });
            }
            if (loc.characterWeights) {
                for (const charId of Object.keys(loc.characterWeights)) {
                    if (!charIdSet.has(charId)) issues.push({ entityType: 'Location', entityName: loc.name, issue: 'characterWeights references missing character', refType: 'Character', refId: charId });
                }
            }
            if (loc.locationBindingRegularExpressionTriggers) {
                for (const locId of Object.keys(loc.locationBindingRegularExpressionTriggers)) {
                    if (!locIdSet.has(locId)) issues.push({ entityType: 'Location', entityName: loc.name, issue: 'locationBindingRegularExpressionTriggers references missing location', refType: 'Location', refId: locId });
                }
            }
            if (loc.playAudioTrackOnEnterWeights) {
                for (const audioId of Object.keys(loc.playAudioTrackOnEnterWeights)) {
                    if (!audioIdSet.has(audioId)) issues.push({ entityType: 'Location', entityName: loc.name, issue: 'playAudioTrackOnEnterWeights references missing audio track', refType: 'Audio Track', refId: audioId });
                }
            }
            if (loc.locationDistances) {
                for (const locId of Object.keys(loc.locationDistances)) {
                    if (!locIdSet.has(locId)) issues.push({ entityType: 'Location', entityName: loc.name, issue: 'locationDistances references missing location', refType: 'Location', refId: locId });
                }
            }
        }
        for (const at of allAudioTracks) {
            for (const binding of (at.locationBindings || [])) {
                if (!locIdSet.has(binding)) issues.push({ entityType: 'Audio Track', entityName: at.filename || at.name, issue: 'References missing location binding', refType: 'Location', refId: binding });
            }
            for (const binding of (at.contextBindings || [])) {
                if (!ctxIdSet.has(binding)) issues.push({ entityType: 'Audio Track', entityName: at.filename || at.name, issue: 'References missing context binding', refType: 'Context', refId: binding });
            }
            for (const binding of (at.characterBindings || [])) {
                if (!charIdSet.has(binding)) issues.push({ entityType: 'Audio Track', entityName: at.filename || at.name, issue: 'References missing character binding', refType: 'Character', refId: binding });
            }
        }
        for (const pb of allPromptBlocks) {
            for (const binding of pb.characterBindings) { if (!charIdSet.has(binding)) issues.push({ entityType: 'Prompt Block', entityName: pb.name, issue: 'References missing character binding', refType: 'Character', refId: binding }); }
            for (const binding of pb.contextBindings) { if (!ctxIdSet.has(binding)) issues.push({ entityType: 'Prompt Block', entityName: pb.name, issue: 'References missing context binding', refType: 'Context', refId: binding }); }
            for (const binding of pb.locationBindings) { if (!locIdSet.has(binding)) issues.push({ entityType: 'Prompt Block', entityName: pb.name, issue: 'References missing location binding', refType: 'Location', refId: binding }); }
        }
        for (const world of allWorlds) {
            for (const charId of world.characterIds) { if (!charIdSet.has(charId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing character', refType: 'Character', refId: charId }); }
            for (const ctxId of world.contextIds) { if (!ctxIdSet.has(ctxId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing context', refType: 'Context', refId: ctxId }); }
            for (const locId of world.locationIds) { if (!locIdSet.has(locId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing location', refType: 'Location', refId: locId }); }
            for (const audioId of world.audioTrackIds) { if (!audioIdSet.has(audioId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing audio track', refType: 'Audio Track', refId: audioId }); }
            for (const pbId of world.promptBlockIds) { if (!pbIdSet.has(pbId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing prompt block', refType: 'Prompt Block', refId: pbId }); }
            if (world.profileId && !profileIdSet.has(world.profileId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing profile', refType: 'Profile', refId: world.profileId });
        }
        for (const c of allCharacters) {
            if (c.sampler?.id && !samplerIdSet.has(c.sampler.id)) issues.push({ entityType: 'Character', entityName: c.name, issue: 'References missing sampler', refType: 'Sampler', refId: c.sampler.id });
            if (c.memories) {
                for (const [key, memArr] of Object.entries(c.memories)) {
                    for (const mem of memArr) {
                        if (mem.id && !memoryIdSet.has(mem.id)) issues.push({ entityType: 'Character', entityName: c.name, issue: `References missing memory in group "${key}"`, refType: 'Memory', refId: mem.id });
                    }
                }
            }
            if (c.clothings && c.clothings.length > 0) {
                const clothingIdSet = new Set(c.clothings.map(cl => cl.id));
                for (const clothing of c.clothings) {
                    for (const boundId of (clothing.clothingBindings || [])) {
                        if (!clothingIdSet.has(boundId)) issues.push({ entityType: 'Character', entityName: c.name, issue: `Clothing "${clothing.name}" references missing clothing binding`, refType: 'Clothing', refId: boundId });
                    }
                }
            }
            if (c.textCharacterInjections && c.textCharacterInjections.length > 0) {
                const injectionIdSet = new Set(c.textCharacterInjections.map(ti => ti.id));
                for (const injection of c.textCharacterInjections) {
                    for (const boundId of (injection.textCharacterInjectionBindings || [])) {
                        if (!injectionIdSet.has(boundId)) issues.push({ entityType: 'Character', entityName: c.name, issue: `Text injection "${injection.name}" references missing injection binding`, refType: 'Text Injection', refId: boundId });
                    }
                }
            }
            if (c.dialoguePrompts && c.dialoguePrompts.length > 0) {
                const dialoguePromptIdSet = new Set(c.dialoguePrompts.map(dp => dp.id));
                for (const dp of c.dialoguePrompts) {
                    for (const boundId of (dp.dialoguePromptBindings || [])) {
                        if (!dialoguePromptIdSet.has(boundId)) issues.push({ entityType: 'Character', entityName: c.name, issue: `Dialogue prompt "${dp.name}" references missing dialogue prompt binding`, refType: 'Dialogue Prompt', refId: boundId });
                    }
                }
            }
            if (c.knowledgePrompts && c.knowledgePrompts.length > 0) {
                const knowledgePromptIdSet = new Set(c.knowledgePrompts.map(kp => kp.id));
                for (const kp of c.knowledgePrompts) {
                    for (const boundId of (kp.knowledgePromptBindings || [])) {
                        if (!knowledgePromptIdSet.has(boundId)) issues.push({ entityType: 'Character', entityName: c.name, issue: `Knowledge prompt "${kp.name}" references missing knowledge prompt binding`, refType: 'Knowledge Prompt', refId: boundId });
                    }
                }
            }
            if (c.knownCharacterNames) {
                for (const charId of Object.keys(c.knownCharacterNames)) {
                    if (!charIdSet.has(charId)) issues.push({ entityType: 'Character', entityName: c.name, issue: 'knownCharacterNames references missing character', refType: 'Character', refId: charId });
                }
            }
        }
        for (const s of allSamplers) {
            for (const sp of (s.stopPatterns || [])) {
                if (!stopPatternIdSet.has(sp.id)) issues.push({ entityType: 'Sampler', entityName: s.name, issue: 'References missing stop pattern', refType: 'Stop Pattern', refId: sp.id });
            }
        }
        for (const bs of allBudgetStrategies) {
            for (const m of (bs.onlineModels || [])) { if (!modelIdSet.has(m.id)) issues.push({ entityType: 'Budget Strategy', entityName: bs.name, issue: 'References missing online model', refType: 'Language Model', refId: m.id }); }
            for (const m of (bs.localModels || [])) { if (!modelIdSet.has(m.id)) issues.push({ entityType: 'Budget Strategy', entityName: bs.name, issue: 'References missing local model', refType: 'Language Model', refId: m.id }); }
        }
        for (const mem of allMemories) {
            const interactionId = mem.interactionData?.id;
            if (interactionId && !chatIdSet.has(interactionId)) {
                issues.push({ entityType: 'Memory', entityName: mem.name, issue: 'References missing chat session', refType: 'Chat', refId: interactionId });
            }
        }
        for (const md of allMultiplayerData) {
            for (const id of md.whiteListedAccountIds) { if (!accountIdSet.has(id)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: 'References missing whitelisted account', refType: 'Account', refId: id }); }
            for (const id of md.blacklistedAccountIds) { if (!accountIdSet.has(id)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: 'References missing blacklisted account', refType: 'Account', refId: id }); }
            for (const id of md.pendingAccountIds) { if (!accountIdSet.has(id)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: 'References missing pending account', refType: 'Account', refId: id }); }
            for (const id of md.administratorAccountIds) { if (!accountIdSet.has(id)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: 'References missing admin account', refType: 'Account', refId: id }); }
            for (const [acctId, charIds] of Object.entries(md.accountIdCharacterIds)) {
                if (!accountIdSet.has(acctId)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: 'Mapping references missing account', refType: 'Account', refId: acctId });
                for (const charId of charIds) { if (!charIdSet.has(charId)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: `Mapping for account ${acctId.slice(0, 8)}... references missing character`, refType: 'Character', refId: charId }); }
            }
            for (const chatId of md.interactionDataIds) { if (!chatIdSet.has(chatId)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: 'References missing chat session', refType: 'Chat', refId: chatId }); }
        }

        setIntegrityIssues(issues);
        setIsScanning(false);
    }, [allCharacters, allContexts, allLocations, allAudioTracks, allWorlds, allPromptBlocks, allModels, allSamplers, allStopPatterns, allBudgetStrategies, allProfiles, allMemories, allAccounts, allMultiplayerData, rawChatShells]);

    // ─── Filtered + sorted cleanup items ────────────────────────────
    const filteredAndSorted = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();
        const filtered = cleanupItems.filter(item => {
            const matchesOrphan = showOrphans && item.isOrphan;
            const matchesHollow = showHollows && item.isHollow;
            const matchesStale = showStale && item.isStale;
            if (!matchesOrphan && !matchesHollow && !matchesStale) return false;
            if (query && !item.name.toLowerCase().includes(query)) return false;
            return true;
        });
        filtered.sort((a, b) => {
            let cmp = 0;
            switch (sortField) {
                case 'name': cmp = a.name.localeCompare(b.name); break;
                case 'type': cmp = a.type.localeCompare(b.type); break;
                case 'lastUpdated': cmp = a.lastUpdatedTimestamp - b.lastUpdatedTimestamp; break;
                case 'flags': {
                    const aFlags = (a.isOrphan ? 1 : 0) + (a.isHollow ? 1 : 0) + (a.isStale ? 1 : 0);
                    const bFlags = (b.isOrphan ? 1 : 0) + (b.isHollow ? 1 : 0) + (b.isStale ? 1 : 0);
                    cmp = bFlags - aFlags;
                    break;
                }
            }
            return sortDirection === 'asc' ? cmp : -cmp;
        });
        return filtered;
    }, [cleanupItems, searchQuery, showOrphans, showHollows, showStale, sortField, sortDirection]);

    const handleSort = (field: SortField) => {
        if (sortField === field) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDirection('asc'); }
    };

    const sortIndicator = (field: SortField) => {
        if (sortField !== field) return <span style={{ opacity: 0.2, fontSize: '0.6rem' }}>⇅</span>;
        return <span style={{ fontSize: '0.6rem' }}>{sortDirection === 'asc' ? '↑' : '↓'}</span>;
    };

    // ─── Deletion ───────────────────────────────────────────────────
    const handleDeleteSelected = () => {
        let deletedCount = 0;
        for (const item of cleanupItems) {
            if (!selectedIds.has(item.id)) continue;
            switch (item.type) {
                case 'character': onDeleteCharacter(item.id); break;
                case 'context': onDeleteContext(item.id); break;
                case 'location': onDeleteLocation(item.id); break;
                case 'audioTrack': onDeleteAudioTrack(item.id); break;
                case 'world': onDeleteWorld(item.id); break;
                case 'promptBlock': onDeletePromptBlock(item.id); break;
                case 'model': onDeleteModel(item.id); break;
                case 'sampler': onDeleteSampler(item.id); break;
                case 'stopPattern': onDeleteStopPattern(item.id); break;
                case 'budgetStrategy': onDeleteBudgetStrategy(item.id); break;
                case 'profile': onDeleteProfile(item.id); break;
                case 'memory': onDeleteMemory(item.id); break;
                case 'account': onDeleteAccount(item.id); break;
                case 'multiplayerData': onDeleteMultiplayerData(item.id); break;
            }
            deletedCount++;
        }
        addToast(`Deleted ${deletedCount} entit${deletedCount === 1 ? 'y' : 'ies'}.`, 'success');
        setSelectedIds(new Set());
        scanCleanup();
    };

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    };

    const selectAllVisible = () => {
        const visibleIds = filteredAndSorted.map(i => i.id);
        const allSelected = visibleIds.every(id => selectedIds.has(id));
        if (allSelected) setSelectedIds(prev => { const next = new Set(prev); for (const id of visibleIds) next.delete(id); return next; });
        else setSelectedIds(prev => { const next = new Set(prev); for (const id of visibleIds) next.add(id); return next; });
    };

    // ─── Bulk: Exclusion helpers ─────────────────────────────────────
    const exclusionIdSet = useMemo(() => {
        const byType: Record<ExclusionEntityType, Set<string>> = {
            character: new Set(),
            context: new Set(),
            location: new Set(),
            audioTrack: new Set(),
            profile: new Set(),
        };
        for (const ex of exclusions) byType[ex.entityType].add(ex.id);
        return byType;
    }, [exclusions]);

    const isShellExcluded = useCallback((shell: RawInteractionData): boolean => {
        if (exclusions.length === 0) return false;
        for (const id of (shell.participantIds || [])) { if (exclusionIdSet.character.has(id)) return true; }
        for (const id of (shell.contextIds || [])) { if (exclusionIdSet.context.has(id)) return true; }
        for (const id of (shell.locationIds || [])) { if (exclusionIdSet.location.has(id)) return true; }
        for (const id of (shell.audioTrackIds || [])) { if (exclusionIdSet.audioTrack.has(id)) return true; }
        if (shell.ProfileId && exclusionIdSet.profile.has(shell.ProfileId)) return true;
        return false;
    }, [exclusions, exclusionIdSet]);

    const addExclusion = (entityType: ExclusionEntityType, id: string, name: string) => {
        if (exclusions.some(e => e.entityType === entityType && e.id === id)) return;
        setExclusions(prev => [...prev, { entityType, id, name }]);
        setExclusionSearchQuery('');
        setIsExclusionDropdownOpen(false);
        setConfirmBulkDelete(false);
    };

    const removeExclusion = (entityType: ExclusionEntityType, id: string) => {
        setExclusions(prev => prev.filter(e => !(e.entityType === entityType && e.id === id)));
        setConfirmBulkDelete(false);
    };

    const exclusionSearchResults = useMemo(() => {
        const q = exclusionSearchQuery.toLowerCase().trim();
        if (!q) return [];
        let items: { id: string; name: string }[] = [];
        switch (exclusionDropdownType) {
            case 'character': items = allCharacters.map(c => ({ id: c.id, name: c.name })); break;
            case 'context': items = allContexts.map(c => ({ id: c.id, name: c.name })); break;
            case 'location': items = allLocations.map(l => ({ id: l.id, name: l.name })); break;
            case 'audioTrack': items = allAudioTracks.map(a => ({ id: a.id, name: a.filename || a.name })); break;
            case 'profile': items = allProfiles.map(p => ({ id: p.id, name: p.name })); break;
        }
        const alreadyExcluded = new Set(exclusions.filter(e => e.entityType === exclusionDropdownType).map(e => e.id));
        return items.filter(i => !alreadyExcluded.has(i.id) && i.name.toLowerCase().includes(q)).slice(0, 20);
    }, [exclusionSearchQuery, exclusionDropdownType, allCharacters, allContexts, allLocations, allAudioTracks, allProfiles, exclusions]);

    // ─── Bulk: Candidate list ────────────────────────────────────────
    const bulkCandidates = useMemo(() => {
        if (!includeStale && !includeLowMessage) return [];
        return rawChatShells.filter(shell => {
            if (!shell.id) return false;
            const matchesStale = includeStale && (shell.lastUpdatedTimestamp ?? 0) < staleCutoffMs;
            const matchesLow = includeLowMessage && (shell.interactionIdHistory?.length ?? 0) < minMessagesThreshold;
            if (!matchesStale && !matchesLow) return false;
            if (isShellExcluded(shell)) return false;
            return true;
        });
    }, [rawChatShells, includeStale, includeLowMessage, staleCutoffMs, minMessagesThreshold, isShellExcluded]);

    const handleBulkDeleteCandidates = () => {
        let deletedCount = 0;
        for (const shell of bulkCandidates) { if (shell.id) { onDeleteChat(shell.id); deletedCount++; } }
        addToast(`Deleted ${deletedCount} chat${deletedCount === 1 ? '' : 's'}.`, 'success');
        setConfirmBulkDelete(false);
    };

    const handleClearWebpageCache = async () => {
        try { const r = await fetch('/api/cache/webpage', { method: 'DELETE' }); addToast(r.ok ? 'Webpage cache cleared.' : 'Failed to clear webpage cache.', r.ok ? 'success' : 'error'); }
        catch { addToast('Failed to clear webpage cache.', 'error'); }
    };
    const handleClearImageCache = async () => {
        try { const r = await fetch('/api/cache/images', { method: 'DELETE' }); addToast(r.ok ? 'Image cache cleared.' : 'Failed to clear image cache.', r.ok ? 'success' : 'error'); }
        catch { addToast('Failed to clear image cache.', 'error'); }
    };
    const handleClearTokenCache = () => {
        import('../services/LanguageModelEngine').then(({ getLanguageModelEngine }) => { getLanguageModelEngine().clearTokenCache(); addToast('Token cache cleared.', 'success'); });
    };

    // ─── Danger zone ────────────────────────────────────────────────
    const handleFactoryReset = async () => {
        try {
            for (const key of Object.keys(localStorage).filter(k => k.startsWith('loreReactor_'))) localStorage.removeItem(key);
            addToast('Factory reset complete. Reloading...', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch { addToast('Factory reset failed.', 'error'); }
    };
    const handleSelectiveWipe = (entityType: string) => {
        let count = 0;
        switch (entityType) {
            case 'characters': for (const c of allCharacters) { onDeleteCharacter(c.id); count++; } break;
            case 'contexts': for (const c of allContexts) { onDeleteContext(c.id); count++; } break;
            case 'locations': for (const l of allLocations) { onDeleteLocation(l.id); count++; } break;
            case 'audioTracks': for (const a of allAudioTracks) { onDeleteAudioTrack(a.id); count++; } break;
            case 'worlds': for (const w of allWorlds) { onDeleteWorld(w.id); count++; } break;
            case 'promptBlocks': for (const b of allPromptBlocks) { onDeletePromptBlock(b.id); count++; } break;
            case 'models': for (const m of allModels) { onDeleteModel(m.id); count++; } break;
            case 'samplers': for (const s of allSamplers) { onDeleteSampler(s.id); count++; } break;
            case 'stopPatterns': for (const sp of allStopPatterns) { onDeleteStopPattern(sp.id); count++; } break;
            case 'budgetStrategies': for (const bs of allBudgetStrategies) { onDeleteBudgetStrategy(bs.id); count++; } break;
            case 'profiles': for (const p of allProfiles) { onDeleteProfile(p.id); count++; } break;
            case 'memories': for (const m of allMemories) { onDeleteMemory(m.id); count++; } break;
            case 'accounts': for (const a of allAccounts) { onDeleteAccount(a.id); count++; } break;
            case 'multiplayerData': for (const md of allMultiplayerData) { onDeleteMultiplayerData(md.id); count++; } break;
            case 'chats': for (const s of rawChatShells) { if (s.id) { onDeleteChat(s.id); count++; } } break;
        }
        addToast(`Wiped ${count} ${entityType}.`, 'success');
        setConfirmDangerAction(null);
    };

    if (!isOpen) return null;

    const tabs: { id: TabId; icon: string; label: string }[] = [
        { id: 'storage', icon: '📊', label: 'Storage' },
        { id: 'cleanup', icon: '🧹', label: 'Cleanup' },
        { id: 'integrity', icon: '🔗', label: 'Integrity' },
        { id: 'cache', icon: '🗑️', label: 'Cache' },
        { id: 'bulk', icon: '📋', label: 'Bulk Ops' },
        { id: 'danger', icon: '⚠️', label: 'Danger Zone' },
    ];

    const totalSizeKb = storageBreakdown.reduce((sum, item) => sum + item.estimatedSizeKb, 0);
    const thStyle: React.CSSProperties = { padding: '8px 10px', fontSize: '0.7rem', fontWeight: 'bold', textAlign: 'left', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', borderBottom: '2px solid var(--border)', background: 'var(--social-bg)', position: 'sticky', top: 0, zIndex: 1 };
    const tdStyle: React.CSSProperties = { padding: '6px 10px', fontSize: '0.75rem', borderBottom: '1px solid var(--border)' };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px' }}>
                <div className="modal-header">
                    <h2>Data Manager</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Close</button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '4px', padding: '0 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                    {tabs.map(tab => (
                        <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); setConfirmDangerAction(null); setConfirmBulkDelete(false); }}
                            className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                            style={{ fontSize: '0.7rem', padding: '8px 12px' }}>
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                <div className="modal-body editor-modal-body">
                    {/* ─── STORAGE TAB ─── */}
                    {activeTab === 'storage' && (
                        <div>
                            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                                <div style={{ fontSize: '0.7rem', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Estimated Total Storage</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)' }}>{totalSizeKb >= 1024 ? `${(totalSizeKb / 1024).toFixed(1)} MB` : `${totalSizeKb} KB`}</div>
                                <div style={{ fontSize: '0.6rem', opacity: 0.4, marginTop: '4px' }}>Sizes are estimates based on entity counts</div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {storageBreakdown.map(item => (
                                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                                        <span style={{ fontSize: '1.2rem' }}>{item.icon}</span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{item.label}</div>
                                            <div style={{ fontSize: '0.65rem', opacity: 0.5 }}>{item.count} entit{item.count === 1 ? 'y' : 'ies'}</div>
                                        </div>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.85rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{item.estimatedSizeKb >= 1024 ? `${(item.estimatedSizeKb / 1024).toFixed(1)} MB` : `${item.estimatedSizeKb} KB`}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ─── CLEANUP TAB ─── */}
                    {activeTab === 'cleanup' && (
                        <div>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '12px', lineHeight: 1.5 }}>Find entities that are unreferenced (orphans), have no meaningful content (hollow), or haven't been updated recently (stale).</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}><input type="checkbox" checked={showOrphans} onChange={e => setShowOrphans(e.target.checked)} className="editor-checkbox-input" /><span style={{ fontSize: '0.75rem' }}>Orphans</span></label>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}><input type="checkbox" checked={showHollows} onChange={e => setShowHollows(e.target.checked)} className="editor-checkbox-input" /><span style={{ fontSize: '0.75rem' }}>Hollows</span></label>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}><input type="checkbox" checked={showStale} onChange={e => setShowStale(e.target.checked)} className="editor-checkbox-input" /><span style={{ fontSize: '0.75rem' }}>Stale (&gt;</span></label>
                                    <input type="number" min="1" max="365" value={staleDaysCleanup} onChange={e => setStaleDaysCleanup(Math.max(1, Math.min(365, Number(e.target.value) || 90)))} className="editor-input" style={{ width: '60px', textAlign: 'right', fontSize: '0.7rem', padding: '4px 6px' }} />
                                    <span style={{ fontSize: '0.75rem' }}>days)</span>
                                </div>
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '4px' }}>
                                    <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '6px' }}>Hollow detection treats these as meaningful data:</div>
                                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                                        <label className="editor-checkbox-label" style={{ margin: 0 }}><input type="checkbox" checked={nameIsMeaningful} onChange={e => setNameIsMeaningful(e.target.checked)} className="editor-checkbox-input" /><span style={{ fontSize: '0.7rem' }}>Name</span></label>
                                        <label className="editor-checkbox-label" style={{ margin: 0 }}><input type="checkbox" checked={descriptionIsMeaningful} onChange={e => setDescriptionIsMeaningful(e.target.checked)} className="editor-checkbox-input" /><span style={{ fontSize: '0.7rem' }}>Description</span></label>
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <button type="button" className="editor-button editor-button-save" onClick={scanCleanup} disabled={isScanning} style={{ fontSize: '0.75rem', padding: '8px 16px' }}>{isScanning ? 'Scanning...' : 'Scan'}</button>
                                {cleanupItems.length > 0 && (<>
                                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search..." className="editor-input" style={{ flex: 1, minWidth: '120px', fontSize: '0.75rem', padding: '8px 12px' }} />
                                    <button type="button" className="editor-button editor-button-cancel" onClick={selectAllVisible} style={{ fontSize: '0.75rem', padding: '8px 16px' }}>{filteredAndSorted.length > 0 && filteredAndSorted.every(o => selectedIds.has(o.id)) ? 'Deselect Visible' : 'Select Visible'}</button>
                                    <button type="button" className="editor-button" onClick={handleDeleteSelected} disabled={selectedIds.size === 0} style={{ fontSize: '0.75rem', padding: '8px 16px', background: selectedIds.size > 0 ? '#ef4444' : undefined, color: selectedIds.size > 0 ? '#fff' : undefined, borderColor: selectedIds.size > 0 ? '#ef4444' : undefined }}>Delete Selected ({selectedIds.size})</button>
                                </>)}
                            </div>
                            {cleanupItems.length === 0 && !isScanning && (<div style={{ textAlign: 'center', padding: '30px', opacity: 0.5, fontSize: '0.8rem' }}>No issues found. Click "Scan" to check.</div>)}
                            {cleanupItems.length > 0 && filteredAndSorted.length === 0 && (<div style={{ textAlign: 'center', padding: '20px', opacity: 0.5, fontSize: '0.8rem' }}>{searchQuery ? `No results match "${searchQuery}"` : 'No items match current filters.'}</div>)}
                            {filteredAndSorted.length > 0 && (
                                <div style={{ overflowX: 'auto', maxHeight: '450px', border: '1px solid var(--border)', borderRadius: '8px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '500px' }}>
                                        <thead><tr>
                                            <th style={{ ...thStyle, width: '36px', textAlign: 'center', cursor: 'default' }}><input type="checkbox" readOnly checked={filteredAndSorted.length > 0 && filteredAndSorted.every(o => selectedIds.has(o.id))} style={{ accentColor: 'var(--accent)' }} /></th>
                                            <th style={thStyle} onClick={() => handleSort('name')}>Name {sortIndicator('name')}</th>
                                            <th style={thStyle} onClick={() => handleSort('type')}>Type {sortIndicator('type')}</th>
                                            <th style={thStyle} onClick={() => handleSort('lastUpdated')}>Last Updated {sortIndicator('lastUpdated')}</th>
                                            <th style={thStyle} onClick={() => handleSort('flags')}>Flags {sortIndicator('flags')}</th>
                                        </tr></thead>
                                        <tbody>{filteredAndSorted.map(item => (
                                            <tr key={`${item.type}-${item.id}`} onClick={() => toggleSelection(item.id)} style={{ cursor: 'pointer', background: selectedIds.has(item.id) ? 'var(--accent-bg)' : 'transparent', transition: 'background 0.15s' }}>
                                                <td style={{ ...tdStyle, textAlign: 'center' }}><input type="checkbox" checked={selectedIds.has(item.id)} readOnly style={{ accentColor: 'var(--accent)', width: '14px', height: '14px' }} /></td>
                                                <td style={{ ...tdStyle, fontWeight: 'bold', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</td>
                                                <td style={tdStyle}><span style={{ fontSize: '0.7rem', opacity: 0.7 }}>{ENTITY_TYPE_META[item.type].icon} {ENTITY_TYPE_META[item.type].label.slice(0, -1)}</span></td>
                                                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{formatDate(item.lastUpdatedTimestamp)}<span style={{ opacity: 0.4, marginLeft: '4px' }}>({daysAgo(item.lastUpdatedTimestamp)}d)</span></td>
                                                <td style={tdStyle}><div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                                                    {item.isOrphan && <span style={{ fontSize: '0.55rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 'bold' }}>ORPHAN</span>}
                                                    {item.isHollow && <span style={{ fontSize: '0.55rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(234,179,8,0.15)', color: '#ca8a04', fontWeight: 'bold' }}>HOLLOW</span>}
                                                    {item.isStale && <span style={{ fontSize: '0.55rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(99,102,241,0.15)', color: '#6366f1', fontWeight: 'bold' }}>STALE</span>}
                                                </div></td>
                                            </tr>
                                        ))}</tbody>
                                    </table>
                                </div>
                            )}
                            {filteredAndSorted.length > 0 && (<div style={{ fontSize: '0.65rem', opacity: 0.5, marginTop: '6px', textAlign: 'right' }}>Showing {filteredAndSorted.length} of {cleanupItems.length} flagged entities</div>)}
                        </div>
                    )}

                    {/* ─── INTEGRITY TAB ─── */}
                    {activeTab === 'integrity' && (
                        <div>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '12px', lineHeight: 1.5 }}>Cross-reference integrity check. Finds broken bindings where entities reference deleted characters, contexts, locations, audio tracks, worlds, prompt blocks, models, samplers, stop patterns, memories, chat sessions, accounts, or profiles.</div>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                <button type="button" className="editor-button editor-button-save" onClick={scanIntegrity} disabled={isScanning} style={{ fontSize: '0.75rem', padding: '8px 16px' }}>{isScanning ? 'Checking...' : 'Run Integrity Check'}</button>
                            </div>
                            {integrityIssues.length === 0 && !isScanning && (<div style={{ textAlign: 'center', padding: '30px', opacity: 0.5, fontSize: '0.8rem' }}>✅ No integrity issues found.</div>)}
                            {integrityIssues.length > 0 && (
                                <div>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#ef4444', marginBottom: '8px' }}>⚠️ {integrityIssues.length} issue{integrityIssues.length !== 1 ? 's' : ''} found</div>
                                    <div className="entity-error-list" style={{ maxHeight: '400px' }}>
                                        {integrityIssues.map((issue, idx) => (
                                            <div key={idx} className="entity-error-item" style={{ padding: '6px 8px', borderBottom: idx < integrityIssues.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                                <div style={{ fontWeight: 'bold', fontSize: '0.7rem' }}>{issue.entityType}: {issue.entityName}</div>
                                                <div style={{ fontSize: '0.65rem', opacity: 0.7, marginTop: '2px' }}>{issue.issue}{issue.refId ? ` (${issue.refType} ID: ${issue.refId.slice(0, 8)}...)` : ''}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ─── CACHE TAB ─── */}
                    {activeTab === 'cache' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, lineHeight: 1.5 }}>Purge cached data to free up disk space. Caches will be rebuilt automatically as needed.</div>
                            <div className="editor-section" style={{ margin: 0 }}><div className="editor-section-title">Webpage Cache</div><div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Cached web pages fetched via context URLs and search terms.</div><button type="button" className="editor-button editor-button-cancel" onClick={handleClearWebpageCache} style={{ fontSize: '0.75rem', width: '100%' }}>🧹 Clear Webpage Cache</button></div>
                            <div className="editor-section" style={{ margin: 0 }}><div className="editor-section-title">Image Cache</div><div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Cached character, context, location, and prompt block images.</div><button type="button" className="editor-button editor-button-cancel" onClick={handleClearImageCache} style={{ fontSize: '0.75rem', width: '100%' }}>🧹 Clear Image Cache</button></div>
                            <div className="editor-section" style={{ margin: 0 }}><div className="editor-section-title">Token Cache</div><div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>In-memory token counting cache used by the language model engine.</div><button type="button" className="editor-button editor-button-cancel" onClick={handleClearTokenCache} style={{ fontSize: '0.75rem', width: '100%' }}>🧹 Clear Token Cache</button></div>
                        </div>
                    )}

                    {/* ─── BULK OPS TAB ─── */}
                    {activeTab === 'bulk' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, lineHeight: 1.5 }}>Bulk delete chat sessions by inclusion criteria. Add exclusions to protect chats containing specific entities.</div>
                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Inclusion Criteria</div>
                                <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '10px' }}>Select which chats to include for deletion. At least one must be enabled.</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderRadius: '6px', border: `1px solid ${includeStale ? 'var(--accent)' : 'var(--border)'}`, background: includeStale ? 'var(--accent-bg)' : 'transparent', transition: 'all 0.15s' }}>
                                        <label className="editor-checkbox-label" style={{ margin: 0 }}><input type="checkbox" checked={includeStale} onChange={e => { setIncludeStale(e.target.checked); setConfirmBulkDelete(false); }} className="editor-checkbox-input" /><span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Stale Chats</span></label>
                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>— older than</span>
                                        <input type="number" min="1" max="365" value={staleDaysThreshold} onChange={e => { setStaleDaysThreshold(Math.max(1, Math.min(365, Number(e.target.value) || 30))); setConfirmBulkDelete(false); }} className="editor-input" style={{ width: '60px', textAlign: 'right', fontSize: '0.7rem', padding: '4px 6px' }} />
                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>days</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderRadius: '6px', border: `1px solid ${includeLowMessage ? 'var(--accent)' : 'var(--border)'}`, background: includeLowMessage ? 'var(--accent-bg)' : 'transparent', transition: 'all 0.15s' }}>
                                        <label className="editor-checkbox-label" style={{ margin: 0 }}><input type="checkbox" checked={includeLowMessage} onChange={e => { setIncludeLowMessage(e.target.checked); setConfirmBulkDelete(false); }} className="editor-checkbox-input" /><span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Low Message Chats</span></label>
                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>— fewer than</span>
                                        <input type="number" min="1" max="1000" value={minMessagesThreshold} onChange={e => { setMinMessagesThreshold(Math.max(1, Math.min(1000, Number(e.target.value) || 3))); setConfirmBulkDelete(false); }} className="editor-input" style={{ width: '60px', textAlign: 'right', fontSize: '0.7rem', padding: '4px 6px' }} />
                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>messages</span>
                                    </div>
                                </div>
                            </div>
                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Exclusion Criteria</div>
                                <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '10px' }}>Chats containing any excluded entity will be protected from deletion.</div>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '10px', position: 'relative' }}>
                                    <select value={exclusionDropdownType} onChange={e => { setExclusionDropdownType(e.target.value as ExclusionEntityType); setExclusionSearchQuery(''); setIsExclusionDropdownOpen(false); }} className="editor-input" style={{ width: '140px', fontSize: '0.7rem', padding: '6px 8px' }}>
                                        {(Object.keys(EXCLUSION_TYPE_META) as ExclusionEntityType[]).map(key => (<option key={key} value={key}>{EXCLUSION_TYPE_META[key].icon} {EXCLUSION_TYPE_META[key].label}</option>))}
                                    </select>
                                    <div style={{ flex: 1, position: 'relative' }}>
                                        <input type="text" value={exclusionSearchQuery} onChange={e => { setExclusionSearchQuery(e.target.value); setIsExclusionDropdownOpen(true); }} onFocus={() => { if (exclusionSearchQuery.trim()) setIsExclusionDropdownOpen(true); }} placeholder={`Search ${EXCLUSION_TYPE_META[exclusionDropdownType].label.toLowerCase()}...`} className="editor-input" style={{ width: '100%', fontSize: '0.7rem', padding: '6px 8px' }} />
                                        {isExclusionDropdownOpen && exclusionSearchResults.length > 0 && (
                                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: '180px', overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '0 0 6px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                                                {exclusionSearchResults.map(item => (<div key={item.id} onClick={() => addExclusion(exclusionDropdownType, item.id, item.name)} style={{ padding: '6px 10px', fontSize: '0.7rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-bg)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{EXCLUSION_TYPE_META[exclusionDropdownType].icon} {item.name}</div>))}
                                            </div>
                                        )}
                                        {isExclusionDropdownOpen && exclusionSearchQuery.trim() && exclusionSearchResults.length === 0 && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '0 0 6px 6px', fontSize: '0.65rem', opacity: 0.5 }}>No results found.</div>)}
                                    </div>
                                </div>
                                {exclusions.length > 0 && (
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                        {exclusions.map(ex => (<span key={`${ex.entityType}-${ex.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.65rem', padding: '3px 8px', borderRadius: '12px', background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{EXCLUSION_TYPE_META[ex.entityType].icon} {ex.name}<span onClick={() => removeExclusion(ex.entityType, ex.id)} style={{ cursor: 'pointer', marginLeft: '2px', opacity: 0.6, fontSize: '0.7rem', lineHeight: 1 }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}>✕</span></span>))}
                                        <span onClick={() => { setExclusions([]); setConfirmBulkDelete(false); }} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.6rem', padding: '3px 8px', borderRadius: '12px', border: '1px solid var(--border)', cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.15s' }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}>Clear All</span>
                                    </div>
                                )}
                                {exclusions.length === 0 && (<div style={{ fontSize: '0.65rem', opacity: 0.4, fontStyle: 'italic' }}>No exclusions set — all matching chats will be eligible for deletion.</div>)}
                            </div>
                            <div className="editor-section" style={{ margin: 0, borderColor: bulkCandidates.length > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)' }}>
                                <div className="editor-section-title">Result</div>
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: bulkCandidates.length > 0 ? '#ef4444' : 'var(--text-h)' }}>{bulkCandidates.length}</div>
                                        <div style={{ fontSize: '0.65rem', opacity: 0.5 }}>chat{bulkCandidates.length !== 1 ? 's' : ''} will be deleted{exclusions.length > 0 && (<span> ({rawChatShells.filter(s => s.id && isShellExcluded(s)).length} excluded)</span>)}</div>
                                    </div>
                                    {(!includeStale && !includeLowMessage) && (<div style={{ fontSize: '0.7rem', opacity: 0.5, fontStyle: 'italic' }}>Enable at least one inclusion criterion.</div>)}
                                </div>
                                {bulkCandidates.length > 0 && (
                                    <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '10px' }}>
                                        {bulkCandidates.slice(0, 50).map(shell => { const msgCount = shell.interactionIdHistory?.length ?? 0; const age = daysAgo(shell.lastUpdatedTimestamp ?? 0); return (<div key={shell.id} style={{ padding: '4px 8px', fontSize: '0.65rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: '8px' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{shell.name || 'Untitled'}</span><span style={{ opacity: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{msgCount} msg • {age}d ago</span></div>); })}
                                        {bulkCandidates.length > 50 && (<div style={{ padding: '4px 8px', fontSize: '0.6rem', opacity: 0.4, textAlign: 'center' }}>...and {bulkCandidates.length - 50} more</div>)}
                                    </div>
                                )}
                                <button type="button" className="editor-button" disabled={bulkCandidates.length === 0} onClick={() => confirmBulkDelete ? handleBulkDeleteCandidates() : setConfirmBulkDelete(true)} style={{ fontSize: '0.75rem', width: '100%', color: confirmBulkDelete ? '#fff' : bulkCandidates.length > 0 ? '#ef4444' : undefined, background: confirmBulkDelete ? '#ef4444' : 'transparent', borderColor: bulkCandidates.length > 0 ? 'rgba(239,68,68,0.3)' : undefined }}>
                                    {confirmBulkDelete ? `⚠️ Confirm Delete ${bulkCandidates.length} Chat${bulkCandidates.length !== 1 ? 's' : ''}` : `🗑️ Delete ${bulkCandidates.length} Chat${bulkCandidates.length !== 1 ? 's' : ''}`}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ─── DANGER ZONE TAB ─── */}
                    {activeTab === 'danger' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', fontSize: '0.75rem', color: '#ef4444', lineHeight: 1.5 }}>⚠️ These operations are <strong>irreversible</strong>. Data cannot be recovered after deletion. Export your data first.</div>
                            <div className="editor-section" style={{ margin: 0, borderColor: 'rgba(239,68,68,0.2)' }}>
                                <div className="editor-section-title" style={{ color: '#ef4444' }}>Selective Wipe</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Delete all entities of a specific type while preserving everything else.</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                    {[
                                        { key: 'characters', label: 'All Characters', count: allCharacters.length },
                                        { key: 'contexts', label: 'All Contexts', count: allContexts.length },
                                        { key: 'locations', label: 'All Locations', count: allLocations.length },
                                        { key: 'audioTracks', label: 'All Audio Tracks', count: allAudioTracks.length },
                                        { key: 'worlds', label: 'All Worlds', count: allWorlds.length },
                                        { key: 'promptBlocks', label: 'All Prompt Blocks', count: allPromptBlocks.length },
                                        { key: 'models', label: 'All Language Models', count: allModels.length },
                                        { key: 'samplers', label: 'All Samplers', count: allSamplers.length },
                                        { key: 'stopPatterns', label: 'All Stop Patterns', count: allStopPatterns.length },
                                        { key: 'budgetStrategies', label: 'All Budget Strategies', count: allBudgetStrategies.length },
                                        { key: 'profiles', label: 'All Profiles', count: allProfiles.length },
                                        { key: 'memories', label: 'All Memories', count: allMemories.length },
                                        { key: 'accounts', label: 'All Accounts', count: allAccounts.length },
                                        { key: 'multiplayerData', label: 'All Multiplayer Data', count: allMultiplayerData.length },
                                        { key: 'chats', label: 'All Chats', count: rawChatShells.length },
                                    ].map(entity => (
                                        <button key={entity.key} type="button" className="editor-button"
                                            onClick={() => confirmDangerAction === `wipe-${entity.key}` ? handleSelectiveWipe(entity.key) : setConfirmDangerAction(`wipe-${entity.key}`)}
                                            style={{ fontSize: '0.7rem', padding: '8px', color: confirmDangerAction === `wipe-${entity.key}` ? '#fff' : '#ef4444', background: confirmDangerAction === `wipe-${entity.key}` ? '#ef4444' : 'transparent', borderColor: 'rgba(239,68,68,0.3)' }}>
                                            {confirmDangerAction === `wipe-${entity.key}` ? `Confirm (${entity.count})` : `${entity.label} (${entity.count})`}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="editor-section" style={{ margin: 0, borderColor: 'rgba(239,68,68,0.2)' }}>
                                <div className="editor-section-title" style={{ color: '#ef4444' }}>Factory Reset</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Wipe ALL local data. The app will reload automatically.</div>
                                <button type="button" className="editor-button" onClick={() => confirmDangerAction === 'factory-reset' ? handleFactoryReset() : setConfirmDangerAction('factory-reset')} style={{ fontSize: '0.75rem', width: '100%', color: confirmDangerAction === 'factory-reset' ? '#fff' : '#ef4444', background: confirmDangerAction === 'factory-reset' ? '#ef4444' : 'transparent', borderColor: '#ef4444' }}>
                                    {confirmDangerAction === 'factory-reset' ? '⚠️ CONFIRM FACTORY RESET' : '🏭 Factory Reset Everything'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}