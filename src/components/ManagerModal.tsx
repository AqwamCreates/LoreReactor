// src/components/ManagerModal.tsx
import type React from 'react';
import './App.css'; // Reuse existing modal styles

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
    onSelect: (item: T) => void;
    onDelete: (id: string) => void;
    onCreateNew: () => void;
    renderSubtext?: (item: T) => React.ReactNode;
    emptyMessage?: string;
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
    emptyMessage = `No ${title.toLowerCase()} found.`
    }: ManagerModalProps<T>) {
    if (!isOpen) return null;

    // Sort by newest first if timestamp exists
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
                <button type="button" className="new-chat-btn" onClick={onCreateNew} title={`Create New ${title.slice(0, -1)}`}>
                ➕ New {title.slice(0, -1)}
                </button>
                <button type="button" className="close-btn" onClick={onClose}>×</button>
            </div>
            </div>
            <div className="modal-body">
            {sortedItems.length === 0 ? (
                <p className="empty-state">{emptyMessage}</p>
            ) : (
                <ul className="chat-list">
                {sortedItems.map(item => (
                    <li key={item.id} className="chat-list-item" onClick={() => onSelect(item)}>
                    <div className="chat-item-main">
                        <div className="chat-item-info">
                        <div className="chat-item-title">{item.name}</div>
                        {renderSubtext && <div className="chat-item-sub">{renderSubtext(item)}</div>}
                        </div>
                    </div>
                    <button 
                        type="button" 
                        className="delete-chat-btn" 
                        onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} 
                        title="Delete"
                    >
                        🗑️
                    </button>
                    </li>
                ))}
                </ul>
            )}
            </div>
        </div>
        </div>
    );
}