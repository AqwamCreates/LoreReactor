// src/frontend_src/services/ToolExecutor.ts
import type { ToolInvocation } from './ToolInvocationParser';
import { fetchLinkContent } from '../utilities/linkFetcher';
import { collectActiveDialoguePromptContent, buildDialogueSearchSpace, getActiveDialoguePrompts } from '../utilities/dialoguePromptLogic';
import { isEntityActiveWithCache, type TriggerEvaluationContext, type CombinationCache } from '../utilities/triggerLogic';
import {
    getUniversalMessageFilterFlags,
    getVisibleMessagesInPerspective,
    parseAttachmentDataUrl,
    type EphemeralVisualAttachment,
} from '../utilities/promptLogic';
import type {
    BaseMessage, Character, Context, Location, AudioTrack, Profile,
    InteractionData, Inventory, ChatMessage, WhisperMessage, TextMessage,
    PromptBlock, StopPattern, TokenSampler, BudgetStrategy, World, Memory,
    Extension, Account, MultiplayerData, toolUsageDisplayMode, ToolMessage,
    tool, EntityFolder, RawInteractionData, RetrievalConfiguration, LanguageModel, SpatiotemporalModel,
    entityType, ActiveToolActions, PendingToolAction, pendingToolActionType,
    TimerEntry, StopwatchEntry, ScheduleEntry, ScheduledResponseEntry, TradeOffer
} from '../types';
import { findLatestMessage, createMessage } from '../utilities/messageLogic';
import { getGlobalMessageHistory, getLocalMessageHistory, getLocationMessageHistory } from '../utilities/timelineLogic';
import { getCurrentLocation, getReachableLocationsByCharacter, isCharacterLockedFromLocation, getCoLocatedParticipants } from '../utilities/locationLogic';
import { isToolEnabled } from '../utilities/characterLogic';
import { getAudioEngine } from './AudioEngine';
import { generateCharacterMemory } from './TextMessageSummarizationEngine';
import { saveRawCharacter } from '../storages/serverStorage';
import { v4 as uuidv4 } from 'uuid';
import { speakText, stopSpeech, getSystemInfo, sendDesktopNotification, controlVolume, lockScreen, setSystemPower, clipboardAction, captureScreenshot, scanLocalNetwork, startFileWatcher, getFileWatcherEvents, getActiveWindowInfo, getRunningProcesses, moveToTrash, writeFile, readFile, runShellCommand, captureVirtualHearing, captureVirtualVision, sendVirtualInput, sendVirtualController, getHardwarePorts, sendHardwareCommand } from '../utilities/serverTools';
import { buildSearchUrl } from '../utilities/searchURLBuilder';
import { generateSkyViewText, getTimeDataFromCoordinates, type TimeData } from './LocationEngine';
import { localURL } from '../../configurations';
import { embeddingEngine } from './EmbeddingEngine';
import { retrieveRelevantContext, type RetrievableItem } from './RetrievalEngine';
import { retrieveEligibleMemories, detokenizeMemoryContent } from '../utilities/memoryLogic';
import { toolCallEndString, toolCallStartString, toolResultEndString, toolResultStartString } from '../dictionaries/stringList';
import { computeMovementCost } from '../utilities/dynamicCharacterLogic';

