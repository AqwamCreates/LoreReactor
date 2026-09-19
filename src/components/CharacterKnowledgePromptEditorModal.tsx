// src/components/CharacterKnowledgePromptEditorModal.tsx
import { useState, useCallback, useMemo, useRef } from 'react';
import type { KnowledgePrompt } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { RegularExpressionTriggerEditor } from './RegularExpressionTriggerEditor';
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

interface CharacterKnowledgePromptEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    knowledgePrompts: KnowledgePrompt[];
    onSaveKnowledgePrompts: (knowledgePrompts: KnowledgePrompt[]) => void;
}

// ─── Custom Knowledge Prompt Node ────────────────────────────────────

interface KnowledgeNodeData extends Record<string, unknown> {
    name: string;
    contentLength: number;
    bindingCount: number;
    hasActivationTriggers: boolean;
    hasDeactivationTriggers: boolean;
}

const HANDLE_STYLE: React.CSSProperties = {
    background: '#8b5cf6',
    width: '10px',
    height: '10px',
    border: '2px solid var(--social-bg, #1a1a2e)',
};

function KnowledgeNode({ data }: NodeProps<Node<KnowledgeNodeData>>) {
    const { name, contentLength, bindingCount, hasActivationTriggers, hasDeactivationTriggers } = data;

    const hasContent = contentLength > 0;
    const isConditional = hasActivationTriggers || hasDeactivationTriggers;

    let borderColor: string;
    let bgColor: string;
    let textColor: string;
    let glowColor: string;

    if (hasContent && isConditional) {
        borderColor = '#f59e0b';
        bgColor = 'rgba(245, 158, 11, 0.1)';
        textColor = '#fbbf24';
        glowColor = 'rgba(245, 158, 11, 0.2)';
    } else if (hasContent) {
        borderColor = '#8b5cf6';
        bgColor = 'rgba(139, 92, 246, 0.1)';
        textColor = '#a78bfa';
        glowColor = 'rgba(139, 92, 246, 0.2)';
    } else {
        borderColor = 'rgba(255, 255, 255, 0.1)';
        bgColor = 'rgba(255, 255, 255, 0.02)';
        textColor = 'rgba(255, 255, 255, 0.35)';
        glowColor = 'none';
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
                {hasContent && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(139, 92, 246, 0.2)', borderRadius: '3px', color: '#a78bfa' }}>
                        {contentLength} chars
                    </span>
                )}
                {bindingCount > 0 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: '3px', color: '#fbbf24' }}>
                        Links {bindingCount}
                    </span>
                )}
                {isConditional && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(245, 158, 11, 0.2)', borderRadius: '3px', color: '#fbbf24' }}>
                        Conditional
                    </span>
                )}
                {!hasContent && !isConditional && bindingCount === 0 && (
                    <span style={{ fontSize: '0.5rem', padding: '1px 4px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '3px', color: 'rgba(255,255,255,0.4)' }}>
                        Empty
                    </span>
                )}
            </div>
        </div>
    );
}

const nodeTypes = { knowledgeNode: KnowledgeNode };

// ─── Component ───────────────────────────────────────────────────────

