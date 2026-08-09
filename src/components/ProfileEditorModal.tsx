// src/components/ProfileEditorModal.tsx
import { useState, useEffect } from 'react';
import type { Profile, PromptBlockType, SummarizationStep, SummarizationStrategyType } from '../types';
import { SliderInput } from './SliderInput';
import './main.css';

interface ProfileEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (profile: Profile) => void;
    existingProfile?: Profile | null;
}

const ALL_BLOCK_TYPES: PromptBlockType[] = [
    'System Prompt',
    'Think Prompt',
    'Context',
    'Chat History',
];

const BLOCK_TYPE_LABELS: Record<string, string> = {
    'System Prompt': 'System Prompt',
    'Think Prompt': 'Think Prompt',
    'Context': 'Context',
    'Chat History': 'Chat History',
};

const DEFAULT_STRATEGY: PromptBlockType[] = [
    'System Prompt', 'Think Prompt', 'Context', 'Chat History'
];

const CACHE_LEVEL_DESCRIPTIONS = [
    'No injection. Names revealed only through detection.',
    'Inject all participant names into prompt header.',
    'Inject names + all system prompts upfront.',
    'Inject names + system prompts + think prompts upfront. Maximum stability.',
];

const STRATEGY_DESCRIPTIONS: Record<SummarizationStrategyType, string> = {
    'Sliding Window Replace': 'Replace old messages with per-message summaries beyond the window size.',
    'Periodic Compression': 'Compress every M messages into a summary paragraph at regular intervals.',
    'Recursive Summary': 'Build hierarchical summaries: chunks → meta-summaries → global summary.',
    'Observation Masking': 'Hide older messages by relevance score. Keep only what matters to the current context.',
};

