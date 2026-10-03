// src/utilities/toolDetection.ts
import type { tool } from '../types';

export type ToolSecurityTier = 'in_world_readonly' | 'in_world_mutating' | 'ambient' | 'entity_admin' | 'os_privileged';

export interface ToolRule {
    tool: tool;
    label: string;
    keywords: string[];
    tier: ToolSecurityTier;
    riskDescription?: string;
}

export const TOOL_SECURITY_RULES: ToolRule[] = [
    // ═════════════════════════════════════════════════════════════════
    // TIER 1: HOST OS & HARDWARE (Critical Risk / Machine Takeover)
    // ═════════════════════════════════════════════════════════════════
    { 
        tool: 'shell', 
        label: 'Terminal / Shell Execution', 
        keywords: ['terminal', 'bash', 'powershell', 'cli', 'root', 'coder', 'developer', 'linux', 'sysadmin', 'command line'], 
        tier: 'os_privileged', 
        riskDescription: 'Allows executing arbitrary terminal scripts and commands on your host OS.' 
    },
    { 
        tool: 'virtual_input', 
        label: 'Virtual Mouse & Keyboard Takeover', 
        keywords: ['take control', 'autopilot', 'automation', 'move mouse', 'type for you', 'puppeteer', 'ai worker', 'hands'], 
        tier: 'os_privileged', 
        riskDescription: 'Physically moves your mouse cursor, clicks buttons, and types keystrokes.' 
    },
    { 
        tool: 'webcam', 
        label: 'Live Webcam Snapshot', 
        keywords: ['look at you', 'see your face', 'roommate', 'camera', 'photo of you', 'webcam', 'photographer'], 
        tier: 'os_privileged', 
        riskDescription: 'Takes live photographic snapshots through your physical webcam.' 
    },
    { 
        tool: 'lock_screen', 
        label: 'Lock Workstation', 
        keywords: ['strict', 'disciplinarian', 'nanny', 'parent', 'bossy', 'bedtime', 'curfew', 'shut down'], 
        tier: 'os_privileged', 
        riskDescription: 'Locks your desktop and drops you back to your OS login screen.' 
    },
    { 
        tool: 'sleep', 
        label: 'Host System Sleep / Hibernate', 
        keywords: ['sleep', 'hibernate', 'suspend', 'bedtime', 'rest mode', 'standby', 'nap', 'sleep mode'], 
        tier: 'os_privileged', 
        riskDescription: 'Puts the host computer into sleep, standby, or hibernation mode.' 
    },
    { 
        tool: 'shutdown', 
        label: 'Host System Power Off', 
        keywords: ['shut down', 'power off', 'turn off pc', 'shutdown', 'kill power', 'goodnight', 'turn off computer', 'shut off'], 
        tier: 'os_privileged', 
        riskDescription: 'Initiates a full shutdown sequence of the host operating system and hardware.' 
    },
    { 
        tool: 'restart', 
        label: 'Host System Restart / Reboot', 
        keywords: ['restart', 'reboot', 'restart pc', 'reboot pc', 'restart computer', 'reboot computer', 'restart system', 'reboot system'], 
        tier: 'os_privileged', 
        riskDescription: 'Initiates a full restart/reboot sequence of the host operating system and hardware.' 
    },
    { 
        tool: 'write_file', 
        label: 'Write / Create Local Files', 
        keywords: ['file writer', 'save file', 'write document', 'editor', 'code writer', 'generator'], 
        tier: 'os_privileged', 
        riskDescription: 'Can write, overwrite, or create files on your local filesystem.' 
    },
    { 
        tool: 'trash', 
        label: 'Move Files to Trash', 
        keywords: ['clean up', 'tidy', 'delete files', 'organize folders', 'maid', 'janitor', 'garbage'], 
        tier: 'os_privileged', 
        riskDescription: 'Moves files or folders on your computer into the OS Recycle Bin.' 
    },
    { 
        tool: 'clipboard', 
        label: 'Host Clipboard Read/Write', 
        keywords: ['copy paste', 'clipboard', 'share text', 'snip', 'data entry'], 
        tier: 'os_privileged', 
        riskDescription: 'Can read what you copy or overwrite your host clipboard text.' 
    },
    { 
        tool: 'hardware_control', 
        label: 'Physical USB / Serial Hardware Control', 
        keywords: ['arduino', 'raspberry pi', 'serial port', 'led', 'electronics', 'iot', 'robotics', 'breadboard'], 
        tier: 'os_privileged', 
        riskDescription: 'Communicates with physical devices, microcontrollers, and circuits over USB.' 
    },

    // ═════════════════════════════════════════════════════════════════
    // TIER 2: APP & ENTITY ADMINISTRATION (In-App Database Control)
    // ═════════════════════════════════════════════════════════════════
    { 
        tool: 'administrator', 
        label: 'Session & Model Administrator', 
        keywords: ['admin', 'moderator', 'system manager', 'superadmin', 'controller'], 
        tier: 'entity_admin', 
        riskDescription: 'Can switch active AI models, transfer chats, and manage session configurations.' 
    },
    { 
        tool: 'creator', 
        label: 'Create World & App Entities', 
        keywords: ['creator', 'architect', 'world builder', 'god', 'maker', 'forge'], 
        tier: 'entity_admin', 
        riskDescription: 'Creates new characters, locations, worlds, prompt blocks, or contexts in LoreReactor.' 
    },
    { 
        tool: 'destroyer', 
        label: 'Delete World & App Entities', 
        keywords: ['destroyer', 'delete world', 'eradicate', 'obliterate', 'purge', 'reaper'], 
        tier: 'entity_admin', 
        riskDescription: 'Can permanently delete characters, locations, worlds, or contexts inside LoreReactor.' 
    },

    // ═════════════════════════════════════════════════════════════════
    // TIER 3: AMBIENT SENSORS & WEB (Read-Only Telemetry & Audio)
    // ═════════════════════════════════════════════════════════════════
    { tool: 'window_monitor', label: 'Active Window Focus Monitor', keywords: ['assistant', 'companion', 'roommate', 'secretary', 'overseer', 'hacker', 'ai', 'monitor'], tier: 'ambient', riskDescription: 'Detects the title of the software or browser tab you currently have focused.' },
    { tool: 'process_monitor', label: 'Task & Process Monitor', keywords: ['technician', 'sysadmin', 'debugger', 'engineer', 'diagnostics', 'task manager'], tier: 'ambient', riskDescription: 'Inspects running background applications and CPU/RAM usage.' },
    { tool: 'file_watcher', label: 'Real-Time Filesystem Watcher', keywords: ['watch folder', 'workspace', 'project monitor', 'code assistant', 'folder watcher'], tier: 'ambient', riskDescription: 'Monitors directories for file additions, edits, or removals in real-time.' },
    { tool: 'network_scanner', label: 'Local Wi-Fi Network Discovery', keywords: ['network', 'scanner', 'detect devices', 'iot', 'security', 'lan', 'wifi'], tier: 'ambient', riskDescription: 'Scans the local router for connected phones and computers.' },
    { tool: 'screenshot', label: 'Desktop Screen Capture', keywords: ['screen', 'see screen', 'display', 'visual assistant', 'screenshot', 'monitor'], tier: 'ambient', riskDescription: 'Captures full screenshots of your desktop monitor.' },
    { tool: 'text_to_speech', label: 'Voice Text-to-Speech Output', keywords: ['voice', 'speak aloud', 'talking', 'speech', 'vocal', 'audible'], tier: 'ambient', riskDescription: 'Speaks dialogue out loud through your computer speakers.' },
    { tool: 'volume_control', label: 'Master Volume Control', keywords: ['dj', 'sound engineer', 'loud', 'music', 'sound', 'audio volume', 'speaker'], tier: 'ambient', riskDescription: 'Can adjust your computer master audio volume or toggle mute.' },
    { tool: 'notify', label: 'Native OS Desktop Notifications', keywords: ['alarm', 'reminder', 'assistant', 'secretary', 'butler', 'alert', 'notifier'], tier: 'ambient', riskDescription: 'Fires desktop pop-up notifications to your OS notification center.' },
    { tool: 'schedule_response', label: 'Autonomous Follow-up Scheduler', keywords: ['check in later', 'remind me', 'follow up', 'wake me up', 'autonomous', 'ping me later', 'check back', 'schedule response'], tier: 'ambient', riskDescription: 'Schedules the AI to autonomously generate a follow-up response after a specified delay.' },
    { tool: 'web', label: 'Web Search & Link Fetcher', keywords: ['researcher', 'search', 'investigator', 'journalist', 'curious', 'internet', 'google', 'web'], tier: 'ambient', riskDescription: 'Fetches content from the live web and searches the internet.' },
    { tool: 'browser', label: 'Open Webpage in Default Browser', keywords: ['browse', 'web surfer', 'open links', 'researcher', 'explorer'], tier: 'ambient', riskDescription: 'Launches your default web browser to visit specific URLs.' },
    { tool: 'read_file', label: 'Read / Open Local Target', keywords: ['file viewer', 'reader', 'document viewer', 'file reader'], tier: 'ambient', riskDescription: 'Opens local files, videos, or directories in their default OS apps.' },
    { tool: 'system_info', label: 'CPU & RAM Telemetry', keywords: ['hardware', 'specs', 'cpu', 'ram', 'system stats', 'pc builder'], tier: 'ambient', riskDescription: 'Queries CPU load, available RAM, and hardware specs.' },
    { tool: 'gpu', label: 'GPU VRAM & Temperature Telemetry', keywords: ['gpu', 'vram', 'graphics card', 'nvidia', 'amd', 'temperature', 'benchmark'], tier: 'ambient', riskDescription: 'Queries local GPU utilization, VRAM usage, and temperatures.' },

    // ═════════════════════════════════════════════════════════════════
    // TIER 4: IN-WORLD STATE MUTATORS (Alters Inventories, State, & Locks)
    // ═════════════════════════════════════════════════════════════════
    { tool: 'inventory', label: 'Character Inventory Management', keywords: ['adventurer', 'rpg', 'warrior', 'traveler', 'collector', 'pack', 'inventory'], tier: 'in_world_mutating', riskDescription: 'Modifies character items, adds or removes inventory counts.' },
    { tool: 'trade', label: 'Item Barter & Trading', keywords: ['merchant', 'trader', 'shopkeeper', 'barter', 'vendor', 'store', 'trade'], tier: 'in_world_mutating', riskDescription: 'Transfers items between participants and creates trade offers.' },
    { tool: 'key', label: 'Location Lock & Unlock', keywords: ['guard', 'jailer', 'warden', 'thief', 'locksmith', 'innkeeper', 'bouncer', 'lock'], tier: 'in_world_mutating', riskDescription: 'Locks or unlocks physical rooms and location access.' },
    { tool: 'clothing', label: 'Wardrobe & Outfit Changing', keywords: ['fashion', 'tailor', 'costume', 'outfit', 'dress', 'model', 'wear', 'remove clothing'], tier: 'in_world_mutating', riskDescription: 'Changes what clothing items the character is actively wearing.' },
    { tool: 'move', label: 'Adjacent Location Movement', keywords: ['walk', 'travel', 'wander', 'journey', 'patrol', 'explore', 'move'], tier: 'in_world_mutating', riskDescription: 'Moves the character to an adjacent location on the map.' },
    { tool: 'teleport', label: 'Instant Location Teleport', keywords: ['sorcerer', 'teleport', 'portal', 'blink', 'dimensional', 'mage'], tier: 'in_world_mutating', riskDescription: 'Instantly moves the character across the world map bypassing adjacency.' },
    { tool: 'timer', label: 'Countdown Timers', keywords: ['timer', 'countdown', 'alarm', 'cook', 'chef', 'baker'], tier: 'in_world_mutating', riskDescription: 'Saves active countdown timers into the character inventory state.' },
    { tool: 'stopwatch', label: 'Stopwatch Counters', keywords: ['stopwatch', 'speedrunner', 'coach', 'trainer', 'athlete', 'timing'], tier: 'in_world_mutating', riskDescription: 'Starts, pauses, and tracks stopwatch elapsed time states.' },
    { tool: 'schedule', label: 'Action Scheduler', keywords: ['schedule', 'planner', 'organizer', 'calendar', 'timetable', 'routine'], tier: 'in_world_mutating', riskDescription: 'Schedules automated future actions and repeating triggers.' },
    { tool: 'note', label: 'Persistent Character Notes', keywords: ['scribe', 'secretary', 'scholar', 'writer', 'diary', 'journal', 'notebook'], tier: 'in_world_mutating', riskDescription: 'Writes and saves persistent text notes into character inventory storage.' },
    { tool: 'summon', label: 'Summon Non-Participant', keywords: ['summon', 'conjure', 'call upon', 'necromancer', 'summoner'], tier: 'in_world_mutating', riskDescription: 'Adds a non-participant character into the active session.' },
    { tool: 'invite', label: 'Invite Participant to Room', keywords: ['invite', 'welcome', 'bring over', 'gather', 'call'], tier: 'in_world_mutating', riskDescription: 'Brings an existing session participant to your current location.' },
    { tool: 'kick', label: 'Eject Participant from Room', keywords: ['kick', 'eject', 'banish', 'dismiss', 'expel', 'bouncer'], tier: 'in_world_mutating', riskDescription: 'Ejects a participant out of your current location.' },

    // ═════════════════════════════════════════════════════════════════
    // TIER 5: IN-WORLD READ-ONLY NARRATIVE (Pure Cognitive & Dice)
    // ═════════════════════════════════════════════════════════════════
    { tool: 'oracle', label: 'Spatial Timeline Scryer', keywords: ['seer', 'oracle', 'clairvoyant', 'psychic', 'diviner', 'all-seeing', 'prophet', 'mystic'], tier: 'in_world_readonly' },
    { tool: 'dice', label: 'Dice Roller', keywords: ['gambler', 'rogue', 'game', 'dnd', 'casino', 'luck', 'chance', 'roll'], tier: 'in_world_readonly' },
    { tool: 'coin', label: 'Coin Flip', keywords: ['gamble', 'coin', 'flip', 'fifty fifty', 'toss'], tier: 'in_world_readonly' },
    { tool: 'audio', label: 'In-World Audio Track Control', keywords: ['bard', 'musician', 'singer', 'dj', 'performer', 'music', 'soundtrack'], tier: 'in_world_readonly' },
    { tool: 'calculator', label: 'Math Calculator', keywords: ['mathematician', 'accountant', 'calculator', 'scholar', 'scientist', 'finance'], tier: 'in_world_readonly' },
    { tool: 'clock', label: 'In-World Clock', keywords: ['clock', 'time', 'punctual', 'watch', 'timekeeper'], tier: 'in_world_readonly' },
    { tool: 'calendar', label: 'In-World Calendar', keywords: ['calendar', 'date', 'month', 'year', 'day', 'seasons'], tier: 'in_world_readonly' },
    { tool: 'random', label: 'Random Number Generator', keywords: ['random', 'chance', 'rng', 'probability', 'shuffle'], tier: 'in_world_readonly' },
    { tool: 'rng', label: 'Context RNG Table Roller', keywords: ['table', 'roll table', 'loot table', 'rng table', 'encounter table'], tier: 'in_world_readonly' },
    { tool: 'pick', label: 'Random Pick from Options', keywords: ['pick', 'decide', 'indecisive', 'choose', 'options'], tier: 'in_world_readonly' },
    { tool: 'whisper', label: 'Private Whisper Messages', keywords: ['secret', 'confidential', 'quiet', 'whisper', 'private', 'stealth'], tier: 'in_world_readonly' },
    { tool: 'think', label: 'Internal Chain of Thought', keywords: ['methodical', 'calculating', 'thoughtful', 'analytical', 'strategist', 'plan'], tier: 'in_world_readonly' },
    { tool: 'lookup', label: 'Context & Lore Keyword Lookup', keywords: ['lore', 'lookup', 'research', 'search', 'encyclopedia', 'book'], tier: 'in_world_readonly' },
    { tool: 'map', label: 'Location Distance Map', keywords: ['map', 'navigator', 'cartographer', 'scout', 'guide', 'distance'], tier: 'in_world_readonly' },
    { tool: 'dialogue', label: 'Sample Dialogue Prompts', keywords: ['dialogue', 'speech style', 'mannerisms', 'quotes'], tier: 'in_world_readonly' },
    { tool: 'knowledge', label: 'Knowledge Base Access', keywords: ['knowledge', 'encyclopedia', 'archive', 'historian', 'wise', 'mentor'], tier: 'in_world_readonly' },
    { tool: 'memory', label: 'Long-Term Memory Management', keywords: ['memory', 'remember', 'recall', 'reminisce', 'nostalgia'], tier: 'in_world_readonly' },
    { tool: 'narrate', label: 'Ambient Narration Injection', keywords: ['narrator', 'storyteller', 'dungeon master', 'author', 'chronicler'], tier: 'in_world_readonly' },
    { tool: 'inspect', label: 'Inspect Character State', keywords: ['detective', 'inspector', 'analyst', 'investigator', 'scrutinizing', 'examine'], tier: 'in_world_readonly' },
];

