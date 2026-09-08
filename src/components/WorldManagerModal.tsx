import { useState, useMemo } from 'react';
import type { World, Character, Context, Location, Profile } from '../types';
import { useWorldManager } from '../hooks/useWorldManager';
import { EntitySelectList } from './EntitySelectList';
import './main.css';

interface WorldManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allProfiles: Profile[];
    currentCharacterIds: string[];
    currentContextIds: string[];
    currentLocationIds: string[];
    currentProfileId?: string;
    onLoadWorld: (world: World) => void;
}

export function WorldManagerModal({
    isOpen, onClose, allCharacters, allContexts, allLocations, allProfiles,
    currentCharacterIds, currentContextIds, currentLocationIds, currentProfileId,
    onLoadWorld,
}: WorldManagerModalProps) {
    const { worlds, isLoading, saveWorld, deleteWorld, createWorld, snapshotFromChat } = useWorldManager();

    const [editingWorld, setEditingWorld] = useState<World | null>(null);
    const [newWorldName, setNewWorldName] = useState('');
    const [snapshotName, setSnapshotName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    const [editCharIds, setEditCharIds] = useState<string[]>([]);
    const [editCtxIds, setEditCtxIds] = useState<string[]>([]);
    const [editLocIds, setEditLocIds] = useState<string[]>([]);
    const [editProfileId, setEditProfileId] = useState('');
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [charSearch, setCharSearch] = useState('');
    const [ctxSearch, setCtxSearch] = useState('');
    const [locSearch, setLocSearch] = useState('');

    const filteredWorlds = useMemo(() => {
        if (!searchQuery.trim()) return worlds;
        const q = searchQuery.toLowerCase();
        return worlds.filter(w => w.name.toLowerCase().includes(q) || (w.description || '').toLowerCase().includes(q));
    }, [worlds, searchQuery]);

    if (!isOpen) return null;

    const openEditor = (world: World) => {
        setEditingWorld(world);
        setEditCharIds([...world.characterIds]);
        setEditCtxIds([...world.contextIds]);
        setEditLocIds([...world.locationIds]);
        setEditProfileId(world.profileId || '');
        setEditName(world.name);
        setEditDescription(world.description || '');
        setCharSearch(''); setCtxSearch(''); setLocSearch('');
    };

    const handleSaveEdit = async () => {
        if (!editingWorld) return;
        await saveWorld({
            ...editingWorld,
            name: editName.trim() || editingWorld.name,
            description: editDescription.trim() || undefined,
            characterIds: editCharIds, contextIds: editCtxIds,
            locationIds: editLocIds, profileId: editProfileId || undefined,
            lastUpdatedTimestamp: Date.now(),
        });
        setEditingWorld(null);
    };

    const handleCreate = async () => {
        if (!newWorldName.trim()) return;
        await createWorld(newWorldName.trim());
        setNewWorldName('');
    };

    const handleSnapshot = async () => {
        if (!snapshotName.trim()) return;
        await snapshotFromChat(snapshotName.trim(), currentCharacterIds, currentContextIds, currentLocationIds, currentProfileId);
        setSnapshotName('');
    };

    const toggleInList = (ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    // Editor view
    if (editingWorld) {
        return (
            <div className="modal-overlay" onClick={() => setEditingWorld(null)}>
                <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>Edit World</h2>
                        <div className="editor-modal-actions">
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={() => setEditingWorld(null)}>Cancel</button>
                            <button type="button" className="editor-btn editor-btn-save" onClick={handleSaveEdit}>Save</button>
                        </div>
                    </div>
                    <div className="modal-body editor-modal-body">
                        <div className="editor-section">
                            <span className="editor-section-title">World Info</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div><label className="editor-label">Name</label><input type="text" className="editor-input" value={editName} onChange={e => setEditName(e.target.value)} /></div>
                                <div><label className="editor-label">Description</label><textarea className="editor-textarea" rows={2} value={editDescription} onChange={e => setEditDescription(e.target.value)} placeholder="Optional..." /></div>
                            </div>
                        </div>
                        <div className="editor-section">
                            <span className="editor-section-title">Characters ({editCharIds.length})</span>
                            <EntitySelectList label="Characters" items={allCharacters} selectedIds={editCharIds} onToggle={id => toggleInList(editCharIds, setEditCharIds, id)} searchQuery={charSearch} onSearchChange={setCharSearch} />
                        </div>
                        <div className="editor-section">
                            <span className="editor-section-title">Contexts ({editCtxIds.length})</span>
                            <EntitySelectList label="Contexts" items={allContexts} selectedIds={editCtxIds} onToggle={id => toggleInList(editCtxIds, setEditCtxIds, id)} searchQuery={ctxSearch} onSearchChange={setCtxSearch} />
                        </div>
                        <div className="editor-section">
                            <span className="editor-section-title">Locations ({editLocIds.length})</span>
                            <EntitySelectList label="Locations" items={allLocations} selectedIds={editLocIds} onToggle={id => toggleInList(editLocIds, setEditLocIds, id)} searchQuery={locSearch} onSearchChange={setLocSearch} />
                        </div>
                        <div className="editor-section">
                            <span className="editor-section-title">Profile</span>
                            <select className="editor-select" value={editProfileId} onChange={e => setEditProfileId(e.target.value)}>
                                <option value="">No Profile</option>
                                {allProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // List view
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-content-manager" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Worlds</h2>
                    <div className="modal-header-actions"><button type="button" className="close-btn close-btn-spaced" onClick={onClose}>×</button></div>
                </div>
                <div className="modal-search-container">
                    <input type="text" className="modal-search-input" placeholder="Search worlds..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
                <div className="modal-body">
                    <div className="budget-section" style={{ marginBottom: '12px' }}>
                        <span className="budget-section-title">Create New World</span>
                        <div className="budget-control-row">
                            <div className="budget-control-field">
                                <input type="text" className="budget-control-input" placeholder="World name..." value={newWorldName} onChange={e => setNewWorldName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }} />
                            </div>
                            <button type="button" className="budget-btn budget-btn-primary budget-btn-action" disabled={!newWorldName.trim()} onClick={handleCreate}>Create</button>
                        </div>
                    </div>
                    {(currentCharacterIds.length > 0 || currentContextIds.length > 0 || currentLocationIds.length > 0) && (
                        <div className="budget-section" style={{ marginBottom: '12px' }}>
                            <span className="budget-section-title">Snapshot Current Chat</span>
                            <div className="budget-hint" style={{ marginBottom: '6px' }}>
                                Save {currentCharacterIds.length} chars, {currentContextIds.length} ctx, {currentLocationIds.length} loc{currentProfileId ? ', profile' : ''}.
                            </div>
                            <div className="budget-control-row">
                                <div className="budget-control-field">
                                    <input type="text" className="budget-control-input" placeholder="Snapshot name..." value={snapshotName} onChange={e => setSnapshotName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSnapshot(); }} />
                                </div>
                                <button type="button" className="budget-btn budget-btn-primary budget-btn-action" disabled={!snapshotName.trim()} onClick={handleSnapshot}>Snapshot</button>
                            </div>
                        </div>
                    )}
                    {isLoading ? <div className="empty-state">Loading worlds...</div>
                    : filteredWorlds.length === 0 ? <div className="empty-state">{searchQuery ? 'No matches.' : 'No worlds yet.'}</div>
                    : (
                        <ul className="manager-list">
                            {filteredWorlds.map(world => (
                                <li key={world.id} className="manager-item">
                                    <div className="manager-item-main manager-item-main-clickable" onClick={() => { onLoadWorld(world); onClose(); }}>
                                        <div className="manager-item-info">
                                            <div className="manager-item-title">🌍 {world.name}</div>
                                            <div className="manager-item-sub">
                                                {world.characterIds.length} char • {world.contextIds.length} ctx • {world.locationIds.length} loc{world.profileId ? ' • 📋' : ''}
                                                {world.description ? ` — ${world.description}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="manager-item-actions">
                                        <button type="button" className="order-toggle-btn" onClick={e => { e.stopPropagation(); openEditor(world); }} title="Edit">✎</button>
                                        <button type="button" className="delete-item-btn" onClick={e => { e.stopPropagation(); deleteWorld(world.id); }} title="Delete">🗑</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}