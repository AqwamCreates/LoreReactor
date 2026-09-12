// src/components/ChatInspectionModal.tsx
import { useMemo, useEffect, useState, useRef } from 'react';
import type { InteractionData, Location, Character } from '../types';
import { getCharacterImageUrlWithFallBack } from '../storage/storage';
import { getCurrentLocation } from '../hooks/locationLogic';
import {
    ReactFlow,
    Background,
    Controls,
    Handle,
    Position,
    type Node,
    type Edge,
    type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './main.css';

interface ChatInspectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    inspectionStack: InteractionData[];
    onInspectingParentInteractionData: (parentId: string) => Promise<InteractionData>;
}

// ─── Custom Location Node ────────────────────────────────────────────

interface LocationNodeData extends Record<string, unknown> {
    name: string;
    isCurrent: boolean;
    hasParticipants: boolean;
    isReachable: boolean;
    participants: { name: string; index: number }[];
}

function LocationNode({ data }: NodeProps<Node<LocationNodeData>>) {
    const { name, isCurrent, hasParticipants, isReachable, participants } = data;

    let borderColor: string;
    let bgColor: string;
    let textColor: string;
    let opacity: number;
    let boxShadow: string | undefined;

    if (isCurrent) {
        borderColor = '#4ade80';
        bgColor = 'rgba(74, 222, 128, 0.15)';
        textColor = '#4ade80';
        opacity = 1;
        boxShadow = '0 0 16px rgba(74, 222, 128, 0.4), inset 0 0 8px rgba(74, 222, 128, 0.1)';
    } else if (hasParticipants) {
        borderColor = '#f59e0b';
        bgColor = 'rgba(245, 158, 11, 0.12)';
        textColor = '#fbbf24';
        opacity = 1;
        boxShadow = '0 0 10px rgba(245, 158, 11, 0.3)';
    } else if (isReachable) {
        borderColor = 'rgba(96, 165, 250, 0.6)';
        bgColor = 'rgba(96, 165, 250, 0.08)';
        textColor = '#93c5fd';
        opacity = 0.9;
        boxShadow = '0 0 6px rgba(96, 165, 250, 0.15)';
    } else {
        borderColor = 'rgba(255, 255, 255, 0.1)';
        bgColor = 'rgba(255, 255, 255, 0.03)';
        textColor = 'rgba(255, 255, 255, 0.5)';
        opacity = 0.45;
        boxShadow = undefined;
    }

    return (
        <div style={{
            border: `2px solid ${borderColor}`,
            background: bgColor,
            borderRadius: '10px',
            padding: '10px 14px',
            minWidth: '140px',
            maxWidth: '200px',
            opacity,
            boxShadow,
            transition: 'all 0.3s ease',
            textAlign: 'center',
        }}>
            <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
            <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />

            <div style={{
                fontWeight: 'bold',
                fontSize: '0.78rem',
                color: textColor,
                marginBottom: participants.length > 0 ? '6px' : 0,
                lineHeight: 1.3,
            }}>
                {name}
            </div>

            {participants.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {participants.map(pp => (
                        <span key={`${pp.name}-${pp.index}`} style={{
                            fontSize: '0.6rem',
                            padding: '2px 6px',
                            background: hasParticipants ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.08)',
                            borderRadius: '4px',
                            color: hasParticipants ? '#fde68a' : 'rgba(255,255,255,0.7)',
                        }}>
                            {pp.name} ({pp.index + 1})
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

const nodeTypes = { locationNode: LocationNode };

// ─── Helpers ─────────────────────────────────────────────────────────

function getRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

/**
 * Haversine distance in km between two coordinate pairs.
 */
function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Get distance between two locations.
 * Prioritizes author-defined locationDistances, falls back to Haversine from lat/lng.
 * Returns null if neither source is available.
 */
function getLocationDistanceKm(locA: Location, locB: Location): number | null {
    // Priority 1: explicit locationDistances
    const explicitAB = locA.locationDistances?.[locB.id];
    if (explicitAB !== undefined) return explicitAB;

    const explicitBA = locB.locationDistances?.[locA.id];
    if (explicitBA !== undefined) return explicitBA;

    // Priority 2: Haversine from coordinates
    if (locA.latitude != null && locA.longitude != null &&
        locB.latitude != null && locB.longitude != null) {
        return haversineDistanceKm(locA.latitude, locA.longitude, locB.latitude, locB.longitude);
    }

    return null;
}

function useCharacterPortraits(characters: Character[]): Map<string, string | null> {
    const [portraits, setPortraits] = useState<Map<string, string | null>>(new Map());

    useEffect(() => {
        let cancelled = false;
        const resolved = new Map<string, string | null>();

        (async () => {
            for (const c of characters) {
                const url = await getCharacterImageUrlWithFallBack(c.id);
                if (!cancelled) resolved.set(c.id, url);
            }
            if (!cancelled) setPortraits(new Map(resolved));
        })();

        return () => { cancelled = true; };
    }, [characters.map(c => c.id).join(',')]);

    return portraits;
}

// ─── Component ───────────────────────────────────────────────────────

export function ChatInspectionModal({
    isOpen,
    onClose,
    inspectionStack,
    onInspectingParentInteractionData,
}: ChatInspectionModalProps) {
    const [internalStack, setInternalStack] = useState<InteractionData[]>([]);
    const prevOpenRef = useRef(false);

    useEffect(() => {
        if (isOpen && !prevOpenRef.current && inspectionStack.length > 0) {
            setInternalStack([...inspectionStack]);
        } else if (!isOpen) {
            setInternalStack([]);
        }
        prevOpenRef.current = isOpen;
    }, [isOpen, inspectionStack]);

    const chat = internalStack[0] ?? null;
    const canGoBack = internalStack.length > 1;

    // ALL derived values and hooks MUST be before the early return
    const protagonist = chat?.protagonist ?? null;
    const participants = chat?.participants || [];
    const locations = chat?.locations || [];
    const audioTracks = chat?.audioTracks || [];
    const contexts = chat?.contexts || [];
    const hasLocations = locations.length > 0;
    const hasContexts = contexts.length > 0;
    const hasAudioTracks = audioTracks.length > 0;
    const parentName = canGoBack ? internalStack[1]?.name : undefined;

    const portraits = useCharacterPortraits(participants);

    const handleBack = () => {
        setInternalStack(prev => prev.slice(1));
    };

    const handleNavigateToParent = async () => {
        const current = internalStack[0];
        if (!current?.parentInteractionDataId) return;
        try {
            const parentData = await onInspectingParentInteractionData(current.parentInteractionDataId);
            setInternalStack(prev => [parentData, ...prev]);
        } catch {
            // Parent data unavailable
        }
    };

    const { nodes, edges } = useMemo(() => {
        if (!chat || !chat.locations || chat.locations.length === 0) {
            return { nodes: [] as Node[], edges: [] as Edge[] };
        }

        let currentLoc: Location | undefined;
        for (let i = chat.interactionHistory.length - 1; i >= 0; i--) {
            if (chat.interactionHistory[i].locationIndex !== undefined && chat.locations) {
                currentLoc = chat.locations[chat.interactionHistory[i].locationIndex!];
                break;
            }
        }

        const parts = chat.participants || [];

        const locParticipants = new Map<string, { name: string; index: number }[]>();
        for (const loc of chat.locations) {
            locParticipants.set(loc.id, []);
        }
        for (let i = 0; i < parts.length; i++) {
            const pLoc = getCurrentLocation(chat, parts[i]);
            if (pLoc && locParticipants.has(pLoc.id)) {
                locParticipants.get(pLoc.id)!.push({ name: parts[i].name, index: i });
            }
        }

        const SCALE_PX_PER_KM = 3;
        const MAX_DISTANCE_KM = 200;

        const locIndexMap = new Map<string, number>();
        chat.locations.forEach((loc, idx) => locIndexMap.set(loc.id, idx));

        const centerX = 400;
        const centerY = 300;
        const positions: { x: number; y: number }[] = chat.locations.map((loc, idx) => {
            if (currentLoc && loc.id === currentLoc.id) {
                return { x: centerX, y: centerY };
            }
            const angle = (idx / chat.locations.length) * Math.PI * 2;
            const radius = 200;
            return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
        });

        const anchorIdx = currentLoc ? locIndexMap.get(currentLoc.id) : undefined;

        const ITERATIONS = 80;
        for (let iter = 0; iter < ITERATIONS; iter++) {
            // Distance-based attraction: use locationDistances first, fall back to Haversine
            for (let i = 0; i < chat.locations.length; i++) {
                for (let j = i + 1; j < chat.locations.length; j++) {
                    const distKm = getLocationDistanceKm(chat.locations[i], chat.locations[j]);
                    if (distKm === null) continue;

                    const dx = positions[j].x - positions[i].x;
                    const dy = positions[j].y - positions[i].y;
                    const currentDist = Math.sqrt(dx * dx + dy * dy);
                    const targetDist = Math.min(distKm * SCALE_PX_PER_KM, MAX_DISTANCE_KM * SCALE_PX_PER_KM);

                    if (currentDist < 0.1) continue;

                    const force = (targetDist - currentDist) / currentDist;
                    const step = force * 0.15;

                    const isAnchoredI = i === anchorIdx;
                    const isAnchoredJ = j === anchorIdx;
                    const moveI = isAnchoredI ? 0.05 : 0.5;
                    const moveJ = isAnchoredJ ? 0.05 : 0.5;

                    positions[i].x -= dx * step * moveI;
                    positions[i].y -= dy * step * moveI;
                    positions[j].x += dx * step * moveJ;
                    positions[j].y += dy * step * moveJ;
                }
            }

            // Minimum separation repulsion
            for (let i = 0; i < chat.locations.length; i++) {
                for (let j = i + 1; j < chat.locations.length; j++) {
                    const dx = positions[j].x - positions[i].x;
                    const dy = positions[j].y - positions[i].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minSep = 160;
                    if (dist < minSep && dist > 0.1) {
                        const push = (minSep - dist) / dist * 0.3;
                        const isAnchoredI = i === anchorIdx;
                        const isAnchoredJ = j === anchorIdx;
                        const moveI = isAnchoredI ? 0.02 : 0.3;
                        const moveJ = isAnchoredJ ? 0.02 : 0.3;
                        positions[i].x -= dx * push * moveI;
                        positions[i].y -= dy * push * moveI;
                        positions[j].x += dx * push * moveJ;
                        positions[j].y += dy * push * moveJ;
                    }
                }
            }
        }

        const graphNodes: Node<LocationNodeData>[] = chat.locations.map((loc, idx) => {
            const isCurrent = currentLoc?.id === loc.id;
            const locParts = locParticipants.get(loc.id) || [];
            const hasParticipants = locParts.length > 0;
            const isReachable = !isCurrent && !hasParticipants && !!currentLoc &&
                !!loc.locationBindings && loc.locationBindings.includes(currentLoc.id);

            return {
                id: loc.id,
                type: 'locationNode',
                position: positions[idx],
                data: {
                    name: loc.name,
                    isCurrent,
                    hasParticipants,
                    isReachable,
                    participants: locParts,
                },
            };
        });

        const graphEdges: Edge[] = [];
        let edgeIdx = 0;
        for (const loc of chat.locations) {
            if (loc.locationBindings) {
                const isSourceActive = loc.id === currentLoc?.id || (locParticipants.get(loc.id)?.length ?? 0) > 0;
                for (const boundId of loc.locationBindings) {
                    const boundLoc = chat.locations.find(l => l.id === boundId);
                    if (!boundLoc) continue;

                    const distKm = getLocationDistanceKm(loc, boundLoc);
                    const label = distKm !== null ? `${Math.round(distKm)}km` : undefined;

                    graphEdges.push({
                        id: `e-${edgeIdx++}`,
                        source: loc.id,
                        target: boundId,
                        type: 'smoothstep',
                        animated: isSourceActive,
                        label,
                        labelStyle: {
                            fontSize: '0.55rem',
                            fill: isSourceActive ? '#fbbf24' : 'rgba(255,255,255,0.4)',
                            fontWeight: 500,
                        },
                        labelBgStyle: {
                            fill: 'var(--social-bg, #1a1a2e)',
                            fillOpacity: 0.8,
                            rx: 4, ry: 4,
                        },
                        labelBgPadding: [4, 2] as [number, number],
                        style: {
                            stroke: isSourceActive ? '#f59e0b' : 'rgba(255, 255, 255, 0.12)',
                            strokeWidth: isSourceActive ? 2 : 1,
                            opacity: isSourceActive ? 0.9 : 0.3,
                        },
                    });
                }
            }
        }

        return { nodes: graphNodes, edges: graphEdges };
    }, [chat]);

    // Occupied locations — MUST be before early return
    const occupiedLocations = useMemo(() => {
        if (!chat || !hasLocations) return [];
        const occupiedMap = new Map<string, { location: Location; participants: { name: string; index: number; portraitUrl: string | null }[] }>();
        for (let i = 0; i < participants.length; i++) {
            const pLoc = getCurrentLocation(chat, participants[i]);
            if (!pLoc) continue;
            if (!occupiedMap.has(pLoc.id)) {
                occupiedMap.set(pLoc.id, { location: pLoc, participants: [] });
            }
            occupiedMap.get(pLoc.id)!.participants.push({
                name: participants[i].name,
                index: i,
                portraitUrl: portraits.get(participants[i].id) ?? null,
            });
        }
        return Array.from(occupiedMap.values());
    }, [chat, hasLocations, participants, portraits]);

    // Early return AFTER all hooks
    if (!isOpen || !chat) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px', maxHeight: '90vh' }}>
                <div className="modal-header">
                    <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                        {chat.name || 'Untitled Chat'}
                    </h2>
                    <div className="editor-modal-actions">
                        {canGoBack && (
                            <button
                                type="button"
                                className="editor-button editor-button-cancel"
                                onClick={handleBack}
                                style={{ fontSize: '0.7rem', padding: '4px 8px', minHeight: '28px' }}
                            >
                                ← Back
                            </button>
                        )}
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Close</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body" style={{ overflowY: 'auto' }}>
                    {/* Stats (top) */}
                    <div className="editor-section" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.65rem', opacity: 0.7 }}>
                            <span>💬 {chat.interactionHistory.length} message{chat.interactionHistory.length !== 1 ? 's' : ''}</span>
                            <span>🕐 Last active: {getRelativeTime(chat.lastUpdatedTimestamp)}</span>
                            {chat.Profile && <span>👤 Profile: {chat.Profile.name}</span>}
                            {chat.parentInteractionDataId && (
                                <button
                                    type="button"
                                    onClick={handleNavigateToParent}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        fontSize: '0.65rem', opacity: 0.7, color: 'var(--accent)',
                                        padding: 0, textDecoration: 'underline',
                                    }}
                                >
                                    🌿 Branching Timeline From {parentName || 'Unknown'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Participants */}
                    {participants.length > 0 && (
                        <div className="editor-section">
                            <span className="editor-section-title">Participants ({participants.length})</span>
                            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 0' }}>
                                {participants.map((p, i) => {
                                    const isProtag = p.id === protagonist?.id;
                                    const pLoc = hasLocations ? getCurrentLocation(chat, p) : undefined;
                                    const portraitUrl = portraits.get(p.id) ?? null;
                                    return (
                                        <div key={p.id} style={{
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                                            padding: '8px', minWidth: '80px', maxWidth: '100px',
                                            background: isProtag ? 'var(--accent-dim, rgba(255,255,255,0.08))' : 'var(--social-bg)',
                                            border: isProtag ? '1px solid var(--accent)' : '1px solid var(--border)',
                                            borderRadius: '6px', flexShrink: 0,
                                        }}>
                                            {portraitUrl ? (
                                                <img
                                                    src={portraitUrl}
                                                    alt={p.name}
                                                    style={{
                                                        width: '36px', height: '64px',
                                                        borderRadius: '4px', objectFit: 'cover',
                                                        aspectRatio: '9 / 16',
                                                    }}
                                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                />
                                            ) : (
                                                <div className="character-avatar placeholder" style={{ width: '36px', height: '64px', aspectRatio: '9 / 16' }} />
                                            )}
                                            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', textAlign: 'center', lineHeight: 1.2 }}>
                                                {p.name}
                                            </div>
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, textAlign: 'center' }}>
                                                (Character {i + 1})
                                            </div>
                                            {pLoc && (
                                                <div style={{
                                                    fontSize: '0.55rem', opacity: 0.7, textAlign: 'center',
                                                    padding: '1px 4px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px',
                                                    marginTop: '2px', maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>
                                                    📍 {pLoc.name}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Occupied Locations */}
                    {occupiedLocations.length > 0 && (
                        <div className="editor-section">
                            <span className="editor-section-title">Occupied Locations ({occupiedLocations.length})</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {occupiedLocations.map(({ location, participants: locParts }) => (
                                    <div key={location.id} style={{
                                        padding: '8px 10px',
                                        background: 'var(--social-bg)',
                                        border: '1px solid var(--border)',
                                        borderRadius: '6px',
                                    }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '6px' }}>
                                            📍 {location.name}
                                        </div>
                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                            {locParts.map(pp => (
                                                <div key={`${pp.name}-${pp.index}`} style={{
                                                    display: 'flex', alignItems: 'center', gap: '4px',
                                                    padding: '3px 8px',
                                                    background: 'rgba(255,255,255,0.05)',
                                                    borderRadius: '4px',
                                                }}>
                                                    {pp.portraitUrl ? (
                                                        <img
                                                            src={pp.portraitUrl}
                                                            alt={pp.name}
                                                            style={{
                                                                width: '18px', height: '32px',
                                                                borderRadius: '2px', objectFit: 'cover',
                                                                aspectRatio: '9 / 16',
                                                            }}
                                                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                        />
                                                    ) : (
                                                        <div className="character-avatar placeholder" style={{ width: '18px', height: '32px', aspectRatio: '9 / 16' }} />
                                                    )}
                                                    <span style={{ fontSize: '0.65rem' }}>
                                                        {pp.name} ({pp.index + 1})
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Contexts */}
                    {hasContexts && (
                        <div className="editor-section">
                            <span className="editor-section-title">Contexts ({contexts.length})</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {contexts.map(c => (
                                    <span key={c.id} style={{
                                        fontSize: '0.65rem', padding: '2px 8px',
                                        background: 'var(--social-bg)', border: '1px solid var(--border)',
                                        borderRadius: '12px',
                                    }}>
                                        📜 {c.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Location Map */}
                    {hasLocations && (
                        <div className="editor-section">
                            <span className="editor-section-title">Location Map</span>
                            <div style={{ height: '400px', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                                <ReactFlow
                                    nodes={nodes}
                                    edges={edges}
                                    nodeTypes={nodeTypes}
                                    fitView
                                    fitViewOptions={{ padding: 0.25 }}
                                    colorMode="dark"
                                    nodesDraggable={false}
                                    nodesConnectable={false}
                                    elementsSelectable={false}
                                    panOnScroll={true}
                                    zoomOnDoubleClick={false}
                                    minZoom={0.3}
                                    maxZoom={3}
                                    proOptions={{ hideAttribution: true }}
                                    style={{ background: 'var(--social-bg)' }}
                                >
                                    <Background gap={20} size={1} color="rgba(255,255,255,0.04)" />
                                    <Controls showInteractive={false} />
                                </ReactFlow>
                            </div>
                        </div>
                    )}

                    {/* Audio Tracks */}
                    {hasAudioTracks && (
                        <div className="editor-section">
                            <span className="editor-section-title">Audio Tracks ({audioTracks.length})</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {audioTracks.map(t => (
                                    <div key={t.id} style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '6px 8px', background: 'var(--social-bg)',
                                        border: '1px solid var(--border)', borderRadius: '4px',
                                    }}>
                                        <span>{t.audioCategory === 'ambient' ? '🌿' : t.audioCategory === 'music' ? '🎵' : '💥'}</span>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{t.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}