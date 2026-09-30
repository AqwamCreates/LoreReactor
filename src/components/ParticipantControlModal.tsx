// src/components/ParticipantControlModal.tsx
import { useState, useMemo } from 'react';
import type { Character, InteractionData, HistoryMessage } from '../types';
import { getCurrentLocationIndex } from '../utilities/locationLogic';
import '../main.css';

interface ParticipantControlModalProps {
    onClose: () => void;
    interactionData: InteractionData | null;
    isMultiplayerClient?: boolean;
    isAdministrator?: boolean;
    onUpdateInteractionData: (data: InteractionData) => void;
    onForceFirstMessage: (character: Character) => void;
    onSendCustomMessage: (character: Character, text: string) => void;
    onInjectCustomMessage: (character: Character, text: string) => void;
    onInjectFirstMessage: (character: Character) => void;
}

function deriveInitialOverrides(interactionData: InteractionData): {
    chatStamina: Record<string, number>;
    actionStamina: Record<string, number>;
    location: Record<string, number | ''>;
} {
    const chatStamina: Record<string, number> = {};
    const actionStamina: Record<string, number> = {};
    const location: Record<string, number | ''> = {};

    for (const p of interactionData.participants) {
        const lastMsg = [...interactionData.interactionHistory].reverse().find(m => m.character.id === p.id);
        chatStamina[p.id] = lastMsg?.remainingChatStamina ?? p.maximumChatStamina ?? 4;
        actionStamina[p.id] = lastMsg?.remainingActionStamina ?? p.maximumActionStamina ?? 5;
        const locIdx = getCurrentLocationIndex(interactionData, p);
        location[p.id] = locIdx !== undefined ? locIdx : '';
    }

    return { chatStamina, actionStamina, location };
}

