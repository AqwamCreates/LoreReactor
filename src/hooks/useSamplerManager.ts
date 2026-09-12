import { useState, useEffect } from 'react';
import type { Sampler } from '../types';
import { loadAllRawSamplers, saveRawSampler, deleteRawSampler } from '../store/storage';

export function useSamplerManager() {
    const [Samplers, setSamplers] = useState<Sampler[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadSamplers = async () => {
        setIsLoading(true);
        try {
        const data = await loadAllRawSamplers();
        setSamplers(data);
        } catch (error) {
        console.error("Failed to load Samplers", error);
        } finally {
        setIsLoading(false);
        }
    };

    const saveSampler = async (Sampler: Sampler) => {
        try {
        await saveRawSampler(Sampler);
        await loadSamplers();
        return true;
        } catch (error) {
        console.error("Failed to save Sampler", error);
        return false;
        }
    };

    const deleteSampler = async (id: string) => {
        try {
        await deleteRawSampler(id);
        await loadSamplers();
        return true;
        } catch (error) {
        console.error("Failed to delete Sampler", error);
        return false;
        }
    };

    useEffect(() => {
        loadSamplers();
    }, []);

    return { Samplers, isLoading, saveSampler, deleteSampler, refresh: loadSamplers };
}