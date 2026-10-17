// src/frontend_src/hooks/useRetrievalConfigurationManager.ts
import { useState } from 'react';
import type { RetrievalConfiguration } from '../types';
import { loadAllRawRetrievalConfigurations, saveRawRetrievalConfiguration, deleteRawRetrievalConfiguration } from '../storages/serverStorage';

export function useRetrievalConfigurationManager() {
    const [retrievalConfigurations, setRetrievalConfigurations] = useState<RetrievalConfiguration[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadRetrievalConfigurations = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawRetrievalConfigurations();
            setRetrievalConfigurations(data);
        } catch (error) {
            console.error("Failed to load Retrieval Configurations", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Load on mount without useEffect
    useState(() => { loadRetrievalConfigurations(); });

    const saveRetrievalConfiguration = async (retrievalConfiguration: RetrievalConfiguration) => {
        try {
            await saveRawRetrievalConfiguration(retrievalConfiguration);
            await loadRetrievalConfigurations();
            return true;
        } catch (error) {
            console.error("Failed to save Retrieval Configuration", error);
            return false;
        }
    };

    const deleteRetrievalConfiguration = async (id: string) => {
        try {
            await deleteRawRetrievalConfiguration(id);
            await loadRetrievalConfigurations();
            return true;
        } catch (error) {
            console.error("Failed to delete Retrieval Configuration", error);
            return false;
        }
    };

    return { retrievalConfigurations, isLoading, saveRetrievalConfiguration, deleteRetrievalConfiguration, refresh: loadRetrievalConfigurations };
}