// src/hooks/useMultiplayerSync.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InteractionData, MultiplayerData, HistoryMessage, Character, ChatMessage, InteractionMessage } from '../types';
import { useMultiplayerConnection, type MultiplayerMessage, type JoinRequestPayload, type JoinResponsePayload } from './useMultiplayerConnection';

// ─── Sync Payload Types ────────────────────────────────────────────

interface SyncChatMessagePayload {
    messageId: string;
    characterId: string;
    messageType: 'chat';
    textContent: string;
    files?: string[];
    frontCameraImage?: string;
    isPartial?: boolean;
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
}

// ─── Hook ──────────────────────────────────────────────────────────

interface UseMultiplayerSyncOptions {
    interactionData: InteractionData | null;
    multiplayerData: MultiplayerData | null;
    currentAccountId: string | null;
    setInteractionData: (data: InteractionData) => void;
    allCharacters: Character[];
    joinSessionId?: string | null;
    joinPassword?: string;
    joinProtagonist?: Character | null;
    onJoinAccepted?: () => void;
    onJoinRejected?: (reason: string) => void;
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
    onJoinAccepted,
    onJoinRejected,
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

    const [joinCompletedSessionId, setJoinCompletedSessionId] = useState<string | null>(null);
    const joinCompleted = joinCompletedSessionId === joinSessionId && joinSessionId != null;

    const [pendingJoinRequests, setPendingJoinRequests] = useState<PendingJoinRequest[]>([]);

    const isHost = !!multiplayerData && !joinSessionId;
    const isAdmin = isHost || !!(multiplayerData && currentAccountId && multiplayerData.administratorAccountIds.includes(currentAccountId));

