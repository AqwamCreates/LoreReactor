// src/components/ManagerModal.tsx
import React from 'react';
import type { Character, Context, StopPattern, Extension, LanguageModel, BudgetStrategy, ChatData } from '../types';
import './main.css';

interface ManagerModalProps<T> {
    title: string;
    items: T[];
    isOpen: boolean;
    onClose: () => void;
    onSelect?: (item: T) => void;
    onDelete?: (id: string) => void;
    onCreateNew: () => void;
    renderSubtext?: (item: T) => React.ReactNode;
    emptyMessage?: string;
    actionLabel?: string;
    orderedListMode?: boolean;
    currentOrderIds?: string[];
    onToggleOrder?: (id: string) => void;
    specialActionIcon?: string;
    onSpecialAction?: (id: string) => void;
    specialActionTooltip?: (item: T) => string;
    activeSpecialActionId?: string;
}

export function ManagerModal<T extends { id: string; name?: string }>({
    title,
    items,
    isOpen,
    onClose,
    onSelect,
    onDelete,
    onCreateNew,
    renderSubtext,
    emptyMessage = "No items found.",
    actionLabel = "Delete",
    orderedListMode = false,
    currentOrderIds = [],
    onToggleOrder,
    specialActionIcon,
    onSpecialAction,
    specialActionTooltip,
    activeSpecialActionId,
    }: ManagerModalProps<T>) {
    if (!isOpen) return null;

    // ✅ LOGIC TO HANDLE PLURALIZATION (ies -> y, s -> '')
    const get_singular_noun = (plural: string) => {
        if (plural.endsWith('ies')) {
        return plural.slice(0, -3) + 'y'; // Strategies -> Strategy
        }
        if (plural.endsWith('s')) {
        return plural.slice(0, -1); // Models -> Model
        }
        return plural; // Fallback
    };

    const singularTitle = get_singular_noun(title);

    // Get the order number for an item in the current order list
    const getOrderNumber = (id: string): number | null => {
        const index = currentOrderIds.indexOf(id);
        return index !== -1 ? index + 1 : null;
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
            <h2>{title}</h2>
            <div className="modal-header-actions">
                <button 
                type="button" 
                className="create-new-btn" 
                onClick={onCreateNew} 
                title={`Create New ${singularTitle}`}
                >
                ➕ New {singularTitle}
                </button>
                <button type="button" className="close-btn" onClick={onClose}>×</button>
            </div>
            </div>

            <div className="modal-body">
            {items.length === 0 ? (
                <div className="empty-state">{emptyMessage}</div>
            ) : (
                <ul className="manager-list">
                {items.map((item) => {
                    const isActive = activeSpecialActionId === item.id;
                    const isInCurrentOrder = currentOrderIds.includes(item.id);
                    const orderNumber = getOrderNumber(item.id);
                    
                    return (
                    <li key={item.id} className={`manager-item ${isActive ? 'selected-item' : ''}`}>
                        <div 
                        className="manager-item-main" 
                        onClick={() => onSelect?.(item)}
                        style={{ cursor: onSelect ? 'pointer' : 'default' }}
                        >
                        <div className="manager-item-info">
                            <div className="manager-item-title">{item.name || 'Untitled'}</div>
                            {renderSubtext && <div className="manager-item-sub">{renderSubtext(item)}</div>}
                        </div>
                        </div>

                        {/* ✅ Button Order: Number Order → Star → Delete */}
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            
                            {/* 1. Number Order Button (Optional) */}
                            {orderedListMode && onToggleOrder && (
                                <button
                                type="button"
                                onClick={() => onToggleOrder(item.id)}
                                className="toolbar-btn"
                                title={isInCurrentOrder ? "Remove from active list" : "Add to active list"}
                                style={{ 
                                    background: isInCurrentOrder ? 'var(--accent-bg)' : 'transparent',
                                    color: isInCurrentOrder ? 'var(--accent)' : 'var(--text-h)',
                                    border: '1px solid var(--border)',
                                    width: '32px', 
                                    height: '32px', 
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                                >
                                {isInCurrentOrder ? orderNumber : '+'}
                                </button>
                            )}

                            {/* 2. Star Button (Optional) */}
                            {specialActionIcon && onSpecialAction && (
                                <button
                                type="button"
                                onClick={() => onSpecialAction(item.id)}
                                className="toolbar-btn"
                                title={specialActionTooltip?.(item) || "Action"}
                                style={{ 
                                    width: '32px', 
                                    height: '32px', 
                                    fontSize: '0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                                >
                                {isActive ? '⭐' : '☆'}
                                </button>
                            )}

                            {/* 3. Delete Button (Always visible if onDelete provided) */}
                            {onDelete && (
                                <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                                className="delete-item-btn"
                                title={actionLabel}
                                >
                                🗑️
                                </button>
                            )}
                        </div>
                    </li>
                    );
                })}
                </ul>
            )}
            </div>
        </div>
        </div>
    );
}