// src/components/ChatInput.tsx
import type React from 'react';
import { useState, useEffect, useRef, useMemo } from 'react';
import type { BudgetStrategy, Character, InteractionData } from '../types';

interface ChatInputProps {
    inputText: string;
    setInputText: (text: string) => void;
    pendingFiles: File[];
    setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
    isRecording: boolean;
    isLoading: boolean;
    isModelReady: boolean;
    isModelLoading: boolean;
    modelStatusMessage: string;
    localProtagonist: Character | null;
    activeStrategy?: BudgetStrategy;
    selectedModelId: string | null;
    interactionData: InteractionData | null;
    allCharacters: Character[];
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    onFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onToggleMicrophone: () => void;
    onSend: () => void;
    onStopGeneration: () => void;
    onOpenModels: () => void;
}

// ─── Tree Data Structures ─────────────────────────────────────────
type ArgType = 'text' | 'location' | 'character' | 'clothing' | 'audio' | 'item' | 'context' | 'rng_table' | 'dialogue' | 'knowledge' | 'memory';

interface SlashArg { name: string; type: ArgType; desc: string; optional?: boolean; example?: string; }
interface SlashSub { name: string; desc: string; args?: SlashArg[]; }
interface SlashCmd { name: string; desc: string; subs?: SlashSub[]; args?: SlashArg[]; }

const COMMAND_TREE: SlashCmd[] = [
    { name: 'dice', desc: 'Roll dice', args: [{ name: 'notation', type: 'text', desc: 'Dice notation', example: '2d6+3' }] },
    { name: 'coin', desc: 'Flip a coin' },
    { name: 'random', desc: 'Random integer', args: [{ name: 'range', type: 'text', desc: 'Min-Max or just Max', example: '1-100' }] },
    { name: 'pick', desc: 'Pick from list', args: [{ name: 'options', type: 'text', desc: 'Comma-separated choices', example: 'sword, shield, potion' }] },
    { name: 'date', desc: 'Current date/time', args: [{ name: 'format', type: 'text', desc: 'Date format', example: 'iso', optional: true }] },
    { name: 'calculator', desc: 'Evaluate math', args: [{ name: 'expression', type: 'text', desc: 'Math expression', example: '15*7+3' }] },
    { name: 'move', desc: 'Move to adjacent location', args: [{ name: 'location', type: 'location', desc: 'Destination location' }] },
    { name: 'teleport', desc: 'Instant movement', args: [{ name: 'location', type: 'location', desc: 'Any location' }] },
    { name: 'map', desc: 'Show distance', args: [
        { name: 'from', type: 'location', desc: 'Start location', optional: true },
        { name: 'to', type: 'location', desc: 'End location' }
    ]},
    { name: 'inspect', desc: 'Examine character', args: [{ name: 'character', type: 'character', desc: 'Target character' }] },
    { name: 'invite', desc: 'Bring to current location', args: [{ name: 'character', type: 'character', desc: 'Character to invite' }] },
    { name: 'kick', desc: 'Kick to location', args: [
        { name: 'character', type: 'character', desc: 'Character to kick' },
        { name: 'location', type: 'location', desc: 'Destination (optional)', optional: true }
    ]},
    { name: 'summon', desc: 'Add character to session', args: [{ name: 'character', type: 'character', desc: 'Character from library' }] },
    { name: 'audio', desc: 'Play/stop audio', subs: [
        { name: 'play', desc: 'Play audio track', args: [{ name: 'track', type: 'audio', desc: 'Audio track to play' }] },
        { name: 'stop', desc: 'Stop audio track', args: [{ name: 'track', type: 'audio', desc: 'Audio track to stop', optional: true }] },
    ]},
    { name: 'clothing', desc: 'Equip/remove clothing', subs: [
        { name: 'wear', desc: 'Equip clothing', args: [
            { name: 'character', type: 'character', desc: 'Character' },
            { name: 'clothing', type: 'clothing', desc: 'Clothing item' }
        ]},
        { name: 'remove', desc: 'Remove clothing', args: [
            { name: 'character', type: 'character', desc: 'Character' },
            { name: 'clothing', type: 'clothing', desc: 'Clothing item' }
        ]},
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
            { name: 'character', type: 'character', desc: 'Recipient' },
            { name: 'items', type: 'text', desc: 'item:qty,item2:qty2', example: 'Iron Sword:1, Potion:3' }
        ]},
        { name: 'take', desc: 'Take item from character', args: [
            { name: 'character', type: 'character', desc: 'Source character' },
            { name: 'items', type: 'text', desc: 'item:qty,item2:qty2', example: 'Gold Coin:50' }
        ]},
        { name: 'offer', desc: 'Propose trade', args: [
            { name: 'character', type: 'character', desc: 'Trade partner' },
            { name: 'give_items', type: 'text', desc: 'item:qty', example: 'Iron Sword:1' },
            { name: 'take_items', type: 'text', desc: 'item:qty', example: 'Gold Coin:100' }
        ]},
        { name: 'accept', desc: 'Accept trade offer', args: [{ name: 'offer_id', type: 'text', desc: 'Offer ID', example: 'a1b2c3d4' }] },
        { name: 'decline', desc: 'Decline trade offer', args: [{ name: 'offer_id', type: 'text', desc: 'Offer ID', example: 'a1b2c3d4' }] },
        { name: 'list_offers', desc: 'List pending offers' },
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
    { name: 'key', desc: 'Lock/unlock locations', subs: [
        { name: 'lock', desc: 'Lock location', args: [
            { name: 'location', type: 'location', desc: 'Location to lock' },
            { name: 'character', type: 'character', desc: 'Character (all if omitted)', optional: true }
        ]},
        { name: 'unlock', desc: 'Unlock location', args: [
            { name: 'location', type: 'location', desc: 'Location to unlock' },
            { name: 'character', type: 'character', desc: 'Character (all if omitted)', optional: true }
        ]},
    ]},
    { name: 'think', desc: 'Reasoning step', args: [{ name: 'reasoning', type: 'text', desc: 'Your thought process', example: 'Should I trust this stranger?' }] },
    { name: 'narrate', desc: 'Inject narration', args: [{ name: 'text', type: 'text', desc: 'Narration text', example: 'The wind howls through the trees.' }] },
    { name: 'web', desc: 'Search or fetch', args: [{ name: 'query', type: 'text', desc: 'Search query or URL', example: 'medieval sword types' }] },
    { name: 'lookup', desc: 'Search lore', args: [{ name: 'keyword', type: 'text', desc: 'Search keyword', example: 'dragon' }] },
    { name: 'rng', desc: 'Roll on RNG table', args: [{ name: 'table', type: 'rng_table', desc: 'RNG table from context' }] },
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
];

