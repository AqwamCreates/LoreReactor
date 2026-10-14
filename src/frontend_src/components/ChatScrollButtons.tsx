// frontend_src/components/ChatScrollButtons.tsx
import React, { useState, useEffect, useCallback } from 'react';

interface ChatScrollButtonsProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    messageCount: number;
    useViewportBounds?: boolean; // For Cinematic mode
}

const BUTTON_GAP = 16;
const VERTICAL_GAP = 5;

export const ChatScrollButtons = React.memo(function ChatScrollButtons({
    containerRef,
    messageCount,
    useViewportBounds = false,
}: ChatScrollButtonsProps) {
    const [showTopButton, setShowTopButton] = useState(false);
    const [showBottomButton, setShowBottomButton] = useState(false);
    const [containerRect, setContainerRect] = useState<{ top: number; bottom: number; right: number } | null>(null);

    const measure = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const { scrollTop, scrollHeight, clientHeight } = container;
        setShowTopButton(scrollTop > 100);
        setShowBottomButton(scrollHeight - scrollTop - clientHeight > 100);

        const rect = container.getBoundingClientRect();
        setContainerRect({ top: rect.top, bottom: rect.bottom, right: rect.right });
    }, [containerRef]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        measure();

        // ✅ Observe the chat container's dimensions directly
        // Whenever ContextBar expands or collapses, this observer triggers immediately
        const resizeObserver = new ResizeObserver(() => {
            measure();
        });
        resizeObserver.observe(container);

        const handleScroll = (e: Event) => {
            if (e.target === container) {
                measure();
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', measure);

        return () => {
            resizeObserver.disconnect();
            container.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', measure);
        };
    }, [containerRef, measure]);

    useEffect(() => {
        measure();
    }, [messageCount, measure]);

    const scrollToTop = () => {
        containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const scrollToBottom = () => {
        const container = containerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    };

    if (!containerRect || (!showTopButton && !showBottomButton)) return null;

    let topPosition: number;
    let bottomPosition: number;
    let rightPosition: number;

    if (useViewportBounds) {
        // Anchor to viewport edges for Cinematic mode
        topPosition = 100;
        bottomPosition = 100;
        rightPosition = 20;
    } else {
        // Anchor to the chat-history container for Ladder mode
        topPosition = containerRect.top + BUTTON_GAP + VERTICAL_GAP;
        bottomPosition = window.innerHeight - containerRect.bottom + BUTTON_GAP + VERTICAL_GAP;
        rightPosition = window.innerWidth - containerRect.right + BUTTON_GAP;
    }

    return (
        <>
            {showTopButton && (
                <button
                    type="button"
                    tabIndex={-1}
                    className="chat-scroll-button"
                    onClick={scrollToTop}
                    onMouseDown={(e) => e.preventDefault()}
                    title="Scroll to top"
                    style={{
                        position: 'fixed',
                        top: `${topPosition}px`,
                        right: `${rightPosition}px`,
                        // Smoothly interpolate position shifts
                        transition: 'top 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), bottom 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.2s ease, background 0.2s ease',
                    }}
                >
                    ↑
                </button>
            )}
            {showBottomButton && (
                <button
                    type="button"
                    tabIndex={-1}
                    className="chat-scroll-button"
                    onClick={scrollToBottom}
                    onMouseDown={(e) => e.preventDefault()}
                    title="Scroll to latest"
                    style={{
                        position: 'fixed',
                        bottom: `${bottomPosition}px`,
                        right: `${rightPosition}px`,
                        // Smoothly slide up when context bar expands, and back down when it retracts
                        transition: 'bottom 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), top 0.25s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.2s ease, background 0.2s ease',
                    }}
                >
                    ↓
                </button>
            )}
        </>
    );
});