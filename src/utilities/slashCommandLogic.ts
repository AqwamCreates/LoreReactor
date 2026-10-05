// src/utilities/slashCommandLogic.ts
import type { Character, Location, Context, AudioTrack, World, PromptBlock, Sampler, StopPattern, Profile, Memory, Account, MultiplayerData, InteractionData, ChatMessage } from '../types';
import { getLocalMessageHistory } from './timelineLogic';

// ─── Tree Data Structures ─────────────────────────────────────────
export type ArgType = 'text' | 'session_location' | 'global_location' | 'session_character' | 'global_character' | 'clothing' | 'audio' | 'item' | 'context' | 'rng_table' | 'dialogue' | 'knowledge' | 'memory' | 'entity_type' | 'prompt_block' | 'sampler' | 'stop_pattern' | 'profile' | 'world' | 'account' | 'multiplayer_session';

export interface SlashArg { name: string; type: ArgType; desc: string; optional?: boolean; example?: string; }
export interface SlashSub { name: string; desc: string; args?: SlashArg[]; }
export interface SlashCmd { name: string; desc: string; subs?: SlashSub[]; args?: SlashArg[]; }
export interface EntityOption { value: string; label: string; id: string; extra?: string; }

export interface AutocompleteOption {
    type: 'cmd' | 'sub' | 'arg' | 'example';
    value: string;
    label: string;
    id: string;
    desc: string;
}

export const VALID_ENTITY_TYPES = ['character', 'context', 'location', 'audio_track', 'prompt_block', 'stop_pattern', 'sampler', 'budget_strategy', 'profile', 'world', 'memory', 'account', 'multiplayer_data'];

