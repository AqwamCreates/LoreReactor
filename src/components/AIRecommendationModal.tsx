// src/components/AIRecommendationModal.tsx
import type React from 'react';
import { useState, useRef, useCallback } from 'react';
import type { Character, Context, Location, AudioTrack, Sampler, LanguageModel, Profile, World, PromptBlock } from '../types';
import { EntitySelectList } from './EntitySelectList';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { v4 as uuidv4 } from 'uuid';
import type { EntityType, ViewTab, ImagePriorityItem, GeneratedOutput, JsonHistoryEntry } from '../services/aiRecommendationTypes';
import { IMAGE_PRIORITY_ITEMS, IMAGE_LABELS, IMAGE_SHORT_LABELS, IMAGE_PROMPT_DESCRIPTIONS, ENTITY_OPTIONS } from '../services/aiRecommendationTypes';
import { buildJsonSchema } from '../services/aiRecommendationSchema';
import { tryParseGeneratedOutput, deriveHistoryLabel, resolveWorldCrossReferences } from '../services/aiRecommendationConverters';
import './main.css';

const recommendationEngine = getLanguageModelEngine();

interface AIRecommendationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaveCharacter: (char: Character) => Promise<boolean>;
    onSaveContext: (ctx: Context) => Promise<boolean>;
    onSaveLocation: (loc: Location) => Promise<boolean>;
    onSaveAudioTrack: (track: AudioTrack) => Promise<boolean>;
    onSaveProfile: (profile: Profile) => Promise<boolean>;
    onSaveWorld: (world: World) => Promise<boolean>;
    onSavePromptBlock: (block: PromptBlock) => Promise<boolean>;
    onOpenCharacterEditor?: (char: Character | null, onApplyToRecommendation: (c: Character) => void) => void;
    onOpenContextEditor?: (ctx: Context | null, onApplyToRecommendation: (c: Context) => void) => void;
    onOpenLocationEditor?: (loc: Location | null, onApplyToRecommendation: (l: Location) => void) => void;
    onOpenAudioTrackEditor?: (track: AudioTrack | null, onApplyToRecommendation: (t: AudioTrack) => void) => void;
    onOpenProfileEditor?: (profile: Profile | null, onApplyToRecommendation: (p: Profile) => void) => void;
    onOpenPromptBlockEditor?: (block: PromptBlock | null, onApplyToRecommendation: (b: PromptBlock) => void) => void;
    allSamplers: Sampler[];
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allPromptBlocks: PromptBlock[];
    selectedModel: LanguageModel | null;
    runningModels: Record<string, { isRunning?: boolean; port?: number }>;
}

