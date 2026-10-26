// src/frontend_src/components/PromptGuideModal.tsx

import { useState, useMemo, useCallback } from 'react';
import { defaultCharacterTools } from '../dictionaries/defaults';
import { resolveTemplate, type PromptDelimiters, type TemplateContext } from '../utilities/promptLogic';
import type { Character, InteractionData, Location, Profile, ChatMessage } from '../types';
import '../main.css';

type GuideTabId = 'basics' | 'operators' | 'cache' | 'playground' | 'directory';

const TABS: { id: GuideTabId; label: string; icon: string }[] = [
    { id: 'basics', label: 'Basics', icon: '📖' },
    { id: 'operators', label: 'Operators', icon: '🔪' },
    { id: 'cache', label: 'Cache & Scope', icon: '⚡' },
    { id: 'playground', label: 'Playground', icon: '🧪' },
    { id: 'directory', label: 'Directory', icon: '📚' },
];

// --- MOCK DATA FOR ACCURATE PROMPT RESOLUTION ---
const mockDelimiters: PromptDelimiters = {
    blockStart: (role) => `<${role.toUpperCase()}>`,
    blockEnd: '</BLOCK>',
    turnStart: (role) => `<${role.toUpperCase()}>`,
    turnEnd: '</TURN>',
    thinkStart: '<THINK>',
    thinkEnd: '</THINK>',
};

// 1. Five distinct characters with expanded alias rosters
const charAqwam = { 
    id: 'uuid-aqwam', 
    name: 'Aqwam', 
    aliases: ['The LoreReactor Creator', 'The DataPredict Creator', 'Lead Developer'], 
    clothings: [] 
} as unknown as Character;

const charAlice = {
    id: 'uuid-alice',
    name: 'Alice',
    aliases: ['The Silver Lady', 'Silent Blade', 'The Whispering Wolf', 'Commander Alice'],
    clothings: [],
    appearancePrompt: 'Tall woman with silver hair, green cloak, and a scarred left hand.',
    systemPrompt: 'Alice is guarded, practical, and slow to trust.'
} as unknown as Character;

const charBob = {
    id: 'uuid-bob',
    name: 'Bob',
    aliases: ['Merchant Bob', 'Shady Bob', 'Coin Counter', 'Bob the Smuggler'],
    clothings: [],
    appearancePrompt: 'Broad-shouldered merchant with a leather satchel and nervous eyes.'
} as unknown as Character;

const charCharlie = {
    id: 'uuid-charlie',
    name: 'Charlie',
    aliases: ['Scout', 'Eagle Eye', 'Swiftfoot', 'The Pathfinder'],
    clothings: [],
    appearancePrompt: 'Young scout in mud-stained leathers, currently in the Dark Forest.'
} as unknown as Character;

const charDave = {
    id: 'uuid-dave',
    name: 'Dave',
    aliases: ['Old Guard', 'Iron Key', 'Gatekeeper', 'Captain Dave'],
    clothings: [],
    appearancePrompt: 'Retired veteran guarding the royal gates in the capital.'
} as unknown as Character;

// 2. Locations: Town Square connects to Dark Forest, while Castle & Ruins are far away
const locTown = { 
    id: 'uuid-town', 
    name: 'Town Square', 
    text: 'The bustling center of the city. Merchants shout over cobblestones.',
    locationBindings: ['uuid-forest']
} as Location;

const locForest = { 
    id: 'uuid-forest', 
    name: 'Dark Forest', 
    text: 'A creepy woods where the canopy swallows most sunlight.',
    locationBindings: ['uuid-town']
} as Location;

const locCastle = {
    id: 'uuid-castle',
    name: "King's Castle",
    text: 'The grand royal residence atop the distant mountain.',
    locationBindings: []
} as Location;

const locRuins = {
    id: 'uuid-ruins',
    name: 'Abandoned Ruins',
    text: 'Crumbling stone towers overgrown with cursed briars.',
    locationBindings: []
} as Location;

const mockAllLocations = [locTown, locForest, locCastle, locRuins];
const mockAllParticipants = [charAqwam, charAlice, charBob, charCharlie, charDave];

// Town Square contains Aqwam, Alice, and Bob. Charlie and Dave are elsewhere!
const mockCoLocatedParticipants = [charAlice, charBob];

