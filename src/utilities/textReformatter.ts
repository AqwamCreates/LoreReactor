// src/utilities/textReformat.ts

export type FormatCategory = 'plain' | 'italics' | 'bold' | 'strikethrough' | 'quotes' | 'parentheses' | 'brackets';
export interface DetectedSegment {
    start: number;
    end: number;
    category: FormatCategory;
    innerText: string;
    rawMatch: string;
}

export interface CategoryConversion {
    detected: FormatCategory;
    label: string;
    target: FormatCategory;
    count: number;
}

export const CATEGORY_LABELS: Record<FormatCategory, string> = {
    plain: 'Plain Text',
    italics: 'Italics',
    bold: 'Bold',
    strikethrough: 'Strikethrough',
    quotes: 'Quotation Marks',
    parentheses: 'Parentheses',
    brackets: 'Square Brackets',
};

export const TARGET_OPTIONS: { value: FormatCategory; label: string }[] = [
    { value: 'plain', label: 'Plain Text' },
    { value: 'italics', label: 'Italics' },
    { value: 'parentheses', label: 'Parentheses' },
    { value: 'brackets', label: 'Square Brackets' },
    { value: 'quotes', label: 'Quotation Marks' },
    { value: 'bold', label: 'Bold' },
    { value: 'strikethrough', label: 'Strikethrough' },
];

export const DEFAULT_CONVERSIONS: Record<FormatCategory, FormatCategory> = {
    plain: 'plain',
    italics: 'italics',
    parentheses: 'parentheses',
    brackets: 'brackets',
    quotes: 'quotes',
    bold: 'bold',
    strikethrough: 'strikethrough',
};

interface RawMatch {
    start: number;
    end: number;
    category: FormatCategory;
    innerText: string;
    rawMatch: string;
}

const PATTERNS: { regex: RegExp; category: FormatCategory; innerGroup: number }[] = [
    { regex: /\*\*(.+?)\*\*/gs, category: 'bold', innerGroup: 1 },
    { regex: /__(.+?)__/gs, category: 'bold', innerGroup: 1 },
    { regex: /~~(.+?)~~/gs, category: 'strikethrough', innerGroup: 1 },
    { regex: /\*(.+?)\*/gs, category: 'italics', innerGroup: 1 },
    { regex: /_(.+?)_/gs, category: 'italics', innerGroup: 1 },
    { regex: /["\u201C](.+?)["\u201D]/gs, category: 'quotes', innerGroup: 1 },
    { regex: /\(([^)]+)\)/gs, category: 'parentheses', innerGroup: 1 },
    { regex: /\[([^\]]+)\]/gs, category: 'brackets', innerGroup: 1 },
];

export function detectFormatSegments(text: string): DetectedSegment[] {
    const allMatches: RawMatch[] = [];

    for (const { regex, category, innerGroup } of PATTERNS) {
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
            if (match[0].length === 0) {
                regex.lastIndex++;
                continue;
            }

            allMatches.push({
                start: match.index,
                end: match.index + match[0].length,
                category,
                innerText: match[innerGroup] || '',
                rawMatch: match[0],
            });
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
            const plainGap = text.slice(pos, match.start);

            if (plainGap.trim().length > 0) {
                segments.push({
                    start: pos,
                    end: match.start,
                    category: 'plain',
                    innerText: plainGap,
                    rawMatch: plainGap,
                });
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
        const trailing = text.slice(pos);

        if (trailing.trim().length > 0) {
            segments.push({
                start: pos,
                end: text.length,
                category: 'plain',
                innerText: trailing,
                rawMatch: trailing,
            });
        }
    }

    return segments;
}

export function wrapCoreText(core: string, target: FormatCategory): string {
    switch (target) {
        case 'italics':
            return `*${core}*`;
        case 'bold':
            return `**${core}**`;
        case 'strikethrough':
            return `~~${core}~~`;
        case 'quotes':
            return `"${core}"`;
        case 'parentheses':
            return `(${core})`;
        case 'brackets':
            return `[${core}]`;
        default:
            return core;
    }
}

export function convertPlainSegmentPreservingSpacing(raw: string, target: FormatCategory): string {
    if (target === 'plain') return raw;

    const parts = raw.split(/(\r?\n)/);

    return parts.map(part => {
        if (part === '\n' || part === '\r\n') return part;
        if (part.trim().length === 0) return part;

        const match = part.match(/^(\s*)([\s\S]*?)(\s*)$/);
        if (!match) return part;

        const leading = match[1] ?? '';
        const core = match[2] ?? '';
        const trailing = match[3] ?? '';

        if (!core) return part;

        return `${leading}${wrapCoreText(core, target)}${trailing}`;
    }).join('');
}

export function convertFormattedSegmentPreservingSpacing(seg: DetectedSegment, target: FormatCategory): string {
    if (target === seg.category) return seg.rawMatch;

    if (target === 'plain') {
        return seg.innerText;
    }

    return wrapCoreText(seg.innerText, target);
}

export function applyConversions(
    text: string,
    conversions: Record<FormatCategory, FormatCategory>,
): string {
    const segments = detectFormatSegments(text);
    if (segments.length === 0) return text;

    const replacements: { start: number; end: number; replacement: string }[] = [];

    for (const seg of segments) {
        const target = conversions[seg.category] ?? seg.category;

        if (target === seg.category) continue;

        const replacement = seg.category === 'plain'
            ? convertPlainSegmentPreservingSpacing(seg.rawMatch, target)
            : convertFormattedSegmentPreservingSpacing(seg, target);

        if (replacement !== seg.rawMatch) {
            replacements.push({
                start: seg.start,
                end: seg.end,
                replacement,
            });
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
    const counts: Record<FormatCategory, number> = {
        plain: 0,
        italics: 0,
        bold: 0,
        strikethrough: 0,
        quotes: 0,
        parentheses: 0,
        brackets: 0,
    };

    for (const seg of segments) {
        counts[seg.category]++;
    }

    const order: FormatCategory[] = ['plain', 'italics', 'bold', 'strikethrough', 'quotes', 'parentheses', 'brackets'];

    return order
        .filter(category => counts[category] > 0)
        .map(category => ({
            detected: category,
            label: CATEGORY_LABELS[category],
            target: DEFAULT_CONVERSIONS[category],
            count: counts[category],
        }));
}