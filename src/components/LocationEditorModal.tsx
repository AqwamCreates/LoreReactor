// src/components/LocationEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { Location, Character } from '../types';
import { uploadLocationImage } from '../hooks/storage';
import { v4 as uuidv4 } from 'uuid';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import './main.css';

const tokenEngine = getLanguageModelEngine();

interface LocationEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (location: Location) => void;
    existingLocation?: Location | null;
    allCharacters?: Character[];
    allLocations?: Location[];
    runtimePort?: number;
}

export function LocationEditorModal({
    isOpen,
    onClose,
    onSave,
    existingLocation,
    allCharacters = [],
    allLocations = [],
    runtimePort,
}: LocationEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [text, setText] = useState('');
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    const [regexActivationTrigger, setRegexActivationTrigger] = useState('');
    const [locationBindings, setLocationBindings] = useState<string[]>([]);
    const [locationBindingRegexTriggers, setLocationBindingRegexTriggers] = useState<Record<string, string>>({});
    const [characterBindings, setCharacterBindings] = useState<string[]>([]);
    const [globalWeight, setGlobalWeight] = useState<number>(1);
    const [characterWeights, setCharacterWeights] = useState<Record<string, number>>({});
    const [useBase64Encoding, setUseBase64Encoding] = useState<boolean>(false);

    const [activationTestText, setActivationTestText] = useState('');
    const [activationTestResult, setActivationTestResult] = useState<boolean | null>(null);

    const [errors, setErrors] = useState<{ name?: string; text?: string; regex?: string; images?: string; bindingRegex?: Record<string, string> }>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [textNumberOfTokens, setTextNumberOfTokens] = useState(0);
    const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounced accurate token count
    useEffect(() => {
        let cancelled = false;

        if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
        tokenDebounceRef.current = setTimeout(async () => {
            const count = await tokenEngine.countTokens(text, runtimePort ? { runtimePort } : undefined);
            if (!cancelled) setTextNumberOfTokens(count);
        }, 400);

        return () => {
            cancelled = true;
            if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
        };
    }, [text, runtimePort]);

    useEffect(() => {
        if (isOpen) {
            if (existingLocation) {
                setName(existingLocation.name || '');
                setDescription(existingLocation.description || '');
                setText(existingLocation.text || '');

                if (existingLocation.images && existingLocation.images.length > 0) {
                    const previews = existingLocation.images.map(img => `/user_data/location_data/${img}`);
                    setImagePreviews(previews);
                } else {
                    setImagePreviews([]);
                }

                setImageFiles([]);
                setRegexActivationTrigger(existingLocation.regularExpressionActivationTrigger || '');
                setLocationBindings(existingLocation.locationBindings ?? []);
                setLocationBindingRegexTriggers(existingLocation.locationBindingRegularExpressionTriggers ?? {});
                setCharacterBindings(existingLocation.characterBindings ?? []);
                setGlobalWeight(existingLocation.globalWeight ?? 1);
                setCharacterWeights(existingLocation.characterWeights ?? {});
                setUseBase64Encoding(existingLocation.useBase64Encoding ?? false);
            } else {
                setName('');
                setDescription('');
                setText('');
                setImageFiles([]);
                setImagePreviews([]);
                setRegexActivationTrigger('');
                setLocationBindings([]);
                setLocationBindingRegexTriggers({});
                setCharacterBindings([]);
                setGlobalWeight(1);
                setCharacterWeights({});
                setUseBase64Encoding(false);
            }
            setErrors({});
            setActivationTestText('');
            setActivationTestResult(null);
        }
    }, [isOpen, existingLocation]);

    const validate = (): boolean => {
        const newErrors: { name?: string; text?: string; regex?: string; images?: string; bindingRegex?: Record<string, string> } = {};
        if (!name.trim()) newErrors.name = 'Name is required.';

        const hasText = text.trim().length > 0;
        const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;

        if (!hasText && !hasImages) {
            newErrors.text = 'Either text or images are required.';
            newErrors.images = 'Either text or images are required.';
        }

        if (regexActivationTrigger.trim()) {
            try { new RegExp(regexActivationTrigger); } catch (e) { newErrors.regex = 'Invalid activation regular expression.'; }
        }

        // Validate location binding regex triggers
        const bindingRegexErrors: Record<string, string> = {};
        for (const [locId, pattern] of Object.entries(locationBindingRegexTriggers)) {
            if (pattern.trim()) {
                try { new RegExp(pattern); } catch (e) { bindingRegexErrors[locId] = 'Invalid regex'; }
            }
        }
        if (Object.keys(bindingRegexErrors).length > 0) newErrors.bindingRegex = bindingRegexErrors;

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleTestActivationRegex = () => {
        if (!regexActivationTrigger.trim() || !activationTestText.trim()) { setActivationTestResult(null); return; }
        try {
            const regex = new RegExp(regexActivationTrigger);
            setActivationTestResult(regex.test(activationTestText));
        } catch (e) {
            setActivationTestResult(null);
            setErrors(prev => ({ ...prev, regex: 'Invalid activation regular expression.' }));
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const files = Array.from(e.target.files);
            setImageFiles(prev => [...prev, ...files]);
            const newPreviews = files.map(file => URL.createObjectURL(file));
            setImagePreviews(prev => [...prev, ...newPreviews]);
            if (errors.images) setErrors(prev => ({ ...prev, images: undefined }));
        }
        e.target.value = '';
    };

    const handleRemoveImage = (index: number) => {
        setImageFiles(prev => prev.filter((_, i) => i !== index));
        if (!imagePreviews[index].startsWith('data:image')) {
            URL.revokeObjectURL(imagePreviews[index]);
        }
        setImagePreviews(prev => prev.filter((_, i) => i !== index));
    };

    const buildLocationFromForm = async (isNewClone: boolean): Promise<Location | null> => {
        if (!validate()) return null;

        let finalImageFilenames: string[] | undefined = isNewClone ? [] : (existingLocation?.images || []);

        if (imageFiles.length > 0) {
            setIsUploading(true);
            try {
                const uploadPromises = imageFiles.map(file => uploadLocationImage(file));
                const uploadedFilenames = await Promise.all(uploadPromises);
                finalImageFilenames = [...(isNewClone ? [] : (existingLocation?.images || [])), ...uploadedFilenames];
            } catch (err) {
                console.error("Failed to upload images:", err);
                alert("Failed to upload images. Location not saved.");
                setIsUploading(false);
                return null;
            }
            setIsUploading(false);
        }

        const now = Date.now();

        return {
            id: isNewClone ? uuidv4() : (existingLocation?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            text: text.trim() || undefined,
            images: finalImageFilenames && finalImageFilenames.length > 0 ? finalImageFilenames : undefined,
            regularExpressionActivationTrigger: regexActivationTrigger.trim() || undefined,
            locationBindings: locationBindings.length > 0 ? locationBindings : [],
            locationBindingRegularExpressionTriggers: Object.keys(locationBindingRegexTriggers).length > 0 ? locationBindingRegexTriggers : undefined,
            characterBindings: characterBindings.length > 0 ? characterBindings : [],
            globalWeight: globalWeight,
            characterWeights: Object.keys(characterWeights).length > 0 ? characterWeights : {},
            useBase64Encoding,
            firstCreatedTimestamp: isNewClone ? now : (existingLocation?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => {
        const location = await buildLocationFromForm(false);
        if (!location) return;
        onSave(location);
        onClose();
    };

    const handleClone = async () => {
        const clonedLocation = await buildLocationFromForm(true);
        if (!clonedLocation) return;
        onSave(clonedLocation);
        onClose();
    };

    if (!isOpen) return null;

    const hasText = text.trim().length > 0;
    const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;
    const textRequiresAsterisk = !hasImages;
    const imagesRequiresAsterisk = !hasText;

    const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);
    const getLocationById = (id: string) => allLocations.find(l => l.id === id);

    // Filter out self-reference from available location bindings
    const availableLocationsForBinding = allLocations.filter(l => l.id !== existingLocation?.id);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingLocation ? 'Edit Location' : 'Create New Location'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {existingLocation && <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Saving...' : 'Save'}</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    <div className="context-field-group">
                        <label className="editor-label">Name <span className="context-required-asterisk">*</span></label>
                        <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} className={`editor-input ${errors.name ? 'error' : ''}`} placeholder="e.g., Dark Forest" />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    <div className="context-field-group">
                        <label className="editor-label">Description</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea" placeholder="Brief description" rows={2} />
                    </div>

                    <div className="context-field-group">
                        <label className="editor-label">Text {textRequiresAsterisk && <span className="context-required-asterisk">*</span>}</label>
                        <textarea value={text} onChange={(e) => { setText(e.target.value); if (errors.text) setErrors({ ...errors, text: undefined }); }} className={`editor-textarea ${errors.text ? 'error' : ''}`} placeholder="Location description and atmosphere (optional if using images)" rows={6} />
                        <div className="context-token-count">~{textNumberOfTokens} token(s)</div>
                        {errors.text && <div className="editor-error-message">{errors.text}</div>}
                    </div>

                    <div className="context-field-group">
                        <label className="editor-label">Images {imagesRequiresAsterisk && <span className="context-required-asterisk">*</span>}</label>
                        <div className="editor-image-grid">
                            {imagePreviews.map((preview, index) => (
                                <div key={index} className="editor-image-square active">
                                    <img src={preview} alt={`Location image ${index + 1}`} />
                                    <button type="button" onClick={() => handleRemoveImage(index)} className="editor-image-remove-btn">×</button>
                                </div>
                            ))}
                            <div className={`editor-image-square editor-upload-square ${isUploading ? 'disabled' : ''}`} onClick={() => !isUploading && fileInputRef.current?.click()}>
                                <div className="context-image-placeholder">
                                    <div className="context-image-placeholder-icon">{isUploading ? '⏳' : '📷'}</div>
                                    <div className="context-image-placeholder-text">{isUploading ? 'Uploading...' : 'Upload'}</div>
                                </div>
                            </div>
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleImageChange} disabled={isUploading} />
                        {errors.images && <div className="editor-error-message">{errors.images}</div>}
                    </div>

                    <div className="editor-section">
                        <span className="editor-section-title">Movement Trigger</span>

                        <div className="editor-row-full">
                            <div>
                                <label className="editor-label editor-label-small">Activation Trigger</label>
                                <input type="text" value={regexActivationTrigger} onChange={(e) => { setRegexActivationTrigger(e.target.value); if (errors.regex) setErrors({ ...errors, regex: undefined }); setActivationTestResult(null); }} className={`editor-input context-mono-input ${errors.regex ? 'error' : ''}`} placeholder="/enters? (the )?forest|walks? into trees/i" />
                                {errors.regex && <div className="editor-error-message">{errors.regex}</div>}
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Characters move to this location when their message matches this pattern.
                                </div>
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
                    </div>

                    {/* Location Bindings (above Character Bindings) */}
                    <div className="editor-section">
                        <span className="editor-section-title">Location Bindings</span>
                        <div className="context-field-group">
                            <div className="context-binding-hint">Characters can only reach this location from these connected locations. Empty = reachable from anywhere.</div>
                            <div className="context-character-binding-list">
                                {locationBindings.map(id => {
                                    const loc = getLocationById(id);
                                    if (!loc) return null;
                                    return (
                                        <div key={id} className="context-character-binding-chip">
                                            <span className="context-character-binding-name">{loc.name}</span>
                                            <button type="button" onClick={() => {
                                                setLocationBindings(prev => prev.filter(lid => lid !== id));
                                                setLocationBindingRegexTriggers(prev => { const next = { ...prev }; delete next[id]; return next; });
                                            }} className="context-character-binding-remove" title="Remove binding">×</button>
                                        </div>
                                    );
                                })}
                            </div>
                            <select onChange={(e) => { const val = e.target.value; if (val && !locationBindings.includes(val)) setLocationBindings(prev => [...prev, val]); e.target.value = ""; }} className="editor-select" defaultValue="">
                                <option value="" disabled>+ Connect from a location</option>
                                {availableLocationsForBinding.filter(l => !locationBindings.includes(l.id)).map(l => (<option key={l.id} value={l.id}>{l.name}</option>))}
                            </select>
                        </div>

                        {/* Conditional Regex Triggers per Location Binding */}
                        {locationBindings.length > 0 && (
                            <div className="context-field-group" style={{ marginTop: '8px' }}>
                                <span className="editor-label editor-label-small">Conditional Access Triggers</span>
                                <div className="context-binding-hint">Optional regex per binding. If set, the connection only works when recent messages match. Leave empty for unconditional access.</div>
                                {locationBindings.map(id => {
                                    const loc = getLocationById(id);
                                    if (!loc) return null;
                                    const currentRegex = locationBindingRegexTriggers[id] || '';
                                    const hasError = errors.bindingRegex?.[id];
                                    return (
                                        <div key={id} style={{ marginBottom: '6px' }}>
                                            <label className="editor-label editor-label-small" style={{ display: 'block', marginBottom: '2px' }}>{loc.name}</label>
                                            <input
                                                type="text"
                                                value={currentRegex}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setLocationBindingRegexTriggers(prev => {
                                                        const next = { ...prev };
                                                        if (val.trim()) next[id] = val;
                                                        else delete next[id];
                                                        return next;
                                                    });
                                                    if (errors.bindingRegex) setErrors(prev => {
                                                        const next = { ...prev, bindingRegex: { ...(prev.bindingRegex || {}) } };
                                                        delete next.bindingRegex![id];
                                                        if (Object.keys(next.bindingRegex!).length === 0) delete next.bindingRegex;
                                                        return next;
                                                    });
                                                }}
                                                className={`editor-input context-mono-input ${hasError ? 'error' : ''}`}
                                                placeholder="Unconditional (no regex)"
                                                style={{ fontSize: '0.75rem' }}
                                            />
                                            {hasError && <div className="editor-error-message" style={{ fontSize: '0.6rem' }}>{hasError}</div>}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Character Bindings (below Location Bindings) */}
                    <div className="editor-section">
                        <span className="editor-section-title">Character Bindings</span>
                        <div className="context-field-group">
                            <div className="context-binding-hint">Only these characters can move to this location. Empty = all characters.</div>
                            <div className="context-character-binding-list">
                                {characterBindings.map(id => {
                                    const char = getCharacterById(id);
                                    if (!char) return null;
                                    return (
                                        <div key={id} className="context-character-binding-chip">
                                            <span className="context-character-binding-name">{char.name}</span>
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

                    <div className="editor-section">
                        <span className="editor-section-title">Movement Weights</span>
                        <div className="context-field-group">
                            <label className="editor-label editor-label-small">Global Weight</label>
                            <input type="number" step="0.1" min="0" value={globalWeight} onChange={(e) => setGlobalWeight(Math.max(0, Number(e.target.value) || 0))} className="editor-input context-input-small" />
                            <div className="context-field-hint">Base likelihood for any character to enter this location. Higher = more likely. Used when no character-specific weight is set.</div>
                        </div>

                        <div className="context-field-group">
                            <span className="editor-label editor-label-small">Character-Specific Weights</span>
                            <div className="context-binding-hint">Override global weight per character. Characters not listed use the global weight.</div>
                            <div className="context-character-binding-list">
                                {Object.entries(characterWeights).map(([charId, weight]) => {
                                    const char = getCharacterById(charId);
                                    if (!char) return null;
                                    return (
                                        <div key={charId} className="context-character-binding-chip" style={{ gap: '6px' }}>
                                            <span className="context-character-binding-name">{char.name}</span>
                                            <input type="number" step="0.1" min="0" value={weight} onChange={(e) => setCharacterWeights(prev => ({ ...prev, [charId]: Math.max(0, Number(e.target.value) || 0) }))} className="editor-input" style={{ width: '60px', padding: '2px 4px', fontSize: '0.75rem' }} />
                                            <button type="button" onClick={() => setCharacterWeights(prev => { const next = { ...prev }; delete next[charId]; return next; })} className="context-character-binding-remove" title="Remove weight override">×</button>
                                        </div>
                                    );
                                })}
                            </div>
                            <select onChange={(e) => { const val = e.target.value; if (val && !(val in characterWeights)) setCharacterWeights(prev => ({ ...prev, [val]: globalWeight })); e.target.value = ""; }} className="editor-select" defaultValue="">
                                <option value="" disabled>+ Add character weight override</option>
                                {allCharacters.filter(c => !(c.id in characterWeights)).map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                            </select>
                        </div>
                    </div>

                    <div className="editor-section">
                        <span className="editor-section-title">Encoding</span>
                        <label className="editor-checkbox-label">
                            <input
                                type="checkbox"
                                checked={useBase64Encoding}
                                onChange={(e) => setUseBase64Encoding(e.target.checked)}
                                className="editor-checkbox-input"
                            />
                            <span>Use Base64 Encoding</span>
                        </label>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                            Encode location text as base64 in the prompt. Useful for preventing the model from treating location descriptions as instructions.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}