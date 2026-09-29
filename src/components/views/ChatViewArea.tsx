// src/components/views/ChatViewArea.tsx
import { useMemo } from 'react';
import type { ViewModeProps, viewMode } from './types';
import type { ChatMessage, WhisperMessage } from '../../types';
import { useSessionStore } from '../../hooks/useSessionStore';
import { formatDisplayMessageText } from '../../utilities/textDisplayFormatter';
import { resolveDelayedDisplayNameFromCache } from '../../utilities/immersionLogic';
import { LadderView } from './LadderView';
import { CinematicView } from './CinematicView';
import { VisualNovelView } from './VisualNovelView';

interface ChatViewAreaProps {
    viewMode: viewMode;
    baseProps: ViewModeProps;
    safeMessages: (ChatMessage | WhisperMessage)[];
    displayNameCache: any;
    isMultiplayerChat: boolean;
    localProtagonistId?: string;
}

export function ChatViewArea({
    viewMode,
    baseProps,
    safeMessages,
    displayNameCache,
    isMultiplayerChat,
    localProtagonistId,
}: ChatViewAreaProps) {
    // Isolated subscriptions: ONLY this component re-renders during token streaming
    const streamingText = useSessionStore((s) => s.streamingText);
    const streamingCharacter = useSessionStore((s) => s.streamingCharacter);
    const isLoading = useSessionStore((s) => s.isLoading);

    const formattedStreamingText = useMemo(
        () => (streamingText ? formatDisplayMessageText(streamingText) : null),
        [streamingText]
    );

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

        if (isLoading && streamingText && streamingCharacter) {
            const last = base[base.length - 1];
            const isLastStreaming = last?.character.id === streamingCharacter.id;

            if (isLastStreaming) {
                const idx = base.length - 1;
                const name = resolveDelayedDisplayNameFromCache(displayNameCache, idx, streamingCharacter.id);

                base[idx] = {
                    ...last!,
                    textContent: streamingText,
                    character: { ...last!.character, name },
                } as any;
            } else if (!last || last.character.id !== streamingCharacter.id) {
                const name = resolveDelayedDisplayNameFromCache(displayNameCache, base.length, streamingCharacter.id);
                base.push({
                    id: `streaming-${streamingCharacter.id}`,
                    messageType: 'chat',
                    character: { ...streamingCharacter, name },
                    textContent: streamingText,
                    files: [],
                    firstCreatedTimestamp: 0,
                    lastUpdatedTimestamp: 0,
                    locationIndex: undefined,
                    characterLockedLocations: {},
                    parentInteractionMessageId: null,
                } as any);
            }
        }

        return base as ChatMessage[];
    }, [safeMessages, isLoading, streamingText, streamingCharacter, displayNameCache, isMultiplayerChat, localProtagonistId]);

    const activeViewProps: ViewModeProps = {
        ...baseProps,
        displayMessages,
        formattedStreamingText,
        streamingCharacter,
        isLoading,
    };

    return (
        <>
            {viewMode === 'ladder' && <LadderView {...activeViewProps} />}
            {viewMode === 'cinematic' && <CinematicView {...activeViewProps} />}
            {viewMode === 'visual novel' && <VisualNovelView {...activeViewProps} />}
        </>
    );
}