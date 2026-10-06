// frontend_src/components/DataExportModal.tsx
import { useState } from 'react';
import type { Character, Context, Location, AudioTrack, World, LanguageModel, Sampler, PromptBlock, StopPattern, BudgetStrategy, Profile, Memory, Account, MultiplayerData, RawInteractionData } from '../types';
import { exportSelectedData, type LoreReactorExport } from '../services/DataPortabilityEngine';
import { EntitySelectList } from './EntitySelectList';
import '../main.css';

interface DataExportModalProps {
    onClose: () => void;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allLanguageModels: LanguageModel[];
    allSamplers: Sampler[];
    allPromptBlocks: PromptBlock[];
    allStopPatterns: StopPattern[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allMemories: Memory[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    rawChatShells: RawInteractionData[];
}

export function DataExportModal({
     onClose,
    allCharacters, allContexts, allLocations, allAudioTracks,
    allWorlds, allLanguageModels, allSamplers, allPromptBlocks, allStopPatterns,
    allBudgetStrategies, allProfiles, allMemories, allAccounts, allMultiplayerData,
    rawChatShells,
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
    const [selectedLanguageModelIds, setSelectedLanguageModelIds] = useState<string[]>([]);
    const [selectedSamplerIds, setSelectedSamplerIds] = useState<string[]>([]);
    const [selectedPromptBlockIds, setSelectedPromptBlockIds] = useState<string[]>([]);
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>([]);
    const [selectedBudgetStrategyIds, setSelectedBudgetStrategyIds] = useState<string[]>([]);
    const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
    const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
    const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
    const [selectedMultiplayerDataIds, setSelectedMultiplayerDataIds] = useState<string[]>([]);
    
    // STRICT ORDER: Actions -> Action Format -> Format Preferences -> Session -> Budget
    const [includeActions, setIncludeActions] = useState(true);
    const [includeActionFormatData, setIncludeActionFormatData] = useState(true);
    const [includeFormatPreferences, setIncludeFormatPreferences] = useState(true);
    const [includeSessionData, setIncludeSessionData] = useState(true);
    const [includeBudgetData, setIncludeBudgetData] = useState(true);

    const [chatSearch, setChatSearch] = useState('');
    const [characterSearch, setCharacterSearch] = useState('');
    const [contextSearch, setContextSearch] = useState('');
    const [locationSearch, setLocationSearch] = useState('');
    const [audioTrackSearch, setAudioTrackSearch] = useState('');
    const [worldSearch, setWorldSearch] = useState('');
    const [languageModelSearch, setLanguageModelSearch] = useState('');
    const [samplerSearch, setSamplerSearch] = useState('');
    const [promptBlockSearch, setPromptBlockSearch] = useState('');
    const [stopPatternSearch, setStopPatternSearch] = useState('');
    const [budgetStrategySearch, setBudgetStrategySearch] = useState('');
    const [profileSearch, setProfileSearch] = useState('');
    const [memorySearch, setMemorySearch] = useState('');
    const [accountSearch, setAccountSearch] = useState('');
    const [multiplayerDataSearch, setMultiplayerDataSearch] = useState('');

    const reset = () => {
        setSummary(null); setError(null); setIsExporting(false);
        setSelectedChatIds([]); setSelectedCharacterIds([]); setSelectedContextIds([]);
        setSelectedLocationIds([]); setSelectedAudioTrackIds([]); setSelectedWorldIds([]);
        setSelectedLanguageModelIds([]); setSelectedSamplerIds([]); setSelectedPromptBlockIds([]);
        setSelectedStopPatternIds([]); setSelectedBudgetStrategyIds([]); setSelectedProfileIds([]);
        setSelectedMemoryIds([]); setSelectedAccountIds([]); setSelectedMultiplayerDataIds([]);
        setIncludeActions(true);
        setIncludeActionFormatData(true);
        setIncludeFormatPreferences(true);
        setIncludeSessionData(true);
        setIncludeBudgetData(true);
        setChatSearch(''); setCharacterSearch(''); setContextSearch(''); setLocationSearch('');
        setAudioTrackSearch(''); setWorldSearch(''); setLanguageModelSearch(''); setSamplerSearch('');
        setPromptBlockSearch(''); setStopPatternSearch(''); setBudgetStrategySearch(''); setProfileSearch('');
        setMemorySearch(''); setAccountSearch(''); setMultiplayerDataSearch('');
    };

    const handleClose = () => { if (isExporting) return; reset(); onClose(); };

    const toggle = (_ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const totalSelected = selectedChatIds.length + selectedCharacterIds.length + selectedContextIds.length +
        selectedLocationIds.length + selectedAudioTrackIds.length + selectedWorldIds.length +
        selectedLanguageModelIds.length + selectedSamplerIds.length + selectedPromptBlockIds.length +
        selectedStopPatternIds.length + selectedBudgetStrategyIds.length + selectedProfileIds.length +
        selectedMemoryIds.length + selectedAccountIds.length + selectedMultiplayerDataIds.length +
        (includeActions ? 1 : 0) + (includeActionFormatData ? 1 : 0) + 
        (includeFormatPreferences ? 1 : 0) + (includeSessionData ? 1 : 0) + (includeBudgetData ? 1 : 0);

    const handleExport = async () => {
        if (totalSelected === 0) { setError('Select at least one item to export.'); return; }
        setIsExporting(true); setError(null); setSummary(null);

        try {
            const data = await exportSelectedData({
                chatIds: selectedChatIds,
                characterIds: selectedCharacterIds, contextIds: selectedContextIds, locationIds: selectedLocationIds,
                audioTrackIds: selectedAudioTrackIds, worldIds: selectedWorldIds, languageModelIds: selectedLanguageModelIds,
                samplerIds: selectedSamplerIds, promptBlockIds: selectedPromptBlockIds,
                stopPatternIds: selectedStopPatternIds, budgetStrategyIds: selectedBudgetStrategyIds,
                profileIds: selectedProfileIds, memoryIds: selectedMemoryIds,
                accountIds: selectedAccountIds, multiplayerDataIds: selectedMultiplayerDataIds,
                includeActions,
                includeActionFormatData,
                includeFormatPreferences,
                includeSessionData,
                includeBudgetData,
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
                                <EntitySelectList label="Language Models" items={allLanguageModels} selectedIds={selectedLanguageModelIds}
                                    onToggle={(id) => toggle(selectedLanguageModelIds, setSelectedLanguageModelIds, id)} searchQuery={languageModelSearch} onSearchChange={setLanguageModelSearch} />
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
                                <EntitySelectList label="Accounts" items={allAccounts} selectedIds={selectedAccountIds}
                                    onToggle={(id) => toggle(selectedAccountIds, setSelectedAccountIds, id)} searchQuery={accountSearch} onSearchChange={setAccountSearch} />
                                <EntitySelectList label="Multiplayer Data" items={allMultiplayerData} selectedIds={selectedMultiplayerDataIds}
                                    onToggle={(id) => toggle(selectedMultiplayerDataIds, setSelectedMultiplayerDataIds, id)} searchQuery={multiplayerDataSearch} onSearchChange={setMultiplayerDataSearch} />

                                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <span className="editor-section-title" style={{ fontSize: '0.8rem' }}>Singleton Data</span>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                        <input type="checkbox" checked={includeActions} onChange={e => setIncludeActions(e.target.checked)} className="editor-checkbox-input" />
                                        <span>Interjectable Actions (List of available actions)</span>
                                    </label>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                        <input type="checkbox" checked={includeActionFormatData} onChange={e => setIncludeActionFormatData(e.target.checked)} className="editor-checkbox-input" />
                                        <span>Action Format Data (Bayesian learning matrix & UI state)</span>
                                    </label>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                        <input type="checkbox" checked={includeFormatPreferences} onChange={e => setIncludeFormatPreferences(e.target.checked)} className="editor-checkbox-input" />
                                        <span>Format Preferences (Text formatting rules)</span>
                                    </label>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                        <input type="checkbox" checked={includeSessionData} onChange={e => setIncludeSessionData(e.target.checked)} className="editor-checkbox-input" />
                                        <span>Session & Multiplayer Join Data</span>
                                    </label>
                                    <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                        <input type="checkbox" checked={includeBudgetData} onChange={e => setIncludeBudgetData(e.target.checked)} className="editor-checkbox-input" />
                                        <span>Budget Data (Includes Factorization Machine state)</span>
                                    </label>
                                </div>
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
                                    <div><strong>Language Models:</strong> {summary.languageModels.length}</div>
                                    <div><strong>Samplers:</strong> {summary.samplers.length}</div>
                                    <div><strong>Prompt Blocks:</strong> {summary.promptBlocks.length}</div>
                                    <div><strong>Stop Patterns:</strong> {summary.stopPatterns.length}</div>
                                    <div><strong>Budget Strategies:</strong> {summary.budgetStrategies.length}</div>
                                    <div><strong>Profiles:</strong> {summary.profiles.length}</div>
                                    <div><strong>Memories:</strong> {summary.memories?.length ?? 0}</div>
                                    <div><strong>Accounts:</strong> {summary.accounts?.length ?? 0}</div>
                                    <div><strong>Multiplayer Data:</strong> {summary.multiplayerData?.length ?? 0}</div>
                                    <div><strong>Actions:</strong> {summary.interjectableActions.length}</div>
                                    <div><strong>Action Format Data:</strong> {summary.actionFormatData ? 'Included' : 'Excluded'}</div>
                                    <div><strong>Format Preferences:</strong> {summary.formatPreferences ? 'Included' : 'Excluded'}</div>
                                    <div><strong>Session Data:</strong> {summary.sessionData ? 'Included' : 'Excluded'}</div>
                                    <div><strong>Budget Data:</strong> {summary.budgetData ? 'Included' : 'Excluded'}</div>
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