// src/components/CharacterCardImportModal.tsx
import type React from 'react';
import { useState, useRef } from 'react';
import type { Character, Context, Sampler } from '../types';
import { parseCharacterCard, mapCardToEditorFields, type ParsedCharacterCardExtended } from '../services/characterCardParser';
import { getInitiativeWeightValueFromText, getChatProbabilityValue, getMaximumChatStaminaValueFromText, getNameSensitivityValueFromText, getSkipProbabilityValueFromText, getChatImpatienceSensitivityValueFromText, getMemoryRetentionWeightValueFromText, getContextSensitivityValueFromText } from '../hooks/chatTraitsDetection';
import { uploadCharacterImage } from '../hooks/storage';
import { v4 as uuidv4 } from 'uuid';
import './main.css';

interface CharacterCardImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaveCharacter: (char: Character) => Promise<boolean>;
    onSaveContext: (ctx: Context) => Promise<boolean>;
    allSamplers: Sampler[];
}

interface ImportPreview {
    character: Character;
    lorebookContexts: Context[];
    emotionImageCount: number;
    cardFileName: string;
}

const DEFAULT_INITIATIVE_WEIGHT = 1.2;
const DEFAULT_CHAT_PROBABILITY = 0.5;
const DEFAULT_MAX_STAMINA = 4;
const DEFAULT_NAME_SENSITIVITY = 1;
const DEFAULT_CHAT_IMPATIENCE = 0;

