// src/services/ToolExecutor.ts
import type { ToolInvocation } from '../services/ToolInvocationParser';
import { fetchLinkContent, buildSearchUrl } from '../utilities/linkFetcher';
import { collectActiveDialoguePromptContent, buildDialogueSearchSpace } from '../utilities/dialoguePromptLogic';
import type { BaseMessage, Character, Context, Location, AudioTrack, profile, InteractionData, Inventory, ChatMessage, WhisperMessage, PromptBlock, StopPattern, Sampler, BudgetStrategy, World, Memory, Extension, Account, MultiplayerData, toolUsageDisplayMode, HistoryMessage } from '../types';
import { findLatestMessage } from '../utilities/messageLogic';
import { getGlobalMessageHistory } from '../utilities/timelineLogic';
import { getCurrentLocation, getReachableLocationsByCharacter, isCharacterLockedFromLocation, getCoLocatedParticipants } from '../utilities/locationLogic';
import { getAudioEngine } from './AudioEngine';
import { generateCharacterMemory } from './ChatMessageSummarizationEngine';
import { saveRawCharacter } from '../storages/serverStorage';
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
    allProfiles?: profile[];
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
    if (executeFunction) {
        const result = await executeFunction(args, nextMessage, interactionData, context, displayMode);
        // Ensure result fields are trimmed of rogue surrounding whitespaces/newlines
        return {
            ...result,
            content: result.content.trim(),
            displayReplacement: result.displayReplacement.trim(),
        };
    }
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

function helpResult(toolType: string, args: string, usage: string): ToolResult {
    return { toolType, args, content: usage, displayReplacement: `[${toolType}: ${usage.split('\n')[0]}]` };
}

// ─── Display Mode Formatter (Sanitized against rogue newlines) ───────
export function formatToolDisplay(
    result: ToolResult,
    rawMatch: string,
    mode: toolUsageDisplayMode,
): string {
    const cleanDisplay = result.displayReplacement.trim();
    const cleanContent = result.content.trim();

    switch (mode) {
        case 'none': 
            return cleanDisplay;
        case 'icon': {
            const iconMatch = cleanDisplay.match(/^\[?([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}⚡🔧💀🛠️✨📨🔒🔓👕🎙️📝📦🗺️🌐🔍🎲🪙📅⏱️❓💭🤫])/u);
            return iconMatch ? iconMatch[1] : cleanDisplay;
        }
        case 'simple': 
        case 'detailed': 
            // Flatten internal newlines in inline display to prevent breaking message vertical rhythm
            return cleanDisplay.replace(/\n+/g, ' ');
        case 'full': 
            return `[${result.toolType}(${result.args}) → ${cleanContent}]`;
        case 'raw': 
            return rawMatch;
        default: 
            return cleanDisplay.replace(/\n+/g, ' ');
    }
}

// ─── Whisper ────────────────────────────────────────────────────────
function executeWhisper(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('whisper', args, 'whisper <target_char_id[,target2_id]> <text> — send a private message visible only to the target(s)');
    }
    const firstSpace = trimmed.indexOf(' ');
    if (firstSpace === -1) {
        return { toolType: 'whisper', args, content: '[Error: Usage: whisper <target_char_id> <text>]', displayReplacement: '[Error: Missing text]' };
    }
    const targetIdsStr = trimmed.substring(0, firstSpace);
    const text = trimmed.substring(firstSpace + 1).trim();
    if (!text) {
        return { toolType: 'whisper', args, content: '[Error: Missing text]', displayReplacement: '[Error: Missing text]' };
    }
    const targetIdentifiers = targetIdsStr.split(',').map(id => id.trim()).filter(id => id.length > 0);
    if (targetIdentifiers.length === 0) {
        return { toolType: 'whisper', args, content: '[Error: No valid targets]', displayReplacement: '[Error: No valid targets]' };
    }
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
        return { toolType: 'whisper', args, content: '[Error: No valid targets found]', displayReplacement: '[Error: No valid targets]' };
    }
    appendPendingAction(nextMessage, {
        type: 'whisper',
        payload: { targetCharacterIds: validTargetIds.join(','), text: text }
    });
    const display = `[🤫 Whispered to ${validTargetNames.join(', ')}]`;
    return { toolType: 'whisper', args, content: text, displayReplacement: display };
}

// ─── Think ──────────────────────────────────────────────────────────
function executeThink(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const reasoning = args.trim();
    if (!reasoning) {
        return helpResult('think', args, 'think <reasoning> — evaluate whether to speak, what to say, or stay silent based on conversation context');
    }
    const character = nextMessage.character;
    const characterId = character.id;
    const history = getGlobalMessageHistory(interactionData);
    const coLocatedParticipants = getCoLocatedParticipants(interactionData, character);
    let wasAddressed = false;
    const recentWindow = coLocatedParticipants.length;
    for (let i = history.length - recentWindow; i < history.length; i++) {
        if (i < 0) continue;
        const msg = history[i];
        if (msg.messageType === 'chat' && msg.character.id !== characterId) {
            const text = (msg as ChatMessage).textContent.toLowerCase();
            const charName = nextMessage.character.name.toLowerCase();
            if (text.includes(charName)) {
                wasAddressed = true;
                break;
            }
        }
    }
    let messagesSinceLastSpoke = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].messageType === 'chat' && history[i].character.id === characterId) break;
        messagesSinceLastSpoke++;
    }
    const remainingChatStamina = nextMessage.remainingChatStamina;
    const maximumChatStamina = character.maximumChatStamina;
    const contextLines: string[] = [];
    contextLines.push(`You are ${nextMessage.character.name}.`);
    contextLines.push(`You were ${wasAddressed ? 'addressed' : 'not addressed'} in recent messages.`);
    contextLines.push(`Messages since you last spoke: ${messagesSinceLastSpoke}.`);
    if (remainingChatStamina !== undefined) {
        contextLines.push(`Remaining chat stamina: ${remainingChatStamina}.`);
    }
    if (maximumChatStamina !== undefined) {
        contextLines.push(`Maximum chat stamina: ${maximumChatStamina}.`);
    }
    contextLines.push(`Your reasoning: ${reasoning}`);
    contextLines.push('');
    contextLines.push('Based on your reasoning and the above context, decide: should you speak now? Respond with your decision and brief justification. If you decide to speak, continue naturally after this tool result.');
    const content = contextLines.join('\n');
    return {
        toolType: 'think',
        args: reasoning,
        content,
        displayReplacement: `[💭 ${nextMessage.character.name} is thinking...]`,
    };
}

// ─── Random Pick ────────────────────────────────────────────────----
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