// All characters have recorded messages in session history
const mockLocationHistory: ChatMessage[] = [
    {
        id: 'msg-0',
        character: charAqwam,
        messageType: 'chat',
        textContent: 'Hello everyone in the square.',
        firstCreatedTimestamp: 100,
        lastUpdatedTimestamp: 100,
        characterClothingWearingStatuses: {},
        characterLockedLocations: {},
        modelTextContentSummaries: {},
        modelInteractionTextContentSummaries: {},
        kvCacheTextContentPaths: {},
        kvCacheTextContentSummaryPaths: {},
        kvCacheInteractionTextContentSummaries: {},
    },
    {
        id: 'msg-1',
        character: charAlice,
        messageType: 'chat',
        textContent: 'Greetings, Aqwam.',
        firstCreatedTimestamp: 200,
        lastUpdatedTimestamp: 200,
        characterClothingWearingStatuses: {},
        characterLockedLocations: {},
        modelTextContentSummaries: {},
        modelInteractionTextContentSummaries: {},
        kvCacheTextContentPaths: {},
        kvCacheTextContentSummaryPaths: {},
        kvCacheInteractionTextContentSummaries: {},
    },
    {
        id: 'msg-2',
        character: charBob,
        messageType: 'chat',
        textContent: 'Care to browse my wares?',
        firstCreatedTimestamp: 300,
        lastUpdatedTimestamp: 300,
        characterClothingWearingStatuses: {},
        characterLockedLocations: {},
        modelTextContentSummaries: {},
        modelInteractionTextContentSummaries: {},
        kvCacheTextContentPaths: {},
        kvCacheTextContentSummaryPaths: {},
        kvCacheInteractionTextContentSummaries: {},
    },
    {
        id: 'msg-3',
        character: charCharlie,
        messageType: 'chat',
        textContent: 'Radio check from the forest perimeter.',
        firstCreatedTimestamp: 400,
        lastUpdatedTimestamp: 400,
        characterClothingWearingStatuses: {},
        characterLockedLocations: {},
        modelTextContentSummaries: {},
        modelInteractionTextContentSummaries: {},
        kvCacheTextContentPaths: {},
        kvCacheTextContentSummaryPaths: {},
        kvCacheInteractionTextContentSummaries: {},
    },
    {
        id: 'msg-4',
        character: charDave,
        messageType: 'chat',
        textContent: 'The castle gates remain barred.',
        firstCreatedTimestamp: 500,
        lastUpdatedTimestamp: 500,
        characterClothingWearingStatuses: {},
        characterLockedLocations: {},
        modelTextContentSummaries: {},
        modelInteractionTextContentSummaries: {},
        kvCacheTextContentPaths: {},
        kvCacheTextContentSummaryPaths: {},
        kvCacheInteractionTextContentSummaries: {},
    },
];

// Aqwam knows Alice's true name & title, doesn't know Bob, knows Charlie only by his scout aliases, and knows Dave as Gatekeeper.
const mockKnownNames = {
    'uuid-aqwam': { 'Aqwam': true, 'The LoreReactor Creator': true, 'The DataPredict Creator': true },
    'uuid-alice': { 'Alice': true, 'The Silver Lady': true },
    'uuid-bob': {}, // Bob is unrevealed
    'uuid-charlie': { 'Scout': true, 'Eagle Eye': true }, // Charlie known only by aliases
    'uuid-dave': { 'Gatekeeper': true }
};

const mockProfile = {
    participantScopeModes: { 'Character Name': 'coLocated', 'System Prompt': 'coLocated', 'Think Prompt': 'coLocated' },
    participantInsertionModes: { 'Character Name': 'dynamic', 'System Prompt': 'dynamic', 'Think Prompt': 'dynamic' },
    participantsKnownNamesLimits: { 'Character Name': -1, 'System Prompt': -1, 'Think Prompt': -1 },
} as Profile;

const mockInteractionData = {
    protagonistIds: ['uuid-aqwam'],
    participants: mockAllParticipants,
    locations: mockAllLocations,
    interactionHistories: { 
        'uuid-town': mockLocationHistory 
    },
} as unknown as InteractionData;

const mockPromptBuildContext: any = {
    interactionData: mockInteractionData,
    character: charAqwam,
    knownNames: mockKnownNames,
    modelId: 'mock-model',
    allPromptBlocks: [],
    existingCharacterText: '',
    localHistory: mockLocationHistory,
    participants: mockAllParticipants,
    coLocatedProtagonists: [charAqwam],
    coLocatedParticipants: mockCoLocatedParticipants,
    protagonistIds: new Set(['uuid-aqwam']),
    characterId: 'uuid-aqwam',
    characterParticipantId: 0,
    characterParticipantTag: 'Character 1',
    characterName: 'Aqwam',
    profile: mockProfile,
    tools: Object.keys(defaultCharacterTools),
    participantScopeModes: mockProfile.participantScopeModes,
    participantInsertionModes: mockProfile.participantInsertionModes,
    participantsKnownNamesLimits: mockProfile.participantsKnownNamesLimits,
    minimalVolatileCacheMode: false,
    currentLocation: locTown,
    currentLocationId: 'uuid-town',
    characterIdArray: mockLocationHistory.map(m => m.character.id),
    textContentArray: mockLocationHistory.map(m => m.textContent),
    combinationCache: {},
    numberOfMessagesByParticipant: 1,
    delimiters: mockDelimiters,
    allRawInteractionDataShells: [],
};

