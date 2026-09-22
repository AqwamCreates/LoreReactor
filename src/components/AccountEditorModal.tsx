// src/components/AccountEditorModal.tsx
import { useState } from 'react';
import type { Account } from '../types';
import { v4 as uuidv4 } from 'uuid';
import '../main.css';

interface AccountEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Account) => void;
    existingAccount?: Account | null;
}

export function AccountEditorModal({
    isOpen,
    onClose,
    onSave,
    existingAccount,
}: AccountEditorModalProps) {
    if (!isOpen) return null;

    const modalKey = `acct-${existingAccount?.id ?? 'new'}`;

    return (
        <AccountEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingAccount={existingAccount}
        />
    );
}

function AccountEditorModalInner({
    onClose,
    onSave,
    existingAccount,
}: Omit<AccountEditorModalProps, 'isOpen'>) {
    const [name, setName] = useState(existingAccount?.name || '');
    const [username, setUsername] = useState(existingAccount?.username || '');
    const [password, setPassword] = useState(existingAccount?.password || '');
    const [url, setUrl] = useState(existingAccount?.url || '');
    const [errors, setErrors] = useState<{ name?: string; username?: string }>({});

    const validate = (): boolean => {
        const newErrors: { name?: string; username?: string } = {};
        if (!name.trim()) newErrors.name = 'Name is required';
        if (!username.trim()) newErrors.username = 'Username is required';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const buildAccountFromForm = (isNewClone: boolean): Account | null => {
        if (!validate()) return null;
        const now = Date.now();
        return {
            id: isNewClone ? uuidv4() : (existingAccount?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            username: username.trim(),
            password: password,
            url: url.trim() || undefined,
            firstCreatedTimestamp: isNewClone ? now : (existingAccount?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = () => {
        const account = buildAccountFromForm(false);
        if (!account) return;
        onSave(account);
        onClose();
    };

    const handleClone = () => {
        const cloned = buildAccountFromForm(true);
        if (!cloned) return;
        onSave(cloned);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingAccount ? 'Edit Account' : 'Create New Account'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        {existingAccount && (
                            <button type="button" className="editor-button editor-button-cancel" onClick={handleClone}>Clone</button>
                        )}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit}>Save</button>
                    </div>
                </div>
                <div className="modal-body editor-modal-body">
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Name <span style={{ color: '#ff4444' }}>*</span></label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => { setName(e.target.value); if (errors.name) setErrors(prev => ({ ...prev, name: undefined })); }}
                            className={`editor-input ${errors.name ? 'error' : ''}`}
                            placeholder="e.g., My Account"
                        />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Username <span style={{ color: '#ff4444' }}>*</span></label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => { setUsername(e.target.value); if (errors.username) setErrors(prev => ({ ...prev, username: undefined })); }}
                            className={`editor-input ${errors.username ? 'error' : ''}`}
                            placeholder="e.g., john_doe"
                        />
                        {errors.username && <div className="editor-error-message">{errors.username}</div>}
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="editor-input"
                            placeholder="Account password"
                        />
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">URL</label>
                        <input
                            type="text"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            className="editor-input"
                            placeholder="e.g., https://example.com"
                        />
                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                            Optional server URL for this account.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}