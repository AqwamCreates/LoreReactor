// src/hooks/useMultiplayerConnection.ts
import { useState, useCallback, useRef, useEffect } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import type { MultiplayerData, InteractionData, HistoryMessage, Character, Context, Location, AudioTrack, Profile } from '../types';

// ─── Message Protocol ──────────────────────────────────────────────

type MessageType =
    | 'set_protagonist'
    | 'protagonist_change'
    | 'typing_indicator'
    | 'chat_message'
    | 'join_request'
    | 'join_response'
    | 'join_pending'
    | 'state_sync'
    | 'message_edit'
    | 'message_delete'
    | 'host_migration'
    | 'borrow_model_request'
    | 'borrow_model_response'
    | 'shared_model_usage'
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
    requestedCharacterId?: string;
    requestedCharacterData?: Character;
}

export interface JoinResponsePayload {
    accepted: boolean;
    reason?: string;
    initialState?: {
        protagonists: Character[];
        participants: Character[];
        contexts: Context[];
        locations: Location[];
        audioTracks: AudioTrack[];
        Profile?: Profile;
    };
    assignedCharacter?: Character | null;
    sessionRules?: {
        canUseJoinerCharacterId: boolean;
        canUseHosterCharacterId: boolean;
        joinerCharacterIdRequiresHosterApproval: boolean;
        hosterCharacterIdRequiresHosterApproval: boolean;
    };
}

interface JoinPendingPayload {
    message?: string;
}

interface StateSyncPayload {
    interactionHistory: HistoryMessage[];
    protagonistIds: string[];
    participantIds: string[];
}

interface MessageEditPayload {
    messageId: string;
    newText: string;
}

interface MessageDeletePayload {
    messageId: string;
}

interface HostMigrationPayload {
    newHostId: string;
    newHostPeerId: string;
    finalState: InteractionData;
}

// ─── Peer ID Helpers ───────────────────────────────────────────────

function sanitizeId(id: string, maxLen = 36): string {
    return id.replace(/[^A-Za-z0-9]/g, '').slice(0, maxLen);
}

function buildPeerId(interactionDataId: string, accountId: string): string {
    // Standard PeerJS broker limits Peer IDs to 64 chars max.
    // 'lr_' (3) + chatId (18) + '_' (1) + accountId (36) = 58 chars max.
    const chatId = sanitizeId(interactionDataId, 18);
    const acctId = sanitizeId(accountId, 36);
    return `lr_${chatId}_${acctId}`;
}

function buildHostPeerId(interactionDataId: string): string {
    const chatId = sanitizeId(interactionDataId, 18);
    return `lr_${chatId}_host`;
}

function extractAccountIdFromPeerId(peerId: string): string | null {
    const parts = peerId.split('_');
    if (parts.length < 3 || parts[0] !== 'lr') return null;
    return parts.slice(2).join('_') || null;
}

// ─── Hook ──────────────────────────────────────────────────────────

interface UseMultiplayerConnectionOptions {
    multiplayerData: MultiplayerData | null;
    interactionData: InteractionData | null;
    currentAccountId: string | null;
    isHost: boolean;
    joinPassword?: string;
    joinRequestedCharacterId?: string | null;
    joinRequestedCharacterData?: Character | null;
    onReceiveMessage: (msg: MultiplayerMessage) => void;
    onPeerConnected: (accountId: string) => void;
    onPeerDisconnected: (accountId: string) => void;
    onConnectionFailed?: () => void;
}

