// src/hooks/useModelManager.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import type { cloudBackend, LanguageModel } from '../types';
import { loadAllRawModels, saveRawModel, deleteRawModel } from '../storage/serverStorage';
import { useToast } from '../context/ToastContext';
import { localAddress, localURL } from '../configurations';
import { cloudBackends } from '../dictionaries/languageModelInformation';
import { buildModelLoadArguments } from './modelLoadArguments';
import { useSessionStore } from './useSessionStore';

interface ModelState {
    isRunning: boolean;
    port?: number;
    status?: 'starting' | 'ready' | 'error';
    isIdle?: boolean;
}

interface ModelSlot {
    busy?: boolean;
    processing?: boolean;
}

interface ActiveModel {
    id: string;
}

export function useModelManager() {
    const [models, setModels] = useState<LanguageModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
        try { return localStorage.getItem('loreReactor_selectedModelId'); } catch { return null; }
    });

    // Read runningModels directly from the session store — single source of truth
    const runningModels = useSessionStore(s => s.runningModels) as Record<string, ModelState>;

    // Write to session store instead of local state
    const setRunningModels = useCallback((update: Record<string, ModelState> | ((prev: Record<string, ModelState>) => Record<string, ModelState>)) => {
        useSessionStore.setState(prev => ({
            runningModels: typeof update === 'function'
                ? update(prev.runningModels as Record<string, ModelState>)
                : update,
        }));
    }, []);

    const { addToast } = useToast();
    const API_BASE = localURL;
    const idleNotifiedRef = useRef<Set<string>>(new Set());
    const runningModelsRef = useRef(runningModels);
    const modelsRef = useRef(models);
    const addToastRef = useRef(addToast);
    const selectedModelIdRef = useRef(selectedModelId);

    // Sync refs via effects (not during render)
    useEffect(() => { runningModelsRef.current = runningModels; }, [runningModels]);
    useEffect(() => { modelsRef.current = models; }, [models]);
    useEffect(() => { addToastRef.current = addToast; }, [addToast]);
    useEffect(() => { selectedModelIdRef.current = selectedModelId; }, [selectedModelId]);

    // Persist selected model ID to localStorage
    useEffect(() => {
        try {
            if (selectedModelId) {
                localStorage.setItem('loreReactor_selectedModelId', selectedModelId);
            } else {
                localStorage.removeItem('loreReactor_selectedModelId');
            }
        } catch { /* ignore */ }
    }, [selectedModelId]);

    // Sync selected model to session store whenever it changes
    useEffect(() => {
        if (selectedModelId) {
            const model = models.find(m => m.id === selectedModelId);
            useSessionStore.setState({ selectedModel: model ?? null });
        } else {
            useSessionStore.setState({ selectedModel: null });
        }
    }, [selectedModelId, models]);

    // Stable fetchStatus — stored in ref, updated via effect
    const fetchStatusFn = useCallback(async () => {
        try {
            const response = await fetch(`${API_BASE}/models/status`);
            if (!response.ok) return;

            const data = await response.json();
            const newStatus: Record<string, ModelState> = {};

            for (const m of data.activeModels || []) {
                const prevIdle = runningModelsRef.current[m.id]?.isIdle ?? false;

                newStatus[m.id] = {
                    isRunning: true,
                    port: m.port,
                    status: m.status,
                    isIdle: prevIdle,
                };

                if (m.status === 'ready' && m.port) {
                    try {
                        const slotsRes = await fetch(`${localAddress}:${m.port}/slots`);
                        if (!slotsRes.ok) continue;

                        const slots: unknown = await slotsRes.json();
                        const allIdle = Array.isArray(slots) &&
                            slots.length > 0 &&
                            slots.every((s: unknown) => {
                                if (typeof s !== 'object' || s === null) return false;
                                const slot = s as ModelSlot;
                                return !slot.busy && !slot.processing;
                            });

                        newStatus[m.id].isIdle = allIdle;

                        if (allIdle && !idleNotifiedRef.current.has(m.id)) {
                            idleNotifiedRef.current.add(m.id);
                            addToastRef.current("Model idle and ready", "success");
                        } else if (!allIdle && idleNotifiedRef.current.has(m.id)) {
                            idleNotifiedRef.current.delete(m.id);
                        }
                    } catch (e) {
                        const message = e instanceof Error ? e.message : "Unknown error";
                        console.error(`Failed to fetch status for model ${m.id}:`, e);
                        addToastRef.current(`Failed to fetch status for model ${m.id}: ${message}`, "error");
                    }
                }
            }

            const activeIds = new Set(data.activeModels?.map((m: ActiveModel) => m.id) || []);
            for (const id of idleNotifiedRef.current) {
                if (!activeIds.has(id)) idleNotifiedRef.current.delete(id);
            }

            setRunningModels(newStatus);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to fetch model status", e);
            addToastRef.current(`Failed to fetch model status: ${message}`, "error");
        }
    }, [API_BASE, setRunningModels]);

    const fetchStatusRef = useRef(fetchStatusFn);
    useEffect(() => { fetchStatusRef.current = fetchStatusFn; }, [fetchStatusFn]);

    // Stable loadModels — stored in ref, updated via effect
    const loadModelsFn = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawModels();
            setModels(data);
            await fetchStatusRef.current();
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to load models", e);
            addToastRef.current(`Failed to load models list: ${message}`, "error");
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadModelsRef = useRef(loadModelsFn);
    useEffect(() => { loadModelsRef.current = loadModelsFn; }, [loadModelsFn]);

    // Public-facing stable callbacks
    const loadModels = useCallback(async () => { await loadModelsRef.current(); }, []);

    const saveModel = useCallback(async (model: LanguageModel) => {
        try {
            await saveRawModel(model);
            await loadModelsRef.current();
            addToastRef.current(`Model ${model.name} saved`, "success");
            return true;
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to save model", e);
            addToastRef.current(`Failed to save model: ${message}`, "error");
            return false;
        }
    }, []);

    const unloadModelInternal = useCallback(async (id: string): Promise<boolean> => {
        try {
            const response = await fetch(`${API_BASE}/models/unload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });

            if (response.ok) {
                idleNotifiedRef.current.delete(id);
                setRunningModels(prev => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
                return true;
            }
            return false;
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error(`Failed to unload model ${id}:`, message);
            return false;
        }
    }, [API_BASE, setRunningModels]);

    const unloadOtherRunningModels = useCallback(async (targetId: string) => {
        const otherRunningIds = Object.entries(runningModelsRef.current)
            .filter(([rid, st]) => rid !== targetId && st.isRunning)
            .map(([rid]) => rid);

        for (const otherId of otherRunningIds) {
            const otherName = modelsRef.current.find(m => m.id === otherId)?.name || otherId;
            addToastRef.current(`Switching models: Stopping ${otherName} to free resources...`, "info");
            await unloadModelInternal(otherId);
        }
    }, [unloadModelInternal]);

    const toggleModelLoad = useCallback(async (id: string, forceUnload = false) => {
        const model = modelsRef.current.find(m => m.id === id);
        if (!model) return;

        const isCloudModel = !!model.apiKey && model.backend && cloudBackends.includes(model.backend as cloudBackend);

        if (isCloudModel) {
            if (selectedModelIdRef.current === id) {
                setSelectedModelId(null);
                addToastRef.current(`Cloud model ${model.name} deselected`, "info");
            } else {
                await unloadOtherRunningModels(id);
                setSelectedModelId(id);
                addToastRef.current(`Cloud model ${model.name} selected`, "success");
            }
            return;
        }

        const isCurrentlyRunning = runningModelsRef.current[id]?.isRunning;

        if (isCurrentlyRunning && !forceUnload) {
            try {
                addToastRef.current("Stopping model...", "info");
                const success = await unloadModelInternal(id);
                if (success) {
                    addToastRef.current("Model stopped successfully", "success");
                    setSelectedModelId(prev => prev === id ? null : prev);
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Unknown error";
                addToastRef.current(`Failed to stop model: ${message}`, "error");
            }
        }
        else if (!isCurrentlyRunning) {
            await unloadOtherRunningModels(id);
            const modelPath = model.model || '';
            const args = buildModelLoadArguments(model);

            try {
                addToastRef.current(`Starting model ${model.name}...`, "info");
                const response = await fetch(`${API_BASE}/models/load`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: model.id, modelPath, args })
                });

                if (response.ok) {
                    const data = await response.json();
                    addToastRef.current(`Model loaded on port ${data.port}`, "success");
                    setRunningModels(prev => ({ ...prev, [id]: { isRunning: true, port: data.port, status: 'ready', isIdle: false } }));
                    setSelectedModelId(id);
                } else {
                    throw new Error((await response.json()).error || "Unknown error");
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Unknown error";
                addToastRef.current(`Failed to start: ${message}`, "error");
            }
        }
        else if (isCurrentlyRunning) {
            await unloadOtherRunningModels(id);
            setSelectedModelId(id);
            addToastRef.current(`Model ${model.name} selected`, "success");
        }
    }, [API_BASE, unloadModelInternal, unloadOtherRunningModels, setRunningModels]);

    const deleteModel = useCallback(async (id: string) => {
        if (runningModelsRef.current[id]?.isRunning) {
            await unloadModelInternal(id);
        }
        try {
            await deleteRawModel(id);
            await loadModelsRef.current();
            setSelectedModelId(prev => prev === id ? null : prev);
            addToastRef.current("Model deleted", "info");
            return true;
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to delete model", e);
            addToastRef.current(`Failed to delete model: ${message}`, "error");
            return false;
        }
    }, [unloadModelInternal]);

    // Single effect: load once on mount, poll every 3 seconds
    useEffect(() => {
        let cancelled = false;

        const initialLoad = async () => {
            setIsLoading(true);
            try {
                const data = await loadAllRawModels();
                if (!cancelled) setModels(data);
                await fetchStatusRef.current();
            } catch (e) {
                const message = e instanceof Error ? e.message : "Unknown error";
                console.error("Failed to load models", e);
                if (!cancelled) addToastRef.current(`Failed to load models list: ${message}`, "error");
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        initialLoad();
        const interval = setInterval(() => { void fetchStatusRef.current(); }, 3000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    return {
        models,
        isLoading,
        saveModel,
        deleteModel,
        refresh: loadModels,
        runningModels,
        toggleModelLoad,
        selectedModelId,
        setSelectedModelId
    };
}