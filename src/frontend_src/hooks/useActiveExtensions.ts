// src/frontend_src/hooks/useActiveExtensions.ts
import { useCallback, useEffect, useRef } from 'react';
import type { Extension } from '../types';
import { useChatStore } from './useChatStore';

export function useActiveExtensions(allExtensions: Extension[]) {
    const activeIds = useChatStore(s => s.activeExtensionIds);
    const prevExtensionsRef = useRef<string>('');

    // Sync when extensions list changes (e.g., after import/delete)
    useEffect(() => {
        const currentIds = allExtensions.map(e => e.id).sort().join(',');
        if (currentIds === prevExtensionsRef.current) return;
        prevExtensionsRef.current = currentIds;

        const validIds = new Set(allExtensions.map(e => e.id));
        const filtered = activeIds.filter(id => validIds.has(id));
        if (filtered.length !== activeIds.length) {
            useChatStore.setState({ activeExtensionIds: filtered });
        }
    }, [allExtensions, activeIds]);

    const setActiveIds = useCallback((ids: string[]) => {
        useChatStore.setState({ activeExtensionIds: ids });
    }, []);

    const activeExtensions = allExtensions.filter(e => activeIds.includes(e.id));

    return { activeExtensions, activeIds, setActiveIds };
}