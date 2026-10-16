// src/frontend_src/utilities/voiceTextExtractor.ts
import type { textType } from '../types';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

export interface NarratableSegment {
    text: string;
    textType: textType;
}

export function extractNarratableText(
    text: string | undefined, 
    narrateTexts: Record<textType, boolean> | undefined
): NarratableSegment[] {
    if (!text || !narrateTexts) return [];

    const escapeRegex = (stringToEscape: string) => stringToEscape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const toolRegex = new RegExp(
        `(${escapeRegex(toolCallStartString)}[\\s\\S]*?(${escapeRegex(toolCallEndString)}|$)|` +
        `${escapeRegex(toolResultStartString)}[\\s\\S]*?(${escapeRegex(toolResultEndString)}|$)|` +
        `<think>[\\s\\S]*?(<\\/think>|$))`,
        'g'
    );
    let cleanText = text.replace(toolRegex, '');
    cleanText = cleanText.replace(/(?:^|\r?\n)[ \t]*[-*+•][ \t]+/g, '\n');

    const segments: NarratableSegment[] = [];
    let currentSegmentText = '';
    let i = 0;
    
    let insideItalic = false;
    let insideBold = false;
    let insideStrikethrough = false;
    let insideUnderline = false;
    let insideQuote = false;

    let parenthesisDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    const getCurrentType = (): textType => {
        if (insideBold) return 'bold';
        if (insideItalic) return 'italic';
        if (insideStrikethrough) return 'strikethrough';
        if (insideUnderline) return 'underline';
        if (insideQuote) return 'quote';
        if (parenthesisDepth > 0) return 'parenthesis';
        if (bracketDepth > 0) return 'bracket';
        if (braceDepth > 0) return 'brace';
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
            if (lastType === 'italic' && narrateTexts.italic) fixTrailingPunctuation();
            else if (lastType === 'bold' && narrateTexts.bold) fixTrailingPunctuation();
            else if (lastType === 'strikethrough' && narrateTexts.strikethrough) fixTrailingPunctuation();
            else if (lastType === 'underline' && narrateTexts.underline) fixTrailingPunctuation();
            else if (lastType === 'quote' && narrateTexts.quote) fixTrailingPunctuation();
            else if (lastType === 'parenthesis' && narrateTexts.parenthesis) fixTrailingPunctuation();
            else if (lastType === 'bracket' && narrateTexts.bracket) fixTrailingPunctuation();
            else if (lastType === 'brace' && narrateTexts.brace) fixTrailingPunctuation();
            
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
                insideStrikethrough = false;
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

        if (currentCharacter === '~' && nextCharacter === '~') {
            const canOpen = !insideStrikethrough && nextNextCharacter !== undefined && !/\s/.test(nextNextCharacter);
            const canClose = insideStrikethrough && previousCharacter !== undefined && !/\s/.test(previousCharacter);

            if (canOpen || canClose) {
                insideStrikethrough = !insideStrikethrough;
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
            }
            if (!insideQuote && canOpen) {
                insideQuote = true;
                checkTypeChange();
                i += 1;
                continue;
            } 
            if (insideQuote && !canClose && canOpen) {
                insideQuote = true;
                checkTypeChange();
                i += 1;
                continue;
            }
            insideQuote = !insideQuote;
            checkTypeChange();
            i += 1;
            continue;
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
        
        if (insideItalic && narrateTexts.italic) shouldIncludeCharacter = true;
        else if (insideBold && narrateTexts.bold) shouldIncludeCharacter = true;
        else if (insideStrikethrough && narrateTexts.strikethrough) shouldIncludeCharacter = true;
        else if (insideUnderline && narrateTexts.underline) shouldIncludeCharacter = true;
        else if (insideQuote && narrateTexts.quote) shouldIncludeCharacter = true;
        else if (isInsideParenthesis && narrateTexts.parenthesis) shouldIncludeCharacter = true;
        else if (isInsideBracket && narrateTexts.bracket) shouldIncludeCharacter = true;
        else if (isInsideBrace && narrateTexts.brace) shouldIncludeCharacter = true;
        else if (
            !insideItalic && !insideBold && !insideStrikethrough && !insideUnderline && !insideQuote && 
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