// frontend_src/utilities/textDisplayFormatter.tsx
import type React from 'react';

const LEFT_DOUBLE_QUOTE = '\u201C'; // “
const RIGHT_DOUBLE_QUOTE = '\u201D'; // ”

interface MatchCandidate {
    type: 'bold_italic' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'quote' | 'curly_quote' | 'newline' | 'list_item';
    index: number;
    length: number;
    innerContent?: string;
    bullet?: string;
    indent?: number;
}

const NO_PARAGRAPH_BREAK = '(?:[^\r\n]|(?<!\r?\n)\r?\n(?!\r?\n))+?';

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

        // 1. List Item
        const listMatch = remaining.match(/(?:^|\r?\n)([ \t]*)([-*+•]|\d{1,3}[.)])[ \t]+([^\r\n]*)/);
        if (listMatch && listMatch.index !== undefined) {
            const indentStr = listMatch[1] ?? '';
            const indentLevel = Math.min(4, Math.floor(indentStr.length / 2));
            candidates.push({
                type: 'list_item',
                index: listMatch.index,
                length: listMatch[0].length,
                bullet: listMatch[2],
                innerContent: listMatch[3] ?? '',
                indent: indentLevel,
            });
        }

        // 2. Newlines
        const nlMatch = remaining.match(/\r?\n/);
        if (nlMatch && nlMatch.index !== undefined) {
            candidates.push({
                type: 'newline',
                index: nlMatch.index,
                length: nlMatch[0].length,
            });
        }

        // 3. Bold + Italic (***text*** ONLY)
        const biMatch = remaining.match(new RegExp(`(?<!\\*)\\*\\*\\*(?!\\s|\\*)(${NO_PARAGRAPH_BREAK})(?<!\\s|\\*)\\*\\*\\*(?!\\*)`));
        if (biMatch && biMatch.index !== undefined) {
            candidates.push({
                type: 'bold_italic',
                index: biMatch.index,
                length: biMatch[0].length,
                innerContent: biMatch[1],
            });
        }

        // 4. Bold (**text** ONLY)
        const boldMatch = remaining.match(new RegExp(`(?<!\\*)\\*\\*(?!\\s|\\*)(${NO_PARAGRAPH_BREAK})(?<!\\s|\\*)\\*\\*(?!\\*)`));
        if (boldMatch && boldMatch.index !== undefined) {
            candidates.push({
                type: 'bold',
                index: boldMatch.index,
                length: boldMatch[0].length,
                innerContent: boldMatch[1],
            });
        }

        // 5. Italic (*text* ONLY)
        const italicMatch = remaining.match(new RegExp(`(?<!\\*)\\*(?!\\s|\\*)(${NO_PARAGRAPH_BREAK})(?<!\\s|\\*)\\*(?!\\*)`));
        if (italicMatch && italicMatch.index !== undefined) {
            candidates.push({
                type: 'italic',
                index: italicMatch.index,
                length: italicMatch[0].length,
                innerContent: italicMatch[1],
            });
        }

        // 6. Underline (_text_ ONLY)
        const underlineMatch = remaining.match(new RegExp(`(?<!\\w)_(?!\\s|_)(${NO_PARAGRAPH_BREAK})(?<!\\s|_)_(?!\\w)`));
        if (underlineMatch && underlineMatch.index !== undefined) {
            candidates.push({
                type: 'underline',
                index: underlineMatch.index,
                length: underlineMatch[0].length,
                innerContent: underlineMatch[1],
            });
        }

        // 7. Strikethrough (~~text~~)
        const strikeMatch = remaining.match(new RegExp(`~~(?!\\s)(${NO_PARAGRAPH_BREAK})(?<!\\s)~~`));
        if (strikeMatch && strikeMatch.index !== undefined) {
            candidates.push({
                type: 'strikethrough',
                index: strikeMatch.index,
                length: strikeMatch[0].length,
                innerContent: strikeMatch[1],
            });
        }

        // 8. Straight Quote ("text")
        const quoteMatch = remaining.match(new RegExp(`"(?!\\s)(${NO_PARAGRAPH_BREAK})(?<!\\s)"`));
        if (quoteMatch && quoteMatch.index !== undefined) {
            candidates.push({
                type: 'quote',
                index: quoteMatch.index,
                length: quoteMatch[0].length,
                innerContent: quoteMatch[1],
            });
        }

        // 9. Curly Quotes (“text”)
        const curlyMatch = remaining.match(new RegExp(`\\u201C(${NO_PARAGRAPH_BREAK})\\u201D`));
        if (curlyMatch && curlyMatch.index !== undefined) {
            candidates.push({
                type: 'curly_quote',
                index: curlyMatch.index,
                length: curlyMatch[0].length,
                innerContent: curlyMatch[1],
            });
        }

        if (candidates.length === 0) {
            if (isTopLevel) {
                nodes.push(
                    <span key={keyGen.next()} className="fmt-normal">
                        {remaining}
                    </span>
                );
            } else {
                nodes.push(remaining);
            }
            break;
        }

        candidates.sort((a, b) => a.index - b.index || b.length - a.length);
        const match = candidates[0];

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

        switch (match.type) {
            case 'list_item': {
                const isBullet = /^[-*+•]$/.test(match.bullet ?? '');
                const displayBullet = isBullet ? '•' : match.bullet;
                nodes.push(
                    <span
                        key={keyGen.next()}
                        className="fmt-list-row"
                        style={match.indent && match.indent > 0 ? { paddingLeft: `${match.indent * 16}px` } : undefined}
                    >
                        <span className="fmt-list-bullet">{displayBullet}</span>
                        <span className="fmt-list-content">
                            {parseFormattedText(match.innerContent ?? '', false, keyGen)}
                        </span>
                    </span>
                );
                break;
            }

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

            case 'underline':
                nodes.push(
                    <span
                        key={keyGen.next()}
                        style={{
                            textDecoration: 'underline',
                            textDecorationColor: 'inherit',
                            color: 'inherit',
                        }}
                    >
                        {parseFormattedText(match.innerContent ?? '', isTopLevel, keyGen)}
                    </span>
                );
                break;

            case 'strikethrough':
                nodes.push(
                    <span
                        key={keyGen.next()}
                        style={{
                            textDecoration: 'line-through',
                            textDecorationColor: 'inherit',
                            color: 'inherit',
                        }}
                    >
                        {parseFormattedText(match.innerContent ?? '', isTopLevel, keyGen)}
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