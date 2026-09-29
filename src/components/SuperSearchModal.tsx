// src/components/SuperSearchModal.tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import type { 
    Character, Context, Location, AudioTrack, World, PromptBlock, 
    LanguageModel, Sampler, StopPattern, BudgetStrategy, Profile, 
    Memory, Account, MultiplayerData, RawInteractionData, InteractionData 
} from '../types';
import { localURL } from '../configurations';
import '../main.css';

export type SearchTabId = 
    | 'all' 
    | 'message' 
    | 'chat' 
    | 'character' 
    | 'context' 
    | 'location' 
    | 'audioTrack' 
    | 'world' 
    | 'promptBlock' 
    | 'model' 
    | 'sampler' 
    | 'stopPattern' 
    | 'budgetStrategy' 
    | 'profile' 
    | 'memory' 
    | 'account' 
    | 'multiplayerData';

export interface SuperSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allPromptBlocks: PromptBlock[];
    allModels: LanguageModel[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allMemories: Memory[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    rawChatShells: RawInteractionData[];
    currentInteractionData: InteractionData | null;

    onSelectEntity?: (type: SearchTabId, entity: any) => void;
    onJumpToMessage?: (messageId: string) => void;
    onSwitchToChatAndJump?: (chatId: string, messageId?: string) => void;
}

interface ServerMessageResult {
    type: 'message';
    id: string;
    chats: Array<{ chatId: string; chatName: string }>;
    characterId?: string;
    snippet: string;
    timestamp: number;
}

interface FieldMatch {
    field: string;
    text: string;
    snippet: string;
}

interface SearchMatchResult {
    tabId: SearchTabId;
    id: string;
    title: string;
    subtitle?: string;
    snippet?: string;
    matches?: FieldMatch[];
    chats?: Array<{ chatId: string; chatName: string }>;
    rawEntity?: any;
}

const TAB_CONFIG: { id: SearchTabId; label: string; icon: string }[] = [
    { id: 'all', label: 'All', icon: '🔍' },
    { id: 'message', label: 'Messages', icon: '💬' },
    { id: 'chat', label: 'Chats', icon: '📂' },
    { id: 'character', label: 'Characters', icon: '🎭' },
    { id: 'context', label: 'Contexts', icon: '📜' },
    { id: 'location', label: 'Locations', icon: '📍' },
    { id: 'promptBlock', label: 'Prompts', icon: '🧱' },
    { id: 'audioTrack', label: 'Audio', icon: '🔊' },
    { id: 'world', label: 'Worlds', icon: '🌍' },
    { id: 'model', label: 'Models', icon: '🤖' },
    { id: 'sampler', label: 'Samplers', icon: '🎚️' },
    { id: 'stopPattern', label: 'Stop Patterns', icon: '🛑' },
    { id: 'budgetStrategy', label: 'Budgets', icon: '💰' },
    { id: 'profile', label: 'Profiles', icon: '👤' },
    { id: 'memory', label: 'Memories', icon: '🧠' },
    { id: 'account', label: 'Accounts', icon: '🔑' },
    { id: 'multiplayerData', label: 'Multiplayer', icon: '👥' },
];

function makeSnippet(text: string, query: string, radius = 45): string {
    if (typeof text !== 'string') return '';
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return text.slice(0, radius * 2);

    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + query.length + radius);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function cleanFieldPath(path: string): string {
    return path
        .replace(/\[\d+\]/g, '') // remove array indices like [0]
        .replace(/^\./, '') || 'content';
}

function formatFieldName(field: string): string {
    return field
        .replace(/([A-Z])/g, ' $1') // camelCase to spaces (systemPrompt -> system Prompt)
        .replace(/[._]/g, ' ')       // dots/underscores to spaces
        .replace(/^./, str => str.toUpperCase())
        .trim();
}

/** Recursively walks an entity to find ALL fields containing the query string */
function findMatchingFields(obj: any, query: string): FieldMatch[] {
    const matches: FieldMatch[] = [];
    const visited = new Set();
    const lowerQuery = query.toLowerCase();

    function walk(val: any, path: string) {
        if (val === null || val === undefined) return;
        if (typeof val === 'string') {
            if (val.length < 5000 && !val.startsWith('data:image')) {
                if (val.toLowerCase().includes(lowerQuery)) {
                    const fieldName = cleanFieldPath(path);
                    if (!matches.some(m => m.field === fieldName && m.text === val)) {
                        matches.push({
                            field: fieldName,
                            text: val,
                            snippet: makeSnippet(val, query)
                        });
                    }
                }
            }
            return;
        }

        if (typeof val !== 'object') return;
        if (visited.has(val)) return;
        visited.add(val);

        if (Array.isArray(val)) {
            val.forEach((item, index) => walk(item, `${path}[${index}]`));
        } else {
            for (const [key, v] of Object.entries(val)) {
                if (key === 'id' || key === 'firstCreatedTimestamp' || key === 'lastUpdatedTimestamp' || key === 'images' || key === 'base64' || key.includes('Cache') || key.includes('Path')) continue;
                const currentPath = path ? `${path}.${key}` : key;
                walk(v, currentPath);
            }
        }
    }

    walk(obj, '');
    return matches;
}

function SuperSearchContent({
    onClose,
    allCharacters,
    allContexts,
    allLocations,
    allAudioTracks,
    allWorlds,
    allPromptBlocks,
    allModels,
    allSamplers,
    allStopPatterns,
    allBudgetStrategies,
    allProfiles,
    allMemories,
    allAccounts,
    allMultiplayerData,
    rawChatShells,
    currentInteractionData,
    onSelectEntity,
    onJumpToMessage,
    onSwitchToChatAndJump,
}: Omit<SuperSearchModalProps, 'isOpen'>) {
    const [query, setQuery] = useState('');
    const [activeTab, setActiveTab] = useState<SearchTabId>('all');
    const [serverMessages, setServerMessages] = useState<ServerMessageResult[]>([]);
    const [isSearchingServer, setIsSearchingServer] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    const lowerQuery = query.toLowerCase().trim();

    const characterMap = useMemo(() => {
        const map = new Map<string, Character>();
        for (const c of allCharacters) map.set(c.id, c);
        return map;
    }, [allCharacters]);

    const messageToChatsMap = useMemo(() => {
        const map = new Map<string, Array<{ chatId: string; chatName: string }>>();

        for (const shell of rawChatShells) {
            if (!shell.id) continue;
            const chatName = shell.name || 'Untitled Chat';
            for (const msgId of (shell.interactionIdHistory || [])) {
                let list = map.get(msgId);
                if (!list) {
                    list = [];
                    map.set(msgId, list);
                }
                if (!list.some(c => c.chatId === shell.id)) {
                    list.push({ chatId: shell.id, chatName });
                }
            }
        }

        if (currentInteractionData?.id) {
            const activeId = currentInteractionData.id;
            const activeName = currentInteractionData.name || 'Untitled Chat';
            for (const msg of (currentInteractionData.interactionHistory || [])) {
                let list = map.get(msg.id);
                if (!list) {
                    list = [];
                    map.set(msg.id, list);
                }
                if (!list.some(c => c.chatId === activeId)) {
                    list.push({ chatId: activeId, chatName: activeName });
                }
            }
        }

        return map;
    }, [rawChatShells, currentInteractionData]);

    useEffect(() => {
        if (!lowerQuery) return;

        let ignore = false;
        const timer = setTimeout(async () => {
            setIsSearchingServer(true);
            try {
                const res = await fetch(`${localURL}/search?q=${encodeURIComponent(lowerQuery)}&limit=50`);
                if (res.ok && !ignore) {
                    const data = await res.json();
                    const messagesOnly = (data.results || []).filter((r: any) => r.type === 'message');
                    setServerMessages(messagesOnly);
                }
            } catch (e) {
                console.warn('[SuperSearch] Server query failed:', e);
            } finally {
                if (!ignore) {
                    setIsSearchingServer(false);
                }
            }
        }, 150);

        return () => {
            ignore = true;
            clearTimeout(timer);
        };
    }, [lowerQuery]);

    const categorizedResults = useMemo<Record<SearchTabId, SearchMatchResult[]>>(() => {
        const emptyMap: Record<SearchTabId, SearchMatchResult[]> = {
            all: [], message: [], chat: [], character: [], context: [],
            location: [], promptBlock: [], audioTrack: [], world: [], model: [],
            sampler: [], stopPattern: [], budgetStrategy: [], profile: [], memory: [],
            account: [], multiplayerData: []
        };

        if (!lowerQuery) return emptyMap;

        const scanEntities = (items: any[], tabId: SearchTabId, getTitle: (item: any) => string) => {
            const results: SearchMatchResult[] = [];
            if (!Array.isArray(items)) return results;

            for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                const matches = findMatchingFields(item, lowerQuery);
                if (matches.length > 0) {
                    results.push({
                        tabId,
                        id: String(item.id || ''),
                        title: String(getTitle(item) || ''),
                        matches,
                        rawEntity: item,
                    });
                }
            }
            return results;
        };

        emptyMap.character = scanEntities(allCharacters, 'character', c => `🎭 ${c.name}`);
        emptyMap.context = scanEntities(allContexts, 'context', c => `📜 ${c.name}`);
        emptyMap.location = scanEntities(allLocations, 'location', l => `📍 ${l.name}`);
        emptyMap.promptBlock = scanEntities(allPromptBlocks, 'promptBlock', p => `🧱 ${p.name}`);
        emptyMap.audioTrack = scanEntities(allAudioTracks, 'audioTrack', a => `🔊 ${a.filename || a.name}`);
        emptyMap.world = scanEntities(allWorlds, 'world', w => `🌍 ${w.name}`);
        emptyMap.model = scanEntities(allModels, 'model', m => `🤖 ${m.name}`);
        emptyMap.sampler = scanEntities(allSamplers, 'sampler', s => `🎚️ ${s.name}`);
        emptyMap.stopPattern = scanEntities(allStopPatterns, 'stopPattern', sp => `🛑 ${sp.name}`);
        emptyMap.budgetStrategy = scanEntities(allBudgetStrategies, 'budgetStrategy', b => `💰 ${b.name}`);
        emptyMap.profile = scanEntities(allProfiles, 'profile', p => `👤 ${p.name}`);
        emptyMap.memory = scanEntities(allMemories, 'memory', m => `🧠 ${typeof m.name === 'string' ? m.name : 'Untitled Memory'}`);
        emptyMap.account = scanEntities(allAccounts, 'account', a => `🔑 ${a.name || a.username}`);
        emptyMap.multiplayerData = scanEntities(allMultiplayerData, 'multiplayerData', m => `👥 ${m.name}`);
        emptyMap.chat = scanEntities(rawChatShells, 'chat', s => `📂 ${s.name || 'Untitled Chat'}`);

        const seenMessageIds = new Set<string>();
        const messageResults: SearchMatchResult[] = [];

        if (currentInteractionData) {
            for (const msg of (currentInteractionData.interactionHistory || [])) {
                if (msg.messageType === 'chat' && typeof msg.textContent === 'string' && msg.textContent.toLowerCase().includes(lowerQuery)) {
                    seenMessageIds.add(msg.id);
                    const chats = messageToChatsMap.get(msg.id) || [{ chatId: currentInteractionData.id, chatName: currentInteractionData.name || 'Untitled Chat' }];
                    messageResults.push({
                        tabId: 'message',
                        id: msg.id,
                        title: `🎭 ${msg.character.name}`,
                        matches: [{ field: 'textContent', text: msg.textContent, snippet: makeSnippet(msg.textContent, lowerQuery) }],
                        chats,
                        rawEntity: msg,
                    });
                }
            }
        }

        for (const sMsg of serverMessages) {
            if (!seenMessageIds.has(sMsg.id)) {
                seenMessageIds.add(sMsg.id);
                const speaker = sMsg.characterId ? characterMap.get(sMsg.characterId) : null;
                const chats = (sMsg.chats && sMsg.chats.length > 0) 
                    ? sMsg.chats 
                    : (messageToChatsMap.get(sMsg.id) || [{ chatId: 'unknown', chatName: 'Unknown Session' }]);

                messageResults.push({
                    tabId: 'message',
                    id: sMsg.id,
                    title: speaker ? `🎭 ${speaker.name}` : '🎭 Character',
                    matches: [{ field: 'textContent', text: sMsg.snippet, snippet: typeof sMsg.snippet === 'string' ? sMsg.snippet : '' }],
                    chats,
                });
            }
        }

        emptyMap.message = messageResults;

        emptyMap.all = [
            ...emptyMap.message.slice(0, 10),
            ...emptyMap.chat.slice(0, 5),
            ...emptyMap.character.slice(0, 5),
            ...emptyMap.context.slice(0, 5),
            ...emptyMap.location.slice(0, 5),
            ...emptyMap.promptBlock.slice(0, 5),
            ...emptyMap.world.slice(0, 5),
            ...emptyMap.model.slice(0, 5),
            ...emptyMap.sampler.slice(0, 5),
            ...emptyMap.stopPattern.slice(0, 5),
            ...emptyMap.budgetStrategy.slice(0, 5),
            ...emptyMap.profile.slice(0, 5),
            ...emptyMap.memory.slice(0, 5),
            ...emptyMap.account.slice(0, 5),
            ...emptyMap.multiplayerData.slice(0, 5),
            ...emptyMap.audioTrack.slice(0, 5),
        ];

        return emptyMap;
    }, [
        lowerQuery, allCharacters, allContexts, allLocations, allPromptBlocks, allAudioTracks,
        allWorlds, allModels, allSamplers, allStopPatterns, allBudgetStrategies, allProfiles,
        allMemories, allAccounts, allMultiplayerData, rawChatShells, currentInteractionData,
        messageToChatsMap, serverMessages, characterMap
    ]);

    const displayedResults = useMemo(() => {
        return categorizedResults[activeTab] || [];
    }, [categorizedResults, activeTab]);

    const totalResultsCount = useMemo(() => {
        return Object.values(categorizedResults).reduce((sum, arr) => sum + arr.length, 0) - categorizedResults.all.length;
    }, [categorizedResults]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div 
                className="modal-content editor-modal-content" 
                onClick={e => e.stopPropagation()} 
                style={{ maxWidth: '850px', height: '88vh', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
            >
                {/* Modal Header */}
                <div className="modal-header">
                    <h2>Super Search</h2>
                    <div className="editor-modal-actions">
                        {isSearchingServer && <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Scanning disk...</span>}
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Close</button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="modal-search-container" style={{ padding: '0 20px 12px 20px' }}>
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search anything across all entities, lore, and messages..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className="modal-search-input"
                    />
                </div>

                {/* ─── Entity Tab Bar (5 tabs per row, expanded across remaining space) ─── */}
                <div 
                    className="entity-tab-bar" 
                    style={{ 
                        padding: '0 20px', 
                        marginBottom: 0, 
                        borderBottom: '1px solid var(--border)', 
                        background: 'var(--social-bg)',
                        flexShrink: 0
                    }}
                >
                    {TAB_CONFIG.map(tab => {
                        const count = tab.id === 'all' ? totalResultsCount : (categorizedResults[tab.id]?.length || 0);
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                                style={{ 
                                    flex: '1 1 calc(20% - 4px)',
                                    minWidth: 'calc(20% - 4px)',
                                    fontSize: '0.7rem', 
                                    padding: '8px 6px'
                                }}
                            >
                                <span>{tab.icon}</span>
                                <span>{tab.label}</span>
                                {lowerQuery.length > 0 && count > 0 && (
                                    <span style={{ opacity: 0.8, fontSize: '0.65rem', marginLeft: '2px' }}>
                                        ({count})
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Results List */}
                <div className="modal-body editor-modal-body" style={{ flex: 1, padding: '16px 20px' }}>
                    {!lowerQuery ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', opacity: 0.5, fontSize: '0.85rem' }}>
                            Type to search across all lore, entities, prompts, and chat sessions.
                        </div>
                    ) : displayedResults.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', opacity: 0.5, fontSize: '0.85rem' }}>
                            No matches found for "{query}" in {TAB_CONFIG.find(t => t.id === activeTab)?.label}.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {displayedResults.map(item => (
                                <div 
                                    key={`${item.tabId}-${item.id}`}
                                    className="manager-item"
                                    style={{ 
                                        flexDirection: 'column', 
                                        alignItems: 'flex-start', 
                                        gap: '6px',
                                        padding: '12px 14px',
                                        cursor: 'default'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'baseline' }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--text-h)' }}>
                                            {String(item.title || '')}
                                        </div>
                                        <span style={{ fontSize: '0.65rem', opacity: 0.5, textTransform: 'uppercase' }}>
                                            {item.tabId}
                                        </span>
                                    </div>

                                    {/* Render all matching fields with clean spacing */}
                                    {item.matches && item.matches.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '4px' }}>
                                            {item.matches.map((m, idx) => (
                                                <div 
                                                    key={idx}
                                                    style={{ 
                                                        fontSize: '0.8rem', 
                                                        opacity: 0.9, 
                                                        background: 'rgba(0,0,0,0.15)', 
                                                        padding: '8px 10px', 
                                                        borderRadius: '6px', 
                                                        width: '100%', 
                                                        boxSizing: 'border-box', 
                                                        borderLeft: '3px solid var(--accent)' 
                                                    }}
                                                >
                                                    <div style={{ fontSize: '0.65rem', opacity: 0.8, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px', color: 'var(--accent)' }}>
                                                        {formatFieldName(m.field)}
                                                    </div>
                                                    <div>"{m.snippet}"</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Action Row: Interactive badges / Open buttons */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: '4px', flexWrap: 'wrap', gap: '6px' }}>
                                        {item.tabId === 'message' && item.chats && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>Belongs to:</span>
                                                {item.chats.map(c => {
                                                    const isCurrent = currentInteractionData?.id === c.chatId;
                                                    return (
                                                        <button
                                                            key={c.chatId}
                                                            type="button"
                                                            onClick={() => {
                                                                if (isCurrent) {
                                                                    onJumpToMessage?.(item.id);
                                                                } else {
                                                                    onSwitchToChatAndJump?.(c.chatId, item.id);
                                                                }
                                                                onClose();
                                                            }}
                                                            style={{
                                                                fontSize: '0.68rem',
                                                                padding: '2px 8px',
                                                                borderRadius: '10px',
                                                                background: isCurrent ? 'var(--accent-bg)' : 'var(--social-bg)',
                                                                color: isCurrent ? 'var(--accent)' : 'var(--text-h)',
                                                                border: isCurrent ? '1px solid var(--accent)' : '1px solid var(--border)',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            💬 {c.chatName} {isCurrent ? '(Active)' : ''}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {item.tabId !== 'message' && (
                                            <div style={{ marginLeft: 'auto' }}>
                                                <button
                                                    type="button"
                                                    className="editor-button editor-button-save"
                                                    onClick={() => {
                                                        onSelectEntity?.(item.tabId, item.rawEntity);
                                                    }}
                                                    style={{ minHeight: '26px', fontSize: '0.7rem', padding: '2px 10px' }}
                                                >
                                                    {item.tabId === 'chat' ? 'Open Chat' : 'Edit Entity'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function SuperSearchModal(props: SuperSearchModalProps) {
    if (!props.isOpen) return null;
    return <SuperSearchContent {...props} />;
}