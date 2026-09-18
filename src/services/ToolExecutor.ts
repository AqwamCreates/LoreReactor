// src/services/ToolExecutor.ts

import type { ToolInvocation } from '../services/ToolInvocationParser';
import { fetchLinkContent, buildSearchUrl } from '../services/linkFetcher';
import type { BaseMessage, Character, Context, Location, AudioTrack, Profile, InteractionData, Inventory, ChatMessage } from '../types';
import { findPreviousMessage } from '../hooks/chatLogic';
import { getAudioEngine } from './AudioEngine';
import { v4 as uuidv4 } from 'uuid';

export interface ToolResult {
    toolType: string;
    args: string;
    content: string;
    displayReplacement: string;
}

export interface ToolExecutionContext {
    allCharacters?: Character[];
    allProfiles?: Profile[];
    allLocations?: Location[];
    allAudioTracks?: AudioTrack[];
    allContexts?: Context[];
    addToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

/**
 * Pending actions stored in nextMessage.inventory['__pending_tool_actions__']
 * for the caller to execute after generation completes.
 */
export interface PendingToolAction {
    type: 'summon' | 'kick' | 'invite' | 'administrator_move_protagonist' | 'administrator_switch_model' | 'creator' | 'destroyer';
    payload: Record<string, string>;
}

export function loadPendingToolActions(inventory: Inventory | undefined): PendingToolAction[] {
    if (!inventory || typeof inventory['__pending_tool_actions__'] !== 'string') return [];
    try { return JSON.parse(inventory['__pending_tool_actions__'] as string); } catch { return []; }
}

export function savePendingToolActions(inventory: Inventory, actions: PendingToolAction[]): void {
    if (actions.length === 0) { delete inventory['__pending_tool_actions__']; } else { inventory['__pending_tool_actions__'] = JSON.stringify(actions); }
}

function appendPendingAction(nextMessage: BaseMessage, action: PendingToolAction): void {
    const inventory = nextMessage.inventory ? { ...nextMessage.inventory } : {};
    const actions = loadPendingToolActions(inventory);
    actions.push(action);
    savePendingToolActions(inventory, actions);
    nextMessage.inventory = inventory;
}

const toolFunctions: Record<string, (args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext) => ToolResult | Promise<ToolResult>> = {
    "pick": executeRandomPick,
    "date": executeDate,
    "coin": executeCoinFlip,
    "dice": executeDiceRoll,
    "random": executeRandom,
    "rng": executeRng,
    "move": executeMove,
    "timer": executeTimer,
    "stopwatch": executeStopwatch,
    "calculator": executeCalculator,
    "web": executeWeb,
    "lookup": executeLookup,
    "map": executeMap,
    "audio": executeAudio,
    "note": executeNote,
    "inventory": executeInventory,
    "invite": executeInvite,
    "kick": executeKick,
    "teleport": executeTeleport,
    "key": executeKey,
    "clothing": executeClothing,
    "summon": executeSummon,
    "narrate": executeNarrate,
    "inspect": executeInspect,
    "administrator": executeAdministrator,
    "creator": executeCreator,
    "destroyer": executeDestroyer,
};

export async function executeTool(invocation: ToolInvocation, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): Promise<ToolResult> {
    const toolType = invocation.toolType;
    const args = invocation.args;
    const executeFunction = toolFunctions[toolType as string];

    if (executeFunction) return executeFunction(args, nextMessage, interactionData, context);

    console.warn(`Unknown tool type: ${toolType}`);
    const errorContent = `[Error: Unknown tool "${toolType}"]`;
    return {
        toolType: toolType,
        args: args,
        content: errorContent,
        displayReplacement: errorContent,
    };
}

export async function executeTools(invocations: ToolInvocation[], nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const invocation of invocations) {
        const result = await executeTool(invocation, nextMessage, interactionData, context);
        results.push(result);
    }
    return results;
}

// ─── Random Pick ────────────────────────────────────────────────────

