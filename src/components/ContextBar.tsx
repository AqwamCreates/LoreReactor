// src/components/ContextBar.tsx
import { useState } from 'react';

interface ContextBarProps {
    viewMode: 'ladder' | 'cinematic';
    onOpenChatList: () => void;
    onOpenCharacters: () => void;
    onOpenContexts: () => void;
    onOpenLocations: () => void;
    onOpenAudioTracks: () => void;
    onOpenWorlds: () => void;
    onOpenModels: () => void;
    onOpenSamplers: () => void;
    onOpenPromptBlocks: () => void;
    onOpenStopPatterns: () => void;
    onOpenBudgets: () => void;
    onOpenProfiles: () => void;
}

function NavButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
    return (
        <button type="button" className="nav-button nav-button-icon-only" onClick={onClick} title={label}>
            <span>{icon}</span>
        </button>
    );
}

export function ContextBar({
    viewMode,
    onOpenChatList, onOpenCharacters, onOpenContexts, onOpenLocations, onOpenAudioTracks, onOpenWorlds,
    onOpenPromptBlocks, onOpenModels, onOpenSamplers, onOpenStopPatterns, onOpenBudgets, onOpenProfiles,
}: ContextBarProps) {
    const [expanded, setExpanded] = useState(false);

    if (viewMode === 'cinematic') return null;

    return (
        <div className="context-bar">
            {/* Extended configuration buttons — above core, collapsible */}
            {expanded && (
                <div className="context-bar-extended-row">
                     <NavButton icon="🧱" label="Prompt Blocks" onClick={onOpenPromptBlocks} />
                    <NavButton icon="🤖" label="Language Models" onClick={onOpenModels} />
                    <NavButton icon="🎚️" label="Samplers" onClick={onOpenSamplers} />
                    <NavButton icon="🛑" label="Stop Patterns" onClick={onOpenStopPatterns} />
                    <NavButton icon="💰" label="Budgets" onClick={onOpenBudgets} />
                    <NavButton icon="👤" label="Profiles" onClick={onOpenProfiles} />
                    {/* Toggle lives here when expanded — takes up space in the extended row */}
                    <button
                        type="button"
                        className="nav-button nav-button-icon-only context-bar-toggle context-bar-toggle-expanded"
                        onClick={() => setExpanded(false)}
                        title="Hide advanced panels"
                    >
                        <span>⚙️</span>
                    </button>
                </div>
            )}

            {/* Core narrative buttons — always visible */}
            <div className="context-bar-core-row">
                <NavButton icon="💬" label="Chat List" onClick={onOpenChatList} />
                <NavButton icon="🎭" label="Characters" onClick={onOpenCharacters} />
                <NavButton icon="📜" label="Contexts" onClick={onOpenContexts} />
                <NavButton icon="📍" label="Locations" onClick={onOpenLocations} />
                <NavButton icon="🔊" label="Audio Tracks" onClick={onOpenAudioTracks} />
                <NavButton icon="🌍" label="Worlds" onClick={onOpenWorlds} />

                {/* Toggle only shown here when collapsed */}
                {!expanded && (
                    <button
                        type="button"
                        className="nav-button nav-button-icon-only context-bar-toggle"
                        onClick={() => setExpanded(true)}
                        title="Show advanced panels"
                    >
                        <span>⚙️</span>
                    </button>
                )}
            </div>
        </div>
    );
}