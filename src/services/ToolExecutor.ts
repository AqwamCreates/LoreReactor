// src/services/ToolExecutor.ts

import type { ToolInvocation } from '../services/ToolInvocationParser';
import { fetchLinkContent, buildSearchUrl } from '../services/linkFetcher';
import { getActiveDialoguePrompts, collectActiveDialoguePromptContent, buildDialogueSearchSpace } from '../hooks/dialoguePromptLogic';
import type { BaseMessage, Character, Context, Location, AudioTrack, Profile, InteractionData, Inventory, ChatMessage, PromptBlock, StopPattern, Sampler, BudgetStrategy, World, Memory, Extension, toolUsageDisplayMode } from '../types';
import { findPreviousMessage } from '../hooks/chatLogic';
import { getAudioEngine } from './AudioEngine';
import { getCurrentLocationIndex, getReachableLocationsByCharacter, isCharacterLockedFromLocation, getCoLocatedParticipants } from '../hooks/locationLogic';
import { v4 as uuidv4 } from 'uuid';

export interface ToolResult {
    toolType: string;
    args: string;
    content: string;
    displayReplacement: string;
}

export interface ToolExecutionContext {
    allCharacters?: Character[];
    allContexts?: Context[];
    allLocations?: Location[];
    allAudioTracks?: AudioTrack[];
    allPromptBlocks?: PromptBlock[];
    allStopPatterns?: StopPattern[];
    allSamplers?: Sampler[];
    allBudgetStrategies?: BudgetStrategy[];
    allProfiles?: Profile[];
    allWorlds?: World[];
    allMemories?: Memory[];
    allExtensions?: Extension[];
    addToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

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

const toolFunctions: Record<string, (args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, displayMode?: toolUsageDisplayMode) => ToolResult | Promise<ToolResult>> = {
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
    "dialogue": executeDialogue,
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

export async function executeTool(
    invocation: ToolInvocation,
    nextMessage: BaseMessage,
    interactionData: InteractionData,
    context?: ToolExecutionContext,
    displayMode?: toolUsageDisplayMode,
): Promise<ToolResult> {
    const toolType = invocation.toolType;
    const args = invocation.args;
    const executeFunction = toolFunctions[toolType as string];

    if (executeFunction) return executeFunction(args, nextMessage, interactionData, context, displayMode);

    console.warn(`Unknown tool type: ${toolType}`);
    const errorContent = `[Error: Unknown tool "${toolType}"]`;
    return { toolType, args, content: errorContent, displayReplacement: errorContent };
}

export async function executeTools(
    invocations: ToolInvocation[],
    nextMessage: BaseMessage,
    interactionData: InteractionData,
    context?: ToolExecutionContext,
    displayMode?: toolUsageDisplayMode,
): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const invocation of invocations) {
        const result = await executeTool(invocation, nextMessage, interactionData, context, displayMode);
        results.push(result);
    }
    return results;
}

// ─── Help helper ────────────────────────────────────────────────────

function helpResult(toolType: string, args: string, usage: string): ToolResult {
    return { toolType, args, content: usage, displayReplacement: `[❓ ${toolType}: ${usage.split('\n')[0]}]` };
}

// ─── Display Mode Formatter ────────────────────────────────────────

export function formatToolDisplay(
    result: ToolResult,
    rawMatch: string,
    mode: toolUsageDisplayMode,
): string {
    switch (mode) {
        case 'none':
            return result.displayReplacement;
        case 'icon': {
            const iconMatch = result.displayReplacement.match(/^\[?([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}⚡🔧💀🛠️✨📨👢🔒🔓👕🎙️📝📦🗺️🌐🔍🎲🪙📅⏱️❓])/u);
            return iconMatch ? iconMatch[1] : result.displayReplacement;
        }
        case 'simple':
            return result.displayReplacement;
        case 'detailed':
            return result.displayReplacement;
        case 'full':
            return `[${result.toolType}(${result.args}) → ${result.content}]`;
        case 'raw':
            return rawMatch;
        default:
            return result.displayReplacement;
    }
}

// ─── Random Pick ────────────────────────────────────────────────────

function executeRandomPick(expression: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    if (!expression.trim()) {
        return helpResult('pick', expression, 'pick <option1>, <option2>, ... — randomly picks one option from the list');
    }

    const options = expression.split(',').map(o => o.trim()).filter(o => o.length > 0);

    if (options.length === 0) {
        const errorContent = '[Error: No valid options provided. Separate options with commas.]';
        return { toolType: 'pick', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    if (options.length === 1) {
        return { toolType: 'pick', args: expression, content: options[0], displayReplacement: `[🎯 Only one option: "${options[0]}"]` };
    }

    const index = Math.floor(Math.random() * options.length);
    const picked = options[index];
    return { toolType: 'pick', args: expression, content: picked, displayReplacement: `[🎯 Picked (${index + 1}/${options.length}): "${picked}"]` };
}

// ─── Date ────────────────────────────────────────────────────────────

function executeDate(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
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
        dateStr = now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    }

    return { toolType: 'date', args, content: dateStr, displayReplacement: `[📅 ${dateStr}]` };
}

// ─── Coin Flip ───────────────────────────────────────────────────────

function executeCoinFlip(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return { toolType: 'coin', args, content: result, displayReplacement: `[🪙 Coin flip: ${result}]` };
}

// ─── Roll Dice ──────────────────────────────────────────────────────

interface RollGroup { count: number; sides: number }

function executeDiceRoll(expression: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    if (!expression.trim()) {
        return helpResult('dice', expression, 'dice <notation> — roll dice (e.g. 2d6+3, d20, 1d8-2)');
    }

    const result = parseRollExpression(expression.trim());
    if (!result) {
        const errorContent = `[Error: Invalid dice notation "${expression.trim()}". Use format like "2d6", "1d20+5", "d8"]`;
        return { toolType: 'dice', args: expression, content: errorContent, displayReplacement: errorContent };
    }

    const rollsStr = result.rolls.join(', ');
    const modStr = result.modifier > 0 ? ` + ${result.modifier}` : result.modifier < 0 ? ` - ${Math.abs(result.modifier)}` : '';
    const label = result.groups.length === 1 ? `${result.groups[0].count}d${result.groups[0].sides}` : result.groups.map(g => `${g.count}d${g.sides}`).join(' + ');

    return { toolType: 'dice', args: expression, content: `${result.total}`, displayReplacement: `[🎲 ${label}${modStr} → [${rollsStr}] = ${result.total}]` };
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
        for (let i = 0; i < group.count; i++) allRolls.push(Math.floor(Math.random() * group.sides) + 1);
    }

    return { groups, modifier, rolls: allRolls, total: allRolls.reduce((sum, r) => sum + r, 0) + modifier };
}

// ─── Random Number ───────────────────────────────────────────────────

function executeRandom(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('random', args, 'random <min>-<max> or random <max> — random integer in range');
    }

    let min: number, max: number;
    const dashMatch = trimmed.match(/^(-?\d+)\s*[-–—]\s*(-?\d+)$/);
    const toMatch = trimmed.match(/^(-?\d+)\s+to\s+(-?\d+)$/i);

    if (dashMatch) { min = parseInt(dashMatch[1], 10); max = parseInt(dashMatch[2], 10); }
    else if (toMatch) { min = parseInt(toMatch[1], 10); max = parseInt(toMatch[2], 10); }
    else {
        const single = parseInt(trimmed, 10);
        if (isNaN(single) || single < 1) {
            const errorContent = `[Error: Invalid range "${trimmed}". Use format like "1-100" or "1-6"]`;
            return { toolType: 'random', args, content: errorContent, displayReplacement: errorContent };
        }
        min = 1; max = single;
    }

    if (min > max) [min, max] = [max, min];
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return { toolType: 'random', args, content: result.toString(), displayReplacement: `[🎲 Random(${min}-${max}): ${result}]` };
}

// ─── RNG Table ─────────────────────────────────────────────────────

