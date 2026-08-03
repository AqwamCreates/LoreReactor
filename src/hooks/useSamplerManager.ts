import { useState, useEffect } from 'react';
import type { Sampler } from '../types';
import { loadAllRawSamplers, saveRawSampler, deleteRawSampler } from './storage';

export function useSamplerManager() {
    const [Samplers, setSamplers] = useState<Sampler[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadSamplers = async () => {
        setIsLoading(true);
        try {
        const data = await loadAllRawSamplers();
        console.log(data)
        setSamplers(data);
        } catch (err) {
        console.error("Failed to load Samplers", err);
        } finally {
        setIsLoading(false);
        }
    };

    const saveSampler = async (Sampler: Sampler) => {
        try {
        await saveRawSampler(Sampler);
        await loadSamplers();
        return true;
        } catch (err) {
        console.error("Failed to save Sampler", err);
        return false;
        }
    };

    const deleteSampler = async (id: string) => {
        try {
        await deleteRawSampler(id);
        await loadSamplers();
        return true;
        } catch (err) {
        console.error("Failed to delete Sampler", err);
        return false;
        }
    };

    useEffect(() => {
        loadSamplers();
    }, []);

    return { Samplers, isLoading, saveSampler, deleteSampler, refresh: loadSamplers };
}