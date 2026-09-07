// src/components/BudgetControlModal.tsx
import { useMemo, useState } from 'react';
import type { BudgetStrategy } from '../types';
import { useBudgetDataManager } from '../hooks/useBudgetDataManager';
import './main.css';

interface BudgetControlModalProps {
    isOpen: boolean;
    onClose: () => void;
    allBudgetStrategies: BudgetStrategy[];
    activeStrategy?: BudgetStrategy | null;
}

const RESET_PRESETS = [
    { label: 'No Auto Reset', value: 0 },
    { label: 'Hourly', value: 60 * 60 * 1000 },
    { label: 'Daily', value: 24 * 60 * 60 * 1000 },
    { label: 'Weekly', value: 7 * 24 * 60 * 60 * 1000 },
    { label: 'Monthly (30 days)', value: 30 * 24 * 60 * 60 * 1000 },
];

function formatCost(value: number): string {
    return value.toFixed(4);
}

function formatDuration(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return '—';
    if (ms <= 0) return 'Disabled';

    const totalSeconds = Math.ceil(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;

    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;

    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalHours < 24) return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;

    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function formatTimestamp(ts?: number): string {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleString();
}

function countKeys(obj?: Record<string, number>): number {
    return obj ? Object.keys(obj).length : 0;
}

function getLatestTimestamp(obj?: Record<string, number>): number | undefined {
    if (!obj) return undefined;
    const values = Object.values(obj).filter(v => typeof v === 'number' && v > 0);
    if (values.length === 0) return undefined;
    return Math.max(...values);
}

export function BudgetControlModal({
    isOpen,
    onClose,
    allBudgetStrategies,
    activeStrategy,
}: BudgetControlModalProps) {
    const {
        budgetData,
        isLoading,
        createBudgetData,
        resetBudget,
        setBudgetSpent,
        setResetDuration,
        setBudgetStrategy,
        clearModelLastUsedTimestamps,
        clearQuotaTimestamps,
        clearErrorTimestamps,
        clearAllModelTelemetry,
        getTimeUntilReset,
        getBudgetUsagePercent,
        refresh,
    } = useBudgetDataManager();

    const [selectedStrategyId, setSelectedStrategyId] = useState(activeStrategy?.id || allBudgetStrategies[0]?.id || '');
    const [customResetHours, setCustomResetHours] = useState<number>(24);
    const [manualBudgetSpent, setManualBudgetSpent] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);

    const selectedStrategy = useMemo(() => {
        return allBudgetStrategies.find(s => s.id === selectedStrategyId) || activeStrategy || allBudgetStrategies[0] || null;
    }, [allBudgetStrategies, selectedStrategyId, activeStrategy]);

    const maximumBudget = budgetData?.budgetStrategy?.maximumBudget ?? selectedStrategy?.maximumBudget ?? 0;
    const usagePercent = budgetData ? getBudgetUsagePercent() : 0;
    const timeUntilReset = budgetData ? getTimeUntilReset() : null;

    const latestUsed = getLatestTimestamp(budgetData?.modelLastUsedTimestamps);
    const latestQuota = getLatestTimestamp(budgetData?.modelLastQuotaHitTimeStamps);
    const latestError = getLatestTimestamp(budgetData?.modelLastErrorHitTimeStamps);

    if (!isOpen) return null;

    const runAction = async (action: () => Promise<boolean>, successMessage?: string) => {
        setIsSaving(true);
        try {
            const ok = await action();
            if (ok && successMessage) console.info(successMessage);
            return ok;
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreate = async () => {
        if (!selectedStrategy) return;

        await runAction(
            () => createBudgetData(selectedStrategy, 24 * 60 * 60 * 1000),
            'Budget data created.',
        );
    };

    const handleStrategyChange = async () => {
        if (!selectedStrategy || !budgetData) return;

        await runAction(
            () => setBudgetStrategy(selectedStrategy),
            'Budget strategy updated.',
        );
    };

    const handlePresetResetDuration = async (duration: number) => {
        if (!budgetData) return;

        await runAction(
            () => setResetDuration(duration),
            'Reset duration updated.',
        );
    };

    const handleCustomResetDuration = async () => {
        if (!budgetData) return;

        const duration = Math.max(0, customResetHours) * 60 * 60 * 1000;

        await runAction(
            () => setResetDuration(duration),
            'Custom reset duration updated.',
        );
    };

    const handleManualBudgetSpentSave = async () => {
        if (!budgetData) return;

        const value = Number(manualBudgetSpent);
        if (!Number.isFinite(value) || value < 0) return;

        await runAction(
            () => setBudgetSpent(value),
            'Budget spent updated.',
        );

        setManualBudgetSpent('');
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-content-manager" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Budget Control</h2>
                    <div className="modal-header-actions">
                        <button
                            type="button"
                            className="close-btn close-btn-spaced"
                            onClick={onClose}
                        >
                            ×
                        </button>
                    </div>
                </div>

                <div className="modal-body">
                    {isLoading ? (
                        <div className="empty-state">Loading budget data...</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {/* No Budget Data */}
                            {!budgetData && (
                                <div className="editor-section">
                                    <span className="editor-section-title">Initialize Budget Data</span>

                                    <div className="entity-ref-hint" style={{ marginBottom: '8px' }}>
                                        No global budget data exists yet. Create it from a budget strategy.
                                    </div>

                                    <label className="editor-label editor-label-small">Budget Strategy</label>
                                    <select
                                        className="editor-input"
                                        value={selectedStrategyId}
                                        onChange={e => setSelectedStrategyId(e.target.value)}
                                    >
                                        {allBudgetStrategies.map(strategy => (
                                            <option key={strategy.id} value={strategy.id}>
                                                {strategy.name} — ${formatCost(strategy.maximumBudget)}
                                            </option>
                                        ))}
                                    </select>

                                    {allBudgetStrategies.length === 0 && (
                                        <div className="editor-error-message" style={{ marginTop: '8px' }}>
                                            No budget strategies exist. Create one first.
                                        </div>
                                    )}

                                    <div style={{ marginTop: '12px' }}>
                                        <button
                                            type="button"
                                            className="editor-btn editor-btn-save"
                                            disabled={!selectedStrategy || isSaving}
                                            onClick={handleCreate}
                                        >
                                            Create Budget Data
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Existing Budget Data */}
                            {budgetData && (
                                <>
                                    {/* Overview */}
                                    <div className="editor-section">
                                        <span className="editor-section-title">Overview</span>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Active Strategy:</span>
                                            <span className="chat-stat-detail-value">
                                                {budgetData.budgetStrategy?.name || 'Unknown'}
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Budget Spent:</span>
                                            <span className="chat-stat-detail-value">
                                                ${formatCost(budgetData.budgetSpent)} / ${formatCost(maximumBudget)} ({Math.round(usagePercent)}%)
                                            </span>
                                        </div>

                                        <div className="chat-stat-token-usage" style={{ marginTop: '8px' }}>
                                            <span className="chat-stat-context-bar" style={{ width: '100%' }}>
                                                <span
                                                    className="chat-stat-context-fill"
                                                    style={{
                                                        width: `${usagePercent}%`,
                                                        background: usagePercent >= 95 ? '#ff4444' : usagePercent >= 80 ? '#ffaa00' : undefined,
                                                    }}
                                                />
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row" style={{ marginTop: '8px' }}>
                                            <span className="chat-stat-detail-label">Reset Duration:</span>
                                            <span className="chat-stat-detail-value">
                                                {formatDuration(budgetData.resetDuration)}
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Next Reset:</span>
                                            <span className="chat-stat-detail-value">
                                                {timeUntilReset === null ? 'Disabled' : timeUntilReset <= 0 ? 'Due now' : `in ${formatDuration(timeUntilReset)}`}
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Last Reset:</span>
                                            <span className="chat-stat-detail-value">
                                                {formatTimestamp(budgetData.lastResetTimestamp)}
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Last Updated:</span>
                                            <span className="chat-stat-detail-value">
                                                {formatTimestamp(budgetData.lastUpdatedTimestamp)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Strategy */}
                                    <div className="editor-section">
                                        <span className="editor-section-title">Strategy Binding</span>

                                        <label className="editor-label editor-label-small">Budget Strategy</label>
                                        <select
                                            className="editor-input"
                                            value={selectedStrategyId || budgetData.budgetStrategy?.id || ''}
                                            onChange={e => setSelectedStrategyId(e.target.value)}
                                        >
                                            {allBudgetStrategies.map(strategy => (
                                                <option key={strategy.id} value={strategy.id}>
                                                    {strategy.name} — ${formatCost(strategy.maximumBudget)}
                                                </option>
                                            ))}
                                        </select>

                                        <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                            <button
                                                type="button"
                                                className="editor-btn editor-btn-save"
                                                disabled={!selectedStrategy || isSaving}
                                                onClick={handleStrategyChange}
                                            >
                                                Apply Strategy
                                            </button>

                                            <button
                                                type="button"
                                                className="editor-btn editor-btn-cancel"
                                                disabled={isSaving}
                                                onClick={() => refresh()}
                                            >
                                                Refresh
                                            </button>
                                        </div>
                                    </div>

                                    {/* Manual Budget Editing */}
                                    <div className="editor-section">
                                        <span className="editor-section-title">Budget Editing</span>

                                        <div className="editor-row">
                                            <div>
                                                <label className="editor-label editor-label-small">Set Budget Spent ($)</label>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    className="editor-input"
                                                    placeholder={formatCost(budgetData.budgetSpent)}
                                                    value={manualBudgetSpent}
                                                    onChange={e => setManualBudgetSpent(e.target.value)}
                                                />
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'end' }}>
                                                <button
                                                    type="button"
                                                    className="editor-btn editor-btn-save"
                                                    disabled={isSaving || manualBudgetSpent.trim() === ''}
                                                    onClick={handleManualBudgetSpentSave}
                                                >
                                                    Save Amount
                                                </button>
                                            </div>
                                        </div>

                                        <div style={{ marginTop: '10px' }}>
                                            <button
                                                type="button"
                                                className="editor-btn editor-btn-cancel"
                                                disabled={isSaving}
                                                onClick={() => runAction(resetBudget, 'Budget reset.')}
                                            >
                                                Reset Budget Now
                                            </button>
                                        </div>
                                    </div>

                                    {/* Reset Duration */}
                                    <div className="editor-section">
                                        <span className="editor-section-title">Reset Schedule</span>

                                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                                            {RESET_PRESETS.map(preset => (
                                                <button
                                                    key={preset.label}
                                                    type="button"
                                                    className="editor-btn editor-btn-cancel"
                                                    disabled={isSaving}
                                                    onClick={() => handlePresetResetDuration(preset.value)}
                                                    style={{
                                                        borderColor: budgetData.resetDuration === preset.value ? 'var(--accent)' : undefined,
                                                        color: budgetData.resetDuration === preset.value ? 'var(--accent)' : undefined,
                                                    }}
                                                >
                                                    {preset.label}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="editor-row">
                                            <div>
                                                <label className="editor-label editor-label-small">Custom Duration (Hours)</label>
                                                <input
                                                    type="number"
                                                    className="editor-input"
                                                    min="0"
                                                    step="1"
                                                    value={customResetHours}
                                                    onChange={e => setCustomResetHours(Number(e.target.value) || 0)}
                                                />
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'end' }}>
                                                <button
                                                    type="button"
                                                    className="editor-btn editor-btn-save"
                                                    disabled={isSaving}
                                                    onClick={handleCustomResetDuration}
                                                >
                                                    Apply Custom
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Model Telemetry */}
                                    <div className="editor-section">
                                        <span className="editor-section-title">Model Runtime Data</span>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Used Models:</span>
                                            <span className="chat-stat-detail-value">
                                                {countKeys(budgetData.modelLastUsedTimestamps)}
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Last Model Use:</span>
                                            <span className="chat-stat-detail-value">
                                                {formatTimestamp(latestUsed)}
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Quota Hits:</span>
                                            <span className="chat-stat-detail-value">
                                                {countKeys(budgetData.modelLastQuotaHitTimeStamps)}
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Latest Quota Hit:</span>
                                            <span className="chat-stat-detail-value">
                                                {formatTimestamp(latestQuota)}
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Error Hits:</span>
                                            <span className="chat-stat-detail-value">
                                                {countKeys(budgetData.modelLastErrorHitTimeStamps)}
                                            </span>
                                        </div>

                                        <div className="chat-stat-detail-row">
                                            <span className="chat-stat-detail-label">Latest Error Hit:</span>
                                            <span className="chat-stat-detail-value">
                                                {formatTimestamp(latestError)}
                                            </span>
                                        </div>

                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                                            <button
                                                type="button"
                                                className="editor-btn editor-btn-cancel"
                                                disabled={isSaving}
                                                onClick={() => runAction(clearModelLastUsedTimestamps)}
                                            >
                                                Clear Last Used
                                            </button>

                                            <button
                                                type="button"
                                                className="editor-btn editor-btn-cancel"
                                                disabled={isSaving}
                                                onClick={() => runAction(clearQuotaTimestamps)}
                                            >
                                                Clear Quota Hits
                                            </button>

                                            <button
                                                type="button"
                                                className="editor-btn editor-btn-cancel"
                                                disabled={isSaving}
                                                onClick={() => runAction(clearErrorTimestamps)}
                                            >
                                                Clear Error Hits
                                            </button>

                                            <button
                                                type="button"
                                                className="editor-btn editor-btn-cancel"
                                                disabled={isSaving}
                                                onClick={() => runAction(clearAllModelTelemetry)}
                                                style={{ color: '#ff7777' }}
                                            >
                                                Clear All Telemetry
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}