// frontend_src/components/ChatMinimap.tsx
import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type { ChatMessage } from '../types';
import { useCompiledMessageText } from '../hooks/useMessageDisplay';

interface ChatMinimapProps {
    messages: ChatMessage[];
    containerRef: React.RefObject<HTMLDivElement | null>;
    selectedCharacterId: string | undefined;
}

interface MinimapItemProps {
    msg: ChatMessage;
    index: number;
    isProtagonist: boolean;
    isHovered: boolean;
    onClick: (index: number) => void;
    onHover: (index: number | null) => void;
}

// Sub-component memoized so hovering/scrolling does NOT re-render other items
const MinimapItem = React.memo(function MinimapItem({
    msg,
    index,
    isProtagonist,
    isHovered,
    onClick,
    onHover,
}: MinimapItemProps) {
    // Centralized compiled message text hook (automatically subscribes to displayMode and participants)
    const compiledText = useCompiledMessageText(msg);

    const compiledFirstLine = useMemo(() => {
        return compiledText.split('\n')[0]?.trim() || '';
    }, [compiledText]);

    const truncated = compiledFirstLine.length > 28
        ? `${compiledFirstLine.slice(0, 28)}…`
        : compiledFirstLine;

    return (
        <div
            className={`chat-minimap-item ${isProtagonist ? 'chat-minimap-item-protagonist' : ''} ${isHovered ? 'chat-minimap-item-hovered' : ''}`}
            onClick={(e) => {
                e.stopPropagation();
                onClick(index);
            }}
            onMouseEnter={() => onHover(index)}
            onMouseLeave={() => onHover(null)}
            title={`${msg.character.name}: ${compiledFirstLine}`}
        >
            <span className={`chat-minimap-text ${isProtagonist ? 'chat-minimap-text-protagonist' : ''} ${isHovered ? 'chat-minimap-text-hovered' : ''}`}>
                {truncated}
            </span>
        </div>
    );
});

export const ChatMinimap = React.memo(function ChatMinimap({
    messages,
    containerRef,
    selectedCharacterId,
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
    }, [containerRef]);

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
            {/* Collapsed state — viewport indicator */}
            <div className="chat-minimap-collapsed">
                <div
                    className="chat-minimap-viewport-dot"
                    style={{
                        top: `${indicatorTop}%`,
                        height: `${Math.max(8, indicatorHeight)}%`,
                    }}
                />
            </div>

            {/* Expanded state */}
            <div className="chat-minimap-expanded-content">
                <div className="chat-minimap-header">
                    💬 Messages ({messages.length})
                </div>

                <div ref={stripRef} className="chat-minimap-list">
                    {messages.map((msg, i) => (
                        <MinimapItem
                            key={msg.id}
                            msg={msg}
                            index={i}
                            isProtagonist={msg.character.id === selectedCharacterId}
                            isHovered={hoveredIndex === i}
                            onClick={handleClick}
                            onHover={setHoveredIndex}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
});