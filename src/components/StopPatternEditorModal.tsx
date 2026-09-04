// src/components/StopPatternEditorModal.tsx
import { useState, useEffect } from 'react';
import type { StopPattern } from '../types';
import { v4 as uuidv4 } from 'uuid';
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
    const [regexActivationTrigger, setRegexActivationTrigger] = useState('');
    const [regexDeactivationTrigger, setRegexDeactivationTrigger] = useState('');
    const [regexContext, setRegexContext] = useState<'global' | 'local' | 'previous'>('global');
    const [regexTarget, setRegexTarget] = useState<'everyone' | 'listener' | 'self'>('everyone');

    const [activationTestText, setActivationTestText] = useState('');
    const [activationTestResult, setActivationTestResult] = useState<boolean | null>(null);

    const [deactivationTestText, setDeactivationTestText] = useState('');
    const [deactivationTestResult, setDeactivationTestResult] = useState<boolean | null>(null);

    const [errors, setErrors] = useState<{ name?: string; pattern?: string; regex?: string; deactivationRegex?: string }>({});

    useEffect(() => {
        if (isOpen) {
            if (existingStopPattern) {
                setName(existingStopPattern.name || '');
                setDescription(existingStopPattern.description || '');
                setPattern(existingStopPattern.pattern || '');
                setRegexActivationTrigger(existingStopPattern.regularExpressionActivationTrigger || '');
                setRegexDeactivationTrigger(existingStopPattern.regularExpressionDeactivationTrigger || '');
                setRegexContext(existingStopPattern.regularExpressionContext || 'global');
                setRegexTarget(existingStopPattern.regularExpressionTarget || 'everyone');
            } else {
                setName('');
                setDescription('');
                setPattern('');
                setRegexActivationTrigger('');
                setRegexDeactivationTrigger('');
                setRegexContext('global');
                setRegexTarget('everyone');
            }

            setErrors({});

            setActivationTestText('');
            setActivationTestResult(null);

            setDeactivationTestText('');
            setDeactivationTestResult(null);
        }
    }, [isOpen, existingStopPattern]);

    const validate = (): boolean => {
        const newErrors: { name?: string; pattern?: string; regex?: string; deactivationRegex?: string } = {};

        if (!name.trim()) newErrors.name = 'Name is required.';
        if (!pattern.trim()) newErrors.pattern = 'Stop pattern is required.';

        if (regexActivationTrigger.trim()) {
            try {
                new RegExp(regexActivationTrigger);
            } catch (e) {
                newErrors.regex = 'Invalid activation regular expression.';
            }
        }

        if (regexDeactivationTrigger.trim()) {
            try {
                new RegExp(regexDeactivationTrigger);
            } catch (e) {
                newErrors.deactivationRegex = 'Invalid deactivation regular expression.';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleTestActivationRegex = () => {
        if (!regexActivationTrigger.trim() || !activationTestText.trim()) {
            setActivationTestResult(null);
            return;
        }

        try {
            const regex = new RegExp(regexActivationTrigger);
            setActivationTestResult(regex.test(activationTestText));
        } catch (e) {
            setActivationTestResult(null);
            setErrors(prev => ({ ...prev, regex: 'Invalid activation regular expression.' }));
        }
    };

    const handleTestDeactivationRegex = () => {
        if (!regexDeactivationTrigger.trim() || !deactivationTestText.trim()) {
            setDeactivationTestResult(null);
            return;
        }

        try {
            const regex = new RegExp(regexDeactivationTrigger);
            setDeactivationTestResult(regex.test(deactivationTestText));
        } catch (e) {
            setDeactivationTestResult(null);
            setErrors(prev => ({ ...prev, deactivationRegex: 'Invalid deactivation regular expression.' }));
        }
    };

    const buildStopPatternFromForm = (isNewClone: boolean): StopPattern | null => {
        if (!validate()) return null;

        const now = Date.now();
        return {
            id: isNewClone ? uuidv4() : (existingStopPattern?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            pattern: pattern.trim(),
            regularExpressionActivationTrigger: regexActivationTrigger.trim() || undefined,
            regularExpressionDeactivationTrigger: regexDeactivationTrigger.trim() || undefined,
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
                            onChange={(e) => {
                                setName(e.target.value);
                                if (errors.name) setErrors({ ...errors, name: undefined });
                            }}
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
                            onChange={(e) => {
                                setPattern(e.target.value);
                                if (errors.pattern) setErrors({ ...errors, pattern: undefined });
                            }}
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

                        {/* Activation Trigger */}
                        <div className="editor-row-full">
                            <div>
                                <label className="editor-label editor-label-small">Activation Trigger</label>
                                <input
                                    type="text"
                                    value={regexActivationTrigger}
                                    onChange={(e) => {
                                        setRegexActivationTrigger(e.target.value);
                                        if (errors.regex) setErrors({ ...errors, regex: undefined });
                                        setActivationTestResult(null);
                                    }}
                                    className={`editor-input ${errors.regex ? 'error' : ''}`}
                                    style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                                    placeholder="/battle|combat|fight/i"
                                />
                                {errors.regex && <div className="editor-error-message">{errors.regex}</div>}
                            </div>
                        </div>

                        {/* Activation Regex Tester */}
                        {regexActivationTrigger.trim() && (
                            <div style={{ marginTop: '8px' }}>
                                <label className="editor-label editor-label-small">Test Activation Pattern</label>
                                <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                                    <input
                                        type="text"
                                        value={activationTestText}
                                        onChange={(e) => {
                                            setActivationTestText(e.target.value);
                                            setActivationTestResult(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleTestActivationRegex();
                                            }
                                        }}
                                        className="editor-input"
                                        style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem' }}
                                        placeholder="Enter text to test against the activation regex"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleTestActivationRegex}
                                        className="editor-btn editor-btn-save"
                                        style={{ padding: '0 12px', fontSize: '0.75rem', minHeight: '36px', flexShrink: 0 }}
                                        disabled={!activationTestText.trim()}
                                    >
                                        Test
                                    </button>
                                </div>
                                {activationTestResult !== null && (
                                    <div className={activationTestResult ? 'editor-success-message' : 'editor-error-message'} style={{ marginTop: '4px' }}>
                                        {activationTestResult ? '✅ Activation matches!' : '❌ Activation does not match'}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Deactivation Trigger */}
                        <div className="editor-row-full" style={{ marginTop: '12px' }}>
                            <div>
                                <label className="editor-label editor-label-small">Deactivation Trigger</label>
                                <input
                                    type="text"
                                    value={regexDeactivationTrigger}
                                    onChange={(e) => {
                                        setRegexDeactivationTrigger(e.target.value);
                                        if (errors.deactivationRegex) setErrors({ ...errors, deactivationRegex: undefined });
                                        setDeactivationTestResult(null);
                                    }}
                                    className={`editor-input ${errors.deactivationRegex ? 'error' : ''}`}
                                    style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                                    placeholder="/peace|calm|aftermath/i"
                                />
                                {errors.deactivationRegex && <div className="editor-error-message">{errors.deactivationRegex}</div>}
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Optional. Deactivates this stop pattern when matched.
                                </div>
                            </div>
                        </div>

                        {/* Deactivation Regex Tester */}
                        {regexDeactivationTrigger.trim() && (
                            <div style={{ marginTop: '8px' }}>
                                <label className="editor-label editor-label-small">Test Deactivation Pattern</label>
                                <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                                    <input
                                        type="text"
                                        value={deactivationTestText}
                                        onChange={(e) => {
                                            setDeactivationTestText(e.target.value);
                                            setDeactivationTestResult(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleTestDeactivationRegex();
                                            }
                                        }}
                                        className="editor-input"
                                        style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem' }}
                                        placeholder="Enter text to test against the deactivation regex"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleTestDeactivationRegex}
                                        className="editor-btn editor-btn-save"
                                        style={{ padding: '0 12px', fontSize: '0.75rem', minHeight: '36px', flexShrink: 0 }}
                                        disabled={!deactivationTestText.trim()}
                                    >
                                        Test
                                    </button>
                                </div>
                                {deactivationTestResult !== null && (
                                    <div className={deactivationTestResult ? 'editor-success-message' : 'editor-error-message'} style={{ marginTop: '4px' }}>
                                        {deactivationTestResult ? '✅ Deactivation matches!' : '❌ Deactivation does not match'}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Regex Context & Target */}
                        <div className="editor-row" style={{ marginTop: '8px' }}>
                            <div>
                                <label className="editor-label editor-label-small">Context</label>
                                <select
                                    value={regexContext}
                                    onChange={(e) => setRegexContext(e.target.value as any)}
                                    className="editor-select"
                                    disabled={!regexActivationTrigger.trim()}
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
                                    disabled={!regexActivationTrigger.trim()}
                                >
                                    <option value="everyone">Everyone</option>
                                    <option value="listener">Listener</option>
                                    <option value="self">Self</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}