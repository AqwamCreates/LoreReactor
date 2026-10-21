// src/frontend_src/components/ManagerModal.tsx
import React, { useState, useMemo, useEffect, useRef } from 'react';
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
    onSaveEntityFolder: (folder: EntityFolder) => Promise<boolean>;
    onDeleteEntityFolder: (id: string) => void;
    
    activeItemId?: string | null;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

function extractTextContent(node: React.ReactNode): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractTextContent).join(' ');
    if (React.isValidElement(node)) return extractTextContent((node.props as { children?: React.ReactNode }).children);
    return '';
}

interface FilteredFolderEntry {
    type: 'folder';
    folder: EntityFolder;
    filteredItems: any[];
}

interface FilteredItemEntry {
    type: 'item';
    item: any;
}

type FilteredDisplayEntry = FilteredFolderEntry | FilteredItemEntry;

export function ManagerModal<T extends { id: string; name?: string; lastUpdatedTimestamp?: number; firstCreatedTimestamp?: number }>({
    title, entityType, localLibraryItems, hosterOwnedItems, isAdministrator, onClose, onSelect, onDelete, onCreateNew,
    renderSubtext, emptyMessage = "No items found.", actionLabel = "Delete",
    orderedListMode = false, currentOrderIds = [], onToggleOrder,
    onSelectItem, specialActionTooltip, selectedId, secondaryActiveIds,
    allEntityFolders, onSaveEntityFolder, onDeleteEntityFolder,
    activeItemId, addToast,
}: Omit<ManagerModalProps<T>, 'isOpen'>) {
    const [searchQuery, setSearchQuery] = useState('');
    const [showIds, setShowIds] = useState(false);
    
    // ✅ FIX: Expand folders containing ordered items by default on first load
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => {
        const initialSet = new Set<string>();
        if (orderedListMode && currentOrderIds && currentOrderIds.length > 0) {
            for (const folder of allEntityFolders) {
                if (folder.entityType === entityType && folder.itemIds.some(id => currentOrderIds.includes(id))) {
                    initialSet.add(folder.id);
                }
            }
        }
        return initialSet;
    });
    
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [confirmDeleteType, setConfirmDeleteType] = useState<'item' | 'folder' | null>(null);
    const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
    
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    
    const [movingItemId, setMovingItemId] = useState<string | null>(null);
    const [moveDropdownRect, setMoveDropdownRect] = useState<DOMRect | null>(null);
    
    const [folderSearchQuery, setFolderSearchQuery] = useState('');
    const folderSearchInputRef = useRef<HTMLInputElement>(null);

    const searchInputRef = useRef<HTMLInputElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);
    
    const prevSearchQueryRef = useRef('');

    const hasHosterOwnedTab = hosterOwnedItems !== undefined;
    const [activeTab, setActiveTab] = useState<'localLibrary' | 'hosterOwned'>('localLibrary');

    useEffect(() => { searchInputRef.current?.focus(); }, []);
    useEffect(() => { if (renamingId) renameInputRef.current?.focus(); }, [renamingId]);
    
    useEffect(() => {
        if (movingItemId) {
            setFolderSearchQuery('');
            setTimeout(() => folderSearchInputRef.current?.focus(), 10);
        }
    }, [movingItemId]);

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
        
        const handleScroll = (e: Event) => {
            const target = e.target as HTMLElement;
            if (target && typeof target.closest === 'function' && target.closest('.move-dropdown-portal')) {
                return;
            }
            setMovingItemId(null);
            setMoveDropdownRect(null);
        };

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

    const typeFolders = useMemo(() => {
        return allEntityFolders
            .filter(f => f.entityType === entityType)
            .sort((a, b) => {
                const aUpdated = a.lastUpdatedTimestamp ?? a.firstCreatedTimestamp ?? 0;
                const bUpdated = b.lastUpdatedTimestamp ?? b.firstCreatedTimestamp ?? 0;
                if (aUpdated !== bUpdated) return bUpdated - aUpdated;
                return (b.firstCreatedTimestamp ?? 0) - (a.firstCreatedTimestamp ?? 0);
            });
    }, [allEntityFolders, entityType]);
    
    const filteredTypeFolders = useMemo(() => {
        if (!folderSearchQuery) return typeFolders;
        const q = folderSearchQuery.toLowerCase();
        return typeFolders.filter(f => f.name?.toLowerCase().includes(q));
    }, [typeFolders, folderSearchQuery]);

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

    // ✅ FIX: Sort folders to the top based on the highest priority (lowest index) of their ordered children
    const displayItems = useMemo(() => {
        const combined: Array<{ type: 'folder'; folder: EntityFolder } | { type: 'item'; item: T }> = [
            ...typeFolders.map(f => ({ type: 'folder' as const, folder: f })),
            ...rootItems.map(i => ({ type: 'item' as const, item: i }))
        ];

        if (!orderedListMode || currentOrderIds.length === 0) return combined;

        return combined.sort((a, b) => {
            const getMinIndex = (entry: typeof combined[0]): number => {
                if (entry.type === 'folder') {
                    let minIdx = currentOrderIds.indexOf(entry.folder.id);
                    for (const itemId of entry.folder.itemIds) {
                        const idx = currentOrderIds.indexOf(itemId);
                        if (idx !== -1 && (minIdx === -1 || idx < minIdx)) {
                            minIdx = idx;
                        }
                    }
                    return minIdx;
                }
                return currentOrderIds.indexOf(entry.item.id);
            };

            const aIndex = getMinIndex(a);
            const bIndex = getMinIndex(b);
            const aInOrder = aIndex !== -1;
            const bInOrder = bIndex !== -1;

            if (aInOrder && bInOrder) return aIndex - bIndex;
            if (aInOrder && !bInOrder) return -1;
            if (!aInOrder && bInOrder) return 1;
            return 0;
        });
    }, [typeFolders, rootItems, orderedListMode, currentOrderIds]);

    // ✅ FIX: Map over displayItems directly to maintain the sorted order during search
    const searchFilteredDisplayItems = useMemo((): FilteredDisplayEntry[] => {
        const query = searchQuery.toLowerCase();
        if (!query) {
            return displayItems.map(entry => {
                if (entry.type === 'folder') {
                    const folderItems = entry.folder.itemIds.map(id => itemMap.get(id)).filter((i): i is T => !!i);
                    return { type: 'folder', folder: entry.folder, filteredItems: folderItems };
                }
                return { type: 'item', item: entry.item };
            });
        }
        
        const result: FilteredDisplayEntry[] = [];
        
        for (const entry of displayItems) {
            if (entry.type === 'folder') {
                const folder = entry.folder;
                const folderNameMatches = folder.name?.toLowerCase().includes(query) || folder.id.toLowerCase().includes(query);
                const folderItems = folder.itemIds.map(id => itemMap.get(id)).filter((i): i is T => !!i);
                
                const matchingItems = folderItems.filter(item => {
                    if (folderNameMatches) return true;
                    if (item.id.toLowerCase().includes(query)) return true;
                    if (item.name?.toLowerCase().includes(query)) return true;
                    if (renderSubtext) {
                        const subtextNode = renderSubtext(item);
                        if (typeof subtextNode === 'string') return subtextNode.toLowerCase().includes(query);
                        if (subtextNode && typeof subtextNode === 'object') return extractTextContent(subtextNode).toLowerCase().includes(query);
                    }
                    return false;
                });
                
                if (matchingItems.length > 0 || folderNameMatches) {
                    result.push({ type: 'folder', folder, filteredItems: matchingItems });
                }
            } else {
                const item = entry.item;
                const nameMatches = item.name?.toLowerCase().includes(query);
                const idMatches = item.id.toLowerCase().includes(query);
                let subtextMatches = false;
                if (renderSubtext) {
                    const subtextNode = renderSubtext(item);
                    if (typeof subtextNode === 'string') subtextMatches = subtextNode.toLowerCase().includes(query);
                    else if (subtextNode && typeof subtextNode === 'object') subtextMatches = extractTextContent(subtextNode).toLowerCase().includes(query);
                }
                
                if (nameMatches || subtextMatches || idMatches) {
                    result.push({ type: 'item', item });
                }
            }
        }
        
        return result;
    }, [searchQuery, displayItems, itemMap, renderSubtext]);

    useEffect(() => {
        const prevQuery = prevSearchQueryRef.current;
        const currentQuery = searchQuery;
        
        if (!prevQuery && currentQuery) {
            const foldersToExpand = new Set<string>();
            for (const entry of searchFilteredDisplayItems) {
                if (entry.type === 'folder' && entry.filteredItems.length > 0) {
                    foldersToExpand.add(entry.folder.id);
                }
            }
            setExpandedFolderIds(foldersToExpand);
        }
        
        prevSearchQueryRef.current = searchQuery;
    }, [searchQuery, searchFilteredDisplayItems]);

    const toggleFolder = (id: string) => {
        setExpandedFolderIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleCopyId = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(id).then(() => {
            addToast('ID copied to clipboard!', 'success');
        }).catch(() => {
            addToast('Failed to copy ID.', 'error');
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
        const trimmed = renameValue;
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
        setFolderSearchQuery('');
    };

    const handleCreateAndMove = async (folderName: string) => {
        if (!movingItemId || !folderName) return;
        const trimmedName = folderName;
        
        const newFolder: EntityFolder = {
            id: uuidv4(), 
            name: trimmedName, 
            entityType, 
            itemIds: [movingItemId],
            firstCreatedTimestamp: Date.now(), 
            lastUpdatedTimestamp: Date.now(),
        };
        
        const foldersToUpdate = typeFolders
            .filter(f => f.itemIds.includes(movingItemId))
            .map(f => ({ 
                ...f, 
                itemIds: f.itemIds.filter(id => id !== movingItemId), 
                lastUpdatedTimestamp: Date.now() 
            }));
        
        await onSaveEntityFolder(newFolder);
        
        for (const f of foldersToUpdate) {
            await onSaveEntityFolder(f);
        }
        
        addToast(`Created folder "${trimmedName}" and moved item.`, 'success');
        setMovingItemId(null);
        setMoveDropdownRect(null);
        setFolderSearchQuery('');
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
                        <div className="manager-item-sub" style={{ minHeight: '1.2em', fontSize: '0.75rem', opacity: 0.8, lineHeight: '1.2' }}>
                            {showIds ? (
                                <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all' }}>{item.id}</span>
                            ) : (
                                renderSubtext ? renderSubtext(item) : <span style={{ visibility: 'hidden' }}>.</span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="manager-item-actions">
                    <button type="button" onClick={e => handleCopyId(e, id)} className="manager-item-button" title="Copy ID">📋</button>

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

                    {activeTab === 'localLibrary' && (
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

    const renderFolderRow = (folder: EntityFolder, filteredItems?: T[]) => {
        const isExpanded = expandedFolderIds.has(folder.id);
        const isRenaming = renamingId === folder.id;
        const isConfirmingDelete = confirmDeleteId === folder.id && confirmDeleteType === 'folder';
        const itemsToRender = filteredItems ?? folder.itemIds.map(id => itemMap.get(id)).filter((i): i is T => !!i);

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
                                <>
                                    <div className="manager-item-title">📁 {folder.name}</div>
                                    <div className="manager-item-sub" style={{ minHeight: '1.2em', fontSize: '0.75rem', opacity: 0.8, lineHeight: '1.2' }}>
                                        {showIds ? (
                                            <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all' }}>{folder.id}</span>
                                        ) : (
                                            <span style={{ visibility: 'hidden' }}>.</span>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="manager-item-actions" onClick={e => e.stopPropagation()}>
                        <button type="button" onClick={e => handleCopyId(e, folder.id)} className="manager-item-button" title="Copy ID">📋</button>
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
                {isExpanded && itemsToRender.length > 0 && (
                    <ul className="folder-children" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', marginBottom: '8px', paddingLeft: '16px' }}>
                        {itemsToRender.map(item => renderItemRow(item))}
                    </ul>
                )}
            </li>
        );
    };

    const exactFolderMatch = folderSearchQuery 
        ? typeFolders.find(f => f.name.toLowerCase() === folderSearchQuery.toLowerCase()) 
        : null;

    return (
        <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
            <div className="modal-content modal-content-manager" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <div className="modal-header-actions">
                        <button 
                            type="button" 
                            className="editor-button editor-button-cancel" 
                            onClick={() => setShowIds(prev => !prev)} 
                            title={showIds ? "Showing IDs (Click to show descriptions)" : "Showing Descriptions (Click to show IDs)"}
                            style={{ fontSize: '0.75rem', padding: '6px 12px', opacity: showIds ? 1 : 0.7 }}
                        >
                            {showIds ? '🔢' : '📝'}
                        </button>
                        {showCreateNew && <button type="button" className="create-new-button" onClick={e => { e.stopPropagation(); onCreateNew!(); }}>➕</button>}
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
                    <div style={{ position: 'relative' }}>
                        <input 
                            ref={searchInputRef} 
                            type="text" 
                            className="modal-search-input" 
                            placeholder={`Search ${title.toLowerCase()}...`} 
                            value={searchQuery} 
                            onChange={e => setSearchQuery(e.target.value)} 
                            onClick={e => e.stopPropagation()} 
                            style={{ 
                                paddingTop: '12px',
                                paddingBottom: '12px',
                                paddingLeft: '14px',
                                paddingRight: searchQuery ? '40px' : '14px' 
                            }} 
                        />
                        {searchQuery && (
                            <button 
                                type="button" 
                                onClick={() => setSearchQuery('')} 
                                style={{ 
                                    position: 'absolute', 
                                    right: '8px', 
                                    top: 0,
                                    bottom: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'transparent', 
                                    border: 'none', 
                                    color: 'var(--text-h)', 
                                    cursor: 'pointer', 
                                    fontSize: '1rem', 
                                    opacity: 0.5, 
                                    padding: '0 8px', 
                                    lineHeight: 1
                                }}
                                title="Clear search"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>

                <div className="modal-body">
                    {searchQuery ? (
                        searchFilteredDisplayItems.length === 0 ? <div className="empty-state">No results found for "{searchQuery}"</div> : (
                            <ul className="manager-list">
                                {searchFilteredDisplayItems.map((entry) => {
                                    if (entry.type === 'folder') return renderFolderRow(entry.folder, entry.filteredItems);
                                    return renderItemRow(entry.item);
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
                <div 
                    className="action-menu-container move-dropdown-portal" 
                    onClick={e => e.stopPropagation()} 
                    style={{ 
                        position: 'fixed', 
                        top: moveDropdownRect.bottom + 4, 
                        right: Math.max(8, Math.min(window.innerWidth - moveDropdownRect.right, window.innerWidth - 380 - 8)), 
                        zIndex: 4000, 
                        width: '380px', 
                        maxWidth: 'calc(100vw - 16px)' 
                    }}
                >
                    <div style={{ flexShrink: 0, padding: '8px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ position: 'relative' }}>
                            <input 
                                ref={folderSearchInputRef}
                                type="text" 
                                className="action-menu-search" 
                                placeholder="Search or type new & press Enter..." 
                                value={folderSearchQuery} 
                                onChange={e => setFolderSearchQuery(e.target.value)} 
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const query = folderSearchQuery;
                                        if (!query) return;
                                        if (exactFolderMatch) {
                                            handleMoveSelect(e as any, movingItemId, exactFolderMatch.id);
                                        } else {
                                            handleCreateAndMove(query);
                                        }
                                    }
                                }}
                                onClick={e => e.stopPropagation()} 
                                style={{ 
                                    width: '100%', 
                                    boxSizing: 'border-box',
                                    paddingTop: '6px',
                                    paddingBottom: '6px',
                                    paddingLeft: '12px',
                                    paddingRight: folderSearchQuery ? '32px' : '12px', 
                                    minHeight: '32px', 
                                    fontSize: '0.75rem', 
                                    margin: 0
                                }} 
                            />
                            {folderSearchQuery && (
                                <button 
                                    type="button" 
                                    onClick={(e) => { e.stopPropagation(); setFolderSearchQuery(''); folderSearchInputRef.current?.focus(); }} 
                                    style={{ 
                                        position: 'absolute', 
                                        right: '8px', 
                                        top: 0,
                                        bottom: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: 'transparent', 
                                        border: 'none', 
                                        color: 'var(--text-h)', 
                                        cursor: 'pointer', 
                                        fontSize: '0.9rem', 
                                        opacity: 0.6, 
                                        padding: 0,
                                        width: '20px',
                                        lineHeight: 1
                                    }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="action-menu-list" onClick={e => e.stopPropagation()} style={{ maxHeight: '200px', overflowY: 'auto' }}>
                        <button className="action-menu-item" onClick={e => handleMoveSelect(e, movingItemId, null)}>
                            <span className="action-menu-item-label">Root (Unassigned)</span>
                        </button>
                        
                        {filteredTypeFolders.length > 0 ? (
                            filteredTypeFolders.map(f => (
                                <button key={f.id} className="action-menu-item" onClick={e => handleMoveSelect(e, movingItemId, f.id)}>
                                    <span className="action-menu-item-label">{f.name}</span>
                                </button>
                            ))
                        ) : folderSearchQuery && !exactFolderMatch ? (
                            <div style={{ padding: '12px', fontSize: '0.75rem', opacity: 0.7, textAlign: 'center', color: 'var(--text-h)' }}>
                                Press <kbd>Enter</kbd> to create "{folderSearchQuery}"
                            </div>
                        ) : (
                            <div style={{ padding: '12px', fontSize: '0.75rem', opacity: 0.5, textAlign: 'center', color: 'var(--text-h)' }}>
                                No folders found
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}