interface EntityOption { value: string; label: string; id: string; extra?: string; }

function getEntityOptions(type: ArgType, data: InteractionData | null, allChars: Character[], localChar: Character | null): EntityOption[] {
    if (!data) return [];
    
    if (type === 'location') {
        const locations = data.locations || [];
        const currentLocIndex = [...data.interactionHistory].reverse().find(m => m.locationIndex !== undefined)?.locationIndex;
        const currentLoc = currentLocIndex !== undefined ? locations[currentLocIndex] : null;
        
        return locations.map(l => {
            const isCurrent = currentLoc && l.id === currentLoc.id;
            const adjacent = currentLoc?.locationBindings?.includes(l.id) || l.locationBindings?.includes(currentLoc?.id || '');
            return {
                value: l.id,
                label: l.name,
                id: l.id.substring(0, 8),
                extra: isCurrent ? '(current)' : adjacent ? '(adjacent)' : ''
            };
        });
    }
    
    if (type === 'character') {
        const participants = data.participants || [];
        const protagonistIds = new Set((data.protagonists || []).map(p => p.id));
        
        return participants.map(c => ({
            value: c.id,
            label: c.name,
            id: c.id.substring(0, 8),
            extra: protagonistIds.has(c.id) ? '(protagonist)' : ''
        }));
    }
    
    if (type === 'audio') {
        return (data.audioTracks || []).map(t => ({
            value: t.id,
            label: t.name,
            id: t.id.substring(0, 8),
            extra: t.audioCategory
        }));
    }
    
    if (type === 'clothing' && localChar) {
        return (localChar.clothings || []).map(c => ({
            value: c.id,
            label: c.name,
            id: c.id.substring(0, 8),
            extra: c.description ? c.description.substring(0, 30) : ''
        }));
    }
    
    if (type === 'item') {
        const lastMsg = [...data.interactionHistory].reverse().find(m => 
            m.character.id === localChar?.id && m.messageType === 'chat' && m.inventory
        );
        if (lastMsg && lastMsg.inventory) {
            return Object.entries(lastMsg.inventory)
                .filter(([k]) => !k.startsWith('__'))
                .map(([k, v]) => ({
                    value: k,
                    label: k,
                    id: `×${v}`,
                    extra: ''
                }));
        }
    }
    
    if (type === 'context') {
        return (data.contexts || []).map(c => ({
            value: c.id,
            label: c.name,
            id: c.id.substring(0, 8)
        }));
    }
    
    if (type === 'rng_table') {
        return (data.contexts || [])
            .filter(c => c.text && /^\d+[-:]/.test(c.text || ''))
            .map(c => ({
                value: c.name || c.id,
                label: c.name || 'Unnamed RNG',
                id: c.id.substring(0, 8)
            }));
    }
    
    if (type === 'dialogue') {
        const dialogues = localChar?.dialoguePrompts || [];
        return dialogues.map(d => ({
            value: d.id,
            label: d.name,
            id: d.id.substring(0, 8)
        }));
    }
    
    if (type === 'knowledge') {
        const knowledge = localChar?.knowledgePrompts || [];
        return knowledge.map(k => ({
            value: k.id,
            label: k.name,
            id: k.id.substring(0, 8)
        }));
    }
    
    if (type === 'memory') {
        const memories = localChar?.memories || {};
        const result: EntityOption[] = [];
        for (const [key, mems] of Object.entries(memories)) {
            for (const mem of mems) {
                result.push({
                    value: mem.id,
                    label: mem.name || key,
                    id: mem.id.substring(0, 8),
                    extra: mem.content.substring(0, 40) + '...'
                });
            }
        }
        return result;
    }
    
    return [];
}

