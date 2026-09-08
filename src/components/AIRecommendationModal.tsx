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

interface GeneratedCharacter {
    name: string;
    description?: string;
    firstMessage?: string;
    systemPrompt?: string;
    thinkPrompt?: string;
    appearancePrompt?: string;
    dialoguePrompt?: string;
}

interface GeneratedContext {
    name: string;
    description?: string;
    textContent: string;
    activationTrigger?: string;
    deactivationTrigger?: string;
}

interface GeneratedLocation {
    name: string;
    description?: string;
    textContent: string;
    activationTrigger?: string;
}

interface GeneratedOutput {
    character?: GeneratedCharacter;
    context?: GeneratedContext;
    location?: GeneratedLocation;
}

const ENTITY_OPTIONS: { type: EntityType; label: string; icon: string }[] = [
    { type: 'Character', label: 'Character', icon: '🎭' },
    { type: 'Context', label: 'Context', icon: '📜' },
    { type: 'Location', label: 'Location', icon: '📍' },
];

const recommendationEngine = new LanguageModelEngine();

function buildJsonSchema(selectedEntities: EntityType[]): string {
    const parts: string[] = [];
    if (selectedEntities.includes('Character')) {
        parts.push(`  "character": {
    "name": "string (required)",
    "description": "string",
    "firstMessage": "string",
    "systemPrompt": "string",
    "thinkPrompt": "string (optional)",
    "appearancePrompt": "string (optional)",
    "dialoguePrompt": "string (optional)"
  }`);
    }
    if (selectedEntities.includes('Context')) {
        parts.push(`  "context": {
    "name": "string (required)",
    "description": "string",
    "textContent": "string (required)",
    "activationTrigger": "string (regex pattern, optional)",
    "deactivationTrigger": "string (regex pattern, optional)"
  }`);
    }
    if (selectedEntities.includes('Location')) {
        parts.push(`  "location": {
    "name": "string (required)",
    "description": "string",
    "textContent": "string (required)",
    "activationTrigger": "string (regex pattern, optional)"
  }`);
    }
    return `{\n${parts.join(',\n')}\n}`;
}

