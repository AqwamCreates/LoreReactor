// src/services/ToolExecutor.ts
import type { ToolInvocation } from '../services/ToolInvocationParser';
import { fetchLinkContent } from '../utilities/linkFetcher';
import { collectActiveDialoguePromptContent, buildDialogueSearchSpace } from '../utilities/dialoguePromptLogic';
import type { BaseMessage, Character, Context, Location, AudioTrack, Profile, InteractionData, Inventory, ChatMessage, WhisperMessage, PromptBlock, StopPattern, Sampler, BudgetStrategy, World, Memory, Extension, Account, MultiplayerData, toolUsageDisplayMode, HistoryMessage } from '../types';
import { findLatestMessage } from '../utilities/messageLogic';
import { getGlobalMessageHistory } from '../utilities/timelineLogic';
import { getCurrentLocation, getReachableLocationsByCharacter, isCharacterLockedFromLocation, getCoLocatedParticipants } from '../utilities/locationLogic';
import { getAudioEngine } from './AudioEngine';
import { generateCharacterMemory } from './ChatMessageSummarizationEngine';
import { saveRawCharacter } from '../storages/serverStorage';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, readFile } from '../utilities/serverTools';
import { buildSearchUrl } from '../utilities/searchURLBuilder';
import { getTimeDataFromCoordinates, type TimeData } from './LocationEngine';

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
    allAccounts?: Account[];
    allMultiplayerData?: MultiplayerData[];
    addToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export interface PendingToolAction {
    type: 'summon' | 'kick' | 'invite' | 'whisper' | 'creator' | 'destroyer' |
          'administrator_move_protagonist' | 'administrator_switch_model' |
          'administrator_toggle_account' | 'administrator_join_session' |
          'administrator_leave_session' | 'administrator_accept_join' | 'administrator_reject_join';
    payload: Record<string, string>;
}

// ─── Python-Style Argument Parser (*args & **kwargs) ────────────────

export class ArgAccessor {
    positional: string[];
    kwargs: Record<string, string>;
    raw: string;

    constructor(
        positional: string[],
        kwargs: Record<string, string>,
        raw: string
    ) {
        this.positional = positional;
        this.kwargs = kwargs;
        this.raw = raw;
    }

    /**
     * Resolves an argument by keyword name (case-insensitive) or falls back to positional index.
     */
    get(index: number, ...names: string[]): string | undefined {
        for (const name of names) {
            const val = this.kwargs[name.toLowerCase()];
            if (val !== undefined && val !== '') {
                return val;
            }
        }
        return this.positional[index];
    }

    getNumber(index: number, ...names: string[]): number | undefined {
        const val = this.get(index, ...names);
        if (val === undefined || val === '') return undefined;
        const n = Number(val);
        return Number.isNaN(n) ? undefined : n;
    }
}

/**
 * Parses Python-style arguments: func(val1, key="value", count=10)
 * Supports positional, keyword arguments, mixed arguments, and quoted strings.
 */
export function parsePythonArgs(rawArgs: string): ArgAccessor {
    const trimmed = rawArgs.trim();
    if (!trimmed) return new ArgAccessor([], {}, rawArgs);

    const rawTokens: string[] = [];
    let current = '';
    let inQuotes: '"' | "'" | null = null;
    let escapeNext = false;
    let depth = 0;

    for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed[i];

        if (escapeNext) {
            current += char;
            escapeNext = false;
            continue;
        }

        if (char === '\\') {
            escapeNext = true;
            continue;
        }

        if (inQuotes) {
            if (char === inQuotes) {
                inQuotes = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            inQuotes = char;
            continue;
        }

        if (char === '(' || char === '[' || char === '{') {
            depth++;
            current += char;
            continue;
        }

        if (char === ')' || char === ']' || char === '}') {
            depth--;
            current += char;
            continue;
        }

        if (char === ',' && depth === 0) {
            if (current.trim().length > 0) {
                rawTokens.push(current.trim());
            }
            current = '';
            continue;
        }

        current += char;
    }

    if (current.trim().length > 0) {
        rawTokens.push(current.trim());
    }

    const positional: string[] = [];
    const kwargs: Record<string, string> = {};

    const cleanValue = (val: string): string => {
        let v = val.trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
        }
        return v;
    };

    for (const token of rawTokens) {
        // Keyword argument: key=val or key: val
        const kwMatch = token.match(/^([a-zA-Z_]\w*)\s*[:=]\s*([\s\S]*)$/);
        if (kwMatch) {
            kwargs[kwMatch[1].toLowerCase()] = cleanValue(kwMatch[2]);
        } else {
            positional.push(cleanValue(token));
        }
    }

    return new ArgAccessor(positional, kwargs, rawArgs);
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

// ─── Entity Resolution Helpers ──────────────────────────────────────

function getSessionCharacters(interactionData: InteractionData | null): Character[] {
    return interactionData?.participants || [];
}

function getGlobalCharacters(interactionData: InteractionData | null, allCharacters: Character[] = []): Character[] {
    const participantIds = new Set((interactionData?.participants || []).map(p => p.id));
    return allCharacters.filter(c => !participantIds.has(c.id));
}

function getSessionLocations(interactionData: InteractionData | null): Location[] {
    return interactionData?.locations || [];
}

function resolveCharacter(idOrName: string, interactionData: InteractionData | null, allCharacters: Character[] = []): Character | undefined {
    const query = idOrName.trim().toLowerCase();
    if (!query) return undefined;
    const participants = getSessionCharacters(interactionData);
    let found = participants.find(c => c.id.toLowerCase() === query || c.name.toLowerCase() === query || c.id.startsWith(query));
    if (found) return found;
    found = allCharacters.find(c => c.id.toLowerCase() === query || c.name.toLowerCase() === query || c.id.startsWith(query));
    return found;
}

function resolveLocation(idOrName: string, interactionData: InteractionData | null): Location | undefined {
    const query = idOrName.trim().toLowerCase();
    if (!query) return undefined;
    const sessionLocs = getSessionLocations(interactionData);
    return sessionLocs.find(l => l.id.toLowerCase() === query || l.name.toLowerCase() === query || l.id.startsWith(query));
}

function getCharacterTimeData(interactionData: InteractionData, character: any): TimeData {
    const location = getCurrentLocation(interactionData, character);
    return getTimeDataFromCoordinates(location?.latitude, location?.longitude);
}

const toolFunctions: Record<string, (args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, displayMode?: toolUsageDisplayMode) => ToolResult | Promise<ToolResult>> = {
    "whisper": executeWhisper,
    "think": executeThink,
    "pick": executeRandomPick,
    "clock": executeClock,
    "calendar": executeCalendar,
    "coin": executeCoinFlip,
    "dice": executeDiceRoll,
    "random": executeRandom,
    "rng": executeRng,
    "move": executeMove,
    "timer": executeTimer,
    "stopwatch": executeStopwatch,
    "schedule": executeSchedule,
    "calculator": executeCalculator,
    "web": executeWeb,
    "dialogue": executeDialogue,
    "knowledge": executeKnowledge,
    "memory": executeMemory,
    "lookup": executeLookup,
    "map": executeMap,
    "audio": executeAudio,
    "note": executeNote,
    "inventory": executeInventory,
    "trade": executeTrade,
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
    "browser": executeOpenBrowser,
    "read_file": executeReadFile,
    "write_file": executeWriteFile,
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

// ─── Help Result Formatter (Python Style) ───────────────────────────

function helpResult(toolType: string, signature: string, description: string): ToolResult {
    const usage = `${toolType}(${signature}) — ${description}`;
    return { toolType, args: '', content: `Usage: ${usage}`, displayReplacement: `[${toolType}: ${description}]` };
}

// ─── Display Mode Formatter ────────────────────────────────────────

export function formatToolDisplay(
    result: ToolResult,
    rawMatch: string,
    mode: toolUsageDisplayMode,
): string {
    switch (mode) {
        case 'none': return '';
        case 'icon': {
            const iconMatch = result.displayReplacement.match(/^\[?([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}⚡🔧💀🛠️✨📨🔒🔓👕🎙️📝📦🗺️🌐🔍🎲🪙📅⏱️❓💭🤫])/u);
            return iconMatch ? iconMatch[1] : result.displayReplacement;
        }
        case 'simple': return result.displayReplacement;
        case 'detailed': return result.displayReplacement;
        case 'full': return `[${result.toolType}(${result.args}) → ${result.content}]`;
        case 'raw': return rawMatch;
        default: return result.displayReplacement;
    }
}

// ─── Whisper ────────────────────────────────────────────────────────
// Signature: whisper(target_char_id="...", text="...")
function executeWhisper(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetIdsStr = pArgs.get(0, 'target_char_id', 'target', 'target_id', 'to');
    const text = pArgs.get(1, 'text', 'message', 'content')?.trim();

    if (!targetIdsStr || !text) {
        return helpResult('whisper', 'target_char_id="...", text="..."', 'send private message visible only to target(s)');
    }

    const targetIdentifiers = targetIdsStr.split(',').map(id => id.trim()).filter(Boolean);
    const allChars = context?.allCharacters || [];
    const validTargetIds: string[] = [];
    const validTargetNames: string[] = [];

    for (const tid of targetIdentifiers) {
        const targetChar = resolveCharacter(tid, interactionData, allChars);
        if (targetChar) {
            validTargetIds.push(targetChar.id);
            validTargetNames.push(targetChar.name);
        }
    }

    if (validTargetIds.length === 0) {
        return { toolType: 'whisper', args, content: `[Error: Target character "${targetIdsStr}" not found]`, displayReplacement: '[Error: Target not found]' };
    }

    appendPendingAction(nextMessage, {
        type: 'whisper',
        payload: { targetCharacterIds: validTargetIds.join(','), text }
    });
    return { toolType: 'whisper', args, content: text, displayReplacement: `[🤫 Whispered to ${validTargetNames.join(', ')}]` };
}

// ─── Think ──────────────────────────────────────────────────────────
// Signature: think(reasoning="...")
function executeThink(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const reasoning = pArgs.get(0, 'reasoning', 'thought', 'text')?.trim();
    if (!reasoning) {
        return helpResult('think', 'reasoning="..."', 'evaluate context and plan next move internally');
    }

    const character = nextMessage.character;
    const history = getGlobalMessageHistory(interactionData);
    const coLocated = getCoLocatedParticipants(interactionData, character);
    let wasAddressed = false;

    for (let i = history.length - coLocated.length; i < history.length; i++) {
        if (i < 0) continue;
        const msg = history[i];
        if (msg.messageType === 'chat' && msg.character.id !== character.id) {
            if ((msg as ChatMessage).textContent.toLowerCase().includes(character.name.toLowerCase())) {
                wasAddressed = true;
                break;
            }
        }
    }

    let messagesSinceLastSpoke = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].messageType === 'chat' && history[i].character.id === character.id) break;
        messagesSinceLastSpoke++;
    }

    const contextLines = [
        `You are ${character.name}.`,
        `You were ${wasAddressed ? 'addressed' : 'not addressed'} in recent messages.`,
        `Messages since you last spoke: ${messagesSinceLastSpoke}.`,
        nextMessage.remainingChatStamina !== undefined ? `Remaining chat stamina: ${nextMessage.remainingChatStamina}.` : '',
        `Your reasoning: ${reasoning}`,
        '',
        'Based on your reasoning, proceed naturally.'
    ].filter(Boolean);

    return {
        toolType: 'think',
        args: reasoning,
        content: contextLines.join('\n'),
        displayReplacement: `[💭 ${character.name} is thinking...]`,
    };
}

