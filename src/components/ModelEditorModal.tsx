// src/components/ModelEditorModal.tsx
import type React from 'react';
import { useState, useEffect } from 'react';
import type { LanguageModel, StopPattern } from '../types';
import { vramUseEstimation } from '../hooks/vramUseEstimation';
import './main.css';

interface ModelEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (model: LanguageModel) => void;
    onDelete?: (id: string) => void;
    existingModel?: LanguageModel | null;
    allStopPatterns: StopPattern[];
}

interface ModelSettings {
    gpu_layers: number;
    ctx_size: number;
    cache_type: string;
    split_mode: string;
    ik: boolean;
    spec_type: string;
    draft_max: number;
    draft_model: string;
    gpu_layers_draft: number;
    device_draft: string;
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
    gpu_layers: -1,
    ctx_size: 0,
    cache_type: 'fp16',
    split_mode: 'layer',
    ik: false,
    spec_type: 'none',
    draft_max: 3,
    draft_model: '',
    gpu_layers_draft: 256,
    device_draft: '',
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

// ✅ Cloud backends that require API keys
const CLOUD_BACKENDS = ['DeepSeek', 'Qwen', 'Kimi', 'OpenAI', 'Mistral', 'Groq', 'OpenRouter', 'Inworld'];

const getCacheTypes = (backend: string) => {
    switch (backend) {
        case 'Llama.cpp': return [{ value: 'fp16', label: 'FP16' }, { value: 'q8_0', label: 'Q8_0' }, { value: 'q4_0', label: 'Q4_0' }];
        case 'Ollama': return [{ value: 'f16', label: 'F16' }, { value: 'q8_0', label: 'Q8_0' }, { value: 'q4_0', label: 'Q4_0' }];
        case 'ExLlamaV3': case 'ExLlamaV3 HF':
            return [{ value: 'fp16', label: 'FP16' }, { value: 'fp8', label: 'FP8' }, { value: 'q8', label: 'Q8' }, { value: 'q7', label: 'Q7' }, { value: 'q6', label: 'Q6' }, { value: 'q5', label: 'Q5' }, { value: 'q4', label: 'Q4' }, { value: 'q3', label: 'Q3' }, { value: 'q2', label: 'Q2' }, { value: 'q4_q8', label: 'Q4_Q8' }];
        case 'ExLlamaV2':
            return [{ value: 'fp16', label: 'FP16' }, { value: 'fp8', label: 'FP8' }, { value: 'q8', label: 'Q8' }, { value: 'q6', label: 'Q6' }, { value: 'q4', label: 'Q4' }];
        case 'TensorRT-LLM':
            return [{ value: 'auto', label: 'Auto' }, { value: 'fp16', label: 'FP16' }, { value: 'bf16', label: 'BF16' }, { value: 'fp8', label: 'FP8' }, { value: 'int8', label: 'INT8' }, { value: 'nvfp4', label: 'NVFP4' }];
        case 'Transformers':
            return [{ value: 'dynamic', label: 'Dynamic' }, { value: 'static', label: 'Static' }, { value: 'offloaded', label: 'Offloaded' }, { value: 'offloaded_static', label: 'Offloaded Static' }, { value: 'quantized', label: 'Quantized' }, { value: 'sliding_window', label: 'Sliding Window' }, { value: 'sink', label: 'Sink' }];
        case 'DeepSeek': return [{ value: 'auto', label: 'Auto' }];
        case 'Qwen': return [{ value: 'align', label: 'Align' }, { value: 'dynamic', label: 'Dynamic' }];
        default: return [{ value: 'default', label: 'Default' }];
    }
};

export function ModelEditorModal({
    isOpen,
    onClose,
    onSave,
    onDelete,
    existingModel,
    allStopPatterns,
}: ModelEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [backend, setBackend] = useState<LanguageModel['backend']>('Llama.cpp');
    const [contextLength, setContextLength] = useState<number>(8192);
    const [modelPath, setModelPath] = useState('');
    const [mmprojPath, setMmprojPath] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [settings, setSettings] = useState<ModelSettings>({ ...DEFAULT_SETTINGS });
    const [errors, setErrors] = useState<{ name?: string; model?: string; apiKey?: string }>({});
    
    // Cost fields
    const [cacheHitCostPerMillion, setCacheHitCostPerMillion] = useState<number>(0);
    const [cacheMissCostPerMillion, setCacheMissCostPerMillion] = useState<number>(0);
    const [outputGenerationCostPerMillion, setOutputGenerationCostPerMillion] = useState<number>(0);

    // ✅ Stop Pattern State (Stores IDs)
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>([]);

    const { estimatedVRAM, isEstimating, error } = vramUseEstimation({
        modelName: name || modelPath,
        gpuLayers: settings.gpu_layers,
        cacheType: settings.cache_type,
        contextSize: settings.ctx_size || 8192,
        backend: backend,
    });

    // ✅ Check if current backend requires an API key
    const isCloudBackend = CLOUD_BACKENDS.includes(backend);

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
                setApiKey(existingModel.apiKey || '');
                setCacheHitCostPerMillion(existingModel.cacheHitCostPerOneMillionOfTokens || 0);
                setCacheMissCostPerMillion(existingModel.cacheMissCostPerOneMillionOfTokens || 0);
                setOutputGenerationCostPerMillion(existingModel.outputGenerationCostPerOneMillionOfTokens || 0);
                
                // ✅ Load Stop Patterns from parameters
                const storedIds = (existingModel.parameters?.stop_pattern_ids as string[]) || [];
                setSelectedStopPatternIds(storedIds);

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
                setApiKey('');
                setCacheHitCostPerMillion(0);
                setCacheMissCostPerMillion(0);
                setOutputGenerationCostPerMillion(0);
                setSettings({ ...DEFAULT_SETTINGS });
                setSelectedStopPatternIds([]);
            }
            setErrors({});
        }
    }, [isOpen, existingModel]);

    const handleSettingChange = <K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const validate = (): boolean => {
        const newErrors: { name?: string; model?: string; apiKey?: string } = {};
        
        // ✅ Model name is always required
        if (!name.trim()) newErrors.name = 'Model name is required';
        
        // ✅ Dynamic Validation based on Backend
        if (isCloudBackend) {
            // Cloud: API Key REQUIRED, Model Path OPTIONAL
            if (!apiKey.trim()) newErrors.apiKey = 'API key is required';
        } else {
            // Local: Model Path REQUIRED, API Key OPTIONAL
            if (!modelPath.trim()) newErrors.model = 'Model path is required';
        }
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = () => {
        if (!validate()) {
            alert("Please fill in all required fields before saving.");
            return;
        }

        const params: Record<string, unknown> = {};
        
        // Only include non-default values
        if (settings.gpu_layers !== DEFAULT_SETTINGS.gpu_layers) params.gpu_layers = settings.gpu_layers;
        if (settings.ctx_size !== DEFAULT_SETTINGS.ctx_size) params.ctx_size = settings.ctx_size;
        if (settings.cache_type !== DEFAULT_SETTINGS.cache_type) params.cache_type = settings.cache_type;
        if (settings.split_mode !== DEFAULT_SETTINGS.split_mode) params.split_mode = settings.split_mode;
        if (settings.ik !== DEFAULT_SETTINGS.ik) params.ik = settings.ik;
        if (settings.spec_type !== DEFAULT_SETTINGS.spec_type) params.spec_type = settings.spec_type;
        if (settings.draft_max !== DEFAULT_SETTINGS.draft_max) params.draft_max = settings.draft_max;
        if (settings.draft_model && settings.draft_model.trim()) params.draft_model = settings.draft_model;
        if (settings.gpu_layers_draft !== DEFAULT_SETTINGS.gpu_layers_draft) params.gpu_layers_draft = settings.gpu_layers_draft;
        if (settings.device_draft && settings.device_draft.trim()) params.device_draft = settings.device_draft;
        if (settings.parallel !== DEFAULT_SETTINGS.parallel) params.parallel = settings.parallel;
        if (settings.threads !== DEFAULT_SETTINGS.threads) params.threads = settings.threads;
        if (settings.threads_batch !== DEFAULT_SETTINGS.threads_batch) params.threads_batch = settings.threads_batch;
        if (settings.batch_size !== DEFAULT_SETTINGS.batch_size) params.batch_size = settings.batch_size;
        if (settings.ubatch_size !== DEFAULT_SETTINGS.ubatch_size) params.ubatch_size = settings.ubatch_size;
        if (settings.fit_target !== DEFAULT_SETTINGS.fit_target) params.fit_target = settings.fit_target;
        if (settings.tensor_split && settings.tensor_split.trim()) params.tensor_split = settings.tensor_split;
        if (settings.extra_flags && settings.extra_flags.trim()) params.extra_flags = settings.extra_flags;
        if (settings.cpu_moe !== DEFAULT_SETTINGS.cpu_moe) params.cpu_moe = settings.cpu_moe;
        if (settings.no_kv_offload !== DEFAULT_SETTINGS.no_kv_offload) params.no_kv_offload = settings.no_kv_offload;
        if (settings.no_mmap !== DEFAULT_SETTINGS.no_mmap) params.no_mmap = settings.no_mmap;
        if (settings.mlock !== DEFAULT_SETTINGS.mlock) params.mlock = settings.mlock;
        if (settings.numa !== DEFAULT_SETTINGS.numa) params.numa = settings.numa;

        // ✅ Save Stop Pattern IDs
        if (selectedStopPatternIds.length > 0) {
            params.stop_pattern_ids = selectedStopPatternIds;
        }

        // ✅ Save API Key
        if (apiKey.trim()) {
            params.api_key = apiKey.trim();
        }

        const now = Date.now();
        const model: LanguageModel = {
            id: existingModel?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim() || undefined,
            backend,
            contextLength: contextLength || 8192,
            model: modelPath.trim() || undefined,
            mmproj: mmprojPath.trim() || undefined,
            apiKey: apiKey.trim() || undefined,
            parameters: Object.keys(params).length > 0 ? params : undefined,
            cacheHitCostPerOneMillionOfTokens: cacheHitCostPerMillion,
            cacheMissCostPerOneMillionOfTokens: cacheMissCostPerMillion,
            outputGenerationCostPerOneMillionOfTokens: outputGenerationCostPerMillion,
            firstCreatedTimestamp: existingModel?.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: now,
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

    const cacheTypes = getCacheTypes(backend);
    const displayVRAM = isEstimating ? '...' : (error ? 'Unknown' : estimatedVRAM);

    // Helper to get stop pattern object by ID
    const getStopPatternById = (id: string) => allStopPatterns.find(sp => sp.id === id);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingModel ? 'Edit Model' : 'Create New Model'}</h2>
                    <div className="editor-modal-actions">
                        {backend === 'Llama.cpp' && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--accent)', padding: '4px 8px', borderRadius: '4px', background: 'var(--accent-bg)', border: '1px solid var(--accent-border)', fontWeight: 'bold' }}>
                                💾 {displayVRAM} GB
                            </div>
                        )}
                        {existingModel && onDelete && (
                            <button type="button" className="editor-btn" onClick={handleDelete} style={{ background: 'transparent', color: '#ff4444', border: '1px solid #ff4444' }}>🗑️ Delete</button>
                        )}
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Cancel</button>
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit}>{existingModel ? 'Update' : 'Create'}</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Name - Always required */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Model Name <span style={{ color: '#ff4444' }}>*</span></label>
                        <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} className={`editor-input ${errors.name ? 'error' : ''}`} placeholder="e.g., Llama-3-70B-Instruct" />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Description</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea" placeholder="Describe the model's strengths, use cases, etc." rows={2} />
                    </div>

                    {/* Backend */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Backend</label>
                        <select value={backend} onChange={(e) => setBackend(e.target.value as LanguageModel['backend'])} className="editor-select">
                            {BACKEND_OPTIONS.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                        </select>
                    </div>

                    {/* Model Path - Dynamic Asterisk */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">
                            Model Path {!isCloudBackend && <span style={{ color: '#ff4444' }}>*</span>}
                        </label>
                        <input type="text" value={modelPath} onChange={(e) => { setModelPath(e.target.value); if (errors.model) setErrors({ ...errors, model: undefined }); }} className={`editor-input ${errors.model ? 'error' : ''}`} style={{ fontFamily: 'monospace' }} placeholder="/path/to/model.gguf" />
                        {errors.model && <div className="editor-error-message">{errors.model}</div>}
                    </div>

                    {/* MMProj Path */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">MMProj Path</label>
                        <input type="text" value={mmprojPath} onChange={(e) => setMmprojPath(e.target.value)} className="editor-input" style={{ fontFamily: 'monospace' }} placeholder="/path/to/mmproj.gguf" />
                        {mmprojPath && <div style={{ fontSize: '0.7rem', color: 'var(--accent)', marginTop: '4px' }}>✓ Multi-modal support enabled</div>}
                    </div>

                    {/* API Key Field - Dynamic Asterisk */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">
                            API Key {isCloudBackend && <span style={{ color: '#ff4444' }}>*</span>}
                        </label>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input 
                                type={showApiKey ? 'text' : 'password'}
                                value={apiKey} 
                                onChange={(e) => { setApiKey(e.target.value); if (errors.apiKey) setErrors({ ...errors, apiKey: undefined }); }} 
                                className={`editor-input ${errors.apiKey ? 'error' : ''}`}
                                style={{ fontFamily: 'monospace', flex: 1 }}
                                placeholder="Enter your API key"
                            />
                            <button
                                type="button"
                                onClick={() => setShowApiKey(!showApiKey)}
                                style={{ 
                                    padding: '4px 8px', 
                                    fontSize: '1rem',
                                    background: 'transparent',
                                    border: '1px solid var(--border)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    color: 'var(--text-h)',
                                    opacity: 0.7,
                                    transition: 'opacity 0.2s',
                                    width: '36px',
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                                title={showApiKey ? 'Hide API key' : 'Show API key'}
                                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                            >
                                {showApiKey ? '🙈' : '👁️'}
                            </button>
                        </div>
                        {errors.apiKey && <div className="editor-error-message">{errors.apiKey}</div>}
                    </div>

                    {/* Main Options */}
                    <div className="editor-section">
                        <span className="editor-section-title">Main Options</span>
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">GPU Layers</label>
                                <input type="number" value={settings.gpu_layers} onChange={(e) => handleSettingChange('gpu_layers', Number(e.target.value) || -1)} className="editor-input" min="-1" step="1" placeholder="-1 (auto)" />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Context Size</label>
                                <input type="number" value={settings.ctx_size} onChange={(e) => handleSettingChange('ctx_size', Number(e.target.value) || 0)} className="editor-input" min="0" step="1" placeholder="0 (auto)" />
                            </div>
                        </div>
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Cache Type</label>
                                <select value={settings.cache_type} onChange={(e) => handleSettingChange('cache_type', e.target.value)} className="editor-select">
                                    {cacheTypes.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Split Mode</label>
                                <select value={settings.split_mode} onChange={(e) => handleSettingChange('split_mode', e.target.value)} className="editor-select">
                                    {SPLIT_MODE_OPTIONS.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                                </select>
                            </div>
                        </div>
                        <div style={{ marginTop: '8px' }}>
                            <label className="editor-checkbox-label">
                                <input type="checkbox" checked={settings.ik} onChange={(e) => handleSettingChange('ik', e.target.checked)} className="editor-checkbox-input" />
                                <span>Use IK Llama.cpp</span>
                            </label>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-h)', opacity: 0.6, padding: '8px 12px', borderRadius: '6px', background: 'var(--social-bg)', border: '1px solid var(--border)', marginTop: '8px', fontStyle: 'italic' }}>
                            ℹ️ LoreReactor uses Streaming LLM by default for optimal performance.
                        </div>
                    </div>

                    {/* Speculative Decoding */}
                    <div className="editor-section">
                        <span className="editor-section-title">Speculative Decoding</span>
                        <div className="editor-row-full">
                            <div>
                                <label className="editor-label editor-label-small">Draft Model</label>
                                <input type="text" value={settings.draft_model} onChange={(e) => handleSettingChange('draft_model', e.target.value)} className="editor-input" style={{ fontFamily: 'monospace' }} placeholder="/path/to/draft/model.gguf" />
                            </div>
                        </div>
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Speculation Type</label>
                                <select value={settings.spec_type} onChange={(e) => handleSettingChange('spec_type', e.target.value)} className="editor-select">
                                    {SPEC_TYPE_OPTIONS.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                                </select>
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Draft Maximum</label>
                                <input type="number" value={settings.draft_max} onChange={(e) => handleSettingChange('draft_max', Number(e.target.value) || 3)} className="editor-input" min="1" step="1" placeholder="3" />
                            </div>
                        </div>
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">GPU Layers (Draft)</label>
                                <input type="number" value={settings.gpu_layers_draft} onChange={(e) => handleSettingChange('gpu_layers_draft', Number(e.target.value) || 256)} className="editor-input" min="0" step="1" placeholder="256" />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Device (Draft)</label>
                                <input type="text" value={settings.device_draft} onChange={(e) => handleSettingChange('device_draft', e.target.value)} className="editor-input" placeholder="CUDA0,CUDA1" />
                            </div>
                        </div>
                    </div>

                    {/* Other Options */}
                    <div className="editor-section">
                        <span className="editor-section-title">Other Options</span>
                        <div className="editor-row">
                            <div><label className="editor-label editor-label-small">Parallel Slots</label><input type="number" value={settings.parallel} onChange={(e) => handleSettingChange('parallel', Number(e.target.value) || 1)} className="editor-input" min="1" step="1" placeholder="1" /></div>
                            <div><label className="editor-label editor-label-small">Thread Count</label><input type="number" value={settings.threads} onChange={(e) => handleSettingChange('threads', Number(e.target.value) || 0)} className="editor-input" min="0" step="1" placeholder="0 (auto)" /></div>
                        </div>
                        <div className="editor-row">
                            <div><label className="editor-label editor-label-small">Thread Count (Batch)</label><input type="number" value={settings.threads_batch} onChange={(e) => handleSettingChange('threads_batch', Number(e.target.value) || 0)} className="editor-input" min="0" step="1" placeholder="0 (auto)" /></div>
                            <div><label className="editor-label editor-label-small">Batch Size</label><input type="number" value={settings.batch_size} onChange={(e) => handleSettingChange('batch_size', Number(e.target.value) || 1024)} className="editor-input" min="1" step="1" placeholder="1024" /></div>
                        </div>
                        <div className="editor-row">
                            <div><label className="editor-label editor-label-small">Micro Batch Size</label><input type="number" value={settings.ubatch_size} onChange={(e) => handleSettingChange('ubatch_size', Number(e.target.value) || 1024)} className="editor-input" min="1" step="1" placeholder="1024" /></div>
                            <div><label className="editor-label editor-label-small">Fit Target (MiB)</label><input type="text" value={settings.fit_target} onChange={(e) => handleSettingChange('fit_target', e.target.value)} className="editor-input" placeholder="512" /></div>
                        </div>
                        <div className="editor-row-full"><div><label className="editor-label editor-label-small">Tensor Split</label><input type="text" value={settings.tensor_split} onChange={(e) => handleSettingChange('tensor_split', e.target.value)} className="editor-input" style={{ fontFamily: 'monospace' }} placeholder="60,40" /></div></div>
                        <div className="editor-row-full"><div><label className="editor-label editor-label-small">Extra Flags</label><input type="text" value={settings.extra_flags} onChange={(e) => handleSettingChange('extra_flags', e.target.value)} className="editor-input" style={{ fontFamily: 'monospace' }} placeholder="--jinja --rpc 192.168.1.100:50052" /></div></div>
                        
                        <div style={{ marginTop: '8px' }}>
                            <label className="editor-checkbox-label"><input type="checkbox" checked={settings.cpu_moe} onChange={(e) => handleSettingChange('cpu_moe', e.target.checked)} className="editor-checkbox-input" /><span>Mixture-Of-Experts On CPU</span></label>
                            <label className="editor-checkbox-label"><input type="checkbox" checked={settings.no_kv_offload} onChange={(e) => handleSettingChange('no_kv_offload', e.target.checked)} className="editor-checkbox-input" /><span>No Key-Value Offload</span></label>
                        </div>
                        <div style={{ marginTop: '8px' }}>
                            <label className="editor-checkbox-label"><input type="checkbox" checked={settings.no_mmap} onChange={(e) => handleSettingChange('no_mmap', e.target.checked)} className="editor-checkbox-input" /><span>No Memory Map</span></label>
                            <label className="editor-checkbox-label"><input type="checkbox" checked={settings.mlock} onChange={(e) => handleSettingChange('mlock', e.target.checked)} className="editor-checkbox-input" /><span>Memory Lock</span></label>
                        </div>
                        <div style={{ marginTop: '8px' }}>
                            <label className="editor-checkbox-label"><input type="checkbox" checked={settings.numa} onChange={(e) => handleSettingChange('numa', e.target.checked)} className="editor-checkbox-input" /><span>Non-Uniform Memory Access</span></label>
                        </div>
                    </div>

                    {/* ✅ STOP PATTERNS SECTION */}
                    <div className="editor-section">
                        <span className="editor-section-title">Model Stop Patterns</span>
                        <div style={{ marginBottom: '12px', fontSize: '0.7rem', color: 'var(--text-h)', opacity: 0.7 }}>
                            These stop patterns will be automatically applied when using this model.
                        </div>
                        
                        {/* List of Assigned Patterns */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                            {selectedStopPatternIds.length === 0 && (
                                <div style={{ fontSize: '0.75rem', opacity: 0.5, fontStyle: 'italic' }}>No stop patterns assigned.</div>
                            )}
                            {selectedStopPatternIds.map(id => {
                                const sp = getStopPatternById(id);
                                if (!sp) return null;
                                return (
                                    <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--social-bg)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-h)' }}>{sp.name}</span>
                                            <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', opacity: 0.6, color: 'var(--text-h)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sp.pattern}</span>
                                        </div>
                                        <button 
                                            type="button" 
                                            onClick={() => setSelectedStopPatternIds(prev => prev.filter(sid => sid !== id))}
                                            style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: '0 4px' }}
                                            title="Remove"
                                        >
                                            ×
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Add New Pattern Dropdown */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <select 
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val && !selectedStopPatternIds.includes(val)) {
                                        setSelectedStopPatternIds(prev => [...prev, val]);
                                    }
                                    e.target.value = ""; // Reset dropdown
                                }}
                                className="editor-select"
                                defaultValue=""
                            >
                                <option value="" disabled>+ Add a stop pattern</option>
                                {allStopPatterns.filter(sp => !selectedStopPatternIds.includes(sp.id)).map(sp => (
                                    <option key={sp.id} value={sp.id}>{sp.name} ({sp.pattern})</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Cost */}
                    <div className="editor-section">
                        <span className="editor-section-title">Cost</span>
                        <div className="editor-row">
                            <div><label className="editor-label editor-label-small">Cache Hit Cost (Per 1M tokens)</label><input type="number" step="0.01" min="0" value={cacheHitCostPerMillion} onChange={(e) => setCacheHitCostPerMillion(Number(e.target.value) || 0)} className="editor-input" placeholder="0.00" /></div>
                            <div><label className="editor-label editor-label-small">Cache Miss Cost (Per 1M tokens)</label><input type="number" step="0.01" min="0" value={cacheMissCostPerMillion} onChange={(e) => setCacheMissCostPerMillion(Number(e.target.value) || 0)} className="editor-input" placeholder="0.00" /></div>
                        </div>
                        <div className="editor-row-full">
                            <div><label className="editor-label editor-label-small">Output Generation Cost (Per 1M tokens)</label><input type="number" step="0.01" min="0" value={outputGenerationCostPerMillion} onChange={(e) => setOutputGenerationCostPerMillion(Number(e.target.value) || 0)} className="editor-input" placeholder="0.00" /></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}