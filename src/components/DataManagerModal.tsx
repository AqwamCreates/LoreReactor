// src/components/DataManagerModal.tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Character, Context, Location, AudioTrack, World, PromptBlock, RawInteractionData } from '../types';
import { useToast } from '../context/ToastContext';
import './main.css';

interface DataManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allPromptBlocks: PromptBlock[];
    rawChatShells: RawInteractionData[];
    onDeleteCharacter: (id: string) => void;
    onDeleteContext: (id: string) => void;
    onDeleteLocation: (id: string) => void;
    onDeleteAudioTrack: (id: string) => void;
    onDeleteWorld: (id: string) => void;
    onDeletePromptBlock: (id: string) => void;
    onDeleteChat: (id: string) => void;
}

type TabId = 'storage' | 'cleanup' | 'integrity' | 'cache' | 'bulk' | 'danger';

type EntityType = 'character' | 'context' | 'location' | 'audioTrack' | 'promptBlock';

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

const ENTITY_TYPE_META: Record<EntityType, { icon: string; label: string }> = {
    character: { icon: '🎭', label: 'Characters' },
    context: { icon: '📜', label: 'Contexts' },
    location: { icon: '📍', label: 'Locations' },
    audioTrack: { icon: '🔊', label: 'Audio Tracks' },
    promptBlock: { icon: '🧱', label: 'Prompt Blocks' },
};

function isEntityHollow(
    type: EntityType,
    entity: Character | Context | Location | AudioTrack | PromptBlock,
    nameIsMeaningful: boolean,
    descriptionIsMeaningful: boolean,
): boolean {
    if (nameIsMeaningful && entity.name && entity.name.trim().length > 0) return false;
    if (descriptionIsMeaningful && entity.description && entity.description.trim().length > 0) return false;

    switch (type) {
        case 'character': {
            const c = entity as Character;
            return !(c.systemPrompt?.trim() || c.appearancePrompt?.trim() || c.dialoguePrompt?.trim() || c.thinkPrompt?.trim())
                && !(c.images && Object.keys(c.images).length > 0)
                && !(c.memories && Object.values(c.memories).some(arr => arr.length > 0))
                && !(c.tools && Object.values(c.tools).some(v => v));
        }
        case 'context': {
            const c = entity as Context;
            return !c.text?.trim() && !(c.urls?.length) && !(c.searchTerms?.length) && !(c.images?.length);
        }
        case 'location': {
            const l = entity as Location;
            return !l.text?.trim() && !(l.images?.length) && !(l.locationBindings?.length) && !(l.characterWeights && Object.keys(l.characterWeights).length > 0);
        }
        case 'audioTrack': {
            const a = entity as AudioTrack;
            return !a.filename || !a.filename.trim();
        }
        case 'promptBlock': {
            const p = entity as PromptBlock;
            return !p.textContent?.trim() && !(p.images?.length);
        }
    }
}

