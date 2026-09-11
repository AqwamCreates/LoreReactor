// src/services/ToolExecutor.ts

import type { ToolInvocation } from '../services/ToolInvocationParser';
import { fetchLinkContent, buildSearchUrl } from '../services/linkFetcher';

export interface ToolResult {
    toolType: string;
    args: string;
    content: string;
    displayReplacement: string;
}

export async function executeTool(invocation: ToolInvocation): Promise<ToolResult> {
    switch (invocation.toolType) {
        case 'search':
            return executeSearch(invocation.args);
        case 'calculator':
            return executeCalculator(invocation.args);
        case 'roll':
            return executeDiceRoll(invocation.args);
        case 'pick':
            return executeRandomPick(invocation.args);
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

export async function executeTools(invocations: ToolInvocation[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const invocation of invocations) {
        const result = await executeTool(invocation);
        results.push(result);
    }
    return results;
}

// ─── Search ──────────────────────────────────────────────────────────

async function executeSearch(query: string): Promise<ToolResult> {
    if (!query.trim()) {
        const errorContent = '[Error: Empty search query]';
        return { toolType: 'search', args: query, content: errorContent, displayReplacement: errorContent };
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

// ─── Calculator ──────────────────────────────────────────────────────

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

// ─── Dice Roll ───────────────────────────────────────────────────────

interface DiceGroup {
    count: number;
    sides: number;
}

function parseDiceExpression(expr: string): { groups: DiceGroup[]; modifier: number; rolls: number[]; total: number } | null {
    const sanitized = expr.trim().toLowerCase().replace(/\s+/g, '');
    if (!sanitized) return null;

    const diceGroupRegex = /(\d*)d(\d+)/gi;
    const groups: DiceGroup[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = diceGroupRegex.exec(sanitized)) !== null) {
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

    const diceSum = allRolls.reduce((sum, r) => sum + r, 0);
    const total = diceSum + modifier;

    return { groups, modifier, rolls: allRolls, total };
}

function executeDiceRoll(expression: string): ToolResult {
    if (!expression.trim()) {
        const errorContent = '[Error: Empty dice expression. Use format like "2d6", "1d20+5", "d8"]';
        return { toolType: 'roll', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    const result = parseDiceExpression(expression.trim());

    if (!result) {
        const errorContent = `[Error: Invalid dice notation "${expression.trim()}". Use format like "2d6", "1d20+5", "d8"]`;
        return { toolType: 'roll', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    const rollsStr = result.rolls.join(', ');
    const modStr = result.modifier > 0 ? ` + ${result.modifier}` : result.modifier < 0 ? ` - ${Math.abs(result.modifier)}` : '';

    // Build label from groups
    const label = result.groups.length === 1
        ? `${result.groups[0].count}d${result.groups[0].sides}`
        : result.groups.map(g => `${g.count}d${g.sides}`).join(' + ');

    const content = `${result.total}`;
    const displayReplacement = `[🎲 ${label}${modStr} → [${rollsStr}] = ${result.total}]`;

    return { toolType: 'roll', args: expression, content, displayReplacement };
}

// ─── Random Pick ─────────────────────────────────────────────────────

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