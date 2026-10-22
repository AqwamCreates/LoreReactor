// src/frontend_src/components/ChatStatisticsBar.tsx
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../hooks/useChatStore';
import { useGenerationStore } from '../hooks/useGenerationStore';
import { defaultContextLength } from '../dictionaries/defaults';

interface ChatStatisticsBarProps {
    maximumNumberOfTokens: number;
    maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens: number;
    maximumNumberOfContextTokens?: number;
    numberOfMessages: number;
    className?: string;
    budgetSpent?: number;
    maximumBudget?: number;
    timeUntilReset?: number | null;
}

type Severity = 'ok' | 'warn' | 'critical';

const SEVERITY_COLOR: Record<Severity, string> = {
    ok: '#22c55e',
    warn: '#ffaa00',
    critical: '#ff4444',
};

function severityFromPercent(percent: number): Severity {
    if (percent > 95) return 'critical';
    if (percent > 80) return 'warn';
    return 'ok';
}

function formatSessionDuration(ms: number): string {
    if (!ms || ms <= 0) return '—';

    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds === 0) return '0 seconds';

    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);
    const hours = totalHours % 24;
    const totalDays = Math.floor(totalHours / 24);

    const years = Math.floor(totalDays / 365);
    const months = Math.floor((totalDays % 365) / 30);
    const days = (totalDays % 365) % 30;

    const parts: string[] = [];
    if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
    if (months > 0) parts.push(`${months} month${months === 1 ? '' : 's'}`);
    if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    if (seconds > 0) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);

    return parts.length > 0 ? parts.join(' ') : '—';
}

