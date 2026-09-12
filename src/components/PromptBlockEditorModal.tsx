// src/components/PromptBlockEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { PromptBlock, Character, Context, Location, regularExpressionContext, regularExpressionTarget } from '../types';
import { uploadPromptBlockImage } from '../hooks/storage';
import { v4 as uuidv4 } from 'uuid';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import './main.css';

const tokenEngine = getLanguageModelEngine();

interface PromptBlockEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (block: PromptBlock) => void;
    existingBlock?: PromptBlock | null;
    allCharacters?: Character[];
    allContexts?: Context[];
    allLocations?: Location[];
    runtimePort?: number;
}

export function PromptBlockEditorModal({
    isOpen,
    onClose,
    onSave,
    existingBlock,
    allCharacters = [],
    allContexts = [],
    allLocations = [],
    runtimePort,
}: PromptBlockEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [textContent, setTextContent] = useState('');
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    const [regexActivationTrigger, setRegexActivationTrigger] = useState('');
    const [regexDeactivationTrigger, setRegexDeactivationTrigger] = useState('');
    const [regexContext, setRegexContext] = useState<regularExpressionContext>('global');
    const [regexTarget, setRegexTarget] = useState<regularExpressionTarget>('everyone');

    const [activationTestText, setActivationTestText] = useState('');
    const [activationTestResult, setActivationTestResult] = useState<boolean | null>(null);

    const [deactivationTestText, setDeactivationTestText] = useState('');
    const [deactivationTestResult, setDeactivationTestResult] = useState<boolean | null>(null);

    const [characterBindings, setCharacterBindings] = useState<string[]>([]);
    const [contextBindings, setContextBindings] = useState<string[]>([]);
    const [locationBindings, setLocationBindings] = useState<string[]>([]);

    const [errors, setErrors] = useState<{ name?: string; textContent?: string; regex?: string; deactivationRegex?: string; images?: string }>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [textTokenCount, setTextTokenCount] = useState(0);
    const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounced token count
    useEffect(() => {
        let cancelled = false;
        if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
        tokenDebounceRef.current = setTimeout(async () => {
            const count = await tokenEngine.countTokens(textContent, runtimePort ? { runtimePort } : undefined);
            if (!cancelled) setTextTokenCount(count);
        }, 400);
        return () => {
            cancelled = true;
            if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
        };
    }, [textContent, runtimePort]);

    // Load / reset form state
    useEffect(() => {
        if (!isOpen) return;

        if (existingBlock) {
            setName(existingBlock.name || '');
            setDescription(existingBlock.description || '');
            setTextContent(existingBlock.textContent ?? '');

            if (existingBlock.images && existingBlock.images.length > 0) {
                const previews = existingBlock.images.map(img => `/user_data/prompt_block_data/${img}`);
                setImagePreviews(previews);
            } else {
                setImagePreviews([]);
            }

            setImageFiles([]);
            setRegexActivationTrigger(existingBlock.regularExpressionActivationTrigger || '');
            setRegexDeactivationTrigger(existingBlock.regularExpressionDeactivationTrigger || '');
            setRegexContext(existingBlock.regularExpressionContext || 'global');
            setRegexTarget(existingBlock.regularExpressionTarget || 'everyone');
            setCharacterBindings(existingBlock.characterBindings ?? []);
            setContextBindings(existingBlock.contextBindings ?? []);
            setLocationBindings(existingBlock.locationBindings ?? []);
        } else {
            setName('');
            setDescription('');
            setTextContent('');
            setImageFiles([]);
            setImagePreviews([]);
            setRegexActivationTrigger('');
            setRegexDeactivationTrigger('');
            setRegexContext('global');
            setRegexTarget('everyone');
            setCharacterBindings([]);
            setContextBindings([]);
            setLocationBindings([]);
        }

        setErrors({});
        setActivationTestText('');
        setActivationTestResult(null);
        setDeactivationTestText('');
        setDeactivationTestResult(null);
    }, [isOpen, existingBlock]);

    const validate = (): boolean => {
        const newErrors: typeof errors = {};
        if (!name.trim()) newErrors.name = 'Name is required.';

        const hasText = textContent.trim().length > 0;
        const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;
        if (!hasText && !hasImages) {
            newErrors.textContent = 'Either text or images are required.';
            newErrors.images = 'Either text or images are required.';
        }

        if (regexActivationTrigger.trim()) {
            try { new RegExp(regexActivationTrigger); } catch { newErrors.regex = 'Invalid activation regular expression.'; }
        }
        if (regexDeactivationTrigger.trim()) {
            try { new RegExp(regexDeactivationTrigger); } catch { newErrors.deactivationRegex = 'Invalid deactivation regular expression.'; }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // --- Regex testers ---
    const handleTestActivationRegex = () => {
        if (!regexActivationTrigger.trim() || !activationTestText.trim()) { setActivationTestResult(null); return; }
        try {
            setActivationTestResult(new RegExp(regexActivationTrigger).test(activationTestText));
        } catch {
            setActivationTestResult(null);
            setErrors(prev => ({ ...prev, regex: 'Invalid activation regular expression.' }));
        }
    };

    const handleTestDeactivationRegex = () => {
        if (!regexDeactivationTrigger.trim() || !deactivationTestText.trim()) { setDeactivationTestResult(null); return; }
        try {
            setDeactivationTestResult(new RegExp(regexDeactivationTrigger).test(deactivationTestText));
        } catch {
            setDeactivationTestResult(null);
            setErrors(prev => ({ ...prev, deactivationRegex: 'Invalid deactivation regular expression.' }));
        }
    };

    // --- Image handling ---
    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            const files = Array.from(e.target.files);
            setImageFiles(prev => [...prev, ...files]);
            setImagePreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
            if (errors.images) setErrors(prev => ({ ...prev, images: undefined }));
        }
        e.target.value = '';
    };

    const handleRemoveImage = (index: number) => {
        setImageFiles(prev => prev.filter((_, i) => i !== index));
        if (!imagePreviews[index].startsWith('data:image')) URL.revokeObjectURL(imagePreviews[index]);
        setImagePreviews(prev => prev.filter((_, i) => i !== index));
    };

    // --- Build & save ---
    const buildBlockFromForm = async (isNewClone: boolean): Promise<PromptBlock | null> => {
        if (!validate()) return null;

        let finalImageFilenames: string[] = isNewClone ? [] : (existingBlock?.images ?? []);

        if (imageFiles.length > 0) {
            setIsUploading(true);
            try {
                const uploaded = await Promise.all(imageFiles.map(f => uploadPromptBlockImage(f)));
                finalImageFilenames = [...(isNewClone ? [] : (existingBlock?.images ?? [])), ...uploaded];
            } catch (error) {
                console.error('Failed to upload images:', error);
                alert('Failed to upload images. Prompt block not saved.');
                setIsUploading(false);
                return null;
            }
            setIsUploading(false);
        }

        const now = Date.now();

        return {
            id: isNewClone ? uuidv4() : (existingBlock?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            textContent: textContent.trim(),
            images: finalImageFilenames.length > 0 ? finalImageFilenames : [],
            regularExpressionActivationTrigger: regexActivationTrigger.trim() || undefined,
            regularExpressionDeactivationTrigger: regexDeactivationTrigger.trim() || undefined,
            regularExpressionContext: regexContext,
            regularExpressionTarget: regexTarget,
            characterBindings: characterBindings.length > 0 ? characterBindings : [],
            contextBindings: contextBindings.length > 0 ? contextBindings : [],
            locationBindings: locationBindings.length > 0 ? locationBindings : [],
            firstCreatedTimestamp: isNewClone ? now : (existingBlock?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => {
        const block = await buildBlockFromForm(false);
        if (!block) return;
        onSave(block);
        onClose();
    };

    const handleClone = async () => {
        const cloned = await buildBlockFromForm(true);
        if (!cloned) return;
        onSave(cloned);
        onClose();
    };

    if (!isOpen) return null;

    const hasText = textContent.trim().length > 0;
    const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;
    const textRequiresAsterisk = !hasImages;
    const imagesRequiresAsterisk = !hasText;

    const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);
    const getContextById = (id: string) => allContexts.find(c => c.id === id);
    const getLocationById = (id: string) => allLocations.find(l => l.id === id);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingBlock ? 'Edit Prompt Block' : 'Create New Prompt Block'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {existingBlock && <button type="button" className="editor-button editor-button-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Saving...' : 'Save'}</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Name */}
                    <div className="context-field-group">
                        <label className="editor-label">Name <span className="context-required-asterisk">*</span></label>
                        <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} className={`editor-input ${errors.name ? 'error' : ''}`} placeholder="e.g., Combat Rules, Magic System" />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    {/* Description */}
                    <div className="context-field-group">
                        <label className="editor-label">Description</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea" placeholder="Brief description (display only)" rows={2} />
                    </div>

                    {/* Text Content */}
                    <div className="context-field-group">
                        <label className="editor-label">Text Content {textRequiresAsterisk && <span className="context-required-asterisk">*</span>}</label>
                        <textarea value={textContent} onChange={(e) => { setTextContent(e.target.value); if (errors.textContent) setErrors({ ...errors, textContent: undefined }); }} className={`editor-textarea ${errors.textContent ? 'error' : ''}`} placeholder="Prompt block text content (optional if using images)" rows={6} />
                        <div className="context-token-count">~{textTokenCount} token(s)</div>
                        {errors.textContent && <div className="editor-error-message">{errors.textContent}</div>}
                    </div>

                    {/* Images */}
                    <div className="context-field-group">
                        <label className="editor-label">Images {imagesRequiresAsterisk && <span className="context-required-asterisk">*</span>}</label>
                        <div className="editor-image-grid">
                            {imagePreviews.map((preview, index) => (
                                <div key={index} className="editor-image-square active">
                                    <img src={preview} alt={`Block image ${index + 1}`} />
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

                    {/* Regular Expression */}
                    <div className="editor-section">
                        <span className="editor-section-title">Regular Expression</span>

                        <div className="editor-row-full">
                            <div>
                                <label className="editor-label editor-label-small">Activation Trigger</label>
                                <input type="text" value={regexActivationTrigger} onChange={(e) => { setRegexActivationTrigger(e.target.value); if (errors.regex) setErrors({ ...errors, regex: undefined }); setActivationTestResult(null); }} className={`editor-input context-mono-input ${errors.regex ? 'error' : ''}`} placeholder="/pattern/i" />
                                {errors.regex && <div className="editor-error-message">{errors.regex}</div>}
                            </div>
                        </div>

                        {regexActivationTrigger.trim() && (
                            <div className="context-field-group">
                                <label className="editor-label editor-label-small">Test Activation Pattern</label>
                                <div className="context-test-row">
                                    <input type="text" value={activationTestText} onChange={(e) => { setActivationTestText(e.target.value); setActivationTestResult(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTestActivationRegex(); } }} className="editor-input context-test-input" placeholder="Test text" />
                                    <button type="button" onClick={handleTestActivationRegex} className="editor-button editor-button-save context-test-button" disabled={!activationTestText.trim()}>Test</button>
                                </div>
                                {activationTestResult !== null && (
                                    <div className={`context-test-result ${activationTestResult ? 'editor-success-message' : 'editor-error-message'}`}>
                                        {activationTestResult ? '✅ Activation matches!' : '❌ Activation does not match'}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="editor-row-full" style={{ marginTop: '8px' }}>
                            <div>
                                <label className="editor-label editor-label-small">Deactivation Trigger</label>
                                <input type="text" value={regexDeactivationTrigger} onChange={(e) => { setRegexDeactivationTrigger(e.target.value); if (errors.deactivationRegex) setErrors({ ...errors, deactivationRegex: undefined }); setDeactivationTestResult(null); }} className={`editor-input context-mono-input ${errors.deactivationRegex ? 'error' : ''}`} placeholder="/peace|calm/i" />
                                {errors.deactivationRegex && <div className="editor-error-message">{errors.deactivationRegex}</div>}
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Optional. Deactivates this block when matched.</div>
                            </div>
                        </div>

                        {regexDeactivationTrigger.trim() && (
                            <div className="context-field-group">
                                <label className="editor-label editor-label-small">Test Deactivation Pattern</label>
                                <div className="context-test-row">
                                    <input type="text" value={deactivationTestText} onChange={(e) => { setDeactivationTestText(e.target.value); setDeactivationTestResult(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTestDeactivationRegex(); } }} className="editor-input context-test-input" placeholder="Test text" />
                                    <button type="button" onClick={handleTestDeactivationRegex} className="editor-button editor-button-save context-test-button" disabled={!deactivationTestText.trim()}>Test</button>
                                </div>
                                {deactivationTestResult !== null && (
                                    <div className={`context-test-result ${deactivationTestResult ? 'editor-success-message' : 'editor-error-message'}`}>
                                        {deactivationTestResult ? '✅ Deactivation matches!' : '❌ Deactivation does not match'}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="editor-row" style={{ marginTop: '8px' }}>
                            <div>
                                <label className="editor-label editor-label-small">Context</label>
                                <select value={regexContext} onChange={(e) => setRegexContext(e.target.value as regularExpressionContext)} className="editor-select" disabled={!regexActivationTrigger.trim()}>
                                    <option value="global">Global</option><option value="local">Local</option><option value="previous">Previous</option>
                                </select>
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Target</label>
                                <select value={regexTarget} onChange={(e) => setRegexTarget(e.target.value as regularExpressionTarget)} className="editor-select" disabled={!regexActivationTrigger.trim()}>
                                    <option value="everyone">Everyone</option><option value="listener">Listener</option><option value="self">Self</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Bindings */}
                    <div className="editor-section">
                        <span className="editor-section-title">Bindings</span>

                        {/* Character Bindings */}
                        <div className="context-field-group">
                            <span className="editor-label editor-label-small">Character Bindings</span>
                            <div className="context-binding-hint">Only inject when these characters are present. Empty = all characters.</div>
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
                            <select onChange={(e) => { const val = e.target.value; if (val && !characterBindings.includes(val)) setCharacterBindings(prev => [...prev, val]); e.target.value = ''; }} className="editor-select" defaultValue="">
                                <option value="" disabled>+ Bind to a character</option>
                                {allCharacters.filter(c => !characterBindings.includes(c.id)).map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                            </select>
                        </div>

                        {/* Context Bindings */}
                        <div className="context-field-group">
                            <span className="editor-label editor-label-small">Context Bindings</span>
                            <div className="context-binding-hint">Only inject when these contexts are active. Empty = always.</div>
                            <div className="context-character-binding-list">
                                {contextBindings.map(id => {
                                    const context = getContextById(id);
                                    if (!context) return null;
                                    return (
                                        <div key={id} className="context-character-binding-chip">
                                            <span className="context-character-binding-name">{context.name}</span>
                                            <button type="button" onClick={() => setContextBindings(prev => prev.filter(cid => cid !== id))} className="context-character-binding-remove" title="Remove binding">×</button>
                                        </div>
                                    );
                                })}
                            </div>
                            <select onChange={(e) => { const val = e.target.value; if (val && !contextBindings.includes(val)) setContextBindings(prev => [...prev, val]); e.target.value = ''; }} className="editor-select" defaultValue="">
                                <option value="" disabled>+ Bind to a context</option>
                                {allContexts.filter(c => !contextBindings.includes(c.id)).map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                            </select>
                        </div>

                        {/* Location Bindings */}
                        <div className="context-field-group">
                            <span className="editor-label editor-label-small">Location Bindings</span>
                            <div className="context-binding-hint">Only inject at these locations. Empty = all locations.</div>
                            <div className="context-character-binding-list">
                                {locationBindings.map(id => {
                                    const loc = getLocationById(id);
                                    if (!loc) return null;
                                    return (
                                        <div key={id} className="context-character-binding-chip">
                                            <span className="context-character-binding-name">{loc.name}</span>
                                            <button type="button" onClick={() => setLocationBindings(prev => prev.filter(lid => lid !== id))} className="context-character-binding-remove" title="Remove binding">×</button>
                                        </div>
                                    );
                                })}
                            </div>
                            <select onChange={(e) => { const val = e.target.value; if (val && !locationBindings.includes(val)) setLocationBindings(prev => [...prev, val]); e.target.value = ''; }} className="editor-select" defaultValue="">
                                <option value="" disabled>+ Bind to a location</option>
                                {allLocations.filter(l => !locationBindings.includes(l.id)).map(l => (<option key={l.id} value={l.id}>{l.name}</option>))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}