// src/hooks/useEntityToggles.ts
import { useCallback } from 'react';
import type { Character, Context, Location, Extension, Profile, BudgetStrategy, InteractionData } from '../types';
import { saveRawInteractionData, loadRawContext, loadRawLocation } from './storage';

interface UseEntityTogglesOptions {
    interactionData: InteractionData | null;
    allCharacters: Character[];
    allContexts: Context[];
    allExtensions: Extension[];
    allProfiles: Profile[];
    allBudgetStrategies: BudgetStrategy[];
    setInteractionData: (data: InteractionData) => void;
    setCurrentCharacter: (char: Character | null) => void;
    setActiveBudgetStrategy: (strategy: BudgetStrategy | null) => void;
    selectedBudgetStrategyId: string | null;
    setSelectedBudgetStrategyId: (id: string | null) => void;
    setDefaultCharacterId: (id: string | null) => void;
    loadFullCharacter: (id: string) => Promise<Character | null>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useEntityToggles(options: UseEntityTogglesOptions) {
    const {
        interactionData, allCharacters, allContexts, allExtensions,
        allProfiles, allBudgetStrategies,
        setInteractionData, setCurrentCharacter, setActiveBudgetStrategy,
        selectedBudgetStrategyId,
        setSelectedBudgetStrategyId, setDefaultCharacterId,
        loadFullCharacter, addToast,
    } = options;

    const handleToggleParticipant = useCallback(async (charId: string) => {
        if (!interactionData) return;
        if (charId === interactionData.protagonist?.id) { addToast('Cannot remove the protagonist.', 'error'); return; }
        const ids = interactionData.participants.map(p => p.id);
        let np: Character[];
        if (ids.includes(charId)) {
            np = interactionData.participants.filter(p => p.id !== charId);
        } else {
            const sh = allCharacters.find(c => c.id === charId);
            if (!sh) return;
            const ch = sh.sampler ? sh : await loadFullCharacter(charId);
            if (!ch) return;
            np = [...interactionData.participants, ch];
        }
        if (!np.find(p => p.id === interactionData.protagonist?.id)) np.unshift(interactionData.protagonist);
        const uc = { ...interactionData, participants: np };
        setInteractionData(uc);
        if (!np.find(p => p.id === interactionData.protagonist?.id)) setCurrentCharacter(uc.protagonist);
        addToast('Participants updated.', 'info');
    }, [interactionData, allCharacters, setInteractionData, setCurrentCharacter, loadFullCharacter, addToast]);

    const handleToggleContext = useCallback(async (contextId: string) => {
        if (!interactionData?.contexts) return;
        const ids = interactionData.contexts.map(c => c.id);
        const nc = ids.includes(contextId)
            ? interactionData.contexts.filter(c => c.id !== contextId)
            : [...interactionData.contexts, await loadRawContext(contextId)].filter(Boolean) as Context[];
        setInteractionData({ ...interactionData, contexts: nc });
        addToast('Contexts updated.', 'info');
    }, [interactionData, setInteractionData, addToast]);

    const handleToggleLocation = useCallback(async (locationId: string) => {
        if (!interactionData) return;
        const currentLocations = interactionData.locations || [];
        const ids = currentLocations.map(l => l.id);
        const nl = ids.includes(locationId)
            ? currentLocations.filter(l => l.id !== locationId)
            : [...currentLocations, await loadRawLocation(locationId)].filter(Boolean) as Location[];
        setInteractionData({ ...interactionData, locations: nl });
        addToast('Locations updated.', 'info');
    }, [interactionData, setInteractionData, addToast]);

    const handleSetChatProtagonist = useCallback(async (charId: string) => {
        if (!interactionData) return;
        const sh = allCharacters.find(c => c.id === charId);
        if (!sh) return;
        const ch = sh.sampler ? sh : await loadFullCharacter(charId);
        if (!ch) return;
        const uc = { ...interactionData, protagonist: ch };
        if (!uc.participants.find(p => p.id === charId)) uc.participants = [ch, ...uc.participants];
        setInteractionData(uc);
        setCurrentCharacter(ch);
        setDefaultCharacterId(charId);
        addToast('Protagonist switched.', 'info');
    }, [interactionData, allCharacters, setInteractionData, setCurrentCharacter, setDefaultCharacterId, loadFullCharacter, addToast]);

    const handleToggleExtension = useCallback(async (extId: string) => {
        if (!interactionData) return;
        const extensionValue = Object.getOwnPropertyDescriptor(interactionData, 'extensions')?.value;
        const currentExtensions = Array.isArray(extensionValue)
            ? extensionValue.filter((extension): extension is Extension => typeof extension === 'object' && extension !== null && 'id' in extension && typeof extension.id === 'string')
            : [];
        const currentExtensionIds = currentExtensions.map(extension => extension.id);
        const nextExtensionIds = currentExtensionIds.includes(extId)
            ? currentExtensionIds.filter(id => id !== extId)
            : [...currentExtensionIds, extId];
        setInteractionData({ ...interactionData, extensions: allExtensions.filter(extension => nextExtensionIds.includes(extension.id)) });
        addToast('Extensions updated.', 'info');
    }, [interactionData, allExtensions, setInteractionData, addToast]);

    const handleActivateBudgetStrategy = useCallback((sid: string) => {
        if (selectedBudgetStrategyId === sid) {
            setSelectedBudgetStrategyId(null);
            setActiveBudgetStrategy(null);  // ← This line is missing
            addToast('Budget strategy deactivated.', 'info');
        } else {
            setSelectedBudgetStrategyId(sid);
            addToast(`Budget strategy "${allBudgetStrategies.find(s => s.id === sid)?.name}" activated!`, 'success');
        }
    }, [selectedBudgetStrategyId, allBudgetStrategies, setSelectedBudgetStrategyId, setActiveBudgetStrategy, addToast]);

    const handleActivateProfile = useCallback(async (pid: string) => {
        if (!interactionData) return;
        if (interactionData.Profile?.id === pid) {
            const uc = { ...interactionData, Profile: undefined };
            setInteractionData(uc);
            await saveRawInteractionData(uc);
            addToast('Profile deactivated.', 'info');
        } else {
            const p = allProfiles.find(x => x.id === pid);
            if (!p) return;
            const uc = { ...interactionData, Profile: p };
            setInteractionData(uc);
            await saveRawInteractionData(uc);
            addToast(`Profile "${p.name}" activated!`, 'success');
        }
    }, [interactionData, allProfiles, setInteractionData, addToast]);

    return {
        handleToggleParticipant,
        handleToggleContext,
        handleToggleLocation,
        handleSetChatProtagonist,
        handleToggleExtension,
        handleActivateBudgetStrategy,
        handleActivateProfile,
    };
}