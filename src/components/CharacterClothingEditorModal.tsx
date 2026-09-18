// src/components/CharacterClothingEditorModal.tsx
import type React from 'react';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { Clothing, RegularExpressionTrigger } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { RegularExpressionTriggerEditor } from './RegularExpressionTriggerEditor';
import {
    ReactFlow,
    Background,
    Controls,
    Handle,
    Position,
    addEdge,
    useNodesState,
    useEdgesState,
    type Node,
    type Edge,
    type NodeProps,
    type Connection,
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../main.css';

interface CharacterClothingEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    clothings: Clothing[];
    onSaveClothings: (clothings: Clothing[]) => void;
}

// ─── Custom Clothing Node ────────────────────────────────────────────

interface ClothingNodeData extends Record<string, unknown> {
    name: string;
    description: string;
    initialWearingProbability: number;
    hasActivationTriggers: boolean;
    hasDeactivationTriggers: boolean;
    bindingCount: number;
}

function ClothingNode({ data }: NodeProps<Node<ClothingNodeData>>) {
    const { name, description, initialWearingProbability, hasActivationTriggers, hasDeactivationTriggers, bindingCount } = data;

    const canBePutOn = hasActivationTriggers;
    const alwaysWornAtStart = initialWearingProbability >= 1;
    const neverWornAtStart = initialWearingProbability <= 0;

    let borderColor: string;
    let bgColor: string;
    let textColor: string;
    let glowColor: string;

    if (alwaysWornAtStart) {
        borderColor = '#4ade80';
        bgColor = 'rgba(74, 222, 128, 0.12)';
        textColor = '#4ade80';
        glowColor = 'rgba(74, 222, 128, 0.25)';
    } else if (canBePutOn) {
        borderColor = '#60a5fa';
        bgColor = 'rgba(96, 165, 250, 0.1)';
        textColor = '#93c5fd';
        glowColor = 'rgba(96, 165, 250, 0.2)';
    } else if (neverWornAtStart) {
        borderColor = 'rgba(255, 255, 255, 0.1)';
        bgColor = 'rgba(255, 255, 255, 0.02)';
        textColor = 'rgba(255, 255, 255, 0.35)';
        glowColor = 'none';
    } else {
        // Partial probability, no triggers — wardrobe only with chance
        borderColor = 'rgba(168, 85, 247, 0.5)';
        bgColor = 'rgba(168, 85, 247, 0.08)';
        textColor = '#c084fc';
        glowColor = 'rgba(168, 85, 247, 0.15)';
    }

    return (
        <div style={{
            border: `2px solid ${borderColor}`,
            background: bgColor,
            borderRadius: '8px',
            padding: '8px 12px',
            minWidth: '140px',
            maxWidth: '200px',
            boxShadow: glowColor !== 'none' ? `0 0 8px ${glowColor}` : undefined,
            transition: 'all 0.2s ease',
        }}>
            <Handle type="target" position={Position.Top} style={{
                background: '#f59e0b', width: '10px', height: '10px', border: '2px solid var(--social-bg, #1a1a2e)',
            }} />
            <Handle type="source" position={Position.Bottom} style={{
                background: '#f59e0b', width: '10px', height: '10px', border: '2px solid var(--social-bg, #1a1a2e)',
            }} />

            <div style={{ fontWeight: 'bold', fontSize: '0.75rem', color: textColor, marginBottom: '4px', lineHeight: 1.3 }}>
                {name || '(Unnamed)'}
            </div>

            {description && (
                <div style={{ fontSize: '0.55rem', opacity: 0.6, color: 'var(--text-h, #fff)', lineHeight: 1.3, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {description}
                </div>
            )}

            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {alwaysWornAtStart && !canBePutOn && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(74, 222, 128, 0.2)', borderRadius: '3px', color: '#4ade80' }}>
                        Always Worn
                    </span>
                )}
                {!alwaysWornAtStart && !neverWornAtStart && !canBePutOn && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(168, 85, 247, 0.2)', borderRadius: '3px', color: '#c084fc' }}>
                        {Math.round(initialWearingProbability * 100)}% Start Chance
                    </span>
                )}
                {neverWornAtStart && !canBePutOn && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', color: 'rgba(255,255,255,0.4)' }}>
                        Wardrobe Only
                    </span>
                )}
                {canBePutOn && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(96, 165, 250, 0.2)', borderRadius: '3px', color: '#93c5fd' }}>
                        Can Put On ({Math.round(initialWearingProbability * 100)}%)
                    </span>
                )}
                {hasDeactivationTriggers && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(245, 158, 11, 0.2)', borderRadius: '3px', color: '#fbbf24' }}>
                        Removable
                    </span>
                )}
                {bindingCount > 0 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: '3px', color: '#fbbf24' }}>
                        Covers {bindingCount}
                    </span>
                )}
            </div>
        </div>
    );
}

const nodeTypes = { clothingNode: ClothingNode };

// ─── Component ───────────────────────────────────────────────────────

