// src/components/MemoizedMessageText.tsx
import React from 'react';
import { formatMessageText } from '../utilities/textFormatter';

interface MemoizedMessageTextProps {
    text: string;
    /** Optional set of changed segment indices for selective re-rendering */
    changedSegmentIndices?: Set<number>;
}

export const MemoizedMessageText = React.memo(function MemoizedMessageText({ text }: MemoizedMessageTextProps) {
    return <span className="message-text">{formatMessageText(text)}</span>;
}, (prev, next) => {
    // If text hasn't changed, skip re-render entirely
    if (prev.text === next.text) return true;
    return false;
});