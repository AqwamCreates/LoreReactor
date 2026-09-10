// src/components/BudgetControlModal.tsx
import { useMemo, useState } from 'react';
import type { BudgetStrategy } from '../types';
import { useBudgetDataManager } from '../hooks/useBudgetDataManager';
import './main.css';

interface BudgetControlModalProps {
    isOpen: boolean;
    onClose: () => void;
    activeStrategy?: BudgetStrategy | null;
}

const RESET_PRESETS = [
    { label: 'Off', value: 0 },
    { label: 'Hourly', value: 60 * 60 * 1000 },
    { label: 'Daily', value: 24 * 60 * 60 * 1000 },
    { label: 'Weekly', value: 7 * 24 * 60 * 60 * 1000 },
    { label: 'Monthly', value: 30 * 24 * 60 * 60 * 1000 },
];

type SortField = 'name' | 'speed' | 'ttft' | 'reliability' | 'spent' | 'uses' | 'errors' | 'censorship' | 'broken' | 'duration';
type SortDirection = 'asc' | 'desc';

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

function formatSessionDuration(ms: number): string {
    if (!ms || ms <= 0) return '—';
    const totalSeconds = Math.round(ms / 1000);
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

function formatMs(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
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

interface ModelRow {
    id: string;
    name: string;
    speed: number;
    ttft: number;
    uses: number;
    quotaHits: number;
    errorHits: number;
    censorshipHits: number;
    brokenHits: number;
    reliability: number;
    spent: number;
    lastUsed: number;
    totalSessionDuration: number;
}

export function BudgetControlModal({
    isOpen,
    onClose,
    activeStrategy,
}: BudgetControlModalProps) {
    const {
        budgetData,
        isLoading,
        createBudgetData,
        resetBudget,
        setBudgetSpent,
        setResetDuration,
        clearModelLastUsedTimestamps,
        clearQuotaTimestamps,
        clearErrorTimestamps,
        clearAllModelTelemetry,
        getTimeUntilReset,
        getBudgetUsagePercent,
        refresh,
    } = useBudgetDataManager();

    const [customResetHours, setCustomResetHours] = useState<number>(24);
    const [budgetAdjustAmount, setBudgetAdjustAmount] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [speedAlpha, setSpeedAlpha] = useState<string>('');
    const [ttftAlpha, setTtftAlpha] = useState<string>('');
    const [sortField, setSortField] = useState<SortField>('uses');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    // Always use the active strategy from props — no local override
    const currentStrategy = activeStrategy ?? null;

    // Build a set of model IDs that belong to the active strategy
    const strategyModelIds = useMemo(() => {
        const ids = new Set<string>();
        if (currentStrategy) {
            for (const m of currentStrategy.onlineModels) ids.add(m.id);
            for (const m of currentStrategy.localModels) ids.add(m.id);
        }
        return ids;
    }, [currentStrategy]);

    // Build a name map from the active strategy's models
    const strategyNameMap = useMemo(() => {
        const map = new Map<string, string>();
        if (currentStrategy) {
            for (const m of currentStrategy.onlineModels) map.set(m.id, m.name);
            for (const m of currentStrategy.localModels) map.set(m.id, m.name);
        }
        return map;
    }, [currentStrategy]);

    const maximumBudget = budgetData?.budgetStrategy?.maximumBudget ?? currentStrategy?.maximumBudget ?? 0;
    const usagePercent = budgetData ? getBudgetUsagePercent() : 0;
    const timeUntilReset = budgetData ? getTimeUntilReset() : null;

    const latestUsed = getLatestTimestamp(budgetData?.modelLastUsedTimestamps);
    const latestQuota = getLatestTimestamp(budgetData?.modelLastQuotaHitTimeStamps);
    const latestError = getLatestTimestamp(budgetData?.modelLastErrorHitTimeStamps);

    const modelRows = useMemo<ModelRow[]>(() => {
        if (!budgetData) return [];

        // Only include models that are in the active strategy
        // If no active strategy, show nothing
        if (strategyModelIds.size === 0) return [];

        const rows: ModelRow[] = [];
        for (const id of strategyModelIds) {
            const uses = budgetData.modelUsedCount?.[id] ?? 0;
            const quotaHits = budgetData.modelQuotaHitCount?.[id] ?? 0;
            const errorHits = budgetData.modelErrorHitCount?.[id] ?? 0;
            const censorshipHits = budgetData.modelCensorshipHitCount?.[id] ?? 0;
            const brokenHits = budgetData.modelBrokenCount?.[id] ?? 0;
            const totalHits = quotaHits + errorHits;
            const reliability = uses > 0 ? Math.min(1, totalHits / uses) : 0;
            rows.push({
                id,
                name: strategyNameMap.get(id) || id.substring(0, 8),
                speed: budgetData.modelAverageLatencyMsPerToken?.[id] ?? Number.POSITIVE_INFINITY,
                ttft: budgetData.modelAverageTimeToFirstToken?.[id] ?? Number.POSITIVE_INFINITY,
                uses,
                quotaHits,
                errorHits,
                censorshipHits,
                brokenHits,
                reliability,
                spent: budgetData.modelBudgetSpent?.[id] ?? 0,
                lastUsed: budgetData.modelLastUsedTimestamps?.[id] ?? 0,
                totalSessionDuration: budgetData.modelTotalSessionDuration?.[id] ?? 0,
            });
        }
        return rows;
    }, [budgetData, strategyModelIds, strategyNameMap]);

    const aggregateStats = useMemo(() => {
        const totalUses = modelRows.reduce((sum, r) => sum + r.uses, 0);
        const totalQuotaHits = modelRows.reduce((sum, r) => sum + r.quotaHits, 0);
        const totalErrorHits = modelRows.reduce((sum, r) => sum + r.errorHits, 0);
        const totalCensorshipHits = modelRows.reduce((sum, r) => sum + r.censorshipHits, 0);
        const totalBrokenHits = modelRows.reduce((sum, r) => sum + r.brokenHits, 0);
        const totalSpent = modelRows.reduce((sum, r) => sum + r.spent, 0);
        const totalDuration = modelRows.reduce((sum, r) => sum + r.totalSessionDuration, 0);
        const speedValues = modelRows.filter(r => Number.isFinite(r.speed) && r.speed > 0).map(r => r.speed);
        const ttftValues = modelRows.filter(r => Number.isFinite(r.ttft) && r.ttft > 0).map(r => r.ttft);
        const avgSpeed = speedValues.length > 0 ? speedValues.reduce((a, b) => a + b, 0) / speedValues.length : 0;
        const avgTtft = ttftValues.length > 0 ? ttftValues.reduce((a, b) => a + b, 0) / ttftValues.length : 0;
        const overallReliability = totalUses > 0 ? Math.min(1, (totalQuotaHits + totalErrorHits) / totalUses) : 0;
        const successfulCount = Math.max(0, totalUses - totalQuotaHits - totalErrorHits);
        const successPct = totalUses > 0 ? Math.round((successfulCount / totalUses) * 100) : 0;
        return { totalUses, totalQuotaHits, totalErrorHits, totalCensorshipHits, totalBrokenHits, totalSpent, totalDuration, avgSpeed, avgTtft, overallReliability, successfulCount, successPct };
    }, [modelRows]);

    const sortedRows = useMemo(() => {
        const sorted = [...modelRows];
        sorted.sort((a, b) => {
            let cmp = 0;
            switch (sortField) {
                case 'name': cmp = a.name.localeCompare(b.name); break;
                case 'speed': cmp = a.speed - b.speed; break;
                case 'ttft': cmp = a.ttft - b.ttft; break;
                case 'reliability': cmp = a.reliability - b.reliability; break;
                case 'spent': cmp = a.spent - b.spent; break;
                case 'uses': cmp = a.uses - b.uses; break;
                case 'errors': cmp = (a.quotaHits + a.errorHits) - (b.quotaHits + b.errorHits); break;
                case 'censorship': cmp = a.censorshipHits - b.censorshipHits; break;
                case 'broken': cmp = a.brokenHits - b.brokenHits; break;
                case 'duration': cmp = a.totalSessionDuration - b.totalSessionDuration; break;
            }
            return sortDirection === 'asc' ? cmp : -cmp;
        });
        return sorted;
    }, [modelRows, sortField, sortDirection]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    const sortIndicator = (field: SortField) => {
        if (sortField !== field) return '';
        return sortDirection === 'asc' ? ' ↑' : ' ↓';
    };

    if (!isOpen) return null;

    const runAction = async (action: () => Promise<boolean>) => {
        setIsSaving(true);
        try { return await action(); } finally { setIsSaving(false); }
    };

    const handleCreate = async () => {
        if (!currentStrategy) return;
        await runAction(() => createBudgetData(currentStrategy, 24 * 60 * 60 * 1000));
    };

    const handlePresetResetDuration = async (duration: number) => {
        if (!budgetData) return;
        await runAction(() => setResetDuration(duration));
    };

    const handleCustomResetDuration = async () => {
        if (!budgetData) return;
        const duration = Math.max(0, customResetHours) * 60 * 60 * 1000;
        await runAction(() => setResetDuration(duration));
    };

    const handleSetBudgetSpent = async () => {
        if (!budgetData) return;
        const value = Number(budgetAdjustAmount);
        if (!Number.isFinite(value) || value < 0) return;
        await runAction(() => setBudgetSpent(value));
        setBudgetAdjustAmount('');
    };

    const handleAddBudgetSpent = async () => {
        if (!budgetData) return;
        const value = Number(budgetAdjustAmount);
        if (!Number.isFinite(value) || value <= 0) return;
        const newSpent = Math.min(maximumBudget, budgetData.budgetSpent + value);
        await runAction(() => setBudgetSpent(newSpent));
        setBudgetAdjustAmount('');
    };

    const handleSubtractBudgetSpent = async () => {
        if (!budgetData) return;
        const value = Number(budgetAdjustAmount);
        if (!Number.isFinite(value) || value <= 0) return;
        const newSpent = Math.max(0, budgetData.budgetSpent - value);
        await runAction(() => setBudgetSpent(newSpent));
        setBudgetAdjustAmount('');
    };

    const handleSpeedAlphaSave = async () => {
        if (!budgetData) return;
        const value = Number(speedAlpha);
        if (!Number.isFinite(value) || value <= 0 || value >= 1) return;
        setIsSaving(true);
        try {
            const { saveRawBudgetData } = await import('../hooks/storage');
            const updated = { ...budgetData, averageLatencyMsPerTokenExponentialMovingAverageSmoothing: value };
            await saveRawBudgetData(updated);
            await refresh();
        } finally { setIsSaving(false); }
        setSpeedAlpha('');
    };

    const handleTtftAlphaSave = async () => {
        if (!budgetData) return;
        const value = Number(ttftAlpha);
        if (!Number.isFinite(value) || value <= 0 || value >= 1) return;
        setIsSaving(true);
        try {
            const { saveRawBudgetData } = await import('../hooks/storage');
            const updated = { ...budgetData, averageTimeToFirstTokenExponentialMovingAverageSmoothing: value };
            await saveRawBudgetData(updated);
            await refresh();
        } finally { setIsSaving(false); }
        setTtftAlpha('');
    };

    const clearDurationTimestamps = async (): Promise<boolean> => {
        if (!budgetData) return false;
        const { saveRawBudgetData } = await import('../hooks/storage');
        const updated = { ...budgetData, modelTotalSessionDuration: {} };
        await saveRawBudgetData(updated);
        await refresh();
        return true;
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-content-manager" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Budget Control</h2>
                    <div className="modal-header-actions">
                        <button type="button" className="close-btn close-btn-spaced" onClick={onClose}>×</button>
                    </div>
                </div>

                <div className="modal-body">
                    {isLoading ? (
                        <div className="empty-state">Loading budget data...</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {/* No Budget Data */}
                            {!budgetData && (
                                <div className="budget-section">
                                    <span className="budget-section-title">Initialize Budget Data</span>
                                    <div className="budget-hint" style={{ marginBottom: '8px' }}>
                                        No global budget data exists yet. Activate a budget strategy first, then create budget data from it.
                                    </div>
                                    {currentStrategy ? (
                                        <div style={{ marginBottom: '8px', padding: '8px', background: 'var(--social-bg)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.75rem' }}>
                                            Active strategy: <strong>{currentStrategy.name}</strong> — ${formatCost(currentStrategy.maximumBudget)}
                                        </div>
                                    ) : (
                                        <div className="editor-error-message" style={{ marginTop: '4px', fontSize: '0.7rem' }}>No active budget strategy. Activate one from the Budget Strategies manager first.</div>
                                    )}
                                    <button type="button" className="budget-btn budget-btn-primary" disabled={!currentStrategy || isSaving} onClick={handleCreate} style={{ marginTop: '8px' }}>
                                        Create Budget Data
                                    </button>
                                </div>
                            )}

                            {/* Existing Budget Data */}
                            {budgetData && (
                                <>
                                    {/* Overview */}
                                    <div className="budget-section">
                                        <span className="budget-section-title">Overview</span>
                                        <div className="budget-stat-grid">
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Strategy</span>
                                                <span className="budget-stat-value">{budgetData.budgetStrategy?.name || 'Unknown'}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Budget Spent</span>
                                                <span className="budget-stat-value">${formatCost(budgetData.budgetSpent)} / ${formatCost(maximumBudget)} ({Math.round(usagePercent)}%)</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Reset Duration</span>
                                                <span className="budget-stat-value">{formatDuration(budgetData.resetDuration)}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Next Reset</span>
                                                <span className="budget-stat-value">{timeUntilReset === null ? 'Disabled' : timeUntilReset <= 0 ? 'Due now' : `in ${formatDuration(timeUntilReset)}`}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Last Reset</span>
                                                <span className="budget-stat-value">{formatTimestamp(budgetData.lastResetTimestamp)}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Last Updated</span>
                                                <span className="budget-stat-value">{formatTimestamp(budgetData.lastUpdatedTimestamp)}</span>
                                            </div>
                                        </div>
                                        <div className="budget-progress-track">
                                            <div className="budget-progress-fill" style={{ width: `${usagePercent}%`, background: usagePercent >= 95 ? '#ff4444' : usagePercent >= 80 ? '#ffaa00' : undefined }} />
                                        </div>
                                    </div>

                                    {/* Aggregate Performance */}
                                    <div className="budget-section">
                                        <span className="budget-section-title">Aggregate Performance</span>
                                        <div className="budget-stat-grid">
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Total Requests</span>
                                                <span className="budget-stat-value">{aggregateStats.totalUses}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Successful</span>
                                                <span className="budget-stat-value" style={{ color: '#10b981' }}>
                                                    {aggregateStats.successfulCount}
                                                    {aggregateStats.totalUses > 0 && ` (${aggregateStats.successPct}%)`}
                                                </span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Censorship Hits</span>
                                                <span className="budget-stat-value" style={{ color: '#a855f7' }}>{aggregateStats.totalCensorshipHits}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Broken Responses</span>
                                                <span className="budget-stat-value" style={{ color: '#f59e0b' }}>{aggregateStats.totalBrokenHits}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Quota Hits</span>
                                                <span className="budget-stat-value" style={{ color: '#f97316' }}>{aggregateStats.totalQuotaHits}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Error Hits</span>
                                                <span className="budget-stat-value" style={{ color: '#ef4444' }}>{aggregateStats.totalErrorHits}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Reliability</span>
                                                <span className="budget-stat-value">{aggregateStats.totalUses > 0 ? `${Math.round((1 - aggregateStats.overallReliability) * 100)}%` : '—'}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Average Speed</span>
                                                <span className="budget-stat-value">{aggregateStats.avgSpeed > 0 ? `${formatMs(aggregateStats.avgSpeed)}/tok` : '—'}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Average TTFT</span>
                                                <span className="budget-stat-value">{aggregateStats.avgTtft > 0 ? formatMs(aggregateStats.avgTtft) : '—'}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Total Session Time</span>
                                                <span className="budget-stat-value">{formatSessionDuration(aggregateStats.totalDuration)}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Active Language Models</span>
                                                <span className="budget-stat-value">{modelRows.filter(r => r.uses > 0).length} / {modelRows.length}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Per-Model Performance Table */}
                                    {modelRows.length > 0 && (
                                        <div className="budget-section">
                                            <span className="budget-section-title">Model Performance</span>
                                            <div className="budget-table-wrapper">
                                                <table className="budget-table">
                                                    <thead>
                                                        <tr>
                                                            <th onClick={() => handleSort('name')}>Model{sortIndicator('name')}</th>
                                                            <th className="sort-right" onClick={() => handleSort('speed')}>Speed{sortIndicator('speed')}</th>
                                                            <th className="sort-right" onClick={() => handleSort('ttft')}>TTFT{sortIndicator('ttft')}</th>
                                                            <th className="sort-right" onClick={() => handleSort('uses')}>Uses{sortIndicator('uses')}</th>
                                                            <th className="sort-right" onClick={() => handleSort('duration')}>Duration{sortIndicator('duration')}</th>
                                                            <th className="sort-right" onClick={() => handleSort('reliability')}>Rel%{sortIndicator('reliability')}</th>
                                                            <th className="sort-right" onClick={() => handleSort('spent')}>Spent{sortIndicator('spent')}</th>
                                                            <th className="sort-right" onClick={() => handleSort('errors')}>Errs{sortIndicator('errors')}</th>
                                                            <th className="sort-right" onClick={() => handleSort('censorship')}>Cens{sortIndicator('censorship')}</th>
                                                            <th className="sort-right" onClick={() => handleSort('broken')}>Brkn{sortIndicator('broken')}</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {sortedRows.map(row => {
                                                            const relPct = row.uses > 0 ? Math.max(0, Math.round((1 - Math.min(1, row.reliability)) * 100)) : null;
                                                            const relColor = relPct === null ? undefined : relPct >= 95 ? '#10b981' : relPct >= 80 ? '#f59e0b' : '#ef4444';
                                                            return (
                                                                <tr key={row.id}>
                                                                    <td className="name-cell" title={row.name}>{row.name}</td>
                                                                    <td className="num">{Number.isFinite(row.speed) && row.speed > 0 ? formatMs(row.speed) : '—'}</td>
                                                                    <td className="num">{Number.isFinite(row.ttft) && row.ttft > 0 ? formatMs(row.ttft) : '—'}</td>
                                                                    <td className="num">{row.uses}</td>
                                                                    <td className="num">{row.totalSessionDuration > 0 ? formatSessionDuration(row.totalSessionDuration) : '—'}</td>
                                                                    <td className="num" style={{ color: relColor }}>{relPct !== null ? `${relPct}%` : '—'}</td>
                                                                    <td className="num">{row.spent > 0 ? `$${formatCost(row.spent)}` : '—'}</td>
                                                                    <td className="num" style={{ color: (row.quotaHits + row.errorHits) > 0 ? '#ef4444' : undefined }}>{row.quotaHits + row.errorHits > 0 ? `${row.quotaHits}/${row.errorHits}` : '—'}</td>
                                                                    <td className="num" style={{ color: row.censorshipHits > 0 ? '#a855f7' : undefined }}>{row.censorshipHits > 0 ? row.censorshipHits : '—'}</td>
                                                                    <td className="num" style={{ color: row.brokenHits > 0 ? '#f97316' : undefined }}>{row.brokenHits > 0 ? row.brokenHits : '—'}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div className="budget-hint">Showing only models in active strategy. Click headers to sort. Rel% = 100 − (hits ÷ uses). Cens = censorship refusals. Brkn = empty responses.</div>
                                        </div>
                                    )}

                                    {/* No models in strategy message */}
                                    {modelRows.length === 0 && currentStrategy && (
                                        <div className="budget-section">
                                            <div className="budget-hint">No models in the active strategy. Add models to the strategy to see performance data.</div>
                                        </div>
                                    )}

                                    {/* Model Runtime Data */}
                                    <div className="budget-section">
                                        <span className="budget-section-title">Runtime Timestamps</span>
                                        <div className="budget-stat-grid">
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Language Models Used</span>
                                                <span className="budget-stat-value">{countKeys(budgetData.modelLastUsedTimestamps)}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Last Use</span>
                                                <span className="budget-stat-value">{formatTimestamp(latestUsed)}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Quota Hit Language Models</span>
                                                <span className="budget-stat-value">{countKeys(budgetData.modelLastQuotaHitTimeStamps)}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Latest Quota Hit</span>
                                                <span className="budget-stat-value">{formatTimestamp(latestQuota)}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Error Hit Language Models</span>
                                                <span className="budget-stat-value">{countKeys(budgetData.modelLastErrorHitTimeStamps)}</span>
                                            </div>
                                            <div className="budget-stat-row">
                                                <span className="budget-stat-label">Latest Error Hit</span>
                                                <span className="budget-stat-value">{formatTimestamp(latestError)}</span>
                                            </div>
                                        </div>
                                        <div className="budget-btn-group" style={{ marginTop: '10px' }}>
                                            <button type="button" className="budget-btn" disabled={isSaving} onClick={() => runAction(clearModelLastUsedTimestamps)}>Clear Used</button>
                                            <button type="button" className="budget-btn" disabled={isSaving} onClick={() => runAction(clearQuotaTimestamps)}>Clear Quotas</button>
                                            <button type="button" className="budget-btn" disabled={isSaving} onClick={() => runAction(clearErrorTimestamps)}>Clear Errors</button>
                                            <button type="button" className="budget-btn" disabled={isSaving} onClick={() => runAction(clearDurationTimestamps)}>Clear Duration</button>
                                            <button type="button" className="budget-btn budget-btn-danger" disabled={isSaving} onClick={() => runAction(clearAllModelTelemetry)}>Clear All</button>
                                        </div>
                                    </div>

                                    {/* Reset Schedule */}
                                    <div className="budget-section">
                                        <span className="budget-section-title">Reset Schedule</span>
                                        <div className="budget-btn-group" style={{ marginBottom: '10px' }}>
                                            {RESET_PRESETS.map(preset => (
                                                <button
                                                    key={preset.label}
                                                    type="button"
                                                    className={`budget-btn ${budgetData.resetDuration === preset.value ? 'budget-btn-active' : ''}`}
                                                    disabled={isSaving}
                                                    onClick={() => handlePresetResetDuration(preset.value)}
                                                >
                                                    {preset.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="budget-control-row">
                                            <div className="budget-control-field">
                                                <label className="budget-control-label">Custom Hours</label>
                                                <input type="number" className="budget-control-input" min="0" step="1" value={customResetHours} onChange={e => setCustomResetHours(Number(e.target.value) || 0)} />
                                            </div>
                                            <button type="button" className="budget-btn budget-btn-primary budget-btn-action" disabled={isSaving} onClick={handleCustomResetDuration}>Apply</button>
                                        </div>
                                    </div>

                                    {/* EMA Smoothing */}
                                    <div className="budget-section">
                                        <span className="budget-section-title">EMA Sensitivity</span>
                                        <div className="budget-hint" style={{ marginBottom: '8px' }}>
                                            Controls adaptation speed. Lower = smoother historical weighting. Higher = faster reaction to recent changes. Range: 0–1.
                                        </div>
                                        <div className="budget-control-row">
                                            <div className="budget-control-field">
                                                <label className="budget-control-label">Speed α (current: {(budgetData.averageLatencyMsPerTokenExponentialMovingAverageSmoothing ?? 0.3).toFixed(3)})</label>
                                                <input type="text" inputMode="decimal" className="budget-control-input" placeholder={(budgetData.averageLatencyMsPerTokenExponentialMovingAverageSmoothing ?? 0.3).toFixed(3)} value={speedAlpha} onChange={e => setSpeedAlpha(e.target.value)} />
                                            </div>
                                            <button type="button" className="budget-btn budget-btn-primary budget-btn-action" disabled={isSaving || speedAlpha.trim() === ''} onClick={handleSpeedAlphaSave}>Save</button>
                                        </div>
                                        <div className="budget-control-row">
                                            <div className="budget-control-field">
                                                <label className="budget-control-label">TTFT α (current: {(budgetData.averageTimeToFirstTokenExponentialMovingAverageSmoothing ?? 0.3).toFixed(3)})</label>
                                                <input type="text" inputMode="decimal" className="budget-control-input" placeholder={(budgetData.averageTimeToFirstTokenExponentialMovingAverageSmoothing ?? 0.3).toFixed(3)} value={ttftAlpha} onChange={e => setTtftAlpha(e.target.value)} />
                                            </div>
                                            <button type="button" className="budget-btn budget-btn-primary budget-btn-action" disabled={isSaving || ttftAlpha.trim() === ''} onClick={handleTtftAlphaSave}>Save</button>
                                        </div>
                                    </div>

                                    {/* Budget Editing */}
                                    <div className="budget-section">
                                        <span className="budget-section-title">Budget Editing</span>
                                        <div className="budget-control-row">
                                            <div className="budget-control-field">
                                                <label className="budget-control-label">Amount ($)</label>
                                                <input type="text" inputMode="decimal" className="budget-control-input" placeholder="0.0000" value={budgetAdjustAmount} onChange={e => setBudgetAdjustAmount(e.target.value)} />
                                            </div>
                                        </div>
                                        <div className="budget-btn-group" style={{ marginTop: '8px' }}>
                                            <button type="button" className="budget-btn budget-btn-primary" disabled={isSaving || budgetAdjustAmount.trim() === ''} onClick={handleAddBudgetSpent}>+ Add</button>
                                            <button type="button" className="budget-btn" disabled={isSaving || budgetAdjustAmount.trim() === ''} onClick={handleSubtractBudgetSpent}>− Subtract</button>
                                            <button type="button" className="budget-btn" disabled={isSaving || budgetAdjustAmount.trim() === ''} onClick={handleSetBudgetSpent} style={{ borderColor: 'var(--accent)' }}>Set Exact</button>
                                        </div>
                                        <div style={{ marginTop: '10px' }}>
                                            <button type="button" className="budget-btn budget-btn-danger" disabled={isSaving} onClick={() => runAction(resetBudget)}>Reset Budget Now</button>
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