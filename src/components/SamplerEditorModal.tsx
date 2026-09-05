// src/components/SamplerEditorModal.tsx
import type React from 'react';
import { useState, useEffect } from 'react';
import type { Sampler, StopPattern } from '../types';
import { SliderInput } from './SliderInput';
import { generateId } from '../core';
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
    dynamic_temperature: boolean;
    dynatemp_low: number;
    dynatemp_high: number;
    dynatemp_exponent: number;
    [key: string]: number | string | boolean | unknown;
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
    dynamic_temperature: false,
    dynatemp_low: 0.8,
    dynatemp_high: 1.2,
    dynatemp_exponent: 1.0,
};

const PARAMETER_CONFIGS: Record<string, {
    min: number; max: number; step: number;
    description: string; label: string; category: string;
    defaultEnabled: boolean; decimals?: number;
    isString?: boolean; isBoolean?: boolean;
}> = {
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
    dynamic_temperature: { min: 0, max: 1, step: 1, description: 'Enable dynamic temperature scaling based on context entropy', label: 'Dynamic Temperature', category: 'Core', defaultEnabled: false, isBoolean: true },
    dynatemp_low: { min: 0, max: 2, step: 0.05, description: 'Lower bound for dynamic temperature range', label: 'Dynatemp Low', category: 'Core', defaultEnabled: false, decimals: 2 },
    dynatemp_high: { min: 0, max: 3, step: 0.05, description: 'Upper bound for dynamic temperature range', label: 'Dynatemp High', category: 'Core', defaultEnabled: false, decimals: 2 },
    dynatemp_exponent: { min: 0.1, max: 5, step: 0.1, description: 'Exponent controlling how aggressively temperature scales', label: 'Dynatemp Exponent', category: 'Core', defaultEnabled: false, decimals: 1 },
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
    const [activeParamKeys, setActiveParamKeys] = useState<string[]>([]);
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>([]);
    const [maxTokens, setMaxTokens] = useState<number>(512);
    const [errors, setErrors] = useState<{ name?: string }>({});

    // Drag state for reordering active params
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    useEffect(() => {
        if (isOpen) {
            if (existingSampler) {
                setName(existingSampler.name || '');
                setDescription(existingSampler.description || '');

                // Restore parameter values
                const loadedParams: any = {};
                Object.keys(DEFAULT_PARAMETERS).forEach(key => {
                    loadedParams[key] = getParamValue(existingSampler.parameters, key, DEFAULT_PARAMETERS[key as keyof SamplerParameters]);
                });
                setParameters(loadedParams);

                // ✅ RESTORE ACTIVE PARAMETER ORDER FROM SAVED DATA
                const storedOrder = existingSampler.parameters?.['_parameterOrder'] as string[] | undefined;
                if (Array.isArray(storedOrder) && storedOrder.length > 0) {
                    const validKeys = Object.keys(PARAMETER_CONFIGS);
                    const safeOrder = storedOrder.filter((k): k is string => typeof k === 'string' && validKeys.includes(k));
                    // Include any keys that were enabled but missing from order
                    const missingEnabled = validKeys.filter(k => {
                        const wasEnabled = existingSampler.parameters?.[`_enabled_${k}`];
                        return wasEnabled === true && !safeOrder.includes(k);
                    });
                    setActiveParamKeys([...safeOrder, ...missingEnabled]);
                } else {
                    // Fallback: reconstruct from _enabled_ flags
                    const enabledKeys: string[] = [];
                    Object.keys(PARAMETER_CONFIGS).forEach(key => {
                        const wasEnabled = existingSampler.parameters?.[`_enabled_${key}`];
                        if (wasEnabled === true) enabledKeys.push(key);
                    });
                    // If nothing was explicitly enabled, use defaults
                    if (enabledKeys.length === 0) {
                        setActiveParamKeys(
                            Object.keys(PARAMETER_CONFIGS).filter(k => PARAMETER_CONFIGS[k].defaultEnabled)
                        );
                    } else {
                        setActiveParamKeys(enabledKeys);
                    }
                }

                setSelectedStopPatternIds(existingSampler.stopPatterns.map(sp => sp.id));
                setMaxTokens(existingSampler.maximumNumberOfTokens || 512);
            } else {
                // New sampler defaults
                setName('');
                setDescription('');
                setParameters({ ...DEFAULT_PARAMETERS });
                setActiveParamKeys(
                    Object.keys(PARAMETER_CONFIGS).filter(k => PARAMETER_CONFIGS[k].defaultEnabled)
                );
                setSelectedStopPatternIds([]);
                setMaxTokens(512);
            }
            setErrors({});
            setDraggedIndex(null);
        }
    }, [isOpen, existingSampler]);

    const handleParameterChange = (key: string, value: number | string | boolean) => {
        setParameters(prev => ({ ...prev, [key]: value }));
    };

    // ✅ ADD a parameter to the active list
    const handleAddParam = (key: string) => {
        if (!activeParamKeys.includes(key)) {
            setActiveParamKeys(prev => [...prev, key]);
        }
    };

    // ✅ REMOVE a parameter from the active list
    const handleRemoveParam = (key: string) => {
        setActiveParamKeys(prev => prev.filter(k => k !== key));
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
        const paramsWithEnabled: Record<string, unknown> = { ...parameters };

        // ✅ Persist the active parameter order
        paramsWithEnabled['_parameterOrder'] = [...activeParamKeys];

        // ✅ Mark active params as enabled (backwards compatibility)
        Object.keys(PARAMETER_CONFIGS).forEach(key => {
            paramsWithEnabled[`_enabled_${key}`] = activeParamKeys.includes(key);
        });

        const now = Date.now();
        return {
            id: isNewClone ? generateId() : (existingSampler?.id || generateId()),
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

    // --- Drag & Drop Reorder Handlers ---
    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        setTimeout(() => { (e.target as HTMLElement).style.opacity = '0.5'; }, 0);
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
        const newOrder = [...activeParamKeys];
        const [removed] = newOrder.splice(dragIndex, 1);
        newOrder.splice(dropIndex, 0, removed);
        setActiveParamKeys(newOrder);
        setDraggedIndex(null);
    };

    if (!isOpen) return null;

    // Available params = all configs minus currently active ones
    const availableParamKeys = Object.keys(PARAMETER_CONFIGS).filter(k => !activeParamKeys.includes(k));

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
                    {/* Name */}
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

                    {/* Description */}
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

                    {/* Max Tokens */}
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

                    {/* ✅ ACTIVE SAMPLING PARAMETERS — Add/Delete List Pattern */}
                    <div className="editor-section">
                        <div className="sampler-section-header editor-section-title">
                            <span>Active Parameters ({activeParamKeys.length})</span>
                            <span className="sampler-drag-hint">↕ Drag To Reorder</span>
                        </div>

                        {/* Active parameter list */}
                        <div className="sampler-param-list">
                            {activeParamKeys.length === 0 && (
                                <div className="sampler-stop-empty">No active parameters. Add some below.</div>
                            )}

                            {activeParamKeys.map((key, index) => {
                                const config = PARAMETER_CONFIGS[key];
                                if (!config) return null;
                                const isDragging = draggedIndex === index;

                                return (
                                    <div
                                        key={key}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, index)}
                                        onDragEnd={handleDragEnd}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, index)}
                                        className={`sampler-param-row ${isDragging ? 'sampler-param-dragging' : ''}`}
                                    >
                                        <div className="sampler-drag-handle" title="Drag to reorder">⋮⋮</div>
                                        <div className="sampler-param-content">
                                            {/* ✅ SLIDER: Let SliderInput render its own label+number header */}
                                            {!config.isBoolean && !config.isString ? (
                                                <>
                                                    <div className="slider-slider-header-with-remove">
                                                        <SliderInput
                                                            label={config.label}
                                                            value={parameters[key] as number}
                                                            minimumValue={config.min}
                                                            maximumValue={config.max}
                                                            stepValue={config.step}
                                                            decimals={config.decimals || 2}
                                                            onChange={(value) => handleParameterChange(key, value)}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveParam(key)}
                                                            className="sampler-stop-remove-btn slider-remove-inline"
                                                            title={`Remove ${config.label}`}
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                    {config.description && (
                                                        <div className="sampler-param-description">{config.description}</div>
                                                    )}
                                                </>
                                            ) : (
                                                /* ✅ BOOLEAN / STRING: Keep manual label row */
                                                <>
                                                    <div className="sampler-param-label-row" style={{ justifyContent: 'space-between' }}>
                                                        <span className="sampler-param-name sampler-param-name-enabled">
                                                            {config.label}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveParam(key)}
                                                            className="sampler-stop-remove-btn"
                                                            title={`Remove ${config.label}`}
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                    <div className="sampler-param-input-row">
                                                        {config.isBoolean ? (
                                                            <button
                                                                type="button"
                                                                className={`editor-btn ${parameters[key] ? 'editor-btn-save' : 'editor-btn-cancel'}`}
                                                                onClick={() => handleParameterChange(key, !parameters[key])}
                                                                style={{ padding: '2px 12px', fontSize: '0.7rem' }}
                                                            >
                                                                {parameters[key] ? 'ON' : 'OFF'}
                                                            </button>
                                                        ) : (
                                                            <input
                                                                type="text"
                                                                value={parameters[key] as string}
                                                                onChange={(e) => handleParameterChange(key, e.target.value)}
                                                                className="editor-input sampler-string-input"
                                                            />
                                                        )}
                                                    </div>
                                                    {config.description && (
                                                        <div className="sampler-param-description">{config.description}</div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* ✅ Add parameter dropdown */}
                        <div style={{ marginTop: '8px' }}>
                            <select
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val) handleAddParam(val);
                                    e.target.value = '';
                                }}
                                className="editor-select"
                                defaultValue=""
                            >
                                <option value="" disabled>+ Add a parameter</option>
                                {availableParamKeys.map(key => (
                                    <option key={key} value={key}>
                                        {PARAMETER_CONFIGS[key].label} ({PARAMETER_CONFIGS[key].category})
                                    </option>
                                ))}
                            </select>
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