import { useState, useMemo, useCallback } from 'react';
import { defaultCharacterTools } from '../dictionaries/defaults';
import '../main.css';

type GuideTabId = 'basics' | 'operators' | 'cache' | 'playground' | 'directory';

const TABS: { id: GuideTabId; label: string; icon: string }[] = [
    { id: 'basics', label: 'Basics', icon: '📖' },
    { id: 'operators', label: 'Operators', icon: '🔪' },
    { id: 'cache', label: 'Cache & Scope', icon: '⚡' },
    { id: 'playground', label: 'Playground', icon: '🧪' },
    { id: 'directory', label: 'Directory', icon: '📚' },
];

const MOCK_DATA: Record<string, string[] | string> = {
    tools: Object.keys(defaultCharacterTools),
    characterTags: ['Character 1 (Alice)', 'Character 2 (Bob)', 'Character 3 (Charlie)', 'Character 4 (Dave)'],
    chatHistory: ['User: Hello.', 'Alice: Hi there!', 'User: How are you?', 'Alice: I am good.', 'Bob: Hey guys.'],
    
    // Unified Location Arrays (Use - for reachable, + for all)
    locations: ['Town Square', 'Dark Forest', 'Abandoned Castle', 'Tavern', 'King\'s Castle'],
    locationsWithDescriptions: [
        '- **Town Square**: The bustling center of the city.',
        '- **Dark Forest**: A creepy woods.',
        '- **Abandoned Castle**: Ruins.',
        '- **Tavern**: A cozy pub.',
        '- **King\'s Castle**: The royal residence.'
    ],
    "locations'": ["Town Square's", "Dark Forest's", "Abandoned Castle's", "Tavern's", "King's Castle's"],

    // Singular Location Tags
    location: 'Town Square',
    locationWithDescription: '- **Town Square**: The bustling center of the city.\nYou are standing in the middle of the plaza.',

    // UUID Resolution Mocks
    'character@uuid-alice': 'Character 1 (Alice)',
    'character@uuid-bob': 'Character 2 (Bob)',
    'location@uuid-town': 'Town Square',
    'location@uuid-forest': 'Dark Forest',
    'locationWithDescription@uuid-town': '- **Town Square**: The bustling center of the city.\nYou are standing in the middle of the plaza.',

    character: 'Character 1 (Alice)',
    protagonist: 'User',
    protagonists: ['User', 'Player 2'],
    "protagonists'": ["User's", "Player 2's"],
    characters: ['Character 1 (Alice)', 'Character 2 (Bob)', 'Character 3 (Charlie)', 'Character 4 (Dave)'],
    "characters'": ["Character 1 (Alice)'s", "Character 2 (Bob)'s", "Character 3 (Charlie)'s", "Character 4 (Dave)'s"],
    weather: 'Raining heavily with thunderstorms.',
    date: "Today's date is October 26, 2026.",
    time: 'The current time is 14:35.',
    timeElapsed: '5 minutes have passed since the last interaction.',
    metaThinkInstructions: 'I will respond exclusively as Character 1 (Alice), expressing only this character\'s perspective, actions, and speech. I may or may not use these literary devices: Dialogue, Simile, Metaphor...',
    inventory: '[Current Inventory]\nSword: 1\nPotion: 3',
    fatigueInformation: 'I am starting to feel slightly winded from talking, but still have plenty of energy to speak.',
    currentChatStamina: '3',
    maximumChatStamina: '4',
    chatStaminaRatio: '0.75',
    currentActionStamina: '5',
    maximumActionStamina: '5',
    actionStaminaRatio: '1',
    currentTotalStamina: '8',
    maximumTotalStamina: '9',
    totalStaminaRatio: '0.89',
    paragraphCountInstructions: 'I understand that I can create a minimum of 1 paragraph and a maximum of 3 paragraphs.',
    antiRepetitionNudge: '',
    textInjection: 'I am now responding as Character 1 (Alice) with the format I am given...',
    systemBlockStart: '<SYSTEM>',
    systemBlockEnd: '</SYSTEM>',
    userTurnStart: '<USER>',
    userTurnEnd: '</USER>',
    assistantTurnStart: '<ASSISTANT>',
    assistantTurnEnd: '</ASSISTANT>',
    thinkStart: '<THINK>',
    thinkEnd: '</THINK>',
    toolCallStartString: '<<tool_call>>',
    toolCallEndString: '<</tool_call>>',
    toolResultStartString: '<<tool_result>>',
    toolResultEndString: '<</tool_result>>',
    topicExpansionInstructions: 'If the conversation becomes stagnant or repetitive, I will naturally introduce a related but fresh topic...',
    noHallucinationInstructions: 'I will also use existent information instead of creating non-existent information...',
};

