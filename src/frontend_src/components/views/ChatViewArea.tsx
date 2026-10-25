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
    const streamingMessageId = useGenerationStore((s) => s.streamingMessageId); // 👈 Added tracking ID
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

        if (isLoading && streamingText && streamingCharacter) {
            // 🛠️ FIX: If a specific message ID is being resumed (e.g. Message 2), find it and update it in-place!
            if (streamingMessageId) {
                const idx = base.findIndex(m => m.id === streamingMessageId);
                if (idx !== -1) {
                    const name = resolveDelayedDisplayNameFromCache(displayNameCache, idx, streamingCharacter.id);
                    base[idx] = { ...base[idx], textContent: streamingText, character: { ...base[idx].character, name } } as TextMessage;
                }
            } else {
                const last = base[base.length - 1];
                const isStreamingPlaceholder = last?.id?.startsWith('streaming-');

                if (isStreamingPlaceholder) {
                    const idx = base.length - 1;
                    const name = resolveDelayedDisplayNameFromCache(displayNameCache, idx, streamingCharacter.id);
                    base[idx] = { ...last, textContent: streamingText, character: { ...last.character, name } } as TextMessage;
                } else {
                    const name = resolveDelayedDisplayNameFromCache(displayNameCache, base.length, streamingCharacter.id);
                    const now = Date.now();
                    base.push({
                        id: `streaming-${streamingCharacter.id}`, messageType: 'chat',
                        character: { ...streamingCharacter, name }, textContent: streamingText,
                        files: [], frontCameraImage: undefined, doNotRespond: false,
                        modelTextContentSummaries: {}, modelInteractionTextContentSummaries: {},
                        kvCacheTextContentPaths: {}, kvCacheTextContentSummaryPaths: {}, kvCacheInteractionTextContentSummaries: {},
                        characterClothingWearingStatuses: {}, characterLockedLocations: {},
                        isPresent: true, parentMessageId: null, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                    } as ChatMessage);
                }
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