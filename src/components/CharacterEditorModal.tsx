// src/components/CharacterEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Character, Sampler, LanguageModel, Memory } from '../types';
import { LanguageModelEngine } from '../services/LanguageModelEngine';
import type { LanguageModelContext } from '../services/LanguageModelEngine';
import { uploadCharacterImage, uploadCharacterVoice } from '../hooks/storage';
import { getInitiativeWeightValueFromText, getChatProbabilityValue, getMaximumChatStaminaValueFromText, getNameSensitivityValueFromText, getChatImpatienceSensitivityValueFromText, getSkipProbabilityValueFromText, getMemoryRetentionWeightValueFromText, getContextSensitivityValueFromText } from '../hooks/chatTraitsDetection';
import { parseCharacterCard, mapCardToEditorFields, type ParsedCharacterCardExtended } from '../services/characterCardParser';
import { v4 as uuidv4 } from 'uuid';
import { CharacterAdvancedSettingsEditorModal } from './CharacterAdvancedSettingsEditorModal';
import { CharacterMemoryEditorModal } from './CharacterMemoryEditorModal';
import { CharacterImageEditorModal } from './CharacterImageEditorModal';
import './main.css';

// ─── Defaults ────────────────────────────────────────────────────────
const DEFAULT_INITIATIVE_WEIGHT = 1.2;
const DEFAULT_CHAT_PROBABILITY = 0.5;
const DEFAULT_MAXIMUM_CHAT_STAMINA = 4;
const DEFAULT_NAME_SENSITIVITY = 1;
const DEFAULT_CHAT_IMPATIENCE_SENSITIVITY = 0;
const DEFAULT_SKIP_PROBABILITY = 0;
const DEFAULT_MEMORY_RETENTION_WEIGHT = 1;
const DEFAULT_CONTEXT_SENSITIVITY = 1;
const DEFAULT_DISABLE_THINK_PROMPT = 1;
const DEFAULT_DISABLE_META_THINK = 1;
const DEFAULT_DISABLE_DIALOGUE_PROMPT = 1;
const MAX_VOICE_FILE_SIZE = 5 * 1024 * 1024;

const tokenEngine = new LanguageModelEngine();

interface TokenCounts {
    systemPrompt: number | null;
    thinkPrompt: number | null;
    appearancePrompt: number | null;
    dialoguePrompt: number | null;
}

interface CharacterEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (character: Character) => void;
    existingCharacter?: Character | null;
    allSamplers: Sampler[];
    isLoadingSamplers?: boolean;
    selectedModel?: LanguageModel | null;
    runningModels?: Record<string, any>;
}

