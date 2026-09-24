// src/components/MultiplayerEditorModal.tsx
import { useState, useCallback, useRef } from 'react';
import type { MultiplayerData, Character, RawInteractionData } from '../types';
import type { PendingJoinRequest } from '../hooks/useMultiplayerSync';
import { v4 as uuidv4 } from 'uuid';
import { EntitySelectList } from './EntitySelectList';
import '../main.css';

type MultiplayerTabId = 'general' | 'access' | 'mappings';

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

function ManualIdInput({
    label,
    ids,
    onAdd,
    onRemove,
}: {
    label: string;
    ids: string[];
    onAdd: (id: string) => void;
    onRemove: (id: string) => void;
}) {
    const [inputValue, setInputValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            const val = inputValue.trim();
            if (val && !ids.includes(val)) {
                onAdd(val);
                setInputValue('');
            }
        }
    };

    return (
        <div style={{ marginBottom: '12px' }}>
            <label className="editor-label editor-label-small">{label} ({ids.length})</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '80px', overflowY: 'auto', marginBottom: '4px' }}>
                {ids.map(id => (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                        <span style={{ flex: 1, fontSize: '0.65rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id}</span>
                        <button type="button" onClick={() => onRemove(id)} className="toolbar-button" style={{ width: '18px', height: '18px', fontSize: '0.6rem', color: '#ff4444', padding: 0 }}>×</button>
                    </div>
                ))}
                {ids.length === 0 && <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic' }}>None added.</div>}
            </div>
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="editor-input"
                placeholder="Type account ID and press Enter..."
                style={{ fontSize: '0.7rem', padding: '4px 6px' }}
            />
        </div>
    );
}

function MultiplayerEditorModalInner({
    onClose,
    onSave,
    existingMultiplayerData,
    allCharacters,
    rawChatShells,
    pendingJoinRequests,
    onAcceptJoinRequest,
    onRejectJoinRequest,
}: Omit<MultiplayerEditorModalProps, 'isOpen'>) {
    const [activeTab, setActiveTab] = useState<MultiplayerTabId>('general');

    const [name, setName] = useState(existingMultiplayerData?.name || '');
    const [description, setDescription] = useState(existingMultiplayerData?.description || '');
    const [password, setPassword] = useState(existingMultiplayerData?.password || '');
    const [showPassword, setShowPassword] = useState(false);
    const [interactionDataIds, setInteractionDataIds] = useState<string[]>(existingMultiplayerData?.interactionDataIds || []);
    const [whiteListedAccountIds, setWhiteListedAccountIds] = useState<string[]>(existingMultiplayerData?.whiteListedAccountIds || []);
    const [blacklistedAccountIds, setBlacklistedAccountIds] = useState<string[]>(existingMultiplayerData?.blacklistedAccountIds || []);
    const [administratorAccountIds, setAdministratorAccountIds] = useState<string[]>(existingMultiplayerData?.administratorAccountIds || []);
    const [accountIdCharacterIds, setAccountIdCharacterIds] = useState<Record<string, string[]>>(existingMultiplayerData?.accountIdCharacterIds || {});
    const [errors, setErrors] = useState<{ name?: string }>({});

    const [sessionSearchQuery, setSessionSearchQuery] = useState('');
    const [mappingCharSearchQuery, setMappingCharSearchQuery] = useState('');

    const [mappingAccountIdInput, setMappingAccountIdInput] = useState('');
    const [selectedMappingCharIds, setSelectedMappingCharIds] = useState<string[]>([]);

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
            pendingAccountIds: [],
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

    const addWhitelist = useCallback((id: string) => {
        setWhiteListedAccountIds(prev => [...prev, id]);
        setBlacklistedAccountIds(prev => prev.filter(x => x !== id));
        setAdministratorAccountIds(prev => prev.filter(x => x !== id));
    }, []);

    const addBlacklist = useCallback((id: string) => {
        setBlacklistedAccountIds(prev => [...prev, id]);
        setWhiteListedAccountIds(prev => prev.filter(x => x !== id));
        setAdministratorAccountIds(prev => prev.filter(x => x !== id));
    }, []);

    const addAdmin = useCallback((id: string) => {
        setAdministratorAccountIds(prev => [...prev, id]);
        setWhiteListedAccountIds(prev => prev.filter(x => x !== id));
        setBlacklistedAccountIds(prev => prev.filter(x => x !== id));
    }, []);

    const removeId = useCallback((setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setter(prev => prev.filter(x => x !== id));
    }, []);

    const toggleSession = useCallback((id: string) => {
        setInteractionDataIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }, []);

    const toggleMappingChar = useCallback((id: string) => {
        setSelectedMappingCharIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }, []);

    const handleAddMapping = useCallback(() => {
        const acctId = mappingAccountIdInput.trim();
        if (!acctId || selectedMappingCharIds.length === 0) return;
        setAccountIdCharacterIds(prev => {
            const existing = prev[acctId] || [];
            const merged = [...new Set([...existing, ...selectedMappingCharIds])];
            return { ...prev, [acctId]: merged };
        });
        setMappingAccountIdInput('');
        setSelectedMappingCharIds([]);
    }, [mappingAccountIdInput, selectedMappingCharIds]);

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

    const handleAcceptLiveRequest = useCallback((accountId: string) => {
        onAcceptJoinRequest?.(accountId);
        addWhitelist(accountId);
    }, [onAcceptJoinRequest, addWhitelist]);

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
        { id: 'access', label: 'Access', icon: '🔐', badge: pendingJoinRequests.length > 0 ? pendingJoinRequests.length : undefined },
        { id: 'mappings', label: 'Mappings', icon: '🔗' },
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

                    {/* ─── ACCESS TAB ─── */}
                    {activeTab === 'access' && (
                        <>
                            {/* Live Pending Join Requests */}
                            <div className="editor-section" style={{
                                border: pendingJoinRequests.length > 0 ? '1px solid rgba(245, 158, 11, 0.4)' : '1px dashed var(--border)',
                                background: pendingJoinRequests.length > 0 ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                                borderRadius: '6px',
                                marginBottom: '16px',
                                textAlign: 'center',
                            }}>
                                <div className="editor-section-title" style={{ 
                                    color: pendingJoinRequests.length > 0 ? '#fbbf24' : undefined, 
                                    margin: 0,
                                    textAlign: 'center',
                                }}>
                                    Pending Join Requests ({pendingJoinRequests.length})
                                </div>
                                {pendingJoinRequests.length > 0 ? (
                                    <>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', textAlign: 'left' }}>
                                            {pendingJoinRequests.map(req => (
                                                <div key={req.accountId} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    padding: '6px 8px',
                                                    background: 'rgba(255,255,255,0.05)',
                                                    borderRadius: '4px',
                                                }}>
                                                    <span style={{
                                                        flex: 1,
                                                        fontSize: '0.65rem',
                                                        fontFamily: 'monospace',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        {req.accountId}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAcceptLiveRequest(req.accountId)}
                                                        className="editor-button editor-button-save"
                                                        style={{ fontSize: '0.6rem', padding: '3px 10px', minWidth: '60px' }}
                                                    >
                                                        ✓ Accept
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRejectLiveRequest(req.accountId)}
                                                        className="editor-button editor-button-cancel"
                                                        style={{ fontSize: '0.6rem', padding: '3px 10px', minWidth: '60px', color: '#ff4444' }}
                                                    >
                                                        ✗ Reject
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '6px' }}>
                                            Accepted accounts are automatically added to the whitelist below.
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic', marginTop: '6px' }}>
                                        No pending requests. Requests appear here when someone tries to join this session.
                                    </div>
                                )}
                            </div>

                            <div className="editor-section">
                                <div className="editor-section-title">Access Control Lists</div>
                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '8px' }}>
                                    Type account IDs manually. An account can only be in one list at a time.
                                </div>

                                <ManualIdInput
                                    label="Whitelisted"
                                    ids={whiteListedAccountIds}
                                    onAdd={addWhitelist}
                                    onRemove={(id) => removeId(setWhiteListedAccountIds, id)}
                                />
                                <ManualIdInput
                                    label="Blacklisted"
                                    ids={blacklistedAccountIds}
                                    onAdd={addBlacklist}
                                    onRemove={(id) => removeId(setBlacklistedAccountIds, id)}
                                />
                                <ManualIdInput
                                    label="Administrators"
                                    ids={administratorAccountIds}
                                    onAdd={addAdmin}
                                    onRemove={(id) => removeId(setAdministratorAccountIds, id)}
                                />
                            </div>
                        </>
                    )}

                    {/* ─── MAPPINGS TAB ─── */}
                    {activeTab === 'mappings' && (
                        <div className="editor-section" style={{ margin: 0, border: 'none', background: 'transparent', padding: 0 }}>
                            <div className="editor-section-title">Account → Character Mappings</div>
                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '8px' }}>
                                Type an account ID, then select characters from the list below to map.
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto', marginBottom: '8px' }}>
                                {Object.entries(accountIdCharacterIds).map(([accountId, charIds]) => (
                                    <div key={accountId} style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                            <span style={{ fontSize: '0.7rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{accountId}</span>
                                            <button type="button" onClick={() => handleRemoveMappingAccount(accountId)} className="toolbar-button" style={{ fontSize: '0.55rem', padding: '1px 5px', color: '#ff4444' }} title="Remove all mappings for this account">×</button>
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                            {charIds.map(charId => {
                                                const charName = allCharacters.find(c => c.id === charId)?.name;
                                                return (
                                                    <span key={charId} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '1px 6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', fontSize: '0.6rem' }}>
                                                        {charName || charId.substring(0, 8)}
                                                        <button type="button" onClick={() => handleRemoveMappingChar(accountId, charId)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff4444', fontSize: '0.6rem', padding: 0, lineHeight: 1 }}>×</button>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                                {Object.keys(accountIdCharacterIds).length === 0 && (
                                    <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic' }}>No mappings configured.</div>
                                )}
                            </div>

                            <div style={{ marginBottom: '8px' }}>
                                <label className="editor-label editor-label-small">Account ID</label>
                                <input
                                    type="text"
                                    value={mappingAccountIdInput}
                                    onChange={e => setMappingAccountIdInput(e.target.value)}
                                    className="editor-input"
                                    placeholder="Type external account ID..."
                                    style={{ fontSize: '0.7rem', padding: '4px 6px' }}
                                />
                            </div>

                            <EntitySelectList
                                label={`Select Characters (${selectedMappingCharIds.length} selected)`}
                                items={allCharacters}
                                selectedIds={selectedMappingCharIds}
                                onToggle={toggleMappingChar}
                                searchQuery={mappingCharSearchQuery}
                                onSearchChange={setMappingCharSearchQuery}
                            />

                            <button
                                type="button"
                                onClick={handleAddMapping}
                                disabled={!mappingAccountIdInput.trim() || selectedMappingCharIds.length === 0}
                                className="editor-button editor-button-save"
                                style={{ fontSize: '0.7rem', width: '100%', marginTop: '8px' }}
                            >
                                Add Mapping
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}