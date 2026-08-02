// src/components/BudgetStrategyEditorModal.tsx
import type React from 'react';
import { useState, useEffect } from 'react';
import type { BudgetStrategy, LanguageModel } from '../types';
import { SliderInput } from './SliderInput';
import './main.css';

interface BudgetStrategyEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (strategy: BudgetStrategy) => void;
    onDelete?: (id: string) => void;
    existingStrategy?: BudgetStrategy | null;
    allModels: LanguageModel[];
}

const DEFAULT_STRATEGY: Omit<BudgetStrategy, 'id' | 'firstCreatedTimestamp' | 'lastUpdatedTimestamp'> = {
    name: '',
    description: '',
    onlineModel: {} as LanguageModel,
    localModel: {} as LanguageModel,
    switchProbabilty: 20,       // ✅ Fixed spelling
    switchOnContextSize: 8192,
    switchOnComplexityScore: 70,
    fallbackOnLocalFailure: true,
    fallbackOnQualityThreshold: 30,
    fallbackOnTimeoutInSeconds: 30,
    maximumBudget: 10,
};

export function BudgetStrategyEditorModal({
    isOpen,
    onClose,
    onSave,
    onDelete,
    existingStrategy,
    allModels,
}: BudgetStrategyEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [onlineModelId, setOnlineModelId] = useState<string>('');
    const [localModelId, setLocalModelId] = useState<string>('');
    const [switchProbabilty, setSwitchProbabilty] = useState<number>(20);       // ✅ Fixed spelling
    const [switchOnContextSize, setSwitchOnContextSize] = useState<number>(8192);
    const [switchOnComplexityScore, setSwitchOnComplexityScore] = useState<number>(70);
    const [fallbackOnLocalFailure, setFallbackOnLocalFailure] = useState<boolean>(true);
    const [fallbackOnQualityThreshold, setFallbackOnQualityThreshold] = useState<number>(30);
    const [fallbackOnTimeoutInSeconds, setFallbackOnTimeoutInSeconds] = useState<number>(30);
    const [maximumBudget, setMaximumBudget] = useState<number>(10);
    const [errors, setErrors] = useState<{ name?: string; onlineModel?: string; localModel?: string }>({});

    useEffect(() => {
        if (isOpen) {
            if (existingStrategy) {
                setName(existingStrategy.name || '');
                setDescription(existingStrategy.description || '');
                setOnlineModelId(existingStrategy.onlineModel?.id || '');
                setLocalModelId(existingStrategy.localModel?.id || '');
                setSwitchProbabilty(existingStrategy.switchProbabilty ?? 20);       // ✅ Fixed spelling
                setSwitchOnContextSize(existingStrategy.switchOnContextSize ?? 8192);
                setSwitchOnComplexityScore(existingStrategy.switchOnComplexityScore ?? 70);
                setFallbackOnLocalFailure(existingStrategy.fallbackOnLocalFailure ?? true);
                setFallbackOnQualityThreshold(existingStrategy.fallbackOnQualityThreshold ?? 30);
                setFallbackOnTimeoutInSeconds(existingStrategy.fallbackOnTimeoutInSeconds ?? 30);
                setMaximumBudget(existingStrategy.maximumBudget ?? 10);
            } else {
                setName('');
                setDescription('');
                setOnlineModelId('');
                setLocalModelId('');
                setSwitchProbabilty(20);       // ✅ Fixed spelling
                setSwitchOnContextSize(8192);
                setSwitchOnComplexityScore(70);
                setFallbackOnLocalFailure(true);
                setFallbackOnQualityThreshold(30);
                setFallbackOnTimeoutInSeconds(30);
                setMaximumBudget(10);
            }
            setErrors({});
        }
    }, [isOpen, existingStrategy]);

    const validate = (): boolean => {
        const newErrors: { name?: string; onlineModel?: string; localModel?: string } = {};
        
        if (!name.trim()) {
            newErrors.name = 'Strategy name is required.';
        }
        
        if (!onlineModelId) {
            newErrors.onlineModel = 'Online model is required.';
        }
        
        if (!localModelId) {
            newErrors.localModel = 'Local model is required.';
        }
        
        if (onlineModelId && localModelId && onlineModelId === localModelId) {
            newErrors.onlineModel = 'Online and local models must be different.';
            newErrors.localModel = 'Online and local models must be different.';
        }
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = () => {
        if (!validate()) return;

        const onlineModel = allModels.find(m => m.id === onlineModelId);
        const localModel = allModels.find(m => m.id === localModelId);

        if (!onlineModel || !localModel) {
            alert('Selected models not found.');
            return;
        }

        const now = Date.now();
        const strategy: BudgetStrategy = {
            id: existingStrategy?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim() || '',
            onlineModel,
            localModel,
            switchProbabilty,       // ✅ Fixed spelling
            switchOnContextSize,
            switchOnComplexityScore,
            fallbackOnLocalFailure,
            fallbackOnQualityThreshold,
            fallbackOnTimeoutInSeconds,
            maximumBudget,
            firstCreatedTimestamp: existingStrategy?.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: now,
        };

        onSave(strategy);
        onClose();
    };

    const handleDelete = () => {
        if (!existingStrategy) return;
        if (!window.confirm(`Delete strategy "${existingStrategy.name}" permanently?`)) return;
        onDelete?.(existingStrategy.id);
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

    const checkboxStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
        userSelect: 'none',
    };

    const checkboxInputStyle: React.CSSProperties = {
        width: '16px',
        height: '16px',
        accentColor: 'var(--accent)',
        cursor: 'pointer',
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '700px', maxHeight: '95vh', overflow: 'hidden' }}
            >
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <h2>{existingStrategy ? 'Edit Budget Strategy' : 'Create Budget Strategy'}</h2>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {existingStrategy && onDelete && (
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
                            {existingStrategy ? 'Update' : 'Create'}
                        </button>
                    </div>
                </div>

                <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>
                            Strategy Name <span style={{ color: '#ff4444' }}>*</span>
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
                            placeholder="e.g., Balanced, Budget Saver, Quality Focused"
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
                            placeholder="Describe when to use this strategy"
                            rows={2}
                        />
                    </div>

                    {/* Model Selection */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>Model Selection</div>
                        
                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>
                                    Online Model <span style={{ color: '#ff4444' }}>*</span>
                                </label>
                                <select
                                    value={onlineModelId}
                                    onChange={(e) => {
                                        setOnlineModelId(e.target.value);
                                        if (errors.onlineModel) setErrors({ ...errors, onlineModel: undefined });
                                    }}
                                    style={{
                                        ...selectStyle,
                                        borderColor: errors.onlineModel ? '#ff4444' : 'var(--border)',
                                    }}
                                >
                                    <option value="">Select online model...</option>
                                    {allModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                                {errors.onlineModel && <div style={errorStyle}>{errors.onlineModel}</div>}
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>
                                    Local Model <span style={{ color: '#ff4444' }}>*</span>
                                </label>
                                <select
                                    value={localModelId}
                                    onChange={(e) => {
                                        setLocalModelId(e.target.value);
                                        if (errors.localModel) setErrors({ ...errors, localModel: undefined });
                                    }}
                                    style={{
                                        ...selectStyle,
                                        borderColor: errors.localModel ? '#ff4444' : 'var(--border)',
                                    }}
                                >
                                    <option value="">Select local model...</option>
                                    {allModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                                {errors.localModel && <div style={errorStyle}>{errors.localModel}</div>}
                            </div>
                        </div>
                    </div>

                    {/* Switching Rules */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>Switching Rules</div>
                        
                        <div style={fullRowStyle}>
                            <SliderInput
                                label="Online Model Probability"
                                value={switchProbabilty}
                                minimumValue={0}
                                maximumValue={100}
                                stepValue={1}
                                decimals={0}
                                onChange={setSwitchProbabilty}
                                description="Percentage chance to use online model (0 = always local, 100 = always online)"
                            />
                        </div>

                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Switch On Context Size</label>
                                <input
                                    type="number"
                                    value={switchOnContextSize}
                                    onChange={(e) => setSwitchOnContextSize(Number(e.target.value) || 0)}
                                    style={inputStyle}
                                    min="0"
                                    step="64"
                                    placeholder="8192"
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Switch On Complexity Score</label>
                                <input
                                    type="number"
                                    value={switchOnComplexityScore}
                                    onChange={(e) => setSwitchOnComplexityScore(Number(e.target.value) || 0)}
                                    style={inputStyle}
                                    min="0"
                                    max="100"
                                    step="1"
                                    placeholder="70"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Fallback Rules */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>Fallback Rules</div>
                        
                        <div style={fullRowStyle}>
                            <label style={checkboxStyle}>
                                <input
                                    type="checkbox"
                                    checked={fallbackOnLocalFailure}
                                    onChange={(e) => setFallbackOnLocalFailure(e.target.checked)}
                                    style={checkboxInputStyle}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-h)' }}>
                                    Fallback on local failure
                                </span>
                            </label>
                        </div>

                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Quality Threshold</label>
                                <input
                                    type="number"
                                    value={fallbackOnQualityThreshold}
                                    onChange={(e) => setFallbackOnQualityThreshold(Number(e.target.value) || 0)}
                                    style={inputStyle}
                                    min="0"
                                    max="100"
                                    step="1"
                                    placeholder="30"
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Fallback Timeout (Seconds)</label>
                                <input
                                    type="number"
                                    value={fallbackOnTimeoutInSeconds}
                                    onChange={(e) => setFallbackOnTimeoutInSeconds(Number(e.target.value) || 0)}
                                    style={inputStyle}
                                    min="1"
                                    step="1"
                                    placeholder="30"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Budget Control */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>Budget Control</div>
                        
                        <div style={fullRowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Maximum Budget ($)</label>
                                <input
                                    type="number"
                                    value={maximumBudget}
                                    onChange={(e) => setMaximumBudget(Number(e.target.value) || 0)}
                                    style={inputStyle}
                                    min="0"
                                    step="0.5"
                                    placeholder="10"
                                />
                                <div style={{
                                    fontSize: '0.6rem',
                                    color: 'var(--text-h)',
                                    opacity: 0.5,
                                    marginTop: '2px',
                                }}>
                                    When cost exceeds this, the strategy will switch to local-only mode
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}