export const ChatStatisticsBar: React.FC<ChatStatisticsBarProps> = ({
    maximumNumberOfTokens = defaultContextLength,
    maximumNumberOfContextTokens = 0,
    maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens = 0,
    numberOfMessages = 0,
    className = '',
    budgetSpent,
    maximumBudget,
    timeUntilReset,
}) => {
    const [showDetails, setShowDetails] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const latency = useGenerationStore((s) => s.latency);
    const timeToFirstToken = useGenerationStore((s) => s.timeToFirstToken);
    const numberOfTokens = useChatStore((s) => s.numberOfTokens);
    const numberOfCacheInvalidations = useGenerationStore((s) => s.numberOfCacheInvalidations);
    const numberOfRequests = useGenerationStore((s) => s.numberOfRequests);
    const totalCost = useGenerationStore((s) => s.totalCost);
    const costWithoutCacheMisses = useGenerationStore((s) => s.costWithoutCacheMisses);
    const sessionStartTimestamp = useChatStore((s) => s.sessionStartTimestamp);

    // ── Derived metrics ─────────────────────────────────────────────────────
    const safeMax = maximumNumberOfTokens > 0 ? maximumNumberOfTokens : 1;
    const percentage = Math.min(100, Math.round((numberOfTokens / safeMax) * 100));
    const contextSeverity = severityFromPercent(percentage);

    const isFastEnough = latency < 110;
    const speedDisplay = latency < 1 ? '<1' : Math.round(latency);
    const speedIcon = isFastEnough ? '⚡' : '🐢';
    const speedSeverity: Severity = isFastEnough ? 'ok' : 'critical';

    const ttftDisplay =
        timeToFirstToken < 1000
            ? `${Math.round(timeToFirstToken)}ms`
            : `${(timeToFirstToken / 1000).toFixed(1)}s`;
    const ttftSeverity: Severity =
        timeToFirstToken < 2000 ? 'ok' : timeToFirstToken < 4000 ? 'warn' : 'critical';

    const invalidationRate =
        numberOfRequests > 0 ? Math.round((numberOfCacheInvalidations / numberOfRequests) * 100) : 0;
    const hitRate = numberOfRequests > 0 ? 100 - invalidationRate : 0;
    const hasCacheData = numberOfRequests > 0;

    const costSavings = Math.max(0, costWithoutCacheMisses - totalCost);
    const efficiency =
        costWithoutCacheMisses > 0 ? Math.round((costSavings / costWithoutCacheMisses) * 100) : 0;

    const hasBudget =
        budgetSpent !== undefined && maximumBudget !== undefined && maximumBudget > 0;
    const budgetPercent = hasBudget
        ? Math.min(100, Math.round((budgetSpent as number) / (maximumBudget as number)) * 100)
        : 0;
    const budgetSeverity = severityFromPercent(budgetPercent);

    const formatCost = useCallback((cost: number) => (cost === 0 ? '0.0000' : cost.toFixed(4)), []);
    const formatNumber = useCallback((num: number) => num.toLocaleString(), []);

    const formatResetTime = (ms: number): string => {
        if (ms <= 0) return 'Due now';
        const totalSeconds = Math.ceil(ms / 1000);
        if (totalSeconds < 60) return `${totalSeconds}s`;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const remainMinutes = minutes % 60;
        if (hours < 24) return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`;
        const days = Math.floor(hours / 24);
        const remainHours = hours % 24;
        return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
    };

    // Worst severity across all tracked resources drives the pill colour
    const overallSeverity: Severity = useMemo(() => {
        const order: Severity[] = ['ok', 'warn', 'critical'];
        const candidates: Severity[] = [contextSeverity];
        if (hasBudget) candidates.push(budgetSeverity);
        candidates.sort((a, b) => order.indexOf(b) - order.indexOf(a));
        return candidates[0];
    }, [contextSeverity, budgetSeverity, hasBudget]);

    // ── Live session duration (only ticks while the panel is open) ──────────
    const [liveDuration, setLiveDuration] = useState(0);
    useEffect(() => {
        if (!showDetails || !sessionStartTimestamp) return;
        const tick = () => setLiveDuration(Date.now() - sessionStartTimestamp);
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [showDetails, sessionStartTimestamp]);

    // ── Dismiss the panel on outside click / Escape ─────────────────────────
    useEffect(() => {
        if (!showDetails) return;
        const onPointerDown = (e: MouseEvent | TouchEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setShowDetails(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowDetails(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown, { passive: true });
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [showDetails]);

    // ── Donut gauge geometry ────────────────────────────────────────────────
    const GAUGE_R = 6.5;
    const GAUGE_C = 2 * Math.PI * GAUGE_R;
    const gaugeOffset = GAUGE_C * (1 - percentage / 100);
    const gaugeColor = SEVERITY_COLOR[overallSeverity];

    const pillTitle = `Latency: ${speedDisplay}ms | Context: ${percentage}% — click for full session statistics`;

    return (
        <div
            ref={rootRef}
            className={`health-pill-root ${showDetails ? 'health-pill-root-open' : ''} ${className}`}
        >
            <button
                type="button"
                className={`health-pill health-pill-${overallSeverity}`}
                onClick={(e) => {
                    e.stopPropagation();
                    setShowDetails((prev) => !prev);
                }}
                title={pillTitle}
                aria-expanded={showDetails}
                aria-haspopup="dialog"
            >
                {/* Latency Indicator at the front */}
                <span className="health-pill-latency" title={`Latency: ${latency.toFixed(2)} ms/token`}>
                    <span className="health-pill-latency-icon">{speedIcon}</span>
                    <span className="health-pill-latency-value" style={{ color: SEVERITY_COLOR[speedSeverity] }}>
                        {speedDisplay}ms
                    </span>
                </span>

                <svg
                    className="stats-gauge"
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    aria-hidden="true"
                    focusable="false"
                >
                    <circle className="stats-gauge-track" cx="9" cy="9" r={GAUGE_R} />
                    <circle
                        className="stats-gauge-fill"
                        cx="9"
                        cy="9"
                        r={GAUGE_R}
                        strokeDasharray={GAUGE_C}
                        strokeDashoffset={gaugeOffset}
                        style={{ stroke: gaugeColor }}
                    />
                </svg>

                <span className="health-pill-percent" style={{ color: gaugeColor }}>
                    {percentage}%
                </span>

                {hasBudget && (
                    <span
                        className="health-pill-budget"
                        style={{ color: SEVERITY_COLOR[budgetSeverity] }}
                        title={`Budget: $${formatCost(budgetSpent as number)} / $${formatCost(maximumBudget as number)}`}
                    >
                        💰{budgetPercent}%
                    </span>
                )}

                {!hasBudget && totalCost > 0 && (
                    <span className="health-pill-budget" title={`Session cost: $${formatCost(totalCost)}`}>
                        ${formatCost(totalCost)}
                    </span>
                )}
            </button>

            {showDetails && (
                <div className="health-pill-panel" role="dialog" aria-label="Session statistics">
                    {/* ✅ REMOVED: Close button. Panel now relies purely on outside-click/Escape */}
                    <div className="health-pill-panel-header">
                        <span>Session Statistics</span>
                    </div>

                    <div className="health-pill-panel-body">
                        {/* ── Live vitals ── */}
                        <section className="health-pill-section">
                            <h4 className="health-pill-section-title">Performance</h4>

                            <div className="health-pill-vitals">
                                <div
                                    className={`health-pill-vital severity-${speedSeverity}`}
                                    title={`Latency: ${latency.toFixed(2)} ms/token`}
                                >
                                    <span className="health-pill-vital-icon">{speedIcon}</span>
                                    <span className="health-pill-vital-value">{speedDisplay}ms</span>
                                    <span className="health-pill-vital-label">latency</span>
                                </div>

                                <div
                                    className={`health-pill-vital severity-${ttftSeverity}`}
                                    title={`Time to first token: ${timeToFirstToken.toFixed(0)}ms`}
                                >
                                    <span className="health-pill-vital-icon">⏱️</span>
                                    <span className="health-pill-vital-value">{ttftDisplay}</span>
                                    <span className="health-pill-vital-label">First Token</span>
                                </div>

                                <div
                                    className="health-pill-vital severity-ok"
                                    title={`${numberOfCacheInvalidations} cache invalidations`}
                                >
                                    <span className="health-pill-vital-icon">🔄</span>
                                    <span className="health-pill-vital-value">{numberOfCacheInvalidations}</span>
                                    <span className="health-pill-vital-label">invalidations</span>
                                </div>
                            </div>
                        </section>

                        {/* ── Context ── */}
                        <section className="health-pill-section">
                            <h4 className="health-pill-section-title">Context</h4>

                            <div className="health-pill-row">
                                <span className="health-pill-row-label">Context Used</span>
                                <span className="health-pill-row-value">
                                    {formatNumber(numberOfTokens)} / {formatNumber(maximumNumberOfTokens)}
                                </span>
                            </div>

                            {maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens > 0 && (
                                <div className="health-pill-row">
                                    <span className="health-pill-row-label">Highest Participant</span>
                                    <span className="health-pill-row-value">
                                        {formatNumber(
                                            maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens,
                                        )}
                                    </span>
                                </div>
                            )}

                            {maximumNumberOfContextTokens > 0 && (
                                <div className="health-pill-row">
                                    <span className="health-pill-row-label">Context Blocks</span>
                                    <span className="health-pill-row-value">
                                        {formatNumber(maximumNumberOfContextTokens)}
                                    </span>
                                </div>
                            )}

                            <div className="health-pill-row">
                                <span className="health-pill-row-label">Messages</span>
                                <span className="health-pill-row-value">{formatNumber(numberOfMessages)}</span>
                            </div>

                            <div className="health-pill-row">
                                <span className="health-pill-row-label">Average Tokens / Message</span>
                                <span className="health-pill-row-value">
                                    {numberOfMessages > 0
                                        ? (numberOfTokens / numberOfMessages).toFixed(2)
                                        : '0.00'}
                                </span>
                            </div>

                            <div className="health-pill-row">
                                <span className="health-pill-row-label">Throughput</span>
                                <span
                                    className="health-pill-row-value"
                                    style={{ color: SEVERITY_COLOR[speedSeverity] }}
                                >
                                    {latency > 0 ? (1000 / latency).toFixed(1) : '∞'} tokens/s
                                </span>
                            </div>

                            <div className="health-pill-row">
                                <span className="health-pill-row-label">Session Duration</span>
                                <span className="health-pill-row-value">
                                    {formatSessionDuration(liveDuration)}
                                </span>
                            </div>
                        </section>

                        {/* ── Budget ── */}
                        {hasBudget && (
                            <section className="health-pill-section">
                                <h4 className="health-pill-section-title">Budget</h4>

                                <div className="health-pill-meter">
                                    <div
                                        className="health-pill-meter-fill"
                                        style={{
                                            width: `${budgetPercent}%`,
                                            background: SEVERITY_COLOR[budgetSeverity],
                                        }}
                                    />
                                </div>

                                <div className="health-pill-row">
                                    <span className="health-pill-row-label">Spent</span>
                                    <span
                                        className="health-pill-row-value"
                                        style={{ color: SEVERITY_COLOR[budgetSeverity] }}
                                    >
                                        ${formatCost(budgetSpent as number)} / ${formatCost(maximumBudget as number)}
                                    </span>
                                </div>

                                {timeUntilReset !== null && timeUntilReset !== undefined && (
                                    <div className="health-pill-row">
                                        <span className="health-pill-row-label">Next Reset</span>
                                        <span className="health-pill-row-value">
                                            {timeUntilReset > 0
                                                ? `in ${formatResetTime(timeUntilReset)}`
                                                : 'Due now'}
                                        </span>
                                    </div>
                                )}
                            </section>
                        )}

                        {/* ── Cache ── */}
                        {hasCacheData && (
                            <section className="health-pill-section">
                                <h4 className="health-pill-section-title">Cache</h4>

                                <div className="health-pill-meter">
                                    <div
                                        className="health-pill-meter-fill"
                                        style={{
                                            width: `${hitRate}%`,
                                            background: hitRate > 80 ? '#22c55e' : '#ff4444',
                                        }}
                                    />
                                </div>

                                <div className="health-pill-row">
                                    <span className="health-pill-row-label">Hit Rate</span>
                                    <span
                                        className="health-pill-row-value"
                                        style={{ color: hitRate > 80 ? '' : '#ff4444' }}
                                    >
                                        {hitRate}%
                                    </span>
                                </div>
                                <div className="health-pill-row">
                                    <span className="health-pill-row-label">Invalidations</span>
                                    <span className="health-pill-row-value">
                                        {formatNumber(numberOfCacheInvalidations)}
                                    </span>
                                </div>
                                <div className="health-pill-row">
                                    <span className="health-pill-row-label">Total Requests</span>
                                    <span className="health-pill-row-value">
                                        {formatNumber(numberOfRequests)}
                                    </span>
                                </div>
                            </section>
                        )}

                        {/* ── Cost ── */}
                        {totalCost > 0 && (
                            <section className="health-pill-section">
                                <h4 className="health-pill-section-title">Cost</h4>

                                <div className="health-pill-row">
                                    <span className="health-pill-row-label">Session Cost</span>
                                    <span className="health-pill-row-value">
                                        ${formatCost(totalCost)}
                                    </span>
                                </div>

                                {costWithoutCacheMisses > 0 && (
                                    <>
                                        <div className="health-pill-row">
                                            <span className="health-pill-row-label">Cost (No Cache)</span>
                                            <span
                                                className="health-pill-row-value"
                                                style={{ opacity: 0.6 }}
                                            >
                                                ${formatCost(costWithoutCacheMisses)}
                                            </span>
                                        </div>
                                        <div className="health-pill-row">
                                            <span className="health-pill-row-label">Savings</span>
                                            <span
                                                className="health-pill-row-value"
                                                style={{
                                                    color: costSavings > 0 ? '#22c55e' : '#ff4444',
                                                }}
                                            >
                                                ${formatCost(costSavings)} ({efficiency}%)
                                            </span>
                                        </div>
                                    </>
                                )}
                            </section>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatStatisticsBar;