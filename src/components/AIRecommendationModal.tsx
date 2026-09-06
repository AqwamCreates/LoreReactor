// src/components/AIRecommendationModal.tsx
import type React from 'react';
import { useState, useRef } from 'react';
import type { Character, Context, Location, Sampler, LanguageModel } from '../types';
import { generateAIRecommendation, type RecommendationResult } from '../services/AIRecommendationEngine';
import { getInitiativeWeightValueFromText, getChatProbabilityValue, getMaximumChatStaminaValueFromText, getNameSensitivityValueFromText, getSkipProbabilityValueFromText, getChatImpatienceSensitivityValueFromText, getMemoryRetentionWeightValueFromText, getContextSensitivityValueFromText } from '../hooks/chatTraitsDetection';
import { EntitySelectList } from './EntitySelectList';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

type EntityType = 'Character' | 'Context' | 'Location';

interface AIRecommendationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaveCharacter: (char: Character) => Promise<boolean>;
    onSaveContext: (ctx: Context) => Promise<boolean>;
    onSaveLocation: (loc: Location) => Promise<boolean>;
    allSamplers: Sampler[];
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    selectedModel: LanguageModel | null;
    runningModels: Record<string, { isRunning?: boolean; port?: number }>;
}

const ENTITY_OPTIONS: { type: EntityType; label: string; icon: string }[] = [
    { type: 'Character', label: 'Character', icon: '🎭' },
    { type: 'Context', label: 'Context', icon: '🌍' },
    { type: 'Location', label: 'Location', icon: '📍' },
];

