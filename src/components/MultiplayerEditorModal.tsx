// src/components/MultiplayerEditorModal.tsx
import { useState, useCallback } from 'react';
import type { MultiplayerData, Character, RawInteractionData, MultiplayerDataAccountConfiguration } from '../types';
import type { PendingJoinRequest } from '../hooks/useMultiplayerSync';
import { v4 as uuidv4 } from 'uuid';
import { EntitySelectList } from './EntitySelectList';
import '../main.css';

type MultiplayerTabId = 'general' | 'accounts';

interface MultiplayerEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: MultiplayerData) => void;
    existingMultiplayerData?: MultiplayerData | null;
    allCharacters: Character[];
    rawChatShells: RawInteractionData[];
    pendingJoinRequests?: PendingJoinRequest[];
    onAcceptJoinRequest?: (accountId: string) => void;
    onRejectJoinRequest?: (accountId: string) => void;
}

export function MultiplayerEditorModal({
    isOpen,
    onClose,
    onSave,
    existingMultiplayerData,
    allCharacters,
    rawChatShells,
    pendingJoinRequests = [],
    onAcceptJoinRequest,
    onRejectJoinRequest,
}: MultiplayerEditorModalProps) {
    if (!isOpen) return null;

    const modalKey = `mp-${existingMultiplayerData?.id ?? 'new'}`;

    return (
        <MultiplayerEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingMultiplayerData={existingMultiplayerData}
            allCharacters={allCharacters}
            rawChatShells={rawChatShells}
            pendingJoinRequests={pendingJoinRequests}
            onAcceptJoinRequest={onAcceptJoinRequest}
            onRejectJoinRequest={onRejectJoinRequest}
        />
    );
}

