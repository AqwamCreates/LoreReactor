// src/frontend_src/components/SpatiotemporalModelEditorModal.tsx
import { useState } from 'react';
import type { SpatiotemporalModel, DiffusionSampler, DiffusionScheduler, backend } from '../types';
import { v4 as uuidv4 } from 'uuid';
import '../main.css';

interface SpatiotemporalModelEditorModalProps {
    onClose: () => void;
    onSave: (model: SpatiotemporalModel) => void;
    existingModel: SpatiotemporalModel | null;
    allStopPatterns: any[]; // Simplified for now
}

const DIFFUSION_SAMPLERS: DiffusionSampler[] = ['euler', 'euler_a', 'heun', 'dpm2', 'dpm++_2m', 'dpm++_2m_v2', 'dpm++_2s_a', 'lcm', 'flow_match'];
const DIFFUSION_SCHEDULERS: DiffusionScheduler[] = ['normal', 'karras', 'exponential', 'sgm_uniform', 'ays'];
const BACKENDS: backend[] = ['stable-diffusion.cpp', 'Other'];

export function SpatiotemporalModelEditorModal({ onClose, onSave, existingModel }: SpatiotemporalModelEditorModalProps) {
    const [name, setName] = useState(existingModel?.name || '');
    const [backendType, setBackendType] = useState<backend>(existingModel?.backend || 'stable-diffusion.cpp');
    
    // File Paths
    const [modelPath, setModelPath] = useState(existingModel?.model || '');
    const [vaePath, setVaePath] = useState(existingModel?.vae || '');
    const [clipLPath, setClipLPath] = useState(existingModel?.clipL || '');
    const [t5xxlPath, setT5xxlPath] = useState(existingModel?.t5xxl || '');
    const [llmPath, setLlmPath] = useState(existingModel?.llm || '');

    // Defaults
    const [samplingMethod, setSamplingMethod] = useState<DiffusionSampler>(existingModel?.defaults?.samplingMethod || 'euler_a');
    const [noiseSchedule, setNoiseSchedule] = useState<DiffusionScheduler>(existingModel?.defaults?.noiseSchedule || 'normal');
    const [steps, setSteps] = useState(existingModel?.defaults?.steps || 20);
    const [cfgScale, setCfgScale] = useState(existingModel?.defaults?.cfgScale || 7.0);
    const [width, setWidth] = useState(existingModel?.defaults?.width || 512);
    const [height, setHeight] = useState(existingModel?.defaults?.height || 512);
    const [rng, setRng] = useState<'cuda' | 'cpu'>(existingModel?.defaults?.rng || 'cuda');

    const handleSave = () => {
        if (!name) return;
        const now = Date.now();
        const savedModel: SpatiotemporalModel = {
            id: existingModel?.id || uuidv4(),
            name,
            backend: backendType,
            model: modelPath || undefined,
            vae: vaePath || undefined,
            clipL: clipLPath || undefined,
            t5xxl: t5xxlPath || undefined,
            llm: llmPath || undefined,
            defaults: {
                samplingMethod, noiseSchedule, steps, cfgScale, width, height, rng
            },
            firstCreatedTimestamp: existingModel?.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: now,
        };
        onSave(savedModel);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <h2>{existingModel ? 'Edit Spatiotemporal Model' : 'Create Spatiotemporal Model'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        <button type="button" className="editor-button editor-button-save" onClick={handleSave}>Save</button>
                    </div>
                </div>
                <div className="modal-body editor-modal-body">
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Name *</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} className="editor-input" placeholder="e.g., FLUX.1 Dev" />
                    </div>

                    <div className="editor-section">
                        <span className="editor-section-title">Core Model Files (Paths)</span>
                        <div style={{ display: 'grid', gap: '12px' }}>
                            <div><label className="editor-label editor-label-small">Diffusion Model (-m)</label><input type="text" value={modelPath} onChange={e => setModelPath(e.target.value)} className="editor-input" placeholder="path/to/model.gguf" /></div>
                            <div><label className="editor-label editor-label-small">VAE (--vae)</label><input type="text" value={vaePath} onChange={e => setVaePath(e.target.value)} className="editor-input" placeholder="path/to/vae.safetensors" /></div>
                            <div><label className="editor-label editor-label-small">CLIP L (--clip_l)</label><input type="text" value={clipLPath} onChange={e => setClipLPath(e.target.value)} className="editor-input" placeholder="path/to/clip_l.safetensors" /></div>
                            <div><label className="editor-label editor-label-small">T5-XXL (--t5xxl)</label><input type="text" value={t5xxlPath} onChange={e => setT5xxlPath(e.target.value)} className="editor-input" placeholder="path/to/t5xxl.gguf" /></div>
                            <div><label className="editor-label editor-label-small">Vision LLM (--llm)</label><input type="text" value={llmPath} onChange={e => setLlmPath(e.target.value)} className="editor-input" placeholder="For Qwen-Image / Z-Image" /></div>
                        </div>
                    </div>

                    <div className="editor-section">
                        <span className="editor-section-title">Generation Defaults</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div>
                                <label className="editor-label editor-label-small">Sampling Method (ODE Solver)</label>
                                <select value={samplingMethod} onChange={e => setSamplingMethod(e.target.value as DiffusionSampler)} className="editor-select">
                                    {DIFFUSION_SAMPLERS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Noise Schedule</label>
                                <select value={noiseSchedule} onChange={e => setNoiseSchedule(e.target.value as DiffusionScheduler)} className="editor-select">
                                    {DIFFUSION_SCHEDULERS.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Steps</label>
                                <input type="number" value={steps} onChange={e => setSteps(Number(e.target.value))} className="editor-input" />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">CFG Scale</label>
                                <input type="number" step="0.1" value={cfgScale} onChange={e => setCfgScale(Number(e.target.value))} className="editor-input" />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Width</label>
                                <input type="number" step="64" value={width} onChange={e => setWidth(Number(e.target.value))} className="editor-input" />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Height</label>
                                <input type="number" step="64" value={height} onChange={e => setHeight(Number(e.target.value))} className="editor-input" />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">RNG (Noise Generator)</label>
                                <select value={rng} onChange={e => setRng(e.target.value as 'cuda' | 'cpu')} className="editor-select">
                                    <option value="cuda">CUDA (Auto1111 compatible)</option>
                                    <option value="cpu">CPU (ComfyUI compatible)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}