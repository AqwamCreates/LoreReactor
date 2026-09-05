// src/components/BudgetStrategyEditorModal.tsx
import { useState, useEffect } from 'react';
import type { BudgetStrategy, LanguageModel } from '../types';
import { SliderInput } from './SliderInput';
import './main.css';
import { generateId } from '../core';

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
    switchProbabilty: 20,
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
    existingStrategy,
    allModels,
}: BudgetStrategyEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [onlineModelId, setOnlineModelId] = useState<string>('');
    const [localModelId, setLocalModelId] = useState<string>('');
    const [switchProbabilty, setSwitchProbabilty] = useState<number>(20);
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
                setSwitchProbabilty(existingStrategy.switchProbabilty ?? 20);
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
                setSwitchProbabilty(20);
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
        
        if (!name.trim()) newErrors.name = 'Name is required.';
        if (!onlineModelId) newErrors.onlineModel = 'Online model is required.';
        if (!localModelId) newErrors.localModel = 'Local model is required.';
        
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
            id: existingStrategy?.id || generateId(),
            name: name.trim(),
            description: description.trim() || '',
            onlineModel,
            localModel,
            switchProbabilty,
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

    // ✅ Clone: save as new strategy with a new ID and "(Clone)" suffix
    const handleClone = () => {
        if (!validate()) return;

        const onlineModel = allModels.find(m => m.id === onlineModelId);
        const localModel = allModels.find(m => m.id === localModelId);

        if (!onlineModel || !localModel) {
            alert('Selected models not found.');
            return;
        }

        const now = Date.now();
        const clonedStrategy: BudgetStrategy = {
            id: generateId(),
            name: `${name.trim()} (Clone)`,
            description: description.trim() || '',
            onlineModel,
            localModel,
            switchProbabilty,
            switchOnContextSize,
            switchOnComplexityScore,
            fallbackOnLocalFailure,
            fallbackOnQualityThreshold,
            fallbackOnTimeoutInSeconds,
            maximumBudget,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };

        onSave(clonedStrategy);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingStrategy ? 'Edit Budget Strategy' : 'Create Budget Strategy'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Cancel</button>
                        {/* ✅ Clone button — only shown when editing an existing strategy */}
                        {existingStrategy && (
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit}>
                            {"Save"}
                        </button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">
                            Name <span style={{ color: '#ff4444' }}>*</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                if (errors.name) setErrors({ ...errors, name: undefined });
                            }}
                            className={`editor-input ${errors.name ? 'error' : ''}`}
                            placeholder="e.g., Balanced, Budget Saver, Quality Focused"
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
                            placeholder="Describe when to use this strategy"
                            rows={2}
                        />
                    </div>

                    {/* Model Selection */}
                    <div className="editor-section">
                        <span className="editor-section-title">Model Selection</span>
                        
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">
                                    Online Model <span style={{ color: '#ff4444' }}>*</span>
                                </label>
                                <select
                                    value={onlineModelId}
                                    onChange={(e) => {
                                        setOnlineModelId(e.target.value);
                                        if (errors.onlineModel) setErrors({ ...errors, onlineModel: undefined });
                                    }}
                                    className={`editor-select ${errors.onlineModel ? 'error' : ''}`}
                                >
                                    <option value="">Select online model...</option>
                                    {allModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                                {errors.onlineModel && <div className="editor-error-message">{errors.onlineModel}</div>}
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">
                                    Local Model <span style={{ color: '#ff4444' }}>*</span>
                                </label>
                                <select
                                    value={localModelId}
                                    onChange={(e) => {
                                        setLocalModelId(e.target.value);
                                        if (errors.localModel) setErrors({ ...errors, localModel: undefined });
                                    }}
                                    className={`editor-select ${errors.localModel ? 'error' : ''}`}
                                >
                                    <option value="">Select local model...</option>
                                    {allModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                                {errors.localModel && <div className="editor-error-message">{errors.localModel}</div>}
                            </div>
                        </div>
                    </div>

                    {/* Switching Rules */}
                    <div className="editor-section">
                        <span className="editor-section-title">Switching Rules</span>
                        
                        <div className="editor-row-full">
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

                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Switch On Context Size</label>
                                <input
                                    type="number"
                                    value={switchOnContextSize}
                                    onChange={(e) => setSwitchOnContextSize(Number(e.target.value) || 0)}
                                    className="editor-input"
                                    min="0"
                                    step="64"
                                    placeholder="8192"
                                />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Switch On Complexity Score</label>
                                <input
                                    type="number"
                                    value={switchOnComplexityScore}
                                    onChange={(e) => setSwitchOnComplexityScore(Number(e.target.value) || 0)}
                                    className="editor-input"
                                    min="0"
                                    max="100"
                                    step="1"
                                    placeholder="70"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Fallback Rules */}
                    <div className="editor-section">
                        <span className="editor-section-title">Fallback Rules</span>
                        
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Quality Threshold</label>
                                <input
                                    type="number"
                                    value={fallbackOnQualityThreshold}
                                    onChange={(e) => setFallbackOnQualityThreshold(Number(e.target.value) || 0)}
                                    className="editor-input"
                                    min="0"
                                    max="100"
                                    step="1"
                                    placeholder="30"
                                />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Fallback Timeout (Seconds)</label>
                                <input
                                    type="number"
                                    value={fallbackOnTimeoutInSeconds}
                                    onChange={(e) => setFallbackOnTimeoutInSeconds(Number(e.target.value) || 0)}
                                    className="editor-input"
                                    min="1"
                                    step="1"
                                    placeholder="30"
                                />
                            </div>
                        </div>

                        <div className="editor-row-full" style={{ marginTop: '8px' }}>
                            <label className="editor-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={fallbackOnLocalFailure}
                                    onChange={(e) => setFallbackOnLocalFailure(e.target.checked)}
                                    className="editor-checkbox-input"
                                />
                                <span>Fallback on local failure</span>
                            </label>
                        </div>
                    </div>

                    {/* Budget Control */}
                    <div className="editor-section">
                        <span className="editor-section-title">Budget Control</span>
                        
                        <div className="editor-row-full">
                            <div>
                                <label className="editor-label editor-label-small">Maximum Budget ($)</label>
                                <input
                                    type="number"
                                    value={maximumBudget}
                                    onChange={(e) => setMaximumBudget(Number(e.target.value) || 0)}
                                    className="editor-input"
                                    min="0"
                                    step="0.5"
                                    placeholder="10"
                                />
                                <div className="editor-label" style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: '4px' }}>
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