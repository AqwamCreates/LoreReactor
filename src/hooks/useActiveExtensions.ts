// src/hooks/useActiveExtensions.ts
import { useState, useEffect } from 'react';
import type { Extension } from '../types';

const STORAGE_KEY = 'loreReactor_activeExtensionIds';

export function useActiveExtensions(allExtensions: Extension[]) {
    const [activeIds, setActiveIds] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });

    // Sync when extensions list changes (e.g., after import/delete)
    useEffect(() => {
        const validIds = new Set(allExtensions.map(e => e.id));
        const filtered = activeIds.filter(id => validIds.has(id));
        if (filtered.length !== activeIds.length) {
            setActiveIds(filtered);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        }
    }, [allExtensions, activeIds]);

    const activeExtensions = allExtensions.filter(e => activeIds.includes(e.id));

    return { activeExtensions, activeIds };
}