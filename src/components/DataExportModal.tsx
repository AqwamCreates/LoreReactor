// src/components/DataExportModal.tsx
import { useState } from 'react';
import type { Character, Context, Location, AudioTrack, World, LanguageModel, Sampler, PromptBlock, StopPattern, BudgetStrategy, Profile, Memory, RawInteractionData } from '../types';
import { exportSelectedData, type LoreReactorExport } from '../services/DataPortabilityEngine';
import { EntitySelectList } from './EntitySelectList';
import '../main.css';

interface DataExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allModels: LanguageModel[];
    allSamplers: Sampler[];
    allPromptBlocks: PromptBlock[];
    allStopPatterns: StopPattern[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allMemories: Memory[];
    rawChatShells: RawInteractionData[];
}

export function DataExportModal({
    isOpen, onClose,
    allCharacters, allContexts, allLocations, allAudioTracks,
    allWorlds, allModels, allSamplers, allPromptBlocks, allStopPatterns,
    allBudgetStrategies, allProfiles, allMemories, rawChatShells,
}: DataExportModalProps) {
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<LoreReactorExport | null>(null);

    const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
    const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
    const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
    const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
    const [selectedAudioTrackIds, setSelectedAudioTrackIds] = useState<string[]>([]);
    const [selectedWorldIds, setSelectedWorldIds] = useState<string[]>([]);
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [selectedSamplerIds, setSelectedSamplerIds] = useState<string[]>([]);
    const [selectedPromptBlockIds, setSelectedPromptBlockIds] = useState<string[]>([]);
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>([]);
    const [selectedBudgetStrategyIds, setSelectedBudgetStrategyIds] = useState<string[]>([]);
    const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
    const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
    const [includeActions, setIncludeActions] = useState(true);

    const [chatSearch, setChatSearch] = useState('');
    const [characterSearch, setCharacterSearch] = useState('');
    const [contextSearch, setContextSearch] = useState('');
    const [locationSearch, setLocationSearch] = useState('');
    const [audioTrackSearch, setAudioTrackSearch] = useState('');
    const [worldSearch, setWorldSearch] = useState('');
    const [modelSearch, setModelSearch] = useState('');
    const [samplerSearch, setSamplerSearch] = useState('');
    const [promptBlockSearch, setPromptBlockSearch] = useState('');
    const [stopPatternSearch, setStopPatternSearch] = useState('');
    const [budgetStrategySearch, setBudgetStrategySearch] = useState('');
    const [profileSearch, setProfileSearch] = useState('');
    const [memorySearch, setMemorySearch] = useState('');

    const reset = () => {
        setSummary(null); setError(null); setIsExporting(false);
        setSelectedChatIds([]); setSelectedCharacterIds([]); setSelectedContextIds([]);
        setSelectedLocationIds([]); setSelectedAudioTrackIds([]); setSelectedWorldIds([]);
        setSelectedModelIds([]); setSelectedSamplerIds([]); setSelectedPromptBlockIds([]);
        setSelectedStopPatternIds([]); setSelectedBudgetStrategyIds([]); setSelectedProfileIds([]);
        setSelectedMemoryIds([]);
        setIncludeActions(true);
        setChatSearch(''); setCharacterSearch(''); setContextSearch(''); setLocationSearch('');
        setAudioTrackSearch(''); setWorldSearch(''); setModelSearch(''); setSamplerSearch('');
        setPromptBlockSearch(''); setStopPatternSearch(''); setBudgetStrategySearch(''); setProfileSearch('');
        setMemorySearch('');
    };

    const handleClose = () => { if (isExporting) return; reset(); onClose(); };

    const toggle = (_ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const totalSelected = selectedChatIds.length + selectedCharacterIds.length + selectedContextIds.length +
        selectedLocationIds.length + selectedAudioTrackIds.length + selectedWorldIds.length +
        selectedModelIds.length + selectedSamplerIds.length + selectedPromptBlockIds.length +
        selectedStopPatternIds.length + selectedBudgetStrategyIds.length + selectedProfileIds.length +
        selectedMemoryIds.length + (includeActions ? 1 : 0);

    const handleExport = async () => {
        if (totalSelected === 0) { setError('Select at least one item to export.'); return; }
        setIsExporting(true); setError(null); setSummary(null);

        try {
            const data = await exportSelectedData({
                chatIds: selectedChatIds,
                characterIds: selectedCharacterIds, contextIds: selectedContextIds, locationIds: selectedLocationIds,
                audioTrackIds: selectedAudioTrackIds, worldIds: selectedWorldIds, modelIds: selectedModelIds,
                samplerIds: selectedSamplerIds, promptBlockIds: selectedPromptBlockIds,
                stopPatternIds: selectedStopPatternIds, budgetStrategyIds: selectedBudgetStrategyIds,
                profileIds: selectedProfileIds, memoryIds: selectedMemoryIds, includeActions,
            });
            setSummary(data);

            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.href = url; a.download = `LoreReactor_Export_${timestamp}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            setError(`Export failed: ${(error as Error).message}`);
        } finally { setIsExporting(false); }
    };

    if (!isOpen) return null;

    const validChatShells = rawChatShells.filter((s): s is RawInteractionData & { id: string } => !!s.id);

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Export Data</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={handleClose} disabled={isExporting}>
                            {summary ? 'Close' : 'Cancel'}
                        </button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {error && <div className="editor-error-message editor-error-centered">{error}</div>}

                    {!summary && !isExporting && (
                        <>
                            <div className="editor-section">
                                <span className="editor-section-title">Select Items to Export</span>
                                <div className="entity-ref-hint">Click items to select/deselect. Only selected items will be included in the export.</div>

                                <EntitySelectList label="Chat Sessions" items={validChatShells} selectedIds={selectedChatIds}
                                    onToggle={(id) => toggle(selectedChatIds, setSelectedChatIds, id)} searchQuery={chatSearch} onSearchChange={setChatSearch} />
                                <EntitySelectList label="Characters" items={allCharacters} selectedIds={selectedCharacterIds}
                                    onToggle={(id) => toggle(selectedCharacterIds, setSelectedCharacterIds, id)} searchQuery={characterSearch} onSearchChange={setCharacterSearch} />
                                <EntitySelectList label="Contexts" items={allContexts} selectedIds={selectedContextIds}
                                    onToggle={(id) => toggle(selectedContextIds, setSelectedContextIds, id)} searchQuery={contextSearch} onSearchChange={setContextSearch} />
                                <EntitySelectList label="Locations" items={allLocations} selectedIds={selectedLocationIds}
                                    onToggle={(id) => toggle(selectedLocationIds, setSelectedLocationIds, id)} searchQuery={locationSearch} onSearchChange={setLocationSearch} />
                                <EntitySelectList label="Audio Tracks" items={allAudioTracks} selectedIds={selectedAudioTrackIds}
                                    onToggle={(id) => toggle(selectedAudioTrackIds, setSelectedAudioTrackIds, id)} searchQuery={audioTrackSearch} onSearchChange={setAudioTrackSearch} />
                                <EntitySelectList label="Worlds" items={allWorlds} selectedIds={selectedWorldIds}
                                    onToggle={(id) => toggle(selectedWorldIds, setSelectedWorldIds, id)} searchQuery={worldSearch} onSearchChange={setWorldSearch} />
                                <EntitySelectList label="Language Models" items={allModels} selectedIds={selectedModelIds}
                                    onToggle={(id) => toggle(selectedModelIds, setSelectedModelIds, id)} searchQuery={modelSearch} onSearchChange={setModelSearch} />
                                <EntitySelectList label="Samplers" items={allSamplers} selectedIds={selectedSamplerIds}
                                    onToggle={(id) => toggle(selectedSamplerIds, setSelectedSamplerIds, id)} searchQuery={samplerSearch} onSearchChange={setSamplerSearch} />
                                <EntitySelectList label="Prompt Blocks" items={allPromptBlocks} selectedIds={selectedPromptBlockIds}
                                    onToggle={(id) => toggle(selectedPromptBlockIds, setSelectedPromptBlockIds, id)} searchQuery={promptBlockSearch} onSearchChange={setPromptBlockSearch} />
                                <EntitySelectList label="Stop Patterns" items={allStopPatterns} selectedIds={selectedStopPatternIds}
                                    onToggle={(id) => toggle(selectedStopPatternIds, setSelectedStopPatternIds, id)} searchQuery={stopPatternSearch} onSearchChange={setStopPatternSearch} />
                                <EntitySelectList label="Budget Strategies" items={allBudgetStrategies} selectedIds={selectedBudgetStrategyIds}
                                    onToggle={(id) => toggle(selectedBudgetStrategyIds, setSelectedBudgetStrategyIds, id)} searchQuery={budgetStrategySearch} onSearchChange={setBudgetStrategySearch} />
                                <EntitySelectList label="Profiles" items={allProfiles} selectedIds={selectedProfileIds}
                                    onToggle={(id) => toggle(selectedProfileIds, setSelectedProfileIds, id)} searchQuery={profileSearch} onSearchChange={setProfileSearch} />
                                <EntitySelectList label="Memories" items={allMemories} selectedIds={selectedMemoryIds}
                                    onToggle={(id) => toggle(selectedMemoryIds, setSelectedMemoryIds, id)} searchQuery={memorySearch} onSearchChange={setMemorySearch} />

                                <label className="editor-checkbox-label" style={{ marginTop: '8px' }}>
                                    <input type="checkbox" checked={includeActions} onChange={e => setIncludeActions(e.target.checked)} className="editor-checkbox-input" />
                                    <span>Include Interjectable Actions</span>
                                </label>
                            </div>

                            <button type="button" className="editor-button editor-button-save entity-generate-button"
                                onClick={handleExport} disabled={totalSelected === 0}>
                                ⬇️ Export {totalSelected > 0 ? `${totalSelected} Selected` : ''}
                            </button>
                            {error && <div className="editor-error-message editor-error-centered entity-error-below">{error}</div>}
                        </>
                    )}

                    {isExporting && (
                        <div className="entity-loading-state">
                            <div className="entity-loading-icon">⏳</div>
                            <div className="entity-loading-text">Collecting and packaging selected data...</div>
                        </div>
                    )}

                    {summary && !isExporting && (
                        <>
                            <div className="editor-section">
                                <span className="editor-section-title">Export Complete</span>
                                <div className="entity-preview-grid">
                                    <div><strong>Chats:</strong> {summary.chats.length}</div>
                                    <div><strong>Characters:</strong> {summary.characters.length}</div>
                                    <div><strong>Contexts:</strong> {summary.contexts.length}</div>
                                    <div><strong>Locations:</strong> {summary.locations.length}</div>
                                    <div><strong>Audio Tracks:</strong> {summary.audioTracks.length}</div>
                                    <div><strong>Worlds:</strong> {summary.worlds.length}</div>
                                    <div><strong>Language Models:</strong> {summary.models.length}</div>
                                    <div><strong>Samplers:</strong> {summary.samplers.length}</div>
                                    <div><strong>Prompt Blocks:</strong> {summary.promptBlocks.length}</div>
                                    <div><strong>Stop Patterns:</strong> {summary.stopPatterns.length}</div>
                                    <div><strong>Budget Strategies:</strong> {summary.budgetStrategies.length}</div>
                                    <div><strong>Profiles:</strong> {summary.profiles.length}</div>
                                    <div><strong>Memories:</strong> {summary.memories?.length ?? 0}</div>
                                    <div><strong>Actions:</strong> {summary.interjectableActions.length}</div>
                                    <div><strong>Exported At:</strong> {new Date(summary.exportedAt).toLocaleString()}</div>
                                </div>
                            </div>
                            <div className="entity-export-done-hint">File has been downloaded. You can close this dialog.</div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}