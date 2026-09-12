// src/hooks/useActionMenu.ts
import { useState, useEffect, useCallback } from 'react';
import type { Character, InteractionData, InterjectableAction } from '../types';
import { loadInterjectableActions, saveInterjectableActions } from '../store/storage';

type ActionWrap = '*' | '()' | 'none';
type ActionCase = 'first' | 'pascal' | 'lower';
type ActionPunctuation = '.' | '-' | 'none';

const STORAGE_KEY_ACTION_WRAP = 'loreReactor_actionWrap';
const STORAGE_KEY_ACTION_CASE = 'loreReactor_actionCase';
const STORAGE_KEY_ACTION_PUNCTUATION = 'loreReactor_actionPunctuation';

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

    result = `${result} ${targetName}`

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
    sendActionAndGetResponse: (actionText: string, targetChar: Character) => Promise<void>;
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

    // Action formatting state — persisted to localStorage
    const [actionWrap, setActionWrap] = useState<ActionWrap>(() => {
        const saved = localStorage.getItem(STORAGE_KEY_ACTION_WRAP);
        return (saved === '*' || saved === '()' || saved === 'none') ? saved : '*';
    });
    const [actionCase, setActionCase] = useState<ActionCase>(() => {
        const saved = localStorage.getItem(STORAGE_KEY_ACTION_CASE);
        return (saved === 'first' || saved === 'pascal' || saved === 'lower') ? saved : 'first';
    });
    const [actionPunctuation, setActionPunctuation] = useState<ActionPunctuation>(() => {
        const saved = localStorage.getItem(STORAGE_KEY_ACTION_PUNCTUATION);
        return (saved === '.' || saved === '-' || saved === 'none') ? saved : '.';
    });

    // Persist action formatting to localStorage on change
    useEffect(() => { localStorage.setItem(STORAGE_KEY_ACTION_WRAP, actionWrap); }, [actionWrap]);
    useEffect(() => { localStorage.setItem(STORAGE_KEY_ACTION_CASE, actionCase); }, [actionCase]);
    useEffect(() => { localStorage.setItem(STORAGE_KEY_ACTION_PUNCTUATION, actionPunctuation); }, [actionPunctuation]);

    // Load interjectable actions on mount
    useEffect(() => {
        loadInterjectableActions()
            .then(setActions)
            .finally(() => setActionsLoading(false));
    }, []);

    // Save actions when they change
    useEffect(() => {
        if (actions.length > 0) saveInterjectableActions(actions);
    }, [actions]);

    const incrementActionCount = useCallback(async (label: string) => {
        setActions(prev => {
            const ex = prev.find(a => a.label === label);
            const na = ex ? prev.map(a => a.label === label ? { ...a, count: a.count + 1 } : a) : [...prev, { label, count: 1 }];
            saveInterjectableActions(na);
            return na;
        });
    }, []);

    const handleAddAction = useCallback((label: string) => {
        const t = label.trim();
        if (!t) return;
        if (actions.some(a => a.label.toLowerCase() === t.toLowerCase())) { addToast(`Action "${t}" already exists.`, 'info'); return; }
        const na = [...actions, { label: t, count: 0 }];
        setActions(na);
        saveInterjectableActions(na);
        setMenuSearchQuery('');
        addToast(`Added action "${t}".`, 'success');
    }, [actions, addToast]);

    const handleDeleteAction = useCallback((label: string) => {
        const na = actions.filter(a => a.label !== label);
        setActions(na);
        saveInterjectableActions(na);
        addToast(`Removed action "${label}".`, 'info');
    }, [actions, addToast]);

    const handleActionInterject = useCallback(async (label: string, targetChar: Character) => {
        setActionMenuTarget(null);
        setMenuSearchQuery('');
        setShowActionFormat(false);
        if (!interactionData || !currentCharacter) return;
        await incrementActionCount(label);
        if (isLoading) { stopGeneration(); await new Promise(r => setTimeout(r, 200)); }
        const formattedAction = formatActionString(label, targetChar.name, actionWrap, actionCase, actionPunctuation);
        try { await sendActionAndGetResponse(formattedAction, targetChar); }
        catch { addToast('Failed to interject action.', 'error'); }
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