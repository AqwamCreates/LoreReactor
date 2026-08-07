// src/components/ProfileEditorModal.tsx
import { useState, useEffect } from 'react';
import type { Profile, PromptBlockType } from '../types';
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
    'User Input',
];

const BLOCK_TYPE_LABELS: Record<string, string> = {
    'Context': 'Context',
    'System Prompt': 'System Prompt',
    'Think Prompt': 'Think Prompt',
    'Chat History': 'Chat History',
    'User Input': 'User Input',
};

const DEFAULT_STRATEGY: PromptBlockType[] = [
    'Context', 'System Prompt', 'Think Prompt', 'Chat History', 'User Input'
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
                setCacheLevel(existingProfile.cacheInvalidationReductionLevel ?? 0);
                setStripThinkTokens(existingProfile.stripThinkTokens ?? false);
                // Filter out Character Description from saved strategies
                const savedStrategy = existingProfile.inputStrategy?.length
                    ? existingProfile.inputStrategy.filter(b => b !== 'Character Description')
                    : [...DEFAULT_STRATEGY];
                setInputStrategy(savedStrategy);
            } else {
                setName('');
                setDescription('');
                setForceNameReveal(false);
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

    // Move block up/down via buttons
    const moveBlock = (index: number, direction: -1 | 1) => {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= inputStrategy.length) return;
        const newOrder = [...inputStrategy];
        [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]];
        setInputStrategy(newOrder);
    };

    // Add a missing block type to the end
    const addBlock = (blockType: PromptBlockType) => {
        if (!inputStrategy.includes(blockType)) {
            setInputStrategy(prev => [...prev, blockType]);
        }
    };

    // Remove a block from the strategy
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

                    {/* Force Name Reveal */}
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

                    {/* Cache Invalidation Reduction */}
                    <div className="editor-section">
                        <span className="editor-section-title">Cache Invalidation Reduction</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label className="editor-checkbox-label" style={{ cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    name="cacheLevel"
                                    checked={cacheLevel === 0}
                                    onChange={() => setCacheLevel(0)}
                                    className="editor-checkbox-input"
                                    style={{ borderRadius: '50%' }}
                                />
                                <span>Level 0 — None</span>
                            </label>
                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginLeft: '26px' }}>
                                Default behavior. Names revealed only through detection.
                            </div>

                            <label className="editor-checkbox-label" style={{ cursor: 'pointer', marginTop: '4px' }}>
                                <input
                                    type="radio"
                                    name="cacheLevel"
                                    checked={cacheLevel === 1}
                                    onChange={() => setCacheLevel(1)}
                                    className="editor-checkbox-input"
                                    style={{ borderRadius: '50%' }}
                                />
                                <span>Level 1 — Inject Names</span>
                            </label>
                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginLeft: '26px' }}>
                                Injects all participant names into the prompt header so the model knows them upfront. Reduces cache misses from name corrections.
                            </div>

                            <label className="editor-checkbox-label" style={{ cursor: 'pointer', marginTop: '4px' }}>
                                <input
                                    type="radio"
                                    name="cacheLevel"
                                    checked={cacheLevel === 2}
                                    onChange={() => setCacheLevel(2)}
                                    className="editor-checkbox-input"
                                    style={{ borderRadius: '50%' }}
                                />
                                <span>Level 2 — Inject Names + All Prompts</span>
                            </label>
                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginLeft: '26px' }}>
                                Also injects all participants' system prompts and think prompts upfront. Maximum cache stability.
                            </div>
                        </div>
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

                        {/* Add missing blocks */}
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