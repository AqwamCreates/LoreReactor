// src/hooks/useActiveExtensions.ts
import { useCallback, useEffect, useRef } from 'react';
import type { Extension } from '../types';
import { useSessionStore } from './useSessionStore';

const STORAGE_KEY = 'loreReactor_activeExtensionIds';

export function useActiveExtensions(allExtensions: Extension[]) {
    const activeIds = useSessionStore(s => s.activeExtensionIds);
    const prevExtensionsRef = useRef<string>('');

    // Sync when extensions list changes (e.g., after import/delete)
    useEffect(() => {
        const currentIds = allExtensions.map(e => e.id).sort().join(',');
        if (currentIds === prevExtensionsRef.current) return;
        prevExtensionsRef.current = currentIds;

        const validIds = new Set(allExtensions.map(e => e.id));
        const filtered = activeIds.filter(id => validIds.has(id));
        if (filtered.length !== activeIds.length) {
            useSessionStore.setState({ activeExtensionIds: filtered });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        }
    }, [allExtensions, activeIds]);

    const setActiveIds = useCallback((ids: string[]) => {
        useSessionStore.setState({ activeExtensionIds: ids });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    }, []);

    const activeExtensions = allExtensions.filter(e => activeIds.includes(e.id));

    return { activeExtensions, activeIds, setActiveIds };
}