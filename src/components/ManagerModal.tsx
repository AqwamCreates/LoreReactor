// src/components/ManagerModal.tsx
import React, { useState, useMemo } from 'react';
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

export function ManagerModal<T extends { id: string; name?: string; lastUpdatedTimestamp?: number; firstCreatedTimestamp?: number }>({
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
    const [searchQuery, setSearchQuery] = useState('');

    if (!isOpen) return null;

    const get_singular_noun = (plural: string) => {
        if (plural.endsWith('ies')) {
            return plural.slice(0, -3) + 'y';
        }
        if (plural.endsWith('s')) {
            return plural.slice(0, -1);
        }
        return plural;
    };

    const singularTitle = get_singular_noun(title);

    const getOrderNumber = (id: string): number | null => {
        const index = currentOrderIds.indexOf(id);
        return index !== -1 ? index + 1 : null;
    };

    // ✅ SORTING: Priority order → lastUpdatedTimestamp → firstCreatedTimestamp
    const sortedItems = useMemo(() => {
        const sorted = [...items].sort((a, b) => {
            // Priority 1: Position in currentOrderIds (lower index = higher priority)
            // Items not in the list sort after items that are in the list
            if (orderedListMode && currentOrderIds.length > 0) {
                const aIndex = currentOrderIds.indexOf(a.id);
                const bIndex = currentOrderIds.indexOf(b.id);
                const aInOrder = aIndex !== -1;
                const bInOrder = bIndex !== -1;

                if (aInOrder && bInOrder) {
                    if (aIndex !== bIndex) return aIndex - bIndex;
                } else if (aInOrder && !bInOrder) {
                    return -1; // a comes first
                } else if (!aInOrder && bInOrder) {
                    return 1; // b comes first
                }
                // Both not in order → fall through to timestamp sorting
            }

            // Priority 2: Most recently updated first
            const aUpdated = a.lastUpdatedTimestamp ?? 0;
            const bUpdated = b.lastUpdatedTimestamp ?? 0;
            if (aUpdated !== bUpdated) return bUpdated - aUpdated;

            // Priority 3: Most recently created first
            const aCreated = a.firstCreatedTimestamp ?? 0;
            const bCreated = b.firstCreatedTimestamp ?? 0;
            return bCreated - aCreated;
        });

        return sorted;
    }, [items, orderedListMode, currentOrderIds]);

    // ✅ FILTERING LOGIC (applied after sorting so search preserves sort order)
    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return sortedItems;

        const query = searchQuery.toLowerCase();
        return sortedItems.filter((item) => {
            const nameMatch = item.name?.toLowerCase().includes(query);

            let subtextMatch = false;
            if (renderSubtext) {
                const subtextNode = renderSubtext(item);
                if (typeof subtextNode === 'string') {
                    subtextMatch = subtextNode.toLowerCase().includes(query);
                } else if (subtextNode && typeof subtextNode === 'object' && 'props' in subtextNode) {
                    subtextMatch = JSON.stringify(subtextNode).toLowerCase().includes(query);
                }
            }

            return nameMatch || subtextMatch;
        });
    }, [sortedItems, searchQuery, renderSubtext]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <h2>{title}</h2>

                    <div className="modal-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                            type="button"
                            className="create-new-btn"
                            onClick={(e) => { e.stopPropagation(); onCreateNew(); }}
                            title={`Create New ${singularTitle}`}
                            style={{ whiteSpace: 'nowrap' }}
                        >
                            ➕ New {singularTitle}
                        </button>

                        <button
                            type="button"
                            className="close-btn"
                            onClick={onClose}
                            style={{ marginLeft: '4px' }}
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="modal-search-container">
                    <input
                        type="text"
                        className="modal-search-input"
                        placeholder={`Search ${title.toLowerCase()}.`}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                    />
                </div>

                <div className="modal-body">
                    {filteredItems.length === 0 ? (
                        <div className="empty-state">
                            {searchQuery ? `No results found for "${searchQuery}"` : emptyMessage}
                        </div>
                    ) : (
                        <ul className="manager-list">
                            {filteredItems.map((item) => {
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

                                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>

                                            {orderedListMode && onToggleOrder && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); onToggleOrder(item.id); }}
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
                                                        justifyContent: 'center',
                                                        flexShrink: 0
                                                    }}
                                                >
                                                    {isInCurrentOrder ? orderNumber : '+'}
                                                </button>
                                            )}

                                            {specialActionIcon && onSpecialAction && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); onSpecialAction(item.id); }}
                                                    className="toolbar-btn"
                                                    title={specialActionTooltip?.(item) || "Action"}
                                                    style={{
                                                        width: '32px',
                                                        height: '32px',
                                                        fontSize: '0.85rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        flexShrink: 0
                                                    }}
                                                >
                                                    {isActive ? '⭐' : '☆'}
                                                </button>
                                            )}

                                            {onDelete && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                                                    className="delete-item-btn"
                                                    title={actionLabel}
                                                    style={{ flexShrink: 0 }}
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