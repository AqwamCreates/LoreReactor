// src/components/ContextEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { Context, Character, searchEngine } from '../types';
import { uploadContextImage } from '../hooks/storage';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

interface ContextEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (context: Context) => void;
    onDelete?: (id: string) => void;
    existingContext?: Context | null;
    allCharacters?: Character[];
}

const SEARCH_ENGINE_OPTIONS: searchEngine[] = ['Google', 'Bing', 'DuckDuckGo', 'Yandex', 'Baidu'];

export function ContextEditorModal({
    isOpen,
    onClose,
    onSave,
    onDelete,
    existingContext,
    allCharacters = [],
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

    // Lorebook fields
    const [tokenBudget, setTokenBudget] = useState<number>(0);
    const [recursiveScan, setRecursiveScan] = useState<boolean>(false);
    const [maximumRecursionDepth, setMaximumRecursionDepth] = useState<number>(5);
    const [insertionDepth, setInsertionDepth] = useState<number>(0);
    const [characterBindings, setCharacterBindings] = useState<string[]>([]);

    // Multiple URL fields
    const [urls, setUrls] = useState<string[]>([]);
    const [newUrlInput, setNewUrlInput] = useState('');
    const [linkRecursionEnabled, setLinkRecursionEnabled] = useState(false);
    const [linkMaxDepth, setLinkMaxDepth] = useState<number>(3);
    const [linkFetchMode, setLinkFetchMode] = useState<string>('full');
    const [fetchCacheTimeToLiveMs, setFetchCacheTimeToLiveMs] = useState<number>(300000);

    // Search term fields
    const [searchTerms, setSearchTerms] = useState<string[]>([]);
    const [newSearchTermInput, setNewSearchTermInput] = useState('');
    const [searchEngine, setSearchEngine] = useState<searchEngine>('Google');

    // ✅ Include link images toggle
    const [includeLinkImages, setIncludeLinkImages] = useState<boolean>(false);

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
                setRecursiveScan(existingContext.recursiveScan ?? false);
                setMaximumRecursionDepth(existingContext.maximumRecursionDepth ?? 5);
                setInsertionDepth(existingContext.insertionDepth ?? 0);
                setCharacterBindings(existingContext.characterBindings ?? []);

                setUrls(existingContext.urls ?? []);
                setNewUrlInput('');
                setLinkRecursionEnabled(existingContext.linkRecursionEnabled ?? false);
                setLinkMaxDepth(existingContext.linkMaxDepth ?? 3);
                setLinkFetchMode(existingContext.linkFetchMode || 'full');
                setFetchCacheTimeToLiveMs(existingContext.fetchCacheTimeToLiveMs ?? 300000);

                setSearchTerms(existingContext.searchTerms ?? []);
                setNewSearchTermInput('');
                setSearchEngine(existingContext.searchEngine || 'Google');

                // ✅ Restore includeLinkImages
                setIncludeLinkImages(existingContext.includeLinkImages ?? false);
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
                setRecursiveScan(false);
                setMaximumRecursionDepth(5);
                setInsertionDepth(0);
                setCharacterBindings([]);

                setUrls([]);
                setNewUrlInput('');
                setLinkRecursionEnabled(false);
                setLinkMaxDepth(3);
                setLinkFetchMode('full');
                setFetchCacheTimeToLiveMs(300000);

                setSearchTerms([]);
                setNewSearchTermInput('');
                setSearchEngine('Google');

                setIncludeLinkImages(false);
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
            newErrors.text = 'Either text, images, at least one URL, or search terms are required.';
            newErrors.images = 'Either text, images, at least one URL, or search terms are required.';
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
            recursiveScan: recursiveScan || undefined,
            maximumRecursionDepth: maximumRecursionDepth !== 5 ? maximumRecursionDepth : undefined,
            insertionDepth: insertionDepth !== 0 ? insertionDepth : undefined,
            characterBindings: characterBindings.length > 0 ? characterBindings : undefined,

            urls: hasUrls ? [...urls] : undefined,
            includeLinkImages: hasWebContent ? includeLinkImages : undefined,
            linkRecursionEnabled: hasWebContent ? linkRecursionEnabled : undefined,
            linkMaxDepth: hasWebContent ? linkMaxDepth : undefined,
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

    const handleDelete = () => {
        if (!existingContext) return;
        if (!window.confirm(`Delete context "${existingContext.name}" permanently?`)) return;
        onDelete?.(existingContext.id);
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
                        {existingContext && (
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone} disabled={isUploading}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit} disabled={isUploading}>
                            {isUploading ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Name <span style={{ color: '#ff4444' }}>*</span></label>
                        <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} className={`editor-input ${errors.name ? 'error' : ''}`} placeholder="e.g., Eldoria City Lore" />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Description</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea" placeholder="Brief description" rows={2} />
                    </div>

                    {/* Text */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Text {textRequiresAsterisk && <span style={{ color: '#ff4444' }}>*</span>}</label>
                        <textarea value={text} onChange={(e) => { setText(e.target.value); if (errors.text) setErrors({ ...errors, text: undefined }); }} className={`editor-textarea ${errors.text ? 'error' : ''}`} placeholder="Context text content (optional if using URLs or search terms)" rows={6} />
                        {errors.text && <div className="editor-error-message">{errors.text}</div>}
                    </div>

                    {/* Images */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Images {imagesRequiresAsterisk && <span style={{ color: '#ff4444' }}>*</span>}</label>
                        <div className="editor-image-grid">
                            {imagePreviews.map((preview, index) => (
                                <div key={index} className="editor-image-square active">
                                    <img src={preview} alt={`Context image ${index + 1}`} />
                                    <button type="button" onClick={() => handleRemoveImage(index)} className="editor-image-remove-btn">×</button>
                                </div>
                            ))}
                            <div className={`editor-image-square editor-upload-square ${isUploading ? 'disabled' : ''}`} onClick={() => !isUploading && fileInputRef.current?.click()}>
                                <div style={{ textAlign: 'center', color: 'var(--text-h)', opacity: 0.5 }}>
                                    <div style={{ fontSize: '1.5rem' }}>{isUploading ? '⏳' : '📷'}</div>
                                    <div style={{ fontSize: '0.7rem', marginTop: '4px' }}>{isUploading ? 'Uploading...' : 'Upload'}</div>
                                </div>
                            </div>
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleImageChange} disabled={isUploading} />
                        {errors.images && <div className="editor-error-message">{errors.images}</div>}
                    </div>

                    {/* Web Content Sources — Search Terms first, then Direct URLs */}
                    <div className="editor-section">
                        <span className="editor-section-title">Web Content Sources</span>

                        {/* Search Terms — TOP */}
                        <div style={{ marginBottom: '16px' }}>
                            <label className="editor-label editor-label-small">Search Terms</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', justifyContent: searchTerms.length === 0 ? 'center' : 'flex-start' }}>
                                {searchTerms.length === 0 && (
                                    <div style={{ fontSize: '0.75rem', opacity: 0.5, fontStyle: 'italic', textAlign: 'center', width: '100%', padding: '8px 0' }}>No search terms added.</div>
                                )}
                                {searchTerms.map((term, index) => (
                                    <div key={`${term}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: 'var(--social-bg)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-h)' }}>{term}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveSearchTerm(index)}
                                            style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: '0 2px' }}
                                            title="Remove term"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                                <input
                                    type="text"
                                    value={newSearchTermInput}
                                    onChange={(e) => setNewSearchTermInput(e.target.value)}
                                    onKeyDown={handleSearchTermInputKeyDown}
                                    className="editor-input"
                                    placeholder="magic system eldoria"
                                    style={{ flex: 1, fontSize: '0.75rem' }}
                                />
                                <button
                                    type="button"
                                    onClick={handleAddSearchTerm}
                                    className="editor-btn editor-btn-save"
                                    style={{ padding: '0 12px', fontSize: '0.75rem', minHeight: '36px', flexShrink: 0 }}
                                    disabled={!newSearchTermInput.trim()}
                                >
                                    Add
                                </button>
                            </div>
                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Press Enter or click Add to add a term.</div>
                        </div>

                        {/* ✅ Include Link Images — ABOVE Search Engine */}
                        {hasWebContent && (
                            <div style={{ marginBottom: '12px' }}>
                                <label className="editor-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={includeLinkImages}
                                        onChange={(e) => setIncludeLinkImages(e.target.checked)}
                                        className="editor-checkbox-input"
                                    />
                                    <span>Include Link Images</span>
                                </label>
                                <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                                    Extract images from fetched pages and include them in summaries.
                                </div>
                            </div>
                        )}

                        {/* Search Engine selector — shown when search terms exist */}
                        {hasSearchTerms && (
                            <div style={{ marginBottom: '16px' }}>
                                <label className="editor-label editor-label-small">Search Engine</label>
                                <select
                                    value={searchEngine}
                                    onChange={(e) => setSearchEngine(e.target.value as searchEngine)}
                                    className="editor-select"
                                >
                                    {SEARCH_ENGINE_OPTIONS.map(engine => (
                                        <option key={engine} value={engine}>{engine}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Direct URLs — BELOW search terms */}
                        <div style={{ marginBottom: '12px' }}>
                            <label className="editor-label editor-label-small">Direct URLs</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                                {urls.length === 0 && (
                                    <div style={{ fontSize: '0.75rem', opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: '8px 0' }}>No direct URLs added.</div>
                                )}
                                {urls.map((url, index) => (
                                    <div key={`${url}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--social-bg)', borderRadius: '6px', border: '1px solid var(--border)', gap: '8px' }}>
                                        <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-h)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{url}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveUrl(index)}
                                            style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}
                                            title="Remove URL"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                                <input
                                    type="text"
                                    value={newUrlInput}
                                    onChange={(e) => { setNewUrlInput(e.target.value); if (errors.urls) setErrors(prev => ({ ...prev, urls: undefined })); }}
                                    onKeyDown={handleUrlInputKeyDown}
                                    className={`editor-input ${errors.urls && newUrlInput.trim().length > 0 ? 'error' : ''}`}
                                    placeholder="https://example.com/lore-page"
                                    style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem' }}
                                />
                                <button
                                    type="button"
                                    onClick={handleAddUrl}
                                    className="editor-btn editor-btn-save"
                                    style={{ padding: '0 12px', fontSize: '0.75rem', minHeight: '36px', flexShrink: 0 }}
                                    disabled={!newUrlInput.trim()}
                                >
                                    Add
                                </button>
                            </div>
                            {errors.urls && <div className="editor-error-message">{errors.urls}</div>}
                        </div>

                        {/* Shared fetch options — shown when any web content exists */}
                        {hasWebContent && (
                            <>
                                <div style={{ marginBottom: '12px' }}>
                                    <label className="editor-label">Fetch Mode</label>
                                    <select
                                        value={linkFetchMode}
                                        onChange={(e) => setLinkFetchMode(e.target.value)}
                                        className="editor-select"
                                    >
                                        <option value="full">Full — Use entire page content as-is</option>
                                        <option value="extract">Extract — Keep only structured data (headings, lists, definitions)</option>
                                        <option value="summary">Summary — Condense via LLM before injecting</option>
                                    </select>
                                </div>

                                <label className="editor-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={linkRecursionEnabled}
                                        onChange={(e) => setLinkRecursionEnabled(e.target.checked)}
                                        className="editor-checkbox-input"
                                    />
                                    <span>Follow Links Recursively</span>
                                </label>
                                <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                                    Also fetch pages linked from the fetched content.
                                </div>

                                {linkRecursionEnabled && (
                                    <div style={{ marginTop: '8px', marginBottom: '12px' }}>
                                        <label className="editor-label">Max Link Depth</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="5"
                                            value={linkMaxDepth}
                                            onChange={(e) => setLinkMaxDepth(Math.max(1, Math.min(5, Number(e.target.value) || 3)))}
                                            className="editor-input"
                                            style={{ textAlign: 'right' }}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>How many levels of links to follow (1–5)</div>
                                    </div>
                                )}

                                <div style={{ marginTop: '8px' }}>
                                    <label className="editor-label">Cache Time-To-Live (seconds)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="86400"
                                        step="60"
                                        value={Math.round(fetchCacheTimeToLiveMs / 1000)}
                                        onChange={(e) => setFetchCacheTimeToLiveMs(Math.max(0, Number(e.target.value) || 300) * 1000)}
                                        className="editor-input"
                                        style={{ textAlign: 'right' }}
                                    />
                                    <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>How long to cache fetched content. 0 = always refetch.</div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Regular Expression Section */}
                    <div className="editor-section">
                        <span className="editor-section-title">Regular Expression</span>
                        <div className="editor-row-full">
                            <div>
                                <label className="editor-label editor-label-small">Trigger Pattern</label>
                                <input type="text" value={regexTrigger} onChange={(e) => { setRegexTrigger(e.target.value); if (errors.regex) setErrors({ ...errors, regex: undefined }); setTestResult(null); }} className={`editor-input ${errors.regex ? 'error' : ''}`} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} placeholder="/pattern/i" />
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
                            <div style={{ marginTop: '8px' }}>
                                <label className="editor-label editor-label-small">Test Pattern</label>
                                <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                                    <input
                                        type="text"
                                        value={testText}
                                        onChange={(e) => { setTestText(e.target.value); setTestResult(null); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTestRegex(); } }}
                                        className="editor-input"
                                        style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem' }}
                                        placeholder="Test text"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleTestRegex}
                                        className="editor-btn editor-btn-save"
                                        style={{ padding: '0 12px', fontSize: '0.75rem', minHeight: '36px', flexShrink: 0 }}
                                        disabled={!testText.trim()}
                                    >
                                        Test
                                    </button>
                                </div>
                                {testResult !== null && (
                                    <div className={testResult ? 'editor-success-message' : 'editor-error-message'} style={{ marginTop: '4px' }}>
                                        {testResult ? '✅ Matches!' : '❌ No match'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Lorebook Section */}
                    <div className="editor-section">
                        <span className="editor-section-title">Lorebook</span>

                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Token Budget</label>
                                <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    value={tokenBudget}
                                    onChange={(e) => setTokenBudget(Math.max(0, Number.parseInt(e.target.value) || 0))}
                                    className="editor-input"
                                    style={{ textAlign: 'right', padding: '5px 8px', fontSize: '0.8rem' }}
                                    title="Max tokens this entry can consume. 0 = auto-estimate. Total budget: 2048. Bottom entries dropped first on overflow."
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px', textAlign: 'center' }}>0 = auto · bottom dropped first</div>
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Insertion Depth</label>
                                <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    value={insertionDepth}
                                    onChange={(e) => setInsertionDepth(Math.max(0, Number.parseInt(e.target.value) || 0))}
                                    className="editor-input"
                                    style={{ textAlign: 'right', padding: '5px 8px', fontSize: '0.8rem' }}
                                    title="Where in the prompt to place this entry. 0 = top of context block, higher = closer to chat history"
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px', textAlign: 'center' }}>0 = top · higher = closer to chat</div>
                            </div>
                        </div>

                        <div className="editor-row" style={{ marginTop: '10px' }}>
                            <div>
                                <label className="editor-label editor-label-small">Max Recursion Depth</label>
                                <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    max="10"
                                    value={maximumRecursionDepth}
                                    onChange={(e) => setMaximumRecursionDepth(Math.max(0, Math.min(10, Number.parseInt(e.target.value) || 0)))}
                                    className="editor-input"
                                    style={{ textAlign: 'right', padding: '5px 8px', fontSize: '0.8rem' }}
                                    title="Max recursion depth for lorebook scanning. 0 = direct scan only, never recursive. Default: 5."
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px', textAlign: 'center' }}>0 = no recursion · default: 5</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', paddingTop: '20px' }}>
                                <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                    <input
                                        type="checkbox"
                                        checked={recursiveScan}
                                        onChange={(e) => setRecursiveScan(e.target.checked)}
                                        className="editor-checkbox-input"
                                    />
                                    <span style={{ fontSize: '0.8rem' }}>Recursive Scan</span>
                                </label>
                            </div>
                        </div>
                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginLeft: '26px', marginTop: '-2px' }}>
                            This entry's text can trigger other entries during recursion
                        </div>

                        {allCharacters.length > 0 && (
                            <div style={{ marginTop: '12px' }}>
                                <span className="editor-label editor-label-small">Character Bindings</span>
                                <div style={{ fontSize: '0.6rem', opacity: 0.5, marginBottom: '8px' }}>
                                    Only inject when these characters speak. Empty = all characters.
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                                    {characterBindings.length === 0 && (
                                        <div style={{ fontSize: '0.75rem', opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: '8px 0' }}>No character bindings — applies to all.</div>
                                    )}
                                    {characterBindings.map(id => {
                                        const char = getCharacterById(id);
                                        if (!char) return null;
                                        return (
                                            <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--social-bg)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                                <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-h)' }}>{char.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setCharacterBindings(prev => prev.filter(cid => cid !== id))}
                                                    style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: '0 4px' }}
                                                    title="Remove binding"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>

                                <select
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val && !characterBindings.includes(val)) {
                                            setCharacterBindings(prev => [...prev, val]);
                                        }
                                        e.target.value = "";
                                    }}
                                    className="editor-select"
                                    defaultValue=""
                                >
                                    <option value="" disabled>+ Bind to a character</option>
                                    {allCharacters.filter(c => !characterBindings.includes(c.id)).map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Base64 Encoding Toggle */}
                    <div className="editor-toggle-section">
                        <label className="editor-checkbox-label">
                            <input
                                type="checkbox"
                                checked={useBase64Encoding}
                                onChange={(e) => setUseBase64Encoding(e.target.checked)}
                                className="editor-checkbox-input"
                            />
                            <span className="editor-label">Encode text as Base64</span>
                        </label>
                    </div>

                </div>
            </div>
        </div>
    );
}