// src/frontend_src/components/ChatHistoryPanel.tsx
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../types';
import { useCompiledMessageText } from '../hooks/useMessageDisplay';

interface ChatHistoryPanelProps {
    messages: ChatMessage[];
    containerRef: React.RefObject<HTMLDivElement | null>;
    selectedCharacterId?: string;
    isOpen: boolean;
    onClose: () => void;
    onJumpToMessage: (messageId: string) => void; // 👈 NEW PROP
}

// Memoized list item to prevent re-renders during search typing
const HistoryItem = React.memo(function HistoryItem({ 
    msg, isProtagonist, onClick 
}: { 
    msg: ChatMessage; isProtagonist: boolean; onClick: (id: string) => void;
}) {
    const compiledText = useCompiledMessageText(msg);
    const firstLine = compiledText.split('\n')[0] || '';
    const truncated = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;

    return (
        <div 
            className={`history-item ${isProtagonist ? 'history-item-protagonist' : ''}`}
            onClick={(e) => { e.stopPropagation(); onClick(msg.id); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick(msg.id);
                }
            }}
        >
            <div className="history-item-meta">
                <span className="history-item-name">{msg.character.name}</span>
                <span className="history-item-time">
                    {new Date(msg.firstCreatedTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
            <div className="history-item-text">{truncated}</div>
        </div>
    );
});

export const ChatHistoryPanel = React.memo(function ChatHistoryPanel({
    messages, containerRef, selectedCharacterId, isOpen, onClose, onJumpToMessage
}: ChatHistoryPanelProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLElement>(null);

    // Auto-focus search when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    // Close on outside click or Escape key
    useEffect(() => {
        if (!isOpen) return;
        
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    const filteredMessages = useMemo(() => {
        if (!searchQuery) return messages;
        const q = searchQuery.toLowerCase();
        return messages.filter(m => {
            const compiled = m.textContent?.toLowerCase() || '';
            return compiled.includes(q) || m.character.name.toLowerCase().includes(q);
        });
    }, [messages, searchQuery]);

    const handleJumpToMessage = useCallback((msgId: string) => {
        onJumpToMessage(msgId); // 👈 Set state in App.tsx
        
        // Only try to scroll if the container actually renders a list (Ladder/Cinematic)
        const container = containerRef.current;
        if (container) {
            // We use setTimeout to allow React a tick to render the message if it was hidden
            setTimeout(() => {
                const el = container.querySelector(`[data-message-id="${msgId}"]`) as HTMLElement | null;
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('history-jump-highlight');
                    setTimeout(() => el.classList.remove('history-jump-highlight'), 2000);
                }
            }, 50);
        }
        onClose();
    }, [containerRef, onJumpToMessage, onClose]);

    if (!isOpen) return null;

    return (
        <section 
            ref={panelRef} 
            className="dropdown-panel" 
            aria-label="Chat History" 
            style={{ width: 360 }}
        >
            <div className="dropdown-panel-header" style={{ justifyContent: 'space-between' }}>
                <span className="history-panel-title">Chat History</span>
                <span className="history-panel-count">{messages.length} messages</span>
            </div>
            
            <div className="history-search-wrapper">
                <input
                    ref={inputRef}
                    type="text"
                    className="history-search-input"
                    placeholder="Search messages or characters..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search chat history"
                />
            </div>

            <div className="dropdown-panel-body history-list" style={{ padding: '8px 0' }} role="list">
                {filteredMessages.length === 0 ? (
                    <div className="history-empty">No messages found.</div>
                ) : (
                    filteredMessages.map((msg) => (
                        <HistoryItem
                            key={msg.id}
                            msg={msg}
                            isProtagonist={msg.character.id === selectedCharacterId}
                            onClick={handleJumpToMessage}
                        />
                    ))
                )}
            </div>
        </section>
    );
});

export default ChatHistoryPanel;