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
    cleanText = cleanText.replace(/\r\n?/g, '\n');
    cleanText = cleanText.replace(/(?:^|\n)[ \t]*[-*+•][ \t]+/g, '\n');
    // Prevent incomplete trailing line-start prefixes (# or >) from leaking into TTS mid-stream
    cleanText = cleanText.replace(/(?:^|\n)[ \t]*(?:#{1,6}|>(?:[ \t]*>)*)[ \t]*$/, '');

    const segments: NarratableSegment[] = [];
    let currentSegmentText = '';
    let i = 0;
    
    let insideItalic = false;
    let insideBold = false;
    let insideStrikethrough = false;
    let insideUnderline = false;
    let insideQuote = false;
    let insideBlockQuote = false;
    let insideHeader = false;

    let parenthesisDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    // Stack to track the chronological opening of formats.
    // Index 0 is always the "top level" (outermost) format.
    const activeFormats: textType[] = [];

    const pushFormat = (type: textType) => {
        if (!activeFormats.includes(type)) {
            activeFormats.push(type);
        }
    };

    const popFormat = (type: textType) => {
        const idx = activeFormats.indexOf(type);
        if (idx !== -1) {
            activeFormats.splice(idx, 1);
        }
    };

    const resetInlineFormats = () => {
        insideItalic = false;
        insideBold = false;
        insideStrikethrough = false;
        insideUnderline = false;
        insideQuote = false;
        parenthesisDepth = 0;
        bracketDepth = 0;
        braceDepth = 0;
        activeFormats.length = 0;
        if (insideBlockQuote) activeFormats.push('block_quote');
        if (insideHeader) activeFormats.push('header');
    };

    const getCurrentType = (): textType => {
        if (activeFormats.length > 0) {
            return activeFormats[0]; // Locks strictly to the outermost format
        }
        return 'normal';
    };

    let lastType = getCurrentType();

    const fixTrailingPunctuation = () => {
        currentSegmentText = currentSegmentText.replace(/([,!?])(\s*)$/, '.$2');
    };

    const pushSegment = () => {
        const trimmed = currentSegmentText.replace(/\s+/g, ' ');
        if (trimmed.trim().length > 0) {
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
            else if (lastType === 'block_quote' && narrateTexts.block_quote) fixTrailingPunctuation();
            else if (lastType === 'header' && narrateTexts.header) fixTrailingPunctuation();
            
            pushSegment();
            lastType = newType;
        }
    };

    while (i < cleanText.length) {
        const isAtLineStart = i === 0 || cleanText[i - 1] === '\n';

        if (isAtLineStart) {
            const restOfText = cleanText.slice(i);
            const blockQuotePrefixMatch = restOfText.match(/^[ \t]*>(?:[ \t]*>)*(?:[ \t]+|(?=\n|$))/);

            if (blockQuotePrefixMatch) {
                if (!insideBlockQuote) {
                    insideBlockQuote = true;
                    pushFormat('block_quote');
                    checkTypeChange();
                }
                i += blockQuotePrefixMatch[0].length;

                const innerBulletMatch = cleanText.slice(i).match(/^[-*+•][ \t]+/);
                if (innerBulletMatch) {
                    i += innerBulletMatch[0].length;
                }

                const innerHeaderMatch = cleanText.slice(i).match(/^#{1,6}[ \t]+(?=[^\n\t ])/);
                if (innerHeaderMatch) {
                    insideHeader = true;
                    pushFormat('header');
                    checkTypeChange();
                    i += innerHeaderMatch[0].length;
                }
                continue;
            } else {
                if (insideBlockQuote) {
                    insideBlockQuote = false;
                    popFormat('block_quote');
                    resetInlineFormats();
                    checkTypeChange();
                }

                const headerPrefixMatch = restOfText.match(/^[ \t]*#{1,6}[ \t]+(?=[^\n\t ])/);
                if (headerPrefixMatch) {
                    insideHeader = true;
                    pushFormat('header');
                    checkTypeChange();
                    i += headerPrefixMatch[0].length;
                    continue;
                }
            }
        }

        if (insideHeader) {
            const trailingHashMatch = cleanText.slice(i).match(/^[ \t]+#+[ \t]*(?=\n)/);
            if (trailingHashMatch) {
                i += trailingHashMatch[0].length;
                continue;
            }
        }

        const currentCharacter = cleanText[i];
        const nextCharacter = cleanText[i + 1];
        const nextNextCharacter = cleanText[i + 2];
        const previousCharacter = cleanText[i - 1];

        if (currentCharacter === '\n') {
            if (insideHeader) {
                insideHeader = false;
                popFormat('header');
                checkTypeChange();
                if (!insideBlockQuote) {
                    i += 1;
                    continue;
                }
            }

            if (insideBlockQuote) {
                const afterNewline = cleanText.slice(i + 1);
                const nextIsBlockQuote = /^[ \t]*>(?:[ \t]*>)*(?:[ \t]+|\n|$)/.test(afterNewline);
                if (!nextIsBlockQuote) {
                    insideBlockQuote = false;
                    popFormat('block_quote');
                    resetInlineFormats();
                    checkTypeChange();
                    i += 1;
                    continue;
                }
                // Reset inline states if the next line is a blank ">" continuation line
                if (/^[ \t]*>(?:[ \t]*>)*[ \t]*(?:\n|$)/.test(afterNewline)) {
                    resetInlineFormats();
                }
            }

            let lookAheadIdx = i + 1;
            while (
                lookAheadIdx < cleanText.length && 
                (cleanText[lookAheadIdx] === ' ' || cleanText[lookAheadIdx] === '\t' || cleanText[lookAheadIdx] === '\r')
            ) {
                lookAheadIdx++;
            }
            if (lookAheadIdx < cleanText.length && cleanText[lookAheadIdx] === '\n') {
                resetInlineFormats();
                checkTypeChange();
            }
        }

        if (currentCharacter === '*' && nextCharacter === '*') {
            const canOpen = !insideBold && nextNextCharacter !== undefined && !/\s/.test(nextNextCharacter);
            const canClose = insideBold && previousCharacter !== undefined && !/\s/.test(previousCharacter);

            if (canOpen) {
                insideBold = true;
                pushFormat('bold');
                checkTypeChange();
                i += 2;
                continue;
            }
            if (canClose) {
                insideBold = false;
                popFormat('bold');
                checkTypeChange();
                i += 2;
                continue;
            }
        }

        if (currentCharacter === '~' && nextCharacter === '~') {
            const canOpen = !insideStrikethrough && nextNextCharacter !== undefined && !/\s/.test(nextNextCharacter);
            const canClose = insideStrikethrough && previousCharacter !== undefined && !/\s/.test(previousCharacter);

            if (canOpen) {
                insideStrikethrough = true;
                pushFormat('strikethrough');
                checkTypeChange();
                i += 2;
                continue;
            }
            if (canClose) {
                insideStrikethrough = false;
                popFormat('strikethrough');
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
                popFormat('italic');
                checkTypeChange();
                i += 1;
                continue;
            } else if (!insideItalic && canOpen) {
                insideItalic = true;
                pushFormat('italic');
                checkTypeChange();
                i += 1;
                continue;
            } else if (insideItalic && !canClose && canOpen) {
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
                    popFormat('underline');
                    checkTypeChange();
                    i += 1;
                    continue;
                } else if (!insideUnderline && canOpen) {
                    insideUnderline = true;
                    pushFormat('underline');
                    checkTypeChange();
                    i += 1;
                    continue;
                } else if (insideUnderline && !canClose && canOpen) {
                    checkTypeChange();
                    i += 1;
                    continue;
                }
            }
        }

        if (currentCharacter === '\u201C') {
            if (!insideQuote) {
                insideQuote = true;
                pushFormat('quote');
                checkTypeChange();
            }
            i += 1;
            continue;
        }

        if (currentCharacter === '\u201D') {
            if (insideQuote) {
                insideQuote = false;
                popFormat('quote');
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
                popFormat('quote');
                checkTypeChange();
                i += 1;
                continue;
            }
            if (!insideQuote && canOpen) {
                insideQuote = true;
                pushFormat('quote');
                checkTypeChange();
                i += 1;
                continue;
            } 
            if (insideQuote && !canClose && canOpen) {
                checkTypeChange();
                i += 1;
                continue;
            }
            insideQuote = !insideQuote;
            if (insideQuote) pushFormat('quote');
            else popFormat('quote');
            checkTypeChange();
            i += 1;
            continue;
        }

        if (currentCharacter === '(') {
            if (parenthesisDepth === 0) pushFormat('parenthesis');
            parenthesisDepth++;
            checkTypeChange();
            i += 1;
            continue;
        }
        if (currentCharacter === ')') {
            if (parenthesisDepth > 0) {
                parenthesisDepth--;
                if (parenthesisDepth === 0) popFormat('parenthesis');
                checkTypeChange();
            }
            i += 1;
            continue;
        }

        if (currentCharacter === '[') {
            if (bracketDepth === 0) pushFormat('bracket');
            bracketDepth++;
            checkTypeChange();
            i += 1;
            continue;
        }
        if (currentCharacter === ']') {
            if (bracketDepth > 0) {
                bracketDepth--;
                if (bracketDepth === 0) popFormat('bracket');
                checkTypeChange();
            }
            i += 1;
            continue;
        }

        if (currentCharacter === '{') {
            if (braceDepth === 0) pushFormat('brace');
            braceDepth++;
            checkTypeChange();
            i += 1;
            continue;
        }
        if (currentCharacter === '}') {
            if (braceDepth > 0) {
                braceDepth--;
                if (braceDepth === 0) popFormat('brace');
                checkTypeChange();
            }
            i += 1;
            continue;
        }

        const currentType = getCurrentType();
        let shouldIncludeCharacter = false;
        
        if (currentType === 'italic' && narrateTexts.italic) shouldIncludeCharacter = true;
        else if (currentType === 'bold' && narrateTexts.bold) shouldIncludeCharacter = true;
        else if (currentType === 'strikethrough' && narrateTexts.strikethrough) shouldIncludeCharacter = true;
        else if (currentType === 'underline' && narrateTexts.underline) shouldIncludeCharacter = true;
        else if (currentType === 'quote' && narrateTexts.quote) shouldIncludeCharacter = true;
        else if (currentType === 'parenthesis' && narrateTexts.parenthesis) shouldIncludeCharacter = true;
        else if (currentType === 'bracket' && narrateTexts.bracket) shouldIncludeCharacter = true;
        else if (currentType === 'brace' && narrateTexts.brace) shouldIncludeCharacter = true;
        else if (currentType === 'block_quote' && narrateTexts.block_quote) shouldIncludeCharacter = true;
        else if (currentType === 'header' && narrateTexts.header) shouldIncludeCharacter = true;
        else if (currentType === 'normal' && narrateTexts.normal) shouldIncludeCharacter = true;

        if (shouldIncludeCharacter) {
            currentSegmentText += currentCharacter;
        }
        
        i += 1;
    }

    pushSegment();
    return segments;
}