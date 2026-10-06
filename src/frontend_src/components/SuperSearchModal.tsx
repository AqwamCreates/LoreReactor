// frontend-src/components/SuperSearchModal.tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import type { 
    Character, Context, Location, AudioTrack, World, PromptBlock, 
    LanguageModel, Sampler, StopPattern, BudgetStrategy, Profile, 
    Memory, Account, MultiplayerData, RawInteractionData, InteractionData, 
    ObjectData, ChatMessage
} from '../types';
import { localURL } from '../../configurations';
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
    onClose: () => void;
    isMultiplayerClient?: boolean;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allPromptBlocks: PromptBlock[];
    allLanguageModels: LanguageModel[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allMemories: Memory[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    rawChatShells: RawInteractionData[];
    currentInteractionData: InteractionData | null;

    onSelectEntity?: (tabId: SearchTabId, entity: ObjectData, parentEntity?: ObjectData, isReadOnly?: boolean) => void;
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
    parentEntity?: any;
    isHosterOwned?: boolean;
    isReadOnly?: boolean;
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

const IGNORED_FIELD_KEYS = new Set([
    'id',
    'firstCreatedTimestamp',
    'lastUpdatedTimestamp',
    'images',
    'base64',
    'apiKey',
    'password',
]);

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
        .replace(/\[\d+\]/g, '')
        .replace(/^\./, '') || 'content';
}

function formatFieldName(field: string): string {
    return field
        .replace(/([A-Z])/g, ' $1')
        .replace(/[._]/g, ' ')
        .replace(/^./, str => str.toUpperCase())
        .trim();
}

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
                if (IGNORED_FIELD_KEYS.has(key) || key.includes('Cache') || key.includes('Path')) continue;
                const currentPath = path ? `${path}.${key}` : key;
                walk(v, currentPath);
            }
        }
    }

    walk(obj, '');
    return matches;
}

