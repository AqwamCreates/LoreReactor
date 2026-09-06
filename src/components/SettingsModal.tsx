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
    {
        id: 'ai-recommendation',
        icon: '✨',
        label: 'Get AI Recommendation',
        description: 'Generate new characters, contexts, and locations using your loaded model.',
    },
    {
        id: 'import-data',
        icon: '📥',
        label: 'Import All Data',
        description: 'Restore from a previously exported JSON file. Overwrites matching IDs.',
    },
    {
        id: 'export-data',
        icon: '📦',
        label: 'Export All Data',
        description: 'Download everything as a single JSON backup file.',
    },
];

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenCharacterCardImport: () => void;
    onOpenAIRecommendation: () => void;
    onOpenExportData: () => void;
    onOpenImportData: () => void;
}

export function SettingsModal({
    isOpen,
    onClose,
    onOpenCharacterCardImport,
    onOpenAIRecommendation,
    onOpenExportData,
    onOpenImportData,
}: SettingsModalProps) {
    if (!isOpen) return null;

    const handleItemClick = (id: string) => {
        switch (id) {
            case 'character-card-import': onOpenCharacterCardImport(); break;
            case 'ai-recommendation': onOpenAIRecommendation(); break;
            case 'import-data': onOpenImportData(); break;
            case 'export-data': onOpenExportData(); break;
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
                    <ul className="manager-list settings-list">
                        {SETTINGS_ITEMS.map(item => (
                            <li key={item.id} className="manager-item settings-item">
                                <div
                                    className="manager-item-main manager-item-main-clickable settings-item-main"
                                    onClick={() => handleItemClick(item.id)}
                                >
                                    <div className="settings-item-info">
                                        <span className="settings-item-icon">{item.icon}</span>
                                        <div className="settings-item-title">{item.label}</div>
                                        <div className="settings-item-desc">{item.description}</div>
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