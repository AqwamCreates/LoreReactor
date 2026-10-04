// src/utilities/messageDisplayCompiler.ts
import type { Character, InteractionData, toolUsageDisplayMode } from '../types';
import { toolStartSring, toolEndString } from '../dictionaries/stringList';
import { convertIdsToDisplayNames } from './chatLogic';
import { formatToolDisplay, type ToolResult } from '../services/ToolExecutor';

export function compileMessageDisplayText(
    rawText: string,
    displayMode: toolUsageDisplayMode | undefined,
    participants: Character[],
    character: Character
): string {
    if (!rawText) return '';

    const mode = displayMode || 'simple';
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startEsc = escapeRegex(toolStartSring);
    const endEsc = escapeRegex(toolEndString);

    // 1. Strip LLM-only result tags (these are never shown to the user)
    const resultRegex = new RegExp(`${startEsc}result:\\s*[\\s\\S]*?${endEsc}`, 'g');
    let processed = rawText.replace(resultRegex, '');

    // 2. Replace tool invocations based on the current display mode
    const toolRegex = new RegExp(`${startEsc}([\\s\\S]*?)${endEsc}`, 'g');
    processed = processed.replace(toolRegex, (rawMatch, inner) => {
        const trimmedInner = inner.trim();
        
        let toolType = trimmedInner;
        let args = '';
        
        // Parse tool name and arguments
        const fnMatch = trimmedInner.match(/^([a-zA-Z_]\w*)\s*\(([\s\S]*)\)$/);
        if (fnMatch) {
            toolType = fnMatch[1];
            args = fnMatch[2];
        } else {
            const spaceIdx = trimmedInner.search(/\s/);
            if (spaceIdx !== -1) {
                toolType = trimmedInner.slice(0, spaceIdx);
                args = trimmedInner.slice(spaceIdx + 1).trim();
            }
        }

        // Construct a dummy ToolResult to feed into the universal formatter
        const dummyResult: ToolResult = {
            toolType,
            args,
            content: args,
            displayReplacement: `[🔧 ${toolType}${args ? ': ' + args : ''}]`
        };

        return formatToolDisplay(dummyResult, rawMatch, mode);
    });

    // 3. Clean up spacing and resolve character IDs to display names
    processed = processed.replace(/  +/g, ' ').trim();
    
    const mockData = { participants } as InteractionData;
    return convertIdsToDisplayNames(processed, mockData, character);
}