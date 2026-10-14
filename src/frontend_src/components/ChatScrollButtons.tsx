// src/frontend_src/components/ChatScrollButtons.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';

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

    const topButtonRef = useRef<HTMLButtonElement>(null);
    const bottomButtonRef = useRef<HTMLButtonElement>(null);
    const prevClientHeightRef = useRef<number>(0);

    const updatePositionsAndVisibility = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const { scrollTop, scrollHeight, clientHeight } = container;
        const prevHeight = prevClientHeightRef.current;

        // ✅ Keep pinned to bottom if within 50px of the bottom when resizing
        if (prevHeight && prevHeight !== clientHeight) {
            const distanceToBottom = scrollHeight - scrollTop - prevHeight;
            if (distanceToBottom <= 50) {
                container.scrollTop = scrollHeight - clientHeight;
            }
        }
        prevClientHeightRef.current = clientHeight;

        const currentScrollTop = container.scrollTop;
        setShowTopButton(currentScrollTop > 50);
        setShowBottomButton(scrollHeight - currentScrollTop - clientHeight > 50);

        if (!useViewportBounds) {
            const rect = container.getBoundingClientRect();
            const topPos = rect.top + BUTTON_GAP + VERTICAL_GAP;
            const bottomPos = window.innerHeight - rect.bottom + BUTTON_GAP + VERTICAL_GAP;
            const rightPos = window.innerWidth - rect.right + BUTTON_GAP;

            if (topButtonRef.current) {
                topButtonRef.current.style.top = `${topPos}px`;
                topButtonRef.current.style.right = `${rightPos}px`;
            }
            if (bottomButtonRef.current) {
                bottomButtonRef.current.style.bottom = `${bottomPos}px`;
                bottomButtonRef.current.style.right = `${rightPos}px`;
            }
        }
    }, [containerRef, useViewportBounds]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        prevClientHeightRef.current = container.clientHeight;
        updatePositionsAndVisibility();

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(updatePositionsAndVisibility);
        });
        resizeObserver.observe(container);

        const handleScroll = (e: Event) => {
            if (e.target === container) {
                updatePositionsAndVisibility();
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', updatePositionsAndVisibility);

        return () => {
            resizeObserver.disconnect();
            container.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', updatePositionsAndVisibility);
        };
    }, [containerRef, updatePositionsAndVisibility]);

    useEffect(() => {
        updatePositionsAndVisibility();
    }, [messageCount, updatePositionsAndVisibility]);

    const scrollToTop = () => {
        containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const scrollToBottom = () => {
        const container = containerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    };

    if (!showTopButton && !showBottomButton) return null;

    return (
        <>
            {showTopButton && (
                <button
                    ref={topButtonRef}
                    type="button"
                    tabIndex={-1}
                    className="chat-scroll-button"
                    onClick={scrollToTop}
                    onMouseDown={(e) => e.preventDefault()}
                    title="Scroll to top"
                    style={{
                        position: 'fixed',
                        ...(useViewportBounds ? { top: '100px', right: '20px' } : {}),
                        transition: 'opacity 0.2s ease, background 0.2s ease',
                    }}
                >
                    ↑
                </button>
            )}
            {showBottomButton && (
                <button
                    ref={bottomButtonRef}
                    type="button"
                    tabIndex={-1}
                    className="chat-scroll-button"
                    onClick={scrollToBottom}
                    onMouseDown={(e) => e.preventDefault()}
                    title="Scroll to latest"
                    style={{
                        position: 'fixed',
                        ...(useViewportBounds ? { bottom: '100px', right: '20px' } : {}),
                        transition: 'opacity 0.2s ease, background 0.2s ease',
                    }}
                >
                    ↓
                </button>
            )}
        </>
    );
});