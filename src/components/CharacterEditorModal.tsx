// src/components/CharacterEditorModal.tsx
import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Character, Sampler, LanguageModel, Memory, Clothing, TextCharacterInjection, DialoguePrompt, KnowledgePrompt, tool } from '../types';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { uploadCharacterImage, uploadCharacterVoice, getCharacterImageUrl } from '../storage/serverStorage';
import { getInitiativeWeightValueFromText, getChatProbabilityValue, getMaximumChatStaminaValueFromText, getNameSensitivityValueFromText, getChatImpatienceSensitivityValueFromText, getSkipProbabilityValueFromText, getMemoryRetentionWeightValueFromText, getContextSensitivityValueFromText, getMaximumActionStaminaValueFromText } from '../hooks/chatTraitsDetection';
import { parseCharacterCard, mapCardToEditorFields, type ParsedCharacterCardExtended } from '../services/characterCardParser';
import { v4 as uuidv4 } from 'uuid';
import { CharacterMemoryEditorModal } from './CharacterMemoryEditorModal';
import { CharacterImageEditorModal } from './CharacterImageEditorModal';
import { CharacterClothingEditorModal } from './CharacterClothingEditorModal';
import { CharacterTextCharacterInjectionEditorModal } from './CharacterTextCharacterInjectionEditorModal';
import { CharacterDialoguePromptEditorModal } from './CharacterDialoguePromptEditorModal';
import { CharacterKnowledgePromptEditorModal } from './CharacterKnowledgePromptEditorModal';
import '../main.css';
import { defaultCharacterTools } from '../dictionaries/defaults';
import { toolLabels } from '../dictionaries/texts';

// ─── Defaults ───────────────────────────────────────────────────────
const DEFAULT_INITIATIVE_WEIGHT = 1.2;
const DEFAULT_CHAT_PROBABILITY = 0.5;
const DEFAULT_MAXIMUM_CHAT_STAMINA = 4;
const DEFAULT_NAME_SENSITIVITY = 1;
const DEFAULT_CHAT_IMPATIENCE_SENSITIVITY = 0;
const DEFAULT_SKIP_PROBABILITY = 0;
const DEFAULT_MEMORY_RETENTION_WEIGHT = 1;
const DEFAULT_CONTEXT_SENSITIVITY = 1;
const DEFAULT_MAXIMUM_ACTION_STAMINA = 5;
const MAX_VOICE_FILE_SIZE = 5 * 1024 * 1024;

const TOOL_DESCRIPTIONS: Record<tool, string> = {
    think: 'Allow this character to think before committing to an output.',
    pick: 'Allow this character to randomly pick from a list of options.',
    date: 'Allow this character to check the current date and time during conversation.',
    coin: 'Allow this character to flip a coin during conversation.',
    dice: 'Allow this character to roll dice, such as 2d6+3, during conversation.',
    random: 'Allow this character to generate random numbers during conversation.',
    rng: 'Allow this character to roll on named RNG tables defined in contexts.',
    move: 'Allow this character to move between adjacent locations using normal movement cost.',
    timer: 'Allow this character to set, check, and manage countdown timers.',
    stopwatch: 'Allow this character to start, pause, resume, and stop stopwatches.',
    calculator: 'Allow this character to perform calculations during conversation.',
    web: 'Allow this character to search the web during conversation.',
    dialogue: 'Allow this character to reference its own dialogue prompts.',
    knowledge: 'Allow this character to access its knowledge prompts on demand. Knowledge is not injected into context unless explicitly recalled via this tool.',
    memory: 'Allow this character to recall its own memories on demand. Memories are not injected into context unless explicitly recalled via this tool.',
    lookup: 'Allow this character to search contexts and lore by keyword.',
    map: 'Allow this character to check distances between locations.',
    audio: 'Allow this character to play and stop audio tracks during conversation.',
    clothing: 'Allow this character to wear and take off clothing.',
    note: 'Allow this character to save, retrieve, and manage persistent notes.',
    inventory: 'Allow this character to add, remove, set, and list inventory items.',
    invite: 'Allow this character to bring an existing participant, except the protagonist, to the current location.',
    kick: 'Allow this character to move an existing participant, including the protagonist, out of the current location to another one.',
    teleport: 'Allow this character to instantly move self or a target to any location regardless of adjacency, bypassing normal movement cost.',
    key: 'Allow this character to lock or unlock a location.',
    summon: 'Allow this character to add a non-participant character into the current interaction session.',
    narrate: 'Allow this character to inject ambient narration as the narrator voice without consuming character chat stamina.',
    inspect: 'Allow this character to examine another character\'s visible state such as name, location, expression, or inventory.',
    administrator: 'Allow this character to perform high-level administrative actions such as managing chat sessions, models, navigation, and user-data-related controls.',
    creator: 'Allow this character to create user-data-related entities such as characters, contexts, locations, worlds, prompt blocks, profiles, or other supported data.',
    destroyer: 'Allow this character to delete or destroy user-data-related entities. Enable with caution.',
};

const tokenEngine = getLanguageModelEngine();

interface TokenCounts {
    systemPrompt: number | null;
    thinkPrompt: number | null;
    appearancePrompt: number | null;
}

type EditorTabId = 'general' | 'behaviour' | 'stats' | 'tools' | 'model';

interface CharacterEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (character: Character) => void;
    existingCharacter?: Character | null;
    allSamplers: Sampler[];
    isLoadingSamplers?: boolean;
    selectedModel?: LanguageModel | null;
    runningModels?: Record<string, any>;
    chatNameMap?: Map<string, string>;
}

