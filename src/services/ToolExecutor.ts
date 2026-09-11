// src/services/ToolExecutor.ts

import type { ToolInvocation } from '../services/ToolInvocationParser';
import { fetchLinkContent, buildSearchUrl } from '../services/linkFetcher';
import type { BaseMessage, InteractionData, Inventory } from '../types';
import { findPreviousMessage } from '../hooks/chatLogic';
import { getAudioEngine } from './AudioEngine';

export interface ToolResult {
    toolType: string;
    args: string;
    content: string;
    displayReplacement: string;
}

const toolFunctions: Record<string, (args: string, nextMessage: BaseMessage, interactionData: InteractionData) => ToolResult | Promise<ToolResult>> = {
    "pick": executeRandomPick,
    "date": executeDate,
    "coin": executeCoinFlip,
    "dice": executeDiceRoll,
    "random": executeRandom,
    "calculator": executeCalculator,
    "web": executeWeb,
    "audio": executeAudio,
    "inventory": executeInventory,
};

export async function executeTool(invocation: ToolInvocation, nextMessage: BaseMessage, interactionData: InteractionData): Promise<ToolResult> {
    const toolType = invocation.toolType;
    const args = invocation.args;
    const executeFunction = toolFunctions[toolType as string];

    if (executeFunction) return executeFunction(args, nextMessage, interactionData);

    console.warn(`Unknown tool type: ${toolType}`);
    const errorContent = `[Error: Unknown tool "${toolType}"]`;
    return {
        toolType: toolType,
        args: args,
        content: errorContent,
        displayReplacement: errorContent,
    };
}

export async function executeTools(invocations: ToolInvocation[], nextMessage: BaseMessage, interactionData: InteractionData): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const invocation of invocations) {
        const result = await executeTool(invocation, nextMessage, interactionData);
        results.push(result);
    }
    return results;
}

// ─── Random Pick ────────────────────────────────────────────────────

