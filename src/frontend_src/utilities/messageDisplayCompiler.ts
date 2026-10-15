// src/frontend_src/utilities/messageDisplayCompiler.ts
import type { Character, InteractionData, TextMessage, ToolExecutionResult, toolUsageDisplayMode } from '../types';
import {
    toolCallStartString,
    toolCallEndString,
    toolResultStartString,
    toolResultEndString,
} from '../dictionaries/stringList';
import { convertIdsToDisplayNames } from './interactionDataLogic';
import { formatToolDisplay, getFallbackToolResult, type ToolResult } from '../services/ToolExecutor';

// Centralized compiler: Accepts either a HistoryMessage object directly OR a raw string.

export function compileMessageDisplayText(
    target: TextMessage | string | null | undefined,
    displayMode: toolUsageDisplayMode = 'simple',
    participants: Character[] = []
): string {
    if (!target) return '';

    // Handle string target directly
    if (typeof target === 'string') {
        return compileRawString(target, displayMode, participants, undefined, undefined);
    }

    const character = target.character;
    const rawText = ('textContent' in target ? target.textContent : '');

    const toolExecutionResults = 'toolExecutionResults' in target ? target.toolExecutionResults : undefined;

    return compileRawString(rawText, displayMode, participants, character, toolExecutionResults);
}

function compileRawString(
    rawText: string,
    mode: toolUsageDisplayMode,
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

    // 1. Strip observation results completely (including in-progress streaming up to $)
    // Consume any trailing whitespace so orphan spaces or boundaries do not linger: ⟦...⟧ *
    const resultRegex = new RegExp(`${resStartEsc}[\\s\\S]*?(${resEndEsc}|$) *`, 'g');
    let processed = rawText.replace(resultRegex, '');

    // 2. Strip orphan closing delimiters that might have been echoed by backends at prompt boundaries
    const orphanEndRegex = new RegExp(`^ *(${resEndEsc}|${callEndEsc}) *`, 'g');
    processed = processed.replace(orphanEndRegex, '');

    // 3. Build resultMap for executed tools
    const resultMap = new Map<string, ToolExecutionResult>();
    if (toolExecutionResults) {
        for (const res of toolExecutionResults) {
            resultMap.set(res.rawMatch, res);
        }
    }

    // 4. Replace complete tool calls: ⟪...⟫
    const toolRegex = new RegExp(`${callStartEsc}([\\s\\S]*?)${callEndEsc}`, 'g');

    processed = processed.replace(toolRegex, (rawMatch, innerString) => {
        const stored = resultMap.get(rawMatch);
        if (stored) {
            const result: ToolResult = {
                toolType: stored.toolType,
                args: stored.args,
                content: stored.content,
                displayReplacement: stored.displayReplacement,
            };
            return formatToolDisplay(result, rawMatch, mode);
        }

        const fallback = getFallbackToolResult(innerString);
        return formatToolDisplay(fallback, rawMatch, mode);
    });

    // 5. Suppress unclosed tool calls at tail of stream
    const unclosedCallRegex = new RegExp(`${callStartEsc}[\\s\\S]*$`, 'g');
    processed = processed.replace(unclosedCallRegex, '');

    // 6. Clean up spacing and convert IDs
    processed = processed.replace(/ {2,}/g, ' ').trim();

    if (character) {
        const mockData = { participants } as InteractionData;
        return convertIdsToDisplayNames(processed, mockData, character);
    }

    return processed;
}