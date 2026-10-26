// src/frontend_src/components/DataManagerModal.tsx
import { useState, useCallback, useMemo } from 'react';
import type { Character, Context, Location, AudioTrack, World, PromptBlock, LanguageModel, SpatiotemporalModel, Sampler, StopPattern, RetrievalConfiguration, BudgetStrategy, Profile, Memory, RawInteractionData, Account, MultiplayerData, EntityFolder } from '../types';
import { useToast } from '../context/ToastContext';
import { saveRawSessionData, deleteSessionData, deleteMultiplayerJoinData, deleteActionFormatData, clearPreferencesCache, clearSaveQueue, deleteFormatPreferences } from '../storages/serverStorage';
import '../main.css';

interface DataManagerModalProps {
    onClose: () => void;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allPromptBlocks: PromptBlock[];
    allLanguageModels: LanguageModel[];
    allSpatiotemporalModels: SpatiotemporalModel[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allRetrievalConfigurations: RetrievalConfiguration[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allMemories: Memory[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    allRawInteractionDataShells: RawInteractionData[];
    allEntityFolders: EntityFolder[];
    onDeleteCharacter: (id: string) => void;
    onDeleteContext: (id: string) => void;
    onDeleteLocation: (id: string) => void;
    onDeleteAudioTrack: (id: string) => void;
    onDeleteWorld: (id: string) => void;
    onDeletePromptBlock: (id: string) => void;
    onDeleteModel: (id: string) => void;
    onDeleteSpatiotemporalModel: (id: string) => void;
    onDeleteSampler: (id: string) => void;
    onDeleteStopPattern: (id: string) => void;
    onDeleteRetrievalConfiguration: (id: string) => void;
    onDeleteBudgetStrategy: (id: string) => void;
    onDeleteProfile: (id: string) => void;
    onDeleteMemory: (id: string) => void;
    onDeleteAccount: (id: string) => void;
    onDeleteMultiplayerData: (id: string) => void;
    onDeleteInteractionData: (id: string) => void;
    onDeleteEntityFolder: (id: string) => void;
}

type TabId = 'storage' | 'cleanup' | 'integrity' | 'cache' | 'bulk' | 'danger';

type EntityType = 'character' | 'context' | 'location' | 'audioTrack' | 'world' | 'promptBlock' | 'languageModel' | 'spatiotemporalModel' | 'sampler' | 'stopPattern' | 'retrievalConfiguration' | 'budgetStrategy' | 'profile' | 'memory' | 'account' | 'multiplayerData' | 'entityFolder';

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
    languageModel: { icon: '🤖', label: 'Language Models' },
    spatiotemporalModel: { icon: '🎨', label: 'Spatiotemporal Models' },
    sampler: { icon: '🎚️', label: 'Samplers' },
    stopPattern: { icon: '🛑', label: 'Stop Patterns' },
    retrievalConfiguration: { icon: '🧭', label: 'Retrieval Configurations' },
    budgetStrategy: { icon: '💰', label: 'Budget Strategies' },
    profile: { icon: '👤', label: 'Profiles' },
    memory: { icon: '🧠', label: 'Memories' },
    account: { icon: '🔑', label: 'Accounts' },
    multiplayerData: { icon: '👥', label: 'Multiplayer Data' },
    entityFolder: { icon: '📁', label: 'Folders' },
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
    if (nameIsMeaningful && e.name && e.name.length > 0) return false;
    if (descriptionIsMeaningful && e.description && e.description.length > 0) return false;

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
            const hasNonEmptyDialoguePrompt = hasDialoguePrompts && c.dialoguePrompts?.some(dp => dp.textContent);
            const hasKnowledgePrompts = c.knowledgePrompts && c.knowledgePrompts.length > 0;
            const hasNonEmptyKnowledgePrompt = hasKnowledgePrompts && c.knowledgePrompts?.some(kp => kp.textContent);
            const hasStarterPrompts = c.starterPrompts && c.starterPrompts.length > 0;
            return !(c.systemPrompt || c.appearancePrompt || hasNonEmptyDialoguePrompt || hasNonEmptyKnowledgePrompt || c.thinkPrompt || hasStarterPrompts)
                && !(c.images && Object.keys(c.images).length > 0)
                && !(c.memories && Object.values(c.memories).some(arr => arr.length > 0))
                && !(c.tools && Object.values(c.tools).some(v => v))
                && !(c.clothings && c.clothings.length > 0)
                && !hasNonEmptyTextInjection;
        }
        case 'context': {
            const c = entity as Context;
            return !c.text && !(c.urls?.length) && !(c.searchTerms?.length) && !(c.images?.length) && !c.searchEngine;
        }
        case 'location': {
            const l = entity as Location;
            return !l.text && !(l.images?.length) && !(l.locationBindings?.length) && !(l.characterWeights && Object.keys(l.characterWeights).length > 0);
        }
        case 'audioTrack': {
            const a = entity as AudioTrack;
            return !a.filename || !a.filename;
        }
        case 'world': {
            const w = entity as World;
            return !w.characterIds?.length && !w.contextIds?.length && !w.locationIds?.length && !w.audioTrackIds?.length
        }
        case 'promptBlock': {
            const p = entity as PromptBlock;
            return !p.textContent && !(p.images?.length);
        }
        case 'languageModel': {
            const m = entity as LanguageModel;
            return !m.model && !m.apiKey;
        }
        case 'spatiotemporalModel': {
            const m = entity as SpatiotemporalModel;
            return !m.model && !m.apiKey;
        }
        case 'sampler': {
            const s = entity as Sampler;
            const hasParams = s.parameters && Object.keys(s.parameters).length > 0;
            return !hasParams && !(s.stopPatterns?.length);
        }
        case 'stopPattern': {
            const sp = entity as StopPattern;
            return !sp.pattern;
        }
        case 'retrievalConfiguration': {
            return false;
        }
        case 'budgetStrategy': {
            const bs = entity as BudgetStrategy;
            return !(bs.modelIds?.length);
        }
        case 'memory': {
            const m = entity as Memory;
            return !m.textContent;
        }
        case 'account': {
            const a = entity as Account;
            return !a.username;
        }
        case 'multiplayerData': {
            const md = entity as MultiplayerData;
            return !(md.interactionDataIds?.length) && !(md.pendingAccountIds?.length) && Object.keys(md.multiplayerDataAccountConfigurations || {}).length === 0;
        }
        case 'entityFolder': {
            const f = entity as EntityFolder;
            return !f.itemIds?.length;
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
    onClose,
    allCharacters,
    allContexts,
    allLocations,
    allAudioTracks,
    allWorlds,
    allPromptBlocks,
    allLanguageModels,
    allSpatiotemporalModels,
    allSamplers,
    allStopPatterns,
    allRetrievalConfigurations,
    allBudgetStrategies,
    allProfiles,
    allMemories,
    allAccounts,
    allMultiplayerData,
    allEntityFolders,
    allRawInteractionDataShells,
    onDeleteCharacter,
    onDeleteContext,
    onDeleteLocation,
    onDeleteAudioTrack,
    onDeleteWorld,
    onDeletePromptBlock,
    onDeleteModel,
    onDeleteSpatiotemporalModel,
    onDeleteSampler,
    onDeleteStopPattern,
    onDeleteRetrievalConfiguration,
    onDeleteBudgetStrategy,
    onDeleteProfile,
    onDeleteMemory,
    onDeleteAccount,
    onDeleteMultiplayerData,
    onDeleteEntityFolder,
    onDeleteInteractionData,
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

    const [anchorTimeMs] = useState(() => Date.now());
    const staleCutoffMs = anchorTimeMs - staleDaysThreshold * 86400000;

    const isInteractionDataABranchStem = useCallback((id: string) => {
        return allRawInteractionDataShells.some(shell => shell.parentInteractionDataId === id);
    }, [allRawInteractionDataShells]);

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
            { label: 'Language Models', icon: '🤖', count: allLanguageModels.length, estimatedSizeKb: estimateKb(allLanguageModels, 1024) },
            { label: 'Spatiotemporal Models', icon: '🎨', count: allSpatiotemporalModels.length, estimatedSizeKb: estimateKb(allSpatiotemporalModels, 1024) },
            { label: 'Samplers', icon: '🎚️', count: allSamplers.length, estimatedSizeKb: estimateKb(allSamplers, 512) },
            { label: 'Stop Patterns', icon: '🛑', count: allStopPatterns.length, estimatedSizeKb: estimateKb(allStopPatterns, 256) },
            { label: 'Retrieval Configurations', icon: '🧭', count: allRetrievalConfigurations.length, estimatedSizeKb: estimateKb(allRetrievalConfigurations, 256) },
            { label: 'Budget Strategies', icon: '💰', count: allBudgetStrategies.length, estimatedSizeKb: estimateKb(allBudgetStrategies, 1024) },
            { label: 'Profiles', icon: '👤', count: allProfiles.length, estimatedSizeKb: estimateKb(allProfiles, 2048) },
            { label: 'Memories', icon: '🧠', count: allMemories.length, estimatedSizeKb: estimateKb(allMemories, 1024) },
            { label: 'Accounts', icon: '🔑', count: allAccounts.length, estimatedSizeKb: estimateKb(allAccounts, 512) },
            { label: 'Multiplayer Data', icon: '👥', count: allMultiplayerData.length, estimatedSizeKb: estimateKb(allMultiplayerData, 1024) },
            { label: 'Folders', icon: '📁', count: allEntityFolders.length, estimatedSizeKb: estimateKb(allEntityFolders, 1024) },
            { label: 'Sessions', icon: '💬', count: allRawInteractionDataShells.length, estimatedSizeKb: estimateKb(allRawInteractionDataShells, 8192) },
        ];
    }, [allCharacters, allContexts, allLocations, allAudioTracks, allWorlds, allPromptBlocks, allLanguageModels, allSpatiotemporalModels, allSamplers, allStopPatterns, allRetrievalConfigurations, allBudgetStrategies, allProfiles, allMemories, allAccounts, allMultiplayerData, allEntityFolders, allRawInteractionDataShells]);

    const scanCleanup = useCallback(() => {
        setIsScanning(true);

        const charIdSet = new Set(allCharacters.map(c => c.id));
        const ctxIdSet = new Set(allContexts.map(c => c.id));
        const locIdSet = new Set(allLocations.map(l => l.id));
        const audioIdSet = new Set(allAudioTracks.map(a => a.id));
        const modelIdSet = new Set(allLanguageModels.map(m => m.id));
        const spatiotemporalModelIdSet = new Set(allSpatiotemporalModels.map(m => m.id));
        const samplerIdSet = new Set(allSamplers.map(s => s.id));
        const stopPatternIdSet = new Set(allStopPatterns.map(sp => sp.id));
        const retrievalConfigIdSet = new Set(allRetrievalConfigurations.map(rc => rc.id));
        const profileIdSet = new Set(allProfiles.map(p => p.id));
        const memoryIdSet = new Set(allMemories.map(m => m.id));
        const accountIdSet = new Set(allAccounts.map(a => a.id));
        const chatIdSet = new Set(allRawInteractionDataShells.filter(s => s.id).map(s => s.id));

        const referencedCharIds = new Set<string>();
        const referencedCtxIds = new Set<string>();
        const referencedLocIds = new Set<string>();
        const referencedAudioIds = new Set<string>();
        const referencedPbIds = new Set<string>();
        const referencedModelIds = new Set<string>();
        const referencedSpatiotemporalModelIds = new Set<string>();
        const referencedSamplerIds = new Set<string>();
        const referencedStopPatternIds = new Set<string>();
        const referencedRetrievalConfigIds = new Set<string>();
        const referencedProfileIds = new Set<string>();
        const referencedMemoryIds = new Set<string>();
        const referencedAccountIds = new Set<string>();
        const referencedMultiplayerDataIds = new Set<string>();

        for (const world of allWorlds) {
            for (const id of world.characterIds) if (charIdSet.has(id)) referencedCharIds.add(id);
            for (const id of world.contextIds) if (ctxIdSet.has(id)) referencedCtxIds.add(id);
            for (const id of world.locationIds) if (locIdSet.has(id)) referencedLocIds.add(id);
            for (const id of world.audioTrackIds) if (audioIdSet.has(id)) referencedAudioIds.add(id);
            if (world.profileId && profileIdSet.has(world.profileId)) referencedProfileIds.add(world.profileId);
        }

        for (const shell of allRawInteractionDataShells) {
            for (const id of (shell.participantIds || [])) if (charIdSet.has(id)) referencedCharIds.add(id);
            for (const id of (shell.contextIds || [])) if (ctxIdSet.has(id)) referencedCtxIds.add(id);
            for (const id of (shell.locationIds || [])) if (locIdSet.has(id)) referencedLocIds.add(id);
            for (const id of (shell.audioTrackIds || [])) if (audioIdSet.has(id)) referencedAudioIds.add(id);
            if (shell.profileId && profileIdSet.has(shell.profileId)) referencedProfileIds.add(shell.profileId);
        }

        for (const c of allCharacters) {
            if (c.languageModelSampler?.id && samplerIdSet.has(c.languageModelSampler.id)) referencedSamplerIds.add(c.languageModelSampler.id);
            if (c.textToSpeechModelSampler?.id && samplerIdSet.has(c.textToSpeechModelSampler.id)) referencedSamplerIds.add(c.textToSpeechModelSampler.id);
            
            if (c.stopPatterns) {
                for (const sp of c.stopPatterns) {
                    if (stopPatternIdSet.has(sp.id)) referencedStopPatternIds.add(sp.id);
                }
            }

            if (c.dialogueRetrievalConfiguration?.id && retrievalConfigIdSet.has(c.dialogueRetrievalConfiguration.id)) referencedRetrievalConfigIds.add(c.dialogueRetrievalConfiguration.id);
            if (c.starterPromptRetrievalConfiguration?.id && retrievalConfigIdSet.has(c.starterPromptRetrievalConfiguration.id)) referencedRetrievalConfigIds.add(c.starterPromptRetrievalConfiguration.id);
            if (c.knowledgeRetrievalConfiguration?.id && retrievalConfigIdSet.has(c.knowledgeRetrievalConfiguration.id)) referencedRetrievalConfigIds.add(c.knowledgeRetrievalConfiguration.id);
            if (c.memoryRetrievalConfiguration?.id && retrievalConfigIdSet.has(c.memoryRetrievalConfiguration.id)) referencedRetrievalConfigIds.add(c.memoryRetrievalConfiguration.id);

            if (c.memories) {
                for (const memArr of Object.values(c.memories)) {
                    for (const mem of memArr) {
                        if (mem.id && memoryIdSet.has(mem.id)) referencedMemoryIds.add(mem.id);
                    }
                }
            }
        }

        for (const p of allProfiles) {
            const samplerRefs = [
                p.characterLanguageModelSampler?.id,
                p.characterTextToSpeechModelSampler?.id,
                p.webSummarizationSampler?.id,
                p.interactionDataSummarizationSampler?.id,
            ];
            for (const sId of samplerRefs) {
                if (sId && samplerIdSet.has(sId)) referencedSamplerIds.add(sId);
            }

            const stopPatternRefs = [
                p.characterStopPattern?.id,
                p.webSummarizationStopPattern?.id,
                p.interactionDataSummarizationStopPattern?.id,
            ];
            for (const spId of stopPatternRefs) {
                if (spId && stopPatternIdSet.has(spId)) referencedStopPatternIds.add(spId);
            }

            const rcRefs = [
                p.characterDialogueRetrievalConfiguration?.id,
                p.characterStarterPromptRetrievalConfiguration?.id,
                p.characterKnowledgeRetrievalConfiguration?.id,
                p.characterMemoryRetrievalConfiguration?.id
            ];
            for (const rcId of rcRefs) {
                if (rcId && retrievalConfigIdSet.has(rcId)) referencedRetrievalConfigIds.add(rcId);
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
            for (const modelId of (bs.modelIds || [])) if (modelIdSet.has(modelId)) referencedModelIds.add(modelId);
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
            for (const id of md.pendingAccountIds || []) if (accountIdSet.has(id)) referencedAccountIds.add(id);
            for (const [acctId, cfg] of Object.entries(md.multiplayerDataAccountConfigurations || {})) {
                if (accountIdSet.has(acctId)) referencedAccountIds.add(acctId);
                if (cfg.protagonistCharacterId && charIdSet.has(cfg.protagonistCharacterId)) referencedCharIds.add(cfg.protagonistCharacterId);
                for (const cId of cfg.whitelistedCharacterIds || []) if (charIdSet.has(cId)) referencedCharIds.add(cId);
                for (const cId of cfg.blacklistedCharacterIds || []) if (charIdSet.has(cId)) referencedCharIds.add(cId);
                for (const cId of cfg.pendingCharacterIds || []) if (charIdSet.has(cId)) referencedCharIds.add(cId);
            }
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
        for (const m of allLanguageModels) check('languageModel', m.id, m.name, m.lastUpdatedTimestamp, referencedModelIds.has(m.id), m);
        for (const m of allSpatiotemporalModels) check('spatiotemporalModel', m.id, m.name, m.lastUpdatedTimestamp, referencedSpatiotemporalModelIds.has(m.id), m);
        for (const s of allSamplers) check('sampler', s.id, s.name, s.lastUpdatedTimestamp, referencedSamplerIds.has(s.id), s);
        for (const sp of allStopPatterns) check('stopPattern', sp.id, sp.name, sp.lastUpdatedTimestamp, referencedStopPatternIds.has(sp.id), sp);
        for (const rc of allRetrievalConfigurations) check('retrievalConfiguration', rc.id, rc.name, rc.lastUpdatedTimestamp, referencedRetrievalConfigIds.has(rc.id), rc);
        for (const bs of allBudgetStrategies) check('budgetStrategy', bs.id, bs.name, bs.lastUpdatedTimestamp, true, bs);
        for (const p of allProfiles) check('profile', p.id, p.name, p.lastUpdatedTimestamp, referencedProfileIds.has(p.id), p);
        for (const m of allMemories) check('memory', m.id, m.name, m.lastUpdatedTimestamp, referencedMemoryIds.has(m.id), m);
        for (const a of allAccounts) check('account', a.id, a.name, a.lastUpdatedTimestamp, referencedAccountIds.has(a.id), a);
        for (const md of allMultiplayerData) check('multiplayerData', md.id, md.name, md.lastUpdatedTimestamp, referencedMultiplayerDataIds.has(md.id), md);
        for (const f of allEntityFolders) check('entityFolder', f.id, f.name, f.lastUpdatedTimestamp, true, f);

        setCleanupItems(found);
        setSelectedIds(new Set());
        setSearchQuery('');
        setIsScanning(false);
    }, [allCharacters, allContexts, allLocations, allAudioTracks, allWorlds, allPromptBlocks, allLanguageModels, allSpatiotemporalModels, allSamplers, allStopPatterns, allRetrievalConfigurations, allBudgetStrategies, allProfiles, allMemories, allAccounts, allMultiplayerData, allEntityFolders, allRawInteractionDataShells, nameIsMeaningful, descriptionIsMeaningful, staleDaysCleanup]);

    const scanIntegrity = useCallback(() => {
        setIsScanning(true);
        const issues: IntegrityIssue[] = [];
        const charIdSet = new Set(allCharacters.map(c => c.id));
        const ctxIdSet = new Set(allContexts.map(c => c.id));
        const locIdSet = new Set(allLocations.map(l => l.id));
        const audioIdSet = new Set(allAudioTracks.map(a => a.id));
        const modelIdSet = new Set(allLanguageModels.map(m => m.id));
        const spatiotemporalModelIdSet = new Set(allSpatiotemporalModels.map(m => m.id));
        const samplerIdSet = new Set(allSamplers.map(s => s.id));
        const stopPatternIdSet = new Set(allStopPatterns.map(sp => sp.id));
        const retrievalConfigIdSet = new Set(allRetrievalConfigurations.map(rc => rc.id));
        const profileIdSet = new Set(allProfiles.map(p => p.id));
        const memoryIdSet = new Set(allMemories.map(m => m.id));
        const accountIdSet = new Set(allAccounts.map(a => a.id));
        const chatIdSet = new Set(allRawInteractionDataShells.filter(s => s.id).map(s => s.id));

        // Global ID pool for unified folder validation
        const globalEntityIds = new Set<string>();
        allCharacters.forEach(c => globalEntityIds.add(c.id));
        allContexts.forEach(c => globalEntityIds.add(c.id));
        allLocations.forEach(l => globalEntityIds.add(l.id));
        allAudioTracks.forEach(a => globalEntityIds.add(a.id));
        allWorlds.forEach(w => globalEntityIds.add(w.id));
        allPromptBlocks.forEach(p => globalEntityIds.add(p.id));
        allLanguageModels.forEach(m => globalEntityIds.add(m.id));
        allSpatiotemporalModels.forEach(m => globalEntityIds.add(m.id));
        allSamplers.forEach(s => globalEntityIds.add(s.id));
        allStopPatterns.forEach(sp => globalEntityIds.add(sp.id));
        allRetrievalConfigurations.forEach(rc => globalEntityIds.add(rc.id));
        allBudgetStrategies.forEach(bs => globalEntityIds.add(bs.id));
        allProfiles.forEach(p => globalEntityIds.add(p.id));
        allMemories.forEach(m => globalEntityIds.add(m.id));
        allAccounts.forEach(a => globalEntityIds.add(a.id));
        allMultiplayerData.forEach(md => globalEntityIds.add(md.id));
        allRawInteractionDataShells.forEach(s => s.id && globalEntityIds.add(s.id));

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
            if (world.profileId && !profileIdSet.has(world.profileId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing profile', refType: 'profile', refId: world.profileId });
        }
        for (const c of allCharacters) {
            if (c.languageModelSampler?.id && !samplerIdSet.has(c.languageModelSampler.id)) issues.push({ entityType: 'Character', entityName: c.name, issue: 'References missing language model sampler', refType: 'Sampler', refId: c.languageModelSampler.id });
            if (c.textToSpeechModelSampler?.id && !samplerIdSet.has(c.textToSpeechModelSampler.id)) issues.push({ entityType: 'Character', entityName: c.name, issue: 'References missing TTS sampler', refType: 'Sampler', refId: c.textToSpeechModelSampler.id });
            
            if (c.stopPatterns) {
                for (const sp of c.stopPatterns) {
                    if (!stopPatternIdSet.has(sp.id)) issues.push({ entityType: 'Character', entityName: c.name, issue: 'References missing stop pattern', refType: 'Stop Pattern', refId: sp.id });
                }
            }

            if (c.dialogueRetrievalConfiguration?.id && !retrievalConfigIdSet.has(c.dialogueRetrievalConfiguration.id)) issues.push({ entityType: 'Character', entityName: c.name, issue: 'References missing dialogue retrieval configuration', refType: 'Retrieval Configuration', refId: c.dialogueRetrievalConfiguration.id });
            if (c.starterPromptRetrievalConfiguration?.id && !retrievalConfigIdSet.has(c.starterPromptRetrievalConfiguration.id)) issues.push({ entityType: 'Character', entityName: c.name, issue: 'References missing starter prompt retrieval configuration', refType: 'Retrieval Configuration', refId: c.starterPromptRetrievalConfiguration.id });
            if (c.knowledgeRetrievalConfiguration?.id && !retrievalConfigIdSet.has(c.knowledgeRetrievalConfiguration.id)) issues.push({ entityType: 'Character', entityName: c.name, issue: 'References missing knowledge retrieval configuration', refType: 'Retrieval Configuration', refId: c.knowledgeRetrievalConfiguration.id });
            if (c.memoryRetrievalConfiguration?.id && !retrievalConfigIdSet.has(c.memoryRetrievalConfiguration.id)) issues.push({ entityType: 'Character', entityName: c.name, issue: 'References missing memory retrieval configuration', refType: 'Retrieval Configuration', refId: c.memoryRetrievalConfiguration.id });

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
            for (const modelId of (bs.modelIds || [])) {
                if (!modelIdSet.has(modelId)) issues.push({ entityType: 'Budget Strategy', entityName: bs.name, issue: 'References missing model', refType: 'Language Model', refId: modelId });
            }
        }
        for (const mem of allMemories) {
            const interactionId = mem.id;
            if (interactionId && !chatIdSet.has(interactionId)) {
                issues.push({ entityType: 'Memory', entityName: mem.name, issue: 'References missing session', refType: 'Session', refId: interactionId });
            }
        }
        for (const md of allMultiplayerData) {
            for (const id of md.pendingAccountIds || []) { if (!accountIdSet.has(id)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: 'References missing pending account', refType: 'Account', refId: id }); }
            for (const [acctId, cfg] of Object.entries(md.multiplayerDataAccountConfigurations || {})) {
                if (!accountIdSet.has(acctId)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: 'References missing account configuration', refType: 'Account', refId: acctId });
                if (cfg.protagonistCharacterId && !charIdSet.has(cfg.protagonistCharacterId)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: `Active character for account ${acctId.slice(0, 8)}... is missing`, refType: 'Character', refId: cfg.protagonistCharacterId });
                for (const cId of cfg.whitelistedCharacterIds || []) { if (!charIdSet.has(cId)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: `Whitelisted character for account ${acctId.slice(0, 8)}... is missing`, refType: 'Character', refId: cId }); }
                for (const cId of cfg.blacklistedCharacterIds || []) { if (!charIdSet.has(cId)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: `Blacklisted character for account ${acctId.slice(0, 8)}... is missing`, refType: 'Character', refId: cId }); }
                for (const cId of cfg.pendingCharacterIds || []) { if (!charIdSet.has(cId)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: `Pending character for account ${acctId.slice(0, 8)}... is missing`, refType: 'Character', refId: cId }); }
            }
            for (const chatId of md.interactionDataIds) { if (!chatIdSet.has(chatId)) issues.push({ entityType: 'Multiplayer Data', entityName: md.name, issue: 'References missing session', refType: 'Session', refId: chatId }); }
        }
        
        // ✅ Unified Folder Integrity Check
        for (const folder of allEntityFolders) {
            for (const itemId of folder.itemIds) {
                if (!globalEntityIds.has(itemId)) {
                    issues.push({ entityType: 'Folder', entityName: folder.name, issue: `References missing ${folder.entityType} entity`, refType: folder.entityType, refId: itemId });
                }
            }
        }

        for (const p of allProfiles) {
            const samplerChecks = [
                { sampler: p.characterLanguageModelSampler, label: 'language model sampler' },
                { sampler: p.characterTextToSpeechModelSampler, label: 'TTS sampler' },
                { sampler: p.webSummarizationSampler, label: 'web summarization sampler' },
                { sampler: p.interactionDataSummarizationSampler, label: 'interaction data sampler' },
            ];
            for (const check of samplerChecks) {
                if (check.sampler?.id && !samplerIdSet.has(check.sampler.id)) {
                    issues.push({ entityType: 'Profile', entityName: p.name, issue: `References missing ${check.label}`, refType: 'Sampler', refId: check.sampler.id });
                }
            }

            const stopPatternChecks = [
                { sp: p.characterStopPattern, label: 'character stop pattern' },
                { sp: p.webSummarizationStopPattern, label: 'web summarization stop pattern' },
                { sp: p.interactionDataSummarizationStopPattern, label: 'interaction data stop pattern' },
            ];
            for (const check of stopPatternChecks) {
                if (check.sp?.id && !stopPatternIdSet.has(check.sp.id)) {
                    issues.push({ entityType: 'Profile', entityName: p.name, issue: `References missing ${check.label}`, refType: 'Stop Pattern', refId: check.sp.id });
                }
            }

            const rcChecks = [
                { rc: p.characterDialogueRetrievalConfiguration, label: 'dialogue retrieval configuration' },
                { rc: p.characterStarterPromptRetrievalConfiguration, label: 'starter prompt retrieval configuration' },
                { rc: p.characterKnowledgeRetrievalConfiguration, label: 'knowledge retrieval configuration' },
                { rc: p.characterMemoryRetrievalConfiguration, label: 'memory retrieval configuration' },
            ];
            for (const check of rcChecks) {
                if (check.rc?.id && !retrievalConfigIdSet.has(check.rc.id)) {
                    issues.push({ entityType: 'Profile', entityName: p.name, issue: `References missing ${check.label}`, refType: 'Retrieval Configuration', refId: check.rc.id });
                }
            }
        }

        setIntegrityIssues(issues);
        setIsScanning(false);
    }, [allCharacters, allContexts, allLocations, allAudioTracks, allWorlds, allPromptBlocks, allLanguageModels, allSpatiotemporalModels, allSamplers, allStopPatterns, allRetrievalConfigurations, allBudgetStrategies, allProfiles, allMemories, allAccounts, allMultiplayerData, allEntityFolders, allRawInteractionDataShells]);

    const filteredAndSorted = useMemo(() => {
        const query = searchQuery.toLowerCase();
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

    const handleDeleteSelected = () => {
        let deletedCount = 0;
        let skippedStems = 0;
        for (const item of cleanupItems) {
            if (!selectedIds.has(item.id)) continue;
            
            if (item.type === 'entityFolder') {
                const folder = allEntityFolders.find(f => f.id === item.id);
                if (folder && folder.entityType === 'interactionData') {
                    for (const dataId of folder.itemIds) {
                        if (isInteractionDataABranchStem(dataId)) {
                            skippedStems++;
                        } else {
                            onDeleteInteractionData(dataId);
                        }
                    }
                }
                onDeleteEntityFolder(item.id);
                deletedCount++;
                continue;
            }

            switch (item.type) {
                case 'character': onDeleteCharacter(item.id); break;
                case 'context': onDeleteContext(item.id); break;
                case 'location': onDeleteLocation(item.id); break;
                case 'audioTrack': onDeleteAudioTrack(item.id); break;
                case 'world': onDeleteWorld(item.id); break;
                case 'promptBlock': onDeletePromptBlock(item.id); break;
                case 'languageModel': onDeleteModel(item.id); break;
                case 'spatiotemporalModel': onDeleteSpatiotemporalModel(item.id); break;
                case 'sampler': onDeleteSampler(item.id); break;
                case 'stopPattern': onDeleteStopPattern(item.id); break;
                case 'retrievalConfiguration': onDeleteRetrievalConfiguration(item.id); break;
                case 'budgetStrategy': onDeleteBudgetStrategy(item.id); break;
                case 'profile': onDeleteProfile(item.id); break;
                case 'memory': onDeleteMemory(item.id); break;
                case 'account': onDeleteAccount(item.id); break;
                case 'multiplayerData': onDeleteMultiplayerData(item.id); break;
            }
            deletedCount++;
        }
        if (skippedStems > 0) {
            addToast(`Deleted ${deletedCount} entit${deletedCount === 1 ? 'y' : 'ies'}. Preserved ${skippedStems} stem session${skippedStems === 1 ? '' : 's'} in root.`, 'info');
        } else {
            addToast(`Deleted ${deletedCount} entit${deletedCount === 1 ? 'y' : 'ies'}.`, 'success');
        }
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
        if (shell.profileId && exclusionIdSet.profile.has(shell.profileId)) return true;
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
        const q = exclusionSearchQuery.toLowerCase();
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

    const bulkCandidates = useMemo(() => {
        if (!includeStale && !includeLowMessage) return [];
        return allRawInteractionDataShells.filter(shell => {
            if (!shell.id) return false;
            if (isInteractionDataABranchStem(shell.id)) return false; 
            
            const matchesStale = includeStale && (shell.lastUpdatedTimestamp ?? 0) < staleCutoffMs;
            
            const msgCount = Object.values(shell.interactionHistories || {}).reduce((sum, msgs) => sum + msgs.length, 0);
            const matchesLow = includeLowMessage && msgCount < minMessagesThreshold;
            
            if (!matchesStale && !matchesLow) return false;
            if (isShellExcluded(shell)) return false;
            return true;
        });
    }, [allRawInteractionDataShells, includeStale, includeLowMessage, staleCutoffMs, minMessagesThreshold, isShellExcluded, isInteractionDataABranchStem]);

    const handleBulkDeleteCandidates = () => {
        let deletedCount = 0;
        for (const shell of bulkCandidates) { 
            if (shell.id) { 
                onDeleteInteractionData(shell.id); 
                deletedCount++; 
            } 
        }
        addToast(`Deleted ${deletedCount} session${deletedCount !== 1 ? 's' : ''}.`, 'success');
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

    const handleClearActionFormatPreferences = async () => {
        try {
            await deleteActionFormatData();
            await deleteFormatPreferences();
            addToast('Action format preferences cleared.', 'success');
        } catch {
            addToast('Failed to clear action format preferences.', 'error');
        }
    };

    const handleFactoryReset = async () => {
        try {
            await saveRawSessionData({
                selectedCharacterId: null,
                selectedModelId: null,
                selectedProfileId: null,
                selectedBudgetStrategyId: null,
                activeChatId: null,
                currentAccountId: null,
            });
            await deleteSessionData();
            await deleteMultiplayerJoinData();
            await deleteActionFormatData();
            await deleteFormatPreferences();

            clearPreferencesCache();
            clearSaveQueue();

            try {
                for (const key of Object.keys(localStorage).filter(k => k.startsWith('loreReactor_'))) {
                    localStorage.removeItem(key);
                }
            } catch { /* ignore */ }

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
            case 'models': for (const m of allLanguageModels) { onDeleteModel(m.id); count++; } break;
            case 'spatiotemporalModels': for (const m of allSpatiotemporalModels) { onDeleteSpatiotemporalModel(m.id); count++; } break;
            case 'samplers': for (const s of allSamplers) { onDeleteSampler(s.id); count++; } break;
            case 'stopPatterns': for (const sp of allStopPatterns) { onDeleteStopPattern(sp.id); count++; } break;
            case 'retrievalConfigurations': for (const rc of allRetrievalConfigurations) { onDeleteRetrievalConfiguration(rc.id); count++; } break;
            case 'budgetStrategies': for (const bs of allBudgetStrategies) { onDeleteBudgetStrategy(bs.id); count++; } break;
            case 'profiles': for (const p of allProfiles) { onDeleteProfile(p.id); count++; } break;
            case 'memories': for (const m of allMemories) { onDeleteMemory(m.id); count++; } break;
            case 'accounts': for (const a of allAccounts) { onDeleteAccount(a.id); count++; } break;
            case 'multiplayerData': for (const md of allMultiplayerData) { onDeleteMultiplayerData(md.id); count++; } break;
            case 'folders': {
                let preservedStems = 0;
                for (const f of allEntityFolders) { 
                    if (f.entityType === 'interactionData') {
                        for (const dataId of f.itemIds) {
                            if (isInteractionDataABranchStem(dataId)) {
                                preservedStems++;
                            } else {
                                onDeleteInteractionData(dataId);
                            }
                        }
                    }
                    onDeleteEntityFolder(f.id); 
                    count++; 
                }
                if (preservedStems > 0) {
                    addToast(`Wiped ${count} folders. Preserved ${preservedStems} stem session${preservedStems === 1 ? '' : 's'} in root.`, 'info');
                } else {
                    addToast(`Wiped ${count} folders.`, 'success');
                }
                setConfirmDangerAction(null);
                return;
            }
            case 'chats': {
                for (const s of allRawInteractionDataShells) { 
                    if (s.id) { 
                        onDeleteInteractionData(s.id); 
                        count++; 
                    } 
                }
                break;
            }
        }
        addToast(`Wiped ${count} ${entityType}.`, 'success');
        setConfirmDangerAction(null);
    };

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
                                    <div style={{ position: 'relative', flex: 1, minWidth: '120px' }}>
                                        <input 
                                            type="text" 
                                            value={searchQuery} 
                                            onChange={e => setSearchQuery(e.target.value)} 
                                            placeholder="Search..." 
                                            className="editor-input" 
                                            style={{ width: '100%', fontSize: '0.75rem', padding: '8px 12px', paddingRight: searchQuery ? '36px' : '12px' }} 
                                        />
                                        {searchQuery && (
                                            <button
                                                type="button"
                                                onClick={() => setSearchQuery('')}
                                                style={{
                                                    position: 'absolute',
                                                    right: '8px',
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: 'var(--text-h)',
                                                    cursor: 'pointer',
                                                    fontSize: '0.9rem',
                                                    opacity: 0.5,
                                                    padding: '4px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                                title="Clear search"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
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

                    {activeTab === 'integrity' && (
                        <div>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '12px', lineHeight: 1.5 }}>Cross-reference integrity check. Finds broken bindings where entities reference deleted characters, contexts, locations, audio tracks, worlds, prompt blocks, models, samplers, stop patterns, retrieval configurations, memories, sessions, accounts, folders, or profiles.</div>
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

                    {activeTab === 'cache' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, lineHeight: 1.5 }}>Purge cached data to free up disk space. Caches will be rebuilt automatically as needed.</div>
                            <div className="editor-section" style={{ margin: 0 }}><div className="editor-section-title">Webpage Cache</div><div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Cached web pages fetched via context URLs and search terms.</div><button type="button" className="editor-button editor-button-cancel" onClick={handleClearWebpageCache} style={{ fontSize: '0.75rem', width: '100%' }}>🧹 Clear Webpage Cache</button></div>
                            <div className="editor-section" style={{ margin: 0 }}><div className="editor-section-title">Image Cache</div><div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Cached character, context, location, and prompt block images.</div><button type="button" className="editor-button editor-button-cancel" onClick={handleClearImageCache} style={{ fontSize: '0.75rem', width: '100%' }}>🧹 Clear Image Cache</button></div>
                            <div className="editor-section" style={{ margin: 0 }}><div className="editor-section-title">Token Cache</div><div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>In-memory token counting cache used by the language model engine.</div><button type="button" className="editor-button editor-button-cancel" onClick={handleClearTokenCache} style={{ fontSize: '0.75rem', width: '100%' }}>🧹 Clear Token Cache</button></div>
                            
                            <div className="editor-section" style={{ margin: 0, borderColor: 'rgba(239,68,68,0.2)' }}>
                                <div className="editor-section-title" style={{ color: '#ef4444' }}>Action Format Preferences</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>
                                    Resets the learned formatting matrix (e.g., Auto-Format, manual edit corrections) back to defaults. Useful if the engine learns incorrect patterns.
                                </div>
                                <button type="button" className="editor-button editor-button-cancel" onClick={handleClearActionFormatPreferences} style={{ fontSize: '0.75rem', width: '100%', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
                                    🧹 Clear Action Format Preferences
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'bulk' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, lineHeight: 1.5 }}>Bulk delete sessions by inclusion criteria. Add exclusions to protect sessions containing specific entities. Branch stems are automatically protected.</div>
                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Inclusion Criteria</div>
                                <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '10px' }}>Select which sessions to include for deletion. At least one must be enabled.</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderRadius: '6px', border: `1px solid ${includeStale ? 'var(--accent)' : 'var(--border)'}`, background: includeStale ? 'var(--accent-bg)' : 'transparent', transition: 'all 0.15s' }}>
                                        <label className="editor-checkbox-label" style={{ margin: 0 }}><input type="checkbox" checked={includeStale} onChange={e => { setIncludeStale(e.target.checked); setConfirmBulkDelete(false); }} className="editor-checkbox-input" /><span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Stale Sessions</span></label>
                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>— older than</span>
                                        <input type="number" min="1" max="365" value={staleDaysThreshold} onChange={e => { setStaleDaysThreshold(Math.max(1, Math.min(365, Number(e.target.value) || 30))); setConfirmBulkDelete(false); }} className="editor-input" style={{ width: '60px', textAlign: 'right', fontSize: '0.7rem', padding: '4px 6px' }} />
                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>days</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderRadius: '6px', border: `1px solid ${includeLowMessage ? 'var(--accent)' : 'var(--border)'}`, background: includeLowMessage ? 'var(--accent-bg)' : 'transparent', transition: 'all 0.15s' }}>
                                        <label className="editor-checkbox-label" style={{ margin: 0 }}><input type="checkbox" checked={includeLowMessage} onChange={e => { setIncludeLowMessage(e.target.checked); setConfirmBulkDelete(false); }} className="editor-checkbox-input" /><span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Low Message Sessions</span></label>
                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>— fewer than</span>
                                        <input type="number" min="1" max="1000" value={minMessagesThreshold} onChange={e => { setMinMessagesThreshold(Math.max(1, Math.min(1000, Number(e.target.value) || 3))); setConfirmBulkDelete(false); }} className="editor-input" style={{ width: '60px', textAlign: 'right', fontSize: '0.7rem', padding: '4px 6px' }} />
                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>messages</span>
                                    </div>
                                </div>
                            </div>
                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Exclusion Criteria</div>
                                <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '10px' }}>Sessions containing any excluded entity will be protected from deletion.</div>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '10px', position: 'relative' }}>
                                    <select value={exclusionDropdownType} onChange={e => { setExclusionDropdownType(e.target.value as ExclusionEntityType); setExclusionSearchQuery(''); setIsExclusionDropdownOpen(false); }} className="editor-input" style={{ width: '140px', fontSize: '0.7rem', padding: '6px 8px' }}>
                                        {(Object.keys(EXCLUSION_TYPE_META) as ExclusionEntityType[]).map(key => (<option key={key} value={key}>{EXCLUSION_TYPE_META[key].icon} {EXCLUSION_TYPE_META[key].label}</option>))}
                                    </select>
                                    <div style={{ flex: 1, position: 'relative' }}>
                                        <input 
                                            type="text" 
                                            value={exclusionSearchQuery} 
                                            onChange={e => { setExclusionSearchQuery(e.target.value); setIsExclusionDropdownOpen(true); }} 
                                            onFocus={() => { if (exclusionSearchQuery) setIsExclusionDropdownOpen(true); }} 
                                            placeholder={`Search ${EXCLUSION_TYPE_META[exclusionDropdownType].label.toLowerCase()}...`} 
                                            className="editor-input" 
                                            style={{ width: '100%', fontSize: '0.7rem', padding: '6px 8px', paddingRight: exclusionSearchQuery ? '32px' : '8px' }} 
                                        />
                                        {exclusionSearchQuery && (
                                            <button
                                                type="button"
                                                onClick={() => { setExclusionSearchQuery(''); setIsExclusionDropdownOpen(false); }}
                                                style={{
                                                    position: 'absolute',
                                                    right: '8px',
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: 'var(--text-h)',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    opacity: 0.5,
                                                    padding: '4px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                                title="Clear search"
                                            >
                                                ✕
                                            </button>
                                        )}
                                        {isExclusionDropdownOpen && exclusionSearchResults.length > 0 && (
                                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, maxHeight: '180px', overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '0 0 6px 6px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                                                {exclusionSearchResults.map(item => (<div key={item.id} onClick={() => addExclusion(exclusionDropdownType, item.id, item.name)} style={{ padding: '6px 10px', fontSize: '0.7rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-bg)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{EXCLUSION_TYPE_META[exclusionDropdownType].icon} {item.name}</div>))}
                                            </div>
                                        )}
                                        {isExclusionDropdownOpen && exclusionSearchQuery && exclusionSearchResults.length === 0 && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '0 0 6px 6px', fontSize: '0.65rem', opacity: 0.5 }}>No results found.</div>)}
                                    </div>
                                </div>
                                {exclusions.length > 0 && (
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                        {exclusions.map(ex => (<span key={`${ex.entityType}-${ex.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.65rem', padding: '3px 8px', borderRadius: '12px', background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{EXCLUSION_TYPE_META[ex.entityType].icon} {ex.name}<span onClick={() => removeExclusion(ex.entityType, ex.id)} style={{ cursor: 'pointer', marginLeft: '2px', opacity: 0.6, fontSize: '0.7rem', lineHeight: 1 }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}>✕</span></span>))}
                                        <span onClick={() => { setExclusions([]); setConfirmBulkDelete(false); }} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.6rem', padding: '3px 8px', borderRadius: '12px', border: '1px solid var(--border)', cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.15s' }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}>Clear All</span>
                                    </div>
                                )}
                                {exclusions.length === 0 && (<div style={{ fontSize: '0.65rem', opacity: 0.4, fontStyle: 'italic' }}>No exclusions set — all matching sessions will be eligible for deletion.</div>)}
                            </div>
                            <div className="editor-section" style={{ margin: 0, borderColor: bulkCandidates.length > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)' }}>
                                <div className="editor-section-title">Result</div>
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: bulkCandidates.length > 0 ? '#ef4444' : 'var(--text-h)' }}>{bulkCandidates.length}</div>
                                        <div style={{ fontSize: '0.65rem', opacity: 0.5 }}>session{bulkCandidates.length !== 1 ? 's' : ''} will be deleted{exclusions.length > 0 && (<span> ({allRawInteractionDataShells.filter(s => s.id && isShellExcluded(s)).length} excluded)</span>)}</div>
                                    </div>
                                    {(!includeStale && !includeLowMessage) && (<div style={{ fontSize: '0.7rem', opacity: 0.5, fontStyle: 'italic' }}>Enable at least one inclusion criterion.</div>)}
                                </div>
                                {bulkCandidates.length > 0 && (
                                    <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '10px' }}>
                                        {bulkCandidates.slice(0, 50).map(shell => { 
                                            const msgCount = Object.values(shell.interactionHistories || {}).reduce((sum, msgs) => sum + msgs.length, 0); 
                                            const age = daysAgo(shell.lastUpdatedTimestamp ?? 0); 
                                            return (<div key={shell.id} style={{ padding: '4px 8px', fontSize: '0.65rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: '8px' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{shell.name || 'Untitled'}</span><span style={{ opacity: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{msgCount} msg • {age}d ago</span></div>); 
                                        })}
                                        {bulkCandidates.length > 50 && (<div style={{ padding: '4px 8px', fontSize: '0.6rem', opacity: 0.4, textAlign: 'center' }}>...and {bulkCandidates.length - 50} more</div>)}
                                    </div>
                                )}
                                <button type="button" className="editor-button" disabled={bulkCandidates.length === 0} onClick={() => confirmBulkDelete ? handleBulkDeleteCandidates() : setConfirmBulkDelete(true)} style={{ fontSize: '0.75rem', width: '100%', color: confirmBulkDelete ? '#fff' : bulkCandidates.length > 0 ? '#ef4444' : undefined, background: confirmBulkDelete ? '#ef4444' : 'transparent', borderColor: bulkCandidates.length > 0 ? 'rgba(239,68,68,0.3)' : undefined }}>
                                    {confirmBulkDelete ? `⚠️ Confirm Delete ${bulkCandidates.length} Session${bulkCandidates.length !== 1 ? 's' : ''}` : `🗑️ Delete ${bulkCandidates.length} Session${bulkCandidates.length !== 1 ? 's' : ''}`}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'danger' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', fontSize: '0.75rem', color: '#ef4444', lineHeight: 1.5 }}>⚠️ These operations are <strong>irreversible</strong>. Data cannot be recovered after deletion. Export your data first.</div>
                            <div className="editor-section" style={{ margin: 0, borderColor: 'rgba(239,68,68,0.2)' }}>
                                <div className="editor-section-title" style={{ color: '#ef4444' }}>Selective Wipe</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Delete all entities of a specific type while preserving everything else. Deleting folders will cascade delete contents, except stem sessions which spill to root.</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                    {[
                                        { key: 'characters', label: 'All Characters', count: allCharacters.length },
                                        { key: 'contexts', label: 'All Contexts', count: allContexts.length },
                                        { key: 'locations', label: 'All Locations', count: allLocations.length },
                                        { key: 'audioTracks', label: 'All Audio Tracks', count: allAudioTracks.length },
                                        { key: 'worlds', label: 'All Worlds', count: allWorlds.length },
                                        { key: 'promptBlocks', label: 'All Prompt Blocks', count: allPromptBlocks.length },
                                        { key: 'models', label: 'All Language Models', count: allLanguageModels.length },
                                        { key: 'spatiotemporalModels', label: 'All Spatiotemporal Models', count: allSpatiotemporalModels.length },
                                        { key: 'samplers', label: 'All Samplers', count: allSamplers.length },
                                        { key: 'stopPatterns', label: 'All Stop Patterns', count: allStopPatterns.length },
                                        { key: 'retrievalConfigurations', label: 'All Retrieval Configs', count: allRetrievalConfigurations.length },
                                        { key: 'budgetStrategies', label: 'All Budget Strategies', count: allBudgetStrategies.length },
                                        { key: 'profiles', label: 'All Profiles', count: allProfiles.length },
                                        { key: 'memories', label: 'All Memories', count: allMemories.length },
                                        { key: 'accounts', label: 'All Accounts', count: allAccounts.length },
                                        { key: 'multiplayerData', label: 'All Multiplayer Data', count: allMultiplayerData.length },
                                        { key: 'folders', label: 'All Folders', count: allEntityFolders.length },
                                        { key: 'chats', label: 'All Sessions', count: allRawInteractionDataShells.length },
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
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Wipe ALL local and server-persisted session data. The app will reload automatically.</div>
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