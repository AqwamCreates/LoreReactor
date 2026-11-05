// src/frontend_src/components/ViewModeDropdown.tsx
import type React from 'react';
import { useRef, useEffect } from 'react';
import type { viewMode } from './views/types';

interface ViewModeOption {
    id: viewMode;
    label: string;
    icon: string;
    description: string;
}

const VIEW_MODE_OPTIONS: ViewModeOption[] = [
    { id: 'ladder', label: 'Ladder', icon: '📜', description: 'Standard chat message bubbles' },
    { id: 'cinematic', label: 'Cinematic', icon: '🎥', description: 'Spotlight character avatar' },
    { id: 'visual novel', label: 'Visual Novel', icon: '📖', description: 'Sprite stage & dialogue box' },
    { id: 'card', label: 'Card', icon: '🎴', description: 'Stacked fate decree cards' },
];

interface ViewModeDropdownProps {
    currentMode: viewMode;
    onSelectMode: (mode: viewMode) => void;
    isOpen: boolean;
    onToggle: () => void;
    onClose: () => void;
}

export const ViewModeDropdown: React.FC<ViewModeDropdownProps> = ({ 
    currentMode, 
    onSelectMode, 
    isOpen, 
    onToggle, 
    onClose 
}) => {
    const rootRef = useRef<HTMLDivElement>(null);

    const activeOption = VIEW_MODE_OPTIONS.find((o) => o.id === currentMode) || VIEW_MODE_OPTIONS[0];

    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (e: MouseEvent | TouchEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) onClose();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown, { passive: true });
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen, onClose]);

    return (
        <div ref={rootRef} className={`view-mode-dropdown-root ${isOpen ? 'open' : ''}`}>
            <button
                type="button"
                className={`view-mode-toggle ${isOpen ? 'active' : ''}`}
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                }}
                title={`Current view: ${activeOption.label}. Click to switch view mode`}
                aria-haspopup="menu"
                aria-expanded={isOpen}
            >
                <span>{activeOption.icon}</span>
                <span className="view-mode-label">{activeOption.label}</span>
                <span className="view-mode-caret">▾</span>
            </button>

            {isOpen && (
                <div className="dropdown-panel" role="menu" aria-label="View Modes" style={{ width: 250 }}>
                    <div className="dropdown-panel-header">
                        <span>View Mode</span>
                    </div>

                    <div className="dropdown-panel-body">
                        {VIEW_MODE_OPTIONS.map((option) => {
                            const isSelected = option.id === currentMode;
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    className={`view-mode-dropdown-item ${isSelected ? 'selected' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSelectMode(option.id);
                                        onClose(); 
                                    }}
                                    role="menuitemradio"
                                    aria-checked={isSelected}
                                >
                                    <span className="view-mode-dropdown-item-icon">{option.icon}</span>
                                    <div className="view-mode-dropdown-item-info">
                                        <span className="view-mode-dropdown-item-label">{option.label}</span>
                                        <span className="view-mode-dropdown-item-desc">{option.description}</span>
                                    </div>
                                    {isSelected && <span className="view-mode-dropdown-item-check">✓</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ViewModeDropdown;