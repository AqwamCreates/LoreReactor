// src/frontend_src/utilities/textDisplayFormatter.tsx
import type React from 'react';
import { useState, useEffect } from 'react';
import type { textType } from '../types';
import { useGenerationStore } from '../hooks/useGenerationStore';
import { chatCoordinator } from '../services/ChatSessionCoordinator';
import { getModelThinkTokenPairs } from '../dictionaries/modelTemplates';

const LEFT_DOUBLE_QUOTE = '\u201C'; // “
const RIGHT_DOUBLE_QUOTE = '\u201D'; // ”

type FormatterMatchType = textType | 'bold_italic' | 'curly_quote' | 'newline' | 'list_item';

interface MatchCandidate {
    type: FormatterMatchType;
    index: number;
    length: number;
    innerContent?: string;
    bullet?: string;
    indent?: number;
    language?: string;
    blockKey?: string;
    isUnclosed?: boolean;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
}

const thinkPairs = getModelThinkTokenPairs();
const thinkStartPattern = thinkPairs.length > 0
    ? thinkPairs.map(p => escapeRegex(p.start)).join('|')
    : '<think>|\\[THINK\\]|<\\|channel>thought';
const thinkEndPattern = thinkPairs.length > 0
    ? thinkPairs.map(p => escapeRegex(p.end)).join('|')
    : '<\\/think>|\\[\\/THINK\\]|<channel\\|>';

const thinkRegex = new RegExp(`(?:${thinkStartPattern})([\\s\\S]*?)(?:${thinkEndPattern}|$)`, 'i');
const thinkEndCheckRegex = new RegExp(`(?:${thinkEndPattern})`, 'i');

const THINK_STATE_MAX = 500;
const thinkExpansionState = new Map<string, boolean>();

function setThinkState(key: string, state: boolean) {
    if (thinkExpansionState.size > THINK_STATE_MAX) {
        const firstKey = thinkExpansionState.keys().next().value;
        if (firstKey !== undefined) thinkExpansionState.delete(firstKey);
    }
    thinkExpansionState.set(key, state);
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(code.trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div className="fmt-code-block-container">
            <div className="fmt-code-block-header">
                <span className="fmt-code-language">{language || 'text'}</span>
                <button className="fmt-code-copy-btn" onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</button>
            </div>
            <pre className="fmt-code-block-pre"><code>{code.trim()}</code></pre>
        </div>
    );
}

