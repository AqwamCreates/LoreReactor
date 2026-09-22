// src/components/MultiplayerEditorModal.tsx
import { useState, useCallback } from 'react';
import type { MultiplayerData, Account } from '../types';
import { v4 as uuidv4 } from 'uuid';
import '../main.css';

interface MultiplayerEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: MultiplayerData) => void;
    existingMultiplayerData?: MultiplayerData | null;
    allAccounts: Account[];
}

export function MultiplayerEditorModal({
    isOpen,
    onClose,
    onSave,
    existingMultiplayerData,
    allAccounts,
}: MultiplayerEditorModalProps) {
    if (!isOpen) return null;

    const modalKey = `mp-${existingMultiplayerData?.id ?? 'new'}`;

    return (
        <MultiplayerEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingMultiplayerData={existingMultiplayerData}
            allAccounts={allAccounts}
        />
    );
}

function MultiplayerEditorModalInner({
    onClose,
    onSave,
    existingMultiplayerData,
    allAccounts,
}: Omit<MultiplayerEditorModalProps, 'isOpen'>) {
    const [name, setName] = useState(existingMultiplayerData?.name || '');
    const [description, setDescription] = useState(existingMultiplayerData?.description || '');
    const [password, setPassword] = useState(existingMultiplayerData?.password || '');
    const [interactionDataIds, setInteractionDataIds] = useState<string[]>(existingMultiplayerData?.interactionDataIds || []);
    const [whiteListedAccountIds, setWhiteListedAccountIds] = useState<string[]>(existingMultiplayerData?.whiteListedAccountIds || []);
    const [blacklistedAccountIds, setBlacklistedAccountIds] = useState<string[]>(existingMultiplayerData?.blacklistedAccountIds || []);
    const [pendingAccountIds, setPendingAccountIds] = useState<string[]>(existingMultiplayerData?.pendingAccountIds || []);
    const [administratorAccountIds, setAdministratorAccountIds] = useState<string[]>(existingMultiplayerData?.administratorAccountIds || []);
    const [accountIdCharacterIds, setAccountIdCharacterIds] = useState<Record<string, string[]>>(existingMultiplayerData?.accountIdCharacterIds || {});
    const [errors, setErrors] = useState<{ name?: string }>({});

    // For adding account-character mappings
    const [selectedMappingAccountId, setSelectedMappingAccountId] = useState('');
    const [mappingCharacterIdInput, setMappingCharacterIdInput] = useState('');

    const validate = (): boolean => {
        const newErrors: { name?: string } = {};
        if (!name.trim()) newErrors.name = 'Name is required';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const buildFromForm = (isNewClone: boolean): MultiplayerData | null => {
        if (!validate()) return null;
        const now = Date.now();
        return {
            id: isNewClone ? uuidv4() : (existingMultiplayerData?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            password,
            interactionDataIds,
            whiteListedAccountIds,
            blacklistedAccountIds,
            pendingAccountIds,
            administratorAccountIds,
            accountIdCharacterIds,
            firstCreatedTimestamp: isNewClone ? now : (existingMultiplayerData?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = () => {
        const data = buildFromForm(false);
        if (!data) return;
        onSave(data);
        onClose();
    };

    const handleClone = () => {
        const cloned = buildFromForm(true);
        if (!cloned) return;
        onSave(cloned);
        onClose();
    };

    const handleAddMapping = useCallback(() => {
        if (!selectedMappingAccountId || !mappingCharacterIdInput.trim()) return;
        setAccountIdCharacterIds(prev => {
            const existing = prev[selectedMappingAccountId] || [];
            if (existing.includes(mappingCharacterIdInput.trim())) return prev;
            return { ...prev, [selectedMappingAccountId]: [...existing, mappingCharacterIdInput.trim()] };
        });
        setMappingCharacterIdInput('');
    }, [selectedMappingAccountId, mappingCharacterIdInput]);

    const handleRemoveMappingChar = useCallback((accountId: string, charId: string) => {
        setAccountIdCharacterIds(prev => {
            const existing = prev[accountId];
            if (!existing) return prev;
            const filtered = existing.filter(c => c !== charId);
            if (filtered.length === 0) {
                const next = { ...prev };
                delete next[accountId];
                return next;
            }
            return { ...prev, [accountId]: filtered };
        });
    }, []);

    const handleRemoveMappingAccount = useCallback((accountId: string) => {
        setAccountIdCharacterIds(prev => {
            const next = { ...prev };
            delete next[accountId];
            return next;
        });
    }, []);

    const accountNameMap = new Map(allAccounts.map(a => [a.id, a.name]));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingMultiplayerData ? 'Edit Multiplayer Data' : 'Create New Multiplayer Data'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        {existingMultiplayerData && (
                            <button type="button" className="editor-button editor-button-cancel" onClick={handleClone}>Clone</button>
                        )}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit}>Save</button>
                    </div>
                </div>
                <div className="modal-body editor-modal-body">
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Name <span style={{ color: '#ff4444' }}>*</span></label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => { setName(e.target.value); if (errors.name) setErrors({}); }}
                            className={`editor-input ${errors.name ? 'error' : ''}`}
                            placeholder="e.g., Main Session"
                        />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Description</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            className="editor-textarea"
                            placeholder="Describe this multiplayer session"
                            rows={2}
                        />
                    </div>

                    {/* Password */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="editor-input"
                            placeholder="Leave empty for open access"
                        />
                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                            Invite-only when set. Empty = accessible to all.
                        </div>
                    </div>

                    {/* Interaction Data IDs */}
                    <div className="editor-section">
                        <div className="editor-section-title">Linked Sessions ({interactionDataIds.length})</div>
                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '8px' }}>
                            Interaction data IDs associated with this multiplayer session.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '100px', overflowY: 'auto', marginBottom: '6px' }}>
                            {interactionDataIds.map(id => (
                                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                                    <span style={{ flex: 1, fontSize: '0.65rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id}</span>
                                    <button type="button" onClick={() => setInteractionDataIds(prev => prev.filter(x => x !== id))} className="toolbar-button" style={{ width: '18px', height: '18px', fontSize: '0.6rem', color: '#ff4444', padding: 0 }}>×</button>
                                </div>
                            ))}
                            {interactionDataIds.length === 0 && <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic' }}>No linked sessions.</div>}
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <input
                                type="text"
                                placeholder="Session ID..."
                                className="editor-input"
                                style={{ flex: 1, fontSize: '0.7rem', padding: '4px 6px' }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        const val = (e.target as HTMLInputElement).value.trim();
                                        if (val && !interactionDataIds.includes(val)) {
                                            setInteractionDataIds(prev => [...prev, val]);
                                            (e.target as HTMLInputElement).value = '';
                                        }
                                    }
                                }}
                            />
                        </div>
                    </div>

                    {/* Account Lists */}
                    <div className="editor-section">
                        <div className="editor-section-title">Access Control</div>
                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '8px' }}>
                            Click account names to toggle between lists. Accounts can only be in one list at a time.
                        </div>

                        {allAccounts.length === 0 && (
                            <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic', padding: '4px 0' }}>No accounts available. Create accounts first.</div>
                        )}

                        {allAccounts.map(account => {
                            const isWhitelisted = whiteListedAccountIds.includes(account.id);
                            const isBlacklisted = blacklistedAccountIds.includes(account.id);
                            const isPending = pendingAccountIds.includes(account.id);
                            const isAdmin = administratorAccountIds.includes(account.id);

                            let statusLabel = 'Unassigned';
                            let statusColor = 'rgba(255,255,255,0.3)';
                            if (isAdmin) { statusLabel = 'Admin'; statusColor = '#f59e0b'; }
                            else if (isWhitelisted) { statusLabel = 'Whitelisted'; statusColor = '#4ade80'; }
                            else if (isBlacklisted) { statusLabel = 'Blacklisted'; statusColor = '#ef4444'; }
                            else if (isPending) { statusLabel = 'Pending'; statusColor = '#60a5fa'; }

                            return (
                                <div key={account.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', marginBottom: '4px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                                    <span style={{ flex: 1, fontSize: '0.7rem' }}>{account.name}</span>
                                    <span style={{ fontSize: '0.6rem', color: statusColor, fontWeight: 'bold', minWidth: '70px', textAlign: 'right' }}>{statusLabel}</span>
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                        <button type="button" onClick={() => {
                                            setWhiteListedAccountIds(prev => prev.includes(account.id) ? prev.filter(x => x !== account.id) : [...prev.filter(x => x !== account.id), account.id]);
                                            setBlacklistedAccountIds(prev => prev.filter(x => x !== account.id));
                                            setPendingAccountIds(prev => prev.filter(x => x !== account.id));
                                            setAdministratorAccountIds(prev => prev.filter(x => x !== account.id));
                                        }} className="toolbar-button" style={{ fontSize: '0.55rem', padding: '1px 5px', color: isWhitelisted ? '#4ade80' : 'rgba(255,255,255,0.4)' }} title="Whitelist">W</button>
                                        <button type="button" onClick={() => {
                                            setBlacklistedAccountIds(prev => prev.includes(account.id) ? prev.filter(x => x !== account.id) : [...prev.filter(x => x !== account.id), account.id]);
                                            setWhiteListedAccountIds(prev => prev.filter(x => x !== account.id));
                                            setPendingAccountIds(prev => prev.filter(x => x !== account.id));
                                            setAdministratorAccountIds(prev => prev.filter(x => x !== account.id));
                                        }} className="toolbar-button" style={{ fontSize: '0.55rem', padding: '1px 5px', color: isBlacklisted ? '#ef4444' : 'rgba(255,255,255,0.4)' }} title="Blacklist">B</button>
                                        <button type="button" onClick={() => {
                                            setPendingAccountIds(prev => prev.includes(account.id) ? prev.filter(x => x !== account.id) : [...prev.filter(x => x !== account.id), account.id]);
                                            setWhiteListedAccountIds(prev => prev.filter(x => x !== account.id));
                                            setBlacklistedAccountIds(prev => prev.filter(x => x !== account.id));
                                            setAdministratorAccountIds(prev => prev.filter(x => x !== account.id));
                                        }} className="toolbar-button" style={{ fontSize: '0.55rem', padding: '1px 5px', color: isPending ? '#60a5fa' : 'rgba(255,255,255,0.4)' }} title="Pending">P</button>
                                        <button type="button" onClick={() => {
                                            setAdministratorAccountIds(prev => prev.includes(account.id) ? prev.filter(x => x !== account.id) : [...prev.filter(x => x !== account.id), account.id]);
                                            setWhiteListedAccountIds(prev => prev.filter(x => x !== account.id));
                                            setBlacklistedAccountIds(prev => prev.filter(x => x !== account.id));
                                            setPendingAccountIds(prev => prev.filter(x => x !== account.id));
                                        }} className="toolbar-button" style={{ fontSize: '0.55rem', padding: '1px 5px', color: isAdmin ? '#f59e0b' : 'rgba(255,255,255,0.4)' }} title="Admin">A</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Account-Character Mappings */}
                    <div className="editor-section">
                        <div className="editor-section-title">Account → Character Mappings</div>
                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '8px' }}>
                            Map each account to the character IDs they control as protagonists.
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto', marginBottom: '8px' }}>
                            {Object.entries(accountIdCharacterIds).map(([accountId, charIds]) => (
                                <div key={accountId} style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>{accountNameMap.get(accountId) || accountId}</span>
                                        <button type="button" onClick={() => handleRemoveMappingAccount(accountId)} className="toolbar-button" style={{ fontSize: '0.55rem', padding: '1px 5px', color: '#ff4444' }} title="Remove all mappings for this account">×</button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                        {charIds.map(charId => (
                                            <span key={charId} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '1px 6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', fontSize: '0.6rem', fontFamily: 'monospace' }}>
                                                {charId.substring(0, 8)}…
                                                <button type="button" onClick={() => handleRemoveMappingChar(accountId, charId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff4444', fontSize: '0.6rem', padding: 0, lineHeight: 1 }}>×</button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            {Object.keys(accountIdCharacterIds).length === 0 && (
                                <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic' }}>No mappings configured.</div>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '4px' }}>
                            <select
                                value={selectedMappingAccountId}
                                onChange={e => setSelectedMappingAccountId(e.target.value)}
                                className="editor-select"
                                style={{ flex: 1, fontSize: '0.7rem' }}
                            >
                                <option value="">Select account...</option>
                                {allAccounts.map(a => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>
                            <input
                                type="text"
                                value={mappingCharacterIdInput}
                                onChange={e => setMappingCharacterIdInput(e.target.value)}
                                className="editor-input"
                                placeholder="Character ID..."
                                style={{ flex: 1, fontSize: '0.7rem', padding: '4px 6px' }}
                                onKeyDown={e => { if (e.key === 'Enter') handleAddMapping(); }}
                            />
                            <button type="button" onClick={handleAddMapping} className="toolbar-button" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>+</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}