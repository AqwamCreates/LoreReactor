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

    // Background image regex triggers and weights (keyed by image index)
    const [bgImageRegexTriggers, setBgImageRegexTriggers] = useState<Record<number, string>>({});
    const [bgImageWeights, setBgImageWeights] = useState<Record<number, number>>({});

    const [activationTestText, setActivationTestText] = useState('');
    const [activationTestResult, setActivationTestResult] = useState<boolean | null>(null);

    // Per-image regex test state
    const [bgImageTestTexts, setBgImageTestTexts] = useState<Record<number, string>>({});
    const [bgImageTestResults, setBgImageTestResults] = useState<Record<number, boolean | null>>({});

    // Coordinates for weather and distance calculations
    const [latitude, setLatitude] = useState<string>('');
    const [longitude, setLongitude] = useState<string>('');

    const [errors, setErrors] = useState<{ name?: string; text?: string; regex?: string; images?: string; bindingRegex?: Record<string, string>; bgImageRegex?: Record<number, string>; latitude?: string; longitude?: string }>({});
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
                setBgImageRegexTriggers(existingLocation.backgroundImageRegularExpressionActivationTriggers ?? {});
                setBgImageWeights(existingLocation.backgroundImageWeights ?? {});
                setLatitude(existingLocation.latitude != null ? String(existingLocation.latitude) : '');
                setLongitude(existingLocation.longitude != null ? String(existingLocation.longitude) : '');
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
                setBgImageRegexTriggers({});
                setBgImageWeights({});
                setLatitude('');
                setLongitude('');
            }
            setErrors({});
            setActivationTestText('');
            setActivationTestResult(null);
            setBgImageTestTexts({});
            setBgImageTestResults({});
        }
    }, [isOpen, existingLocation]);

    const validate = (): boolean => {
        const newErrors: { name?: string; text?: string; regex?: string; images?: string; bindingRegex?: Record<string, string>; bgImageRegex?: Record<number, string>; latitude?: string; longitude?: string } = {};
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

        // Validate background image regex triggers
        const bgImageRegexErrors: Record<number, string> = {};
        for (const [idxStr, pattern] of Object.entries(bgImageRegexTriggers)) {
            if (pattern.trim()) {
                try { new RegExp(pattern); } catch (e) { bgImageRegexErrors[Number(idxStr)] = 'Invalid regex'; }
            }
        }
        if (Object.keys(bgImageRegexErrors).length > 0) newErrors.bgImageRegex = bgImageRegexErrors;

        // Validate coordinates
        if (latitude.trim()) {
            const lat = Number(latitude);
            if (Number.isNaN(lat) || lat < -90 || lat > 90) newErrors.latitude = 'Latitude must be between -90 and 90.';
        }
        if (longitude.trim()) {
            const lng = Number(longitude);
            if (Number.isNaN(lng) || lng < -180 || lng > 180) newErrors.longitude = 'Longitude must be between -180 and 180.';
        }

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

    const handleTestBgImageRegex = (index: number) => {
        const pattern = bgImageRegexTriggers[index];
        const testText = bgImageTestTexts[index];
        if (!pattern?.trim() || !testText?.trim()) {
            setBgImageTestResults(prev => ({ ...prev, [index]: null }));
            return;
        }
        try {
            const regex = new RegExp(pattern);
            setBgImageTestResults(prev => ({ ...prev, [index]: regex.test(testText) }));
        } catch {
            setBgImageTestResults(prev => ({ ...prev, [index]: null }));
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

        // Clean up bg image settings for removed index and shift higher indices down
        setBgImageRegexTriggers(prev => {
            const next: Record<number, string> = {};
            for (const [k, v] of Object.entries(prev)) {
                const ki = Number(k);
                if (ki < index) next[ki] = v;
                else if (ki > index) next[ki - 1] = v;
            }
            return next;
        });
        setBgImageWeights(prev => {
            const next: Record<number, number> = {};
            for (const [k, v] of Object.entries(prev)) {
                const ki = Number(k);
                if (ki < index) next[ki] = v;
                else if (ki > index) next[ki - 1] = v;
            }
            return next;
        });
        setBgImageTestTexts(prev => {
            const next: Record<number, string> = {};
            for (const [k, v] of Object.entries(prev)) {
                const ki = Number(k);
                if (ki < index) next[ki] = v;
                else if (ki > index) next[ki - 1] = v;
            }
            return next;
        });
        setBgImageTestResults(prev => {
            const next: Record<number, boolean | null> = {};
            for (const [k, v] of Object.entries(prev)) {
                const ki = Number(k);
                if (ki < index) next[ki] = v;
                else if (ki > index) next[ki - 1] = v;
            }
            return next;
        });
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
            } catch (error) {
                console.error("Failed to upload images:", error);
                alert("Failed to upload images. Location not saved.");
                setIsUploading(false);
                return null;
            }
            setIsUploading(false);
        }

        const now = Date.now();

        const parsedLat = latitude.trim() ? Number(latitude) : undefined;
        const parsedLng = longitude.trim() ? Number(longitude) : undefined;

        return {
            id: isNewClone ? uuidv4() : (existingLocation?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            text: text.trim() || undefined,
            images: finalImageFilenames && finalImageFilenames.length > 0 ? finalImageFilenames : undefined,
            regularExpressionActivationTrigger: regexActivationTrigger.trim() || undefined,
            backgroundImageRegularExpressionActivationTriggers: Object.keys(bgImageRegexTriggers).length > 0 ? bgImageRegexTriggers : {},
            backgroundImageWeights: Object.keys(bgImageWeights).length > 0 ? bgImageWeights : {},
            locationBindings: locationBindings.length > 0 ? locationBindings : [],
            locationBindingRegularExpressionTriggers: Object.keys(locationBindingRegexTriggers).length > 0 ? locationBindingRegexTriggers : undefined,
            characterBindings: characterBindings.length > 0 ? characterBindings : [],
            globalWeight: globalWeight,
            characterWeights: Object.keys(characterWeights).length > 0 ? characterWeights : {},
            latitude: parsedLat != null && !Number.isNaN(parsedLat) ? parsedLat : 0,
            longitude: parsedLng != null && !Number.isNaN(parsedLng) ? parsedLng : 0,
            locationDistances: existingLocation?.locationDistances ?? {},
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

    const availableLocationsForBinding = allLocations.filter(l => l.id !== existingLocation?.id);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingLocation ? 'Edit Location' : 'Create New Location'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {existingLocation && <button type="button" className="editor-button editor-button-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Saving...' : 'Save'}</button>
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
                                    <button type="button" onClick={() => handleRemoveImage(index)} className="editor-image-remove-button">×</button>
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

                    {/* Background Image Settings — only show when images exist */}
                    {imagePreviews.length > 0 && (
                        <div className="editor-section">
                            <span className="editor-section-title">Background Image Settings</span>
                            <div className="context-binding-hint">Configure per-image sampling weights and optional regex triggers. When the user enters this location, an image is randomly sampled by weight. If a regex trigger matches the user's message, it will display that image as background.</div>

                            {imagePreviews.map((preview, index) => {
                                const currentWeight = bgImageWeights[index] ?? 1;
                                const currentRegex = bgImageRegexTriggers[index] ?? '';
                                const hasRegexError = errors.bgImageRegex?.[index];
                                const testText = bgImageTestTexts[index] ?? '';
                                const testResult = bgImageTestResults[index] ?? null;
                                return (
                                    <div key={index} style={{ marginBottom: '10px', padding: '8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '6px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                            <img src={preview} alt={`Image ${index + 1}`} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                                            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', flex: 1 }}>Image {index + 1}</span>
                                        </div>

                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                            <div style={{ flex: '0 0 auto' }}>
                                                <label className="editor-label editor-label-small">Weight</label>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    min="0"
                                                    value={currentWeight}
                                                    onChange={(e) => {
                                                        const val = Math.max(0, Number(e.target.value) || 0);
                                                        setBgImageWeights(prev => ({ ...prev, [index]: val }));
                                                    }}
                                                    className="editor-input context-input-small"
                                                    style={{ width: '70px' }}
                                                />
                                            </div>

                                            <div style={{ flex: 1, minWidth: '150px' }}>
                                                <label className="editor-label editor-label-small">Regex Trigger (optional)</label>
                                                <input
                                                    type="text"
                                                    value={currentRegex}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setBgImageRegexTriggers(prev => {
                                                            const next = { ...prev };
                                                            if (val.trim()) next[index] = val;
                                                            else delete next[index];
                                                            return next;
                                                        });
                                                        setBgImageTestResults(prev => ({ ...prev, [index]: null }));
                                                        if (errors.bgImageRegex) {
                                                            setErrors(prev => {
                                                                const next = { ...prev, bgImageRegex: { ...(prev.bgImageRegex || {}) } };
                                                                if (next.bgImageRegex) {
                                                                    delete next.bgImageRegex[index];
                                                                    if (Object.keys(next.bgImageRegex).length === 0) next.bgImageRegex = {};
                                                                }
                                                                return next;
                                                            });
                                                        }
                                                    }}
                                                    className={`editor-input context-mono-input ${hasRegexError ? 'error' : ''}`}
                                                    placeholder="No trigger (sampled by weight)"
                                                    style={{ fontSize: '0.7rem' }}
                                                />
                                                {hasRegexError && <div className="editor-error-message" style={{ fontSize: '0.6rem' }}>{hasRegexError}</div>}
                                            </div>
                                        </div>

                                        {/* Regex test row for this image */}
                                        {currentRegex.trim() && (
                                            <div style={{ marginTop: '6px' }}>
                                                <div className="context-test-row">
                                                    <input
                                                        type="text"
                                                        value={testText}
                                                        onChange={(e) => {
                                                            setBgImageTestTexts(prev => ({ ...prev, [index]: e.target.value }));
                                                            setBgImageTestResults(prev => ({ ...prev, [index]: null }));
                                                        }}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTestBgImageRegex(index); } }}
                                                        className="editor-input context-test-input"
                                                        placeholder="Test user message..."
                                                        style={{ fontSize: '0.7rem' }}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleTestBgImageRegex(index)}
                                                        className="editor-button editor-button-save context-test-button"
                                                        disabled={!testText.trim()}
                                                    >Test</button>
                                                </div>
                                                {testResult !== null && (
                                                    <div className={`context-test-result ${testResult ? 'editor-success-message' : 'editor-error-message'}`} style={{ fontSize: '0.6rem' }}>
                                                        {testResult ? '✅ Matches!' : '❌ No match'}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="editor-section">
                        <span className="editor-section-title">Movement Trigger</span>

                        <div className="editor-row-full">
                            <div>
                                <label className="editor-label editor-label-small">Activation Trigger</label>
                                <input type="text" value={regexActivationTrigger} onChange={(e) => { setRegexActivationTrigger(e.target.value); if (errors.regex) setErrors({ ...errors, regex: undefined }); setActivationTestResult(null); }} className={`editor-input context-mono-input ${errors.regex ? 'error' : ''}`} placeholder="/enters? (the )?forest|walks? into trees/i" />
                                {errors.regex && <div className="editor-error-message">{errors.regex}</div>}
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    The user moves to this location when their message matches this pattern.
                                </div>
                            </div>
                        </div>

                        {regexActivationTrigger.trim() && (
                            <div className="context-field-group">
                                <label className="editor-label editor-label-small">Test Activation Pattern</label>
                                <div className="context-test-row">
                                    <input type="text" value={activationTestText} onChange={(e) => { setActivationTestText(e.target.value); setActivationTestResult(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTestActivationRegex(); } }} className="editor-input context-test-input" placeholder="She walks into the dark forest" />
                                    <button type="button" onClick={handleTestActivationRegex} className="editor-button editor-button-save context-test-button" disabled={!activationTestText.trim()}>Test</button>
                                </div>
                                {activationTestResult !== null && (
                                    <div className={`context-test-result ${activationTestResult ? 'editor-success-message' : 'editor-error-message'}`}>
                                        {activationTestResult ? '✅ Trigger matches!' : '❌ Trigger does not match'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Location Bindings */}
                    <div className="editor-section">
                        <span className="editor-section-title">Location Bindings</span>
                        <div className="context-field-group">
                            <div className="context-binding-hint">The user can only reach this location from these connected locations. Empty = reachable from anywhere.</div>
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

                        {locationBindings.length > 0 && (
                            <div className="context-field-group" style={{ marginTop: '8px' }}>
                                <span className="editor-label editor-label-small">Conditional Access Triggers</span>
                                <div className="context-binding-hint">Optional regex per binding. If set, the connection only works when the user's recent messages match. Leave empty for unconditional access.</div>
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
                                                        if (next.bindingRegex) {
                                                            delete next.bindingRegex[id];
                                                            if (Object.keys(next.bindingRegex).length === 0) next.bindingRegex = {};
                                                        }
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

                    {/* Character Bindings */}
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

                    {/* Coordinates */}
                    <div className="editor-section">
                        <span className="editor-section-title">Coordinates</span>
                        <div className="context-binding-hint">Real-world latitude and longitude for this location. Used for local weather when enabled in the profile. Leave empty to fall back to browser geolocation.</div>
                        <div className="editor-row" style={{ gap: '12px' }}>
                            <div style={{ flex: 1 }}>
                                <label className="editor-label editor-label-small">Latitude</label>
                                <input
                                    type="number"
                                    step="any"
                                    min="-90"
                                    max="90"
                                    value={latitude}
                                    onChange={(e) => { setLatitude(e.target.value); if (errors.latitude) setErrors(prev => ({ ...prev, latitude: undefined })); }}
                                    className={`editor-input context-input-small ${errors.latitude ? 'error' : ''}`}
                                    placeholder="-90 to 90"
                                />
                                {errors.latitude && <div className="editor-error-message" style={{ fontSize: '0.6rem' }}>{errors.latitude}</div>}
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="editor-label editor-label-small">Longitude</label>
                                <input
                                    type="number"
                                    step="any"
                                    min="-180"
                                    max="180"
                                    value={longitude}
                                    onChange={(e) => { setLongitude(e.target.value); if (errors.longitude) setErrors(prev => ({ ...prev, longitude: undefined })); }}
                                    className={`editor-input context-input-small ${errors.longitude ? 'error' : ''}`}
                                    placeholder="-180 to 180"
                                />
                                {errors.longitude && <div className="editor-error-message" style={{ fontSize: '0.6rem' }}>{errors.longitude}</div>}
                            </div>
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