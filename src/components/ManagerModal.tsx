// src/components/ManagerModal.tsx
import type React from 'react';
import { useState } from 'react';
import './main.css';

interface ManagerItem {
    id: string;
    name: string;
    description?: string;
    first_created_timestamp?: number;
    last_updated_timestamp?: number;
}

interface ManagerModalProps<T extends ManagerItem> {
    title: string;
    items: T[];
    isOpen: boolean;
    onClose: () => void;
    onCreateNew: () => void;
    
    // Core Logic
    onSelect?: (item: T) => void;
    onDelete?: (id: string) => void;
    renderSubtext?: (item: T) => React.ReactNode;
    emptyMessage?: string;

    // Ordered List Logic
    orderedListMode?: boolean;
    currentOrderIds?: string[];
    onToggleOrder?: (id: string) => void;
    
    // Special Action
    specialActionIcon?: React.ReactNode;
    onSpecialAction?: (id: string) => void;
    specialActionTooltip?: (item: T) => string;
    activeSpecialActionId?: string;

    // Chat Title Editing Support
    renderTitle?: (item: T) => React.ReactNode;
    renderTitleActions?: (item: T) => React.ReactNode;
    
    // Timestamp display
    showTimestamps?: boolean;
}

// Helper to format timestamp with full words and proper pluralization
const formatTimestamp = (timestamp?: number): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    }
    if (diffHours < 24) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    if (diffDays < 7) {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
    if (diffWeeks < 4) {
        return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
    }
    if (diffMonths < 12) {
        return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    }
    return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
};

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
    activeSpecialActionId,
    renderTitle,
    renderTitleActions,
    showTimestamps = true,
}: ManagerModalProps<T>) {
    const [searchQuery, setSearchQuery] = useState('');

    if (!isOpen) return null;

    // Filter items based on search query
    const filteredItems = searchQuery.trim() 
        ? items.filter(item => 
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()))
          )
        : items;

    // Sort filtered items by last_updated_timestamp (newest first)
    const sortedItems = [...filteredItems].sort((a, b) => {
        if (a.last_updated_timestamp && b.last_updated_timestamp) {
            return b.last_updated_timestamp - a.last_updated_timestamp;
        }
        return 0;
    });

    const inputStyle: React.CSSProperties = {
        width: '100%',
        boxSizing: 'border-box',
        fontSize: '0.85rem',
        fontFamily: 'inherit',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        background: 'var(--social-bg)',
        color: 'var(--text-h)',
        outline: 'none',
        resize: 'vertical',
    };

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
                    {/* Search Input */}
                    <div style={{ marginBottom: '12px' }}>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{
                                ...inputStyle,
                                padding: '6px 12px',
                                fontSize: '0.8rem',
                            }}
                            placeholder={`Search ${title.toLowerCase()}...`}
                        />
                    </div>

                    {sortedItems.length === 0 ? (
                        <p className="empty-state">
                            {searchQuery.trim() ? `No ${title.toLowerCase()} match your search.` : emptyMessage}
                        </p>
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
                                                {/* Title with Edit Support - Pencil icon RIGHT NEXT to title */}
                                                <div className="chat-item-title-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', flexWrap: 'wrap' }}>
                                                    {renderTitle ? renderTitle(item) : (
                                                        <span className="chat-item-title">{item.name}</span>
                                                    )}
                                                    {renderTitleActions && renderTitleActions(item)}
                                                    {/* Timestamp */}
                                                    {showTimestamps && item.last_updated_timestamp && (
                                                        <span style={{
                                                            fontSize: '0.6rem',
                                                            color: 'var(--text-h)',
                                                            opacity: 0.4,
                                                            marginLeft: 'auto',
                                                            flexShrink: 0,
                                                            fontWeight: 'normal',
                                                        }}>
                                                            {formatTimestamp(item.last_updated_timestamp)}
                                                        </span>
                                                    )}
                                                </div>
                                                {renderSubtext && (
                                                    <div className="chat-item-sub" style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {renderSubtext(item)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        
                                        {/* Right Actions - Star and Delete/Number badge */}
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