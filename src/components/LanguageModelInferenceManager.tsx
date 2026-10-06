// src/components/LanguageModelInferenceManagerModal.tsx
import { useState, useEffect, useCallback } from 'react';
import { localURL } from '../configurations';
import '../main.css';

interface BackendStatus {
    name: string;
    installed: boolean;
    binaryPath: string;
    description: string;
}

interface InstallNotification {
    backend: string;
    status: 'idle' | 'downloading' | 'extracting' | 'installing' | 'ready' | 'error';
    percent: number;
    message: string;
    timestamp: number;
}

const BACKEND_DESCRIPTIONS: Record<string, string> = {
    'Llama.cpp': 'GGUF model runner supporting CPU, NVIDIA CUDA, Vulkan, and Apple Metal.',
    'mistral.rs': 'High-performance Rust-based engine with fast quantized inference.',
    'Ollama': 'Standalone runner with automatic hardware acceleration.',
    'ExLlamaV3': 'Modern EXL3 format runner optimized for high throughput on NVIDIA GPUs.',
    'ExLlamaV3 HF': 'ExLlamaV3 with HuggingFace model weight support.',
    'ExLlamaV2': 'High-speed EXL2 quant format inference via TabbyAPI.',
    'vLLM': 'High-throughput PagedAttention server for production inference.',
    'SGLang': 'RadixAttention structured generation engine for NVIDIA GPUs.',
    'LM Studio': 'Local inference engine managed via the lms CLI.',
    'LocalAI': 'OpenAI-compatible drop-in alternative for multi-backend execution.',
    'TensorRT-LLM': 'NVIDIA TensorRT acceleration running via Triton container.',
    'Transformers': 'HuggingFace Text Generation Inference launcher.',
};

interface LanguageModelInferenceManagerModalProps {
    onClose: () => void;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function LanguageModelInferenceManagerModal({
    onClose,
    addToast,
}: LanguageModelInferenceManagerModalProps) {
    const [backends, setBackends] = useState<BackendStatus[]>([]);
    const [isLoadingList, setIsLoadingList] = useState(true);
    const [activeInstalls, setActiveInstalls] = useState<Record<string, InstallNotification>>({});

    // Fetch current installation status of all backends
    const fetchBackendStatuses = useCallback(async () => {
        try {
            const res = await fetch(`${localURL}/language_models/local_backends`);
            if (res.ok) {
                const data = await res.json();
                const list: BackendStatus[] = (data.backends || []).map((b: any) => ({
                    ...b,
                    description: BACKEND_DESCRIPTIONS[b.name] || 'Local inference engine.',
                }));
                setBackends(list);
            }
        } catch {
            // Fail silently or keep list
        } finally {
            setIsLoadingList(false);
        }
    }, []);

    useEffect(() => {
        fetchBackendStatuses();
    }, [fetchBackendStatuses]);

    // Listen to real-time download and install progress via SSE
    useEffect(() => {
        let es: EventSource | null = null;
        try {
            es = new EventSource(`${localURL}/language_models/notify`);
            es.onmessage = (event) => {
                try {
                    const data: InstallNotification = JSON.parse(event.data);
                    setActiveInstalls((prev) => ({
                        ...prev,
                        [data.backend]: data,
                    }));

                    if (data.status === 'ready') {
                        addToast(`✅ ${data.backend} is ready!`, 'success');
                        fetchBackendStatuses();
                    } else if (data.status === 'error') {
                        addToast(`❌ ${data.backend}: ${data.message}`, 'error');
                        fetchBackendStatuses();
                    }
                } catch {
                    // Ignore parsing glitches
                }
            };
        } catch {
            // Ignore connection issues
        }

        return () => {
            es?.close();
        };
    }, [addToast, fetchBackendStatuses]);

    // Trigger on-demand installation for a specific engine
    const handleTriggerInstall = async (backendName: string) => {
        try {
            setActiveInstalls((prev) => ({
                ...prev,
                [backendName]: {
                    backend: backendName,
                    status: 'downloading',
                    percent: 0,
                    message: 'Requesting install...',
                    timestamp: Date.now(),
                },
            }));

            const res = await fetch(`${localURL}/language_models/local_backends/install`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backend: backendName }),
            });

