// src/frontend_src/hooks/useCharacterResponseLock.ts
import { useCallback, useRef } from 'react';
import { useGenerationStore } from './useGenerationStore';

export function useCharacterResponseLock() {
    const activeLocationLocksRef = useRef<Set<string>>(new Set());
    const isLoadingRef = useRef(false);
    const isLoading = useGenerationStore(s => s.isLoading);

    const acquireLock = useCallback((locationId?: string): boolean => {
        if (locationId) {
            if (activeLocationLocksRef.current.has(locationId)) return false;
            activeLocationLocksRef.current.add(locationId);
            
            const currentLoading = useGenerationStore.getState().loadingLocations || {};
            useGenerationStore.setState({ 
                loadingLocations: { ...currentLoading, [locationId]: true } 
            });
            return true;
        }

        if (isLoadingRef.current) return false;
        isLoadingRef.current = true;
        useGenerationStore.setState({ isLoading: true });
        return true;
    }, []);

    const releaseLock = useCallback((locationId?: string) => {
        if (locationId) {
            activeLocationLocksRef.current.delete(locationId);
            
            const currentLoading = { ...(useGenerationStore.getState().loadingLocations || {}) };
            delete currentLoading[locationId];
            useGenerationStore.setState({ loadingLocations: currentLoading });
            return;
        }

        isLoadingRef.current = false;
        useGenerationStore.setState({ isLoading: false });
    }, []);

    const isLocationLoading = useCallback((locationId: string): boolean => {
        return activeLocationLocksRef.current.has(locationId);
    }, []);

    return { 
        isLoading,
        isLoadingRef,
        activeLocationLocksRef, 
        acquireLock, 
        releaseLock, 
        isLocationLoading 
    };
}