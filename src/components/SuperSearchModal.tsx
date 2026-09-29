// src/components/SuperSearchModal.tsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { 
    Character, Context, Location, AudioTrack, World, PromptBlock, 
    LanguageModel, Sampler, StopPattern, BudgetStrategy, Profile, 
    Memory, Account, MultiplayerData, RawInteractionData, InteractionData, ChatMessage 
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
    // In-memory entity collections
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

    // Navigation and inspection callbacks
    onSelectEntity?: (type: SearchTabId, id: string, entity: any) => void;
    onJumpToMessage?: (messageId: string) => void;
    onSwitchToChatAndJump?: (chatId: string, messageId?: string) => void;
    onSwitchChat?: (chatId: string) => void;
}

interface ServerMessageResult {
    type: 'message';
    id: string;
    chats: Array<{ chatId: string; chatName: string }>;
    characterId?: string;
    snippet: string;
    timestamp: number;
}

interface SearchMatchResult {
    tabId: SearchTabId;
    id: string;
    title: string;
    subtitle?: string;
    snippet?: string;
    chats?: Array<{ chatId: string; chatName: string }>; // For messages
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

/** Fast contextual snippet generator */
function makeSnippet(text: string, query: string, radius = 45): string {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return text.slice(0, radius * 2);

    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + query.length + radius);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/** Recursively extracts all searchable string fields from any entity while ignoring base64/media */
function extractDeepStrings(obj: any): string[] {
    const list: string[] = [];
    const visited = new Set();

    function walk(val: any) {
        if (!val || typeof val !== 'object' && typeof val !== 'string') return;
        if (typeof val === 'string') {
            if (val.length < 5000 && !val.startsWith('data:image')) {
                list.push(val);
            }
            return;
        }

        if (visited.has(val)) return;
        visited.add(val);

        if (Array.isArray(val)) {
            for (const item of val) walk(item);
        } else {
            for (const [key, v] of Object.entries(val)) {
                // Ignore raw image dictionaries, base64 strings, and cache paths
                if (key === 'images' || key === 'base64' || key.includes('Cache') || key.includes('Path')) continue;
                walk(v);
            }
        }
    }

    walk(obj);
    return list;
}

export function SuperSearchModal({
    isOpen,
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
    onSwitchChat,
}: SuperSearchModalProps) {
    const [query, setQuery] = useState('');
    const [activeTab, setActiveTab] = useState<SearchTabId>('all');
    const [serverMessages, setServerMessages] = useState<ServerMessageResult[]>([]);
    const [isSearchingServer, setIsSearchingServer] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Auto-focus input on open
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setServerMessages([]);
            setTimeout(() => searchInputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Keyboard shortcut handlers
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                onClose();
            }
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const lowerQuery = query.toLowerCase().trim();

    // Map character ID -> Character object for quick lookups
    const characterMap = useMemo(() => {
        const map = new Map<string, Character>();
        for (const c of allCharacters) map.set(c.id, c);
        return map;
    }, [allCharacters]);

    // ─── 1-to-Many Map: MessageId -> All Containing Chats (Parent + Branches) ───
    const messageToChatsMap = useMemo(() => {
        const map = new Map<string, Array<{ chatId: string; chatName: string }>>();

        // Include raw chat shells from storage
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

        // Include active interaction data
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

    // ─── Strategy B: Server Deep-Search for All Messages on Disk ──────
    useEffect(() => {
        if (!lowerQuery || lowerQuery.length < 2) {
            setServerMessages([]);
            setIsSearchingServer(false);
            return;
        }

        setIsSearchingServer(true);
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`${localURL}/search?q=${encodeURIComponent(lowerQuery)}&limit=50`);
                if (res.ok) {
                    const data = await res.json();
                    const messagesOnly = (data.results || []).filter((r: any) => r.type === 'message');
                    setServerMessages(messagesOnly);
                }
            } catch (e) {
                console.warn('[SuperSearch] Server query failed:', e);
            } finally {
                setIsSearchingServer(false);
            }
        }, 150);

        return () => clearTimeout(timer);
    }, [lowerQuery]);

    // ─── Strategy A: Instant Client-Side Deep String Search ────────────
    const categorizedResults = useMemo<Record<SearchTabId, SearchMatchResult[]>>(() => {
        const emptyMap: Record<SearchTabId, SearchMatchResult[]> = {
            all: [], message: [], chat: [], character: [], context: [],
            location: [], promptBlock: [], audioTrack: [], world: [], model: [],
            sampler: [], stopPattern: [], budgetStrategy: [], profile: [], memory: [],
            account: [], multiplayerData: []
        };

        if (!lowerQuery || lowerQuery.length < 2) return emptyMap;

        // Generic deep scanner for entity items
        const scanEntities = (items: any[], tabId: SearchTabId, getTitle: (item: any) => string, getSub?: (item: any) => string) => {
            const results: SearchMatchResult[] = [];
            for (const item of items) {
                const allStrings = extractDeepStrings(item);
                const matchedStr = allStrings.find(s => s.toLowerCase().includes(lowerQuery));
                if (matchedStr) {
                    results.push({
                        tabId,
                        id: item.id,
                        title: getTitle(item),
                        subtitle: getSub ? getSub(item) : item.description,
                        snippet: makeSnippet(matchedStr, lowerQuery),
                        rawEntity: item,
                    });
                }
            }
            return results;
        };

        // Entities
        emptyMap.character = scanEntities(allCharacters, 'character', c => `🎭 ${c.name}`, c => c.description || c.systemPrompt);
        emptyMap.context = scanEntities(allContexts, 'context', c => `📜 ${c.name}`, c => c.text);
        emptyMap.location = scanEntities(allLocations, 'location', l => `📍 ${l.name}`, l => l.text);
        emptyMap.promptBlock = scanEntities(allPromptBlocks, 'promptBlock', p => `🧱 ${p.name}`, p => p.textContent);
        emptyMap.audioTrack = scanEntities(allAudioTracks, 'audioTrack', a => `🔊 ${a.filename || a.name}`, a => a.audioCategory);
        emptyMap.world = scanEntities(allWorlds, 'world', w => `🌍 ${w.name}`);
        emptyMap.model = scanEntities(allModels, 'model', m => `🤖 ${m.name}`, m => m.model || m.backend);
        emptyMap.sampler = scanEntities(allSamplers, 'sampler', s => `🎚️ ${s.name}`);
        emptyMap.stopPattern = scanEntities(allStopPatterns, 'stopPattern', sp => `🛑 ${sp.name}`, sp => sp.pattern);
        emptyMap.budgetStrategy = scanEntities(allBudgetStrategies, 'budgetStrategy', b => `💰 ${b.name}`);
        emptyMap.profile = scanEntities(allProfiles, 'profile', p => `👤 ${p.name}`);
        emptyMap.memory = scanEntities(allMemories, 'memory', m => `🧠 ${m.name}`, m => m.content);
        emptyMap.account = scanEntities(allAccounts, 'account', a => `🔑 ${a.name || a.username}`, a => `User: ${a.username}`);
        emptyMap.multiplayerData = scanEntities(allMultiplayerData, 'multiplayerData', m => `👥 ${m.name}`);
        emptyMap.chat = scanEntities(rawChatShells, 'chat', s => `📂 ${s.name || 'Untitled Chat'}`);

        // ─── Messages: Merge Active Chat (in-memory) + Server Results (disk) ───
        const seenMessageIds = new Set<string>();
        const messageResults: SearchMatchResult[] = [];

        // 1. Current chat messages
        if (currentInteractionData) {
            for (const msg of (currentInteractionData.interactionHistory || [])) {
                if (msg.messageType === 'chat' && msg.textContent.toLowerCase().includes(lowerQuery)) {
                    seenMessageIds.add(msg.id);
                    const chats = messageToChatsMap.get(msg.id) || [{ chatId: currentInteractionData.id, chatName: currentInteractionData.name || 'Untitled Chat' }];
                    messageResults.push({
                        tabId: 'message',
                        id: msg.id,
                        title: `🎭 ${msg.character.name}`,
                        snippet: makeSnippet(msg.textContent, lowerQuery),
                        chats,
                        rawEntity: msg,
                    });
                }
            }
        }

        // 2. Server-side disk results
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
                    snippet: sMsg.snippet,
                    chats,
                });
            }
        }

        emptyMap.message = messageResults;

        // "All" view combines top hits from every category
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

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100000 }}>
            <div 
                className="modal-content editor-modal-content" 
                onClick={e => e.stopPropagation()} 
                style={{ maxWidth: '820px', height: '85vh', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            >
                {/* Header / Search Input */}
                <div className="modal-header" style={{ padding: '16px 20px 12px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>⚡</span> Super Search
                        </h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {isSearchingServer && <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Scanning disk...</span>}
                            <button type="button" className="editor-button editor-button-cancel" onClick={onClose} style={{ minHeight: '32px', padding: '4px 12px' }}>
                                Esc
                            </button>
                        </div>
                    </div>
                    
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search anything across all entities, lore, and messages..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className="modal-search-input"
                        style={{ width: '100%', fontSize: '1rem', padding: '10px 14px' }}
                    />
                </div>

                {/* Entity Filter Tabs */}
                <div style={{ display: 'flex', gap: '4px', padding: '0 16px', borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' }}>
                    {TAB_CONFIG.map(tab => {
                        const count = tab.id === 'all' ? totalResultsCount : (categorizedResults[tab.id]?.length || 0);
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`entity-tab-button ${activeTab === tab.id ? 'entity-tab-button-active' : ''}`}
                                style={{ fontSize: '0.7rem', padding: '8px 10px', gap: '6px' }}
                            >
                                <span>{tab.icon}</span>
                                <span>{tab.label}</span>
                                {lowerQuery.length >= 2 && count > 0 && (
                                    <span style={{ fontSize: '0.65rem', opacity: 0.8, borderRadius: '10px', background: activeTab === tab.id ? 'rgba(255,255,255,0.25)' : 'var(--social-bg)', padding: '1px 6px' }}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Results List */}
                <div className="modal-body editor-modal-body" style={{ flex: 1, padding: '16px' }}>
                    {lowerQuery.length < 1 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', opacity: 0.5, fontSize: '0.85rem' }}>
                            Type at least 1 characters to search across all lore, entities, prompts, and chat sessions.
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
                                            {item.title}
                                        </div>
                                        <span style={{ fontSize: '0.65rem', opacity: 0.5, textTransform: 'uppercase' }}>
                                            {item.tabId}
                                        </span>
                                    </div>

                                    {item.subtitle && (
                                        <div style={{ fontSize: '0.75rem', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                                            {item.subtitle}
                                        </div>
                                    )}

                                    {item.snippet && (
                                        <div style={{ fontSize: '0.8rem', opacity: 0.9, background: 'rgba(0,0,0,0.15)', padding: '6px 8px', borderRadius: '4px', width: '100%', boxSizing: 'border-box', borderLeft: '3px solid var(--accent)' }}>
                                            "{item.snippet}"
                                        </div>
                                    )}

                                    {/* Action row: Interactive buttons / Chat branch tags */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: '4px', flexWrap: 'wrap', gap: '6px' }}>
                                        {/* If it's a message, show clickable badges for every chat session it belongs to */}
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

                                        {/* Regular Entity Open / Inspect Action */}
                                        {item.tabId !== 'message' && (
                                            <div style={{ marginLeft: 'auto' }}>
                                                <button
                                                    type="button"
                                                    className="editor-button editor-button-save"
                                                    onClick={() => {
                                                        if (item.tabId === 'chat') {
                                                            onSwitchChat?.(item.id);
                                                        } else {
                                                            onSelectEntity?.(item.tabId, item.id, item.rawEntity);
                                                        }
                                                        onClose();
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