export function ChatInput({
    inputText, setInputText, pendingFiles, setPendingFiles,
    isRecording, isLoading, isModelReady, isModelLoading, modelStatusMessage,
    localProtagonist, activeStrategy, selectedModelId,
    interactionData, allCharacters,
    fileInputRef, textareaRef,
    onFileSelected, onToggleMicrophone, onSend, onStopGeneration, onOpenModels,
}: ChatInputProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const autocompleteRef = useRef<HTMLDivElement>(null);

    const raw = inputText.trimStart();
    const isSlash = raw.startsWith('/');
    const textAfterSlash = raw.slice(1);
    const parts = textAfterSlash.split(/\s+/).filter(p => p.length > 0);
    const isTypingNewToken = inputText.endsWith(' ');
    const activeIndex = isTypingNewToken ? parts.length : Math.max(0, parts.length - 1);
    const currentQuery = (isTypingNewToken ? '' : parts[activeIndex] || '').toLowerCase();

    const { breadcrumbs, options, isComplete } = useMemo(() => {
        if (!isSlash) return { breadcrumbs: [], options: [], isComplete: false };

        if (parts.length === 0) {
            return {
                breadcrumbs: [`Command (${COMMAND_TREE.length})`],
                options: COMMAND_TREE.map(c => ({ type: 'cmd' as const, value: c.name, label: c.name, id: '', desc: c.desc })),
                isComplete: false,
            };
        }

        const cmd = COMMAND_TREE.find(c => c.name === parts[0]);

        if (!cmd) {
            const filtered = COMMAND_TREE.filter(c => c.name.toLowerCase().startsWith(parts[0].toLowerCase()));
            return {
                breadcrumbs: [`Command (${filtered.length}/${COMMAND_TREE.length})`],
                options: filtered.map(c => ({ type: 'cmd' as const, value: c.name, label: c.name, id: '', desc: c.desc })),
                isComplete: false,
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
                };
            } else if (cmd.args && cmd.args.length > 0) {
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
                    };
                } else {
                    const entities = getEntityOptions(arg.type, interactionData, allCharacters, localProtagonist);
                    const filtered = entities.filter(e => 
                        e.label.toLowerCase().includes(effectiveQuery) || 
                        e.id.toLowerCase().includes(effectiveQuery) ||
                        (e.extra && e.extra.toLowerCase().includes(effectiveQuery))
                    );
                    return {
                        breadcrumbs: [cmd.name, `${arg.name} (${filtered.length}/${entities.length})`],
                        options: filtered.map(e => ({ 
                            type: 'arg' as const, 
                            value: e.value, 
                            label: e.label, 
                            id: e.id, 
                            desc: e.extra || arg.desc 
                        })),
                        isComplete: false,
                    };
                }
            } else {
                return { breadcrumbs: [cmd.name, 'Complete ✓'], options: [], isComplete: true };
            }
        }

        const sub = cmd.subs ? cmd.subs.find(s => s.name === parts[1]) : undefined;
        const args = sub ? sub.args : cmd.args;
        
        if (!args || args.length === 0) {
            return { breadcrumbs: [cmd.name, ...(sub ? [sub.name] : []), 'Complete ✓'], options: [], isComplete: true };
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
                };
            } else {
                const entities = getEntityOptions(arg.type, interactionData, allCharacters, localProtagonist);
                const filtered = entities.filter(e => 
                    e.label.toLowerCase().includes(effectiveQuery) || 
                    e.id.toLowerCase().includes(effectiveQuery) ||
                    (e.extra && e.extra.toLowerCase().includes(effectiveQuery))
                );
                return {
                    breadcrumbs: [...breadcrumbTrail, `${arg.name} (${filtered.length}/${entities.length}${arg.optional ? ', optional' : ''})`],
                    options: filtered.map(e => ({ 
                        type: 'arg' as const, 
                        value: e.value, 
                        label: e.label, 
                        id: e.id, 
                        desc: e.extra || arg.desc 
                    })),
                    isComplete: false,
                };
            }
        }

        return { breadcrumbs: [cmd.name, ...(sub ? [sub.name] : []), 'Complete ✓'], options: [], isComplete: true };
    }, [isSlash, parts, activeIndex, currentQuery, isTypingNewToken, interactionData, allCharacters, localProtagonist]);

    const showAutocomplete = isSlash && !isComplete;

    useEffect(() => { setSelectedIndex(0); }, [options.length, activeIndex, isComplete]);

    useEffect(() => {
        if (!showAutocomplete) return;
        const list = autocompleteRef.current?.querySelector('.slash-autocomplete-list');
        const selected = list?.querySelector('.slash-autocomplete-item-selected');
        if (selected && list) {
            selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [selectedIndex, showAutocomplete]);

    const applySelection = (opt: { value: string }) => {
        const rawText = inputText.trimStart();
        if (!rawText.startsWith('/')) return;
        
        const afterSlash = rawText.slice(1);
        const currentParts = afterSlash.split(/\s+/).filter(p => p.length > 0);
        
        if (isTypingNewToken || activeIndex >= currentParts.length) {
            currentParts.push(opt.value);
        } else {
            currentParts[activeIndex] = opt.value;
        }
        
        setInputText('/' + currentParts.join(' ') + ' ');
        textareaRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (showAutocomplete) {
            if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
                e.preventDefault();
                if (options.length > 0) {
                    setSelectedIndex(prev => (prev + 1) % options.length);
                }
                return;
            }
            if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                e.preventDefault();
                if (options.length > 0) {
                    setSelectedIndex(prev => (prev - 1 + options.length) % options.length);
                }
                return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (options.length > 0 && options[selectedIndex]) {
                    applySelection(options[selectedIndex]);
                } else if (options.length === 0) {
                    if (localProtagonist) onSend();
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setInputText(inputText.trimEnd());
                return;
            }
            if (e.key === 'Backspace' && currentQuery === '' && activeIndex > 0) {
                e.preventDefault();
                const currentParts = inputText.trim().split(/\s+/).filter(p => p.length > 0);
                currentParts.pop();
                setInputText(currentParts.length > 0 ? currentParts.join(' ') + ' ' : '/');
                return;
            }
            return;
        }

        if (e.key === 'Enter' && !e.shiftKey && localProtagonist) {
            e.preventDefault();
            onSend();
        }
    };

    return (
        <div className="input-wrapper" style={{ position: 'relative' }}>
            {!activeStrategy && !isModelReady && (
                <div className={`model-status-banner ${!selectedModelId ? 'model-status-warning' : 'model-status-loading'}`}>
                    {!selectedModelId && <span className="model-status-icon">🤖</span>}
                    {isModelLoading && <span className="model-status-spinner" />}
                    <span className="model-status-text">{modelStatusMessage}</span>
                    {!selectedModelId && (
                        <button type="button" className="model-status-action-button" onClick={onOpenModels}>Open Language Models</button>
                    )}
                </div>
            )}

            {pendingFiles.length > 0 && (
                <div className="attachment-strip">
                    {pendingFiles.map((f, i) => (
                        <div key={`${f.name}-${i}`} className="attachment-chip">
                            <span className="attachment-name">{f.name}</span>
                            <span className="attachment-size">{(f.size / 1024).toFixed(1)} KB</span>
                            <button type="button" onClick={() => setPendingFiles(p => p.filter((_, j) => j !== i))} className="attachment-remove">×</button>
                        </div>
                    ))}
                </div>
            )}

            {showAutocomplete && (
                <div ref={autocompleteRef} className="slash-autocomplete">
                    <div className="slash-autocomplete-breadcrumbs">
                        {breadcrumbs.map((b, i) => (
                            <span key={i} className="slash-breadcrumb">
                                {b} {i < breadcrumbs.length - 1 && <span className="slash-breadcrumb-sep">›</span>}
                            </span>
                        ))}
                    </div>
                    <div className="slash-autocomplete-list">
                        {options.length === 0 && (
                            <div className="slash-autocomplete-no-results">
                                Type any text, then press Enter to send
                            </div>
                        )}
                        {options.map((opt, i) => (
                            <div
                                key={`${opt.type}-${opt.value}-${i}`}
                                className={`slash-autocomplete-item ${i === selectedIndex ? 'slash-autocomplete-item-selected' : ''}`}
                                onMouseDown={(e) => { e.preventDefault(); applySelection(opt); }}
                                onMouseEnter={() => setSelectedIndex(i)}
                            >
                                <span className="slash-autocomplete-label">{opt.label}</span>
                                {opt.id && opt.id !== 'example' && <span className="slash-autocomplete-id">({opt.id})</span>}
                                <span className="slash-autocomplete-desc">{opt.desc}</span>
                            </div>
                        ))}
                    </div>
                    <div className="slash-autocomplete-hint">
                        <span><kbd>Tab</kbd> scroll</span>
                        <span><kbd>Enter</kbd> select</span>
                        <span><kbd>Esc</kbd> close</span>
                    </div>
                </div>
            )}

            <div className="input-area">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading || !isModelReady} className="attach-button toolbar-button">📎</button>
                <input ref={fileInputRef} type="file" multiple hidden onChange={onFileSelected} />
                <button type="button" onClick={onToggleMicrophone} disabled={isLoading || !isModelReady} className={`attach-button toolbar-button ${isRecording ? 'stt-mic-active' : ''}`} title={isRecording ? 'Stop recording' : 'Start voice input'}>{isRecording ? '⏹' : '🎙️'}</button>
                <textarea
                    ref={textareaRef}
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isModelReady ? `Chat as ${localProtagonist?.name || 'User'}. Type / for commands.` : isModelLoading ? 'Warming up... please wait' : 'Load a model to start chatting...'}
                    className={`chat-input ${!isModelReady ? 'chat-input-disabled' : ''}`}
                    disabled={isLoading || !isModelReady || !localProtagonist}
                />
                <button
                    type="button"
                    onClick={isLoading ? onStopGeneration : onSend}
                    disabled={!isLoading && (!inputText.trim() && !pendingFiles.length) || (!isLoading && !isModelReady) || (!isLoading && !localProtagonist)}
                    className={`send-button ${!isLoading && !isModelReady ? 'send-button-disabled' : ''}`}
                >{isLoading ? '⏹' : !isModelReady ? '⏳' : '↑'}</button>
            </div>
        </div>
    );
}