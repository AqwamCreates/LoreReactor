// frontend-src/hooks/useActionManager.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { InterjectableAction } from '../types';
import { loadInterjectableActions, saveInterjectableActions } from '../storages/serverStorage';

export function useActionManager(addToast?: (msg: string, type: 'success' | 'error' | 'info') => void) {
    const [allActions, setAllActions] = useState<InterjectableAction[]>([]);
    const [actionsLoading, setActionsLoading] = useState(true);

    // Load actions on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const loaded = await loadInterjectableActions();
                if (!cancelled) setAllActions(loaded);
            } catch (e) {
                console.warn('Failed to load interjectable actions:', e);
            } finally {
                if (!cancelled) setActionsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const actionsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleActionsSave = useCallback((actionsToSave: InterjectableAction[]) => {
        if (actionsSaveTimerRef.current !== null) clearTimeout(actionsSaveTimerRef.current);
        actionsSaveTimerRef.current = setTimeout(() => {
            actionsSaveTimerRef.current = null;
            saveInterjectableActions(actionsToSave).catch(e =>
                console.warn('Failed to save interjectable actions:', e)
            );
        }, 500);
    }, []);

    useEffect(() => {
        return () => { 
            if (actionsSaveTimerRef.current !== null) clearTimeout(actionsSaveTimerRef.current); 
        };
    }, []);

    const incrementActionCount = useCallback(async (label: string) => {
        setAllActions(prev => {
            const existing = prev.find(a => a.label === label);
            const next = existing
                ? prev.map(a => a.label === label ? { ...a, count: a.count + 1 } : a)
                : [...prev, { label, count: 1 }];
            scheduleActionsSave(next);
            return next;
        });
    }, [scheduleActionsSave]);

    const handleAddAction = useCallback((label: string) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        if (allActions.some(a => a.label.toLowerCase() === trimmed.toLowerCase())) {
            addToast?.(`Action "${trimmed}" already exists.`, 'info');
            return;
        }
        const next = [...allActions, { label: trimmed, count: 0 }];
        setAllActions(next);
        scheduleActionsSave(next);
        addToast?.(`Added action "${trimmed}".`, 'success');
    }, [allActions, addToast, scheduleActionsSave]);

    const handleDeleteAction = useCallback((label: string) => {
        const next = allActions.filter(a => a.label !== label);
        setAllActions(next);
        scheduleActionsSave(next);
        addToast?.(`Removed action "${label}".`, 'info');
    }, [allActions, addToast, scheduleActionsSave]);

    return {
        allActions,
        actionsLoading,
        incrementActionCount,
        handleAddAction,
        handleDeleteAction,
    };
}