import './main.css';

interface SettingsItem {
    id: string;
    icon: string;
    label: string;
    description: string;
}

const SETTINGS_ITEMS: SettingsItem[] = [
    {
        id: 'world-manager',
        icon: '🌍',
        label: 'Worlds',
        description: 'Save, load, and manage named collections of characters, contexts, locations, and profiles.',
    },
    {
        id: 'participant-control',
        icon: '🎛️',
        label: 'Participant Control',
        description: 'Force messages and override chat stamina for participants.',
    },
    {
        id: 'ai-recommendation',
        icon: '✨',
        label: 'Get AI Recommendation',
        description: 'Generate new characters, contexts, and locations using your loaded model.',
    },
    {
        id: 'import-character-card',
        icon: '🎴',
        label: 'Import Character Card',
        description: 'Import characters with lorebook entries from TavernAI V1/V2/V3 PNG cards.',
    },
    {
        id: 'import-data',
        icon: '📥',
        label: 'Import Data',
        description: 'Restore from a previously exported JSON file. Overwrites matching IDs.',
    },
    {
        id: 'export-data',
        icon: '📦',
        label: 'Export Data',
        description: 'Download everything as a single JSON backup file.',
    },
    {
        id: 'budget-control',
        icon: '💰',
        label: 'Budget Control',
        description: 'View, edit, reset, and manage persistent budget runtime data.',
    },
];

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenImportCharacterCard: () => void;
    onOpenAIRecommendation: () => void;
    onOpenExportData: () => void;
    onOpenImportData: () => void;
    onOpenParticipantControl: () => void;
    onOpenBudgetControl: () => void;
    onOpenWorldManager: () => void;
}

export function SettingsModal({
    isOpen,
    onClose,
    onOpenAIRecommendation,
    onOpenImportCharacterCard,
    onOpenExportData,
    onOpenImportData,
    onOpenParticipantControl,
    onOpenBudgetControl,
    onOpenWorldManager,
}: SettingsModalProps) {
    if (!isOpen) return null;

    const handleItemClick = (id: string) => {
        switch (id) {
            case 'world-manager':
                onOpenWorldManager();
                break;
            case 'participant-control':
                onOpenParticipantControl();
                break;
            case 'ai-recommendation':
                onOpenAIRecommendation();
                break;
            case 'import-character-card':
                onOpenImportCharacterCard();
                break;
            case 'import-data':
                onOpenImportData();
                break;
            case 'export-data':
                onOpenExportData();
                break;
            case 'budget-control':
                onOpenBudgetControl();
                break;
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