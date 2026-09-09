// src/components/MemoizedMessageText.tsx
import React from 'react';
import { formatMessageText } from '../utilities/textFormatter';

// LRU cache for formatted message output
const CACHE_MAX_SIZE = 200;
const formatCache = new Map<string, React.ReactNode>();

function getCachedFormat(text: string): React.ReactNode {
    const cached = formatCache.get(text);
    if (cached !== undefined) {
        // Move to end (most recently used)
        formatCache.delete(text);
        formatCache.set(text, cached);
        return cached;
    }

    const result = formatMessageText(text);
    formatCache.set(text, result);

    // Evict oldest entries when over capacity
    if (formatCache.size > CACHE_MAX_SIZE) {
        const firstKey = formatCache.keys().next().value;
        if (firstKey !== undefined) {
            formatCache.delete(firstKey);
        }
    }

    return result;
}

export const MemoizedMessageText = React.memo(function MemoizedMessageText({ text }: { text: string }) {
    return <span className="message-text">{getCachedFormat(text)}</span>;
});