// src/frontend_src/hooks/useLanguageModelManager.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import type { cloudBackend, LanguageModel } from '../types';
import { loadAllRawModels, saveRawLanguageModel, deleteRawModel, loadRawSessionData, saveRawSessionData } from '../storages/serverStorage';
import { useToast } from '../context/ToastContext';
import { localAddress, localURL } from '../../configurations';
import { cloudBackends } from '../dictionaries/languageModelInformation';
import { buildModelLoadArguments } from '../utilities/modelLoadArguments';
import { useChatStore } from './useChatStore';

interface LanguageModelState {
    isRunning: boolean;
    port?: number;
    status?: 'starting' | 'ready' | 'error';
    isIdle?: boolean;
}

interface LanguageModelSlot {
    busy?: boolean;
    processing?: boolean;
}

interface ActiveLanguageModel {
    id: string;
}

export function useLanguageModelManager() {
    const [languageModels, setLanguageModels] = useState<LanguageModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedLanguageModelId, setSelectedLanguageModelId] = useState<string | null>(null);

    const sessionLoadedRef = useRef(false);
    const runningLanguageModels = useChatStore(s => s.runningModels) as Record<string, LanguageModelState>;

    const setRunningLanguageModels = useCallback((update: Record<string, LanguageModelState> | ((prev: Record<string, LanguageModelState>) => Record<string, LanguageModelState>)) => {
        useChatStore.setState(prev => ({
            runningModels: typeof update === 'function'
                ? update(prev.runningModels as Record<string, LanguageModelState>)
                : update,
        }));
    }, []);

    const { addToast } = useToast();
    const API_BASE = localURL;
    const idleNotifiedRef = useRef<Set<string>>(new Set());
    const runningLanguageModelsRef = useRef(runningLanguageModels);
    const languageModelsRef = useRef(languageModels);
    const addToastRef = useRef(addToast);
    const selectedLanguageModelIdRef = useRef(selectedLanguageModelId);

    useEffect(() => { runningLanguageModelsRef.current = runningLanguageModels; }, [runningLanguageModels]);
    useEffect(() => { languageModelsRef.current = languageModels; }, [languageModels]);
    useEffect(() => { addToastRef.current = addToast; }, [addToast]);
    useEffect(() => { selectedLanguageModelIdRef.current = selectedLanguageModelId; }, [selectedLanguageModelId]);

    // Load selected language model ID from server session data on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const session = await loadRawSessionData();
                if (!cancelled && session.selectedModelId) {
                    setSelectedLanguageModelId(session.selectedModelId);
                }
            } catch (e) {
                console.warn('Failed to load session data for selected language model:', e);
            } finally {
                if (!cancelled) sessionLoadedRef.current = true;
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Persist selected language model ID to server session data on change
    useEffect(() => {
        if (!sessionLoadedRef.current) return;
        saveRawSessionData({ selectedModelId: selectedLanguageModelId }).catch(e =>
            console.warn('Failed to persist selected language model ID:', e)
        );
    }, [selectedLanguageModelId]);

    // Sync selected language model to session store
    useEffect(() => {
        if (selectedLanguageModelId) {
            const languageModel = languageModels.find(m => m.id === selectedLanguageModelId);
            useChatStore.setState({ selectedModel: languageModel ?? null });
        } else {
            useChatStore.setState({ selectedModel: null });
        }
    }, [selectedLanguageModelId, languageModels]);

    const fetchLanguageModelStatusFn = useCallback(async () => {
        try {
            const response = await fetch(`${API_BASE}/language_models/status`);
            if (!response.ok) return;

            const data = await response.json();
            const newStatus: Record<string, LanguageModelState> = {};

            for (const m of data.activeModels || []) {
                const prevIdle = runningLanguageModelsRef.current[m.id]?.isIdle ?? false;

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
                                const slot = s as LanguageModelSlot;
                                return !slot.busy && !slot.processing;
                            });

                        newStatus[m.id].isIdle = allIdle;

                        if (allIdle && !idleNotifiedRef.current.has(m.id)) {
                            idleNotifiedRef.current.add(m.id);
                            addToastRef.current("Language model idle and ready", "success");
                        } else if (!allIdle && idleNotifiedRef.current.has(m.id)) {
                            idleNotifiedRef.current.delete(m.id);
                        }
                    } catch (e) {
                        const message = e instanceof Error ? e.message : "Unknown error";
                        console.error(`Failed to fetch status for language model ${m.id}:`, e);
                        addToastRef.current(`Failed to fetch status for language model ${m.id}: ${message}`, "error");
                    }
                }
            }

            const activeIds = new Set(data.activeModels?.map((m: ActiveLanguageModel) => m.id) || []);
            for (const id of idleNotifiedRef.current) {
                if (!activeIds.has(id)) idleNotifiedRef.current.delete(id);
            }

            setRunningLanguageModels(newStatus);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to fetch language model status", e);
            addToastRef.current(`Failed to fetch language model status: ${message}`, "error");
        }
    }, [API_BASE, setRunningLanguageModels]);

    const fetchLanguageModelStatusRef = useRef(fetchLanguageModelStatusFn);
    useEffect(() => { fetchLanguageModelStatusRef.current = fetchLanguageModelStatusFn; }, [fetchLanguageModelStatusFn]);

    const loadLanguageModelsFn = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawModels();
            setLanguageModels(data);
            await fetchLanguageModelStatusRef.current();
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to load language models", e);
            addToastRef.current(`Failed to load language models list: ${message}`, "error");
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadLanguageModelsRef = useRef(loadLanguageModelsFn);
    useEffect(() => { loadLanguageModelsRef.current = loadLanguageModelsFn; }, [loadLanguageModelsFn]);

    const loadLanguageModels = useCallback(async () => { await loadLanguageModelsRef.current(); }, []);

    const saveLanguageModel = useCallback(async (languageModel: LanguageModel) => {
        try {
            await saveRawLanguageModel(languageModel);
            await loadLanguageModelsRef.current();
            return true;
        } catch {
            return false;
        }
    }, []);

    const unloadLanguageModel = useCallback(async (id: string): Promise<boolean> => {
        try {
            const response = await fetch(`${API_BASE}/language_models/unload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });

            if (response.ok) {
                idleNotifiedRef.current.delete(id);
                setRunningLanguageModels(prev => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
                return true;
            }
            return false;
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error(`Failed to unload language model ${id}:`, message);
            return false;
        }
    }, [API_BASE, setRunningLanguageModels]);

    const unloadOtherRunningLanguageModels = useCallback(async (targetId: string) => {
        const otherRunningIds = Object.entries(runningLanguageModelsRef.current)
            .filter(([rid, st]) => rid !== targetId && st.isRunning)
            .map(([rid]) => rid);

        for (const otherId of otherRunningIds) {
            const otherName = languageModelsRef.current.find(m => m.id === otherId)?.name || otherId;
            addToastRef.current(`Switching language models: Stopping ${otherName} to free resources...`, "info");
            await unloadLanguageModel(otherId);
        }
    }, [unloadLanguageModel]);

    const unloadAllRunningLanguageModels = useCallback(async () => {
        const runningIds = Object.entries(runningLanguageModelsRef.current)
            .filter(([, st]) => st.isRunning)
            .map(([rid]) => rid);

        for (const id of runningIds) {
            const name = languageModelsRef.current.find(m => m.id === id)?.name || id;
            addToastRef.current(`Stopping language model ${name} to free resources for budget strategy...`, "info");
            await unloadLanguageModel(id);
        }
    }, [unloadLanguageModel]);

    const deactivateActiveBudgetStrategy = useCallback(() => {
        useChatStore.setState({ activeStrategy: null, selectedBudgetStrategyId: null });
        saveRawSessionData({ selectedBudgetStrategyId: null }).catch(e =>
            console.warn('[useLanguageModelManager] Failed to deactivate budget strategy:', e)
        );
    }, []);

    const toggleLanguageModelLoad = useCallback(async (id: string, forceUnload = false) => {
        const languageModel = languageModelsRef.current.find(m => m.id === id);
        if (!languageModel) return;

        const isCloudLanguageModel = !!languageModel.apiKey && languageModel.backend && cloudBackends.includes(languageModel.backend as cloudBackend);

        if (isCloudLanguageModel) {
            if (selectedLanguageModelIdRef.current === id) {
                setSelectedLanguageModelId(null);
                addToastRef.current(`Cloud language model ${languageModel.name} deselected`, "info");
            } else {
                await unloadOtherRunningLanguageModels(id);
                setSelectedLanguageModelId(id);
                deactivateActiveBudgetStrategy();
                addToastRef.current(`Cloud language model ${languageModel.name} selected`, "success");
            }
            return;
        }

        const isCurrentlyRunning = runningLanguageModelsRef.current[id]?.isRunning;

        if (isCurrentlyRunning && !forceUnload) {
            try {
                addToastRef.current("Stopping language model...", "info");
                const success = await unloadLanguageModel(id);
                if (success) {
                    addToastRef.current("Language model stopped successfully", "success");
                    setSelectedLanguageModelId(prev => prev === id ? null : prev);
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Unknown error";
                addToastRef.current(`Failed to stop language model: ${message}`, "error");
            }
        }
        else if (!isCurrentlyRunning) {
            await unloadOtherRunningLanguageModels(id);
            const modelPath = languageModel.model || '';
            const args = buildModelLoadArguments(languageModel);

            try {
                addToastRef.current(`Starting language model ${languageModel.name}...`, "info");
                const response = await fetch(`${API_BASE}/language_models/load`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: languageModel.id, modelPath, args })
                });

                if (response.ok) {
                    const data = await response.json();
                    addToastRef.current(`Language model loaded on port ${data.port}`, "success");
                    setRunningLanguageModels(prev => ({ ...prev, [id]: { isRunning: true, port: data.port, status: 'ready', isIdle: false } }));
                    setSelectedLanguageModelId(id);
                    deactivateActiveBudgetStrategy();
                } else {
                    throw new Error((await response.json()).error || "Unknown error");
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : "Unknown error";
                addToastRef.current(`Failed to start language model: ${message}`, "error");
            }
        }
        else if (isCurrentlyRunning) {
            await unloadOtherRunningLanguageModels(id);
            setSelectedLanguageModelId(id);
            deactivateActiveBudgetStrategy();
            addToastRef.current(`Language model ${languageModel.name} selected`, "success");
        }
    }, [API_BASE, unloadLanguageModel, unloadOtherRunningLanguageModels, setRunningLanguageModels, deactivateActiveBudgetStrategy]);

    const deleteLanguageModel = useCallback(async (id: string) => {
        if (runningLanguageModelsRef.current[id]?.isRunning) {
            await unloadLanguageModel(id);
        }
        try {
            await deleteRawModel(id);
            await loadLanguageModelsRef.current();
            setSelectedLanguageModelId(prev => prev === id ? null : prev);
            return true;
        } catch {
            return false;
        }
    }, [unloadLanguageModel]);

    useEffect(() => {
        let cancelled = false;

        const initialLoad = async () => {
            setIsLoading(true);
            try {
                const data = await loadAllRawModels();
                if (!cancelled) setLanguageModels(data);
                await fetchLanguageModelStatusRef.current();
            } catch (e) {
                const message = e instanceof Error ? e.message : "Unknown error";
                console.error("Failed to load language models", e);
                if (!cancelled) addToastRef.current(`Failed to load language models list: ${message}`, "error");
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        initialLoad();
        const interval = setInterval(() => { void fetchLanguageModelStatusRef.current(); }, 3000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    return {
        languageModels,
        isLoading,
        saveLanguageModel,
        deleteLanguageModel,
        refresh: loadLanguageModels,
        runningLanguageModels,
        toggleLanguageModelLoad,
        unloadLanguageModel,
        unloadAllRunningLanguageModels,
        selectedLanguageModelId,
        setSelectedLanguageModelId
    };
}