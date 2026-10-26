// src/frontend_src/hooks/useAppModals.ts
import { useState, useCallback, useMemo } from 'react';

export type modalName =
    | 'interactionDataList'
    | 'characterList'
    | 'contextList'
    | 'locationList'
    | 'audioTrackList'
    | 'worldList'
    | 'promptBlockList'
    | 'modelList'
    | 'samplerList'
    | 'stopPatternList'
    | 'retrievalConfigurationList'
    | 'budgetStrategyList'
    | 'profileList'
    | 'extensionList'
    | 'accountList'
    | 'multiplayerDataList'
    | 'settings'
    | 'budgetControl'
    | 'participantControl'
    | 'alternateTimelines'
    | 'aiRecommendation'
    | 'restrictionReduction'
    | 'promptGuide'
    | 'cardImport'
    | 'importData'
    | 'exportData'
    | 'dataManager'
    | 'joinSession'
    | 'superSearch'
    | 'gpuMonitor'
    | 'modelInferenceManager'
    | 'chatInspection'

export interface ModalController {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
}

type ModalStateMap = Record<modalName, boolean>;

export function useAppModals() {
    const [modalStates, setModalStates] = useState<Partial<ModalStateMap>>({});

    const openModal = useCallback((name: modalName) => {
        setModalStates(prev => ({ ...prev, [name]: true }));
    }, []);

    const closeModal = useCallback((name: modalName) => {
        setModalStates(prev => ({ ...prev, [name]: false }));
    }, []);

    const toggleModal = useCallback((name: modalName) => {
        setModalStates(prev => ({ ...prev, [name]: !prev[name] }));
    }, []);

    const closeAll = useCallback(() => {
        setModalStates({});
    }, []);

    const modals = useMemo(() => {
        const names: modalName[] = [
            'interactionDataList', 'characterList', 'contextList', 'locationList', 'audioTrackList',
            'worldList', 'promptBlockList', 'modelList', 'samplerList', 'stopPatternList', 'retrievalConfigurationList',
            'budgetStrategyList', 'profileList', 'extensionList', 'accountList', 'multiplayerDataList',
            'settings', 'budgetControl', 'participantControl', 'alternateTimelines',
            'aiRecommendation', 'restrictionReduction', 'promptGuide', 'cardImport', 'importData',
            'exportData', 'dataManager', 'joinSession', 'superSearch', 'gpuMonitor', 
            'modelInferenceManager', 'chatInspection'
        ];

        const acc = {} as Record<modalName, ModalController>;
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