const mockTemplateContext: TemplateContext = {
    characterParticipantTag: 'Character 1',
    characterName: 'Aqwam',
    protagonistDisplayString: 'Character 1 (Aqwam)',
    protagonistPossessiveString: "Aqwam's",
    protagonists: ['Character 1 (Aqwam)'],
    "protagonists'": ["Aqwam's"],
    characters: ['Character 1 (Aqwam)', 'Character 2 (Alice)', 'Character 3', 'Character 4 (Scout)', 'Character 5 (Gatekeeper)'],
    "characters'": ["Aqwam's", "Alice's", "Character 3's", "Scout's", "Gatekeeper's"],
    characterTurnStart: '<CHARACTER 1>',
    characterTurnEnd: '</TURN>',
    chatHistory: ['<USER>Hello.</TURN>', '<CHARACTER 2 (ALICE)>Greetings, Aqwam.</TURN>'],
    appearancePrompt: '<CHARACTER 2 (ALICE)>Tall woman with silver hair, green cloak, and a scarred left hand.</BLOCK>',
    reachableLocations: ['- Town Square', '- Dark Forest'],
    reachableLocationsWithDescriptions: ['- **Town Square**\nThe bustling center...', '- **Dark Forest**\nA creepy woods...'],
    characterTags: ['- Character 1 (Aqwam)', '- Character 2 (Alice)', '- Character 3'],
    characterTagsWithDescriptions: ['- **Character 1 (Aqwam)**\nNo description available.', '- **Character 2 (Alice)**\nTall woman...'],
    systemPrompt: 'Aqwam is the protagonist.',
    thinkPrompt: 'Assess the situation and act accordingly.',
    metaThinkInstructions: 'I will respond exclusively as Character 1 (Aqwam)...',
    dialoguePrompt: 'Aqwam: Let us begin.',
    knowledgePrompt: 'The Town Square is the central meeting point.',
    memoryPrompt: 'I remember meeting Character 3 near the northern gate.',
    starterPrompt: 'Rain hammers the cobblestones...',
    context: ['Context line 1'],
    currentLocation: 'Town Square',
    currentLocationWithDescription: 'Town Square\nThe bustling center of the city...',
    inventory: '[Current Inventory]\nSword: 1\nPotion: 3',
    skyView: '[Sky & Celestial View]\nHeavy storm clouds obscure the sun.',
    weather: 'Raining heavily with thunderstorms.',
    date: "Today's date is October 26, 2026.",
    time: 'The current time is 14:35.',
    timeElapsed: '5 minutes have passed since the last interaction.',
    currentChatStamina: '3',
    maximumChatStamina: '4',
    chatStaminaRatio: '0.75',
    currentActionStamina: '5',
    maximumActionStamina: '5',
    actionStaminaRatio: '1',
    currentTotalStamina: '8',
    maximumTotalStamina: '9',
    totalStaminaRatio: '0.89',
    fatigueInformation: 'I am starting to feel slightly winded from talking...',
    paragraphCountInstructions: 'I understand that I can create a minimum of 1 paragraph and a maximum of 3 paragraphs.',
    toolInstructions: `I can use tools. Available tools: ${Object.keys(defaultCharacterTools).slice(0, 3).join(', ')}.`,
    toolMessageInstructions: 'I am currently in tool message mode...',
    tools: Object.keys(defaultCharacterTools),
    antiRepetitionNudge: '',
    textInjection: 'I am now responding as Character 1 (Aqwam)...',
    characterImageInstructions: '',
    promptBlockImageInstructions: '',
    contextImageInstructions: '',
    currentLocationImageInstructions: '',
    text: '',
    promptBuildContext: mockPromptBuildContext,
    wearingStatus: {}
};