export function CharacterClothingEditorModal({
    isOpen,
    onClose,
    clothings,
    onSaveClothings,
}: CharacterClothingEditorModalProps) {
    const [items, setItems] = useState<Clothing[]>(() => clothings.length > 0 ? [...clothings] : []);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const reactFlowWrapper = useRef<HTMLDivElement>(null);

    const buildNodeData = (item: Clothing): ClothingNodeData => ({
        name: item.name,
        description: item.description || '',
        initialWearingProbability: item.initialWearingProbability ?? 1,
        hasActivationTriggers: (item.regularExpressionActivationTriggers?.length ?? 0) > 0,
        hasDeactivationTriggers: (item.regularExpressionDeactivationTriggers?.length ?? 0) > 0,
        bindingCount: item.clothingBindings.length,
    });

    const initialNodes = useMemo(() => {
        const cols = Math.ceil(Math.sqrt(items.length));
        return items.map((item, idx) => ({
            id: item.id,
            type: 'clothingNode' as const,
            position: { x: (idx % cols) * 220 + 50, y: Math.floor(idx / cols) * 180 + 50 },
            data: buildNodeData(item),
        }));
    }, []);

    const initialEdges = useMemo(() => {
        const edges: Edge[] = [];
        let edgeIdx = 0;
        for (const item of items) {
            for (const boundId of item.clothingBindings) {
                if (items.some(i => i.id === boundId)) {
                    edges.push({
                        id: `e-${edgeIdx++}`,
                        source: item.id,
                        target: boundId,
                        type: 'smoothstep',
                        animated: true,
                        markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
                        style: { stroke: '#f59e0b', strokeWidth: 2, opacity: 0.7 },
                    });
                }
            }
        }
        return edges;
    }, []);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    useEffect(() => {
        setNodes(prev => prev.map(node => {
            const item = items.find(i => i.id === node.id);
            if (!item) return node;
            return { ...node, data: buildNodeData(item) };
        }));
    }, [items, setNodes]);

    const onConnect = useCallback((connection: Connection) => {
        if (!connection.source || !connection.target) return;
        setItems(prev => prev.map(item => {
            if (item.id !== connection.source) return item;
            if (item.clothingBindings.includes(connection.target!)) return item;
            return { ...item, clothingBindings: [...item.clothingBindings, connection.target!], lastUpdatedTimestamp: Date.now() };
        }));
        setEdges(prev => addEdge({
            ...connection,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
            style: { stroke: '#f59e0b', strokeWidth: 2, opacity: 0.7 },
        }, prev));
    }, [setItems, setEdges]);

    const onEdgeRemove = useCallback((edge: Edge) => {
        setItems(prev => prev.map(item => {
            if (item.id !== edge.source) return item;
            return { ...item, clothingBindings: item.clothingBindings.filter(b => b !== edge.target), lastUpdatedTimestamp: Date.now() };
        }));
    }, [setItems]);

    const handleAdd = useCallback(() => {
        const now = Date.now();
        const newItem: Clothing = {
            id: uuidv4(),
            name: '',
            description: '',
            initialWearingProbability: 1,
            clothingBindings: [],
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };
        setItems(prev => [...prev, newItem]);
        setSelectedId(newItem.id);

        const idx = items.length;
        const cols = Math.ceil(Math.sqrt(idx + 1));
        setNodes(prev => [...prev, {
            id: newItem.id,
            type: 'clothingNode',
            position: { x: (idx % cols) * 220 + 50, y: Math.floor(idx / cols) * 180 + 50 },
            data: buildNodeData(newItem),
        }]);
    }, [items.length, setNodes]);

    const handleRemove = useCallback((id: string) => {
        setItems(prev => prev.filter(item => item.id !== id));
        setNodes(prev => prev.filter(n => n.id !== id));
        setEdges(prev => prev.filter(e => e.source !== id && e.target !== id));
        if (selectedId === id) setSelectedId(null);
    }, [selectedId, setNodes, setEdges]);

    const updateField = useCallback(<K extends keyof Clothing>(id: string, field: K, value: Clothing[K]) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value, lastUpdatedTimestamp: Date.now() } : item
        ));
    }, []);

    const handleSave = useCallback(() => {
        const validItems = items.filter(item => item.name.trim().length > 0);
        onSaveClothings(validItems);
        onClose();
    }, [items, onSaveClothings, onClose]);

    if (!isOpen) return null;

    const selectedItem = items.find(i => i.id === selectedId) ?? null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '1000px', maxHeight: '90vh' }}>
                <div className="modal-header">
                    <h2>Clothing</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        <button type="button" className="editor-button editor-button-save" onClick={handleSave}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body" style={{ display: 'flex', gap: '12px', minHeight: '500px' }}>
                    {/* LEFT: Graph */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                        <div style={{ fontSize: '0.6rem', opacity: 0.6 }}>
                            Drag between nodes to create "covers" connections. Click a node to edit. Green = always worn. Blue = can be put on. Purple = start chance only. Grey = wardrobe only. Orange arrows = covers.
                        </div>
                        <div ref={reactFlowWrapper} style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', minHeight: '400px' }}>
                            <ReactFlow
                                nodes={nodes}
                                edges={edges}
                                onNodesChange={onNodesChange}
                                onEdgesChange={onEdgesChange}
                                onConnect={onConnect}
                                onNodeClick={(_, node) => setSelectedId(node.id)}
                                onEdgeContextMenu={(e, edge) => { e.preventDefault(); onEdgeRemove(edge); }}
                                nodeTypes={nodeTypes}
                                fitView
                                fitViewOptions={{ padding: 0.2 }}
                                colorMode="dark"
                                nodesDraggable={true}
                                nodesConnectable={true}
                                elementsSelectable={true}
                                panOnScroll={true}
                                minZoom={0.3}
                                maxZoom={3}
                                proOptions={{ hideAttribution: true }}
                                style={{ background: 'var(--social-bg)' }}
                            >
                                <Background gap={20} size={1} color="rgba(255,255,255,0.04)" />
                                <Controls showInteractive={false} />
                            </ReactFlow>
                        </div>
                        <button type="button" className="editor-button editor-button-import" onClick={handleAdd} style={{ width: '100%' }}>
                            + Add Clothing
                        </button>
                    </div>

                    {/* RIGHT: Editor Panel */}
                    <div style={{ width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', borderLeft: '1px solid var(--border)', paddingLeft: '12px' }}>
                        {!selectedItem ? (
                            <div style={{ textAlign: 'center', padding: '40px 0', opacity: 0.5, fontStyle: 'italic', fontSize: '0.75rem' }}>
                                Select a clothing node to edit, or add a new one.
                            </div>
                        ) : (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Edit Clothing</span>
                                    <button
                                        type="button"
                                        onClick={() => handleRemove(selectedItem.id)}
                                        className="toolbar-button"
                                        title="Remove"
                                        style={{ width: '24px', height: '24px', fontSize: '0.8rem', color: '#ff4444' }}
                                    >×</button>
                                </div>

                                <div>
                                    <label className="editor-label editor-label-small">Name</label>
                                    <input
                                        type="text"
                                        value={selectedItem.name}
                                        onChange={(e) => updateField(selectedItem.id, 'name', e.target.value)}
                                        className="editor-input"
                                        placeholder="e.g., Black Trench Coat"
                                    />
                                </div>

                                <div>
                                    <label className="editor-label editor-label-small">Description</label>
                                    <textarea
                                        value={selectedItem.description || ''}
                                        onChange={(e) => updateField(selectedItem.id, 'description', e.target.value || undefined)}
                                        className="editor-textarea"
                                        placeholder="Visual description shown in appearance prompt when worn"
                                        rows={3}
                                    />
                                </div>

                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                    <label className="editor-label editor-label-small">Initial Wearing Probability</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.05"
                                            value={selectedItem.initialWearingProbability ?? 1}
                                            onChange={(e) => updateField(selectedItem.id, 'initialWearingProbability', Number(e.target.value))}
                                            style={{ flex: 1 }}
                                        />
                                        <span style={{ fontSize: '0.7rem', minWidth: '40px', textAlign: 'right' }}>
                                            {Math.round((selectedItem.initialWearingProbability ?? 1) * 100)}%
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                        Likelihood of being worn when this character joins a session. 100% = always worn at start. 0% = never worn at start.
                                    </div>
                                </div>

                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                    <RegularExpressionTriggerEditor
                                        label="Wearing Activation"
                                        description="Character puts this on during conversation when any trigger matches. Without triggers, initial wearing probability is the only way this gets worn."
                                        triggers={selectedItem.regularExpressionActivationTriggers ?? []}
                                        onChange={(triggers) => updateField(selectedItem.id, 'regularExpressionActivationTriggers', triggers.length > 0 ? triggers : undefined)}
                                    />
                                </div>

                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                    <RegularExpressionTriggerEditor
                                        label="Wearing Deactivation"
                                        description="Character takes this off during conversation when any trigger matches. Without triggers, initial wearing probability is the only way this gets off."
                                        triggers={selectedItem.regularExpressionDeactivationTriggers ?? []}
                                        onChange={(triggers) => updateField(selectedItem.id, 'regularExpressionDeactivationTriggers', triggers.length > 0 ? triggers : undefined)}
                                    />
                                </div>

                                {selectedItem.clothingBindings.length > 0 && (
                                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                        <label className="editor-label editor-label-small">Covers ({selectedItem.clothingBindings.length})</label>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                            {selectedItem.clothingBindings.map(boundId => {
                                                const boundItem = items.find(i => i.id === boundId);
                                                return (
                                                    <span key={boundId} style={{
                                                        fontSize: '0.6rem', padding: '2px 6px',
                                                        background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)',
                                                        borderRadius: '4px', color: '#fbbf24',
                                                    }}>
                                                        {boundItem?.name || '(Unknown)'}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                        <div style={{ fontSize: '0.5rem', opacity: 0.4, marginTop: '4px' }}>
                                            Right-click an orange arrow in the graph to remove a connection.
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}