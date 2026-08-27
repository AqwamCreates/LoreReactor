// src/components/ManagerModal.tsx
import type React from 'react';
import { useState, useMemo } from 'react';
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
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

    const sortedItems = useMemo(() => {
        const sorted = [...items].sort((a, b) => {
            if (orderedListMode && currentOrderIds.length > 0) {
                const aIndex = currentOrderIds.indexOf(a.id);
                const bIndex = currentOrderIds.indexOf(b.id);
                const aInOrder = aIndex !== -1;
                const bInOrder = bIndex !== -1;

                if (aInOrder && bInOrder) {
                    if (aIndex !== bIndex) return aIndex - bIndex;
                } else if (aInOrder && !bInOrder) {
                    return -1;
                } else if (!aInOrder && bInOrder) {
                    return 1;
                }
            }

            const aUpdated = a.lastUpdatedTimestamp ?? 0;
            const bUpdated = b.lastUpdatedTimestamp ?? 0;
            if (aUpdated !== bUpdated) return bUpdated - aUpdated;

            const aCreated = a.firstCreatedTimestamp ?? 0;
            const bCreated = b.firstCreatedTimestamp ?? 0;
            return bCreated - aCreated;
        });

        return sorted;
    }, [items, orderedListMode, currentOrderIds]);

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
                } else if (subtextNode && typeof subtextNode === 'object') {
                    const extractText = (node: any): string => {
                        if (node == null || typeof node === 'boolean') return '';
                        if (typeof node === 'string' || typeof node === 'number') return String(node);
                        if (Array.isArray(node)) return node.map(extractText).join(' ');
                        if (node.props?.children) return extractText(node.props.children);
                        return '';
                    };
                    const textContent = extractText(subtextNode);
                    subtextMatch = textContent.toLowerCase().includes(query);
                }
            }

            return nameMatch || subtextMatch;
        });
    }, [sortedItems, searchQuery, renderSubtext]);

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setConfirmDeleteId(id);
    };

    const handleConfirmDelete = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        onDelete?.(id);
        setConfirmDeleteId(null);
    };

    const handleCancelDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        setConfirmDeleteId(null);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-content-manager" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>

                    <div className="modal-header-actions">
                        <button
                            type="button"
                            className="create-new-btn"
                            onClick={(e) => { e.stopPropagation(); onCreateNew(); }}
                            title={`Create New ${singularTitle}`}
                        >
                            ➕ New {singularTitle}
                        </button>

                        <button
                            type="button"
                            className="close-btn close-btn-spaced"
                            onClick={onClose}
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
                                const isConfirmingDelete = confirmDeleteId === item.id;

                                return (
                                    <li key={item.id} className={`manager-item ${isActive ? 'selected-item' : ''}`}>
                                        <div
                                            className={`manager-item-main ${onSelect ? 'manager-item-main-clickable' : ''}`}
                                            onClick={() => onSelect?.(item)}
                                        >
                                            <div className="manager-item-info">
                                                <div className="manager-item-title">{item.name || 'Untitled'}</div>
                                                {renderSubtext && <div className="manager-item-sub">{renderSubtext(item)}</div>}
                                            </div>
                                        </div>

                                        <div className="manager-item-actions">

                                            {orderedListMode && onToggleOrder && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); onToggleOrder(item.id); }}
                                                    className={`toolbar-btn order-toggle-btn ${isInCurrentOrder ? 'order-toggle-btn-active' : ''}`}
                                                    title={isInCurrentOrder ? "Remove from active list" : "Add to active list"}
                                                >
                                                    {isInCurrentOrder ? orderNumber : '+'}
                                                </button>
                                            )}

                                            {specialActionIcon && onSpecialAction && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); onSpecialAction(item.id); }}
                                                    className="toolbar-btn special-action-btn"
                                                    title={specialActionTooltip?.(item) || "Action"}
                                                >
                                                    {isActive ? '⭐' : '☆'}
                                                </button>
                                            )}

                                            {onDelete && (
                                                isConfirmingDelete ? (
                                                    <div className="delete-confirm-group">
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleConfirmDelete(e, item.id)}
                                                            className="toolbar-btn delete-confirm-btn"
                                                            title="Confirm delete"
                                                        >
                                                            ✓
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={handleCancelDelete}
                                                            className="toolbar-btn delete-cancel-btn"
                                                            title="Cancel"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => handleDeleteClick(e, item.id)}
                                                        className="delete-item-btn"
                                                        title={actionLabel}
                                                    >
                                                        🗑️
                                                    </button>
                                                )
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