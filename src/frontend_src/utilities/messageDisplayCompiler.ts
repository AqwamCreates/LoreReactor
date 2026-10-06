// frontend_src/utilities/messageDisplayCompiler.ts
import type { Character, InteractionData, ToolExecutionResult, toolUsageDisplayMode } from '../types';
import { toolStartSring, toolEndString } from '../dictionaries/stringList';
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
    const startEsc = escapeRegex(toolStartSring);
    const endEsc = escapeRegex(toolEndString);

    // 1. Strip LLM-only result tags (these are never shown to the user)
    const resultRegex = new RegExp(`${startEsc}result:\\s*[\\s\\S]*?${endEsc}`, 'g');
    let processed = rawText.replace(resultRegex, '');

    // 2. Build a map from rawMatch to result for quick lookup
    const resultMap = new Map<string, ToolExecutionResult>();
    if (toolExecutionResults) {
        for (const result of toolExecutionResults) {
            resultMap.set(result.rawMatch, result);
        }
    }

    // 3. Replace tool invocations based on the current display mode
    const toolRegex = new RegExp(`${startEsc}([\\s\\S]*?)${endEsc}`, 'g');
    processed = processed.replace(toolRegex, (rawMatch, innerString) => {
        // Try to find the exact executed result by rawMatch
        const storedResult = resultMap.get(rawMatch);
        
        if (storedResult) {
            // We have the real executed result!
            const result: ToolResult = {
                toolType: storedResult.toolType,
                args: storedResult.args,
                content: storedResult.content,
                displayReplacement: storedResult.displayReplacement
            };
            return formatToolDisplay(result, rawMatch, mode);
        }
            // Fallback for old messages without stored results
        const fallbackResult = getFallbackToolResult(innerString);
        return formatToolDisplay(fallbackResult, rawMatch, mode);
    });

    // 4. Clean up spacing and resolve character IDs to display names
    processed = processed.replace(/ {2,}/g, ' ').trim();
    
    const mockData = { participants } as InteractionData;
    return convertIdsToDisplayNames(processed, mockData, character);
}