// ─── Clock ────────────────────────────────────────────────────────────
function executeClock(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const now = new Date();
    const trimmed = args.trim().toLowerCase();
    let timeStr: string;
    if (trimmed === '24h' || trimmed === '24') {
        timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else if (trimmed === 'unix' || trimmed === 'timestamp') {
        timeStr = Math.floor(now.getTime() / 1000).toString();
    } else {
        timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    }
    return { toolType: 'clock', args, content: timeStr, displayReplacement: `[🕰️ ${timeStr}]` };
}

// ─── Date / Calendar ────────────────────────────────────────────────
function executeCalendar(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
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
        const count = match[1] ? Number.parseInt(match[1], 10) : 1;
        const sides = Number.parseInt(match[2], 10);
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
        modifier = Number.parseInt(modMatch[2], 10);
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
    if (dashMatch) { min = Number.parseInt(dashMatch[1], 10); max = Number.parseInt(dashMatch[2], 10); }
    else if (toMatch) { min = Number.parseInt(toMatch[1], 10); max = Number.parseInt(toMatch[2], 10); }
    else {
        const single = Number.parseInt(trimmed, 10);
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

// ─── RNG Table ────────────────────────────────────────────────────────
function executeRng(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('rng', args, 'rng <context_id> — roll on a named RNG table defined in contexts (entries: "1-10: outcome")');
    }
    const contexts = interactionData.contexts || [];
    let tableContext = contexts.find(c => c.id === trimmed && c.text);
    if (!tableContext) {
        const lowerTrimmed = trimmed.toLowerCase();
        tableContext = contexts.find(c => c.name?.toLowerCase() === lowerTrimmed && c.text);
    }
    if (!tableContext || !tableContext.text) {
        const errorContent = `[Error: RNG table "${trimmed}" not found.]`;
        return { toolType: 'rng', args, content: errorContent, displayReplacement: errorContent };
    }
    const lines = tableContext.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
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
        const errorContent = `[Error: Table "${tableContext.name}" has no valid entries.]`;
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
    const currentLocation = getCurrentLocation(interactionData, nextMessage.character);
    if (!currentLocation) return { toolType: 'move', args, content: '[Error: No current location set.]', displayReplacement: '[Error: No current location set.]' };
    const targetLocation = resolveLocation(trimmed, interactionData);
    if (!targetLocation) return { toolType: 'move', args, content: `[Error: Location "${trimmed}" not found.]`, displayReplacement: `[Error: Location "${trimmed}" not found.]` };
    if (targetLocation.id === currentLocation.id) return { toolType: 'move', args, content: `Already at "${targetLocation.name}" (${targetLocation.id}).`, displayReplacement: `[🚶 Already at "${targetLocation.name}"]` };
    const isAdjacent = currentLocation.locationBindings?.includes(targetLocation.id) || targetLocation.locationBindings?.includes(currentLocation.id);
    if (!isAdjacent) return { toolType: 'move', args, content: `[Error: "${targetLocation.name}" is not adjacent.]`, displayReplacement: `[Error: Not adjacent]` };
    if (isCharacterLockedFromLocation(interactionData, nextMessage.character.id, targetLocation.id)) {
        return { toolType: 'move', args, content: `[Error: "${targetLocation.name}" is locked for you.]`, displayReplacement: `[Error: Location locked]` };
    }
    return { toolType: 'move', args, content: `Moved to "${targetLocation.name}" (${targetLocation.id}).`, displayReplacement: `[🚶 Moved to "${targetLocation.name}"]` };
}

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
    if (!matched) { const plainNum = Number.parseInt(trimmed, 10); if (!isNaN(plainNum) && plainNum > 0) return plainNum * 1000; return null; }
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
    const latest = findLatestMessage(interactionData, nextMessage.character);
    const currentMessage = latest?.message;
    const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
    const timers = loadTimers(inventory);
    const now = Date.now();
    switch (subcommand) {
        case 'set': {
            if (parts.length < 3) return { toolType: 'timer', args, content: '[Error: Usage: timer set <name> <duration>]', displayReplacement: '[Error: Usage]' };
            const name = parts[1], durationStr = parts.slice(2).join(' '), durationMs = parseDurationToMs(durationStr);
            if (!durationMs) return { toolType: 'timer', args, content: `[Error: Invalid duration "${durationStr}"]`, displayReplacement: '[Error: Invalid duration]' };
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
            return { toolType: 'timer', args, content: timers.map(t => { const r = t.targetTimestamp - now; return r <= 0 ? `${t.name}: EXPIRED` : `${t.name}: ${formatDuration(r)} remaining`; }).join('\n'), displayReplacement: `[⏱️ ${timers.length} active timer(s)]` };
        }
        case 'delete': {
            if (parts.length < 2) return { toolType: 'timer', args, content: '[Error: Usage: timer delete <name>]', displayReplacement: '[Error: Usage]' };
            const name = parts.slice(1).join(' ').toLowerCase();
            const idx = timers.findIndex(t => t.name.toLowerCase() === name);
            if (idx === -1) return { toolType: 'timer', args, content: `No timer named "${name}".`, displayReplacement: '[⏱️ No timer]' };
            const deletedName = timers[idx].name; timers.splice(idx, 1);
            saveTimers(inventory, timers); nextMessage.inventory = inventory;
            return { toolType: 'timer', args, content: `Timer "${deletedName}" deleted.`, displayReplacement: `[⏱️ Deleted: "${deletedName}"]` };
        }
        case 'list': {
            if (timers.length === 0) return { toolType: 'timer', args, content: 'No active timers.', displayReplacement: '[⏱️ No active timers]' };
            return { toolType: 'timer', args, content: timers.map(t => { const r = t.targetTimestamp - now; return r <= 0 ? `${t.name}: EXPIRED` : `${t.name}: ${formatDuration(r)} remaining`; }).join('\n'), displayReplacement: `[⏱️ ${timers.length} timer(s)]` };
        }
        default: return { toolType: 'timer', args, content: `[Error: Unknown timer command.]`, displayReplacement: '[Error: Unknown command]' };
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
    const latest = findLatestMessage(interactionData, nextMessage.character);
    const currentMessage = latest?.message;
    const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
    const stopwatches = loadStopwatches(inventory);
    const now = Date.now();
    switch (subcommand) {
        case 'start': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch start <name>]', displayReplacement: '[Error: Usage]' };
            const name = parts.slice(1).join(' ');
            const filtered = stopwatches.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, startTimestamp: now }); saveStopwatches(inventory, filtered); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopwatch "${name}" started.`, displayReplacement: `[⏱️ Stopwatch "${name}" started]` };
        }
        case 'pause': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch pause <name>]', displayReplacement: '[Error: Usage]' };
            const sw = stopwatches.find(s => s.name.toLowerCase() === parts.slice(1).join(' ').toLowerCase());
            if (!sw) return { toolType: 'stopwatch', args, content: `No stopwatch.`, displayReplacement: '[⏱️ No stopwatch]' };
            if (sw.pausedElapsedMs !== undefined) return { toolType: 'stopwatch', args, content: `Already paused.`, displayReplacement: '[⏱️ Already paused]' };
            sw.pausedElapsedMs = now - sw.startTimestamp; saveStopwatches(inventory, stopwatches); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Paused at ${formatDuration(sw.pausedElapsedMs)}.`, displayReplacement: `[⏱️ Paused: ${formatDuration(sw.pausedElapsedMs)}]` };
        }
        case 'resume': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch resume <name>]', displayReplacement: '[Error: Usage]' };
            const sw = stopwatches.find(s => s.name.toLowerCase() === parts.slice(1).join(' ').toLowerCase());
            if (!sw) return { toolType: 'stopwatch', args, content: `No stopwatch.`, displayReplacement: '[⏱️ No stopwatch]' };
            if (sw.pausedElapsedMs === undefined) return { toolType: 'stopwatch', args, content: `Not paused.`, displayReplacement: '[⏱️ Not paused]' };
            sw.startTimestamp = now - sw.pausedElapsedMs; delete sw.pausedElapsedMs; saveStopwatches(inventory, stopwatches); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Resumed.`, displayReplacement: '[⏱️ Resumed]' };
        }
        case 'stop': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch stop <name>]', displayReplacement: '[Error: Usage]' };
            const idx = stopwatches.findIndex(s => s.name.toLowerCase() === parts.slice(1).join(' ').toLowerCase());
            if (idx === -1) return { toolType: 'stopwatch', args, content: `No stopwatch.`, displayReplacement: '[⏱️ No stopwatch]' };
            const sw = stopwatches[idx], elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
            stopwatches.splice(idx, 1); saveStopwatches(inventory, stopwatches); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Stopped at ${formatDuration(elapsed)}.`, displayReplacement: `[⏱️ Stopped: ${formatDuration(elapsed)}]` };
        }
        case 'reset': {
            if (parts.length < 2) return { toolType: 'stopwatch', args, content: '[Error: Usage: stopwatch reset <name>]', displayReplacement: '[Error: Usage]' };
            const sw = stopwatches.find(s => s.name.toLowerCase() === parts.slice(1).join(' ').toLowerCase());
            if (!sw) return { toolType: 'stopwatch', args, content: `No stopwatch.`, displayReplacement: '[⏱️ No stopwatch]' };
            sw.startTimestamp = now; delete sw.pausedElapsedMs; saveStopwatches(inventory, stopwatches); nextMessage.inventory = inventory;
            return { toolType: 'stopwatch', args, content: `Reset.`, displayReplacement: '[⏱️ Reset]' };
        }
        case 'check':
        case 'list': {
            const specificName = parts.slice(1).join(' ').toLowerCase();
            if (specificName && subcommand === 'check') {
                const sw = stopwatches.find(s => s.name.toLowerCase() === specificName);
                if (!sw) return { toolType: 'stopwatch', args, content: `No stopwatch.`, displayReplacement: '[⏱️ No stopwatch]' };
                const elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
                const status = sw.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING';
                return { toolType: 'stopwatch', args, content: `${sw.name}: ${formatDuration(elapsed)} (${status})`, displayReplacement: `[⏱️ ${sw.name}: ${formatDuration(elapsed)} ${status}]` };
            }
            if (stopwatches.length === 0) return { toolType: 'stopwatch', args, content: 'No active stopwatches.', displayReplacement: '[⏱️ No active stopwatches]' };
            return { toolType: 'stopwatch', args, content: stopwatches.map(s => { const e = s.pausedElapsedMs !== undefined ? s.pausedElapsedMs : now - s.startTimestamp; return `${s.name}: ${formatDuration(e)} (${s.pausedElapsedMs !== undefined ? 'PAUSED' : 'RUNNING'})`; }).join('\n'), displayReplacement: `[⏱️ ${stopwatches.length} stopwatch(es)]` };
        }
        default: return { toolType: 'stopwatch', args, content: `[Error: Unknown command]`, displayReplacement: '[Error: Unknown command]' };
    }
}

