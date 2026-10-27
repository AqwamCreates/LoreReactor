// src/frontend_src/components/ContextBar.tsx
import { useState } from 'react';
import type { viewMode } from './views/types';

interface ContextBarProps {
    viewMode: viewMode;
    onOpenInteractionDataList: () => void;
    onOpenCharacters: () => void;
    onOpenContexts: () => void;
    onOpenLocations: () => void;
    onOpenAudioTracks: () => void;
    onOpenWorlds: () => void;
    onOpenLanguageModels: () => void;
    onOpenSpatiotemporalModels: () => void;
    onOpenTokenSamplers: () => void;
    onOpenPromptBlocks: () => void;
    onOpenStopPatterns: () => void;
    onOpenRetrievalConfigurations: () => void;
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
    onOpenInteractionDataList, onOpenCharacters, onOpenContexts, onOpenLocations, onOpenAudioTracks, onOpenWorlds,
    onOpenPromptBlocks, onOpenLanguageModels, onOpenSpatiotemporalModels, onOpenTokenSamplers, onOpenStopPatterns, onOpenRetrievalConfigurations, onOpenBudgets, onOpenProfiles,
}: ContextBarProps) {
    const [expanded, setExpanded] = useState(false);

    if (viewMode !== 'ladder') return null;

    return (
        <div className={`context-bar ${expanded ? 'expanded' : ''}`}>
            {/* Extended configuration buttons (Top row) — solely tool buttons */}
            <div className="context-bar-extended-wrapper">
                <div className="context-bar-extended-row">
                    <NavButton icon="🧱" label="Prompt Blocks" onClick={onOpenPromptBlocks} />
                    <NavButton icon="🤖" label="Language Models" onClick={onOpenLanguageModels} />
                    <NavButton icon="🎨" label="Spatiotemporal Models" onClick={onOpenSpatiotemporalModels} />
                    <NavButton icon="🎚️" label="Token Samplers" onClick={onOpenTokenSamplers} />
                    <NavButton icon="🛑" label="Stop Patterns" onClick={onOpenStopPatterns} />
                    <NavButton icon="🧭" label="Retrieval Configurations" onClick={onOpenRetrievalConfigurations} />
                    <NavButton icon="💰" label="Budgets" onClick={onOpenBudgets} />
                    <NavButton icon="👤" label="Profiles" onClick={onOpenProfiles} />
                </div>
            </div>

            {/* Core narrative buttons (Bottom row) — always visible */}
            <div className="context-bar-core-row">
                <NavButton icon="💬" label="Chat List" onClick={onOpenInteractionDataList} />
                <NavButton icon="🎭" label="Characters" onClick={onOpenCharacters} />
                <NavButton icon="📜" label="Contexts" onClick={onOpenContexts} />
                <NavButton icon="📍" label="Locations" onClick={onOpenLocations} />
                <NavButton icon="🔊" label="Audio Tracks" onClick={onOpenAudioTracks} />
                <NavButton icon="🌍" label="Worlds" onClick={onOpenWorlds} />

                {/* Permanent Chevron Toggle at the bottom */}
                <button
                    type="button"
                    className={`nav-button nav-button-icon-only context-bar-toggle ${expanded ? 'context-bar-toggle-expanded' : ''}`}
                    onClick={() => setExpanded(prev => !prev)}
                    title={expanded ? 'Collapse advanced tools (▼)' : 'Expand advanced tools (▲)'}
                >
                    <span>{expanded ? '▼' : '▲'}</span>
                </button>
            </div>
        </div>
    );
}