function executeRng(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('rng', args, 'rng <table name> — roll on a named RNG table defined in contexts (entries: "1-10: outcome")');
    }

    const tableName = trimmed.toLowerCase();
    const tableContext = (interactionData.contexts || []).find(c => c.name?.toLowerCase() === tableName && c.text);

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
            const min = parseInt(rangeMatch[1], 10), max = parseInt(rangeMatch[2], 10);
            entries.push({ min, max, result: rangeMatch[3].trim() });
            if (max > globalMax) globalMax = max;
        } else if (singleMatch) {
            const val = parseInt(singleMatch[1], 10);
            entries.push({ min: val, max: val, result: singleMatch[2].trim() });
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
        return { toolType: 'rng', args, content: `Rolled ${roll} on "${tableContext.name}" — no entry covers this range.`, displayReplacement: `[🎲 ${tableContext.name}: rolled ${roll}, no match]` };
    }

    return { toolType: 'rng', args, content: matchedEntry.result, displayReplacement: `[🎲 ${tableContext.name}: rolled ${roll} → ${matchedEntry.result}]` };
}

// ─── Move ───────────────────────────────────────────────────────────

function executeMove(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('move', args, 'move <location_id> — move to an adjacent location via normal movement cost');
    }

    const locations = interactionData.locations || [];
    if (locations.length === 0) return { toolType: 'move', args, content: '[Error: No locations available.]', displayReplacement: '[Error: No locations available.]' };

    let currentLocationIndex: number | undefined;
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        if (interactionData.interactionHistory[i].locationIndex !== undefined) { currentLocationIndex = interactionData.interactionHistory[i].locationIndex; break; }
    }
    if (currentLocationIndex === undefined) return { toolType: 'move', args, content: '[Error: No current location set.]', displayReplacement: '[Error: No current location set.]' };

    const currentLocation = locations[currentLocationIndex];
    const targetLocation = locations.find(l => l.id === trimmed);
    if (!targetLocation) return { toolType: 'move', args, content: `[Error: Location ID "${trimmed}" not found.]`, displayReplacement: `[Error: Location ID "${trimmed}" not found.]` };

    if (targetLocation.id === currentLocation.id) return { toolType: 'move', args, content: `Already at "${targetLocation.name}" (${targetLocation.id}).`, displayReplacement: `[🚶 Already at "${targetLocation.name}"]` };

    const isAdjacent = currentLocation.locationBindings.includes(targetLocation.id) || targetLocation.locationBindings.includes(currentLocation.id);
    if (!isAdjacent) return { toolType: 'move', args, content: `[Error: "${targetLocation.name}" is not adjacent. Use teleport for non-adjacent movement.]`, displayReplacement: `[Error: Not adjacent]` };

    if (isCharacterLockedFromLocation(interactionData, nextMessage.character.id, targetLocation.id)) {
        return { toolType: 'move', args, content: `[Error: "${targetLocation.name}" is locked for you. Use key unlock first.]`, displayReplacement: `[Error: Location locked]` };
    }

    nextMessage.locationIndex = locations.findIndex(l => l.id === targetLocation.id);
    return { toolType: 'move', args, content: `Moved to "${targetLocation.name}" (${targetLocation.id}).`, displayReplacement: `[🚶 Moved to "${targetLocation.name}"]` };
}

// ─── Timer / Stopwatch Helpers ──────────────────────────────────────

interface TimerEntry { name: string; targetTimestamp: number }
interface StopwatchEntry { name: string; startTimestamp: number; pausedElapsedMs?: number }

function parseDurationToMs(input: string): number | null {
    const trimmed = input.trim().toLowerCase();
    let totalMs = 0, matched = false;
    const hourMatch = trimmed.match(/(\d+)\s*h(?:ours?|r)?/);
    if (hourMatch) { totalMs += parseInt(hourMatch[1], 10) * 3600000; matched = true; }
    const minMatch = trimmed.match(/(\d+)\s*m(?:in(?:utes?|s)?)?/);
    if (minMatch) { totalMs += parseInt(minMatch[1], 10) * 60000; matched = true; }
    const secMatch = trimmed.match(/(\d+)\s*s(?:ec(?:onds?|s)?)?/);
    if (secMatch) { totalMs += parseInt(secMatch[1], 10) * 1000; matched = true; }
    if (!matched) { const plainNum = parseInt(trimmed, 10); if (!isNaN(plainNum) && plainNum > 0) return plainNum * 1000; return null; }
    return totalMs > 0 ? totalMs : null;
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600), minutes = Math.floor((totalSeconds % 3600) / 60), seconds = totalSeconds % 60;
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
    if (timers.length === 0) delete inventory['__timers__']; else inventory['__timers__'] = JSON.stringify(timers);
}
function loadStopwatches(inventory: Inventory | undefined): StopwatchEntry[] {
    if (!inventory || typeof inventory['__stopwatches__'] !== 'string') return [];
    try { return JSON.parse(inventory['__stopwatches__'] as string); } catch { return []; }
}
function saveStopwatches(inventory: Inventory, stopwatches: StopwatchEntry[]): void {
    if (stopwatches.length === 0) delete inventory['__stopwatches__']; else inventory['__stopwatches__'] = JSON.stringify(stopwatches);
}

// ─── Timer ──────────────────────────────────────────────────────────

function executeTimer(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('timer', args, 'timer set <name> <duration> | timer check [name] | timer delete <name> | timer list');
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const currentMessage = findPreviousMessage(interactionData, nextMessage.character.id);
    const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
    const timers = loadTimers(inventory);
    const now = Date.now();

    switch (subcommand) {
        case 'set': {
            if (parts.length < 3) return { toolType: 'timer', args, content: '[Error: Usage: timer set <name> <duration>]', displayReplacement: '[Error: Usage: timer set <name> <duration>]' };
            const name = parts[1], durationStr = parts.slice(2).join(' '), durationMs = parseDurationToMs(durationStr);
            if (!durationMs) return { toolType: 'timer', args, content: `[Error: Invalid duration "${durationStr}"]`, displayReplacement: `[Error: Invalid duration]` };
            const filtered = timers.filter(t => t.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, targetTimestamp: now + durationMs });
            saveTimers(inventory, filtered); nextMessage.inventory = inventory;
            return { toolType: 'timer', args, content: `Timer "${name}" set for ${formatDuration(durationMs)}.`, displayReplacement: `[⏱️ Timer "${name}" set: ${formatDuration(durationMs)}]` };
        }
        case 'check': {
            const specificName = parts.slice(1).join(' ').toLowerCase();
            if (specificName) {
                const timer = timers.find(t => t.name.toLowerCase() === specificName);
                if (!timer) return { toolType: 'timer', args, content: `No timer named "${specificName}".`, displayReplacement: `[⏱️ No timer: "${specificName}"]` };
                const remaining = timer.targetTimestamp - now;
                if (remaining <= 0) return { toolType: 'timer', args, content: `Timer "${timer.name}" has EXPIRED.`, displayReplacement: `[⏱️ "${timer.name}": EXPIRED]` };
                return { toolType: 'timer', args, content: `Timer "${timer.name}": ${formatDuration(remaining)} remaining.`, displayReplacement: `[⏱️ "${timer.name}": ${formatDuration(remaining)} left]` };
            }
            if (timers.length === 0) return { toolType: 'timer', args, content: 'No active timers.', displayReplacement: '[⏱️ No active timers]' };
            return { toolType: 'timer', args, content: timers.map(t => { const r = t.targetTimestamp - now; return r <= 0 ? `${t.name}: EXPIRED` : `${t.name}: ${formatDuration(r)} remaining`; }).join('\n'), displayReplacement: `[⏱️ ${timers.length} timer(s)]` };
        }
        case 'delete': {
            if (parts.length < 2) return { toolType: 'timer', args, content: '[Error: Usage: timer delete <name>]', displayReplacement: '[Error: Usage: timer delete <name>]' };
            const name = parts.slice(1).join(' ').toLowerCase();
            const idx = timers.findIndex(t => t.name.toLowerCase() === name);
            if (idx === -1) return { toolType: 'timer', args, content: `No timer named "${name}".`, displayReplacement: `[⏱️ No timer: "${name}"]` };
            const deletedName = timers[idx].name; timers.splice(idx, 1);
            saveTimers(inventory, timers); nextMessage.inventory = inventory;
            return { toolType: 'timer', args, content: `Timer "${deletedName}" deleted.`, displayReplacement: `[⏱️ Deleted: "${deletedName}"]` };
        }
        case 'list': {
            if (timers.length === 0) return { toolType: 'timer', args, content: 'No active timers.', displayReplacement: '[⏱️ No active timers]' };
            return { toolType: 'timer', args, content: timers.map(t => { const r = t.targetTimestamp - now; return r <= 0 ? `${t.name}: EXPIRED` : `${t.name}: ${formatDuration(r)} remaining`; }).join('\n'), displayReplacement: `[⏱️ ${timers.length} timer(s)]` };
        }
        default: return { toolType: 'timer', args, content: `[Error: Unknown timer command "${subcommand}". Use set, check, delete, or list.]`, displayReplacement: `[Error: Unknown timer command]` };
    }
}

