// src/hooks/useMultiplayerSync.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InteractionData, MultiplayerData, HistoryMessage, Character, ChatMessage, InteractionMessage } from '../types';
import { useMultiplayerConnection, type MultiplayerMessage, type JoinRequestPayload, type JoinResponsePayload } from './useMultiplayerConnection';
import { useSessionStore } from './useSessionStore';
import { saveRawMultiplayerCharacter } from '../storage/serverStorage';

interface SyncChatMessagePayload {
    messageId: string;
    characterId: string;
    messageType: 'chat';
    textContent: string;
    files?: string[];
    frontCameraImage?: string;
    remainingChatStamina?: number;
    remainingActionStamina?: number;
    knownCharacterNames?: Record<string, Record<string, boolean>>;
    locationIndex?: number;
    characterExpression?: string;
    inventory?: Record<string, string | number>;
    characterClothingWearingStatuses: Record<string, boolean>;
    characterLockedLocations: Record<string, string[]>;
    parentInteractionMessageId?: string | null;
}

interface SyncInteractionMessagePayload {
    messageId: string;
    characterId: string;
    messageType: 'interaction';
    remainingChatStamina?: number;
    remainingActionStamina?: number;
    knownCharacterNames?: Record<string, Record<string, boolean>>;
    locationIndex?: number;
    characterExpression?: string;
    inventory?: Record<string, string | number>;
    characterClothingWearingStatuses: Record<string, boolean>;
    characterLockedLocations: Record<string, string[]>;
    parentInteractionMessageId?: string | null;
}

type SyncMessagePayload = SyncChatMessagePayload | SyncInteractionMessagePayload;

interface SetProtagonistPayload {
    character: Character;
}

export interface PendingJoinRequest {
    accountId: string;
    password?: string;
    timestamp: number;
    requestedCharacterId?: string;
    requestedCharacterData?: Character;
}

interface UseMultiplayerSyncOptions {
    interactionData: InteractionData | null;
    multiplayerData: MultiplayerData | null;
    currentAccountId: string | null;
    setInteractionData: (data: InteractionData) => void;
    allCharacters: Character[];
    joinSessionId?: string | null;
    joinPassword?: string;
    joinProtagonist?: Character | null;
    joinRequestedCharacterId?: string | null;
    joinRequestedCharacterData?: Character | null;
    onJoinAccepted?: (assignedCharacter: Character) => void;
    onJoinRejected?: (reason: string) => void;
    onJoinPending?: () => void;
    onPeerChatMessage?: (message: ChatMessage, senderAccountId: string) => void;
    onSaveMultiplayerData?: (data: MultiplayerData) => void;
    onConnectionFailed?: () => void;
}

