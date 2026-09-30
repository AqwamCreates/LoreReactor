// src/hooks/useMultiplayerSync.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { 
    InteractionData, MultiplayerData, HistoryMessage, Character, 
    ChatMessage, InteractionMessage, WhisperMessage, LanguageModel, 
    backend, Context, Location, AudioTrack, Profile 
} from '../types';
import { 
    useMultiplayerConnection, 
    type MultiplayerMessage, 
    type JoinRequestPayload, 
    type JoinResponsePayload, 
    type MessageEditPayload, 
    type MessageDeletePayload, 
    type HostMigrationPayload,
    type BorrowInferenceRequestPayload,
    type BorrowInferenceChunkPayload,
    type BorrowInferenceCancelPayload
} from './useMultiplayerConnection';
import { useSessionStore } from './useSessionStore';
import { saveRawMultiplayerCharacter } from '../storages/serverStorage';
import { MultiplayerEvents } from '../services/MultiplayerEvents';
import { localURL } from '../configurations';

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

export interface StateSyncPayload {
    participants?: Character[];
    protagonists?: Character[];
    contexts?: Context[];
    locations?: Location[];
    audioTracks?: AudioTrack[];
    Profile?: Profile;
}

export interface PendingJoinRequest {
    accountId: string;
    password?: string;
    timestamp: number;
    requestedCharacterId?: string;
    requestedCharacterData?: Character;
}

// ─── Pure Payload Extractor (Hoisted to Module Scope) ────────────────
function extractSyncPayload(message: HistoryMessage): SyncMessagePayload {
    const basePayload = {
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
            ...basePayload,
            messageType: 'whisper',
            textContent: message.textContent,
            targetCharacterIds: message.targetCharacterIds,
        } satisfies SyncWhisperMessagePayload;
    }

    if (message.messageType === 'chat') {
        return {
            ...basePayload,
            messageType: 'chat',
            textContent: message.textContent,
            files: message.files,
            frontCameraImage: message.frontCameraImage,
        } satisfies SyncChatMessagePayload;
    }

    return {
        ...basePayload,
        messageType: 'interaction',
    } satisfies SyncInteractionMessagePayload;
}

// ─── Character & Account Lookup Helpers ──────────────────────────────
function resolveCharacter(
    characterId: string,
    currentData: InteractionData | null,
    characterMap: Map<string, Character>
): Character | undefined {
    return (
        characterMap.get(characterId) ||
        currentData?.participants.find((participant) => participant.id === characterId) ||
        currentData?.protagonists.find((protagonist) => protagonist.id === characterId)
    );
}

function findAccountConfiguration(
    configurations: Record<string, any> | undefined,
    accountId: string
): { configuration: any; key: string } | undefined {
    if (!configurations) return undefined;
    if (configurations[accountId]) return { configuration: configurations[accountId], key: accountId };
    
    const sanitizedAccountId = accountId.replace(/[^A-Za-z0-9]/g, '');
    for (const [key, configuration] of Object.entries(configurations)) {
        if (key.replace(/[^A-Za-z0-9]/g, '') === sanitizedAccountId) {
            return { configuration, key };
        }
    }
    return undefined;
}

class SharedModelTracker {
    private usageMap: Map<string, { count: number; lastUsed: number }> = new Map();

    recordUsage(accountId: string) {
        const existingUsage = this.usageMap.get(accountId);
        if (existingUsage) {
            existingUsage.count++;
            existingUsage.lastUsed = Date.now();
        } else {
            this.usageMap.set(accountId, { count: 1, lastUsed: Date.now() });
        }
    }

