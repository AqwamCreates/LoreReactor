// src/hooks/useMultiplayerBroadcast.ts
import { useCallback } from 'react';
import type { Character, Context, Location, AudioTrack, Profile, InteractionData } from '../types';

interface UseMultiplayerBroadcastOptions {
    handleSetChatProtagonist: (id: string) => void;
    handleToggleParticipant: (id: string) => void;
    handleToggleContext: (id: string) => void;
    handleToggleLocation: (id: string) => void;
    handleToggleAudioTrack: (id: string) => void;
    handleActivateProfile: (id: string) => void;
    isMultiplayerChat: boolean;
    canBroadcastState: boolean;
    multiplayerSync: any; // Typed as any to avoid circular dependency with useMultiplayerSession
    interactionData: InteractionData | null;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allProfiles: Profile[];
}

export function useMultiplayerBroadcast(options: UseMultiplayerBroadcastOptions) {
    const {
        handleSetChatProtagonist,
        handleToggleParticipant,
        handleToggleContext,
        handleToggleLocation,
        handleToggleAudioTrack,
        handleActivateProfile,
        isMultiplayerChat,
        canBroadcastState,
        multiplayerSync,
        interactionData,
        allCharacters,
        allContexts,
        allLocations,
        allAudioTracks,
        allProfiles,
    } = options;

    const handleSetProtagonistAndBroadcast = useCallback((charId: string) => {
        handleSetChatProtagonist(charId);
        
        if (isMultiplayerChat && multiplayerSync?.isConnected) {
            const char = allCharacters.find(c => c.id === charId) 
                      || interactionData?.participants.find(p => p.id === charId);
            
            if (char) {
                multiplayerSync.sendProtagonist(char);
            }
        }
    }, [handleSetChatProtagonist, isMultiplayerChat, multiplayerSync, allCharacters, interactionData]);

    const handleToggleParticipantAndBroadcast = useCallback((charId: string) => {
        handleToggleParticipant(charId);
        if (canBroadcastState && interactionData) {
            const exists = interactionData.participants?.some(p => p.id === charId);
            const nextParticipants = exists
                ? interactionData.participants.filter(p => p.id !== charId)
                : (() => {
                    const found = allCharacters.find(c => c.id === charId);
                    return found ? [...interactionData.participants, found] : interactionData.participants;
                })();
            multiplayerSync.broadcastStateSync?.({ participants: nextParticipants });
        }
    }, [handleToggleParticipant, canBroadcastState, interactionData, allCharacters, multiplayerSync]);

    const handleToggleContextAndBroadcast = useCallback((contextId: string) => {
        handleToggleContext(contextId);
        if (canBroadcastState && interactionData) {
            const exists = interactionData.contexts?.some(c => c.id === contextId);
            const nextContexts = exists
                ? (interactionData.contexts || []).filter(c => c.id !== contextId)
                : (() => {
                    const found = allContexts.find(c => c.id === contextId);
                    return found ? [...(interactionData.contexts || []), found] : (interactionData.contexts || []);
                })();
            multiplayerSync.broadcastStateSync?.({ contexts: nextContexts });
        }
    }, [handleToggleContext, canBroadcastState, interactionData, allContexts, multiplayerSync]);

    const handleToggleLocationAndBroadcast = useCallback((locationId: string) => {
        handleToggleLocation(locationId);
        if (canBroadcastState && interactionData) {
            const exists = interactionData.locations?.some(l => l.id === locationId);
            const nextLocations = exists
                ? (interactionData.locations || []).filter(l => l.id !== locationId)
                : (() => {
                    const found = allLocations.find(l => l.id === locationId);
                    return found ? [...(interactionData.locations || []), found] : (interactionData.locations || []);
                })();
            multiplayerSync.broadcastStateSync?.({ locations: nextLocations });
        }
    }, [handleToggleLocation, canBroadcastState, interactionData, allLocations, multiplayerSync]);

    const handleToggleAudioTrackAndBroadcast = useCallback((trackId: string) => {
        handleToggleAudioTrack(trackId);
        if (canBroadcastState && interactionData) {
            const exists = interactionData.audioTracks?.some(t => t.id === trackId);
            const nextTracks = exists
                ? (interactionData.audioTracks || []).filter(t => t.id !== trackId)
                : (() => {
                    const found = allAudioTracks.find(t => t.id === trackId);
                    return found ? [...(interactionData.audioTracks || []), found] : (interactionData.audioTracks || []);
                })();
            multiplayerSync.broadcastStateSync?.({ audioTracks: nextTracks });
        }
    }, [handleToggleAudioTrack, canBroadcastState, interactionData, allAudioTracks, multiplayerSync]);

    const handleActivateProfileAndBroadcast = useCallback((profileId: string) => {
        handleActivateProfile(profileId);
        if (canBroadcastState && interactionData) {
            const targetProfile = interactionData.profile?.id === profileId 
                ? undefined 
                : allProfiles.find(p => p.id === profileId);
            multiplayerSync.broadcastStateSync?.({ profile: targetProfile });
        }
    }, [handleActivateProfile, canBroadcastState, interactionData, allProfiles, multiplayerSync]);

    return {
        handleSetProtagonistAndBroadcast,
        handleToggleParticipantAndBroadcast,
        handleToggleContextAndBroadcast,
        handleToggleLocationAndBroadcast,
        handleToggleAudioTrackAndBroadcast,
        handleActivateProfileAndBroadcast,
    };
}