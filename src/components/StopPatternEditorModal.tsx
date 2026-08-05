// src/components/StopPatternEditorModal.tsx
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
        
        if (!name.trim()) newErrors.name = 'Name is required.';
        if (!pattern.trim()) newErrors.pattern = 'Stop pattern is required.';
        
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
            setTestResult(regex.test(testText));
        } catch (e) {
            setTestResult(null);
            setErrors(prev => ({ ...prev, regex: 'Invalid regular expression pattern.' }));
        }
    };

    // ✅ Shared logic to build a stop pattern object from current form state
    const buildStopPatternFromForm = (isNewClone: boolean): StopPattern | null => {
        if (!validate()) return null;

        const now = Date.now();
        return {
            id: isNewClone ? crypto.randomUUID() : (existingStopPattern?.id || crypto.randomUUID()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            pattern: pattern.trim(),
            regularExpressionTrigger: regexTrigger.trim() || undefined,
            regularExpressionContext: regexContext,
            regularExpressionTarget: regexTarget,
            firstCreatedTimestamp: isNewClone ? now : (existingStopPattern?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = () => {
        const stopPattern = buildStopPatternFromForm(false);
        if (!stopPattern) return;
        onSave(stopPattern);
        onClose();
    };

    // ✅ Clone: save as new stop pattern with a new ID and "(Clone)" suffix
    const handleClone = () => {
        const clonedStopPattern = buildStopPatternFromForm(true);
        if (!clonedStopPattern) return;
        onSave(clonedStopPattern);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingStopPattern ? 'Edit Stop Pattern' : 'Create New Stop Pattern'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Cancel</button>
                        {/* ✅ Clone button — only shown when editing an existing stop pattern */}
                        {existingStopPattern && (
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Name <span style={{ color: '#ff4444' }}>*</span></label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }}
                            className={`editor-input ${errors.name ? 'error' : ''}`}
                            placeholder="End Of Turn, Character Stop, Paragraph Stop"
                        />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="editor-textarea"
                            placeholder="Brief description of when to use this stop pattern"
                            rows={2}
                        />
                    </div>

                    {/* Pattern */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Pattern <span style={{ color: '#ff4444' }}>*</span></label>
                        <textarea
                            value={pattern}
                            onChange={(e) => { setPattern(e.target.value); if (errors.pattern) setErrors({ ...errors, pattern: undefined }); }}
                            className={`editor-textarea whitespace-visible ${errors.pattern ? 'error' : ''}`}
                            placeholder="\n\n or \nCharacter 2: or <|end_of_turn|>"
                            rows={4}
                        />
                        {errors.pattern && <div className="editor-error-message">{errors.pattern}</div>}
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-h)', opacity: 0.6, marginTop: '4px' }}>
                            ℹ️ Newlines (<code>\n</code>) are visible in this box.
                        </div>
                    </div>

                    {/* Regular Expression Section */}
                    <div className="editor-section">
                        <span className="editor-section-title">Regular Expression</span>

                        {/* Regex Trigger */}
                        <div className="editor-row-full">
                            <div>
                                <label className="editor-label editor-label-small">Trigger Pattern</label>
                                <input
                                    type="text"
                                    value={regexTrigger}
                                    onChange={(e) => { setRegexTrigger(e.target.value); if (errors.regex) setErrors({ ...errors, regex: undefined }); setTestResult(null); }}
                                    className={`editor-input ${errors.regex ? 'error' : ''}`}
                                    style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                                    placeholder="/battle|combat|fight/i"
                                />
                                {errors.regex && <div className="editor-error-message">{errors.regex}</div>}
                            </div>
                        </div>

                        {/* Regex Context & Target */}
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Context</label>
                                <select
                                    value={regexContext}
                                    onChange={(e) => setRegexContext(e.target.value as any)}
                                    className="editor-select"
                                    disabled={!regexTrigger.trim()}
                                >
                                    <option value="global">Global</option>
                                    <option value="local">Local</option>
                                    <option value="previous">Previous</option>
                                </select>
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Target</label>
                                <select
                                    value={regexTarget}
                                    onChange={(e) => setRegexTarget(e.target.value as any)}
                                    className="editor-select"
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
                                <label className="editor-label editor-label-small">Test Pattern</label>
                                <div className="editor-tester-row">
                                    <input
                                        type="text"
                                        value={testText}
                                        onChange={(e) => { setTestText(e.target.value); setTestResult(null); }}
                                        className="editor-input"
                                        style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                                        placeholder="Enter text to test against the regex"
                                    />
                                    <button type="button" onClick={handleTestRegex} className="editor-btn editor-btn-test">
                                        Test
                                    </button>
                                </div>
                                <div className="editor-test-result-container">
                                    {testResult !== null && (
                                        <div className={testResult ? 'editor-success-message' : 'editor-error-message'}>
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