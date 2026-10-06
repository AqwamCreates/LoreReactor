// frontend-src/hooks/useEntityModals.ts
import { useState, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import type { entityType, Entity } from '../types';
interface EntityConfiguration<T> {
    saveFunction: (item: T) => Promise<boolean>;
    deleteFunction?: (identifier: string) => Promise<boolean>;
    entityLabel: string;
}

export function useEntityModals(entityConfigurations: Record<entityType, EntityConfiguration<any>>) {
    const { addToast } = useToast();
    
    const [activeModal, setActiveModal] = useState<{ 
        entityType: entityType; 
        item: Entity | null; 
        isReadOnly: boolean;
    } | null>(null);

    const openModal = useCallback((entityType: entityType, item?: Entity, isReadOnly = false) => {
        setActiveModal({ entityType, item: item || null, isReadOnly });
    }, []);

    const closeModal = useCallback(() => {
        setActiveModal(null);
    }, []);

    const save = useCallback(async (item: Entity) => {
        if (!activeModal) return;
        const configuration = entityConfigurations[activeModal.entityType];
        const isSuccessful = await configuration.saveFunction(item);
        
        if (isSuccessful) {
            addToast(`${configuration.entityLabel} saved successfully!`, 'success');
            closeModal();
        } else {
            addToast(`Failed to save ${configuration.entityLabel.toLowerCase()}.`, 'error');
        }
    }, [activeModal, entityConfigurations, addToast, closeModal]);

    const deleteEntity = useCallback(async (identifier: string, entityTypeOverride?: entityType) => {
        const targetEntityType = entityTypeOverride || activeModal?.entityType;
        if (!targetEntityType) return;
        const configuration = entityConfigurations[targetEntityType];
        if (!configuration.deleteFunction) return;

        if (!window.confirm(`Delete this ${configuration.entityLabel.toLowerCase()}?`)) return;

        const isSuccessful = await configuration.deleteFunction(identifier);
        if (isSuccessful) {
            addToast(`${configuration.entityLabel} deleted.`, 'info');
            if (activeModal?.entityType === targetEntityType) {
                closeModal();
            }
        } else {
            addToast(`Failed to delete ${configuration.entityLabel.toLowerCase()}.`, 'error');
        }
    }, [activeModal, entityConfigurations, addToast, closeModal]);

    const getModalProperties = (entityType: entityType) => ({
        isOpen: activeModal?.entityType === entityType,
        item: activeModal?.entityType === entityType ? activeModal.item : null,
        isReadOnly: activeModal?.entityType === entityType ? activeModal.isReadOnly : false, // <-- ADDED THIS
        open: (item?: Entity, isReadOnly?: boolean) => openModal(entityType, item, isReadOnly ?? false),
        close: closeModal,
        save,
        delete: (identifier: string) => deleteEntity(identifier, entityType),
    });

    return {
        activeModal,
        openModal,
        closeModal,
        save,
        delete: deleteEntity,
        getModalProperties,
    };
}