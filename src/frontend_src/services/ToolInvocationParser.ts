// src/frontend_src/services/ToolInvocationParser.ts
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
    parseError?: string; // FIXED: Added this missing interface property
}

export interface ParsedChunkResult {
    displayText: string;
    toolInvocations: ToolInvocation[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInnerToolCall(inner: string): { toolType: string; args: string; parseError?: string } {
    const trimmed = inner;

    // 1. JSON format
    if (/^\s*\{/.test(trimmed)) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (isPlainObject(parsed) && typeof parsed.name === 'string' && parsed.name) {
                const toolType = parsed.name.toLowerCase();
                const hasArgs = Object.prototype.hasOwnProperty.call(parsed, 'arguments') && parsed.arguments !== undefined;
                return {
                    toolType,
                    args: hasArgs ? JSON.stringify(parsed.arguments) : '',
                };
            }
            return { toolType: '', args: '', parseError: 'JSON must contain a "name" property.' };
        } catch (e) {
            const nameMatch = trimmed.match(/"name"\s*:\s*"([^"]+)"/);
            return {
                toolType: nameMatch ? nameMatch[1].toLowerCase() : 'unknown',
                args: trimmed,
                parseError: `Invalid JSON: ${(e as Error).message}`,
            };
        }
    }

    // 2. Function format: name(...)
    const fnMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*\(([\s\S]*)\)$/);
    if (fnMatch) {
        return {
            toolType: fnMatch[1].toLowerCase(),
            args: fnMatch[2],
        };
    }

    // 3. Space-separated format: name arg1 arg2...
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) {
        return {
            toolType: trimmed.toLowerCase(),
            args: '',
        };
    }

    return {
        toolType: trimmed.slice(0, spaceIdx).toLowerCase(),
        args: trimmed.slice(spaceIdx + 1),
    };
}

export function parseSlashCommand(input: string): ToolInvocation | null {
    let trimmed = input;
    if (!trimmed.startsWith('/')) return null;
    trimmed = trimmed.slice(1);
    if (!trimmed) return null;

    if (trimmed.startsWith(toolCallStartString) && trimmed.endsWith(toolCallEndString)) {
        trimmed = trimmed.slice(toolCallStartString.length, trimmed.length - toolCallEndString.length);
    }

    const { toolType, args, parseError } = parseInnerToolCall(trimmed);
    return { toolType, args, rawMatch: input, parseError };
}

export class ToolInvocationParser {
    private buffer = '';

    reset(): void { this.buffer = ''; }
    getBuffer(): string { return this.buffer; }

    processChunk(chunk: string): ParsedChunkResult {
        this.buffer += chunk;
        while (this.buffer.length > 0) {
            const buffer = this.buffer;
            if (buffer.startsWith(toolResultEndString)) this.buffer = buffer.slice(toolResultEndString.length);
            else if (buffer.startsWith(toolCallEndString)) this.buffer = buffer.slice(toolCallEndString.length);
            else break;
        }

        let displayText = '';
        const toolInvocations: ToolInvocation[] = [];

        while (this.buffer.length > 0) {
            const callIdx = this.buffer.indexOf(toolCallStartString);
            const resIdx = this.buffer.indexOf(toolResultStartString);

            if (callIdx === -1 && resIdx === -1) {
                let safeLen = this.buffer.length;
                for (const startToken of [toolCallStartString, toolResultStartString]) {
                    for (let len = 1; len < startToken.length; len++) {
                        if (this.buffer.endsWith(startToken.slice(0, len))) safeLen = Math.min(safeLen, this.buffer.length - len);
                    }
                }
                displayText += this.buffer.slice(0, safeLen);
                this.buffer = this.buffer.slice(safeLen);
                break;
            }

            const nextIdx = (callIdx !== -1 && resIdx !== -1) ? Math.min(callIdx, resIdx) : (callIdx !== -1 ? callIdx : resIdx);
            const isCall = nextIdx === callIdx;

            if (nextIdx > 0) {
                displayText += this.buffer.slice(0, nextIdx);
                this.buffer = this.buffer.slice(nextIdx);
            }

            if (isCall) {
                const endIdx = this.buffer.indexOf(toolCallEndString, toolCallStartString.length);
                if (endIdx === -1) break;

                const fullEndIdx = endIdx + toolCallEndString.length;
                const rawMatch = this.buffer.slice(0, fullEndIdx);
                const innerContent = this.buffer.slice(toolCallStartString.length, endIdx);

                const parsed = parseInnerToolCall(innerContent);
                toolInvocations.push({ ...parsed, rawMatch });
                this.buffer = this.buffer.slice(fullEndIdx);
            } else {
                const endIdx = this.buffer.indexOf(toolResultEndString, toolResultStartString.length);
                if (endIdx === -1) break;
                const fullEndIdx = endIdx + toolResultEndString.length;
                let nextSliceIdx = fullEndIdx;
                if (this.buffer[nextSliceIdx] === ' ') nextSliceIdx++;
                this.buffer = this.buffer.slice(nextSliceIdx);
            }
        }
        return { displayText, toolInvocations };
    }

    static parseAll(text: string): { displayText: string; toolInvocations: ToolInvocation[] } {
        const parser = new ToolInvocationParser();
        const result = parser.processChunk(text);
        return { displayText: result.displayText + parser.getBuffer(), toolInvocations: result.toolInvocations };
    }
}