// src/components/JoinSessionModal.tsx
import { useState, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import '../main.css';

interface JoinSessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onJoin: (sessionId: string, password: string, requestedCharacterId: string | null, requestedCharacterData: any | null) => void;
}

export function JoinSessionModal({
    isOpen,
    onClose,
    onJoin,
}: JoinSessionModalProps) {
    const { addToast } = useToast();
    const [sessionId, setSessionId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const handleJoin = useCallback(() => {
        if (!sessionId.trim()) {
            addToast('Enter a session ID.', 'error');
            return;
        }
        
        // Pass null for character data, selection happens after acceptance
        onJoin(sessionId.trim(), password, null, null);
        
        // Reset state
        setSessionId('');
        setPassword('');
        onClose();
    }, [sessionId, password, onJoin, onClose, addToast]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
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
                        <div style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: '6px' }}>
                            Character selection will occur after the host accepts your request.
                        </div>
                    </div>

                    <button
                        type="button"
                        className="editor-button editor-button-save"
                        onClick={handleJoin}
                        disabled={!sessionId.trim()}
                        style={{ width: '100%', fontSize: '0.85rem', padding: '10px' }}
                    >
                        Request to Join
                    </button>
                </div>
            </div>
        </div>
    );
}