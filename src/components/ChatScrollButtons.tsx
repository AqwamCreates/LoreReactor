import React, { useState, useCallback, useLayoutEffect, useEffect } from 'react';

interface ChatScrollButtonsProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
}

const BUTTON_GAP = 16;
const VERTICAL_GAP = 5;

export const ChatScrollButtons = React.memo(function ChatScrollButtons({
    containerRef,
}: ChatScrollButtonsProps) {
    const [showTopButton, setShowTopButton] = useState(false);
    const [showBottomButton, setShowBottomButton] = useState(false);
    const [containerRect, setContainerRect] = useState<{ top: number; bottom: number; right: number } | null>(null);
    const [tick, setTick] = useState(0);

    // Force re-check after mount and after any DOM settling
    useEffect(() => {
        const t1 = setTimeout(() => setTick(t => t + 1), 300);
        const t2 = setTimeout(() => setTick(t => t + 1), 800);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, []);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateRect = () => {
            const rect = container.getBoundingClientRect();
            setContainerRect({
                top: rect.top,
                bottom: rect.bottom,
                right: rect.right,
            });
        };

        const onScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            setShowTopButton(scrollTop > 200);
            setShowBottomButton(scrollHeight - scrollTop - clientHeight > 200);
        };

        updateRect();
        onScroll();

        const resizeObserver = new ResizeObserver(updateRect);
        resizeObserver.observe(container);
        container.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', updateRect);

        return () => {
            resizeObserver.disconnect();
            container.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', updateRect);
        };
    }, [containerRef, tick]);

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