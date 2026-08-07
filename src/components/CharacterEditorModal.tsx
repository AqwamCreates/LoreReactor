// src/components/CharacterEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import type { Character, Sampler } from '../types';
import { uploadCharacterImage } from '../hooks/storage';
import { getInitiativeWeightValueFromText, getChatProbabilityValue, getMaximumChatStaminaValueFromText } from '../hooks/chatTraitsDetection';
import './main.css';

const DEFAULT_INITIATIVE_WEIGHT_VALUE = 1.2;
const DEFAULT_CHAT_PROBABILITY_VALUE = 0.5;
const DEFAULT_MAXIMUM_CHAT_STAMINA_VALUE = 4;

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
    const [firstMessage, setFirstMessage] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [selectedSamplerId, setSelectedSamplerId] = useState<string>('');
    const [isHoveringImage, setIsHoveringImage] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const [initiativeWeightStr, setInitiativeWeightStr] = useState<string>('-1');
    const [chatProbabilityStr, setChatProbabilityStr] = useState<string>('-1');
    const [maximumChatStaminaStr, setMaximumChatStaminaStr] = useState<string>('-1');
    const [maxParagraphsStr, setMaxParagraphsStr] = useState<string>('0');

    const [autoDetected, setAutoDetected] = useState<{ iw: number | null; cp: number | null; ms: number | null }>({
        iw: null, cp: null, ms: null,
    });

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setSubmitError(null);
            setAutoDetected({ iw: null, cp: null, ms: null });
            
            if (existingCharacter) {
                setName(existingCharacter.name || '');
                setDescription(existingCharacter.description || '');
                setSystemPrompt(existingCharacter.systemPrompt || '');
                setThinkPrompt(existingCharacter.thinkPrompt || '');
                setFirstMessage(''); 
                
                if (existingCharacter.image) {
                    setImagePreview(`/user_data/character_images/${existingCharacter.image}`);
                } else {
                    setImagePreview(null);
                }
                
                setImageFile(null);
                setSelectedSamplerId(existingCharacter.sampler?.id || (allSamplers[0]?.id || ''));
                
                setInitiativeWeightStr(String(existingCharacter.initiativeWeight ?? -1));
                setChatProbabilityStr(String(existingCharacter.chatProbability ?? -1));
                setMaximumChatStaminaStr(String(existingCharacter.maximumChatStamina ?? -1));
                setMaxParagraphsStr(String(existingCharacter.maximumNumberOfParagraphsPerTurn ?? 0));
            } else {
                setName('');
                setDescription('');
                setSystemPrompt('');
                setThinkPrompt('');
                setFirstMessage('');
                setImageFile(null);
                setImagePreview(null);
                setSelectedSamplerId(allSamplers[0]?.id || '');
                setInitiativeWeightStr('-1');
                setChatProbabilityStr('-1');
                setMaximumChatStaminaStr('-1');
                setMaxParagraphsStr('0');
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

    // ✅ Shared logic to build a character object from current form state
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

        const rawIW = Number.parseFloat(initiativeWeightStr);
        const rawCP = Number.parseFloat(chatProbabilityStr);
        const rawMS = Number.parseFloat(maximumChatStaminaStr);
        const rawMP = Number.parseFloat(maxParagraphsStr);

        let finalIW: number;
        let finalCP: number;
        let finalMS: number;
        let finalMP: number;

        const iwValid = !Number.isNaN(rawIW) && rawIW >= 0;
        const cpValid = !Number.isNaN(rawCP) && rawCP >= 0;
        const msValid = !Number.isNaN(rawMS) && rawMS >= 0;
        const mpValid = !Number.isNaN(rawMP) && rawMP >= 0;

        if (existingCharacter && !isNewClone) {
            finalIW = iwValid ? rawIW : (existingCharacter.initiativeWeight ?? -1);
            finalCP = cpValid ? rawCP : (existingCharacter.chatProbability ?? -1);
            finalMS = msValid ? Math.round(rawMS) : (existingCharacter.maximumChatStamina ?? -1);
            finalMP = mpValid ? Math.round(rawMP) : (existingCharacter.maximumNumberOfParagraphsPerTurn ?? 0);

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
            finalMP = mpValid ? Math.round(rawMP) : 0;

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

        const now = Date.now();
        return {
            id: isNewClone ? crypto.randomUUID() : (existingCharacter?.id || crypto.randomUUID()),
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description,
            systemPrompt,
            thinkPrompt: thinkPrompt.trim() || undefined,
            image: finalImageFilename ?? undefined,
            sampler: allSamplers.find(s => s.id === selectedSamplerId),
            initiativeWeight: finalIW,
            chatProbability: finalCP,
            maximumChatStamina: finalMS,
            maximumNumberOfParagraphsPerTurn: finalMP > 0 ? finalMP : undefined,
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

    // ✅ Clone: save as new character with a new ID and "(Clone)" suffix
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

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingCharacter ? 'Edit Character' : 'Create New Character'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                        {/* ✅ Clone button — only shown when editing an existing character */}
                        {existingCharacter && (
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone} disabled={isUploading}>
                                Clone
                            </button>
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

                            {/* Sampler + Stats */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <select 
                                    value={selectedSamplerId} 
                                    onChange={(e) => setSelectedSamplerId(e.target.value)}
                                    className="editor-select"
                                    style={{ opacity: isLoadingSamplers || isUploading ? 0.6 : 1, cursor: isLoadingSamplers || isUploading ? 'wait' : 'pointer' }}
                                    disabled={isLoadingSamplers || isUploading}
                                >
                                    {isLoadingSamplers && <option>Loading samplers...</option>}
                                    {!isLoadingSamplers && allSamplers.length === 0 && <option>No samplers available</option>}
                                    {!isLoadingSamplers && allSamplers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                </select>

                                <div className="editor-section" style={{ padding: '10px', marginBottom: 0 }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
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
                                            <label className="editor-label editor-label-small">Max Stamina</label>
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
                                            />
                                            {renderAutoHint('ms')}
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Max Paragraphs</label>
                                            <input 
                                                type="number" step="1" min="0"
                                                value={maxParagraphsStr} 
                                                onChange={(e) => setMaxParagraphsStr(e.target.value)}
                                                onBlur={() => {
                                                    const val = Number.parseFloat(maxParagraphsStr);
                                                    if (Number.isNaN(val) || val < 0) {
                                                        setMaxParagraphsStr('0');
                                                    } else {
                                                        setMaxParagraphsStr(String(Math.round(val)));
                                                    }
                                                }}
                                                className="editor-input"
                                                style={{ textAlign: 'right', padding: '5px 8px', fontSize: '0.8rem' }} 
                                                disabled={isUploading} 
                                                title="0 = unlimited"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}