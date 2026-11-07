// src/frontend_src/utilities/serverAvailability.ts

import { localURL } from '../../configurations';

let _serverAvailableCache: boolean | null = null;
let _serverCheckPromise: Promise<boolean> | null = null;

/**
 * Checks whether the local backend server is reachable via the lightweight /ping endpoint.
 * Deduplicates concurrent checks and caches the result unless forceRefresh is true.
 */
export async function isServerAvailable(forceRefresh = false): Promise<boolean> {
    if (forceRefresh) {
        _serverAvailableCache = null;
    }
    if (_serverAvailableCache !== null) return _serverAvailableCache;
    if (_serverCheckPromise) return _serverCheckPromise;

    _serverCheckPromise = (async () => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1200);
            const res = await fetch(`${localURL}/ping`, {
                method: 'GET',
                signal: controller.signal,
                cache: 'no-store',
            });
            clearTimeout(timeout);
            const contentType = res.headers.get('content-type') || '';
            _serverAvailableCache = res.ok && contentType.includes('application/json');
            return _serverAvailableCache;
        } catch {
            _serverAvailableCache = false;
            return false;
        } finally {
            _serverCheckPromise = null;
        }
    })();

    return _serverCheckPromise;
}

export function setServerAvailability(available: boolean): void {
    _serverAvailableCache = available;
}

export function resetServerAvailability(): void {
    _serverAvailableCache = null;
    _serverCheckPromise = null;
}