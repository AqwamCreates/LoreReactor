// src/components/PendingJoinRequests.tsx
import { useEffect, useState } from 'react';
import type { PendingJoinRequest } from '../hooks/useMultiplayerSync';

interface PendingJoinRequestsProps {
    pendingRequests: PendingJoinRequest[];
    onAccept: (accountId: string) => void;
    onReject: (accountId: string) => void;
}

export function PendingJoinRequests({ pendingRequests, onAccept, onReject }: PendingJoinRequestsProps) {
    const [visible, setVisible] = useState(false);

    // Show panel when new requests arrive, hide when all cleared
    useEffect(() => {
        if (pendingRequests.length > 0) {
            setVisible(true);
        } else {
            setVisible(false);
        }
    }, [pendingRequests.length]);

    if (!visible || pendingRequests.length === 0) return null;

    return (
        <div className="pending-requests-panel" style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '16px',
            maxWidth: '320px',
            zIndex: 9999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '14px' }}>
                    Join Requests ({pendingRequests.length})
                </h3>
                <button
                    onClick={() => setVisible(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--text)' }}
                >
                    ×
                </button>
            </div>
            {pendingRequests.map(req => (
                <div key={req.accountId} style={{
                    padding: '8px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    fontSize: '12px',
                }}>
                    <div style={{ marginBottom: '8px', fontFamily: 'monospace' }}>
                        {req.accountId.substring(0, 8)}...
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => onAccept(req.accountId)}
                            style={{
                                flex: 1,
                                padding: '6px',
                                background: 'var(--accent)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Accept
                        </button>
                        <button
                            onClick={() => onReject(req.accountId)}
                            style={{
                                flex: 1,
                                padding: '6px',
                                background: 'var(--danger)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            Reject
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}