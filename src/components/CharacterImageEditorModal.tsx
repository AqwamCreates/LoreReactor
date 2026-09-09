// src/components/CharacterImageEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { uploadCharacterImage, getCharacterImageUrl } from '../hooks/storage';
import './main.css';

const EMOTION_LABELS = [
    'neutral', 'admiration', 'amusement', 'anger', 'annoyance', 'approval',
    'caring', 'confusion', 'curiosity', 'desire', 'disappointment',
    'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
    'gratitude', 'grief', 'joy', 'love', 'nervousness',
    'optimism', 'pride', 'realization', 'relief', 'remorse',
    'sadness', 'surprise',
] as const;

type EmotionLabel = typeof EMOTION_LABELS[number];

interface CharacterImageEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    characterId: string;
    images: Record<string, string>;
    onSave: (images: Record<string, string>) => void;
}

export function CharacterImageEditorModal({
    isOpen,
    onClose,
    characterId,
    images,
    onSave,
}: CharacterImageEditorModalProps) {
    const [localImages, setLocalImages] = useState<Record<string, string>>({});
    const [uploadingEmotion, setUploadingEmotion] = useState<string | null>(null);
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    useEffect(() => {
        if (isOpen) {
            setLocalImages({ ...images });
        }
    }, [isOpen, images]);

    const handleFileChange = async (emotion: string, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';

        setUploadingEmotion(emotion);
        try {
            const filename = await uploadCharacterImage(characterId, file);
            setLocalImages(prev => ({ ...prev, [emotion]: filename }));
        } catch (err) {
            console.error(`Failed to upload ${emotion} image:`, err);
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

    // Sort: neutral first, then alphabetical
    const sortedEmotions: EmotionLabel[] = [
        'neutral',
        ...EMOTION_LABELS.filter(e => e !== 'neutral').sort(),
    ];

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Character Emotion Images</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose} disabled={!!uploadingEmotion}>Cancel</button>
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSave} disabled={!!uploadingEmotion}>Save</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    <div className="context-binding-hint" style={{ marginBottom: '12px' }}>
                        Upload character expressions for sentiment-driven image swapping. The main character image maps to "neutral". Missing emotions fall back to neutral automatically. Recommended aspect ratio: 9:16.
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
                                            {!isUploading && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemove(emotion)}
                                                    className="editor-image-remove-btn"
                                                    title={`Remove ${emotion} image`}
                                                >×</button>
                                            )}
                                        </div>
                                    ) : (
                                        <div
                                            className={`editor-image-square editor-upload-square ${isUploading ? 'disabled' : ''}`}
                                            onClick={() => !isUploading && fileInputRefs.current[emotion]?.click()}
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
                                        disabled={isUploading}
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