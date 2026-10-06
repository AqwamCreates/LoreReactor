// frontend-src/components/MultiplayerEditorModal.tsx
import { useState, useCallback, useMemo } from 'react';
import type { MultiplayerData, Character, RawInteractionData, MultiplayerDataAccountConfiguration, tristateInteger } from '../types';
import type { PendingJoinRequest } from '../hooks/useMultiplayerSync';
import { v4 as uuidv4 } from 'uuid';
import { EntitySelectList } from './EntitySelectList';
import { useSessionStore } from '../hooks/useSessionStore';
import '../main.css';

type MultiplayerTabId = 'general' | 'accounts';

interface MultiplayerEditorModalProps {
    onClose: () => void;
    onSave: (data: MultiplayerData) => void;
    existingMultiplayerData?: MultiplayerData | null;
    allCharacters: Character[];
    rawChatShells: RawInteractionData[];
    pendingJoinRequests?: PendingJoinRequest[];
    onAcceptJoinRequest?: (accountId: string) => void;
    onRejectJoinRequest?: (accountId: string) => void;
}

const USE_JOINER_LM_OPTIONS: { value: tristateInteger; label: string; description: string }[] = [
    { value: -1, label: 'Disabled', description: 'Use hoster\'s language model only. Joiner cannot use their own.' },
    { value: 0, label: 'Optional', description: 'Use joiner\'s language model when provided. Falls back to hoster\'s model.' },
    { value: 1, label: 'Mandatory', description: 'Joiner must provide access to their language model or they cannot join.' },
];

function createDefaultAccountConfig(sessionDefaults: {
    canUseJoinerCharacterIds: boolean;
    joinerCharacterIdsRequiresHosterApproval: boolean;
    sharedHosterCharacterIds: string[];
    hosterCharacterIdsRequiresHosterApproval: boolean;
}): MultiplayerDataAccountConfiguration {
    return {
        isWhitelisted: true,
        isBlacklisted: false,
        isAdministrator: false,
        canUseJoinerCharacterIds: sessionDefaults.canUseJoinerCharacterIds,
        joinerCharacterIdsRequiresHosterApproval: sessionDefaults.joinerCharacterIdsRequiresHosterApproval,
        sharedHosterCharacterIds: [...sessionDefaults.sharedHosterCharacterIds],
        hosterCharacterIdsRequiresHosterApproval: sessionDefaults.hosterCharacterIdsRequiresHosterApproval,
        whitelistedCharacterIds: [],
        blacklistedCharacterIds: [],
        pendingCharacterIds: [],
    };
}

