// frontend_src/utilities/voiceTextExtractor.ts
import type { textType } from '../types';
import { detectFormatSegments, type FormatCategory } from './textDisplayReformatter';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

const CATEGORY_TO_TEXT_TYPE: Record<FormatCategory, textType | null> = {
    plain: 'normal',
    quotes: 'quoted',
    bold: 'bolded',
    italics: 'italicized',
    parentheses: 'parenthesized',
    brackets: 'bracketed',
    strikethrough: 'normal',
};

const BRACED_REGEX = /\{([^}]+)\}/g;

export function extractNarratableText(text: string, narrateTexts: Record<textType, boolean>): string {
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const toolRegex = new RegExp(
        `(${escapeRegex(toolCallStartString)}[\\s\\S]*?${escapeRegex(toolCallEndString)}|${escapeRegex(toolResultStartString)}[\\s\\S]*?${escapeRegex(toolResultEndString)})`,
        'g'
    );
    const cleanText = text.replace(toolRegex, '');

    const segments = detectFormatSegments(cleanText);
    const parts: string[] = [];

    for (const segment of segments) {
        const textType = CATEGORY_TO_TEXT_TYPE[segment.category];
        
        if (segment.category === 'plain') {
            let plainText = segment.innerText;
            
            if (narrateTexts.braced) {
                const bracedMatches = plainText.matchAll(BRACED_REGEX);
                for (const match of bracedMatches) {
                    if (match[1]) parts.push(match[1].trim());
                }
                plainText = plainText.replace(BRACED_REGEX, '');
            }
            
            if (narrateTexts.normal && plainText.trim()) {
                parts.push(plainText.trim());
            }
        } else if (textType && narrateTexts[textType]) {
            parts.push(segment.innerText.trim());
        }
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
}