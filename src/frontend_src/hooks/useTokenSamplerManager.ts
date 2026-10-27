// src/frontend_src/hooks/useTokenSamplerManager.ts
import { useState } from 'react';
import type { TokenSampler } from '../types';
import { loadAllRawTokenSamplers, saveRawTokenSampler, deleteRawTokenSampler } from '../storages/serverStorage';

export function useTokenSamplerManager() {
    const [tokenSamplers, setTokenSamplers] = useState<TokenSampler[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadTokenSamplers = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawTokenSamplers();
            setTokenSamplers(data);
        } catch (error) {
            console.error("Failed to load token samplers", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Load on mount without useEffect
    useState(() => { loadTokenSamplers(); });

    const saveTokenSampler = async (tokenSampler: TokenSampler) => {
        try {
            await saveRawTokenSampler(tokenSampler);
            await loadTokenSamplers();
            return true;
        } catch (error) {
            console.error("Failed to save token samplers", error);
            return false;
        }
    };

    const deleteTokenSampler = async (id: string) => {
        try {
            await deleteRawTokenSampler(id);
            await loadTokenSamplers();
            return true;
        } catch (error) {
            console.error("Failed to delete token samplers", error);
            return false;
        }
    };

    return { tokenSamplers, isLoading, saveTokenSampler, deleteTokenSampler, refresh: loadTokenSamplers };
}