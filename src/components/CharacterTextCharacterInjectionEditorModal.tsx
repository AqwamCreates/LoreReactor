// src/components/CharacterTextCharacterInjectionEditorModal.tsx
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { TextCharacterInjection } from '../types';
import { v4 as uuidv4 } from 'uuid';
import {
    ReactFlow,
    Background,
    Controls,
    Handle,
    Position,
    ConnectionMode,
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
import { TEXT_CHARACTER_INJECTION_PRESETS, createInjectionFromPreset } from '../dictionaries/textCharacterInjectionPresets';

interface CharacterTextCharacterInjectionEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    injections: TextCharacterInjection[];
    onSaveInjections: (injections: TextCharacterInjection[]) => void;
}

// ─── Custom Injection Node ──────────────────────────────────────────

interface InjectionNodeData extends Record<string, unknown> {
    name: string;
    characterCount: number;
    hasWeights: boolean;
    bindingCount: number;
    injectionWeight: number;
    breakProbability: number;
    skipProbability: number;
}

const HANDLE_STYLE: React.CSSProperties = {
    background: '#f59e0b',
    width: '10px',
    height: '10px',
    border: '2px solid var(--social-bg, #1a1a2e)',
};

function InjectionNode({ data }: NodeProps<Node<InjectionNodeData>>) {
    const { name, characterCount, hasWeights, bindingCount, injectionWeight, breakProbability, skipProbability } = data;

    const borderColor = characterCount > 0 ? '#60a5fa' : 'rgba(255, 255, 255, 0.1)';
    const bgColor = characterCount > 0 ? 'rgba(96, 165, 250, 0.1)' : 'rgba(255, 255, 255, 0.02)';
    const textColor = characterCount > 0 ? '#93c5fd' : 'rgba(255, 255, 255, 0.35)';
    const glowColor = characterCount > 0 ? 'rgba(96, 165, 250, 0.2)' : 'none';

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
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            overflow: 'visible',
        }}>
            <Handle type="source" position={Position.Top} id="top" style={HANDLE_STYLE} />
            <Handle type="source" position={Position.Right} id="right" style={HANDLE_STYLE} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE_STYLE} />
            <Handle type="source" position={Position.Left} id="left" style={HANDLE_STYLE} />

            <div style={{ fontWeight: 'bold', fontSize: '0.75rem', color: textColor, marginBottom: '4px', lineHeight: 1.3 }}>
                {name || '(Unnamed)'}
            </div>

            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {characterCount > 0 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(96, 165, 250, 0.2)', borderRadius: '3px', color: '#93c5fd' }}>
                        {characterCount} char{characterCount !== 1 ? 's' : ''}
                    </span>
                )}
                {hasWeights && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(168, 85, 247, 0.2)', borderRadius: '3px', color: '#c084fc' }}>
                        Weighted
                    </span>
                )}
                {injectionWeight !== 1 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(34, 197, 94, 0.15)', borderRadius: '3px', color: '#22c55e' }}>
                        Wt {injectionWeight}
                    </span>
                )}
                {bindingCount > 0 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: '3px', color: '#fbbf24' }}>
                        Chains {bindingCount}
                    </span>
                )}
                {breakProbability > 0 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(239, 68, 68, 0.15)', borderRadius: '3px', color: '#ef4444' }}>
                        Break {Math.round(breakProbability * 100)}%
                    </span>
                )}
                {skipProbability > 0 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(251, 146, 60, 0.15)', borderRadius: '3px', color: '#fb923c' }}>
                        Skip {Math.round(skipProbability * 100)}%
                    </span>
                )}
                {characterCount === 0 && !hasWeights && bindingCount === 0 && breakProbability === 0 && skipProbability === 0 && injectionWeight === 1 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', color: 'rgba(255,255,255,0.4)' }}>
                        Empty
                    </span>
                )}
            </div>
        </div>
    );
}

const nodeTypes = { injectionNode: InjectionNode };

// ─── Component ───────────────────────────────────────────────────────