function formatDate(ts: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysAgo(ts: number): number {
    if (!ts) return Infinity;
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
    rawChatShells,
    onDeleteCharacter,
    onDeleteContext,
    onDeleteLocation,
    onDeleteAudioTrack,
    onDeleteWorld,
    onDeletePromptBlock,
    onDeleteChat,
}: DataManagerModalProps) {
    const [activeTab, setActiveTab] = useState<TabId>('storage');
    const [storageBreakdown, setStorageBreakdown] = useState<StorageBreakdown[]>([]);
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
    const [confirmDangerAction, setConfirmDangerAction] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const { addToast } = useToast();

    // ─── Storage Breakdown ──────────────────────────────────────────
    const computeStorage = useCallback(() => {
        const estimateKb = (items: unknown[], avgBytesPerItem: number) =>
            Math.round((items.length * avgBytesPerItem) / 1024);
        setStorageBreakdown([
            { label: 'Characters', icon: '🎭', count: allCharacters.length, estimatedSizeKb: estimateKb(allCharacters, 4096) },
            { label: 'Contexts', icon: '📜', count: allContexts.length, estimatedSizeKb: estimateKb(allContexts, 2048) },
            { label: 'Locations', icon: '📍', count: allLocations.length, estimatedSizeKb: estimateKb(allLocations, 2048) },
            { label: 'Audio Tracks', icon: '🔊', count: allAudioTracks.length, estimatedSizeKb: estimateKb(allAudioTracks, 512) },
            { label: 'Worlds', icon: '🌍', count: allWorlds.length, estimatedSizeKb: estimateKb(allWorlds, 1024) },
            { label: 'Prompt Blocks', icon: '🧱', count: allPromptBlocks.length, estimatedSizeKb: estimateKb(allPromptBlocks, 1536) },
            { label: 'Chat Sessions', icon: '💬', count: rawChatShells.length, estimatedSizeKb: estimateKb(rawChatShells, 8192) },
        ]);
    }, [allCharacters, allContexts, allLocations, allAudioTracks, allWorlds, allPromptBlocks, rawChatShells]);

    // ─── Cleanup Scan ───────────────────────────────────────────────
    const scanCleanup = useCallback(() => {
        setIsScanning(true);

        const referencedCharIds = new Set<string>();
        const referencedCtxIds = new Set<string>();
        const referencedLocIds = new Set<string>();
        const referencedAudioIds = new Set<string>();
        const referencedPbIds = new Set<string>();

        for (const world of allWorlds) {
            for (const id of world.characterIds) referencedCharIds.add(id);
            for (const id of world.contextIds) referencedCtxIds.add(id);
            for (const id of world.locationIds) referencedLocIds.add(id);
            for (const id of world.audioTrackIds) referencedAudioIds.add(id);
            for (const id of world.promptBlockIds) referencedPbIds.add(id);
        }
        for (const shell of rawChatShells) {
            for (const id of (shell.participantIds || [])) referencedCharIds.add(id);
            for (const id of (shell.contextIds || [])) referencedCtxIds.add(id);
            for (const id of (shell.locationIds || [])) referencedLocIds.add(id);
            for (const id of (shell.audioTrackIds || [])) referencedAudioIds.add(id);
        }

        const staleCutoff = Date.now() - staleDaysCleanup * 86400000;
        const found: CleanupItem[] = [];

        const checkEntity = (type: EntityType, id: string, name: string, lastUpdated: number, isReferenced: boolean, entity: Character | Context | Location | AudioTrack | PromptBlock) => {
            const isOrphan = !isReferenced;
            const isHollow = isEntityHollow(type, entity, nameIsMeaningful, descriptionIsMeaningful);
            const isStale = lastUpdated < staleCutoff;
            if (isOrphan || isHollow || isStale) {
                found.push({ type, id, name, lastUpdatedTimestamp: lastUpdated, isOrphan, isHollow, isStale });
            }
        };

        for (const c of allCharacters) checkEntity('character', c.id, c.name, c.lastUpdatedTimestamp, referencedCharIds.has(c.id), c);
        for (const c of allContexts) checkEntity('context', c.id, c.name, c.lastUpdatedTimestamp, referencedCtxIds.has(c.id), c);
        for (const l of allLocations) checkEntity('location', l.id, l.name, l.lastUpdatedTimestamp, referencedLocIds.has(l.id), l);
        for (const a of allAudioTracks) checkEntity('audioTrack', a.id, a.filename || a.name, a.lastUpdatedTimestamp, referencedAudioIds.has(a.id), a);
        for (const b of allPromptBlocks) checkEntity('promptBlock', b.id, b.name, b.lastUpdatedTimestamp, referencedPbIds.has(b.id), b);

        setCleanupItems(found);
        setSelectedIds(new Set());
        setSearchQuery('');
        setIsScanning(false);
    }, [allCharacters, allContexts, allLocations, allAudioTracks, allWorlds, allPromptBlocks, rawChatShells, nameIsMeaningful, descriptionIsMeaningful, staleDaysCleanup]);

    // ─── Integrity Check ────────────────────────────────────────────
    const scanIntegrity = useCallback(() => {
        setIsScanning(true);
        const issues: IntegrityIssue[] = [];
        const charIdSet = new Set(allCharacters.map(c => c.id));
        const ctxIdSet = new Set(allContexts.map(c => c.id));
        const locIdSet = new Set(allLocations.map(l => l.id));
        const audioIdSet = new Set(allAudioTracks.map(a => a.id));
        const pbIdSet = new Set(allPromptBlocks.map(b => b.id));

        for (const ctx of allContexts) {
            for (const charId of (ctx.characterBindings || [])) {
                if (!charIdSet.has(charId)) issues.push({ entityType: 'Context', entityName: ctx.name, issue: 'References missing character', refType: 'Character', refId: charId });
            }
        }
        for (const loc of allLocations) {
            for (const charId of (loc.characterBindings || [])) {
                if (!charIdSet.has(charId)) issues.push({ entityType: 'Location', entityName: loc.name, issue: 'References missing character binding', refType: 'Character', refId: charId });
            }
            for (const locId of (loc.locationBindings || [])) {
                if (!locIdSet.has(locId)) issues.push({ entityType: 'Location', entityName: loc.name, issue: 'References missing location binding', refType: 'Location', refId: locId });
            }
        }
        for (const at of allAudioTracks) {
            for (const locId of (at.locationBindings || [])) {
                if (!locIdSet.has(locId)) issues.push({ entityType: 'Audio Track', entityName: at.filename || at.name, issue: 'References missing location binding', refType: 'Location', refId: locId });
            }
            for (const ctxId of (at.contextBindings || [])) {
                if (!ctxIdSet.has(ctxId)) issues.push({ entityType: 'Audio Track', entityName: at.filename || at.name, issue: 'References missing context binding', refType: 'Context', refId: ctxId });
            }
            for (const charId of (at.characterBindings || [])) {
                if (!charIdSet.has(charId)) issues.push({ entityType: 'Audio Track', entityName: at.filename || at.name, issue: 'References missing character binding', refType: 'Character', refId: charId });
            }
        }
        for (const world of allWorlds) {
            for (const charId of world.characterIds) { if (!charIdSet.has(charId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing character', refType: 'Character', refId: charId }); }
            for (const ctxId of world.contextIds) { if (!ctxIdSet.has(ctxId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing context', refType: 'Context', refId: ctxId }); }
            for (const locId of world.locationIds) { if (!locIdSet.has(locId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing location', refType: 'Location', refId: locId }); }
            for (const audioId of world.audioTrackIds) { if (!audioIdSet.has(audioId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing audio track', refType: 'Audio Track', refId: audioId }); }
            for (const pbId of world.promptBlockIds) { if (!pbIdSet.has(pbId)) issues.push({ entityType: 'World', entityName: world.name, issue: 'References missing prompt block', refType: 'Prompt Block', refId: pbId }); }
        }
        for (const pb of allPromptBlocks) {
            for (const charId of pb.characterBindings) { if (!charIdSet.has(charId)) issues.push({ entityType: 'Prompt Block', entityName: pb.name, issue: 'References missing character binding', refType: 'Character', refId: charId }); }
            for (const ctxId of pb.contextBindings) { if (!ctxIdSet.has(ctxId)) issues.push({ entityType: 'Prompt Block', entityName: pb.name, issue: 'References missing context binding', refType: 'Context', refId: ctxId }); }
            for (const locId of pb.locationBindings) { if (!locIdSet.has(locId)) issues.push({ entityType: 'Prompt Block', entityName: pb.name, issue: 'References missing location binding', refType: 'Location', refId: locId }); }
        }

        setIntegrityIssues(issues);
        setIsScanning(false);
    }, [allCharacters, allContexts, allLocations, allAudioTracks, allWorlds, allPromptBlocks]);

    // ─── Effects ────────────────────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        computeStorage();
        setConfirmDangerAction(null);
        setSelectedIds(new Set());
        setSearchQuery('');
    }, [isOpen, computeStorage]);

    // ─── Filtered + sorted cleanup items ────────────────────────────
    const filteredAndSorted = useMemo(() => {
        const query = searchQuery.toLowerCase().trim();

        let filtered = cleanupItems.filter(item => {
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

    // ─── Sort handler ───────────────────────────────────────────────
    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
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
                case 'promptBlock': onDeletePromptBlock(item.id); break;
            }
            deletedCount++;
        }
        addToast(`Deleted ${deletedCount} entit${deletedCount === 1 ? 'y' : 'ies'}.`, 'success');
        setSelectedIds(new Set());
        scanCleanup();
    };

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const selectAllVisible = () => {
        const visibleIds = filteredAndSorted.map(i => i.id);
        const allSelected = visibleIds.every(id => selectedIds.has(id));
        if (allSelected) {
            setSelectedIds(prev => { const next = new Set(prev); for (const id of visibleIds) next.delete(id); return next; });
        } else {
            setSelectedIds(prev => { const next = new Set(prev); for (const id of visibleIds) next.add(id); return next; });
        }
    };

    // ─── Bulk operations ────────────────────────────────────────────
    const handleBulkDeleteStaleChats = () => {
        const cutoff = Date.now() - staleDaysThreshold * 86400000;
        let deletedCount = 0;
        for (const shell of rawChatShells) {
            if (!shell.id) continue;
            if ((shell.lastUpdatedTimestamp ?? 0) < cutoff) { onDeleteChat(shell.id); deletedCount++; }
        }
        addToast(`Deleted ${deletedCount} stale chat${deletedCount === 1 ? '' : 's'} (>${staleDaysThreshold} days old).`, 'success');
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
            case 'characters': count = allCharacters.length; for (const c of allCharacters) onDeleteCharacter(c.id); break;
            case 'contexts': count = allContexts.length; for (const c of allContexts) onDeleteContext(c.id); break;
            case 'locations': count = allLocations.length; for (const l of allLocations) onDeleteLocation(l.id); break;
            case 'audioTracks': count = allAudioTracks.length; for (const a of allAudioTracks) onDeleteAudioTrack(a.id); break;
            case 'worlds': count = allWorlds.length; for (const w of allWorlds) onDeleteWorld(w.id); break;
            case 'promptBlocks': count = allPromptBlocks.length; for (const b of allPromptBlocks) onDeletePromptBlock(b.id); break;
            case 'chats':
                for (const s of rawChatShells) { if (s.id) { onDeleteChat(s.id); count++; } }
                break;
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
                    <h2>🗄️ Data Manager</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Close</button>
                    </div>
                </div>

                {/* Tab Bar */}
                <div style={{ display: 'flex', gap: '4px', padding: '0 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                    {tabs.map(tab => (
                        <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); setConfirmDangerAction(null); }}
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
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '12px', lineHeight: 1.5 }}>
                                Find entities that are unreferenced (orphans), have no meaningful content (hollow), or haven't been updated recently (stale).
                            </div>

                            {/* Filter toggles */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                        <input type="checkbox" checked={showOrphans} onChange={e => setShowOrphans(e.target.checked)} className="editor-checkbox-input" />
                                        <span style={{ fontSize: '0.75rem' }}>Orphans</span>
                                    </label>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                        <input type="checkbox" checked={showHollows} onChange={e => setShowHollows(e.target.checked)} className="editor-checkbox-input" />
                                        <span style={{ fontSize: '0.75rem' }}>Hollows</span>
                                    </label>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                        <input type="checkbox" checked={showStale} onChange={e => setShowStale(e.target.checked)} className="editor-checkbox-input" />
                                        <span style={{ fontSize: '0.75rem' }}>Stale (&gt;</span>
                                    </label>
                                    <input type="number" min="1" max="365" value={staleDaysCleanup} onChange={e => setStaleDaysCleanup(Math.max(1, Math.min(365, Number(e.target.value) || 90)))} className="editor-input" style={{ width: '60px', textAlign: 'right', fontSize: '0.7rem', padding: '4px 6px' }} />
                                    <span style={{ fontSize: '0.75rem' }}>days)</span>
                                </div>
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '4px' }}>
                                    <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '6px' }}>Hollow detection treats these as meaningful data:</div>
                                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                                        <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                            <input type="checkbox" checked={nameIsMeaningful} onChange={e => setNameIsMeaningful(e.target.checked)} className="editor-checkbox-input" />
                                            <span style={{ fontSize: '0.7rem' }}>Name</span>
                                        </label>
                                        <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                            <input type="checkbox" checked={descriptionIsMeaningful} onChange={e => setDescriptionIsMeaningful(e.target.checked)} className="editor-checkbox-input" />
                                            <span style={{ fontSize: '0.7rem' }}>Description</span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            {/* Controls row */}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <button type="button" className="editor-button editor-button-save" onClick={scanCleanup} disabled={isScanning} style={{ fontSize: '0.75rem', padding: '8px 16px' }}>
                                    {isScanning ? 'Scanning...' : 'Scan'}
                                </button>
                                {cleanupItems.length > 0 && (
                                    <>
                                        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search..." className="editor-input" style={{ flex: 1, minWidth: '120px', fontSize: '0.75rem', padding: '8px 12px' }} />
                                        <button type="button" className="editor-button editor-button-cancel" onClick={selectAllVisible} style={{ fontSize: '0.75rem', padding: '8px 16px' }}>
                                            {filteredAndSorted.length > 0 && filteredAndSorted.every(o => selectedIds.has(o.id)) ? 'Deselect Visible' : 'Select Visible'}
                                        </button>
                                        <button type="button" className="editor-button" onClick={handleDeleteSelected} disabled={selectedIds.size === 0}
                                            style={{ fontSize: '0.75rem', padding: '8px 16px', background: selectedIds.size > 0 ? '#ef4444' : undefined, color: selectedIds.size > 0 ? '#fff' : undefined, borderColor: selectedIds.size > 0 ? '#ef4444' : undefined }}>
                                            Delete Selected ({selectedIds.size})
                                        </button>
                                    </>
                                )}
                            </div>

                            {/* Empty states */}
                            {cleanupItems.length === 0 && !isScanning && (
                                <div style={{ textAlign: 'center', padding: '30px', opacity: 0.5, fontSize: '0.8rem' }}>No issues found. Click "Scan" to check.</div>
                            )}
                            {cleanupItems.length > 0 && filteredAndSorted.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '20px', opacity: 0.5, fontSize: '0.8rem' }}>
                                    {searchQuery ? `No results match "${searchQuery}"` : 'No items match current filters.'}
                                </div>
                            )}

                            {/* Sortable table */}
                            {filteredAndSorted.length > 0 && (
                                <div style={{ overflowX: 'auto', maxHeight: '450px', border: '1px solid var(--border)', borderRadius: '8px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '500px' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ ...thStyle, width: '36px', textAlign: 'center', cursor: 'default' }}>
                                                    <input type="checkbox" readOnly checked={filteredAndSorted.length > 0 && filteredAndSorted.every(o => selectedIds.has(o.id))} style={{ accentColor: 'var(--accent)' }} />
                                                </th>
                                                <th style={thStyle} onClick={() => handleSort('name')}>Name {sortIndicator('name')}</th>
                                                <th style={thStyle} onClick={() => handleSort('type')}>Type {sortIndicator('type')}</th>
                                                <th style={thStyle} onClick={() => handleSort('lastUpdated')}>Last Updated {sortIndicator('lastUpdated')}</th>
                                                <th style={thStyle} onClick={() => handleSort('flags')}>Flags {sortIndicator('flags')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredAndSorted.map(item => (
                                                <tr key={`${item.type}-${item.id}`} onClick={() => toggleSelection(item.id)}
                                                    style={{ cursor: 'pointer', background: selectedIds.has(item.id) ? 'var(--accent-bg)' : 'transparent', transition: 'background 0.15s' }}>
                                                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                                                        <input type="checkbox" checked={selectedIds.has(item.id)} readOnly style={{ accentColor: 'var(--accent)', width: '14px', height: '14px' }} />
                                                    </td>
                                                    <td style={{ ...tdStyle, fontWeight: 'bold', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</td>
                                                    <td style={tdStyle}>
                                                        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>{ENTITY_TYPE_META[item.type].icon} {ENTITY_TYPE_META[item.type].label.slice(0, -1)}</span>
                                                    </td>
                                                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                                                        {formatDate(item.lastUpdatedTimestamp)}
                                                        <span style={{ opacity: 0.4, marginLeft: '4px' }}>({daysAgo(item.lastUpdatedTimestamp)}d)</span>
                                                    </td>
                                                    <td style={tdStyle}>
                                                        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                                                            {item.isOrphan && <span style={{ fontSize: '0.55rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 'bold' }}>ORPHAN</span>}
                                                            {item.isHollow && <span style={{ fontSize: '0.55rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(234,179,8,0.15)', color: '#ca8a04', fontWeight: 'bold' }}>HOLLOW</span>}
                                                            {item.isStale && <span style={{ fontSize: '0.55rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(99,102,241,0.15)', color: '#6366f1', fontWeight: 'bold' }}>STALE</span>}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {filteredAndSorted.length > 0 && (
                                <div style={{ fontSize: '0.65rem', opacity: 0.5, marginTop: '6px', textAlign: 'right' }}>
                                    Showing {filteredAndSorted.length} of {cleanupItems.length} flagged entities
                                </div>
                            )}
                        </div>
                    )}

                    {/* ─── INTEGRITY TAB ─── */}
                    {activeTab === 'integrity' && (
                        <div>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '12px', lineHeight: 1.5 }}>Cross-reference integrity check. Finds broken bindings where entities reference deleted characters, contexts, locations, audio tracks, worlds, or prompt blocks.</div>
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
                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Webpage Cache</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Cached web pages fetched via context URLs and search terms.</div>
                                <button type="button" className="editor-button editor-button-cancel" onClick={handleClearWebpageCache} style={{ fontSize: '0.75rem', width: '100%' }}>🧹 Clear Webpage Cache</button>
                            </div>
                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Image Cache</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Cached character, context, location, and prompt block images.</div>
                                <button type="button" className="editor-button editor-button-cancel" onClick={handleClearImageCache} style={{ fontSize: '0.75rem', width: '100%' }}>🧹 Clear Image Cache</button>
                            </div>
                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Token Cache</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>In-memory token counting cache used by the language model engine.</div>
                                <button type="button" className="editor-button editor-button-cancel" onClick={handleClearTokenCache} style={{ fontSize: '0.75rem', width: '100%' }}>🧹 Clear Token Cache</button>
                            </div>
                        </div>
                    )}

                    {/* ─── BULK OPS TAB ─── */}
                    {activeTab === 'bulk' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, lineHeight: 1.5 }}>Bulk operations for managing large datasets. These actions are irreversible.</div>
                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Stale Chat Cleanup</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: '8px' }}>Delete chat sessions that haven't been updated in more than N days.</div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                                    <label style={{ fontSize: '0.75rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>Older than:</label>
                                    <input type="number" min="1" max="365" value={staleDaysThreshold} onChange={e => setStaleDaysThreshold(Math.max(1, Math.min(365, Number(e.target.value) || 30)))} className="editor-input" style={{ width: '80px', textAlign: 'right' }} />
                                    <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>days</span>
                                </div>
                                <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '8px' }}>{rawChatShells.filter(s => (s.lastUpdatedTimestamp ?? 0) < Date.now() - staleDaysThreshold * 86400000).length} chat(s) match this criteria.</div>
                                <button type="button" className="editor-button" onClick={handleBulkDeleteStaleChats} style={{ fontSize: '0.75rem', width: '100%', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>🗑️ Delete Stale Chats</button>
                            </div>
                        </div>
                    )}

                    {/* ─── DANGER ZONE TAB ─── */}
                    {activeTab === 'danger' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', fontSize: '0.75rem', color: '#ef4444', lineHeight: 1.5 }}>
                                ⚠️ These operations are <strong>irreversible</strong>. Data cannot be recovered after deletion. Export your data first.
                            </div>
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
                                <button type="button" className="editor-button"
                                    onClick={() => confirmDangerAction === 'factory-reset' ? handleFactoryReset() : setConfirmDangerAction('factory-reset')}
                                    style={{ fontSize: '0.75rem', width: '100%', color: confirmDangerAction === 'factory-reset' ? '#fff' : '#ef4444', background: confirmDangerAction === 'factory-reset' ? '#ef4444' : 'transparent', borderColor: '#ef4444' }}>
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