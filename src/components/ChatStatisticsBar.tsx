// src/components/ChatStatisticsBar.tsx
import type React from 'react';
import { useState } from 'react';

interface ChatStatisticsBarProps {
    generationSpeed: number; // ms per token
    messageCount: number;
    tokenCount: number;
    maximumNumberOfTokens: number;
    className?: string;
    numberOfCacheInvalidations?: number;
    numberOfRequests?: number;
    totalCost?: number;
    costWithoutCacheMisses?: number;
    cacheHitCostPerMillion?: number;
    cacheMissCostPerMillion?: number;
    outputGenerationCostPerMillion?: number;
}

export const ChatStatisticsBar: React.FC<ChatStatisticsBarProps> = ({
    generationSpeed = 0,          
    messageCount = 0,             
    tokenCount = 0,               
    maximumNumberOfTokens = 65536,
    className = '',
    numberOfCacheInvalidations = 0,
    numberOfRequests = 0,
    totalCost = 0,
    costWithoutCacheMisses = 0,
}) => {
    const [showDetails, setShowDetails] = useState(false);

    // Calculate Percentage
    const safeMax = maximumNumberOfTokens > 0 ? maximumNumberOfTokens : 1;
    const percentage = Math.min(100, Math.round((tokenCount / safeMax) * 100));
    const isNearLimit = percentage > 80;
    const isCritical = percentage > 95;
    
    // ✅ BINARY THRESHOLD
    // Target: ~9 tokens/sec = ~111ms/token
    // Green: < 110ms (Comfortable reading)
    // Red: >= 110ms (Slower than reading)
    
    const isFastEnough = generationSpeed < 110;
    const speedColor = isFastEnough ? '' : '#ff4444';
    
    const speedDisplay = generationSpeed < 1 ? '<1' : Math.round(generationSpeed);
    
    // Dynamic Icon: Lightning for fast, Turtle for slow
    const speedIcon = isFastEnough ? '⚡' : '🐢';

    // Calculate Cache Metrics
    const invalidationRate = numberOfRequests > 0 ? Math.round((numberOfCacheInvalidations / numberOfRequests) * 100) : 0;
    const hitRate = numberOfRequests > 0 ? 100 - invalidationRate : 0;
    const hasCacheData = numberOfRequests > 0;

    // Calculate Cost Metrics
    const costSavings = Math.max(0, costWithoutCacheMisses - totalCost);
    const efficiency = costWithoutCacheMisses > 0 ? Math.round((costSavings / costWithoutCacheMisses) * 100) : 0;

    const formatCost = (cost: number) => {
        if (cost === 0) return '0.0000';
        return cost.toFixed(4);
    };

    const formatNumber = (num: number) => {
        return num.toLocaleString();
    };

    return (
        <div 
            className={`chat-stats-bar ${isCritical ? 'chat-stats-critical' : isNearLimit ? 'chat-stats-warning' : ''} ${className}`}
            onClick={() => setShowDetails(!showDetails)}
            title="Click to toggle details"
            style={{ cursor: 'pointer' }}
        >
            <div className="chat-stats-items">
                {/* Generation Speed */}
                <div className="chat-stat-item" title={`Generation Speed: ${generationSpeed.toFixed(2)} ms/token`}>
                    <span className="chat-stat-label">{speedIcon}</span>
                    <span className="chat-stat-speed-value" style={{ color: speedColor }}>
                        {speedDisplay}ms
                    </span>
                </div>

                {/* Cache Invalidation Count (Only show if > 0) */}
                {numberOfCacheInvalidations > 0 && (
                    <div className="chat-stat-item" title={`${numberOfCacheInvalidations} cache invalidations`}>
                        <span className="chat-stat-label">🔄</span>
                        <span className="chat-stat-value">{numberOfCacheInvalidations}</span>
                    </div>
                )}
                
                {/* Token Usage Bar */}
                <div className="chat-stat-item chat-stat-token-usage" title={`${tokenCount} / ${maximumNumberOfTokens} tokens`}>
                    <span className="chat-stat-label">📊</span>
                    <span className="chat-stat-context-bar">
                        <span 
                            className="chat-stat-context-fill" 
                            style={{ width: `${percentage}%` }}
                        />
                    </span>
                    <span className="chat-stat-value" style={{ fontSize: '0.7em', minWidth: '30px', textAlign: 'center' }}>
                        {percentage}%
                    </span>
                </div>

                {/* Total Cost (Always show if > 0) */}
                {totalCost > 0 && (
                    <div className="chat-stat-item" title={`Total Cost: $${formatCost(totalCost)}`}>
                        <span className="chat-stat-label">💰</span>
                        <span className="chat-stat-value">${formatCost(totalCost)}</span>
                    </div>
                )}
            </div>

            {showDetails && (
                <div className="chat-stats-details">
                    {/* --- Context & Performance --- */}
                    <div style={{ marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Context Used:</span>
                            <span className="chat-stat-detail-value">{formatNumber(tokenCount)} / {formatNumber(maximumNumberOfTokens)} ({percentage}%)</span>
                        </div>
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Generation Speed:</span>
                            <span className="chat-stat-detail-value" style={{ color: speedColor }}>
                                {generationSpeed > 0 ? (1000/generationSpeed).toFixed(1) : '∞'} tokens/s
                            </span>
                        </div>
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Messages:</span>
                            <span className="chat-stat-detail-value">{formatNumber(messageCount)}</span>
                        </div>
                        <div className="chat-stat-detail-row">
                            <span className="chat-stat-detail-label">Avg Tokens/Msg:</span>
                            <span className="chat-stat-detail-value">{messageCount > 0 ? (tokenCount / messageCount).toFixed(1) : '0'} tokens</span>
                        </div>
                    </div>

                    {/* --- Cache Statistics --- */}
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

                    {/* --- Cost Breakdown --- */}
                    {totalCost > 0 && (
                        <div>
                            <div className="chat-stat-detail-row">
                                <span className="chat-stat-detail-label">Total Cost:</span>
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