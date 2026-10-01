// src/hooks/useCharacterResponseLock.ts
import { useCallback, useRef } from 'react';
import { useSessionStore } from './useSessionStore';

export function useCharacterResponseLock() {
    const activeLocationLocksRef = useRef<Set<string>>(new Set());
    const isLoadingRef = useRef(false);
    const isLoading = useSessionStore(s => s.isLoading);

    const acquireLock = useCallback((locationId?: string): boolean => {
        if (locationId) {
            if (activeLocationLocksRef.current.has(locationId)) return false;
            activeLocationLocksRef.current.add(locationId);
            
            const currentLoading = useSessionStore.getState().loadingLocations || {};
            useSessionStore.setState({ 
                loadingLocations: { ...currentLoading, [locationId]: true } 
            });
            return true;
        }

        if (isLoadingRef.current) return false;
        isLoadingRef.current = true;
        useSessionStore.setState({ isLoading: true });
        return true;
    }, []);

    const releaseLock = useCallback((locationId?: string) => {
        if (locationId) {
            activeLocationLocksRef.current.delete(locationId);
            
            const currentLoading = { ...(useSessionStore.getState().loadingLocations || {}) };
            delete currentLoading[locationId];
            useSessionStore.setState({ loadingLocations: currentLoading });
            return;
        }

        isLoadingRef.current = false;
        useSessionStore.setState({ isLoading: false });
    }, []);

    const isLocationLoading = useCallback((locationId: string): boolean => {
        return activeLocationLocksRef.current.has(locationId);
    }, []);

    return { 
        isLoading,
        isLoadingRef, // <--- Restored for backwards compatibility
        activeLocationLocksRef, 
        acquireLock, 
        releaseLock, 
        isLocationLoading 
    };
}