// src/components/ChatMinimap.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { ChatMessage } from '../types';

interface ChatMinimapProps {
    messages: ChatMessage[];
    containerRef: React.RefObject<HTMLDivElement | null>;
    currentCharacterId: string | undefined;
}

export const ChatMinimap = React.memo(function ChatMinimap({
    messages,
    containerRef,
    currentCharacterId,
}: ChatMinimapProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const stripRef = useRef<HTMLDivElement>(null);
    const isMobileRef = useRef(false);

    useEffect(() => {
        isMobileRef.current = window.matchMedia('(max-width: 768px)').matches || 'ontouchstart' in window;
    }, []);

    const handleClick = useCallback((index: number) => {
        const container = containerRef.current;
        if (!container) return;
        const msg = messages[index];
        if (!msg) return;
        const el = container.querySelector(`[data-message-id="${msg.id}"]`) as HTMLElement | null;
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (isMobileRef.current) setIsExpanded(false);
    }, [messages, containerRef]);

    const handleToggle = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        e.stopPropagation();
        if (isMobileRef.current) {
            setIsExpanded(prev => !prev);
        }
    }, []);

    useEffect(() => {
        if (!isExpanded) return;
        const onTapOutside = (e: TouchEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.chat-minimap')) {
                setIsExpanded(false);
            }
        };
        document.addEventListener('touchstart', onTapOutside, { passive: true });
        return () => document.removeEventListener('touchstart', onTapOutside);
    }, [isExpanded]);

    const [scrollRatio, setScrollRatio] = useState(0);
    const [viewportRatio, setViewportRatio] = useState(1);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onScroll = () => {
            const maxScroll = container.scrollHeight - container.clientHeight;
            if (maxScroll <= 0) { setScrollRatio(0); setViewportRatio(1); return; }
            setScrollRatio(container.scrollTop / maxScroll);
            setViewportRatio(container.clientHeight / container.scrollHeight);
        };

        container.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => container.removeEventListener('scroll', onScroll);
    }, [containerRef, messages.length]);

    if (messages.length === 0) return null;

    const indicatorTop = scrollRatio * (1 - viewportRatio) * 100;
    const indicatorHeight = Math.max(5, viewportRatio * 100);

    const expandedClass = isMobileRef.current
        ? (isExpanded ? 'chat-minimap-expanded' : '')
        : '';

    return (
        <div
            className={`chat-minimap ${expandedClass}`}
            onClick={handleToggle}
            onMouseEnter={() => { if (!isMobileRef.current) setIsExpanded(true); }}
            onMouseLeave={() => { if (!isMobileRef.current) { setIsExpanded(false); setHoveredIndex(null); } }}
        >
            {/* Collapsed state — just the viewport dot on a thin line */}
            <div className="chat-minimap-collapsed">
                <div
                    className="chat-minimap-viewport-dot"
                    style={{
                        top: `${indicatorTop}%`,
                        height: `${Math.max(8, indicatorHeight)}%`,
                    }}
                />
                <div className="chat-minimap-tap-hint">💬</div>
            </div>

            {/* Expanded state */}
            <div className="chat-minimap-expanded-content">
                <div className="chat-minimap-header">
                    💬 Messages ({messages.length})
                </div>

                <div ref={stripRef} className="chat-minimap-list">
                    {messages.map((msg, i) => {
                        const isprotagonist = msg.character.id === currentCharacterId;
                        const firstLine = msg.textContent.split('\n')[0].trim();
                        const truncated = firstLine.length > 28 ? firstLine.slice(0, 28) + '…' : firstLine;
                        const isHov = hoveredIndex === i;

                        return (
                            <div
                                key={msg.id}
                                className={`chat-minimap-item ${isprotagonist ? 'chat-minimap-item-protagonist' : ''} ${isHov ? 'chat-minimap-item-hovered' : ''}`}
                                onClick={(e) => { e.stopPropagation(); handleClick(i); }}
                                onMouseEnter={() => setHoveredIndex(i)}
                                onMouseLeave={() => setHoveredIndex(null)}
                                title={`${msg.character.name}: ${firstLine}`}
                            >
                                <span className={`chat-minimap-text ${isprotagonist ? 'chat-minimap-text-protagonist' : ''} ${isHov ? 'chat-minimap-text-hovered' : ''}`}>
                                    {truncated}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});