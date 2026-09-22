// src/components/SettingsModal.tsx
import { useState } from 'react';
import '../main.css';

type SettingsTabId = 'session' | 'data' | 'multiplayer' | 'miscellaneous';

interface SettingsItem {
    id: string;
    icon: string;
    label: string;
    description: string;
}

const SETTINGS_TABS: { id: SettingsTabId; label: string; icon: string }[] = [
    { id: 'session', label: 'Session', icon: '🎮' },
    { id: 'data', label: 'Data', icon: '💾' },
    { id: 'multiplayer', label: 'Multiplayer', icon: '👥' },
    { id: 'miscellaneous', label: 'Miscellaneous', icon: '🔧' },
];

const SESSION_ITEMS: SettingsItem[] = [
    {
        id: 'budget-control',
        icon: '💰',
        label: 'Budget Control',
        description: 'View, edit, reset, and manage persistent budget runtime data.',
    },
    {
        id: 'participant-control',
        icon: '🎛️',
        label: 'Participant Control',
        description: 'Force messages and override staminas for participants.',
    },
    {
        id: 'alternate-timelines',
        icon: '🌿',
        label: 'Alternate Timelines',
        description: 'View and manage the timeline tree of the current chat session.',
    },
];

const DATA_ITEMS: SettingsItem[] = [
    {
        id: 'ai-recommendation',
        icon: '✨',
        label: 'AI Recommendation',
        description: 'Generate new characters, contexts, locations, audio tracks, prompt blocks, and worlds using your loaded model.',
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
        id: 'data-manager',
        icon: '🗄️',
        label: 'Data Manager',
        description: 'Storage usage, orphan cleanup, cache purging, integrity checks, and bulk operations.',
    },
];

const MULTIPLAYER_ITEMS: SettingsItem[] = [
    {
        id: 'multiplayer-data',
        icon: '👥',
        label: 'Multiplayer Data',
        description: 'Manage multiplayer session configurations, access control, and account-character mappings.',
    },
    {
        id: 'join-session',
        icon: '🔗',
        label: 'Join Session',
        description: 'Connect to an existing multiplayer session using a session ID and password.',
    },
    {
        id: 'account-data',
        icon: '🔑',
        label: 'Account Data',
        description: 'Manage user accounts for multiplayer sessions.',
    },
];

const MISCELLANEOUS_ITEMS: SettingsItem[] = [
    {
        id: 'gpu-monitor',
        icon: '🖥️',
        label: 'GPU Monitor',
        description: 'Real-time GPU utilization, memory usage, temperature, and power draw.',
    },
];

const TAB_ITEMS: Record<SettingsTabId, SettingsItem[]> = {
    session: SESSION_ITEMS,
    data: DATA_ITEMS,
    multiplayer: MULTIPLAYER_ITEMS,
    miscellaneous: MISCELLANEOUS_ITEMS,
};

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenBudgetControl: () => void;
    onOpenGpuMonitor: () => void;
    onOpenParticipantControl: () => void;
    onOpenAccountData: () => void;
    onOpenMultiplayerData: () => void;
    onOpenJoinSession: () => void;
    onOpenAIRecommendation: () => void;
    onOpenAlternateTimelines: () => void;
    onOpenImportCharacterCard: () => void;
    onOpenExportData: () => void;
    onOpenImportData: () => void;
    onOpenDataManager: () => void;
}

export function SettingsModal({
    isOpen,
    onClose,
    onOpenBudgetControl,
    onOpenGpuMonitor,
    onOpenParticipantControl,
    onOpenAccountData,
    onOpenMultiplayerData,
    onOpenJoinSession,
    onOpenAIRecommendation,
    onOpenAlternateTimelines,
    onOpenImportCharacterCard,
    onOpenExportData,
    onOpenImportData,
    onOpenDataManager,
}: SettingsModalProps) {
    const [activeTab, setActiveTab] = useState<SettingsTabId>('session');

    if (!isOpen) return null;

    const handleItemClick = (id: string) => {
        switch (id) {
            case 'budget-control': onOpenBudgetControl(); break;
            case 'gpu-monitor': onOpenGpuMonitor(); break;
            case 'participant-control': onOpenParticipantControl(); break;
            case 'account-data': onOpenAccountData(); break;
            case 'multiplayer-data': onOpenMultiplayerData(); break;
            case 'join-session': onOpenJoinSession(); break;
            case 'ai-recommendation': onOpenAIRecommendation(); break;
            case 'alternate-timelines': onOpenAlternateTimelines(); break;
            case 'import-character-card': onOpenImportCharacterCard(); break;
            case 'import-data': onOpenImportData(); break;
            case 'export-data': onOpenExportData(); break;
            case 'data-manager': onOpenDataManager(); break;
        }
    };

    const currentItems = TAB_ITEMS[activeTab];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-content-manager" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Settings</h2>
                    <div className="modal-header-actions">
                        <button type="button" className="close-button close-button-spaced" onClick={onClose}>×</button>
                    </div>
                </div>

                {/* Tab Bar */}
                <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                    {SETTINGS_TABS.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                <div className="modal-body">
                    <ul className="manager-list settings-list">
                        {currentItems.map(item => (
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