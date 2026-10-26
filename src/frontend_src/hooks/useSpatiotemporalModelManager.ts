// src/frontend_src/hooks/useSpatiotemporalModelManager.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import type { cloudBackend, SpatiotemporalModel } from '../types';
import { loadAllRawSpatiotemporalModels, saveRawSpatiotemporalModel, deleteRawSpatiotemporalModel, loadRawSessionData, saveRawSessionData } from '../storages/serverStorage';
import { useToast } from '../context/ToastContext';
import { localURL } from '../../configurations';
import { cloudBackends } from '../dictionaries/spatiotemporalModelInformation';
import { buildSpatiotemporalModelLoadArguments } from '../utilities/modelLoadArguments';
import { useChatStore } from './useChatStore';

interface SpatiotemporalModelState {
    isRunning: boolean;
    port?: number;
    status?: 'starting' | 'ready' | 'error';
    isIdle?: boolean;
}

export function useSpatiotemporalModelManager() {
    const [spatiotemporalModels, setSpatiotemporalModels] = useState<SpatiotemporalModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedSpatiotemporalModelId, setSelectedSpatiotemporalModelId] = useState<string | null>(null);

    const sessionLoadedRef = useRef(false);
    const runningSpatiotemporalModels = useChatStore(s => s.runningSpatiotemporalModels) as Record<string, SpatiotemporalModelState>;

    const setRunningSpatiotemporalModels = useCallback((update: Record<string, SpatiotemporalModelState> | ((prev: Record<string, SpatiotemporalModelState>) => Record<string, SpatiotemporalModelState>)) => {
        useChatStore.setState(prev => ({
            runningSpatiotemporalModels: typeof update === 'function'
                ? update(prev.runningSpatiotemporalModels as Record<string, SpatiotemporalModelState>)
                : update,
        }));
    }, []);

    const { addToast } = useToast();
    const API_BASE = localURL;
    
    const runningSpatiotemporalModelsRef = useRef(runningSpatiotemporalModels);
    const spatiotemporalModelsRef = useRef(spatiotemporalModels);
    const addToastRef = useRef(addToast);
    const selectedSpatiotemporalModelIdRef = useRef(selectedSpatiotemporalModelId);

    useEffect(() => { runningSpatiotemporalModelsRef.current = runningSpatiotemporalModels; }, [runningSpatiotemporalModels]);
    useEffect(() => { spatiotemporalModelsRef.current = spatiotemporalModels; }, [spatiotemporalModels]);
    useEffect(() => { addToastRef.current = addToast; }, [addToast]);
    useEffect(() => { selectedSpatiotemporalModelIdRef.current = selectedSpatiotemporalModelId; }, [selectedSpatiotemporalModelId]);

    // Load selected spatiotemporal model ID from server session data on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const session = await loadRawSessionData();
                if (!cancelled && session.selectedSpatiotemporalModelId) {
                    setSelectedSpatiotemporalModelId(session.selectedSpatiotemporalModelId);
                }
            } catch (e) {
                console.warn('Failed to load session data for selected spatiotemporal model:', e);
            } finally {
                if (!cancelled) sessionLoadedRef.current = true;
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Persist selected spatiotemporal model ID to server session data on change
    useEffect(() => {
        if (!sessionLoadedRef.current) return;
        saveRawSessionData({ selectedSpatiotemporalModelId }).catch(e =>
            console.warn('Failed to persist selected spatiotemporal model ID:', e)
        );
    }, [selectedSpatiotemporalModelId]);

    // Sync selected spatiotemporal model to session store
    useEffect(() => {
        if (selectedSpatiotemporalModelId) {
            const spatiotemporalModel = spatiotemporalModels.find(m => m.id === selectedSpatiotemporalModelId);
            useChatStore.setState({ selectedSpatiotemporalModel: spatiotemporalModel ?? null });
        } else {
            useChatStore.setState({ selectedSpatiotemporalModel: null });
        }
    }, [selectedSpatiotemporalModelId, spatiotemporalModels]);

    const fetchSpatiotemporalModelStatusFn = useCallback(async () => {
        try {
            const response = await fetch(`${API_BASE}/spatiotemporal_models/status`);
            if (!response.ok) return;

            const data = await response.json();
            const newStatus: Record<string, SpatiotemporalModelState> = {};

            for (const m of data.activeModels || []) {
                // Spatiotemporal models (like image generators) don't typically expose /slots.
                // We consider them idle and ready to accept jobs as soon as the server is up.
                newStatus[m.id] = {
                    isRunning: true,
                    port: m.port,
                    status: m.status,
                    isIdle: m.status === 'ready',
                };
            }

            setRunningSpatiotemporalModels(newStatus);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to fetch spatiotemporal model status", e);
            addToastRef.current(`Failed to fetch spatiotemporal model status: ${message}`, "error");
        }
    }, [API_BASE, setRunningSpatiotemporalModels]);

    const fetchSpatiotemporalModelStatusRef = useRef(fetchSpatiotemporalModelStatusFn);
    useEffect(() => { fetchSpatiotemporalModelStatusRef.current = fetchSpatiotemporalModelStatusFn; }, [fetchSpatiotemporalModelStatusFn]);

    const loadSpatiotemporalModelsFn = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawSpatiotemporalModels();
            setSpatiotemporalModels(data);
            await fetchSpatiotemporalModelStatusRef.current();
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to load spatiotemporal models", e);
            addToastRef.current(`Failed to load spatiotemporal models list: ${message}`, "error");
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadSpatiotemporalModelsRef = useRef(loadSpatiotemporalModelsFn);
    useEffect(() => { loadSpatiotemporalModelsRef.current = loadSpatiotemporalModelsFn; }, [loadSpatiotemporalModelsFn]);

    const loadSpatiotemporalModels = useCallback(async () => { await loadSpatiotemporalModelsRef.current(); }, []);

    const saveSpatiotemporalModel = useCallback(async (spatiotemporalModel: SpatiotemporalModel) => {
        try {
            await saveRawSpatiotemporalModel(spatiotemporalModel);
            await loadSpatiotemporalModelsRef.current();
            return true;
        } catch {
            return false;
        }
    }, []);

    const unloadSpatiotemporalModel = useCallback(async (id: string): Promise<boolean> => {
        try {
            const response = await fetch(`${API_BASE}/spatiotemporal_models/unload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });

            if (response.ok) {
                setRunningSpatiotemporalModels(prev => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
                return true;
            }
            return false;
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error(`Failed to unload spatiotemporal model ${id}:`, message);
            return false;
        }
    }, [API_BASE, setRunningSpatiotemporalModels]);

    const unloadOtherRunningSpatiotemporalModels = useCallback(async (targetId: string) => {
        const otherRunningIds = Object.entries(runningSpatiotemporalModelsRef.current)
            .filter(([rid, st]) => rid !== targetId && st.isRunning)
            .map(([rid]) => rid);

        for (const otherId of otherRunningIds) {
            const otherName = spatiotemporalModelsRef.current.find(m => m.id === otherId)?.name || otherId;
            addToastRef.current(`Switching spatiotemporal models: Stopping ${otherName} to free resources...`, "info");
            await unloadSpatiotemporalModel(otherId);
        }
    }, [unloadSpatiotemporalModel]);

    const unloadAllRunningSpatiotemporalModels = useCallback(async () => {
        const runningIds = Object.entries(runningSpatiotemporalModelsRef.current)
            .filter(([, st]) => st.isRunning)
            .map(([rid]) => rid);

        for (const id of runningIds) {
            const name = spatiotemporalModelsRef.current.find(m => m.id === id)?.name || id;
            addToastRef.current(`Stopping spatiotemporal model ${name} to free resources...`, "info");
            await unloadSpatiotemporalModel(id);
        }
    }, [unloadSpatiotemporalModel]);

    const toggleSpatiotemporalModelLoad = useCallback(async (id: string, forceUnload = false) => {
        const spatiotemporalModel = spatiotemporalModelsRef.current.find(m => m.id === id);
        if (!spatiotemporalModel) return;

        const isCloudSpatiotemporalModel = !!spatiotemporalModel.apiKey && spatiotemporalModel.backend && cloudBackends.includes(spatiotemporalModel.backend as cloudBackend);

        if (isCloudSpatiotemporalModel) {
            if (selectedSpatiotemporalModelIdRef.current === id) {
                setSelectedSpatiotemporalModelId(null);
                addToastRef.current(`Cloud spatiotemporal model ${spatiotemporalModel.name} deselected`, "info");
            } else {
                await unloadOtherRunningSpatiotemporalModels(id);
                setSelectedSpatiotemporalModelId(id);
                addToastRef.current(`Cloud spatiotemporal model ${spatiotemporalModel.name} selected`, "success");
            }
            return;
        }

        const isCurrentlyRunning = runningSpatiotemporalModelsRef.current[id]?.isRunning;

        if (isCurrentlyRunning && !forceUnload) {
            try {
                addToastRef.current("Stopping spatiotemporal model...", "info");
                const success = await unloadSpatiotemporalModel(id);
                if (success) {
                    addToastRef.current("Spatiotemporal model stopped successfully", "success");
                    setSelectedSpatiotemporalModelId(prev => prev === id ? null : prev);
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Unknown error";
                addToastRef.current(`Failed to stop spatiotemporal model: ${message}`, "error");
            }
        }
        else if (!isCurrentlyRunning) {
            await unloadOtherRunningSpatiotemporalModels(id);
            const modelPath = spatiotemporalModel.model || '';
            const args = buildSpatiotemporalModelLoadArguments(spatiotemporalModel);

            try {
                addToastRef.current(`Starting spatiotemporal model ${spatiotemporalModel.name}...`, "info");
                const response = await fetch(`${API_BASE}/spatiotemporal_models/load`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        id: spatiotemporalModel.id, 
                        modelPath, 
                        args, 
                        backend: spatiotemporalModel.backend || 'stable-diffusion.cpp' 
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    addToastRef.current(`Spatiotemporal model loaded on port ${data.port}`, "success");
                    setRunningSpatiotemporalModels(prev => ({ ...prev, [id]: { isRunning: true, port: data.port, status: 'ready', isIdle: true } }));
                    setSelectedSpatiotemporalModelId(id);
                } else {
                    throw new Error((await response.json()).error || "Unknown error");
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Unknown error";
                addToastRef.current(`Failed to start spatiotemporal model: ${message}`, "error");
            }
        }
        else if (isCurrentlyRunning) {
            await unloadOtherRunningSpatiotemporalModels(id);
            setSelectedSpatiotemporalModelId(id);
            addToastRef.current(`Spatiotemporal model ${spatiotemporalModel.name} selected`, "success");
        }
    }, [API_BASE, unloadSpatiotemporalModel, unloadOtherRunningSpatiotemporalModels, setRunningSpatiotemporalModels]);

    const deleteSpatiotemporalModel = useCallback(async (id: string) => {
        if (runningSpatiotemporalModelsRef.current[id]?.isRunning) {
            await unloadSpatiotemporalModel(id);
        }
        try {
            await deleteRawSpatiotemporalModel(id);
            await loadSpatiotemporalModelsRef.current();
            setSelectedSpatiotemporalModelId(prev => prev === id ? null : prev);
            return true;
        } catch {
            return false;
        }
    }, [unloadSpatiotemporalModel]);

    useEffect(() => {
        let cancelled = false;

        const initialLoad = async () => {
            setIsLoading(true);
            try {
                const data = await loadAllRawSpatiotemporalModels();
                if (!cancelled) setSpatiotemporalModels(data);
                await fetchSpatiotemporalModelStatusRef.current();
            } catch (e) {
                const message = e instanceof Error ? e.message : "Unknown error";
                console.error("Failed to load spatiotemporal models", e);
                if (!cancelled) addToastRef.current(`Failed to load spatiotemporal models list: ${message}`, "error");
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        initialLoad();
        const interval = setInterval(() => { void fetchSpatiotemporalModelStatusRef.current(); }, 3000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    return {
        spatiotemporalModels,
        isLoading,
        saveSpatiotemporalModel,
        deleteSpatiotemporalModel,
        refresh: loadSpatiotemporalModels,
        runningSpatiotemporalModels,
        toggleSpatiotemporalModelLoad,
        unloadSpatiotemporalModel,
        unloadAllRunningSpatiotemporalModels,
        selectedSpatiotemporalModelId,
        setSelectedSpatiotemporalModelId
    };
}