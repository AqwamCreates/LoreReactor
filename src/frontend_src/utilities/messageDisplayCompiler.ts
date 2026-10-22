// src/frontend_src/utilities/messageDisplayCompiler.ts
import type { Character, InteractionData, TextMessage, ToolExecutionResult, toolUsageDisplayMode, toolUsageDisplayPlacementMode } from '../types';
import {
    toolCallStartString,
    toolCallEndString,
    toolResultStartString,
    toolResultEndString,
} from '../dictionaries/stringList';
import { convertIdsToDisplayNames } from './interactionDataLogic';
import { formatToolDisplay, getFallbackToolResult } from '../services/ToolExecutor';

type PlacementMode = toolUsageDisplayPlacementMode;

interface ExtractedTool {
    display: string;
    originalIndex: number; 
}

/**
 * Calculates the exact string index to inject a tool based on the placement mode.
 * ✅ STRICT RULE: If the tool is on its own line, it counts as its own paragraph.
 * It will NOT be moved into adjacent paragraphs or break markdown formatting.
 */
function getInsertionIndex(cleanText: string, mappedIndex: number, mode: PlacementMode): number {
    if (mode === 'top') return 0;
    if (mode === 'bottom') return cleanText.length;
    if (mode === 'inline') return mappedIndex;

    const beforeSlice = cleanText.slice(0, mappedIndex);
    const afterSlice = cleanText.slice(mappedIndex);

    // ✅ Detect if the tool is isolated by newlines (i.e., on its own line)
    const isOnOwnLine = 
        (beforeSlice.length === 0 || /\n\s*$/.test(beforeSlice)) && 
        (afterSlice.length === 0 || /^\s*\n/.test(afterSlice));

    if (isOnOwnLine) {
        // It stays exactly where it is, preserving the \n\n[tool]\n\n structure.
        return mappedIndex;
    }

    // Find the boundaries of the CURRENT paragraph (separated by \n\n)
    const paraStartSearch = cleanText.lastIndexOf('\n\n', mappedIndex - 1);
    const startIdx = paraStartSearch === -1 ? 0 : paraStartSearch + 2;
    
    const paraEndSearch = cleanText.indexOf('\n\n', mappedIndex);
    const endIdx = paraEndSearch === -1 ? cleanText.length : paraEndSearch;

    const currentParagraph = cleanText.slice(startIdx, endIdx);
    const isStandaloneInParagraph = currentParagraph.length === 0;

    // Paragraph-level placements
    if (mode === 'after paragraph') return endIdx;
    if (mode === 'before paragraph') return startIdx;

    // If the tool is completely isolated in its paragraph, fallback to paragraph edges
    if (isStandaloneInParagraph) {
        return mode === 'after sentence' ? endIdx : startIdx;
    }

    // Sentence-level placements (strictly bounded to the current paragraph)
    if (mode === 'after sentence') {
        const sliceBefore = cleanText.slice(startIdx, mappedIndex);
        const lastPunct = Math.max(
            sliceBefore.lastIndexOf('.'),
            sliceBefore.lastIndexOf('!'),
            sliceBefore.lastIndexOf('?')
        );
        if (lastPunct !== -1) {
            let idx = startIdx + lastPunct + 1;
            // Skip over whitespace and closing markdown tags (*, _, ~, ")
            while (idx < mappedIndex && /[\s*_~"]/.test(cleanText[idx])) {
                idx++;
            }
            return idx;
        }
        return startIdx; 
    }

    if (mode === 'before sentence') {
        const sliceAfter = cleanText.slice(mappedIndex, endIdx);
        const match = sliceAfter.match(/[.!?](?:\s|$)/);
        if (match) {
            let idx = mappedIndex + (match.index ?? 0) + 1;
            while (idx < endIdx && /[\s*_~"]/.test(cleanText[idx])) {
                idx++;
            }
            return idx;
        }
        return endIdx; 
    }

    return mappedIndex;
}

/**
 * Centralized compiler: Accepts either a HistoryMessage object directly OR a raw string.
 * When compiling raw strings (such as during streaming), optional character and
 * toolExecutionResults parameters ensure proper name detokenization and badge formatting.
 */
export function compileMessageDisplayText(
    target: TextMessage | string | null | undefined,
    displayMode: toolUsageDisplayMode = 'simple',
    placementMode: PlacementMode = 'inline',
    participants: Character[] = [],
    character?: Character,
    toolExecutionResults?: ToolExecutionResult[]
): string {
    if (!target) return '';

    if (typeof target === 'string') {
        return compileRawString(target, displayMode, placementMode, participants, character, toolExecutionResults);
    }

    const char = target.character ?? character;
    const rawText = ('textContent' in target ? target.textContent : '');
    const execResults = ('toolExecutionResults' in target ? target.toolExecutionResults : undefined) ?? toolExecutionResults;

    return compileRawString(rawText, displayMode, placementMode, participants, char, execResults);
}

function compileRawString(
    rawText: string,
    mode: toolUsageDisplayMode,
    placementMode: PlacementMode,
    participants: Character[],
    character?: Character,
    toolExecutionResults?: ToolExecutionResult[]
): string {
    if (!rawText) return '';

    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const resStartEsc = escapeRegex(toolResultStartString);
    const resEndEsc = escapeRegex(toolResultEndString);
    const callStartEsc = escapeRegex(toolCallStartString);
    const callEndEsc = escapeRegex(toolCallEndString);

    // 1. Strip observation results completely
    const resultRegex = new RegExp(`${resStartEsc}[\\s\\S]*?(${resEndEsc}|$) *`, 'g');
    let processed = rawText.replace(resultRegex, '');

    // 2. Strip orphan closing delimiters
    const orphanEndRegex = new RegExp(`^ *(${resEndEsc}|${callEndEsc}) *`, 'g');
    processed = processed.replace(orphanEndRegex, '');

    // 3. Build resultMap for executed tools
    const resultMap = new Map<string, ToolExecutionResult>();
    if (toolExecutionResults) {
        for (const res of toolExecutionResults) {
            resultMap.set(res.rawMatch, res);
        }
    }

    // 4. Extract and Strip tool calls (non-greedy to preserve individual calls)
    const toolRegex = new RegExp(`${callStartEsc}([\\s\\S]*?)${callEndEsc}`, 'g');
    const extractedTools: ExtractedTool[] = [];
    let cleanText = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = toolRegex.exec(processed)) !== null) {
        const rawMatch = match[0];
        const innerString = match[1];
        const startIndex = match.index;

        const stored = resultMap.get(rawMatch);
        let display;
        if (stored) {
            display = formatToolDisplay({ ...stored }, rawMatch, mode);
        } else {
            display = formatToolDisplay(getFallbackToolResult(innerString), rawMatch, mode);
        }

        // 🛠️ FIX: If the tool display is empty (e.g. tool disabled / mode 'none') 
        // and it is on its own line, consume the surrounding newlines to prevent ghost paragraphs.
        if (!display) {
            const textBefore = processed.slice(lastIndex, startIndex);
            const textAfter = processed.slice(startIndex + rawMatch.length);

            // Check if this tool call is isolated by line breaks
            const leadingNewlineMatch = textBefore.match(/(\r?\n[ \t]*){1,}$/);
            const trailingNewlineMatch = textAfter.match(/^([ \t]*\r?\n){1,}/);

            if (leadingNewlineMatch && trailingNewlineMatch) {
                // Consume the leading whitespace/newlines up to the previous paragraph, and skip past the trailing newline
                const trimLength = leadingNewlineMatch[0].length;
                if (cleanText.endsWith(leadingNewlineMatch[0]) || cleanText.endsWith('\n')) {
                    cleanText = cleanText.slice(0, cleanText.length - trimLength);
                } else {
                    cleanText += textBefore;
                }
                lastIndex = startIndex + rawMatch.length + trailingNewlineMatch[0].length;
                continue;
            }
        }

        cleanText += processed.slice(lastIndex, startIndex);

        if (display) {
            extractedTools.push({
                display,
                originalIndex: cleanText.length 
            });
        }

        lastIndex = startIndex + rawMatch.length;
    }
    cleanText += processed.slice(lastIndex);

    // 5. Suppress unclosed tool calls at tail of stream
    const unclosedCallRegex = new RegExp(`${callStartEsc}[\\s\\S]*$`, 'g');
    cleanText = cleanText.replace(unclosedCallRegex, '');

    // ✅ Detect whether actual paragraph text (non-whitespace characters) exists
    const hasParagraphText = /\S/.test(cleanText);

    let finalText = cleanText;

    // ── CASE 1: NO PARAGRAPH TEXT ──────────────────────────────────────
    // If there is no dialogue text, the output is purely the tool icon(s).
    // Zero newlines injected; no ghost lines above or below.
    if (!hasParagraphText) {
        extractedTools.sort((a, b) => a.originalIndex - b.originalIndex);
        finalText = extractedTools.map(t => t.display).filter(Boolean).join(' ');
    }
    // ── CASE 2: PARAGRAPH TEXT DETECTED ────────────────────────────────
    else if (placementMode === 'top' || placementMode === 'bottom') {
        extractedTools.sort((a, b) => a.originalIndex - b.originalIndex);
        const toolDisplays = extractedTools.map(t => t.display).filter(Boolean);
        
        if (toolDisplays.length > 0) {
            const joinedTools = toolDisplays.join(' ');
            
            if (placementMode === 'top') {
                // Only append a newline before the paragraph text
                const separator = finalText.startsWith('\n\n') ? '' : finalText.startsWith('\n') ? '\n' : '\n\n';
                finalText = joinedTools + separator + finalText;
            } else {
                // Paragraph text above tools: separate before joinedTools
                const separator = finalText.endsWith('\n\n') ? '' : finalText.endsWith('\n') ? '\n' : '\n\n';
                finalText = finalText + separator + joinedTools;
            }
        }
    } else {
        extractedTools.sort((a, b) => b.originalIndex - a.originalIndex);
        
        for (const tool of extractedTools) {
            const insertIdx = getInsertionIndex(finalText, tool.originalIndex, placementMode);
            
            if (tool.display) {
                const prefix = insertIdx > 0 && finalText[insertIdx - 1] !== ' ' && finalText[insertIdx - 1] !== '\n' ? ' ' : '';
                const suffix = insertIdx < finalText.length && finalText[insertIdx] !== ' ' && finalText[insertIdx] !== '\n' ? ' ' : '';
                finalText = finalText.slice(0, insertIdx) + prefix + tool.display + suffix + finalText.slice(insertIdx);
            }
        }
    }

    // 7. Cleanup ghost formatting without using trim():
    // Collapse 3+ newlines left by extracted tools into standard paragraph breaks
    finalText = finalText.replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n');

    // Remove leading/trailing newlines only (preserves indentation spaces & tabs)
    finalText = finalText.replace(/^\r?\n+/, '').replace(/\r?\n+$/, '');
    
    // Clean up multiple consecutive spaces
    finalText = finalText.replace(/ {2,}/g, ' ');

    if (character) {
        const mockData = { participants } as InteractionData;
        return convertIdsToDisplayNames(finalText, mockData, character);
    }

    return finalText;
}