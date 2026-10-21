// src/frontend_src/components/CharacterEditorModal.tsx
import type React from 'react';
import { useState, useMemo, useEffect, useRef } from 'react';
import type { 
    Character, Sampler, LanguageModel, Memory, Clothing, 
    TextCharacterInjection, DialoguePrompt, KnowledgePrompt, StarterPrompt,
    tool, InteractionData, StopPattern, Voice, RetrievalConfiguration,
    RawInteractionData, memorySearchSpace
} from '../types';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { 
    uploadCharacterImage, 
    getCharacterImageUrl, 
    getCharacterVoiceURL,
    uploadCharacterVoice,
    cloneCharacterImage,
    cloneCharacterVoice,
} from '../storages/serverStorage';
import { 
    getInitiativeWeightValueFromText, 
    getChatProbabilityValue, 
    getMaximumChatStaminaValueFromText, 
    getChatStaminaRegenerationRateValueFromText,
    getNameSensitivityValueFromText, 
    getChatImpatienceSensitivityValueFromText, 
    getSkipProbabilityValueFromText, 
    getMemoryRetentionWeightValueFromText, 
    getContextSensitivityValueFromText, 
    getMaximumActionStaminaValueFromText,
    getActionStaminaRegenerationRateValueFromText
} from '../utilities/traitDetection';
import { detectToolsFromText, type DetectedToolsResult } from '../utilities/toolDetection';
import { ToolPermissionModal } from './ToolPermissionModal';
import { parseCharacterCard, mapCardToEditorFields, type ParsedCharacterCardExtended } from '../utilities/characterCardParser';
import { v4 as uuidv4 } from 'uuid';
import { CharacterMemoryEditorModal } from './CharacterMemoryEditorModal';
import { CharacterImageEditorModal } from './CharacterImageEditorModal';
import { CharacterClothingEditorModal } from './CharacterClothingEditorModal';
import { CharacterTextCharacterInjectionEditorModal } from './CharacterTextCharacterInjectionEditorModal';
import { CharacterDialoguePromptEditorModal } from './CharacterDialoguePromptEditorModal';
import { CharacterKnowledgePromptEditorModal } from './CharacterKnowledgePromptEditorModal';
import { CharacterStarterPromptEditorModal } from './CharacterStarterPromptEditorModal';
import { FileDropArea } from './FileDropArea';
import { getCoLocatedParticipants, getCoLocatedProtagonists } from '../utilities/locationLogic';
import '../main.css';
import { defaultCharacterTools } from '../dictionaries/defaults';
import { characterToolDescriptions, toolLabels } from '../dictionaries/texts';
import { emotions } from '../dictionaries/characterPresets';

// ─── Defaults ───────────────────────────────────────────────────────
const DEFAULT_INITIATIVE_WEIGHT = 1.2;
const DEFAULT_CHAT_PROBABILITY = 0.5;
const DEFAULT_MAXIMUM_CHAT_STAMINA = 4;
const DEFAULT_CHAT_STAMINA_REGENERATION_RATE = 0.3;
const DEFAULT_NAME_SENSITIVITY = 1;
const DEFAULT_CHAT_IMPATIENCE_SENSITIVITY = 0;
const DEFAULT_SKIP_PROBABILITY = 0;
const DEFAULT_MEMORY_RETENTION_WEIGHT = 1;
const DEFAULT_CONTEXT_SENSITIVITY = 1;
const DEFAULT_MAXIMUM_ACTION_STAMINA = 5;
const DEFAULT_ACTION_STAMINA_REGENERATION_RATE = 0.03;
const MAX_VOICE_FILE_SIZE = 5 * 1024 * 1024;

const tokenEngine = getLanguageModelEngine();

interface TokenCounts {
    systemPrompt: number | null;
    thinkPrompt: number | null;
    appearancePrompt: number | null;
}

type EditorTabId = 'general' | 'behaviour' | 'stats' | 'tools' | 'model' | 'quick-config';

interface CharacterEditorModalProps {
    isReadOnly?: boolean;
    onClose: () => void;
    onSave: (character: Character) => void;
    onVoiceTranscribeRequested?: (characterId: string, file: File, language?: string) => void;
    existingCharacter?: Character | null;
    allCharacters: Character[];
    allSamplers: Sampler[];
    allRetrievalConfigurations: RetrievalConfiguration[]; // ✅ ADDED
    isLoadingSamplers?: boolean;
    selectedModel?: LanguageModel | null;
    runningModels?: Record<string, any>;
    interactionData?: InteractionData | null;
    allRawInteractionDataShells: RawInteractionData[]
    localProtagonistId?: string | null;
}

