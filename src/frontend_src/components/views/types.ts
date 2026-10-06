// frontend_src/components/views/types.ts
import type React from 'react';
import type { Character, ChatMessage } from '../../types';
import type { DisplayNameCache } from '../../utilities/immersionLogic';

export interface ViewModeProps {
    displayMessages: ChatMessage[];
    portraitUrlCache: Map<string, string | null>;
    displayNameCache: DisplayNameCache | null;
    formattedStreamingText: React.ReactNode | null;
    centerAvatar: Character | null;
    chatHistoryRef: React.RefObject<HTMLDivElement | null>;
    messageEndRef: React.RefObject<HTMLDivElement | null>;
    editTextAreaRef: React.RefObject<HTMLTextAreaElement | null>;
    parentMessageId: string | null;
    parentInteractionDataName?: string | null;

    focusedMessageId: string | null;
    setFocusedMessageId: (id: string | null) => void;

    onAvatarClick: (e: React.MouseEvent, id: string, character: Character) => void;
    onResumeGeneration: (id: string) => void;
    onRegenerateFromMessage: (id: string, protagonistIds: string[]) => void;
    onRegenerateFromEdit: () => void; // ✅ Added back
    onSaveEdit: () => void;
    onTouchStart: (e: React.TouchEvent, id: string) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    suppressNextClickRef: React.MutableRefObject<boolean>;
    onNavigateToBranchSource: () => void;
    canDelete: boolean;
}

export type viewMode = "ladder" | "cinematic" | "visual novel"