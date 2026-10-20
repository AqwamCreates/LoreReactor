// src/frontend_src/services/ToolExecutor.ts
import type { ToolInvocation } from './ToolInvocationParser';
import { fetchLinkContent } from '../utilities/linkFetcher';
import { collectActiveDialoguePromptContent, buildDialogueSearchSpace, getActiveDialoguePrompts } from '../utilities/dialoguePromptLogic';
import { isEntityActiveWithCache, type TriggerEvaluationContext, type CombinationCache } from '../utilities/triggerLogic';
import { getUniversalMessageFilterFlags } from '../utilities/promptLogic';
import type { 
    BaseMessage, Character, Context, Location, AudioTrack, Profile, 
    InteractionData, Inventory, ChatMessage, WhisperMessage, TextMessage, 
    PromptBlock, StopPattern, Sampler, BudgetStrategy, World, Memory, 
    Extension, Account, MultiplayerData, toolUsageDisplayMode, HistoryMessage, 
    tool, EntityFolder, RawInteractionData, RetrievalConfiguration, LanguageModel,
    entityType, ActiveToolActions, PendingToolAction, PendingToolActionType,
    TimerEntry, StopwatchEntry, ScheduleEntry, ScheduledResponseEntry, TradeOffer
} from '../types';
import { findLatestMessage } from '../utilities/messageLogic';
import { getGlobalMessageHistory, getLocalMessageHistory } from '../utilities/timelineLogic';
import { getCurrentLocation, getReachableLocationsByCharacter, isCharacterLockedFromLocation, getCoLocatedParticipants } from '../utilities/locationLogic';
import { getAudioEngine } from './AudioEngine';
import { generateCharacterMemory } from './TextMessageSummarizationEngine';
import { saveRawCharacter } from '../storages/serverStorage';
import { v4 as uuidv4 } from 'uuid';
import { speakText, stopSpeech, getSystemInfo, sendDesktopNotification, controlVolume, lockScreen, setSystemPower, clipboardAction, captureScreenshot, scanLocalNetwork, startFileWatcher, getFileWatcherEvents, getActiveWindowInfo, getRunningProcesses, moveToTrash, writeFile, readFile, runShellCommand, captureVirtualHearing, captureVirtualVision, sendVirtualInput, sendVirtualController, getHardwarePorts, sendHardwareCommand} from '../utilities/serverTools';
import { buildSearchUrl } from '../utilities/searchURLBuilder';
import { generateSkyViewText, getTimeDataFromCoordinates, type TimeData } from './LocationEngine';
import { getLocationMessageHistory } from '../utilities/timelineLogic';
import { localURL } from '../../configurations';
import { embeddingEngine } from './EmbeddingEngine';
import { retrieveRelevantContext, type RetrievableItem } from './RetrievalEngine';
import { retrieveEligibleMemories, detokenizeMemoryContent } from '../utilities/memoryLogic';

// Re-export so consumers importing from ToolExecutor remain compatible
export type { 
    PendingToolAction, PendingToolActionType, ActiveToolActions, 
    TradeOffer, TimerEntry, StopwatchEntry, ScheduleEntry, ScheduledResponseEntry 
};

export interface ToolResult {
    toolType: string;
    args: string;
    textContent: string;
    displayReplacement: string;
}

export interface ToolExecutionContext {
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allLanguageModels: LanguageModel[];
    allSamplers: Sampler[];
    allPromptBlocks: PromptBlock[];
    allStopPatterns: StopPattern[];
    allRetrievalConfigurations: RetrievalConfiguration[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allMemories: Memory[];
    allExtensions: Extension[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    allRawInteractionDataShells: RawInteractionData[];
    allEntityFolders: EntityFolder[];
    captureFrontCameraImage: () => Promise<string | null>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

// ─── Canonical entityType Mapping ───────────────────────────────────

export const VALID_ENTITY_TYPES: entityType[] = [
    'character', 'context', 'location', 'audioTrack', 'world',
    'interactionData', 'model', 'sampler', 'promptBlock', 'stopPattern',
    'retrievalConfiguration', 'budgetStrategy', 'profile', 'account',
    'multiplayerData', 'entityFolder'
];

/**
 * Maps the AI's underscore / snake_case forms to canonical entityType from types.ts
 */
export function normalizeEntityType(raw: string): entityType | null {
    if (!raw) return null;
    const cleaned = raw.toLowerCase().replace(/[-_\s]/g, '');
    const map: Record<string, entityType> = {
        character: 'character',
        characters: 'character',
        context: 'context',
        contexts: 'context',
        location: 'location',
        locations: 'location',
        audiotrack: 'audioTrack',
        audiotracks: 'audioTrack',
        audio: 'audioTrack',
        world: 'world',
        worlds: 'world',
        interactiondata: 'interactionData',
        interactiondatas: 'interactionData',
        session: 'interactionData',
        sessions: 'interactionData',
        chat: 'interactionData',
        chats: 'interactionData',
        model: 'model',
        models: 'model',
        languagemodel: 'model',
        languagemodels: 'model',
        sampler: 'sampler',
        samplers: 'sampler',
        promptblock: 'promptBlock',
        promptblocks: 'promptBlock',
        stoppattern: 'stopPattern',
        stoppatterns: 'stopPattern',
        retrievalconfiguration: 'retrievalConfiguration',
        retrievalconfigurations: 'retrievalConfiguration',
        budgetstrategy: 'budgetStrategy',
        budgetstrategies: 'budgetStrategy',
        profile: 'profile',
        profiles: 'profile',
        account: 'account',
        accounts: 'account',
        multiplayerdata: 'multiplayerData',
        multiplayerdatas: 'multiplayerData',
        entityfolder: 'entityFolder',
        entityfolders: 'entityFolder',
        folder: 'entityFolder',
        folders: 'entityFolder',
    };
    return map[cleaned] ?? null;
}

function getEntitiesByType(context: ToolExecutionContext | undefined, type: entityType): any[] {
    if (!context) return [];
    switch (type) {
        case 'character': return context.allCharacters || [];
        case 'context': return context.allContexts || [];
        case 'location': return context.allLocations || [];
        case 'audioTrack': return context.allAudioTracks || [];
        case 'world': return context.allWorlds || [];
        case 'interactionData': return context.allRawInteractionDataShells || [];
        case 'model': return context.allLanguageModels || [];
        case 'sampler': return context.allSamplers || [];
        case 'promptBlock': return context.allPromptBlocks || [];
        case 'stopPattern': return context.allStopPatterns || [];
        case 'retrievalConfiguration': return context.allRetrievalConfigurations || [];
        case 'budgetStrategy': return context.allBudgetStrategies || [];
        case 'profile': return context.allProfiles || [];
        case 'account': return context.allAccounts || [];
        case 'multiplayerData': return context.allMultiplayerData || [];
        case 'entityFolder': return context.allEntityFolders || [];
        default: return [];
    }
}

// ─── Universal Python & CLI Argument Parser ─────────────────────────
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

    get(index: number, ...names: string[]): string | undefined {
        for (const name of names) {
            const val = this.kwargs[name.toLowerCase()];
            if (val !== undefined && val !== '') {
                return val;
            }
        }
        return index >= 0 ? this.positional[index] : undefined;
    }

    getNumber(index: number, ...names: string[]): number | undefined {
        const val = this.get(index, ...names);
        if (val === undefined || val === '') return undefined;
        const n = Number(val);
        return Number.isNaN(n) ? undefined : n;
    }
}

export function parsePythonArgs(rawArgs: string): ArgAccessor {
    const trimmed = rawArgs;
    if (!trimmed) return new ArgAccessor([], {}, rawArgs);

    let input = trimmed;
    const fnMatch = input.match(/^[a-zA-Z_]\w*\s*\(([\s\S]*)\)$/);
    if (fnMatch) {
        input = fnMatch[1];
    }

    let hasTopLevelCommas = false;
    {
        let q: '"' | "'" | null = null;
        let esc = false;
        let d = 0;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (q) { if (ch === q) q = null; continue; }
            if (ch === '"' || ch === "'") { q = ch; continue; }
            if (ch === '(' || ch === '[' || ch === '{') { d++; continue; }
            if (ch === ')' || ch === ']' || ch === '}') { d--; continue; }
            if (ch === ',' && d === 0) { hasTopLevelCommas = true; break; }
        }
    }

    const rawTokens: string[] = [];
    let current = '';
    let inQuotes: '"' | "'" | null = null;
    let escapeNext = false;
    let depth = 0;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];
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

        const isSeparator = hasTopLevelCommas
            ? (char === ',' && depth === 0)
            : (/\s/.test(char) && depth === 0);

        if (isSeparator) {
            if (current.length > 0) {
                rawTokens.push(current);
            }
            current = '';
            continue;
        }
        current += char;
    }

    if (current.length > 0) {
        rawTokens.push(current);
    }

    const positional: string[] = [];
    const kwargs: Record<string, string> = {};
    const cleanValue = (val: string): string => {
        let v = val;
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
        }
        return v;
    };

    for (const token of rawTokens) {
        const kwMatch = token.match(/^([a-zA-Z_]\w*)\s*[:=]\s*([\s\S]*)$/);
        if (kwMatch) {
            kwargs[kwMatch[1].toLowerCase()] = cleanValue(kwMatch[2]);
        } else {
            positional.push(cleanValue(token));
        }
    }

    return new ArgAccessor(positional, kwargs, rawArgs);
}

// ─── Clean First-Class Helpers ──────────────────────────────────────

function appendPendingAction(nextMessage: BaseMessage, action: PendingToolAction): void {
    if (!nextMessage.pendingToolActions) {
        nextMessage.pendingToolActions = [];
    }
    nextMessage.pendingToolActions.push(action);
}

function resolveActiveToolActions(nextMessage: BaseMessage, interactionData: InteractionData): ActiveToolActions {
    if (nextMessage.activeToolActions) {
        return { ...nextMessage.activeToolActions };
    }
    const latest = findLatestMessage(interactionData, nextMessage.character);
    return latest?.message?.activeToolActions ? { ...latest.message.activeToolActions } : {};
}

// ─── Entity Resolution Helpers ──────────────────────────────────────
function resolveCharacter(idOrName: string, interactionData: InteractionData, allCharacters: Character[] = []): Character | undefined {
    let query = idOrName.toLowerCase();
    if (!query) return undefined;
    if ((query.startsWith('"') && query.endsWith('"')) || (query.startsWith("'") && query.endsWith("'"))) {
        query = query.slice(1, -1).toLowerCase();
    }
    const participants = interactionData.participants;
    let found = participants.find(c => c.id.toLowerCase() === query || c.name.toLowerCase() === query || c.id.startsWith(query));
    if (found) return found;
    found = allCharacters.find(c => c.id.toLowerCase() === query || c.name.toLowerCase() === query || c.id.startsWith(query));
    return found;
}

function resolveLocation(idOrName: string, interactionData: InteractionData): Location | undefined {
    let query = idOrName.toLowerCase();
    if (!query) return undefined;
    if ((query.startsWith('"') && query.endsWith('"')) || (query.startsWith("'") && query.endsWith("'"))) {
        query = query.slice(1, -1).toLowerCase();
    }
    const sessionLocs = interactionData.locations || [];
    return sessionLocs.find(l => l.id.toLowerCase() === query || l.name.toLowerCase() === query || l.id.startsWith(query));
}

function getCharacterTimeData(interactionData: InteractionData, character: Character): TimeData {
    const location = getCurrentLocation(interactionData, character);
    return getTimeDataFromCoordinates(location?.latitude, location?.longitude);
}

export const TOOL_EMOJI_MAP: Record<tool, string> = {
    whisper: '🤫', think: '💭', pick: '🎯', sky_view: '🔭', clock: '🕰️', calendar: '📅',
    coin: '🪙', dice: '🎲', random: '🎲', rng: '🎲', move: '🚶',
    timer: '⏱️', stopwatch: '⏱️', schedule: '📅', calculator: '🧮',
    web: '🌐', dialogue: '💬', knowledge: '🧠', memory: '🧠',
    lookup: '🔍', map: '🗺️', audio: '🔊', note: '📝',
    inventory: '📦', trade: '🤝', invite: '📨', kick: '👢',
    oracle: '🔮', teleport: '⚡', key: '🔒', clothing: '👕',
    summon: '✨', narrate: '🎙️', inspect: '🔍', administrator: '🔧',
    creator: '🛠️', destroyer: '💀', schedule_response: '⏰',
    text_to_speech: '🔊', gpu: '📟', system_info: '🖥️', notify: '🔔', volume_control: '🔊',
    lock_screen: '🔒', sleep: '⚡', shutdown: '⚡', restart: '⚡',
    clipboard: '📋', screenshot: '📸', front_camera: '📷', network_scanner: '🌐',
    file_watcher: '📂', process_monitor: '⚙️', window_monitor: '🖥️',
    trash: '🗑️', browser: '🌐', read_file: '🔗', write_file: '📁', shell: '💻',
    virtual_hearing: '🎧', virtual_vision: '👁️', virtual_input: '🖱️', virtual_controller: '🎮',
    hardware_control: '🔌',
};

const toolFunctions: Record<tool, (args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext, displayMode?: toolUsageDisplayMode) => ToolResult | Promise<ToolResult>> = {
    whisper: executeWhisper, think: executeThink, pick: executeRandomPick, sky_view: executeSkyView, clock: executeClock, calendar: executeCalendar, coin: executeCoinFlip, dice: executeDiceRoll, random: executeRandom, rng: executeRng, move: executeMove, timer: executeTimer, stopwatch: executeStopwatch, schedule: executeSchedule, calculator: executeCalculator, web: executeWeb, dialogue: executeDialogue, knowledge: executeKnowledge, memory: executeMemory, lookup: executeLookup, map: executeMap, audio: executeAudio, note: executeNote, inventory: executeInventory, trade: executeTrade, invite: executeInvite, kick: executeKick, oracle: executeOracle, teleport: executeTeleport, key: executeKey, clothing: executeClothing, summon: executeSummon, narrate: executeNarrate, inspect: executeInspect, administrator: executeAdministrator, creator: executeCreator, destroyer: executeDestroyer, schedule_response: executeScheduleResponse, text_to_speech: executeTextToSpeech, gpu: executeGpu, system_info: executeSystemInfo, notify: executeNotify, volume_control: executeVolumeControl, lock_screen: executeLockScreen, sleep: executePower('sleep'), shutdown: executePower('shutdown'), restart: executePower('restart'), clipboard: executeClipboard, screenshot: executeScreenshot, front_camera: executeFrontCamera, network_scanner: executeNetworkScanner, file_watcher: executeFileWatcher, window_monitor: executeWindowMonitor, process_monitor: executeProcessMonitor, trash: executeTrash, browser: executeBrowser, read_file: executeReadFile, write_file: executeWriteFile, shell: executeShell, virtual_hearing: executeVirtualHearing, virtual_vision: executeVirtualVision, virtual_input: executeVirtualInput, virtual_controller: executeVirtualController, hardware_control: executeHardwareControl,
};

export function getFallbackToolResult(innerString: string): ToolResult {
    const trimmedInnerString = innerString;
    let toolType = trimmedInnerString;
    let args = '';
    const fnMatch = trimmedInnerString.match(/^([a-zA-Z_]\w*)\s*\(([\s\S]*)\)$/);
    if (fnMatch) {
        toolType = fnMatch[1];
        args = fnMatch[2];
    } else {
        const spaceIdx = trimmedInnerString.search(/\s/);
        if (spaceIdx !== -1) {
            toolType = trimmedInnerString.slice(0, spaceIdx);
            args = trimmedInnerString.slice(spaceIdx + 1);
        }
    }
    const emoji = TOOL_EMOJI_MAP[toolType.toLowerCase() as tool] || '🔧';
    return {
        toolType, args, textContent: args, displayReplacement: `[${emoji} ${toolType}${args ? `: ${args}` : ''}]`
    };
}

