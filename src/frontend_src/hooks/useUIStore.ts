// src/frontend_src/hooks/useUIStore.ts
import { create } from 'zustand';

interface UIState {
    editingId: string | null;
    editDraft: string;
    massDeleteId: string | null;
    activeToolbarId: string | null;

    setEditingState: (id: string | null, draft?: string) => void;
    setEditDraft: (draft: string) => void;
    setMassDeleteId: (id: string | null) => void;
    setActiveToolbarId: (id: string | null) => void;
}

export const useUIStore = create<UIState>()((set, get) => ({
    editingId: null,
    editDraft: '',
    massDeleteId: null,
    activeToolbarId: null,

    setEditingState: (id, draft = '') => set({ 
        editingId: id, 
        editDraft: draft,
        activeToolbarId: id ? null : get().activeToolbarId 
    }),
    setEditDraft: (draft) => set({ editDraft: draft }),
    setMassDeleteId: (id) => set({ massDeleteId: id }),
    setActiveToolbarId: (id) => set({ activeToolbarId: id }),
}));