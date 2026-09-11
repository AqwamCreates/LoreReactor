// src/services/ToolExecutor.ts

import type { ToolInvocation } from '../services/ToolInvocationParser';
import { fetchLinkContent, buildSearchUrl } from '../services/linkFetcher';

export interface ToolResult {
    toolType: string;
    args: string;
    content: string;
    displayReplacement: string;
}

const toolFunctions: Record<string, (args: string) => ToolResult | Promise<ToolResult>> = {

    "pick": executeRandomPick,
    "date": executeDate,
    "coin": executeCoinflip,
    "dice": executeDiceRoll,
    "random": executeCalculator,
    "calculator": executeRandom,
    "web": executeWeb,

}

export async function executeTool(invocation: ToolInvocation): Promise<ToolResult> {
    const executeFunction = toolFunctions[invocation.toolType as string] 
    
    if (!executeFunction){

        console.warn(`Unknown tool type: ${invocation.toolType}`);
            const errorContent = `[Error: Unknown tool "${invocation.toolType}"]`;
            return {
                toolType: invocation.toolType,
                args: invocation.args,
                content: errorContent,
                displayReplacement: errorContent,
            };

    }
    
    return executeFunction(invocation.args)
    
}

export async function executeTools(invocations: ToolInvocation[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const invocation of invocations) {
        const result = await executeTool(invocation);
        results.push(result);
    }
    return results;
}

// ─── Web (Search + Fetch) ────────────────────────────────────────────

async function executeWeb(query: string): Promise<ToolResult> {
    if (!query.trim()) {
        const errorContent = '[Error: Empty web query]';
        return { toolType: 'web', args: query, content: errorContent, displayReplacement: errorContent };
    }

    try {
        let urlToFetch: string;
        const trimmedQuery = query.trim();
        const isDirectUrl = /^https?:\/\//i.test(trimmedQuery);

        if (isDirectUrl) {
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
            const label = isDirectUrl ? `Fetched: "${trimmedQuery}"` : `Searched: "${trimmedQuery}"`;
            return {
                toolType: 'web',
                args: query,
                content: errorContent,
                displayReplacement: `[🌐 ${label}]\n\n${errorContent}`,
            };
        }

        const result = validResults[0];
        const label = isDirectUrl ? `Fetched: "${trimmedQuery}"` : `Searched: "${trimmedQuery}"`;

        return {
            toolType: 'web',
            args: query,
            content: result.content,
            displayReplacement: `[🌐 ${label}]\n\n${result.content}`,
        };
    } catch (e) {
        console.warn('Web execution failed:', e);
        const errorContent = `[Error: Web request failed - ${(e as Error).message}]`;
        const isDirectUrl = /^https?:\/\//i.test(query.trim());
        const label = isDirectUrl ? `Fetched: "${query.trim()}"` : `Searched: "${query.trim()}"`;
        return {
            toolType: 'web',
            args: query,
            content: errorContent,
            displayReplacement: `[🌐 ${label}]\n\n${errorContent}`,
        };
    }
}

// ─── Calculator ─────────────────────────────────────────────────────