function executeRandomPick(expression: string, _nextMessage: BaseMessage, _interactionData: InteractionData): ToolResult {
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

function executeDate(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData): ToolResult {
    const now = new Date();
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

function executeCoinFlip(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData): ToolResult {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';

    return {
        toolType: 'coin',
        args,
        content: result,
        displayReplacement: `[🪙 Coin flip: ${result}]`,
    };
}

// ─── Roll Dice ──────────────────────────────────────────────────────

interface RollGroup {
    count: number;
    sides: number;
}

function executeDiceRoll(expression: string, _nextMessage: BaseMessage, _interactionData: InteractionData): ToolResult {
    if (!expression.trim()) {
        const errorContent = '[Error: Empty dice expression. Use format like "2d6", "1d20+5", "d8"]';
        return { toolType: 'dice', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    const result = parseRollExpression(expression.trim());

    if (!result) {
        const errorContent = `[Error: Invalid dice notation "${expression.trim()}". Use format like "2d6", "1d20+5", "d8"]`;
        return { toolType: 'dice', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    const rollsStr = result.rolls.join(', ');
    const modStr = result.modifier > 0 ? ` + ${result.modifier}` : result.modifier < 0 ? ` - ${Math.abs(result.modifier)}` : '';

    const label = result.groups.length === 1
        ? `${result.groups[0].count}d${result.groups[0].sides}`
        : result.groups.map(g => `${g.count}d${g.sides}`).join(' + ');

    const content = `${result.total}`;
    const displayReplacement = `[🎲 ${label}${modStr} → [${rollsStr}] = ${result.total}]`;

    return { toolType: 'dice', args: expression, content, displayReplacement };
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

// ─── Random Number ───────────────────────────────────────────────────

function executeRandom(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty range. Use format like "1-100" or "1-6"]';
        return { toolType: 'random', args, content: errorContent, displayReplacement: errorContent };
    }

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

// ─── Calculator ─────────────────────────────────────────────────────

function executeCalculator(expression: string, _nextMessage: BaseMessage, _interactionData: InteractionData): ToolResult {
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

// ─── Web (Search + Fetch) ────────────────────────────────────────────

async function executeWeb(query: string, _nextMessage: BaseMessage, _interactionData: InteractionData): Promise<ToolResult> {
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

// ─── Audio ──────────────────────────────────────────────────────────

function executeAudio(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty audio command. Use "audio play <track name>" or "audio stop <track name>"]';
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const trackName = parts.slice(1).join(' ');

    if (!trackName) {
        const errorContent = `[Error: Usage: audio ${subcommand || 'play'} <track name>]`;
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    if (subcommand !== 'play' && subcommand !== 'stop') {
        const errorContent = `[Error: Unknown audio command "${subcommand}". Use play or stop.]`;
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    // Find the matching audio track by name
    const track = interactionData.audioTracks?.find(t => t.name.toLowerCase() === trackName.toLowerCase());
    if (!track) {
        const errorContent = `[Error: Audio track "${trackName}" not found]`;
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    // Check playableByParticipant
    if (!track.playableByParticipant) {
        const errorContent = `[Error: Track "${trackName}" cannot be controlled by participants]`;
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    // Check character bindings
    if (track.characterBindings && track.characterBindings.length > 0) {
        if (!track.characterBindings.includes(nextMessage.character.id)) {
            const errorContent = `[Error: Track "${trackName}" is not bound to this character]`;
            return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
        }
    }

    // Check location bindings
    if (track.locationBindings && track.locationBindings.length > 0) {
        let currentLocationIndex: number | undefined;
        for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
            if (interactionData.interactionHistory[i].locationIndex !== undefined) {
                currentLocationIndex = interactionData.interactionHistory[i].locationIndex;
                break;
            }
        }
        if (currentLocationIndex === undefined) {
            const errorContent = `[Error: No active location for track "${trackName}"]`;
            return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
        }
        const currentLocation = interactionData.locations?.[currentLocationIndex];
        if (!currentLocation || !track.locationBindings.includes(currentLocation.id)) {
            const errorContent = `[Error: Track "${trackName}" is not bound to current location]`;
            return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
        }
    }

    // Check context bindings
    if (track.contextBindings && track.contextBindings.length > 0) {
        const activeContextIds = new Set(interactionData.contexts?.map(c => c.id) ?? []);
        const hasMatchingContext = track.contextBindings.some(ctxId => activeContextIds.has(ctxId));
        if (!hasMatchingContext) {
            const errorContent = `[Error: Track "${trackName}" has no matching active context]`;
            return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
        }
    }

    // All checks passed — play or stop directly
    const audioEngine = getAudioEngine();
    if (subcommand === 'play') {
        audioEngine.startTrack(track);
        return {
            toolType: 'audio',
            args,
            content: `Playing "${trackName}"`,
            displayReplacement: `[🔊 Playing "${trackName}"]`,
        };
    } else {
        audioEngine.stopTrack(track.id);
        return {
            toolType: 'audio',
            args,
            content: `Stopped "${trackName}"`,
            displayReplacement: `[🔇 Stopped "${trackName}"]`,
        };
    }
}

// ─── Inventory ──────────────────────────────────────────────────────

function executeInventory(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty inventory command. Use "inventory list", "inventory add <item> <qty>", "inventory remove <item> <qty>", or "inventory set <item> <value>"]';
        return { toolType: 'inventory', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    // Carry forward previous inventory state
    const currentMessage = findPreviousMessage(interactionData, nextMessage.character.id);
    const inventory: Inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};

    switch (subcommand) {
        case 'list': {
            return {
                toolType: 'inventory',
                args,
                content: '[Inventory listed in prompt context]',
                displayReplacement: '[📦 Inventory listed above]',
            };
        }

        case 'add': {
            if (parts.length < 3) {
                const errorContent = '[Error: Usage: inventory add <item> <quantity>]';
                return { toolType: 'inventory', args, content: errorContent, displayReplacement: errorContent };
            }
            const item = parts.slice(1, -1).join(' ');
            const qty = Number(parts[parts.length - 1]);
            if (!item || isNaN(qty) || qty <= 0) {
                const errorContent = '[Error: Invalid item or quantity. Usage: inventory add <item> <positive number>]';
                return { toolType: 'inventory', args, content: errorContent, displayReplacement: errorContent };
            }
            const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0;
            inventory[item] = current + qty;
            nextMessage.inventory = inventory;
            return {
                toolType: 'inventory',
                args,
                content: `Added ${qty}x "${item}"`,
                displayReplacement: `[📦 Added ${qty}x "${item}"]`,
            };
        }

        case 'remove': {
            if (parts.length < 3) {
                const errorContent = '[Error: Usage: inventory remove <item> <quantity>]';
                return { toolType: 'inventory', args, content: errorContent, displayReplacement: errorContent };
            }
            const item = parts.slice(1, -1).join(' ');
            const qty = Number(parts[parts.length - 1]);
            if (!item || isNaN(qty) || qty <= 0) {
                const errorContent = '[Error: Invalid item or quantity. Usage: inventory remove <item> <positive number>]';
                return { toolType: 'inventory', args, content: errorContent, displayReplacement: errorContent };
            }
            const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0;
            const newValue = current - qty;
            if (newValue <= 0) {
                delete inventory[item];
            } else {
                inventory[item] = newValue;
            }
            nextMessage.inventory = inventory;
            return {
                toolType: 'inventory',
                args,
                content: `Removed ${qty}x "${item}"`,
                displayReplacement: `[📦 Removed ${qty}x "${item}"]`,
            };
        }

        case 'set': {
            if (parts.length < 3) {
                const errorContent = '[Error: Usage: inventory set <item> <value>]';
                return { toolType: 'inventory', args, content: errorContent, displayReplacement: errorContent };
            }
            const item = parts.slice(1, -1).join(' ');
            const rawValue = parts[parts.length - 1];
            if (!item) {
                const errorContent = '[Error: Invalid item name. Usage: inventory set <item> <value>]';
                return { toolType: 'inventory', args, content: errorContent, displayReplacement: errorContent };
            }
            const numValue = Number(rawValue);
            inventory[item] = !isNaN(numValue) ? numValue : rawValue;
            nextMessage.inventory = inventory;
            return {
                toolType: 'inventory',
                args,
                content: `Set "${item}" to ${typeof inventory[item] === 'number' ? inventory[item] : `"${inventory[item]}"`}`,
                displayReplacement: `[📦 Set "${item}" = ${typeof inventory[item] === 'number' ? inventory[item] : `"${inventory[item]}"`}]`,
            };
        }

        default: {
            const errorContent = `[Error: Unknown inventory command "${subcommand}". Use list, add, remove, or set.]`;
            return { toolType: 'inventory', args, content: errorContent, displayReplacement: errorContent };
        }
    }
}