// src/frontend_src/components/views/types.ts
import type React from 'react';
import type { ChatMessage, Character } from '../../types';
import type { DisplayNameCache } from '../../utilities/immersionLogic';

export type viewMode = 'ladder' | 'cinematic' | 'visual novel';

export interface ViewModeProps {
    displayMessages: ChatMessage[];
    portraitUrlCache: Map<string, string | null>; // ✅ FIXED: Allow null values
    displayNameCache: DisplayNameCache | null; // ✅ FIXED: Allow null/any
    compiledStreamingText: string | null; 
    centerAvatar: Character | null;
    parentMessageId: string | null;
    parentInteractionDataName: string | null;
    chatHistoryRef: React.RefObject<HTMLDivElement | null>; // ✅ FIXED: Allow null
    messageEndRef: React.RefObject<HTMLDivElement | null>; // ✅ FIXED: Allow null
    editTextAreaRef: React.RefObject<HTMLTextAreaElement | null>; // ✅ FIXED: Allow null
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