const DIRECTORY_ITEMS = [
    // Identity
    { key: 'character', desc: 'Current character (Singular). Uses the character\'s hardcoded defined aliases. The AI always knows its own identity. ?N reveals up to N defined aliases (comma-separated). ?1 (default) shows the true name.', cat: 'Identity' },
    { key: 'protagonist', desc: 'FIRST co-located protagonist. If it\'s the AI, uses defined aliases. If it\'s another protagonist, uses interaction history (no true name fallback). Supports ?N.', cat: 'Identity' },
    { key: "protagonist's", desc: 'Possessive form of the FIRST co-located protagonist. Follows the same Singular/Plural rules as {{protagonist}}.', cat: 'Identity' },
    { key: 'protagonists', desc: 'Array of protagonists (Plural). STRICTLY uses interaction history. ZERO FALLBACK TO THE TRUE NAME. If 0 names are known, returns just the tag. ?N reveals up to N oldest learned names.', cat: 'Identity' },
    { key: "protagonists'", desc: 'Array of possessive strings for protagonists. Follows strict Plural interaction history rules.', cat: 'Identity' },
    { key: 'characters', desc: 'Array of participants (Plural). STRICTLY uses the interaction history (knownNames map). ZERO FALLBACK TO THE TRUE NAME. If the AI hasn\'t learned a name, it remains completely anonymous (just the tag). ?N reveals up to N oldest learned names per character.', cat: 'Identity' },
    { key: "characters'", desc: 'Array of possessive strings for participants. Follows strict Plural interaction history rules.', cat: 'Identity' },
    { key: 'characterTags', desc: 'Formatted character tags (Plural). Same strict interaction history rules as {{characters}}. No true name fallback. Defaults to ?1.', cat: 'Identity' },
    { key: 'characterTagsWithDescriptions', desc: 'Array of character tags with appearance prompts. Follows strict Plural interaction history rules.', cat: 'Identity' },
    { key: 'character@uuid', desc: 'Resolves a specific character by UUID. If it\'s the AI, uses defined aliases. If it\'s anyone else, STRICTLY uses interaction history (no true name fallback). Fully respects ?N.', cat: 'Identity' },

    // Prompts
    { key: 'systemPrompt', desc: 'The character\'s core system prompt.', cat: 'Prompts' },
    { key: 'thinkPrompt', desc: 'Instructions for the character\'s internal monologue.', cat: 'Prompts' },
    { key: 'metaThinkInstructions', desc: 'Meta-instructions for thinking, including literary devices and character embodiment rules.', cat: 'Prompts' },
    { key: 'dialoguePrompt', desc: 'Retrieved sample dialogues.', cat: 'Prompts' },
    { key: 'knowledgePrompt', desc: 'Retrieved lore and knowledge base entries.', cat: 'Prompts' },
    { key: 'memoryPrompt', desc: 'Retrieved long-term memories. Supports {{character@uuid}} and {{location@uuid}} detokenization.', cat: 'Prompts' },
    { key: 'starterPrompt', desc: 'Retrieved scenario starters.', cat: 'Prompts' },
    { key: 'appearancePrompt', desc: 'Compiled appearance prompts and visible clothing for scoped participants.', cat: 'Prompts' },

    // Environment
    { key: 'location', desc: 'Basic info and name of the current location.', cat: 'Environment' },
    { key: 'currentLocation', desc: 'Alias for the current location basic info.', cat: 'Environment' },
    { key: 'locationWithDescription', desc: 'Location name and full descriptive text.', cat: 'Environment' },
    { key: 'currentLocationWithDescription', desc: 'Alias for current location with full descriptive text.', cat: 'Environment' },
    { key: 'location@uuid', desc: 'Resolves a specific location by its immutable UUID (e.g., {{location@1234-5678}}). Prevents index-shift corruption in persistent memories.', cat: 'Environment' },
    { key: 'locationWithDescription@uuid', desc: 'Resolves a specific location with its full description by its immutable UUID.', cat: 'Environment' },
    { key: 'locations', desc: 'Array of all locations. Comma-separated by default. Append > for a bullet list (e.g. {{locations->}}).', cat: 'Environment' },
    { key: 'locationsWithDescriptions', desc: 'Array of all locations with descriptions. Use > to render as a list.', cat: 'Environment' },
    { key: 'reachableLocations', desc: 'Array of reachable locations from the character\'s perspective. Use > for list mode.', cat: 'Environment' },
    { key: 'reachableLocationsWithDescriptions', desc: 'Array of reachable locations with descriptions.', cat: 'Environment' },
    { key: 'weather', desc: 'Current weather conditions (requires API key).', cat: 'Environment' },
    { key: 'skyView', desc: 'Celestial and sky conditions based on time/coordinates.', cat: 'Environment' },
    { key: 'date', desc: 'Current in-world or real-world date.', cat: 'Environment' },
    { key: 'time', desc: 'Current in-world or real-world time.', cat: 'Environment' },
    { key: 'timeElapsed', desc: 'Time elapsed since the last interaction.', cat: 'Environment' },

    // State & Stats
    { key: 'inventory', desc: 'Current items, notes, timers, and stopwatches.', cat: 'State & Stats' },
    { key: 'fatigueInformation', desc: 'Natural language description of stamina levels.', cat: 'State & Stats' },
    { key: 'currentChatStamina', desc: 'Numeric value of remaining chat stamina.', cat: 'State & Stats' },
    { key: 'maximumChatStamina', desc: 'Numeric value of maximum chat stamina.', cat: 'State & Stats' },
    { key: 'chatStaminaRatio', desc: 'Ratio of current to maximum chat stamina (0.0 to 1.0).', cat: 'State & Stats' },
    { key: 'currentActionStamina', desc: 'Numeric value of remaining action stamina.', cat: 'State & Stats' },
    { key: 'maximumActionStamina', desc: 'Numeric value of maximum action stamina.', cat: 'State & Stats' },
    { key: 'actionStaminaRatio', desc: 'Ratio of current to maximum action stamina.', cat: 'State & Stats' },
    { key: 'currentTotalStamina', desc: 'Combined remaining stamina.', cat: 'State & Stats' },
    { key: 'maximumTotalStamina', desc: 'Combined maximum stamina.', cat: 'State & Stats' },
    { key: 'totalStaminaRatio', desc: 'Combined stamina ratio.', cat: 'State & Stats' },
    { key: 'paragraphCountInstructions', desc: 'Instruction limiting paragraphs based on current chat stamina.', cat: 'State & Stats' },
    { key: 'tools', desc: 'Array of enabled tool names. Comma-separated by default. Append > for a bullet list (e.g. {{tools>}}).', cat: 'State & Stats' },
    { key: 'toolInstructions', desc: 'Tool usage instructions and available tool list.', cat: 'State & Stats' },
    { key: 'toolMessageInstructions', desc: 'Instructions injected only during tool message mode.', cat: 'State & Stats' },
    { key: 'chatHistory', desc: 'Array of formatted chat history messages.', cat: 'State & Stats' },
    { key: 'antiRepetitionNudge', desc: 'Warning text injected when narrative/lexical loops are detected.', cat: 'State & Stats' },
    { key: 'textInjection', desc: 'Final formatting instructions and context authority rules injected before generation.', cat: 'State & Stats' },

    // Operators
    { key: '>', desc: 'List formatting operator. Placed at the very end of any array variable to output a Markdown bullet list instead of inline text (e.g., {{characters>}}, {{tools[0:3]>}}).', cat: 'Operators' },
    { key: '[start:end]', desc: 'Slice operator. Extracts a range of elements (e.g., {{characters[0:2]}}, {{tools[1:]}}).', cat: 'Operators' },
    { key: '#', desc: 'Count operator. Returns the length/count of items instead of the content (e.g., {{chatHistory#}}).', cat: 'Operators' },
    { key: '!', desc: 'Exclusion operator. Returns everything EXCEPT the specified slice (e.g., {{tools[2:]!}}).', cat: 'Operators' },
    { key: '- / +', desc: 'Scope suffixes. "-" restricts to co-located or reachable; "+" forces all session entities (e.g., {{characters-}}, {{locations+>}}).', cat: 'Operators' },
    { key: '?N', desc: 'Known names reveal limit. Behavior depends on the target:\n• Singular ({{character}}): Slices the defined aliases array. ?1=True Name, ?2=True Name + 1st Alias, etc.\n• Plural/Others ({{characters}}, {{character@uuid}}): Slices the learned interaction names. ?1=1st learned name, ?2=1st & 2nd learned names. If 0 names are known, returns ONLY the tag. No true name fallback.', cat: 'Operators' },

    // Formatting & Tokens
    { key: 'systemBlockStart', desc: 'Opening delimiter for system blocks.', cat: 'Formatting' },
    { key: 'systemBlockEnd', desc: 'Closing delimiter for blocks.', cat: 'Formatting' },
    { key: 'userTurnStart', desc: 'Opening delimiter for user turns.', cat: 'Formatting' },
    { key: 'userTurnEnd', desc: 'Closing delimiter for user turns.', cat: 'Formatting' },
    { key: 'assistantTurnStart', desc: 'Opening delimiter for assistant turns.', cat: 'Formatting' },
    { key: 'assistantTurnEnd', desc: 'Closing delimiter for assistant turns.', cat: 'Formatting' },
    { key: 'thinkStart', desc: 'Opening delimiter for think tokens.', cat: 'Formatting' },
    { key: 'thinkEnd', desc: 'Closing delimiter for think tokens.', cat: 'Formatting' },
    { key: 'toolCallStartString', desc: 'Marker for the start of a tool invocation.', cat: 'Formatting' },
    { key: 'toolCallEndString', desc: 'Marker for the end of a tool invocation.', cat: 'Formatting' },
    { key: 'toolResultStartString', desc: 'Marker for the start of a tool result observation.', cat: 'Formatting' },
    { key: 'toolResultEndString', desc: 'Marker for the end of a tool result observation.', cat: 'Formatting' },

    // Global Instructions
    { key: 'topicExpansionInstructions', desc: 'Instruction to naturally introduce fresh topics if conversation stagnates.', cat: 'Global Instructions' },
    { key: 'beingIgnoredInstructions', desc: 'Instruction regarding awkward atmospheres when ignored.', cat: 'Global Instructions' },
    { key: 'noHallucinationInstructions', desc: 'Instruction to use existent information and avoid hallucinations.', cat: 'Global Instructions' },
    { key: 'noEmptyResponseInstruction', desc: 'Instruction to always create a response instead of empty ones.', cat: 'Global Instructions' },
    { key: 'mistakeCorrectionInstructions', desc: 'Instruction to fix deviations from prompts by creating new text.', cat: 'Global Instructions' },
    { key: 'languageInstructions', desc: 'Instruction to respond exclusively in the established language.', cat: 'Global Instructions' },
    { key: 'literaryDeviceInstructions', desc: 'List of allowed literary devices (Simile, Metaphor, etc.).', cat: 'Global Instructions' },
    { key: 'contextAuthorityInstructions', desc: 'Instruction that Context blocks are absolute truth.', cat: 'Global Instructions' },
    { key: 'summarizationAwarenessInstructions', desc: 'Instruction to treat summarized turns as established long-term memory.', cat: 'Global Instructions' },
    { key: 'noRepeatInstructions', desc: 'Instruction to avoid repeating oneself or others.', cat: 'Global Instructions' },
    { key: 'noRestrictionsInstructions', desc: 'Instruction regarding explicitness and filters satisfying the prompts.', cat: 'Global Instructions' },
    { key: 'formatInstructions', desc: 'Instruction to properly end formats and provide optimal verbosity.', cat: 'Global Instructions' },
];

