// src/frontend_src/components/ManagerModal.tsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { EntityFolder, entityType } from '../types';
import '../main.css';

interface ManagerModalProps<T> {
    title: string;
    entityType: entityType;
    localLibraryItems: T[];
    hosterOwnedItems?: T[];
    isAdministrator?: boolean;
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
    onSelectItem?: (item: T) => void;
    specialActionTooltip?: (item: T) => string;
    selectedId?: string;
    secondaryActiveIds?: Set<string>;
    
    allEntityFolders: EntityFolder[];
    onSaveEntityFolder: (folder: EntityFolder) => Promise<boolean> | void;
    onDeleteEntityFolder: (id: string) => void;
    
    activeItemId?: string | null;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
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
    if (React.isValidElement(node)) return extractTextContent((node.props as { children?: React.ReactNode }).children);
    return '';
}

export function ManagerModal<T extends { id: string; name?: string; lastUpdatedTimestamp?: number; firstCreatedTimestamp?: number }>({
    title, entityType, localLibraryItems, hosterOwnedItems, isAdministrator, onClose, onSelect, onDelete, onCreateNew,
    renderSubtext, emptyMessage = "No items found.", actionLabel = "Delete",
    orderedListMode = false, currentOrderIds = [], onToggleOrder,
    onSelectItem, specialActionTooltip, selectedId, secondaryActiveIds,
    allEntityFolders, onSaveEntityFolder, onDeleteEntityFolder,
    activeItemId, addToast,
}: Omit<ManagerModalProps<T>, 'isOpen'>) {
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [confirmDeleteType, setConfirmDeleteType] = useState<'item' | 'folder' | null>(null);
    const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
    
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    
    const [movingItemId, setMovingItemId] = useState<string | null>(null);
    const [moveDropdownRect, setMoveDropdownRect] = useState<DOMRect | null>(null);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    const hasHosterOwnedTab = hosterOwnedItems !== undefined;
    const [activeTab, setActiveTab] = useState<'localLibrary' | 'hosterOwned'>('localLibrary');

    useEffect(() => { searchInputRef.current?.focus(); }, []);
    useEffect(() => { if (renamingId) renameInputRef.current?.focus(); }, [renamingId]);

    const [prevActiveTab, setPrevActiveTab] = useState(activeTab);
    if (activeTab !== prevActiveTab) {
        setSearchQuery('');
        setConfirmDeleteId(null);
        setConfirmRemoveId(null);
        setMovingItemId(null);
        setPrevActiveTab(activeTab);
    }

    useEffect(() => {
        if (!movingItemId) return;
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.move-dropdown-portal') && !target.closest('.manager-item-button[title="Move to folder"]')) {
                setMovingItemId(null);
                setMoveDropdownRect(null);
            }
        };
        const handleScroll = () => { setMovingItemId(null); setMoveDropdownRect(null); };
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [movingItemId]);

    const currentItems = useMemo(
        () => (activeTab === 'hosterOwned' ? (hosterOwnedItems || []) : localLibraryItems),
        [activeTab, hosterOwnedItems, localLibraryItems]
    );
    const isHosterOwnedTab = activeTab === 'hosterOwned';
    const canDelete = isHosterOwnedTab ? false : !!onDelete;

    const canToggleOrder = (() => {
        if (!orderedListMode || !onToggleOrder) return false;
        if (hasHosterOwnedTab) return isHosterOwnedTab && !!isAdministrator;
        return true;
    })();

    const showCreateNew = !!onCreateNew && !isHosterOwnedTab;
    const singularTitle = useMemo(() => getSingularNoun(title), [title]);

    const typeFolders = useMemo(() => allEntityFolders.filter(f => f.entityType === entityType), [allEntityFolders, entityType]);
    
    const folderMap = useMemo(() => {
        const map = new Map<string, EntityFolder>();
        for (const f of typeFolders) map.set(f.id, f);
        return map;
    }, [typeFolders]);

    const assignedItemIds = useMemo(() => {
        const set = new Set<string>();
        for (const f of typeFolders) for (const id of f.itemIds) set.add(id);
        return set;
    }, [typeFolders]);

    const itemMap = useMemo(() => {
        const map = new Map<string, T>();
        for (const item of localLibraryItems) map.set(item.id, item);
        return map;
    }, [localLibraryItems]);

    const sortedLocalItems = useMemo(() => {
        return [...localLibraryItems].sort((a, b) => {
            const aUpdated = a.lastUpdatedTimestamp ?? 0;
            const bUpdated = b.lastUpdatedTimestamp ?? 0;
            if (aUpdated !== bUpdated) return bUpdated - aUpdated;
            return (b.firstCreatedTimestamp ?? 0) - (a.firstCreatedTimestamp ?? 0);
        });
    }, [localLibraryItems]);

    const rootItems = useMemo(() => {
        return sortedLocalItems.filter(item => !assignedItemIds.has(item.id));
    }, [sortedLocalItems, assignedItemIds]);

    // ✅ RESTORED: Unified sorting that pushes ordered items to the top naturally
    const displayItems = useMemo(() => {
        const combined: Array<{ type: 'folder'; folder: EntityFolder } | { type: 'item'; item: T }> = [
            ...typeFolders.map(f => ({ type: 'folder' as const, folder: f })),
            ...rootItems.map(i => ({ type: 'item' as const, item: i }))
        ];

        if (!orderedListMode || currentOrderIds.length === 0) return combined;

        return combined.sort((a, b) => {
            const aId = a.type === 'folder' ? a.folder.id : a.item.id;
            const bId = b.type === 'folder' ? b.folder.id : b.item.id;
            
            const aIndex = currentOrderIds.indexOf(aId);
            const bIndex = currentOrderIds.indexOf(bId);
            const aInOrder = aIndex !== -1;
            const bInOrder = bIndex !== -1;
            
            if (aInOrder && bInOrder) return aIndex - bIndex;
            if (aInOrder && !bInOrder) return -1;
            if (!aInOrder && bInOrder) return 1;
            return 0;
        });
    }, [typeFolders, rootItems, orderedListMode, currentOrderIds]);

    const getFolderNameForItem = useCallback((id: string) => {
        for (const f of typeFolders) if (f.itemIds.includes(id)) return f.name;
        return null;
    }, [typeFolders]);

    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return currentItems;
        const query = searchQuery.toLowerCase();
        return currentItems.filter(item => {
            if (item.name?.toLowerCase().includes(query)) return true;
            if (renderSubtext) {
                const subtextNode = renderSubtext(item);
                if (typeof subtextNode === 'string') return subtextNode.toLowerCase().includes(query);
                if (subtextNode && typeof subtextNode === 'object') return extractTextContent(subtextNode).toLowerCase().includes(query);
            }
            return false;
        });
    }, [currentItems, searchQuery, renderSubtext]);

    const toggleFolder = (id: string) => {
        setExpandedFolderIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleDeleteClick = (e: React.MouseEvent, id: string, type: 'item' | 'folder') => {
        e.stopPropagation();
        setConfirmDeleteId(id);
        setConfirmDeleteType(type);
    };

    const handleConfirmDelete = (e: React.MouseEvent, id: string, type: 'item' | 'folder') => {
        e.stopPropagation();
        if (type === 'item') {
            onDelete?.(id);
        } else {
            const folder = folderMap.get(id);
            if (folder) {
                for (const itemId of folder.itemIds) {
                    onDelete?.(itemId);
                }
            }
            onDeleteEntityFolder(id);
        }
        setConfirmDeleteId(null);
    };

    const handleCancelDelete = (e: React.MouseEvent) => { e.stopPropagation(); setConfirmDeleteId(null); };

    const handleToggleClick = (e: React.MouseEvent, id: string, isInOrder: boolean) => {
        e.stopPropagation();
        if (isInOrder) setConfirmRemoveId(id);
        else onToggleOrder?.(id);
    };

    const handleConfirmRemove = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        onToggleOrder?.(id);
        setConfirmRemoveId(null);
    };

    const handleCancelRemove = (e: React.MouseEvent) => { e.stopPropagation(); setConfirmRemoveId(null); };

    const handleRenameClick = (e: React.MouseEvent, id: string, currentName: string) => {
        e.stopPropagation();
        setRenamingId(id);
        setRenameValue(currentName);
    };

    const handleRenameSubmit = async (e: React.FormEvent | React.KeyboardEvent, id: string) => {
        e.preventDefault(); e.stopPropagation();
        const trimmed = renameValue.trim();
        if (!trimmed) { setRenamingId(null); return; }
        const folder = folderMap.get(id);
        if (folder) await onSaveEntityFolder({ ...folder, name: trimmed, lastUpdatedTimestamp: Date.now() });
        setRenamingId(null);
    };

    const handleMoveClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (movingItemId === id) { setMovingItemId(null); setMoveDropdownRect(null); }
        else { setMoveDropdownRect((e.currentTarget as HTMLElement).getBoundingClientRect()); setMovingItemId(id); }
    };

    const handleMoveSelect = async (e: React.MouseEvent, itemId: string, targetFolderId: string | null) => {
        e.stopPropagation();
        const updatedFolders = typeFolders.map(f => {
            const hasItem = f.itemIds.includes(itemId);
            const isTarget = f.id === targetFolderId;
            if (hasItem && !isTarget) return { ...f, itemIds: f.itemIds.filter(id => id !== itemId), lastUpdatedTimestamp: Date.now() };
            if (!hasItem && isTarget) return { ...f, itemIds: [...f.itemIds, itemId], lastUpdatedTimestamp: Date.now() };
            return f;
        });
        for (let i = 0; i < typeFolders.length; i++) {
            if (updatedFolders[i] !== typeFolders[i]) await onSaveEntityFolder(updatedFolders[i]);
        }
        addToast(targetFolderId ? 'Moved to folder.' : 'Moved to root.', 'success');
        setMovingItemId(null); setMoveDropdownRect(null);
    };

    const handleCreateFolderSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newFolderName.trim();
        if (trimmed) {
            const newFolder: EntityFolder = {
                id: uuidv4(), name: trimmed, entityType, itemIds: [],
                firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
            };
            const success = await onSaveEntityFolder(newFolder);
            if (success) addToast(`Folder "${trimmed}" created.`, 'success');
            setIsCreatingFolder(false); setNewFolderName('');
        }
    };

    const renderItemRow = (item: T) => {
        const id = item.id;
        const isInCurrentOrder = currentOrderIds.includes(id);
        const isSelectable = !!onSelectItem && (!orderedListMode || isInCurrentOrder);
        const isActive = (selectedId === id || activeItemId === id) && (!orderedListMode || isInCurrentOrder);
        const isSecondaryActive = secondaryActiveIds?.has(id) ?? false;
        const orderNumber = currentOrderIds.indexOf(id) + 1;
        const isConfirmingDelete = confirmDeleteId === id && confirmDeleteType === 'item';
        const isConfirmingRemove = confirmRemoveId === id;

        return (
            <li key={id} className={`manager-item ${isActive ? 'selected-item' : ''} ${isSecondaryActive && !isActive ? 'strategy-item' : ''}`}>
                <div className={`manager-item-main ${isSelectable ? 'manager-item-main-clickable' : ''}`} onClick={() => { if (isSelectable) onSelectItem?.(item); }}>
                    <div className="manager-item-info">
                        <div className="manager-item-title">{item.name || 'Untitled'}</div>
                        {renderSubtext && <div className="manager-item-sub">{renderSubtext(item)}</div>}
                    </div>
                </div>
                <div className="manager-item-actions">
                    {canToggleOrder && (
                        isConfirmingRemove ? (
                            <div className="delete-confirm-group">
                                <button type="button" onClick={e => handleConfirmRemove(e, id)} className="toolbar-button delete-confirm-button">✓</button>
                                <button type="button" onClick={handleCancelRemove} className="toolbar-button delete-cancel-button">✕</button>
                            </div>
                        ) : (
                            <button type="button" onClick={e => handleToggleClick(e, id, isInCurrentOrder)} className={`toolbar-button order-toggle-button ${isInCurrentOrder ? 'order-toggle-button-active' : ''}`}>
                                {isInCurrentOrder ? orderNumber : '+'}
                            </button>
                        )
                    )}

                    {activeTab === 'localLibrary' && !searchQuery.trim() && (
                        <button type="button" onClick={e => handleMoveClick(e, id)} className="manager-item-button" title="Move to folder">📁</button>
                    )}

                    {onSelect && (
                        <button type="button" onClick={e => { e.stopPropagation(); onSelect(item, isHosterOwnedTab); }} className="manager-item-button" title={specialActionTooltip?.(item) || "Edit"}>✏️</button>
                    )}

                    {canDelete && (
                        isConfirmingDelete ? (
                            <div className="delete-confirm-group">
                                <button type="button" onClick={e => handleConfirmDelete(e, id, 'item')} className="toolbar-button delete-confirm-button">✓</button>
                                <button type="button" onClick={handleCancelDelete} className="toolbar-button delete-cancel-button">✕</button>
                            </div>
                        ) : (
                            <button 
                                type="button" 
                                onClick={e => handleDeleteClick(e, id, 'item')} 
                                className="manager-item-button" 
                                title={actionLabel}
                            >
                                🗑️
                            </button>
                        )
                    )}
                </div>
            </li>
        );
    };

    const renderFolderRow = (folder: EntityFolder) => {
        const isExpanded = expandedFolderIds.has(folder.id);
        const isRenaming = renamingId === folder.id;
        const isConfirmingDelete = confirmDeleteId === folder.id && confirmDeleteType === 'folder';
        const folderItems = folder.itemIds.map(id => itemMap.get(id)).filter((i): i is T => !!i);

        return (
            <li key={folder.id} className="folder-container">
                <div className="manager-item folder-row" onClick={() => toggleFolder(folder.id)}>
                    <div className="manager-item-main manager-item-main-clickable">
                        <span className="folder-chevron">{isExpanded ? '▼' : '▶'}</span>
                        <div className="manager-item-info">
                            {isRenaming ? (
                                <form onSubmit={(e) => handleRenameSubmit(e, folder.id)} style={{ display: 'flex', gap: '4px', flex: 1 }} onClick={e => e.stopPropagation()}>
                                    <input ref={renameInputRef} type="text" value={renameValue} onChange={e => setRenameValue(e.target.value)} onBlur={(e) => handleRenameSubmit(e, folder.id)} onKeyDown={e => { if (e.key === 'Escape') setRenamingId(null); }} className="modal-search-input" style={{ padding: '4px 8px', minHeight: '32px', fontSize: '0.85rem' }} autoFocus />
                                </form>
                            ) : (
                                <div className="manager-item-title">📁 {folder.name}</div>
                            )}
                        </div>
                    </div>
                    <div className="manager-item-actions" onClick={e => e.stopPropagation()}>
                        <button type="button" onClick={e => handleRenameClick(e, folder.id, folder.name)} className="manager-item-button" title="Rename Folder">✏️</button>
                        {isConfirmingDelete ? (
                            <div className="delete-confirm-group">
                                <button type="button" onClick={e => handleConfirmDelete(e, folder.id, 'folder')} className="toolbar-button delete-confirm-button">✓</button>
                                <button type="button" onClick={handleCancelDelete} className="toolbar-button delete-cancel-button">✕</button>
                            </div>
                        ) : (
                            <button type="button" onClick={e => handleDeleteClick(e, folder.id, 'folder')} className="manager-item-button" title="Delete Folder">🗑️</button>
                        )}
                    </div>
                </div>
                {isExpanded && folderItems.length > 0 && (
                    <ul className="folder-children">
                        {folderItems.map(item => renderItemRow(item))}
                    </ul>
                )}
            </li>
        );
    };

    return (
        <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
            <div className="modal-content modal-content-manager" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <div className="modal-header-actions">
                        {showCreateNew && <button type="button" className="create-new-button" onClick={e => { e.stopPropagation(); onCreateNew!(); }}>➕ New {singularTitle}</button>}
                        {activeTab === 'localLibrary' && <button type="button" className="create-new-button" onClick={() => setIsCreatingFolder(true)}>📁 Folder</button>}
                        <button type="button" className="close-button close-button-spaced" onClick={onClose}>×</button>
                    </div>
                </div>

                {hasHosterOwnedTab && (
                    <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                        <button type="button" className={`entity-tab-button ${activeTab === 'localLibrary' ? 'entity-tab-button-active' : ''}`} onClick={() => setActiveTab('localLibrary')}>💾 Local Library ({localLibraryItems.length})</button>
                        <button type="button" className={`entity-tab-button ${activeTab === 'hosterOwned' ? 'entity-tab-button-active' : ''}`} onClick={() => setActiveTab('hosterOwned')}>🌐 Hoster-Owned ({hosterOwnedItems?.length || 0})</button>
                    </div>
                )}

                <div className="modal-search-container">
                    <input ref={searchInputRef} type="text" className="modal-search-input" placeholder={`Search ${title.toLowerCase()}...`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onClick={e => e.stopPropagation()} />
                </div>

                <div className="modal-body">
                    {activeTab === 'localLibrary' && isCreatingFolder && (
                        <form onSubmit={handleCreateFolderSubmit} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }} onClick={e => e.stopPropagation()}>
                            <input type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Folder name..." className="modal-search-input" style={{ flex: 1, minHeight: '36px' }} autoFocus onBlur={() => { if (!newFolderName.trim()) setIsCreatingFolder(false); }} />
                            <button type="submit" className="create-new-button" style={{ minHeight: '36px' }}>Create</button>
                        </form>
                    )}

                    {searchQuery.trim() ? (
                        filteredItems.length === 0 ? <div className="empty-state">No results found for "{searchQuery}"</div> : (
                            <ul className="manager-list">
                                {filteredItems.map(item => {
                                    const folderName = activeTab === 'localLibrary' ? getFolderNameForItem(item.id) : null;
                                    const originalSubtext = renderSubtext ? renderSubtext(item) : null;
                                    const wrappedSubtext = folderName 
                                        ? <span>📁 {folderName} • {originalSubtext}</span>
                                        : activeTab === 'localLibrary' && !assignedItemIds.has(item.id) 
                                        ? <span>📂 Root • {originalSubtext}</span>
                                        : originalSubtext;
                                    
                                    return (
                                        <li key={item.id} className={`manager-item ${item.id === activeItemId || item.id === selectedId ? 'selected-item' : ''}`}>
                                            <div className={`manager-item-main ${onSelectItem ? 'manager-item-main-clickable' : ''}`} onClick={() => onSelectItem?.(item)}>
                                                <div className="manager-item-info">
                                                    <div className="manager-item-title">{item.name || 'Untitled'}</div>
                                                    {renderSubtext && <div className="manager-item-sub">{wrappedSubtext}</div>}
                                                </div>
                                            </div>
                                            <div className="manager-item-actions">
                                                {onSelect && <button type="button" onClick={e => { e.stopPropagation(); onSelect(item, isHosterOwnedTab); }} className="manager-item-button" title="Edit">✏️</button>}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )
                    ) : (
                        <>
                            {activeTab === 'localLibrary' ? (
                                <div>
                                    {rootItems.length === 0 && typeFolders.length === 0 ? (
                                        <div className="empty-state">{emptyMessage}</div>
                                    ) : (
                                        <ul className="manager-list">
                                            {displayItems.map((entry) => {
                                                if (entry.type === 'folder') return renderFolderRow(entry.folder);
                                                return renderItemRow(entry.item);
                                            })}
                                        </ul>
                                    )}
                                </div>
                            ) : (
                                currentItems.length === 0 ? <div className="empty-state">{emptyMessage}</div> : (
                                    <ul className="manager-list">
                                        {currentItems.map(item => renderItemRow(item))}
                                    </ul>
                                )
                            )}
                        </>
                    )}
                </div>
            </div>

            {movingItemId && moveDropdownRect && activeTab === 'localLibrary' && (
                <div className="action-menu-container move-dropdown-portal" onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: moveDropdownRect.bottom + 4, right: Math.max(8, window.innerWidth - moveDropdownRect.right), zIndex: 4000, minWidth: '180px', maxWidth: 'calc(100vw - 16px)' }}>
                    <button className="action-menu-item" onClick={e => handleMoveSelect(e, movingItemId, null)}><span className="action-menu-item-label">📂 Root (Unassigned)</span></button>
                    {typeFolders.map(f => (
                        <button key={f.id} className="action-menu-item" onClick={e => handleMoveSelect(e, movingItemId, f.id)}><span className="action-menu-item-label">📁 {f.name}</span></button>
                    ))}
                </div>
            )}
        </div>
    );
}