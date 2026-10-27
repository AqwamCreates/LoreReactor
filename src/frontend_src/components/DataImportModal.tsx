// src/frontend_src/components/DataImportModal.tsx
import { useState, useRef, useMemo } from 'react';
import { validateExport, importSelectedData, type LoreReactorExport, type ImportResult } from '../services/DataPortabilityEngine';
import { buildJsonSchema } from '../utilities/dataSchema';
import { EntitySelectList } from './EntitySelectList';
import { FileDropArea } from './FileDropArea';
import '../main.css';
import { dataPortabilityVersion } from '../dictionaries/versions';

interface DataImportModalProps {
    onClose: () => void;
    onImportComplete: () => void;
}

type ImportSource = 'file' | 'paste' | 'schema';

export function DataImportModal({ onClose, onImportComplete }: DataImportModalProps) {
    const [parsedData, setParsedData] = useState<LoreReactorExport | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [activeSource, setActiveSource] = useState<ImportSource>('file');
    const [pasteText, setPasteText] = useState('');
    const [schemaEntities, setSchemaEntities] = useState<string[]>([]);
    const [schemaCopied, setSchemaCopied] = useState(false);

    // Selection state for filtering what to import from the parsed file
    const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
    const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
    const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
    const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
    const [selectedAudioTrackIds, setSelectedAudioTrackIds] = useState<string[]>([]);
    const [selectedWorldIds, setSelectedWorldIds] = useState<string[]>([]);
    const [selectedLanguageModelIds, setSelectedLanguageModelIds] = useState<string[]>([]);
    const [selectedSpatiotemporalModelIds, setSelectedSpatiotemporalModelIds] = useState<string[]>([]);
    const [selectedSamplerIds, setSelectedSamplerIds] = useState<string[]>([]);
    const [selectedPromptBlockIds, setSelectedPromptBlockIds] = useState<string[]>([]);
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>([]);
    const [selectedRetrievalConfigurationIds, setSelectedRetrievalConfigurationIds] = useState<string[]>([]);
    const [selectedBudgetStrategyIds, setSelectedBudgetStrategyIds] = useState<string[]>([]);
    const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
    const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
    const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
    const [selectedMultiplayerDataIds, setSelectedMultiplayerDataIds] = useState<string[]>([]);
    const [selectedEntityFolderIds, setSelectedEntityFolderIds] = useState<string[]>([]);
    
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
    const [spatiotemporalModelSearch, setSpatiotemporalModelSearch] = useState('');
    const [tokenSamplerSearch, setSamplerSearch] = useState('');
    const [promptBlockSearch, setPromptBlockSearch] = useState('');
    const [stopPatternSearch, setStopPatternSearch] = useState('');
    const [retrievalConfigurationSearch, setRetrievalConfigurationSearch] = useState('');
    const [budgetStrategySearch, setBudgetStrategySearch] = useState('');
    const [profileSearch, setProfileSearch] = useState('');
    const [memorySearch, setMemorySearch] = useState('');
    const [accountSearch, setAccountSearch] = useState('');
    const [multiplayerDataSearch, setMultiplayerDataSearch] = useState('');
    const [entityFolderSearch, setEntityFolderSearch] = useState('');

    const reset = () => {
        setParsedData(null); setImportResult(null); setError(null); setIsImporting(false);
        setSelectedChatIds([]); setSelectedCharacterIds([]); setSelectedContextIds([]);
        setSelectedLocationIds([]); setSelectedAudioTrackIds([]); setSelectedWorldIds([]);
        setSelectedLanguageModelIds([]); setSelectedSpatiotemporalModelIds([]); setSelectedSamplerIds([]); setSelectedPromptBlockIds([]);
        setSelectedStopPatternIds([]); setSelectedRetrievalConfigurationIds([]); setSelectedBudgetStrategyIds([]); setSelectedProfileIds([]);
        setSelectedMemoryIds([]); setSelectedAccountIds([]); setSelectedMultiplayerDataIds([]);
        setSelectedEntityFolderIds([]);
        setIncludeActions(true);
        setIncludeActionFormatData(true);
        setIncludeFormatPreferences(true);
        setIncludeSessionData(true);
        setIncludeBudgetData(true);
        setPasteText('');
        setSchemaCopied(false);
        setChatSearch(''); setCharacterSearch(''); setContextSearch(''); setLocationSearch('');
        setAudioTrackSearch(''); setWorldSearch(''); setLanguageModelSearch(''); setSpatiotemporalModelSearch(''); setSamplerSearch('');
        setPromptBlockSearch(''); setStopPatternSearch(''); setRetrievalConfigurationSearch(''); setBudgetStrategySearch(''); setProfileSearch('');
        setMemorySearch(''); setAccountSearch(''); setMultiplayerDataSearch(''); setEntityFolderSearch('');
    };

    const handleClose = () => { if (isImporting) return; reset(); onClose(); };

    const toggle = (_ids: string[], setIds: React.Dispatch<React.SetStateAction<string[]>>, id: string) => {
        setIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const populateSelectionFromData = (json: LoreReactorExport) => {
        setSelectedChatIds(json.chats.map((c: { id: string }) => c.id));
        setSelectedCharacterIds(json.characters.map((c: { id: string }) => c.id));
        setSelectedContextIds(json.contexts.map((c: { id: string }) => c.id));
        setSelectedLocationIds(json.locations.map((l: { id: string }) => l.id));
        setSelectedAudioTrackIds(json.audioTracks.map((t: { id: string }) => t.id));
        setSelectedWorldIds(json.worlds?.map(w => w.id) ?? []);
        setSelectedLanguageModelIds(json.languageModels.map((m: { id: string }) => m.id));
        setSelectedSpatiotemporalModelIds(json.spatiotemporalModels?.map((m: { id: string }) => m.id) ?? []);
        setSelectedSamplerIds(json.tokenSamplers.map((s: { id: string }) => s.id));
        setSelectedPromptBlockIds(json.promptBlocks.map((b: { id: string }) => b.id));
        setSelectedStopPatternIds(json.stopPatterns.map((s: { id: string }) => s.id));
        setSelectedRetrievalConfigurationIds(json.retrievalConfigurations?.map((rc: { id: string }) => rc.id) ?? []);
        setSelectedBudgetStrategyIds(json.budgetStrategies.map((b: { id: string }) => b.id));
        setSelectedProfileIds(json.profiles.map((p: { id: string }) => p.id));
        setSelectedMemoryIds(json.memories?.map((m: { id: string }) => m.id) ?? []);
        setSelectedAccountIds(json.accounts?.map((a: { id: string }) => a.id) ?? []);
        setSelectedMultiplayerDataIds(json.multiplayerData?.map((md: { id: string }) => md.id) ?? []);
        setSelectedEntityFolderIds(json.entityFolders?.map((f: { id: string }) => f.id) ?? []);
        
        setIncludeActions(json.interjectableActions.length > 0);
        setIncludeActionFormatData(!!json.actionFormatData);
        setIncludeFormatPreferences(!!json.formatPreferences);
        setIncludeSessionData(!!json.sessionData || !!json.multiplayerJoinData);
        setIncludeBudgetData(!!json.budgetData);
    };

    const processJsonFile = async (file: File) => {
        setError(null);
        setParsedData(null);
        setImportResult(null);

        try {
            const text = await file.text();
            const json = JSON.parse(text);
            if (!validateExport(json)) {
                setError('Invalid LoreReactor export file. The file may be corrupted or from an incompatible version.');
                return;
            }
            setParsedData(json);
            populateSelectionFromData(json);
            setActiveSource('file');
        } catch (err) {
            setError(`Failed to parse file: ${(err as Error).message}`);
        }
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        await processJsonFile(file);
    };

    const handleDropFiles = async (files: File[]) => {
        const file = files[0];
        if (!file) return;
        await processJsonFile(file);
    };

    const handlePasteImport = () => {
        setError(null); setParsedData(null); setImportResult(null);

        if (!pasteText) { setError('Paste JSON content first.'); return; }

        try {
            const json = JSON.parse(pasteText);
            if (!validateExport(json)) { setError('Invalid LoreReactor export format. Ensure the JSON matches the expected export structure.'); return; }
            setParsedData(json);
            populateSelectionFromData(json);
        } catch (error) { setError(`Failed to parse pasted JSON: ${(error as Error).message}`); }
    };

    // Generate wrapped schema reactively based on selected entities
    const wrappedSchemaText = useMemo(() => {
        if (schemaEntities.length === 0) return '';
        try {
            const entitySchema = buildJsonSchema(schemaEntities as any[]);
            const wrapped = {
                version: dataPortabilityVersion,
                exportedAt: "ISO timestamp string",
                chats: [],
                characters: schemaEntities.includes('Character') ? "/* see _entitySchema */" : [],
                contexts: schemaEntities.includes('Context') ? "/* see _entitySchema */" : [],
                locations: schemaEntities.includes('Location') ? "/* see _entitySchema */" : [],
                audioTracks: schemaEntities.includes('AudioTrack') ? "/* see _entitySchema */" : [],
                worlds: [],
                languageModels: [],
                spatiotemporalModels: schemaEntities.includes('SpatiotemporalModel') ? "/* see _entitySchema */" : [],
                tokenSamplers: [],
                promptBlocks: schemaEntities.includes('PromptBlock') ? "/* see _entitySchema */" : [],
                stopPatterns: [],
                retrievalConfigurations: [],
                budgetStrategies: [],
                profiles: schemaEntities.includes('Profile') ? "/* see _entitySchema */" : [],
                memories: [],
                accounts: [],
                multiplayerData: [],
                entityFolders: schemaEntities.includes('EntityFolder') ? "/* see _entitySchema */" : [],
                interjectableActions: [],
                actionFormatData: undefined,
                formatPreferences: undefined,
                sessionData: undefined,
                multiplayerJoinData: undefined,
                budgetData: undefined,
                _entitySchema: JSON.parse(entitySchema),
            };
            return JSON.stringify(wrapped, null, 2);
        } catch {
            return '';
        }
    }, [schemaEntities]);

    const handleCopySchema = () => {
        if (!wrappedSchemaText) return;
        navigator.clipboard.writeText(wrappedSchemaText).then(() => {
            setSchemaCopied(true);
            setError(null);
            setTimeout(() => setSchemaCopied(false), 2000);
        }).catch(() => {
            setError('Failed to copy to clipboard. Try selecting and copying manually.');
        });
    };

    const handleConfirmImport = async () => {
        if (!parsedData) return;
        setIsImporting(true); setError(null);

        // Filter parsed data to only selected items
        const filtered: LoreReactorExport = {
            version: dataPortabilityVersion, exportedAt: parsedData.exportedAt,
            chats: parsedData.chats.filter(c => selectedChatIds.includes(c.id)),
            characters: parsedData.characters.filter(c => selectedCharacterIds.includes(c.id)),
            contexts: parsedData.contexts.filter(c => selectedContextIds.includes(c.id)),
            locations: parsedData.locations.filter(l => selectedLocationIds.includes(l.id)),
            audioTracks: parsedData.audioTracks.filter(t => selectedAudioTrackIds.includes(t.id)),
            worlds: parsedData.worlds?.filter(w => selectedWorldIds.includes(w.id)) ?? [],
            languageModels: parsedData.languageModels?.filter(m => selectedLanguageModelIds.includes(m.id)) ?? [],
            spatiotemporalModels: parsedData.spatiotemporalModels?.filter(m => selectedSpatiotemporalModelIds.includes(m.id)) ?? [],
            tokenSamplers: parsedData.tokenSamplers.filter(s => selectedSamplerIds.includes(s.id)),
            promptBlocks: parsedData.promptBlocks.filter(b => selectedPromptBlockIds.includes(b.id)),
            stopPatterns: parsedData.stopPatterns.filter(s => selectedStopPatternIds.includes(s.id)),
            retrievalConfigurations: parsedData.retrievalConfigurations?.filter(rc => selectedRetrievalConfigurationIds.includes(rc.id)) ?? [],
            budgetStrategies: parsedData.budgetStrategies.filter(b => selectedBudgetStrategyIds.includes(b.id)),
            profiles: parsedData.profiles.filter(p => selectedProfileIds.includes(p.id)),
            memories: parsedData.memories?.filter(m => selectedMemoryIds.includes(m.id)) ?? [],
            accounts: parsedData.accounts?.filter(a => selectedAccountIds.includes(a.id)) ?? [],
            multiplayerData: parsedData.multiplayerData?.filter(md => selectedMultiplayerDataIds.includes(md.id)) ?? [],
            entityFolders: parsedData.entityFolders?.filter(f => selectedEntityFolderIds.includes(f.id)) ?? [],
            
            // STRICT ORDER: Actions -> Action Format -> Format Preferences -> Session -> Budget
            interjectableActions: includeActions ? parsedData.interjectableActions : [],
            actionFormatData: includeActionFormatData ? parsedData.actionFormatData : undefined,
            formatPreferences: includeFormatPreferences ? parsedData.formatPreferences : undefined,
            sessionData: includeSessionData ? parsedData.sessionData : undefined,
            multiplayerJoinData: includeSessionData ? parsedData.multiplayerJoinData : undefined,
            budgetData: includeBudgetData ? parsedData.budgetData : undefined,
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
        selectedLanguageModelIds.length + selectedSpatiotemporalModelIds.length + selectedSamplerIds.length + selectedPromptBlockIds.length +
        selectedStopPatternIds.length + selectedRetrievalConfigurationIds.length + selectedBudgetStrategyIds.length + selectedProfileIds.length +
        selectedMemoryIds.length + selectedAccountIds.length + selectedMultiplayerDataIds.length +
        selectedEntityFolderIds.length +
        (includeActions ? 1 : 0) + (includeActionFormatData ? 1 : 0) + 
        (includeFormatPreferences ? 1 : 0) + (includeSessionData ? 1 : 0) + (includeBudgetData ? 1 : 0);

    const SCHEMA_ENTITY_OPTIONS = ['Character', 'Context', 'Location', 'AudioTrack', 'PromptBlock', 'Profile', 'EntityFolder', 'SpatiotemporalModel'] as const;

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <FileDropArea
                    acceptedTypes={['json']}
                    disabled={isImporting || !!parsedData || !!importResult}
                    onDropFiles={handleDropFiles}
                    overlayTitle="Drop LoreReactor Export File"
                    overlaySubtitle="Drop a .json export file to inspect and import"
                >
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
                            <>
                                {/* Source Tabs */}
                                <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                                    {[
                                        { id: 'file' as ImportSource, label: '📁 From File' },
                                        { id: 'paste' as ImportSource, label: '📋 Paste JSON' },
                                        { id: 'schema' as ImportSource, label: '📐 JSON Schema' },
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => { setActiveSource(tab.id); setError(null); }}
                                            className={`entity-tab-button ${activeSource === tab.id ? 'entity-tab-button-active' : ''}`}
                                            style={{ fontSize: '0.7rem', padding: '8px 12px' }}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>

                                {/* File Upload */}
                                {activeSource === 'file' && (
                                    <div className="entity-upload-state">
                                        <div className="entity-upload-icon">📥</div>
                                        <div className="entity-upload-title">Import from JSON File</div>
                                        <div className="entity-upload-hint">
                                            Load a previously exported LoreReactor JSON file.<br />
                                            You can drag & drop the file directly or choose it below.<br />
                                            Existing entities with matching IDs will be overwritten.
                                        </div>
                                        <button type="button" className="editor-button editor-button-save entity-upload-button"
                                            onClick={() => fileInputRef.current?.click()}>
                                            Choose File
                                        </button>
                                        <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={handleFileSelected} />
                                    </div>
                                )}

                                {/* Paste JSON */}
                                {activeSource === 'paste' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                                            Paste a LoreReactor export JSON directly. Useful for quick transfers between instances or importing AI-generated text data that matches the export format.
                                        </div>
                                        <textarea
                                            value={pasteText}
                                            onChange={(e) => setPasteText(e.target.value)}
                                            placeholder='{"version": 2, "exportedAt": "...", "characters": [...], ...}'
                                            className="editor-textarea"
                                            rows={12}
                                            style={{ fontFamily: 'monospace', fontSize: '0.7rem', resize: 'vertical' }}
                                        />
                                        <button
                                            type="button"
                                            className="editor-button editor-button-save"
                                            onClick={handlePasteImport}
                                            disabled={!pasteText}
                                        >
                                            Parse & Preview
                                        </button>
                                    </div>
                                )}

                                {/* JSON Schema */}
                                {activeSource === 'schema' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                                            Generate a JSON schema wrapped in the LoreReactor export envelope. Copy and paste into an AI prompt to get correctly structured output that can be imported directly via the "Paste JSON" tab.
                                        </div>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '4px' }}>Include Entity Types:</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                            {SCHEMA_ENTITY_OPTIONS.map(entity => (
                                                <label key={entity} className="editor-checkbox-label" style={{ margin: 0 }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={schemaEntities.includes(entity)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSchemaEntities(prev => [...prev, entity]);
                                                            } else {
                                                                setSchemaEntities(prev => prev.filter(x => x !== entity));
                                                            }
                                                        }}
                                                        className="editor-checkbox-input"
                                                    />
                                                    <span style={{ fontSize: '0.7rem' }}>{entity}</span>
                                                </label>
                                            ))}
                                        </div>
                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                            <button
                                                type="button"
                                                className="editor-button editor-button-save"
                                                onClick={handleCopySchema}
                                                disabled={schemaEntities.length === 0}
                                                style={{ flex: 1 }}
                                            >
                                                {schemaCopied ? '✅ Copied!' : '📋 Copy Schema to Clipboard'}
                                            </button>
                                        </div>
                                        {schemaEntities.length === 0 && (
                                            <div style={{ fontSize: '0.65rem', opacity: 0.5, fontStyle: 'italic' }}>Select at least one entity type to generate a schema.</div>
                                        )}
                                        {wrappedSchemaText && (
                                            <pre style={{
                                                background: 'var(--social-bg)',
                                                border: '1px solid var(--border)',
                                                borderRadius: '6px',
                                                padding: '10px',
                                                fontSize: '0.6rem',
                                                fontFamily: 'monospace',
                                                whiteSpace: 'pre-wrap',
                                                wordBreak: 'break-word',
                                                maxHeight: '400px',
                                                overflowY: 'auto',
                                                color: 'var(--text-h)',
                                                margin: 0,
                                            }}>{wrappedSchemaText}</pre>
                                        )}
                                    </div>
                                )}
                            </>
                        )}

                        {parsedData && !importResult && !isImporting && (
                            <>
                                <div className="editor-section">
                                    <span className="editor-section-title">Select Items to Import</span>
                                    <div className="entity-ref-hint">
                                        {activeSource === 'file' ? `File exported: ${new Date(parsedData.exportedAt).toLocaleString()}.` : 'Pasted JSON loaded.'} Click items to deselect. Only selected items will be imported.
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
                                        <EntitySelectList label="Worlds" items={parsedData.worlds || []} selectedIds={selectedWorldIds}
                                            onToggle={(id) => toggle(selectedWorldIds, setSelectedWorldIds, id)} searchQuery={worldSearch} onSearchChange={setWorldSearch} />
                                    )}
                                    {parsedData.languageModels.length > 0 && (
                                        <EntitySelectList label="Language Models" items={parsedData.languageModels} selectedIds={selectedLanguageModelIds}
                                            onToggle={(id) => toggle(selectedLanguageModelIds, setSelectedLanguageModelIds, id)} searchQuery={languageModelSearch} onSearchChange={setLanguageModelSearch} />
                                    )}
                                    {(parsedData.spatiotemporalModels?.length ?? 0) > 0 && (
                                        <EntitySelectList label="Spatiotemporal Models" items={parsedData.spatiotemporalModels || []} selectedIds={selectedSpatiotemporalModelIds}
                                            onToggle={(id) => toggle(selectedSpatiotemporalModelIds, setSelectedSpatiotemporalModelIds, id)} searchQuery={spatiotemporalModelSearch} onSearchChange={setSpatiotemporalModelSearch} />
                                    )}
                                    {parsedData.tokenSamplers.length > 0 && (
                                        <EntitySelectList label="Samplers" items={parsedData.tokenSamplers} selectedIds={selectedSamplerIds}
                                            onToggle={(id) => toggle(selectedSamplerIds, setSelectedSamplerIds, id)} searchQuery={tokenSamplerSearch} onSearchChange={setSamplerSearch} />
                                    )}
                                    {parsedData.promptBlocks.length > 0 && (
                                        <EntitySelectList label="Prompt Blocks" items={parsedData.promptBlocks} selectedIds={selectedPromptBlockIds}
                                            onToggle={(id) => toggle(selectedPromptBlockIds, setSelectedPromptBlockIds, id)} searchQuery={promptBlockSearch} onSearchChange={setPromptBlockSearch} />
                                    )}
                                    {parsedData.stopPatterns.length > 0 && (
                                        <EntitySelectList label="Stop Patterns" items={parsedData.stopPatterns} selectedIds={selectedStopPatternIds}
                                            onToggle={(id) => toggle(selectedStopPatternIds, setSelectedStopPatternIds, id)} searchQuery={stopPatternSearch} onSearchChange={setStopPatternSearch} />
                                    )}
                                    {(parsedData.retrievalConfigurations?.length ?? 0) > 0 && (
                                        <EntitySelectList label="Retrieval Configurations" items={parsedData.retrievalConfigurations || []} selectedIds={selectedRetrievalConfigurationIds}
                                            onToggle={(id) => toggle(selectedRetrievalConfigurationIds, setSelectedRetrievalConfigurationIds, id)} searchQuery={retrievalConfigurationSearch} onSearchChange={setRetrievalConfigurationSearch} />
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
                                        <EntitySelectList label="Memories" items={parsedData.memories || []} selectedIds={selectedMemoryIds}
                                            onToggle={(id) => toggle(selectedMemoryIds, setSelectedMemoryIds, id)} searchQuery={memorySearch} onSearchChange={setMemorySearch} />
                                    )}
                                    {(parsedData.accounts?.length ?? 0) > 0 && (
                                        <EntitySelectList label="Accounts" items={parsedData.accounts || []} selectedIds={selectedAccountIds}
                                            onToggle={(id) => toggle(selectedAccountIds, setSelectedAccountIds, id)} searchQuery={accountSearch} onSearchChange={setAccountSearch} />
                                    )}
                                    {(parsedData.multiplayerData?.length ?? 0) > 0 && (
                                        <EntitySelectList label="Multiplayer Data" items={parsedData.multiplayerData || []} selectedIds={selectedMultiplayerDataIds}
                                            onToggle={(id) => toggle(selectedMultiplayerDataIds, setSelectedMultiplayerDataIds, id)} searchQuery={multiplayerDataSearch} onSearchChange={setMultiplayerDataSearch} />
                                    )}
                                    {(parsedData.entityFolders?.length ?? 0) > 0 && (
                                        <EntitySelectList label="Entity Folders" items={parsedData.entityFolders || []} selectedIds={selectedEntityFolderIds}
                                            onToggle={(id) => toggle(selectedEntityFolderIds, setSelectedEntityFolderIds, id)} searchQuery={entityFolderSearch} onSearchChange={setEntityFolderSearch} />
                                    )}

                                    <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <span className="editor-section-title" style={{ fontSize: '0.8rem' }}>Singleton Data</span>
                                        {parsedData.interjectableActions.length > 0 && (
                                            <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                                <input type="checkbox" checked={includeActions} onChange={e => setIncludeActions(e.target.checked)} className="editor-checkbox-input" />
                                                <span>Interjectable Actions ({parsedData.interjectableActions.length})</span>
                                            </label>
                                        )}
                                        {parsedData.actionFormatData && (
                                            <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                                <input type="checkbox" checked={includeActionFormatData} onChange={e => setIncludeActionFormatData(e.target.checked)} className="editor-checkbox-input" />
                                                <span>Action Format Data</span>
                                            </label>
                                        )}
                                        {parsedData.formatPreferences && (
                                            <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                                <input type="checkbox" checked={includeFormatPreferences} onChange={e => setIncludeFormatPreferences(e.target.checked)} className="editor-checkbox-input" />
                                                <span>Format Preferences</span>
                                            </label>
                                        )}
                                        {(parsedData.sessionData || parsedData.multiplayerJoinData) && (
                                            <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                                <input type="checkbox" checked={includeSessionData} onChange={e => setIncludeSessionData(e.target.checked)} className="editor-checkbox-input" />
                                                <span>Session & Multiplayer Join Data</span>
                                            </label>
                                        )}
                                        {parsedData.budgetData && (
                                            <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                                <input type="checkbox" checked={includeBudgetData} onChange={e => setIncludeBudgetData(e.target.checked)} className="editor-checkbox-input" />
                                                <span>Budget Data (Includes Factorization Machine state)</span>
                                            </label>
                                        )}
                                    </div>
                                </div>

                                <div className="entity-action-buttons">
                                    <button type="button" className="editor-button editor-button-cancel" onClick={reset}>Choose Different Source</button>
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
                                        <div><strong>Language Models:</strong> {importResult.counts.languageModels}</div>
                                        <div><strong>Spatiotemporal Models:</strong> {importResult.counts.spatiotemporalModels ?? 0}</div>
                                        <div><strong>Samplers:</strong> {importResult.counts.tokenSamplers}</div>
                                        <div><strong>Prompt Blocks:</strong> {importResult.counts.promptBlocks}</div>
                                        <div><strong>Stop Patterns:</strong> {importResult.counts.stopPatterns}</div>
                                        <div><strong>Retrieval Configurations:</strong> {importResult.counts.retrievalConfigurations ?? 0}</div>
                                        <div><strong>Budget Strategies:</strong> {importResult.counts.budgetStrategies}</div>
                                        <div><strong>Profiles:</strong> {importResult.counts.profiles}</div>
                                        <div><strong>Memories:</strong> {importResult.counts.memories ?? 0}</div>
                                        <div><strong>Accounts:</strong> {importResult.counts.accounts ?? 0}</div>
                                        <div><strong>Multiplayer Data:</strong> {importResult.counts.multiplayerData ?? 0}</div>
                                        <div><strong>Entity Folders:</strong> {importResult.counts.entityFolders ?? 0}</div>
                                        <div><strong>Actions:</strong> {importResult.counts.interjectableActions}</div>
                                        <div><strong>Format Preferences:</strong> {importResult.counts.formatPreferences}</div>
                                    </div>
                                </div>

                                {importResult.errors.length > 0 && (
                                    <div className="editor-section">
                                        <span className="editor-section-title">Errors ({importResult.errors.length})</span>
                                        <div className="entity-error-list">
                                            {importResult.errors.map((err, i) => (
                                                <div key={i} className="entity-error-item">• {err}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="entity-import-done-hint">Refresh the page or reopen managers to see imported data.</div>
                            </>
                        )}
                    </div>
                </FileDropArea>
            </div>
        </div>
    );
}