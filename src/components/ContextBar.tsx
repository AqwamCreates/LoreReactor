// src/components/ContextBar.tsx
interface ContextBarProps {
    viewMode: 'ladder' | 'cinematic';
    onOpenChatList: () => void;
    onOpenCharacters: () => void;
    onOpenContexts: () => void;
    onOpenLocations: () => void;
    onOpenWorlds: () => void;
    onOpenModels: () => void;
    onOpenSamplers: () => void;
    onOpenStopPatterns: () => void;
    onOpenBudgets: () => void;
    onOpenProfiles: () => void;
}

function NavButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
    return (
        <button type="button" className="nav-btn nav-btn-icon-only" onClick={onClick} title={label}>
            <span>{icon}</span>
        </button>
    );
}

export function ContextBar({
    viewMode,
    onOpenChatList, onOpenCharacters, onOpenContexts, onOpenLocations, onOpenWorlds,
    onOpenModels, onOpenSamplers, onOpenStopPatterns, onOpenBudgets, onOpenProfiles,
}: ContextBarProps) {
    if (viewMode === 'cinematic') return null;

    return (
        <div className="context-bar" style={{ display: 'flex' }}>
            <NavButton icon="💬" label="Chat List" onClick={onOpenChatList} />
            <NavButton icon="🎭" label="Characters" onClick={onOpenCharacters} />
            <NavButton icon="📜" label="Contexts" onClick={onOpenContexts} />
            <NavButton icon="📍" label="Locations" onClick={onOpenLocations} />
            <NavButton icon="🌍" label="Worlds" onClick={onOpenWorlds} />
            <NavButton icon="🤖" label="Models" onClick={onOpenModels} />
            <NavButton icon="🎚️" label="Samplers" onClick={onOpenSamplers} />
            <NavButton icon="🛑" label="Stop Patterns" onClick={onOpenStopPatterns} />
            <NavButton icon="💰" label="Budgets" onClick={onOpenBudgets} />
            <NavButton icon="👤" label="Profiles" onClick={onOpenProfiles} />
        </div>
    );
}