// src/components/JoinSessionModal.tsx
import { useState, useCallback, useMemo } from 'react';
import type { Character } from '../types';
import { stripCharacterForSync } from '../utilities/multiplayerSync';
import { useToast } from '../context/ToastContext';
import '../main.css';

interface JoinSessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    allCharacters: Character[];
    onJoin: (sessionId: string, password: string, protagonist: Character) => void;
}

export function JoinSessionModal({
    isOpen,
    onClose,
    allCharacters,
    onJoin,
}: JoinSessionModalProps) {
    const { addToast } = useToast();
    const [sessionId, setSessionId] = useState('');
    const [password, setPassword] = useState('');
    const [selectedCharacterId, setSelectedCharacterId] = useState<string>('');
    const [showPassword, setShowPassword] = useState(false);

    const selectedCharacter = useMemo(
        () => allCharacters.find(c => c.id === selectedCharacterId) ?? null,
        [allCharacters, selectedCharacterId],
    );

    const handleJoin = useCallback(() => {
        if (!sessionId.trim()) {
            addToast('Enter a session ID.', 'error');
            return;
        }
        if (!selectedCharacter) {
            addToast('Select a protagonist character.', 'error');
            return;
        }
        const stripped = stripCharacterForSync(selectedCharacter);
        onJoin(sessionId.trim(), password, stripped);
        setSessionId('');
        setPassword('');
        setSelectedCharacterId('');
        onClose();
    }, [sessionId, password, selectedCharacter, onJoin, onClose, addToast]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                <div className="modal-header">
                    <h2>Join Session</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose} style={{ fontSize: '0.75rem' }}>Cancel</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="editor-section" style={{ margin: 0 }}>
                        <div className="editor-section-title">Session ID</div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '8px' }}>Paste the multiplayer data UUID from the host.</div>
                        <input
                            type="text"
                            value={sessionId}
                            onChange={e => setSessionId(e.target.value)}
                            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                            className="editor-input"
                            style={{ width: '100%', fontSize: '0.8rem', padding: '8px 12px', fontFamily: 'monospace' }}
                            onKeyDown={e => { if (e.key === 'Enter') handleJoin(); }}
                        />
                    </div>

                    <div className="editor-section" style={{ margin: 0 }}>
                        <div className="editor-section-title">Password</div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '8px' }}>Leave empty if the session has no password.</div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="No password"
                                className="editor-input"
                                style={{ flex: 1, fontSize: '0.8rem', padding: '8px 12px' }}
                                onKeyDown={e => { if (e.key === 'Enter') handleJoin(); }}
                            />
                            <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowPassword(!showPassword)} style={{ fontSize: '0.7rem', padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                {showPassword ? '🙈 Hide' : '👁️ Show'}
                            </button>
                        </div>
                    </div>

                    <div className="editor-section" style={{ margin: 0 }}>
                        <div className="editor-section-title">Protagonist</div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '8px' }}>Choose which character you will play as in this session.</div>
                        {allCharacters.length === 0 && (
                            <div style={{ fontSize: '0.75rem', opacity: 0.4, fontStyle: 'italic' }}>No characters available. Create one first.</div>
                        )}
                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
                            {allCharacters.map(char => (
                                <div
                                    key={char.id}
                                    onClick={() => setSelectedCharacterId(char.id)}
                                    style={{
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid var(--border)',
                                        background: selectedCharacterId === char.id ? 'var(--accent-bg)' : 'transparent',
                                        borderLeft: selectedCharacterId === char.id ? '3px solid var(--accent)' : '3px solid transparent',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <div style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>{char.name}</div>
                                    {char.description && <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{char.description}</div>}
                                </div>
                            ))}
                        </div>
                    </div>

                    <button
                        type="button"
                        className="editor-button editor-button-save"
                        onClick={handleJoin}
                        disabled={!sessionId.trim() || !selectedCharacter}
                        style={{ width: '100%', fontSize: '0.85rem', padding: '10px' }}
                    >
                        Join Session
                    </button>
                </div>
            </div>
        </div>
    );
}