function executeRandomPick(expression: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
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

function executeDate(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
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

function executeCoinFlip(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
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

function executeDiceRoll(expression: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
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

function executeRandom(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
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

function executeRng(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty RNG table query. Use "rng <table name>" to roll on a named table defined in contexts.]';
        return { toolType: 'rng', args, content: errorContent, displayReplacement: errorContent };
    }

    const tableName = trimmed.toLowerCase();
    const tableContext = (interactionData.contexts || []).find(c =>
        c.name?.toLowerCase() === tableName && c.text
    );

    if (!tableContext || !tableContext.text) {
        const errorContent = `[Error: RNG table "${trimmed}" not found. Create a context with the table name and entries formatted as "1-10: outcome text" per line.]`;
        return { toolType: 'rng', args, content: errorContent, displayReplacement: errorContent };
    }

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

// ─── Move ───────────────────────────────────────────────────────────

function executeMove(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: move <location_id>. Moves to an adjacent location via normal movement cost.]';
        return { toolType: 'move', args, content: errorContent, displayReplacement: errorContent };
    }

    const locations = interactionData.locations || [];
    if (locations.length === 0) {
        const errorContent = '[Error: No locations available.]';
        return { toolType: 'move', args, content: errorContent, displayReplacement: errorContent };
    }

    let currentLocationIndex: number | undefined;
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        if (interactionData.interactionHistory[i].locationIndex !== undefined) {
            currentLocationIndex = interactionData.interactionHistory[i].locationIndex;
            break;
        }
    }

    if (currentLocationIndex === undefined) {
        const errorContent = '[Error: No current location set. Cannot move without being at a location first.]';
        return { toolType: 'move', args, content: errorContent, displayReplacement: errorContent };
    }

    const currentLocation = locations[currentLocationIndex];
    const targetId = trimmed.trim();
    const targetLocation = locations.find(l => l.id === targetId);

    if (!targetLocation) {
        const errorContent = `[Error: Location ID "${targetId}" not found.]`;
        return { toolType: 'move', args, content: errorContent, displayReplacement: errorContent };
    }

    if (targetLocation.id === currentLocation.id) {
        return {
            toolType: 'move',
            args,
            content: `Already at "${targetLocation.name}".`,
            displayReplacement: `[🚶 Already at "${targetLocation.name}"]`,
        };
    }

    // Check adjacency
    const isAdjacent = currentLocation.locationBindings.includes(targetLocation.id) ||
                       targetLocation.locationBindings.includes(currentLocation.id);

    if (!isAdjacent) {
        const errorContent = `[Error: "${targetLocation.name}" is not adjacent to "${currentLocation.name}". Use teleport for non-adjacent movement.]`;
        return { toolType: 'move', args, content: errorContent, displayReplacement: errorContent };
    }

    // Check if target location is locked
    const locks = loadLocationLocks(nextMessage.inventory);
    if (locks[targetLocation.id]) {
        const errorContent = `[Error: "${targetLocation.name}" is locked. Use key unlock first.]`;
        return { toolType: 'move', args, content: errorContent, displayReplacement: errorContent };
    }

    const targetIndex = locations.findIndex(l => l.id === targetLocation.id);
    nextMessage.locationIndex = targetIndex;

    return {
        toolType: 'move',
        args,
        content: `Moved to "${targetLocation.name}".`,
        displayReplacement: `[🚶 Moved to "${targetLocation.name}"]`,
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

function loadLocationLocks(inventory: Inventory | undefined): Record<string, boolean> {
    if (!inventory || typeof inventory['__location_locks__'] !== 'string') return {};
    try { return JSON.parse(inventory['__location_locks__'] as string); } catch { return {}; }
}

// ─── Timer ──────────────────────────────────────────────────────────

function executeTimer(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
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

function executeStopwatch(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
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

function executeCalculator(expression: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
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

async function executeWeb(query: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext): Promise<ToolResult> {
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

function executeLookup(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
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

function executeMap(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty map query. Use "map <location_id>" for distance from current location, or "map <loc1_id> to <loc2_id>" for distance between two locations.]';
        return { toolType: 'map', args, content: errorContent, displayReplacement: errorContent };
    }

    const locations = interactionData.locations || [];
    if (locations.length === 0) {
        const errorContent = '[Error: No locations available.]';
        return { toolType: 'map', args, content: errorContent, displayReplacement: errorContent };
    }

    const toMatch = trimmed.match(/^(\S+)\s+to\s+(\S+)$/i);
    let fromLoc: Location | undefined;
    let toLoc: Location | undefined;

    if (toMatch) {
        fromLoc = locations.find(l => l.id === toMatch[1].trim());
        toLoc = locations.find(l => l.id === toMatch[2].trim());
    } else {
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
        toLoc = locations.find(l => l.id === trimmed.trim());
    }

    if (!toLoc) {
        const errorContent = `[Error: Location ID "${trimmed.trim()}" not found.]`;
        return { toolType: 'map', args, content: errorContent, displayReplacement: errorContent };
    }

    if (!fromLoc) {
        const errorContent = '[Error: No current location set. Use "map <loc1_id> to <loc2_id>" format instead.]';
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

    const directDistance = fromLoc.locationDistances?.[toLoc.id];
    let distanceKm: number;

    if (directDistance !== undefined) {
        distanceKm = directDistance;
    } else {
        const R = 6371;
        const dLat = (toLoc.latitude - fromLoc.latitude) * Math.PI / 180;
        const dLon = (toLoc.longitude - fromLoc.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(fromLoc.latitude * Math.PI / 180) * Math.cos(toLoc.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distanceKm = R * c;
    }

    const rounded = Math.round(distanceKm * 10) / 10;
    const walkHours = Math.round((distanceKm / 5) * 10) / 10;
    const rideHours = Math.round((distanceKm / 30) * 10) / 10;

    const content = `Distance from "${fromLoc.name}" to "${toLoc.name}": ${rounded} km. Estimated travel: ~${walkHours}h walking, ~${rideHours}h riding.`;
    return {
        toolType: 'map',
        args,
        content,
        displayReplacement: `[🗺️ ${fromLoc.name} → ${toLoc.name}: ${rounded} km]`,
    };
}

// ─── Audio ──────────────────────────────────────────────────────────

function executeAudio(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty audio command. Use "audio play <track_id>" or "audio stop <track_id>"]';
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const trackId = parts.slice(1).join(' ').trim();

    if (!trackId) {
        const errorContent = `[Error: Usage: audio ${subcommand || 'play'} <track_id>]`;
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    if (subcommand !== 'play' && subcommand !== 'stop') {
        const errorContent = `[Error: Unknown audio command "${subcommand}". Use play or stop.]`;
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    const track = interactionData.audioTracks?.find(t => t.id === trackId);
    if (!track) {
        const errorContent = `[Error: Audio track ID "${trackId}" not found]`;
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    if (!track.playableByParticipants) {
        const errorContent = `[Error: Track "${track.name}" cannot be controlled by participants]`;
        return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
    }

    if (track.characterBindings && track.characterBindings.length > 0) {
        if (!track.characterBindings.includes(nextMessage.character.id)) {
            const errorContent = `[Error: Track "${track.name}" is not bound to this character]`;
            return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
        }
    }

    if (track.locationBindings && track.locationBindings.length > 0) {
        let currentLocationIndex: number | undefined;
        for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
            if (interactionData.interactionHistory[i].locationIndex !== undefined) {
                currentLocationIndex = interactionData.interactionHistory[i].locationIndex;
                break;
            }
        }
        if (currentLocationIndex === undefined) {
            const errorContent = `[Error: No active location for track "${track.name}"]`;
            return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
        }
        const currentLocation = interactionData.locations?.[currentLocationIndex];
        if (!currentLocation || !track.locationBindings.includes(currentLocation.id)) {
            const errorContent = `[Error: Track "${track.name}" is not bound to current location]`;
            return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
        }
    }

    if (track.contextBindings && track.contextBindings.length > 0) {
        const activeContextIds = new Set(interactionData.contexts?.map(c => c.id) ?? []);
        const hasMatchingContext = track.contextBindings.some(ctxId => activeContextIds.has(ctxId));
        if (!hasMatchingContext) {
            const errorContent = `[Error: Track "${track.name}" has no matching active context]`;
            return { toolType: 'audio', args, content: errorContent, displayReplacement: errorContent };
        }
    }

    const audioEngine = getAudioEngine();
    if (subcommand === 'play') {
        audioEngine.startTrack(track);
        return {
            toolType: 'audio',
            args,
            content: `Playing "${track.name}"`,
            displayReplacement: `[🔊 Playing "${track.name}"]`,
        };
    } else {
        audioEngine.stopTrack(track.id);
        return {
            toolType: 'audio',
            args,
            content: `Stopped "${track.name}"`,
            displayReplacement: `[🔇 Stopped "${track.name}"]`,
        };
    }
}

// ─── Note ──────────────────────────────────────────────────────────

function executeNote(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty note command. Use "note set <key> <text>", "note get <key>", "note delete <key>", or "note list"]';
        return { toolType: 'note', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

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

function executeInventory(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Empty inventory command. Use "inventory list", "inventory add <item> <qty>", "inventory remove <item> <qty>", or "inventory set <item> <value>"]';
        return { toolType: 'inventory', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

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

// ─── Invite ─────────────────────────────────────────────────────────

function executeInvite(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: invite <character_id>. Invites an existing participant to the current location.]';
        return { toolType: 'invite', args, content: errorContent, displayReplacement: errorContent };
    }

    const targetId = trimmed.trim();
    const allChars = context?.allCharacters || interactionData.participants || [];
    const targetChar = allChars.find(c => c.id === targetId);

    if (!targetChar) {
        const errorContent = `[Error: Character ID "${targetId}" not found.]`;
        return { toolType: 'invite', args, content: errorContent, displayReplacement: errorContent };
    }

    if (targetChar.id === interactionData.protagonist?.id) {
        const errorContent = `[Error: Cannot invite the protagonist. Use summon instead.]`;
        return { toolType: 'invite', args, content: errorContent, displayReplacement: errorContent };
    }

    const isParticipant = interactionData.participants.some(p => p.id === targetChar.id);
    if (!isParticipant) {
        const errorContent = `[Error: "${targetChar.name}" is not a participant in this session. Use summon to add non-participants.]`;
        return { toolType: 'invite', args, content: errorContent, displayReplacement: errorContent };
    }

    appendPendingAction(nextMessage, {
        type: 'invite',
        payload: { characterId: targetChar.id, characterName: targetChar.name },
    });

    return {
        toolType: 'invite',
        args,
        content: `Invited ${targetChar.name} to the current location.`,
        displayReplacement: `[📨 Invited ${targetChar.name} to current location]`,
    };
}

// ─── Kick ───────────────────────────────────────────────────────────

function executeKick(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: kick <character_id>. Removes a participant from the current location.]';
        return { toolType: 'kick', args, content: errorContent, displayReplacement: errorContent };
    }

    const targetId = trimmed.trim();
    const allChars = context?.allCharacters || interactionData.participants || [];
    const targetChar = allChars.find(c => c.id === targetId);

    if (!targetChar) {
        const errorContent = `[Error: Character ID "${targetId}" not found.]`;
        return { toolType: 'kick', args, content: errorContent, displayReplacement: errorContent };
    }

    const isParticipant = interactionData.participants.some(p => p.id === targetChar.id);
    if (!isParticipant) {
        const errorContent = `[Error: "${targetChar.name}" is not a participant in this session.]`;
        return { toolType: 'kick', args, content: errorContent, displayReplacement: errorContent };
    }

    appendPendingAction(nextMessage, {
        type: 'kick',
        payload: { characterId: targetChar.id, characterName: targetChar.name },
    });

    return {
        toolType: 'kick',
        args,
        content: `Kicked ${targetChar.name} from the current location.`,
        displayReplacement: `[👢 Kicked ${targetChar.name} from current location]`,
    };
}

// ─── Teleport ───────────────────────────────────────────────────────

function executeTeleport(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: teleport <location_id>. Instantly moves to any location regardless of adjacency.]';
        return { toolType: 'teleport', args, content: errorContent, displayReplacement: errorContent };
    }

    const locations = interactionData.locations || [];
    if (locations.length === 0) {
        const errorContent = '[Error: No locations available.]';
        return { toolType: 'teleport', args, content: errorContent, displayReplacement: errorContent };
    }

    const targetId = trimmed.trim();
    const targetLocation = locations.find(l => l.id === targetId);

    if (!targetLocation) {
        const errorContent = `[Error: Location ID "${targetId}" not found.]`;
        return { toolType: 'teleport', args, content: errorContent, displayReplacement: errorContent };
    }

    let currentLocationName = 'unknown';
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        const locIdx = interactionData.interactionHistory[i].locationIndex;
        if (locIdx !== undefined && locations[locIdx]) {
            currentLocationName = locations[locIdx].name;
            break;
        }
    }

    if (targetLocation.id === (interactionData.locations?.[interactionData.interactionHistory.findLastIndex?.(m => m.locationIndex !== undefined) ?? -1]?.id)) {
        return {
            toolType: 'teleport',
            args,
            content: `Already at "${targetLocation.name}".`,
            displayReplacement: `[⚡ Already at "${targetLocation.name}"]`,
        };
    }

    const targetIndex = locations.findIndex(l => l.id === targetLocation.id);
    nextMessage.locationIndex = targetIndex;

    return {
        toolType: 'teleport',
        args,
        content: `Teleported to "${targetLocation.name}".`,
        displayReplacement: `[⚡ Teleported to "${targetLocation.name}"]`,
    };
}

// ─── Key (Lock/Unlock) ──────────────────────────────────────────────

function executeKey(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: key lock <location_id> OR key unlock <location_id>]';
        return { toolType: 'key', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const locationId = parts.slice(1).join(' ').trim();

    if (!locationId) {
        const errorContent = `[Error: Usage: key ${subcommand || 'lock'} <location_id>]`;
        return { toolType: 'key', args, content: errorContent, displayReplacement: errorContent };
    }

    if (subcommand !== 'lock' && subcommand !== 'unlock') {
        const errorContent = `[Error: Unknown key command "${subcommand}". Use lock or unlock.]`;
        return { toolType: 'key', args, content: errorContent, displayReplacement: errorContent };
    }

    const locations = interactionData.locations || [];
    const targetLocation = locations.find(l => l.id === locationId);

    if (!targetLocation) {
        const errorContent = `[Error: Location ID "${locationId}" not found.]`;
        return { toolType: 'key', args, content: errorContent, displayReplacement: errorContent };
    }

    const inventory = nextMessage.inventory ? { ...nextMessage.inventory } : {};
    const locks = loadLocationLocks(inventory);

    if (subcommand === 'lock') {
        locks[targetLocation.id] = true;
        inventory['__location_locks__'] = JSON.stringify(locks);
        nextMessage.inventory = inventory;

        return {
            toolType: 'key',
            args,
            content: `Locked "${targetLocation.name}". Entry via binding triggers is now blocked.`,
            displayReplacement: `[🔒 Locked "${targetLocation.name}"]`,
        };
    } else {
        // unlock
        if (!locks[targetLocation.id]) {
            return {
                toolType: 'key',
                args,
                content: `"${targetLocation.name}" is not locked.`,
                displayReplacement: `[🔓 "${targetLocation.name}" is not locked]`,
            };
        }

        delete locks[targetLocation.id];
        if (Object.keys(locks).length === 0) {
            delete inventory['__location_locks__'];
        } else {
            inventory['__location_locks__'] = JSON.stringify(locks);
        }
        nextMessage.inventory = inventory;

        return {
            toolType: 'key',
            args,
            content: `Unlocked "${targetLocation.name}". Access via binding triggers restored.`,
            displayReplacement: `[🔓 Unlocked "${targetLocation.name}"]`,
        };
    }
}

// ─── Clothing ───────────────────────────────────────────────────────

function executeClothing(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: clothing <character_id> put on <clothing_id> OR clothing <character_id> take off <clothing_id>]';
        return { toolType: 'clothing', args, content: errorContent, displayReplacement: errorContent };
    }

    // Parse: "<character_id> put on <clothing_id>" or "<character_id> take off <clothing_id>"
    const putOnMatch = trimmed.match(/^(\S+)\s+put\s+on\s+(\S+)$/i);
    const takeOffMatch = trimmed.match(/^(\S+)\s+take\s+off\s+(\S+)$/i);

    let charId: string;
    let clothingId: string;
    let action: 'put_on' | 'take_off';

    if (putOnMatch) {
        charId = putOnMatch[1].trim();
        clothingId = putOnMatch[2].trim();
        action = 'put_on';
    } else if (takeOffMatch) {
        charId = takeOffMatch[1].trim();
        clothingId = takeOffMatch[2].trim();
        action = 'take_off';
    } else {
        const errorContent = `[Error: Invalid clothing command "${trimmed}". Use "clothing <character_id> put on <clothing_id>" or "clothing <character_id> take off <clothing_id>".]`;
        return { toolType: 'clothing', args, content: errorContent, displayReplacement: errorContent };
    }

    // Find target character by ID
    const allChars = context?.allCharacters || interactionData.participants || [];
    const targetChar = allChars.find(c => c.id === charId);

    if (!targetChar) {
        const errorContent = `[Error: Character ID "${charId}" not found.]`;
        return { toolType: 'clothing', args, content: errorContent, displayReplacement: errorContent };
    }

    // Find clothing item by ID in character's wardrobe
    const clothingItem = targetChar.clothings?.find(c => c.id === clothingId);

    if (!clothingItem) {
        const availableItems = targetChar.clothings?.map(c => `${c.name} (${c.id})`).join(', ') || 'none';
        const errorContent = `[Error: Clothing ID "${clothingId}" not found in ${targetChar.name}'s wardrobe. Available: ${availableItems}]`;
        return { toolType: 'clothing', args, content: errorContent, displayReplacement: errorContent };
    }

    // Get or create wearing status on the next message
    const wearingStatuses = nextMessage.characterClothingWearingStatuses
        ? { ...nextMessage.characterClothingWearingStatuses }
        : {};

    if (action === 'put_on') {
        if (wearingStatuses[clothingItem.id] === true) {
            return {
                toolType: 'clothing',
                args,
                content: `${targetChar.name} is already wearing "${clothingItem.name}".`,
                displayReplacement: `[👕 ${targetChar.name} already wearing "${clothingItem.name}"]`,
            };
        }

        wearingStatuses[clothingItem.id] = true;

        // Apply clothing bindings: hide items this clothing covers
        for (const boundId of clothingItem.clothingBindings) {
            wearingStatuses[boundId] = false;
        }

        nextMessage.characterClothingWearingStatuses = wearingStatuses;

        return {
            toolType: 'clothing',
            args,
            content: `${targetChar.name} put on "${clothingItem.name}".`,
            displayReplacement: `[👕 ${targetChar.name} put on "${clothingItem.name}"]`,
        };
    } else {
        // take_off
        if (wearingStatuses[clothingItem.id] !== true) {
            return {
                toolType: 'clothing',
                args,
                content: `${targetChar.name} is not wearing "${clothingItem.name}".`,
                displayReplacement: `[👕 ${targetChar.name} not wearing "${clothingItem.name}"]`,
            };
        }

        wearingStatuses[clothingItem.id] = false;
        nextMessage.characterClothingWearingStatuses = wearingStatuses;

        return {
            toolType: 'clothing',
            args,
            content: `${targetChar.name} took off "${clothingItem.name}".`,
            displayReplacement: `[👕 ${targetChar.name} took off "${clothingItem.name}"]`,
        };
    }
}

// ─── Summon ─────────────────────────────────────────────────────────

function executeSummon(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: summon <character_id>. Adds a non-participant character to the current interaction session.]';
        return { toolType: 'summon', args, content: errorContent, displayReplacement: errorContent };
    }

    const targetId = trimmed.trim();
    const allChars = context?.allCharacters || [];
    const targetChar = allChars.find(c => c.id === targetId);

    if (!targetChar) {
        const errorContent = `[Error: Character ID "${targetId}" does not exist. The character must be created before it can be summoned.]`;
        return { toolType: 'summon', args, content: errorContent, displayReplacement: errorContent };
    }

    const isParticipant = interactionData.participants.some(p => p.id === targetChar.id);
    if (isParticipant) {
        const errorContent = `[Error: "${targetChar.name}" is already a participant. Use invite to bring them to the current location.]`;
        return { toolType: 'summon', args, content: errorContent, displayReplacement: errorContent };
    }

    appendPendingAction(nextMessage, {
        type: 'summon',
        payload: { characterId: targetChar.id, characterName: targetChar.name },
    });

    return {
        toolType: 'summon',
        args,
        content: `Summoned ${targetChar.name} into the interaction session.`,
        displayReplacement: `[✨ Summoned ${targetChar.name} into session]`,
    };
}

// ─── Narrate ────────────────────────────────────────────────────────

function executeNarrate(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: narrate <text>. Injects ambient narration without consuming character chat stamina.]';
        return { toolType: 'narrate', args, content: errorContent, displayReplacement: errorContent };
    }

    return {
        toolType: 'narrate',
        args,
        content: trimmed,
        displayReplacement: `[🎙️ ${trimmed}]`,
    };
}