// ─── Schedule ───────────────────────────────────────────────────────
interface ScheduleEntry { name: string; triggerTimestamp: number; action: string; repeatIntervalMs?: number }

function loadSchedules(inventory: Inventory | undefined): ScheduleEntry[] {
    if (!inventory || typeof inventory['__schedules__'] !== 'string') return [];
    try { return JSON.parse(inventory['__schedules__'] as string); } catch { return []; }
}

function saveSchedules(inventory: Inventory, schedules: ScheduleEntry[]): void {
    if (schedules.length === 0) delete inventory['__schedules__']; else inventory['__schedules__'] = JSON.stringify(schedules);
}

function executeSchedule(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) {
        return helpResult('schedule', args, 'schedule set <name> <duration> <action> | schedule set_repeat <name> <interval> <action> | schedule check [name] | schedule cancel <name> | schedule cancel_all | schedule list');
    }
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const latest = findLatestMessage(interactionData, nextMessage.character);
    const currentMessage = latest?.message;
    const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
    const schedules = loadSchedules(inventory);
    const now = Date.now();
    switch (subcommand) {
        case 'set': {
            if (parts.length < 4) return { toolType: 'schedule', args, content: '[Error: Usage: schedule set <name> <duration> <action>]', displayReplacement: '[Error: Usage]' };
            const name = parts[1]; const durationStr = parts[2]; const action = parts.slice(3).join(' ');
            const durationMs = parseDurationToMs(durationStr);
            if (!durationMs) return { toolType: 'schedule', args, content: `[Error: Invalid duration]`, displayReplacement: '[Error: Invalid duration]' };
            const filtered = schedules.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, triggerTimestamp: now + durationMs, action });
            saveSchedules(inventory, filtered); nextMessage.inventory = inventory;
            return { toolType: 'schedule', args, content: `Scheduled "${name}" in ${formatDuration(durationMs)}: ${action}`, displayReplacement: `[📅 Scheduled "${name}" in ${formatDuration(durationMs)}]` };
        }
        case 'set_repeat': {
            if (parts.length < 4) return { toolType: 'schedule', args, content: '[Error: Usage: schedule set_repeat <name> <interval> <action>]', displayReplacement: '[Error: Usage]' };
            const name = parts[1]; const intervalStr = parts[2]; const action = parts.slice(3).join(' ');
            const intervalMs = parseDurationToMs(intervalStr);
            if (!intervalMs) return { toolType: 'schedule', args, content: `[Error: Invalid interval]`, displayReplacement: '[Error: Invalid interval]' };
            const filtered = schedules.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, triggerTimestamp: now + intervalMs, action, repeatIntervalMs: intervalMs });
            saveSchedules(inventory, filtered); nextMessage.inventory = inventory;
            return { toolType: 'schedule', args, content: `Repeating schedule "${name}" every ${formatDuration(intervalMs)}: ${action}`, displayReplacement: `[📅 Repeating "${name}"]` };
        }
        case 'check': {
            const specificName = parts.slice(1).join(' ').toLowerCase();
            if (specificName) {
                const entry = schedules.find(s => s.name.toLowerCase() === specificName);
                if (!entry) return { toolType: 'schedule', args, content: `No schedule named "${specificName}".`, displayReplacement: '[📅 No schedule]' };
                const remaining = entry.triggerTimestamp - now;
                const repeatStr = entry.repeatIntervalMs ? ` (repeats every ${formatDuration(entry.repeatIntervalMs)})` : ' (one-time)';
                if (remaining <= 0) return { toolType: 'schedule', args, content: `Schedule "${entry.name}" TRIGGERED: ${entry.action}${repeatStr}`, displayReplacement: `[📅 "${entry.name}": TRIGGERED]` };
                return { toolType: 'schedule', args, content: `Schedule "${entry.name}": ${formatDuration(remaining)} remaining.`, displayReplacement: `[📅 "${entry.name}": ${formatDuration(remaining)} left]` };
            }
            if (schedules.length === 0) return { toolType: 'schedule', args, content: 'No active schedules.', displayReplacement: '[📅 No active schedules]' };
            const lines = schedules.map(s => {
                const remaining = s.triggerTimestamp - now;
                const repeatStr = s.repeatIntervalMs ? ` (repeats ${formatDuration(s.repeatIntervalMs)})` : '';
                return remaining <= 0 ? `${s.name}: TRIGGERED → ${s.action}` : `${s.name}: ${formatDuration(remaining)} left → ${s.action}${repeatStr}`;
            });
            return { toolType: 'schedule', args, content: lines.join('\n'), displayReplacement: `[📅 ${schedules.length} schedule(s)]` };
        }
        case 'cancel': {
            if (parts.length < 2) return { toolType: 'schedule', args, content: '[Error: Usage: schedule cancel <name>]', displayReplacement: '[Error: Usage]' };
            const name = parts.slice(1).join(' ').toLowerCase();
            const idx = schedules.findIndex(s => s.name.toLowerCase() === name);
            if (idx === -1) return { toolType: 'schedule', args, content: `No schedule named "${name}".`, displayReplacement: '[📅 No schedule]' };
            const cancelledName = schedules[idx].name; schedules.splice(idx, 1);
            saveSchedules(inventory, schedules); nextMessage.inventory = inventory;
            return { toolType: 'schedule', args, content: `Cancelled schedule "${cancelledName}".`, displayReplacement: `[📅 Cancelled: "${cancelledName}"]` };
        }
        case 'cancel_all': {
            if (schedules.length === 0) return { toolType: 'schedule', args, content: 'No schedules to cancel.', displayReplacement: '[📅 No schedules]' };
            const count = schedules.length; saveSchedules(inventory, []); nextMessage.inventory = inventory;
            return { toolType: 'schedule', args, content: `Cancelled all ${count} schedule(s).`, displayReplacement: `[📅 Cancelled all]` };
        }
        case 'list': {
            if (schedules.length === 0) return { toolType: 'schedule', args, content: 'No active schedules.', displayReplacement: '[📅 No active schedules]' };
            const lines = schedules.map(s => {
                const remaining = s.triggerTimestamp - now;
                return remaining <= 0 ? `${s.name}: TRIGGERED → ${s.action}` : `${s.name}: ${formatDuration(remaining)} left → ${s.action}`;
            });
            return { toolType: 'schedule', args, content: lines.join('\n'), displayReplacement: `[📅 ${schedules.length} schedule(s)]` };
        }
        default: return { toolType: 'schedule', args, content: `[Error: Unknown command]`, displayReplacement: '[Error: Unknown command]' };
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
            return { toolType: 'web', args: query, content: `[Error: ${errorMsg}]`, displayReplacement: `[🌐 ${label}] [Error: ${errorMsg}]` };
        }
        const result = validResults[0];
        const label = isDirectUrl ? `Fetched: "${trimmedQuery}"` : `Searched: "${trimmedQuery}"`;
        // Clean single line preview for displayReplacement
        const cleanContentPreview = result.content.trim().replace(/\n+/g, ' ').substring(0, 150);
        return { toolType: 'web', args: query, content: result.content, displayReplacement: `[🌐 ${label}] ${cleanContentPreview}...` };
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
        return helpResult('dialogue', args, 'dialogue list | dialogue recall <id> — recall active dialogue instructions by ID');
    }
    const subcommand = trimmed.split(/\s+/)[0]?.toLowerCase();
    if (subcommand === 'list') {
        const entries = dialoguePrompts.map(dp => `${dp.id} | ${dp.name}`);
        return { toolType: 'dialogue', args, content: entries.join('\n'), displayReplacement: `[💬 ${entries.length} dialogue prompt(s)]` };
    }
    if (subcommand === 'recall') {
        const queryId = trimmed.slice(subcommand.length).trim();
        if (!queryId) return { toolType: 'dialogue', args, content: '[Error: Missing ID]', displayReplacement: '[Error: Missing ID]' };
        const matched = dialoguePrompts.filter(dp => dp.id === queryId || dp.id.startsWith(queryId));
        if (matched.length === 0) return { toolType: 'dialogue', args, content: `No dialogue prompt matching ID "${queryId}".`, displayReplacement: '[💬 No match]' };
        const textContentArray: string[] = [];
        const history = getGlobalMessageHistory(interactionData);
        for (const msg of history) { if (msg.messageType === 'chat') textContentArray.push((msg as ChatMessage).textContent); }
        const searchSpace = buildDialogueSearchSpace(textContentArray);
        const recalledContents = collectActiveDialoguePromptContent(matched, searchSpace);
        if (recalledContents.length === 0) return { toolType: 'dialogue', args, content: `Matched prompts but none are currently active.`, displayReplacement: '[💬 Inactive]' };
        return { toolType: 'dialogue', args, content: recalledContents.join('\n'), displayReplacement: `[💬 Recalled ${recalledContents.length} dialogue instruction(s)]` };
    }
    return { toolType: 'dialogue', args, content: '[Error: Unknown dialogue command]', displayReplacement: '[Error: Unknown command]' };
}

