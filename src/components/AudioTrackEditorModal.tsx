// src/components/AudioTrackEditorModal.tsx
import { useState, useEffect, useRef } from 'react';
import type { AudioTrack, Character, Context, Location, audioCategory } from '../types';
import { uploadAudioTrack, getAudioTrackUrl } from '../hooks/storage';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

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

export function AudioTrackEditorModal({
    isOpen,
    onClose,
    onSave,
    existingTrack,
    allCharacters = [],
    allContexts = [],
    allLocations = [],
}: AudioTrackEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [filename, setFilename] = useState('');
    const [loop, setLoop] = useState(true);
    const [volume, setVolume] = useState(1);
    const [startFadeDurationMs, setStartFadeDurationMs] = useState(1000);
    const [endFadeDurationMs, setEndFadeDurationMs] = useState(1000);
    const [audioCategory, setAudioCategory] = useState<audioCategory>('ambient');
    const [priority, setPriority] = useState(0);

    const [regexActivationTrigger, setRegexActivationTrigger] = useState('');
    const [regexDeactivationTrigger, setRegexDeactivationTrigger] = useState('');
    const [locationBindings, setLocationBindings] = useState<string[]>([]);
    const [contextBindings, setContextBindings] = useState<string[]>([]);
    const [characterBindings, setCharacterBindings] = useState<string[]>([]);

    const [activationTestText, setActivationTestText] = useState('');
    const [activationTestResult, setActivationTestResult] = useState<boolean | null>(null);

    const [errors, setErrors] = useState<{ name?: string; filename?: string; regex?: string; deactivationRegex?: string }>({});
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (isOpen) {
            if (existingTrack) {
                setName(existingTrack.name || '');
                setDescription(existingTrack.description || '');
                setFilename(existingTrack.filename || '');
                setLoop(existingTrack.loop ?? true);
                setVolume(existingTrack.volume ?? 1);
                setStartFadeDurationMs(existingTrack.startFadeDurationMs ?? 1000);
                setEndFadeDurationMs(existingTrack.endFadeDurationMs ?? 1000);
                setAudioCategory(existingTrack.audioCategory ?? 'ambient');
                setPriority(existingTrack.priority ?? 0);
                setRegexActivationTrigger(existingTrack.regularExpressionActivationTrigger || '');
                setRegexDeactivationTrigger(existingTrack.regularExpressionDeactivationTrigger || '');
                setLocationBindings(existingTrack.locationBindings ?? []);
                setContextBindings(existingTrack.contextBindings ?? []);
                setCharacterBindings(existingTrack.characterBindings ?? []);
                setPreviewUrl(getAudioTrackUrl(existingTrack.filename));
            } else {
                setName('');
                setDescription('');
                setFilename('');
                setLoop(true);
                setVolume(1);
                setStartFadeDurationMs(1000);
                setEndFadeDurationMs(1000);
                setAudioCategory('ambient');
                setPriority(0);
                setRegexActivationTrigger('');
                setRegexDeactivationTrigger('');
                setLocationBindings([]);
                setContextBindings([]);
                setCharacterBindings([]);
                setPreviewUrl(null);
            }
            setErrors({});
            setActivationTestText('');
            setActivationTestResult(null);
            setAudioFile(null);
            setIsUploading(false);
            setIsPreviewPlaying(false);
        }
    }, [isOpen, existingTrack]);

    // Cleanup preview audio on close
    useEffect(() => {
        if (!isOpen) {
            if (previewAudioRef.current) {
                previewAudioRef.current.pause();
                previewAudioRef.current = null;
            }
            setIsPreviewPlaying(false);
        }
    }, [isOpen]);

    const validate = (): boolean => {
        const newErrors: typeof errors = {};
        if (!name.trim()) newErrors.name = 'Name is required.';
        if (!filename.trim()) newErrors.filename = 'Filename is required.';

        if (regexActivationTrigger.trim()) {
            try { new RegExp(regexActivationTrigger); } catch { newErrors.regex = 'Invalid activation regular expression.'; }
        }

        if (regexDeactivationTrigger.trim()) {
            try { new RegExp(regexDeactivationTrigger); } catch { newErrors.deactivationRegex = 'Invalid deactivation regular expression.'; }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleTestActivationRegex = () => {
        if (!regexActivationTrigger.trim() || !activationTestText.trim()) { setActivationTestResult(null); return; }
        try {
            const regex = new RegExp(regexActivationTrigger);
            setActivationTestResult(regex.test(activationTestText));
        } catch {
            setActivationTestResult(null);
            setErrors(prev => ({ ...prev, regex: 'Invalid activation regular expression.' }));
        }
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
            previewAudioRef.current.onerror = () => {
                setIsPreviewPlaying(false);
            };
        } else {
            previewAudioRef.current.src = previewUrl;
            previewAudioRef.current.volume = volume;
            previewAudioRef.current.loop = loop;
        }

        previewAudioRef.current.play().then(() => {
            setIsPreviewPlaying(true);
        }).catch(() => {
            setIsPreviewPlaying(false);
        });
    };

    // Update preview volume/loop when settings change during playback
    useEffect(() => {
        if (previewAudioRef.current && isPreviewPlaying) {
            previewAudioRef.current.volume = volume;
            previewAudioRef.current.loop = loop;
        }
    }, [volume, loop, isPreviewPlaying]);

    const buildTrackFromForm = async (isNewClone: boolean): Promise<AudioTrack | null> => {
        if (!validate()) return null;

        let finalFilename = filename.trim();

        // Upload new file if selected
        if (audioFile) {
            setIsUploading(true);
            try {
                finalFilename = await uploadAudioTrack(audioFile);
            } catch (err) {
                console.error('Failed to upload audio file:', err);
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

        return {
            id: isNewClone ? uuidv4() : (existingTrack?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            filename: finalFilename,
            loop,
            volume,
            startFadeDurationMs,
            endFadeDurationMs,
            audioCategory,
            priority,
            regularExpressionActivationTrigger: regexActivationTrigger.trim() || undefined,
            regularExpressionDeactivationTrigger: regexDeactivationTrigger.trim() || undefined,
            locationBindings: locationBindings.length > 0 ? locationBindings : [],
            contextBindings: contextBindings.length > 0 ? contextBindings : [],
            characterBindings: characterBindings.length > 0 ? characterBindings : [],
            firstCreatedTimestamp: isNewClone ? now : (existingTrack?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => {
        const track = await buildTrackFromForm(false);
        if (!track) return;
        onSave(track);
        onClose();
    };

    const handleClone = async () => {
        const cloned = await buildTrackFromForm(true);
        if (!cloned) return;
        onSave(cloned);
        onClose();
    };

    if (!isOpen) return null;

    const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);
    const getContextById = (id: string) => allContexts.find(c => c.id === id);
    const getLocationById = (id: string) => allLocations.find(l => l.id === id);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingTrack ? 'Edit Audio Track' : 'Create New Audio Track'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {existingTrack && <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Saving...' : 'Save'}</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Basic Info */}
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
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={() => audioInputRef.current?.click()} disabled={isUploading} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px', whiteSpace: 'nowrap' }}>
                                {isUploading ? '⏳' : '📁 Upload'}
                            </button>
                        </div>
                        <input ref={audioInputRef} type="file" accept=".ogg,.mp3,.wav,.flac,audio/*" hidden onChange={(e) => {
                            if (e.target.files?.[0]) {
                                const file = e.target.files[0];
                                setAudioFile(file);
                                setFilename(file.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
                                if (errors.filename) setErrors({ ...errors, filename: undefined });
                                // Create local preview URL for newly selected file
                                setPreviewUrl(URL.createObjectURL(file));
                            }
                            e.target.value = '';
                        }} disabled={isUploading} />
                        {errors.filename && <div className="editor-error-message">{errors.filename}</div>}
                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                            Supports .ogg, .mp3, .wav, .flac. Upload stores the file; or type an existing filename manually.
                        </div>
                    </div>

                    {/* Audio Preview */}
                    {previewUrl && (
                        <div className="context-field-group">
                            <label className="editor-label editor-label-small">Preview</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <button
                                    type="button"
                                    onClick={handleTogglePreview}
                                    className={`editor-btn ${isPreviewPlaying ? 'editor-btn-save' : 'editor-btn-cancel'}`}
                                    style={{ fontSize: '0.75rem', padding: '4px 14px', minHeight: '28px' }}
                                >
                                    {isPreviewPlaying ? '⏹ Stop' : '▶ Play'}
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
                                    <button
                                        key={cat.value}
                                        type="button"
                                        onClick={() => setAudioCategory(cat.value)}
                                        className={`editor-btn ${audioCategory === cat.value ? 'editor-btn-save' : 'editor-btn-cancel'}`}
                                        style={{ fontSize: '0.75rem', padding: '4px 12px', minHeight: '28px' }}
                                    >
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

                    {/* Playback Settings */}
                    <div className="editor-section">
                        <span className="editor-section-title">Playback</span>

                        <div className="context-field-group">
                            <label className="editor-checkbox-label">
                                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} className="editor-checkbox-input" />
                                <span>Loop</span>
                            </label>
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

                    {/* Activation Triggers */}
                    <div className="editor-section">
                        <span className="editor-section-title">Activation Triggers</span>

                        <div className="context-field-group">
                            <label className="editor-label editor-label-small">Activation Regex</label>
                            <input type="text" value={regexActivationTrigger} onChange={(e) => { setRegexActivationTrigger(e.target.value); if (errors.regex) setErrors({ ...errors, regex: undefined }); setActivationTestResult(null); }} className={`editor-input context-mono-input ${errors.regex ? 'error' : ''}`} placeholder="enters? (the )?forest|walks? into trees" />
                            {errors.regex && <div className="editor-error-message">{errors.regex}</div>}
                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                Track activates when a message matches this pattern. Leave empty to rely on bindings only.
                            </div>
                        </div>

                        {regexActivationTrigger.trim() && (
                            <div className="context-field-group">
                                <label className="editor-label editor-label-small">Test Activation Pattern</label>
                                <div className="context-test-row">
                                    <input type="text" value={activationTestText} onChange={(e) => { setActivationTestText(e.target.value); setActivationTestResult(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTestActivationRegex(); } }} className="editor-input context-test-input" placeholder="She walks into the dark forest" />
                                    <button type="button" onClick={handleTestActivationRegex} className="editor-btn editor-btn-save context-test-btn" disabled={!activationTestText.trim()}>Test</button>
                                </div>
                                {activationTestResult !== null && (
                                    <div className={`context-test-result ${activationTestResult ? 'editor-success-message' : 'editor-error-message'}`}>
                                        {activationTestResult ? '✅ Trigger matches!' : '❌ Trigger does not match'}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="context-field-group">
                            <label className="editor-label editor-label-small">Deactivation Regex</label>
                            <input type="text" value={regexDeactivationTrigger} onChange={(e) => { setRegexDeactivationTrigger(e.target.value); if (errors.deactivationRegex) setErrors({ ...errors, deactivationRegex: undefined }); }} className={`editor-input context-mono-input ${errors.deactivationRegex ? 'error' : ''}`} placeholder="leaves? (the )?forest|exits? trees" />
                            {errors.deactivationRegex && <div className="editor-error-message">{errors.deactivationRegex}</div>}
                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                Track deactivates when a message matches this pattern. Optional.
                            </div>
                        </div>
                    </div>

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
                                    const ctx = getContextById(id);
                                    if (!ctx) return null;
                                    return (
                                        <div key={id} className="context-character-binding-chip">
                                            <span className="context-character-binding-name">📜 {ctx.name}</span>
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
                </div>
            </div>
        </div>
    );
}