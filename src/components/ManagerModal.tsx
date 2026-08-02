// src/components/ManagerModal.tsx
import type React from 'react';
import './main.css';

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
    onCreateNew: () => void;
    
    // Core Logic
    onSelect?: (item: T) => void;       // For simple clicks (Chat List, Samplers)
    onDelete?: (id: string) => void;    // For global lists (Characters, Instructions)
    renderSubtext?: (item: T) => React.ReactNode;
    emptyMessage?: string;

    // Ordered List Logic (Participants & Instructions)
    orderedListMode?: boolean;
    currentOrderIds?: string[];
    onToggleOrder?: (id: string) => void;
    
    // Special Action (Star Icon for Protagonist/Default)
    specialActionIcon?: React.ReactNode;
    onSpecialAction?: (id: string) => void;
    specialActionTooltip?: (item: T) => string;
    activeSpecialActionId?: string;
}

export function ManagerModal<T extends ManagerItem>({
    title,
    items,
    isOpen,
    onClose,
    onCreateNew,
    onSelect,
    onDelete,
    renderSubtext,
    emptyMessage = `No ${title.toLowerCase()} found.`,
    orderedListMode = false,
    currentOrderIds = [],
    onToggleOrder,
    specialActionIcon,
    onSpecialAction,
    specialActionTooltip,
    activeSpecialActionId
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
                {/* Always show Create button if provided */}
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
                {sortedItems.map((item) => {
                    const currentIndex = currentOrderIds.indexOf(item.id);
                    const isInList = currentIndex !== -1;
                    const isSpecialActive = activeSpecialActionId === item.id;
                    
                    return (
                    <li 
                        key={item.id} 
                        className={`chat-list-item ${isInList ? 'selected-item' : ''} ${isSpecialActive ? 'special-active-item' : ''}`} 
                        onClick={() => {
                        // If ordered mode is on, toggle order. Otherwise, simple select.
                        if (orderedListMode && onToggleOrder) {
                            onToggleOrder(item.id);
                        } else {
                            onSelect?.(item);
                        }
                        }}
                        style={{ cursor: 'pointer', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                        {/* Left Content */}
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
                        
                        {/* Right Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '15px', flexShrink: 0 }}>
                        
                        {/* Special Action (Star) */}
                        {specialActionIcon && onSpecialAction && (
                            <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onSpecialAction(item.id); }}
                            title={specialActionTooltip ? specialActionTooltip(item) : 'Set Active'}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '1.2rem',
                                color: isSpecialActive ? '#ffd700' : 'var(--border)',
                                transition: 'color 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                padding: '4px'
                            }}
                            onMouseEnter={(e) => { if (!isSpecialActive) e.currentTarget.style.color = 'var(--text-h)'; }}
                            onMouseLeave={(e) => { if (!isSpecialActive) e.currentTarget.style.color = 'var(--border)'; }}
                            >
                            {specialActionIcon}
                            </button>
                        )}

                        {/* Number Badge (Ordered Mode) OR Delete Button (Standard Mode) */}
                        {orderedListMode ? (
                            <div style={{ 
                            width: '24px', 
                            height: '24px', 
                            borderRadius: '50%', 
                            background: isInList ? 'var(--accent)' : 'transparent',
                            border: `1px solid ${isInList ? 'var(--accent)' : 'var(--border)'}`,
                            color: isInList ? '#fff' : 'var(--text-h)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.8rem',
                            fontWeight: 'bold'
                            }}>
                            {isInList ? currentIndex + 1 : '+'}
                            </div>
                        ) : onDelete ? (
                            <button 
                            type="button" 
                            className="delete-chat-btn" 
                            onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} 
                            title="Delete"
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