export const COMMAND_TREE: SlashCmd[] = [
    { name: 'whisper', desc: 'Send a private message', args: [
        { name: 'targets', type: 'session_character', desc: 'Target character(s), comma-separated', example: 'char1,char2' },
        { name: 'text', type: 'text', desc: 'Whisper content', example: 'Meet me at the inn' }
    ]},
    { name: 'think', desc: 'Reasoning step', args: [{ name: 'reasoning', type: 'text', desc: 'Your thought process', example: 'Should I trust this stranger?' }] },
    { name: 'pick', desc: 'Pick from list', args: [{ name: 'options', type: 'text', desc: 'Comma-separated choices', example: 'sword, shield, potion' }] },
    { name: 'clock', desc: 'Current time', args: [{ name: 'format', type: 'text', desc: 'Time format', example: '24h', optional: true }] },
    { name: 'calendar', desc: 'Current date', args: [{ name: 'format', type: 'text', desc: 'Date format', example: 'iso', optional: true }] },
    { name: 'coin', desc: 'Flip a coin' },
    { name: 'dice', desc: 'Roll dice', args: [{ name: 'notation', type: 'text', desc: 'Dice notation', example: '2d6+3' }] },
    { name: 'random', desc: 'Random integer', args: [{ name: 'range', type: 'text', desc: 'Min-Max or just Max', example: '1-100' }] },
    { name: 'rng', desc: 'Roll on RNG table', args: [{ name: 'table', type: 'rng_table', desc: 'RNG table from context' }] },
    { name: 'move', desc: 'Move to adjacent location', args: [{ name: 'location', type: 'session_location', desc: 'Destination location' }] },
    { name: 'timer', desc: 'Countdown timers', subs: [
        { name: 'set', desc: 'Set timer', args: [
            { name: 'name', type: 'text', desc: 'Timer name', example: 'Bomb' },
            { name: 'duration', type: 'text', desc: 'Duration', example: '5m' }
        ]},
        { name: 'check', desc: 'Check timer', args: [{ name: 'name', type: 'text', desc: 'Timer name', example: 'Bomb', optional: true }] },
        { name: 'delete', desc: 'Delete timer', args: [{ name: 'name', type: 'text', desc: 'Timer name', example: 'Bomb' }] },
        { name: 'list', desc: 'List all timers' },
    ]},
    { name: 'stopwatch', desc: 'Stopwatches', subs: [
        { name: 'start', desc: 'Start stopwatch', args: [{ name: 'name', type: 'text', desc: 'Stopwatch name', example: 'Race' }] },
        { name: 'pause', desc: 'Pause stopwatch', args: [{ name: 'name', type: 'text', desc: 'Stopwatch name', example: 'Race' }] },
        { name: 'resume', desc: 'Resume stopwatch', args: [{ name: 'name', type: 'text', desc: 'Stopwatch name', example: 'Race' }] },
        { name: 'stop', desc: 'Stop stopwatch', args: [{ name: 'name', type: 'text', desc: 'Stopwatch name', example: 'Race' }] },
        { name: 'reset', desc: 'Reset stopwatch', args: [{ name: 'name', type: 'text', desc: 'Stopwatch name', example: 'Race' }] },
        { name: 'check', desc: 'Check stopwatch', args: [{ name: 'name', type: 'text', desc: 'Stopwatch name', example: 'Race', optional: true }] },
        { name: 'list', desc: 'List all stopwatches' },
    ]},
    { name: 'schedule', desc: 'Scheduled actions', subs: [
        { name: 'set', desc: 'Schedule action', args: [
            { name: 'name', type: 'text', desc: 'Schedule name', example: 'patrol' },
            { name: 'duration', type: 'text', desc: 'Duration', example: '1h' },
            { name: 'action', type: 'text', desc: 'Action description', example: 'Guard starts patrol' }
        ]},
        { name: 'set_repeat', desc: 'Repeating schedule', args: [
            { name: 'name', type: 'text', desc: 'Schedule name', example: 'bell' },
            { name: 'interval', type: 'text', desc: 'Interval', example: '30m' },
            { name: 'action', type: 'text', desc: 'Action description', example: 'Church bell rings' }
        ]},
        { name: 'check', desc: 'Check schedule', args: [{ name: 'name', type: 'text', desc: 'Schedule name', example: 'patrol', optional: true }] },
        { name: 'cancel', desc: 'Cancel schedule', args: [{ name: 'name', type: 'text', desc: 'Schedule name', example: 'patrol' }] },
        { name: 'cancel_all', desc: 'Cancel all schedules' },
        { name: 'list', desc: 'List all schedules' },
    ]},
    { name: 'calculator', desc: 'Evaluate math', args: [{ name: 'expression', type: 'text', desc: 'Math expression', example: '15*7+3' }] },
    { name: 'web', desc: 'Search or fetch', args: [{ name: 'query', type: 'text', desc: 'Search query or URL', example: 'medieval sword types' }] },
    { name: 'dialogue', desc: 'Dialogue prompts', subs: [
        { name: 'list', desc: 'List dialogue prompts' },
        { name: 'recall', desc: 'Recall dialogue', args: [{ name: 'dialogue', type: 'dialogue', desc: 'Dialogue prompt' }] },
    ]},
    { name: 'knowledge', desc: 'Knowledge prompts', subs: [
        { name: 'list', desc: 'List knowledge' },
        { name: 'recall', desc: 'Recall knowledge', args: [{ name: 'knowledge', type: 'knowledge', desc: 'Knowledge prompt' }] },
    ]},
    { name: 'memory', desc: 'Character memories', subs: [
        { name: 'list', desc: 'List memories' },
        { name: 'recall', desc: 'Recall memory', args: [{ name: 'memory', type: 'memory', desc: 'Memory', optional: true }] },
        { name: 'save', desc: 'Save conversation as memory' },
    ]},
    { name: 'lookup', desc: 'Search lore', args: [{ name: 'keyword', type: 'text', desc: 'Search keyword', example: 'dragon' }] },
    { name: 'map', desc: 'Show distance', args: [
        { name: 'from', type: 'session_location', desc: 'Start location', optional: true },
        { name: 'to', type: 'session_location', desc: 'End location' }
    ]},
    { name: 'audio', desc: 'Play/stop audio', subs: [
        { name: 'play', desc: 'Play audio track', args: [{ name: 'track', type: 'audio', desc: 'Audio track to play' }] },
        { name: 'stop', desc: 'Stop audio track', args: [{ name: 'track', type: 'audio', desc: 'Audio track to stop', optional: true }] },
    ]},
    { name: 'clothing', desc: 'Equip/remove clothing', subs: [
        { name: 'wear', desc: 'Equip clothing', args: [
            { name: 'character', type: 'session_character', desc: 'Character' },
            { name: 'clothing', type: 'clothing', desc: 'Clothing item' }
        ]},
        { name: 'remove', desc: 'Remove clothing', args: [
            { name: 'character', type: 'session_character', desc: 'Character' },
            { name: 'clothing', type: 'clothing', desc: 'Clothing item' }
        ]},
    ]},
    { name: 'note', desc: 'Manage notes', subs: [
        { name: 'list', desc: 'List all notes' },
        { name: 'set', desc: 'Save note', args: [
            { name: 'key', type: 'text', desc: 'Note label', example: 'key_location' },
            { name: 'text', type: 'text', desc: 'Note content', example: 'The key is under the mat' }
        ]},
        { name: 'get', desc: 'Retrieve note', args: [{ name: 'key', type: 'text', desc: 'Note label', example: 'key_location' }] },
        { name: 'delete', desc: 'Delete note', args: [{ name: 'key', type: 'text', desc: 'Note label', example: 'key_location' }] },
    ]},
    { name: 'inventory', desc: 'Manage items', subs: [
        { name: 'list', desc: 'List all items' },
        { name: 'add', desc: 'Add item', args: [
            { name: 'item', type: 'text', desc: 'Item name', example: 'Iron Sword' },
            { name: 'qty', type: 'text', desc: 'Quantity', example: '3' }
        ]},
        { name: 'remove', desc: 'Remove item', args: [
            { name: 'item', type: 'item', desc: 'Item from inventory' },
            { name: 'qty', type: 'text', desc: 'Quantity', example: '1' }
        ]},
    ]},
    { name: 'trade', desc: 'Trade items', subs: [
        { name: 'give', desc: 'Give item to character', args: [
            { name: 'character', type: 'session_character', desc: 'Recipient' },
            { name: 'items', type: 'text', desc: 'item:qty,item2:qty2', example: 'Iron Sword:1, Potion:3' }
        ]},
        { name: 'take', desc: 'Take item from character', args: [
            { name: 'character', type: 'session_character', desc: 'Source character' },
            { name: 'items', type: 'text', desc: 'item:qty,item2:qty2', example: 'Gold Coin:50' }
        ]},
        { name: 'offer', desc: 'Propose trade', args: [
            { name: 'character', type: 'session_character', desc: 'Trade partner' },
            { name: 'give_items', type: 'text', desc: 'item:qty', example: 'Iron Sword:1' },
            { name: 'take_items', type: 'text', desc: 'item:qty', example: 'Gold Coin:100' }
        ]},
        { name: 'accept', desc: 'Accept trade offer', args: [{ name: 'offer_id', type: 'text', desc: 'Offer ID', example: 'a1b2c3d4' }] },
        { name: 'decline', desc: 'Decline trade offer', args: [{ name: 'offer_id', type: 'text', desc: 'Offer ID', example: 'a1b2c3d4' }] },
        { name: 'list_offers', desc: 'List pending offers' },
    ]},
    { name: 'invite', desc: 'Bring to current location', args: [{ name: 'character', type: 'session_character', desc: 'Character to invite' }] },
    { name: 'kick', desc: 'Kick to location', args: [
        { name: 'character', type: 'session_character', desc: 'Character to kick' },
        { name: 'location', type: 'session_location', desc: 'Destination (optional)', optional: true }
    ]},
    { name: 'oracle', desc: 'Scry remote locations', args: [{ name: 'location', type: 'session_location', desc: 'Target location to peer into' }] },
    { name: 'teleport', desc: 'Instant movement', args: [{ name: 'location', type: 'session_location', desc: 'Any session location' }] },
    { name: 'key', desc: 'Lock/unlock locations', subs: [
        { name: 'lock', desc: 'Lock location', args: [
            { name: 'location', type: 'session_location', desc: 'Location to lock' },
            { name: 'character', type: 'session_character', desc: 'Character (all if omitted)', optional: true }
        ]},
        { name: 'unlock', desc: 'Unlock location', args: [
            { name: 'location', type: 'session_location', desc: 'Location to unlock' },
            { name: 'character', type: 'session_character', desc: 'Character (all if omitted)', optional: true }
        ]},
    ]},
    { name: 'summon', desc: 'Add character to session', args: [{ name: 'character', type: 'global_character', desc: 'Character' }] },
    { name: 'narrate', desc: 'Inject narration', args: [{ name: 'text', type: 'text', desc: 'Narration text', example: 'The wind howls through the trees.' }] },
    { name: 'inspect', desc: 'Examine character', args: [{ name: 'character', type: 'session_character', desc: 'Target character' }] },
    { name: 'administrator', desc: 'Admin controls', subs: [
        { name: 'list_chats', desc: 'List all sessions' },
        { name: 'list_accounts', desc: 'List all accounts' },
        { name: 'list_multiplayer', desc: 'List multiplayer sessions' },
        { name: 'move_protagonist', desc: 'Move to session', args: [{ name: 'chat_id', type: 'text', desc: 'Session ID' }] },
        { name: 'switch_model', desc: 'Switch active model', args: [{ name: 'model_name', type: 'text', desc: 'Model name' }] },
        { name: 'toggle_account', desc: 'Toggle account active state', args: [{ name: 'account', type: 'account', desc: 'Account to toggle' }] },
        { name: 'join_session', desc: 'Join multiplayer session', args: [
            { name: 'session', type: 'multiplayer_session', desc: 'Multiplayer session' },
            { name: 'password', type: 'text', desc: 'Password (optional)', optional: true }
        ]},
        { name: 'leave_session', desc: 'Leave current session' },
        { name: 'accept_join', desc: 'Accept pending join request', args: [{ name: 'account_id', type: 'text', desc: 'Account ID' }] },
        { name: 'reject_join', desc: 'Reject pending join request', args: [{ name: 'account_id', type: 'text', desc: 'Account ID' }] },
    ]},
    { name: 'creator', desc: 'Create new entity', args: [
        { name: 'entity_type', type: 'entity_type', desc: 'Type of entity to create' },
        { name: 'name', type: 'text', desc: 'Name for the new entity', example: 'Forest Guardian' }
    ]},
    { name: 'destroyer', desc: 'Delete entity permanently', args: [
        { name: 'entity_type', type: 'entity_type', desc: 'Type of entity to delete' },
        { name: 'entity', type: 'text', desc: 'Entity to delete (type-specific)' }
    ]},
    { name: 'text_to_speech', desc: 'Convert text to speech', args: [{ name: 'text', type: 'text', desc: 'Text to speak or "stop"', example: 'Hello world' }] },
    { name: 'gpu', desc: 'Check GPU telemetry status' },
    { name: 'system_info', desc: 'Check system CPU & RAM info' },
    { name: 'notify', desc: 'Send OS notification', args: [
        { name: 'title', type: 'text', desc: 'Notification title', example: 'Alert' },
        { name: 'message', type: 'text', desc: 'Message body', example: 'Task complete' }
    ]},
    { name: 'volume_control', desc: 'Control system volume', subs: [
        { name: 'get', desc: 'Get volume' },
        { name: 'set', desc: 'Set volume level', args: [{ name: 'level', type: 'text', desc: 'Volume 0-100', example: '50' }] },
        { name: 'mute', desc: 'Mute audio' },
        { name: 'unmute', desc: 'Unmute audio' },
    ]},
    { name: 'lock_screen', desc: 'Lock host workstation screen' },
    { name: 'clipboard', desc: 'Manage clipboard', subs: [
        { name: 'read', desc: 'Read clipboard' },
        { name: 'write', desc: 'Write text to clipboard', args: [{ name: 'text', type: 'text', desc: 'Text to copy', example: 'Copied text' }] },
    ]},
    { name: 'screenshot', desc: 'Capture desktop screenshot' },
    { name: 'front_camera', desc: 'Capture front camera image' },
    { name: 'network_scanner', desc: 'Scan local network devices' },
    { name: 'file_watcher', desc: 'Watch workspace folders', subs: [
        { name: 'start', desc: 'Start watching path', args: [{ name: 'path', type: 'text', desc: 'Directory path', example: './src' }] },
        { name: 'check', desc: 'Check file changes' },
        { name: 'stop', desc: 'Stop watcher', args: [{ name: 'path', type: 'text', desc: 'Directory path or all', example: 'all', optional: true }] },
    ]},
    { name: 'window_monitor', desc: 'Check active foreground window' },
    { name: 'process_monitor', desc: 'Check running OS processes', args: [{ name: 'query', type: 'text', desc: 'Filter query (optional)', example: 'node', optional: true }] },
    { name: 'trash', desc: 'Move file to recycle bin/trash', args: [{ name: 'path', type: 'text', desc: 'File or folder path', example: 'temp.txt' }] },
    { name: 'browser', desc: 'Open URL or search in browser', args: [{ name: 'url_or_query', type: 'text', desc: 'URL or search query', example: 'https://example.com' }] },
    { name: 'read_file', desc: 'Open file/media with system app', args: [{ name: 'path_or_url', type: 'text', desc: 'File path or media URL', example: '~/documents/notes.txt' }] },
    { name: 'write_file', desc: 'Write content to local file', args: [
        { name: 'file_path', type: 'text', desc: 'Destination file path', example: '~/documents/output.txt' },
        { name: 'content', type: 'text', desc: 'Content to write', example: 'Hello World' }
    ]},
    { name: 'shell', desc: 'Execute terminal shell command', args: [{ name: 'command', type: 'text', desc: 'Shell command', example: 'git status' }] },
    { name: 'virtual_hearing', desc: 'Perceive desktop audio & melody', subs: [
        { name: 'start', desc: 'Start active listening', args: [{ name: 'duration', type: 'text', desc: 'Duration in seconds', example: '30', optional: true }] },
        { name: 'stop', desc: 'Stop active listening' },
        { name: 'status', desc: 'Check hearing status' },
    ]},
    { name: 'virtual_vision', desc: 'Targeted window & region vision', args: [
        { name: 'target', type: 'text', desc: 'active, fullscreen, or region', example: 'active', optional: true }
    ]},
    { name: 'virtual_controller', desc: 'Simulate Xbox 360 gamepad', subs: [
        { name: 'tap', desc: 'Tap button', args: [{ name: 'button', type: 'text', desc: 'Button name (A, B, X, Y, LB, RB, LT, RT, START, BACK)', example: 'A' }] },
        { name: 'press', desc: 'Hold button down', args: [{ name: 'button', type: 'text', desc: 'Button name', example: 'RB' }] },
        { name: 'release', desc: 'Release button', args: [{ name: 'button', type: 'text', desc: 'Button name', example: 'RB' }] },
        { name: 'stick', desc: 'Move analog stick (-1.0 to 1.0)', args: [
            { name: 'stick', type: 'text', desc: 'left or right', example: 'left' },
            { name: 'x', type: 'text', desc: 'X coordinate (-1.0 to 1.0)', example: '0.0' },
            { name: 'y', type: 'text', desc: 'Y coordinate (-1.0 to 1.0)', example: '1.0' }
        ]},
        { name: 'trigger', desc: 'Press analog trigger (0.0 to 1.0)', args: [
            { name: 'trigger', type: 'text', desc: 'left or right', example: 'right' },
            { name: 'value', type: 'text', desc: 'Pressure (0.0 to 1.0)', example: '1.0' }
        ]},
        { name: 'reset', desc: 'Reset all controller inputs to neutral' },
        { name: 'status', desc: 'Check virtual controller status' },
    ]},
    { name: 'virtual_input', desc: 'Simulate mouse & keyboard input', subs: [
        { name: 'move', desc: 'Move mouse cursor', args: [{ name: 'x', type: 'text', desc: 'X coordinate', example: '500' }, { name: 'y', type: 'text', desc: 'Y coordinate', example: '300' }] },
        { name: 'click', desc: 'Click mouse', args: [{ name: 'button', type: 'text', desc: 'left, right, middle', example: 'left', optional: true }] },
        { name: 'type', desc: 'Type string', args: [{ name: 'text', type: 'text', desc: 'Text to type', example: 'Hello' }] },
        { name: 'press', desc: 'Press key/shortcut', args: [{ name: 'key', type: 'text', desc: 'Key name', example: 'enter' }] },
        { name: 'screen_size', desc: 'Get screen resolution' },
        { name: 'get_position', desc: 'Get cursor position' }
    ]},
    { name: 'hardware_control', desc: 'Control USB/serial hardware', subs: [
        { name: 'list', desc: 'List serial ports' },
        { name: 'send', desc: 'Send command to port', args: [{ name: 'port', type: 'text', desc: 'Port path', example: 'COM3' }, { name: 'command', type: 'text', desc: 'Command string', example: 'LED_ON' }] },
    ]},
];

