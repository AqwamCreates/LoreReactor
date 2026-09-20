// src/components/PromptBlockEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { PromptBlock, Character, Context, Location, RegularExpressionTrigger } from '../types';
import { uploadPromptBlockImage } from '../storage/serverStorage';
import { v4 as uuidv4 } from 'uuid';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { useSessionStore } from '../hooks/useSessionStore';
import { RegularExpressionTriggerEditor } from './RegularExpressionTriggerEditor';
import '../main.css';

const tokenEngine = getLanguageModelEngine();

interface PromptBlockEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (block: PromptBlock) => void;
    existingBlock?: PromptBlock | null;
    allCharacters?: Character[];
    allContexts?: Context[];
    allLocations?: Location[];
}

type PromptBlockTabId = 'general' | 'detection' | 'filter' | 'bindings';

export function PromptBlockEditorModal({
    isOpen,
    onClose,
    onSave,
    existingBlock,
    allCharacters = [],
    allContexts = [],
    allLocations = [],
}: PromptBlockEditorModalProps) {
    if (!isOpen) return null;

    const modalKey = `pb-${existingBlock?.id ?? 'new'}`;

    return (
        <PromptBlockEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingBlock={existingBlock}
            allCharacters={allCharacters}
            allContexts={allContexts}
            allLocations={allLocations}
        />
    );
}

