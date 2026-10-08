// frontend_src/hooks/useEntityToggles.ts
import { useCallback } from 'react';
import type { Character, Context, Location, AudioTrack, Profile, BudgetStrategy, InteractionData, MultiplayerData, HistoryMessage } from '../types';
import { loadRawContext, loadRawLocation, loadRawAudioTrack, saveRawMultiplayerData, saveRawSessionData } from '../storages/serverStorage';
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
    setSelectedModelId?: (id: string | null) => void;
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
        setSelectedModelId,
        loadFullCharacter, addToast,
    } = options;

    const currentAccountId = useSessionStore(s => s.currentAccountId);
    const multiplayerData = useSessionStore(s => s.multiplayerData);

    const checkAndCleanHistories = (histories: Record<string, HistoryMessage[]> | undefined, id: string) => {
        let hasChatMessages = false;
        const newHistories: Record<string, HistoryMessage[]> = {};
        
        for (const messages of Object.values(histories || {})) {
            if (messages.some(m => m.character.id === id && m.messageType === 'chat')) {
                hasChatMessages = true;
                break;
            }
        }
        
        if (hasChatMessages) {
            return { hasChatMessages, histories };
        }
        
        for (const [locId, messages] of Object.entries(histories || {})) {
            const filtered = messages.filter(m => m.character.id !== id);
            if (filtered.length > 0) {
                newHistories[locId] = filtered;
            }
        }
        return { hasChatMessages, histories: newHistories };
    };

    const handleToggleParticipant = useCallback(async (charId: string) => {
        if (!interactionData) return;
        
        const isParticipant = interactionData.participants.some(p => p.id === charId);
        const isProtagonist = (interactionData.protagonistIds || []).includes(charId);

        if (isParticipant) {
            if (isProtagonist) {
                const protagonistCount = interactionData.protagonistIds?.length || 0;
                if (protagonistCount <= 1) {
                    addToast('Cannot remove the only protagonist.', 'error');
                    return;
                }
                
                const updatedProtagonistIds = (interactionData.protagonistIds || []).filter(id => id !== charId);
                const newActiveProtagonistId = updatedProtagonistIds[0];
                
                const np = interactionData.participants.filter(p => p.id !== charId);
                const newActiveProtagonist = newActiveProtagonistId 
                    ? np.find(p => p.id === newActiveProtagonistId) || allCharacters.find(c => c.id === newActiveProtagonistId) || null
                    : null;
                
                const { histories: updatedHistories } = checkAndCleanHistories(interactionData.interactionHistories, charId);
                
                const updatedData: InteractionData = {
                    ...interactionData,
                    participants: np,
                    protagonistIds: updatedProtagonistIds,
                    interactionHistories: updatedHistories as Record<string, HistoryMessage[]>,
                    lastUpdatedTimestamp: Date.now(),
                };
                
                setInteractionData(updatedData);
                setSelectedCharacter(newActiveProtagonist);
                if (newActiveProtagonist) setSelectedCharacterId(newActiveProtagonist.id);
                addToast('Protagonist removed.', 'info');
            } else {
                const np = interactionData.participants.filter(p => p.id !== charId);
                const { histories: cleanedHistories } = checkAndCleanHistories(interactionData.interactionHistories, charId);

                const updatedData: InteractionData = {
                    ...interactionData,
                    participants: np,
                    interactionHistories: cleanedHistories as Record<string, HistoryMessage[]>,
                    lastUpdatedTimestamp: Date.now(),
                };
                
                setInteractionData(updatedData);
                addToast('Participant removed.', 'info');
            }
        } else {
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

        const previousProtagonistId = currentAccountId && multiplayerData
            ? multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.protagonistCharacterId
            : interactionData.protagonistIds?.[0];

        const otherAccountProtagonistIds = new Set<string>();
        if (multiplayerData?.multiplayerDataAccountConfigurations) {
            for (const [accId, config] of Object.entries(multiplayerData.multiplayerDataAccountConfigurations)) {
                if (accId !== currentAccountId && config?.protagonistCharacterId) {
                    otherAccountProtagonistIds.add(config.protagonistCharacterId);
                }
            }
        }

        const existingProtagonistIds = interactionData.protagonistIds || [];
        const filteredProtagonistIds = existingProtagonistIds.filter(pId => {
            if (pId === charId) return false;
            if (pId === previousProtagonistId && !otherAccountProtagonistIds.has(pId)) {
                return false;
            }
            if (!currentAccountId || otherAccountProtagonistIds.size === 0) {
                return false;
            }
            return otherAccountProtagonistIds.has(pId);
        });

        const updatedProtagonistIds = [charId, ...filteredProtagonistIds];

        let updatedMultiplayerData: MultiplayerData | undefined = multiplayerData ? { ...multiplayerData } : undefined;
        if (currentAccountId) {
            if (!updatedMultiplayerData) {
                updatedMultiplayerData = createDefaultMultiplayerData();
            }
            
            const existingCfg = updatedMultiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId] || {
                isWhitelisted: true, isBlacklisted: false, isAdministrator: false,
                canUseJoinerCharacterIds: true,
                joinerCharacterIdsRequiresHosterApproval: false,
                sharedHosterCharacterIds: [],
                hosterCharacterIdsRequiresHosterApproval: false,
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
            protagonistIds: updatedProtagonistIds,
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

    // ─── MUTUALLY EXCLUSIVE: Activating a Budget Strategy deselects any direct model ───
    const handleActivateBudgetStrategy = useCallback((sid: string | null) => {
        if (!sid || selectedBudgetStrategyId === sid) {
            setSelectedBudgetStrategyId(null);
            setActiveBudgetStrategy(null);
            saveRawSessionData({ selectedBudgetStrategyId: null });
            addToast('Budget strategy deactivated.', 'info');
        } else {
            const strategy = allBudgetStrategies.find(s => s.id === sid);
            setSelectedBudgetStrategyId(sid);
            setActiveBudgetStrategy(strategy ?? null);
            saveRawSessionData({ selectedBudgetStrategyId: sid });

            // Deselect any active model
            setSelectedModelId?.(null);
            useSessionStore.setState({ selectedModel: null, selectedModelId: null });
            saveRawSessionData({ selectedModelId: null });

            addToast(`Budget strategy "${strategy?.name || sid}" activated!`, 'success');
        }
    }, [selectedBudgetStrategyId, allBudgetStrategies, setSelectedBudgetStrategyId, setActiveBudgetStrategy, setSelectedModelId, addToast]);

    const handleActivateProfile = useCallback((pid: string) => {
        if (!interactionData) return;
        if (interactionData.profile?.id === pid) {
            const uc = { ...interactionData, profile: undefined, lastUpdatedTimestamp: Date.now() };
            setInteractionData(uc);
            addToast('profile deactivated.', 'info');
        } else {
            const p = allProfiles.find(x => x.id === pid);
            if (!p) return;
            const uc = { ...interactionData, profile: p, lastUpdatedTimestamp: Date.now() };
            setInteractionData(uc);
            addToast(`profile "${p.name}" activated!`, 'success');
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