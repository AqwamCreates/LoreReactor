// src/components/ParticipantControlModal.tsx
import { useState, useEffect } from 'react';
import type { Character, InteractionData } from '../types';
import { getCurrentLocationIndex } from '../hooks/locationLogic';
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
    const [locationOverrides, setLocationOverrides] = useState<Record<string, number | ''>>({});
    const [selectedCharId, setSelectedCharId] = useState<string>('');
    const [customMessageText, setCustomMessageText] = useState('');

    useEffect(() => {
        if (isOpen && interactionData) {
            const staminaOv: Record<string, number> = {};
            const locationOv: Record<string, number | ''> = {};
            for (const p of interactionData.participants) {
                const lastMsg = [...interactionData.interactionHistory].reverse().find(m => m.character.id === p.id);
                staminaOv[p.id] = lastMsg?.remainingChatStamina ?? p.maximumChatStamina ?? 4;
                const locIdx = getCurrentLocationIndex(interactionData, p);
                locationOv[p.id] = locIdx !== undefined ? locIdx : '';
            }
            setStaminaOverrides(staminaOv);
            setLocationOverrides(locationOv);
            setSelectedCharId('');
            setCustomMessageText('');
        }
    }, [isOpen, interactionData]);

    if (!isOpen || !interactionData) return null;

    const handleStaminaChange = (charId: string, value: number) => {
        setStaminaOverrides(prev => ({ ...prev, [charId]: value }));
    };

    const handleLocationChange = (charId: string, value: string) => {
        setLocationOverrides(prev => ({ ...prev, [charId]: value === '' ? '' : Number(value) }));
    };

    const applyOverrides = () => {
        if (!interactionData) return;

        const updatedHistory = [...interactionData.interactionHistory];

        // Apply stamina overrides to latest message per character
        const lastMsgInrolls: Record<string, number> = {};
        for (let i = 0; i < updatedHistory.length; i++) {
            lastMsgInrolls[updatedHistory[i].character.id] = i;
        }
        for (const [charId, stamina] of Object.entries(staminaOverrides)) {
            const idx = lastMsgInrolls[charId];
            if (idx !== undefined) {
                updatedHistory[idx] = { ...updatedHistory[idx], remainingChatStamina: stamina };
            }
        }

        // Apply location overrides to latest message per character
        for (const [charId, locIdx] of Object.entries(locationOverrides)) {
            const idx = lastMsgInrolls[charId];
            if (idx !== undefined) {
                updatedHistory[idx] = {
                    ...updatedHistory[idx],
                    locationIndex: locIdx === '' ? undefined : locIdx,
                };
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

    const locations = interactionData.locations ?? [];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Participant Control</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
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
                                    className="editor-button editor-button-save"
                                    disabled={!selectedCharId || !customMessageText.trim()}
                                    onClick={handleSendCustomMessage}
                                >
                                    Send Current Message
                                </button>
                                <button
                                    type="button"
                                    className="editor-button editor-button-cancel"
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
                                    className="editor-button editor-button-save"
                                    disabled={!selectedCharId}
                                    onClick={handleForceFirstMessage}
                                >
                                    Send First Message
                                </button>
                                <button
                                    type="button"
                                    className="editor-button editor-button-cancel"
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
                    </div>

                    {/* Location Overrides */}
                    <div className="editor-section">
                        <span className="editor-section-title">Location</span>
                        <div className="entity-ref-hint">
                            Override the current location for each participant. This sets the locationIndex on their latest message, controlling which location context is active for them.
                        </div>

                        <div className="participant-control-stamina-list">
                            {interactionData.participants.map(p => {
                                const currentLoc = locationOverrides[p.id];

                                return (
                                    <div key={p.id} className="participant-control-stamina-row">
                                        <span className="participant-control-stamina-name">{p.name}</span>
                                        <div className="participant-control-stamina-input-group">
                                            <label className="participant-control-stamina-label">Location:</label>
                                            <select
                                                value={currentLoc === undefined ? '' : String(currentLoc)}
                                                onChange={e => handleLocationChange(p.id, e.target.value)}
                                                className="editor-select participant-control-stamina-input"
                                                style={{ minWidth: '140px' }}
                                            >
                                                <option value="">None</option>
                                                {locations.map((loc, idx) => (
                                                    <option key={loc.id} value={String(idx)}>{loc.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Apply Button */}
                    <button
                        type="button"
                        className="editor-button editor-button-save participant-control-apply-button"
                        onClick={applyOverrides}
                    >
                        Apply Overrides
                    </button>
                </div>
            </div>
        </div>
    );
}