// src/hooks/useCharacterResponseLock.ts
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../store/useSessionStore';

export function useCharacterResponseLock() {
    const isLoading = useSessionStore(s => s.isLoading);
    const isLoadingRef = useRef(false);

    const acquireLock = useCallback((): boolean => {
        if (isLoadingRef.current) return false;
        isLoadingRef.current = true;
        useSessionStore.setState({ isLoading: true });
        return true;
    }, []);

    const releaseLock = useCallback(() => {
        isLoadingRef.current = false;
        useSessionStore.setState({ isLoading: false });
    }, []);

    return { isLoading, isLoadingRef, acquireLock, releaseLock };
}