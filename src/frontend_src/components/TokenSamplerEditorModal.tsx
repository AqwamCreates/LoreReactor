// src/frontend_src/components/TokenSamplerEditorModal.tsx
import type React from 'react';
import { useState } from 'react';
import type { TokenSampler, StopPattern } from '../types';
import { SliderInput } from './SliderInput';
import { v4 as uuidv4 } from 'uuid';
import '../main.css';

interface TokenSamplerEditorModalProps {
    onClose: () => void;
    onSave: (tokenSampler: TokenSampler) => void;
    existingTokenSampler?: TokenSampler | null;
    allStopPatterns: StopPattern[];
}

interface TokenSamplerParameters {
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

const DEFAULT_PARAMETERS: TokenSamplerParameters = {
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
    temperature: { min: 0, max: 2, step: 0.01, description: 'Controls randomness', label: 'Temperature', category: 'Core', defaultEnabled: true, decimals: 2 },
    top_k: { min: 0, max: 200, step: 1, description: 'Limits token selection to top K', label: 'Top K', category: 'Core', defaultEnabled: true, decimals: 0 },
    top_p: { min: 0, max: 1, step: 0.01, description: 'Nucleus sampling', label: 'Top P', category: 'Core', defaultEnabled: true, decimals: 2 },
    repeat_penalty: { min: 1, max: 2, step: 0.01, description: 'Penalizes repetition', label: 'Repeat Penalty', category: 'Core', defaultEnabled: true, decimals: 2 },
    frequency_penalty: { min: 0, max: 2, step: 0.01, description: 'Penalizes frequent tokens', label: 'Frequency Penalty', category: 'Core', defaultEnabled: false, decimals: 2 },
    presence_penalty: { min: 0, max: 2, step: 0.01, description: 'Penalizes tokens that have appeared before', label: 'Presence Penalty', category: 'Core', defaultEnabled: false, decimals: 2 },
    min_p: { min: 0, max: 1, step: 0.01, description: 'Minimum probability threshold', label: 'Min P', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    typical_p: { min: 0, max: 1, step: 0.01, description: 'Typical sampling', label: 'Typical P', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    tfs_z: { min: 0, max: 2, step: 0.01, description: 'Tail-free sampling', label: 'TFS Z', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    top_a: { min: 0, max: 1, step: 0.01, description: 'Top-A sampling', label: 'Top A', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    mirostat: { min: 0, max: 2, step: 1, description: 'Mirostat mode', label: 'Mirostat Mode', category: 'Advanced', defaultEnabled: false, decimals: 0 },
    mirostat_tau: { min: 0, max: 10, step: 0.01, description: 'Mirostat target entropy', label: 'Mirostat Tau', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    mirostat_eta: { min: 0, max: 1, step: 0.01, description: 'Mirostat learning rate', label: 'Mirostat Eta', category: 'Advanced', defaultEnabled: false, decimals: 2 },
    rep_penalty_range: { min: 0, max: 4096, step: 1, description: 'Tokens to consider for repetition penalty', label: 'Rep Penalty Range', category: 'Repetition', defaultEnabled: false, decimals: 0 },
    rep_penalty_slope: { min: 0, max: 2, step: 0.01, description: 'Slope for repetition penalty curve', label: 'Rep Penalty Slope', category: 'Repetition', defaultEnabled: false, decimals: 2 },
    encoder_repetition_penalty: { min: 1, max: 2, step: 0.01, description: 'Penalty for tokens from the prompt', label: 'Encoder Rep Penalty', category: 'Repetition', defaultEnabled: false, decimals: 2 },
    no_repeat_ngram_size: { min: 0, max: 20, step: 1, description: 'Size of n-grams to prevent repetition', label: 'No Repeat N-Gram Size', category: 'Repetition', defaultEnabled: false, decimals: 0 },
    penalty_alpha: { min: 0, max: 2, step: 0.01, description: 'Penalty alpha for contrastive search', label: 'Penalty Alpha', category: 'Repetition', defaultEnabled: false, decimals: 2 },
    smoothing_factor: { min: 0, max: 1, step: 0.01, description: 'Smoothing factor', label: 'Smoothing Factor', category: 'Smoothing', defaultEnabled: false, decimals: 2 },
    smoothing_curve: { min: 0.1, max: 5, step: 0.01, description: 'Curve shape for smoothing', label: 'Smoothing Curve', category: 'Smoothing', defaultEnabled: false, decimals: 2 },
    dry_allowed_length: { min: 0, max: 20, step: 1, description: 'Maximum allowed repetition length', label: 'DRY Allowed Length', category: 'DRY', defaultEnabled: false, decimals: 0 },
    dry_penalty_last_n: { min: -1, max: 4096, step: 1, description: 'Tokens to consider for DRY penalty', label: 'DRY Penalty Last N', category: 'DRY', defaultEnabled: false, decimals: 0 },
    dry_base: { min: 1, max: 3, step: 0.01, description: 'Base for DRY exponential penalty', label: 'DRY Base', category: 'DRY', defaultEnabled: false, decimals: 2 },
    dry_multiplier: { min: 0, max: 2, step: 0.01, description: 'Multiplier for DRY penalty', label: 'DRY Multiplier', category: 'DRY', defaultEnabled: false, decimals: 2 },
    dry_sequence_breaker: { min: 0, max: 0, step: 0, description: 'Characters that break DRY sequence', label: 'DRY Sequence Breaker', category: 'DRY', defaultEnabled: false, isString: true },
    ignore_eos: { min: 0, max: 1, step: 1, description: 'Ignore End-Of-Sequence token', label: 'Ignore EOS', category: 'Other', defaultEnabled: false, isBoolean: true },
    dynamic_temperature: { min: 0, max: 1, step: 1, description: 'Enable dynamic temperature scaling based on context entropy', label: 'Dynamic Temperature', category: 'Core', defaultEnabled: false, isBoolean: true },
    dynatemp_low: { min: 0, max: 2, step: 0.01, description: 'Lower bound for dynamic temperature range', label: 'Dynatemp Low', category: 'Core', defaultEnabled: false, decimals: 2 },
    dynatemp_high: { min: 0, max: 3, step: 0.01, description: 'Upper bound for dynamic temperature range', label: 'Dynatemp High', category: 'Core', defaultEnabled: false, decimals: 2 },
    dynatemp_exponent: { min: 0.1, max: 5, step: 0.01, description: 'Exponent controlling how aggressively temperature scales', label: 'Dynatemp Exponent', category: 'Core', defaultEnabled: false, decimals: 2 },
};

const getParamValue = (params: Record<string, unknown> | undefined, key: string, defaultValue: number | string | boolean): number | string | boolean => {
    if (!params) return defaultValue;
    const val = params[key];
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        if (typeof defaultValue === 'number') return Number.parseFloat(val) || defaultValue;
        return val;
    }
    if (typeof val === 'boolean') return val;
    return defaultValue;
};

function computeInitialActiveParamKeys(existingTokenSampler: TokenSampler | null | undefined): string[] {
    if (!existingTokenSampler) {
        return Object.keys(PARAMETER_CONFIGS).filter(k => PARAMETER_CONFIGS[k].defaultEnabled);
    }

    const storedOrder = existingTokenSampler.parameters?._parameterOrder as string[] | undefined;
    if (Array.isArray(storedOrder) && storedOrder.length > 0) {
        const validKeys = Object.keys(PARAMETER_CONFIGS);
        const safeOrder = storedOrder.filter((k): k is string => typeof k === 'string' && validKeys.includes(k));
        const missingEnabled = validKeys.filter(k => {
            const wasEnabled = existingTokenSampler.parameters?.[`_enabled_${k}`];
            return wasEnabled && !safeOrder.includes(k);
        });
        return [...safeOrder, ...missingEnabled];
    }

    const enabledKeys: string[] = [];
    for (const key of Object.keys(PARAMETER_CONFIGS)) {
        const wasEnabled = existingTokenSampler.parameters?.[`_enabled_${key}`];
        if (wasEnabled) enabledKeys.push(key);
    }
    if (enabledKeys.length === 0) {
        return Object.keys(PARAMETER_CONFIGS).filter(k => PARAMETER_CONFIGS[k].defaultEnabled);
    }
    return enabledKeys;
}

function computeInitialParameters(existingTokenSampler: TokenSampler | null | undefined): TokenSamplerParameters {
    const loadedParams = {} as TokenSamplerParameters;
    for (const key of Object.keys(DEFAULT_PARAMETERS)) {
        const defaultValue = DEFAULT_PARAMETERS[key];
        if (
            typeof defaultValue === 'number' ||
            typeof defaultValue === 'string' ||
            typeof defaultValue === 'boolean'
        ) {
            loadedParams[key] = getParamValue(existingTokenSampler?.parameters, key, defaultValue);
        }
    }
    return loadedParams;
}

export function TokenSamplerEditorModal({
    onClose,
    onSave,
    existingTokenSampler,
    allStopPatterns,
}: TokenSamplerEditorModalProps) {

    return (
        <TokenSamplerEditorModalInner
            onClose={onClose}
            onSave={onSave}
            existingTokenSampler={existingTokenSampler}
            allStopPatterns={allStopPatterns}
        />
    );
}

function TokenSamplerEditorModalInner({
    onClose,
    onSave,
    existingTokenSampler,
    allStopPatterns,
}: Omit<TokenSamplerEditorModalProps, 'isOpen'>) {
    const [name, setName] = useState(existingTokenSampler?.name || '');
    const [description, setDescription] = useState(existingTokenSampler?.description || '');
    const [parameters, setParameters] = useState<TokenSamplerParameters>(() => computeInitialParameters(existingTokenSampler));
    const [activeParamKeys, setActiveParamKeys] = useState<string[]>(() => computeInitialActiveParamKeys(existingTokenSampler));
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>(existingTokenSampler?.stopPatterns.map(sp => sp.id) ?? []);
    const [maxTokens, setMaxTokens] = useState<number>(existingTokenSampler?.maximumNumberOfTokens || 2048);
    const [errors, setErrors] = useState<{ name?: string }>({});

    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    const handleParameterChange = (key: string, value: number | string | boolean) => {
        setParameters(prev => ({ ...prev, [key]: value }));
    };

    const handleAddParam = (key: string) => {
        if (!activeParamKeys.includes(key)) {
            setActiveParamKeys(prev => [...prev, key]);
        }
    };

    const handleRemoveParam = (key: string) => {
        setActiveParamKeys(prev => prev.filter(k => k !== key));
    };

    const validate = (): boolean => {
        const newErrors: { name?: string } = {};
        if (!name) {
            newErrors.name = 'Name is required';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const buildTokenSamplerFromForm = (isNewClone: boolean): TokenSampler | null => {
        if (!validate()) return null;

        const stopPatterns = allStopPatterns.filter(sp => selectedStopPatternIds.includes(sp.id));
        const paramsWithEnabled: Record<string, unknown> = { ...parameters };

        paramsWithEnabled._parameterOrder = [...activeParamKeys];

        for (const key of Object.keys(PARAMETER_CONFIGS)) {
            paramsWithEnabled[`_enabled_${key}`] = activeParamKeys.includes(key);
        }

        const now = Date.now();
        return {
            id: isNewClone ? uuidv4() : (existingTokenSampler?.id || uuidv4()),
            name: isNewClone ? `${name} (Clone)` : name,
            description: description || undefined,
            parameters: paramsWithEnabled,
            stopPatterns,
            maximumNumberOfTokens: maxTokens,
            firstCreatedTimestamp: isNewClone ? now : (existingTokenSampler?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = () => {
        const tokenSampler = buildTokenSamplerFromForm(false);
        if (!tokenSampler) return;
        onSave(tokenSampler);
        onClose();
    };

    const handleClone = () => {
        const clonedTokenSampler = buildTokenSamplerFromForm(true);
        if (!clonedTokenSampler) return;
        onSave(clonedTokenSampler);
        onClose();
    };

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
        const dragIndex = Number.parseInt(e.dataTransfer.getData('text/plain'));
        if (dragIndex === dropIndex) return;
        const newOrder = [...activeParamKeys];
        const [removed] = newOrder.splice(dragIndex, 1);
        newOrder.splice(dropIndex, 0, removed);
        setActiveParamKeys(newOrder);
        setDraggedIndex(null);
    };

    const availableParamKeys = Object.keys(PARAMETER_CONFIGS).filter(k => !activeParamKeys.includes(k));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingTokenSampler ? 'Edit TokenSampler' : 'Create New TokenSampler'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        {existingTokenSampler && (
                            <button type="button" className="editor-button editor-button-cancel" onClick={handleClone}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit}>Save</button>
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
                            placeholder="Describe how this tokenSampler works"
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
                            placeholder="2048"
                            min="1"
                            step="1"
                        />
                    </div>

                    <div className="editor-section">
                        <div className="tokenSampler-section-header editor-section-title">
                            <span>Active Parameters ({activeParamKeys.length})</span>
                            <span className="tokenSampler-drag-hint">↕ Drag To Reorder</span>
                        </div>

                        <div className="tokenSampler-param-list">
                            {activeParamKeys.length === 0 && (
                                <div className="tokenSampler-stop-empty">No active parameters. Add some below.</div>
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
                                        className={`tokenSampler-param-row ${isDragging ? 'tokenSampler-param-dragging' : ''}`}
                                    >
                                        <div className="tokenSampler-drag-handle" title="Drag to reorder">⋮⋮</div>
                                        <div className="tokenSampler-param-content">
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
                                                            className="tokenSampler-stop-remove-button slider-remove-inline"
                                                            title={`Remove ${config.label}`}
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                    {config.description && (
                                                        <div className="tokenSampler-param-description">{config.description}</div>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    <div className="tokenSampler-param-label-row" style={{ justifyContent: 'space-between' }}>
                                                        <span className="tokenSampler-param-name tokenSampler-param-name-enabled">
                                                            {config.label}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveParam(key)}
                                                            className="tokenSampler-stop-remove-button"
                                                            title={`Remove ${config.label}`}
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                    <div className="tokenSampler-param-input-row">
                                                        {config.isBoolean ? (
                                                            <button
                                                                type="button"
                                                                className={`editor-button ${parameters[key] ? 'editor-button-save' : 'editor-button-cancel'}`}
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
                                                                className="editor-input tokenSampler-string-input"
                                                            />
                                                        )}
                                                    </div>
                                                    {config.description && (
                                                        <div className="tokenSampler-param-description">{config.description}</div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

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

                    <div className="editor-section">
                        <div className="editor-section-title">Stop Patterns</div>
                        <div className="tokenSampler-stop-patterns-list">
                            {selectedStopPatternIds.length === 0 && (
                                <div className="tokenSampler-stop-empty">No stop patterns assigned.</div>
                            )}
                            {selectedStopPatternIds.map(id => {
                                const sp = allStopPatterns.find(p => p.id === id);
                                if (!sp) return null;
                                return (
                                    <div key={id} className="tokenSampler-stop-item">
                                        <div className="tokenSampler-stop-info">
                                            <span className="tokenSampler-stop-name">{sp.name}</span>
                                            <span className="tokenSampler-stop-pattern">{sp.pattern}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedStopPatternIds(prev => prev.filter(sid => sid !== id))}
                                            className="tokenSampler-stop-remove-button"
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