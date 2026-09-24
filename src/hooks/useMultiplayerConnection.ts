// src/hooks/useMultiplayerConnection.ts
import { useState, useCallback, useRef, useEffect } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import type { MultiplayerData, InteractionData, HistoryMessage } from '../types';

// ─── Message Protocol ──────────────────────────────────────────────

type MessageType =
    | 'set_protagonist'
    | 'protagonist_change'
    | 'typing_indicator'
    | 'chat_message'
    | 'join_request'
    | 'join_response'
    | 'state_sync'
    | 'leave';

interface MultiplayerMessage {
    type: MessageType;
    senderAccountId: string;
    timestamp: number;
    payload: unknown;
}

interface ChatMessagePayload {
    messageId: string;
    characterId: string;
    textContent: string;
    messageType: 'chat' | 'interaction';
}

interface JoinRequestPayload {
    accountId: string;
    password?: string;
}

interface JoinResponsePayload {
    accepted: boolean;
    reason?: string;
    initialState?: {
        interactionHistory: HistoryMessage[];
        protagonistIds: string[];
    };
}

interface StateSyncPayload {
    interactionHistory: HistoryMessage[];
    protagonistIds: string[];
    participantIds: string[];
}

// ─── Peer ID Helpers ───────────────────────────────────────────────

function buildPeerId(interactionDataId: string, accountId: string): string {
    const chatId = interactionDataId.replace(/[^A-Za-z0-9]/g, '');
    const acctId = accountId.replace(/[^A-Za-z0-9]/g, '');
    return `lr_${chatId}_${acctId}`;
}

function buildHostPeerId(interactionDataId: string): string {
    const chatId = interactionDataId.replace(/[^A-Za-z0-9]/g, '');
    return `lr_${chatId}_host`;
}

function extractAccountIdFromPeerId(peerId: string): string | null {
    const parts = peerId.split('_');
    if (parts.length < 3 || parts[0] !== 'lr') return null;
    const accountId = parts.slice(2).join('_');
    return accountId || null;
}

// ─── Hook ──────────────────────────────────────────────────────────

interface UseMultiplayerConnectionOptions {
    multiplayerData: MultiplayerData | null;
    interactionData: InteractionData | null;
    currentAccountId: string | null;
    isHost: boolean;
    joinPassword?: string;
    onReceiveMessage: (msg: MultiplayerMessage) => void;
    onPeerConnected: (accountId: string) => void;
    onPeerDisconnected: (accountId: string) => void;
}

