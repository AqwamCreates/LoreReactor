// src/components/AIRecommendationModal.tsx
import type React from 'react';
import { useState, useRef, useCallback } from 'react';
import type { Character, Context, Location, Sampler, LanguageModel } from '../types';
import { getInitiativeWeightValueFromText, getChatProbabilityValue, getMaximumChatStaminaValueFromText, getNameSensitivityValueFromText, getSkipProbabilityValueFromText, getChatImpatienceSensitivityValueFromText, getMemoryRetentionWeightValueFromText, getContextSensitivityValueFromText } from '../hooks/chatTraitsDetection';
import { EntitySelectList } from './EntitySelectList';
import { LanguageModelEngine } from '../services/LanguageModelEngine';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

type EntityType = 'Character' | 'Context' | 'Location';
type ViewTab = 'raw' | 'Character' | 'Context' | 'Location';

interface ParsedFields {
    [key: string]: string;
}

const FIELD_PATTERNS: { key: string; regex: RegExp }[] = [
    { key: 'Character Name', regex: /<<<Character Name:\s*([\s\S]*?)>>>/i },
    { key: 'Character Description', regex: /<<<Character Description:\s*([\s\S]*?)>>>/i },
    { key: 'Character First Message', regex: /<<<Character First Message:\s*([\s\S]*?)>>>/i },
    { key: 'Character System Prompt', regex: /<<<Character System Prompt:\s*([\s\S]*?)>>>/i },
    { key: 'Character Think Prompt', regex: /<<<Character Think Prompt:\s*([\s\S]*?)>>>/i },
    { key: 'Character Appearance Prompt', regex: /<<<Character Appearance Prompt:\s*([\s\S]*?)>>>/i },
    { key: 'Character Dialogue Prompt', regex: /<<<Character Dialogue Prompt:\s*([\s\S]*?)>>>/i },
    { key: 'Context Name', regex: /<<<Context Name:\s*([\s\S]*?)>>>/i },
    { key: 'Context Description', regex: /<<<Context Description:\s*([\s\S]*?)>>>/i },
    { key: 'Context Text Content', regex: /<<<Context Text Content:\s*([\s\S]*?)>>>/i },
    { key: 'Context Regular Expression Activation Trigger', regex: /<<<Context Regular Expression Activation Trigger:\s*([\s\S]*?)>>>/i },
    { key: 'Context Regular Expression Deactivation Trigger', regex: /<<<Context Regular Expression Deactivation Trigger:\s*([\s\S]*?)>>>/i },
    { key: 'Location Name', regex: /<<<Location Name:\s*([\s\S]*?)>>>/i },
    { key: 'Location Description', regex: /<<<Location Description:\s*([\s\S]*?)>>>/i },
    { key: 'Location Text Content', regex: /<<<Location Text Content:\s*([\s\S]*?)>>>/i },
    { key: 'Location Regular Expression Activation Trigger', regex: /<<<Location Regular Expression Activation Trigger:\s*([\s\S]*?)>>>/i },
];

function parseFields(rawText: string): ParsedFields {
    const parsed: ParsedFields = {};
    for (const pattern of FIELD_PATTERNS) {
        const match = rawText.match(pattern.regex);
        if (match && match[1] && match[1].trim().length > 0) {
            parsed[pattern.key] = match[1].trim();
        }
    }
    return parsed;
}

const ENTITY_OPTIONS: { type: EntityType; label: string; icon: string }[] = [
    { type: 'Character', label: 'Character', icon: '🎭' },
    { type: 'Context', label: 'Context', icon: '🌍' },
    { type: 'Location', label: 'Location', icon: '📍' },
];

