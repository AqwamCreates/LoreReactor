// frontend-src/hooks/useActiveExtensions.ts
import { useCallback, useEffect, useRef } from 'react';
import type { Extension } from '../types';
import { useSessionStore } from './useSessionStore';

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
        }
    }, [allExtensions, activeIds]);

    const setActiveIds = useCallback((ids: string[]) => {
        useSessionStore.setState({ activeExtensionIds: ids });
    }, []);

    const activeExtensions = allExtensions.filter(e => activeIds.includes(e.id));

    return { activeExtensions, activeIds, setActiveIds };
}