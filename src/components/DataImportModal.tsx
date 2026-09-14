// src/components/DataImportModal.tsx
import { useState, useRef } from 'react';
import type { World } from '../types';
import { validateExport, importSelectedData, type LoreReactorExport, type ImportResult } from '../services/DataPortabilityEngine';
import { EntitySelectList } from './EntitySelectList';
import './main.css';

interface DataImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImportComplete: () => void;
}

export function DataImportModal({ isOpen, onClose, onImportComplete }: DataImportModalProps) {
    const [parsedData, setParsedData] = useState<LoreReactorExport | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Selection state for filtering what to import from the parsed file
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
        setParsedData(null); setImportResult(null); setError(null); setIsImporting(false);
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

    const handleClose = () => { if (isImporting) return; reset(); onClose(); };

    const toggle = (_ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        setError(null); setParsedData(null); setImportResult(null);

        try {
            const text = await file.text();
            const json = JSON.parse(text);
            if (!validateExport(json)) { setError('Invalid LoreReactor export file. The file may be corrupted or from an incompatible version.'); return; }
            setParsedData(json);
            // Pre-select all items by default
            setSelectedChatIds(json.chats.map((c: { id: string }) => c.id));
            setSelectedCharacterIds(json.characters.map((c: { id: string }) => c.id));
            setSelectedContextIds(json.contexts.map((c: { id: string }) => c.id));
            setSelectedLocationIds(json.locations.map((l: { id: string }) => l.id));
            setSelectedAudioTrackIds(json.audioTracks.map((t: { id: string }) => t.id));
            setSelectedWorldIds(json.worlds?.map((w: World) => w.id) ?? []);
            setSelectedModelIds(json.models.map((m: { id: string }) => m.id));
            setSelectedSamplerIds(json.samplers.map((s: { id: string }) => s.id));
            setSelectedPromptBlockIds(json.promptBlocks.map((b: { id: string }) => b.id));
            setSelectedStopPatternIds(json.stopPatterns.map((s: { id: string }) => s.id));
            setSelectedBudgetStrategyIds(json.budgetStrategies.map((b: { id: string }) => b.id));
            setSelectedProfileIds(json.profiles.map((p: { id: string }) => p.id));
            setSelectedMemoryIds(json.memories?.map((m: { id: string }) => m.id) ?? []);
            setIncludeActions(json.interjectableActions.length > 0);
        } catch (error) { setError(`Failed to parse file: ${(error as Error).message}`); }
    };

    const handleConfirmImport = async () => {
        if (!parsedData) return;
        setIsImporting(true); setError(null);

        // Filter parsed data to only selected items
        const filtered: LoreReactorExport = {
            version: 1, exportedAt: parsedData.exportedAt,
            chats: parsedData.chats.filter(c => selectedChatIds.includes(c.id)),
            characters: parsedData.characters.filter(c => selectedCharacterIds.includes(c.id)),
            contexts: parsedData.contexts.filter(c => selectedContextIds.includes(c.id)),
            locations: parsedData.locations.filter(l => selectedLocationIds.includes(l.id)),
            audioTracks: parsedData.audioTracks.filter(t => selectedAudioTrackIds.includes(t.id)),
            worlds: parsedData.worlds?.filter((w: World) => selectedWorldIds.includes(w.id)) ?? [],
            models: parsedData.models.filter(m => selectedModelIds.includes(m.id)),
            samplers: parsedData.samplers.filter(s => selectedSamplerIds.includes(s.id)),
            promptBlocks: parsedData.promptBlocks.filter(b => selectedPromptBlockIds.includes(b.id)),
            stopPatterns: parsedData.stopPatterns.filter(s => selectedStopPatternIds.includes(s.id)),
            budgetStrategies: parsedData.budgetStrategies.filter(b => selectedBudgetStrategyIds.includes(b.id)),
            profiles: parsedData.profiles.filter(p => selectedProfileIds.includes(p.id)),
            memories: parsedData.memories?.filter(m => selectedMemoryIds.includes(m.id)) ?? [],
            interjectableActions: includeActions ? parsedData.interjectableActions : [],
        };

        try {
            const result = await importSelectedData(filtered);
            setImportResult(result);
            if (result.success || result.errors.length === 0) onImportComplete();
        } catch (error) { setError(`Import failed: ${(error as Error).message}`); }
        finally { setIsImporting(false); }
    };

    const totalSelected = selectedChatIds.length + selectedCharacterIds.length + selectedContextIds.length +
        selectedLocationIds.length + selectedAudioTrackIds.length + selectedWorldIds.length +
        selectedModelIds.length + selectedSamplerIds.length + selectedPromptBlockIds.length +
        selectedStopPatternIds.length + selectedBudgetStrategyIds.length + selectedProfileIds.length +
        selectedMemoryIds.length + (includeActions ? 1 : 0);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Import Data</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={handleClose} disabled={isImporting}>
                            {importResult ? 'Close' : 'Cancel'}
                        </button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {error && <div className="editor-error-message editor-error-centered">{error}</div>}

                    {!parsedData && !importResult && (
                        <div className="entity-upload-state">
                            <div className="entity-upload-icon">📥</div>
                            <div className="entity-upload-title">Import from JSON</div>
                            <div className="entity-upload-hint">
                                Load a previously exported LoreReactor JSON file.<br />
                                You can choose which items to import after loading.<br />
                                Existing entities with matching IDs will be overwritten.
                            </div>
                            <button type="button" className="editor-button editor-button-save entity-upload-button"
                                onClick={() => fileInputRef.current?.click()}>
                                Choose File
                            </button>
                            <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={handleFileSelected} />
                        </div>
                    )}

                    {parsedData && !importResult && !isImporting && (
                        <>
                            <div className="editor-section">
                                <span className="editor-section-title">Select Items to Import</span>
                                <div className="entity-ref-hint">
                                    File exported: {new Date(parsedData.exportedAt).toLocaleString()}. Click items to deselect. Only selected items will be imported.
                                </div>

                                {parsedData.chats.length > 0 && (
                                    <EntitySelectList label="Chat Sessions" items={parsedData.chats} selectedIds={selectedChatIds}
                                        onToggle={(id) => toggle(selectedChatIds, setSelectedChatIds, id)} searchQuery={chatSearch} onSearchChange={setChatSearch} />
                                )}
                                {parsedData.characters.length > 0 && (
                                    <EntitySelectList label="Characters" items={parsedData.characters} selectedIds={selectedCharacterIds}
                                        onToggle={(id) => toggle(selectedCharacterIds, setSelectedCharacterIds, id)} searchQuery={characterSearch} onSearchChange={setCharacterSearch} />
                                )}
                                {parsedData.contexts.length > 0 && (
                                    <EntitySelectList label="Contexts" items={parsedData.contexts} selectedIds={selectedContextIds}
                                        onToggle={(id) => toggle(selectedContextIds, setSelectedContextIds, id)} searchQuery={contextSearch} onSearchChange={setContextSearch} />
                                )}
                                {parsedData.locations.length > 0 && (
                                    <EntitySelectList label="Locations" items={parsedData.locations} selectedIds={selectedLocationIds}
                                        onToggle={(id) => toggle(selectedLocationIds, setSelectedLocationIds, id)} searchQuery={locationSearch} onSearchChange={setLocationSearch} />
                                )}
                                {parsedData.audioTracks.length > 0 && (
                                    <EntitySelectList label="Audio Tracks" items={parsedData.audioTracks} selectedIds={selectedAudioTrackIds}
                                        onToggle={(id) => toggle(selectedAudioTrackIds, setSelectedAudioTrackIds, id)} searchQuery={audioTrackSearch} onSearchChange={setAudioTrackSearch} />
                                )}
                                {(parsedData.worlds?.length ?? 0) > 0 && (
                                    <EntitySelectList label="Worlds" items={parsedData.worlds!} selectedIds={selectedWorldIds}
                                        onToggle={(id) => toggle(selectedWorldIds, setSelectedWorldIds, id)} searchQuery={worldSearch} onSearchChange={setWorldSearch} />
                                )}
                                {parsedData.models.length > 0 && (
                                    <EntitySelectList label="Language Models" items={parsedData.models} selectedIds={selectedModelIds}
                                        onToggle={(id) => toggle(selectedModelIds, setSelectedModelIds, id)} searchQuery={modelSearch} onSearchChange={setModelSearch} />
                                )}
                                {parsedData.samplers.length > 0 && (
                                    <EntitySelectList label="Samplers" items={parsedData.samplers} selectedIds={selectedSamplerIds}
                                        onToggle={(id) => toggle(selectedSamplerIds, setSelectedSamplerIds, id)} searchQuery={samplerSearch} onSearchChange={setSamplerSearch} />
                                )}
                                {parsedData.promptBlocks.length > 0 && (
                                    <EntitySelectList label="Prompt Blocks" items={parsedData.promptBlocks} selectedIds={selectedPromptBlockIds}
                                        onToggle={(id) => toggle(selectedPromptBlockIds, setSelectedPromptBlockIds, id)} searchQuery={promptBlockSearch} onSearchChange={setPromptBlockSearch} />
                                )}
                                {parsedData.stopPatterns.length > 0 && (
                                    <EntitySelectList label="Stop Patterns" items={parsedData.stopPatterns} selectedIds={selectedStopPatternIds}
                                        onToggle={(id) => toggle(selectedStopPatternIds, setSelectedStopPatternIds, id)} searchQuery={stopPatternSearch} onSearchChange={setStopPatternSearch} />
                                )}
                                {parsedData.budgetStrategies.length > 0 && (
                                    <EntitySelectList label="Budget Strategies" items={parsedData.budgetStrategies} selectedIds={selectedBudgetStrategyIds}
                                        onToggle={(id) => toggle(selectedBudgetStrategyIds, setSelectedBudgetStrategyIds, id)} searchQuery={budgetStrategySearch} onSearchChange={setBudgetStrategySearch} />
                                )}
                                {parsedData.profiles.length > 0 && (
                                    <EntitySelectList label="Profiles" items={parsedData.profiles} selectedIds={selectedProfileIds}
                                        onToggle={(id) => toggle(selectedProfileIds, setSelectedProfileIds, id)} searchQuery={profileSearch} onSearchChange={setProfileSearch} />
                                )}
                                {(parsedData.memories?.length ?? 0) > 0 && (
                                    <EntitySelectList label="Memories" items={parsedData.memories!} selectedIds={selectedMemoryIds}
                                        onToggle={(id) => toggle(selectedMemoryIds, setSelectedMemoryIds, id)} searchQuery={memorySearch} onSearchChange={setMemorySearch} />
                                )}

                                {parsedData.interjectableActions.length > 0 && (
                                    <label className="editor-checkbox-label" style={{ marginTop: '8px' }}>
                                        <input type="checkbox" checked={includeActions} onChange={e => setIncludeActions(e.target.checked)} className="editor-checkbox-input" />
                                        <span>Include Interjectable Actions ({parsedData.interjectableActions.length})</span>
                                    </label>
                                )}
                            </div>

                            <div className="entity-action-buttons">
                                <button type="button" className="editor-button editor-button-cancel" onClick={reset}>Choose Different File</button>
                                <button type="button" className="editor-button editor-button-save" onClick={handleConfirmImport} disabled={totalSelected === 0}>
                                    Import {totalSelected > 0 ? `${totalSelected} Selected` : ''}
                                </button>
                            </div>
                        </>
                    )}

                    {isImporting && (
                        <div className="entity-loading-state">
                            <div className="entity-loading-icon">⏳</div>
                            <div className="entity-loading-text">Importing selected data...</div>
                        </div>
                    )}

                    {importResult && !isImporting && (
                        <>
                            <div className="editor-section">
                                <span className="editor-section-title">
                                    {importResult.success ? '✅ Import Successful' : '⚠️ Import Completed with Errors'}
                                </span>
                                <div className="entity-preview-grid">
                                    <div><strong>Chats:</strong> {importResult.counts.chats}</div>
                                    <div><strong>Characters:</strong> {importResult.counts.characters}</div>
                                    <div><strong>Contexts:</strong> {importResult.counts.contexts}</div>
                                    <div><strong>Locations:</strong> {importResult.counts.locations}</div>
                                    <div><strong>Audio Tracks:</strong> {importResult.counts.audioTracks}</div>
                                    <div><strong>Worlds:</strong> {importResult.counts.worlds}</div>
                                    <div><strong>Language Models:</strong> {importResult.counts.models}</div>
                                    <div><strong>Samplers:</strong> {importResult.counts.samplers}</div>
                                    <div><strong>Prompt Blocks:</strong> {importResult.counts.promptBlocks}</div>
                                    <div><strong>Stop Patterns:</strong> {importResult.counts.stopPatterns}</div>
                                    <div><strong>Budget Strategies:</strong> {importResult.counts.budgetStrategies}</div>
                                    <div><strong>Profiles:</strong> {importResult.counts.profiles}</div>
                                    <div><strong>Memories:</strong> {importResult.counts.memories ?? 0}</div>
                                    <div><strong>Actions:</strong> {importResult.counts.interjectableActions}</div>
                                </div>
                            </div>

                            {importResult.errors.length > 0 && (
                                <div className="editor-section">
                                    <span className="editor-section-title">Errors ({importResult.errors.length})</span>
                                    <div className="entity-error-list">
                                        {importResult.errors.map((error, i) => (
                                            <div key={i} className="entity-error-item">• {error}</div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="entity-import-done-hint">Refresh the page or reopen managers to see imported data.</div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}