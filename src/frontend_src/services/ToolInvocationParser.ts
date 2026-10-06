// frontend_src/services/ToolInvocationParser.ts
import {
    toolCallStartString,
    toolCallEndString,
    toolResultStartString,
    toolResultEndString,
} from '../dictionaries/stringList';

export interface ToolInvocation {
    toolType: string;
    args: string;
    rawMatch: string;
}

export interface ParsedChunkResult {
    displayText: string;
    toolInvocations: ToolInvocation[];
}

/**
 * Extracts toolType and args from the inner text of a tool token:
 *   - Function style: "dice(sides: 6, count: 5)" -> toolType: "dice", args: "sides: 6, count: 5"
 *   - CLI style:      "inventory add \"Iron Sword\" 3" -> toolType: "inventory", args: "add \"Iron Sword\" 3"
 *   - Simple:         "coin" -> toolType: "coin", args: ""
 */
function parseInnerToolCall(inner: string): { toolType: string; args: string } {
    const trimmed = inner.trim();

    // 1. Function format: name(...)
    const fnMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*\(([\s\S]*)\)$/);
    if (fnMatch) {
        return {
            toolType: fnMatch[1].toLowerCase(),
            args: fnMatch[2].trim(),
        };
    }

    // 2. Space-separated format: name arg1 arg2...
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) {
        return {
            toolType: trimmed.toLowerCase(),
            args: '',
        };
    }

    return {
        toolType: trimmed.slice(0, spaceIdx).toLowerCase(),
        args: trimmed.slice(spaceIdx + 1).trim(),
    };
}

/**
 * Parses slash commands typed by the user in chat.
 */
export function parseSlashCommand(input: string): ToolInvocation | null {
    let trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;

    trimmed = trimmed.slice(1).trim();
    if (!trimmed) return null;

    // Strip explicit ⟪ and ⟫ if present in the command
    if (trimmed.startsWith(toolCallStartString) && trimmed.endsWith(toolCallEndString)) {
        trimmed = trimmed.slice(toolCallStartString.length, trimmed.length - toolCallEndString.length).trim();
    }

    const { toolType, args } = parseInnerToolCall(trimmed);
    return {
        toolType,
        args,
        rawMatch: input.trim(),
    };
}

/**
 * Streaming parser that buffers incoming token deltas:
 *   - Detects tool calls enclosed within ⟪ and ⟫.
 *   - Silently drops tool results enclosed within ⟦ and ⟧ so observations never leak into displayText.
 *   - Absorbs orphan boundary brackets echoed by the inference backend after prompt injection.
 */
export class ToolInvocationParser {
    private buffer = '';

    reset(): void {
        this.buffer = '';
    }

    getBuffer(): string {
        return this.buffer;
    }

    processChunk(chunk: string): ParsedChunkResult {
        this.buffer += chunk;

        // Absorb orphan closing brackets echoed by the model at prompt boundaries
        while (this.buffer.length > 0) {
            const trimmedStart = this.buffer.trimStart();
            if (trimmedStart.startsWith(toolResultEndString)) {
                this.buffer = trimmedStart.slice(toolResultEndString.length);
            } else if (trimmedStart.startsWith(toolCallEndString)) {
                this.buffer = trimmedStart.slice(toolCallEndString.length);
            } else {
                break;
            }
        }

        let displayText = '';
        const toolInvocations: ToolInvocation[] = [];

        while (this.buffer.length > 0) {
            const callIdx = this.buffer.indexOf(toolCallStartString);
            const resIdx = this.buffer.indexOf(toolResultStartString);

            // 1. Neither tag encountered in current buffer
            if (callIdx === -1 && resIdx === -1) {
                let safeLen = this.buffer.length;
                for (const startToken of [toolCallStartString, toolResultStartString]) {
                    for (let len = 1; len < startToken.length; len++) {
                        if (this.buffer.endsWith(startToken.slice(0, len))) {
                            safeLen = Math.min(safeLen, this.buffer.length - len);
                        }
                    }
                }
                displayText += this.buffer.slice(0, safeLen);
                this.buffer = this.buffer.slice(safeLen);
                break;
            }

            // 2. Identify whichever delimiter appears first
            const nextIdx = (callIdx !== -1 && resIdx !== -1)
                ? Math.min(callIdx, resIdx)
                : (callIdx !== -1 ? callIdx : resIdx);

            const isCall = nextIdx === callIdx;

            // Emit any plain dialogue preceding the delimiter
            if (nextIdx > 0) {
                displayText += this.buffer.slice(0, nextIdx);
                this.buffer = this.buffer.slice(nextIdx);
            }

            // 3. Process Tool Call: ⟪...⟫
            if (isCall) {
                const endIdx = this.buffer.indexOf(toolCallEndString, toolCallStartString.length);
                if (endIdx === -1) {
                    // Tool call is still streaming; hold buffer and await next chunk
                    break;
                }

                const fullEndIdx = endIdx + toolCallEndString.length;
                const rawMatch = this.buffer.slice(0, fullEndIdx);
                const innerContent = this.buffer.slice(toolCallStartString.length, endIdx);

                const { toolType, args } = parseInnerToolCall(innerContent);
                toolInvocations.push({ toolType, args, rawMatch });

                this.buffer = this.buffer.slice(fullEndIdx);
            } 
            // 4. Process Tool Result: ⟦...⟧ (Suppressed completely from displayText)
            else {
                const endIdx = this.buffer.indexOf(toolResultEndString, toolResultStartString.length);
                if (endIdx === -1) {
                    // In-progress observation; hold buffer to prevent leaking into displayText
                    break;
                }

                const fullEndIdx = endIdx + toolResultEndString.length;

                // Absorb any optional trailing boundary space that was appended with the result
                let nextSliceIdx = fullEndIdx;
                if (this.buffer[nextSliceIdx] === ' ') {
                    nextSliceIdx++;
                }

                this.buffer = this.buffer.slice(nextSliceIdx);
            }
        }

        return {
            displayText,
            toolInvocations,
        };
    }

    static parseAll(text: string): { displayText: string; toolInvocations: ToolInvocation[] } {
        const parser = new ToolInvocationParser();
        const result = parser.processChunk(text);
        return {
            displayText: result.displayText + parser.getBuffer(),
            toolInvocations: result.toolInvocations,
        };
    }
}