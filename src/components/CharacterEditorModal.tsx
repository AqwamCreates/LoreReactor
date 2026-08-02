import React, { useState, useEffect, useRef } from 'react';
import type { Character, Sampler } from '../types';
import { uploadCharacterImage } from '../hooks/storage';
import './main.css';

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

    const [initiativeWeight, setInitiativeWeight] = useState<number>(1);
    const [chatProbability, setChatProbability] = useState<number>(0.5);
    const [maximumChatStamina, setMaximumChatStamina] = useState<number>(5);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
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
                setInitiativeWeight(existingCharacter.initiativeWeight ?? 1);
                setChatProbability(existingCharacter.chatProbability ?? 0.5);
                setMaximumChatStamina(existingCharacter.maximumChatStamina ?? 5);
            } else {
                setName('');
                setDescription('');
                setSystemPrompt('');
                setFirstMessage('');
                setImageFile(null);
                setImagePreview(null);
                setSelectedSamplerId(allSamplers[0]?.id || '');
                setInitiativeWeight(1);
                setChatProbability(0.5);
                setMaximumChatStamina(5);
            }
        }
    }, [isOpen, existingCharacter, allSamplers]);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
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

        const newChar: Character = {
            id: existingCharacter ? existingCharacter.id : crypto.randomUUID(),
            name, description, systemPrompt,
            image: finalImageFilename,
            sampler: allSamplers.find(s => s.id === selectedSamplerId),
            initiativeWeight, chatProbability, maximumChatStamina,
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

    const labelStyle: React.CSSProperties = {
        fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-h)', display: 'block',
        marginBottom: '6px', letterSpacing: '0.5px', opacity: 0.8
    };

    const buttonStyle: React.CSSProperties = {
        padding: '8px 20px', fontSize: '0.85rem', fontWeight: 'bold', borderRadius: '6px',
        cursor: 'pointer', border: '1px solid transparent', fontFamily: 'inherit', transition: 'all 0.2s'
    };

    const compactInputStyle: React.CSSProperties = {
        ...inputStyle, padding: '5px 8px', fontSize: '0.8rem', textAlign: 'right'
    };

    const leftColumnWidth = '220px';

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

                            {/* ✅ Name: now uses flex-grow to stretch border lower and push Description down */}
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

                            {/* Description: pushed lower by Name's expanded flex share */}
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
                                style={{ ...inputStyle, fontFamily: 'monospace', minHeight: 0, height: '100%' }} 
                                placeholder="System prompt" disabled={isUploading}
                            />

                            {/* Sampler + Stats */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <select 
                                    value={selectedSamplerId} onChange={(e) => setSelectedSamplerId(e.target.value)}
                                    style={{ ...inputStyle, flexShrink: 0, opacity: isLoadingSamplers || isUploading ? 0.6 : 1, cursor: isLoadingSamplers || isUploading ? 'wait' : 'pointer' }}
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
                                        <input type="number" min="0" step="0.1" value={initiativeWeight} onChange={(e) => setInitiativeWeight(parseFloat(e.target.value) || 0)} style={compactInputStyle} disabled={isUploading} />
                                    </div>
                                    <div>
                                        <label style={{ ...labelStyle, fontSize: '0.65rem', marginBottom: '1px' }}>Chat Probability</label>
                                        <input type="number" min="0" max="1" step="0.05" value={chatProbability} onChange={(e) => setChatProbability(parseFloat(e.target.value) || 0)} style={compactInputStyle} disabled={isUploading} />
                                    </div>
                                    <div>
                                        <label style={{ ...labelStyle, fontSize: '0.65rem', marginBottom: '1px' }}>Maximum Chat Stamina</label>
                                        <input type="number" min="1" step="1" value={maximumChatStamina} onChange={(e) => setMaximumChatStamina(parseInt(e.target.value) || 1)} style={compactInputStyle} disabled={isUploading} />
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