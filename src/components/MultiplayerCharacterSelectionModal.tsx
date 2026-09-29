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
    // Treat null rules as "allow all" until host sends specifics
    const canUseHostChars = sessionRules ? sessionRules.canUseHosterCharacterId !== false : true;
    const canUseJoinerChars = sessionRules ? sessionRules.canUseJoinerCharacterId !== false : true;

    const [activeTab, setActiveTab] = useState<SelectionTab>(canUseHostChars ? 'session' : 'local');
    const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (isOpen) {
            setSelectedCharId(null);
            setSearchQuery('');
            setActiveTab(canUseHostChars ? 'session' : 'local');
        }
    }, [isOpen, canUseHostChars]);

    const availableCharacters = useMemo(() => {
        const pool = activeTab === 'session' ? sessionCharacters : localCharacters;
        if (!searchQuery.trim()) return pool;
        const q = searchQuery.toLowerCase();
        return pool.filter(c => 
            c.name.toLowerCase().includes(q) || 
            (c.description?.toLowerCase().includes(q))
        );
    }, [activeTab, sessionCharacters, localCharacters, searchQuery]);

    const selectedCharacter = useMemo(() => {
        if (!selectedCharId) return null;
        const activePool = activeTab === 'session' ? sessionCharacters : localCharacters;
        return activePool.find(c => c.id === selectedCharId) || null;
    }, [selectedCharId, activeTab, sessionCharacters, localCharacters]);

    if (!isOpen) return null;

    const isCurrentTabDisabled = (activeTab === 'session' && !canUseHostChars) || (activeTab === 'local' && !canUseJoinerChars);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Choose Your Character</h2>
                </div>

                <div className="entity-tab-bar">
                    <button
                        className={`entity-tab-button ${activeTab === 'session' ? 'entity-tab-button-active' : ''}`}
                        onClick={() => { setActiveTab('session'); setSelectedCharId(null); }}
                        disabled={!canUseHostChars}
                    >
                        🎭 Room ({sessionCharacters.length})
                    </button>
                    <button
                        className={`entity-tab-button ${activeTab === 'local' ? 'entity-tab-button-active' : ''}`}
                        onClick={() => { setActiveTab('local'); setSelectedCharId(null); }}
                        disabled={!canUseJoinerChars}
                    >
                        👤 Local ({localCharacters.length})
                    </button>
                </div>

                <div className="modal-body">
                    <input
                        className="editor-input"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        disabled={isCurrentTabDisabled}
                    />

                    <div className="character-grid">
                        {!isCurrentTabDisabled && availableCharacters.map(char => (
                            <div
                                key={char.id}
                                className={`character-card ${selectedCharId === char.id ? 'selected' : ''}`}
                                onClick={() => setSelectedCharId(char.id)}
                            >
                                <span>{char.name}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="modal-footer">
                    <button onClick={onClose}>Cancel</button>
                    <button 
                        disabled={!selectedCharacter} 
                        onClick={() => selectedCharacter && onSelectCharacter(selectedCharacter)}
                    >
                        Enter Session
                    </button>
                </div>
            </div>
        </div>
    );
}