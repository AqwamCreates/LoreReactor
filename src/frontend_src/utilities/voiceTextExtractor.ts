// frontend_src/utilities/voiceTextExtractor.ts
import type { textType } from '../types';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

export function extractNarratableText(text: string, narrateTexts: Record<textType, boolean>): string {
    // Remove all tool calls and tool results from the text
    const escapeRegex = (stringToEscape: string) => stringToEscape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const toolRegex = new RegExp(
        `(${escapeRegex(toolCallStartString)}[\\s\\S]*?${escapeRegex(toolCallEndString)}|${escapeRegex(toolResultStartString)}[\\s\\S]*?${escapeRegex(toolResultEndString)})`,
        'g'
    );
    const cleanText = text.replace(toolRegex, '');

    let result = '';
    let i = 0;
    
    let insideItalic = false;
    let insideBold = false;
    let insideQuote = false;
    let insideParenthesis = false;
    let insideBracket = false;
    let insideBrace = false;

    // Helper to convert trailing commas, exclamation marks, or question marks into periods.
    // This enforces sentence boundaries at formatting transitions (e.g., dialogue to action).
    const fixTrailingPunctuation = () => {
        result = result.replace(/([,!?])(\s*)$/, '.$2');
    };

    while (i < cleanText.length) {
        const currentCharacter = cleanText[i];
        const nextCharacter = cleanText[i + 1];
        const previousCharacter = cleanText[i - 1];

        // Check for bold marker (**)
        if (currentCharacter === '*' && nextCharacter === '*') {
            const wasInsideBold = insideBold;
            insideBold = !insideBold;
            
            if (wasInsideBold && narrateTexts.bolded) {
                fixTrailingPunctuation();
            } else if (!wasInsideBold && !narrateTexts.bolded) {
                fixTrailingPunctuation();
            }
            
            i += 2;
            continue;
        }

        // Check for italic marker (*)
        if (currentCharacter === '*' && previousCharacter !== '*' && nextCharacter !== '*') {
            const wasInsideItalic = insideItalic;
            insideItalic = !insideItalic;
            
            if (wasInsideItalic && narrateTexts.italicized) {
                fixTrailingPunctuation();
            } else if (!wasInsideItalic && !narrateTexts.italicized) {
                fixTrailingPunctuation();
            }
            
            i += 1;
            continue;
        }

        // Check for quote markers (" “ ”)
        if (currentCharacter === '"' || currentCharacter === '"' || currentCharacter === '"') {
            const wasInsideQuote = insideQuote;
            insideQuote = !insideQuote;
            
            if (wasInsideQuote && narrateTexts.quoted) {
                fixTrailingPunctuation();
            } else if (!wasInsideQuote && !narrateTexts.quoted) {
                fixTrailingPunctuation();
            }
            
            i += 1;
            continue;
        }

        // Check for parenthesis markers
        if (currentCharacter === '(') {
            insideParenthesis = true;
            if (!narrateTexts.parenthesized) fixTrailingPunctuation();
            i += 1;
            continue;
        }
        if (currentCharacter === ')') {
            const wasInsideParenthesis = insideParenthesis;
            insideParenthesis = false;
            if (wasInsideParenthesis && narrateTexts.parenthesized) fixTrailingPunctuation();
            i += 1;
            continue;
        }

        // Check for bracket markers
        if (currentCharacter === '[') {
            insideBracket = true;
            if (!narrateTexts.bracketed) fixTrailingPunctuation();
            i += 1;
            continue;
        }
        if (currentCharacter === ']') {
            const wasInsideBracket = insideBracket;
            insideBracket = false;
            if (wasInsideBracket && narrateTexts.bracketed) fixTrailingPunctuation();
            i += 1;
            continue;
        }

        // Check for brace markers
        if (currentCharacter === '{') {
            insideBrace = true;
            if (!narrateTexts.braced) fixTrailingPunctuation();
            i += 1;
            continue;
        }
        if (currentCharacter === '}') {
            const wasInsideBrace = insideBrace;
            insideBrace = false;
            if (wasInsideBrace && narrateTexts.braced) fixTrailingPunctuation();
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
            shouldIncludeCharacter = true;
        }

        if (shouldIncludeCharacter) {
            result += currentCharacter;
        }
        
        i += 1;
    }

    return result.replace(/\s+/g, ' ').trim();
}