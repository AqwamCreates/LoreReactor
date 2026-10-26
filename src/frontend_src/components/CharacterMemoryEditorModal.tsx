// src/frontend_src/components/CharacterMemoryEditorModal.tsx
import { useState, useRef, useEffect, useMemo } from 'react';
import type { Character, Location, Memory, RawInteractionData } from '../types';
import { detokenizeMemoryContent } from '../utilities/memoryLogic';
import '../main.css';

export function CharacterMemoryEditorModal({
    character,
    onClose,
    onSaveMemories,
    allCharacters,
    allLocations,
    allRawInteractionDataShells,
    localProtagonistId,
}: {
    character: Character;
    onClose: () => void;
    onSaveMemories: (memories: Record<string, Memory[]>) => void;
    allCharacters: Character[];
    allLocations: Location[];
    allRawInteractionDataShells: RawInteractionData[];
    localProtagonistId?: string | null;
}) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTextContent, setEditTextContent] = useState('');

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

    const chatMap = useMemo(() => {
        const map = new Map<string, RawInteractionData>();
        for (const chat of allRawInteractionDataShells || []) {
            if (chat.id) map.set(chat.id, chat);
        }
        return map;
    }, [allRawInteractionDataShells]);

    /**
     * Resolves raw participantIds from a session shell into full Character objects
     * using the global allCharacters roster.
     */
    const buildParticipantsFromSession = (
        chat: RawInteractionData | undefined,
        fallbackDictKey: string,
    ): Character[] => {
        if (chat?.participantIds && chat.participantIds.length > 0) {
            return chat.participantIds
                .map(id => allCharacters.find(c => c.id === id))
                .filter((c): c is Character => !!c);
        }

        // Fallback for manually authored memories lacking a session shell
        if (fallbackDictKey === character.id || fallbackDictKey === 'self') {
            return [character];
        }
        const other = allCharacters.find(c => c.id === fallbackDictKey);
        return other ? [character, other] : [character];
    };

    const resolveMemoryDisplayText = (mem: Memory, fallbackChatId: string): string => {
        const chatId = mem.interactionDataId || fallbackChatId;
        const chat = chatMap.get(chatId);
        const participants = buildParticipantsFromSession(chat, fallbackChatId);

        const knownNames: Record<string, Record<string, boolean>> = {};
        const protagIds = new Set(chat?.protagonistIds || []);
        for (const pid of protagIds) {
            const p = participants.find(pp => pp.id === pid);
            if (!p) continue;
            knownNames[pid] = {};
            if (p.name) knownNames[pid][p.name] = true;
            for (const alias of p.aliases ?? []) {
                knownNames[pid][alias] = true;
            }
        }

        return detokenizeMemoryContent(mem.textContent || '', participants, allLocations, knownNames);
    };

    const retokenizeText = (text: string, mem: Memory, fallbackChatId: string): string => {
        const chatId = mem.interactionDataId || fallbackChatId;
        const chat = chatMap.get(chatId);
        const participants = buildParticipantsFromSession(chat, fallbackChatId);

        if (participants.length === 0) return text;

        let tokenized = text;
        const candidates: { id: string; name: string }[] = [];
        for (const p of participants) {
            for (const alias of p.aliases ?? []) candidates.push({ id: p.id, name: alias });
            if (p.name) candidates.push({ id: p.id, name: p.name });
        }
        // Sort by length descending to prevent partial replacements (e.g. "Al" replacing "Alice")
        candidates.sort((a, b) => b.name.length - a.name.length);

        for (const c of candidates) {
            if (!c.name) continue;
            const escaped = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            tokenized = tokenized.replace(new RegExp(`\\b${escaped}\\b`, 'g'), `{{character@${c.id}}}`);
        }

        return tokenized;
    };

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

                const memChatId = mem.interactionDataId || chatId;
                const chat = chatMap.get(memChatId);
                if (!chat) return false;

                const protagIds = chat.protagonistIds || [];
                if (protagIds.length === 0) return false;

                return protagIds.some(id => id === localProtagonistId);
            });

            if (filteredMems.length > 0) {
                result[chatId] = filteredMems;
            }
        }
        return result;
    }, [memories, localProtagonistId, chatMap]);

    const resolveChatInfo = (mem: Memory, fallbackChatId: string): { name: string; id: string } => {
        const id = mem.interactionDataId || fallbackChatId || 'unknown';
        const chat = chatMap.get(id);
        const name = chat?.name || 'Unknown Chat';
        return { name, id };
    };

    const handleStartEdit = (mem: Memory, fallbackChatId: string) => {
        setEditingId(mem.id);
        setEditTextContent(resolveMemoryDisplayText(mem, fallbackChatId));
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditTextContent('');
    };

    const handleSaveEdit = (originalTextContent: string, chatId: string) => {
        if (!editingId) return;

        const mems = memories[chatId];
        if (!mems) return;

        const targetMem = mems.find(m => m.id === editingId);
        if (!targetMem) return;

        const wasEdited = editTextContent !== resolveMemoryDisplayText(targetMem, chatId);
        const nextText = wasEdited
            ? retokenizeText(editTextContent, targetMem, chatId)
            : originalTextContent;

        setMemories(prev => {
            const next = { ...prev };
            next[chatId] = next[chatId].map(m => {
                if (m.id !== editingId) return m;
                const { embedding, ...rest } = m;
                return { ...rest, textContent: nextText, lastUpdatedTimestamp: Date.now() } as Memory;
            });
            return next;
        });
        setHasChanges(true);
        setEditingId(null);
        setEditTextContent('');
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
            setEditTextContent('');
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
        setEditTextContent('');
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
                                        {`💬 ${chatMap.get(key)?.name || key}`}
                                    </span>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {mems.map(mem => {
                                            const isEditing = editingId === mem.id;
                                            const { name: chatName, id: chatId } = resolveChatInfo(mem, key);
                                            const displayText = resolveMemoryDisplayText(mem, key);

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
                                                                value={editTextContent}
                                                                onChange={(e) => setEditTextContent(e.target.value)}
                                                                className="editor-textarea"
                                                                rows={4}
                                                            />
                                                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                                <button type="button" className="editor-button editor-button-cancel" onClick={handleCancelEdit}>Cancel</button>
                                                                <button
                                                                    type="button"
                                                                    className="editor-button editor-button-save"
                                                                    onClick={() => handleSaveEdit(mem.textContent || '', key)}
                                                                >
                                                                    Save
                                                                </button>
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
                                                                {displayText || "(Empty memory)"}
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
                                                                        onClick={() => handleStartEdit(mem, key)}
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