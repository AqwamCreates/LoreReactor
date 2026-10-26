// src/frontend_src/components/AppModals.tsx
import { useMemo, useState, useEffect, useCallback } from 'react';
import type {
    Character, Context, Location, Sampler, StopPattern, RetrievalConfiguration,
    LanguageModel, SpatiotemporalModel, BudgetStrategy, Profile, Extension,
    InteractionData, World, AudioTrack, PromptBlock,
    RawInteractionData, Memory, MultiplayerData, Account,
    EntityFolder,
    cloudBackend, entityType
} from '../types';
import type { PendingJoinRequest } from '../hooks/useMultiplayerSync';
import type { ModalController } from '../hooks/useAppModals';
import { loadRawInteractionData } from '../storages/serverStorage';
import { isChatSaveable } from '../utilities/chatSaveHelper';
import { ManagerModal } from './ManagerModal';
import {
    renderLanguageModelSubtext, renderBudgetStrategySubtext, renderProfileSubtext, 
    renderInteractionDataSubtext, renderContextSubtext, renderLocationSubtext, renderExtensionSubtext
} from './renderHelpers';
import { cloudBackends } from '../dictionaries/languageModelInformation';

import { useChatStore } from '../hooks/useChatStore';

import { CharacterEditorModal } from './CharacterEditorModal';
import { LanguageModelEditorModal } from './LanguageModelEditorModal';
import { SpatiotemporalLanguageModelEditorModal } from './SpatiotemporalLanguageModelEditorModal';
import { SamplerEditorModal } from './SamplerEditorModal';
import { PromptBlockEditorModal } from './PromptBlockEditorModal';
import { ContextEditorModal } from './ContextEditorModal';
import { LocationEditorModal } from './LocationEditorModal';
import { AudioTrackEditorModal } from './AudioTrackEditorModal';
import { StopPatternEditorModal } from './StopPatternEditorModal';
import { RetrievalConfigurationEditorModal } from './RetrievalConfigurationEditorModal';
import { BudgetStrategyEditorModal } from './BudgetStrategyEditorModal';
import { ProfileEditorModal } from './ProfileEditorModal';
import { AccountEditorModal } from './AccountEditorModal';
import { MultiplayerEditorModal } from './MultiplayerEditorModal';
import { SettingsModal } from './SettingsModal';
import { JoinSessionModal } from './JoinSessionModal';
import { BudgetControlModal } from './BudgetControlModal';
import { GpuMonitorModal } from './GpuMonitorModal';
import { WorldEditorModal } from './WorldEditorModal';
import { ParticipantControlModal } from './ParticipantControlModal';
import { AIRecommendationModal } from './AIRecommendationModal';
import { RestrictionReductionModal } from './RestrictionReductionModal';
import { PromptGuideModal } from './PromptGuideModal';
import { CharacterCardImportModal } from './CharacterCardImportModal';
import { DataImportModal } from './DataImportModal';
import { DataExportModal } from './DataExportModal';
import { DataManagerModal } from './DataManagerModal';
import { AlternateTimelinesModal } from './AlternateTimelinesModal';
import { InteractionDataInspectionModal } from './InteractionDataInspectionModal';
import { SuperSearchModal } from './SuperSearchModal';
import { ModelInferenceManagerModal } from './ModelInferenceManager';
import { voiceTranscriptionEngine } from '../services/VoiceTranscriptionEngine';
import { embeddingQueue } from '../services/EmbeddingQueue';
import { getCurrentLocationId, getReachableLocationsByCharacter } from '../utilities/locationLogic';

interface EntityModalController {
    isOpen: boolean;
    item: any | null;
    isReadOnly: boolean;
    open: (item?: any, isReadOnly?: boolean) => void;
    close: () => void;
    save: (item: any) => Promise<void>;
    delete: (identifier: string) => Promise<void>;
}

