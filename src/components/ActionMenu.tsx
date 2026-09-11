// src/components/ActionMenu.tsx
import type { Character, InterjectableAction } from '../types';

interface ActionMenuProps {
    actionMenuTarget: { messageId: string; charId: string; x: number; y: number } | null;
    interactionDataExists: boolean;
    menuSearchQuery: string;
    setMenuSearchQuery: (q: string) => void;
    showActionFormat: boolean;
    setShowActionFormat: (show: boolean) => void;
    actionWrap: '*' | '()' | 'none';
    setActionWrap: (w: '*' | '()' | 'none') => void;
    actionCase: 'first' | 'pascal' | 'lower';
    setActionCase: (c: 'first' | 'pascal' | 'lower') => void;
    actionPunctuation: '.' | '-' | 'none';
    setActionPunctuation: (p: '.' | '-' | 'none') => void;
    filteredActions: InterjectableAction[];
    isModelReady: boolean;
    allCharacters: Character[];
    onAddAction: (label: string) => void;
    onDeleteAction: (label: string) => void;
    onActionInterject: (label: string, targetChar: Character) => void;
}

export function ActionMenu({
    actionMenuTarget, interactionDataExists,
    menuSearchQuery, setMenuSearchQuery,
    showActionFormat, setShowActionFormat,
    actionWrap, setActionWrap,
    actionCase, setActionCase,
    actionPunctuation, setActionPunctuation,
    filteredActions, isModelReady, allCharacters,
    onAddAction, onDeleteAction, onActionInterject,
}: ActionMenuProps) {
    if (!actionMenuTarget || !interactionDataExists) return null;

    const handleInterject = (label: string) => {
        const tc = allCharacters.find(c => c.id === actionMenuTarget.charId);
        if (tc) onActionInterject(label, tc);
    };

    return (
        <div
            className="action-menu-container"
            style={{ left: `${actionMenuTarget.x + 10}px`, top: `${actionMenuTarget.y}px`, zIndex: 9999 }}
            onClick={e => e.stopPropagation()}
        >
            <div className="action-menu-header">
                <span>Interject Action</span>
                <button
                    type="button"
                    className={`action-format-toggle ${showActionFormat ? 'action-format-toggle-active' : ''}`}
                    onClick={e => { e.stopPropagation(); setShowActionFormat(!showActionFormat); }}
                >Format</button>
            </div>

            {showActionFormat ? (
                <div className="action-format-panel" onClick={e => e.stopPropagation()}>
                    <div className="action-format-row">
                        <button type="button" className={`action-format-button ${actionWrap === '*' ? 'action-format-button-active' : ''}`} onClick={() => setActionWrap('*')}>*</button>
                        <button type="button" className={`action-format-button ${actionWrap === '()' ? 'action-format-button-active' : ''}`} onClick={() => setActionWrap('()')}>()</button>
                        <button type="button" className={`action-format-button ${actionWrap === 'none' ? 'action-format-button-active' : ''}`} onClick={() => setActionWrap('none')}>None</button>
                    </div>
                    <div className="action-format-row">
                        <button type="button" className={`action-format-button ${actionCase === 'first' ? 'action-format-button-active' : ''}`} onClick={() => setActionCase('first')}>A*</button>
                        <button type="button" className={`action-format-button ${actionCase === 'pascal' ? 'action-format-button-active' : ''}`} onClick={() => setActionCase('pascal')}>A* A*</button>
                        <button type="button" className={`action-format-button ${actionCase === 'lower' ? 'action-format-button-active' : ''}`} onClick={() => setActionCase('lower')}>a*</button>
                    </div>
                    <div className="action-format-row">
                        <button type="button" className={`action-format-button ${actionPunctuation === '.' ? 'action-format-button-active' : ''}`} onClick={() => setActionPunctuation('.')}>.</button>
                        <button type="button" className={`action-format-button ${actionPunctuation === '-' ? 'action-format-button-active' : ''}`} onClick={() => setActionPunctuation('-')}>-</button>
                        <button type="button" className={`action-format-button ${actionPunctuation === 'none' ? 'action-format-button-active' : ''}`} onClick={() => setActionPunctuation('none')}>None</button>
                    </div>
                </div>
            ) : (
                <>
                    <input
                        className="action-menu-search"
                        type="text"
                        value={menuSearchQuery}
                        onChange={e => setMenuSearchQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onAddAction(menuSearchQuery); }}
                        placeholder="Filter or type new & Enter..."
                        onClick={e => e.stopPropagation()}
                    />
                    <div className="action-menu-list">
                        {filteredActions.map(action => (
                            <div
                                key={action.label}
                                className={`action-menu-item ${!isModelReady ? 'action-menu-item-disabled' : ''}`}
                                role="button"
                                tabIndex={isModelReady ? 0 : -1}
                                onClick={e => { e.stopPropagation(); if (!isModelReady) return; handleInterject(action.label); }}
                                onKeyDown={e => { if (!isModelReady) return; if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleInterject(action.label); } }}
                            >
                                <span className="action-menu-item-label">{action.label}</span>
                                <div className="action-meta-container">
                                    <span
                                        className="action-count-badge"
                                        onClick={e => { e.stopPropagation(); onDeleteAction(action.label); }}
                                        title="Click to remove action"
                                    >
                                        <span className="badge-count">{action.count || 0}</span>
                                        <span className="badge-delete">×</span>
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}