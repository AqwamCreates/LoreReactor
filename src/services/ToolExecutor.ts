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
    "rng": executeRng,
    "timer": executeTimer,
    "stopwatch": executeStopwatch,
    "calculator": executeCalculator,
    "web": executeWeb,
    "lookup": executeLookup,
    "map": executeMap,
    "audio": executeAudio,
    "note": executeNote,
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

// ─── RNG Table ─────────────────────────────────────────────────────

function executeRng(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty RNG table query. Use "rng <table name>" to roll on a named table defined in contexts.]';
        return { toolType: 'rng', args, content: errorContent, displayReplacement: errorContent };
    }

    // Find a context whose name matches the table name (case-insensitive)
    const tableName = trimmed.toLowerCase();
    const tableContext = (interactionData.contexts || []).find(c =>
        c.name?.toLowerCase() === tableName && c.text
    );

    if (!tableContext || !tableContext.text) {
        const errorContent = `[Error: RNG table "${trimmed}" not found. Create a context with the table name and entries formatted as "1-10: outcome text" per line.]`;
        return { toolType: 'rng', args, content: errorContent, displayReplacement: errorContent };
    }

    // Parse table entries: lines matching "min-max: result" or "number: result"
    const lines = tableContext.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const entries: { min: number; max: number; result: string }[] = [];
    let globalMax = 0;

    for (const line of lines) {
        const rangeMatch = line.match(/^(\d+)\s*[-–]\s*(\d+)\s*[:=]\s*(.+)$/);
        const singleMatch = line.match(/^(\d+)\s*[:=]\s*(.+)$/);

        if (rangeMatch) {
            const min = parseInt(rangeMatch[1], 10);
            const max = parseInt(rangeMatch[2], 10);
            const result = rangeMatch[3].trim();
            entries.push({ min, max, result });
            if (max > globalMax) globalMax = max;
        } else if (singleMatch) {
            const val = parseInt(singleMatch[1], 10);
            const result = singleMatch[2].trim();
            entries.push({ min: val, max: val, result });
            if (val > globalMax) globalMax = val;
        }
    }

    if (entries.length === 0) {
        const errorContent = `[Error: Table "${trimmed}" has no valid entries. Format each line as "1-10: outcome" or "5: outcome".]`;
        return { toolType: 'rng', args, content: errorContent, displayReplacement: errorContent };
    }

    const roll = Math.floor(Math.random() * globalMax) + 1;
    const matchedEntry = entries.find(e => roll >= e.min && roll <= e.max);

    if (!matchedEntry) {
        return {
            toolType: 'rng',
            args,
            content: `Rolled ${roll} on "${tableContext.name}" — no entry covers this range.`,
            displayReplacement: `[🎲 ${tableContext.name}: rolled ${roll}, no match]`,
        };
    }

    return {
        toolType: 'rng',
        args,
        content: matchedEntry.result,
        displayReplacement: `[🎲 ${tableContext.name}: rolled ${roll} → ${matchedEntry.result}]`,
    };
}

// ─── Timer / Stopwatch Helpers ──────────────────────────────────────

interface TimerEntry { name: string; targetTimestamp: number }
interface StopwatchEntry { name: string; startTimestamp: number; pausedElapsedMs?: number }

function parseDurationToMs(input: string): number | null {
    const trimmed = input.trim().toLowerCase();
    let totalMs = 0;
    let matched = false;

    const hourMatch = trimmed.match(/(\d+)\s*h(?:ours?|r)?/);
    if (hourMatch) { totalMs += parseInt(hourMatch[1], 10) * 3600000; matched = true; }

    const minMatch = trimmed.match(/(\d+)\s*m(?:in(?:utes?|s)?)?/);
    if (minMatch) { totalMs += parseInt(minMatch[1], 10) * 60000; matched = true; }

    const secMatch = trimmed.match(/(\d+)\s*s(?:ec(?:onds?|s)?)?/);
    if (secMatch) { totalMs += parseInt(secMatch[1], 10) * 1000; matched = true; }

    if (!matched) {
        // Try plain number as seconds
        const plainNum = parseInt(trimmed, 10);
        if (!isNaN(plainNum) && plainNum > 0) return plainNum * 1000;
        return null;
    }

    return totalMs > 0 ? totalMs : null;
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
}