export function getEntityDescription(entity: any): string {
    if (!entity) return '';
    const rawDesc = entity.description ?? entity.content;
    if (rawDesc && typeof rawDesc === 'string' && rawDesc.trim().length > 0) {
        const trimmed = rawDesc.trim();
        return trimmed.length > 80 ? `${trimmed.substring(0, 80)}…` : trimmed;
    }
    return '';
}

export function getEntityOptions(
    type: ArgType,
    data: InteractionData | null,
    allChars: Character[] = [],
    allLocs: Location[] = [],
    allCtxs: Context[] = [],
    allAudio: AudioTrack[] = [],
    allPrompts: PromptBlock[] = [],
    allSamplers: Sampler[] = [],
    allStops: StopPattern[] = [],
    allProfiles: Profile[] = [],
    allWorlds: World[] = [],
    allMems: Memory[] = [],
    allAccounts: Account[] = [],
    allMultiplayerData: MultiplayerData[] = [],
    localChar: Character | null = null
): EntityOption[] {
    if (type === 'entity_type') {
        return VALID_ENTITY_TYPES.map(t => ({ value: t, label: t, id: '', extra: '' }));
    }

    if (type === 'session_character') {
        const participants = data?.participants || [];
        return participants.map(c => ({
            value: c.id,
            label: c.name,
            id: c.id.substring(0, 8),
            extra: getEntityDescription(c)
        }));
    }

    if (type === 'global_character') {
        const participantIds = new Set((data?.participants || []).map(p => p.id));
        return allChars
            .filter(c => !participantIds.has(c.id))
            .map(c => ({
                value: c.id,
                label: c.name,
                id: c.id.substring(0, 8),
                extra: getEntityDescription(c)
            }));
    }

    if (!data && type !== 'account' && type !== 'multiplayer_session') return [];

    if (type === 'session_location') {
        const sessionLocs = data?.locations || [];
        return sessionLocs.map(l => ({
            value: l.id,
            label: l.name,
            id: l.id.substring(0, 8),
            extra: getEntityDescription(l)
        }));
    }

    if (type === 'global_location') {
        return allLocs.map(l => ({
            value: l.id,
            label: l.name,
            id: l.id.substring(0, 8),
            extra: getEntityDescription(l)
        }));
    }

    if (type === 'account') {
        return allAccounts.map(a => ({
            value: a.id,
            label: a.username,
            id: a.id.substring(0, 8),
            extra: getEntityDescription(a)
        }));
    }

    if (type === 'multiplayer_session') {
        return allMultiplayerData.map(m => ({
            value: m.id,
            label: m.name,
            id: m.id.substring(0, 8),
            extra: getEntityDescription(m)
        }));
    }

    if (type === 'audio') {
        return allAudio.map(t => ({
            value: t.id,
            label: t.name,
            id: t.id.substring(0, 8),
            extra: getEntityDescription(t)
        }));
    }

    if (type === 'clothing' && localChar) {
        return (localChar.clothings || []).map(c => ({
            value: c.id,
            label: c.name,
            id: c.id.substring(0, 8),
            extra: getEntityDescription(c)
        }));
    }

    if (type === 'item') {
        if (!data || !localChar) return [];
        const localMessageHistory = getLocalMessageHistory(data, localChar, ['chat', 'whisper']);
        const lastMsg = localMessageHistory[localMessageHistory.length - 1];
        
        if (lastMsg?.inventory) {
            return Object.entries(lastMsg.inventory)
                .filter(([k]) => !k.startsWith('___'))
                .map(([k, v]) => ({
                    value: k,
                    label: k,
                    id: `×${v}`,
                    extra: ''
                }));
        }
        return [];
    }

    if (type === 'context') {
        return allCtxs.map(c => ({
            value: c.id,
            label: c.name,
            id: c.id.substring(0, 8),
            extra: getEntityDescription(c)
        }));
    }

    if (type === 'prompt_block') {
        return allPrompts.map(p => ({
            value: p.id,
            label: p.name,
            id: p.id.substring(0, 8),
            extra: getEntityDescription(p)
        }));
    }

    if (type === 'sampler') {
        return allSamplers.map(s => ({
            value: s.id,
            label: s.name,
            id: s.id.substring(0, 8),
            extra: getEntityDescription(s)
        }));
    }

    if (type === 'stop_pattern') {
        return allStops.map(s => ({
            value: s.id,
            label: s.name,
            id: s.id.substring(0, 8),
            extra: getEntityDescription(s)
        }));
    }

    if (type === 'profile') {
        return allProfiles.map(p => ({
            value: p.id,
            label: p.name,
            id: p.id.substring(0, 8),
            extra: getEntityDescription(p)
        }));
    }

    if (type === 'world') {
        return allWorlds.map(w => ({
            value: w.id,
            label: w.name,
            id: w.id.substring(0, 8),
            extra: getEntityDescription(w)
        }));
    }

    if (type === 'memory') {
        return allMems.map(m => ({
            value: m.id,
            label: m.name,
            id: m.id.substring(0, 8),
            extra: getEntityDescription(m)
        }));
    }

    if (type === 'rng_table') {
        return allCtxs
            .filter(c => c.text && /^\d+[-:]/.test(c.text || ''))
            .map(c => ({
                value: c.name || c.id,
                label: c.name || 'Unnamed RNG',
                id: c.id.substring(0, 8),
                extra: getEntityDescription(c)
            }));
    }

    if (type === 'dialogue') {
        const dialogues = localChar?.dialoguePrompts || [];
        return dialogues.map(d => ({
            value: d.id,
            label: d.name,
            id: d.id.substring(0, 8),
            extra: getEntityDescription(d)
        }));
    }

    if (type === 'knowledge') {
        const knowledge = localChar?.knowledgePrompts || [];
        return knowledge.map(k => ({
            value: k.id,
            label: k.name,
            id: k.id.substring(0, 8),
            extra: getEntityDescription(k)
        }));
    }

    return [];
}