export async function executeTool(
    invocation: ToolInvocation, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext, displayMode?: toolUsageDisplayMode,
): Promise<ToolResult> {
    const toolType = invocation.toolType as tool;
    const args = invocation.args;

    if (nextMessage.character.tools && nextMessage.character.tools[toolType] === false) {
        return { toolType, args, textContent: "Tool disabled", displayReplacement: "" };
    }

    const executeFunction = toolFunctions[toolType as tool];
    if (!executeFunction) {
        console.warn(`Unknown tool type: ${toolType}`);
        return { toolType, args, textContent: "Something went wrong", displayReplacement: "" };
    }

    try {
        const result = await executeFunction(args, nextMessage, interactionData, context, displayMode);
        if (!result || !result.textContent) {
            return { toolType, args, textContent: "Something went wrong", displayReplacement: result?.displayReplacement || "" };
        }
        return result;
    } catch (error) {
        console.error(`Tool "${toolType}" execution error:`, error);
        return { toolType, args, textContent: "Something went wrong", displayReplacement: "" };
    }
}

export async function executeTools(
    invocations: ToolInvocation[], nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext, displayMode?: toolUsageDisplayMode,
): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const invocation of invocations) {
        const result = await executeTool(invocation, nextMessage, interactionData, context, displayMode);
        results.push(result);
    }
    return results;
}

function helpResult(toolType: string, signature: string, description: string): ToolResult {
    const usage = `${toolType}(${signature}) — ${description}`;
    return { toolType, args: '', textContent: `Usage: ${usage}`, displayReplacement: `[${toolType}: ${description}]` };
}

export function formatToolDisplay(result: ToolResult, rawMatch: string, mode: toolUsageDisplayMode): string {
    switch (mode) {
        case 'none': return '';
        case 'icon': return TOOL_EMOJI_MAP[result.toolType.toLowerCase() as tool] || '';
        case 'simple': return result.displayReplacement;
        case 'detailed': return result.displayReplacement;
        case 'full': return `[${result.toolType}(${result.args}) → ${result.textContent}]`;
        case 'raw': return rawMatch;
        default: return result.displayReplacement;
    }
}

// ─── Whisper ────────────────────────────────────────────────────────
function executeWhisper(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    let targetIdsStr = pArgs.get(0, 'target_char_id', 'target', 'target_id', 'to');
    let text = pArgs.get(1, 'text', 'message', 'content');

    if (!pArgs.kwargs.text && pArgs.positional.length > 0) {
        const trimmed = args;
        const cliMatch = trimmed.match(/^("([^"]+)"|'([^']+)'|([^\s]+))\s+([\s\S]+)$/);
        if (cliMatch) {
            targetIdsStr = cliMatch[2] || cliMatch[3] || cliMatch[4];
            text = cliMatch[5];
            if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
                text = text.slice(1, -1);
            }
        } else if (pArgs.positional.length > 1) {
            text = pArgs.positional.slice(1).join(' ');
        }
    }

    if (!targetIdsStr || !text) {
        return helpResult('whisper', 'target_char_id="...", text="..."', 'send private message visible only to target(s)');
    }

    const targetIdentifiers = targetIdsStr.split(',').filter(Boolean);
    const allChars = context.allCharacters || [];
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
        return { toolType: 'whisper', args, textContent: `[Error: Target character "${targetIdsStr}" not found]`, displayReplacement: '[Error: Target not found]' };
    }

    appendPendingAction(nextMessage, {
        type: 'whisper',
        payload: { targetCharacterIds: validTargetIds.join(','), text }
    });

    return { toolType: 'whisper', args, textContent: text, displayReplacement: `[🤫 Whispered to ${validTargetNames.join(', ')}]` };
}

// ─── Think ──────────────────────────────────────────────────────────
function executeThink(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const reasoning = pArgs.get(0, 'reasoning', 'thought', 'text') || pArgs.positional.join(' ');
    if (!reasoning) {
        return helpResult('think', 'reasoning="..."', 'evaluate context and plan next move internally');
    }

    const character = nextMessage.character;
    const coLocated = getCoLocatedParticipants(interactionData, character);
    const history = getLocalMessageHistory(interactionData, character, ['chat', 'whisper'], coLocated.length);

    let wasAddressed = false;
    
    for (let i = history.length - 1; i >= 0; i--) {
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
        `You were ${wasAddressed ? 'addressed' : 'not addressed'} in recent messages.`,
        `Messages since you last spoke: ${messagesSinceLastSpoke}.`,
        nextMessage.remainingChatStamina !== undefined ? `Remaining chat stamina: ${nextMessage.remainingChatStamina}.` : '',
        `Your reasoning: ${reasoning}`,
        '',
        'Based on your reasoning, proceed naturally.'
    ].filter(Boolean);

    return {
        toolType: 'think', args: reasoning, textContent: contextLines.join('\n'), displayReplacement: `[💭 ${character.name} is thinking...]`,
    };
}

// ─── Random Pick ────────────────────────────────────────────────────
function executeRandomPick(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    let options = pArgs.positional;
    const optKwarg = pArgs.get(-1, 'options', 'choices');
    if (optKwarg) {
        options = optKwarg.split(',').filter(Boolean);
    } else if (options.length === 1 && options[0].includes(',')) {
        options = options[0].split(',').filter(Boolean);
    }

    if (options.length === 0) {
        return helpResult('pick', '"option1", "option2", ...', 'randomly pick one option');
    }

    const picked = options[Math.floor(Math.random() * options.length)];
    return { toolType: 'pick', args, textContent: picked, displayReplacement: `[🎯 "${picked}"]` };
}

// ─── Sky View ────────────────────────────────────────────────────────
function executeSkyView(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const location = getCurrentLocation(interactionData, nextMessage.character);
    if (!location || !location?.hasSkyView) {
        return { toolType: 'sky_view', args, textContent: 'You cannot see the sky from here.', displayReplacement: '[🔭 No sky view]' };
    }
    const timeData = getCharacterTimeData(interactionData, nextMessage.character);
    const skyDescription = generateSkyViewText(timeData.rawTimestamp, location?.latitude, location?.longitude);
    return { toolType: 'sky_view', args, textContent: skyDescription, displayReplacement: `[🔭 ${skyDescription}]` };
}

