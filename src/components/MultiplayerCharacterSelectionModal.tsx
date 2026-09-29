// src/components/MultiplayerCharacterSelectionModal.tsx
import { useState, useMemo, useEffect } from 'react';
import type { Character } from '../types';
import '../main.css';

type SelectionTab = 'session' | 'local';

interface MultiplayerCharacterSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectCharacter: (character: Character) => void;
    sessionCharacters: Character[];
    localCharacters: Character[];
    sessionRules?: {
        canUseJoinerCharacterId: boolean;
        canUseHosterCharacterId: boolean;
        joinerCharacterIdRequiresHosterApproval: boolean;
        hosterCharacterIdRequiresHosterApproval: boolean;
    } | null;
}

export function MultiplayerCharacterSelectionModal({
    isOpen,
    onClose,
    onSelectCharacter,
    sessionCharacters,
    localCharacters,
    sessionRules,
}: MultiplayerCharacterSelectionModalProps) {
    const canUseHostChars = sessionRules?.canUseHosterCharacterId !== false;
    const canUseJoinerChars = sessionRules?.canUseJoinerCharacterId !== false;

    const [activeTab, setActiveTab] = useState<SelectionTab>(() => canUseHostChars ? 'session' : 'local');
    const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Reset selection and sync with permitted tabs whenever the modal opens
    useEffect(() => {
        if (isOpen) {
            setSelectedCharId(null);
            setSearchQuery('');
            if (canUseHostChars) {
                setActiveTab('session');
            } else if (canUseJoinerChars) {
                setActiveTab('local');
            }
        }
    }, [isOpen, canUseHostChars, canUseJoinerChars]);

    // Handle asynchronous sessionRules updates while modal is already open
    useEffect(() => {
        if (activeTab === 'session' && !canUseHostChars && canUseJoinerChars) {
            setActiveTab('local');
            setSelectedCharId(null);
        } else if (activeTab === 'local' && !canUseJoinerChars && canUseHostChars) {
            setActiveTab('session');
            setSelectedCharId(null);
        }
    }, [canUseHostChars, canUseJoinerChars, activeTab]);

    const availableCharacters = useMemo(() => {
        const pool = activeTab === 'session' ? sessionCharacters : localCharacters;
        if (!searchQuery.trim()) return pool;
        const q = searchQuery.toLowerCase();
        return pool.filter(c => 
            c.name.toLowerCase().includes(q) || 
            (c.description?.toLowerCase().includes(q))
        );
    }, [activeTab, sessionCharacters, localCharacters, searchQuery]);

    // Constrain selection to the active tab's permitted character pool
    const selectedCharacter = useMemo(() => {
        if (!selectedCharId) return null;
        const activePool = activeTab === 'session' ? sessionCharacters : localCharacters;
        return activePool.find(c => c.id === selectedCharId) || null;
    }, [selectedCharId, activeTab, sessionCharacters, localCharacters]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (!selectedCharacter) return;
        onSelectCharacter(selectedCharacter);
    };

    const isCurrentTabDisabled = (activeTab === 'session' && !canUseHostChars) || (activeTab === 'local' && !canUseJoinerChars);
    const areAllTabsDisabled = !canUseHostChars && !canUseJoinerChars;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div 
                className="modal-content editor-modal-content" 
                onClick={e => e.stopPropagation()} 
                style={{ maxWidth: '640px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            >
                <div className="modal-header">
                    <h2>Choose Your Character</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>
                            Leave Session
                        </button>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="entity-tab-bar" style={{ padding: '0 20px', margin: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                    <button
                        type="button"
                        onClick={() => { setActiveTab('session'); setSelectedCharId(null); }}
                        disabled={!canUseHostChars}
                        className={`entity-tab-button ${activeTab === 'session' ? 'entity-tab-button-active' : ''}`}
                        style={{ opacity: canUseHostChars ? 1 : 0.4 }}
                    >
                        🎭 Room Characters ({sessionCharacters.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => { setActiveTab('local'); setSelectedCharId(null); }}
                        disabled={!canUseJoinerChars}
                        className={`entity-tab-button ${activeTab === 'local' ? 'entity-tab-button-active' : ''}`}
                        style={{ opacity: canUseJoinerChars ? 1 : 0.4 }}
                    >
                        👤 My Local Characters ({localCharacters.length})
                    </button>
                </div>

                <div className="modal-body editor-modal-body" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Permission Notices */}
                    {areAllTabsDisabled ? (
                        <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', fontSize: '0.75rem', color: '#f87171' }}>
                            The host does not permit joiners to select or upload any characters in this session.
                        </div>
                    ) : (
                        <>
                            {activeTab === 'session' && !canUseHostChars && (
                                <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', fontSize: '0.75rem', color: '#f87171' }}>
                                    The host has disabled playing as existing room characters.
                                </div>
                            )}
                            {activeTab === 'local' && !canUseJoinerChars && (
                                <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', fontSize: '0.75rem', color: '#f87171' }}>
                                    The host has disabled using custom or local characters in this session.
                                </div>
                            )}
                        </>
                    )}

                    {/* Search Bar */}
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search characters by name or description..."
                        className="editor-input"
                        disabled={isCurrentTabDisabled}
                        style={{ width: '100%', padding: '8px 12px', fontSize: '0.8rem' }}
                    />

                    {/* Character Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', maxHeight: '350px', overflowY: 'auto' }}>
                        {!isCurrentTabDisabled && availableCharacters.map(char => {
                            const isSelected = selectedCharId === char.id;
                            const avatar = char.images?.['neutral'] || Object.values(char.images || {})[0];

                            return (
                                <div
                                    key={char.id}
                                    onClick={() => setSelectedCharId(char.id)}
                                    style={{
                                        border: isSelected ? '2px solid var(--accent, #3b82f6)' : '1px solid var(--border)',
                                        background: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255,255,255,0.03)',
                                        borderRadius: '8px',
                                        padding: '10px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        textAlign: 'center',
                                        gap: '6px',
                                        transition: 'all 0.15s ease-in-out',
                                    }}
                                >
                                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', overflow: 'hidden', background: 'var(--social-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
                                        {avatar ? (
                                            <img src={avatar} alt={char.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            '🎭'
                                        )}
                                    </div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--text-h)' }}>
                                        {char.name}
                                    </div>
                                    {char.description && (
                                        <div style={{ fontSize: '0.65rem', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                            {char.description}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {(!isCurrentTabDisabled && availableCharacters.length === 0) && (
                            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '24px', opacity: 0.5, fontSize: '0.8rem' }}>
                                No characters available under this selection.
                            </div>
                        )}
                    </div>
                </div>

                <div className="modal-footer" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                        {selectedCharacter ? `Selected: ${selectedCharacter.name}` : 'Select a character to enter room'}
                    </span>
                    <button
                        type="button"
                        className="editor-button editor-button-save"
                        disabled={!selectedCharacter || isCurrentTabDisabled}
                        onClick={handleConfirm}
                        style={{ padding: '8px 20px', fontSize: '0.8rem' }}
                    >
                        Enter Session
                    </button>
                </div>
            </div>
        </div>
    );
}