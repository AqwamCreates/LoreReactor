// src/hooks/useMultiplayerConnection.ts
import { useState, useCallback, useRef, useEffect } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import type { MultiplayerData, HistoryMessage } from '../types';

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

function buildPeerId(multiplayerDataId: string, accountId: string): string {
    const mpId = multiplayerDataId.replace(/[^A-Za-z0-9]/g, '');
    const acctId = accountId.replace(/[^A-Za-z0-9]/g, '');
    return `lr_${mpId}_${acctId}`;
}

function buildHostPeerId(multiplayerDataId: string): string {
    const mpId = multiplayerDataId.replace(/[^A-Za-z0-9]/g, '');
    return `lr_${mpId}_host`;
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
    currentAccountId: string | null;
    isHost: boolean;
    joinPassword?: string;
    onReceiveMessage: (msg: MultiplayerMessage) => void;
    onPeerConnected: (accountId: string) => void;
    onPeerDisconnected: (accountId: string) => void;
}

export function useMultiplayerConnection({
    multiplayerData,
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

    const peerId = multiplayerData
        ? (isHost
            ? buildHostPeerId(multiplayerData.id)
            : currentAccountId
                ? buildPeerId(multiplayerData.id, currentAccountId)
                : null)
        : null;

    const hostPeerId = multiplayerData && !isHost
        ? buildHostPeerId(multiplayerData.id)
        : null;

    // Initialize PeerJS connection
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
                onPeerConnectedRef.current(remoteAccountId);

                // If we're a client connecting to host, send join request
                const localAcctId = currentAccountIdRef.current;
                if (localAcctId && !isHostRef.current) {
                    const sanitizedLocalAcctId = localAcctId.replace(/[^A-Za-z0-9]/g, '');
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
                    onPeerDisconnectedRef.current(remoteAccountId);
                }
            });

            conn.on('error', (err) => {
                console.error('DataConnection error:', err);
            });
        };

        const peer = new Peer(peerId, {
            debug: 1,
        });

        peerRef.current = peer;

        peer.on('open', () => {
            if (destroyed) return;
            setIsConnected(true);
            setConnectionError(null);

            // If not host, connect to host with retry
            if (!isHostRef.current && hostPeerId) {
                let retries = 0;
                const maxRetries = 5;
                const retryDelayMs = 2000;

                const tryConnect = () => {
                    if (destroyed) return;
                    const conn = peer.connect(hostPeerId, { reliable: true });

                    conn.on('open', () => {
                        setupConnection(conn);
                    });

                    conn.on('error', () => {
                        retries++;
                        if (retries < maxRetries && !destroyed) {
                            console.warn(`Failed to connect to host, retry ${retries}/${maxRetries}...`);
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

    // Send message to all connected peers
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

    // Send message to a specific peer — try both raw and sanitized key lookup
    const sendTo = useCallback((accountId: string, msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => {
        const acctId = currentAccountIdRef.current;
        if (!acctId) return;

        // Try exact match first, then sanitized match
        let conn = connectionsRef.current.get(accountId);
        if (!conn) {
            const sanitizedTargetId = accountId.replace(/[^A-Za-z0-9]/g, '');
            conn = connectionsRef.current.get(sanitizedTargetId);
        }
        if (!conn) return;

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

    // Disconnect from session
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