// src/components/views/types.ts
import type React from 'react';
import type { Character, InteractionData, ChatMessage } from '../../types';

export interface ViewModeProps {
    interactionData: InteractionData;
    displayMessages: ChatMessage[];
    currentCharacterId: string | undefined;
    editingId: string | null;
    editDraft: string;
    massDeleteId: string | null;
    isMassActive: boolean;
    massStartIndex: number;
    activeToolbarId: string | null;
    portraitUrlCache: Map<string, string | null>;
    displayNameCache: Map<number, string> | null; // FIX: Accept null
    characterScales: Map<string, number>;
    centerAvatar: Character | null;
    streamingPortraitUrl: string | null;
    formattedStreamingText: React.ReactNode | null;
    locationBackgroundUrl: string | null;
    isLoading: boolean;
    isEditingTitle: boolean;
    editTitleValue: string;
    parentInteractionMessageId: string | null;

    // Streaming guard props
    hasPartialInHistory: boolean;
    streamingText: string;

    // Refs
    chatHistoryRef: React.RefObject<HTMLDivElement | null>;
    messageEndRef: React.RefObject<HTMLDivElement | null>;
    editTextareaRef: React.RefObject<HTMLTextAreaElement | null>;

    // Callbacks
    onAvatarClick: (e: React.MouseEvent, id: string, char: Character) => void;
    onStartEditing: (id: string, text: string) => void;
    onCancelEditing: () => void;
    onSaveEdit: () => void;
    onRegenerateFromEdit: () => void;
    onResumeGeneration: (id: string) => void;
    onCopyText: (text: string) => void;
    onRegenerateFromMessage: (id: string, type: 'ai' | 'user') => void;
    onBranch: (id: string) => void;
    onClone: (id: string) => void;
    onDelete: (id: string) => void;
    onSetMassDelete: (id: string) => void;
    onMassDeleteConfirm: () => void;
    onCancelMassDelete: () => void;
    onTouchStart: (e: React.TouchEvent, id: string) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchMove: () => void;
    suppressNextClickRef: React.MutableRefObject<boolean>;
    setEditDraft: (text: string) => void;
    onNavigateToBranchSource: () => void;
    onStartEditTitle: () => void;
    onSaveTitle: () => void;
    onCancelEditTitle: () => void;
    setEditTitleValue: (v: string) => void;
    closeActionMenu: () => void;
    deactivateToolbar: () => void;
}