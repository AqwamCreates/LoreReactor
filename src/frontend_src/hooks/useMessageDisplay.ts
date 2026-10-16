// src/frontend_src/hooks/useMessageDisplay.ts
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
    const profile = useSessionStore(s => s.interactionData?.profile)
    const toolUsageDisplayMode = profile?.toolUsageDisplayMode;
    const placementMode = profile?.toolUsageDisplayPlacementMode

    return useMemo(() => {
        return compileMessageDisplayText(message, toolUsageDisplayMode, placementMode, participants);
    }, [message, toolUsageDisplayMode, placementMode, participants]);
}