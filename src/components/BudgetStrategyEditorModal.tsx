// src/components/BudgetStrategyEditorModal.tsx
import { useState } from 'react';
import type { BudgetStrategy, LanguageModel } from '../types';
import { EntitySelectList } from './EntitySelectList';
import { v4 as uuidv4 } from 'uuid';
import '../main.css';

interface BudgetStrategyEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (strategy: BudgetStrategy) => void;
    onDelete?: (id: string) => void;
    existingStrategy?: BudgetStrategy | null;
    allModels: LanguageModel[];
}

type BudgetTabId = 'general' | 'tiers' | 'activation';

const TIER_AXIS_LABELS: Record<string, { label: string; description: string }> = {
    cost: {
        label: 'Cost Tier',
        description: 'Lower = cheaper. Models with lower cost tiers are preferred when quality tiers are equal.',
    },
    latency: {
        label: 'Latency Tier (ms/token)',
        description: 'Expected ms per token. Lower = faster. Used as secondary ranking signal.',
    },
    ttft: {
        label: 'TTFT Tier (ms)',
        description: 'Expected time to first token. Lower = faster initial response.',
    },
    quality: {
        label: 'Quality Tier',
        description: 'Higher = better output quality. Primary ranking signal — higher quality models are tried first.',
    },
};

