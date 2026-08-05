// src/components/SamplerEditorModal.tsx
import type React from 'react';
import { useState, useEffect } from 'react';
import type { Sampler, StopPattern } from '../types';
import { SliderInput } from './SliderInput';
import './main.css';

interface SamplerEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (sampler: Sampler) => void;
    existingSampler?: Sampler | null;
    allStopPatterns: StopPattern[];
}

interface SamplerParameters {
    temperature: number;
    top_k: number;
    top_p: number;
    repeat_penalty: number;
    frequency_penalty: number;
    presence_penalty: number;
    min_p: number;
    typical_p: number;
    tfs_z: number;
    top_a: number;
    mirostat: number;
    mirostat_tau: number;
    mirostat_eta: number;
    rep_penalty_range: number;
    rep_penalty_slope: number;
    encoder_repetition_penalty: number;
    no_repeat_ngram_size: number;
    penalty_alpha: number;
    smoothing_factor: number;
    smoothing_curve: number;
    dry_allowed_length: number;
    dry_penalty_last_n: number;
    dry_base: number;
    dry_multiplier: number;
    dry_sequence_breaker: string;
    ignore_eos: boolean;
    [key: string]: number | string | boolean | unknown;
}

interface EnabledParams {
    temperature: boolean;
    top_k: boolean;
    top_p: boolean;
    repeat_penalty: boolean;
    frequency_penalty: boolean;
    presence_penalty: boolean;
    min_p: boolean;
    typical_p: boolean;
    tfs_z: boolean;
    top_a: boolean;
    mirostat: boolean;
    mirostat_tau: boolean;
    mirostat_eta: boolean;
    rep_penalty_range: boolean;
    rep_penalty_slope: boolean;
    encoder_repetition_penalty: boolean;
    no_repeat_ngram_size: boolean;
    penalty_alpha: boolean;
    smoothing_factor: boolean;
    smoothing_curve: boolean;
    dry_allowed_length: boolean;
    dry_penalty_last_n: boolean;
    dry_base: boolean;
    dry_multiplier: boolean;
    dry_sequence_breaker: boolean;
    ignore_eos: boolean;
    [key: string]: boolean;
}

const DEFAULT_PARAMETERS: SamplerParameters = {
    temperature: 0.8,
    top_k: 40,
    top_p: 0.9,
    repeat_penalty: 1.15,
    frequency_penalty: 0,
    presence_penalty: 0,
    min_p: 0,
    typical_p: 1,
    tfs_z: 1,
    top_a: 0,
    mirostat: 0,
    mirostat_tau: 5,
    mirostat_eta: 0.1,
    rep_penalty_range: 1024,
    rep_penalty_slope: 0,
    encoder_repetition_penalty: 1,
    no_repeat_ngram_size: 0,
    penalty_alpha: 0,
    smoothing_factor: 0,
    smoothing_curve: 1,
    dry_allowed_length: 2,
    dry_penalty_last_n: -1,
    dry_base: 1.75,
    dry_multiplier: 0,
    dry_sequence_breaker: "\n",
    ignore_eos: false,
};

const DEFAULT_ENABLED: EnabledParams = {
    temperature: true,
    top_k: true,
    top_p: true,
    repeat_penalty: true,
    frequency_penalty: false,
    presence_penalty: false,
    min_p: false,
    typical_p: false,
    tfs_z: false,
    top_a: false,
    mirostat: false,
    mirostat_tau: false,
    mirostat_eta: false,
    rep_penalty_range: false,
    rep_penalty_slope: false,
    encoder_repetition_penalty: false,
    no_repeat_ngram_size: false,
    penalty_alpha: false,
    smoothing_factor: false,
    smoothing_curve: false,
    dry_allowed_length: false,
    dry_penalty_last_n: false,
    dry_base: false,
    dry_multiplier: false,
    dry_sequence_breaker: false,
    ignore_eos: false,
};

