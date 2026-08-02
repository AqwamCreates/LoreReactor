// src/components/ContextEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { Context } from '../types';
import './main.css';

interface ContextEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (context: Context) => void;
    onDelete?: (id: string) => void;
    existingContext?: Context | null;
}

export function ContextEditorModal({
    isOpen,
    onClose,
    onSave,
    onDelete,
    existingContext,
}: ContextEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [text, setText] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [regexTrigger, setRegexTrigger] = useState('');
    const [regexContext, setRegexContext] = useState<'global' | 'local' | 'previous'>('global');
    const [regexTarget, setRegexTarget] = useState<'everyone' | 'responder' | 'self'>('everyone');
    const [testText, setTestText] = useState('');
    const [testResult, setTestResult] = useState<boolean | null>(null);
    const [errors, setErrors] = useState<{ name?: string; text?: string; regex?: string; images?: string }>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            if (existingContext) {
                setName(existingContext.name || '');
                setDescription(existingContext.description || '');
                setText(existingContext.text || '');
                setImages(existingContext.images || []);
                setRegexTrigger(existingContext.regularExpressionTrigger || '');
                setRegexContext(existingContext.regularExpressionContext || 'global');
                setRegexTarget(existingContext.regularExpressionTarget || 'everyone');
            } else {
                setName('');
                setDescription('');
                setText('');
                setImages([]);
                setImageFiles([]);
                setImagePreviews([]);
                setRegexTrigger('');
                setRegexContext('global');
                setRegexTarget('everyone');
            }
            setErrors({});
            setTestText('');
            setTestResult(null);
        }
    }, [isOpen, existingContext]);

    const validate = (): boolean => {
        const newErrors: { name?: string; text?: string; regex?: string; images?: string } = {};
        
        if (!name.trim()) {
            newErrors.name = 'Context name is required.';
        }
        
        // Validate that either text OR images are provided
        if (!text.trim() && images.length === 0) {
            newErrors.text = 'Either text or images are required.';
            newErrors.images = 'Either text or images are required.';
        }
        
        // Validate regex if provided
        if (regexTrigger.trim()) {
            try {
                new RegExp(regexTrigger);
            } catch (e) {
                newErrors.regex = 'Invalid regular expression pattern.';
            }
        }
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleTestRegex = () => {
        if (!regexTrigger.trim() || !testText.trim()) {
            setTestResult(null);
            return;
        }
        
        try {
            const regex = new RegExp(regexTrigger);
            const result = regex.test(testText);
            setTestResult(result);
        } catch (e) {
            setTestResult(null);
            setErrors(prev => ({ ...prev, regex: 'Invalid regular expression pattern.' }));
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            setImageFiles(prev => [...prev, ...files]);
            
            const newPreviews = files.map(file => URL.createObjectURL(file));
            setImagePreviews(prev => [...prev, ...newPreviews]);
            
            const newImages = files.map(file => file.name);
            setImages(prev => [...prev, ...newImages]);
            
            // Clear image error if it exists
            if (errors.images) {
                setErrors(prev => ({ ...prev, images: undefined }));
            }
        }
        e.target.value = '';
    };

    const handleRemoveImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
        setImageFiles(prev => prev.filter((_, i) => i !== index));
        setImagePreviews(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = () => {
        if (!validate()) return;

        const context: Context = {
            id: existingContext?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim() || undefined,
            text: text.trim() || undefined,
            images: images.length > 0 ? images : undefined,
            regularExpressionTrigger: regexTrigger.trim() || undefined,
            regularExpressionContext: regexContext,
            regularExpressionTarget: regexTarget,
        };

        onSave(context);
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
    const hasImages = images.length > 0;
    const isTextRequired = !hasImages && !hasText;
    const isImagesRequired = !hasText && !hasImages;

    const inputStyle: React.CSSProperties = {
        width: '100%',
        boxSizing: 'border-box',
        fontSize: '0.85rem',
        fontFamily: 'inherit',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        background: 'var(--social-bg)',
        color: 'var(--text-h)',
        outline: 'none',
        resize: 'vertical',
    };

    const selectStyle: React.CSSProperties = {
        ...inputStyle,
        appearance: 'auto',
        WebkitAppearance: 'auto',
        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
        paddingRight: '32px',
        backgroundColor: 'var(--social-bg)',
        color: 'var(--text-h)',
        cursor: 'pointer',
    };

    const labelStyle: React.CSSProperties = {
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: 'var(--text-h)',
        display: 'block',
        marginBottom: '4px',
        letterSpacing: '0.5px',
        opacity: 0.8,
    };

    const errorStyle: React.CSSProperties = {
        fontSize: '0.75rem',
        color: '#ff4444',
        marginTop: '4px',
    };

    const successStyle: React.CSSProperties = {
        fontSize: '0.75rem',
        color: 'var(--accent)',
        marginTop: '4px',
        textAlign: 'center',
    };

    const buttonStyle: React.CSSProperties = {
        padding: '8px 20px',
        fontSize: '0.85rem',
        fontWeight: 'bold',
        borderRadius: '6px',
        cursor: 'pointer',
        border: '1px solid transparent',
        fontFamily: 'inherit',
        transition: 'all 0.2s',
    };

    const testRowStyle: React.CSSProperties = {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        marginTop: '8px',
    };

    const helperStyle: React.CSSProperties = {
        fontSize: '0.65rem',
        color: 'var(--text-h)',
        opacity: 0.6,
        marginTop: '4px',
        fontStyle: 'italic',
    };

    const sectionStyle: React.CSSProperties = {
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px',
        background: 'rgba(0,0,0,0.02)',
    };

    const sectionTitleStyle: React.CSSProperties = {
        fontSize: '0.7rem',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: 'var(--text-h)',
        opacity: 0.6,
        marginBottom: '12px',
    };

    const rowStyle: React.CSSProperties = {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        marginBottom: '8px',
    };

    const fullRowStyle: React.CSSProperties = {
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: '12px',
        marginBottom: '8px',
    };

    const testResultContainerStyle: React.CSSProperties = {
        height: '24px',
        marginTop: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    };

    const imageContainerStyle: React.CSSProperties = {
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        marginTop: '8px',
    };

    const imagePreviewStyle: React.CSSProperties = {
        position: 'relative',
        width: '80px',
        height: '80px',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid var(--border)',
    };

    const imageRemoveButtonStyle: React.CSSProperties = {
        position: 'absolute',
        top: '2px',
        right: '2px',
        background: 'rgba(0,0,0,0.7)',
        border: 'none',
        color: '#fff',
        borderRadius: '50%',
        width: '20px',
        height: '20px',
        cursor: 'pointer',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '600px', maxHeight: '90vh', overflow: 'hidden' }}
            >
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <h2>{existingContext ? 'Edit Context' : 'Create New Context'}</h2>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {existingContext && onDelete && (
                            <button
                                type="button"
                                className="edit-btn edit-btn-delete"
                                onClick={handleDelete}
                                style={{
                                    ...buttonStyle,
                                    background: 'transparent',
                                    color: '#ff4444',
                                    border: '1px solid #ff4444',
                                }}
                            >
                                🗑️ Delete
                            </button>
                        )}
                        <button
                            type="button"
                            className="edit-btn edit-btn-cancel"
                            onClick={onClose}
                            style={{
                                ...buttonStyle,
                                background: 'transparent',
                                color: 'var(--text-h)',
                                border: '1px solid var(--border)',
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="edit-btn edit-btn-save"
                            onClick={handleSubmit}
                            style={{
                                ...buttonStyle,
                                background: 'var(--accent)',
                                color: '#fff',
                            }}
                        >
                            {existingContext ? 'Update' : 'Create'}
                        </button>
                    </div>
                </div>

                <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>
                            Name <span style={{ color: '#ff4444' }}>*</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                if (errors.name) setErrors({ ...errors, name: undefined });
                            }}
                            style={{
                                ...inputStyle,
                                borderColor: errors.name ? '#ff4444' : 'var(--border)',
                            }}
                            placeholder="e.g., Eldoria City Lore, Northern War, Magic System"
                        />
                        {errors.name && <div style={errorStyle}>{errors.name}</div>}
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            style={{ ...inputStyle, minHeight: '40px' }}
                            placeholder="Brief description of what this context covers"
                            rows={2}
                        />
                    </div>

                    {/* Text */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>
                            Text {isTextRequired && <span style={{ color: '#ff4444' }}>*</span>}
                        </label>
                        <textarea
                            value={text}
                            onChange={(e) => {
                                setText(e.target.value);
                                if (errors.text) setErrors({ ...errors, text: undefined });
                            }}
                            style={{
                                ...inputStyle,
                                minHeight: '120px',
                                borderColor: errors.text ? '#ff4444' : 'var(--border)',
                                fontFamily: 'monospace',
                            }}
                            placeholder="The context text that will be injected into the prompt"
                            rows={6}
                        />
                        {errors.text && <div style={errorStyle}>{errors.text}</div>}
                    </div>

                    {/* Images */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>
                            Images {isImagesRequired && <span style={{ color: '#ff4444' }}>*</span>}
                            <span
                                style={{
                                    fontSize: '0.65rem',
                                    opacity: 0.6,
                                    marginLeft: '8px',
                                    fontWeight: 'normal',
                                }}
                            >
                                Optional
                            </span>
                        </label>
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                width: '100%',
                                padding: '20px',
                                borderRadius: '6px',
                                border: `2px dashed ${errors.images ? '#ff4444' : 'var(--border)'}`,
                                background: 'var(--social-bg)',
                                cursor: 'pointer',
                                textAlign: 'center',
                                color: 'var(--text-h)',
                                opacity: 0.6,
                                transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                                if (!errors.images) e.currentTarget.style.borderColor = 'var(--accent)';
                            }}
                            onMouseLeave={(e) => {
                                if (!errors.images) e.currentTarget.style.borderColor = 'var(--border)';
                            }}
                        >
                            📷 Click to upload images
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleImageChange}
                            style={{ display: 'none' }}
                        />
                        {errors.images && <div style={errorStyle}>{errors.images}</div>}
                        {imagePreviews.length > 0 && (
                            <div style={imageContainerStyle}>
                                {imagePreviews.map((preview, index) => (
                                    <div key={index} style={imagePreviewStyle}>
                                        <img
                                            src={preview}
                                            alt={`Context image ${index + 1}`}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveImage(index)}
                                            style={imageRemoveButtonStyle}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Regular Expression Section */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>Regular Expression Settings</div>

                        {/* Regex Trigger */}
                        <div style={fullRowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Trigger Pattern</label>
                                <input
                                    type="text"
                                    value={regexTrigger}
                                    onChange={(e) => {
                                        setRegexTrigger(e.target.value);
                                        if (errors.regex) setErrors({ ...errors, regex: undefined });
                                        setTestResult(null);
                                    }}
                                    style={{
                                        ...inputStyle,
                                        borderColor: errors.regex ? '#ff4444' : 'var(--border)',
                                        fontFamily: 'monospace',
                                        fontSize: '0.75rem',
                                    }}
                                    placeholder="/Eldoria|floating islands|sky city/i"
                                />
                                {errors.regex && <div style={errorStyle}>{errors.regex}</div>}
                                <div style={helperStyle}>
                                    The context will only be injected when this pattern matches the conversation context.
                                </div>
                            </div>
                        </div>

                        {/* Regex Context & Target */}
                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Context</label>
                                <select
                                    value={regexContext}
                                    onChange={(e) => setRegexContext(e.target.value as 'global' | 'local' | 'previous')}
                                    style={selectStyle}
                                    disabled={!regexTrigger.trim()}
                                >
                                    <option value="global">Global</option>
                                    <option value="local">Local</option>
                                    <option value="previous">Previous</option>
                                </select>
                                <div style={helperStyle}>
                                    What part of the conversation to check.
                                </div>
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Target</label>
                                <select
                                    value={regexTarget}
                                    onChange={(e) => setRegexTarget(e.target.value as 'everyone' | 'responder' | 'self')}
                                    style={selectStyle}
                                    disabled={!regexTrigger.trim()}
                                >
                                    <option value="everyone">Everyone</option>
                                    <option value="responder">Responder</option>
                                    <option value="self">Self</option>
                                </select>
                                <div style={helperStyle}>
                                    Whose messages to check.
                                </div>
                            </div>
                        </div>

                        {/* Regex Tester */}
                        {regexTrigger.trim() && (
                            <div style={{ marginTop: '8px' }}>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Test Pattern</label>
                                <div style={testRowStyle}>
                                    <input
                                        type="text"
                                        value={testText}
                                        onChange={(e) => {
                                            setTestText(e.target.value);
                                            setTestResult(null);
                                        }}
                                        style={{
                                            ...inputStyle,
                                            flex: 1,
                                            fontFamily: 'monospace',
                                            fontSize: '0.75rem',
                                        }}
                                        placeholder="Enter text to test against the regex"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleTestRegex}
                                        style={{
                                            ...buttonStyle,
                                            background: 'var(--accent-bg)',
                                            color: 'var(--accent)',
                                            border: '1px solid var(--accent-border)',
                                            padding: '6px 16px',
                                            whiteSpace: 'nowrap',
                                            fontSize: '0.75rem',
                                        }}
                                    >
                                        Test
                                    </button>
                                </div>
                                <div style={testResultContainerStyle}>
                                    {testResult !== null && (
                                        <div style={testResult ? successStyle : errorStyle}>
                                            {testResult ? '✅ Matches!' : '❌ No match'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}