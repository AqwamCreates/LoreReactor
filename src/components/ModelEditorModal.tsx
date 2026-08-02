import type React from 'react';
import { useState, useEffect } from 'react';
import type { LanguageModel } from '../types';
import { vramUseEstimation } from '../hooks/vramUseEstimation';
import './main.css';

interface ModelEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (model: LanguageModel) => void;
    onDelete?: (id: string) => void;
    existingModel?: LanguageModel | null;
}

interface ModelSettings {
    // Main options
    gpu_layers: number;
    ctx_size: number;
    cache_type: string;
    split_mode: string;
    ik: boolean;
    
    // Speculative decoding
    spec_type: string;
    draft_max: number;
    draft_model: string;
    gpu_layers_draft: number;
    device_draft: string;
    
    // Other options
    parallel: number;
    threads: number;
    threads_batch: number;
    batch_size: number;
    ubatch_size: number;
    fit_target: string;
    tensor_split: string;
    extra_flags: string;
    cpu_moe: boolean;
    no_kv_offload: boolean;
    no_mmap: boolean;
    mlock: boolean;
    numa: boolean;
}

const DEFAULT_SETTINGS: ModelSettings = {
    // Main options
    gpu_layers: -1,
    ctx_size: 0,
    cache_type: 'fp16',
    split_mode: 'layer',
    ik: false,
    
    // Speculative decoding
    spec_type: 'none',
    draft_max: 3,
    draft_model: '',
    gpu_layers_draft: 256,
    device_draft: '',
    
    // Other options
    parallel: 1,
    threads: 0,
    threads_batch: 0,
    batch_size: 1024,
    ubatch_size: 1024,
    fit_target: '512',
    tensor_split: '',
    extra_flags: '',
    cpu_moe: false,
    no_kv_offload: false,
    no_mmap: false,
    mlock: false,
    numa: false,
};

const BACKEND_OPTIONS = [
    { value: 'Llama.cpp', label: 'Llama.cpp' },
    { value: 'Transformers', label: 'Transformers' },
    { value: 'ExLlamaV3', label: 'ExLlamaV3' },
    { value: 'ExLlamaV3 HF', label: 'ExLlamaV3 HF' },
    { value: 'ExLlamaV2', label: 'ExLlamaV2' },
    { value: 'TensorRT-LLM', label: 'TensorRT-LLM' },
    { value: 'Ollama', label: 'Ollama' },
    { value: 'DeepSeek', label: 'DeepSeek' },
    { value: 'Qwen', label: 'Qwen' },
    { value: 'OpenAI', label: 'OpenAI' },
    { value: 'Other', label: 'Other' },
];

const SPLIT_MODE_OPTIONS = [
    { value: 'layer', label: 'Layer Split' },
    { value: 'row', label: 'Row Split' },
    { value: 'tensor', label: 'Tensor Split' },
];

const SPEC_TYPE_OPTIONS = [
    { value: 'none', label: 'None' },
    { value: 'draft-mtp', label: 'Draft MTP' },
    { value: 'ngram-mod', label: 'N-Gram Mod' },
];

