// src/components/ManagerModal.tsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import '../main.css';

interface ManagerModalProps<T> {
    title: string;
    localLibraryItems: T[];
    hosterOwnedItems?: T[];
    isAdministrator?: boolean;
    isOpen: boolean;
    onClose: () => void;
    onSelect?: (item: T, isHosterItem: boolean) => void;
    onDelete?: (id: string) => void;
    onCreateNew?: () => void;
    renderSubtext?: (item: T) => React.ReactNode;
    emptyMessage?: string;
    actionLabel?: string;
    orderedListMode?: boolean;
    currentOrderIds?: string[];
    onToggleOrder?: (id: string) => void;
    specialActionIcon?: string;
    onSpecialAction?: (item: T) => void;
    specialActionTooltip?: (item: T) => string;
    activeSpecialActionId?: string;
    secondaryActiveIds?: Set<string>;
}

function getSingularNoun(plural: string): string {
    if (plural.endsWith('ies')) return `${plural.slice(0, -3)}y`;
    if (plural.endsWith('s')) return plural.slice(0, -1);
    return plural;
}

function extractTextContent(node: React.ReactNode): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractTextContent).join(' ');
    if (React.isValidElement(node)) {
        return extractTextContent((node.props as { children?: React.ReactNode }).children);
    }
    return '';
}

