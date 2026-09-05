// src/hooks/useEntityModal.ts
import { useState, useCallback } from 'react';
import { useToast } from '../context/ToastContext';

export function useEntityModal<T>(
    saveFn: (item: T) => Promise<boolean>,
    deleteFn?: (id: string) => Promise<boolean>,
    entityType = 'Item'
    ) {
    const { addToast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [itemToEdit, setItemToEdit] = useState<T | null>(null);

    const open = useCallback((item?: T) => {
        setItemToEdit(item || null);
        setIsOpen(true);
    }, []);

    const close = useCallback(() => {
        setIsOpen(false);
        setItemToEdit(null);
    }, []);

    const handleSave = useCallback(async (item: T) => {
        const success = await saveFn(item);
        if (success) {
        addToast(`${entityType} saved successfully!`, 'success');
        close();
        } else {
        addToast(`Failed to save ${entityType.toLowerCase()}.`, 'error');
        }
    }, [saveFn, entityType, addToast, close]);

    const handleDelete = useCallback(async (id: string) => {
        if (!deleteFn) return;
        if (!window.confirm(`Delete this ${entityType.toLowerCase()}?`)) return;
        
        const success = await deleteFn(id);
        if (success) {
        addToast(`${entityType} deleted.`, 'info');
        } else {
        addToast(`Failed to delete ${entityType.toLowerCase()}.`, 'error');
        }
    }, [deleteFn, entityType, addToast]);

    return {
        isOpen,
        itemToEdit,
        open,
        close,
        handleSave,
        handleDelete
    };
}