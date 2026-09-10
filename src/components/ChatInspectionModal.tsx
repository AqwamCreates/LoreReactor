// src/components/ChatInspectionModal.tsx
import React, { useMemo, useEffect, useState, useRef } from 'react';
import type { InteractionData, Location } from '../types';
import {
    ReactFlow,
    Background,
    Controls,
    type Node,
    type Edge,
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './main.css';

interface ChatInspectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    inspectionStack: InteractionData[];
    onInspectingParentInteractionData: (parentId: string) => Promise<InteractionData>;
}

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

function getCurrentLocationForParticipant(
    participantId: string,
    data: InteractionData,
): Location | undefined {
    const history = data.interactionHistory;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.character.id === participantId && msg.locationIndex !== undefined && data.locations) {
            return data.locations[msg.locationIndex];
        }
    }
    return undefined;
}

function getLastMessageLocation(data: InteractionData): Location | undefined {
    const history = data.interactionHistory;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].locationIndex !== undefined && data.locations) {
            return data.locations[history[i].locationIndex!];
        }
    }
    return undefined;
}

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

        const currentLoc = getLastMessageLocation(chat);
        const participants = chat.participants || [];

        const locParticipants = new Map<string, { name: string; index: number }[]>();
        for (const loc of chat.locations) {
            locParticipants.set(loc.id, []);
        }
        for (let i = 0; i < participants.length; i++) {
            const pLoc = getCurrentLocationForParticipant(participants[i].id, chat);
            if (pLoc && locParticipants.has(pLoc.id)) {
                locParticipants.get(pLoc.id)!.push({ name: participants[i].name, index: i });
            }
        }

        const graphNodes: Node[] = chat.locations.map((loc, idx) => {
            const isCurrent = currentLoc?.id === loc.id;
            const parts = locParticipants.get(loc.id) || [];
            const hasParticipants = parts.length > 0;

            const cols = Math.ceil(Math.sqrt(chat.locations!.length));
            const row = Math.floor(idx / cols);
            const col = idx % cols;

            return {
                id: loc.id,
                position: { x: col * 200 + 50, y: row * 180 + 50 },
                data: {
                    label: (
                        <div style={{ textAlign: 'center', opacity: hasParticipants ? 1 : 0.5 }}>
                            <div style={{
                                fontWeight: 'bold', fontSize: '0.75rem',
                                color: isCurrent ? 'var(--accent)' : 'var(--text-h)',
                            }}>
                                {isCurrent ? '📍 ' : ''}{loc.name}
                            </div>
                            {parts.length > 0 && (
                                <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                    {parts.map(pp => (
                                        <span key={`${pp.name}-${pp.index}`} style={{
                                            fontSize: '0.6rem', padding: '1px 4px',
                                            background: 'rgba(255,255,255,0.08)', borderRadius: '3px',
                                        }}>
                                            {pp.name} (Character {pp.index})
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ),
                },
                style: {
                    border: isCurrent ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: isCurrent ? 'var(--accent-dim, rgba(255,255,255,0.1))' : 'var(--social-bg)',
                    borderRadius: '8px', padding: '8px', minWidth: '140px',
                },
            };
        });

        const graphEdges: Edge[] = [];
        let edgeIdx = 0;
        for (const loc of chat.locations) {
            if (loc.locationBindings) {
                for (const boundId of loc.locationBindings) {
                    if (chat.locations.some(l => l.id === boundId)) {
                        graphEdges.push({
                            id: `e-${edgeIdx++}`,
                            source: loc.id,
                            target: boundId,
                            animated: false,
                            markerEnd: { type: MarkerType.ArrowClosed },
                            style: { stroke: 'var(--border)', strokeWidth: 1 },
                        });
                    }
                }
            }
        }

        return { nodes: graphNodes, edges: graphEdges };
    }, [chat]);

    if (!isOpen || !chat) return null;

    const protagonist = chat.protagonist;
    const participants = chat.participants || [];
    const locations = chat.locations || [];
    const audioTracks = chat.audioTracks || [];
    const contexts = chat.contexts || [];
    const hasLocations = locations.length > 0;
    const hasContexts = contexts.length > 0;
    const hasAudioTracks = audioTracks.length > 0;

    const parentName = canGoBack ? internalStack[1]?.name : undefined;

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
                                className="editor-btn editor-btn-cancel"
                                onClick={handleBack}
                                style={{ fontSize: '0.7rem', padding: '4px 8px', minHeight: '28px' }}
                            >
                                ← Back
                            </button>
                        )}
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Close</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body" style={{ overflowY: 'auto' }}>
                    {protagonist && (
                        <div className="editor-section">
                            <span className="editor-section-title">Protagonist</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px' }}>
                                <div className="character-avatar placeholder" style={{ width: '48px', height: '48px', flexShrink: 0 }} />
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{protagonist.name}</div>
                                    <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>Protagonist</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {participants.length > 0 && (
                        <div className="editor-section">
                            <span className="editor-section-title">Participants ({participants.length})</span>
                            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', padding: '4px 0' }}>
                                {participants.map((p, i) => {
                                    const isProtag = p.id === protagonist?.id;
                                    const pLoc = hasLocations ? getCurrentLocationForParticipant(p.id, chat) : undefined;
                                    return (
                                        <div key={p.id} style={{
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                                            padding: '8px', minWidth: '80px', maxWidth: '100px',
                                            background: isProtag ? 'var(--accent-dim, rgba(255,255,255,0.08))' : 'var(--social-bg)',
                                            border: isProtag ? '1px solid var(--accent)' : '1px solid var(--border)',
                                            borderRadius: '6px', flexShrink: 0,
                                        }}>
                                            <div className="character-avatar placeholder" style={{ width: '36px', height: '36px' }} />
                                            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', textAlign: 'center', lineHeight: 1.2 }}>
                                                {p.name}
                                            </div>
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, textAlign: 'center' }}>
                                                (Character {i})
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

                    {hasLocations && (
                        <div className="editor-section">
                            <span className="editor-section-title">Location Map</span>
                            <div style={{ height: '350px', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                                <ReactFlow
                                    nodes={nodes}
                                    edges={edges}
                                    fitView
                                    proOptions={{ hideAttribution: true }}
                                    style={{ background: 'var(--social-bg)' }}
                                >
                                    <Background />
                                    <Controls showInteractive={false} />
                                </ReactFlow>
                            </div>
                        </div>
                    )}

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

                    <div className="editor-section" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
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
                                    🌿 Alternate Timeline From {parentName || 'Parent Chat'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}