// ─── Stopwatch ──────────────────────────────────────────────────────

function executeStopwatch(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('stopwatch', args, 'stopwatch start|stop|pause|resume|reset|check|list <name>');
    }

    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const currentMessage = findPreviousMessage(interactionData, nextMessage.character.id);
    const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
    const stopwatches = loadStopwatches(inventory);
    const now = Date.now();

    switch (subcommand) {
        case 'start': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch start <name>]', displayReplacement: '[Error: Usage: stopwatch start <name>]' };
            const name = parts.slice(1).join(' ');
            const filtered = stopwatches.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, startTimestamp: now }); saveStopwatches(inventory, filtered); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopwatch "${name}" started.`, displayReplacement: `[⏱️ Stopwatch "${name}" started]` };
        }
        case 'pause': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch pause <name>]', displayReplacement: '[Error: Usage: stopwatch pause <name>]' };
            const sw = stopwatches.find(s => s.name.toLowerCase() === parts.slice(1).join(' ').toLowerCase());
            if (!sw) return { toolType: 'stopwatch', args, content: `No stopwatch named "${parts.slice(1).join(' ')}".`, displayReplacement: `[⏱️ No stopwatch]` };
            if (sw.pausedElapsedMs !== undefined) return { toolType: 'stopwatch', args, content: `Already paused.`, displayReplacement: `[⏱️ Already paused]` };
            sw.pausedElapsedMs = now - sw.startTimestamp; saveStopwatches(inventory, stopwatches); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Paused at ${formatDuration(sw.pausedElapsedMs)}.`, displayReplacement: `[⏱️ Paused: ${formatDuration(sw.pausedElapsedMs)}]` };
        }
        case 'resume': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch resume <name>]', displayReplacement: '[Error: Usage: stopwatch resume <name>]' };
            const sw = stopwatches.find(s => s.name.toLowerCase() === parts.slice(1).join(' ').toLowerCase());
            if (!sw) return { toolType: 'stopwatch', args, content: `No stopwatch.`, displayReplacement: `[⏱️ No stopwatch]` };
            if (sw.pausedElapsedMs === undefined) return { toolType: 'stopwatch', args, content: `Not paused.`, displayReplacement: `[⏱️ Not paused]` };
            sw.startTimestamp = now - sw.pausedElapsedMs; delete sw.pausedElapsedMs; saveStopwatches(inventory, stopwatches); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Resumed.`, displayReplacement: `[⏱️ Resumed]` };
        }
        case 'stop': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch stop <name>]', displayReplacement: '[Error: Usage: stopwatch stop <name>]' };
            const idx = stopwatches.findIndex(s => s.name.toLowerCase() === parts.slice(1).join(' ').toLowerCase());
            if (idx === -1) return { toolType: 'stopwatch', args, content: `No stopwatch.`, displayReplacement: `[⏱️ No stopwatch]` };
            const sw = stopwatches[idx], elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
            stopwatches.splice(idx, 1); saveStopwatches(inventory, stopwatches); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopped at ${formatDuration(elapsed)}.`, displayReplacement: `[⏱️ Stopped: ${formatDuration(elapsed)}]` };
        }
        case 'reset': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch reset <name>]', displayReplacement: '[Error: Usage: stopwatch reset <name>]' };
            const sw = stopwatches.find(s => s.name.toLowerCase() === parts.slice(1).join(' ').toLowerCase());
            if (!sw) return { toolType: 'stopwatch', args, content: `No stopwatch.`, displayReplacement: `[⏱️ No stopwatch]` };
            sw.startTimestamp = now; delete sw.pausedElapsedMs; saveStopwatches(inventory, stopwatches); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Reset.`, displayReplacement: `[⏱️ Reset]` };
        }
        case 'check': {
            const specificName = parts.slice(1).join(' ').toLowerCase();
            if (specificName) {
                const sw = stopwatches.find(s => s.name.toLowerCase() === specificName);
                if (!sw) return { toolType: 'stopwatch', args, content: `No stopwatch.`, displayReplacement: `[⏱️ No stopwatch]` };
                const elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
                const status = sw.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING';
                return { toolType: 'stopwatch', args, content: `${sw.name}: ${formatDuration(elapsed)} (${status})`, displayReplacement: `[⏱️ ${sw.name}: ${formatDuration(elapsed)} ${status}]` };
            }
            if (stopwatches.length === 0) return { toolType: 'stopwatch', args, content: 'No active stopwatches.', displayReplacement: '[⏱️ No active stopwatches]' };
            return { toolType: 'stopwatch', args, content: stopwatches.map(s => { const e = s.pausedElapsedMs !== undefined ? s.pausedElapsedMs : now - s.startTimestamp; return `${s.name}: ${formatDuration(e)} (${s.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING'})`; }).join('\n'), displayReplacement: `[⏱️ ${stopwatches.length} stopwatch(es)]` };
        }
        case 'list': {
            if (stopwatches.length === 0) return { toolType: 'stopwatch', args, content: 'No active stopwatches.', displayReplacement: '[⏱️ No active stopwatches]' };
            return { toolType: 'stopwatch', args, content: stopwatches.map(s => { const e = s.pausedElapsedMs !== undefined ? s.pausedElapsedMs : now - s.startTimestamp; return `${s.name}: ${formatDuration(e)} (${s.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING'})`; }).join('\n'), displayReplacement: `[⏱️ ${stopwatches.length} stopwatch(es)]` };
        }
        default: return { toolType: 'stopwatch', args, content: `[Error: Unknown stopwatch command "${subcommand}"]`, displayReplacement: `[Error: Unknown stopwatch command]` };
    }
}

// ─── Calculator ─────────────────────────────────────────────────────

function executeCalculator(expression: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    if (!expression.trim()) {
        return helpResult('calculator', expression, 'calculator <expression> — evaluate math (supports +, -, *, /, (), %, ^)');
    }
    try {
        const sanitized = expression.trim();
        if (!/^[\d\s+\-*/().,%^eE]+$/.test(sanitized)) return { toolType: 'calculator', args: expression, content: '[Error: Invalid characters]', displayReplacement: '[Error: Invalid characters]' };
        if (/[eE](?![+-]?\d)/.test(sanitized)) return { toolType: 'calculator', args: expression, content: '[Error: Malformed scientific notation]', displayReplacement: '[Error: Malformed notation]' };
        const evaluable = sanitized.replace(/\^/g, '**');
        if (!/^[\d\s+\-*/().,%*eE]+$/.test(evaluable)) return { toolType: 'calculator', args: expression, content: '[Error: Disallowed constructs]', displayReplacement: '[Error: Disallowed constructs]' };
        const result = new Function(`"use strict"; return (${evaluable})`)();
        if (typeof result !== 'number' || !Number.isFinite(result)) return { toolType: 'calculator', args: expression, content: '[Error: Invalid result]', displayReplacement: '[Error: Invalid result]' };
        const formatted = Number.isInteger(result) ? result.toString() : Number.parseFloat(result.toFixed(10)).toString();
        return { toolType: 'calculator', args: expression, content: formatted, displayReplacement: formatted };
    } catch (e) {
        const errorContent = `[Error: Calculation failed - ${(e as Error).message}]`;
        return { toolType: 'calculator', args: expression, content: errorContent, displayReplacement: errorContent };
    }
}

// ─── Web ────────────────────────────────────────────────────────────

