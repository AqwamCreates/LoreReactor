// src/components/WorldEditorModal.tsx
import { useState, useEffect } from 'react';
import type { World, Character, Context, Location, Profile, AudioTrack } from '../types';
import { EntitySelectList } from './EntitySelectList';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

interface WorldEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (world: World) => void;
    onLoadWorld?: (world: World) => void;
    existingWorld: World | null;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allProfiles: Profile[];
    allAudioTracks: AudioTrack[];
    currentCharacterIds: string[];
    currentContextIds: string[];
    currentLocationIds: string[];
    currentProfileId?: string;
    currentAudioTrackIds?: string[];
}

export function WorldEditorModal({
    isOpen, onClose, onSave, onLoadWorld, existingWorld,
    allCharacters, allContexts, allLocations, allProfiles, allAudioTracks,
    currentCharacterIds, currentContextIds, currentLocationIds, currentProfileId, currentAudioTrackIds,
}: WorldEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [charIds, setCharIds] = useState<string[]>([]);
    const [ctxIds, setCtxIds] = useState<string[]>([]);
    const [locIds, setLocIds] = useState<string[]>([]);
    const [audioTrackIds, setAudioTrackIds] = useState<string[]>([]);
    const [profileId, setProfileId] = useState('');
    const [charSearch, setCharSearch] = useState('');
    const [ctxSearch, setCtxSearch] = useState('');
    const [locSearch, setLocSearch] = useState('');
    const [audioSearch, setAudioSearch] = useState('');
    const [isCloned, setIsCloned] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setIsCloned(false);
        if (existingWorld) {
            setName(existingWorld.name);
            setDescription(existingWorld.description || '');
            setCharIds([...existingWorld.characterIds]);
            setCtxIds([...existingWorld.contextIds]);
            setLocIds([...existingWorld.locationIds]);
            setAudioTrackIds([...(existingWorld.audioTrackIds || [])]);
            setProfileId(existingWorld.profileId || '');
        } else {
            setName('');
            setDescription('');
            setCharIds([]);
            setCtxIds([]);
            setLocIds([]);
            setAudioTrackIds([]);
            setProfileId('');
        }
        setCharSearch('');
        setCtxSearch('');
        setLocSearch('');
        setAudioSearch('');
    }, [isOpen, existingWorld]);

    if (!isOpen) return null;

    const toggleInList = (_ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const buildWorld = (): World | null => {
        if (!name.trim()) return null;
        const now = Date.now();
        return {
            id: (existingWorld && !isCloned) ? existingWorld.id : uuidv4(),
            name: isCloned ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            characterIds: charIds,
            contextIds: ctxIds,
            locationIds: locIds,
            audioTrackIds: audioTrackIds.length > 0 ? audioTrackIds : undefined,
            profileId: profileId || undefined,
            firstCreatedTimestamp: (existingWorld && !isCloned) ? existingWorld.firstCreatedTimestamp : now,
            lastUpdatedTimestamp: now,
        };
    };

    const handleSave = () => {
        const world = buildWorld();
        if (!world) return;
        onSave(world);
        onClose();
    };

    const handleClone = () => {
        setIsCloned(true);
    };

    const handleLoad = () => {
        if (!existingWorld || !onLoadWorld) return;
        const now = Date.now();
        const world: World = {
            ...existingWorld,
            name: name.trim(),
            description: description.trim() || undefined,
            characterIds: charIds,
            contextIds: ctxIds,
            locationIds: locIds,
            audioTrackIds: audioTrackIds.length > 0 ? audioTrackIds : undefined,
            profileId: profileId || undefined,
            lastUpdatedTimestamp: now,
        };
        onLoadWorld(world);
        onClose();
    };

    const copyCharsFromChat = () => setCharIds([...currentCharacterIds]);
    const copyCtxsFromChat = () => setCtxIds([...currentContextIds]);
    const copyLocsFromChat = () => setLocIds([...currentLocationIds]);
    const copyProfileFromChat = () => setProfileId(currentProfileId || '');
    const copyAudioFromChat = () => setAudioTrackIds([...(currentAudioTrackIds || [])]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingWorld ? (isCloned ? 'Clone World' : 'Edit World') : 'Create New World'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Cancel</button>
                        {existingWorld && !isCloned && (
                            <>
                                {onLoadWorld && (
                                    <button type="button" className="editor-btn editor-btn-cancel" onClick={handleLoad} style={{ borderColor: 'var(--accent)' }}>Load</button>
                                )}
                                <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone}>Clone</button>
                            </>
                        )}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSave} disabled={!name.trim()}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Name & Description */}
                    <div className="editor-section">
                        <span className="editor-section-title">World Info</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div>
                                <label className="editor-label">Name <span className="context-required-asterisk">*</span></label>
                                <input type="text" className={`editor-input ${!name.trim() ? 'error' : ''}`} value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Eldoria Campaign" />
                            </div>
                            <div>
                                <label className="editor-label">Description</label>
                                <textarea className="editor-textarea" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description..." />
                            </div>
                        </div>
                    </div>

                    {/* Characters */}
                    <div className="editor-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span className="editor-section-title" style={{ margin: 0 }}>Characters ({charIds.length})</span>
                            {currentCharacterIds.length > 0 && (
                                <button type="button" className="budget-btn budget-btn-active" style={{ fontSize: '0.6rem', padding: '3px 8px', minHeight: '24px' }} onClick={copyCharsFromChat}>
                                    Copy From Chat
                                </button>
                            )}
                        </div>
                        <EntitySelectList label="Characters" items={allCharacters} selectedIds={charIds}
                            onToggle={id => toggleInList(charIds, setCharIds, id)}
                            searchQuery={charSearch} onSearchChange={setCharSearch} />
                    </div>

                    {/* Contexts */}
                    <div className="editor-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span className="editor-section-title" style={{ margin: 0 }}>Contexts ({ctxIds.length})</span>
                            {currentContextIds.length > 0 && (
                                <button type="button" className="budget-btn budget-btn-active" style={{ fontSize: '0.6rem', padding: '3px 8px', minHeight: '24px' }} onClick={copyCtxsFromChat}>
                                    Copy From Chat
                                </button>
                            )}
                        </div>
                        <EntitySelectList label="Contexts" items={allContexts} selectedIds={ctxIds}
                            onToggle={id => toggleInList(ctxIds, setCtxIds, id)}
                            searchQuery={ctxSearch} onSearchChange={setCtxSearch} />
                    </div>

                    {/* Locations */}
                    <div className="editor-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span className="editor-section-title" style={{ margin: 0 }}>Locations ({locIds.length})</span>
                            {currentLocationIds.length > 0 && (
                                <button type="button" className="budget-btn budget-btn-active" style={{ fontSize: '0.6rem', padding: '3px 8px', minHeight: '24px' }} onClick={copyLocsFromChat}>
                                    Copy From Chat
                                </button>
                            )}
                        </div>
                        <EntitySelectList label="Locations" items={allLocations} selectedIds={locIds}
                            onToggle={id => toggleInList(locIds, setLocIds, id)}
                            searchQuery={locSearch} onSearchChange={setLocSearch} />
                    </div>

                    {/* Audio Tracks */}
                    <div className="editor-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span className="editor-section-title" style={{ margin: 0 }}>Audio Tracks ({audioTrackIds.length})</span>
                            {(currentAudioTrackIds?.length ?? 0) > 0 && (
                                <button type="button" className="budget-btn budget-btn-active" style={{ fontSize: '0.6rem', padding: '3px 8px', minHeight: '24px' }} onClick={copyAudioFromChat}>
                                    Copy From Chat
                                </button>
                            )}
                        </div>
                        <EntitySelectList label="Audio Tracks" items={allAudioTracks} selectedIds={audioTrackIds}
                            onToggle={id => toggleInList(audioTrackIds, setAudioTrackIds, id)}
                            searchQuery={audioSearch} onSearchChange={setAudioSearch} />
                    </div>

                    {/* Profile */}
                    <div className="editor-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span className="editor-section-title" style={{ margin: 0 }}>Profile</span>
                            {currentProfileId && (
                                <button type="button" className="budget-btn budget-btn-active" style={{ fontSize: '0.6rem', padding: '3px 8px', minHeight: '24px' }} onClick={copyProfileFromChat}>
                                    Copy from Chat
                                </button>
                            )}
                        </div>
                        <select className="editor-select" value={profileId} onChange={e => setProfileId(e.target.value)}>
                            <option value="">No Profile</option>
                            {allProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                </div>
            </div>
        </div>
    );
}