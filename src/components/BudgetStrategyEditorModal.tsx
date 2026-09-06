// src/components/BudgetStrategyEditorModal.tsx
import { useState, useEffect } from 'react';
import type { BudgetStrategy, LanguageModel } from '../types';
import { SliderInput } from './SliderInput';
import { EntitySelectList } from './EntitySelectList';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

interface BudgetStrategyEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (strategy: BudgetStrategy) => void;
    onDelete?: (id: string) => void;
    existingStrategy?: BudgetStrategy | null;
    allModels: LanguageModel[];
}

export function BudgetStrategyEditorModal({
    isOpen,
    onClose,
    onSave,
    existingStrategy,
    allModels,
}: BudgetStrategyEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [onlineModelIds, setOnlineModelIds] = useState<string[]>([]);
    const [localModelIds, setLocalModelIds] = useState<string[]>([]);
    const [switchProbability, setSwitchProbability] = useState<number>(20);
    const [switchOnContextSize, setSwitchOnContextSize] = useState<number>(8192);
    const [switchOnComplexityScore, setSwitchOnComplexityScore] = useState<number>(70);
    const [fallbackOnLocalFailure, setFallbackOnLocalFailure] = useState<boolean>(true);
    const [fallbackOnQualityThreshold, setFallbackOnQualityThreshold] = useState<number>(30);
    const [fallbackOnTimeoutInSeconds, setFallbackOnTimeoutInSeconds] = useState<number>(30);
    const [maximumBudget, setMaximumBudget] = useState<number>(10);
    const [errors, setErrors] = useState<{ name?: string; onlineModels?: string; localModels?: string }>({});

    // Search state for each EntitySelectList
    const [onlineSearch, setOnlineSearch] = useState('');
    const [localSearch, setLocalSearch] = useState('');

    useEffect(() => {
        if (isOpen) {
            if (existingStrategy) {
                setName(existingStrategy.name || '');
                setDescription(existingStrategy.description || '');
                setOnlineModelIds(existingStrategy.onlineModels?.map(m => m.id) || []);
                setLocalModelIds(existingStrategy.localModels?.map(m => m.id) || []);
                setSwitchProbability(existingStrategy.switchProbability ?? 20);
                setSwitchOnContextSize(existingStrategy.switchOnContextSize ?? 8192);
                setSwitchOnComplexityScore(existingStrategy.switchOnComplexityScore ?? 70);
                setFallbackOnLocalFailure(existingStrategy.fallbackOnLocalFailure ?? true);
                setFallbackOnQualityThreshold(existingStrategy.fallbackOnQualityThreshold ?? 30);
                setFallbackOnTimeoutInSeconds(existingStrategy.fallbackOnTimeoutInSeconds ?? 30);
                setMaximumBudget(existingStrategy.maximumBudget ?? 10);
            } else {
                setName('');
                setDescription('');
                setOnlineModelIds([]);
                setLocalModelIds([]);
                setSwitchProbability(20);
                setSwitchOnContextSize(8192);
                setSwitchOnComplexityScore(70);
                setFallbackOnLocalFailure(true);
                setFallbackOnQualityThreshold(30);
                setFallbackOnTimeoutInSeconds(30);
                setMaximumBudget(10);
            }
            setOnlineSearch('');
            setLocalSearch('');
            setErrors({});
        }
    }, [isOpen, existingStrategy]);

    const toggleOnlineModel = (id: string) => {
        setOnlineModelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
        if (errors.onlineModels) setErrors(prev => ({ ...prev, onlineModels: undefined }));
    };

    const toggleLocalModel = (id: string) => {
        setLocalModelIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
        if (errors.localModels) setErrors(prev => ({ ...prev, localModels: undefined }));
    };

    const validate = (): boolean => {
        const newErrors: { name?: string; onlineModels?: string; localModels?: string } = {};
        
        if (!name.trim()) newErrors.name = 'Name is required.';
        if (onlineModelIds.length === 0) newErrors.onlineModels = 'At least one online model is required.';
        if (localModelIds.length === 0) newErrors.localModels = 'At least one local model is required.';
        
        // Check for overlap between pools
        const overlap = onlineModelIds.some(id => localModelIds.includes(id));
        if (overlap) {
            newErrors.onlineModels = 'A model cannot be in both online and local pools.';
            newErrors.localModels = 'A model cannot be in both online and local pools.';
        }
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const buildStrategy = (cloneNameSuffix?: string): BudgetStrategy | null => {
        if (!validate()) return null;

        const onlineModels = allModels.filter(m => onlineModelIds.includes(m.id));
        const localModels = allModels.filter(m => localModelIds.includes(m.id));

        if (onlineModels.length === 0 || localModels.length === 0) {
            alert('Selected models not found.');
            return null;
        }

        const now = Date.now();
        return {
            id: cloneNameSuffix ? uuidv4() : (existingStrategy?.id || uuidv4()),
            name: cloneNameSuffix ? `${name.trim()} ${cloneNameSuffix}` : name.trim(),
            description: description.trim() || '',
            onlineModels,
            localModels,
            switchProbability,
            switchOnContextSize,
            switchOnComplexityScore,
            fallbackOnLocalFailure,
            fallbackOnQualityThreshold,
            fallbackOnTimeoutInSeconds,
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

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingStrategy ? 'Edit Budget Strategy' : 'Create Budget Strategy'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose}>Cancel</button>
                        {existingStrategy && (
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit}>
                            Save
                        </button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {/* Name */}
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
                            placeholder="e.g., Balanced, Budget Saver, Quality Focused"
                        />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    {/* Description */}
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

                    {/* Model Selection Pools */}
                    <div className="editor-section">
                        <span className="editor-section-title">Model Pools</span>
                        <div className="entity-ref-hint">
                            Select models for each pool. The engine exhausts the primary pool before falling back. Order determines priority.
                        </div>

                        <EntitySelectList
                            label="Online Models"
                            items={allModels}
                            selectedIds={onlineModelIds}
                            onToggle={toggleOnlineModel}
                            searchQuery={onlineSearch}
                            onSearchChange={setOnlineSearch}
                        />
                        {errors.onlineModels && <div className="editor-error-message">{errors.onlineModels}</div>}

                        <EntitySelectList
                            label="Local Models"
                            items={allModels}
                            selectedIds={localModelIds}
                            onToggle={toggleLocalModel}
                            searchQuery={localSearch}
                            onSearchChange={setLocalSearch}
                        />
                        {errors.localModels && <div className="editor-error-message">{errors.localModels}</div>}
                    </div>

                    {/* Switching Rules */}
                    <div className="editor-section">
                        <span className="editor-section-title">Switching Rules</span>
                        
                        <div className="editor-row-full">
                            <SliderInput
                                label="Online Model Probability"
                                value={switchProbability}
                                minimumValue={0}
                                maximumValue={100}
                                stepValue={1}
                                decimals={0}
                                onChange={setSwitchProbability}
                                description="Percentage chance to use online pool (0 = always local, 100 = always online)"
                            />
                        </div>

                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Switch On Context Size</label>
                                <input
                                    type="number"
                                    value={switchOnContextSize}
                                    onChange={(e) => setSwitchOnContextSize(Number(e.target.value) || 0)}
                                    className="editor-input"
                                    min="0"
                                    step="64"
                                    placeholder="8192"
                                />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Switch On Complexity Score</label>
                                <input
                                    type="number"
                                    value={switchOnComplexityScore}
                                    onChange={(e) => setSwitchOnComplexityScore(Number(e.target.value) || 0)}
                                    className="editor-input"
                                    min="0"
                                    max="100"
                                    step="1"
                                    placeholder="70"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Fallback Rules */}
                    <div className="editor-section">
                        <span className="editor-section-title">Fallback Rules</span>
                        
                        <div className="editor-row">
                            <div>
                                <label className="editor-label editor-label-small">Quality Threshold</label>
                                <input
                                    type="number"
                                    value={fallbackOnQualityThreshold}
                                    onChange={(e) => setFallbackOnQualityThreshold(Number(e.target.value) || 0)}
                                    className="editor-input"
                                    min="0"
                                    max="100"
                                    step="1"
                                    placeholder="30"
                                />
                            </div>
                            <div>
                                <label className="editor-label editor-label-small">Fallback Timeout (Seconds)</label>
                                <input
                                    type="number"
                                    value={fallbackOnTimeoutInSeconds}
                                    onChange={(e) => setFallbackOnTimeoutInSeconds(Number(e.target.value) || 0)}
                                    className="editor-input"
                                    min="1"
                                    step="1"
                                    placeholder="30"
                                />
                            </div>
                        </div>

                        <div className="editor-row-full" style={{ marginTop: '8px' }}>
                            <label className="editor-checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={fallbackOnLocalFailure}
                                    onChange={(e) => setFallbackOnLocalFailure(e.target.checked)}
                                    className="editor-checkbox-input"
                                />
                                <span>Fallback on local failure</span>
                            </label>
                        </div>
                    </div>

                    {/* Budget Control */}
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
                                    When cost exceeds this, the strategy will switch to local-only mode
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}