export function ParticipantControlModal({
    interactionData,
    isMultiplayerClient = false,
    isAdministrator = false,
    onClose,
    onUpdateInteractionData,
    onForceFirstMessage,
    onSendCustomMessage,
    onInjectCustomMessage,
    onInjectFirstMessage,
}: Omit<ParticipantControlModalProps, 'isOpen' | 'interactionData'> & { interactionData: InteractionData }) {
    const isReadOnly = isMultiplayerClient && !isAdministrator;
    const initials = useMemo(() => deriveInitialOverrides(interactionData), [interactionData]);

    const [chatStaminaOverrides, setChatStaminaOverrides] = useState<Record<string, number>>(initials.chatStamina);
    const [actionStaminaOverrides, setActionStaminaOverrides] = useState<Record<string, number>>(initials.actionStamina);
    const [locationOverrides, setLocationOverrides] = useState<Record<string, number | ''>>(initials.location);
    const [selectedCharId, setSelectedCharId] = useState<string>('');
    const [customMessageText, setCustomMessageText] = useState('');

    const handleChatStaminaChange = (charId: string, value: number) => {
        setChatStaminaOverrides(prev => ({ ...prev, [charId]: value }));
    };

    const handleActionStaminaChange = (charId: string, value: number) => {
        setActionStaminaOverrides(prev => ({ ...prev, [charId]: value }));
    };

    const handleLocationChange = (charId: string, value: string) => {
        setLocationOverrides(prev => ({ ...prev, [charId]: value === '' ? '' : Number(value) }));
    };

    const applyOverrides = () => {
        if (isReadOnly) return;
        const updatedHistory = [...interactionData.interactionHistory];

        // Map of last message index per character
        const lastMsgIndices: Record<string, number> = {};
        for (let i = 0; i < updatedHistory.length; i++) {
            lastMsgIndices[updatedHistory[i].character.id] = i;
        }

        // Apply overrides to existing latest message, or create baseline for characters who haven't spoken yet
        for (const p of interactionData.participants) {
            const charId = p.id;
            const hasChatChanged = chatStaminaOverrides[charId] !== undefined && chatStaminaOverrides[charId] !== initials.chatStamina[charId];
            const hasActionChanged = actionStaminaOverrides[charId] !== undefined && actionStaminaOverrides[charId] !== initials.actionStamina[charId];
            const hasLocChanged = locationOverrides[charId] !== undefined && locationOverrides[charId] !== initials.location[charId];

            const idx = lastMsgIndices[charId];
            if (idx !== undefined) {
                updatedHistory[idx] = {
                    ...updatedHistory[idx],
                    remainingChatStamina: chatStaminaOverrides[charId] ?? updatedHistory[idx].remainingChatStamina,
                    remainingActionStamina: actionStaminaOverrides[charId] ?? updatedHistory[idx].remainingActionStamina,
                    locationIndex: locationOverrides[charId] === '' ? undefined : (locationOverrides[charId] !== undefined ? Number(locationOverrides[charId]) : updatedHistory[idx].locationIndex),
                };
            } else if (hasChatChanged || hasActionChanged || hasLocChanged) {
                // Character has not spoken yet: create baseline interaction record so their settings stick
                const now = Date.now();
                const baselineMsg: HistoryMessage = {
                    id: `init-${charId}-${now}`,
                    messageType: 'interaction',
                    character: p,
                    remainingChatStamina: chatStaminaOverrides[charId] ?? p.maximumChatStamina ?? 4,
                    remainingActionStamina: actionStaminaOverrides[charId] ?? p.maximumActionStamina ?? 5,
                    locationIndex: locationOverrides[charId] === '' || locationOverrides[charId] === undefined ? undefined : Number(locationOverrides[charId]),
                    characterClothingWearingStatuses: {},
                    characterLockedLocations: {},
                    parentInteractionMessageId: null,
                    firstCreatedTimestamp: now,
                    lastUpdatedTimestamp: now,
                };
                updatedHistory.push(baselineMsg);
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
        if (isReadOnly) return;
        const char = getSelectedCharacter();
        if (!char || !customMessageText.trim()) return;
        onSendCustomMessage(char, customMessageText.trim());
        setCustomMessageText('');
        onClose();
    };

    const handleInjectCustomMessage = () => {
        if (isReadOnly) return;
        const char = getSelectedCharacter();
        if (!char || !customMessageText.trim()) return;
        onInjectCustomMessage(char, customMessageText.trim());
        setCustomMessageText('');
        onClose();
    };

    const handleForceFirstMessage = () => {
        if (isReadOnly) return;
        const char = getSelectedCharacter();
        if (!char) return;
        onForceFirstMessage(char);
        onClose();
    };

    const handleInjectFirstMessage = () => {
        if (isReadOnly) return;
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
                    {/* Read-only banner for multiplayer clients */}
                    {isReadOnly && (
                        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444', padding: '8px 12px', borderRadius: '6px', fontSize: '0.75rem', marginBottom: '12px' }}>
                            🔒 Participant overrides and forced messages can only be applied by the host or an administrator.
                        </div>
                    )}

                    {/* Message Injection */}
                    <div className="editor-section">
                        <span className="editor-section-title">Message</span>
                        <div className="entity-ref-hint">
                            Select a participant to send or inject messages. "Send" broadcasts the message and allows the story to continue. "Inject" silently inserts the message into chat history without triggering an AI response turn.
                        </div>

                        <select
                            value={selectedCharId}
                            onChange={e => setSelectedCharId(e.target.value)}
                            className="editor-select"
                            style={{ marginTop: '8px' }}
                            disabled={isReadOnly}
                        >
                            <option value="">Select character...</option>
                            {interactionData.participants.map(p => {
                                const isProtag = interactionData.protagonists?.some(pr => pr.id === p.id);
                                return (
                                    <option key={p.id} value={p.id}>
                                        {p.name} {isProtag ? '★ (Protagonist)' : '(NPC)'}
                                    </option>
                                );
                            })}
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
                                disabled={isReadOnly}
                            />
                            <div className="participant-control-button-row">
                                <button
                                    type="button"
                                    className="editor-button editor-button-save"
                                    disabled={isReadOnly || !selectedCharId || !customMessageText.trim()}
                                    onClick={handleSendCustomMessage}
                                >
                                    Send Current Message
                                </button>
                                <button
                                    type="button"
                                    className="editor-button editor-button-cancel"
                                    disabled={isReadOnly || !selectedCharId || !customMessageText.trim()}
                                    onClick={handleInjectCustomMessage}
                                >
                                    Inject Current Message (Silent)
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
                                    disabled={isReadOnly || !selectedCharId}
                                    onClick={handleForceFirstMessage}
                                >
                                    Send First Message
                                </button>
                                <button
                                    type="button"
                                    className="editor-button editor-button-cancel"
                                    disabled={isReadOnly || !selectedCharId}
                                    onClick={handleInjectFirstMessage}
                                >
                                    Inject First Message (Silent)
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
                                const current = chatStaminaOverrides[p.id] ?? maxStamina;
                                const hasSpoken = interactionData.interactionHistory.some(m => m.character.id === p.id);

                                return (
                                    <div key={p.id} className="participant-control-stamina-row">
                                        <span className="participant-control-stamina-name">
                                            {p.name} {!hasSpoken && <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>(New)</span>}
                                        </span>
                                        <div className="participant-control-stamina-input-group">
                                            <label className="participant-control-stamina-label">Stamina:</label>
                                            <input
                                                type="number"
                                                value={current}
                                                onChange={e => handleChatStaminaChange(p.id, Number(e.target.value) || 0)}
                                                className="editor-input participant-control-stamina-input"
                                                min="0"
                                                max={maxStamina * 2}
                                                step="1"
                                                disabled={isReadOnly}
                                            />
                                            <span className="participant-control-stamina-max">/ {maxStamina}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Action Stamina Overrides */}
                    <div className="editor-section">
                        <span className="editor-section-title">Action Stamina</span>
                        <div className="entity-ref-hint">
                            Override remaining action stamina for each participant. Controls how many silent actions (movement, non-chat interactions) they can perform before needing rest. Applies to the latest message from each character.
                        </div>

                        <div className="participant-control-stamina-list">
                            {interactionData.participants.map(p => {
                                const maxActionStamina = p.maximumActionStamina ?? 5;
                                const current = actionStaminaOverrides[p.id] ?? maxActionStamina;
                                const hasSpoken = interactionData.interactionHistory.some(m => m.character.id === p.id);

                                return (
                                    <div key={p.id} className="participant-control-stamina-row">
                                        <span className="participant-control-stamina-name">
                                            {p.name} {!hasSpoken && <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>(New)</span>}
                                        </span>
                                        <div className="participant-control-stamina-input-group">
                                            <label className="participant-control-stamina-label">Stamina:</label>
                                            <input
                                                type="number"
                                                value={current}
                                                onChange={e => handleActionStaminaChange(p.id, Number(e.target.value) || 0)}
                                                className="editor-input participant-control-stamina-input"
                                                min="0"
                                                max={maxActionStamina * 2}
                                                step="1"
                                                disabled={isReadOnly}
                                            />
                                            <span className="participant-control-stamina-max">/ {maxActionStamina}</span>
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
                                                disabled={isReadOnly}
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
                        disabled={isReadOnly}
                        onClick={applyOverrides}
                    >
                        Apply Overrides
                    </button>
                </div>
            </div>
        </div>
    );
}