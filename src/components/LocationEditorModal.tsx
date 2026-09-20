// src/components/LocationEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { Location, Character, AudioTrack, RegularExpressionTrigger } from '../types';
import { uploadLocationImage } from '../storage/serverStorage';
import { v4 as uuidv4 } from 'uuid';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { useSessionStore } from '../hooks/useSessionStore';
import { RegularExpressionTriggerEditor } from './RegularExpressionTriggerEditor';
import '../main.css';

const tokenEngine = getLanguageModelEngine();

interface LocationEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (location: Location) => void;
    existingLocation?: Location | null;
    allCharacters?: Character[];
    allLocations?: Location[];
    allAudioTracks?: AudioTrack[];
}

type LocationTabId = 'general' | 'movement' | 'filter' | 'bindings';

export function LocationEditorModal({
    isOpen,
    onClose,
    onSave,
    existingLocation,
    allCharacters = [],
    allLocations = [],
    allAudioTracks = [],
}: LocationEditorModalProps) {
    if (!isOpen) return null;

    const modalKey = `loc-${existingLocation?.id ?? 'new'}`;

    return (
        <LocationEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingLocation={existingLocation}
            allCharacters={allCharacters}
            allLocations={allLocations}
            allAudioTracks={allAudioTracks}
        />
    );
}