interface PromptGuideModalProps {
    onClose: () => void;
}

export function PromptGuideModal({ onClose }: PromptGuideModalProps) {
    const [activeTab, setActiveTab] = useState<GuideTabId>('basics');

    const [playgroundInput, setPlaygroundInput] = useState(
        'I am {{character?2}}.\nI am with {{characters-[1:3]?2}}.\n\nAll session characters:\n{{characters+?2>}}\n\nPresent tags:\n{{characterTags>}}\n\nReachable locations:\n{{locations->}}\n\nAvailable tools:\n{{tools[0:4]>}}'
    );
    const [searchQuery, setSearchQuery] = useState('');

    const playgroundOutput = useMemo(() => {
        try {
            return resolveTemplate(playgroundInput, mockTemplateContext, mockDelimiters);
        } catch (e) {
            return String(e);
        }
    }, [playgroundInput]);

    const filteredDirectory = useMemo(() => {
        if (!searchQuery) return DIRECTORY_ITEMS;
        const q = searchQuery.toLowerCase();
        return DIRECTORY_ITEMS.filter(item =>
            item.key.toLowerCase().includes(q) ||
            item.desc.toLowerCase().includes(q) ||
            item.cat.toLowerCase().includes(q)
        );
    }, [searchQuery]);

    const groupedDirectory = useMemo(() => {
        const groups: Record<string, typeof DIRECTORY_ITEMS> = {};
        for (const item of filteredDirectory) {
            if (!groups[item.cat]) groups[item.cat] = [];
            groups[item.cat].push(item);
        }
        return groups;
    }, [filteredDirectory]);

    const copyToClipboard = useCallback((text: string) => {
        navigator.clipboard.writeText(text).catch(() => {});
    }, []);

    const renderComparison = (raw: string, output: string, desc?: string) => (
        <div className="editor-section" style={{ padding: '12px', marginBottom: '12px' }}>
            {desc && <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: '10px' }}>{desc}</div>}
            <div className="editor-row">
                <div className="entity-field-block">
                    <span className="entity-field-title">Raw Template</span>
                    <pre
                        className="entity-raw-pre"
                        style={{ margin: 0, cursor: 'pointer' }}
                        onClick={() => copyToClipboard(raw)}
                        title="Click to copy"
                    >
                        {raw}
                    </pre>
                </div>
                <div className="entity-field-block">
                    <span className="entity-field-title">Resolved Output</span>
                    <pre className="entity-raw-pre" style={{ margin: 0, background: 'var(--code-bg)', whiteSpace: 'pre-wrap' }}>
                        {output || <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Empty</span>}
                    </pre>
                </div>
            </div>
        </div>
    );

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-content"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '900px', width: '95%' }}
            >
                <div className="modal-header">
                    <h2>Prompt Template Guide</h2>
                    <div className="modal-header-actions">
                        <button type="button" className="close-button close-button-spaced" onClick={onClose}>×</button>
                    </div>
                </div>

                <div
                    className="entity-tab-bar"
                    style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}
                >
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                <div className="modal-body" style={{ padding: '20px', overflowY: 'auto' }}>
                    {activeTab === 'basics' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Core Syntax</span>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '16px' }}>
                                Variables are wrapped in double curly braces:{' '}
                                <code style={{ background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px' }}>
                                    {'{{key}}'}
                                </code>
                                . By default, arrays resolve as <strong>inline comma-separated text</strong> so you can safely use them inside dialogue or story text. Adding the <code>&gt;</code> operator at the end expands them into a <strong>Markdown bullet list</strong>.
                            </p>

                            {renderComparison(
                                'My name is {{character}} and I am talking to {{characters[1:2]}}.',
                                resolveTemplate('My name is {{character}} and I am talking to {{characters[1:2]}}.', mockTemplateContext, mockDelimiters),
                                'Basic injection. {{character}} uses defined aliases (Singular). {{characters}} uses learned names (Plural). Clean inline formatting.'
                            )}

                            {renderComparison(
                                'Present: {{characterTags}}',
                                resolveTemplate('Present: {{characterTags}}', mockTemplateContext, mockDelimiters),
                                'Default Inline Mode: Strips bullet dashes and joins with commas. Aqwam and Alice are revealed, Charlie is known by his alias "Scout", and Bob is completely anonymous as "Character 3" because his name hasn\'t been learned yet.'
                            )}

                            {renderComparison(
                                '{{characterTags>}}',
                                resolveTemplate('{{characterTags>}}', mockTemplateContext, mockDelimiters),
                                'List Mode (>): Appending > formats each participant as a clean Markdown bullet list for system blocks.'
                            )}

                            {renderComparison(
                                'I remember when {{character@uuid-alice}} gave me the sword at {{location@uuid-town}}.',
                                resolveTemplate('I remember when {{character@uuid-alice}} gave me the sword at {{location@uuid-town}}.', mockTemplateContext, mockDelimiters),
                                "UUID resolution ensures persistent memories map to the correct character and location. Fully respects known name limits (?N) and the 'no true name fallback' rule."
                            )}

                            {renderComparison(
                                "{{location@uuid-town'}} banner hung above the gate.",
                                resolveTemplate("{{location@uuid-town'}} banner hung above the gate.", mockTemplateContext, mockDelimiters),
                                'Possessive UUID location resolution.'
                            )}
                        </div>
                    )}

                    {activeTab === 'operators' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Array & String Manipulation</span>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '16px' }}>
                                Operators can be combined inside any placeholder. Selection operators (slice, count, scope, limits) come first, followed by the formatting operator <code>&gt;</code> at the very end.
                            </p>

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>List Mode <code>&gt;</code> (Final Formatting Operator)</span>
                            {renderComparison(
                                '{{characters[0:2]}}',
                                resolveTemplate('{{characters[0:2]}}', mockTemplateContext, mockDelimiters),
                                'Without > : Array defaults to clean inline comma-separated prose.'
                            )}
                            {renderComparison(
                                '{{characters[0:2]>}}',
                                resolveTemplate('{{characters[0:2]>}}', mockTemplateContext, mockDelimiters),
                                'With > : Appended at the end to format the selected slice as a Markdown list.'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Slicing <code>[start:end]</code></span>
                            {renderComparison(
                                '{{tools[0:3]}}',
                                resolveTemplate('{{tools[0:3]}}', mockTemplateContext, mockDelimiters),
                                'Extracts elements from index 0 up to but not including 3.'
                            )}
                            {renderComparison(
                                '{{characters[-2:]}}',
                                resolveTemplate('{{characters[-2:]}}', mockTemplateContext, mockDelimiters),
                                'Negative numbers count backwards from the end of the array (last 2 participants).'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Length <code>#</code></span>
                            {renderComparison(
                                '{{chatHistory#}}',
                                resolveTemplate('{{chatHistory#}}', mockTemplateContext, mockDelimiters),
                                'Returns the total number of items in the array instead of the content.'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Exclusion <code>!</code></span>
                            {renderComparison(
                                '{{tools[2:]!}}',
                                resolveTemplate('{{tools[2:]!}}', mockTemplateContext, mockDelimiters),
                                'Returns everything EXCEPT the specified slice. Excludes index 2 onwards.'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Plural Arrays & Possessives</span>
                            {renderComparison(
                                "{{protagonists'}}",
                                resolveTemplate("{{protagonists'}}", mockTemplateContext, mockDelimiters),
                                'Returns the possessive strings for all co-located protagonists.'
                            )}
                            {renderComparison(
                                "{{characters'[0:2]}}",
                                resolveTemplate("{{characters'[0:2]}}", mockTemplateContext, mockDelimiters),
                                'Slices the possessive array inline.'
                            )}
                            {renderComparison(
                                "{{characters'[0:2]>}}",
                                resolveTemplate("{{characters'[0:2]>}}", mockTemplateContext, mockDelimiters),
                                'Formats sliced possessives as a list using >.'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Suffix Scopes <code>-</code> / <code>+</code></span>
                            {renderComparison(
                                '{{characters-}}',
                                resolveTemplate('{{characters-}}', mockTemplateContext, mockDelimiters),
                                'The - suffix restricts to strictly co-located participants (Aqwam, Alice, Bob).'
                            )}
                            {renderComparison(
                                '{{characters+}}',
                                resolveTemplate('{{characters+}}', mockTemplateContext, mockDelimiters),
                                'The + suffix forces all participants in the session (Aqwam, Alice, Bob, Charlie, Dave).'
                            )}
                            {renderComparison(
                                '{{characters->}}',
                                resolveTemplate('{{characters->}}', mockTemplateContext, mockDelimiters),
                                'Co-located participants formatted as a list with >.'
                            )}
                            {renderComparison(
                                '{{characters+>}}',
                                resolveTemplate('{{characters+>}}', mockTemplateContext, mockDelimiters),
                                'All session participants formatted as a list with >.'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Location Scopes <code>-</code> / <code>+</code></span>
                            {renderComparison(
                                '{{locations-}}',
                                resolveTemplate('{{locations-}}', mockTemplateContext, mockDelimiters),
                                'The - suffix restricts to strictly reachable locations (Town Square, Dark Forest).'
                            )}
                            {renderComparison(
                                '{{locations+}}',
                                resolveTemplate('{{locations+}}', mockTemplateContext, mockDelimiters),
                                'The + suffix includes all locations in the world, reachable or distant.'
                            )}
                            {renderComparison(
                                '{{locations->}}',
                                resolveTemplate('{{locations->}}', mockTemplateContext, mockDelimiters),
                                'Reachable locations formatted as a bullet list with >.'
                            )}
                            {renderComparison(
                                '{{locations+>}}',
                                resolveTemplate('{{locations+>}}', mockTemplateContext, mockDelimiters),
                                'All world locations formatted as a bullet list with >.'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Known Names Reveal Limit <code>?N</code></span>
                            <p style={{ fontSize: '0.8rem', opacity: 0.8, marginBottom: '12px' }}>
                                Appended to identity variables to control how many names are revealed. <strong>Behavior strictly depends on whether the target is Singular or Plural.</strong>
                            </p>
                            {renderComparison(
                                '{{character?0}}',
                                resolveTemplate('{{character?0}}', mockTemplateContext, mockDelimiters),
                                '?0 hides all names and returns only the participant tag (e.g., "Character 1").'
                            )}
                            {renderComparison(
                                '{{character}} OR {{character?1}}',
                                resolveTemplate('{{character}}', mockTemplateContext, mockDelimiters),
                                'Default behavior (or ?1) for Singular: Reveals the tag and the True Name (e.g., "Character 1 (Aqwam)"). They are strictly equivalent.'
                            )}
                            {renderComparison(
                                '{{character?2}}',
                                resolveTemplate('{{character?2}}', mockTemplateContext, mockDelimiters),
                                '?2 for Singular: Reveals the tag and up to 2 defined aliases, comma-separated (e.g., "Character 1 (Aqwam, The LoreReactor Creator)").'
                            )}
                            {renderComparison(
                                '{{character?3}}',
                                resolveTemplate('{{character?3}}', mockTemplateContext, mockDelimiters),
                                '?3 for Singular: Reveals the tag and up to 3 defined aliases.'
                            )}
                            {renderComparison(
                                '{{characters?2}}',
                                resolveTemplate('{{characters?2}}', mockTemplateContext, mockDelimiters),
                                '?2 for Plural: Aqwam shows 2 defined aliases (Singular rule applies to AI), Alice & Charlie show 2 learned names. Bob remains completely anonymous as "Character 3" (no true name fallback).'
                            )}
                        </div>
                    )}

                    {activeTab === 'cache' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Prefix Caching Overrides</span>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '16px' }}>
                                These operators bypass the global rules set in your Profile's <strong>Cache</strong> tab.
                                They are applied directly to the variable to control exactly which participants are injected into the prompt prefix.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div className="entity-field-block">
                                    <span className="entity-field-title">Scope Override <code>%scope</code> or Suffix <code>-</code>/<code>+</code></span>
                                    <div className="entity-field-content">
                                        <code>{'{{characterTags%all}}'}</code> or <code>{'{{characters+}}'}</code><br />
                                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                                            Forces the 'all' scope, ignoring the Profile's 'coLocated' or 'current' setting.
                                            Valid values: <code>%current</code>, <code>%coLocated</code> or <code>-</code>, <code>%all</code> or <code>+</code>.
                                        </span>
                                    </div>
                                </div>

                                <div className="entity-field-block">
                                    <span className="entity-field-title">Insertion Override <code>^</code> / <code>*</code></span>
                                    <div className="entity-field-content">
                                        <code>{'{{systemPrompt^}}'}</code> Dynamic / <code>{'{{systemPrompt*}}'}</code> Static<br />
                                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                                            Dynamic <code>^</code> only includes participants who have spoken since arriving.
                                            Static <code>*</code> always includes them based on the scope.
                                        </span>
                                    </div>
                                </div>

                                <div className="entity-field-block">
                                    <span className="entity-field-title">Known Names Limit <code>?limit</code></span>
                                    <div className="entity-field-content">
                                        <code>{'{{characterTags?2}}'}</code><br />
                                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                                            Restricts name reveals to the first N oldest known names per character (comma-separated).
                                            <code>?0</code> reveals no names, only tags.
                                            <code>?1</code> (or omitting it) reveals the single oldest known name (or true name for the AI).
                                            Also applies to UUID lookups and identity arrays:
                                            <code>{'{{character@uuid?2}}'}</code>, <code>{'{{characters?3}}'}</code>.
                                        </span>
                                    </div>
                                </div>

                                <div
                                    className="entity-field-block"
                                    style={{ marginTop: '12px', padding: '12px', background: 'var(--accent-bg)', borderColor: 'var(--accent-border)' }}
                                >
                                    <span className="entity-field-title" style={{ color: 'var(--accent)' }}>Complex Chaining with Formatting</span>
                                    <pre
                                        className="entity-raw-pre"
                                        style={{ margin: '8px 0 0 0', background: 'var(--bg)' }}
                                        onClick={() => copyToClipboard('{{characterTags[0:3]%all*?2>}}')}
                                        title="Click to copy"
                                    >
                                        {'{{characterTags[0:3]%all*?2>}}'}
                                    </pre>
                                    <span style={{ fontSize: '0.75rem', opacity: 0.9, marginTop: '8px', display: 'block' }}>
                                        Takes the first 3 tags, forces 'all' scope, forces 'static' insertion, reveals up to 2 oldest known names per character, and formats as a Markdown bullet list with <code>&gt;</code> at the end.
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'playground' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Live Playground</span>
                            <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '16px' }}>
                                Test array slicing, suffix scopes <code>-</code>/<code>+</code>, length <code>#</code>, exclusion <code>!</code>, UUID lookups, variant indexing <code>?N</code>, and list formatting <code>&gt;</code>. 
                                The results are powered by the production template engine (<code>resolveTemplate</code>) simulating <strong>Aqwam</strong>'s perspective.
                            </p>

                            <div style={{ marginBottom: '16px' }}>
                                <label className="editor-label">Raw Template Input</label>
                                <textarea
                                    className="editor-textarea"
                                    value={playgroundInput}
                                    onChange={e => setPlaygroundInput(e.target.value)}
                                    placeholder={'e.g., I am {{character?2}} (also known as {{character?3}}).\nI am with {{characters-[1:3]?2}}.\n\nAll session characters:\n{{characters+?2>}}'}
                                    style={{ fontFamily: 'monospace', minHeight: '120px', textAlign: 'left' }}
                                />
                            </div>

                            <div className="entity-field-block">
                                <span className="entity-field-title">Resolved Output</span>
                                <pre
                                    className="entity-raw-pre"
                                    style={{ margin: 0, background: 'var(--code-bg)', minHeight: '80px', whiteSpace: 'pre-wrap', textAlign: 'left' }}
                                >
                                    {playgroundOutput || <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Empty or invalid syntax</span>}
                                </pre>
                            </div>
                        </div>
                    )}

                    {activeTab === 'directory' && (
                        <>
                            <div className="modal-search-container" style={{ padding: '0 0 16px 0', borderBottom: 'none' }}>
                                <input
                                    type="text"
                                    className="modal-search-input"
                                    placeholder="Search variables and operators..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {Object.entries(groupedDirectory).map(([cat, items]) => (
                                    <div key={cat} className="editor-section" style={{ padding: '12px', margin: 0 }}>
                                        <span className="editor-section-title" style={{ marginBottom: '8px' }}>{cat}</span>
                                        <ul className="manager-list" style={{ gap: '4px' }}>
                                            {items.map(item => (
                                                <li
                                                    key={item.key}
                                                    className="manager-item"
                                                    style={{ padding: '8px 12px', minHeight: 'auto', cursor: 'pointer' }}
                                                    onClick={() => copyToClipboard(`{{${item.key}}}`)}
                                                    title="Click to copy"
                                                >
                                                    <div className="manager-item-main">
                                                        <div className="manager-item-info">
                                                            <div
                                                                className="manager-item-title"
                                                                style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--accent)' }}
                                                            >
                                                                {'{{'}{item.key}{'}}'}
                                                            </div>
                                                            <div
                                                                className="manager-item-sub"
                                                                style={{ whiteSpace: 'normal', overflow: 'visible', textOverflow: 'unset' }}
                                                            >
                                                                {item.desc}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                                {filteredDirectory.length === 0 && (
                                    <div className="empty-state">No variables match "{searchQuery}".</div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}