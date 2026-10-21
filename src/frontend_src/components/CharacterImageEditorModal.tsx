// src/frontend_src/components/CharacterImageEditorModal.tsx
import type React from 'react';
import { useState, useRef, useMemo } from 'react';
import { uploadCharacterImage, getCharacterImageUrl } from '../storages/serverStorage';
import { FileDropArea } from './FileDropArea';
import '../main.css';
import { emotions } from '../dictionaries/characterPresets';

interface CharacterImageEditorModalProps {
    isReadOnly?: boolean;
    onClose: () => void;
    characterId: string;
    images: Record<string, string>;
    onSave: (images: Record<string, string>) => void;
}

export function CharacterImageEditorModal({
    characterId,
    images,
    onClose,
    onSave,
    isReadOnly = false,
}: CharacterImageEditorModalProps) {
    const [localImages, setLocalImages] = useState<Record<string, string>>({ ...images });
    const [uploadingEmotion, setUploadingEmotion] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    const uploadImageForEmotion = async (emotion: string, file: File) => {
        setUploadError(null);
        setUploadingEmotion(emotion);
        try {
            const filename = await uploadCharacterImage(characterId, file);
            setLocalImages(prev => ({ ...prev, [emotion]: filename }));
        } catch (error) {
            console.error(`Failed to upload ${emotion} image:`, error);
            setUploadError(`Failed to upload "${emotion}" image.`);
        } finally {
            setUploadingEmotion(null);
        }
    };

    const handleFileChange = (emotion: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        uploadImageForEmotion(emotion, file);
    };

    const handleDropImage = (emotion: string, file: File) => {
        uploadImageForEmotion(emotion, file);
    };

    const handleRemove = (emotion: string) => {
        setLocalImages(prev => {
            const next = { ...prev };
            delete next[emotion];
            return next;
        });
    };

    const handleSave = () => {
        onSave(localImages);
        onClose();
    };

    // Combine predefined dictionary emotions with any custom imported emotions
    const sortedEmotions = useMemo(() => {
        const extraEmotions = Object.keys(localImages).filter(
            k => !emotions.includes(k as any) && k !== 'neutral'
        );

        return [
            'neutral',
            ...emotions.filter(e => e !== 'neutral').sort(),
            ...extraEmotions.sort(),
        ];
    }, [localImages]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{isReadOnly ? 'View Emotion Images' : 'Character Emotion Images'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose} disabled={!!uploadingEmotion}>
                            {isReadOnly ? 'Close' : 'Cancel'}
                        </button>
                        {!isReadOnly && (
                            <button type="button" className="editor-button editor-button-save" onClick={handleSave} disabled={!!uploadingEmotion}>Save</button>
                        )}
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {uploadError && (
                        <div className="editor-error-message" style={{ marginBottom: '10px', textAlign: 'center' }}>
                            {uploadError}
                        </div>
                    )}

                    <div className="context-binding-hint" style={{ marginBottom: '12px' }}>
                        {isReadOnly ? 'Character expressions used' : 'Upload character expressions'} for sentiment-driven image swapping. The main character image maps to "neutral". Missing emotions fall back to neutral automatically.{!isReadOnly && ' Recommended aspect ratio: 9:16.'}
                    </div>

                    <div className="editor-image-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px', boxSizing: 'border-box' }}>
                        {sortedEmotions.map(emotion => {
                            const filename = localImages[emotion];
                            const previewUrl = filename ? getCharacterImageUrl(characterId, filename) : null;
                            const isUploading = uploadingEmotion === emotion;

                            return (
                                <div key={emotion} className="context-field-group" style={{ margin: 0, minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
                                    <label className="editor-label editor-label-small" style={{ textAlign: 'center', textTransform: 'capitalize', fontSize: '0.65rem' }}>
                                        {emotion}
                                    </label>

                                    <div style={{ position: 'relative', width: '100%', aspectRatio: '9 / 16', borderRadius: '8px', overflow: 'hidden', boxSizing: 'border-box' }}>
                                        <FileDropArea
                                            acceptedTypes={['image']}
                                            disabled={!!uploadingEmotion || isReadOnly}
                                            onDropImage={file => handleDropImage(emotion, file)}
                                            overlayTitle=""
                                            overlaySubtitle=""
                                        >
                                            {previewUrl ? (
                                                <div 
                                                    className="editor-image-square editor-image-portrait active" 
                                                    style={{ 
                                                        position: 'relative', 
                                                        width: '100%', 
                                                        height: '100%', 
                                                        boxSizing: 'border-box', 
                                                        aspectRatio: '9 / 16',
                                                        margin: 0 
                                                    }}
                                                >
                                                    <img src={previewUrl} alt={emotion} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                                                    {!isUploading && !isReadOnly && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRemove(emotion);
                                                            }}
                                                            className="editor-image-remove-button"
                                                            title={`Remove ${emotion} image`}
                                                        >×</button>
                                                    )}
                                                </div>
                                            ) : (
                                                <div
                                                    className={`editor-image-square editor-upload-square editor-image-portrait ${(isUploading || isReadOnly || !!uploadingEmotion) ? 'disabled' : ''}`}
                                                    onClick={() => !(isUploading || isReadOnly || !!uploadingEmotion) && fileInputRefs.current[emotion]?.click()}
                                                    style={{ 
                                                        position: 'relative',
                                                        width: '100%', 
                                                        height: '100%', 
                                                        boxSizing: 'border-box', 
                                                        aspectRatio: '9 / 16',
                                                        margin: 0 
                                                    }}
                                                >
                                                    <div className="context-image-placeholder">
                                                        <div className="context-image-placeholder-icon">{isUploading ? '⏳' : '+'}</div>
                                                    </div>
                                                </div>
                                            )}
                                        </FileDropArea>
                                    </div>

                                    <input
                                        ref={el => { fileInputRefs.current[emotion] = el; }}
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        onChange={e => handleFileChange(emotion, e)}
                                        disabled={!!uploadingEmotion || isReadOnly}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}