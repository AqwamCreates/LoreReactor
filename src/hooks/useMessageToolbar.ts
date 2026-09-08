// src/hooks/useMessageToolbar.ts
import { useState, useRef, useCallback, useEffect } from 'react';

interface UseMessageToolbarOptions {
    chatHistoryRef: React.RefObject<HTMLDivElement | null>;
}

export function useMessageToolbar(options: UseMessageToolbarOptions) {
    const { chatHistoryRef } = options;

    const [activeToolbarId, setActiveToolbarId] = useState<string | null>(null);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const toolbarAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLongPressingRef = useRef(false);
    const suppressNextClickRef = useRef(false);

    const deactivateToolbar = useCallback(() => {
        if (toolbarAutoHideRef.current) clearTimeout(toolbarAutoHideRef.current);
        setActiveToolbarId(null);
    }, []);

    const activateToolbar = useCallback((mid: string) => {
        if (toolbarAutoHideRef.current) clearTimeout(toolbarAutoHideRef.current);
        setActiveToolbarId(mid);
        toolbarAutoHideRef.current = setTimeout(() => setActiveToolbarId(p => p === mid ? null : p), 8000);
    }, []);

    // Auto-deactivate on scroll
    useEffect(() => {
        const el = chatHistoryRef.current;
        if (!el) return;
        const fn = () => { if (activeToolbarId) deactivateToolbar(); };
        el.addEventListener('scroll', fn, { passive: true });
        return () => el.removeEventListener('scroll', fn);
    }, [activeToolbarId, deactivateToolbar, chatHistoryRef]);

    // Cleanup timers on unmount
    useEffect(() => () => {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        if (toolbarAutoHideRef.current) clearTimeout(toolbarAutoHideRef.current);
    }, []);

    const handleBubbleTouchStart = useCallback((e: React.TouchEvent, mid: string) => {
        isLongPressingRef.current = false;
        suppressNextClickRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
            isLongPressingRef.current = true;
            suppressNextClickRef.current = true;
            const b = (e.target as HTMLElement).closest('.message-bubble');
            b?.classList.add('toolbar-longpress-hold');
            activateToolbar(mid);
            setTimeout(() => b?.classList.remove('toolbar-longpress-hold'), 300);
            navigator.vibrate?.(30);
        }, 500);
    }, [activateToolbar]);

    const handleBubbleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        (e.target as HTMLElement).closest('.message-bubble')?.classList.remove('toolbar-longpress-hold');
        if (isLongPressingRef.current) {
            e.preventDefault();
            isLongPressingRef.current = false;
        }
    }, []);

    const handleBubbleTouchMove = useCallback(() => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
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