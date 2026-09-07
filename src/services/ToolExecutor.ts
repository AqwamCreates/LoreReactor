// src/services/ToolExecutor.ts

import type { ToolInvocation } from '../services/ToolInvocationParser';
import { fetchLinkContent, buildSearchUrl } from '../services/linkFetcher';

export interface ToolResult {
    /** The tool type that produced this result */
    toolType: string;
    /** The original arguments passed to the tool */
    args: string;
    /** The raw text result to inject back into the prompt for the next generation round */
    content: string;
    /** Formatted replacement string for display in the final message textContent */
    displayReplacement: string;
}

/**
 * Execute a tool invocation and return the result.
 */
export async function executeTool(invocation: ToolInvocation): Promise<ToolResult> {
    switch (invocation.toolType) {
        case 'search':
            return executeSearch(invocation.args);
        case 'calculator':
            return executeCalculator(invocation.args);
        default: {
            console.warn(`Unknown tool type: ${invocation.toolType}`);
            const errorContent = `[Error: Unknown tool "${invocation.toolType}"]`;
            return {
                toolType: invocation.toolType,
                args: invocation.args,
                content: errorContent,
                displayReplacement: errorContent,
            };
            }
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
        const errorContent = '[Error: Empty search query]';
        return {
            toolType: 'search',
            args: query,
            content: errorContent,
            displayReplacement: errorContent,
        };
    }

    try {
        let urlToFetch: string;
        const trimmedQuery = query.trim();

        if (/^https?:\/\//i.test(trimmedQuery)) {
            urlToFetch = trimmedQuery;
        } else {
            urlToFetch = buildSearchUrl([trimmedQuery], 'DuckDuckGo');
        }

        const results = await fetchLinkContent(urlToFetch, {
            maxDepth: 0,
            cacheTimeToLiveMs: 5 * 60 * 1000,
            fetchMode: 'full',
            includeImages: false,
        });

        const validResults = results.filter(r => !r.error && r.content.length > 0);

        if (validResults.length === 0) {
            const errorMsg = results[0]?.error || 'No content retrieved';
            const errorContent = `[Error: ${errorMsg}]`;
            return {
                toolType: 'search',
                args: query,
                content: errorContent,
                displayReplacement: `[🔍 Searched: "${trimmedQuery}"]\n\n${errorContent}`,
            };
        }

        const result = validResults[0];

        return {
            toolType: 'search',
            args: query,
            content: result.content,
            displayReplacement: `[🔍 Searched: "${trimmedQuery}"]\n\n${result.content}`,
        };
    } catch (e) {
        console.warn('Search execution failed:', e);
        const errorContent = `[Error: Search failed - ${(e as Error).message}]`;
        return {
            toolType: 'search',
            args: query,
            content: errorContent,
            displayReplacement: `[🔍 Searched: "${query.trim()}"]\n\n${errorContent}`,
        };
    }
}

function executeCalculator(expression: string): ToolResult {
    if (!expression.trim()) {
        const errorContent = '[Error: Empty expression]';
        return {
            toolType: 'calculator',
            args: expression,
            content: errorContent,
            displayReplacement: errorContent,
        };
    }

    try {
        const sanitized = expression.trim();

        // Allow digits, operators, parentheses, decimal points, whitespace,
        // and scientific notation (e/E followed by optional +/- and digits)
        if (!/^[\d\s+\-*/().,%^eE]+$/.test(sanitized)) {
            const errorContent = '[Error: Invalid characters in expression]';
            return {
                toolType: 'calculator',
                args: expression,
                content: errorContent,
                displayReplacement: errorContent,
            };
        }

        // Validate scientific notation is well-formed: e/E must be followed by optional sign and digits only
        if (/[eE](?![+-]?\d)/.test(sanitized)) {
            const errorContent = '[Error: Malformed scientific notation in expression]';
            return {
                toolType: 'calculator',
                args: expression,
                content: errorContent,
                displayReplacement: errorContent,
            };
        }

        // Replace ^ with ** for exponentiation
        const evaluable = sanitized.replace(/\^/g, '**');

        // Safety check: only allow known-safe tokens after transformation
        if (!/^[\d\s+\-*/().,%*eE]+$/.test(evaluable)) {
            const errorContent = '[Error: Expression contains disallowed constructs]';
            return {
                toolType: 'calculator',
                args: expression,
                content: errorContent,
                displayReplacement: errorContent,
            };
        }

        const result = new Function(`"use strict"; return (${evaluable})`)();

        if (typeof result !== 'number' || !Number.isFinite(result)) {
            const errorContent = '[Error: Expression did not produce a valid number]';
            return {
                toolType: 'calculator',
                args: expression,
                content: errorContent,
                displayReplacement: errorContent,
            };
        }

        const formatted = Number.isInteger(result)
            ? result.toString()
            : Number.parseFloat(result.toFixed(10)).toString();

        return {
            toolType: 'calculator',
            args: expression,
            content: formatted,
            displayReplacement: formatted,
        };
    } catch (e) {
        console.warn('Calculator execution failed:', e);
        const errorContent = `[Error: Calculation failed - ${(e as Error).message}]`;
        return {
            toolType: 'calculator',
            args: expression,
            content: errorContent,
            displayReplacement: errorContent,
        };
    }
}