// frontend_src/utilities/messageDisplayCompiler.ts
import type { Character, InteractionData, ToolExecutionResult, toolUsageDisplayMode } from '../types';
import {
    toolCallStartString,
    toolCallEndString,
    toolResultStartString,
    toolResultEndString,
} from '../dictionaries/stringList';
import { convertIdsToDisplayNames } from './chatLogic';
import { formatToolDisplay, getFallbackToolResult, type ToolResult } from '../services/ToolExecutor';

export function compileMessageDisplayText(
    rawText: string,
    displayMode: toolUsageDisplayMode | undefined,
    participants: Character[],
    character: Character,
    toolExecutionResults?: ToolExecutionResult[]
): string {
    if (!rawText) return '';

    const mode = displayMode || 'simple';
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const resStartEsc = escapeRegex(toolResultStartString);
    const resEndEsc = escapeRegex(toolResultEndString);

    // 1. Strip observation results completely
    // Matching up to (${resEndEsc}|$) guarantees in-progress unclosed results are stripped during streaming
    const resultRegex = new RegExp(`${resStartEsc}[\\s\\S]*?(${resEndEsc}|$)`, 'g');
    let processed = rawText.replace(resultRegex, '');

    // 2. Build a map from rawMatch to result for quick lookup
    const resultMap = new Map<string, ToolExecutionResult>();
    if (toolExecutionResults) {
        for (const result of toolExecutionResults) {
            resultMap.set(result.rawMatch, result);
        }
    }

    // 3. Replace complete tool calls: ⟪...⟫
    const callStartEsc = escapeRegex(toolCallStartString);
    const callEndEsc = escapeRegex(toolCallEndString);
    const toolRegex = new RegExp(`${callStartEsc}([\\s\\S]*?)${callEndEsc}`, 'g');

    processed = processed.replace(toolRegex, (rawMatch, innerString) => {
        const storedResult = resultMap.get(rawMatch);

        if (storedResult) {
            const result: ToolResult = {
                toolType: storedResult.toolType,
                args: storedResult.args,
                content: storedResult.content,
                displayReplacement: storedResult.displayReplacement
            };
            return formatToolDisplay(result, rawMatch, mode);
        }

        // Fallback for messages without stored results
        const fallbackResult = getFallbackToolResult(innerString);
        return formatToolDisplay(fallbackResult, rawMatch, mode);
    });

    // 4. Suppress any unclosed, in-progress tool call at the tail end of the stream
    const unclosedCallRegex = new RegExp(`${callStartEsc}[\\s\\S]*$`, 'g');
    processed = processed.replace(unclosedCallRegex, '');

    // 5. Clean up spacing and resolve character IDs to display names
    processed = processed.replace(/ {2,}/g, ' ').trim();

    const mockData = { participants } as InteractionData;
    return convertIdsToDisplayNames(processed, mockData, character);
}