export type {
    PendingToolAction, pendingToolActionType, ActiveToolActions,
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
    allSpatiotemporalModels: SpatiotemporalModel[];
    allTokenSamplers: TokenSampler[];
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

type ToolCarrierMessage = BaseMessage & {
    _ephemeralVisuals?: EphemeralVisualAttachment[];
};

function pushEphemeralVisual(nextMessage: BaseMessage, visual: EphemeralVisualAttachment): void {
    const carrier = nextMessage as ToolCarrierMessage;
    if (!carrier._ephemeralVisuals) {
        carrier._ephemeralVisuals = [];
    }
    carrier._ephemeralVisuals.push(visual);
}

export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export interface JsonSchemaProperty {
    type: JsonSchemaType | readonly JsonSchemaType[];
    description?: string;
    enum?: readonly (string | number | boolean)[];
    default?: unknown;
    items?: { type: JsonSchemaType };
    additionalProperties?: boolean | { type: JsonSchemaType };
    minimum?: number;
    maximum?: number;
}

export interface ToolInputSchema {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: readonly string[];
    additionalProperties?: boolean;
}

export interface ToolDefinition {
    name: tool;
    description: string;
    inputSchema: ToolInputSchema;
    examples: Record<string, unknown>[];
    defaultAction?: string;
    actionRequired?: Record<string, readonly string[]>;
}

export const VALID_ENTITY_TYPES: entityType[] = [
    'character', 'context', 'location', 'audioTrack', 'world',
    'interactionData', 'languageModel', 'spatiotemporalModel', 'tokenSampler', 'promptBlock', 'stopPattern',
    'retrievalConfiguration', 'budgetStrategy', 'profile', 'account',
    'multiplayerData', 'entityFolder'
];

export function normalizeEntityType(raw: string): entityType | null {
    if (!raw) return null;
    const cleaned = raw.toLowerCase().replace(/[-_\s]/g, '');
    const map: Record<string, entityType> = {
        character: 'character', characters: 'character',
        context: 'context', contexts: 'context',
        location: 'location', locations: 'location',
        audiotrack: 'audioTrack', audiotracks: 'audioTrack', audio: 'audioTrack',
        world: 'world', worlds: 'world',
        interactiondata: 'interactionData', interactiondatas: 'interactionData',
        session: 'interactionData', sessions: 'interactionData',
        chat: 'interactionData', chats: 'interactionData',
        model: 'languageModel', models: 'languageModel',
        languagemodel: 'languageModel', languagemodels: 'languageModel',
        spatiotemporalmodel: 'spatiotemporalModel', spatiotemporalmodels: 'spatiotemporalModel',
        imagemodel: 'spatiotemporalModel', imagemodels: 'spatiotemporalModel',
        videomodel: 'spatiotemporalModel', videomodels: 'spatiotemporalModel',
        tokensampler: 'tokenSampler', tokensamplers: 'tokenSampler',
        promptblock: 'promptBlock', promptblocks: 'promptBlock',
        stoppattern: 'stopPattern', stoppatterns: 'stopPattern',
        retrievalconfiguration: 'retrievalConfiguration', retrievalconfigurations: 'retrievalConfiguration',
        budgetstrategy: 'budgetStrategy', budgetstrategies: 'budgetStrategy',
        profile: 'profile', profiles: 'profile',
        account: 'account', accounts: 'account',
        multiplayerdata: 'multiplayerData', multiplayerdatas: 'multiplayerData',
        entityfolder: 'entityFolder', entityfolders: 'entityFolder',
        folder: 'entityFolder', folders: 'entityFolder',
    };
    return map[cleaned] ?? null;
}

const EX_CHAR = '550e8400-e29b-41d4-a716-446655440000';
const EX_LOC = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const EX_LOC_2 = '7c9e6679-7425-40de-944b-e07fc1f90ae8';
const EX_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

export const TOOL_DEFINITIONS: Record<tool, ToolDefinition> = {
    file_search: {
        name: 'file_search',
        description: 'List, read, or search files attached by any character visible in your local chat history perspective. Only call when files are attached or referenced.',
        defaultAction: 'list',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'read', 'search'], default: 'list' },
                query: { type: 'string', description: 'Filename, 1-based attachment index, message UUID, or text query to search for.' },
                character_id: { type: 'string', description: 'Optional character UUID to filter attachments by sender.' },
                offset: { type: 'integer', minimum: 0, default: 0, description: 'Character offset when reading large text files.' },
                limit: { type: 'integer', minimum: 1, default: 4000, description: 'Maximum characters to return when reading text files.' },
            },
            additionalProperties: false,
        },
        actionRequired: { list: [], read: ['query'], search: ['query'] },
        examples: [
            { action: 'list' },
            { action: 'read', query: 'notes.txt' },
            { action: 'search', query: 'secret_key' },
        ],
    },
    whisper: {
        name: 'whisper',
        description: 'Send private message visible only to target character UUID(s), or list character UUIDs.',
        defaultAction: 'send',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['send', 'list'], default: 'send' },
                target_character_ids: { type: 'array', items: { type: 'string' }, description: 'Recipient character UUIDs.' },
                text: { type: 'string', description: 'Private message content.' },
            },
            additionalProperties: false,
        },
        actionRequired: { send: ['target_character_ids', 'text'], list: [] },
        examples: [{ action: 'list' }, { target_character_ids: [EX_CHAR], text: 'Meet me outside in five minutes.' }],
    },
    think: {
        name: 'think',
        description: 'Evaluate context and plan next move internally.',
        inputSchema: { type: 'object', properties: { reasoning: { type: 'string' } }, required: ['reasoning'], additionalProperties: false },
        examples: [{ reasoning: 'She looks hesitant; I should ask carefully.' }],
    },
    pick: {
        name: 'pick',
        description: 'Randomly pick one option from a list.',
        inputSchema: { type: 'object', properties: { options: { type: 'array', items: { type: 'string' } } }, required: ['options'], additionalProperties: false },
        examples: [{ options: ['left corridor', 'right staircase', 'wait'] }],
    },
    sky_view: {
        name: 'sky_view',
        description: 'View the sky at the current location.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    clock: {
        name: 'clock',
        description: 'Get current time at character location.',
        inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['12h', '24h', 'unix'], default: '12h' } }, additionalProperties: false },
        examples: [{}, { format: '24h' }],
    },
    calendar: {
        name: 'calendar',
        description: 'Get current date and time at character location.',
        inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['full', 'date', 'time', 'iso', 'unix'], default: 'full' } }, additionalProperties: false },
        examples: [{}, { format: 'date' }],
    },
    coin: {
        name: 'coin',
        description: 'Flip a coin (Heads or Tails).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    dice: {
        name: 'dice',
        description: 'Roll dice using notation (e.g. "2d6+3") or count/sides/modifier.',
        inputSchema: {
            type: 'object',
            properties: {
                notation: { type: 'string', description: 'e.g. "2d6+3"' },
                count: { type: 'integer', minimum: 1 },
                sides: { type: 'integer', minimum: 1 },
                modifier: { type: 'integer' },
            },
            additionalProperties: false,
        },
        examples: [{ notation: '2d6+3' }, { count: 1, sides: 20, modifier: 2 }],
    },
    random: {
        name: 'random',
        description: 'Generate a random integer between min and max.',
        inputSchema: { type: 'object', properties: { min: { type: 'integer', default: 1 }, max: { type: 'integer', default: 100 } }, additionalProperties: false },
        examples: [{ min: 1, max: 100 }],
    },
    rng: {
        name: 'rng',
        description: 'Roll on a named RNG table defined in contexts by context UUID, or list available RNG table UUIDs.',
        defaultAction: 'roll',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['roll', 'list'], default: 'roll' },
                table_context_id: { type: 'string', description: 'Context UUID.' },
            },
            additionalProperties: false,
        },
        actionRequired: { roll: ['table_context_id'], list: [] },
        examples: [{ action: 'list' }, { table_context_id: EX_ID }],
    },
    move: {
        name: 'move',
        description: 'Move character to an adjacent location UUID, or list reachable location UUIDs.',
        defaultAction: 'move',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['move', 'list'], default: 'move' },
                location_id: { type: 'string', description: 'Target adjacent location UUID.' },
                quiet_leave: { type: 'boolean', default: false },
                quiet_enter: { type: 'boolean', default: false },
            },
            additionalProperties: false,
        },
        actionRequired: { move: ['location_id'], list: [] },
        examples: [{ action: 'list' }, { location_id: EX_LOC, quiet_leave: false, quiet_enter: false }],
    },
    timer: {
        name: 'timer',
        description: 'Manage countdown timers.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['set', 'check', 'delete', 'list'] },
                name: { type: 'string' },
                duration: { type: 'string', description: 'e.g. "5m", "1h30m", "45s"' },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { set: ['name', 'duration'], delete: ['name'], check: [], list: [] },
        examples: [{ action: 'set', name: 'Kettle', duration: '5m' }, { action: 'check', name: 'Kettle' }],
    },
    stopwatch: {
        name: 'stopwatch',
        description: 'Manage stopwatch counters.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['start', 'stop', 'pause', 'resume', 'reset', 'check', 'list'] }, name: { type: 'string' } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { start: ['name'], stop: ['name'], pause: ['name'], resume: ['name'], reset: ['name'], check: [], list: [] },
        examples: [{ action: 'start', name: 'Sprint' }, { action: 'check', name: 'Sprint' }],
    },
    schedule: {
        name: 'schedule',
        description: 'Schedule automated actions.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['set', 'set_repeat', 'cancel', 'cancel_all', 'list'] },
                name: { type: 'string' },
                duration: { type: 'string' },
                interval: { type: 'string' },
                action_desc: { type: 'string' },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { set: ['name', 'duration', 'action_desc'], set_repeat: ['name', 'interval', 'action_desc'], cancel: ['name'], cancel_all: [], list: [] },
        examples: [{ action: 'set', name: 'Patrol', duration: '1h', action_desc: 'Guard starts patrol' }, { action: 'list' }],
    },
    calculator: {
        name: 'calculator',
        description: 'Evaluate mathematical expression.',
        inputSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'], additionalProperties: false },
        examples: [{ expression: '(15 * 7) + 3' }],
    },
    web: {
        name: 'web',
        description: 'Search the web or fetch a URL.',
        inputSchema: { type: 'object', properties: { url_or_search_query: { type: 'string' } }, required: ['url_or_search_query'], additionalProperties: false },
        examples: [{ url_or_search_query: 'https://example.com' }],
    },
    dialogue: {
        name: 'dialogue',
        description: 'Manage dialogue prompts by UUID.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['list', 'recall'] }, prompt_id: { type: 'string', description: 'Dialogue prompt UUID.' } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { list: [], recall: ['prompt_id'] },
        examples: [{ action: 'list' }, { action: 'recall', prompt_id: EX_ID }],
    },
    knowledge: {
        name: 'knowledge',
        description: 'Inspect character knowledge base by UUID or semantic query.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'recall', 'fuzzy_recall'] },
                knowledge_id: { type: 'string', description: 'Knowledge prompt UUID.' },
                query: { type: 'string' },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { list: [], recall: ['knowledge_id'], fuzzy_recall: ['query'] },
        examples: [{ action: 'list' }, { action: 'recall', knowledge_id: EX_ID }, { action: 'fuzzy_recall', query: 'northern treaty' }],
    },
    memory: {
        name: 'memory',
        description: 'Manage persistent character memories by UUID.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['list', 'recall', 'save'] }, memory_id: { type: 'string', description: 'Memory UUID.' } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { list: [], recall: [], save: [] },
        examples: [{ action: 'list' }, { action: 'recall', memory_id: EX_ID }],
    },
    lookup: {
        name: 'lookup',
        description: 'Search contexts and world lore for keywords.',
        inputSchema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'], additionalProperties: false },
        examples: [{ keyword: 'gatekeeper' }],
    },
    map: {
        name: 'map',
        description: 'Calculate distance between location UUIDs, or list location UUIDs.',
        defaultAction: 'distance',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['distance', 'list'], default: 'distance' },
                to_location_id: { type: 'string', description: 'Destination location UUID.' },
                from_location_id: { type: 'string', description: 'Origin location UUID.' },
            },
            additionalProperties: false,
        },
        actionRequired: { distance: ['to_location_id'], list: [] },
        examples: [{ action: 'list' }, { to_location_id: EX_LOC, from_location_id: EX_LOC_2 }],
    },
    audio: {
        name: 'audio',
        description: 'Manage background audio playback by track UUID, or list track UUIDs.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['play', 'stop', 'list'] }, track_id: { type: 'string', description: 'AudioTrack UUID.' } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { play: ['track_id'], stop: [], list: [] },
        examples: [{ action: 'list' }, { action: 'play', track_id: EX_ID }],
    },
    note: {
        name: 'note',
        description: 'Manage persistent character notes.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['set', 'get', 'delete', 'list'] }, key: { type: 'string' }, text: { type: 'string' } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { set: ['key', 'text'], get: ['key'], delete: ['key'], list: [] },
        examples: [{ action: 'set', key: 'door_code', text: '4819' }, { action: 'list' }],
    },
    inventory: {
        name: 'inventory',
        description: 'Manage character inventory items.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'add', 'remove', 'set'] },
                item: { type: 'string' },
                qty: { type: 'number', default: 1 },
                value: { type: ['string', 'number'] },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { list: [], add: ['item'], remove: ['item'], set: ['item', 'value'] },
        examples: [{ action: 'list' }, { action: 'add', item: 'Brass Key', qty: 1 }],
    },
    trade: {
        name: 'trade',
        description: 'Transfer items or manage trade offers with character UUIDs.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['give', 'take', 'offer', 'accept', 'decline', 'list_offers', 'list_characters'] },
                target_character_id: { type: 'string', description: 'Target character UUID.' },
                item: { type: 'string' },
                qty: { type: 'number', default: 1 },
                give_items: { type: 'object', additionalProperties: { type: 'number' } },
                take_items: { type: 'object', additionalProperties: { type: 'number' } },
                offer_id: { type: 'string' },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: {
            give: ['target_character_id', 'item'],
            take: ['target_character_id', 'item'],
            offer: ['target_character_id', 'give_items', 'take_items'],
            accept: ['offer_id'],
            decline: ['offer_id'],
            list_offers: [],
            list_characters: [],
        },
        examples: [
            { action: 'list_characters' },
            { action: 'give', target_character_id: EX_CHAR, item: 'Health Potion', qty: 1 },
            { action: 'offer', target_character_id: EX_CHAR, give_items: { 'Iron Sword': 1 }, take_items: { 'Gold Coin': 50 } },
        ],
    },
    invite: {
        name: 'invite',
        description: 'Bring existing participant UUID to current location, or list participant UUIDs.',
        defaultAction: 'invite',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['invite', 'list'], default: 'invite' }, character_id: { type: 'string', description: 'Character UUID.' } },
            additionalProperties: false,
        },
        actionRequired: { invite: ['character_id'], list: [] },
        examples: [{ action: 'list' }, { character_id: EX_CHAR }],
    },
    kick: {
        name: 'kick',
        description: 'Eject co-located character UUID from location, or list co-located character / reachable location UUIDs.',
        defaultAction: 'kick',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['kick', 'list_characters', 'list_locations'], default: 'kick' },
                character_id: { type: 'string', description: 'Co-located character UUID.' },
                destination_location_id: { type: 'string', description: 'Optional adjacent location UUID.' },
                quiet_leave: { type: 'boolean', default: false },
                quiet_enter: { type: 'boolean', default: false },
            },
            additionalProperties: false,
        },
        actionRequired: { kick: ['character_id'], list_characters: [], list_locations: [] },
        examples: [{ action: 'list_characters' }, { character_id: EX_CHAR, destination_location_id: EX_LOC }],
    },
    mind_reader: {
        name: 'mind_reader',
        description: 'Read recent internal thoughts of a target character UUID, or list character UUIDs.',
        defaultAction: 'read',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['read', 'list'], default: 'read' },
                character_id: { type: 'string', description: 'Target character UUID.' },
                limit: { type: 'integer', minimum: 1, default: 1 },
            },
            additionalProperties: false,
        },
        actionRequired: { read: ['character_id'], list: [] },
        examples: [{ action: 'list' }, { character_id: EX_CHAR, limit: 2 }],
    },
    oracle: {
        name: 'oracle',
        description: 'Peer into a remote location UUID, or list location UUIDs.',
        defaultAction: 'scry',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['scry', 'list'], default: 'scry' },
                location_id: { type: 'string', description: 'Target location UUID.' },
                limit: { type: 'integer', minimum: 1, default: 5 },
            },
            additionalProperties: false,
        },
        actionRequired: { scry: ['location_id'], list: [] },
        examples: [{ action: 'list' }, { location_id: EX_LOC, limit: 5 }],
    },
    teleport: {
        name: 'teleport',
        description: 'Instantly move character to any location UUID, or list location UUIDs.',
        defaultAction: 'teleport',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['teleport', 'list'], default: 'teleport' },
                location_id: { type: 'string', description: 'Destination location UUID.' },
                quiet_leave: { type: 'boolean', default: false },
                quiet_enter: { type: 'boolean', default: false },
            },
            additionalProperties: false,
        },
        actionRequired: { teleport: ['location_id'], list: [] },
        examples: [{ action: 'list' }, { location_id: EX_LOC }],
    },
    key: {
        name: 'key',
        description: 'Lock or unlock location UUIDs for specific character UUIDs, or list UUIDs.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['lock', 'unlock', 'list'] },
                location_id: { type: 'string', description: 'Location UUID.' },
                character_id: { type: 'string', description: 'Optional character UUID.' },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { lock: ['location_id'], unlock: ['location_id'], list: [] },
        examples: [{ action: 'list' }, { action: 'lock', location_id: EX_LOC, character_id: EX_CHAR }],
    },
    clothing: {
        name: 'clothing',
        description: 'Manage worn clothing items by character UUID and clothing UUID.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['wear', 'remove', 'list'] },
                character_id: { type: 'string', description: 'Character UUID.' },
                clothing_id: { type: 'string', description: 'Clothing UUID.' },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { wear: ['character_id', 'clothing_id'], remove: ['character_id', 'clothing_id'], list: [] },
        examples: [{ action: 'list', character_id: EX_CHAR }, { action: 'wear', character_id: EX_CHAR, clothing_id: EX_ID }],
    },
    summon: {
        name: 'summon',
        description: 'Add a non-participant character UUID to current session, or list summonable character UUIDs.',
        defaultAction: 'summon',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['summon', 'list'], default: 'summon' }, character_id: { type: 'string', description: 'Character UUID.' } },
            additionalProperties: false,
        },
        actionRequired: { summon: ['character_id'], list: [] },
        examples: [{ action: 'list' }, { character_id: EX_CHAR }],
    },
    unsummon: {
        name: 'unsummon',
        description: 'Remove a participant character UUID from current session, or list unsummonable participant UUIDs.',
        defaultAction: 'unsummon',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['unsummon', 'list'], default: 'unsummon' }, character_id: { type: 'string', description: 'Character UUID.' } },
            additionalProperties: false,
        },
        actionRequired: { unsummon: ['character_id'], list: [] },
        examples: [{ action: 'list' }, { character_id: EX_CHAR }],
    },
    narrate: {
        name: 'narrate',
        description: 'Inject ambient narration without consuming chat stamina.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
        examples: [{ text: 'Distant thunder rolls across the valley.' }],
    },
    substrate: {
        name: 'substrate',
        description: 'Invoke substrate.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    inspect: {
        name: 'inspect',
        description: "Examine character's visible state by character UUID, or list character UUIDs.",
        defaultAction: 'inspect',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['inspect', 'list'], default: 'inspect' }, character_id: { type: 'string', description: 'Character UUID.' } },
            additionalProperties: false,
        },
        actionRequired: { inspect: ['character_id'], list: [] },
        examples: [{ action: 'list' }, { character_id: EX_CHAR }],
    },
    administrator: {
        name: 'administrator',
        description: 'Manage and inspect all system entities and settings by UUID.',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list_entities', 'view_entity', 'edit_entity', 'add_to_entity_folder', 'remove_from_entity_folder', 'list_chats', 'switch_model', 'toggle_account', 'join_session', 'leave_session', 'accept_join', 'reject_join'],
                },
                entity_type: { type: 'string', enum: VALID_ENTITY_TYPES },
                entity_id: { type: 'string', description: 'Entity UUID.' },
                field: { type: 'string' },
                value: { type: ['string', 'number', 'boolean', 'object', 'array'] },
                entity_folder_id: { type: 'string', description: 'EntityFolder UUID.' },
                item_id: { type: 'string', description: 'Item UUID.' },
                model_id: { type: 'string', description: 'LanguageModel UUID.' },
                account_id: { type: 'string', description: 'Account UUID.' },
                session_id: { type: 'string', description: 'MultiplayerData session UUID.' },
                password: { type: 'string' },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: {
            list_entities: ['entity_type'],
            view_entity: ['entity_type', 'entity_id'],
            edit_entity: ['entity_type', 'entity_id', 'field', 'value'],
            add_to_entity_folder: ['entity_folder_id', 'item_id'],
            remove_from_entity_folder: ['entity_folder_id', 'item_id'],
            list_chats: [],
            switch_model: ['model_id'],
            toggle_account: ['account_id'],
            join_session: ['session_id'],
            leave_session: [],
            accept_join: ['account_id'],
            reject_join: ['account_id'],
        },
        examples: [{ action: 'list_entities', entity_type: 'character' }, { action: 'view_entity', entity_type: 'character', entity_id: EX_CHAR }],
    },
    creator: {
        name: 'creator',
        description: 'Create a new system entity.',
        inputSchema: {
            type: 'object',
            properties: { entity_type: { type: 'string', enum: VALID_ENTITY_TYPES }, name: { type: 'string' } },
            required: ['entity_type', 'name'],
            additionalProperties: false,
        },
        examples: [{ entity_type: 'location', name: 'Hidden Cellar' }],
    },
    destroyer: {
        name: 'destroyer',
        description: 'Destroy a system entity by UUID, or list entity UUIDs.',
        defaultAction: 'destroy',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['destroy', 'list'], default: 'destroy' },
                entity_type: { type: 'string', enum: VALID_ENTITY_TYPES },
                entity_id: { type: 'string', description: 'Entity UUID.' },
            },
            required: ['entity_type'],
            additionalProperties: false,
        },
        actionRequired: { destroy: ['entity_type', 'entity_id'], list: ['entity_type'] },
        examples: [{ action: 'list', entity_type: 'context' }, { entity_type: 'context', entity_id: EX_ID }],
    },
    schedule_response: {
        name: 'schedule_response',
        description: 'Schedule a delayed follow-up response from this character.',
        inputSchema: {
            type: 'object',
            properties: { duration: { type: 'string' }, thought: { type: 'string' } },
            required: ['duration'],
            additionalProperties: false,
        },
        examples: [{ duration: '2h', thought: 'Check if Sensei is awake' }],
    },
    text_to_speech: {
        name: 'text_to_speech',
        description: 'Speak text aloud via TTS, or pass "stop".',
        inputSchema: { type: 'object', properties: { text: { type: 'string' }, voice: { type: 'string' } }, required: ['text'], additionalProperties: false },
        examples: [{ text: 'Welcome back.' }, { text: 'stop' }],
    },
    gpu: {
        name: 'gpu',
        description: 'Fetch GPU utilization, VRAM, temperature, and power draw.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    system_info: {
        name: 'system_info',
        description: 'Fetch CPU and RAM telemetry.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    notify: {
        name: 'notify',
        description: 'Send a native OS desktop notification.',
        inputSchema: { type: 'object', properties: { title: { type: 'string', default: 'AI Assistant' }, message: { type: 'string' } }, required: ['message'], additionalProperties: false },
        examples: [{ title: 'Reminder', message: 'Timer expired.' }],
    },
    volume_control: {
        name: 'volume_control',
        description: 'Adjust host system master volume.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['get', 'set', 'mute', 'unmute'] }, level: { type: 'number', minimum: 0, maximum: 100 } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { get: [], set: ['level'], mute: [], unmute: [] },
        examples: [{ action: 'get' }, { action: 'set', level: 50 }],
    },
    lock_screen: {
        name: 'lock_screen',
        description: 'Lock host workstation screen.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    sleep: { name: 'sleep', description: 'Put host system to sleep.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, examples: [{}] },
    shutdown: { name: 'shutdown', description: 'Shut down host system.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, examples: [{}] },
    restart: { name: 'restart', description: 'Restart host system.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, examples: [{}] },
    clipboard: {
        name: 'clipboard',
        description: 'Read or write to the host OS clipboard.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['read', 'write'] }, text: { type: 'string' } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { read: [], write: ['text'] },
        examples: [{ action: 'read' }, { action: 'write', text: 'Copied text' }],
    },
    front_camera: {
        name: 'front_camera',
        description: 'Capture front camera snapshot and attach to visual input.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    screenshot: {
        name: 'screenshot',
        description: 'Capture screenshot and attach to visual input.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    network_scanner: {
        name: 'network_scanner',
        description: 'Scan local network devices.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    file_watcher: {
        name: 'file_watcher',
        description: 'Monitor workspace folders for changes.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['start', 'check'] }, path: { type: 'string', default: '.' } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { start: ['path'], check: [] },
        examples: [{ action: 'start', path: './src' }, { action: 'check' }],
    },
    window_monitor: {
        name: 'window_monitor',
        description: 'Get active foreground window info.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        examples: [{}],
    },
    process_monitor: {
        name: 'process_monitor',
        description: 'Check running OS processes.',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', default: '' }, limit: { type: 'integer', minimum: 1, default: 5 } },
            additionalProperties: false,
        },
        examples: [{}, { query: 'node', limit: 5 }],
    },
    trash: {
        name: 'trash',
        description: 'Move a file or folder to OS recycle bin / trash.',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
        examples: [{ path: './temp.txt' }],
    },
    browser: {
        name: 'browser',
        description: 'Open webpage or web search in browser.',
        inputSchema: { type: 'object', properties: { url_or_search_query: { type: 'string' } }, required: ['url_or_search_query'], additionalProperties: false },
        examples: [{ url_or_search_query: 'https://example.com' }],
    },
    read_file: {
        name: 'read_file',
        description: 'Open local file, video, or link in default app.',
        inputSchema: { type: 'object', properties: { path_or_url: { type: 'string' } }, required: ['path_or_url'], additionalProperties: false },
        examples: [{ path_or_url: '~/documents/notes.txt' }],
    },
    write_file: {
        name: 'write_file',
        description: 'Write or create a file on local filesystem.',
        inputSchema: {
            type: 'object',
            properties: { file_path: { type: 'string' }, content: { type: 'string' } },
            required: ['file_path', 'content'],
            additionalProperties: false,
        },
        examples: [{ file_path: './notes.txt', content: 'Hello\nWorld' }],
    },
    shell: {
        name: 'shell',
        description: 'Execute a terminal/shell command on the host OS.',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
        examples: [{ command: 'git status' }],
    },
    virtual_hearing: {
        name: 'virtual_hearing',
        description: 'Start, stop, or check server desktop audio perception.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['start', 'stop', 'status'] }, duration: { type: 'number', minimum: 1, default: 30 } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { start: [], stop: [], status: [] },
        examples: [{ action: 'start', duration: 30 }, { action: 'stop' }],
    },
    virtual_vision: {
        name: 'virtual_vision',
        description: 'Capture targeted desktop window or region vision.',
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', enum: ['active', 'fullscreen', 'region'], default: 'active' },
                appName: { type: 'string' },
                title: { type: 'string' },
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
            },
            additionalProperties: false,
        },
        examples: [{ target: 'active' }, { target: 'region', x: 0, y: 0, width: 800, height: 600 }],
    },
    virtual_input: {
        name: 'virtual_input',
        description: 'Control host mouse and keyboard.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['move', 'click', 'type', 'press', 'scroll', 'screen_size', 'get_position'] },
                x: { type: 'number' },
                y: { type: 'number' },
                text: { type: 'string' },
                key: { type: 'string' },
                button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
                modifier: { type: 'string' },
                double: { type: 'boolean', default: false },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { move: ['x', 'y'], click: [], type: ['text'], press: ['key'], scroll: [], screen_size: [], get_position: [] },
        examples: [{ action: 'move', x: 500, y: 300 }, { action: 'click', button: 'left' }],
    },
    virtual_controller: {
        name: 'virtual_controller',
        description: 'Control host virtual Xbox 360 gamepad.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['tap', 'press', 'release', 'stick', 'trigger', 'reset', 'status'] },
                button: { type: 'string' },
                stick: { type: 'string', enum: ['left', 'right'], default: 'left' },
                trigger: { type: 'string', enum: ['left', 'right'], default: 'right' },
                x: { type: 'number', minimum: -1, maximum: 1 },
                y: { type: 'number', minimum: -1, maximum: 1 },
                value: { type: 'number', minimum: 0, maximum: 1 },
                durationMs: { type: 'number', minimum: 0 },
            },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { tap: ['button'], press: ['button'], release: ['button'], stick: ['stick', 'x', 'y'], trigger: ['trigger', 'value'], reset: [], status: [] },
        examples: [{ action: 'tap', button: 'A' }, { action: 'stick', stick: 'left', x: 0.0, y: 1.0 }],
    },
    hardware_control: {
        name: 'hardware_control',
        description: 'Communicate with external USB/serial hardware.',
        inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['list', 'send'] }, port: { type: 'string' }, command: { type: 'string' } },
            required: ['action'],
            additionalProperties: false,
        },
        actionRequired: { list: [], send: ['port', 'command'] },
        examples: [{ action: 'list' }, { action: 'send', port: 'COM3', command: 'LED_ON' }],
    },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesSchemaType(value: unknown, expected: JsonSchemaType): boolean {
    switch (expected) {
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'integer': return typeof value === 'number' && Number.isInteger(value);
        case 'boolean': return typeof value === 'boolean';
        case 'array': return Array.isArray(value);
        case 'object': return isPlainObject(value);
        default: return false;
    }
}

