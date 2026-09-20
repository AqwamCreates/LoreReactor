// src/components/ContextEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { Context, Character, searchEngine, linkFetchMode, RegularExpressionTrigger } from '../types';
import { uploadContextImage } from '../storage/serverStorage';
import { v4 as uuidv4 } from 'uuid';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { parseCharacterCard, type ParsedCharacterCardExtended } from '../services/characterCardParser';
import { useSessionStore } from '../hooks/useSessionStore';
import { RegularExpressionTriggerEditor } from './RegularExpressionTriggerEditor';
import '../main.css';

const tokenEngine = getLanguageModelEngine();

interface ContextEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (context: Context) => void;
    existingContext?: Context | null;
    allCharacters?: Character[];
}

const SEARCH_ENGINE_OPTIONS: searchEngine[] = ['Google', 'Bing', 'DuckDuckGo', 'Yandex', 'Baidu'];

type ContextTabId = 'general' | 'web' | 'detection' | 'filter' | 'lorebook';

export function ContextEditorModal({
    isOpen,
    onClose,
    onSave,
    existingContext,
    allCharacters = [],
}: ContextEditorModalProps) {
    if (!isOpen) return null;

    const modalKey = `ctx-${existingContext?.id ?? 'new'}`;

    return (
        <ContextEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingContext={existingContext}
            allCharacters={allCharacters}
        />
    );
}

