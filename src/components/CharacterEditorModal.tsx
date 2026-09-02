// src/components/CharacterEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Character, Sampler, LanguageModel } from '../types';
import { LanguageModelEngine } from '../services/LanguageModelEngine';
import type { LanguageModelContext } from '../services/LanguageModelEngine';
import { uploadCharacterImage, uploadCharacterVoice } from '../hooks/storage';
import { getInitiativeWeightValueFromText, getChatProbabilityValue, getMaximumChatStaminaValueFromText } from '../hooks/chatTraitsDetection';
import { parseCharacterCard, mapCardToEditorFields } from '../services/characterCardParser';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

const DEFAULT_INITIATIVE_WEIGHT_VALUE = 1.2;
const DEFAULT_CHAT_PROBABILITY_VALUE = 0.5;
const DEFAULT_MAXIMUM_CHAT_STAMINA_VALUE = 4;
const MAX_VOICE_FILE_SIZE = 5 * 1024 * 1024;

const tokenEngine = new LanguageModelEngine();

interface TokenCounts {
    systemPrompt: number | null;
    thinkPrompt: number | null;
    appearancePrompt: number | null;
    dialoguePrompt: number | null;
}

interface CharacterEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (character: Character) => void;
    existingCharacter?: Character | null;
    allSamplers: Sampler[];
    isLoadingSamplers?: boolean;
    selectedModel?: LanguageModel | null;
    runningModels?: Record<string, any>;
}

