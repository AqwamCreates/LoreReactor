// src/components/views/types.ts
import type React from 'react';
import type { Character, InteractionData, ChatMessage } from '../../types';
import type { DisplayNameCache } from '../../hooks/immersionLogic';

export interface ViewModeProps {
    interactionData: InteractionData;
    localProtagonist: Character;
    displayMessages: ChatMessage[];
    currentCharacterId: string | undefined;
    editingId: string | null;
    editDraft: string;
    massDeleteId: string | null;
    isMassActive: boolean;
    massStartIndex: number | null;
    activeToolbarId: string | null;
    portraitUrlCache: Map<string, string | null>;
    displayNameCache: DisplayNameCache | null;
    formattedStreamingText: React.ReactNode | null;
    isLoading: boolean;
    streamingPortraitUrl: string | null;
    streamingCharacter: Character | null;
    centerAvatar: Character | null;
    chatHistoryRef: React.RefObject<HTMLDivElement | null>;
    messageEndRef: React.RefObject<HTMLDivElement | null>;
    editTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
    parentInteractionMessageId: string | null;
    locationBackgroundUrl: string | null;
    parentInteractionDataName?: string | null;

    focusedMessageId: string | null;
    setFocusedMessageId: (id: string | null) => void;

    onAvatarClick: (e: React.MouseEvent, id: string, character: Character) => void;
    onStartEditing: (id: string, text: string) => void;
    onCancelEditing: () => void;
    onSaveEdit: () => void;
    onRegenerateFromEdit: () => void;
    onResumeGeneration: (id: string) => void;
    onCopyText: (text: string) => void;
    onRegenerateFromMessage: (id: string, protagonists: Character[]) => void;
    onBranch: (id: string) => void;
    onClone: (id: string) => void;
    onDelete: (id: string) => void;
    onSetMassDelete: (id: string) => void;
    onMassDeleteConfirm: () => void;
    onCancelMassDelete: () => void;
    onTouchStart: (e: React.TouchEvent, id: string) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    suppressNextClickRef: React.MutableRefObject<boolean>;
    setEditDraft: (text: string) => void;
    onNavigateToBranchSource: () => void;
    isEditingTitle: boolean;
    editTitleValue: string;
    onStartEditTitle: (e: React.MouseEvent) => void;
    onSaveTitle: () => void;
    onCancelEditTitle: () => void;
    setEditTitleValue: (v: string) => void;
    characterScales: Map<string, number>;
    closeActionMenu: () => void;
    deactivateToolbar: () => void;
    onStopGeneration: () => void;
}