export function AIRecommendationModal({
    isOpen, onClose, onSaveCharacter, onSaveContext, onSaveLocation, onSaveAudioTrack, onSaveProfile, onSaveWorld, onSavePromptBlock,
    onOpenCharacterEditor, onOpenContextEditor, onOpenLocationEditor, onOpenAudioTrackEditor, onOpenProfileEditor, onOpenPromptBlockEditor,
    allSamplers, allCharacters, allContexts, allLocations, allAudioTracks, allPromptBlocks, selectedModel, runningModels,
}: AIRecommendationModalProps) {
    const [selectedEntities, setSelectedEntities] = useState<EntityType[]>(['Character']);
    const [userPrompt, setUserPrompt] = useState('');
    const [maxTokens, setMaxTokens] = useState(2048);
    const [error, setError] = useState<string | null>(null);
    const [showSchemaPreview, setShowSchemaPreview] = useState(false);
    const [schemaCopied, setSchemaCopied] = useState(false);
    const [imageInjectionPriority, setImageInjectionPriority] = useState<ImagePriorityItem[]>(['reference', 'character', 'context', 'location']);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [jsonHistory, setJsonHistory] = useState<JsonHistoryEntry[]>([]);
    const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
    const [editingJsonText, setEditingJsonText] = useState('');
    const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
    const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
    const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
    const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
    const [selectedAudioTrackIds, setSelectedAudioTrackIds] = useState<string[]>([]);
    const [selectedPromptBlockIds, setSelectedPromptBlockIds] = useState<string[]>([]);
    const [charSearch, setCharSearch] = useState('');
    const [ctxSearch, setCtxSearch] = useState('');
    const [locSearch, setLocSearch] = useState('');
    const [audioSearch, setAudioSearch] = useState('');
    const [promptBlockSearch, setPromptBlockSearch] = useState('');
    const [referenceImages, setReferenceImages] = useState<File[]>([]);
    const [referenceImagePreviews, setReferenceImagePreviews] = useState<string[]>([]);
    const [isUploadingImages, setIsUploadingImages] = useState(false);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const [isResultOpen, setIsResultOpen] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [parsedOutput, setParsedOutput] = useState<GeneratedOutput | null>(null);
    const [activeTab, setActiveTab] = useState<ViewTab>('raw');
    const [resultError, setResultError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const injectCharacterImages = imageInjectionPriority.includes('character');
    const injectContextImages = imageInjectionPriority.includes('context');
    const injectLocationImages = imageInjectionPriority.includes('location');

    const resetForm = useCallback(() => {
        setError(null); setUserPrompt(''); setMaxTokens(2048);
        setShowSchemaPreview(false); setSchemaCopied(false);
        setImageInjectionPriority(['reference', 'character', 'context', 'location']);
        setDragIndex(null); setDragOverIndex(null);
        setJsonHistory([]); setEditingHistoryId(null); setEditingJsonText(''); setExpandedHistoryId(null);
        setSelectedCharacterIds([]); setSelectedContextIds([]); setSelectedLocationIds([]); setSelectedAudioTrackIds([]); setSelectedPromptBlockIds([]);
        setCharSearch(''); setCtxSearch(''); setLocSearch(''); setAudioSearch(''); setPromptBlockSearch('');
        setReferenceImages([]);
        setReferenceImagePreviews(prev => { prev.forEach(p => { if (!p.startsWith('data:image')) URL.revokeObjectURL(p); }); return []; });
    }, []);

    const resetResult = useCallback(() => {
        setStreamingText(''); setParsedOutput(null); setResultError(null);
        setIsGenerating(false); setIsSaving(false); setActiveTab('raw');
    }, []);

    const handleCloseForm = useCallback(() => {
        if (isGenerating) abortControllerRef.current?.abort();
        resetForm(); resetResult(); setIsResultOpen(false); onClose();
    }, [isGenerating, resetForm, resetResult, onClose]);

    const handleCloseResult = useCallback(() => {
        if (isGenerating) abortControllerRef.current?.abort();
        resetResult(); setIsResultOpen(false);
    }, [isGenerating, resetResult]);

    const handleStopGeneration = useCallback(() => {
        abortControllerRef.current?.abort(); abortControllerRef.current = null;
        setIsGenerating(false);
        if (streamingText.trim()) {
            const p = tryParseGeneratedOutput(streamingText, allSamplers);
            setParsedOutput(p);
            if (!p) setResultError('Stopped. Output was not valid JSON.');
        }
    }, [streamingText, allSamplers]);

    const toggleEntity = (type: EntityType) => setSelectedEntities(prev => prev.includes(type) ? prev.filter(e => e !== type) : [...prev, type]);
    const toggleInOrderedList = (_ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    const toggleImagePriorityItem = (item: ImagePriorityItem) => setImageInjectionPriority(prev => prev.includes(item) ? prev.filter(x => x !== item) : [...prev, item]);
    const handleDragStart = (i: number) => setDragIndex(i);
    const handleDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) setDragOverIndex(i); };
    const handleDrop = (i: number) => { if (dragIndex === null || dragIndex === i) { setDragIndex(null); setDragOverIndex(null); return; } setImageInjectionPriority(prev => { const n = [...prev]; const [m] = n.splice(dragIndex, 1); n.splice(i, 0, m); return n; }); setDragIndex(null); setDragOverIndex(null); };
    const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null); };

    const handleReferenceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) { const f = Array.from(e.target.files); setReferenceImages(prev => [...prev, ...f]); setReferenceImagePreviews(prev => [...prev, ...f.map(x => URL.createObjectURL(x))]); } e.target.value = ''; };
    const handleRemoveReferenceImage = (i: number) => { setReferenceImages(prev => prev.filter((_, j) => j !== i)); if (!referenceImagePreviews[i].startsWith('data:image')) URL.revokeObjectURL(referenceImagePreviews[i]); setReferenceImagePreviews(prev => prev.filter((_, j) => j !== i)); };

    const handleCopySchema = useCallback(() => {
        navigator.clipboard.writeText(buildJsonSchema(selectedEntities)).then(() => { setSchemaCopied(true); setTimeout(() => setSchemaCopied(false), 2000); }).catch(() => setError('Failed to copy.'));
    }, [selectedEntities]);

    const addToHistory = useCallback((jsonText: string, parsed: GeneratedOutput, isEdited = false) => {
        setJsonHistory(prev => [{ id: uuidv4(), timestamp: Date.now(), jsonText, parsedOutput: parsed, label: deriveHistoryLabel(parsed), isEdited }, ...prev]);
    }, []);

    const deleteHistoryEntry = useCallback((id: string) => { setJsonHistory(prev => prev.filter(e => e.id !== id)); if (editingHistoryId === id) { setEditingHistoryId(null); setEditingJsonText(''); } if (expandedHistoryId === id) setExpandedHistoryId(null); }, [editingHistoryId, expandedHistoryId]);
    const startEditingHistory = useCallback((entry: JsonHistoryEntry) => { setEditingHistoryId(entry.id); setEditingJsonText(entry.jsonText); setExpandedHistoryId(entry.id); }, []);
    const saveHistoryEdit = useCallback(() => {
        if (!editingHistoryId) return;
        const p = tryParseGeneratedOutput(editingJsonText, allSamplers);
        if (!p) { setError('Edited JSON is not valid.'); return; }
        setJsonHistory(prev => prev.map(e => e.id === editingHistoryId ? { ...e, jsonText: editingJsonText, parsedOutput: p, label: deriveHistoryLabel(p), isEdited: true } : e));
        setEditingHistoryId(null); setEditingJsonText(''); setError(null);
    }, [editingHistoryId, editingJsonText, allSamplers]);
    const cancelHistoryEdit = useCallback(() => { setEditingHistoryId(null); setEditingJsonText(''); }, []);
    const loadHistoryToResult = useCallback((entry: JsonHistoryEntry) => { setStreamingText(entry.jsonText); setParsedOutput(entry.parsedOutput); setResultError(null); setIsResultOpen(true); setActiveTab('raw'); }, []);
    const refineFromHistory = useCallback((entry: JsonHistoryEntry) => { setUserPrompt(prev => { const b = prev.trim(); const r = `\n\nREFINE THIS EXISTING OUTPUT:\n${entry.jsonText}`; return b ? `${b}${r}` : `Refine and improve this JSON output.${r}`; }); setError(null); }, []);

    const buildExistingReferenceBlock = (): string => {
        const parts: string[] = [];
        if (selectedCharacterIds.length > 0) { parts.push('EXISTING CHARACTERS:'); selectedCharacterIds.forEach((id, i) => { const c = allCharacters.find(ch => ch.id === id); if (c) parts.push(`${i + 1}. ID: ${c.id} | Name: ${c.name}${c.description ? ` | ${c.description.substring(0, 200)}` : ''}`); }); parts.push(''); }
        if (selectedContextIds.length > 0) { parts.push('EXISTING CONTEXTS:'); selectedContextIds.forEach((id, i) => { const c = allContexts.find(x => x.id === id); if (c) parts.push(`${i + 1}. ID: ${c.id} | Name: ${c.name}${c.text ? ` | ${c.text.substring(0, 200)}` : ''}`); }); parts.push(''); }
        if (selectedLocationIds.length > 0) { parts.push('EXISTING LOCATIONS:'); selectedLocationIds.forEach((id, i) => { const l = allLocations.find(x => x.id === id); if (l) parts.push(`${i + 1}. ID: ${l.id} | Name: ${l.name}${l.text ? ` | ${l.text.substring(0, 200)}` : ''}`); }); parts.push(''); }
        if (selectedAudioTrackIds.length > 0) { parts.push('EXISTING AUDIO TRACKS:'); selectedAudioTrackIds.forEach((id, i) => { const t = allAudioTracks.find(x => x.id === id); if (t) parts.push(`${i + 1}. ID: ${t.id} | Name: ${t.name} | File: ${t.filename} | Category: ${t.audioCategory}`); }); parts.push(''); }
        if (selectedPromptBlockIds.length > 0) { parts.push('EXISTING PROMPT BLOCKS:'); selectedPromptBlockIds.forEach((id, i) => { const b = allPromptBlocks.find(x => x.id === id); if (b) parts.push(`${i + 1}. ID: ${b.id} | Name: ${b.name}${b.textContent ? ` | ${b.textContent.substring(0, 200)}` : ''}`); }); parts.push(''); }
        return parts.join('\n');
    };

    const buildSystemPrompt = (): string => {
        const parts: string[] = [];
        const hasWorld = selectedEntities.includes('World');
        parts.push('You are a creative writing assistant for roleplay. Generate entities matching the schema below.');
        parts.push('You MUST output ONLY valid JSON matching the schema below. No markdown, no commentary, no code fences.');
        parts.push('Use {{user}} to refer to the user. Use {{char}} instead of character names in prompts.');
        parts.push('The "description" field is for UI display only. It is NOT injected into prompts or used as AI input. Write it as a short human-readable summary.');
        parts.push('Generate a valid UUID v4 for every "id" field.');
        parts.push('Do not make references to the existing entities at all costs and at all times unless stated otherwise.');
        if (hasWorld) {
            parts.push('For World generation: use EITHER entity names OR entity IDs in bindings. Existing IDs are in references above. New entities use names for cross-reference within the world.');
            parts.push('Generate ALL sub-entities INSIDE the "world" object. Also generate them at the top level if their entity type is selected.');
        }
        parts.push('');
        const eb = buildExistingReferenceBlock(); if (eb) parts.push(eb);
        parts.push('OUTPUT JSON SCHEMA:', buildJsonSchema(selectedEntities), '');
        parts.push('Fill all required fields. Omit optional fields if not applicable.');
        return parts.join('\n');
    };

    const handleGenerate = async () => {
        if (selectedEntities.length === 0) { setError('Select at least one entity type.'); return; }
        if (!selectedModel) { setError('No model selected.'); return; }
        const port = selectedModel.id ? runningModels[selectedModel.id]?.port : undefined;
        const rp = (selectedModel.parameters && typeof selectedModel.parameters === 'object' && '_runtimePort' in selectedModel.parameters) ? (selectedModel.parameters as Record<string, number>)._runtimePort : undefined;
        const ep = port || rp;
        if (!ep && !selectedModel.apiKey) { setError('Model not loaded and has no API key.'); return; }

        let imgDesc = '';
        if (referenceImages.length > 0) { setIsUploadingImages(true); imgDesc = `\nREFERENCE IMAGES:\n${referenceImages.map((f, i) => `[Image ${i + 1}: ${f.name}]`).join('\n')}\n`; setIsUploadingImages(false); }

        const injNotes: string[] = [];
        if (imageInjectionPriority.length > 0) { injNotes.push('IMAGE INJECTION PRIORITY:'); imageInjectionPriority.forEach((item, i) => injNotes.push(`${i + 1}. ${IMAGE_PROMPT_DESCRIPTIONS[item]}`)); const dis = IMAGE_PRIORITY_ITEMS.filter(x => !imageInjectionPriority.includes(x)); if (dis.length > 0) injNotes.push(`DISABLED: ${dis.map(d => IMAGE_PROMPT_DESCRIPTIONS[d]).join(', ')}`); } else { injNotes.push('ALL IMAGE TYPES DISABLED.'); }
        const injBlock = injNotes.length > 0 ? `\n${injNotes.join('\n')}\n` : '';

        setError(null); resetResult(); setIsResultOpen(true); setIsGenerating(true);
        const ctrl = new AbortController(); abortControllerRef.current = ctrl;
        try {
            const sp = buildSystemPrompt();
            const urp = userPrompt.trim() ? `\n\nUser Request: ${userPrompt.trim()}` : '\n\nUser Request: Generate freely.';
            const fp = `${sp}${urp}${imgDesc}${injBlock}`;
            const mc = { apiKey: selectedModel.apiKey, backend: selectedModel.backend, modelPath: (selectedModel.model || selectedModel.parameters?.modelPath) as string | undefined, runtimePort: ep };
            let acc = '';
            const res = await recommendationEngine.generateStream({ prompt: fp, n_predict: maxTokens, temperature: 0.7, top_p: 0.9, stream: true }, ctrl, { onToken: (s) => { acc = s.fullText; setStreamingText(s.fullText); const p = tryParseGeneratedOutput(s.fullText, allSamplers); if (p) setParsedOutput(p); } }, mc, 0, undefined);
            const ft = res.text || acc; setStreamingText(ft);
            const parsed = tryParseGeneratedOutput(ft, allSamplers); setParsedOutput(parsed);
            if (!parsed) setResultError('AI response was not valid JSON.');
            else if (!ft.trim()) setResultError('AI returned empty response.');
            else addToHistory(ft, parsed, false);
        } catch (err) { if ((err as Error).name !== 'AbortError') setResultError(`Generation failed: ${(err as Error).message}`); }
        finally { setIsGenerating(false); abortControllerRef.current = null; }
    };

    const handleSave = async () => {
        if (!parsedOutput) { setResultError('No parsed output to save.'); return; }
        setIsSaving(true); setResultError(null); const now = Date.now();
        try {
            if (parsedOutput.characters) {
                for (const char of parsedOutput.characters) {
                    if (!injectCharacterImages) char.doNotInjectCharacterImage = true;
                    if (!await onSaveCharacter(char)) throw new Error(`Failed to save character "${char.name}".`);
                }
            }
            if (parsedOutput.contexts) {
                for (const ctx of parsedOutput.contexts) {
                    if (!injectContextImages) ctx.includeLinkImages = false;
                    if (!await onSaveContext(ctx)) throw new Error(`Failed to save context "${ctx.name}".`);
                }
            }
            if (parsedOutput.locations) {
                for (const loc of parsedOutput.locations) {
                    if (!injectLocationImages) loc.images = [];
                    if (!await onSaveLocation(loc)) throw new Error(`Failed to save location "${loc.name}".`);
                }
            }
            if (parsedOutput.audioTracks) {
                for (const track of parsedOutput.audioTracks) {
                    if (!await onSaveAudioTrack(track)) throw new Error(`Failed to save audio track "${track.name}".`);
                }
            }
            if (parsedOutput.promptBlocks) {
                for (const block of parsedOutput.promptBlocks) {
                    if (!await onSavePromptBlock(block)) throw new Error(`Failed to save prompt block "${block.name}".`);
                }
            }
            if (parsedOutput.profile) {
                if (!injectCharacterImages) parsedOutput.profile.forceNoCharacterImageInjection = true;
                if (!injectContextImages) parsedOutput.profile.forceNoContextImageInjection = true;
                if (!await onSaveProfile(parsedOutput.profile)) throw new Error(`Failed to save profile "${parsedOutput.profile.name}".`);
            }
            if (parsedOutput.world) {
                const resolved = resolveWorldCrossReferences(parsedOutput.world, injectLocationImages, allAudioTracks);
                if (!injectCharacterImages) for (const c of resolved.characters) c.doNotInjectCharacterImage = true;
                if (resolved.profile) {
                    if (!injectCharacterImages) resolved.profile.forceNoCharacterImageInjection = true;
                    if (!injectContextImages) resolved.profile.forceNoContextImageInjection = true;
                }
                for (const ch of resolved.characters) if (!await onSaveCharacter(ch)) throw new Error(`Failed to save "${ch.name}".`);
                for (const cx of resolved.contexts) if (!await onSaveContext(cx)) throw new Error(`Failed to save "${cx.name}".`);
                for (const lo of resolved.locations) if (!await onSaveLocation(lo)) throw new Error(`Failed to save "${lo.name}".`);
                for (const at of resolved.audioTracks) {
                    if (!await onSaveAudioTrack(at)) throw new Error(`Failed to save audio track "${at.name}".`);
                }
                for (const pb of resolved.promptBlocks) {
                    if (!await onSavePromptBlock(pb)) throw new Error(`Failed to save prompt block "${pb.name}".`);
                }
                if (resolved.profile && !await onSaveProfile(resolved.profile)) throw new Error(`Failed to save "${resolved.profile.name}".`);
                const world: World = {
                    id: uuidv4(), name: parsedOutput.world.name, description: parsedOutput.world.description || undefined,
                    characterIds: resolved.characters.map(c => c.id), contextIds: resolved.contexts.map(c => c.id),
                    locationIds: resolved.locations.map(l => l.id), audioTrackIds: resolved.audioTracks.map(t => t.id),
                    profileId: resolved.profile?.id, firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                };
                if (!await onSaveWorld(world)) throw new Error('Failed to save world.');
            }
            resetResult(); setIsResultOpen(false);
        } catch (err) { setResultError((err as Error).message); } finally { setIsSaving(false); }
    };

    if (!isOpen) return null;

    const hasChars = (parsedOutput?.characters?.length ?? 0) > 0;
    const hasCtxs = (parsedOutput?.contexts?.length ?? 0) > 0;
    const hasLocs = (parsedOutput?.locations?.length ?? 0) > 0;
    const hasTracks = (parsedOutput?.audioTracks?.length ?? 0) > 0;
    const hasProf = !!parsedOutput?.profile;
    const hasBlocks = (parsedOutput?.promptBlocks?.length ?? 0) > 0;
    const hasWorld = !!parsedOutput?.world;
    const hasAnyParsed = hasChars || hasCtxs || hasLocs || hasTracks || hasProf || hasBlocks || hasWorld;
    const hasOutput = streamingText.trim().length > 0;
    const availableTabs: ViewTab[] = ['raw'];
    if (hasChars) availableTabs.push('Character');
    if (hasCtxs) availableTabs.push('Context');
    if (hasLocs) availableTabs.push('Location');
    if (hasTracks) availableTabs.push('AudioTrack');
    if (hasProf) availableTabs.push('Profile');
    if (hasBlocks) availableTabs.push('PromptBlock');
    if (hasWorld) availableTabs.push('World');
    const effectiveTab = availableTabs.includes(activeTab) ? activeTab : 'raw';
    const disabledImageItems = IMAGE_PRIORITY_ITEMS.filter(item => !imageInjectionPriority.includes(item));

    const renderFieldList = (entries: [string, unknown][], excludeKeys: string[] = []) => entries.filter(([k, v]) => v !== undefined && v !== null && !excludeKeys.includes(k)).map(([key, val]) => (
        <div key={key} className="entity-field-block">
            <div className="entity-field-title">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</div>
            <div className="entity-field-content">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</div>
        </div>
    ));

    const renderSummary = (desc?: string) => desc ? (
        <div className="entity-field-block" style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '10px', marginBottom: '12px' }}>
            <div className="entity-field-title" style={{ opacity: 0.6, fontSize: '0.65rem' }}>AI SUMMARY (display only)</div>
            <div className="entity-field-content" style={{ fontStyle: 'italic', opacity: 0.9 }}>{desc}</div>
        </div>
    ) : null;

    const editBtnStyle = { fontSize: '0.7rem', padding: '4px 14px', minHeight: '28px' };
    const worldEditBtnStyle = { fontSize: '0.65rem', padding: '3px 10px', minHeight: '24px', justifyContent: 'flex-start' as const };

    return (
        <>
            {/* FORM MODAL */}
            <div className="modal-overlay" onClick={handleCloseForm}>
                <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header"><h2>Get AI Recommendation</h2><div className="editor-modal-actions"><button type="button" className="editor-btn editor-btn-cancel" onClick={handleCloseForm} disabled={isGenerating || isUploadingImages}>Cancel</button></div></div>
                    <div className="modal-body editor-modal-body">
                        <div className="editor-section">
                            <span className="editor-section-title">Generate</span>
                            <div className="entity-type-buttons">{ENTITY_OPTIONS.map(opt => (<button key={opt.type} type="button" onClick={() => toggleEntity(opt.type)} className={`editor-btn ${selectedEntities.includes(opt.type) ? 'editor-btn-save' : 'editor-btn-cancel'} entity-type-btn`}>{opt.icon} {opt.label}</button>))}</div>
                            <div className="entity-type-hint">Select entity types. Co-selected types with World generate inside the world.</div>
                            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}><button type="button" className={`editor-btn ${showSchemaPreview ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setShowSchemaPreview(!showSchemaPreview)} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>{showSchemaPreview ? '🔽 Hide JSON Schema' : '📋 Show JSON Schema'}</button></div>
                            {showSchemaPreview && <div style={{ marginTop: '8px' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}><span style={{ fontSize: '0.6rem', opacity: 0.6 }}>Copy schema for external AI tools</span><button type="button" className="editor-btn editor-btn-cancel" onClick={handleCopySchema} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px' }}>{schemaCopied ? '✅ Copied!' : '📋 Copy'}</button></div><pre style={{ background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px', fontSize: '0.65rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '300px', overflowY: 'auto', color: 'var(--text-h)', margin: 0 }}>{buildJsonSchema(selectedEntities)}</pre></div>}
                        </div>
                        <div className="editor-section"><span className="editor-section-title">Reference Existing Entities (Optional)</span><div className="entity-ref-hint">Select existing entities for consistency.</div><EntitySelectList label="Characters" items={allCharacters} selectedIds={selectedCharacterIds} onToggle={(id) => toggleInOrderedList(selectedCharacterIds, setSelectedCharacterIds, id)} searchQuery={charSearch} onSearchChange={setCharSearch} /><EntitySelectList label="Contexts" items={allContexts} selectedIds={selectedContextIds} onToggle={(id) => toggleInOrderedList(selectedContextIds, setSelectedContextIds, id)} searchQuery={ctxSearch} onSearchChange={setCtxSearch} /><EntitySelectList label="Locations" items={allLocations} selectedIds={selectedLocationIds} onToggle={(id) => toggleInOrderedList(selectedLocationIds, setSelectedLocationIds, id)} searchQuery={locSearch} onSearchChange={setLocSearch} /><EntitySelectList label="Audio Tracks" items={allAudioTracks} selectedIds={selectedAudioTrackIds} onToggle={(id) => toggleInOrderedList(selectedAudioTrackIds, setSelectedAudioTrackIds, id)} searchQuery={audioSearch} onSearchChange={setAudioSearch} /><EntitySelectList label="Prompt Blocks" items={allPromptBlocks} selectedIds={selectedPromptBlockIds} onToggle={(id) => toggleInOrderedList(selectedPromptBlockIds, setSelectedPromptBlockIds, id)} searchQuery={promptBlockSearch} onSearchChange={setPromptBlockSearch} /></div>
                        <div className="editor-section"><label className="editor-label">Describe what you want <span className="optional-label">(optional)</span></label><textarea value={userPrompt} onChange={e => setUserPrompt(e.target.value)} className="editor-textarea" placeholder={selectedEntities.includes('World') ? "e.g., A haunted Victorian mansion with 5 NPCs..." : "Leave empty for free generation..."} rows={3} /></div>
                        <div className="editor-section"><span className="editor-section-title">Reference Images <span className="optional-label">(optional)</span></span><div className="entity-ref-hint">Upload images as visual reference.</div><div className="editor-image-grid">{referenceImagePreviews.map((p, i) => (<div key={p} className="editor-image-square active"><img src={p} alt={`Ref ${i + 1}`} /><button type="button" onClick={() => handleRemoveReferenceImage(i)} className="editor-image-remove-btn">×</button></div>))}<div className={`editor-image-square editor-upload-square ${isUploadingImages ? 'disabled' : ''}`} onClick={() => !isUploadingImages && imageInputRef.current?.click()}><div className="context-image-placeholder"><div className="context-image-placeholder-icon">{isUploadingImages ? '⏳' : '📷'}</div><div className="context-image-placeholder-text">{isUploadingImages ? 'Processing...' : 'Upload'}</div></div></div></div><input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={handleReferenceImageChange} disabled={isUploadingImages} /></div>
                        <div className="editor-section"><span className="editor-section-title">Image Injection Priority</span><div className="entity-ref-hint">Drag to reorder. × to disable.</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>{imageInjectionPriority.map((item, index) => (<div key={item} draggable onDragStart={() => handleDragStart(index)} onDragOver={(e) => handleDragOver(e, index)} onDrop={() => handleDrop(index)} onDragEnd={handleDragEnd} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', background: dragIndex === index ? 'var(--accent-dim, rgba(255,255,255,0.05))' : 'var(--social-bg)', border: dragOverIndex === index ? '2px dashed var(--accent)' : '1px solid var(--border)', borderRadius: '4px', fontSize: '0.75rem', cursor: 'grab', opacity: dragIndex === index ? 0.5 : 1, transition: 'border 0.15s, background 0.15s, opacity 0.15s', userSelect: 'none' }}><span style={{ opacity: 0.3, fontSize: '0.8rem', minWidth: '16px', textAlign: 'center' }}>☰</span><span style={{ opacity: 0.5, minWidth: '16px', textAlign: 'center' }}>{index + 1}</span><span style={{ flex: 1 }}>{IMAGE_LABELS[item]}</span><button type="button" onClick={() => toggleImagePriorityItem(item)} className="context-character-binding-remove" title="Remove">×</button></div>))}</div>{disabledImageItems.length > 0 && <div style={{ marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>{disabledImageItems.map(item => (<button key={item} type="button" onClick={() => toggleImagePriorityItem(item)} className="editor-btn editor-btn-cancel" style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px', opacity: 0.6 }}>+ {IMAGE_SHORT_LABELS[item]}</button>))}</div>}</div>
                        {jsonHistory.length > 0 && <div className="editor-section"><span className="editor-section-title">Generated Output History ({jsonHistory.length})</span><div className="entity-ref-hint">Previous generations. Edit, refine, or preview.</div><div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto' }}>{jsonHistory.map(entry => { const isEditing = editingHistoryId === entry.id; const isExpanded = expandedHistoryId === entry.id; return (<div key={entry.id} style={{ border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--social-bg)', overflow: 'hidden' }}><div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', cursor: 'pointer', background: isExpanded ? 'var(--accent-dim, rgba(255,255,255,0.03))' : undefined }} onClick={() => setExpandedHistoryId(isExpanded ? null : entry.id)}><span style={{ fontSize: '0.7rem', opacity: 0.5 }}>{isExpanded ? '▼' : '▶'}</span><span style={{ flex: 1, fontSize: '0.75rem', fontWeight: 600 }}>{entry.label}</span>{entry.isEdited && <span style={{ fontSize: '0.55rem', background: '#f59e0b', color: '#000', padding: '1px 4px', borderRadius: '3px' }}>Edited</span>}<span style={{ fontSize: '0.6rem', opacity: 0.4 }}>{new Date(entry.timestamp).toLocaleTimeString()}</span></div>{isExpanded && <div style={{ padding: '0 8px 8px' }}>{isEditing ? <><textarea value={editingJsonText} onChange={e => setEditingJsonText(e.target.value)} className="editor-textarea" style={{ fontFamily: 'monospace', fontSize: '0.65rem', minHeight: '120px', maxHeight: '300px' }} rows={8} /><div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}><button type="button" className="editor-btn editor-btn-save" onClick={saveHistoryEdit} style={{ fontSize: '0.65rem', padding: '3px 10px', minHeight: '24px' }}>✅ Save</button><button type="button" className="editor-btn editor-btn-cancel" onClick={cancelHistoryEdit} style={{ fontSize: '0.65rem', padding: '3px 10px', minHeight: '24px' }}>Cancel</button></div></> : <><pre style={{ background: 'var(--bg, #000)', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px', fontSize: '0.6rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '200px', overflowY: 'auto', color: 'var(--text-h)', margin: '4px 0' }}>{entry.jsonText.length > 2000 ? entry.jsonText.substring(0, 2000) + '\n...(truncated)' : entry.jsonText}</pre><div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}><button type="button" className="editor-btn editor-btn-cancel" onClick={() => startEditingHistory(entry)} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px' }}>✏️ Edit</button><button type="button" className="editor-btn editor-btn-save" onClick={() => refineFromHistory(entry)} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px' }}>🔄 Refine</button><button type="button" className="editor-btn editor-btn-cancel" onClick={() => loadHistoryToResult(entry)} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px' }}>👁️ Preview</button><button type="button" className="editor-btn editor-btn-cancel" onClick={() => deleteHistoryEntry(entry.id)} style={{ fontSize: '0.6rem', padding: '2px 8px', minHeight: '22px', color: '#ef4444' }}>🗑️</button></div></>}</div>}</div>); })}</div></div>}
                        <div className="editor-section"><label className="editor-label editor-label-small">Max Tokens</label><input type="number" className="editor-input context-input-small" min={256} max={16384} step={256} value={maxTokens} onChange={e => setMaxTokens(Math.max(256, Math.min(16384, Number(e.target.value) || 2048)))} /><div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Default: 2048. Range: 256–16384.</div></div>
                        <button type="button" className="editor-btn editor-btn-save entity-generate-btn" onClick={handleGenerate} disabled={selectedEntities.length === 0 || isUploadingImages}>✨ Generate Recommendation</button>
                        {error && <div className="editor-error-message editor-error-centered entity-error-below">{error}</div>}
                    </div>
                </div>
            </div>

            {/* RESULT MODAL */}
            {isResultOpen && (
                <div className="modal-overlay" onClick={handleCloseResult}>
                    <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h2>Recommendation Result</h2><div className="editor-modal-actions"><button type="button" className="editor-btn editor-btn-cancel" onClick={handleCloseResult} disabled={isGenerating || isSaving}>{hasOutput ? 'Back to Form' : 'Cancel'}</button></div></div>
                        <div className="modal-body editor-modal-body">
                            {hasAnyParsed && <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                                {hasChars && <button type="button" className={`editor-btn ${activeTab === 'Character' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('Character')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>🎭 Characters ({parsedOutput!.characters!.length})</button>}
                                {hasCtxs && <button type="button" className={`editor-btn ${activeTab === 'Context' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('Context')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>📜 Contexts ({parsedOutput!.contexts!.length})</button>}
                                {hasLocs && <button type="button" className={`editor-btn ${activeTab === 'Location' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('Location')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>📍 Locations ({parsedOutput!.locations!.length})</button>}
                                {hasTracks && <button type="button" className={`editor-btn ${activeTab === 'AudioTrack' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('AudioTrack')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>🔊 Audio Tracks ({parsedOutput!.audioTracks!.length})</button>}
                                {hasProf && <button type="button" className={`editor-btn ${activeTab === 'Profile' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('Profile')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>👤 {parsedOutput!.profile!.name}</button>}
                                {hasBlocks && <button type="button" className={`editor-btn ${activeTab === 'PromptBlock' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('PromptBlock')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>🧱 Prompt Blocks ({parsedOutput!.promptBlocks!.length})</button>}
                                {hasWorld && <button type="button" className={`editor-btn ${activeTab === 'World' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('World')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>🌍 {parsedOutput!.world!.name}</button>}
                                <button type="button" className={`editor-btn ${activeTab === 'raw' ? 'editor-btn-save' : 'editor-btn-cancel'}`} onClick={() => setActiveTab('raw')} style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: '28px' }}>📄 Raw JSON</button>
                            </div>}

                            {effectiveTab === 'raw' && <div className="entity-raw-output"><pre className="entity-raw-pre">{streamingText || (isGenerating ? '⏳ Waiting...' : '')}</pre></div>}

                            {effectiveTab === 'Character' && hasChars && <div className="entity-field-list">
                                {parsedOutput!.characters!.map((char, i) => (
                                    <div key={char.id || i} style={{ marginBottom: '16px', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px' }}>
                                        {renderSummary(char.description)}
                                        {renderFieldList(Object.entries(char).filter(([k]) => k !== 'description' && k !== 'id' && k !== 'memories' && k !== 'sampler' && k !== 'firstCreatedTimestamp' && k !== 'lastUpdatedTimestamp' && k !== 'images'))}
                                        {onOpenCharacterEditor && <div style={{ marginTop: '8px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenCharacterEditor(char, () => {})} style={editBtnStyle}>✏️ Open in Editor</button></div>}
                                    </div>
                                ))}
                            </div>}

                            {effectiveTab === 'Context' && hasCtxs && <div className="entity-field-list">
                                {parsedOutput!.contexts!.map((ctx, i) => (
                                    <div key={ctx.id || i} style={{ marginBottom: '16px', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px' }}>
                                        {renderSummary(ctx.description)}
                                        {renderFieldList(Object.entries(ctx).filter(([k]) => k !== 'description' && k !== 'id' && k !== 'firstCreatedTimestamp' && k !== 'lastUpdatedTimestamp'))}
                                        {onOpenContextEditor && <div style={{ marginTop: '8px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenContextEditor(ctx, () => {})} style={editBtnStyle}>✏️ Open in Editor</button></div>}
                                    </div>
                                ))}
                            </div>}

                            {effectiveTab === 'Location' && hasLocs && <div className="entity-field-list">
                                {parsedOutput!.locations!.map((loc, i) => (
                                    <div key={loc.id || i} style={{ marginBottom: '16px', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px' }}>
                                        {renderSummary(loc.description)}
                                        {renderFieldList(Object.entries(loc).filter(([k]) => k !== 'description' && k !== 'id' && k !== 'firstCreatedTimestamp' && k !== 'lastUpdatedTimestamp'))}
                                        {onOpenLocationEditor && <div style={{ marginTop: '8px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenLocationEditor(loc, () => {})} style={editBtnStyle}>✏️ Open in Editor</button></div>}
                                    </div>
                                ))}
                            </div>}

                            {effectiveTab === 'AudioTrack' && hasTracks && <div className="entity-field-list">
                                {parsedOutput!.audioTracks!.map((track, i) => (
                                    <div key={track.id || i} style={{ marginBottom: '16px', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px' }}>
                                        {renderSummary(track.description)}
                                        {renderFieldList(Object.entries(track).filter(([k]) => k !== 'description' && k !== 'id' && k !== 'firstCreatedTimestamp' && k !== 'lastUpdatedTimestamp'))}
                                        {onOpenAudioTrackEditor && <div style={{ marginTop: '8px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenAudioTrackEditor(track, () => {})} style={editBtnStyle}>✏️ Open in Editor</button></div>}
                                    </div>
                                ))}
                            </div>}

                            {effectiveTab === 'Profile' && hasProf && <div className="entity-field-list">
                                {renderSummary(parsedOutput!.profile!.description)}
                                {renderFieldList(Object.entries(parsedOutput!.profile!).filter(([k]) => k !== 'description' && k !== 'id' && k !== 'firstCreatedTimestamp' && k !== 'lastUpdatedTimestamp'))}
                                {onOpenProfileEditor && <div style={{ marginTop: '12px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenProfileEditor(parsedOutput!.profile!, () => {})} style={editBtnStyle}>✏️ Open in Editor</button></div>}
                            </div>}

                            {effectiveTab === 'PromptBlock' && hasBlocks && <div className="entity-field-list">
                                {parsedOutput!.promptBlocks!.map((block, i) => (
                                    <div key={block.id || i} style={{ marginBottom: '16px', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px' }}>
                                        {renderSummary(block.description)}
                                        {renderFieldList(Object.entries(block).filter(([k]) => k !== 'description' && k !== 'id' && k !== 'firstCreatedTimestamp' && k !== 'lastUpdatedTimestamp'))}
                                        {onOpenPromptBlockEditor && <div style={{ marginTop: '8px', textAlign: 'center' }}><button type="button" className="editor-btn editor-btn-save" onClick={() => onOpenPromptBlockEditor(block, () => {})} style={editBtnStyle}>✏️ Open in Editor</button></div>}
                                    </div>
                                ))}
                            </div>}

                            {effectiveTab === 'World' && hasWorld && <div className="entity-field-list">
                                {renderSummary(parsedOutput!.world!.description)}
                                <div className="entity-field-block"><div className="entity-field-title">Name</div><div className="entity-field-content">{parsedOutput!.world!.name}</div></div>
                                <div className="entity-field-block"><div className="entity-field-title">Characters ({parsedOutput!.world!.characters.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>{parsedOutput!.world!.characters.map((c, i) => <div key={c.id || i} style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem' }}><div style={{ fontWeight: 600 }}>🎭 {c.name}</div>{c.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{c.description.length > 150 ? c.description.substring(0, 150) + '...' : c.description}</div>}</div>)}</div></div>
                                <div className="entity-field-block"><div className="entity-field-title">Contexts ({parsedOutput!.world!.contexts.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>{parsedOutput!.world!.contexts.map((c, i) => <div key={c.id || i} style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem' }}><div style={{ fontWeight: 600 }}>📜 {c.name}</div>{c.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{c.description.length > 150 ? c.description.substring(0, 150) + '...' : c.description}</div>}</div>)}</div></div>
                                <div className="entity-field-block"><div className="entity-field-title">Locations ({parsedOutput!.world!.locations.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>{parsedOutput!.world!.locations.map((l, i) => <div key={l.id || i} style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem' }}><div style={{ fontWeight: 600 }}>📍 {l.name}</div>{l.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{l.description.length > 150 ? l.description.substring(0, 150) + '...' : l.description}</div>}</div>)}</div></div>
                                {(parsedOutput!.world!.audioTracks?.length ?? 0) > 0 && <div className="entity-field-block"><div className="entity-field-title">Audio Tracks ({parsedOutput!.world!.audioTracks!.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>{parsedOutput!.world!.audioTracks!.map((t, i) => <div key={t.id || i} style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem' }}><div style={{ fontWeight: 600 }}>🔊 {t.name}</div>{t.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{t.description.length > 150 ? t.description.substring(0, 150) + '...' : t.description}</div>}<div style={{ opacity: 0.5, fontSize: '0.6rem', marginTop: '1px' }}>{t.audioCategory || 'ambient'} • {t.filename}</div></div>)}</div></div>}
                                {(parsedOutput!.world!.promptBlocks?.length ?? 0) > 0 && <div className="entity-field-block"><div className="entity-field-title">Prompt Blocks ({parsedOutput!.world!.promptBlocks!.length})</div><div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>{parsedOutput!.world!.promptBlocks!.map((b, i) => <div key={b.id || i} style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem' }}><div style={{ fontWeight: 600 }}>🧱 {b.name}</div>{b.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{b.description.length > 150 ? b.description.substring(0, 150) + '...' : b.description}</div>}</div>)}</div></div>}
                                {parsedOutput!.world!.profile && <div className="entity-field-block"><div className="entity-field-title">Profile</div><div style={{ padding: '4px 8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.7rem', marginTop: '4px' }}><div style={{ fontWeight: 600 }}>👤 {parsedOutput!.world!.profile.name}</div>{parsedOutput!.world!.profile.description && <div style={{ opacity: 0.7, fontStyle: 'italic', marginTop: '2px', fontSize: '0.65rem' }}>{parsedOutput!.world!.profile.description.length > 150 ? parsedOutput!.world!.profile.description.substring(0, 150) + '...' : parsedOutput!.world!.profile.description}</div>}</div></div>}
                                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {onOpenCharacterEditor && parsedOutput!.world!.characters.map((c, i) => <button key={c.id || `wc-${i}`} type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenCharacterEditor(c, () => {})} style={worldEditBtnStyle}>✏️ Edit 🎭 {c.name}</button>)}
                                    {onOpenContextEditor && parsedOutput!.world!.contexts.map((c, i) => <button key={c.id || `wx-${i}`} type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenContextEditor(c, () => {})} style={worldEditBtnStyle}>✏️ Edit 📜 {c.name}</button>)}
                                    {onOpenLocationEditor && parsedOutput!.world!.locations.map((l, i) => <button key={l.id || `wl-${i}`} type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenLocationEditor(l, () => {})} style={worldEditBtnStyle}>✏️ Edit 📍 {l.name}</button>)}
                                    {onOpenAudioTrackEditor && parsedOutput!.world!.audioTracks?.map((t, i) => <button key={t.id || `wt-${i}`} type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenAudioTrackEditor(t, () => {})} style={worldEditBtnStyle}>✏️ Edit 🔊 {t.name}</button>)}
                                    {onOpenPromptBlockEditor && parsedOutput!.world!.promptBlocks?.map((b, i) => <button key={b.id || `wb-${i}`} type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenPromptBlockEditor(b, () => {})} style={worldEditBtnStyle}>✏️ Edit 🧱 {b.name}</button>)}
                                    {onOpenProfileEditor && parsedOutput!.world!.profile && <button type="button" className="editor-btn editor-btn-cancel" onClick={() => onOpenProfileEditor(parsedOutput!.world!.profile!, () => {})} style={worldEditBtnStyle}>✏️ Edit 👤 {parsedOutput!.world!.profile.name}</button>}
                                </div>
                            </div>}

                            <div className="entity-action-buttons">{isGenerating ? <button type="button" className="editor-btn editor-btn-cancel" onClick={handleStopGeneration} style={{ flex: 1 }}>⏹ Stop</button> : <><button type="button" className="editor-btn editor-btn-cancel" onClick={resetResult} disabled={isSaving} style={{ flex: 1 }}>Regenerate</button>{hasAnyParsed && <button type="button" className="editor-btn editor-btn-save" onClick={handleSave} disabled={isSaving} style={{ flex: 1 }}>{isSaving ? 'Saving...' : hasWorld ? '💾 Save World + All' : '💾 Save All'}</button>}</>}</div>
                            {resultError && <div className="editor-error-message editor-error-centered entity-error-below">{resultError}</div>}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}