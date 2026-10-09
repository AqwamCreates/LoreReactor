// frontend_src/hooks/useMessageToolbar.ts
import { useRef, useCallback, useEffect } from 'react';
import { useSessionStore } from './useSessionStore';

interface UseMessageToolbarOptions {
    chatHistoryRef: React.RefObject<HTMLDivElement | null>;
}

const TOUCH_SLOP = 10; // Pixel threshold to ignore micro-movements on mobile touchscreens

export function useMessageToolbar(options: UseMessageToolbarOptions) {
    const { chatHistoryRef } = options;

    // Read and write directly to Zustand so LadderView and all views stay in sync
    const activeToolbarId = useSessionStore((s: any) => s.activeToolbarId ?? null);
    
    const setActiveToolbarId = useCallback((id: string | null) => {
        const store = useSessionStore.getState() as any;
        if (typeof store.setActiveToolbarId === 'function') {
            store.setActiveToolbarId(id);
        } else {
            useSessionStore.setState({ activeToolbarId: id });
        }
    }, []);

    const activeToolbarIdRef = useRef<string | null>(null);
    useEffect(() => { activeToolbarIdRef.current = activeToolbarId; }, [activeToolbarId]);

    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdClassTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const toolbarAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clickSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
    const isLongPressingRef = useRef(false);
    const suppressNextClickRef = useRef(false);

    const deactivateToolbar = useCallback(() => {
        if (toolbarAutoHideRef.current) {
            clearTimeout(toolbarAutoHideRef.current);
            toolbarAutoHideRef.current = null;
        }
        setActiveToolbarId(null);
    }, [setActiveToolbarId]);

    const activateToolbar = useCallback((mid: string) => {
        if (toolbarAutoHideRef.current) {
            clearTimeout(toolbarAutoHideRef.current);
        }
        setActiveToolbarId(mid);
        toolbarAutoHideRef.current = setTimeout(() => {
            const current = (useSessionStore.getState() as any).activeToolbarId;
            if (current === mid) {
                setActiveToolbarId(null);
            }
        }, 8000);
    }, [setActiveToolbarId]);

    // Auto-deactivate on scroll without thrashing event listeners
    useEffect(() => {
        const el = chatHistoryRef.current;
        if (!el) return;

        const handleScroll = () => {
            if (activeToolbarIdRef.current) {
                deactivateToolbar();
            }
        };

        el.addEventListener('scroll', handleScroll, { passive: true });
        return () => el.removeEventListener('scroll', handleScroll);
    }, [deactivateToolbar, chatHistoryRef]);

    // Cleanup all timers on unmount
    useEffect(() => () => {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        if (holdClassTimerRef.current) clearTimeout(holdClassTimerRef.current);
        if (toolbarAutoHideRef.current) clearTimeout(toolbarAutoHideRef.current);
        if (clickSuppressionTimerRef.current) clearTimeout(clickSuppressionTimerRef.current);
    }, []);

    const handleBubbleTouchStart = useCallback((e: React.TouchEvent, mid: string) => {
        if (e.touches.length > 1) return;

        isLongPressingRef.current = false;
        suppressNextClickRef.current = false;

        const touch = e.touches[0];
        touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

        const targetElement = e.target as HTMLElement;
        const bubbleElement = targetElement.closest('.message-bubble');

        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);

        longPressTimerRef.current = setTimeout(() => {
            isLongPressingRef.current = true;
            suppressNextClickRef.current = true;

            bubbleElement?.classList.add('toolbar-longpress-hold');
            activateToolbar(mid);

            if (holdClassTimerRef.current) clearTimeout(holdClassTimerRef.current);
            holdClassTimerRef.current = setTimeout(() => {
                bubbleElement?.classList.remove('toolbar-longpress-hold');
            }, 300);

            navigator.vibrate?.(30);
        }, 500);
    }, [activateToolbar]);

    const handleBubbleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }

        const targetElement = e.target as HTMLElement;
        targetElement.closest('.message-bubble')?.classList.remove('toolbar-longpress-hold');

        if (isLongPressingRef.current) {
            e.preventDefault();
            // Keep suppressNextClickRef true across the finger lift so the synthetic click is swallowed
            if (clickSuppressionTimerRef.current) clearTimeout(clickSuppressionTimerRef.current);
            clickSuppressionTimerRef.current = setTimeout(() => {
                suppressNextClickRef.current = false;
            }, 600);
            isLongPressingRef.current = false;
        }
        touchStartPosRef.current = null;
    }, []);

    const handleBubbleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!touchStartPosRef.current || !longPressTimerRef.current) return;

        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
        const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);

        // Cancel long press only if movement exceeds the intentional scroll slop threshold
        if (dx > TOUCH_SLOP || dy > TOUCH_SLOP) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
            touchStartPosRef.current = null;
        }
    }, []);

    return {
        activeToolbarId,
        deactivateToolbar,
        handleBubbleTouchStart,
        handleBubbleTouchEnd,
        handleBubbleTouchMove,
        suppressNextClickRef,
    };
}