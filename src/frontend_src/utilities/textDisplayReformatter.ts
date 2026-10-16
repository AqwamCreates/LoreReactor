// src/frontend_src/utilities/textDisplayReformatter.ts
import type { textType } from '../types';
import { getFormatPreferenceEngine } from '../services/FormatPreferenceEngine';
import {
    toolCallStartString,
    toolCallEndString,
    toolResultStartString,
    toolResultEndString,
} from '../dictionaries/stringList';

export interface DetectedSegment {
    start: number;
    end: number;
    category: textType;
    innerText: string;
    rawMatch: string;
}

export interface CategoryConversion {
    detected: textType;
    label: string;
    target: textType;
    count: number;
}

export const CATEGORY_LABELS: Record<textType, string> = {
    normal: 'Normal',
    italic: 'Italic',
    bold: 'Bold',
    underline: 'Underline',
    strikethrough: 'Strikethrough',
    quote: 'Quotation Marks',
    parenthesis: 'Parentheses',
    bracket: 'Square Brackets',
    brace: 'Curly Braces',
};

export const TARGET_OPTIONS: { value: textType; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'italic', label: 'Italic' },
    { value: 'bold', label: 'Bold' },
    { value: 'underline', label: 'Underline' },
    { value: 'strikethrough', label: 'Strikethrough' },
    { value: 'quote', label: 'Quotation Marks' },
    { value: 'parenthesis', label: 'Parentheses' },
    { value: 'bracket', label: 'Square Brackets' },
    { value: 'brace', label: 'Curly Braces' },
];

export const DEFAULT_CONVERSIONS: Record<textType, textType> = {
    normal: 'normal',
    italic: 'italic',
    bold: 'bold',
    underline: 'underline',
    strikethrough: 'strikethrough',
    quote: 'quote',
    parenthesis: 'parenthesis',
    bracket: 'bracket',
    brace: 'brace',
};

interface RawMatch {
    start: number;
    end: number;
    category: textType;
    innerText: string;
    rawMatch: string;
}

const NO_PARAGRAPH_BREAK = '(?:[^\r\n]|(?<!\r?\n)\r?\n(?!\r?\n))+?';

const PATTERNS: { regex: RegExp; category: textType; innerGroup: number }[] = [
    { regex: new RegExp(`(?<!\\*)\\*\\*(?!\\s|\\*)(${NO_PARAGRAPH_BREAK})(?<!\\s|\\*)\\*\\*(?!\\*)`, 'g'), category: 'bold', innerGroup: 1 },
    { regex: new RegExp(`(?<!\\*)\\*(?!\\s|\\*)(${NO_PARAGRAPH_BREAK})(?<!\\s|\\*)\\*(?!\\*)`, 'g'), category: 'italic', innerGroup: 1 },
    { regex: new RegExp(`(?<!\\w)_(?!\\s|_)(${NO_PARAGRAPH_BREAK})(?<!\\s|_)_(?!\\w)`, 'g'), category: 'underline', innerGroup: 1 },
    { regex: new RegExp(`~~(?!\\s)(${NO_PARAGRAPH_BREAK})(?<!\\s)~~`, 'g'), category: 'strikethrough', innerGroup: 1 },
    { regex: new RegExp(`"(?!\\s)(${NO_PARAGRAPH_BREAK})(?<!\\s)"`, 'g'), category: 'quote', innerGroup: 1 },
    { regex: new RegExp(`\\u201C(${NO_PARAGRAPH_BREAK})\\u201D`, 'g'), category: 'quote', innerGroup: 1 },
    { regex: new RegExp(`\\((?!\\s)(${NO_PARAGRAPH_BREAK})(?<!\\s)\\)`, 'g'), category: 'parenthesis', innerGroup: 1 },
    { regex: new RegExp(`\\[(?!\\s)(${NO_PARAGRAPH_BREAK})(?<!\\s)\\]`, 'g'), category: 'bracket', innerGroup: 1 },
    // ✅ FIXED: Corrected typo from `(?!)\\s)` to `(?!\\s)`
    { regex: new RegExp(`\\{(?!\\s)(${NO_PARAGRAPH_BREAK})(?<!\\s)\\}`, 'g'), category: 'brace', innerGroup: 1 },
];

