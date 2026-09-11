// src/components/ProfileEditorModal.tsx
import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import type { Profile, PromptBlock, PromptBlockType, SummarizationStep, SummarizationStrategyType } from '../types';
import { SliderInput } from './SliderInput';
import './main.css';
import { defaultInputStrategy } from '../defaults';

interface ProfileEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (profile: Profile) => void;
    existingProfile?: Profile | null;
    allPromptBlocks?: PromptBlock[];
}

const CACHE_LEVEL_DESCRIPTIONS = [
    'No injection.',
    'Inject all participant names upfront.',
    'Inject all participant names + all system prompts upfront.',
    'Inject all participant names + system prompts + think prompts upfront.',
];

const STRATEGY_DESCRIPTIONS: Record<SummarizationStrategyType, string> = {
    'Sliding Window Replace': 'Replace old messages with per-message summaries beyond the window size.',
    'Periodic Compression': 'Compress every M messages into a summary paragraph at regular intervals.',
    'Recursive Summary': 'Build hierarchical summaries: chunks → meta-summaries → global summary.',
    'Observation Masking': 'Hide older messages by relevance score. Keep only what matters to the current context.',
};

const ALL_STRATEGY_TYPES: SummarizationStrategyType[] = [
    'Sliding Window Replace', 'Periodic Compression', 'Recursive Summary', 'Observation Masking',
];

function getDefaultSummarizationSteps(): SummarizationStep[] {
    const now = Date.now();
    return [
        { id: `step-${crypto.randomUUID()}`, name: 'Sliding Window Replace', strategyType: 'Sliding Window Replace', enabled: true, order: 0, slidingWindowSize: 10, summaryTokenBudget: 256, triggerTokenThreshold: 0, firstCreatedTimestamp: now, lastUpdatedTimestamp: now },
        { id: `step-${crypto.randomUUID()}`, name: 'Periodic Compression', strategyType: 'Periodic Compression', enabled: false, order: 1, compressionInterval: 20, compressionChunkSize: 10, summaryTokenBudget: 512, triggerTokenThreshold: 0, firstCreatedTimestamp: now, lastUpdatedTimestamp: now },
        { id: `step-${crypto.randomUUID()}`, name: 'Recursive Summary', strategyType: 'Recursive Summary', enabled: false, order: 2, recursiveChunkSize: 10, recursiveMaxDepth: 3, summaryTokenBudget: 1024, triggerTokenThreshold: 0, firstCreatedTimestamp: now, lastUpdatedTimestamp: now },
        { id: `step-${crypto.randomUUID()}`, name: 'Observation Masking', strategyType: 'Observation Masking', enabled: false, order: 3, maskingRelevanceThreshold: 0.3, maskingKeywordWeight: 0.7, triggerTokenThreshold: 0, firstCreatedTimestamp: now, lastUpdatedTimestamp: now },
    ];
}

/** Check if a string is a built-in PromptBlockType */
function isBuiltInBlockType(value: string): value is PromptBlockType {
    return (defaultInputStrategy as string[]).includes(value);
}

// ─── Shared Styles ───────────────────────────────────────────────────

