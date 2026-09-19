// src/components/ChatScrollButtons.tsx
import React, { useState, useEffect } from 'react';

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

    useEffect(() => {
        const measure = () => {
            const container = containerRef.current;
            if (!container) return;
            const { scrollTop, scrollHeight, clientHeight } = container;
            setShowTopButton(scrollTop > 100);
            setShowBottomButton(scrollHeight - scrollTop - clientHeight > 100);

            const rect = container.getBoundingClientRect();
            setContainerRect({ top: rect.top, bottom: rect.bottom, right: rect.right });
        };

        const handleScroll = (e: Event) => {
            if (e.target === containerRef.current) {
                measure();
            }
        };

        measure();
        const timeoutId = setTimeout(measure, 150);

        window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
        window.addEventListener('resize', measure);

        return () => {
            clearTimeout(timeoutId);
            window.removeEventListener('scroll', handleScroll, { capture: true });
            window.removeEventListener('resize', measure);
        };
    }, [containerRef]);

    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            const { scrollTop, scrollHeight, clientHeight } = container;
            setShowTopButton(scrollTop > 100);
            setShowBottomButton(scrollHeight - scrollTop - clientHeight > 100);

            const rect = container.getBoundingClientRect();
            setContainerRect({ top: rect.top, bottom: rect.bottom, right: rect.right });
        }
    }, [messageCount, containerRef]);

    const scrollToTop = () => {
        containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const scrollToBottom = () => {
        const container = containerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    };

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
                    onMouseDown={(e) => e.preventDefault()}
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
                    onMouseDown={(e) => e.preventDefault()}
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