export function useMultiplayerSync({
    interactionData,
    multiplayerData,
    currentAccountId,
    setInteractionData,
    allCharacters,
    joinSessionId,
    joinPassword,
    joinProtagonist,
    joinRequestedCharacterId,
    joinRequestedCharacterData,
    onJoinAccepted,
    onJoinRejected,
    onJoinPending,
    onPeerChatMessage,
    onSaveMultiplayerData,
    onConnectionFailed,
}: UseMultiplayerSyncOptions) {
    const interactionDataRef = useRef(interactionData);
    useEffect(() => { interactionDataRef.current = interactionData; }, [interactionData]);

    const multiplayerDataRef = useRef(multiplayerData);
    useEffect(() => { multiplayerDataRef.current = multiplayerData; }, [multiplayerData]);

    const joinPasswordRef = useRef(joinPassword);
    useEffect(() => { joinPasswordRef.current = joinPassword; }, [joinPassword]);

    const joinProtagonistRef = useRef(joinProtagonist);
    useEffect(() => { joinProtagonistRef.current = joinProtagonist; }, [joinProtagonist]);

    const onJoinAcceptedRef = useRef(onJoinAccepted);
    useEffect(() => { onJoinAcceptedRef.current = onJoinAccepted; }, [onJoinAccepted]);

    const onJoinRejectedRef = useRef(onJoinRejected);
    useEffect(() => { onJoinRejectedRef.current = onJoinRejected; }, [onJoinRejected]);

    const onJoinPendingRef = useRef(onJoinPending);
    useEffect(() => { onJoinPendingRef.current = onJoinPending; }, [onJoinPending]);

    const onPeerChatMessageRef = useRef(onPeerChatMessage);
    useEffect(() => { onPeerChatMessageRef.current = onPeerChatMessage; }, [onPeerChatMessage]);

    const onSaveMultiplayerDataRef = useRef(onSaveMultiplayerData);
    useEffect(() => { onSaveMultiplayerDataRef.current = onSaveMultiplayerData; }, [onSaveMultiplayerData]);

    const [joinCompletedSessionId, setJoinCompletedSessionId] = useState<string | null>(null);
    const joinCompleted = joinCompletedSessionId === joinSessionId && joinSessionId != null;

    const [pendingJoinRequests, setPendingJoinRequests] = useState<PendingJoinRequest[]>([]);

    const isHost = !!multiplayerData && !joinSessionId;
    const isAdmin = isHost || !!(multiplayerData && currentAccountId && multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.isAdministrator);

    const effectiveMultiplayerData = useMemo<MultiplayerData | null>(() => {
        if (joinSessionId) {
            return {
                id: joinSessionId,
                name: '',
                password: '',
                interactionDataIds: [],
                multiplayerDataAccountConfigurations: {},
                pendingAccountIds: [],
                firstCreatedTimestamp: 0,
                lastUpdatedTimestamp: 0,
            };
        }
        return multiplayerData;
    }, [multiplayerData, joinSessionId]);

    const effectiveInteractionData = useMemo<InteractionData | null>(() => {
        if (joinSessionId) {
            return { id: joinSessionId } as InteractionData;
        }
        return interactionData;
    }, [interactionData, joinSessionId]);

    const peerCharacterMapRef = useRef<Map<string, string>>(new Map());
    const characterMapRef = useRef<Map<string, Character>>(new Map());

    useEffect(() => {
        const map = new Map<string, Character>();
        for (const c of allCharacters) map.set(c.id, c);
        characterMapRef.current = map;
    }, [allCharacters]);

    const sendToRef = useRef<(accountId: string, msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => void>(() => {});
    const broadcastRef = useRef<(msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => void>(() => {});

    const handleReceiveMessage = useCallback((msg: MultiplayerMessage) => {
        switch (msg.type) {
            case 'chat_message': {
                const currentData = interactionDataRef.current;
                if (!currentData) return;
                const payload = msg.payload as SyncMessagePayload;

                if (msg.senderAccountId === currentAccountId) return;

                const character = characterMapRef.current.get(payload.characterId);
                if (!character) return;

                let newMessage: HistoryMessage;

                if (payload.messageType === 'chat') {
                    const chatPayload = payload as SyncChatMessagePayload;
                    newMessage = {
                        id: chatPayload.messageId,
                        messageType: 'chat',
                        character,
                        textContent: chatPayload.textContent,
                        files: chatPayload.files ?? [],
                        frontCameraImage: chatPayload.frontCameraImage,
                        modelTextContentSummaries: {},
                        modelInteractionTextContentSummaries: {},
                        kvCacheTextContentPaths: {},
                        kvCacheTextContentSummaryPaths: {},
                        kvCacheInteractionTextContentSummaries: {},
                        remainingChatStamina: chatPayload.remainingChatStamina,
                        remainingActionStamina: chatPayload.remainingActionStamina,
                        knownCharacterNames: chatPayload.knownCharacterNames,
                        locationIndex: chatPayload.locationIndex,
                        characterExpression: chatPayload.characterExpression,
                        inventory: chatPayload.inventory,
                        characterClothingWearingStatuses: chatPayload.characterClothingWearingStatuses,
                        characterLockedLocations: chatPayload.characterLockedLocations,
                        parentInteractionMessageId: chatPayload.parentInteractionMessageId ?? null,
                        firstCreatedTimestamp: msg.timestamp,
                        lastUpdatedTimestamp: msg.timestamp,
                    } satisfies ChatMessage;
                } else {
                    const interactionPayload = payload as SyncInteractionMessagePayload;
                    newMessage = {
                        id: interactionPayload.messageId,
                        messageType: 'interaction',
                        character,
                        remainingChatStamina: interactionPayload.remainingChatStamina,
                        remainingActionStamina: interactionPayload.remainingActionStamina,
                        knownCharacterNames: interactionPayload.knownCharacterNames,
                        locationIndex: interactionPayload.locationIndex,
                        characterExpression: interactionPayload.characterExpression,
                        inventory: interactionPayload.inventory,
                        characterClothingWearingStatuses: interactionPayload.characterClothingWearingStatuses,
                        characterLockedLocations: interactionPayload.characterLockedLocations,
                        parentInteractionMessageId: interactionPayload.parentInteractionMessageId ?? null,
                        firstCreatedTimestamp: msg.timestamp,
                        lastUpdatedTimestamp: msg.timestamp,
                    } satisfies InteractionMessage;
                }

                const existingIdx = currentData.interactionHistory.findIndex(m => m.id === payload.messageId);
                const isNewMessage = existingIdx === -1;
                let updatedHistory: HistoryMessage[];
                if (!isNewMessage) {
                    updatedHistory = [...currentData.interactionHistory];
                    updatedHistory[existingIdx] = newMessage;
                } else {
                    updatedHistory = [...currentData.interactionHistory, newMessage];
                }
                setInteractionData({
                    ...currentData,
                    interactionHistory: updatedHistory,
                    numberOfMessages: updatedHistory.length,
                    lastUpdatedTimestamp: Date.now(),
                });

                if (isNewMessage && payload.messageType === 'chat' && isHost) {
                    onPeerChatMessageRef.current?.(newMessage as ChatMessage, msg.senderAccountId);
                }
                break;
            }

            case 'join_request': {
                if (!isHost) return;
                const md = multiplayerDataRef.current;
                if (!md) return;
                const payload = msg.payload as JoinRequestPayload;
                const requestingAccountId = payload.accountId;

                console.log('[MP] Host received join_request from:', requestingAccountId);

                // 1. Password Check
                if (md.password && payload.password !== md.password) {
                    sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Invalid password' } });
                    return;
                }

                const acctConfig = md.multiplayerDataAccountConfigurations?.[requestingAccountId];

                // 2. Account Status Check
                if (!acctConfig) {
                    // Unknown account -> Add to pending
                    if (!md.pendingAccountIds.includes(requestingAccountId)) {
                        const updatedMd = { ...md, pendingAccountIds: [...md.pendingAccountIds, requestingAccountId] };
                        multiplayerDataRef.current = updatedMd;
                        useSessionStore.setState({ multiplayerData: updatedMd });
                        onSaveMultiplayerDataRef.current?.(updatedMd);
                    }
                    sendToRef.current(requestingAccountId, { type: 'join_pending', payload: { message: 'Waiting for host approval' } });
                    setPendingJoinRequests(prev => prev.some(r => r.accountId === requestingAccountId) ? prev : [...prev, { accountId: requestingAccountId, password: payload.password, timestamp: msg.timestamp, requestedCharacterId: payload.requestedCharacterId, requestedCharacterData: payload.requestedCharacterData }]);
                    return;
                }

                if (acctConfig.isBlacklisted) {
                    sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Blacklisted' } });
                    return;
                }

                if (!acctConfig.isWhitelisted && !acctConfig.isAdministrator) {
                    sendToRef.current(requestingAccountId, { type: 'join_pending', payload: { message: 'Waiting for host approval' } });
                    setPendingJoinRequests(prev => prev.some(r => r.accountId === requestingAccountId) ? prev : [...prev, { accountId: requestingAccountId, timestamp: msg.timestamp, requestedCharacterId: payload.requestedCharacterId, requestedCharacterData: payload.requestedCharacterData }]);
                    return;
                }

                // 3. Character Permissions Check (Whitelisted/Admin path)
                let assignedCharacter: Character | null = null;
                const currentData = interactionDataRef.current;

                if (payload.requestedCharacterData) {
                    if (acctConfig.canUseJoinerCharacterId) {
                        assignedCharacter = payload.requestedCharacterData;
                    } else if (acctConfig.joinerCharacterIdRequiresHosterApproval) {
                        sendToRef.current(requestingAccountId, { type: 'join_pending', payload: { message: 'Character requires approval' } });
                        return;
                    } else {
                        sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Custom characters not allowed' } });
                        return;
                    }
                } else if (payload.requestedCharacterId) {
                    const isCharBlacklisted = acctConfig.blacklistedCharacterIds.includes(payload.requestedCharacterId);
                    const isCharWhitelisted = acctConfig.whitelistedCharacterIds.includes(payload.requestedCharacterId);
                    
                    if (isCharBlacklisted) {
                        sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Character is blacklisted' } });
                        return;
                    }

                    if (acctConfig.canUseHosterCharacterId && (acctConfig.isAdministrator || isCharWhitelisted || acctConfig.whitelistedCharacterIds.length === 0)) {
                        assignedCharacter = currentData?.participants.find(p => p.id === payload.requestedCharacterId) || null;
                    } else if (acctConfig.hosterCharacterIdRequiresHosterApproval) {
                        sendToRef.current(requestingAccountId, { type: 'join_pending', payload: { message: 'Character requires approval' } });
                        return;
                    } else {
                        sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Character not allowed' } });
                        return;
                    }
                }

                if (!assignedCharacter) {
                     sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'No valid character selected' } });
                     return;
                }

                // UPDATE ACTIVE CHARACTER ID IN CONFIG
                const updatedMd = {
                    ...md,
                    multiplayerDataAccountConfigurations: {
                        ...md.multiplayerDataAccountConfigurations,
                        [requestingAccountId]: {
                            ...acctConfig,
                            activeCharacterId: assignedCharacter.id,
                        }
                    },
                    lastUpdatedTimestamp: Date.now(),
                };
                multiplayerDataRef.current = updatedMd;
                useSessionStore.setState({ multiplayerData: updatedMd });
                onSaveMultiplayerDataRef.current?.(updatedMd);

                // 4. ACCEPTED -> Send Fresh State (No History)
                const initialState = currentData ? {
                    protagonists: currentData.protagonists,
                    participants: currentData.participants,
                    contexts: currentData.contexts,
                    locations: currentData.locations,
                    audioTracks: currentData.audioTracks,
                    Profile: currentData.Profile,
                } : undefined;

                sendToRef.current(requestingAccountId, {
                    type: 'join_response',
                    payload: { accepted: true, initialState, assignedCharacter }
                });
                
                // Add to participants on host side if it's a new custom character AND save to isolated storage
                if (payload.requestedCharacterData && currentData) {
                     const isAlreadyParticipant = currentData.participants.some(p => p.id === assignedCharacter.id);
                     if (!isAlreadyParticipant) {
                         saveRawMultiplayerCharacter(assignedCharacter).catch(e => console.error('Failed to save uploaded multiplayer character:', e));
                         setInteractionData({
                             ...currentData,
                             participants: [...currentData.participants, assignedCharacter],
                             lastUpdatedTimestamp: Date.now()
                         });
                     }
                }
                break;
            }

            case 'join_response': {
                if (isHost) return;
                const payload = msg.payload as JoinResponsePayload;
                console.log('[MP] Client received join_response:', payload.accepted ? 'accepted' : 'rejected');
                if (payload.accepted) {
                    setJoinCompletedSessionId(joinSessionId ?? null);

                    if (payload.initialState && payload.assignedCharacter) {
                        const freshData = interactionDataRef.current;
                        if (freshData) {
                            // Apply Fresh State (No history)
                            setInteractionData({
                                ...freshData,
                                ...payload.initialState,
                                interactionHistory: [], // FRESH START
                                numberOfMessages: 0,
                                lastUpdatedTimestamp: Date.now(),
                            });
                        }
                        // Notify App.tsx to set the assigned character
                        onJoinAcceptedRef.current?.(payload.assignedCharacter);
                    }
                } else {
                    onJoinRejectedRef.current?.(payload.reason || 'Unknown reason');
                }
                break;
            }

            case 'join_pending': {
                if (isHost) return;
                console.log('[MP] Client received join_pending notification');
                onJoinPendingRef.current?.();
                break;
            }

            case 'set_protagonist': {
                const currentData = interactionDataRef.current;
                if (!currentData) return;

                const payload = msg.payload as SetProtagonistPayload;
                const char = payload.character;
                const senderAccountId = msg.senderAccountId;

                if (isHost) {
                    peerCharacterMapRef.current.set(senderAccountId, char.id);
                }

                const hasParticipant = currentData.participants.some(p => p.id === char.id);
                const hasProtagonist = currentData.protagonists.some(p => p.id === char.id);

                const updatedParticipants = hasParticipant
                    ? currentData.participants.map(p => p.id === char.id ? char : p)
                    : [...currentData.participants, char];

                const updatedProtagonists = hasProtagonist
                    ? currentData.protagonists.map(p => p.id === char.id ? char : p)
                    : [...currentData.protagonists, char];

                characterMapRef.current.set(char.id, char);

                setInteractionData({
                    ...currentData,
                    participants: updatedParticipants,
                    protagonists: updatedProtagonists,
                    lastUpdatedTimestamp: Date.now(),
                });

                if (isHost) {
                    broadcastRef.current({
                        type: 'set_protagonist',
                        payload: { character: char } satisfies SetProtagonistPayload,
                    });
                }
                break;
            }

            case 'typing_indicator':
            case 'protagonist_change':
            case 'leave':
                break;
        }
    }, [currentAccountId, isHost, joinSessionId, setInteractionData]);

    const handlePeerConnected = useCallback((accountId: string) => {
        console.log(`[MP] Peer connected: ${accountId}`);
    }, []);

    const handlePeerDisconnected = useCallback((accountId: string) => {
        console.log(`[MP] Peer disconnected: ${accountId}`);

        if (!isHost) return;
        const charId = peerCharacterMapRef.current.get(accountId);
        if (!charId) return;
        peerCharacterMapRef.current.delete(accountId);

        const currentData = interactionDataRef.current;
        if (!currentData) return;

        const hasSpoken = currentData.interactionHistory.some(m => m.character.id === charId);
        if (hasSpoken) return;

        const updatedParticipants = currentData.participants.filter(p => p.id !== charId);
        const updatedProtagonists = currentData.protagonists.filter(p => p.id !== charId);

        setInteractionData({
            ...currentData,
            participants: updatedParticipants,
            protagonists: updatedProtagonists,
            lastUpdatedTimestamp: Date.now(),
        });
    }, [isHost, setInteractionData]);

    const {
        isConnected,
        connectedPeers,
        connectionError,
        broadcast,
        sendTo,
        disconnect,
        peerId,
        hostPeerId,
    } = useMultiplayerConnection({
        multiplayerData: effectiveMultiplayerData,
        interactionData: effectiveInteractionData,
        currentAccountId,
        isHost,
        joinPassword,
        joinRequestedCharacterId,
        joinRequestedCharacterData,
        onReceiveMessage: handleReceiveMessage,
        onPeerConnected: handlePeerConnected,
        onPeerDisconnected: handlePeerDisconnected,
        onConnectionFailed,
    });

    useEffect(() => { sendToRef.current = sendTo; }, [sendTo]);
    useEffect(() => { broadcastRef.current = broadcast; }, [broadcast]);

    const acceptJoinRequest = useCallback((accountId: string) => {
        setPendingJoinRequests(prev => {
            const req = prev.find(r => r.accountId === accountId);
            if (req && multiplayerData) {
                const currentData = interactionDataRef.current;
                let assignedCharacter: Character | null = null;
                
                if (req.requestedCharacterData) {
                    assignedCharacter = req.requestedCharacterData;
                    // ISOLATED SAVE
                    saveRawMultiplayerCharacter(assignedCharacter).catch(e => console.error('Failed to save uploaded multiplayer character:', e));
                } else if (req.requestedCharacterId && currentData) {
                    assignedCharacter = currentData.participants.find(p => p.id === req.requestedCharacterId) || null;
                }

                const updatedMd: MultiplayerData = {
                    ...multiplayerData,
                    multiplayerDataAccountConfigurations: {
                        ...multiplayerData.multiplayerDataAccountConfigurations,
                        [accountId]: {
                            isWhitelisted: true,
                            isBlacklisted: false,
                            isAdministrator: false,
                            canUseJoinerCharacterId: !!req.requestedCharacterData,
                            canUseHosterCharacterId: !req.requestedCharacterData,
                            joinerCharacterIdRequiresHosterApproval: false,
                            hosterCharacterIdRequiresHosterApproval: false,
                            useJoinerLanguageModel: 0,
                            whitelistedCharacterIds: req.requestedCharacterId ? [req.requestedCharacterId] : [],
                            blacklistedCharacterIds: [],
                            pendingCharacterIds: [],
                            activeCharacterId: assignedCharacter?.id,
                        }
                    },
                    pendingAccountIds: multiplayerData.pendingAccountIds.filter(id => id !== accountId),
                    lastUpdatedTimestamp: Date.now(),
                };
                multiplayerDataRef.current = updatedMd;
                useSessionStore.setState({ multiplayerData: updatedMd });
                onSaveMultiplayerDataRef.current?.(updatedMd);

                const initialState = currentData ? {
                    protagonists: currentData.protagonists,
                    participants: currentData.participants,
                    contexts: currentData.contexts,
                    locations: currentData.locations,
                    audioTracks: currentData.audioTracks,
                    Profile: currentData.Profile,
                } : undefined;

                sendToRef.current(accountId, {
                    type: 'join_response',
                    payload: { accepted: true, initialState, assignedCharacter }
                });
            }
            return prev.filter(r => r.accountId !== accountId);
        });
    }, [multiplayerData]);

    const rejectJoinRequest = useCallback((accountId: string) => {
        setPendingJoinRequests(prev => {
            if (multiplayerData) {
                const updatedMd: MultiplayerData = {
                    ...multiplayerData,
                    pendingAccountIds: multiplayerData.pendingAccountIds.filter(id => id !== accountId),
                    lastUpdatedTimestamp: Date.now(),
                };
                multiplayerDataRef.current = updatedMd;
                useSessionStore.setState({ multiplayerData: updatedMd });
                onSaveMultiplayerDataRef.current?.(updatedMd);
            }
            sendToRef.current(accountId, {
                type: 'join_response',
                payload: { accepted: false, reason: 'Request rejected by host' } satisfies JoinResponsePayload,
            });
            return prev.filter(r => r.accountId !== accountId);
        });
    }, [multiplayerData]);

    const extractSyncPayload = useCallback((message: HistoryMessage): SyncMessagePayload => {
        const base = {
            messageId: message.id,
            characterId: message.character.id,
            remainingChatStamina: message.remainingChatStamina,
            remainingActionStamina: message.remainingActionStamina,
            knownCharacterNames: message.knownCharacterNames,
            locationIndex: message.locationIndex,
            characterExpression: message.characterExpression,
            inventory: message.inventory,
            characterClothingWearingStatuses: message.characterClothingWearingStatuses,
            characterLockedLocations: message.characterLockedLocations,
            parentInteractionMessageId: message.parentInteractionMessageId ?? null,
        };

        if (message.messageType === 'chat') {
            return {
                ...base,
                messageType: 'chat',
                textContent: message.textContent,
                files: message.files,
                frontCameraImage: message.frontCameraImage,
            } satisfies SyncChatMessagePayload;
        }

        return {
            ...base,
            messageType: 'interaction',
        } satisfies SyncInteractionMessagePayload;
    }, []);

    const broadcastMessage = useCallback((message: HistoryMessage) => {
        broadcast({
            type: 'chat_message',
            payload: extractSyncPayload(message),
        });
    }, [broadcast, extractSyncPayload]);

    const sendProtagonist = useCallback((character: Character) => {
        broadcast({
            type: 'set_protagonist',
            payload: { character } satisfies SetProtagonistPayload,
        });
        characterMapRef.current.set(character.id, character);
    }, [broadcast]);

    return {
        isConnected,
        connectedPeers,
        connectionError,
        isHost,
        isAdmin,
        joinCompleted,
        pendingJoinRequests,
        acceptJoinRequest,
        rejectJoinRequest,
        broadcastMessage,
        sendProtagonist,
        disconnect,
        peerId,
        hostPeerId,
    };
}