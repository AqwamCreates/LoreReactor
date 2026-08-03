// src/components/StopPatternEditorModal.tsx
import type React from 'react';
import { useState, useEffect } from 'react';
import type { StopPattern } from '../types';
import './main.css';

interface StopPatternEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (stopPattern: StopPattern) => void;
    onDelete?: (id: string) => void;
    existingStopPattern?: StopPattern | null;
}

export function StopPatternEditorModal({
    isOpen,
    onClose,
    onSave,
    onDelete,
    existingStopPattern,
}: StopPatternEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [pattern, setPattern] = useState('');
    const [regexTrigger, setRegexTrigger] = useState('');
    const [regexContext, setRegexContext] = useState<'global' | 'local' | 'previous'>('global');
    const [regexTarget, setRegexTarget] = useState<'everyone' | 'listener' | 'self'>('everyone');
    const [testText, setTestText] = useState('');
    const [testResult, setTestResult] = useState<boolean | null>(null);
    const [errors, setErrors] = useState<{ name?: string; pattern?: string; regex?: string }>({});

    useEffect(() => {
        if (isOpen) {
            if (existingStopPattern) {
                setName(existingStopPattern.name || '');
                setDescription(existingStopPattern.description || '');
                setPattern(existingStopPattern.pattern || '');
                setRegexTrigger(existingStopPattern.regularExpressionTrigger || '');
                setRegexContext(existingStopPattern.regularExpressionContext || 'global');
                setRegexTarget(existingStopPattern.regularExpressionTarget || 'everyone');
            } else {
                setName('');
                setDescription('');
                setPattern('');
                setRegexTrigger('');
                setRegexContext('global');
                setRegexTarget('everyone');
            }
            setErrors({});
            setTestText('');
            setTestResult(null);
        }
    }, [isOpen, existingStopPattern]);

    const validate = (): boolean => {
        const newErrors: { name?: string; pattern?: string; regex?: string } = {};
        
        if (!name.trim()) {
            newErrors.name = 'Stop pattern name is required.';
        }
        
        if (!pattern.trim()) {
            newErrors.pattern = 'Stop pattern is required.';
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

    const handleSubmit = () => {
        if (!validate()) return;

        const now = Date.now();
        const stopPattern: StopPattern = {
            id: existingStopPattern?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim() || undefined,
            pattern: pattern.trim(),
            regularExpressionTrigger: regexTrigger.trim() || undefined,
            regularExpressionContext: regexContext,
            regularExpressionTarget: regexTarget,
            firstCreatedTimestamp: existingStopPattern?.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: now,
        };

        onSave(stopPattern);
        onClose();
    };

    const handleDelete = () => {
        if (!existingStopPattern) return;
        if (!window.confirm(`Delete stop pattern "${existingStopPattern.name}" permanently?`)) return;
        onDelete?.(existingStopPattern.id);
        onClose();
    };

    if (!isOpen) return null;

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

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '600px', maxHeight: '90vh', overflow: 'hidden' }}
            >
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <h2>{existingStopPattern ? 'Edit Stop Pattern' : 'Create New Stop Pattern'}</h2>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {existingStopPattern && onDelete && (
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
                            {existingStopPattern ? 'Update' : 'Create'}
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
                            placeholder="End Of Turn, Character Stop, Paragraph Stop"
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
                            placeholder="Brief description of when to use this stop pattern"
                            rows={2}
                        />
                    </div>

                    {/* Pattern */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>
                            Pattern <span style={{ color: '#ff4444' }}>*</span>
                        </label>
                        <textarea
                            value={pattern}
                            onChange={(e) => {
                                setPattern(e.target.value);
                                if (errors.pattern) setErrors({ ...errors, pattern: undefined });
                            }}
                            style={{
                                ...inputStyle,
                                minHeight: '60px',
                                borderColor: errors.pattern ? '#ff4444' : 'var(--border)',
                                fontFamily: 'monospace',
                            }}
                            placeholder="\\n\\n or \\nCharacter 2: or <|end_of_turn|>"
                            rows={3}
                        />
                        {errors.pattern && <div style={errorStyle}>{errors.pattern}</div>}
                    </div>

                    {/* Regular Expression Section */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>Regular Expression</div>

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
                                    placeholder="/battle|combat|fight/i"
                                />
                                {errors.regex && <div style={errorStyle}>{errors.regex}</div>}
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
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Target</label>
                                <select
                                    value={regexTarget}
                                    onChange={(e) => setRegexTarget(e.target.value as 'everyone' | 'listener' | 'self')}
                                    style={selectStyle}
                                    disabled={!regexTrigger.trim()}
                                >
                                    <option value="everyone">Everyone</option>
                                    <option value="listener">Listener</option>
                                    <option value="self">Self</option>
                                </select>
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