export function CharacterEditorModal({ 
    isOpen, onClose, onSave, existingCharacter, 
    allSamplers, isLoadingSamplers = false,
    selectedModel, runningModels
}: CharacterEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [systemPrompt, setSystemPrompt] = useState('');
    const [thinkPrompt, setThinkPrompt] = useState('');
    const [appearancePrompt, setAppearancePrompt] = useState('');
    const [dialoguePrompt, setDialoguePrompt] = useState('');
    const [firstMessage, setFirstMessage] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [selectedSamplerId, setSelectedSamplerId] = useState<string>('');
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [initiativeWeightStr, setInitiativeWeightStr] = useState<string>('-1');
    const [chatProbabilityStr, setChatProbabilityStr] = useState<string>('-1');
    const [maximumChatStaminaStr, setMaximumChatStaminaStr] = useState<string>('-1');
    const [voiceFile, setVoiceFile] = useState<File | null>(null);
    const [voiceName, setVoiceName] = useState<string>('');
    const [existingVoiceName, setExistingVoiceName] = useState<string>('');
    const [doNotInjectCharacterImage, setDoNotInjectCharacterImage] = useState<boolean>(false);
    const [autoDetected, setAutoDetected] = useState<{ iw: number | null; cp: number | null; ms: number | null }>({
        iw: null, cp: null, ms: null,
    });
    const [tokenCounts, setTokenCounts] = useState<TokenCounts>({
        systemPrompt: null, thinkPrompt: null, appearancePrompt: null, dialoguePrompt: null,
    });
    const [countingField, setCountingField] = useState<keyof TokenCounts | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const cardImportRef = useRef<HTMLInputElement>(null);
    const voiceInputRef = useRef<HTMLInputElement>(null);
    const tokenCountTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const getModelContext = useCallback((): LanguageModelContext | undefined => {
        if (!selectedModel) return undefined;
        const runtimePort = selectedModel.id && runningModels?.[selectedModel.id]?.port;
        return {
            apiKey: selectedModel.apiKey,
            backend: selectedModel.backend,
            modelPath: (selectedModel as any).modelPath || (selectedModel as any).parameters?.modelPath,
            runtimePort,
        };
    }, [selectedModel, runningModels]);

    const countFieldTokens = useCallback(async (field: keyof TokenCounts, text: string) => {
        if (!text.trim()) {
            setTokenCounts(prev => ({ ...prev, [field]: 0 }));
            return;
        }
        if (tokenCountTimeoutsRef.current[field]) clearTimeout(tokenCountTimeoutsRef.current[field]);
        tokenCountTimeoutsRef.current[field] = setTimeout(async () => {
            setCountingField(field);
            try {
                const ctx = getModelContext();
                const count = await tokenEngine.countTokens(text, ctx);
                setTokenCounts(prev => ({ ...prev, [field]: count }));
            } catch {
                setTokenCounts(prev => ({ ...prev, [field]: Math.ceil(text.length / 4) }));
            } finally {
                setCountingField(prev => prev === field ? null : prev);
            }
        }, 500);
    }, [getModelContext]);

    useEffect(() => {
        return () => { Object.values(tokenCountTimeoutsRef.current).forEach(clearTimeout); };
    }, []);

    useEffect(() => {
        if (isOpen) {
            setSubmitError(null);
            setAutoDetected({ iw: null, cp: null, ms: null });
            if (existingCharacter) {
                setName(existingCharacter.name || '');
                setDescription(existingCharacter.description || '');
                setSystemPrompt(existingCharacter.systemPrompt || '');
                setThinkPrompt(existingCharacter.thinkPrompt || '');
                setAppearancePrompt(existingCharacter.appearancePrompt || '');
                setDialoguePrompt(existingCharacter.dialoguePrompt || '');
                setFirstMessage('');
                setImagePreview(existingCharacter.image ? `/user_data/character_images/${existingCharacter.image}` : null);
                setImageFile(null);
                setSelectedSamplerId(existingCharacter.sampler?.id || (allSamplers[0]?.id || ''));
                setSelectedStopPatternIds(existingCharacter.sampler?.stopPatterns.map(sp => sp.id) || []);
                setInitiativeWeightStr(String(existingCharacter.initiativeWeight ?? -1));
                setChatProbabilityStr(String(existingCharacter.chatProbability ?? -1));
                setMaximumChatStaminaStr(String(existingCharacter.maximumChatStamina ?? -1));
                setExistingVoiceName(existingCharacter.voice || '');
                setVoiceName(existingCharacter.voice || '');
                setVoiceFile(null);
                setDoNotInjectCharacterImage(existingCharacter.doNotInjectCharacterImage ?? false);
                countFieldTokens('systemPrompt', existingCharacter.systemPrompt || '');
                countFieldTokens('thinkPrompt', existingCharacter.thinkPrompt || '');
                countFieldTokens('appearancePrompt', existingCharacter.appearancePrompt || '');
                countFieldTokens('dialoguePrompt', existingCharacter.dialoguePrompt || '');
            } else {
                setName(''); setDescription(''); setSystemPrompt(''); setThinkPrompt('');
                setAppearancePrompt(''); setDialoguePrompt(''); setFirstMessage('');
                setImageFile(null); setImagePreview(null);
                setSelectedSamplerId(allSamplers[0]?.id || '');
                setSelectedStopPatternIds([]);
                setInitiativeWeightStr('-1'); setChatProbabilityStr('-1'); setMaximumChatStaminaStr('-1');
                setExistingVoiceName(''); setVoiceName(''); setVoiceFile(null);
                setDoNotInjectCharacterImage(false);
                setTokenCounts({ systemPrompt: 0, thinkPrompt: 0, appearancePrompt: 0, dialoguePrompt: 0 });
            }
        }
    }, [isOpen, existingCharacter, allSamplers, countFieldTokens]);

    const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
    const normalizeStatValue = (raw: string, fieldMax: number): string => {
        const val = Number.parseFloat(raw);
        if (Number.isNaN(val) || val < 0) return '-1';
        return String(clamp(val, 0, fieldMax));
    };

    const handleSystemPromptBlur = () => {
        const currentIW = Number.parseFloat(initiativeWeightStr);
        const currentCP = Number.parseFloat(chatProbabilityStr);
        const currentMS = Number.parseFloat(maximumChatStaminaStr);
        if (currentIW !== -1 && currentCP !== -1 && currentMS !== -1) return;
        const combinedText = `${name} ${description} ${systemPrompt}`;
        const newDetected = { ...autoDetected };
        if (currentIW === -1) { const v = getInitiativeWeightValueFromText(combinedText); setInitiativeWeightStr(String(v)); newDetected.iw = v; }
        if (currentCP === -1) { const v = getChatProbabilityValue(combinedText); setChatProbabilityStr(String(v)); newDetected.cp = v; }
        if (currentMS === -1) { const v = getMaximumChatStaminaValueFromText(combinedText); setMaximumChatStaminaStr(String(Math.round(v))); newDetected.ms = Math.round(v); }
        setAutoDetected(newDetected);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) { setImageFile(e.target.files[0]); setImagePreview(URL.createObjectURL(e.target.files[0])); }
    };
    const handleRemoveImage = (e: React.MouseEvent) => {
        e.stopPropagation(); setImageFile(null); setImagePreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };
    const handleVoiceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const file = e.target.files[0];
            if (file.size > MAX_VOICE_FILE_SIZE) {
                setSubmitError(`Voice file too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`);
                e.target.value = ''; return;
            }
            setVoiceFile(file);
            setVoiceName(file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_'));
            setSubmitError(null);
        }
    };
    const handleRemoveVoice = () => {
        setVoiceFile(null); setVoiceName(''); setExistingVoiceName('');
        if (voiceInputRef.current) voiceInputRef.current.value = '';
    };

    const handleCardImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        const card = await parseCharacterCard(file);
        if (!card) { setSubmitError("Not a valid character card PNG. Supported formats: TavernAI V1/V2."); return; }
        const fields = mapCardToEditorFields(card);
        setName(fields.name); setDescription(fields.description); setSystemPrompt(fields.systemPrompt);
        setThinkPrompt(fields.thinkPrompt); setAppearancePrompt(''); setDialoguePrompt(fields.dialoguePrompt);
        setFirstMessage(fields.firstMessage);
        setImageFile(file); setImagePreview(URL.createObjectURL(file));
        setAutoDetected({ iw: null, cp: null, ms: null });
        setInitiativeWeightStr('-1'); setChatProbabilityStr('-1'); setMaximumChatStaminaStr('-1');
        setSelectedStopPatternIds([]); setDoNotInjectCharacterImage(false);
        countFieldTokens('systemPrompt', fields.systemPrompt);
        countFieldTokens('thinkPrompt', fields.thinkPrompt);
        countFieldTokens('appearancePrompt', '');
        countFieldTokens('dialoguePrompt', fields.dialoguePrompt);
        setSubmitError(null);
    };

    const buildCharacterFromForm = async (isNewClone: boolean): Promise<Character | null> => {
        setSubmitError(null);
        if (!name.trim()) { setSubmitError("Name is required!"); return null; }
        let finalImageFilename = existingCharacter?.image || null;
        if (imageFile) {
            setIsUploading(true);
            try { finalImageFilename = await uploadCharacterImage(imageFile); }
            catch (err) { console.error("Image upload failed:", err); setSubmitError("Failed to upload image. Character not saved."); setIsUploading(false); return null; }
            setIsUploading(false);
        }
        let finalVoiceFilename: string | undefined = isNewClone ? undefined : (existingCharacter?.voice);
        if (voiceFile) {
            setIsUploading(true);
            try { finalVoiceFilename = await uploadCharacterVoice(voiceFile); }
            catch (err) { console.error("Voice upload failed:", err); setSubmitError("Failed to upload voice. Character not saved."); setIsUploading(false); return null; }
            setIsUploading(false);
        } else if (!isNewClone && voiceName === '' && existingVoiceName !== '') { finalVoiceFilename = undefined; }

        const rawIW = Number.parseFloat(initiativeWeightStr);
        const rawCP = Number.parseFloat(chatProbabilityStr);
        const rawMS = Number.parseFloat(maximumChatStaminaStr);
        const iwValid = !Number.isNaN(rawIW) && rawIW >= 0;
        const cpValid = !Number.isNaN(rawCP) && rawCP >= 0;
        const msValid = !Number.isNaN(rawMS) && rawMS >= 0;
        let finalIW: number, finalCP: number, finalMS: number;

        if (existingCharacter && !isNewClone) {
            finalIW = iwValid ? rawIW : (existingCharacter.initiativeWeight ?? -1);
            finalCP = cpValid ? rawCP : (existingCharacter.chatProbability ?? -1);
            finalMS = msValid ? Math.round(rawMS) : (existingCharacter.maximumChatStamina ?? -1);
            if (finalIW === -1 && finalCP === -1 && finalMS === -1) {
                const combinedText = `${name} ${description} ${systemPrompt}`;
                finalIW = getInitiativeWeightValueFromText(combinedText);
                finalCP = getChatProbabilityValue(combinedText);
                finalMS = Math.round(getMaximumChatStaminaValueFromText(combinedText));
            }
        } else {
            finalIW = iwValid ? rawIW : DEFAULT_INITIATIVE_WEIGHT_VALUE;
            finalCP = cpValid ? rawCP : DEFAULT_CHAT_PROBABILITY_VALUE;
            finalMS = msValid ? Math.round(rawMS) : DEFAULT_MAXIMUM_CHAT_STAMINA_VALUE;
            if (rawIW === -1 && rawCP === -1 && rawMS === -1) {
                const combinedText = `${name} ${description} ${systemPrompt}`;
                const detectedIW = getInitiativeWeightValueFromText(combinedText);
                const detectedCP = getChatProbabilityValue(combinedText);
                const detectedMS = getMaximumChatStaminaValueFromText(combinedText);
                if (detectedIW >= 0) finalIW = detectedIW;
                if (detectedCP >= 0) finalCP = detectedCP;
                if (detectedMS >= 0) finalMS = Math.round(detectedMS);
            }
        }

        const baseSampler = allSamplers.find(s => s.id === selectedSamplerId);
        const finalSampler = baseSampler ? { ...baseSampler, stopPatterns: baseSampler.stopPatterns.filter(sp => selectedStopPatternIds.includes(sp.id)) } : undefined;
        const now = Date.now();
        return {
            id: isNewClone ? uuidv4() : (existingCharacter?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description, systemPrompt,
            thinkPrompt: thinkPrompt.trim() || undefined,
            appearancePrompt: appearancePrompt.trim() || undefined,
            dialoguePrompt: dialoguePrompt.trim() || undefined,
            image: finalImageFilename ?? undefined, voice: finalVoiceFilename,
            sampler: finalSampler, initiativeWeight: finalIW, chatProbability: finalCP, maximumChatStamina: finalMS,
            doNotInjectCharacterImage: doNotInjectCharacterImage || undefined,
            firstCreatedTimestamp: isNewClone ? now : (existingCharacter?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => { const c = await buildCharacterFromForm(false); if (c) { onSave(c); onClose(); } };
    const handleClone = async () => { const c = await buildCharacterFromForm(true); if (c) { onSave(c); onClose(); } };

    if (!isOpen) return null;

    const renderAutoHint = (field: 'iw' | 'cp' | 'ms') => {
        const val = autoDetected[field];
        if (val === null) return null;
        return <span className="editor-auto-hint">← auto-detected</span>;
    };

    const renderTokenCount = (field: keyof TokenCounts) => {
        const count = tokenCounts[field];
        if (count === null) return null;
        const isCounting = countingField === field;
        return <div className={`editor-token-count ${isCounting ? 'counting' : ''}`}>{`${count.toLocaleString()} token(s)`}</div>;
    };

    const hasVoice = !!voiceFile || !!existingVoiceName;
    const getStopPatternById = (id: string) => {
        const currentSampler = allSamplers.find(s => s.id === selectedSamplerId);
        if (currentSampler) { const found = currentSampler.stopPatterns.find(sp => sp.id === id); if (found) return found; }
        for (const s of allSamplers) { const found = s.stopPatterns.find(sp => sp.id === id); if (found) return found; }
        return null;
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingCharacter ? 'Edit Character' : 'Create New Character'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {existingCharacter && <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                        {!existingCharacter && (
                            <>
                                <button type="button" className="editor-btn editor-btn-import" onClick={() => cardImportRef.current?.click()} disabled={isUploading}>Import</button>
                                <input ref={cardImportRef} type="file" accept="image/png" hidden onChange={handleCardImport} disabled={isUploading} />
                            </>
                        )}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Uploading...' : 'Save'}</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {submitError && <div className="editor-error-message editor-error-centered">{submitError}</div>}

                    <div className="editor-modal-columns">
                        {/* LEFT COLUMN */}
                        <div className="editor-left-column">
                            <div className="editor-image-upload-container">
                                <div 
                                    className={`editor-image-square editor-image-portrait ${imagePreview ? 'active solid' : 'dashed'}`}
                                    style={{ cursor: isUploading ? 'wait' : 'pointer', opacity: isUploading ? 0.7 : 1 }}
                                    onClick={() => !isUploading && fileInputRef.current?.click()}
                                >
                                    {imagePreview ? (
                                        <>
                                            <img src={imagePreview} alt="Character" />
                                            {!isUploading && (
                                                <div className="editor-image-hover-overlay">
                                                    <button type="button" onClick={handleRemoveImage} className="editor-image-remove-btn-large" title="Remove Picture">🗑️</button>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="editor-image-placeholder">{isUploading ? '⏳' : '📷'}</div>
                                    )}
                                </div>
                                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} disabled={isUploading} />
                            </div>

                            <textarea value={name} onChange={(e) => setName(e.target.value)} className="editor-textarea editor-textarea-name" placeholder="Name *" disabled={isUploading} />
                            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea editor-textarea-description" placeholder="Description" disabled={isUploading} />
                            <textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} className="editor-textarea editor-textarea-first-message" placeholder="First message" disabled={isUploading} />

                            <div className="editor-section editor-voice-section">
                                <span className="editor-section-title">Voice</span>
                                <div className="editor-voice-hint">Used for reading character's text. Maximum 5MB.</div>
                                {hasVoice && (
                                    <div className="editor-voice-chip">
                                        <span className="editor-voice-chip-name">🎙️ {voiceFile ? voiceFile.name : existingVoiceName}</span>
                                        <button type="button" onClick={handleRemoveVoice} disabled={isUploading} className="editor-voice-remove-btn" title="Remove voice">×</button>
                                    </div>
                                )}
                                {!hasVoice && (
                                    <button type="button" onClick={() => !isUploading && voiceInputRef.current?.click()} disabled={isUploading} className={`toolbar-btn editor-voice-upload-btn ${isUploading ? 'uploading' : ''}`}>
                                        {isUploading ? 'Uploading...' : '🎙️ Upload Voice Sample'}
                                    </button>
                                )}
                                <input ref={voiceInputRef} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg" hidden onChange={handleVoiceChange} disabled={isUploading} />
                            </div>
                        </div>

                        {/* RIGHT COLUMN */}
                        <div className="editor-right-column">
                            <div className="editor-field-wrapper-full">
                                <textarea value={systemPrompt} onChange={(e) => { setSystemPrompt(e.target.value); countFieldTokens('systemPrompt', e.target.value); }} onBlur={handleSystemPromptBlur} className="editor-textarea editor-textarea-system" placeholder="System prompt" disabled={isUploading} />
                                {renderTokenCount('systemPrompt')}
                            </div>

                            <div className="editor-field-wrapper">
                                <textarea value={thinkPrompt} onChange={(e) => { setThinkPrompt(e.target.value); countFieldTokens('thinkPrompt', e.target.value); }} className="editor-textarea editor-textarea-think" placeholder="Think Prompt" disabled={isUploading} />
                                {renderTokenCount('thinkPrompt')}
                            </div>

                            <div className="editor-field-wrapper">
                                <textarea value={appearancePrompt} onChange={(e) => { setAppearancePrompt(e.target.value); countFieldTokens('appearancePrompt', e.target.value); }} className="editor-textarea editor-textarea-appearance" placeholder="Appearance Prompt" disabled={isUploading} />
                                {renderTokenCount('appearancePrompt')}
                            </div>

                            <div className="editor-field-wrapper">
                                <textarea value={dialoguePrompt} onChange={(e) => { setDialoguePrompt(e.target.value); countFieldTokens('dialoguePrompt', e.target.value); }} className="editor-textarea editor-textarea-dialogue" placeholder="Dialogue Examples" disabled={isUploading} />
                                {renderTokenCount('dialoguePrompt')}
                            </div>

                            <div className="editor-bottom-section">
                                <select value={selectedSamplerId} onChange={(e) => setSelectedSamplerId(e.target.value)} className={`editor-select ${isLoadingSamplers || isUploading ? 'editor-select-loading' : ''}`} disabled={isLoadingSamplers || isUploading}>
                                    {isLoadingSamplers && <option>Loading samplers...</option>}
                                    {!isLoadingSamplers && allSamplers.length === 0 && <option>No samplers available</option>}
                                    {!isLoadingSamplers && allSamplers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                </select>

                                <div className="editor-section editor-section-compact">
                                    <div className="editor-stats-grid">
                                        <div>
                                            <label className="editor-label editor-label-small">Initiative Weight</label>
                                            <input type="number" step="0.1" value={initiativeWeightStr} onChange={(e) => { setInitiativeWeightStr(e.target.value); setAutoDetected(prev => ({ ...prev, iw: null })); }} onBlur={() => setInitiativeWeightStr(normalizeStatValue(initiativeWeightStr, Number.POSITIVE_INFINITY))} className="editor-input editor-stat-input" disabled={isUploading} />
                                            {renderAutoHint('iw')}
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Chat Probability</label>
                                            <input type="number" step="0.05" value={chatProbabilityStr} onChange={(e) => { setChatProbabilityStr(e.target.value); setAutoDetected(prev => ({ ...prev, cp: null })); }} onBlur={() => setChatProbabilityStr(normalizeStatValue(chatProbabilityStr, 1))} className="editor-input editor-stat-input" disabled={isUploading} />
                                            {renderAutoHint('cp')}
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Maximum Chat Stamina</label>
                                            <input type="number" step="1" min="0" value={maximumChatStaminaStr} onChange={(e) => { setMaximumChatStaminaStr(e.target.value); setAutoDetected(prev => ({ ...prev, ms: null })); }} onBlur={() => { const val = Number.parseFloat(maximumChatStaminaStr); setMaximumChatStaminaStr(Number.isNaN(val) || val < 0 ? '-1' : String(Math.round(val))); }} className="editor-input editor-stat-input" disabled={isUploading} title="Controls response length: higher stamina = longer responses" />
                                            {renderAutoHint('ms')}
                                        </div>
                                    </div>
                                </div>

                                <div className="editor-section">
                                    <div className="editor-section-title">Character Stop Patterns</div>
                                    <div className="editor-stop-patterns-hint">Specific stop sequences for this character (overrides/augments sampler defaults).</div>
                                    <div className="sampler-stop-patterns-list">
                                        {selectedStopPatternIds.length === 0 && <div className="sampler-stop-empty">No character-specific stop patterns assigned.</div>}
                                        {selectedStopPatternIds.map(id => {
                                            const sp = getStopPatternById(id);
                                            if (!sp) return null;
                                            return (
                                                <div key={id} className="sampler-stop-item">
                                                    <div className="sampler-stop-info">
                                                        <span className="sampler-stop-name">{sp.name}</span>
                                                        <span className="sampler-stop-pattern">{sp.pattern}</span>
                                                    </div>
                                                    <button type="button" onClick={() => setSelectedStopPatternIds(prev => prev.filter(sid => sid !== id))} className="sampler-stop-remove-btn" title="Remove stop pattern">×</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <select onChange={(e) => { const val = e.target.value; if (val && !selectedStopPatternIds.includes(val)) setSelectedStopPatternIds(prev => [...prev, val]); e.target.value = ''; }} className="editor-select" defaultValue="" disabled={isUploading}>
                                        <option value="" disabled>+ Add a stop pattern</option>
                                        {allSamplers.flatMap(s => s.stopPatterns).filter((sp, index, self) => index === self.findIndex(t => t.id === sp.id)).filter(sp => !selectedStopPatternIds.includes(sp.id)).map(sp => (<option key={sp.id} value={sp.id}>{sp.name} — {sp.pattern}</option>))}
                                    </select>
                                </div>

                                <div className="editor-section">
                                    <label className="editor-checkbox-label">
                                        <input type="checkbox" checked={doNotInjectCharacterImage} onChange={(e) => setDoNotInjectCharacterImage(e.target.checked)} className="editor-checkbox-input" disabled={isUploading} />
                                        <span>Do Not Inject Character Image</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}