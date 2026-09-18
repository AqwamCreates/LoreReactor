// src/components/RegularExpressionTriggerEditor.tsx
import { useState, useCallback } from 'react';
import type { RegularExpressionTrigger, regularExpressionContext, regularExpressionTarget } from '../types';

const CONTEXT_OPTIONS: { value: regularExpressionContext; label: string }[] = [
    { value: 'global', label: 'Global' },
    { value: 'local', label: 'Local' },
    { value: 'previous', label: 'Previous' },
];

const TARGET_OPTIONS: { value: regularExpressionTarget; label: string }[] = [
    { value: 'everyone', label: 'Everyone' },
    { value: 'listener', label: 'Listener' },
    { value: 'self', label: 'Self' },
    { value: 'protagonist', label: 'Protagonist' },
    { value: 'narrator', label: 'Narrator' },
];

interface RegularExpressionTriggerEditorProps {
    label: string;
    description?: string;
    triggers: RegularExpressionTrigger[];
    onChange: (triggers: RegularExpressionTrigger[]) => void;
    error?: string;
    placeholder?: string;
}

export function RegularExpressionTriggerEditor({
    label,
    description,
    triggers,
    onChange,
    error,
    placeholder = '/pattern/i',
}: RegularExpressionTriggerEditorProps) {
    const [testTexts, setTestTexts] = useState<Record<number, string>>({});
    const [testResults, setTestResults] = useState<Record<number, boolean | null>>({});

    const handleAdd = useCallback(() => {
        onChange([...triggers, { trigger: '', context: 'global', target: 'everyone' }]);
    }, [triggers, onChange]);

    const handleRemove = useCallback((index: number) => {
        onChange(triggers.filter((_, i) => i !== index));
        setTestTexts(prev => { const next = { ...prev }; delete next[index]; return next; });
        setTestResults(prev => { const next = { ...prev }; delete next[index]; return next; });
    }, [triggers, onChange]);

    const updateField = useCallback((index: number, field: keyof RegularExpressionTrigger, value: string) => {
        const updated = [...triggers];
        updated[index] = { ...updated[index], [field]: value };
        onChange(updated);
        setTestResults(prev => ({ ...prev, [index]: null }));
    }, [triggers, onChange]);

    const handleTest = useCallback((index: number) => {
        const t = testTexts[index];
        const pattern = triggers[index]?.trigger;
        if (!pattern?.trim() || !t?.trim()) {
            setTestResults(prev => ({ ...prev, [index]: null }));
            return;
        }
        try {
            const regex = new RegExp(pattern);
            setTestResults(prev => ({ ...prev, [index]: regex.test(t) }));
        } catch {
            setTestResults(prev => ({ ...prev, [index]: null }));
        }
    }, [testTexts, triggers]);

    const setTestText = useCallback((index: number, value: string) => {
        setTestTexts(prev => ({ ...prev, [index]: value }));
        setTestResults(prev => ({ ...prev, [index]: null }));
    }, []);

    return (
        <div className="regex-trigger-section">
            <div className="regex-trigger-section-header">
                <span className="regex-trigger-section-title">{label}</span>
                {description && <span className="regex-trigger-section-desc">{description}</span>}
            </div>

            {triggers.length === 0 && <div className="regex-trigger-empty">No triggers configured.</div>}

            <div className="regex-trigger-list">
                {triggers.map((t, i) => (
                    <div key={i}>
                        <div className={`regex-trigger-row ${error ? 'error' : ''}`}>
                            <input
                                type="text"
                                value={t.trigger}
                                onChange={(e) => updateField(i, 'trigger', e.target.value)}
                                className="regex-trigger-input"
                                placeholder={placeholder}
                            />
                            <select
                                value={t.context}
                                onChange={(e) => updateField(i, 'context', e.target.value)}
                                className="regex-trigger-select"
                                title="Context scope"
                            >
                                {CONTEXT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <select
                                value={t.target}
                                onChange={(e) => updateField(i, 'target', e.target.value)}
                                className="regex-trigger-select"
                                title="Target"
                            >
                                {TARGET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            {t.trigger.trim() && (
                                <button
                                    type="button"
                                    className="regex-trigger-test-btn"
                                    onClick={() => handleTest(i)}
                                    disabled={!testTexts[i]?.trim()}
                                    title="Test this trigger"
                                >
                                    🧪
                                </button>
                            )}
                            <button
                                type="button"
                                className="regex-trigger-remove-btn"
                                onClick={() => handleRemove(i)}
                                title="Remove trigger"
                            >
                                ×
                            </button>
                        </div>
                        {t.trigger.trim() && (
                            <div className="regex-trigger-test-row">
                                <input
                                    type="text"
                                    value={testTexts[i] || ''}
                                    onChange={(e) => setTestText(i, e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTest(i); } }}
                                    className="regex-trigger-test-input"
                                    placeholder="Type test text and press Enter..."
                                />
                                {testResults[i] !== null && (
                                    <span className={`regex-trigger-result ${testResults[i] ? 'match' : 'no-match'}`}>
                                        {testResults[i] ? '✅ Match' : '❌ No match'}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <button type="button" className="regex-trigger-add-btn" onClick={handleAdd}>+ Add Trigger</button>
            {error && <div className="regex-trigger-error">{error}</div>}
        </div>
    );
}