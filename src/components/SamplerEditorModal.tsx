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
        min: 0, 
        max: 2, 
        step: 0.05, 
        description: 'Controls randomness: lower = more deterministic, higher = more creative',
        label: 'Temperature',
        category: 'Core',
        defaultEnabled: true,
        decimals: 2
    },
    top_k: { 
        min: 0, 
        max: 200, 
        step: 1, 
        description: 'Limits token selection to top K most likely tokens (0 = disabled)',
        label: 'Top K',
        category: 'Core',
        defaultEnabled: true,
        decimals: 0
    },
    top_p: { 
        min: 0, 
        max: 1, 
        step: 0.05, 
        description: 'Nucleus sampling: limits to top P probability mass (1.0 = disabled)',
        label: 'Top P',
        category: 'Core',
        defaultEnabled: true,
        decimals: 2
    },
    repeat_penalty: { 
        min: 1, 
        max: 2, 
        step: 0.05, 
        description: 'Penalizes repetition of tokens (1.0 = disabled)',
        label: 'Repeat Penalty',
        category: 'Core',
        defaultEnabled: true,
        decimals: 2
    },
    frequency_penalty: { 
        min: 0, 
        max: 2, 
        step: 0.05, 
        description: 'Penalizes frequent tokens in the response (OpenAI style)',
        label: 'Frequency Penalty',
        category: 'Core',
        defaultEnabled: false,
        decimals: 2
    },
    presence_penalty: { 
        min: 0, 
        max: 2, 
        step: 0.05, 
        description: 'Penalizes tokens that have appeared before (OpenAI style)',
        label: 'Presence Penalty',
        category: 'Core',
        defaultEnabled: false,
        decimals: 2
    },
    min_p: { 
        min: 0, 
        max: 1, 
        step: 0.05, 
        description: 'Minimum probability threshold for token selection (0 = disabled)',
        label: 'Min P',
        category: 'Advanced',
        defaultEnabled: false,
        decimals: 2
    },
    typical_p: { 
        min: 0, 
        max: 1, 
        step: 0.05, 
        description: 'Typical sampling: selects tokens with typical probability (1.0 = disabled)',
        label: 'Typical P',
        category: 'Advanced',
        defaultEnabled: false,
        decimals: 2
    },
    tfs_z: { 
        min: 0, 
        max: 2, 
        step: 0.05, 
        description: 'Tail-free sampling: removes lower probability tokens (1.0 = disabled)',
        label: 'TFS Z',
        category: 'Advanced',
        defaultEnabled: false,
        decimals: 2
    },
    top_a: { 
        min: 0, 
        max: 1, 
        step: 0.05, 
        description: 'Top-A sampling: removes tokens below a probability threshold (0 = disabled)',
        label: 'Top A',
        category: 'Advanced',
        defaultEnabled: false,
        decimals: 2
    },
    mirostat: { 
        min: 0, 
        max: 2, 
        step: 1, 
        description: 'Mirostat mode: 0=disabled, 1=Mirostat, 2=Mirostat 2.0',
        label: 'Mirostat Mode',
        category: 'Advanced',
        defaultEnabled: false,
        decimals: 0
    },
    mirostat_tau: { 
        min: 0, 
        max: 10, 
        step: 0.1, 
        description: 'Mirostat target entropy (lower = more focused)',
        label: 'Mirostat Tau',
        category: 'Advanced',
        defaultEnabled: false,
        decimals: 1
    },
    mirostat_eta: { 
        min: 0, 
        max: 1, 
        step: 0.05, 
        description: 'Mirostat learning rate',
        label: 'Mirostat Eta',
        category: 'Advanced',
        defaultEnabled: false,
        decimals: 2
    },
    rep_penalty_range: { 
        min: 0, 
        max: 4096, 
        step: 64, 
        description: 'Number of tokens to consider for repetition penalty (0 = all)',
        label: 'Rep Penalty Range',
        category: 'Repetition',
        defaultEnabled: false,
        decimals: 0
    },
    rep_penalty_slope: { 
        min: 0, 
        max: 2, 
        step: 0.05, 
        description: 'Slope for repetition penalty curve',
        label: 'Rep Penalty Slope',
        category: 'Repetition',
        defaultEnabled: false,
        decimals: 2
    },
    encoder_repetition_penalty: { 
        min: 1, 
        max: 2, 
        step: 0.05, 
        description: 'Penalty for tokens from the prompt',
        label: 'Encoder Rep Penalty',
        category: 'Repetition',
        defaultEnabled: false,
        decimals: 2
    },
    no_repeat_ngram_size: { 
        min: 0, 
        max: 20, 
        step: 1, 
        description: 'Size of n-grams to prevent repetition (0 = disabled)',
        label: 'No Repeat N-Gram Size',
        category: 'Repetition',
        defaultEnabled: false,
        decimals: 0
    },
    penalty_alpha: { 
        min: 0, 
        max: 2, 
        step: 0.05, 
        description: 'Penalty alpha for contrastive search',
        label: 'Penalty Alpha',
        category: 'Repetition',
        defaultEnabled: false,
        decimals: 2
    },
    smoothing_factor: { 
        min: 0, 
        max: 1, 
        step: 0.05, 
        description: 'Smoothing factor for probabilities (0 = disabled)',
        label: 'Smoothing Factor',
        category: 'Smoothing',
        defaultEnabled: false,
        decimals: 2
    },
    smoothing_curve: { 
        min: 0.1, 
        max: 5, 
        step: 0.1, 
        description: 'Curve shape for smoothing (higher = more aggressive)',
        label: 'Smoothing Curve',
        category: 'Smoothing',
        defaultEnabled: false,
        decimals: 1
    },
    dry_allowed_length: { 
        min: 0, 
        max: 20, 
        step: 1, 
        description: 'Maximum allowed repetition length',
        label: 'DRY Allowed Length',
        category: 'DRY',
        defaultEnabled: false,
        decimals: 0
    },
    dry_penalty_last_n: { 
        min: -1, 
        max: 4096, 
        step: 64, 
        description: 'Tokens to consider for DRY penalty (-1 = all)',
        label: 'DRY Penalty Last N',
        category: 'DRY',
        defaultEnabled: false,
        decimals: 0
    },
    dry_base: { 
        min: 1, 
        max: 3, 
        step: 0.05, 
        description: 'Base for DRY exponential penalty',
        label: 'DRY Base',
        category: 'DRY',
        defaultEnabled: false,
        decimals: 2
    },
    dry_multiplier: { 
        min: 0, 
        max: 2, 
        step: 0.05, 
        description: 'Multiplier for DRY penalty (0 = disabled)',
        label: 'DRY Multiplier',
        category: 'DRY',
        defaultEnabled: false,
        decimals: 2
    },
    dry_sequence_breaker: { 
        min: 0, 
        max: 0, 
        step: 0, 
        description: 'Characters that break DRY sequence detection',
        label: 'DRY Sequence Breaker',
        category: 'DRY',
        defaultEnabled: false,
        isString: true
    },
    ignore_eos: { 
        min: 0, 
        max: 1, 
        step: 1, 
        description: 'Ignore End-Of-Sequence token (0=disabled, 1=enabled)',
        label: 'Ignore EOS',
        category: 'Other',
        defaultEnabled: false,
        isBoolean: true
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

// Format number to remove trailing zeros
const formatNumber = (num: number, decimals: number): string => {
    if (decimals === 0) return String(num);
    const formatted = num.toFixed(decimals);
    // Remove trailing zeros and decimal point if no decimals needed
    return parseFloat(formatted).toString();
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
                setParameters({
                    temperature: getParamValue(existingSampler.parameters, 'temperature', DEFAULT_PARAMETERS.temperature) as number,
                    top_k: getParamValue(existingSampler.parameters, 'top_k', DEFAULT_PARAMETERS.top_k) as number,
                    top_p: getParamValue(existingSampler.parameters, 'top_p', DEFAULT_PARAMETERS.top_p) as number,
                    repeat_penalty: getParamValue(existingSampler.parameters, 'repeat_penalty', DEFAULT_PARAMETERS.repeat_penalty) as number,
                    frequency_penalty: getParamValue(existingSampler.parameters, 'frequency_penalty', DEFAULT_PARAMETERS.frequency_penalty) as number,
                    presence_penalty: getParamValue(existingSampler.parameters, 'presence_penalty', DEFAULT_PARAMETERS.presence_penalty) as number,
                    min_p: getParamValue(existingSampler.parameters, 'min_p', DEFAULT_PARAMETERS.min_p) as number,
                    typical_p: getParamValue(existingSampler.parameters, 'typical_p', DEFAULT_PARAMETERS.typical_p) as number,
                    tfs_z: getParamValue(existingSampler.parameters, 'tfs_z', DEFAULT_PARAMETERS.tfs_z) as number,
                    top_a: getParamValue(existingSampler.parameters, 'top_a', DEFAULT_PARAMETERS.top_a) as number,
                    mirostat: getParamValue(existingSampler.parameters, 'mirostat', DEFAULT_PARAMETERS.mirostat) as number,
                    mirostat_tau: getParamValue(existingSampler.parameters, 'mirostat_tau', DEFAULT_PARAMETERS.mirostat_tau) as number,
                    mirostat_eta: getParamValue(existingSampler.parameters, 'mirostat_eta', DEFAULT_PARAMETERS.mirostat_eta) as number,
                    rep_penalty_range: getParamValue(existingSampler.parameters, 'rep_penalty_range', DEFAULT_PARAMETERS.rep_penalty_range) as number,
                    rep_penalty_slope: getParamValue(existingSampler.parameters, 'rep_penalty_slope', DEFAULT_PARAMETERS.rep_penalty_slope) as number,
                    encoder_repetition_penalty: getParamValue(existingSampler.parameters, 'encoder_repetition_penalty', DEFAULT_PARAMETERS.encoder_repetition_penalty) as number,
                    no_repeat_ngram_size: getParamValue(existingSampler.parameters, 'no_repeat_ngram_size', DEFAULT_PARAMETERS.no_repeat_ngram_size) as number,
                    penalty_alpha: getParamValue(existingSampler.parameters, 'penalty_alpha', DEFAULT_PARAMETERS.penalty_alpha) as number,
                    smoothing_factor: getParamValue(existingSampler.parameters, 'smoothing_factor', DEFAULT_PARAMETERS.smoothing_factor) as number,
                    smoothing_curve: getParamValue(existingSampler.parameters, 'smoothing_curve', DEFAULT_PARAMETERS.smoothing_curve) as number,
                    dry_allowed_length: getParamValue(existingSampler.parameters, 'dry_allowed_length', DEFAULT_PARAMETERS.dry_allowed_length) as number,
                    dry_penalty_last_n: getParamValue(existingSampler.parameters, 'dry_penalty_last_n', DEFAULT_PARAMETERS.dry_penalty_last_n) as number,
                    dry_base: getParamValue(existingSampler.parameters, 'dry_base', DEFAULT_PARAMETERS.dry_base) as number,
                    dry_multiplier: getParamValue(existingSampler.parameters, 'dry_multiplier', DEFAULT_PARAMETERS.dry_multiplier) as number,
                    dry_sequence_breaker: getParamValue(existingSampler.parameters, 'dry_sequence_breaker', DEFAULT_PARAMETERS.dry_sequence_breaker) as string,
                    ignore_eos: getParamValue(existingSampler.parameters, 'ignore_eos', DEFAULT_PARAMETERS.ignore_eos) as boolean,
                });
                
                const storedEnabled: Partial<EnabledParams> = {};
                Object.keys(DEFAULT_ENABLED).forEach(key => {
                    const stored = existingSampler.parameters?.[`_enabled_${key}`];
                    if (typeof stored === 'boolean') {
                        storedEnabled[key as keyof EnabledParams] = stored;
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
            newErrors.name = 'Sampler name is required';
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

    const dragHandleStyle: React.CSSProperties = {
        cursor: 'grab',
        opacity: 0.3,
        fontSize: '0.8rem',
        padding: '4px 6px',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'opacity 0.2s',
        minWidth: '20px',
        flexShrink: 0,
        marginRight: '8px',
    };

    const parameterItemStyle = (isDragging: boolean, isEnabled: boolean): React.CSSProperties => ({
        display: 'flex',
        alignItems: 'stretch',
        gap: '2px',
        padding: '8px',
        borderRadius: '6px',
        background: isDragging ? 'var(--accent-bg)' : 'transparent',
        border: isDragging ? '2px dashed var(--accent)' : '2px solid transparent',
        transition: 'all 0.2s',
        opacity: isDragging ? 0.5 : (isEnabled ? 1 : 0.5),
    });

    const renderParameterInput = (key: string, config: any, paramKey: keyof SamplerParameters) => {
        const isEnabled = enabledParams[paramKey as keyof EnabledParams] ?? false;
        
        if (config.isString) {
            return (
                <input
                    type="text"
                    value={parameters[paramKey] as string}
                    onChange={(e) => handleParameterChange(paramKey, e.target.value)}
                    disabled={!isEnabled}
                    style={{
                        width: '100%',
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                        borderRadius: '4px',
                        border: `1px solid ${isEnabled ? 'var(--border)' : 'var(--border)'}`,
                        background: isEnabled ? 'var(--bg)' : 'var(--social-bg)',
                        color: isEnabled ? 'var(--text-h)' : 'var(--text-h)',
                        opacity: isEnabled ? 1 : 0.5,
                        outline: 'none',
                        cursor: isEnabled ? 'text' : 'not-allowed',
                    }}
                />
            );
        }

        if (config.isBoolean) {
            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '4px 0',
                }}>
                    <button
                        type="button"
                        onClick={() => handleParameterChange(paramKey, !parameters[paramKey] as boolean)}
                        disabled={!isEnabled}
                        style={{
                            padding: '4px 12px',
                            borderRadius: '4px',
                            border: `1px solid ${parameters[paramKey] ? 'var(--accent)' : 'var(--border)'}`,
                            background: parameters[paramKey] ? 'var(--accent-bg)' : 'transparent',
                            color: parameters[paramKey] ? 'var(--accent)' : 'var(--text-h)',
                            cursor: isEnabled ? 'pointer' : 'not-allowed',
                            fontSize: '0.75rem',
                            fontFamily: 'inherit',
                            opacity: isEnabled ? 1 : 0.5,
                        }}
                    >
                        {parameters[paramKey] ? '✓ Enabled' : '✗ Disabled'}
                    </button>
                </div>
            );
        }

        const decimals = config.decimals || 2;
        return (
            <SliderInput
                label=""
                value={parameters[paramKey] as number}
                minimumValue={config.min}
                maximumValue={config.max}
                stepValue={config.step}
                decimals={decimals}
                onChange={(value) => handleParameterChange(paramKey, value)}
                description={config.description}
                disabled={!isEnabled}
            />
        );
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '700px', maxHeight: '95vh', overflow: 'hidden' }}
            >
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <h2>{existingSampler ? 'Edit Sampler' : 'Create New Sampler'}</h2>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                            type="button"
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
                            onClick={handleSubmit}
                            style={{
                                ...buttonStyle,
                                background: 'var(--accent)',
                                color: '#fff',
                            }}
                        >
                            {existingSampler ? 'Update' : 'Create'}
                        </button>
                    </div>
                </div>

                <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>
                            Sampler Name <span style={{ color: '#ff4444' }}>*</span>
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
                            placeholder="e.g., Creative Writing, Balanced, Deterministic"
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
                            placeholder="Describe how this sampler works"
                            rows={2}
                        />
                    </div>

                    {/* Maximum Number Of Tokens */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>Maximum Number Of Tokens</label>
                        <input
                            type="number"
                            value={maxTokens}
                            onChange={(e) => setMaxTokens(Number(e.target.value) || 0)}
                            style={inputStyle}
                            placeholder="512"
                            min="1"
                            step="1"
                        />
                    </div>

                    {/* Parameters - Draggable */}
                    <div style={sectionStyle}>
                        <div style={{ 
                            ...sectionTitleStyle, 
                            display: 'flex', 
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            paddingRight: '4px',
                        }}>
                            <span>Sampling Parameters ({parameterOrder.length})</span>
                            <span style={{ 
                                fontSize: '0.6rem', 
                                opacity: 0.5,
                                fontWeight: 'normal',
                                marginLeft: '16px',
                                textTransform: 'none',
                            }}>
                                ↕ Drag To Reorder
                            </span>
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
                                        style={parameterItemStyle(isDragging, isEnabled)}
                                    >
                                        <div 
                                            style={dragHandleStyle}
                                            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                                            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.3'}
                                            title="Drag to reorder"
                                        >
                                            ⋮⋮
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '1px',
                                                marginBottom: '4px',
                                            }}>
                                                <div
                                                    onClick={() => handleEnableToggle(paramKey as keyof EnabledParams)}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        cursor: 'pointer',
                                                        userSelect: 'none',
                                                        flexShrink: 0,
                                                        height: '28px',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: '16px',
                                                            height: '16px',
                                                            borderRadius: '4px',
                                                            border: `2px solid ${isEnabled ? 'var(--accent)' : 'var(--border)'}`,
                                                            background: isEnabled ? 'var(--accent)' : 'transparent',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            transition: 'all 0.2s',
                                                            flexShrink: 0,
                                                        }}
                                                    >
                                                        {isEnabled && (
                                                            <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>
                                                        )}
                                                    </div>
                                                    <span style={{
                                                        fontSize: '0.75rem',
                                                        fontWeight: 'bold',
                                                        color: isEnabled ? 'var(--accent)' : 'var(--text-h)',
                                                        opacity: isEnabled ? 1 : 0.5,
                                                    }}>
                                                        {config.label}
                                                    </span>
                                                </div>
                                            </div>
                                            {renderParameterInput(key, config, paramKey)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Stop Patterns */}
                    {allStopPatterns.length > 0 && (
                        <div style={sectionStyle}>
                            <div style={sectionTitleStyle}>Stop Patterns</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {allStopPatterns.map(sp => {
                                    const isSelected = selectedStopPatternIds.includes(sp.id);
                                    return (
                                        <div
                                            key={sp.id}
                                            onClick={() => handleStopPatternToggle(sp.id)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px',
                                                padding: '6px 12px',
                                                borderRadius: '6px',
                                                background: isSelected ? 'var(--accent-bg)' : 'transparent',
                                                border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: '18px',
                                                    height: '18px',
                                                    borderRadius: '4px',
                                                    border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                                                    background: isSelected ? 'var(--accent)' : 'transparent',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {isSelected && (
                                                    <span style={{ color: '#fff', fontSize: '12px' }}>✓</span>
                                                )}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-h)' }}>
                                                    {sp.name}
                                                </div>
                                                {sp.description && (
                                                    <div style={{ fontSize: '0.7rem', opacity: 0.6, color: 'var(--text-h)' }}>
                                                        {sp.description}
                                                    </div>
                                                )}
                                                <div style={{ 
                                                    fontSize: '0.65rem', 
                                                    fontFamily: 'monospace', 
                                                    opacity: 0.5, 
                                                    color: 'var(--text-h)',
                                                    marginTop: '2px',
                                                }}>
                                                    {sp.pattern}
                                                </div>
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