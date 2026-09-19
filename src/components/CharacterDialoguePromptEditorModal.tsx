// src/components/CharacterDialoguePromptEditorModal.tsx
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { DialoguePrompt, RegularExpressionTrigger } from '../types';
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

interface CharacterDialoguePromptEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    dialoguePrompts: DialoguePrompt[];
    onSaveDialoguePrompts: (dialoguePrompts: DialoguePrompt[]) => void;
}

// ─── Custom Dialogue Prompt Node ─────────────────────────────────────

interface DialogueNodeData extends Record<string, unknown> {
    name: string;
    contentLength: number;
    bindingCount: number;
    weight: number;
    breakProbability: number;
    skipProbability: number;
    hasTriggers: boolean;
}

const HANDLE_STYLE: React.CSSProperties = {
    background: '#10b981',
    width: '10px',
    height: '10px',
    border: '2px solid var(--social-bg, #1a1a2e)',
};

function DialogueNode({ data }: NodeProps<Node<DialogueNodeData>>) {
    const { name, contentLength, bindingCount, weight, breakProbability, skipProbability, hasTriggers } = data;

    const borderColor = contentLength > 0 ? '#10b981' : 'rgba(255, 255, 255, 0.1)';
    const bgColor = contentLength > 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.02)';
    const textColor = contentLength > 0 ? '#6ee7b7' : 'rgba(255, 255, 255, 0.35)';
    const glowColor = contentLength > 0 ? 'rgba(16, 185, 129, 0.2)' : 'none';

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
                {contentLength > 0 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(16, 185, 129, 0.2)', borderRadius: '3px', color: '#6ee7b7' }}>
                        {contentLength} char{contentLength !== 1 ? 's' : ''}
                    </span>
                )}
                {weight !== 1 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(34, 197, 94, 0.15)', borderRadius: '3px', color: '#22c55e' }}>
                        Wt {weight}
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
                {hasTriggers && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(99, 102, 241, 0.15)', borderRadius: '3px', color: '#818cf8' }}>
                        Regex
                    </span>
                )}
                {contentLength === 0 && bindingCount === 0 && breakProbability === 0 && skipProbability === 0 && weight === 1 && !hasTriggers && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', color: 'rgba(255,255,255,0.4)' }}>
                        Empty
                    </span>
                )}
            </div>
        </div>
    );
}

const nodeTypes = { dialogueNode: DialogueNode };

// ─── Component ───────────────────────────────────────────────────────