interface ApplicationModalsProperties {
    isMultiplayerClient?: boolean;
    modals: Record<string, ModalController>;
    entityModals: {
        getModalProperties: (entityType: entityType) => EntityModalController;
    };
    runningLanguageModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    runningSpatiotemporalModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    allRawInteractionDataShells: RawInteractionData[];
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allPromptBlocks: PromptBlock[];
    allLanguageModels: LanguageModel[];
    allSpatiotemporalModels: SpatiotemporalModel[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allRetrievalConfigurations: RetrievalConfiguration[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allExtensions: Extension[];
    allWorlds: World[];
    allMemories: Memory[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    
    allEntityFolders: EntityFolder[];
    onSaveEntityFolder: (folder: EntityFolder) => Promise<boolean>;
    onDeleteEntityFolder: (identifier: string) => void;

    onSwitchChat: (identifier: string) => void;
    onDeleteInteractionData: (identifier: string) => void;
    onNewInteractionData: () => void;
    onRenameInteractionData: (identifier: string, name: string) => void;
    onDeleteCharacter: (identifier: string) => void;
    onLoadFullCharacter: (identifier: string) => Promise<Character | null>;
    onToggleParticipant: (identifier: string) => void;
    onSetProtagonist: (identifier: string) => void;
    onSaveCharacter: (character: Character) => void;
    onDeleteContext: (identifier: string) => void;
    onToggleContext: (identifier: string) => void;
    onSaveContext: (context: Context) => void;
    onDeleteLocation: (identifier: string) => void;
    onToggleLocation: (identifier: string) => void;
    onSaveLocation: (location: Location) => void;
    onMoveProtagonist?: (location: Location) => void;
    onDeleteAudioTrack: (identifier: string) => void;
    onToggleAudioTrack: (identifier: string) => void;
    onSaveAudioTrack: (audioTrack: AudioTrack) => void;
    onDeletePromptBlock: (identifier: string) => void;
    onDeleteModel: (identifier: string) => void;
    onToggleModelLoad: (identifier: string) => void;
    onDeleteSpatiotemporalModel: (identifier: string) => void;
    onToggleSpatiotemporalModelLoad: (identifier: string) => void;
    onDeleteSampler: (identifier: string) => void;
    onDeleteStopPattern: (identifier: string) => void;
    onDeleteRetrievalConfiguration: (identifier: string) => void;
    onDeleteBudgetStrategy: (identifier: string) => void;
    onActivateBudgetStrategy: (identifier: string) => void;
    onDeleteProfile: (identifier: string) => void;
    onActivateProfile: (identifier: string) => void;
    onSaveProfile: (profile: Profile) => void;
    onDeleteExtension: (identifier: string) => void;
    onToggleExtension: (identifier: string) => void;
    onSaveWorld: (world: World) => void;
    onToggleWorlds?: (worlds: World[]) => void;
    onDeleteWorld: (identifier: string) => void;
    onDeleteMemory: (identifier: string) => void;
    onDeleteAccount: (identifier: string) => void;
    onToggleAccount: (identifier: string) => void;
    onDeleteMultiplayerData: (identifier: string) => void;
    onJoinSession: (sessionId: string, password: string, requestedCharacterIdentifier: string | null, requestedCharacterData: Character | null) => void;
    onUpdateInteractionData: (data: InteractionData) => void;
    onForceFirstMessage: (character: Character) => void;
    onSendCustomMessage: (character: Character, text: string) => void;
    onInjectCustomMessage: (character: Character, text: string) => void;
    onInjectFirstMessage: (character: Character) => void;
    onImportComplete: () => void;
    addToast: (message: string, type: 'success' | 'error' | 'info') => void;
    ensureChatsLoaded: () => void;
    pendingJoinRequests?: PendingJoinRequest[];
    onAcceptJoinRequest?: (accountId: string) => void;
    onRejectJoinRequest?: (accountId: string) => void;
}

type ChatShellWithIdentifier = RawInteractionData & { id: string };

function deriveLocalProtagonistId(
    interactionData: InteractionData | null,
    multiplayerData: MultiplayerData | null,
    currentAccountId: string | null,
): string | null {
    if (!interactionData) return null;

    if (multiplayerData && currentAccountId) {
        const protagonistCharacterIdentifier = multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.protagonistCharacterId;
        if (protagonistCharacterIdentifier) {
            const isProtagonist = interactionData.protagonistIds?.includes(protagonistCharacterIdentifier);
            const isParticipant = interactionData.participants?.some(p => p.id === protagonistCharacterIdentifier);
            if (isProtagonist || isParticipant) return protagonistCharacterIdentifier;
        }
    }

    if (interactionData.protagonistIds && interactionData.protagonistIds.length > 0) {
        return interactionData.protagonistIds[0];
    }

    return interactionData.participants?.[0]?.id ?? null;
}

export function AppModals({
    isMultiplayerClient = false,
    modals,
    entityModals,
    runningLanguageModels,
    runningSpatiotemporalModels,
    allRawInteractionDataShells,
    allCharacters,
    allContexts,
    allLocations,
    allAudioTracks,
    allSamplers,
    allStopPatterns,
    allRetrievalConfigurations,
    allLanguageModels,
    allSpatiotemporalModels,
    allBudgetStrategies,
    allProfiles,
    allExtensions,
    allWorlds,
    allPromptBlocks,
    allMemories,
    allAccounts,
    allMultiplayerData,
    allEntityFolders,
    onSaveEntityFolder,
    onDeleteEntityFolder,
    onSwitchChat,
    onDeleteInteractionData,
    onNewInteractionData,
    onRenameInteractionData,
    onDeleteCharacter,
    onLoadFullCharacter,
    onToggleParticipant,
    onSetProtagonist,
    onSaveCharacter,
    onDeleteContext,
    onToggleContext,
    onSaveContext,
    onDeleteLocation,
    onToggleLocation,
    onSaveLocation,
    onMoveProtagonist,
    onDeleteAudioTrack,
    onToggleAudioTrack,
    onSaveAudioTrack,
    onDeletePromptBlock,
    onDeleteModel,
    onToggleModelLoad,
    onDeleteSpatiotemporalModel,
    onToggleSpatiotemporalModelLoad,
    onDeleteSampler,
    onDeleteStopPattern,
    onDeleteRetrievalConfiguration,
    onDeleteBudgetStrategy,
    onActivateBudgetStrategy,
    onDeleteProfile,
    onActivateProfile,
    onSaveProfile,
    onDeleteExtension,
    onToggleExtension,
    onSaveWorld,
    onToggleWorlds,
    onDeleteWorld,
    onDeleteMemory,
    onDeleteAccount,
    onToggleAccount,
    onDeleteMultiplayerData,
    onJoinSession,
    onUpdateInteractionData,
    onForceFirstMessage,
    onSendCustomMessage,
    onInjectCustomMessage,
    onInjectFirstMessage,
    onImportComplete,
    addToast,
    ensureChatsLoaded,
    pendingJoinRequests,
    onAcceptJoinRequest,
    onRejectJoinRequest,
}: ApplicationModalsProperties) {
    const interactionData = useChatStore(state => state.interactionData);
    const activeStrategy = useChatStore(state => state.activeStrategy);
    const selectedModelId = useChatStore(state => state.selectedLanguageModel?.id ?? null);
    const selectedSpatiotemporalModelId = useChatStore(state => state.selectedSpatiotemporalModel?.id ?? null);
    const selectedBudgetStrategyId = useChatStore(state => state.activeStrategy?.id ?? null);
    const currentAccountId = useChatStore(state => state.currentAccountId);
    const multiplayerData = useChatStore(state => state.multiplayerData);

    const characterModalProperties = entityModals.getModalProperties('character');
    const contextModalProperties = entityModals.getModalProperties('context');
    const locationModalProperties = entityModals.getModalProperties('location');
    const audioTrackModalProperties = entityModals.getModalProperties('audioTrack');
    const worldModalProperties = entityModals.getModalProperties('world');
    const languageModelModalProperties = entityModals.getModalProperties('languageModel');
    const spatiotemporalModelModalProperties = entityModals.getModalProperties('spatiotemporalModel');
    const samplerModalProperties = entityModals.getModalProperties('sampler');
    const promptBlockModalProperties = entityModals.getModalProperties('promptBlock');
    const stopPatternModalProperties = entityModals.getModalProperties('stopPattern');
    const retrievalConfigurationModalProperties = entityModals.getModalProperties('retrievalConfiguration');
    const budgetStrategyModalProperties = entityModals.getModalProperties('budgetStrategy');
    const profileModalProperties = entityModals.getModalProperties('profile');
    const accountModalProperties = entityModals.getModalProperties('account');
    const multiplayerDataModalProperties = entityModals.getModalProperties('multiplayerData');

    const localProtagonistId = useMemo(
        () => deriveLocalProtagonistId(interactionData, multiplayerData, currentAccountId),
        [interactionData, multiplayerData, currentAccountId],
    );

    const localProtagonist = useMemo(() => {
        if (!interactionData || !localProtagonistId) return null;
        return interactionData.participants?.find(p => p.id === localProtagonistId)
            ?? allCharacters.find(c => c.id === localProtagonistId)
            ?? null;
    }, [interactionData, localProtagonistId, allCharacters]);

    const localProtagonistLocationId = useMemo(() => {
        if (!interactionData || !localProtagonist) return undefined;
        return getCurrentLocationId(interactionData, localProtagonist);
    }, [interactionData, localProtagonist]);

    const reachableLocationIds = useMemo(() => {
        if (!interactionData || !localProtagonist) return undefined;
        const reachable = getReachableLocationsByCharacter(interactionData, localProtagonist);
        return new Set(reachable.map(l => l.id));
    }, [interactionData, localProtagonist]);

    const effectiveTokenizerModel = useMemo(() => {
        if (selectedModelId) return allLanguageModels.find(model => model.id === selectedModelId) ?? null;
        return null;
    }, [selectedModelId, allLanguageModels]);

    const [aiCharacterSaveRedirect, setAiCharacterSaveRedirect] = useState<((character: Character) => void) | null>(null);
    const [aiContextSaveRedirect, setAiContextSaveRedirect] = useState<((context: Context) => void) | null>(null);
    const [aiLocationSaveRedirect, setAiLocationSaveRedirect] = useState<((location: Location) => void) | null>(null);
    const [aiAudioTrackSaveRedirect, setAiAudioTrackSaveRedirect] = useState<((audioTrack: AudioTrack) => void) | null>(null);
    const [aiPromptBlockSaveRedirect, setAiPromptBlockSaveRedirect] = useState<((promptBlock: PromptBlock) => void) | null>(null);
    const [aiProfileSaveRedirect, setAiProfileSaveRedirect] = useState<((profile: Profile) => void) | null>(null);

    const [inspectionStack, setInspectionStack] = useState<InteractionData[]>([]);

    // ─── Background Embedding Generation Handler ────────────────────
    const handleSaveCharacterWithEmbeddings = useCallback(async (character: Character) => {
        // 1. Save immediately so UI doesn't block
        await onSaveCharacter(character);
        
        // 2. Collect texts that need embedding (only if missing the embedding array)
        const tasks: Array<{ type: 'knowledge' | 'dialogue' | 'starter' | 'memory', id: string, text: string, chatId?: string }> = [];
        
        if (character.useEmbeddingModelForKnowledgePrompts && character.knowledgePrompts) {
            for (const kp of character.knowledgePrompts) {
                if (kp.textContent && !kp.embedding) tasks.push({ type: 'knowledge', id: kp.id, text: kp.textContent });
            }
        }
        if (character.useEmbeddingModelForDialoguePrompts && character.dialoguePrompts) {
            for (const dp of character.dialoguePrompts) {
                if (dp.textContent && !dp.embedding) tasks.push({ type: 'dialogue', id: dp.id, text: dp.textContent });
            }
        }
        if (character.useEmbeddingModelForStarterPrompts && character.starterPrompts) {
            for (const sp of character.starterPrompts) {
                if (sp.textContent && !sp.embedding) tasks.push({ type: 'starter', id: sp.id, text: sp.textContent });
            }
        }
        if (character.useEmbeddingModelForMemories && character.memories) {
            for (const [chatId, mems] of Object.entries(character.memories)) {
                for (const mem of mems) {
                    if (mem.textContent && !mem.embedding) tasks.push({ type: 'memory', id: mem.id, text: mem.textContent, chatId });
                }
            }
        }
        
        if (tasks.length === 0) return;
        
        addToast(`🧠 Generating ${tasks.length} embeddings in background...`, 'info');
        
        // 3. Deep clone to safely mutate without affecting the Zustand store reference mid-flight
        const updatedCharacter = JSON.parse(JSON.stringify(character)) as Character;
        let completed = 0;
        
        for (const task of tasks) {
            const embedding = await embeddingQueue.enqueue(task.id, task.text);
            if (embedding) {
                if (task.type === 'knowledge' && updatedCharacter.knowledgePrompts) {
                    updatedCharacter.knowledgePrompts = updatedCharacter.knowledgePrompts.map(kp => 
                        kp.id === task.id ? { ...kp, embedding } : kp
                    );
                } else if (task.type === 'dialogue' && updatedCharacter.dialoguePrompts) {
                    updatedCharacter.dialoguePrompts = updatedCharacter.dialoguePrompts.map(dp => 
                        dp.id === task.id ? { ...dp, embedding } : dp
                    );
                } else if (task.type === 'starter' && updatedCharacter.starterPrompts) {
                    updatedCharacter.starterPrompts = updatedCharacter.starterPrompts.map(sp => 
                        sp.id === task.id ? { ...sp, embedding } : sp
                    );
                } else if (task.type === 'memory' && updatedCharacter.memories && task.chatId) {
                    updatedCharacter.memories[task.chatId] = updatedCharacter.memories[task.chatId].map(mem => 
                        mem.id === task.id ? { ...mem, embedding } : mem
                    );
                }
                completed++;
            }
        }
        
        // 4. Save the updated character with embeddings back to the DB
        if (completed > 0) {
            await onSaveCharacter(updatedCharacter);
            addToast(`✅ Generated ${completed} embeddings for ${character.name}`, 'success');
        }
    }, [onSaveCharacter, addToast]);

    const handleBackgroundVoiceTranscribe = useCallback((characterId: string, file: File, language?: string) => {
        addToast("Transcribing voice in background...", 'info');
        
        voiceTranscriptionEngine.enqueueTranscription(characterId, file, language)
            .then(result => {
                if (result.success && result.voiceFilename) {
                    const character = allCharacters.find(c => c.id === characterId);
                    if (character) {
                        const updatedCharacter: Character = {
                            ...character,
                            voice: {
                                voiceFilename: result.voiceFilename,
                                textContent: result.transcript || '',
                                language: result.language
                            }
                        };
                        onSaveCharacter(updatedCharacter); 
                    }
                    addToast('✅ Voice transcribed and saved!', 'success');
                } else {
                    addToast('❌ Voice transcription failed.', 'error');
                }
            })
            .catch(err => {
                console.error('[AppModals] Background voice transcribe failed:', err);
                addToast(`❌ Transcription error: ${err.message}`, 'error');
            });
    }, [addToast, allCharacters, onSaveCharacter]);

    const currentWorldIds = useMemo(() => {
        return interactionData?.worldIds || [];
    }, [interactionData]);

    const handleToggleWorld = useCallback((worldId: string) => {
        const isCurrentlyActive = currentWorldIds.includes(worldId);
        const nextWorldIds: string[] = isCurrentlyActive
            ? currentWorldIds.filter((id: string) => id !== worldId)
            : [...currentWorldIds, worldId];

        const nextWorlds = allWorlds.filter(w => nextWorldIds.includes(w.id));
        onToggleWorlds?.(nextWorlds);

        if (isCurrentlyActive) {
            addToast('Removed world contents from session.', 'info');
        } else {
            const added = allWorlds.find(w => w.id === worldId);
            addToast(`Loaded world "${added?.name || 'Untitled'}" into session.`, 'success');
        }
    }, [currentWorldIds, allWorlds, onToggleWorlds, addToast]);

    const chatShellsWithIdentifiers = useMemo(() => {
        const list = allRawInteractionDataShells.filter((shell): shell is ChatShellWithIdentifier => !!shell.id);

        if (isChatSaveable(interactionData) && interactionData?.id && !list.some(shell => shell.id === interactionData.id)) {
            list.unshift({
                id: interactionData.id,
                name: interactionData.name || 'Untitled Session',
                firstCreatedTimestamp: interactionData.firstCreatedTimestamp,
                lastUpdatedTimestamp: interactionData.lastUpdatedTimestamp,
                numberOfMessages: interactionData.numberOfMessages ?? 0,
                parentInteractionDataId: interactionData.parentInteractionDataId ?? null,
                parentMessageId: interactionData.parentMessageId ?? null,
                protagonistIds: interactionData.protagonistIds ?? [],
                participantIds: interactionData.participants?.map(p => p.id) ?? [],
                contextIds: interactionData.contexts?.map(c => c.id) ?? [],
                locationIds: interactionData.locations?.map(l => l.id) ?? [],
                audioTrackIds: interactionData.audioTracks?.map(a => a.id) ?? [],
                profileId: interactionData.profile?.id,
            } as unknown as ChatShellWithIdentifier);
        }
        return list;
    }, [allRawInteractionDataShells, interactionData]);

    const strategyModelIds = useMemo(() => {
        const set = new Set<string>();
        if (activeStrategy) {
            for (const modelId of activeStrategy.modelIds) {
                set.add(modelId);
            }
        }
        return set;
    }, [activeStrategy]);

    const isAdministrator = useMemo(() => {
        if (!multiplayerData || !currentAccountId) return false;
        return multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.isAdministrator;
    }, [multiplayerData, currentAccountId]);

    const hosterOwnedCharacters = useMemo(() => {
        if (!isMultiplayerClient || !interactionData) return undefined;
        const seen = new Set<string>();
        const res: Character[] = [];
        for (const p of (interactionData.participants || [])) {
            if (p?.id && !seen.has(p.id)) {
                seen.add(p.id);
                res.push(p);
            }
        }
        return res;
    }, [isMultiplayerClient, interactionData]);

    const hosterOwnedContexts = useMemo(() => isMultiplayerClient ? interactionData?.contexts : undefined, [isMultiplayerClient, interactionData]);
    const hosterOwnedLocations = useMemo(() => isMultiplayerClient ? interactionData?.locations : undefined, [isMultiplayerClient, interactionData]);
    const hosterOwnedAudioTracks = useMemo(() => isMultiplayerClient ? interactionData?.audioTracks : undefined, [isMultiplayerClient, interactionData]);

    useEffect(() => {
        if (modals.interactionDataList.isOpen) {
            ensureChatsLoaded();
        }
    }, [modals.interactionDataList.isOpen, ensureChatsLoaded]);

    const handleOpenInteractionDataInspectionModal = useCallback(async (chatId: string) => {
        if (interactionData && interactionData.id === chatId) {
            setInspectionStack([interactionData]);
            modals.chatInspection?.open();
            return;
        }

        const loaded = await loadRawInteractionData(chatId, allCharacters);
        if (!loaded) { 
            addToast('Failed to load session for inspection.', 'error'); 
            return; 
        }
        setInspectionStack([loaded]);
        modals.chatInspection?.open();
    }, [interactionData, allCharacters, addToast, modals.chatInspection]);

    const handleInspectParentInteractionData = useCallback(async (parentId: string): Promise<InteractionData> => {
        if (interactionData && interactionData.id === parentId) {
            return interactionData;
        }

        const loaded = await loadRawInteractionData(parentId, allCharacters);
        if (!loaded) throw new Error(`Failed to load parent session ${parentId}`);
        return loaded;
    }, [interactionData, allCharacters]);

    return (
        <>
            {/* ─── Tool / Utility Modals ─── */}

            {modals.settings.isOpen && (
                <SettingsModal
                    onClose={modals.settings.close}
                    onOpenBudgetControl={modals.budgetControl.open}
                    onOpenParticipantControl={modals.participantControl.open}
                    onOpenAccountData={modals.accountList.open}
                    onOpenMultiplayerData={modals.multiplayerDataList.open}
                    onOpenJoinSession={modals.joinSession.open}
                    onOpenAIRecommendation={modals.aiRecommendation.open}
                    onOpenRestrictionReduction={modals.restrictionReduction.open}
                    onOpenPromptGuide={modals.promptGuide.open}
                    onOpenAlternateTimelines={modals.alternateTimelines.open}
                    onOpenImportCharacterCard={modals.cardImport.open}
                    onOpenExportData={modals.exportData.open}
                    onOpenImportData={modals.importData.open}
                    onOpenDataManager={modals.dataManager.open}
                    onOpenSuperSearch={modals.superSearch.open}
                    onOpenGpuMonitor={modals.gpuMonitor.open}
                    onOpenModelInferenceManager={modals.modelInferenceManager.open}
                />
            )}

            {/* ✅ FIX: Explicitly defined <ChatShellWithIdentifier> to fix TS generic inference cascade failure */}
            {modals.interactionDataList.isOpen && (
                <ManagerModal
                    title="Sessions"
                    entityType={'interactionData' as entityType}
                    localLibraryItems={chatShellsWithIdentifiers}
                    onClose={modals.interactionDataList.close}
                    onSelect={(data) => handleOpenInteractionDataInspectionModal(data.id)}
                    onSelectItem={(data) => { onSwitchChat(data.id); modals.interactionDataList.close(); }}
                    onDelete={onDeleteInteractionData}
                    onCreateNew={onNewInteractionData}
                    renderSubtext={renderInteractionDataSubtext}
                    emptyMessage="No sessions found."
                    actionLabel="Delete"
                    activeItemId={interactionData?.id ?? null}
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.characterList.isOpen && (
                <ManagerModal
                    title="Characters"
                    entityType={'character' as entityType}
                    localLibraryItems={allCharacters}
                    hosterOwnedItems={hosterOwnedCharacters}
                    isAdministrator={isAdministrator}
                    onClose={modals.characterList.close}
                    onSelect={async (character: Character, isHosterItem: boolean) => { 
                        const isLocal = allCharacters.some(c => c.id === character.id);
                        const fullCharacter = (isLocal && character.languageModelSampler) ? character : (isLocal ? await onLoadFullCharacter(character.id) : character);
                        characterModalProperties.open(fullCharacter || character, isHosterItem); 
                    }}
                    onDelete={onDeleteCharacter}
                    onCreateNew={() => characterModalProperties.open()}
                    renderSubtext={(character: Character) => character.description || 'No description'}
                    emptyMessage="No characters found."
                    actionLabel="Delete"
                    orderedListMode={true}
                    currentOrderIds={interactionData?.participants.map(participant => participant.id) || []}
                    onToggleOrder={onToggleParticipant}
                    onSelectItem={(character: Character) => onSetProtagonist(character.id)}
                    specialActionTooltip={(character: Character) => `set ${character.name} as the protagonist`}
                    selectedId={localProtagonistId ?? undefined}
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.contextList.isOpen && (
                <ManagerModal 
                    title="Contexts" 
                    entityType={'context' as entityType}
                    localLibraryItems={allContexts}
                    hosterOwnedItems={hosterOwnedContexts}
                    isAdministrator={isAdministrator}
                    onClose={modals.contextList.close}
                    onSelect={(context: Context, isHosterItem: boolean) => contextModalProperties.open(context, isHosterItem)} 
                    onDelete={onDeleteContext} 
                    onCreateNew={() => contextModalProperties.open()}
                    renderSubtext={renderContextSubtext} 
                    emptyMessage="No contexts found." 
                    actionLabel="Delete"
                    orderedListMode={true} 
                    currentOrderIds={interactionData?.contexts?.map(context => context.id) || []} 
                    onToggleOrder={onToggleContext} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.locationList.isOpen && (
                <ManagerModal 
                    title="Locations" 
                    entityType={'location' as entityType}
                    localLibraryItems={allLocations}
                    hosterOwnedItems={hosterOwnedLocations}
                    isAdministrator={isAdministrator}
                    onClose={modals.locationList.close}
                    onSelect={(location: Location, isHosterItem: boolean) => locationModalProperties.open(location, isHosterItem)} 
                    onDelete={onDeleteLocation} 
                    onCreateNew={() => locationModalProperties.open()}
                    renderSubtext={renderLocationSubtext}
                    emptyMessage="No locations found." 
                    actionLabel="Delete" 
                    orderedListMode={true}
                    currentOrderIds={interactionData?.locations?.map(location => location.id) || []} 
                    onToggleOrder={onToggleLocation} 
                    selectedId={localProtagonistLocationId}
                    secondaryActiveIds={reachableLocationIds}
                    onSelectItem={onMoveProtagonist ? (location: Location) => onMoveProtagonist(location) : undefined}
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.audioTrackList.isOpen && (
                <ManagerModal 
                    title="Audio Tracks" 
                    entityType={'audioTrack' as entityType}
                    localLibraryItems={allAudioTracks}
                    hosterOwnedItems={hosterOwnedAudioTracks}
                    isAdministrator={isAdministrator}
                    onClose={modals.audioTrackList.close}
                    onSelect={(audioTrack: AudioTrack, isHosterItem: boolean) => audioTrackModalProperties.open(audioTrack, isHosterItem)} 
                    onDelete={onDeleteAudioTrack} 
                    onCreateNew={() => audioTrackModalProperties.open()}
                    renderSubtext={(audioTrack: AudioTrack) => `${audioTrack.audioCategory === 'ambient' ? '🌿' : audioTrack.audioCategory === 'music' ? '🎵' : '💥'} ${audioTrack.loop ? '🔁' : '▶️'} Vol: ${Math.round(audioTrack.volume * 100)}%${audioTrack.priority > 0 ? ` • ⬆${audioTrack.priority}` : ''}${audioTrack.locationBindings.length > 0 ? ` • 📍${audioTrack.locationBindings.length}` : ''}${audioTrack.contextBindings.length > 0 ? ` • 📜${audioTrack.contextBindings.length}` : ''}${audioTrack.characterBindings.length > 0 ? ` • 🎭${audioTrack.characterBindings.length}` : ''}`}
                    emptyMessage="No audio tracks found." 
                    actionLabel="Delete" 
                    orderedListMode={true} 
                    currentOrderIds={interactionData?.audioTracks?.map(track => track.id) || []} 
                    onToggleOrder={onToggleAudioTrack} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.worldList.isOpen && (
                <ManagerModal 
                    title="Worlds" 
                    entityType={'world' as entityType}
                    localLibraryItems={allWorlds} 
                    onClose={modals.worldList.close}
                    onSelect={(world: World) => worldModalProperties.open(world)} 
                    onDelete={onDeleteWorld} 
                    onCreateNew={() => worldModalProperties.open()}
                    renderSubtext={(world: World) => {
                        const parts = [
                            world.characterIds.length > 0 ? `${world.characterIds.length} characters` : null,
                            world.contextIds.length > 0 ? `${world.contextIds.length} contexts` : null,
                            world.locationIds.length > 0 ? `${world.locationIds.length} locations` : null,
                            world.audioTrackIds?.length > 0 ? `${world.audioTrackIds.length} audios` : null,
                            world.profileId ? 'Has profile' : null,
                            world.description ? `— ${world.description}` : null,
                        ].filter(Boolean);
                        return parts.join(' • ');
                    }}
                    emptyMessage="No worlds saved yet." 
                    actionLabel="Delete"
                    orderedListMode={true}
                    currentOrderIds={currentWorldIds}
                    onToggleOrder={handleToggleWorld}
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.promptBlockList.isOpen && (
                <ManagerModal 
                    title="Prompt Blocks" 
                    entityType={'promptBlock' as entityType}
                    localLibraryItems={allPromptBlocks} 
                    onClose={modals.promptBlockList.close}
                    onSelect={(promptBlock: PromptBlock) => promptBlockModalProperties.open(promptBlock)} 
                    onDelete={promptBlockModalProperties.delete} 
                    onCreateNew={() => promptBlockModalProperties.open()}
                    renderSubtext={(promptBlock: PromptBlock) => `${promptBlock.textContent ? `📝 ${promptBlock.textContent.length} characters` : ''}${promptBlock.images.length > 0 ? ` • 🖼️ ${promptBlock.images.length}` : ''}${promptBlock.characterBindings.length > 0 ? ` • 🎭${promptBlock.characterBindings.length}` : ''}${promptBlock.contextBindings.length > 0 ? ` • 📜${promptBlock.contextBindings.length}` : ''}${promptBlock.locationBindings.length > 0 ? ` • 📍${promptBlock.locationBindings.length}` : ''}`}
                    emptyMessage="No prompt blocks found." 
                    actionLabel="Delete" 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.modelList.isOpen && (
                <ManagerModal 
                    title="Language Models" 
                    entityType={'languageModel' as entityType}
                    localLibraryItems={allLanguageModels} 
                    onClose={modals.modelList.close}
                    onSelect={(model: LanguageModel) => languageModelModalProperties.open(model)} 
                    onDelete={onDeleteModel} 
                    onCreateNew={() => languageModelModalProperties.open()}
                    renderSubtext={(model: LanguageModel) => renderLanguageModelSubtext(model, runningLanguageModels, selectedModelId)}
                    emptyMessage="No models available." 
                    actionLabel="Delete" 
                    orderedListMode={false}
                    selectedId={selectedModelId || undefined} 
                    secondaryActiveIds={strategyModelIds}
                    onSelectItem={(model: LanguageModel) => onToggleModelLoad(model.id)}
                    specialActionTooltip={(model: LanguageModel) => {
                        const modelStatus = runningLanguageModels[model.id];
                        const isCloud = !!model.apiKey && !!model.backend && cloudBackends.includes(model.backend as cloudBackend);
                        const inStrategy = strategyModelIds.has(model.id);
                        if (inStrategy && activeStrategy && selectedModelId !== model.id) return `★ In strategy "${activeStrategy.name}" — Click to select & override strategy`;
                        if (isCloud && selectedModelId === model.id) return '☁️ Cloud Model — Click to Deselect';
                        if (isCloud) return '☁️ Cloud Model — Click to Select (Overrides Budget)';
                        if (modelStatus?.isRunning && modelStatus?.isIdle && selectedModelId === model.id) return '⏹ Stop & Deselect';
                        if (modelStatus?.isRunning && modelStatus?.isIdle) return '⏹ Stop Model';
                        if (modelStatus?.isRunning && !modelStatus?.isIdle) return '⏳ Loading...';
                        if (selectedModelId === model.id) return '✓ Already Selected — Click to Load';
                        return '▶ Load & Select Model (Overrides Budget)';
                    }} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.spatiotemporalModelList.isOpen && (
                <ManagerModal 
                    title="Spatiotemporal Models" 
                    entityType={'spatiotemporalModel' as entityType}
                    localLibraryItems={allSpatiotemporalModels} 
                    onClose={modals.spatiotemporalModelList.close}
                    onSelect={(model: SpatiotemporalModel) => spatiotemporalModelModalProperties.open(model)} 
                    onDelete={onDeleteSpatiotemporalModel} 
                    onCreateNew={() => spatiotemporalModelModalProperties.open()}
                    renderSubtext={(model: SpatiotemporalModel) => renderLanguageModelSubtext(model, runningSpatiotemporalModels, selectedSpatiotemporalModelId)}
                    emptyMessage="No models available." 
                    actionLabel="Delete" 
                    orderedListMode={false}
                    selectedId={selectedSpatiotemporalModelId || undefined} 
                    onSelectItem={(model: SpatiotemporalModel) => onToggleSpatiotemporalModelLoad(model.id)}
                    specialActionTooltip={(model: SpatiotemporalModel) => {
                        const modelStatus = runningSpatiotemporalModels[model.id];
                        const isCloud = !!model.apiKey && !!model.backend && cloudBackends.includes(model.backend as cloudBackend);
                        if (isCloud && selectedSpatiotemporalModelId === model.id) return '☁️ Cloud Model — Click to Deselect';
                        if (isCloud) return '☁️ Cloud Model — Click to Select';
                        if (modelStatus?.isRunning && modelStatus?.isIdle && selectedSpatiotemporalModelId === model.id) return '⏹ Stop & Deselect';
                        if (modelStatus?.isRunning && modelStatus?.isIdle) return '⏹ Stop Model';
                        if (modelStatus?.isRunning && !modelStatus?.isIdle) return '⏳ Loading...';
                        if (selectedSpatiotemporalModelId === model.id) return '✓ Already Selected — Click to Load';
                        return '▶ Load & Select Model';
                    }} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.samplerList.isOpen && (
                <ManagerModal 
                    title="Samplers" 
                    entityType={'sampler' as entityType}
                    localLibraryItems={allSamplers} 
                    onClose={modals.samplerList.close}
                    onSelect={(sampler: Sampler) => samplerModalProperties.open(sampler)} 
                    onDelete={onDeleteSampler} 
                    onCreateNew={() => samplerModalProperties.open()}
                    renderSubtext={(sampler: Sampler) => `Temp: ${sampler?.parameters?.temperature}, TopP: ${sampler?.parameters?.top_p}, Tokens: ${sampler?.maximumNumberOfTokens}`}
                    emptyMessage="No samplers found." 
                    actionLabel="Delete" 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.stopPatternList.isOpen && (
                <ManagerModal 
                    title="Stop Patterns" 
                    entityType={'stopPattern' as entityType}
                    localLibraryItems={allStopPatterns} 
                    onClose={modals.stopPatternList.close}
                    onSelect={(stopPattern: StopPattern) => stopPatternModalProperties.open(stopPattern)} 
                    onDelete={onDeleteStopPattern} 
                    onCreateNew={() => stopPatternModalProperties.open()}
                    renderSubtext={(stopPattern: StopPattern) => {
                        const hasActivationTriggers = (stopPattern.regularExpressionActivationTriggers?.length ?? 0) > 0;
                        return (<span style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block' }}>{hasActivationTriggers ? '⚡' : '📌'} Pattern: {stopPattern.pattern}</span>);
                    }}
                    emptyMessage="No stop patterns found." 
                    actionLabel="Delete" 
                    orderedListMode={false} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.retrievalConfigurationList.isOpen && (
                <ManagerModal 
                    title="Retrieval Configurations" 
                    entityType={'retrievalConfiguration' as entityType}
                    localLibraryItems={allRetrievalConfigurations} 
                    onClose={modals.retrievalConfigurationList.close}
                    onSelect={(config: RetrievalConfiguration) => retrievalConfigurationModalProperties.open(config)} 
                    onDelete={onDeleteRetrievalConfiguration} 
                    onCreateNew={() => retrievalConfigurationModalProperties.open()}
                    renderSubtext={(config: RetrievalConfiguration) => `Strategy: ${config.retrievalStrategy} • Top-K: ${config.topK} • Threshold: ${config.similarityThreshold} • Budget: ${config.tokenBudget}`}
                    emptyMessage="No retrieval configurations found." 
                    actionLabel="Delete" 
                    orderedListMode={false} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.budgetStrategyList.isOpen && (
                <ManagerModal 
                    title="Budget Strategies" 
                    entityType={'budgetStrategy' as entityType}
                    localLibraryItems={allBudgetStrategies} 
                    onClose={modals.budgetStrategyList.close}
                    onSelect={(budgetStrategy: BudgetStrategy) => budgetStrategyModalProperties.open(budgetStrategy)} 
                    onDelete={onDeleteBudgetStrategy} 
                    onCreateNew={() => budgetStrategyModalProperties.open()}
                    renderSubtext={renderBudgetStrategySubtext} 
                    emptyMessage="No budget strategies found." 
                    actionLabel="Delete" 
                    orderedListMode={false}
                    selectedId={selectedBudgetStrategyId || undefined} 
                    onSelectItem={(budgetStrategy: BudgetStrategy) => onActivateBudgetStrategy(budgetStrategy.id)}
                    specialActionTooltip={(budgetStrategy: BudgetStrategy) => selectedBudgetStrategyId === budgetStrategy.id ? `Deactivate ${budgetStrategy.name}` : `Activate ${budgetStrategy.name} (Deselects Direct Model)`} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.profileList.isOpen && (
                <ManagerModal 
                    title="Profiles" 
                    entityType={'profile' as entityType}
                    localLibraryItems={allProfiles} 
                    onClose={modals.profileList.close}
                    onSelect={(profile: Profile) => profileModalProperties.open(profile)} 
                    onDelete={onDeleteProfile} 
                    onCreateNew={() => profileModalProperties.open()}
                    renderSubtext={renderProfileSubtext} 
                    emptyMessage="No profiles found." 
                    actionLabel="Delete" 
                    orderedListMode={false}
                    selectedId={interactionData?.profile?.id || undefined} 
                    onSelectItem={(profile: Profile) => onActivateProfile(profile.id)}
                    specialActionTooltip={(profile: Profile) => interactionData?.profile?.id === profile.id ? `Deactivate ${profile.name}` : `Activate ${profile.name}`} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.extensionList.isOpen && (
                <ManagerModal 
                    title="Extensions" 
                    entityType={'extension' as entityType}
                    localLibraryItems={allExtensions} 
                    onClose={modals.extensionList.close}
                    onSelect={undefined} 
                    onDelete={onDeleteExtension} 
                    onCreateNew={() => addToast('Create Extension Modal coming soon!', 'info')}
                    renderSubtext={(extension: Extension) => renderExtensionSubtext({ extensionType: extension.extensionType, description: extension.description ?? '' })}
                    emptyMessage="No extensions available." 
                    actionLabel="Delete" 
                    orderedListMode={true} 
                    onToggleOrder={onToggleExtension} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.accountList.isOpen && (
                <ManagerModal 
                    title="Accounts" 
                    entityType={'account' as entityType}
                    localLibraryItems={allAccounts} 
                    onClose={modals.accountList.close}
                    onSelect={(account: Account) => accountModalProperties.open(account)} 
                    onDelete={accountModalProperties.delete} 
                    onCreateNew={() => accountModalProperties.open()}
                    renderSubtext={(account: Account) => `👤 ${account.username}${account.url ? ` • 🔗 ${account.url}` : ''}`}
                    emptyMessage="No accounts found." 
                    actionLabel="Delete"
                    onSelectItem={(account: Account) => onToggleAccount(account.id)}
                    specialActionTooltip={(account: Account) => currentAccountId === account.id ? `Deactivate ${account.name}` : `Activate ${account.name}`}
                    selectedId={currentAccountId || undefined} 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.multiplayerDataList.isOpen && (
                <ManagerModal 
                    title="Multiplayer Data" 
                    entityType={'multiplayerData' as entityType}
                    localLibraryItems={allMultiplayerData} 
                    onClose={modals.multiplayerDataList.close}
                    onSelect={(multiplayerDataEntry: MultiplayerData) => multiplayerDataModalProperties.open(multiplayerDataEntry)} 
                    onDelete={onDeleteMultiplayerData} 
                    onCreateNew={() => multiplayerDataModalProperties.open()}
                    renderSubtext={(multiplayerDataEntry: MultiplayerData) => `${multiplayerDataEntry.password ? '🔒' : '🔓'} ${Object.keys(multiplayerDataEntry.multiplayerDataAccountConfigurations || {}).length} accounts • ${multiplayerDataEntry.interactionDataIds.length} sessions`}
                    emptyMessage="No multiplayer data found." 
                    actionLabel="Delete" 
                    allEntityFolders={allEntityFolders}
                    onSaveEntityFolder={onSaveEntityFolder}
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    addToast={addToast}
                />
            )}

            {modals.budgetControl.isOpen && (
                <BudgetControlModal onClose={modals.budgetControl.close} allLanguageModels={allLanguageModels} activeStrategy={activeStrategy} />
            )}

            {modals.participantControl.isOpen && interactionData && (!isMultiplayerClient || isAdministrator) && (
                <ParticipantControlModal 
                    onClose={modals.participantControl.close}
                    interactionData={interactionData}
                    isMultiplayerClient={isMultiplayerClient}
                    isAdministrator={isAdministrator}
                    onUpdateInteractionData={onUpdateInteractionData}
                    onForceFirstMessage={onForceFirstMessage} 
                    onSendCustomMessage={onSendCustomMessage} 
                    onInjectCustomMessage={onInjectCustomMessage}
                    onInjectFirstMessage={onInjectFirstMessage}
                />
            )}

            {modals.aiRecommendation.isOpen && (
                <AIRecommendationModal 
                    onClose={modals.aiRecommendation.close}
                    onSaveCharacter={async (character: Character) => { onSaveCharacter(character); return true; }}
                    onSaveContext={async (context: Context) => { onSaveContext(context); return true; }}
                    onSaveLocation={async (location: Location) => { onSaveLocation(location); return true; }}
                    onSaveAudioTrack={async (audioTrack: AudioTrack) => { onSaveAudioTrack(audioTrack); return true; }}
                    onSaveProfile={async (profile: Profile) => { onSaveProfile(profile); return true; }}
                    onSaveWorld={async (world: World) => { onSaveWorld(world); return true; }}
                    onSavePromptBlock={async (promptBlock: PromptBlock) => { promptBlockModalProperties.save(promptBlock); return true; }}
                    onOpenCharacterEditor={(character, onApplyToRecommendation) => { setAiCharacterSaveRedirect(() => onApplyToRecommendation); characterModalProperties.open(character ?? undefined); }}
                    onOpenContextEditor={(context, onApplyToRecommendation) => { setAiContextSaveRedirect(() => onApplyToRecommendation); contextModalProperties.open(context ?? undefined); }}
                    onOpenLocationEditor={(location, onApplyToRecommendation) => { setAiLocationSaveRedirect(() => onApplyToRecommendation); locationModalProperties.open(location ?? undefined); }}
                    onOpenAudioTrackEditor={(audioTrack, onApplyToRecommendation) => { setAiAudioTrackSaveRedirect(() => onApplyToRecommendation); audioTrackModalProperties.open(audioTrack ?? undefined); }}
                    onOpenPromptBlockEditor={(promptBlock, onApplyToRecommendation) => { setAiPromptBlockSaveRedirect(() => onApplyToRecommendation); promptBlockModalProperties.open(promptBlock ?? undefined); }}
                    onOpenProfileEditor={(profile, onApplyToRecommendation) => { setAiProfileSaveRedirect(() => onApplyToRecommendation); profileModalProperties.open(profile ?? undefined); }}
                    allSamplers={allSamplers} allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations}
                    allAudioTracks={allAudioTracks} allPromptBlocks={allPromptBlocks} allEntityFolders={allEntityFolders}
                    allLanguageModels={allLanguageModels}
                    runningLanguageModels={runningLanguageModels}
                />
            )}

            {modals.restrictionReduction.isOpen && (
                <RestrictionReductionModal 
                    onClose={modals.restrictionReduction.close}
                    onSaveCharacter={async (character: Character) => { onSaveCharacter(character); return true; }}
                    allCharacters={allCharacters} allProfiles={allProfiles} 
                    allLanguageModels={allLanguageModels}
                    allSamplers={allSamplers}
                    runningLanguageModels={runningLanguageModels} 
                />
            )}

            {modals.promptGuide.isOpen && (
                <PromptGuideModal onClose={modals.promptGuide.close} />
            )}

            {modals.alternateTimelines.isOpen && (
                <AlternateTimelinesModal 
                    onClose={modals.alternateTimelines.close}
                    currentInteractionId={interactionData?.id ?? ''} 
                    allRawInteractionDataShells={chatShellsWithIdentifiers}
                    onSwitchChat={onSwitchChat} 
                    onDeleteInteractionData={onDeleteInteractionData} 
                    onInspectChat={handleOpenInteractionDataInspectionModal} 
                    onRenameInteractionData={onRenameInteractionData} 
                />
            )}

            {modals.cardImport.isOpen && (
                <CharacterCardImportModal 
                    onClose={modals.cardImport.close}
                    onSaveCharacter={async (character: Character) => { onSaveCharacter(character); return true; }}
                    onSaveContext={async (context: Context) => { onSaveContext(context); return true; }} 
                    allSamplers={allSamplers} 
                />
            )}

            {modals.importData.isOpen && (
                <DataImportModal onClose={modals.importData.close} onImportComplete={onImportComplete} />
            )}

            {modals.exportData.isOpen && (
                <DataExportModal
                    onClose={modals.exportData.close}
                    allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations} allAudioTracks={allAudioTracks}
                    allWorlds={allWorlds} allLanguageModels={allLanguageModels} allSpatiotemporalModels={allSpatiotemporalModels} allSamplers={allSamplers} allPromptBlocks={allPromptBlocks}
                    allStopPatterns={allStopPatterns} allRetrievalConfigurations={allRetrievalConfigurations} allBudgetStrategies={allBudgetStrategies} allProfiles={allProfiles}
                    allMemories={allMemories} allAccounts={allAccounts} allMultiplayerData={allMultiplayerData}
                    allRawInteractionDataShells={chatShellsWithIdentifiers}
                    allEntityFolders={allEntityFolders}
                />
            )}

            {modals.dataManager.isOpen && (
                <DataManagerModal 
                    onClose={modals.dataManager.close}
                    allCharacters={allCharacters} 
                    allContexts={allContexts} 
                    allLocations={allLocations} 
                    allAudioTracks={allAudioTracks}
                    allWorlds={allWorlds}
                    allPromptBlocks={allPromptBlocks}
                    allLanguageModels={allLanguageModels} 
                    allSpatiotemporalModels={allSpatiotemporalModels}
                    allSamplers={allSamplers} 
                    allStopPatterns={allStopPatterns} 
                    allRetrievalConfigurations={allRetrievalConfigurations}
                    allBudgetStrategies={allBudgetStrategies} 
                    allProfiles={allProfiles}
                    allMemories={allMemories} 
                    allAccounts={allAccounts} 
                    allMultiplayerData={allMultiplayerData} 
                    allEntityFolders={allEntityFolders}
                    allRawInteractionDataShells={chatShellsWithIdentifiers}
                    onDeleteCharacter={onDeleteCharacter} 
                    onDeleteContext={onDeleteContext} 
                    onDeleteLocation={onDeleteLocation}
                    onDeleteAudioTrack={onDeleteAudioTrack} 
                    onDeleteWorld={onDeleteWorld} 
                    onDeleteModel={onDeleteModel}
                    onDeleteSpatiotemporalModel={onDeleteSpatiotemporalModel}
                    onDeleteSampler={onDeleteSampler} 
                    onDeletePromptBlock={onDeletePromptBlock} 
                    onDeleteStopPattern={onDeleteStopPattern}
                    onDeleteRetrievalConfiguration={onDeleteRetrievalConfiguration}
                    onDeleteBudgetStrategy={onDeleteBudgetStrategy} 
                    onDeleteProfile={onDeleteProfile} 
                    onDeleteMemory={onDeleteMemory}
                    onDeleteAccount={onDeleteAccount} 
                    onDeleteMultiplayerData={onDeleteMultiplayerData} 
                    onDeleteEntityFolder={onDeleteEntityFolder}
                    onDeleteInteractionData={onDeleteInteractionData}
                />
            )}

            {modals.superSearch?.isOpen && (
                <SuperSearchModal
                    onClose={modals.superSearch.close}
                    isMultiplayerClient={isMultiplayerClient}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                    allAudioTracks={allAudioTracks}
                    allWorlds={allWorlds}
                    allPromptBlocks={allPromptBlocks}
                    allLanguageModels={allLanguageModels}
                    allSpatiotemporalModels={allSpatiotemporalModels}
                    allSamplers={allSamplers}
                    allStopPatterns={allStopPatterns}
                    allRetrievalConfigurations={allRetrievalConfigurations}
                    allBudgetStrategies={allBudgetStrategies}
                    allProfiles={allProfiles}
                    allMemories={allMemories}
                    allAccounts={allAccounts}
                    allMultiplayerData={allMultiplayerData}
                    allEntityFolders={allEntityFolders}
                    allRawInteractionDataShells={chatShellsWithIdentifiers}
                    currentInteractionData={interactionData}
                    onSelectEntity={(tabId, entity, parentEntity, isReadOnly = false) => {
                        switch (tabId) {
                            case 'character': characterModalProperties.open(entity, isReadOnly); break;
                            case 'context': contextModalProperties.open(entity, isReadOnly); break;
                            case 'location': locationModalProperties.open(entity, isReadOnly); break;
                            case 'audioTrack': audioTrackModalProperties.open(entity, isReadOnly); break;
                            case 'world': worldModalProperties.open(entity, isReadOnly); break;
                            case 'promptBlock': promptBlockModalProperties.open(entity, isReadOnly); break;
                            case 'languageModel': languageModelModalProperties.open(entity, isReadOnly); break;
                            case 'spatiotemporalModel': spatiotemporalModelModalProperties.open(entity, isReadOnly); break;
                            case 'sampler': samplerModalProperties.open(entity, isReadOnly); break;
                            case 'stopPattern': stopPatternModalProperties.open(entity, isReadOnly); break;
                            case 'retrievalConfiguration': retrievalConfigurationModalProperties.open(entity, isReadOnly); break;
                            case 'budgetStrategy': budgetStrategyModalProperties.open(entity, isReadOnly); break;
                            case 'profile': profileModalProperties.open(entity, isReadOnly); break;
                            case 'account': accountModalProperties.open(entity, isReadOnly); break;
                            case 'multiplayerData': multiplayerDataModalProperties.open(entity, isReadOnly); break;
                            case 'interactionData': onSwitchChat(entity.id); break;
                            case 'entityFolder':
                                addToast(`Folder selected: ${entity.name}`, 'info');
                                break;
                            case 'memory':
                                addToast('Memories are managed inside Character settings.', 'info');
                                characterModalProperties.open(parentEntity, isReadOnly);
                                break;
                            case 'message':
                                if (interactionData?.id !== parentEntity?.id && parentEntity) {
                                    onSwitchChat(parentEntity.id);
                                }
                                if (entity.id) {
                                    const targetId = entity.id;
                                    const observer = new MutationObserver(() => {
                                        const el = document.querySelector(`[data-message-id="${targetId}"]`);
                                        if (el) {
                                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            observer.disconnect();
                                        }
                                    });
                                    observer.observe(document.body, { childList: true, subtree: true });
                                    setTimeout(() => observer.disconnect(), 3000); 
                                }
                                break;
                            default:
                                entityModals.getModalProperties(tabId as any)?.open(entity, isReadOnly);
                                break;
                        }
                    }}
                />
            )}

            {modals.gpuMonitor.isOpen && (
                <GpuMonitorModal onClose={modals.gpuMonitor.close} />
            )}

            {modals.modelInferenceManager.isOpen && (
                <ModelInferenceManagerModal
                    onClose={modals.modelInferenceManager.close}
                    addToast={addToast}
                />
            )}

            {/* ─── Editor Modals ─── */}

            {characterModalProperties.isOpen && (
                <CharacterEditorModal 
                    isReadOnly={characterModalProperties.isReadOnly}
                    onClose={() => { setAiCharacterSaveRedirect(null); characterModalProperties.close(); }}
                    onSave={(character: Character) => { 
                        if (aiCharacterSaveRedirect) { 
                            aiCharacterSaveRedirect(character); 
                            addToast('Applied character changes to AI recommendation.', 'success'); 
                        } else { 
                            handleSaveCharacterWithEmbeddings(character); 
                        } 
                    }}
                    onVoiceTranscribeRequested={handleBackgroundVoiceTranscribe}
                    existingCharacter={characterModalProperties.item} 
                    allSamplers={allSamplers} 
                    allRetrievalConfigurations={allRetrievalConfigurations}
                    allCharacters={allCharacters}
                    allLocations={allLocations}
                    localProtagonistId={localProtagonistId}
                    interactionData={interactionData}
                    selectedLanguageModel={effectiveTokenizerModel} 
                    runningLanguageModels={runningLanguageModels} 
                    allRawInteractionDataShells={allRawInteractionDataShells} 
                />
            )}

            {contextModalProperties.isOpen && (
                <ContextEditorModal 
                    isReadOnly={contextModalProperties.isReadOnly}
                    onClose={() => { setAiContextSaveRedirect(null); contextModalProperties.close(); }}
                    onSave={(context: Context) => { 
                        if (aiContextSaveRedirect) { 
                            aiContextSaveRedirect(context); 
                            addToast('Applied context changes to AI recommendation.', 'success'); 
                        } else { 
                            contextModalProperties.save(context); 
                        } 
                    }}
                    existingContext={contextModalProperties.item} 
                    allCharacters={allCharacters} 
                />
            )}

            {locationModalProperties.isOpen && (
                <LocationEditorModal 
                    isReadOnly={locationModalProperties.isReadOnly}
                    onClose={() => { setAiLocationSaveRedirect(null); locationModalProperties.close(); }}
                    onSave={(location: Location) => { 
                        if (aiLocationSaveRedirect) { 
                            aiLocationSaveRedirect(location); 
                            addToast('Applied location changes to AI recommendation.', 'success'); 
                        } else { 
                            locationModalProperties.save(location); 
                        } 
                    }}
                    existingLocation={locationModalProperties.item} 
                    allCharacters={allCharacters} 
                    allLocations={allLocations} 
                    allAudioTracks={allAudioTracks} 
                />
            )}

            {audioTrackModalProperties.isOpen && (
                <AudioTrackEditorModal 
                    isReadOnly={audioTrackModalProperties.isReadOnly}
                    onClose={() => { setAiAudioTrackSaveRedirect(null); audioTrackModalProperties.close(); }}
                    onSave={(audioTrack: AudioTrack) => { 
                        if (aiAudioTrackSaveRedirect) { 
                            aiAudioTrackSaveRedirect(audioTrack); 
                            addToast('Applied audio track changes to AI recommendation.', 'success'); 
                        } else { 
                            audioTrackModalProperties.save(audioTrack); 
                        } 
                    }}
                    existingTrack={audioTrackModalProperties.item} 
                    allCharacters={allCharacters} 
                    allContexts={allContexts} 
                    allLocations={allLocations} 
                />
            )}

            {worldModalProperties.isOpen && (
                <WorldEditorModal 
                    onClose={worldModalProperties.close} 
                    onSave={worldModalProperties.save} 
                    existingWorld={worldModalProperties.item} 
                    allCharacters={allCharacters} 
                    allContexts={allContexts} 
                    allLocations={allLocations} 
                    allAudioTracks={allAudioTracks}
                    allProfiles={allProfiles} 
                    selectedCharacterIds={interactionData?.participants.map(participant => participant.id) || []}
                    currentContextIds={interactionData?.contexts?.map(context => context.id) || []}
                    currentLocationIds={interactionData?.locations?.map(location => location.id) || []}
                    currentProfileId={interactionData?.profile?.id}
                    currentAudioTrackIds={interactionData?.audioTracks?.map(track => track.id) || []} 
                />
            )}

            {languageModelModalProperties.isOpen && (
                <LanguageModelEditorModal 
                    onClose={languageModelModalProperties.close} 
                    onSave={languageModelModalProperties.save}
                    existingModel={languageModelModalProperties.item} 
                    allStopPatterns={allStopPatterns} 
                />
            )}

            {spatiotemporalModelModalProperties.isOpen && (
                <SpatiotemporalLanguageModelEditorModal 
                    onClose={spatiotemporalModelModalProperties.close} 
                    onSave={spatiotemporalModelModalProperties.save}
                    existingModel={spatiotemporalModelModalProperties.item} 
                    allStopPatterns={allStopPatterns} 
                />
            )}

            {samplerModalProperties.isOpen && (
                <SamplerEditorModal 
                    onClose={samplerModalProperties.close} 
                    onSave={samplerModalProperties.save}
                    existingSampler={samplerModalProperties.item} 
                    allStopPatterns={allStopPatterns} 
                />
            )}

            {promptBlockModalProperties.isOpen && (
                <PromptBlockEditorModal 
                    onClose={() => { setAiPromptBlockSaveRedirect(null); promptBlockModalProperties.close(); }}
                    onSave={(promptBlock: PromptBlock) => { 
                        if (aiPromptBlockSaveRedirect) { 
                            aiPromptBlockSaveRedirect(promptBlock); 
                            addToast('Applied prompt block changes to AI recommendation.', 'success'); 
                        } else { 
                            promptBlockModalProperties.save(promptBlock); 
                        } 
                    }}
                    existingBlock={promptBlockModalProperties.item} 
                    allCharacters={allCharacters} 
                    allContexts={allContexts} 
                    allLocations={allLocations} 
                />
            )}

            {stopPatternModalProperties.isOpen && (
                <StopPatternEditorModal 
                    onClose={stopPatternModalProperties.close} 
                    onSave={stopPatternModalProperties.save}
                    existingStopPattern={stopPatternModalProperties.item} 
                />
            )}

            {retrievalConfigurationModalProperties.isOpen && (
                <RetrievalConfigurationEditorModal 
                    onClose={retrievalConfigurationModalProperties.close} 
                    onSave={retrievalConfigurationModalProperties.save}
                    existingConfiguration={retrievalConfigurationModalProperties.item} 
                />
            )}

            {budgetStrategyModalProperties.isOpen && (
                <BudgetStrategyEditorModal 
                    onClose={budgetStrategyModalProperties.close} 
                    onSave={budgetStrategyModalProperties.save}
                    existingStrategy={budgetStrategyModalProperties.item} 
                    allLanguageModels={allLanguageModels} 
                />
            )}

            {profileModalProperties.isOpen && (
                <ProfileEditorModal 
                    onClose={() => { setAiProfileSaveRedirect(null); profileModalProperties.close(); }}
                    onSave={(profile: Profile) => { 
                        if (aiProfileSaveRedirect) { 
                            aiProfileSaveRedirect(profile); 
                            addToast('Applied profile changes to AI recommendation.', 'success'); 
                        } else { 
                            profileModalProperties.save(profile); 
                        } 
                    }}
                    existingProfile={profileModalProperties.item}
                    allCharacters={allCharacters}
                    allPromptBlocks={allPromptBlocks}
                    allSamplers={allSamplers} 
                    allStopPatterns={allStopPatterns}
                    allRetrievalConfigurations={allRetrievalConfigurations}
                />
            )}

            {accountModalProperties.isOpen && (
                <AccountEditorModal 
                    onClose={accountModalProperties.close} 
                    onSave={accountModalProperties.save}
                    existingAccount={accountModalProperties.item}
                    allCharacters={allCharacters}
                    allLanguageModels={allLanguageModels}
                    // allSpatiotemporalModels={allSpatiotemporalModels}
                />
            )}

            {multiplayerDataModalProperties.isOpen && (
                <MultiplayerEditorModal
                    onClose={multiplayerDataModalProperties.close}
                    onSave={multiplayerDataModalProperties.save}
                    existingMultiplayerData={multiplayerDataModalProperties.item}
                    allCharacters={allCharacters}
                    allRawInteractionDataShells={chatShellsWithIdentifiers}
                    pendingJoinRequests={pendingJoinRequests}
                    onAcceptJoinRequest={onAcceptJoinRequest}
                    onRejectJoinRequest={onRejectJoinRequest}
                />
            )}

            {/* ─── Join Session Modal ─── */}
            {modals.joinSession.isOpen && (
                <JoinSessionModal
                    onClose={modals.joinSession.close}
                    onJoin={onJoinSession}
                />
            )}

            {/* ─── Chat Inspection Modal ─── */}
            {modals.chatInspection?.isOpen && (
                <InteractionDataInspectionModal
                    onClose={() => { 
                        modals.chatInspection.close(); 
                        setInspectionStack([]); 
                    }}
                    inspectionStack={inspectionStack}
                    onInspectingParentInteractionData={handleInspectParentInteractionData}
                    onSaveInteractionData={onUpdateInteractionData}
                />
            )}
        </>
    );
}

export default AppModals;