function ContextEditorModalInner({
    onClose,
    onSave,
    existingContext,
    allCharacters = [],
}: Omit<ContextEditorModalProps, 'isOpen'>) {
    const [activeTab, setActiveTab] = useState<ContextTabId>('general');

    const [name, setName] = useState(existingContext?.name || '');
    const [description, setDescription] = useState(existingContext?.description || '');
    const [text, setText] = useState(existingContext?.text || '');
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>(() => {
        if (existingContext?.images && existingContext.images.length > 0) {
            return existingContext.images.map(img => `/user_data/context_data/${img}`);
        }
        return [];
    });
    const [isUploading, setIsUploading] = useState(false);
    const [useBase64Encoding, setUseBase64Encoding] = useState<boolean>(existingContext?.useBase64Encoding ?? false);

    const [regexActivationTriggers, setRegexActivationTriggers] = useState<RegularExpressionTrigger[]>(existingContext?.regularExpressionActivationTriggers ?? []);
    const [regexDeactivationTriggers, setRegexDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingContext?.regularExpressionDeactivationTriggers ?? []);
    const [regexExclusionActivationTriggers, setRegexExclusionActivationTriggers] = useState<RegularExpressionTrigger[]>(existingContext?.regularExpressionExclusionActivationTriggers ?? []);
    const [regexExclusionDeactivationTriggers, setRegexExclusionDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingContext?.regularExpressionExclusionDeactivationTriggers ?? []);
    const [messageFilterActivationTriggers, setMessageFilterActivationTriggers] = useState<RegularExpressionTrigger[]>(existingContext?.messageFilterRegularExpressionActivationTriggers ?? []);
    const [messageFilterDeactivationTriggers, setMessageFilterDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingContext?.messageFilterRegularExpressionDeactivationTriggers ?? []);
    const [messageFilterExclusionActivationTriggers, setMessageFilterExclusionActivationTriggers] = useState<RegularExpressionTrigger[]>(existingContext?.messageFilterRegularExpressionExclusionActivationTriggers ?? []);
    const [messageFilterExclusionDeactivationTriggers, setMessageFilterExclusionDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingContext?.messageFilterRegularExpressionExclusionDeactivationTriggers ?? []);

    const [errors, setErrors] = useState<Record<string, string | undefined>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cardImportRef = useRef<HTMLInputElement>(null);

    const [textnumberOfTokens, setTextnumberOfTokens] = useState(0);
    const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [tokenBudget, setTokenBudget] = useState<number>(existingContext?.tokenBudget ?? 0);
    const [maximumRecursionDepth, setMaximumRecursionDepth] = useState<number>(existingContext?.maximumRecursionDepth ?? 5);
    const [insertionDepth, setInsertionDepth] = useState<number>(existingContext?.insertionDepth ?? 0);
    const [characterBindings, setCharacterBindings] = useState<string[]>(existingContext?.characterBindings ?? []);

    const [urls, setUrls] = useState<string[]>(existingContext?.urls ?? []);
    const [newUrlInput, setNewUrlInput] = useState('');
    const [linkMaxDepth, setLinkMaxDepth] = useState<number>(existingContext?.maximumLinkDepth ?? 3);
    const [linkFetchMode, setLinkFetchMode] = useState<linkFetchMode>(existingContext?.linkFetchMode || 'full');
    const [fetchCacheTimeToLiveMs, setFetchCacheTimeToLiveMs] = useState<number>(existingContext?.fetchCacheTimeToLiveMs ?? 300000);

    const [searchTerms, setSearchTerms] = useState<string[]>(existingContext?.searchTerms ?? []);
    const [newSearchTermInput, setNewSearchTermInput] = useState('');
    const [searchEngine, setSearchEngine] = useState<searchEngine>(existingContext?.searchEngine || 'Google');

    const [includeLinkImages, setIncludeLinkImages] = useState<boolean>(existingContext?.includeLinkImages ?? false);
    const [limitLinksToSubdirectory, setLimitLinksToSubdirectory] = useState<boolean>(existingContext?.limitLinksToSubdirectory ?? false);

    useEffect(() => {
        const selectedModel = useSessionStore.getState().selectedModel;
        const runningModels = useSessionStore.getState().runningModels;
        if (selectedModel) {
            tokenEngine.setRunningModels(runningModels);
            tokenEngine.setContext(selectedModel);
        }
        const initialText = existingContext?.text || '';
        if (!initialText.trim()) return;
        const rafId = requestAnimationFrame(() => {
            tokenEngine.countTokens(initialText).then(count => setTextnumberOfTokens(count));
        });
        return () => cancelAnimationFrame(rafId);
    }, [existingContext]);

    useEffect(() => {
        let cancelled = false;
        const debounceRef = tokenDebounceRef.current;
        if (debounceRef) clearTimeout(debounceRef);
        tokenDebounceRef.current = setTimeout(async () => {
            const count = await tokenEngine.countTokens(text);
            if (!cancelled) setTextnumberOfTokens(count);
        }, 400);
        return () => { cancelled = true; const ref = tokenDebounceRef.current; if (ref) clearTimeout(ref); };
    }, [text]);

    const validate = (): boolean => {
        const newErrors: Record<string, string | undefined> = {};
        if (!name.trim()) newErrors.name = 'Name is required.';

        const hasUrls = urls.length > 0;
        const hasSearchTerms = searchTerms.length > 0;
        const hasText = text.trim().length > 0;
        const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;

        if (!hasText && !hasImages && !hasUrls && !hasSearchTerms) {
            newErrors.text = 'Either text, images, URLs, or search terms are required.';
            newErrors.images = 'Either text, images, URLs, or search terms are required.';
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
        validateTriggers(regexExclusionActivationTriggers, 'exclusionActivationRegex');
        validateTriggers(regexExclusionDeactivationTriggers, 'exclusionDeactivationRegex');
        validateTriggers(messageFilterActivationTriggers, 'messageFilterRegex');
        validateTriggers(messageFilterDeactivationTriggers, 'messageFilterDeactivationRegex');
        validateTriggers(messageFilterExclusionActivationTriggers, 'messageFilterExclusionActivationRegex');
        validateTriggers(messageFilterExclusionDeactivationTriggers, 'messageFilterExclusionDeactivationRegex');

        for (const url of urls) {
            if (!/^https?:\/\//i.test(url)) continue;
            try {
                const parsed = new URL(url);
                if (!['http:', 'https:'].includes(parsed.protocol)) { newErrors.urls = `URL "${url}" must use http:// or https:// protocol.`; break; }
            } catch { newErrors.urls = `URL "${url}" is not a valid URL.`; break; }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0 && valid;
    };

    const handleAddUrl = () => {
        const trimmed = newUrlInput.trim();
        if (!trimmed || urls.includes(trimmed)) return;
        setUrls(prev => [...prev, trimmed]);
        setNewUrlInput('');
        if (errors.urls) setErrors(prev => ({ ...prev, urls: undefined }));
    };

    const handleRemoveUrl = (index: number) => setUrls(prev => prev.filter((_, i) => i !== index));

    const handleUrlInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); handleAddUrl(); }
    };

    const handleAddSearchTerm = () => {
        const trimmed = newSearchTermInput.trim();
        if (!trimmed || searchTerms.includes(trimmed)) return;
        setSearchTerms(prev => [...prev, trimmed]);
        setNewSearchTermInput('');
    };

    const handleRemoveSearchTerm = (index: number) => setSearchTerms(prev => prev.filter((_, i) => i !== index));

    const handleSearchTermInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); handleAddSearchTerm(); }
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
    };

    const handleCardImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        const card = await parseCharacterCard(file);
        if (!card) { setErrors(prev => ({ ...prev, text: 'Not a valid character card PNG.' })); return; }
        const extended = card as ParsedCharacterCardExtended;
        if (!extended.lorebookContexts || extended.lorebookContexts.length === 0) { setErrors(prev => ({ ...prev, text: 'No lorebook entries found in this character card.' })); return; }
        const firstEntry = extended.lorebookContexts[0];
        if (firstEntry.name && !name) setName(firstEntry.name);
        if (firstEntry.text && !text) setText(firstEntry.text);
        if (firstEntry.regularExpressionActivationTriggers && firstEntry.regularExpressionActivationTriggers.length > 0 && regexActivationTriggers.length === 0) {
            setRegexActivationTriggers(firstEntry.regularExpressionActivationTriggers);
        }
        if (firstEntry.insertionDepth !== undefined && insertionDepth === 0) setInsertionDepth(firstEntry.insertionDepth);
        if (firstEntry.tokenBudget !== undefined && tokenBudget === 0) setTokenBudget(firstEntry.tokenBudget);
        setErrors({});
    };

    const buildContextFromForm = async (isNewClone: boolean): Promise<Context | null> => {
        if (!validate()) return null;

        let finalImageFilenames: string[] | undefined = isNewClone ? [] : (existingContext?.images || []);
        if (imageFiles.length > 0) {
            setIsUploading(true);
            try {
                const uploadedFilenames = await Promise.all(imageFiles.map(file => uploadContextImage(file)));
                finalImageFilenames = [...(isNewClone ? [] : (existingContext?.images || [])), ...uploadedFilenames];
            } catch (error) {
                console.error("Failed to upload images:", error);
                alert("Failed to upload images. Context not saved.");
                setIsUploading(false);
                return null;
            }
            setIsUploading(false);
        }

        const now = Date.now();
        const hasUrls = urls.length > 0;
        const hasSearchTerms = searchTerms.length > 0;
        const hasWebContent = hasUrls || hasSearchTerms;

        const filterTriggers = (trs: RegularExpressionTrigger[]) => {
            const filtered = trs.filter(t => t.trigger.trim());
            return filtered.length > 0 ? filtered : undefined;
        };

        return {
            id: isNewClone ? uuidv4() : (existingContext?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            text: text.trim() || undefined,
            images: finalImageFilenames && finalImageFilenames.length > 0 ? finalImageFilenames : undefined,
            regularExpressionActivationTriggers: filterTriggers(regexActivationTriggers),
            regularExpressionDeactivationTriggers: filterTriggers(regexDeactivationTriggers),
            regularExpressionExclusionActivationTriggers: filterTriggers(regexExclusionActivationTriggers),
            regularExpressionExclusionDeactivationTriggers: filterTriggers(regexExclusionDeactivationTriggers),
            messageFilterRegularExpressionActivationTriggers: filterTriggers(messageFilterActivationTriggers),
            messageFilterRegularExpressionDeactivationTriggers: filterTriggers(messageFilterDeactivationTriggers),
            messageFilterRegularExpressionExclusionActivationTriggers: filterTriggers(messageFilterExclusionActivationTriggers),
            messageFilterRegularExpressionExclusionDeactivationTriggers: filterTriggers(messageFilterExclusionDeactivationTriggers),
            useBase64Encoding,
            tokenBudget: tokenBudget > 0 ? tokenBudget : undefined,
            maximumRecursionDepth: maximumRecursionDepth !== 5 ? maximumRecursionDepth : undefined,
            insertionDepth: insertionDepth !== 0 ? insertionDepth : undefined,
            characterBindings: characterBindings.length > 0 ? characterBindings : undefined,
            urls: hasUrls ? [...urls] : undefined,
            includeLinkImages: hasWebContent ? includeLinkImages : undefined,
            maximumLinkDepth: hasWebContent ? linkMaxDepth : undefined,
            limitLinksToSubdirectory: hasWebContent ? (limitLinksToSubdirectory ?? false) : false,
            linkFetchMode: hasWebContent ? linkFetchMode : undefined,
            fetchCacheTimeToLiveMs: hasWebContent ? fetchCacheTimeToLiveMs : undefined,
            searchTerms: hasSearchTerms ? [...searchTerms] : undefined,
            searchEngine: hasSearchTerms ? searchEngine : undefined,
            firstCreatedTimestamp: isNewClone ? now : (existingContext?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => {
        const context = await buildContextFromForm(false);
        if (!context) return;
        onSave(context);
        onClose();
    };

    const handleClone = async () => {
        const cloned = await buildContextFromForm(true);
        if (!cloned) return;
        onSave(cloned);
        onClose();
    };

    const hasText = text.trim().length > 0;
    const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;
    const hasUrls = urls.length > 0;
    const hasSearchTerms = searchTerms.length > 0;
    const hasWebContent = hasUrls || hasSearchTerms;
    const textRequiresAsterisk = !hasImages && !hasWebContent;
    const imagesRequiresAsterisk = !hasText && !hasWebContent;
    const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);

    const contextTabs: { id: ContextTabId; label: string; icon: string }[] = [
        { id: 'general', label: 'General', icon: '📝' },
        { id: 'web', label: 'Web', icon: '🌐' },
        { id: 'detection', label: 'Detection', icon: '🔍' },
        { id: 'filter', label: 'Filter', icon: '🚫' },
        { id: 'lorebook', label: 'Lorebook', icon: '📚' },
    ];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingContext ? 'Edit Context' : 'Create New Context'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {existingContext && <button type="button" className="editor-button editor-button-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                        {!existingContext && (
                            <button type="button" className="editor-button editor-button-import" onClick={() => cardImportRef.current?.click()} disabled={isUploading}>Import Card</button>
                        )}
                        <input ref={cardImportRef} type="file" accept="image/png" hidden onChange={handleCardImport} disabled={isUploading} />
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Saving...' : 'Save'}</button>
                    </div>
                </div>

                {/* Tab Bar */}
                <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                    {contextTabs.map(tab => (
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
                                <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} className={`editor-input ${errors.name ? 'error' : ''}`} placeholder="e.g., Eldoria City Lore" />
                                {errors.name && <div className="editor-error-message">{errors.name}</div>}
                            </div>

                            <div className="context-field-group">
                                <label className="editor-label">Description</label>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea" placeholder="Brief description" rows={2} />
                            </div>

                            <div className="context-field-group">
                                <label className="editor-label">Text {textRequiresAsterisk && <span className="context-required-asterisk">*</span>}</label>
                                <textarea value={text} onChange={(e) => { setText(e.target.value); if (errors.text) setErrors({ ...errors, text: undefined }); }} className={`editor-textarea ${errors.text ? 'error' : ''}`} placeholder="Context text content (optional if using images, URLs or search terms)" rows={6} />
                                <div className="context-token-count">~{textnumberOfTokens} token(s)</div>
                                {errors.text && <div className="editor-error-message">{errors.text}</div>}
                            </div>

                            <div className="context-field-group">
                                <label className="editor-label">Images {imagesRequiresAsterisk && <span className="context-required-asterisk">*</span>}</label>
                                <div className="editor-image-grid">
                                    {imagePreviews.map((preview, index) => (
                                        <div key={index} className="editor-image-square active">
                                            <img src={preview} alt={`Context image ${index + 1}`} />
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

                            <div className="context-field-group">
                                <label className="editor-checkbox-label">
                                    <input type="checkbox" checked={useBase64Encoding} onChange={(e) => setUseBase64Encoding(e.target.checked)} className="editor-checkbox-input" />
                                    <span>Encode text as Base64</span>
                                </label>
                            </div>
                        </>
                    )}

                    {/* ─── WEB TAB ─── */}
                    {activeTab === 'web' && (
                        <>
                            <div className="context-field-group">
                                <label className="editor-label editor-label-small">Search Terms</label>
                                <div className={`context-tag-list ${searchTerms.length === 0 ? 'empty' : ''}`}>
                                    {searchTerms.length === 0 && <div className="context-tag-empty-message">No search terms added.</div>}
                                    {searchTerms.map((term, index) => (
                                        <div key={`${term}-${index}`} className="context-tag-chip">
                                            <span className="context-tag-chip-text">{term}</span>
                                            <button type="button" onClick={() => handleRemoveSearchTerm(index)} className="context-tag-remove-button" title="Remove term">×</button>
                                        </div>
                                    ))}
                                </div>
                                <div className="context-add-row">
                                    <input type="text" value={newSearchTermInput} onChange={(e) => setNewSearchTermInput(e.target.value)} onKeyDown={handleSearchTermInputKeyDown} className="editor-input context-add-input" placeholder="magic system eldoria" />
                                    <button type="button" onClick={handleAddSearchTerm} className="editor-button editor-button-save context-add-button" disabled={!newSearchTermInput.trim()}>Add</button>
                                </div>
                                <div className="context-add-hint">Press Enter or click Add to add a term.</div>
                            </div>

                            {hasWebContent && (
                                <div className="context-field-group">
                                    <label className="editor-checkbox-label">
                                        <input type="checkbox" checked={includeLinkImages} onChange={(e) => setIncludeLinkImages(e.target.checked)} className="editor-checkbox-input" />
                                        <span>Include Link Images</span>
                                    </label>
                                    <div className="context-checkbox-hint">Extract images from fetched pages and include them in summaries.</div>
                                </div>
                            )}

                            {hasSearchTerms && (
                                <div className="context-field-group">
                                    <label className="editor-label editor-label-small">Search Engine</label>
                                    <select value={searchEngine} onChange={(e) => setSearchEngine(e.target.value as searchEngine)} className="editor-select">
                                        {SEARCH_ENGINE_OPTIONS.map(engine => (<option key={engine} value={engine}>{engine}</option>))}
                                    </select>
                                </div>
                            )}

                            <div className="context-field-group">
                                <label className="editor-label editor-label-small">Direct URLs</label>
                                <div className="context-url-list">
                                    {urls.length === 0 && <div className="context-url-empty-message">No direct URLs added.</div>}
                                    {urls.map((url, index) => (
                                        <div key={`${url}-${index}`} className="context-url-chip">
                                            <span className="context-url-chip-text">{url}</span>
                                            <button type="button" onClick={() => handleRemoveUrl(index)} className="context-url-remove-button" title="Remove URL">×</button>
                                        </div>
                                    ))}
                                </div>
                                <div className="context-add-row">
                                    <input type="text" value={newUrlInput} onChange={(e) => { setNewUrlInput(e.target.value); if (errors.urls) setErrors(prev => ({ ...prev, urls: undefined })); }} onKeyDown={handleUrlInputKeyDown} className={`editor-input context-add-input-mono ${errors.urls && newUrlInput.trim().length > 0 ? 'error' : ''}`} placeholder="https://example.com/lore-page" />
                                    <button type="button" onClick={handleAddUrl} className="editor-button editor-button-save context-add-button" disabled={!newUrlInput.trim()}>Add</button>
                                </div>
                                {errors.urls && <div className="editor-error-message">{errors.urls}</div>}
                            </div>

                            {hasWebContent && (
                                <>
                                    <div className="context-field-group">
                                        <label className="editor-label">Fetch Mode</label>
                                        <select value={linkFetchMode} onChange={(e) => setLinkFetchMode(e.target.value as linkFetchMode)} className="editor-select">
                                            <option value="full">Full — Use entire page content as-is</option>
                                            <option value="extract">Extract — Keep only structured data (headings, lists, definitions)</option>
                                            <option value="summary">Summary — Condense via LLM before injecting</option>
                                        </select>
                                    </div>
                                    <div className="context-field-group">
                                        <label className="editor-label">Maximum Link Depth</label>
                                        <input type="number" min="0" max="5" value={linkMaxDepth} onChange={(e) => setLinkMaxDepth(Math.max(0, Math.min(5, Number(e.target.value) || 0)))} className="editor-input context-input-right" />
                                        <div className="context-field-hint">How many levels of links to follow. 0 = no recursion.</div>
                                    </div>
                                    <div className="context-field-group">
                                        <label className="editor-checkbox-label">
                                            <input type="checkbox" checked={limitLinksToSubdirectory} onChange={(e) => setLimitLinksToSubdirectory(e.target.checked)} className="editor-checkbox-input" />
                                            <span>Limit Links to Subdirectory</span>
                                        </label>
                                        <div className="context-checkbox-hint">Only follow links within the same directory path as the root URL.</div>
                                    </div>
                                    <div className="context-field-group">
                                        <label className="editor-label">Cache Time-To-Live (seconds)</label>
                                        <input type="number" min="0" max="86400" step="60" value={Math.round(fetchCacheTimeToLiveMs / 1000)} onChange={(e) => setFetchCacheTimeToLiveMs(Math.max(0, Number(e.target.value) || 300) * 1000)} className="editor-input context-input-right" />
                                        <div className="context-field-hint">How long to cache fetched content. 0 = always refetch.</div>
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* ─── DETECTION TAB ─── */}
                    {activeTab === 'detection' && (
                        <div className="editor-section" style={{ margin: 0, border: 'none', background: 'transparent', padding: 0 }}>
                            <RegularExpressionTriggerEditor
                                label="Activation"
                                description="Context activates when any trigger matches."
                                triggers={regexActivationTriggers}
                                onChange={setRegexActivationTriggers}
                                error={errors.regex}
                            />
                            <RegularExpressionTriggerEditor
                                label="Deactivation"
                                description="Deactivates context when any trigger matches."
                                triggers={regexDeactivationTriggers}
                                onChange={setRegexDeactivationTriggers}
                                error={errors.deactivationRegex}
                            />
                            <RegularExpressionTriggerEditor
                                label="Exclusion Activation"
                                description="Overrides activation when matched."
                                triggers={regexExclusionActivationTriggers}
                                onChange={setRegexExclusionActivationTriggers}
                                error={errors.exclusionActivationRegex}
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

                    {/* ─── LOREBOOK TAB ─── */}
                    {activeTab === 'lorebook' && (
                        <>
                            <div className="editor-section">
                                <span className="editor-section-title">Lorebook Settings</span>
                                <div className="editor-row">
                                    <div>
                                        <label className="editor-label editor-label-small">Token Budget</label>
                                        <input type="number" step="1" min="0" value={tokenBudget} onChange={(e) => setTokenBudget(Math.max(0, Number.parseInt(e.target.value) || 0))} className="editor-input context-input-small" title="Maximum tokens this entry can consume. 0 = auto-estimate." />
                                        <div className="context-field-hint">0 = auto · bottom dropped first</div>
                                    </div>
                                    <div>
                                        <label className="editor-label editor-label-small">Insertion Depth</label>
                                        <input type="number" step="1" min="0" value={insertionDepth} onChange={(e) => setInsertionDepth(Math.max(0, Number.parseInt(e.target.value) || 0))} className="editor-input context-input-small" title="Where in the prompt to place this entry." />
                                        <div className="context-field-hint">0 = top · higher = closer to chat</div>
                                    </div>
                                </div>
                                <div className="editor-row" style={{ marginTop: '10px' }}>
                                    <div>
                                        <label className="editor-label editor-label-small">Maximum Recursion Depth</label>
                                        <input type="number" step="1" min="0" max="10" value={maximumRecursionDepth} onChange={(e) => setMaximumRecursionDepth(Math.max(0, Math.min(10, Number.parseInt(e.target.value) || 0)))} className="editor-input context-input-small" title="Maximum recursion depth for lorebook scanning." />
                                        <div className="context-field-hint">0 = no recursion · default: 5</div>
                                    </div>
                                </div>
                            </div>

                            <div className="editor-section">
                                <span className="editor-section-title">Character Bindings</span>
                                <div className="context-binding-hint">Only inject when these characters speak. Empty = all characters.</div>
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
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}