export interface SlashAutocompleteComputeResult {
    breadcrumbs: string[];
    options: AutocompleteOption[];
    isComplete: boolean;
    isSlash: boolean;
    activeIndex: number;
    currentQuery: string;
}

export function computeSlashAutocomplete(
    inputText: string,
    interactionData: InteractionData | null,
    allCharacters: Character[] = [],
    allLocations: Location[] = [],
    allContexts: Context[] = [],
    allAudioTracks: AudioTrack[] = [],
    allPromptBlocks: PromptBlock[] = [],
    allSamplers: Sampler[] = [],
    allStopPatterns: StopPattern[] = [],
    allProfiles: Profile[] = [],
    allWorlds: World[] = [],
    allMemories: Memory[] = [],
    allAccounts: Account[] = [],
    allMultiplayerData: MultiplayerData[] = [],
    localProtagonist: Character | null = null
): SlashAutocompleteComputeResult {
    const raw = inputText.trimStart();
    const isSlash = raw.startsWith('/');
    if (!isSlash) {
        return { breadcrumbs: [], options: [], isComplete: false, isSlash: false, activeIndex: 0, currentQuery: '' };
    }

    const textAfterSlash = raw.slice(1);
    const parts = textAfterSlash.split(/\s+/).filter(p => p.length > 0);
    const isTypingNewToken = inputText.endsWith(' ');
    const activeIndex = isTypingNewToken ? parts.length : Math.max(0, parts.length - 1);
    const currentQuery = (isTypingNewToken ? '' : parts[activeIndex] || '').toLowerCase();

    if (parts.length === 0) {
        return {
            breadcrumbs: [`Command (${COMMAND_TREE.length})`],
            options: COMMAND_TREE.map(c => ({ type: 'cmd' as const, value: c.name, label: c.name, id: '', desc: c.desc })),
            isComplete: false,
            isSlash: true,
            activeIndex,
            currentQuery
        };
    }

    const cmd = COMMAND_TREE.find(c => c.name === parts[0]);

    if (!cmd) {
        const filtered = COMMAND_TREE.filter(c => c.name.toLowerCase().startsWith(parts[0].toLowerCase()));
        return {
            breadcrumbs: [`Command (${filtered.length}/${COMMAND_TREE.length})`],
            options: filtered.map(c => ({ type: 'cmd' as const, value: c.name, label: c.name, id: '', desc: c.desc })),
            isComplete: false,
            isSlash: true,
            activeIndex,
            currentQuery
        };
    }

    const pastCommand = isTypingNewToken || activeIndex > 0;
    const effectiveIndex = pastCommand ? activeIndex : 1;
    const effectiveQuery = pastCommand ? currentQuery : '';

    if (effectiveIndex === 1) {
        if (cmd.subs && cmd.subs.length > 0) {
            const filtered = cmd.subs.filter(s => s.name.toLowerCase().startsWith(effectiveQuery));
            return {
                breadcrumbs: [cmd.name, `Subcommand (${filtered.length}/${cmd.subs.length})`],
                options: filtered.map(s => ({ type: 'sub' as const, value: s.name, label: s.name, id: '', desc: s.desc })),
                isComplete: false,
                isSlash: true,
                activeIndex,
                currentQuery
            };
        }

        if (cmd.args && cmd.args.length > 0) {
            const arg = cmd.args[0];
            if (arg.type === 'text') {
                const filteredByQuery = !effectiveQuery || arg.example?.toLowerCase().includes(effectiveQuery);
                const exampleOpts = filteredByQuery && arg.example
                    ? [{ type: 'example' as const, value: arg.example, label: arg.example, id: 'example', desc: `e.g. ${arg.example} — ${arg.desc}` }]
                    : [];
                return {
                    breadcrumbs: [cmd.name, `${arg.name} (text${arg.optional ? ', optional' : ''})`],
                    options: exampleOpts,
                    isComplete: false,
                    isSlash: true,
                    activeIndex,
                    currentQuery
                };
            }

            const entities = getEntityOptions(
                arg.type, interactionData, allCharacters, allLocations, allContexts,
                allAudioTracks, allPromptBlocks, allSamplers, allStopPatterns,
                allProfiles, allWorlds, allMemories, allAccounts, allMultiplayerData, localProtagonist
            );

            let queryForFilter = effectiveQuery;
            if (effectiveQuery.includes(',')) {
                const lastComma = effectiveQuery.lastIndexOf(',');
                queryForFilter = effectiveQuery.substring(lastComma + 1).trim();
            }

            const filtered = entities.filter(e =>
                e.label.toLowerCase().includes(queryForFilter.toLowerCase()) ||
                e.id.toLowerCase().includes(queryForFilter.toLowerCase()) ||
                (e.extra?.toLowerCase().includes(queryForFilter.toLowerCase()))
            );
            return {
                breadcrumbs: [cmd.name, `${arg.name} (${filtered.length}/${entities.length})`],
                options: filtered.map(e => ({
                    type: 'arg' as const,
                    value: e.value,
                    label: e.label,
                    id: e.id,
                    desc: e.extra || ''
                })),
                isComplete: false,
                isSlash: true,
                activeIndex,
                currentQuery
            };
        }

        return { breadcrumbs: [cmd.name, 'Complete ✓'], options: [], isComplete: true, isSlash: true, activeIndex, currentQuery };
    }

    const sub = cmd.subs?.find(s => s.name === parts[1]);
    const args = sub ? sub.args : cmd.args;

    if (!args || args.length === 0) {
        return { breadcrumbs: [cmd.name, ...(sub ? [sub.name] : []), 'Complete ✓'], options: [], isComplete: true, isSlash: true, activeIndex, currentQuery };
    }

    const argOffset = sub ? 2 : 1;
    const argIndex = effectiveIndex - argOffset;

    if (argIndex < args.length) {
        const arg = args[argIndex];
        const breadcrumbTrail = [cmd.name, ...(sub ? [sub.name] : [])];

        if (arg.type === 'text') {
            const filteredByQuery = !effectiveQuery || arg.example?.toLowerCase().includes(effectiveQuery);
            const exampleOpts = filteredByQuery && arg.example
                ? [{ type: 'example' as const, value: arg.example, label: arg.example, id: 'example', desc: `e.g. ${arg.example} — ${arg.desc}` }]
                : [];
            return {
                breadcrumbs: [...breadcrumbTrail, `${arg.name} (text${arg.optional ? ', optional' : ''})`],
                options: exampleOpts,
                isComplete: false,
                isSlash: true,
                activeIndex,
                currentQuery
            };
        }

        const entities = getEntityOptions(
            arg.type, interactionData, allCharacters, allLocations, allContexts,
            allAudioTracks, allPromptBlocks, allSamplers, allStopPatterns,
            allProfiles, allWorlds, allMemories, allAccounts, allMultiplayerData, localProtagonist
        );

        let queryForFilter = effectiveQuery;
        if (effectiveQuery.includes(',')) {
            const lastComma = effectiveQuery.lastIndexOf(',');
            queryForFilter = effectiveQuery.substring(lastComma + 1).trim();
        }

        const filtered = entities.filter(e =>
            e.label.toLowerCase().includes(queryForFilter.toLowerCase()) ||
            e.id.toLowerCase().includes(queryForFilter.toLowerCase()) ||
            (e.extra?.toLowerCase().includes(queryForFilter.toLowerCase()))
        );
        return {
            breadcrumbs: [...breadcrumbTrail, `${arg.name} (${filtered.length}/${entities.length}${arg.optional ? ', optional' : ''})`],
            options: filtered.map(e => ({
                type: 'arg' as const,
                value: e.value,
                label: e.label,
                id: e.id,
                desc: e.extra || ''
            })),
            isComplete: false,
            isSlash: true,
            activeIndex,
            currentQuery
        };
    }

    return { breadcrumbs: [cmd.name, ...(sub ? [sub.name] : []), 'Complete ✓'], options: [], isComplete: true, isSlash: true, activeIndex, currentQuery };
}