// ─── Knowledge ──────────────────────────────────────────────────────
function executeKnowledge(args: string, nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    const character = nextMessage.character;
    const knowledgePrompts = character.knowledgePrompts;
    if (!knowledgePrompts || knowledgePrompts.length === 0) return helpResult('knowledge', args, 'knowledge — no knowledge prompts configured');
    if (!trimmed) return helpResult('knowledge', args, 'knowledge list | knowledge recall <id>');
    const subcommand = trimmed.split(/\s+/)[0]?.toLowerCase();
    if (subcommand === 'list') {
        const entries = knowledgePrompts.map(kp => `${kp.id} | ${kp.name}`);
        return { toolType: 'knowledge', args, content: entries.join('\n'), displayReplacement: `[🧠 ${entries.length} knowledge prompt(s)]` };
    }
    if (subcommand === 'recall') {
        const queryId = trimmed.slice(subcommand.length).trim();
        if (!queryId) return { toolType: 'knowledge', args, content: '[Error: Missing ID]', displayReplacement: '[Error: Missing ID]' };
        let matched = knowledgePrompts.filter(kp => kp.id === queryId || kp.id.startsWith(queryId));
        if (matched.length === 0) return { toolType: 'knowledge', args, content: `No knowledge matching ID "${queryId}".`, displayReplacement: '[🧠 No match]' };
        const combined = matched.map(kp => `[${kp.id}] ${kp.name} ${kp.content}`).join(' --- ');
        return { toolType: 'knowledge', args, content: combined, displayReplacement: `[🧠 Recalled ${matched.length} knowledge entry(ies)]` };
    }
    return { toolType: 'knowledge', args, content: '[Error: Unknown command]', displayReplacement: '[Error: Unknown command]' };
}

