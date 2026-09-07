// src/services/ToolExecutor.ts

import type { ToolInvocation } from '../services/ToolInvocationParser';
import { fetchLinkContent, buildSearchUrl } from '../services/linkFetcher';

export interface ToolResult {
    /** The tool type that produced this result */
    toolType: string;
    /** The original arguments passed to the tool */
    args: string;
    /** The raw text result to inject back into the prompt */
    content: string;
    /** Optional metadata for UI display (e.g., search query, clicked link) */
    metadata?: ToolResultMetadata;
}

export interface ToolResultMetadata {
    /** For search: the query that was searched */
    searchQuery?: string;
    /** For search: URLs that were fetched */
    sourceUrls?: string[];
    /** For calc: the expression that was evaluated */
    expression?: string;
}

/**
 * Execute a tool invocation and return the result.
 */
export async function executeTool(invocation: ToolInvocation): Promise<ToolResult> {
    switch (invocation.toolType) {
        case 'search':
            return executeSearch(invocation.args);
        case 'calc':
            return executeCalc(invocation.args);
        default:
            console.warn(`Unknown tool type: ${invocation.toolType}`);
            return {
                toolType: invocation.toolType,
                args: invocation.args,
                content: `[Error: Unknown tool "${invocation.toolType}"]`,
            };
    }
}

/**
 * Execute multiple tool invocations sequentially.
 * Returns results in the same order as invocations.
 */
export async function executeTools(invocations: ToolInvocation[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const invocation of invocations) {
        const result = await executeTool(invocation);
        results.push(result);
    }
    return results;
}

async function executeSearch(query: string): Promise<ToolResult> {
    if (!query.trim()) {
        return {
            toolType: 'search',
            args: query,
            content: '[Error: Empty search query]',
            metadata: { searchQuery: query },
        };
    }

    try {
        // Check if the query is a direct URL
        let urlToFetch: string;
        const trimmedQuery = query.trim();

        if (/^https?:\/\//i.test(trimmedQuery)) {
            // Direct URL — fetch it
            urlToFetch = trimmedQuery;
        } else {
            // Search query — use DuckDuckGo by default
            urlToFetch = buildSearchUrl([trimmedQuery], 'DuckDuckGo');
        }

        const results = await fetchLinkContent(urlToFetch, {
            maxDepth: 0, // Single page only — AI controls recursion via subsequent tool calls
            cacheTimeToLiveMs: 5 * 60 * 1000,
            fetchMode: 'full',
            includeImages: false,
        });

        const validResults = results.filter(r => !r.error && r.content.length > 0);

        if (validResults.length === 0) {
            const errorMsg = results[0]?.error || 'No content retrieved';
            return {
                toolType: 'search',
                args: query,
                content: `[Error: ${errorMsg}]`,
                metadata: { searchQuery: query, sourceUrls: [urlToFetch] },
            };
        }

        // Return raw content from the first valid result
        const result = validResults[0];

        return {
            toolType: 'search',
            args: query,
            content: result.content,
            metadata: {
                searchQuery: query,
                sourceUrls: [result.url],
            },
        };
    } catch (e) {
        console.warn('Search execution failed:', e);
        return {
            toolType: 'search',
            args: query,
            content: `[Error: Search failed - ${(e as Error).message}]`,
            metadata: { searchQuery: query },
        };
    }
}

function executeCalc(expression: string): ToolResult {
    if (!expression.trim()) {
        return {
            toolType: 'calc',
            args: expression,
            content: '[Error: Empty expression]',
            metadata: { expression },
        };
    }

    try {
        const sanitized = expression.trim();

        // Validate: only allow safe characters
        if (!/^[\d\s+\-*/().,%^eE]+$/.test(sanitized)) {
            return {
                toolType: 'calc',
                args: expression,
                content: '[Error: Invalid characters in expression]',
                metadata: { expression },
            };
        }

        // Replace ^ with ** for exponentiation
        const evaluable = sanitized.replace(/\^/g, '**');

        // Use Function constructor for safer evaluation than eval()
        const result = new Function(`"use strict"; return (${evaluable})`)();

        if (typeof result !== 'number' || !Number.isFinite(result)) {
            return {
                toolType: 'calc',
                args: expression,
                content: '[Error: Expression did not produce a valid number]',
                metadata: { expression },
            };
        }

        // Format: remove trailing zeros, limit decimal places
        const formatted = Number.isInteger(result)
            ? result.toString()
            : Number.parseFloat(result.toFixed(10)).toString();

        return {
            toolType: 'calc',
            args: expression,
            content: formatted,
            metadata: { expression },
        };
    } catch (e) {
        console.warn('Calc execution failed:', e);
        return {
            toolType: 'calc',
            args: expression,
            content: `[Error: Calculation failed - ${(e as Error).message}]`,
            metadata: { expression },
        };
    }
}