export function useMultiplayerConnection({
    multiplayerData,
    interactionData,
    currentAccountId,
    isHost,
    joinPassword,
    joinRequestedCharacterId,
    joinRequestedCharacterData,
    onReceiveMessage,
    onPeerConnected,
    onPeerDisconnected,
    onConnectionFailed,
}: UseMultiplayerConnectionOptions) {
    const [isConnected, setIsConnected] = useState(false);
    const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const peerRef = useRef<Peer | null>(null);
    const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
    const onReceiveMessageRef = useRef(onReceiveMessage);
    const onPeerConnectedRef = useRef(onPeerConnected);
    const onPeerDisconnectedRef = useRef(onPeerDisconnected);
    const onConnectionFailedRef = useRef(onConnectionFailed);
    const isHostRef = useRef(isHost);
    const currentAccountIdRef = useRef(currentAccountId);
    const joinPasswordRef = useRef(joinPassword);
    const joinRequestedCharacterIdRef = useRef(joinRequestedCharacterId);
    const joinRequestedCharacterDataRef = useRef(joinRequestedCharacterData);

    useEffect(() => { onReceiveMessageRef.current = onReceiveMessage; }, [onReceiveMessage]);
    useEffect(() => { onPeerConnectedRef.current = onPeerConnected; }, [onPeerConnected]);
    useEffect(() => { onPeerDisconnectedRef.current = onPeerDisconnected; }, [onPeerDisconnected]);
    useEffect(() => { onConnectionFailedRef.current = onConnectionFailed; }, [onConnectionFailed]);
    useEffect(() => { isHostRef.current = isHost; }, [isHost]);
    useEffect(() => { currentAccountIdRef.current = currentAccountId; }, [currentAccountId]);
    useEffect(() => { joinPasswordRef.current = joinPassword; }, [joinPassword]);
    useEffect(() => { joinRequestedCharacterIdRef.current = joinRequestedCharacterId; }, [joinRequestedCharacterId]);
    useEffect(() => { joinRequestedCharacterDataRef.current = joinRequestedCharacterData; }, [joinRequestedCharacterData]);

    const effectiveChatId = interactionData?.id;

    // Derived strictly so reference changes to multiplayerData content don't recalculate peerId
    const hasMultiplayerData = !!multiplayerData;
    const peerId = effectiveChatId
        ? (isHost
            ? (hasMultiplayerData ? buildHostPeerId(effectiveChatId) : null)
            : currentAccountId
                ? buildPeerId(effectiveChatId, currentAccountId)
                : null)
        : null;

    const hostPeerId = effectiveChatId && !isHost
        ? buildHostPeerId(effectiveChatId)
        : null;

    useEffect(() => {
        if (!peerId) {
            return;
        }

        let destroyed = false;
        const localConnections = new Map<string, DataConnection>();
        connectionsRef.current = localConnections;

        const retryTimers = new Set<ReturnType<typeof setTimeout>>();
        const safeSetTimeout = (fn: () => void, ms: number) => {
            const timer = setTimeout(() => {
                retryTimers.delete(timer);
                if (!destroyed) fn();
            }, ms);
            retryTimers.add(timer);
            return timer;
        };

        const setupConnection = (conn: DataConnection) => {
            conn.on('open', () => {
                if (destroyed) {
                    try { conn.close(); } catch { /* ignore */ }
                    return;
                }

                const remotePeerId = conn.peer;
                const remoteAccountId = extractAccountIdFromPeerId(remotePeerId);
                if (!remoteAccountId) return;

                const existing = localConnections.get(remoteAccountId);
                if (existing && existing !== conn) {
                    try { existing.close(); } catch { /* ignore */ }
                }

                localConnections.set(remoteAccountId, conn);
                connectionsRef.current = localConnections;
                setConnectedPeers(prev => [...prev.filter(id => id !== remoteAccountId), remoteAccountId]);
                setIsConnected(true);
                onPeerConnectedRef.current(remoteAccountId);

                const localAcctId = currentAccountIdRef.current;
                if (localAcctId && !isHostRef.current) {
                    const sanitizedLocalAcctId = sanitizeId(localAcctId, 36);
                    console.log('[MP] Client sending join_request:', sanitizedLocalAcctId);
                    const joinMsg: MultiplayerMessage = {
                        type: 'join_request',
                        senderAccountId: sanitizedLocalAcctId,
                        timestamp: Date.now(),
                        payload: {
                            accountId: sanitizedLocalAcctId,
                            password: joinPasswordRef.current,
                            requestedCharacterId: joinRequestedCharacterIdRef.current ?? undefined,
                            requestedCharacterData: joinRequestedCharacterDataRef.current ?? undefined,
                        } satisfies JoinRequestPayload,
                    };
                    try {
                        conn.send(joinMsg);
                    } catch (e) {
                        console.error('[MP] Failed to send join_request:', e);
                    }
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
                    setIsConnected(localConnections.size > 0);
                    onPeerDisconnectedRef.current(remoteAccountId);
                }
            });

            conn.on('error', (err) => {
                console.error('[MP] DataConnection error:', err);
            });
        };

        const peerConfig: Record<string, unknown> = { debug: 1 };
        const peer = new Peer(peerId, peerConfig);
        peerRef.current = peer;

        peer.on('open', () => {
            if (destroyed) return;
            setConnectionError(null);

            if (!isHostRef.current && hostPeerId) {
                let retries = 0;
                const maxRetries = 15;
                let retryDelayMs = 1000;

                const tryConnect = () => {
                    if (destroyed) return;
                    const conn = peer.connect(hostPeerId, { reliable: true });
                    setupConnection(conn);

                    conn.on('error', () => {
                        retries++;
                        if (retries < maxRetries && !destroyed) {
                            retryDelayMs = Math.min(retryDelayMs * 2, 30000);
                            safeSetTimeout(tryConnect, retryDelayMs);
                        } else if (!destroyed) {
                            setConnectionError('Could not connect to host after multiple attempts');
                            onConnectionFailedRef.current?.();
                        }
                    });
                };

                safeSetTimeout(tryConnect, 500);
            }
        });

        peer.on('connection', (conn) => {
            if (destroyed) return;
            setupConnection(conn);
        });

        peer.on('error', (err) => {
            if (destroyed) return;
            console.error('[MP] Peer error:', err);
            setConnectionError(err.message);
            setIsConnected(false);
        });

        peer.on('disconnected', () => {
            if (destroyed) return;
            setIsConnected(false);
        });

        return () => {
            destroyed = true;

            for (const t of retryTimers) clearTimeout(t);
            retryTimers.clear();

            for (const [, conn] of localConnections) {
                try { conn.close(); } catch { /* ignore */ }
            }
            localConnections.clear();
            connectionsRef.current = new Map();

            if (peer && !peer.destroyed) {
                try { peer.destroy(); } catch { /* ignore */ }
            }
            peerRef.current = null;
            setIsConnected(false);
            setConnectedPeers([]);
        };
    }, [peerId, hostPeerId]); // multiplayerData intentionally excluded to avoid reconnect loops

    const broadcast = useCallback((msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => {
        const acctId = currentAccountIdRef.current;
        if (!acctId) return;
        const sanitizedAcctId = sanitizeId(acctId, 36);
        const fullMsg: MultiplayerMessage = { ...msg, senderAccountId: sanitizedAcctId, timestamp: Date.now() };

        for (const [, conn] of connectionsRef.current) {
            if (conn.open) {
                try {
                    conn.send(fullMsg);
                } catch (e) {
                    console.warn('Failed to send to peer:', e);
                }
            }
        }
    }, []);

    const sendTo = useCallback((accountId: string, msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => {
        const acctId = currentAccountIdRef.current;
        if (!acctId) return;
        const sanitizedTargetId = sanitizeId(accountId, 36);
        const conn = connectionsRef.current.get(sanitizedTargetId)
            || connectionsRef.current.get(accountId)
            || connectionsRef.current.get(accountId.replace(/[^A-Za-z0-9]/g, ''));

        if (!conn || !conn.open) return;
        const sanitizedSenderId = sanitizeId(acctId, 36);
        const fullMsg: MultiplayerMessage = { ...msg, senderAccountId: sanitizedSenderId, timestamp: Date.now() };

        try {
            conn.send(fullMsg);
        } catch (e) {
            console.warn(`Failed to send to ${accountId}:`, e);
        }
    }, []);

    const disconnect = useCallback(() => {
        for (const [, conn] of connectionsRef.current) {
            try { conn.close(); } catch { /* ignore */ }
        }
        connectionsRef.current.clear();

        if (peerRef.current && !peerRef.current.destroyed) {
            try { peerRef.current.destroy(); } catch { /* ignore */ }
            peerRef.current = null;
        }

        setIsConnected(false);
        setConnectedPeers([]);
    }, []);

    return { isConnected, connectedPeers, connectionError, broadcast, sendTo, disconnect, peerId, hostPeerId };
}

export type {
    MultiplayerMessage,
    ChatMessagePayload,
    JoinRequestPayload,
    JoinPendingPayload,
    StateSyncPayload,
    MessageEditPayload,
    MessageDeletePayload,
    HostMigrationPayload,
    MessageType,
};