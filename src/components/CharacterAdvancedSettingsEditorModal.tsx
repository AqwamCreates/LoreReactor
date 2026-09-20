// src/components/CharacterAdvancedSettingsEditorModal.tsx
import { useState } from 'react';
import type { Sampler, tool } from '../types';
import '../main.css';

const TOOL_LABELS: Record<tool, string> = {
    pick: 'Random Pick',
    date: 'Current Date & Time',
    coin: 'Coin Flip',
    dice: 'Roll Dice',
    random: 'Random Number',
    rng: 'RNG Table',
    move: 'Move',
    timer: 'Timer',
    stopwatch: 'Stopwatch',
    calculator: 'Calculator',
    web: 'Web Search',
    dialogue: 'Dialogue',
    knowledge: 'Knowledge',
    memory: 'Memory',
    lookup: 'Look Up',
    map: 'Map',
    audio: 'Audio',
    clothing: 'Clothing',
    note: 'Note',
    inventory: 'Inventory',
    invite: 'Invite Participant',
    kick: 'Kick Participant',
    teleport: 'Teleport',
    key: 'Key',
    summon: 'Summon Character',
    narrate: 'Narrate',
    inspect: 'Inspect',
    administrator: 'Administrator',
    creator: 'Creator',
    destroyer: 'Destroyer',
};

const TOOL_DESCRIPTIONS: Record<tool, string> = {
    pick: 'Allow this character to randomly pick from a list of options.',
    date: 'Allow this character to check the current date and time during conversation.',
    coin: 'Allow this character to flip a coin during conversation.',
    dice: 'Allow this character to roll dice, such as 2d6+3, during conversation.',
    random: 'Allow this character to generate random numbers during conversation.',
    rng: 'Allow this character to roll on named RNG tables defined in contexts.',
    move: 'Allow this character to move between adjacent locations using normal movement cost.',
    timer: 'Allow this character to set, check, and manage countdown timers.',
    stopwatch: 'Allow this character to start, pause, resume, and stop stopwatches.',
    calculator: 'Allow this character to perform calculations during conversation.',
    web: 'Allow this character to search the web during conversation.',
    dialogue: 'Allow this character to reference its own dialogue prompts.',
    knowledge: 'Allow this character to access its knowledge prompts on demand. Knowledge is not injected into context unless explicitly recalled via this tool.',
    memory: 'Allow this character to recall its own memories on demand. Memories are not injected into context unless explicitly recalled via this tool.',
    lookup: 'Allow this character to search contexts and lore by keyword.',
    map: 'Allow this character to check distances between locations.',
    audio: 'Allow this character to play and stop audio tracks during conversation.',
    clothing: 'Allow this character to wear and take off clothing.',
    note: 'Allow this character to save, retrieve, and manage persistent notes.',
    inventory: 'Allow this character to add, remove, set, and list inventory items.',
    invite: 'Allow this character to bring an existing participant, except the protagonist, to the current location.',
    kick: 'Allow this character to move an existing participant, including the protagonist, out of the current location to another one.',
    teleport: 'Allow this character to instantly move self or a target to any location regardless of adjacency, bypassing normal movement cost.',
    key: 'Allow this character to lock or unlock a location.',
    summon: 'Allow this character to add a non-participant character into the current interaction session.',
    narrate: 'Allow this character to inject ambient narration as the narrator voice without consuming character chat stamina.',
    inspect: 'Allow this character to examine another character\'s visible state such as name, location, expression, or inventory.',
    administrator: 'Allow this character to perform high-level administrative actions such as managing chat sessions, models, navigation, and user-data-related controls.',
    creator: 'Allow this character to create user-data-related entities such as characters, contexts, locations, worlds, prompt blocks, profiles, or other supported data.',
    destroyer: 'Allow this character to delete or destroy user-data-related entities. Enable with caution.',
};

type TabId = 'stats' | 'decay' | 'tools' | 'stopPatterns';

interface CharacterAdvancedSettingsEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    initiativeWeightStr: string;
    chatProbabilityStr: string;
    maximumChatStaminaStr: string;
    nameSensitivityStr: string;
    chatImpatienceSensitivityStr: string;
    skipProbabilityStr: string;
    memoryRetentionWeightStr: string;
    contextSensitivityStr: string;
    maximumActionStaminaStr: string;
    numberOfMessagesToDisableThinkPromptStr: string;
    numberOfMessagesToDisableMetaThinkInstructionsStr: string;
    numberOfMessagesToDisableDialoguePromptStr: string;
    numberOfMessagesToDisableStarterPromptStr: string;
    tools: Record<tool, boolean>;
    selectedStopPatternIds: string[];
    allSamplers: Sampler[];
    isUploading: boolean;
    onInitiativeWeightChange: (val: string) => void;
    onChatProbabilityChange: (val: string) => void;
    onMaximumChatStaminaChange: (val: string) => void;
    onNameSensitivityChange: (val: string) => void;
    onSkipProbabilityChange: (val: string) => void;
    onChatImpatienceSensitivityChange: (val: string) => void;
    onMemoryRetentionWeightChange: (val: string) => void;
    onContextSensitivityChange: (val: string) => void;
    onMaximumActionStaminaChange: (val: string) => void;
    onDisableThinkChange: (val: string) => void;
    onDisableMetaChange: (val: string) => void;
    onDisableDialogueChange: (val: string) => void;
    onDisableStarterChange: (val: string) => void;
    onToolToggle: (toolName: tool) => void;
    onStopPatternToggle: (id: string) => void;
}

