// frontend_src/utilities/voiceTextExtractor.ts
import type { textType } from '../types';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

export function extractNarratableText(text: string, narrateTexts: Record<textType, boolean>): string {
    if (!text) return '';

    const escapeRegex = (stringToEscape: string) => stringToEscape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. Strip tool calls/results and in-flight think tags from audio
    const toolRegex = new RegExp(
        `(${escapeRegex(toolCallStartString)}[\\s\\S]*?(${escapeRegex(toolCallEndString)}|$)|` +
        `${escapeRegex(toolResultStartString)}[\\s\\S]*?(${escapeRegex(toolResultEndString)}|$)|` +
        `<think>[\\s\\S]*?(<\\/think>|$))`,
        'g'
    );
    let cleanText = text.replace(toolRegex, '');

    // 2. Strip bullet point markers at line starts (-, *, +, •) followed by spaces
    cleanText = cleanText.replace(/(?:^|\r?\n)[ \t]*[-*+•][ \t]+/g, '\n');

    let result = '';
    let i = 0;
    
    // Formatting state flags
    let insideItalic = false;
    let insideBold = false;
    let insideUnderline = false;
    let insideQuote = false;

    // Depth counters for nested enclosures to prevent underflow from rogue closers
    let parenthesisDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    const fixTrailingPunctuation = () => {
        result = result.replace(/([,!?])(\s*)$/, '.$2');
    };

    while (i < cleanText.length) {
        const currentCharacter = cleanText[i];
        const nextCharacter = cleanText[i + 1];
        const nextNextCharacter = cleanText[i + 2];
        const previousCharacter = cleanText[i - 1];

        // ─── 1. PARAGRAPH BREAK QUARANTINE ─────────────────────────────────────
        if (currentCharacter === '\n') {
            let lookAheadIdx = i + 1;
            while (
                lookAheadIdx < cleanText.length && 
                (cleanText[lookAheadIdx] === ' ' || cleanText[lookAheadIdx] === '\t' || cleanText[lookAheadIdx] === '\r')
            ) {
                lookAheadIdx++;
            }
            if (lookAheadIdx < cleanText.length && cleanText[lookAheadIdx] === '\n') {
                if (insideItalic && narrateTexts.italicized) fixTrailingPunctuation();
                if (insideBold && narrateTexts.bolded) fixTrailingPunctuation();
                if (insideUnderline && narrateTexts.underlined) fixTrailingPunctuation();
                if (insideQuote && narrateTexts.quoted) fixTrailingPunctuation();
                if (parenthesisDepth > 0 && narrateTexts.parenthesized) fixTrailingPunctuation();
                if (bracketDepth > 0 && narrateTexts.bracketed) fixTrailingPunctuation();
                if (braceDepth > 0 && narrateTexts.braced) fixTrailingPunctuation();

                insideItalic = false;
                insideBold = false;
                insideUnderline = false;
                insideQuote = false;
                parenthesisDepth = 0;
                bracketDepth = 0;
                braceDepth = 0;
            }
        }

        // ─── 2. BOLD MARKERS (** ONLY) ─────────────────────────────────────────
        if (currentCharacter === '*' && nextCharacter === '*') {
            const canOpen = !insideBold && nextNextCharacter !== undefined && !/\s/.test(nextNextCharacter);
            const canClose = insideBold && previousCharacter !== undefined && !/\s/.test(previousCharacter);

            if (canOpen || canClose) {
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
        }

        // ─── 3. ITALIC MARKERS (* ONLY) ────────────────────────────────────────
        if (currentCharacter === '*' && previousCharacter !== '*' && nextCharacter !== '*') {
            const canOpen = nextCharacter !== undefined && !/\s/.test(nextCharacter);
            const canClose = previousCharacter !== undefined && !/\s/.test(previousCharacter);

            if (insideItalic && canClose) {
                insideItalic = false;
                if (narrateTexts.italicized) fixTrailingPunctuation();
                i += 1;
                continue;
            } else if (!insideItalic && canOpen) {
                insideItalic = true;
                if (!narrateTexts.italicized) fixTrailingPunctuation();
                i += 1;
                continue;
            } else if (insideItalic && !canClose && canOpen) {
                insideItalic = true;
                i += 1;
                continue;
            }
        }

        // ─── 4. UNDERLINE MARKERS (_ ONLY) ─────────────────────────────────────
        if (currentCharacter === '_' && previousCharacter !== '_' && nextCharacter !== '_') {
            const isIntraWord = previousCharacter !== undefined && /\w/.test(previousCharacter) &&
                               nextCharacter !== undefined && /\w/.test(nextCharacter);

            if (!isIntraWord) {
                const canOpen = nextCharacter !== undefined && !/\s/.test(nextCharacter);
                const canClose = previousCharacter !== undefined && !/\s/.test(previousCharacter);

                if (insideUnderline && canClose) {
                    insideUnderline = false;
                    if (narrateTexts.underlined) fixTrailingPunctuation();
                    i += 1;
                    continue;
                } else if (!insideUnderline && canOpen) {
                    insideUnderline = true;
                    if (!narrateTexts.underlined) fixTrailingPunctuation();
                    i += 1;
                    continue;
                } else if (insideUnderline && !canClose && canOpen) {
                    insideUnderline = true;
                    i += 1;
                    continue;
                }
            }
        }

        // ─── 5. CURLY DOUBLE QUOTES (“ ”) ──────────────────────────────────────
        if (currentCharacter === '\u201C') { // “
            if (!insideQuote) {
                insideQuote = true;
                if (!narrateTexts.quoted) fixTrailingPunctuation();
            }
            i += 1;
            continue;
        }

        if (currentCharacter === '\u201D') { // ”
            if (insideQuote) {
                insideQuote = false;
                if (narrateTexts.quoted) fixTrailingPunctuation();
            }
            i += 1;
            continue;
        }

        // ─── 6. STRAIGHT DOUBLE QUOTES (") ─────────────────────────────────────
        if (currentCharacter === '"') {
            const canOpen = nextCharacter !== undefined && !/\s/.test(nextCharacter);
            const canClose = previousCharacter !== undefined && !/\s/.test(previousCharacter);

            if (insideQuote && canClose) {
                insideQuote = false;
                if (narrateTexts.quoted) fixTrailingPunctuation();
                i += 1;
                continue;
            } else if (!insideQuote && canOpen) {
                insideQuote = true;
                if (!narrateTexts.quoted) fixTrailingPunctuation();
                i += 1;
                continue;
            } else if (insideQuote && !canClose && canOpen) {
                insideQuote = true;
                i += 1;
                continue;
            } else {
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
        }

        // ─── 7. PARENTHESES () ─────────────────────────────────────────────────
        if (currentCharacter === '(') {
            if (parenthesisDepth === 0 && !narrateTexts.parenthesized) fixTrailingPunctuation();
            parenthesisDepth++;
            i += 1;
            continue;
        }
        if (currentCharacter === ')') {
            if (parenthesisDepth > 0) {
                parenthesisDepth--;
                if (parenthesisDepth === 0 && narrateTexts.parenthesized) fixTrailingPunctuation();
            }
            i += 1;
            continue;
        }

        // ─── 8. BRACKETS [] ────────────────────────────────────────────────────
        if (currentCharacter === '[') {
            if (bracketDepth === 0 && !narrateTexts.bracketed) fixTrailingPunctuation();
            bracketDepth++;
            i += 1;
            continue;
        }
        if (currentCharacter === ']') {
            if (bracketDepth > 0) {
                bracketDepth--;
                if (bracketDepth === 0 && narrateTexts.bracketed) fixTrailingPunctuation();
            }
            i += 1;
            continue;
        }

        // ─── 9. BRACES {} ──────────────────────────────────────────────────────
        if (currentCharacter === '{') {
            if (braceDepth === 0 && !narrateTexts.braced) fixTrailingPunctuation();
            braceDepth++;
            i += 1;
            continue;
        }
        if (currentCharacter === '}') {
            if (braceDepth > 0) {
                braceDepth--;
                if (braceDepth === 0 && narrateTexts.braced) fixTrailingPunctuation();
            }
            i += 1;
            continue;
        }

        // ─── 10. TEXT INCLUSION EVALUATION ─────────────────────────────────────
        const isInsideParenthesis = parenthesisDepth > 0;
        const isInsideBracket = bracketDepth > 0;
        const isInsideBrace = braceDepth > 0;

        let shouldIncludeCharacter = false;
        
        if (insideItalic && narrateTexts.italicized) {
            shouldIncludeCharacter = true;
        } else if (insideBold && narrateTexts.bolded) {
            shouldIncludeCharacter = true;
        } else if (insideUnderline && narrateTexts.underlined) {
            shouldIncludeCharacter = true;
        } else if (insideQuote && narrateTexts.quoted) {
            shouldIncludeCharacter = true;
        } else if (isInsideParenthesis && narrateTexts.parenthesized) {
            shouldIncludeCharacter = true;
        } else if (isInsideBracket && narrateTexts.bracketed) {
            shouldIncludeCharacter = true;
        } else if (isInsideBrace && narrateTexts.braced) {
            shouldIncludeCharacter = true;
        } else if (
            !insideItalic && 
            !insideBold && 
            !insideUnderline && 
            !insideQuote && 
            !isInsideParenthesis && 
            !isInsideBracket && 
            !isInsideBrace && 
            narrateTexts.normal
        ) {
            shouldIncludeCharacter = true;
        }

        if (shouldIncludeCharacter) {
            result += currentCharacter;
        }
        
        i += 1;
    }

    return result.replace(/\s+/g, ' ').trim();
}