function ManagerModalContent<T extends { id: string; name?: string; lastUpdatedTimestamp?: number; firstCreatedTimestamp?: number }>({
    title, localLibraryItems, hosterOwnedItems, isAdministrator, onClose, onSelect, onDelete, onCreateNew,
    renderSubtext, emptyMessage = "No items found.", actionLabel = "Delete",
    orderedListMode = false, currentOrderIds = [], onToggleOrder,
    specialActionIcon, onSpecialAction, specialActionTooltip, activeSpecialActionId,
    secondaryActiveIds,
}: Omit<ManagerModalProps<T>, 'isOpen'>) {
    const [searchQuery, setSearchQuery] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const hasHosterOwnedTab = hosterOwnedItems !== undefined;
    const [activeTab, setActiveTab] = useState<'localLibrary' | 'hosterOwned'>('localLibrary');

    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    const [prevActiveTab, setPrevActiveTab] = useState(activeTab);
    if (activeTab !== prevActiveTab) {
        setSearchQuery('');
        setConfirmDeleteId(null);
        setPrevActiveTab(activeTab);
    }

    const currentItems = useMemo(
        () => (activeTab === 'hosterOwned' ? (hosterOwnedItems || []) : localLibraryItems),
        [activeTab, hosterOwnedItems, localLibraryItems]
    );
    const isHosterOwnedTab = activeTab === 'hosterOwned';

    // Hoster-Owned tab: NEVER allow deletion. Items belong to the host's permanent library.
    // Local Library tab: Allow deletion if onDelete is provided.
    const canDelete = isHosterOwnedTab ? false : !!onDelete;

    // Toggle Order Logic:
    // 1. Hoster-Owned tab: Only administrators can toggle hoster items in/out of the active session.
    // 2. Local Library tab (Joiner): Joiners CANNOT toggle local items because they aren't synced to the host.
    // 3. Local Library tab (Host/Solo): Can toggle local items.
    const canToggleOrder = (() => {
        if (!orderedListMode || !onToggleOrder) return false;
        if (isHosterOwnedTab) return isAdministrator;
        return true;
    })();

    const showCreateNew = !!onCreateNew && !isHosterOwnedTab;

    const activeConfirmDeleteId = confirmDeleteId && currentItems.some(item => item.id === confirmDeleteId)
        ? confirmDeleteId
        : null;

    const singularTitle = useMemo(() => getSingularNoun(title), [title]);

    const sortedItems = useMemo(() => {
        const sorted = [...currentItems].sort((a, b) => {
            if (activeSpecialActionId) {
                if (a.id === activeSpecialActionId) return -1;
                if (b.id === activeSpecialActionId) return 1;
            }

            if (orderedListMode && currentOrderIds.length > 0) {
                const aIndex = currentOrderIds.indexOf(a.id);
                const bIndex = currentOrderIds.indexOf(b.id);
                const aInOrder = aIndex !== -1;
                const bInOrder = bIndex !== -1;
                if (aInOrder && bInOrder) { if (aIndex !== bIndex) return aIndex - bIndex; }
                else if (aInOrder && !bInOrder) return -1;
                else if (!aInOrder && bInOrder) return 1;
            }

            const aUpdated = a.lastUpdatedTimestamp ?? 0;
            const bUpdated = b.lastUpdatedTimestamp ?? 0;
            if (aUpdated !== bUpdated) return bUpdated - aUpdated;
            const aCreated = a.firstCreatedTimestamp ?? 0;
            const bCreated = b.firstCreatedTimestamp ?? 0;
            return bCreated - aCreated;
        });
        return sorted;
    }, [currentItems, orderedListMode, currentOrderIds, activeSpecialActionId]);

    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return sortedItems;
        const query = searchQuery.toLowerCase();
        return sortedItems.filter(item => {
            if (item.name?.toLowerCase().includes(query)) return true;
            if (renderSubtext) {
                const subtextNode = renderSubtext(item);
                if (typeof subtextNode === 'string') return subtextNode.toLowerCase().includes(query);
                if (subtextNode && typeof subtextNode === 'object') {
                    return extractTextContent(subtextNode).toLowerCase().includes(query);
                }
            }
            return false;
        });
    }, [sortedItems, searchQuery, renderSubtext]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    }, [onClose]);

    const handleDeleteClick = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setConfirmDeleteId(id);
    }, []);

    const handleConfirmDelete = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        onDelete?.(id);
        setConfirmDeleteId(null);
    }, [onDelete]);

    const handleCancelDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setConfirmDeleteId(null);
    }, []);

    return (
        <div className="modal-overlay" onKeyDown={handleKeyDown}>
            <div className="modal-content modal-content-manager" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <div className="modal-header-actions">
                        {showCreateNew && (
                            <button type="button" className="create-new-button" onClick={e => { e.stopPropagation(); onCreateNew!(); }} title={`Create New ${singularTitle}`}>
                                ➕ New {singularTitle}
                            </button>
                        )}
                        <button type="button" className="close-button close-button-spaced" onClick={onClose}>×</button>
                    </div>
                </div>

                {hasHosterOwnedTab && (
                    <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                        <button
                            type="button"
                            className={`entity-tab-button ${activeTab === 'localLibrary' ? 'entity-tab-button-active' : ''}`}
                            onClick={() => setActiveTab('localLibrary')}
                        >
                            💾 Local Library ({localLibraryItems.length})
                        </button>
                        <button
                            type="button"
                            className={`entity-tab-button ${activeTab === 'hosterOwned' ? 'entity-tab-button-active' : ''}`}
                            onClick={() => setActiveTab('hosterOwned')}
                        >
                            🌐 Hoster-Owned ({hosterOwnedItems?.length || 0})
                        </button>
                    </div>
                )}

                <div className="modal-search-container">
                    <input
                        ref={searchInputRef}
                        type="text"
                        className="modal-search-input"
                        placeholder={`Search ${title.toLowerCase()}.`}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onClick={e => e.stopPropagation()}
                    />
                </div>

                <div className="modal-body">
                    {filteredItems.length === 0 ? (
                        <div className="empty-state">
                            {searchQuery ? `No results found for "${searchQuery}"` : emptyMessage}
                        </div>
                    ) : (
                        <ul className="manager-list">
                            {filteredItems.map(item => {
                                const isActive = activeSpecialActionId === item.id;
                                const isSecondaryActive = secondaryActiveIds?.has(item.id) ?? false;
                                const isInCurrentOrder = currentOrderIds.includes(item.id);
                                const orderNumber = currentOrderIds.indexOf(item.id) + 1;
                                const isConfirmingDelete = activeConfirmDeleteId === item.id;

                                return (
                                    <li key={item.id} className={`manager-item ${isActive ? 'selected-item' : ''} ${isSecondaryActive && !isActive ? 'strategy-item' : ''}`}>
                                        <div
                                            className={`manager-item-main ${onSelect ? 'manager-item-main-clickable' : ''}`}
                                            onClick={() => onSelect?.(item, isHosterOwnedTab)}
                                        >
                                            <div className="manager-item-info">
                                                <div className="manager-item-title">{item.name || 'Untitled'}</div>
                                                {renderSubtext && <div className="manager-item-sub">{renderSubtext(item)}</div>}
                                            </div>
                                        </div>

                                        <div className="manager-item-actions">
                                            {canToggleOrder && (
                                                <button
                                                    type="button"
                                                    onClick={e => { e.stopPropagation(); onToggleOrder!(item.id); }}
                                                    className={`toolbar-button order-toggle-button ${isInCurrentOrder ? 'order-toggle-button-active' : ''}`}
                                                    title={isInCurrentOrder ? "Remove from active list" : "Add to active list"}
                                                >{isInCurrentOrder ? orderNumber : '+'}</button>
                                            )}

                                            {specialActionIcon && onSpecialAction && (
                                                <button
                                                    type="button"
                                                    onClick={e => { e.stopPropagation(); onSpecialAction(item); }}
                                                    className="toolbar-button special-action-button"
                                                    title={specialActionTooltip?.(item) || "Action"}
                                                >{isActive ? '⭐' : isSecondaryActive ? '★' : '☆'}</button>
                                            )}

                                            {canDelete && (
                                                isConfirmingDelete ? (
                                                    <div className="delete-confirm-group">
                                                        <button type="button" onClick={e => handleConfirmDelete(e, item.id)} className="toolbar-button delete-confirm-button" title="Confirm delete">✓</button>
                                                        <button type="button" onClick={handleCancelDelete} className="toolbar-button delete-cancel-button" title="Cancel">✕</button>
                                                    </div>
                                                ) : (
                                                    <button type="button" onClick={e => handleDeleteClick(e, item.id)} className="delete-item-button" title={actionLabel}>🗑️</button>
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

export function ManagerModal<T extends { id: string; name?: string; lastUpdatedTimestamp?: number; firstCreatedTimestamp?: number }>(props: ManagerModalProps<T>) {
    if (!props.isOpen) return null;

    return <ManagerModalContent {...props} />;
}