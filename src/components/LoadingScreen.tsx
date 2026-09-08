// src/components/LoadingScreen.tsx
import React from 'react';

interface LoadStep { id: string; label: string; icon: string; done: boolean }

interface LoadingScreenProps {
    steps: LoadStep[];
    isFadeOut: boolean;
}

export function LoadingScreen({ steps, isFadeOut }: LoadingScreenProps) {
    const done = steps.filter(s => s.done).length;
    const current = steps.find(s => !s.done);

    const mid = Math.ceil(steps.length / 2);
    const renderTopRow = [...steps.slice(0, mid)];
    const renderBottomRow = steps.slice(mid);

    return (
        <div className={`loading-screen ${isFadeOut ? 'fade-out' : ''}`}>
            <div className="loading-screen-title">⚛️ LoreReactor</div>

            <div className="loading-screen-row loading-screen-row-top">
                {renderTopRow.map(step => (
                    <div key={step.id} title={step.label} className={`loading-step-icon ${step.done ? 'done' : ''}`}>
                        {step.icon}
                    </div>
                ))}
            </div>

            <div className="loading-screen-row loading-screen-row-bottom">
                {renderBottomRow.map(step => (
                    <div key={step.id} title={step.label} className={`loading-step-icon ${step.done ? 'done' : ''}`}>
                        {step.icon}
                    </div>
                ))}
            </div>

            <div className="loading-screen-status">
                {current ? `Loading ${current.label.toLowerCase()}...` : 'Finalizing...'}
            </div>
            <div className="loading-screen-progress-track">
                <div className="loading-screen-progress-fill" style={{ width: `${(done / steps.length) * 100}%` }} />
            </div>
            <div className="loading-screen-counter">{done}/{steps.length}</div>
        </div>
    );
}