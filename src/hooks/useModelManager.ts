import { useState, useEffect } from 'react';
import type { LanguageModel } from '../types';
import { loadAllRawModels, saveRawModel, deleteRawModel } from './storage';

export function useModelManager() {
    const [models, setModels] = useState<LanguageModel[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadModels = async () => {
        setIsLoading(true);
        try {
        const data = await loadAllRawModels();
        setModels(data);
        } catch (err) {
        console.error("Failed to load models", err);
        } finally {
        setIsLoading(false);
        }
    };

    const saveModel = async (model: LanguageModel) => {
        try {
        await saveRawModel(model);
        await loadModels();
        return true;
        } catch (err) {
        console.error("Failed to save model", err);
        return false;
        }
    };

    const deleteModel = async (id: string) => {
        try {
        await deleteRawModel(id);
        await loadModels();
        return true;
        } catch (err) {
        console.error("Failed to delete model", err);
        return false;
        }
    };

    useEffect(() => {
        loadModels();
    }, []);

    return { models, isLoading, saveModel, deleteModel, refresh: loadModels };
}