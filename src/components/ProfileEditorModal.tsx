// src/components/ProfileEditorModal.tsx
import { useState, useEffect } from 'react';
import type { Profile, PromptBlockType } from '../types';
import { SliderInput } from './SliderInput';
import './main.css';

interface ProfileEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (profile: Profile) => void;
    existingProfile?: Profile | null;
}

const ALL_BLOCK_TYPES: PromptBlockType[] = [
    'Context',
    'System Prompt',
    'Think Prompt',
    'Chat History',
];

const BLOCK_TYPE_LABELS: Record<string, string> = {
    'Context': 'Context',
    'System Prompt': 'System Prompt',
    'Think Prompt': 'Think Prompt',
    'Chat History': 'Chat History',
};

const DEFAULT_STRATEGY: PromptBlockType[] = [
    'Context', 'System Prompt', 'Think Prompt', 'Chat History'
];

const CACHE_LEVEL_DESCRIPTIONS = [
    'No injection. Names revealed only through detection.',
    'Inject all participant names into prompt header.',
    'Inject names + all system prompts upfront.',
    'Inject names + system prompts + think prompts upfront. Maximum stability.',
];

export function ProfileEditorModal({
    isOpen,
    onClose,
    onSave,
    existingProfile,
}: ProfileEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [forceNameReveal, setForceNameReveal] = useState(false);
    const [forceEqualInitiative, setForceEqualInitiative] = useState(false);
    const [chatProbability, setChatProbability] = useState<number>(0);
    const [maximumChatStamina, setMaximumChatStamina] = useState<number>(0);
    const [cacheLevel, setCacheLevel] = useState<number>(0);
    const [stripThinkTokens, setStripThinkTokens] = useState(false);
    const [inputStrategy, setInputStrategy] = useState<PromptBlockType[]>([...DEFAULT_STRATEGY]);
    const [errors, setErrors] = useState<{ name?: string }>({});

    // Drag reorder state
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    useEffect(() => {
        if (isOpen) {
            if (existingProfile) {
                setName(existingProfile.name || '');
                setDescription(existingProfile.description || '');
                setForceNameReveal(existingProfile.forceNameReveal ?? false);
                setForceEqualInitiative(existingProfile.forceEqualInitiative ?? false);
                setChatProbability(existingProfile.chatProbability ?? 0);
                setMaximumChatStamina(existingProfile.maximumChatStamina ?? 0);
                setCacheLevel(existingProfile.cacheInvalidationReductionLevel ?? 0);
                setStripThinkTokens(existingProfile.stripThinkTokens ?? false);
                const savedStrategy = existingProfile.inputStrategy?.length
                    ? existingProfile.inputStrategy.filter(b => b !== 'Character Description' && b !== 'User Input')
                    : [...DEFAULT_STRATEGY];
                setInputStrategy(savedStrategy);
            } else {
                setName('');
                setDescription('');
                setForceNameReveal(false);
                setForceEqualInitiative(false);
                setChatProbability(0);
                setMaximumChatStamina(0);
                setCacheLevel(0);
                setStripThinkTokens(false);
                setInputStrategy([...DEFAULT_STRATEGY]);
            }
            setErrors({});
            setDraggedIndex(null);
        }
    }, [isOpen, existingProfile]);

    const validate = (): boolean => {
        const newErrors: { name?: string } = {};
        if (!name.trim()) newErrors.name = 'Name is required.';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = () => {
        if (!validate()) return;

        const now = Date.now();
        const profile: Profile = {
            id: existingProfile?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim() || undefined,
            forceNameReveal,
            forceEqualInitiative,
            chatProbability,
            maximumChatStamina,
            cacheInvalidationReductionLevel: cacheLevel,
            stripThinkTokens,
            inputStrategy,
            firstCreatedTimestamp: existingProfile?.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: now,
        };

        onSave(profile);
        onClose();
    };

    const handleClone = () => {
        if (!validate()) return;

        const now = Date.now();
        const cloned: Profile = {
            id: crypto.randomUUID(),
            name: `${name.trim()} (Clone)`,
            description: description.trim() || undefined,
            forceNameReveal,
            forceEqualInitiative,
            chatProbability,
            maximumChatStamina,
            cacheInvalidationReductionLevel: cacheLevel,
            stripThinkTokens,
            inputStrategy: [...inputStrategy],
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };

        onSave(cloned);
        onClose();
    };

    // Drag reorder handlers
    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        setTimeout(() => { (e.target as HTMLElement).style.opacity = '0.5'; }, 0);
    };

    const handleDragEnd = (e: React.DragEvent) => {
        (e.target as HTMLElement).style.opacity = '1';
        setDraggedIndex(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
        if (dragIndex === dropIndex) return;
        const newOrder = [...inputStrategy];
        const [removed] = newOrder.splice(dragIndex, 1);
        newOrder.splice(dropIndex, 0, removed);
        setInputStrategy(newOrder);
        setDraggedIndex(null);
    };

    const moveBlock = (index: number, direction: -1 | 1) => {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= inputStrategy.length) return;
        const newOrder = [...inputStrategy];
        [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]];
        setInputStrategy(newOrder);
    };

    const addBlock = (blockType: PromptBlockType) => {
        if (!inputStrategy.includes(blockType)) {
            setInputStrategy(prev => [...prev, blockType]);
        }
    };

    const removeBlock = (index: number) => {
        setInputStrategy(prev => prev.filter((_, i) => i !== index));
    };

    const missingBlocks = ALL_BLOCK_TYPES.filter(b => !inputStrategy.includes(b));

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingProfile ? 'Edit Profile' : 'Create New Profile'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Cancel</button>
                        {existingProfile && (
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Name <span style={{ color: '#ff4444' }}>*</span></label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }}
                            className={`editor-input ${errors.name ? 'error' : ''}`}
                            placeholder="e.g., Default RP, No Cache Mode, Strict Names"
                        />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="editor-textarea"
                            placeholder="Describe when to use this profile"
                            rows={2}
                        />
                    </div>

                    {/* Identity & Display */}
                    <div className="editor-section">
                        <span className="editor-section-title">Identity & Display</span>
                        <label className="editor-checkbox-label">
                            <input
                                type="checkbox"
                                checked={forceNameReveal}
                                onChange={(e) => setForceNameReveal(e.target.checked)}
                                className="editor-checkbox-input"
                            />
                            <span>Force Name Reveal</span>
                        </label>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                            Always show character names instead of "Unknown Name". Skips name detection entirely.
                        </div>
                    </div>

                    {/* Turn Sequencing Overrides */}
                    <div className="editor-section">
                        <span className="editor-section-title">Turn Sequencing</span>

                        {/* Force Equal Initiative */}
                        <label className="editor-checkbox-label">
                            <input
                                type="checkbox"
                                checked={forceEqualInitiative}
                                onChange={(e) => setForceEqualInitiative(e.target.checked)}
                                className="editor-checkbox-input"
                            />
                            <span>Force Equal Initiative</span>
                        </label>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px', marginBottom: '12px' }}>
                            All participants get equal initiative weight regardless of character settings. Useful for balanced multi-character conversations.
                        </div>

                        {/* Chat Probability Override — Slider */}
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <label className="editor-label editor-label-small" style={{ margin: 0 }}>Chat Probability Override</label>
                                <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>
                                    {chatProbability === 0 ? '(Character default)' : ``}
                                </span>
                            </div>
                            <SliderInput
                                label=""
                                value={chatProbability}
                                minimumValue={0}
                                maximumValue={1}
                                stepValue={0.05}
                                decimals={2}
                                onChange={setChatProbability}
                                description="0 = disabled (use per-character setting). Slide right to override all participants."
                            />
                        </div>

                        {/* Maximum Chat Stamina Override — Slider */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <label className="editor-label editor-label-small" style={{ margin: 0 }}>Maximum Chat Stamina Override</label>
                                <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>
                                    {maximumChatStamina === 0 ? '(Character default)' : ``}
                                </span>
                            </div>
                            <SliderInput
                                label=""
                                value={maximumChatStamina}
                                minimumValue={0}
                                maximumValue={10}
                                stepValue={1}
                                decimals={0}
                                onChange={(val) => setMaximumChatStamina(Math.round(val))}
                                description="0 = disabled (use per-character setting). Slide right to set a shared stamina cap."
                            />
                        </div>
                    </div>

                    {/* Cache Invalidation Reduction — Slider */}
                    <div className="editor-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span className="editor-section-title" style={{ margin: 0 }}>Cache Invalidation Reduction</span>
                        </div>
                        <SliderInput
                            label=""
                            value={cacheLevel}
                            minimumValue={0}
                            maximumValue={3}
                            stepValue={1}
                            decimals={0}
                            onChange={(val) => setCacheLevel(Math.round(val))}
                            description={CACHE_LEVEL_DESCRIPTIONS[Math.round(cacheLevel)] || ''}
                        />
                    </div>

                    {/* Strip Think Tokens */}
                    <div className="editor-section">
                        <span className="editor-section-title">Output Processing</span>
                        <label className="editor-checkbox-label">
                            <input
                                type="checkbox"
                                checked={stripThinkTokens}
                                onChange={(e) => setStripThinkTokens(e.target.checked)}
                                className="editor-checkbox-input"
                            />
                            <span>Strip Think Tokens</span>
                        </label>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                            Remove &lt;think&gt;...&lt;/think&gt; blocks from displayed output. The model still uses them internally for reasoning.
                        </div>
                    </div>

                    {/* Input Strategy Order */}
                    <div className="editor-section">
                        <div className="editor-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Prompt Block Order</span>
                            <span style={{ fontSize: '0.6rem', opacity: 0.5, fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>↕ Drag To Reorder</span>
                        </div>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginBottom: '8px' }}>
                            Controls the order in which prompt sections are assembled. Drag items or use arrow buttons.
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {inputStrategy.map((blockType, index) => {
                                const isDragging = draggedIndex === index;
                                return (
                                    <div
                                        key={`${blockType}-${index}`}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, index)}
                                        onDragEnd={handleDragEnd}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, index)}
                                        className={`sampler-param-row ${isDragging ? 'sampler-param-dragging' : ''}`}
                                        style={{ padding: '6px 8px' }}
                                    >
                                        <div className="sampler-drag-handle" title="Drag to reorder">⋮⋮</div>
                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-h)' }}>
                                                {index + 1}. {BLOCK_TYPE_LABELS[blockType] || blockType}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }}>
                                            <button
                                                type="button"
                                                onClick={() => moveBlock(index, -1)}
                                                disabled={index === 0}
                                                className="toolbar-btn"
                                                title="Move up"
                                                style={{ width: '24px', height: '24px', fontSize: '0.7rem', opacity: index === 0 ? 0.3 : 1 }}
                                            >▲</button>
                                            <button
                                                type="button"
                                                onClick={() => moveBlock(index, 1)}
                                                disabled={index === inputStrategy.length - 1}
                                                className="toolbar-btn"
                                                title="Move down"
                                                style={{ width: '24px', height: '24px', fontSize: '0.7rem', opacity: index === inputStrategy.length - 1 ? 0.3 : 1 }}
                                            >▼</button>
                                            <button
                                                type="button"
                                                onClick={() => removeBlock(index)}
                                                className="toolbar-btn"
                                                title="Remove from order"
                                                style={{ width: '24px', height: '24px', fontSize: '0.8rem', color: '#ff4444' }}
                                            >×</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {missingBlocks.length > 0 && (
                            <div style={{ marginTop: '8px' }}>
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value as PromptBlockType;
                                        if (val) addBlock(val);
                                        e.target.value = '';
                                    }}
                                    className="editor-select"
                                    defaultValue=""
                                >
                                    <option value="" disabled>+ Add a missing block</option>
                                    {missingBlocks.map(b => (
                                        <option key={b} value={b}>{BLOCK_TYPE_LABELS[b] || b}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}