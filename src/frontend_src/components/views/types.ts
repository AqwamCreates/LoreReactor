// src/frontend_src/components/views/types.ts
import type React from 'react';
import type { TextMessage, Character, NarrationMessage } from '../../types';
import type { DisplayNameCache } from '../../utilities/immersionLogic';

export type viewMode = 'ladder' | 'cinematic' | 'visual novel';

export interface ViewModeProps {
    displayMessages: (TextMessage | NarrationMessage)[];
    portraitUrlCache: Map<string, string | null>;
    displayNameCache: DisplayNameCache | null;
    streamingText: string | null; 
    centerAvatar: Character | null;
    locationBackgroundUrl?: string | null; // ✅ ADD THIS
    parentMessageId: string | null;
    parentInteractionDataName: string | null;
    chatHistoryRef: React.RefObject<HTMLDivElement | null>;
    messageEndRef: React.RefObject<HTMLDivElement | null>;
    editTextAreaRef: React.RefObject<HTMLTextAreaElement | null>;
    focusedMessageId: string | null;
    setFocusedMessageId: (id: string | null) => void;
    onAvatarClick: (e: React.MouseEvent, id: string, character: Character) => void;
    onResumeGeneration: (id: string) => void;
    onRegenerateFromMessage: (id: string, protagonistIds: string[]) => void;
    onRegenerateFromEdit: () => void;
    onPlayVoice: (text: string, character: Character) => void;
    onSaveEdit: () => void;
    onMassDeleteConfirm: () => void;
    onTouchStart: (e: React.TouchEvent, id: string) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    suppressNextClickRef: React.RefObject<boolean>;
    onNavigateToBranchSource: () => void;
    canDelete: boolean;
}