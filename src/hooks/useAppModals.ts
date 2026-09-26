// src/hooks/useAppModals.ts
import { useState, useCallback, useMemo } from 'react';

export type ModalName =
    | 'chatList'
    | 'charList'
    | 'contextList'
    | 'locationList'
    | 'audioTrackList'
    | 'worldManager'
    | 'promptBlockList'
    | 'modelList'
    | 'samplerList'
    | 'stopList'
    | 'budgetStrategyList'
    | 'profileList'
    | 'extList'
    | 'accountList'
    | 'multiplayerDataList'
    | 'settings'
    | 'budgetControl'
    | 'participantControl'
    | 'alternateTimelines'
    | 'aiRecommendation'
    | 'restrictionReduction'
    | 'cardImport'
    | 'importData'
    | 'exportData'
    | 'dataManager'
    | 'joinSession'
    | 'gpuMonitor';

export interface ModalController {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
}

type ModalStateMap = Record<ModalName, boolean>;

export function useAppModals() {
    const [modalStates, setModalStates] = useState<Partial<ModalStateMap>>({});

    const openModal = useCallback((name: ModalName) => {
        setModalStates(prev => ({ ...prev, [name]: true }));
    }, []);

    const closeModal = useCallback((name: ModalName) => {
        setModalStates(prev => ({ ...prev, [name]: false }));
    }, []);

    const toggleModal = useCallback((name: ModalName) => {
        setModalStates(prev => ({ ...prev, [name]: !prev[name] }));
    }, []);

    const closeAll = useCallback(() => {
        setModalStates({});
    }, []);

    // Generate a stable dictionary of controllers for every modal type
    const modals = useMemo(() => {
        const names: ModalName[] = [
            'chatList', 'charList', 'contextList', 'locationList', 'audioTrackList',
            'worldManager', 'promptBlockList', 'modelList', 'samplerList', 'stopList',
            'budgetStrategyList', 'profileList', 'extList', 'accountList', 'multiplayerDataList',
            'settings', 'budgetControl', 'participantControl', 'alternateTimelines',
            'aiRecommendation', 'restrictionReduction', 'cardImport', 'importData',
            'exportData', 'dataManager', 'joinSession', 'gpuMonitor'
        ];

        const acc = {} as Record<ModalName, ModalController>;
        for (const name of names) {
            acc[name] = {
                isOpen: !!modalStates[name],
                open: () => openModal(name),
                close: () => closeModal(name),
                toggle: () => toggleModal(name),
            };
        }
        return acc;
    }, [modalStates, openModal, closeModal, toggleModal]);

    return { modals, closeAll };
}