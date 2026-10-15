// src/frontend_src/utilities/voiceTextExtractor.ts
import type { textType } from '../types';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

export interface NarratableSegment {
    text: string;
    textType: textType;
}

export function extractNarratableText(
    text: string, 
    narrateTexts: Record<textType, boolean>
): NarratableSegment[] {
    if (!text) return [];

    const escapeRegex = (stringToEscape: string) => stringToEscape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const toolRegex = new RegExp(
        `(${escapeRegex(toolCallStartString)}[\\s\\S]*?(${escapeRegex(toolCallEndString)}|$)|` +
        `${escapeRegex(toolResultStartString)}[\\s\\S]*?(${escapeRegex(toolResultEndString)}|$)|` +
        `<think>[\\s\\S]*?(<\\/think>|$))`,
        'g'
    );
    let cleanText = text.replace(toolRegex, '');
    cleanText = cleanText.replace(/(?:^|\r?\n)[ \t]*[-*+•][ \t]+/g, '\n');

    let segments: NarratableSegment[] = [];
    let currentSegmentText = '';
    let i = 0;
    
    let insideItalic = false;
    let insideBold = false;
    let insideUnderline = false;
    let insideQuote = false;

    let parenthesisDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    const getCurrentType = (): textType => {
        if (insideBold) return 'bolded';
        if (insideItalic) return 'italicized';
        if (insideUnderline) return 'underlined';
        if (insideQuote) return 'quoted';
        if (parenthesisDepth > 0) return 'parenthesized';
        if (bracketDepth > 0) return 'bracketed';
        if (braceDepth > 0) return 'braced';
        return 'normal';
    };

    let lastType = getCurrentType();

    const fixTrailingPunctuation = () => {
        currentSegmentText = currentSegmentText.replace(/([,!?])(\s*)$/, '.$2');
    };

    const pushSegment = () => {
        const trimmed = currentSegmentText.replace(/\s+/g, ' ').trim();
        if (trimmed.length > 0) {
            segments.push({ text: trimmed, textType: lastType });
        }
        currentSegmentText = '';
    };

    const checkTypeChange = () => {
        const newType = getCurrentType();
        if (newType !== lastType) {
            if (lastType === 'italicized' && narrateTexts.italicized) fixTrailingPunctuation();
            else if (lastType === 'bolded' && narrateTexts.bolded) fixTrailingPunctuation();
            else if (lastType === 'underlined' && narrateTexts.underlined) fixTrailingPunctuation();
            else if (lastType === 'quoted' && narrateTexts.quoted) fixTrailingPunctuation();
            else if (lastType === 'parenthesized' && narrateTexts.parenthesized) fixTrailingPunctuation();
            else if (lastType === 'bracketed' && narrateTexts.bracketed) fixTrailingPunctuation();
            else if (lastType === 'braced' && narrateTexts.braced) fixTrailingPunctuation();
            
            pushSegment();
            lastType = newType;
        }
    };

    while (i < cleanText.length) {
        const currentCharacter = cleanText[i];
        const nextCharacter = cleanText[i + 1];
        const nextNextCharacter = cleanText[i + 2];
        const previousCharacter = cleanText[i - 1];

        if (currentCharacter === '\n') {
            let lookAheadIdx = i + 1;
            while (
                lookAheadIdx < cleanText.length && 
                (cleanText[lookAheadIdx] === ' ' || cleanText[lookAheadIdx] === '\t' || cleanText[lookAheadIdx] === '\r')
            ) {
                lookAheadIdx++;
            }
            if (lookAheadIdx < cleanText.length && cleanText[lookAheadIdx] === '\n') {
                insideItalic = false;
                insideBold = false;
                insideUnderline = false;
                insideQuote = false;
                parenthesisDepth = 0;
                bracketDepth = 0;
                braceDepth = 0;
                checkTypeChange();
            }
        }

        if (currentCharacter === '*' && nextCharacter === '*') {
            const canOpen = !insideBold && nextNextCharacter !== undefined && !/\s/.test(nextNextCharacter);
            const canClose = insideBold && previousCharacter !== undefined && !/\s/.test(previousCharacter);

            if (canOpen || canClose) {
                insideBold = !insideBold;
                checkTypeChange();
                i += 2;
                continue;
            }
        }

        if (currentCharacter === '*' && previousCharacter !== '*' && nextCharacter !== '*') {
            const canOpen = nextCharacter !== undefined && !/\s/.test(nextCharacter);
            const canClose = previousCharacter !== undefined && !/\s/.test(previousCharacter);

            if (insideItalic && canClose) {
                insideItalic = false;
                checkTypeChange();
                i += 1;
                continue;
            } else if (!insideItalic && canOpen) {
                insideItalic = true;
                checkTypeChange();
                i += 1;
                continue;
            } else if (insideItalic && !canClose && canOpen) {
                insideItalic = true;
                checkTypeChange();
                i += 1;
                continue;
            }
        }

        if (currentCharacter === '_' && previousCharacter !== '_' && nextCharacter !== '_') {
            const isIntraWord = previousCharacter !== undefined && /\w/.test(previousCharacter) &&
                               nextCharacter !== undefined && /\w/.test(nextCharacter);

            if (!isIntraWord) {
                const canOpen = nextCharacter !== undefined && !/\s/.test(nextCharacter);
                const canClose = previousCharacter !== undefined && !/\s/.test(previousCharacter);

                if (insideUnderline && canClose) {
                    insideUnderline = false;
                    checkTypeChange();
                    i += 1;
                    continue;
                } else if (!insideUnderline && canOpen) {
                    insideUnderline = true;
                    checkTypeChange();
                    i += 1;
                    continue;
                } else if (insideUnderline && !canClose && canOpen) {
                    insideUnderline = true;
                    checkTypeChange();
                    i += 1;
                    continue;
                }
            }
        }

        if (currentCharacter === '\u201C') {
            if (!insideQuote) {
                insideQuote = true;
                checkTypeChange();
            }
            i += 1;
            continue;
        }

        if (currentCharacter === '\u201D') {
            if (insideQuote) {
                insideQuote = false;
                checkTypeChange();
            }
            i += 1;
            continue;
        }

        if (currentCharacter === '"') {
            const canOpen = nextCharacter !== undefined && !/\s/.test(nextCharacter);
            const canClose = previousCharacter !== undefined && !/\s/.test(previousCharacter);

            if (insideQuote && canClose) {
                insideQuote = false;
                checkTypeChange();
                i += 1;
                continue;
            } else if (!insideQuote && canOpen) {
                insideQuote = true;
                checkTypeChange();
                i += 1;
                continue;
            } else if (insideQuote && !canClose && canOpen) {
                insideQuote = true;
                checkTypeChange();
                i += 1;
                continue;
            } else {
                insideQuote = !insideQuote;
                checkTypeChange();
                i += 1;
                continue;
            }
        }

        if (currentCharacter === '(') {
            parenthesisDepth++;
            checkTypeChange();
            i += 1;
            continue;
        }
        if (currentCharacter === ')') {
            if (parenthesisDepth > 0) {
                parenthesisDepth--;
                checkTypeChange();
            }
            i += 1;
            continue;
        }

        if (currentCharacter === '[') {
            bracketDepth++;
            checkTypeChange();
            i += 1;
            continue;
        }
        if (currentCharacter === ']') {
            if (bracketDepth > 0) {
                bracketDepth--;
                checkTypeChange();
            }
            i += 1;
            continue;
        }

        if (currentCharacter === '{') {
            braceDepth++;
            checkTypeChange();
            i += 1;
            continue;
        }
        if (currentCharacter === '}') {
            if (braceDepth > 0) {
                braceDepth--;
                checkTypeChange();
            }
            i += 1;
            continue;
        }

        const isInsideParenthesis = parenthesisDepth > 0;
        const isInsideBracket = bracketDepth > 0;
        const isInsideBrace = braceDepth > 0;

        let shouldIncludeCharacter = false;
        
        if (insideItalic && narrateTexts.italicized) shouldIncludeCharacter = true;
        else if (insideBold && narrateTexts.bolded) shouldIncludeCharacter = true;
        else if (insideUnderline && narrateTexts.underlined) shouldIncludeCharacter = true;
        else if (insideQuote && narrateTexts.quoted) shouldIncludeCharacter = true;
        else if (isInsideParenthesis && narrateTexts.parenthesized) shouldIncludeCharacter = true;
        else if (isInsideBracket && narrateTexts.bracketed) shouldIncludeCharacter = true;
        else if (isInsideBrace && narrateTexts.braced) shouldIncludeCharacter = true;
        else if (
            !insideItalic && !insideBold && !insideUnderline && !insideQuote && 
            !isInsideParenthesis && !isInsideBracket && !isInsideBrace && 
            narrateTexts.normal
        ) shouldIncludeCharacter = true;

        if (shouldIncludeCharacter) {
            currentSegmentText += currentCharacter;
        }
        
        i += 1;
    }

    pushSegment();
    return segments;
}