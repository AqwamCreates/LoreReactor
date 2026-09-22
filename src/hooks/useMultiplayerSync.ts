// src/hooks/useMultiplayerSync.ts
import { useCallback, useEffect, useRef } from 'react';
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
    isNameRevealed?: boolean;
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
    isNameRevealed?: boolean;
    locationIndex?: number;
    characterExpression?: string;
    inventory?: Record<string, string | number>;
    characterClothingWearingStatuses: Record<string, boolean>;
    characterLockedLocations: Record<string, string[]>;
    parentInteractionMessageId?: string | null;
}

type SyncMessagePayload = SyncChatMessagePayload | SyncInteractionMessagePayload;

// ─── Hook ──────────────────────────────────────────────────────────

interface UseMultiplayerSyncOptions {
    interactionData: InteractionData | null;
    multiplayerData: MultiplayerData | null;
    currentAccountId: string | null;
    setInteractionData: (data: InteractionData) => void;
    allCharacters: Character[];
}

export function useMultiplayerSync({
    interactionData,
    multiplayerData,
    currentAccountId,
    setInteractionData,
    allCharacters,
}: UseMultiplayerSyncOptions) {
    const interactionDataRef = useRef(interactionData);
    useEffect(() => { interactionDataRef.current = interactionData; }, [interactionData]);

    const multiplayerDataRef = useRef(multiplayerData);
    useEffect(() => { multiplayerDataRef.current = multiplayerData; }, [multiplayerData]);

    const isHost = !!(multiplayerData && currentAccountId && multiplayerData.administratorAccountIds.includes(currentAccountId));

    // Track finalized message IDs we've already applied to avoid duplicates
    const appliedMessageIdsRef = useRef<Set<string>>(new Set());

    // Build a character lookup map for fast access
    const characterMapRef = useRef<Map<string, Character>>(new Map());
    useEffect(() => {
        const map = new Map<string, Character>();
        for (const c of allCharacters) map.set(c.id, c);
        characterMapRef.current = map;
    }, [allCharacters]);

    // Refs for sendTo so handleReceiveMessage can use them without circular deps
    const sendToRef = useRef<(accountId: string, msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => void>(() => {});

    const handleReceiveMessage = useCallback((msg: MultiplayerMessage) => {
        const currentData = interactionDataRef.current;
        if (!currentData) return;

        switch (msg.type) {
            case 'chat_message': {
                const payload = msg.payload as SyncMessagePayload;

                // Skip own messages
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
                        isNameRevealed: chatPayload.isNameRevealed,
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
                        isNameRevealed: interactionPayload.isNameRevealed,
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
                    // Partial message: upsert by ID (replace existing partial or append new)
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
                    // Finalized message: skip if already applied
                    if (appliedMessageIdsRef.current.has(payload.messageId)) return;
                    appliedMessageIdsRef.current.add(payload.messageId);

                    // Replace any existing partial with same ID, or append
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
                if (!isHost) return;
                const md = multiplayerDataRef.current;
                if (!md) return;
                const payload = msg.payload as JoinRequestPayload;
                const requestingAccountId = payload.accountId;

                const isBlacklisted = md.blacklistedAccountIds.includes(requestingAccountId);
                const isWhitelisted = md.whiteListedAccountIds.includes(requestingAccountId);
                const isAdmin = md.administratorAccountIds.includes(requestingAccountId);
                const passwordValid = !md.password || payload.password === md.password;

                const accepted = !isBlacklisted && (isWhitelisted || isAdmin || passwordValid);
                const reason = !accepted ? (isBlacklisted ? 'Account is blacklisted' : 'Invalid password or not whitelisted') : undefined;

                // Send response directly to the requesting peer
                sendToRef.current(requestingAccountId, {
                    type: 'join_response',
                    payload: {
                        accepted,
                        reason,
                    } satisfies JoinResponsePayload,
                });
                break;
            }

            case 'join_response': {
                if (isHost) return;
                const payload = msg.payload as JoinResponsePayload;
                if (!payload.accepted) {
                    console.warn(`Join rejected: ${payload.reason}`);
                }
                break;
            }

            case 'typing_indicator':
            case 'protagonist_change':
            case 'leave':
                break;
        }
    }, [currentAccountId, isHost, setInteractionData]);

    const handlePeerConnected = useCallback((accountId: string) => {
        console.log(`Peer connected: ${accountId}`);
    }, []);

    const handlePeerDisconnected = useCallback((accountId: string) => {
        console.log(`Peer disconnected: ${accountId}`);
    }, []);

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
        multiplayerData,
        currentAccountId,
        isHost,
        onReceiveMessage: handleReceiveMessage,
        onPeerConnected: handlePeerConnected,
        onPeerDisconnected: handlePeerDisconnected,
    });

    // Keep sendTo ref in sync for use inside handleReceiveMessage
    useEffect(() => {
        sendToRef.current = sendTo;
    }, [sendTo]);

    // Extract sync-safe payload from a HistoryMessage (strips local-only fields)
    const extractSyncPayload = useCallback((message: HistoryMessage): SyncMessagePayload => {
        const base = {
            messageId: message.id,
            characterId: message.character.id,
            remainingChatStamina: message.remainingChatStamina,
            remainingActionStamina: message.remainingActionStamina,
            isNameRevealed: message.isNameRevealed,
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

    // Broadcast a message to all peers
    const broadcastMessage = useCallback((message: HistoryMessage) => {
        appliedMessageIdsRef.current.add(message.id);
        broadcast({
            type: 'chat_message',
            payload: extractSyncPayload(message),
        });
    }, [broadcast, extractSyncPayload]);

    // Clear applied message IDs when switching chats
    useEffect(() => {
        appliedMessageIdsRef.current.clear();
    }, [interactionData?.id]);

    return {
        isConnected,
        connectedPeers,
        connectionError,
        isHost,
        broadcastMessage,
        disconnect,
        peerId,
        hostPeerId,
    };
}