export function CharacterCardImportModal({
    isOpen,
    onClose,
    onSaveCharacter,
    onSaveContext,
    allSamplers,
}: CharacterCardImportModalProps) {
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [includeLorebook, setIncludeLorebook] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const reset = () => {
        setPreview(null);
        setError(null);
        setIsProcessing(false);
        setIsSaving(false);
        setIncludeLorebook(true);
    };

    const handleClose = () => {
        if (isSaving) return;
        reset();
        onClose();
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';

        setIsProcessing(true);
        setError(null);
        setPreview(null);

        try {
            const card = await parseCharacterCard(file);
            if (!card) {
                setError('Not a valid character card PNG. Ensure it follows TavernAI V1/V2/V3 spec.');
                setIsProcessing(false);
                return;
            }

            const extended = card as ParsedCharacterCardExtended;
            const fields = mapCardToEditorFields(card);
            const now = Date.now();
            const charId = uuidv4();

            // Upload the card image as the neutral portrait
            let neutralFilename: string | undefined;
            try {
                neutralFilename = await uploadCharacterImage(charId, file);
            } catch {
                setError('Failed to upload character image from card.');
                setIsProcessing(false);
                return;
            }

            // Build images record with neutral + any extracted emotion images
            const images: Record<string, string> = {};
            if (neutralFilename) images['neutral'] = neutralFilename;
            if (extended.emotionImages) {
                for (const [emotion, filename] of Object.entries(extended.emotionImages)) {
                    if (filename && !images[emotion]) images[emotion] = filename;
                }
            }

            // Auto-detect traits from combined text
            const traitText = `${fields.name} ${fields.description} ${fields.systemPrompt}`;
            const initiativeWeight = getInitiativeWeightValueFromText(traitText);
            const chatProbability = getChatProbabilityValue(traitText);
            const maximumChatStamina = Math.round(getMaximumChatStaminaValueFromText(traitText));
            const nameSensitivity = getNameSensitivityValueFromText(traitText);
            const skipProbability = getSkipProbabilityValueFromText(traitText);
            const chatImpatienceSensitivity = getChatImpatienceSensitivityValueFromText(traitText);
            const memoryRetentionWeight = getMemoryRetentionWeightValueFromText(traitText);
            const contextSensitivity = getContextSensitivityValueFromText(traitText);

            // Assign default sampler if available
            const defaultSampler = allSamplers.length > 0 ? allSamplers[0] : undefined;

            const character: Character = {
                id: charId,
                name: fields.name || 'Unnamed Character',
                description: fields.description || '',
                systemPrompt: fields.systemPrompt || '',
                thinkPrompt: fields.thinkPrompt || undefined,
                appearancePrompt: fields.appearancePrompt || undefined,
                dialoguePrompt: fields.dialoguePrompt || undefined,
                images,
                sampler: defaultSampler,
                initiativeWeight,
                chatProbability,
                maximumChatStamina,
                nameSensitivity,
                skipProbability,
                chatImpatienceSensitivity,
                memoryRetentionWeight,
                contextSensitivity,
                enableWebSearch: false,
                enableCalculator: false,
                enableMemoryWriting: false,
                enableMemoryReading: false,
                memories: {},
                numberOfMessagesToDisableThinkPrompt: 0,
                numberOfMessagesToDisableMetaThinkInstructions: 0,
                numberOfMessagesToDisableDialoguePrompt: 0,
                firstCreatedTimestamp: now,
                lastUpdatedTimestamp: now,
            };

            // Build finalized lorebook contexts
            const lorebookContexts: Context[] = (extended.lorebookContexts || []).map(entry => ({
                id: uuidv4(),
                name: entry.name || 'Lorebook Entry',
                text: entry.text || '',
                regularExpressionActivationTrigger: entry.regularExpressionActivationTrigger,
                insertionDepth: entry.insertionDepth ?? 0,
                tokenBudget: entry.tokenBudget,
                useBase64Encoding: false,
                firstCreatedTimestamp: now,
                lastUpdatedTimestamp: now,
            } as Context));

            setPreview({
                character,
                lorebookContexts,
                emotionImageCount: extended.emotionImages ? Object.keys(extended.emotionImages).length : 0,
                cardFileName: file.name,
            });
        } catch (err) {
            setError(`Failed to parse character card: ${(err as Error).message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleConfirmSave = async () => {
        if (!preview) return;
        setIsSaving(true);
        setError(null);

        try {
            const charSuccess = await onSaveCharacter(preview.character);
            if (!charSuccess) {
                setError('Failed to save character.');
                setIsSaving(false);
                return;
            }

            if (includeLorebook && preview.lorebookContexts.length > 0) {
                let savedCount = 0;
                for (const ctx of preview.lorebookContexts) {
                    const success = await onSaveContext(ctx);
                    if (success) savedCount++;
                }
                if (savedCount < preview.lorebookContexts.length) {
                    setError(`Character saved, but only ${savedCount}/${preview.lorebookContexts.length} lorebook entries were saved.`);
                    setIsSaving(false);
                    return;
                }
            }

            reset();
            onClose();
        } catch (err) {
            setError(`Save failed: ${(err as Error).message}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Import Character Card</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClose} disabled={isSaving || isProcessing}>
                            {preview ? 'Cancel' : 'Close'}
                        </button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {error && <div className="editor-error-message editor-error-centered">{error}</div>}

                    {/* File Selection */}
                    {!preview && !isProcessing && (
                        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🎴</div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '8px' }}>Select a Character Card PNG</div>
                            <div style={{ fontSize: '0.7rem', opacity: 0.6, marginBottom: '20px' }}>
                                Supports TavernAI V1, V2, and V3 formats.<br />
                                Characters, emotion images and lorebook entries will be extracted automatically.
                            </div>
                                <button
                                    type="button"
                                    className="editor-btn editor-btn-save entity-upload-btn"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    Choose File
                                </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png"
                                hidden
                                onChange={handleFileSelected}
                            />
                        </div>
                    )}

                    {/* Processing State */}
                    {isProcessing && (
                        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⏳</div>
                            <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Parsing character card...</div>
                        </div>
                    )}

                    {/* Preview & Confirm */}
                    {preview && !isProcessing && (
                        <>
                            {/* Character Summary */}
                            <div className="editor-section">
                                <span className="editor-section-title">Character Preview</span>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem' }}>
                                    <div><strong>Name:</strong> {preview.character.name}</div>
                                    <div><strong>Source:</strong> {preview.cardFileName}</div>
                                    <div><strong>Description:</strong> {preview.character.description?.substring(0, 80) || '(none)'}{preview.character.description && preview.character.description.length > 80 ? '...' : ''}</div>
                                    <div><strong>Emotion Images:</strong> {preview.emotionImageCount}</div>
                                    <div><strong>System Prompt:</strong> {preview.character.systemPrompt ? `${preview.character.systemPrompt.length} chars` : '(none)'}</div>
                                    <div><strong>Dialogue Examples:</strong> {preview.character.dialoguePrompt ? 'Yes' : 'No'}</div>
                                </div>
                                <div style={{ marginTop: '8px', fontSize: '0.65rem', opacity: 0.5 }}>
                                    Traits auto-detected: IW={preview.character.initiativeWeight.toFixed(1)} · CP={preview.character.chatProbability.toFixed(2)} · Stamina={preview.character.maximumChatStamina} · NS={preview.character.nameSensitivity.toFixed(1)} · CIS={preview.character.chatImpatienceSensitivity.toFixed(1)}
                                </div>
                            </div>

                            {/* Lorebook Summary */}
                            {preview.lorebookContexts.length > 0 && (
                                <div className="editor-section">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span className="editor-section-title">Lorebook Entries ({preview.lorebookContexts.length})</span>
                                        <label className="editor-checkbox-label" style={{ margin: 0 }}>
                                            <input
                                                type="checkbox"
                                                checked={includeLorebook}
                                                onChange={e => setIncludeLorebook(e.target.checked)}
                                                className="editor-checkbox-input"
                                                disabled={isSaving}
                                            />
                                            <span style={{ fontSize: '0.7rem' }}>Import</span>
                                        </label>
                                    </div>
                                    {includeLorebook && (
                                        <div style={{ maxHeight: '150px', overflowY: 'auto', marginTop: '8px', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px' }}>
                                            {preview.lorebookContexts.map((ctx, i) => (
                                                <div key={ctx.id} style={{ fontSize: '0.7rem', padding: '4px 0', borderBottom: i < preview.lorebookContexts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                                    <strong>{ctx.name}</strong>
                                                    {ctx.regularExpressionActivationTrigger && (
                                                        <span style={{ opacity: 0.5, marginLeft: '6px', fontFamily: 'monospace', fontSize: '0.6rem' }}>
                                                            /{ctx.regularExpressionActivationTrigger}/
                                                        </span>
                                                    )}
                                                    <div style={{ opacity: 0.6, fontSize: '0.6rem', marginTop: '2px' }}>
                                                        {ctx.text?.substring(0, 100) || '(no content)'}{ctx.text && ctx.text.length > 100 ? '...' : ''}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Confirm Button */}
                            <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                                <button
                                    type="button"
                                    className="editor-btn editor-btn-cancel"
                                    onClick={() => { reset(); }}
                                    disabled={isSaving}
                                    style={{ flex: 1 }}
                                >
                                    Choose Different File
                                </button>
                                <button
                                    type="button"
                                    className="editor-btn editor-btn-save"
                                    onClick={handleConfirmSave}
                                    disabled={isSaving}
                                    style={{ flex: 1 }}
                                >
                                    {isSaving ? 'Saving...' : `✅ Save Character${includeLorebook && preview.lorebookContexts.length > 0 ? ` + ${preview.lorebookContexts.length} Contexts` : ''}`}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}