function validateToolArguments(def: ToolDefinition, obj: Record<string, unknown>): string | null {
    const schema = def.inputSchema;

    if (schema.additionalProperties === false) {
        const allowed = Object.keys(schema.properties);
        const unknown = Object.keys(obj).filter(k => !(k in schema.properties));
        if (unknown.length > 0) {
            return `Unknown parameter(s): ${unknown.join(', ')}. Allowed parameters: ${allowed.length > 0 ? allowed.join(', ') : '(none)'}.`;
        }
    }

    if (schema.required) {
        for (const req of schema.required) {
            const val = obj[req];
            if (val === undefined || val === null) {
                return `Missing required parameter "${req}".`;
            }
        }
    }

    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue;
        const prop = schema.properties[key];
        if (!prop) continue;

        const allowedTypes = Array.isArray(prop.type) ? prop.type : [prop.type];
        if (!allowedTypes.some(t => matchesSchemaType(value, t))) {
            return `Parameter "${key}" must be of type ${allowedTypes.join(' | ')}.`;
        }

        if (prop.enum) {
            const matchesEnum = prop.enum.some(allowedVal =>
                typeof allowedVal === 'string' && typeof value === 'string'
                    ? allowedVal.toLowerCase() === value.toLowerCase()
                    : allowedVal === value
            );
            if (!matchesEnum) {
                return `Parameter "${key}" must be one of: ${prop.enum.join(', ')}.`;
            }
        }

        if (typeof value === 'number') {
            if (prop.minimum !== undefined && value < prop.minimum) return `Parameter "${key}" must be >= ${prop.minimum}.`;
            if (prop.maximum !== undefined && value > prop.maximum) return `Parameter "${key}" must be <= ${prop.maximum}.`;
        }

        if (Array.isArray(value) && prop.items) {
            for (let i = 0; i < value.length; i++) {
                if (!matchesSchemaType(value[i], prop.items.type)) {
                    return `Parameter "${key}[${i}]" must be of type ${prop.items.type}.`;
                }
            }
        }

        if (isPlainObject(value) && prop.additionalProperties && typeof prop.additionalProperties === 'object') {
            const valType = prop.additionalProperties.type;
            for (const [subKey, subVal] of Object.entries(value)) {
                if (!matchesSchemaType(subVal, valType)) {
                    return `Parameter "${key}.${subKey}" must be of type ${valType}.`;
                }
            }
        }
    }

    if (def.actionRequired) {
        const rawAction = typeof obj.action === 'string' ? obj.action.toLowerCase() : def.defaultAction;
        if (rawAction && def.actionRequired[rawAction]) {
            for (const req of def.actionRequired[rawAction]) {
                const val = obj[req];
                if (
                    val === undefined ||
                    val === null ||
                    (Array.isArray(val) && val.length === 0) ||
                    (isPlainObject(val) && Object.keys(val).length === 0)
                ) {
                    return `Missing required parameter "${req}" for action "${rawAction}".`;
                }
            }
        }
    }

    return null;
}

function formatToolSchema(def: ToolDefinition): string {
    const payload: Record<string, unknown> = {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
    };
    if (def.actionRequired) {
        payload.actionRequiredFields = def.actionRequired;
    }
    payload.examples = def.examples.map(ex => ({
        name: def.name,
        arguments: ex,
    }));
    return JSON.stringify(payload);
}