export function CharacterEditorModal({
    onClose, onSave, onVoiceTranscribeRequested, existingCharacter,
    allCharacters, allSamplers, allRetrievalConfigurations, isLoadingSamplers = false,
    selectedModel, runningModels,
    interactionData, allRawInteractionDataShells, localProtagonistId,
    isReadOnly = false,
}: CharacterEditorModalProps) {
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
    
    // ✅ Dual Sampler States
    const [selectedLanguageModelSamplerId, setSelectedLanguageModelSamplerId] = useState<string>(existingCharacter?.languageModelSampler?.id || (allSamplers[0]?.id || ''));
    const [selectedTextToSpeechModelSamplerId, setSelectedTextToSpeechModelSamplerId] = useState<string>(existingCharacter?.textToSpeechModelSampler?.id || (allSamplers[0]?.id || ''));
    
    // ✅ Retrieval Configuration States
    const [selectedDialogueRetrievalConfigurationId, setSelectedDialogueRetrievalConfigurationId] = useState<string>(existingCharacter?.dialogueRetrievalConfiguration?.id || '');
    const [selectedStarterPromptRetrievalConfigurationId, setSelectedStarterPromptRetrievalConfigurationId] = useState<string>(existingCharacter?.starterPromptRetrievalConfiguration?.id || '');
    const [selectedKnowledgeRetrievalConfigurationId, setSelectedKnowledgeRetrievalConfigurationId] = useState<string>(existingCharacter?.knowledgeRetrievalConfiguration?.id || '');
    const [selectedMemoryRetrievalConfigurationId, setSelectedMemoryRetrievalConfigurationId] = useState<string>(existingCharacter?.memoryRetrievalConfiguration?.id || '');
    
    // ✅ Stop patterns on Character
    const [selectedStopPatternIds, setSelectedStopPatternIds] = useState<string[]>(existingCharacter?.stopPatterns?.map(sp => sp.id) || []);
    
    const [isUploading, setIsUploading] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const [initiativeWeightStr, setInitiativeWeightStr] = useState<string>(String(existingCharacter?.initiativeWeight ?? -1));
    const [chatProbabilityStr, setChatProbabilityStr] = useState<string>(String(existingCharacter?.chatProbability ?? -1));
    const [maximumChatStaminaStr, setMaximumChatStaminaStr] = useState<string>(String(existingCharacter?.maximumChatStamina ?? -1));
    const [chatStaminaRegenerationRateStr, setChatStaminaRegenerationRateStr] = useState<string>(String(existingCharacter?.chatStaminaRegenerationRate ?? -1));
    const [nameSensitivityStr, setNameSensitivityStr] = useState<string>(String(existingCharacter?.nameSensitivity ?? -1));
    const [chatImpatienceSensitivityStr, setChatImpatienceSensitivityStr] = useState<string>(String(existingCharacter?.chatImpatienceSensitivity ?? -1));
    const [skipProbabilityStr, setSkipProbabilityStr] = useState<string>(String(existingCharacter?.skipProbability ?? -1));
    const [memoryRetentionWeightStr, setMemoryRetentionWeightStr] = useState<string>(String(existingCharacter?.memoryRetentionWeight ?? -1));
    const [contextSensitivityStr, setContextSensitivityStr] = useState<string>(String(existingCharacter?.contextSensitivity ?? -1));
    const [maximumActionStaminaStr, setMaximumActionStaminaStr] = useState<string>(String(existingCharacter?.maximumActionStamina ?? -1));
    const [actionStaminaRegenerationRateStr, setActionStaminaRegenerationRateStr] = useState<string>(String(existingCharacter?.actionStaminaRegenerationRate ?? -1));

    const [voiceFile, setVoiceFile] = useState<File | null>(null);
    const [hasExistingVoice, setHasExistingVoice] = useState<boolean>(Boolean(existingCharacter?.voice?.voiceFilename));
    const [isVoiceRemoved, setIsVoiceRemoved] = useState<boolean>(false);
    const [voiceLanguage, setVoiceLanguage] = useState<string>(existingCharacter?.voice?.language || '');

    useEffect(() => {
        if (!existingCharacter || !existingCharacter.voice?.voiceFilename) {
            setHasExistingVoice(false);
            return;
        }

        const url = getCharacterVoiceURL(existingCharacter.id, existingCharacter.voice.voiceFilename);
        if (!url) {
            setHasExistingVoice(false);
            return;
        }

        let isSubscribed = true;

        fetch(url, { method: 'HEAD' })
            .then(res => {
                if (isSubscribed) setHasExistingVoice(res.ok);
            })
            .catch(() => {
                if (isSubscribed) setHasExistingVoice(false);
            });

        return () => {
            isSubscribed = false;
        };
    }, [existingCharacter]);

    const [useFrontCameraImage, setUseFrontCameraImage] = useState<boolean>(existingCharacter?.useFrontCameraImage ?? false);
    const [doNotInjectCharacterImage, setDoNotInjectCharacterImage] = useState<boolean>(existingCharacter?.doNotInjectCharacterImage ?? false);

    const [numberOfMessagesToDisableThinkPromptStr, setNumberOfMessagesToDisableThinkPromptStr] = useState<string>(String(existingCharacter?.numberOfMessagesToDisableThinkPrompt ?? 0));
    const [numberOfMessagesToDisableMetaThinkInstructionsStr, setNumberOfMessagesToDisableMetaThinkInstructionsStr] = useState<string>(String(existingCharacter?.numberOfMessagesToDisableMetaThinkInstructions ?? 0));
    const [numberOfMessagesToDisableDialoguePromptStr, setNumberOfMessagesToDisableDialoguePromptStr] = useState<string>(String(existingCharacter?.numberOfMessagesToDisableDialoguePrompt ?? 0));
    const [numberOfMessagesToDisableStarterPromptStr, setNumberOfMessagesToDisableStarterPromptStr] = useState<string>(String(existingCharacter?.numberOfMessagesToDisableStarterPrompt ?? 0));

    const initialTools: Record<tool, boolean> = {} as Record<tool, boolean>;
    for (const key of Object.keys(defaultCharacterTools) as tool[]) {
        initialTools[key] = existingCharacter?.tools?.[key] !== undefined 
            ? existingCharacter.tools[key] 
            : defaultCharacterTools[key];
    }
    const [tools, setTools] = useState<Record<tool, boolean>>(initialTools);
    const [toolSearchQuery, setToolSearchQuery] = useState('');

    const [detectedToolsForModal, setDetectedToolsForModal] = useState<DetectedToolsResult | null>(null);
    const [showToolPermissionModal, setShowToolPermissionModal] = useState(false);

    const [memories, setMemories] = useState<Record<string, Memory[]>>(existingCharacter?.memories ?? {});
    const [clothings, setClothings] = useState<Clothing[]>(existingCharacter?.clothings ?? []);
    const [textCharacterInjections, setTextCharacterInjections] = useState<TextCharacterInjection[]>(existingCharacter?.textCharacterInjections ?? []);
    const [dialoguePrompts, setDialoguePrompts] = useState<DialoguePrompt[]>(existingCharacter?.dialoguePrompts ?? []);
    const [knowledgePrompts, setKnowledgePrompts] = useState<KnowledgePrompt[]>(existingCharacter?.knowledgePrompts ?? []);
    
    // ✅ Updated Starter Prompts State
    const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>(existingCharacter?.starterPrompts ?? []);
    const [showStarterPromptEditor, setShowStarterPromptEditor] = useState(false);

    // ✅ Embedding Opt-in States
    const [useEmbeddingModelForDialoguePrompts, setUseEmbeddingModelForDialoguePrompts] = useState(existingCharacter?.useEmbeddingModelForDialoguePrompts ?? false);
    const [useEmbeddingModelForStarterPrompts, setUseEmbeddingModelForStarterPrompts] = useState(existingCharacter?.useEmbeddingModelForStarterPrompts ?? false);
    const [useEmbeddingModelForKnowledgePrompts, setUseEmbeddingModelForKnowledgePrompts] = useState(existingCharacter?.useEmbeddingModelForKnowledgePrompts ?? false);
    const [useEmbeddingModelForMemories, setUseEmbeddingModelForMemories] = useState(existingCharacter?.useEmbeddingModelForMemories ?? false);

    // ✅ Memory Search Spaces State
    const [memorySearchSpaces, setMemorySearchSpaces] = useState<memorySearchSpace[]>(existingCharacter?.memorySearchSpaces ?? ['self', 'listener', 'co-located protagonists', 'co-located non-protagonists']);

    const [memoryPrompts, setMemoryPrompts] = useState<Record<string, string>>(existingCharacter?.memoryPrompts ?? {});

    const [aliases, setAliases] = useState<string[]>(existingCharacter?.aliases ?? []);
    const [newAliasInput, setNewAliasInput] = useState('');

    const [knownCharacterNames, setKnownCharacterNames] = useState<Record<string, string[]>>(existingCharacter?.knownCharacterNames ?? {});
    const initialKnownCharacterNamesRef = useRef<Record<string, string[]>>(existingCharacter?.knownCharacterNames ?? {});
    const [selectedCharForKnownName, setSelectedCharForKnownName] = useState('');
    const [selectedAliasForKnownName, setSelectedAliasForKnownName] = useState('');

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

    const handleToolToggle = (toolName: tool) => {
        if (isReadOnly) return;
        setTools(prev => ({ ...prev, [toolName]: !prev[toolName] }));
    };

    const handleSelectAllTools = () => {
        if (isReadOnly) return;
        setTools(prev => {
            const next = { ...prev };
            for (const key of Object.keys(next) as tool[]) next[key] = true;
            return next;
        });
    };

    const handleDeselectAllTools = () => {
        if (isReadOnly) return;
        setTools(prev => {
            const next = { ...prev };
            for (const key of Object.keys(next) as tool[]) next[key] = false;
            return next;
        });
    };

    const handleAutoDetectTools = () => {
        if (isReadOnly) return;
        const combinedText = `${name} ${description} ${systemPrompt}`;
        const detected = detectToolsFromText(combinedText);

        setTools(prev => {
            const next = { ...prev };
            for (const r of detected.inWorldReadonly) {
                next[r.tool] = true;
            }
            for (const r of detected.inWorldMutating) {
                next[r.tool] = true;
            }
            return next;
        });

        setDetectedToolsForModal(detected);
        setShowToolPermissionModal(true);
    };

    const effectiveCharacterIdForConfig = existingCharacter?.id || pendingCharacterId || '';

    const [quickConfigFeedback, setQuickConfigFeedback] = useState<{
        label: string;
        addedNames: { charName: string; names: string[] }[];
    } | null>(null);

    const mergeKnownNames = (targets: Character[]) => {
        if (isReadOnly) return;
        setKnownCharacterNames(prev => {
            const next = { ...prev };
            let changed = false;
            const feedbackList: { charName: string; names: string[] }[] = [];

            for (const target of targets) {
                if (target.id === effectiveCharacterIdForConfig) continue;
                const existing = next[target.id] || [];
                const existingSet = new Set(existing);
                const candidates = [target.name, ...(target.aliases ?? [])];
                const toAdd: string[] = [];
                for (const c of candidates) {
                    if (c && !existingSet.has(c)) {
                        toAdd.push(c);
                        existingSet.add(c);
                    }
                }
                if (toAdd.length > 0) {
                    next[target.id] = [...existing, ...toAdd];
                    changed = true;
                    feedbackList.push({ charName: target.name, names: toAdd });
                }
            }

            if (changed) {
                setQuickConfigFeedback({ label: 'Names Updated', addedNames: feedbackList });
            } else {
                setQuickConfigFeedback({ label: 'No New Names', addedNames: [] });
            }

            return changed ? next : prev;
        });
    };

    const handleKnowCurrentProtagonist = () => {
        if (!localProtagonistId) return;
        const protagChar = allCharacters.find(c => c.id === localProtagonistId) 
            || interactionData?.participants.find(p => p.id === localProtagonistId);
        if (protagChar) mergeKnownNames([protagChar]);
    };

    const handleKnowCoLocatedProtagonists = () => {
        if (!interactionData || !existingCharacter) return;
        const coLocated = getCoLocatedProtagonists(interactionData, existingCharacter);
        if (coLocated.length > 0) mergeKnownNames(coLocated);
    };

    const handleKnowAllProtagonists = () => {
        if (!interactionData?.protagonistIds?.length) return;
        const protagChars = interactionData.protagonistIds
            .map(id => interactionData.participants.find(p => p.id === id))
            .filter((c): c is Character => !!c);
        if (protagChars.length > 0) mergeKnownNames(protagChars);
    };

    const handleKnowCoLocatedParticipants = () => {
        if (!interactionData || !existingCharacter) return;
        const coLocated = getCoLocatedParticipants(interactionData, existingCharacter);
        if (coLocated.length > 0) mergeKnownNames(coLocated);
    };

    const handleKnowAllParticipants = () => {
        if (!interactionData?.participants?.length) return;
        mergeKnownNames(interactionData.participants);
    };

    const handleKnowAllCharacters = () => {
        if (allCharacters.length === 0) return;
        mergeKnownNames(allCharacters);
    };

    const handleRevertKnownNames = () => {
        if (isReadOnly) return;
        setKnownCharacterNames(initialKnownCharacterNamesRef.current);
        setQuickConfigFeedback({ label: 'Reverted to Original', addedNames: [] });
    };

    const handleAutoDetectStats = () => {
        if (isReadOnly) return;
        const combinedText = `${name} ${description} ${systemPrompt}`;
        const newDetected = { ...autoDetected };

        const iw = getInitiativeWeightValueFromText(combinedText);
        const cp = getChatProbabilityValue(combinedText);
        const ms = getMaximumChatStaminaValueFromText(combinedText);
        const csrr = getChatStaminaRegenerationRateValueFromText(combinedText);
        const ns = getNameSensitivityValueFromText(combinedText);
        const cis = getChatImpatienceSensitivityValueFromText(combinedText);
        const sp = getSkipProbabilityValueFromText(combinedText);
        const mrw = getMemoryRetentionWeightValueFromText(combinedText);
        const crs = getContextSensitivityValueFromText(combinedText);
        const mas = getMaximumActionStaminaValueFromText(combinedText);
        const asrr = getActionStaminaRegenerationRateValueFromText(combinedText);

        setInitiativeWeightStr(String(iw)); newDetected.iw = iw;
        setChatProbabilityStr(String(cp)); newDetected.cp = cp;
        setMaximumChatStaminaStr(String(ms)); newDetected.ms = ms;
        setChatStaminaRegenerationRateStr(String(csrr));
        setNameSensitivityStr(String(ns));
        setChatImpatienceSensitivityStr(String(cis));
        setSkipProbabilityStr(String(sp));
        setMemoryRetentionWeightStr(String(mrw));
        setContextSensitivityStr(String(crs));
        setMaximumActionStaminaStr(String(mas));
        setActionStaminaRegenerationRateStr(String(asrr));

        setAutoDetected(newDetected);
    };

    const handleResetStatsToDefaults = () => {
        if (isReadOnly) return;
        setInitiativeWeightStr(String(DEFAULT_INITIATIVE_WEIGHT));
        setChatProbabilityStr(String(DEFAULT_CHAT_PROBABILITY));
        setMaximumChatStaminaStr(String(DEFAULT_MAXIMUM_CHAT_STAMINA));
        setChatStaminaRegenerationRateStr(String(DEFAULT_CHAT_STAMINA_REGENERATION_RATE));
        setNameSensitivityStr(String(DEFAULT_NAME_SENSITIVITY));
        setChatImpatienceSensitivityStr(String(DEFAULT_CHAT_IMPATIENCE_SENSITIVITY));
        setSkipProbabilityStr(String(DEFAULT_SKIP_PROBABILITY));
        setMemoryRetentionWeightStr(String(DEFAULT_MEMORY_RETENTION_WEIGHT));
        setContextSensitivityStr(String(DEFAULT_CONTEXT_SENSITIVITY));
        setMaximumActionStaminaStr(String(DEFAULT_MAXIMUM_ACTION_STAMINA));
        setActionStaminaRegenerationRateStr(String(DEFAULT_ACTION_STAMINA_REGENERATION_RATE));
        setAutoDetected({ iw: null, cp: null, ms: null });
    };

    const hasSession = !!interactionData;
    const hasLocalProtagonist = !!localProtagonistId;
    const hasProtagonists = (interactionData?.protagonistIds?.length ?? 0) > 0;
    const hasParticipants = (interactionData?.participants?.length ?? 0) > 0;

    const coLocatedProtagonistCount = useMemo(() => {
        if (!interactionData || !existingCharacter) return 0;
        return getCoLocatedProtagonists(interactionData, existingCharacter).length;
    }, [interactionData, existingCharacter]);

    const coLocatedParticipantCount = useMemo(() => {
        if (!interactionData || !existingCharacter) return 0;
        return getCoLocatedParticipants(interactionData, existingCharacter).length;
    }, [interactionData, existingCharacter]);

    const countFieldTokens = async (field: keyof TokenCounts, text: string) => {
        if (!text) { setTokenCounts(prev => ({ ...prev, [field]: 0 })); return; }
        const timeouts = tokenCountTimeoutsRef.current;
        if (timeouts[field]) clearTimeout(timeouts[field]);
        timeouts[field] = setTimeout(async () => {
            setCountingField(field);
            const count = await tokenEngine.countTokens(text);
            setTokenCounts(prev => ({ ...prev, [field]: count }));
            setCountingField(prev => prev === field ? null : prev);
        }, 500);
    };

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
                if (text) {
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
        if (isReadOnly) return;
        const currentIW = Number.parseFloat(initiativeWeightStr);
        const currentCP = Number.parseFloat(chatProbabilityStr);
        const currentMS = Number.parseFloat(maximumChatStaminaStr);
        const currentCSRR = Number.parseFloat(chatStaminaRegenerationRateStr);
        const currentNS = Number.parseFloat(nameSensitivityStr);
        const currentCIS = Number.parseFloat(chatImpatienceSensitivityStr);
        const currentSP = Number.parseFloat(skipProbabilityStr);
        const currentMRW = Number.parseFloat(memoryRetentionWeightStr);
        const currentCRS = Number.parseFloat(contextSensitivityStr);
        const currentMAS = Number.parseFloat(maximumActionStaminaStr);
        const currentASRR = Number.parseFloat(actionStaminaRegenerationRateStr);

        const iwIsAuto = currentIW === -1;
        const cpIsAuto = currentCP === -1;
        const msIsAuto = currentMS === -1;
        const csrrIsAuto = currentCSRR === -1;
        const nsIsAuto = currentNS === -1;
        const cisIsAuto = currentCIS === -1;
        const spIsAuto = currentSP === -1;
        const mrwIsAuto = currentMRW === -1;
        const crsIsAuto = currentCRS === -1;
        const masIsAuto = currentMAS === -1;
        const asrrIsAuto = currentASRR === -1;

        if (!iwIsAuto && !cpIsAuto && !msIsAuto && !csrrIsAuto && !nsIsAuto && !cisIsAuto && !spIsAuto && !mrwIsAuto && !crsIsAuto && !masIsAuto && !asrrIsAuto) return;

        const combinedText = `${name} ${description} ${systemPrompt}`;
        const newDetected = { ...autoDetected };

        if (iwIsAuto) { const v = getInitiativeWeightValueFromText(combinedText); setInitiativeWeightStr(String(v)); newDetected.iw = v; }
        if (cpIsAuto) { const v = getChatProbabilityValue(combinedText); setChatProbabilityStr(String(v)); newDetected.cp = v; }
        if (msIsAuto) { const v = getMaximumChatStaminaValueFromText(combinedText); setMaximumChatStaminaStr(String(Math.round(v))); newDetected.ms = Math.round(v); }
        if (csrrIsAuto) { const v = getChatStaminaRegenerationRateValueFromText(combinedText); setChatStaminaRegenerationRateStr(String(v)); }
        if (nsIsAuto) { const v = getNameSensitivityValueFromText(combinedText); setNameSensitivityStr(String(v)); }
        if (cisIsAuto) { const v = getChatImpatienceSensitivityValueFromText(combinedText); setChatImpatienceSensitivityStr(String(v)); }
        if (spIsAuto) { const v = getSkipProbabilityValueFromText(combinedText); setSkipProbabilityStr(String(v)); }
        if (mrwIsAuto) { const v = getMemoryRetentionWeightValueFromText(combinedText); setMemoryRetentionWeightStr(String(v)); }
        if (crsIsAuto) { const v = getContextSensitivityValueFromText(combinedText); setContextSensitivityStr(String(v)); }
        if (masIsAuto) { const v = getMaximumActionStaminaValueFromText(combinedText); setMaximumActionStaminaStr(String(Math.round(v))); }
        if (asrrIsAuto) { const v = getActionStaminaRegenerationRateValueFromText(combinedText); setActionStaminaRegenerationRateStr(String(v)); }

        setAutoDetected(newDetected);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            setImageFile(e.target.files[0]);
            setImagePreview(URL.createObjectURL(e.target.files[0]));
        }
    };

    const handleRemoveImage = (e: React.MouseEvent) => {
        e.stopPropagation();
        setImageFile(null);
        setImagePreview(null);
        setEmotionImages(prev => {
            const next = { ...prev };
            delete next.neutral;
            return next;
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleVoiceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const file = e.target.files[0];
            if (file.size > MAX_VOICE_FILE_SIZE) { 
                setSubmitError(`Voice file too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`); 
                e.target.value = ''; 
                return; 
            }
            setVoiceFile(file); 
            setIsVoiceRemoved(false);
            setSubmitError(null);
        }
    };

    const handleRemoveVoice = () => { 
        setVoiceFile(null); 
        setHasExistingVoice(false); 
        setIsVoiceRemoved(true);
        if (voiceInputRef.current) voiceInputRef.current.value = ''; 
    };

    const handleCardImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
        const card = await parseCharacterCard(file);
        if (!card) { setSubmitError("Not a valid character card. Ensure it follows TavernAI V1/V2/V3 spec (PNG, CharX, or JSON)."); return; }
        const fields = mapCardToEditorFields(card);
        setName(fields.name);
        setDescription(fields.description);
        setSystemPrompt(fields.systemPrompt);
        setThinkPrompt('');
        setAppearancePrompt(fields.appearancePrompt);
        setFirstMessage(fields.firstMessage);

        const fileNameLower = file.name.toLowerCase();
        if (fileNameLower.endsWith('.png') || file.type === 'image/png') {
            setImageFile(file); setImagePreview(URL.createObjectURL(file));
        } else {
            setImageFile(null); setImagePreview(null);
        }

        setAutoDetected({ iw: null, cp: null, ms: null });
        setInitiativeWeightStr('-1'); setChatProbabilityStr('-1'); setMaximumChatStaminaStr('-1');
        setChatStaminaRegenerationRateStr('-1');
        setNameSensitivityStr('-1');
        setChatImpatienceSensitivityStr('-1'); setSkipProbabilityStr('-1'); setMemoryRetentionWeightStr('-1'); setContextSensitivityStr('-1');
        setMaximumActionStaminaStr('-1');
        setActionStaminaRegenerationRateStr('-1');
        setSelectedStopPatternIds([]); setUseFrontCameraImage(false); setDoNotInjectCharacterImage(false);
        setNumberOfMessagesToDisableThinkPromptStr('0');
        setNumberOfMessagesToDisableMetaThinkInstructionsStr('0');
        setNumberOfMessagesToDisableDialoguePromptStr('0');
        setNumberOfMessagesToDisableStarterPromptStr('0');

        const fullCardText = `${fields.name} ${fields.description} ${fields.systemPrompt}`;
        const detectedTools = detectToolsFromText(fullCardText);
        const nextTools: Record<tool, boolean> = { ...defaultCharacterTools };
        for (const rule of detectedTools.inWorldReadonly) {
            nextTools[rule.tool] = true;
        }
        for (const rule of detectedTools.inWorldMutating) {
            nextTools[rule.tool] = true;
        }
        setTools(nextTools);

        if (detectedTools.osPrivileged.length > 0 || detectedTools.entityAdmin.length > 0 || detectedTools.ambient.length > 0) {
            setDetectedToolsForModal(detectedTools);
            setShowToolPermissionModal(true);
        }

        setMemories({});
        setMemoryPrompts({});
        setClothings([]);
        setTextCharacterInjections([]);
        setDialoguePrompts([]);
        setKnowledgePrompts([]);
        setAliases([]);
        setKnownCharacterNames({});
        initialKnownCharacterNamesRef.current = {};
        setIsVoiceRemoved(false);
        
        // ✅ Updated Starter Prompts Import Logic
        if (fields.starterPrompt) {
            const now = Date.now();
            setStarterPrompts([{
                id: uuidv4(),
                name: 'Default Greeting',
                description: '',
                textContent: fields.starterPrompt,
                weight: 1,
                skipProbability: 0,
                firstCreatedTimestamp: now,
                lastUpdatedTimestamp: now
            }]);
        } else {
            setStarterPrompts([]);
        }
        
        countFieldTokens('systemPrompt', fields.systemPrompt);
        countFieldTokens('thinkPrompt', '');
        countFieldTokens('appearancePrompt', fields.appearancePrompt);
        setSubmitError(null);
        const extended = card as ParsedCharacterCardExtended;
        if (extended.emotionImages && Object.keys(extended.emotionImages).length > 0) {
            setEmotionImages(prev => ({ ...prev, ...extended.emotionImages }));
        }
        if (extended.nickname && extended.nickname !== fields.name) {
            setAliases([extended.nickname]);
        }
    };

    const handleStopPatternToggle = (id: string) => {
        if (isReadOnly) return;
        setSelectedStopPatternIds(prev => prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]);
    };

    const handleAddAlias = () => {
        if (isReadOnly) return;
        const val = newAliasInput;
        if (!val || aliases.includes(val)) return;
        setAliases(prev => [...prev, val]);
        setNewAliasInput('');
    };

    const handleRemoveAlias = (alias: string) => {
        if (isReadOnly) return;
        setAliases(prev => prev.filter(a => a !== alias));
    };

    const handleAddKnownName = (targetCharId: string, nameVariant: string) => {
        if (isReadOnly) return;
        if (!nameVariant) return;
        setKnownCharacterNames(prev => {
            const existing = prev[targetCharId] || [];
            if (existing.includes(nameVariant)) return prev;
            return { ...prev, [targetCharId]: [...existing, nameVariant] };
        });
    };

    const handleRemoveKnownName = (targetCharId: string, nameVariant: string) => {
        if (isReadOnly) return;
        setKnownCharacterNames(prev => {
            const existing = prev[targetCharId];
            if (!existing) return prev;
            const filtered = existing.filter(n => n !== nameVariant);
            if (filtered.length === 0) {
                const next = { ...prev };
                delete next[targetCharId];
                return next;
            }
            return { ...prev, [targetCharId]: filtered };
        });
    };

    const handleRemoveAllKnownName = (targetCharId: string) => {
        if (isReadOnly) return;
        setKnownCharacterNames(prev => {
            const next = { ...prev };
            delete next[targetCharId];
            return next;
        });
    };

    const handleCharacterSelectForKnownName = (charId: string) => {
        if (isReadOnly) return;
        setSelectedCharForKnownName(charId);
        setSelectedAliasForKnownName('');
    };

    const handleAliasSelectForKnownName = (alias: string) => {
        if (isReadOnly) return;
        if (alias && selectedCharForKnownName) {
            handleAddKnownName(selectedCharForKnownName, alias);
        }
        setSelectedAliasForKnownName('');
    };

    const buildCharacterFromForm = async (isNewClone: boolean): Promise<Character | null> => {
        setSubmitError(null);
        if (!name) { setSubmitError("Name is required!"); return null; }

        const targetCharacterId = isNewClone ? uuidv4() : (existingCharacter?.id || pendingCharacterId || uuidv4());

        const finalImages: Record<string, string> = { ...emotionImages };

        let finalVoice: Voice | undefined = (!isVoiceRemoved && existingCharacter?.voice) 
            ? { ...existingCharacter.voice } 
            : undefined;

        if (finalVoice && voiceLanguage) {
            finalVoice.language = voiceLanguage;
        }

        setIsUploading(true);
        try {
            // ─── CLONE EXTERNAL ASSETS (IMAGES & VOICE) ─────────────────────
            if (isNewClone && existingCharacter) {
                for (const [expr, filename] of Object.entries(emotionImages)) {
                    if (expr === 'neutral' && imageFile) continue;
                    const clonedFilename = await cloneCharacterImage(existingCharacter.id, targetCharacterId, filename);
                    if (clonedFilename) {
                        finalImages[expr] = clonedFilename;
                    }
                }

                if (!isVoiceRemoved && existingCharacter.voice?.voiceFilename && !voiceFile) {
                    const clonedVoiceFilename = await cloneCharacterVoice(
                        existingCharacter.id,
                        targetCharacterId,
                        existingCharacter.voice.voiceFilename
                    );
                    if (clonedVoiceFilename) {
                        if (!finalVoice) {
                            finalVoice = { voiceFilename: clonedVoiceFilename, language: voiceLanguage || undefined };
                        } else {
                            finalVoice.voiceFilename = clonedVoiceFilename;
                        }
                    }
                }
            }

            // ─── USER-UPLOADED REPLACEMENTS ─────────────────────────────────
            if (imageFile) {
                try { 
                    finalImages.neutral = await uploadCharacterImage(targetCharacterId, imageFile); 
                } catch { 
                    setSubmitError("Failed to upload image."); 
                    return null; 
                }
            } else if (!imagePreview) {
                delete finalImages.neutral;
            }

            if (voiceFile) {
                try {
                    const uploadedVoice = await uploadCharacterVoice(targetCharacterId, voiceFile);
                    if (finalVoice) {
                        finalVoice.voiceFilename = uploadedVoice;
                    } else {
                        finalVoice = {
                            voiceFilename: uploadedVoice,
                            language: voiceLanguage || undefined,
                        };
                    }
                } catch (e) {
                    console.warn("Failed to upload voice file:", e);
                }
            }
        } finally {
            setIsUploading(false);
        }

        if (voiceFile && onVoiceTranscribeRequested) {
            onVoiceTranscribeRequested(targetCharacterId, voiceFile, voiceLanguage || undefined);
        }

        const rawIW = Number.parseFloat(initiativeWeightStr);
        const rawCP = Number.parseFloat(chatProbabilityStr);
        const rawMS = Number.parseFloat(maximumChatStaminaStr);
        const rawCSRR = Number.parseFloat(chatStaminaRegenerationRateStr);
        const rawNS = Number.parseFloat(nameSensitivityStr);
        const rawCIS = Number.parseFloat(chatImpatienceSensitivityStr);
        const rawSP = Number.parseFloat(skipProbabilityStr);
        const rawMRW = Number.parseFloat(memoryRetentionWeightStr);
        const rawCRS = Number.parseFloat(contextSensitivityStr);
        const rawMAS = Number.parseFloat(maximumActionStaminaStr);
        const rawASRR = Number.parseFloat(actionStaminaRegenerationRateStr);
        const rawDisableThink = Number.parseInt(numberOfMessagesToDisableThinkPromptStr);
        const rawDisableMeta = Number.parseInt(numberOfMessagesToDisableMetaThinkInstructionsStr);
        const rawDisableDialogue = Number.parseInt(numberOfMessagesToDisableDialoguePromptStr);
        const rawDisableStarter = Number.parseInt(numberOfMessagesToDisableStarterPromptStr);

        const iwValid = !Number.isNaN(rawIW) && rawIW >= 0;
        const cpValid = !Number.isNaN(rawCP) && rawCP >= 0;
        const msValid = !Number.isNaN(rawMS) && rawMS >= 0;
        const csrrValid = !Number.isNaN(rawCSRR) && rawCSRR >= 0;
        const nsValid = !Number.isNaN(rawNS) && rawNS >= 0;
        const cisValid = !Number.isNaN(rawCIS) && rawCIS >= 0;
        const spValid = !Number.isNaN(rawSP) && rawSP >= 0;
        const mrwValid = !Number.isNaN(rawMRW) && rawMRW >= 0;
        const crsValid = !Number.isNaN(rawCRS) && rawCRS >= 0;
        const masValid = !Number.isNaN(rawMAS) && rawMAS >= 0;
        const asrrValid = !Number.isNaN(rawASRR) && rawASRR >= 0;

        let finalIW: number;
        let finalCP: number;
        let finalMS: number;
        let finalCSRR: number;
        let finalNS: number;
        let finalCIS: number;
        let finalSP: number;
        let finalMRW: number;
        let finalCRS: number;
        let finalMAS: number;
        let finalASRR: number;

        if (existingCharacter && !isNewClone) {
            finalIW = iwValid ? rawIW : (existingCharacter.initiativeWeight ?? -1);
            finalCP = cpValid ? rawCP : (existingCharacter.chatProbability ?? -1);
            finalMS = msValid ? Math.round(rawMS) : (existingCharacter.maximumChatStamina ?? -1);
            finalCSRR = csrrValid ? rawCSRR : (existingCharacter.chatStaminaRegenerationRate ?? DEFAULT_CHAT_STAMINA_REGENERATION_RATE);
            finalNS = nsValid ? rawNS : (existingCharacter.nameSensitivity ?? DEFAULT_NAME_SENSITIVITY);
            finalCIS = cisValid ? rawCIS : (existingCharacter.chatImpatienceSensitivity ?? DEFAULT_CHAT_IMPATIENCE_SENSITIVITY);
            finalSP = spValid ? rawSP : (existingCharacter.skipProbability ?? DEFAULT_SKIP_PROBABILITY);
            finalMRW = mrwValid ? rawMRW : (existingCharacter.memoryRetentionWeight ?? DEFAULT_MEMORY_RETENTION_WEIGHT);
            finalCRS = crsValid ? rawCRS : (existingCharacter.contextSensitivity ?? DEFAULT_CONTEXT_SENSITIVITY);
            finalMAS = masValid ? Math.round(rawMAS) : (existingCharacter.maximumActionStamina ?? DEFAULT_MAXIMUM_ACTION_STAMINA);
            finalASRR = asrrValid ? rawASRR : (existingCharacter.actionStaminaRegenerationRate ?? DEFAULT_ACTION_STAMINA_REGENERATION_RATE);
            if (finalIW === -1 && finalCP === -1 && finalMS === -1) {
                const t = `${name} ${description} ${systemPrompt}`;
                finalIW = getInitiativeWeightValueFromText(t);
                finalCP = getChatProbabilityValue(t);
                finalMS = Math.round(getMaximumChatStaminaValueFromText(t));
                finalCSRR = getChatStaminaRegenerationRateValueFromText(t);
                finalASRR = getActionStaminaRegenerationRateValueFromText(t);
            }
        } else {
            finalIW = iwValid ? rawIW : DEFAULT_INITIATIVE_WEIGHT;
            finalCP = cpValid ? rawCP : DEFAULT_CHAT_PROBABILITY;
            finalMS = msValid ? Math.round(rawMS) : DEFAULT_MAXIMUM_CHAT_STAMINA;
            finalCSRR = csrrValid ? rawCSRR : DEFAULT_CHAT_STAMINA_REGENERATION_RATE;
            finalNS = nsValid ? rawNS : DEFAULT_NAME_SENSITIVITY;
            finalSP = spValid ? rawSP : DEFAULT_SKIP_PROBABILITY;
            finalCIS = cisValid ? rawCIS : DEFAULT_CHAT_IMPATIENCE_SENSITIVITY;
            finalMRW = mrwValid ? rawMRW : DEFAULT_MEMORY_RETENTION_WEIGHT;
            finalCRS = crsValid ? rawCRS : DEFAULT_CONTEXT_SENSITIVITY;
            finalMAS = masValid ? Math.round(rawMAS) : DEFAULT_MAXIMUM_ACTION_STAMINA;
            finalASRR = asrrValid ? rawASRR : DEFAULT_ACTION_STAMINA_REGENERATION_RATE;
            if (rawIW === -1 && rawCP === -1 && rawMS === -1) {
                const t = `${name} ${description} ${systemPrompt}`;
                const dIW = getInitiativeWeightValueFromText(t);
                const dCP = getChatProbabilityValue(t);
                const dMS = getMaximumChatStaminaValueFromText(t);
                const dCSRR = getChatStaminaRegenerationRateValueFromText(t);
                const dASRR = getActionStaminaRegenerationRateValueFromText(t);
                if (dIW >= 0) finalIW = dIW;
                if (dCP >= 0) finalCP = dCP;
                if (dMS >= 0) finalMS = Math.round(dMS);
                if (dCSRR >= 0) finalCSRR = dCSRR;
                if (dASRR >= 0) finalASRR = dASRR;
            }
        }

        // ✅ Build dual samplers and direct stop patterns
        const baseLanguageModelSampler = allSamplers.find(s => s.id === selectedLanguageModelSamplerId);
        const finalLanguageModelSampler = baseLanguageModelSampler ? { ...baseLanguageModelSampler } : undefined;

        const baseTextToSpeechModelSampler = allSamplers.find(s => s.id === selectedTextToSpeechModelSamplerId);
        const finalTextToSpeechModelSampler = baseTextToSpeechModelSampler ? { ...baseTextToSpeechModelSampler } : undefined;

        // ✅ Build Retrieval Configurations
        const finalDialogueRetrievalConfiguration = allRetrievalConfigurations.find(c => c.id === selectedDialogueRetrievalConfigurationId);
        const finalStarterPromptRetrievalConfiguration = allRetrievalConfigurations.find(c => c.id === selectedStarterPromptRetrievalConfigurationId);
        const finalKnowledgeRetrievalConfiguration = allRetrievalConfigurations.find(c => c.id === selectedKnowledgeRetrievalConfigurationId);
        const finalMemoryRetrievalConfiguration = allRetrievalConfigurations.find(c => c.id === selectedMemoryRetrievalConfigurationId);

        const finalStopPatterns = selectedStopPatternIds
            .map(id => getStopPatternById(id))
            .filter((sp): sp is StopPattern => sp !== null);

        const now = Date.now();
        return {
            id: targetCharacterId,
            name: isNewClone ? `${name} (Clone)` : name,
            description, systemPrompt,
            thinkPrompt: thinkPrompt || undefined,
            appearancePrompt: appearancePrompt || undefined,
            dialoguePrompts: dialoguePrompts.length > 0 ? dialoguePrompts : undefined,
            knowledgePrompts: knowledgePrompts.length > 0 ? knowledgePrompts : undefined,
            // ✅ Updated to Array Length Check
            starterPrompts: starterPrompts.length > 0 ? starterPrompts : undefined,
            memoryPrompts: Object.keys(memoryPrompts).length > 0 ? memoryPrompts : undefined,
            aliases: aliases.length > 0 ? aliases : undefined,
            images: Object.keys(finalImages).length > 0 ? finalImages : undefined,
            voice: finalVoice, // ✅ PRESERVED AND PROPERLY CLONED
            useFrontCameraImage: useFrontCameraImage || undefined,
            languageModelSampler: finalLanguageModelSampler,
            textToSpeechModelSampler: finalTextToSpeechModelSampler,
            stopPatterns: finalStopPatterns.length > 0 ? finalStopPatterns : undefined,
            
            // ✅ Added Retrieval Configurations
            dialogueRetrievalConfiguration: finalDialogueRetrievalConfiguration,
            starterPromptRetrievalConfiguration: finalStarterPromptRetrievalConfiguration,
            knowledgeRetrievalConfiguration: finalKnowledgeRetrievalConfiguration,
            memoryRetrievalConfiguration: finalMemoryRetrievalConfiguration,

            initiativeWeight: finalIW, chatProbability: finalCP, maximumChatStamina: finalMS,
            chatStaminaRegenerationRate: finalCSRR,
            nameSensitivity: finalNS, chatImpatienceSensitivity: finalCIS, skipProbability: finalSP,
            memoryRetentionWeight: finalMRW, contextSensitivity: finalCRS,
            maximumActionStamina: finalMAS,
            actionStaminaRegenerationRate: finalASRR,
            doNotInjectCharacterImage: doNotInjectCharacterImage || undefined,
            numberOfMessagesToDisableThinkPrompt: Number.isNaN(rawDisableThink) ? 0 : Math.max(0, rawDisableThink),
            numberOfMessagesToDisableMetaThinkInstructions: Number.isNaN(rawDisableMeta) ? 0 : Math.max(0, rawDisableMeta),
            numberOfMessagesToDisableDialoguePrompt: Number.isNaN(rawDisableDialogue) ? 0 : Math.max(0, rawDisableDialogue),
            numberOfMessagesToDisableStarterPrompt: Number.isNaN(rawDisableStarter) ? 0 : Math.max(0, rawDisableStarter),
            
            // ✅ Added Embedding Toggles
            useEmbeddingModelForDialoguePrompts: useEmbeddingModelForDialoguePrompts || undefined,
            useEmbeddingModelForStarterPrompts: useEmbeddingModelForStarterPrompts || undefined,
            useEmbeddingModelForKnowledgePrompts: useEmbeddingModelForKnowledgePrompts || undefined,
            useEmbeddingModelForMemories: useEmbeddingModelForMemories || undefined,

            // ✅ Added Memory Search Spaces
            memorySearchSpaces: memorySearchSpaces.length > 0 ? memorySearchSpaces : undefined,

            tools: { ...tools },
            clothings,
            knownCharacterNames,
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
    const hasVoice = (!!voiceFile || hasExistingVoice) && !isVoiceRemoved;
    const effectiveCharacterId = existingCharacter?.id || pendingCharacterId || '';
    const memoryCount = useMemo(() => {
        // If there is no local protagonist, just return the total count of all memories
        if (!localProtagonistId) return Object.values(memories).reduce((sum, arr) => sum + arr.length, 0);

        let count = 0;
        for (const [interactionDataId, memoryArr] of Object.entries(memories)) {
            const shell = allRawInteractionDataShells.find(s => s.id === interactionDataId);
            if (shell?.participantIds.includes(localProtagonistId)) count += memoryArr.length;
        }
        
        return count;
    }, [memories, localProtagonistId, allRawInteractionDataShells]);

    const [newMemoryPromptExpression, setNewMemoryPromptExpression] = useState<string>(emotions[0]);
    const [newMemoryPromptTemplate, setNewMemoryPromptTemplate] = useState('');

    const availableEmotions = useMemo(() => {
        const used = new Set(Object.keys(memoryPrompts));
        return emotions.filter(label => !used.has(label));
    }, [memoryPrompts]);

    const handleAddMemoryPrompt = () => {
        if (isReadOnly) return;
        const expr = newMemoryPromptExpression;
        const tmpl = newMemoryPromptTemplate;
        if (!expr || !tmpl) return;
        setMemoryPrompts(prev => ({ ...prev, [expr]: tmpl }));
        setNewMemoryPromptTemplate('');
        const usedAfter = new Set([...Object.keys(memoryPrompts), expr]);
        const nextAvailable = emotions.find(l => !usedAfter.has(l));
        setNewMemoryPromptExpression(nextAvailable ?? emotions[0]);
    };

    const handleRemoveMemoryPrompt = (expr: string) => {
        if (isReadOnly) return;
        setMemoryPrompts(prev => {
            const next = { ...prev };
            delete next[expr];
            return next;
        });
    };

    const getStopPatternById = (id: string) => {
        for (const s of allSamplers) {
            const found = s.stopPatterns.find(sp => sp.id === id);
            if (found) return found;
        }
        return null;
    };

    const otherCharacters = allCharacters.filter(c => c.id !== (existingCharacter?.id || pendingCharacterId));

    const selectedCharAliases = useMemo(() => {
        if (!selectedCharForKnownName) return [];
        const targetChar = allCharacters.find(c => c.id === selectedCharForKnownName);
        if (!targetChar) return [];
        const alreadyKnown = new Set(knownCharacterNames[selectedCharForKnownName] ?? []);
        const allNames: string[] = [];
        if (targetChar.name && !alreadyKnown.has(targetChar.name)) allNames.push(targetChar.name);
        if (targetChar.aliases) {
            for (const alias of targetChar.aliases) {
                if (alias && !allNames.includes(alias) && !alreadyKnown.has(alias)) allNames.push(alias);
            }
        }
        return allNames;
    }, [selectedCharForKnownName, allCharacters, knownCharacterNames]);

    const filteredToolNames = useMemo(() => {
        const allToolNames = Object.keys(tools) as tool[];
        const q = toolSearchQuery.toLowerCase();
        if (!q) return allToolNames;
        return allToolNames.filter(toolName => {
            const label = (toolLabels[toolName] ?? toolName).toLowerCase();
            const desc = (characterToolDescriptions[toolName] ?? '').toLowerCase();
            return label.includes(q) || desc.includes(q) || toolName.toLowerCase().includes(q);
        });
    }, [tools, toolSearchQuery]);

    const editorTabs: { id: EditorTabId; label: string; icon: string }[] = [
        { id: 'general', label: 'General', icon: '📝' },
        { id: 'behaviour', label: 'Behaviour', icon: '🧠' },
        { id: 'stats', label: 'Stats', icon: '📊' },
        { id: 'tools', label: 'Tools', icon: '🔧' },
        { id: 'model', label: 'Model', icon: '🤖' },
        { id: 'quick-config', label: 'Quick Config', icon: '⚡' },
    ];

    return (
        <>
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                    <FileDropArea
                        acceptedTypes={['image', 'audio']}
                        disabled={isUploading || isReadOnly}
                        onDropImage={(file) => {
                            setImageFile(file);
                            setImagePreview(URL.createObjectURL(file));
                            setActiveTab('general');
                        }}
                        onDropAudio={(file) => {
                            if (file.size > MAX_VOICE_FILE_SIZE) { 
                                setSubmitError(`Voice file too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`); 
                                return; 
                            }
                            setVoiceFile(file); 
                            setIsVoiceRemoved(false);
                            setSubmitError(null);
                            setActiveTab('general');
                        }}
                        overlayTitle="Drop Character Asset"
                        overlaySubtitle="Images set neutral avatar • Audio sets voice file"
                    >
                        <div className="modal-header">
                            <h2>{(existingCharacter ? `${(isReadOnly) ? 'View' : 'Edit'} Character` : 'Create New Character')}</h2>
                            <div className="editor-modal-actions">
                                <button type="button" className="editor-button editor-button-cancel" onClick={onClose} disabled={isUploading}>
                                    {isReadOnly ? 'Close' : 'Cancel'}
                                </button>
                                {!isReadOnly && existingCharacter && <button type="button" className="editor-button editor-button-cancel" onClick={handleClone} disabled={isUploading}>Clone</button>}
                                {!isReadOnly && !existingCharacter && (<>
                                    <button type="button" className="editor-button editor-button-import" onClick={() => cardImportRef.current?.click()} disabled={isUploading}>Import</button>
                                    <input ref={cardImportRef} type="file" accept=".png,.charx,.json,image/png,application/zip,application/json" hidden onChange={handleCardImport} disabled={isUploading} />
                                </>)}
                                {!isReadOnly && <button type="button" className="editor-button editor-button-save" onClick={handleSubmit} disabled={isUploading}>{isUploading ? 'Uploading...' : 'Save'}</button>}
                            </div>
                        </div>

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

                            {activeTab === 'general' && (
                                <div className="editor-modal-columns">
                                    <div className="editor-left-column">
                                        <div className="editor-image-upload-container">
                                            <div className={`editor-image-square editor-image-portrait ${imagePreview ? 'active solid' : 'dashed'}`}
                                                style={{ cursor: (isUploading || isReadOnly) ? 'default' : 'pointer', opacity: isUploading ? 0.7 : 1 }}
                                                onClick={() => !(isUploading || isReadOnly) && fileInputRef.current?.click()}>
                                                {imagePreview ? (<><img src={imagePreview} alt="Character" />{!(isUploading || isReadOnly) && <div className="editor-image-hover-overlay"><button type="button" onClick={handleRemoveImage} className="editor-image-remove-button-large" title="Remove Picture">🗑️</button></div>}</>) : (<div className="editor-image-placeholder">{isUploading ? '⏳' : '📷'}</div>)}
                                            </div>
                                            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} disabled={isUploading || isReadOnly} />
                                        </div>

                                        <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowImageEditor(true)} disabled={isUploading || isReadOnly} style={{ width: '100%', marginTop: '6px', fontSize: '0.75rem' }}>
                                            More Images ({Object.keys(emotionImages).length})
                                        </button>

                                        <div className="editor-section" style={{ marginTop: '8px' }}>
                                            <label className="editor-checkbox-label">
                                                <input type="checkbox" checked={useFrontCameraImage} onChange={(e) => setUseFrontCameraImage(e.target.checked)} className="editor-checkbox-input" disabled={isUploading || isReadOnly} />
                                                <span>Use Front Camera Image</span>
                                            </label>
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px', marginLeft: '26px' }}>
                                                Replace stored image with live front camera snapshot when profile allows per-character control.
                                            </div>
                                            <label className="editor-checkbox-label" style={{ marginTop: '8px' }}>
                                                <input type="checkbox" checked={doNotInjectCharacterImage} onChange={(e) => setDoNotInjectCharacterImage(e.target.checked)} className="editor-checkbox-input" disabled={isUploading || isReadOnly} />
                                                <span>Do Not Inject Character Image</span>
                                            </label>
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px', marginLeft: '26px' }}>
                                                Prevent this character's image from being sent to the model.
                                            </div>
                                        </div>

                                        <div className="editor-section editor-voice-section">
                                            <span className="editor-section-title">Voice</span>
                                            <div className="editor-voice-hint">Used for reading character's text. Maximum 5MB.</div>
                                            
                                            <select 
                                                value={voiceLanguage} 
                                                onChange={(e) => setVoiceLanguage(e.target.value)} 
                                                className="editor-select" 
                                                style={{ marginBottom: '6px', fontSize: '0.7rem', padding: '4px 6px', width: '100%' }}
                                                disabled={isUploading || isReadOnly}
                                            >
                                                <option value="">Select audio language...</option>
                                                <option value="ja">Japanese (ja)</option>
                                                <option value="en">English (en)</option>
                                                <option value="zh">Chinese (zh)</option>
                                                <option value="ko">Korean (ko)</option>
                                                <option value="es">Spanish (es)</option>
                                                <option value="fr">French (fr)</option>
                                                <option value="de">German (de)</option>
                                                <option value="ru">Russian (ru)</option>
                                            </select>

                                            {hasVoice ? (
                                                <div className="editor-voice-chip">
                                                    <span className="editor-voice-chip-name">
                                                        🎙️ {voiceFile ? voiceFile.name : (existingCharacter?.voice?.voiceFilename || 'audio')}
                                                    </span>
                                                    {!isReadOnly && <button type="button" onClick={handleRemoveVoice} disabled={isUploading} className="editor-voice-remove-button" title="Remove voice">×</button>}
                                                </div>
                                            ) : (
                                                !isReadOnly && (
                                                    <button 
                                                        type="button" 
                                                        onClick={() => !isUploading && voiceInputRef.current?.click()} 
                                                        disabled={isUploading || !voiceLanguage} 
                                                        className={`toolbar-button editor-voice-upload-button ${isUploading ? 'uploading' : ''}`}
                                                        style={{ opacity: !voiceLanguage ? 0.5 : 1, cursor: !voiceLanguage ? 'not-allowed' : 'pointer' }}
                                                    >
                                                        {isUploading ? '⏳ Uploading...' : '🎙️ Upload Voice Sample'}
                                                    </button>
                                                )
                                            )}
                                            
                                            {!hasVoice && !isReadOnly && !voiceLanguage && (
                                                <div style={{ fontSize: '0.6rem', opacity: 0.6, marginTop: '4px', fontStyle: 'italic' }}>
                                                    Select a language above to enable upload.
                                                </div>
                                            )}

                                            <input ref={voiceInputRef} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg" hidden onChange={handleVoiceChange} disabled={isUploading || isReadOnly || !voiceLanguage} />
                                        </div>
                                    </div>

                                    <div className="editor-right-column">
                                        <textarea value={name} readOnly={isReadOnly} onChange={(e) => setName(e.target.value)} className="editor-textarea editor-textarea-name" placeholder="Name *" disabled={isUploading || isReadOnly} />
                                        <textarea value={description} readOnly={isReadOnly} onChange={(e) => setDescription(e.target.value)} className="editor-textarea editor-textarea-description" placeholder="Description" disabled={isUploading || isReadOnly} />
                                        <textarea value={firstMessage} readOnly={isReadOnly} onChange={(e) => setFirstMessage(e.target.value)} className="editor-textarea editor-textarea-first-message" placeholder="First message" disabled={isUploading || isReadOnly} />

                                        <div className="editor-field-wrapper-full">
                                            <textarea value={systemPrompt} readOnly={isReadOnly} onChange={(e) => { setSystemPrompt(e.target.value); countFieldTokens('systemPrompt', e.target.value); }} onBlur={handleSystemPromptBlur} className="editor-textarea editor-textarea-system" placeholder="System prompt" disabled={isUploading || isReadOnly} />
                                            {renderTokenCount('systemPrompt')}
                                        </div>
                                        <div className="editor-field-wrapper"><textarea value={thinkPrompt} readOnly={isReadOnly} onChange={(e) => { setThinkPrompt(e.target.value); countFieldTokens('thinkPrompt', e.target.value); }} className="editor-textarea editor-textarea-think" placeholder="Think Prompt" disabled={isUploading || isReadOnly} />{renderTokenCount('thinkPrompt')}</div>
                                        <div className="editor-field-wrapper"><textarea value={appearancePrompt} readOnly={isReadOnly} onChange={(e) => { setAppearancePrompt(e.target.value); countFieldTokens('appearancePrompt', e.target.value); }} className="editor-textarea editor-textarea-appearance" placeholder="Appearance Prompt" disabled={isUploading || isReadOnly} />{renderTokenCount('appearancePrompt')}</div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'behaviour' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {/* ✅ Updated Starter Prompts Section */}
                                    <div className="editor-section" style={{ margin: 0 }}>
                                        <div className="editor-section-title">Starter Prompts ({starterPrompts.length})</div>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Weighted starter messages. Higher weight = more likely to be selected.</div>
                                        <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowStarterPromptEditor(true)} disabled={isUploading || isReadOnly} style={{ width: '100%' }}>
                                            Edit Starter Prompts ({starterPrompts.length})
                                        </button>
                                    </div>

                                    <div className="editor-section" style={{ margin: 0 }}>
                                        <div className="editor-section-title">Memory Prompts ({Object.keys(memoryPrompts).length})</div>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Expression to memory template mapping. If the expression is not found, falls back to neutral, then system default.</div>
                                        {!isReadOnly && (
                                            <div style={{ display: 'flex', gap: '4px', marginBottom: '6px', flexDirection: 'column' }}>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    <select
                                                        className="editor-select"
                                                        value={newMemoryPromptExpression}
                                                        onChange={e => setNewMemoryPromptExpression(e.target.value)}
                                                        disabled={isUploading || availableEmotions.length === 0}
                                                        style={{ flex: 1, fontSize: '0.7rem', padding: '4px 6px' }}
                                                    >
                                                        {availableEmotions.length === 0 && <option value="" disabled>All emotions assigned</option>}
                                                        {availableEmotions.map(label => (
                                                            <option key={label} value={label}>{label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    <input type="text" value={newMemoryPromptTemplate} onChange={e => setNewMemoryPromptTemplate(e.target.value)} className="editor-input" placeholder="Memory template string..." style={{ flex: 1, fontSize: '0.7rem', padding: '4px 6px' }} disabled={isUploading} />
                                                    <button type="button" onClick={handleAddMemoryPrompt} className="toolbar-button" title="Add" style={{ fontSize: '0.7rem', padding: '2px 8px' }} disabled={isUploading || availableEmotions.length === 0}>+</button>
                                                </div>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '150px', overflowY: 'auto' }}>
                                            {Object.entries(memoryPrompts).map(([expression, template]) => (
                                                <div key={expression} style={{ display: 'flex', gap: '4px', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '4px 6px', borderRadius: '4px' }}>
                                                    <span style={{ fontWeight: 'bold', fontSize: '0.65rem', color: 'var(--accent)', minWidth: '80px', textTransform: 'capitalize' }}>{expression}</span>
                                                    <span style={{ flex: 1, fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, opacity: 0.8 }}>{template}</span>
                                                    {!isReadOnly && <button type="button" onClick={() => handleRemoveMemoryPrompt(expression)} className="toolbar-button" title="Remove" style={{ width: '18px', height: '18px', fontSize: '0.6rem', color: '#ff4444', padding: 0 }}>×</button>}
                                                </div>
                                            ))}
                                            {Object.keys(memoryPrompts).length === 0 && (
                                                <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic', padding: '4px 0' }}>No memory prompts.{!isReadOnly && ' Add above.'}</div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="editor-section" style={{ margin: 0 }}>
                                        <div className="editor-section-title">Aliases ({aliases.length})</div>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Alternative names this character is also known by.</div>
                                        {!isReadOnly && (
                                            <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                                                <input type="text" value={newAliasInput} onChange={e => setNewAliasInput(e.target.value)} className="editor-input" placeholder="Add alias..." style={{ flex: 1, fontSize: '0.7rem', padding: '4px 6px' }} disabled={isUploading} onKeyDown={e => { if (e.key === 'Enter') handleAddAlias(); }} />
                                                <button type="button" onClick={handleAddAlias} className="toolbar-button" title="Add" style={{ fontSize: '0.7rem', padding: '2px 8px' }} disabled={isUploading}>+</button>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                            {aliases.map(alias => (
                                                <span key={alias} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '12px', background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                                    {alias}
                                                    {!isReadOnly && <button type="button" onClick={() => handleRemoveAlias(alias)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.7rem', padding: 0, lineHeight: 1, opacity: 0.6 }} onMouseEnter={e => (e.currentTarget.style.opacity = '1')} onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}>×</button>}
                                                </span>
                                            ))}
                                            {aliases.length === 0 && (
                                                <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic' }}>No aliases.</div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="editor-section" style={{ margin: 0 }}>
                                        <div className="editor-section-title">Known Character Names ({Object.keys(knownCharacterNames).length})</div>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Which other characters' names/aliases this character knows.{!isReadOnly && ' Select a character, then choose the name variant they know.'}</div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto', marginBottom: '8px' }}>
                                            {Object.entries(knownCharacterNames).map(([charId, nameVariants]) => {
                                                const targetChar = allCharacters.find(c => c.id === charId);
                                                const displayName = targetChar?.name || charId.substring(0, 8);
                                                return (
                                                    <div key={charId} style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                            <span style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>{displayName}</span>
                                                            {!isReadOnly && <button type="button" onClick={() => handleRemoveAllKnownName(charId)} className="toolbar-button" style={{ fontSize: '0.55rem', padding: '1px 5px', color: '#ff4444' }} title="Remove all">×</button>}
                                                        </div>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                                            {nameVariants.map(variant => (
                                                                <span key={variant} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '1px 6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', fontSize: '0.6rem' }}>
                                                                    {variant}
                                                                    {!isReadOnly && <button type="button" onClick={() => handleRemoveKnownName(charId, variant)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff4444', fontSize: '0.6rem', padding: 0, lineHeight: 1 }}>×</button>}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {Object.keys(knownCharacterNames).length === 0 && (
                                                <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic' }}>No known names configured.</div>
                                            )}
                                        </div>

                                        {!isReadOnly && (
                                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                <select
                                                    className="editor-select"
                                                    value={selectedCharForKnownName}
                                                    onChange={e => handleCharacterSelectForKnownName(e.target.value)}
                                                    disabled={isUploading || otherCharacters.length === 0}
                                                    style={{ flex: 1, fontSize: '0.7rem' }}
                                                >
                                                    <option value="">Select character...</option>
                                                    {otherCharacters.map(c => (
                                                        <option key={c.id} value={c.id}>{c.name}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    className="editor-select"
                                                    value={selectedAliasForKnownName}
                                                    onChange={e => handleAliasSelectForKnownName(e.target.value)}
                                                    disabled={isUploading || !selectedCharForKnownName || selectedCharAliases.length === 0}
                                                    style={{ flex: 1, fontSize: '0.7rem' }}
                                                >
                                                    <option value="">Select name/alias...</option>
                                                    {selectedCharAliases.map(alias => (
                                                        <option key={alias} value={alias}>{alias}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {otherCharacters.length === 0 && (
                                            <div style={{ fontSize: '0.6rem', opacity: 0.4, fontStyle: 'italic', marginTop: '4px' }}>No other characters available.</div>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowDialoguePromptEditor(true)} disabled={isUploading || isReadOnly} style={{ flex: 1 }}>Dialogue ({dialoguePrompts.length})</button>
                                        <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowKnowledgePromptEditor(true)} disabled={isUploading || isReadOnly} style={{ flex: 1 }}>Knowledge ({knowledgePrompts.length})</button>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowClothingEditor(true)} disabled={isUploading || isReadOnly} style={{ flex: 1 }}>Clothing ({clothings.length})</button>
                                        <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowTextInjectionEditor(true)} disabled={isUploading || isReadOnly} style={{ flex: 1 }}>Text Injection ({textCharacterInjections.length})</button>
                                    </div>

                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <button type="button" className="editor-button editor-button-cancel" onClick={() => setShowMemoryManager(true)} disabled={isUploading || isReadOnly} style={{ flex: 1 }}>Memory ({memoryCount})</button>
                                    </div>

                                    <div className="editor-section" style={{ margin: 0 }}>
                                        <span className="editor-section-title">Prompt Decay</span>
                                        <div style={{ fontSize: '0.6rem', opacity: 0.5, marginBottom: '12px' }}>
                                            Prompts are automatically removed from context after the character has sent this many messages.{!isReadOnly && ' Set to 0 to disable immediately, or leave high to keep them active longer.'}
                                        </div>
                                        <div className="editor-stats-grid">
                                            <div>
                                                <label className="editor-label editor-label-small">Think Prompt</label>
                                                <input type="number" step="1" min="0" value={numberOfMessagesToDisableThinkPromptStr} onChange={(e) => setNumberOfMessagesToDisableThinkPromptStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Meta-Think Instructions</label>
                                                <input type="number" step="1" min="0" value={numberOfMessagesToDisableMetaThinkInstructionsStr} onChange={(e) => setNumberOfMessagesToDisableMetaThinkInstructionsStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Dialogue Prompt</label>
                                                <input type="number" step="1" min="0" value={numberOfMessagesToDisableDialoguePromptStr} onChange={(e) => setNumberOfMessagesToDisableDialoguePromptStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Starter Prompt</label>
                                                <input type="number" step="1" min="0" value={numberOfMessagesToDisableStarterPromptStr} onChange={(e) => setNumberOfMessagesToDisableStarterPromptStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* ✅ Added Semantic Memory & Search Section */}
                                    <div className="editor-section" style={{ margin: 0 }}>
                                        <span className="editor-section-title">Semantic Memory & Search (Embeddings)</span>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '8px' }}>
                                            Use the local embedding model for smart context retrieval.
                                        </div>
                                        <label className="editor-checkbox-label">
                                            <input type="checkbox" checked={useEmbeddingModelForDialoguePrompts} onChange={(e) => setUseEmbeddingModelForDialoguePrompts(e.target.checked)} className="editor-checkbox-input" disabled={isUploading || isReadOnly} />
                                            <span>Use Embeddings for Dialogue Prompts</span>
                                        </label>
                                        <label className="editor-checkbox-label">
                                            <input type="checkbox" checked={useEmbeddingModelForStarterPrompts} onChange={(e) => setUseEmbeddingModelForStarterPrompts(e.target.checked)} className="editor-checkbox-input" disabled={isUploading || isReadOnly} />
                                            <span>Use Embeddings for Starter Prompts</span>
                                        </label>
                                        <label className="editor-checkbox-label">
                                            <input type="checkbox" checked={useEmbeddingModelForKnowledgePrompts} onChange={(e) => setUseEmbeddingModelForKnowledgePrompts(e.target.checked)} className="editor-checkbox-input" disabled={isUploading || isReadOnly} />
                                            <span>Use Embeddings for Knowledge Prompts</span>
                                        </label>
                                        <label className="editor-checkbox-label">
                                            <input type="checkbox" checked={useEmbeddingModelForMemories} onChange={(e) => setUseEmbeddingModelForMemories(e.target.checked)} className="editor-checkbox-input" disabled={isUploading || isReadOnly} />
                                            <span>Use Embeddings for Memories</span>
                                        </label>

                                        {/* ✅ Added Memory Search Spaces */}
                                        <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                                            <span style={{ fontWeight: 'bold', fontSize: '0.7rem' }}>Memory Search Spaces</span>
                                            <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>
                                                Which entities' memories to recall when the character searches their memory.
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {([
                                                    'self',
                                                    'listener',
                                                    'co-located protagonists',
                                                    'non-co-located protagonists',
                                                    'co-located non-protagonists',
                                                    'non-co-located non-protagonists'
                                                ] as memorySearchSpace[]).map(space => (
                                                    <label key={space} className="editor-checkbox-label">
                                                        <input 
                                                            type="checkbox" 
                                                            checked={memorySearchSpaces.includes(space)} 
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setMemorySearchSpaces(prev => [...prev, space]);
                                                                } else {
                                                                    setMemorySearchSpaces(prev => prev.filter(s => s !== space));
                                                                }
                                                            }} 
                                                            className="editor-checkbox-input" 
                                                            disabled={isUploading || isReadOnly} 
                                                        />
                                                        <span style={{ textTransform: 'capitalize' }}>{space}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'stats' && (
                                <>
                                    <div className="editor-section">
                                        <span className="editor-section-title">Turn Order & Output</span>
                                        <div className="editor-stats-grid">
                                            <div>
                                                <label className="editor-label editor-label-small">Initiative Weight</label>
                                                <input type="number" step="0.1" value={initiativeWeightStr} onChange={(e) => setInitiativeWeightStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls the character's initiative when determining turn order. Range: 0 - ∞.</div>
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Chat Probability</label>
                                                <input type="number" step="0.05" value={chatProbabilityStr} onChange={(e) => setChatProbabilityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls the probability of the character initiating a chat message when selected. Range: 0 - 1.</div>
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Maximum Chat Stamina</label>
                                                <input type="number" step="1" min="0" value={maximumChatStaminaStr} onChange={(e) => setMaximumChatStaminaStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls the number of maximum paragraphs that the character could produce. Range: 0 - ∞.</div>
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Chat Stamina Regen</label>
                                                <input type="number" step="0.01" min="0" value={chatStaminaRegenerationRateStr} onChange={(e) => setChatStaminaRegenerationRateStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Stamina regenerated per second. Default is 0.3.</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="editor-section">
                                        <span className="editor-section-title">Responsiveness</span>
                                        <div className="editor-stats-grid">
                                            <div>
                                                <label className="editor-label editor-label-small">Name Sensitivity</label>
                                                <input type="number" step="0.5" min="0" value={nameSensitivityStr} onChange={(e) => setNameSensitivityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how likely the character is to be the first one to respond to the latest message. Multiplied by mention count. 0 = off.</div>
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Chat Impatience</label>
                                                <input type="number" step="0.1" min="0" value={chatImpatienceSensitivityStr} onChange={(e) => setChatImpatienceSensitivityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how impatient the character is after waiting to speak for too long. Higher = speaks sooner after being quiet. 0 = off.</div>
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Skip Probability</label>
                                                <input type="number" step="0.05" min="0" max="1" value={skipProbabilityStr} onChange={(e) => setSkipProbabilityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Probability of skipping an action. Range: 0 - 1.</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="editor-section">
                                        <span className="editor-section-title">Awareness & Actions</span>
                                        <div className="editor-stats-grid">
                                            <div>
                                                <label className="editor-label editor-label-small">Memory Retention</label>
                                                <input type="number" step="0.1" min="0" value={memoryRetentionWeightStr} onChange={(e) => setMemoryRetentionWeightStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how much of the character's memory is retained. Range: 0 - 1.</div>
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Context Sensitivity</label>
                                                <input type="number" step="0.1" min="0" value={contextSensitivityStr} onChange={(e) => setContextSensitivityStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how sensitive the character is to contextual cues. Range: 0 - 1.</div>
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Maximum Action Stamina</label>
                                                <input type="number" step="1" min="0" value={maximumActionStaminaStr} onChange={(e) => setMaximumActionStaminaStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Controls how many silent actions, movement, or non-chat interactions the character can perform before needing to rest. Range: 0 - ∞.</div>
                                            </div>
                                            <div>
                                                <label className="editor-label editor-label-small">Action Stamina Regen</label>
                                                <input type="number" step="0.01" min="0" value={actionStaminaRegenerationRateStr} onChange={(e) => setActionStaminaRegenerationRateStr(e.target.value)} className="editor-input editor-stat-input" disabled={isUploading || isReadOnly} />
                                                <div style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: '2px' }}>Stamina regenerated per second. Default is 0.03.</div>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}

                            {activeTab === 'tools' && (
                                <div className="editor-section">
                                    <span className="editor-section-title">Character Tools</span>
                                    <div style={{ fontSize: '0.65rem', opacity: 0.6, marginBottom: '8px' }}>
                                        Enable runtime tool use during generation for this character. Can be overridden by profile settings.
                                    </div>

                                    {!isReadOnly && (
                                        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                            <button type="button" className="editor-bulk-action-button" onClick={handleSelectAllTools} disabled={isUploading}>
                                                <span style={{ fontSize: '0.9rem' }}>✓</span> Select All
                                            </button>
                                            <button type="button" className="editor-bulk-action-button" onClick={handleAutoDetectTools} disabled={isUploading} title="Scan character name, description, and system prompt for tool keywords">
                                                <span style={{ fontSize: '0.9rem' }}>🔍</span> Auto-Detect
                                            </button>
                                            <button type="button" className="editor-bulk-action-button" onClick={handleDeselectAllTools} disabled={isUploading}>
                                                <span style={{ fontSize: '0.9rem' }}>✗</span> Deselect All
                                            </button>
                                        </div>
                                    )}

                                    <input type="text" value={toolSearchQuery} readOnly={isReadOnly} onChange={e => setToolSearchQuery(e.target.value)} className="editor-input" placeholder="Search tools..." style={{ marginBottom: '12px', fontSize: '0.75rem', padding: '6px 10px' }} disabled={isUploading || isReadOnly} />

                                    {filteredToolNames.length === 0 && (
                                        <div style={{ fontSize: '0.7rem', opacity: 0.5, fontStyle: 'italic', padding: '8px 0' }}>No tools match "{toolSearchQuery}".</div>
                                    )}

                                    {filteredToolNames.map(toolName => (
                                        <div key={toolName} style={{ marginBottom: '8px' }}>
                                            <label className="editor-checkbox-label">
                                                <input type="checkbox" checked={tools[toolName]} onChange={() => handleToolToggle(toolName)} className="editor-checkbox-input" disabled={isUploading || isReadOnly} />
                                                <span>{toolLabels[toolName] ?? toolName}</span>
                                            </label>
                                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px', marginLeft: '26px' }}>
                                                {characterToolDescriptions[toolName] ?? 'Allow this character to use this tool.'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* ✅ Dual Samplers, Retrieval Configurations & Stop Patterns */}
                            {activeTab === 'model' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div className="editor-section">
                                        <span className="editor-section-title">Language Model Sampler (Text Generation)</span>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Controls the psychological profile, vocabulary choice, and text generation logic.</div>
                                        <select value={selectedLanguageModelSamplerId} onChange={(e) => setSelectedLanguageModelSamplerId(e.target.value)} className={`editor-select ${isLoadingSamplers || isUploading ? 'editor-select-loading' : ''}`} disabled={isLoadingSamplers || isUploading || isReadOnly}>
                                            {isLoadingSamplers && <option>Loading samplers...</option>}
                                            {!isLoadingSamplers && allSamplers.length === 0 && <option>No samplers available</option>}
                                            {!isLoadingSamplers && allSamplers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                        </select>
                                    </div>

                                    <div className="editor-section">
                                        <span className="editor-section-title">Text-to-Speech Model Sampler (Voice Generation)</span>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Controls the vocal cords, prosody, pitch, and acoustic expressiveness of the character's voice.</div>
                                        <select value={selectedTextToSpeechModelSamplerId} onChange={(e) => setSelectedTextToSpeechModelSamplerId(e.target.value)} className={`editor-select ${isLoadingSamplers || isUploading ? 'editor-select-loading' : ''}`} disabled={isLoadingSamplers || isUploading || isReadOnly}>
                                            {isLoadingSamplers && <option>Loading samplers...</option>}
                                            {!isLoadingSamplers && allSamplers.length === 0 && <option>No samplers available</option>}
                                            {!isLoadingSamplers && allSamplers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
                                        </select>
                                    </div>

                                    {/* ✅ ADDED RETRIEVAL CONFIGURATIONS */}
                                    <div className="editor-section">
                                        <span className="editor-section-title">Dialogue Retrieval Configuration</span>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Controls semantic search parameters (Top-K, Threshold, Token Budget) for dialogue prompts.</div>
                                        <select value={selectedDialogueRetrievalConfigurationId} onChange={(e) => setSelectedDialogueRetrievalConfigurationId(e.target.value)} className="editor-select" disabled={isUploading || isReadOnly}>
                                            <option value="">None</option>
                                            {allRetrievalConfigurations.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                        </select>
                                    </div>

                                    <div className="editor-section">
                                        <span className="editor-section-title">Starter Prompt Retrieval Configuration</span>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Controls semantic search parameters for starter prompts.</div>
                                        <select value={selectedStarterPromptRetrievalConfigurationId} onChange={(e) => setSelectedStarterPromptRetrievalConfigurationId(e.target.value)} className="editor-select" disabled={isUploading || isReadOnly}>
                                            <option value="">None</option>
                                            {allRetrievalConfigurations.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                        </select>
                                    </div>

                                    <div className="editor-section">
                                        <span className="editor-section-title">Knowledge Retrieval Configuration</span>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Controls semantic search parameters for knowledge prompts.</div>
                                        <select value={selectedKnowledgeRetrievalConfigurationId} onChange={(e) => setSelectedKnowledgeRetrievalConfigurationId(e.target.value)} className="editor-select" disabled={isUploading || isReadOnly}>
                                            <option value="">None</option>
                                            {allRetrievalConfigurations.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                        </select>
                                    </div>

                                    <div className="editor-section">
                                        <span className="editor-section-title">Memory Retrieval Configuration</span>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '6px' }}>Controls semantic search parameters for memories.</div>
                                        <select value={selectedMemoryRetrievalConfigurationId} onChange={(e) => setSelectedMemoryRetrievalConfigurationId(e.target.value)} className="editor-select" disabled={isUploading || isReadOnly}>
                                            <option value="">None</option>
                                            {allRetrievalConfigurations.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                        </select>
                                    </div>

                                    <div className="editor-section">
                                        <span className="editor-section-title">Character Stop Patterns</span>
                                        <div className="editor-stop-patterns-hint">Specific stop sequences for this character, overrides or augments sampler defaults.</div>

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
                                                        {!isReadOnly && <button type="button" onClick={() => handleStopPatternToggle(id)} className="sampler-stop-remove-button" title="Remove stop pattern">×</button>}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {!isReadOnly && (
                                            <select onChange={(e) => { const val = e.target.value; if (val) handleStopPatternToggle(val); e.target.value = ''; }} className="editor-select" defaultValue="" disabled={isUploading}>
                                                <option value="" disabled>+ Add a stop pattern</option>
                                                {allSamplers
                                                    .flatMap(s => s.stopPatterns)
                                                    .filter((sp, index, self) => index === self.findIndex(t => t.id === sp.id))
                                                    .filter(sp => !selectedStopPatternIds.includes(sp.id))
                                                    .map(sp => (<option key={sp.id} value={sp.id}>{sp.name} — {sp.pattern}</option>))}
                                            </select>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'quick-config' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div className="editor-section" style={{ margin: 0 }}>
                                        <span className="editor-section-title">{isReadOnly ? 'Known Names' : 'Knowledge Shortcuts'}</span>
                                        <div style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: '8px' }}>
                                            {isReadOnly ? 'Known names/aliases' : 'Batch-add known names/aliases'} for this character's knowledge.{!isReadOnly && ' Merges with existing entries; never overwrites.'}
                                        </div>

                                        {!hasSession && (
                                            <div style={{ fontSize: '0.65rem', opacity: 0.8, fontStyle: 'italic', padding: '8px 10px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px', marginBottom: '8px', border: '1px solid rgba(255,255,205,0.08)' }}>
                                                ℹ️ Start a chat session to enable protagonist and participant shortcuts.
                                            </div>
                                        )}
                                        {hasSession && !hasParticipants && (
                                            <div style={{ fontSize: '0.65rem', opacity: 0.8, fontStyle: 'italic', padding: '8px 10px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px', marginBottom: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                ℹ️ No other characters in the current session.{!isReadOnly && ' Add participants to the chat to enable those shortcuts.'}
                                            </div>
                                        )}
                                        {allCharacters.length === 0 && (
                                            <div style={{ fontSize: '0.65rem', opacity: 0.8, fontStyle: 'italic', padding: '8px 10px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '6px', marginBottom: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                ℹ️ No characters available in the global registry.
                                            </div>
                                        )}

                                        {quickConfigFeedback && (
                                            <div style={{ padding: '8px 10px', background: quickConfigFeedback.addedNames.length > 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255, 255, 255, 0.05)', border: `1px solid ${quickConfigFeedback.addedNames.length > 0 ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`, borderRadius: '6px', marginBottom: '8px' }}>
                                                <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '4px', color: quickConfigFeedback.addedNames.length > 0 ? '#22c55e' : 'var(--text-h)' }}>
                                                    {quickConfigFeedback.addedNames.length > 0 ? `✓ ${quickConfigFeedback.label}` : `ℹ️ ${quickConfigFeedback.label}`}
                                                </div>
                                                {quickConfigFeedback.addedNames.length > 0 && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '120px', overflowY: 'auto' }}>
                                                        {quickConfigFeedback.addedNames.map(entry => (
                                                            <div key={entry.charName} style={{ fontSize: '0.6rem', opacity: 0.8 }}>
                                                                <span style={{ fontWeight: 'bold', opacity: 1 }}>{entry.charName}:</span>{' '}
                                                                <span style={{ opacity: 0.7 }}>{entry.names.join(', ')}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            {!isReadOnly && <button type="button" className="editor-button editor-button-cancel" onClick={handleRevertKnownNames} disabled={isUploading} title="Revert known names to their state before opening this editor" style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>↩️ Revert Known Names to Original</button>}
                                            <button type="button" className="editor-button editor-button-cancel" onClick={handleKnowCurrentProtagonist} disabled={isUploading || isReadOnly || !hasLocalProtagonist} title={!hasLocalProtagonist ? 'No active local protagonist' : 'Add current protagonist name + aliases'} style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>🎯 Know Current Protagonist's Names</button>
                                            <button type="button" className="editor-button editor-button-cancel" onClick={handleKnowCoLocatedProtagonists} disabled={isUploading || isReadOnly || !hasSession || coLocatedProtagonistCount === 0} title={!hasSession ? 'No active session' : coLocatedProtagonistCount === 0 ? 'No co-located protagonists' : `Add ${coLocatedProtagonistCount} co-located protagonist(s) names`} style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>📍 Know Co-Located Protagonists' Names {coLocatedProtagonistCount > 0 && `(${coLocatedProtagonistCount})`}</button>
                                            <button type="button" className="editor-button editor-button-cancel" onClick={handleKnowAllProtagonists} disabled={isUploading || isReadOnly || !hasSession || !hasProtagonists} title={!hasSession ? 'No active session' : 'Add all protagonists names + aliases'} style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>👥 Know All The Protagonists' Names</button>
                                            <button type="button" className="editor-button editor-button-cancel" onClick={handleKnowCoLocatedParticipants} disabled={isUploading || isReadOnly || !hasSession || coLocatedParticipantCount === 0} title={!hasSession ? 'No active session' : coLocatedParticipantCount === 0 ? 'No co-located participants' : `Add ${coLocatedParticipantCount} co-located participant(s) names`} style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>📍 Know Co-Located Participants' Names {coLocatedParticipantCount > 0 && `(${coLocatedParticipantCount})`}</button>
                                            <button type="button" className="editor-button editor-button-cancel" onClick={handleKnowAllParticipants} disabled={isUploading || isReadOnly || !hasSession || !hasParticipants} title={!hasSession ? 'No active session' : 'Add all session participants names + aliases'} style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>🎭 Know All Participants' Names</button>
                                            <button type="button" className="editor-button editor-button-cancel" onClick={handleKnowAllCharacters} disabled={isUploading || isReadOnly || allCharacters.length === 0} title="Add every character in the global registry" style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>🌐 Know All Characters' Names</button>
                                        </div>
                                    </div>

                                    <div className="editor-section" style={{ margin: 0 }}>
                                        <span className="editor-section-title">Automated Utilities</span>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <button type="button" className="editor-button editor-button-cancel" onClick={handleAutoDetectStats} disabled={isUploading || isReadOnly} title="Re-run auto-detection on name + description + system prompt" style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>🔍 Auto-Detect Stats from Prompts</button>
                                            <button type="button" className="editor-button editor-button-cancel" onClick={handleAutoDetectTools} disabled={isUploading || isReadOnly} title="Auto-detect tools and configure permissions based on character prompts" style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>🛡️ Auto-Detect Tools & Permissions</button>
                                            <button type="button" className="editor-button editor-button-cancel" onClick={handleResetStatsToDefaults} disabled={isUploading || isReadOnly} title="Reset all stats to their default values" style={{ fontSize: '0.7rem', textAlign: 'left', padding: '6px 10px' }}>↩️ Reset Stats to Defaults</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </FileDropArea>
                </div>
            </div>

            {showToolPermissionModal && detectedToolsForModal && (
                <ToolPermissionModal
                    characterName={name || 'This Character'}
                    detectedTools={detectedToolsForModal}
                    onClose={() => setShowToolPermissionModal(false)}
                    onConfirm={(grantedTools) => {
                        setTools(prev => ({
                            ...prev,
                            ...grantedTools,
                        }));
                        setShowToolPermissionModal(false);
                    }}
                />
            )}

            {showImageEditor && (
                <CharacterImageEditorModal
                    onClose={() => setShowImageEditor(false)}
                    characterId={effectiveCharacterId}
                    images={emotionImages}
                    onSave={(updatedImages) => {
                        setEmotionImages(updatedImages);
                        const neutral = updatedImages.neutral;
                        if (neutral) { 
                            setImagePreview(getCharacterImageUrl(effectiveCharacterId, neutral)); 
                            setImageFile(null); 
                        } else if (!imageFile) { 
                            setImagePreview(null); 
                        }
                    }}
                    isReadOnly={isReadOnly}
                />
            )}

            {showClothingEditor && (
                <CharacterClothingEditorModal
                    onClose={() => setShowClothingEditor(false)}
                    clothings={clothings}
                    onSaveClothings={setClothings}
                    isReadOnly={isReadOnly}
                />
            )}

            {showDialoguePromptEditor && (
                <CharacterDialoguePromptEditorModal
                    onClose={() => setShowDialoguePromptEditor(false)}
                    dialoguePrompts={dialoguePrompts}
                    onSaveDialoguePrompts={setDialoguePrompts}
                    isReadOnly={isReadOnly}
                />
            )}

            {showKnowledgePromptEditor && (
                <CharacterKnowledgePromptEditorModal
                    onClose={() => setShowKnowledgePromptEditor(false)}
                    knowledgePrompts={knowledgePrompts}
                    onSaveKnowledgePrompts={setKnowledgePrompts}
                    isReadOnly={isReadOnly}
                />
            )}

            {/* ✅ Added Starter Prompt Editor Modal */}
            {showStarterPromptEditor && (
                <CharacterStarterPromptEditorModal
                    onClose={() => setShowStarterPromptEditor(false)}
                    starterPrompts={starterPrompts}
                    onSaveStarterPrompts={setStarterPrompts}
                    isReadOnly={isReadOnly}
                />
            )}

            {showTextInjectionEditor && (
                <CharacterTextCharacterInjectionEditorModal
                    onClose={() => setShowTextInjectionEditor(false)}
                    injections={textCharacterInjections}
                    onSaveInjections={setTextCharacterInjections}
                    isReadOnly={isReadOnly}
                />
            )}

            {showMemoryManager && existingCharacter && (
                <CharacterMemoryEditorModal
                    onClose={() => setShowMemoryManager(false)}
                    character={existingCharacter || null}
                    onSaveMemories={setMemories}
                    allCharacters={allCharacters}
                    allRawInteractionDataShells={allRawInteractionDataShells}
                    localProtagonistId={localProtagonistId}
                />
            )}
        </>
    );
}
