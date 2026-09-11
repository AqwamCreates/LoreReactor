// src/components/AlternateTimelinesModal.tsx
import { useMemo, useState } from 'react';
import type { InteractionData } from '../types';
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
import * as dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import './main.css';

interface AlternateTimelinesModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentInteractionId: string;
    allInteractions: InteractionData[];
    onSwitchChat: (id: string) => void;
    onDeleteChat: (id: string) => void;
    onInspectChat: (id: string) => void;
    onRenameChat: (id: string, name: string) => void;
}

// ─── Dagre Layout ────────────────────────────────────────────────────

const NODE_WIDTH = 220;
const NODE_HEIGHT = 140;

type BranchNodeData = Record<string, unknown> & {
    label: string;
    messageCount: number;
    lastActive: string;
    childCount: number;
    participantCount: number;
    contextCount: number;
    locationCount: number;
    audioTrackCount: number;
    hasProfile: boolean;
    isCurrent: boolean;
    isAncestor: boolean;
    hasChildren: boolean;
    onOpen: () => void;
    onInspect: () => void;
    onDelete: () => void;
    canDelete: boolean;
    deleteTooltip: string;
    onStartRename: () => void;
    isRenaming: boolean;
    renameValue: string;
    onRenameChange: (val: string) => void;
    onRenameSubmit: () => void;
    onRenameCancel: () => void;
};

type BranchFlowNode = Node<BranchNodeData, 'branchNode'>;