async function executeWeb(query: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): Promise<ToolResult> {
    if (!query.trim()) {
        return helpResult('web', query, 'web <query or URL> — search the web or fetch a webpage directly');
    }
    try {
        const trimmedQuery = query.trim();
        const isDirectUrl = /^https?:\/\//i.test(trimmedQuery);
        const urlToFetch = isDirectUrl ? trimmedQuery : buildSearchUrl([trimmedQuery], 'DuckDuckGo');
        const results = await fetchLinkContent(urlToFetch, { maxDepth: 0, cacheTimeToLiveMs: 5 * 60 * 1000, fetchMode: 'full', includeImages: false });
        const validResults = results.filter(r => !r.error && r.content.length > 0);
        if (validResults.length === 0) {
            const errorMsg = results[0]?.error || 'No content retrieved';
            const label = isDirectUrl ? `Fetched: "${trimmedQuery}"` : `Searched: "${trimmedQuery}"`;
            return { toolType: 'web', args: query, content: `[Error: ${errorMsg}]`, displayReplacement: `[🌐 ${label}]\n\n[Error: ${errorMsg}]` };
        }
        const result = validResults[0];
        const label = isDirectUrl ? `Fetched: "${trimmedQuery}"` : `Searched: "${trimmedQuery}"`;
        return { toolType: 'web', args: query, content: result.content, displayReplacement: `[🌐 ${label}]\n\n${result.content}` };
    } catch (e) {
        const errorContent = `[Error: Web request failed - ${(e as Error).message}]`;
        return { toolType: 'web', args: query, content: errorContent, displayReplacement: errorContent };
    }
}

// ─── Dialogue ──────────────────────────────────────────────────────

function executeDialogue(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    const character = nextMessage.character;
    const dialoguePrompts = character.dialoguePrompts;

    if (!dialoguePrompts || dialoguePrompts.length === 0) {
        return helpResult('dialogue', args, 'dialogue — no dialogue prompts configured for this character');
    }

    if (!trimmed) {
        return helpResult('dialogue', args, 'dialogue list | dialogue recall — recall active dialogue instructions');
    }

    const subcommand = trimmed.split(/\s+/)[0]?.toLowerCase();

    if (subcommand === 'list') {
        const entries = dialoguePrompts.map(dp => {
            const hasTriggers = (dp.regularExpressionActivationTriggers?.length ?? 0) > 0;
            const bindings = dp.dialoguePromptBindings?.length ?? 0;
            return `${dp.name} (${dp.id})${hasTriggers ? ' [regex]' : ''}${bindings > 0 ? ` [→${bindings}]` : ''}`;
        });
        return {
            toolType: 'dialogue',
            args,
            content: entries.join('\n'),
            displayReplacement: `[💬 ${entries.length} dialogue prompt(s)]`,
        };
    }

    if (subcommand === 'recall') {
        const textContentArray: string[] = [];
        for (const msg of interactionData.interactionHistory) {
            if (msg.messageType === 'chat') {
                textContentArray.push(msg.textContent);
            }
        }
        const searchSpace = buildDialogueSearchSpace(textContentArray);

        const recalledContents = collectActiveDialoguePromptContent(character.dialoguePrompts, searchSpace);

        if (recalledContents.length === 0) {
            const activeCount = getActiveDialoguePrompts(character.dialoguePrompts, searchSpace).length;
            const msg = activeCount === 0
                ? 'No active dialogue prompts match current conversation state.'
                : 'All active dialogue prompts were skipped by probability.';
            return { toolType: 'dialogue', args, content: msg, displayReplacement: '[💬 No active dialogue prompts]' };
        }

        const combined = recalledContents.join('\n\n');
        return {
            toolType: 'dialogue',
            args,
            content: combined,
            displayReplacement: `[💬 Recalled ${recalledContents.length} dialogue instruction(s)]`,
        };
    }

    return {
        toolType: 'dialogue',
        args,
        content: `[Error: Unknown dialogue command "${subcommand}". Use list or recall.]`,
        displayReplacement: `[Error: Unknown dialogue command]`,
    };
}

// ─── Lookup ────────────────────────────────────────────────────────

function executeLookup(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const query = args.trim().toLowerCase();
    if (!query) {
        return helpResult('lookup', args, 'lookup <keyword> — search contexts and lore by keyword');
    }
    const contexts = interactionData.contexts || [];
    const matches: { id: string; name: string; snippet: string }[] = [];
    for (const context of contexts) {
        const searchText = `${context.name || ''} ${context.description || ''} ${context.text || ''}`.toLowerCase();
        if (searchText.includes(query)) {
            const matchIndex = searchText.indexOf(query);
            const start = Math.max(0, matchIndex - 50), end = Math.min(searchText.length, matchIndex + query.length + 100);
            let snippet = (context.text || context.description || '').substring(start, end).trim();
            if (start > 0) snippet = '...' + snippet;
            if (end < searchText.length) snippet = snippet + '...';
            matches.push({ id: context.id, name: context.name || 'Untitled', snippet });
        }
    }
    if (matches.length === 0) return { toolType: 'lookup', args, content: `No results for "${args.trim()}".`, displayReplacement: `[🔍 No results for "${args.trim()}"]` };
    return { toolType: 'lookup', args, content: matches.map(m => `[${m.name} (${m.id})] ${m.snippet}`).join('\n\n'), displayReplacement: `[🔍 Found ${matches.length} result(s) for "${args.trim()}"]` };
}

// ─── Map ────────────────────────────────────────────────────────────