function executeCalculator(expression: string): ToolResult {
    if (!expression.trim()) {
        const errorContent = '[Error: Empty expression]';
        return { toolType: 'calculator', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    try {
        const sanitized = expression.trim();

        if (!/^[\d\s+\-*/().,%^eE]+$/.test(sanitized)) {
            const errorContent = '[Error: Invalid characters in expression]';
            return { toolType: 'calculator', args: expression, content: errorContent, displayReplacement: errorContent };
        }

        if (/[eE](?![+-]?\d)/.test(sanitized)) {
            const errorContent = '[Error: Malformed scientific notation in expression]';
            return { toolType: 'calculator', args: expression, content: errorContent, displayReplacement: errorContent };
        }

        const evaluable = sanitized.replace(/\^/g, '**');

        if (!/^[\d\s+\-*/().,%*eE]+$/.test(evaluable)) {
            const errorContent = '[Error: Expression contains disallowed constructs]';
            return { toolType: 'calculator', args: expression, content: errorContent, displayReplacement: errorContent };
        }

        const result = new Function(`"use strict"; return (${evaluable})`)();

        if (typeof result !== 'number' || !Number.isFinite(result)) {
            const errorContent = '[Error: Expression did not produce a valid number]';
            return { toolType: 'calculator', args: expression, content: errorContent, displayReplacement: errorContent };
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
        return { toolType: 'calculator', args: expression, content: errorContent, displayReplacement: errorContent };
    }
}

// ─── Dice Dice ──────────────────────────────────────────────────────

interface RollGroup {
    count: number;
    sides: number;
}

function parseRollExpression(expr: string): { groups: RollGroup[]; modifier: number; rolls: number[]; total: number } | null {
    const sanitized = expr.trim().toLowerCase().replace(/\s+/g, '');
    if (!sanitized) return null;

    const rollGroupRegex = /(\d*)d(\d+)/gi;
    const groups: RollGroup[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = rollGroupRegex.exec(sanitized)) !== null) {
        const count = match[1] ? parseInt(match[1], 10) : 1;
        const sides = parseInt(match[2], 10);

        if (count < 1 || count > 100 || sides < 1 || sides > 1000) return null;

        groups.push({ count, sides });
        lastIndex = match.index + match[0].length;
    }

    if (groups.length === 0) return null;

    let modifier = 0;
    const remainder = sanitized.slice(lastIndex);
    if (remainder) {
        const modMatch = remainder.match(/^([+-])(\d+)$/);
        if (!modMatch) return null;
        modifier = parseInt(modMatch[2], 10);
        if (modMatch[1] === '-') modifier = -modifier;
    }

    const allRolls: number[] = [];
    for (const group of groups) {
        for (let i = 0; i < group.count; i++) {
            allRolls.push(Math.floor(Math.random() * group.sides) + 1);
        }
    }

    const rollSum = allRolls.reduce((sum, r) => sum + r, 0);
    const total = rollSum + modifier;

    return { groups, modifier, rolls: allRolls, total };
}

function executeDiceRoll(expression: string): ToolResult {
    if (!expression.trim()) {
        const errorContent = '[Error: Empty Dice expression. Use format like "2d6", "1d20+5", "d8"]';
        return { toolType: 'Dice', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    const result = parseRollExpression(expression.trim());

    if (!result) {
        const errorContent = `[Error: Invalid Dice notation "${expression.trim()}". Use format like "2d6", "1d20+5", "d8"]`;
        return { toolType: 'Dice', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    const rollsStr = result.rolls.join(', ');
    const modStr = result.modifier > 0 ? ` + ${result.modifier}` : result.modifier < 0 ? ` - ${Math.abs(result.modifier)}` : '';

    const label = result.groups.length === 1
        ? `${result.groups[0].count}d${result.groups[0].sides}`
        : result.groups.map(g => `${g.count}d${g.sides}`).join(' + ');

    const content = `${result.total}`;
    const displayReplacement = `[🎲 ${label}${modStr} → [${rollsStr}] = ${result.total}]`;

    return { toolType: 'Dice', args: expression, content, displayReplacement };
}

// ─── Random Pick ────────────────────────────────────────────────────

function executeRandomPick(expression: string): ToolResult {
    if (!expression.trim()) {
        const errorContent = '[Error: Empty pick list. Use format like "pick: option1, option2, option3"]';
        return { toolType: 'pick', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    const options = expression
        .split(',')
        .map(o => o.trim())
        .filter(o => o.length > 0);

    if (options.length === 0) {
        const errorContent = '[Error: No valid options provided. Separate options with commas.]';
        return { toolType: 'pick', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    if (options.length === 1) {
        return {
            toolType: 'pick',
            args: expression,
            content: options[0],
            displayReplacement: `[🎯 Only one option: "${options[0]}"]`,
        };
    }

    const index = Math.floor(Math.random() * options.length);
    const picked = options[index];

    return {
        toolType: 'pick',
        args: expression,
        content: picked,
        displayReplacement: `[🎯 Picked (${index + 1}/${options.length}): "${picked}"]`,
    };
}

// ─── Date ────────────────────────────────────────────────────────────

function executeDate(args: string): ToolResult {
    const now = new Date();

    // If args specify a timezone offset or format, respect it
    // Otherwise use local time
    const trimmed = args.trim().toLowerCase();

    let dateStr: string;

    if (trimmed === 'iso') {
        dateStr = now.toISOString();
    } else if (trimmed === 'unix' || trimmed === 'timestamp') {
        dateStr = Math.floor(now.getTime() / 1000).toString();
    } else if (trimmed === 'time') {
        dateStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (trimmed === 'date') {
        dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } else {
        // Default: full human-readable
        dateStr = now.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });
    }

    return {
        toolType: 'date',
        args,
        content: dateStr,
        displayReplacement: `[📅 ${dateStr}]`,
    };
}

// ─── Coin Flip ───────────────────────────────────────────────────────

function executeCoinflip(_args: string): ToolResult {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';

    return {
        toolType: 'coinflip',
        args: _args,
        content: result,
        displayReplacement: `[🪙 Coin flip: ${result}]`,
    };
}

// ─── Random Number ───────────────────────────────────────────────────

function executeRandom(args: string): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty range. Use format like "1-100" or "1-6"]';
        return { toolType: 'random', args, content: errorContent, displayReplacement: errorContent };
    }

    // Parse "min-max" or "min to max" or just "max" (defaults min to 1)
    let min: number;
    let max: number;

    const dashMatch = trimmed.match(/^(-?\d+)\s*[-–—]\s*(-?\d+)$/);
    const toMatch = trimmed.match(/^(-?\d+)\s+to\s+(-?\d+)$/i);

    if (dashMatch) {
        min = parseInt(dashMatch[1], 10);
        max = parseInt(dashMatch[2], 10);
    } else if (toMatch) {
        min = parseInt(toMatch[1], 10);
        max = parseInt(toMatch[2], 10);
    } else {
        // Single number — treat as 1 to N
        const single = parseInt(trimmed, 10);
        if (isNaN(single) || single < 1) {
            const errorContent = `[Error: Invalid range "${trimmed}". Use format like "1-100" or "1-6"]`;
            return { toolType: 'random', args, content: errorContent, displayReplacement: errorContent };
        }
        min = 1;
        max = single;
    }

    if (min > max) {
        [min, max] = [max, min];
    }

    const result = Math.floor(Math.random() * (max - min + 1)) + min;

    return {
        toolType: 'random',
        args,
        content: result.toString(),
        displayReplacement: `[🎲 Random(${min}-${max}): ${result}]`,
    };
}