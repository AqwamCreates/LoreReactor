// src/frontend_src/components/views/types.ts
import type React from 'react';
import type { ChatMessage, Character } from '../../types';
import type { DisplayNameCache } from '../../utilities/immersionLogic';

export type viewMode = 'ladder' | 'cinematic' | 'visual novel';

export interface ViewModeProps {
    displayMessages: ChatMessage[];
    portraitUrlCache: Map<string, string>;
    displayNameCache: DisplayNameCache;
    compiledStreamingText: string | null;
    centerAvatar: Character | null;
    parentMessageId: string | null;
    parentInteractionDataName: string | null;
    chatHistoryRef: React.RefObject<HTMLDivElement>;
    messageEndRef: React.RefObject<HTMLDivElement>;
    editTextAreaRef: React.RefObject<HTMLTextAreaElement>;
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
    suppressNextClickRef: React.MutableRefObject<boolean>;
    onNavigateToBranchSource: () => void;
    canDelete: boolean;
}