function loadTimers(inventory: Inventory | undefined): TimerEntry[] {
    if (!inventory || typeof inventory['__timers__'] !== 'string') return [];
    try { return JSON.parse(inventory['__timers__'] as string); } catch { return []; }
}

function saveTimers(inventory: Inventory, timers: TimerEntry[]): void {
    if (timers.length === 0) { delete inventory['__timers__']; } else { inventory['__timers__'] = JSON.stringify(timers); }
}

function loadStopwatches(inventory: Inventory | undefined): StopwatchEntry[] {
    if (!inventory || typeof inventory['__stopwatches__'] !== 'string') return [];
    try { return JSON.parse(inventory['__stopwatches__'] as string); } catch { return []; }
}

function saveStopwatches(inventory: Inventory, stopwatches: StopwatchEntry[]): void {
    if (stopwatches.length === 0) { delete inventory['__stopwatches__']; } else { inventory['__stopwatches__'] = JSON.stringify(stopwatches); }
}

// ─── Timer ──────────────────────────────────────────────────────────

function executeTimer(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty timer command. Use "timer set <name> <duration>", "timer check [name]", "timer delete <name>", or "timer list"]';
        return { toolType: 'timer', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    const currentMessage = findPreviousMessage(interactionData, nextMessage.character.id);
    const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
    const timers = loadTimers(inventory);
    const now = Date.now();

    switch (subcommand) {
        case 'set': {
            if (parts.length < 3) {
                const errorContent = '[Error: Usage: timer set <name> <duration>. Duration examples: "5m", "1h 30m", "90s"]';
                return { toolType: 'timer', args, content: errorContent, displayReplacement: errorContent };
            }
            const name = parts[1];
            const durationStr = parts.slice(2).join(' ');
            const durationMs = parseDurationToMs(durationStr);
            if (!durationMs) {
                const errorContent = `[Error: Invalid duration "${durationStr}". Use formats like "5m", "1h 30m", "90s".]`;
                return { toolType: 'timer', args, content: errorContent, displayReplacement: errorContent };
            }
            // Remove existing timer with same name
            const filtered = timers.filter(t => t.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, targetTimestamp: now + durationMs });
            saveTimers(inventory, filtered);
            nextMessage.inventory = inventory;
            return {
                toolType: 'timer',
                args,
                content: `Timer "${name}" set for ${formatDuration(durationMs)}.`,
                displayReplacement: `[⏱️ Timer "${name}" set: ${formatDuration(durationMs)}]`,
            };
        }

        case 'check': {
            const specificName = parts.slice(1).join(' ').toLowerCase();
            if (specificName) {
                const timer = timers.find(t => t.name.toLowerCase() === specificName);
                if (!timer) {
                    return { toolType: 'timer', args, content: `No timer named "${specificName}".`, displayReplacement: `[⏱️ No timer: "${specificName}"]` };
                }
                const remaining = timer.targetTimestamp - now;
                if (remaining <= 0) {
                    return { toolType: 'timer', args, content: `Timer "${timer.name}" has EXPIRED.`, displayReplacement: `[⏱️ "${timer.name}": EXPIRED]` };
                }
                return { toolType: 'timer', args, content: `Timer "${timer.name}": ${formatDuration(remaining)} remaining.`, displayReplacement: `[⏱️ "${timer.name}": ${formatDuration(remaining)} left]` };
            }
            // Check all
            if (timers.length === 0) {
                return { toolType: 'timer', args, content: 'No active timers.', displayReplacement: '[⏱️ No active timers]' };
            }
            const statuses = timers.map(t => {
                const remaining = t.targetTimestamp - now;
                return remaining <= 0 ? `${t.name}: EXPIRED` : `${t.name}: ${formatDuration(remaining)} remaining`;
            });
            return { toolType: 'timer', args, content: statuses.join('\n'), displayReplacement: `[⏱️ ${timers.length} timer(s)]` };
        }

        case 'delete': {
            if (parts.length < 2) {
                const errorContent = '[Error: Usage: timer delete <name>]';
                return { toolType: 'timer', args, content: errorContent, displayReplacement: errorContent };
            }
            const name = parts.slice(1).join(' ').toLowerCase();
            const idx = timers.findIndex(t => t.name.toLowerCase() === name);
            if (idx === -1) {
                return { toolType: 'timer', args, content: `No timer named "${name}".`, displayReplacement: `[⏱️ No timer: "${name}"]` };
            }
            const deletedName = timers[idx].name;
            timers.splice(idx, 1);
            saveTimers(inventory, timers);
            nextMessage.inventory = inventory;
            return { toolType: 'timer', args, content: `Timer "${deletedName}" deleted.`, displayReplacement: `[⏱️ Deleted: "${deletedName}"]` };
        }

        case 'list': {
            if (timers.length === 0) {
                return { toolType: 'timer', args, content: 'No active timers.', displayReplacement: '[⏱️ No active timers]' };
            }
            const lines = timers.map(t => {
                const remaining = t.targetTimestamp - now;
                return remaining <= 0 ? `${t.name}: EXPIRED` : `${t.name}: ${formatDuration(remaining)} remaining`;
            });
            return { toolType: 'timer', args, content: lines.join('\n'), displayReplacement: `[⏱️ ${timers.length} timer(s)]` };
        }

        default: {
            const errorContent = `[Error: Unknown timer command "${subcommand}". Use set, check, delete, or list.]`;
            return { toolType: 'timer', args, content: errorContent, displayReplacement: errorContent };
        }
    }
}

