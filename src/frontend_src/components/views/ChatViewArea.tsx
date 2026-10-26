// src/frontend_src/components/views/ChatViewArea.tsx
import { useMemo } from 'react';
import type { ViewModeProps, viewMode } from './types';
import type { ChatMessage, NarrationMessage, TextMessage, WhisperMessage } from '../../types';
import { useChatStore } from '../../hooks/useChatStore';
import { useGenerationStore } from '../../hooks/useGenerationStore';
import { resolveDelayedDisplayNameFromCache } from '../../utilities/immersionLogic';
import { LadderView } from './LadderView';
import { CinematicView } from './CinematicView';
import { VisualNovelView } from './VisualNovelView';
import { CardView } from './CardView';

interface ChatViewAreaProps {
    viewMode: viewMode;
    baseProps: ViewModeProps;
    safeMessages: (TextMessage | NarrationMessage)[];
    displayNameCache: any;
    isMultiplayerChat: boolean;
}

export function ChatViewArea({
    viewMode,
    baseProps,
    safeMessages,
    displayNameCache,
    isMultiplayerChat,
}: ChatViewAreaProps) {
    const localProtagonistId = useChatStore((s) => s.localProtagonist?.id ?? s.interactionData?.protagonistIds?.[0] ?? null);
    const streamingText = useGenerationStore((s) => s.streamingText);
    const streamingCharacter = useGenerationStore((s) => s.streamingCharacter);
    const streamingMessageId = useGenerationStore((s) => s.streamingMessageId);
    const isLoading = useGenerationStore((s) => s.isLoading);

    const displayMessages = useMemo(() => {
        let base = [...safeMessages];

        if (isMultiplayerChat && localProtagonistId) {
            base = base.filter((msg) => {
                if (msg.messageType === 'whisper') {
                    const w = msg as WhisperMessage;
                    return w.character.id === localProtagonistId || w.targetCharacterIds.includes(localProtagonistId);
                }
                return true;
            });
        }

        // Fast update: if actively streaming into an existing message, ensure immediate render
        if (isLoading && streamingText && streamingCharacter && streamingMessageId) {
            const idx = base.findIndex(m => m.id === streamingMessageId);
            if (idx !== -1) {
                const name = resolveDelayedDisplayNameFromCache(displayNameCache, idx, streamingCharacter.id);
                base[idx] = { ...base[idx], textContent: streamingText, character: { ...base[idx].character, name } } as TextMessage;
            }
        }

        return base as ChatMessage[];
    }, [safeMessages, isLoading, streamingText, streamingCharacter, streamingMessageId, displayNameCache, isMultiplayerChat, localProtagonistId]);

    const activeViewProps: ViewModeProps = {
        ...baseProps,
        displayMessages,
    };

    return (
        <>
            {viewMode === 'ladder' && <LadderView {...activeViewProps} />}
            {viewMode === 'cinematic' && <CinematicView {...activeViewProps} />}
            {viewMode === 'visual novel' && <VisualNovelView {...activeViewProps} />}
            {viewMode === 'card' && <CardView {...activeViewProps} />}
        </>
    );
}