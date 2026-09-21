// src/components/ChatInput.tsx
import type React from 'react';
import type { BudgetStrategy, Character } from '../types';

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
    fileInputRef, textareaRef,
    onFileSelected, onToggleMicrophone, onSend, onStopGeneration, onOpenModels,
}: ChatInputProps) {
    return (
        <div className="input-wrapper">
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

            <div className="input-area">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading || !isModelReady} className="attach-button toolbar-button">📎</button>
                <input ref={fileInputRef} type="file" multiple hidden onChange={onFileSelected} />
                <button type="button" onClick={onToggleMicrophone} disabled={isLoading || !isModelReady} className={`attach-button toolbar-button ${isRecording ? 'stt-mic-active' : ''}`} title={isRecording ? 'Stop recording' : 'Start voice input'}>{isRecording ? '⏹' : '🎙️'}</button>
                <textarea
                    ref={textareaRef}
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && localProtagonist) { e.preventDefault(); onSend(); } }}
                    placeholder={isModelReady ? `Chat as ${localProtagonist?.name || 'User'}.` : isModelLoading ? 'Warming up... please wait' : 'Load a model to start chatting...'}
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