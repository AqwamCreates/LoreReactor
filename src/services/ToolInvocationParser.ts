// src/services/ToolInvocationParser.ts

import { toolStartSring, toolEndString } from "../dictionaries/stringList";
import type { tool } from "../types";

const characterAgnosticTools: tool[] = ['whisper', 'think', 'pick', 'clock', 'calendar', 'coin', 'dice', 'random', 'rng', 'move', 'dialogue', 'knowledge', 'memory', 'lookup', 'map', 'audio', 'clothing', 'note', 'inventory', 'trade'];
const characterSpecificTools: tool[] = ['timer', 'stopwatch', 'calculator', 'schedule', 'web', 'invite', 'kick', 'teleport' , 'key', 'summon', 'narrate'];
const metaTools: tool[] = ['inspect', 'administrator', 'creator', 'destroyer'];
const serverTools: tool[] = ['read_file', 'browser', 'write_file'];

export const validTools: tool[] = [...characterAgnosticTools, ...characterSpecificTools, ...metaTools, ...serverTools];

export interface ToolInvocation {
    rawMatch: string;
    toolType: string;
    args: string;
}

export interface ParsedStreamResult {
    displayText: string;
    resumeText: string;
    toolInvocations: ToolInvocation[];
    isSuppressed: boolean;
}

type ParserState = 'NORMAL' | 'SUPPRESSING';

export class ToolInvocationParser {
    private state: ParserState = 'NORMAL';
    private buffer = '';
    private suppressedAccumulator = '';

    processChunk(chunk: string): ParsedStreamResult {
        const input = this.buffer + chunk;
        this.buffer = '';

        let displayOut = '';
        let resumeOut = '';
        const toolInvocations: ToolInvocation[] = [];

        let i = 0;
        while (i < input.length) {
            if (this.state === 'NORMAL') {
                const startIdx = input.indexOf(toolStartSring, i);

                if (startIdx === -1) {
                    const tail = input.slice(i);
                    if (this.isPartialMarker(tail, toolStartSring)) {
                        this.buffer = tail;
                    } else {
                        displayOut += tail;
                        resumeOut += tail;
                    }
                    break;
                }

                // Text before the tool tag is safe for display
                let before = input.slice(i, startIdx);
                before = before.replace(/\n\s*\n\s*$/, '\n');
                
                displayOut += before;
                resumeOut += before;

                const afterStart = startIdx + toolStartSring.length;
                const endIdx = input.indexOf(toolEndString, afterStart);

                if (endIdx === -1) {
                    this.state = 'SUPPRESSING';
                    this.suppressedAccumulator = input.slice(afterStart);
                    break;
                }

                const exactRaw = input.slice(startIdx, endIdx + toolEndString.length);
                const toolContent = input.slice(afterStart, endIdx);
                const invocation = parseToolContent(toolContent);
                if (invocation) {
                    invocation.rawMatch = exactRaw;
                    toolInvocations.push(invocation);
                }

                i = endIdx + toolEndString.length;
            } else if (this.state === 'SUPPRESSING') {
                const combined = this.suppressedAccumulator + input.slice(i);
                const endIdx = combined.indexOf(toolEndString);

                if (endIdx === -1) {
                    this.suppressedAccumulator = combined;
                    break;
                }

                const exactRaw = `${toolStartSring}${combined.slice(0, endIdx + toolEndString.length)}`;
                const toolContent = combined.slice(0, endIdx);
                const invocation = parseToolContent(toolContent);
                if (invocation) {
                    invocation.rawMatch = exactRaw;
                    toolInvocations.push(invocation);
                }

                const prevSuppressedLen = this.suppressedAccumulator.length;
                this.state = 'NORMAL';
                this.suppressedAccumulator = '';

                // Advance pointer past the end marker in input
                const consumedFromInput = (endIdx + toolEndString.length) - prevSuppressedLen;
                i += Math.max(0, consumedFromInput);
            }
        }

        return { displayText: displayOut, resumeText: resumeOut, toolInvocations, isSuppressed: this.state === 'SUPPRESSING' };
    }

    reset(): void {
        this.state = 'NORMAL';
        this.buffer = '';
        this.suppressedAccumulator = '';
    }

    private isPartialMarker(tail: string, marker: string): boolean {
        return tail.length > 0 && tail.length < marker.length && marker.startsWith(tail);
    }
}

function isValidToolType(type: string): boolean {
    return validTools.includes(type as tool);
}

/**
 * Parses Python-style function calls: <|tool_name()|> or <|tool_name(param="val", ...)|>.
 * Passes raw args directly to ToolExecutor's parsePythonArgs to preserve quoted strings and commas.
 */
function parseToolContent(content: string): ToolInvocation | null {
    const trimmed = content.trim();
    if (!trimmed) return null;

    // Strict regex requiring parentheses: tool_name(...)
    const fnMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*\(([\s\S]*)\)$/);
    if (!fnMatch) return null;

    const toolType = fnMatch[1].toLowerCase();
    if (!isValidToolType(toolType)) return null;

    const args = fnMatch[2].trim();

    return {
        rawMatch: `${toolStartSring}${content}${toolEndString}`,
        toolType,
        args,
    };
}

export function parseSlashCommand(input: string): ToolInvocation | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;
    const withoutSlash = trimmed.slice(1).trim();
    if (!withoutSlash) return null;

    // Support /tool(key="val", ...)
    const fnMatch = withoutSlash.match(/^([a-zA-Z0-9_]+)\s*\(([\s\S]*)\)$/);
    if (fnMatch) {
        const toolType = fnMatch[1].toLowerCase();
        if (isValidToolType(toolType)) {
            return { rawMatch: trimmed, toolType, args: fnMatch[2].trim() };
        }
    }

    // Support standard /tool args for manual user typing in the chatbox
    const parts = withoutSlash.split(/[:\s]/);
    const toolType = parts[0].toLowerCase();
    if (isValidToolType(toolType)) {
        return { rawMatch: trimmed, toolType, args: withoutSlash.slice(toolType.length).replace(/^[:\s]+/, '').trim() };
    }
    return null;
}