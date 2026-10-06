// frontend-src/services/ToolInvocationParser.ts
import { toolStartSring, toolEndString } from '../dictionaries/stringList';

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

    // Strip explicit <| and |> if present in the command
    if (trimmed.startsWith(toolStartSring) && trimmed.endsWith(toolEndString)) {
        trimmed = trimmed.slice(toolStartSring.length, trimmed.length - toolEndString.length).trim();
    }

    const { toolType, args } = parseInnerToolCall(trimmed);
    return {
        toolType,
        args,
        rawMatch: input.trim(),
    };
}

/**
 * Streaming parser that buffers incoming token deltas and strictly detects
 * tool calls enclosed within <| and |>.
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

        let displayText = '';
        const toolInvocations: ToolInvocation[] = [];

        while (this.buffer.length > 0) {
            const startIdx = this.buffer.indexOf(toolStartSring);

            // No start token found
            if (startIdx === -1) {
                // Check if the buffer ends with a partial start token (e.g. "<")
                let safeLen = this.buffer.length;
                for (let len = 1; len < toolStartSring.length; len++) {
                    if (this.buffer.endsWith(toolStartSring.slice(0, len))) {
                        safeLen = this.buffer.length - len;
                        break;
                    }
                }
                displayText += this.buffer.slice(0, safeLen);
                this.buffer = this.buffer.slice(safeLen);
                break;
            }

            // Emit any display text before the <| token
            if (startIdx > 0) {
                displayText += this.buffer.slice(0, startIdx);
                this.buffer = this.buffer.slice(startIdx);
            }

            // Look for matching |> closing token
            const endIdx = this.buffer.indexOf(toolEndString, toolStartSring.length);

            if (endIdx === -1) {
                // The tool call is still streaming tokens inside <|...
                // Hold buffer and wait for the next chunk
                break;
            }

            // Full <|...|> match found!
            const fullEndIdx = endIdx + toolEndString.length;
            const rawMatch = this.buffer.slice(0, fullEndIdx);
            const innerContent = this.buffer.slice(toolStartSring.length, endIdx);

            const { toolType, args } = parseInnerToolCall(innerContent);

            toolInvocations.push({
                toolType,
                args,
                rawMatch,
            });

            // Advance past the tool token
            this.buffer = this.buffer.slice(fullEndIdx);
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