// src/components/MemoizedMessageText.tsx
import React from 'react';
import { formatMessageText } from '../utilities/textFormatter';

export const MemoizedMessageText = React.memo(({ text }: { text: string }) => (
    <span className="message-text">{formatMessageText(text)}</span>
));