function formatSchemaError(def: ToolDefinition, errorMessage: string): string {
    return `[Error: ${errorMessage}]\n${formatToolSchema(def)}`;
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
        case 'languageModel': return context.allLanguageModels || [];
        case 'spatiotemporalModel': return context.allSpatiotemporalModels || [];
        case 'tokenSampler': return context.allTokenSamplers || [];
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

export class ArgAccessor {
    positional: string[];
    kwargs: Record<string, string>;
    raw: string;
    jsonArgs?: Record<string, unknown>;

    constructor(
        positional: string[],
        kwargs: Record<string, string>,
        raw: string,
        jsonArgs?: Record<string, unknown>,
    ) {
        this.positional = positional;
        this.kwargs = kwargs;
        this.raw = raw;
        this.jsonArgs = jsonArgs;
    }

    get isJson(): boolean {
        return this.jsonArgs !== undefined;
    }

    private findJsonValue(...names: string[]): unknown {
        if (!this.jsonArgs) return undefined;
        for (const name of names) {
            if (name in this.jsonArgs && this.jsonArgs[name] !== undefined) {
                return this.jsonArgs[name];
            }
            const lower = name.toLowerCase();
            for (const [k, v] of Object.entries(this.jsonArgs)) {
                if (k.toLowerCase() === lower && v !== undefined) {
                    return v;
                }
            }
        }
        return undefined;
    }

    getValue(index: number, ...names: string[]): unknown {
        const jVal = this.findJsonValue(...names);
        if (jVal !== undefined) return jVal;
        return this.get(index, ...names);
    }

    get(index: number, ...names: string[]): string | undefined {
        const jVal = this.findJsonValue(...names);
        if (jVal !== undefined && jVal !== null) {
            if (typeof jVal === 'string') return jVal;
            if (typeof jVal === 'number' || typeof jVal === 'boolean') return String(jVal);
            return JSON.stringify(jVal);
        }
        if (this.isJson) return undefined;

        for (const name of names) {
            const val = this.kwargs[name.toLowerCase()];
            if (val !== undefined && val !== '') {
                return val;
            }
        }
        return index >= 0 ? this.positional[index] : undefined;
    }

    getNumber(index: number, ...names: string[]): number | undefined {
        const jVal = this.findJsonValue(...names);
        if (typeof jVal === 'number') return Number.isFinite(jVal) ? jVal : undefined;
        if (this.isJson && jVal === undefined) return undefined;

        const val = this.get(index, ...names);
        if (val === undefined || val === '') return undefined;
        const n = Number(val);
        return Number.isNaN(n) ? undefined : n;
    }

    getBoolean(index: number, ...names: string[]): boolean {
        const jVal = this.findJsonValue(...names);
        if (typeof jVal === 'boolean') return jVal;
        if (this.isJson && jVal === undefined) return false;

        const val = this.get(index, ...names);
        return val?.toLowerCase() === 'true';
    }

    getStringArray(index: number, ...names: string[]): string[] {
        const jVal = this.findJsonValue(...names);
        if (Array.isArray(jVal)) {
            return jVal.map(v => String(v)).filter(Boolean);
        }
        if (this.isJson) {
            if (typeof jVal === 'string') return jVal.split(',').filter(Boolean);
            return [];
        }

        const val = this.get(index, ...names);
        if (!val) return [];
        return val.split(',').filter(Boolean);
    }

    getItemRecord(index: number, ...names: string[]): Record<string, number> {
        const jVal = this.findJsonValue(...names);
        if (isPlainObject(jVal)) {
            const out: Record<string, number> = {};
            for (const [k, v] of Object.entries(jVal)) {
                const n = Number(v);
                if (k && Number.isFinite(n)) out[k] = n;
            }
            return out;
        }
        const str = this.get(index, ...names);
        return str ? parseItemList(str) : {};
    }
}

export function parsePythonArgs(rawArgs: string): ArgAccessor {
    const trimmed = rawArgs;
    if (!trimmed) return new ArgAccessor([], {}, rawArgs);

    if (/^\s*\{/.test(trimmed)) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (isPlainObject(parsed)) {
                return new ArgAccessor([], {}, rawArgs, parsed);
            }
        } catch {
            // Fall through
        }
    }

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

function resolveCharacter(idQuery: string, interactionData: InteractionData, allCharacters: Character[] = []): Character | undefined {
    let query = idQuery.toLowerCase();
    if (!query) return undefined;
    if ((query.startsWith('"') && query.endsWith('"')) || (query.startsWith("'") && query.endsWith("'"))) {
        query = query.slice(1, -1).toLowerCase();
    }
    const participants = interactionData.participants;
    let found = participants.find(c => c.id.toLowerCase() === query || c.id.toLowerCase().startsWith(query));
    if (found) return found;
    found = allCharacters.find(c => c.id.toLowerCase() === query || c.id.toLowerCase().startsWith(query));
    return found;
}

function resolveLocation(idQuery: string, interactionData: InteractionData): Location | undefined {
    let query = idQuery.toLowerCase();
    if (!query) return undefined;
    if ((query.startsWith('"') && query.endsWith('"')) || (query.startsWith("'") && query.endsWith("'"))) {
        query = query.slice(1, -1).toLowerCase();
    }
    const sessionLocs = interactionData.locations || [];
    return sessionLocs.find(l => l.id.toLowerCase() === query || l.id.toLowerCase().startsWith(query));
}

function getCharacterTimeData(interactionData: InteractionData, character: Character): TimeData {
    const location = getCurrentLocation(interactionData, character);
    return getTimeDataFromCoordinates(location?.latitude, location?.longitude);
}

export const TOOL_EMOJI_MAP: Record<tool, string> = {
    file_search: '📎',
    whisper: '🤫', think: '💭', pick: '🎯', sky_view: '🔭', clock: '🕰️', calendar: '📅',
    coin: '🪙', dice: '🎲', random: '🎲', rng: '🎲', move: '🚶',
    timer: '⏱️', stopwatch: '⏱️', schedule: '📅', calculator: '🧮',
    web: '🌐', dialogue: '💬', knowledge: '🧠', memory: '🧠',
    lookup: '🔍', map: '🗺️', audio: '🔊', note: '📝',
    inventory: '📦', trade: '🤝', invite: '📨', kick: '👢', mind_reader: '🧠',
    oracle: '🔮', teleport: '⚡', key: '🔒', clothing: '👕',
    narrate: '🎙️', substrate: '🎨', inspect: '🔍', summon: '✨', unsummon: '💨', administrator: '🔧',
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
    file_search: executeFileSearch,
    whisper: executeWhisper, think: executeThink, pick: executeRandomPick, sky_view: executeSkyView, clock: executeClock, calendar: executeCalendar, coin: executeCoinFlip, dice: executeDiceRoll, random: executeRandom, rng: executeRng, move: executeMove, timer: executeTimer, stopwatch: executeStopwatch, schedule: executeSchedule, calculator: executeCalculator, web: executeWeb, dialogue: executeDialogue, knowledge: executeKnowledge, memory: executeMemory, lookup: executeLookup, map: executeMap, audio: executeAudio, note: executeNote, inventory: executeInventory, trade: executeTrade, invite: executeInvite, kick: executeKick, mind_reader: executeMindReader, oracle: executeOracle, teleport: executeTeleport, key: executeKey, clothing: executeClothing, narrate: executeNarrate, substrate: executeSubstrate, inspect: executeInspect, summon: executeSummon, unsummon: executeUnsummon,administrator: executeAdministrator, creator: executeCreator, destroyer: executeDestroyer, schedule_response: executeScheduleResponse, text_to_speech: executeTextToSpeech, gpu: executeGpu, system_info: executeSystemInfo, notify: executeNotify, volume_control: executeVolumeControl, lock_screen: executeLockScreen, sleep: executePower('sleep'), shutdown: executePower('shutdown'), restart: executePower('restart'), clipboard: executeClipboard, screenshot: executeScreenshot, front_camera: executeFrontCamera, network_scanner: executeNetworkScanner, file_watcher: executeFileWatcher, window_monitor: executeWindowMonitor, process_monitor: executeProcessMonitor, trash: executeTrash, browser: executeBrowser, read_file: executeReadFile, write_file: executeWriteFile, shell: executeShell, virtual_hearing: executeVirtualHearing, virtual_vision: executeVirtualVision, virtual_input: executeVirtualInput, virtual_controller: executeVirtualController, hardware_control: executeHardwareControl,
};

export function getFallbackToolResult(innerString: string): ToolResult {
    const trimmedInnerString = innerString;
    let toolType = trimmedInnerString;
    let args = '';

    if (/^\s*\{/.test(trimmedInnerString)) {
        try {
            const parsed: unknown = JSON.parse(trimmedInnerString);
            if (isPlainObject(parsed) && typeof parsed.name === 'string') {
                toolType = parsed.name.toLowerCase();
                if (parsed.arguments !== undefined && parsed.arguments !== null) {
                    args = typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments);
                }
            }
        } catch {
            const nameMatch = trimmedInnerString.match(/"name"\s*:\s*"([^"]+)"/);
            if (nameMatch) {
                toolType = nameMatch[1].toLowerCase();
            }
        }
    } else {
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

    if (!isToolEnabled(nextMessage.character, toolType, interactionData.profile)) {
        return { toolType, args, textContent: `${toolResultStartString}Tool disabled${toolResultEndString}`, displayReplacement: "" };
    }

    const def = TOOL_DEFINITIONS[toolType];
    const executeFunction = toolFunctions[toolType as tool];
    if (!executeFunction) {
        if (invocation.parseError) {
            return { toolType: toolType || 'unknown', args, textContent: `[Error: ${invocation.parseError}]`, displayReplacement: '[Error: Invalid tool call]' };
        }
        console.warn(`Unknown tool type: ${toolType}`);
        return { toolType, args, textContent: `${toolResultStartString}Something went wrong${toolResultEndString}`, displayReplacement: "" };
    }

    if (invocation.parseError && def) {
        return { toolType, args, textContent: formatSchemaError(def, invocation.parseError), displayReplacement: `[Error: Invalid ${toolType} JSON]` };
    }

    if (!args && def) {
        return { toolType, args: '', textContent: formatToolSchema(def), displayReplacement: `[ℹ️ ${toolType}]` };
    }

    if (def && /^\s*\{/.test(args)) {
        let parsedObj: unknown;
        try {
            parsedObj = JSON.parse(args);
        } catch (err) {
            return { toolType, args, textContent: formatSchemaError(def, `Invalid JSON arguments: ${(err as Error).message}`), displayReplacement: `[Error: Invalid ${toolType} arguments]` };
        }
        if (!isPlainObject(parsedObj)) {
            return { toolType, args, textContent: formatSchemaError(def, 'Tool "arguments" must be a JSON object.'), displayReplacement: `[Error: Invalid ${toolType} arguments]` };
        }
        const validationError = validateToolArguments(def, parsedObj);
        if (validationError) {
            return { toolType, args, textContent: formatSchemaError(def, validationError), displayReplacement: `[Error: Invalid ${toolType} arguments]` };
        }
    }

    try {
        const result = await executeFunction(args, nextMessage, interactionData, context, displayMode);
        if (!result || !result.textContent) {
            return { toolType, args, textContent: `${toolResultStartString}Something went wrong${toolResultEndString}`, displayReplacement: result?.displayReplacement || "" };
        }
        return result;
    } catch (error) {
        console.error(`Tool "${toolType}" execution error:`, error);
        return { toolType, args, textContent: `${toolResultStartString}Something went wrong${toolResultEndString}`, displayReplacement: "" };
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

// ─── File Search ────────────────────────────────────────────────────
function executeFileSearch(
    args: string,
    nextMessage: BaseMessage,
    interactionData: InteractionData,
    context: ToolExecutionContext,
): ToolResult {
    const pArgs = parsePythonArgs(args);
    let action = pArgs.get(0, 'action', 'command')?.toLowerCase() || 'list';
    let query = pArgs.get(1, 'query', 'filename', 'file', 'name', 'id');

    if (!pArgs.isJson && action && !['list', 'read', 'search'].includes(action)) {
        query = pArgs.positional.join(' ');
        action = 'read';
    }

    const characterFilterRaw = pArgs.get(-1, 'character_id', 'character', 'sender_id');
    const offset = Math.max(0, pArgs.getNumber(-1, 'offset', 'start') ?? 0);
    const limit = Math.max(1, Math.min(20000, pArgs.getNumber(-1, 'limit', 'max_chars') ?? 4000));

    let filterChar: Character | undefined;
    if (characterFilterRaw) {
        filterChar = resolveCharacter(characterFilterRaw, interactionData, context.allCharacters || []);
        if (!filterChar) {
            return {
                toolType: 'file_search',
                args,
                textContent: `[Error: Character "${characterFilterRaw}" not found]`,
                displayReplacement: '[Error: Character not found]',
            };
        }
    }

    const visibleEntries = getVisibleMessagesInPerspective(
        interactionData,
        nextMessage.character,
        context.allPromptBlocks || [],
        { includeSelfTools: true, respectLocations: true },
    );

    const collected: Array<{
        index: number;
        messageId: string;
        characterId: string;
        characterName: string;
        messageType: string;
        timestamp: number;
        rawDataUrl: string;
        parsed: NonNullable<ReturnType<typeof parseAttachmentDataUrl>>;
    }> = [];

    for (const entry of visibleEntries) {
        if (filterChar && entry.message.character.id !== filterChar.id) continue;
        const files = (entry.message as ChatMessage | WhisperMessage | ToolMessage).files;
        if (!files || files.length === 0) continue;

        for (let i = 0; i < files.length; i++) {
            const parsed = parseAttachmentDataUrl(files[i], `file_${i + 1}`);
            if (!parsed) continue;
            collected.push({
                index: collected.length + 1,
                messageId: entry.message.id,
                characterId: entry.message.character.id,
                characterName: entry.message.character.name,
                messageType: entry.message.messageType,
                timestamp: entry.message.firstCreatedTimestamp,
                rawDataUrl: files[i],
                parsed,
            });
        }
    }

    if (action === 'list') {
        const listPayload = collected.map(item => ({
            index: item.index,
            message_id: item.messageId,
            character_id: item.characterId,
            character_name: item.characterName,
            filename: item.parsed.filename,
            mime_type: item.parsed.mimeType,
            kind: item.parsed.isImage ? 'image' : item.parsed.isText ? 'text' : 'binary',
            size_bytes: item.parsed.byteSize,
        }));
        return {
            toolType: 'file_search',
            args,
            textContent: JSON.stringify({ total_files: listPayload.length, files: listPayload }),
            displayReplacement: `[📎 ${listPayload.length} attached file(s)]`,
        };
    }

    if (action === 'read') {
        if (!query) {
            return helpResult('file_search', 'action="read", query="filename.txt"', 'list, read, or search attached files in local chat history');
        }
        const trimmedQuery = query.trim();
        const qLower = trimmedQuery.toLowerCase();

        let match: (typeof collected)[number] | undefined;
        if (/^\d+$/.test(trimmedQuery)) {
            const idxNum = Number.parseInt(trimmedQuery, 10);
            match = collected.find(item => item.index === idxNum);
        }
        if (!match) {
            match = [...collected].reverse().find(item => item.parsed.filename.toLowerCase() === qLower);
        }
        if (!match) {
            match = [...collected].reverse().find(item => item.parsed.filename.toLowerCase().includes(qLower));
        }
        if (!match) {
            match = [...collected].reverse().find(item => item.messageId.toLowerCase().startsWith(qLower));
        }

        if (!match) {
            return {
                toolType: 'file_search',
                args,
                textContent: `No visible attached file matching "${query}". Call file_search with action="list" to inspect available attachments.`,
                displayReplacement: `[📎 File not found: "${query}"]`,
            };
        }

        if (match.parsed.isImage) {
            pushEphemeralVisual(nextMessage, {
                source: 'file_search',
                label: `Attached Image '${match.parsed.filename}' from ${match.characterName}`,
                dataUrl: match.rawDataUrl,
            });
            return {
                toolType: 'file_search',
                args,
                textContent: `Attached image "${match.parsed.filename}" (${match.parsed.mimeType}, from ${match.characterName}) to visual input for inspection.`,
                displayReplacement: `[📎 Loaded image: "${match.parsed.filename}"]`,
            };
        }

        if (match.parsed.isText) {
            const fullText = match.parsed.decodeText();
            const safeOffset = Math.min(offset, fullText.length);
            const slice = fullText.slice(safeOffset, safeOffset + limit);
            const hasMore = safeOffset + slice.length < fullText.length;
            const header = `[File: ${match.parsed.filename} | From: ${match.characterName} | Range: ${safeOffset}-${safeOffset + slice.length} of ${fullText.length} chars${hasMore ? ` | Next offset: ${safeOffset + slice.length}` : ''}]`;
            return {
                toolType: 'file_search',
                args,
                textContent: slice ? `${header}\n${slice}` : `${header}\n[Empty slice]`,
                displayReplacement: `[📎 Read "${match.parsed.filename}"]`,
            };
        }

        return {
            toolType: 'file_search',
            args,
            textContent: `[Binary file "${match.parsed.filename}" (${match.parsed.mimeType}, ${match.parsed.byteSize} bytes) from ${match.characterName} cannot be read as plain text.]`,
            displayReplacement: `[📎 Binary: "${match.parsed.filename}"]`,
        };
    }

    if (action === 'search') {
        if (!query) {
            return helpResult('file_search', 'action="search", query="..."', 'list, read, or search attached files in local chat history');
        }
        const qLower = query.toLowerCase();
        const matches: Array<{
            index: number;
            filename: string;
            character_name: string;
            kind: string;
            snippets: string[];
        }> = [];
        let attachedImagesCount = 0;

        for (const item of collected) {
            const nameMatches = item.parsed.filename.toLowerCase().includes(qLower);
            const snippets: string[] = [];

            if (item.parsed.isText) {
                const lines = item.parsed.decodeText().split(/\r?\n/);
                for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    if (lines[lineIdx].toLowerCase().includes(qLower)) {
                        snippets.push(`L${lineIdx + 1}: ${lines[lineIdx].slice(0, 240)}`);
                        if (snippets.length >= 5) break;
                    }
                }
            } else if (item.parsed.isImage && nameMatches && attachedImagesCount < 4) {
                pushEphemeralVisual(nextMessage, {
                    source: 'file_search',
                    label: `Attached Image '${item.parsed.filename}' from ${item.characterName}`,
                    dataUrl: item.rawDataUrl,
                });
                attachedImagesCount++;
                snippets.push('Image matched by filename and attached to visual input.');
            }

            if (nameMatches || snippets.length > 0) {
                matches.push({
                    index: item.index,
                    filename: item.parsed.filename,
                    character_name: item.characterName,
                    kind: item.parsed.isImage ? 'image' : item.parsed.isText ? 'text' : 'binary',
                    snippets,
                });
            }
        }

        if (matches.length === 0) {
            return {
                toolType: 'file_search',
                args,
                textContent: `No matches found for "${query}" across ${collected.length} visible attached file(s).`,
                displayReplacement: `[📎 0 matches for "${query}"]`,
            };
        }

        return {
            toolType: 'file_search',
            args,
            textContent: JSON.stringify({ query, match_count: matches.length, matches }),
            displayReplacement: `[📎 ${matches.length} file match(es)]`,
        };
    }

    return {
        toolType: 'file_search',
        args,
        textContent: `[Error: Unknown file_search action "${action}". Expected list, read, or search.]`,
        displayReplacement: '[Error: Unknown action]',
    };
}

// ─── Whisper ────────────────────────────────────────────────────────
function executeWhisper(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(-1, 'action')?.toLowerCase();

    if (action === 'list') {
        const chars = (interactionData.participants || []).map(c => ({ character_id: c.id, name: c.name }));
        return { toolType: 'whisper', args, textContent: JSON.stringify({ characters: chars }), displayReplacement: `[🤫 ${chars.length} character(s)]` };
    }

    let targetIdentifiers = pArgs.getStringArray(0, 'target_character_ids', 'target_char_id', 'target', 'target_id', 'to');
    let text = pArgs.get(1, 'text', 'message', 'content');

    if (!pArgs.isJson && !pArgs.kwargs.text && pArgs.positional.length > 0) {
        const trimmed = args;
        const cliMatch = trimmed.match(/^("([^"]+)"|'([^']+)'|([^\s]+))\s+([\s\S]+)$/);
        if (cliMatch) {
            const rawIds = cliMatch[2] || cliMatch[3] || cliMatch[4];
            targetIdentifiers = rawIds.split(',').filter(Boolean);
            text = cliMatch[5];
            if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
                text = text.slice(1, -1);
            }
        } else if (pArgs.positional.length > 1) {
            text = pArgs.positional.slice(1).join(' ');
        }
    }

    if (targetIdentifiers.length === 0 || !text) {
        return helpResult('whisper', 'target_char_id="...", text="..."', 'send private message visible only to target(s)');
    }

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
        return { toolType: 'whisper', args, textContent: `[Error: Target character "${targetIdentifiers.join(',')}" not found]`, displayReplacement: '[Error: Target not found]' };
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
    const reasoning = pArgs.get(0, 'reasoning', 'thought', 'text', 'input') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);

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

// ─── Mind Reader ────────────────────────────────────────────────────
function extractReasoningFromText(text: string): string[] {
    const thoughts: string[] = [];
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const callStart = escapeRegex(toolCallStartString);
    const callEnd = escapeRegex(toolCallEndString);
    const resStart = escapeRegex(toolResultStartString);
    const resEnd = escapeRegex(toolResultEndString);

    const tokenRegex = new RegExp(`${callStart}([\\s\\S]*?)${callEnd}|${resStart}(think\\([\\s\\S]*?\\))${resEnd}`, 'g');
    for (const m of text.matchAll(tokenRegex)) {
        const callInner = m[1];
        const legacyResInner = m[2];
        if (callInner) {
            if (/^\s*\{/.test(callInner)) {
                try {
                    const parsed: unknown = JSON.parse(callInner);
                    if (
                        isPlainObject(parsed) &&
                        typeof parsed.name === 'string' &&
                        parsed.name.toLowerCase() === 'think' &&
                        isPlainObject(parsed.arguments) &&
                        typeof parsed.arguments.reasoning === 'string' &&
                        parsed.arguments.reasoning
                    ) {
                        thoughts.push(parsed.arguments.reasoning);
                    }
                } catch {
                    // ignore malformed JSON
                }
            } else {
                const fnMatch = callInner.match(/^think\s*\(([\s\S]*)\)$/i);
                if (fnMatch) {
                    const thinkArgs = parsePythonArgs(fnMatch[1]);
                    const reasoning = thinkArgs.get(0, 'reasoning', 'thought', 'text', 'input', 'reason') || thinkArgs.positional.join(' ');
                    if (reasoning) thoughts.push(reasoning);
                }
            }
        } else if (legacyResInner) {
            const fnMatch = legacyResInner.match(/^think\s*\(([\s\S]*)\)$/i);
            if (fnMatch) {
                const thinkArgs = parsePythonArgs(fnMatch[1]);
                const reasoning = thinkArgs.get(0, 'reasoning', 'thought', 'text', 'input', 'reason') || thinkArgs.positional.join(' ');
                if (reasoning) thoughts.push(reasoning);
            }
        }
    }
    return thoughts;
}

function executeMindReader(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(-1, 'action')?.toLowerCase();

    if (action === 'list') {
        const chars = (interactionData.participants || []).map(c => ({ character_id: c.id, name: c.name }));
        return { toolType: 'mind_reader', args, textContent: JSON.stringify({ characters: chars }), displayReplacement: `[🧠 ${chars.length} character(s)]` };
    }

    const targetQuery = pArgs.get(0, 'character_id', 'target', 'character', 'id') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
    const limit = pArgs.getNumber(1, 'limit', 'count', 'depth') ?? 1;

    if (!targetQuery) {
        return helpResult('mind_reader', 'target="...", limit=3', 'read the recent internal thoughts (think tool calls) of a target character');
    }

    const targetChar = resolveCharacter(targetQuery, interactionData, context.allCharacters || []);
    if (!targetChar) {
        return { toolType: 'mind_reader', args, textContent: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[❌ Target not found]' };
    }

    const history = getGlobalMessageHistory(interactionData);
    const targetMessages = history.filter(m => m.character.id === targetChar.id && (m.messageType === 'chat' || m.messageType === 'whisper'));
    const extractedThoughts: string[] = [];

    for (let i = targetMessages.length - 1; i >= 0; i--) {
        const msg = targetMessages[i] as ChatMessage | WhisperMessage;
        const found = extractReasoningFromText(msg.textContent || '');
        if (found.length > 0) {
            extractedThoughts.unshift(...found);
        }
        if (extractedThoughts.length >= limit) {
            break;
        }
    }

    const finalThoughts = extractedThoughts.slice(-limit);

    if (finalThoughts.length === 0) {
        return {
            toolType: 'mind_reader',
            args,
            textContent: `[mind_reader: ${targetChar.name}'s mind is currently quiet. No recent internal thoughts detected.]`,
            displayReplacement: `🧠 [Mind Reader: ${targetChar.name}'s mind is quiet]`
        };
    }

    const compiledThoughts = finalThoughts.map((t, idx) => `Thought ${idx + 1}: "${t}"`).join('\n---\n');
    const resultText = `[mind_reader: You peer into ${targetChar.name}'s mind and hear their unspoken thoughts:\n${compiledThoughts}]`;

    return {
        toolType: 'mind_reader',
        args,
        textContent: resultText,
        displayReplacement: `🧠 [Read ${finalThoughts.length} thought(s) from ${targetChar.name}]`
    };
}

// ─── Random Pick ────────────────────────────────────────────────────
function executeRandomPick(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    let options = pArgs.isJson
        ? pArgs.getStringArray(0, 'options', 'choices')
        : pArgs.positional;

    if (!pArgs.isJson) {
        const optKwarg = pArgs.get(-1, 'options', 'choices');
        if (optKwarg) {
            options = optKwarg.split(',').filter(Boolean);
        } else if (options.length === 1 && options[0].includes(',')) {
            options = options[0].split(',').filter(Boolean);
        }
    }

    if (options.length === 0) {
        return helpResult('pick', '"option1", "option2", ...', 'randomly pick one option');
    }

    const picked = options[Math.floor(Math.random() * options.length)];
    return { toolType: 'pick', args, textContent: picked, displayReplacement: `[🎯 "${picked}"]` };
}

// ─── Sky View ───────────────────────────────────────────────────────
function executeSkyView(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const location = getCurrentLocation(interactionData, nextMessage.character);
    if (!location || !location?.hasSkyView) {
        return { toolType: 'sky_view', args, textContent: 'You cannot see the sky from here.', displayReplacement: '[🔭 No sky view]' };
    }
    const timeData = getCharacterTimeData(interactionData, nextMessage.character).luxonTimestamp;
    const skyDescription = generateSkyViewText(timeData.toMillis(), location?.latitude, location?.longitude);
    return { toolType: 'sky_view', args, textContent: skyDescription, displayReplacement: `[🔭 ${skyDescription}]` };
}

// ─── Clock ──────────────────────────────────────────────────────────
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

// ─── Calendar ───────────────────────────────────────────────────────
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

// ─── Coin Flip ──────────────────────────────────────────────────────
function executeCoinFlip(args: string): ToolResult {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return { toolType: 'coin', args, textContent: `The coin shows ${result.toLowerCase()}`, displayReplacement: `[🪙 Coin flip: ${result}]` };
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
    } else if (!notation && !pArgs.isJson && pArgs.positional.length === 1) {
        const p = pArgs.positional[0];
        if (/^\d+$/.test(p)) notation = `1d${p}`;
        else if (/^d\d+$/i.test(p)) notation = `1${p}`;
        else notation = p;
    } else if (!notation && !pArgs.isJson && pArgs.positional.length >= 2) {
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

// ─── Random Number ──────────────────────────────────────────────────
function executeRandom(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    let min = pArgs.getNumber(0, 'min', 'start') ?? 1;
    let max = pArgs.getNumber(1, 'max', 'end', 'stop');

    if (max === undefined && !pArgs.isJson && pArgs.positional.length === 1 && pArgs.positional[0].includes('-')) {
        const parts = pArgs.positional[0].split('-');
        min = Number(parts[0]) || 1;
        max = Number(parts[1]) || 100;
    } else if (max === undefined) {
        max = pArgs.getNumber(0, 'max', 'end') ?? 100;
        if (!pArgs.isJson && pArgs.positional.length === 1 && !pArgs.kwargs['min']) min = 1;
    }

    if (min > max) [min, max] = [max, min];
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return { toolType: 'random', args, textContent: result.toString(), displayReplacement: `[🎲 Random(${min}-${max}): ${result}]` };
}

// ─── RNG Table ──────────────────────────────────────────────────────
function executeRng(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(-1, 'action')?.toLowerCase();
    const contexts = interactionData.contexts || [];

    if (action === 'list') {
        const tables = contexts
            .filter(c => c.text && /^\d+[-:]/.test(c.text || ''))
            .map(c => ({ table_context_id: c.id, name: c.name }));
        return { toolType: 'rng', args, textContent: JSON.stringify({ tables }), displayReplacement: `[🎲 ${tables.length} RNG table(s)]` };
    }

    const tableId = pArgs.get(0, 'table_context_id', 'table', 'context_id') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
    if (!tableId) {
        return helpResult('rng', 'table_context_id="..."', 'roll on a named RNG table defined in contexts');
    }

    const q = tableId.toLowerCase();
    const tableContext = contexts.find(c => c.id.toLowerCase() === q || c.id.toLowerCase().startsWith(q));
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
    const action = pArgs.get(-1, 'action')?.toLowerCase();
    const currentLocation = getCurrentLocation(interactionData, nextMessage.character);

    if (action === 'list') {
        const reachable = getReachableLocationsByCharacter(interactionData, nextMessage.character).map(l => ({
            location_id: l.id,
            name: l.name,
            locked: isCharacterLockedFromLocation(interactionData, nextMessage.character.id, l.id),
        }));
        return {
            toolType: 'move',
            args,
            textContent: JSON.stringify({ current_location_id: currentLocation?.id ?? null, current_location_name: currentLocation?.name ?? null, reachable_locations: reachable }),
            displayReplacement: `[🚶 ${reachable.length} reachable location(s)]`,
        };
    }

    const targetQuery = pArgs.get(0, 'location_id', 'location', 'target', 'destination', 'to') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
    const quietLeave = pArgs.getBoolean(-1, 'quiet_leave');
    const quietEnter = pArgs.getBoolean(-1, 'quiet_enter');

    if (!targetQuery) {
        return helpResult('move', 'location_id="...", quiet_leave=False, quiet_enter=False', 'move character to an adjacent location');
    }

    if (!currentLocation) return { toolType: 'move', args, textContent: '[Error: Current character location unknown]', displayReplacement: '[Error: Unknown location]' };

    const targetLocation = resolveLocation(targetQuery, interactionData);
    if (!targetLocation) return { toolType: 'move', args, textContent: `[Error: Location "${targetQuery}" not found]`, displayReplacement: '[Error: Location not found]' };

    if (targetLocation.id === currentLocation.id) {
        return { toolType: 'move', args, textContent: `Already at "${targetLocation.name}".`, displayReplacement: `[🚶 Already at "${targetLocation.name}"]` };
    }

    const reachable = getReachableLocationsByCharacter(interactionData, nextMessage.character);
    const isAdjacent = reachable.some(l => l.id === targetLocation.id);

    if (!isAdjacent) {
        if (isCharacterLockedFromLocation(interactionData, nextMessage.character.id, targetLocation.id)) {
            return { toolType: 'move', args, textContent: `[Error: Location "${targetLocation.name}" is locked]`, displayReplacement: '[Error: Location locked]' };
        }
        return { toolType: 'move', args, textContent: `[Error: Location "${targetLocation.name}" is not adjacent]`, displayReplacement: '[Error: Not adjacent]' };
    }

    appendPendingAction(nextMessage, {
        type: 'move',
        payload: {
            destinationLocationId: targetLocation.id,
            destinationLocationName: targetLocation.name,
            quietLeave: String(quietLeave),
            quietEnter: String(quietEnter),
        }
    });

    if (quietLeave) {
        return {
            toolType: 'move',
            args,
            textContent: '',
            displayReplacement: ''
        };
    }

    return {
        toolType: 'move',
        args,
        textContent: `${nextMessage.character.name} left "${currentLocation.name}".`,
        displayReplacement: `[🚶 Left "${currentLocation.name}"]`
    };
}

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
            const desc = pArgs.get(3, 'action_desc', 'desc', 'do', 'event', 'text') || (!pArgs.isJson ? pArgs.positional.slice(3).join(' ') : undefined);
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
            const desc = pArgs.get(3, 'action_desc', 'desc', 'do', 'event', 'text') || (!pArgs.isJson ? pArgs.positional.slice(3).join(' ') : undefined);
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
    const expression = pArgs.get(0, 'expression', 'expr', 'math') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
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
    const input = pArgs.get(0, 'url_or_search_query', 'query_or_url', 'query', 'url', 'search') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
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
        const rawQueryId = pArgs.get(1, 'prompt_id', 'id') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : '');
        if (!rawQueryId) {
            return helpResult('dialogue', 'action="list|recall", prompt_id="..."', 'manage dialogue prompts');
        }
        const queryId = rawQueryId.toLowerCase();
        const matched = activeDialoguePrompts.filter(dp => dp.id.toLowerCase() === queryId || dp.id.toLowerCase().startsWith(queryId));
        if (matched.length > 0) {
            const recalled = await collectActiveDialoguePromptContent(matched, evalContext);
            return { toolType: 'dialogue', args, textContent: recalled.join('\n') || 'No active instructions', displayReplacement: `[💬 Recalled ${recalled.length} instruction(s)]` };
        }

        if (nextMessage.character.useEmbeddingModelForDialoguePrompts && nextMessage.character.dialogueRetrievalConfiguration) {
            const queryVector = await embeddingEngine.embed(rawQueryId);
            if (queryVector) {
                const items: RetrievableItem[] = activeDialoguePrompts.map(dp => ({
                    id: dp.id, name: dp.name, textContent: dp.textContent, embedding: dp.embedding, firstCreatedTimestamp: dp.firstCreatedTimestamp
                }));
                const overrideConfig = { ...nextMessage.character.dialogueRetrievalConfiguration, topK: 3, tokenBudget: 512 };
                const results = await retrieveRelevantContext(queryVector, rawQueryId, items, overrideConfig);
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
        return { toolType: 'dialogue', args, textContent: `No active dialogue prompt matching "${rawQueryId}".`, displayReplacement: '[💬 No match]' };
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
        const rawQueryId = pArgs.get(1, 'knowledge_id', 'id') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : '');
        if (!rawQueryId) {
            return helpResult('knowledge', 'action="list|recall|fuzzy_recall", id="..."', 'inspect character knowledge base');
        }
        const queryId = rawQueryId.toLowerCase();
        const matched = activeKnowledgePrompts.filter(kp => kp.id.toLowerCase() === queryId || kp.id.toLowerCase().startsWith(queryId));
        if (matched.length === 0) return { toolType: 'knowledge', args, textContent: `No active knowledge matching "${rawQueryId}".`, displayReplacement: '[🧠 No match]' };
        return { toolType: 'knowledge', args, textContent: matched.map(k => `[${k.name}]: ${k.textContent}`).join('\n'), displayReplacement: `[🧠 Recalled ${matched.length} entry(ies)]` };
    }

    if (action === 'fuzzy_recall') {
        const searchString = pArgs.get(1, 'query', 'search', 'text') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : '');
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
        const queryId = pArgs.get(1, 'memory_id', 'id') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : undefined);
        const latest = findLatestMessage(interactionData, character);
        const knownNames = latest?.message.knownCharacterNames;

        if (queryId) {
            const q = queryId.toLowerCase();
            for (const [, mems] of Object.entries(character.memories || {})) {
                const found = mems.find(m => m.id.toLowerCase() === q || m.id.toLowerCase().startsWith(q));
                if (found) {
                    const detokenized = detokenizeMemoryContent(
                        found.textContent,
                        interactionData.participants,
                        interactionData.locations,
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
    const query = pArgs.get(0, 'keyword', 'query', 'search', 'text')?.toLowerCase() || (!pArgs.isJson ? pArgs.positional.join(' ').toLowerCase() : undefined);
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
    const action = pArgs.get(-1, 'action')?.toLowerCase();

    if (action === 'list') {
        const locs = (interactionData.locations || []).map(l => ({ location_id: l.id, name: l.name }));
        return { toolType: 'map', args, textContent: JSON.stringify({ locations: locs }), displayReplacement: `[🗺️ ${locs.length} location(s)]` };
    }

    const targetQuery = pArgs.get(0, 'to_location_id', 'target_location_id', 'target', 'to', 'destination');
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
    const tracks = interactionData.audioTracks || context.allAudioTracks || [];

    if (!action) {
        return helpResult('audio', 'action="play|stop", track_id="..."', 'manage background audio playback');
    }

    if (action === 'list') {
        const list = tracks.map(t => ({ track_id: t.id, name: t.name, category: t.audioCategory }));
        return { toolType: 'audio', args, textContent: JSON.stringify({ audio_tracks: list }), displayReplacement: `[🔊 ${list.length} track(s)]` };
    }

    const trackId = pArgs.get(1, 'track_id', 'track', 'name') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : undefined);
    const q = trackId ? trackId.toLowerCase() : '';
    const track = trackId ? tracks.find(t => t.id.toLowerCase() === q || t.id.toLowerCase().startsWith(q)) : undefined;
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

// ─── Note ───────────────────────────────────────────────────────────
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
            const text = pArgs.get(2, 'text', 'content', 'value') || (!pArgs.isJson ? pArgs.positional.slice(2).join(' ') : undefined);
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
            const val = pArgs.getValue(2, 'value', 'val', 'qty');
            if (!item || val === undefined) return { toolType: 'inventory', args, textContent: '[Error: inventory(action="set", item="...", value=...) requires item and value]', displayReplacement: '[Error: Usage]' };
            inventory[item] = typeof rawValToInventory(val) === 'number' ? Number(val) : String(val);
            nextMessage.inventory = inventory;
            return { toolType: 'inventory', args, textContent: `Set "${item}" to ${val}.`, displayReplacement: `[📦 Set ${item}]` };
        }
        default:
            return { toolType: 'inventory', args, textContent: `[Error: Unknown inventory action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
    }
}

function rawValToInventory(val: unknown): string | number {
    if (typeof val === 'number') return val;
    const s = String(val);
    return Number.isNaN(Number(s)) ? s : Number(s);
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

    if (action === 'list_characters') {
        const chars = (interactionData.participants || []).map(c => ({ character_id: c.id, name: c.name }));
        return { toolType: 'trade', args, textContent: JSON.stringify({ characters: chars }), displayReplacement: `[🤝 ${chars.length} character(s)]` };
    }

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
        targetLatest.message.inventory = targetInv;
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
        targetLatest.message.inventory = targetInv;
        return { toolType: 'trade', args, textContent: `Took ${qty}x "${item}" from ${targetChar.name}.`, displayReplacement: `[🤝 Took ${qty}x ${item} from ${targetChar.name}]` };
    }

    if (action === 'offer') {
        const targetQuery = pArgs.get(1, 'target_character_id', 'character', 'target', 'to');
        const giveItems = pArgs.getItemRecord(2, 'give_items', 'give');
        const takeItems = pArgs.getItemRecord(3, 'take_items', 'take');
        if (!targetQuery || Object.keys(giveItems).length === 0 || Object.keys(takeItems).length === 0) {
            return { toolType: 'trade', args, textContent: '[Error: trade(action="offer", target="...", give_items="...", take_items="...") requires all parameters]', displayReplacement: '[Error: Usage]' };
        }

        const targetChar = resolveCharacter(targetQuery, interactionData, context.allCharacters || []);
        if (!targetChar) return { toolType: 'trade', args, textContent: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[Error: Target not found]' };

        const offerId = uuidv4().slice(0, 8);
        const newOffer: TradeOffer = {
            id: offerId, fromCharacterId: nextMessage.character.id, toCharacterId: targetChar.id,
            giveItems, takeItems, timestamp: Date.now(),
        };
        offers.push(newOffer);
        activeActions.tradeOffers = offers;
        nextMessage.activeToolActions = activeActions;
        return { toolType: 'trade', args, textContent: `Offered trade [${offerId}] to ${targetChar.name} (Give: ${JSON.stringify(giveItems)}, Take: ${JSON.stringify(takeItems)}).`, displayReplacement: `[🤝 Offered trade to ${targetChar.name}]` };
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
    const action = pArgs.get(-1, 'action')?.toLowerCase();

    if (action === 'list') {
        const coLocatedIds = new Set(getCoLocatedParticipants(interactionData, nextMessage.character).map(c => c.id));
        const invitees = (interactionData.participants || [])
            .filter(c => c.id !== nextMessage.character.id && !coLocatedIds.has(c.id))
            .map(c => {
                const loc = getCurrentLocation(interactionData, c);
                return { character_id: c.id, name: c.name, location_id: loc?.id ?? null, location_name: loc?.name ?? null };
            });
        return { toolType: 'invite', args, textContent: JSON.stringify({ characters: invitees }), displayReplacement: `[📨 ${invitees.length} invitee(s)]` };
    }

    const targetQuery = pArgs.get(0, 'character_id', 'character', 'target', 'id') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
    if (!targetQuery) return helpResult('invite', 'character_id="..."', 'bring existing participant to current location');

    const targetChar = resolveCharacter(targetQuery, interactionData, context.allCharacters || []);
    if (!targetChar) return { toolType: 'invite', args, textContent: `[Error: Character "${targetQuery}" not found]`, displayReplacement: '[Error: Target not found]' };

    appendPendingAction(nextMessage, { type: 'invite', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'invite', args, textContent: `Invited ${targetChar.name}.`, displayReplacement: `[📨 Invited ${targetChar.name}]` };
}

// ─── Kick ───────────────────────────────────────────────────────────
function executeKick(args: string, nextMessage: BaseMessage, interactionData: InteractionData, _context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(-1, 'action')?.toLowerCase();
    const targetQuery = pArgs.get(0, 'character_id', 'character', 'target', 'id');
    const quietLeave = pArgs.getBoolean(-1, 'quiet_leave');
    const quietEnter = pArgs.getBoolean(-1, 'quiet_enter');

    const currentLocation = getCurrentLocation(interactionData, nextMessage.character);
    if (!currentLocation) {
        return { toolType: 'kick', args, textContent: '[Error: Current character location unknown]', displayReplacement: '[Error: Unknown location]' };
    }

    if (action === 'list_characters' || (!pArgs.isJson && targetQuery?.toLowerCase() === 'characters')) {
        const list = getCoLocatedParticipants(interactionData, nextMessage.character).map(c => `${c.name} (${c.id})`);
        return { toolType: 'kick', args, textContent: list.join('\n') || 'No co-located characters', displayReplacement: `[👢 ${list.length} character(s)]` };
    }
    if (action === 'list_locations' || (!pArgs.isJson && targetQuery?.toLowerCase() === 'locations')) {
        const reachable = getReachableLocationsByCharacter(interactionData, nextMessage.character);
        return { toolType: 'kick', args, textContent: reachable.map(l => `${l.name} (${l.id})`).join('\n') || 'No reachable locations', displayReplacement: `[👢 ${reachable.length} location(s)]` };
    }

    if (!targetQuery) return helpResult('kick', 'character_id="...", destination_location_id=None, quiet_leave=False, quiet_enter=False', 'eject character from location');

    const coLocated = getCoLocatedParticipants(interactionData, nextMessage.character);
    const targetChar = coLocated.find(c =>
        c.id.toLowerCase() === targetQuery.toLowerCase() ||
        c.id.toLowerCase().startsWith(targetQuery.toLowerCase())
    );

    if (!targetChar) {
        return { toolType: 'kick', args, textContent: `[Error: Character "${targetQuery}" is not in this location to be kicked]`, displayReplacement: '[Error: Target not here]' };
    }

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
        const isReachable = reachable.some(l => l.id === destLoc!.id);
        if (!isReachable) {
            return { toolType: 'kick', args, textContent: `[Error: Cannot kick to "${destLoc.name}" — it is not adjacent/reachable from ${currentLocation.name}]`, displayReplacement: '[Error: Not reachable]' };
        }
        if (isCharacterLockedFromLocation(interactionData, targetChar.id, destLoc.id)) {
            return { toolType: 'kick', args, textContent: `[Error: Destination "${destLoc.name}" is locked for ${targetChar.name}]`, displayReplacement: '[Error: Destination locked]' };
        }
    } else {
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
            destinationLocationName: destLoc.name,
            quietLeave: String(quietLeave),
            quietEnter: String(quietEnter),
        }
    });

    if (quietLeave) {
        return { toolType: 'kick', args, textContent: '', displayReplacement: '' };
    }

    return {
        toolType: 'kick', args,
        textContent: `${targetChar.name} was kicked out of "${currentLocation.name}".`,
        displayReplacement: `[👢 Kicked ${targetChar.name} from "${currentLocation.name}"]`
    };
}

// ─── Oracle ─────────────────────────────────────────────────────────
function executeOracle(args: string, _nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(-1, 'action')?.toLowerCase();
    const locations = interactionData.locations || [];

    if (action === 'list') {
        const list = locations.map(l => ({ location_id: l.id, name: l.name }));
        return { toolType: 'oracle', args, textContent: JSON.stringify({ locations: list }), displayReplacement: `[🔮 ${list.length} location(s)]` };
    }

    const targetLocQuery = pArgs.get(0, 'location_id', 'location', 'target', 'place', 'to');
    const limit = pArgs.getNumber(1, 'limit', 'count') ?? 5;

    if (!targetLocQuery) {
        const locList = locations.map(l => `"${l.name}" (${l.id})`).join(', ');
        return { toolType: 'oracle', args, textContent: `The scrying glass is unfocused. Available locations in this world: ${locList}. Specify a location to peer into it.`, displayReplacement: '[🔮 Oracle: Unfocused]' };
    }

    const targetLoc = locations.find(l =>
        l.id.toLowerCase() === targetLocQuery.toLowerCase() ||
        l.id.toLowerCase().startsWith(targetLocQuery.toLowerCase())
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
function executeTeleport(args: string, nextMessage: BaseMessage, interactionData: InteractionData): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(-1, 'action')?.toLowerCase();

    if (action === 'list') {
        const list = (interactionData.locations || []).map(l => ({ location_id: l.id, name: l.name }));
        return { toolType: 'teleport', args, textContent: JSON.stringify({ locations: list }), displayReplacement: `[⚡ ${list.length} location(s)]` };
    }

    const targetQuery = pArgs.get(0, 'location_id', 'location', 'destination', 'target') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
    const quietLeave = pArgs.getBoolean(-1, 'quiet_leave');
    const quietEnter = pArgs.getBoolean(-1, 'quiet_enter');

    if (!targetQuery) return helpResult('teleport', 'location_id="...", quiet_leave=False, quiet_enter=False', 'instantly move character to any location');

    const targetLocation = resolveLocation(targetQuery, interactionData);
    if (!targetLocation) return { toolType: 'teleport', args, textContent: `[Error: Location "${targetQuery}" not found]`, displayReplacement: '[Error: Not found]' };

    const currentLocation = getCurrentLocation(interactionData, nextMessage.character);
    if (currentLocation && targetLocation.id === currentLocation.id) {
        return { toolType: 'teleport', args, textContent: `Already at "${targetLocation.name}".`, displayReplacement: `[⚡ Already at "${targetLocation.name}"]` };
    }

    const originName = currentLocation ? `"${currentLocation.name}"` : 'the area';

    appendPendingAction(nextMessage, {
        type: 'teleport',
        payload: {
            destinationLocationId: targetLocation.id,
            destinationLocationName: targetLocation.name,
            quietLeave: String(quietLeave),
            quietEnter: String(quietEnter),
        }
    });

    if (quietLeave) {
        return { toolType: 'teleport', args, textContent: '', displayReplacement: '' };
    }

    return {
        toolType: 'teleport', args,
        textContent: `${nextMessage.character.name} vanished from ${originName}.`,
        displayReplacement: `[⚡ Vanished from ${originName}]`
    };
}

// ─── Key ────────────────────────────────────────────────────────────
function executeKey(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase();

    if (action === 'list') {
        const locations = (interactionData.locations || []).map(l => ({ location_id: l.id, name: l.name }));
        const characters = (interactionData.participants || []).map(c => ({ character_id: c.id, name: c.name }));
        return { toolType: 'key', args, textContent: JSON.stringify({ locations, characters }), displayReplacement: '[🔒 Key targets listed]' };
    }

    const locQuery = pArgs.get(1, 'location_id', 'location');
    const charQuery = pArgs.get(2, 'character_id', 'character', 'target');

    if (!action || !locQuery) {
        return helpResult('key', 'action="lock|unlock", location_id="...", character_id=None', 'lock or unlock locations for specific characters');
    }

    const targetLoc = resolveLocation(locQuery, interactionData);
    if (!targetLoc) return { toolType: 'key', args, textContent: `[Error: Location "${locQuery}" not found]`, displayReplacement: '[Error: Location not found]' };

    const targetChar = charQuery ? resolveCharacter(charQuery, interactionData, context.allCharacters || []) : undefined;
    const targets = targetChar ? [targetChar] : interactionData.participants.filter(p => p.id !== nextMessage.character.id);

    if (action === 'lock') {
        for (const t of targets) {
            appendPendingAction(nextMessage, { type: 'lock_location', payload: { characterId: t.id, locationId: targetLoc.id } });
        }
        return { toolType: 'key', args, textContent: `Locked "${targetLoc.name}".`, displayReplacement: `[🔒 Locked "${targetLoc.name}"]` };
    }

    if (action === 'unlock') {
        for (const t of targets) {
            appendPendingAction(nextMessage, { type: 'unlock_location', payload: { characterId: t.id, locationId: targetLoc.id } });
        }
        return { toolType: 'key', args, textContent: `Unlocked "${targetLoc.name}".`, displayReplacement: `[🔓 Unlocked "${targetLoc.name}"]` };
    }

    return { toolType: 'key', args, textContent: `[Error: Unknown key action "${action}"]`, displayReplacement: '[Error: Unknown action]' };
}

// ─── Clothing ───────────────────────────────────────────────────────
function executeClothing(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    let action = pArgs.get(-1, 'action', 'command')?.toLowerCase();
    let charQuery = pArgs.get(-1, 'character_id', 'character');
    let clothingQuery = pArgs.get(-1, 'clothing_id', 'clothing', 'item');

    if (!pArgs.isJson) {
        charQuery = pArgs.get(0, 'character_id', 'character');
        action = pArgs.get(1, 'action', 'command')?.toLowerCase();
        clothingQuery = pArgs.get(2, 'clothing_id', 'clothing', 'item');
        if (charQuery && (charQuery.toLowerCase() === 'wear' || charQuery.toLowerCase() === 'remove' || charQuery.toLowerCase() === 'list')) {
            action = charQuery.toLowerCase();
            charQuery = pArgs.get(1, 'character_id', 'character');
            clothingQuery = pArgs.get(2, 'clothing_id', 'clothing', 'item') || pArgs.positional.slice(2).join(' ');
        } else if (!clothingQuery && pArgs.positional.length > 2) {
            clothingQuery = pArgs.positional.slice(2).join(' ');
        }
    }

    if (action === 'list') {
        const targetChar = charQuery
            ? resolveCharacter(charQuery, interactionData, context.allCharacters || [])
            : nextMessage.character;
        if (!targetChar) return { toolType: 'clothing', args, textContent: `[Error: Character "${charQuery}" not found]`, displayReplacement: '[Error: Character not found]' };
        const latest = findLatestMessage(interactionData, targetChar);
        const statuses = nextMessage.character.id === targetChar.id
            ? (nextMessage.characterClothingWearingStatuses || latest?.message?.characterClothingWearingStatuses || {})
            : (latest?.message?.characterClothingWearingStatuses || {});
        const items = (targetChar.clothings || []).map(c => ({ clothing_id: c.id, name: c.name, worn: Boolean(statuses[c.id]) }));
        return { toolType: 'clothing', args, textContent: JSON.stringify({ character_id: targetChar.id, clothings: items }), displayReplacement: `[👕 ${items.length} clothing item(s)]` };
    }

    if (!charQuery || !action || !clothingQuery) {
        return helpResult('clothing', 'action="wear|remove", character_id="...", clothing_id="..."', 'manage worn clothing items');
    }

    const targetChar = resolveCharacter(charQuery, interactionData, context.allCharacters || []);
    if (!targetChar) return { toolType: 'clothing', args, textContent: `[Error: Character "${charQuery}" not found]`, displayReplacement: '[Error: Character not found]' };

    const q = clothingQuery.toLowerCase();
    const clothing = targetChar.clothings?.find(c => c.id.toLowerCase() === q || c.id.toLowerCase().startsWith(q));
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

// ─── Narrate ────────────────────────────────────────────────────────
function executeNarrate(args: string): ToolResult {
    const pArgs = parsePythonArgs(args);
    const text = pArgs.get(0, 'text', 'narration', 'content') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
    if (!text) return helpResult('narrate', 'text="..."', 'inject ambient narration without consuming chat stamina');
    return { toolType: 'narrate', args, textContent: text, displayReplacement: `[🎙️ ${text}]` };
}

// ─── Substrate ──────────────────────────────────────────────────────
function executeSubstrate(args: string): ToolResult {
    const text = "To do.";
    return { toolType: 'substrate', args, textContent: text, displayReplacement: `[🎨 ${text}]` };
}

// ─── Inspect ────────────────────────────────────────────────────────
function executeInspect(args: string, _nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(-1, 'action')?.toLowerCase();

    if (action === 'list') {
        const chars = (interactionData.participants || []).map(c => ({ character_id: c.id, name: c.name }));
        return { toolType: 'inspect', args, textContent: JSON.stringify({ characters: chars }), displayReplacement: `[🔍 ${chars.length} character(s)]` };
    }

    const charQuery = pArgs.get(0, 'character_id', 'character', 'target') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
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

// ─── Summon ─────────────────────────────────────────────────────────
function executeSummon(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(-1, 'action')?.toLowerCase();
    const allChars = context.allCharacters || [];

    if (action === 'list') {
        const participantIds = new Set((interactionData.participants || []).map(p => p.id));
        const summonable = allChars.filter(c => !participantIds.has(c.id)).map(c => ({ character_id: c.id, name: c.name }));
        return { toolType: 'summon', args, textContent: JSON.stringify({ summonable_characters: summonable }), displayReplacement: `[✨ ${summonable.length} summonable character(s)]` };
    }

    const charQuery = pArgs.get(0, 'character_id', 'character', 'target', 'name') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
    if (!charQuery) return helpResult('summon', 'character_id="..."', 'add a non-participant character to current session');

    const q = charQuery.toLowerCase();
    const targetChar = interactionData.participants.find(c => c.id.toLowerCase() === q || c.id.toLowerCase().startsWith(q)) || allChars.find(c => c.id.toLowerCase() === q || c.id.toLowerCase().startsWith(q));
    if (!targetChar) return { toolType: 'summon', args, textContent: `[Error: Character "${charQuery}" does not exist]`, displayReplacement: '[Error: Character not found]' };

    appendPendingAction(nextMessage, { type: 'summon', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'summon', args, textContent: `Summoned ${targetChar.name}.`, displayReplacement: `[✨ Summoned ${targetChar.name}]` };
}

// ─── Unsummon ───────────────────────────────────────────────────────
function executeUnsummon(args: string, nextMessage: BaseMessage, interactionData: InteractionData, context: ToolExecutionContext): ToolResult {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(-1, 'action')?.toLowerCase();
    const allChars = context.allCharacters || [];

    if (action === 'list') {
        const protagonistIds = new Set(interactionData.protagonistIds || []);
        const unsummonable = (interactionData.participants || [])
            .filter(c => !protagonistIds.has(c.id))
            .map(c => ({ character_id: c.id, name: c.name }));
        return {
            toolType: 'unsummon',
            args,
            textContent: JSON.stringify({ unsummonable_characters: unsummonable }),
            displayReplacement: `[💨 ${unsummonable.length} unsummonable character(s)]`
        };
    }

    const charQuery = pArgs.get(0, 'character_id', 'character', 'target', 'name') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
    if (!charQuery) return helpResult('unsummon', 'character_id="..."', 'remove a participant character from current session');

    const q = charQuery.toLowerCase();
    const targetChar = (interactionData.participants || []).find(c => c.id.toLowerCase() === q || c.id.toLowerCase().startsWith(q));
    if (!targetChar) {
        const exists = allChars.some(c => c.id.toLowerCase() === q || c.id.toLowerCase().startsWith(q));
        return {
            toolType: 'unsummon',
            args,
            textContent: exists
                ? `[Error: Character "${charQuery}" is not a participant in current session]`
                : `[Error: Character "${charQuery}" does not exist]`,
            displayReplacement: '[Error: Character not found]'
        };
    }

    if (interactionData.protagonistIds?.includes(targetChar.id)) {
        return { toolType: 'unsummon', args, textContent: '[Error: Cannot unsummon session protagonist]', displayReplacement: '[Error: Protected character]' };
    }

    appendPendingAction(nextMessage, { type: 'unsummon', payload: { characterId: targetChar.id, characterName: targetChar.name } });
    return { toolType: 'unsummon', args, textContent: `Unsummoned ${targetChar.name}.`, displayReplacement: `[💨 Unsummoned ${targetChar.name}]` };
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
        const query = pArgs.get(2, 'entity_id', 'id');
        const resolvedType = normalizeEntityType(rawType);
        if (!resolvedType || !query) {
            return { toolType: 'administrator', args, textContent: '[Error: administrator(action="view_entity", entity_type="...", entity_id="...") requires entity_type and entity_id]', displayReplacement: '[Error: Usage]' };
        }

        const entities = getEntitiesByType(context, resolvedType);
        const item = entities.find((x: any) =>
            x.id?.toLowerCase() === query.toLowerCase() ||
            x.id?.toLowerCase().startsWith(query.toLowerCase())
        );

        if (!item) {
            return { toolType: 'administrator', args, textContent: `[Error: ${resolvedType} entity "${query}" not found]`, displayReplacement: '[Error: Not found]' };
        }

        const { kvCacheTextContentPaths: _kp1, kvCacheInteractionTextContentSummaries: _kp2, ...displayItem } = item;
        return { toolType: 'administrator', args, textContent: `[Entity: ${resolvedType}]\n${JSON.stringify(displayItem, null, 2)}`, displayReplacement: `[🔧 View: ${item.name || item.username || item.id}]` };
    }

    if (action === 'edit_entity') {
        const rawType = pArgs.get(1, 'entity_type', 'type') || '';
        const entityId = pArgs.get(2, 'entity_id', 'id');
        const field = pArgs.get(3, 'field', 'key');
        const rawVal = pArgs.getValue(4, 'value', 'val');
        const resolvedType = normalizeEntityType(rawType);

        if (!resolvedType || !entityId || !field || rawVal === undefined) {
            return { toolType: 'administrator', args, textContent: '[Error: administrator(action="edit_entity", entity_type="...", entity_id="...", field="...", value="...") requires all arguments]', displayReplacement: '[Error: Usage]' };
        }

        const value = typeof rawVal === 'string'
            ? (pArgs.isJson ? rawVal : (pArgs.positional.slice(4).join(' ') || rawVal))
            : JSON.stringify(rawVal);

        const entities = getEntitiesByType(context, resolvedType);
        const item = entities.find((x: any) => x.id?.toLowerCase() === entityId.toLowerCase());

        const targetId = item ? item.id : entityId;
        const targetName = item?.name || item?.username || entityId;

        appendPendingAction(nextMessage, { type: 'administrator_edit_entity', payload: { entityType: resolvedType, entityId: targetId, field, value } });
        context.addToast?.(`Administrator: Edit ${resolvedType} "${targetName}" [${field}] initiated.`, 'info');
        return { toolType: 'administrator', args, textContent: `Requested edit on ${resolvedType} "${targetName}": set ${field} = "${value}".`, displayReplacement: `[🔧 Edit: ${targetName}.${field}]` };
    }

    if (action === 'add_to_entity_folder') {
        const entityFolderQuery = pArgs.get(1, 'entity_folder_id');
        const itemId = pArgs.get(2, 'item_id', 'id', 'item');
        if (!entityFolderQuery || !itemId) {
            return { toolType: 'administrator', args, textContent: '[Error: administrator(action="add_to_entity_folder", entity_folder_id="...", item_id="...") requires entity folder and item ID]', displayReplacement: '[Error: Usage]' };
        }

        const folders = context.allEntityFolders || [];
        const f = folders.find(x => x.id.toLowerCase() === entityFolderQuery.toLowerCase() || x.id.toLowerCase().startsWith(entityFolderQuery.toLowerCase()));
        const folderId = f ? f.id : entityFolderQuery;
        const folderName = f ? f.name : entityFolderQuery;

        appendPendingAction(nextMessage, { type: 'administrator_add_to_entity_folder', payload: { entityFolderId: folderId, entityFolderName: folderName, itemId } });
        return { toolType: 'administrator', args, textContent: `Requested adding item "${itemId}" to entity folder "${folderName}".`, displayReplacement: `[🔧 Add to entity folder: ${folderName}]` };
    }

    if (action === 'remove_from_entity_folder') {
        const entityFolderQuery = pArgs.get(1, 'entity_folder_id');
        const itemId = pArgs.get(2, 'item_id', 'id', 'item');
        if (!entityFolderQuery || !itemId) {
            return { toolType: 'administrator', args, textContent: '[Error: administrator(action="remove_from_entity_folder", entity_folder_id="...", item_id="...") requires entity folder and item ID]', displayReplacement: '[Error: Usage]' };
        }

        const folders = context.allEntityFolders || [];
        const f = folders.find(x => x.id.toLowerCase() === entityFolderQuery.toLowerCase() || x.id.toLowerCase().startsWith(entityFolderQuery.toLowerCase()));
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
            const modelName = pArgs.get(1, 'model_id', 'model_name', 'name', 'languageModel') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : undefined);
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
    const entityName = pArgs.get(1, 'name', 'entity_name') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : undefined);
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
    const action = pArgs.get(-1, 'action')?.toLowerCase() || 'destroy';
    const rawType = pArgs.get(0, 'entity_type', 'type') || '';
    const resolvedType = normalizeEntityType(rawType);

    if (action === 'list') {
        if (!resolvedType) return helpResult('destroyer', 'entity_type="...", entity_id="..."', `valid types: ${VALID_ENTITY_TYPES.join(', ')}`);
        const list = getEntitiesByType(context, resolvedType).map((item: any) => ({ entity_id: item.id, name: item.name || item.username || item.id }));
        return { toolType: 'destroyer', args, textContent: JSON.stringify({ entity_type: resolvedType, entities: list }), displayReplacement: `[💀 ${list.length} ${resolvedType}(s)]` };
    }

    const entityId = pArgs.get(1, 'entity_id', 'id') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : undefined);

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
    const thought = pArgs.get(1, 'thought', 'reason', 'prompt') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : undefined) || 'Checking in later';

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

// ─── Text to Speech ─────────────────────────────────────────────────
async function executeTextToSpeech(args: string): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const text = pArgs.get(0, 'text', 'message') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
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
        return { toolType: 'system_info', args, textContent: `[Error: ${res.error || 'Failed to fetch system info'}]`, displayReplacement: '[❌ system-info failed]' };
    }
    const d = res.data;
    const content = `CPU: ${d.cpuManufacturer} ${d.cpuBrand} (${d.cores} cores), Load: ${d.loadPercent}%, RAM: ${d.memoryUsedMB}MB / ${d.memoryTotalMB}MB`;
    return { toolType: 'system_info', args, textContent: content, displayReplacement: `[🖥️ CPU: ${d.loadPercent}% | RAM: ${Math.round(d.memoryUsedMB / 1024)}/${Math.round(d.memoryTotalMB / 1024)}GB]` };
}

// ─── Native OS Desktop Notifications ────────────────────────────────
async function executeNotify(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const title = pArgs.get(0, 'title', 'heading') || 'AI Assistant';
    const message = pArgs.get(1, 'message', 'text', 'content') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : undefined);

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

// ─── Volume Control Tool ────────────────────────────────────────────
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
    const text = pArgs.get(1, 'text', 'content') || (!pArgs.isJson ? pArgs.positional.slice(1).join(' ') : undefined);

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

// ─── Screenshot Capture ─────────────────────────────────────────────
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

    pushEphemeralVisual(nextMessage, {
        source: 'screenshot',
        label: 'Screenshot Capture',
        dataUrl,
    });

    context.addToast?.('Screenshot captured and sent to the language model', 'success');
    return { toolType: 'screenshot', args, textContent: `Screenshot captured and attached to visual input.`, displayReplacement: `[📸 Screenshot captured]` };
}

// ─── front_camera Tool ──────────────────────────────────────────────
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

    pushEphemeralVisual(nextMessage, {
        source: 'front_camera',
        label: 'Front Camera Snapshot',
        dataUrl,
    });

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
    const targetPath = pArgs.get(0, 'path', 'file_path', 'target') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
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

// ─── File Watcher ───────────────────────────────────────────────────
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

// ─── Process Monitor ────────────────────────────────────────────────
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

// ─── Active Window Monitor ──────────────────────────────────────────
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
    const input = pArgs.get(0, 'url_or_search_query', 'query_or_url', 'query', 'url', 'search') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
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
    const target = pArgs.get(0, 'path_or_url', 'path', 'file_path', 'url') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
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
    if (content === undefined && !pArgs.isJson && pArgs.positional.length > 1) {
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

// ─── Shell ──────────────────────────────────────────────────────────
async function executeShell(args: string, _nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const command = pArgs.get(0, 'command', 'cmd') || (!pArgs.isJson ? pArgs.positional.join(' ') : undefined);
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
async function executeVirtualVision(args: string, nextMessage: BaseMessage, _interactionData: InteractionData, context: ToolExecutionContext): Promise<ToolResult> {
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

    const dataUrl = `data:${res.contentType || 'image/png'};base64,${res.base64}`;
    pushEphemeralVisual(nextMessage, {
        source: 'virtual_vision',
        label: `Virtual Vision (${res.target || target})`,
        dataUrl,
    });

    context.addToast?.(`Captured target: ${res.target}`, 'info');
    return { toolType: 'virtual_vision', args, textContent: `Captured targeted vision (${res.target}) and attached to visual input.`, displayReplacement: `[👁️ Vision: ${res.target}]` };
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
    const double = pArgs.getBoolean(2, 'double');

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

    if (pArgs.isJson) {
        action = rawFirst || 'tap';
        button = pArgs.get(-1, 'button', 'btn', 'key')?.toUpperCase();
        const stickRaw = pArgs.get(-1, 'stick', 'side')?.toLowerCase();
        if (stickRaw === 'left' || stickRaw === 'right') stick = stickRaw;
        const trigRaw = pArgs.get(-1, 'trigger', 'side')?.toLowerCase();
        if (trigRaw === 'left' || trigRaw === 'right') trigger = trigRaw;
        x = pArgs.getNumber(-1, 'x');
        y = pArgs.getNumber(-1, 'y');
        value = pArgs.getNumber(-1, 'value', 'val');
    } else if (rawFirst && BUTTON_SET.has(rawFirst) && pArgs.positional.length === 1 && Object.keys(pArgs.kwargs).length === 0) {
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

// ─── Hardware Control ───────────────────────────────────────────────
async function executeHardwareControl(args: string): Promise<ToolResult> {
    const pArgs = parsePythonArgs(args);
    const action = pArgs.get(0, 'action', 'command')?.toLowerCase() || 'list';
    const port = pArgs.get(1, 'port', 'path');
    const command = pArgs.get(2, 'command', 'cmd') || (!pArgs.isJson ? pArgs.positional.slice(2).join(' ') : undefined);

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
    const history = getGlobalMessageHistory(data);
    const messagesWithPending = history.filter(m => m.pendingToolActions && m.pendingToolActions.length > 0);
    if (messagesWithPending.length === 0) return data;

    let updatedData = { ...data, interactionHistories: { ...data.interactionHistories } };
    let changed = false;

    const findPrevMsg = (d: InteractionData, charId: string) => {
        const char = allCharacters.find(c => c.id === charId) || d.participants.find(p => p.id === charId);
        if (!char) return null;
        const latest = findLatestMessage(d, char);
        return latest?.message || null;
    };

    let sequenceTime = Date.now();
    let currentLastMessageId = history.length > 0 ? history[history.length - 1].id : null;

    for (const targetMsg of messagesWithPending) {
        const actions = targetMsg.pendingToolActions!;
        for (const action of actions) {
            sequenceTime++;

            switch (action.type) {
                case 'move': {
                    const destLocId = action.payload.destinationLocationId;
                    const destLocName = action.payload.destinationLocationName || destLocId;
                    const isQuietLeave = action.payload.quietLeave === 'true';
                    const isQuietEnter = action.payload.quietEnter === 'true';
                    if (destLocId) {
                        const prevMsg = findPrevMsg(updatedData, targetMsg.character.id);
                        let updatedActionStamina = prevMsg?.remainingActionStamina;
                        if (updatedActionStamina !== undefined) {
                            const currentLocId = getCurrentLocation(updatedData, targetMsg.character)?.id;
                            if (currentLocId && currentLocId !== destLocId && updatedData.locations) {
                                const movementCost = computeMovementCost(currentLocId, destLocId, updatedData.locations);
                                updatedActionStamina = Math.max(0, updatedActionStamina - movementCost);
                            }
                        }
                        if (!updatedData.interactionHistories[destLocId]) {
                            updatedData.interactionHistories[destLocId] = [];
                        }
                        const moveMsg = createMessage(targetMsg.character, {
                            ...(isQuietEnter ? {} : { textContent: `[Entered "${destLocName}"]` }),
                            remainingActionStamina: updatedActionStamina,
                            timestamp: sequenceTime,
                            parentMessageId: currentLastMessageId,
                            previousMessage: prevMsg,
                            interactionData: updatedData,
                        });
                        currentLastMessageId = moveMsg.id;
                        updatedData.interactionHistories[destLocId] = [...updatedData.interactionHistories[destLocId], moveMsg];
                        changed = true;
                        if (!isQuietLeave && !isQuietEnter) {
                            options?.onToast?.(`🚶 ${targetMsg.character.name} moved to ${destLocName}.`, 'info');
                        } else if (!isQuietLeave) {
                            options?.onToast?.(`🚶 ${targetMsg.character.name} left.`, 'info');
                        }
                    }
                    break;
                }
                case 'teleport': {
                    const destLocId = action.payload.destinationLocationId;
                    const destLocName = action.payload.destinationLocationName || destLocId;
                    const isQuietLeave = action.payload.quietLeave === 'true';
                    const isQuietEnter = action.payload.quietEnter === 'true';
                    if (destLocId) {
                        const prevMsg = findPrevMsg(updatedData, targetMsg.character.id);
                        if (!updatedData.interactionHistories[destLocId]) {
                            updatedData.interactionHistories[destLocId] = [];
                        }
                        const teleportMsg = createMessage(targetMsg.character, {
                            ...(isQuietEnter ? {} : { textContent: `[Entered "${destLocName}"]` }),
                            timestamp: sequenceTime,
                            parentMessageId: currentLastMessageId,
                            previousMessage: prevMsg,
                            interactionData: updatedData,
                        });
                        currentLastMessageId = teleportMsg.id;
                        updatedData.interactionHistories[destLocId] = [...updatedData.interactionHistories[destLocId], teleportMsg];
                        changed = true;
                        if (!isQuietLeave && !isQuietEnter) {
                            options?.onToast?.(`⚡ ${targetMsg.character.name} teleported to ${destLocName}.`, 'info');
                        } else if (!isQuietLeave) {
                            options?.onToast?.(`⚡ ${targetMsg.character.name} vanished.`, 'info');
                        }
                    }
                    break;
                }
                case 'whisper': {
                    const targetIds = action.payload.targetCharacterIds.split(',');
                    const text = action.payload.text;
                    const senderLatest = findLatestMessage(updatedData, targetMsg.character);
                    const locId = senderLatest?.locationId || 'global';
                    const prevMsg = findPrevMsg(updatedData, targetMsg.character.id);
                    const whisperMsg = createMessage(targetMsg.character, {
                        textContent: text,
                        targetCharacterIds: targetIds,
                        timestamp: sequenceTime,
                        parentMessageId: currentLastMessageId,
                        previousMessage: prevMsg,
                        interactionData: updatedData,
                    });
                    currentLastMessageId = whisperMsg.id;
                    if (!updatedData.interactionHistories[locId]) updatedData.interactionHistories[locId] = [];
                    updatedData.interactionHistories[locId] = [...updatedData.interactionHistories[locId], whisperMsg];
                    updatedData = { ...updatedData, lastUpdatedTimestamp: sequenceTime };
                    changed = true;
                    break;
                }
                case 'invite': {
                    const charId = action.payload.characterId;
                    let invitedChar = (updatedData.participants || []).find(p => p.id === charId);
                    if (!invitedChar) invitedChar = allCharacters.find(c => c.id === charId);
                    if (invitedChar) {
                        const charToInvite = invitedChar;
                        const inviterLoc = getCurrentLocation(updatedData, targetMsg.character);
                        const currentLocId = inviterLoc?.id;
                        const prevInvitedMsg = findPrevMsg(updatedData, charToInvite.id);
                        const inviteMsg = createMessage(charToInvite, {
                            timestamp: sequenceTime,
                            parentMessageId: currentLastMessageId,
                            previousMessage: prevInvitedMsg,
                            interactionData: updatedData,
                        });
                        currentLastMessageId = inviteMsg.id;
                        if (currentLocId) {
                            if (!updatedData.interactionHistories[currentLocId]) updatedData.interactionHistories[currentLocId] = [];
                            updatedData.interactionHistories[currentLocId] = [...updatedData.interactionHistories[currentLocId], inviteMsg];
                        }
                        const isAlreadyPart = (updatedData.participants || []).some(p => p.id === charToInvite.id);
                        const newParticipants = isAlreadyPart ? (updatedData.participants || []) : [...(updatedData.participants || []), { ...charToInvite }];
                        updatedData = { ...updatedData, participants: newParticipants, lastUpdatedTimestamp: sequenceTime };
                        changed = true;
                        options?.onToast?.(`📨 ${action.payload.characterName} arrived.`, 'info');
                    }
                    break;
                }
                case 'kick': {
                    const sessionParticipants = updatedData.participants || [];
                    const kickedChar = sessionParticipants.find(p => p.id === action.payload.characterId);
                    const isQuietLeave = action.payload.quietLeave === 'true';
                    const isQuietEnter = action.payload.quietEnter === 'true';
                    if (kickedChar) {
                        const destLocId = action.payload.destinationLocationId;
                        const destLocName = action.payload.destinationLocationName || destLocId;
                        const prevKickedMsg = findPrevMsg(updatedData, kickedChar.id);
                        if (destLocId) {
                            if (!updatedData.interactionHistories[destLocId]) {
                                updatedData.interactionHistories[destLocId] = [];
                            }
                            const kickMsg = createMessage(kickedChar, {
                                ...(isQuietEnter ? {} : { textContent: `[Entered "${destLocName}"]` }),
                                timestamp: sequenceTime,
                                parentMessageId: currentLastMessageId,
                                previousMessage: prevKickedMsg,
                                interactionData: updatedData,
                            });
                            currentLastMessageId = kickMsg.id;
                            updatedData.interactionHistories[destLocId] = [...updatedData.interactionHistories[destLocId], kickMsg];
                        }
                        updatedData = { ...updatedData, lastUpdatedTimestamp: sequenceTime };
                        changed = true;
                        if (!isQuietLeave && !isQuietEnter) {
                            options?.onToast?.(`👢 ${action.payload.characterName} kicked to ${destLocName}.`, 'info');
                        } else if (!isQuietLeave) {
                            options?.onToast?.(`👢 ${action.payload.characterName} was kicked out.`, 'info');
                        }
                    }
                    break;
                }
                case 'summon': {
                    const charId = action.payload.characterId;
                    const sessionParticipants = updatedData.participants || [];
                    if (sessionParticipants.some(p => p.id === charId)) break;
                    const realCharacter = allCharacters.find(c => c.id === charId);
                    if (!realCharacter) { options?.onToast?.(`⚠️ Cannot summon "${action.payload.characterName}": not found.`, 'error'); break; }
                    updatedData = { ...updatedData, participants: [...sessionParticipants, { ...realCharacter }], lastUpdatedTimestamp: sequenceTime };
                    changed = true;
                    options?.onToast?.(`✨ ${realCharacter.name} joined.`, 'info');
                    break;
                }
                case 'unsummon': {
                    const charId = action.payload.characterId;
                    const sessionParticipants = updatedData.participants || [];
                    const existingChar = sessionParticipants.find(p => p.id === charId);
                    if (!existingChar) {
                        options?.onToast?.(`⚠️ Cannot unsummon "${action.payload.characterName}": not in session.`, 'error');
                        break;
                    }
                    if (updatedData.protagonistIds?.includes(charId)) {
                        options?.onToast?.(`⚠️ Cannot unsummon session protagonist "${existingChar.name}".`, 'error');
                        break;
                    }
                    updatedData = {
                        ...updatedData,
                        participants: sessionParticipants.filter(p => p.id !== charId),
                        lastUpdatedTimestamp: sequenceTime
                    };
                    changed = true;
                    options?.onToast?.(`💨 ${existingChar.name} was unsummoned.`, 'info');
                    break;
                }
                case 'lock_location': {
                    const charId = action.payload.characterId;
                    const locId = action.payload.locationId;
                    const realChar = allCharacters.find(c => c.id === charId) || updatedData.participants.find(p => p.id === charId);
                    if (!realChar) break;
                    const prevMsg = findPrevMsg(updatedData, charId);
                    const newLocks = { ...(prevMsg?.characterLockedLocations ?? {}) };
                    newLocks[locId] = true;
                    const lockMsg = createMessage(realChar, {
                        characterLockedLocations: newLocks,
                        timestamp: sequenceTime,
                        parentMessageId: currentLastMessageId,
                        previousMessage: prevMsg,
                        interactionData: updatedData,
                    });
                    currentLastMessageId = lockMsg.id;
                    const charCurrentLocId = getCurrentLocation(updatedData, realChar)?.id || 'global';
                    if (!updatedData.interactionHistories[charCurrentLocId]) updatedData.interactionHistories[charCurrentLocId] = [];
                    updatedData.interactionHistories[charCurrentLocId] = [...updatedData.interactionHistories[charCurrentLocId], lockMsg];
                    changed = true;
                    break;
                }
                case 'unlock_location': {
                    const charId = action.payload.characterId;
                    const locId = action.payload.locationId;
                    const realChar = allCharacters.find(c => c.id === charId) || updatedData.participants.find(p => p.id === charId);
                    if (!realChar) break;
                    const prevMsg = findPrevMsg(updatedData, charId);
                    const newLocks = { ...(prevMsg?.characterLockedLocations ?? {}) };
                    delete newLocks[locId];
                    const unlockMsg = createMessage(realChar, {
                        characterLockedLocations: newLocks,
                        timestamp: sequenceTime,
                        parentMessageId: currentLastMessageId,
                        previousMessage: prevMsg,
                        interactionData: updatedData,
                    });
                    currentLastMessageId = unlockMsg.id;
                    const charCurrentLocId = getCurrentLocation(updatedData, realChar)?.id || 'global';
                    if (!updatedData.interactionHistories[charCurrentLocId]) updatedData.interactionHistories[charCurrentLocId] = [];
                    updatedData.interactionHistories[charCurrentLocId] = [...updatedData.interactionHistories[charCurrentLocId], unlockMsg];
                    changed = true;
                    break;
                }
                case 'administrator_switch_model': options?.onToast?.(`🔧 Switch to "${action.payload.modelName}" requested.`, 'info'); break;
                case 'administrator_toggle_account': options?.onToast?.(`🔑 Toggle account "${action.payload.accountId}" requested.`, 'info'); break;
                case 'administrator_join_session': options?.onToast?.(`👥 Join session "${action.payload.sessionId}" requested.`, 'info'); break;
                case 'administrator_leave_session': options?.onToast?.(`👥 Leave session requested.`, 'info'); break;
                case 'administrator_accept_join': options?.onToast?.(`👥 Accept join for "${action.payload.accountId}" requested.`, 'info'); break;
                case 'administrator_reject_join': options?.onToast?.(`👥 Reject join for "${action.payload.accountId}" requested.`, 'info'); break;
                case 'administrator_edit_entity': options?.onToast?.(`🔧 Edit ${action.payload.entityType} "${action.payload.entityId}" (${action.payload.field}) requested.`, 'info'); break;
                case 'creator': options?.onToast?.(`🛠️ ${action.payload.entityType} "${action.payload.entityName}" creation requested.`, 'info'); break;
                case 'destroyer': options?.onToast?.(`💀 ${action.payload.entityType} "${action.payload.entityName}" deletion requested.`, 'info'); break;
            }
        }

        for (const [locId, msgs] of Object.entries(updatedData.interactionHistories)) {
            const targetMsgIdx = msgs.findIndex(m => m.id === targetMsg.id);
            if (targetMsgIdx !== -1) {
                const cleanedMsg = { ...msgs[targetMsgIdx] } as ChatMessage | ToolMessage | WhisperMessage;
                delete cleanedMsg.pendingToolActions;
                updatedData.interactionHistories[locId] = [...msgs];
                updatedData.interactionHistories[locId][targetMsgIdx] = cleanedMsg;
                changed = true;
                break;
            }
        }
    }

    if (!changed) return data;
    return { ...updatedData, lastUpdatedTimestamp: sequenceTime };
}