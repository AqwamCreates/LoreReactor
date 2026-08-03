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

const PARAMETER_CONFIGS = {
    temperature: { 
        min: 0, max: 2, step: 0.05, description: 'Controls randomness', label: 'Temperature', category: 'Core', defaultEnabled: true, decimals: 2 
    },
    top_k: { 
        min: 0, max: 200, step: 1, description: 'Limits token selection to top K', label: 'Top K', category: 'Core', defaultEnabled: true, decimals: 0 
    },
    top_p: { 
        min: 0, max: 1, step: 0.05, description: 'Nucleus sampling', label: 'Top P', category: 'Core', defaultEnabled: true, decimals: 2 
    },
    repeat_penalty: { 
        min: 1, max: 2, step: 0.05, description: 'Penalizes repetition', label: 'Repeat Penalty', category: 'Core', defaultEnabled: true, decimals: 2 
    },
    frequency_penalty: { 
        min: 0, max: 2, step: 0.05, description: 'Penalizes frequent tokens', label: 'Frequency Penalty', category: 'Core', defaultEnabled: false, decimals: 2 
    },
    presence_penalty: { 
        min: 0, max: 2, step: 0.05, description: 'Penalizes tokens that have appeared before', label: 'Presence Penalty', category: 'Core', defaultEnabled: false, decimals: 2 
    },
    min_p: { 
        min: 0, max: 1, step: 0.05, description: 'Minimum probability threshold', label: 'Min P', category: 'Advanced', defaultEnabled: false, decimals: 2 
    },
    typical_p: { 
        min: 0, max: 1, step: 0.05, description: 'Typical sampling', label: 'Typical P', category: 'Advanced', defaultEnabled: false, decimals: 2 
    },
    tfs_z: { 
        min: 0, max: 2, step: 0.05, description: 'Tail-free sampling', label: 'TFS Z', category: 'Advanced', defaultEnabled: false, decimals: 2 
    },
    top_a: { 
        min: 0, max: 1, step: 0.05, description: 'Top-A sampling', label: 'Top A', category: 'Advanced', defaultEnabled: false, decimals: 2 
    },
    mirostat: { 
        min: 0, max: 2, step: 1, description: 'Mirostat mode', label: 'Mirostat Mode', category: 'Advanced', defaultEnabled: false, decimals: 0 
    },
    mirostat_tau: { 
        min: 0, max: 10, step: 0.1, description: 'Mirostat target entropy', label: 'Mirostat Tau', category: 'Advanced', defaultEnabled: false, decimals: 1 
    },
    mirostat_eta: { 
        min: 0, max: 1, step: 0.05, description: 'Mirostat learning rate', label: 'Mirostat Eta', category: 'Advanced', defaultEnabled: false, decimals: 2 
    },
    rep_penalty_range: { 
        min: 0, max: 4096, step: 64, description: 'Tokens to consider for repetition penalty', label: 'Rep Penalty Range', category: 'Repetition', defaultEnabled: false, decimals: 0 
    },
    rep_penalty_slope: { 
        min: 0, max: 2, step: 0.05, description: 'Slope for repetition penalty curve', label: 'Rep Penalty Slope', category: 'Repetition', defaultEnabled: false, decimals: 2 
    },
    encoder_repetition_penalty: { 
        min: 1, max: 2, step: 0.05, description: 'Penalty for tokens from the prompt', label: 'Encoder Rep Penalty', category: 'Repetition', defaultEnabled: false, decimals: 2 
    },
    no_repeat_ngram_size: { 
        min: 0, max: 20, step: 1, description: 'Size of n-grams to prevent repetition', label: 'No Repeat N-Gram Size', category: 'Repetition', defaultEnabled: false, decimals: 0 
    },
    penalty_alpha: { 
        min: 0, max: 2, step: 0.05, description: 'Penalty alpha for contrastive search', label: 'Penalty Alpha', category: 'Repetition', defaultEnabled: false, decimals: 2 
    },
    smoothing_factor: { 
        min: 0, max: 1, step: 0.05, description: 'Smoothing factor', label: 'Smoothing Factor', category: 'Smoothing', defaultEnabled: false, decimals: 2 
    },
    smoothing_curve: { 
        min: 0.1, max: 5, step: 0.1, description: 'Curve shape for smoothing', label: 'Smoothing Curve', category: 'Smoothing', defaultEnabled: false, decimals: 1 
    },
    dry_allowed_length: { 
        min: 0, max: 20, step: 1, description: 'Maximum allowed repetition length', label: 'DRY Allowed Length', category: 'DRY', defaultEnabled: false, decimals: 0 
    },
    dry_penalty_last_n: { 
        min: -1, max: 4096, step: 64, description: 'Tokens to consider for DRY penalty', label: 'DRY Penalty Last N', category: 'DRY', defaultEnabled: false, decimals: 0 
    },
    dry_base: { 
        min: 1, max: 3, step: 0.05, description: 'Base for DRY exponential penalty', label: 'DRY Base', category: 'DRY', defaultEnabled: false, decimals: 2 
    },
    dry_multiplier: { 
        min: 0, max: 2, step: 0.05, description: 'Multiplier for DRY penalty', label: 'DRY Multiplier', category: 'DRY', defaultEnabled: false, decimals: 2 
    },
    dry_sequence_breaker: { 
        min: 0, max: 0, step: 0, description: 'Characters that break DRY sequence', label: 'DRY Sequence Breaker', category: 'DRY', defaultEnabled: false, isString: true 
    },
    ignore_eos: { 
        min: 0, max: 1, step: 1, description: 'Ignore End-Of-Sequence token', label: 'Ignore EOS', category: 'Other', defaultEnabled: false, isBoolean: true 
    },
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

    const handleStopPatternToggle = (id: string) => {
        setSelectedStopPatternIds(prev => 
            prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
        );
    };

    const validate = (): boolean => {
        const newErrors: { name?: string } = {};
        if (!name.trim()) {
            newErrors.name = 'Name is required';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = () => {
        if (!validate()) return;

        const stopPatterns = allStopPatterns.filter(sp => selectedStopPatternIds.includes(sp.id));
        
        const paramsWithEnabled = { ...parameters };
        Object.keys(enabledParams).forEach(key => {
            paramsWithEnabled[`_enabled_${key}`] = enabledParams[key as keyof EnabledParams];
        });
        
        const now = Date.now();
        const sampler: Sampler = {
            id: existingSampler?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim() || undefined,
            parameters: paramsWithEnabled,
            stopPatterns,
            maximumNumberOfTokens: maxTokens,
            firstCreatedTimestamp: existingSampler?.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: now,
        };

        onSave(sampler);
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

    const renderParameterInput = (key: string, config: any, paramKey: keyof SamplerParameters) => {
        const isEnabled = enabledParams[paramKey as keyof EnabledParams] ?? false;
        
        if (config.isString) {
            return (
                <input
                    type="text"
                    value={parameters[paramKey] as string}
                    onChange={(e) => handleParameterChange(paramKey, e.target.value)}
                    disabled={!isEnabled}
                    className={`editor-input ${!isEnabled ? 'disabled' : ''}`}
                    style={{ fontFamily: 'monospace', fontSize: '0.75rem', padding: '4px 8px' }}
                />
            );
        }
        if (config.isBoolean) return null;

        const decimals = config.decimals || 2;
        return (
            <SliderInput
                label="" value={parameters[paramKey] as number} minimumValue={config.min} maximumValue={config.max}
                stepValue={config.step} decimals={decimals} onChange={(value) => handleParameterChange(paramKey, value)}
                description={config.description} disabled={!isEnabled}
            />
        );
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingSampler ? 'Edit Sampler' : 'Create New Sampler'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Cancel</button>
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit}>{existingSampler ? 'Update' : 'Create'}</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label"> Name <span style={{ color: '#ff4444' }}>*</span></label>
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

                    <div className="editor-section">
                        <div className="editor-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Sampling Parameters ({parameterOrder.length})</span>
                            <span style={{ fontSize: '0.6rem', opacity: 0.5, fontWeight: 'normal', marginLeft: '16px', textTransform: 'none' }}>↕ Drag To Reorder</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {parameterOrder.map((key, index) => {
                                const config = PARAMETER_CONFIGS[key as keyof typeof PARAMETER_CONFIGS];
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
                                        className={`sampler-param-item ${isDragging ? 'dragging' : ''} ${!isEnabled ? 'disabled-item' : ''}`}
                                    >
                                        <div 
                                            className="sampler-drag-handle"
                                            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.opacity = '0.8'}
                                            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.opacity = '0.3'}
                                            title="Drag to reorder"
                                        >
                                            ⋮⋮
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1px', marginBottom: '4px' }}>
                                                <div
                                                    onClick={() => handleEnableToggle(paramKey as keyof EnabledParams)}
                                                    className="sampler-enable-toggle"
                                                >
                                                    <div className={`sampler-checkbox ${isEnabled ? 'checked' : ''}`}>
                                                        {isEnabled && <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>}
                                                    </div>
                                                    <span className={`sampler-label ${isEnabled ? 'enabled' : ''}`}>{config.label}</span>
                                                </div>
                                            </div>
                                            {renderParameterInput(key, config, paramKey)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {allStopPatterns.length > 0 && (
                        <div className="editor-section">
                            <div className="editor-section-title">Stop Patterns</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {allStopPatterns.map(sp => {
                                    const isSelected = selectedStopPatternIds.includes(sp.id);
                                    return (
                                        <div
                                            key={sp.id}
                                            onClick={() => handleStopPatternToggle(sp.id)}
                                            className={`stop-pattern-item ${isSelected ? 'selected' : ''}`}
                                        >
                                            <div className={`stop-pattern-checkbox ${isSelected ? 'checked' : ''}`}>
                                                {isSelected && <span style={{ color: '#fff', fontSize: '12px' }}>✓</span>}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div className="stop-pattern-name">{sp.name}</div>
                                                {sp.description && <div className="stop-pattern-desc">{sp.description}</div>}
                                                <div className="stop-pattern-code">{sp.pattern}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}