    const effectiveMultiplayerData = useMemo<MultiplayerData | null>(() => {
        if (joinSessionId) {
            return {
                id: joinSessionId,
                name: '',
                password: '',
                interactionDataIds: [],
                whiteListedAccountIds: [],
                blacklistedAccountIds: [],
                pendingAccountIds: [],
                administratorAccountIds: [],
                accountIdCharacterIds: {},
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

    const appliedMessageIdsRef = useRef<Set<string>>(new Set());
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
        const currentData = interactionDataRef.current;
        if (!currentData) return;

        switch (msg.type) {
            case 'chat_message': {
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
                        isPartial: chatPayload.isPartial,
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

                const isPartial = payload.messageType === 'chat' && (payload as SyncChatMessagePayload).isPartial;

                if (isPartial) {
                    const existingIdx = currentData.interactionHistory.findIndex(m => m.id === payload.messageId);
                    let updatedHistory: HistoryMessage[];
                    if (existingIdx !== -1) {
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
                } else {
                    if (appliedMessageIdsRef.current.has(payload.messageId)) return;
                    appliedMessageIdsRef.current.add(payload.messageId);

                    const existingIdx = currentData.interactionHistory.findIndex(m => m.id === payload.messageId);
                    let updatedHistory: HistoryMessage[];
                    if (existingIdx !== -1) {
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
                }
                break;
            }

            case 'join_request': {
                if (!isHost) {
                    console.log('[MP] Ignoring join_request — not host. isHost:', isHost);
                    return;
                }
                const md = multiplayerDataRef.current;
                if (!md) {
                    console.log('[MP] Ignoring join_request — no multiplayerData');
                    return;
                }
                const payload = msg.payload as JoinRequestPayload;
                const requestingAccountId = payload.accountId;

                console.log('[MP] Host received join_request from:', requestingAccountId);

                const isBlacklisted = md.blacklistedAccountIds.includes(requestingAccountId);
                const isWhitelisted = md.whiteListedAccountIds.includes(requestingAccountId);
                const isDelegatedAdmin = md.administratorAccountIds.includes(requestingAccountId);
                const passwordValid = !md.password || payload.password === md.password;

                console.log('[MP] Access check:', { isBlacklisted, isWhitelisted, isDelegatedAdmin, passwordValid, hasPassword: !!md.password });

                if (!isBlacklisted && (isWhitelisted || isDelegatedAdmin || passwordValid)) {
                    console.log('[MP] Auto-accepting join request for:', requestingAccountId);
                    const freshData = interactionDataRef.current;
                    const initialState = freshData ? {
                        interactionHistory: freshData.interactionHistory,
                        protagonistIds: freshData.protagonists.map(p => p.id),
                    } : undefined;

                    sendToRef.current(requestingAccountId, {
                        type: 'join_response',
                        payload: { accepted: true, initialState } satisfies JoinResponsePayload,
                    });
                } else if (isBlacklisted) {
                    console.log('[MP] Rejecting blacklisted account:', requestingAccountId);
                    sendToRef.current(requestingAccountId, {
                        type: 'join_response',
                        payload: { accepted: false, reason: 'Account is blacklisted' } satisfies JoinResponsePayload,
                    });
                } else {
                    console.log('[MP] Adding to pending requests:', requestingAccountId);
                    setPendingJoinRequests(prev => {
                        const exists = prev.some(r => r.accountId === requestingAccountId);
                        if (exists) return prev;
                        return [...prev, {
                            accountId: requestingAccountId,
                            password: payload.password,
                            timestamp: msg.timestamp,
                        }];
                    });
                }
                break;
            }

            case 'join_response': {
                if (isHost) return;
                const payload = msg.payload as JoinResponsePayload;
                console.log('[MP] Client received join_response:', payload.accepted ? 'accepted' : 'rejected');
                if (payload.accepted) {
                    setJoinCompletedSessionId(joinSessionId ?? null);

                    if (payload.initialState && payload.initialState.interactionHistory.length > 0) {
                        const freshData = interactionDataRef.current;
                        if (freshData) {
                            const existingIds = new Set(freshData.interactionHistory.map(m => m.id));
                            const newMessages = payload.initialState.interactionHistory.filter(m => !existingIds.has(m.id));

                            const resolvedMessages = newMessages.map(historyMsg => {
                                const char = characterMapRef.current.get(historyMsg.character.id);
                                return char ? { ...historyMsg, character: char } : historyMsg;
                            });

                            if (resolvedMessages.length > 0) {
                                setInteractionData({
                                    ...freshData,
                                    interactionHistory: [...freshData.interactionHistory, ...resolvedMessages],
                                    numberOfMessages: freshData.interactionHistory.length + resolvedMessages.length,
                                    lastUpdatedTimestamp: Date.now(),
                                });
                            }
                        }
                    }

                    const protag = joinProtagonistRef.current;
                    if (protag) {
                        broadcastRef.current({
                            type: 'set_protagonist',
                            payload: { character: protag } satisfies SetProtagonistPayload,
                        });
                        characterMapRef.current.set(protag.id, protag);
                    }
                    onJoinAcceptedRef.current?.();
                } else {
                    onJoinRejectedRef.current?.(payload.reason || 'Unknown reason');
                }
                break;
            }

            case 'set_protagonist': {
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
        onReceiveMessage: handleReceiveMessage,
        onPeerConnected: handlePeerConnected,
        onPeerDisconnected: handlePeerDisconnected,
    });

    useEffect(() => { sendToRef.current = sendTo; }, [sendTo]);
    useEffect(() => { broadcastRef.current = broadcast; }, [broadcast]);

    const acceptJoinRequest = useCallback((accountId: string) => {
        setPendingJoinRequests(prev => prev.filter(r => r.accountId !== accountId));
        const freshData = interactionDataRef.current;
        const initialState = freshData ? {
            interactionHistory: freshData.interactionHistory,
            protagonistIds: freshData.protagonists.map(p => p.id),
        } : undefined;
        sendToRef.current(accountId, {
            type: 'join_response',
            payload: { accepted: true, initialState } satisfies JoinResponsePayload,
        });
    }, []);

    const rejectJoinRequest = useCallback((accountId: string) => {
        setPendingJoinRequests(prev => prev.filter(r => r.accountId !== accountId));
        sendToRef.current(accountId, {
            type: 'join_response',
            payload: { accepted: false, reason: 'Request rejected by host' } satisfies JoinResponsePayload,
        });
    }, []);

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
                isPartial: message.isPartial,
            } satisfies SyncChatMessagePayload;
        }

        return {
            ...base,
            messageType: 'interaction',
        } satisfies SyncInteractionMessagePayload;
    }, []);

    const broadcastMessage = useCallback((message: HistoryMessage) => {
        appliedMessageIdsRef.current.add(message.id);
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