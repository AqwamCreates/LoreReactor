// src/components/ChatStatisticsBar.tsx
import type React from 'react';
import { useState, useEffect } from 'react';
import { useSessionStore } from '../store/useSessionStore';

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

export const ChatStatisticsBar: React.FC<ChatStatisticsBarProps> = ({
    maximumNumberOfTokens = 65536,
    maximumNumberOfContextTokens = 0,
    maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens = 0,
    numberOfMessages = 0,
    className = '',
    budgetSpent,
    maximumBudget,
    timeUntilReset,
}) => {
    const [showDetails, setShowDetails] = useState(false);

    const latency = useSessionStore(s => s.latency);
    const timeToFirstToken = useSessionStore(s => s.timeToFirstToken);
    const numberOfTokens = useSessionStore(s => s.numberOfTokens);
    const numberOfCacheInvalidations = useSessionStore(s => s.numberOfCacheInvalidations);
    const numberOfRequests = useSessionStore(s => s.numberOfRequests);
    const totalCost = useSessionStore(s => s.totalCost);
    const costWithoutCacheMisses = useSessionStore(s => s.costWithoutCacheMisses);
    const sessionStartTimestamp = useSessionStore(s => s.sessionStartTimestamp);

    const safeMax = maximumNumberOfTokens > 0 ? maximumNumberOfTokens : 1;
    const percentage = Math.min(100, Math.round((numberOfTokens / safeMax) * 100));
    const tokenColor = percentage > 95 ? '#ff4444' : percentage > 80 ? '#ffaa00' : '';

    const isFastEnough = latency < 110;
    const speedColor = isFastEnough ? '' : '#ff4444';
    const speedDisplay = latency < 1 ? '<1' : Math.round(latency);
    const speedIcon = isFastEnough ? '⚡' : '🐢';

    const ttftDisplay = timeToFirstToken < 1000
        ? `${Math.round(timeToFirstToken)}ms`
        : `${(timeToFirstToken / 1000).toFixed(1)}s`;
    const ttftColor = timeToFirstToken < 2000
        ? ''
        : timeToFirstToken < 4000
            ? '#ffaa00'
            : '#ff4444';

    const invalidationRate = numberOfRequests > 0 ? Math.round((numberOfCacheInvalidations / numberOfRequests) * 100) : 0;
    const hitRate = numberOfRequests > 0 ? 100 - invalidationRate : 0;
    const hasCacheData = numberOfRequests > 0;

    const costSavings = Math.max(0, costWithoutCacheMisses - totalCost);
    const efficiency = costWithoutCacheMisses > 0 ? Math.round((costSavings / costWithoutCacheMisses) * 100) : 0;

    const formatCost = (cost: number) => {
        if (cost === 0) return '0.0000';
        return cost.toFixed(4);
    };

    const formatNumber = (num: number) => num.toLocaleString();

    const hasBudget = budgetSpent !== undefined && maximumBudget !== undefined && maximumBudget > 0;
    const budgetPercent = hasBudget ? Math.min(100, Math.round((budgetSpent! / maximumBudget!) * 100)) : 0;
    const budgetColor = budgetPercent > 95 ? '#ff4444' : budgetPercent > 80 ? '#ffaa00' : '';

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

    // Compute base session duration from store
    const sessionDurationMs = sessionStartTimestamp ? Date.now() - sessionStartTimestamp : 0;

    // Live ticking duration while details panel is open
    const [liveDuration, setLiveDuration] = useState(sessionDurationMs);

    useEffect(() => {
        if (!showDetails || !sessionStartTimestamp) {
            setLiveDuration(sessionDurationMs);
            return;
        }
        // Tick every second while details are visible
        const interval = setInterval(() => {
            setLiveDuration(Date.now() - sessionStartTimestamp);
        }, 1000);
        return () => clearInterval(interval);
    }, [showDetails, sessionStartTimestamp, sessionDurationMs]);

    return (
        <div
            className={`chat-stats-bar ${className}`}
            onClick={() => setShowDetails(!showDetails)}
            title="Click to toggle details"
            style={{ cursor: 'pointer' }}
        >
            <div className="chat-stats-items">
                {/* Latency */}
                <div className="chat-stat-item" title={`Latency: ${latency.toFixed(2)} ms/token`}>
                    <span className="chat-stat-label">{speedIcon}</span>
                    <span className="chat-stat-speed-value" style={{ color: speedColor }}>
                        {speedDisplay}ms
                    </span>
                </div>

                {/* Time To First Token */}
                <div className="chat-stat-item" title={`Time to First Token: ${timeToFirstToken.toFixed(0)}ms`}>
                    <span className="chat-stat-label">⏱️</span>
                    <span className="chat-stat-speed-value" style={{ color: ttftColor }}>
                        {ttftDisplay}
                    </span>
                </div>

                {/* Cache Invalidation Count */}
                {numberOfCacheInvalidations > 0 && (
                    <div className="chat-stat-item" title={`${numberOfCacheInvalidations} cache invalidations`}>
                        <span className="chat-stat-label">🔄</span>
                        <span className="chat-stat-value">{numberOfCacheInvalidations}</span>
                    </div>
                )}

                {/* Token Usage (no bar, colored percentage) */}
                <div className="chat-stat-item" title={`${numberOfTokens} / ${maximumNumberOfTokens} token(s) (${percentage}%)`}>
                    <span className="chat-stat-label">📊</span>
                    <span className="chat-stat-value" style={{ color: tokenColor, fontSize: '0.7em', minWidth: '30px', textAlign: 'center' }}>
                        {percentage}%
                    </span>
                </div>

                {/* Budget Usage (no bar, colored percentage) */}
                {hasBudget && (
                    <div className="chat-stat-item" title={`Budget: $${formatCost(budgetSpent!)} / $${formatCost(maximumBudget!)} (${budgetPercent}%)`}>
                        <span className="chat-stat-label">💰</span>
                        <span className="chat-stat-value" style={{ color: budgetColor, fontSize: '0.7em', minWidth: '30px', textAlign: 'center' }}>
                            {budgetPercent}%
                        </span>
                    </div>
                )}

                {/* Session Cost (only when no budget) */}
                {!hasBudget && totalCost > 0 && (
                    <div className="chat-stat-item" title={`Session Cost: $${formatCost(totalCost)}`}>
                        <span className="chat-stat-label">💰</span>
                        <span className="chat-stat-value">${formatCost(totalCost)}</span>
                    </div>
                )}
            </div>

            {showDetails && (
                <div className="chat-stats-details">
                    {/* Context & Performance */}
                    <div style={{ marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Context Used:</span>
                            <span className="chat-stat-detail-value">{formatNumber(numberOfTokens)} / {formatNumber(maximumNumberOfTokens)}</span>
                        </div>
                        {maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens > 0 && (
                            <div className="chat-stat-detail-row">
                                <span className="chat-stat-detail-label">Highest Participant Context Used:</span>
                                <span className="chat-stat-detail-value">{formatNumber(maximumNumberOfTokensUsedByTheParticipantWithHighestNumberOfTokens)}</span>
                            </div>
                        )}
                        {maximumNumberOfContextTokens > 0 && (
                            <div className="chat-stat-detail-row">
                                <span className="chat-stat-detail-label">Maximum Number Of Context token(s):</span>
                                <span className="chat-stat-detail-value">{formatNumber(maximumNumberOfContextTokens)}</span>
                            </div>
                        )}
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Latency:</span>
                            <span className="chat-stat-detail-value" style={{ color: speedColor }}>
                                {latency > 0 ? (1000 / latency).toFixed(1) : '∞'} token(s)/s
                            </span>
                        </div>
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Time to First Token:</span>
                            <span className="chat-stat-detail-value" style={{ color: ttftColor }}>
                                {timeToFirstToken > 0 ? ttftDisplay : '—'}
                            </span>
                        </div>
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Number Of Messages:</span>
                            <span className="chat-stat-detail-value">{formatNumber(numberOfMessages)}</span>
                        </div>
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Average token(s) Per Message:</span>
                            <span className="chat-stat-detail-value">{numberOfMessages > 0 ? (numberOfTokens / numberOfMessages).toFixed(2) : '00'} token(s)</span>
                        </div>
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Session Duration:</span>
                            <span className="chat-stat-detail-value">{formatSessionDuration(liveDuration)}</span>
                        </div>
                    </div>

                    {/* Budget Statistics */}
                    {hasBudget && (
                        <div style={{ marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                            <div className="chat-stat-detail-row">
                                <span className="chat-stat-detail-label">Budget Spent:</span>
                                <span className="chat-stat-detail-value" style={{ color: budgetColor }}>
                                    ${formatCost(budgetSpent!)} / ${formatCost(maximumBudget!)} ({budgetPercent}%)
                                </span>
                            </div>
                            {timeUntilReset !== null && timeUntilReset !== undefined && (
                                <div className="chat-stat-detail-row">
                                    <span className="chat-stat-detail-label">Next Reset:</span>
                                    <span className="chat-stat-detail-value">
                                        {timeUntilReset > 0 ? `in ${formatResetTime(timeUntilReset)}` : 'Due now'}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Cache Statistics */}
                    {hasCacheData && (
                        <div style={{ marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                            <div className="chat-stat-detail-row">
                                <span className="chat-stat-detail-label">Cache Hit Rate:</span>
                                <span className="chat-stat-detail-value" style={{ color: hitRate > 80 ? '' : '#ff4444' }}>
                                    {hitRate}%
                                </span>
                            </div>
                            <div className="chat-stat-detail-row">
                                <span className="chat-stat-detail-label">Invalidations:</span>
                                <span className="chat-stat-detail-value">{formatNumber(numberOfCacheInvalidations)} ({invalidationRate}%)</span>
                            </div>
                            <div className="chat-stat-detail-row">
                                <span className="chat-stat-detail-label">Total Requests:</span>
                                <span className="chat-stat-detail-value">{formatNumber(numberOfRequests)}</span>
                            </div>
                        </div>
                    )}

                    {/* Session Cost Breakdown */}
                    {totalCost > 0 && (
                        <div>
                            <div className="chat-stat-detail-row">
                                <span className="chat-stat-detail-label">Session Cost:</span>
                                <span className="chat-stat-detail-value">${formatCost(totalCost)}</span>
                            </div>
                            {costWithoutCacheMisses > 0 && (
                                <>
                                    <div className="chat-stat-detail-row">
                                        <span className="chat-stat-detail-label">Cost (No Cache):</span>
                                        <span className="chat-stat-detail-value" style={{ opacity: 0.6 }}>${formatCost(costWithoutCacheMisses)}</span>
                                    </div>
                                    <div className="chat-stat-detail-row">
                                        <span className="chat-stat-detail-label">Savings:</span>
                                        <span className="chat-stat-detail-value" style={{ color: costSavings > 0 ? '' : '#ff4444' }}>
                                            ${formatCost(costSavings)} ({efficiency}%)
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};