// ─── Random Pick ────────────────────────────────────────────────────
// Signature: pick("opt1", "opt2", ...) | pick(options=["opt1", "opt2"])
function executeRandomPick(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    let options = pArgs.positional;

    const optKwarg = pArgs.get(-1, 'options', 'choices');
    if (optKwarg) {
        options = optKwarg.split(',').map(s => s.trim()).filter(Boolean);
    }

    if (options.length === 0) {
        return helpResult('pick', '"option1", "option2", ...', 'randomly pick one option');
    }
    const picked = options[Math.floor(Math.random() * options.length)];
    return { toolType: 'pick', args, content: picked, displayReplacement: `[🎯 "${picked}"]` };
}

// ─── Clock ────────────────────────────────────────────────────────────
// Signature: clock(format="12h") -> format: "12h" | "24h" | "unix"
function executeClock(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const format = pArgs.get(0, 'format', 'type')?.toLowerCase();
    const dt = getCharacterTimeData(interactionData, interactionData).luxonTimestamp;

    let timeStr: string;
    if (format === '24h' || format === '24') {
        timeStr = dt.toLocaleString({ hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else if (format === 'unix' || format === 'timestamp') {
        timeStr = Math.floor(dt.toMillis() / 1000).toString();
    } else {
        timeStr = dt.toLocaleString({ hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    }

    return { toolType: 'clock', args, content: timeStr, displayReplacement: `[🕰️ ${timeStr}]` };
}

// ─── Calendar ────────────────────────────────────────────────────────
// Signature: calendar(format="date") -> format: "full" | "date" | "time" | "iso" | "unix"
function executeCalendar(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const format = pArgs.get(0, 'format', 'type')?.toLowerCase();
    const dt = getCharacterTimeData(interactionData, interactionData).luxonTimestamp;

    let dateStr: string;
    if (format === 'iso') {
        dateStr = dt.toISO() || new Date(dt.toMillis()).toISOString();
    } else if (format === 'unix' || format === 'timestamp') {
        dateStr = Math.floor(dt.toMillis() / 1000).toString();
    } else if (format === 'time') {
        dateStr = dt.toLocaleString({ hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (format === 'date') {
        dateStr = dt.toLocaleString({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } else {
        dateStr = dt.toLocaleString({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    }

    return { toolType: 'calendar', args, content: dateStr, displayReplacement: `[📅 ${dateStr}]` };
}

// ─── Coin Flip ───────────────────────────────────────────────────────
// Signature: coin()
function executeCoinFlip(args: string): ToolResult {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return { toolType: 'coin', args, content: result, displayReplacement: `[🪙 Coin flip: ${result}]` };
}

// ─── Roll Dice ──────────────────────────────────────────────────────
// Signature: dice(sides=6, count=1, modifier=0) | dice("2d6+3") | dice(1000)
interface RollGroup { count: number; sides: number }

function executeDiceRoll(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);

    let notation = pArgs.get(-1, 'notation', 'expr', 'expression');
    const kwSides = pArgs.getNumber(-1, 'sides', 'side', 's', 'max');
    const kwCount = pArgs.getNumber(-1, 'count', 'num', 'dice_count', 'n');
    const kwMod = pArgs.getNumber(-1, 'modifier', 'mod', 'plus');

    if (!notation && kwSides !== undefined) {
        // Keyword call: dice(sides=99999) or dice(count=2, sides=20)
        const count = kwCount ?? 1;
        const modifier = kwMod ?? 0;
        const modSign = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
        notation = `${count}d${kwSides}${modSign}`;
    } else if (!notation && pArgs.positional.length === 1) {
        // Single positional argument: dice(99999) or dice("2d6+3")
        const p = pArgs.positional[0].trim();
        if (/^\d+$/.test(p)) {
            notation = `1d${p}`;
        } else if (/^d\d+$/i.test(p)) {
            notation = `1${p}`;
        } else {
            notation = p;
        }
    } else if (!notation && pArgs.positional.length >= 2) {
        // Positional count & sides: dice(2, 6) or dice(2, 6, 3)
        const count = pArgs.getNumber(0) ?? 1;
        const sides = pArgs.getNumber(1) ?? 6;
        const modifier = pArgs.getNumber(2) ?? 0;
        const modSign = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
        notation = `${count}d${sides}${modSign}`;
    } else if (!notation) {
        notation = '1d6';
    }

    const result = parseRollExpression(notation);
    if (!result) {
        return {
            toolType: 'dice',
            args,
            content: `[Error: Invalid dice notation. Usage: dice(sides=6), dice("2d6+3"), or dice(count, sides). Received: "${args}"]`,
            displayReplacement: '[Error: Invalid dice call]'
        };
    }

    const rollsStr = result.rolls.join(', ');
    const modStr = result.modifier > 0 ? ` + ${result.modifier}` : result.modifier < 0 ? ` - ${Math.abs(result.modifier)}` : '';
    const label = result.groups.length === 1 ? `${result.groups[0].count}d${result.groups[0].sides}` : result.groups.map(g => `${g.count}d${g.sides}`).join(' + ');
    return {
        toolType: 'dice',
        args,
        content: `${result.total}`,
        displayReplacement: `[🎲 ${label}${modStr} → [${rollsStr}] = ${result.total}]`
    };
}

function parseRollExpression(expr: string): { groups: RollGroup[]; modifier: number; rolls: number[]; total: number } | null {
    const sanitized = expr.trim().toLowerCase().replace(/\s+/g, '');
    if (!sanitized) return null;

    const rollGroupRegex = /(\d*)d(\d+)/gi;
    const groups: RollGroup[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = rollGroupRegex.exec(sanitized)) !== null) {
        const count = match[1] ? Number.parseInt(match[1], 10) : 1;
        const sides = Number.parseInt(match[2], 10);
        if (count < 1 || sides < 1) return null;
        groups.push({ count, sides });
        lastIndex = match.index + match[0].length;
    }
    if (groups.length === 0) return null;

    let modifier = 0;
    const remainder = sanitized.slice(lastIndex);
    if (remainder) {
        const modMatch = remainder.match(/^([+-])(\d+)$/);
        if (!modMatch) return null;
        modifier = Number.parseInt(modMatch[2], 10);
        if (modMatch[1] === '-') modifier = -modifier;
    }

    const allRolls: number[] = [];
    for (const group of groups) {
        for (let i = 0; i < group.count; i++) {
            allRolls.push(Math.floor(Math.random() * group.sides) + 1);
        }
    }

    const total = allRolls.reduce((sum, r) => sum + r, 0) + modifier;
    return { groups, modifier, rolls: allRolls, total };
}

// ─── Random Number ───────────────────────────────────────────────────
// Signature: random(max=100, min=1) | random(10, 50)
function executeRandom(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    let min = pArgs.getNumber(0, 'min', 'start') ?? 1;
    let max = pArgs.getNumber(1, 'max', 'end', 'stop');

    if (max === undefined) {
        max = pArgs.getNumber(0, 'max', 'end') ?? 100;
        if (pArgs.positional.length === 1 && !pArgs.kwargs['min']) min = 1;
    }

    if (min > max) [min, max] = [max, min];
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return { toolType: 'random', args, content: result.toString(), displayReplacement: `[🎲 Random(${min}-${max}): ${result}]` };
}

// ─── RNG Table ────────────────────────────────────────────────────────
// Signature: rng(table_context_id="...")
function executeRng(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const tableId = pArgs.get(0, 'table_context_id', 'table', 'context_id', 'name')?.trim();
    if (!tableId) {
        return helpResult('rng', 'table_context_id="..."', 'roll on a named RNG table defined in contexts');
    }

    const contexts = interactionData.contexts || [];
    const tableContext = contexts.find(c => c.id === tableId || c.name?.toLowerCase() === tableId.toLowerCase());
    if (!tableContext?.text) {
        return { toolType: 'rng', args, content: `[Error: RNG table "${tableId}" not found in contexts]`, displayReplacement: '[Error: Table not found]' };
    }

    const lines = tableContext.text.split('\n').map(l => l.trim()).filter(Boolean);
    const entries: { min: number; max: number; result: string }[] = [];
    let globalMax = 0;

    for (const line of lines) {
        const rangeMatch = line.match(/^(\d+)\s*[-–]\s*(\d+)\s*[:=]\s*(.+)$/);
        const singleMatch = line.match(/^(\d+)\s*[:=]\s*(.+)$/);
        if (rangeMatch) {
            const min = Number.parseInt(rangeMatch[1], 10), max = Number.parseInt(rangeMatch[2], 10);
            entries.push({ min, max, result: rangeMatch[3].trim() });
            if (max > globalMax) globalMax = max;
        } else if (singleMatch) {
            const val = Number.parseInt(singleMatch[1], 10);
            entries.push({ min: val, max: val, result: singleMatch[2].trim() });
            if (val > globalMax) globalMax = val;
        }
    }

    if (entries.length === 0) {
        return { toolType: 'rng', args, content: `[Error: RNG table "${tableContext.name}" has no valid entries]`, displayReplacement: '[Error: Empty table]' };
    }

    const roll = Math.floor(Math.random() * globalMax) + 1;
    const matched = entries.find(e => roll >= e.min && roll <= e.max);
    return {
        toolType: 'rng',
        args,
        content: matched ? matched.result : `Rolled ${roll}, no match`,
        displayReplacement: `[🎲 ${tableContext.name}: ${matched ? matched.result : 'no match'}]`
    };
}

// ─── Move ───────────────────────────────────────────────────────────
// Signature: move(location_id="...")
function executeMove(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'location_id', 'location', 'target', 'destination', 'to')?.trim();
    if (!targetQuery) {
        return helpResult('move', 'location_id="..."', 'move character to an adjacent location');
    }

    const currentLocation = getCurrentLocation(interactionData, nextMessage.character);
    if (!currentLocation) return { toolType: 'move', args, content: '[Error: Current character location unknown]', displayReplacement: '[Error: Unknown location]' };

    const targetLocation = resolveLocation(targetQuery, interactionData);
    if (!targetLocation) return { toolType: 'move', args, content: `[Error: Location "${targetQuery}" not found]`, displayReplacement: '[Error: Location not found]' };

    if (targetLocation.id === currentLocation.id) {
        return { toolType: 'move', args, content: `Already at "${targetLocation.name}".`, displayReplacement: `[🚶 Already at "${targetLocation.name}"]` };
    }

    const isAdjacent = currentLocation.locationBindings?.includes(targetLocation.id) || targetLocation.locationBindings?.includes(currentLocation.id);
    if (!isAdjacent) {
        return { toolType: 'move', args, content: `[Error: Location "${targetLocation.name}" is not adjacent]`, displayReplacement: '[Error: Not adjacent]' };
    }

    if (isCharacterLockedFromLocation(interactionData, nextMessage.character.id, targetLocation.id)) {
        return { toolType: 'move', args, content: `[Error: Location "${targetLocation.name}" is locked]`, displayReplacement: '[Error: Location locked]' };
    }

    return { toolType: 'move', args, content: `Moved to "${targetLocation.name}" (${targetLocation.id}).`, displayReplacement: `[🚶 Moved to "${targetLocation.name}"]` };
}

// ─── Timer Helpers ──────────────────────────────────────────────────

interface TimerEntry { name: string; targetTimestamp: number }
interface StopwatchEntry { name: string; startTimestamp: number; pausedElapsedMs?: number }

function parseDurationToMs(input: string): number | null {
    const trimmed = input.trim().toLowerCase();
    let totalMs = 0, matched = false;
    const hourMatch = trimmed.match(/(\d+)\s*h(?:ours?|r)?/);
    if (hourMatch) { totalMs += Number.parseInt(hourMatch[1], 10) * 3600000; matched = true; }
    const minMatch = trimmed.match(/(\d+)\s*m(?:in(?:utes?|s)?)?/);
    if (minMatch) { totalMs += Number.parseInt(minMatch[1], 10) * 60000; matched = true; }
    const secMatch = trimmed.match(/(\d+)\s*s(?:ec(?:onds?|s)?)?/);
    if (secMatch) { totalMs += Number.parseInt(secMatch[1], 10) * 1000; matched = true; }
    if (!matched) { const plain = Number.parseInt(trimmed, 10); return !Number.isNaN(plain) && plain > 0 ? plain * 1000 : null; }
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
// Signature: timer(action="set|check|delete|list", name="...", duration="...")
function executeTimer(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('timer', 'action="set|check|delete|list", name="...", duration="..."', 'manage countdown timers');
    }

    const latest = findLatestMessage(interactionData, nextMessage.character);
    const inventory = latest?.message?.inventory ? { ...latest.message.inventory } : {};
    const timers = loadTimers(inventory);
    const now = Date.now();

    switch (action) {
        case 'set': {
            const name = pArgs.get(1, 'name', 'timer_name');
            const durRaw = pArgs.get(2, 'duration', 'time', 'len');
            const durationMs = durRaw ? parseDurationToMs(durRaw) : null;
            if (!name || !durationMs) {
                return { toolType: 'timer', args, content: '[Error: timer(action="set", name="...", duration="...") requires name and duration]', displayReplacement: '[Error: Usage]' };
            }
            const filtered = timers.filter(t => t.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, targetTimestamp: now + durationMs });
            saveTimers(inventory, filtered);
            nextMessage.inventory = inventory;
            return { toolType: 'timer', args, content: `Timer "${name}" set for ${formatDuration(durationMs)}.`, displayReplacement: `[⏱️ Timer "${name}" set]` };
        }
        case 'check': {
            const name = pArgs.get(1, 'name')?.toLowerCase();
            if (name) {
                const timer = timers.find(t => t.name.toLowerCase() === name);
                if (!timer) return { toolType: 'timer', args, content: `No timer named "${name}".`, displayReplacement: '[⏱️ No timer]' };
                const remaining = timer.targetTimestamp - now;
                return { toolType: 'timer', args, content: remaining <= 0 ? `Timer "${timer.name}" EXPIRED.` : `${timer.name}: ${formatDuration(remaining)} remaining.`, displayReplacement: `[⏱️ "${timer.name}": ${remaining <= 0 ? 'EXPIRED' : formatDuration(remaining)}]` };
            }
            if (timers.length === 0) return { toolType: 'timer', args, content: 'No active timers.', displayReplacement: '[⏱️ No timers]' };
            return { toolType: 'timer', args, content: timers.map(t => `${t.name}: ${formatDuration(t.targetTimestamp - now)}`).join('\n'), displayReplacement: `[⏱️ ${timers.length} timer(s)]` };
        }
        case 'delete': {
            const name = pArgs.get(1, 'name')?.toLowerCase();
            const idx = timers.findIndex(t => t.name.toLowerCase() === name);
            if (idx === -1) return { toolType: 'timer', args, content: `No timer named "${name}".`, displayReplacement: '[⏱️ Not found]' };
            timers.splice(idx, 1);
            saveTimers(inventory, timers);
            nextMessage.inventory = inventory;
            return { toolType: 'timer', args, content: `Timer "${name}" deleted.`, displayReplacement: `[⏱️ Deleted "${name}"]` };
        }
        case 'list': {
            if (timers.length === 0) return { toolType: 'timer', args, content: 'No active timers.', displayReplacement: '[⏱️ No timers]' };
            return { toolType: 'timer', args, content: timers.map(t => `${t.name}: ${formatDuration(t.targetTimestamp - now)}`).join('\n'), displayReplacement: `[⏱️ ${timers.length} timer(s)]` };
        }
        default:
            return { toolType: 'timer', args, content: `[Error: Unknown timer action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Stopwatch ──────────────────────────────────────────────────────
// Signature: stopwatch(action="start|stop|pause|resume|reset|check|list", name="...")
function executeStopwatch(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const name = pArgs.get(1, 'name', 'stopwatch_name');

    if (!action) {
        return helpResult('stopwatch', 'action="start|stop|pause|resume|reset|check|list", name="..."', 'manage stopwatch counters');
    }

    const latest = findLatestMessage(interactionData, nextMessage.character);
    const inventory = latest?.message?.inventory ? { ...latest.message.inventory } : {};
    const stopwatches = loadStopwatches(inventory);
    const now = Date.now();

    switch (action) {
        case 'start': {
            if (!name) return { toolType: 'stopwatch', args, content: '[Error: stopwatch(action="start", name="...") requires name]', displayReplacement: '[Error: Usage]' };
            const filtered = stopwatches.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, startTimestamp: now });
            saveStopwatches(inventory, filtered);
            nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopwatch "${name}" started.`, displayReplacement: `[⏱️ Started "${name}"]` };
        }
        case 'stop': {
            const idx = stopwatches.findIndex(s => s.name.toLowerCase() === name?.toLowerCase());
            if (idx === -1) return { toolType: 'stopwatch', args, content: `No stopwatch named "${name}".`, displayReplacement: '[⏱️ Not found]' };
            const sw = stopwatches[idx];
            const elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
            stopwatches.splice(idx, 1);
            saveStopwatches(inventory, stopwatches);
            nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopwatch "${name}" stopped at ${formatDuration(elapsed)}.`, displayReplacement: `[⏱️ Stopped at ${formatDuration(elapsed)}]` };
        }
        case 'check':
        case 'list': {
            if (name) {
                const sw = stopwatches.find(s => s.name.toLowerCase() === name.toLowerCase());
                if (!sw) return { toolType: 'stopwatch', args, content: `No stopwatch named "${name}".`, displayReplacement: '[⏱️ Not found]' };
                const elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
                return { toolType: 'stopwatch', args, content: `${sw.name}: ${formatDuration(elapsed)}`, displayReplacement: `[⏱️ ${formatDuration(elapsed)}]` };
            }
            return { toolType: 'stopwatch', args, content: stopwatches.map(s => `${s.name}: ${formatDuration(now - s.startTimestamp)}`).join('\n') || 'No stopwatches', displayReplacement: `[⏱️ ${stopwatches.length} stopwatch(es)]` };
        }
        default:
            return { toolType: 'stopwatch', args, content: `[Error: Unknown stopwatch action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Schedule ───────────────────────────────────────────────────────
// Signature: schedule(action="set|cancel|list", name="...", duration="...", action_desc="...")
interface ScheduleEntry { name: string; triggerTimestamp: number; action: string; repeatIntervalMs?: number }

function loadSchedules(inventory: Inventory | undefined): ScheduleEntry[] {
    if (!inventory || typeof inventory['__schedules__'] !== 'string') return [];
    try { return JSON.parse(inventory['__schedules__'] as string); } catch { return []; }
}

function saveSchedules(inventory: Inventory, schedules: ScheduleEntry[]): void {
    if (schedules.length === 0) delete inventory['__schedules__']; else inventory['__schedules__'] = JSON.stringify(schedules);
}

function executeSchedule(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('schedule', 'action="set|cancel|list", name="...", duration="...", action_desc="..."', 'schedule automated actions');
    }

    const latest = findLatestMessage(interactionData, nextMessage.character);
    const inventory = latest?.message?.inventory ? { ...latest.message.inventory } : {};
    const schedules = loadSchedules(inventory);
    const now = Date.now();

    switch (action) {
        case 'set': {
            const name = pArgs.get(1, 'name', 'schedule_name');
            const durRaw = pArgs.get(2, 'duration', 'time', 'interval');
            const durationMs = durRaw ? parseDurationToMs(durRaw) : null;
            const desc = pArgs.get(3, 'action_desc', 'desc', 'do', 'event', 'text');
            if (!name || !durationMs || !desc) {
                return { toolType: 'schedule', args, content: '[Error: schedule(action="set", name="...", duration="...", action_desc="...") requires all parameters]', displayReplacement: '[Error: Usage]' };
            }
            const filtered = schedules.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, triggerTimestamp: now + durationMs, action: desc });
            saveSchedules(inventory, filtered);
            nextMessage.inventory = inventory;
            return { toolType: 'schedule', args, content: `Scheduled "${name}" in ${formatDuration(durationMs)}: ${desc}`, displayReplacement: `[📅 Scheduled "${name}"]` };
        }
        case 'cancel': {
            const name = pArgs.get(1, 'name')?.toLowerCase();
            const idx = schedules.findIndex(s => s.name.toLowerCase() === name);
            if (idx === -1) return { toolType: 'schedule', args, content: `No schedule named "${name}".`, displayReplacement: '[📅 Not found]' };
            schedules.splice(idx, 1);
            saveSchedules(inventory, schedules);
            nextMessage.inventory = inventory;
            return { toolType: 'schedule', args, content: `Cancelled "${name}".`, displayReplacement: `[📅 Cancelled "${name}"]` };
        }
        case 'list': {
            return { toolType: 'schedule', args, content: schedules.map(s => `${s.name}: ${formatDuration(s.triggerTimestamp - now)} remaining -> ${s.action}`).join('\n') || 'No schedules', displayReplacement: `[📅 ${schedules.length} schedule(s)]` };
        }
        default:
            return { toolType: 'schedule', args, content: `[Error: Unknown schedule action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Calculator ─────────────────────────────────────────────────────
// Signature: calculator(expression="...")
function executeCalculator(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    const expression = pArgs.get(0, 'expression', 'expr', 'math')?.trim();
    if (!expression) {
        return helpResult('calculator', 'expression="..."', 'evaluate mathematical expression');
    }
    try {
        if (!/^[\d\s+\-*/().,%^eE]+$/.test(expression)) {
            return { toolType: 'calculator', args, content: '[Error: Invalid math characters]', displayReplacement: '[Error: Invalid characters]' };
        }
        const evaluable = expression.replace(/\^/g, '**');
        const result = new Function(`"use strict"; return (${evaluable})`)();
        if (typeof result !== 'number' || !Number.isFinite(result)) {
            return { toolType: 'calculator', args, content: '[Error: Non-finite calculation result]', displayReplacement: '[Error: Invalid result]' };
        }
        const formatted = Number.isInteger(result) ? result.toString() : Number.parseFloat(result.toFixed(8)).toString();
        return { toolType: 'calculator', args, content: formatted, displayReplacement: formatted };
    } catch (e) {
        return { toolType: 'calculator', args, content: `[Error: ${(e as Error).message}]`, displayReplacement: '[Error: Math error]' };
    }
}

// ─── Web ────────────────────────────────────────────────────────────
// Signature: web(query_or_url="...")
async function executeWeb(args: string): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const query = pArgs.get(0, 'query_or_url', 'query', 'url', 'search')?.trim();
    if (!query) {
        return helpResult('web', 'query_or_url="..."', 'search the web or fetch a URL');
    }
    try {
        const isDirectUrl = /^https?:\/\//i.test(query);
        const urlToFetch = isDirectUrl ? query : buildSearchUrl([query]);
        const results = await fetchLinkContent(urlToFetch, { maxDepth: 0, cacheTimeToLiveMs: 5 * 60 * 1000, fetchMode: 'full', includeImages: false });
        const valid = results.filter(r => !r.error && r.content.length > 0);
        if (valid.length === 0) {
            return { toolType: 'web', args, content: `[Error: ${results[0]?.error || 'No content retrieved'}]`, displayReplacement: '[Error: Fetch failed]' };
        }
        return { toolType: 'web', args, content: valid[0].content, displayReplacement: `[🌐 Fetched: "${query}"]` };
    } catch (e) {
        return { toolType: 'web', args, content: `[Error: ${(e as Error).message}]`, displayReplacement: '[Error: Web error]' };
    }
}

// ─── Dialogue ──────────────────────────────────────────────────────
// Signature: dialogue(action="list|recall", prompt_id="...")
function executeDialogue(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const dialoguePrompts = nextMessage.character.dialoguePrompts || [];

    if (!action) {
        return helpResult('dialogue', 'action="list|recall", prompt_id="..."', 'manage dialogue prompts');
    }

    if (action === 'list') {
        const entries = dialoguePrompts.map(dp => `${dp.id} | ${dp.name}`);
        return { toolType: 'dialogue', args, content: entries.join('\n') || 'No dialogue prompts', displayReplacement: `[💬 ${entries.length} prompt(s)]` };
    }
    if (action === 'recall') {
        const queryId = pArgs.get(1, 'prompt_id', 'id')?.trim();
        const matched = dialoguePrompts.filter(dp => dp.id === queryId || dp.id.startsWith(queryId || ""));
        if (matched.length === 0) return { toolType: 'dialogue', args, content: `No dialogue prompt matching "${queryId}".`, displayReplacement: '[💬 No match]' };

        const textArray = getGlobalMessageHistory(interactionData).filter(m => m.messageType === 'chat').map(m => (m as ChatMessage).textContent);
        const recalled = collectActiveDialoguePromptContent(matched, buildDialogueSearchSpace(textArray));
        return { toolType: 'dialogue', args, content: recalled.join('\n') || 'No active instructions', displayReplacement: `[💬 Recalled ${recalled.length} instruction(s)]` };
    }
    return { toolType: 'dialogue', args, content: `[Error: Unknown dialogue action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Knowledge ──────────────────────────────────────────────────────
// Signature: knowledge(action="list|recall", id="...")
function executeKnowledge(args: string, nextMessage: BaseMessage): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const prompts = nextMessage.character.knowledgePrompts || [];

    if (!action) {
        return helpResult('knowledge', 'action="list|recall", id="..."', 'inspect character knowledge base');
    }

    if (action === 'list') {
        const entries = prompts.map(kp => `${kp.id} | ${kp.name}`);
        return { toolType: 'knowledge', args, content: entries.join('\n') || 'No knowledge prompts', displayReplacement: `[🧠 ${entries.length} prompt(s)]` };
    }
    if (action === 'recall') {
        const queryId = pArgs.get(1, 'id', 'knowledge_id')?.trim();
        const matched = prompts.filter(kp => kp.id === queryId || kp.id.startsWith(queryId || ""));
        if (matched.length === 0) return { toolType: 'knowledge', args, content: `No knowledge matching "${queryId}".`, displayReplacement: '[🧠 No match]' };
        return { toolType: 'knowledge', args, content: matched.map(k => `[${k.name}]: ${k.content}`).join('\n'), displayReplacement: `[🧠 Recalled ${matched.length} entry(ies)]` };
    }
    return { toolType: 'knowledge', args, content: `[Error: Unknown knowledge action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Memory ─────────────────────────────────────────────────────────
// Signature: memory(action="list|recall|save", id="...")
async function executeMemory(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const character = nextMessage.character;

    if (!action) {
        return helpResult('memory', 'action="list|recall|save", id="..."', 'manage persistent character memories');
    }

    if (action === 'list') {
        const entries: string[] = [];
        for (const [key, mems] of Object.entries(character.memories || {})) {
            for (const mem of mems) entries.push(`[${key}] ${mem.id}: ${mem.name}`);
        }
        return { toolType: 'memory', args, content: entries.join('\n') || 'No memories stored', displayReplacement: `[🧠 ${entries.length} memories]` };
    }
    if (action === 'recall') {
        const queryId = pArgs.get(1, 'id', 'memory_id')?.trim();
        if (queryId) {
            for (const [, mems] of Object.entries(character.memories || {})) {
                const found = mems.find(m => m.id === queryId || m.id.startsWith(queryId));
                if (found) return { toolType: 'memory', args, content: found.content, displayReplacement: `[🧠 Recalled "${found.name}"]` };
            }
            return { toolType: 'memory', args, content: `Memory "${queryId}" not found.`, displayReplacement: '[🧠 Not found]' };
        }
        const relevant: string[] = [];
        for (const [, mems] of Object.entries(character.memories || {})) {
            for (const mem of mems) relevant.push(mem.content);
        }
        return { toolType: 'memory', args, content: relevant.join('\n---\n') || 'No memories found', displayReplacement: `[🧠 Recalled ${relevant.length} memories]` };
    }
    if (action === 'save') {
        const others = getSessionCharacters(interactionData).filter(p => p.id !== character.id);
        const summary = await generateCharacterMemory(interactionData, character, '', 512);
        if (!summary) return { toolType: 'memory', args, content: '[Error: Failed to summarize memory]', displayReplacement: '[Error: Memory error]' };
        const ts = Date.now();
        if (!character.memories) character.memories = {};
        for (const o of others) {
            character.memories[o.id] = [{ id: uuidv4(), name: `Memory with ${o.name}`, content: summary, firstCreatedTimestamp: ts, lastUpdatedTimestamp: ts, interactionData }];
        }
        await saveRawCharacter(character).catch(console.warn);
        context?.addToast?.(`🧠 Memory saved for ${character.name}`, 'success');
        return { toolType: 'memory', args, content: `Saved memory: ${summary}`, displayReplacement: '[🧠 Memory saved]' };
    }
    return { toolType: 'memory', args, content: `[Error: Unknown memory action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Lookup ─────────────────────────────────────────────────────────
// Signature: lookup(keyword="...")
function executeLookup(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const query = pArgs.get(0, 'keyword', 'query', 'search', 'text')?.toLowerCase().trim();
    if (!query) {
        return helpResult('lookup', 'keyword="..."', 'search contexts and world lore for keywords');
    }

    const matches: string[] = [];
    for (const ctx of interactionData.contexts || []) {
        const search = `${ctx.name} ${ctx.text} ${ctx.description}`.toLowerCase();
        if (search.includes(query)) {
            matches.push(`[${ctx.name}]: ${(ctx.text || ctx.description || '').slice(0, 150)}...`);
        }
    }
    return { toolType: 'lookup', args, content: matches.join('\n') || `No results for "${query}"`, displayReplacement: `[🔍 ${matches.length} result(s)]` };
}

// ─── Map ────────────────────────────────────────────────────────────
// Signature: map(target_location_id="...", from_location_id="...")
function executeMap(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'target_location_id', 'target', 'to', 'destination');
    const fromQuery = pArgs.get(1, 'from_location_id', 'from', 'source');

    if (!targetQuery) {
        return helpResult('map', 'target_location_id="...", from_location_id="..."', 'calculate distance between locations');
    }

    let fromLoc: Location | undefined;
    let toLoc: Location | undefined;

    if (fromQuery) {
        fromLoc = resolveLocation(fromQuery, interactionData);
        toLoc = resolveLocation(targetQuery, interactionData);
    } else {
        fromLoc = getCurrentLocation(interactionData, nextMessage.character);
        toLoc = resolveLocation(targetQuery, interactionData);
    }

    if (!fromLoc || !toLoc) return { toolType: 'map', args, content: '[Error: Locations not found]', displayReplacement: '[Error: Locations not found]' };
    if (fromLoc.id === toLoc.id) return { toolType: 'map', args, content: `Already at "${toLoc.name}".`, displayReplacement: `[🗺️ Already at "${toLoc.name}"]` };

    let distanceKm = fromLoc.locationDistances?.[toLoc.id];
    if (distanceKm === undefined && fromLoc.latitude !== undefined && toLoc.latitude !== undefined) {
        const R = 6371;
        const dLat = (toLoc.latitude - fromLoc.latitude) * Math.PI / 180;
        const dLon = (toLoc.longitude! - fromLoc.longitude!) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(fromLoc.latitude * Math.PI / 180) * Math.cos(toLoc.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    if (distanceKm === undefined) return { toolType: 'map', args, content: '[Error: Distance cannot be determined]', displayReplacement: '[Error: Unknown distance]' };

    const rounded = Math.round(distanceKm * 10) / 10;
    return { toolType: 'map', args, content: `Distance: ${rounded} km.`, displayReplacement: `[🗺️ ${fromLoc.name} -> ${toLoc.name}: ${rounded} km]` };
}

// ─── Audio ──────────────────────────────────────────────────────────
// Signature: audio(action="play|stop", track_id="...")
function executeAudio(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const trackId = pArgs.get(1, 'track_id', 'track', 'name')?.trim();

    if (!action || !trackId) {
        return helpResult('audio', 'action="play|stop", track_id="..."', 'manage background audio playback');
    }

    const tracks = interactionData.audioTracks || context?.allAudioTracks || [];
    const track = tracks.find(t => t.id === trackId || t.name.toLowerCase() === trackId.toLowerCase());
    if (!track) return { toolType: 'audio', args, content: `[Error: Track "${trackId}" not found]`, displayReplacement: '[Error: Track not found]' };

    const audioEngine = getAudioEngine();
    if (action === 'play') {
        audioEngine.startTrack(track);
        return { toolType: 'audio', args, content: `Playing "${track.name}".`, displayReplacement: `[🔊 Playing "${track.name}"]` };
    }
    if (action === 'stop') {
        audioEngine.stopTrack(track.id);
        return { toolType: 'audio', args, content: `Stopped "${track.name}".`, displayReplacement: `[🔇 Stopped "${track.name}"]` };
    }
    return { toolType: 'audio', args, content: `[Error: Unknown audio action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Note ──────────────────────────────────────────────────────────
// Signature: note(action="set|get|delete|list", key="...", text="...")
function executeNote(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('note', 'action="set|get|delete|list", key="...", text="..."', 'manage persistent character notes');
    }

    const latest = findLatestMessage(interactionData, nextMessage.character);
    const inventory = latest?.message?.inventory ? { ...latest.message.inventory } : {};
    let notes: Record<string, string> = {};
    try { notes = JSON.parse((inventory['__notes__'] as string) || '{}'); } catch { notes = {}; }

    switch (action) {
        case 'set': {
            const key = pArgs.get(1, 'key', 'name');
            const text = pArgs.get(2, 'text', 'content', 'value');
            if (!key || !text) return { toolType: 'note', args, content: '[Error: note(action="set", key="...", text="...") requires key and text]', displayReplacement: '[Error: Usage]' };
            notes[key] = text;
            inventory['__notes__'] = JSON.stringify(notes);
            nextMessage.inventory = inventory;
            return { toolType: 'note', args, content: `Saved note "${key}".`, displayReplacement: `[📝 Note: "${key}"]` };
        }
        case 'get': {
            const key = pArgs.get(1, 'key', 'name');
            return { toolType: 'note', args, content: (key && notes[key]) || `Note "${key}" not found.`, displayReplacement: `[📝 Note "${key}"]` };
        }
        case 'delete': {
            const key = pArgs.get(1, 'key', 'name');
            if (key) delete notes[key];
            inventory['__notes__'] = JSON.stringify(notes);
            nextMessage.inventory = inventory;
            return { toolType: 'note', args, content: `Deleted note "${key}".`, displayReplacement: `[📝 Deleted "${key}"]` };
        }
        case 'list': {
            const entries = Object.entries(notes).map(([k, v]) => `${k}: ${v}`);
            return { toolType: 'note', args, content: entries.join('\n') || 'No notes', displayReplacement: `[📝 ${entries.length} note(s)]` };
        }
        default:
            return { toolType: 'note', args, content: `[Error: Unknown note action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Inventory ──────────────────────────────────────────────────────
// Signature: inventory(action="list|add|remove|set", item="...", qty=1, value=None)
function executeInventory(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('inventory', 'action="list|add|remove|set", item="...", qty=1, value=None', 'manage character inventory items');
    }

    const latest = findLatestMessage(interactionData, nextMessage.character);
    const inventory: Inventory = latest?.message?.inventory ? { ...latest.message.inventory } : {};

    switch (action) {
        case 'list': {
            const items = Object.entries(inventory).filter(([k]) => !k.startsWith('__')).map(([k, v]) => `${k}: ${v}`);
            return { toolType: 'inventory', args, content: items.join('\n') || 'Empty inventory', displayReplacement: `[📦 ${items.length} item(s)]` };
        }
        case 'add': {
            const item = pArgs.get(1, 'item', 'name');
            const qty = pArgs.getNumber(2, 'qty', 'quantity', 'count') ?? 1;
            if (!item) return { toolType: 'inventory', args, content: '[Error: inventory(action="add", item="...", qty=1) requires item]', displayReplacement: '[Error: Usage]' };
            const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0;
            inventory[item] = current + qty;
            nextMessage.inventory = inventory;
            return { toolType: 'inventory', args, content: `Added ${qty}x "${item}".`, displayReplacement: `[📦 +${qty} ${item}]` };
        }
        case 'remove': {
            const item = pArgs.get(1, 'item', 'name');
            const qty = pArgs.getNumber(2, 'qty', 'quantity', 'count') ?? 1;
            if (!item) return { toolType: 'inventory', args, content: '[Error: inventory(action="remove", item="...", qty=1) requires item]', displayReplacement: '[Error: Usage]' };
            const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0;
            if (current <= qty) delete inventory[item]; else inventory[item] = current - qty;
            nextMessage.inventory = inventory;
            return { toolType: 'inventory', args, content: `Removed ${qty}x "${item}".`, displayReplacement: `[📦 -${qty} ${item}]` };
        }
        case 'set': {
            const item = pArgs.get(1, 'item', 'name');
            const val = pArgs.get(2, 'value', 'val', 'qty');
            if (!item || val === undefined) return { toolType: 'inventory', args, content: '[Error: inventory(action="set", item="...", value=...) requires item and value]', displayReplacement: '[Error: Usage]' };
            inventory[item] = Number.isNaN(Number(val)) ? val : Number(val);
            nextMessage.inventory = inventory;
            return { toolType: 'inventory', args, content: `Set "${item}" to ${val}.`, displayReplacement: `[📦 Set ${item}]` };
        }
        default:
            return { toolType: 'inventory', args, content: `[Error: Unknown inventory action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Trade ──────────────────────────────────────────────────────────
// Signature: trade(action="give|take", target_character_id="...", item="...", qty=1)
function executeTrade(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const targetQuery = pArgs.get(1, 'target_character_id', 'target', 'character_id', 'character', 'to', 'from');
    const item = pArgs.get(2, 'item', 'name');
    const qty = pArgs.getNumber(3, 'qty', 'quantity', 'count') ?? 1;

    if (!action || !targetQuery || !item) {
        return helpResult('trade', 'action="give|take", target_character_id="...", item="...", qty=1', 'transfer items between characters');
    }

    const targetChar = resolveCharacter(targetQuery, interactionData, context?.allCharacters || []);
    if (!targetChar) return { toolType: 'trade', args, content: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[Error: Target not found]' };

    const myLatest = findLatestMessage(interactionData, nextMessage.character);
    const myInv: Inventory = myLatest?.message?.inventory ? { ...myLatest.message.inventory } : {};

    const targetLatest = findLatestMessage(interactionData, targetChar);
    if (!targetLatest) return { toolType: 'trade', args, content: `[Error: Target "${targetChar.name}" has no message history]`, displayReplacement: '[Error: Target missing]' };
    const targetInv: Inventory = targetLatest.message.inventory ? { ...targetLatest.message.inventory } : {};

    if (action === 'give') {
        const myQty = typeof myInv[item] === 'number' ? (myInv[item] as number) : 0;
        if (myQty < qty) return { toolType: 'trade', args, content: `[Error: Not enough "${item}". Have ${myQty}, need ${qty}]`, displayReplacement: '[Error: Lacks items]' };
        if (myQty <= qty) delete myInv[item]; else myInv[item] = myQty - qty;
        targetInv[item] = (typeof targetInv[item] === 'number' ? (targetInv[item] as number) : 0) + qty;
        nextMessage.inventory = myInv;
        return { toolType: 'trade', args, content: `Gave ${qty}x "${item}" to ${targetChar.name}.`, displayReplacement: `[🤝 Gave ${qty}x ${item} to ${targetChar.name}]` };
    }

    if (action === 'take') {
        const theirQty = typeof targetInv[item] === 'number' ? (targetInv[item] as number) : 0;
        if (theirQty < qty) return { toolType: 'trade', args, content: `[Error: ${targetChar.name} only has ${theirQty}x "${item}"]`, displayReplacement: '[Error: Target lacks items]' };
        if (theirQty <= qty) delete targetInv[item]; else targetInv[item] = theirQty - qty;
        myInv[item] = (typeof myInv[item] === 'number' ? (myInv[item] as number) : 0) + qty;
        nextMessage.inventory = myInv;
        return { toolType: 'trade', args, content: `Took ${qty}x "${item}" from ${targetChar.name}.`, displayReplacement: `[🤝 Took ${qty}x ${item} from ${targetChar.name}]` };
    }

    return { toolType: 'trade', args, content: `[Error: Unknown trade action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Invite ─────────────────────────────────────────────────────────
// Signature: invite(character_id="...")
function executeInvite(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'character_id', 'character', 'target', 'id')?.trim();
    if (!targetQuery) return helpResult('invite', 'character_id="..."', 'bring existing participant to current location');

    const targetChar = resolveCharacter(targetQuery, interactionData, context?.allCharacters || []);
    if (!targetChar) return { toolType: 'invite', args, content: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[Error: Target not found]' };

    appendPendingAction(nextMessage, { type: 'invite', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'invite', args, content: `Invited ${targetChar.name}.`, displayReplacement: `[📨 Invited ${targetChar.name}]` };
}

// ─── Kick ───────────────────────────────────────────────────────────
// Signature: kick(character_id="...", destination_location_id=None) | kick("characters") | kick("locations")
function executeKick(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'character_id', 'character', 'target', 'id')?.trim();
    if (!targetQuery) return helpResult('kick', 'character_id="...", destination_location_id=None', 'eject character from location');

    if (targetQuery.toLowerCase() === 'characters') {
        const list = getCoLocatedParticipants(interactionData, nextMessage.character).map(c => `${c.name} (${c.id})`);
        return { toolType: 'kick', args, content: list.join('\n') || 'No co-located characters', displayReplacement: `[👢 ${list.length} character(s)]` };
    }
    if (targetQuery.toLowerCase() === 'locations') {
        const reachable = getReachableLocationsByCharacter(interactionData, nextMessage.character);
        return { toolType: 'kick', args, content: reachable.map(l => `${l.name} (${l.id})`).join('\n') || 'No reachable locations', displayReplacement: `[👢 ${reachable.length} location(s)]` };
    }

    const targetChar = resolveCharacter(targetQuery, interactionData, context?.allCharacters || []);
    if (!targetChar) return { toolType: 'kick', args, content: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[Error: Target not found]' };

    const destLocQuery = pArgs.get(1, 'destination_location_id', 'destination', 'location_id', 'to');
    const destLoc = destLocQuery ? resolveLocation(destLocQuery, interactionData) : undefined;
    appendPendingAction(nextMessage, {
        type: 'kick',
        payload: {
            characterId: targetChar.id,
            characterName: targetChar.name,
            destinationLocationId: destLoc?.id || '',
            destinationLocationName: destLoc?.name || ''
        }
    });
    return { toolType: 'kick', args, content: `Kicked ${targetChar.name}.`, displayReplacement: `[👢 Kicked ${targetChar.name}]` };
}

// ─── Teleport ───────────────────────────────────────────────────────
// Signature: teleport(location_id="...")
function executeTeleport(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'location_id', 'location', 'destination', 'target')?.trim();
    if (!targetQuery) return helpResult('teleport', 'location_id="..."', 'instantly move character to any location');

    const targetLocation = resolveLocation(targetQuery, interactionData);
    if (!targetLocation) return { toolType: 'teleport', args, content: `[Error: Location "${targetQuery}" not found]`, displayReplacement: '[Error: Not found]' };

    return { toolType: 'teleport', args, content: `Teleported to "${targetLocation.name}".`, displayReplacement: `[⚡ Teleported to "${targetLocation.name}"]` };
}

// ─── Key ────────────────────────────────────────────────────────────
// Signature: key(action="lock|unlock", location_id="...", character_id=None)
function executeKey(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const locQuery = pArgs.get(1, 'location_id', 'location')?.trim();
    const charQuery = pArgs.get(2, 'character_id', 'character', 'target')?.trim();

    if (!action || !locQuery) {
        return helpResult('key', 'action="lock|unlock", location_id="...", character_id=None', 'lock or unlock locations');
    }

    const targetLoc = resolveLocation(locQuery, interactionData);
    if (!targetLoc) return { toolType: 'key', args, content: `[Error: Location "${locQuery}" not found]`, displayReplacement: '[Error: Location not found]' };

    const targetChar = charQuery ? resolveCharacter(charQuery, interactionData, context?.allCharacters || []) : undefined;
    const locked = nextMessage.characterLockedLocations ? { ...nextMessage.characterLockedLocations } : {};
    const charIds = targetChar ? [targetChar.id] : getSessionCharacters(interactionData).map(p => p.id);

    if (action === 'lock') {
        const existing = locked[targetLoc.id] ? [...locked[targetLoc.id]] : [];
        for (const cid of charIds) if (!existing.includes(cid)) existing.push(cid);
        locked[targetLoc.id] = existing;
        nextMessage.characterLockedLocations = locked;
        return { toolType: 'key', args, content: `Locked "${targetLoc.name}".`, displayReplacement: `[🔒 Locked "${targetLoc.name}"]` };
    }
    if (action === 'unlock') {
        delete locked[targetLoc.id];
        nextMessage.characterLockedLocations = locked;
        return { toolType: 'key', args, content: `Unlocked "${targetLoc.name}".`, displayReplacement: `[🔓 Unlocked "${targetLoc.name}"]` };
    }

    return { toolType: 'key', args, content: `[Error: Unknown key action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Clothing ───────────────────────────────────────────────────────
// Signature: clothing(character_id="...", action="wear|remove", clothing_id="...")
function executeClothing(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const charQuery = pArgs.get(0, 'character_id', 'character')?.trim();
    const action = pArgs.get(1, 'action', 'command')?.toLowerCase();
    const clothingQuery = pArgs.get(2, 'clothing_id', 'clothing', 'item')?.trim();

    if (!charQuery || !action || !clothingQuery) {
        return helpResult('clothing', 'character_id="...", action="wear|remove", clothing_id="..."', 'manage worn clothing items');
    }

    const targetChar = resolveCharacter(charQuery, interactionData, context?.allCharacters || []);
    if (!targetChar) return { toolType: 'clothing', args, content: `[Error: Character "${charQuery}" not found]`, displayReplacement: '[Error: Character not found]' };

    const clothing = targetChar.clothings?.find(c => c.id === clothingQuery || c.name.toLowerCase() === clothingQuery.toLowerCase());
    if (!clothing) return { toolType: 'clothing', args, content: `[Error: Clothing "${clothingQuery}" not found on ${targetChar.name}]`, displayReplacement: '[Error: Clothing not found]' };

    const wearing = nextMessage.characterClothingWearingStatuses ? { ...nextMessage.characterClothingWearingStatuses } : {};
    if (action === 'wear') {
        wearing[clothing.id] = true;
        nextMessage.characterClothingWearingStatuses = wearing;
        return { toolType: 'clothing', args, content: `${targetChar.name} wore "${clothing.name}".`, displayReplacement: `[👕 Wore "${clothing.name}"]` };
    }
    if (action === 'remove') {
        wearing[clothing.id] = false;
        nextMessage.characterClothingWearingStatuses = wearing;
        return { toolType: 'clothing', args, content: `${targetChar.name} removed "${clothing.name}".`, displayReplacement: `[👕 Removed "${clothing.name}"]` };
    }

    return { toolType: 'clothing', args, content: `[Error: Unknown clothing action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Summon ─────────────────────────────────────────────────────────
// Signature: summon(character_id="...")
function executeSummon(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const charQuery = pArgs.get(0, 'character_id', 'character', 'target', 'name')?.trim();
    if (!charQuery) return helpResult('summon', 'character_id="..."', 'add a non-participant character to current session');

    const allChars = context?.allCharacters || [];
    const targetChar = getGlobalCharacters(interactionData, allChars).find(c => c.id === charQuery || c.name.toLowerCase() === charQuery.toLowerCase()) || allChars.find(c => c.id === charQuery || c.name.toLowerCase() === charQuery.toLowerCase());
    if (!targetChar) return { toolType: 'summon', args, content: `[Error: Character "${charQuery}" does not exist]`, displayReplacement: '[Error: Character not found]' };

    appendPendingAction(nextMessage, { type: 'summon', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'summon', args, content: `Summoned ${targetChar.name}.`, displayReplacement: `[✨ Summoned ${targetChar.name}]` };
}

// ─── Narrate ────────────────────────────────────────────────────────
// Signature: narrate(text="...")
function executeNarrate(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    const text = pArgs.get(0, 'text', 'narration', 'content')?.trim();
    if (!text) return helpResult('narrate', 'text="..."', 'inject ambient narration without consuming chat stamina');
    return { toolType: 'narrate', args, content: text, displayReplacement: `[🎙️ ${text}]` };
}

// ─── Inspect ────────────────────────────────────────────────────────
// Signature: inspect(character_id="...")
function executeInspect(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const charQuery = pArgs.get(0, 'character_id', 'character', 'target')?.trim();
    if (!charQuery) return helpResult('inspect', 'character_id="..."', "examine character's visible state");

    const targetChar = resolveCharacter(charQuery, interactionData, context?.allCharacters || []);
    if (!targetChar) return { toolType: 'inspect', args, content: `[Error: Character "${charQuery}" not found]`, displayReplacement: '[Error: Character not found]' };

    const latest = findLatestMessage(interactionData, targetChar);
    const loc = latest ? interactionData.locations?.find(l => l.id === latest.locationId)?.name || 'unknown' : 'unknown';
    const expr = latest?.message.characterExpression || 'neutral';
    const items = Object.keys(latest?.message.inventory || {}).filter(k => !k.startsWith('__')).length;

    return {
        toolType: 'inspect',
        args,
        content: `${targetChar.name} (${targetChar.id}): Location: ${loc}, Expression: ${expr}, Items: ${items}`,
        displayReplacement: `[🔍 ${targetChar.name}: 📍${loc}, 😊${expr}, 📦${items}]`
    };
}

// ─── Administrator ──────────────────────────────────────────────────
// Signature: administrator(action="...", arg1="...", arg2="...")
function executeAdministrator(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('administrator', 'action="switch_model|join_session|...", arg1="...", arg2="..."', 'manage session settings');
    }

    switch (action) {
        case 'list_chats':
            return { toolType: 'administrator', args, content: `Session: "${interactionData.name}"`, displayReplacement: '[🔧 Session info]' };
        case 'list_accounts': {
            const accounts = (context?.allAccounts || []).map(a => `${a.id} | ${a.username}`);
            return { toolType: 'administrator', args, content: accounts.join('\n') || 'No accounts', displayReplacement: `[🔑 ${accounts.length} account(s)]` };
        }
        case 'switch_model': {
            const modelName = pArgs.get(1, 'model_name', 'name', 'model')?.trim();
            if (!modelName) return { toolType: 'administrator', args, content: '[Error: administrator(action="switch_model", model_name="...") requires model name]', displayReplacement: '[Error: Usage]' };
            appendPendingAction(nextMessage, { type: 'administrator_switch_model', payload: { modelName } });
            return { toolType: 'administrator', args, content: `Requested switch to model "${modelName}".`, displayReplacement: `[🔧 Switch: ${modelName}]` };
        }
        case 'join_session': {
            const sessionId = pArgs.get(1, 'session_id', 'id')?.trim();
            const password = pArgs.get(2, 'password', 'pwd')?.trim() || '';
            if (!sessionId) return { toolType: 'administrator', args, content: '[Error: administrator(action="join_session", session_id="...", password="") requires session ID]', displayReplacement: '[Error: Usage]' };
            appendPendingAction(nextMessage, { type: 'administrator_join_session', payload: { sessionId, password } });
            return { toolType: 'administrator', args, content: `Join requested for session "${sessionId}".`, displayReplacement: `[👥 Join: ${sessionId}]` };
        }
        case 'leave_session':
            appendPendingAction(nextMessage, { type: 'administrator_leave_session', payload: {} });
            return { toolType: 'administrator', args, content: 'Leave session requested.', displayReplacement: '[👥 Leave session]' };
        default:
            return { toolType: 'administrator', args, content: `[Error: Unknown administrator action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Creator ────────────────────────────────────────────────────────
// Signature: creator(entity_type="...", name="...")
const VALID_ENTITY_TYPES = ['character', 'context', 'location', 'audio_track', 'prompt_block', 'stop_pattern', 'sampler', 'budget_strategy', 'profile', 'world', 'memory', 'extension', 'account', 'multiplayer_data'];

function executeCreator(args: string, nextMessage: BaseMessage, _interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const entityType = pArgs.get(0, 'entity_type', 'type')?.toLowerCase();
    const entityName = pArgs.get(1, 'name', 'entity_name')?.trim();

    if (!entityType || !entityName) {
        return helpResult('creator', 'entity_type="...", name="..."', `valid types: ${VALID_ENTITY_TYPES.join(', ')}`);
    }
    if (!VALID_ENTITY_TYPES.includes(entityType)) {
        return { toolType: 'creator', args, content: `[Error: Unknown type "${entityType}". Valid: ${VALID_ENTITY_TYPES.join(', ')}]`, displayReplacement: '[Error: Invalid type]' };
    }

    appendPendingAction(nextMessage, { type: 'creator', payload: { entityType, entityName } });
    context?.addToast?.(`Creator: ${entityType} "${entityName}" initiated.`, 'info');
    return { toolType: 'creator', args, content: `Created ${entityType} "${entityName}".`, displayReplacement: `[🛠️ ${entityType}: "${entityName}"]` };
}

// ─── Destroyer ──────────────────────────────────────────────────────
// Signature: destroyer(entity_type="...", entity_id="...")
function executeDestroyer(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const entityType = pArgs.get(0, 'entity_type', 'type')?.toLowerCase();
    const entityId = pArgs.get(1, 'entity_id', 'id', 'name')?.trim();

    if (!entityType || !entityId) {
        return helpResult('destroyer', 'entity_type="...", entity_id="..."', `valid types: ${VALID_ENTITY_TYPES.join(', ')}`);
    }
    if (!VALID_ENTITY_TYPES.includes(entityType)) {
        return { toolType: 'destroyer', args, content: `[Error: Unknown type "${entityType}"]`, displayReplacement: '[Error: Invalid type]' };
    }

    if (entityType === 'character' && interactionData.protagonists?.some(p => p.id === entityId)) {
        return { toolType: 'destroyer', args, content: '[Error: Cannot destroy session protagonist]', displayReplacement: '[Error: Protected character]' };
    }

    appendPendingAction(nextMessage, { type: 'destroyer', payload: { entityType, entityId, entityName: entityId } });
    context?.addToast?.(`Destroyer: ${entityType} "${entityId}" initiated.`, 'info');
    return { toolType: 'destroyer', args, content: `Destroyed ${entityType} "${entityId}".`, displayReplacement: `[💀 Destroyed: "${entityId}"]` };
}

// ─── Open Browser ───────────────────────────────────────────────────
// Signature: browser(url_or_search_query="...")
async function executeOpenBrowser(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context?: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const input = pArgs.get(0, 'url_or_search_query', 'url', 'query', 'search')?.trim();
    if (!input) return helpResult('browser', 'url_or_search_query="..."', 'open webpage or web search in browser');

    const isDirectUrl = /^https?:\/\//i.test(input) || /^[\w-]+\.[\w-]+(\S*)/i.test(input);
    const finalUrl = isDirectUrl ? (/^https?:\/\//i.test(input) ? input : `https://${input}`) : buildSearchUrl([input], 'Google');

    const res = await readFile(finalUrl);
    if (!res.success) {
        return { toolType: 'browser', args, content: `[Error: ${res.error || 'Failed to open browser'}]`, displayReplacement: '[❌ Browser failed]' };
    }

    context?.addToast?.(`Browser: ${input}`, 'info');
    return { toolType: 'browser', args, content: `Opened browser to: "${finalUrl}".`, displayReplacement: `[🌐 Browser: "${input}"]` };
}

// ─── Read File ──────────────────────────────────────────────────────
// Signature: read_file(path_or_url="...")
async function executeReadFile(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context?: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const target = pArgs.get(0, 'path_or_url', 'path', 'file_path', 'url')?.trim();
    if (!target) return helpResult('read_file', 'path_or_url="..."', 'open local file, video, or link in default app');

    const res = await readFile(target);
    if (!res.success) {
        return { toolType: 'read_file', args, content: `[Error: ${res.error || 'Failed to open target'}]`, displayReplacement: '[❌ Open failed]' };
    }

    context?.addToast?.(`Opened: ${target}`, 'info');
    return { toolType: 'read_file', args, content: `Opened: "${res.target || target}".`, displayReplacement: `[🔗 Opened: "${target}"]` };
}

// ─── Write File ─────────────────────────────────────────────────────
// Signature: write_file(file_path="...", content="...")
async function executeWriteFile(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context?: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const filePath = pArgs.get(0, 'file_path', 'path', 'filename')?.trim();
    const content = pArgs.get(1, 'content', 'text', 'data');

    if (!filePath || content === undefined) {
        return helpResult('write_file', 'file_path="...", content="..."', 'write or create a file on local filesystem');
    }

    const res = await writeFile(filePath, content);
    if (!res.success) {
        return { toolType: 'write_file', args, content: `[Error: ${res.error || 'Failed to write file'}]`, displayReplacement: '[❌ Write failed]' };
    }

    context?.addToast?.(`File written: ${filePath}`, 'success');
    return { toolType: 'write_file', args, content: `Successfully wrote file to "${res.path || filePath}".`, displayReplacement: `[📁 Saved: "${filePath}"]` };
}

// ─── Process Pending Tool Actions ───────────────────────────────────

export function processPendingToolActions(
    data: InteractionData,
    allCharacters: Character[],
    options?: { onToast?: (msg: string, type: 'success' | 'error' | 'info') => void }
): InteractionData {
    const protagonistIds = new Set(data.protagonists?.map(p => p.id) ?? []);
    const history = getGlobalMessageHistory(data);
    let lastAiCharId: string | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.messageType === 'chat' && !protagonistIds.has(msg.character.id)) { lastAiCharId = msg.character.id; break; }
    }
    if (!lastAiCharId) return data;

    const findPrevMsg = (d: InteractionData, charId: string) => {
        const char = allCharacters.find(c => c.id === charId);
        if (!char) return null;
        const latest = findLatestMessage(d, char);
        return latest?.message || null;
    };

    const charLastMsg = findPrevMsg(data, lastAiCharId);
    if (!charLastMsg || charLastMsg.messageType !== 'chat') return data;
    const targetMsg = charLastMsg as ChatMessage;
    const latestInfo = findLatestMessage(data, targetMsg.character);
    if (!latestInfo) return data;

    const actions = loadPendingToolActions(targetMsg.inventory);
    if (actions.length === 0) return data;

    let updatedData = { ...data, interactionHistories: { ...data.interactionHistories } };
    let changed = false;

    for (const action of actions) {
        switch (action.type) {
            case 'summon': {
                const charId = action.payload.characterId;
                const sessionParticipants = updatedData.participants || [];
                if (sessionParticipants.some(p => p.id === charId)) break;
                const realCharacter = allCharacters.find(c => c.id === charId);
                if (!realCharacter) { options?.onToast?.(`⚠️ Cannot summon "${action.payload.characterName}": not found.`, 'error'); break; }
                updatedData = { ...updatedData, participants: [...sessionParticipants, { ...realCharacter }], lastUpdatedTimestamp: Date.now() };
                changed = true;
                options?.onToast?.(`✨ ${realCharacter.name} joined.`, 'info');
                break;
            }
            case 'kick': {
                const sessionParticipants = updatedData.participants || [];
                const kickedChar = sessionParticipants.find(p => p.id === action.payload.characterId);
                if (kickedChar) {
                    const destLocId = action.payload.destinationLocationId;
                    const prevKickedMsg = findPrevMsg(updatedData, kickedChar.id);
                    const prevLockedLocations = prevKickedMsg?.characterLockedLocations ?? {};
                    const kickMsg: HistoryMessage = {
                        messageType: 'interaction', id: uuidv4(), character: { ...kickedChar }, isPresent: true,
                        characterClothingWearingStatuses: (prevKickedMsg as ChatMessage)?.characterClothingWearingStatuses ?? {},
                        characterLockedLocations: { ...prevLockedLocations },
                        parentMessageId: history.length > 0 ? history[history.length - 1].id : null,
                        firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
                    };
                    if (destLocId) {
                        if (!updatedData.interactionHistories[destLocId]) updatedData.interactionHistories[destLocId] = [];
                        updatedData.interactionHistories[destLocId] = [...updatedData.interactionHistories[destLocId], kickMsg];
                    }
                    updatedData = { ...updatedData, lastUpdatedTimestamp: Date.now() };
                    changed = true;
                    options?.onToast?.(`👢 ${action.payload.characterName} kicked to ${action.payload.destinationLocationName || 'unknown'}.`, 'info');
                }
                break;
            }
            case 'invite': {
                const charId = action.payload.characterId;
                let invitedChar = (updatedData.participants || []).find(p => p.id === charId);
                if (!invitedChar) invitedChar = allCharacters.find(c => c.id === charId);
                if (invitedChar) {
                    const charToInvite = invitedChar;
                    const kickerLoc = getCurrentLocation(updatedData, charLastMsg.character);
                    const currentLocId = kickerLoc?.id;
                    const prevInvitedMsg = findPrevMsg(updatedData, charToInvite.id);
                    const prevLockedLocations = prevInvitedMsg?.characterLockedLocations ?? {};
                    const inviteMsg: HistoryMessage = {
                        messageType: 'interaction', id: uuidv4(), character: { ...charToInvite }, isPresent: true,
                        characterClothingWearingStatuses: (prevInvitedMsg as ChatMessage)?.characterClothingWearingStatuses ?? {},
                        characterLockedLocations: { ...prevLockedLocations },
                        parentMessageId: history.length > 0 ? history[history.length - 1].id : null,
                        firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
                    };
                    if (currentLocId) {
                        if (!updatedData.interactionHistories[currentLocId]) updatedData.interactionHistories[currentLocId] = [];
                        updatedData.interactionHistories[currentLocId] = [...updatedData.interactionHistories[currentLocId], inviteMsg];
                    }
                    const isAlreadyPart = (updatedData.participants || []).some(p => p.id === charToInvite.id);
                    const newParticipants = isAlreadyPart ? (updatedData.participants || []) : [...(updatedData.participants || []), { ...charToInvite }];
                    updatedData = { ...updatedData, participants: newParticipants, lastUpdatedTimestamp: Date.now() };
                    changed = true;
                    options?.onToast?.(`📨 ${action.payload.characterName} arrived.`, 'info');
                }
                break;
            }
            case 'whisper': {
                const targetIds = action.payload.targetCharacterIds.split(',');
                const text = action.payload.text;
                const senderLatest = findLatestMessage(updatedData, charLastMsg.character);
                const locId = senderLatest?.locationId || 'global';
                const whisperMsg: WhisperMessage = {
                    messageType: 'whisper', id: uuidv4(), character: { ...charLastMsg.character }, textContent: text, targetCharacterIds: targetIds, files: [],
                    modelTextContentSummaries: {}, modelInteractionTextContentSummaries: {}, kvCacheTextContentPaths: {}, kvCacheTextContentSummaryPaths: {}, kvCacheInteractionTextContentSummaries: {},
                    characterClothingWearingStatuses: (charLastMsg as ChatMessage)?.characterClothingWearingStatuses ?? {},
                    characterLockedLocations: charLastMsg.characterLockedLocations ?? {},
                    parentMessageId: charLastMsg.id, firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
                };
                if (!updatedData.interactionHistories[locId]) updatedData.interactionHistories[locId] = [];
                updatedData.interactionHistories[locId] = [...updatedData.interactionHistories[locId], whisperMsg];
                updatedData = { ...updatedData, lastUpdatedTimestamp: Date.now() };
                changed = true;
                break;
            }
            case 'administrator_move_protagonist': options?.onToast?.(`🔧 Transfer to "${action.payload.chatId}" requested.`, 'info'); break;
            case 'administrator_switch_model': options?.onToast?.(`🔧 Switch to "${action.payload.modelName}" requested.`, 'info'); break;
            case 'administrator_toggle_account': options?.onToast?.(`🔑 Toggle account "${action.payload.accountId}" requested.`, 'info'); break;
            case 'administrator_join_session': options?.onToast?.(`👥 Join session "${action.payload.sessionId}" requested.`, 'info'); break;
            case 'administrator_leave_session': options?.onToast?.(`👥 Leave session requested.`, 'info'); break;
            case 'administrator_accept_join': options?.onToast?.(`👥 Accept join for "${action.payload.accountId}" requested.`, 'info'); break;
            case 'administrator_reject_join': options?.onToast?.(`👥 Reject join for "${action.payload.accountId}" requested.`, 'info'); break;
            case 'creator': options?.onToast?.(`🛠️ ${action.payload.entityType} "${action.payload.entityName}" creation requested.`, 'info'); break;
            case 'destroyer': options?.onToast?.(`💀 ${action.payload.entityType} "${action.payload.entityName}" deletion requested.`, 'info'); break;
        }
    }
    if (!changed) return data;
    const locId = latestInfo.locationId;
    const locMsgs = updatedData.interactionHistories[locId] || [];
    const targetMsgIdx = locMsgs.findIndex(m => m.id === targetMsg.id);
    if (targetMsgIdx !== -1) {
        const cleanedMsg = { ...locMsgs[targetMsgIdx] } as ChatMessage;
        const cleanedInventory = cleanedMsg.inventory ? { ...cleanedMsg.inventory } : {};
        delete cleanedInventory['__pending_tool_actions__'];
        if (Object.keys(cleanedInventory).length === 0) delete cleanedMsg.inventory; else cleanedMsg.inventory = cleanedInventory;
        updatedData.interactionHistories[locId] = [...locMsgs];
        updatedData.interactionHistories[locId][targetMsgIdx] = cleanedMsg;
    }
    return { ...updatedData, lastUpdatedTimestamp: Date.now() };
}