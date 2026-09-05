// src/hooks/useModelManager.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { localURL, localAddress } from '../../configurations';
import { loadAllRawModels, saveRawModel, deleteRawModel } from '../../infrastructure';
import { cloudBackends } from '../../languageModelInformation';
import type { LanguageModel } from '../../types';
import { useToast } from '../contexts/ToastContext';

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
    const [runningModels, setRunningModels] = useState<Record<string, ModelState>>({});
    // selectedModelId is now controlled externally via setSelectedModelId prop or return value
    const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
    
    const { addToast } = useToast();
    const API_BASE = localURL;
    const idleNotifiedRef = useRef<Set<string>>(new Set());
    const runningModelsRef = useRef(runningModels);

    useEffect(() => {
        runningModelsRef.current = runningModels;
    }, [runningModels]);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/models/status`);
            if (!res.ok) return;
            
            const data = await res.json();
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
                            addToast("Model idle and ready", "success");
                        } else if (!allIdle && idleNotifiedRef.current.has(m.id)) {
                            idleNotifiedRef.current.delete(m.id);
                        }
                    } catch (e) {
                        const message = e instanceof Error ? e.message : "Unknown error";
                        console.error(`Failed to fetch status for model ${m.id}:`, e);
                        addToast(`Failed to fetch status for model ${m.id}: ${message}`, "error");
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
            addToast(`Failed to fetch model status: ${message}`, "error");
        }
    }, [API_BASE, addToast]);

    const loadModels = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawModels();
            setModels(data);
            await fetchStatus();
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to load models", e);
            addToast(`Failed to load models list: ${message}`, "error");
        } finally {
            setIsLoading(false);
        }
    }, [addToast, fetchStatus]);

    const saveModel = async (model: LanguageModel) => {
        try {
            await saveRawModel(model);
            await loadModels();
            addToast(`Model ${model.name} saved`, "success");
            return true;
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to save model", e);
            addToast(`Failed to save model: ${message}`, "error");
            return false;
        }
    };

    const deleteModel = async (id: string) => {
        if (runningModels[id]?.isRunning) {
            await toggleModelLoad(id, true); 
        }
        try {
            await deleteRawModel(id);
            await loadModels();
            addToast("Model deleted", "info");
            return true;
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to delete model", e);
            addToast(`Failed to delete model: ${message}`, "error");
            return false;
        }
    };

    const unloadModelInternal = async (id: string): Promise<boolean> => {
        try {
            const res = await fetch(`${API_BASE}/models/unload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            
            if (res.ok) {
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
    };

    const unloadOtherRunningModels = async (targetId: string) => {
        const otherRunningIds = Object.entries(runningModels)
            .filter(([rid, state]) => rid !== targetId && state.isRunning)
            .map(([rid]) => rid);
        
        for (const otherId of otherRunningIds) {
            const otherName = models.find(m => m.id === otherId)?.name || otherId;
            addToast(`Switching models: Stopping ${otherName} to free resources...`, "info");
            await unloadModelInternal(otherId);
        }
    };

    const toggleModelLoad = async (id: string, forceUnload = false) => {
        const model = models.find(m => m.id === id);
        if (!model) return;

        const isCloudModel = !!model.apiKey && model.backend && cloudBackends.includes(model.backend);

        if (isCloudModel) {
            if (selectedModelId === id) {
                setSelectedModelId(null);
                addToast(`Cloud model ${model.name} deselected`, "info");
            } else {
                await unloadOtherRunningModels(id);
                setSelectedModelId(id);
                addToast(`Cloud model ${model.name} selected`, "success");
            }
            return;
        }

        const isCurrentlyRunning = runningModels[id]?.isRunning;
        
        if (isCurrentlyRunning && !forceUnload) {
            try {
                addToast("Stopping model...", "info");
                const success = await unloadModelInternal(id);
                if (success) {
                    addToast("Model stopped successfully", "success");
                    if (selectedModelId === id) setSelectedModelId(null);
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Unknown error";
                addToast(`Failed to stop model: ${message}`, "error");
            }
        } 
        else if (!isCurrentlyRunning) {
            await unloadOtherRunningModels(id);
            const modelPath = model.model || '';
            const args: string[] = ['-c', model.contextLength.toString(), '-ngl', '99'];
            if (model.mmproj?.trim()) args.push('--mmproj', model.mmproj.trim());
            if (model.lora?.trim()) args.push('--lora', model.lora.trim());
            
            const params = model.parameters || {};
            if (params.gpu_layers !== undefined) {
                const nglIndex = args.indexOf('-ngl');
                if (nglIndex !== -1) args[nglIndex + 1] = String(params.gpu_layers);
            }
            if (params.extra_flags && String(params.extra_flags).trim()) {
                args.push(...String(params.extra_flags).trim().split(/\s+/));
            }
            
            try {
                addToast(`Starting model ${model.name}...`, "info");
                const res = await fetch(`${API_BASE}/models/load`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: model.id, modelPath, args })
                });

                if (res.ok) {
                    const data = await res.json();
                    addToast(`Model loaded on port ${data.port}`, "success");
                    setRunningModels(prev => ({ ...prev, [id]: { isRunning: true, port: data.port, status: 'ready', isIdle: false } }));
                    setSelectedModelId(id);
                } else {
                    throw new Error((await res.json()).error || "Unknown error");
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Unknown error";
                addToast(`Failed to start: ${message}`, "error");
            }
        }
        else if (isCurrentlyRunning && selectedModelId !== id) {
            await unloadOtherRunningModels(id);
            setSelectedModelId(id);
            addToast(`Model ${model.name} selected`, "success");
        }
    };

    useEffect(() => {
        const timeout = setTimeout(() => {
            void loadModels();
        }, 0);
        const interval = setInterval(fetchStatus, 2000);
        return () => {
            clearTimeout(timeout);
            clearInterval(interval);
        };
    }, [fetchStatus, loadModels]);

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