// src/components/CharacterAdvancedSettingsEditorModal.tsx
import type React from 'react';
import type { Sampler } from '../types';
import './main.css';

interface CharacterAdvancedSettingsEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    initiativeWeightStr: string;
    chatProbabilityStr: string;
    maximumChatStaminaStr: string;
    numberOfMessagesToDisableThinkPromptStr: string;
    numberOfMessagesToDisableMetaThinkInstructionsStr: string;
    numberOfMessagesToDisableDialoguePromptStr: string;
    enableMemoryWriting: boolean;
    enableMemoryReading: boolean;
    selectedStopPatternIds: string[];
    allSamplers: Sampler[];
    isUploading: boolean;
    onInitiativeWeightChange: (val: string) => void;
    onChatProbabilityChange: (val: string) => void;
    onMaximumChatStaminaChange: (val: string) => void;
    onDisableThinkChange: (val: string) => void;
    onDisableMetaChange: (val: string) => void;
    onDisableDialogueChange: (val: string) => void;
    onEnableMemoryWritingChange: (val: boolean) => void;
    onEnableMemoryReadingChange: (val: boolean) => void;
    onStopPatternToggle: (id: string) => void;
}

export function CharacterAdvancedSettingsEditorModal({
    isOpen,
    onClose,
    initiativeWeightStr,
    chatProbabilityStr,
    maximumChatStaminaStr,
    numberOfMessagesToDisableThinkPromptStr,
    numberOfMessagesToDisableMetaThinkInstructionsStr,
    numberOfMessagesToDisableDialoguePromptStr,
    enableMemoryWriting,
    enableMemoryReading,
    selectedStopPatternIds,
    allSamplers,
    isUploading,
    onInitiativeWeightChange,
    onChatProbabilityChange,
    onMaximumChatStaminaChange,
    onDisableThinkChange,
    onDisableMetaChange,
    onDisableDialogueChange,
    onEnableMemoryWritingChange,
    onEnableMemoryReadingChange,
    onStopPatternToggle,
}: CharacterAdvancedSettingsEditorModalProps) {
    if (!isOpen) return null;

    const getStopPatternById = (id: string) => {
        for (const s of allSamplers) {
            const found = s.stopPatterns.find(sp => sp.id === id);
            if (found) return found;
        }
        return null;
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Advanced Settings</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-save" onClick={onClose}>Done</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">

                    {/* Stats */}
                    <div className="editor-section">
                        <span className="editor-section-title">Character Stats</span>
                        <div className="editor-stats-grid">
                            <div>
                                <label className="editor-label editor-label-small">Initiative Weight</label>
                                <input
                                    type="number" step="0.1"
                                    value={initiativeWeightStr}
                                    onChange={(e) => onInitiativeWeightChange(e.target.value)}
                                    className="editor-input editor-stat-input"
                                    disabled={isUploading}
                                />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Chat Probability</label>
                                <input
                                    type="number" step="0.05"
                                    value={chatProbabilityStr}
                                    onChange={(e) => onChatProbabilityChange(e.target.value)}
                                    className="editor-input editor-stat-input"
                                    disabled={isUploading}
                                />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Maximum Chat Stamina</label>
                                <input
                                    type="number" step="1" min="0"
                                    value={maximumChatStaminaStr}
                                    onChange={(e) => onMaximumChatStaminaChange(e.target.value)}
                                    className="editor-input editor-stat-input"
                                    disabled={isUploading}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Disable Prompts */}
                    <div className="editor-section">
                        <span className="editor-section-title">Disable Prompts After X Messages</span>
                        <div className="editor-stats-grid">
                            <div>
                                <label className="editor-label editor-label-small">Think Prompt</label>
                                <input
                                    type="number" step="1" min="0"
                                    value={numberOfMessagesToDisableThinkPromptStr}
                                    onChange={(e) => onDisableThinkChange(e.target.value)}
                                    className="editor-input editor-stat-input"
                                    disabled={isUploading}
                                />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Meta-Thinking</label>
                                <input
                                    type="number" step="1" min="0"
                                    value={numberOfMessagesToDisableMetaThinkInstructionsStr}
                                    onChange={(e) => onDisableMetaChange(e.target.value)}
                                    className="editor-input editor-stat-input"
                                    disabled={isUploading}
                                />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Dialogue Prompt</label>
                                <input
                                    type="number" step="1" min="0"
                                    value={numberOfMessagesToDisableDialoguePromptStr}
                                    onChange={(e) => onDisableDialogueChange(e.target.value)}
                                    className="editor-input editor-stat-input"
                                    disabled={isUploading}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Memory Toggles */}
                    <div className="editor-section">
                        <span className="editor-section-title">Memory</span>

                        <label className="editor-checkbox-label">
                            <input
                                type="checkbox"
                                checked={enableMemoryReading}
                                onChange={(e) => onEnableMemoryReadingChange(e.target.checked)}
                                className="editor-checkbox-input"
                                disabled={isUploading}
                            />
                            <span>Enable Memory Reading</span>
                        </label>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                            This character will recall past interactions across chat sessions. Can be overridden by profile settings.
                        </div>

                        <label className="editor-checkbox-label" style={{ marginTop: '8px' }}>
                            <input
                                type="checkbox"
                                checked={enableMemoryWriting}
                                onChange={(e) => onEnableMemoryWritingChange(e.target.checked)}
                                className="editor-checkbox-input"
                                disabled={isUploading}
                            />
                            <span>Enable Memory Writing</span>
                        </label>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                            Allow this character to save new memories based on the language model's decisions. Can be overridden by profile settings.
                        </div>
                    </div>

                    {/* Stop Patterns */}
                    <div className="editor-section">
                        <span className="editor-section-title">Character Stop Patterns</span>
                        <div className="editor-stop-patterns-hint">
                            Specific stop sequences for this character (overrides/augments sampler defaults).
                        </div>

                        <div className="sampler-stop-patterns-list">
                            {selectedStopPatternIds.length === 0 && (
                                <div className="sampler-stop-empty">No character-specific stop patterns assigned.</div>
                            )}
                            {selectedStopPatternIds.map(id => {
                                const sp = getStopPatternById(id);
                                if (!sp) return null;
                                return (
                                    <div key={id} className="sampler-stop-item">
                                        <div className="sampler-stop-info">
                                            <span className="sampler-stop-name">{sp.name}</span>
                                            <span className="sampler-stop-pattern">{sp.pattern}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => onStopPatternToggle(id)}
                                            className="sampler-stop-remove-btn"
                                            title="Remove stop pattern"
                                        >
                                            ×
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <select
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val) onStopPatternToggle(val);
                                e.target.value = '';
                            }}
                            className="editor-select"
                            defaultValue=""
                            disabled={isUploading}
                        >
                            <option value="" disabled>+ Add a stop pattern</option>
                            {allSamplers.flatMap(s => s.stopPatterns)
                                .filter((sp, index, self) => index === self.findIndex(t => t.id === sp.id))
                                .filter(sp => !selectedStopPatternIds.includes(sp.id))
                                .map(sp => (
                                    <option key={sp.id} value={sp.id}>{sp.name} — {sp.pattern}</option>
                                ))
                            }
                        </select>
                    </div>

                </div>
            </div>
        </div>
    );
}