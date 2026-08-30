// src/components/CharacterEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { Character, Sampler } from '../types';
import { uploadCharacterImage, uploadCharacterVoice } from '../hooks/storage';
import { getInitiativeWeightValueFromText, getChatProbabilityValue, getMaximumChatStaminaValueFromText } from '../hooks/chatTraitsDetection';
import { parseCharacterCard, mapCardToEditorFields } from '../services/characterCardParser';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

const DEFAULT_INITIATIVE_WEIGHT_VALUE = 1.2;
const DEFAULT_CHAT_PROBABILITY_VALUE = 0.5;
const DEFAULT_MAXIMUM_CHAT_STAMINA_VALUE = 4;
const MAX_VOICE_FILE_SIZE = 5 * 1024 * 1024; // 5MB

interface CharacterEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (character: Character) => void;
    existingCharacter?: Character | null;
    allSamplers: Sampler[];
    isLoadingSamplers?: boolean;
}

export function CharacterEditorModal({ 
    isOpen, onClose, onSave, existingCharacter, 
    allSamplers, isLoadingSamplers = false 
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

    const [isHoveringImage, setIsHoveringImage] = useState(false);
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

    const fileInputRef = useRef<HTMLInputElement>(null);
    const cardImportRef = useRef<HTMLInputElement>(null);
    const voiceInputRef = useRef<HTMLInputElement>(null);

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
                
                if (existingCharacter.image) {
                    setImagePreview(`/user_data/character_images/${existingCharacter.image}`);
                } else {
                    setImagePreview(null);
                }
                
                setImageFile(null);
                setSelectedSamplerId(existingCharacter.sampler?.id || (allSamplers[0]?.id || ''));
                
                const existingStopIds = existingCharacter.sampler?.stopPatterns.map(sp => sp.id) || [];
                setSelectedStopPatternIds(existingStopIds);

                setInitiativeWeightStr(String(existingCharacter.initiativeWeight ?? -1));
                setChatProbabilityStr(String(existingCharacter.chatProbability ?? -1));
                setMaximumChatStaminaStr(String(existingCharacter.maximumChatStamina ?? -1));

                setExistingVoiceName(existingCharacter.voice || '');
                setVoiceName(existingCharacter.voice || '');
                setVoiceFile(null);

                setDoNotInjectCharacterImage(existingCharacter.doNotInjectCharacterImage ?? false);
            } else {
                setName('');
                setDescription('');
                setSystemPrompt('');
                setThinkPrompt('');
                setAppearancePrompt('');
                setDialoguePrompt('');
                setFirstMessage('');
                setImageFile(null);
                setImagePreview(null);
                setSelectedSamplerId(allSamplers[0]?.id || '');
                setSelectedStopPatternIds([]);
                setInitiativeWeightStr('-1');
                setChatProbabilityStr('-1');
                setMaximumChatStaminaStr('-1');

                setExistingVoiceName('');
                setVoiceName('');
                setVoiceFile(null);

                setDoNotInjectCharacterImage(false);
            }
        }
    }, [isOpen, existingCharacter, allSamplers]);

    const clamp = (value: number, min: number, max: number): number => {
        return Math.min(Math.max(value, min), max);
    };

    const normalizeStatValue = (raw: string, fieldMax: number): string => {
        const val = Number.parseFloat(raw);
        if (Number.isNaN(val) || val < 0) return '-1';
        return String(clamp(val, 0, fieldMax));
    };

    const handleSystemPromptBlur = () => {
        const currentIW = Number.parseFloat(initiativeWeightStr);
        const currentCP = Number.parseFloat(chatProbabilityStr);
        const currentMS = Number.parseFloat(maximumChatStaminaStr);

        const iwIsAuto = currentIW === -1;
        const cpIsAuto = currentCP === -1;
        const msIsAuto = currentMS === -1;

        if (!iwIsAuto && !cpIsAuto && !msIsAuto) return;

        const combinedText = `${name} ${description} ${systemPrompt}`;
        const newDetected = { ...autoDetected };

        if (iwIsAuto) {
            const value = getInitiativeWeightValueFromText(combinedText);
            setInitiativeWeightStr(String(value));
            newDetected.iw = value;
        }
        if (cpIsAuto) {
            const value = getChatProbabilityValue(combinedText);
            setChatProbabilityStr(String(value));
            newDetected.cp = value;
        }
        if (msIsAuto) {
            const value = getMaximumChatStaminaValueFromText(combinedText);
            setMaximumChatStaminaStr(String(Math.round(value)));
            newDetected.ms = Math.round(value);
        }

        setAutoDetected(newDetected);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const file = e.target.files[0];
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
        }
    };

    const handleRemoveImage = (e: React.MouseEvent) => {
        e.stopPropagation();
        setImageFile(null);
        setImagePreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleVoiceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const file = e.target.files[0];
            if (file.size > MAX_VOICE_FILE_SIZE) {
                setSubmitError(`Voice file too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`);
                e.target.value = '';
                return;
            }
            setVoiceFile(file);
            const label = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
            setVoiceName(label);
            setSubmitError(null);
        }
    };

    const handleRemoveVoice = () => {
        setVoiceFile(null);
        setVoiceName('');
        setExistingVoiceName('');
        if (voiceInputRef.current) voiceInputRef.current.value = '';
    };

    const handleCardImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';

        const card = await parseCharacterCard(file);
        if (!card) {
            setSubmitError("Not a valid character card PNG. Supported formats: TavernAI V1/V2.");
            return;
        }

        const fields = mapCardToEditorFields(card);
        setName(fields.name);
        setDescription(fields.description);
        setSystemPrompt(fields.systemPrompt);
        setThinkPrompt(fields.thinkPrompt);
        setAppearancePrompt('');
        setDialoguePrompt(fields.dialoguePrompt);
        setFirstMessage(fields.firstMessage);

        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));

        setAutoDetected({ iw: null, cp: null, ms: null });
        setInitiativeWeightStr('-1');
        setChatProbabilityStr('-1');
        setMaximumChatStaminaStr('-1');
        setSelectedStopPatternIds([]);
        setDoNotInjectCharacterImage(false);

        setSubmitError(null);
    };

    const buildCharacterFromForm = async (isNewClone: boolean): Promise<Character | null> => {
        setSubmitError(null);
        if (!name.trim()) {
            setSubmitError("Name is required!");
            return null;
        }

        let finalImageFilename = existingCharacter?.image || null;

        if (imageFile) {
            setIsUploading(true);
            try {
                finalImageFilename = await uploadCharacterImage(imageFile);
            } catch (err) {
                console.error("Image upload failed:", err);
                setSubmitError("Failed to upload image. Character not saved.");
                setIsUploading(false);
                return null;
            }
            setIsUploading(false);
        }

        let finalVoiceFilename: string | undefined = isNewClone ? undefined : (existingCharacter?.voice);

        if (voiceFile) {
            setIsUploading(true);
            try {
                finalVoiceFilename = await uploadCharacterVoice(voiceFile);
            } catch (err) {
                console.error("Voice upload failed:", err);
                setSubmitError("Failed to upload voice. Character not saved.");
                setIsUploading(false);
                return null;
            }
            setIsUploading(false);
        } else if (!isNewClone && voiceName === '' && existingVoiceName !== '') {
            finalVoiceFilename = undefined;
        }

        const rawIW = Number.parseFloat(initiativeWeightStr);
        const rawCP = Number.parseFloat(chatProbabilityStr);
        const rawMS = Number.parseFloat(maximumChatStaminaStr);

        let finalIW: number;
        let finalCP: number;
        let finalMS: number;

        const iwValid = !Number.isNaN(rawIW) && rawIW >= 0;
        const cpValid = !Number.isNaN(rawCP) && rawCP >= 0;
        const msValid = !Number.isNaN(rawMS) && rawMS >= 0;

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
        
        const finalSampler = baseSampler ? {
            ...baseSampler,
            stopPatterns: baseSampler.stopPatterns.filter(sp => selectedStopPatternIds.includes(sp.id))
        } : undefined;

        const now = Date.now();
        return {
            id: isNewClone ? uuidv4() : (existingCharacter?.id || uuidv4()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description,
            systemPrompt,
            thinkPrompt: thinkPrompt.trim() || undefined,
            appearancePrompt: appearancePrompt.trim() || undefined,
            dialoguePrompt: dialoguePrompt.trim() || undefined,
            image: finalImageFilename ?? undefined,
            voice: finalVoiceFilename,
            sampler: finalSampler,
            initiativeWeight: finalIW,
            chatProbability: finalCP,
            maximumChatStamina: finalMS,
            doNotInjectCharacterImage: doNotInjectCharacterImage || undefined,
            firstCreatedTimestamp: isNewClone ? now : (existingCharacter?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => {
        const newChar = await buildCharacterFromForm(false);
        if (!newChar) return;
        onSave(newChar);
        onClose();
    };

    const handleClone = async () => {
        const clonedChar = await buildCharacterFromForm(true);
        if (!clonedChar) return;
        onSave(clonedChar);
        onClose();
    };

    if (!isOpen) return null;

    const renderAutoHint = (field: 'iw' | 'cp' | 'ms') => {
        const val = autoDetected[field];
        if (val === null) return null;
        return (
            <span style={{ fontSize: '0.6rem', color: 'var(--accent)', opacity: 0.9, marginTop: '2px', display: 'block', textAlign: 'right' }}>
                ← auto-detected
            </span>
        );
    };

    const hasVoice = !!voiceFile || !!existingVoiceName;

    const getStopPatternById = (id: string) => {
        const currentSampler = allSamplers.find(s => s.id === selectedSamplerId);
        if (currentSampler) {
            const found = currentSampler.stopPatterns.find(sp => sp.id === id);
            if (found) return found;
        }
        for (const s of allSamplers) {
            const found = s.stopPatterns.find(sp => sp.id === id);
            if (found) return found;
        }
        return null;
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingCharacter ? 'Edit Character' : 'Create New Character'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {existingCharacter && (
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone} disabled={isUploading}>
                                Clone
                            </button>
                        )}
                        {!existingCharacter && (
                            <>
                                <button type="button" className="editor-btn editor-btn-import" onClick={() => cardImportRef.current?.click()} disabled={isUploading}>
                                    Import
                                </button>
                                <input ref={cardImportRef} type="file" accept="image/png" hidden onChange={handleCardImport} disabled={isUploading} />
                            </>
                        )}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit} disabled={isUploading}>
                            {isUploading ? 'Uploading...' : 'Save'}
                        </button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {submitError && (
                        <div className="editor-error-message" style={{ marginBottom: '16px', textAlign: 'center' }}>
                            {submitError}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '20px', height: '100%' }}>
                        
                        {/* LEFT COLUMN */}
                        <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {/* Image Upload */}
                            <div style={{ flexShrink: 0 }}>
                                <div 
                                    className={`editor-image-square ${imagePreview ? 'active' : ''}`}
                                    style={{ 
                                        aspectRatio: '9/16', 
                                        borderStyle: imagePreview ? 'solid' : 'dashed',
                                        cursor: isUploading ? 'wait' : 'pointer',
                                        opacity: isUploading ? 0.7 : 1
                                    }}
                                    onClick={() => !isUploading && fileInputRef.current?.click()}
                                    onMouseEnter={() => setIsHoveringImage(true)}
                                    onMouseLeave={() => setIsHoveringImage(false)}
                                >
                                    {imagePreview ? (
                                        <>
                                            <img src={imagePreview} alt="Character" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                                            {!isUploading && (
                                                <div style={{ 
                                                    position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', 
                                                    display: isHoveringImage ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 10 
                                                }}>
                                                    <button type="button" onClick={handleRemoveImage} style={{ background: 'transparent', border: 'none', color: '#ff4444', fontSize: '2rem', cursor: 'pointer' }} title="Remove Picture">🗑️</button>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div style={{ fontSize: '3rem', opacity: 0.3 }}>{isUploading ? '⏳' : '📷'}</div>
                                    )}
                                </div>
                                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} disabled={isUploading} />
                            </div>

                            {/* Name */}
                            <textarea 
                                value={name} onChange={(e) => setName(e.target.value)} 
                                className="editor-textarea"
                                style={{ fontWeight: 'bold', minHeight: '38px', maxHeight: '160px', resize: 'none' }} 
                                placeholder="Name *" 
                                disabled={isUploading} 
                            />

                            {/* Description */}
                            <textarea 
                                value={description} onChange={(e) => setDescription(e.target.value)} 
                                className="editor-textarea"
                                style={{ minHeight: '60px' }} 
                                placeholder="Description" disabled={isUploading}
                            />

                            {/* First Message */}
                            <textarea 
                                value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} 
                                className="editor-textarea"
                                style={{ minHeight: '60px' }} 
                                placeholder="First message" disabled={isUploading}
                            />

                            {/* Voice Upload */}
                            <div className="editor-section" style={{ padding: '10px', marginBottom: 0 }}>
                                <span className="editor-section-title" style={{ fontSize: '0.7rem' }}>Voice</span>
                                <div style={{ fontSize: '0.6rem', opacity: 0.5, marginBottom: '6px' }}>
                                    Used for reading character's text. Maximum 5MB.
                                </div>

                                {hasVoice && (
                                    <div style={{ 
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                                        padding: '6px 10px', background: 'var(--social-bg)', borderRadius: '6px', 
                                        border: '1px solid var(--border)', marginBottom: '6px' 
                                    }}>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-h)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            🎙️ {voiceFile ? voiceFile.name : existingVoiceName}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={handleRemoveVoice}
                                            disabled={isUploading}
                                            style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 4px' }}
                                            title="Remove voice"
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}

                                {!hasVoice && (
                                    <button
                                        type="button"
                                        onClick={() => !isUploading && voiceInputRef.current?.click()}
                                        disabled={isUploading}
                                        className="toolbar-btn"
                                        style={{ width: '100%', padding: '8px', fontSize: '0.75rem', opacity: isUploading ? 0.5 : 1 }}
                                    >
                                        {isUploading ? 'Uploading...' : '🎙️ Upload Voice Sample'}
                                    </button>
                                )}
                                <input ref={voiceInputRef} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg" hidden onChange={handleVoiceChange} disabled={isUploading} />
                            </div>
                        </div>

                        {/* RIGHT COLUMN */}
                        <div style={{ flex: 1, minWidth: '280px', display: 'grid', gridTemplateRows: '1fr auto', gap: '10px', minHeight: 0 }}>
                            {/* System Prompt */}
                            <textarea 
                                value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} 
                                onBlur={handleSystemPromptBlur}
                                className="editor-textarea"
                                style={{ fontFamily: 'monospace', minHeight: 0, height: '100%' }} 
                                placeholder="System prompt" disabled={isUploading}
                            />

                            {/* Think Prompt */}
                            <textarea 
                                value={thinkPrompt} onChange={(e) => setThinkPrompt(e.target.value)} 
                                className="editor-textarea"
                                style={{ fontFamily: 'monospace', minHeight: '38px', maxHeight: '120px', resize: 'vertical' }} 
                                placeholder="Think Prompt" disabled={isUploading}
                            />

                            {/* Appearance Prompt */}
                            <textarea 
                                value={appearancePrompt} onChange={(e) => setAppearancePrompt(e.target.value)} 
                                className="editor-textarea"
                                style={{ fontFamily: 'monospace', minHeight: '38px', maxHeight: '120px', resize: 'vertical' }} 
                                placeholder="Appearance Prompt" disabled={isUploading}
                            />

                            {/* Dialogue Prompt */}
                            <textarea 
                                value={dialoguePrompt} onChange={(e) => setDialoguePrompt(e.target.value)} 
                                className="editor-textarea"
                                style={{ fontFamily: 'monospace', minHeight: '38px', maxHeight: '120px', resize: 'vertical' }} 
                                placeholder="Dialogue Examples" disabled={isUploading}
                            />

                            {/* Sampler + Stats + Stop Patterns + Image Injection Toggle */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
                                <select 
                                    value={selectedSamplerId} 
                                    onChange={(e) => {
                                        const newId = e.target.value;
                                        setSelectedSamplerId(newId);
                                    }}
                                    className="editor-select"
                                    style={{ opacity: isLoadingSamplers || isUploading ? 0.6 : 1, cursor: isLoadingSamplers || isUploading ? 'wait' : 'pointer' }}
                                    disabled={isLoadingSamplers || isUploading}
                                >
                                    {isLoadingSamplers && <option>Loading samplers...</option>}
                                    {!isLoadingSamplers && allSamplers.length === 0 && <option>No samplers available</option>}
                                    {!isLoadingSamplers && allSamplers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                </select>

                                <div className="editor-section" style={{ padding: '10px', marginBottom: 0 }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                        <div>
                                            <label className="editor-label editor-label-small">Initiative Weight</label>
                                            <input 
                                                type="number" step="0.1" 
                                                value={initiativeWeightStr} 
                                                onChange={(e) => { setInitiativeWeightStr(e.target.value); setAutoDetected(prev => ({ ...prev, iw: null })); }}
                                                onBlur={() => setInitiativeWeightStr(normalizeStatValue(initiativeWeightStr, Number.POSITIVE_INFINITY))}
                                                className="editor-input"
                                                style={{ textAlign: 'right', padding: '5px 8px', fontSize: '0.8rem' }} 
                                                disabled={isUploading} 
                                            />
                                            {renderAutoHint('iw')}
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Chat Probability</label>
                                            <input 
                                                type="number" step="0.05" 
                                                value={chatProbabilityStr} 
                                                onChange={(e) => { setChatProbabilityStr(e.target.value); setAutoDetected(prev => ({ ...prev, cp: null })); }}
                                                onBlur={() => setChatProbabilityStr(normalizeStatValue(chatProbabilityStr, 1))}
                                                className="editor-input"
                                                style={{ textAlign: 'right', padding: '5px 8px', fontSize: '0.8rem' }} 
                                                disabled={isUploading} 
                                            />
                                            {renderAutoHint('cp')}
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Maximum Chat Stamina</label>
                                            <input 
                                                type="number" step="1" min="0"
                                                value={maximumChatStaminaStr} 
                                                onChange={(e) => { setMaximumChatStaminaStr(e.target.value); setAutoDetected(prev => ({ ...prev, ms: null })); }}
                                                onBlur={() => {
                                                    const val = Number.parseFloat(maximumChatStaminaStr);
                                                    if (Number.isNaN(val) || val < 0) {
                                                        setMaximumChatStaminaStr('-1');
                                                    } else {
                                                        setMaximumChatStaminaStr(String(Math.round(val)));
                                                    }
                                                }}
                                                className="editor-input"
                                                style={{ textAlign: 'right', padding: '5px 8px', fontSize: '0.8rem' }} 
                                                disabled={isUploading} 
                                                title="Controls response length: higher stamina = longer responses"
                                            />
                                            {renderAutoHint('ms')}
                                        </div>
                                    </div>
                                </div>

                                {/* Stop Patterns Section */}
                                <div className="editor-section">
                                    <div className="editor-section-title">Character Stop Patterns</div>
                                    <div style={{ fontSize: '0.6rem', opacity: 0.6, marginBottom: '8px' }}>
                                        Specific stop sequences for this character (overrides/augments sampler defaults).
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
                                                        onClick={() => setSelectedStopPatternIds(prev => prev.filter(sid => sid !== id))}
                                                        className="sampler-stop-remove-btn"
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
                                            if (val && !selectedStopPatternIds.includes(val)) {
                                                setSelectedStopPatternIds(prev => [...prev, val]);
                                            }
                                            e.target.value = '';
                                        }}
                                        className="editor-select"
                                        defaultValue=""
                                        disabled={isUploading}
                                    >
                                        <option value="" disabled>+ Add a stop pattern</option>
                                        {allSamplers.flatMap(s => s.stopPatterns)
                                            .filter((sp, index, self) => index === self.findIndex(t => t.id === sp.id))
                                            .filter(sp => !selectedStopPatternIds.includes(sp.id))
                                            .map(sp => (
                                                <option key={sp.id} value={sp.id}>{sp.name} — {sp.pattern}</option>
                                            ))
                                        }
                                    </select>
                                </div>

                                {/* Do Not Inject Character Image Toggle */}
                                <div className="editor-section">
                                    <label className="editor-checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={doNotInjectCharacterImage}
                                            onChange={(e) => setDoNotInjectCharacterImage(e.target.checked)}
                                            className="editor-checkbox-input"
                                            disabled={isUploading}
                                        />
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