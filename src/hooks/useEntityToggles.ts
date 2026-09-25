// src/hooks/useEntityToggles.ts
import { useCallback } from 'react';
import type { Character, Context, Location, AudioTrack, Profile, BudgetStrategy, InteractionData, MultiplayerData } from '../types';
import { saveRawInteractionData, loadRawContext, loadRawLocation, loadRawAudioTrack } from '../storage/serverStorage';
import { assignInitialLocationsIfNeeded } from './locationLogic';
import { useSessionStore } from './useSessionStore';
import { createDefaultMultiplayerData } from '../dictionaries/defaults';

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

    const currentAccountId = useSessionStore(s => s.currentAccountId);
    const multiplayerData = useSessionStore(s => s.multiplayerData);

    /** Get the protagonist IDs for the current user from centralized multiplayerData */
    const getMyProtagonistIds = useCallback((): string[] => {
        if (!interactionData?.protagonists?.length) return [];
        if (!multiplayerData || !currentAccountId) {
            // No multiplayer data or no account: first protagonist
            return [interactionData.protagonists[0].id];
        }
        const myCharId = multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.activeCharacterId;
        if (myCharId) {
            const found = interactionData.protagonists.find(p => p.id === myCharId);
            if (found) return [found.id];
        }
        // Multiplayer but no mapping for this account: first protagonist
        return [interactionData.protagonists[0].id];
    }, [interactionData, multiplayerData, currentAccountId]);

    const handleToggleParticipant = useCallback(async (charId: string) => {
        if (!interactionData) return;
        const myProtagonistIds = getMyProtagonistIds();
        if (myProtagonistIds.includes(charId)) { addToast('Cannot remove your protagonist.', 'error'); return; }
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

        // Ensure all protagonists are in participants
        if (updatedData.protagonists) {
            for (const protag of updatedData.protagonists) {
                if (!np.find(p => p.id === protag.id)) {
                    np.unshift(protag);
                }
            }
            updatedData = { ...updatedData, participants: np };
        }

        setInteractionData(updatedData);
        addToast('Participants updated.', 'info');
    }, [interactionData, allCharacters, getMyProtagonistIds, setInteractionData, loadFullCharacter, addToast]);

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

        // Update protagonists array: add if not present
        const updatedProtagonists = interactionData.protagonists ? [...interactionData.protagonists] : [];
        if (!updatedProtagonists.find(p => p.id === charId)) {
            updatedProtagonists.push(ch);
        }

        // Update multiplayerDataAccountConfigurations mapping in centralized multiplayerData
        let updatedMultiplayerData: MultiplayerData | undefined = multiplayerData ? { ...multiplayerData } : undefined;
        if (currentAccountId) {
            if (!updatedMultiplayerData) {
                updatedMultiplayerData = createDefaultMultiplayerData();
            }
            const existingCfg = updatedMultiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId] || {
                isWhitelisted: true, isBlacklisted: false, isAdministrator: false,
                canUseJoinerCharacterId: true, canUseHosterCharacterId: true,
                joinerCharacterIdRequiresHosterApproval: false, hosterCharacterIdRequiresHosterApproval: false,
                whitelistedCharacterIds: [], blacklistedCharacterIds: [], pendingCharacterIds: []
            };
            
            updatedMultiplayerData = {
                ...updatedMultiplayerData,
                multiplayerDataAccountConfigurations: {
                    ...(updatedMultiplayerData.multiplayerDataAccountConfigurations ?? {}),
                    [currentAccountId]: {
                        ...existingCfg,
                        activeCharacterId: charId,
                    }
                },
            };
        }

        // Persist updated multiplayerData to store
        if (updatedMultiplayerData) {
            useSessionStore.setState({ multiplayerData: updatedMultiplayerData });
        }

        let uc: InteractionData = {
            ...interactionData,
            protagonists: updatedProtagonists,
        };
        if (!uc.participants.find(p => p.id === charId)) uc.participants = [ch, ...uc.participants];
        // Ensure new protagonist has a location assigned
        uc = assignInitialLocationsIfNeeded(uc);
        setInteractionData(uc);
        setCurrentCharacter(ch);
        setDefaultCharacterId(charId);
        addToast('Protagonist switched.', 'info');
    }, [interactionData, allCharacters, currentAccountId, multiplayerData, setInteractionData, setCurrentCharacter, setDefaultCharacterId, loadFullCharacter, addToast]);

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