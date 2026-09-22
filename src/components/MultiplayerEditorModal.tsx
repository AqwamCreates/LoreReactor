// src/components/MultiplayerEditorModal.tsx
import { useState, useCallback, useRef } from 'react';
import type { MultiplayerData, Character, RawInteractionData } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { EntitySelectList } from './EntitySelectList';
import '../main.css';

interface MultiplayerEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: MultiplayerData) => void;
    existingMultiplayerData?: MultiplayerData | null;
    allCharacters: Character[];
    rawChatShells: RawInteractionData[];
}

export function MultiplayerEditorModal({
    isOpen,
    onClose,
    onSave,
    existingMultiplayerData,
    allCharacters,
    rawChatShells,
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

    // Search states for EntitySelectLists
    const [sessionSearchQuery, setSessionSearchQuery] = useState('');
    const [mappingCharSearchQuery, setMappingCharSearchQuery] = useState('');

    // For adding account-character mappings
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

    // Manual ID list helpers — enforce mutual exclusivity across access control lists
    const addWhitelist = useCallback((id: string) => {
        setWhiteListedAccountIds(prev => [...prev, id]);
        setBlacklistedAccountIds(prev => prev.filter(x => x !== id));
        setPendingAccountIds(prev => prev.filter(x => x !== id));
        setAdministratorAccountIds(prev => prev.filter(x => x !== id));
    }, []);

    const addBlacklist = useCallback((id: string) => {
        setBlacklistedAccountIds(prev => [...prev, id]);
        setWhiteListedAccountIds(prev => prev.filter(x => x !== id));
        setPendingAccountIds(prev => prev.filter(x => x !== id));
        setAdministratorAccountIds(prev => prev.filter(x => x !== id));
    }, []);

    const addPending = useCallback((id: string) => {
        setPendingAccountIds(prev => [...prev, id]);
        setWhiteListedAccountIds(prev => prev.filter(x => x !== id));
        setBlacklistedAccountIds(prev => prev.filter(x => x !== id));
        setAdministratorAccountIds(prev => prev.filter(x => x !== id));
    }, []);

    const addAdmin = useCallback((id: string) => {
        setAdministratorAccountIds(prev => [...prev, id]);
        setWhiteListedAccountIds(prev => prev.filter(x => x !== id));
        setBlacklistedAccountIds(prev => prev.filter(x => x !== id));
        setPendingAccountIds(prev => prev.filter(x => x !== id));
    }, []);

    const removeId = useCallback((setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setter(prev => prev.filter(x => x !== id));
    }, []);

    // Session toggle for EntitySelectList
    const toggleSession = useCallback((id: string) => {
        setInteractionDataIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }, []);

    // Character toggle for mapping EntitySelectList
    const toggleMappingChar = useCallback((id: string) => {
        setSelectedMappingCharIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }, []);

    // Add mapping from manual account ID + selected character IDs
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

    // Prepare chat shells as selectable items for EntitySelectList
    const chatShellItems = rawChatShells.filter(s => s.id).map(s => ({
        id: s.id!,
        name: s.name || 'Untitled Chat',
        description: `${s.interactionIdHistory?.length ?? 0} messages`,
        lastUpdatedTimestamp: s.lastUpdatedTimestamp,
    }));

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

                    {/* Linked Sessions — searchable via EntitySelectList */}
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

                    {/* Access Control — manual text input for account IDs */}
                    <div className="editor-section">
                        <div className="editor-section-title">Access Control</div>
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
                            label="Pending"
                            ids={pendingAccountIds}
                            onAdd={addPending}
                            onRemove={(id) => removeId(setPendingAccountIds, id)}
                        />
                        <ManualIdInput
                            label="Administrators"
                            ids={administratorAccountIds}
                            onAdd={addAdmin}
                            onRemove={(id) => removeId(setAdministratorAccountIds, id)}
                        />
                    </div>

                    {/* Account-Character Mappings — manual account ID + EntitySelectList for characters */}
                    <div className="editor-section">
                        <div className="editor-section-title">Account → Character Mappings</div>
                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '8px' }}>
                            Type an account ID, then select characters from the list below to map.
                        </div>

                        {/* Existing mappings display */}
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

                        {/* New mapping input */}
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
                </div>
            </div>
        </div>
    );
}