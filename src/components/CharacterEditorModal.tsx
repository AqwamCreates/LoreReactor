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
        } else {
            setName('');
            setDescription('');
            setSystemPrompt('');
            setFirstMessage('');
            setImageFile(null);
            setImagePreview(null);
            setSelectedSamplerId(allSamplers[0]?.id || '');
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

        // ✅ Upload new image through storage if one was selected
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
        name,
        description,
        systemPrompt,
        image: finalImageFilename,
        sampler: allSamplers.find(s => s.id === selectedSamplerId),
        initiativeWeight: 1,
        chatProbability: 0.5,
        maximumChatStamina: 5,
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
        padding: '10px 24px', fontSize: '0.9rem', fontWeight: 'bold', borderRadius: '6px',
        cursor: 'pointer', border: '1px solid transparent', fontFamily: 'inherit', transition: 'all 0.2s'
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px', maxHeight: '90vh' }}>
            <div className="modal-header">
            <h2>{existingCharacter ? 'Edit Character' : 'Create New Character'}</h2>
            <button type="button" className="close-btn" onClick={onClose}>×</button>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                
                {/* Left Column: Fixed width anchors it left, alignItems centers image within */}
                <div style={{ 
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
                width: '220px', flexShrink: 0, paddingTop: '4px'
                }}>
                <div 
                    style={{ 
                    position: 'relative', width: '180px', aspectRatio: '9/16', borderRadius: '12px',
                    overflow: 'hidden', border: imagePreview ? '2px solid var(--accent)' : '2px dashed var(--border)',
                    backgroundColor: 'var(--social-bg)', cursor: isUploading ? 'wait' : 'pointer', transition: 'border-color 0.2s',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', opacity: isUploading ? 0.7 : 1
                    }}
                    onClick={() => !isUploading && fileInputRef.current?.click()}
                    onMouseEnter={() => setIsHoveringImage(true)}
                    onMouseLeave={() => setIsHoveringImage(false)}
                >
                    <div style={{
                    width: '100%', height: '100%',
                    backgroundImage: imagePreview ? `url(${imagePreview})` : 'none',
                    backgroundSize: 'cover', backgroundPosition: 'center top',
                    }} />
                    
                    {!imagePreview && (
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '3rem', opacity: 0.3, pointerEvents: 'none'
                    }}>{isUploading ? '⏳' : '📷'}</div>
                    )}

                    {imagePreview && !isUploading && (
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.6)', display: isHoveringImage ? 'flex' : 'none',
                        alignItems: 'center', justifyContent: 'center', zIndex: 10
                    }}>
                        <button type="button" onClick={handleRemoveImage} style={{
                        background: 'transparent', border: 'none', color: '#ff4444', fontSize: '2rem',
                        cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }} title="Remove Picture">🗑️</button>
                    </div>
                    )}
                </div>
                
                <span style={{ 
                    marginTop: '10px', fontSize: '0.7rem', opacity: 0.6, textAlign: 'center', letterSpacing: '0.5px'
                }}>{isUploading ? 'Uploading...' : 'Click To Upload'}</span>

                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} disabled={isUploading} />
                </div>

                {/* Right Column */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', minWidth: '280px' }}>
                <div>
                    <label style={labelStyle}>Name *</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Character name" disabled={isUploading} />
                </div>
                
                <div>
                    <label style={labelStyle}>Description</label>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inputStyle, minHeight: '160px' }} placeholder="Describe the character's appearance and traits." disabled={isUploading} />
                </div>

                {/* Sampler Select with Loading State */}
                <div>
                    <label style={labelStyle}>Sampler</label>
                    <select 
                    value={selectedSamplerId} 
                    onChange={(e) => setSelectedSamplerId(e.target.value)}
                    style={{ ...inputStyle, opacity: isLoadingSamplers || isUploading ? 0.6 : 1, cursor: isLoadingSamplers || isUploading ? 'wait' : 'pointer' }}
                    disabled={isLoadingSamplers || isUploading}
                    >
                    {isLoadingSamplers && <option>Loading samplers...</option>}
                    {!isLoadingSamplers && allSamplers.length === 0 && <option>No samplers available</option>}
                    {!isLoadingSamplers && allSamplers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                    </select>
                </div>
                </div>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', width: '100%' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div>
                <label style={labelStyle}>System Prompt</label>
                <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} style={{ ...inputStyle, minHeight: '100px', fontFamily: 'monospace' }} placeholder="Hidden instructions for the AI." disabled={isUploading} />
                </div>
                <div>
                <label style={labelStyle}>First Message</label>
                <textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} style={{ ...inputStyle, minHeight: '80px' }} placeholder="The opening message of the chat." disabled={isUploading} />
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '10px' }}>
                <button type="button" className="edit-btn edit-btn-cancel" onClick={onClose} style={{ ...buttonStyle, background: 'transparent', color: 'var(--text-h)', border: '1px solid var(--border)' }} disabled={isUploading}>Cancel</button>
                <button type="button" className="edit-btn edit-btn-save" onClick={handleSubmit} style={{ ...buttonStyle, background: 'var(--accent)', color: '#fff', opacity: isUploading ? 0.7 : 1 }} disabled={isUploading}>
                    {isUploading ? 'Uploading...' : 'Save'}
                </button>
            </div>
            </div>
        </div>
        </div>
    );
}