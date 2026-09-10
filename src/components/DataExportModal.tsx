// src/components/DataExportModal.tsx
import { useState } from 'react';
import type { Character, Context, Location, Sampler, StopPattern, LanguageModel, BudgetStrategy, Profile, World } from '../types';
import { exportSelectedData, type LoreReactorExport } from '../services/DataPortabilityEngine';
import { EntitySelectList } from './EntitySelectList';
import './main.css';

interface DataExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allModels: LanguageModel[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allWorlds: World[];
    allChats: { id: string; name?: string; lastUpdatedTimestamp?: number }[];
}

export function DataExportModal({
    isOpen, onClose,
    allCharacters, allContexts, allLocations, allSamplers, allStopPatterns,
    allModels, allBudgetStrategies, allProfiles, allWorlds, allChats,
}: DataExportModalProps) {
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<LoreReactorExport | null>(null);

    const [selCharIds, setSelCharIds] = useState<string[]>([]);
    const [selCtxIds, setSelCtxIds] = useState<string[]>([]);
    const [selLocIds, setSelLocIds] = useState<string[]>([]);
    const [selSamplerIds, setSelSamplerIds] = useState<string[]>([]);
    const [selSpIds, setSelSpIds] = useState<string[]>([]);
    const [selModelIds, setSelModelIds] = useState<string[]>([]);
    const [selBsIds, setSelBsIds] = useState<string[]>([]);
    const [selProfileIds, setSelProfileIds] = useState<string[]>([]);
    const [selWorldIds, setSelWorldIds] = useState<string[]>([]);
    const [selChatIds, setSelChatIds] = useState<string[]>([]);
    const [includeActions, setIncludeActions] = useState(true);

    const [charSearch, setCharSearch] = useState('');
    const [ctxSearch, setCtxSearch] = useState('');
    const [locSearch, setLocSearch] = useState('');
    const [samplerSearch, setSamplerSearch] = useState('');
    const [spSearch, setSpSearch] = useState('');
    const [modelSearch, setModelSearch] = useState('');
    const [bsSearch, setBsSearch] = useState('');
    const [profileSearch, setProfileSearch] = useState('');
    const [worldSearch, setWorldSearch] = useState('');
    const [chatSearch, setChatSearch] = useState('');

    const reset = () => {
        setSummary(null); setError(null); setIsExporting(false);
        setSelCharIds([]); setSelCtxIds([]); setSelLocIds([]);
        setSelSamplerIds([]); setSelSpIds([]); setSelModelIds([]);
        setSelBsIds([]); setSelProfileIds([]); setSelWorldIds([]); setSelChatIds([]);
        setIncludeActions(true);
        setCharSearch(''); setCtxSearch(''); setLocSearch('');
        setSamplerSearch(''); setSpSearch(''); setModelSearch('');
        setBsSearch(''); setProfileSearch(''); setWorldSearch(''); setChatSearch('');
    };

    const handleClose = () => { if (isExporting) return; reset(); onClose(); };

    const toggle = (_ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const totalSelected = selCharIds.length + selCtxIds.length + selLocIds.length +
        selSamplerIds.length + selSpIds.length + selModelIds.length +
        selBsIds.length + selProfileIds.length + selWorldIds.length + selChatIds.length + (includeActions ? 1 : 0);

    const handleExport = async () => {
        if (totalSelected === 0) { setError('Select at least one item to export.'); return; }
        setIsExporting(true); setError(null); setSummary(null);

        try {
            const data = await exportSelectedData({
                characterIds: selCharIds, contextIds: selCtxIds, locationIds: selLocIds,
                samplerIds: selSamplerIds, stopPatternIds: selSpIds, modelIds: selModelIds,
                budgetStrategyIds: selBsIds, profileIds: selProfileIds, worldIds: selWorldIds,
                includeActions, chatIds: selChatIds,
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
        } catch (err) {
            setError(`Export failed: ${(err as Error).message}`);
        } finally { setIsExporting(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Export Data</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClose} disabled={isExporting}>
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

                                <EntitySelectList label="Characters" items={allCharacters} selectedIds={selCharIds}
                                    onToggle={(id) => toggle(selCharIds, setSelCharIds, id)} searchQuery={charSearch} onSearchChange={setCharSearch} />
                                <EntitySelectList label="Contexts" items={allContexts} selectedIds={selCtxIds}
                                    onToggle={(id) => toggle(selCtxIds, setSelCtxIds, id)} searchQuery={ctxSearch} onSearchChange={setCtxSearch} />
                                <EntitySelectList label="Locations" items={allLocations} selectedIds={selLocIds}
                                    onToggle={(id) => toggle(selLocIds, setSelLocIds, id)} searchQuery={locSearch} onSearchChange={setLocSearch} />
                                <EntitySelectList label="Worlds" items={allWorlds} selectedIds={selWorldIds}
                                    onToggle={(id) => toggle(selWorldIds, setSelWorldIds, id)} searchQuery={worldSearch} onSearchChange={setWorldSearch} />
                                <EntitySelectList label="Samplers" items={allSamplers} selectedIds={selSamplerIds}
                                    onToggle={(id) => toggle(selSamplerIds, setSelSamplerIds, id)} searchQuery={samplerSearch} onSearchChange={setSamplerSearch} />
                                <EntitySelectList label="Stop Patterns" items={allStopPatterns} selectedIds={selSpIds}
                                    onToggle={(id) => toggle(selSpIds, setSelSpIds, id)} searchQuery={spSearch} onSearchChange={setSpSearch} />
                                <EntitySelectList label="Language Models" items={allModels} selectedIds={selModelIds}
                                    onToggle={(id) => toggle(selModelIds, setSelModelIds, id)} searchQuery={modelSearch} onSearchChange={setModelSearch} />
                                <EntitySelectList label="Budget Strategies" items={allBudgetStrategies} selectedIds={selBsIds}
                                    onToggle={(id) => toggle(selBsIds, setSelBsIds, id)} searchQuery={bsSearch} onSearchChange={setBsSearch} />
                                <EntitySelectList label="Profiles" items={allProfiles} selectedIds={selProfileIds}
                                    onToggle={(id) => toggle(selProfileIds, setSelProfileIds, id)} searchQuery={profileSearch} onSearchChange={setProfileSearch} />
                                <EntitySelectList label="Chat Sessions" items={allChats} selectedIds={selChatIds}
                                    onToggle={(id) => toggle(selChatIds, setSelChatIds, id)} searchQuery={chatSearch} onSearchChange={setChatSearch} />

                                <label className="editor-checkbox-label" style={{ marginTop: '8px' }}>
                                    <input type="checkbox" checked={includeActions} onChange={e => setIncludeActions(e.target.checked)} className="editor-checkbox-input" />
                                    <span>Include Interjectable Actions</span>
                                </label>
                            </div>

                            <button type="button" className="editor-btn editor-btn-save entity-generate-btn"
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
                                    <div><strong>Characters:</strong> {summary.characters.length}</div>
                                    <div><strong>Contexts:</strong> {summary.contexts.length}</div>
                                    <div><strong>Locations:</strong> {summary.locations.length}</div>
                                    <div><strong>Worlds:</strong> {summary.worlds.length}</div>
                                    <div><strong>Samplers:</strong> {summary.samplers.length}</div>
                                    <div><strong>Stop Patterns:</strong> {summary.stopPatterns.length}</div>
                                    <div><strong>Language Models:</strong> {summary.models.length}</div>
                                    <div><strong>Budget Strategies:</strong> {summary.budgetStrategies.length}</div>
                                    <div><strong>Profiles:</strong> {summary.profiles.length}</div>
                                    <div><strong>Actions:</strong> {summary.interjectableActions.length}</div>
                                    <div><strong>Chats:</strong> {summary.chats.length}</div>
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