export function applySlashSelection(
    opt: { value: string },
    inputText: string,
    activeIndex: number
): string {
    const rawText = inputText.trimStart();
    if (!rawText.startsWith('/')) return inputText;

    const afterSlash = rawText.slice(1);
    const currentParts = afterSlash.split(/\s+/).filter(p => p.length > 0);
    const isTypingNewToken = inputText.endsWith(' ');

    let newValue = opt.value;
    let isTargetsArg = false;

    if (!isTypingNewToken && activeIndex < currentParts.length) {
        const currentPart = currentParts[activeIndex];
        const lastComma = currentPart.lastIndexOf(',');
        if (lastComma !== -1) {
            newValue = `${currentPart.substring(0, lastComma + 1)}${opt.value}`;
        }
    }

    const cmd = COMMAND_TREE.find(c => c.name === currentParts[0]);
    if (cmd) {
        const pastCommand = isTypingNewToken || activeIndex > 0;
        const effectiveIndex = pastCommand ? activeIndex : 1;
        const sub = cmd.subs?.find(s => s.name === currentParts[1]);
        const args = sub ? sub.args : cmd.args;
        const argOffset = sub ? 2 : 1;
        const argIndex = effectiveIndex - argOffset;
        if (args && argIndex >= 0 && argIndex < args.length && args[argIndex].name === 'targets') {
            isTargetsArg = true;
        }
    }

    if (isTargetsArg) {
        newValue += ',';
    }

    if (isTypingNewToken || activeIndex >= currentParts.length) {
        currentParts.push(newValue);
    } else {
        currentParts[activeIndex] = newValue;
    }

    const trailingSpace = isTargetsArg ? '' : ' ';
    return `/${currentParts.join(' ')}${trailingSpace}`;
}