// frontend_src/components/ActionMenu.tsx
import { useMemo } from 'react';
import type { Character, InterjectableAction } from '../types';

interface ActionMenuProps {
    actionMenuTarget: { x: number; y: number; charId?: string; messageId?: string } | null;
    interactionDataExists?: boolean;
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
    isAutoFormat: boolean;
    setIsAutoFormat: (auto: boolean) => void;
    filteredActions: InterjectableAction[];
    isModelReady?: boolean;
    allCharacters?: Character[];
    localProtagonist?: Character | null;
    onAddAction: (label: string) => void;
    onDeleteAction: (label: string) => void;
    onActionInterject: (label: string, targetChar?: Character, protagonist?: Character) => void;
}

export function ActionMenu({
    actionMenuTarget,
    interactionDataExists = true,
    menuSearchQuery, setMenuSearchQuery,
    showActionFormat, setShowActionFormat,
    actionWrap, setActionWrap,
    actionCase, setActionCase,
    actionPunctuation, setActionPunctuation,
    isAutoFormat, setIsAutoFormat,
    filteredActions,
    isModelReady = true,
    allCharacters = [],
    localProtagonist = null,
    onAddAction, onDeleteAction, onActionInterject,
}: ActionMenuProps) {
    if (!actionMenuTarget || !interactionDataExists) return null;

    const handleInterject = (label: string) => {
        const tc = allCharacters.find(c => c.id === actionMenuTarget.charId);
        onActionInterject(label, tc, localProtagonist ?? undefined);
    };

    // Calculate position directly inside the menu component
    const winWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const winHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const menuWidth = 190;
    const menuHeight = 250;
    const offset = 10; // Exactly 10px spacing on both sides
    const edge = 8;

    const fitsRight = actionMenuTarget.x + offset + menuWidth + edge <= winWidth;
    const fitsLeft = actionMenuTarget.x - offset - menuWidth - edge >= 0;
    const placeLeft = (!fitsRight && fitsLeft) || (!fitsRight && !fitsLeft && actionMenuTarget.x > winWidth / 2);

    let left = placeLeft ? actionMenuTarget.x - offset : actionMenuTarget.x + offset;
    const transform = placeLeft ? 'translateX(-100%)' : 'none';

    // Viewport clamping
    if (placeLeft) {
        left = Math.min(left, winWidth - edge);
        left = Math.max(edge + menuWidth, left);
    } else {
        left = Math.max(edge, left);
        left = Math.min(winWidth - menuWidth - edge, left);
    }

    let top = actionMenuTarget.y;
    if (top + menuHeight > winHeight - edge) {
        top = Math.max(edge, winHeight - menuHeight - edge);
    }
    top = Math.max(edge, top);

    return (
        <div
            className="action-menu-container"
            style={{ left: `${left}px`, top: `${top}px`, transform, zIndex: 9999 }}
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
                        <button
                            type="button"
                            className={`action-format-button ${isAutoFormat ? 'action-format-button-active' : ''}`}
                            onClick={() => setIsAutoFormat(!isAutoFormat)}
                            style={{ gridColumn: '1 / -1', fontWeight: 'bold' }}
                        >
                            {isAutoFormat ? 'Auto-Format' : 'Manual Format'}
                        </button>
                    </div>
                    <div className="action-format-row" style={{ opacity: isAutoFormat ? 0.4 : 1, pointerEvents: isAutoFormat ? 'none' : 'auto' }}>
                        <button type="button" className={`action-format-button ${actionWrap === '*' ? 'action-format-button-active' : ''}`} onClick={() => setActionWrap('*')}>*</button>
                        <button type="button" className={`action-format-button ${actionWrap === '()' ? 'action-format-button-active' : ''}`} onClick={() => setActionWrap('()')}>()</button>
                        <button type="button" className={`action-format-button ${actionWrap === 'none' ? 'action-format-button-active' : ''}`} onClick={() => setActionWrap('none')}>None</button>
                    </div>
                    <div className="action-format-row" style={{ opacity: isAutoFormat ? 0.4 : 1, pointerEvents: isAutoFormat ? 'none' : 'auto' }}>
                        <button type="button" className={`action-format-button ${actionCase === 'first' ? 'action-format-button-active' : ''}`} onClick={() => setActionCase('first')}>A*</button>
                        <button type="button" className={`action-format-button ${actionCase === 'pascal' ? 'action-format-button-active' : ''}`} onClick={() => setActionCase('pascal')}>A* A*</button>
                        <button type="button" className={`action-format-button ${actionCase === 'lower' ? 'action-format-button-active' : ''}`} onClick={() => setActionCase('lower')}>a*</button>
                    </div>
                    <div className="action-format-row" style={{ opacity: isAutoFormat ? 0.4 : 1, pointerEvents: isAutoFormat ? 'none' : 'auto' }}>
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