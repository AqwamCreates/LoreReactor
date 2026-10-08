// frontend_src/components/ActionMenu.tsx
import { useState, useRef, useLayoutEffect, useEffect } from 'react';
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

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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
    const menuRef = useRef<HTMLDivElement>(null);
    const [measuredDimensions, setMeasuredDimensions] = useState<{ width: number; height: number }>({
        width: 190,
        height: 250,
    });

    useIsomorphicLayoutEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                setMeasuredDimensions(prev => {
                    if (prev.width !== rect.width || prev.height !== rect.height) {
                        return { width: rect.width, height: rect.height };
                    }
                    return prev;
                });
            }
        }
    }, [showActionFormat, menuSearchQuery, filteredActions.length]);

    if (!actionMenuTarget || !interactionDataExists) return null;

    const handleInterject = (label: string) => {
        const tc = allCharacters.find(c => c.id === actionMenuTarget.charId);
        onActionInterject(label, tc, localProtagonist ?? undefined);
    };

    // Find the enclosing overlay or chat container bounds
    const getBounds = () => {
        if (typeof window === 'undefined') {
            return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 };
        }
        const container = menuRef.current?.closest('.pip-overlay-container, .chat-container, #root')
            || document.querySelector('.pip-overlay-container, .chat-container, #root');

        if (container) {
            const r = container.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                return {
                    left: r.left,
                    top: r.top,
                    right: r.right,
                    bottom: r.bottom,
                    width: r.width,
                    height: r.height,
                };
            }
        }
        return {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
            width: window.innerWidth,
            height: window.innerHeight,
        };
    };

    const bounds = getBounds();
    const menuWidth = measuredDimensions.width;
    const menuHeight = measuredDimensions.height;
    const offset = 10; // Gap between cursor and menu
    const edge = 8;    // Minimum padding from container boundary

    // Calculate space to the right and left relative to the actual container boundary
    const spaceRight = bounds.right - (actionMenuTarget.x + offset);
    const spaceLeft = (actionMenuTarget.x - offset) - bounds.left;

    const fitsRight = spaceRight >= menuWidth + edge;
    const fitsLeft = spaceLeft >= menuWidth + edge;

    let placeLeft = false;

    if (!fitsRight && fitsLeft) {
        // Not enough space on the right, but fits on the left -> place on left
        placeLeft = true;
    } else if (!fitsLeft && fitsRight) {
        // Not enough space on the left, but fits on the right -> place on right
        placeLeft = false;
    } else if (!fitsRight && !fitsLeft) {
        // Neither side has enough room -> pick whichever side has more space
        placeLeft = spaceLeft > spaceRight;
    } else {
        // Both sides fit -> default to right
        placeLeft = false;
    }

    // Direct pixel positioning:
    let left = placeLeft
        ? actionMenuTarget.x - offset - menuWidth
        : actionMenuTarget.x + offset;

    // Viewport & container boundary clamping
    const minLeft = bounds.left + edge;
    const maxLeft = Math.max(minLeft, bounds.right - menuWidth - edge);
    left = Math.max(minLeft, Math.min(maxLeft, left));

    // Vertical positioning & clamping
    let top = actionMenuTarget.y;
    const minTop = bounds.top + edge;
    const maxTop = Math.max(minTop, bounds.bottom - menuHeight - edge);
    if (top + menuHeight > bounds.bottom - edge) {
        top = maxTop;
    }
    top = Math.max(minTop, Math.min(maxTop, top));

    return (
        <div
            ref={menuRef}
            className="action-menu-container"
            style={{
                left: `${left}px`,
                top: `${top}px`,
                transform: 'none',
                // Overrides CSS variables for .pip-overlay-container
                '--menu-left': `${left}px`,
                '--menu-top': `${top}px`,
                '--menu-transform': 'none',
                zIndex: 9999,
            } as React.CSSProperties}
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