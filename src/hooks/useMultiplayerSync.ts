// src/hooks/useMultiplayerSync.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InteractionData, MultiplayerData, HistoryMessage, Character, ChatMessage, InteractionMessage, WhisperMessage, LanguageModel } from '../types';
import { useMultiplayerConnection, type MultiplayerMessage, type JoinRequestPayload, type JoinResponsePayload, type MessageEditPayload, type MessageDeletePayload, type HostMigrationPayload } from './useMultiplayerConnection';
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

interface SyncWhisperMessagePayload {
    messageId: string;
    characterId: string;
    messageType: 'whisper';
    textContent: string;
    targetCharacterIds: string[];
    files?: string[];
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

interface BorrowModelResponsePayload {
    modelName: string;
    modelConfig: {
        backend: string;
        contextLength: number;
        model?: string;
        apiKey?: string;
        parameters?: Record<string, unknown>;
        instructionTemplate?: string;
        chatTemplate?: string;
    };
}

interface SharedModelUsagePayload {
    accountId: string;
    modelName: string;
    timestamp: number;
}

type SyncMessagePayload = SyncChatMessagePayload | SyncInteractionMessagePayload | SyncWhisperMessagePayload;

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

class SharedModelTracker {
    private usageMap: Map<string, { count: number; lastUsed: number }> = new Map();
    
    recordUsage(accountId: string) {
        const existing = this.usageMap.get(accountId);
        if (existing) {
            existing.count++;
            existing.lastUsed = Date.now();
        } else {
            this.usageMap.set(accountId, { count: 1, lastUsed: Date.now() });
        }
    }

    selectNextUser(availableUsers: string[]): string | null {
        if (availableUsers.length === 0) return null;
        if (availableUsers.length === 1) return availableUsers[0];

        const counts = availableUsers.map(id => ({ id, count: this.usageMap.get(id)?.count ?? 0 }));
        const maxCount = Math.max(...counts.map(c => c.count));
        const weights = counts.map(c => ({ id: c.id, weight: maxCount - c.count + 1 }));
        
        const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
        let random = Math.random() * totalWeight;

        for (const w of weights) {
            random -= w.weight;
            if (random <= 0) return w.id;
        }
        return availableUsers[0];
    }
}
const sharedModelTracker = new SharedModelTracker();

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
    onHostMigration?: (payload: HostMigrationPayload) => void;
    onBorrowModelRequest?: () => Promise<LanguageModel | null>;
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
    onHostMigration,
    onBorrowModelRequest,
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

    const onHostMigrationRef = useRef(onHostMigration);
    useEffect(() => { onHostMigrationRef.current = onHostMigration; }, [onHostMigration]);

    const onBorrowModelRequestRef = useRef(onBorrowModelRequest);
    useEffect(() => { onBorrowModelRequestRef.current = onBorrowModelRequest; }, [onBorrowModelRequest]);

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
    const peerJoinTimesRef = useRef<Map<string, number>>(new Map());
    const pendingBorrowRequestsRef = useRef<Map<string, (model: LanguageModel | null) => void>>(new Map());

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