const CHECKBOX_HINT_STYLE: CSSProperties = { fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' };
const CHECKBOX_SPACED_STYLE: CSSProperties = { marginTop: '8px' };
const SLIDER_HEADER_STYLE: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' };
const SLIDER_LABEL_STYLE: CSSProperties = { margin: 0 };
const SLIDER_VALUE_STYLE: CSSProperties = { fontSize: '0.65rem', opacity: 0.6 };
const TOOLBAR_BTN_SMALL_STYLE: CSSProperties = { width: '24px', height: '24px', fontSize: '0.7rem' };
const TOOLBAR_BTN_DELETE_STYLE: CSSProperties = { ...TOOLBAR_BTN_SMALL_STYLE, fontSize: '0.8rem', color: '#ff4444' };
const STEP_EXPANDED_STYLE: CSSProperties = {
    padding: '10px 12px', margin: '0 0 4px 0', background: 'var(--social-bg)',
    border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 6px 6px',
    display: 'flex', flexDirection: 'column', gap: '8px',
};
const STEP_NAME_STYLE: CSSProperties = {
    fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-h)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const STEP_DESC_STYLE: CSSProperties = { fontSize: '0.65rem', opacity: 0.6, fontStyle: 'italic' };
const INPUT_RIGHT_STYLE: CSSProperties = { textAlign: 'right' as const };
const FIELD_HINT_STYLE: CSSProperties = { fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' };

// ─── Reusable Checkbox Component ─────────────────────────────────────

function ProfileCheckbox({
    checked, onChange, label, hint, spaced = false,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    hint?: string;
    spaced?: boolean;
}) {
    return (
        <label className="editor-checkbox-label" style={spaced ? CHECKBOX_SPACED_STYLE : undefined}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="editor-checkbox-input"
            />
            <span>{label}</span>
            {hint && <div style={CHECKBOX_HINT_STYLE}>{hint}</div>}
        </label>
    );
}

// ─── Main Component ──────────────────────────────────────────────────

export function ProfileEditorModal({
    isOpen, onClose, onSave, existingProfile, allPromptBlocks = [],
}: ProfileEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [forceNameReveal, setForceNameReveal] = useState(false);
    const [enableCharacterExpression, setEnableCharacterExpression] = useState(false);
    const [forceNoCharacterImageInjection, setForceNoCharacterImageInjection] = useState(false);
    const [numberOfMessagesToDisableThinkPrompt, setNumberOfMessagesToDisableThinkPrompt] = useState<number>(-1);
    const [numberOfMessagesToDisableMetaThinkInstructions, setNumberOfMessagesToDisableMetaThinkInstructions] = useState<number>(-1);
    const [numberOfMessagesToDisableDialoguePrompt, setNumberOfMessagesToDisableDialoguePrompt] = useState<number>(-1);
    const [forceNoContextImageInjection, setForceNoContextImageInjection] = useState(false);
    const [forceNoLocationImageInjection, setForceNoLocationImageInjection] = useState(false);
    const [useCurrentDateAndTime, setUseCurrentDateAndTime] = useState(false);
    const [useWeather, setUseWeather] = useState(false);
    const [weatherApiKey, setWeatherApiKey] = useState('');
    const [useTimeElapsed, setUseTimeElapsed] = useState(false);
    const [forceEqualInitiative, setForceEqualInitiative] = useState(false);
    const [chatProbability, setChatProbability] = useState<number>(-1);
    const [maximumChatStamina, setMaximumChatStamina] = useState<number>(-1);
    const [nameSensitivity, setNameSensitivity] = useState<number>(-1);
    const [skipProbability, setSkipProbability] = useState<number>(-1);
    const [chatImpatienceSensitivity, setChatImpatienceSensitivity] = useState<number>(-1);
    const [memoryRetentionWeight, setMemoryRetentionWeight] = useState<number>(-1);
    const [contextSensitivity, setContextSensitivity] = useState<number>(-1);
    const [cacheLevel, setCacheLevel] = useState<number>(0);
    const [volume, setVolume] = useState<number>(-1);
    const [stripThinkTokens, setStripThinkTokens] = useState(false);
    const [enableWebSearch, setEnableWebSearch] = useState<number>(0);
    const [enableCalculator, setEnableCalculator] = useState<number>(0);
    const [enableMemoryWriting, setEnableMemoryWriting] = useState<number>(0);
    const [enableMemoryReading, setEnableMemoryReading] = useState<number>(0);
    const [narrateNormalText, setNarrateNormalText] = useState(true);
    const [narrateQuotedText, setNarrateQuotedText] = useState(false);
    const [narrateBoldedText, setNarrateBoldedText] = useState(false);
    const [narrateItalicizedText, setNarrateItalicizedText] = useState(false);
    const [inputStrategy, setInputStrategy] = useState<(PromptBlockType | string)[]>([]);
    const [summarizationSteps, setSummarizationSteps] = useState<SummarizationStep[]>([]);
    const [errors, setErrors] = useState<{ name?: string }>({});

    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [draggedStepIndex, setDraggedStepIndex] = useState<number | null>(null);
    const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

    // Build lookup maps for prompt block display
    const promptBlockById = useMemo(() => {
        const map = new Map<string, PromptBlock>();
        for (const pb of allPromptBlocks) map.set(pb.id, pb);
        return map;
    }, [allPromptBlocks]);

    /** Resolve a strategy entry to a display label */
    const getBlockLabel = (entry: PromptBlockType | string): string => {
        if (isBuiltInBlockType(entry)) return entry;
        const pb = promptBlockById.get(entry);
        return pb ? `🧱 ${pb.name}` : `🧱 (Unknown Block)`;
    };

    useEffect(() => {
        if (!isOpen) return;

        if (existingProfile) {
            setName(existingProfile.name || '');
            setDescription(existingProfile.description || '');
            setForceNameReveal(existingProfile.forceNameReveal ?? false);
            setEnableCharacterExpression(existingProfile.enableCharacterExpression ?? false);
            setForceNoCharacterImageInjection(existingProfile.forceNoCharacterImageInjection ?? false);
            setNumberOfMessagesToDisableThinkPrompt(existingProfile.numberOfMessagesToDisableThinkPrompt ?? -1);
            setNumberOfMessagesToDisableMetaThinkInstructions(existingProfile.numberOfMessagesToDisableMetaThinkInstructions ?? -1);
            setNumberOfMessagesToDisableDialoguePrompt(existingProfile.numberOfMessagesToDisableDialoguePrompt ?? -1);
            setForceNoContextImageInjection(existingProfile.forceNoContextImageInjection ?? false);
            setForceNoLocationImageInjection(existingProfile.forceNoLocationImageInjection ?? false);
            setUseCurrentDateAndTime(existingProfile.useCurrentDateAndTime ?? false);
            setUseWeather(existingProfile.useWeather ?? false);
            setWeatherApiKey(existingProfile.weatherApiKey ?? '');
            setUseTimeElapsed(existingProfile.useTimeElapsed ?? false);
            setForceEqualInitiative(existingProfile.forceEqualInitiative ?? false);
            setChatProbability(existingProfile.chatProbability ?? -1);
            setMaximumChatStamina(existingProfile.maximumChatStamina ?? -1);
            setNameSensitivity(existingProfile.nameSensitivity ?? -1);
            setSkipProbability(existingProfile.skipProbability ?? -1);
            setChatImpatienceSensitivity(existingProfile.chatImpatienceSensitivity ?? -1);
            setMemoryRetentionWeight(existingProfile.memoryRetentionWeight ?? -1);
            setContextSensitivity(existingProfile.contextSensitivity ?? -1);
            setCacheLevel(existingProfile.cacheInvalidationReductionLevel ?? 0);
            setVolume(existingProfile.volume ?? -1);
            setStripThinkTokens(existingProfile.stripThinkTokens ?? false);
            setEnableWebSearch(existingProfile.enableWebSearch ?? 0);
            setEnableCalculator(existingProfile.enableCalculator ?? 0);
            setEnableMemoryWriting(existingProfile.enableMemoryWriting ?? 0);
            setEnableMemoryReading(existingProfile.enableMemoryReading ?? 0);
            setNarrateNormalText(existingProfile.narrateNormalText ?? true);
            setNarrateQuotedText(existingProfile.narrateQuotedText ?? false);
            setNarrateBoldedText(existingProfile.narrateBoldedText ?? false);
            setNarrateItalicizedText(existingProfile.narrateItalicizedText ?? false);
            setInputStrategy(existingProfile.inputStrategy?.length ? existingProfile.inputStrategy : []);
            setSummarizationSteps(
                existingProfile.summarizationSteps?.length
                    ? [...existingProfile.summarizationSteps].sort((a, b) => a.order - b.order)
                    : getDefaultSummarizationSteps()
            );
        } else {
            setName(''); setDescription('');
            setForceNameReveal(false); setEnableCharacterExpression(false);
            setForceNoCharacterImageInjection(false); setForceNoContextImageInjection(false); setForceNoLocationImageInjection(false);
            setNumberOfMessagesToDisableThinkPrompt(-1); setNumberOfMessagesToDisableMetaThinkInstructions(-1); setNumberOfMessagesToDisableDialoguePrompt(-1);
            setUseCurrentDateAndTime(false); setUseWeather(false); setWeatherApiKey(''); setUseTimeElapsed(false);
            setForceEqualInitiative(false); setChatProbability(0); setMaximumChatStamina(0);
            setNameSensitivity(-1); setSkipProbability(-1); setChatImpatienceSensitivity(-1);
            setMemoryRetentionWeight(-1); setContextSensitivity(-1); setCacheLevel(0); setVolume(-1);
            setStripThinkTokens(false);
            setEnableWebSearch(0); setEnableCalculator(0); setEnableMemoryWriting(0); setEnableMemoryReading(0);
            setNarrateNormalText(true); setNarrateQuotedText(false); setNarrateBoldedText(false); setNarrateItalicizedText(false);
            setInputStrategy([]);
            setSummarizationSteps(getDefaultSummarizationSteps());
        }
        setErrors({}); setDraggedIndex(null); setDraggedStepIndex(null); setExpandedStepId(null);
    }, [isOpen, existingProfile]);

    const validate = (): boolean => {
        const newErrors: { name?: string } = {};
        if (!name.trim()) newErrors.name = 'Name is required.';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const buildProfile = (id: string, profileName: string): Profile => {
        const now = Date.now();
        return {
            id, name: profileName, description: description.trim() || undefined,
            forceNameReveal, enableCharacterExpression,
            forceNoCharacterImageInjection, forceNoContextImageInjection, forceNoLocationImageInjection,
            numberOfMessagesToDisableThinkPrompt, numberOfMessagesToDisableMetaThinkInstructions, numberOfMessagesToDisableDialoguePrompt,
            useCurrentDateAndTime, useWeather, weatherApiKey, useTimeElapsed,
            forceEqualInitiative, chatProbability, maximumChatStamina,
            nameSensitivity, skipProbability, chatImpatienceSensitivity,
            memoryRetentionWeight, contextSensitivity,
            cacheInvalidationReductionLevel: cacheLevel, volume, stripThinkTokens,
            enableWebSearch, enableCalculator, enableMemoryWriting, enableMemoryReading,
            narrateNormalText, narrateQuotedText, narrateBoldedText, narrateItalicizedText,
            inputStrategy: [...inputStrategy],
            summarizationSteps: summarizationSteps.map((s, i) => ({
                ...s, id: s.id || `step-${crypto.randomUUID()}`, order: i,
                firstCreatedTimestamp: s.firstCreatedTimestamp || now, lastUpdatedTimestamp: now,
            })),
            firstCreatedTimestamp: existingProfile?.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = () => {
        if (!validate()) return;
        onSave(buildProfile(existingProfile?.id || crypto.randomUUID(), name.trim()));
        onClose();
    };

    const handleClone = () => {
        if (!validate()) return;
        onSave(buildProfile(crypto.randomUUID(), `${name.trim()} (Clone)`));
        onClose();
    };

    // --- Prompt block drag handlers ---
    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        setTimeout(() => { (e.target as HTMLElement).style.opacity = '0.5'; }, 0);
    };
    const handleDragEnd = (e: React.DragEvent) => { (e.target as HTMLElement).style.opacity = '1'; setDraggedIndex(null); };
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    const handleDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        const dragIndex = Number.parseInt(e.dataTransfer.getData('text/plain'));
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
    const addBlock = (blockEntry: PromptBlockType | string) => {
        if (!inputStrategy.includes(blockEntry)) setInputStrategy(prev => [...prev, blockEntry]);
    };
    const removeBlock = (index: number) => { setInputStrategy(prev => prev.filter((_, i) => i !== index)); };

    // Missing built-in blocks that aren't in the strategy
    const missingBuiltInBlocks = defaultInputStrategy.filter(b => !inputStrategy.includes(b));
    // Prompt blocks not yet in the strategy
    const availablePromptBlocks = allPromptBlocks.filter((pb: PromptBlock) => !inputStrategy.includes(pb.id));

    // --- Summarization step drag handlers ---
    const handleStepDragStart = (e: React.DragEvent, index: number) => {
        setDraggedStepIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        setTimeout(() => { (e.target as HTMLElement).style.opacity = '0.5'; }, 0);
    };
    const handleStepDragEnd = (e: React.DragEvent) => { (e.target as HTMLElement).style.opacity = '1'; setDraggedStepIndex(null); };
    const handleStepDrop = (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        const dragIndex = Number.parseInt(e.dataTransfer.getData('text/plain'));
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
        setSummarizationSteps(prev => prev.map((s, i) => i === index ? { ...s, [field]: value, lastUpdatedTimestamp: Date.now() } : s));
    };
    const addSummarizationStep = (strategyType: SummarizationStrategyType) => {
        const now = Date.now();
        const newStep: SummarizationStep = {
            id: `step-${crypto.randomUUID()}`, name: strategyType, strategyType, enabled: true,
            order: summarizationSteps.length, summaryTokenBudget: 512, triggerTokenThreshold: 0,
            firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
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

    // --- Slider override helper ---
    const renderOverrideSlider = (
        label: string, value: number, min: number, max: number, step: number, decimals: number,
        onChange: (val: number) => void, description: string, valueLabel?: string,
    ) => (
        <div style={{ marginBottom: '12px' }}>
            <div style={SLIDER_HEADER_STYLE}>
                <label className="editor-label editor-label-small" style={SLIDER_LABEL_STYLE}>{label}</label>
                {valueLabel && <span style={SLIDER_VALUE_STYLE}>{valueLabel}</span>}
            </div>
            <SliderInput label="" value={value} minimumValue={min} maximumValue={max} stepValue={step} decimals={decimals} onChange={onChange} description={description} />
        </div>
    );

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingProfile ? 'Edit Profile' : 'Create New Profile'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        {existingProfile && <button type="button" className="editor-button editor-button-cancel" onClick={handleClone}>Clone</button>}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Name <span style={{ color: '#ff4444' }}>*</span></label>
                        <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }} className={`editor-input ${errors.name ? 'error' : ''}`} placeholder="e.g., Default RP, No Cache Mode, Strict Names" />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    {/* Description */}
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Description</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea" placeholder="Describe when to use this profile" rows={2} />
                    </div>

                    {/* Display Section */}
                    <div className="editor-section">
                        <span className="editor-section-title">Display</span>

                        <div style={{ marginBottom: '12px' }}>
                            <div style={SLIDER_HEADER_STYLE}>
                                <label className="editor-label editor-label-small" style={SLIDER_LABEL_STYLE}>Global Volume Override</label>
                                <span style={SLIDER_VALUE_STYLE}>{volume === -1 ? '(Per-track default)' : `${Math.round(volume * 100)}%`}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input type="range" min="-1" max="1" step="0.01" value={volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ flex: 1 }} />
                            </div>
                            <div style={FIELD_HINT_STYLE}>-1 = use each track's own volume. ≥0 = override all tracks uniformly.</div>
                        </div>

                        <ProfileCheckbox checked={forceNameReveal} onChange={setForceNameReveal} label="Force Name Reveal" hint='Always show character names instead of "Character X".' />
                        <ProfileCheckbox checked={enableCharacterExpression} onChange={setEnableCharacterExpression} label="Enable Character Expression" hint="Use sentiment analysis to swap character images based on emotional tone. Disable to always use the neutral character images." spaced />
                    </div>

                    {/* Injection Section */}
                    <div className="editor-section">
                        <span className="editor-section-title">Injection</span>

                        <ProfileCheckbox checked={forceNoCharacterImageInjection} onChange={setForceNoCharacterImageInjection} label="Force No Character Image Injection" hint="Prevent character images from being sent to the model, even if the character has one assigned." />
                        <ProfileCheckbox checked={forceNoContextImageInjection} onChange={setForceNoContextImageInjection} label="Force No Context Image Injection" hint="Prevent context images from being sent to the model." spaced />
                        <ProfileCheckbox checked={forceNoLocationImageInjection} onChange={setForceNoLocationImageInjection} label="Force No Location Image Injection" hint="Prevent location images from being sent to the model." spaced />
                        <ProfileCheckbox checked={useCurrentDateAndTime} onChange={setUseCurrentDateAndTime} label="Use Current Date And Time" hint="Inject the current real-world date and time into the prompt so the model is aware of when the conversation is taking place." spaced />
                        <ProfileCheckbox checked={useWeather} onChange={setUseWeather} label="Use Weather" hint="Auto-detect your location via browser geolocation and inject current weather conditions using the OpenWeather API." spaced />

                        {useWeather && (
                            <div style={{ marginTop: '8px', marginLeft: '26px' }}>
                                <label className="editor-label editor-label-small">OpenWeather API Key</label>
                                <input type="password" value={weatherApiKey} onChange={(e) => setWeatherApiKey(e.target.value)} className="editor-input" placeholder="Paste your OpenWeather API key..." autoComplete="off" />
                                <div style={FIELD_HINT_STYLE}>Free tier: 1,000 calls/day. Get one at openweathermap.org/api</div>
                            </div>
                        )}

                        <ProfileCheckbox checked={useTimeElapsed} onChange={setUseTimeElapsed} label="Use Time Elapsed" hint="Inject how long it has been since the last message was sent. Useful for real-time pacing awareness." spaced />

                        <div style={{ marginTop: '12px' }}>
                            <SliderInput label="Number of Messages to Disable Think Prompt" value={numberOfMessagesToDisableThinkPrompt} minimumValue={-1} maximumValue={10} stepValue={1} decimals={0} onChange={(val) => setNumberOfMessagesToDisableThinkPrompt(Math.round(val))} description="-1 = auto defer to character default. N = disable after N messages." />
                        </div>
                        <div style={{ marginTop: '12px' }}>
                            <SliderInput label="Number of Messages to Disable Meta-Thinking" value={numberOfMessagesToDisableMetaThinkInstructions} minimumValue={-1} maximumValue={10} stepValue={1} decimals={0} onChange={(val) => setNumberOfMessagesToDisableMetaThinkInstructions(Math.round(val))} description="-1 = auto defer to character default. N = disable after N messages." />
                        </div>
                        <div style={{ marginTop: '12px' }}>
                            <SliderInput label="Number of Messages to Disable Dialogue Prompt" value={numberOfMessagesToDisableDialoguePrompt} minimumValue={-1} maximumValue={10} stepValue={1} decimals={0} onChange={(val) => setNumberOfMessagesToDisableDialoguePrompt(Math.round(val))} description="-1 = auto defer to character default. N = disable after N messages." />
                        </div>
                    </div>

                    {/* Turn Sequencing Overrides */}
                    <div className="editor-section">
                        <span className="editor-section-title">Turn Sequencing</span>

                        <ProfileCheckbox checked={forceEqualInitiative} onChange={setForceEqualInitiative} label="Force Equal Initiative" hint="All participants get equal initiative weight regardless of character settings." />

                        {renderOverrideSlider('Chat Probability Override', chatProbability, -1, 1, 0.05, 2, setChatProbability, '-1 = disabled (use per-character setting). Slide right to override all participants.', chatProbability === -1 ? '(Character default)' : undefined)}
                        {renderOverrideSlider('Maximum Chat Stamina Override', maximumChatStamina, -1, 10, 1, 0, (val) => setMaximumChatStamina(Math.round(val)), '-1 = disabled (use per-character setting). Slide right to set a shared stamina cap.', maximumChatStamina === -1 ? '(Character default)' : undefined)}
                        {renderOverrideSlider('Name Sensitivity Override', nameSensitivity, -1, 10, 0.5, 1, setNameSensitivity, '-1 = defer to character default. 0 = disabled. N = multiplier per name mention in latest message.', nameSensitivity === -1 ? '(Character default)' : nameSensitivity === 0 ? '(Disabled)' : undefined)}
                        {renderOverrideSlider('Skip Probability Override', skipProbability, -1, 1, 0.05, 2, setSkipProbability, '-1 = defer to character. 0 = disabled. 0–1 = probability of skipping turn even when selected.', skipProbability === -1 ? '(Character default)' : skipProbability === 0 ? '(Disabled)' : undefined)}
                        {renderOverrideSlider('Chat Impatience Override', chatImpatienceSensitivity, -1, 5, 0.1, 1, setChatImpatienceSensitivity, '-1 = defer to character. 0 = disabled. Higher values make quiet characters speak sooner.', chatImpatienceSensitivity === -1 ? '(Character default)' : chatImpatienceSensitivity === 0 ? '(Disabled)' : undefined)}
                        {renderOverrideSlider('Memory Retention Override', memoryRetentionWeight, -1, 2, 0.1, 1, setMemoryRetentionWeight, '-1 = defer to character. 0 = minimal history. 1 = full history. Controls how far back memories reach.', memoryRetentionWeight === -1 ? '(Character default)' : memoryRetentionWeight === 0 ? '(Minimal)' : undefined)}
                        {renderOverrideSlider('Context Sensitivity Override', contextSensitivity, -1, 2, 0.1, 1, setContextSensitivity, '-1 = defer to character. 0 = never activate context. 1 = normal. Controls how readily context entries trigger.', contextSensitivity === -1 ? '(Character default)' : contextSensitivity === 0 ? '(Blind)' : undefined)}
                    </div>

                    {/* Cache Invalidation Reduction */}
                    <div className="editor-section">
                        <div style={SLIDER_HEADER_STYLE}>
                            <span className="editor-section-title" style={{ margin: 0 }}>Cache Invalidation Reduction</span>
                        </div>
                        <SliderInput label="" value={cacheLevel} minimumValue={0} maximumValue={3} stepValue={1} decimals={0} onChange={(val) => setCacheLevel(Math.round(val))} description={CACHE_LEVEL_DESCRIPTIONS[Math.round(cacheLevel)] || ''} />
                    </div>

                    {/* Voice Narration */}
                    <div className="editor-section">
                        <span className="editor-section-title">Voice Narration</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            <ProfileCheckbox checked={narrateNormalText} onChange={setNarrateNormalText} label="Narrate Normal Text" />
                            <ProfileCheckbox checked={narrateQuotedText} onChange={setNarrateQuotedText} label="Narrate Quoted Text" />
                            <ProfileCheckbox checked={narrateBoldedText} onChange={setNarrateBoldedText} label="Narrate Bolded Text" />
                            <ProfileCheckbox checked={narrateItalicizedText} onChange={setNarrateItalicizedText} label="Narrate Italicized Text" />
                        </div>
                    </div>

                    {/* Strip Think Tokens */}
                    <div className="editor-section">
                        <span className="editor-section-title">Output Processing</span>
                        <ProfileCheckbox checked={stripThinkTokens} onChange={setStripThinkTokens} label="Strip Think Tokens" hint="Remove <think>...</think> blocks from displayed output. The model still uses them internally." />
                    </div>

                    {/* Tools */}
                    <div className="editor-section">
                        <span className="editor-section-title">Tools</span>
                        <div style={{ ...CHECKBOX_HINT_STYLE, marginLeft: 0, marginBottom: '12px' }}>Enable runtime tool use during generation. These are not prompt injections — they allow the model to invoke tools while chatting.</div>
                        {renderOverrideSlider('Web Search Override', enableWebSearch, -1, 1, 1, 0, (val) => setEnableWebSearch(Math.round(val)), '-1 = force off for all. 0 = use each character\'s own setting. 1 = force on for all.', enableWebSearch === 0 ? '(Character default)' : enableWebSearch === -1 ? '(Force Off)' : '(Force On)')}
                        {renderOverrideSlider('Calculator Override', enableCalculator, -1, 1, 1, 0, (val) => setEnableCalculator(Math.round(val)), '-1 = force off for all. 0 = use each character\'s own setting. 1 = force on for all.', enableCalculator === 0 ? '(Character default)' : enableCalculator === -1 ? '(Force Off)' : '(Force On)')}
                    </div>

                    {/* Memory */}
                    <div className="editor-section">
                        <span className="editor-section-title">Memory</span>
                        {renderOverrideSlider('Memory Reading Override', enableMemoryReading, -1, 1, 1, 0, (val) => setEnableMemoryReading(Math.round(val)), '-1 = force off for all. 0 = use each character\'s own setting. 1 = force on for all.', enableMemoryReading === 0 ? '(Character default)' : enableMemoryReading === -1 ? '(Force Off)' : '(Force On)')}
                        {renderOverrideSlider('Memory Writing Override', enableMemoryWriting, -1, 1, 1, 0, (val) => setEnableMemoryWriting(Math.round(val)), '-1 = force off for all. 0 = use each character\'s own setting. 1 = force on for all.', enableMemoryWriting === 0 ? '(Character default)' : enableMemoryWriting === -1 ? '(Force Off)' : '(Force On)')}
                    </div>

                    {/* Input Strategy Order */}
                    <div className="editor-section">
                        <div className="editor-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Prompt Block Order</span>
                            <span style={{ fontSize: '0.6rem', opacity: 0.5, fontWeight: 'normal', textTransform: 'none', letterSpacing: 0 }}>↕ Drag To Reorder</span>
                        </div>
                        <div style={CHECKBOX_HINT_STYLE}>Controls the order in which prompt sections are assembled. Includes built-in blocks and custom prompt blocks.</div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {inputStrategy.map((blockEntry, index) => (
                                <div key={`${blockEntry}-${index}`} draggable onDragStart={(e) => handleDragStart(e, index)} onDragEnd={handleDragEnd} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, index)} className={`sampler-param-row ${draggedIndex === index ? 'sampler-param-dragging' : ''}`} style={{ padding: '6px 8px' }}>
                                    <div className="sampler-drag-handle" title="Drag to reorder">⋮⋮</div>
                                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-h)' }}>{index + 1}. {getBlockLabel(blockEntry)}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }}>
                                        <button type="button" onClick={() => moveBlock(index, -1)} disabled={index === 0} className="toolbar-button" title="Move up" style={{ ...TOOLBAR_BTN_SMALL_STYLE, opacity: index === 0 ? 0.3 : 1 }}>▲</button>
                                        <button type="button" onClick={() => moveBlock(index, 1)} disabled={index === inputStrategy.length - 1} className="toolbar-button" title="Move down" style={{ ...TOOLBAR_BTN_SMALL_STYLE, opacity: index === inputStrategy.length - 1 ? 0.3 : 1 }}>▼</button>
                                        <button type="button" onClick={() => removeBlock(index)} className="toolbar-button" title="Remove from order" style={TOOLBAR_BTN_DELETE_STYLE}>×</button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {(missingBuiltInBlocks.length > 0 || availablePromptBlocks.length > 0) && (
                            <div style={{ marginTop: '8px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                <select onChange={(e) => { const val = e.target.value; if (val) addBlock(val); e.target.value = ''; }} className="editor-select" defaultValue="" style={{ flex: 1 }}>
                                    <option value="" disabled>+ Add a block</option>
                                    {missingBuiltInBlocks.length > 0 && <optgroup label="Built-in Blocks">
                                        {missingBuiltInBlocks.map(b => <option key={b} value={b}>{b}</option>)}
                                    </optgroup>}
                                    {availablePromptBlocks.length > 0 && <optgroup label="Custom Prompt Blocks">
                                        {availablePromptBlocks.map((pb: PromptBlock) => <option key={pb.id} value={pb.id}>🧱 {pb.name}</option>)}
                                    </optgroup>}
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
                        <div style={CHECKBOX_HINT_STYLE}>Controls how messages are summarized based on the order of the individual text summarizers.</div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {summarizationSteps.map((step, index) => {
                                const isDragging = draggedStepIndex === index;
                                const isExpanded = expandedStepId === step.id;

                                return (
                                    <div key={step.id}>
                                        <div draggable onDragStart={(e) => handleStepDragStart(e, index)} onDragEnd={handleStepDragEnd} onDragOver={handleDragOver} onDrop={(e) => handleStepDrop(e, index)} className={`sampler-param-row ${isDragging ? 'sampler-param-dragging' : ''}`} style={{ padding: '6px 8px', cursor: 'pointer' }} onClick={() => setExpandedStepId(isExpanded ? null : step.id)}>
                                            <div className="sampler-drag-handle" title="Drag to reorder" onClick={(e) => e.stopPropagation()}>⋮⋮</div>
                                            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={STEP_NAME_STYLE}>{index + 1}. {step.name}</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                                <button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} className="toolbar-button" title="Move up" style={{ ...TOOLBAR_BTN_SMALL_STYLE, opacity: index === 0 ? 0.3 : 1 }}>▲</button>
                                                <button type="button" onClick={() => moveStep(index, 1)} disabled={index === summarizationSteps.length - 1} className="toolbar-button" title="Move down" style={{ ...TOOLBAR_BTN_SMALL_STYLE, opacity: index === summarizationSteps.length - 1 ? 0.3 : 1 }}>▼</button>
                                                <button type="button" onClick={() => removeSummarizationStep(index)} className="toolbar-button" title="Remove step" style={TOOLBAR_BTN_DELETE_STYLE}>×</button>
                                                <span style={{ fontSize: '0.7rem', opacity: 0.5, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <div style={STEP_EXPANDED_STYLE}>
                                                <div style={STEP_DESC_STYLE}>{STRATEGY_DESCRIPTIONS[step.strategyType]}</div>

                                                {step.strategyType === 'Sliding Window Replace' && (
                                                    <div>
                                                        <label className="editor-label editor-label-small">Window Size</label>
                                                        <input type="number" min="1" max="50" value={step.slidingWindowSize ?? 10} onChange={(e) => updateStepField(index, 'slidingWindowSize', Math.max(1, Number(e.target.value) || 10))} className="editor-input" style={INPUT_RIGHT_STYLE} />
                                                        <div style={FIELD_HINT_STYLE}>Keep last N messages verbatim</div>
                                                    </div>
                                                )}

                                                {step.strategyType === 'Periodic Compression' && (
                                                    <div className="editor-row">
                                                        <div>
                                                            <label className="editor-label editor-label-small">Compression Interval</label>
                                                            <input type="number" min="5" max="100" value={step.compressionInterval ?? 20} onChange={(e) => updateStepField(index, 'compressionInterval', Math.max(5, Number(e.target.value) || 20))} className="editor-input" style={INPUT_RIGHT_STYLE} />
                                                            <div style={FIELD_HINT_STYLE}>Compress every M messages</div>
                                                        </div>
                                                        <div>
                                                            <label className="editor-label editor-label-small">Chunk Size</label>
                                                            <input type="number" min="5" max="50" value={step.compressionChunkSize ?? 10} onChange={(e) => updateStepField(index, 'compressionChunkSize', Math.max(5, Number(e.target.value) || 10))} className="editor-input" style={INPUT_RIGHT_STYLE} />
                                                            <div style={FIELD_HINT_STYLE}>Messages per compression chunk</div>
                                                        </div>
                                                    </div>
                                                )}

                                                {step.strategyType === 'Recursive Summary' && (
                                                    <div className="editor-row">
                                                        <div>
                                                            <label className="editor-label editor-label-small">Chunk Size</label>
                                                            <input type="number" min="5" max="50" value={step.recursiveChunkSize ?? 10} onChange={(e) => updateStepField(index, 'recursiveChunkSize', Math.max(5, Number(e.target.value) || 10))} className="editor-input" style={INPUT_RIGHT_STYLE} />
                                                            <div style={FIELD_HINT_STYLE}>Messages per chunk at layer 0</div>
                                                        </div>
                                                        <div>
                                                            <label className="editor-label editor-label-small">Max Depth</label>
                                                            <input type="number" min="1" max="5" value={step.recursiveMaxDepth ?? 3} onChange={(e) => updateStepField(index, 'recursiveMaxDepth', Math.max(1, Number(e.target.value) || 3))} className="editor-input" style={INPUT_RIGHT_STYLE} />
                                                            <div style={FIELD_HINT_STYLE}>Max recursion layers</div>
                                                        </div>
                                                    </div>
                                                )}

                                                {step.strategyType === 'Observation Masking' && (
                                                    <div className="editor-row">
                                                        <div>
                                                            <label className="editor-label editor-label-small">Relevance Threshold</label>
                                                            <input type="number" min="0" max="1" step="0.05" value={step.maskingRelevanceThreshold ?? 0.3} onChange={(e) => updateStepField(index, 'maskingRelevanceThreshold', Math.max(0, Math.min(1, Number(e.target.value) || 0.3)))} className="editor-input" style={INPUT_RIGHT_STYLE} />
                                                            <div style={FIELD_HINT_STYLE}>Min score to include (0.0–1.0)</div>
                                                        </div>
                                                        <div>
                                                            <label className="editor-label editor-label-small">Keyword Weight</label>
                                                            <input type="number" min="0" max="1" step="0.05" value={step.maskingKeywordWeight ?? 0.7} onChange={(e) => updateStepField(index, 'maskingKeywordWeight', Math.max(0, Math.min(1, Number(e.target.value) || 0.7)))} className="editor-input" style={INPUT_RIGHT_STYLE} />
                                                            <div style={FIELD_HINT_STYLE}>Keyword vs recency balance</div>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="editor-row">
                                                    <div>
                                                        <label className="editor-label editor-label-small">Summary Token Budget</label>
                                                        <input type="number" min="64" max="4096" step="64" value={step.summaryTokenBudget ?? 512} onChange={(e) => updateStepField(index, 'summaryTokenBudget', Math.max(64, Number(e.target.value) || 512))} className="editor-input" style={INPUT_RIGHT_STYLE} />
                                                        <div style={FIELD_HINT_STYLE}>Max tokens for generated summaries</div>
                                                    </div>
                                                    <div>
                                                        <label className="editor-label editor-label-small">Trigger Threshold</label>
                                                        <input type="number" min="0" max="131072" step="1024" value={step.triggerTokenThreshold ?? 0} onChange={(e) => updateStepField(index, 'triggerTokenThreshold', Math.max(0, Number(e.target.value) || 0))} className="editor-input" style={INPUT_RIGHT_STYLE} />
                                                        <div style={FIELD_HINT_STYLE}>0 = auto based on context length</div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ marginTop: '8px' }}>
                            <select onChange={(e) => { const val = e.target.value as SummarizationStrategyType; if (val) addSummarizationStep(val); e.target.value = ''; }} className="editor-select" defaultValue="">
                                <option value="" disabled>+ Add a summarization step</option>
                                {ALL_STRATEGY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>

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