export function CharacterEditorModal({
    isOpen, onClose, onSave, existingCharacter,
    allSamplers, isLoadingSamplers = false,
    selectedModel, runningModels
}: CharacterEditorModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [systemPrompt, setSystemPrompt] = useState('');
    const [thinkPrompt, setThinkPrompt] = useState('');
    const [appearancePrompt, setAppearancePrompt] = useState('');
    const [dialoguePrompt, setDialoguePrompt] = useState('');
    const [firstMessage, setFirstMessage] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [selectedSamplerId, setSelectedSamplerId] = useState<string>('');
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const [initiativeWeightStr, setInitiativeWeightStr] = useState<string>('-1');
    const [chatProbabilityStr, setChatProbabilityStr] = useState<string>('-1');
    const [maximumChatStaminaStr, setMaximumChatStaminaStr] = useState<string>('-1');
    const [nameSensitivityStr, setNameSensitivityStr] = useState<string>('-1');
    const [chatImpatienceSensitivityStr, setChatImpatienceSensitivityStr] = useState<string>('-1');
    const [skipProbabilityStr, setSkipProbabilityStr] = useState<string>('-1');
    const [memoryRetentionWeightStr, setMemoryRetentionWeightStr] = useState<string>('-1');
    const [contextSensitivityStr, setContextSensitivityStr] = useState<string>('-1');

    const [voiceFile, setVoiceFile] = useState<File | null>(null);
    const [voiceName, setVoiceName] = useState<string>('');
    const [existingVoiceName, setExistingVoiceName] = useState<string>('');

    const [doNotInjectCharacterImage, setDoNotInjectCharacterImage] = useState<boolean>(false);

    const [numberOfMessagesToDisableThinkPromptStr, setNumberOfMessagesToDisableThinkPromptStr] = useState<string>(String(DEFAULT_DISABLE_THINK_PROMPT));
    const [numberOfMessagesToDisableMetaThinkInstructionsStr, setNumberOfMessagesToDisableMetaThinkInstructionsStr] = useState<string>(String(DEFAULT_DISABLE_META_THINK));
    const [numberOfMessagesToDisableDialoguePromptStr, setNumberOfMessagesToDisableDialoguePromptStr] = useState<string>(String(DEFAULT_DISABLE_DIALOGUE_PROMPT));

    const [enableMemoryWriting, setEnableMemoryWriting] = useState<boolean>(false);
    const [enableMemoryReading, setEnableMemoryReading] = useState<boolean>(false);
    const [useWebSearch, setUseWebSearch] = useState<boolean>(false);
    const [useCalculator, setUseCalculator] = useState<boolean>(false);

    const [memories, setMemories] = useState<Record<string, Memory[]>>({});

    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [showMemoryManager, setShowMemoryManager] = useState(false);
    const [showImageEditor, setShowImageEditor] = useState(false);
    const [emotionImages, setEmotionImages] = useState<Record<string, string>>({});

    const [pendingCharacterId, setPendingCharacterId] = useState<string | null>(null);

    const [autoDetected, setAutoDetected] = useState<{ iw: number | null; cp: number | null; ms: number | null }>({
        iw: null, cp: null, ms: null,
    });

    const [tokenCounts, setTokenCounts] = useState<TokenCounts>({
        systemPrompt: null, thinkPrompt: null, appearancePrompt: null, dialoguePrompt: null,
    });
    const [countingField, setCountingField] = useState<keyof TokenCounts | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const cardImportRef = useRef<HTMLInputElement>(null);
    const voiceInputRef = useRef<HTMLInputElement>(null);
    const tokenCountTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const getModelContext = useCallback((): LanguageModelContext | undefined => {
        if (!selectedModel) return undefined;
        const runtimePort = selectedModel.id && runningModels?.[selectedModel.id]?.port;
        return { apiKey: selectedModel.apiKey, backend: selectedModel.backend, modelPath: (selectedModel as any).modelPath || (selectedModel as any).parameters?.modelPath, runtimePort };
    }, [selectedModel, runningModels]);

    const countFieldTokens = useCallback(async (field: keyof TokenCounts, text: string) => {
        if (!text.trim()) { setTokenCounts(prev => ({ ...prev, [field]: 0 })); return; }
        if (tokenCountTimeoutsRef.current[field]) clearTimeout(tokenCountTimeoutsRef.current[field]);
        tokenCountTimeoutsRef.current[field] = setTimeout(async () => {
            setCountingField(field);
            const ctx = getModelContext();
            const count = await tokenEngine.countTokens(text, ctx);
            setTokenCounts(prev => ({ ...prev, [field]: count }));
            setCountingField(prev => prev === field ? null : prev);
        }, 500);
    }, [getModelContext]);

    useEffect(() => { return () => { Object.values(tokenCountTimeoutsRef.current).forEach(clearTimeout); }; }, []);

    useEffect(() => {
        if (isOpen) {
            setSubmitError(null);
            setAutoDetected({ iw: null, cp: null, ms: null });
            setShowAdvancedSettings(false);
            setShowMemoryManager(false);
            setShowImageEditor(false);

            if (existingCharacter) {
                setName(existingCharacter.name || '');
                setDescription(existingCharacter.description || '');
                setSystemPrompt(existingCharacter.systemPrompt || '');
                setThinkPrompt(existingCharacter.thinkPrompt || '');
                setAppearancePrompt(existingCharacter.appearancePrompt || '');
                setDialoguePrompt(existingCharacter.dialoguePrompt || '');
                setFirstMessage('');

                const imgs = existingCharacter.images ?? {};
                setEmotionImages(imgs);
                const neutralFilename = imgs['neutral'];
                setImagePreview(neutralFilename ? `/user_data/character_images/${existingCharacter.id}/${neutralFilename}` : null);
                setImageFile(null);
                setPendingCharacterId(null);

                setSelectedSamplerId(existingCharacter.sampler?.id || (allSamplers[0]?.id || ''));
                setSelectedStopPatternIds(existingCharacter.sampler?.stopPatterns.map(sp => sp.id) || []);
                setInitiativeWeightStr(String(existingCharacter.initiativeWeight ?? -1));
                setChatProbabilityStr(String(existingCharacter.chatProbability ?? -1));
                setMaximumChatStaminaStr(String(existingCharacter.maximumChatStamina ?? -1));
                setNameSensitivityStr(String(existingCharacter.nameSensitivity ?? -1));
                setChatImpatienceSensitivityStr(String(existingCharacter.chatImpatienceSensitivity ?? -1));
                setSkipProbabilityStr(String(existingCharacter.skipProbability ?? -1));
                setMemoryRetentionWeightStr(String(existingCharacter.memoryRetentionWeight ?? -1));
                setContextSensitivityStr(String(existingCharacter.contextSensitivity ?? -1));
                setExistingVoiceName(existingCharacter.voice || '');
                setVoiceName(existingCharacter.voice || '');
                setVoiceFile(null);
                setDoNotInjectCharacterImage(existingCharacter.doNotInjectCharacterImage ?? false);
                setNumberOfMessagesToDisableThinkPromptStr(String(existingCharacter.numberOfMessagesToDisableThinkPrompt ?? DEFAULT_DISABLE_THINK_PROMPT));
                setNumberOfMessagesToDisableMetaThinkInstructionsStr(String(existingCharacter.numberOfMessagesToDisableMetaThinkInstructions ?? DEFAULT_DISABLE_META_THINK));
                setNumberOfMessagesToDisableDialoguePromptStr(String(existingCharacter.numberOfMessagesToDisableDialoguePrompt ?? DEFAULT_DISABLE_DIALOGUE_PROMPT));
                setEnableMemoryWriting(existingCharacter.enableMemoryWriting ?? false);
                setEnableMemoryReading(existingCharacter.enableMemoryReading ?? false);
                setUseWebSearch(existingCharacter.useWebSearch ?? false);
                setUseCalculator(existingCharacter.useCalculator ?? false);
                setMemories(existingCharacter.memories ?? {});
                countFieldTokens('systemPrompt', existingCharacter.systemPrompt || '');
                countFieldTokens('thinkPrompt', existingCharacter.thinkPrompt || '');
                countFieldTokens('appearancePrompt', existingCharacter.appearancePrompt || '');
                countFieldTokens('dialoguePrompt', existingCharacter.dialoguePrompt || '');
            } else {
                setName(''); setDescription(''); setSystemPrompt(''); setThinkPrompt(''); setAppearancePrompt(''); setDialoguePrompt(''); setFirstMessage('');
                setImageFile(null); setImagePreview(null);
                setEmotionImages({});
                setPendingCharacterId(uuidv4());
                setSelectedSamplerId(allSamplers[0]?.id || ''); setSelectedStopPatternIds([]);
                setInitiativeWeightStr('-1'); setChatProbabilityStr('-1'); setMaximumChatStaminaStr('-1'); setNameSensitivityStr('-1');
                setChatImpatienceSensitivityStr('-1'); setSkipProbabilityStr('-1'); setMemoryRetentionWeightStr('-1'); setContextSensitivityStr('-1');
                setExistingVoiceName(''); setVoiceName(''); setVoiceFile(null);
                setDoNotInjectCharacterImage(false);
                setNumberOfMessagesToDisableThinkPromptStr(String(DEFAULT_DISABLE_THINK_PROMPT));
                setNumberOfMessagesToDisableMetaThinkInstructionsStr(String(DEFAULT_DISABLE_META_THINK));
                setNumberOfMessagesToDisableDialoguePromptStr(String(DEFAULT_DISABLE_DIALOGUE_PROMPT));
                setEnableMemoryWriting(false); setEnableMemoryReading(false);
                setUseWebSearch(false); setUseCalculator(false);
                setMemories({});
                setTokenCounts({ systemPrompt: 0, thinkPrompt: 0, appearancePrompt: 0, dialoguePrompt: 0 });
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, existingCharacter, allSamplers]);

    const handleSystemPromptBlur = () => {
        const currentIW = Number.parseFloat(initiativeWeightStr);
        const currentCP = Number.parseFloat(chatProbabilityStr);
        const currentMS = Number.parseFloat(maximumChatStaminaStr);
        const currentNS = Number.parseFloat(nameSensitivityStr);
        const currentCIS = Number.parseFloat(chatImpatienceSensitivityStr);
        const currentSP = Number.parseFloat(skipProbabilityStr);
        const currentMRW = Number.parseFloat(memoryRetentionWeightStr);
        const currentCRS = Number.parseFloat(contextSensitivityStr);

        const iwIsAuto = currentIW === -1;
        const cpIsAuto = currentCP === -1;
        const msIsAuto = currentMS === -1;
        const nsIsAuto = currentNS === -1;
        const cisIsAuto = currentCIS === -1;
        const spIsAuto = currentSP === -1;
        const mrwIsAuto = currentMRW === -1;
        const crsIsAuto = currentCRS === -1;

        if (!iwIsAuto && !cpIsAuto && !msIsAuto && !nsIsAuto && !cisIsAuto && !spIsAuto && !mrwIsAuto && !crsIsAuto) return;

        const combinedText = `${name} ${description} ${systemPrompt}`;
        const newDetected = { ...autoDetected };

        if (iwIsAuto) { const v = getInitiativeWeightValueFromText(combinedText); setInitiativeWeightStr(String(v)); newDetected.iw = v; }
        if (cpIsAuto) { const v = getChatProbabilityValue(combinedText); setChatProbabilityStr(String(v)); newDetected.cp = v; }
        if (msIsAuto) { const v = getMaximumChatStaminaValueFromText(combinedText); setMaximumChatStaminaStr(String(Math.round(v))); newDetected.ms = Math.round(v); }
        if (nsIsAuto) { const v = getNameSensitivityValueFromText(combinedText); setNameSensitivityStr(String(v)); }
        if (cisIsAuto) { const v = getChatImpatienceSensitivityValueFromText(combinedText); setChatImpatienceSensitivityStr(String(v)); }
        if (spIsAuto) { const v = getSkipProbabilityValueFromText(combinedText); setSkipProbabilityStr(String(v)); }
        if (mrwIsAuto) { const v = getMemoryRetentionWeightValueFromText(combinedText); setMemoryRetentionWeightStr(String(v)); }
        if (crsIsAuto) { const v = getContextSensitivityValueFromText(combinedText); setContextSensitivityStr(String(v)); }

        setAutoDetected(newDetected);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.[0]) { setImageFile(e.target.files[0]); setImagePreview(URL.createObjectURL(e.target.files[0])); } };
    const handleRemoveImage = (e: React.MouseEvent) => {
        e.stopPropagation();
        setImageFile(null); setImagePreview(null);
        setEmotionImages(prev => { const next = { ...prev }; delete next['neutral']; return next; });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };
    const handleVoiceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const file = e.target.files[0];
            if (file.size > MAX_VOICE_FILE_SIZE) { setSubmitError(`Voice file too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`); e.target.value = ''; return; }
            setVoiceFile(file); setVoiceName(file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_')); setSubmitError(null);
        }
    };
    const handleRemoveVoice = () => { setVoiceFile(null); setVoiceName(''); setExistingVoiceName(''); if (voiceInputRef.current) voiceInputRef.current.value = ''; };

    const handleCardImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
        const card = await parseCharacterCard(file);
        if (!card) { setSubmitError("Not a valid character card PNG."); return; }
        const fields = mapCardToEditorFields(card);
        setName(fields.name); setDescription(fields.description); setSystemPrompt(fields.systemPrompt); setThinkPrompt(fields.thinkPrompt);
        setAppearancePrompt(fields.appearancePrompt); setDialoguePrompt(fields.dialoguePrompt); setFirstMessage(fields.firstMessage);
        setImageFile(file); setImagePreview(URL.createObjectURL(file));
        setAutoDetected({ iw: null, cp: null, ms: null });
        setInitiativeWeightStr('-1'); setChatProbabilityStr('-1'); setMaximumChatStaminaStr('-1'); setNameSensitivityStr('-1');
        setChatImpatienceSensitivityStr('-1'); setSkipProbabilityStr('-1'); setMemoryRetentionWeightStr('-1'); setContextSensitivityStr('-1');
        setSelectedStopPatternIds([]); setDoNotInjectCharacterImage(false);
        setNumberOfMessagesToDisableThinkPromptStr('0'); setNumberOfMessagesToDisableMetaThinkInstructionsStr('0'); setNumberOfMessagesToDisableDialoguePromptStr('0');
        setEnableMemoryWriting(false); setEnableMemoryReading(false);
        setUseWebSearch(false); setUseCalculator(false);
        setMemories({});
        countFieldTokens('systemPrompt', fields.systemPrompt); countFieldTokens('thinkPrompt', fields.thinkPrompt);
        countFieldTokens('appearancePrompt', fields.appearancePrompt); countFieldTokens('dialoguePrompt', fields.dialoguePrompt);
        setSubmitError(null);
        const extended = card as ParsedCharacterCardExtended;
        if (extended.emotionImages && Object.keys(extended.emotionImages).length > 0) {
            setEmotionImages(prev => ({ ...prev, ...extended.emotionImages! }));
        }
    };

    const handleStopPatternToggle = (id: string) => {
        setSelectedStopPatternIds(prev => prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]);
    };

    const buildCharacterFromForm = async (isNewClone: boolean): Promise<Character | null> => {
        setSubmitError(null);
        if (!name.trim()) { setSubmitError("Name is required!"); return null; }

        const targetCharacterId = isNewClone ? uuidv4() : (existingCharacter?.id || pendingCharacterId || uuidv4());

        let finalImages: Record<string, string> = isNewClone ? {} : { ...(existingCharacter?.images ?? {}) };
        finalImages = { ...finalImages, ...emotionImages };

        if (imageFile) {
            setIsUploading(true);
            try { finalImages['neutral'] = await uploadCharacterImage(targetCharacterId, imageFile); }
            catch { setSubmitError("Failed to upload image."); setIsUploading(false); return null; }
            setIsUploading(false);
        }

        let finalVoiceFilename: string | undefined = isNewClone ? undefined : existingCharacter?.voice;
        if (voiceFile) {
            setIsUploading(true);
            try { finalVoiceFilename = await uploadCharacterVoice(voiceFile); }
            catch { setSubmitError("Failed to upload voice."); setIsUploading(false); return null; }
            setIsUploading(false);
        } else if (!isNewClone && voiceName === '' && existingVoiceName !== '') { finalVoiceFilename = undefined; }

        const rawIW = Number.parseFloat(initiativeWeightStr);
        const rawCP = Number.parseFloat(chatProbabilityStr);
        const rawMS = Number.parseFloat(maximumChatStaminaStr);
        const rawNS = Number.parseFloat(nameSensitivityStr);
        const rawCIS = Number.parseFloat(chatImpatienceSensitivityStr);
        const rawSP = Number.parseFloat(skipProbabilityStr);
        const rawMRW = Number.parseFloat(memoryRetentionWeightStr);
        const rawCRS = Number.parseFloat(contextSensitivityStr);
        const rawDisableThink = Number.parseInt(numberOfMessagesToDisableThinkPromptStr);
        const rawDisableMeta = Number.parseInt(numberOfMessagesToDisableMetaThinkInstructionsStr);
        const rawDisableDialogue = Number.parseInt(numberOfMessagesToDisableDialoguePromptStr);

        const iwValid = !Number.isNaN(rawIW) && rawIW >= 0;
        const cpValid = !Number.isNaN(rawCP) && rawCP >= 0;
        const msValid = !Number.isNaN(rawMS) && rawMS >= 0;
        const nsValid = !Number.isNaN(rawNS) && rawNS >= 0;
        const cisValid = !Number.isNaN(rawCIS) && rawCIS >= 0;
        const spValid = !Number.isNaN(rawSP) && rawSP >= 0;
        const mrwValid = !Number.isNaN(rawMRW) && rawMRW >= 0;
        const crsValid = !Number.isNaN(rawCRS) && rawCRS >= 0;

        let finalIW: number, finalCP: number, finalMS: number, finalNS: number;
        let finalCIS: number, finalSP: number, finalMRW: number, finalCRS: number;

        if (existingCharacter && !isNewClone) {
            finalIW = iwValid ? rawIW : (existingCharacter.initiativeWeight ?? -1);
            finalCP = cpValid ? rawCP : (existingCharacter.chatProbability ?? -1);
            finalMS = msValid ? Math.round(rawMS) : (existingCharacter.maximumChatStamina ?? -1);
            finalNS = nsValid ? rawNS : (existingCharacter.nameSensitivity ?? DEFAULT_NAME_SENSITIVITY);
            finalCIS = cisValid ? rawCIS : (existingCharacter.chatImpatienceSensitivity ?? DEFAULT_CHAT_IMPATIENCE_SENSITIVITY);
            finalSP = spValid ? rawSP : (existingCharacter.skipProbability ?? DEFAULT_SKIP_PROBABILITY);
            finalMRW = mrwValid ? rawMRW : (existingCharacter.memoryRetentionWeight ?? DEFAULT_MEMORY_RETENTION_WEIGHT);
            finalCRS = crsValid ? rawCRS : (existingCharacter.contextSensitivity ?? DEFAULT_CONTEXT_SENSITIVITY);
            if (finalIW === -1 && finalCP === -1 && finalMS === -1) {
                const t = `${name} ${description} ${systemPrompt}`;
                finalIW = getInitiativeWeightValueFromText(t);
                finalCP = getChatProbabilityValue(t);
                finalMS = Math.round(getMaximumChatStaminaValueFromText(t));
            }
        } else {
            finalIW = iwValid ? rawIW : DEFAULT_INITIATIVE_WEIGHT;
            finalCP = cpValid ? rawCP : DEFAULT_CHAT_PROBABILITY;
            finalMS = msValid ? Math.round(rawMS) : DEFAULT_MAXIMUM_CHAT_STAMINA;
            finalNS = nsValid ? rawNS : DEFAULT_NAME_SENSITIVITY;
            finalSP = spValid ? rawSP : DEFAULT_SKIP_PROBABILITY;
            finalCIS = cisValid ? rawCIS : DEFAULT_CHAT_IMPATIENCE_SENSITIVITY;
            finalMRW = mrwValid ? rawMRW : DEFAULT_MEMORY_RETENTION_WEIGHT;
            finalCRS = crsValid ? rawCRS : DEFAULT_CONTEXT_SENSITIVITY;
            if (rawIW === -1 && rawCP === -1 && rawMS === -1) {
                const t = `${name} ${description} ${systemPrompt}`;
                const dIW = getInitiativeWeightValueFromText(t);
                const dCP = getChatProbabilityValue(t);
                const dMS = getMaximumChatStaminaValueFromText(t);
                if (dIW >= 0) finalIW = dIW;
                if (dCP >= 0) finalCP = dCP;
                if (dMS >= 0) finalMS = Math.round(dMS);
            }
        }

        const baseSampler = allSamplers.find(s => s.id === selectedSamplerId);
        const finalSampler = baseSampler ? { ...baseSampler, stopPatterns: baseSampler.stopPatterns.filter(sp => selectedStopPatternIds.includes(sp.id)) } : undefined;

        const now = Date.now();
        return {
            id: targetCharacterId,
            name: isNewClone ? `${name.trim()} (Clone)` : name.trim(),
            description, systemPrompt,
            thinkPrompt: thinkPrompt.trim() || undefined,
            appearancePrompt: appearancePrompt.trim() || undefined,
            dialoguePrompt: dialoguePrompt.trim() || undefined,
            images: finalImages,
            voice: finalVoiceFilename, sampler: finalSampler,
            initiativeWeight: finalIW, chatProbability: finalCP, maximumChatStamina: finalMS,
            nameSensitivity: finalNS, chatImpatienceSensitivity: finalCIS, skipProbability: finalSP,
            memoryRetentionWeight: finalMRW, contextSensitivity: finalCRS,
            doNotInjectCharacterImage: doNotInjectCharacterImage || undefined,
            numberOfMessagesToDisableThinkPrompt: Number.isNaN(rawDisableThink) ? DEFAULT_DISABLE_THINK_PROMPT : Math.max(0, rawDisableThink),
            numberOfMessagesToDisableMetaThinkInstructions: Number.isNaN(rawDisableMeta) ? DEFAULT_DISABLE_META_THINK : Math.max(0, rawDisableMeta),
            numberOfMessagesToDisableDialoguePrompt: Number.isNaN(rawDisableDialogue) ? DEFAULT_DISABLE_DIALOGUE_PROMPT : Math.max(0, rawDisableDialogue),
            enableMemoryWriting, enableMemoryReading,
            useWebSearch, useCalculator,
            memories,
            firstCreatedTimestamp: isNewClone ? now : (existingCharacter?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => { const c = await buildCharacterFromForm(false); if (!c) return; onSave(c); onClose(); };
    const handleClone = async () => { const c = await buildCharacterFromForm(true); if (!c) return; onSave(c); onClose(); };

    if (!isOpen) return null;

    const renderTokenCount = (field: keyof TokenCounts) => {
        const count = tokenCounts[field];
        const displayCount = count ?? 0;
        return <div className={`editor-token-count ${countingField === field ? 'counting' : ''}`}>{`~${displayCount.toLocaleString()} token(s)`}</div>;
    };
    const hasVoice = !!voiceFile || !!existingVoiceName;
    const effectiveCharacterId = existingCharacter?.id || pendingCharacterId || '';

    return (
        <>
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>{existingCharacter ? 'Edit Character' : 'Create New Character'}</h2>
                        <div className="editor-modal-actions">
                            <button type="button" className="editor-btn editor-btn-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                            {existingCharacter && <button type="button" className="editor-btn editor-btn-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                            {!existingCharacter && (<>
                                <button type="button" className="editor-btn editor-btn-import" onClick={() => cardImportRef.current?.click()} disabled={isUploading}>Import</button>
                                <input ref={cardImportRef} type="file" accept="image/png" hidden onChange={handleCardImport} disabled={isUploading} />
                            </>)}
                            <button type="button" className="editor-btn editor-btn-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Uploading...' : 'Save'}</button>
                        </div>
                    </div>

                    <div className="modal-body editor-modal-body">
                        {submitError && <div className="editor-error-message editor-error-centered">{submitError}</div>}

                        <div className="editor-modal-columns">
                            {/* LEFT COLUMN */}
                            <div className="editor-left-column">
                                <div className="editor-image-upload-container">
                                    <div className={`editor-image-square editor-image-portrait ${imagePreview ? 'active solid' : 'dashed'}`}
                                        style={{ cursor: isUploading ? 'wait' : 'pointer', opacity: isUploading ? 0.7 : 1 }}
                                        onClick={() => !isUploading && fileInputRef.current?.click()}>
                                        {imagePreview ? (<><img src={imagePreview} alt="Character" />{!isUploading && <div className="editor-image-hover-overlay"><button type="button" onClick={handleRemoveImage} className="editor-image-remove-btn-large" title="Remove Picture">🗑️</button></div>}</>) : (<div className="editor-image-placeholder">{isUploading ? '⏳' : '📷'}</div>)}
                                    </div>
                                    <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} disabled={isUploading} />
                                </div>

                                <button type="button" className="editor-btn editor-btn-cancel" onClick={() => setShowImageEditor(true)} disabled={isUploading} style={{ width: '100%', marginTop: '6px', fontSize: '0.75rem' }}>
                                    More Images ({Object.keys(emotionImages).length})
                                </button>

                                <textarea value={name} onChange={(e) => setName(e.target.value)} className="editor-textarea editor-textarea-name" placeholder="Name *" disabled={isUploading} />
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea editor-textarea-description" placeholder="Description" disabled={isUploading} />
                                <textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} className="editor-textarea editor-textarea-first-message" placeholder="First message" disabled={isUploading} />

                                <div className="editor-section editor-voice-section">
                                    <span className="editor-section-title">Voice</span>
                                    <div className="editor-voice-hint">Used for reading character's text. Maximum 5MB.</div>
                                    {hasVoice ? (
                                        <div className="editor-voice-chip"><span className="editor-voice-chip-name">🎙️ {voiceFile ? voiceFile.name : existingVoiceName}</span><button type="button" onClick={handleRemoveVoice} disabled={isUploading} className="editor-voice-remove-btn" title="Remove voice">×</button></div>
                                    ) : (
                                        <button type="button" onClick={() => !isUploading && voiceInputRef.current?.click()} disabled={isUploading} className={`toolbar-btn editor-voice-upload-btn ${isUploading ? 'uploading' : ''}`}>{isUploading ? 'Uploading...' : '🎙️ Upload Voice Sample'}</button>
                                    )}
                                    <input ref={voiceInputRef} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg" hidden onChange={handleVoiceChange} disabled={isUploading} />
                                </div>
                            </div>

                            {/* RIGHT COLUMN */}
                            <div className="editor-right-column">
                                <div className="editor-field-wrapper-full">
                                    <textarea value={systemPrompt} onChange={(e) => { setSystemPrompt(e.target.value); countFieldTokens('systemPrompt', e.target.value); }} onBlur={handleSystemPromptBlur} className="editor-textarea editor-textarea-system" placeholder="System prompt" disabled={isUploading} />
                                    {renderTokenCount('systemPrompt')}
                                </div>
                                <div className="editor-field-wrapper"><textarea value={thinkPrompt} onChange={(e) => { setThinkPrompt(e.target.value); countFieldTokens('thinkPrompt', e.target.value); }} className="editor-textarea editor-textarea-think" placeholder="Think Prompt" disabled={isUploading} />{renderTokenCount('thinkPrompt')}</div>
                                <div className="editor-field-wrapper"><textarea value={appearancePrompt} onChange={(e) => { setAppearancePrompt(e.target.value); countFieldTokens('appearancePrompt', e.target.value); }} className="editor-textarea editor-textarea-appearance" placeholder="Appearance Prompt" disabled={isUploading} />{renderTokenCount('appearancePrompt')}</div>
                                <div className="editor-field-wrapper"><textarea value={dialoguePrompt} onChange={(e) => { setDialoguePrompt(e.target.value); countFieldTokens('dialoguePrompt', e.target.value); }} className="editor-textarea editor-textarea-dialogue" placeholder="Dialogue Examples" disabled={isUploading} />{renderTokenCount('dialoguePrompt')}</div>

                                <div className="editor-bottom-section">
                                    <select value={selectedSamplerId} onChange={(e) => setSelectedSamplerId(e.target.value)} className={`editor-select ${isLoadingSamplers || isUploading ? 'editor-select-loading' : ''}`} disabled={isLoadingSamplers || isUploading}>
                                        {isLoadingSamplers && <option>Loading samplers...</option>}
                                        {!isLoadingSamplers && allSamplers.length === 0 && <option>No samplers available</option>}
                                        {!isLoadingSamplers && allSamplers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                    </select>

                                    <div className="editor-section">
                                        <label className="editor-checkbox-label">
                                            <input type="checkbox" checked={doNotInjectCharacterImage} onChange={(e) => setDoNotInjectCharacterImage(e.target.checked)} className="editor-checkbox-input" disabled={isUploading} />
                                            <span>Do Not Inject Character Image</span>
                                        </label>
                                    </div>

                                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                        <button type="button" className="editor-btn editor-btn-cancel" onClick={() => setShowAdvancedSettings(true)} disabled={isUploading} style={{ flex: 1 }}>Advanced Settings</button>
                                        <button type="button" className="editor-btn editor-btn-cancel" onClick={() => setShowMemoryManager(true)} disabled={isUploading} style={{ flex: 1 }}>Memory ({Object.values(memories).reduce((sum, arr) => sum + arr.length, 0)})</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <CharacterAdvancedSettingsEditorModal
                isOpen={showAdvancedSettings}
                onClose={() => setShowAdvancedSettings(false)}
                initiativeWeightStr={initiativeWeightStr}
                chatProbabilityStr={chatProbabilityStr}
                maximumChatStaminaStr={maximumChatStaminaStr}
                nameSensitivityStr={nameSensitivityStr}
                chatImpatienceSensitivityStr={chatImpatienceSensitivityStr}
                skipProbabilityStr={skipProbabilityStr}
                memoryRetentionWeightStr={memoryRetentionWeightStr}
                contextSensitivityStr={contextSensitivityStr}
                numberOfMessagesToDisableThinkPromptStr={numberOfMessagesToDisableThinkPromptStr}
                numberOfMessagesToDisableMetaThinkInstructionsStr={numberOfMessagesToDisableMetaThinkInstructionsStr}
                numberOfMessagesToDisableDialoguePromptStr={numberOfMessagesToDisableDialoguePromptStr}
                enableMemoryWriting={enableMemoryWriting}
                enableMemoryReading={enableMemoryReading}
                useWebSearch={useWebSearch}
                useCalculator={useCalculator}
                selectedStopPatternIds={selectedStopPatternIds}
                allSamplers={allSamplers}
                isUploading={isUploading}
                onInitiativeWeightChange={setInitiativeWeightStr}
                onChatProbabilityChange={setChatProbabilityStr}
                onMaximumChatStaminaChange={setMaximumChatStaminaStr}
                onNameSensitivityChange={setNameSensitivityStr}
                onChatImpatienceSensitivityChange={setChatImpatienceSensitivityStr}
                onSkipProbabilityChange={setSkipProbabilityStr}
                onMemoryRetentionWeightChange={setMemoryRetentionWeightStr}
                onContextSensitivityChange={setContextSensitivityStr}
                onDisableThinkChange={setNumberOfMessagesToDisableThinkPromptStr}
                onDisableMetaChange={setNumberOfMessagesToDisableMetaThinkInstructionsStr}
                onDisableDialogueChange={setNumberOfMessagesToDisableDialoguePromptStr}
                onEnableMemoryWritingChange={setEnableMemoryWriting}
                onEnableMemoryReadingChange={setEnableMemoryReading}
                onUseWebSearchChange={setUseWebSearch}
                onUseCalculatorChange={setUseCalculator}
                onStopPatternToggle={handleStopPatternToggle}
            />

            <CharacterMemoryEditorModal
                isOpen={showMemoryManager}
                onClose={() => setShowMemoryManager(false)}
                character={existingCharacter || null}
                onSaveMemories={setMemories}
            />

            <CharacterImageEditorModal
                isOpen={showImageEditor}
                onClose={() => setShowImageEditor(false)}
                characterId={effectiveCharacterId}
                images={emotionImages}
                onSave={(updatedImages) => {
                    setEmotionImages(updatedImages);
                    const neutral = updatedImages.neutral;
                    if (neutral) { setImagePreview(`/user_data/character_images/${effectiveCharacterId}/${neutral}`); setImageFile(null); }
                    else if (!imageFile) { setImagePreview(null); }
                }}
            />
        </>
    );
}