function LocationEditorModalInner({
    onClose,
    onSave,
    existingLocation,
    allCharacters = [],
    allLocations = [],
    allAudioTracks = [],
}: Omit<LocationEditorModalProps, 'isOpen'>) {
    const [activeTab, setActiveTab] = useState<LocationTabId>('general');

    const [name, setName] = useState(existingLocation?.name || '');
    const [description, setDescription] = useState(existingLocation?.description || '');
    const [text, setText] = useState(existingLocation?.text || '');
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>(() => {
        if (existingLocation?.images && existingLocation.images.length > 0) {
            return existingLocation.images.map(img => `/user_data/location_data/${img}`);
        }
        return [];
    });
    const [isUploading, setIsUploading] = useState(false);

    const [regexActivationTriggers, setRegexActivationTriggers] = useState<RegularExpressionTrigger[]>(existingLocation?.regularExpressionActivationTriggers ?? []);
    const [regexExclusionActivationTriggers, setRegexExclusionActivationTriggers] = useState<RegularExpressionTrigger[]>(existingLocation?.regularExpressionExclusionActivationTriggers ?? []);
    const [regexExclusionDeactivationTriggers, setRegexExclusionDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingLocation?.regularExpressionExclusionDeactivationTriggers ?? []);
    const [messageFilterActivationTriggers, setMessageFilterActivationTriggers] = useState<RegularExpressionTrigger[]>(existingLocation?.messageFilterRegularExpressionActivationTriggers ?? []);
    const [messageFilterDeactivationTriggers, setMessageFilterDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingLocation?.messageFilterRegularExpressionDeactivationTriggers ?? []);
    const [messageFilterExclusionActivationTriggers, setMessageFilterExclusionActivationTriggers] = useState<RegularExpressionTrigger[]>(existingLocation?.messageFilterRegularExpressionExclusionActivationTriggers ?? []);
    const [messageFilterExclusionDeactivationTriggers, setMessageFilterExclusionDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingLocation?.messageFilterRegularExpressionExclusionDeactivationTriggers ?? []);

    const [locationBindings, setLocationBindings] = useState<string[]>(existingLocation?.locationBindings ?? []);
    const [locationBindingRegexTriggers, setLocationBindingRegexTriggers] = useState<Record<string, string>>(existingLocation?.locationBindingRegularExpressionTriggers ?? {});
    const [characterBindings, setCharacterBindings] = useState<string[]>(existingLocation?.characterBindings ?? []);
    const [ownerBindings, setOwnerBindings] = useState<string[]>(existingLocation?.ownerBindings ?? []);
    const [globalWeight, setGlobalWeight] = useState<number>(existingLocation?.globalWeight ?? 1);
    const [characterWeights, setCharacterWeights] = useState<Record<string, number>>(existingLocation?.characterWeights ?? {});
    const [useBase64Encoding, setUseBase64Encoding] = useState<boolean>(existingLocation?.useBase64Encoding ?? false);
    const [bgImageRegexTriggers, setBgImageRegexTriggers] = useState<Record<number, string>>(existingLocation?.backgroundImageRegularExpressionActivationTriggers ?? {});
    const [bgImageWeights, setBgImageWeights] = useState<Record<number, number>>(existingLocation?.backgroundImageWeights ?? {});
    const [playAudioTrackOnEnterWeights, setPlayAudioTrackOnEnterWeights] = useState<Record<string, number>>(existingLocation?.playAudioTrackOnEnterWeights ?? {});
    const [messageFilterNonCoLocatedParticipants, setMessageFilterNonCoLocatedParticipants] = useState<boolean>(existingLocation?.messageFilterNonCoLocatedParticipants ?? false);
    const [latitude, setLatitude] = useState<string>(existingLocation?.latitude != null ? String(existingLocation.latitude) : '');
    const [longitude, setLongitude] = useState<string>(existingLocation?.longitude != null ? String(existingLocation.longitude) : '');
    const [locationDistances, setLocationDistances] = useState<Record<string, number>>(existingLocation?.locationDistances ?? {});

    const [bgImageTestTexts, setBgImageTestTexts] = useState<Record<number, string>>({});
    const [bgImageTestResults, setBgImageTestResults] = useState<Record<number, boolean | null>>({});

    const [errors, setErrors] = useState<Record<string, any>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [textNumberOfTokens, setTextNumberOfTokens] = useState(0);
    const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const selectedModel = useSessionStore.getState().selectedModel;
        const runningModels = useSessionStore.getState().runningModels;
        if (selectedModel) {
            tokenEngine.setRunningModels(runningModels);
            tokenEngine.setContext(selectedModel);
        }
        const initialText = existingLocation?.text || '';
        if (!initialText.trim()) return;
        const rafId = requestAnimationFrame(() => {
            tokenEngine.countTokens(initialText).then(count => setTextNumberOfTokens(count));
        });
        return () => cancelAnimationFrame(rafId);
    }, [existingLocation]);

    useEffect(() => {
        let cancelled = false;
        const debounceRef = tokenDebounceRef.current;
        if (debounceRef) clearTimeout(debounceRef);
        tokenDebounceRef.current = setTimeout(async () => {
            const count = await tokenEngine.countTokens(text);
            if (!cancelled) setTextNumberOfTokens(count);
        }, 400);
        return () => { cancelled = true; const ref = tokenDebounceRef.current; if (ref) clearTimeout(ref); };
    }, [text]);

    const validate = (): boolean => {
        const newErrors: Record<string, any> = {};
        if (!name.trim()) newErrors.name = 'Name is required.';

        const hasText = text.trim().length > 0;
        const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;
        if (!hasText && !hasImages) {
            newErrors.text = 'Either text or images are required.';
            newErrors.images = 'Either text or images are required.';
        }

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
        validateTriggers(regexExclusionActivationTriggers, 'exclusionActivationRegex');
        validateTriggers(regexExclusionDeactivationTriggers, 'exclusionDeactivationRegex');
        validateTriggers(messageFilterActivationTriggers, 'messageFilterRegex');
        validateTriggers(messageFilterDeactivationTriggers, 'messageFilterDeactivationRegex');
        validateTriggers(messageFilterExclusionActivationTriggers, 'messageFilterExclusionActivationRegex');
        validateTriggers(messageFilterExclusionDeactivationTriggers, 'messageFilterExclusionDeactivationRegex');

        const bindingRegexErrors: Record<string, string> = {};
        for (const [locId, pattern] of Object.entries(locationBindingRegexTriggers)) {
            if (pattern.trim()) {
                try { new RegExp(pattern); } catch { bindingRegexErrors[locId] = 'Invalid regex'; }
            }
        }
        if (Object.keys(bindingRegexErrors).length > 0) newErrors.bindingRegex = bindingRegexErrors;

        const bgImageRegexErrors: Record<number, string> = {};
        for (const [idxStr, pattern] of Object.entries(bgImageRegexTriggers)) {
            if (pattern.trim()) {
                try { new RegExp(pattern); } catch { bgImageRegexErrors[Number(idxStr)] = 'Invalid regex'; }
            }
        }
        if (Object.keys(bgImageRegexErrors).length > 0) newErrors.bgImageRegex = bgImageRegexErrors;

        if (latitude.trim()) {
            const lat = Number(latitude);
            if (Number.isNaN(lat) || lat < -90 || lat > 90) newErrors.latitude = 'Latitude must be between -90 and 90.';
        }
        if (longitude.trim()) {
            const lng = Number(longitude);
            if (Number.isNaN(lng) || lng < -180 || lng > 180) newErrors.longitude = 'Longitude must be between -180 and 180.';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0 && valid;
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
            setImagePreviews(prev => [...prev, ...files.map(file => URL.createObjectURL(file))]);
            if (errors.images) setErrors(prev => ({ ...prev, images: undefined }));
        }
        e.target.value = '';
    };

    const handleRemoveImage = (index: number) => {
        setImageFiles(prev => prev.filter((_, i) => i !== index));
        if (!imagePreviews[index].startsWith('data:image')) URL.revokeObjectURL(imagePreviews[index]);
        setImagePreviews(prev => prev.filter((_, i) => i !== index));
        setBgImageRegexTriggers(prev => {
            const next: Record<number, string> = {};
            for (const [k, v] of Object.entries(prev)) { const ki = Number(k); if (ki < index) next[ki] = v; else if (ki > index) next[ki - 1] = v; }
            return next;
        });
        setBgImageWeights(prev => {
            const next: Record<number, number> = {};
            for (const [k, v] of Object.entries(prev)) { const ki = Number(k); if (ki < index) next[ki] = v; else if (ki > index) next[ki - 1] = v; }
            return next;
        });
        setBgImageTestTexts(prev => {
            const next: Record<number, string> = {};
            for (const [k, v] of Object.entries(prev)) { const ki = Number(k); if (ki < index) next[ki] = v; else if (ki > index) next[ki - 1] = v; }
            return next;
        });
        setBgImageTestResults(prev => {
            const next: Record<number, boolean | null> = {};
            for (const [k, v] of Object.entries(prev)) { const ki = Number(k); if (ki < index) next[ki] = v; else if (ki > index) next[ki - 1] = v; }
            return next;
        });
    };

    const buildLocationFromForm = async (isNewClone: boolean): Promise<Location | null> => {
        if (!validate()) return null;

        let finalImageFilenames: string[] | undefined = isNewClone ? [] : (existingLocation?.images || []);
        if (imageFiles.length > 0) {
            setIsUploading(true);
            try {
                const uploadedFilenames = await Promise.all(imageFiles.map(file => uploadLocationImage(file)));
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

        const filterTriggers = (trs: RegularExpressionTrigger[]) => {
            const filtered = trs.filter(t => t.trigger.trim());
            return filtered.length > 0 ? filtered : undefined;
        };

        return {
            id: isNewClone ? uuidv4() : (existingLocation?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            text: text.trim() || undefined,
            images: finalImageFilenames && finalImageFilenames.length > 0 ? finalImageFilenames : undefined,
            regularExpressionActivationTriggers: filterTriggers(regexActivationTriggers),
            regularExpressionExclusionActivationTriggers: filterTriggers(regexExclusionActivationTriggers),
            regularExpressionExclusionDeactivationTriggers: filterTriggers(regexExclusionDeactivationTriggers),
            backgroundImageRegularExpressionActivationTriggers: Object.keys(bgImageRegexTriggers).length > 0 ? bgImageRegexTriggers : {},
            backgroundImageWeights: Object.keys(bgImageWeights).length > 0 ? bgImageWeights : {},
            playAudioTrackOnEnterWeights: Object.keys(playAudioTrackOnEnterWeights).length > 0 ? playAudioTrackOnEnterWeights : undefined,
            locationBindings: locationBindings.length > 0 ? locationBindings : [],
            locationBindingRegularExpressionTriggers: Object.keys(locationBindingRegexTriggers).length > 0 ? locationBindingRegexTriggers : undefined,
            characterBindings: characterBindings.length > 0 ? characterBindings : [],
            ownerBindings: ownerBindings.length > 0 ? ownerBindings : [],
            globalWeight,
            characterWeights: Object.keys(characterWeights).length > 0 ? characterWeights : {},
            latitude: parsedLat != null && !Number.isNaN(parsedLat) ? parsedLat : 0,
            longitude: parsedLng != null && !Number.isNaN(parsedLng) ? parsedLng : 0,
            locationDistances: Object.keys(locationDistances).length > 0 ? locationDistances : {},
            messageFilterNonCoLocatedParticipants: messageFilterNonCoLocatedParticipants || undefined,
            messageFilterRegularExpressionActivationTriggers: filterTriggers(messageFilterActivationTriggers),
            messageFilterRegularExpressionDeactivationTriggers: filterTriggers(messageFilterDeactivationTriggers),
            messageFilterRegularExpressionExclusionActivationTriggers: filterTriggers(messageFilterExclusionActivationTriggers),
            messageFilterRegularExpressionExclusionDeactivationTriggers: filterTriggers(messageFilterExclusionDeactivationTriggers),
            useBase64Encoding,
            firstCreatedTimestamp: isNewClone ? now : (existingLocation?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => { const location = await buildLocationFromForm(false); if (!location) return; onSave(location); onClose(); };
    const handleClone = async () => { const cloned = await buildLocationFromForm(true); if (!cloned) return; onSave(cloned); onClose(); };

    const hasText = text.trim().length > 0;
    const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;
    const textRequiresAsterisk = !hasImages;
    const imagesRequiresAsterisk = !hasText;

    const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);
    const getLocationById = (id: string) => allLocations.find(l => l.id === id);
    const getAudioTrackById = (id: string) => allAudioTracks.find(t => t.id === id);
    const availableLocationsForBinding = allLocations.filter(l => l.id !== existingLocation?.id);
    const availableLocationsForDistance = allLocations.filter(l => l.id !== existingLocation?.id);

    const locationTabs: { id: LocationTabId; label: string; icon: string }[] = [
        { id: 'general', label: 'General', icon: '📝' },
        { id: 'movement', label: 'Movement', icon: '🚶' },
        { id: 'filter', label: 'Filter', icon: '🚫' },
        { id: 'bindings', label: 'Bindings', icon: '🔗' },
    ];

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

                {/* Tab Bar */}
                <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                    {locationTabs.map(tab => (
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

                            {/* Background Image Settings */}
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
                                                        <input type="number" step="0.1" min="0" value={currentWeight} onChange={(e) => setBgImageWeights(prev => ({ ...prev, [index]: Math.max(0, Number(e.target.value) || 0) }))} className="editor-input context-input-small" style={{ width: '70px' }} />
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                                        <label className="editor-label editor-label-small">Regex Trigger (optional)</label>
                                                        <input type="text" value={currentRegex} onChange={(e) => {
                                                            const val = e.target.value;
                                                            setBgImageRegexTriggers(prev => { const next = { ...prev }; if (val.trim()) next[index] = val; else delete next[index]; return next; });
                                                            setBgImageTestResults(prev => ({ ...prev, [index]: null }));
                                                            if (errors.bgImageRegex) setErrors(prev => { const next = { ...prev, bgImageRegex: { ...(prev.bgImageRegex || {}) } }; if (next.bgImageRegex) { delete next.bgImageRegex[index]; if (Object.keys(next.bgImageRegex).length === 0) next.bgImageRegex = {}; } return next; });
                                                        }} className={`editor-input context-mono-input ${hasRegexError ? 'error' : ''}`} placeholder="No trigger (sampled by weight)" style={{ fontSize: '0.7rem' }} />
                                                        {hasRegexError && <div className="editor-error-message" style={{ fontSize: '0.6rem' }}>{hasRegexError}</div>}
                                                    </div>
                                                </div>
                                                {currentRegex.trim() && (
                                                    <div style={{ marginTop: '6px' }}>
                                                        <div className="context-test-row">
                                                            <input type="text" value={testText} onChange={(e) => { setBgImageTestTexts(prev => ({ ...prev, [index]: e.target.value })); setBgImageTestResults(prev => ({ ...prev, [index]: null })); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTestBgImageRegex(index); } }} className="editor-input context-test-input" placeholder="Test user message..." style={{ fontSize: '0.7rem' }} />
                                                            <button type="button" onClick={() => handleTestBgImageRegex(index)} className="editor-button editor-button-save context-test-button" disabled={!testText.trim()}>Test</button>
                                                        </div>
                                                        {testResult !== null && (<div className={`context-test-result ${testResult ? 'editor-success-message' : 'editor-error-message'}`} style={{ fontSize: '0.6rem' }}>{testResult ? '✅ Matches!' : '❌ No match'}</div>)}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Audio On Enter */}
                            <div className="editor-section">
                                <span className="editor-section-title">Audio On Enter</span>
                                <div className="context-binding-hint">When a character enters this location, an audio track is randomly selected by weight. Only tracks listed here will play. Empty = no automatic audio.</div>
                                <div className="context-character-binding-list">
                                    {Object.entries(playAudioTrackOnEnterWeights).map(([trackId, weight]) => {
                                        const track = getAudioTrackById(trackId);
                                        if (!track) return null;
                                        return (
                                            <div key={trackId} className="context-character-binding-chip" style={{ gap: '6px' }}>
                                                <span className="context-character-binding-name">🔊 {track.filename || track.name}</span>
                                                <input type="number" step="0.1" min="0" value={weight} onChange={(e) => setPlayAudioTrackOnEnterWeights(prev => ({ ...prev, [trackId]: Math.max(0, Number(e.target.value) || 0) }))} className="editor-input" style={{ width: '60px', padding: '2px 4px', fontSize: '0.75rem' }} />
                                                <button type="button" onClick={() => setPlayAudioTrackOnEnterWeights(prev => { const next = { ...prev }; delete next[trackId]; return next; })} className="context-character-binding-remove" title="Remove audio track">×</button>
                                            </div>
                                        );
                                    })}
                                </div>
                                <select onChange={(e) => { const val = e.target.value; if (val && !(val in playAudioTrackOnEnterWeights)) setPlayAudioTrackOnEnterWeights(prev => ({ ...prev, [val]: 1 })); e.target.value = ''; }} className="editor-select" defaultValue="">
                                    <option value="" disabled>+ Add audio track on enter</option>
                                    {allAudioTracks.filter(t => !(t.id in playAudioTrackOnEnterWeights)).map(t => (<option key={t.id} value={t.id}>{t.filename || t.name}</option>))}
                                </select>
                            </div>

                            {/* Coordinates */}
                            <div className="editor-section">
                                <span className="editor-section-title">Coordinates</span>
                                <div className="context-binding-hint">Real-world latitude and longitude. Used for local weather when enabled. Leave empty to fall back to browser geolocation.</div>
                                <div className="editor-row" style={{ gap: '12px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label className="editor-label editor-label-small">Latitude</label>
                                        <input type="number" step="any" min="-90" max="90" value={latitude} onChange={(e) => { setLatitude(e.target.value); if (errors.latitude) setErrors(prev => ({ ...prev, latitude: undefined })); }} className={`editor-input context-input-small ${errors.latitude ? 'error' : ''}`} placeholder="-90 to 90" />
                                        {errors.latitude && <div className="editor-error-message" style={{ fontSize: '0.6rem' }}>{errors.latitude}</div>}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label className="editor-label editor-label-small">Longitude</label>
                                        <input type="number" step="any" min="-180" max="180" value={longitude} onChange={(e) => { setLongitude(e.target.value); if (errors.longitude) setErrors(prev => ({ ...prev, longitude: undefined })); }} className={`editor-input context-input-small ${errors.longitude ? 'error' : ''}`} placeholder="-180 to 180" />
                                        {errors.longitude && <div className="editor-error-message" style={{ fontSize: '0.6rem' }}>{errors.longitude}</div>}
                                    </div>
                                </div>
                            </div>

                            {/* Encoding */}
                            <div className="context-field-group">
                                <label className="editor-checkbox-label">
                                    <input type="checkbox" checked={useBase64Encoding} onChange={(e) => setUseBase64Encoding(e.target.checked)} className="editor-checkbox-input" />
                                    <span>Encode text as Base64</span>
                                </label>
                                <div className="context-checkbox-hint">Encode location text as base64 in the prompt. Prevents the model from treating descriptions as instructions.</div>
                            </div>
                        </>
                    )}

                    {/* ─── MOVEMENT TAB ─── */}
                    {activeTab === 'movement' && (
                        <>
                            {/* Movement Triggers */}
                            <div className="editor-section">
                                <span className="editor-section-title">Movement Triggers</span>
                                <RegularExpressionTriggerEditor
                                    label="Activation"
                                    description="The user moves to this location when their message matches any trigger."
                                    triggers={regexActivationTriggers}
                                    onChange={setRegexActivationTriggers}
                                    error={errors.regex}
                                    placeholder="/enters? (the )?forest/i"
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
                                    placeholder="/wake up|leave dream/i"
                                />
                            </div>

                            {/* Movement Weights */}
                            <div className="editor-section">
                                <span className="editor-section-title">Movement Weights</span>
                                <div className="context-field-group">
                                    <label className="editor-label editor-label-small">Global Weight</label>
                                    <input type="number" step="0.1" min="0" value={globalWeight} onChange={(e) => setGlobalWeight(Math.max(0, Number(e.target.value) || 0))} className="editor-input context-input-small" />
                                    <div className="context-field-hint">Base likelihood for any character to enter. Higher = more likely.</div>
                                </div>
                                <div className="context-field-group">
                                    <span className="editor-label editor-label-small">Character-Specific Weights</span>
                                    <div className="context-binding-hint">Override global weight per character. Characters not listed use the global weight.</div>
                                    <div className="context-character-binding-list">
                                        {Object.entries(characterWeights).map(([charId, weight]) => { const char = getCharacterById(charId); if (!char) return null; return (<div key={charId} className="context-character-binding-chip" style={{ gap: '6px' }}><span className="context-character-binding-name">{char.name}</span><input type="number" step="0.1" min="0" value={weight} onChange={(e) => setCharacterWeights(prev => ({ ...prev, [charId]: Math.max(0, Number(e.target.value) || 0) }))} className="editor-input" style={{ width: '60px', padding: '2px 4px', fontSize: '0.75rem' }} /><button type="button" onClick={() => setCharacterWeights(prev => { const next = { ...prev }; delete next[charId]; return next; })} className="context-character-binding-remove" title="Remove weight override">×</button></div>); })}
                                    </div>
                                    <select onChange={(e) => { const val = e.target.value; if (val && !(val in characterWeights)) setCharacterWeights(prev => ({ ...prev, [val]: globalWeight })); e.target.value = ""; }} className="editor-select" defaultValue="">
                                        <option value="" disabled>+ Add character weight override</option>
                                        {allCharacters.filter(c => !(c.id in characterWeights)).map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                    </select>
                                </div>
                            </div>

                            {/* Location Distances */}
                            <div className="editor-section">
                                <span className="editor-section-title">Location Distances</span>
                                <div className="context-binding-hint">Manual distance overrides in km between this location and others. Used by the map tool. Empty = auto-calculated from coordinates.</div>
                                <div className="context-character-binding-list">
                                    {Object.entries(locationDistances).map(([locId, distance]) => {
                                        const loc = getLocationById(locId);
                                        if (!loc) return null;
                                        return (
                                            <div key={locId} className="context-character-binding-chip" style={{ gap: '6px' }}>
                                                <span className="context-character-binding-name">{loc.name}</span>
                                                <input type="number" step="0.1" min="0" value={distance} onChange={(e) => setLocationDistances(prev => ({ ...prev, [locId]: Math.max(0, Number(e.target.value) || 0) }))} className="editor-input" style={{ width: '70px', padding: '2px 4px', fontSize: '0.75rem' }} />
                                                <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>km</span>
                                                <button type="button" onClick={() => setLocationDistances(prev => { const next = { ...prev }; delete next[locId]; return next; })} className="context-character-binding-remove" title="Remove distance override">×</button>
                                            </div>
                                        );
                                    })}
                                </div>
                                <select onChange={(e) => { const val = e.target.value; if (val && !(val in locationDistances)) setLocationDistances(prev => ({ ...prev, [val]: 0 })); e.target.value = ''; }} className="editor-select" defaultValue="">
                                    <option value="" disabled>+ Add distance to a location</option>
                                    {availableLocationsForDistance.filter(l => !(l.id in locationDistances)).map(l => (<option key={l.id} value={l.id}>{l.name}</option>))}
                                </select>
                            </div>
                        </>
                    )}

                    {/* ─── FILTER TAB ─── */}
                    {activeTab === 'filter' && (
                        <div className="editor-section" style={{ margin: 0, border: 'none', background: 'transparent', padding: 0 }}>
                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginBottom: '12px', textAlign: 'center' }}>
                                Control which chat history messages are visible to the AI when this location is active.
                            </div>

                            <div className="context-field-group" style={{ marginBottom: '16px' }}>
                                <label className="editor-checkbox-label">
                                    <input type="checkbox" checked={messageFilterNonCoLocatedParticipants} onChange={(e) => setMessageFilterNonCoLocatedParticipants(e.target.checked)} className="editor-checkbox-input" />
                                    <span>Filter Non-Co-Located Participants</span>
                                </label>
                                <div className="context-checkbox-hint">Hide messages from characters not currently at this location.</div>
                            </div>

                            <RegularExpressionTriggerEditor
                                label="Filter Activation"
                                description="Messages matching any trigger are hidden from AI at this location."
                                triggers={messageFilterActivationTriggers}
                                onChange={setMessageFilterActivationTriggers}
                                error={errors.messageFilterRegex}
                                placeholder="^\/ooc\s+|^\[.*\]$"
                            />
                            <RegularExpressionTriggerEditor
                                label="Filter Deactivation"
                                description="Stops filtering when any trigger matches."
                                triggers={messageFilterDeactivationTriggers}
                                onChange={setMessageFilterDeactivationTriggers}
                                error={errors.messageFilterDeactivationRegex}
                            />
                            <RegularExpressionTriggerEditor
                                label="Filter Exclusion Activation"
                                description="Overrides filter — keeps message visible."
                                triggers={messageFilterExclusionActivationTriggers}
                                onChange={setMessageFilterExclusionActivationTriggers}
                                error={errors.messageFilterExclusionActivationRegex}
                            />
                            <RegularExpressionTriggerEditor
                                label="Filter Exclusion Deactivation"
                                description="When filter exclusion stops being active."
                                triggers={messageFilterExclusionDeactivationTriggers}
                                onChange={setMessageFilterExclusionDeactivationTriggers}
                                error={errors.messageFilterExclusionDeactivationRegex}
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
                                    <div className="context-binding-hint">The user can only reach this location from these connected locations. Empty = reachable from anywhere.</div>
                                    <div className="context-character-binding-list">
                                        {locationBindings.map(id => {
                                            const loc = getLocationById(id);
                                            if (!loc) return null;
                                            return (
                                                <div key={id} className="context-character-binding-chip">
                                                    <span className="context-character-binding-name">{loc.name}</span>
                                                    <button type="button" onClick={() => { setLocationBindings(prev => prev.filter(lid => lid !== id)); setLocationBindingRegexTriggers(prev => { const next = { ...prev }; delete next[id]; return next; }); }} className="context-character-binding-remove" title="Remove binding">×</button>
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
                                                    <input type="text" value={currentRegex} onChange={(e) => {
                                                        const val = e.target.value;
                                                        setLocationBindingRegexTriggers(prev => { const next = { ...prev }; if (val.trim()) next[id] = val; else delete next[id]; return next; });
                                                        if (errors.bindingRegex) setErrors(prev => { const next = { ...prev, bindingRegex: { ...(prev.bindingRegex || {}) } }; if (next.bindingRegex) { delete next.bindingRegex[id]; if (Object.keys(next.bindingRegex).length === 0) next.bindingRegex = {}; } return next; });
                                                    }} className={`editor-input context-mono-input ${hasError ? 'error' : ''}`} placeholder="Unconditional (no regex)" style={{ fontSize: '0.75rem' }} />
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
                                        {characterBindings.map(id => { const char = getCharacterById(id); if (!char) return null; return (<div key={id} className="context-character-binding-chip"><span className="context-character-binding-name">{char.name}</span><button type="button" onClick={() => setCharacterBindings(prev => prev.filter(cid => cid !== id))} className="context-character-binding-remove" title="Remove binding">×</button></div>); })}
                                    </div>
                                    <select onChange={(e) => { const val = e.target.value; if (val && !characterBindings.includes(val)) setCharacterBindings(prev => [...prev, val]); e.target.value = ""; }} className="editor-select" defaultValue="">
                                        <option value="" disabled>+ Bind to a character</option>
                                        {allCharacters.filter(c => !characterBindings.includes(c.id)).map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                    </select>
                                </div>
                            </div>

                            {/* Owner Bindings */}
                            <div className="editor-section">
                                <span className="editor-section-title">Owner Bindings</span>
                                <div className="context-field-group">
                                    <div className="context-binding-hint">Characters that own this location. Ownership grants exclusivity bonuses during turn selection. Empty = no owners.</div>
                                    <div className="context-character-binding-list">
                                        {ownerBindings.map(id => { const char = getCharacterById(id); if (!char) return null; return (<div key={id} className="context-character-binding-chip"><span className="context-character-binding-name">👑 {char.name}</span><button type="button" onClick={() => setOwnerBindings(prev => prev.filter(cid => cid !== id))} className="context-character-binding-remove" title="Remove owner">×</button></div>); })}
                                    </div>
                                    <select onChange={(e) => { const val = e.target.value; if (val && !ownerBindings.includes(val)) setOwnerBindings(prev => [...prev, val]); e.target.value = ""; }} className="editor-select" defaultValue="">
                                        <option value="" disabled>+ Add an owner</option>
                                        {allCharacters.filter(c => !ownerBindings.includes(c.id)).map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
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