// ─── Clock ────────────────────────────────────────────────────────────
function executeClock(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const format = pArgs.get(0, 'format', 'type')?.toLowerCase();
    const dt = getCharacterTimeData(interactionData, nextMessage.character).luxonTimestamp;
    let timeStr: string;
    if (format === '24h' || format === '24') {
        timeStr = dt.toLocaleString({ hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else if (format === 'unix' || format === 'timestamp') {
        timeStr = Math.floor(dt.toMillis() / 1000).toString();
    } else {
        timeStr = dt.toLocaleString({ hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    }
    return { toolType: 'clock', args, textContent: timeStr, displayReplacement: `[🕰️ ${timeStr}]` };
}

// ─── Calendar ────────────────────────────────────────────────────────
function executeCalendar(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const format = pArgs.get(0, 'format', 'type')?.toLowerCase();
    const dt = getCharacterTimeData(interactionData, nextMessage.character).luxonTimestamp;
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
    return { toolType: 'calendar', args, textContent: dateStr, displayReplacement: `[📅 ${dateStr}]` };
}

// ─── Coin Flip ───────────────────────────────────────────────────────
function executeCoinFlip(args: string): ToolResult {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return { toolType: 'coin', args, textContent: result, displayReplacement: `[🪙 Coin flip: ${result}]` };
}

// ─── Roll Dice ──────────────────────────────────────────────────────
interface RollGroup { count: number; sides: number }

function parseRollExpression(expr: string): { groups: RollGroup[]; modifier: number; rolls: number[]; total: number } | null {
    const sanitized = expr.toLowerCase().replace(/\s+/g, '');
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

export function executeDiceRoll(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    let notation = pArgs.get(-1, 'notation', 'expr', 'expression');
    const kwSides = pArgs.getNumber(-1, 'sides', 'side', 's', 'max');
    const kwCount = pArgs.getNumber(-1, 'count', 'num', 'dice_count', 'n');
    const kwMod = pArgs.getNumber(-1, 'modifier', 'mod', 'plus');

    if (!notation && kwSides !== undefined) {
        const count = kwCount ?? 1;
        const modifier = kwMod ?? 0;
        const modSign = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
        notation = `${count}d${kwSides}${modSign}`;
    } else if (!notation && pArgs.positional.length === 1) {
        const p = pArgs.positional[0];
        if (/^\d+$/.test(p)) notation = `1d${p}`;
        else if (/^d\d+$/i.test(p)) notation = `1${p}`;
        else notation = p;
    } else if (!notation && pArgs.positional.length >= 2) {
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
        return { toolType: 'dice', args, textContent: `[Error: Invalid dice notation. Usage: dice(sides=6), dice("2d6+3"), or dice(count, sides). Received: "${args}"]`, displayReplacement: '[Error: Invalid dice call]' };
    }

    const rollsStr = result.rolls.join(', ');
    const modStr = result.modifier > 0 ? ` + ${result.modifier}` : result.modifier < 0 ? ` - ${Math.abs(result.modifier)}` : '';
    const label = result.groups.length === 1 ? `${result.groups[0].count}d${result.groups[0].sides}` : result.groups.map(g => `${g.count}d${g.sides}`).join(' + ');
    const content = result.rolls.length > 1 ? `${result.total} (Rolls: [${rollsStr}])` : `${result.total}`;

    return { toolType: 'dice', args, textContent: content, displayReplacement: `[🎲 ${label}${modStr} → [${rollsStr}] = ${result.total}]` };
}

// ─── Random Number ───────────────────────────────────────────────────
function executeRandom(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    let min = pArgs.getNumber(0, 'min', 'start') ?? 1;
    let max = pArgs.getNumber(1, 'max', 'end', 'stop');

    if (max === undefined && pArgs.positional.length === 1 && pArgs.positional[0].includes('-')) {
        const parts = pArgs.positional[0].split('-');
        min = Number(parts[0]) || 1;
        max = Number(parts[1]) || 100;
    } else if (max === undefined) {
        max = pArgs.getNumber(0, 'max', 'end') ?? 100;
        if (pArgs.positional.length === 1 && !pArgs.kwargs['min']) min = 1;
    }

    if (min > max) [min, max] = [max, min];

    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return { toolType: 'random', args, textContent: result.toString(), displayReplacement: `[🎲 Random(${min}-${max}): ${result}]` };
}

// ─── RNG Table ────────────────────────────────────────────────────────
function executeRng(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const tableId = pArgs.get(0, 'table_context_id', 'table', 'context_id', 'name') || pArgs.positional.join(' ');
    if (!tableId) {
        return helpResult('rng', 'table_context_id="..."', 'roll on a named RNG table defined in contexts');
    }

    const contexts = interactionData.contexts || [];
    const tableContext = contexts.find(c => c.id === tableId || c.name?.toLowerCase() === tableId.toLowerCase());
    if (!tableContext || !tableContext.text) {
        return { toolType: 'rng', args, textContent: `[Error: RNG table "${tableId}" not found in contexts]`, displayReplacement: '[Error: Table not found]' };
    }

    const lines = tableContext.text.split('\n').filter(Boolean);
    const entries: { min: number; max: number; result: string }[] = [];
    let globalMax = 0;

    for (const line of lines) {
        const rangeMatch = line.match(/^(\d+)\s*[-–]\s*(\d+)\s*[:=]\s*(.+)$/);
        const singleMatch = line.match(/^(\d+)\s*[:=]\s*(.+)$/);
        if (rangeMatch) {
            const min = Number.parseInt(rangeMatch[1], 10), max = Number.parseInt(rangeMatch[2], 10);
            entries.push({ min, max, result: rangeMatch[3] });
            if (max > globalMax) globalMax = max;
        } else if (singleMatch) {
            const val = Number.parseInt(singleMatch[1], 10);
            entries.push({ min: val, max: val, result: singleMatch[2] });
            if (val > globalMax) globalMax = val;
        }
    }

    if (entries.length === 0) {
        return { toolType: 'rng', args, textContent: `[Error: RNG table "${tableContext.name}" has no valid entries]`, displayReplacement: '[Error: Empty table]' };
    }

    const roll = Math.floor(Math.random() * globalMax) + 1;
    const matched = entries.find(e => roll >= e.min && roll <= e.max);
    return {
        toolType: 'rng', args, textContent: matched ? matched.result : `Rolled ${roll}, no match`, displayReplacement: `[🎲 ${tableContext.name}: ${matched ? matched.result : 'no match'}]`
    };
}

// ─── Move ───────────────────────────────────────────────────────────
function executeMove(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'location_id', 'location', 'target', 'destination', 'to') || pArgs.positional.join(' ');
    if (!targetQuery) {
        return helpResult('move', 'location_id="..."', 'move character to an adjacent location');
    }

    const currentLocation = getCurrentLocation(interactionData, nextMessage.character);
    if (!currentLocation) return { toolType: 'move', args, textContent: '[Error: Current character location unknown]', displayReplacement: '[Error: Unknown location]' };

    const targetLocation = resolveLocation(targetQuery, interactionData);
    if (!targetLocation) return { toolType: 'move', args, textContent: `[Error: Location "${targetQuery}" not found]`, displayReplacement: '[Error: Location not found]' };

    if (targetLocation.id === currentLocation.id) {
        return { toolType: 'move', args, textContent: `Already at "${targetLocation.name}".`, displayReplacement: `[🚶 Already at "${targetLocation.name}"]` };
    }

    const isAdjacent = currentLocation.locationBindings?.includes(targetLocation.id) || targetLocation.locationBindings?.includes(currentLocation.id);
    if (!isAdjacent) {
        return { toolType: 'move', args, textContent: `[Error: Location "${targetLocation.name}" is not adjacent]`, displayReplacement: '[Error: Not adjacent]' };
    }

    if (isCharacterLockedFromLocation(interactionData, nextMessage.character.id, targetLocation.id)) {
        return { toolType: 'move', args, textContent: `[Error: Location "${targetLocation.name}" is locked]`, displayReplacement: '[Error: Location locked]' };
    }

    return { toolType: 'move', args, textContent: `Moved to "${targetLocation.name}" (${targetLocation.id}).`, displayReplacement: `[🚶 Moved to "${targetLocation.name}"]` };
}

// ─── Duration Parser ────────────────────────────────────────────────
function parseDurationToMs(input: string): number | null {
    const trimmed = input.toLowerCase();
    let totalMs = 0, matched = false;
    const hourMatch = trimmed.match(/(\d+)\s*h(?:ours?|r)?/);
    if (hourMatch) { totalMs += Number.parseInt(hourMatch[1], 10) * 3600000; matched = true; }
    const minMatch = trimmed.match(/(\d+)\s*m(?:in(?:utes?|s))?/);
    if (minMatch) { totalMs += Number.parseInt(minMatch[1], 10) * 60000; matched = true; }
    const secMatch = trimmed.match(/(\d+)\s*s(?:ec(?:onds?|s))?/);
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

// ─── Timer ──────────────────────────────────────────────────────────
function executeTimer(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('timer', 'action="set|check|delete|list", name="...", duration="..."', 'manage countdown timers');
    }

    const activeActions = resolveActiveToolActions(nextMessage, interactionData);
    const timers = activeActions.timers ? [...activeActions.timers] : [];
    const now = Date.now();

    switch (action) {
        case 'set': {
            const name = pArgs.get(1, 'name', 'timer_name');
            const durRaw = pArgs.get(2, 'duration', 'time', 'len');
            const durationMs = durRaw ? parseDurationToMs(durRaw) : null;
            if (!name || !durationMs) {
                return { toolType: 'timer', args, textContent: '[Error: timer(action="set", name="...", duration="...") requires name and duration]', displayReplacement: '[Error: Usage]' };
            }
            const filtered = timers.filter(t => t.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, targetTimestamp: now + durationMs });
            activeActions.timers = filtered;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'timer', args, textContent: `Timer "${name}" set for ${formatDuration(durationMs)}.`, displayReplacement: `[⏱️ Timer "${name}" set]` };
        }
        case 'check': {
            const name = pArgs.get(1, 'name')?.toLowerCase();
            if (name) {
                const timer = timers.find(t => t.name.toLowerCase() === name);
                if (!timer) return { toolType: 'timer', args, textContent: `No timer named "${name}".`, displayReplacement: '[⏱️ No timer]' };
                const remaining = timer.targetTimestamp - now;
                return { toolType: 'timer', args, textContent: remaining <= 0 ? `Timer "${timer.name}" EXPIRED.` : `${timer.name}: ${formatDuration(remaining)} remaining.`, displayReplacement: `[⏱️ "${timer.name}": ${remaining <= 0 ? 'EXPIRED' : formatDuration(remaining)}]` };
            }
            if (timers.length === 0) return { toolType: 'timer', args, textContent: 'No active timers.', displayReplacement: '[⏱️ No timers]' };
            return { toolType: 'timer', args, textContent: timers.map(t => `${t.name}: ${formatDuration(t.targetTimestamp - now)}`).join('\n'), displayReplacement: `[⏱️ ${timers.length} timer(s)]` };
        }
        case 'delete': {
            const name = pArgs.get(1, 'name')?.toLowerCase();
            const idx = timers.findIndex(t => t.name.toLowerCase() === name);
            if (idx === -1) return { toolType: 'timer', args, textContent: `No timer named "${name}".`, displayReplacement: '[⏱️ Not found]' };
            timers.splice(idx, 1);
            activeActions.timers = timers;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'timer', args, textContent: `Timer "${name}" deleted.`, displayReplacement: `[⏱️ Deleted "${name}"]` };
        }
        case 'list': {
            if (timers.length === 0) return { toolType: 'timer', args, textContent: 'No active timers.', displayReplacement: '[⏱️ No timers]' };
            return { toolType: 'timer', args, textContent: timers.map(t => `${t.name}: ${formatDuration(t.targetTimestamp - now)}`).join('\n'), displayReplacement: `[⏱️ ${timers.length} timer(s)]` };
        }
        default:
            return { toolType: 'timer', args, textContent: `[Error: Unknown timer action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Stopwatch ──────────────────────────────────────────────────────
function executeStopwatch(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const name = pArgs.get(1, 'name', 'stopwatch_name');
    if (!action) {
        return helpResult('stopwatch', 'action="start|stop|pause|resume|reset|check|list", name="..."', 'manage stopwatch counters');
    }

    const activeActions = resolveActiveToolActions(nextMessage, interactionData);
    const stopwatches = activeActions.stopwatches ? [...activeActions.stopwatches] : [];
    const now = Date.now();

    switch (action) {
        case 'start': {
            if (!name) return { toolType: 'stopwatch', args, textContent: '[Error: stopwatch(action="start", name="...") requires name]', displayReplacement: '[Error: Usage]' };
            const filtered = stopwatches.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, startTimestamp: now });
            activeActions.stopwatches = filtered;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'stopwatch', args, textContent: `Stopwatch "${name}" started.`, displayReplacement: `[⏱️ Started "${name}"]` };
        }
        case 'pause': {
            const sw = stopwatches.find(s => s.name.toLowerCase() === name?.toLowerCase());
            if (!sw) return { toolType: 'stopwatch', args, textContent: `No stopwatch named "${name}".`, displayReplacement: '[⏱️ Not found]' };
            if (sw.pausedElapsedMs === undefined) {
                sw.pausedElapsedMs = now - sw.startTimestamp;
                activeActions.stopwatches = stopwatches;
                nextMessage.activeToolActions = activeActions;
            }
            return { toolType: 'stopwatch', args, textContent: `Stopwatch "${name}" paused at ${formatDuration(sw.pausedElapsedMs)}.`, displayReplacement: `[⏱️ Paused "${name}"]` };
        }
        case 'resume': {
            const sw = stopwatches.find(s => s.name.toLowerCase() === name?.toLowerCase());
            if (!sw) return { toolType: 'stopwatch', args, textContent: `No stopwatch named "${name}".`, displayReplacement: '[⏱️ Not found]' };
            if (sw.pausedElapsedMs !== undefined) {
                sw.startTimestamp = now - sw.pausedElapsedMs;
                delete sw.pausedElapsedMs;
                activeActions.stopwatches = stopwatches;
                nextMessage.activeToolActions = activeActions;
            }
            return { toolType: 'stopwatch', args, textContent: `Stopwatch "${name}" resumed.`, displayReplacement: `[⏱️ Resumed "${name}"]` };
        }
        case 'reset': {
            const sw = stopwatches.find(s => s.name.toLowerCase() === name?.toLowerCase());
            if (!sw) return { toolType: 'stopwatch', args, textContent: `No stopwatch named "${name}".`, displayReplacement: '[⏱️ Not found]' };
            sw.startTimestamp = now;
            delete sw.pausedElapsedMs;
            activeActions.stopwatches = stopwatches;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'stopwatch', args, textContent: `Stopwatch "${name}" reset.`, displayReplacement: `[⏱️ Reset "${name}"]` };
        }
        case 'stop': {
            const idx = stopwatches.findIndex(s => s.name.toLowerCase() === name?.toLowerCase());
            if (idx === -1) return { toolType: 'stopwatch', args, textContent: `No stopwatch named "${name}".`, displayReplacement: '[⏱️ Not found]' };
            const sw = stopwatches[idx];
            const elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
            stopwatches.splice(idx, 1);
            activeActions.stopwatches = stopwatches;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'stopwatch', args, textContent: `Stopwatch "${name}" stopped at ${formatDuration(elapsed)}.`, displayReplacement: `[⏱️ Stopped at ${formatDuration(elapsed)}]` };
        }
        case 'check':
        case 'list': {
            if (name) {
                const sw = stopwatches.find(s => s.name.toLowerCase() === name.toLowerCase());
                if (!sw) return { toolType: 'stopwatch', args, textContent: `No stopwatch named "${name}".`, displayReplacement: '[⏱️ Not found]' };
                const elapsed = sw.pausedElapsedMs !== undefined ? sw.pausedElapsedMs : now - sw.startTimestamp;
                return { toolType: 'stopwatch', args, textContent: `${sw.name}: ${formatDuration(elapsed)}`, displayReplacement: `[⏱️ ${formatDuration(elapsed)}]` };
            }
            return { toolType: 'stopwatch', args, textContent: stopwatches.map(s => `${s.name}: ${formatDuration(s.pausedElapsedMs !== undefined ? s.pausedElapsedMs : now - s.startTimestamp)}`).join('\n') || 'No stopwatches', displayReplacement: `[⏱️ ${stopwatches.length} stopwatch(es)]` };
        }
        default:
            return { toolType: 'stopwatch', args, textContent: `[Error: Unknown stopwatch action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Schedule ───────────────────────────────────────────────────────
function executeSchedule(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('schedule', 'action="set|set_repeat|cancel|cancel_all|list", name="...", duration="...", action_desc="..."', 'schedule automated actions');
    }

    const activeActions = resolveActiveToolActions(nextMessage, interactionData);
    const schedules = activeActions.schedules ? [...activeActions.schedules] : [];
    const now = Date.now();

    switch (action) {
        case 'set': {
            const name = pArgs.get(1, 'name', 'schedule_name');
            const durRaw = pArgs.get(2, 'duration', 'time', 'interval');
            const durationMs = durRaw ? parseDurationToMs(durRaw) : null;
            const desc = pArgs.get(3, 'action_desc', 'desc', 'do', 'event', 'text') || pArgs.positional.slice(3).join(' ');
            if (!name || !durationMs || !desc) {
                return { toolType: 'schedule', args, textContent: '[Error: schedule(action="set", name="...", duration="...", action_desc="...") requires all parameters]', displayReplacement: '[Error: Usage]' };
            }
            const filtered = schedules.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, triggerTimestamp: now + durationMs, action: desc });
            activeActions.schedules = filtered;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'schedule', args, textContent: `Scheduled "${name}" in ${formatDuration(durationMs)}: ${desc}`, displayReplacement: `[📅 Scheduled "${name}"]` };
        }
        case 'set_repeat': {
            const name = pArgs.get(1, 'name', 'schedule_name');
            const durRaw = pArgs.get(2, 'interval', 'duration', 'time');
            const intervalMs = durRaw ? parseDurationToMs(durRaw) : null;
            const desc = pArgs.get(3, 'action_desc', 'desc', 'do', 'event', 'text') || pArgs.positional.slice(3).join(' ');
            if (!name || !intervalMs || !desc) {
                return { toolType: 'schedule', args, textContent: '[Error: schedule(action="set_repeat", name="...", interval="...", action_desc="...") requires all parameters]', displayReplacement: '[Error: Usage]' };
            }
            const filtered = schedules.filter(s => s.name.toLowerCase() !== name.toLowerCase());
            filtered.push({ name, triggerTimestamp: now + intervalMs, action: desc, repeatIntervalMs: intervalMs });
            activeActions.schedules = filtered;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'schedule', args, textContent: `Repeating schedule "${name}" every ${formatDuration(intervalMs)}: ${desc}`, displayReplacement: `[📅 Repeat "${name}"]` };
        }
        case 'cancel': {
            const name = pArgs.get(1, 'name')?.toLowerCase();
            const idx = schedules.findIndex(s => s.name.toLowerCase() === name);
            if (idx === -1) return { toolType: 'schedule', args, textContent: `No schedule named "${name}".`, displayReplacement: '[📅 Not found]' };
            schedules.splice(idx, 1);
            activeActions.schedules = schedules;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'schedule', args, textContent: `Cancelled "${name}".`, displayReplacement: `[📅 Cancelled "${name}"]` };
        }
        case 'cancel_all': {
            activeActions.schedules = [];
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'schedule', args, textContent: 'Cancelled all schedules.', displayReplacement: '[📅 Cancelled all]' };
        }
        case 'list': {
            return { toolType: 'schedule', args, textContent: schedules.map(s => `${s.name}: ${formatDuration(s.triggerTimestamp - now)} remaining -> ${s.action}${s.repeatIntervalMs ? ` (repeats every ${formatDuration(s.repeatIntervalMs)})` : ''}`).join('\n') || 'No schedules', displayReplacement: `[📅 ${schedules.length} schedule(s)]` };
        }
        default:
            return { toolType: 'schedule', args, textContent: `[Error: Unknown schedule action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Calculator ─────────────────────────────────────────────────────
function executeCalculator(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    const expression = pArgs.get(0, 'expression', 'expr', 'math') || pArgs.positional.join(' ');
    if (!expression) {
        return helpResult('calculator', 'expression="..."', 'evaluate mathematical expression');
    }

    try {
        if (!/^[\d\s+\-*/().,%^eE]+$/.test(expression)) {
            return { toolType: 'calculator', args, textContent: '[Error: Invalid math characters]', displayReplacement: '[Error: Invalid characters]' };
        }
        const evaluable = expression.replace(/\^/g, '**');
        const result = new Function(`"use strict"; return (${evaluable})`)();
        if (typeof result !== 'number' || !Number.isFinite(result)) {
            return { toolType: 'calculator', args, textContent: '[Error: Non-finite calculation result]', displayReplacement: '[Error: Invalid result]' };
        }
        const formatted = Number.isInteger(result) ? result.toString() : Number.parseFloat(result.toFixed(8)).toString();
        return { toolType: 'calculator', args, textContent: formatted, displayReplacement: formatted };
    } catch (e) {
        return { toolType: 'calculator', args, textContent: `[Error: ${(e as Error).message}]`, displayReplacement: '[Error: Math error]' };
    }
}

// ─── Web ────────────────────────────────────────────────────────────
async function executeWeb(args: string): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const input = pArgs.get(0, 'url_or_search_query', 'query_or_url', 'query', 'url', 'search') || pArgs.positional.join(' ');
    if (!input) return helpResult('web', 'url_or_search_query="..."', 'search the web or fetch a URL');

    try {
        const isDirectUrl = /^https?:\/\//i.test(input);
        const urlToFetch = isDirectUrl ? input : buildSearchUrl([input]);
        const results = await fetchLinkContent(urlToFetch, { maxDepth: 0, cacheTimeToLiveMs: 5 * 60 * 1000, fetchMode: 'extract', includeImages: false });
        const valid = results.filter(r => !r.error && r.textContent.length > 0);

        if (valid.length === 0) {
            return { toolType: 'web', args, textContent: `[Error: ${results[0]?.error || 'No content retrieved'}]`, displayReplacement: '[Error: Fetch failed]' };
        }
        return { toolType: 'web', args, textContent: valid[0].textContent, displayReplacement: `[🌐 Fetched: "${input}"]` };
    } catch (e) {
        return { toolType: 'web', args, textContent: `[Error: ${(e as Error).message}]`, displayReplacement: '[Error: Web error]' };
    }
}

// ─── Dialogue ──────────────────────────────────────────────────────
async function executeDialogue(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const allDialoguePrompts = nextMessage.character.dialoguePrompts || [];

    if (!action) {
        return helpResult('dialogue', 'action="list|recall", prompt_id="..."', 'manage dialogue prompts');
    }

    const localHistory = getLocalMessageHistory(interactionData, nextMessage.character, ['chat', 'whisper']) as TextMessage[];
    const filterFlags = getUniversalMessageFilterFlags(localHistory, context.allPromptBlocks || [], interactionData.contexts || [], interactionData.locations || []);
    
    const filteredHistory = localHistory.filter((_, i) => !filterFlags[i]);
    const characterIdArray = filteredHistory.map(m => m.character.id);
    const textArray = filteredHistory.map(m => m.textContent);
    const searchSpace = buildDialogueSearchSpace(textArray);

    const combinationCache: CombinationCache = {};
    const evalContext: TriggerEvaluationContext = {
        characterIdArray,
        textContentArray: textArray,
        selectedCharacterId: nextMessage.character.id,
        protagonistIds: interactionData.protagonistIds || [],
        fallbackSearchSpace: searchSpace,
        combinationCache,
    };

    const activeDialoguePrompts = getActiveDialoguePrompts(allDialoguePrompts, evalContext);

    if (action === 'list') {
        const entries = activeDialoguePrompts.map(dp => `${dp.id} | ${dp.name}`);
        return { toolType: 'dialogue', args, textContent: entries.join('\n') || 'No active dialogue prompts', displayReplacement: `[💬 ${entries.length} active prompt(s)]` };
    }

    if (action === 'recall') {
        const queryId = pArgs.get(1, 'prompt_id', 'id') || pArgs.positional.slice(1).join(' ');
        
        const matched = activeDialoguePrompts.filter(dp => dp.id === queryId || dp.name?.toLowerCase() === queryId?.toLowerCase() || dp.id.startsWith(queryId || ""));
        
        if (matched.length > 0) {
            const recalled = await collectActiveDialoguePromptContent(matched, evalContext);
            return { toolType: 'dialogue', args, textContent: recalled.join('\n') || 'No active instructions', displayReplacement: `[💬 Recalled ${recalled.length} instruction(s)]` };
        }

        if (nextMessage.character.useEmbeddingModelForDialoguePrompts && nextMessage.character.dialogueRetrievalConfiguration) {
            const queryVector = await embeddingEngine.embed(queryId);
            if (queryVector) {
                const items: RetrievableItem[] = activeDialoguePrompts.map(dp => ({
                    id: dp.id, name: dp.name, textContent: dp.textContent, embedding: dp.embedding, firstCreatedTimestamp: dp.firstCreatedTimestamp
                }));
                const overrideConfig = { ...nextMessage.character.dialogueRetrievalConfiguration, topK: 3, tokenBudget: 512 };
                const results = await retrieveRelevantContext(queryVector, queryId, items, overrideConfig);
                if (results.length > 0) {
                    return {
                        toolType: 'dialogue',
                        args,
                        textContent: results.map(r => `[${r.name || 'Instruction'}]: ${r.textContent}`).join('\n---\n'),
                        displayReplacement: `[💬 Semantic Recall: ${results.length} instructions]`
                    };
                }
            }
        }
        return { toolType: 'dialogue', args, textContent: `No active dialogue prompt matching "${queryId}".`, displayReplacement: '[💬 No match]' };
    }

    return { toolType: 'dialogue', args, textContent: `[Error: Unknown dialogue action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Knowledge ──────────────────────────────────────────────────────
async function executeKnowledge(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const allKnowledgePrompts = nextMessage.character.knowledgePrompts || [];

    if (!action) {
        return helpResult('knowledge', 'action="list|recall|fuzzy_recall", id="..."', 'inspect character knowledge base');
    }

    const localHistory = getLocalMessageHistory(interactionData, nextMessage.character, ['chat', 'whisper']) as TextMessage[];
    const filterFlags = getUniversalMessageFilterFlags(localHistory, context.allPromptBlocks || [], interactionData.contexts || [], interactionData.locations || []);
    
    const filteredHistory = localHistory.filter((_, i) => !filterFlags[i]);
    const characterIdArray = filteredHistory.map(m => m.character.id);
    const textArray = filteredHistory.map(m => m.textContent);
    const searchSpace = textArray.join('\n');

    const combinationCache: CombinationCache = {};

    const activeKnowledgePrompts = allKnowledgePrompts.filter(kp =>
        isEntityActiveWithCache(
            kp.regularExpressionActivationTriggers,
            kp.regularExpressionDeactivationTriggers,
            kp.regularExpressionExclusionActivationTriggers,
            kp.regularExpressionExclusionDeactivationTriggers,
            characterIdArray,
            textArray,
            nextMessage.character.id,
            interactionData.protagonistIds || [],
            searchSpace,
            combinationCache
        )
    );

    if (action === 'list') {
        const entries = activeKnowledgePrompts.map(kp => `${kp.id} | ${kp.name}`);
        return { toolType: 'knowledge', args, textContent: entries.join('\n') || 'No active knowledge prompts', displayReplacement: `[🧠 ${entries.length} active prompt(s)]` };
    }

    if (action === 'recall') {
        const queryId = pArgs.get(1, 'id', 'knowledge_id') || pArgs.positional.slice(1).join(' ');
        const matched = activeKnowledgePrompts.filter(kp => kp.id === queryId || kp.name?.toLowerCase() === queryId?.toLowerCase() || kp.id.startsWith(queryId || ""));
        if (matched.length === 0) return { toolType: 'knowledge', args, textContent: `No active knowledge matching "${queryId}".`, displayReplacement: '[🧠 No match]' };
        return { toolType: 'knowledge', args, textContent: matched.map(k => `[${k.name}]: ${k.textContent}`).join('\n'), displayReplacement: `[🧠 Recalled ${matched.length} entry(ies)]` };
    }

    if (action === 'fuzzy_recall') {
        const searchString = pArgs.get(1, 'query', 'search', 'text') || pArgs.positional.slice(1).join(' ');
        if (!searchString) return { toolType: 'knowledge', args, textContent: 'No search string provided for fuzzy recall.', displayReplacement: '[🧠 Fuzzy Recall: Empty]' };
        if (!nextMessage.character.useEmbeddingModelForKnowledgePrompts || !nextMessage.character.knowledgeRetrievalConfiguration) {
            return { toolType: 'knowledge', args, textContent: 'Semantic search is disabled for this character\'s knowledge prompts.', displayReplacement: '[🧠 Fuzzy Recall: Disabled]' };
        }
        const queryVector = await embeddingEngine.embed(searchString);
        if (!queryVector) {
            return { toolType: 'knowledge', args, textContent: 'Failed to generate embedding for fuzzy recall.', displayReplacement: '[🧠 Fuzzy Recall: Error]' };
        }
        const items: RetrievableItem[] = activeKnowledgePrompts.map(kp => ({
            id: kp.id,
            name: kp.name,
            textContent: kp.textContent,
            embedding: kp.embedding,
            firstCreatedTimestamp: kp.firstCreatedTimestamp
        }));
        const results = await retrieveRelevantContext(queryVector, searchString, items, nextMessage.character.knowledgeRetrievalConfiguration);
        if (results.length === 0) {
            return { toolType: 'knowledge', args, textContent: `No active knowledge semantically matched for "${searchString}".`, displayReplacement: '[🧠 Fuzzy Recall: No match]' };
        }
        return {
            toolType: 'knowledge',
            args,
            textContent: results.map(r => `[${r.name || 'Lore'}]: ${r.textContent}`).join('\n---\n'),
            displayReplacement: `[🧠 Fuzzy Recall: ${results.length} entries]`
        };
    }

    return { toolType: 'knowledge', args, textContent: `[Error: Unknown knowledge action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Memory ─────────────────────────────────────────────────────────
async function executeMemory(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
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
        return { toolType: 'memory', args, textContent: entries.join('\n') || 'No memories stored', displayReplacement: `[🧠 ${entries.length} memories]` };
    }

    if (action === 'recall') {
        const queryId = pArgs.get(1, 'id', 'memory_id') || pArgs.positional.slice(1).join(' ');
        const latest = findLatestMessage(interactionData, character);
        const knownNames = latest?.message.knownCharacterNames;

        if (queryId) {
            for (const [, mems] of Object.entries(character.memories || {})) {
                const found = mems.find(m => m.id === queryId || m.name?.toLowerCase() === queryId.toLowerCase() || m.id.startsWith(queryId));
                if (found) {
                    const detokenized = detokenizeMemoryContent(
                        found.textContent,
                        interactionData.participants,
                        knownNames,
                    );
                    return { toolType: 'memory', args, textContent: detokenized, displayReplacement: `[🧠 Recalled "${found.name}"]` };
                }
            }

            const retrieved = await retrieveEligibleMemories(
                character,
                interactionData,
                queryId,
                context.allRawInteractionDataShells,
                knownNames,
            );
            if (retrieved) {
                return {
                    toolType: 'memory',
                    args,
                    textContent: retrieved,
                    displayReplacement: '[🧠 Semantic Recall]'
                };
            }
            return { toolType: 'memory', args, textContent: `Memory "${queryId}" not found.`, displayReplacement: '[🧠 Not found]' };
        }

        const retrieved = await retrieveEligibleMemories(
            character,
            interactionData,
            '',
            context.allRawInteractionDataShells,
            knownNames,
        );
        return {
            toolType: 'memory',
            args,
            textContent: retrieved || 'No memories found',
            displayReplacement: '[🧠 Recalled memories]'
        };
    }

    if (action === 'save') {
        const others = interactionData.participants.filter(p => p.id !== character.id);
        const summary = await generateCharacterMemory(interactionData, character, context.allPromptBlocks, '', 512);
        if (!summary) return { toolType: 'memory', args, textContent: '[Error: Failed to summarize memory]', displayReplacement: '[Error: Memory error]' };
        const ts = Date.now();
        if (!character.memories) character.memories = {};
        for (const o of others) {
            if (!character.memories[o.id]) character.memories[o.id] = [];
            character.memories[o.id].push({
                id: uuidv4(),
                name: `Memory with ${o.name}`,
                textContent: summary,
                interactionDataId: interactionData.id,
                firstCreatedTimestamp: ts,
                lastUpdatedTimestamp: ts
            });
        }
        await saveRawCharacter(character as any).catch(console.warn);
        context.addToast?.(`🧠 Memory saved for ${character.name}`, 'success');
        return { toolType: 'memory', args, textContent: `Saved memory: ${summary}`, displayReplacement: '[🧠 Memory saved]' };
    }

    return { toolType: 'memory', args, textContent: `[Error: Unknown memory action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Lookup ─────────────────────────────────────────────────────────
function executeLookup(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const query = pArgs.get(0, 'keyword', 'query', 'search', 'text')?.toLowerCase() || pArgs.positional.join(' ').toLowerCase();
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
    return { toolType: 'lookup', args, textContent: matches.join('\n') || `No results for "${query}"`, displayReplacement: `[🔍 ${matches.length} result(s)]` };
}

// ─── Map ────────────────────────────────────────────────────────────
function executeMap(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'target_location_id', 'target', 'to', 'destination');
    const fromQuery = pArgs.get(1, 'from_location_id', 'from', 'source');

    if (!targetQuery) {
        return helpResult('map', 'to="...", from="..."', 'calculate distance between locations');
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

    if (!fromLoc || !toLoc) return { toolType: 'map', args, textContent: '[Error: Locations not found]', displayReplacement: '[Error: Locations not found]' };
    if (fromLoc.id === toLoc.id) return { toolType: 'map', args, textContent: `Already at "${toLoc.name}".`, displayReplacement: `[🗺️ Already at "${toLoc.name}"]` };

    let distanceKm = fromLoc.locationDistances?.[toLoc.id];
    if (distanceKm === undefined && fromLoc.latitude !== undefined && fromLoc.longitude !== undefined && toLoc.latitude !== undefined && toLoc.longitude !== undefined) {
        const R = 6371;
        const dLat = (toLoc.latitude - fromLoc.latitude) * Math.PI / 180;
        const dLon = (toLoc.longitude - fromLoc.longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(fromLoc.latitude * Math.PI / 180) * Math.cos(toLoc.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    if (distanceKm === undefined) return { toolType: 'map', args, textContent: '[Error: Distance cannot be determined]', displayReplacement: '[Error: Unknown distance]' };
    const rounded = Math.round(distanceKm * 10) / 10;
    return { toolType: 'map', args, textContent: `Distance: ${rounded} km.`, displayReplacement: `[🗺️ ${fromLoc.name} -> ${toLoc.name}: ${rounded} km]` };
}

// ─── Audio ──────────────────────────────────────────────────────────
function executeAudio(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const trackId = pArgs.get(1, 'track_id', 'track', 'name') || pArgs.positional.slice(1).join(' ');
    if (!action) {
        return helpResult('audio', 'action="play|stop", track_id="..."', 'manage background audio playback');
    }

    const tracks = interactionData.audioTracks || context.allAudioTracks || [];
    const track = tracks.find(t => t.id === trackId || t.name.toLowerCase() === trackId.toLowerCase());
    const audioEngine = getAudioEngine();

    if (action === 'play') {
        if (!track) return { toolType: 'audio', args, textContent: `[Error: Track "${trackId}" not found]`, displayReplacement: '[Error: Track not found]' };
        audioEngine.startTrack(track);
        return { toolType: 'audio', args, textContent: `Playing "${track.name}".`, displayReplacement: `[🔊 Playing "${track.name}"]` };
    }

    if (action === 'stop') {
        if (track) audioEngine.stopTrack(track.id);
        return { toolType: 'audio', args, textContent: track ? `Stopped "${track.name}".` : 'Stopped audio.', displayReplacement: `[🔇 Stopped audio]` };
    }

    return { toolType: 'audio', args, textContent: `[Error: Unknown audio action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Note ──────────────────────────────────────────────────────────
function executeNote(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('note', 'action="set|get|delete|list", key="...", text="..."', 'manage persistent character notes');
    }

    const activeActions = resolveActiveToolActions(nextMessage, interactionData);
    const notes = activeActions.notes ? { ...activeActions.notes } : {};

    switch (action) {
        case 'set': {
            const key = pArgs.get(1, 'key', 'name');
            const text = pArgs.get(2, 'text', 'content', 'value') || pArgs.positional.slice(2).join(' ');
            if (!key || !text) return { toolType: 'note', args, textContent: '[Error: note(action="set", key="...", text="...") requires key and text]', displayReplacement: '[Error: Usage]' };
            notes[key] = text;
            activeActions.notes = notes;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'note', args, textContent: `Saved note "${key}".`, displayReplacement: `[📝 Note: "${key}"]` };
        }
        case 'get': {
            const key = pArgs.get(1, 'key', 'name');
            return { toolType: 'note', args, textContent: (key && notes[key]) || `Note "${key}" not found.`, displayReplacement: `[📝 Note "${key}"]` };
        }
        case 'delete': {
            const key = pArgs.get(1, 'key', 'name');
            if (key) delete notes[key];
            activeActions.notes = notes;
            nextMessage.activeToolActions = activeActions;
            return { toolType: 'note', args, textContent: `Deleted note "${key}".`, displayReplacement: `[📝 Deleted "${key}"]` };
        }
        case 'list': {
            const entries = Object.entries(notes).map(([k, v]) => `${k}: ${v}`);
            return { toolType: 'note', args, textContent: entries.join('\n') || 'No notes', displayReplacement: `[📝 ${entries.length} note(s)]` };
        }
        default:
            return { toolType: 'note', args, textContent: `[Error: Unknown note action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Inventory ──────────────────────────────────────────────────────
function executeInventory(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('inventory', 'action="list|add|remove|set", item="...", qty=1, value=None', 'manage character inventory items');
    }

    const latest = findLatestMessage(interactionData, nextMessage.character);
    const inventory: Inventory = nextMessage.inventory 
        ? { ...nextMessage.inventory } 
        : (latest?.message?.inventory ? { ...latest.message.inventory } : {});

    switch (action) {
        case 'list': {
            const items = Object.entries(inventory).map(([k, v]) => `${k}: ${v}`);
            return { toolType: 'inventory', args, textContent: items.join('\n') || 'Empty inventory', displayReplacement: `[📦 ${items.length} item(s)]` };
        }
        case 'add': {
            const item = pArgs.get(1, 'item', 'name');
            const qty = pArgs.getNumber(2, 'qty', 'quantity', 'count') ?? 1;
            if (!item) return { toolType: 'inventory', args, textContent: '[Error: inventory(action="add", item="...", qty=1) requires item]', displayReplacement: '[Error: Usage]' };
            const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0;
            inventory[item] = current + qty;
            nextMessage.inventory = inventory;
            return { toolType: 'inventory', args, textContent: `Added ${qty}x "${item}".`, displayReplacement: `[📦 +${qty} ${item}]` };
        }
        case 'remove': {
            const item = pArgs.get(1, 'item', 'name');
            const qty = pArgs.getNumber(2, 'qty', 'quantity', 'count') ?? 1;
            if (!item) return { toolType: 'inventory', args, textContent: '[Error: inventory(action="remove", item="...", qty=1) requires item]', displayReplacement: '[Error: Usage]' };
            const current = typeof inventory[item] === 'number' ? (inventory[item] as number) : 0;
            if (current <= qty) delete inventory[item]; else inventory[item] = current - qty;
            nextMessage.inventory = inventory;
            return { toolType: 'inventory', args, textContent: `Removed ${qty}x "${item}".`, displayReplacement: `[📦 -${qty} ${item}]` };
        }
        case 'set': {
            const item = pArgs.get(1, 'item', 'name');
            const val = pArgs.get(2, 'value', 'val', 'qty');
            if (!item || val === undefined) return { toolType: 'inventory', args, textContent: '[Error: inventory(action="set", item="...", value=...) requires item and value]', displayReplacement: '[Error: Usage]' };
            inventory[item] = Number.isNaN(Number(val)) ? val : Number(val);
            nextMessage.inventory = inventory;
            return { toolType: 'inventory', args, textContent: `Set "${item}" to ${val}.`, displayReplacement: `[📦 Set ${item}]` };
        }
        default:
            return { toolType: 'inventory', args, textContent: `[Error: Unknown inventory action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Trade ──────────────────────────────────────────────────────────
function parseItemList(input: string): Record<string, number> {
    const res: Record<string, number> = {};
    const tokens = input.split(',').filter(Boolean);
    for (const token of tokens) {
        const parts = token.split(':');
        const name = parts[0];
        const qty = parts[1] ? Number(parts[1]) : 1;
        if (name) res[name] = Number.isNaN(qty) ? 1 : qty;
    }
    return res;
}

function executeTrade(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) return helpResult('trade', 'action="give|take|offer|accept|decline|list_offers", ...', 'transfer items or manage trade offers');

    const latest = findLatestMessage(interactionData, nextMessage.character);
    const myInv: Inventory = nextMessage.inventory 
        ? { ...nextMessage.inventory } 
        : (latest?.message?.inventory ? { ...latest.message.inventory } : {});
        
    const activeActions = resolveActiveToolActions(nextMessage, interactionData);
    const offers = activeActions.tradeOffers ? [...activeActions.tradeOffers] : [];

    if (action === 'give') {
        const targetQuery = pArgs.get(1, 'target_character_id', 'target', 'character_id', 'character', 'to');
        const item = pArgs.get(2, 'item', 'name');
        const qty = pArgs.getNumber(3, 'qty', 'quantity', 'count') ?? 1;
        if (!targetQuery || !item) {
            return { toolType: 'trade', args, textContent: '[Error: trade(action="give", target="...", item="...", qty=1) requires target and item]', displayReplacement: '[Error: Usage]' };
        }
        const targetChar = resolveCharacter(targetQuery, interactionData, context.allCharacters || []);
        if (!targetChar) return { toolType: 'trade', args, textContent: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[Error: Target not found]' };
        const targetLatest = findLatestMessage(interactionData, targetChar);
        if (!targetLatest) return { toolType: 'trade', args, textContent: `[Error: Target "${targetChar.name}" has no message history]`, displayReplacement: '[Error: Target missing]' };
        const targetInv: Inventory = targetLatest.message.inventory ? { ...targetLatest.message.inventory } : {};
        const myQty = typeof myInv[item] === 'number' ? (myInv[item] as number) : 0;
        if (myQty < qty) return { toolType: 'trade', args, textContent: `[Error: Not enough "${item}". Have ${myQty}, need ${qty}]`, displayReplacement: '[Error: Lacks items]' };
        if (myQty <= qty) delete myInv[item]; else myInv[item] = myQty - qty;
        targetInv[item] = (typeof targetInv[item] === 'number' ? (targetInv[item] as number) : 0) + qty;
        nextMessage.inventory = myInv;
        return { toolType: 'trade', args, textContent: `Gave ${qty}x "${item}" to ${targetChar.name}.`, displayReplacement: `[🤝 Gave ${qty}x ${item} to ${targetChar.name}]` };
    }

    if (action === 'take') {
        const targetQuery = pArgs.get(1, 'target_character_id', 'target', 'character_id', 'character', 'from');
        const item = pArgs.get(2, 'item', 'name');
        const qty = pArgs.getNumber(3, 'qty', 'quantity', 'count') ?? 1;
        if (!targetQuery || !item) {
            return { toolType: 'trade', args, textContent: '[Error: trade(action="take", target="...", item="...", qty=1) requires target and item]', displayReplacement: '[Error: Usage]' };
        }
        const targetChar = resolveCharacter(targetQuery, interactionData, context.allCharacters || []);
        if (!targetChar) return { toolType: 'trade', args, textContent: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[Error: Target not found]' };
        const targetLatest = findLatestMessage(interactionData, targetChar);
        if (!targetLatest) return { toolType: 'trade', args, textContent: `[Error: Target "${targetChar.name}" has no message history]`, displayReplacement: '[Error: Target missing]' };
        const targetInv: Inventory = targetLatest.message.inventory ? { ...targetLatest.message.inventory } : {};
        const theirQty = typeof targetInv[item] === 'number' ? (targetInv[item] as number) : 0;
        if (theirQty < qty) return { toolType: 'trade', args, textContent: `[Error: ${targetChar.name} only has ${theirQty}x "${item}"]`, displayReplacement: '[Error: Target lacks items]' };
        if (theirQty <= qty) delete targetInv[item]; else targetInv[item] = theirQty - qty;
        myInv[item] = (typeof myInv[item] === 'number' ? (myInv[item] as number) : 0) + qty;
        nextMessage.inventory = myInv;
        return { toolType: 'trade', args, textContent: `Took ${qty}x "${item}" from ${targetChar.name}.`, displayReplacement: `[🤝 Took ${qty}x ${item} from ${targetChar.name}]` };
    }

    if (action === 'offer') {
        const targetQuery = pArgs.get(1, 'character', 'target', 'to');
        const giveRaw = pArgs.get(2, 'give_items', 'give');
        const takeRaw = pArgs.get(3, 'take_items', 'take');
        if (!targetQuery || !giveRaw || !takeRaw) {
            return { toolType: 'trade', args, textContent: '[Error: trade(action="offer", target="...", give_items="...", take_items="...") requires all parameters]', displayReplacement: '[Error: Usage]' };
        }
        const targetChar = resolveCharacter(targetQuery, interactionData, context.allCharacters || []);
        if (!targetChar) return { toolType: 'trade', args, textContent: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[Error: Target not found]' };
        
        const offerId = uuidv4().slice(0, 8);
        const newOffer: TradeOffer = {
            id: offerId, fromCharacterId: nextMessage.character.id, toCharacterId: targetChar.id,
            giveItems: parseItemList(giveRaw), takeItems: parseItemList(takeRaw), timestamp: Date.now(),
        };
        offers.push(newOffer);
        activeActions.tradeOffers = offers;
        nextMessage.activeToolActions = activeActions;
        return { toolType: 'trade', args, textContent: `Offered trade [${offerId}] to ${targetChar.name} (Give: ${giveRaw}, Take: ${takeRaw}).`, displayReplacement: `[🤝 Offered trade to ${targetChar.name}]` };
    }

    if (action === 'list_offers') {
        if (offers.length === 0) return { toolType: 'trade', args, textContent: 'No pending trade offers.', displayReplacement: '[🤝 No offers]' };
        const list = offers.map(o => `Offer [${o.id}] with ${o.toCharacterId}: Give ${JSON.stringify(o.giveItems)}, Take ${JSON.stringify(o.takeItems)}`).join('\n');
        return { toolType: 'trade', args, textContent: list, displayReplacement: `[🤝 ${offers.length} offer(s)]` };
    }

    if (action === 'accept' || action === 'decline') {
        const offerId = pArgs.get(1, 'offer_id', 'id')?.toLowerCase();
        const idx = offers.findIndex(o => o.id.toLowerCase() === offerId);
        if (idx === -1) return { toolType: 'trade', args, textContent: `Offer "${offerId}" not found.`, displayReplacement: '[🤝 Not found]' };
        offers.splice(idx, 1);
        activeActions.tradeOffers = offers;
        nextMessage.activeToolActions = activeActions;
        return { toolType: 'trade', args, textContent: `${action === 'accept' ? 'Accepted' : 'Declined'} trade offer [${offerId}].`, displayReplacement: `[🤝 ${action === 'accept' ? 'Accepted' : 'Declined'}]` };
    }

    return { toolType: 'trade', args, textContent: `[Error: Unknown trade action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Invite ─────────────────────────────────────────────────────────
function executeInvite(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'character_id', 'character', 'target', 'id') || pArgs.positional.join(' ');
    if (!targetQuery) return helpResult('invite', 'character_id="..."', 'bring existing participant to current location');
    const targetChar = resolveCharacter(targetQuery, interactionData, context.allCharacters || []);
    if (!targetChar) return { toolType: 'invite', args, textContent: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[Error: Target not found]' };
    appendPendingAction(nextMessage, { type: 'invite', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'invite', args, textContent: `Invited ${targetChar.name}.`, displayReplacement: `[📨 Invited ${targetChar.name}]` };
}

// ─── Kick ───────────────────────────────────────────────────────────
function executeKick(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'character_id', 'character', 'target', 'id');
    if (!targetQuery) return helpResult('kick', 'character_id="...", destination_location_id=None', 'eject character from location');

    const currentLocation = getCurrentLocation(interactionData, nextMessage.character);
    if (!currentLocation) {
        return { toolType: 'kick', args, textContent: '[Error: Current character location unknown]', displayReplacement: '[Error: Unknown location]' };
    }

    if (targetQuery.toLowerCase() === 'characters') {
        const list = getCoLocatedParticipants(interactionData, nextMessage.character).map(c => `${c.name} (${c.id})`);
        return { toolType: 'kick', args, textContent: list.join('\n') || 'No co-located characters', displayReplacement: `[👢 ${list.length} character(s)]` };
    }

    if (targetQuery.toLowerCase() === 'locations') {
        const reachable = getReachableLocationsByCharacter(interactionData, nextMessage.character);
        return { toolType: 'kick', args, textContent: reachable.map(l => `${l.name} (${l.id})`).join('\n') || 'No reachable locations', displayReplacement: `[👢 ${reachable.length} location(s)]` };
    }

    // 1. Target must actually be in the same location to be kicked
    const coLocated = getCoLocatedParticipants(interactionData, nextMessage.character);
    const targetChar = coLocated.find(c => 
        c.id.toLowerCase() === targetQuery.toLowerCase() || 
        c.name.toLowerCase() === targetQuery.toLowerCase() || 
        c.id.startsWith(targetQuery.toLowerCase())
    );
    if (!targetChar) {
        return { toolType: 'kick', args, textContent: `[Error: Character "${targetQuery}" is not in this location to be kicked]`, displayReplacement: '[Error: Target not here]' };
    }

    // 2. Fetch all structurally valid and unlocked exits from the current room
    const reachable = getReachableLocationsByCharacter(interactionData, nextMessage.character);
    if (reachable.length === 0) {
        return { toolType: 'kick', args, textContent: `[Error: Cannot kick ${targetChar.name} — there are no accessible exits from ${currentLocation.name}]`, displayReplacement: '[Error: No exits]' };
    }

    const destLocQuery = pArgs.get(1, 'destination_location_id', 'destination', 'location_id', 'to');
    let destLoc: Location | undefined;

    if (destLocQuery) {
        destLoc = resolveLocation(destLocQuery, interactionData);
        if (!destLoc) {
            return { toolType: 'kick', args, textContent: `[Error: Destination location "${destLocQuery}" not found in current session]`, displayReplacement: '[Error: Location not found]' };
        }

        // 3. MOVEMENT RESTRICTION: Destination MUST be adjacent/reachable
        const isReachable = reachable.some(l => l.id === destLoc!.id);
        if (!isReachable) {
            return { toolType: 'kick', args, textContent: `[Error: Cannot kick to "${destLoc.name}" — it is not adjacent/reachable from ${currentLocation.name}]`, displayReplacement: '[Error: Not reachable]' };
        }

        // 4. LOCK RESTRICTION: Target cannot be kicked into a room locked for them
        if (isCharacterLockedFromLocation(interactionData, targetChar.id, destLoc.id)) {
            return { toolType: 'kick', args, textContent: `[Error: Destination "${destLoc.name}" is locked for ${targetChar.name}]`, displayReplacement: '[Error: Destination locked]' };
        }
    } else {
        // Fall back to the first unlocked reachable adjacent room
        destLoc = reachable.find(l => !isCharacterLockedFromLocation(interactionData, targetChar.id, l.id));
        if (!destLoc) {
            return { toolType: 'kick', args, textContent: `[Error: All adjacent exits are locked for ${targetChar.name}]`, displayReplacement: '[Error: Exits locked]' };
        }
    }

    appendPendingAction(nextMessage, {
        type: 'kick',
        payload: {
            characterId: targetChar.id, 
            characterName: targetChar.name,
            destinationLocationId: destLoc.id, 
            destinationLocationName: destLoc.name
        }
    });

    return { toolType: 'kick', args, textContent: `Kicked ${targetChar.name} to "${destLoc.name}".`, displayReplacement: `[👢 Kicked ${targetChar.name} to ${destLoc.name}]` };
}

// ─── Oracle ───────────────────────────────────────────────────────
function executeOracle(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetLocQuery = pArgs.get(0, 'location', 'target', 'place', 'to');
    const limit = pArgs.getNumber(1, 'limit', 'count') ?? 5;
    const locations = interactionData.locations || [];

    if (!targetLocQuery) {
        const locList = locations.map(l => `"${l.name}" (${l.id})`).join(', ');
        return { toolType: 'oracle', args, textContent: `The scrying glass is unfocused. Available locations in this world: ${locList}. Specify a location to peer into it.`, displayReplacement: '[🔮 Oracle: Unfocused]' };
    }

    const targetLoc = locations.find(l =>
        l.id.toLowerCase() === targetLocQuery.toLowerCase() ||
        l.name.toLowerCase().includes(targetLocQuery.toLowerCase()) ||
        l.id.startsWith(targetLocQuery.toLowerCase())
    );

    if (!targetLoc) {
        return { toolType: 'oracle', args, textContent: `[Error: Location "${targetLocQuery}" does not exist in the world map]`, displayReplacement: '[🔮 Oracle: Unknown location]' };
    }

    const remoteMessages = getLocationMessageHistory(interactionData, targetLoc.id, ['chat', 'whisper'], limit);
    if (remoteMessages.length === 0) return { toolType: 'oracle', args, textContent: `The scrying vision clears over ${targetLoc.name}, but the area is completely empty and silent right now.`, displayReplacement: `[🔮 Scried: ${targetLoc.name} (Empty)]` };
    const visionTranscript = remoteMessages.map(m => `[${m.character.name}]: ${(m as ChatMessage).textContent}`).join('\n');
    return { toolType: 'oracle', args, textContent: `[Scrying Vision of ${targetLoc.name}]:\n${visionTranscript}`, displayReplacement: `[🔮 Scried upon "${targetLoc.name}"]` };
}

// ─── Teleport ───────────────────────────────────────────────────────
function executeTeleport(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const targetQuery = pArgs.get(0, 'location_id', 'location', 'destination', 'target') || pArgs.positional.join(' ');
    if (!targetQuery) return helpResult('teleport', 'location_id="..."', 'instantly move character to any location');
    const targetLocation = resolveLocation(targetQuery, interactionData);
    if (!targetLocation) return { toolType: 'teleport', args, textContent: `[Error: Location "${targetQuery}" not found]`, displayReplacement: '[Error: Not found]' };
    return { toolType: 'teleport', args, textContent: `Teleported to "${targetLocation.name}".`, displayReplacement: `[⚡ Teleported to "${targetLocation.name}"]` };
}

// ─── Key ────────────────────────────────────────────────────────────
function executeKey(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const locQuery = pArgs.get(1, 'location_id', 'location');
    const charQuery = pArgs.get(2, 'character_id', 'character', 'target');

    if (!action || !locQuery) {
        return helpResult('key', 'action="lock|unlock", location_id="...", character_id=None', 'lock or unlock locations');
    }

    const targetLoc = resolveLocation(locQuery, interactionData);
    if (!targetLoc) return { toolType: 'key', args, textContent: `[Error: Location "${locQuery}" not found]`, displayReplacement: '[Error: Location not found]' };

    const targetChar = charQuery ? resolveCharacter(charQuery, interactionData, context.allCharacters || []) : undefined;
    const locked = nextMessage.characterLockedLocations ? { ...nextMessage.characterLockedLocations } : {};
    const charIds = targetChar ? [targetChar.id] : interactionData.participants.map(p => p.id);

    if (action === 'lock') {
        const existing = locked[targetLoc.id] ? [...locked[targetLoc.id]] : [];
        for (const cid of charIds) if (!existing.includes(cid)) existing.push(cid);
        locked[targetLoc.id] = existing;
        nextMessage.characterLockedLocations = locked;
        return { toolType: 'key', args, textContent: `Locked "${targetLoc.name}".`, displayReplacement: `[🔒 Locked "${targetLoc.name}"]` };
    }

    if (action === 'unlock') {
        delete locked[targetLoc.id];
        nextMessage.characterLockedLocations = locked;
        return { toolType: 'key', args, textContent: `Unlocked "${targetLoc.name}".`, displayReplacement: `[🔓 Unlocked "${targetLoc.name}"]` };
    }

    return { toolType: 'key', args, textContent: `[Error: Unknown key action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Clothing ───────────────────────────────────────────────────────
function executeClothing(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    let charQuery = pArgs.get(0, 'character_id', 'character');
    let action = pArgs.get(1, 'action', 'command')?.toLowerCase();
    let clothingQuery = pArgs.get(2, 'clothing_id', 'clothing', 'item');

    if (charQuery && (charQuery.toLowerCase() === 'wear' || charQuery.toLowerCase() === 'remove')) {
        action = charQuery.toLowerCase();
        charQuery = pArgs.get(1, 'character_id', 'character');
        clothingQuery = pArgs.get(2, 'clothing_id', 'clothing', 'item') || pArgs.positional.slice(2).join(' ');
    } else if (!clothingQuery && pArgs.positional.length > 2) {
        clothingQuery = pArgs.positional.slice(2).join(' ');
    }

    if (!charQuery || !action || !clothingQuery) {
        return helpResult('clothing', 'action="wear|remove", character_id="...", clothing_id="..."', 'manage worn clothing items');
    }

    const targetChar = resolveCharacter(charQuery, interactionData, context.allCharacters || []);
    if (!targetChar) return { toolType: 'clothing', args, textContent: `[Error: Character "${charQuery}" not found]`, displayReplacement: '[Error: Character not found]' };

    const clothing = targetChar.clothings?.find(c => c.id === clothingQuery || c.name.toLowerCase() === clothingQuery.toLowerCase());
    if (!clothing) return { toolType: 'clothing', args, textContent: `[Error: Clothing "${clothingQuery}" not found on ${targetChar.name}]`, displayReplacement: '[Error: Clothing not found]' };

    const wearing = nextMessage.characterClothingWearingStatuses ? { ...nextMessage.characterClothingWearingStatuses } : {};

    if (action === 'wear') {
        wearing[clothing.id] = true;
        nextMessage.characterClothingWearingStatuses = wearing;
        return { toolType: 'clothing', args, textContent: `${targetChar.name} wore "${clothing.name}".`, displayReplacement: `[👕 Wore "${clothing.name}"]` };
    }

    if (action === 'remove') {
        wearing[clothing.id] = false;
        nextMessage.characterClothingWearingStatuses = wearing;
        return { toolType: 'clothing', args, textContent: `${targetChar.name} removed "${clothing.name}".`, displayReplacement: `[👕 Removed "${clothing.name}"]` };
    }

    return { toolType: 'clothing', args, textContent: `[Error: Unknown clothing action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Summon ─────────────────────────────────────────────────────────
function executeSummon(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const charQuery = pArgs.get(0, 'character_id', 'character', 'target', 'name') || pArgs.positional.join(' ');
    if (!charQuery) return helpResult('summon', 'character_id="..."', 'add a non-participant character to current session');
    const allChars = context.allCharacters || [];
    const targetChar = interactionData.participants.find(c => c.id === charQuery || c.name.toLowerCase() === charQuery.toLowerCase()) || allChars.find(c => c.id === charQuery || c.name.toLowerCase() === charQuery.toLowerCase());
    if (!targetChar) return { toolType: 'summon', args, textContent: `[Error: Character "${charQuery}" does not exist]`, displayReplacement: '[Error: Character not found]' };
    appendPendingAction(nextMessage, { type: 'summon', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'summon', args, textContent: `Summoned ${targetChar.name}.`, displayReplacement: `[✨ Summoned ${targetChar.name}]` };
}

// ─── Narrate ────────────────────────────────────────────────────────
function executeNarrate(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    const text = pArgs.get(0, 'text', 'narration', 'content') || pArgs.positional.join(' ');
    if (!text) return helpResult('narrate', 'text="..."', 'inject ambient narration without consuming chat stamina');
    return { toolType: 'narrate', args, textContent: text, displayReplacement: `[🎙️ ${text}]` };
}

// ─── Inspect ────────────────────────────────────────────────────────
function executeInspect(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const charQuery = pArgs.get(0, 'character_id', 'character', 'target') || pArgs.positional.join(' ');
    if (!charQuery) return helpResult('inspect', 'character_id="..."', "examine character's visible state");
    const targetChar = resolveCharacter(charQuery, interactionData, context.allCharacters || []);
    if (!targetChar) return { toolType: 'inspect', args, textContent: `[Error: Character "${charQuery}" not found]`, displayReplacement: '[Error: Character not found]' };
    const latest = findLatestMessage(interactionData, targetChar);
    const loc = latest ? interactionData.locations?.find(l => l.id === latest.locationId)?.name || 'unknown' : 'unknown';
    const expr = latest?.message.characterExpression || 'neutral';
    const items = Object.keys(latest?.message.inventory || {}).length;
    return {
        toolType: 'inspect', args,
        textContent: `${targetChar.name} (${targetChar.id}): Location: ${loc}, Expression: ${expr}, Items: ${items}`,
        displayReplacement: `[🔍 ${targetChar.name}: 📍${loc}, 😊${expr}, 📦${items}]`
    };
}

// ─── Administrator ──────────────────────────────────────────────────
function executeAdministrator(
    args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext
): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();

    if (!action) {
        return helpResult('administrator', 'action="list_entities|view_entity|edit_entity|add_to_entity_folder|switch_model|...", entity_type="...", entity_id="..."', 'manage and inspect all system entities and settings');
    }

    if (action === 'list_entities' || (action.startsWith('list_') && action !== 'list_chats' && action !== 'list_sessions')) {
        let rawType = pArgs.get(1, 'entity_type', 'type') || '';
        if (!rawType && action.startsWith('list_')) {
            rawType = action.slice(5);
        }
        const resolvedType = normalizeEntityType(rawType);
        if (!resolvedType) {
            return { toolType: 'administrator', args, textContent: `[Error: administrator(action="list_entities", entity_type="...") requires an entity type. Valid: ${VALID_ENTITY_TYPES.join(', ')}]`, displayReplacement: '[Error: Usage]' };
        }

        const entities = getEntitiesByType(context, resolvedType);
        if (entities.length === 0) {
            return { toolType: 'administrator', args, textContent: `No entities found for type "${resolvedType}".`, displayReplacement: `[📁 0 ${resolvedType}]` };
        }

        const lines = entities.map((item: any) => {
            const label = item.name || item.username || item.id;
            const extra = item.entityType ? ` (Type: ${item.entityType}, ${item.itemIds?.length ?? 0} items)`
                : item.backend ? ` (${item.backend})`
                : item.characterIds ? ` (${item.characterIds.length} characters)`
                : item.id === interactionData.id ? ' (current)' : '';
            return `• [${item.id}] "${label}"${extra}`;
        });

        return { toolType: 'administrator', args, textContent: `Entities for "${resolvedType}" (${entities.length}):\n${lines.join('\n')}`, displayReplacement: `[🔧 ${entities.length} ${resolvedType}(s)]` };
    }

    if (action === 'view_entity' || action === 'get_entity') {
        const rawType = pArgs.get(1, 'entity_type', 'type') || '';
        const query = pArgs.get(2, 'entity_id', 'id', 'name');
        const resolvedType = normalizeEntityType(rawType);
        if (!resolvedType || !query) {
            return { toolType: 'administrator', args, textContent: '[Error: administrator(action="view_entity", entity_type="...", entity_id="...") requires entity_type and entity_id]', displayReplacement: '[Error: Usage]' };
        }

        const entities = getEntitiesByType(context, resolvedType);
        const item = entities.find((x: any) =>
            x.id?.toLowerCase() === query.toLowerCase() ||
            (x.name && x.name.toLowerCase() === query.toLowerCase()) ||
            (x.username && x.username.toLowerCase() === query.toLowerCase()) ||
            x.id?.startsWith(query.toLowerCase())
        );

        if (!item) {
            return { toolType: 'administrator', args, textContent: `[Error: ${resolvedType} entity "${query}" not found]`, displayReplacement: '[Error: Not found]' };
        }

        const { kvCacheTextContentPaths, kvCacheInteractionTextContentSummaries, ...displayItem } = item;
        return { toolType: 'administrator', args, textContent: `[Entity: ${resolvedType}]\n${JSON.stringify(displayItem, null, 2)}`, displayReplacement: `[🔧 View: ${item.name || item.username || item.id}]` };
    }

    if (action === 'edit_entity') {
        const rawType = pArgs.get(1, 'entity_type', 'type') || '';
        const entityId = pArgs.get(2, 'entity_id', 'id');
        const field = pArgs.get(3, 'field', 'key');
        const value = pArgs.get(4, 'value', 'val') || pArgs.positional.slice(4).join(' ');

        const resolvedType = normalizeEntityType(rawType);
        if (!resolvedType || !entityId || !field || value === undefined) {
            return { toolType: 'administrator', args, textContent: '[Error: administrator(action="edit_entity", entity_type="...", entity_id="...", field="...", value="...") requires all arguments]', displayReplacement: '[Error: Usage]' };
        }

        const entities = getEntitiesByType(context, resolvedType);
        const item = entities.find((x: any) =>
            x.id?.toLowerCase() === entityId.toLowerCase() ||
            (x.name && x.name.toLowerCase() === entityId.toLowerCase())
        );
        const targetId = item ? item.id : entityId;
        const targetName = item?.name || item?.username || entityId;

        appendPendingAction(nextMessage, { type: 'administrator_edit_entity', payload: { entityType: resolvedType, entityId: targetId, field, value } });
        context.addToast?.(`Administrator: Edit ${resolvedType} "${targetName}" [${field}] initiated.`, 'info');
        return { toolType: 'administrator', args, textContent: `Requested edit on ${resolvedType} "${targetName}": set ${field} = "${value}".`, displayReplacement: `[🔧 Edit: ${targetName}.${field}]` };
    }

    if (action === 'add_to_entity_folder') {
        const entityFolderQuery = pArgs.get(1, 'entity_folder_id', 'name');
        const itemId = pArgs.get(2, 'item_id', 'id', 'item');
        if (!entityFolderQuery || !itemId) {
            return { toolType: 'administrator', args, textContent: '[Error: administrator(action="add_to_entity_folder", entity_folder_id="...", item_id="...") requires entity folder and item ID]', displayReplacement: '[Error: Usage]' };
        }
        const folders = context.allEntityFolders || [];
        const f = folders.find(x => x.id.toLowerCase() === entityFolderQuery.toLowerCase() || x.name.toLowerCase() === entityFolderQuery.toLowerCase() || x.id.startsWith(entityFolderQuery.toLowerCase()));
        const folderId = f ? f.id : entityFolderQuery;
        const folderName = f ? f.name : entityFolderQuery;

        appendPendingAction(nextMessage, { type: 'administrator_add_to_entity_folder', payload: { entityFolderId: folderId, entityFolderName: folderName, itemId } });
        return { toolType: 'administrator', args, textContent: `Requested adding item "${itemId}" to entity folder "${folderName}".`, displayReplacement: `[🔧 Add to entity folder: ${folderName}]` };
    }

    if (action === 'remove_from_entity_folder') {
        const entityFolderQuery = pArgs.get(1, 'entity_folder_id', 'name');
        const itemId = pArgs.get(2, 'item_id', 'id', 'item');
        if (!entityFolderQuery || !itemId) {
            return { toolType: 'administrator', args, textContent: '[Error: administrator(action="remove_from_entity_folder", entity_folder_id="...", item_id="...") requires entity folder and item ID]', displayReplacement: '[Error: Usage]' };
        }
        const folders = context.allEntityFolders || [];
        const f = folders.find(x => x.id.toLowerCase() === entityFolderQuery.toLowerCase() || x.name.toLowerCase() === entityFolderQuery.toLowerCase() || x.id.startsWith(entityFolderQuery.toLowerCase()));
        const folderId = f ? f.id : entityFolderQuery;
        const folderName = f ? f.name : entityFolderQuery;

        appendPendingAction(nextMessage, { type: 'administrator_remove_from_entity_folder', payload: { entityFolderId: folderId, entityFolderName: folderName, itemId } });
        return { toolType: 'administrator', args, textContent: `Requested removing item "${itemId}" from entity folder "${folderName}".`, displayReplacement: `[🔧 Remove from entity folder: ${folderName}]` };
    }

    switch (action) {
        case 'list_chats':
        case 'list_sessions': {
            const allShells = context.allRawInteractionDataShells || [];
            if (allShells.length === 0) {
                return { toolType: 'administrator', args, textContent: `Current Session: "${interactionData.name}" (${interactionData.id})`, displayReplacement: '[🔧 1 chat]' };
            }
            const lines = allShells.map(shell => {
                const isCurrent = shell.id === interactionData.id ? ' (current)' : '';
                return `• [${shell.id}] "${shell.name || 'Untitled Session'}"${isCurrent}`;
            });
            return { toolType: 'administrator', args, textContent: `Chat Sessions (${allShells.length}):\n${lines.join('\n')}`, displayReplacement: `[🔧 ${allShells.length} chat(s)]` };
        }
        case 'switch_model': {
            const modelName = pArgs.get(1, 'model_name', 'name', 'model') || pArgs.positional.slice(1).join(' ');
            if (!modelName) return { toolType: 'administrator', args, textContent: '[Error: administrator(action="switch_model", model_name="...") requires model name]', displayReplacement: '[Error: Usage]' };
            appendPendingAction(nextMessage, { type: 'administrator_switch_model', payload: { modelName } });
            return { toolType: 'administrator', args, textContent: `Requested switch to model "${modelName}".`, displayReplacement: `[🔧 Switch: ${modelName}]` };
        }
        case 'toggle_account': {
            const accountId = pArgs.get(1, 'account_id', 'account', 'id');
            if (!accountId) return { toolType: 'administrator', args, textContent: '[Error: administrator(action="toggle_account", account_id="...") requires account ID]', displayReplacement: '[Error: Usage]' };
            appendPendingAction(nextMessage, { type: 'administrator_toggle_account', payload: { accountId } });
            return { toolType: 'administrator', args, textContent: `Toggle requested for account "${accountId}".`, displayReplacement: `[🔑 Toggle: ${accountId}]` };
        }
        case 'join_session': {
            const sessionId = pArgs.get(1, 'session_id', 'id', 'session');
            const password = pArgs.get(2, 'password', 'pwd') || '';
            if (!sessionId) return { toolType: 'administrator', args, textContent: '[Error: administrator(action="join_session", session_id="...", password="") requires session ID]', displayReplacement: '[Error: Usage]' };
            appendPendingAction(nextMessage, { type: 'administrator_join_session', payload: { sessionId, password } });
            return { toolType: 'administrator', args, textContent: `Join requested for session "${sessionId}".`, displayReplacement: `[👥 Join: ${sessionId}]` };
        }
        case 'leave_session':
            appendPendingAction(nextMessage, { type: 'administrator_leave_session', payload: {} });
            return { toolType: 'administrator', args, textContent: 'Leave session requested.', displayReplacement: '[👥 Leave session]' };
        case 'accept_join': {
            const accountId = pArgs.get(1, 'account_id', 'id');
            if (!accountId) return { toolType: 'administrator', args, textContent: '[Error: administrator(action="accept_join", account_id="...") requires account ID]', displayReplacement: '[Error: Usage]' };
            appendPendingAction(nextMessage, { type: 'administrator_accept_join', payload: { accountId } });
            return { toolType: 'administrator', args, textContent: `Accepted join for account "${accountId}".`, displayReplacement: `[👥 Accepted: ${accountId}]` };
        }
        case 'reject_join': {
            const accountId = pArgs.get(1, 'account_id', 'id');
            if (!accountId) return { toolType: 'administrator', args, textContent: '[Error: administrator(action="reject_join", account_id="...") requires account ID]', displayReplacement: '[Error: Usage]' };
            appendPendingAction(nextMessage, { type: 'administrator_reject_join', payload: { accountId } });
            return { toolType: 'administrator', args, textContent: `Rejected join for account "${accountId}".`, displayReplacement: `[👥 Rejected: ${accountId}]` };
        }
        default:
            return { toolType: 'administrator', args, textContent: `[Error: Unknown administrator action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

// ─── Creator ────────────────────────────────────────────────────────
function executeCreator(args: string, nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const rawType = pArgs.get(0, 'entity_type', 'type') || '';
    const entityName = pArgs.get(1, 'name', 'entity_name') || pArgs.positional.slice(1).join(' ');

    const resolvedType = normalizeEntityType(rawType);
    if (!resolvedType || !entityName) {
        return helpResult('creator', 'entity_type="...", name="..."', `valid types: ${VALID_ENTITY_TYPES.join(', ')}`);
    }

    appendPendingAction(nextMessage, { type: 'creator', payload: { entityType: resolvedType, entityName } });
    context.addToast?.(`Creator: ${resolvedType} "${entityName}" initiated.`, 'info');
    return { toolType: 'creator', args, textContent: `Created ${resolvedType} "${entityName}".`, displayReplacement: `[🛠️ ${resolvedType}: "${entityName}"]` };
}

// ─── Destroyer ──────────────────────────────────────────────────────
function executeDestroyer(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const rawType = pArgs.get(0, 'entity_type', 'type') || '';
    const entityId = pArgs.get(1, 'entity_id', 'id', 'name') || pArgs.positional.slice(1).join(' ');

    const resolvedType = normalizeEntityType(rawType);
    if (!resolvedType || !entityId) {
        return helpResult('destroyer', 'entity_type="...", entity_id="..."', `valid types: ${VALID_ENTITY_TYPES.join(', ')}`);
    }
    if (resolvedType === 'character' && interactionData.protagonistIds?.includes(entityId)) {
        return { toolType: 'destroyer', args, textContent: '[Error: Cannot destroy session protagonist]', displayReplacement: '[Error: Protected character]' };
    }

    appendPendingAction(nextMessage, { type: 'destroyer', payload: { entityType: resolvedType, entityId, entityName: entityId } });
    context.addToast?.(`Destroyer: ${resolvedType} "${entityId}" initiated.`, 'info');
    return { toolType: 'destroyer', args, textContent: `Destroyed ${resolvedType} "${entityId}".`, displayReplacement: `[💀 Destroyed: "${entityId}"]` };
}

// ─── Schedule Response ──────────────────────────────────────────────
function executeScheduleResponse(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const durationRaw = pArgs.get(0, 'duration', 'time', 'delay');
    const thought = pArgs.get(1, 'thought', 'reason', 'prompt') || pArgs.positional.slice(1).join(' ') || 'Checking in later';
    const durationMs = durationRaw ? parseDurationToMs(durationRaw) : null;

    if (!durationMs) {
        return helpResult('schedule_response', 'duration="2h", thought="Check if Sensei is awake"', 'schedule a delayed follow-up response from this character');
    }

    const activeActions = resolveActiveToolActions(nextMessage, interactionData);
    const scheduled = activeActions.scheduledResponses ? [...activeActions.scheduledResponses] : [];
    scheduled.push({
        characterId: nextMessage.character.id,
        characterName: nextMessage.character.name,
        durationMs,
        thought,
        createdAt: Date.now()
    });
    activeActions.scheduledResponses = scheduled;
    nextMessage.activeToolActions = activeActions;

    return {
        toolType: 'schedule_response', args,
        textContent: `Scheduled follow-up in ${formatDuration(durationMs)}: "${thought}"`,
        displayReplacement: `[⏰ Follow-up in ${formatDuration(durationMs)}]`
    };
}

interface GpuStatusResponse {
    vendor: string; utilizationPercent: number; memoryUsedMB: number; memoryTotalMB: number;
    temperatureC: number | null; powerWatts: number | null; name: string; timestamp: number;
}

// ── Text to Speech ───────────────────────────────────────────────
async function executeTextToSpeech(args: string): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const text = pArgs.get(0, 'text', 'message') || pArgs.positional.join(' ');
    const voice = pArgs.get(1, 'voice');

    if (!text || text.toLowerCase() === 'stop') {
        await stopSpeech();
        return { toolType: 'text_to_speech', args, textContent: 'Speech playback stopped.', displayReplacement: '[🔇 Stopped speaking]' };
    }

    await speakText(text, voice);
    return { toolType: 'text_to_speech', args, textContent: `Speaking: "${text}"`, displayReplacement: `[🔊 Speaking aloud]` };
}

async function executeGpu(args: string): Promise<ToolResult> {
    try {
        const response = await fetch(`${localURL}/gpu/status`);
        if (!response.ok) {
            return { toolType: 'gpu', args, textContent: `[Error: Failed to fetch GPU status (${response.status})]`, displayReplacement: '[❌ GPU Unavailable]' };
        }
        const data = await response.json() as GpuStatusResponse;
        const tempStr = data.temperatureC !== null ? `${data.temperatureC}°C` : null;
        const powerStr = data.powerWatts !== null ? `${data.powerWatts}W` : null;
        const vramPercent = data.memoryTotalMB > 0 ? ((data.memoryUsedMB / data.memoryTotalMB) * 100).toFixed(1) : '0.0';
        const telemetryParts = [
            `Model: ${data.name} (${data.vendor.toUpperCase()})`, `Utilization: ${data.utilizationPercent}%`,
            `VRAM: ${data.memoryUsedMB}MB / ${data.memoryTotalMB}MB (${vramPercent}%)`, tempStr ? `Temperature: ${tempStr}` : null,
            powerStr ? `Power Draw: ${powerStr}` : null,
        ].filter(Boolean);
        const vramUsedGB = (data.memoryUsedMB / 1024).toFixed(1);
        const vramTotalGB = (data.memoryTotalMB / 1024).toFixed(1);
        const tempBadge = data.temperatureC !== null ? ` | ${data.temperatureC}°C` : '';
        return { toolType: 'gpu', args, textContent: telemetryParts.join(', '), displayReplacement: `[📟 GPU: ${data.utilizationPercent}% | ${vramUsedGB}/${vramTotalGB}GB${tempBadge}]` };
    } catch (e) {
        return { toolType: 'gpu', args, textContent: `[Error: ${(e as Error).message}]`, displayReplacement: '[❌ GPU Unavailable]' };
    }
}

// ─── System Info / Telemetry ────────────────────────────────────────
async function executeSystemInfo(args: string): Promise<ToolResult> {
    const res = await getSystemInfo();
    if (!res.success || !res.data) {
        return { toolType: 'system-info', args, textContent: `[Error: ${res.error || 'Failed to fetch system info'}]`, displayReplacement: '[❌ system-info failed]' };
    }
    const d = res.data;
    const content = `CPU: ${d.cpuManufacturer} ${d.cpuBrand} (${d.cores} cores), Load: ${d.loadPercent}%, RAM: ${d.memoryUsedMB}MB / ${d.memoryTotalMB}MB`;
    return { toolType: 'system-info', args, textContent: content, displayReplacement: `[🖥️ CPU: ${d.loadPercent}% | RAM: ${Math.round(d.memoryUsedMB / 1024)}/${Math.round(d.memoryTotalMB / 1024)}GB]` };
}

// ─── Native OS Desktop Notifications ────────────────────────────────
async function executeNotify(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const title = pArgs.get(0, 'title', 'heading') || 'AI Assistant';
    const message = pArgs.get(1, 'message', 'text', 'content') || pArgs.positional.slice(1).join(' ');
    if (!message) {
        return helpResult('notify', 'title="...", message="..."', 'send a native OS desktop notification');
    }
    const res = await sendDesktopNotification(title, message);
    if (!res.success) {
        return { toolType: 'notify', args, textContent: `[Error: ${res.error || 'Failed to send notification'}]`, displayReplacement: '[❌ Notification failed]' };
    }
    context.addToast?.(`Notification sent: ${title}`, 'success');
    return { toolType: 'notify', args, textContent: `Sent OS notification "${title}": ${message}`, displayReplacement: `[🔔 Notification sent]` };
}

// ─── Volume Control Tool ────────────────────────────────────
async function executeVolumeControl(args: string): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const action = (pArgs.get(0, 'action', 'command')?.toLowerCase() || 'get') as 'get' | 'set' | 'mute' | 'unmute';
    const level = pArgs.getNumber(1, 'level', 'volume', 'val');
    const res = await controlVolume(action, level);
    if (!res.success) {
        return { toolType: 'volume_control', args, textContent: `[Error: ${res.error}]`, displayReplacement: '[❌ Volume error]' };
    }
    if (action === 'get') {
        return { toolType: 'volume_control', args, textContent: `Master Volume: ${res.volume}% (Muted: ${res.muted})`, displayReplacement: `[🔊 Volume: ${res.volume}%]` };
    }
    if (action === 'set') {
        return { toolType: 'volume_control', args, textContent: `Master Volume set to ${res.volume}%`, displayReplacement: `[🔊 Set: ${res.volume}%]` };
    }
    if (action === 'mute' || action === 'unmute') {
        return { toolType: 'volume_control', args, textContent: `Audio ${action}d successfully.`, displayReplacement: action === 'mute' ? '[🔇 Muted]' : '[🔊 Unmuted]' };
    }
    return helpResult('volume_control', 'action="get|set|mute|unmute", level=50', 'adjust host system master volume');
}

// ─── Workstation Lock Screen Tool ───────────────────────────────────
async function executeLockScreen(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const res = await lockScreen();
    if (!res.success) {
        return { toolType: 'lock_screen', args, textContent: `[Error: ${res.error}]`, displayReplacement: '[❌ Lock failed]' };
    }
    context.addToast?.('Screen locked', 'info');
    return { toolType: 'lock_screen', args, textContent: 'Host workstation locked successfully.', displayReplacement: '[🔒 Screen Locked]' };
}

// ─── Power State Control Factory (Sleep, Shutdown, Restart) ─────────
function executePower(action: 'sleep' | 'shutdown' | 'restart') {
    return async (args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> => {
        const res = await setSystemPower(action);
        if (!res.success) {
            return { toolType: action, args, textContent: `[Error: ${res.error || `Failed to execute ${action}`}]`, displayReplacement: `[❌ System ${action} failed]` };
        }
        context.addToast?.(`⚠️ System power command executed: ${action}`, 'error');
        return { toolType: action, args, textContent: `Successfully triggered operating system ${action}.`, displayReplacement: `[⚡ SYSTEM ${action.toUpperCase()}]` };
    };
}

// ─── Clipboard Management ───────────────────────────────────────────
async function executeClipboard(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase() || 'read';
    const text = pArgs.get(1, 'text', 'content') || pArgs.positional.slice(1).join(' ');
    if (action !== 'read' && action !== 'write') {
        return helpResult('clipboard', 'action="read|write", text="..."', 'read or write to the host OS clipboard');
    }
    const res = await clipboardAction(action, text);
    if (!res.success) {
        return { toolType: 'clipboard', args, textContent: `[Error: ${res.error || 'Clipboard action failed'}]`, displayReplacement: '[❌ Clipboard failed]' };
    }
    if (action === 'read') {
        return { toolType: 'clipboard', args, textContent: res.content || '', displayReplacement: `[📋 Clipboard read]` };
    } else {
        context.addToast?.('Text copied to clipboard', 'success');
        return { toolType: 'clipboard', args, textContent: `Successfully wrote text to host clipboard.`, displayReplacement: `[📋 Copied to clipboard]` };
    }
}

// ─── Screenshot Capture ─────────────────────────────────────
async function executeScreenshot(args: string, nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const res = await captureScreenshot(nextMessage.character?.id);
    if (!res.success || !res.base64) {
        return { toolType: 'screenshot', args, textContent: `[Error: ${res.error || 'Failed to capture screenshot'}]`, displayReplacement: '[❌ Screenshot failed]' };
    }
    const dataUrl = `data:${res.contentType || 'image/jpeg'};base64,${res.base64}`;
    if ('files' in nextMessage) {
        const msg = nextMessage as TextMessage;
        if (!msg.files) msg.files = [];
        msg.files.push(dataUrl);
    }
    context.addToast?.('Screenshot captured and sent to the language model', 'success');
    return { toolType: 'screenshot', args, textContent: `Screenshot captured and attached to visual input.`, displayReplacement: `[📸 Screenshot captured]` };
}

// ─── front_camera Tool ────────────────────────────────────────────────────
async function executeFrontCamera(args: string, nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.captureFrontCameraImage) {
        return { toolType: 'front_camera', args, textContent: '[Error: Front camera capture is not available in this context.]', displayReplacement: '[❌ front_camera unavailable]' };
    }
    const dataUrl = await context.captureFrontCameraImage();
    if (!dataUrl) {
        return { toolType: 'front_camera', args, textContent: '[Error: Failed to capture front_camera snapshot. Permission denied or hardware error.]', displayReplacement: '[❌ front_camera error]' };
    }
    if ('files' in nextMessage) {
        const msg = nextMessage as TextMessage;
        if (!msg.files) msg.files = [];
        msg.files.push(dataUrl);
    }
    context.addToast?.('Front camera snapshot captured and sent to language model', 'success');
    return { toolType: 'front_camera', args, textContent: 'Front camera snapshot captured and attached to visual input.', displayReplacement: '[📷 Front Camera Snapshot]' };
}

// ─── Local Network Scanner Tool ─────────────────────────────────────
async function executeNetworkScanner(args: string): Promise<ToolResult> {
    const res = await scanLocalNetwork();
    if (!res.success || !res.devices) {
        return { toolType: 'network_scanner', args, textContent: `[Error: ${res.error || 'Failed to scan network'}]`, displayReplacement: '[❌ Network error]' };
    }
    const deviceList = res.devices.map(d => `${d.name || 'Unknown'} (${d.ip}) - MAC: ${d.mac}`).join('\n');
    return { toolType: 'network_scanner', args, textContent: `Discovered ${res.devices.length} device(s) on local network:\n${deviceList}`, displayReplacement: `[🌐 ${res.devices.length} device(s) on LAN]` };
}

// ─── Safe Trash / Recycle Bin Tool ──────────────────────────────────
async function executeTrash(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const targetPath = pArgs.get(0, 'path', 'file_path', 'target') || pArgs.positional.join(' ');
    if (!targetPath) {
        return helpResult('trash', 'path="..."', 'safely move a file or folder to OS recycle bin / trash');
    }
    const res = await moveToTrash(targetPath);
    if (!res.success) {
        return { toolType: 'trash', args, textContent: `[Error: ${res.error}]`, displayReplacement: '[❌ Trash error]' };
    }
    context.addToast?.(`Moved to Recycle Bin: ${targetPath}`, 'info');
    return { toolType: 'trash', args, textContent: `Moved "${res.path || targetPath}" to the operating system recycle bin.`, displayReplacement: `[🗑️ Trashed: "${targetPath}"]` };
}

// ── File Watcher ─────────────────────────────────────────────────
async function executeFileWatcher(args: string): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase() || 'check';
    const targetPath = pArgs.get(1, 'path', 'dir') || '.';

    if (action === 'start') {
        const res = await startFileWatcher(targetPath);
        if (!res.success) return { toolType: 'file_watcher', args, textContent: `[Error: ${res.error}]`, displayReplacement: '[❌ Watcher failed]' };
        return { toolType: 'file_watcher', args, textContent: `Now watching folder: ${res.path}`, displayReplacement: `[📂 Watching: ${targetPath}]` };
    }

    if (action === 'check') {
        const res = await getFileWatcherEvents();
        if (!res.events || res.events.length === 0) {
            return { toolType: 'file_watcher', args, textContent: 'No new file events detected.', displayReplacement: '[📂 No file changes]' };
        }
        const summary = res.events.map((e: any) => `[${e.event.toUpperCase()}] ${e.path}`).join('\n');
        return { toolType: 'file_watcher', args, textContent: summary, displayReplacement: `[📂 ${res.events.length} file change(s)]` };
    }

    return helpResult('file_watcher', 'action="start|check", path="..."', 'monitor workspace folders for changes');
}

// ── Process Monitor ──────────────────────────────────────────────
async function executeProcessMonitor(args: string): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const query = pArgs.get(0, 'query', 'name') || '';
    const limit = pArgs.getNumber(1, 'limit') ?? 5;
    const res = await getRunningProcesses(query, limit);
    if (!res.success || !res.processes) {
        return { toolType: 'process_monitor', args, textContent: '[Error: Failed to query processes]', displayReplacement: '[❌ Process error]' };
    }
    const summary = res.processes.map((p: any) => `${p.name} (PID: ${p.pid}, CPU: ${p.cpu}%, Mem: ${p.memPercent}%)`).join('\n');
    return { toolType: 'process_monitor', args, textContent: `Running (${res.runningCount}/${res.totalCount} active):\n${summary}`, displayReplacement: `[⚙️ ${res.processes.length} process(es)]` };
}

// ── Active Window Monitor ────────────────────────────────────────
async function executeWindowMonitor(args: string): Promise<ToolResult> {
    const res = await getActiveWindowInfo();
    if (!res.success || !res.window) {
        return { toolType: 'window_monitor', args, textContent: res.message || 'No active window detected', displayReplacement: '[🖥️ Window: none]' };
    }
    const { title, appName } = res.window;
    return { toolType: 'window_monitor', args, textContent: `Active Window: "${title}" (App: ${appName})`, displayReplacement: `[🖥️ App: ${appName}]` };
}

// ─── Open Browser ───────────────────────────────────────────────────
async function executeBrowser(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const input = pArgs.get(0, 'url_or_search_query', 'query_or_url', 'query', 'url', 'search') || pArgs.positional.join(' ');
    if (!input) return helpResult('browser', 'url_or_search_query="..."', 'open webpage or web search in browser');
    const isDirectUrl = /^https?:\/\//i.test(input) || /^[\w-]+\.[\w-]+(\S*)/i.test(input);
    const finalUrl = isDirectUrl ? (/^https?:\/\//i.test(input) ? input : `https://${input}`) : buildSearchUrl([input], 'Google');
    const res = await readFile(finalUrl);
    if (!res.success) {
        return { toolType: 'browser', args, textContent: `[Error: ${res.error || 'Failed to open browser'}]`, displayReplacement: '[❌ Browser failed]' };
    }
    context.addToast?.(`Browser: ${input}`, 'info');
    return { toolType: 'browser', args, textContent: `Opened browser to: "${finalUrl}".`, displayReplacement: `[🌐 Browser: "${input}"]` };
}

// ─── Read File ──────────────────────────────────────────────────────
async function executeReadFile(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const target = pArgs.get(0, 'path_or_url', 'path', 'file_path', 'url') || pArgs.positional.join(' ');
    if (!target) return helpResult('read_file', 'path_or_url="..."', 'open local file, video, or link in default app');
    const res = await readFile(target);
    if (!res.success) {
        return { toolType: 'read_file', args, textContent: `[Error: ${res.error || 'Failed to open target'}]`, displayReplacement: '[❌ Open failed]' };
    }
    context.addToast?.(`Opened: ${target}`, 'info');
    return { toolType: 'read_file', args, textContent: `Opened: "${res.target || target}".`, displayReplacement: `[🔗 Opened: "${target}"]` };
}

// ─── Write File ─────────────────────────────────────────────────────
async function executeWriteFile(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const filePath = pArgs.get(0, 'file_path', 'path', 'filename');
    let content = pArgs.get(1, 'content', 'text', 'data');
    if (content === undefined && pArgs.positional.length > 1) {
        content = pArgs.positional.slice(1).join(' ');
    }
    if (!filePath || content === undefined) {
        return helpResult('write_file', 'file_path="...", content="..."', 'write or create a file on local filesystem');
    }
    const res = await writeFile(filePath, content);
    if (!res.success) {
        return { toolType: 'write_file', args, textContent: `[Error: ${res.error || 'Failed to write file'}]`, displayReplacement: '[❌ Write failed]' };
    }
    context.addToast?.(`File written: ${filePath}`, 'success');
    return { toolType: 'write_file', args, textContent: `Successfully wrote file to "${res.path || filePath}".`, displayReplacement: `[📁 Saved: "${filePath}"]` };
}

// ─── Shell ─────────────────────────────────────
async function executeShell(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const command = pArgs.get(0, 'command', 'cmd') || pArgs.positional.join(' ');
    if (!command) {
        return helpResult('shell', 'command="..."', 'execute a terminal/shell command on the host OS');
    }
    const res = await runShellCommand(command);
    if (!res.success) {
        return { toolType: 'shell', args, textContent: `[Error: ${res.error || res.stderr || 'Command failed'}]`, displayReplacement: '[❌ Shell failed]' };
    }
    context.addToast?.(`Shell executed: ${command}`, 'success');
    const output = res.stdout || res.stderr || '[Command executed with no output]';
    return { toolType: 'shell', args, textContent: output, displayReplacement: `[💻 Shell: "${command}"]` };
}

// ─── Virtual Hearing Tool ───────────────────────────────────────────
async function executeVirtualHearing(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const rawAction = pArgs.get(0, 'action', 'command')?.toLowerCase();
    let action: string = rawAction || 'start';
    if (action === 'end') action = 'stop';
    const duration = pArgs.getNumber(1, 'duration', 'timeout', 'time') ?? 30;
    const res = await captureVirtualHearing({ action: action as any, duration });
    if (!res.success) {
        return { toolType: 'virtual_hearing', args, textContent: `[Error: ${res.error || 'Server audio perception failed'}]`, displayReplacement: '[❌ Hearing failed]' };
    }
    if (action === 'start') {
        context.addToast?.('🎧 Virtual hearing: Ears opened on server', 'info');
        return { toolType: 'virtual_hearing', args, textContent: res.message || `Virtual hearing started on host server (${duration}s).`, displayReplacement: `[🎧 Hearing Started (${duration}s)]` };
    }
    if (action === 'stop') {
        context.addToast?.('🎧 Virtual hearing: Ears closed & audio analyzed', 'info');
        const badgeText = res.melody?.length ? `🎵 ${res.melody[0]}` : res.events?.length ? res.events[0] : 'Analyzed';
        return { toolType: 'virtual_hearing', args, textContent: res.rawObservation || '[Virtual Hearing Perception]\n- Ambient silence.', displayReplacement: `[🎧 ${badgeText}]` };
    }
    return { toolType: 'virtual_hearing', args, textContent: res.message || (res.active ? 'Hearing is ACTIVE.' : 'Hearing is IDLE.'), displayReplacement: res.active ? '[🎧 Hearing: Active]' : '[🎧 Hearing: Idle]' };
}

// ─── Virtual Vision Tool ────────────────────────────────────
async function executeVirtualVision(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const target = (pArgs.get(0, 'target', 'mode')?.toLowerCase() || 'active') as 'active' | 'fullscreen' | 'region';
    const appName = pArgs.get(1, 'app', 'appName');
    const title = pArgs.get(1, 'title');
    const x = pArgs.getNumber(1, 'x');
    const y = pArgs.getNumber(2, 'y');
    const width = pArgs.getNumber(3, 'width', 'w');
    const height = pArgs.getNumber(4, 'height', 'h');
    const res = await captureVirtualVision({ target, appName, title, x, y, width, height });
    if (!res.success || !res.base64) {
        return { toolType: 'virtual_vision', args, textContent: `[Error: ${res.error || 'Failed to capture targeted vision'}]`, displayReplacement: '[❌ Vision failed]' };
    }
    context.addToast?.(`Captured target: ${res.target}`, 'info');
    return { toolType: 'virtual_vision', args, textContent: `[Vision Captured: ${res.target} | Base64 Length: ${res.base64.length} bytes]`, displayReplacement: `[👁️ Vision: ${res.target}]` };
}

// ─── Virtual Input Tool (Mouse & Keyboard) ──────────────────────────
async function executeVirtualInput(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();
    if (!action) {
        return helpResult('virtual_input', 'action="move|click|type|press|scroll|screen_size", x=0, y=0, text="...", key="..."', 'control host mouse and keyboard');
    }
    const x = pArgs.getNumber(1, 'x');
    const y = pArgs.getNumber(2, 'y');
    const text = pArgs.get(1, 'text', 'content');
    const key = pArgs.get(1, 'key', 'button_name');
    const button = (pArgs.get(1, 'button')?.toLowerCase() || 'left') as 'left' | 'right' | 'middle';
    const modifier = pArgs.get(2, 'modifier', 'mod');
    const double = pArgs.get(2, 'double')?.toLowerCase() === 'true';
    const res = await sendVirtualInput({ action: action as any, x, y, text, key, button, modifier, double });
    if (!res.success) {
        return { toolType: 'virtual_input', args, textContent: `[Error: ${res.error || 'Input simulation failed'}]`, displayReplacement: '[❌ Input failed]' };
    }
    if (action === 'screen_size') {
        return { toolType: 'virtual_input', args, textContent: `Screen Resolution: ${res.width}x${res.height}`, displayReplacement: `[🖥️ Display: ${res.width}x${res.height}]` };
    }
    if (action === 'get_position') {
        return { toolType: 'virtual_input', args, textContent: `Current Mouse Position: (${res.x}, ${res.y})`, displayReplacement: `[🖱️ Cursor: (${res.x}, ${res.y})]` };
    }
    context.addToast?.(`Input executed: ${res.message}`, 'info');
    return { toolType: 'virtual_input', args, textContent: res.message || 'Action executed successfully.', displayReplacement: `[🖱️ ${action.toUpperCase()}]` };
}

// ─── Virtual Controller Tool (Xbox 360 / ViGEm) ─────────────────────
async function executeVirtualController(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const rawFirst = pArgs.get(0, 'action', 'command')?.toLowerCase();
    const BUTTON_SET = new Set([
        'a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'l1', 'r1', 'l2', 'r2', 'l3', 'r3',
        'ls', 'rs', 'start', 'back', 'select', 'menu', 'guide', 'home',
        'up', 'down', 'left', 'right', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right'
    ]);

    let action = 'tap';
    let button: string | undefined;
    let stick: 'left' | 'right' = 'left';
    let trigger: 'left' | 'right' = 'right';
    let x: number | undefined;
    let y: number | undefined;
    let value: number | undefined;
    const durationMs = pArgs.getNumber(-1, 'durationms', 'duration', 'time', 'ms');

    if (rawFirst && BUTTON_SET.has(rawFirst) && pArgs.positional.length === 1 && Object.keys(pArgs.kwargs).length === 0) {
        action = 'tap';
        button = rawFirst.toUpperCase();
    } else if (rawFirst === 'stick') {
        action = 'stick';
        const arg1 = pArgs.get(1, 'stick', 'side')?.toLowerCase();
        if (arg1 === 'left' || arg1 === 'right') {
            stick = arg1;
            x = pArgs.getNumber(2, 'x');
            y = pArgs.getNumber(3, 'y');
        } else {
            stick = (pArgs.kwargs['stick']?.toLowerCase() === 'right') ? 'right' : 'left';
            x = pArgs.getNumber(1, 'x');
            y = pArgs.getNumber(2, 'y');
        }
    } else if (rawFirst === 'trigger') {
        action = 'trigger';
        const arg1 = pArgs.get(1, 'trigger', 'side')?.toLowerCase();
        if (arg1 === 'left' || arg1 === 'right') {
            trigger = arg1;
            value = pArgs.getNumber(2, 'value', 'val');
        } else {
            trigger = (pArgs.kwargs['trigger']?.toLowerCase() === 'left') ? 'left' : 'right';
            value = pArgs.getNumber(1, 'value', 'val');
        }
    } else if (rawFirst === 'reset' || rawFirst === 'status') {
        action = rawFirst;
    } else {
        action = rawFirst || 'tap';
        button = (pArgs.get(1, 'button', 'btn', 'key') || pArgs.kwargs['button'])?.toUpperCase();
    }

    if (!rawFirst && !button) {
        return helpResult('virtual_controller', 'action="tap|press|release|stick|trigger|reset", button="A", x=0.0, y=0.0, value=1.0', 'control host virtual Xbox 360 gamepad');
    }

    const res = await sendVirtualController({ action: action as any, button, stick, x, y, trigger, value, durationMs });
    if (!res.success) {
        return { toolType: 'virtual_controller', args, textContent: `[Error: ${res.error || 'Virtual controller action failed'}]`, displayReplacement: '[❌ Controller failed]' };
    }

    const label = action === 'stick' ? `STICK ${stick.toUpperCase()} (${x ?? 0}, ${y ?? 0})`
        : action === 'trigger' ? `TRIGGER ${trigger.toUpperCase()} (${value ?? 1.0})`
        : button ? `${action.toUpperCase()} ${button}` : action.toUpperCase();
    context.addToast?.(`Gamepad: ${label}`, 'info');
    return { toolType: 'virtual_controller', args, textContent: res.message || `Controller action ${label} executed successfully.`, displayReplacement: `[🎮 ${label}]` };
}

// ── Hardware Control ─────────────────────────────────────────────
async function executeHardwareControl(args: string): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase() || 'list';
    const port = pArgs.get(1, 'port', 'path');
    const command = pArgs.get(2, 'command', 'cmd') || pArgs.positional.slice(2).join(' ');

    if (action === 'list') {
        const res = await getHardwarePorts();
        if (!res.ports || res.ports.length === 0) return { toolType: 'hardware_control', args, textContent: 'No connected serial ports found.', displayReplacement: '[🔌 No ports]' };
        const list = res.ports.map((p: any) => `${p.path} (${p.manufacturer || 'Generic'})`).join(', ');
        return { toolType: 'hardware_control', args, textContent: `Available Ports: ${list}`, displayReplacement: `[🔌 ${res.ports.length} port(s)]` };
    }

    if (action === 'send') {
        if (!port || !command) return { toolType: 'hardware_control', args, textContent: '[Error: port and command required]', displayReplacement: '[Error: Missing args]' };
        const res = await sendHardwareCommand(port, command);
        if (!res.success) return { toolType: 'hardware_control', args, textContent: `[Error: ${res.error}]`, displayReplacement: '[❌ Hardware error]' };
        return { toolType: 'hardware_control', args, textContent: `Sent "${command}" to ${port}`, displayReplacement: `[🔌 Sent to ${port}]` };
    }

    return helpResult('hardware_control', 'action="list|send", port="...", command="..."', 'communicate with external USB/serial hardware');
}

// ─── Process Pending Tool Actions ───────────────────────────────────
export function processPendingToolActions(
    data: InteractionData, allCharacters: Character[], options?: { onToast?: (msg: string, type: 'success' | 'error' | 'info') => void }
): InteractionData {
    const protagonistIds = new Set(data.protagonistIds ?? []);
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

    const actions = targetMsg.pendingToolActions;
    if (!actions || actions.length === 0) return data;

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
            case 'administrator_switch_model': options?.onToast?.(`🔧 Switch to "${action.payload.modelName}" requested.`, 'info'); break;
            case 'administrator_toggle_account': options?.onToast?.(`🔑 Toggle account "${action.payload.accountId}" requested.`, 'info'); break;
            case 'administrator_join_session': options?.onToast?.(`👥 Join session "${action.payload.sessionId}" requested.`, 'info'); break;
            case 'administrator_leave_session': options?.onToast?.(`👥 Leave session "${action.payload.sessionId}" requested.`, 'info'); break;
            case 'administrator_accept_join': options?.onToast?.(`👥 Accept join for "${action.payload.accountId}" requested.`, 'info'); break;
            case 'administrator_reject_join': options?.onToast?.(`👥 Reject join for "${action.payload.accountId}" requested.`, 'info'); break;
            case 'administrator_edit_entity': options?.onToast?.(`🔧 Edit ${action.payload.entityType} "${action.payload.entityId}" (${action.payload.field}) requested.`, 'info'); break;
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
        delete cleanedMsg.pendingToolActions;
        updatedData.interactionHistories[locId] = [...locMsgs];
        updatedData.interactionHistories[locId][targetMsgIdx] = cleanedMsg;
    }

    return { ...updatedData, lastUpdatedTimestamp: Date.now() };
}