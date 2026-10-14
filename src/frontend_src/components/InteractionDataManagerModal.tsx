// src/frontend_src/components/InteractionDataManagerModal.tsx
import type React from 'react';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { RawInteractionData, InteractionDataFolder } from '../types';
import '../main.css';

interface InteractionDataManagerModalProps {
    onClose: () => void;
    allRawInteractionDataShells: RawInteractionData[];
    allInteractionDataFolders: InteractionDataFolder[];
    
    onSwitchInteractionData: (id: string) => void;
    onDeleteInteractionData: (id: string) => void;
    onRenameInteractionData: (id: string, name: string) => void;
    onNewInteractionData?: () => void;
    
    onDeleteInteractionDataFolder: (id: string) => void;
    onCreateNewFolder?: (name: string) => void;
    onSaveInteractionDataFolder: (folder: InteractionDataFolder) => Promise<boolean>;
    
    onMoveInteractionDataToFolder: (id: string, folderId: string | null) => void;
    onInspectInteractionData?: (id: string) => void;
    
    activeInteractionDataId?: string | null;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

type DisplayItem = 
    | { type: 'folder'; folder: InteractionDataFolder; items: RawInteractionData[] }
    | { type: 'interactionData'; data: RawInteractionData };

export function InteractionDataManagerModal({
    onClose,
    allRawInteractionDataShells,
    allInteractionDataFolders,
    onSwitchInteractionData,
    onDeleteInteractionData,
    onRenameInteractionData,
    onNewInteractionData,
    onDeleteInteractionDataFolder,
    onCreateNewFolder,
    onSaveInteractionDataFolder,
    onMoveInteractionDataToFolder,
    onInspectInteractionData,
    activeInteractionDataId,
    addToast,
}: InteractionDataManagerModalProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [confirmDeleteType, setConfirmDeleteType] = useState<'interactionData' | 'folder' | null>(null);
    
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    
    // Dropdown state uses DOMRect to escape overflow:hidden clipping
    const [movingInteractionDataId, setMovingInteractionDataId] = useState<string | null>(null);
    const [moveDropdownRect, setMoveDropdownRect] = useState<DOMRect | null>(null);
    
    const searchInputRef = useRef<HTMLInputElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { searchInputRef.current?.focus(); }, []);
    useEffect(() => { if (renamingId) renameInputRef.current?.focus(); }, [renamingId]);

    // Global listener to close dropdown on outside click or scroll
    useEffect(() => {
        if (!movingInteractionDataId) return;

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.move-dropdown-portal') && !target.closest('.manager-item-button[title="Move to folder"]')) {
                setMovingInteractionDataId(null);
                setMoveDropdownRect(null);
            }
        };

