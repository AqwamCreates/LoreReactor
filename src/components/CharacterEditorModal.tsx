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
    const [firstMessage, setFirstMessage] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [selectedSamplerId, setSelectedSamplerId] = useState<string>('');
    const [isHoveringImage, setIsHoveringImage] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const [initiativeWeightStr, setInitiativeWeightStr] = useState<string>('-1');
    const [chatProbabilityStr, setChatProbabilityStr] = useState<string>('-1');
    const [maximumChatStaminaStr, setMaximumChatStaminaStr] = useState<string>('-1');

    const [autoDetected, setAutoDetected] = useState<{ iw: number | null; cp: number | null; ms: number | null }>({
        iw: null, cp: null, ms: null,
    });

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setAutoDetected({ iw: null, cp: null, ms: null });
            if (existingCharacter) {
                setName(existingCharacter.name || '');
                setDescription(existingCharacter.description || '');
                setSystemPrompt(existingCharacter.systemPrompt || '');
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
            } else {
                setName('');
                setDescription('');
                setSystemPrompt('');
                setFirstMessage('');
                setImageFile(null);
                setImagePreview(null);
                setSelectedSamplerId(allSamplers[0]?.id || '');
                
                setInitiativeWeightStr('-1');
                setChatProbabilityStr('-1');
                setMaximumChatStaminaStr('-1');
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
        const iwIsAuto = Number.parseFloat(initiativeWeightStr) === -1;
        const cpIsAuto = Number.parseFloat(chatProbabilityStr) === -1;
        const msIsAuto = Number.parseFloat(maximumChatStaminaStr) === -1;

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
            setMaximumChatStaminaStr(String(value));
            newDetected.ms = value;
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

    const handleSubmit = async () => {
        if (!name.trim()) {
            alert("Character Name Is Required!");
            return;
        }

        let finalImageFilename = existingCharacter?.image || null;

        if (imageFile) {
            setIsUploading(true);
            try {
                finalImageFilename = await uploadCharacterImage(imageFile);
            } catch (err) {
                console.error("Image upload failed:", err);
                alert("Failed to upload image. Character not saved.");
                setIsUploading(false);
                return;
            }
            setIsUploading(false);
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

        if (existingCharacter) {
            finalIW = iwValid ? rawIW : (existingCharacter.initiativeWeight ?? -1);
            finalCP = cpValid ? rawCP : (existingCharacter.chatProbability ?? -1);
            finalMS = msValid ? rawMS : (existingCharacter.maximumChatStamina ?? -1);

            if (finalIW === -1 && finalCP === -1 && finalMS === -1) {
                const combinedText = `${name} ${description} ${systemPrompt}`;
                finalIW = getInitiativeWeightValueFromText(combinedText);
                finalCP = getChatProbabilityValue(combinedText);
                finalMS = getMaximumChatStaminaValueFromText(combinedText);
            }
        } else {
            finalIW = iwValid ? rawIW : DEFAULT_INITIATIVE_WEIGHT_VALUE;
            finalCP = cpValid ? rawCP : DEFAULT_CHAT_PROBABILITY_VALUE;
            finalMS = msValid ? rawMS : DEFAULT_MAXIMUM_CHAT_STAMINA_VALUE;

            if (rawIW === -1 && rawCP === -1 && rawMS === -1) {
                const combinedText = `${name} ${description} ${systemPrompt}`;
                const detectedIW = getInitiativeWeightValueFromText(combinedText);
                const detectedCP = getChatProbabilityValue(combinedText);
                const detectedMS = getMaximumChatStaminaValueFromText(combinedText);
                
                if (detectedIW >= 0) finalIW = detectedIW;
                if (detectedCP >= 0) finalCP = detectedCP;
                if (detectedMS >= 0) finalMS = detectedMS;
            }
        }

        const now = Date.now();
        const newChar: Character = {
            id: existingCharacter ? existingCharacter.id : crypto.randomUUID(),
            name, description, systemPrompt,
            image: finalImageFilename ?? undefined,
            sampler: allSamplers.find(s => s.id === selectedSamplerId),
            initiativeWeight: finalIW,
            chatProbability: finalCP,
            maximumChatStamina: finalMS,
            firstCreatedTimestamp: existingCharacter?.firstCreatedTimestamp || now,
            lastUpdatedTimestamp: now,
        };

        onSave(newChar);
        onClose();
    };

    if (!isOpen) return null;

    const inputStyle: React.CSSProperties = {
        width: '100%', boxSizing: 'border-box', fontSize: '0.85rem', fontFamily: 'inherit',
        padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)',
        background: 'var(--social-bg)', color: 'var(--text-h)', outline: 'none',
        resize: 'vertical', textOverflow: 'unset', whiteSpace: 'normal'
    };

    const selectStyle: React.CSSProperties = {
        ...inputStyle,
        appearance: 'auto',
        WebkitAppearance: 'auto',
        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%23666\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E")',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
        paddingRight: '32px',
        backgroundColor: 'var(--social-bg)',
        color: 'var(--text-h)',
        cursor: 'pointer',
    };

    const labelStyle: React.CSSProperties = {
        fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-h)', display: 'block',
        marginBottom: '4px', letterSpacing: '0.5px', opacity: 0.8
    };

    const buttonStyle: React.CSSProperties = {
        padding: '8px 20px', fontSize: '0.85rem', fontWeight: 'bold', borderRadius: '6px',
        cursor: 'pointer', border: '1px solid transparent', fontFamily: 'inherit', transition: 'all 0.2s'
    };

    const compactInputStyle: React.CSSProperties = {
        ...inputStyle, padding: '5px 8px', fontSize: '0.8rem', textAlign: 'right'
    };

    const leftColumnWidth = '220px';

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
            <div 
                className="modal-content" 
                onClick={e => e.stopPropagation()} 
                style={{ maxWidth: '900px', maxHeight: '98vh', minHeight: '900px', display: 'flex', flexDirection: 'column' }}
            >
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <h2>{existingCharacter ? 'Edit Character' : 'Create New Character'}</h2>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button type="button" className="edit-btn edit-btn-cancel" onClick={onClose} 
                            style={{ ...buttonStyle, background: 'transparent', color: 'var(--text-h)', border: '1px solid var(--border)' }} disabled={isUploading}>Cancel</button>
                        <button type="button" className="edit-btn edit-btn-save" onClick={handleSubmit} 
                            style={{ ...buttonStyle, background: 'var(--accent)', color: '#fff', opacity: isUploading ? 0.7 : 1 }} disabled={isUploading}>
                            {isUploading ? 'Uploading...' : 'Save'}
                        </button>
                    </div>
                </div>
                
                <div className="modal-body" style={{ 
                    display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px'
                }}>
                    <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
                        
                        {/* LEFT COLUMN */}
                        <div style={{ 
                            width: leftColumnWidth, flexShrink: 0, 
                            display: 'flex', flexDirection: 'column', gap: '10px' 
                        }}>
                            {/* Image */}
                            <div style={{ flexShrink: 0 }}>
                                <div 
                                    style={{ 
                                        position: 'relative', width: '100%', aspectRatio: '9/16', borderRadius: '12px',
                                        overflow: 'hidden', border: imagePreview ? '2px solid var(--accent)' : '2px dashed var(--border)',
                                        backgroundColor: 'var(--social-bg)', cursor: isUploading ? 'wait' : 'pointer', 
                                        transition: 'border-color 0.2s', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', opacity: isUploading ? 0.7 : 1
                                    }}
                                    onClick={() => !isUploading && fileInputRef.current?.click()}
                                    onMouseEnter={() => setIsHoveringImage(true)}
                                    onMouseLeave={() => setIsHoveringImage(false)}
                                >
                                    <div style={{ width: '100%', height: '100%', backgroundImage: imagePreview ? `url(${imagePreview})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center top' }} />
                                    {!imagePreview && (
                                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', opacity: 0.3, pointerEvents: 'none' }}>
                                            {isUploading ? '⏳' : '📷'}
                                        </div>
                                    )}
                                    {imagePreview && !isUploading && (
                                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: isHoveringImage ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                                            <button type="button" onClick={handleRemoveImage} style={{ background: 'transparent', border: 'none', color: '#ff4444', fontSize: '2rem', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Remove Picture">🗑️</button>
                                        </div>
                                    )}
                                </div>
                                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} disabled={isUploading} />
                            </div>

                            {/* Name */}
                            <textarea 
                                value={name} onChange={(e) => setName(e.target.value)} 
                                style={{ 
                                    ...inputStyle, 
                                    fontWeight: 'bold', 
                                    flex: '0.7 1 0', 
                                    minHeight: '38px',
                                    maxHeight: '160px',
                                    resize: 'none',
                                    overflowY: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word'
                                }} 
                                placeholder="Name *" 
                                disabled={isUploading} 
                            />

                            {/* Description */}
                            <textarea 
                                value={description} onChange={(e) => setDescription(e.target.value)} 
                                style={{ ...inputStyle, flex: '1 1 0', minHeight: '60px' }} 
                                placeholder="Description" disabled={isUploading}
                            />

                            {/* First Message */}
                            <textarea 
                                value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} 
                                style={{ ...inputStyle, flex: '2 1 0', minHeight: '60px' }} 
                                placeholder="First message" disabled={isUploading}
                            />
                        </div>

                        {/* RIGHT COLUMN */}
                        <div style={{ 
                            flex: 1, minWidth: '280px',
                            display: 'grid',
                            gridTemplateRows: '1fr auto',
                            gap: '10px',
                            minHeight: 0
                        }}>
                            {/* System Prompt */}
                            <textarea 
                                value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} 
                                onBlur={handleSystemPromptBlur}
                                style={{ ...inputStyle, fontFamily: 'monospace', minHeight: 0, height: '100%' }} 
                                placeholder="System prompt" disabled={isUploading}
                            />

                            {/* Sampler + Stats */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <select 
                                    value={selectedSamplerId} 
                                    onChange={(e) => setSelectedSamplerId(e.target.value)}
                                    style={{ 
                                        ...selectStyle, 
                                        flexShrink: 0, 
                                        opacity: isLoadingSamplers || isUploading ? 0.6 : 1, 
                                        cursor: isLoadingSamplers || isUploading ? 'wait' : 'pointer' 
                                    }}
                                    disabled={isLoadingSamplers || isUploading}
                                >
                                    {isLoadingSamplers && <option>Loading samplers...</option>}
                                    {!isLoadingSamplers && allSamplers.length === 0 && <option>No samplers available</option>}
                                    {!isLoadingSamplers && allSamplers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                </select>

                                <div style={{ 
                                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px',
                                    padding: '6px 10px 10px', borderRadius: '8px', border: '1px solid var(--border)',
                                    background: 'rgba(0,0,0,0.02)', alignContent: 'start'
                                }}>
                                    <div>
                                        <label style={{ ...labelStyle, fontSize: '0.65rem', marginBottom: '1px' }}>Initiative Weight</label>
                                        <input 
                                            type="number" step="0.1" 
                                            value={initiativeWeightStr} 
                                            onChange={(e) => { setInitiativeWeightStr(e.target.value); setAutoDetected(prev => ({ ...prev, iw: null })); }}
                                            onBlur={() => {
                                                setInitiativeWeightStr(normalizeStatValue(initiativeWeightStr, Number.POSITIVE_INFINITY));
                                            }}
                                            style={compactInputStyle} 
                                            disabled={isUploading} 
                                        />
                                        {renderAutoHint('iw')}
                                    </div>
                                    <div>
                                        <label style={{ ...labelStyle, fontSize: '0.65rem', marginBottom: '1px' }}>Chat Probability</label>
                                        <input 
                                            type="number" step="0.05" 
                                            value={chatProbabilityStr} 
                                            onChange={(e) => { setChatProbabilityStr(e.target.value); setAutoDetected(prev => ({ ...prev, cp: null })); }}
                                            onBlur={() => {
                                                setChatProbabilityStr(normalizeStatValue(chatProbabilityStr, 1));
                                            }}
                                            style={compactInputStyle} 
                                            disabled={isUploading} 
                                        />
                                        {renderAutoHint('cp')}
                                    </div>
                                    <div>
                                        <label style={{ ...labelStyle, fontSize: '0.65rem', marginBottom: '1px' }}>Maximum Chat Stamina</label>
                                        <input 
                                            type="number" step="1" 
                                            value={maximumChatStaminaStr} 
                                            onChange={(e) => { setMaximumChatStaminaStr(e.target.value); setAutoDetected(prev => ({ ...prev, ms: null })); }}
                                            onBlur={() => {
                                                setMaximumChatStaminaStr(normalizeStatValue(maximumChatStaminaStr, Number.POSITIVE_INFINITY));
                                            }}
                                            style={compactInputStyle} 
                                            disabled={isUploading} 
                                        />
                                        {renderAutoHint('ms')}
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