export function SuperSearchModal({
    onClose,
    isMultiplayerClient = false,
    allCharacters,
    allContexts,
    allLocations,
    allAudioTracks,
    allWorlds,
    allPromptBlocks,
    allLanguageModels,
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
        if (currentInteractionData?.participants) {
            for (const c of currentInteractionData.participants) {
                if (!map.has(c.id)) map.set(c.id, c);
            }
        }
        return map;
    }, [allCharacters, currentInteractionData]);

    const messageToChatsMap = useMemo(() => {
        const map = new Map<string, Array<{ chatId: string; chatName: string }>>();

        for (const shell of rawChatShells) {
            if (!shell.id) continue;
            const chatName = shell.name || 'Untitled Chat';
            
            // FIX: Replaced non-existent interactionIdHistory with flattened spatial interactionHistories Record
            const allMsgIds = Object.values(shell.interactionHistories || {}).flat();
            for (const msgId of allMsgIds) {
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
            
            // FIX: Replaced non-existent interactionHistory with flattened spatial interactionHistories Record
            const allMessages = Object.values(currentInteractionData.interactionHistories || {}).flat();
            for (const msg of allMessages) {
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

    // ─── Merged Pools (Local Library + Hoster-Owned from active chat) ───
    const searchableCharacters = useMemo(() => {
        const localIds = new Set(allCharacters.map(c => c.id));
        const hosterOwned = isMultiplayerClient && currentInteractionData?.participants
            ? currentInteractionData.participants.filter(c => !localIds.has(c.id))
            : [];
        return {
            items: [...allCharacters, ...hosterOwned],
            hosterOwnedIds: new Set(hosterOwned.map(c => c.id)),
        };
    }, [allCharacters, currentInteractionData, isMultiplayerClient]);

    const searchableContexts = useMemo(() => {
        const localIds = new Set(allContexts.map(c => c.id));
        const hosterOwned = isMultiplayerClient && currentInteractionData?.contexts
            ? currentInteractionData.contexts.filter(c => !localIds.has(c.id))
            : [];
        return {
            items: [...allContexts, ...hosterOwned],
            hosterOwnedIds: new Set(hosterOwned.map(c => c.id)),
        };
    }, [allContexts, currentInteractionData, isMultiplayerClient]);

    const searchableLocations = useMemo(() => {
        const localIds = new Set(allLocations.map(l => l.id));
        const hosterOwned = isMultiplayerClient && currentInteractionData?.locations
            ? currentInteractionData.locations.filter(l => !localIds.has(l.id))
            : [];
        return {
            items: [...allLocations, ...hosterOwned],
            hosterOwnedIds: new Set(hosterOwned.map(l => l.id)),
        };
    }, [allLocations, currentInteractionData, isMultiplayerClient]);

    const searchableAudioTracks = useMemo(() => {
        const localIds = new Set(allAudioTracks.map(a => a.id));
        const hosterOwned = isMultiplayerClient && currentInteractionData?.audioTracks
            ? currentInteractionData.audioTracks.filter(a => !localIds.has(a.id))
            : [];
        return {
            items: [...allAudioTracks, ...hosterOwned],
            hosterOwnedIds: new Set(hosterOwned.map(a => a.id)),
        };
    }, [allAudioTracks, currentInteractionData, isMultiplayerClient]);

    const categorizedResults = useMemo<Record<SearchTabId, SearchMatchResult[]>>(() => {
        const emptyMap: Record<SearchTabId, SearchMatchResult[]> = {
            all: [], message: [], chat: [], character: [], context: [],
            location: [], promptBlock: [], audioTrack: [], world: [], model: [],
            sampler: [], stopPattern: [], budgetStrategy: [], profile: [], memory: [],
            account: [], multiplayerData: []
        };

        if (!lowerQuery) return emptyMap;

        const scanEntities = (
            items: any[], 
            tabId: SearchTabId, 
            getTitle: (item: any) => string,
            metadataHelper?: { hosterOwnedIds: Set<string> }
        ) => {
            const results: SearchMatchResult[] = [];
            if (!Array.isArray(items)) return results;

            for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                const matches = findMatchingFields(item, lowerQuery);
                if (matches.length > 0) {
                    const isHosterOwned = metadataHelper ? metadataHelper.hosterOwnedIds.has(item.id) : false;
                    const isReadOnly = isHosterOwned;

                    results.push({
                        tabId,
                        id: String(item.id || ''),
                        title: String(getTitle(item) || ''),
                        matches,
                        rawEntity: item,
                        isHosterOwned,
                        isReadOnly,
                    });
                }
            }
            return results;
        };

        emptyMap.character = scanEntities(searchableCharacters.items, 'character', c => `🎭 ${c.name}`, searchableCharacters);
        emptyMap.context = scanEntities(searchableContexts.items, 'context', c => `📜 ${c.name}`, searchableContexts);
        emptyMap.location = scanEntities(searchableLocations.items, 'location', l => `📍 ${l.name}`, searchableLocations);
        emptyMap.audioTrack = scanEntities(searchableAudioTracks.items, 'audioTrack', a => `🔊 ${a.filename || a.name}`, searchableAudioTracks);

        emptyMap.promptBlock = scanEntities(allPromptBlocks, 'promptBlock', p => `🧱 ${p.name}`);
        emptyMap.world = scanEntities(allWorlds, 'world', w => `🌍 ${w.name}`);
        emptyMap.model = scanEntities(allLanguageModels, 'model', m => `🤖 ${m.name}`);
        emptyMap.sampler = scanEntities(allSamplers, 'sampler', s => `🎚️ ${s.name}`);
        emptyMap.stopPattern = scanEntities(allStopPatterns, 'stopPattern', sp => `🛑 ${sp.name}`);
        emptyMap.budgetStrategy = scanEntities(allBudgetStrategies, 'budgetStrategy', b => `💰 ${b.name}`);
        emptyMap.profile = scanEntities(allProfiles, 'profile', p => `👤 ${p.name}`);
        emptyMap.memory = scanEntities(allMemories, 'memory', m => `🧠 ${typeof m.name === 'string' ? m.name : 'Untitled Memory'}`);
        
        for (const res of emptyMap.memory) {
            const parentChar = allCharacters.find(c => 
                Array.isArray(c.memories) && c.memories.some((m: any) => m.id === res.id)
            );
            if (parentChar) res.parentEntity = parentChar;
        }

        emptyMap.account = scanEntities(allAccounts, 'account', a => `🔑 ${a.name || a.username}`);
        emptyMap.multiplayerData = scanEntities(allMultiplayerData, 'multiplayerData', m => `👥 ${m.name}`);
        emptyMap.chat = scanEntities(rawChatShells, 'chat', s => `📂 ${s.name || 'Untitled Chat'}`);

        const seenMessageIds = new Set<string>();
        const messageResults: SearchMatchResult[] = [];

        if (currentInteractionData) {
            // FIX: Replaced non-existent interactionHistory with flattened spatial interactionHistories Record
            const allMessages = Object.values(currentInteractionData.interactionHistories || {}).flat();
            for (const msg of allMessages) {
                if (msg.messageType === 'chat' && typeof (msg as ChatMessage).textContent === 'string' && (msg as ChatMessage).textContent.toLowerCase().includes(lowerQuery)) {
                    const chatMsg = msg as ChatMessage;
                    seenMessageIds.add(chatMsg.id);
                    const chats = messageToChatsMap.get(chatMsg.id) || [{ chatId: currentInteractionData.id, chatName: currentInteractionData.name || 'Untitled Chat' }];
                    messageResults.push({
                        tabId: 'message',
                        id: chatMsg.id,
                        title: `🎭 ${chatMsg.character.name}`,
                        matches: [{ field: 'textContent', text: chatMsg.textContent, snippet: makeSnippet(chatMsg.textContent, lowerQuery) }],
                        chats,
                        rawEntity: chatMsg,
                        parentEntity: currentInteractionData,
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

                let parentChat: any = null;
                if (chats[0]?.chatId && chats[0].chatId !== 'unknown') {
                    if (currentInteractionData?.id === chats[0].chatId) {
                        parentChat = currentInteractionData;
                    } else {
                        parentChat = rawChatShells.find(s => s.id === chats[0].chatId) || { id: chats[0].chatId, name: chats[0].chatName };
                    }
                }

                messageResults.push({
                    tabId: 'message',
                    id: sMsg.id,
                    title: speaker ? `🎭 ${speaker.name}` : '🎭 Character',
                    matches: [{ field: 'textContent', text: sMsg.snippet, snippet: typeof sMsg.snippet === 'string' ? sMsg.snippet : '' }],
                    chats,
                    parentEntity: parentChat,
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
        lowerQuery, searchableCharacters, searchableContexts, searchableLocations, 
        searchableAudioTracks, allPromptBlocks, allWorlds, allLanguageModels, 
        allSamplers, allStopPatterns, allBudgetStrategies, allProfiles, 
        allMemories, allAccounts, allMultiplayerData, rawChatShells, 
        currentInteractionData, messageToChatsMap, serverMessages, characterMap
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

                {/* Entity Tab Bar */}
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
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--text-h)' }}>
                                                {String(item.title || '')}
                                            </span>
                                            {isMultiplayerClient && (
                                                item.isHosterOwned ? (
                                                    <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)', fontWeight: 'bold' }}>
                                                        🌐 Hoster-Owned
                                                    </span>
                                                ) : (
                                                    <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(156, 163, 175, 0.15)', color: 'var(--text-muted, #888)', border: '1px solid var(--border)', fontWeight: 'bold' }}>
                                                        💾 Local Library
                                                    </span>
                                                )
                                            )}
                                        </div>
                                        <span style={{ fontSize: '0.65rem', opacity: 0.5, textTransform: 'uppercase' }}>
                                            {item.tabId}
                                        </span>
                                    </div>

                                    {/* Matches */}
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

                                    {/* Action Row */}
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
                                                                onSelectEntity?.('message', item.rawEntity, { id: c.chatId, name: c.chatName } as ObjectData, item.isReadOnly);
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
                                                        onSelectEntity?.(item.tabId, item.rawEntity, item.parentEntity, item.isReadOnly);
                                                    }}
                                                    style={{ minHeight: '26px', fontSize: '0.7rem', padding: '2px 10px' }}
                                                >
                                                    {item.tabId === 'chat' 
                                                        ? 'Open Chat' 
                                                        : item.isReadOnly 
                                                            ? 'View Entity' 
                                                            : 'Edit Entity'}
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