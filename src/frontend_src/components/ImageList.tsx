// src/frontend_src/components/ImageList.tsx
import type React from 'react';
import { useRef } from 'react';
import '../main.css';

export type ImageEntry = 
    | { type: 'existing'; filename: string; previewUrl: string }
    | { type: 'staged'; file: File; previewUrl: string };

interface ImageListProps {
    images: ImageEntry[];
    isUploading?: boolean;
    isReadOnly?: boolean;
    onRemoveImage: (index: number) => void;
    onReorderImages?: (fromIndex: number, toIndex: number) => void;
    onFilesAdded: (files: File[]) => void;
}

export function ImageList({
    images,
    isUploading = false,
    isReadOnly = false,
    onRemoveImage,
    onReorderImages,
    onFilesAdded
}: ImageListProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onFilesAdded(Array.from(e.target.files));
        }
        e.target.value = '';
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        if (!onReorderImages || isReadOnly) return;
        e.dataTransfer.setData('text/plain', String(index));
        e.dataTransfer.setData('application/x-image-reorder', 'true');
    };

    const handleDrop = (e: React.DragEvent, toIndex: number) => {
        e.preventDefault();
        e.stopPropagation();
        if (!onReorderImages || isReadOnly) return;
        
        const isReorder = e.dataTransfer.getData('application/x-image-reorder');
        if (isReorder) {
            const fromIdx = Number(e.dataTransfer.getData('text/plain'));
            onReorderImages(fromIdx, toIndex);
        }
    };

    return (
        <div className="editor-image-grid">
            {images.map((entry, index) => (
                <div 
                    key={`${entry.previewUrl}-${index}`} 
                    className="editor-image-square active" 
                    draggable={!isReadOnly && !!onReorderImages}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, index)}
                    style={{ position: 'relative', cursor: (!isReadOnly && !!onReorderImages) ? 'grab' : 'default' }}
                >
                    <img src={entry.previewUrl} alt={`Image ${index + 1}`} style={{ pointerEvents: 'none' }} />
                    {!isReadOnly && (
                        <button type="button" onClick={() => onRemoveImage(index)} className="editor-image-remove-button">
                            ×
                        </button>
                    )}
                </div>
            ))}
            <div 
                className={`editor-image-square editor-upload-square ${(isUploading || isReadOnly) ? 'disabled' : ''}`} 
                onClick={() => !(isUploading || isReadOnly) && fileInputRef.current?.click()}
            >
                <div className="context-image-placeholder">
                    <div className="context-image-placeholder-icon">{isUploading ? '⏳' : '📷'}</div>
                    <div className="context-image-placeholder-text">{isUploading ? 'Uploading...' : 'Upload'}</div>
                </div>
            </div>
            <input 
                ref={fileInputRef} 
                type="file" 
                accept="image/*" 
                multiple 
                hidden 
                onChange={handleImageChange} 
                disabled={isUploading || isReadOnly} 
            />
        </div>
    );
}