// ─── Inspect ────────────────────────────────────────────────────────

function executeInspect(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: inspect <character_id>. Examines another character\'s visible state.]';
        return { toolType: 'inspect', args, content: errorContent, displayReplacement: errorContent };
    }

    const targetId = trimmed.trim();
    const allChars = context?.allCharacters || interactionData.participants || [];
    const targetChar = allChars.find(c => c.id === targetId);

    if (!targetChar) {
        const errorContent = `[Error: Character ID "${targetId}" not found.]`;
        return { toolType: 'inspect', args, content: errorContent, displayReplacement: errorContent };
    }

    let targetLocationName = 'unknown';
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        const msg = interactionData.interactionHistory[i];
        if (msg.character.id === targetChar.id && msg.locationIndex !== undefined) {
            const loc = interactionData.locations?.[msg.locationIndex];
            if (loc) targetLocationName = loc.name;
            break;
        }
    }

    let lastExpression = 'neutral';
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        const msg = interactionData.interactionHistory[i];
        if (msg.character.id === targetChar.id && msg.characterExpression) {
            lastExpression = msg.characterExpression;
            break;
        }
    }

    let itemCount = 0;
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        const msg = interactionData.interactionHistory[i];
        if (msg.character.id === targetChar.id && msg.inventory) {
            itemCount = Object.keys(msg.inventory).filter(k => !k.startsWith('__')).length;
            break;
        }
    }

    // Gather currently worn clothing
    let wornClothing: string[] = [];
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        const msg = interactionData.interactionHistory[i];
        if (msg.character.id === targetChar.id && msg.characterClothingWearingStatuses) {
            const statuses = msg.characterClothingWearingStatuses;
            for (const clothing of targetChar.clothings || []) {
                if (statuses[clothing.id] === true) {
                    wornClothing.push(clothing.name);
                }
            }
            break;
        }
    }

    const wornStr = wornClothing.length > 0 ? wornClothing.join(', ') : 'nothing notable';
    const content = `${targetChar.name}: Location: ${targetLocationName}, Expression: ${lastExpression}, Wearing: ${wornStr}, Items: ${itemCount}`;
    return {
        toolType: 'inspect',
        args,
        content,
        displayReplacement: `[🔍 ${targetChar.name}: 📍${targetLocationName}, 😊${lastExpression}, 👕${wornClothing.length} worn, 📦${itemCount} items]`,
    };
}

