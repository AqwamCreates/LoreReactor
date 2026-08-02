import type React from 'react';
import { useState, useEffect } from 'react';

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
    cacheHitCostPerMillion = 0,
    cacheMissCostPerMillion = 0,
    outputGenerationCostPerMillion = 0,
}) => {
    const [showDetails, setShowDetails] = useState(false);
    const percentage = Math.round((tokenCount / maximumNumberOfTokens) * 100);
    const isNearLimit = percentage > 80;
    const isCritical = percentage > 95;
    
    const speedColor = generationSpeed < 30 ? 'var(--accent)' : 
                        generationSpeed < 60 ? 'orange' : '#ff4444';

    const speedDisplay = generationSpeed < 1 ? '<1' : Math.round(generationSpeed);

    const invalidationRate = numberOfRequests > 0 ? Math.round((numberOfCacheInvalidations / numberOfRequests) * 100) : 0;
    const hasCacheData = numberOfRequests > 0;
    const costSavings = costWithoutCacheMisses - totalCost;
    const efficiency = totalCost > 0 ? Math.round((costSavings / costWithoutCacheMisses) * 100) : 0;

    const formatCost = (cost: number) => {
        return cost.toFixed(4);
    };

    return (
        <div 
            className={`chat-stats-bar ${isCritical ? 'chat-stats-critical' : isNearLimit ? 'chat-stats-warning' : ''} ${className}`}
            onClick={() => setShowDetails(!showDetails)}
        >
            <div className="chat-stats-items">
                {/* Generation Speed */}
                <div className="chat-stat-item">
                    <span className="chat-stat-label">⚡</span>
                    <span className="chat-stat-speed-value" style={{ color: speedColor }}>
                        {speedDisplay}ms
                    </span>
                </div>

                {/* Cache Invalidation Count */}
                <div className="chat-stat-item">
                    <span className="chat-stat-label">🔄</span>
                    <span className="chat-stat-value">{numberOfCacheInvalidations}</span>
                </div>
                
                {/* Token Usage */}
                <div className="chat-stat-item chat-stat-token-usage">
                    <span className="chat-stat-label">📊</span>
                    <span className="chat-stat-context-bar">
                        <span 
                            className="chat-stat-context-fill" 
                            style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                    </span>
                </div>

                {/* Total Cost */}
                <div className="chat-stat-item">
                    <span className="chat-stat-label">💰</span>
                    <span className="chat-stat-value">${formatCost(totalCost)}</span>
                </div>
            </div>

            {showDetails && (
                <div className="chat-stats-details">
                    <div className="chat-stat-detail-row">
                        <span className="chat-stat-detail-label">Context Used:</span>
                        <span className="chat-stat-detail-value">{tokenCount.toLocaleString()} / {maximumNumberOfTokens.toLocaleString()} ({percentage}%)</span>
                    </div>
                    <div className="chat-stat-detail-row">
                        <span className="chat-stat-detail-label">Generation Speed:</span>
                        <span className="chat-stat-detail-value">{generationSpeed.toFixed(2)} ms/token</span>
                    </div>
                    <div className="chat-stat-detail-row">
                        <span className="chat-stat-detail-label">Message Count:</span>
                        <span className="chat-stat-detail-value">{messageCount} messages</span>
                    </div>
                    <div className="chat-stat-detail-row">
                        <span className="chat-stat-detail-label">Average Tokens Per Message:</span>
                        <span className="chat-stat-detail-value">{messageCount > 0 ? (tokenCount / messageCount).toFixed(2) : 0} tokens</span>
                    </div>
                    
                    {/* Cache Details */}
                    <div className="chat-stat-detail-row" style={{ marginTop: '4px' }}>
                        <span className="chat-stat-detail-label">Cache Invalidations:</span>
                        <span className="chat-stat-detail-value">{numberOfCacheInvalidations.toLocaleString()}</span>
                    </div>
                    <div className="chat-stat-detail-row">
                        <span className="chat-stat-detail-label">Total Requests:</span>
                        <span className="chat-stat-detail-value">{numberOfRequests.toLocaleString()}</span>
                    </div>
                    <div className="chat-stat-detail-row">
                        <span className="chat-stat-detail-label">Cache Hit Rate:</span>
                        <span className="chat-stat-detail-value">{hasCacheData ? `${100 - invalidationRate}%` : 'N/A'}</span>
                    </div>

                    {/* Cost Details */}
                    <div className="chat-stat-detail-row" style={{ marginTop: '4px' }}>
                        <span className="chat-stat-detail-label">Total Cost:</span>
                        <span className="chat-stat-detail-value">${formatCost(totalCost)}</span>
                    </div>
                    <div className="chat-stat-detail-row">
                        <span className="chat-stat-detail-label">Cost Without Cache Misses:</span>
                        <span className="chat-stat-detail-value">${formatCost(costWithoutCacheMisses)}</span>
                    </div>
                    <div className="chat-stat-detail-row">
                        <span className="chat-stat-detail-label">Cost Savings:</span>
                        <span className="chat-stat-detail-value" style={{ color: costSavings > 0 ? 'var(--accent)' : '#ff4444' }}>
                            ${formatCost(costSavings)} ({efficiency}% saved)
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};