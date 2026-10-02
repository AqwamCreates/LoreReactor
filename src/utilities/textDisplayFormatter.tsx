// src/utilities/textDisplayFormatter.tsx
import type React from 'react';

const LEFT_DOUBLE_QUOTE = '\u201C'; // “
const RIGHT_DOUBLE_QUOTE = '\u201D'; // ”

interface MatchCandidate {
    type: 'bold_italic' | 'bold' | 'italic' | 'quote' | 'curly_quote' | 'newline';
    index: number;
    length: number;
    innerContent?: string;
}

/**
 * Recursively parses formatting tokens so formatting can be nested/merged.
 */
function parseFormattedText(
    text: string,
    isTopLevel: boolean,
    keyGen: { next: () => number }
): React.ReactNode[] {
    if (!text) return [];

    const nodes: React.ReactNode[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        const candidates: MatchCandidate[] = [];

        // 1. Newlines
        const nlMatch = remaining.match(/\r?\n/);
        if (nlMatch && nlMatch.index !== undefined) {
            candidates.push({
                type: 'newline',
                index: nlMatch.index,
                length: nlMatch[0].length,
            });
        }

        // 2. Bold + Italic (***text***)
        const biMatch = remaining.match(/\*\*\*(.+?)\*\*\*/s);
        if (biMatch && biMatch.index !== undefined) {
            candidates.push({
                type: 'bold_italic',
                index: biMatch.index,
                length: biMatch[0].length,
                innerContent: biMatch[1],
            });
        }

        // 3. Bold (**text**)
        const boldMatch = remaining.match(/(?<!\*)\*\*(?!\*)(.+?)(?<!\*)\*\*(?!\*)/s);
        if (boldMatch && boldMatch.index !== undefined) {
            candidates.push({
                type: 'bold',
                index: boldMatch.index,
                length: boldMatch[0].length,
                innerContent: boldMatch[1],
            });
        }

        // 4. Italic (*text*)
        const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/s);
        if (italicMatch && italicMatch.index !== undefined) {
            candidates.push({
                type: 'italic',
                index: italicMatch.index,
                length: italicMatch[0].length,
                innerContent: italicMatch[1],
            });
        }

        // 5. Straight Quote ("text")
        const quoteMatch = remaining.match(/"([^"]*)"/s);
        if (quoteMatch && quoteMatch.index !== undefined) {
            candidates.push({
                type: 'quote',
                index: quoteMatch.index,
                length: quoteMatch[0].length,
                innerContent: quoteMatch[1],
            });
        }

        // 6. Curly Quotes (“text”)
        const curlyMatch = remaining.match(/\u201C([^\u201D]*)\u201D/s);
        if (curlyMatch && curlyMatch.index !== undefined) {
            candidates.push({
                type: 'curly_quote',
                index: curlyMatch.index,
                length: curlyMatch[0].length,
                innerContent: curlyMatch[1],
            });
        }

        // If no more formatting matches exist, render remaining text
        if (candidates.length === 0) {
            if (isTopLevel) {
                nodes.push(
                    <span key={keyGen.next()} className="fmt-normal">
                        {remaining}
                    </span>
                );
            } else {
                // In nested mode, plain text inherits parent span's color directly
                nodes.push(remaining);
            }
            break;
        }

        // Pick earliest match in string
        candidates.sort((a, b) => a.index - b.index || b.length - a.length);
        const match = candidates[0];

        // Process any unformatted text before the matched token
        if (match.index > 0) {
            const before = remaining.slice(0, match.index);
            if (isTopLevel) {
                nodes.push(
                    <span key={keyGen.next()} className="fmt-normal">
                        {before}
                    </span>
                );
            } else {
                nodes.push(before);
            }
        }

        // Process the matched token recursively
        switch (match.type) {
            case 'newline':
                nodes.push(<br key={keyGen.next()} />);
                break;

            case 'bold_italic':
                nodes.push(
                    <span key={keyGen.next()} className="fmt-bold fmt-italic">
                        {parseFormattedText(match.innerContent ?? '', false, keyGen)}
                    </span>
                );
                break;

            case 'bold':
                nodes.push(
                    <span key={keyGen.next()} className="fmt-bold">
                        {parseFormattedText(match.innerContent ?? '', false, keyGen)}
                    </span>
                );
                break;

            case 'italic':
                nodes.push(
                    <span key={keyGen.next()} className="fmt-italic">
                        {parseFormattedText(match.innerContent ?? '', false, keyGen)}
                    </span>
                );
                break;

            case 'quote':
                nodes.push(
                    <span key={keyGen.next()} className="fmt-quote">
                        "{parseFormattedText(match.innerContent ?? '', false, keyGen)}"
                    </span>
                );
                break;

            case 'curly_quote':
                nodes.push(
                    <span key={keyGen.next()} className="fmt-quote">
                        {LEFT_DOUBLE_QUOTE}
                        {parseFormattedText(match.innerContent ?? '', false, keyGen)}
                        {RIGHT_DOUBLE_QUOTE}
                    </span>
                );
                break;
        }

        // Advance cursor past the matched token
        remaining = remaining.slice(match.index + match.length);
    }

    return nodes;
}

export function formatDisplayMessageText(text: string): React.ReactNode {
    if (!text) return null;

    let keyId = 0;
    const keyGen = { next: () => keyId++ };

    const nodes = parseFormattedText(text, true, keyGen);
    return <>{nodes}</>;
}