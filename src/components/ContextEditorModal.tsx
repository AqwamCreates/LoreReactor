// src/components/ContextEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { Context, Character } from '../types';
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
    const [errors, setErrors] = useState<{ name?: string; text?: string; regex?: string; images?: string }>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ✅ Lorebook fields
    const [tokenBudget, setTokenBudget] = useState<number>(0);
    const [recursiveScan, setRecursiveScan] = useState<boolean>(false);
    const [maximumRecursionDepth, setMaximumRecursionDepth] = useState<number>(5);
    const [insertionDepth, setInsertionDepth] = useState<number>(0);
    const [characterBindings, setCharacterBindings] = useState<string[]>([]);

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

                // ✅ Load lorebook fields
                setTokenBudget(existingContext.tokenBudget ?? 0);
                setRecursiveScan(existingContext.recursiveScan ?? false);
                setMaximumRecursionDepth(existingContext.maximumRecursionDepth ?? 5);
                setInsertionDepth(existingContext.insertionDepth ?? 0);
                setCharacterBindings(existingContext.characterBindings ?? []);
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

                // ✅ Default lorebook fields
                setTokenBudget(0);
                setRecursiveScan(false);
                setMaximumRecursionDepth(5);
                setInsertionDepth(0);
                setCharacterBindings([]);
            }
            setErrors({});
            setTestText('');
            setTestResult(null);
        }
    }, [isOpen, existingContext]);

    const validate = (): boolean => {
        const newErrors: { name?: string; text?: string; regex?: string; images?: string } = {};
        if (!name.trim()) newErrors.name = 'Name is required.';
        if (!text.trim() && imagePreviews.length === 0 && imageFiles.length === 0) {
            newErrors.text = 'Either text or images are required.';
            newErrors.images = 'Either text or images are required.';
        }
        if (regexTrigger.trim()) {
            try { new RegExp(regexTrigger); } catch (e) { newErrors.regex = 'Invalid regular expression pattern.'; }
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
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

    // ✅ Shared logic to build a context object from current form state
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
            // ✅ Lorebook fields — only include non-default values to keep data clean
            tokenBudget: tokenBudget > 0 ? tokenBudget : undefined,
            recursiveScan: recursiveScan || undefined,
            maximumRecursionDepth: maximumRecursionDepth !== 5 ? maximumRecursionDepth : undefined,
            insertionDepth: insertionDepth !== 0 ? insertionDepth : undefined,
            characterBindings: characterBindings.length > 0 ? characterBindings : undefined,
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

    // ✅ Clone: save as new context with a new ID and "(Clone)" suffix
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
    const textRequiresAsterisk = !hasImages;
    const imagesRequiresAsterisk = !hasText;

    // ✅ Helper to get character by ID
    const getCharacterById = (id: string) => allCharacters.find(c => c.id === id);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingContext ? 'Edit Context' : 'Create New Context'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {/* ✅ Clone button — only shown when editing an existing context */}
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
                        <textarea value={text} onChange={(e) => { setText(e.target.value); if (errors.text) setErrors({ ...errors, text: undefined }); }} className={`editor-textarea ${errors.text ? 'error' : ''}`} placeholder="Context text content" rows={6} />
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
                                <div className="editor-tester-row">
                                    <input type="text" value={testText} onChange={(e) => { setTestText(e.target.value); setTestResult(null); }} className="editor-input" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }} placeholder="Test text" />
                                    <button type="button" onClick={handleTestRegex} className="editor-btn editor-btn-test">Test</button>
                                </div>
                                <div className="editor-test-result-container">
                                    {testResult !== null && (<div className={testResult ? 'editor-success-message' : 'editor-error-message'}>{testResult ? '✅ Matches!' : '❌ No match'}</div>)}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ✅ Lorebook Section */}
                    <div className="editor-section">
                        <span className="editor-section-title">Lorebook</span>

                        {/* Token Budget + Insertion Depth row */}
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

                        {/* Max Recursion Depth + Recursive Scan toggle */}
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

                        {/* ✅ Character Bindings — dropdown-add pattern like ModelEditorModal stop patterns */}
                        {allCharacters.length > 0 && (
                            <div style={{ marginTop: '12px' }}>
                                <span className="editor-label editor-label-small">Character Bindings</span>
                                <div style={{ fontSize: '0.6rem', opacity: 0.5, marginBottom: '8px' }}>
                                    Only inject when these characters speak. Empty = all characters.
                                </div>

                                {/* Selected bindings list */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                                    {characterBindings.length === 0 && (
                                        <div style={{ fontSize: '0.75rem', opacity: 0.5, fontStyle: 'italic' }}>No character bindings — applies to all.</div>
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

                                {/* Dropdown to add */}
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