// Captures suffix scopes (-/+), possessives ('), UUIDs (@), and all standard operators
const TEMPLATE_REGEX = /{{([a-zA-Z0-9_'\-@+]+)(?:\[(-?\d+)?(?::(-?\d+))?\])?(#)?(!)?(?:%([a-zA-Z+\-]+))?([\^*])?(?:\?(\d+))?}}/g;

function evaluateMockTemplate(raw: string): string {
    if (!raw) return '';
    return raw.replace(TEMPLATE_REGEX, (_match, key, startStr, endStr, hashStr, excludeStr, _scopeStr, _insertionStr, limitStr) => {
        let rawKey = key;
        let suffixNote = '';
        let locationScope: 'reachable' | 'all' | undefined = undefined;

        // 1. Parse suffix scopes (- and +) strictly before possessives to mirror backend logic
        if (rawKey.endsWith('-')) {
            rawKey = rawKey.slice(0, -1);
            if (rawKey.startsWith('locations')) {
                locationScope = 'reachable';
                suffixNote = ' [Scope: Reachable]';
            } else {
                suffixNote = ' [Scope: Co-Located]';
            }
        } else if (rawKey.endsWith('+')) {
            rawKey = rawKey.slice(0, -1);
            if (rawKey.startsWith('locations')) {
                locationScope = 'all';
                suffixNote = ' [Scope: All Session]';
            } else {
                suffixNote = ' [Scope: All]';
            }
        }

        // 2. Parse possessive
        const isPossessive = rawKey.endsWith("'") || rawKey.endsWith("'s");
        const cleanKey = isPossessive ? rawKey.replace(/'s?$/, '') : rawKey;

        // Map location scopes to the correct MOCK_DATA keys
        let mockDataKey = cleanKey;
        if (locationScope === 'reachable' && cleanKey.startsWith('locations')) {
            mockDataKey = cleanKey; 
        }
        
        // Handle possessive mapping for MOCK_DATA
        if (isPossessive && !mockDataKey.endsWith("'")) {
            mockDataKey = mockDataKey + "'";
        }

        const data = MOCK_DATA[mockDataKey];
        if (data === undefined) return _match; 

        const limitOverride = limitStr !== undefined ? parseInt(limitStr, 10) : undefined;
        const isArray = Array.isArray(data);
        
        // Simulate "reachable" by artificially limiting the array length in the mock
        const effectiveData = (locationScope === 'reachable' && isArray) ? (data as string[]).slice(0, 3) : data;
        const len = isArray ? (effectiveData as string[]).length : (effectiveData as string).length;
        
        const wantLength = hashStr === '#';
        const wantExclude = excludeStr === '!';
        
        let start = startStr !== undefined ? parseInt(startStr, 10) : 0;
        let end = endStr !== undefined ? parseInt(endStr, 10) : len;
        
        if (start < 0) start = len + start;
        if (end < 0) end = len + end;
        
        start = Math.max(0, Math.min(len, start));
        end = Math.max(0, Math.min(len, end));

        if (wantLength) return String(len) + suffixNote;

        if (isArray) {
            const arr = effectiveData as string[];
            let slice: string[];
            if (start > end) {
                slice = wantExclude 
                    ? [...arr.slice(0, end), ...arr.slice(start)]
                    : arr.slice(end, start).reverse();
            } else {
                slice = wantExclude 
                    ? [...arr.slice(0, start), ...arr.slice(end)]
                    : arr.slice(start, end);
            }
            
            // Mock variant indexing for arrays
            if (limitOverride !== undefined && limitOverride > 1) {
                slice = slice.map(item => `${item} (Alias ${limitOverride - 1})`);
            }
            return slice.join(', ') + suffixNote;
        } else {
            const str = effectiveData as string;
            let slice: string;
            if (start > end) {
                slice = wantExclude
                    ? str.slice(0, end) + str.slice(start)
                    : str.slice(end, start); 
            } else {
                slice = wantExclude
                    ? str.slice(0, start) + str.slice(end)
                    : str.slice(start, end);
            }
            // Mock variant indexing for strings
            if (limitOverride !== undefined && limitOverride > 1) {
                return `${slice} (Alias ${limitOverride - 1})${suffixNote}`;
            }
            return slice + suffixNote;
        }
    });
}

const DIRECTORY_ITEMS = [
    // Identity
    { key: 'character', desc: 'Current character. Use - for co-located, + for all. Use ?N for alias indexing (?1=True Name, ?2=First Alias).', cat: 'Identity' },
    { key: 'protagonist', desc: 'FIRST co-located protagonist. Use + for all protagonists. Supports ?N alias indexing.', cat: 'Identity' },
    { key: "protagonist's", desc: 'Possessive form of the FIRST co-located protagonist. Supports ?N alias indexing.', cat: 'Identity' },
    { key: 'protagonists', desc: 'Array of protagonists. Use - for co-located, + for all. Supports slicing and ?N alias indexing.', cat: 'Identity' },
    { key: "protagonists'", desc: 'Array of possessive strings for protagonists. Supports slicing and ?N alias indexing.', cat: 'Identity' },
    { key: 'characters', desc: 'Array of all participants. Use - for co-located, + for all. Supports slicing and ?N alias indexing.', cat: 'Identity' },
    { key: "characters'", desc: 'Array of possessive strings for all participants. Supports slicing and ?N alias indexing.', cat: 'Identity' },
    { key: 'characterTags', desc: 'Array of formatted character tags for present participants.', cat: 'Identity' },
    { key: 'characterTagsWithDescriptions', desc: 'Array of character tags including their appearance prompts.', cat: 'Identity' },
    { key: 'character@uuid', desc: 'Resolves a specific character by their immutable UUID (e.g., {{character@1234-5678}}). Fully respects the ?limit operator and prevents index-shift corruption in persistent memories.', cat: 'Identity' },

    // Prompts
    { key: 'systemPrompt', desc: 'The character\'s core system prompt.', cat: 'Prompts' },
    { key: 'thinkPrompt', desc: 'Instructions for the character\'s internal monologue.', cat: 'Prompts' },
    { key: 'metaThinkInstructions', desc: 'Meta-instructions for thinking, including literary devices and character embodiment rules.', cat: 'Prompts' },
    { key: 'dialoguePrompt', desc: 'Retrieved sample dialogues.', cat: 'Prompts' },
    { key: 'knowledgePrompt', desc: 'Retrieved lore and knowledge base entries.', cat: 'Prompts' },
    { key: 'memoryPrompt', desc: 'Retrieved long-term memories.', cat: 'Prompts' },
    { key: 'starterPrompt', desc: 'Retrieved scenario starters.', cat: 'Prompts' },
    { key: 'appearancePrompt', desc: 'Compiled appearance prompts and visible clothing for scoped participants.', cat: 'Prompts' },

    // Environment
    { key: 'location', desc: 'Basic info and name of the current location.', cat: 'Environment' },
    { key: 'locationWithDescription', desc: 'Location name and full descriptive text.', cat: 'Environment' },
    { key: 'location@uuid', desc: 'Resolves a specific location by its immutable UUID (e.g., {{location@1234-5678}}). Prevents index-shift corruption in persistent memories.', cat: 'Environment' },
    { key: 'locationWithDescription@uuid', desc: 'Resolves a specific location with its full description by its immutable UUID.', cat: 'Environment' },
    { key: 'locations', desc: 'Array of all locations in the session. Use - for reachable, + for all. Supports slicing and possessives.', cat: 'Environment' },
    { key: 'locationsWithDescriptions', desc: 'Array of all locations with descriptions. Use - for reachable, + for all.', cat: 'Environment' },
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
    { key: 'tools', desc: 'Array of enabled tool names.', cat: 'State & Stats' },
    { key: 'chatHistory', desc: 'Array of formatted chat history messages.', cat: 'State & Stats' },
    { key: 'antiRepetitionNudge', desc: 'Warning text injected when narrative/lexical loops are detected.', cat: 'State & Stats' },
    { key: 'textInjection', desc: 'Final formatting instructions and context authority rules injected before generation.', cat: 'State & Stats' },

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
    
    // Playground State
    const [playgroundInput, setPlaygroundInput] = useState('I am {{character}} at {{location}}. Present are {{characters-[0:2]}}. I can travel to {{locations-}}. My tools: {{tools[0:3]}}.');
    const [searchQuery, setSearchQuery] = useState('');

    const playgroundOutput = useMemo(() => {
        return evaluateMockTemplate(playgroundInput);
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
                    <pre className="entity-raw-pre" style={{ margin: 0, cursor: 'pointer' }} onClick={() => copyToClipboard(raw)} title="Click to copy">
                        {raw}
                    </pre>
                </div>
                <div className="entity-field-block">
                    <span className="entity-field-title">Resolved Output</span>
                    <pre className="entity-raw-pre" style={{ margin: 0, background: 'var(--code-bg)' }}>
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

                <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
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
                                Variables are wrapped in double curly braces: <code style={{ background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px' }}>{'{{key}}'}</code>. 
                                When the prompt is built, the engine replaces these placeholders with the actual data from the chat session, character definitions, or environment.
                            </p>
                            
                            {renderComparison(
                                'My name is {{character}} and I am talking to {{protagonist}}.',
                                'My name is Character 1 (Alice) and I am talking to User.',
                                'Basic injection of identity variables.'
                            )}

                            {renderComparison(
                                'I remember when {{character@uuid-alice}} gave me the sword at {{location@uuid-town}}.',
                                'I remember when Character 1 (Alice) gave me the sword at Town Square.',
                                'UUID resolution ensures persistent memories map to the correct character and location. Fully respects known name limits (?limit).'
                            )}

                            <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '16px', padding: '10px', background: 'var(--social-bg)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                <strong>Note:</strong> Custom Prompt Blocks can also be injected by using their exact ID or by relying on Regex Activation Triggers to append them automatically.
                            </div>
                        </div>
                    )}

                    {activeTab === 'operators' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Array & String Manipulation</span>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '16px' }}>
                                Many variables (like <code>tools</code>, <code>chatHistory</code>, <code>characters</code>, <code>locations</code>) are arrays. You can slice, count, and exclude elements using operators inside the brackets.
                            </p>

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Slicing <code>[start:end]</code></span>
                            {renderComparison(
                                '{{tools[0:3]}}',
                                evaluateMockTemplate('{{tools[0:3]}}'),
                                'Extracts elements from index 0 up to (but not including) 3.'
                            )}
                            {renderComparison(
                                '{{characters[-2:]}}',
                                evaluateMockTemplate('{{characters[-2:]}}'),
                                'Negative numbers count backwards from the end of the array (Last 2 Participants).'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Length <code>#</code></span>
                            {renderComparison(
                                '{{chatHistory#}}',
                                evaluateMockTemplate('{{chatHistory#}}'),
                                'Returns the total number of items in the array instead of the content.'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Exclusion <code>!</code></span>
                            {renderComparison(
                                '{{tools[2:]!}}',
                                evaluateMockTemplate('{{tools[2:]!}}'),
                                'Returns everything EXCEPT the specified slice. (Excludes index 2 onwards).'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Plural Arrays & Possessives</span>
                            {renderComparison(
                                "{{protagonists'}}",
                                evaluateMockTemplate("{{protagonists'}}"),
                                'Returns the possessive strings for all co-located protagonists.'
                            )}
                            {renderComparison(
                                "{{characters'[0:2]}}",
                                evaluateMockTemplate("{{characters'[0:2]}}"),
                                'Slices the possessive array directly (First 2 participants\' possessive tags).'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Suffix Scopes <code>-</code> / <code>+</code></span>
                            {renderComparison(
                                '{{characters-}}',
                                evaluateMockTemplate('{{characters-}}'),
                                'The - suffix restricts the array to strictly co-located participants.'
                            )}
                            {renderComparison(
                                '{{characters+}}',
                                evaluateMockTemplate('{{characters+}}'),
                                'The + suffix forces the array to include all participants in the session, regardless of location.'
                            )}
                            
                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Location Scopes <code>-</code> / <code>+</code></span>
                            {renderComparison(
                                '{{locations-}}',
                                evaluateMockTemplate('{{locations-}}'),
                                'The - suffix restricts the array to strictly reachable locations.'
                            )}
                            {renderComparison(
                                '{{locations+}}',
                                evaluateMockTemplate('{{locations+}}'),
                                'The + suffix forces the array to include all locations in the entire session/world.'
                            )}

                            <span className="editor-section-title" style={{ marginTop: '20px' }}>Name Variant Indexing <code>?N</code></span>
                            {renderComparison(
                                '{{character?1}}',
                                evaluateMockTemplate('{{character?1}}'),
                                '?1 (or default) resolves to the character\'s True Name.'
                            )}
                            {renderComparison(
                                '{{character?2}}',
                                evaluateMockTemplate('{{character?2}}'),
                                '?2 resolves to the character\'s First Alias. ?3 for Second Alias, etc.'
                            )}
                        </div>
                    )}

                    {activeTab === 'cache' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Prefix Caching Overrides</span>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '16px' }}>
                                These operators bypass the global rules set in your Profile's <strong>Cache</strong> tab. They are applied directly to the variable to control exactly which participants are injected into the prompt prefix.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div className="entity-field-block">
                                    <span className="entity-field-title">Scope Override <code>%scope</code> or Suffix <code>-</code>/<code>+</code></span>
                                    <div className="entity-field-content">
                                        <code>{'{{characterTags%all}}'}</code> or <code>{'{{characters+}}'}</code><br/>
                                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Forces the 'all' scope, ignoring the Profile's 'coLocated' or 'current' setting. Valid values: <code>%current</code>, <code>%coLocated</code> (or <code>-</code>), <code>%all</code> (or <code>+</code>).</span>
                                    </div>
                                </div>

                                <div className="entity-field-block">
                                    <span className="entity-field-title">Insertion Override <code>^</code> / <code>*</code></span>
                                    <div className="entity-field-content">
                                        <code>{'{{systemPrompt^}}'}</code> (Dynamic) / <code>{'{{systemPrompt*}}'}</code> (Static)<br/>
                                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Dynamic (<code>^</code>) only includes participants who have spoken since arriving. Static (<code>*</code>) always includes them based on the scope.</span>
                                    </div>
                                </div>

                                <div className="entity-field-block">
                                    <span className="entity-field-title">Known Names Limit <code>?limit</code></span>
                                    <div className="entity-field-content">
                                        <code>{'{{characterTags?2}}'}</code><br/>
                                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>Restricts name reveals to the first N known characters. <code>?0</code> reveals no names (only tags), <code>?-1</code> reveals all. <strong>Also applies to UUID lookups and Identity Variant Indexing:</strong> <code>{'{{character@uuid?0}}'}</code></span>
                                    </div>
                                </div>

                                <div className="entity-field-block" style={{ marginTop: '12px', padding: '12px', background: 'var(--accent-bg)', borderColor: 'var(--accent-border)' }}>
                                    <span className="entity-field-title" style={{ color: 'var(--accent)' }}>Complex Chaining</span>
                                    <pre className="entity-raw-pre" style={{ margin: '8px 0 0 0', background: 'var(--bg)' }} onClick={() => copyToClipboard('{{characterTags[0:3]%all^?2}}')} title="Click to copy">
                                        {'{{characterTags[0:3]%all^?2}}'}
                                    </pre>
                                    <span style={{ fontSize: '0.75rem', opacity: 0.9, marginTop: '8px', display: 'block' }}>
                                        Takes the first 3 tags, forces 'all' scope, forces 'dynamic' insertion, and limits known names to 2.
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'playground' && (
                        <div className="editor-section">
                            <span className="editor-section-title">Live Mock Playground</span>
                            <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '16px' }}>
                                Test array slicing, suffix scopes (<code>-</code>/<code>+</code>), length, exclusion, and variant indexing against all mock data simultaneously. Mix and match variables in the same string. <em>Note: Complex Cache/Scope overrides (<code>%</code>, <code>^</code>, <code>*</code>) require the backend engine and are not fully evaluated here.</em>
                            </p>

                            <div style={{ marginBottom: '16px' }}>
                                <label className="editor-label">Raw Template Input</label>
                                <textarea 
                                    className="editor-textarea" 
                                    value={playgroundInput}
                                    onChange={e => setPlaygroundInput(e.target.value)}
                                    placeholder={`e.g., I am {{character}} at {{location}}. I can go to {{locations-}}.`}
                                    style={{ fontFamily: 'monospace', minHeight: '80px' }}
                                />
                            </div>

                            <div className="entity-field-block">
                                <span className="entity-field-title">Resolved Output</span>
                                <pre className="entity-raw-pre" style={{ margin: 0, background: 'var(--code-bg)', minHeight: '60px' }}>
                                    {playgroundOutput || <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Empty or invalid syntax</span>}
                                </pre>
                            </div>
                            
                            <div style={{ marginTop: '16px', fontSize: '0.75rem', opacity: 0.6, lineHeight: 1.6 }}>
                                <strong>Available Mock Variables:</strong><br/>
                                {Object.keys(MOCK_DATA).map(k => `{{${k}}}`).join(', ')}
                            </div>
                        </div>
                    )}

                    {activeTab === 'directory' && (
                        <>
                            <div className="modal-search-container" style={{ padding: '0 0 16px 0', borderBottom: 'none' }}>
                                <input 
                                    type="text" 
                                    className="modal-search-input" 
                                    placeholder="Search variables..." 
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
                                                <li key={item.key} className="manager-item" style={{ padding: '8px 12px', minHeight: 'auto', cursor: 'pointer' }} onClick={() => copyToClipboard(`{{${item.key}}}`)} title="Click to copy">
                                                    <div className="manager-item-main">
                                                        <div className="manager-item-info">
                                                            <div className="manager-item-title" style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--accent)' }}>
                                                                {'{{'}{item.key}{'}}'}
                                                            </div>
                                                            <div className="manager-item-sub" style={{ whiteSpace: 'normal', overflow: 'visible', textOverflow: 'unset' }}>
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