export function CharacterAdvancedSettingsEditorModal({
    isOpen,
    onClose,
    initiativeWeightStr,
    chatProbabilityStr,
    maximumChatStaminaStr,
    nameSensitivityStr,
    chatImpatienceSensitivityStr,
    skipProbabilityStr,
    memoryRetentionWeightStr,
    contextSensitivityStr,
    maximumActionStaminaStr,
    numberOfMessagesToDisableThinkPromptStr,
    numberOfMessagesToDisableMetaThinkInstructionsStr,
    numberOfMessagesToDisableDialoguePromptStr,
    numberOfMessagesToDisableStarterPromptStr,
    tools,
    selectedStopPatternIds,
    allSamplers,
    isUploading,
    onInitiativeWeightChange,
    onChatProbabilityChange,
    onMaximumChatStaminaChange,
    onMaximumActionStaminaChange,
    onNameSensitivityChange,
    onSkipProbabilityChange,
    onChatImpatienceSensitivityChange,
    onMemoryRetentionWeightChange,
    onContextSensitivityChange,
    onDisableThinkChange,
    onDisableMetaChange,
    onDisableDialogueChange,
    onDisableStarterChange,
    onToolToggle,
    onStopPatternToggle,
}: CharacterAdvancedSettingsEditorModalProps) {
    const [activeTab, setActiveTab] = useState<TabId>('stats');

    if (!isOpen) return null;

    const getStopPatternById = (id: string) => {
        for (const s of allSamplers) {
            const found = s.stopPatterns.find(sp => sp.id === id);
            if (found) return found;
        }
        return null;
    };

    const tabs: { id: TabId; label: string; icon: string }[] = [
        { id: 'stats', label: 'Stats', icon: '📊' },
        { id: 'decay', label: 'Prompt Decay', icon: '⏳' },
        { id: 'tools', label: 'Tools', icon: '🔧' },
        { id: 'stopPatterns', label: 'Stop Patterns', icon: '🛑' },
    ];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Advanced Settings</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-save" onClick={onClose}>Done</button>
                    </div>
                </div>

                {/* Tab Bar */}
                <div style={{ display: 'flex', gap: '2px', padding: '0 20px', borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                            style={{ fontSize: '0.7rem', padding: '8px 14px', borderRadius: '6px 6px 0 0', border: 'none', borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent' }}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                <div className="modal-body editor-modal-body">

                    {/* ─── STATS TAB ─── */}
                    {activeTab === 'stats' && (
                        <>
                            <div className="editor-section">
                                <span className="editor-section-title">Turn Order & Output</span>
                                <div className="editor-stats-grid">
                                    <div>
                                        <label className="editor-label editor-label-small">Initiative Weight</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={initiativeWeightStr}
                                            onChange={(e) => onInitiativeWeightChange(e.target.value)}
                                            className="editor-input editor-stat-input"
                                            disabled={isUploading}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                            Controls the character's initiative when determining turn order. Range: 0 - ∞.
                                        </div>
                                    </div>
                                    <div>
                                        <label className="editor-label editor-label-small">Chat Probability</label>
                                        <input
                                            type="number"
                                            step="0.05"
                                            value={chatProbabilityStr}
                                            onChange={(e) => onChatProbabilityChange(e.target.value)}
                                            className="editor-input editor-stat-input"
                                            disabled={isUploading}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                            Controls the probability of the character initiating a chat message when selected. Range: 0 - 1.
                                        </div>
                                    </div>
                                    <div>
                                        <label className="editor-label editor-label-small">Maximum Chat Stamina</label>
                                        <input
                                            type="number"
                                            step="1"
                                            min="0"
                                            value={maximumChatStaminaStr}
                                            onChange={(e) => onMaximumChatStaminaChange(e.target.value)}
                                            className="editor-input editor-stat-input"
                                            disabled={isUploading}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                            Controls the number of maximum paragraphs that the character could produce. Range: 0 - ∞.
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="editor-section">
                                <span className="editor-section-title">Responsiveness</span>
                                <div className="editor-stats-grid">
                                    <div>
                                        <label className="editor-label editor-label-small">Name Sensitivity</label>
                                        <input
                                            type="number"
                                            step="0.5"
                                            min="0"
                                            value={nameSensitivityStr}
                                            onChange={(e) => onNameSensitivityChange(e.target.value)}
                                            className="editor-input editor-stat-input"
                                            disabled={isUploading}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                            Controls how likely the character is to be the first one to respond to the latest message. Multiplied by mention count. 0 = off.
                                        </div>
                                    </div>
                                    <div>
                                        <label className="editor-label editor-label-small">Chat Impatience</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={chatImpatienceSensitivityStr}
                                            onChange={(e) => onChatImpatienceSensitivityChange(e.target.value)}
                                            className="editor-input editor-stat-input"
                                            disabled={isUploading}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                            Controls how impatient the character is after waiting to speak for too long. Higher = speaks sooner after being quiet. 0 = off.
                                        </div>
                                    </div>
                                    <div>
                                        <label className="editor-label editor-label-small">Skip Probability</label>
                                        <input
                                            type="number"
                                            step="0.05"
                                            min="0"
                                            max="1"
                                            value={skipProbabilityStr}
                                            onChange={(e) => onSkipProbabilityChange(e.target.value)}
                                            className="editor-input editor-stat-input"
                                            disabled={isUploading}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                            Probability of skipping an action. Range: 0 - 1.
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="editor-section">
                                <span className="editor-section-title">Awareness & Actions</span>
                                <div className="editor-stats-grid">
                                    <div>
                                        <label className="editor-label editor-label-small">Memory Retention</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={memoryRetentionWeightStr}
                                            onChange={(e) => onMemoryRetentionWeightChange(e.target.value)}
                                            className="editor-input editor-stat-input"
                                            disabled={isUploading}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                            Controls how much of the character's memory is retained. Range: 0 - 1.
                                        </div>
                                    </div>
                                    <div>
                                        <label className="editor-label editor-label-small">Context Sensitivity</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={contextSensitivityStr}
                                            onChange={(e) => onContextSensitivityChange(e.target.value)}
                                            className="editor-input editor-stat-input"
                                            disabled={isUploading}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                            Controls how sensitive the character is to contextual cues. Range: 0 - 1.
                                        </div>
                                    </div>
                                    <div>
                                        <label className="editor-label editor-label-small">Maximum Action Stamina</label>
                                        <input
                                            type="number"
                                            step="1"
                                            min="0"
                                            value={maximumActionStaminaStr}
                                            onChange={(e) => onMaximumActionStaminaChange(e.target.value)}
                                            className="editor-input editor-stat-input"
                                            disabled={isUploading}
                                        />
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>
                                            Controls how many silent actions, movement, or non-chat interactions the character can perform before needing to rest. Range: 0 - ∞.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* ─── PROMPT DECAY TAB ─── */}
                    {activeTab === 'decay' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Disable Prompts After X Messages</span>
                            <div style={{ fontSize: '0.6rem', opacity: 0.5, marginBottom: '12px' }}>
                                Prompts are automatically removed from context after the character has sent this many messages. Set to 0 to disable immediately, or leave high to keep them active longer.
                            </div>
                            <div className="editor-stats-grid">
                                <div>
                                    <label className="editor-label editor-label-small">Think Prompt</label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={numberOfMessagesToDisableThinkPromptStr}
                                        onChange={(e) => onDisableThinkChange(e.target.value)}
                                        className="editor-input editor-stat-input"
                                        disabled={isUploading}
                                    />
                                </div>
                                <div>
                                    <label className="editor-label editor-label-small">Meta-Think Instructions</label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={numberOfMessagesToDisableMetaThinkInstructionsStr}
                                        onChange={(e) => onDisableMetaChange(e.target.value)}
                                        className="editor-input editor-stat-input"
                                        disabled={isUploading}
                                    />
                                </div>
                                <div>
                                    <label className="editor-label editor-label-small">Dialogue Prompt</label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={numberOfMessagesToDisableDialoguePromptStr}
                                        onChange={(e) => onDisableDialogueChange(e.target.value)}
                                        className="editor-input editor-stat-input"
                                        disabled={isUploading}
                                    />
                                </div>
                                <div>
                                    <label className="editor-label editor-label-small">Starter Prompt</label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={numberOfMessagesToDisableStarterPromptStr}
                                        onChange={(e) => onDisableStarterChange(e.target.value)}
                                        className="editor-input editor-stat-input"
                                        disabled={isUploading}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── TOOLS TAB ─── */}
                    {activeTab === 'tools' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Character Tools</span>
                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginBottom: '12px' }}>
                                Enable runtime tool use during generation for this character. Can be overridden by profile settings.
                            </div>

                            {(Object.keys(tools) as tool[]).map(toolName => (
                                <div key={toolName} style={{ marginBottom: '8px' }}>
                                    <label className="editor-checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={tools[toolName]}
                                            onChange={() => onToolToggle(toolName)}
                                            className="editor-checkbox-input"
                                            disabled={isUploading}
                                        />
                                        <span>{TOOL_LABELS[toolName] ?? toolName}</span>
                                    </label>
                                    <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                                        {TOOL_DESCRIPTIONS[toolName] ?? 'Allow this character to use this tool during conversation.'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ─── STOP PATTERNS TAB ─── */}
                    {activeTab === 'stopPatterns' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Character Stop Patterns</span>
                            <div className="editor-stop-patterns-hint">
                                Specific stop sequences for this character, overrides or augments sampler defaults.
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
                                                className="sampler-stop-remove-button"
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
                                {allSamplers
                                    .flatMap(s => s.stopPatterns)
                                    .filter((sp, index, self) => index === self.findIndex(t => t.id === sp.id))
                                    .filter(sp => !selectedStopPatternIds.includes(sp.id))
                                    .map(sp => (
                                        <option key={sp.id} value={sp.id}>
                                            {sp.name} — {sp.pattern}
                                        </option>
                                    ))}
                            </select>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}