// ─── Memory ─────────────────────────────────────────────────────────
async function executeMemory(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): Promise<ToolResult> {
    const trimmed = args.trim();
    const character = nextMessage.character;
    if (!trimmed) return helpResult('memory', args, 'memory list | memory recall [id] | memory save');
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    if (subcommand === 'list') {
        const memories = character.memories;
        if (!memories || Object.keys(memories).length === 0) return { toolType: 'memory', args, content: 'No memories stored.', displayReplacement: '[🧠 No memories]' };
        const entries: string[] = [];
        for (const [key, mems] of Object.entries(memories)) {
            for (const mem of mems) {
                const snippet = mem.content.length > 100 ? mem.content.substring(0, 100) + '...' : mem.content;
                entries.push(`${mem.id} | [${key}] ${mem.name}: ${snippet}`);
            }
        }
        return { toolType: 'memory', args, content: entries.join('\n'), displayReplacement: `[🧠 ${entries.length} memory(ies)]` };
    }
    if (subcommand === 'recall') {
        const memories = character.memories;
        if (!memories || Object.keys(memories).length === 0) return { toolType: 'memory', args, content: 'No memories to recall.', displayReplacement: '[🧠 No memories]' };
        const queryId = parts.slice(1).join(' ').trim();
        if (queryId) {
            let foundMemory: Memory | undefined;
            for (const [, mems] of Object.entries(memories)) {
                const m = mems.find(mem => mem.id === queryId || mem.id.startsWith(queryId));
                if (m) { foundMemory = m; break; }
            }
            if (!foundMemory) return { toolType: 'memory', args, content: `No memory matching ID "${queryId}".`, displayReplacement: '[🧠 No match]' };
            return { toolType: 'memory', args, content: `[${foundMemory.id}] ${foundMemory.name} ${foundMemory.content}`, displayReplacement: '[🧠 Recalled 1 memory]' };
        }
        const participantIds = new Set(getSessionCharacters(interactionData).map(p => p.id));
        const relevantMemories: string[] = [];
        for (const [key, mems] of Object.entries(memories)) {
            if (key === 'global' || participantIds.has(key)) {
                for (const memory of mems) {
                    if (memory.interactionData?.id === interactionData.id) continue;
                    if (memory.content && memory.content.trim()) relevantMemories.push(`[${memory.id}] ${memory.content.trim()}`);
                }
            }
        }
        if (relevantMemories.length === 0) return { toolType: 'memory', args, content: 'No relevant memories.', displayReplacement: '[🧠 No relevant memories]' };
        return { toolType: 'memory', args, content: relevantMemories.join(' --- '), displayReplacement: `[🧠 Recalled ${relevantMemories.length} memory(ies)]` };
    }
    if (subcommand === 'save') {
        const otherParticipants = getSessionCharacters(interactionData).filter(p => p.id !== character.id);
        if (otherParticipants.length === 0) return { toolType: 'memory', args, content: '[Error: No other participants.]', displayReplacement: '[🧠 No participants]' };
        const ts = Date.now();
        let summaryText: string | null = null;
        try {
            const text = await generateCharacterMemory(interactionData, character, '', 512);
            if (text) summaryText = text;
        } catch {}
        if (!summaryText) return { toolType: 'memory', args, content: '[Error: Summarization failed.]', displayReplacement: '[🧠 Summarization failed]' };
        if (!character.memories) character.memories = {};
        for (const other of otherParticipants) {
            const newMemory: Memory = { id: uuidv4(), name: `Memory with ${other.name}`, content: summaryText, interactionData: interactionData, firstCreatedTimestamp: ts, lastUpdatedTimestamp: ts };
            character.memories[other.id] = [newMemory];
        }
        const globalMemory: Memory = { id: uuidv4(), name: 'Global Memory', content: summaryText, interactionData: interactionData, firstCreatedTimestamp: ts, lastUpdatedTimestamp: ts };
        character.memories.global = [globalMemory];
        try { await saveRawCharacter(character); } catch (e) {
            console.warn('Failed to save character memories:', e);
            return { toolType: 'memory', args, content: '[Error: Save failed]', displayReplacement: '[🧠 Save failed]' };
        }
        context?.addToast?.(`🧠 Memory saved for ${character.name}`, 'success');
        return { toolType: 'memory', args, content: `Memory saved: "${summaryText.substring(0, 100)}..."`, displayReplacement: '[🧠 Memory saved]' };
    }
    return { toolType: 'memory', args, content: '[Error: Unknown memory command]', displayReplacement: '[Error: Unknown command]' };
}

// ─── Lookup ─────────────────────────────────────────────────────────
function executeLookup(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const query = args.trim().toLowerCase();
    if (!query) return helpResult('lookup', args, 'lookup <keyword> — search contexts and lore by keyword');
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
    if (matches.length === 0) return { toolType: 'lookup', args, content: `No results for "${args.trim()}".`, displayReplacement: `[🔍 No results]` };
    return { toolType: 'lookup', args, content: matches.map(m => `[${m.id}] ${m.name}: ${m.snippet}`).join('\n'), displayReplacement: `[🔍 Found ${matches.length} result(s)]` };
}

