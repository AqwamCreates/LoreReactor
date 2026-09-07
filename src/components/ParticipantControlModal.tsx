// src/components/ParticipantControlModal.tsx
import { useState, useEffect } from 'react';
import type { Character, InteractionData } from '../types';
import './main.css';

interface ParticipantControlModalProps {
    isOpen: boolean;
    onClose: () => void;
    interactionData: InteractionData | null;
    onUpdateInteractionData: (data: InteractionData) => void;
    onForceFirstMessage: (character: Character) => void;
    onSendCustomMessage: (character: Character, text: string) => void;
    onInjectCustomMessage: (character: Character, text: string) => void;
    onInjectFirstMessage: (character: Character) => void;
}

export function ParticipantControlModal({
    isOpen,
    onClose,
    interactionData,
    onUpdateInteractionData,
    onForceFirstMessage,
    onSendCustomMessage,
    onInjectCustomMessage,
    onInjectFirstMessage,
}: ParticipantControlModalProps) {
    const [staminaOverrides, setStaminaOverrides] = useState<Record<string, number>>({});
    const [selectedCharId, setSelectedCharId] = useState<string>('');
    const [customMessageText, setCustomMessageText] = useState('');

    useEffect(() => {
        if (isOpen && interactionData) {
            const overrides: Record<string, number> = {};
            for (const p of interactionData.participants) {
                const lastMsg = [...interactionData.interactionHistory].reverse().find(m => m.character.id === p.id);
                overrides[p.id] = lastMsg?.remainingChatStamina ?? p.maximumChatStamina ?? 4;
            }
            setStaminaOverrides(overrides);
            setSelectedCharId('');
            setCustomMessageText('');
        }
    }, [isOpen, interactionData]);

    if (!isOpen || !interactionData) return null;

    const handleStaminaChange = (charId: string, value: number) => {
        setStaminaOverrides(prev => ({ ...prev, [charId]: value }));
    };

    const applyStaminaOverrides = () => {
        if (!interactionData) return;

        const updatedHistory = interactionData.interactionHistory.map(msg => {
            if (staminaOverrides[msg.character.id] !== undefined) {
                return { ...msg, remainingChatStamina: staminaOverrides[msg.character.id] };
            }
            return msg;
        });

        const lastMsgIndices: Record<string, number> = {};
        for (let i = 0; i < updatedHistory.length; i++) {
            lastMsgIndices[updatedHistory[i].character.id] = i;
        }
        for (const [charId, stamina] of Object.entries(staminaOverrides)) {
            const idx = lastMsgIndices[charId];
            if (idx !== undefined) {
                updatedHistory[idx] = { ...updatedHistory[idx], remainingChatStamina: stamina };
            }
        }

        const updated: InteractionData = {
            ...interactionData,
            interactionHistory: updatedHistory,
            lastUpdatedTimestamp: Date.now(),
        };

        onUpdateInteractionData(updated);
        onClose();
    };

    const getSelectedCharacter = (): Character | null => {
        if (!selectedCharId) return null;
        return interactionData.participants.find(p => p.id === selectedCharId) ?? null;
    };

    const handleSendCustomMessage = () => {
        const char = getSelectedCharacter();
        if (!char || !customMessageText.trim()) return;
        onSendCustomMessage(char, customMessageText.trim());
        setCustomMessageText('');
        onClose();
    };

    const handleInjectCustomMessage = () => {
        const char = getSelectedCharacter();
        if (!char || !customMessageText.trim()) return;
        onInjectCustomMessage(char, customMessageText.trim());
        setCustomMessageText('');
        onClose();
    };

    const handleForceFirstMessage = () => {
        const char = getSelectedCharacter();
        if (!char) return;
        onForceFirstMessage(char);
        onClose();
    };

    const handleInjectFirstMessage = () => {
        const char = getSelectedCharacter();
        if (!char) return;
        onInjectFirstMessage(char);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Participant Control</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Cancel</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Message Injection */}
                    <div className="editor-section">
                        <span className="editor-section-title">Message</span>
                        <div className="entity-ref-hint">
                            Select a participant to send or inject messages. "Send" adds a complete message to chat history. "Inject" feeds text directly into the LLM prompt without storing it.
                        </div>

                        <select
                            value={selectedCharId}
                            onChange={e => setSelectedCharId(e.target.value)}
                            className="editor-select"
                            style={{ marginTop: '8px' }}
                        >
                            <option value="">Select character...</option>
                            {interactionData.participants.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>

                        {/* Current Message Subsection */}
                        <div className="participant-control-subsection">
                            <span className="participant-control-subsection-title">Current Message</span>
                            <textarea
                                value={customMessageText}
                                onChange={e => setCustomMessageText(e.target.value)}
                                className="editor-textarea"
                                placeholder="Type the message content..."
                                rows={3}
                            />
                            <div className="participant-control-button-row">
                                <button
                                    type="button"
                                    className="editor-btn editor-btn-save"
                                    disabled={!selectedCharId || !customMessageText.trim()}
                                    onClick={handleSendCustomMessage}
                                >
                                    Send Current Message
                                </button>
                                <button
                                    type="button"
                                    className="editor-btn editor-btn-cancel"
                                    disabled={!selectedCharId || !customMessageText.trim()}
                                    onClick={handleInjectCustomMessage}
                                >
                                    Inject Current Message
                                </button>
                            </div>
                        </div>

                        {/* First Message Subsection */}
                        <div className="participant-control-subsection">
                            <span className="participant-control-subsection-title">First Message</span>
                            <div className="participant-control-button-row">
                                <button
                                    type="button"
                                    className="editor-btn editor-btn-save"
                                    disabled={!selectedCharId}
                                    onClick={handleForceFirstMessage}
                                >
                                    Send First Message
                                </button>
                                <button
                                    type="button"
                                    className="editor-btn editor-btn-cancel"
                                    disabled={!selectedCharId}
                                    onClick={handleInjectFirstMessage}
                                >
                                    Inject First Message
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Chat Stamina Overrides */}
                    <div className="editor-section">
                        <span className="editor-section-title">Chat Stamina</span>
                        <div className="entity-ref-hint">
                            Override remaining chat stamina for each participant. Higher values allow more paragraphs per turn. Applies to the latest message from each character.
                        </div>

                        <div className="participant-control-stamina-list">
                            {interactionData.participants.map(p => {
                                const maxStamina = p.maximumChatStamina ?? 4;
                                const current = staminaOverrides[p.id] ?? maxStamina;

                                return (
                                    <div key={p.id} className="participant-control-stamina-row">
                                        <span className="participant-control-stamina-name">{p.name}</span>
                                        <div className="participant-control-stamina-input-group">
                                            <label className="participant-control-stamina-label">Stamina:</label>
                                            <input
                                                type="number"
                                                value={current}
                                                onChange={e => handleStaminaChange(p.id, Number(e.target.value) || 0)}
                                                className="editor-input participant-control-stamina-input"
                                                min="0"
                                                max={maxStamina * 2}
                                                step="1"
                                            />
                                            <span className="participant-control-stamina-max">/ {maxStamina}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            type="button"
                            className="editor-btn editor-btn-save participant-control-apply-btn"
                            onClick={applyStaminaOverrides}
                        >
                            Apply Stamina Overrides
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}