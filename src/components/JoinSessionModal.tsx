// src/components/JoinSessionModal.tsx
import { useState, useCallback } from 'react';
import type { Character } from '../types';
import { useToast } from '../context/ToastContext';
import '../main.css';

interface JoinSessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    allCharacters: Character[];
    onJoin: (sessionId: string, password: string, requestedCharacterId: string | null, requestedCharacterData: Character | null) => void;
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
    const [showPassword, setShowPassword] = useState(false);
    const [selectedCharId, setSelectedCharId] = useState('');

    const handleJoin = useCallback(() => {
        if (!sessionId.trim()) {
            addToast('Enter a session ID.', 'error');
            return;
        }
        if (!selectedCharId) {
            addToast('Select a character to play as.', 'error');
            return;
        }
        
        const selectedChar = allCharacters.find(c => c.id === selectedCharId) || null;

        // Pass null for ID, and the full character object as data so the host saves it to isolated storage
        onJoin(sessionId.trim(), password, null, selectedChar);
        
        // Reset state
        setSessionId('');
        setPassword('');
        setSelectedCharId('');
        onClose();
    }, [sessionId, password, selectedCharId, allCharacters, onJoin, onClose, addToast]);

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
                        <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '8px' }}>Paste the Chat Session ID from the host.</div>
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
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="Leave empty if none"
                                className="editor-input"
                                style={{ flex: 1, fontSize: '0.8rem', padding: '8px 12px' }}
                                onKeyDown={e => { if (e.key === 'Enter') handleJoin(); }}
                            />
                            <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowPassword(!showPassword)} style={{ fontSize: '0.7rem', padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                {showPassword ? '🙈' : '👁️'}
                            </button>
                        </div>
                    </div>

                    <div className="editor-section" style={{ margin: 0 }}>
                        <div className="editor-section-title">Select Your Character</div>
                        <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '8px' }}>Choose a character from your local library to bring into the session.</div>
                        
                        <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
                            {allCharacters.length === 0 && (
                                <div style={{ padding: '16px', fontSize: '0.75rem', opacity: 0.5, textAlign: 'center' }}>
                                    No local characters found. Create one first.
                                </div>
                            )}
                            {allCharacters.map(char => (
                                <div 
                                    key={char.id} 
                                    onClick={() => setSelectedCharId(char.id)} 
                                    style={{ 
                                        padding: '10px 12px', 
                                        cursor: 'pointer', 
                                        borderBottom: '1px solid var(--border)', 
                                        background: selectedCharId === char.id ? 'var(--accent-bg)' : 'transparent', 
                                        borderLeft: selectedCharId === char.id ? '3px solid var(--accent)' : '3px solid transparent',
                                        transition: 'all 0.15s'
                                    }}
                                >
                                    <div style={{ fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '2px' }}>{char.name}</div>
                                    {char.description && (
                                        <div style={{ 
                                            fontSize: '0.7rem', 
                                            opacity: 0.7, 
                                            overflow: 'hidden', 
                                            textOverflow: 'ellipsis', 
                                            display: '-webkit-box', 
                                            WebkitLineClamp: 2, 
                                            WebkitBoxOrient: 'vertical',
                                            lineHeight: '1.4'
                                        }}>
                                            {char.description}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <button
                        type="button"
                        className="editor-button editor-button-save"
                        onClick={handleJoin}
                        disabled={!sessionId.trim() || !selectedCharId}
                        style={{ width: '100%', fontSize: '0.85rem', padding: '10px' }}
                    >
                        Join Session
                    </button>
                </div>
            </div>
        </div>
    );
}