// Cache type options for each backend
const getCacheTypes = (backend: string) => {
    switch (backend) {
        case 'Llama.cpp':
            return [
                { value: 'fp16', label: 'FP16' },
                { value: 'q8_0', label: 'Q8_0' },
                { value: 'q4_0', label: 'Q4_0' },
            ];
        case 'Ollama':
            return [
                { value: 'f16', label: 'F16' },
                { value: 'q8_0', label: 'Q8_0' },
                { value: 'q4_0', label: 'Q4_0' },
            ];
        case 'ExLlamaV3':
        case 'ExLlamaV3 HF':
            return [
                { value: 'fp16', label: 'FP16' },
                { value: 'fp8', label: 'FP8' },
                { value: 'q8', label: 'Q8' },
                { value: 'q7', label: 'Q7' },
                { value: 'q6', label: 'Q6' },
                { value: 'q5', label: 'Q5' },
                { value: 'q4', label: 'Q4' },
                { value: 'q3', label: 'Q3' },
                { value: 'q2', label: 'Q2' },
                { value: 'q4_q8', label: 'Q4_Q8' },
            ];
        case 'ExLlamaV2':
            return [
                { value: 'fp16', label: 'FP16' },
                { value: 'fp8', label: 'FP8' },
                { value: 'q8', label: 'Q8' },
                { value: 'q6', label: 'Q6' },
                { value: 'q4', label: 'Q4' },
            ];
        case 'TensorRT-LLM':
            return [
                { value: 'auto', label: 'Auto' },
                { value: 'fp16', label: 'FP16' },
                { value: 'bf16', label: 'BF16' },
                { value: 'fp8', label: 'FP8' },
                { value: 'int8', label: 'INT8' },
                { value: 'nvfp4', label: 'NVFP4' },
            ];
        case 'Transformers':
            return [
                { value: 'dynamic', label: 'Dynamic' },
                { value: 'static', label: 'Static' },
                { value: 'offloaded', label: 'Offloaded' },
                { value: 'offloaded_static', label: 'Offloaded Static' },
                { value: 'quantized', label: 'Quantized' },
                { value: 'sliding_window', label: 'Sliding Window' },
                { value: 'sink', label: 'Sink' },
            ];
        case 'DeepSeek':
            return [
                { value: 'auto', label: 'Auto' },
            ];
        case 'Qwen':
            return [
                { value: 'align', label: 'Align' },
                { value: 'dynamic', label: 'Dynamic' },
            ];
        case 'OpenAI':
        case 'Other':
        default:
            return [
                { value: 'default', label: 'Default' },
            ];
    }
};