function getLayoutedElements(nodes: BranchFlowNode[], edges: Edge[]): { nodes: BranchFlowNode[]; edges: Edge[] } {
    const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

    for (const node of nodes) {
        g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    for (const edge of edges) {
        g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    const layoutedNodes: BranchFlowNode[] = nodes.map(node => {
        const pos = g.node(node.id);
        return {
            ...node,
            targetPosition: Position.Top,
            sourcePosition: Position.Bottom,
            position: {
                x: pos.x - NODE_WIDTH / 2,
                y: pos.y - NODE_HEIGHT / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
}

// ─── Custom Branch Node ──────────────────────────────────────────────

function BranchNode({ data }: NodeProps<BranchFlowNode>) {
    const borderColor = data.isCurrent ? '#4ade80' : data.isAncestor ? '#60a5fa' : '#f59e0b';
    const bgColor = data.isCurrent ? 'rgba(74, 222, 128, 0.12)' : data.isAncestor ? 'rgba(96, 165, 250, 0.08)' : 'rgba(245, 158, 11, 0.06)';
    const textColor = data.isCurrent ? '#4ade80' : data.isAncestor ? '#93c5fd' : '#fbbf24';

    return (
        <div
            style={{
                border: `2px solid ${borderColor}`,
                background: bgColor,
                borderRadius: '10px',
                padding: '10px 12px',
                width: `${NODE_WIDTH}px`,
                minHeight: `${NODE_HEIGHT}px`,
                boxShadow: data.isCurrent ? `0 0 14px ${borderColor}` : undefined,
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                pointerEvents: 'auto',
            }}
        >
            <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
            <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />

            {/* Title row with pencil edit button */}
            {data.isRenaming ? (
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                        type="text"
                        value={data.renameValue}
                        onChange={e => data.onRenameChange(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') data.onRenameSubmit();
                            if (e.key === 'Escape') data.onRenameCancel();
                        }}
                        autoFocus
                        style={{
                            flex: 1,
                            background: 'var(--social-bg)',
                            border: '1px solid var(--accent)',
                            color: 'var(--text-h)',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            outline: 'none',
                            minWidth: 0,
                        }}
                    />
                    <button
                        onClick={e => { e.stopPropagation(); data.onRenameSubmit(); }}
                        style={{
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            background: 'none',
                            border: 'none',
                            color: '#4ade80',
                            padding: '2px 4px',
                            position: 'relative',
                            zIndex: 10,
                        }}
                    >
                        ✓
                    </button>
                    <button
                        onClick={e => { e.stopPropagation(); data.onRenameCancel(); }}
                        style={{
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            padding: '2px 4px',
                            position: 'relative',
                            zIndex: 10,
                        }}
                    >
                        ✕
                    </button>
                </div>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                    <div
                        style={{
                            fontWeight: 'bold',
                            fontSize: '0.75rem',
                            color: textColor,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            minWidth: 0,
                        }}
                        title={data.label}
                    >
                        {data.isCurrent ? '● ' : ''}
                        {data.label}
                    </div>
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            data.onStartRename();
                        }}
                        style={{
                            fontSize: '0.65rem',
                            cursor: 'pointer',
                            background: 'none',
                            border: 'none',
                            color: textColor,
                            opacity: 0.6,
                            padding: '2px 4px',
                            flexShrink: 0,
                            position: 'relative',
                            zIndex: 10,
                        }}
                        title="Rename"
                    >
                        ✏️
                    </button>
                </div>
            )}

            {/* Stats row */}
            <div style={{ fontSize: '0.6rem', opacity: 0.7, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span>💬 {data.messageCount}</span>
                <span>🕐 {data.lastActive}</span>
                {data.childCount > 0 && <span>🌿 {data.childCount}</span>}
            </div>

            {/* Entity counts row */}
            <div style={{ fontSize: '0.55rem', opacity: 0.6, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span>🎭 {data.participantCount}</span>
                <span>📜 {data.contextCount}</span>
                <span>📍 {data.locationCount}</span>
                <span>🔊 {data.audioTrackCount}</span>
                {data.hasProfile && <span>👤</span>}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '4px', marginTop: 'auto', position: 'relative', zIndex: 10 }}>
                <button
                    onClick={e => {
                        e.stopPropagation();
                        data.onInspect();
                    }}
                    style={{
                        flex: 1,
                        fontSize: '0.7rem',
                        padding: '6px 0',
                        cursor: 'pointer',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        color: 'var(--text-h)',
                    }}
                    title="Inspect"
                >
                    👁️
                </button>

                <button
                    onClick={e => {
                        e.stopPropagation();
                        data.onOpen();
                    }}
                    style={{
                        flex: 1,
                        fontSize: '0.7rem',
                        padding: '6px 0',
                        cursor: 'pointer',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        color: 'var(--text-h)',
                    }}
                    title="Open"
                >
                    📂
                </button>

                <button
                    onClick={e => {
                        e.stopPropagation();
                        if (data.canDelete) data.onDelete();
                    }}
                    disabled={!data.canDelete}
                    style={{
                        flex: 1,
                        fontSize: '0.7rem',
                        padding: '6px 0',
                        cursor: data.canDelete ? 'pointer' : 'not-allowed',
                        background: data.canDelete ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${data.canDelete ? 'rgba(239, 68, 68, 0.3)' : 'var(--border)'}`,
                        borderRadius: '4px',
                        color: data.canDelete ? '#ef4444' : 'rgba(255,255,255,0.2)',
                        opacity: data.canDelete ? 1 : 0.5,
                    }}
                    title={data.deleteTooltip}
                >
                    🗑️
                </button>
            </div>
        </div>
    );
}

const nodeTypes = {
    branchNode: BranchNode,
};

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

function getAncestorIds(interactions: InteractionData[], startId: string): Set<string> {
    const ancestors = new Set<string>();
    const map = new Map(interactions.map(i => [i.id, i]));

    let current = map.get(startId);
    while (current?.parentInteractionDataId) {
        ancestors.add(current.parentInteractionDataId);
        current = map.get(current.parentInteractionDataId);
    }

    return ancestors;
}

function getDescendantIds(childMap: Map<string, string[]>, startId: string): Set<string> {
    const descendants = new Set<string>();
    const queue = [startId];

    while (queue.length > 0) {
        const id = queue.shift()!;
        const children = childMap.get(id) || [];

        for (const childId of children) {
            descendants.add(childId);
            queue.push(childId);
        }
    }

    return descendants;
}

// ─── Component ───────────────────────────────────────────────────────

export function AlternateTimelinesModal({
    isOpen,
    onClose,
    currentInteractionId,
    allInteractions,
    onSwitchChat,
    onDeleteChat,
    onInspectChat,
    onRenameChat,
}: AlternateTimelinesModalProps) {
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const { childMap, ancestorIds, relevantInteractions } = useMemo(() => {
        const interactionMap = new Map(allInteractions.map(i => [i.id, i]));

        let rootId = currentInteractionId;
        let current = interactionMap.get(currentInteractionId);

        while (current?.parentInteractionDataId && interactionMap.has(current.parentInteractionDataId)) {
            rootId = current.parentInteractionDataId;
            current = interactionMap.get(rootId);
        }

        const fullChildMap = new Map<string, string[]>();

        for (const interaction of allInteractions) {
            if (!fullChildMap.has(interaction.id)) {
                fullChildMap.set(interaction.id, []);
            }

            if (interaction.parentInteractionDataId) {
                if (!fullChildMap.has(interaction.parentInteractionDataId)) {
                    fullChildMap.set(interaction.parentInteractionDataId, []);
                }
                fullChildMap.get(interaction.parentInteractionDataId)!.push(interaction.id);
            }
        }

        const treeIds = new Set<string>();
        const queue = [rootId];

        while (queue.length > 0) {
            const id = queue.shift()!;
            if (treeIds.has(id)) continue;

            treeIds.add(id);

            const children = fullChildMap.get(id) || [];
            for (const childId of children) {
                queue.push(childId);
            }
        }

        const filteredChildMap = new Map<string, string[]>();

        for (const id of treeIds) {
            const children = (fullChildMap.get(id) || []).filter(childId => treeIds.has(childId));
            filteredChildMap.set(id, children);
        }

        const ancestors = getAncestorIds(allInteractions, currentInteractionId);
        const relevant = allInteractions.filter(i => treeIds.has(i.id));

        return {
            childMap: filteredChildMap,
            ancestorIds: ancestors,
            relevantInteractions: relevant,
        };
    }, [allInteractions, currentInteractionId]);

    const { nodes, edges } = useMemo(() => {
        if (relevantInteractions.length === 0) {
            return { nodes: [] as BranchFlowNode[], edges: [] as Edge[] };
        }

        const rawNodes: BranchFlowNode[] = relevantInteractions.map(interaction => {
            const isCurrent = interaction.id === currentInteractionId;
            const isAncestor = ancestorIds.has(interaction.id);
            const children = childMap.get(interaction.id) || [];
            const hasChildren = children.length > 0;
            const descendants = getDescendantIds(childMap, interaction.id);

            // Can delete any leaf node (no children), regardless of whether it's the active chat
            const canDelete = !hasChildren;

            const deleteTooltip = hasChildren
                ? `Cannot delete: has ${descendants.size} dependent branch${descendants.size !== 1 ? 'es' : ''}`
                : confirmDeleteId === interaction.id
                    ? 'Tap again to confirm'
                    : 'Delete this branch';

            return {
                id: interaction.id,
                type: 'branchNode',
                position: { x: 0, y: 0 },
                data: {
                    label: interaction.name || 'Untitled',
                    messageCount: interaction.numberOfMessages ?? interaction.interactionHistory?.length ?? 0,
                    lastActive: getRelativeTime(interaction.lastUpdatedTimestamp),
                    childCount: children.length,
                    participantCount: interaction.participants?.length ?? 0,
                    contextCount: interaction.contexts?.length ?? 0,
                    locationCount: interaction.locations?.length ?? 0,
                    audioTrackCount: interaction.audioTracks?.length ?? 0,
                    hasProfile: !!interaction.Profile,
                    isCurrent,
                    isAncestor,
                    hasChildren,
                    onOpen: () => {
                        onSwitchChat(interaction.id);
                        onClose();
                    },
                    onInspect: () => {
                        onInspectChat(interaction.id);
                    },
                    onDelete: () => {
                        if (!canDelete) return;

                        if (confirmDeleteId === interaction.id) {
                            onDeleteChat(interaction.id);
                            setConfirmDeleteId(null);
                        } else {
                            setConfirmDeleteId(interaction.id);
                            window.setTimeout(() => setConfirmDeleteId(null), 3000);
                        }
                    },
                    canDelete,
                    deleteTooltip,
                    onStartRename: () => {
                        setRenamingId(interaction.id);
                        setRenameValue(interaction.name || '');
                    },
                    isRenaming: renamingId === interaction.id,
                    renameValue: renamingId === interaction.id ? renameValue : '',
                    onRenameChange: setRenameValue,
                    onRenameSubmit: () => {
                        if (renamingId && renameValue.trim()) {
                            onRenameChat(renamingId, renameValue.trim());
                            setRenamingId(null);
                            setRenameValue('');
                        }
                    },
                    onRenameCancel: () => {
                        setRenamingId(null);
                        setRenameValue('');
                    },
                },
            };
        });

        const rawEdges: Edge[] = [];

        for (const [parentId, childIds] of childMap.entries()) {
            for (const childId of childIds) {
                const isActiveEdge = parentId === currentInteractionId || childId === currentInteractionId;

                rawEdges.push({
                    id: `e-${parentId}-${childId}`,
                    source: parentId,
                    target: childId,
                    type: 'smoothstep',
                    animated: isActiveEdge,
                    style: {
                        stroke: isActiveEdge ? '#4ade80' : 'rgba(255,255,255,0.15)',
                        strokeWidth: isActiveEdge ? 2 : 1,
                        opacity: isActiveEdge ? 0.9 : 0.4,
                    },
                });
            }
        }

        return getLayoutedElements(rawNodes, rawEdges);
    }, [
        relevantInteractions,
        currentInteractionId,
        ancestorIds,
        childMap,
        confirmDeleteId,
        renamingId,
        renameValue,
        onSwitchChat,
        onClose,
        onInspectChat,
        onDeleteChat,
        onRenameChat,
    ]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content editor-modal-content"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '900px', maxHeight: '90vh' }}
            >
                <div className="modal-header">
                    <h2>Interaction Branching</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>
                            Close
                        </button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body" style={{ overflowY: 'auto' }}>
                    <div style={{ marginBottom: '8px', display: 'flex', gap: '12px', fontSize: '0.65rem', opacity: 0.7, flexWrap: 'wrap' }}>
                        <span><span style={{ color: '#4ade80' }}>●</span> Current</span>
                        <span><span style={{ color: '#60a5fa' }}>●</span> Ancestor</span>
                        <span><span style={{ color: '#f59e0b' }}>●</span> Sibling Branch</span>
                        <span>✏️ to rename</span>
                        <span>Tap 🗑️ twice to delete</span>
                    </div>

                    <div style={{ height: '500px', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            nodeTypes={nodeTypes}
                            fitView
                            fitViewOptions={{ padding: 0.2 }}
                            colorMode="dark"
                            nodesDraggable={false}
                            nodesConnectable={false}
                            elementsSelectable={false}
                            panOnScroll={true}
                            zoomOnDoubleClick={false}
                            minZoom={0.2}
                            maxZoom={3}
                            proOptions={{ hideAttribution: true }}
                            style={{ background: 'var(--social-bg)' }}
                        >
                            <Background gap={20} size={1} color="rgba(255,255,255,0.04)" />
                            <Controls showInteractive={false} />
                        </ReactFlow>
                    </div>

                    {relevantInteractions.length === 0 && (
                        <div style={{ textAlign: 'center', opacity: 0.5, padding: '40px 0' }}>
                            No branching data found for this interaction.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}