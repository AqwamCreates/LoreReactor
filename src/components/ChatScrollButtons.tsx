// src/components/ChatScrollButtons.tsx
import React, { useState, useCallback, useLayoutEffect } from 'react';

interface ChatScrollButtonsProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    messageCount: number;
}

const BUTTON_GAP = 16;
const VERTICAL_GAP = 5;

export const ChatScrollButtons = React.memo(function ChatScrollButtons({
    containerRef,
    messageCount,
}: ChatScrollButtonsProps) {
    const [showTopButton, setShowTopButton] = useState(false);
    const [showBottomButton, setShowBottomButton] = useState(false);
    const [containerRect, setContainerRect] = useState<{ top: number; bottom: number; right: number } | null>(null);

    const checkScroll = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const { scrollTop, scrollHeight, clientHeight } = container;
        setShowTopButton(scrollTop > 200);
        setShowBottomButton(scrollHeight - scrollTop - clientHeight > 200);
    }, [containerRef]);

    const updateRect = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        setContainerRect({
            top: rect.top,
            bottom: rect.bottom,
            right: rect.right,
        });
    }, [containerRef]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onScroll = () => {
            updateRect();
            checkScroll();
        };

        updateRect();
        checkScroll();

        const resizeObserver = new ResizeObserver(() => {
            updateRect();
            checkScroll();
        });
        resizeObserver.observe(container);
        container.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);

        return () => {
            resizeObserver.disconnect();
            container.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
        };
    }, [containerRef, checkScroll, updateRect]);

    // Re-check scroll state when message count changes (session restore, new messages)
    useLayoutEffect(() => {
        // Defer to next frame to ensure browser has completed layout
        const frameId = requestAnimationFrame(() => {
            checkScroll();
            updateRect();
        });
        return () => cancelAnimationFrame(frameId);
    }, [messageCount, checkScroll, updateRect]);

    const scrollToTop = useCallback(() => {
        containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, [containerRef]);

    const scrollToBottom = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }, [containerRef]);

    if (!containerRect || (!showTopButton && !showBottomButton)) return null;

    const topPosition = containerRect.top + BUTTON_GAP + VERTICAL_GAP;
    const bottomPosition = window.innerHeight - containerRect.bottom + BUTTON_GAP + VERTICAL_GAP;
    const rightPosition = window.innerWidth - containerRect.right + BUTTON_GAP;

    return (
        <>
            {showTopButton && (
                <button
                    type="button"
                    className="chat-scroll-button"
                    onClick={scrollToTop}
                    title="Scroll to top"
                    style={{
                        position: 'fixed',
                        top: `${topPosition}px`,
                        right: `${rightPosition}px`,
                    }}
                >
                    ↑
                </button>
            )}
            {showBottomButton && (
                <button
                    type="button"
                    className="chat-scroll-button"
                    onClick={scrollToBottom}
                    title="Scroll to latest"
                    style={{
                        position: 'fixed',
                        bottom: `${bottomPosition}px`,
                        right: `${rightPosition}px`,
                    }}
                >
                    ↓
                </button>
            )}
        </>
    );
});