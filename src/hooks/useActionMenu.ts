// src/hooks/useActionMenu.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Character, InteractionData, InterjectableAction } from '../types';
import { loadInterjectableActions, saveInterjectableActions, loadActionFormatData, saveActionFormatData } from '../storage/serverStorage';

type ActionWrap = '*' | '()' | 'none';
type ActionCase = 'first' | 'pascal' | 'lower';
type ActionPunctuation = '.' | '-' | 'none';

function formatActionString(label: string, targetName: string, wrap: ActionWrap, casing: ActionCase, punctuation: ActionPunctuation): string {
    let result = label;

    switch (casing) {
        case 'first':
            result = result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
            break;
        case 'pascal':
            result = result.replace(/\b\w/g, c => c.toUpperCase());
            break;
        case 'lower':
            result = result.toLowerCase();
            break;
    }

    result = `${result} ${targetName}`;

    switch (punctuation) {
        case '.':
            result += '.';
            break;
        case '-':
            result += '-';
            break;
        case 'none':
            break;
    }

    switch (wrap) {
        case '*':
            result = `*${result}*`;
            break;
        case '()':
            result = `(${result})`;
            break;
        case 'none':
            break;
    }

    return result;
}

interface UseActionMenuOptions {
    interactionData: InteractionData | null;
    currentCharacter: Character | null;
    isLoading: boolean;
    isModelReady: boolean;
    allCharacters: Character[];
    stopGeneration: () => void;
    sendActionAndGetResponse: (actionText: string, targetChar: Character, protagonist: Character) => Promise<void>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useActionMenu(options: UseActionMenuOptions) {
    const {
        interactionData, currentCharacter, isLoading, stopGeneration, sendActionAndGetResponse, addToast,
    } = options;

    const [actionMenuTarget, setActionMenuTarget] = useState<{ messageId: string; charId: string; x: number; y: number } | null>(null);
    const [menuSearchQuery, setMenuSearchQuery] = useState('');
    const [actions, setActions] = useState<InterjectableAction[]>([]);
    const [actionsLoading, setActionsLoading] = useState(true);
    const [showActionFormat, setShowActionFormat] = useState(false);

    // Action formatting state — initialized clean, populated async from server
    const [actionWrap, setActionWrap] = useState<ActionWrap>('*');
    const [actionCase, setActionCase] = useState<ActionCase>('first');
    const [actionPunctuation, setActionPunctuation] = useState<ActionPunctuation>('.');

    // Track whether initial load has completed to avoid saving defaults back to server
    const formatLoadedRef = useRef(false);

    // Load action format preferences from server on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await loadActionFormatData();
                if (cancelled) return;

                if (data.actionWrap === '*' || data.actionWrap === '()' || data.actionWrap === 'none') {
                    setActionWrap(data.actionWrap);
                }
                if (data.actionCase === 'first' || data.actionCase === 'pascal' || data.actionCase === 'lower') {
                    setActionCase(data.actionCase);
                }
                if (data.actionPunctuation === '.' || data.actionPunctuation === '-' || data.actionPunctuation === 'none') {
                    setActionPunctuation(data.actionPunctuation);
                }
            } catch (e) {
                console.warn('Failed to load action format preferences:', e);
            } finally {
                if (!cancelled) formatLoadedRef.current = true;
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Persist action formatting to server on change (only after initial load)
    useEffect(() => {
        if (!formatLoadedRef.current) return;
        saveActionFormatData({
            actionWrap,
            actionCase,
            actionPunctuation,
        }).catch(e => console.warn('Failed to save action format:', e));
    }, [actionWrap, actionCase, actionPunctuation]);

    // Load interjectable actions on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const loaded = await loadInterjectableActions();
                if (!cancelled) setActions(loaded);
            } catch (e) {
                console.warn('Failed to load interjectable actions:', e);
            } finally {
                if (!cancelled) setActionsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Debounced save for actions — coalesces rapid mutations into single server write
    const actionsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleActionsSave = useCallback((actionsToSave: InterjectableAction[]) => {
        if (actionsSaveTimerRef.current !== null) {
            clearTimeout(actionsSaveTimerRef.current);
        }
        actionsSaveTimerRef.current = setTimeout(() => {
            actionsSaveTimerRef.current = null;
            saveInterjectableActions(actionsToSave).catch(e =>
                console.warn('Failed to save interjectable actions:', e)
            );
        }, 500);
    }, []);

    // Cleanup debounce timer on unmount
    useEffect(() => {
        return () => {
            if (actionsSaveTimerRef.current !== null) {
                clearTimeout(actionsSaveTimerRef.current);
            }
        };
    }, []);

    const incrementActionCount = useCallback(async (label: string) => {
        setActions(prev => {
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
        if (actions.some(a => a.label.toLowerCase() === trimmed.toLowerCase())) {
            addToast(`Action "${trimmed}" already exists.`, 'info');
            return;
        }
        const next = [...actions, { label: trimmed, count: 0 }];
        setActions(next);
        scheduleActionsSave(next);
        setMenuSearchQuery('');
        addToast(`Added action "${trimmed}".`, 'success');
    }, [actions, addToast, scheduleActionsSave]);

    const handleDeleteAction = useCallback((label: string) => {
        const next = actions.filter(a => a.label !== label);
        setActions(next);
        scheduleActionsSave(next);
        addToast(`Removed action "${label}".`, 'info');
    }, [actions, addToast, scheduleActionsSave]);

    const handleActionInterject = useCallback(async (label: string, targetChar: Character, protagonist: Character) => {
        setActionMenuTarget(null);
        setMenuSearchQuery('');
        setShowActionFormat(false);
        if (!interactionData || !currentCharacter) return;
        await incrementActionCount(label);
        if (isLoading) {
            stopGeneration();
            await new Promise(r => setTimeout(r, 200));
        }
        const formattedAction = formatActionString(label, targetChar.name, actionWrap, actionCase, actionPunctuation);
        try {
            await sendActionAndGetResponse(formattedAction, targetChar, protagonist);
        } catch {
            addToast('Failed to interject action.', 'error');
        }
    }, [interactionData, currentCharacter, isLoading, actionWrap, actionCase, actionPunctuation, incrementActionCount, stopGeneration, sendActionAndGetResponse, addToast]);

    const getFilteredActions = useCallback(() => actions
        .filter(a => a.label.toLowerCase().includes(menuSearchQuery.toLowerCase()))
        .sort((a, b) => b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label)),
    [actions, menuSearchQuery]);

    const handleAvatarClick = useCallback((e: React.MouseEvent, mid: string, char: Character) => {
        e.stopPropagation();
        setActionMenuTarget(prev => prev?.messageId === mid ? null : { messageId: mid, charId: char.id, x: e.clientX, y: e.clientY });
    }, []);

    const closeActionMenu = useCallback(() => {
        setActionMenuTarget(null);
        setMenuSearchQuery('');
        setShowActionFormat(false);
    }, []);

    return {
        actionMenuTarget,
        menuSearchQuery, setMenuSearchQuery,
        actions, actionsLoading,
        showActionFormat, setShowActionFormat,
        actionWrap, setActionWrap,
        actionCase, setActionCase,
        actionPunctuation, setActionPunctuation,
        handleAddAction,
        handleDeleteAction,
        handleActionInterject,
        getFilteredActions,
        handleAvatarClick,
        closeActionMenu,
    };
}