function getDefaultSummarizationSteps(): SummarizationStep[] {
    const now = Date.now();
    return [
        {
            id: `step-${crypto.randomUUID()}`,
            name: 'Sliding Window Replace',
            strategyType: 'Sliding Window Replace',
            enabled: true,
            order: 0,
            slidingWindowSize: 10,
            summaryTokenBudget: 256,
            triggerTokenThreshold: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
        {
            id: `step-${crypto.randomUUID()}`,
            name: 'Periodic Compression',
            strategyType: 'Periodic Compression',
            enabled: false,
            order: 1,
            compressionInterval: 20,
            compressionChunkSize: 10,
            summaryTokenBudget: 512,
            triggerTokenThreshold: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
        {
            id: `step-${crypto.randomUUID()}`,
            name: 'Recursive Summary',
            strategyType: 'Recursive Summary',
            enabled: false,
            order: 2,
            recursiveChunkSize: 10,
            recursiveMaxDepth: 3,
            summaryTokenBudget: 1024,
            triggerTokenThreshold: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
        {
            id: `step-${crypto.randomUUID()}`,
            name: 'Observation Masking',
            strategyType: 'Observation Masking',
            enabled: false,
            order: 3,
            maskingRelevanceThreshold: 0.3,
            maskingKeywordWeight: 0.7,
            triggerTokenThreshold: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
    ];
}

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
    const [summarizationSteps, setSummarizationSteps] = useState<SummarizationStep[]>([]);
    const [errors, setErrors] = useState<{ name?: string }>({});

    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [draggedStepIndex, setDraggedStepIndex] = useState<number | null>(null);
    const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

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
                setSummarizationSteps(
                    existingProfile.summarizationSteps?.length
                        ? [...existingProfile.summarizationSteps].sort((a, b) => a.order - b.order)
                        : getDefaultSummarizationSteps()
                );
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
                setSummarizationSteps(getDefaultSummarizationSteps());
            }
            setErrors({});
            setDraggedIndex(null);
            setDraggedStepIndex(null);
            setExpandedStepId(null);
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
            summarizationSteps: summarizationSteps.map((s, i) => ({ ...s, order: i, lastUpdatedTimestamp: now })),
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
            summarizationSteps: summarizationSteps.map((s, i) => ({
                ...s,
                id: `step-${crypto.randomUUID()}`,
                order: i,
                firstCreatedTimestamp: now,
                lastUpdatedTimestamp: now,
            })),
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };

        onSave(cloned);
        onClose();
    };

    // --- Prompt block drag handlers ---
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

    // --- Summarization step drag handlers ---
    const handleStepDragStart = (e: React.DragEvent, index: number) => {
        setDraggedStepIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        setTimeout(() => { (e.target as HTMLElement).style.opacity = '0.5'; }, 0);
    };

    const handleStepDragEnd = (e: React.DragEvent) => {
        (e.target as HTMLElement).style.opacity = '1';
        setDraggedStepIndex(null);
    };

    const handleStepDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
        if (dragIndex === dropIndex) return;
        const newSteps = [...summarizationSteps];
        const [removed] = newSteps.splice(dragIndex, 1);
        newSteps.splice(dropIndex, 0, removed);
        setSummarizationSteps(newSteps.map((s, i) => ({ ...s, order: i })));
        setDraggedStepIndex(null);
    };

    const moveStep = (index: number, direction: -1 | 1) => {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= summarizationSteps.length) return;
        const newSteps = [...summarizationSteps];
        [newSteps[index], newSteps[newIndex]] = [newSteps[newIndex], newSteps[index]];
        setSummarizationSteps(newSteps.map((s, i) => ({ ...s, order: i })));
    };

    const updateStepField = <K extends keyof SummarizationStep>(index: number, field: K, value: SummarizationStep[K]) => {
        setSummarizationSteps(prev => prev.map((s, i) =>
            i === index ? { ...s, [field]: value, lastUpdatedTimestamp: Date.now() } : s
        ));
    };

    const addSummarizationStep = (strategyType: SummarizationStrategyType) => {
        const now = Date.now();
        const newStep: SummarizationStep = {
            id: `step-${crypto.randomUUID()}`,
            name: strategyType,
            strategyType,
            enabled: true,
            order: summarizationSteps.length,
            summaryTokenBudget: 512,
            triggerTokenThreshold: 0,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };
        if (strategyType === 'Sliding Window Replace') newStep.slidingWindowSize = 10;
        if (strategyType === 'Periodic Compression') { newStep.compressionInterval = 20; newStep.compressionChunkSize = 10; }
        if (strategyType === 'Recursive Summary') { newStep.recursiveChunkSize = 10; newStep.recursiveMaxDepth = 3; }
        if (strategyType === 'Observation Masking') { newStep.maskingRelevanceThreshold = 0.3; newStep.maskingKeywordWeight = 0.7; }

        setSummarizationSteps(prev => [...prev, newStep]);
    };

    const removeSummarizationStep = (index: number) => {
        setSummarizationSteps(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i })));
        if (expandedStepId === summarizationSteps[index]?.id) setExpandedStepId(null);
    };

    const availableStrategyTypes = (Object.keys(STRATEGY_DESCRIPTIONS) as SummarizationStrategyType[])
        .filter(t => !summarizationSteps.some(s => s.strategyType === t));

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
                            All participants get equal initiative weight regardless of character settings.
                        </div>

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

                    {/* Cache Invalidation Reduction */}
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
                            Remove &lt;think&gt;...&lt;/think&gt; blocks from displayed output. The model still uses them internally.
                        </div>
                    </div>

                    {/* Input Strategy Order */}
                    <div className="editor-section">
                        <div className="editor-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Prompt Block Order</span>
                            <span style={{ fontSize: '0.6rem', opacity: 0.5, fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>↕ Drag To Reorder</span>
                        </div>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginBottom: '8px' }}>
                            Controls the order in which prompt sections are assembled.
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
                                            <button type="button" onClick={() => moveBlock(index, -1)} disabled={index === 0} className="toolbar-btn" title="Move up" style={{ width: '24px', height: '24px', fontSize: '0.7rem', opacity: index === 0 ? 0.3 : 1 }}>▲</button>
                                            <button type="button" onClick={() => moveBlock(index, 1)} disabled={index === inputStrategy.length - 1} className="toolbar-btn" title="Move down" style={{ width: '24px', height: '24px', fontSize: '0.7rem', opacity: index === inputStrategy.length - 1 ? 0.3 : 1 }}>▼</button>
                                            <button type="button" onClick={() => removeBlock(index)} className="toolbar-btn" title="Remove from order" style={{ width: '24px', height: '24px', fontSize: '0.8rem', color: '#ff4444' }}>×</button>
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

                    {/* Summarization Pipeline */}
                    <div className="editor-section">
                        <div className="editor-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Summarization Pipeline</span>
                            <span style={{ fontSize: '0.6rem', opacity: 0.5, fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>↕ Drag To Reorder</span>
                        </div>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginBottom: '8px' }}>
                            Steps execute in order. Click a step to expand its settings. Remove via × or the dropdown below.
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {summarizationSteps.map((step, index) => {
                                const isDragging = draggedStepIndex === index;
                                const isExpanded = expandedStepId === step.id;

                                return (
                                    <div key={step.id}>
                                        <div
                                            draggable
                                            onDragStart={(e) => handleStepDragStart(e, index)}
                                            onDragEnd={handleStepDragEnd}
                                            onDragOver={handleDragOver}
                                            onDrop={(e) => handleStepDrop(e, index)}
                                            className={`sampler-param-row ${isDragging ? 'sampler-param-dragging' : ''}`}
                                            style={{ padding: '6px 8px', cursor: 'pointer' }}
                                            onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                                        >
                                            <div className="sampler-drag-handle" title="Drag to reorder" onClick={(e) => e.stopPropagation()}>⋮⋮</div>

                                            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    fontWeight: 'bold',
                                                    color: 'var(--text-h)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    {index + 1}. {step.name}
                                                </span>
                                            </div>

                                            <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                                <button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} className="toolbar-btn" title="Move up" style={{ width: '24px', height: '24px', fontSize: '0.7rem', opacity: index === 0 ? 0.3 : 1 }}>▲</button>
                                                <button type="button" onClick={() => moveStep(index, 1)} disabled={index === summarizationSteps.length - 1} className="toolbar-btn" title="Move down" style={{ width: '24px', height: '24px', fontSize: '0.7rem', opacity: index === summarizationSteps.length - 1 ? 0.3 : 1 }}>▼</button>
                                                <button type="button" onClick={() => removeSummarizationStep(index)} className="toolbar-btn" title="Remove step" style={{ width: '24px', height: '24px', fontSize: '0.8rem', color: '#ff4444' }}>×</button>
                                                <span style={{ fontSize: '0.7rem', opacity: 0.5, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <div style={{
                                                padding: '10px 12px',
                                                margin: '0 0 4px 0',
                                                background: 'var(--social-bg)',
                                                border: '1px solid var(--border)',
                                                borderTop: 'none',
                                                borderRadius: '0 0 6px 6px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '8px',
                                            }}>
                                                <div style={{ fontSize: '0.65rem', opacity: 0.6, fontStyle: 'italic' }}>
                                                    {STRATEGY_DESCRIPTIONS[step.strategyType]}
                                                </div>

                                                {step.strategyType === 'Sliding Window Replace' && (
                                                    <div>
                                                        <label className="editor-label editor-label-small">Window Size</label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="50"
                                                            value={step.slidingWindowSize ?? 10}
                                                            onChange={(e) => updateStepField(index, 'slidingWindowSize', Math.max(1, Number(e.target.value) || 10))}
                                                            className="editor-input"
                                                            style={{ textAlign: 'right', fontSize: '0.8rem' }}
                                                        />
                                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Keep last N messages verbatim</div>
                                                    </div>
                                                )}

                                                {step.strategyType === 'Periodic Compression' && (
                                                    <div className="editor-row">
                                                        <div>
                                                            <label className="editor-label editor-label-small">Compression Interval</label>
                                                            <input
                                                                type="number"
                                                                min="5"
                                                                max="100"
                                                                value={step.compressionInterval ?? 20}
                                                                onChange={(e) => updateStepField(index, 'compressionInterval', Math.max(5, Number(e.target.value) || 20))}
                                                                className="editor-input"
                                                                style={{ textAlign: 'right', fontSize: '0.8rem' }}
                                                            />
                                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Compress every M messages</div>
                                                        </div>
                                                        <div>
                                                            <label className="editor-label editor-label-small">Chunk Size</label>
                                                            <input
                                                                type="number"
                                                                min="5"
                                                                max="50"
                                                                value={step.compressionChunkSize ?? 10}
                                                                onChange={(e) => updateStepField(index, 'compressionChunkSize', Math.max(5, Number(e.target.value) || 10))}
                                                                className="editor-input"
                                                                style={{ textAlign: 'right', fontSize: '0.8rem' }}
                                                            />
                                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Messages per compression chunk</div>
                                                        </div>
                                                    </div>
                                                )}

                                                {step.strategyType === 'Recursive Summary' && (
                                                    <div className="editor-row">
                                                        <div>
                                                            <label className="editor-label editor-label-small">Chunk Size</label>
                                                            <input
                                                                type="number"
                                                                min="5"
                                                                max="50"
                                                                value={step.recursiveChunkSize ?? 10}
                                                                onChange={(e) => updateStepField(index, 'recursiveChunkSize', Math.max(5, Number(e.target.value) || 10))}
                                                                className="editor-input"
                                                                style={{ textAlign: 'right', fontSize: '0.8rem' }}
                                                            />
                                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Messages per chunk at layer 0</div>
                                                        </div>
                                                        <div>
                                                            <label className="editor-label editor-label-small">Max Depth</label>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max="5"
                                                                value={step.recursiveMaxDepth ?? 3}
                                                                onChange={(e) => updateStepField(index, 'recursiveMaxDepth', Math.max(1, Number(e.target.value) || 3))}
                                                                className="editor-input"
                                                                style={{ textAlign: 'right', fontSize: '0.8rem' }}
                                                            />
                                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Max recursion layers</div>
                                                        </div>
                                                    </div>
                                                )}

                                                {step.strategyType === 'Observation Masking' && (
                                                    <div className="editor-row">
                                                        <div>
                                                            <label className="editor-label editor-label-small">Relevance Threshold</label>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max="1"
                                                                step="0.05"
                                                                value={step.maskingRelevanceThreshold ?? 0.3}
                                                                onChange={(e) => updateStepField(index, 'maskingRelevanceThreshold', Math.max(0, Math.min(1, Number(e.target.value) || 0.3)))}
                                                                className="editor-input"
                                                                style={{ textAlign: 'right', fontSize: '0.8rem' }}
                                                            />
                                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Min score to include (0.0–1.0)</div>
                                                        </div>
                                                        <div>
                                                            <label className="editor-label editor-label-small">Keyword Weight</label>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max="1"
                                                                step="0.05"
                                                                value={step.maskingKeywordWeight ?? 0.7}
                                                                onChange={(e) => updateStepField(index, 'maskingKeywordWeight', Math.max(0, Math.min(1, Number(e.target.value) || 0.7)))}
                                                                className="editor-input"
                                                                style={{ textAlign: 'right', fontSize: '0.8rem' }}
                                                            />
                                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Keyword vs recency balance</div>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="editor-row">
                                                    <div>
                                                        <label className="editor-label editor-label-small">Summary Token Budget</label>
                                                        <input
                                                            type="number"
                                                            min="64"
                                                            max="4096"
                                                            step="64"
                                                            value={step.summaryTokenBudget ?? 512}
                                                            onChange={(e) => updateStepField(index, 'summaryTokenBudget', Math.max(64, Number(e.target.value) || 512))}
                                                            className="editor-input"
                                                            style={{ textAlign: 'right', fontSize: '0.8rem' }}
                                                        />
                                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Max tokens for generated summaries</div>
                                                    </div>
                                                    <div>
                                                        <label className="editor-label editor-label-small">Trigger Threshold</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="131072"
                                                            step="1024"
                                                            value={step.triggerTokenThreshold ?? 0}
                                                            onChange={(e) => updateStepField(index, 'triggerTokenThreshold', Math.max(0, Number(e.target.value) || 0))}
                                                            className="editor-input"
                                                            style={{ textAlign: 'right', fontSize: '0.8rem' }}
                                                        />
                                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>0 = auto based on context length</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {availableStrategyTypes.length > 0 && (
                            <div style={{ marginTop: '8px' }}>
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value as SummarizationStrategyType;
                                        if (val) addSummarizationStep(val);
                                        e.target.value = '';
                                    }}
                                    className="editor-select"
                                    defaultValue=""
                                >
                                    <option value="" disabled>+ Add a summarization step</option>
                                    {availableStrategyTypes.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {summarizationSteps.length === 0 && (
                            <div style={{ fontSize: '0.75rem', opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>
                                No summarization steps configured. Add one above to enable context management.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}