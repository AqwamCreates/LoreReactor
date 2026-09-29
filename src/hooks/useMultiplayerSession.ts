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
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useMultiplayerSession(options: UseMultiplayerSessionOptions) {
    const { allCharacters, saveMultiplayerData, addToast } = options;

    // Reactively subscribe to store state and typed actions
    const interactionData = useSessionStore((s) => s.interactionData);
    const setInteractionData = useSessionStore((s) => s.setInteractionData);
    const setCurrentCharacter = useSessionStore((s) => s.setCurrentCharacter);
    const currentAccountId = useSessionStore((s) => s.currentAccountId);
    const multiplayerData = useSessionStore((s) => s.multiplayerData);

    const [joinSessionId, setJoinSessionId] = useState<string | null>(null);
    const [joinPassword, setJoinPassword] = useState('');
    const [joinProtagonist, setJoinProtagonist] = useState<Character | null>(null);
    const [joinRequestedCharacterId, setJoinRequestedCharacterId] = useState<string | null>(null);
    const [joinRequestedCharacterData, setJoinRequestedCharacterData] = useState<Character | null>(null);

    // Modal state for joiner character selection
    const [isCharacterSelectionModalOpen, setIsCharacterSelectionModalOpen] = useState(false);
    const [pendingSessionInitialState, setPendingSessionInitialState] = useState<any | null>(null);
    const [pendingSessionRules, setPendingSessionRules] = useState<any | null>(null);

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
            } catch (e) {
                console.warn('Failed to load multiplayer join data:', e);
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
        setIsCharacterSelectionModalOpen(false);
        setPendingSessionInitialState(null);
        setPendingSessionRules(null);
        deleteMultiplayerJoinData().catch((e: unknown) => console.warn('Failed to clear join data:', e));
    }, []);

    const handleJoinAccepted = useCallback((assignedCharacter: Character) => {
        addToast(`Joined session as ${assignedCharacter.name}.`, 'success');
        saveRawMultiplayerJoinData({
            joinSessionId,
            joinPassword,
            joinProtagonist: assignedCharacter,
        }).catch((e: unknown) => console.warn('Failed to save join data:', e));
        setJoinProtagonist(assignedCharacter);
        setCurrentCharacter(assignedCharacter);
    }, [addToast, joinSessionId, joinPassword, setCurrentCharacter]);

    const handleCharacterSelectionRequired = useCallback((initialState: any, sessionRules: any) => {
        setPendingSessionInitialState(initialState);
        setPendingSessionRules(sessionRules);
        setIsCharacterSelectionModalOpen(true);
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
        }).catch((e: unknown) => console.warn('Failed to save join data:', e));
    }, [currentAccountId, addToast]);

    const handleConnectionFailed = useCallback(() => {
        addToast('Could not connect to host. Returning to local mode.', 'error');
        clearJoinState();
    }, [addToast, clearJoinState]);

    const saveMultiplayerDataVoid = useCallback(async (data: MultiplayerData): Promise<void> => {
        await saveMultiplayerData(data);
    }, [saveMultiplayerData]);

    // ─── Host Migration Handler ──────────────────────────────────────
    const handleHostMigration = useCallback(async (payload: HostMigrationPayload) => {
        const myAcctId = currentAccountId;
        if (!myAcctId) return;

        const sanitizedMyAcctId = myAcctId.replace(/[^A-Za-z0-9]/g, '');
        const sanitizedNewHostId = payload.newHostId.replace(/[^A-Za-z0-9]/g, '');
        const isPromotedToHost = sanitizedMyAcctId === sanitizedNewHostId;

        if (isPromotedToHost) {
            addToast('The host has disconnected. You are now the host of this session!', 'success');

            // 1. Commit and persist final interaction data locally
            if (payload.finalState) {
                setInteractionData(payload.finalState);
                await saveRawInteractionData(payload.finalState);
            }

            // 2. Inherit existing room settings or build a new host MultiplayerData
            const baseMpData = (payload as any).multiplayerData as MultiplayerData | undefined;
            const newMpData: MultiplayerData = {
                id: baseMpData?.id || uuidv4(),
                name: baseMpData?.name || payload.finalState?.name || 'Migrated Session',
                description: baseMpData?.description,
                password: baseMpData?.password || '',
                interactionDataIds: payload.finalState ? [payload.finalState.id] : [],
                canUseJoinerCharacterId: baseMpData?.canUseJoinerCharacterId ?? true,
                canUseHosterCharacterId: baseMpData?.canUseHosterCharacterId ?? true,
                joinerCharacterIdRequiresHosterApproval: baseMpData?.joinerCharacterIdRequiresHosterApproval ?? false,
                hosterCharacterIdRequiresHosterApproval: baseMpData?.hosterCharacterIdRequiresHosterApproval ?? false,
                useJoinerLanguageModel: baseMpData?.useJoinerLanguageModel ?? 0,
                multiplayerDataAccountConfigurations: {
                    ...(baseMpData?.multiplayerDataAccountConfigurations || {}),
                    [myAcctId]: {
                        isWhitelisted: true,
                        isBlacklisted: false,
                        isAdministrator: true,
                        canUseJoinerCharacterId: true,
                        canUseHosterCharacterId: true,
                        joinerCharacterIdRequiresHosterApproval: false,
                        hosterCharacterIdRequiresHosterApproval: false,
                        whitelistedCharacterIds: [],
                        blacklistedCharacterIds: [],
                        pendingCharacterIds: [],
                        activeCharacterId: joinProtagonist?.id,
                    },
                },
                pendingAccountIds: baseMpData?.pendingAccountIds || [],
                firstCreatedTimestamp: baseMpData?.firstCreatedTimestamp || Date.now(),
                lastUpdatedTimestamp: Date.now(),
            };

            await saveMultiplayerDataVoid(newMpData);
            useSessionStore.setState({ multiplayerData: newMpData });

            // 3. Clear client join state: Setting joinSessionId = null turns this peer into Host mode
            clearJoinState();

            if (joinProtagonist) {
                setCurrentCharacter(joinProtagonist);
            }
        } else {
            addToast(`Host migration in progress. Re-anchoring to new host...`, 'info');

            if (payload.finalState) {
                setInteractionData(payload.finalState);
            }

            // Other clients reconnect to the newly promoted host at lr_${chatId}_host
            const currentSession = joinSessionId;
            const currentPass = joinPassword;
            const currentCharId = joinRequestedCharacterId;
            const currentCharData = joinRequestedCharacterData;

            setJoinSessionId(null);
            setTimeout(() => {
                setJoinSessionId(currentSession);
                setJoinPassword(currentPass);
                setJoinRequestedCharacterId(currentCharId);
                setJoinRequestedCharacterData(currentCharData);
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
        onHostMigration: handleHostMigration, // Active migration listener
        onCharacterSelectionRequired: handleCharacterSelectionRequired,
    });

    const handleSelectJoinCharacter = useCallback((character: Character) => {
        setIsCharacterSelectionModalOpen(false);
        setPendingSessionInitialState(null);
        setPendingSessionRules(null);

        handleJoinAccepted(character);
        multiplayerSync.sendProtagonist(character);
    }, [handleJoinAccepted, multiplayerSync]);

    const handleCancelJoinCharacter = useCallback(() => {
        setIsCharacterSelectionModalOpen(false);
        setPendingSessionInitialState(null);
        setPendingSessionRules(null);
        clearJoinState();
        multiplayerSync.disconnect();
        addToast('Left multiplayer session.', 'info');
    }, [clearJoinState, multiplayerSync, addToast]);

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
        isCharacterSelectionModalOpen,
        pendingSessionInitialState,
        pendingSessionRules,
        handleSelectJoinCharacter,
        handleCancelJoinCharacter,
    };
}