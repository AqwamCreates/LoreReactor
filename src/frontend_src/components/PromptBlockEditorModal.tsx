// src/frontend_src/components/PromptBlockEditorModal.tsx
import { useState, useEffect, useRef } from 'react';
import type { PromptBlock, Character, Context, Location, RegularExpressionTrigger } from '../types';
import { uploadPromptBlockImage, clonePromptBlockImage } from '../storages/serverStorage';
import { v4 as uuidv4 } from 'uuid';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { useChatStore } from '../hooks/useChatStore';
import { RegularExpressionTriggerEditor } from './RegularExpressionTriggerEditor';
import { FileDropArea } from './FileDropArea';
import { ImageList, type ImageEntry } from './ImageList';
import { EntitySelectList } from './EntitySelectList';
import '../main.css';

const tokenEngine = getLanguageModelEngine();

interface PromptBlockEditorModalProps {
    onClose: () => void;
    onSave: (block: PromptBlock) => void;
    existingBlock?: PromptBlock | null;
    allCharacters?: Character[];
    allContexts?: Context[];
    allLocations?: Location[];
}

type PromptBlockTabId = 'general' | 'detection' | 'filter' | 'bindings';

export function PromptBlockEditorModal({
    onClose,
    onSave,
    existingBlock,
    allCharacters = [],
    allContexts = [],
    allLocations = [],
}: PromptBlockEditorModalProps) {
    return (
        <PromptBlockEditorModalInner
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
    
    // Unified image management
    const [images, setImages] = useState<ImageEntry[]>(() => {
        if (existingBlock?.images && existingBlock.images.length > 0) {
            return existingBlock.images.map(filename => ({
                type: 'existing',
                filename,
                previewUrl: `/user_data/prompt_block_images/${existingBlock.id}/${filename}`,
            }));
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

    // ✅ ADDED SEARCH STATES FOR ENTITY SELECTORS
    const [charBindSearch, setCharBindSearch] = useState('');
    const [ctxBindSearch, setCtxBindSearch] = useState('');
    const [locBindSearch, setLocBindSearch] = useState('');

    const [errors, setErrors] = useState<Record<string, string | undefined>>({});

    const [textTokenCount, setTextTokenCount] = useState(0);
    const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const state = useChatStore.getState() as any;
        const selectedModel = state.selectedModel;
        const runningModels = state.runningModels;
        if (selectedModel) {
            tokenEngine.setRunningModels(runningModels ?? {});
            tokenEngine.setContext(selectedModel);
        }
        const initialText = existingBlock?.textContent ?? '';
        if (!initialText) return;
        const rafId = requestAnimationFrame(() => {
            tokenEngine.countTokens(initialText).then(count => setTextTokenCount(count));
        });
        return () => cancelAnimationFrame(rafId);
    }, [existingBlock]);

    useEffect(() => {
        let cancelled = false;
        if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
        tokenDebounceRef.current = setTimeout(async () => {
            const count = await tokenEngine.countTokens(textContent);
            if (!cancelled) setTextTokenCount(count);
        }, 400);
        return () => { 
            cancelled = true; 
            if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current); 
        };
    }, [textContent]);

    const validate = (): boolean => {
        const newErrors: Record<string, string | undefined> = {};
        if (!name) newErrors.name = 'Name is required.';

        const hasText = textContent.length > 0;
        const hasImages = images.length > 0;
        if (!hasText && !hasImages) {
            newErrors.textContent = 'Either text or images are required.';
            newErrors.images = 'Either text or images are required.';
        }

        let valid = true;
        const validateTriggers = (trs: RegularExpressionTrigger[], key: string) => {
            for (let i = 0; i < trs.length; i++) {
                if (trs[i].trigger) {
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

    const handleImageFilesAdded = (files: File[]) => {
        const newEntries: ImageEntry[] = files.map(file => ({
            type: 'staged',
            file,
            previewUrl: URL.createObjectURL(file),
        }));
        setImages(prev => [...prev, ...newEntries]);
        if (errors.images) setErrors(prev => ({ ...prev, images: undefined }));
    };

    const handleRemoveImage = (index: number) => {
        setImages(prev => {
            const item = prev[index];
            if (item && item.type === 'staged') {
                URL.revokeObjectURL(item.previewUrl);
            }
            return prev.filter((_, i) => i !== index);
        });
    };

    const handleReorderImages = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= images.length || toIndex >= images.length) return;
        setImages(prev => {
            const next = [...prev];
            const [movedItem] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, movedItem);
            return next;
        });
    };

    const buildBlockFromForm = async (isNewClone: boolean): Promise<PromptBlock | null> => {
        if (!validate()) return null;

        const blockId = isNewClone ? uuidv4() : (existingBlock?.id || uuidv4());

        let finalImageFilenames: string[] = [];

        setIsUploading(true);
        try {
            // ─── CLONE EXISTING ASSETS IF CLONING ───────────────────────────
            if (isNewClone && existingBlock) {
                for (const img of images) {
                    if (img.type === 'existing') {
                        const cloned = await clonePromptBlockImage(existingBlock.id, blockId, img.filename);
                        if (cloned) {
                            finalImageFilenames.push(cloned);
                        }
                    }
                }
            } else {
                finalImageFilenames = images
                    .filter((img): img is ImageEntry & { type: 'existing' } => img.type === 'existing')
                    .map(img => img.filename);
            }

            // ─── UPLOAD NEWLY STAGED FILES ──────────────────────────────────
            const filesToUpload = images
                .filter((img): img is ImageEntry & { type: 'staged' } => img.type === 'staged')
                .map(img => img.file);

            if (filesToUpload.length > 0) {
                const uploaded = await Promise.all(
                    filesToUpload.map(f => uploadPromptBlockImage(blockId, f))
                );
                finalImageFilenames = [...finalImageFilenames, ...uploaded];
            }
        } catch (error) {
            console.error('Failed to process prompt block images:', error);
            alert('Failed to upload/clone images. Prompt block not saved.');
            return null;
        } finally {
            setIsUploading(false);
        }

        const now = Date.now();

        const filterTriggers = (trs: RegularExpressionTrigger[]) => {
            const filtered = trs.filter(t => t.trigger);
            return filtered.length > 0 ? filtered : undefined;
        };

        return {
            id: blockId,
            name: isNewClone ? `${name} (Clone)` : name,
            description: description || undefined,
            textContent: textContent,
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

    const hasText = textContent.length > 0;
    const hasImages = images.length > 0;
    const textRequiresAsterisk = !hasImages;
    const imagesRequiresAsterisk = !hasText;

    const promptBlockTabs: { id: PromptBlockTabId; label: string; icon: string }[] = [
        { id: 'general', label: 'General', icon: '📝' },
        { id: 'detection', label: 'Detection', icon: '🔍' },
        { id: 'filter', label: 'Filter', icon: '🚫' },
        { id: 'bindings', label: 'Bindings', icon: '🔗' },
    ];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <FileDropArea
                    acceptedTypes={['image']}
                    disabled={isUploading}
                    onDropFiles={handleImageFilesAdded}
                    overlayTitle="Drop Prompt Block Images"
                    overlaySubtitle="Drop image files here to attach to this prompt block"
                >
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
                                    <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} className={`editor-input ${errors.name ? 'error' : ''}`} placeholder="e.g., Combat Rules, Magic System" disabled={isUploading} />
                                    {errors.name && <div className="editor-error-message">{errors.name}</div>}
                                </div>

                                <div className="context-field-group">
                                    <label className="editor-label">Description</label>
                                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea" placeholder="Brief description (display only)" rows={2} disabled={isUploading} />
                                </div>

                                <div className="context-field-group">
                                    <label className="editor-label">Text Content {textRequiresAsterisk && <span className="context-required-asterisk">*</span>}</label>
                                    <textarea value={textContent} onChange={(e) => { setTextContent(e.target.value); if (errors.textContent) setErrors({ ...errors, textContent: undefined }); }} className={`editor-textarea ${errors.textContent ? 'error' : ''}`} placeholder="Prompt block text content (optional if using images)" rows={6} disabled={isUploading} />
                                    <div className="context-token-count">~{textTokenCount} token(s)</div>
                                    {errors.textContent && <div className="editor-error-message">{errors.textContent}</div>}
                                </div>

                                <div className="context-field-group">
                                    <label className="editor-label">Images {imagesRequiresAsterisk && <span className="context-required-asterisk">*</span>}</label>
                                    <ImageList 
                                        images={images}
                                        isUploading={isUploading}
                                        isReadOnly={false}
                                        onRemoveImage={handleRemoveImage}
                                        onReorderImages={handleReorderImages}
                                        onFilesAdded={handleImageFilesAdded}
                                    />
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
                                {/* ✅ REPLACED: Character Bindings */}
                                <div className="editor-section">
                                    <span className="editor-section-title">Character Bindings</span>
                                    <div className="context-field-group">
                                        <div className="context-binding-hint">Only inject when these characters are present. Empty = all characters.</div>
                                        
                                        <EntitySelectList
                                            label="Bound Characters"
                                            items={allCharacters}
                                            selectedIds={characterBindings}
                                            onToggle={(id) => {
                                                if (characterBindings.includes(id)) {
                                                    setCharacterBindings(prev => prev.filter(cid => cid !== id));
                                                } else {
                                                    setCharacterBindings(prev => [...prev, id]);
                                                }
                                            }}
                                            searchQuery={charBindSearch}
                                            onSearchChange={setCharBindSearch}
                                            disabled={isUploading}
                                        />
                                    </div>
                                </div>

                                {/* ✅ REPLACED: Context Bindings */}
                                <div className="editor-section">
                                    <span className="editor-section-title">Context Bindings</span>
                                    <div className="context-field-group">
                                        <div className="context-binding-hint">Only inject when these contexts are active. Empty = always.</div>
                                        
                                        <EntitySelectList
                                            label="Bound Contexts"
                                            items={allContexts}
                                            selectedIds={contextBindings}
                                            onToggle={(id) => {
                                                if (contextBindings.includes(id)) {
                                                    setContextBindings(prev => prev.filter(cid => cid !== id));
                                                } else {
                                                    setContextBindings(prev => [...prev, id]);
                                                }
                                            }}
                                            searchQuery={ctxBindSearch}
                                            onSearchChange={setCtxBindSearch}
                                            disabled={isUploading}
                                        />
                                    </div>
                                </div>

                                {/* ✅ REPLACED: Location Bindings */}
                                <div className="editor-section">
                                    <span className="editor-section-title">Location Bindings</span>
                                    <div className="context-field-group">
                                        <div className="context-binding-hint">Only inject at these locations. Empty = all locations.</div>
                                        
                                        <EntitySelectList
                                            label="Bound Locations"
                                            items={allLocations}
                                            selectedIds={locationBindings}
                                            onToggle={(id) => {
                                                if (locationBindings.includes(id)) {
                                                    setLocationBindings(prev => prev.filter(lid => lid !== id));
                                                } else {
                                                    setLocationBindings(prev => [...prev, id]);
                                                }
                                            }}
                                            searchQuery={locBindSearch}
                                            onSearchChange={setLocBindSearch}
                                            disabled={isUploading}
                                        />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </FileDropArea>
            </div>
        </div>
    );
}