// src/hooks/useActionMenu.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Character, InteractionData } from '../types';
import { initializeActionFormatEngine, getActionFormatEngine, type ActionWrap, type ActionCase, type ActionPunctuation } from '../services/ActionFormatEngine';
import type { useActionManager } from './useActionManager';

function formatActionString(label: string, targetName: string, wrap: ActionWrap, casing: ActionCase, punctuation: ActionPunctuation): string {
    let result = label.trim();
    const cleanTargetName = targetName.trim();

    switch (casing) {
        case 'first':
            result = result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
            break;
        case 'pascal':
            result = result.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
            break;
        case 'lower':
            result = result.toLowerCase();
            break;
    }

    result = cleanTargetName ? `${result} ${cleanTargetName}` : result;

    switch (punctuation) {
        case '.': result += '.'; break;
        case '-': result += '-'; break;
        case 'none': break;
    }

    switch (wrap) {
        case '*': result = `*${result}*`; break;
        case '()': result = `(${result})`; break;
        case 'none': break;
    }

    return result;
}

interface UseActionMenuOptions {
    actionManager: ReturnType<typeof useActionManager>;
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
        actionManager, interactionData, currentCharacter, isLoading, isModelReady,
        stopGeneration, sendActionAndGetResponse, addToast,
    } = options;

    const { allActions, actionsLoading, incrementActionCount, handleAddAction, handleDeleteAction } = actionManager;

    const [actionMenuTarget, setActionMenuTarget] = useState<{ messageId: string; charId: string; x: number; y: number } | null>(null);
    const [menuSearchQuery, setMenuSearchQuery] = useState('');
    const [showActionFormat, setShowActionFormat] = useState(false);

    const [actionWrap, setActionWrap] = useState<ActionWrap>('*');
    const [actionCase, setActionCase] = useState<ActionCase>('first');
    const [actionPunctuation, setActionPunctuation] = useState<ActionPunctuation>('.');
    const [isAutoFormat, setIsAutoFormat] = useState(false);

    const formatLoadedRef = useRef(false);

    // Load preferences from the engine on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const engine = await initializeActionFormatEngine();
            if (cancelled) return;
            
            const prefs = engine.getUIPreferences();
            setActionWrap(prefs.actionWrap);
            setActionCase(prefs.actionCase);
            setActionPunctuation(prefs.actionPunctuation);
            setIsAutoFormat(prefs.isAutoFormat);
            
            formatLoadedRef.current = true;
        })();
        return () => { cancelled = true; };
    }, []);

    // Sync UI changes back to the format engine
    useEffect(() => {
        if (!formatLoadedRef.current) return;
        getActionFormatEngine().setUIPreferences({
            actionWrap,
            actionCase,
            actionPunctuation,
            isAutoFormat,
        });
    }, [actionWrap, actionCase, actionPunctuation, isAutoFormat]);

    const handleActionInterject = useCallback(async (label: string, targetChar: Character, protagonist: Character) => {
        setActionMenuTarget(null);
        setMenuSearchQuery('');
        setShowActionFormat(false);

        if (!interactionData || !currentCharacter) return;

        if (!isModelReady) {
            addToast('Model is not ready.', 'error');
            return;
        }

        await incrementActionCount(label);
        
        if (isLoading) {
            stopGeneration();
            await new Promise(r => setTimeout(r, 100));
        }

        // Determine user's previous action wrapping style
        let prevUserWrap: ActionWrap | 'unknown' = 'unknown';
        for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
            const msg = interactionData.interactionHistory[i];
            if (msg.character.id === currentCharacter.id && msg.messageType === 'chat') {
                const text = msg.textContent;
                if (text.includes('*')) prevUserWrap = '*';
                else if (text.includes('(') && text.includes(')')) prevUserWrap = '()';
                else prevUserWrap = 'none';
                break;
            }
        }

        const engine = getActionFormatEngine();
        let wrap = actionWrap;
        let casing = actionCase;
        let punct = actionPunctuation;

        if (isAutoFormat) {
            const prediction = engine.predict(label, prevUserWrap);
            if (prediction) {
                wrap = prediction.wrap;
                casing = prediction.casing;
                punct = prediction.punctuation;
            }
        }

        const formattedAction = formatActionString(label, targetChar.name, wrap, casing, punct);
        engine.record(label, prevUserWrap, { wrap, casing, punctuation: punct });

        try {
            await sendActionAndGetResponse(formattedAction, targetChar, protagonist);
        } catch {
            addToast('Failed to interject action.', 'error');
        }
    }, [
        interactionData, currentCharacter, isLoading, isModelReady,
        actionWrap, actionCase, actionPunctuation, isAutoFormat,
        incrementActionCount, stopGeneration, sendActionAndGetResponse, addToast
    ]);

    const getFilteredActions = useCallback(() => {
        const query = menuSearchQuery.trim().toLowerCase();
        if (!query) {
            return allActions.slice().sort((a, b) => b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label));
        }
        return allActions
            .filter(a => a.label.toLowerCase().includes(query))
            .sort((a, b) => b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label));
    }, [allActions, menuSearchQuery]);

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
        allActions, actionsLoading,
        showActionFormat, setShowActionFormat,
        actionWrap, setActionWrap,
        actionCase, setActionCase,
        actionPunctuation, setActionPunctuation,
        isAutoFormat, setIsAutoFormat,
        handleAddAction,
        handleDeleteAction,
        handleActionInterject,
        getFilteredActions,
        handleAvatarClick,
        closeActionMenu,
    };
}