export function CharacterDialoguePromptEditorModal({
    isOpen,
    onClose,
    dialoguePrompts,
    onSaveDialoguePrompts,
}: CharacterDialoguePromptEditorModalProps) {
    const [items, setItems] = useState<DialoguePrompt[]>(() => dialoguePrompts.length > 0 ? [...dialoguePrompts] : []);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const reactFlowWrapper = useRef<HTMLDivElement>(null);

    const buildNodeData = (item: DialoguePrompt): DialogueNodeData => ({
        name: item.name,
        contentLength: item.content?.length ?? 0,
        bindingCount: item.dialoguePromptBindings?.length ?? 0,
        weight: item.dialoguePromptWeight ?? 1,
        breakProbability: item.dialoguePromptBreakProbability ?? 0,
        skipProbability: item.dialoguePromptSkipProbability ?? 0,
        hasTriggers: (item.regularExpressionActivationTriggers?.length ?? 0) > 0 || (item.regularExpressionDeactivationTriggers?.length ?? 0) > 0,
    });

    const initialNodes = useMemo(() => {
        const cols = Math.ceil(Math.sqrt(Math.max(items.length, 1)));
        return items.map((item, idx) => ({
            id: item.id,
            type: 'dialogueNode' as const,
            position: { x: (idx % cols) * 220 + 50, y: Math.floor(idx / cols) * 180 + 50 },
            data: buildNodeData(item),
        }));
    }, [items]);

    const initialEdges = useMemo(() => {
        const edges: Edge[] = [];
        let edgeIdx = 0;
        for (const item of items) {
            for (const boundId of (item.dialoguePromptBindings ?? [])) {
                if (items.some(i => i.id === boundId)) {
                    edges.push({
                        id: `e-${edgeIdx++}`,
                        source: item.id,
                        target: boundId,
                        type: 'smoothstep',
                        animated: true,
                        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
                        style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
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
        setItems(prev => prev.map(item => {
            if (item.id !== connection.source) return item;
            const bindings = item.dialoguePromptBindings ?? [];
            if (bindings.includes(connection.target!)) return item;
            return { ...item, dialoguePromptBindings: [...bindings, connection.target!], lastUpdatedTimestamp: Date.now() };
        }));
        setEdges(prev => addEdge({
            ...connection,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
            style: { stroke: '#10b981', strokeWidth: 2, opacity: 0.7 },
        }, prev));
    }, [setItems, setEdges]);

    const onReconnectStart = useCallback((_event: unknown, _edge: Edge, _handleType: string) => {
        // No-op
    }, []);

    const onReconnectEnd = useCallback((_event: unknown, edge: Edge) => {
        setItems(prev => prev.map(item => {
            if (item.id !== edge.source) return item;
            return {
                ...item,
                dialoguePromptBindings: (item.dialoguePromptBindings ?? []).filter(b => b !== edge.target),
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
                dialoguePromptBindings: (item.dialoguePromptBindings ?? []).filter(b => b !== boundId),
                lastUpdatedTimestamp: Date.now(),
            };
        }));
        setEdges(prev => prev.filter(e => !(e.source === sourceItemId && e.target === boundId)));
    }, [setEdges]);

    const handleAdd = useCallback(() => {
        const now = Date.now();
        const newItem: DialoguePrompt = {
            id: uuidv4(),
            name: '',
            description: '',
            content: '',
            dialoguePromptBindings: [],
            dialoguePromptWeight: 1,
            dialoguePromptBreakProbability: 0,
            dialoguePromptSkipProbability: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };
        setItems(prev => [...prev, newItem]);
        setSelectedId(newItem.id);

        const idx = items.length;
        const cols = Math.ceil(Math.sqrt(idx + 1));
        setNodes(prev => [...prev, {
            id: newItem.id,
            type: 'dialogueNode',
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

    const updateField = useCallback(<K extends keyof DialoguePrompt>(id: string, field: K, value: DialoguePrompt[K]) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value, lastUpdatedTimestamp: Date.now() } : item
        ));
    }, []);

    const handleSave = useCallback(() => {
        const validItems = items.filter(item => item.name.trim().length > 0);
        onSaveDialoguePrompts(validItems);
        onClose();
    }, [items, onSaveDialoguePrompts, onClose]);

    // ─── Regex Trigger Helpers ───────────────────────────────────────
    const addTrigger = useCallback((field: 'regularExpressionActivationTriggers' | 'regularExpressionDeactivationTriggers' | 'regularExpressionExclusionActivationTriggers' | 'regularExpressionExclusionDeactivationTriggers') => {
        if (!selectedId) return;
        setItems(prev => prev.map(item => {
            if (item.id !== selectedId) return item;
            const existing = item[field] ?? [];
            const newTrigger: RegularExpressionTrigger = { trigger: '', context: 'global', target: 'everyone' };
            return { ...item, [field]: [...existing, newTrigger], lastUpdatedTimestamp: Date.now() };
        }));
    }, [selectedId]);

    const removeTrigger = useCallback((field: 'regularExpressionActivationTriggers' | 'regularExpressionDeactivationTriggers' | 'regularExpressionExclusionActivationTriggers' | 'regularExpressionExclusionDeactivationTriggers', index: number) => {
        if (!selectedId) return;
        setItems(prev => prev.map(item => {
            if (item.id !== selectedId) return item;
            const existing = [...(item[field] ?? [])];
            existing.splice(index, 1);
            return { ...item, [field]: existing, lastUpdatedTimestamp: Date.now() };
        }));
    }, [selectedId]);

    const updateTrigger = useCallback((field: 'regularExpressionActivationTriggers' | 'regularExpressionDeactivationTriggers' | 'regularExpressionExclusionActivationTriggers' | 'regularExpressionExclusionDeactivationTriggers', index: number, key: keyof RegularExpressionTrigger, value: string) => {
        if (!selectedId) return;
        setItems(prev => prev.map(item => {
            if (item.id !== selectedId) return item;
            const existing = [...(item[field] ?? [])];
            if (!existing[index]) return item;
            existing[index] = { ...existing[index], [key]: value };
            return { ...item, [field]: existing, lastUpdatedTimestamp: Date.now() };
        }));
    }, [selectedId]);

    if (!isOpen) return null;

    const selectedItem = items.find(i => i.id === selectedId) ?? null;

    const renderTriggerSection = (
        label: string,
        field: 'regularExpressionActivationTriggers' | 'regularExpressionDeactivationTriggers' | 'regularExpressionExclusionActivationTriggers' | 'regularExpressionExclusionDeactivationTriggers',
    ) => {
        const triggers = selectedItem?.[field] ?? [];
        return (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label className="editor-label editor-label-small">{label} ({triggers.length})</label>
                    <button type="button" onClick={() => addTrigger(field)} className="toolbar-button" title="Add trigger" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>+</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                    {triggers.map((trigger, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input type="text" value={trigger.trigger} onChange={e => updateTrigger(field, idx, 'trigger', e.target.value)} className="editor-input" placeholder="Regex pattern" style={{ flex: 1, minWidth: '80px', fontSize: '0.65rem', padding: '3px 6px', fontFamily: 'monospace' }} />
                            <select value={trigger.context} onChange={e => updateTrigger(field, idx, 'context', e.target.value)} className="editor-select" style={{ width: '70px', fontSize: '0.6rem', padding: '3px 4px' }}>
                                <option value="global">Global</option>
                                <option value="local">Local</option>
                                <option value="previous">Previous</option>
                            </select>
                            <select value={trigger.target} onChange={e => updateTrigger(field, idx, 'target', e.target.value)} className="editor-select" style={{ width: '70px', fontSize: '0.6rem', padding: '3px 4px' }}>
                                <option value="everyone">Everyone</option>
                                <option value="listener">Listener</option>
                                <option value="self">Self</option>
                                <option value="protagonist">Protagonist</option>
                                <option value="narrator">Narrator</option>
                            </select>
                            <button type="button" onClick={() => removeTrigger(field, idx)} className="toolbar-button" title="Remove" style={{ width: '20px', height: '20px', fontSize: '0.7rem', color: '#ff4444', padding: 0 }}>×</button>
                        </div>
                    ))}
                    {triggers.length === 0 && (
                        <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic', padding: '4px 0' }}>No triggers. Click + to add.</div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '90vh' }}>
                <div className="modal-header">
                    <h2>Dialogue Prompts</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        <button type="button" className="editor-button editor-button-save" onClick={handleSave}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Graph */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '0.6rem', opacity: 0.6 }}>
                            Drag between nodes to create chaining connections. Nodes can connect to themselves. Tap a chain chip below to disconnect. Click a node to edit. Green = has content. Orange arrows = chains. Blue badge = regex triggers.
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
                                + Add Dialogue Prompt
                            </button>
                        </div>
                    </div>

                    {/* Node List */}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                        <label className="editor-label editor-label-small">All Dialogue Prompts ({items.length})</label>
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
                                        {(item.content?.length ?? 0) > 0 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(16, 185, 129, 0.2)', borderRadius: '3px', color: '#6ee7b7' }}>
                                                {item.content!.length}
                                            </span>
                                        )}
                                        {(item.dialoguePromptWeight ?? 1) !== 1 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(34, 197, 94, 0.15)', borderRadius: '3px', color: '#22c55e' }}>
                                                Wt {item.dialoguePromptWeight}
                                            </span>
                                        )}
                                        {(item.dialoguePromptBindings?.length ?? 0) > 0 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: '3px', color: '#fbbf24' }}>
                                                →{item.dialoguePromptBindings!.length}
                                            </span>
                                        )}
                                        {(item.dialoguePromptBreakProbability ?? 0) > 0 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(239, 68, 68, 0.15)', borderRadius: '3px', color: '#ef4444' }}>
                                                ⚡{Math.round((item.dialoguePromptBreakProbability ?? 0) * 100)}%
                                            </span>
                                        )}
                                        {(item.dialoguePromptSkipProbability ?? 0) > 0 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(251, 146, 60, 0.15)', borderRadius: '3px', color: '#fb923c' }}>
                                                ⏭️{Math.round((item.dialoguePromptSkipProbability ?? 0) * 100)}%
                                            </span>
                                        )}
                                        {((item.regularExpressionActivationTriggers?.length ?? 0) > 0 || (item.regularExpressionDeactivationTriggers?.length ?? 0) > 0) && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(99, 102, 241, 0.15)', borderRadius: '3px', color: '#818cf8' }}>
                                                Regex
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {items.length === 0 && (
                                <div style={{ fontSize: '0.65rem', opacity: 0.4, fontStyle: 'italic', padding: '8px 0', textAlign: 'center' }}>
                                    No dialogue prompts yet. Click "+ Add Dialogue Prompt" above.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Editor Panel */}
                    {!selectedItem ? (
                        <div style={{ textAlign: 'center', padding: '20px 0', opacity: 0.5, fontStyle: 'italic', fontSize: '0.75rem' }}>
                            Select a dialogue prompt node to edit, or add a new one.
                        </div>
                    ) : (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Edit Dialogue Prompt</span>
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
                                    placeholder="e.g., Formal Speech Pattern"
                                />
                            </div>

                            <div>
                                <label className="editor-label editor-label-small">Description</label>
                                <textarea
                                    value={selectedItem.description || ''}
                                    onChange={(e) => updateField(selectedItem.id, 'description', e.target.value || undefined)}
                                    className="editor-textarea"
                                    placeholder="What this dialogue prompt controls (display only)"
                                    rows={2}
                                />
                            </div>

                            {/* Content */}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <label className="editor-label editor-label-small">Content</label>
                                <textarea
                                    value={selectedItem.content}
                                    onChange={(e) => updateField(selectedItem.id, 'content', e.target.value)}
                                    className="editor-textarea"
                                    placeholder="Dialogue instructions, speech patterns, formatting rules..."
                                    rows={4}
                                    style={{ fontFamily: 'inherit', fontSize: '0.75rem' }}
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    The dialogue instructions injected into the prompt. Supports {'{{char}}'} and {'{{user}}'} placeholders.
                                </div>
                            </div>

                            {/* Weight */}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <label className="editor-label editor-label-small">Dialogue Prompt Weight</label>
                                <input
                                    type="number"
                                    value={selectedItem.dialoguePromptWeight ?? 1}
                                    onChange={(e) => updateField(selectedItem.id, 'dialoguePromptWeight', Number(e.target.value))}
                                    className="editor-input"
                                    min="0"
                                    step="0.5"
                                    placeholder="1"
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Selection weight when this prompt is chosen as the next in a chain or as the starting prompt. Higher = more likely. Default is 1.
                                </div>
                            </div>

                            {/* Break Probability */}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <label className="editor-label editor-label-small">Break Probability</label>
                                <input
                                    type="number"
                                    value={selectedItem.dialoguePromptBreakProbability ?? 0}
                                    onChange={(e) => updateField(selectedItem.id, 'dialoguePromptBreakProbability', Number(e.target.value))}
                                    className="editor-input"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    placeholder="0"
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Probability that the chain breaks after this prompt. 0 = always chain. 1 = never chain.
                                </div>
                            </div>

                            {/* Skip Probability */}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <label className="editor-label editor-label-small">Skip Probability</label>
                                <input
                                    type="number"
                                    value={selectedItem.dialoguePromptSkipProbability ?? 0}
                                    onChange={(e) => updateField(selectedItem.id, 'dialoguePromptSkipProbability', Number(e.target.value))}
                                    className="editor-input"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    placeholder="0"
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Probability of skipping this prompt's content and moving to the next binding. 0 = always include. 1 = always skip.
                                </div>
                            </div>

                            {/* Chain Bindings Display */}
                            {(selectedItem.dialoguePromptBindings?.length ?? 0) > 0 && (
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                    <label className="editor-label editor-label-small">Chains To ({selectedItem.dialoguePromptBindings!.length})</label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {selectedItem.dialoguePromptBindings!.map(boundId => {
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
                                                    {isSelf ? '↻' : (boundItem?.name || '(Unknown)')}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    <div style={{ fontSize: '0.5rem', opacity: 0.4, marginTop: '4px' }}>
                                        Tap a chip to disconnect.
                                    </div>
                                </div>
                            )}

                            {/* Regex Triggers */}
                            {renderTriggerSection('Activation Triggers', 'regularExpressionActivationTriggers')}
                            {renderTriggerSection('Deactivation Triggers', 'regularExpressionDeactivationTriggers')}
                            {renderTriggerSection('Exclusion Activation Triggers', 'regularExpressionExclusionActivationTriggers')}
                            {renderTriggerSection('Exclusion Deactivation Triggers', 'regularExpressionExclusionDeactivationTriggers')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}