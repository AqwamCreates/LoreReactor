// src/components/ContextEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { Context, Character, searchEngine } from '../types';
import { uploadContextImage } from '../hooks/storage';
import { v4 as uuidv4 } from 'uuid';
import { LanguageModelEngine } from '../services/LanguageModelEngine';
import './main.css';

const tokenEngine = new LanguageModelEngine();

interface ContextEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (context: Context) => void;
    existingContext?: Context | null;
    allCharacters?: Character[];
    runtimePort?: number;
}

const SEARCH_ENGINE_OPTIONS: searchEngine[] = ['Google', 'Bing', 'DuckDuckGo', 'Yandex', 'Baidu'];

export function ContextEditorModal({
    isOpen,
    onClose,
    onSave,
    existingContext,
    allCharacters = [],
    runtimePort,
}: ContextEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [text, setText] = useState('');
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    const [useBase64Encoding, setUseBase64Encoding] = useState<boolean>(false);

    const [regexTrigger, setRegexTrigger] = useState('');
    const [regexContext, setRegexContext] = useState<'global' | 'local' | 'previous'>('global');
    const [regexTarget, setRegexTarget] = useState<'everyone' | 'listener' | 'self'>('everyone');
    const [testText, setTestText] = useState('');
    const [testResult, setTestResult] = useState<boolean | null>(null);
    const [errors, setErrors] = useState<{ name?: string; text?: string; regex?: string; images?: string; urls?: string }>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ✅ Token count for the text field — uses countTokens with runtime port, falls back to estimate
    const [textnumberOfTokens, setTextnumberOfTokens] = useState(0);
    const tokenDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Lorebook fields
    const [tokenBudget, setTokenBudget] = useState<number>(0);
    const [maximumRecursionDepth, setMaximumRecursionDepth] = useState<number>(5);
    const [insertionDepth, setInsertionDepth] = useState<number>(0);
    const [characterBindings, setCharacterBindings] = useState<string[]>([]);

    // Multiple URL fields
    const [urls, setUrls] = useState<string[]>([]);
    const [newUrlInput, setNewUrlInput] = useState('');
    const [linkMaxDepth, setLinkMaxDepth] = useState<number>(3);
    const [linkFetchMode, setLinkFetchMode] = useState<string>('full');
    const [fetchCacheTimeToLiveMs, setFetchCacheTimeToLiveMs] = useState<number>(300000);

    // Search term fields
    const [searchTerms, setSearchTerms] = useState<string[]>([]);
    const [newSearchTermInput, setNewSearchTermInput] = useState('');
    const [searchEngine, setSearchEngine] = useState<searchEngine>('Google');

    const [includeLinkImages, setIncludeLinkImages] = useState<boolean>(false);
    const [limitLinksToSubdirectory, setLimitLinksToSubdirectory] = useState<boolean>(false);

    // ✅ Debounced accurate token count using countTokens (hits llama.cpp /tokenize when available)
    useEffect(() => {
        let cancelled = false;

        if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
        tokenDebounceRef.current = setTimeout(async () => {
            try {
                const count = await tokenEngine.countTokens(text, runtimePort ? { runtimePort } : undefined);
                if (!cancelled) setTextnumberOfTokens(count);
            } catch {
                if (!cancelled) setTextnumberOfTokens(Math.ceil(text.length / 4));
            }
        }, 400);

        return () => {
            cancelled = true;
            if (tokenDebounceRef.current) clearTimeout(tokenDebounceRef.current);
        };
    }, [text, runtimePort]);

    useEffect(() => {
        if (isOpen) {
            if (existingContext) {
                setName(existingContext.name || '');
                setDescription(existingContext.description || '');
                setText(existingContext.text || '');

                if (existingContext.images && existingContext.images.length > 0) {
                    const previews = existingContext.images.map(img => `/user_data/context_data/${img}`);
                    setImagePreviews(previews);
                } else {
                    setImagePreviews([]);
                }

                setImageFiles([]);
                setRegexTrigger(existingContext.regularExpressionTrigger || '');
                setRegexContext(existingContext.regularExpressionContext || 'global');
                setRegexTarget(existingContext.regularExpressionTarget || 'everyone');

                setUseBase64Encoding(existingContext.useBase64Encoding ?? false);

                setTokenBudget(existingContext.tokenBudget ?? 0);
                setMaximumRecursionDepth(existingContext.maximumRecursionDepth ?? 5);
                setInsertionDepth(existingContext.insertionDepth ?? 0);
                setCharacterBindings(existingContext.characterBindings ?? []);

                setUrls(existingContext.urls ?? []);
                setNewUrlInput('');
                setLinkMaxDepth(existingContext.maximumLinkDepth ?? 0);
                setLinkFetchMode(existingContext.linkFetchMode || 'full');
                setFetchCacheTimeToLiveMs(existingContext.fetchCacheTimeToLiveMs ?? 300000);

                setSearchTerms(existingContext.searchTerms ?? []);
                setNewSearchTermInput('');
                setSearchEngine(existingContext.searchEngine || 'Google');

                setIncludeLinkImages(existingContext.includeLinkImages ?? false);
                setLimitLinksToSubdirectory(existingContext.limitLinksToSubdirectory ?? false);
            } else {
                setName('');
                setDescription('');
                setText('');
                setImageFiles([]);
                setImagePreviews([]);
                setUseBase64Encoding(false);
                setRegexTrigger('');
                setRegexContext('global');
                setRegexTarget('everyone');

                setTokenBudget(0);
                setMaximumRecursionDepth(5);
                setInsertionDepth(0);
                setCharacterBindings([]);

                setUrls([]);
                setNewUrlInput('');
                setLinkMaxDepth(0);
                setLinkFetchMode('full');
                setFetchCacheTimeToLiveMs(300000);

                setSearchTerms([]);
                setNewSearchTermInput('');
                setSearchEngine('Google');

                setIncludeLinkImages(false);
                setLimitLinksToSubdirectory(false);
            }
            setErrors({});
            setTestText('');
            setTestResult(null);
        }
    }, [isOpen, existingContext]);

    const validate = (): boolean => {
        const newErrors: { name?: string; text?: string; regex?: string; images?: string; urls?: string } = {};
        if (!name.trim()) newErrors.name = 'Name is required.';

        const hasUrls = urls.length > 0;
        const hasSearchTerms = searchTerms.length > 0;
        const hasText = text.trim().length > 0;
        const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;

        if (!hasText && !hasImages && !hasUrls && !hasSearchTerms) {
            newErrors.text = 'Either text, images, URLs, or search terms are required.';
            newErrors.images = 'Either text, images, URLs, or search terms are required.';
        }

        if (regexTrigger.trim()) {
            try { new RegExp(regexTrigger); } catch (e) { newErrors.regex = 'Invalid regular expression pattern.'; }
        }

        for (const url of urls) {
            if (!/^https?:\/\//i.test(url)) continue;

            try {
                const parsed = new URL(url);
                if (!['http:', 'https:'].includes(parsed.protocol)) {
                    newErrors.urls = `URL "${url}" must use http:// or https:// protocol.`;
                    break;
                }
            } catch {
                newErrors.urls = `URL "${url}" is not a valid URL.`;
                break;
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleAddUrl = () => {
        const trimmed = newUrlInput.trim();
        if (!trimmed) return;
        if (urls.includes(trimmed)) return;
        setUrls(prev => [...prev, trimmed]);
        setNewUrlInput('');
        if (errors.urls) setErrors(prev => ({ ...prev, urls: undefined }));
    };

    const handleRemoveUrl = (index: number) => {
        setUrls(prev => prev.filter((_, i) => i !== index));
    };

    const handleUrlInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddUrl();
        }
    };

    const handleAddSearchTerm = () => {
        const trimmed = newSearchTermInput.trim();
        if (!trimmed) return;
        if (searchTerms.includes(trimmed)) return;
        setSearchTerms(prev => [...prev, trimmed]);
        setNewSearchTermInput('');
    };

    const handleRemoveSearchTerm = (index: number) => {
        setSearchTerms(prev => prev.filter((_, i) => i !== index));
    };

    const handleSearchTermInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddSearchTerm();
        }
    };

    const handleTestRegex = () => {
        if (!regexTrigger.trim() || !testText.trim()) { setTestResult(null); return; }
        try {
            const regex = new RegExp(regexTrigger);
            setTestResult(regex.test(testText));
        } catch (e) {
            setTestResult(null);
            setErrors(prev => ({ ...prev, regex: 'Invalid regular expression pattern.' }));
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

    const buildContextFromForm = async (isNewClone: boolean): Promise<Context | null> => {
        if (!validate()) return null;

        let finalImageFilenames: string[] | undefined = isNewClone ? [] : (existingContext?.images || []);

        if (imageFiles.length > 0) {
            setIsUploading(true);
            try {
                const uploadPromises = imageFiles.map(file => uploadContextImage(file));
                const uploadedFilenames = await Promise.all(uploadPromises);
                finalImageFilenames = [...(isNewClone ? [] : (existingContext?.images || [])), ...uploadedFilenames];
            } catch (err) {
                console.error("Failed to upload images:", err);
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

        return {
            id: isNewClone ? uuidv4() : (existingContext?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            text: text.trim() || undefined,
            images: finalImageFilenames && finalImageFilenames.length > 0 ? finalImageFilenames : undefined,
            regularExpressionTrigger: regexTrigger.trim() || undefined,
            regularExpressionContext: regexContext,
            regularExpressionTarget: regexTarget,
            useBase64Encoding: useBase64Encoding,
            tokenBudget: tokenBudget > 0 ? tokenBudget : undefined,
            maximumRecursionDepth: maximumRecursionDepth !== 5 ? maximumRecursionDepth : undefined,
            insertionDepth: insertionDepth !== 0 ? insertionDepth : undefined,
            characterBindings: characterBindings.length > 0 ? characterBindings : undefined,

            urls: hasUrls ? [...urls] : undefined,
            includeLinkImages: hasWebContent ? includeLinkImages : undefined,
            maximumLinkDepth: hasWebContent ? linkMaxDepth : undefined,
            limitLinksToSubdirectory: hasWebContent ? limitLinksToSubdirectory : undefined,
            linkFetchMode: hasWebContent ? (linkFetchMode as any) : undefined,
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
        const clonedContext = await buildContextFromForm(true);
        if (!clonedContext) return;
        onSave(clonedContext);
        onClose();
    };

    if (!isOpen) return null;

    const hasText = text.trim().length > 0;
    const hasImages = imagePreviews.length > 0 || imageFiles.length > 0;
    const hasUrls = urls.length > 0;
    const hasSearchTerms = searchTerms.length > 0;
    const hasWebContent = hasUrls || hasSearchTerms;
    const textRequiresAsterisk = !hasImages && !hasWebContent;
    const imagesRequiresAsterisk = !hasText && !hasWebContent;

    const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingContext ? 'Edit Context' : 'Create New Context'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {existingContext && <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Saving...' : 'Save'}</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
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
                        <span className="editor-section-title">Web Content Sources</span>

                        <div className="context-field-group">
                            <label className="editor-label editor-label-small">Search Terms</label>
                            <div className={`context-tag-list ${searchTerms.length === 0 ? 'empty' : ''}`}>
                                {searchTerms.length === 0 && <div className="context-tag-empty-message">No search terms added.</div>}
                                {searchTerms.map((term, index) => (
                                    <div key={`${term}-${index}`} className="context-tag-chip">
                                        <span className="context-tag-chip-text">{term}</span>
                                        <button type="button" onClick={() => handleRemoveSearchTerm(index)} className="context-tag-remove-btn" title="Remove term">×</button>
                                    </div>
                                ))}
                            </div>
                            <div className="context-add-row">
                                <input type="text" value={newSearchTermInput} onChange={(e) => setNewSearchTermInput(e.target.value)} onKeyDown={handleSearchTermInputKeyDown} className="editor-input context-add-input" placeholder="magic system eldoria" />
                                <button type="button" onClick={handleAddSearchTerm} className="editor-btn editor-btn-save context-add-btn" disabled={!newSearchTermInput.trim()}>Add</button>
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
                                        <button type="button" onClick={() => handleRemoveUrl(index)} className="context-url-remove-btn" title="Remove URL">×</button>
                                    </div>
                                ))}
                            </div>
                            <div className="context-add-row">
                                <input type="text" value={newUrlInput} onChange={(e) => { setNewUrlInput(e.target.value); if (errors.urls) setErrors(prev => ({ ...prev, urls: undefined })); }} onKeyDown={handleUrlInputKeyDown} className={`editor-input context-add-input-mono ${errors.urls && newUrlInput.trim().length > 0 ? 'error' : ''}`} placeholder="https://example.com/lore-page" />
                                <button type="button" onClick={handleAddUrl} className="editor-btn editor-btn-save context-add-btn" disabled={!newUrlInput.trim()}>Add</button>
                            </div>
                            {errors.urls && <div className="editor-error-message">{errors.urls}</div>}
                        </div>

                        {hasWebContent && (
                            <>
                                <div className="context-field-group">
                                    <label className="editor-label">Fetch Mode</label>
                                    <select value={linkFetchMode} onChange={(e) => setLinkFetchMode(e.target.value)} className="editor-select">
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
                                    <div className="context-checkbox-hint">Only follow links within the same directory path as the root URL. Prevents crawling unrelated sections of a website.</div>
                                </div>
                                <div className="context-field-group">
                                    <label className="editor-label">Cache Time-To-Live (seconds)</label>
                                    <input type="number" min="0" max="86400" step="60" value={Math.round(fetchCacheTimeToLiveMs / 1000)} onChange={(e) => setFetchCacheTimeToLiveMs(Math.max(0, Number(e.target.value) || 300) * 1000)} className="editor-input context-input-right" />
                                    <div className="context-field-hint">How long to cache fetched content. 0 = always refetch.</div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="editor-section">
                        <span className="editor-section-title">Regular Expression</span>
                        <div className="editor-row-full">
                            <div>
                                <label className="editor-label editor-label-small">Trigger Pattern</label>
                                <input type="text" value={regexTrigger} onChange={(e) => { setRegexTrigger(e.target.value); if (errors.regex) setErrors({ ...errors, regex: undefined }); setTestResult(null); }} className={`editor-input context-mono-input ${errors.regex ? 'error' : ''}`} placeholder="/pattern/i" />
                                {errors.regex && <div className="editor-error-message">{errors.regex}</div>}
                            </div>
                        </div>
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Context</label>
                                <select value={regexContext} onChange={(e) => setRegexContext(e.target.value as any)} className="editor-select" disabled={!regexTrigger.trim()}>
                                    <option value="global">Global</option><option value="local">Local</option><option value="previous">Previous</option>
                                </select>
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Target</label>
                                <select value={regexTarget} onChange={(e) => setRegexTarget(e.target.value as any)} className="editor-select" disabled={!regexTrigger.trim()}>
                                    <option value="everyone">Everyone</option><option value="listener">Listener</option><option value="self">Self</option>
                                </select>
                            </div>
                        </div>
                        {regexTrigger.trim() && (
                            <div className="context-field-group">
                                <label className="editor-label editor-label-small">Test Pattern</label>
                                <div className="context-test-row">
                                    <input type="text" value={testText} onChange={(e) => { setTestText(e.target.value); setTestResult(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTestRegex(); } }} className="editor-input context-test-input" placeholder="Test text" />
                                    <button type="button" onClick={handleTestRegex} className="editor-btn editor-btn-save context-test-btn" disabled={!testText.trim()}>Test</button>
                                </div>
                                {testResult !== null && (
                                    <div className={`context-test-result ${testResult ? 'editor-success-message' : 'editor-error-message'}`}>
                                        {testResult ? '✅ Matches!' : '❌ No match'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="editor-section">
                        <span className="editor-section-title">Lorebook</span>
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Token Budget</label>
                                <input type="number" step="1" min="0" value={tokenBudget} onChange={(e) => setTokenBudget(Math.max(0, Number.parseInt(e.target.value) || 0))} className="editor-input context-input-small" title="Maximum tokens this entry can consume. 0 = auto-estimate. Total budget: 2048. Bottom entries dropped first on overflow." />
                                <div className="context-field-hint">0 = auto · bottom dropped first</div>
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Insertion Depth</label>
                                <input type="number" step="1" min="0" value={insertionDepth} onChange={(e) => setInsertionDepth(Math.max(0, Number.parseInt(e.target.value) || 0))} className="editor-input context-input-small" title="Where in the prompt to place this entry. 0 = top of context block, higher = closer to chat history" />
                                <div className="context-field-hint">0 = top · higher = closer to chat</div>
                            </div>
                        </div>
                        <div className="editor-row" style={{ marginTop: '10px' }}>
                            <div>
                                <label className="editor-label editor-label-small">Maximum Recursion Depth</label>
                                <input type="number" step="1" min="0" max="10" value={maximumRecursionDepth} onChange={(e) => setMaximumRecursionDepth(Math.max(0, Math.min(10, Number.parseInt(e.target.value) || 0)))} className="editor-input context-input-small" title="Maximum recursion depth for lorebook scanning. 0 = direct scan only, never recursive. Default: 5." />
                                <div className="context-field-hint">0 = no recursion · default: 5</div>
                            </div>
                        </div>

                        {allCharacters.length > 0 && (
                            <div className="context-field-group">
                                <span className="editor-label editor-label-small">Character Bindings</span>
                                <div className="context-binding-hint">Only inject when these characters speak. Empty = all characters.</div>
                                <div className="context-character-binding-list">
                                    {characterBindings.length === 0 && <div className="context-tag-empty-message">No character bindings — applies to all.</div>}
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
                        )}
                    </div>

                    <div className="editor-toggle-section context-toggle-section">
                        <label className="editor-checkbox-label">
                            <input type="checkbox" checked={useBase64Encoding} onChange={(e) => setUseBase64Encoding(e.target.checked)} className="editor-checkbox-input" />
                            <span className="editor-label">Encode text as Base64</span>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
}