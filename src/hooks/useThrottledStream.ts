// src/hooks/useThrottledStream.ts
import { useRef, useCallback } from 'react';
import { useSessionStore } from './useSessionStore';

const THROTTLE_MS = 60;
const INITIAL_STREAM_THRESHOLD = 50;

export function useThrottledStream() {
    const streamingTextRef = useRef('');
    const pendingStreamingTextRef = useRef('');
    const lastFlushRef = useRef(0);
    const pendingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const throttledSetStreamingText = useCallback((text: string) => {
        // Always update refs immediately — these are the source of truth
        streamingTextRef.current = text;
        pendingStreamingTextRef.current = text;

        // During initial stream establishment, only update refs.
        // This prevents React re-renders from interrupting the stream connection.
        if (text.length < INITIAL_STREAM_THRESHOLD) return;

        const elapsed = performance.now() - lastFlushRef.current;
        if (elapsed >= THROTTLE_MS) {
            lastFlushRef.current = performance.now();
            useSessionStore.setState({ streamingText: text });
        } else if (!pendingFlushRef.current) {
            pendingFlushRef.current = setTimeout(() => {
                lastFlushRef.current = performance.now();
                useSessionStore.setState({ streamingText: pendingStreamingTextRef.current });
                pendingFlushRef.current = null;
            }, THROTTLE_MS - elapsed);
        }
    }, []);

    const setStreamingText = useCallback((text: string) => {
        streamingTextRef.current = text;
        pendingStreamingTextRef.current = text;
        useSessionStore.setState({ streamingText: text });
    }, []);

    const resetStream = useCallback(() => {
        useSessionStore.setState({ streamingText: '' });
        streamingTextRef.current = '';
        pendingStreamingTextRef.current = '';
        lastFlushRef.current = 0;
        if (pendingFlushRef.current) {
            clearTimeout(pendingFlushRef.current);
            pendingFlushRef.current = null;
        }
    }, []);

    return {
        setStreamingText,
        streamingTextRef,
        throttledSetStreamingText,
        resetStream,
    };
}