// ─── Administrator ──────────────────────────────────────────────────

function executeAdministrator(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: administrator <command> [args]. Commands: move_protagonist <chat_id>, switch_model <model_name>, list_chats, list_models.]';
        return { toolType: 'administrator', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    switch (subcommand) {
        case 'list_chats': {
            const content = `Current session: "${interactionData.name}" (${interactionData.participants.length} participants, ${interactionData.interactionHistory.length} messages)`;
            return { toolType: 'administrator', args, content, displayReplacement: "[🔧 Session info listed]" };
        }

        case 'move_protagonist': {
            const targetChatId = parts.slice(1).join(' ');
            if (!targetChatId) {
                const errorContent = '[Error: Usage: administrator move_protagonist <chat_id>]';
                return { toolType: 'administrator', args, content: errorContent, displayReplacement: errorContent };
            }
            appendPendingAction(nextMessage, {
                type: 'administrator_move_protagonist',
                payload: { chatId: targetChatId },
            });
            return { toolType: 'administrator', args, content: `Requested protagonist transfer to chat "${targetChatId}".`, displayReplacement: `[🔧 Transfer requested: ${targetChatId}]` };
        }

        case 'switch_model': {
            const modelName = parts.slice(1).join(' ');
            if (!modelName) {
                const errorContent = '[Error: Usage: administrator switch_model <model_name>]';
                return { toolType: 'administrator', args, content: errorContent, displayReplacement: errorContent };
            }
            appendPendingAction(nextMessage, {
                type: 'administrator_switch_model',
                payload: { modelName },
            });
            return { toolType: 'administrator', args, content: `Requested model switch to "${modelName}".`, displayReplacement: `[🔧 Model switch requested: ${modelName}]` };
        }

        case 'list_models': {
            const content = 'Model listing requires access to model manager data. Use the Language Models panel instead.';
            return { toolType: 'administrator', args, content, displayReplacement: "[🔧 Use Language Models panel]" };
        }

        default: {
            const errorContent = `[Error: Unknown administrator command "${subcommand}". Use move_protagonist, switch_model, list_chats, or list_models.]`;
            return { toolType: 'administrator', args, content: errorContent, displayReplacement: errorContent };
        }
    }
}

