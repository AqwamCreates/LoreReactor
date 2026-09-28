// src/hooks/useEntityToggles.ts
import { useCallback } from 'react';
import type { Character, Context, Location, AudioTrack, Profile, BudgetStrategy, InteractionData, MultiplayerData } from '../types';
import { loadRawContext, loadRawLocation, loadRawAudioTrack } from '../storages/serverStorage';
import { assignInitialLocationsIfNeeded } from '../utilities/locationLogic';
import { useSessionStore } from './useSessionStore';
import { createDefaultMultiplayerData } from '../dictionaries/defaults';

interface UseEntityTogglesOptions {
    interactionData: InteractionData | null;
    allCharacters: Character[];
    activeExtensionIds: string[];
    setActiveExtensionIds: (ids: string[]) => void;
    allProfiles: Profile[];
    allBudgetStrategies: BudgetStrategy[];
    setInteractionData: (data: InteractionData) => void;
    setSelectedCharacter: (char: Character | null) => void;
    setActiveBudgetStrategy: (strategy: BudgetStrategy | null) => void;
    selectedBudgetStrategyId: string | null;
    setSelectedBudgetStrategyId: (id: string | null) => void;
    setSelectedCharacterId: (id: string | null) => void;
    loadFullCharacter: (id: string) => Promise<Character | null>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useEntityToggles(options: UseEntityTogglesOptions) {
    const {
        interactionData, allCharacters,
        activeExtensionIds, setActiveExtensionIds,
        allProfiles, allBudgetStrategies,
        setInteractionData, setSelectedCharacter, setActiveBudgetStrategy,
        selectedBudgetStrategyId,
        setSelectedBudgetStrategyId, setSelectedCharacterId,
        loadFullCharacter, addToast,
    } = options;

    const currentAccountId = useSessionStore(s => s.currentAccountId);
    const multiplayerData = useSessionStore(s => s.multiplayerData);

    const handleToggleParticipant = useCallback(async (charId: string) => {
        if (!interactionData) return;
        
        const isParticipant = interactionData.participants.some(p => p.id === charId);
        const isProtagonist = interactionData.protagonists?.some(p => p.id === charId) ?? false;

        if (isParticipant) {
            // ─── REMOVING ────────────────────────────────────────────
            if (isProtagonist) {
                const protagonistCount = interactionData.protagonists?.length || 0;
                if (protagonistCount <= 1) {
                    addToast('Cannot remove the only protagonist.', 'error');
                    return;
                }
                
                // Remove from protagonists array as well
                const updatedProtagonists = (interactionData.protagonists || []).filter(p => p.id !== charId);
                const newActiveProtagonist = updatedProtagonists[0];
                
                // Clean up orphaned silent interaction messages
                const hasChatMessages = interactionData.interactionHistory.some(
                    m => m.character.id === charId && m.messageType === 'chat'
                );
                const updatedHistory = hasChatMessages 
                    ? interactionData.interactionHistory 
                    : interactionData.interactionHistory.filter(m => m.character.id !== charId);
                
                const np = interactionData.participants.filter(p => p.id !== charId);
                
                const updatedData: InteractionData = {
                    ...interactionData,
                    participants: np,
                    protagonists: updatedProtagonists,
                    interactionHistory: updatedHistory,
                    lastUpdatedTimestamp: Date.now(),
                };
                
                setInteractionData(updatedData);
                setSelectedCharacter(newActiveProtagonist);
                addToast('Protagonist removed.', 'info');
            } else {
                // Normal participant removal
                const np = interactionData.participants.filter(p => p.id !== charId);
                
                const hasChatMessages = interactionData.interactionHistory.some(
                    m => m.character.id === charId && m.messageType === 'chat'
                );
                
                let updatedData: InteractionData;
                if (!hasChatMessages) {
                    const cleanedHistory = interactionData.interactionHistory.filter(m => m.character.id !== charId);
                    updatedData = { ...interactionData, participants: np, interactionHistory: cleanedHistory, lastUpdatedTimestamp: Date.now() };
                } else {
                    updatedData = { ...interactionData, participants: np, lastUpdatedTimestamp: Date.now() };
                }
                
                setInteractionData(updatedData);
                addToast('Participant removed.', 'info');
            }
        } else {
            // ─── ADDING ──────────────────────────────────────────────
            const sh = allCharacters.find(c => c.id === charId);
            if (!sh) return;
            const ch = sh.sampler ? sh : await loadFullCharacter(charId);
            if (!ch) return;
            
            const np = [...interactionData.participants, ch];
            let updatedData = { ...interactionData, participants: np, lastUpdatedTimestamp: Date.now() };
            updatedData = assignInitialLocationsIfNeeded(updatedData);
            
            setInteractionData(updatedData);
            addToast('Participant added.', 'info');
        }
    }, [interactionData, allCharacters, setInteractionData, setSelectedCharacter, loadFullCharacter, addToast]);

    const handleToggleContext = useCallback(async (contextId: string) => {
        if (!interactionData?.contexts) return;
        const ids = interactionData.contexts.map(c => c.id);
        const nc = ids.includes(contextId)
            ? interactionData.contexts.filter(c => c.id !== contextId)
            : [...interactionData.contexts, await loadRawContext(contextId)].filter(Boolean) as Context[];
        setInteractionData({ ...interactionData, contexts: nc, lastUpdatedTimestamp: Date.now() });
        addToast('Contexts updated.', 'info');
    }, [interactionData, setInteractionData, addToast]);

    const handleToggleLocation = useCallback(async (locationId: string) => {
        if (!interactionData) return;
        const currentLocations = interactionData.locations || [];
        const ids = currentLocations.map(l => l.id);
        const nl = ids.includes(locationId)
            ? currentLocations.filter(l => l.id !== locationId)
            : [...currentLocations, await loadRawLocation(locationId)].filter(Boolean) as Location[];
        setInteractionData({ ...interactionData, locations: nl, lastUpdatedTimestamp: Date.now() });
        addToast('Locations updated.', 'info');
    }, [interactionData, setInteractionData, addToast]);

    const handleToggleAudioTrack = useCallback(async (trackId: string) => {
        if (!interactionData) return;
        const currentTracks = interactionData.audioTracks || [];
        const ids = currentTracks.map(t => t.id);
        const nt = ids.includes(trackId)
            ? currentTracks.filter(t => t.id !== trackId)
            : [...currentTracks, await loadRawAudioTrack(trackId)].filter(Boolean) as AudioTrack[];
        setInteractionData({ ...interactionData, audioTracks: nt, lastUpdatedTimestamp: Date.now() });
        addToast('Audio tracks updated.', 'info');
    }, [interactionData, setInteractionData, addToast]);

    const handleSetChatProtagonist = useCallback(async (charId: string) => {
        if (!interactionData) return;
        const sh = allCharacters.find(c => c.id === charId);
        if (!sh) return;
        const ch = sh.sampler ? sh : await loadFullCharacter(charId);
        if (!ch) return;

        // Update protagonists array: add if not present, then move to front
        const updatedProtagonists = interactionData.protagonists ? [...interactionData.protagonists] : [];
        const existingIdx = updatedProtagonists.findIndex(p => p.id === charId);
        if (existingIdx === -1) {
            updatedProtagonists.unshift(ch);
        } else if (existingIdx > 0) {
            const [moved] = updatedProtagonists.splice(existingIdx, 1);
            updatedProtagonists.unshift(moved);
        }

        // Update multiplayerDataAccountConfigurations mapping
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

        if (updatedMultiplayerData) {
            useSessionStore.setState({ multiplayerData: updatedMultiplayerData });
        }

        let uc: InteractionData = {
            ...interactionData,
            protagonists: updatedProtagonists,
            lastUpdatedTimestamp: Date.now(),
        };
        if (!uc.participants.find(p => p.id === charId)) uc.participants = [ch, ...uc.participants];
        uc = assignInitialLocationsIfNeeded(uc);
        setInteractionData(uc);
        setSelectedCharacter(ch);
        setSelectedCharacterId(charId);
        addToast(`Switched to ${ch.name}.`, 'success');
    }, [interactionData, allCharacters, currentAccountId, multiplayerData, setInteractionData, setSelectedCharacter, setSelectedCharacterId, loadFullCharacter, addToast]);

    const handleToggleExtension = useCallback((extId: string) => {
        const nextIds = activeExtensionIds.includes(extId)
            ? activeExtensionIds.filter(id => id !== extId)
            : [...activeExtensionIds, extId];
        setActiveExtensionIds(nextIds);
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

    const handleActivateProfile = useCallback((pid: string) => {
        if (!interactionData) return;
        if (interactionData.Profile?.id === pid) {
            const uc = { ...interactionData, Profile: undefined, lastUpdatedTimestamp: Date.now() };
            setInteractionData(uc);
            addToast('Profile deactivated.', 'info');
        } else {
            const p = allProfiles.find(x => x.id === pid);
            if (!p) return;
            const uc = { ...interactionData, Profile: p, lastUpdatedTimestamp: Date.now() };
            setInteractionData(uc);
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