function executeMap(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('map', args, 'map <location_id> or map <loc1_id> to <loc2_id> — distance between locations');
    }
    const locations = interactionData.locations || [];
    if (locations.length === 0) return { toolType: 'map', args, content: '[Error: No locations available.]', displayReplacement: '[Error: No locations]' };

    const toMatch = trimmed.match(/^(\S+)\s+to\s+(\S+)$/i);
    let fromLoc: Location | undefined, toLoc: Location | undefined;
    if (toMatch) { fromLoc = locations.find(l => l.id === toMatch[1].trim()); toLoc = locations.find(l => l.id === toMatch[2].trim()); }
    else {
        let currentLocationIndex: number | undefined;
        for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) { if (interactionData.interactionHistory[i].locationIndex !== undefined) { currentLocationIndex = interactionData.interactionHistory[i].locationIndex; break; } }
        if (currentLocationIndex !== undefined) fromLoc = locations[currentLocationIndex];
        toLoc = locations.find(l => l.id === trimmed);
    }
    if (!toLoc) return { toolType: 'map', args, content: `[Error: Location ID "${trimmed}" not found.]`, displayReplacement: `[Error: Location not found]` };
    if (!fromLoc) return { toolType: 'map', args, content: '[Error: No current location. Use "map <loc1> to <loc2>" format.]', displayReplacement: '[Error: No current location]' };
    if (fromLoc.id === toLoc.id) return { toolType: 'map', args, content: `Already at "${toLoc.name}".`, displayReplacement: `[🗺️ Already at "${toLoc.name}"]` };

    let distanceKm = fromLoc.locationDistances?.[toLoc.id];
    if (distanceKm === undefined) {
        const R = 6371, dLat = (toLoc.latitude - fromLoc.latitude) * Math.PI / 180, dLon = (toLoc.longitude - fromLoc.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(fromLoc.latitude * Math.PI / 180) * Math.cos(toLoc.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    const rounded = Math.round(distanceKm * 10) / 10;
    return { toolType: 'map', args, content: `Distance: ${rounded} km. ~${Math.round((distanceKm / 5) * 10) / 10}h walking, ~${Math.round((distanceKm / 30) * 10) / 10}h riding.`, displayReplacement: `[🗺️ ${fromLoc.name} → ${toLoc.name}: ${rounded} km]` };
}

// ─── Audio ──────────────────────────────────────────────────────────

function executeAudio(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('audio', args, 'audio play <track_id> | audio stop <track_id>');
    }
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const trackId = parts.slice(1).join(' ').trim();
    if (!trackId) return { toolType: 'audio', args, content: `[Error: Usage: audio ${subcommand || 'play'} <track_id>]`, displayReplacement: `[Error: Missing track_id]` };
    if (subcommand !== 'play' && subcommand !== 'stop') return { toolType: 'audio', args, content: `[Error: Unknown audio command "${subcommand}". Use play or stop.]`, displayReplacement: `[Error: Unknown command]` };

    const track = interactionData.audioTracks?.find(t => t.id === trackId);
    if (!track) return { toolType: 'audio', args, content: `[Error: Track ID "${trackId}" not found]`, displayReplacement: `[Error: Track not found]` };
    if (!track.playableByParticipants) return { toolType: 'audio', args, content: `[Error: Track not playable by participants]`, displayReplacement: `[Error: Not playable]` };

    const audioEngine = getAudioEngine();
    if (subcommand === 'play') { audioEngine.startTrack(track); return { toolType: 'audio', args, content: `Playing "${track.name}"`, displayReplacement: `[🔊 Playing "${track.name}"]` }; }
    else { audioEngine.stopTrack(track.id); return { toolType: 'audio', args, content: `Stopped "${track.name}"`, displayReplacement: `[🔇 Stopped "${track.name}"]` }; }
}

// ─── Note ──────────────────────────────────────────────────────────

function executeNote(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('note', args, 'note set <key> <text> | note get <key> | note delete <key> | note list');
    }
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const currentMessage = findPreviousMessage(interactionData, nextMessage.character.id);
    let notes: Record<string, string> = {};
    if (currentMessage?.inventory && typeof currentMessage.inventory['__notes__'] === 'string') { try { notes = JSON.parse(currentMessage.inventory['__notes__'] as string); } catch { notes = {}; } }

    switch (subcommand) {
        case 'list': { const entries = Object.entries(notes); if (entries.length === 0) return { toolType: 'note', args, content: 'No notes.', displayReplacement: '[📝 No notes]' }; return { toolType: 'note', args, content: entries.map(([k, v]) => `${k}: ${v}`).join('\n'), displayReplacement: `[📝 ${entries.length} note(s)]` }; }
        case 'set': { if (parts.length < 3) return { toolType: 'note', args, content: '[Error: Usage: note set <key> <text>]', displayReplacement: '[Error: Usage: note set <key> <text>]' }; const key = parts[1], text = parts.slice(2).join(' '); notes[key] = text; const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {}; inventory['__notes__'] = JSON.stringify(notes); nextMessage.inventory = inventory; return { toolType: 'note', args, content: `Saved "${key}".`, displayReplacement: `[📝 Saved: "${key}"]` }; }
        case 'get': { if (parts.length < 2) return { toolType: 'note', args, content: '[Error: Usage: note get <key>]', displayReplacement: '[Error: Usage: note get <key>]' }; const value = notes[parts[1]]; if (value === undefined) return { toolType: 'note', args, content: `Not found: "${parts[1]}".`, displayReplacement: `[📝 Not found: "${parts[1]}"]` }; return { toolType: 'note', args, content: value, displayReplacement: `[📝 ${parts[1]}: ${value}]` }; }
        case 'delete': { if (parts.length < 2) return { toolType: 'note', args, content: '[Error: Usage: note delete <key>]', displayReplacement: '[Error: Usage: note delete <key>]' }; if (notes[parts[1]] === undefined) return { toolType: 'note', args, content: `Not found.`, displayReplacement: `[📝 Not found]` }; delete notes[parts[1]]; const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {}; if (Object.keys(notes).length === 0) delete inventory['__notes__']; else inventory['__notes__'] = JSON.stringify(notes); nextMessage.inventory = inventory; return { toolType: 'note', args, content: `Deleted "${parts[1]}".`, displayReplacement: `[📝 Deleted: "${parts[1]}"]` }; }
        default: return { toolType: 'note', args, content: `[Error: Unknown note command "${subcommand}"]`, displayReplacement: `[Error: Unknown note command]` };
    }
}

// ─── Inventory ──────────────────────────────────────────────────────

function executeInventory(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('inventory', args, 'inventory list | inventory add <item> <qty> | inventory remove <item> <qty> | inventory set <item> <value>');
    }
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const currentMessage = findPreviousMessage(interactionData, nextMessage.character.id);
    const inventory: Inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};

    switch (subcommand) {
        case 'list': return { toolType: 'inventory', args, content: '[Inventory listed in prompt context]', displayReplacement: '[📦 Inventory listed above]' };
        case 'add': { if (parts.length < 3) return { toolType: 'inventory', args, content: '[Error: Usage: inventory add <item> <qty>]', displayReplacement: '[Error: Usage]' }; const item = parts.slice(1, -1).join(' '), qty = Number(parts[parts.length - 1]); if (!item || isNaN(qty) || qty <= 0) return { toolType: 'inventory', args, content: '[Error: Invalid item or quantity]', displayReplacement: '[Error: Invalid]' }; const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0; inventory[item] = current + qty; nextMessage.inventory = inventory; return { toolType: 'inventory', args, content: `Added ${qty}x "${item}"`, displayReplacement: `[📦 Added ${qty}x "${item}"]` }; }
        case 'remove': { if (parts.length < 3) return { toolType: 'inventory', args, content: '[Error: Usage: inventory remove <item> <qty>]', displayReplacement: '[Error: Usage]' }; const item = parts.slice(1, -1).join(' '), qty = Number(parts[parts.length - 1]); if (!item || isNaN(qty) || qty <= 0) return { toolType: 'inventory', args, content: '[Error: Invalid]', displayReplacement: '[Error: Invalid]' }; const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0; const nv = current - qty; if (nv <= 0) delete inventory[item]; else inventory[item] = nv; nextMessage.inventory = inventory; return { toolType: 'inventory', args, content: `Removed ${qty}x "${item}"`, displayReplacement: `[📦 Removed ${qty}x "${item}"]` }; }
        case 'set': { if (parts.length < 3) return { toolType: 'inventory', args, content: '[Error: Usage: inventory set <item> <value>]', displayReplacement: '[Error: Usage]' }; const item = parts.slice(1, -1).join(' '), rawValue = parts[parts.length - 1]; if (!item) return { toolType: 'inventory', args, content: '[Error: Invalid item]', displayReplacement: '[Error: Invalid]' }; const numValue = Number(rawValue); inventory[item] = !isNaN(numValue) ? numValue : rawValue; nextMessage.inventory = inventory; return { toolType: 'inventory', args, content: `Set "${item}"`, displayReplacement: `[📦 Set "${item}"]` }; }
        default: return { toolType: 'inventory', args, content: `[Error: Unknown inventory command "${subcommand}"]`, displayReplacement: `[Error: Unknown command]` };
    }
}

// ─── Invite ─────────────────────────────────────────────────────────

function executeInvite(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('invite', args, 'invite <character_id> — bring existing participant to current location');
    }
    const allChars = context?.allCharacters || interactionData.participants || [];
    const targetChar = allChars.find(c => c.id === trimmed);
    if (!targetChar) return { toolType: 'invite', args, content: `[Error: Character ID "${trimmed}" not found.]`, displayReplacement: `[Error: Not found]` };
    if (targetChar.id === interactionData.protagonist?.id) return { toolType: 'invite', args, content: '[Error: Cannot invite protagonist. Use summon.]', displayReplacement: `[Error: Cannot invite protagonist]` };
    if (!interactionData.participants.some(p => p.id === targetChar.id)) return { toolType: 'invite', args, content: '[Error: Not a participant. Use summon.]', displayReplacement: `[Error: Not a participant]` };
    appendPendingAction(nextMessage, { type: 'invite', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'invite', args, content: `Invited ${targetChar.name}.`, displayReplacement: `[📨 Invited ${targetChar.name}]` };
}

// ─── Kick ───────────────────────────────────────────────────────────