const recommendationEngine = new LanguageModelEngine();

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
    // ─── Form state ───
    const [selectedEntities, setSelectedEntities] = useState<EntityType[]>(['Character']);
    const [userPrompt, setUserPrompt] = useState('');
    const [error, setError] = useState<string | null>(null);

    const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
    const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
    const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);

    const [charSearch, setCharSearch] = useState('');
    const [ctxSearch, setCtxSearch] = useState('');
    const [locSearch, setLocSearch] = useState('');

    // ─── Result modal state ───
    const [isResultOpen, setIsResultOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [parsedFields, setParsedFields] = useState<ParsedFields>({});
    const [activeTab, setActiveTab] = useState<ViewTab>('raw');
    const [resultError, setResultError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const resetForm = useCallback(() => {
        setError(null);
        setUserPrompt('');
        setSelectedCharacterIds([]);
        setSelectedContextIds([]);
        setSelectedLocationIds([]);
        setCharSearch('');
        setCtxSearch('');
        setLocSearch('');
    }, []);

    const resetResult = useCallback(() => {
        setStreamingText('');
        setParsedFields({});
        setResultError(null);
        setIsGenerating(false);
        setIsSaving(false);
        setActiveTab('raw');
    }, []);

    const handleCloseForm = useCallback(() => {
        if (isGenerating) abortControllerRef.current?.abort();
        resetForm();
        resetResult();
        setIsResultOpen(false);
        onClose();
    }, [isGenerating, resetForm, resetResult, onClose]);

    const handleCloseResult = useCallback(() => {
        if (isGenerating) abortControllerRef.current?.abort();
        resetResult();
        setIsResultOpen(false);
    }, [isGenerating, resetResult]);

    const handleStopGeneration = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setIsGenerating(false);
        if (streamingText.trim()) {
            setParsedFields(parseFields(streamingText));
        }
    }, [streamingText]);

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
        parts.push('Output ONLY the requested fields using the exact format <<<Field Name: content>>>. Do not add any other text, commentary, or markdown.');
        parts.push("You must fill in the names, system prompts and text contents. The rest of the fields are dependent on the user's request and the information given to you.");
        parts.push("References to other characters depends on the user's requests.")
        parts.push("You can use {{user}} to refer to the user. You must use {{char}} instead of the character's name.")
        parts.push('');

        const existingBlock = buildExistingReferenceBlock();
        if (existingBlock) parts.push(existingBlock);

        if (selectedEntities.includes('Character')) {
            parts.push('CHARACTER FIELDS (generate exactly one character):');
            parts.push('<<<Character Name: >>>', '<<<Character Description: >>>', '<<<Character First Message: >>>');
            parts.push('<<<Character System Prompt: >>>', '<<<Character Think Prompt: >>>');
            parts.push('<<<Character Appearance Prompt: >>>', '<<<Character Dialogue Prompt: >>>', '');
        }
        if (selectedEntities.includes('Context')) {
            parts.push('CONTEXT FIELDS (generate exactly one context):');
            parts.push('<<<Context Name: >>>', '<<<Context Description: >>>', '<<<Context Text Content: >>>');
            parts.push('<<<Context Regular Expression Activation Trigger: >>>', '<<<Context Regular Expression Deactivation Trigger: >>>', '');
        }
        if (selectedEntities.includes('Location')) {
            parts.push('LOCATION FIELDS (generate exactly one location):');
            parts.push('<<<Location Name: >>>', '<<<Location Description: >>>', '<<<Location Text Content: >>>');
            parts.push('<<<Location Regular Expression Activation Trigger: >>>', '');
        }

        return parts.join('\n');
    };

    const handleGenerate = async () => {
        if (selectedEntities.length === 0) { setError('Select at least one entity type to generate.'); return; }
        if (!selectedModel) { setError('No model selected. Open Models to load one first.'); return; }

        const port = selectedModel.id ? runningModels[selectedModel.id]?.port : undefined;
        const effectivePort = port || (selectedModel.parameters as any)?._runtimePort;
        if (!effectivePort && !selectedModel.apiKey) { setError('Selected model is not loaded and has no API key.'); return; }

        // Open result modal and start generating
        setError(null);
        resetResult();
        setIsResultOpen(true);
        setIsGenerating(true);

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
                modelPath: selectedModel.model || (selectedModel as any).modelPath || (selectedModel.parameters as any)?.modelPath,
                runtimePort: effectivePort,
            };

            const requestBody = {
                prompt: fullPrompt,
                n_predict: 4096,
                temperature: 0.9,
                top_p: 0.95,
                stream: true,
            };

            let accumulated = '';

            const result = await recommendationEngine.generateStream(
                requestBody,
                ctrl,
                {
                    onToken: (stats) => {
                        accumulated = stats.fullText;
                        setStreamingText(stats.fullText);
                        setParsedFields(parseFields(stats.fullText));
                    },
                },
                modelContext,
                0,
                undefined,
            );

            const finalText = result.text || accumulated;
            setStreamingText(finalText);
            setParsedFields(parseFields(finalText));

            if (!finalText.trim()) {
                setResultError('AI returned empty response.');
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setResultError(`Generation failed: ${(err as Error).message}`);
            }
        } finally {
            setIsGenerating(false);
            abortControllerRef.current = null;
        }
    };

    const handleSave = async () => {
        const fields = parsedFields;
        if (Object.keys(fields).length === 0) { setResultError('No parsed fields to save.'); return; }

        setIsSaving(true);
        setResultError(null);

        const now = Date.now();

        try {
            if (fields['Character Name']) {
                const traitText = `${fields['Character Name'] || ''} ${fields['Character Description'] || ''} ${fields['Character System Prompt'] || ''}`;
                const char: Character = {
                    id: uuidv4(), name: fields['Character Name'], description: fields['Character Description'] || '',
                    systemPrompt: fields['Character System Prompt'] || '', thinkPrompt: fields['Character Think Prompt'] || undefined,
                    appearancePrompt: fields['Character Appearance Prompt'] || undefined, dialoguePrompt: fields['Character Dialogue Prompt'] || undefined,
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
            if (fields['Context Name']) {
                const ctx: Context = {
                    id: uuidv4(), name: fields['Context Name'], description: fields['Context Description'] || undefined,
                    text: fields['Context Text Content'] || '',
                    regularExpressionActivationTrigger: fields['Context Regular Expression Activation Trigger'] || undefined,
                    regularExpressionDeactivationTrigger: fields['Context Regular Expression Deactivation Trigger'] || undefined,
                    useBase64Encoding: false, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveContext(ctx)) throw new Error('Failed to save context.');
            }
            if (fields['Location Name']) {
                const loc: Location = {
                    id: uuidv4(), name: fields['Location Name'], description: fields['Location Description'] || undefined,
                    text: fields['Location Text Content'] || '',
                    regularExpressionActivationTrigger: fields['Location Regular Expression Activation Trigger'] || undefined,
                    characterBindings: [], locationBindings: [], globalWeight: 1, characterWeights: {},
                    useBase64Encoding: false, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveLocation(loc)) throw new Error('Failed to save location.');
            }
            // Close result modal, keep form open
            resetResult();
            setIsResultOpen(false);
        } catch (err) {
            setResultError((err as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const hasCharacterFields = Object.keys(parsedFields).some(k => k.startsWith('Character'));
    const hasContextFields = Object.keys(parsedFields).some(k => k.startsWith('Context'));
    const hasLocationFields = Object.keys(parsedFields).some(k => k.startsWith('Location'));
    const hasAnyParsed = hasCharacterFields || hasContextFields || hasLocationFields;
    const hasOutput = streamingText.trim().length > 0;

    const availableTabs: ViewTab[] = ['raw'];
    if (hasCharacterFields) availableTabs.push('Character');
    if (hasContextFields) availableTabs.push('Context');
    if (hasLocationFields) availableTabs.push('Location');

    const effectiveTab = availableTabs.includes(activeTab) ? activeTab : 'raw';

    return (
        <>
            {/* ─── FORM MODAL ─── */}
            <div className="modal-overlay" onClick={handleCloseForm}>
                <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>Get AI Recommendation</h2>
                        <div className="editor-modal-actions">
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleCloseForm} disabled={isGenerating}>
                                Cancel
                            </button>
                        </div>
                    </div>

                    <div className="modal-body editor-modal-body">
                        <div className="editor-section">
                            <span className="editor-section-title">Generate</span>
                            <div className="entity-type-buttons">
                                {ENTITY_OPTIONS.map(opt => {
                                    const isSelected = selectedEntities.includes(opt.type);
                                    return (
                                        <button key={opt.type} type="button" onClick={() => toggleEntity(opt.type)}
                                            className={`editor-btn ${isSelected ? 'editor-btn-save' : 'editor-btn-cancel'} entity-type-btn`}>
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
                            <span className="editor-section-title">Reference (Optional)</span>
                            <div className="entity-ref-hint">
                                Select and order existing entities so the AI generates consistent content. Click to add/remove. First selected = highest priority.
                            </div>
                            <EntitySelectList label="Characters" items={allCharacters} selectedIds={selectedCharacterIds}
                                onToggle={(id) => toggleInOrderedList(selectedCharacterIds, setSelectedCharacterIds, id)}
                                searchQuery={charSearch} onSearchChange={setCharSearch} />
                            <EntitySelectList label="Contexts" items={allContexts} selectedIds={selectedContextIds}
                                onToggle={(id) => toggleInOrderedList(selectedContextIds, setSelectedContextIds, id)}
                                searchQuery={ctxSearch} onSearchChange={setCtxSearch} />
                            <EntitySelectList label="Locations" items={allLocations} selectedIds={selectedLocationIds}
                                onToggle={(id) => toggleInOrderedList(selectedLocationIds, setSelectedLocationIds, id)}
                                searchQuery={locSearch} onSearchChange={setLocSearch} />
                            {allCharacters.length === 0 && allContexts.length === 0 && allLocations.length === 0 && (
                                <div className="entity-ref-empty">No existing entities available to reference.</div>
                            )}
                        </div>

                        <div className="editor-section">
                            <label className="editor-label">Describe what you want <span className="optional-label">(optional)</span></label>
                            <textarea value={userPrompt} onChange={e => setUserPrompt(e.target.value)} className="editor-textarea"
                                placeholder="Leave empty to let the AI generate freely based on referenced entities..." rows={3} />
                        </div>

                        <button type="button" className="editor-btn editor-btn-save entity-generate-btn"
                            onClick={handleGenerate} disabled={selectedEntities.length === 0}>
                            ✨ Generate Recommendation
                        </button>

                        {error && <div className="editor-error-message editor-error-centered entity-error-below">{error}</div>}
                    </div>
                </div>
            </div>

            {/* ─── RESULT MODAL (stacked on top of form) ─── */}
            {isResultOpen && (
                <div className="modal-overlay" style={{ zIndex: 1001 }} onClick={handleCloseResult}>
                    <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Recommendation Result</h2>
                            <div className="editor-modal-actions">
                                <button type="button" className="editor-btn editor-btn-cancel" onClick={handleCloseResult} disabled={isGenerating || isSaving}>
                                    {hasOutput ? 'Back to Form' : 'Cancel'}
                                </button>
                            </div>
                        </div>

                        <div className="modal-body editor-modal-body">
                            {/* Tab buttons */}
                            {hasAnyParsed && (
                                <div className="entity-tab-bar">
                                    {availableTabs.map(tab => (
                                        <button
                                            key={tab}
                                            type="button"
                                            className={`entity-tab-btn ${effectiveTab === tab ? 'entity-tab-btn-active' : ''}`}
                                            onClick={() => setActiveTab(tab)}
                                        >
                                            {tab === 'raw' ? '📄 Raw' : tab === 'Character' ? '🎭 Character' : tab === 'Context' ? '🌍 Context' : '📍 Location'}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Raw text view */}
                            {effectiveTab === 'raw' && (
                                <div className="entity-raw-output">
                                    <pre className="entity-raw-pre">{streamingText || (isGenerating ? '⏳ Waiting for response...' : '')}</pre>
                                </div>
                            )}

                            {/* Character tab */}
                            {effectiveTab === 'Character' && hasCharacterFields && (
                                <div className="entity-field-list">
                                    {parsedFields['Character Name'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Name</div>
                                            <div className="entity-field-content">{parsedFields['Character Name']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Character Description'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Description</div>
                                            <div className="entity-field-content">{parsedFields['Character Description']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Character First Message'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">First Message</div>
                                            <div className="entity-field-content">{parsedFields['Character First Message']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Character System Prompt'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">System Prompt</div>
                                            <div className="entity-field-content">{parsedFields['Character System Prompt']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Character Think Prompt'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Think Prompt</div>
                                            <div className="entity-field-content">{parsedFields['Character Think Prompt']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Character Appearance Prompt'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Appearance</div>
                                            <div className="entity-field-content">{parsedFields['Character Appearance Prompt']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Character Dialogue Prompt'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Dialogue Examples</div>
                                            <div className="entity-field-content">{parsedFields['Character Dialogue Prompt']}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Context tab */}
                            {effectiveTab === 'Context' && hasContextFields && (
                                <div className="entity-field-list">
                                    {parsedFields['Context Name'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Name</div>
                                            <div className="entity-field-content">{parsedFields['Context Name']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Context Description'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Description</div>
                                            <div className="entity-field-content">{parsedFields['Context Description']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Context Text Content'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Content</div>
                                            <div className="entity-field-content">{parsedFields['Context Text Content']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Context Regular Expression Activation Trigger'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Activation Trigger</div>
                                            <div className="entity-field-content entity-field-mono">{parsedFields['Context Regular Expression Activation Trigger']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Context Regular Expression Deactivation Trigger'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Deactivation Trigger</div>
                                            <div className="entity-field-content entity-field-mono">{parsedFields['Context Regular Expression Deactivation Trigger']}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Location tab */}
                            {effectiveTab === 'Location' && hasLocationFields && (
                                <div className="entity-field-list">
                                    {parsedFields['Location Name'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Name</div>
                                            <div className="entity-field-content">{parsedFields['Location Name']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Location Description'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Description</div>
                                            <div className="entity-field-content">{parsedFields['Location Description']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Location Text Content'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Content</div>
                                            <div className="entity-field-content">{parsedFields['Location Text Content']}</div>
                                        </div>
                                    )}
                                    {parsedFields['Location Regular Expression Activation Trigger'] && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Activation Trigger</div>
                                            <div className="entity-field-content entity-field-mono">{parsedFields['Location Regular Expression Activation Trigger']}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Action bar */}
                            <div className="entity-action-buttons">
                                {isGenerating ? (
                                    <button type="button" className="editor-btn editor-btn-cancel" onClick={handleStopGeneration} style={{ flex: 1 }}>
                                        ⏹ Stop Generation
                                    </button>
                                ) : (
                                    <>
                                        <button type="button" className="editor-btn editor-btn-cancel" onClick={() => { resetResult(); }} disabled={isSaving} style={{ flex: 1 }}>
                                            Regenerate
                                        </button>
                                        {hasAnyParsed && (
                                            <button type="button" className="editor-btn editor-btn-save" onClick={handleSave} disabled={isSaving} style={{ flex: 1 }}>
                                                {isSaving ? 'Saving...' : '💾 Save All'}
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>

                            {resultError && <div className="editor-error-message editor-error-centered entity-error-below">{resultError}</div>}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}