// frontend_src/utilities/voiceTextExtractor.ts
import type { textType } from '../types';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

export function extractNarratableText(text: string, narrateTexts: Record<textType, boolean>): string {
    if (!text) return '';

    const escapeRegex = (stringToEscape: string) => stringToEscape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // ✅ Match completed tool calls/results AND in-flight unclosed tool calls/results, plus think tags
    const toolRegex = new RegExp(
        `(${escapeRegex(toolCallStartString)}[\\s\\S]*?(${escapeRegex(toolCallEndString)}|$)|` +
        `${escapeRegex(toolResultStartString)}[\\s\\S]*?(${escapeRegex(toolResultEndString)}|$)|` +
        `<think>[\\s\\S]*?(<\\/think>|$))`,
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

        // ✅ Check for straight and curly double quote markers, plus dialogue brackets
        const isQuoteMarker = (
            currentCharacter === '"' || 
            currentCharacter === '\u201C' || // “
            currentCharacter === '\u201D' || // ”
            currentCharacter === '「' || 
            currentCharacter === '」'
        );

        if (isQuoteMarker) {
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

        // Determine whether this character should be included
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