// src/hooks/useEntityToggles.ts
import { useCallback } from 'react';
import type { Character, Context, Location, AudioTrack, Profile, BudgetStrategy, InteractionData, MultiplayerData } from '../types';
import { loadRawContext, loadRawLocation, loadRawAudioTrack, saveRawMultiplayerData } from '../storages/serverStorage';
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
                
                const updatedProtagonists = (interactionData.protagonists || []).filter(p => p.id !== charId);
                const newActiveProtagonist = updatedProtagonists[0];
                
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
                setSelectedCharacterId(newActiveProtagonist.id);
                addToast('Protagonist removed.', 'info');
            } else {
                const np = interactionData.participants.filter(p => p.id !== charId);
                
                const hasChatMessages = interactionData.interactionHistory.some(
                    m => m.character.id === charId && m.messageType === 'chat'
                );
                
                const cleanedHistory = hasChatMessages
                    ? interactionData.interactionHistory
                    : interactionData.interactionHistory.filter(m => m.character.id !== charId);

                const updatedData: InteractionData = {
                    ...interactionData,
                    participants: np,
                    interactionHistory: cleanedHistory,
                    lastUpdatedTimestamp: Date.now(),
                };
                
                setInteractionData(updatedData);
                addToast('Participant removed.', 'info');
            }
        } else {
            // ─── ADDING ──────────────────────────────────────────────
            const sh = allCharacters.find(c => c.id === charId);
            if (!sh) return;

            let ch: Character | null = null;
            try {
                ch = sh.sampler ? sh : await loadFullCharacter(charId);
            } catch (e) {
                console.error('[useEntityToggles] Failed to load character:', e);
            }
            if (!ch) return;
            
            const np = [...interactionData.participants, ch];
            let updatedData = { ...interactionData, participants: np, lastUpdatedTimestamp: Date.now() };
            updatedData = assignInitialLocationsIfNeeded(updatedData);
            
            setInteractionData(updatedData);
            addToast('Participant added.', 'info');
        }
    }, [interactionData, allCharacters, setInteractionData, setSelectedCharacter, setSelectedCharacterId, loadFullCharacter, addToast]);

    const handleToggleContext = useCallback(async (contextId: string) => {
        if (!interactionData) return;
        const currentContexts = interactionData.contexts || [];
        const ids = currentContexts.map(c => c.id);

        try {
            let nc: Context[];
            if (ids.includes(contextId)) {
                nc = currentContexts.filter(c => c.id !== contextId);
            } else {
                const loaded = await loadRawContext(contextId);
                nc = loaded ? [...currentContexts, loaded] : currentContexts;
            }

            setInteractionData({ ...interactionData, contexts: nc, lastUpdatedTimestamp: Date.now() });
            addToast('Contexts updated.', 'info');
        } catch (e) {
            console.error('[useEntityToggles] Context toggle error:', e);
            addToast('Failed to update context.', 'error');
        }
    }, [interactionData, setInteractionData, addToast]);

    const handleToggleLocation = useCallback(async (locationId: string) => {
        if (!interactionData) return;
        const currentLocations = interactionData.locations || [];
        const ids = currentLocations.map(l => l.id);

        try {
            let nl: Location[];
            if (ids.includes(locationId)) {
                nl = currentLocations.filter(l => l.id !== locationId);
            } else {
                const loaded = await loadRawLocation(locationId);
                nl = loaded ? [...currentLocations, loaded] : currentLocations;
            }

            setInteractionData({ ...interactionData, locations: nl, lastUpdatedTimestamp: Date.now() });
            addToast('Locations updated.', 'info');
        } catch (e) {
            console.error('[useEntityToggles] Location toggle error:', e);
            addToast('Failed to update location.', 'error');
        }
    }, [interactionData, setInteractionData, addToast]);

    const handleToggleAudioTrack = useCallback(async (trackId: string) => {
        if (!interactionData) return;
        const currentTracks = interactionData.audioTracks || [];
        const ids = currentTracks.map(t => t.id);

        try {
            let nt: AudioTrack[];
            if (ids.includes(trackId)) {
                nt = currentTracks.filter(t => t.id !== trackId);
            } else {
                const loaded = await loadRawAudioTrack(trackId);
                nt = loaded ? [...currentTracks, loaded] : currentTracks;
            }

            setInteractionData({ ...interactionData, audioTracks: nt, lastUpdatedTimestamp: Date.now() });
            addToast('Audio tracks updated.', 'info');
        } catch (e) {
            console.error('[useEntityToggles] Audio track toggle error:', e);
            addToast('Failed to update audio track.', 'error');
        }
    }, [interactionData, setInteractionData, addToast]);

    const handleSetChatProtagonist = useCallback(async (charId: string) => {
        if (!interactionData) return;
        const sh = allCharacters.find(c => c.id === charId);
        if (!sh) return;

        let ch: Character | null = null;
        try {
            ch = sh.sampler ? sh : await loadFullCharacter(charId);
        } catch (e) {
            console.error('[useEntityToggles] Failed to load character:', e);
        }
        if (!ch) return;

        const updatedProtagonists = interactionData.protagonists ? [...interactionData.protagonists] : [];
        const existingIdx = updatedProtagonists.findIndex(p => p.id === charId);
        if (existingIdx === -1) {
            updatedProtagonists.unshift(ch);
        } else if (existingIdx > 0) {
            const [moved] = updatedProtagonists.splice(existingIdx, 1);
            updatedProtagonists.unshift(moved);
        }

        // Update and persist room configuration for the active account
        let updatedMultiplayerData: MultiplayerData | undefined = multiplayerData ? { ...multiplayerData } : undefined;
        if (currentAccountId) {
            if (!updatedMultiplayerData) {
                updatedMultiplayerData = createDefaultMultiplayerData();
            }
            const existingCfg = updatedMultiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId] || {
                isWhitelisted: true, isBlacklisted: false, isAdministrator: false,
                canUseJoinerCharacterIds: true, canUseHosterCharacterId: true,
                joinerCharacterIdsRequiresHosterApproval: false, hosterCharacterIdsRequiresHosterApproval: false,
                whitelistedCharacterIds: [], blacklistedCharacterIds: [], pendingCharacterIds: []
            };
            
            updatedMultiplayerData = {
                ...updatedMultiplayerData,
                multiplayerDataAccountConfigurations: {
                    ...(updatedMultiplayerData.multiplayerDataAccountConfigurations ?? {}),
                    [currentAccountId]: {
                        ...existingCfg,
                        protagonistCharacterId: charId,
                    }
                },
                lastUpdatedTimestamp: Date.now(),
            };

            useSessionStore.setState({ multiplayerData: updatedMultiplayerData });
            saveRawMultiplayerData(updatedMultiplayerData).catch((e: unknown) => {
                console.error('[useEntityToggles] Failed to save multiplayer data:', e);
            });
        }

        let uc: InteractionData = {
            ...interactionData,
            protagonists: updatedProtagonists,
            lastUpdatedTimestamp: Date.now(),
        };

        if (!uc.participants.find(p => p.id === charId)) {
            uc.participants = [ch, ...uc.participants];
        }

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