function executeKick(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('kick', args, 'kick locations | kick characters | kick <character_id> [location_id]');
    }
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    if (subcommand === 'locations') {
        const kicker = nextMessage.character;
        const reachable = getReachableLocationsByCharacter(interactionData, kicker)
            .filter(({ location }) => {
                const kickerLocIdx = getCurrentLocationIndex(interactionData, kicker);
                const kickerLocId = kickerLocIdx !== undefined ? interactionData.locations?.[kickerLocIdx]?.id : undefined;
                return !(kickerLocId && location.id === kickerLocId);
            });
        if (reachable.length === 0) return { toolType: 'kick', args, content: 'No reachable locations.', displayReplacement: '[👢 No kickable locations]' };
        return { toolType: 'kick', args, content: reachable.map(({ location }) => `${location.name} (${location.id})`).join('\n'), displayReplacement: `[👢 ${reachable.length} location(s)]` };
    }
    if (subcommand === 'characters') {
        const coLocated = getCoLocatedParticipants(interactionData, nextMessage.character);
        if (coLocated.length === 0) return { toolType: 'kick', args, content: 'No co-located characters.', displayReplacement: '[👢 No characters to kick]' };
        return { toolType: 'kick', args, content: coLocated.map(c => `${c.name} (${c.id})`).join('\n'), displayReplacement: `[👢 ${coLocated.length} character(s)]` };
    }

    const targetCharId = subcommand, targetLocationId = parts.length > 1 ? parts[1].trim() : undefined;
    const allChars = context?.allCharacters || interactionData.participants || [];
    const targetChar = allChars.find(c => c.id === targetCharId);
    if (!targetChar) return { toolType: 'kick', args, content: `[Error: Character ID "${targetCharId}" not found.]`, displayReplacement: `[Error: Not found]` };

    const kicker = nextMessage.character;
    const kickerLocIdx = getCurrentLocationIndex(interactionData, kicker);
    const targetLocIdx = getCurrentLocationIndex(interactionData, targetChar);
    if (kickerLocIdx !== targetLocIdx) return { toolType: 'kick', args, content: '[Error: Target not co-located.]', displayReplacement: `[Error: Not co-located]` };

    const kickable = getReachableLocationsByCharacter(interactionData, kicker)
        .filter(({ location }) => {
            const kickerLocId = kickerLocIdx !== undefined ? interactionData.locations?.[kickerLocIdx]?.id : undefined;
            return !(kickerLocId && location.id === kickerLocId);
        });

    let destIndex: number | undefined, destName: string, destId: string;
    if (targetLocationId) {
        const destLoc = interactionData.locations?.find(l => l.id === targetLocationId);
        if (!destLoc) return { toolType: 'kick', args, content: `[Error: Location "${targetLocationId}" not found.]`, displayReplacement: `[Error: Location not found]` };
        if (!kickable.some(({ location }) => location.id === targetLocationId)) return { toolType: 'kick', args, content: '[Error: Destination not reachable or locked.]', displayReplacement: `[Error: Not reachable]` };
        destIndex = interactionData.locations?.findIndex(l => l.id === targetLocationId); destName = destLoc.name; destId = destLoc.id;
    } else {
        if (kickable.length === 0) return { toolType: 'kick', args, content: '[Error: No reachable destinations.]', displayReplacement: `[Error: No destinations]` };
        const pick = kickable[Math.floor(Math.random() * kickable.length)];
        destIndex = pick.locationIndex; destName = pick.location.name; destId = pick.location.id;
    }

    appendPendingAction(nextMessage, { type: 'kick', payload: { characterId: targetChar.id, characterName: targetChar.name, destinationLocationIndex: String(destIndex), destinationLocationName: destName, destinationLocationId: destId } });
    return { toolType: 'kick', args, content: `Kicked ${targetChar.name} to "${destName}".`, displayReplacement: `[👢 Kicked ${targetChar.name} to ${destName}]` };
}

// ─── Teleport ───────────────────────────────────────────────────────

function executeTeleport(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('teleport', args, 'teleport <location_id> — instant movement to any location');
    }
    const locations = interactionData.locations || [];
    if (locations.length === 0) return { toolType: 'teleport', args, content: '[Error: No locations.]', displayReplacement: '[Error: No locations]' };
    const targetLocation = locations.find(l => l.id === trimmed);
    if (!targetLocation) return { toolType: 'teleport', args, content: `[Error: Location "${trimmed}" not found.]`, displayReplacement: `[Error: Not found]` };

    let currentLocationId: string | undefined;
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) { const locIdx = interactionData.interactionHistory[i].locationIndex; if (locIdx !== undefined && locations[locIdx]) { currentLocationId = locations[locIdx].id; break; } }
    if (targetLocation.id === currentLocationId) return { toolType: 'teleport', args, content: `Already at "${targetLocation.name}".`, displayReplacement: `[⚡ Already there]` };

    nextMessage.locationIndex = locations.findIndex(l => l.id === targetLocation.id);
    return { toolType: 'teleport', args, content: `Teleported to "${targetLocation.name}".`, displayReplacement: `[⚡ Teleported to "${targetLocation.name}"]` };
}

// ─── Key ────────────────────────────────────────────────────────────

function executeKey(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('key', args, 'key lock <location_id> [character_id] | key unlock <location_id> [character_id]');
    }
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const locationId = parts[1]?.trim();
    const targetCharId = parts.length > 2 ? parts.slice(2).join(' ').trim() : undefined;

    if (!locationId) return { toolType: 'key', args, content: `[Error: Usage: key ${subcommand || 'lock'} <location_id> [character_id]]`, displayReplacement: `[Error: Missing location_id]` };
    if (subcommand !== 'lock' && subcommand !== 'unlock') return { toolType: 'key', args, content: `[Error: Use lock or unlock.]`, displayReplacement: `[Error: Use lock or unlock]` };

    const locations = interactionData.locations || [];
    const targetLocation = locations.find(l => l.id === locationId);
    if (!targetLocation) return { toolType: 'key', args, content: `[Error: Location "${locationId}" not found.]`, displayReplacement: `[Error: Not found]` };

    const charsToModify: string[] = targetCharId
        ? [targetCharId]
        : interactionData.participants.map(p => p.id);

    const lockedLocations = nextMessage.characterLockedLocations
        ? { ...nextMessage.characterLockedLocations }
        : {};

    if (subcommand === 'lock') {
        const existing = lockedLocations[locationId] ? [...lockedLocations[locationId]] : [];
        for (const charId of charsToModify) {
            if (!existing.includes(charId)) existing.push(charId);
        }
        lockedLocations[locationId] = existing;
        nextMessage.characterLockedLocations = lockedLocations;

        const desc = targetCharId ? `Locked "${targetLocation.name}" for character ${targetCharId}.` : `Locked "${targetLocation.name}" for all characters.`;
        return { toolType: 'key', args, content: desc, displayReplacement: `[🔒 Locked "${targetLocation.name}"]` };
    }

    if (!lockedLocations[locationId] || lockedLocations[locationId].length === 0) {
        return { toolType: 'key', args, content: `"${targetLocation.name}" is not locked.`, displayReplacement: `[🔓 Not locked]` };
    }

    if (targetCharId) {
        lockedLocations[locationId] = lockedLocations[locationId].filter(id => id !== targetCharId);
    } else {
        delete lockedLocations[locationId];
    }

    if (lockedLocations[locationId] && lockedLocations[locationId].length === 0) {
        delete lockedLocations[locationId];
    }

    nextMessage.characterLockedLocations = lockedLocations;

    const desc = targetCharId ? `Unlocked "${targetLocation.name}" for character ${targetCharId}.` : `Unlocked "${targetLocation.name}" for all characters.`;
    return { toolType: 'key', args, content: desc, displayReplacement: `[🔓 Unlocked "${targetLocation.name}"]` };
}

// ─── Clothing ───────────────────────────────────────────────────────

