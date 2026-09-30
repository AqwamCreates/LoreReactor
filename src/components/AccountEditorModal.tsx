// src/components/AccountEditorModal.tsx
import { useState, useCallback } from 'react';
import type { Account, Character, LanguageModel } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { EntitySelectList } from './EntitySelectList';
import '../main.css';

interface AccountEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (account: Account) => void;
    existingAccount?: Account | null;
    allCharacters: Character[];
    allLanguageModels: LanguageModel[];
}

export function AccountEditorModal({
    isOpen,
    onClose,
    onSave,
    existingAccount,
    allCharacters,
    allLanguageModels,
}: AccountEditorModalProps) {
    if (!isOpen) return null;

    const modalKey = `acct-${existingAccount?.id ?? 'new'}`;

    return (
        <AccountEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingAccount={existingAccount}
            allCharacters={allCharacters}
            allLanguageModels={allLanguageModels}
        />
    );
}

function AccountEditorModalInner({
    onClose,
    onSave,
    existingAccount,
    allCharacters,
    allLanguageModels,
}: Omit<AccountEditorModalProps, 'isOpen'>) {
    const [name, setName] = useState(existingAccount?.name || '');
    const [username, setUsername] = useState(existingAccount?.username || '');
    const [password, setPassword] = useState(existingAccount?.password || '');
    const [url, setUrl] = useState(existingAccount?.url || '');
    const [sharedCharacterIds, setSharedCharacterIds] = useState<string[]>(existingAccount?.sharedCharacterIds || []);
    const [sharedLanguageModelIds, setSharedLanguageModelIds] = useState<string[]>(existingAccount?.sharedLanguageModelIds || []);
    
    const [errors, setErrors] = useState<{ name?: string; username?: string }>({});
    
    const [charSearchQuery, setCharSearchQuery] = useState('');
    const [modelSearchQuery, setModelSearchQuery] = useState('');

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
            sharedCharacterIds,
            sharedLanguageModelIds,
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

    const toggleSharedCharacter = useCallback((id: string) => {
        setSharedCharacterIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }, []);

    const toggleSharedLanguageModel = useCallback((id: string) => {
        setSharedLanguageModelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }, []);

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
                <div className="modal-body editor-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
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

                    <div>
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

                    <div>
                        <label className="editor-label">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="editor-input"
                            placeholder="Account password"
                        />
                    </div>

                    <div>
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

                    <div className="editor-section" style={{ margin: 0 }}>
                        <div className="editor-section-title">Shared Characters ({sharedCharacterIds.length})</div>
                        <div style={{ fontSize: '0.6rem', opacity: 0.6, marginBottom: '8px' }}>
                            Characters that can be shared with multiplayer joiners when this account is active.
                        </div>
                        <EntitySelectList
                            label="Characters"
                            items={allCharacters}
                            selectedIds={sharedCharacterIds}
                            onToggle={toggleSharedCharacter}
                            searchQuery={charSearchQuery}
                            onSearchChange={setCharSearchQuery}
                        />
                    </div>

                    <div className="editor-section" style={{ margin: 0 }}>
                        <div className="editor-section-title">Shared Language Models ({sharedLanguageModelIds.length})</div>
                        <div style={{ fontSize: '0.6rem', opacity: 0.6, marginBottom: '8px' }}>
                            Language models that can be shared with multiplayer joiners when this account is active.
                        </div>
                        <EntitySelectList
                            label="Models"
                            items={allLanguageModels}
                            selectedIds={sharedLanguageModelIds}
                            onToggle={toggleSharedLanguageModel}
                            searchQuery={modelSearchQuery}
                            onSearchChange={setModelSearchQuery}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}