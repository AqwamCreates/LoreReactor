// src/components/AudioTrackEditorModal.tsx
import { useState, useEffect, useRef } from 'react';
import type { AudioTrack, Character, Context, Location, audioCategory, RegularExpressionTrigger } from '../types';
import { uploadAudioTrack, getAudioTrackUrl } from '../storage/serverStorage';
import { v4 as uuidv4 } from 'uuid';
import { RegularExpressionTriggerEditor } from './RegularExpressionTriggerEditor';
import '../main.css';

interface AudioTrackEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (track: AudioTrack) => void;
    existingTrack?: AudioTrack | null;
    allCharacters?: Character[];
    allContexts?: Context[];
    allLocations?: Location[];
}

const AUDIO_CATEGORIES: { value: audioCategory; label: string; icon: string }[] = [
    { value: 'ambient', label: 'Ambient', icon: '🌿' },
    { value: 'music', label: 'Music', icon: '🎵' },
    { value: 'sound effect', label: 'Sound Effect', icon: '💥' },
];

type AudioTabId = 'general' | 'detection' | 'bindings';

export function AudioTrackEditorModal({
    isOpen,
    onClose,
    onSave,
    existingTrack,
    allCharacters = [],
    allContexts = [],
    allLocations = [],
}: AudioTrackEditorModalProps) {
    if (!isOpen) return null;

    const modalKey = `at-${existingTrack?.id ?? 'new'}`;

    return (
        <AudioTrackEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingTrack={existingTrack}
            allCharacters={allCharacters}
            allContexts={allContexts}
            allLocations={allLocations}
        />
    );
}

