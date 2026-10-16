// src/frontend_src/utilities/messageDisplayCompiler.ts
import type { Character, HistoryMessage, InteractionData, ToolExecutionResult, toolUsageDisplayMode, toolUsageDisplayPlacementMode } from '../types';
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
    originalIndex: number; // The index in the 'cleanText' where this tool originally appeared
}

/**
 * Calculates the exact string index to inject a tool based on the placement mode.
 */
function getInsertionIndex(cleanText: string, mappedIndex: number, mode: PlacementMode): number {
    if (mode === 'top') return 0;
    if (mode === 'bottom') return cleanText.length;

    if (mode === 'after paragraph') {
        const slice = cleanText.slice(mappedIndex);
        const match = slice.match(/\n\n/);
        // ✅ FIX: Added ?? 0 to satisfy TypeScript's strict null checks on RegExpMatchArray.index
        return match ? mappedIndex + (match.index ?? 0) : cleanText.length;
    }
    if (mode === 'before paragraph') {
        const lastPara = cleanText.slice(0, mappedIndex).lastIndexOf('\n\n');
        return lastPara !== -1 ? lastPara + 2 : 0;
    }

    if (mode === 'after sentence') {
        const slice = cleanText.slice(mappedIndex);
        // Match . ! ? followed by whitespace or end of string
        const match = slice.match(/[.!?](?:\s|$)/);
        // ✅ FIX: Added ?? 0 to satisfy TypeScript's strict null checks on RegExpMatchArray.index
        return match ? mappedIndex + (match.index ?? 0) + 1 : cleanText.length;
    }
    if (mode === 'before sentence') {
        const slice = cleanText.slice(0, mappedIndex);
        const lastPunct = Math.max(
            slice.lastIndexOf('.'),
            slice.lastIndexOf('!'),
            slice.lastIndexOf('?')
        );
        return lastPunct !== -1 ? lastPunct + 1 : 0;
    }

    return mappedIndex; // 'inline'
}

/**
 * Centralized compiler: Accepts either a HistoryMessage object directly OR a raw string.
 */
export function compileMessageDisplayText(
    target: HistoryMessage | string | null | undefined,
    displayMode: toolUsageDisplayMode = 'simple',
    placementMode: PlacementMode = 'inline',
    participants: Character[] = []
): string {
    if (!target) return '';

    if (typeof target === 'string') {
        return compileRawString(target, displayMode, placementMode, participants, undefined, undefined);
    }

    const character = target.character;
    const rawText = ('textContent' in target ? target.textContent : '');
    const toolExecutionResults = 'toolExecutionResults' in target ? target.toolExecutionResults : undefined;

    return compileRawString(rawText, displayMode, placementMode, participants, character, toolExecutionResults);
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

    // 4. Extract and Strip tool calls
    const toolRegex = new RegExp(`${callStartEsc}([\\s\\S]*?)${callEndEsc}`, 'g');
    const extractedTools: ExtractedTool[] = [];
    let cleanText = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = toolRegex.exec(processed)) !== null) {
        const rawMatch = match[0];
        const innerString = match[1];
        const startIndex = match.index;

        // Add text before this tool to the clean string
        cleanText += processed.slice(lastIndex, startIndex);

        // Format the tool display string
        const stored = resultMap.get(rawMatch);
        let display = '';
        if (stored) {
            display = formatToolDisplay({ ...stored }, rawMatch, mode);
        } else {
            display = formatToolDisplay(getFallbackToolResult(innerString), rawMatch, mode);
        }

        extractedTools.push({
            display,
            originalIndex: cleanText.length // Index in cleanText where this tool *would* have been
        });

        lastIndex = startIndex + rawMatch.length;
    }
    cleanText += processed.slice(lastIndex);

    // 5. Suppress unclosed tool calls at tail of stream
    const unclosedCallRegex = new RegExp(`${callStartEsc}[\\s\\S]*$`, 'g');
    cleanText = cleanText.replace(unclosedCallRegex, '');

    // 6. Re-inject tools based on placement mode
    // Sort descending so we insert from back to front without invalidating earlier indices
    extractedTools.sort((a, b) => b.originalIndex - a.originalIndex);
    
    let finalText = cleanText;
    for (const tool of extractedTools) {
        const insertIdx = getInsertionIndex(finalText, tool.originalIndex, placementMode);
        
        if (tool.display) {
            // Add spacing so the tool block doesn't mash into adjacent words
            const prefix = insertIdx > 0 && finalText[insertIdx - 1] !== ' ' && finalText[insertIdx - 1] !== '\n' ? ' ' : '';
            const suffix = insertIdx < finalText.length && finalText[insertIdx] !== ' ' && finalText[insertIdx] !== '\n' ? ' ' : '';
            finalText = finalText.slice(0, insertIdx) + prefix + tool.display + suffix + finalText.slice(insertIdx);
        }
    }

    // 7. Clean up spacing and convert IDs
    finalText = finalText.replace(/ {2,}/g, ' ').trim();

    if (character) {
        const mockData = { participants } as InteractionData;
        return convertIdsToDisplayNames(finalText, mockData, character);
    }

    return finalText;
}