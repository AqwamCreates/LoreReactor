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
}

export function ChatViewArea({
    viewMode,
    baseProps,
    safeMessages,
    displayNameCache,
    isMultiplayerChat,
}: ChatViewAreaProps) {
    // Read directly from Zustand instead of receiving as props
    const localProtagonistId = useSessionStore((s) => s.localProtagonist?.id ?? s.interactionData?.protagonistIds?.[0] ?? null);

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
                    ...last,
                    textContent: streamingText,
                    character: { ...last.character, name },
                } as ChatMessage | WhisperMessage;
            } else if (!last || last.character.id !== streamingCharacter.id) {
                const name = resolveDelayedDisplayNameFromCache(displayNameCache, base.length, streamingCharacter.id);
                const now = Date.now();
                
                base.push({
                    id: `streaming-${streamingCharacter.id}`,
                    messageType: 'chat',
                    character: { ...streamingCharacter, name },
                    textContent: streamingText,
                    files: [],
                    frontCameraImage: undefined,
                    doNotRespond: false,
                    modelTextContentSummaries: {},
                    modelInteractionTextContentSummaries: {},
                    kvCacheTextContentPaths: {},
                    kvCacheTextContentSummaryPaths: {},
                    kvCacheInteractionTextContentSummaries: {},
                    characterClothingWearingStatuses: {},
                    characterLockedLocations: {},
                    isPresent: true,
                    parentMessageId: null,
                    firstCreatedTimestamp: now,
                    lastUpdatedTimestamp: now,
                } as ChatMessage);
            }
        }

        return base as ChatMessage[];
    }, [safeMessages, isLoading, streamingText, streamingCharacter, displayNameCache, isMultiplayerChat, localProtagonistId]);

    const activeViewProps: ViewModeProps = {
        ...baseProps,
        displayMessages,
        formattedStreamingText,
    };

    return (
        <>
            {viewMode === 'ladder' && <LadderView {...activeViewProps} />}
            {viewMode === 'cinematic' && <CinematicView {...activeViewProps} />}
            {viewMode === 'visual novel' && <VisualNovelView {...activeViewProps} />}
        </>
    );
}