// src/frontend_src/components/ChatHistoryPanel.tsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';
import { useCompiledMessageText } from '../hooks/useMessageDisplay';

interface ChatHistoryPanelProps {
    messages: ChatMessage[];
    containerRef: React.RefObject<HTMLDivElement | null>;
    selectedCharacterId?: string;
    isOpen: boolean;
    onClose: () => void;
}

// Memoized list item to prevent re-renders during search typing
const HistoryItem = React.memo(function HistoryItem({ 
    msg, index, isProtagonist, onClick 
}: { 
    msg: ChatMessage; index: number; isProtagonist: boolean; onClick: (index: number) => void;
}) {
    const compiledText = useCompiledMessageText(msg);
    const firstLine = compiledText.split('\n')[0] || '';
    const truncated = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;

    return (
        <div 
            className={`history-item ${isProtagonist ? 'history-item-protagonist' : ''}`}
            onClick={(e) => { e.stopPropagation(); onClick(index); }}
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
    messages, containerRef, selectedCharacterId, isOpen, onClose
}: ChatHistoryPanelProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Auto-focus search when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    const filteredMessages = useMemo(() => {
        if (!searchQuery.trim()) return messages;
        const q = searchQuery.toLowerCase();
        return messages.filter(m => {
            const compiled = m.textContent?.toLowerCase() || '';
            return compiled.includes(q) || m.character.name.toLowerCase().includes(q);
        });
    }, [messages, searchQuery]);

    const handleJumpToMessage = (index: number) => {
        const container = containerRef.current;
        if (!container) return;
        const msg = filteredMessages[index];
        if (!msg) return;
        
        const el = container.querySelector(`[data-message-id="${msg.id}"]`) as HTMLElement | null;
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Optional: Add a brief highlight animation to the message bubble
            el.classList.add('history-jump-highlight');
            setTimeout(() => el.classList.remove('history-jump-highlight'), 2000);
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div ref={panelRef} className="history-panel" role="dialog" aria-label="Chat History">
            <div className="history-panel-header">
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
                />
            </div>

            <div className="history-list">
                {filteredMessages.length === 0 ? (
                    <div className="history-empty">No messages found.</div>
                ) : (
                    filteredMessages.map((msg, i) => (
                        <HistoryItem
                            key={msg.id}
                            msg={msg}
                            index={i}
                            isProtagonist={msg.character.id === selectedCharacterId}
                            onClick={handleJumpToMessage}
                        />
                    ))
                )}
            </div>
        </div>
    );
});