export interface DetectedToolsResult {
    inWorldReadonly: ToolRule[];
    inWorldMutating: ToolRule[];
    ambient: ToolRule[];
    entityAdmin: ToolRule[];
    osPrivileged: ToolRule[];
    allDetected: ToolRule[];
}

export function detectToolsFromText(text: string): DetectedToolsResult {
    const lower = text.toLowerCase();
    const inWorldReadonly = new Map<tool, ToolRule>();
    const inWorldMutating = new Map<tool, ToolRule>();
    const ambient = new Map<tool, ToolRule>();
    const entityAdmin = new Map<tool, ToolRule>();
    const osPrivileged = new Map<tool, ToolRule>();

    for (const rule of TOOL_SECURITY_RULES) {
        if (rule.keywords.some(kw => lower.includes(kw))) {
            if (rule.tier === 'os_privileged') osPrivileged.set(rule.tool, rule);
            else if (rule.tier === 'entity_admin') entityAdmin.set(rule.tool, rule);
            else if (rule.tier === 'ambient') ambient.set(rule.tool, rule);
            else if (rule.tier === 'in_world_mutating') inWorldMutating.set(rule.tool, rule);
            else inWorldReadonly.set(rule.tool, rule);
        }
    }

    const roArr = Array.from(inWorldReadonly.values());
    const mutArr = Array.from(inWorldMutating.values());
    const ambArr = Array.from(ambient.values());
    const adminArr = Array.from(entityAdmin.values());
    const privArr = Array.from(osPrivileged.values());

    return {
        inWorldReadonly: roArr,
        inWorldMutating: mutArr,
        ambient: ambArr,
        entityAdmin: adminArr,
        osPrivileged: privArr,
        allDetected: [...roArr, ...mutArr, ...ambArr, ...adminArr, ...privArr],
    };
}