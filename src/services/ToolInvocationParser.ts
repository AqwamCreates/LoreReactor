// src/services/ToolInvocationParser.ts

import { toolStartSring, toolEndString } from "../stringList";

export interface ToolInvocation {
    /** The full matched string including markers, e.g. "${toolStartSring}search: weather in Tokyo${toolEndString}" */
    rawMatch: string;
    /** The tool type, e.g. "search" or "calculator" */
    toolType: string;
    /** The arguments after the tool type, e.g. "weather in Tokyo" */
    args: string;
}

export interface ParsedStreamResult {
    /** Text safe to display to the user (tool blocks removed or replaced) */
    displayText: string;
    /** Text to use as existingCharacterText when resuming generation (tool blocks replaced with results) */
    resumeText: string;
    /** Tool invocations found in this chunk, in order of appearance */
    toolInvocations: ToolInvocation[];
    /** Whether the stream ended mid-tool (suppressed state, waiting for ${toolEndString}) */
    isSuppressed: boolean;
}

type ParserState = 'NORMAL' | 'SUPPRESSING';

/**
 * Parses streamed text for tool invocation markers.
 * Maintains internal state across calls to handle markers split across chunks.
 */
export class ToolInvocationParser {
    private state: ParserState = 'NORMAL';
    private buffer = '';
    private suppressedAccumulator = '';

    /**
     * Feed a chunk of streamed text. Returns parsed result with display text,
     * resume text, and any complete tool invocations found.
     */
    processChunk(chunk: string): ParsedStreamResult {
        const input = this.buffer + chunk;
        this.buffer = '';

        let displayOut = '';
        let resumeOut = '';
        const toolInvocations: ToolInvocation[] = [];

        let i = 0;

        while (i < input.length) {
            if (this.state === 'NORMAL') {
                // Look for start marker
                const startIdx = input.indexOf(toolStartSring, i);

                if (startIdx === -1) {
                    // No marker found — check if tail could be partial marker
                    const tail = input.slice(i);
                    if (this.isPartialMarker(tail, toolStartSring)) {
                        this.buffer = tail;
                    } else {
                        displayOut += tail;
                        resumeOut += tail;
                    }
                    break;
                }

                // Output everything before the marker
                const before = input.slice(i, startIdx);
                displayOut += before;
                resumeOut += before;

                // Check if end marker exists after start
                const afterStart = startIdx + toolStartSring.length;
                const endIdx = input.indexOf(toolEndString, afterStart);

                if (endIdx === -1) {
                    // Start marker found but no end marker yet — enter suppressed state
                    this.state = 'SUPPRESSING';
                    this.suppressedAccumulator = input.slice(afterStart);
                    break;
                }

                // Complete tool invocation found in this chunk
                const toolContent = input.slice(afterStart, endIdx).trim();
                const invocation = parseToolContent(toolContent);

                if (invocation) {
                    toolInvocations.push(invocation);
                }

                i = endIdx + toolEndString.length;
            } else if (this.state === 'SUPPRESSING') {
                // Looking for end marker within accumulated suppressed text + new input
                const combined = this.suppressedAccumulator + input.slice(i);
                const endIdx = combined.indexOf(toolEndString);

                if (endIdx === -1) {
                    // Still no end marker — keep accumulating
                    this.suppressedAccumulator = combined;
                    break;
                }

                // End marker found
                const toolContent = combined.slice(0, endIdx).trim();
                const invocation = parseToolContent(toolContent);

                if (invocation) {
                    toolInvocations.push(invocation);
                }

                this.state = 'NORMAL';
                this.suppressedAccumulator = '';

                // Continue processing remainder after end marker
                const remainder = combined.slice(endIdx + toolEndString.length);
                if (remainder.length > 0) {
                    // Re-process remainder through normal state
                    const subResult = this.processChunk(remainder);
                    displayOut += subResult.displayText;
                    resumeOut += subResult.resumeText;
                    toolInvocations.push(...subResult.toolInvocations);
                    // If sub-processing re-entered suppressed state, propagate
                    if (subResult.isSuppressed) {
                        return {
                            displayText: displayOut,
                            resumeText: resumeOut,
                            toolInvocations,
                            isSuppressed: true,
                        };
                    }
                }
                break;
            }
        }

        return {
            displayText: displayOut,
            resumeText: resumeOut,
            toolInvocations,
            isSuppressed: this.state === 'SUPPRESSING',
        };
    }

    /**
     * Reset parser state. Call when starting a new generation.
     */
    reset(): void {
        this.state = 'NORMAL';
        this.buffer = '';
        this.suppressedAccumulator = '';
    }

    /**
     * Check if a string is a partial prefix of a marker.
     * Used to avoid splitting markers across chunks.
     */
    private isPartialMarker(tail: string, marker: string): boolean {
        if (tail.length === 0 || tail.length >= marker.length) return false;
        return marker.startsWith(tail);
    }
}

/**
 * Parse tool content string into type and arguments.
 * Format: "type: arguments" or "type arguments"
 */
function parseToolContent(content: string): ToolInvocation | null {
    if (!content.trim()) return null;

    const trimmed = content.trim();

    // Try colon-separated first: "search: weather in Tokyo"
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
        const toolType = trimmed.slice(0, colonIdx).trim().toLowerCase();
        const args = trimmed.slice(colonIdx + 1).trim();
        if (toolType && isValidToolType(toolType)) {
            return {
                rawMatch: `${toolStartSring}${content}${toolEndString}`,
                toolType,
                args,
            };
        }
    }

    // Try space-separated: "calculator 2+2*3"
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx > 0) {
        const toolType = trimmed.slice(0, spaceIdx).trim().toLowerCase();
        const args = trimmed.slice(spaceIdx + 1).trim();
        if (toolType && isValidToolType(toolType)) {
            return {
                rawMatch: `${toolStartSring}${content}${toolEndString}`,
                toolType,
                args,
            };
        }
    }

    // Single word with no args (unlikely but handle gracefully)
    const singleWord = trimmed.toLowerCase();
    if (isValidToolType(singleWord)) {
        return {
            rawMatch: `${toolStartSring}${content}${toolEndString}`,
            toolType: singleWord,
            args: '',
        };
    }

    console.warn(`Unknown tool type in invocation: "${trimmed}"`);
    return null;
}

function isValidToolType(type: string): boolean {
    return type === 'search' || type === 'calculator';
}