// src/hooks/useMultiplayerConnection.ts
import { useState, useCallback, useRef, useEffect } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import type { MultiplayerData, InteractionData, HistoryMessage, Character, Context, Location, AudioTrack, Profile } from '../types';

// ─── Message Protocol ──────────────────────────────────────────────
export type MessageType =
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
    | 'borrow_inference_request'
    | 'borrow_inference_chunk'
    | 'borrow_inference_cancel'
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
        canUseHosterParticipantingCharacterId: boolean;
        canUseHosterNonParticipantingCharacterId: boolean;
        joinerCharacterIdRequiresHosterApproval: boolean;
        hosterParticipantingCharacterIdRequiresHosterApproval: boolean;
        hosterNonParticipantingCharacterIdRequiresHosterApproval: boolean;
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

export interface HostMigrationPayload {
    newHostId: string;
    newHostPeerId: string;
    finalState: InteractionData;
    multiplayerData?: MultiplayerData | null;
}

export interface BorrowInferenceRequestPayload {
    requestId: string;
    modelName: string;
    promptOrMessages: any;
    parameters?: Record<string, unknown>;
}

export interface BorrowInferenceChunkPayload {
    requestId: string;
    token?: string;
    done: boolean;
    error?: string;
}

export interface BorrowInferenceCancelPayload {
    requestId: string;
}

// ─── WebRTC Chunking Protocol ───────────────────────────────────────
const CHUNK_SIZE = 32 * 1024;

interface ChunkPacket {
    __isChunk: true;
    transferId: string;
    index: number;
    total: number;
    data: string;
}

function isChunkPacket(data: unknown): data is ChunkPacket {
    return (
        typeof data === 'object' &&
        data !== null &&
        (data as any).__isChunk &&
        typeof (data as any).transferId === 'string' &&
        typeof (data as any).index === 'number' &&
        typeof (data as any).total === 'number' &&
        typeof (data as any).data === 'string'
    );
}

function sendPayloadWithChunking(conn: DataConnection, fullMsg: MultiplayerMessage) {
    if (!conn.open) return;

    let serialized: string;
    try {
        serialized = JSON.stringify(fullMsg);
    } catch (err) {
        console.error('[MP] Serialization error:', err);
        return;
    }

    if (serialized.length <= CHUNK_SIZE) {
        try {
            conn.send(fullMsg);
        } catch (e) {
            console.warn('[MP] Direct send failed:', e);
        }
        return;
    }

    const total = Math.ceil(serialized.length / CHUNK_SIZE);
    const transferId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    for (let i = 0; i < total; i++) {
        const chunk: ChunkPacket = {
            __isChunk: true,
            transferId,
            index: i,
            total,
            data: serialized.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        };
        try {
            conn.send(chunk);
        } catch (err) {
            console.error(`[MP] DataChannel buffer error sending chunk ${i + 1}/${total}:`, err);
            break;
        }
    }
}

// ─── Peer ID Helpers ───────────────────────────────────────────────
function sanitizeId(id: string, maxLen = 36): string {
    return id.replace(/[^A-Za-z0-9]/g, '').slice(0, maxLen);
}

function buildPeerId(interactionDataId: string, accountId: string): string {
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
    const incomingTransfersRef = useRef<Map<string, { total: number; chunks: Map<number, string>; receivedAt: number }>>(new Map());

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

        const handleIncomingChunk = (packet: ChunkPacket) => {
            const now = Date.now();
            const transfers = incomingTransfersRef.current;
            if (transfers.size > 15) {
                for (const [id, t] of transfers.entries()) {
                    if (now - t.receivedAt > 60000) transfers.delete(id);
                }
            }

            let transfer = transfers.get(packet.transferId);
            if (!transfer) {
                transfer = { total: packet.total, chunks: new Map(), receivedAt: now };
                transfers.set(packet.transferId, transfer);
            }
            transfer.chunks.set(packet.index, packet.data);

            if (transfer.chunks.size === transfer.total) {
                transfers.delete(packet.transferId);
                let assembled = '';
                for (let i = 0; i < transfer.total; i++) {
                    assembled += transfer.chunks.get(i) || '';
                }
                try {
                    const parsed = JSON.parse(assembled) as MultiplayerMessage;
                    if (parsed?.type && parsed?.senderAccountId) {
                        onReceiveMessageRef.current(parsed);
                    }
                } catch (e) {
                    console.error('[MP Chunking] Reassembly JSON parse failed:', e);
                }
            }
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
                    sendPayloadWithChunking(conn, joinMsg);
                }
            });

            conn.on('data', (data) => {
                if (isChunkPacket(data)) {
                    handleIncomingChunk(data);
                    return;
                }
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
            incomingTransfersRef.current.clear();

            if (peer && !peer.destroyed) {
                try { peer.destroy(); } catch { /* ignore */ }
            }
            peerRef.current = null;
            setIsConnected(false);
            setConnectedPeers([]);
        };
    }, [peerId, hostPeerId]);

    const broadcast = useCallback((msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => {
        const acctId = currentAccountIdRef.current;
        if (!acctId) return;

        const sanitizedAcctId = sanitizeId(acctId, 36);
        const fullMsg: MultiplayerMessage = { ...msg, senderAccountId: sanitizedAcctId, timestamp: Date.now() };

        for (const [, conn] of connectionsRef.current) {
            sendPayloadWithChunking(conn, fullMsg);
        }
    }, []);

    const sendTo = useCallback((accountId: string, msg: Omit<MultiplayerMessage, 'senderAccountId' | 'timestamp'>) => {
        const acctId = currentAccountIdRef.current;
        if (!acctId) return;

        const sanitizedTargetId = sanitizeId(accountId, 36);
        const conn = connectionsRef.current.get(sanitizedTargetId)
            || connectionsRef.current.get(accountId)
            || connectionsRef.current.get(accountId.replace(/[^A-Za-z0-9]/g, ''));

        if (!conn) return;

        const sanitizedSenderId = sanitizeId(acctId, 36);
        const fullMsg: MultiplayerMessage = { ...msg, senderAccountId: sanitizedSenderId, timestamp: Date.now() };
        sendPayloadWithChunking(conn, fullMsg);
    }, []);

    const disconnect = useCallback(() => {
        for (const [, conn] of connectionsRef.current) {
            try { conn.close(); } catch { /* ignore */ }
        }
        connectionsRef.current.clear();
        incomingTransfersRef.current.clear();

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
};