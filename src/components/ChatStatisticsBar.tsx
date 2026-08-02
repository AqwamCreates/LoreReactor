import type React from 'react';
import { useState } from 'react';

interface ChatStatisticsBarProps {
    generationSpeed: number; // ms per token
    messageCount: number;
    tokenCount: number;
    maximumNumberOfTokens: number;
    className?: string;
}

export const ChatStatisticsBar: React.FC<ChatStatisticsBarProps> = ({
    generationSpeed = 0,          
    messageCount = 0,             
    tokenCount = 0,               
    maximumNumberOfTokens = 65536,
    className = '',
}) => {
    const [showDetails, setShowDetails] = useState(false);
    const percentage = Math.round((tokenCount / maximumNumberOfTokens) * 100);
    const isNearLimit = percentage > 80;
    const isCritical = percentage > 95;
    
    const speedColor = generationSpeed < 30 ? 'var(--accent)' : 
                        generationSpeed < 60 ? 'orange' : '#ff4444';

    // Format speed for display
    const speedDisplay = generationSpeed < 1 ? '<1' : Math.round(generationSpeed);

    return (
        <div 
        className={`chat-stats-bar ${isCritical ? 'chat-stats-critical' : isNearLimit ? 'chat-stats-warning' : ''} ${className}`}
        onClick={() => setShowDetails(!showDetails)}
        >
        <div className="chat-stats-items">
            {/* Generation Speed - First (most important) */}
            <div className="chat-stat-item">
            <div className="chat-stat-label">⚡</div>
            <div className="chat-stat-speed-value" style={{ color: speedColor }}>
                {speedDisplay}ms
            </div>
            </div>
            
            {/* Message Count - Second */}
            <div className="chat-stat-item">
            <div className="chat-stat-label">💬</div>
            <div className="chat-stat-value">{messageCount}</div>
            </div>
            
            {/* Token Usage - Progress Bar */}
            <div className="chat-stat-item chat-stat-token-usage">
            <div className="chat-stat-label">📊</div>
            <div className="chat-stat-context-bar">
                <div 
                className="chat-stat-context-fill" 
                style={{ width: `${Math.min(percentage, 100)}%` }}
                />
            </div>
            </div>
        </div>
        {showDetails && (
            <div className="chat-stats-details">
            <div className="chat-stat-detail-row">
                <div className="chat-stat-detail-label">Context Used:</div>
                <div className="chat-stat-detail-value">{tokenCount.toLocaleString()} / {maximumNumberOfTokens.toLocaleString()} ({percentage}%)</div>
            </div>
            <div className="chat-stat-detail-row">
                <div className="chat-stat-detail-label">Generation Speed:</div>
                <div className="chat-stat-detail-value">{generationSpeed.toFixed(1)} ms/token</div>
            </div>
            <div className="chat-stat-detail-row">
                <div className="chat-stat-detail-label">Message Count:</div>
                <div className="chat-stat-detail-value">{messageCount} messages</div>
            </div>
            <div className="chat-stat-detail-row">
                <div className="chat-stat-detail-label">Avg Tokens/Message:</div>
                <div className="chat-stat-detail-value">{messageCount > 0 ? Math.round(tokenCount / messageCount) : 0} tokens</div>
            </div>
            </div>
        )}
        </div>
    );
};