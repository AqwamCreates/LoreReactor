// src/hooks/useModalVisibility.ts
import { useState, useCallback } from 'react';

interface ModalState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export interface ModalVisibility {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export function useModal(initial = false): [ModalState, React.Dispatch<React.SetStateAction<boolean>>] {
    const [isOpen, setIsOpen] = useState(initial);

    const state: ModalState = {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
    };

    return [state, setIsOpen];
}

function createModalState(
    isOpen: boolean,
    setOpen: (v: boolean) => void,
): ModalVisibility {
    return {
        isOpen,
        open: () => setOpen(true),
        close: () => setOpen(false),
    };
}

export function useModalVisibility() {
    const [chatList, setChatListOpen] = useState(false);
    const [charList, setCharListOpen] = useState(false);
    const [contextList, setContextListOpen] = useState(false);
    const [locationList, setLocationListOpen] = useState(false);
    const [audioTrackList, setAudioTrackListOpen] = useState(false);
    const [modelList, setModelListOpen] = useState(false);
    const [samplerList, setSamplerListOpen] = useState(false);
    const [promptBlockList, setPromptBlockListOpen] = useState(false);
    const [stopList, setStopListOpen] = useState(false);
    const [budgetStrategyList, setBudgetStrategyListOpen] = useState(false);
    const [profileList, setProfileListOpen] = useState(false);
    const [extList, setExtensionListOpen] = useState(false);
    const [settings, setSettingsOpen] = useState(false);
    const [worldManager, setWorldManagerOpen] = useState(false);
    const [participantControl, setParticipantControlOpen] = useState(false);
    const [aiRecommendation, setAiRecommendationOpen] = useState(false);
    const [cardImport, setCardImportOpen] = useState(false);
    const [importData, setImportDataOpen] = useState(false);
    const [exportData, setExportDataOpen] = useState(false);
    const [budgetControl, setBudgetControlOpen] = useState(false);
    const [branchingVisualization, setBranchingVisualizationOpen] = useState(false);

    const closeAll = useCallback(() => {
        setChatListOpen(false);
        setCharListOpen(false);
        setContextListOpen(false);
        setLocationListOpen(false);
        setAudioTrackListOpen(false);
        setModelListOpen(false);
        setSamplerListOpen(false);
        setPromptBlockListOpen(false);
        setStopListOpen(false);
        setBudgetStrategyListOpen(false);
        setProfileListOpen(false);
        setExtensionListOpen(false);
        setSettingsOpen(false);
        setWorldManagerOpen(false);
        setParticipantControlOpen(false);
        setAiRecommendationOpen(false);
        setCardImportOpen(false);
        setImportDataOpen(false);
        setExportDataOpen(false);
        setBudgetControlOpen(false);
        setBranchingVisualizationOpen(false);
    }, []);

    const modals: Record<string, ModalVisibility> = {
        chatList: createModalState(chatList, setChatListOpen),
        charList: createModalState(charList, setCharListOpen),
        contextList: createModalState(contextList, setContextListOpen),
        locationList: createModalState(locationList, setLocationListOpen),
        audioTrackList: createModalState(audioTrackList, setAudioTrackListOpen),
        modelList: createModalState(modelList, setModelListOpen),
        samplerList: createModalState(samplerList, setSamplerListOpen),
        promptBlockList: createModalState(promptBlockList, setPromptBlockListOpen),
        stopList: createModalState(stopList, setStopListOpen),
        budgetStrategyList: createModalState(budgetStrategyList, setBudgetStrategyListOpen),
        profileList: createModalState(profileList, setProfileListOpen),
        extList: createModalState(extList, setExtensionListOpen),
        settings: createModalState(settings, setSettingsOpen),
        worldManager: createModalState(worldManager, setWorldManagerOpen),
        participantControl: createModalState(participantControl, setParticipantControlOpen),
        aiRecommendation: createModalState(aiRecommendation, setAiRecommendationOpen),
        cardImport: createModalState(cardImport, setCardImportOpen),
        importData: createModalState(importData, setImportDataOpen),
        exportData: createModalState(exportData, setExportDataOpen),
        budgetControl: createModalState(budgetControl, setBudgetControlOpen),
        branchingVisualization: createModalState(branchingVisualization, setBranchingVisualizationOpen),
    };

    return { modals, closeAll };
}