                if (payload.messageType === 'whisper') {
                    const whisperPayload = payload as SyncWhisperMessagePayload;
                    newMessage = {
                        id: whisperPayload.messageId,
                        messageType: 'whisper',
                        character,
                        textContent: whisperPayload.textContent,
                        targetCharacterIds: whisperPayload.targetCharacterIds,
                        files: whisperPayload.files ?? [],
                        modelTextContentSummaries: {},
                        modelInteractionTextContentSummaries: {},
                        kvCacheTextContentPaths: {},
                        kvCacheTextContentSummaryPaths: {},
                        kvCacheInteractionTextContentSummaries: {},
                        remainingChatStamina: whisperPayload.remainingChatStamina,
                        remainingActionStamina: whisperPayload.remainingActionStamina,
                        knownCharacterNames: whisperPayload.knownCharacterNames,
                        locationIndex: whisperPayload.locationIndex,
                        characterExpression: whisperPayload.characterExpression,
                        inventory: whisperPayload.inventory,
                        characterClothingWearingStatuses: whisperPayload.characterClothingWearingStatuses,
                        characterLockedLocations: whisperPayload.characterLockedLocations,
                        parentInteractionMessageId: whisperPayload.parentInteractionMessageId ?? null,
                        firstCreatedTimestamp: msg.timestamp,
                        lastUpdatedTimestamp: msg.timestamp,
                    } satisfies WhisperMessage;
                } else if (payload.messageType === 'chat') {
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

            case 'borrow_model_request': {
                if (isHost) return;
                if (onBorrowModelRequestRef.current) {
                    onBorrowModelRequestRef.current().then(model => {
                        if (model) {
                            sendToRef.current(msg.senderAccountId, {
                                type: 'borrow_model_response',
                                payload: {
                                    modelName: model.name,
                                    modelConfig: {
                                        backend: model.backend,
                                        contextLength: model.contextLength,
                                        model: model.model,
                                        apiKey: model.apiKey,
                                        parameters: model.parameters,
                                        instructionTemplate: model.instructionTemplate,
                                        chatTemplate: model.chatTemplate,
                                    }
                                } satisfies BorrowModelResponsePayload
                            });
                        }
                    }).catch(() => { /* Host will timeout */ });
                }
                break;
            }

            case 'borrow_model_response': {
                if (!isHost) return;
                const payload = msg.payload as BorrowModelResponsePayload;
                const resolver = pendingBorrowRequestsRef.current.get(msg.senderAccountId);
                
                if (resolver) {
                    pendingBorrowRequestsRef.current.delete(msg.senderAccountId);
                    
                    const model: LanguageModel = {
                        id: `borrowed-${msg.senderAccountId}-${Date.now()}`,
                        name: payload.modelName,
                        backend: payload.modelConfig.backend as any,
                        contextLength: payload.modelConfig.contextLength,
                        model: payload.modelConfig.model,
                        apiKey: payload.modelConfig.apiKey,
                        parameters: payload.modelConfig.parameters,
                        instructionTemplate: payload.modelConfig.instructionTemplate,
                        chatTemplate: payload.modelConfig.chatTemplate,
                        firstCreatedTimestamp: Date.now(),
                        lastUpdatedTimestamp: Date.now(),
                    };
                    
                    resolver(model);
                    sharedModelTracker.recordUsage(msg.senderAccountId);
                    
                    broadcastRef.current({
                        type: 'shared_model_usage',
                        payload: { 
                            accountId: msg.senderAccountId, 
                            modelName: payload.modelName, 
                            timestamp: Date.now() 
                        } satisfies SharedModelUsagePayload
                    });
                }
                break;
            }

            case 'shared_model_usage': {
                const payload = msg.payload as SharedModelUsagePayload;
                sharedModelTracker.recordUsage(payload.accountId);
                break;
            }

            case 'message_edit': {
                const payload = msg.payload as MessageEditPayload;
                const currentData = interactionDataRef.current;
                if (!currentData) break;
                const updatedHistory = currentData.interactionHistory.map(m => {
                    if (m.id === payload.messageId && m.messageType === 'chat') {
                        return { ...m, textContent: payload.newText, lastUpdatedTimestamp: Date.now() } as ChatMessage;
                    }
                    return m;
                });
                setInteractionData({ ...currentData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() });
                break;
            }

            case 'message_delete': {
                const payload = msg.payload as MessageDeletePayload;
                const currentData = interactionDataRef.current;
                if (!currentData) break;
                const updatedHistory = currentData.interactionHistory.filter(m => m.id !== payload.messageId);
                setInteractionData({ ...currentData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() });
                break;
            }

            case 'host_migration': {
                const payload = msg.payload as HostMigrationPayload;
                console.log(`[MP] Host migration initiated. New host: ${payload.newHostId}`);
                onHostMigrationRef.current?.(payload);
                break;
            }

            case 'join_request': {
                if (!isHost) return;
                const md = multiplayerDataRef.current;
                if (!md) return;
                const payload = msg.payload as JoinRequestPayload;
                const requestingAccountId = payload.accountId;

                console.log('[MP] Host received join_request from:', requestingAccountId);

                if (md.password && payload.password !== md.password) {
                    sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Invalid password' } });
                    return;
                }

                const acctConfig = md.multiplayerDataAccountConfigurations?.[requestingAccountId];

                if (!acctConfig) {
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
                            setInteractionData({
                                ...freshData,
                                ...payload.initialState,
                                interactionHistory: [],
                                numberOfMessages: 0,
                                lastUpdatedTimestamp: Date.now(),
                            });
                        }
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
        if (isHost) {
            peerJoinTimesRef.current.set(accountId, Date.now());
        }
    }, [isHost]);

