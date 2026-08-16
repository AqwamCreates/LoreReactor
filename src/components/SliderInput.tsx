// src/components/SliderInput.tsx
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import './main.css';

interface SliderInputProps {
    label: string;
    value: number;
    minimumValue?: number;
    maximumValue?: number;
    stepValue?: number;
    decimals?: number;
    onChange: (value: number) => void;
    description?: string;
    disabled?: boolean;
}

// Format number to remove trailing zeros
const formatNumber = (num: number, decimals: number): string => {
    if (decimals === 0) return String(num);
    const formatted = num.toFixed(decimals);
    return Number.parseFloat(formatted).toString();
};

export function SliderInput({
    label,
    value,
    minimumValue: min,
    maximumValue: max,
    stepValue: step = 1,
    decimals = 2,
    onChange,
    description,
    disabled = false,
}: SliderInputProps) {
    const [isDragging, setIsDragging] = useState(false);
    const sliderRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);

    // Check if we have a valid range (both min and max are defined and min < max)
    const hasValidRange = min !== undefined && max !== undefined && min < max;
    
    // If no range, treat as free input (no slider, just number input)
    const isFreeInput = !hasValidRange;

    // For sliders with range
    const clampedValue = hasValidRange ? Math.max(min!, Math.min(max!, value)) : value;
    const steppedValue = hasValidRange ? Math.round(clampedValue / step) * step : value;
    const displayValue = hasValidRange ? Math.max(min!, Math.min(max!, steppedValue)) : value;
    const percentage = hasValidRange ? ((displayValue - min!) / (max! - min!)) * 100 : 0;
    const formattedDisplay = formatNumber(displayValue, decimals);

    const handleSliderChange = (clientX: number) => {
        if (!sliderRef.current || disabled || isFreeInput) return;
        
        const rect = sliderRef.current.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newValue = min! + (max! - min!) * percent;
        const steppedVal = Math.round(newValue / step) * step;
        const clampedVal = Math.max(min!, Math.min(max!, steppedVal));
        
        onChange(clampedVal);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (disabled || isFreeInput) return;
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
        if (disabled || isFreeInput) return;
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
            if (hasValidRange) {
                const clamped = Math.max(min!, Math.min(max!, val));
                const stepped = Math.round(clamped / step) * step;
                onChange(stepped);
            } else {
                onChange(val);
            }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        }
    };

    // ✅ Shared header row: label left, number input right, baseline-aligned
    const headerRow = (
        <div className="slider-header-row">
            {label && (
                <span className="editor-label slider-label">
                    {label}
                </span>
            )}
            <input
                type="number"
                value={formattedDisplay}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                step={step}
                className={`slider-number-input ${isFreeInput ? 'slider-number-input-full' : ''}`}
                style={{
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? 'not-allowed' : 'text',
                }}
            />
        </div>
    );

    // ✅ FREE INPUT MODE
    if (isFreeInput) {
        return (
            <div className="slider-input-container" style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '4px',
                width: '100%',
                opacity: disabled ? 0.6 : 1,
                cursor: disabled ? 'not-allowed' : 'default',
            }}>
                {headerRow}
                {description && (
                    <div className="slider-description" style={{
                        opacity: disabled ? 0.3 : 0.5,
                    }}>
                        {description}
                    </div>
                )}
            </div>
        );
    }

    // ✅ FULL SLIDER MODE
    return (
        <div className="slider-input-container" style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '4px',
            width: '100%',
            opacity: disabled ? 0.6 : 1,
            cursor: disabled ? 'not-allowed' : 'default',
        }}>
            {headerRow}
            
            <div
                ref={sliderRef}
                className="slider-track"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                style={{
                    position: 'relative',
                    width: '100%',
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
                        borderRadius: '4px',
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
                            bottom: '24px',
                            left: `${Math.min(100, Math.max(0, percentage))}%`,
                            transform: 'translateX(-50%)',
                            pointerEvents: 'none',
                            whiteSpace: 'nowrap',
                            opacity: 1,
                        }}
                    >
                        {formattedDisplay}
                    </div>
                )}
            </div>
            
            {description && (
                <div className="slider-description" style={{
                    opacity: disabled ? 0.3 : 0.5,
                }}>
                    {description}
                </div>
            )}
        </div>
    );
}