export function AIRecommendationModal({
    isOpen,
    onClose,
    onSaveCharacter,
    onSaveContext,
    onSaveLocation,
    allSamplers,
    allCharacters,
    allContexts,
    allLocations,
    selectedModel,
    runningModels,
}: AIRecommendationModalProps) {
    const [selectedEntities, setSelectedEntities] = useState<EntityType[]>(['Character']);
    const [userPrompt, setUserPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [result, setResult] = useState<RecommendationResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
    const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
    const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);

    const [charSearch, setCharSearch] = useState('');
    const [ctxSearch, setCtxSearch] = useState('');
    const [locSearch, setLocSearch] = useState('');

    const reset = () => {
        setResult(null);
        setError(null);
        setIsGenerating(false);
        setIsSaving(false);
        setUserPrompt('');
        setSelectedCharacterIds([]);
        setSelectedContextIds([]);
        setSelectedLocationIds([]);
        setCharSearch('');
        setCtxSearch('');
        setLocSearch('');
    };

    const handleClose = () => {
        if (isGenerating) abortControllerRef.current?.abort();
        reset();
        onClose();
    };

    const toggleEntity = (type: EntityType) => {
        setSelectedEntities(prev =>
            prev.includes(type) ? prev.filter(e => e !== type) : [...prev, type]
        );
    };

    const toggleInOrderedList = (
        ids: string[],
        setIds: React.Dispatch<React.SetStateAction<string[]>>,
        id: string,
    ) => {
        if (ids.includes(id)) {
            setIds(prev => prev.filter(x => x !== id));
        } else {
            setIds(prev => [...prev, id]);
        }
    };

    const buildExistingReferenceBlock = (): string => {
        const parts: string[] = [];

        if (selectedCharacterIds.length > 0) {
            parts.push('EXISTING CHARACTERS (ordered by relevance — earlier entries are higher priority references):');
            for (let i = 0; i < selectedCharacterIds.length; i++) {
                const c = allCharacters.find(ch => ch.id === selectedCharacterIds[i]);
                if (!c) continue;
                parts.push(`${i + 1}. Name: ${c.name}`);
                if (c.description) parts.push(`   Description: ${c.description.substring(0, 300)}`);
                if (c.systemPrompt) parts.push(`   System Prompt: ${c.systemPrompt.substring(0, 300)}`);
            }
            parts.push('');
        }

        if (selectedContextIds.length > 0) {
            parts.push('EXISTING CONTEXTS (ordered by relevance — earlier entries are higher priority references):');
            for (let i = 0; i < selectedContextIds.length; i++) {
                const ctx = allContexts.find(c => c.id === selectedContextIds[i]);
                if (!ctx) continue;
                parts.push(`${i + 1}. Name: ${ctx.name}`);
                if (ctx.text) parts.push(`   Content: ${ctx.text.substring(0, 300)}`);
                if (ctx.regularExpressionActivationTrigger) parts.push(`   Trigger: ${ctx.regularExpressionActivationTrigger}`);
                if (ctx.regularExpressionDeactivationTrigger) parts.push(`   Deactivation: ${ctx.regularExpressionDeactivationTrigger}`);
            }
            parts.push('');
        }

        if (selectedLocationIds.length > 0) {
            parts.push('EXISTING LOCATIONS (ordered by relevance — earlier entries are higher priority references):');
            for (let i = 0; i < selectedLocationIds.length; i++) {
                const loc = allLocations.find(l => l.id === selectedLocationIds[i]);
                if (!loc) continue;
                parts.push(`${i + 1}. Name: ${loc.name}`);
                if (loc.text) parts.push(`   Content: ${loc.text.substring(0, 300)}`);
                if (loc.regularExpressionActivationTrigger) parts.push(`   Trigger: ${loc.regularExpressionActivationTrigger}`);
            }
            parts.push('');
        }

        return parts.join('\n');
    };

    const buildSystemPrompt = (): string => {
        const parts: string[] = [];
        parts.push('You are a creative writing assistant for roleplay. Generate exactly ONE of each requested entity type below.');
        parts.push('Output ONLY the requested fields using the exact format {Field Name: content}. Do not add any other text, commentary, or markdown.');
        parts.push('Each field value should be detailed, creative, and internally consistent across all generated entities.');
        parts.push('If existing entities are provided below, ensure the new entities are consistent with them in tone, world-building, and style. Prioritize consistency with earlier-numbered references.');
        parts.push('');

        const existingBlock = buildExistingReferenceBlock();
        if (existingBlock) parts.push(existingBlock);

        if (selectedEntities.includes('Character')) {
            parts.push('CHARACTER FIELDS (generate exactly one character):');
            parts.push('{Character Name: }', '{Character Description: }', '{Character First Message: }');
            parts.push('{Character System Prompt: }', '{Character Think Prompt: }');
            parts.push('{Character Appearance Prompt: }', '{Character Dialogue Prompt: }', '');
        }
        if (selectedEntities.includes('Context')) {
            parts.push('CONTEXT FIELDS (generate exactly one context):');
            parts.push('{Context Name: }', '{Context Description: }', '{Context Text Content: }');
            parts.push('{Context Regular Expression Activation Trigger: }', '{Context Regular Expression Deactivation Trigger: }', '');
        }
        if (selectedEntities.includes('Location')) {
            parts.push('LOCATION FIELDS (generate exactly one location):');
            parts.push('{Location Name: }', '{Location Description: }', '{Location Text Content: }');
            parts.push('{Location Regular Expression Activation Trigger: }', '');
        }

        return parts.join('\n');
    };

    const handleGenerate = async () => {
        if (selectedEntities.length === 0) { setError('Select at least one entity type to generate.'); return; }
        if (!selectedModel) { setError('No model selected. Open Models to load one first.'); return; }

        const port = selectedModel.id ? runningModels[selectedModel.id]?.port : undefined;
        const effectivePort = port || (selectedModel.parameters as any)?._runtimePort;
        if (!effectivePort && !selectedModel.apiKey) { setError('Selected model is not loaded and has no API key.'); return; }

        setIsGenerating(true);
        setError(null);
        setResult(null);

        const ctrl = new AbortController();
        abortControllerRef.current = ctrl;

        try {
            const systemPrompt = buildSystemPrompt();
            const userRequestPart = userPrompt.trim()
                ? `\n\nUser Request: ${userPrompt.trim()}`
                : '\n\nUser Request: Generate freely based on the existing entities and field templates provided above.';
            const fullPrompt = `${systemPrompt}${userRequestPart}`;

            const modelContext = {
                apiKey: selectedModel.apiKey,
                backend: selectedModel.backend,
                modelPath: (selectedModel as any).modelPath || (selectedModel as any).parameters?.modelPath,
                runtimePort: effectivePort,
            };

            const rec = await generateAIRecommendation({ prompt: fullPrompt, modelContext }, ctrl.signal);

            if (Object.keys(rec.parsed).length === 0) {
                setError('AI response did not contain any recognizable fields. Try again with a more specific prompt.');
                setResult(rec);
            } else {
                setResult(rec);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') setError(`Generation failed: ${(err as Error).message}`);
        } finally {
            setIsGenerating(false);
            abortControllerRef.current = null;
        }
    };

    const handleSave = async () => {
        if (!result) return;
        setIsSaving(true);
        setError(null);

        const now = Date.now();
        const p = result.parsed;

        try {
            if (p['Character Name']) {
                const traitText = `${p['Character Name'] || ''} ${p['Character Description'] || ''} ${p['Character System Prompt'] || ''}`;
                const char: Character = {
                    id: uuidv4(), name: p['Character Name'], description: p['Character Description'] || '',
                    systemPrompt: p['Character System Prompt'] || '', thinkPrompt: p['Character Think Prompt'] || undefined,
                    appearancePrompt: p['Character Appearance Prompt'] || undefined, dialoguePrompt: p['Character Dialogue Prompt'] || undefined,
                    images: {}, sampler: allSamplers.length > 0 ? allSamplers[0] : undefined,
                    initiativeWeight: getInitiativeWeightValueFromText(traitText), chatProbability: getChatProbabilityValue(traitText),
                    maximumChatStamina: Math.round(getMaximumChatStaminaValueFromText(traitText)),
                    nameSensitivity: getNameSensitivityValueFromText(traitText), skipProbability: getSkipProbabilityValueFromText(traitText),
                    chatImpatienceSensitivity: getChatImpatienceSensitivityValueFromText(traitText),
                    memoryRetentionWeight: getMemoryRetentionWeightValueFromText(traitText),
                    contextSensitivity: getContextSensitivityValueFromText(traitText),
                    enableMemoryWriting: false, enableMemoryReading: false, memories: {},
                    numberOfMessagesToDisableThinkPrompt: 0, numberOfMessagesToDisableMetaThinkInstructions: 0,
                    numberOfMessagesToDisableDialoguePrompt: 0, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveCharacter(char)) throw new Error('Failed to save character.');
            }
            if (p['Context Name']) {
                const ctx: Context = {
                    id: uuidv4(), name: p['Context Name'], description: p['Context Description'] || undefined,
                    text: p['Context Text Content'] || '',
                    regularExpressionActivationTrigger: p['Context Regular Expression Activation Trigger'] || undefined,
                    regularExpressionDeactivationTrigger: p['Context Regular Expression Deactivation Trigger'] || undefined,
                    useBase64Encoding: false, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveContext(ctx)) throw new Error('Failed to save context.');
            }
            if (p['Location Name']) {
                const loc: Location = {
                    id: uuidv4(), name: p['Location Name'], description: p['Location Description'] || undefined,
                    text: p['Location Text Content'] || '',
                    regularExpressionActivationTrigger: p['Location Regular Expression Activation Trigger'] || undefined,
                    characterBindings: [], locationBindings: [], globalWeight: 1, characterWeights: {},
                    useBase64Encoding: false, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveLocation(loc)) throw new Error('Failed to save location.');
            }
            reset();
            onClose();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const hasCharacterFields = result && Object.keys(result.parsed).some(k => k.startsWith('Character'));
    const hasContextFields = result && Object.keys(result.parsed).some(k => k.startsWith('Context'));
    const hasLocationFields = result && Object.keys(result.parsed).some(k => k.startsWith('Location'));

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Get AI Recommendation</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClose} disabled={isGenerating || isSaving}>
                            {result ? 'Close' : 'Cancel'}
                        </button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {!result && (
                        <>
                            <div className="editor-section">
                                <span className="editor-section-title">Generate</span>
                                <div className="entity-type-buttons">
                                    {ENTITY_OPTIONS.map(opt => {
                                        const isSelected = selectedEntities.includes(opt.type);
                                        return (
                                            <button key={opt.type} type="button" onClick={() => toggleEntity(opt.type)}
                                                className={`editor-btn ${isSelected ? 'editor-btn-save' : 'editor-btn-cancel'} entity-type-btn`}
                                                disabled={isGenerating}>
                                                {opt.icon} {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="entity-type-hint">
                                    Select one or more entity types. The AI will generate exactly one of each selected type.
                                </div>
                            </div>

                            <div className="editor-section">
                                <span className="editor-section-title">Reference Existing (Optional)</span>
                                <div className="entity-ref-hint">
                                    Select and order existing entities so the AI generates consistent content. Click to add/remove. First selected = highest priority.
                                </div>
                                <EntitySelectList label="Characters" items={allCharacters} selectedIds={selectedCharacterIds}
                                    onToggle={(id) => toggleInOrderedList(selectedCharacterIds, setSelectedCharacterIds, id)}
                                    searchQuery={charSearch} onSearchChange={setCharSearch} disabled={isGenerating} />
                                <EntitySelectList label="Contexts" items={allContexts} selectedIds={selectedContextIds}
                                    onToggle={(id) => toggleInOrderedList(selectedContextIds, setSelectedContextIds, id)}
                                    searchQuery={ctxSearch} onSearchChange={setCtxSearch} disabled={isGenerating} />
                                <EntitySelectList label="Locations" items={allLocations} selectedIds={selectedLocationIds}
                                    onToggle={(id) => toggleInOrderedList(selectedLocationIds, setSelectedLocationIds, id)}
                                    searchQuery={locSearch} onSearchChange={setLocSearch} disabled={isGenerating} />
                                {allCharacters.length === 0 && allContexts.length === 0 && allLocations.length === 0 && (
                                    <div className="entity-ref-empty">No existing entities available to reference.</div>
                                )}
                            </div>

                            <div className="editor-section">
                                <label className="editor-label">Describe what you want <span className="optional-label">(optional)</span></label>
                                <textarea value={userPrompt} onChange={e => setUserPrompt(e.target.value)} className="editor-textarea"
                                    placeholder="Leave empty to let the AI generate freely based on referenced entities..." rows={3} disabled={isGenerating} />
                            </div>

                            <button type="button" className="editor-btn editor-btn-save entity-generate-btn"
                                onClick={handleGenerate} disabled={isGenerating || selectedEntities.length === 0}>
                                {isGenerating ? '⏳ Generating...' : '✨ Generate Recommendation'}
                            </button>

                            {error && <div className="editor-error-message editor-error-centered entity-error-below">{error}</div>}
                        </>
                    )}

                    {result && (
                        <>
                            {error && <div className="editor-error-message editor-error-centered entity-error-above">{error}</div>}

                            {hasCharacterFields && (
                                <div className="editor-section">
                                    <span className="editor-section-title">🎭 Character</span>
                                    <div className="entity-preview-grid">
                                        {result.parsed['Character Name'] && <div><strong>Name:</strong> {result.parsed['Character Name']}</div>}
                                        {result.parsed['Character Description'] && <div><strong>Description:</strong> {result.parsed['Character Description'].substring(0, 150)}{result.parsed['Character Description'].length > 150 ? '...' : ''}</div>}
                                        {result.parsed['Character First Message'] && <div><strong>First Message:</strong> {result.parsed['Character First Message'].substring(0, 100)}{result.parsed['Character First Message'].length > 100 ? '...' : ''}</div>}
                                        {result.parsed['Character System Prompt'] && <div><strong>System Prompt:</strong> {result.parsed['Character System Prompt'].length} chars</div>}
                                        {result.parsed['Character Think Prompt'] && <div><strong>Think Prompt:</strong> {result.parsed['Character Think Prompt'].length} chars</div>}
                                        {result.parsed['Character Appearance Prompt'] && <div><strong>Appearance:</strong> {result.parsed['Character Appearance Prompt'].length} chars</div>}
                                        {result.parsed['Character Dialogue Prompt'] && <div><strong>Dialogue Examples:</strong> {result.parsed['Character Dialogue Prompt'].length} chars</div>}
                                    </div>
                                </div>
                            )}

                            {hasContextFields && (
                                <div className="editor-section">
                                    <span className="editor-section-title">🌍 Context</span>
                                    <div className="entity-preview-grid">
                                        {result.parsed['Context Name'] && <div><strong>Name:</strong> {result.parsed['Context Name']}</div>}
                                        {result.parsed['Context Description'] && <div><strong>Description:</strong> {result.parsed['Context Description'].substring(0, 150)}{result.parsed['Context Description'].length > 150 ? '...' : ''}</div>}
                                        {result.parsed['Context Text Content'] && <div><strong>Content:</strong> {result.parsed['Context Text Content'].substring(0, 150)}{result.parsed['Context Text Content'].length > 150 ? '...' : ''}</div>}
                                        {result.parsed['Context Regular Expression Activation Trigger'] && <div><strong>Activation:</strong> <code className="entity-code">{result.parsed['Context Regular Expression Activation Trigger']}</code></div>}
                                        {result.parsed['Context Regular Expression Deactivation Trigger'] && <div><strong>Deactivation:</strong> <code className="entity-code">{result.parsed['Context Regular Expression Deactivation Trigger']}</code></div>}
                                    </div>
                                </div>
                            )}

                            {hasLocationFields && (
                                <div className="editor-section">
                                    <span className="editor-section-title">📍 Location</span>
                                    <div className="entity-preview-grid">
                                        {result.parsed['Location Name'] && <div><strong>Name:</strong> {result.parsed['Location Name']}</div>}
                                        {result.parsed['Location Description'] && <div><strong>Description:</strong> {result.parsed['Location Description'].substring(0, 150)}{result.parsed['Location Description'].length > 150 ? '...' : ''}</div>}
                                        {result.parsed['Location Text Content'] && <div><strong>Content:</strong> {result.parsed['Location Text Content'].substring(0, 150)}{result.parsed['Location Text Content'].length > 150 ? '...' : ''}</div>}
                                        {result.parsed['Location Regular Expression Activation Trigger'] && <div><strong>Activation:</strong> <code className="entity-code">{result.parsed['Location Regular Expression Activation Trigger']}</code></div>}
                                    </div>
                                </div>
                            )}

                            <div className="entity-action-buttons">
                                <button type="button" className="editor-btn editor-btn-cancel" onClick={() => { setResult(null); setError(null); }} disabled={isSaving}>Regenerate</button>
                                <button type="button" className="editor-btn editor-btn-save" onClick={handleSave} disabled={isSaving}>
                                    {isSaving ? 'Saving...' : '💾 Save All'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}