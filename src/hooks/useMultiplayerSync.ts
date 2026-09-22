// src/hooks/useMultiplayerSync.ts
import { useCallback, useEffect, useRef } from 'react';
import type { InteractionData, MultiplayerData, HistoryMessage, Character } from '../types';
import { useSessionStore } from './useSessionStore';
import { useMultiplayerConnection, type MultiplayerMessage, type ChatMessagePayload, type JoinRequestPayload, type JoinResponsePayload, type StateSyncPayload } from './useMultiplayerConnection';

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

    // Determine if this client is the host
    const isHost = !!(multiplayerData && currentAccountId && multiplayerData.administratorAccountIds.includes(currentAccountId));

    // Track which message IDs we've already applied to avoid duplicates
    const appliedMessageIdsRef = useRef<Set<string>>(new Set());

    const handleReceiveMessage = useCallback((msg: MultiplayerMessage) => {
        const currentData = interactionDataRef.current;
        if (!currentData) return;

        switch (msg.type) {
            case 'chat_message': {
                const payload = msg.payload as ChatMessagePayload;
                // Skip if we already have this message
                if (appliedMessageIdsRef.current.has(payload.messageId)) return;
                appliedMessageIdsRef.current.add(payload.messageId);

                // Don't apply our own messages (we already added them locally)
                if (msg.senderAccountId === currentAccountId) return;

                const character = allCharacters.find(c => c.id === payload.characterId);
                if (!character) return;

                const newMessage: HistoryMessage = {
                    id: payload.messageId,
                    messageType: payload.messageType,
                    character,
                    textContent: payload.textContent,
                    files: [],
                    firstCreatedTimestamp: msg.timestamp,
                    lastUpdatedTimestamp: msg.timestamp,
                    locationIndex: undefined,
                    characterLockedLocations: {},
                    parentInteractionMessageId: null,
                };

                const updatedHistory = [...currentData.interactionHistory, newMessage];
                setInteractionData({
                    ...currentData,
                    interactionHistory: updatedHistory,
                    numberOfMessages: updatedHistory.length,
                    lastUpdatedTimestamp: Date.now(),
                });
                break;
            }

            case 'join_request': {
                if (!isHost) return;
                const payload = msg.payload as JoinRequestPayload;
                const requestingAccountId = payload.accountId;

                // Validate against multiplayer data
                const isBlacklisted = multiplayerData.blacklistedAccountIds.includes(requestingAccountId);
                const isWhitelisted = multiplayerData.whiteListedAccountIds.includes(requestingAccountId);
                const isAdmin = multiplayerData.administratorAccountIds.includes(requestingAccountId);
                const passwordValid = !multiplayerData.password || payload.password === multiplayerData.password;

                const accepted = !isBlacklisted && (isWhitelisted || isAdmin || passwordValid);

                const response: JoinResponsePayload = accepted
                    ? {
                        accepted: true,
                        initialState: {
                            interactionHistory: currentData.interactionHistory,
                            protagonistIds: currentData.protagonists.map(p => p.id),
                        },
                    }
                    : {
                        accepted: false,
                        reason: isBlacklisted ? 'Account is blacklisted' : 'Invalid password or not whitelisted',
                    };

                // Send response back to requesting peer via the connection hook
                // This will be handled by sendTo in the connection hook
                break;
            }

            case 'join_response': {
                if (isHost) return;
                const payload = msg.payload as JoinResponsePayload;
                if (!payload.accepted || !payload.initialState) return;

                // Apply initial state from host
                const existingIds = new Set(currentData.interactionHistory.map(m => m.id));
                const newMessages = payload.initialState.interactionHistory.filter(
                    m => !existingIds.has(m.id)
                );

                if (newMessages.length > 0) {
                    for (const m of newMessages) {
                        appliedMessageIdsRef.current.add(m.id);
                    }
                    const updatedHistory = [...currentData.interactionHistory, ...newMessages];
                    setInteractionData({
                        ...currentData,
                        interactionHistory: updatedHistory,
                        numberOfMessages: updatedHistory.length,
                        lastUpdatedTimestamp: Date.now(),
                    });
                }
                break;
            }

            case 'state_sync': {
                if (isHost) return;
                const payload = msg.payload as StateSyncPayload;
                const existingIds = new Set(currentData.interactionHistory.map(m => m.id));
                const newMessages = payload.interactionHistory.filter(
                    m => !existingIds.has(m.id)
                );

                if (newMessages.length > 0) {
                    for (const m of newMessages) {
                        appliedMessageIdsRef.current.add(m.id);
                    }
                    const updatedHistory = [...currentData.interactionHistory, ...newMessages];
                    setInteractionData({
                        ...currentData,
                        interactionHistory: updatedHistory,
                        numberOfMessages: updatedHistory.length,
                        lastUpdatedTimestamp: Date.now(),
                    });
                }
                break;
            }

            case 'typing_indicator':
            case 'protagonist_change':
            case 'leave':
                // TODO: Handle these as needed
                break;
        }
    }, [currentAccountId, isHost, multiplayerData, allCharacters, setInteractionData]);

    const handlePeerConnected = useCallback((accountId: string) => {
        console.log(`Peer connected: ${accountId}`);
        // Host sends state sync to newly connected peer
        if (isHost && interactionDataRef.current) {
            // State sync will be sent via sendTo after connection is established
        }
    }, [isHost]);

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

    // Broadcast a chat message to all peers
    const broadcastChatMessage = useCallback((message: HistoryMessage) => {
        appliedMessageIdsRef.current.add(message.id);
        broadcast({
            type: 'chat_message',
            payload: {
                messageId: message.id,
                characterId: message.character.id,
                textContent: message.textContent,
                messageType: message.messageType === 'interaction' ? 'interaction' : 'chat',
            } satisfies ChatMessagePayload,
        });
    }, [broadcast]);

    // Send state sync to a specific peer (host → client)
    const sendStateSyncTo = useCallback((accountId: string) => {
        const currentData = interactionDataRef.current;
        if (!currentData) return;
        sendTo(accountId, {
            type: 'state_sync',
            payload: {
                interactionHistory: currentData.interactionHistory,
                protagonistIds: currentData.protagonists.map(p => p.id),
                participantIds: currentData.participants.map(p => p.id),
            } satisfies StateSyncPayload,
        });
    }, [sendTo]);

    // Send join response to a specific peer (host → client)
    const sendJoinResponseTo = useCallback((accountId: string, accepted: boolean, reason?: string) => {
        const currentData = interactionDataRef.current;
        sendTo(accountId, {
            type: 'join_response',
            payload: {
                accepted,
                reason,
                initialState: accepted && currentData ? {
                    interactionHistory: currentData.interactionHistory,
                    protagonistIds: currentData.protagonists.map(p => p.id),
                } : undefined,
            } satisfies JoinResponsePayload,
        });
    }, [sendTo]);

    // Clear applied message IDs when switching chats
    useEffect(() => {
        appliedMessageIdsRef.current.clear();
    }, []);

    return {
        isConnected,
        connectedPeers,
        connectionError,
        isHost,
        broadcastChatMessage,
        sendStateSyncTo,
        sendJoinResponseTo,
        disconnect,
        peerId,
        hostPeerId,
    };
}