// src/components/AppModals.tsx
import type { 
    Character, Context, Location, Sampler, StopPattern, 
    LanguageModel, BudgetStrategy, Profile, Extension, 
    InteractionData, World, AudioTrack, PromptBlock, 
    RawInteractionData, Memory, MultiplayerData, Account, 
    cloudBackend 
} from '../types';
import type { PendingJoinRequest } from '../hooks/useMultiplayerSync';
import type { ModalController } from '../hooks/useAppModals';
import type { EntityType } from '../hooks/useEntityModals';
import { loadRawInteractionData } from '../storages/serverStorage';
import { ManagerModal } from './ManagerModal';
import { CharacterEditorModal } from './CharacterEditorModal';
import { ModelEditorModal } from './ModelEditorModal';
import { SamplerEditorModal } from './SamplerEditorModal';
import { PromptBlockEditorModal } from './PromptBlockEditorModal';
import { ContextEditorModal } from './ContextEditorModal';
import { LocationEditorModal } from './LocationEditorModal';
import { AudioTrackEditorModal } from './AudioTrackEditorModal';
import { StopPatternEditorModal } from './StopPatternEditorModal';
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
import { CharacterCardImportModal } from './CharacterCardImportModal';
import { DataImportModal } from './DataImportModal';
import { DataExportModal } from './DataExportModal';
import { DataManagerModal } from './DataManagerModal';
import { AlternateTimelinesModal } from './AlternateTimelinesModal';
import { ChatInspectionModal } from './ChatInspectionModal';
import { SuperSearchModal } from './SuperSearchModal';
import { 
    renderModelSubtext, renderBudgetStrategySubtext, renderProfileSubtext, 
    renderChatSubtext, renderContextSubtext, renderLocationSubtext, renderExtensionSubtext 
} from './renderHelpers';
import { cloudBackends } from '../dictionaries/languageModelInformation';
import { useSessionStore } from '../hooks/useSessionStore';
import { useMemo, useState, useEffect, useCallback } from 'react';

interface EntityModalController {
    isOpen: boolean;
    edit: any | null;
    open: (item?: any) => void;
    close: () => void;
    save: (item: any) => Promise<void>;
    delete: (identifier: string) => Promise<void>;
}

