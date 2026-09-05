// src/hooks/useModelManager.ts
import { useState, useEffect, useRef } from 'react';
import type { LanguageModel } from '../types';
import { loadAllRawModels, saveRawModel, deleteRawModel } from './storage';
import { useToast } from '../context/ToastContext';
import { localAddress, localURL } from '../configurations';
import { cloudBackends } from '../languageModelInformation';

interface ModelState {
    isRunning: boolean;
    port?: number;
    status?: 'starting' | 'ready' | 'error';
    isIdle?: boolean;
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

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${API_BASE}/models/status`);
            if (!res.ok) return;
            
            const data = await res.json();
            const newStatus: Record<string, ModelState> = {};
            
            for (const m of data.activeModels || []) {
                const prevIdle = runningModels[m.id]?.isIdle ?? false;
                
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
                        
                        const slots = await slotsRes.json();
                        const allIdle = Array.isArray(slots) && 
                            slots.length > 0 && 
                            slots.every((s: any) => !s.busy && !s.processing);
                        
                        newStatus[m.id].isIdle = allIdle;
                        
                        if (allIdle && !idleNotifiedRef.current.has(m.id)) {
                            idleNotifiedRef.current.add(m.id);
                            addToast("Model idle and ready", "success");
                        } else if (!allIdle && idleNotifiedRef.current.has(m.id)) {
                            idleNotifiedRef.current.delete(m.id);
                        }
                    } catch (e) { /* ignore */ }
                }
            }
            
            const activeIds = new Set(data.activeModels?.map((m: any) => m.id) || []);
            for (const id of idleNotifiedRef.current) {
                if (!activeIds.has(id)) idleNotifiedRef.current.delete(id);
            }

            setRunningModels(newStatus);
        } catch (e) { /* ignore */ }
    };

    const loadModels = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawModels();
            setModels(data);
            await fetchStatus();
        } catch (err) {
            console.error("Failed to load models", err);
            addToast("Failed to load models list", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const saveModel = async (model: LanguageModel) => {
        try {
            await saveRawModel(model);
            await loadModels();
            addToast(`Model ${model.name} saved`, "success");
            return true;
        } catch (err) {
            console.error("Failed to save model", err);
            addToast("Failed to save model", "error");
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
        } catch (err) {
            console.error("Failed to delete model", err);
            addToast("Failed to delete model", "error");
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
        } catch (err) {
            console.error(`Failed to unload model ${id}:`, err);
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

    const toggleModelLoad = async (id: string, forceUnload: boolean = false) => {
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
                addToast(`Stopping model...`, "info");
                const success = await unloadModelInternal(id);
                if (success) {
                    addToast(`Model stopped successfully`, "success");
                    if (selectedModelId === id) setSelectedModelId(null);
                }
            } catch (err) {
                addToast("Failed to stop model", "error");
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
            } catch (err: any) {
                addToast(`Failed to start: ${err.message}`, "error");
            }
        }
        else if (isCurrentlyRunning && selectedModelId !== id) {
            await unloadOtherRunningModels(id);
            setSelectedModelId(id);
            addToast(`Model ${model.name} selected`, "success");
        }
    };

    useEffect(() => {
        loadModels();
        const interval = setInterval(fetchStatus, 2000);
        return () => clearInterval(interval);
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