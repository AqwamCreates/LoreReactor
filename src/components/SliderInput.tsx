// src/components/SliderInput.tsx
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import './main.css';

interface SliderInputProps {
    label: string;
    value: number;
    minimumValue: number;
    maximumValue: number;
    stepValue: number;
    decimals?: number;
    onChange: (value: number) => void;
    description?: string;
    disabled?: boolean;
}

// Format number to remove trailing zeros
const formatNumber = (num: number, decimals: number): string => {
    if (decimals === 0) return String(num);
    const formatted = num.toFixed(decimals);
    // Remove trailing zeros and decimal point if no decimals needed
    return parseFloat(formatted).toString();
};

export function SliderInput({
    label,
    value,
    minimumValue: min,
    maximumValue: max,
    stepValue: step,
    decimals = 2,
    onChange,
    description,
    disabled = false,
}: SliderInputProps) {
    const [isDragging, setIsDragging] = useState(false);
    const sliderRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);

    const clampedValue = Math.max(min, Math.min(max, value));
    const steppedValue = Math.round(clampedValue / step) * step;
    const displayValue = Math.max(min, Math.min(max, steppedValue));
    const percentage = ((displayValue - min) / (max - min)) * 100;
    const formattedDisplay = formatNumber(displayValue, decimals);

    const handleSliderChange = (clientX: number) => {
        if (!sliderRef.current || disabled) return;
        
        const rect = sliderRef.current.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newValue = min + (max - min) * percent;
        const steppedValue = Math.round(newValue / step) * step;
        const clampedValue = Math.max(min, Math.min(max, steppedValue));
        
        onChange(clampedValue);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (disabled) return;
        setIsDragging(true);
        handleSliderChange(e.clientX);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (isDragging) {
            handleSliderChange(e.clientX);
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        if (disabled) return;
        setIsDragging(true);
        handleSliderChange(e.touches[0].clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
        if (isDragging) {
            handleSliderChange(e.touches[0].clientX);
        }
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            window.addEventListener('touchmove', handleTouchMove);
            window.addEventListener('touchend', handleTouchEnd);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
                window.removeEventListener('touchmove', handleTouchMove);
                window.removeEventListener('touchend', handleTouchEnd);
            };
        }
    }, [isDragging]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return;
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
            const clamped = Math.max(min, Math.min(max, val));
            const stepped = Math.round(clamped / step) * step;
            onChange(stepped);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        }
    };

    return (
        <div className="slider-input-container" style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '4px',
            width: '100%',
            opacity: disabled ? 0.6 : 1,
            cursor: disabled ? 'not-allowed' : 'default',
        }}>
            <div style={{ 
                display: 'flex', 
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: '8px',
            }}>
                <input
                    type="text"
                    value={formattedDisplay}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    style={{
                        width: '70px',
                        padding: '2px 6px',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                        borderRadius: '4px',
                        border: `1px solid ${disabled ? 'var(--border)' : 'var(--border)'}`,
                        background: disabled ? 'var(--social-bg)' : 'var(--bg)',
                        color: disabled ? 'var(--text-h)' : 'var(--text-h)',
                        textAlign: 'right',
                        outline: 'none',
                        flexShrink: 0,
                        opacity: disabled ? 0.5 : 1,
                        cursor: disabled ? 'not-allowed' : 'text',
                    }}
                />
            </div>
            
            <div
                ref={sliderRef}
                className="slider-track"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '6px',
                    borderRadius: '3px',
                    background: disabled ? 'var(--border)' : 'var(--border)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    touchAction: 'none',
                    userSelect: 'none',
                    opacity: disabled ? 0.5 : 1,
                }}
            >
                <div
                    className="slider-fill"
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        height: '100%',
                        borderRadius: '3px',
                        background: disabled ? 'var(--border)' : 'var(--accent)',
                        width: `${Math.min(100, Math.max(0, percentage))}%`,
                        transition: isDragging ? 'none' : 'width 0.1s ease',
                        opacity: disabled ? 0.3 : 1,
                    }}
                />
                <div
                    ref={thumbRef}
                    className="slider-thumb"
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: `${Math.min(100, Math.max(0, percentage))}%`,
                        transform: 'translate(-50%, -50%)',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        background: disabled ? 'var(--border)' : 'var(--accent)',
                        border: `2px solid ${disabled ? 'var(--bg)' : 'var(--bg)'}`,
                        boxShadow: disabled ? 'none' : '0 2px 4px rgba(0,0,0,0.2)',
                        transition: isDragging ? 'none' : 'left 0.1s ease',
                        cursor: disabled ? 'not-allowed' : 'grab',
                        opacity: disabled ? 0.3 : 1,
                    }}
                />
                {isDragging && (
                    <div
                        className="slider-tooltip"
                        style={{
                            position: 'absolute',
                            bottom: '20px',
                            left: `${Math.min(100, Math.max(0, percentage))}%`,
                            transform: 'translateX(-50%)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: 'var(--bg)',
                            border: '1px solid var(--border)',
                            fontSize: '0.7rem',
                            fontFamily: 'monospace',
                            color: 'var(--text-h)',
                            pointerEvents: 'none',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                            opacity: 1,
                        }}
                    >
                        {formattedDisplay}
                    </div>
                )}
            </div>
            
            {description && (
                <div style={{
                    fontSize: '0.6rem',
                    color: 'var(--text-h)',
                    opacity: disabled ? 0.3 : 0.5,
                    marginTop: '2px',
                }}>
                    {description}
                </div>
            )}
        </div>
    );
}