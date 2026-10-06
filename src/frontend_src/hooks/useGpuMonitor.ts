// frontend_src/hooks/useGpuMonitor.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { localURL } from '../../configurations';

export interface GpuStatus {
    vendor: string;
    utilizationPercent: number;
    memoryUsedMB: number;
    memoryTotalMB: number;
    temperatureC: number | null;
    powerWatts: number | null;
    name: string;
    timestamp: number;
}

const POLL_INTERVAL_MS = 1000;

export function useGpuMonitor() {
    const [status, setStatus] = useState<GpuStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const response = await fetch(`${localURL}/gpu/status`);
            if (!response.ok) {
                setError(`HTTP ${response.status}`);
                return;
            }
            const data = await response.json() as GpuStatus;
            setStatus(data);
            setError(null);
        } catch (e) {
            setError((e as Error).message);
        }
    }, []);

    useEffect(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        // Use an async IIFE so setState calls happen in a callback, not synchronously in the effect body
        let cancelled = false;
        (async () => {
            if (cancelled) return;
            await fetchStatus();
        })();

        timerRef.current = setInterval(() => {
            if (!cancelled) fetchStatus();
        }, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [fetchStatus]);

    return { status, error, refetch: fetchStatus };
}