function tryParseGeneratedOutput(text: string): GeneratedOutput | null {
    // Try to extract JSON from the response (LLMs sometimes wrap it in markdown code blocks)
    let jsonStr = text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    try {
        const parsed = JSON.parse(jsonStr);
        if (!parsed || typeof parsed !== 'object') return null;

        const result: GeneratedOutput = {};

        if (parsed.character && typeof parsed.character === 'object' && parsed.character.name) {
            result.character = {
                name: String(parsed.character.name),
                description: parsed.character.description ? String(parsed.character.description) : undefined,
                firstMessage: parsed.character.firstMessage ? String(parsed.character.firstMessage) : undefined,
                systemPrompt: parsed.character.systemPrompt ? String(parsed.character.systemPrompt) : undefined,
                thinkPrompt: parsed.character.thinkPrompt ? String(parsed.character.thinkPrompt) : undefined,
                appearancePrompt: parsed.character.appearancePrompt ? String(parsed.character.appearancePrompt) : undefined,
                dialoguePrompt: parsed.character.dialoguePrompt ? String(parsed.character.dialoguePrompt) : undefined,
            };
        }

        if (parsed.context && typeof parsed.context === 'object' && parsed.context.name && parsed.context.textContent) {
            result.context = {
                name: String(parsed.context.name),
                description: parsed.context.description ? String(parsed.context.description) : undefined,
                textContent: String(parsed.context.textContent),
                activationTrigger: parsed.context.activationTrigger ? String(parsed.context.activationTrigger) : undefined,
                deactivationTrigger: parsed.context.deactivationTrigger ? String(parsed.context.deactivationTrigger) : undefined,
            };
        }

        if (parsed.location && typeof parsed.location === 'object' && parsed.location.name && parsed.location.textContent) {
            result.location = {
                name: String(parsed.location.name),
                description: parsed.location.description ? String(parsed.location.description) : undefined,
                textContent: String(parsed.location.textContent),
                activationTrigger: parsed.location.activationTrigger ? String(parsed.location.activationTrigger) : undefined,
            };
        }

        if (!result.character && !result.context && !result.location) return null;
        return result;
    } catch {
        return null;
    }
}

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

    // ─── Reference images ───
    const [referenceImages, setReferenceImages] = useState<File[]>([]);
    const [referenceImagePreviews, setReferenceImagePreviews] = useState<string[]>([]);
    const [isUploadingImages, setIsUploadingImages] = useState(false);
    const imageInputRef = useRef<HTMLInputElement>(null);

    // ─── Result modal state ───
    const [isResultOpen, setIsResultOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [parsedOutput, setParsedOutput] = useState<GeneratedOutput | null>(null);
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
        setReferenceImages([]);
        setReferenceImagePreviews(prev => {
            prev.forEach(p => { if (!p.startsWith('data:image')) URL.revokeObjectURL(p); });
            return [];
        });
    }, []);

    const resetResult = useCallback(() => {
        setStreamingText('');
        setParsedOutput(null);
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
            const parsed = tryParseGeneratedOutput(streamingText);
            setParsedOutput(parsed);
            if (!parsed) setResultError('Stopped generation. Output was not valid JSON.');
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

    const handleReferenceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            const files = Array.from(e.target.files);
            setReferenceImages(prev => [...prev, ...files]);
            const newPreviews = files.map(file => URL.createObjectURL(file));
            setReferenceImagePreviews(prev => [...prev, ...newPreviews]);
        }
        e.target.value = '';
    };

    const handleRemoveReferenceImage = (index: number) => {
        setReferenceImages(prev => prev.filter((_, i) => i !== index));
        if (!referenceImagePreviews[index].startsWith('data:image')) {
            URL.revokeObjectURL(referenceImagePreviews[index]);
        }
        setReferenceImagePreviews(prev => prev.filter((_, i) => i !== index));
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
        parts.push('You are a creative writing assistant for roleplay. Generate exactly ONE of each requested entity type.');
        parts.push('You MUST output ONLY valid JSON matching the schema below. No markdown, no commentary, no explanation, no code fences.');
        parts.push('Use {{user}} to refer to the user. Use {{char}} instead of the character\'s name in prompts and messages.');
        parts.push('');

        const existingBlock = buildExistingReferenceBlock();
        if (existingBlock) parts.push(existingBlock);

        parts.push('OUTPUT JSON SCHEMA:');
        parts.push(buildJsonSchema(selectedEntities));
        parts.push('');
        parts.push('Fill all required fields. Omit optional fields if not applicable. Regex triggers should be valid JavaScript RegExp patterns without delimiters or flags.');

        return parts.join('\n');
    };

    const handleGenerate = async () => {
        if (selectedEntities.length === 0) { setError('Select at least one entity type to generate.'); return; }
        if (!selectedModel) { setError('No model selected. Open Models to load one first.'); return; }

        const port = selectedModel.id ? runningModels[selectedModel.id]?.port : undefined;
        const runtimePort = (selectedModel.parameters && typeof selectedModel.parameters === 'object' && '_runtimePort' in selectedModel.parameters) ? (selectedModel.parameters as Record<string, number>)._runtimePort : undefined;
        const effectivePort = port || runtimePort;
        if (!effectivePort && !selectedModel.apiKey) { setError('Selected model is not loaded and has no API key.'); return; }

        // Process reference images into prompt descriptions
        let imageDescriptions = '';
        if (referenceImages.length > 0) {
            setIsUploadingImages(true);
            try {
                const descriptions: string[] = [];
                for (let i = 0; i < referenceImages.length; i++) {
                    const file = referenceImages[i];
                    descriptions.push(`[Reference Image ${i + 1}: ${file.name} — use as visual reference when generating content]`);
                }
                imageDescriptions = `\nREFERENCE IMAGES:\n${descriptions.join('\n')}\nUse these images as visual reference when generating content.\n`;
            } catch (e) {
                setError('Failed to process reference images.');
                setIsUploadingImages(false);
                return;
            }
            setIsUploadingImages(false);
        }

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
                : '\n\nUser Request: Generate freely based on the existing entities and schema provided above.';
            const fullPrompt = `${systemPrompt}${userRequestPart}${imageDescriptions}`;

            const modelContext = {
                apiKey: selectedModel.apiKey,
                backend: selectedModel.backend,
                modelPath: (selectedModel.model || selectedModel.parameters?.modelPath) as string | undefined,
                runtimePort: effectivePort,
            };

            const requestBody = {
                prompt: fullPrompt,
                n_predict: 4096,
                temperature: 0.7,
                top_p: 0.9,
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
                        // Try parsing incrementally for live preview
                        const parsed = tryParseGeneratedOutput(stats.fullText);
                        if (parsed) setParsedOutput(parsed);
                    },
                },
                modelContext,
                0,
                undefined,
            );

            const finalText = result.text || accumulated;
            setStreamingText(finalText);

            const parsed = tryParseGeneratedOutput(finalText);
            setParsedOutput(parsed);

            if (!parsed) {
                setResultError('AI response was not valid JSON. Try regenerating.');
            } else if (!finalText.trim()) {
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
        if (!parsedOutput) { setResultError('No parsed output to save.'); return; }

        setIsSaving(true);
        setResultError(null);

        const now = Date.now();

        try {
            if (parsedOutput.character) {
                const c = parsedOutput.character;
                const traitText = `${c.name || ''} ${c.description || ''} ${c.systemPrompt || ''}`;
                const char: Character = {
                    id: uuidv4(), name: c.name, description: c.description || '',
                    systemPrompt: c.systemPrompt || '', thinkPrompt: c.thinkPrompt || undefined,
                    appearancePrompt: c.appearancePrompt || undefined, dialoguePrompt: c.dialoguePrompt || undefined,
                    images: {}, sampler: allSamplers.length > 0 ? allSamplers[0] : undefined,
                    initiativeWeight: getInitiativeWeightValueFromText(traitText), chatProbability: getChatProbabilityValue(traitText),
                    maximumChatStamina: Math.round(getMaximumChatStaminaValueFromText(traitText)),
                    nameSensitivity: getNameSensitivityValueFromText(traitText), skipProbability: getSkipProbabilityValueFromText(traitText),
                    chatImpatienceSensitivity: getChatImpatienceSensitivityValueFromText(traitText),
                    memoryRetentionWeight: getMemoryRetentionWeightValueFromText(traitText),
                    contextSensitivity: getContextSensitivityValueFromText(traitText),
                    enableWebSearch: false, enableCalculator: false,
                    enableMemoryWriting: false, enableMemoryReading: false, memories: {},
                    numberOfMessagesToDisableThinkPrompt: 0, numberOfMessagesToDisableMetaThinkInstructions: 0,
                    numberOfMessagesToDisableDialoguePrompt: 0, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveCharacter(char)) throw new Error('Failed to save character.');
            }
            if (parsedOutput.context) {
                const c = parsedOutput.context;
                const ctx: Context = {
                    id: uuidv4(), name: c.name, description: c.description || undefined,
                    text: c.textContent,
                    regularExpressionActivationTrigger: c.activationTrigger || undefined,
                    regularExpressionDeactivationTrigger: c.deactivationTrigger || undefined,
                    limitLinksToSubdirectory: false,
                    useBase64Encoding: false, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveContext(ctx)) throw new Error('Failed to save context.');
            }
            if (parsedOutput.location) {
                const l = parsedOutput.location;
                const loc: Location = {
                    id: uuidv4(), name: l.name, description: l.description || undefined,
                    text: l.textContent,
                    regularExpressionActivationTrigger: l.activationTrigger || undefined,
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

    const hasCharacter = !!parsedOutput?.character;
    const hasContext = !!parsedOutput?.context;
    const hasLocation = !!parsedOutput?.location;
    const hasAnyParsed = hasCharacter || hasContext || hasLocation;
    const hasOutput = streamingText.trim().length > 0;

    const availableTabs: ViewTab[] = ['raw'];
    if (hasCharacter) availableTabs.push('Character');
    if (hasContext) availableTabs.push('Context');
    if (hasLocation) availableTabs.push('Location');

    const effectiveTab = availableTabs.includes(activeTab) ? activeTab : 'raw';

    return (
        <>
            {/* ─── FORM MODAL ─── */}
            <div className="modal-overlay" onClick={handleCloseForm}>
                <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>Get AI Recommendation</h2>
                        <div className="editor-modal-actions">
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleCloseForm} disabled={isGenerating || isUploadingImages}>
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

                        <div className="editor-section">
                            <span className="editor-section-title">Reference Images <span className="optional-label">(optional)</span></span>
                            <div className="entity-ref-hint">
                                Upload images for the AI to use as visual reference when generating entities.
                            </div>
                            <div className="editor-image-grid">
                                {referenceImagePreviews.map((preview, index) => (
                                    <div key={preview} className="editor-image-square active">
                                        <img src={preview} alt={`Reference ${index + 1}`} />
                                        <button type="button" onClick={() => handleRemoveReferenceImage(index)} className="editor-image-remove-btn">×</button>
                                    </div>
                                ))}
                                <div className={`editor-image-square editor-upload-square ${isUploadingImages ? 'disabled' : ''}`} onClick={() => !isUploadingImages && imageInputRef.current?.click()}>
                                    <div className="context-image-placeholder">
                                        <div className="context-image-placeholder-icon">{isUploadingImages ? '⏳' : '📷'}</div>
                                        <div className="context-image-placeholder-text">{isUploadingImages ? 'Processing...' : 'Upload'}</div>
                                    </div>
                                </div>
                            </div>
                            <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={handleReferenceImageChange} disabled={isUploadingImages} />
                        </div>

                        <button type="button" className="editor-btn editor-btn-save entity-generate-btn"
                            onClick={handleGenerate} disabled={selectedEntities.length === 0 || isUploadingImages}>
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
                                            {tab === 'raw' ? '📄 Raw JSON' : tab === 'Character' ? '🎭 Character' : tab === 'Context' ? '📜 Context' : '📍 Location'}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Raw JSON view */}
                            {effectiveTab === 'raw' && (
                                <div className="entity-raw-output">
                                    <pre className="entity-raw-pre">{streamingText || (isGenerating ? '⏳ Waiting for response...' : '')}</pre>
                                </div>
                            )}

                            {/* Character tab */}
                            {effectiveTab === 'Character' && parsedOutput?.character && (
                                <div className="entity-field-list">
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Name</div>
                                        <div className="entity-field-content">{parsedOutput.character.name}</div>
                                    </div>
                                    {parsedOutput.character.description && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Description</div>
                                            <div className="entity-field-content">{parsedOutput.character.description}</div>
                                        </div>
                                    )}
                                    {parsedOutput.character.firstMessage && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">First Message</div>
                                            <div className="entity-field-content">{parsedOutput.character.firstMessage}</div>
                                        </div>
                                    )}
                                    {parsedOutput.character.systemPrompt && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">System Prompt</div>
                                            <div className="entity-field-content">{parsedOutput.character.systemPrompt}</div>
                                        </div>
                                    )}
                                    {parsedOutput.character.thinkPrompt && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Think Prompt</div>
                                            <div className="entity-field-content">{parsedOutput.character.thinkPrompt}</div>
                                        </div>
                                    )}
                                    {parsedOutput.character.appearancePrompt && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Appearance</div>
                                            <div className="entity-field-content">{parsedOutput.character.appearancePrompt}</div>
                                        </div>
                                    )}
                                    {parsedOutput.character.dialoguePrompt && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Dialogue Examples</div>
                                            <div className="entity-field-content">{parsedOutput.character.dialoguePrompt}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Context tab */}
                            {effectiveTab === 'Context' && parsedOutput?.context && (
                                <div className="entity-field-list">
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Name</div>
                                        <div className="entity-field-content">{parsedOutput.context.name}</div>
                                    </div>
                                    {parsedOutput.context.description && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Description</div>
                                            <div className="entity-field-content">{parsedOutput.context.description}</div>
                                        </div>
                                    )}
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Content</div>
                                        <div className="entity-field-content">{parsedOutput.context.textContent}</div>
                                    </div>
                                    {parsedOutput.context.activationTrigger && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Activation Trigger</div>
                                            <div className="entity-field-content entity-field-mono">{parsedOutput.context.activationTrigger}</div>
                                        </div>
                                    )}
                                    {parsedOutput.context.deactivationTrigger && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Deactivation Trigger</div>
                                            <div className="entity-field-content entity-field-mono">{parsedOutput.context.deactivationTrigger}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Location tab */}
                            {effectiveTab === 'Location' && parsedOutput?.location && (
                                <div className="entity-field-list">
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Name</div>
                                        <div className="entity-field-content">{parsedOutput.location.name}</div>
                                    </div>
                                    {parsedOutput.location.description && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Description</div>
                                            <div className="entity-field-content">{parsedOutput.location.description}</div>
                                        </div>
                                    )}
                                    <div className="entity-field-block">
                                        <div className="entity-field-title">Content</div>
                                        <div className="entity-field-content">{parsedOutput.location.textContent}</div>
                                    </div>
                                    {parsedOutput.location.activationTrigger && (
                                        <div className="entity-field-block">
                                            <div className="entity-field-title">Activation Trigger</div>
                                            <div className="entity-field-content entity-field-mono">{parsedOutput.location.activationTrigger}</div>
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