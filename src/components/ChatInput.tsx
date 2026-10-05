// src/components/ChatInput.tsx
import type React from 'react';
import { useState, useEffect, useRef, useMemo } from 'react';
import type { BudgetStrategy, InteractionData, Character, Location, Context, AudioTrack, World, PromptBlock, Sampler, StopPattern, Profile, Memory, Account, MultiplayerData } from '../types';
import { computeSlashAutocomplete, applySlashSelection } from '../utilities/slashCommandLogic';

interface ChatInputProps {
    inputText: string;
    setInputText: (text: string) => void;
    pendingFiles: File[];
    setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
    isRecording: boolean;
    isLoading: boolean;
    isModelReady: boolean | undefined;
    isModelLoading: boolean;
    modelStatusMessage: string;
    localProtagonist: Character | null;
    activeStrategy?: BudgetStrategy;
    selectedModelId: string | null;
    interactionData: InteractionData | null;
    allCharacters: Character[];
    allLocations: Location[];
    allContexts: Context[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allPromptBlocks: PromptBlock[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allProfiles: Profile[];
    allMemories: Memory[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    onFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onToggleMicrophone: () => void;
    onSend: () => void;
    onStopGeneration: () => void;
    onOpenModels: () => void;
}

export function ChatInput({
    inputText, setInputText, pendingFiles, setPendingFiles,
    isRecording, isLoading, isModelReady, isModelLoading, modelStatusMessage,
    localProtagonist, activeStrategy, selectedModelId,
    interactionData, allCharacters, allLocations, allContexts, allAudioTracks, allWorlds,
    allPromptBlocks, allSamplers, allStopPatterns, allProfiles, allMemories, allAccounts, allMultiplayerData,
    fileInputRef, textareaRef,
    onFileSelected, onToggleMicrophone, onSend, onStopGeneration, onOpenModels,
}: ChatInputProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [lastResetKey, setLastResetKey] = useState('');
    const autocompleteRef = useRef<HTMLDivElement>(null);

    const { breadcrumbs, options, isComplete, isSlash, activeIndex, currentQuery } = useMemo(() => {
        return computeSlashAutocomplete(
            inputText, interactionData, allCharacters, allLocations, allContexts,
            allAudioTracks, allPromptBlocks, allSamplers, allStopPatterns,
            allProfiles, allWorlds, allMemories, allAccounts, allMultiplayerData, localProtagonist
        );
    }, [inputText, interactionData, allCharacters, allLocations, allContexts, allAudioTracks, allPromptBlocks, allSamplers, allStopPatterns, allProfiles, allWorlds, allMemories, allAccounts, allMultiplayerData, localProtagonist]);

    const showAutocomplete = isSlash && !isComplete;

    const autocompleteKey = useMemo(() => {
        if (!showAutocomplete) return '';
        return `${breadcrumbs.join('|')}|${options.length}|${activeIndex}`;
    }, [showAutocomplete, breadcrumbs, options.length, activeIndex]);

    if (autocompleteKey && autocompleteKey !== lastResetKey) {
        setLastResetKey(autocompleteKey);
        setSelectedIndex(0);
    } else if (!autocompleteKey && lastResetKey !== '') {
        setLastResetKey('');
    }

    useEffect(() => {
        if (!showAutocomplete) return;
        const list = autocompleteRef.current?.querySelector('.slash-autocomplete-list');
        const selected = list?.querySelector('.slash-autocomplete-item-selected');
        selected?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [showAutocomplete]);

    const handleApplySelection = (opt: { value: string }) => {
        const updated = applySlashSelection(opt, inputText, activeIndex);
        setInputText(updated);
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
                    handleApplySelection(options[selectedIndex]);
                } else if (localProtagonist) {
                    onSend();
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
                setInputText(currentParts.length > 0 ? `${currentParts.join(' ')} ` : '/');
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
                                key={`${opt.type}-${opt.value}-${opt.id}-${i}`}
                                className={`slash-autocomplete-item ${i === selectedIndex ? 'slash-autocomplete-item-selected' : ''}`}
                                onMouseDown={(e) => { e.preventDefault(); handleApplySelection(opt); }}
                                onMouseEnter={() => setSelectedIndex(i)}
                            >
                                <span className="slash-autocomplete-label">{opt.label}</span>
                                {opt.id && opt.id !== 'example' && <span className="slash-autocomplete-id">({opt.id})</span>}
                                {opt.desc && <span className="slash-autocomplete-desc">{opt.desc}</span>}
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