// src/frontend_src/hooks/useMessageDisplay.ts
import { useMemo } from 'react';
import type { Character, TextMessage } from '../types';
import { useSessionStore } from './useSessionStore';
import { compileMessageDisplayText } from '../utilities/messageDisplayCompiler';

/**
 * Centralized hook to compile a single message's display text.
 * Accepts either a HistoryMessage object or a raw string (e.g., streaming text).
 */
export function useCompiledMessageText(
    target: TextMessage | string | null | undefined,
    characterOverride?: Character
): string {
    const participants = useSessionStore(s => s.interactionData?.participants || []);
    const profile = useSessionStore(s => s.interactionData?.profile);
    const toolUsageDisplayMode = profile?.toolUsageDisplayMode;
    const placementMode = profile?.toolUsageDisplayPlacementMode;

    return useMemo(() => {
        return compileMessageDisplayText(
            target,
            toolUsageDisplayMode,
            placementMode,
            participants,
            characterOverride
        );
    }, [target, toolUsageDisplayMode, placementMode, participants, characterOverride]);
}