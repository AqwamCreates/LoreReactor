// src/hooks/useThrottledStream.ts
import { useRef, useCallback } from 'react';
import { useSessionStore } from './useSessionStore';

const THROTTLE_MS = 60;

export function useThrottledStream() {
    const streamingTextRef = useRef('');
    const pendingStreamingTextRef = useRef('');
    const lastFlushRef = useRef(0);
    const pendingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearPendingFlush = useCallback(() => {
        if (pendingFlushRef.current) {
            clearTimeout(pendingFlushRef.current);
            pendingFlushRef.current = null;
        }
    }, []);

    const throttledSetStreamingText = useCallback((text: string) => {
        streamingTextRef.current = text;
        pendingStreamingTextRef.current = text;

        const now = performance.now();
        const elapsed = now - lastFlushRef.current;

        if (elapsed >= THROTTLE_MS) {
            clearPendingFlush();
            lastFlushRef.current = now;
            useSessionStore.setState({ streamingText: text });
        } else if (!pendingFlushRef.current) {
            pendingFlushRef.current = setTimeout(() => {
                lastFlushRef.current = performance.now();
                useSessionStore.setState({ streamingText: pendingStreamingTextRef.current });
                pendingFlushRef.current = null;
            }, THROTTLE_MS - elapsed);
        }
    }, [clearPendingFlush]);

    const setStreamingText = useCallback((text: string) => {
        clearPendingFlush();
        streamingTextRef.current = text;
        pendingStreamingTextRef.current = text;
        lastFlushRef.current = performance.now();
        useSessionStore.setState({ streamingText: text });
    }, [clearPendingFlush]);

    const resetStream = useCallback(() => {
        clearPendingFlush();
        streamingTextRef.current = '';
        pendingStreamingTextRef.current = '';
        lastFlushRef.current = 0;
        useSessionStore.setState({ streamingText: '' });
    }, [clearPendingFlush]);

    return {
        setStreamingText,
        streamingTextRef,
        throttledSetStreamingText,
        resetStream,
    };
}