function executeClothing(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('clothing', args, 'clothing <character_id> wear <clothing_id> | clothing <character_id> remove <clothing_id>');
    }
    const wearMatch = trimmed.match(/^(\S+)\s+wear\s+(\S+)$/i);
    const removeMatch = trimmed.match(/^(\S+)\s+remove\s+(\S+)$/i);
    let charId: string, clothingId: string, action: 'wear' | 'remove';
    if (wearMatch) { charId = wearMatch[1].trim(); clothingId = wearMatch[2].trim(); action = 'wear'; }
    else if (removeMatch) { charId = removeMatch[1].trim(); clothingId = removeMatch[2].trim(); action = 'remove'; }
    else return { toolType: 'clothing', args, content: '[Error: Use "clothing <char_id> wear|remove <clothing_id>"]', displayReplacement: `[Error: Invalid syntax]` };

    const allChars = context?.allCharacters || interactionData.participants || [];
    const targetChar = allChars.find(c => c.id === charId);
    if (!targetChar) return { toolType: 'clothing', args, content: `[Error: Character "${charId}" not found.]`, displayReplacement: `[Error: Character not found]` };

    const clothingItem = targetChar.clothings?.find(c => c.id === clothingId);
    if (!clothingItem) return { toolType: 'clothing', args, content: `[Error: Clothing "${clothingId}" not found. Available: ${targetChar.clothings?.map(c => `${c.name} (${c.id})`).join(', ') || 'none'}]`, displayReplacement: `[Error: Clothing not found]` };

    const wearingStatuses = nextMessage.characterClothingWearingStatuses ? { ...nextMessage.characterClothingWearingStatuses } : {};

    if (action === 'wear') {
        if (wearingStatuses[clothingItem.id] === true) return { toolType: 'clothing', args, content: `Already wearing "${clothingItem.name}".`, displayReplacement: `[👕 Already wearing]` };
        wearingStatuses[clothingItem.id] = true;
        for (const boundId of clothingItem.clothingBindings) wearingStatuses[boundId] = false;
        nextMessage.characterClothingWearingStatuses = wearingStatuses;
        return { toolType: 'clothing', args, content: `${targetChar.name} wore "${clothingItem.name}".`, displayReplacement: `[👕 Wore "${clothingItem.name}"]` };
    } else {
        if (wearingStatuses[clothingItem.id] !== true) return { toolType: 'clothing', args, content: `Not wearing "${clothingItem.name}".`, displayReplacement: `[👕 Not wearing]` };
        wearingStatuses[clothingItem.id] = false;
        nextMessage.characterClothingWearingStatuses = wearingStatuses;
        return { toolType: 'clothing', args, content: `${targetChar.name} removed "${clothingItem.name}".`, displayReplacement: `[👕 Removed "${clothingItem.name}"]` };
    }
}

// ─── Summon ─────────────────────────────────────────────────────────

function executeSummon(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('summon', args, 'summon <character_id> — add non-participant character to session');
    }
    const allChars = context?.allCharacters || [];
    const targetChar = allChars.find(c => c.id === trimmed);
    if (!targetChar) return { toolType: 'summon', args, content: `[Error: Character "${trimmed}" does not exist.]`, displayReplacement: `[Error: Not found]` };
    if (interactionData.participants.some(p => p.id === targetChar.id)) return { toolType: 'summon', args, content: '[Error: Already a participant. Use invite.]', displayReplacement: `[Error: Already participant]` };
    appendPendingAction(nextMessage, { type: 'summon', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'summon', args, content: `Summoned ${targetChar.name}.`, displayReplacement: `[✨ Summoned ${targetChar.name}]` };
}

// ─── Narrate ────────────────────────────────────────────────────────

function executeNarrate(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('narrate', args, 'narrate <text> — inject ambient narration without consuming chat stamina');
    }
    return { toolType: 'narrate', args, content: trimmed, displayReplacement: `[🎙️ ${trimmed}]` };
}

// ─── Inspect ────────────────────────────────────────────────────────

function executeInspect(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('inspect', args, 'inspect <character_id> — examine character\'s visible state');
    }
    const allChars = context?.allCharacters || interactionData.participants || [];
    const targetChar = allChars.find(c => c.id === trimmed);
    if (!targetChar) return { toolType: 'inspect', args, content: `[Error: Character "${trimmed}" not found.]`, displayReplacement: `[Error: Not found]` };

    let targetLocationName = 'unknown', lastExpression = 'neutral', itemCount = 0;
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        const msg = interactionData.interactionHistory[i];
        if (msg.character.id === targetChar.id && msg.locationIndex !== undefined) { const loc = interactionData.locations?.[msg.locationIndex]; if (loc) targetLocationName = loc.name; break; }
    }
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) { if (interactionData.interactionHistory[i].character.id === targetChar.id && interactionData.interactionHistory[i].characterExpression) { lastExpression = interactionData.interactionHistory[i].characterExpression!; break; } }
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) { if (interactionData.interactionHistory[i].character.id === targetChar.id && interactionData.interactionHistory[i].inventory) { itemCount = Object.keys(interactionData.interactionHistory[i].inventory!).filter(k => !k.startsWith('__')).length; break; } }

    const wornClothing: { name: string; id: string }[] = [];
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        const msg = interactionData.interactionHistory[i];
        if (msg.character.id === targetChar.id && msg.characterClothingWearingStatuses) {
            for (const clothing of targetChar.clothings || []) { if (msg.characterClothingWearingStatuses[clothing.id] === true) wornClothing.push({ name: clothing.name, id: clothing.id }); }
            break;
        }
    }

    const wornStr = wornClothing.length > 0 ? wornClothing.map(w => `${w.name} (${w.id})`).join(', ') : 'nothing notable';
    return { toolType: 'inspect', args, content: `${targetChar.name} (${targetChar.id}): Location: ${targetLocationName}, Expression: ${lastExpression}, Wearing: ${wornStr}, Items: ${itemCount}`, displayReplacement: `[🔍 ${targetChar.name}: 📍${targetLocationName}, 😊${lastExpression}, 👕${wornClothing.length}, 📦${itemCount}]` };
}

// ─── Administrator ──────────────────────────────────────────────────

function executeAdministrator(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('administrator', args, 'administrator list_chats | move_protagonist <chat_id> | switch_model <model_name> | list_models');
    }
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    switch (subcommand) {
        case 'list_chats': return { toolType: 'administrator', args, content: `Session: "${interactionData.name}" (${interactionData.participants.length} participants, ${interactionData.interactionHistory.length} messages)`, displayReplacement: "[🔧 Session info]" };
        case 'move_protagonist': { const targetChatId = parts.slice(1).join(' '); if (!targetChatId) return { toolType: 'administrator', args, content: '[Error: Usage: administrator move_protagonist <chat_id>]', displayReplacement: '[Error: Missing chat_id]' }; appendPendingAction(nextMessage, { type: 'administrator_move_protagonist', payload: { chatId: targetChatId } }); return { toolType: 'administrator', args, content: `Transfer requested: "${targetChatId}".`, displayReplacement: `[🔧 Transfer: ${targetChatId}]` }; }
        case 'switch_model': { const modelName = parts.slice(1).join(' '); if (!modelName) return { toolType: 'administrator', args, content: '[Error: Usage: administrator switch_model <model_name>]', displayReplacement: '[Error: Missing model_name]' }; appendPendingAction(nextMessage, { type: 'administrator_switch_model', payload: { modelName } }); return { toolType: 'administrator', args, content: `Model switch requested: "${modelName}".`, displayReplacement: `[🔧 Switch: ${modelName}]` }; }
        case 'list_models': return { toolType: 'administrator', args, content: 'Use Language Models panel.', displayReplacement: "[🔧 Use panel]" };
        default: return { toolType: 'administrator', args, content: `[Error: Unknown command "${subcommand}"]`, displayReplacement: `[Error: Unknown command]` };
    }
}

// ─── Creator ────────────────────────────────────────────────────────

const VALID_ENTITY_TYPES = ['character', 'context', 'location', 'audio_track', 'prompt_block', 'stop_pattern', 'sampler', 'budget_strategy', 'profile', 'world', 'memory', 'extension'];

function executeCreator(args: string, nextMessage: BaseMessage, _interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('creator', args, `creator <entity_type> <name> — types: ${VALID_ENTITY_TYPES.join(', ')}`);
    }
    const parts = trimmed.split(/\s+/);
    const entityType = parts[0]?.toLowerCase(), entityName = parts.slice(1).join(' ');
    if (!entityName) return { toolType: 'creator', args, content: `[Error: Usage: creator ${entityType || '<type>'} <name>]`, displayReplacement: `[Error: Missing name]` };
    if (!VALID_ENTITY_TYPES.includes(entityType)) return { toolType: 'creator', args, content: `[Error: Unknown type "${entityType}". Valid: ${VALID_ENTITY_TYPES.join(', ')}]`, displayReplacement: `[Error: Unknown type]` };
    appendPendingAction(nextMessage, { type: 'creator', payload: { entityType, entityName } });
    context?.addToast?.(`Creator: ${entityType} "${entityName}" initiated.`, 'info');
    return { toolType: 'creator', args, content: `Creation: ${entityType} "${entityName}".`, displayReplacement: `[🛠️ ${entityType}: "${entityName}"]` };
}