// ─── Creator ────────────────────────────────────────────────────────

function executeCreator(args: string, nextMessage: BaseMessage, _interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: creator <entity_type> <name> [details]. Entity types: character, context, location, audio_track, profile.]';
        return { toolType: 'creator', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const entityType = parts[0]?.toLowerCase();
    const entityName = parts.slice(1).join(' ');

    if (!entityName) {
        const errorContent = `[Error: Usage: creator ${entityType || '<entity_type>'} <name> [details]]`;
        return { toolType: 'creator', args, content: errorContent, displayReplacement: errorContent };
    }

    const validTypes = ['character', 'context', 'location', 'audio_track', 'profile'];
    if (!validTypes.includes(entityType)) {
        const errorContent = `[Error: Unknown entity type "${entityType}". Use character, context, location, audio_track, or profile.]`;
        return { toolType: 'creator', args, content: errorContent, displayReplacement: errorContent };
    }

    appendPendingAction(nextMessage, {
        type: 'creator',
        payload: { entityType, entityName },
    });

    context?.addToast?.(`Creator: ${entityType} "${entityName}" creation initiated.`, 'info');
    return {
        toolType: 'creator',
        args,
        content: `Creation request for ${entityType} "${entityName}". Use the editor to complete creation.`,
        displayReplacement: `[🛠️ ${entityType} creation: "${entityName}"]`,
    };
}