    const handlePeerDisconnected = useCallback((accountId: string) => {
        console.log(`[MP] Peer disconnected: ${accountId}`);

        if (!isHost) return;
        const charId = peerCharacterMapRef.current.get(accountId);
        if (charId) {
            peerCharacterMapRef.current.delete(accountId);
            peerJoinTimesRef.current.delete(accountId);

            const currentData = interactionDataRef.current;
            if (currentData) {
                const hasSpoken = currentData.interactionHistory.some(m => m.character.id === charId);
                if (!hasSpoken) {
                    const updatedParticipants = currentData.participants.filter(p => p.id !== charId);
                    const updatedProtagonists = currentData.protagonists.filter(p => p.id !== charId);

                    setInteractionData({
                        ...currentData,
                        participants: updatedParticipants,
                        protagonists: updatedProtagonists,
                        lastUpdatedTimestamp: Date.now(),
                    });
                }
            }
        }
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

    const requestAndAwaitBorrowedModel = useCallback(async (): Promise<LanguageModel | null> => {
        if (!isHost) return null;
        const md = multiplayerDataRef.current;
        if (!md) return null;

        const eligiblePeers: string[] = [];
        for (const [acctId, config] of Object.entries(md.multiplayerDataAccountConfigurations)) {
            if (config.useJoinerLanguageModel !== -1 && connectedPeers.includes(acctId)) {
                eligiblePeers.push(acctId);
            }
        }

        if (eligiblePeers.length === 0) return null;

        const selectedPeer = sharedModelTracker.selectNextUser(eligiblePeers);
        if (!selectedPeer) return null;

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                pendingBorrowRequestsRef.current.delete(selectedPeer);
                resolve(null);
            }, 5000);

            pendingBorrowRequestsRef.current.set(selectedPeer, (model) => {
                clearTimeout(timeout);
                resolve(model);
            });

            sendToRef.current(selectedPeer, {
                type: 'borrow_model_request',
                payload: {}
            });
        });
    }, [connectedPeers]);

    const acceptJoinRequest = useCallback((accountId: string) => {
        setPendingJoinRequests(prev => {
            const req = prev.find(r => r.accountId === accountId);
            if (req && multiplayerData) {
                const currentData = interactionDataRef.current;
                let assignedCharacter: Character | null = null;
                
                if (req.requestedCharacterData) {
                    assignedCharacter = req.requestedCharacterData;
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

        if (message.messageType === 'whisper') {
            return {
                ...base,
                messageType: 'whisper',
                textContent: message.textContent,
                targetCharacterIds: message.targetCharacterIds,
            } satisfies SyncWhisperMessagePayload;
        }

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

    const broadcastMessageEdit = useCallback((messageId: string, newText: string) => {
        broadcast({
            type: 'message_edit',
            payload: { messageId, newText } satisfies MessageEditPayload,
        });
        const currentData = interactionDataRef.current;
        if (currentData) {
            const updatedHistory = currentData.interactionHistory.map(m => {
                if (m.id === messageId && m.messageType === 'chat') {
                    return { ...m, textContent: newText, lastUpdatedTimestamp: Date.now() } as ChatMessage;
                }
                return m;
            });
            setInteractionData({ ...currentData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() });
        }
    }, [broadcast]);

    const broadcastMessageDelete = useCallback((messageId: string) => {
        broadcast({
            type: 'message_delete',
            payload: { messageId } satisfies MessageDeletePayload,
        });
        const currentData = interactionDataRef.current;
        if (currentData) {
            const updatedHistory = currentData.interactionHistory.filter(m => m.id !== messageId);
            setInteractionData({ ...currentData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() });
        }
    }, [broadcast]);

    const initiateBranch = useCallback(() => {
        if (isHost) {
            let oldestPeerId: string | null = null;
            let oldestTime = Infinity;
            peerJoinTimesRef.current.forEach((time, id) => {
                if (time < oldestTime) {
                    oldestTime = time;
                    oldestPeerId = id;
                }
            });

            if (!oldestPeerId) {
                disconnect();
                return;
            }

            const currentData = interactionDataRef.current;
            if (!currentData) return;

            const chatId = currentData.id.replace(/[^A-Za-z0-9]/g, '');
            const newHostPeerId = `lr_${chatId}_host`;

            broadcast({
                type: 'host_migration',
                payload: {
                    newHostId: oldestPeerId,
                    newHostPeerId,
                    finalState: currentData,
                } satisfies HostMigrationPayload,
            });

            setTimeout(() => {
                disconnect();
            }, 100);
        } else {
            disconnect();
        }
    }, [isHost, disconnect, broadcast]);

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
        broadcastMessageEdit,
        broadcastMessageDelete,
        initiateBranch,
        sendProtagonist,
        disconnect,
        peerId,
        hostPeerId,
        requestAndAwaitBorrowedModel,
    };
}