export function CharacterTextCharacterInjectionEditorModal({
    isOpen,
    onClose,
    injections,
    onSaveInjections,
}: CharacterTextCharacterInjectionEditorModalProps) {
    const [items, setItems] = useState<TextCharacterInjection[]>(() => injections.length > 0 ? [...injections] : []);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedPresetIndex, setSelectedPresetIndex] = useState<number>(-1);
    const reactFlowWrapper = useRef<HTMLDivElement>(null);

    const buildNodeData = (item: TextCharacterInjection): InjectionNodeData => ({
        name: item.name,
        characterCount: item.textCharacters?.length ?? 0,
        hasWeights: Object.keys(item.textCharacterWeights ?? {}).length > 0,
        bindingCount: item.textCharacterInjectionBindings?.length ?? 0,
        injectionWeight: item.textCharacterInjectionWeight ?? 1,
        breakProbability: item.textCharacterBreakProbability ?? 0,
        skipProbability: item.textCharacterSkipProbability ?? 0,
    });

    const initialNodes = useMemo(() => {
        const cols = Math.ceil(Math.sqrt(Math.max(items.length, 1)));
        return items.map((item, idx) => ({
            id: item.id,
            type: 'injectionNode' as const,
            position: { x: (idx % cols) * 220 + 50, y: Math.floor(idx / cols) * 180 + 50 },
            data: buildNodeData(item),
        }));
    }, [items]);

    const initialEdges = useMemo(() => {
        const edges: Edge[] = [];
        let edgeIdx = 0;
        for (const item of items) {
            for (const boundId of (item.textCharacterInjectionBindings ?? [])) {
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
    }, [items]);

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
        // Allow self-connections (source === target)
        setItems(prev => prev.map(item => {
            if (item.id !== connection.source) return item;
            const bindings = item.textCharacterInjectionBindings ?? [];
            if (bindings.includes(connection.target!)) return item;
            return { ...item, textCharacterInjectionBindings: [...bindings, connection.target!], lastUpdatedTimestamp: Date.now() };
        }));
        setEdges(prev => addEdge({
            ...connection,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
            style: { stroke: '#f59e0b', strokeWidth: 2, opacity: 0.7 },
        }, prev));
    }, [setItems, setEdges]);

    const onReconnectStart = useCallback((_event: unknown, _edge: Edge, _handleType: string) => {
        // No-op: just tracking that a reconnect drag started
    }, []);

    const onReconnectEnd = useCallback((_event: unknown, edge: Edge) => {
        setItems(prev => prev.map(item => {
            if (item.id !== edge.source) return item;
            return {
                ...item,
                textCharacterInjectionBindings: (item.textCharacterInjectionBindings ?? []).filter(b => b !== edge.target),
                lastUpdatedTimestamp: Date.now(),
            };
        }));
        setEdges(prev => prev.filter(e => e.id !== edge.id));
    }, [setEdges]);

    const removeBinding = useCallback((sourceItemId: string, boundId: string) => {
        setItems(prev => prev.map(item => {
            if (item.id !== sourceItemId) return item;
            return {
                ...item,
                textCharacterInjectionBindings: (item.textCharacterInjectionBindings ?? []).filter(b => b !== boundId),
                lastUpdatedTimestamp: Date.now(),
            };
        }));
        setEdges(prev => prev.filter(e => !(e.source === sourceItemId && e.target === boundId)));
    }, [setEdges]);

    const handleAddFromPreset = useCallback((presetIndex: number) => {
        if (presetIndex < 0 || presetIndex >= TEXT_CHARACTER_INJECTION_PRESETS.length) return;
        const preset = TEXT_CHARACTER_INJECTION_PRESETS[presetIndex];
        const newInjection = createInjectionFromPreset(preset);
        setItems(prev => [...prev, newInjection]);
        setSelectedId(newInjection.id);
        setSelectedPresetIndex(-1);

        const idx = items.length;
        const cols = Math.ceil(Math.sqrt(idx + 1));
        setNodes(prev => [...prev, {
            id: newInjection.id,
            type: 'injectionNode',
            position: { x: (idx % cols) * 220 + 50, y: Math.floor(idx / cols) * 180 + 50 },
            data: buildNodeData(newInjection),
        }]);
    }, [items.length, setNodes]);

    const handleAdd = useCallback(() => {
        const now = Date.now();
        const newItem: TextCharacterInjection = {
            id: uuidv4(),
            name: '',
            description: '',
            textCharacters: [],
            textCharacterWeights: {},
            textCharacterInjectionBindings: [],
            textCharacterInjectionWeight: 1,
            textCharacterBreakProbability: 0,
            textCharacterSkipProbability: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };
        setItems(prev => [...prev, newItem]);
        setSelectedId(newItem.id);
        setSelectedPresetIndex(-1);

        const idx = items.length;
        const cols = Math.ceil(Math.sqrt(idx + 1));
        setNodes(prev => [...prev, {
            id: newItem.id,
            type: 'injectionNode',
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

    const updateField = useCallback(<K extends keyof TextCharacterInjection>(id: string, field: K, value: TextCharacterInjection[K]) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value, lastUpdatedTimestamp: Date.now() } : item
        ));
    }, []);

    const handleSave = useCallback(() => {
        const validItems = items.filter(item => item.name.trim().length > 0);
        onSaveInjections(validItems);
        onClose();
    }, [items, onSaveInjections, onClose]);

    const handleAddCharacter = useCallback(() => {
        if (!selectedId) return;
        setItems(prev => prev.map(item => {
            if (item.id !== selectedId) return item;
            const chars = [...(item.textCharacters ?? []), ''];
            return { ...item, textCharacters: chars, lastUpdatedTimestamp: Date.now() };
        }));
    }, [selectedId]);

    const handleRemoveCharacter = useCallback((index: number) => {
        if (!selectedId) return;
        setItems(prev => prev.map(item => {
            if (item.id !== selectedId) return item;
            const chars = [...(item.textCharacters ?? [])];
            chars.splice(index, 1);
            const oldWeights = item.textCharacterWeights ?? {};
            const newWeights: Record<number, number> = {};
            for (const [k, v] of Object.entries(oldWeights)) {
                const idx = Number(k);
                if (idx < index) newWeights[idx] = v;
                else if (idx > index) newWeights[idx - 1] = v;
            }
            return { ...item, textCharacters: chars, textCharacterWeights: newWeights, lastUpdatedTimestamp: Date.now() };
        }));
    }, [selectedId]);

    const handleUpdateCharacter = useCallback((index: number, value: string) => {
        if (!selectedId) return;
        setItems(prev => prev.map(item => {
            if (item.id !== selectedId) return item;
            const chars = [...(item.textCharacters ?? [])];
            chars[index] = value;
            return { ...item, textCharacters: chars, lastUpdatedTimestamp: Date.now() };
        }));
    }, [selectedId]);

    const handleWeightChange = useCallback((index: number, value: number) => {
        if (!selectedId) return;
        setItems(prev => prev.map(item => {
            if (item.id !== selectedId) return item;
            const weights = { ...(item.textCharacterWeights ?? {}) };
            if (value <= 0) {
                delete weights[index];
            } else {
                weights[index] = value;
            }
            return { ...item, textCharacterWeights: weights, lastUpdatedTimestamp: Date.now() };
        }));
    }, [selectedId]);

    if (!isOpen) return null;

    const selectedItem = items.find(i => i.id === selectedId) ?? null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '90vh' }}>
                <div className="modal-header">
                    <h2>Text Character Injection</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        <button type="button" className="editor-button editor-button-save" onClick={handleSave}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Graph */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '0.6rem', opacity: 0.6 }}>
                            Drag between nodes to create chaining connections. Nodes can connect to themselves. Tap a chain chip below to disconnect. Click a node to edit. Blue = has characters. Green badge = injection weight. Orange arrows = chains. Red badge = break probability.
                        </div>
                        <div ref={reactFlowWrapper} style={{ height: '300px', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                            <ReactFlow
                                nodes={nodes}
                                edges={edges}
                                onNodesChange={onNodesChange}
                                onEdgesChange={onEdgesChange}
                                onConnect={onConnect}
                                onReconnectStart={onReconnectStart}
                                onReconnectEnd={onReconnectEnd}
                                onNodeClick={(_, node) => setSelectedId(node.id)}
                                nodeTypes={nodeTypes}
                                connectionMode={ConnectionMode.Loose}
                                edgesReconnectable={true}
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
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button type="button" className="editor-button editor-button-import" onClick={handleAdd} style={{ flex: 1 }}>
                                + Add Injection
                            </button>
                            <select
                                value={selectedPresetIndex}
                                onChange={(e) => {
                                    const idx = Number(e.target.value);
                                    if (idx >= 0) handleAddFromPreset(idx);
                                }}
                                className="editor-select"
                                style={{ flex: 1, fontSize: '0.75rem', padding: '8px 12px' }}
                            >
                                <option value={-1}>+ Add from Preset...</option>
                                {TEXT_CHARACTER_INJECTION_PRESETS.map((preset, idx) => (
                                    <option key={idx} value={idx}>{preset.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Node List */}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                        <label className="editor-label editor-label-small">All Injections ({items.length})</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                            {items.map(item => (
                                <div
                                    key={item.id}
                                    onClick={() => setSelectedId(item.id)}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '6px 10px',
                                        borderRadius: '6px',
                                        border: `1px solid ${selectedId === item.id ? 'var(--accent-border)' : 'var(--border)'}`,
                                        background: selectedId === item.id ? 'var(--accent-bg)' : 'var(--social-bg)',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                        minHeight: '32px',
                                    }}
                                >
                                    <span style={{
                                        fontSize: '0.75rem',
                                        fontWeight: selectedId === item.id ? 'bold' : 'normal',
                                        color: 'var(--text-h)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        flex: 1,
                                        minWidth: 0,
                                        textAlign: 'left',
                                    }}>
                                        {item.name || '(Unnamed)'}
                                    </span>
                                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                        {(item.textCharacters?.length ?? 0) > 0 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(96, 165, 250, 0.2)', borderRadius: '3px', color: '#93c5fd' }}>
                                                {item.textCharacters!.length}
                                            </span>
                                        )}
                                        {(item.textCharacterInjectionWeight ?? 1) !== 1 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(34, 197, 94, 0.15)', borderRadius: '3px', color: '#22c55e' }}>
                                                Wt {item.textCharacterInjectionWeight}
                                            </span>
                                        )}
                                        {(item.textCharacterInjectionBindings?.length ?? 0) > 0 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: '3px', color: '#fbbf24' }}>
                                                →{item.textCharacterInjectionBindings!.length}
                                            </span>
                                        )}
                                        {(item.textCharacterBreakProbability ?? 0) > 0 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(239, 68, 68, 0.15)', borderRadius: '3px', color: '#ef4444' }}>
                                                ⚡{Math.round((item.textCharacterBreakProbability ?? 0) * 100)}%
                                            </span>
                                        )}
                                        {(item.textCharacterSkipProbability ?? 0) > 0 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(251, 146, 60, 0.15)', borderRadius: '3px', color: '#fb923c' }}>
                                                ⏭️{Math.round((item.textCharacterSkipProbability ?? 0) * 100)}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {items.length === 0 && (
                                <div style={{ fontSize: '0.65rem', opacity: 0.4, fontStyle: 'italic', padding: '8px 0', textAlign: 'center' }}>
                                    No injections yet. Click "+ Add Injection" above.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Editor Panel */}
                    {!selectedItem ? (
                        <div style={{ textAlign: 'center', padding: '20px 0', opacity: 0.5, fontStyle: 'italic', fontSize: '0.75rem' }}>
                            Select an injection node to edit, or add a new one.
                        </div>
                    ) : (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Edit Injection</span>
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
                                    placeholder="e.g., Alphanumeric Prefix"
                                />
                            </div>

                            <div>
                                <label className="editor-label editor-label-small">Description</label>
                                <textarea
                                    value={selectedItem.description || ''}
                                    onChange={(e) => updateField(selectedItem.id, 'description', e.target.value || undefined)}
                                    className="editor-textarea"
                                    placeholder="What this injection does (display only)"
                                    rows={2}
                                />
                            </div>

                            {/* Injection Weight */}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <label className="editor-label editor-label-small">Injection Weight</label>
                                <input
                                    type="number"
                                    value={selectedItem.textCharacterInjectionWeight ?? 1}
                                    onChange={(e) => updateField(selectedItem.id, 'textCharacterInjectionWeight', Number(e.target.value))}
                                    className="editor-input"
                                    min="0"
                                    step="0.5"
                                    placeholder="1"
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Selection weight when this injection is chosen as the next in a chain or as the starting injection. Higher = more likely to be picked. Default is 1.
                                </div>
                            </div>

                            {/* Break Probability */}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <label className="editor-label editor-label-small">Break Probability</label>
                                <input
                                    type="number"
                                    value={selectedItem.textCharacterBreakProbability ?? 0}
                                    onChange={(e) => updateField(selectedItem.id, 'textCharacterBreakProbability', Number(e.target.value))}
                                    className="editor-input"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    placeholder="0"
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Probability that the injection chain breaks after generating this text. 0 = always chain. 1 = never chain.
                                </div>
                            </div>

                            {/* Skip Probability */}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <label className="editor-label editor-label-small">Skip Probability</label>
                                <input
                                    type="number"
                                    value={selectedItem.textCharacterSkipProbability ?? 0}
                                    onChange={(e) => updateField(selectedItem.id, 'textCharacterSkipProbability', Number(e.target.value))}
                                    className="editor-input"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    placeholder="0"
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Probability of skipping text generation for this injection and moving to the next binding. 0 = always generate. 1 = always skip.
                                </div>
                            </div>

                            {/* Character Pool */}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                    <label className="editor-label editor-label-small">Character Pool ({selectedItem.textCharacters?.length ?? 0})</label>
                                    <button
                                        type="button"
                                        onClick={handleAddCharacter}
                                        className="toolbar-button"
                                        title="Add character to pool"
                                        style={{ fontSize: '0.7rem', padding: '2px 8px' }}
                                    >+</button>
                                </div>
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>
                                    Characters randomly selected from this pool are prepended to the text injection. Set weights below to bias selection.
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                                    {(selectedItem.textCharacters ?? []).map((char, idx) => {
                                        const weight = selectedItem.textCharacterWeights?.[idx] ?? 0;
                                        return (
                                            <div key={idx} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                <input
                                                    type="text"
                                                    value={char}
                                                    onChange={(e) => handleUpdateCharacter(idx, e.target.value)}
                                                    className="editor-input"
                                                    placeholder={`Char ${idx + 1}`}
                                                    style={{ flex: 1, fontSize: '0.7rem', padding: '4px 6px' }}
                                                />
                                                <input
                                                    type="number"
                                                    value={weight}
                                                    onChange={(e) => handleWeightChange(idx, Number(e.target.value))}
                                                    className="editor-input"
                                                    placeholder="Wt"
                                                    min="0"
                                                    step="1"
                                                    style={{ width: '50px', fontSize: '0.7rem', padding: '4px 6px' }}
                                                    title="Selection weight (0 = uniform)"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveCharacter(idx)}
                                                    className="toolbar-button"
                                                    title="Remove"
                                                    style={{ width: '20px', height: '20px', fontSize: '0.7rem', color: '#ff4444', padding: 0 }}
                                                >×</button>
                                            </div>
                                        );
                                    })}
                                    {(selectedItem.textCharacters ?? []).length === 0 && (
                                        <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic', padding: '4px 0' }}>
                                            No characters in pool. Click + to add.
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Chain Bindings Display */}
                            {(selectedItem.textCharacterInjectionBindings?.length ?? 0) > 0 && (
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                    <label className="editor-label editor-label-small">Chains To ({selectedItem.textCharacterInjectionBindings!.length})</label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {selectedItem.textCharacterInjectionBindings!.map(boundId => {
                                            const boundItem = items.find(i => i.id === boundId);
                                            const isSelf = boundId === selectedItem.id;
                                            return (
                                                <span
                                                    key={boundId}
                                                    onClick={() => removeBinding(selectedItem.id, boundId)}
                                                    style={{
                                                        fontSize: '0.6rem', padding: '2px 6px',
                                                        background: isSelf ? 'rgba(168, 85, 247, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                                        border: `1px solid ${isSelf ? 'rgba(168, 85, 247, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                                                        borderRadius: '4px',
                                                        color: isSelf ? '#c084fc' : '#fbbf24',
                                                        cursor: 'pointer', transition: 'all 0.15s',
                                                    }}
                                                >
                                                    {isSelf ? '↻ ' : (boundItem?.name || '(Unknown)')}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    <div style={{ fontSize: '0.5rem', opacity: 0.4, marginTop: '4px' }}>
                                        Tap a chip to disconnect.
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}