// ─── Destroyer ──────────────────────────────────────────────────────

function executeDestroyer(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const trimmed = args.trim();

    if (!trimmed) {
        const errorContent = '[Error: Usage: destroyer <entity_type> <entity_id>. Entity types: character, context, location, audio_track, profile.]';
        return { toolType: 'destroyer', args, content: errorContent, displayReplacement: errorContent };
    }

    const parts = trimmed.split(/\s+/);
    const entityType = parts[0]?.toLowerCase();
    const entityId = parts.slice(1).join(' ').trim();

    if (!entityId) {
        const errorContent = `[Error: Usage: destroyer ${entityType || '<entity_type>'} <entity_id>]`;
        return { toolType: 'destroyer', args, content: errorContent, displayReplacement: errorContent };
    }

    const validTypes = ['character', 'context', 'location', 'audio_track', 'profile'];
    if (!validTypes.includes(entityType)) {
        const errorContent = `[Error: Unknown entity type "${entityType}". Use character, context, location, audio_track, or profile.]`;
        return { toolType: 'destroyer', args, content: errorContent, displayReplacement: errorContent };
    }

    // Validate target exists by ID
    let targetName = entityId;
    switch (entityType) {
        case 'character': {
            const target = (context?.allCharacters || []).find(c => c.id === entityId);
            if (!target) {
                return { toolType: 'destroyer', args, content: `[Error: Character ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found: "${entityId}"]` };
            }
            if (target.id === interactionData.protagonist?.id) {
                return { toolType: 'destroyer', args, content: '[Error: Cannot destroy the protagonist.]', displayReplacement: `[💀 Cannot destroy protagonist]` };
            }
            targetName = target.name;
            break;
        }
        case 'context': {
            const target = (context?.allContexts || interactionData.contexts || []).find(c => c.id === entityId);
            if (!target) {
                return { toolType: 'destroyer', args, content: `[Error: Context ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found: "${entityId}"]` };
            }
            targetName = target.name;
            break;
        }
        case 'location': {
            const target = (context?.allLocations || interactionData.locations || []).find(l => l.id === entityId);
            if (!target) {
                return { toolType: 'destroyer', args, content: `[Error: Location ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found: "${entityId}"]` };
            }
            targetName = target.name;
            break;
        }
        case 'audio_track': {
            const target = (context?.allAudioTracks || interactionData.audioTracks || []).find(t => t.id === entityId);
            if (!target) {
                return { toolType: 'destroyer', args, content: `[Error: Audio track ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found: "${entityId}"]` };
            }
            targetName = target.name;
            break;
        }
        case 'profile': {
            const target = (context?.allProfiles || []).find(p => p.id === entityId);
            if (!target) {
                return { toolType: 'destroyer', args, content: `[Error: Profile ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found: "${entityId}"]` };
            }
            targetName = target.name;
            break;
        }
    }

    appendPendingAction(nextMessage, {
        type: 'destroyer',
        payload: { entityType, entityId, entityName: targetName },
    });

    context?.addToast?.(`Destroyer: ${entityType} "${targetName}" deletion initiated.`, 'info');
    return {
        toolType: 'destroyer',
        args,
        content: `Deletion request for ${entityType} "${targetName}". This action is irreversible.`,
        displayReplacement: `[💀 ${entityType} deletion: "${targetName}"]`,
    };
}