export function MultiplayerEditorModal({
    onClose,
    onSave,
    existingMultiplayerData,
    allCharacters,
    rawChatShells,
    pendingJoinRequests = [],
    onAcceptJoinRequest,
    onRejectJoinRequest,
}: MultiplayerEditorModalProps) {

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
    pendingJoinRequests = [],
    onAcceptJoinRequest,
    onRejectJoinRequest,
}: Omit<MultiplayerEditorModalProps, 'isOpen'>) {
    const interactionData = useSessionStore(state => state.interactionData);
    const [activeTab, setActiveTab] = useState<MultiplayerTabId>('general');

    const [name, setName] = useState(existingMultiplayerData?.name || '');
    const [description, setDescription] = useState(existingMultiplayerData?.description || '');
    const [password, setPassword] = useState(existingMultiplayerData?.password || '');
    const [showPassword, setShowPassword] = useState(false);
    const [interactionDataIds, setInteractionDataIds] = useState<string[]>(existingMultiplayerData?.interactionDataIds || []);
    
    // Session-level defaults
    const [canUseJoinerCharacterIds, setCanUseJoinerCharacterIds] = useState(existingMultiplayerData?.canUseJoinerCharacterIds ?? true);
    const [joinerCharacterIdsRequiresHosterApproval, setJoinerCharacterIdsRequiresHosterApproval] = useState(existingMultiplayerData?.joinerCharacterIdsRequiresHosterApproval ?? false);
    const [sharedHosterCharacterIds, setSharedHosterCharacterIds] = useState<string[]>(existingMultiplayerData?.sharedHosterCharacterIds ?? []);
    const [hosterCharacterIdsRequiresHosterApproval, setHosterCharacterIdsRequiresHosterApproval] = useState(existingMultiplayerData?.hosterCharacterIdsRequiresHosterApproval ?? false);
    const [useJoinerLanguageModel, setUseJoinerLanguageModel] = useState<tristateInteger>(existingMultiplayerData?.useJoinerLanguageModel ?? 0);
    
    const [accountConfigs, setAccountConfigs] = useState<Record<string, MultiplayerDataAccountConfiguration>>(
        existingMultiplayerData?.multiplayerDataAccountConfigurations || {}
    );
    const [errors, setErrors] = useState<{ name?: string }>({});

    const [sessionSearchQuery, setSessionSearchQuery] = useState('');
    const [sharedCharSearchQuery, setSharedCharSearchQuery] = useState('');
    const [accountSearchQuery, setAccountSearchQuery] = useState('');

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

        const liveMultiplayerData = useSessionStore.getState().multiplayerData;
        const currentPendingList = (liveMultiplayerData && liveMultiplayerData.id === existingMultiplayerData?.id)
            ? liveMultiplayerData.pendingAccountIds
            : (existingMultiplayerData?.pendingAccountIds || []);

        const configuredAccountIds = new Set(Object.keys(accountConfigs));
        const resolvedPendingAccountIds = currentPendingList.filter(id => !configuredAccountIds.has(id));

        return {
            id: isNewClone ? uuidv4() : (existingMultiplayerData?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description: description.trim() || undefined,
            password,
            canUseJoinerCharacterIds,
            joinerCharacterIdsRequiresHosterApproval,
            sharedHosterCharacterIds,
            hosterCharacterIdsRequiresHosterApproval,
            useJoinerLanguageModel,
            interactionDataIds,
            multiplayerDataAccountConfigurations: accountConfigs,
            pendingAccountIds: resolvedPendingAccountIds,
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
        const trimmed = id.trim();
        if (!trimmed) return;

        setAccountConfigs(prev => {
            if (prev[trimmed]) return prev;
            return {
                ...prev,
                [trimmed]: createDefaultAccountConfig({
                    canUseJoinerCharacterIds,
                    joinerCharacterIdsRequiresHosterApproval,
                    sharedHosterCharacterIds,
                    hosterCharacterIdsRequiresHosterApproval,
                }),
            };
        });
    }, [canUseJoinerCharacterIds, joinerCharacterIdsRequiresHosterApproval, sharedHosterCharacterIds, hosterCharacterIdsRequiresHosterApproval]);

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

    const updateCfg = useCallback(<K extends keyof MultiplayerDataAccountConfiguration>(
        id: string, 
        key: K, 
        value: MultiplayerDataAccountConfiguration[K]
    ) => {
        setAccountConfigs(prev => {
            const cfg = prev[id];
            if (!cfg) return prev;
            return { ...prev, [id]: { ...cfg, [key]: value } };
        });
    }, []);

    // STRICT WORKFLOW: Only manage characters via the pending queue
    const updateCharStatus = useCallback((accountId: string, charId: string, newStatus: 'pending' | 'whitelisted' | 'blacklisted' | 'none') => {
        setAccountConfigs(prev => {
            const cfg = prev[accountId];
            if (!cfg) return prev;
            
            const next = { ...cfg };
            // Remove from all lists first
            next.pendingCharacterIds = next.pendingCharacterIds.filter(id => id !== charId);
            next.whitelistedCharacterIds = next.whitelistedCharacterIds.filter(id => id !== charId);
            next.blacklistedCharacterIds = next.blacklistedCharacterIds.filter(id => id !== charId);

            // Add to the target list
            if (newStatus === 'pending') next.pendingCharacterIds.push(charId);
            if (newStatus === 'whitelisted') next.whitelistedCharacterIds.push(charId);
            if (newStatus === 'blacklisted') next.blacklistedCharacterIds.push(charId);
            // if 'none', it is removed from all lists

            return { ...prev, [accountId]: next };
        });
    }, []);

    const toggleSharedHosterCharacter = useCallback((charId: string) => {
        setSharedHosterCharacterIds(prev => 
            prev.includes(charId) ? prev.filter(id => id !== charId) : [...prev, charId]
        );
    }, []);

    const handleAddFromParticipants = useCallback(() => {
        if (!interactionData?.participants) return;
        const participantIds = interactionData.participants.map(p => p.id);
        setSharedHosterCharacterIds(prev => {
            const set = new Set([...prev, ...participantIds]);
            return Array.from(set);
        });
    }, [interactionData]);

    const handleAddFromLocalLibrary = useCallback(() => {
        const localIds = allCharacters.map(c => c.id);
        setSharedHosterCharacterIds(prev => {
            const set = new Set([...prev, ...localIds]);
            return Array.from(set);
        });
    }, [allCharacters]);

    const handleAcceptLiveRequest = useCallback((accountId: string) => {
        onAcceptJoinRequest?.(accountId);
        setAccountConfigs(prev => {
            if (prev[accountId]) return prev;
            return {
                ...prev,
                [accountId]: createDefaultAccountConfig({
                    canUseJoinerCharacterIds,
                    joinerCharacterIdsRequiresHosterApproval,
                    sharedHosterCharacterIds,
                    hosterCharacterIdsRequiresHosterApproval,
                }),
            };
        });
    }, [onAcceptJoinRequest, canUseJoinerCharacterIds, joinerCharacterIdsRequiresHosterApproval, sharedHosterCharacterIds, hosterCharacterIdsRequiresHosterApproval]);

    const handleRejectLiveRequest = useCallback((accountId: string) => {
        onRejectJoinRequest?.(accountId);
    }, [onRejectJoinRequest]);

    // FIXED: Calculate total messages from the new interactionHistories Record
    const chatShellItems = useMemo(() => {
        return rawChatShells.filter(s => s.id).map(s => {
            const totalMessages = s.interactionHistories 
                ? Object.values(s.interactionHistories).reduce((acc, curr) => acc + curr.length, 0)
                : 0;
            return {
                id: s.id!,
                name: s.name || 'Untitled Chat',
                description: `${totalMessages} messages`,
                lastUpdatedTimestamp: s.lastUpdatedTimestamp,
            };
        });
    }, [rawChatShells]);

    const filteredAccountConfigs = useMemo(() => {
        const entries = Object.entries(accountConfigs);
        if (!accountSearchQuery.trim()) return entries;
        const q = accountSearchQuery.toLowerCase();
        return entries.filter(([acctId, cfg]) => {
            if (acctId.toLowerCase().includes(q)) return true;
            if (cfg.protagonistCharacterId) {
                const char = allCharacters.find(c => c.id === cfg.protagonistCharacterId);
                if (char && char.name.toLowerCase().includes(q)) return true;
            }
            return false;
        });
    }, [accountConfigs, accountSearchQuery, allCharacters]);

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

                            <div className="editor-section" style={{ marginBottom: '16px' }}>
                                <div className="editor-section-title">Default Character Permissions</div>
                                <div style={{ fontSize: '0.6rem', opacity: 0.6, marginBottom: '12px' }}>
                                    These settings apply to all new accounts. You can override them per-account in the Accounts tab.
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                                            <input type="checkbox" checked={canUseJoinerCharacterIds} onChange={e => setCanUseJoinerCharacterIds(e.target.checked)} /> 
                                            Allow Custom Characters (Joiner's Upload)
                                        </label>
                                        {canUseJoinerCharacterIds && (
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', marginLeft: '24px', marginTop: '6px', opacity: 0.8 }}>
                                                <input type="checkbox" checked={joinerCharacterIdsRequiresHosterApproval} onChange={e => setJoinerCharacterIdsRequiresHosterApproval(e.target.checked)} /> 
                                                Requires Host Approval
                                            </label>
                                        )}
                                    </div>
                                    
                                    <div>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                                            <input type="checkbox" checked={hosterCharacterIdsRequiresHosterApproval} onChange={e => setHosterCharacterIdsRequiresHosterApproval(e.target.checked)} /> 
                                            Hoster Characters Require Host Approval
                                        </label>
                                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginLeft: '24px', marginTop: '4px' }}>
                                            If unchecked, joiners can freely use any shared hoster character.
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="editor-section" style={{ marginBottom: '16px' }}>
                                <div className="editor-section-title">Shared Hoster Characters ({sharedHosterCharacterIds.length})</div>
                                <div style={{ fontSize: '0.6rem', opacity: 0.6, marginBottom: '8px' }}>
                                    Characters from your library that joiners are allowed to request.
                                </div>
                                
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                    <button type="button" className="editor-button editor-button-cancel" onClick={handleAddFromParticipants} style={{ flex: 1, fontSize: '0.75rem' }} disabled={!interactionData?.participants?.length}>
                                        + Add Active Participants
                                    </button>
                                    <button type="button" className="editor-button editor-button-cancel" onClick={handleAddFromLocalLibrary} style={{ flex: 1, fontSize: '0.75rem' }} disabled={!allCharacters.length}>
                                        + Add All Local Library
                                    </button>
                                </div>

                                <EntitySelectList
                                    label=" "
                                    items={allCharacters}
                                    selectedIds={sharedHosterCharacterIds}
                                    onToggle={toggleSharedHosterCharacter}
                                    searchQuery={sharedCharSearchQuery}
                                    onSearchChange={setSharedCharSearchQuery}
                                />
                            </div>

                            <div style={{ marginBottom: '16px' }}>
                                <label className="editor-label">Shared Language Model Policy</label>
                                <select
                                    value={useJoinerLanguageModel}
                                    onChange={e => setUseJoinerLanguageModel(Number(e.target.value) as tristateInteger)}
                                    className="editor-select"
                                >
                                    {USE_JOINER_LM_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                    {USE_JOINER_LM_OPTIONS.find(o => o.value === useJoinerLanguageModel)?.description}
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
                                        onKeyDown={e => { 
                                            if (e.key === 'Enter') { 
                                                addAccount(newAccountIdInput); 
                                                setNewAccountIdInput(''); 
                                            } 
                                        }}
                                        className="editor-input"
                                        placeholder="Add Account ID..."
                                        style={{ flex: 1 }}
                                    />
                                    <button 
                                        type="button"
                                        onClick={() => { 
                                            addAccount(newAccountIdInput); 
                                            setNewAccountIdInput(''); 
                                        }}
                                        className="editor-button editor-button-save"
                                        style={{ fontSize: '0.7rem', padding: '0 12px' }}
                                    >
                                        Add
                                    </button>
                                </div>

                                <input 
                                    type="text" 
                                    value={accountSearchQuery} 
                                    onChange={e => setAccountSearchQuery(e.target.value)}
                                    className="editor-input"
                                    placeholder="Search configured accounts..."
                                    style={{ marginBottom: '12px' }}
                                />

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
                                    {filteredAccountConfigs.map(([acctId, cfg]) => {
                                        // Resolve character objects for display
                                        const pendingChars = cfg.pendingCharacterIds.map(id => allCharacters.find(c => c.id === id)).filter(Boolean) as Character[];
                                        const whitelistedChars = cfg.whitelistedCharacterIds.map(id => allCharacters.find(c => c.id === id)).filter(Boolean) as Character[];
                                        const blacklistedChars = cfg.blacklistedCharacterIds.map(id => allCharacters.find(c => c.id === id)).filter(Boolean) as Character[];

                                        return (
                                            <div key={acctId} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', background: 'rgba(255,255,255,0.02)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {acctId}
                                                        {cfg.protagonistCharacterId && (
                                                            <span style={{ color: '#22c55e', marginLeft: '8px', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                                                ▶ Playing: {allCharacters.find(c => c.id === cfg.protagonistCharacterId)?.name || cfg.protagonistCharacterId.substring(0, 8)}
                                                            </span>
                                                        )}
                                                    </span>
                                                    <select 
                                                        value={cfg.isAdministrator ? 'admin' : cfg.isBlacklisted ? 'blacklist' : 'whitelist'} 
                                                        onChange={e => setAccountStatus(acctId, e.target.value as 'whitelist' | 'blacklist' | 'admin')}
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
                                                                <input type="checkbox" checked={cfg.canUseJoinerCharacterIds} onChange={e => updateCfg(acctId, 'canUseJoinerCharacterIds', e.target.checked)} /> 
                                                                Allow Custom Characters (Joiner's Upload)
                                                            </label>
                                                            {cfg.canUseJoinerCharacterIds && (
                                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', marginLeft: '16px', marginTop: '4px', opacity: 0.8 }}>
                                                                    <input type="checkbox" checked={cfg.joinerCharacterIdsRequiresHosterApproval} onChange={e => updateCfg(acctId, 'joinerCharacterIdsRequiresHosterApproval', e.target.checked)} /> 
                                                                    Requires Host Approval
                                                                </label>
                                                            )}
                                                        </div>
                                                        
                                                        <div>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                                                                <input type="checkbox" checked={cfg.hosterCharacterIdsRequiresHosterApproval} onChange={e => updateCfg(acctId, 'hosterCharacterIdsRequiresHosterApproval', e.target.checked)} /> 
                                                                Hoster Characters Require Host Approval
                                                            </label>
                                                        </div>

                                                        {/* STRICT WORKFLOW UI: Manage via Pending Queue */}
                                                        <div style={{ marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '6px', color: '#fbbf24' }}>
                                                                Pending Requests ({pendingChars.length})
                                                            </div>
                                                            {pendingChars.length === 0 && <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '8px' }}>No pending character requests.</div>}
                                                            {pendingChars.map(char => (
                                                                <div key={char.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(251, 191, 36, 0.1)', borderRadius: '4px', marginBottom: '4px' }}>
                                                                    <span style={{ fontSize: '0.7rem' }}>{char.name}</span>
                                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                                        <button type="button" onClick={() => updateCharStatus(acctId, char.id, 'whitelisted')} className="editor-button editor-button-save" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>Whitelist</button>
                                                                        <button type="button" onClick={() => updateCharStatus(acctId, char.id, 'blacklisted')} className="editor-button editor-button-cancel" style={{ fontSize: '0.6rem', padding: '2px 6px', color: '#ff4444' }}>Blacklist</button>
                                                                        <button type="button" onClick={() => updateCharStatus(acctId, char.id, 'none')} className="toolbar-button" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>Dismiss</button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div style={{ marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '6px', color: '#22c55e' }}>
                                                                Whitelisted ({whitelistedChars.length})
                                                            </div>
                                                            {whitelistedChars.map(char => (
                                                                <div key={char.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '4px', marginBottom: '4px' }}>
                                                                    <span style={{ fontSize: '0.7rem' }}>{char.name}</span>
                                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                                        <button type="button" onClick={() => updateCharStatus(acctId, char.id, 'blacklisted')} className="editor-button editor-button-cancel" style={{ fontSize: '0.6rem', padding: '2px 6px', color: '#ff4444' }}>Blacklist</button>
                                                                        <button type="button" onClick={() => updateCharStatus(acctId, char.id, 'none')} className="toolbar-button" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>Remove</button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div style={{ marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '6px', color: '#ef4444' }}>
                                                                Blacklisted ({blacklistedChars.length})
                                                            </div>
                                                            {blacklistedChars.map(char => (
                                                                <div key={char.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px', marginBottom: '4px' }}>
                                                                    <span style={{ fontSize: '0.7rem' }}>{char.name}</span>
                                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                                        <button type="button" onClick={() => updateCharStatus(acctId, char.id, 'whitelisted')} className="editor-button editor-button-save" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>Whitelist</button>
                                                                        <button type="button" onClick={() => updateCharStatus(acctId, char.id, 'none')} className="toolbar-button" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>Remove</button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        
                                                        <button type="button" onClick={() => setExpandedAccountId(null)} className="editor-button editor-button-cancel" style={{ fontSize: '0.7rem', padding: '4px', marginTop: '8px' }}>Collapse ▲</button>
                                                    </div>
                                                ) : (
                                                    <button type="button" onClick={() => setExpandedAccountId(acctId)} className="editor-button" style={{marginTop: '6px', fontSize: '0.7rem', padding: '4px 8px', width: '100%'}}>Manage Character Permissions ▼</button>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {filteredAccountConfigs.length === 0 && (
                                        <div style={{opacity: 0.5, fontSize: '0.8rem', textAlign: 'center', padding: '12px'}}>
                                            {Object.keys(accountConfigs).length === 0 
                                                ? 'No accounts configured. Add an account ID above.' 
                                                : 'No accounts match your search.'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}