function CollapsibleThinkBlock({ 
    children, rawContent, blockKey, isUnclosed = false,
}: { 
    children: React.ReactNode; rawContent: string; blockKey: string; isUnclosed?: boolean;
}) {
    const [isExpanded, setIsExpanded] = useState<boolean>(() => thinkExpansionState.get(blockKey) ?? false);
    const isLoading = useGenerationStore(s => s.isLoading);
    const canSkip = isLoading && isUnclosed;

    useEffect(() => {
        const cached = thinkExpansionState.get(blockKey);
        if (cached !== undefined && cached !== isExpanded) setIsExpanded(cached);
    }, [blockKey]);

    const handleToggle = () => {
        setIsExpanded(prev => {
            const next = !prev;
            setThinkState(blockKey, next);
            return next;
        });
    };

    const handleSkip = (e: React.MouseEvent) => {
        e.stopPropagation();
        chatCoordinator.skipThinking();
    };

    const wordCount = rawContent.trim() ? rawContent.trim().split(/\s+/).length : 0;

    return (
        <div className={`fmt-think-container ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}>
            <button type="button" className="fmt-think-header" onClick={handleToggle} aria-expanded={isExpanded}>
                <div className="fmt-think-label">
                    <span className="fmt-think-icon">💭</span>
                    <span className="fmt-think-title">Thinking</span>
                    <span className="fmt-think-count">({wordCount} words)</span>
                </div>
                <div className="fmt-think-actions">
                    {canSkip && (
                        <button type="button" className="fmt-think-skip-btn" onClick={handleSkip} title="Force model to finish thinking and answer now">Skip Thinking</button>
                    )}
                    <span className="fmt-think-chevron">{isExpanded ? '▾' : '▸'}</span>
                </div>
            </button>
            {isExpanded && <div className="fmt-think-body">{children}</div>}
        </div>
    );
}

function findPairedFormat(text: string, marker: string): { index: number, length: number, innerContent: string } | null {
    const mLen = marker.length;
    const baseChar = marker[0];
    
    const isMarker = (str: string, idx: number): boolean => {
        if (idx < 0 || idx > str.length - mLen) return false;
        if (str.substring(idx, idx + mLen) !== marker) return false;
        const charBefore = idx > 0 ? str[idx - 1] : '';
        const charAfter = str[idx + mLen] || '';
        if (charBefore === baseChar || charAfter === baseChar) return false;
        return true;
    };

    let startIdx = -1;
    for (let i = 0; i <= text.length - mLen; i++) {
        if (isMarker(text, i)) {
            const after = text[i + mLen] || '';
            if (!/\s/.test(after)) {
                startIdx = i;
                break;
            }
        }
    }
    
    if (startIdx === -1) return null;
    
    let paraEnd = text.indexOf('\n\n', startIdx);
    if (paraEnd === -1) paraEnd = text.length;
    const crlfEnd = text.indexOf('\r\n\r\n', startIdx);
    if (crlfEnd !== -1 && (paraEnd === -1 || crlfEnd < paraEnd)) paraEnd = crlfEnd;
    
    const paragraphText = text.substring(startIdx, paraEnd);
    
    let markerIndices: number[] = [];
    for (let j = 0; j <= paragraphText.length - mLen; j++) {
        if (isMarker(paragraphText, j)) {
            markerIndices.push(j);
        }
    }
    
    // FORGIVING FALLBACK WITH CONSUMPTION
    // If paragraph starts and ends with the marker, and has an odd number of markers,
    // pair the outer markers and physically strip the orphaned middle markers from the text.
    if (markerIndices.length >= 3 && markerIndices.length % 2 !== 0) {
        const lastIdx = markerIndices[markerIndices.length - 1];
        const afterLast = paragraphText.substring(lastIdx + mLen).trim();
        if (afterLast === '' || /^[.!?',"]+$/.test(afterLast)) {
            let cleanInner = '';
            let prevEnd = mLen; // Start immediately after the first opening marker
            
            // Iterate through the orphaned middle markers and skip over them
            for (let i = 1; i < markerIndices.length - 1; i++) {
                const orphanIdx = markerIndices[i];
                cleanInner += paragraphText.substring(prevEnd, orphanIdx);
                prevEnd = orphanIdx + mLen; // Consume/skip the orphaned marker
            }
            cleanInner += paragraphText.substring(prevEnd, lastIdx);
            
            return {
                index: startIdx,
                length: lastIdx + mLen - startIdx,
                innerContent: cleanInner
            };
        }
    }

    let depth = 1;
    let i = startIdx + mLen;
    
    while (i < paraEnd) {
        if (isMarker(text, i)) {
            const before = i > 0 ? text[i - 1] : '';
            const after = text[i + mLen] || '';
            
            const canClose = !/\s/.test(before);
            const canOpen = !/\s/.test(after);
            
            if (canClose && !canOpen) depth--;
            else if (!canClose && canOpen) depth++;
            else if (canClose && canOpen) {
                if (depth > 0) depth--;
                else depth++;
            }
            
            if (depth === 0) {
                return {
                    index: startIdx,
                    length: i + mLen - startIdx,
                    innerContent: text.substring(startIdx + mLen, i)
                };
            }
            i += mLen;
        } else {
            i++;
        }
    }
    
    return null;
}

function findDistinctPairedFormat(text: string, openChar: string, closeChar: string): { index: number, length: number, innerContent: string } | null {
    let startIdx = -1;
    
    const isOpening = (idx: number): boolean => {
        if (idx < 0 || idx >= text.length) return false;
        if (text[idx] !== openChar) return false;
        const after = text[idx + 1] || '';
        return !/\s/.test(after);
    };
    
    const isClosing = (idx: number): boolean => {
        if (idx < 0 || idx >= text.length) return false;
        if (text[idx] !== closeChar) return false;
        const before = idx > 0 ? text[idx - 1] : '';
        return !/\s/.test(before);
    };

    for (let i = 0; i < text.length; i++) {
        if (isOpening(i)) {
            startIdx = i;
            break;
        }
    }
    
    if (startIdx === -1) return null;
    
    let depth = 1;
    let i = startIdx + 1;
    
    while (i < text.length) {
        if (text[i] === '\n' && text[i+1] === '\n') return null;
        if (text[i] === '\r' && text[i+1] === '\n' && text[i+2] === '\r' && text[i+3] === '\n') return null;

        if (text[i] === openChar && isOpening(i)) {
            depth++;
        } else if (text[i] === closeChar && isClosing(i)) {
            depth--;
            if (depth === 0) {
                return {
                    index: startIdx,
                    length: i - startIdx + 1,
                    innerContent: text.substring(startIdx + 1, i)
                };
            }
        }
        i++;
    }
    
    return null;
}

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

        const thinkMatch = remaining.match(thinkRegex);
        if (thinkMatch && thinkMatch.index !== undefined) {
            const inner = thinkMatch[1].trim();
            const hasClosedTag = thinkEndCheckRegex.test(thinkMatch[0]);
            const blockKey = `think_${thinkMatch.index}_${inner.slice(0, 40).trim()}`;
            candidates.push({
                type: 'think_block',
                index: thinkMatch.index,
                length: thinkMatch[0].length,
                innerContent: inner,
                blockKey,
                isUnclosed: !hasClosedTag,
            });
        }

        const codeBlockMatch = remaining.match(/```(?:([a-zA-Z0-9_+-]+)\r?\n)?([\s\S]*?)```/);
        if (codeBlockMatch && codeBlockMatch.index !== undefined) {
            candidates.push({
                type: 'code_block',
                index: codeBlockMatch.index,
                length: codeBlockMatch[0].length,
                language: codeBlockMatch[1],
                innerContent: codeBlockMatch[2],
            });
        }

        const inlineCodeMatch = remaining.match(/(?<!`)`([^`]+)`(?!`)/);
        if (inlineCodeMatch && inlineCodeMatch.index !== undefined) {
             candidates.push({
                type: 'inline_code',
                index: inlineCodeMatch.index,
                length: inlineCodeMatch[0].length,
                innerContent: inlineCodeMatch[1],
             });
        }

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

        const nlMatch = remaining.match(/\r?\n/);
        if (nlMatch && nlMatch.index !== undefined) {
            candidates.push({
                type: 'newline',
                index: nlMatch.index,
                length: nlMatch[0].length,
            });
        }

        const biMatch = findPairedFormat(remaining, '***');
        if (biMatch) candidates.push({ type: 'bold_italic', index: biMatch.index, length: biMatch.length, innerContent: biMatch.innerContent });

        const boldMatch = findPairedFormat(remaining, '**');
        if (boldMatch) candidates.push({ type: 'bold', index: boldMatch.index, length: boldMatch.length, innerContent: boldMatch.innerContent });

        const italicMatch = findPairedFormat(remaining, '*');
        if (italicMatch) candidates.push({ type: 'italic', index: italicMatch.index, length: italicMatch.length, innerContent: italicMatch.innerContent });

        const underlineMatch = findPairedFormat(remaining, '_');
        if (underlineMatch) candidates.push({ type: 'underline', index: underlineMatch.index, length: underlineMatch.length, innerContent: underlineMatch.innerContent });

        const strikeMatch = findPairedFormat(remaining, '~~');
        if (strikeMatch) candidates.push({ type: 'strikethrough', index: strikeMatch.index, length: strikeMatch.length, innerContent: strikeMatch.innerContent });

        const quoteMatch = findPairedFormat(remaining, '"');
        if (quoteMatch) candidates.push({ type: 'quote', index: quoteMatch.index, length: quoteMatch.length, innerContent: quoteMatch.innerContent });

        const curlyMatch = findDistinctPairedFormat(remaining, LEFT_DOUBLE_QUOTE, RIGHT_DOUBLE_QUOTE);
        if (curlyMatch) candidates.push({ type: 'curly_quote', index: curlyMatch.index, length: curlyMatch.length, innerContent: curlyMatch.innerContent });

        const parenMatch = findDistinctPairedFormat(remaining, '(', ')');
        if (parenMatch) candidates.push({ type: 'parenthesis', index: parenMatch.index, length: parenMatch.length, innerContent: parenMatch.innerContent });

        const bracketMatch = findDistinctPairedFormat(remaining, '[', ']');
        if (bracketMatch) candidates.push({ type: 'bracket', index: bracketMatch.index, length: bracketMatch.length, innerContent: bracketMatch.innerContent });

        const braceMatch = findDistinctPairedFormat(remaining, '{', '}');
        if (braceMatch) candidates.push({ type: 'brace', index: braceMatch.index, length: braceMatch.length, innerContent: braceMatch.innerContent });

        if (candidates.length === 0) {
            if (isTopLevel) {
                nodes.push(<span key={keyGen.next()} className="fmt-normal">{remaining}</span>);
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
                nodes.push(<span key={keyGen.next()} className="fmt-normal">{before}</span>);
            } else {
                nodes.push(before);
            }
        }

        switch (match.type) {
            case 'think_block':
                nodes.push(
                    <CollapsibleThinkBlock
                        key={`think_node_${match.index}`}
                        blockKey={match.blockKey || `think_${match.index}`}
                        rawContent={match.innerContent ?? ''}
                        isUnclosed={match.isUnclosed}
                    >
                        {parseFormattedText(match.innerContent ?? '', false, keyGen)}
                    </CollapsibleThinkBlock>
                );
                break;
            case 'code_block':
                nodes.push(<CodeBlock key={keyGen.next()} code={match.innerContent || ''} language={match.language} />);
                break;
            case 'inline_code':
                nodes.push(<code key={keyGen.next()} className="fmt-inline-code">{match.innerContent}</code>);
                break;
            case 'list_item': {
                const isBullet = /^[-*+•]$/.test(match.bullet ?? '');
                const displayBullet = isBullet ? '•' : match.bullet;
                nodes.push(
                    <span key={keyGen.next()} className="fmt-list-row" style={match.indent && match.indent > 0 ? { paddingLeft: `${match.indent * 16}px` } : undefined}>
                        <span className="fmt-list-bullet">{displayBullet}</span>
                        <span className="fmt-list-content">{parseFormattedText(match.innerContent ?? '', false, keyGen)}</span>
                    </span>
                );
                break;
            }
            case 'newline':
                nodes.push(<br key={keyGen.next()} />);
                break;
            case 'bold_italic':
                nodes.push(<span key={keyGen.next()} className="fmt-bold fmt-italic">{parseFormattedText(match.innerContent ?? '', false, keyGen)}</span>);
                break;
            case 'bold':
                nodes.push(<span key={keyGen.next()} className="fmt-bold">{parseFormattedText(match.innerContent ?? '', false, keyGen)}</span>);
                break;
            case 'italic':
                nodes.push(<span key={keyGen.next()} className="fmt-italic">{parseFormattedText(match.innerContent ?? '', false, keyGen)}</span>);
                break;
            case 'underline':
                nodes.push(
                    <span key={keyGen.next()} className="fmt-underline" style={{ textDecoration: 'underline', textDecorationColor: 'inherit', color: 'inherit' }}>
                        {parseFormattedText(match.innerContent ?? '', isTopLevel, keyGen)}
                    </span>
                );
                break;
            case 'strikethrough':
                nodes.push(
                    <span key={keyGen.next()} className="fmt-strikethrough" style={{ textDecoration: 'line-through', textDecorationColor: 'inherit', color: 'inherit' }}>
                        {parseFormattedText(match.innerContent ?? '', isTopLevel, keyGen)}
                    </span>
                );
                break;
            case 'quote':
                nodes.push(<span key={keyGen.next()} className="fmt-quote">"{parseFormattedText(match.innerContent ?? '', false, keyGen)}"</span>);
                break;
            case 'curly_quote':
                nodes.push(
                    <span key={keyGen.next()} className="fmt-quote">
                        {LEFT_DOUBLE_QUOTE}{parseFormattedText(match.innerContent ?? '', false, keyGen)}{RIGHT_DOUBLE_QUOTE}
                    </span>
                );
                break;
            case 'parenthesis':
                nodes.push(<span key={keyGen.next()} className="fmt-parenthesis">({parseFormattedText(match.innerContent ?? '', false, keyGen)})</span>);
                break;
            case 'bracket':
                nodes.push(<span key={keyGen.next()} className="fmt-bracket">[{parseFormattedText(match.innerContent ?? '', false, keyGen)}]</span>);
                break;
            case 'brace':
                nodes.push(<span key={keyGen.next()} className="fmt-brace">{'{'}{parseFormattedText(match.innerContent ?? '', false, keyGen)}{'}'}</span>);
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