function BudgetStrategyEditorContent({
    existingStrategy,
    allModels,
    onClose,
    onSave,
}: {
    existingStrategy: BudgetStrategy | null;
    allModels: LanguageModel[];
    onClose: () => void;
    onSave: (strategy: BudgetStrategy) => void;
}) {
    const [activeTab, setActiveTab] = useState<BudgetTabId>('general');

    const [name, setName] = useState(existingStrategy?.name || '');
    const [description, setDescription] = useState(existingStrategy?.description || '');
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>(
        existingStrategy?.modelIds ?? []
    );
    const [maximumBudget, setMaximumBudget] = useState<number>(existingStrategy?.maximumBudget ?? 10);
    const [errors, setErrors] = useState<{ name?: string }>({});
    const [modelSearch, setModelSearch] = useState('');

    // ─── Per-Model Tier State ────────────────────────────────────────
    const [modelCostTiers, setModelCostTiers] = useState<Record<string, number>>(
        existingStrategy?.modelCostTiers ? { ...existingStrategy.modelCostTiers } : {}
    );
    const [modelLatencyTiers, setModelLatencyTiers] = useState<Record<string, number>>(
        existingStrategy?.modelLatencyMsPerTokenTiers ? { ...existingStrategy.modelLatencyMsPerTokenTiers } : {}
    );
    const [modelTTFTTiers, setModelTTFTTiers] = useState<Record<string, number>>(
        existingStrategy?.modelTimeToFirstTokenTiers ? { ...existingStrategy.modelTimeToFirstTokenTiers } : {}
    );
    const [modelQualityTiers, setModelQualityTiers] = useState<Record<string, number>>(
        existingStrategy?.modelQualityTiers ? { ...existingStrategy.modelQualityTiers } : {}
    );

    // ─── Per-Model Activation/Deactivation Context Windows ───────────
    const [modelActivationContextSize, setModelActivationContextSize] = useState<Record<string, number>>(
        existingStrategy?.modelActivationContextSize ? { ...existingStrategy.modelActivationContextSize } : {}
    );
    const [modelDeactivationContextSize, setModelDeactivationContextSize] = useState<Record<string, number>>(
        existingStrategy?.modelDeactivationContextSize ? { ...existingStrategy.modelDeactivationContextSize } : {}
    );

    const toggleModel = (id: string) => {
        setSelectedModelIds(prev => {
            if (prev.includes(id)) {
                setModelCostTiers(t => { const u = { ...t }; delete u[id]; return u; });
                setModelLatencyTiers(t => { const u = { ...t }; delete u[id]; return u; });
                setModelTTFTTiers(t => { const u = { ...t }; delete u[id]; return u; });
                setModelQualityTiers(t => { const u = { ...t }; delete u[id]; return u; });
                setModelActivationContextSize(t => { const u = { ...t }; delete u[id]; return u; });
                setModelDeactivationContextSize(t => { const u = { ...t }; delete u[id]; return u; });
                return prev.filter(x => x !== id);
            }
            return [...prev, id];
        });
    };

    const setTierValue = (
        setter: React.Dispatch<React.SetStateAction<Record<string, number>>>,
        modelId: string,
        value: string,
    ) => {
        const num = Number.parseFloat(value);
        setter(prev => {
            if (value === '' || Number.isNaN(num)) {
                const updated = { ...prev };
                delete updated[modelId];
                return updated;
            }
            return { ...prev, [modelId]: num };
        });
    };

    const validate = (): boolean => {
        const newErrors: { name?: string } = {};
        if (!name.trim()) newErrors.name = 'Name is required.';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const filterTiersToSelected = (tiers: Record<string, number>): Record<string, number> => {
        const selected = new Set(selectedModelIds);
        const filtered: Record<string, number> = {};
        for (const [id, val] of Object.entries(tiers)) {
            if (selected.has(id)) filtered[id] = val;
        }
        return filtered;
    };

    const buildStrategy = (cloneNameSuffix?: string): BudgetStrategy | null => {
        if (!validate()) return null;
        if (selectedModelIds.length === 0) return null;

        const now = Date.now();
        return {
            id: cloneNameSuffix ? uuidv4() : (existingStrategy?.id || uuidv4()),
            name: cloneNameSuffix ? `${name.trim()} ${cloneNameSuffix}` : name.trim(),
            description: description.trim() || '',
            modelIds: [...selectedModelIds],
            modelCostTiers: filterTiersToSelected(modelCostTiers),
            modelLatencyMsPerTokenTiers: filterTiersToSelected(modelLatencyTiers),
            modelTimeToFirstTokenTiers: filterTiersToSelected(modelTTFTTiers),
            modelQualityTiers: filterTiersToSelected(modelQualityTiers),
            modelActivationContextSize: filterTiersToSelected(modelActivationContextSize),
            modelDeactivationContextSize: filterTiersToSelected(modelDeactivationContextSize),
            maximumBudget,
            firstCreatedTimestamp: cloneNameSuffix ? now : (existingStrategy?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = () => {
        const strategy = buildStrategy();
        if (!strategy) return;
        onSave(strategy);
        onClose();
    };

    const handleClone = () => {
        const strategy = buildStrategy('(Clone)');
        if (!strategy) return;
        onSave(strategy);
        onClose();
    };

    const renderTierColumn = (
        axisKey: string,
        tiers: Record<string, number>,
        setter: React.Dispatch<React.SetStateAction<Record<string, number>>>,
        placeholder: string,
    ) => {
        const config = TIER_AXIS_LABELS[axisKey];
        const models = allModels.filter(m => selectedModelIds.includes(m.id));
        if (models.length === 0) return null;

        return (
            <div style={{ flex: 1, minWidth: '120px' }}>
                <label className="editor-label editor-label-small" style={{ display: 'block', marginBottom: '2px' }}>
                    {config.label}
                </label>
                <div style={{ fontSize: '0.5rem', opacity: 0.5, marginBottom: '6px' }}>
                    {config.description}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {models.map(model => (
                        <div key={model.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{
                                fontSize: '0.6rem', opacity: 0.7, flex: 1, minWidth: 0,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                                {model.name}
                            </span>
                            <input
                                type="text"
                                inputMode="decimal"
                                pattern="[0-9]*\.?[0-9]*"
                                value={tiers[model.id] ?? ''}
                                onChange={(e) => setTierValue(setter, model.id, e.target.value)}
                                className="editor-input"
                                placeholder={placeholder}
                                style={{
                                    width: '52px', flexShrink: 0, padding: '2px 4px',
                                    fontSize: '0.65rem', MozAppearance: 'textfield',
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderActivationColumn = () => {
        const models = allModels.filter(m => selectedModelIds.includes(m.id));
        if (models.length === 0) return null;

        return (
            <>
                <div style={{ flex: 1, minWidth: '120px' }}>
                    <label className="editor-label editor-label-small" style={{ display: 'block', marginBottom: '2px' }}>
                        Activation Tokens
                    </label>
                    <div style={{ fontSize: '0.5rem', opacity: 0.5, marginBottom: '6px' }}>
                        Model becomes eligible when prompt reaches this many tokens. 0 = always active.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {models.map(model => (
                            <div key={model.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{
                                    fontSize: '0.6rem', opacity: 0.7, flex: 1, minWidth: 0,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {model.name}
                                </span>
                                <input
                                    type="number"
                                    value={modelActivationContextSize[model.id] ?? ''}
                                    onChange={(e) => setTierValue(setModelActivationContextSize, model.id, e.target.value)}
                                    className="editor-input"
                                    placeholder="0"
                                    min="0"
                                    step="256"
                                    style={{
                                        width: '64px', flexShrink: 0, padding: '2px 4px',
                                        fontSize: '0.65rem', MozAppearance: 'textfield',
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ flex: 1, minWidth: '120px' }}>
                    <label className="editor-label editor-label-small" style={{ display: 'block', marginBottom: '2px' }}>
                        Deactivation Tokens
                    </label>
                    <div style={{ fontSize: '0.5rem', opacity: 0.5, marginBottom: '6px' }}>
                        Model becomes ineligible when prompt exceeds this. Empty = never deactivates.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {models.map(model => (
                            <div key={model.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{
                                    fontSize: '0.6rem', opacity: 0.7, flex: 1, minWidth: 0,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {model.name}
                                </span>
                                <input
                                    type="number"
                                    value={modelDeactivationContextSize[model.id] ?? ''}
                                    onChange={(e) => setTierValue(setModelDeactivationContextSize, model.id, e.target.value)}
                                    className="editor-input"
                                    placeholder="∞"
                                    min="0"
                                    step="256"
                                    style={{
                                        width: '64px', flexShrink: 0, padding: '2px 4px',
                                        fontSize: '0.65rem', MozAppearance: 'textfield',
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </>
        );
    };

    const budgetTabs: { id: BudgetTabId; label: string; icon: string }[] = [
        { id: 'general', label: 'General', icon: '📝' },
        { id: 'tiers', label: 'Tiers', icon: '📊' },
        { id: 'activation', label: 'Activation', icon: '⚡' },
    ];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingStrategy ? 'Edit Budget Strategy' : 'Create Budget Strategy'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        {existingStrategy && (
                            <button type="button" className="editor-button editor-button-cancel" onClick={handleClone}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit}>
                            Save
                        </button>
                    </div>
                </div>

                {/* Tab Bar */}
                <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                    {budgetTabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                <div className="modal-body editor-modal-body">
                    {/* ─── GENERAL TAB ─── */}
                    {activeTab === 'general' && (
                        <>
                            <div style={{ marginBottom: '16px' }}>
                                <label className="editor-label">
                                    Name <span style={{ color: '#ff4444' }}>*</span>
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        if (errors.name) setErrors({ ...errors, name: undefined });
                                    }}
                                    className={`editor-input ${errors.name ? 'error' : ''}`}
                                    placeholder="e.g., Expensive-First, Graduated Quality, Budget Saver"
                                />
                                {errors.name && <div className="editor-error-message">{errors.name}</div>}
                            </div>

                            <div style={{ marginBottom: '16px' }}>
                                <label className="editor-label">Description</label>
                                <textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="editor-textarea"
                                    placeholder="Describe when to use this strategy"
                                    rows={2}
                                />
                            </div>

                            <div className="editor-section">
                                <span className="editor-section-title">Models</span>
                                <div className="entity-ref-hint">
                                    Select all models to include in this strategy. Both online and local models share a single unified pool. Selection priority is controlled by tiers and activation windows.
                                </div>

                                <EntitySelectList
                                    label="Language Models"
                                    items={allModels}
                                    selectedIds={selectedModelIds}
                                    onToggle={toggleModel}
                                    searchQuery={modelSearch}
                                    onSearchChange={setModelSearch}
                                />
                            </div>

                            <div className="editor-section">
                                <span className="editor-section-title">Budget Control</span>
                                <div className="editor-row-full">
                                    <div>
                                        <label className="editor-label editor-label-small">Maximum Budget ($)</label>
                                        <input
                                            type="number"
                                            value={maximumBudget}
                                            onChange={(e) => setMaximumBudget(Number(e.target.value) || 0)}
                                            className="editor-input"
                                            min="0"
                                            step="0.5"
                                            placeholder="10"
                                        />
                                        <div className="editor-label" style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: '4px' }}>
                                            When spent cost exceeds this, only free models will be used.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* ─── TIERS TAB ─── */}
                    {activeTab === 'tiers' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Model Tiers</span>
                            <div className="entity-ref-hint" style={{ marginBottom: '12px' }}>
                                Configure per-model ranking across four independent axes. Models are ranked by quality tier first (higher = preferred), then cost tier (lower = preferred), then observed performance metrics.
                            </div>

                            {selectedModelIds.length === 0 ? (
                                <div style={{ fontSize: '0.75rem', opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>
                                    No models selected. Add models in the General tab first.
                                </div>
                            ) : (
                                <div style={{
                                    display: 'flex',
                                    gap: '16px',
                                    flexWrap: 'wrap',
                                }}>
                                    {renderTierColumn('quality', modelQualityTiers, setModelQualityTiers, '0')}
                                    {renderTierColumn('cost', modelCostTiers, setModelCostTiers, '0')}
                                    {renderTierColumn('latency', modelLatencyTiers, setModelLatencyTiers, '0')}
                                    {renderTierColumn('ttft', modelTTFTTiers, setModelTTFTTiers, '0')}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ─── ACTIVATION TAB ─── */}
                    {activeTab === 'activation' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Activation Windows</span>
                            <div className="entity-ref-hint" style={{ marginBottom: '12px' }}>
                                Define per-model context size windows. A model is eligible when the current prompt token count is ≥ activation and &lt; deactivation. Use overlapping windows for graduated quality transitions (e.g., expensive model for early turns, free model for later turns).
                            </div>

                            {selectedModelIds.length === 0 ? (
                                <div style={{ fontSize: '0.75rem', opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>
                                    No models selected. Add models in the General tab first.
                                </div>
                            ) : (
                                <div style={{
                                    display: 'flex',
                                    gap: '16px',
                                    flexWrap: 'wrap',
                                }}>
                                    {renderActivationColumn()}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function BudgetStrategyEditorModal({
    isOpen,
    onClose,
    onSave,
    existingStrategy,
    allModels,
}: BudgetStrategyEditorModalProps) {
    if (!isOpen) return null;

    return (
        <BudgetStrategyEditorContent
            key={existingStrategy?.id ?? 'new'}
            existingStrategy={existingStrategy ?? null}
            allModels={allModels}
            onClose={onClose}
            onSave={onSave}
        />
    );
}