        const handleScroll = () => {
            setMovingInteractionDataId(null);
            setMoveDropdownRect(null);
        };

        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScroll, true);
        
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [movingInteractionDataId]);

    const dataMap = useMemo(() => {
        const map = new Map<string, RawInteractionData>();
        for (const shell of allRawInteractionDataShells) if (shell.id) map.set(shell.id, shell);
        return map;
    }, [allRawInteractionDataShells]);

    const folderMap = useMemo(() => {
        const map = new Map<string, InteractionDataFolder>();
        for (const f of allInteractionDataFolders) map.set(f.id, f);
        return map;
    }, [allInteractionDataFolders]);

    const assignedDataIds = useMemo(() => {
        const set = new Set<string>();
        for (const f of allInteractionDataFolders) for (const id of f.interactionDataIds) set.add(id);
        return set;
    }, [allInteractionDataFolders]);

    const isInteractionDataABranchStem = useCallback((id: string) => {
        return allRawInteractionDataShells.some(shell => shell.parentInteractionDataId === id);
    }, [allRawInteractionDataShells]);

    const rootItems = useMemo(() => {
        const items: DisplayItem[] = [];
        for (const folder of allInteractionDataFolders) {
            const folderItems = folder.interactionDataIds
                .map(id => dataMap.get(id))
                .filter((c): c is RawInteractionData => !!c)
                .sort((a, b) => (b.lastUpdatedTimestamp ?? 0) - (a.lastUpdatedTimestamp ?? 0));
            items.push({ type: 'folder', folder, items: folderItems });
        }
        for (const shell of allRawInteractionDataShells) {
            if (shell.id && !assignedDataIds.has(shell.id)) items.push({ type: 'interactionData', data: shell });
        }
        items.sort((a, b) => {
            const aTime = a.type === 'folder' ? Math.max(a.folder.lastUpdatedTimestamp ?? 0, ...a.items.map(c => c.lastUpdatedTimestamp ?? 0)) : a.data.lastUpdatedTimestamp ?? 0;
            const bTime = b.type === 'folder' ? Math.max(b.folder.lastUpdatedTimestamp ?? 0, ...b.items.map(c => c.lastUpdatedTimestamp ?? 0)) : b.data.lastUpdatedTimestamp ?? 0;
            return bTime - aTime;
        });
        return items;
    }, [allInteractionDataFolders, allRawInteractionDataShells, dataMap, assignedDataIds]);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const query = searchQuery.toLowerCase();
        return allRawInteractionDataShells
            .filter(shell => shell.name?.toLowerCase().includes(query))
            .sort((a, b) => (b.lastUpdatedTimestamp ?? 0) - (a.lastUpdatedTimestamp ?? 0));
    }, [allRawInteractionDataShells, searchQuery]);

    const getFolderNameForData = useCallback((id: string) => {
        for (const f of allInteractionDataFolders) if (f.interactionDataIds.includes(id)) return f.name;
        return null;
    }, [allInteractionDataFolders]);

    const toggleFolder = (id: string) => {
        setExpandedFolderIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleDeleteClick = (e: React.MouseEvent, id: string, type: 'interactionData' | 'folder') => {
        e.stopPropagation();
        setConfirmDeleteId(id);
        setConfirmDeleteType(type);
    };

    const handleConfirmDelete = (e: React.MouseEvent, id: string, type: 'interactionData' | 'folder') => {
        e.stopPropagation();
        if (type === 'interactionData') {
            if (isInteractionDataABranchStem(id)) {
                addToast('Cannot delete: Other sessions branch from this interaction data.', 'error');
                setConfirmDeleteId(null);
                return;
            }
            onDeleteInteractionData(id);
        } else {
            const folder = folderMap.get(id);
            if (folder?.interactionDataIds.some(dataId => isInteractionDataABranchStem(dataId))) {
                addToast('Cannot delete folder: It contains interaction data that other sessions branch from.', 'error');
                setConfirmDeleteId(null);
                return;
            }
            onDeleteInteractionDataFolder(id);
        }
        setConfirmDeleteId(null);
    };

    const handleCancelDelete = (e: React.MouseEvent) => { e.stopPropagation(); setConfirmDeleteId(null); };

    const handleRenameClick = (e: React.MouseEvent, id: string, currentName: string) => {
        e.stopPropagation();
        setRenamingId(id);
        setRenameValue(currentName);
    };

    const handleRenameSubmit = (e: React.FormEvent | React.KeyboardEvent, id: string) => {
        e.preventDefault(); e.stopPropagation();
        const trimmed = renameValue.trim();
        if (!trimmed) { setRenamingId(null); return; }
        if (folderMap.has(id)) {
            const folder = folderMap.get(id)!;
            onSaveInteractionDataFolder({ ...folder, name: trimmed, lastUpdatedTimestamp: Date.now() });
        } else {
            onRenameInteractionData(id, trimmed);
        }
        setRenamingId(null);
    };

    const handleMoveClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (movingInteractionDataId === id) {
            setMovingInteractionDataId(null);
            setMoveDropdownRect(null);
        } else {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMoveDropdownRect(rect);
            setMovingInteractionDataId(id);
        }
    };

    const handleMoveSelect = (e: React.MouseEvent, id: string, folderId: string | null) => {
        e.stopPropagation();
        onMoveInteractionDataToFolder(id, folderId);
        setMovingInteractionDataId(null);
        setMoveDropdownRect(null);
    };

    const handleCreateFolderSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newFolderName.trim();
        if (trimmed && onCreateNewFolder) {
            onCreateNewFolder(trimmed);
            setIsCreatingFolder(false);
            setNewFolderName('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };

    const renderActions = (id: string, name: string, type: 'interactionData' | 'folder') => {
        const isConfirming = confirmDeleteId === id && confirmDeleteType === type;
        const isRenaming = renamingId === id && type === 'folder'; 

        return (
            <div className="manager-item-actions">
                {isRenaming ? (
                    <form onSubmit={(e) => handleRenameSubmit(e, id)} style={{ display: 'flex', gap: '4px', flex: 1 }} onClick={e => e.stopPropagation()}>
                        <input
                            ref={renameInputRef} type="text" value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={(e) => handleRenameSubmit(e, id)}
                            onKeyDown={e => { if (e.key === 'Escape') setRenamingId(null); }}
                            className="modal-search-input"
                            style={{ padding: '4px 8px', minHeight: '32px', fontSize: '0.85rem' }} autoFocus
                        />
                    </form>
                ) : (
                    <>
                        {type === 'interactionData' ? (
                            <button 
                                type="button" 
                                onClick={e => { e.stopPropagation(); onInspectInteractionData?.(id); }} 
                                className="manager-item-button" 
                                title="Inspect / Edit"
                            >
                                ✏️
                            </button>
                        ) : (
                            <button 
                                type="button" 
                                onClick={e => handleRenameClick(e, id, name)} 
                                className="manager-item-button" 
                                title="Rename Folder"
                            >
                                ✏️
                            </button>
                        )}

                        {type === 'interactionData' && (
                            <button 
                                type="button" 
                                onClick={e => handleMoveClick(e, id)} 
                                className="manager-item-button" 
                                title="Move to folder"
                            >
                                📁
                            </button>
                        )}

                        {isConfirming ? (
                            <div className="delete-confirm-group">
                                <button type="button" onClick={e => handleConfirmDelete(e, id, type)} className="toolbar-button delete-confirm-button" title="Confirm delete">✓</button>
                                <button type="button" onClick={handleCancelDelete} className="toolbar-button delete-cancel-button" title="Cancel">✕</button>
                            </div>
                        ) : (
                            <button type="button" onClick={e => handleDeleteClick(e, id, type)} className="manager-item-button" title="Delete">🗑️</button>
                        )}
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="modal-overlay" onKeyDown={handleKeyDown}>
            <div className="modal-content modal-content-manager" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Interaction Data</h2>
                    <div className="modal-header-actions">
                        {onNewInteractionData && <button type="button" className="create-new-button" onClick={onNewInteractionData}>➕ Session</button>}
                        {onCreateNewFolder && <button type="button" className="create-new-button" onClick={() => setIsCreatingFolder(true)}>📁 Folder</button>}
                        <button type="button" className="close-button close-button-spaced" onClick={onClose}>×</button>
                    </div>
                </div>

                <div className="modal-search-container">
                    <input ref={searchInputRef} type="text" className="modal-search-input" placeholder="Search interaction data..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onClick={e => e.stopPropagation()} />
                </div>

                <div className="modal-body">
                    {isCreatingFolder && (
                        <form onSubmit={handleCreateFolderSubmit} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }} onClick={e => e.stopPropagation()}>
                            <input type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Folder name..." className="modal-search-input" style={{ flex: 1, minHeight: '36px' }} autoFocus onBlur={() => { if (!newFolderName.trim()) setIsCreatingFolder(false); }} />
                            <button type="submit" className="create-new-button" style={{ minHeight: '36px' }}>Create</button>
                        </form>
                    )}

                    {searchQuery.trim() ? (
                        searchResults.length === 0 ? <div className="empty-state">No results found for "{searchQuery}"</div> : (
                            <ul className="manager-list">
                                {searchResults.map(data => (
                                    <li key={data.id} className={`manager-item ${data.id === activeInteractionDataId ? 'selected-item' : ''}`}>
                                        <div className="manager-item-main manager-item-main-clickable" onClick={() => { onSwitchInteractionData(data.id!); onClose(); }}>
                                            <div className="manager-item-info">
                                                <div className="manager-item-title">{data.name || 'Untitled Session'}</div>
                                                <div className="manager-item-sub">{getFolderNameForData(data.id!) ? `📁 ${getFolderNameForData(data.id!)}` : '📂 Root'}</div>
                                            </div>
                                        </div>
                                        {renderActions(data.id!, data.name || 'Untitled Session', 'interactionData')}
                                    </li>
                                ))}
                            </ul>
                        )
                    ) : (
                        rootItems.length === 0 ? <div className="empty-state">No interaction data found.</div> : (
                            <ul className="manager-list">
                                {rootItems.map(item => {
                                    if (item.type === 'folder') {
                                        const isExpanded = expandedFolderIds.has(item.folder.id);
                                        return (
                                            <li key={item.folder.id} className="folder-container">
                                                <div className="manager-item folder-row" onClick={() => toggleFolder(item.folder.id)}>
                                                    <div className="manager-item-main manager-item-main-clickable">
                                                        <span className="folder-chevron">{isExpanded ? '▼' : '▶'}</span>
                                                        <div className="manager-item-info">
                                                            <div className="manager-item-title">📁 {item.folder.name}<span className="folder-count-badge">({item.items.length})</span></div>
                                                        </div>
                                                    </div>
                                                    {renderActions(item.folder.id, item.folder.name, 'folder')}
                                                </div>
                                                {isExpanded && item.items.length > 0 && (
                                                    <ul className="folder-children">
                                                        {item.items.map(data => (
                                                            <li key={data.id} className={`manager-item chat-row-nested ${data.id === activeInteractionDataId ? 'selected-item' : ''}`}>
                                                                <div className="manager-item-main manager-item-main-clickable" onClick={() => { onSwitchInteractionData(data.id!); onClose(); }}>
                                                                    <div className="manager-item-info"><div className="manager-item-title">{data.name || 'Untitled Session'}</div></div>
                                                                </div>
                                                                {renderActions(data.id!, data.name || 'Untitled Session', 'interactionData')}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </li>
                                        );
                                    } else {
                                        return (
                                            <li key={item.data.id} className={`manager-item ${item.data.id === activeInteractionDataId ? 'selected-item' : ''}`}>
                                                <div className="manager-item-main manager-item-main-clickable" onClick={() => { onSwitchInteractionData(item.data.id!); onClose(); }}>
                                                    <div className="manager-item-info"><div className="manager-item-title">{item.data.name || 'Untitled Session'}</div></div>
                                                </div>
                                                {renderActions(item.data.id!, item.data.name || 'Untitled Session', 'interactionData')}
                                            </li>
                                        );
                                    }
                                })}
                            </ul>
                        )
                    )}
                </div>
            </div>

            {/* PORTAL DROPDOWN (Escapes overflow:hidden, uses native main.css action-menu styling) */}
            {movingInteractionDataId && moveDropdownRect && (
                <div 
                    className="action-menu-container move-dropdown-portal" 
                    onClick={e => e.stopPropagation()}
                    style={{
                        position: 'fixed',
                        top: moveDropdownRect.bottom + 4,
                        left: Math.max(8, Math.min(moveDropdownRect.left, window.innerWidth - 260)),
                        zIndex: 4000,
                        minWidth: '200px',
                        maxWidth: '280px',
                    }}
                >
                    <button 
                        className="action-menu-item" 
                        onClick={e => handleMoveSelect(e, movingInteractionDataId, null)}
                    >
                        <span className="action-menu-item-label">📂 Root (Unassigned)</span>
                    </button>
                    {allInteractionDataFolders.map(f => (
                        <button 
                            key={f.id} 
                            className="action-menu-item" 
                            onClick={e => handleMoveSelect(e, movingInteractionDataId, f.id)}
                        >
                            <span className="action-menu-item-label">📁 {f.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}