function findToolRanges(text: string): Array<{ start: number; end: number }> {
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const callStartEsc = escapeRegex(toolCallStartString);
    const callEndEsc = escapeRegex(toolCallEndString);
    const resStartEsc = escapeRegex(toolResultStartString);
    const resEndEsc = escapeRegex(toolResultEndString);

    const toolRegex = new RegExp(
        `(${callStartEsc}[\\s\\S]*?${callEndEsc}|${resStartEsc}[\\s\\S]*?${resEndEsc})`,
        'g'
    );

    const ranges: Array<{ start: number; end: number }> = [];
    let match: RegExpExecArray | null = toolRegex.exec(text);
    while (match !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
        match = toolRegex.exec(text);
    }

    return ranges;
}

export function detectFormatSegments(text: string): DetectedSegment[] {
    const toolRanges = findToolRanges(text);
    const allMatches: RawMatch[] = [];

    for (const { regex, category, innerGroup } of PATTERNS) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null = regex.exec(text);

        while (match !== null) {
            if (match[0].length === 0) {
                regex.lastIndex++;
                match = regex.exec(text);
                continue;
            }

            const matchStart = match.index;
            const matchEnd = match.index + match[0].length;

            let overlapsWithTool = false;
            for (const range of toolRanges) {
                if (matchStart < range.end && matchEnd > range.start) {
                    overlapsWithTool = true;
                    break;
                }
            }

            if (!overlapsWithTool) {
                allMatches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    category,
                    innerText: match[innerGroup] || '',
                    rawMatch: match[0],
                });
            }

            match = regex.exec(text);
        }
    }

    allMatches.sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return (b.end - b.start) - (a.end - a.start);
    });

    const accepted: RawMatch[] = [];
    let cursor = 0;

    for (const match of allMatches) {
        if (match.start < cursor) continue;
        accepted.push(match);
        cursor = match.end;
    }

    const segments: DetectedSegment[] = [];
    let pos = 0;

    for (const match of accepted) {
        if (match.start > pos) {
            let gapPos = pos;

            while (gapPos < match.start) {
                let toolRange: { start: number; end: number } | null = null;
                for (const range of toolRanges) {
                    if (gapPos >= range.start && gapPos < range.end) {
                        toolRange = range;
                        break;
                    }
                }

                if (toolRange) {
                    gapPos = toolRange.end;
                } else {
                    let segmentEnd = match.start;
                    for (const range of toolRanges) {
                        if (range.start > gapPos && range.start < segmentEnd) {
                            segmentEnd = range.start;
                        }
                    }

                    const plainGap = text.slice(gapPos, segmentEnd);
                    if (plainGap.length > 0) {
                        segments.push({
                            start: gapPos,
                            end: segmentEnd,
                            category: 'normal',
                            innerText: plainGap,
                            rawMatch: plainGap,
                        });
                    }

                    gapPos = segmentEnd;
                }
            }
        }

        segments.push({
            start: match.start,
            end: match.end,
            category: match.category,
            innerText: match.innerText,
            rawMatch: match.rawMatch,
        });

        pos = match.end;
    }

    if (pos < text.length) {
        let gapPos = pos;

        while (gapPos < text.length) {
            let toolRange: { start: number; end: number } | null = null;
            for (const range of toolRanges) {
                if (gapPos >= range.start && gapPos < range.end) {
                    toolRange = range;
                    break;
                }
            }

            if (toolRange) {
                gapPos = toolRange.end;
            } else {
                let segmentEnd = text.length;
                for (const range of toolRanges) {
                    if (range.start > gapPos && range.start < segmentEnd) {
                        segmentEnd = range.start;
                    }
                }

                const trailing = text.slice(gapPos, segmentEnd);
                if (trailing.length > 0) {
                    segments.push({
                        start: gapPos,
                        end: segmentEnd,
                        category: 'normal',
                        innerText: trailing,
                        rawMatch: trailing,
                    });
                }

                gapPos = segmentEnd;
            }
        }
    }

    return segments;
}

export function wrapCoreText(core: string, target: textType): string {
    switch (target) {
        case 'italic': return `*${core}*`;
        case 'bold': return `**${core}**`;
        case 'underline': return `_${core}_`;
        case 'strikethrough': return `~~${core}~~`;
        case 'quote': return `"${core}"`;
        case 'parenthesis': return `(${core})`;
        case 'bracket': return `[${core}]`;
        case 'brace': return `{${core}}`;
        default: return core;
    }
}

