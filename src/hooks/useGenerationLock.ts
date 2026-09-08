import { useState, useRef, useCallback } from 'react';

export function useGenerationLock() {
    const [isLoading, setIsLoading] = useState(false);
    const isLoadingRef = useRef(false);

    const acquireLock = useCallback((): boolean => {
        if (isLoadingRef.current) return false;
        isLoadingRef.current = true;
        setIsLoading(true);
        return true;
    }, []);

    const releaseLock = useCallback(() => {
        isLoadingRef.current = false;
        setIsLoading(false);
    }, []);

    return {
        isLoading,
        isLoadingRef,
        acquireLock,
        releaseLock,
    };
}