function MultiplayerEditorModalInner({
    onClose,
    onSave,
    existingMultiplayerData,
    allCharacters,
    rawChatShells,
    pendingJoinRequests = [], // <-- FIXED: Added default value to satisfy strict null checks
    onAcceptJoinRequest,
    onRejectJoinRequest,
}: Omit<MultiplayerEditorModalProps, 'isOpen'>) {
    const [activeTab, setActiveTab] = useState<MultiplayerTabId>('general');

    const [name, setName] = useState(existingMultiplayerData?.name || '');
    const [description, setDescription] = useState(existingMultiplayerData?.description || '');
    const [password, setPassword] = useState(existingMultiplayerData?.password || '');
    const [showPassword, setShowPassword] = useState(false);
    const [interactionDataIds, setInteractionDataIds] = useState<string[]>(existingMultiplayerData?.interactionDataIds || []);
    
    // NEW: Unified account configurations
    const [accountConfigs, setAccountConfigs] = useState<Record<string, MultiplayerDataAccountConfiguration>>(
        existingMultiplayerData?.multiplayerDataAccountConfigurations || {}
    );
    const [errors, setErrors] = useState<{ name?: string }>({});

    const [sessionSearchQuery, setSessionSearchQuery] = useState('');
    const [mappingCharSearchQuery, setMappingCharSearchQuery] = useState('');

    const [newAccountIdInput, setNewAccountIdInput] = useState('');
    const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);

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
            multiplayerDataAccountConfigurations: accountConfigs,
            pendingAccountIds: existingMultiplayerData?.pendingAccountIds || [],
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

    const toggleSession = useCallback((id: string) => {
        setInteractionDataIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }, []);

    const addAccount = useCallback((id: string) => {
        if (id && !accountConfigs[id]) {
            setAccountConfigs(prev => ({
                ...prev,
                [id]: {
                    isWhitelisted: true,
                    isBlacklisted: false,
                    isAdministrator: false,
                    canUseJoinerCharacterId: true,
                    canUseHosterCharacterId: true,
                    joinerCharacterIdRequiresHosterApproval: false,
                    hosterCharacterIdRequiresHosterApproval: false,
                    whitelistedCharacterIds: [],
                    blacklistedCharacterIds: [],
                    pendingCharacterIds: [],
                }
            }));
        }
    }, [accountConfigs]);

    const removeAccount = useCallback((id: string) => {
        setAccountConfigs(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }, []);

    const setAccountStatus = useCallback((id: string, status: 'whitelist' | 'blacklist' | 'admin') => {
        setAccountConfigs(prev => {
            const cfg = prev[id];
            if (!cfg) return prev;
            return {
                ...prev,
                [id]: {
                    ...cfg,
                    isWhitelisted: status === 'whitelist',
                    isBlacklisted: status === 'blacklist',
                    isAdministrator: status === 'admin',
                }
            };
        });
    }, []);

    const updateCfg = useCallback((id: string, key: keyof MultiplayerDataAccountConfiguration, value: any) => {
        setAccountConfigs(prev => {
            const cfg = prev[id];
            if (!cfg) return prev;
            return { ...prev, [id]: { ...cfg, [key]: value } };
        });
    }, []);

    const toggleCharForAccount = useCallback((accountId: string, charId: string) => {
        setAccountConfigs(prev => {
            const cfg = prev[accountId];
            if (!cfg) return prev;
            const has = cfg.whitelistedCharacterIds.includes(charId);
            return {
                ...prev,
                [accountId]: {
                    ...cfg,
                    whitelistedCharacterIds: has 
                        ? cfg.whitelistedCharacterIds.filter(c => c !== charId) 
                        : [...cfg.whitelistedCharacterIds, charId]
                }
            };
        });
    }, []);

    const handleAcceptLiveRequest = useCallback((accountId: string) => {
        onAcceptJoinRequest?.(accountId);
        if (!accountConfigs[accountId]) {
            setAccountConfigs(prev => ({
                ...prev,
                [accountId]: {
                    isWhitelisted: true,
                    isBlacklisted: false,
                    isAdministrator: false,
                    canUseJoinerCharacterId: true,
                    canUseHosterCharacterId: true,
                    joinerCharacterIdRequiresHosterApproval: false,
                    hosterCharacterIdRequiresHosterApproval: false,
                    whitelistedCharacterIds: [],
                    blacklistedCharacterIds: [],
                    pendingCharacterIds: [],
                }
            }));
        }
    }, [onAcceptJoinRequest, accountConfigs]);

    const handleRejectLiveRequest = useCallback((accountId: string) => {
        onRejectJoinRequest?.(accountId);
    }, [onRejectJoinRequest]);

    const chatShellItems = rawChatShells.filter(s => s.id).map(s => ({
        id: s.id!,
        name: s.name || 'Untitled Chat',
        description: `${s.interactionIdHistory?.length ?? 0} messages`,
        lastUpdatedTimestamp: s.lastUpdatedTimestamp,
    }));

    const multiplayerTabs: { id: MultiplayerTabId; label: string; icon: string; badge?: number }[] = [
        { id: 'general', label: 'General', icon: '📝' },
        { id: 'accounts', label: 'Accounts', icon: '🔐', badge: pendingJoinRequests.length > 0 ? pendingJoinRequests.length : undefined },
    ];

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

                <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                    {multiplayerTabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                        >
                            {tab.icon} {tab.label}
                            {tab.badge !== undefined && tab.badge > 0 && (
                                <span style={{
                                    marginLeft: '6px',
                                    background: '#ef4444',
                                    color: '#fff',
                                    borderRadius: '10px',
                                    padding: '0 6px',
                                    fontSize: '0.6rem',
                                    fontWeight: 'bold',
                                    lineHeight: '16px',
                                    minWidth: '16px',
                                    textAlign: 'center',
                                }}>
                                    {tab.badge}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="modal-body editor-modal-body">
                    {/* ─── GENERAL TAB ─── */}
                    {activeTab === 'general' && (
                        <>
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

                            <div style={{ marginBottom: '16px' }}>
                                <label className="editor-label">Password</label>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        className="editor-input"
                                        placeholder="Leave empty for open access"
                                        style={{ flex: 1 }}
                                    />
                                    <button
                                        type="button"
                                        className="editor-button editor-button-cancel"
                                        onClick={() => setShowPassword(!showPassword)}
                                        style={{ fontSize: '0.7rem', padding: '8px 12px', whiteSpace: 'nowrap' }}
                                    >
                                        {showPassword ? '🙈 Hide' : '👁️ Show'}
                                    </button>
                                </div>
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    Invite-only when set. Empty = accessible to all.
                                </div>
                            </div>

                            <div className="editor-section">
                                <EntitySelectList
                                    label={`Linked Sessions (${interactionDataIds.length})`}
                                    items={chatShellItems}
                                    selectedIds={interactionDataIds}
                                    onToggle={toggleSession}
                                    searchQuery={sessionSearchQuery}
                                    onSearchChange={setSessionSearchQuery}
                                />
                            </div>
                        </>
                    )}

                    {/* ─── ACCOUNTS TAB ─── */}
                    {activeTab === 'accounts' && (
                        <>
                            {/* Live Pending Join Requests */}
                            <div className="editor-section" style={{
                                border: pendingJoinRequests.length > 0 ? '1px solid rgba(245, 158, 11, 0.4)' : '1px dashed var(--border)',
                                background: pendingJoinRequests.length > 0 ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                                borderRadius: '6px',
                                marginBottom: '16px',
                            }}>
                                <div className="editor-section-title" style={{ 
                                    color: pendingJoinRequests.length > 0 ? '#fbbf24' : undefined, 
                                    margin: 0,
                                    marginBottom: '8px'
                                }}>
                                    Pending Join Requests ({pendingJoinRequests.length})
                                </div>
                                {pendingJoinRequests.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {pendingJoinRequests.map(req => (
                                            <div key={req.accountId} style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                padding: '6px 8px',
                                                background: 'rgba(255,255,255,0.05)',
                                                borderRadius: '4px',
                                            }}>
                                                <span style={{ flex: 1, fontSize: '0.65rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {req.accountId}
                                                    {req.requestedCharacterData && <span style={{color: '#22c55e', marginLeft: '6px'}}> (Uploading Custom: {req.requestedCharacterData.name})</span>}
                                                    {req.requestedCharacterId && <span style={{color: '#3b82f6', marginLeft: '6px'}}> (Picking Host Char)</span>}
                                                </span>
                                                <button type="button" onClick={() => handleAcceptLiveRequest(req.accountId)} className="editor-button editor-button-save" style={{ fontSize: '0.6rem', padding: '3px 10px', minWidth: '60px' }}>✓ Accept</button>
                                                <button type="button" onClick={() => handleRejectLiveRequest(req.accountId)} className="editor-button editor-button-cancel" style={{ fontSize: '0.6rem', padding: '3px 10px', minWidth: '60px', color: '#ff4444' }}>✗ Reject</button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic' }}>
                                        No pending requests.
                                    </div>
                                )}
                            </div>

                            <div className="editor-section">
                                <div className="editor-section-title">Account Permissions & Mappings</div>
                                
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                    <input 
                                        type="text" 
                                        value={newAccountIdInput} 
                                        onChange={e => setNewAccountIdInput(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { addAccount(newAccountIdInput.trim()); setNewAccountIdInput(''); } }}
                                        className="editor-input"
                                        placeholder="Add Account ID..."
                                        style={{ flex: 1 }}
                                    />
                                    <button 
                                        type="button"
                                        onClick={() => { addAccount(newAccountIdInput.trim()); setNewAccountIdInput(''); }}
                                        className="editor-button editor-button-save"
                                        style={{ fontSize: '0.7rem', padding: '0 12px' }}
                                    >
                                        Add
                                    </button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
                                    {Object.entries(accountConfigs).map(([acctId, cfg]) => (
                                        <div key={acctId} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', background: 'rgba(255,255,255,0.02)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {acctId}
                                                    {cfg.activeCharacterId && (
                                                        <span style={{ color: '#22c55e', marginLeft: '8px', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                                            ▶ Playing: {allCharacters.find(c => c.id === cfg.activeCharacterId)?.name || cfg.activeCharacterId.substring(0, 8)}
                                                        </span>
                                                    )}
                                                </span>
                                                <select 
                                                    value={cfg.isAdministrator ? 'admin' : cfg.isBlacklisted ? 'blacklist' : 'whitelist'} 
                                                    onChange={e => setAccountStatus(acctId, e.target.value as any)}
                                                    style={{ background: 'var(--social-bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 4px', fontSize: '0.7rem' }}
                                                >
                                                    <option value="whitelist">Whitelisted</option>
                                                    <option value="blacklist">Blacklisted</option>
                                                    <option value="admin">Administrator</option>
                                                </select>
                                                <button type="button" onClick={() => removeAccount(acctId)} className="toolbar-button" style={{ fontSize: '0.7rem', color: '#ff4444' }} title="Remove Account">×</button>
                                            </div>
                                            
                                            {expandedAccountId === acctId ? (
                                                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                                                    <div>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                                                            <input type="checkbox" checked={cfg.canUseJoinerCharacterId} onChange={e => updateCfg(acctId, 'canUseJoinerCharacterId', e.target.checked)} /> 
                                                            Allow Custom Characters (Joiner's Upload)
                                                        </label>
                                                        {cfg.canUseJoinerCharacterId && (
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', marginLeft: '16px', marginTop: '4px', opacity: 0.8 }}>
                                                                <input type="checkbox" checked={cfg.joinerCharacterIdRequiresHosterApproval} onChange={e => updateCfg(acctId, 'joinerCharacterIdRequiresHosterApproval', e.target.checked)} /> 
                                                                Requires Host Approval
                                                            </label>
                                                        )}
                                                    </div>
                                                    
                                                    <div>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                                                            <input type="checkbox" checked={cfg.canUseHosterCharacterId} onChange={e => updateCfg(acctId, 'canUseHosterCharacterId', e.target.checked)} /> 
                                                            Allow Host Characters (Pick from Room)
                                                        </label>
                                                        {cfg.canUseHosterCharacterId && (
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', marginLeft: '16px', marginTop: '4px', opacity: 0.8 }}>
                                                                <input type="checkbox" checked={cfg.hosterCharacterIdRequiresHosterApproval} onChange={e => updateCfg(acctId, 'hosterCharacterIdRequiresHosterApproval', e.target.checked)} /> 
                                                                Requires Host Approval
                                                            </label>
                                                        )}
                                                    </div>
                                                    
                                                    {cfg.canUseHosterCharacterId && (
                                                        <div style={{ marginTop: '4px' }}>
                                                            <div style={{fontSize: '0.7rem', marginBottom: '4px', fontWeight: 'bold'}}>Whitelisted Host Characters:</div>
                                                            <EntitySelectList
                                                                label=" "
                                                                items={allCharacters}
                                                                selectedIds={cfg.whitelistedCharacterIds}
                                                                onToggle={(charId) => toggleCharForAccount(acctId, charId)}
                                                                searchQuery={mappingCharSearchQuery}
                                                                onSearchChange={setMappingCharSearchQuery}
                                                            />
                                                        </div>
                                                    )}
                                                    
                                                    <button type="button" onClick={() => setExpandedAccountId(null)} className="editor-button editor-button-cancel" style={{ fontSize: '0.7rem', padding: '4px' }}>Collapse ▲</button>
                                                </div>
                                            ) : (
                                                <button type="button" onClick={() => setExpandedAccountId(acctId)} className="editor-button" style={{marginTop: '6px', fontSize: '0.7rem', padding: '4px 8px', width: '100%'}}>Configure Permissions & Characters ▼</button>
                                            )}
                                        </div>
                                    ))}
                                    {Object.keys(accountConfigs).length === 0 && <div style={{opacity: 0.5, fontSize: '0.8rem', textAlign: 'center', padding: '12px'}}>No accounts configured. Add an account ID above.</div>}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}