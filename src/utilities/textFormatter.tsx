// src/utilities/textFormatter.tsx
import React from 'react';

const LEFT_DOUBLE_QUOTE = '\u201C'; // "
const RIGHT_DOUBLE_QUOTE = '\u201D'; // "

/**
 * Parses RP message text and returns formatted React elements.
 * 
 * Formatting rules:
 * - "quoted dialogue" or "curly quoted" → orange
 * - *italic actions* → accent color, italic
 * - **bold emphasis** → bright white with glow
 * - Normal text → default white
 */
export function formatMessageText(text: string): React.ReactNode {
    if (!text) return null;

    const elements: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
        // Try to match bold first (**...**)
        const boldMatch = remaining.match(/^\*\*(.+?)\*\*/s);
        if (boldMatch) {
            elements.push(
                <span key={key++} className="fmt-bold">{boldMatch[1]}</span>
            );
            remaining = remaining.slice(boldMatch[0].length);
            continue;
        }

        // Try to match italic (*...*) — single asterisk, not double
        const italicMatch = remaining.match(/^\*(.+?)\*/s);
        if (italicMatch) {
            elements.push(
                <span key={key++} className="fmt-italic">{italicMatch[1]}</span>
            );
            remaining = remaining.slice(italicMatch[0].length);
            continue;
        }

        // Try to match straight quoted dialogue ("...")
        const quoteMatch = remaining.match(/^"([^"]*)"/);
        if (quoteMatch) {
            elements.push(
                <span key={key++} className="fmt-quote">{quoteMatch[0]}</span>
            );
            remaining = remaining.slice(quoteMatch[0].length);
            continue;
        }

        // Try to match curly/smart quotes ("...")
        if (remaining.startsWith(LEFT_DOUBLE_QUOTE)) {
            const endIdx = remaining.indexOf(RIGHT_DOUBLE_QUOTE, 1);
            if (endIdx !== -1) {
                const full = remaining.slice(0, endIdx + 1);
                elements.push(
                    <span key={key++} className="fmt-quote">{full}</span>
                );
                remaining = remaining.slice(full.length);
                continue;
            }
        }

        // No match — batch consecutive normal characters
        let normalEnd = 0;
        while (normalEnd < remaining.length) {
            const ch = remaining[normalEnd];
            const nextTwo = remaining.slice(normalEnd, normalEnd + 2);
            if (nextTwo === '**') break;
            if (ch === '*' && remaining[normalEnd + 1] !== '*') break;
            if (ch === '"') break;
            if (ch === LEFT_DOUBLE_QUOTE) break;
            normalEnd++;
        }

        if (normalEnd > 0) {
            const normalText = remaining.slice(0, normalEnd);
            const lines = normalText.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (i > 0) elements.push(<br key={key++} />);
                if (lines[i]) elements.push(<span key={key++} className="fmt-normal">{lines[i]}</span>);
            }
            remaining = remaining.slice(normalEnd);
        } else {
            // Safety valve
            elements.push(<span key={key++} className="fmt-normal">{remaining[0]}</span>);
            remaining = remaining.slice(1);
        }
    }

    return <>{elements}</>;
}