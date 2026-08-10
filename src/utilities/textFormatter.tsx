// src/utilities/textFormatter.tsx
import React from 'react';

const LEFT_DOUBLE_QUOTE = '\u201C'; // "
const RIGHT_DOUBLE_QUOTE = '\u201D'; // "

/**
 * Splits text on newlines and returns React nodes with <br /> between lines.
 */
function renderWithLineBreaks(text: string, className: string, startKey: number): { nodes: React.ReactNode[]; nextKey: number } {
    const lines = text.split('\n');
    const nodes: React.ReactNode[] = [];
    let key = startKey;
    for (let i = 0; i < lines.length; i++) {
        if (i > 0) nodes.push(<br key={key++} />);
        if (lines[i]) nodes.push(<span key={key++} className={className}>{lines[i]}</span>);
    }
    return { nodes, nextKey: key };
}

/**
 * Parses RP message text and returns formatted React elements.
 * 
 * Formatting rules:
 * - "quoted dialogue" or "curly quoted" → orange
 * - *italic actions* → accent color, italic
 * - **bold emphasis** → bright white with glow
 * - Normal text → default white
 * - Newlines are always preserved as <br />
 */
export function formatMessageText(text: string): React.ReactNode {
    if (!text) return null;

    const elements: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
        // Try to match bold first (**...**) — dotall flag handles newlines inside
        const boldMatch = remaining.match(/^\*\*(.+?)\*\*/s);
        if (boldMatch) {
            const { nodes, nextKey } = renderWithLineBreaks(boldMatch[1], 'fmt-bold', key);
            elements.push(...nodes);
            key = nextKey;
            remaining = remaining.slice(boldMatch[0].length);
            continue;
        }

        // Try to match italic (*...*) — single asterisk, not double
        // Negative lookahead ensures we don't match ** as italic opener
        const italicMatch = remaining.match(/^\*(?!\*)(.+?)(?<!\*)\*(?!\*)/s);
        if (italicMatch) {
            const { nodes, nextKey } = renderWithLineBreaks(italicMatch[1], 'fmt-italic', key);
            elements.push(...nodes);
            key = nextKey;
            remaining = remaining.slice(italicMatch[0].length);
            continue;
        }

        // Try to match straight quoted dialogue ("...")
        const quoteMatch = remaining.match(/^"([^"]*)"/);
        if (quoteMatch) {
            const { nodes, nextKey } = renderWithLineBreaks(quoteMatch[0], 'fmt-quote', key);
            elements.push(...nodes);
            key = nextKey;
            remaining = remaining.slice(quoteMatch[0].length);
            continue;
        }

        // Try to match curly/smart quotes ("...")
        if (remaining.startsWith(LEFT_DOUBLE_QUOTE)) {
            const endIdx = remaining.indexOf(RIGHT_DOUBLE_QUOTE, 1);
            if (endIdx !== -1) {
                const full = remaining.slice(0, endIdx + 1);
                const { nodes, nextKey } = renderWithLineBreaks(full, 'fmt-quote', key);
                elements.push(...nodes);
                key = nextKey;
                remaining = remaining.slice(full.length);
                continue;
            }
        }

        // Handle standalone newlines before normal text batching
        if (remaining[0] === '\n') {
            elements.push(<br key={key++} />);
            remaining = remaining.slice(1);
            continue;
        }

        // No match — batch consecutive normal characters
        let normalEnd = 0;
        while (normalEnd < remaining.length) {
            const ch = remaining[normalEnd];
            const nextTwo = remaining.slice(normalEnd, normalEnd + 2);
            if (nextTwo === '**') break;
            // Single * that isn't part of **
            if (ch === '*' && remaining[normalEnd + 1] !== '*') break;
            if (ch === '"') break;
            if (ch === LEFT_DOUBLE_QUOTE) break;
            if (ch === '\n') break;
            normalEnd++;
        }

        if (normalEnd > 0) {
            const normalText = remaining.slice(0, normalEnd);
            const { nodes, nextKey } = renderWithLineBreaks(normalText, 'fmt-normal', key);
            elements.push(...nodes);
            key = nextKey;
            remaining = remaining.slice(normalEnd);
        } else {
            // Safety valve: consume one character to prevent infinite loop
            elements.push(<span key={key++} className="fmt-normal">{remaining[0]}</span>);
            remaining = remaining.slice(1);
        }
    }

    return <>{elements}</>;
}