            if (!res.ok) {
                const err = await res.json();
                addToast(err.error || `Failed to trigger install for ${backendName}`, 'error');
                fetchBackendStatuses();
            }
        } catch (e: any) {
            addToast(`Error: ${e.message}`, 'error');
            fetchBackendStatuses();
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content modal-content-manager"
                style={{ maxWidth: '680px', maxHeight: '85vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2>Language Model Inference Manager</h2>
                    <div className="modal-header-actions">
                        <button type="button" className="close-button close-button-spaced" onClick={onClose}>
                            ×
                        </button>
                    </div>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div
                        style={{
                            fontSize: '0.72rem',
                            color: 'var(--text-h)',
                            opacity: 0.65,
                            lineHeight: 1.5,
                            marginBottom: '4px',
                        }}
                    >
                        Monitor, download, and manage your local inference engines on demand. Backends marked as installed will start automatically when loading models configured for them.
                    </div>

                    {isLoadingList ? (
                        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-h)', opacity: 0.6 }}>
                            Loading engine statuses...
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {backends.map((backend) => {
                                const install = activeInstalls[backend.name];
                                const isBusy =
                                    install &&
                                    install.status !== 'ready' &&
                                    install.status !== 'error' &&
                                    install.status !== 'idle';

                                return (
                                    <div
                                        key={backend.name}
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            padding: '12px 14px',
                                            borderRadius: '8px',
                                            border: `1px solid ${
                                                isBusy
                                                    ? 'var(--accent-border)'
                                                    : backend.installed
                                                    ? 'var(--border)'
                                                    : 'rgba(255, 255, 255, 0.05)'
                                            }`,
                                            background: 'var(--social-bg)',
                                            gap: '8px',
                                            transition: 'border-color 0.2s ease',
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                gap: '12px',
                                            }}
                                        >
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--text-h)' }}>
                                                        {backend.name}
                                                    </span>
                                                    <span
                                                        style={{
                                                            fontSize: '0.65rem',
                                                            fontWeight: 'bold',
                                                            padding: '2px 8px',
                                                            borderRadius: '12px',
                                                            lineHeight: 1.2,
                                                            background: backend.installed
                                                                ? 'rgba(34, 197, 94, 0.15)'
                                                                : isBusy
                                                                ? 'var(--accent-bg)'
                                                                : 'rgba(255, 255, 255, 0.05)',
                                                            color: backend.installed
                                                                ? '#22c55e'
                                                                : isBusy
                                                                ? 'var(--accent)'
                                                                : 'var(--text)',
                                                            border: `1px solid ${
                                                                backend.installed
                                                                    ? 'rgba(34, 197, 94, 0.3)'
                                                                    : isBusy
                                                                    ? 'var(--accent-border)'
                                                                    : 'var(--border)'
                                                            }`,
                                                        }}
                                                    >
                                                        {backend.installed ? '● Installed' : isBusy ? '⬇ Installing' : '○ Not Installed'}
                                                    </span>
                                                </div>
                                                <span style={{ fontSize: '0.7rem', color: 'var(--text-h)', opacity: 0.6, lineHeight: 1.3 }}>
                                                    {backend.description}
                                                </span>
                                            </div>

                                            <div style={{ flexShrink: 0 }}>
                                                {backend.installed ? (
                                                    <button
                                                        type="button"
                                                        className="editor-button editor-button-cancel"
                                                        onClick={() => handleTriggerInstall(backend.name)}
                                                        disabled={Boolean(isBusy)}
                                                        style={{
                                                            padding: '4px 10px',
                                                            fontSize: '0.7rem',
                                                            minHeight: '30px',
                                                            opacity: 0.7,
                                                        }}
                                                        title="Reinstall or update binary"
                                                    >
                                                        Reinstall
                                                    </button>
                                                ) : isBusy ? (
                                                    <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--accent)' }}>
                                                        {install.percent}%
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="editor-button editor-button-save"
                                                        onClick={() => handleTriggerInstall(backend.name)}
                                                        style={{
                                                            padding: '4px 14px',
                                                            fontSize: '0.75rem',
                                                            minHeight: '30px',
                                                        }}
                                                    >
                                                        Install
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Download / Extraction Progress Track */}
                                        {isBusy && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                                                <div
                                                    style={{
                                                        height: '5px',
                                                        width: '100%',
                                                        background: 'rgba(255, 255, 255, 0.1)',
                                                        borderRadius: '3px',
                                                        overflow: 'hidden',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            height: '100%',
                                                            width: `${install.percent}%`,
                                                            background: 'var(--accent)',
                                                            transition: 'width 0.2s ease',
                                                        }}
                                                    />
                                                </div>
                                                <div
                                                    style={{
                                                        fontSize: '0.65rem',
                                                        color: 'var(--text-h)',
                                                        opacity: 0.8,
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                    }}
                                                >
                                                    {install.message}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}