export function convertPlainSegmentPreservingSpacing(raw: string, target: textType): string {
    if (target === 'normal') return raw;

    const parts = raw.split(/(\r?\n)/);

    return parts.map(part => {
        if (part === '\n' || part === '\r\n') return part;
        if (part.length === 0) return part;

        const match = part.match(/^(\s*)([\s\S]*)(\s*)$/);
        if (!match) return part;

        const leading = match[1] ?? '';
        const core = match[2] ?? '';
        const trailing = match[3] ?? '';

        if (!core) return part;

        return `${leading}${wrapCoreText(core, target)}${trailing}`;
    }).join('');
}

export function convertFormattedSegmentPreservingSpacing(seg: DetectedSegment, target: textType): string {
    if (target === seg.category) return seg.rawMatch;
    if (target === 'normal') return seg.innerText;

    const match = seg.innerText.match(/^(\s*)([\s\S]*)(\s*)$/);
    if (!match) return wrapCoreText(seg.innerText, target);

    const leading = match[1] ?? '';
    const core = match[2] ?? '';
    const trailing = match[3] ?? '';

    return `${leading}${wrapCoreText(core, target)}${trailing}`;
}

export function applyConversions(
    text: string,
    conversions: Record<textType, textType>,
): string {
    const segments = detectFormatSegments(text);
    if (segments.length === 0) return text;

    const replacements: { start: number; end: number; replacement: string }[] = [];

    for (const seg of segments) {
        const target = conversions[seg.category] ?? seg.category;
        if (target === seg.category) continue;

        const replacement = seg.category === 'normal'
            ? convertPlainSegmentPreservingSpacing(seg.rawMatch, target)
            : convertFormattedSegmentPreservingSpacing(seg, target);

        if (replacement !== seg.rawMatch) {
            replacements.push({ start: seg.start, end: seg.end, replacement });
        }
    }

    if (replacements.length === 0) return text;

    let output = text;
    for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        output = output.slice(0, r.start) + r.replacement + output.slice(r.end);
    }

    return output;
}

export function buildCategoryConversions(segments: DetectedSegment[]): CategoryConversion[] {
    const counts: Record<textType, number> = {
        normal: 0, italic: 0, bold: 0, underline: 0,
        strikethrough: 0, quote: 0, parenthesis: 0, bracket: 0, brace: 0,
    };

    for (const seg of segments) counts[seg.category]++;

    const order: textType[] = ['normal', 'italic', 'bold', 'underline', 'strikethrough', 'quote', 'parenthesis', 'bracket', 'brace'];

    return order
        .filter(category => counts[category] > 0)
        .map(category => ({
            detected: category,
            label: CATEGORY_LABELS[category],
            target: DEFAULT_CONVERSIONS[category],
            count: counts[category],
        }));
}

export function buildCategoryConversionsWithLearning(
    text: string, 
    segments: DetectedSegment[]
): CategoryConversion[] {
    const baseConversions = buildCategoryConversions(segments);
    const engine = getFormatPreferenceEngine();

    return baseConversions.map(conv => {
        const seg = segments.find(s => s.category === conv.detected);
        if (seg) {
            const context = engine.extractContext(text, seg.start, seg.end, segments);
            const prediction = engine.predictTarget(conv.detected, context);
            if (prediction) {
                return { ...conv, target: prediction.target };
            }
        }
        return conv;
    });
}

export function recordCategoryCorrection(
    text: string,
    category: textType,
    target: textType,
): void {
    if (category === target) return;
    const segments = detectFormatSegments(text);
    const engine = getFormatPreferenceEngine();

    for (const seg of segments) {
        if (seg.category === category) {
            const context = engine.extractContext(text, seg.start, seg.end, segments);
            engine.recordCorrection(category, target, context);
        }
    }
}

export function learnFromManualEdits(originalText: string, finalText: string): void {
    if (originalText === finalText) return;

    const originalSegments = detectFormatSegments(originalText);
    const finalSegments = detectFormatSegments(finalText);
    const engine = getFormatPreferenceEngine();

    for (const origSeg of originalSegments) {
        const origCore = origSeg.innerText;
        if (!origCore) continue;

        const matchingFinal = finalSegments.find(fSeg => {
            const finalCore = fSeg.innerText
            return finalCore === origCore && fSeg.category !== origSeg.category;
        });

        if (matchingFinal) {
            const context = engine.extractContext(
                originalText, 
                origSeg.start, 
                origSeg.end, 
                originalSegments
            );
            engine.recordCorrection(origSeg.category, matchingFinal.category, context);
        }
    }
}