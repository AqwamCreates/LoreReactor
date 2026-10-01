// src/services/ToolInvocationParser.ts

import { toolStartSring, toolEndString } from "../dictionaries/stringList";
import type { tool } from "../types";

const characterAgnosticTools: tool[] = ['whisper', 'think', 'pick', 'clock', 'calendar', 'coin', 'dice', 'random', 'rng', 'move', 'dialogue', 'knowledge', 'memory', 'lookup', 'map', 'audio', 'clothing', 'note', 'inventory', 'trade'];
const characterSpecificTools: tool[] = ['timer', 'stopwatch', 'calculator', 'schedule', 'web', 'invite', 'kick', 'teleport' , 'key', 'summon', 'narrate'];
const metaTools: tool[] = ['inspect', 'administrator', 'creator', 'destroyer'];

export const validTools: tool[] = [...characterAgnosticTools, ...characterSpecificTools, ...metaTools];

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

                // 1. Process text before the tool tag
                let before = input.slice(i, startIdx);
                // Collapse trailing double-newlines before a tool into a single newline
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

                const toolContent = input.slice(afterStart, endIdx).trim();
                const invocation = parseToolContent(toolContent);
                if (invocation) toolInvocations.push(invocation);

                // 2. Process text after the tool tag
                let nextPos = endIdx + toolEndString.length;
                // Collapse leading double-newlines after a tool into a single newline
                let after = input.slice(nextPos);
                if (/^\n\s*\n/.test(after)) {
                    after = after.replace(/^\n\s*\n/, '\n');
                }
                
                // If we consumed the start of the next text block, we adjust the pointer
                // but for simplicity in streaming, we just push the cleaned 'after'
                // to the buffers if there's no start marker immediately following.
                input.slice(nextPos); // consumed
                i = nextPos; 
                // We don't advance 'i' further here, the loop will process the cleaned 'after' 
                // via displayOut in the next iteration or break.
                
            } else if (this.state === 'SUPPRESSING') {
                const combined = this.suppressedAccumulator + input.slice(i);
                const endIdx = combined.indexOf(toolEndString);

                if (endIdx === -1) {
                    this.suppressedAccumulator = combined;
                    break;
                }

                const toolContent = combined.slice(0, endIdx).trim();
                const invocation = parseToolContent(toolContent);
                if (invocation) toolInvocations.push(invocation);

                this.state = 'NORMAL';
                this.suppressedAccumulator = '';
                i = endIdx + toolEndString.length;
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

function parseToolContent(content: string): ToolInvocation | null {
    const trimmed = content.trim();
    if (!trimmed) return null;

    const separatorIdx = trimmed.search(/[:\s]/);
    if (separatorIdx > 0) {
        const toolType = trimmed.slice(0, separatorIdx).toLowerCase();
        const args = trimmed.slice(separatorIdx + 1).trim();
        if (isValidToolType(toolType)) {
            return { rawMatch: `${toolStartSring}${content}${toolEndString}`, toolType, args };
        }
    }
    
    const singleWord = trimmed.toLowerCase();
    if (isValidToolType(singleWord)) {
        return { rawMatch: `${toolStartSring}${content}${toolEndString}`, toolType: singleWord, args: '' };
    }
    return null;
}

export function parseSlashCommand(input: string): ToolInvocation | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;
    const withoutSlash = trimmed.slice(1).trim();
    if (!withoutSlash) return null;

    const parts = withoutSlash.split(/[:\s]/);
    const toolType = parts[0].toLowerCase();
    if (isValidToolType(toolType)) {
        return { rawMatch: trimmed, toolType, args: withoutSlash.slice(toolType.length).replace(/^[:\s]+/, '').trim() };
    }
    return null;
}