/**
 * Processes pending tool actions stored in the last AI message's inventory.
 * Returns the updated InteractionData with mutations applied.
 * NOTE: This is a pure function. It does not call setInteractionData or addToast.
 * The caller (useChatSession) must apply the returned data and handle toasts.
 */
export function processPendingToolActions(
    data: InteractionData,
    allCharacters: Character[],
    options?: {
        onToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
    }
): InteractionData {
    // Find the last AI message
    let lastAiCharId: string | null = null;
    for (let i = data.interactionHistory.length - 1; i >= 0; i--) {
        const msg = data.interactionHistory[i];
        if (msg.messageType === 'chat' && msg.character.id !== data.protagonist.id) {
            lastAiCharId = msg.character.id;
            break;
        }
    }
    if (!lastAiCharId) return data;

    const findPrevMsg = (d: InteractionData, charId: string) => {
        for (let i = d.interactionHistory.length - 1; i >= 0; i--) {
            if (d.interactionHistory[i].character.id === charId) return d.interactionHistory[i];
        }
        return null;
    };

    const charLastMsg = findPrevMsg(data, lastAiCharId);
    if (!charLastMsg || charLastMsg.messageType !== 'chat') return data;
    const targetMsg = charLastMsg as ChatMessage;

    const actions = loadPendingToolActions(targetMsg.inventory);
    if (actions.length === 0) return data;

    const targetMsgIdx = data.interactionHistory.findIndex(m => m.id === targetMsg.id);
    if (targetMsgIdx === -1) return data;

    let updatedData = { ...data, interactionHistory: [...data.interactionHistory] };
    let changed = false;

    for (const action of actions) {
        switch (action.type) {
            case 'summon': {
                const charId = action.payload.characterId;
                const alreadyParticipant = updatedData.participants.some(p => p.id === charId);
                if (alreadyParticipant) break;

                const realCharacter = allCharacters.find(c => c.id === charId);
                if (!realCharacter) {
                    options?.onToast?.(`⚠️ Cannot summon "${action.payload.characterName}": character does not exist.`, 'error');
                    break;
                }

                updatedData = {
                    ...updatedData,
                    participants: [...updatedData.participants, { ...realCharacter }],
                };
                changed = true;
                options?.onToast?.(`✨ ${realCharacter.name} joined the session.`, 'info');
                break;
            }
            case 'kick': {
                const charId = action.payload.characterId;
                updatedData = {
                    ...updatedData,
                    participants: updatedData.participants.filter(p => p.id !== charId),
                };
                changed = true;
                options?.onToast?.(`👢 ${action.payload.characterName} was kicked from the session.`, 'info');
                break;
            }
            case 'invite': {
                const invitedChar = updatedData.participants.find(p => p.id === action.payload.characterId);
                if (invitedChar) {
                    let currentLocIdx: number | undefined;
                    for (let i = updatedData.interactionHistory.length - 1; i >= 0; i--) {
                        if (updatedData.interactionHistory[i].locationIndex !== undefined) {
                            currentLocIdx = updatedData.interactionHistory[i].locationIndex;
                            break;
                        }
                    }
                    const inviteMsg = {
                        messageType: 'interaction' as const,
                        id: uuidv4(),
                        character: { ...invitedChar },
                        locationIndex: currentLocIdx,
                        characterClothingWearingStatuses: {},
                        characterLockedLocations: {},
                        parentInteractionMessageId: updatedData.interactionHistory[updatedData.interactionHistory.length - 1]?.id ?? null,
                        firstCreatedTimestamp: Date.now(),
                        lastUpdatedTimestamp: Date.now(),
                    };
                    updatedData = {
                        ...updatedData,
                        interactionHistory: [...updatedData.interactionHistory, inviteMsg],
                    };
                    changed = true;
                    options?.onToast?.(`📨 ${action.payload.characterName} arrived at the current location.`, 'info');
                }
                break;
            }
            case 'administrator_move_protagonist': {
                options?.onToast?.(`🔧 Protagonist transfer to "${action.payload.chatId}" requested.`, 'info');
                break;
            }
            case 'administrator_switch_model': {
                options?.onToast?.(`🔧 Model switch to "${action.payload.modelName}" requested.`, 'info');
                break;
            }
            case 'creator': {
                options?.onToast?.(`🛠️ ${action.payload.entityType} "${action.payload.entityName}" creation requested.`, 'info');
                break;
            }
            case 'destroyer': {
                options?.onToast?.(`💀 ${action.payload.entityType} "${action.payload.entityName}" deletion requested.`, 'info');
                break;
            }
        }
    }

    if (!changed) return data;

    // Strip pending actions from inventory
    const cleanedHistory = [...updatedData.interactionHistory];
    const cleanedMsg = { ...cleanedHistory[targetMsgIdx] } as ChatMessage;
    const cleanedInventory = cleanedMsg.inventory ? { ...cleanedMsg.inventory } : {};
    delete cleanedInventory['__pending_tool_actions__'];
    if (Object.keys(cleanedInventory).length === 0) {
        delete cleanedMsg.inventory;
    } else {
        cleanedMsg.inventory = cleanedInventory;
    }
    cleanedHistory[targetMsgIdx] = cleanedMsg;

    return { ...updatedData, interactionHistory: cleanedHistory, lastUpdatedTimestamp: Date.now() };
}