export function CharacterEditorModal({
    isOpen, onClose, onSave, existingCharacter,
    allSamplers, isLoadingSamplers = false,
    selectedModel, runningModels,
    chatNameMap,
}: CharacterEditorModalProps) {
    if (!isOpen) return null;

    const modalKey = `char-${existingCharacter?.id ?? 'new'}`;

    return (
        <CharacterEditorModalInner
            key={modalKey}
            onClose={onClose}
            onSave={onSave}
            existingCharacter={existingCharacter}
            allSamplers={allSamplers}
            isLoadingSamplers={isLoadingSamplers}
            selectedModel={selectedModel}
            runningModels={runningModels}
            chatNameMap={chatNameMap}
        />
    );
}

function CharacterEditorModalInner({
    onClose, onSave, existingCharacter,
    allSamplers, isLoadingSamplers = false,
    selectedModel, runningModels,
    chatNameMap,
}: Omit<CharacterEditorModalProps, 'isOpen'>) {
    const [activeTab, setActiveTab] = useState<EditorTabId>('general');

    const [name, setName] = useState(existingCharacter?.name || '');
    const [description, setDescription] = useState(existingCharacter?.description || '');
    const [systemPrompt, setSystemPrompt] = useState(existingCharacter?.systemPrompt || '');
    const [thinkPrompt, setThinkPrompt] = useState(existingCharacter?.thinkPrompt || '');
    const [appearancePrompt, setAppearancePrompt] = useState(existingCharacter?.appearancePrompt || '');
    const [firstMessage, setFirstMessage] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(() => {
        if (existingCharacter) {
            const imgs = existingCharacter.images ?? {};
            const neutralFilename = imgs.neutral;
            return neutralFilename ? getCharacterImageUrl(existingCharacter.id, neutralFilename) : null;
        }
        return null;
    });
    const [selectedSamplerId, setSelectedSamplerId] = useState<string>(existingCharacter?.sampler?.id || (allSamplers[0]?.id || ''));
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>(existingCharacter?.sampler?.stopPatterns.map(sp => sp.id) || []);
    const [isUploading, setIsUploading] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const [initiativeWeightStr, setInitiativeWeightStr] = useState<string>(String(existingCharacter?.initiativeWeight ?? -1));
    const [chatProbabilityStr, setChatProbabilityStr] = useState<string>(String(existingCharacter?.chatProbability ?? -1));
    const [maximumChatStaminaStr, setMaximumChatStaminaStr] = useState<string>(String(existingCharacter?.maximumChatStamina ?? -1));
    const [nameSensitivityStr, setNameSensitivityStr] = useState<string>(String(existingCharacter?.nameSensitivity ?? -1));
    const [chatImpatienceSensitivityStr, setChatImpatienceSensitivityStr] = useState<string>(String(existingCharacter?.chatImpatienceSensitivity ?? -1));
    const [skipProbabilityStr, setSkipProbabilityStr] = useState<string>(String(existingCharacter?.skipProbability ?? -1));
    const [memoryRetentionWeightStr, setMemoryRetentionWeightStr] = useState<string>(String(existingCharacter?.memoryRetentionWeight ?? -1));
    const [contextSensitivityStr, setContextSensitivityStr] = useState<string>(String(existingCharacter?.contextSensitivity ?? -1));
    const [maximumActionStaminaStr, setMaximumActionStaminaStr] = useState<string>(String(existingCharacter?.maximumActionStamina ?? -1));

    const [voiceFile, setVoiceFile] = useState<File | null>(null);
    const [voiceName, setVoiceName] = useState<string>(existingCharacter?.voice || '');
    const [existingVoiceName, setExistingVoiceName] = useState<string>(existingCharacter?.voice || '');

    const [useFrontCameraImage, setUseFrontCameraImage] = useState<boolean>(existingCharacter?.useFrontCameraImage ?? false);
    const [doNotInjectCharacterImage, setDoNotInjectCharacterImage] = useState<boolean>(existingCharacter?.doNotInjectCharacterImage ?? false);

    const [numberOfMessagesToDisableThinkPromptStr, setNumberOfMessagesToDisableThinkPromptStr] = useState<string>(String(existingCharacter?.numberOfMessagesToDisableThinkPrompt ?? 0));
    const [numberOfMessagesToDisableMetaThinkInstructionsStr, setNumberOfMessagesToDisableMetaThinkInstructionsStr] = useState<string>(String(existingCharacter?.numberOfMessagesToDisableMetaThinkInstructions ?? 0));
    const [numberOfMessagesToDisableDialoguePromptStr, setNumberOfMessagesToDisableDialoguePromptStr] = useState<string>(String(existingCharacter?.numberOfMessagesToDisableDialoguePrompt ?? 0));
    const [numberOfMessagesToDisableStarterPromptStr, setNumberOfMessagesToDisableStarterPromptStr] = useState<string>(String(existingCharacter?.numberOfMessagesToDisableStarterPrompt ?? 0));

    const [tools, setTools] = useState<Record<tool, boolean>>(existingCharacter?.tools ?? { ...defaultCharacterTools });

    const [memories, setMemories] = useState<Record<string, Memory[]>>(existingCharacter?.memories ?? {});
    const [clothings, setClothings] = useState<Clothing[]>(existingCharacter?.clothings ?? []);
    const [textCharacterInjections, setTextCharacterInjections] = useState<TextCharacterInjection[]>(existingCharacter?.textCharacterInjections ?? []);
    const [dialoguePrompts, setDialoguePrompts] = useState<DialoguePrompt[]>(existingCharacter?.dialoguePrompts ?? []);
    const [knowledgePrompts, setKnowledgePrompts] = useState<KnowledgePrompt[]>(existingCharacter?.knowledgePrompts ?? []);
    const [starterPrompts, setStarterPrompts] = useState<Record<string, number>>(existingCharacter?.starterPrompts ?? {});

    const [showMemoryManager, setShowMemoryManager] = useState(false);
    const [showImageEditor, setShowImageEditor] = useState(false);
    const [showClothingEditor, setShowClothingEditor] = useState(false);
    const [showTextInjectionEditor, setShowTextInjectionEditor] = useState(false);
    const [showDialoguePromptEditor, setShowDialoguePromptEditor] = useState(false);
    const [showKnowledgePromptEditor, setShowKnowledgePromptEditor] = useState(false);
    const [emotionImages, setEmotionImages] = useState<Record<string, string>>(existingCharacter?.images ?? {});

    const [pendingCharacterId] = useState<string | null>(existingCharacter ? null : uuidv4());

    const [autoDetected, setAutoDetected] = useState<{ iw: number | null; cp: number | null; ms: number | null }>({
        iw: null, cp: null, ms: null,
    });

    const [tokenCounts, setTokenCounts] = useState<TokenCounts>({
        systemPrompt: null, thinkPrompt: null, appearancePrompt: null,
    });
    const [countingField, setCountingField] = useState<keyof TokenCounts | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const cardImportRef = useRef<HTMLInputElement>(null);
    const voiceInputRef = useRef<HTMLInputElement>(null);
    const tokenCountTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const handleToolToggle = useCallback((toolName: tool) => {
        setTools(prev => ({ ...prev, [toolName]: !prev[toolName] }));
    }, []);

    const countFieldTokens = useCallback(async (field: keyof TokenCounts, text: string) => {
        if (!text.trim()) { setTokenCounts(prev => ({ ...prev, [field]: 0 })); return; }
        const timeouts = tokenCountTimeoutsRef.current;
        if (timeouts[field]) clearTimeout(timeouts[field]);
        timeouts[field] = setTimeout(async () => {
            setCountingField(field);
            const count = await tokenEngine.countTokens(text);
            setTokenCounts(prev => ({ ...prev, [field]: count }));
            setCountingField(prev => prev === field ? null : prev);
        }, 500);
    }, []);

    useEffect(() => {
        const timeouts = tokenCountTimeoutsRef.current;
        return () => {
            Object.values(timeouts).forEach(clearTimeout);
        };
    }, []);

    useEffect(() => {
        if (selectedModel) {
            tokenEngine.setRunningModels(runningModels ?? {});
            tokenEngine.setContext(selectedModel);
        }

        const rafId = requestAnimationFrame(() => {
            const fields: Array<{ key: keyof TokenCounts; text: string }> = [
                { key: 'systemPrompt', text: existingCharacter?.systemPrompt || '' },
                { key: 'thinkPrompt', text: existingCharacter?.thinkPrompt || '' },
                { key: 'appearancePrompt', text: existingCharacter?.appearancePrompt || '' },
            ];

            for (const { key, text } of fields) {
                if (text.trim()) {
                    tokenEngine.countTokens(text).then(count => {
                        setTokenCounts(prev => ({ ...prev, [key]: count }));
                    });
                } else {
                    setTokenCounts(prev => ({ ...prev, [key]: 0 }));
                }
            }
        });

        return () => cancelAnimationFrame(rafId);
    }, [selectedModel, runningModels, existingCharacter]);

    const handleSystemPromptBlur = () => {
        const currentIW = Number.parseFloat(initiativeWeightStr);
        const currentCP = Number.parseFloat(chatProbabilityStr);
        const currentMS = Number.parseFloat(maximumChatStaminaStr);
        const currentNS = Number.parseFloat(nameSensitivityStr);
        const currentCIS = Number.parseFloat(chatImpatienceSensitivityStr);
        const currentSP = Number.parseFloat(skipProbabilityStr);
        const currentMRW = Number.parseFloat(memoryRetentionWeightStr);
        const currentCRS = Number.parseFloat(contextSensitivityStr);
        const currentMAS = Number.parseFloat(maximumActionStaminaStr);

        const iwIsAuto = currentIW === -1;
        const cpIsAuto = currentCP === -1;
        const msIsAuto = currentMS === -1;
        const nsIsAuto = currentNS === -1;
        const cisIsAuto = currentCIS === -1;
        const spIsAuto = currentSP === -1;
        const mrwIsAuto = currentMRW === -1;
        const crsIsAuto = currentCRS === -1;
        const masIsAuto = currentMAS === -1;

        if (!iwIsAuto && !cpIsAuto && !msIsAuto && !nsIsAuto && !cisIsAuto && !spIsAuto && !mrwIsAuto && !crsIsAuto && !masIsAuto) return;

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
        if (masIsAuto) { const v = getMaximumActionStaminaValueFromText(combinedText); setMaximumActionStaminaStr(String(Math.round(v))); }

        setAutoDetected(newDetected);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.[0]) { setImageFile(e.target.files[0]); setImagePreview(URL.createObjectURL(e.target.files[0])); } };
    const handleRemoveImage = (e: React.MouseEvent) => {
        e.stopPropagation();
        setImageFile(null); setImagePreview(null);
        setEmotionImages(prev => { const { ...next } = prev; return next; });
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
        setName(fields.name);
        setDescription(fields.description);
        setSystemPrompt(fields.systemPrompt);
        setThinkPrompt('');
        setAppearancePrompt(fields.appearancePrompt);
        setFirstMessage(fields.firstMessage);
        setImageFile(file); setImagePreview(URL.createObjectURL(file));
        setAutoDetected({ iw: null, cp: null, ms: null });
        setInitiativeWeightStr('-1'); setChatProbabilityStr('-1'); setMaximumChatStaminaStr('-1');
        setNameSensitivityStr('-1');
        setChatImpatienceSensitivityStr('-1'); setSkipProbabilityStr('-1'); setMemoryRetentionWeightStr('-1'); setContextSensitivityStr('-1');
        setMaximumActionStaminaStr('-1');
        setSelectedStopPatternIds([]); setUseFrontCameraImage(false); setDoNotInjectCharacterImage(false);
        setNumberOfMessagesToDisableThinkPromptStr('0');
        setNumberOfMessagesToDisableMetaThinkInstructionsStr('0');
        setNumberOfMessagesToDisableDialoguePromptStr('0');
        setNumberOfMessagesToDisableStarterPromptStr('0');
        setTools({ ...defaultCharacterTools });
        setMemories({});
        setClothings([]);
        setTextCharacterInjections([]);
        setDialoguePrompts([]);
        setKnowledgePrompts([]);
        if (fields.starterPrompt?.trim()) {
            setStarterPrompts({ [fields.starterPrompt.trim()]: 1 });
        } else {
            setStarterPrompts({});
        }
        countFieldTokens('systemPrompt', fields.systemPrompt);
        countFieldTokens('thinkPrompt', '');
        countFieldTokens('appearancePrompt', fields.appearancePrompt);
        setSubmitError(null);
        const extended = card as ParsedCharacterCardExtended;
        if (extended.emotionImages && Object.keys(extended.emotionImages).length > 0) {
            setEmotionImages(prev => ({ ...prev, ...extended.emotionImages }));
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
            try { finalImages.neutral = await uploadCharacterImage(targetCharacterId, imageFile); }
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
        const rawMAS = Number.parseFloat(maximumActionStaminaStr);
        const rawDisableThink = Number.parseInt(numberOfMessagesToDisableThinkPromptStr);
        const rawDisableMeta = Number.parseInt(numberOfMessagesToDisableMetaThinkInstructionsStr);
        const rawDisableDialogue = Number.parseInt(numberOfMessagesToDisableDialoguePromptStr);
        const rawDisableStarter = Number.parseInt(numberOfMessagesToDisableStarterPromptStr);

        const iwValid = !Number.isNaN(rawIW) && rawIW >= 0;
        const cpValid = !Number.isNaN(rawCP) && rawCP >= 0;
        const msValid = !Number.isNaN(rawMS) && rawMS >= 0;
        const nsValid = !Number.isNaN(rawNS) && rawNS >= 0;
        const cisValid = !Number.isNaN(rawCIS) && rawCIS >= 0;
        const spValid = !Number.isNaN(rawSP) && rawSP >= 0;
        const mrwValid = !Number.isNaN(rawMRW) && rawMRW >= 0;
        const crsValid = !Number.isNaN(rawCRS) && rawCRS >= 0;
        const masValid = !Number.isNaN(rawMAS) && rawMAS >= 0;

        let finalIW: number;
        let finalCP: number;
        let finalMS: number;
        let finalNS: number;
        let finalCIS: number;
        let finalSP: number;
        let finalMRW: number;
        let finalCRS: number;
        let finalMAS: number;

        if (existingCharacter && !isNewClone) {
            finalIW = iwValid ? rawIW : (existingCharacter.initiativeWeight ?? -1);
            finalCP = cpValid ? rawCP : (existingCharacter.chatProbability ?? -1);
            finalMS = msValid ? Math.round(rawMS) : (existingCharacter.maximumChatStamina ?? -1);
            finalNS = nsValid ? rawNS : (existingCharacter.nameSensitivity ?? DEFAULT_NAME_SENSITIVITY);
            finalCIS = cisValid ? rawCIS : (existingCharacter.chatImpatienceSensitivity ?? DEFAULT_CHAT_IMPATIENCE_SENSITIVITY);
            finalSP = spValid ? rawSP : (existingCharacter.skipProbability ?? DEFAULT_SKIP_PROBABILITY);
            finalMRW = mrwValid ? rawMRW : (existingCharacter.memoryRetentionWeight ?? DEFAULT_MEMORY_RETENTION_WEIGHT);
            finalCRS = crsValid ? rawCRS : (existingCharacter.contextSensitivity ?? DEFAULT_CONTEXT_SENSITIVITY);
            finalMAS = masValid ? Math.round(rawMAS) : (existingCharacter.maximumActionStamina ?? DEFAULT_MAXIMUM_ACTION_STAMINA);
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
            finalMAS = masValid ? Math.round(rawMAS) : DEFAULT_MAXIMUM_ACTION_STAMINA;
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
            dialoguePrompts: dialoguePrompts.length > 0 ? dialoguePrompts : undefined,
            knowledgePrompts: knowledgePrompts.length > 0 ? knowledgePrompts : undefined,
            starterPrompts: Object.keys(starterPrompts).length > 0 ? starterPrompts : undefined,
            images: finalImages,
            useFrontCameraImage: useFrontCameraImage || undefined,
            voice: finalVoiceFilename, sampler: finalSampler,
            initiativeWeight: finalIW, chatProbability: finalCP, maximumChatStamina: finalMS,
            nameSensitivity: finalNS, chatImpatienceSensitivity: finalCIS, skipProbability: finalSP,
            memoryRetentionWeight: finalMRW, contextSensitivity: finalCRS,
            maximumActionStamina: finalMAS,
            doNotInjectCharacterImage: doNotInjectCharacterImage || undefined,
            numberOfMessagesToDisableThinkPrompt: Number.isNaN(rawDisableThink) ? 0 : Math.max(0, rawDisableThink),
            numberOfMessagesToDisableMetaThinkInstructions: Number.isNaN(rawDisableMeta) ? 0 : Math.max(0, rawDisableMeta),
            numberOfMessagesToDisableDialoguePrompt: Number.isNaN(rawDisableDialogue) ? 0 : Math.max(0, rawDisableDialogue),
            numberOfMessagesToDisableStarterPrompt: Number.isNaN(rawDisableStarter) ? 0 : Math.max(0, rawDisableStarter),
            tools: { ...tools },
            clothings,
            textCharacterInjections,
            memories,
            firstCreatedTimestamp: isNewClone ? now : (existingCharacter?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = async () => { const c = await buildCharacterFromForm(false); if (!c) return; onSave(c); onClose(); };
    const handleClone = async () => { const c = await buildCharacterFromForm(true); if (!c) return; onSave(c); onClose(); };

    const renderTokenCount = (field: keyof TokenCounts) => {
        const count = tokenCounts[field];
        const displayCount = count ?? 0;
        return <div className={`editor-token-count ${countingField === field ? 'counting' : ''}`}>{`~${displayCount.toLocaleString()} token(s)`}</div>;
    };
    const hasVoice = !!voiceFile || !!existingVoiceName;
    const effectiveCharacterId = existingCharacter?.id || pendingCharacterId || '';
    const memoryCount = Object.values(memories).reduce((sum, arr) => sum + arr.length, 0);

    // Starter prompts helper
    const [newStarterPromptText, setNewStarterPromptText] = useState('');
    const [newStarterPromptWeight, setNewStarterPromptWeight] = useState<string>('1');

    const handleAddStarterPrompt = useCallback(() => {
        const text = newStarterPromptText.trim();
        if (!text) return;
        const weight = Number.parseFloat(newStarterPromptWeight);
        const finalWeight = Number.isNaN(weight) || weight <= 0 ? 1 : weight;
        setStarterPrompts(prev => ({ ...prev, [text]: finalWeight }));
        setNewStarterPromptText('');
        setNewStarterPromptWeight('1');
    }, [newStarterPromptText, newStarterPromptWeight]);

    const handleRemoveStarterPrompt = useCallback((text: string) => {
        setStarterPrompts(prev => {
            const next = { ...prev };
            delete next[text];
            return next;
        });
    }, []);

    const handleStarterPromptWeightChange = useCallback((text: string, value: string) => {
        const weight = Number.parseFloat(value);
        const finalWeight = Number.isNaN(weight) || weight <= 0 ? 1 : weight;
        setStarterPrompts(prev => ({ ...prev, [text]: finalWeight }));
    }, []);

    const getStopPatternById = (id: string) => {
        for (const s of allSamplers) {
            const found = s.stopPatterns.find(sp => sp.id === id);
            if (found) return found;
        }
        return null;
    };

    const editorTabs: { id: EditorTabId; label: string; icon: string }[] = [
        { id: 'general', label: 'General', icon: '📝' },
        { id: 'behaviour', label: 'Behaviour', icon: '🧠' },
        { id: 'stats', label: 'Stats', icon: '📊' },
        { id: 'tools', label: 'Tools', icon: '🔧' },
        { id: 'model', label: 'Model', icon: '⚙️' },
    ];

    return (
        <>
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>{existingCharacter ? 'Edit Character' : 'Create New Character'}</h2>
                        <div className="editor-modal-actions">
                            <button type="button" className="editor-button editor-button-cancel" onClick={onClose} disabled={isUploading}>Cancel</button>
                            {existingCharacter && <button type="button" className="editor-button editor-button-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                            {!existingCharacter && (<>
                                <button type="button" className="editor-button editor-button-import" onClick={() => cardImportRef.current?.click()} disabled={isUploading}>Import</button>
                                <input ref={cardImportRef} type="file" accept="image/png" hidden onChange={handleCardImport} disabled={isUploading} />
                            </>)}
                            <button type="button" className="editor-button editor-button-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Uploading...' : 'Save'}</button>
                        </div>
                    </div>

                    {/* Tab Bar */}
                    <div className="entity-tab-bar" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '1px solid var(--border)', background: 'var(--social-bg)' }}>
                        {editorTabs.map(tab => (
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

                    <div className="modal-body editor-modal-body">
                        {submitError && <div className="editor-error-message editor-error-centered">{submitError}</div>}

                        {/* ─── GENERAL TAB ─── */}
                        {activeTab === 'general' && (
                            <div className="editor-modal-columns">
                                <div className="editor-left-column">
                                    <div className="editor-image-upload-container">
                                        <div className={`editor-image-square editor-image-portrait ${imagePreview ? 'active solid' : 'dashed'}`}
                                            style={{ cursor: isUploading ? 'wait' : 'pointer', opacity: isUploading ? 0.7 : 1 }}
                                            onClick={() => !isUploading && fileInputRef.current?.click()}>
                                            {imagePreview ? (<><img src={imagePreview} alt="Character" />{!isUploading && <div className="editor-image-hover-overlay"><button type="button" onClick={handleRemoveImage} className="editor-image-remove-button-large" title="Remove Picture">🗑️</button></div>}</>) : (<div className="editor-image-placeholder">{isUploading ? '⏳' : '📷'}</div>)}
                                        </div>
                                        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} disabled={isUploading} />
                                    </div>

                                    <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowImageEditor(true)} disabled={isUploading} style={{ width: '100%', marginTop: '6px', fontSize: '0.75rem' }}>
                                        More Images ({Object.keys(emotionImages).length})
                                    </button>

                                    <div className="editor-section" style={{ marginTop: '8px' }}>
                                        <label className="editor-checkbox-label">
                                            <input type="checkbox" checked={useFrontCameraImage} onChange={(e) => setUseFrontCameraImage(e.target.checked)} className="editor-checkbox-input" disabled={isUploading} />
                                            <span>Use Front Camera Image</span>
                                        </label>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px', marginLeft: '26px' }}>
                                            Replace stored image with live front camera snapshot when profile allows per-character control.
                                        </div>
                                        <label className="editor-checkbox-label" style={{ marginTop: '8px' }}>
                                            <input type="checkbox" checked={doNotInjectCharacterImage} onChange={(e) => setDoNotInjectCharacterImage(e.target.checked)} className="editor-checkbox-input" disabled={isUploading} />
                                            <span>Do Not Inject Character Image</span>
                                        </label>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px', marginLeft: '26px' }}>
                                            Prevent this character's image from being sent to the model.
                                        </div>
                                    </div>

                                    <div className="editor-section editor-voice-section">
                                        <span className="editor-section-title">Voice</span>
                                        <div className="editor-voice-hint">Used for reading character's text. Maximum 5MB.</div>
                                        {hasVoice ? (
                                            <div className="editor-voice-chip"><span className="editor-voice-chip-name">🎙️ {voiceFile ? voiceFile.name : existingVoiceName}</span><button type="button" onClick={handleRemoveVoice} disabled={isUploading} className="editor-voice-remove-button" title="Remove voice">×</button></div>
                                        ) : (
                                            <button type="button" onClick={() => !isUploading && voiceInputRef.current?.click()} disabled={isUploading} className={`toolbar-button editor-voice-upload-button ${isUploading ? 'uploading' : ''}`}>{isUploading ? 'Uploading...' : '🎙️ Upload Voice Sample'}</button>
                                        )}
                                        <input ref={voiceInputRef} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg" hidden onChange={handleVoiceChange} disabled={isUploading} />
                                    </div>
                                </div>

                                <div className="editor-right-column">
                                    <textarea value={name} onChange={(e) => setName(e.target.value)} className="editor-textarea editor-textarea-name" placeholder="Name *" disabled={isUploading} />
                                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="editor-textarea editor-textarea-description" placeholder="Description" disabled={isUploading} />
                                    <textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} className="editor-textarea editor-textarea-first-message" placeholder="First message" disabled={isUploading} />

                                    <div className="editor-field-wrapper-full">
                                        <textarea value={systemPrompt} onChange={(e) => { setSystemPrompt(e.target.value); countFieldTokens('systemPrompt', e.target.value); }} onBlur={handleSystemPromptBlur} className="editor-textarea editor-textarea-system" placeholder="System prompt" disabled={isUploading} />
                                        {renderTokenCount('systemPrompt')}
                                    </div>
                                    <div className="editor-field-wrapper"><textarea value={thinkPrompt} onChange={(e) => { setThinkPrompt(e.target.value); countFieldTokens('thinkPrompt', e.target.value); }} className="editor-textarea editor-textarea-think" placeholder="Think Prompt" disabled={isUploading} />{renderTokenCount('thinkPrompt')}</div>
                                    <div className="editor-field-wrapper"><textarea value={appearancePrompt} onChange={(e) => { setAppearancePrompt(e.target.value); countFieldTokens('appearancePrompt', e.target.value); }} className="editor-textarea editor-textarea-appearance" placeholder="Appearance Prompt" disabled={isUploading} />{renderTokenCount('appearancePrompt')}</div>
                                </div>
                            </div>
                        )}

                        {/* ─── BEHAVIOUR TAB ─── */}
                        {activeTab === 'behaviour' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {/* Starter Prompts */}
                                <div className="editor-section" style={{ margin: 0 }}>
                                    <div className="editor-section-title">Starter Prompts ({Object.keys(starterPrompts).length})</div>
                                    <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Weighted starter messages. Higher weight = more likely to be selected.</div>
                                    <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                                        <input type="text" value={newStarterPromptText} onChange={e => setNewStarterPromptText(e.target.value)} className="editor-input" placeholder="Starter prompt text..." style={{ flex: 1, fontSize: '0.7rem', padding: '4px 6px' }} disabled={isUploading} />
                                        <input type="number" value={newStarterPromptWeight} onChange={e => setNewStarterPromptWeight(e.target.value)} className="editor-input" placeholder="Wt" min="0.1" step="0.5" style={{ width: '50px', fontSize: '0.7rem', padding: '4px 6px' }} disabled={isUploading} />
                                        <button type="button" onClick={handleAddStarterPrompt} className="toolbar-button" title="Add" style={{ fontSize: '0.7rem', padding: '2px 8px' }} disabled={isUploading}>+</button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '120px', overflowY: 'auto' }}>
                                        {Object.entries(starterPrompts).map(([text, weight]) => (
                                            <div key={text} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                <span style={{ flex: 1, fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{text}</span>
                                                <input type="number" value={weight} onChange={e => handleStarterPromptWeightChange(text, e.target.value)} className="editor-input" min="0.1" step="0.5" style={{ width: '45px', fontSize: '0.6rem', padding: '2px 4px' }} disabled={isUploading} />
                                                <button type="button" onClick={() => handleRemoveStarterPrompt(text)} className="toolbar-button" title="Remove" style={{ width: '18px', height: '18px', fontSize: '0.6rem', color: '#ff4444', padding: 0 }} disabled={isUploading}>×</button>
                                            </div>
                                        ))}
                                        {Object.keys(starterPrompts).length === 0 && (
                                            <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic', padding: '4px 0' }}>No starter prompts. Add above.</div>
                                        )}
                                    </div>
                                </div>

                                {/* Behaviour buttons */}
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowDialoguePromptEditor(true)} disabled={isUploading} style={{ flex: 1 }}>Dialogue ({dialoguePrompts.length})</button>
                                    <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowKnowledgePromptEditor(true)} disabled={isUploading} style={{ flex: 1 }}>Knowledge ({knowledgePrompts.length})</button>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowClothingEditor(true)} disabled={isUploading} style={{ flex: 1 }}>Clothing ({clothings.length})</button>
                                    <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowTextInjectionEditor(true)} disabled={isUploading} style={{ flex: 1 }}>Text Injection ({textCharacterInjections.length})</button>
                                </div>

                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowMemoryManager(true)} disabled={isUploading} style={{ flex: 1 }}>Memory ({memoryCount})</button>
                                </div>

                                {/* Prompt Decay */}
                                <div className="editor-section" style={{ margin: 0 }}>
                                    <span className="editor-section-title">Prompt Decay</span>
                                    <div style={{ fontSize: '0.6rem', opacity: 0.5, marginBottom: '12px' }}>
                                        Prompts are automatically removed from context after the character has sent this many messages. Set to 0 to disable immediately, or leave high to keep them active longer.
                                    </div>
                                    <div className="editor-stats-grid">
                                        <div>
                                            <label className="editor-label editor-label-small">Think Prompt</label>
                                            <input type="number" step="1" min="0" value={numberOfMessagesToDisableThinkPromptStr} onChange={(e) => setNumberOfMessagesToDisableThinkPromptStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Meta-Think Instructions</label>
                                            <input type="number" step="1" min="0" value={numberOfMessagesToDisableMetaThinkInstructionsStr} onChange={(e) => setNumberOfMessagesToDisableMetaThinkInstructionsStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Dialogue Prompt</label>
                                            <input type="number" step="1" min="0" value={numberOfMessagesToDisableDialoguePromptStr} onChange={(e) => setNumberOfMessagesToDisableDialoguePromptStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Starter Prompt</label>
                                            <input type="number" step="1" min="0" value={numberOfMessagesToDisableStarterPromptStr} onChange={(e) => setNumberOfMessagesToDisableStarterPromptStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ─── STATS TAB ─── */}
                        {activeTab === 'stats' && (
                            <>
                                <div className="editor-section">
                                    <span className="editor-section-title">Turn Order & Output</span>
                                    <div className="editor-stats-grid">
                                        <div>
                                            <label className="editor-label editor-label-small">Initiative Weight</label>
                                            <input type="number" step="0.1" value={initiativeWeightStr} onChange={(e) => setInitiativeWeightStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls the character's initiative when determining turn order. Range: 0 - ∞.</div>
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Chat Probability</label>
                                            <input type="number" step="0.05" value={chatProbabilityStr} onChange={(e) => setChatProbabilityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls the probability of the character initiating a chat message when selected. Range: 0 - 1.</div>
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Maximum Chat Stamina</label>
                                            <input type="number" step="1" min="0" value={maximumChatStaminaStr} onChange={(e) => setMaximumChatStaminaStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls the number of maximum paragraphs that the character could produce. Range: 0 - ∞.</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="editor-section">
                                    <span className="editor-section-title">Responsiveness</span>
                                    <div className="editor-stats-grid">
                                        <div>
                                            <label className="editor-label editor-label-small">Name Sensitivity</label>
                                            <input type="number" step="0.5" min="0" value={nameSensitivityStr} onChange={(e) => setNameSensitivityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how likely the character is to be the first one to respond to the latest message. Multiplied by mention count. 0 = off.</div>
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Chat Impatience</label>
                                            <input type="number" step="0.1" min="0" value={chatImpatienceSensitivityStr} onChange={(e) => setChatImpatienceSensitivityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how impatient the character is after waiting to speak for too long. Higher = speaks sooner after being quiet. 0 = off.</div>
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Skip Probability</label>
                                            <input type="number" step="0.05" min="0" max="1" value={skipProbabilityStr} onChange={(e) => setSkipProbabilityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Probability of skipping an action. Range: 0 - 1.</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="editor-section">
                                    <span className="editor-section-title">Awareness & Actions</span>
                                    <div className="editor-stats-grid">
                                        <div>
                                            <label className="editor-label editor-label-small">Memory Retention</label>
                                            <input type="number" step="0.1" min="0" value={memoryRetentionWeightStr} onChange={(e) => setMemoryRetentionWeightStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how much of the character's memory is retained. Range: 0 - 1.</div>
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Context Sensitivity</label>
                                            <input type="number" step="0.1" min="0" value={contextSensitivityStr} onChange={(e) => setContextSensitivityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how sensitive the character is to contextual cues. Range: 0 - 1.</div>
                                        </div>
                                        <div>
                                            <label className="editor-label editor-label-small">Maximum Action Stamina</label>
                                            <input type="number" step="1" min="0" value={maximumActionStaminaStr} onChange={(e) => setMaximumActionStaminaStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading} />
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how many silent actions, movement, or non-chat interactions the character can perform before needing to rest. Range: 0 - ∞.</div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* ─── TOOLS TAB ─── */}
                        {activeTab === 'tools' && (
                            <div className="editor-section">
                                <span className="editor-section-title">Character Tools</span>
                                <div style={{ fontSize: '0.65rem', opacity: 0.6, marginBottom: '12px' }}>
                                    Enable runtime tool use during generation for this character. Can be overridden by profile settings.
                                </div>

                                {(Object.keys(tools) as tool[]).map(toolName => (
                                    <div key={toolName} style={{ marginBottom: '8px' }}>
                                        <label className="editor-checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={tools[toolName]}
                                                onChange={() => handleToolToggle(toolName)}
                                                className="editor-checkbox-input"
                                                disabled={isUploading}
                                            />
                                            <span>{toolLabels[toolName] ?? toolName}</span>
                                        </label>
                                        <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                                            {TOOL_DESCRIPTIONS[toolName] ?? 'Allow this character to use this tool during conversation.'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* ─── MODEL TAB ─── */}
                        {activeTab === 'model' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div className="editor-section">
                                    <span className="editor-section-title">Sampler</span>
                                    <select value={selectedSamplerId} onChange={(e) => setSelectedSamplerId(e.target.value)} className={`editor-select ${isLoadingSamplers || isUploading ? 'editor-select-loading' : ''}`} disabled={isLoadingSamplers || isUploading}>
                                        {isLoadingSamplers && <option>Loading samplers...</option>}
                                        {!isLoadingSamplers && allSamplers.length === 0 && <option>No samplers available</option>}
                                        {!isLoadingSamplers && allSamplers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                    </select>
                                </div>

                                <div className="editor-section">
                                    <span className="editor-section-title">Character Stop Patterns</span>
                                    <div className="editor-stop-patterns-hint">
                                        Specific stop sequences for this character, overrides or augments sampler defaults.
                                    </div>

                                    <div className="sampler-stop-patterns-list">
                                        {selectedStopPatternIds.length === 0 && (
                                            <div className="sampler-stop-empty">No character-specific stop patterns assigned.</div>
                                        )}

                                        {selectedStopPatternIds.map(id => {
                                            const sp = getStopPatternById(id);
                                            if (!sp) return null;

                                            return (
                                                <div key={id} className="sampler-stop-item">
                                                    <div className="sampler-stop-info">
                                                        <span className="sampler-stop-name">{sp.name}</span>
                                                        <span className="sampler-stop-pattern">{sp.pattern}</span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStopPatternToggle(id)}
                                                        className="sampler-stop-remove-button"
                                                        title="Remove stop pattern"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <select
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val) handleStopPatternToggle(val);
                                            e.target.value = '';
                                        }}
                                        className="editor-select"
                                        defaultValue=""
                                        disabled={isUploading}
                                    >
                                        <option value="" disabled>+ Add a stop pattern</option>
                                        {allSamplers
                                            .flatMap(s => s.stopPatterns)
                                            .filter((sp, index, self) => index === self.findIndex(t => t.id === sp.id))
                                            .filter(sp => !selectedStopPatternIds.includes(sp.id))
                                            .map(sp => (
                                                <option key={sp.id} value={sp.id}>
                                                    {sp.name} — {sp.pattern}
                                                </option>
                                            ))}
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <CharacterImageEditorModal
                isOpen={showImageEditor}
                onClose={() => setShowImageEditor(false)}
                characterId={effectiveCharacterId}
                images={emotionImages}
                onSave={(updatedImages) => {
                    setEmotionImages(updatedImages);
                    const neutral = updatedImages.neutral;
                    if (neutral) { setImagePreview(getCharacterImageUrl(effectiveCharacterId, neutral)); setImageFile(null); }
                    else if (!imageFile) { setImagePreview(null); }
                }}
            />

            <CharacterClothingEditorModal
                isOpen={showClothingEditor}
                onClose={() => setShowClothingEditor(false)}
                clothings={clothings}
                onSaveClothings={setClothings}
            />

            <CharacterDialoguePromptEditorModal
                isOpen={showDialoguePromptEditor}
                onClose={() => setShowDialoguePromptEditor(false)}
                dialoguePrompts={dialoguePrompts}
                onSaveDialoguePrompts={setDialoguePrompts}
            />

            <CharacterKnowledgePromptEditorModal
                isOpen={showKnowledgePromptEditor}
                onClose={() => setShowKnowledgePromptEditor(false)}
                knowledgePrompts={knowledgePrompts}
                onSaveKnowledgePrompts={setKnowledgePrompts}
            />

            <CharacterTextCharacterInjectionEditorModal
                isOpen={showTextInjectionEditor}
                onClose={() => setShowTextInjectionEditor(false)}
                injections={textCharacterInjections}
                onSaveInjections={setTextCharacterInjections}
            />

            <CharacterMemoryEditorModal
                isOpen={showMemoryManager}
                onClose={() => setShowMemoryManager(false)}
                character={existingCharacter || null}
                onSaveMemories={setMemories}
                chatNameMap={chatNameMap}
            />
        </>
    );
}