// ─── Map ────────────────────────────────────────────────────────────
function executeMap(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('map', args, 'map <location_id> or map <loc1_id> to <loc2_id>');
    const locations = interactionData.locations || [];
    if (locations.length === 0) return { toolType: 'map', args, content: '[Error: No locations available.]', displayReplacement: '[Error: No locations]' };
    const toMatch = trimmed.match(/^(\S+)\s+to\s+(\S+)$/i);
    let fromLoc: Location | undefined, toLoc: Location | undefined;
    if (toMatch) {
        fromLoc = resolveLocation(toMatch[1].trim(), interactionData);
        toLoc = resolveLocation(toMatch[2].trim(), interactionData);
    } else {
        fromLoc = getCurrentLocation(interactionData, _nextMessage.character);
        toLoc = resolveLocation(trimmed, interactionData);
    }
    if (!toLoc) return { toolType: 'map', args, content: `[Error: Location not found.]`, displayReplacement: '[Error: Not found]' };
    if (!fromLoc) return { toolType: 'map', args, content: '[Error: No current location.]', displayReplacement: '[Error: No location]' };
    if (fromLoc.id === toLoc.id) return { toolType: 'map', args, content: `Already at "${toLoc.name}".`, displayReplacement: `[🗺️ Already at "${toLoc.name}"]` };
    let distanceKm = fromLoc.locationDistances?.[toLoc.id];
    if (distanceKm === undefined && fromLoc.latitude !== undefined && fromLoc.longitude !== undefined && toLoc.latitude !== undefined && toLoc.longitude !== undefined) {
        const R = 6371;
        const dLat = (toLoc.latitude - fromLoc.latitude) * Math.PI / 180;
        const dLon = (toLoc.longitude - fromLoc.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(fromLoc.latitude * Math.PI / 180) * Math.cos(toLoc.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    } else if (distanceKm === undefined) {
        return { toolType: 'map', args, content: `[Error: Distance unknown.]`, displayReplacement: '[Error: Distance unknown]' };
    }
    const rounded = Math.round(distanceKm * 10) / 10;
    const walkHours = Math.round((distanceKm / 5) * 10) / 10;
    return { toolType: 'map', args, content: `Distance: ${rounded} km. ~${walkHours} hours walking.`, displayReplacement: `[🗺️ ${fromLoc.name} → ${toLoc.name}: ${rounded} km]` };
}

// ─── Audio ──────────────────────────────────────────────────────────
function executeAudio(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('audio', args, 'audio play <track_id> | audio stop <track_id>');
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const trackId = parts.slice(1).join(' ').trim();
    if (!trackId) return { toolType: 'audio', args, content: `[Error: Missing track_id]`, displayReplacement: '[Error: Missing track_id]' };
    if (subcommand !== 'play' && subcommand !== 'stop') return { toolType: 'audio', args, content: `[Error: Unknown command]`, displayReplacement: '[Error: Unknown command]' };
    const audioTracks = interactionData.audioTracks || context?.allAudioTracks || [];
    const track = audioTracks.find(t => t.id === trackId || t.name.toLowerCase() === trackId.toLowerCase());
    if (!track) return { toolType: 'audio', args, content: `[Error: Track not found]`, displayReplacement: '[Error: Track not found]' };
    if (!track.playableByParticipants) return { toolType: 'audio', args, content: `[Error: Not playable]`, displayReplacement: '[Error: Not playable]' };
    const audioEngine = getAudioEngine();
    if (subcommand === 'play') { audioEngine.startTrack(track); return { toolType: 'audio', args, content: `Playing "${track.name}"`, displayReplacement: `[🔊 Playing "${track.name}"]` }; }
    else { audioEngine.stopTrack(track.id); return { toolType: 'audio', args, content: `Stopped "${track.name}"`, displayReplacement: `[🔇 Stopped "${track.name}"]` }; }
}

// ─── Note ──────────────────────────────────────────────────────────
function executeNote(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('note', args, 'note set <key> <text> | note get <key> | note delete <key> | note list');
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const latest = findLatestMessage(interactionData, nextMessage.character);
    const currentMessage = latest?.message;
    let notes: Record<string, string> = {};
    if (currentMessage?.inventory && typeof currentMessage.inventory['__notes__'] === 'string') { try { notes = JSON.parse(currentMessage.inventory['__notes__'] as string); } catch { notes = {}; } }
    switch (subcommand) {
        case 'list': { const entries = Object.entries(notes); if (entries.length === 0) return { toolType: 'note', args, content: 'No notes.', displayReplacement: '[📝 No notes]' }; return { toolType: 'note', args, content: entries.map(([k, v]) => `${k}: ${v}`).join('\n'), displayReplacement: `[📝 ${entries.length} note(s)]` }; }
        case 'set': { if (parts.length < 3) return { toolType: 'note', args, content: '[Error: Usage]', displayReplacement: '[Error: Usage]' }; const key = parts[1], text = parts.slice(2).join(' '); notes[key] = text; const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {}; inventory['__notes__'] = JSON.stringify(notes); nextMessage.inventory = inventory; return { toolType: 'note', args, content: `Saved "${key}".`, displayReplacement: `[📝 Saved: "${key}"]` }; }
        case 'get': { if (parts.length < 2) return { toolType: 'note', args, content: '[Error: Usage]', displayReplacement: '[Error: Usage]' }; const value = notes[parts[1]]; if (value === undefined) return { toolType: 'note', args, content: `Not found.`, displayReplacement: '[📝 Not found]' }; return { toolType: 'note', args, content: value, displayReplacement: `[📝 ${parts[1]}]` }; }
        case 'delete': { if (parts.length < 2) return { toolType: 'note', args, content: '[Error: Usage]', displayReplacement: '[Error: Usage]' }; if (notes[parts[1]] === undefined) return { toolType: 'note', args, content: `Not found.`, displayReplacement: '[📝 Not found]' }; delete notes[parts[1]]; const inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {}; if (Object.keys(notes).length === 0) delete inventory['__notes__']; else inventory['__notes__'] = JSON.stringify(notes); nextMessage.inventory = inventory; return { toolType: 'note', args, content: `Deleted.`, displayReplacement: '[📝 Deleted]' }; }
        default: return { toolType: 'note', args, content: '[Error: Unknown command]', displayReplacement: '[Error: Unknown command]' };
    }
}

// ─── Inventory ──────────────────────────────────────────────────────
function executeInventory(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('inventory', args, 'inventory list | inventory add <item> <qty> | inventory remove <item> <qty>');
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const latest = findLatestMessage(interactionData, nextMessage.character);
    const currentMessage = latest?.message;
    const inventory: Inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
    switch (subcommand) {
        case 'list': return { toolType: 'inventory', args, content: '[Inventory listed in prompt context]', displayReplacement: '[📦 Inventory listed]' };
        case 'add': { if (parts.length < 3) return { toolType: 'inventory', args, content: '[Error: Usage]', displayReplacement: '[Error: Usage]' }; const item = parts.slice(1, -1).join(' '), qty = Number(parts[parts.length - 1]); if (!item || isNaN(qty) || qty <= 0) return { toolType: 'inventory', args, content: '[Error: Invalid]', displayReplacement: '[Error: Invalid]' }; const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0; inventory[item] = current + qty; nextMessage.inventory = inventory; return { toolType: 'inventory', args, content: `Added ${qty}x "${item}"`, displayReplacement: `[📦 Added ${qty}x "${item}"]` }; }
        case 'remove': { if (parts.length < 3) return { toolType: 'inventory', args, content: '[Error: Usage]', displayReplacement: '[Error: Usage]' }; const item = parts.slice(1, -1).join(' '), qty = Number(parts[parts.length - 1]); if (!item || isNaN(qty) || qty <= 0) return { toolType: 'inventory', args, content: '[Error: Invalid]', displayReplacement: '[Error: Invalid]' }; const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0; const nv = current - qty; if (nv <= 0) delete inventory[item]; else inventory[item] = nv; nextMessage.inventory = inventory; return { toolType: 'inventory', args, content: `Removed ${qty}x "${item}"`, displayReplacement: `[📦 Removed ${qty}x "${item}"]` }; }
        default: return { toolType: 'inventory', args, content: '[Error: Unknown command]', displayReplacement: '[Error: Unknown command]' };
    }
}

// ─── Trade ──────────────────────────────────────────────────────────
interface PendingTradeOffer {
    id: string; fromCharId: string; fromCharName: string; toCharId: string; toCharName: string;
    giveItems: { item: string; qty: number }[]; takeItems: { item: string; qty: number }[]; createdAt: number;
}

function loadPendingOffers(inventory: Inventory | undefined): PendingTradeOffer[] {
    if (!inventory || typeof inventory['__pending_trade_offers__'] !== 'string') return [];
    try { return JSON.parse(inventory['__pending_trade_offers__'] as string); } catch { return []; }
}

function savePendingOffers(inventory: Inventory, offers: PendingTradeOffer[]): void {
    if (offers.length === 0) delete inventory['__pending_trade_offers__']; else inventory['__pending_trade_offers__'] = JSON.stringify(offers);
}

function executeTrade(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('trade', args, 'trade give <char_id> <item>:<qty> | trade take <char_id> <item>:<qty> | trade offer ... | trade accept <id> | trade decline <id> | trade list_offers');
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const latest = findLatestMessage(interactionData, nextMessage.character);
    const currentMessage = latest?.message;
    const myInventory: Inventory = currentMessage?.inventory ? { ...currentMessage.inventory } : {};
    const parseItems = (raw: string): { item: string; qty: number }[] => {
        const entries: { item: string; qty: number }[] = [];
        for (const seg of raw.split(',')) {
            const colonIdx = seg.lastIndexOf(':');
            if (colonIdx === -1) continue;
            const item = seg.substring(0, colonIdx).trim();
            const qty = Number(seg.substring(colonIdx + 1).trim());
            if (item && !isNaN(qty) && qty > 0) entries.push({ item, qty });
        }
        return entries;
    };
    const getTargetInventory = (charId: string): { inventory: Inventory; msg: HistoryMessage; locId: string } | null => {
        const char = (context?.allCharacters || []).find(c => c.id === charId);
        if (!char) return null;
        const targetLatest = findLatestMessage(interactionData, char);
        if (!targetLatest) return null;
        const inv = targetLatest.message.inventory ? { ...targetLatest.message.inventory } : {};
        return { inventory: inv, msg: targetLatest.message, locId: targetLatest.locationId };
    };
    switch (subcommand) {
        case 'give': {
            if (parts.length < 3) return { toolType: 'trade', args, content: '[Error: Usage]', displayReplacement: '[Error: Usage]' };
            const targetCharId = parts[1]; const items = parseItems(parts.slice(2).join(' '));
            if (items.length === 0) return { toolType: 'trade', args, content: '[Error: No valid items]', displayReplacement: '[Error: No valid items]' };
            const targetChar = resolveCharacter(targetCharId, interactionData, context?.allCharacters || []);
            if (!targetChar) return { toolType: 'trade', args, content: '[Error: Target not found]', displayReplacement: '[Error: Not found]' };
            const targetData = getTargetInventory(targetChar.id);
            if (!targetData) return { toolType: 'trade', args, content: '[Error: Target history missing]', displayReplacement: '[Error: Missing history]' };
            for (const { item, qty } of items) {
                const myCurrent = typeof myInventory[item] === 'number' ? (myInventory[item] as number) : 0;
                if (myCurrent < qty) return { toolType: 'trade', args, content: `[Error: Not enough "${item}"]`, displayReplacement: '[Error: Not enough]' };
            }
            for (const { item, qty } of items) {
                myInventory[item] = (myInventory[item] as number) - qty;
                if (myInventory[item] <= 0) delete myInventory[item];
                targetData.inventory[item] = (typeof targetData.inventory[item] === 'number' ? targetData.inventory[item] : 0) + qty;
            }
            nextMessage.inventory = myInventory;
            return { toolType: 'trade', args, content: `Gave items to ${targetChar.name}.`, displayReplacement: `[🤝 Gave items to ${targetChar.name}]` };
        }
        case 'list_offers': {
            const myOffers = loadPendingOffers(myInventory);
            if (myOffers.length === 0) return { toolType: 'trade', args, content: 'No pending trade offers.', displayReplacement: '[🤝 No pending offers]' };
            return { toolType: 'trade', args, content: myOffers.map(o => `[${o.id}] From ${o.fromCharName}`).join('\n'), displayReplacement: `[🤝 ${myOffers.length} pending offer(s)]` };
        }
        default: return { toolType: 'trade', args, content: '[Error: Unknown command]', displayReplacement: '[Error: Unknown command]' };
    }
}

// ─── Invite ─────────────────────────────────────────────────────────
function executeInvite(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('invite', args, 'invite <character_id>');
    const targetChar = resolveCharacter(trimmed, interactionData, context?.allCharacters || []);
    if (!targetChar) return { toolType: 'invite', args, content: '[Error: Character not found]', displayReplacement: '[Error: Not found]' };
    appendPendingAction(nextMessage, { type: 'invite', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'invite', args, content: `Invited ${targetChar.name}.`, displayReplacement: `[📨 Invited ${targetChar.name}]` };
}

// ─── Kick ───────────────────────────────────────────────────────────
function executeKick(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('kick', args, 'kick <character_id>');
    const targetChar = resolveCharacter(trimmed, interactionData, context?.allCharacters || []);
    if (!targetChar) return { toolType: 'kick', args, content: '[Error: Character not found]', displayReplacement: '[Error: Not found]' };
    const kickerLoc = getCurrentLocation(interactionData, nextMessage.character);
    const kickable = getReachableLocationsByCharacter(interactionData, nextMessage.character).filter(loc => !kickerLoc || loc.id !== kickerLoc.id);
    if (kickable.length === 0) return { toolType: 'kick', args, content: '[Error: No reachable locations]', displayReplacement: '[Error: No destinations]' };
    const pick = kickable[Math.floor(Math.random() * kickable.length)];
    appendPendingAction(nextMessage, { type: 'kick', payload: { characterId: targetChar.id, characterName: targetChar.name, destinationLocationName: pick.name, destinationLocationId: pick.id } });
    return { toolType: 'kick', args, content: `Kicked ${targetChar.name} to "${pick.name}".`, displayReplacement: `[👢 Kicked ${targetChar.name}]` };
}

// ─── Teleport ───────────────────────────────────────────────────────
function executeTeleport(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('teleport', args, 'teleport <location_id>');
    const targetLocation = resolveLocation(trimmed, interactionData);
    if (!targetLocation) return { toolType: 'teleport', args, content: '[Error: Location not found]', displayReplacement: '[Error: Not found]' };
    return { toolType: 'teleport', args, content: `Teleported to "${targetLocation.name}".`, displayReplacement: `[⚡ Teleported to "${targetLocation.name}"]` };
}

// ─── Key ────────────────────────────────────────────────            
function executeKey(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('key', args, 'key lock|unlock <location_id>');
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const locationQuery = parts[1]?.trim();
    if (!locationQuery || (subcommand !== 'lock' && subcommand !== 'unlock')) return { toolType: 'key', args, content: '[Error: Usage]', displayReplacement: '[Error: Usage]' };
    const targetLocation = resolveLocation(locationQuery, interactionData);
    if (!targetLocation) return { toolType: 'key', args, content: '[Error: Location not found]', displayReplacement: '[Error: Not found]' };
    const lockedLocations = nextMessage.characterLockedLocations ? { ...nextMessage.characterLockedLocations } : {};
    if (subcommand === 'lock') {
        lockedLocations[targetLocation.id] = getSessionCharacters(interactionData).map(p => p.id);
        nextMessage.characterLockedLocations = lockedLocations;
        return { toolType: 'key', args, content: `Locked "${targetLocation.name}".`, displayReplacement: `[🔒 Locked "${targetLocation.name}"]` };
    } else {
        delete lockedLocations[targetLocation.id];
        nextMessage.characterLockedLocations = lockedLocations;
        return { toolType: 'key', args, content: `Unlocked "${targetLocation.name}".`, displayReplacement: `[🔓 Unlocked "${targetLocation.name}"]` };
    }
}

// ─── Clothing ───────────────────────────────────────────────────────
function executeClothing(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    const wearMatch = trimmed.match(/^(\S+)\s+wear\s+(\S+)$/i);
    const removeMatch = trimmed.match(/^(\S+)\s+remove\s+(\S+)$/i);
    if (!wearMatch && !removeMatch) return helpResult('clothing', args, 'clothing <char_id> wear|remove <clothing_id>');
    const charQuery = (wearMatch || removeMatch)![1].trim();
    const clothingId = (wearMatch || removeMatch)![2].trim();
    const action = wearMatch ? 'wear' : 'remove';
    const targetChar = resolveCharacter(charQuery, interactionData, context?.allCharacters || []);
    if (!targetChar) return { toolType: 'clothing', args, content: '[Error: Character not found]', displayReplacement: '[Error: Not found]' };
    const clothingItem = targetChar.clothings?.find(c => c.id === clothingId || c.name.toLowerCase() === clothingId.toLowerCase());
    if (!clothingItem) return { toolType: 'clothing', args, content: '[Error: Clothing not found]', displayReplacement: '[Error: Clothing not found]' };
    const wearingStatuses = nextMessage.characterClothingWearingStatuses ? { ...nextMessage.characterClothingWearingStatuses } : {};
    wearingStatuses[clothingItem.id] = (action === 'wear');
    nextMessage.characterClothingWearingStatuses = wearingStatuses;
    return { toolType: 'clothing', args, content: `${targetChar.name} ${action}s "${clothingItem.name}".`, displayReplacement: `[👕 ${targetChar.name} ${action}s "${clothingItem.name}"]` };
}

// ─── Summon ─────────────────────────────────────────────────────────
function executeSummon(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('summon', args, 'summon <character_id>');
    const targetChar = getGlobalCharacters(interactionData, context?.allCharacters || []).find(c => c.id === trimmed || c.name.toLowerCase() === trimmed.toLowerCase());
    if (!targetChar) return { toolType: 'summon', args, content: '[Error: Character not found]', displayReplacement: '[Error: Not found]' };
    appendPendingAction(nextMessage, { type: 'summon', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'summon', args, content: `Summoned ${targetChar.name}.`, displayReplacement: `[✨ Summoned ${targetChar.name}]` };
}

// ─── Narrate ────────────────────────────────────────────────────────
function executeNarrate(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, _context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('narrate', args, 'narrate <text>');
    return { toolType: 'narrate', args, content: trimmed, displayReplacement: `[🎙️ ${trimmed}]` };
}

// ─── Inspect ────────────────────────────────────────────────────────
function executeInspect(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('inspect', args, 'inspect <character_id>');
    const targetChar = resolveCharacter(trimmed, interactionData, context?.allCharacters || []);
    if (!targetChar) return { toolType: 'inspect', args, content: '[Error: Character not found]', displayReplacement: '[Error: Not found]' };
    const latest = findLatestMessage(interactionData, targetChar);
    const loc = interactionData.locations?.find(l => l.id === latest?.locationId);
    return { toolType: 'inspect', args, content: `${targetChar.name}: Location: ${loc?.name || 'unknown'}`, displayReplacement: `[🔍 ${targetChar.name}: 📍${loc?.name || 'unknown'}]` };
}

// ─── Administrator ──────────────────────────────────────────────────
function executeAdministrator(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('administrator', args, 'administrator list_chats | switch_model <name> | ...');
    const parts = trimmed.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    switch (subcommand) {
        case 'list_chats': return { toolType: 'administrator', args, content: `Session: "${interactionData.name}"`, displayReplacement: "[🔧 Session info]" };
        case 'switch_model': {
            const modelName = parts.slice(1).join(' ');
            appendPendingAction(nextMessage, { type: 'administrator_switch_model', payload: { modelName } });
            return { toolType: 'administrator', args, content: `Switch model: ${modelName}`, displayReplacement: `[🔧 Switch: ${modelName}]` };
        }
        default: return { toolType: 'administrator', args, content: '[Error: Unknown command]', displayReplacement: '[Error: Unknown command]' };
    }
}

// ─── Creator ────────────────────────────────────────────────────────
const VALID_ENTITY_TYPES = ['character', 'context', 'location', 'audio_track', 'prompt_block', 'stop_pattern', 'sampler', 'budget_strategy', 'profile', 'world', 'memory', 'extension', 'account', 'multiplayer_data'];

function executeCreator(args: string, nextMessage: BaseMessage, _interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('creator', args, 'creator <type> <name>');
    const parts = trimmed.split(/\s+/);
    const entityType = parts[0]?.toLowerCase(), entityName = parts.slice(1).join(' ');
    if (!VALID_ENTITY_TYPES.includes(entityType)) return { toolType: 'creator', args, content: '[Error: Unknown type]', displayReplacement: '[Error: Unknown type]' };
    appendPendingAction(nextMessage, { type: 'creator', payload: { entityType, entityName } });
    return { toolType: 'creator', args, content: `Created ${entityType} "${entityName}".`, displayReplacement: `[🛠️ ${entityType}: "${entityName}"]` };
}

// ─── Destroyer ──────────────────────────────────────────────────────
function executeDestroyer(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context?: ToolExecutionContext, _displayMode?: toolUsageDisplayMode): ToolResult {
    const trimmed = args.trim();
    if (!trimmed) return helpResult('destroyer', args, 'destroyer <type> <id>');
    const parts = trimmed.split(/\s+/);
    const entityType = parts[0]?.toLowerCase(), entityId = parts.slice(1).join(' ').trim();
    if (!VALID_ENTITY_TYPES.includes(entityType)) return { toolType: 'destroyer', args, content: '[Error: Unknown type]', displayReplacement: '[Error: Unknown type]' };
    appendPendingAction(nextMessage, { type: 'destroyer', payload: { entityType, entityId, entityName: entityId } });
    return { toolType: 'destroyer', args, content: `Destroyed ${entityType} "${entityId}".`, displayReplacement: `[💀 ${entityType}: "${entityId}"]` };
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
                if (!realCharacter) break;
                updatedData = { ...updatedData, participants: [...sessionParticipants, { ...realCharacter }], lastUpdatedTimestamp: Date.now() };
                changed = true;
                break;
            }
            case 'invite': {
                const charId = action.payload.characterId;
                let invitedChar = (updatedData.participants || []).find(p => p.id === charId) || allCharacters.find(c => c.id === charId);
                if (invitedChar) {
                    const kickerLoc = getCurrentLocation(updatedData, charLastMsg.character);
                    const currentLocId = kickerLoc?.id;
                    const prevInvitedMsg = findPrevMsg(updatedData, invitedChar.id);
                    const inviteMsg: HistoryMessage = {
                        messageType: 'interaction', id: uuidv4(), character: { ...invitedChar }, isPresent: true,
                        characterClothingWearingStatuses: (prevInvitedMsg as ChatMessage)?.characterClothingWearingStatuses ?? {},
                        characterLockedLocations: prevInvitedMsg?.characterLockedLocations ?? {},
                        parentMessageId: history.length > 0 ? history[history.length - 1].id : null,
                        firstCreatedTimestamp: Date.now(), lastUpdatedTimestamp: Date.now(),
                    };
                    if (currentLocId) {
                        if (!updatedData.interactionHistories[currentLocId]) updatedData.interactionHistories[currentLocId] = [];
                        updatedData.interactionHistories[currentLocId].push(inviteMsg);
                    }
                    const isAlreadyPart = (updatedData.participants || []).some(p => p.id === invitedChar!.id);
                    const newParticipants = isAlreadyPart ? (updatedData.participants || []) : [...(updatedData.participants || []), { ...invitedChar! }];
                    updatedData = { ...updatedData, participants: newParticipants, lastUpdatedTimestamp: Date.now() };
                    changed = true;
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
                updatedData.interactionHistories[locId].push(whisperMsg);
                updatedData = { ...updatedData, lastUpdatedTimestamp: Date.now() };
                changed = true;
                break;
            }
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