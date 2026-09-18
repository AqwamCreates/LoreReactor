// src/components/StopPatternEditorModal.tsx
import { useState } from 'react';
import type { StopPattern, RegularExpressionTrigger } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { RegularExpressionTriggerEditor } from './RegularExpressionTriggerEditor';
import '../main.css';

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
    if (!isOpen) return null;

    const modalKey = `sp-${existingStopPattern?.id ?? 'new'}`;

    return (
        <StopPatternEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingStopPattern={existingStopPattern}
        />
    );
}

function StopPatternEditorModalInner({
    onClose,
    onSave,
    existingStopPattern,
}: Omit<StopPatternEditorModalProps, 'isOpen'>) {
    const [name, setName] = useState(existingStopPattern?.name || '');
    const [description, setDescription] = useState(existingStopPattern?.description || '');
    const [pattern, setPattern] = useState(existingStopPattern?.pattern || '');

    const [regexActivationTriggers, setRegexActivationTriggers] = useState<RegularExpressionTrigger[]>(existingStopPattern?.regularExpressionActivationTriggers ?? []);
    const [regexDeactivationTriggers, setRegexDeactivationTriggers] = useState<RegularExpressionTrigger[]>(existingStopPattern?.regularExpressionDeactivationTriggers ?? []);

    const [errors, setErrors] = useState<Record<string, string | undefined>>({});

    const validate = (): boolean => {
        const newErrors: Record<string, string | undefined> = {};

        if (!name.trim()) newErrors.name = 'Name is required.';
        if (!pattern.trim()) newErrors.pattern = 'Stop pattern is required.';

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

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0 && valid;
    };

    const buildStopPatternFromForm = (isNewClone: boolean): StopPattern | null => {
        if (!validate()) return null;

        const now = Date.now();

        const filterTriggers = (trs: RegularExpressionTrigger[]) => {
            const filtered = trs.filter(t => t.trigger.trim());
            return filtered.length > 0 ? filtered : undefined;
        };

        return {
            id: isNewClone ? uuidv4() : (existingStopPattern?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            pattern: pattern.trim(),
            regularExpressionActivationTriggers: filterTriggers(regexActivationTriggers),
            regularExpressionDeactivationTriggers: filterTriggers(regexDeactivationTriggers),
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

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingStopPattern ? 'Edit Stop Pattern' : 'Create New Stop Pattern'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        {existingStopPattern && (
                            <button type="button" className="editor-button editor-button-cancel" onClick={handleClone}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit}>Save</button>
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

                    {/* Regular Expression Triggers */}
                    <div className="editor-section">
                        <span className="editor-section-title">Regular Expression Triggers</span>
                        <RegularExpressionTriggerEditor
                            label="Activation"
                            description="Stop pattern activates when any trigger matches."
                            triggers={regexActivationTriggers}
                            onChange={setRegexActivationTriggers}
                            error={errors.regex}
                            placeholder="/battle|combat|fight/i"
                        />
                        <RegularExpressionTriggerEditor
                            label="Deactivation"
                            description="Deactivates stop pattern when any trigger matches."
                            triggers={regexDeactivationTriggers}
                            onChange={setRegexDeactivationTriggers}
                            error={errors.deactivationRegex}
                            placeholder="/peace|calm|aftermath/i"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}