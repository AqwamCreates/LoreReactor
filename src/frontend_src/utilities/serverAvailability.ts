// src/frontend_src/utilities/serverAvailability.ts

import { localURL } from '../../configurations';

let _serverAvailableCache: boolean | null = null;
let _serverCheckPromise: Promise<boolean> | null = null;

export async function isServerAvailable(): Promise<boolean> {
    if (_serverAvailableCache !== null) return _serverAvailableCache;
    if (_serverCheckPromise) return _serverCheckPromise;

    _serverCheckPromise = (async () => {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1200);
            const res = await fetch(`${localURL}/gpu/status`, {
                method: 'GET',
                signal: controller.signal,
            });
            clearTimeout(timeout);
            _serverAvailableCache = res.ok;
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