// ─── Stopwatch ──────────────────────────────────────────────────────

function executeStopwatch(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty stopwatch command. Use "stopwatch start <name>", "stopwatch stop <name>", "stopwatch pause <name>", "stopwatch resume <name>", "stopwatch check [name]", "stopwatch reset <name>", or "stopwatch list"]';
        return { toolType: 'stopwatch', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    const currentMessage = findPreviousMessage(interactionData, nextMessage.character.id);
    const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
    const stopwatches = loadStopwatches(inventory);
    const now = Date.now();

    switch (subcommand) {
        case 'start': {
            if (parts.length < 2) {
                const errorContent = '[Error: Usage: stopwatch start <name>]';
                return { toolType: 'stopwatch', args, content: errorContent, displayReplacement: errorContent };
            }
            const name = parts.slice(1).join(' ');
            // Remove existing stopwatch with same name
            const filtered = stopwatches.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, startTimestamp: now });
            saveStopwatches(inventory, filtered);
            nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopwatch "${name}" started.`, displayReplacement: `[⏱️ Stopwatch "${name}" started]` };
        }

        case 'pause': {
            if (parts.length < 2) {
                const errorContent = '[Error: Usage: stopwatch pause <name>]';
                return { toolType: 'stopwatch', args, content: errorContent, displayReplacement: errorContent };
            }
            const name = parts.slice(1).join(' ').toLowerCase();
            const sw = stopwatches.find(s => s.name.toLowerCase() === name);
            if (!sw) {
                return { toolType: 'stopwatch', args, content: `No stopwatch named "${name}".`, displayReplacement: `[⏱️ No stopwatch: "${name}"]` };
            }
            if (sw.pausedElapsedMs !== undefined) {
                return { toolType: 'stopwatch', args, content: `Stopwatch "${sw.name}" is already paused.`, displayReplacement: `[⏱️ "${sw.name}" already paused]` };
            }
            sw.pausedElapsedMs = now - sw.startTimestamp;
            saveStopwatches(inventory, stopwatches);
            nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopwatch "${sw.name}" paused at ${formatDuration(sw.pausedElapsedMs)}.`, displayReplacement: `[⏱️ "${sw.name}" paused: ${formatDuration(sw.pausedElapsedMs)}]` };
        }

        case 'resume': {
            if (parts.length < 2) {
                const errorContent = '[Error: Usage: stopwatch resume <name>]';
                return { toolType: 'stopwatch', args, content: errorContent, displayReplacement: errorContent };
            }
            const name = parts.slice(1).join(' ').toLowerCase();
            const sw = stopwatches.find(s => s.name.toLowerCase() === name);
            if (!sw) {
                return { toolType: 'stopwatch', args, content: `No stopwatch named "${name}".`, displayReplacement: `[⏱️ No stopwatch: "${name}"]` };
            }
            if (sw.pausedElapsedMs === undefined) {
                return { toolType: 'stopwatch', args, content: `Stopwatch "${sw.name}" is not paused.`, displayReplacement: `[⏱️ "${sw.name}" not paused]` };
            }
            // Adjust startTimestamp so elapsed stays continuous
            sw.startTimestamp = now - sw.pausedElapsedMs;
            delete sw.pausedElapsedMs;
            saveStopwatches(inventory, stopwatches);
            nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopwatch "${sw.name}" resumed.`, displayReplacement: `[⏱️ "${sw.name}" resumed]` };
        }

        case 'stop': {
            if (parts.length < 2) {
                const errorContent = '[Error: Usage: stopwatch stop <name>]';
                return { toolType: 'stopwatch', args, content: errorContent, displayReplacement: errorContent };
            }
            const name = parts.slice(1).join(' ').toLowerCase();
            const idx = stopwatches.findIndex(s => s.name.toLowerCase() === name);
            if (idx === -1) {
                return { toolType: 'stopwatch', args, content: `No stopwatch named "${name}".`, displayReplacement: `[⏱️ No stopwatch: "${name}"]` };
            }
            const sw = stopwatches[idx];
            const elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
            stopwatches.splice(idx, 1);
            saveStopwatches(inventory, stopwatches);
            nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopwatch "${sw.name}" stopped at ${formatDuration(elapsed)}.`, displayReplacement: `[⏱️ "${sw.name}" stopped: ${formatDuration(elapsed)}]` };
        }

        case 'reset': {
            if (parts.length < 2) {
                const errorContent = '[Error: Usage: stopwatch reset <name>]';
                return { toolType: 'stopwatch', args, content: errorContent, displayReplacement: errorContent };
            }
            const name = parts.slice(1).join(' ').toLowerCase();
            const sw = stopwatches.find(s => s.name.toLowerCase() === name);
            if (!sw) {
                return { toolType: 'stopwatch', args, content: `No stopwatch named "${name}".`, displayReplacement: `[⏱️ No stopwatch: "${name}"]` };
            }
            sw.startTimestamp = now;
            delete sw.pausedElapsedMs;
            saveStopwatches(inventory, stopwatches);
            nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopwatch "${sw.name}" reset.`, displayReplacement: `[⏱️ "${sw.name}" reset]` };
        }

        case 'check': {
            const specificName = parts.slice(1).join(' ').toLowerCase();
            if (specificName) {
                const sw = stopwatches.find(s => s.name.toLowerCase() === specificName);
                if (!sw) {
                    return { toolType: 'stopwatch', args, content: `No stopwatch named "${specificName}".`, displayReplacement: `[⏱️ No stopwatch: "${specificName}"]` };
                }
                const elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
                const status = sw.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING';
                return { toolType: 'stopwatch', args, content: `Stopwatch "${sw.name}": ${formatDuration(elapsed)} (${status})`, displayReplacement: `[⏱️ "${sw.name}": ${formatDuration(elapsed)} ${status}]` };
            }
            if (stopwatches.length === 0) {
                return { toolType: 'stopwatch', args, content: 'No active stopwatches.', displayReplacement: '[⏱️ No active stopwatches]' };
            }
            const statuses = stopwatches.map(s => {
                const elapsed = s.pausedElapsedMs !== undefined ? s.pausedElapsedMs : now - s.startTimestamp;
                const status = s.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING';
                return `${s.name}: ${formatDuration(elapsed)} (${status})`;
            });
            return { toolType: 'stopwatch', args, content: statuses.join('\n'), displayReplacement: `[⏱️ ${stopwatches.length} stopwatch(es)]` };
        }

        case 'list': {
            if (stopwatches.length === 0) {
                return { toolType: 'stopwatch', args, content: 'No active stopwatches.', displayReplacement: '[⏱️ No active stopwatches]' };
            }
            const lines = stopwatches.map(s => {
                const elapsed = s.pausedElapsedMs !== undefined ? s.pausedElapsedMs : now - s.startTimestamp;
                const status = s.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING';
                return `${s.name}: ${formatDuration(elapsed)} (${status})`;
            });
            return { toolType: 'stopwatch', args, content: lines.join('\n'), displayReplacement: `[⏱️ ${stopwatches.length} stopwatch(es)]` };
        }

        default: {
            const errorContent = `[Error: Unknown stopwatch command "${subcommand}". Use start, stop, pause, resume, check, reset, or list.]`;
            return { toolType: 'stopwatch', args, content: errorContent, displayReplacement: errorContent };
        }
    }
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

// ─── Lookup ────────────────────────────────────────────────────────

function executeLookup(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const query = args.trim().toLowerCase();

    if (!query) {
        const errorContent = '[Error: Empty lookup query. Use "lookup <keyword>" to search contexts and lore.]';
        return { toolType: 'lookup', args, content: errorContent, displayReplacement: errorContent };
    }

    const contexts = interactionData.contexts || [];
    const matches: { name: string; snippet: string }[] = [];

    for (const context of contexts) {
        const searchText = `${context.name || ''} ${context.description || ''} ${context.text || ''}`.toLowerCase();
        if (searchText.includes(query)) {
            // Extract a relevant snippet around the match
            const matchIndex = searchText.indexOf(query);
            const start = Math.max(0, matchIndex - 50);
            const end = Math.min(searchText.length, matchIndex + query.length + 100);
            let snippet = (context.text || context.description || '').substring(start, end).trim();
            if (start > 0) snippet = '...' + snippet;
            if (end < searchText.length) snippet = snippet + '...';
            matches.push({ name: context.name || 'Untitled', snippet });
        }
    }

    if (matches.length === 0) {
        return {
            toolType: 'lookup',
            args,
            content: `No context entries found matching "${args.trim()}".`,
            displayReplacement: `[🔍 No results for "${args.trim()}"]`,
        };
    }

    const content = matches.map(m => `[${m.name}] ${m.snippet}`).join('\n\n');
    return {
        toolType: 'lookup',
        args,
        content,
        displayReplacement: `[🔍 Found ${matches.length} result(s) for "${args.trim()}"]`,
    };
}

// ─── Map / Distance ────────────────────────────────────────────────

function executeMap(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty map query. Use "map <location name>" for distance from current location, or "map <loc1> to <loc2>" for distance between two locations.]';
        return { toolType: 'map', args, content: errorContent, displayReplacement: errorContent };
    }

    const locations = interactionData.locations || [];
    if (locations.length === 0) {
        const errorContent = '[Error: No locations available.]';
        return { toolType: 'map', args, content: errorContent, displayReplacement: errorContent };
    }

    // Parse "loc1 to loc2" or just "loc1" (from current location)
    const toMatch = trimmed.match(/^(.+?)\s+to\s+(.+)$/i);
    let fromLoc, toLoc;

    if (toMatch) {
        fromLoc = locations.find(l => l.name.toLowerCase() === toMatch[1].trim().toLowerCase());
        toLoc = locations.find(l => l.name.toLowerCase() === toMatch[2].trim().toLowerCase());
    } else {
        // Find current location
        let currentLocationIndex: number | undefined;
        for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
            if (interactionData.interactionHistory[i].locationIndex !== undefined) {
                currentLocationIndex = interactionData.interactionHistory[i].locationIndex;
                break;
            }
        }
        if (currentLocationIndex !== undefined) {
            fromLoc = locations[currentLocationIndex];
        }
        toLoc = locations.find(l => l.name.toLowerCase() === trimmed.toLowerCase());
    }

    if (!toLoc) {
        const errorContent = `[Error: Location "${trimmed}" not found.]`;
        return { toolType: 'map', args, content: errorContent, displayReplacement: errorContent };
    }

    if (!fromLoc) {
        const errorContent = '[Error: No current location set. Use "map <loc1> to <loc2>" format instead.]';
        return { toolType: 'map', args, content: errorContent, displayReplacement: errorContent };
    }

    if (fromLoc.id === toLoc.id) {
        return {
            toolType: 'map',
            args,
            content: `Already at "${toLoc.name}".`,
            displayReplacement: `[🗺️ Already at "${toLoc.name}"]`,
        };
    }

    // Check direct distance map first
    const directDistance = fromLoc.locationDistances?.[toLoc.id];
    let distanceKm: number;

    if (directDistance !== undefined) {
        distanceKm = directDistance;
    } else {
        // Calculate from lat/lng using Haversine formula
        const R = 6371; // Earth radius in km
        const dLat = (toLoc.latitude - fromLoc.latitude) * Math.PI / 180;
        const dLon = (toLoc.longitude - fromLoc.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(fromLoc.latitude * Math.PI / 180) * Math.cos(toLoc.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distanceKm = R * c;
    }

    const rounded = Math.round(distanceKm * 10) / 10;
    // Rough travel time estimates
    const walkHours = Math.round((distanceKm / 5) * 10) / 10; // ~5 km/h walking
    const rideHours = Math.round((distanceKm / 30) * 10) / 10; // ~30 km/h riding

    const content = `Distance from "${fromLoc.name}" to "${toLoc.name}": ${rounded} km. Estimated travel: ~${walkHours}h walking, ~${rideHours}h riding.`;
    return {
        toolType: 'map',
        args,
        content,
        displayReplacement: `[🗺️ ${fromLoc.name} → ${toLoc.name}: ${rounded} km]`,
    };
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

// ─── Note ──────────────────────────────────────────────────────────

function executeNote(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty note command. Use "note set <key> <text>", "note get <key>", "note delete <key>", or "note list"]';
        return { toolType: 'note', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    // Carry forward previous notes state (stored in inventory under __notes__ key as JSON string)
    const currentMessage = findPreviousMessage(interactionData, nextMessage.character.id);
    let notes: Record<string, string> = {};
    if (currentMessage?.inventory && typeof currentMessage.inventory['__notes__'] === 'string') {
        try { notes = JSON.parse(currentMessage.inventory['__notes__'] as string); } catch { notes = {}; }
    }

    switch (subcommand) {
        case 'list': {
            const entries = Object.entries(notes);
            if (entries.length === 0) {
                return { toolType: 'note', args, content: 'No notes recorded.', displayReplacement: '[📝 No notes]' };
            }
            const formatted = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
            return { toolType: 'note', args, content: formatted, displayReplacement: `[📝 ${entries.length} note(s)]` };
        }

        case 'set': {
            if (parts.length < 3) {
                const errorContent = '[Error: Usage: note set <key> <text>]';
                return { toolType: 'note', args, content: errorContent, displayReplacement: errorContent };
            }
            const key = parts[1];
            const text = parts.slice(2).join(' ');
            if (!key || !text) {
                const errorContent = '[Error: Both key and text are required.]';
                return { toolType: 'note', args, content: errorContent, displayReplacement: errorContent };
            }
            notes[key] = text;
            // Persist notes into inventory
            const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
            inventory['__notes__'] = JSON.stringify(notes);
            nextMessage.inventory = inventory;
            return { toolType: 'note', args, content: `Note "${key}" saved.`, displayReplacement: `[📝 Saved: "${key}"]` };
        }

        case 'get': {
            if (parts.length < 2) {
                const errorContent = '[Error: Usage: note get <key>]';
                return { toolType: 'note', args, content: errorContent, displayReplacement: errorContent };
            }
            const key = parts[1];
            const value = notes[key];
            if (value === undefined) {
                return { toolType: 'note', args, content: `No note found for "${key}".`, displayReplacement: `[📝 Not found: "${key}"]` };
            }
            return { toolType: 'note', args, content: value, displayReplacement: `[📝 ${key}: ${value}]` };
        }

        case 'delete': {
            if (parts.length < 2) {
                const errorContent = '[Error: Usage: note delete <key>]';
                return { toolType: 'note', args, content: errorContent, displayReplacement: errorContent };
            }
            const key = parts[1];
            if (notes[key] === undefined) {
                return { toolType: 'note', args, content: `No note found for "${key}".`, displayReplacement: `[📝 Not found: "${key}"]` };
            }
            delete notes[key];
            const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
            if (Object.keys(notes).length === 0) {
                delete inventory['__notes__'];
            } else {
                inventory['__notes__'] = JSON.stringify(notes);
            }
            nextMessage.inventory = inventory;
            return { toolType: 'note', args, content: `Note "${key}" deleted.`, displayReplacement: `[📝 Deleted: "${key}"]` };
        }

        default: {
            const errorContent = `[Error: Unknown note command "${subcommand}". Use set, get, delete, or list.]`;
            return { toolType: 'note', args, content: errorContent, displayReplacement: errorContent };
        }
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