// src/components/LoadingScreen.tsx
interface LoadStep { id: string; label: string; icon: string; done: boolean }

interface LoadingScreenProps {
    steps: LoadStep[];
    isFadeOut: boolean;
}

export function LoadingScreen({ steps, isFadeOut }: LoadingScreenProps) {
    const done = steps.filter(s => s.done).length;
    const current = steps.find(s => !s.done);

    return (
        <div className={`loading-screen ${isFadeOut ? 'fade-out' : ''}`}>
            <div className="loading-screen-title">⚛️ LoreReactor</div>

            <div className="loading-screen-grid">
                {steps.map(step => (
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