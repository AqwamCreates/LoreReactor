import React from 'react';
import './App.css';

interface ManagerItem {
    id: string;
    name: string;
    description?: string;
    last_updated_timestamp?: number;
}

interface ManagerModalProps<T extends ManagerItem> {
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
    
    // Multi-Selection Props
    selectionMode?: boolean;
    selectedIds?: string[];
    onToggleSelect?: (id: string) => void;
    onConfirmSelection?: () => void;
    confirmButtonText?: string;
}

export function ManagerModal<T extends ManagerItem>({
    title,
    items,
    isOpen,
    onClose,
    onSelect,
    onDelete,
    onCreateNew,
    renderSubtext,
    emptyMessage = `No ${title.toLowerCase()} found.`,
    actionLabel = "Delete",
    selectionMode = false,
    selectedIds = [],
    onToggleSelect,
    onConfirmSelection,
    confirmButtonText = "Confirm Selection"
    }: ManagerModalProps<T>) {
    if (!isOpen) return null;

    const sortedItems = [...items].sort((a, b) => {
        if (a.last_updated_timestamp && b.last_updated_timestamp) {
        return b.last_updated_timestamp - a.last_updated_timestamp;
        }
        return 0;
    });

    return (
        <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
            <h2>{title}</h2>
            <div className="modal-header-actions">
                {!selectionMode && (
                <button type="button" className="new-chat-btn" onClick={onCreateNew} title={`Create New ${title.slice(0, -1)}`}>
                    ➕ New {title.slice(0, -1)}
                </button>
                )}
                <button type="button" className="close-btn" onClick={onClose}>×</button>
            </div>
            </div>
            
            {/* Confirmation Bar */}
            {selectionMode && onConfirmSelection && (
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-h)' }}>
                {selectedIds.length} selected
                </span>
                <button 
                type="button" 
                className="send-button counter" 
                onClick={onConfirmSelection}
                disabled={selectedIds.length === 0}
                style={{ opacity: selectedIds.length === 0 ? 0.5 : 1 }}
                >
                {confirmButtonText}
                </button>
            </div>
            )}

            <div className="modal-body">
            {sortedItems.length === 0 ? (
                <p className="empty-state">{emptyMessage}</p>
            ) : (
                <ul className="chat-list">
                {sortedItems.map((item, index) => {
                    const selectedIndex = selectedIds.indexOf(item.id);
                    const isSelected = selectedIndex !== -1;
                    
                    return (
                    <li 
                        key={item.id} 
                        className={`chat-list-item ${isSelected ? 'selected-item' : ''}`} 
                        onClick={() => selectionMode && onToggleSelect ? onToggleSelect(item.id) : onSelect?.(item)}
                        style={{ cursor: 'pointer', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                        {/* Left Content (Text Only, No Icon) */}
                        <div className="chat-item-main" style={{ flex: 1, minWidth: 0 }}>
                        <div className="chat-item-info" style={{ width: '100%', textAlign: 'left' }}>
                            <div className="chat-item-title" style={{ textAlign: 'left' }}>{item.name}</div>
                            {renderSubtext && (
                            <div className="chat-item-sub" style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {renderSubtext(item)}
                            </div>
                            )}
                        </div>
                        </div>
                        
                        {/* Right Action (Number Badge or Delete) */}
                        <div style={{ display: 'flex', alignItems: 'center', marginLeft: '15px', flexShrink: 0 }}>
                        {selectionMode ? (
                            <div style={{ 
                            width: '24px', 
                            height: '24px', 
                            borderRadius: '50%', 
                            background: isSelected ? 'var(--accent)' : 'transparent',
                            border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                            color: isSelected ? '#fff' : 'var(--text-h)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.8rem',
                            fontWeight: 'bold'
                            }}>
                            {isSelected ? selectedIndex + 1 : '+'}
                            </div>
                        ) : onDelete ? (
                            <button 
                            type="button" 
                            className="delete-chat-btn" 
                            onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} 
                            title={`${actionLabel} ${item.name}`}
                            >
                            🗑️
                            </button>
                        ) : null}
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