    selectNextUser(availableUsers: string[]): string | null {
        if (availableUsers.length === 0) return null;
        if (availableUsers.length === 1) return availableUsers[0];

        const usageCounts = availableUsers.map((id) => ({ id, count: this.usageMap.get(id)?.count ?? 0 }));
        const maximumCount = Math.max(...usageCounts.map((usage) => usage.count));
        const weights = usageCounts.map((usage) => ({ id: usage.id, weight: maximumCount - usage.count + 1 }));

        const totalWeight = weights.reduce((sum, weightItem) => sum + weightItem.weight, 0);
        let randomValue = Math.random() * totalWeight;

        for (const weightItem of weights) {
            randomValue -= weightItem.weight;
            if (randomValue <= 0) return weightItem.id;
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
    onCharacterSelectionRequired?: (initialState: any, sessionRules: any) => void;
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
    onCharacterSelectionRequired,
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

    const onCharacterSelectionRequiredRef = useRef(onCharacterSelectionRequired);
    useEffect(() => { onCharacterSelectionRequiredRef.current = onCharacterSelectionRequired; }, [onCharacterSelectionRequired]);

    const [joinCompletedSessionId, setJoinCompletedSessionId] = useState<string | null>(null);
    const joinCompleted = joinCompletedSessionId === joinSessionId && joinSessionId != null;

    const [pendingJoinRequests, setPendingJoinRequests] = useState<PendingJoinRequest[]>([]);

    const isHost = !!multiplayerData && !joinSessionId;
    const isAdministrator = isHost || !!(multiplayerData && currentAccountId && multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.isAdministrator);

    const effectiveMultiplayerData = useMemo<MultiplayerData | null>(() => {
        if (joinSessionId) {
            return {
                id: joinSessionId,
                name: '',
                password: '',
                interactionDataIds: [],
                canUseJoinerCharacterIds: false,
                joinerCharacterIdsRequiresHosterApproval: false,
                sharedHosterCharacterIds: [],
                hosterCharacterIdsRequiresHosterApproval: false,
                useJoinerLanguageModel: 0,
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
    const activeInferenceStreamsRef = useRef<Map<string, { onToken: (token: string) => void; resolve: () => void; reject: (err: Error) => void }>>(new Map());

    useEffect(() => {
        const map = new Map<string, Character>();
        for (const character of allCharacters) map.set(character.id, character);
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

                if (isHost) {
                    const currentMultiplayerData = multiplayerDataRef.current;
                    const foundAccount = findAccountConfiguration(currentMultiplayerData?.multiplayerDataAccountConfigurations, msg.senderAccountId);
                    const isSenderAdministrator = foundAccount?.configuration?.isAdministrator;
                    const boundCharacterId = peerCharacterMapRef.current.get(msg.senderAccountId) 
                        || foundAccount?.configuration?.protagonistCharacterId;

                    if (!isSenderAdministrator && (!boundCharacterId || boundCharacterId !== payload.characterId)) {
                        console.warn(
                            `[MP Security] Blocked unauthorized message from account "${msg.senderAccountId}" attempting to speak as "${payload.characterId}". Expected: "${boundCharacterId}"`
                        );
                        return;
                    }
                }

                const character = resolveCharacter(payload.characterId, currentData, characterMapRef.current);
                if (!character) {
                    console.warn(`[MP] Character ${payload.characterId} could not be resolved for message.`);
                    return;
                }

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

                const existingIndex = currentData.interactionHistory.findIndex((message) => message.id === payload.messageId);
                const isNewMessage = existingIndex === -1;
                let updatedHistory: HistoryMessage[];
                if (!isNewMessage) {
                    updatedHistory = [...currentData.interactionHistory];
                    updatedHistory[existingIndex] = newMessage;
                } else {
                    updatedHistory = [...currentData.interactionHistory, newMessage];
                }
                setInteractionData({
                    ...currentData,
                    interactionHistory: updatedHistory,
                    numberOfMessages: updatedHistory.length,
                    lastUpdatedTimestamp: Date.now(),
                });

                if (isHost) {
                    broadcastRef.current({
                        type: 'chat_message',
                        payload: extractSyncPayload(newMessage),
                    });

                    if (isNewMessage && payload.messageType === 'chat') {
                        MultiplayerEvents.emit('peerMessageReceived', newMessage as ChatMessage);
                    }
                }
                break;
            }

            case 'state_sync': {
                const payload = msg.payload as StateSyncPayload;
                const currentData = interactionDataRef.current;
                if (!currentData) break;

                // Security: if host receives state sync from peer, verify administrator status
                if (isHost && msg.senderAccountId !== currentAccountId) {
                    const currentMultiplayerData = multiplayerDataRef.current;
                    const foundAccount = findAccountConfiguration(currentMultiplayerData?.multiplayerDataAccountConfigurations, msg.senderAccountId);
                    if (!foundAccount?.configuration?.isAdministrator) {
                        console.warn(`[MP Security] Blocked unauthorized state_sync from account ${msg.senderAccountId}`);
                        break;
                    }
                }

                const updatedData: InteractionData = {
                    ...currentData,
                    ...(payload.participants !== undefined ? { participants: payload.participants } : {}),
                    ...(payload.protagonists !== undefined ? { protagonists: payload.protagonists } : {}),
                    ...(payload.contexts !== undefined ? { contexts: payload.contexts } : {}),
                    ...(payload.locations !== undefined ? { locations: payload.locations } : {}),
                    ...(payload.audioTracks !== undefined ? { audioTracks: payload.audioTracks } : {}),
                    ...(payload.Profile !== undefined ? { Profile: payload.Profile } : {}),
                    lastUpdatedTimestamp: Date.now(),
                };

                setInteractionData(updatedData);

                // If host received this from an administrator, re-broadcast to other peers
                if (isHost) {
                    broadcastRef.current({
                        type: 'state_sync',
                        payload,
                    });
                }
                break;
            }

            case 'borrow_model_request': {
                if (isHost) return;
                if (onBorrowModelRequestRef.current) {
                    onBorrowModelRequestRef.current().then((model) => {
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
                                    },
                                } satisfies BorrowModelResponsePayload,
                            });
                        }
                    }).catch(() => {});
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
                        backend: payload.modelConfig.backend as backend,
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
                            timestamp: Date.now(),
                        } satisfies SharedModelUsagePayload,
                    });
                }
                break;
            }

            case 'borrow_inference_request': {
                if (!isHost) {
                    const payload = msg.payload as BorrowInferenceRequestPayload;
                    const hostAccountId = msg.senderAccountId;

                    (async () => {
                        try {
                            const statusResponse = await fetch(`${localURL}/models/status`);
                            const statusData = await statusResponse.json();
                            const activeModel = statusData.activeModels?.[0];

                            if (!activeModel || !activeModel.port) {
                                throw new Error('No active local model running on joiner machine');
                            }

                            const targetUrl = `http://127.0.0.1:${activeModel.port}/v1/chat/completions`;

                            const response = await fetch(targetUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload.promptOrMessages)
                            });

                            if (!response.ok || !response.body) {
                                throw new Error('Failed to run inference on peer model');
                            }

                            const reader = response.body.getReader();
                            const decoder = new TextDecoder();

                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                const chunkText = decoder.decode(value, { stream: true });

                                sendToRef.current(hostAccountId, {
                                    type: 'borrow_inference_chunk',
                                    payload: { requestId: payload.requestId, token: chunkText, done: false } satisfies BorrowInferenceChunkPayload
                                });
                            }

                            sendToRef.current(hostAccountId, {
                                type: 'borrow_inference_chunk',
                                payload: { requestId: payload.requestId, done: true } satisfies BorrowInferenceChunkPayload
                            });
                        } catch (error) {
                            sendToRef.current(hostAccountId, {
                                type: 'borrow_inference_chunk',
                                payload: { requestId: payload.requestId, done: true, error: (error as Error).message } satisfies BorrowInferenceChunkPayload
                            });
                        }
                    })();
                }
                break;
            }

            case 'borrow_inference_chunk': {
                const payload = msg.payload as BorrowInferenceChunkPayload;
                const stream = activeInferenceStreamsRef.current.get(payload.requestId);
                if (stream) {
                    if (payload.error) {
                        stream.reject(new Error(payload.error));
                        activeInferenceStreamsRef.current.delete(payload.requestId);
                    } else if (payload.done) {
                        stream.resolve();
                        activeInferenceStreamsRef.current.delete(payload.requestId);
                    } else if (payload.token) {
                        stream.onToken(payload.token);
                    }
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

                if (isHost && msg.senderAccountId !== currentAccountId) {
                    const currentMultiplayerData = multiplayerDataRef.current;
                    const foundAccount = findAccountConfiguration(currentMultiplayerData?.multiplayerDataAccountConfigurations, msg.senderAccountId);
                    const isSenderAdministrator = foundAccount?.configuration?.isAdministrator;
                    const senderCharacterId = peerCharacterMapRef.current.get(msg.senderAccountId) || foundAccount?.configuration?.protagonistCharacterId;
                    const targetMessage = currentData.interactionHistory.find((message) => message.id === payload.messageId);

                    if (!isSenderAdministrator && (!targetMessage || targetMessage.character.id !== senderCharacterId)) {
                        console.warn(`[MP Security] Blocked unauthorized edit from ${msg.senderAccountId} on message ${payload.messageId}`);
                        break;
                    }
                }

                const updatedHistory = currentData.interactionHistory.map((message) => {
                    if (message.id === payload.messageId && message.messageType === 'chat') {
                        return { ...message, textContent: payload.newText, lastUpdatedTimestamp: Date.now() } as ChatMessage;
                    }
                    return message;
                });
                setInteractionData({ ...currentData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() });

                if (isHost) {
                    broadcastRef.current({ type: 'message_edit', payload });
                }
                break;
            }

            case 'message_delete': {
                const payload = msg.payload as MessageDeletePayload;
                const currentData = interactionDataRef.current;
                if (!currentData) break;

                if (isHost && msg.senderAccountId !== currentAccountId) {
                    const currentMultiplayerData = multiplayerDataRef.current;
                    const foundAccount = findAccountConfiguration(currentMultiplayerData?.multiplayerDataAccountConfigurations, msg.senderAccountId);
                    const isSenderAdministrator = foundAccount?.configuration?.isAdministrator;
                    const senderCharacterId = peerCharacterMapRef.current.get(msg.senderAccountId) || foundAccount?.configuration?.protagonistCharacterId;
                    const targetMessage = currentData.interactionHistory.find((message) => message.id === payload.messageId);

                    if (!isSenderAdministrator && (!targetMessage || targetMessage.character.id !== senderCharacterId)) {
                        console.warn(`[MP Security] Blocked unauthorized delete from ${msg.senderAccountId} on message ${payload.messageId}`);
                        break;
                    }
                }

                const updatedHistory = currentData.interactionHistory.filter((message) => message.id !== payload.messageId);
                setInteractionData({ ...currentData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() });

                if (isHost) {
                    broadcastRef.current({ type: 'message_delete', payload });
                }
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
                const currentMultiplayerData = multiplayerDataRef.current;
                if (!currentMultiplayerData) return;
                const payload = msg.payload as JoinRequestPayload;
                const requestingAccountId = payload.accountId;

                if (currentMultiplayerData.password && payload.password !== currentMultiplayerData.password) {
                    sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Invalid password' } });
                    return;
                }

                const foundAccount = findAccountConfiguration(currentMultiplayerData.multiplayerDataAccountConfigurations, requestingAccountId);
                const accountConfiguration = foundAccount?.configuration;
                const matchedConfigurationKey = foundAccount?.key || requestingAccountId;

                if (!accountConfiguration) {
                    if (!currentMultiplayerData.pendingAccountIds.includes(requestingAccountId)) {
                        const updatedMultiplayerData = { ...currentMultiplayerData, pendingAccountIds: [...currentMultiplayerData.pendingAccountIds, requestingAccountId] };
                        multiplayerDataRef.current = updatedMultiplayerData;
                        useSessionStore.setState({ multiplayerData: updatedMultiplayerData });
                        onSaveMultiplayerDataRef.current?.(updatedMultiplayerData);
                    }
                    sendToRef.current(requestingAccountId, { type: 'join_pending', payload: { message: 'Waiting for host approval' } });
                    setPendingJoinRequests((previousRequests) =>
                        previousRequests.some((request) => request.accountId === requestingAccountId)
                            ? previousRequests
                            : [...previousRequests, { accountId: requestingAccountId, password: payload.password, timestamp: msg.timestamp, requestedCharacterId: payload.requestedCharacterId, requestedCharacterData: payload.requestedCharacterData }]
                    );
                    return;
                }

                if (accountConfiguration.isBlacklisted) {
                    sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Blacklisted' } });
                    return;
                }

                if (!accountConfiguration.isWhitelisted && !accountConfiguration.isAdministrator) {
                    sendToRef.current(requestingAccountId, { type: 'join_pending', payload: { message: 'Waiting for host approval' } });
                    setPendingJoinRequests((previousRequests) =>
                        previousRequests.some((request) => request.accountId === requestingAccountId)
                            ? previousRequests
                            : [...previousRequests, { accountId: requestingAccountId, timestamp: msg.timestamp, requestedCharacterId: payload.requestedCharacterId, requestedCharacterData: payload.requestedCharacterData }]
                    );
                    return;
                }

                let assignedCharacter: Character | null = null;
                const currentData = interactionDataRef.current;

                if (payload.requestedCharacterData) {
                    if (currentMultiplayerData.canUseJoinerCharacterIds || accountConfiguration.isAdministrator) {
                        assignedCharacter = payload.requestedCharacterData;
                    } else {
                        sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Custom characters not allowed' } });
                        return;
                    }
                } else if (payload.requestedCharacterId) {
                    const isCharacterBlacklisted = accountConfiguration.blacklistedCharacterIds?.includes(payload.requestedCharacterId);
                    if (isCharacterBlacklisted) {
                        sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Character is blacklisted' } });
                        return;
                    }

                    const isCharacterShared = currentMultiplayerData.sharedHosterCharacterIds?.includes(payload.requestedCharacterId);
                    const requiresApproval = currentMultiplayerData.hosterCharacterIdsRequiresHosterApproval;
                    const isCharacterWhitelisted = accountConfiguration.whitelistedCharacterIds?.includes(payload.requestedCharacterId);

                    if (isCharacterShared && (accountConfiguration.isAdministrator || isCharacterWhitelisted || !requiresApproval)) {
                        assignedCharacter = currentData?.participants.find((participant) => participant.id === payload.requestedCharacterId) 
                                         || currentData?.protagonists.find((protagonist) => protagonist.id === payload.requestedCharacterId) 
                                         || null;
                    } else {
                        sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Character not allowed' } });
                        return;
                    }
                }

                if (assignedCharacter) {
                    peerCharacterMapRef.current.set(requestingAccountId, assignedCharacter.id);
                }

                const updatedMultiplayerData = {
                    ...currentMultiplayerData,
                    multiplayerDataAccountConfigurations: {
                        ...currentMultiplayerData.multiplayerDataAccountConfigurations,
                        [matchedConfigurationKey]: {
                            ...accountConfiguration,
                            protagonistCharacterId: assignedCharacter?.id ?? accountConfiguration.protagonistCharacterId,
                        },
                    },
                    lastUpdatedTimestamp: Date.now(),
                };
                multiplayerDataRef.current = updatedMultiplayerData;
                useSessionStore.setState({ multiplayerData: updatedMultiplayerData });
                onSaveMultiplayerDataRef.current?.(updatedMultiplayerData);

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
                    payload: {
                        accepted: true,
                        initialState,
                        assignedCharacter,
                        sessionRules: {
                            canUseJoinerCharacterIds: currentMultiplayerData.canUseJoinerCharacterIds,
                            joinerCharacterIdsRequiresHosterApproval: currentMultiplayerData.joinerCharacterIdsRequiresHosterApproval,
                            sharedHosterCharacterIds: currentMultiplayerData.sharedHosterCharacterIds,
                            hosterCharacterIdsRequiresHosterApproval: currentMultiplayerData.hosterCharacterIdsRequiresHosterApproval,
                        },
                    },
                });

                if (payload.requestedCharacterData && currentData && assignedCharacter) {
                    const characterToSave = assignedCharacter;
                    const isAlreadyParticipantInSession = currentData.participants.some((participant) => participant.id === characterToSave.id);
                    if (!isAlreadyParticipantInSession) {
                        saveRawMultiplayerCharacter(characterToSave).catch((error) => console.error('Failed to save uploaded multiplayer character:', error));
                        setInteractionData({
                            ...currentData,
                            participants: [...currentData.participants, characterToSave],
                            lastUpdatedTimestamp: Date.now(),
                        });
                    }
                }
                break;
            }

            case 'join_response': {
                if (isHost) return;
                const payload = msg.payload as JoinResponsePayload;
                if (payload.accepted) {
                    setJoinCompletedSessionId(joinSessionId ?? null);

                    if (payload.initialState) {
                        const freshData = interactionDataRef.current;
                        
                        const fallbackData: InteractionData = {
                            id: joinSessionId ?? `mp-${Date.now()}`,
                            name: 'Multiplayer Session',
                            protagonists: [],
                            participants: [],
                            contexts: [],
                            locations: [],
                            audioTracks: [],
                            interactionHistory: [],
                            numberOfMessages: 0,
                            firstCreatedTimestamp: Date.now(),
                            lastUpdatedTimestamp: Date.now(),
                            parentInteractionDataId: null,
                            parentInteractionMessageId: null,
                        };

                        const baseData = freshData ?? fallbackData;

                        setInteractionData({
                            ...baseData,
                            ...payload.initialState,
                            interactionHistory: [],
                            numberOfMessages: 0,
                            lastUpdatedTimestamp: Date.now(),
                        });

                        if (payload.assignedCharacter) {
                            onJoinAcceptedRef.current?.(payload.assignedCharacter);
                        } else {
                            onCharacterSelectionRequiredRef.current?.(payload.initialState, payload.sessionRules);
                        }
                    }
                } else {
                    onJoinRejectedRef.current?.(payload.reason || 'Unknown reason');
                }
                break;
            }

            case 'join_pending': {
                if (isHost) return;
                onJoinPendingRef.current?.();
                break;
            }

            case 'set_protagonist': {
                const currentData = interactionDataRef.current;
                if (!currentData) return;

                const payload = msg.payload as SetProtagonistPayload;
                const character = payload.character;
                const senderAccountId = msg.senderAccountId;

                if (isHost) {
                    const currentMultiplayerData = multiplayerDataRef.current;
                    const foundAccount = findAccountConfiguration(currentMultiplayerData?.multiplayerDataAccountConfigurations, senderAccountId);
                    const accountConfiguration = foundAccount?.configuration;
                    
                    if (!accountConfiguration) {
                        console.warn(`[MP Security] Blocked set_protagonist from unknown account ${senderAccountId}`);
                        return;
                    }

                    const isParticipant = currentData.participants.some(participant => participant.id === character.id);
                    const isProtagonist = currentData.protagonists.some(protagonist => protagonist.id === character.id);
                    const isSessionCharacter = isParticipant || isProtagonist;
                    
                    if (accountConfiguration.blacklistedCharacterIds?.includes(character.id)) {
                        console.warn(`[MP Security] Blocked set_protagonist: Character ${character.id} is blacklisted for ${senderAccountId}`);
                        return;
                    }

                    const isCharacterWhitelisted = accountConfiguration.whitelistedCharacterIds?.includes(character.id);
                    const isUserAdministrator = accountConfiguration.isAdministrator;

                    if (isSessionCharacter) {

                        if (!currentMultiplayerData){
                            console.warn("[MP Security] Missing multiplayer data.");
                            return
                        } 

                        const isCharacterShared = currentMultiplayerData.sharedHosterCharacterIds?.includes(character.id);
                        const requiresApproval = currentMultiplayerData.hosterCharacterIdsRequiresHosterApproval;
                        
                        if (!isUserAdministrator && !isCharacterWhitelisted && (!isCharacterShared || requiresApproval)) {
                            console.warn(`[MP Security] Blocked set_protagonist: ${senderAccountId} not allowed to use host characters.`);
                            return;
                        }
                    } else {
                        if (!accountConfiguration.canUseJoinerCharacterIds && !isUserAdministrator) {
                            console.warn(`[MP Security] Blocked set_protagonist: ${senderAccountId} not allowed to use custom characters.`);
                            return;
                        }
                    }

                    peerCharacterMapRef.current.set(senderAccountId, character.id);
                    
                    if (currentMultiplayerData && foundAccount && foundAccount.configuration.protagonistCharacterId !== character.id) {
                        const updatedMultiplayerData = {
                            ...currentMultiplayerData,
                            multiplayerDataAccountConfigurations: {
                                ...currentMultiplayerData.multiplayerDataAccountConfigurations,
                                [foundAccount.key]: {
                                    ...foundAccount.configuration,
                                    protagonistCharacterId: character.id,
                                }
                            },
                            lastUpdatedTimestamp: Date.now(),
                        };
                        multiplayerDataRef.current = updatedMultiplayerData;
                        
                        setTimeout(() => {
                            useSessionStore.setState({ multiplayerData: updatedMultiplayerData });
                            onSaveMultiplayerDataRef.current?.(updatedMultiplayerData);
                        }, 0);
                    }
                }

                const hasParticipant = currentData.participants.some((participant) => participant.id === character.id);
                const hasProtagonist = currentData.protagonists.some((protagonist) => protagonist.id === character.id);

                const updatedParticipants = hasParticipant
                    ? currentData.participants.map((participant) => (participant.id === character.id ? character : participant))
                    : [...currentData.participants, character];

                const updatedProtagonists = hasProtagonist
                    ? currentData.protagonists.map((protagonist) => (protagonist.id === character.id ? character : protagonist))
                    : [...currentData.protagonists, character];

                characterMapRef.current.set(character.id, character);

                setInteractionData({
                    ...currentData,
                    participants: updatedParticipants,
                    protagonists: updatedProtagonists,
                    lastUpdatedTimestamp: Date.now(),
                });

                if (isHost) {
                    broadcastRef.current({
                        type: 'set_protagonist',
                        payload: { character } satisfies SetProtagonistPayload,
                    });
                }
                break;
            }

            case 'borrow_inference_cancel':
            case 'typing_indicator':
            case 'protagonist_change':
            case 'leave':
                break;
        }
    }, [currentAccountId, isHost, joinSessionId, setInteractionData]);

    const handlePeerConnected = useCallback((accountId: string) => {
        if (isHost) {
            peerJoinTimesRef.current.set(accountId, Date.now());
        }
    }, [isHost]);

    const handlePeerDisconnected = useCallback((accountId: string) => {
        if (!isHost) return;
        const characterId = peerCharacterMapRef.current.get(accountId);
        if (characterId) {
            peerCharacterMapRef.current.delete(accountId);
            peerJoinTimesRef.current.delete(accountId);

            const currentData = interactionDataRef.current;
            if (currentData) {
                const hasSpoken = currentData.interactionHistory.some((message) => message.character.id === characterId);
                if (!hasSpoken) {
                    const updatedParticipants = currentData.participants.filter((participant) => participant.id !== characterId);
                    const updatedProtagonists = currentData.protagonists.filter((protagonist) => protagonist.id !== characterId);

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

    const broadcastMessage = useCallback((message: HistoryMessage) => {
        console.log('[MP] Broadcasting message', message.id, message.character.id);
        broadcast({
            type: 'chat_message',
            payload: extractSyncPayload(message),
        });
    }, [broadcast]);

    useEffect(() => {
        const unsubscribe = MultiplayerEvents.on('broadcastMessage', (message: HistoryMessage) => {
            broadcastMessage(message);
        });
        return unsubscribe;
    }, [broadcastMessage]);

    const broadcastStateSync = useCallback((partialState: StateSyncPayload) => {
        broadcast({
            type: 'state_sync',
            payload: partialState,
        });
    }, [broadcast]);

    const requestAndAwaitBorrowedModel = useCallback(async (): Promise<LanguageModel | null> => {
        if (!isHost) return null;
        const currentMultiplayerData = multiplayerDataRef.current;
        if (!currentMultiplayerData) return null;

        if (currentMultiplayerData.useJoinerLanguageModel === -1) return null;

        const eligiblePeers: string[] = [];
        for (const accountId of Object.keys(currentMultiplayerData.multiplayerDataAccountConfigurations)) {
            if (connectedPeers.includes(accountId)) {
                eligiblePeers.push(accountId);
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
                payload: {},
            });
        });
    }, [connectedPeers, isHost]);

    const requestPeerInference = useCallback((
        peerAccountId: string,
        modelName: string,
        promptOrMessages: any,
        onToken: (token: string) => void,
        signal?: AbortSignal
    ): Promise<void> => {
        return new Promise((resolve, reject) => {
            const requestId = `inf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

            activeInferenceStreamsRef.current.set(requestId, { onToken, resolve, reject });

            signal?.addEventListener('abort', () => {
                activeInferenceStreamsRef.current.delete(requestId);
                sendToRef.current(peerAccountId, {
                    type: 'borrow_inference_cancel',
                    payload: { requestId } satisfies BorrowInferenceCancelPayload
                });
                reject(new Error('Inference aborted'));
            });

            sendToRef.current(peerAccountId, {
                type: 'borrow_inference_request',
                payload: { requestId, modelName, promptOrMessages } satisfies BorrowInferenceRequestPayload
            });
        });
    }, []);

    const acceptJoinRequest = useCallback((accountId: string) => {
        setPendingJoinRequests((previousRequests) => {
            const pendingJoinRequest = previousRequests.find((request) => request.accountId === accountId || request.accountId.replace(/[^A-Za-z0-9]/g, '') === accountId.replace(/[^A-Za-z0-9]/g, ''));
            if (pendingJoinRequest && multiplayerData) {
                const currentData = interactionDataRef.current;
                let assignedCharacter: Character | null = null;

                if (pendingJoinRequest.requestedCharacterData) {
                    assignedCharacter = pendingJoinRequest.requestedCharacterData;
                    saveRawMultiplayerCharacter(assignedCharacter).catch((error) => console.error('Failed to save uploaded multiplayer character:', error));
                } else if (pendingJoinRequest.requestedCharacterId && currentData) {
                    assignedCharacter = currentData.participants.find((participant) => participant.id === pendingJoinRequest.requestedCharacterId) 
                                     || currentData.protagonists.find((protagonist) => protagonist.id === pendingJoinRequest.requestedCharacterId) 
                                     || null;
                }

                if (assignedCharacter) {
                    peerCharacterMapRef.current.set(accountId, assignedCharacter.id);
                    peerCharacterMapRef.current.set(accountId.replace(/[^A-Za-z0-9]/g, ''), assignedCharacter.id);
                }

                const foundAccount = findAccountConfiguration(multiplayerData.multiplayerDataAccountConfigurations, accountId);
                const existingConfiguration = foundAccount?.configuration || {
                    isWhitelisted: true,
                    isBlacklisted: false,
                    isAdministrator: false,
                    canUseJoinerCharacterIds: multiplayerData.canUseJoinerCharacterIds,
                    joinerCharacterIdsRequiresHosterApproval: multiplayerData.joinerCharacterIdsRequiresHosterApproval,
                    sharedHosterCharacterIds: [...multiplayerData.sharedHosterCharacterIds],
                    hosterCharacterIdsRequiresHosterApproval: multiplayerData.hosterCharacterIdsRequiresHosterApproval,
                    whitelistedCharacterIds: [],
                    blacklistedCharacterIds: [],
                    pendingCharacterIds: [],
                };
                const matchedConfigurationKey = foundAccount?.key || accountId;

                const updatedMultiplayerData: MultiplayerData = {
                    ...multiplayerData,
                    multiplayerDataAccountConfigurations: {
                        ...multiplayerData.multiplayerDataAccountConfigurations,
                        [matchedConfigurationKey]: {
                            ...existingConfiguration,
                            isWhitelisted: true,
                            isBlacklisted: false,
                            protagonistCharacterId: assignedCharacter?.id ?? existingConfiguration.protagonistCharacterId,
                        },
                    },
                    pendingAccountIds: multiplayerData.pendingAccountIds.filter((id) => id !== accountId && id !== matchedConfigurationKey),
                    lastUpdatedTimestamp: Date.now(),
                };
                multiplayerDataRef.current = updatedMultiplayerData;
                useSessionStore.setState({ multiplayerData: updatedMultiplayerData });
                onSaveMultiplayerDataRef.current?.(updatedMultiplayerData);

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
                    payload: {
                        accepted: true,
                        initialState,
                        assignedCharacter,
                        sessionRules: {
                            canUseJoinerCharacterIds: updatedMultiplayerData.canUseJoinerCharacterIds,
                            joinerCharacterIdsRequiresHosterApproval: updatedMultiplayerData.joinerCharacterIdsRequiresHosterApproval,
                            sharedHosterCharacterIds: updatedMultiplayerData.sharedHosterCharacterIds,
                            hosterCharacterIdsRequiresHosterApproval: updatedMultiplayerData.hosterCharacterIdsRequiresHosterApproval,
                        },
                    },
                });
            }
            return previousRequests.filter((request) => request.accountId !== accountId);
        });
    }, [multiplayerData]);

    const rejectJoinRequest = useCallback((accountId: string) => {
        setPendingJoinRequests((previousRequests) => {
            if (multiplayerData) {
                const updatedMultiplayerData: MultiplayerData = {
                    ...multiplayerData,
                    pendingAccountIds: multiplayerData.pendingAccountIds.filter((id) => id !== accountId),
                    lastUpdatedTimestamp: Date.now(),
                };
                multiplayerDataRef.current = updatedMultiplayerData;
                useSessionStore.setState({ multiplayerData: updatedMultiplayerData });
                onSaveMultiplayerDataRef.current?.(updatedMultiplayerData);
            }
            sendToRef.current(accountId, {
                type: 'join_response',
                payload: { accepted: false, reason: 'Request rejected by host' } satisfies JoinResponsePayload,
            });
            return previousRequests.filter((request) => request.accountId !== accountId);
        });
    }, [multiplayerData]);

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
            const updatedHistory = currentData.interactionHistory.map((message) => {
                if (message.id === messageId && message.messageType === 'chat') {
                    return { ...message, textContent: newText, lastUpdatedTimestamp: Date.now() } as ChatMessage;
                }
                return message;
            });
            setInteractionData({ ...currentData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() });
        }
    }, [broadcast, setInteractionData]);

    const broadcastMessageDelete = useCallback((messageId: string) => {
        broadcast({
            type: 'message_delete',
            payload: { messageId } satisfies MessageDeletePayload,
        });
        const currentData = interactionDataRef.current;
        if (currentData) {
            const updatedHistory = currentData.interactionHistory.filter((message) => message.id !== messageId);
            setInteractionData({ ...currentData, interactionHistory: updatedHistory, lastUpdatedTimestamp: Date.now() });
        }
    }, [broadcast, setInteractionData]);

    const initiateBranch = useCallback(() => {
        if (isHost) {
            let oldestPeerId: string | null = null;
            let oldestTime = Number.POSITIVE_INFINITY;
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

            const chatId = currentData.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 18);
            const newHostPeerId = `lr_${chatId}_host`;

            broadcast({
                type: 'host_migration',
                payload: {
                    newHostId: oldestPeerId,
                    newHostPeerId,
                    finalState: currentData,
                    multiplayerData: multiplayerDataRef.current,
                } as HostMigrationPayload,
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
        isAdministrator,
        joinCompleted,
        pendingJoinRequests,
        acceptJoinRequest,
        rejectJoinRequest,
        broadcastMessage,
        broadcastMessageEdit,
        broadcastMessageDelete,
        broadcastStateSync,
        initiateBranch,
        sendProtagonist,
        disconnect,
        peerId,
        hostPeerId,
        requestAndAwaitBorrowedModel,
        requestPeerInference,
    };
}