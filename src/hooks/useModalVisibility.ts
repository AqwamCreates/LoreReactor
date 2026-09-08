// src/hooks/useModalVisibility.ts
import { useState, useCallback } from 'react';

interface ModalState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
}

export function useModal(initial = false): [ModalState, React.Dispatch<React.SetStateAction<boolean>>] {
    const [isOpen, setIsOpen] = useState(initial);

    const state: ModalState = {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen(prev => !prev),
    };

    return [state, setIsOpen];
}

export function useModalVisibility() {
    const [chatList, setChatListOpen] = useState(false);
    const [charList, setCharListOpen] = useState(false);
    const [contextList, setContextListOpen] = useState(false);
    const [locationList, setLocationListOpen] = useState(false);
    const [samplerList, setSamplerListOpen] = useState(false);
    const [extList, setExtListOpen] = useState(false);
    const [modelList, setModelListOpen] = useState(false);
    const [stopList, setStopListOpen] = useState(false);
    const [budgetStrategyList, setBudgetStrategyListOpen] = useState(false);
    const [profileList, setProfileListOpen] = useState(false);
    const [samplerEditor, setSamplerEditorOpen] = useState(false);
    const [settings, setSettingsOpen] = useState(false);
    const [budgetControl, setBudgetControlOpen] = useState(false);
    const [aiRecommendation, setAiRecommendationOpen] = useState(false);
    const [cardImport, setCardImportOpen] = useState(false);
    const [exportData, setExportDataOpen] = useState(false);
    const [importData, setImportDataOpen] = useState(false);
    const [participantControl, setParticipantControlOpen] = useState(false);

    // Convenience: close all panels at once
    const closeAll = useCallback(() => {
        setChatListOpen(false);
        setCharListOpen(false);
        setContextListOpen(false);
        setLocationListOpen(false);
        setSamplerListOpen(false);
        setExtListOpen(false);
        setModelListOpen(false);
        setStopListOpen(false);
        setBudgetStrategyListOpen(false);
        setProfileListOpen(false);
        setSamplerEditorOpen(false);
        setSettingsOpen(false);
        setBudgetControlOpen(false);
        setAiRecommendationOpen(false);
        setCardImportOpen(false);
        setExportDataOpen(false);
        setImportDataOpen(false);
        setParticipantControlOpen(false);
    }, []);

    return {
        chatList: { isOpen: chatList, open: () => setChatListOpen(true), close: () => setChatListOpen(false) },
        charList: { isOpen: charList, open: () => setCharListOpen(true), close: () => setCharListOpen(false) },
        contextList: { isOpen: contextList, open: () => setContextListOpen(true), close: () => setContextListOpen(false) },
        locationList: { isOpen: locationList, open: () => setLocationListOpen(true), close: () => setLocationListOpen(false) },
        samplerList: { isOpen: samplerList, open: () => setSamplerListOpen(true), close: () => setSamplerListOpen(false) },
        extList: { isOpen: extList, open: () => setExtListOpen(true), close: () => setExtListOpen(false) },
        modelList: { isOpen: modelList, open: () => setModelListOpen(true), close: () => setModelListOpen(false) },
        stopList: { isOpen: stopList, open: () => setStopListOpen(true), close: () => setStopListOpen(false) },
        budgetStrategyList: { isOpen: budgetStrategyList, open: () => setBudgetStrategyListOpen(true), close: () => setBudgetStrategyListOpen(false) },
        profileList: { isOpen: profileList, open: () => setProfileListOpen(true), close: () => setProfileListOpen(false) },
        samplerEditor: { isOpen: samplerEditor, open: () => setSamplerEditorOpen(true), close: () => setSamplerEditorOpen(false) },
        settings: { isOpen: settings, open: () => setSettingsOpen(true), close: () => setSettingsOpen(false) },
        budgetControl: { isOpen: budgetControl, open: () => setBudgetControlOpen(true), close: () => setBudgetControlOpen(false) },
        aiRecommendation: { isOpen: aiRecommendation, open: () => setAiRecommendationOpen(true), close: () => setAiRecommendationOpen(false) },
        cardImport: { isOpen: cardImport, open: () => setCardImportOpen(true), close: () => setCardImportOpen(false) },
        exportData: { isOpen: exportData, open: () => setExportDataOpen(true), close: () => setExportDataOpen(false) },
        importData: { isOpen: importData, open: () => setImportDataOpen(true), close: () => setImportDataOpen(false) },
        participantControl: { isOpen: participantControl, open: () => setParticipantControlOpen(true), close: () => setParticipantControlOpen(false) },
        closeAll,
    };
}