export function useMultiplayerConnection({
    multiplayerData,
    interactionData,
    currentAccountId,
    isHost,
    joinPassword,
    onReceiveMessage,
    onPeerConnected,
    onPeerDisconnected,
}: UseMultiplayerConnectionOptions) {
    const [isConnected, setIsConnected] = useState(false);
    const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const peerRef = useRef<Peer | null>(null);
    const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
    const onReceiveMessageRef = useRef(onReceiveMessage);
    const onPeerConnectedRef = useRef(onPeerConnected);
    const onPeerDisconnectedRef = useRef(onPeerDisconnected);
    const isHostRef = useRef(isHost);
    const currentAccountIdRef = useRef(currentAccountId);
    const joinPasswordRef = useRef(joinPassword);

    useEffect(() => { onReceiveMessageRef.current = onReceiveMessage; }, [onReceiveMessage]);
    useEffect(() => { onPeerConnectedRef.current = onPeerConnected; }, [onPeerConnected]);
    useEffect(() => { onPeerDisconnectedRef.current = onPeerDisconnected; }, [onPeerDisconnected]);
    useEffect(() => { isHostRef.current = isHost; }, [isHost]);
    useEffect(() => { currentAccountIdRef.current = currentAccountId; }, [currentAccountId]);
    useEffect(() => { joinPasswordRef.current = joinPassword; }, [joinPassword]);

    // peerId and hostPeerId are string primitives derived from interactionData.id.
    // They only change when the chat session ID changes — which is exactly when
    // we need to tear down and recreate the PeerJS connection.
    const peerId = multiplayerData && interactionData
        ? (isHost
            ? buildHostPeerId(interactionData.id)
            : currentAccountId
                ? buildPeerId(interactionData.id, currentAccountId)
                : null)
        : null;

    const hostPeerId = multiplayerData && interactionData && !isHost
        ? buildHostPeerId(interactionData.id)
        : null;

    // Initialize PeerJS connection.
    // IMPORTANT: Do NOT include interactionData in the dependency array.
    // interactionData changes on every synced message (setInteractionData),
    // which would destroy and recreate the peer in an infinite loop.
    // peerId/hostPeerId already encode interactionData.id, so the effect
    // correctly re-runs only when the chat session ID changes.
    useEffect(() => {
        if (!peerId || !multiplayerData) return;

        let destroyed = false;
        const localConnections = new Map<string, DataConnection>();

        const setupConnection = (conn: DataConnection) => {
            conn.on('open', () => {
                const remotePeerId = conn.peer;
                const remoteAccountId = extractAccountIdFromPeerId(remotePeerId);
                if (!remoteAccountId) return;

                localConnections.set(remoteAccountId, conn);
                connectionsRef.current = localConnections;
                setConnectedPeers(prev => [...prev.filter(id => id !== remoteAccountId), remoteAccountId]);
                setIsConnected(true);
                onPeerConnectedRef.current(remoteAccountId);

                // If we're a client connecting to host, send join request
                const localAcctId = currentAccountIdRef.current;
                if (localAcctId && !isHostRef.current) {
                    const sanitizedLocalAcctId = localAcctId.replace(/[^A-Za-z0-9]/g, '');
                    console.log('[MP] Client sending join_request:', sanitizedLocalAcctId);
                    const joinMsg: MultiplayerMessage = {
                        type: 'join_request',
                        senderAccountId: sanitizedLocalAcctId,
                        timestamp: Date.now(),
                        payload: {
                            accountId: sanitizedLocalAcctId,
                            password: joinPasswordRef.current,
                        } satisfies JoinRequestPayload,
                    };
                    conn.send(joinMsg);
                }
            });

            conn.on('data', (data) => {
                const msg = data as MultiplayerMessage;
                if (msg?.type && msg?.senderAccountId) {
                    console.log('[MP] Received message:', msg.type, 'from:', msg.senderAccountId);
                    onReceiveMessageRef.current(msg);
                }
            });

            conn.on('close', () => {
                const remotePeerId = conn.peer;
                const remoteAccountId = extractAccountIdFromPeerId(remotePeerId);
                if (remoteAccountId) {
                    localConnections.delete(remoteAccountId);
                    connectionsRef.current = localConnections;
                    setConnectedPeers(prev => prev.filter(id => id !== remoteAccountId));
                    setIsConnected(localConnections.size > 0);
                    onPeerDisconnectedRef.current(remoteAccountId);
                }
            });

            conn.on('error', (err) => {
                console.error('[MP] DataConnection error:', err);
            });
        };

        const peer = new Peer(peerId, {
            debug: 1,
        });

        peerRef.current = peer;

        peer.on('open', (id) => {
            if (destroyed) return;
            console.log(`[MP] Registered as peer: ${id} (isHost: ${isHostRef.current})`);
            setConnectionError(null);

            if (!isHostRef.current && hostPeerId) {
                let retries = 0;
                const maxRetries = 15;
                const retryDelayMs = 2000;

                const tryConnect = () => {
                    if (destroyed) return;
                    console.log('[MP] Attempting to connect to host:', hostPeerId);
                    const conn = peer.connect(hostPeerId, { reliable: true });

                    // Register all handlers BEFORE the connection opens.
                    // setupConnection internally registers conn.on('open') which
                    // handles the join request send.
                    setupConnection(conn);

                    conn.on('error', (err) => {
                        console.error('[MP] Connection attempt error:', err);
                        retries++;
                        if (retries < maxRetries && !destroyed) {
                            console.warn(`[MP] Failed to connect to host, retry ${retries}/${maxRetries}...`);
                            setTimeout(tryConnect, retryDelayMs);
                        } else if (!destroyed) {
                            setConnectionError('Could not connect to host after multiple attempts');
                        }
                    });
                };

                tryConnect();
            }
        });

        peer.on('connection', (conn) => {
            if (destroyed) return;
            console.log('[MP] Incoming connection from:', conn.peer);
            setupConnection(conn);
        });

        peer.on('error', (err) => {
            if (destroyed) return;
            console.error('PeerJS error:', err);
            setConnectionError(err.message);
            setIsConnected(false);
        });

        peer.on('disconnected', () => {
            if (destroyed) return;
            setIsConnected(false);
        });

        return () => {
            destroyed = true;
            for (const [, conn] of localConnections) {
                conn.close();
            }
            localConnections.clear();
            connectionsRef.current = new Map();
            peer.destroy();
            peerRef.current = null;
            setIsConnected(false);
            setConnectedPeers([]);
        };
    }, [peerId, hostPeerId, multiplayerData]);

    const broadcast = useCallback((msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => {
        const acctId = currentAccountIdRef.current;
        if (!acctId) return;
        const sanitizedAcctId = acctId.replace(/[^A-Za-z0-9]/g, '');
        const fullMsg: MultiplayerMessage = {
            ...msg,
            senderAccountId: sanitizedAcctId,
            timestamp: Date.now(),
        };
        for (const [, conn] of connectionsRef.current) {
            try {
                conn.send(fullMsg);
            } catch (e) {
                console.warn('Failed to send to peer:', e);
            }
        }
    }, []);

    const sendTo = useCallback((accountId: string, msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => {
        const acctId = currentAccountIdRef.current;
        if (!acctId) return;

        let conn = connectionsRef.current.get(accountId);
        if (!conn) {
            const sanitizedTargetId = accountId.replace(/[^A-Za-z0-9]/g, '');
            conn = connectionsRef.current.get(sanitizedTargetId);
        }
        if (!conn) {
            console.warn(`[MP] sendTo: No connection found for ${accountId}`);
            return;
        }

        const sanitizedAcctId = acctId.replace(/[^A-Za-z0-9]/g, '');
        const fullMsg: MultiplayerMessage = {
            ...msg,
            senderAccountId: sanitizedAcctId,
            timestamp: Date.now(),
        };
        try {
            conn.send(fullMsg);
        } catch (e) {
            console.warn(`Failed to send to ${accountId}:`, e);
        }
    }, []);

    const disconnect = useCallback(() => {
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        connectionsRef.current.clear();
        setIsConnected(false);
        setConnectedPeers([]);
    }, []);

    return {
        isConnected,
        connectedPeers,
        connectionError,
        broadcast,
        sendTo,
        disconnect,
        peerId,
        hostPeerId,
    };
}

export type { MultiplayerMessage, ChatMessagePayload, JoinRequestPayload, JoinResponsePayload, StateSyncPayload, MessageType };