// src/frontend_src/components/FileDropArea.tsx
import type React from 'react';
import { useState, useRef, useEffect } from 'react';

interface FileDropAreaProps {
    onDropImage?: (file: File) => void;
    onDropImages?: (files: File[]) => void;
    onDropAudio?: (file: File) => void;
    onDropFile?: (file: File) => void;
    acceptedTypes?: ('image' | 'audio')[];
    disabled?: boolean;
    children: React.ReactNode;
    overlayTitle?: string;
    overlaySubtitle?: string;
    className?: string;
    style?: React.CSSProperties;
}

export function FileDropArea({
    onDropImage,
    onDropImages,
    onDropAudio,
    onDropFile,
    acceptedTypes = ['image', 'audio'],
    disabled = false,
    children,
    overlayTitle = 'Drop File to Assign',
    overlaySubtitle = 'Drop images or audio files here',
    className,
    style,
}: FileDropAreaProps) {
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateDimensions = (w: number, h: number) => {
            setDimensions({ width: w, height: h });
        };

        const rect = el.getBoundingClientRect();
        updateDimensions(rect.width, rect.height);

        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                updateDimensions(width, height);
            }
        });

        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Helper to check if the drag item is an actual OS file (not an internal DOM element)
    const isOsFileDrag = (e: React.DragEvent) => {
        const types = e.dataTransfer?.types;
        if (!types) return false;
        return typeof types.contains === 'function' ? types.contains('Files') : Array.from(types).includes('Files');
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled || !isOsFileDrag(e)) return;

        if (!isDragging) {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setDimensions({ width: rect.width, height: rect.height });
            }
            setIsDragging(true);
        }
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        
        if (disabled || !isOsFileDrag(e)) return;

        const files = Array.from(e.dataTransfer.files || []);
        if (files.length === 0) return;

        const imageFiles = files.filter(f => f.type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].some(ext => f.name.toLowerCase().endsWith(ext)));
        const audioFiles = files.filter(f => f.type.startsWith('audio/') || ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'].some(ext => f.name.toLowerCase().endsWith(ext)));

        if (imageFiles.length > 0 && acceptedTypes.includes('image')) {
            onDropImages?.(imageFiles);
            onDropImage?.(imageFiles[0]);
        }
        if (audioFiles.length > 0 && acceptedTypes.includes('audio')) {
            onDropAudio?.(audioFiles[0]);
        }
        if (imageFiles.length === 0 && audioFiles.length === 0) {
            onDropFile?.(files[0]);
        }
    };

    // Calculate dynamic scaling based on current container dimensions
    const width = dimensions.width || 300;
    const height = dimensions.height || 300;
    const minDim = Math.min(width, height);

    // Scale from 0.35 (for small ~90px cards) up to 1.0 (for >=350px full containers)
    const scale = Math.min(1, Math.max(0.35, minDim / 350));

    const iconFontSize = `${Math.max(1.2, 4 * scale)}rem`;
    const titleFontSize = `${Math.max(0.65, 1.4 * scale)}rem`;
    const subtitleFontSize = `${Math.max(0.55, 0.9 * scale)}rem`;
    const gap = `${Math.max(4, Math.round(16 * scale))}px`;
    const padding = `${Math.max(4, Math.round(16 * scale))}px`;
    const borderWidth = `${Math.max(1.5, Math.round(3 * scale * 10) / 10)}px`;
    const borderRadius = `${Math.max(4, Math.round(12 * scale))}px`;
    const showSubtitle = Boolean(overlaySubtitle) && height >= 120 && width >= 90;

    return (
        <div 
            ref={containerRef}
            className={className}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{ 
                position: 'relative', 
                width: '100%', 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column', 
                minWidth: 0, 
                minHeight: 0,
                flex: 1,
                overflow: 'hidden',
                boxSizing: 'border-box',
                ...style
            }}
        >
            {isDragging && !disabled && (
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(4px)',
                    WebkitBackdropFilter: 'blur(4px)',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap,
                    padding,
                    border: `${borderWidth} dashed var(--accent)`,
                    borderRadius,
                    pointerEvents: 'none',
                    boxSizing: 'border-box',
                    overflow: 'hidden'
                }}>
                    <div style={{ fontSize: iconFontSize, lineHeight: 1, userSelect: 'none' }}>📥</div>
                    {overlayTitle && (
                        <h2 style={{ 
                            margin: 0, 
                            color: '#fff', 
                            fontSize: titleFontSize, 
                            lineHeight: 1.2,
                            textAlign: 'center',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            padding: '0 4px',
                            boxSizing: 'border-box'
                        }}>
                            {overlayTitle}
                        </h2>
                    )}
                    {showSubtitle && (
                        <p style={{ 
                            margin: 0, 
                            fontSize: subtitleFontSize, 
                            color: 'rgba(255,255,255,0.7)',
                            textAlign: 'center',
                            lineHeight: 1.2,
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            padding: '0 4px',
                            boxSizing: 'border-box'
                        }}>
                            {overlaySubtitle}
                        </p>
                    )}
                </div>
            )}
            {children}
        </div>
    );
}