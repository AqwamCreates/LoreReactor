// src/components/views/types.ts
import type { Character, InteractionData, ChatMessage } from '../../types';

export interface ViewModeProps {
    interactionData: InteractionData;
    displayMessages: ChatMessage[];
    currentCharacterId: string | undefined;
    editingId: string | null;
    editDraft: string;
    massDeleteId: string | null;
    isMassActive: boolean;
    massStartIndex: number | null;
    activeToolbarId: string | null;
    portraitUrlCache: Map<string, string>;
    displayNameCache: Map<string, string>;
    formattedStreamingText: string | null;
    isLoading: boolean;
    streamingPortraitUrl: string | null;
    streamingCharacter: Character | null;
    centerAvatar: Character | null;
    chatHistoryRef: React.RefObject<HTMLDivElement>;
    messageEndRef: React.RefObject<HTMLDivElement>;
    editTextareaRef: React.RefObject<HTMLTextAreaElement>;
    parentInteractionMessageId: string | null;
    locationBackgroundUrl: string | null;
    
    // NEW: Shared focused message state
    focusedMessageId: string | null;
    setFocusedMessageId: (id: string | null) => void;
    
    onAvatarClick: (e: React.MouseEvent, id: string, character?: Character) => void;
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
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    suppressNextClickRef: React.MutableRefObject<boolean>;
    setEditDraft: (text: string) => void;
    onNavigateToBranchSource: () => void;
}