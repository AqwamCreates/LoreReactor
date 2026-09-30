// src/hooks/useMultiplayerSync.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InteractionData, MultiplayerData, HistoryMessage, Character, ChatMessage, InteractionMessage, WhisperMessage, LanguageModel, backend } from '../types';
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

export interface PendingJoinRequest {
    accountId: string;
    password?: string;
    timestamp: number;
    requestedCharacterId?: string;
    requestedCharacterData?: Character;
}

// ─── Pure Payload Extractor (Hoisted to Module Scope) ────────────────
function extractSyncPayload(message: HistoryMessage): SyncMessagePayload {
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
}

// ─── Character & Account Lookup Helpers ──────────────────────────────
function resolveCharacter(
    charId: string,
    currentData: InteractionData | null,
    charMap: Map<string, Character>
): Character | undefined {
    return (
        charMap.get(charId) ||
        currentData?.participants.find((p) => p.id === charId) ||
        currentData?.protagonists.find((p) => p.id === charId)
    );
}

function findAccountConfig(
    configs: Record<string, any> | undefined,
    accountId: string
): { config: any; key: string } | undefined {
    if (!configs) return undefined;
    if (configs[accountId]) return { config: configs[accountId], key: accountId };
    const sanitized = accountId.replace(/[^A-Za-z0-9]/g, '');
    for (const [key, cfg] of Object.entries(configs)) {
        if (key.replace(/[^A-Za-z0-9]/g, '') === sanitized) {
            return { config: cfg, key };
        }
    }
    return undefined;
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

        const counts = availableUsers.map((id) => ({ id, count: this.usageMap.get(id)?.count ?? 0 }));
        const maxCount = Math.max(...counts.map((c) => c.count));
        const weights = counts.map((c) => ({ id: c.id, weight: maxCount - c.count + 1 }));

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
    const isAdmin = isHost || !!(multiplayerData && currentAccountId && multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.isAdministrator);

    const effectiveMultiplayerData = useMemo<MultiplayerData | null>(() => {
        if (joinSessionId) {
            return {
                id: joinSessionId,
                name: '',
                password: '',
                interactionDataIds: [],
                canUseJoinerCharacterIds: false,
                canUseHosterParticipantingCharacterId: false,
                canUseHosterNonParticipantingCharacterId: false,
                joinerCharacterIdsRequiresHosterApproval: false,
                hosterParticipantingCharacterIdRequiresHosterApproval: false,
                hosterNonParticipantingCharacterIdRequiresHosterApproval: false,
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

                if (isHost) {
                    const md = multiplayerDataRef.current;
                    const foundAcct = findAccountConfig(md?.multiplayerDataAccountConfigurations, msg.senderAccountId);
                    const isSenderAdmin = foundAcct?.config?.isAdministrator;
                    const boundCharId = peerCharacterMapRef.current.get(msg.senderAccountId) 
                        || foundAcct?.config?.protagonistCharacterId;

                    if (!isSenderAdmin && (!boundCharId || boundCharId !== payload.characterId)) {
                        console.warn(
                            `[MP Security] Blocked unauthorized message from account "${msg.senderAccountId}" attempting to speak as "${payload.characterId}". Expected: "${boundCharId}"`
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

                const existingIdx = currentData.interactionHistory.findIndex((m) => m.id === payload.messageId);
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
                            const statusRes = await fetch(`${localURL}/models/status`);
                            const statusData = await statusRes.json();
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
                        } catch (err) {
                            sendToRef.current(hostAccountId, {
                                type: 'borrow_inference_chunk',
                                payload: { requestId: payload.requestId, done: true, error: (err as Error).message } satisfies BorrowInferenceChunkPayload
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
                    const md = multiplayerDataRef.current;
                    const foundAcct = findAccountConfig(md?.multiplayerDataAccountConfigurations, msg.senderAccountId);
                    const isSenderAdmin = foundAcct?.config?.isAdministrator;
                    const senderCharId = peerCharacterMapRef.current.get(msg.senderAccountId) || foundAcct?.config?.protagonistCharacterId;
                    const targetMessage = currentData.interactionHistory.find((m) => m.id === payload.messageId);

                    if (!isSenderAdmin && (!targetMessage || targetMessage.character.id !== senderCharId)) {
                        console.warn(`[MP Security] Blocked unauthorized edit from ${msg.senderAccountId} on message ${payload.messageId}`);
                        break;
                    }
                }

                const updatedHistory = currentData.interactionHistory.map((m) => {
                    if (m.id === payload.messageId && m.messageType === 'chat') {
                        return { ...m, textContent: payload.newText, lastUpdatedTimestamp: Date.now() } as ChatMessage;
                    }
                    return m;
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
                    const md = multiplayerDataRef.current;
                    const foundAcct = findAccountConfig(md?.multiplayerDataAccountConfigurations, msg.senderAccountId);
                    const isSenderAdmin = foundAcct?.config?.isAdministrator;
                    const senderCharId = peerCharacterMapRef.current.get(msg.senderAccountId) || foundAcct?.config?.protagonistCharacterId;
                    const targetMessage = currentData.interactionHistory.find((m) => m.id === payload.messageId);

                    if (!isSenderAdmin && (!targetMessage || targetMessage.character.id !== senderCharId)) {
                        console.warn(`[MP Security] Blocked unauthorized delete from ${msg.senderAccountId} on message ${payload.messageId}`);
                        break;
                    }
                }

                const updatedHistory = currentData.interactionHistory.filter((m) => m.id !== payload.messageId);
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
                const md = multiplayerDataRef.current;
                if (!md) return;
                const payload = msg.payload as JoinRequestPayload;
                const requestingAccountId = payload.accountId;

                if (md.password && payload.password !== md.password) {
                    sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Invalid password' } });
                    return;
                }

                const foundAcct = findAccountConfig(md.multiplayerDataAccountConfigurations, requestingAccountId);
                const acctConfig = foundAcct?.config;
                const matchedConfigKey = foundAcct?.key || requestingAccountId;

                if (!acctConfig) {
                    if (!md.pendingAccountIds.includes(requestingAccountId)) {
                        const updatedMd = { ...md, pendingAccountIds: [...md.pendingAccountIds, requestingAccountId] };
                        multiplayerDataRef.current = updatedMd;
                        useSessionStore.setState({ multiplayerData: updatedMd });
                        onSaveMultiplayerDataRef.current?.(updatedMd);
                    }
                    sendToRef.current(requestingAccountId, { type: 'join_pending', payload: { message: 'Waiting for host approval' } });
                    setPendingJoinRequests((prev) =>
                        prev.some((r) => r.accountId === requestingAccountId)
                            ? prev
                            : [...prev, { accountId: requestingAccountId, password: payload.password, timestamp: msg.timestamp, requestedCharacterId: payload.requestedCharacterId, requestedCharacterData: payload.requestedCharacterData }]
                    );
                    return;
                }

                if (acctConfig.isBlacklisted) {
                    sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Blacklisted' } });
                    return;
                }

                if (!acctConfig.isWhitelisted && !acctConfig.isAdministrator) {
                    sendToRef.current(requestingAccountId, { type: 'join_pending', payload: { message: 'Waiting for host approval' } });
                    setPendingJoinRequests((prev) =>
                        prev.some((r) => r.accountId === requestingAccountId)
                            ? prev
                            : [...prev, { accountId: requestingAccountId, timestamp: msg.timestamp, requestedCharacterId: payload.requestedCharacterId, requestedCharacterData: payload.requestedCharacterData }]
                    );
                    return;
                }

                let assignedCharacter: Character | null = null;
                const currentData = interactionDataRef.current;

                if (payload.requestedCharacterData) {
                    if (md.canUseJoinerCharacterIds || acctConfig.isAdministrator) {
                        assignedCharacter = payload.requestedCharacterData;
                    } else {
                        sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Custom characters not allowed' } });
                        return;
                    }
                } else if (payload.requestedCharacterId) {
                    const isCharBlacklisted = acctConfig.blacklistedCharacterIds?.includes(payload.requestedCharacterId);
                    if (isCharBlacklisted) {
                        sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Character is blacklisted' } });
                        return;
                    }

                    const isParticipant = currentData?.participants.some(p => p.id === payload.requestedCharacterId);
                    const canUse = isParticipant 
                        ? (md.canUseHosterParticipantingCharacterId || acctConfig.isAdministrator)
                        : (md.canUseHosterNonParticipantingCharacterId || acctConfig.isAdministrator);
                        
                    const isWhitelisted = acctConfig.whitelistedCharacterIds?.includes(payload.requestedCharacterId);

                    if (canUse && (acctConfig.isAdministrator || isWhitelisted || !acctConfig.whitelistedCharacterIds || acctConfig.whitelistedCharacterIds.length === 0)) {
                        assignedCharacter = currentData?.participants.find((p) => p.id === payload.requestedCharacterId) 
                                         || currentData?.protagonists.find((p) => p.id === payload.requestedCharacterId) 
                                         || null;
                    } else {
                        sendToRef.current(requestingAccountId, { type: 'join_response', payload: { accepted: false, reason: 'Character not allowed' } });
                        return;
                    }
                }

                if (assignedCharacter) {
                    peerCharacterMapRef.current.set(requestingAccountId, assignedCharacter.id);
                }

                const updatedMd = {
                    ...md,
                    multiplayerDataAccountConfigurations: {
                        ...md.multiplayerDataAccountConfigurations,
                        [matchedConfigKey]: {
                            ...acctConfig,
                            protagonistCharacterId: assignedCharacter?.id ?? acctConfig.protagonistCharacterId,
                        },
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
                    payload: {
                        accepted: true,
                        initialState,
                        assignedCharacter,
                        sessionRules: {
                            canUseJoinerCharacterIds: md.canUseJoinerCharacterIds,
                            canUseHosterParticipantingCharacterId: md.canUseHosterParticipantingCharacterId,
                            canUseHosterNonParticipantingCharacterId: md.canUseHosterNonParticipantingCharacterId,
                            joinerCharacterIdsRequiresHosterApproval: md.joinerCharacterIdsRequiresHosterApproval,
                            hosterParticipantingCharacterIdRequiresHosterApproval: md.hosterParticipantingCharacterIdRequiresHosterApproval,
                            hosterNonParticipantingCharacterIdRequiresHosterApproval: md.hosterNonParticipantingCharacterIdRequiresHosterApproval,
                        },
                    },
                });

                if (payload.requestedCharacterData && currentData && assignedCharacter) {
                    const charToSave = assignedCharacter;
                    const isAlreadyParticipant = currentData.participants.some((p) => p.id === charToSave.id);
                    if (!isAlreadyParticipant) {
                        saveRawMultiplayerCharacter(charToSave).catch((e) => console.error('Failed to save uploaded multiplayer character:', e));
                        setInteractionData({
                            ...currentData,
                            participants: [...currentData.participants, charToSave],
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
                const char = payload.character;
                const senderAccountId = msg.senderAccountId;

                if (isHost) {
                    const md = multiplayerDataRef.current;
                    const foundAcct = findAccountConfig(md?.multiplayerDataAccountConfigurations, senderAccountId);
                    const cfg = foundAcct?.config;
                    
                    if (!cfg) {
                        console.warn(`[MP Security] Blocked set_protagonist from unknown account ${senderAccountId}`);
                        return;
                    }

                    const isParticipant = currentData.participants.some(p => p.id === char.id);
                    const isProtagonist = currentData.protagonists.some(p => p.id === char.id);
                    const isSessionChar = isParticipant || isProtagonist;
                    
                    if (cfg.blacklistedCharacterIds?.includes(char.id)) {
                        console.warn(`[MP Security] Blocked set_protagonist: Character ${char.id} is blacklisted for ${senderAccountId}`);
                        return;
                    }

                    const isWhitelisted = cfg.whitelistedCharacterIds?.includes(char.id);
                    const isAdmin = cfg.isAdministrator;

                    if (isSessionChar) {
                        const canUseParticipant = cfg.canUseHosterParticipantingCharacterId;
                        const canUseNonParticipant = cfg.canUseHosterNonParticipantingCharacterId;
                        
                        if (!isAdmin && !isWhitelisted && !canUseParticipant && !canUseNonParticipant) {
                             console.warn(`[MP Security] Blocked set_protagonist: ${senderAccountId} not allowed to use host characters.`);
                             return;
                        }
                    } else {
                        if (!cfg.canUseJoinerCharacterIds && !isAdmin) {
                             console.warn(`[MP Security] Blocked set_protagonist: ${senderAccountId} not allowed to use custom characters.`);
                             return;
                        }
                    }

                    peerCharacterMapRef.current.set(senderAccountId, char.id);
                    
                    if (md && foundAcct && foundAcct.config.protagonistCharacterId !== char.id) {
                        const updatedMd = {
                            ...md,
                            multiplayerDataAccountConfigurations: {
                                ...md.multiplayerDataAccountConfigurations,
                                [foundAcct.key]: {
                                    ...foundAcct.config,
                                    protagonistCharacterId: char.id,
                                }
                            },
                            lastUpdatedTimestamp: Date.now(),
                        };
                        multiplayerDataRef.current = updatedMd;
                        
                        setTimeout(() => {
                            useSessionStore.setState({ multiplayerData: updatedMd });
                            onSaveMultiplayerDataRef.current?.(updatedMd);
                        }, 0);
                    }
                }

                const hasParticipant = currentData.participants.some((p) => p.id === char.id);
                const hasProtagonist = currentData.protagonists.some((p) => p.id === char.id);

                const updatedParticipants = hasParticipant
                    ? currentData.participants.map((p) => (p.id === char.id ? char : p))
                    : [...currentData.participants, char];

                const updatedProtagonists = hasProtagonist
                    ? currentData.protagonists.map((p) => (p.id === char.id ? char : p))
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
        const charId = peerCharacterMapRef.current.get(accountId);
        if (charId) {
            peerCharacterMapRef.current.delete(accountId);
            peerJoinTimesRef.current.delete(accountId);

            const currentData = interactionDataRef.current;
            if (currentData) {
                const hasSpoken = currentData.interactionHistory.some((m) => m.character.id === charId);
                if (!hasSpoken) {
                    const updatedParticipants = currentData.participants.filter((p) => p.id !== charId);
                    const updatedProtagonists = currentData.protagonists.filter((p) => p.id !== charId);

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

    const requestAndAwaitBorrowedModel = useCallback(async (): Promise<LanguageModel | null> => {
        if (!isHost) return null;
        const md = multiplayerDataRef.current;
        if (!md) return null;

        if (md.useJoinerLanguageModel === -1) return null;

        const eligiblePeers: string[] = [];
        for (const acctId of Object.keys(md.multiplayerDataAccountConfigurations)) {
            if (connectedPeers.includes(acctId)) {
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
        setPendingJoinRequests((prev) => {
            const req = prev.find((r) => r.accountId === accountId || r.accountId.replace(/[^A-Za-z0-9]/g, '') === accountId.replace(/[^A-Za-z0-9]/g, ''));
            if (req && multiplayerData) {
                const currentData = interactionDataRef.current;
                let assignedCharacter: Character | null = null;

                if (req.requestedCharacterData) {
                    assignedCharacter = req.requestedCharacterData;
                    saveRawMultiplayerCharacter(assignedCharacter).catch((e) => console.error('Failed to save uploaded multiplayer character:', e));
                } else if (req.requestedCharacterId && currentData) {
                    assignedCharacter = currentData.participants.find((p) => p.id === req.requestedCharacterId) 
                                     || currentData.protagonists.find((p) => p.id === req.requestedCharacterId) 
                                     || null;
                }

                if (assignedCharacter) {
                    peerCharacterMapRef.current.set(accountId, assignedCharacter.id);
                    peerCharacterMapRef.current.set(accountId.replace(/[^A-Za-z0-9]/g, ''), assignedCharacter.id);
                }

                const foundAcct = findAccountConfig(multiplayerData.multiplayerDataAccountConfigurations, accountId);
                const existingConfig = foundAcct?.config || {
                    isWhitelisted: true,
                    isBlacklisted: false,
                    isAdministrator: false,
                    canUseJoinerCharacterIds: multiplayerData.canUseJoinerCharacterIds,
                    canUseHosterParticipantingCharacterId: multiplayerData.canUseHosterParticipantingCharacterId,
                    canUseHosterNonParticipantingCharacterId: multiplayerData.canUseHosterNonParticipantingCharacterId,
                    joinerCharacterIdsRequiresHosterApproval: multiplayerData.joinerCharacterIdsRequiresHosterApproval,
                    hosterParticipantingCharacterIdRequiresHosterApproval: multiplayerData.hosterParticipantingCharacterIdRequiresHosterApproval,
                    hosterNonParticipantingCharacterIdRequiresHosterApproval: multiplayerData.hosterNonParticipantingCharacterIdRequiresHosterApproval,
                    whitelistedCharacterIds: [],
                    blacklistedCharacterIds: [],
                    pendingCharacterIds: [],
                };
                const matchedConfigKey = foundAcct?.key || accountId;

                const updatedMd: MultiplayerData = {
                    ...multiplayerData,
                    multiplayerDataAccountConfigurations: {
                        ...multiplayerData.multiplayerDataAccountConfigurations,
                        [matchedConfigKey]: {
                            ...existingConfig,
                            isWhitelisted: true,
                            isBlacklisted: false,
                            protagonistCharacterId: assignedCharacter?.id ?? existingConfig.protagonistCharacterId,
                        },
                    },
                    pendingAccountIds: multiplayerData.pendingAccountIds.filter((id) => id !== accountId && id !== matchedConfigKey),
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
                    payload: {
                        accepted: true,
                        initialState,
                        assignedCharacter,
                        sessionRules: {
                            canUseJoinerCharacterIds: multiplayerData.canUseJoinerCharacterIds,
                            canUseHosterParticipantingCharacterId: multiplayerData.canUseHosterParticipantingCharacterId,
                            canUseHosterNonParticipantingCharacterId: multiplayerData.canUseHosterNonParticipantingCharacterId,
                            joinerCharacterIdsRequiresHosterApproval: multiplayerData.joinerCharacterIdsRequiresHosterApproval,
                            hosterParticipantingCharacterIdRequiresHosterApproval: multiplayerData.hosterParticipantingCharacterIdRequiresHosterApproval,
                            hosterNonParticipantingCharacterIdRequiresHosterApproval: multiplayerData.hosterNonParticipantingCharacterIdRequiresHosterApproval,
                        },
                    },
                });
            }
            return prev.filter((r) => r.accountId !== accountId);
        });
    }, [multiplayerData]);

    const rejectJoinRequest = useCallback((accountId: string) => {
        setPendingJoinRequests((prev) => {
            if (multiplayerData) {
                const updatedMd: MultiplayerData = {
                    ...multiplayerData,
                    pendingAccountIds: multiplayerData.pendingAccountIds.filter((id) => id !== accountId),
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
            return prev.filter((r) => r.accountId !== accountId);
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
            const updatedHistory = currentData.interactionHistory.map((m) => {
                if (m.id === messageId && m.messageType === 'chat') {
                    return { ...m, textContent: newText, lastUpdatedTimestamp: Date.now() } as ChatMessage;
                }
                return m;
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
            const updatedHistory = currentData.interactionHistory.filter((m) => m.id !== messageId);
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
        requestPeerInference,
    };
}