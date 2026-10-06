// frontend_src/components/CharacterMemoryEditorModal.tsx
import { useState, useRef, useEffect, useMemo } from 'react';
import type { Character, Memory } from '../types';
import '../main.css';

export function CharacterMemoryEditorModal({
    character,
    onClose,
    onSaveMemories,
    chatNameMap,
    localProtagonistId, // ✅ Changed from localProtagonist (Character) to localProtagonistId (string)
}: {
    character: Character;
    onClose: () => void;
    onSaveMemories: (memories: Record<string, Memory[]>) => void;
    chatNameMap?: Map<string, string>;
    localProtagonistId?: string | null;
}) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    
    const [memories, setMemories] = useState<Record<string, Memory[]>>(() => {
        try {
            return structuredClone(character.memories ?? {});
        } catch (e) {
            console.warn("Failed to clone memories, using reference:", e);
            return character.memories ?? {};
        }
    });
    
    const [hasChanges, setHasChanges] = useState(false);
    const [showMassDeleteConfirm, setShowMassDeleteConfirm] = useState(false);
    const editTextAreaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editingId && editTextAreaRef.current) {
            editTextAreaRef.current.focus();
        }
    }, [editingId]);

    const filteredMemories = useMemo(() => {
        const result: Record<string, Memory[]> = {};
        
        for (const [chatId, mems] of Object.entries(memories)) {
            const filteredMems = mems.filter(mem => {
                if (!localProtagonistId) return true; 
                // ✅ Directly compare string IDs
                const protagIds = mem.interactionData?.protagonistIds;
                if (!protagIds || protagIds.length === 0) return false; 
                return protagIds.some(id => id === localProtagonistId);
            });
            
            if (filteredMems.length > 0) {
                result[chatId] = filteredMems;
            }
        }
        return result;
    }, [memories, localProtagonistId]);

    const resolveChatInfo = (mem: Memory): { name: string; id: string } => {
        const id = mem.interactionData?.id
            ?? (mem as unknown as { interactionDataId?: string }).interactionDataId
            ?? 'unknown';
        const name = chatNameMap?.get(id) || 'Unknown Chat';
        return { name, id };
    };

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
        
        let targetChatId = '';
        for (const [chatId, mems] of Object.entries(memories)) {
            if (mems.some(m => m.id === editingId)) {
                targetChatId = chatId;
                break;
            }
        }

        if (!targetChatId) return;

        setMemories(prev => {
            const next = { ...prev };
            next[targetChatId] = next[targetChatId].map(m =>
                m.id === editingId ? { ...m, content: editContent, lastUpdatedTimestamp: Date.now() } : m
            );
            return next;
        });
        setHasChanges(true);
        setEditingId(null);
        setEditContent('');
    };

    const handleDelete = (memId: string) => {
        setMemories(prev => {
            const next = { ...prev };
            for (const chatId of Object.keys(next)) {
                next[chatId] = next[chatId].filter(m => m.id !== memId);
                if (next[chatId].length === 0) delete next[chatId];
            }
            return next;
        });
        setHasChanges(true);
        if (editingId === memId) {
            setEditingId(null);
            setEditContent('');
        }
    };

    const handleMassDelete = () => {
        setMemories(prev => {
            const next = { ...prev };
            for (const chatId of Object.keys(next)) {
                delete next[chatId];
            }
            return next;
        });
        setHasChanges(true);
        setEditingId(null);
        setEditContent('');
        setShowMassDeleteConfirm(false);
    };

    const handleSaveAndClose = () => {
        onSaveMemories(memories);
        onClose();
    };

    const handleDiscardAndClose = () => {
        onClose();
    };

    const entries = Object.entries(filteredMemories);
    const totalMemories = entries.reduce((sum, [, mems]) => sum + mems.length, 0);

    return (
        <div className="modal-overlay" onClick={handleDiscardAndClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Memories ({totalMemories})</h2>
                    <div className="editor-modal-actions">
                        {totalMemories > 0 && !showMassDeleteConfirm && (
                            <button
                                type="button"
                                className="editor-button editor-button-cancel"
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
                                    className="editor-button editor-button-cancel"
                                    onClick={handleMassDelete}
                                    style={{ color: '#ff4444' }}
                                >
                                    Confirm
                                </button>
                                <button
                                    type="button"
                                    className="editor-button editor-button-cancel"
                                    onClick={() => setShowMassDeleteConfirm(false)}
                                >
                                    Cancel
                                </button>
                            </>
                        )}
                        {hasChanges && !showMassDeleteConfirm && (
                            <button type="button" className="editor-button editor-button-save" onClick={handleSaveAndClose}>Save</button>
                        )}
                        {!showMassDeleteConfirm && (
                            <button type="button" className="editor-button editor-button-cancel" onClick={handleDiscardAndClose}>
                                {hasChanges ? 'Discard' : 'Close'}
                            </button>
                        )}
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {entries.length === 0 ? (
                        <div className="empty-state">No memories stored for this character.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {entries.map(([key, mems]) => (
                                <div key={key} className="editor-section">
                                    <span className="editor-section-title">
                                        {`💬 ${chatNameMap?.get(key) || key}`}
                                    </span>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {mems.map(mem => {
                                            const isEditing = editingId === mem.id;
                                            const { name: chatName, id: chatId } = resolveChatInfo(mem);

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
                                                                ref={editTextAreaRef}
                                                                value={editContent}
                                                                onChange={(e) => setEditContent(e.target.value)}
                                                                className="editor-textarea"
                                                                rows={4}
                                                            />
                                                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                                <button type="button" className="editor-button editor-button-cancel" onClick={handleCancelEdit}>Cancel</button>
                                                                <button type="button" className="editor-button editor-button-save" onClick={handleSaveEdit}>Save</button>
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
                                                                        className="toolbar-button"
                                                                        onClick={() => handleStartEdit(mem)}
                                                                        title="Edit memory"
                                                                        style={{ fontSize: '0.65rem' }}
                                                                    >
                                                                        ✏️
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="toolbar-button"
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