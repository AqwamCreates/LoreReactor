// src/hooks/useEntityToggles.ts
import { useCallback } from 'react';
import type { Character, Context, Location, AudioTrack, Profile, BudgetStrategy, InteractionData } from '../types';
import { saveRawInteractionData, loadRawContext, loadRawLocation, loadRawAudioTrack } from './storage';
import { assignInitialLocationsIfNeeded } from './locationLogic';

const EXTENSION_STORAGE_KEY = 'loreReactor_activeExtensionIds';

interface UseEntityTogglesOptions {
    interactionData: InteractionData | null;
    allCharacters: Character[];
    activeExtensionIds: string[];
    setActiveExtensionIds: (ids: string[]) => void;
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
        interactionData, allCharacters,
        activeExtensionIds, setActiveExtensionIds,
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
        let updatedData: InteractionData;

        if (ids.includes(charId)) {
            // Removing participant — clean up orphaned silent interaction messages
            np = interactionData.participants.filter(p => p.id !== charId);

            // Check if this character has any actual chat messages
            const hasChatMessages = interactionData.interactionHistory.some(
                m => m.character.id === charId && m.messageType === 'chat'
            );

            if (!hasChatMessages) {
                // Character only has silent interaction entries (location assignments) — remove them
                const cleanedHistory = interactionData.interactionHistory.filter(m => m.character.id !== charId);
                updatedData = { ...interactionData, participants: np, interactionHistory: cleanedHistory };
            } else {
                updatedData = { ...interactionData, participants: np };
            }
        } else {
            // Adding participant — assign initial location if needed
            const sh = allCharacters.find(c => c.id === charId);
            if (!sh) return;
            const ch = sh.sampler ? sh : await loadFullCharacter(charId);
            if (!ch) return;
            np = [...interactionData.participants, ch];
            updatedData = { ...interactionData, participants: np };
            // Assign initial location for newly added character
            updatedData = assignInitialLocationsIfNeeded(updatedData);
        }

        if (!np.find(p => p.id === interactionData.protagonist?.id)) np.unshift(interactionData.protagonist);
        if (!updatedData.participants.find(p => p.id === updatedData.protagonist?.id)) {
            updatedData = { ...updatedData, participants: [updatedData.protagonist, ...updatedData.participants] };
        }

        setInteractionData(updatedData);
        if (!np.find(p => p.id === interactionData.protagonist?.id)) setCurrentCharacter(updatedData.protagonist);
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

    const handleToggleAudioTrack = useCallback(async (trackId: string) => {
        if (!interactionData) return;
        const currentTracks = interactionData.audioTracks || [];
        const ids = currentTracks.map(t => t.id);
        const nt = ids.includes(trackId)
            ? currentTracks.filter(t => t.id !== trackId)
            : [...currentTracks, await loadRawAudioTrack(trackId)].filter(Boolean) as AudioTrack[];
        setInteractionData({ ...interactionData, audioTracks: nt });
        addToast('Audio tracks updated.', 'info');
    }, [interactionData, setInteractionData, addToast]);

    const handleSetChatProtagonist = useCallback(async (charId: string) => {
        if (!interactionData) return;
        const sh = allCharacters.find(c => c.id === charId);
        if (!sh) return;
        const ch = sh.sampler ? sh : await loadFullCharacter(charId);
        if (!ch) return;
        let uc: InteractionData = { ...interactionData, protagonist: ch };
        if (!uc.participants.find(p => p.id === charId)) uc.participants = [ch, ...uc.participants];
        // Ensure new protagonist has a location assigned
        uc = assignInitialLocationsIfNeeded(uc);
        setInteractionData(uc);
        setCurrentCharacter(ch);
        setDefaultCharacterId(charId);
        addToast('Protagonist switched.', 'info');
    }, [interactionData, allCharacters, setInteractionData, setCurrentCharacter, setDefaultCharacterId, loadFullCharacter, addToast]);

    const handleToggleExtension = useCallback((extId: string) => {
        const nextIds = activeExtensionIds.includes(extId)
            ? activeExtensionIds.filter(id => id !== extId)
            : [...activeExtensionIds, extId];
        setActiveExtensionIds(nextIds);
        localStorage.setItem(EXTENSION_STORAGE_KEY, JSON.stringify(nextIds));
        addToast('Extensions updated.', 'info');
    }, [activeExtensionIds, setActiveExtensionIds, addToast]);

    const handleActivateBudgetStrategy = useCallback((sid: string) => {
        if (selectedBudgetStrategyId === sid) {
            setSelectedBudgetStrategyId(null);
            setActiveBudgetStrategy(null);
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
        handleToggleAudioTrack,
        handleSetChatProtagonist,
        handleToggleExtension,
        handleActivateBudgetStrategy,
        handleActivateProfile,
    };
}