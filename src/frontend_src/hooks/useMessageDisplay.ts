// frontend_src/hooks/useMessageDisplay.ts
import { useMemo } from 'react';
import type { HistoryMessage } from '../types';
import { useSessionStore } from './useSessionStore';
import { compileMessageDisplayText } from '../utilities/messageDisplayCompiler';

/**
 * Centralized hook to compile a single message's display text.
 * Subscribes to store settings automatically and memoizes the result.
 */
export function useCompiledMessageText(message: HistoryMessage | null | undefined): string {
    const participants = useSessionStore(s => s.interactionData?.participants || []);
    const displayMode = useSessionStore(s => s.interactionData?.profile?.toolUsageDisplayMode);

    return useMemo(() => {
        return compileMessageDisplayText(message, displayMode, participants);
    }, [message, displayMode, participants]);
}