export function CharacterKnowledgePromptEditorModal({
    isOpen,
    onClose,
    knowledgePrompts,
    onSaveKnowledgePrompts,
}: CharacterKnowledgePromptEditorModalProps) {
    const [items, setItems] = useState<KnowledgePrompt[]>(() => knowledgePrompts.length > 0 ? [...knowledgePrompts] : []);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [prevKnowledgePrompts, setPrevKnowledgePrompts] = useState<KnowledgePrompt[]>(knowledgePrompts);
    const reactFlowWrapper = useRef<HTMLDivElement>(null);

    // Adjust state during render when prop changes (no useEffect, no ref reads during render)
    if (knowledgePrompts !== prevKnowledgePrompts) {
        setPrevKnowledgePrompts(knowledgePrompts);
        setItems(knowledgePrompts.length > 0 ? [...knowledgePrompts] : []);
        setSelectedId(null);
    }

    const buildNodeData = (item: KnowledgePrompt): KnowledgeNodeData => ({
        name: item.name,
        contentLength: item.content?.length ?? 0,
        bindingCount: item.knowledgePromptBindings.length,
        hasActivationTriggers: (item.regularExpressionActivationTriggers?.length ?? 0) > 0,
        hasDeactivationTriggers: (item.regularExpressionDeactivationTriggers?.length ?? 0) > 0,
    });

    const initialNodes = useMemo(() => {
        const cols = Math.ceil(Math.sqrt(Math.max(items.length, 1)));
        return items.map((item, idx) => ({
            id: item.id,
            type: 'knowledgeNode' as const,
            position: { x: (idx % cols) * 220 + 50, y: Math.floor(idx / cols) * 180 + 50 },
            data: buildNodeData(item),
        }));
    }, [items]);

    const initialEdges = useMemo(() => {
        const edges: Edge[] = [];
        let edgeIdx = 0;
        for (const item of items) {
            for (const boundId of item.knowledgePromptBindings) {
                if (items.some(i => i.id === boundId)) {
                    edges.push({
                        id: `e-${edgeIdx++}`,
                        source: item.id,
                        target: boundId,
                        type: 'smoothstep',
                        animated: true,
                        markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' },
                        style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
                    });
                }
            }
        }
        return edges;
    }, [items]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    const onConnect = useCallback((connection: Connection) => {
        if (!connection.source || !connection.target) return;
        setItems(prev => prev.map(item => {
            if (item.id !== connection.source) return item;
            if (item.knowledgePromptBindings.includes(connection.target!)) return item;
            return { ...item, knowledgePromptBindings: [...item.knowledgePromptBindings, connection.target!], lastUpdatedTimestamp: Date.now() };
        }));
        setEdges(prev => addEdge({
            ...connection,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' },
            style: { stroke: '#8b5cf6', strokeWidth: 2, opacity: 0.7 },
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
                knowledgePromptBindings: item.knowledgePromptBindings.filter(b => b !== edge.target),
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
                knowledgePromptBindings: item.knowledgePromptBindings.filter(b => b !== boundId),
                lastUpdatedTimestamp: Date.now(),
            };
        }));
        setEdges(prev => prev.filter(e => !(e.source === sourceItemId && e.target === boundId)));
    }, [setEdges]);

    const handleAdd = useCallback(() => {
        const now = Date.now();
        const newItem: KnowledgePrompt = {
            id: uuidv4(),
            name: '',
            description: '',
            content: '',
            knowledgePromptBindings: [],
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };
        setItems(prev => [...prev, newItem]);
        setSelectedId(newItem.id);

        const idx = items.length;
        const cols = Math.ceil(Math.sqrt(idx + 1));
        setNodes(prev => [...prev, {
            id: newItem.id,
            type: 'knowledgeNode',
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

    const updateField = useCallback(<K extends keyof KnowledgePrompt>(id: string, field: K, value: KnowledgePrompt[K]) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value, lastUpdatedTimestamp: Date.now() } : item
        ));
    }, []);

    const handleSave = useCallback(() => {
        const validItems = items.filter(item => item.name.trim().length > 0);
        onSaveKnowledgePrompts(validItems);
        onClose();
    }, [items, onSaveKnowledgePrompts, onClose]);

    if (!isOpen) return null;

    const selectedItem = items.find(i => i.id === selectedId) ?? null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '90vh' }}>
                <div className="modal-header">
                    <h2>Knowledge Prompts</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        <button type="button" className="editor-button editor-button-save" onClick={handleSave}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Graph */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '0.6rem', opacity: 0.6 }}>
                            Drag between nodes to create knowledge links. Tap a link chip below to disconnect. Click a node to edit. Purple = has content. Orange = conditional access. Violet arrows = links.
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
                        <button type="button" className="editor-button editor-button-import" onClick={handleAdd} style={{ width: '100%' }}>
                            + Add Knowledge Prompt
                        </button>
                    </div>

                    {/* Node List */}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                        <label className="editor-label editor-label-small">All Knowledge Prompts ({items.length})</label>
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
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(139, 92, 246, 0.2)', borderRadius: '3px', color: '#a78bfa' }}>
                                                {item.content!.length}c
                                            </span>
                                        )}
                                        {item.knowledgePromptBindings.length > 0 && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(245, 158, 11, 0.15)', borderRadius: '3px', color: '#fbbf24' }}>
                                                →{item.knowledgePromptBindings.length}
                                            </span>
                                        )}
                                        {((item.regularExpressionActivationTriggers?.length ?? 0) > 0 || (item.regularExpressionDeactivationTriggers?.length ?? 0) > 0) && (
                                            <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(245, 158, 11, 0.2)', borderRadius: '3px', color: '#fbbf24' }}>
                                                Cond
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {items.length === 0 && (
                                <div style={{ fontSize: '0.65rem', opacity: 0.4, fontStyle: 'italic', padding: '8px 0', textAlign: 'center' }}>
                                    No knowledge prompts yet. Click "+ Add Knowledge Prompt" above.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Editor Panel */}
                    {!selectedItem ? (
                        <div style={{ textAlign: 'center', padding: '20px 0', opacity: 0.5, fontStyle: 'italic', fontSize: '0.75rem' }}>
                            Select a knowledge prompt node to edit, or add a new one.
                        </div>
                    ) : (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Edit Knowledge Prompt</span>
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
                                    placeholder="e.g., Backstory, Combat Training, Relationship History"
                                />
                            </div>

                            <div>
                                <label className="editor-label editor-label-small">Description</label>
                                <textarea
                                    value={selectedItem.description || ''}
                                    onChange={(e) => updateField(selectedItem.id, 'description', e.target.value || undefined)}
                                    className="editor-textarea"
                                    placeholder="What this knowledge contains (display only)"
                                    rows={2}
                                />
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <label className="editor-label editor-label-small">Content</label>
                                <textarea
                                    value={selectedItem.content || ''}
                                    onChange={(e) => updateField(selectedItem.id, 'content', e.target.value)}
                                    className="editor-textarea"
                                    placeholder="The knowledge content returned when the model uses the knowledge tool to access this entry."
                                    rows={6}
                                />
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    This content is NOT injected into context automatically. The model must explicitly recall it via the knowledge tool.
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <RegularExpressionTriggerEditor
                                    label="Access Activation"
                                    description="This knowledge becomes available to the knowledge tool when any trigger matches. Without triggers, this knowledge is always accessible."
                                    triggers={selectedItem.regularExpressionActivationTriggers ?? []}
                                    onChange={(triggers) => updateField(selectedItem.id, 'regularExpressionActivationTriggers', triggers.length > 0 ? triggers : undefined)}
                                />
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <RegularExpressionTriggerEditor
                                    label="Access Deactivation"
                                    description="This knowledge becomes unavailable to the knowledge tool when any trigger matches."
                                    triggers={selectedItem.regularExpressionDeactivationTriggers ?? []}
                                    onChange={(triggers) => updateField(selectedItem.id, 'regularExpressionDeactivationTriggers', triggers.length > 0 ? triggers : undefined)}
                                />
                            </div>

                            {selectedItem.knowledgePromptBindings.length > 0 && (
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                    <label className="editor-label editor-label-small">Links To ({selectedItem.knowledgePromptBindings.length})</label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {selectedItem.knowledgePromptBindings.map(boundId => {
                                            const boundItem = items.find(i => i.id === boundId);
                                            const isSelf = boundId === selectedItem.id;
                                            return (
                                                <span
                                                    key={boundId}
                                                    onClick={() => removeBinding(selectedItem.id, boundId)}
                                                    style={{
                                                        fontSize: '0.6rem', padding: '2px 6px',
                                                        background: isSelf ? 'rgba(139, 92, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                                        border: `1px solid ${isSelf ? 'rgba(139, 92, 246, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                                                        borderRadius: '4px',
                                                        color: isSelf ? '#a78bfa' : '#fbbf24',
                                                        cursor: 'pointer', transition: 'all 0.15s',
                                                    }}
                                                >
                                                    {isSelf ? '↻ Self' : (boundItem?.name || '(Unknown)')}
                                                </span>
                                            );
                                        })}
                                    </div>
                                    <div style={{ fontSize: '0.5rem', opacity: 0.4, marginTop: '4px' }}>
                                        Tap a chip to disconnect. Linked prompts are discoverable by the model when this entry is accessed.
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