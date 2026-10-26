// src/frontend_src/components/ModelInferenceManagerModal.tsx
import { useState, useEffect, useCallback } from 'react';
import { localURL } from '../../configurations';
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

type TabType = 'language' | 'spatiotemporal';

const BACKEND_DESCRIPTIONS: Record<string, string> = {
    // Language Models
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
    
    // Spatiotemporal Models
    'stable-diffusion.cpp': 'Pure C/C++ inference engine for Stable Diffusion, FLUX, Wan, and other image/video models.',
};

const ENDPOINTS = {
    language: {
        list: '/language_models',
        install: '/language_models/install',
        cancel: '/language_models/cancel',
        delete: '/language_models/delete',
    },
    spatiotemporal: {
        list: '/spatiotemporal_models',
        install: '/spatiotemporal_models/install',
        cancel: '/spatiotemporal_models/cancel',
        delete: '/spatiotemporal_models/delete',
    }
};

interface ModelInferenceManagerModalProps {
    onClose: () => void;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function ModelInferenceManagerModal({
    onClose,
    addToast,
}: ModelInferenceManagerModalProps) {
    const [activeTab, setActiveTab] = useState<TabType>('language');
    
    const [languageBackends, setLanguageBackends] = useState<BackendStatus[]>([]);
    const [spatiotemporalBackends, setSpatiotemporalBackends] = useState<BackendStatus[]>([]);
    
    const [isLoadingLanguage, setIsLoadingLanguage] = useState(true);
    const [isLoadingSpatiotemporal, setIsLoadingSpatiotemporal] = useState(true);
    
    const [activeInstalls, setActiveInstalls] = useState<Record<string, InstallNotification>>({});
    const [deletingBackend, setDeletingBackend] = useState<string | null>(null);
    const [cancellingBackend, setCancellingBackend] = useState<string | null>(null);

    const refreshBackendStatuses = useCallback(async (tab: TabType) => {
        try {
            const res = await fetch(`${localURL}${ENDPOINTS[tab].list}`);
            if (res.ok) {
                const data = await res.json();
                const list: BackendStatus[] = (data.backends || []).map((b: any) => ({
                    ...b,
                    description: BACKEND_DESCRIPTIONS[b.name] || 'Local inference engine.',
                }));
                if (tab === 'language') {
                    setLanguageBackends(list);
                } else {
                    setSpatiotemporalBackends(list);
                }
            }
        } catch {
            // Keep current list on network error
        }
    }, []);

    // Initial fetch using AbortController to prevent state updates on unmounted components
    // and to avoid calling setState synchronously within the effect body.
    useEffect(() => {
        const controller = new AbortController();
        let isActive = true;

        const fetchInitialStatuses = async () => {
            try {
                const [langRes, stRes] = await Promise.all([
                    fetch(`${localURL}${ENDPOINTS.language.list}`, { signal: controller.signal }),
                    fetch(`${localURL}${ENDPOINTS.spatiotemporal.list}`, { signal: controller.signal })
                ]);

                if (isActive && langRes.ok) {
                    const data = await langRes.json();
                    const list: BackendStatus[] = (data.backends || []).map((b: any) => ({
                        ...b,
                        description: BACKEND_DESCRIPTIONS[b.name] || 'Local inference engine.',
                    }));
                    setLanguageBackends(list);
                }

                if (isActive && stRes.ok) {
                    const data = await stRes.json();
                    const list: BackendStatus[] = (data.backends || []).map((b: any) => ({
                        ...b,
                        description: BACKEND_DESCRIPTIONS[b.name] || 'Local inference engine.',
                    }));
                    setSpatiotemporalBackends(list);
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') {
                    console.error('Failed to fetch initial backend statuses:', e);
                }
            } finally {
                if (isActive) {
                    setIsLoadingLanguage(false);
                    setIsLoadingSpatiotemporal(false);
                }
            }
        };

        fetchInitialStatuses();

        return () => {
            isActive = false;
            controller.abort();
        };
    }, []);

    // Listen to real-time download and install progress via SSE
    // Note: The backend routes all SSE notifications through /language_models/notify regardless of category
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
                        refreshBackendStatuses('language');
                        refreshBackendStatuses('spatiotemporal');
                    } else if (data.status === 'error') {
                        addToast(`❌ ${data.backend}: ${data.message}`, 'error');
                        refreshBackendStatuses('language');
                        refreshBackendStatuses('spatiotemporal');
                    }
                } catch {
                    // Ignore parse error
                }
            };
        } catch {
            // Ignore connection error
        }

        return () => {
            es?.close();
        };
    }, [addToast, refreshBackendStatuses]);

    const getTabForBackend = (backendName: string): TabType => {
        return languageBackends.some(b => b.name === backendName) ? 'language' : 'spatiotemporal';
    };

    const handleTriggerInstall = async (backendName: string) => {
        const tab = getTabForBackend(backendName);
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

            const res = await fetch(`${localURL}${ENDPOINTS[tab].install}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backend: backendName }),
            });

            if (!res.ok) {
                const err = await res.json();
                addToast(err.error || `Failed to trigger install for ${backendName}`, 'error');
                refreshBackendStatuses(tab);
            }
        } catch (e: any) {
            addToast(`Error: ${e.message}`, 'error');
            refreshBackendStatuses(tab);
        }
    };

    const handleCancelInstall = async (backendName: string) => {
        const tab = getTabForBackend(backendName);
        try {
            setCancellingBackend(backendName);
            const res = await fetch(`${localURL}${ENDPOINTS[tab].cancel}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backend: backendName }),
            });

            if (res.ok) {
                addToast(`Installation of ${backendName} cancelled.`, 'info');
                setActiveInstalls((prev) => {
                    const next = { ...prev };
                    delete next[backendName];
                    return next;
                });
                await refreshBackendStatuses(tab);
            } else {
                const err = await res.json();
                addToast(err.error || `Failed to cancel installation for ${backendName}`, 'error');
            }
        } catch (e: any) {
            addToast(`Error cancelling ${backendName}: ${e.message}`, 'error');
        } finally {
            setCancellingBackend(null);
        }
    };

    const handleDeleteBackend = async (backendName: string) => {
        if (!confirm(`Are you sure you want to delete and uninstall ${backendName}? This will remove its files and free disk space.`)) {
            return;
        }
        const tab = getTabForBackend(backendName);

        try {
            setDeletingBackend(backendName);
            const res = await fetch(`${localURL}${ENDPOINTS[tab].delete}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backend: backendName }),
            });

            if (res.ok) {
                addToast(`Uninstalled ${backendName}.`, 'info');
                setActiveInstalls((prev) => {
                    const next = { ...prev };
                    delete next[backendName];
                    return next;
                });
                await refreshBackendStatuses(tab);
            } else {
                const err = await res.json();
                addToast(err.error || `Failed to delete ${backendName}`, 'error');
            }
        } catch (e: any) {
            addToast(`Error deleting ${backendName}: ${e.message}`, 'error');
        } finally {
            setDeletingBackend(null);
        }
    };

    const currentBackends = activeTab === 'language' ? languageBackends : spatiotemporalBackends;
    const isLoading = activeTab === 'language' ? isLoadingLanguage : isLoadingSpatiotemporal;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content modal-content-manager"
                style={{ maxWidth: '720px', maxHeight: '85vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2>Model Inference Manager</h2>
                    <div className="modal-header-actions">
                        <button type="button" className="close-button close-button-spaced" onClick={onClose}>
                            ×
                        </button>
                    </div>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* Tabs */}
                    <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '6px', marginBottom: '4px' }}>
                        <button
                            type="button"
                            onClick={() => setActiveTab('language')}
                            style={{
                                padding: '4px 2px',
                                fontSize: '0.85rem',
                                fontWeight: activeTab === 'language' ? 'bold' : 'normal',
                                color: activeTab === 'language' ? 'var(--accent)' : 'var(--text-h)',
                                background: 'none',
                                border: 'none',
                                borderBottom: activeTab === 'language' ? '2px solid var(--accent)' : '2px solid transparent',
                                cursor: 'pointer',
                                opacity: activeTab === 'language' ? 1 : 0.6,
                                transition: 'all 0.2s ease',
                            }}
                        >
                            Language Models
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('spatiotemporal')}
                            style={{
                                padding: '4px 2px',
                                fontSize: '0.85rem',
                                fontWeight: activeTab === 'spatiotemporal' ? 'bold' : 'normal',
                                color: activeTab === 'spatiotemporal' ? 'var(--accent)' : 'var(--text-h)',
                                background: 'none',
                                border: 'none',
                                borderBottom: activeTab === 'spatiotemporal' ? '2px solid var(--accent)' : '2px solid transparent',
                                cursor: 'pointer',
                                opacity: activeTab === 'spatiotemporal' ? 1 : 0.6,
                                transition: 'all 0.2s ease',
                            }}
                        >
                            Spatiotemporal Models
                        </button>
                    </div>

                    <div
                        style={{
                            fontSize: '0.72rem',
                            color: 'var(--text-h)',
                            opacity: 0.65,
                            lineHeight: 1.5,
                            marginBottom: '4px',
                        }}
                    >
                        Monitor, download, cancel, and delete local inference engines on demand. Installed engines run models automatically.
                    </div>

                    {isLoading ? (
                        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-h)', opacity: 0.6 }}>
                            Loading engine statuses...
                        </div>
                    ) : currentBackends.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-h)', opacity: 0.6 }}>
                            No backends available in this category.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {currentBackends.map((backend) => {
                                const install = activeInstalls[backend.name];
                                const isBusy =
                                    install &&
                                    install.status !== 'ready' &&
                                    install.status !== 'error' &&
                                    install.status !== 'idle';
                                const isDeleting = deletingBackend === backend.name;
                                const isCancelling = cancellingBackend === backend.name;

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
                                                </div>
                                                <span style={{ fontSize: '0.7rem', color: 'var(--text-h)', opacity: 0.6, lineHeight: 1.3 }}>
                                                    {backend.description}
                                                </span>
                                            </div>

                                            <div style={{ flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                {backend.installed ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            className="editor-button editor-button-cancel"
                                                            onClick={() => handleTriggerInstall(backend.name)}
                                                            disabled={Boolean(isBusy) || isDeleting}
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
                                                        <button
                                                            type="button"
                                                            className="editor-button editor-button-cancel"
                                                            onClick={() => handleDeleteBackend(backend.name)}
                                                            disabled={Boolean(isBusy) || isDeleting}
                                                            style={{
                                                                padding: '4px 10px',
                                                                fontSize: '0.7rem',
                                                                minHeight: '30px',
                                                                color: '#ef4444',
                                                                borderColor: 'rgba(239, 68, 68, 0.3)',
                                                            }}
                                                            title="Uninstall engine and delete files"
                                                        >
                                                            {isDeleting ? 'Deleting...' : 'Delete'}
                                                        </button>
                                                    </>
                                                ) : isBusy ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--accent)' }}>
                                                            {install.percent}%
                                                        </span>
                                                        <button
                                                            type="button"
                                                            className="editor-button editor-button-cancel"
                                                            onClick={() => handleCancelInstall(backend.name)}
                                                            disabled={isCancelling}
                                                            style={{
                                                                padding: '4px 8px',
                                                                fontSize: '0.7rem',
                                                                minHeight: '28px',
                                                                color: '#ef4444',
                                                                borderColor: 'rgba(239, 68, 68, 0.3)',
                                                            }}
                                                            title="Cancel download/installation"
                                                        >
                                                            {isCancelling ? 'Cancelling...' : 'Cancel'}
                                                        </button>
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

                                        {/* Progress Track */}
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