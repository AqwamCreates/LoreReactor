// frontend_src/utilities/voiceTextExtractor.ts
import type { textType } from '../types';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

const BRACED_REGEX = /\{([^}]+)\}/g;

export function extractNarratableText(text: string, narrateTexts: Record<textType, boolean>): string {
    // Remove all tool calls and tool results from the text
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const toolRegex = new RegExp(
        `(${escapeRegex(toolCallStartString)}[\\s\\S]*?${escapeRegex(toolCallEndString)}|${escapeRegex(toolResultStartString)}[\\s\\S]*?${escapeRegex(toolResultEndString)})`,
        'g'
    );
    const cleanText = text.replace(toolRegex, '');

    // State machine to track which formatting context we are currently inside
    let result = '';
    let i = 0;
    
    // Track whether we are currently inside each type of formatting marker
    let insideItalic = false;
    let insideBold = false;
    let insideQuote = false;
    let insideParenthesis = false;
    let insideBracket = false;
    let insideBrace = false;

    while (i < cleanText.length) {
        const currentCharacter = cleanText[i];
        const nextCharacter = cleanText[i + 1];
        const previousCharacter = cleanText[i - 1];

        // ✅ FIX: Helper function to check for sentence-ending punctuation
        const isSentenceEndingPunctuation = (char: string | undefined): boolean => {
            return char === ',' || char === '!' || char === '?' || char === '.';
        };

        // Check for bold marker (**)
        if (currentCharacter === '*' && nextCharacter === '*') {
            // Check if this is closing a bold section
            if (insideBold && isSentenceEndingPunctuation(previousCharacter)) {
                // Replace the comma/exclamation/question with a period for sentence boundary
                result = result.slice(0, -1) + '.';
            }
            insideBold = !insideBold;
            i += 2;
            continue;
        }

        // Check for italic marker (*) - must not be part of bold marker
        if (currentCharacter === '*' && previousCharacter !== '*' && nextCharacter !== '*') {
            // Check if this is closing an italic section
            if (insideItalic && isSentenceEndingPunctuation(previousCharacter)) {
                // Replace the comma/exclamation/question with a period for sentence boundary
                result = result.slice(0, -1) + '.';
            }
            insideItalic = !insideItalic;
            i += 1;
            continue;
        }

        // Check for quote closing markers
        if ((currentCharacter === '"' || currentCharacter === '"' || currentCharacter === '"') && insideQuote) {
            insideQuote = false;
            
            // ✅ FIX: Check if there's punctuation before the closing quote
            if (isSentenceEndingPunctuation(previousCharacter)) {
                // Replace comma/exclamation/question with period for sentence boundary
                result = result.slice(0, -1) + '.';
            }
            
            i += 1;
            continue;
        }
        
        // Check for quote opening markers
        if (currentCharacter === '"' || currentCharacter === '"' || currentCharacter === '"') {
            insideQuote = !insideQuote;
            i += 1;
            continue;
        }

        // Check for parenthesis markers
        if (currentCharacter === '(') {
            insideParenthesis = true;
            i += 1;
            continue;
        }
        if (currentCharacter === ')') {
            // ✅ FIX: Handle closing parenthesis with punctuation
            if (isSentenceEndingPunctuation(previousCharacter)) {
                result = result.slice(0, -1) + '.';
            }
            insideParenthesis = false;
            i += 1;
            continue;
        }

        // Check for bracket markers
        if (currentCharacter === '[') {
            insideBracket = true;
            i += 1;
            continue;
        }
        if (currentCharacter === ']') {
            // ✅ FIX: Handle closing bracket with punctuation
            if (isSentenceEndingPunctuation(previousCharacter)) {
                result = result.slice(0, -1) + '.';
            }
            insideBracket = false;
            i += 1;
            continue;
        }

        // Check for brace markers
        if (currentCharacter === '{') {
            insideBrace = true;
            i += 1;
            continue;
        }
        if (currentCharacter === '}') {
            // ✅ FIX: Handle closing brace with punctuation
            if (isSentenceEndingPunctuation(previousCharacter)) {
                result = result.slice(0, -1) + '.';
            }
            insideBrace = false;
            i += 1;
            continue;
        }

        // Determine whether this character should be included in the narration output
        let shouldIncludeCharacter = false;
        
        if (insideItalic && narrateTexts.italicized) {
            shouldIncludeCharacter = true;
        } else if (insideBold && narrateTexts.bolded) {
            shouldIncludeCharacter = true;
        } else if (insideQuote && narrateTexts.quoted) {
            shouldIncludeCharacter = true;
        } else if (insideParenthesis && narrateTexts.parenthesized) {
            shouldIncludeCharacter = true;
        } else if (insideBracket && narrateTexts.bracketed) {
            shouldIncludeCharacter = true;
        } else if (insideBrace && narrateTexts.braced) {
            shouldIncludeCharacter = true;
        } else if (!insideItalic && !insideBold && !insideQuote && !insideParenthesis && !insideBracket && !insideBrace && narrateTexts.normal) {
            // This is plain text with no active formatting
            shouldIncludeCharacter = true;
        }

        if (shouldIncludeCharacter) {
            result += currentCharacter;
        }
        
        i += 1;
    }

    // Normalize multiple spaces into single spaces and trim leading/trailing whitespace
    return result.replace(/\s+/g, ' ').trim();
}