// ─── Destroyer ──────────────────────────────────────────────────────

function executeDestroyer(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('destroyer', args, `destroyer <entity_type> <entity_id> — types: ${VALID_ENTITY_TYPES.join(', ')}`);
    }
    const parts = trimmed.split(/\s+/);
    const entityType = parts[0]?.toLowerCase(), entityId = parts.slice(1).join(' ').trim();
    if (!entityId) return { toolType: 'destroyer', args, content: `[Error: Usage: destroyer ${entityType || '<type>'} <entity_id>]`, displayReplacement: `[Error: Missing entity_id]` };
    if (!VALID_ENTITY_TYPES.includes(entityType)) return { toolType: 'destroyer', args, content: `[Error: Unknown type "${entityType}". Valid: ${VALID_ENTITY_TYPES.join(', ')}]`, displayReplacement: `[Error: Unknown type]` };

    let targetName = entityId;
    switch (entityType) {
        case 'character': {
            const t = (context?.allCharacters || []).find(c => c.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Character ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            if (t.id === interactionData.protagonist?.id) return { toolType: 'destroyer', args, content: '[Error: Cannot destroy protagonist.]', displayReplacement: `[💀 Cannot destroy protagonist]` };
            targetName = t.name;
            break;
        }
        case 'context': {
            const t = (context?.allContexts || interactionData.contexts || []).find(c => c.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Context ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'location': {
            const t = (context?.allLocations || interactionData.locations || []).find(l => l.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Location ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'audio_track': {
            const t = (context?.allAudioTracks || interactionData.audioTracks || []).find(a => a.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Audio track ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'prompt_block': {
            const t = (context?.allPromptBlocks || []).find(p => p.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Prompt block ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'stop_pattern': {
            const t = (context?.allStopPatterns || []).find(s => s.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Stop pattern ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'sampler': {
            const t = (context?.allSamplers || []).find(s => s.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Sampler ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'budget_strategy': {
            const t = (context?.allBudgetStrategies || []).find(b => b.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Budget strategy ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'profile': {
            const t = (context?.allProfiles || []).find(p => p.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Profile ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'world': {
            const t = (context?.allWorlds || []).find(w => w.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: World ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'memory': {
            const t = (context?.allMemories || []).find(m => m.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Memory ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
        case 'extension': {
            const t = (context?.allExtensions || []).find(e => e.id === entityId);
            if (!t) return { toolType: 'destroyer', args, content: `[Error: Extension ID "${entityId}" not found.]`, displayReplacement: `[💀 Not found]` };
            targetName = t.name;
            break;
        }
    }

    appendPendingAction(nextMessage, { type: 'destroyer', payload: { entityType, entityId, entityName: targetName } });
    context?.addToast?.(`Destroyer: ${entityType} "${targetName}" initiated.`, 'info');
    return { toolType: 'destroyer', args, content: `Deletion: ${entityType} "${targetName}" (${entityId}). Irreversible.`, displayReplacement: `[💀 ${entityType}: "${targetName}"]` };
}

// ─── Process Pending Tool Actions ───────────────────────────────────

export function processPendingToolActions(
    data: InteractionData,
    allCharacters: Character[],
    options?: { onToast?: (msg: string, type: 'success' | 'error' | 'info') => void }
): InteractionData {
    let lastAiCharId: string | null = null;
    for (let i = data.interactionHistory.length - 1; i >= 0; i--) {
        const msg = data.interactionHistory[i];
        if (msg.messageType === 'chat' && msg.character.id !== data.protagonist.id) { lastAiCharId = msg.character.id; break; }
    }
    if (!lastAiCharId) return data;

    const findPrevMsg = (d: InteractionData, charId: string) => {
        for (let i = d.interactionHistory.length - 1; i >= 0; i--) { if (d.interactionHistory[i].character.id === charId) return d.interactionHistory[i]; }
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
                if (updatedData.participants.some(p => p.id === charId)) break;
                const realCharacter = allCharacters.find(c => c.id === charId);
                if (!realCharacter) { options?.onToast?.(`⚠️ Cannot summon "${action.payload.characterName}": not found.`, 'error'); break; }
                updatedData = { ...updatedData, participants: [...updatedData.participants, { ...realCharacter }] };
                changed = true;
                options?.onToast?.(`✨ ${realCharacter.name} joined.`, 'info');
                break;
            }
            case 'kick': {
                const kickedChar = updatedData.participants.find(p => p.id === action.payload.characterId);
                if (kickedChar) {
                    const destLocIdx = action.payload.destinationLocationIndex !== undefined ? parseInt(action.payload.destinationLocationIndex, 10) : undefined;
                    const prevKickedMsg = findPrevMsg(updatedData, kickedChar.id);
                    const prevLockedLocations = prevKickedMsg?.characterLockedLocations ?? {};
                    const kickMsg = {
                        messageType: 'interaction' as const, id: uuidv4(), character: { ...kickedChar },
                        locationIndex: destLocIdx,
                        characterClothingWearingStatuses: (prevKickedMsg as ChatMessage)?.characterClothingWearingStatuses ?? {},
                        characterLockedLocations: { ...prevLockedLocations },
                        parentInteractionMessageId: updatedData.interactionHistory[updatedData.interactionHistory.length - 1]?.id ?? null,
                        firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
                    };
                    updatedData = { ...updatedData, interactionHistory: [...updatedData.interactionHistory, kickMsg] };
                    changed = true;
                    options?.onToast?.(`👢 ${action.payload.characterName} kicked to ${action.payload.destinationLocationName || 'unknown'}.`, 'info');
                }
                break;
            }
            case 'invite': {
                const invitedChar = updatedData.participants.find(p => p.id === action.payload.characterId);
                if (invitedChar) {
                    let currentLocIdx: number | undefined;
                    for (let i = updatedData.interactionHistory.length - 1; i >= 0; i--) { if (updatedData.interactionHistory[i].locationIndex !== undefined) { currentLocIdx = updatedData.interactionHistory[i].locationIndex; break; } }
                    const prevInvitedMsg = findPrevMsg(updatedData, invitedChar.id);
                    const prevLockedLocations = prevInvitedMsg?.characterLockedLocations ?? {};
                    const inviteMsg = {
                        messageType: 'interaction' as const, id: uuidv4(), character: { ...invitedChar },
                        locationIndex: currentLocIdx,
                        characterClothingWearingStatuses: (prevInvitedMsg as ChatMessage)?.characterClothingWearingStatuses ?? {},
                        characterLockedLocations: { ...prevLockedLocations },
                        parentInteractionMessageId: updatedData.interactionHistory[updatedData.interactionHistory.length - 1]?.id ?? null,
                        firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
                    };
                    updatedData = { ...updatedData, interactionHistory: [...updatedData.interactionHistory, inviteMsg] };
                    changed = true;
                    options?.onToast?.(`📨 ${action.payload.characterName} arrived.`, 'info');
                }
                break;
            }
            case 'administrator_move_protagonist': options?.onToast?.(`🔧 Transfer to "${action.payload.chatId}" requested.`, 'info'); break;
            case 'administrator_switch_model': options?.onToast?.(`🔧 Switch to "${action.payload.modelName}" requested.`, 'info'); break;
            case 'creator': options?.onToast?.(`🛠️ ${action.payload.entityType} "${action.payload.entityName}" creation requested.`, 'info'); break;
            case 'destroyer': options?.onToast?.(`💀 ${action.payload.entityType} "${action.payload.entityName}" deletion requested.`, 'info'); break;
        }
    }

    if (!changed) return data;

    const cleanedHistory = [...updatedData.interactionHistory];
    const cleanedMsg = { ...cleanedHistory[targetMsgIdx] } as ChatMessage;
    const cleanedInventory = cleanedMsg.inventory ? { ...cleanedMsg.inventory } : {};
    delete cleanedInventory['__pending_tool_actions__'];
    if (Object.keys(cleanedInventory).length === 0) delete cleanedMsg.inventory; else cleanedMsg.inventory = cleanedInventory;
    cleanedHistory[targetMsgIdx] = cleanedMsg;

    return { ...updatedData, interactionHistory: cleanedHistory, lastUpdatedTimestamp: Date.now() };
}