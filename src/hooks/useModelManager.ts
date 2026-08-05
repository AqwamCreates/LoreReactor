// src/hooks/useModelManager.ts
import { useState, useEffect } from 'react';
import type { LanguageModel } from '../types';
import { loadAllRawModels, saveRawModel, deleteRawModel } from './storage';
import { useToast } from '../context/ToastContext';

// Define the state of a loaded model
interface ModelState {
  isRunning: boolean;
  port?: number;
  status?: 'starting' | 'ready' | 'error';
}

const API_BASE = 'http://localhost:3001';

export function useModelManager() {
    const [models, setModels] = useState<LanguageModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [runningModels, setRunningModels] = useState<Record<string, ModelState>>({});
    const { addToast } = useToast();

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${API_BASE}/models/status`);
            if (res.ok) {
                const data = await res.json();
                const newStatus: Record<string, ModelState> = {};
                data.activeModels.forEach((m: any) => {
                    newStatus[m.id] = {
                        isRunning: true,
                        port: m.port,
                        status: m.status
                    };
                });
                setRunningModels(newStatus);
            }
        } catch (e) {
            // Silently fail if server is down
        }
    };

    const loadModels = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawModels();
            setModels(data);
            await fetchStatus(); // Check which ones are already running
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
        // Force unload first if running
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

    // ✅ NEW: Toggle Load/Unload Logic
    const toggleModelLoad = async (id: string, forceUnload: boolean = false) => {
        const isCurrentlyRunning = runningModels[id]?.isRunning;
        
        // If running and not forcing unload, we want to unload it
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
        // If not running, we want to load it
        else if (!isCurrentlyRunning) {
            const model = models.find(m => m.id === id);
            if (!model) return;

            // Construct absolute path if relative (optional, depends on your storage)
            // Assuming model.model contains the full path or relative to user_data
            const modelPath = model.model || '';
            
            try {
                addToast(`Starting model ${model.name}...`, "info");
                const res = await fetch(`${API_BASE}/models/load`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: model.id,
                        modelPath: modelPath,
                        args: [`-c`, model.contextLength.toString(), `-ngl`, "99"] // Example args
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    addToast(`Model loaded on port ${data.port}`, "success");
                    setRunningModels(prev => ({
                        ...prev,
                        [id]: { isRunning: true, port: data.port, status: 'ready' }
                    }));
                    
                    // Auto-select this model for chat if loaded successfully
                    // You might want to pass this ID back to App.tsx via a callback
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
        // Poll status every 5 seconds to keep UI in sync if external changes happen
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    return { 
        models, 
        isLoading, 
        saveModel, 
        deleteModel, 
        refresh: loadModels,
        runningModels,
        toggleModelLoad
    };
}