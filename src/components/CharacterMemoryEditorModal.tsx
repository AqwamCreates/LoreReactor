// src/components/CharacterMemoryEditorModal.tsx
import { useState, useEffect } from 'react';
import type { Character, Memory } from '../types';
import { loadAllRawChatDataShells } from '../hooks/storage';
import './main.css';

interface CharacterMemoryEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    character: Character | null;
    onSaveMemories: (memories: Record<string, Memory[]>) => void;
}

export function CharacterMemoryEditorModal({
    isOpen,
    onClose,
    character,
    onSaveMemories,
}: CharacterMemoryEditorModalProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [chatNameMap, setChatNameMap] = useState<Map<string, string>>(new Map());
    const [localMemories, setLocalMemories] = useState<Record<string, Memory[]>>({});
    const [hasChanges, setHasChanges] = useState(false);
    const [showMassDeleteConfirm, setShowMassDeleteConfirm] = useState(false);

    useEffect(() => {
        if (isOpen && character) {
            // Safely clone memories, defaulting to empty object if undefined
            try {
                setLocalMemories(structuredClone(character.memories ?? {}));
            } catch (e) {
                console.warn("Failed to clone memories, using reference:", e);
                setLocalMemories(character.memories ?? {});
            }
            
            setHasChanges(false);
            setEditingId(null);
            setEditContent('');
            setShowMassDeleteConfirm(false);

            (async () => {
                try {
                    const chats = await loadAllRawChatDataShells();
                    const map = new Map<string, string>();
                    for (const c of chats) {
                        if (c) map.set(c.id, c.name || 'Untitled Chat');
                    }
                    setChatNameMap(map);
                } catch { /* ignore */ }
            })();
        }
    }, [isOpen, character]);

    // If not open, return null. 
    // If character is null but modal is open, show empty state instead of disappearing completely
    if (!isOpen) return null;

    const handleStartEdit = (mem: Memory) => {
        setEditingId(mem.id);
        setEditContent(mem.content || '');
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditContent('');
    };

    const handleSaveEdit = () => {
        if (!editingId) return;
        const updated: Record<string, Memory[]> = {};
        for (const [key, mems] of Object.entries(localMemories)) {
            updated[key] = mems.map(m =>
                m.id === editingId ? { ...m, content: editContent, lastUpdatedTimestamp: Date.now() } : m
            );
        }
        setLocalMemories(updated);
        setHasChanges(true);
        setEditingId(null);
        setEditContent('');
    };

    const handleDelete = (memId: string) => {
        const updated: Record<string, Memory[]> = {};
        for (const [key, mems] of Object.entries(localMemories)) {
            updated[key] = mems.filter(m => m.id !== memId);
        }
        // Remove empty keys
        for (const key of Object.keys(updated)) {
            if (updated[key].length === 0) delete updated[key];
        }
        setLocalMemories(updated);
        setHasChanges(true);
        if (editingId === memId) {
            setEditingId(null);
            setEditContent('');
        }
    };

    const handleMassDelete = () => {
        setLocalMemories({});
        setHasChanges(true);
        setEditingId(null);
        setEditContent('');
        setShowMassDeleteConfirm(false);
    };

    const handleSaveAndClose = () => {
        onSaveMemories(localMemories);
        onClose();
    };

    const handleClose = () => {
        if (hasChanges) {
            onSaveMemories(localMemories);
        }
        onClose();
    };

    const entries = Object.entries(localMemories);
    const totalMemories = entries.reduce((sum, [, mems]) => sum + mems.length, 0);

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Memories ({totalMemories})</h2>
                    <div className="editor-modal-actions">
                        {totalMemories > 0 && !showMassDeleteConfirm && (
                            <button
                                type="button"
                                className="editor-btn editor-btn-cancel"
                                onClick={() => setShowMassDeleteConfirm(true)}
                                style={{ color: '#ff4444' }}
                            >
                                Delete All
                            </button>
                        )}
                        {showMassDeleteConfirm && (
                            <>
                                <span style={{ fontSize: '0.75rem', opacity: 0.8, alignSelf: 'center' }}>
                                    Delete all {totalMemories} memories?
                                </span>
                                <button
                                    type="button"
                                    className="editor-btn editor-btn-cancel"
                                    onClick={handleMassDelete}
                                    style={{ color: '#ff4444' }}
                                >
                                    Confirm
                                </button>
                                <button
                                    type="button"
                                    className="editor-btn editor-btn-cancel"
                                    onClick={() => setShowMassDeleteConfirm(false)}
                                >
                                    Cancel
                                </button>
                            </>
                        )}
                        {hasChanges && !showMassDeleteConfirm && (
                            <button type="button" className="editor-btn editor-btn-save" onClick={handleSaveAndClose}>Save</button>
                        )}
                        {!showMassDeleteConfirm && (
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClose}>
                                {hasChanges ? 'Discard' : 'Close'}
                            </button>
                        )}
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {!character ? (
                        <div className="empty-state">No character selected.</div>
                    ) : entries.length === 0 ? (
                        <div className="empty-state">No memories stored for this character.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {entries.map(([key, mems]) => (
                                <div key={key} className="editor-section">
                                    <span className="editor-section-title">
                                        {key === 'global' ? '🌐 Global' : `💬 ${key}`}
                                    </span>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {mems.map(mem => {
                                            const isEditing = editingId === mem.id;
                                            const chatId = mem.chatData?.id ?? 'Unknown ID';
                                            const chatName = chatNameMap.get(chatId) || 'Unknown Chat';

                                            return (
                                                <div key={mem.id} style={{
                                                    padding: '10px 12px',
                                                    background: 'var(--social-bg)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: '6px',
                                                }}>
                                                    {isEditing ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                            <textarea
                                                                value={editContent}
                                                                onChange={(e) => setEditContent(e.target.value)}
                                                                className="editor-textarea"
                                                                rows={4}
                                                                autoFocus
                                                            />
                                                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                                <button type="button" className="editor-btn editor-btn-cancel" onClick={handleCancelEdit}>Cancel</button>
                                                                <button type="button" className="editor-btn editor-btn-save" onClick={handleSaveEdit}>Save</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div>
                                                            <div style={{
                                                                fontSize: '0.75rem',
                                                                lineHeight: '1.4',
                                                                whiteSpace: 'pre-wrap',
                                                                wordBreak: 'break-word',
                                                            }}>
                                                                {mem.content || "(Empty memory)"}
                                                            </div>
                                                            <div style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                marginTop: '8px',
                                                                fontSize: '0.6rem',
                                                                opacity: 0.5,
                                                                gap: '12px'
                                                            }}>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                    <span style={{ fontWeight: 'bold' }}>Source: {chatName}</span>
                                                                    <span style={{ fontFamily: 'monospace', fontSize: '0.55rem' }}>ID: {chatId}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                                    <button
                                                                        type="button"
                                                                        className="toolbar-btn"
                                                                        onClick={() => handleStartEdit(mem)}
                                                                        title="Edit memory"
                                                                        style={{ fontSize: '0.65rem' }}
                                                                    >
                                                                        ✏️
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="toolbar-btn"
                                                                        onClick={() => handleDelete(mem.id)}
                                                                        title="Delete memory"
                                                                        style={{ fontSize: '0.65rem', color: '#ff4444' }}
                                                                    >
                                                                        🗑️
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}