interface ApplicationModalsProperties {
    isMultiplayerClient?: boolean;
    modals: Record<string, ModalController>;
    entityModals: {
        getModalProperties: (entityType: EntityType) => EntityModalController;
    };
    runningModels: Record<string, { isRunning: boolean; isIdle?: boolean; port?: number }>;
    rawChatShells: RawInteractionData[];
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allPromptBlocks: PromptBlock[];
    allModels: LanguageModel[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allExtensions: Extension[];
    allWorlds: World[];
    allMemories: Memory[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    onSwitchChat: (identifier: string) => void;
    onDeleteChat: (identifier: string) => void;
    onNewChat: () => void;
    onRenameChat: (identifier: string, name: string) => void;
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
    onDeleteAudioTrack: (identifier: string) => void;
    onToggleAudioTrack: (identifier: string) => void;
    onSaveAudioTrack: (audioTrack: AudioTrack) => void;
    onDeletePromptBlock: (identifier: string) => void;
    onDeleteModel: (identifier: string) => void;
    onToggleModelLoad: (identifier: string) => void;
    onDeleteSampler: (identifier: string) => void;
    onDeleteStopPattern: (identifier: string) => void;
    onDeleteBudgetStrategy: (identifier: string) => void;
    onActivateBudgetStrategy: (identifier: string) => void;
    onDeleteProfile: (identifier: string) => void;
    onActivateProfile: (identifier: string) => void;
    onSaveProfile: (profile: Profile) => void;
    onDeleteExtension: (identifier: string) => void;
    onToggleExtension: (identifier: string) => void;
    onSaveWorld: (world: World) => void;
    onLoadWorld: (world: World) => void;
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

function deriveLocalProtagonist(
    interactionData: InteractionData | null,
    multiplayerData: MultiplayerData | null,
    currentAccountId: string | null,
): Character | null {
    if (!interactionData?.protagonists?.length) return null;
    if (!multiplayerData || !currentAccountId) {
        return interactionData.protagonists[0] ?? null;
    }
    const activeCharacterIdentifier = multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.activeCharacterId;
    if (activeCharacterIdentifier) {
        const foundCharacter = interactionData.protagonists.find(participant => participant.id === activeCharacterIdentifier) || 
                               interactionData.participants.find(participant => participant.id === activeCharacterIdentifier);
        if (foundCharacter) return foundCharacter;
    }
    return interactionData.protagonists[0] ?? null;
}

export function AppModals({
    isMultiplayerClient,
    modals,
    entityModals,
    runningModels,
    rawChatShells,
    allCharacters,
    allContexts,
    allLocations,
    allAudioTracks,
    allSamplers,
    allStopPatterns,
    allModels,
    allBudgetStrategies,
    allProfiles,
    allExtensions,
    allWorlds,
    allPromptBlocks,
    allMemories,
    allAccounts,
    allMultiplayerData,
    onSwitchChat,
    onDeleteChat,
    onNewChat,
    onRenameChat,
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
    onDeleteAudioTrack,
    onToggleAudioTrack,
    onSaveAudioTrack,
    onDeletePromptBlock,
    onDeleteModel,
    onToggleModelLoad,
    onDeleteSampler,
    onDeleteStopPattern,
    onDeleteBudgetStrategy,
    onActivateBudgetStrategy,
    onDeleteProfile,
    onActivateProfile,
    onSaveProfile,
    onDeleteExtension,
    onToggleExtension,
    onSaveWorld,
    onLoadWorld,
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
    const interactionData = useSessionStore(state => state.interactionData);
    const activeStrategy = useSessionStore(state => state.activeStrategy);
    const selectedModelId = useSessionStore(state => state.selectedModel?.id ?? null);
    const selectedBudgetStrategyId = useSessionStore(state => state.activeStrategy?.id ?? null);
    const currentAccountId = useSessionStore(state => state.currentAccountId);
    const multiplayerData = useSessionStore(state => state.multiplayerData);

    const characterModalProperties = entityModals.getModalProperties('character');
    const contextModalProperties = entityModals.getModalProperties('context');
    const locationModalProperties = entityModals.getModalProperties('location');
    const audioTrackModalProperties = entityModals.getModalProperties('audioTrack');
    const worldModalProperties = entityModals.getModalProperties('world');
    const modelModalProperties = entityModals.getModalProperties('model');
    const samplerModalProperties = entityModals.getModalProperties('sampler');
    const promptBlockModalProperties = entityModals.getModalProperties('promptBlock');
    const stopPatternModalProperties = entityModals.getModalProperties('stopPattern');
    const budgetStrategyModalProperties = entityModals.getModalProperties('budgetStrategy');
    const profileModalProperties = entityModals.getModalProperties('profile');
    const accountModalProperties = entityModals.getModalProperties('account');
    const multiplayerDataModalProperties = entityModals.getModalProperties('multiplayerData');

    const localProtagonist = useMemo(
        () => deriveLocalProtagonist(interactionData, multiplayerData, currentAccountId),
        [interactionData, multiplayerData, currentAccountId],
    );

    const effectiveTokenizerModel = useMemo(() => {
        if (selectedModelId) return allModels.find(model => model.id === selectedModelId) ?? null;
        return null;
    }, [selectedModelId, allModels]);

    const [aiCharacterSaveRedirect, setAiCharacterSaveRedirect] = useState<((character: Character) => void) | null>(null);
    const [aiContextSaveRedirect, setAiContextSaveRedirect] = useState<((context: Context) => void) | null>(null);
    const [aiLocationSaveRedirect, setAiLocationSaveRedirect] = useState<((location: Location) => void) | null>(null);
    const [aiAudioTrackSaveRedirect, setAiAudioTrackSaveRedirect] = useState<((audioTrack: AudioTrack) => void) | null>(null);
    const [aiPromptBlockSaveRedirect, setAiPromptBlockSaveRedirect] = useState<((promptBlock: PromptBlock) => void) | null>(null);
    const [aiProfileSaveRedirect, setAiProfileSaveRedirect] = useState<((profile: Profile) => void) | null>(null);

    const [inspectionStack, setInspectionStack] = useState<InteractionData[]>([]);
    const [isInspectionOpen, setIsInspectionOpen] = useState(false);

    const chatShellsWithIdentifiers = useMemo(
        () => rawChatShells.filter((shell): shell is ChatShellWithIdentifier => !!shell.id),
        [rawChatShells],
    );

    const chatNameMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const shell of chatShellsWithIdentifiers) {
            map.set(shell.id, shell.name || 'Untitled Chat');
        }
        if (interactionData?.id) {
            map.set(interactionData.id, interactionData.name || 'Untitled Chat');
        }
        return map;
    }, [chatShellsWithIdentifiers, interactionData?.id, interactionData?.name]);

    useEffect(() => {
        if (modals.chatList.isOpen) {
            ensureChatsLoaded();
        }
    }, [modals.chatList.isOpen, ensureChatsLoaded]);

    const handleOpenChatInspection = useCallback(async (chatId: string) => {
        if (interactionData && interactionData.id === chatId) {
            setInspectionStack([interactionData]);
            setIsInspectionOpen(true);
            return;
        }

        const loaded = await loadRawInteractionData(chatId, allCharacters);
        if (!loaded) { 
            addToast('Failed to load chat for inspection.', 'error'); 
            return; 
        }
        setInspectionStack([loaded]);
        setIsInspectionOpen(true);
    }, [interactionData, allCharacters, addToast]);

    const handleInspectParentInteractionData = useCallback(async (parentId: string): Promise<InteractionData> => {
        if (interactionData && interactionData.id === parentId) {
            return interactionData;
        }

        const loaded = await loadRawInteractionData(parentId, allCharacters);
        if (!loaded) throw new Error(`Failed to load parent chat ${parentId}`);
        return loaded;
    }, [interactionData, allCharacters]);

    return (
        <>
            {/* ─── Manager Lists ─── */}

            {modals.chatList.isOpen && (
                <ManagerModal
                    title="Chat Sessions"
                    items={chatShellsWithIdentifiers}
                    isOpen={modals.chatList.isOpen}
                    onClose={modals.chatList.close}
                    onSelect={(item) => { handleOpenChatInspection(item.id); modals.chatList.close(); }}
                    onDelete={(identifier: string) => onDeleteChat(identifier)}
                    onCreateNew={onNewChat}
                    renderSubtext={renderChatSubtext}
                    emptyMessage="No saved chat sessions found."
                    specialActionIcon="★"
                    onSpecialAction={(item) => onSwitchChat(item.id)}
                    specialActionTooltip={(item) => interactionData?.id === item.id ? `✓ Active — "${item.name}"` : `Activate "${item.name}"`}
                    activeSpecialActionId={interactionData?.id}
                />
            )}

            {modals.charList.isOpen && (
                <ManagerModal
                    title="Characters"
                    items={allCharacters}
                    isOpen={modals.charList.isOpen}
                    onClose={modals.charList.close}
                    onSelect={isMultiplayerClient ? undefined : async (character: Character) => { 
                        const fullCharacter = character.sampler ? character : await onLoadFullCharacter(character.id); 
                        characterModalProperties.open(fullCharacter || character); 
                    }}
                    onDelete={isMultiplayerClient ? undefined : onDeleteCharacter}
                    onCreateNew={isMultiplayerClient ? () => {} : () => characterModalProperties.open()}
                    renderSubtext={(character: Character) => character.description || 'No description'}
                    emptyMessage="No characters found."
                    actionLabel="Delete"
                    orderedListMode={!!interactionData && !isMultiplayerClient}
                    currentOrderIds={interactionData?.participants.map(participant => participant.id) || []}
                    onToggleOrder={isMultiplayerClient ? undefined : onToggleParticipant}
                    specialActionIcon="★"
                    onSpecialAction={isMultiplayerClient ? undefined : (character: Character) => onSetProtagonist(character.id)}
                    specialActionTooltip={(character: Character) => `set ${character.name} as the protagonist`}
                    activeSpecialActionId={localProtagonist?.id}
                />
            )}

            {modals.contextList.isOpen && (
                <ManagerModal 
                    title="Contexts" 
                    items={allContexts} 
                    isOpen={modals.contextList.isOpen} 
                    onClose={modals.contextList.close}
                    onSelect={(context: Context) => contextModalProperties.open(context)} 
                    onDelete={onDeleteContext} 
                    onCreateNew={() => contextModalProperties.open()}
                    renderSubtext={renderContextSubtext} 
                    emptyMessage="No contexts found." 
                    actionLabel="Delete"
                    orderedListMode={true} 
                    currentOrderIds={interactionData?.contexts?.map(context => context.id) || []} 
                    onToggleOrder={onToggleContext} 
                />
            )}

            {modals.locationList.isOpen && (
                <ManagerModal 
                    title="Locations" 
                    items={allLocations} 
                    isOpen={modals.locationList.isOpen} 
                    onClose={modals.locationList.close}
                    onSelect={(location: Location) => locationModalProperties.open(location)} 
                    onDelete={onDeleteLocation} 
                    onCreateNew={() => locationModalProperties.open()}
                    renderSubtext={renderLocationSubtext} 
                    emptyMessage="No locations found." 
                    actionLabel="Delete"
                    orderedListMode={true} 
                    currentOrderIds={interactionData?.locations?.map(location => location.id) || []} 
                    onToggleOrder={onToggleLocation} 
                />
            )}

            {modals.audioTrackList.isOpen && (
                <ManagerModal 
                    title="Audio Tracks" 
                    items={allAudioTracks} 
                    isOpen={modals.audioTrackList.isOpen} 
                    onClose={modals.audioTrackList.close}
                    onSelect={(audioTrack: AudioTrack) => audioTrackModalProperties.open(audioTrack)} 
                    onDelete={onDeleteAudioTrack} 
                    onCreateNew={() => audioTrackModalProperties.open()}
                    renderSubtext={(audioTrack: AudioTrack) => `${audioTrack.audioCategory === 'ambient' ? '🌿' : audioTrack.audioCategory === 'music' ? '🎵' : '💥'} ${audioTrack.loop ? '🔁' : '▶️'} Vol: ${Math.round(audioTrack.volume * 100)}%${audioTrack.priority > 0 ? ` • ⬆${audioTrack.priority}` : ''}${audioTrack.locationBindings.length > 0 ? ` • 📍${audioTrack.locationBindings.length}` : ''}${audioTrack.contextBindings.length > 0 ? ` • 📜${audioTrack.contextBindings.length}` : ''}${audioTrack.characterBindings.length > 0 ? ` • 🎭${audioTrack.characterBindings.length}` : ''}`}
                    emptyMessage="No audio tracks found." 
                    actionLabel="Delete" 
                    orderedListMode={true} 
                    currentOrderIds={interactionData?.audioTracks?.map(track => track.id) || []} 
                    onToggleOrder={onToggleAudioTrack} 
                />
            )}

            {modals.worldManager.isOpen && (
                <ManagerModal 
                    title="Worlds" 
                    items={allWorlds} 
                    isOpen={modals.worldManager.isOpen} 
                    onClose={modals.worldManager.close}
                    onSelect={(world: World) => worldModalProperties.open(world)} 
                    onDelete={onDeleteWorld} 
                    onCreateNew={() => worldModalProperties.open()}
                    renderSubtext={(world: World) => {
                        const parts = [
                            world.characterIds.length > 0 ? `${world.characterIds.length} characters` : null,
                            world.contextIds.length > 0 ? `${world.contextIds.length} contexts` : null,
                            world.locationIds.length > 0 ? `${world.locationIds.length} locations` : null,
                            world.audioTrackIds?.length > 0 ? `${world.audioTrackIds.length} audios` : null,
                            world.promptBlockIds?.length > 0 ? `${world.promptBlockIds.length} prompts` : null,
                            world.profileId ? 'Has profile' : null,
                            world.description ? `— ${world.description}` : null,
                        ].filter(Boolean);
                        return parts.join(' • ');
                    }}
                    emptyMessage="No worlds saved yet." 
                    actionLabel="Delete" 
                />
            )}

            {modals.promptBlockList.isOpen && (
                <ManagerModal 
                    title="Prompt Blocks" 
                    items={allPromptBlocks} 
                    isOpen={modals.promptBlockList.isOpen} 
                    onClose={modals.promptBlockList.close}
                    onSelect={(promptBlock: PromptBlock) => promptBlockModalProperties.open(promptBlock)} 
                    onDelete={promptBlockModalProperties.delete} 
                    onCreateNew={() => promptBlockModalProperties.open()}
                    renderSubtext={(promptBlock: PromptBlock) => `${promptBlock.textContent ? `📝 ${promptBlock.textContent.length} characters` : ''}${promptBlock.images.length > 0 ? ` • 🖼️ ${promptBlock.images.length}` : ''}${promptBlock.characterBindings.length > 0 ? ` • 🎭${promptBlock.characterBindings.length}` : ''}${promptBlock.contextBindings.length > 0 ? ` • 📜${promptBlock.contextBindings.length}` : ''}${promptBlock.locationBindings.length > 0 ? ` • 📍${promptBlock.locationBindings.length}` : ''}`}
                    emptyMessage="No prompt blocks found." 
                    actionLabel="Delete" 
                />
            )}

            {useMemo(() => {
                if (!modals.modelList.isOpen) return null;
                const strategyModelIds = new Set<string>();
                if (activeStrategy) {
                    for (const modelId of activeStrategy.modelIds) strategyModelIds.add(modelId);
                }
                return (
                    <ManagerModal 
                        title="Language Models" 
                        items={allModels} 
                        isOpen={modals.modelList.isOpen} 
                        onClose={modals.modelList.close}
                        onSelect={(model: LanguageModel) => modelModalProperties.open(model)} 
                        onDelete={onDeleteModel} 
                        onCreateNew={() => modelModalProperties.open()}
                        renderSubtext={(model: LanguageModel) => renderModelSubtext(model, runningModels, selectedModelId)}
                        emptyMessage="No models available." 
                        actionLabel="Delete" 
                        orderedListMode={false}
                        activeSpecialActionId={selectedModelId || undefined} 
                        secondaryActiveIds={strategyModelIds}
                        specialActionIcon="★" 
                        onSpecialAction={(model: LanguageModel) => onToggleModelLoad(model.id)}
                        specialActionTooltip={(model: LanguageModel) => {
                            const modelStatus = runningModels[model.id];
                            const isCloud = !!model.apiKey && !!model.backend && cloudBackends.includes(model.backend as cloudBackend);
                            const inStrategy = strategyModelIds.has(model.id);
                            if (inStrategy && activeStrategy && selectedModelId !== model.id) return `★ In strategy "${activeStrategy.name}" — Click to override & select`;
                            if (isCloud && selectedModelId === model.id) return '☁️ Cloud Model — Click to Deselect';
                            if (isCloud) return '☁️ Cloud Model — Click to Select';
                            if (modelStatus?.isRunning && modelStatus?.isIdle && selectedModelId === model.id) return '⏹ Stop & Deselect';
                            if (modelStatus?.isRunning && modelStatus?.isIdle) return '⏹ Stop Model';
                            if (modelStatus?.isRunning && !modelStatus?.isIdle) return '⏳ Loading...';
                            if (selectedModelId === model.id) return '✓ Already Selected — Click to Load';
                            return '▶ Load & Select Model';
                        }} 
                    />
                );
            }, [modals.modelList.isOpen, modals.modelList.close, allModels, modelModalProperties, onDeleteModel, runningModels, selectedModelId, activeStrategy, onToggleModelLoad])}

            {modals.samplerList.isOpen && (
                <ManagerModal 
                    title="Samplers" 
                    items={allSamplers} 
                    isOpen={modals.samplerList.isOpen} 
                    onClose={modals.samplerList.close}
                    onSelect={(sampler: Sampler) => samplerModalProperties.open(sampler)} 
                    onDelete={onDeleteSampler} 
                    onCreateNew={() => samplerModalProperties.open()}
                    renderSubtext={(sampler: Sampler) => `Temp: ${sampler?.parameters?.temperature}, TopP: ${sampler?.parameters?.top_p}, Tokens: ${sampler?.maximumNumberOfTokens}`}
                    emptyMessage="No samplers found." 
                    actionLabel="Delete" 
                />
            )}

            {modals.stopList.isOpen && (
                <ManagerModal 
                    title="Stop Patterns" 
                    items={allStopPatterns} 
                    isOpen={modals.stopList.isOpen} 
                    onClose={modals.stopList.close}
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
                />
            )}

            {modals.budgetStrategyList.isOpen && (
                <ManagerModal 
                    title="Budget Strategies" 
                    items={allBudgetStrategies} 
                    isOpen={modals.budgetStrategyList.isOpen} 
                    onClose={modals.budgetStrategyList.close}
                    onSelect={(budgetStrategy: BudgetStrategy) => budgetStrategyModalProperties.open(budgetStrategy)} 
                    onDelete={onDeleteBudgetStrategy} 
                    onCreateNew={() => budgetStrategyModalProperties.open()}
                    renderSubtext={renderBudgetStrategySubtext} 
                    emptyMessage="No budget strategies found." 
                    actionLabel="Delete" 
                    orderedListMode={false}
                    activeSpecialActionId={selectedBudgetStrategyId || undefined} 
                    specialActionIcon="★"
                    onSpecialAction={(budgetStrategy: BudgetStrategy) => onActivateBudgetStrategy(budgetStrategy.id)}
                    specialActionTooltip={(budgetStrategy: BudgetStrategy) => selectedBudgetStrategyId === budgetStrategy.id ? `Deactivate ${budgetStrategy.name}` : `Activate ${budgetStrategy.name}`} 
                />
            )}

            {modals.profileList.isOpen && (
                <ManagerModal 
                    title="Profiles" 
                    items={allProfiles} 
                    isOpen={modals.profileList.isOpen} 
                    onClose={modals.profileList.close}
                    onSelect={(profile: Profile) => profileModalProperties.open(profile)} 
                    onDelete={onDeleteProfile} 
                    onCreateNew={() => profileModalProperties.open()}
                    renderSubtext={renderProfileSubtext} 
                    emptyMessage="No profiles found." 
                    actionLabel="Delete" 
                    orderedListMode={false}
                    activeSpecialActionId={interactionData?.Profile?.id || undefined} 
                    specialActionIcon="★"
                    onSpecialAction={(profile: Profile) => onActivateProfile(profile.id)}
                    specialActionTooltip={(profile: Profile) => interactionData?.Profile?.id === profile.id ? `Deactivate ${profile.name}` : `Activate ${profile.name}`} 
                />
            )}

            {modals.extList.isOpen && (
                <ManagerModal 
                    title="Extensions" 
                    items={allExtensions} 
                    isOpen={modals.extList.isOpen} 
                    onClose={modals.extList.close}
                    onSelect={undefined} 
                    onDelete={onDeleteExtension} 
                    onCreateNew={() => addToast('Create Extension Modal coming soon!', 'info')}
                    renderSubtext={(extension: Extension) => renderExtensionSubtext({ extensionType: extension.extensionType, description: extension.description ?? '' })}
                    emptyMessage="No extensions available." 
                    actionLabel="Delete" 
                    orderedListMode={true} 
                    onToggleOrder={onToggleExtension} 
                />
            )}

            {/* ─── Tool / Utility Modals ─── */}

            {modals.settings.isOpen && (
                <SettingsModal
                    isOpen={modals.settings.isOpen}
                    onClose={modals.settings.close}
                    onOpenBudgetControl={modals.budgetControl.open}
                    onOpenParticipantControl={modals.participantControl.open}
                    onOpenAccountData={modals.accountList.open}
                    onOpenMultiplayerData={modals.multiplayerDataList.open}
                    onOpenJoinSession={modals.joinSession.open}
                    onOpenAIRecommendation={modals.aiRecommendation.open}
                    onOpenRestrictionReduction={modals.restrictionReduction.open}
                    onOpenAlternateTimelines={modals.alternateTimelines.open}
                    onOpenImportCharacterCard={modals.cardImport.open}
                    onOpenExportData={modals.exportData.open}
                    onOpenImportData={modals.importData.open}
                    onOpenDataManager={modals.dataManager.open}
                    onOpenSuperSearch={modals.superSearch.open}
                    onOpenGpuMonitor={modals.gpuMonitor.open}
                />
            )}

            {modals.budgetControl.isOpen && (
                <BudgetControlModal isOpen={modals.budgetControl.isOpen} onClose={modals.budgetControl.close} allModels={allModels} activeStrategy={activeStrategy} />
            )}

            {modals.participantControl.isOpen && (
                <ParticipantControlModal 
                    isOpen={modals.participantControl.isOpen} 
                    onClose={modals.participantControl.close}
                    interactionData={interactionData} 
                    onUpdateInteractionData={onUpdateInteractionData}
                    onForceFirstMessage={onForceFirstMessage} 
                    onSendCustomMessage={onSendCustomMessage} 
                    onInjectCustomMessage={onInjectCustomMessage}
                    onInjectFirstMessage={onInjectFirstMessage}
                />
            )}

            {modals.accountList.isOpen && (
                <ManagerModal 
                    title="Accounts" 
                    items={allAccounts} 
                    isOpen={modals.accountList.isOpen} 
                    onClose={modals.accountList.close}
                    onSelect={(account: Account) => accountModalProperties.open(account)} 
                    onDelete={accountModalProperties.delete} 
                    onCreateNew={() => accountModalProperties.open()}
                    renderSubtext={(account: Account) => `👤 ${account.username}${account.url ? ` • 🔗 ${account.url}` : ''}`}
                    emptyMessage="No accounts found." 
                    actionLabel="Delete"
                    specialActionIcon="★"
                    onSpecialAction={(account: Account) => onToggleAccount(account.id)}
                    specialActionTooltip={(account: Account) => currentAccountId === account.id ? `Deactivate ${account.name}` : `Activate ${account.name}`}
                    activeSpecialActionId={currentAccountId || undefined} 
                />
            )}

            {modals.multiplayerDataList.isOpen && (
                <ManagerModal 
                    title="Multiplayer Data" 
                    items={allMultiplayerData} 
                    isOpen={modals.multiplayerDataList.isOpen} 
                    onClose={modals.multiplayerDataList.close}
                    onSelect={(multiplayerDataEntry: MultiplayerData) => multiplayerDataModalProperties.open(multiplayerDataEntry)} 
                    onDelete={onDeleteMultiplayerData} 
                    onCreateNew={() => multiplayerDataModalProperties.open()}
                    renderSubtext={(multiplayerDataEntry: MultiplayerData) => `${multiplayerDataEntry.password ? '🔒' : '🔓'} ${Object.keys(multiplayerDataEntry.multiplayerDataAccountConfigurations || {}).length} accounts • ${multiplayerDataEntry.interactionDataIds.length} sessions`}
                    emptyMessage="No multiplayer data found." 
                    actionLabel="Delete" 
                />
            )}

            {modals.aiRecommendation.isOpen && (
                <AIRecommendationModal 
                    isOpen={modals.aiRecommendation.isOpen} 
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
                    allAudioTracks={allAudioTracks} allPromptBlocks={allPromptBlocks} selectedModel={effectiveTokenizerModel} runningModels={runningModels} 
                />
            )}

            {modals.restrictionReduction.isOpen && (
                <RestrictionReductionModal 
                    isOpen={modals.restrictionReduction.isOpen} 
                    onClose={modals.restrictionReduction.close}
                    onSaveCharacter={async (character: Character) => { onSaveCharacter(character); return true; }}
                    allCharacters={allCharacters} allProfiles={allProfiles} allModels={allModels} allSamplers={allSamplers}
                    runningModels={runningModels} 
                />
            )}

            {modals.alternateTimelines.isOpen && (
                <AlternateTimelinesModal 
                    isOpen={modals.alternateTimelines.isOpen} 
                    onClose={modals.alternateTimelines.close}
                    currentInteractionId={interactionData?.id ?? ''} 
                    rawChatShells={chatShellsWithIdentifiers}
                    onSwitchChat={onSwitchChat} 
                    onDeleteChat={onDeleteChat} 
                    onInspectChat={handleOpenChatInspection} 
                    onRenameChat={onRenameChat} 
                />
            )}

            {modals.cardImport.isOpen && (
                <CharacterCardImportModal 
                    isOpen={modals.cardImport.isOpen} 
                    onClose={modals.cardImport.close}
                    onSaveCharacter={async (character: Character) => { onSaveCharacter(character); return true; }}
                    onSaveContext={async (context: Context) => { onSaveContext(context); return true; }} 
                    allSamplers={allSamplers} 
                />
            )}

            {modals.importData.isOpen && (
                <DataImportModal isOpen={modals.importData.isOpen} onClose={modals.importData.close} onImportComplete={onImportComplete} />
            )}

            {modals.exportData.isOpen && (
                <DataExportModal 
                    isOpen={modals.exportData.isOpen} 
                    onClose={modals.exportData.close}
                    allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations} allAudioTracks={allAudioTracks}
                    allWorlds={allWorlds} allModels={allModels} allSamplers={allSamplers} allPromptBlocks={allPromptBlocks}
                    allStopPatterns={allStopPatterns} allBudgetStrategies={allBudgetStrategies} allProfiles={allProfiles}
                    allMemories={allMemories} allAccounts={allAccounts} allMultiplayerData={allMultiplayerData}
                    rawChatShells={chatShellsWithIdentifiers} 
                />
            )}

            {modals.dataManager.isOpen && (
                <DataManagerModal 
                    isOpen={modals.dataManager.isOpen} 
                    onClose={modals.dataManager.close}
                    allCharacters={allCharacters} 
                    allContexts={allContexts} 
                    allLocations={allLocations} 
                    allAudioTracks={allAudioTracks}
                    allWorlds={allWorlds} 
                    allModels={allModels} 
                    allSamplers={allSamplers} 
                    allPromptBlocks={allPromptBlocks}
                    allStopPatterns={allStopPatterns} 
                    allBudgetStrategies={allBudgetStrategies} 
                    allProfiles={allProfiles}
                    allMemories={allMemories} 
                    allAccounts={allAccounts} 
                    allMultiplayerData={allMultiplayerData} 
                    rawChatShells={chatShellsWithIdentifiers}
                    onDeleteCharacter={onDeleteCharacter} 
                    onDeleteContext={onDeleteContext} 
                    onDeleteLocation={onDeleteLocation}
                    onDeleteAudioTrack={onDeleteAudioTrack} 
                    onDeleteWorld={onDeleteWorld} 
                    onDeleteModel={onDeleteModel}
                    onDeleteSampler={onDeleteSampler} 
                    onDeletePromptBlock={onDeletePromptBlock} 
                    onDeleteStopPattern={onDeleteStopPattern}
                    onDeleteBudgetStrategy={onDeleteBudgetStrategy} 
                    onDeleteProfile={onDeleteProfile} 
                    onDeleteMemory={onDeleteMemory}
                    onDeleteAccount={onDeleteAccount} 
                    onDeleteMultiplayerData={onDeleteMultiplayerData} 
                    onDeleteChat={onDeleteChat} 
                />
            )}

            {/* ─── Super Search Modal (Managed directly by modals.superSearch) ─── */}
            {modals.superSearch?.isOpen && (
                <SuperSearchModal
                    isOpen={modals.superSearch.isOpen}
                    onClose={modals.superSearch.close}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                    allAudioTracks={allAudioTracks}
                    allWorlds={allWorlds}
                    allPromptBlocks={allPromptBlocks}
                    allModels={allModels}
                    allSamplers={allSamplers}
                    allStopPatterns={allStopPatterns}
                    allBudgetStrategies={allBudgetStrategies}
                    allProfiles={allProfiles}
                    allMemories={allMemories}
                    allAccounts={allAccounts}
                    allMultiplayerData={allMultiplayerData}
                    rawChatShells={chatShellsWithIdentifiers}
                    currentInteractionData={interactionData}
                    onSelectEntity={(tabId, entity) => {
                        switch (tabId) {
                            case 'character': characterModalProperties.open(entity); break;
                            case 'context': contextModalProperties.open(entity); break;
                            case 'location': locationModalProperties.open(entity); break;
                            case 'audioTrack': audioTrackModalProperties.open(entity); break;
                            case 'world': worldModalProperties.open(entity); break;
                            case 'promptBlock': promptBlockModalProperties.open(entity); break;
                            case 'model': modelModalProperties.open(entity); break;
                            case 'sampler': samplerModalProperties.open(entity); break;
                            case 'stopPattern': stopPatternModalProperties.open(entity); break;
                            case 'budgetStrategy': budgetStrategyModalProperties.open(entity); break;
                            case 'profile': profileModalProperties.open(entity); break;
                            case 'account': accountModalProperties.open(entity); break;
                            case 'multiplayerData': multiplayerDataModalProperties.open(entity); break;
                            case 'chat': onSwitchChat(entity.id); break;
                            case 'memory':
                                addToast('Memories are managed inside Character settings.', 'info');
                                modals.charList.open();
                                break;
                            default:
                                entityModals.getModalProperties(tabId as any)?.open(entity);
                                break;
                        }
                    }}
                    onJumpToMessage={async (chatId, msgId) => {
                        if ((!interactionData) || (interactionData?.id !== chatId)) onSwitchChat(chatId);
                        if (msgId) {
                            setTimeout(() => {
                                const el = document.querySelector(`[data-message-id="${msgId}"]`);
                                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 3000);
                        }
                    }}
                />
            )}

            <GpuMonitorModal isOpen={modals.gpuMonitor.isOpen} onClose={modals.gpuMonitor.close} />

            {/* ─── Editor Modals ─── */}

            {characterModalProperties.isOpen && (
                <CharacterEditorModal 
                    isOpen={characterModalProperties.isOpen} 
                    onClose={() => { setAiCharacterSaveRedirect(null); characterModalProperties.close(); }}
                    onSave={(character: Character) => { 
                        if (aiCharacterSaveRedirect) { 
                            aiCharacterSaveRedirect(character); 
                            addToast('Applied character changes to AI recommendation.', 'success'); 
                        } else { 
                            characterModalProperties.save(character); 
                        } 
                    }}
                    existingCharacter={characterModalProperties.edit} 
                    allSamplers={allSamplers} 
                    allCharacters={allCharacters}
                    localProtagonist={localProtagonist}
                    interactionData={interactionData}
                    selectedModel={effectiveTokenizerModel} 
                    runningModels={runningModels} 
                    chatNameMap={chatNameMap} 
                />
            )}

            {contextModalProperties.isOpen && (
                <ContextEditorModal 
                    isOpen={contextModalProperties.isOpen} 
                    onClose={() => { setAiContextSaveRedirect(null); contextModalProperties.close(); }}
                    onSave={(context: Context) => { 
                        if (aiContextSaveRedirect) { 
                            aiContextSaveRedirect(context); 
                            addToast('Applied context changes to AI recommendation.', 'success'); 
                        } else { 
                            contextModalProperties.save(context); 
                        } 
                    }}
                    existingContext={contextModalProperties.edit} 
                    allCharacters={allCharacters} 
                />
            )}

            {locationModalProperties.isOpen && (
                <LocationEditorModal 
                    isOpen={locationModalProperties.isOpen} 
                    onClose={() => { setAiLocationSaveRedirect(null); locationModalProperties.close(); }}
                    onSave={(location: Location) => { 
                        if (aiLocationSaveRedirect) { 
                            aiLocationSaveRedirect(location); 
                            addToast('Applied location changes to AI recommendation.', 'success'); 
                        } else { 
                            locationModalProperties.save(location); 
                        } 
                    }}
                    existingLocation={locationModalProperties.edit} 
                    allCharacters={allCharacters} 
                    allLocations={allLocations} 
                    allAudioTracks={allAudioTracks} 
                />
            )}

            {audioTrackModalProperties.isOpen && (
                <AudioTrackEditorModal 
                    isOpen={audioTrackModalProperties.isOpen} 
                    onClose={() => { setAiAudioTrackSaveRedirect(null); audioTrackModalProperties.close(); }}
                    onSave={(audioTrack: AudioTrack) => { 
                        if (aiAudioTrackSaveRedirect) { 
                            aiAudioTrackSaveRedirect(audioTrack); 
                            addToast('Applied audio track changes to AI recommendation.', 'success'); 
                        } else { 
                            audioTrackModalProperties.save(audioTrack); 
                        } 
                    }}
                    existingTrack={audioTrackModalProperties.edit} 
                    allCharacters={allCharacters} 
                    allContexts={allContexts} 
                    allLocations={allLocations} 
                />
            )}

            {worldModalProperties.isOpen && (
                <WorldEditorModal 
                    isOpen={worldModalProperties.isOpen} 
                    onClose={worldModalProperties.close} 
                    onSave={worldModalProperties.save} 
                    onLoadWorld={onLoadWorld}
                    existingWorld={worldModalProperties.edit} 
                    allCharacters={allCharacters} 
                    allContexts={allContexts} 
                    allLocations={allLocations} 
                    allProfiles={allProfiles} 
                    allAudioTracks={allAudioTracks} 
                    allPromptBlocks={allPromptBlocks}
                    selectedCharacterIds={interactionData?.participants.map(participant => participant.id) || []}
                    currentContextIds={interactionData?.contexts?.map(context => context.id) || []}
                    currentLocationIds={interactionData?.locations?.map(location => location.id) || []}
                    currentProfileId={interactionData?.Profile?.id}
                    currentAudioTrackIds={interactionData?.audioTracks?.map(track => track.id) || []} 
                />
            )}

            {modelModalProperties.isOpen && (
                <ModelEditorModal 
                    isOpen={modelModalProperties.isOpen} 
                    onClose={modelModalProperties.close} 
                    onSave={modelModalProperties.save}
                    existingModel={modelModalProperties.edit} 
                    allStopPatterns={allStopPatterns} 
                />
            )}

            {samplerModalProperties.isOpen && (
                <SamplerEditorModal 
                    isOpen={samplerModalProperties.isOpen} 
                    onClose={samplerModalProperties.close} 
                    onSave={samplerModalProperties.save}
                    existingSampler={samplerModalProperties.edit} 
                    allStopPatterns={allStopPatterns} 
                />
            )}

            {promptBlockModalProperties.isOpen && (
                <PromptBlockEditorModal 
                    isOpen={promptBlockModalProperties.isOpen} 
                    onClose={() => { setAiPromptBlockSaveRedirect(null); promptBlockModalProperties.close(); }}
                    onSave={(promptBlock: PromptBlock) => { 
                        if (aiPromptBlockSaveRedirect) { 
                            aiPromptBlockSaveRedirect(promptBlock); 
                            addToast('Applied prompt block changes to AI recommendation.', 'success'); 
                        } else { 
                            promptBlockModalProperties.save(promptBlock); 
                        } 
                    }}
                    existingBlock={promptBlockModalProperties.edit} 
                    allCharacters={allCharacters} 
                    allContexts={allContexts} 
                    allLocations={allLocations} 
                />
            )}

            {stopPatternModalProperties.isOpen && (
                <StopPatternEditorModal 
                    isOpen={stopPatternModalProperties.isOpen} 
                    onClose={stopPatternModalProperties.close} 
                    onSave={stopPatternModalProperties.save}
                    existingStopPattern={stopPatternModalProperties.edit} 
                />
            )}

            {budgetStrategyModalProperties.isOpen && (
                <BudgetStrategyEditorModal 
                    isOpen={budgetStrategyModalProperties.isOpen} 
                    onClose={budgetStrategyModalProperties.close} 
                    onSave={budgetStrategyModalProperties.save}
                    existingStrategy={budgetStrategyModalProperties.edit} 
                    allModels={allModels} 
                />
            )}

            {profileModalProperties.isOpen && (
                <ProfileEditorModal 
                    isOpen={profileModalProperties.isOpen} 
                    onClose={() => { setAiProfileSaveRedirect(null); profileModalProperties.close(); }}
                    onSave={(profile: Profile) => { 
                        if (aiProfileSaveRedirect) { 
                            aiProfileSaveRedirect(profile); 
                            addToast('Applied profile changes to AI recommendation.', 'success'); 
                        } else { 
                            profileModalProperties.save(profile); 
                        } 
                    }}
                    existingProfile={profileModalProperties.edit} 
                    allPromptBlocks={allPromptBlocks} 
                    allSamplers={allSamplers} 
                />
            )}

            {accountModalProperties.isOpen && (
                <AccountEditorModal 
                    isOpen={accountModalProperties.isOpen} 
                    onClose={accountModalProperties.close} 
                    onSave={accountModalProperties.save}
                    existingAccount={accountModalProperties.edit} 
                />
            )}

            {multiplayerDataModalProperties.isOpen && (
                <MultiplayerEditorModal
                    isOpen={multiplayerDataModalProperties.isOpen}
                    onClose={multiplayerDataModalProperties.close}
                    onSave={multiplayerDataModalProperties.save}
                    existingMultiplayerData={multiplayerDataModalProperties.edit}
                    allCharacters={allCharacters}
                    rawChatShells={chatShellsWithIdentifiers}
                    pendingJoinRequests={pendingJoinRequests}
                    onAcceptJoinRequest={onAcceptJoinRequest}
                    onRejectJoinRequest={onRejectJoinRequest}
                />
            )}

            {/* ─── Join Session Modal ─── */}
            <JoinSessionModal
                isOpen={modals.joinSession.isOpen}
                onClose={modals.joinSession.close}
                onJoin={onJoinSession}
            />

            {/* ─── Chat Inspection Modal ─── */}
            <ChatInspectionModal
                isOpen={isInspectionOpen}
                onClose={() => { setIsInspectionOpen(false); setInspectionStack([]); }}
                inspectionStack={inspectionStack}
                onInspectingParentInteractionData={handleInspectParentInteractionData}
            />
        </>
    );
}

export default AppModals;