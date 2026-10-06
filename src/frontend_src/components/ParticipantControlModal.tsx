// frontend-src/components/ParticipantControlModal.tsx
import { useState, useMemo } from 'react';
import type { Character, InteractionData, HistoryMessage } from '../types';
import { findLatestMessage } from '../utilities/messageLogic';
import { v4 as uuidv4 } from 'uuid';
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
    location: Record<string, string | ''>;
} {
    const chatStamina: Record<string, number> = {};
    const actionStamina: Record<string, number> = {};
    const location: Record<string, string | ''> = {};

    for (const p of interactionData.participants) {
        // FIX: Use spatial findLatestMessage to accurately resolve the character's current state
        const latest = findLatestMessage(interactionData, p);
        const lastMsg = latest?.message;
        
        chatStamina[p.id] = lastMsg?.remainingChatStamina ?? p.maximumChatStamina ?? 4;
        actionStamina[p.id] = lastMsg?.remainingActionStamina ?? p.maximumActionStamina ?? 5;
        location[p.id] = latest?.locationId ?? '';
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
    // FIX: Location overrides now use string IDs instead of number indices
    const [locationOverrides, setLocationOverrides] = useState<Record<string, string | ''>>(initials.location);
    const [selectedCharId, setSelectedCharId] = useState<string>('');
    const [customMessageText, setCustomMessageText] = useState('');

    const handleChatStaminaChange = (charId: string, value: number) => {
        setChatStaminaOverrides(prev => ({ ...prev, [charId]: value }));
    };

    const handleActionStaminaChange = (charId: string, value: number) => {
        setActionStaminaOverrides(prev => ({ ...prev, [charId]: value }));
    };

    const handleLocationChange = (charId: string, value: string) => {
        setLocationOverrides(prev => ({ ...prev, [charId]: value }));
    };

    const applyOverrides = () => {
        if (isReadOnly) return;
        
        const updatedHistories = { ...interactionData.interactionHistories };
        let changed = false;

        for (const p of interactionData.participants) {
            const charId = p.id;
            const hasChatChanged = chatStaminaOverrides[charId] !== undefined && chatStaminaOverrides[charId] !== initials.chatStamina[charId];
            const hasActionChanged = actionStaminaOverrides[charId] !== undefined && actionStaminaOverrides[charId] !== initials.actionStamina[charId];
            const hasLocChanged = locationOverrides[charId] !== undefined && locationOverrides[charId] !== initials.location[charId];

            const latest = findLatestMessage(interactionData, p);
            
            if (latest) {
                const { message, locationId } = latest;
                const locMsgs = updatedHistories[locationId] ? [...updatedHistories[locationId]] : [];
                const msgIdx = locMsgs.findIndex(m => m.id === message.id);
                
                const updatedMsg = { ...message };
                let msgChanged = false;

                if (hasChatChanged) {
                    updatedMsg.remainingChatStamina = chatStaminaOverrides[charId];
                    msgChanged = true;
                }
                if (hasActionChanged) {
                    updatedMsg.remainingActionStamina = actionStaminaOverrides[charId];
                    msgChanged = true;
                }
                
                if (msgChanged && msgIdx !== -1) {
                    locMsgs[msgIdx] = updatedMsg;
                    updatedHistories[locationId] = locMsgs;
                    changed = true;
                }
                
                // Handle spatial location change
                if (hasLocChanged && locationOverrides[charId] !== '') {
                    const newLocId = locationOverrides[charId] as string;
                    if (newLocId !== locationId) {
                        // Mark old message as not present
                        if (msgIdx !== -1) {
                            const oldLocMsgs = updatedHistories[locationId] ? [...updatedHistories[locationId]] : [];
                            const oldIdx = oldLocMsgs.findIndex(m => m.id === message.id);
                            if (oldIdx !== -1) {
                                oldLocMsgs[oldIdx] = { ...oldLocMsgs[oldIdx], isPresent: false };
                                updatedHistories[locationId] = oldLocMsgs;
                            }
                        }
                        
                        // Add to new location
                        const newLocMsgs = updatedHistories[newLocId] ? [...updatedHistories[newLocId]] : [];
                        const moveMsg: HistoryMessage = {
                            ...updatedMsg, // Inherit updated stamina
                            id: uuidv4(),
                            messageType: 'interaction',
                            isPresent: true,
                            isConverged: newLocMsgs.length > 0,
                            parentMessageId: message.id,
                            firstCreatedTimestamp: Date.now(),
                            lastUpdatedTimestamp: Date.now(),
                        };
                        newLocMsgs.push(moveMsg);
                        updatedHistories[newLocId] = newLocMsgs;
                        changed = true;
                    }
                }
            } else if (hasChatChanged || hasActionChanged || hasLocChanged) {
                // Character has not spoken yet: create baseline interaction record so their settings stick
                const now = Date.now();
                const targetLocId = (hasLocChanged && locationOverrides[charId] !== '') 
                    ? locationOverrides[charId] as string 
                    : (initials.location[charId] !== '' ? initials.location[charId] as string : undefined);
                    
                if (targetLocId) {
                    const newLocMsgs = updatedHistories[targetLocId] ? [...updatedHistories[targetLocId]] : [];
                    const baselineMsg: HistoryMessage = {
                        id: `init-${charId}-${now}`,
                        messageType: 'interaction',
                        character: p,
                        isPresent: true,
                        remainingChatStamina: hasChatChanged ? chatStaminaOverrides[charId] : (p.maximumChatStamina ?? 4),
                        remainingActionStamina: hasActionChanged ? actionStaminaOverrides[charId] : (p.maximumActionStamina ?? 5),
                        characterClothingWearingStatuses: {},
                        characterLockedLocations: {},
                        parentMessageId: null,
                        firstCreatedTimestamp: now,
                        lastUpdatedTimestamp: now,
                    };
                    newLocMsgs.push(baselineMsg);
                    updatedHistories[targetLocId] = newLocMsgs;
                    changed = true;
                }
            }
        }

        if (!changed) {
            onClose();
            return;
        }

        const updated: InteractionData = {
            ...interactionData,
            interactionHistories: updatedHistories,
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
                                // ✅ FIX: Use protagonistIds string array instead of protagonists Character array
                                const isProtag = interactionData.protagonistIds?.includes(p.id) ?? false;
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
                                // FIX: Replaced flat array .some() with spatial findLatestMessage
                                const hasSpoken = !!findLatestMessage(interactionData, p);

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
                                const hasSpoken = !!findLatestMessage(interactionData, p);

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
                            Override the current location for each participant. This routes their presence to the correct spatial bucket, controlling which location context is active for them.
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
                                                {/* FIX: Replaced array indices with locationId strings */}
                                                {locations.map((loc) => (
                                                    <option key={loc.id} value={loc.id}>{loc.name}</option>
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