const PARAMETER_CONFIGS: Record<string, { min: number; max: number; step: number; description: string; label: string; category: string; defaultEnabled: boolean; decimals?: number; isString?: boolean; isBoolean?: boolean }> = {
    temperature: { min: 0, max: 2, step: 0.05, description: 'Controls randomness', label: 'Temperature', category: 'Core', defaultEnabled: true, decimals: 2 },
    top_k: { min: 0, max: 200, step: 1, description: 'Limits token selection to top K', label: 'Top K', category: 'Core', defaultEnabled: true, decimals: 0 },
    top_p: { min: 0, max: 1, step: 0.05, description: 'Nucleus sampling', label: 'Top P', category: 'Core', defaultEnabled: true, decimals: 2 },
    repeat_penalty: { min: 1, max: 2, step: 0.05, description: 'Penalizes repetition', label: 'Repeat Penalty', category: 'Core', defaultEnabled: true, decimals: 2 },
    frequency_penalty: { min: 0, max: 2, step: 0.05, description: 'Penalizes frequent tokens', label: 'Frequency Penalty', category: 'Core', defaultEnabled: false, decimals: 2 },
    presence_penalty: { min: 0, max: 2, step: 0.05, description: 'Penalizes tokens that have appeared before', label: 'Presence Penalty', category: 'Core', defaultEnabled: false, decimals: 2 },
    min_p: { min: 0, max: 1, step: 0.05, description: 'Minimum probability threshold', label: 'Min P', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    typical_p: { min: 0, max: 1, step: 0.05, description: 'Typical sampling', label: 'Typical P', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    tfs_z: { min: 0, max: 2, step: 0.05, description: 'Tail-free sampling', label: 'TFS Z', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    top_a: { min: 0, max: 1, step: 0.05, description: 'Top-A sampling', label: 'Top A', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    mirostat: { min: 0, max: 2, step: 1, description: 'Mirostat mode', label: 'Mirostat Mode', category: 'Advanced', defaultEnabled: false, decimals: 0 },
    mirostat_tau: { min: 0, max: 10, step: 0.1, description: 'Mirostat target entropy', label: 'Mirostat Tau', category: 'Advanced', defaultEnabled: false, decimals: 1 },
    mirostat_eta: { min: 0, max: 1, step: 0.05, description: 'Mirostat learning rate', label: 'Mirostat Eta', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    rep_penalty_range: { min: 0, max: 4096, step: 64, description: 'Tokens to consider for repetition penalty', label: 'Rep Penalty Range', category: 'Repetition', defaultEnabled: false, decimals: 0 },
    rep_penalty_slope: { min: 0, max: 2, step: 0.05, description: 'Slope for repetition penalty curve', label: 'Rep Penalty Slope', category: 'Repetition', defaultEnabled: false, decimals: 2 },
    encoder_repetition_penalty: { min: 1, max: 2, step: 0.05, description: 'Penalty for tokens from the prompt', label: 'Encoder Rep Penalty', category: 'Repetition', defaultEnabled: false, decimals: 2 },
    no_repeat_ngram_size: { min: 0, max: 20, step: 1, description: 'Size of n-grams to prevent repetition', label: 'No Repeat N-Gram Size', category: 'Repetition', defaultEnabled: false, decimals: 0 },
    penalty_alpha: { min: 0, max: 2, step: 0.05, description: 'Penalty alpha for contrastive search', label: 'Penalty Alpha', category: 'Repetition', defaultEnabled: false, decimals: 2 },
    smoothing_factor: { min: 0, max: 1, step: 0.05, description: 'Smoothing factor', label: 'Smoothing Factor', category: 'Smoothing', defaultEnabled: false, decimals: 2 },
    smoothing_curve: { min: 0.1, max: 5, step: 0.1, description: 'Curve shape for smoothing', label: 'Smoothing Curve', category: 'Smoothing', defaultEnabled: false, decimals: 1 },
    dry_allowed_length: { min: 0, max: 20, step: 1, description: 'Maximum allowed repetition length', label: 'DRY Allowed Length', category: 'DRY', defaultEnabled: false, decimals: 0 },
    dry_penalty_last_n: { min: -1, max: 4096, step: 64, description: 'Tokens to consider for DRY penalty', label: 'DRY Penalty Last N', category: 'DRY', defaultEnabled: false, decimals: 0 },
    dry_base: { min: 1, max: 3, step: 0.05, description: 'Base for DRY exponential penalty', label: 'DRY Base', category: 'DRY', defaultEnabled: false, decimals: 2 },
    dry_multiplier: { min: 0, max: 2, step: 0.05, description: 'Multiplier for DRY penalty', label: 'DRY Multiplier', category: 'DRY', defaultEnabled: false, decimals: 2 },
    dry_sequence_breaker: { min: 0, max: 0, step: 0, description: 'Characters that break DRY sequence', label: 'DRY Sequence Breaker', category: 'DRY', defaultEnabled: false, isString: true },
    ignore_eos: { min: 0, max: 1, step: 1, description: 'Ignore End-Of-Sequence token', label: 'Ignore EOS', category: 'Other', defaultEnabled: false, isBoolean: true },
};

const getParamValue = (params: Record<string, unknown> | undefined, key: string, defaultValue: number | string | boolean): number | string | boolean => {
    if (!params) return defaultValue;
    const val = params[key];
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        if (typeof defaultValue === 'number') return parseFloat(val) || defaultValue;
        return val;
    }
    if (typeof val === 'boolean') return val;
    return defaultValue;
};

export function SamplerEditorModal({
    isOpen,
    onClose,
    onSave,
    existingSampler,
    allStopPatterns,
}: SamplerEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [parameters, setParameters] = useState<SamplerParameters>({ ...DEFAULT_PARAMETERS });
    const [enabledParams, setEnabledParams] = useState<EnabledParams>({ ...DEFAULT_ENABLED });
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>([]);
    const [maxTokens, setMaxTokens] = useState<number>(512);
    const [errors, setErrors] = useState<{ name?: string }>({});

    const [parameterOrder, setParameterOrder] = useState<string[]>(Object.keys(PARAMETER_CONFIGS));
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    useEffect(() => {
        if (isOpen) {
            if (existingSampler) {
                setName(existingSampler.name || '');
                setDescription(existingSampler.description || '');

                const loadedParams: any = {};
                Object.keys(DEFAULT_PARAMETERS).forEach(key => {
                    loadedParams[key] = getParamValue(existingSampler.parameters, key, DEFAULT_PARAMETERS[key as keyof SamplerParameters]);
                });
                setParameters(loadedParams);

                const storedEnabled: Partial<EnabledParams> = {};
                Object.keys(DEFAULT_ENABLED).forEach(key => {
                    const stored = existingSampler.parameters?.[`_enabled_${key}`];
                    if (typeof stored === 'boolean') {
                        storedEnabled[key as keyof EnabledParams] = stored;
                    } else {
                        storedEnabled[key as keyof EnabledParams] = DEFAULT_ENABLED[key as keyof EnabledParams];
                    }
                });
                setEnabledParams({ ...DEFAULT_ENABLED, ...storedEnabled });

                setSelectedStopPatternIds(existingSampler.stopPatterns.map(sp => sp.id));
                setMaxTokens(existingSampler.maximumNumberOfTokens || 512);
            } else {
                setName('');
                setDescription('');
                setParameters({ ...DEFAULT_PARAMETERS });
                setEnabledParams({ ...DEFAULT_ENABLED });
                setSelectedStopPatternIds([]);
                setMaxTokens(512);
            }
            setParameterOrder(Object.keys(PARAMETER_CONFIGS));
            setErrors({});
        }
    }, [isOpen, existingSampler]);

    const handleParameterChange = (key: keyof SamplerParameters, value: number | string | boolean) => {
        setParameters(prev => ({ ...prev, [key]: value }));
    };

    const handleEnableToggle = (key: keyof EnabledParams) => {
        setEnabledParams(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const validate = (): boolean => {
        const newErrors: { name?: string } = {};
        if (!name.trim()) {
            newErrors.name = 'Name is required';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const buildSamplerFromForm = (isNewClone: boolean): Sampler | null => {
        if (!validate()) return null;

        const stopPatterns = allStopPatterns.filter(sp => selectedStopPatternIds.includes(sp.id));

        const paramsWithEnabled = { ...parameters };
        Object.keys(enabledParams).forEach(key => {
            paramsWithEnabled[`_enabled_${key}`] = enabledParams[key as keyof EnabledParams];
        });

        const now = Date.now();
        return {
            id: isNewClone ? crypto.randomUUID() : (existingSampler?.id || crypto.randomUUID()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            parameters: paramsWithEnabled,
            stopPatterns,
            maximumNumberOfTokens: maxTokens,
            firstCreatedTimestamp: isNewClone ? now : (existingSampler?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = () => {
        const sampler = buildSamplerFromForm(false);
        if (!sampler) return;
        onSave(sampler);
        onClose();
    };

    const handleClone = () => {
        const clonedSampler = buildSamplerFromForm(true);
        if (!clonedSampler) return;
        onSave(clonedSampler);
        onClose();
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        setTimeout(() => {
            (e.target as HTMLElement).style.opacity = '0.5';
        }, 0);
    };

    const handleDragEnd = (e: React.DragEvent) => {
        (e.target as HTMLElement).style.opacity = '1';
        setDraggedIndex(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
        if (dragIndex === dropIndex) return;
        const newOrder = [...parameterOrder];
        const [removed] = newOrder.splice(dragIndex, 1);
        newOrder.splice(dropIndex, 0, removed);
        setParameterOrder(newOrder);
        setDraggedIndex(null);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingSampler ? 'Edit Sampler' : 'Create New Sampler'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Cancel</button>
                        {existingSampler && (
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Name <span style={{ color: '#ff4444' }}>*</span></label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }}
                            className={`editor-input ${errors.name ? 'error' : ''}`}
                            placeholder="e.g., Creative Writing"
                        />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="editor-textarea"
                            placeholder="Describe how this sampler works"
                            rows={2}
                        />
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Maximum Number Of Tokens</label>
                        <input
                            type="number"
                            value={maxTokens}
                            onChange={(e) => setMaxTokens(Number(e.target.value) || 0)}
                            className="editor-input"
                            placeholder="512"
                            min="1"
                            step="1"
                        />
                    </div>

                    {/* Sampling Parameters */}
                    <div className="editor-section">
                        <div className="sampler-section-header editor-section-title">
                            <span>Sampling Parameters ({parameterOrder.length})</span>
                            <span className="sampler-drag-hint">↕ Drag To Reorder</span>
                        </div>
                                                <div className="sampler-param-list">
                            {parameterOrder.map((key, index) => {
                                const config = PARAMETER_CONFIGS[key];
                                if (!config) return null;

                                const paramKey = key as keyof SamplerParameters;
                                const isDragging = draggedIndex === index;
                                const isEnabled = enabledParams[paramKey as keyof EnabledParams] ?? false;

                                return (
                                    <div
                                        key={key}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, index)}
                                        onDragEnd={handleDragEnd}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, index)}
                                        className={`sampler-param-row ${isDragging ? 'sampler-param-dragging' : ''} ${!isEnabled ? 'sampler-param-disabled' : ''}`}
                                    >
                                        <div className="sampler-drag-handle" title="Drag to reorder">⋮⋮</div>

                                        <div className="sampler-param-content">
                                            {/* Line 1: checkbox + label */}
                                            <div
                                                className="sampler-param-label-row"
                                                onClick={() => handleEnableToggle(paramKey as keyof EnabledParams)}
                                            >
                                                <div className={`sampler-checkbox ${isEnabled ? 'checked' : ''}`}>
                                                    {isEnabled && <span className="sampler-checkbox-tick">✓</span>}
                                                </div>
                                                <span className={`sampler-param-name ${isEnabled ? 'sampler-param-name-enabled' : ''}`}>
                                                    {config.label}
                                                </span>
                                            </div>

                                            {/* Line 2: full-width input */}
                                            <div className="sampler-param-input-row">
                                                {config.isBoolean ? (
                                                    <button
                                                        type="button"
                                                        className={`editor-btn ${parameters[paramKey] ? 'editor-btn-save' : 'editor-btn-cancel'}`}
                                                        onClick={() => handleParameterChange(paramKey, !parameters[paramKey])}
                                                        disabled={!isEnabled}
                                                        style={{ padding: '2px 12px', fontSize: '0.7rem' }}
                                                    >
                                                        {parameters[paramKey] ? 'ON' : 'OFF'}
                                                    </button>
                                                ) : config.isString ? (
                                                    <input
                                                        type="text"
                                                        value={parameters[paramKey] as string}
                                                        onChange={(e) => handleParameterChange(paramKey, e.target.value)}
                                                        disabled={!isEnabled}
                                                        className={`editor-input sampler-string-input ${!isEnabled ? 'disabled' : ''}`}
                                                    />
                                                ) : (
                                                    <SliderInput
                                                        label=""
                                                        value={parameters[paramKey] as number}
                                                        minimumValue={config.min}
                                                        maximumValue={config.max}
                                                        stepValue={config.step}
                                                        decimals={config.decimals || 2}
                                                        onChange={(value) => handleParameterChange(paramKey, value)}
                                                        disabled={!isEnabled}
                                                    />
                                                )}
                                            </div>

                                            {/* Line 3: description centered */}
                                            {config.description && (
                                                <div className="sampler-param-description">{config.description}</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Stop Patterns */}
                    <div className="editor-section">
                        <div className="editor-section-title">Stop Patterns</div>

                        <div className="sampler-stop-patterns-list">
                            {selectedStopPatternIds.length === 0 && (
                                <div className="sampler-stop-empty">No stop patterns assigned.</div>
                            )}
                            {selectedStopPatternIds.map(id => {
                                const sp = allStopPatterns.find(p => p.id === id);
                                if (!sp) return null;
                                return (
                                    <div key={id} className="sampler-stop-item">
                                        <div className="sampler-stop-info">
                                            <span className="sampler-stop-name">{sp.name}</span>
                                            <span className="sampler-stop-pattern">{sp.pattern}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedStopPatternIds(prev => prev.filter(sid => sid !== id))}
                                            className="sampler-stop-remove-btn"
                                            title="Remove stop pattern"
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
                                if (val && !selectedStopPatternIds.includes(val)) {
                                    setSelectedStopPatternIds(prev => [...prev, val]);
                                }
                                e.target.value = '';
                            }}
                            className="editor-select"
                            defaultValue=""
                        >
                            <option value="" disabled>+ Add a stop pattern</option>
                            {allStopPatterns
                                .filter(sp => !selectedStopPatternIds.includes(sp.id))
                                .map(sp => (
                                    <option key={sp.id} value={sp.id}>{sp.name} — {sp.pattern}</option>
                                ))
                            }
                        </select>
                    </div>
                </div>
            </div>
        </div>
    );
}