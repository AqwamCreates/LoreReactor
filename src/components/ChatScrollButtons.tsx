// src/components/ChatScrollButtons.tsx
import React, { useState, useEffect, useCallback } from 'react';

interface ChatScrollButtonsProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
}

export const ChatScrollButtons = React.memo(function ChatScrollButtons({
    containerRef,
}: ChatScrollButtonsProps) {
    const [showTop, setShowTop] = useState(false);
    const [showBottom, setShowBottom] = useState(false);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            setShowTop(scrollTop > 200);
            setShowBottom(scrollHeight - scrollTop - clientHeight > 200);
        };

        container.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => container.removeEventListener('scroll', onScroll);
    }, [containerRef]);

    const scrollToTop = useCallback(() => {
        containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, [containerRef]);

    const scrollToBottom = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }, [containerRef]);

    if (!showTop && !showBottom) return null;

    return (
        <>
            {showTop && (
                <button
                    className="chat-scroll-button chat-scroll-button-top"
                    onClick={scrollToTop}
                    title="Scroll to top"
                >
                    ↑
                </button>
            )}
            {showBottom && (
                <button
                    className="chat-scroll-button chat-scroll-button-bottom"
                    onClick={scrollToBottom}
                    title="Scroll to latest"
                >
                    ↓
                </button>
            )}
        </>
    );
});