function AudioTrackEditorModalInner({
    onClose,
    onSave,
    existingTrack,
    allCharacters = [],
    allContexts = [],
    allLocations = [],
}: Omit<AudioTrackEditorModalProps, 'isOpen'>) {
    const [activeTab, setActiveTab] = useState<AudioTabId>('general');

    const [name, setName] = useState(existingTrack?.name || '');
    const [description, setDescription] = useState(existingTrack?.description || '');
    const [filename, setFilename] = useState(existingTrack?.filename || '');
    const [loop, setLoop] = useState(existingTrack?.loop ?? true);
    const [volume, setVolume] = useState(existingTrack?.volume ?? 1);
    const [startFadeDurationMs, setStartFadeDurationMs] = useState(existingTrack?.startFadeDurationMs ?? 1000);
    const [endFadeDurationMs, setEndFadeDurationMs] = useState(existingTrack?.endFadeDurationMs ?? 1000);
    const [audioCategory, setAudioCategory] = useState<audioCategory>(existingTrack?.audioCategory ?? 'ambient');
    const [priority, setPriority] = useState(existingTrack?.priority ?? 0);
    const [playableByParticipants, setPlayableByParticipant] = useState(existingTrack?.playableByParticipants ?? false);

    const [regexActivationTriggers, setRegexActivationTriggers] = useState<RegularExpressionTrigger[]>(existingTrack?.regularExpressionActivationTriggers ?? []);
    const [regexDeactivationTriggers, setRegexDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingTrack?.regularExpressionDeactivationTriggers ?? []);
    const [regexExclusionActivationTriggers, setRegexExclusionActivationTriggers] = useState<RegularExpressionTrigger[]>(existingTrack?.regularExpressionExclusionActivationTriggers ?? []);
    const [regexExclusionDeactivationTriggers, setRegexExclusionDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingTrack?.regularExpressionExclusionDeactivationTriggers ?? []);

    const [locationBindings, setLocationBindings] = useState<string[]>(existingTrack?.locationBindings ?? []);
    const [contextBindings, setContextBindings] = useState<string[]>(existingTrack?.contextBindings ?? []);
    const [characterBindings, setCharacterBindings] = useState<string[]>(existingTrack?.characterBindings ?? []);

    const [errors, setErrors] = useState<Record<string, string | undefined>>({});
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    // FIXED: Pass both track ID and filename to getAudioTrackUrl
    const [previewUrl, setPreviewUrl] = useState<string | null>(() => {
        if (existingTrack?.id && existingTrack?.filename) {
            return getAudioTrackUrl(existingTrack.id, existingTrack.filename);
        }
        return null;
    });
    const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        return () => {
            if (previewAudioRef.current) {
                previewAudioRef.current.pause();
                previewAudioRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (previewAudioRef.current && isPreviewPlaying) {
            previewAudioRef.current.volume = volume;
            previewAudioRef.current.loop = loop;
        }
    }, [volume, loop, isPreviewPlaying]);

    const validate = (): boolean => {
        const newErrors: Record<string, string | undefined> = {};
        if (!name.trim()) newErrors.name = 'Name is required.';
        if (!filename.trim()) newErrors.filename = 'Filename is required.';

        let valid = true;
        const validateTriggers = (trs: RegularExpressionTrigger[], key: string) => {
            for (let i = 0; i < trs.length; i++) {
                if (trs[i].trigger.trim()) {
                    try { new RegExp(trs[i].trigger); } catch {
                        newErrors[key] = `Invalid regex in trigger #${i + 1}.`;
                        valid = false;
                        break;
                    }
                }
            }
        };
        validateTriggers(regexActivationTriggers, 'regex');
        validateTriggers(regexDeactivationTriggers, 'deactivationRegex');
        validateTriggers(regexExclusionActivationTriggers, 'exclusionActivationRegex');
        validateTriggers(regexExclusionDeactivationTriggers, 'exclusionDeactivationRegex');

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0 && valid;
    };

    const handleTogglePreview = () => {
        if (!previewUrl) return;

        if (isPreviewPlaying && previewAudioRef.current) {
            previewAudioRef.current.pause();
            previewAudioRef.current.currentTime = 0;
            setIsPreviewPlaying(false);
            return;
        }

        if (!previewAudioRef.current) {
            previewAudioRef.current = new Audio(previewUrl);
            previewAudioRef.current.volume = volume;
            previewAudioRef.current.loop = loop;
            previewAudioRef.current.onended = () => setIsPreviewPlaying(false);
            previewAudioRef.current.onerror = () => setIsPreviewPlaying(false);
        } else {
            previewAudioRef.current.src = previewUrl;
            previewAudioRef.current.volume = volume;
            previewAudioRef.current.loop = loop;
        }

        previewAudioRef.current.play().then(() => setIsPreviewPlaying(true)).catch(() => setIsPreviewPlaying(false));
    };

    const buildTrackFromForm = async (isNewClone: boolean): Promise<AudioTrack | null> => {
        if (!validate()) return null;

        // FIXED: Determine ID upfront so upload has a valid path
        const trackId = isNewClone ? uuidv4() : (existingTrack?.id || uuidv4());

        let finalFilename = filename.trim();

        if (audioFile) {
            setIsUploading(true);
            try {
                // FIXED: Pass trackId as first argument to uploadAudioTrack
                finalFilename = await uploadAudioTrack(trackId, audioFile);
            } catch (error) {
                console.error('Failed to upload audio file:', error);
                setErrors(prev => ({ ...prev, filename: 'Upload failed.' }));
                setIsUploading(false);
                return null;
            }
            setIsUploading(false);
            setAudioFile(null);
        }

        if (!finalFilename) {
            setErrors(prev => ({ ...prev, filename: 'Filename is required.' }));
            return null;
        }

        const now = Date.now();

        const filterTriggers = (trs: RegularExpressionTrigger[]) => {
            const filtered = trs.filter(t => t.trigger.trim());
            return filtered.length > 0 ? filtered : undefined;
        };

        return {
            id: trackId,
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            filename: finalFilename,
            loop,
            volume,
            startFadeDurationMs,
            endFadeDurationMs,
            audioCategory,
            priority,
            playableByParticipants,
            regularExpressionActivationTriggers: filterTriggers(regexActivationTriggers),
            regularExpressionDeactivationTriggers: filterTriggers(regexDeactivationTriggers),
            regularExpressionExclusionActivationTriggers: filterTriggers(regexExclusionActivationTriggers),
            regularExpressionExclusionDeactivationTriggers: filterTriggers(regexExclusionDeactivationTriggers),
            locationBindings: locationBindings.length > 0 ? locationBindings : [],
            contextBindings: contextBindings.length > 0 ? contextBindings : [],
            characterBindings: characterBindings.length > 0 ? characterBindings : [],
            firstCreatedTimestamp: isNewClone ? now : (existingTrack?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => { const track = await buildTrackFromForm(false); if (!track) return; onSave(track); onClose(); };
    const handleClone = async () => { const cloned = await buildTrackFromForm(true); if (!cloned) return; onSave(cloned); onClose(); };

    const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);
    const getContextById = (id: string) => allContexts.find(c => c.id === id);
    const getLocationById = (id: string) => allLocations.find(l => l.id === id);

    const audioTabs: { id: AudioTabId; label: string; icon: string }[] = [
        { id: 'general', label: 'General', icon: '🎵' },
        { id: 'detection', label: 'Detection', icon: '🔍' },
        { id: 'bindings', label: 'Bindings', icon: '🔗' },
    ];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingTrack ? 'Edit Audio Track' : 'Create New Audio Track'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {existingTrack && <button type="button" className="editor-button editor-button-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Saving...' : 'Save'}</button>
                    </div>
                </div>

                {/* Tab Bar */}
                <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                    {audioTabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                <div className="modal-body editor-modal-body">
                    {/* ─── GENERAL TAB ─── */}
                    {activeTab === 'general' && (
                        <>
                            <div className="context-field-group">
                                <label className="editor-label">Name <span className="context-required-asterisk">*</span></label>
                                <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} className={`editor-input ${errors.name ? 'error' : ''}`} placeholder="e.g., Forest Ambience" />
                                {errors.name && <div className="editor-error-message">{errors.name}</div>}
                            </div>

                            <div className="context-field-group">
                                <label className="editor-label">Description</label>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea" placeholder="Brief description of this audio track" rows={2} />
                            </div>

                            <div className="context-field-group">
                                <label className="editor-label">Audio File <span className="context-required-asterisk">*</span></label>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input type="text" value={filename} onChange={(e) => { setFilename(e.target.value); if (errors.filename) setErrors({ ...errors, filename: undefined }); }} className={`editor-input context-mono-input ${errors.filename ? 'error' : ''}`} placeholder="forest_birds.ogg" style={{ flex: 1 }} />
                                    <button type="button" className="editor-button editor-button-cancel" onClick={() => audioInputRef.current?.click()} disabled={isUploading} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px', whiteSpace: 'nowrap' }}>
                                        {isUploading ? '⏳' : '📁 Upload'}
                                    </button>
                                </div>
                                <input ref={audioInputRef} type="file" accept=".ogg,.mp3,.wav,.flac,audio/*" hidden onChange={(e) => {
                                    if (e.target.files?.[0]) {
                                        const file = e.target.files[0];
                                        setAudioFile(file);
                                        setFilename(file.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
                                        if (errors.filename) setErrors({ ...errors, filename: undefined });
                                        setPreviewUrl(URL.createObjectURL(file));
                                    }
                                    e.target.value = '';
                                }} disabled={isUploading} />
                                {errors.filename && <div className="editor-error-message">{errors.filename}</div>}
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Supports .ogg, .mp3, .wav, .flac. Upload stores the file; or type an existing filename manually.
                                </div>
                            </div>

                            {previewUrl && (
                                <div className="context-field-group">
                                    <label className="editor-label editor-label-small">Preview</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <button type="button" onClick={handleTogglePreview} className={`editor-button ${isPreviewPlaying ? 'editor-button-save' : 'editor-button-cancel'}`} style={{ fontSize: '0.75rem', padding: '4px 14px', minHeight: '28px' }}>
                                            {isPreviewPlaying ? '⏹' : '▶'}
                                        </button>
                                        <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>
                                            {isPreviewPlaying ? 'Playing...' : 'Click to preview at current volume & loop settings'}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Category & Priority */}
                            <div className="editor-section">
                                <span className="editor-section-title">Category & Priority</span>
                                <div className="context-field-group">
                                    <label className="editor-label editor-label-small">Category</label>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                        {AUDIO_CATEGORIES.map(cat => (
                                            <button key={cat.value} type="button" onClick={() => setAudioCategory(cat.value)} className={`editor-button ${audioCategory === cat.value ? 'editor-button-save' : 'editor-button-cancel'}`} style={{ fontSize: '0.75rem', padding: '4px 12px', minHeight: '28px' }}>
                                                {cat.icon} {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="context-field-group">
                                    <label className="editor-label editor-label-small">Priority</label>
                                    <input type="number" step="1" min="0" value={priority} onChange={(e) => setPriority(Math.max(0, Number(e.target.value) || 0))} className="editor-input context-input-small" />
                                    <div className="context-field-hint">Higher priority tracks override lower ones when multiple are active.</div>
                                </div>
                            </div>

                            {/* Playback */}
                            <div className="editor-section">
                                <span className="editor-section-title">Playback</span>
                                <div className="context-field-group">
                                    <label className="editor-checkbox-label">
                                        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="editor-checkbox-input" />
                                        <span>Loop</span>
                                    </label>
                                </div>
                                <div className="context-field-group">
                                    <label className="editor-checkbox-label">
                                        <input type="checkbox" checked={playableByParticipants} onChange={(e) => setPlayableByParticipant(e.target.checked)} className="editor-checkbox-input" />
                                        <span>Playable by Participants</span>
                                    </label>
                                    <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                                        When enabled, AI participants can trigger this track via their messages.
                                    </div>
                                </div>
                                <div className="context-field-group">
                                    <label className="editor-label editor-label-small">Volume</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ flex: 1 }} />
                                        <span style={{ fontSize: '0.75rem', minWidth: '36px', textAlign: 'right' }}>{Math.round(volume * 100)}%</span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <div className="context-field-group" style={{ flex: 1 }}>
                                        <label className="editor-label editor-label-small">Start Fade (ms)</label>
                                        <input type="number" step="100" min="0" value={startFadeDurationMs} onChange={(e) => setStartFadeDurationMs(Math.max(0, Number(e.target.value) || 0))} className="editor-input context-input-small" />
                                        <div className="context-field-hint">Fade-in duration when track activates.</div>
                                    </div>
                                    <div className="context-field-group" style={{ flex: 1 }}>
                                        <label className="editor-label editor-label-small">End Fade (ms)</label>
                                        <input type="number" step="100" min="0" value={endFadeDurationMs} onChange={(e) => setEndFadeDurationMs(Math.max(0, Number(e.target.value) || 0))} className="editor-input context-input-small" />
                                        <div className="context-field-hint">Fade-out duration when track deactivates.</div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* ─── DETECTION TAB ─── */}
                    {activeTab === 'detection' && (
                        <div className="editor-section" style={{ margin: 0, border: 'none', background: 'transparent', padding: 0 }}>
                            <RegularExpressionTriggerEditor
                                label="Activation"
                                description="Track activates when a message matches any trigger. Leave empty to rely on bindings only."
                                triggers={regexActivationTriggers}
                                onChange={setRegexActivationTriggers}
                                error={errors.regex}
                                placeholder="/enters? (the )?forest/i"
                            />
                            <RegularExpressionTriggerEditor
                                label="Deactivation"
                                description="Track deactivates when a message matches any trigger."
                                triggers={regexDeactivationTriggers}
                                onChange={setRegexDeactivationTriggers}
                                error={errors.deactivationRegex}
                                placeholder="/leaves? (the )?forest/i"
                            />
                            <RegularExpressionTriggerEditor
                                label="Exclusion Activation"
                                description="Overrides activation when matched (e.g., 'forest' activates but 'dream forest' excludes)."
                                triggers={regexExclusionActivationTriggers}
                                onChange={setRegexExclusionActivationTriggers}
                                error={errors.exclusionActivationRegex}
                                placeholder="/dream forest|memory of forest/i"
                            />
                            <RegularExpressionTriggerEditor
                                label="Exclusion Deactivation"
                                description="When the exclusion stops being active."
                                triggers={regexExclusionDeactivationTriggers}
                                onChange={setRegexExclusionDeactivationTriggers}
                                error={errors.exclusionDeactivationRegex}
                                placeholder="/wake up|snap out of dream/i"
                            />
                        </div>
                    )}

                    {/* ─── BINDINGS TAB ─── */}
                    {activeTab === 'bindings' && (
                        <>
                            {/* Location Bindings */}
                            <div className="editor-section">
                                <span className="editor-section-title">Location Bindings</span>
                                <div className="context-field-group">
                                    <div className="context-binding-hint">Track activates when any of these locations are active. Empty = no location restriction.</div>
                                    <div className="context-character-binding-list">
                                        {locationBindings.map(id => {
                                            const loc = getLocationById(id);
                                            if (!loc) return null;
                                            return (
                                                <div key={id} className="context-character-binding-chip">
                                                    <span className="context-character-binding-name">📍 {loc.name}</span>
                                                    <button type="button" onClick={() => setLocationBindings(prev => prev.filter(lid => lid !== id))} className="context-character-binding-remove" title="Remove binding">×</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <select onChange={(e) => { const val = e.target.value; if (val && !locationBindings.includes(val)) setLocationBindings(prev => [...prev, val]); e.target.value = ""; }} className="editor-select" defaultValue="">
                                        <option value="" disabled>+ Bind to a location</option>
                                        {allLocations.filter(l => !locationBindings.includes(l.id)).map(l => (<option key={l.id} value={l.id}>{l.name}</option>))}
                                    </select>
                                </div>
                            </div>

                            {/* Context Bindings */}
                            <div className="editor-section">
                                <span className="editor-section-title">Context Bindings</span>
                                <div className="context-field-group">
                                    <div className="context-binding-hint">Track activates when any of these contexts are active. Empty = no context restriction.</div>
                                    <div className="context-character-binding-list">
                                        {contextBindings.map(id => {
                                            const context = getContextById(id);
                                            if (!context) return null;
                                            return (
                                                <div key={id} className="context-character-binding-chip">
                                                    <span className="context-character-binding-name">📜 {context.name}</span>
                                                    <button type="button" onClick={() => setContextBindings(prev => prev.filter(cid => cid !== id))} className="context-character-binding-remove" title="Remove binding">×</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <select onChange={(e) => { const val = e.target.value; if (val && !contextBindings.includes(val)) setContextBindings(prev => [...prev, val]); e.target.value = ""; }} className="editor-select" defaultValue="">
                                        <option value="" disabled>+ Bind to a context</option>
                                        {allContexts.filter(c => !contextBindings.includes(c.id)).map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                    </select>
                                </div>
                            </div>

                            {/* Character Bindings */}
                            <div className="editor-section">
                                <span className="editor-section-title">Character Bindings</span>
                                <div className="context-field-group">
                                    <div className="context-binding-hint">Track only plays for these characters. Empty = plays for all characters.</div>
                                    <div className="context-character-binding-list">
                                        {characterBindings.map(id => {
                                            const char = getCharacterById(id);
                                            if (!char) return null;
                                            return (
                                                <div key={id} className="context-character-binding-chip">
                                                    <span className="context-character-binding-name">🎭 {char.name}</span>
                                                    <button type="button" onClick={() => setCharacterBindings(prev => prev.filter(cid => cid !== id))} className="context-character-binding-remove" title="Remove binding">×</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <select onChange={(e) => { const val = e.target.value; if (val && !characterBindings.includes(val)) setCharacterBindings(prev => [...prev, val]); e.target.value = ""; }} className="editor-select" defaultValue="">
                                        <option value="" disabled>+ Bind to a character</option>
                                        {allCharacters.filter(c => !characterBindings.includes(c.id)).map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                    </select>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}