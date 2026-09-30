// src/components/CharacterImageEditorModal.tsx
import type React from 'react';
import { useState, useRef, useMemo } from 'react';
import { uploadCharacterImage, getCharacterImageUrl } from '../storages/serverStorage';
import '../main.css';
import { emotions } from '../dictionaries/characterPresets';

interface CharacterImageEditorModalProps {
    isReadOnly?: boolean;
    onClose: () => void;
    characterId: string;
    images: Record<string, string>;
    onSave: (images: Record<string, string>) => void;
}

function CharacterImageEditorContent({
    characterId,
    images,
    onClose,
    onSave,
    isReadOnly = false,
}: {
    characterId: string;
    images: Record<string, string>;
    onClose: () => void;
    onSave: (images: Record<string, string>) => void;
    isReadOnly?: boolean;
}) {
    const [localImages, setLocalImages] = useState<Record<string, string>>({ ...images });
    const [uploadingEmotion, setUploadingEmotion] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    const handleFileChange = async (emotion: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
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

                    <div className="editor-image-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                        {sortedEmotions.map(emotion => {
                            const filename = localImages[emotion];
                            const previewUrl = filename ? getCharacterImageUrl(characterId, filename) : null;
                            const isUploading = uploadingEmotion === emotion;

                            return (
                                <div key={emotion} className="context-field-group" style={{ margin: 0 }}>
                                    <label className="editor-label editor-label-small" style={{ textAlign: 'center', textTransform: 'capitalize', fontSize: '0.65rem' }}>
                                        {emotion}
                                    </label>

                                    {previewUrl ? (
                                        <div className="editor-image-square active" style={{ position: 'relative', aspectRatio: '9 / 16' }}>
                                            <img src={previewUrl} alt={emotion} style={{ objectFit: 'cover' }} />
                                            {!isUploading && !isReadOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemove(emotion)}
                                                    className="editor-image-remove-button"
                                                    title={`Remove ${emotion} image`}
                                                >×</button>
                                            )}
                                        </div>
                                    ) : (
                                        <div
                                            className={`editor-image-square editor-upload-square ${(isUploading || isReadOnly) ? 'disabled' : ''}`}
                                            onClick={() => !(isUploading || isReadOnly) && fileInputRefs.current[emotion]?.click()}
                                            style={{ aspectRatio: '9 / 16' }}
                                        >
                                            <div className="context-image-placeholder">
                                                <div className="context-image-placeholder-icon">{isUploading ? '⏳' : '+'}</div>
                                            </div>
                                        </div>
                                    )}

                                    <input
                                        ref={el => { fileInputRefs.current[emotion] = el; }}
                                        type="file"
                                        accept="image/*"
                                        hidden
                                        onChange={e => handleFileChange(emotion, e)}
                                        disabled={isUploading || isReadOnly}
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

export function CharacterImageEditorModal({
    
    isReadOnly = false,
    onClose,
    characterId,
    images,
    onSave,
}: CharacterImageEditorModalProps) {

    return (
        <CharacterImageEditorContent
            key={`${characterId}-${JSON.stringify(images)}`}
            characterId={characterId}
            images={images}
            onClose={onClose}
            onSave={onSave}
            isReadOnly={isReadOnly}
        />
    );
}