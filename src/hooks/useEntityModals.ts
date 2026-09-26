// src/hooks/useEntityModals.ts
import { useState, useCallback } from 'react';
import { useToast } from '../context/ToastContext';

export type EntityType = 
    | 'character' | 'context' | 'location' | 'audioTrack' 
    | 'world' | 'model' | 'sampler' | 'promptBlock' 
    | 'stopPattern' | 'budgetStrategy' | 'profile' 
    | 'account' | 'multiplayerData';

interface EntityConfiguration<T> {
    saveFunction: (item: T) => Promise<boolean>;
    deleteFunction?: (identifier: string) => Promise<boolean>;
    entityLabel: string;
}

export function useEntityModals(entityConfigurations: Record<EntityType, EntityConfiguration<any>>) {
    const { addToast } = useToast();
    const [activeModal, setActiveModal] = useState<{ entityType: EntityType; edit: any | null } | null>(null);

    const openModal = useCallback((entityType: EntityType, edit?: any) => {
        setActiveModal({ entityType, edit: edit || null });
    }, []);

    const closeModal = useCallback(() => {
        setActiveModal(null);
    }, []);

    const save = useCallback(async (item: any) => {
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

    // Internal function name avoids reserved keyword syntax errors
    const deleteEntity = useCallback(async (identifier: string, entityTypeOverride?: EntityType) => {
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

    const getModalProperties = (entityType: EntityType) => ({
        isOpen: activeModal?.entityType === entityType,
        edit: activeModal?.entityType === entityType ? activeModal.edit : null,
        open: (edit?: any) => openModal(entityType, edit),
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