// src/hooks/useModelManager.ts
import { useState, useEffect, useRef } from 'react';
import type { LanguageModel } from '../types';
import { loadAllRawModels, saveRawModel, deleteRawModel } from './storage';
import { useToast } from '../context/ToastContext';
import { localURL } from '../configurations';

interface ModelState {
  isRunning: boolean;
  port?: number;
  status?: 'starting' | 'ready' | 'error';
}

export function useModelManager() {
    const [models, setModels] = useState<LanguageModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [runningModels, setRunningModels] = useState<Record<string, ModelState>>({});
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
                newStatus[m.id] = {
                    isRunning: true,
                    port: m.port,
                    status: m.status
                };

                // ✅ Check slot idleness — silently skip non-200 responses (503, 404, etc.)
                if (m.status === 'ready' && m.port) {
                    try {
                        const slotsRes = await fetch(`http://localhost:${m.port}/slots`);
                        
                        // Silently skip if model isn't ready yet (503) or endpoint doesn't exist (404)
                        if (!slotsRes.ok) continue;
                        
                        const slots = await slotsRes.json();
                        const allIdle = Array.isArray(slots) && 
                            slots.length > 0 && 
                            slots.every((s: any) => !s.busy && !s.processing);
                        
                        if (allIdle && !idleNotifiedRef.current.has(m.id)) {
                            idleNotifiedRef.current.add(m.id);
                            addToast(`✅ Model idle and ready`, "success");
                        } else if (!allIdle && idleNotifiedRef.current.has(m.id)) {
                            idleNotifiedRef.current.delete(m.id);
                        }
                    } catch (e) {
                        // Network error, CORS, or invalid JSON — ignore silently
                    }
                }
            }
            
            // Clean up notified set for models no longer running
            const activeIds = new Set(data.activeModels?.map((m: any) => m.id) || []);
            for (const id of idleNotifiedRef.current) {
                if (!activeIds.has(id)) idleNotifiedRef.current.delete(id);
            }

            setRunningModels(newStatus);
        } catch (e) {
            // Server down or unreachable — ignore silently
        }
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

    const toggleModelLoad = async (id: string, forceUnload: boolean = false) => {
        const isCurrentlyRunning = runningModels[id]?.isRunning;
        
        if (isCurrentlyRunning && !forceUnload) {
            try {
                addToast(`Stopping model...`, "info");
                const res = await fetch(`${API_BASE}/models/unload`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
                
                if (res.ok) {
                    addToast(`Model stopped successfully`, "success");
                    idleNotifiedRef.current.delete(id);
                    
                    if (selectedModelId === id) {
                        setSelectedModelId(null);
                    }
                    
                    setRunningModels(prev => {
                        const next = { ...prev };
                        delete next[id];
                        return next;
                    });
                } else {
                    throw new Error("Failed to unload");
                }
            } catch (err) {
                addToast("Failed to stop model", "error");
                console.error(err);
            }
        } 
        else if (!isCurrentlyRunning) {
            const model = models.find(m => m.id === id);
            if (!model) return;

            const modelPath = model.model || '';
            
            try {
                addToast(`Starting model ${model.name}...`, "info");
                const res = await fetch(`${API_BASE}/models/load`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: model.id,
                        modelPath: modelPath,
                        args: [`-c`, model.contextLength.toString(), `-ngl`, "99"]
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    addToast(`Model loaded on port ${data.port}`, "success");
                    setRunningModels(prev => ({
                        ...prev,
                        [id]: { isRunning: true, port: data.port, status: 'ready' }
                    }));
                    
                    // Auto-select when model loads successfully
                    setSelectedModelId(id);
                } else {
                    const errData = await res.json();
                    throw new Error(errData.error || "Unknown error");
                }
            } catch (err: any) {
                addToast(`Failed to start: ${err.message}`, "error");
                console.error(err);
            }
        }
    };

    useEffect(() => {
        loadModels();
        const interval = setInterval(fetchStatus, 3000);
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