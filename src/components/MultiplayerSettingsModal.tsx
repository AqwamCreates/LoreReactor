// src/components/MultiplayerSettingsModal.tsx
import { useState, useCallback, useMemo, useEffect } from 'react';
import type { Character, InteractionData, MultiplayerData } from '../types';
import { useSessionStore } from '../hooks/useSessionStore';
import { useMultiplayerDataManager } from '../hooks/useMultiplayerDataManager';
import { createDefaultMultiplayerData } from '../dictionaries/defaults';
import { useToast } from '../context/ToastContext';
import '../main.css';

interface MultiplayerSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    interactionData: InteractionData | null;
    allCharacters: Character[];
}

type TabId = 'access' | 'accounts' | 'protagonists';

export function MultiplayerSettingsModal({
    isOpen,
    onClose,
    interactionData,
    allCharacters,
}: MultiplayerSettingsModalProps) {
    const { addToast } = useToast();
    const multiplayerData = useSessionStore(s => s.multiplayerData);
    const currentAccountId = useSessionStore(s => s.currentAccountId);
    const { save, loadForChat } = useMultiplayerDataManager();

    const [activeTab, setActiveTab] = useState<TabId>('access');
    const [password, setPassword] = useState('');
    const [newAccountId, setNewAccountId] = useState('');
    const [selectedListTarget, setSelectedListTarget] = useState<'white' | 'black' | 'pending' | 'admin'>('white');
    const [accountCharAssignments, setAccountCharAssignments] = useState<Record<string, string[]>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    // Load multiplayer data for this chat when modal opens (fire-and-forget)
    useEffect(() => {
        if (!isOpen || !interactionData?.id) return;
        loadForChat(interactionData.id);
    }, [isOpen, interactionData?.id]);

    // Sync local state when multiplayerData changes
    useEffect(() => {
        if (multiplayerData) {
            setPassword(multiplayerData.password || '');
            setAccountCharAssignments(multiplayerData.accountIdCharacterIds || {});
        } else {
            setPassword('');
            setAccountCharAssignments({});
        }
    }, [multiplayerData]);

    const isAdmin = useMemo(() => {
        if (!multiplayerData || !currentAccountId) return true;
        return multiplayerData.administratorAccountIds.includes(currentAccountId);
    }, [multiplayerData, currentAccountId]);

    const handleSave = useCallback(async () => {
        if (!interactionData) return;
        setIsSaving(true);
        try {
            let md: MultiplayerData = multiplayerData
                ? { ...multiplayerData }
                : createDefaultMultiplayerData();

            md.password = password;
            md.accountIdCharacterIds = accountCharAssignments;

            if (!md.interactionDataIds.includes(interactionData.id)) {
                md.interactionDataIds = [...md.interactionDataIds, interactionData.id];
            }

            md.lastUpdatedTimestamp = Date.now();

            await save(md);
            addToast('Multiplayer settings saved.', 'success');
        } catch (e) {
            addToast(`Failed to save: ${(e as Error).message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    }, [interactionData, multiplayerData, password, accountCharAssignments, save, addToast]);

    const addAccountToList = useCallback((list: 'white' | 'black' | 'pending' | 'admin', accountId: string) => {
        if (!accountId.trim()) return;
        const trimmed = accountId.trim();
        const fieldMap = {
            white: 'whiteListedAccountIds',
            black: 'blacklistedAccountIds',
            pending: 'pendingAccountIds',
            admin: 'administratorAccountIds',
        } as const;
        const field = fieldMap[list];

        let md: MultiplayerData = multiplayerData
            ? { ...multiplayerData }
            : createDefaultMultiplayerData();

        if (md[field].includes(trimmed)) {
            addToast('Account already in list.', 'info');
            return;
        }

        md = { ...md, [field]: [...md[field], trimmed], lastUpdatedTimestamp: Date.now() };
        save(md);
        setNewAccountId('');
        addToast(`Account added to ${list === 'white' ? 'whitelist' : list === 'black' ? 'blacklist' : list === 'pending' ? 'pending' : 'admins'}.`, 'success');
    }, [multiplayerData, save, addToast]);

    const removeAccountFromList = useCallback((list: 'white' | 'black' | 'pending' | 'admin', accountId: string) => {
        if (!multiplayerData) return;
        const fieldMap = {
            white: 'whiteListedAccountIds',
            black: 'blacklistedAccountIds',
            pending: 'pendingAccountIds',
            admin: 'administratorAccountIds',
        } as const;
        const field = fieldMap[list];
        const updated = { ...multiplayerData, [field]: multiplayerData[field].filter(id => id !== accountId), lastUpdatedTimestamp: Date.now() };
        save(updated);
        addToast('Account removed.', 'info');
    }, [multiplayerData, save, addToast]);

    const toggleCharacterAssignment = useCallback((accountId: string, charId: string) => {
        setAccountCharAssignments(prev => {
            const current = prev[accountId] || [];
            const next = current.includes(charId)
                ? current.filter(id => id !== charId)
                : [...current, charId];
            return { ...prev, [accountId]: next };
        });
    }, []);

    const approvePendingAccount = useCallback((accountId: string) => {
        if (!multiplayerData) return;
        const updated = {
            ...multiplayerData,
            pendingAccountIds: multiplayerData.pendingAccountIds.filter(id => id !== accountId),
            whiteListedAccountIds: [...multiplayerData.whiteListedAccountIds, accountId],
            lastUpdatedTimestamp: Date.now(),
        };
        save(updated);
        addToast(`Approved ${accountId}.`, 'success');
    }, [multiplayerData, save, addToast]);

    const rejectPendingAccount = useCallback((accountId: string) => {
        if (!multiplayerData) return;
        const updated = {
            ...multiplayerData,
            pendingAccountIds: multiplayerData.pendingAccountIds.filter(id => id !== accountId),
            blacklistedAccountIds: [...multiplayerData.blacklistedAccountIds, accountId],
            lastUpdatedTimestamp: Date.now(),
        };
        save(updated);
        addToast(`Rejected and blocked ${accountId}.`, 'info');
    }, [multiplayerData, save, addToast]);

    if (!isOpen) return null;

    const tabs: { id: TabId; icon: string; label: string }[] = [
        { id: 'access', icon: '🔒', label: 'Access Control' },
        { id: 'accounts', icon: '👥', label: 'Accounts' },
        { id: 'protagonists', icon: '🎭', label: 'Protagonist Assignment' },
    ];

    const listSectionStyle: React.CSSProperties = { padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--social-bg)' };
    const chipStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', padding: '4px 10px', borderRadius: '12px', background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)', fontWeight: 'bold', whiteSpace: 'nowrap' };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px' }}>
                <div className="modal-header">
                    <h2>👥 Multiplayer Settings</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-save" onClick={handleSave} disabled={isSaving} style={{ fontSize: '0.75rem' }}>
                            {isSaving ? 'Saving...' : '💾 Save'}
                        </button>
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose} style={{ fontSize: '0.75rem' }}>Close</button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '4px', padding: '0 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                    {tabs.map(tab => (
                        <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                            className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                            style={{ fontSize: '0.7rem', padding: '8px 12px' }}>
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                <div className="modal-body editor-modal-body">
                    {/* ─── ACCESS CONTROL TAB ─── */}
                    {activeTab === 'access' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, lineHeight: 1.5 }}>
                                Configure how other users can join this chat session. A password restricts access to those who know it. Without a password, anyone with the link can join (subject to whitelist/blacklist rules).
                            </div>

                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Session Password</div>
                                <div style={{ fontSize: '0.7rem', opacity: 0.5, marginBottom: '8px' }}>Leave empty for open access. Set a password for invite-only sessions.</div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        placeholder="No password (open access)"
                                        className="editor-input"
                                        style={{ flex: 1, fontSize: '0.8rem', padding: '8px 12px' }}
                                    />
                                    <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowPassword(!showPassword)} style={{ fontSize: '0.7rem', padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                        {showPassword ? '🙈 Hide' : '👁️ Show'}
                                    </button>
                                    {password && (
                                        <button type="button" className="editor-button editor-button-cancel" onClick={() => setPassword('')} style={{ fontSize: '0.7rem', padding: '8px 12px', whiteSpace: 'nowrap', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
                                            Clear
                                        </button>
                                    )}
                                </div>
                                {password && (
                                    <div style={{ marginTop: '8px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', fontSize: '0.7rem', color: '#22c55e' }}>
                                        🔒 Password protected — only users with the password can join
                                    </div>
                                )}
                            </div>

                            <div className="editor-section" style={{ margin: 0 }}>
                                <div className="editor-section-title">Session Info</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem' }}>
                                    <div style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                                        <div style={{ opacity: 0.5, fontSize: '0.65rem', marginBottom: '2px' }}>Multiplayer Data ID</div>
                                        <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{multiplayerData?.id || 'Not created yet'}</div>
                                    </div>
                                    <div style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                                        <div style={{ opacity: 0.5, fontSize: '0.65rem', marginBottom: '2px' }}>Linked Chats</div>
                                        <div>{multiplayerData?.interactionDataIds?.length ?? 0} chat{multiplayerData?.interactionDataIds?.length !== 1 ? 's' : ''}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── ACCOUNTS TAB ─── */}
                    {activeTab === 'accounts' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, lineHeight: 1.5 }}>
                                Manage which accounts can access this session. Whitelisted accounts are auto-approved. Blacklisted accounts are auto-blocked. Pending accounts have requested access and await your decision.
                            </div>

                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <select value={selectedListTarget} onChange={e => setSelectedListTarget(e.target.value as typeof selectedListTarget)} className="editor-input" style={{ width: '130px', fontSize: '0.7rem', padding: '6px 8px' }}>
                                    <option value="white">✅ Whitelist</option>
                                    <option value="black">🚫 Blacklist</option>
                                    <option value="admin">⭐ Admin</option>
                                </select>
                                <input type="text" value={newAccountId} onChange={e => setNewAccountId(e.target.value)} placeholder="Account ID..." className="editor-input" style={{ flex: 1, minWidth: '120px', fontSize: '0.7rem', padding: '6px 8px' }} onKeyDown={e => { if (e.key === 'Enter') addAccountToList(selectedListTarget, newAccountId); }} />
                                <button type="button" className="editor-button editor-button-save" onClick={() => addAccountToList(selectedListTarget, newAccountId)} disabled={!newAccountId.trim()} style={{ fontSize: '0.7rem', padding: '6px 12px' }}>Add</button>
                            </div>

                            {(multiplayerData?.pendingAccountIds?.length ?? 0) > 0 && (
                                <div className="editor-section" style={{ margin: 0, borderColor: 'rgba(234,179,8,0.3)' }}>
                                    <div className="editor-section-title" style={{ color: '#ca8a04' }}>⏳ Pending Requests ({multiplayerData!.pendingAccountIds.length})</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {multiplayerData!.pendingAccountIds.map(accountId => (
                                            <div key={accountId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                                                <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{accountId}</span>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <button type="button" className="editor-button editor-button-save" onClick={() => approvePendingAccount(accountId)} style={{ fontSize: '0.65rem', padding: '4px 10px' }}>✅ Approve</button>
                                                    <button type="button" className="editor-button editor-button-cancel" onClick={() => rejectPendingAccount(accountId)} style={{ fontSize: '0.65rem', padding: '4px 10px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>🚫 Reject</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div style={listSectionStyle}>
                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '8px' }}>✅ Whitelist ({multiplayerData?.whiteListedAccountIds?.length ?? 0})</div>
                                <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '8px' }}>Auto-approved accounts that can join without waiting.</div>
                                {(multiplayerData?.whiteListedAccountIds?.length ?? 0) === 0 && <div style={{ fontSize: '0.7rem', opacity: 0.4, fontStyle: 'italic' }}>No whitelisted accounts.</div>}
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {multiplayerData?.whiteListedAccountIds?.map(id => (
                                        <span key={id} style={chipStyle}>{id}<span onClick={() => removeAccountFromList('white', id)} style={{ cursor: 'pointer', marginLeft: '2px', opacity: 0.6 }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}>✕</span></span>
                                    ))}
                                </div>
                            </div>

                            <div style={listSectionStyle}>
                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '8px' }}>🚫 Blacklist ({multiplayerData?.blacklistedAccountIds?.length ?? 0})</div>
                                <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '8px' }}>Blocked accounts that cannot join.</div>
                                {(multiplayerData?.blacklistedAccountIds?.length ?? 0) === 0 && <div style={{ fontSize: '0.7rem', opacity: 0.4, fontStyle: 'italic' }}>No blacklisted accounts.</div>}
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {multiplayerData?.blacklistedAccountIds?.map(id => (
                                        <span key={id} style={{ ...chipStyle, background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>{id}<span onClick={() => removeAccountFromList('black', id)} style={{ cursor: 'pointer', marginLeft: '2px', opacity: 0.6 }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}>✕</span></span>
                                    ))}
                                </div>
                            </div>

                            <div style={listSectionStyle}>
                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '8px' }}>⭐ Administrators ({multiplayerData?.administratorAccountIds?.length ?? 0})</div>
                                <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '8px' }}>Accounts with full control over session settings.</div>
                                {(multiplayerData?.administratorAccountIds?.length ?? 0) === 0 && <div style={{ fontSize: '0.7rem', opacity: 0.4, fontStyle: 'italic' }}>No administrators besides host.</div>}
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    {multiplayerData?.administratorAccountIds?.map(id => (
                                        <span key={id} style={{ ...chipStyle, background: 'rgba(234,179,8,0.1)', color: '#ca8a04', borderColor: 'rgba(234,179,8,0.3)' }}>{id}<span onClick={() => removeAccountFromList('admin', id)} style={{ cursor: 'pointer', marginLeft: '2px', opacity: 0.6 }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}>✕</span></span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── PROTAGONIST ASSIGNMENT TAB ─── */}
                    {activeTab === 'protagonists' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6, lineHeight: 1.5 }}>
                                Assign protagonist characters to accounts. Each account controls only their assigned protagonists during the session. Unassigned protagonists default to the first available account.
                            </div>

                            {!interactionData?.protagonists?.length && (
                                <div style={{ textAlign: 'center', padding: '30px', opacity: 0.5, fontSize: '0.8rem' }}>No protagonists in this chat session.</div>
                            )}

                            {interactionData?.protagonists?.map(protag => {
                                const assignedAccounts = Object.entries(accountCharAssignments)
                                    .filter(([_, charIds]) => charIds.includes(protag.id))
                                    .map(([accountId]) => accountId);

                                return (
                                    <div key={protag.id} className="editor-section" style={{ margin: 0 }}>
                                        <div className="editor-section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            🎭 {protag.name}
                                            <span style={{ fontSize: '0.6rem', opacity: 0.4, fontFamily: 'monospace' }}>{protag.id.slice(0, 8)}</span>
                                        </div>
                                        <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '8px' }}>
                                            Assigned to: {assignedAccounts.length > 0 ? assignedAccounts.join(', ') : 'Unassigned'}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {[...new Set([
                                                ...(multiplayerData?.whiteListedAccountIds ?? []),
                                                ...(multiplayerData?.administratorAccountIds ?? []),
                                                ...(multiplayerData?.pendingAccountIds ?? []),
                                                ...(Object.keys(accountCharAssignments)),
                                                ...(currentAccountId ? [currentAccountId] : []),
                                            ])].map(accountId => {
                                                const isAssigned = (accountCharAssignments[accountId] || []).includes(protag.id);
                                                return (
                                                    <label key={accountId} className="editor-checkbox-label" style={{ margin: 0, padding: '6px 10px', borderRadius: '6px', border: `1px solid ${isAssigned ? 'var(--accent)' : 'var(--border)'}`, background: isAssigned ? 'var(--accent-bg)' : 'transparent', transition: 'all 0.15s' }}>
                                                        <input type="checkbox" checked={isAssigned} onChange={() => toggleCharacterAssignment(accountId, protag.id)} className="editor-checkbox-input" />
                                                        <span style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{accountId}</span>
                                                    </label>
                                                );
                                            })}
                                            {[...new Set([
                                                ...(multiplayerData?.whiteListedAccountIds ?? []),
                                                ...(multiplayerData?.administratorAccountIds ?? []),
                                                ...(multiplayerData?.pendingAccountIds ?? []),
                                                ...(Object.keys(accountCharAssignments)),
                                                ...(currentAccountId ? [currentAccountId] : []),
                                            ])].length === 0 && (
                                                <div style={{ fontSize: '0.7rem', opacity: 0.4, fontStyle: 'italic' }}>No accounts configured yet. Add accounts in the Accounts tab first.</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}