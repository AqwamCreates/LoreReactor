// src/hooks/useMultiplayerSession.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Character, HistoryMessage, LanguageModel, MultiplayerData } from '../types';
import {
    loadRawMultiplayerJoinData,
    saveRawMultiplayerJoinData,
    deleteMultiplayerJoinData,
    saveRawInteractionData
} from '../storages/serverStorage';
import { useMultiplayerSync } from './useMultiplayerSync';
import { useSessionStore } from '../hooks/useSessionStore';
import type { HostMigrationPayload } from './useMultiplayerConnection';
import { v4 as uuidv4 } from 'uuid';

interface UseMultiplayerSessionOptions {
    allCharacters: Character[];
    saveMultiplayerData: (data: MultiplayerData) => Promise<boolean>;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function useMultiplayerSession(options: UseMultiplayerSessionOptions) {
    const { allCharacters, saveMultiplayerData, addToast } = options;

    const interactionData = useSessionStore((state) => state.interactionData);
    const setInteractionData = useSessionStore((state) => state.setInteractionData);
    const setCurrentCharacter = useSessionStore((state) => state.setCurrentCharacter);
    const currentAccountId = useSessionStore((state) => state.currentAccountId);
    const multiplayerData = useSessionStore((state) => state.multiplayerData);

    const [joinSessionId, setJoinSessionId] = useState<string | null>(null);
    const [joinPassword, setJoinPassword] = useState('');
    const [joinProtagonist, setJoinProtagonist] = useState<Character | null>(null);
    const [joinRequestedCharacterId, setJoinRequestedCharacterId] = useState<string | null>(null);
    const [joinRequestedCharacterData, setJoinRequestedCharacterData] = useState<Character | null>(null);

    const [needsCharacterSelection, setNeedsCharacterSelection] = useState(false);

    const broadcastMessageRef = useRef<((message: HistoryMessage) => void) | undefined>(undefined);
    const requestBorrowedModelRef = useRef<() => Promise<LanguageModel | null>>(async () => null);

    const isMultiplayerClient = !!joinSessionId;

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await loadRawMultiplayerJoinData();
                if (cancelled) return;
                setJoinSessionId(data.joinSessionId ?? null);
                setJoinPassword(data.joinPassword ?? '');
                setJoinProtagonist(data.joinProtagonist ?? null);
                setJoinRequestedCharacterId(data.joinRequestedCharacterId ?? null);
                setJoinRequestedCharacterData(data.joinRequestedCharacterData ?? null);
            } catch (error) {
                console.warn('Failed to load multiplayer join data:', error);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const clearJoinState = useCallback(() => {
        setJoinSessionId(null);
        setJoinPassword('');
        setJoinProtagonist(null);
        setJoinRequestedCharacterId(null);
        setJoinRequestedCharacterData(null);
        setNeedsCharacterSelection(false);
        deleteMultiplayerJoinData().catch((error: unknown) => console.warn('Failed to clear join data:', error));
    }, []);

    const handleJoinAccepted = useCallback((assignedCharacter: Character) => {
        addToast(`Joined session as ${assignedCharacter.name}.`, 'success');
        saveRawMultiplayerJoinData({
            joinSessionId,
            joinPassword,
            joinProtagonist: assignedCharacter,
        }).catch((error: unknown) => console.warn('Failed to save join data:', error));
        setJoinProtagonist(assignedCharacter);
        setCurrentCharacter(assignedCharacter);
        setNeedsCharacterSelection(false);
    }, [addToast, joinSessionId, joinPassword, setCurrentCharacter]);

    const handleCharacterSelectionRequired = useCallback((_initialState: any, _sessionRules: any) => {
        setNeedsCharacterSelection(true);
    }, []);

    const clearNeedsCharacterSelection = useCallback(() => {
        setNeedsCharacterSelection(false);
    }, []);

    const handleJoinRejected = useCallback((reason: string) => {
        addToast(`Join rejected: ${reason}`, 'error');
        clearJoinState();
    }, [addToast, clearJoinState]);

    const handleJoinSession = useCallback((sessionId: string, password: string, requestedCharacterIdentifier: string | null, requestedCharacterData: Character | null) => {
        if (!currentAccountId) {
            addToast('No account configured. Create an account first.', 'error');
            return;
        }
        setJoinSessionId(sessionId);
        setJoinPassword(password);
        setJoinRequestedCharacterId(requestedCharacterIdentifier);
        setJoinRequestedCharacterData(requestedCharacterData);
        saveRawMultiplayerJoinData({
            joinSessionId: sessionId,
            joinPassword: password,
            joinRequestedCharacterId: requestedCharacterIdentifier,
            joinRequestedCharacterData: requestedCharacterData,
        }).catch((error: unknown) => console.warn('Failed to save join data:', error));
    }, [currentAccountId, addToast]);

    const handleConnectionFailed = useCallback(() => {
        addToast('Could not connect to host. Returning to local mode.', 'error');
        clearJoinState();
    }, [addToast, clearJoinState]);

    const saveMultiplayerDataVoid = useCallback(async (data: MultiplayerData): Promise<void> => {
        await saveMultiplayerData(data);
    }, [saveMultiplayerData]);

    const handleHostMigration = useCallback(async (payload: HostMigrationPayload) => {
        const myAccountId = currentAccountId;
        if (!myAccountId) return;

        const sanitizedMyAccountId = myAccountId.replace(/[^A-Za-z0-9]/g, '');
        const sanitizedNewHostId = payload.newHostId.replace(/[^A-Za-z0-9]/g, '');
        const isPromotedToHost = sanitizedMyAccountId === sanitizedNewHostId;

        if (isPromotedToHost) {
            addToast('The host has disconnected. You are now the host of this session!', 'success');

            if (payload.finalState) {
                setInteractionData(payload.finalState);
                await saveRawInteractionData(payload.finalState);
            }

            const baseMultiplayerData = (payload as any).multiplayerData as MultiplayerData | undefined;

            const newMultiplayerData: MultiplayerData = {
                id: baseMultiplayerData?.id || uuidv4(),
                name: baseMultiplayerData?.name || payload.finalState?.name || 'Migrated Session',
                description: baseMultiplayerData?.description,
                password: baseMultiplayerData?.password || '',
                interactionDataIds: payload.finalState ? [payload.finalState.id] : [],
                canUseJoinerCharacterIds: baseMultiplayerData?.canUseJoinerCharacterIds ?? true,
                joinerCharacterIdsRequiresHosterApproval: baseMultiplayerData?.joinerCharacterIdsRequiresHosterApproval ?? false,
                sharedHosterCharacterIds: baseMultiplayerData?.sharedHosterCharacterIds ?? [],
                hosterCharacterIdsRequiresHosterApproval: baseMultiplayerData?.hosterCharacterIdsRequiresHosterApproval ?? false,
                useJoinerLanguageModel: baseMultiplayerData?.useJoinerLanguageModel ?? 0,
                multiplayerDataAccountConfigurations: {
                    ...(baseMultiplayerData?.multiplayerDataAccountConfigurations || {}),
                    [myAccountId]: {
                        isWhitelisted: true,
                        isBlacklisted: false,
                        isAdministrator: true,
                        canUseJoinerCharacterIds: true,
                        joinerCharacterIdsRequiresHosterApproval: false,
                        sharedHosterCharacterIds: baseMultiplayerData?.sharedHosterCharacterIds ?? [],
                        hosterCharacterIdsRequiresHosterApproval: false,
                        whitelistedCharacterIds: [],
                        blacklistedCharacterIds: [],
                        pendingCharacterIds: [],
                        protagonistCharacterId: joinProtagonist?.id,
                    },
                },
                pendingAccountIds: baseMultiplayerData?.pendingAccountIds || [],
                firstCreatedTimestamp: baseMultiplayerData?.firstCreatedTimestamp || Date.now(),
                lastUpdatedTimestamp: Date.now(),
            };

            await saveMultiplayerDataVoid(newMultiplayerData);
            useSessionStore.setState({ multiplayerData: newMultiplayerData });

            clearJoinState();
            if (joinProtagonist) {
                setCurrentCharacter(joinProtagonist);
            }
        } else {
            addToast(`Host migration in progress. Re-anchoring to new host...`, 'info');
            if (payload.finalState) {
                setInteractionData(payload.finalState);
            }

            const currentSession = joinSessionId;
            const currentPassword = joinPassword;
            const currentRequestedCharacterId = joinRequestedCharacterId;
            const currentRequestedCharacterData = joinRequestedCharacterData;
            setJoinSessionId(null);
            setTimeout(() => {
                setJoinSessionId(currentSession);
                setJoinPassword(currentPassword);
                setJoinRequestedCharacterId(currentRequestedCharacterId);
                setJoinRequestedCharacterData(currentRequestedCharacterData);
            }, 1200);
        }
    }, [
        currentAccountId, addToast, setInteractionData, saveMultiplayerDataVoid,
        clearJoinState, joinProtagonist, setCurrentCharacter, joinSessionId,
        joinPassword, joinRequestedCharacterId, joinRequestedCharacterData
    ]);

    const multiplayerSync = useMultiplayerSync({
        interactionData,
        multiplayerData,
        currentAccountId,
        setInteractionData,
        allCharacters,
        joinSessionId,
        joinPassword,
        joinRequestedCharacterId,
        joinRequestedCharacterData,
        onJoinAccepted: handleJoinAccepted,
        onJoinRejected: handleJoinRejected,
        onSaveMultiplayerData: saveMultiplayerDataVoid,
        onConnectionFailed: handleConnectionFailed,
        onHostMigration: handleHostMigration,
        onCharacterSelectionRequired: handleCharacterSelectionRequired,
    });

    useEffect(() => {
        requestBorrowedModelRef.current = multiplayerSync.requestAndAwaitBorrowedModel;
    }, [multiplayerSync.requestAndAwaitBorrowedModel]);

    useEffect(() => {
        broadcastMessageRef.current = multiplayerSync.isConnected ? multiplayerSync.broadcastMessage : undefined;
    }, [multiplayerSync.isConnected, multiplayerSync.broadcastMessage]);

    return {
        isMultiplayerClient,
        joinSessionId,
        joinPassword,
        joinProtagonist,
        joinRequestedCharacterId,
        joinRequestedCharacterData,
        handleJoinSession,
        handleJoinAccepted,
        handleJoinRejected,
        handleConnectionFailed,
        clearJoinState,
        multiplayerSync,
        broadcastMessageRef,
        requestBorrowedModelRef,
        currentAccountId,
        multiplayerData,
        needsCharacterSelection,
        clearNeedsCharacterSelection,
    };
}