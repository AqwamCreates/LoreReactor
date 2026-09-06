// src/components/SettingsModal.tsx
import './main.css';

interface SettingsItem {
    id: string;
    icon: string;
    label: string;
    description: string;
}

const SETTINGS_ITEMS: SettingsItem[] = [
    {
        id: 'character-card-import',
        icon: '🎴',
        label: 'Character Card Import',
        description: 'Import characters with lorebook entries from TavernAI V1/V2/V3 PNG cards.',
    },
];

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenCharacterCardImport: () => void;
}

export function SettingsModal({
    isOpen,
    onClose,
    onOpenCharacterCardImport,
}: SettingsModalProps) {
    if (!isOpen) return null;

    const handleItemClick = (id: string) => {
        if (id === 'character-card-import') {
            onOpenCharacterCardImport();
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-content-manager" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Settings</h2>
                    <div className="modal-header-actions">
                        <button type="button" className="close-btn close-btn-spaced" onClick={onClose}>×</button>
                    </div>
                </div>

                <div className="modal-body">
                    <ul className="manager-list">
                        {SETTINGS_ITEMS.map(item => (
                            <li key={item.id} className="manager-item">
                                <div
                                    className="manager-item-main manager-item-main-clickable" style={{alignItems: 'center'}}
                                    onClick={() => handleItemClick(item.id)}
                                >
                                    <div className="manager-item-info" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{item.icon}</span>
                                        <div>
                                            <div className="manager-item-title">{item.label}</div>
                                            <div className="manager-item-sub" style={{ fontSize: '0.7rem', opacity: 0.6 }}>{item.description}</div>
                                        </div>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}