function PromptBlockEditorModalInner({
    onClose,
    onSave,
    existingBlock,
    allCharacters = [],
    allContexts = [],
    allLocations = [],
}: Omit<PromptBlockEditorModalProps, 'isOpen'>) {
    const [activeTab, setActiveTab] = useState<PromptBlockTabId>('general');

    const [name, setName] = useState(existingBlock?.name || '');
    const [description, setDescription] = useState(existingBlock?.description || '');
    const [textContent, setTextContent] = useState(existingBlock?.textContent ?? '');
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>(() => {
        if (existingBlock?.images && existingBlock.images.length > 0) {
            return existingBlock.images.map(img => `/user_data/prompt_block_data/${img}`);
        }
        return [];
    });
    const [isUploading, setIsUploading] = useState(false);

    const [regexActivationTriggers, setRegexActivationTriggers] = useState<RegularExpressionTrigger[]>(existingBlock?.regularExpressionActivationTriggers ?? []);
    const [regexDeactivationTriggers, setRegexDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingBlock?.regularExpressionDeactivationTriggers ?? []);
    const [regexExclusionActivationTriggers, setRegexExclusionActivationTriggers] = useState<RegularExpressionTrigger[]>(existingBlock?.regularExpressionExclusionActivationTriggers ?? []);
    const [regexExclusionDeactivationTriggers, setRegexExclusionDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingBlock?.regularExpressionExclusionDeactivationTriggers ?? []);
    const [messageFilterActivationTriggers, setMessageFilterActivationTriggers] = useState<RegularExpressionTrigger[]>(existingBlock?.messageFilterRegularExpressionActivationTriggers ?? []);
    const [messageFilterDeactivationTriggers, setMessageFilterDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingBlock?.messageFilterRegularExpressionDeactivationTriggers ?? []);
    const [messageFilterExclusionActivationTriggers, setMessageFilterExclusionActivationTriggers] = useState<RegularExpressionTrigger[]>(existingBlock?.messageFilterRegularExpressionExclusionActivationTriggers ?? []);
    const [messageFilterExclusionDeactivationTriggers, setMessageFilterExclusionDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingBlock?.messageFilterRegularExpressionExclusionDeactivationTriggers ?? []);

    const [characterBindings, setCharacterBindings] = useState<string[]>(existingBlock?.characterBindings ?? []);
    const [contextBindings, setContextBindings] = useState<string[]>(existingBlock?.contextBindings ?? []);
    const [locationBindings, setLocationBindings] = useState<string[]>(existingBlock?.locationBindings ?? []);

    const [errors, setErrors] = useState<Record<string, string | undefined>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [textTokenCount, setTextTokenCount] = useState(0);
    const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const selectedModel = useSessionStore.getState().selectedModel;
        const runningModels = useSessionStore.getState().runningModels;
        if (selectedModel) {
            tokenEngine.setRunningModels(runningModels);
            tokenEngine.setContext(selectedModel);
        }
        const initialText = existingBlock?.textContent ?? '';
        if (!initialText.trim()) return;
        const rafId = requestAnimationFrame(() => {
            tokenEngine.countTokens(initialText).then(count => setTextTokenCount(count));
        });
        return () => cancelAnimationFrame(rafId);
    }, [existingBlock]);

    useEffect(() => {
        let cancelled = false;
        const debounceRef = tokenDebounceRef.current;
        if (debounceRef) clearTimeout(debounceRef);
        tokenDebounceRef.current = setTimeout(async () => {
            const count = await tokenEngine.countTokens(textContent);
            if (!cancelled) setTextTokenCount(count);
        }, 400);
        return () => { cancelled = true; const ref = tokenDebounceRef.current; if (ref) clearTimeout(ref); };
    }, [textContent]);

    const validate = (): boolean => {
        const newErrors: Record<string, string | undefined> = {};
        if (!name.trim()) newErrors.name = 'Name is required.';

        const hasText = textContent.trim().length > 0;
        const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;
        if (!hasText && !hasImages) {
            newErrors.textContent = 'Either text or images are required.';
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
        validateTriggers(regexDeactivationTriggers, 'deactivationRegex');
        validateTriggers(regexExclusionActivationTriggers, 'exclusionRegex');
        validateTriggers(regexExclusionDeactivationTriggers, 'exclusionDeactivationRegex');
        validateTriggers(messageFilterActivationTriggers, 'messageFilterRegex');
        validateTriggers(messageFilterDeactivationTriggers, 'messageFilterDeactivationRegex');
        validateTriggers(messageFilterExclusionActivationTriggers, 'messageFilterExclusionRegex');
        validateTriggers(messageFilterExclusionDeactivationTriggers, 'messageFilterExclusionDeactivationRegex');

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0 && valid;
    };

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

        const filterTriggers = (trs: RegularExpressionTrigger[]) => {
            const filtered = trs.filter(t => t.trigger.trim());
            return filtered.length > 0 ? filtered : undefined;
        };

        return {
            id: isNewClone ? uuidv4() : (existingBlock?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            textContent: textContent.trim(),
            images: finalImageFilenames.length > 0 ? finalImageFilenames : [],
            regularExpressionActivationTriggers: filterTriggers(regexActivationTriggers),
            regularExpressionDeactivationTriggers: filterTriggers(regexDeactivationTriggers),
            regularExpressionExclusionActivationTriggers: filterTriggers(regexExclusionActivationTriggers),
            regularExpressionExclusionDeactivationTriggers: filterTriggers(regexExclusionDeactivationTriggers),
            messageFilterRegularExpressionActivationTriggers: filterTriggers(messageFilterActivationTriggers),
            messageFilterRegularExpressionDeactivationTriggers: filterTriggers(messageFilterDeactivationTriggers),
            messageFilterRegularExpressionExclusionActivationTriggers: filterTriggers(messageFilterExclusionActivationTriggers),
            messageFilterRegularExpressionExclusionDeactivationTriggers: filterTriggers(messageFilterExclusionDeactivationTriggers),
            characterBindings: characterBindings.length > 0 ? characterBindings : [],
            contextBindings: contextBindings.length > 0 ? contextBindings : [],
            locationBindings: locationBindings.length > 0 ? locationBindings : [],
            firstCreatedTimestamp: isNewClone ? now : (existingBlock?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => { const block = await buildBlockFromForm(false); if (!block) return; onSave(block); onClose(); };
    const handleClone = async () => { const cloned = await buildBlockFromForm(true); if (!cloned) return; onSave(cloned); onClose(); };

    const hasText = textContent.trim().length > 0;
    const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;
    const textRequiresAsterisk = !hasImages;
    const imagesRequiresAsterisk = !hasText;

    const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);
    const getContextById = (id: string) => allContexts.find(c => c.id === id);
    const getLocationById = (id: string) => allLocations.find(l => l.id === id);

    const promptBlockTabs: { id: PromptBlockTabId; label: string; icon: string }[] = [
        { id: 'general', label: 'General', icon: '📝' },
        { id: 'detection', label: 'Detection', icon: '🔍' },
        { id: 'filter', label: 'Filter', icon: '🚫' },
        { id: 'bindings', label: 'Bindings', icon: '🔗' },
    ];

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

                {/* Tab Bar */}
                <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                    {promptBlockTabs.map(tab => (
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
                                <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} className={`editor-input ${errors.name ? 'error' : ''}`} placeholder="e.g., Combat Rules, Magic System" />
                                {errors.name && <div className="editor-error-message">{errors.name}</div>}
                            </div>

                            <div className="context-field-group">
                                <label className="editor-label">Description</label>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea" placeholder="Brief description (display only)" rows={2} />
                            </div>

                            <div className="context-field-group">
                                <label className="editor-label">Text Content {textRequiresAsterisk && <span className="context-required-asterisk">*</span>}</label>
                                <textarea value={textContent} onChange={(e) => { setTextContent(e.target.value); if (errors.textContent) setErrors({ ...errors, textContent: undefined }); }} className={`editor-textarea ${errors.textContent ? 'error' : ''}`} placeholder="Prompt block text content (optional if using images)" rows={6} />
                                <div className="context-token-count">~{textTokenCount} token(s)</div>
                                {errors.textContent && <div className="editor-error-message">{errors.textContent}</div>}
                            </div>

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
                        </>
                    )}

                    {/* ─── DETECTION TAB ─── */}
                    {activeTab === 'detection' && (
                        <div className="editor-section" style={{ margin: 0, border: 'none', background: 'transparent', padding: 0 }}>
                            <RegularExpressionTriggerEditor
                                label="Activation"
                                description="Block activates when any trigger matches."
                                triggers={regexActivationTriggers}
                                onChange={setRegexActivationTriggers}
                                error={errors.regex}
                            />
                            <RegularExpressionTriggerEditor
                                label="Deactivation"
                                description="Deactivates block when any trigger matches."
                                triggers={regexDeactivationTriggers}
                                onChange={setRegexDeactivationTriggers}
                                error={errors.deactivationRegex}
                            />
                            <RegularExpressionTriggerEditor
                                label="Exclusion Activation"
                                description="Overrides activation when matched."
                                triggers={regexExclusionActivationTriggers}
                                onChange={setRegexExclusionActivationTriggers}
                                error={errors.exclusionRegex}
                            />
                            <RegularExpressionTriggerEditor
                                label="Exclusion Deactivation"
                                description="When exclusion stops being active."
                                triggers={regexExclusionDeactivationTriggers}
                                onChange={setRegexExclusionDeactivationTriggers}
                                error={errors.exclusionDeactivationRegex}
                            />
                        </div>
                    )}

                    {/* ─── FILTER TAB ─── */}
                    {activeTab === 'filter' && (
                        <div className="editor-section" style={{ margin: 0, border: 'none', background: 'transparent', padding: 0 }}>
                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginBottom: '12px', textAlign: 'center' }}>
                                Chat history messages matching activation triggers are excluded from the AI prompt.
                            </div>
                            <RegularExpressionTriggerEditor
                                label="Filter Activation"
                                description="Messages matching any trigger are hidden from AI."
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
                                error={errors.messageFilterExclusionRegex}
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
                            <div className="editor-section">
                                <span className="editor-section-title">Character Bindings</span>
                                <div className="context-field-group">
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
                            </div>

                            <div className="editor-section">
                                <span className="editor-section-title">Context Bindings</span>
                                <div className="context-field-group">
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
                            </div>

                            <div className="editor-section">
                                <span className="editor-section-title">Location Bindings</span>
                                <div className="context-field-group">
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
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}