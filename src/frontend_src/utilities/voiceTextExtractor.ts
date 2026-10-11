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
    // 1. Strip tool calls
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const toolRegex = new RegExp(
        `(${escapeRegex(toolCallStartString)}[\\s\\S]*?${escapeRegex(toolCallEndString)}|${escapeRegex(toolResultStartString)}[\\s\\S]*?${escapeRegex(toolResultEndString)})`,
        'g'
    );
    let cleanText = text.replace(toolRegex, '');

    // 2. ✅ STREAMING FIX: Detect unclosed formatting markers.
    // If a format is disabled and its marker is unclosed (odd count), 
    // truncate the text right before that last unclosed marker to prevent 
    // it from being incorrectly treated as plain text.
    
    let truncatePos = cleanText.length;

    // Check Bold (**)
    let boldCount = 0;
    let lastBoldPos = -1;
    for (let i = 0; i < cleanText.length - 1; i++) {
        if (cleanText[i] === '*' && cleanText[i + 1] === '*') {
            boldCount++;
            lastBoldPos = i;
            i++; // Skip next *
        }
    }
    if (boldCount % 2 !== 0 && !narrateTexts.bolded && lastBoldPos !== -1) {
        truncatePos = Math.min(truncatePos, lastBoldPos);
    }

    // Check Italic (*) - must not be part of **
    let italicCount = 0;
    let lastItalicPos = -1;
    for (let i = 0; i < cleanText.length; i++) {
        if (cleanText[i] === '*') {
            const prev = i > 0 ? cleanText[i - 1] : '';
            const next = i < cleanText.length - 1 ? cleanText[i + 1] : '';
            if (prev !== '*' && next !== '*') {
                italicCount++;
                lastItalicPos = i;
            }
        }
    }
    if (italicCount % 2 !== 0 && !narrateTexts.italicized && lastItalicPos !== -1) {
        truncatePos = Math.min(truncatePos, lastItalicPos);
    }

    // Check Quotes (", ", ")
    let quoteCount = 0;
    let lastQuotePos = -1;
    for (let i = 0; i < cleanText.length; i++) {
        if (cleanText[i] === '"' || cleanText[i] === '"' || cleanText[i] === '"') {
            quoteCount++;
            lastQuotePos = i;
        }
    }
    if (quoteCount % 2 !== 0 && !narrateTexts.quoted && lastQuotePos !== -1) {
        truncatePos = Math.min(truncatePos, lastQuotePos);
    }

    // Truncate at the earliest unclosed disabled marker
    cleanText = cleanText.substring(0, truncatePos);

    // 3. Process segments on the now-safe text
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