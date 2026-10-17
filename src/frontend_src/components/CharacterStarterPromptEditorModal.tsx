// src/frontend_src/components/CharacterStarterPromptEditorModal.tsx
import { useState, useCallback } from 'react';
import type { StarterPrompt } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { RegularExpressionTriggerEditor } from './RegularExpressionTriggerEditor';
import '../main.css';

interface CharacterStarterPromptEditorModalProps {
    isReadOnly?: boolean;
    onClose: () => void;
    starterPrompts: StarterPrompt[];
    onSaveStarterPrompts: (starterPrompts: StarterPrompt[]) => void;
}

export function CharacterStarterPromptEditorModal({
    isReadOnly = false,
    onClose,
    starterPrompts,
    onSaveStarterPrompts,
}: CharacterStarterPromptEditorModalProps) {
    const [items, setItems] = useState<StarterPrompt[]>(() => starterPrompts.length > 0 ? [...starterPrompts] : []);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const handleAdd = useCallback(() => {
        if (isReadOnly) return;
        const now = Date.now();
        const newItem: StarterPrompt = {
            id: uuidv4(),
            name: '',
            description: '',
            content: '',
            weight: 1,
            skipProbability: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };
        setItems(prev => [...prev, newItem]);
        setSelectedId(newItem.id);
    }, [isReadOnly]);

    const handleRemove = useCallback((id: string) => {
        if (isReadOnly) return;
        setItems(prev => prev.filter(item => item.id !== id));
        if (selectedId === id) setSelectedId(null);
    }, [selectedId, isReadOnly]);

    const updateField = useCallback(<K extends keyof StarterPrompt>(id: string, field: K, value: StarterPrompt[K]) => {
        if (isReadOnly) return;
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value, lastUpdatedTimestamp: Date.now() } : item
        ));
    }, [isReadOnly]);

    const handleSave = useCallback(() => {
        const validItems = items.filter(item => item.content.trim().length > 0);
        onSaveStarterPrompts(validItems);
        onClose();
    }, [items, onSaveStarterPrompts, onClose]);

    const selectedItem = items.find(i => i.id === selectedId) ?? null;
    const hasExistingItems = starterPrompts.length > 0;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '90vh' }}>
                <div className="modal-header">
                    <h2>{(hasExistingItems ? `${(isReadOnly) ? 'View' : 'Edit'} Starter Prompts` : 'Create New Starter Prompts')}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>{isReadOnly ? 'Close' : 'Cancel'}</button>
                        {!isReadOnly && <button type="button" className="editor-button editor-button-save" onClick={handleSave}>Save</button>}
                    </div>
                </div>
                
                <div className="modal-body editor-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <label className="editor-label editor-label-small">All Starter Prompts ({items.length})</label>
                            {!isReadOnly && (
                                <button type="button" className="toolbar-button" onClick={handleAdd} style={{ fontSize: '0.7rem', padding: '2px 8px' }}>+ Add</button>
                            )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '150px', overflowY: 'auto' }}>
                            {items.map(item => (
                                <div
                                    key={item.id}
                                    onClick={() => setSelectedId(item.id)}
                                    style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '6px 10px', borderRadius: '6px',
                                        border: `1px solid ${selectedId === item.id ? 'var(--accent-border)' : 'var(--border)'}`,
                                        background: selectedId === item.id ? 'var(--accent-bg)' : 'var(--social-bg)',
                                        cursor: 'pointer', transition: 'all 0.15s', minHeight: '32px',
                                    }}
                                >
                                    <span style={{
                                        fontSize: '0.75rem', fontWeight: selectedId === item.id ? 'bold' : 'normal',
                                        color: 'var(--text-h)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, textAlign: 'left',
                                    }}>
                                        {item.name || item.content.substring(0, 40) + (item.content.length > 40 ? '...' : '') || '(Empty)'}
                                    </span>
                                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                        <span style={{ fontSize: '0.55rem', padding: '1px 4px', background: 'rgba(139, 92, 246, 0.2)', borderRadius: '3px', color: '#a78bfa' }}>
                                            Wt: {item.weight}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            {items.length === 0 && (
                                <div style={{ fontSize: '0.65rem', opacity: 0.4, fontStyle: 'italic', padding: '8px 0', textAlign: 'center' }}>
                                    No starter prompts yet.{!isReadOnly && ' Click "+ Add" above.'}
                                </div>
                            )}
                        </div>
                    </div>

                    {!selectedItem ? (
                        <div style={{ textAlign: 'center', padding: '20px 0', opacity: 0.5, fontStyle: 'italic', fontSize: '0.75rem' }}>
                            Select a starter prompt to {isReadOnly ? 'view' : 'edit'}{!isReadOnly && ', or add a new one'}.
                        </div>
                    ) : (
                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{isReadOnly ? 'View' : 'Edit'} Starter Prompt</span>
                                {!isReadOnly && (
                                    <button type="button" onClick={() => handleRemove(selectedItem.id)} className="toolbar-button" title="Remove" style={{ width: '24px', height: '24px', fontSize: '0.8rem', color: '#ff4444' }}>×</button>
                                )}
                            </div>
                            
                            <div>
                                <label className="editor-label editor-label-small">Name (Optional)</label>
                                <input type="text" value={selectedItem.name} onChange={(e) => updateField(selectedItem.id, 'name', e.target.value)} className="editor-input" placeholder="e.g., Default Greeting, Angry Greeting" readOnly={isReadOnly} />
                            </div>

                            <div>
                                <label className="editor-label editor-label-small">Content</label>
                                <textarea value={selectedItem.content} onChange={(e) => updateField(selectedItem.id, 'content', e.target.value)} className="editor-textarea" placeholder="The actual greeting message..." rows={4} readOnly={isReadOnly} />
                            </div>

                            <div className="editor-row">
                                <div style={{ flex: 1 }}>
                                    <label className="editor-label editor-label-small">Weight</label>
                                    <input type="number" min="0.1" step="0.5" value={selectedItem.weight} onChange={(e) => updateField(selectedItem.id, 'weight', Math.max(0.1, Number(e.target.value) || 1))} className="editor-input" readOnly={isReadOnly} />
                                    <div style={{ fontSize: '0.5rem', opacity: 0.5, marginTop: '2px' }}>Higher = more likely to be chosen.</div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label className="editor-label editor-label-small">Skip Probability</label>
                                    <input type="number" min="0" max="1" step="0.05" value={selectedItem.skipProbability} onChange={(e) => updateField(selectedItem.id, 'skipProbability', Math.max(0, Math.min(1, Number(e.target.value) || 0)))} className="editor-input" readOnly={isReadOnly} />
                                    <div style={{ fontSize: '0.5rem', opacity: 0.5, marginTop: '2px' }}>Chance to skip this node (0-1).</div>
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <RegularExpressionTriggerEditor
                                    label="Activation Triggers"
                                    description="Only use this starter prompt if the context matches these triggers."
                                    triggers={selectedItem.regularExpressionActivationTriggers ?? []}
                                    onChange={(triggers) => updateField(selectedItem.id, 'regularExpressionActivationTriggers', triggers.length > 0 ? triggers : undefined)}
                                    isReadOnly={isReadOnly}
                                />
                            </div>
                            
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                <RegularExpressionTriggerEditor
                                    label="Deactivation Triggers"
                                    description="Prevent this starter prompt from being used if these triggers match."
                                    triggers={selectedItem.regularExpressionDeactivationTriggers ?? []}
                                    onChange={(triggers) => updateField(selectedItem.id, 'regularExpressionDeactivationTriggers', triggers.length > 0 ? triggers : undefined)}
                                    isReadOnly={isReadOnly}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}