export function ModelEditorModal({
    isOpen,
    onClose,
    onSave,
    onDelete,
    existingModel,
}: ModelEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [backend, setBackend] = useState<LanguageModel['backend']>('Llama.cpp');
    const [contextLength, setContextLength] = useState<number>(8192);
    const [modelPath, setModelPath] = useState('');
    const [mmprojPath, setMmprojPath] = useState('');
    
    const [settings, setSettings] = useState<ModelSettings>({ ...DEFAULT_SETTINGS });

    const [errors, setErrors] = useState<{ name?: string; model?: string }>({});

    // Use the VRAM estimation hook
    const { estimatedVRAM, isEstimating, error } = vramUseEstimation({
        modelName: name || modelPath || '7B',
        gpuLayers: settings.gpu_layers,
        cacheType: settings.cache_type,
        contextSize: settings.ctx_size || 8192,
        backend: backend,
    });

    // Reset cache type to default when backend changes
    useEffect(() => {
        const cacheTypes = getCacheTypes(backend);
        const currentCacheTypeExists = cacheTypes.some(ct => ct.value === settings.cache_type);
        if (!currentCacheTypeExists && cacheTypes.length > 0) {
            handleSettingChange('cache_type', cacheTypes[0].value);
        }
    }, [backend]);

    useEffect(() => {
        if (isOpen) {
            if (existingModel) {
                setName(existingModel.name || '');
                setDescription(existingModel.description || '');
                setBackend(existingModel.backend || 'Llama.cpp');
                setContextLength(existingModel.contextLength || 8192);
                setModelPath(existingModel.model || '');
                setMmprojPath(existingModel.mmproj || '');
                
                if (existingModel.parameters) {
                    const params = existingModel.parameters;
                    setSettings({
                        gpu_layers: (params.gpu_layers as number) ?? DEFAULT_SETTINGS.gpu_layers,
                        ctx_size: (params.ctx_size as number) ?? DEFAULT_SETTINGS.ctx_size,
                        cache_type: (params.cache_type as string) ?? DEFAULT_SETTINGS.cache_type,
                        split_mode: (params.split_mode as string) ?? DEFAULT_SETTINGS.split_mode,
                        ik: (params.ik as boolean) ?? DEFAULT_SETTINGS.ik,
                        spec_type: (params.spec_type as string) ?? DEFAULT_SETTINGS.spec_type,
                        draft_max: (params.draft_max as number) ?? DEFAULT_SETTINGS.draft_max,
                        draft_model: (params.draft_model as string) ?? DEFAULT_SETTINGS.draft_model,
                        gpu_layers_draft: (params.gpu_layers_draft as number) ?? DEFAULT_SETTINGS.gpu_layers_draft,
                        device_draft: (params.device_draft as string) ?? DEFAULT_SETTINGS.device_draft,
                        parallel: (params.parallel as number) ?? DEFAULT_SETTINGS.parallel,
                        threads: (params.threads as number) ?? DEFAULT_SETTINGS.threads,
                        threads_batch: (params.threads_batch as number) ?? DEFAULT_SETTINGS.threads_batch,
                        batch_size: (params.batch_size as number) ?? DEFAULT_SETTINGS.batch_size,
                        ubatch_size: (params.ubatch_size as number) ?? DEFAULT_SETTINGS.ubatch_size,
                        fit_target: (params.fit_target as string) ?? DEFAULT_SETTINGS.fit_target,
                        tensor_split: (params.tensor_split as string) ?? DEFAULT_SETTINGS.tensor_split,
                        extra_flags: (params.extra_flags as string) ?? DEFAULT_SETTINGS.extra_flags,
                        cpu_moe: (params.cpu_moe as boolean) ?? DEFAULT_SETTINGS.cpu_moe,
                        no_kv_offload: (params.no_kv_offload as boolean) ?? DEFAULT_SETTINGS.no_kv_offload,
                        no_mmap: (params.no_mmap as boolean) ?? DEFAULT_SETTINGS.no_mmap,
                        mlock: (params.mlock as boolean) ?? DEFAULT_SETTINGS.mlock,
                        numa: (params.numa as boolean) ?? DEFAULT_SETTINGS.numa,
                    });
                } else {
                    setSettings({ ...DEFAULT_SETTINGS });
                }
            } else {
                setName('');
                setDescription('');
                setBackend('Llama.cpp');
                setContextLength(8192);
                setModelPath('');
                setMmprojPath('');
                setSettings({ ...DEFAULT_SETTINGS });
            }
            setErrors({});
        }
    }, [isOpen, existingModel]);

    const handleSettingChange = <K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const validate = (): boolean => {
        const newErrors: { name?: string; model?: string } = {};
        
        if (!name.trim()) {
            newErrors.name = 'Model name is required';
        }
        
        if (!modelPath.trim()) {
            newErrors.model = 'Model path is required';
        }
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = () => {
        if (!validate()) return;

        const params: Record<string, unknown> = {};
        
        // Only include non-empty/non-default values
        if (settings.gpu_layers !== DEFAULT_SETTINGS.gpu_layers) {
            params.gpu_layers = settings.gpu_layers;
        }
        if (settings.ctx_size !== DEFAULT_SETTINGS.ctx_size) {
            params.ctx_size = settings.ctx_size;
        }
        if (settings.cache_type !== DEFAULT_SETTINGS.cache_type) {
            params.cache_type = settings.cache_type;
        }
        if (settings.split_mode !== DEFAULT_SETTINGS.split_mode) {
            params.split_mode = settings.split_mode;
        }
        if (settings.ik !== DEFAULT_SETTINGS.ik) {
            params.ik = settings.ik;
        }
        if (settings.spec_type !== DEFAULT_SETTINGS.spec_type) {
            params.spec_type = settings.spec_type;
        }
        if (settings.draft_max !== DEFAULT_SETTINGS.draft_max) {
            params.draft_max = settings.draft_max;
        }
        if (settings.draft_model && settings.draft_model.trim()) {
            params.draft_model = settings.draft_model;
        }
        if (settings.gpu_layers_draft !== DEFAULT_SETTINGS.gpu_layers_draft) {
            params.gpu_layers_draft = settings.gpu_layers_draft;
        }
        if (settings.device_draft && settings.device_draft.trim()) {
            params.device_draft = settings.device_draft;
        }
        if (settings.parallel !== DEFAULT_SETTINGS.parallel) {
            params.parallel = settings.parallel;
        }
        if (settings.threads !== DEFAULT_SETTINGS.threads) {
            params.threads = settings.threads;
        }
        if (settings.threads_batch !== DEFAULT_SETTINGS.threads_batch) {
            params.threads_batch = settings.threads_batch;
        }
        if (settings.batch_size !== DEFAULT_SETTINGS.batch_size) {
            params.batch_size = settings.batch_size;
        }
        if (settings.ubatch_size !== DEFAULT_SETTINGS.ubatch_size) {
            params.ubatch_size = settings.ubatch_size;
        }
        if (settings.fit_target !== DEFAULT_SETTINGS.fit_target) {
            params.fit_target = settings.fit_target;
        }
        if (settings.tensor_split && settings.tensor_split.trim()) {
            params.tensor_split = settings.tensor_split;
        }
        if (settings.extra_flags && settings.extra_flags.trim()) {
            params.extra_flags = settings.extra_flags;
        }
        if (settings.cpu_moe !== DEFAULT_SETTINGS.cpu_moe) {
            params.cpu_moe = settings.cpu_moe;
        }
        if (settings.no_kv_offload !== DEFAULT_SETTINGS.no_kv_offload) {
            params.no_kv_offload = settings.no_kv_offload;
        }
        if (settings.no_mmap !== DEFAULT_SETTINGS.no_mmap) {
            params.no_mmap = settings.no_mmap;
        }
        if (settings.mlock !== DEFAULT_SETTINGS.mlock) {
            params.mlock = settings.mlock;
        }
        if (settings.numa !== DEFAULT_SETTINGS.numa) {
            params.numa = settings.numa;
        }

        const model: LanguageModel = {
            id: existingModel?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim() || undefined,
            backend,
            contextLength: contextLength || 8192,
            model: modelPath.trim(),
            mmproj: mmprojPath.trim() || undefined,
            parameters: Object.keys(params).length > 0 ? params : undefined,
        };

        onSave(model);
        onClose();
    };

    const handleDelete = () => {
        if (!existingModel) return;
        if (!window.confirm(`Delete model "${existingModel.name}" permanently?`)) return;
        onDelete?.(existingModel.id);
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

    const disclaimerStyle: React.CSSProperties = {
        fontSize: '0.7rem',
        color: 'var(--text-h)',
        opacity: 0.6,
        padding: '8px 12px',
        borderRadius: '6px',
        background: 'var(--social-bg)',
        border: '1px solid var(--border)',
        marginTop: '8px',
        fontStyle: 'italic',
    };

    const vramStyle: React.CSSProperties = {
        fontSize: '0.7rem',
        color: 'var(--accent)',
        padding: '4px 8px',
        borderRadius: '4px',
        background: 'var(--accent-bg)',
        border: '1px solid var(--accent-border)',
        display: 'inline-block',
        fontWeight: 'bold',
    };

    const cacheTypes = getCacheTypes(backend);

    // Determine what to display for VRAM
    const displayVRAM = isEstimating ? '...' : (error ? 'Unknown' : estimatedVRAM);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '700px', maxHeight: '90vh', overflow: 'hidden' }}
            >
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <h2>{existingModel ? 'Edit Model' : 'Create New Model'}</h2>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {/* VRAM Estimation in top right corner */}
                        {backend === 'Llama.cpp' && (
                            <div style={vramStyle}>
                                💾 {displayVRAM} GB
                            </div>
                        )}
                        {existingModel && onDelete && (
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
                            {existingModel ? 'Update' : 'Create'}
                        </button>
                    </div>
                </div>

                <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>
                            Model Name <span style={{ color: '#ff4444' }}>*</span>
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
                            placeholder="e.g., Llama-3-70B-Instruct"
                        />
                        {errors.name && <div style={errorStyle}>{errors.name}</div>}
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            style={{ ...inputStyle, minHeight: '60px' }}
                            placeholder="Describe the model's strengths, use cases, etc."
                            rows={2}
                        />
                    </div>

                    {/* Backend */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>Backend</label>
                        <select
                            value={backend}
                            onChange={(e) => setBackend(e.target.value as LanguageModel['backend'])}
                            style={selectStyle}
                        >
                            {BACKEND_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Model Path */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>
                            Model Path <span style={{ color: '#ff4444' }}>*</span>
                        </label>
                        <input
                            type="text"
                            value={modelPath}
                            onChange={(e) => {
                                setModelPath(e.target.value);
                                if (errors.model) setErrors({ ...errors, model: undefined });
                            }}
                            style={{
                                ...inputStyle,
                                borderColor: errors.model ? '#ff4444' : 'var(--border)',
                                fontFamily: 'monospace',
                            }}
                            placeholder="/path/to/model.gguf"
                        />
                        {errors.model && <div style={errorStyle}>{errors.model}</div>}
                    </div>

                    {/* MMProj Path */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>
                            MMProj Path
                        </label>
                        <input
                            type="text"
                            value={mmprojPath}
                            onChange={(e) => {
                                setMmprojPath(e.target.value);
                            }}
                            style={{
                                ...inputStyle,
                                fontFamily: 'monospace',
                            }}
                            placeholder="/path/to/mmproj.gguf"
                        />
                        {mmprojPath && (
                            <div
                                style={{
                                    fontSize: '0.7rem',
                                    color: 'var(--accent)',
                                    marginTop: '4px',
                                }}
                            >
                                ✓ Multi-modal support enabled
                            </div>
                        )}
                    </div>

                    {/* Main Options */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>Main Options</div>
                        
                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>GPU Layers</label>
                                <input
                                    type="number"
                                    value={settings.gpu_layers}
                                    onChange={(e) => handleSettingChange('gpu_layers', Number(e.target.value) || -1)}
                                    style={inputStyle}
                                    min="-1"
                                    step="1"
                                    placeholder="-1 (auto)"
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Context Size</label>
                                <input
                                    type="number"
                                    value={settings.ctx_size}
                                    onChange={(e) => handleSettingChange('ctx_size', Number(e.target.value) || 0)}
                                    style={inputStyle}
                                    min="0"
                                    step="1"
                                    placeholder="0 (auto)"
                                />
                            </div>
                        </div>

                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Cache Type</label>
                                <select
                                    value={settings.cache_type}
                                    onChange={(e) => handleSettingChange('cache_type', e.target.value)}
                                    style={selectStyle}
                                >
                                    {cacheTypes.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Split Mode</label>
                                <select
                                    value={settings.split_mode}
                                    onChange={(e) => handleSettingChange('split_mode', e.target.value)}
                                    style={selectStyle}
                                >
                                    {SPLIT_MODE_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div style={{ ...rowStyle, marginTop: '8px' }}>
                            <label style={checkboxStyle}>
                                <input
                                    type="checkbox"
                                    checked={settings.ik}
                                    onChange={(e) => handleSettingChange('ik', e.target.checked)}
                                    style={checkboxInputStyle}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-h)' }}>Use IK Llama.cpp</span>
                            </label>
                        </div>

                        <div style={disclaimerStyle}>
                            ℹ️ LoreReactor uses Streaming LLM by default for optimal performance.
                        </div>
                    </div>

                    {/* Speculative Decoding */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>Speculative Decoding</div>
                        
                        <div style={fullRowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Draft Model</label>
                                <input
                                    type="text"
                                    value={settings.draft_model}
                                    onChange={(e) => handleSettingChange('draft_model', e.target.value)}
                                    style={{ ...inputStyle, fontFamily: 'monospace' }}
                                    placeholder="/path/to/draft/model.gguf"
                                />
                            </div>
                        </div>

                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Speculation Type</label>
                                <select
                                    value={settings.spec_type}
                                    onChange={(e) => handleSettingChange('spec_type', e.target.value)}
                                    style={selectStyle}
                                >
                                    {SPEC_TYPE_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Draft Maximum</label>
                                <input
                                    type="number"
                                    value={settings.draft_max}
                                    onChange={(e) => handleSettingChange('draft_max', Number(e.target.value) || 3)}
                                    style={inputStyle}
                                    min="1"
                                    step="1"
                                    placeholder="3"
                                />
                            </div>
                        </div>

                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>GPU Layers (Draft)</label>
                                <input
                                    type="number"
                                    value={settings.gpu_layers_draft}
                                    onChange={(e) => handleSettingChange('gpu_layers_draft', Number(e.target.value) || 256)}
                                    style={inputStyle}
                                    min="0"
                                    step="1"
                                    placeholder="256"
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Device (Draft)</label>
                                <input
                                    type="text"
                                    value={settings.device_draft}
                                    onChange={(e) => handleSettingChange('device_draft', e.target.value)}
                                    style={inputStyle}
                                    placeholder="CUDA0,CUDA1"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Other Options */}
                    <div style={{ ...sectionStyle, marginBottom: '0' }}>
                        <div style={sectionTitleStyle}>Other Options</div>
                        
                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Parallel Slots</label>
                                <input
                                    type="number"
                                    value={settings.parallel}
                                    onChange={(e) => handleSettingChange('parallel', Number(e.target.value) || 1)}
                                    style={inputStyle}
                                    min="1"
                                    step="1"
                                    placeholder="1"
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Thread Count</label>
                                <input
                                    type="number"
                                    value={settings.threads}
                                    onChange={(e) => handleSettingChange('threads', Number(e.target.value) || 0)}
                                    style={inputStyle}
                                    min="0"
                                    step="1"
                                    placeholder="0 (auto)"
                                />
                            </div>
                        </div>

                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Thread Count (Batch)</label>
                                <input
                                    type="number"
                                    value={settings.threads_batch}
                                    onChange={(e) => handleSettingChange('threads_batch', Number(e.target.value) || 0)}
                                    style={inputStyle}
                                    min="0"
                                    step="1"
                                    placeholder="0 (auto)"
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Batch Size</label>
                                <input
                                    type="number"
                                    value={settings.batch_size}
                                    onChange={(e) => handleSettingChange('batch_size', Number(e.target.value) || 1024)}
                                    style={inputStyle}
                                    min="1"
                                    step="1"
                                    placeholder="1024"
                                />
                            </div>
                        </div>

                        <div style={rowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Micro Batch Size</label>
                                <input
                                    type="number"
                                    value={settings.ubatch_size}
                                    onChange={(e) => handleSettingChange('ubatch_size', Number(e.target.value) || 1024)}
                                    style={inputStyle}
                                    min="1"
                                    step="1"
                                    placeholder="1024"
                                />
                            </div>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Fit Target (MiB)</label>
                                <input
                                    type="text"
                                    value={settings.fit_target}
                                    onChange={(e) => handleSettingChange('fit_target', e.target.value)}
                                    style={inputStyle}
                                    placeholder="512"
                                />
                            </div>
                        </div>

                        <div style={fullRowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Tensor Split</label>
                                <input
                                    type="text"
                                    value={settings.tensor_split}
                                    onChange={(e) => handleSettingChange('tensor_split', e.target.value)}
                                    style={{ ...inputStyle, fontFamily: 'monospace' }}
                                    placeholder="60,40"
                                />
                            </div>
                        </div>

                        <div style={fullRowStyle}>
                            <div>
                                <label style={{ ...labelStyle, fontSize: '0.65rem' }}>Extra Flags</label>
                                <input
                                    type="text"
                                    value={settings.extra_flags}
                                    onChange={(e) => handleSettingChange('extra_flags', e.target.value)}
                                    style={{ ...inputStyle, fontFamily: 'monospace' }}
                                    placeholder="--jinja --rpc 192.168.1.100:50052"
                                />
                            </div>
                        </div>

                        <div style={{ ...rowStyle, marginTop: '8px' }}>
                            <label style={checkboxStyle}>
                                <input
                                    type="checkbox"
                                    checked={settings.cpu_moe}
                                    onChange={(e) => handleSettingChange('cpu_moe', e.target.checked)}
                                    style={checkboxInputStyle}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-h)' }}>Mixture-Of-Experts On CPU</span>
                            </label>
                            <label style={checkboxStyle}>
                                <input
                                    type="checkbox"
                                    checked={settings.no_kv_offload}
                                    onChange={(e) => handleSettingChange('no_kv_offload', e.target.checked)}
                                    style={checkboxInputStyle}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-h)' }}>No Key-Value Offload</span>
                            </label>
                        </div>

                        <div style={rowStyle}>
                            <label style={checkboxStyle}>
                                <input
                                    type="checkbox"
                                    checked={settings.no_mmap}
                                    onChange={(e) => handleSettingChange('no_mmap', e.target.checked)}
                                    style={checkboxInputStyle}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-h)' }}>No Memory Map</span>
                            </label>
                            <label style={checkboxStyle}>
                                <input
                                    type="checkbox"
                                    checked={settings.mlock}
                                    onChange={(e) => handleSettingChange('mlock', e.target.checked)}
                                    style={checkboxInputStyle}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-h)' }}>Memory Lock</span>
                            </label>
                        </div>

                        <div style={rowStyle}>
                            <label style={checkboxStyle}>
                                <input
                                    type="checkbox"
                                    checked={settings.numa}
                                    onChange={(e) => handleSettingChange('numa', e.target.checked)}
                                    style={checkboxInputStyle}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-h)' }}>Non-Uniform Memory Access</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}