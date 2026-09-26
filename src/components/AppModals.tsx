// src/components/AppModals.tsx
import type { Character, Context, Location, Sampler, StopPattern, LanguageModel, BudgetStrategy, Profile, Extension, InteractionData, World, AudioTrack, PromptBlock, RawInteractionData, Memory, MultiplayerData, Account, cloudBackend } from '../types';
import type { PendingJoinRequest } from '../hooks/useMultiplayerSync';
import { loadRawInteractionData } from '../storage/serverStorage';
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
import { CharacterCardImportModal } from './CharacterCardImportModal';
import { DataImportModal } from './DataImportModal';
import { DataExportModal } from './DataExportModal';
import { DataManagerModal } from './DataManagerModal';
import { AlternateTimelinesModal } from './AlternateTimelinesModal';
import { ChatInspectionModal } from './ChatInspectionModal';
import { renderModelSubtext, renderBudgetStrategySubtext, renderProfileSubtext, renderChatSubtext, renderContextSubtext, renderLocationSubtext, renderExtensionSubtext } from './renderHelpers';
import { cloudBackends } from '../dictionaries/languageModelInformation';
import { useSessionStore } from '../hooks/useSessionStore';
import { useMemo, useState, useEffect, useCallback } from 'react';

interface ModalVisibility {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

interface EntityModalState<T> {
    isOpen: boolean;
    itemToEdit: T | null;
    open: (item?: T) => void;
    close: () => void;
    handleSave: (item: T) => void;
    handleDelete: (id: string) => Promise<void>;
}

interface AppModalsProps {
    isMultiplayerClient?: boolean;
    modals: Record<string, ModalVisibility>;
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
    charModal: EntityModalState<Character>;
    contextModal: EntityModalState<Context>;
    locationModal: EntityModalState<Location>;
    audioTrackModal: EntityModalState<AudioTrack>;
    promptBlockModal: EntityModalState<PromptBlock>;
    modelModal: EntityModalState<LanguageModel>;
    samplerModal: EntityModalState<Sampler>;
    stopModal: EntityModalState<StopPattern>;
    budgetModal: EntityModalState<BudgetStrategy>;
    profileModal: EntityModalState<Profile>;
    worldModal: EntityModalState<World>;
    accountModal: EntityModalState<Account>;
    multiplayerDataModal: EntityModalState<MultiplayerData>;
    onSwitchChat: (id: string) => void;
    onDeleteChat: (id: string) => void;
    onNewChat: () => void;
    onRenameChat: (id: string, name: string) => void;
    onDeleteCharacter: (id: string) => void;
    onLoadFullCharacter: (id: string) => Promise<Character | null>;
    onToggleParticipant: (id: string) => void;
    onSetProtagonist: (id: string) => void;
    onSaveCharacter: (c: Character) => void;
    onDeleteContext: (id: string) => void;
    onToggleContext: (id: string) => void;
    onSaveContext: (c: Context) => void;
    onDeleteLocation: (id: string) => void;
    onToggleLocation: (id: string) => void;
    onSaveLocation: (l: Location) => void;
    onDeleteAudioTrack: (id: string) => void;
    onToggleAudioTrack: (id: string) => void;
    onSaveAudioTrack: (t: AudioTrack) => void;
    onDeletePromptBlock: (id: string) => void;
    onDeleteModel: (id: string) => void;
    onToggleModelLoad: (id: string) => void;
    onDeleteSampler: (id: string) => void;
    onDeleteStopPattern: (id: string) => void;
    onDeleteBudgetStrategy: (id: string) => void;
    onActivateBudgetStrategy: (id: string) => void;
    onDeleteProfile: (id: string) => void;
    onActivateProfile: (id: string) => void;
    onSaveProfile: (p: Profile) => void;
    onDeleteExtension: (id: string) => void;
    onToggleExtension: (id: string) => void;
    onSaveWorld: (w: World) => void;
    onLoadWorld: (world: World) => void;
    onDeleteWorld: (id: string) => void;
    onDeleteMemory: (id: string) => void;
    onDeleteAccount: (id: string) => void;
    onToggleAccount: (id: string) => void;
    onDeleteMultiplayerData: (id: string) => void;
    onJoinSession: (sessionId: string, password: string, reqCharId: string | null, reqCharData: Character | null) => void;
    onUpdateInteractionData: (data: InteractionData) => void;
    onForceFirstMessage: (c: Character) => void;
    onSendCustomMessage: (c: Character, t: string) => void;
    onInjectCustomMessage: (c: Character, t: string) => void;
    onInjectFirstMessage: (c: Character) => void;
    onImportComplete: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    ensureChatsLoaded: () => void;
    pendingJoinRequests?: PendingJoinRequest[];
    onAcceptJoinRequest?: (accountId: string) => void;
    onRejectJoinRequest?: (accountId: string) => void;
}

type ChatShellWithId = RawInteractionData & { id: string };

function deriveLocalProtagonist(
    interactionData: InteractionData | null,
    multiplayerData: MultiplayerData | null,
    currentAccountId: string | null,
): Character | null {
    if (!interactionData?.protagonists?.length) return null;
    if (!multiplayerData || !currentAccountId) {
        return interactionData.protagonists[0] ?? null;
    }
    const myCharIds = multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.activeCharacterId;
    if (myCharIds) {
        const found = interactionData.protagonists.find(p => p.id === myCharIds) || interactionData.participants.find(p => p.id === myCharIds);
        if (found) return found;
    }
    return interactionData.protagonists[0] ?? null;
}

export function AppModals({
    isMultiplayerClient,
    modals, runningModels,
    rawChatShells, allCharacters, allContexts, allLocations, allAudioTracks,
    allSamplers, allStopPatterns, allModels, allBudgetStrategies,
    allProfiles, allExtensions, allWorlds, allPromptBlocks, allMemories,
    allAccounts, allMultiplayerData,
    charModal, contextModal, locationModal, audioTrackModal,
    samplerModal, stopModal, modelModal, budgetModal,
    profileModal, worldModal, promptBlockModal,
    accountModal, multiplayerDataModal,
    onSwitchChat, onDeleteChat, onNewChat, onRenameChat,
    onDeleteCharacter, onLoadFullCharacter, onToggleParticipant, onSetProtagonist, onSaveCharacter,
    onDeleteContext, onToggleContext, onSaveContext,
    onDeleteLocation, onToggleLocation, onSaveLocation,
    onDeleteAudioTrack, onToggleAudioTrack, onSaveAudioTrack,
    onDeleteModel, onToggleModelLoad,
    onDeleteSampler,
    onDeleteStopPattern,
    onDeleteBudgetStrategy, onActivateBudgetStrategy,
    onDeleteProfile, onActivateProfile, onSaveProfile,
    onDeleteExtension, onToggleExtension,
    onSaveWorld, onLoadWorld, onDeleteWorld,
    onDeletePromptBlock,
    onDeleteMemory,
    onDeleteAccount, onToggleAccount,
    onDeleteMultiplayerData,
    onJoinSession,
    onUpdateInteractionData, onForceFirstMessage, onSendCustomMessage, onInjectCustomMessage, onInjectFirstMessage,
    onImportComplete, addToast, ensureChatsLoaded,
    pendingJoinRequests, onAcceptJoinRequest, onRejectJoinRequest,
}: AppModalsProps) {
    const interactionData = useSessionStore(s => s.interactionData);
    const activeStrategy = useSessionStore(s => s.activeStrategy);
    const selectedModelId = useSessionStore(s => s.selectedModel?.id ?? null);
    const lastSelectedModelId = useSessionStore(s => s.lastSelectedModelId);
    const selectedBudgetStrategyId = useSessionStore(s => s.activeStrategy?.id ?? null);
    const currentAccountId = useSessionStore(s => s.currentAccountId);
    const multiplayerData = useSessionStore(s => s.multiplayerData);

    const localProtagonist = useMemo(
        () => deriveLocalProtagonist(interactionData, multiplayerData, currentAccountId),
        [interactionData, multiplayerData, currentAccountId],
    );

    const effectiveTokenizerModel = useMemo(() => {
        if (selectedModelId) return allModels.find(m => m.id === selectedModelId) ?? null;
        if (lastSelectedModelId) return allModels.find(m => m.id === lastSelectedModelId) ?? null;
        return null;
    }, [selectedModelId, lastSelectedModelId, allModels]);

    const [aiCharacterSaveRedirect, setAiCharacterSaveRedirect] = useState<((c: Character) => void) | null>(null);
    const [aiContextSaveRedirect, setAiContextSaveRedirect] = useState<((c: Context) => void) | null>(null);
    const [aiLocationSaveRedirect, setAiLocationSaveRedirect] = useState<((l: Location) => void) | null>(null);
    const [aiAudioTrackSaveRedirect, setAiAudioTrackSaveRedirect] = useState<((t: AudioTrack) => void) | null>(null);
    const [aiPromptBlockSaveRedirect, setAiPromptBlockSaveRedirect] = useState<((b: PromptBlock) => void) | null>(null);
    const [aiProfileSaveRedirect, setAiProfileSaveRedirect] = useState<((p: Profile) => void) | null>(null);

    const [gpuMonitorOpen, setGpuMonitorOpen] = useState(false);
    const [joinSessionOpen, setJoinSessionOpen] = useState(false);

    const [inspectionStack, setInspectionStack] = useState<InteractionData[]>([]);
    const [isInspectionOpen, setIsInspectionOpen] = useState(false);

    const chatShellsWithIds = useMemo(
        () => rawChatShells.filter((s): s is ChatShellWithId => !!s.id),
        [rawChatShells],
    );

    const chatNameMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const shell of chatShellsWithIds) {
            map.set(shell.id, shell.name || 'Untitled Chat');
        }
        return map;
    }, [chatShellsWithIds]);

    useEffect(() => {
        if (modals.chatList.isOpen) {
            ensureChatsLoaded();
        }
    }, [modals.chatList.isOpen, ensureChatsLoaded]);

    const handleOpenChatInspection = useCallback(async (chatId: string) => {
        const loaded = await loadRawInteractionData(chatId, allCharacters);
        if (!loaded) { addToast('Failed to load chat for inspection.', 'error'); return; }
        setInspectionStack([loaded]);
        setIsInspectionOpen(true);
    }, [allCharacters, addToast]);

    const handleInspectParentInteractionData = useCallback(async (parentId: string): Promise<InteractionData> => {
        const loaded = await loadRawInteractionData(parentId, allCharacters);
        if (!loaded) throw new Error(`Failed to load parent chat ${parentId}`);
        return loaded;
    }, [allCharacters]);

    return (
        <>
            {/* ─── Manager Lists ─── */}

            {modals.chatList.isOpen && (
                <ManagerModal
                    title="Chat Sessions"
                    items={chatShellsWithIds}
                    isOpen={modals.chatList.isOpen}
                    onClose={modals.chatList.close}
                    onSelect={(item) => { handleOpenChatInspection(item.id); modals.chatList.close(); }}
                    onDelete={(id: string) => onDeleteChat(id)}
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
                    onSelect={isMultiplayerClient ? undefined : async (c: Character) => { const f = c.sampler ? c : await onLoadFullCharacter(c.id); charModal.open(f || c); }}
                    onDelete={isMultiplayerClient ? undefined : onDeleteCharacter}
                    onCreateNew={isMultiplayerClient ? () => {} : () => charModal.open()}
                    renderSubtext={(c: Character) => c.description || 'No description'}
                    emptyMessage="No characters found."
                    actionLabel="Delete"
                    orderedListMode={!!interactionData && !isMultiplayerClient}
                    currentOrderIds={interactionData?.participants.map(p => p.id) || []}
                    onToggleOrder={isMultiplayerClient ? undefined : onToggleParticipant}
                    specialActionIcon="★"
                    onSpecialAction={isMultiplayerClient ? undefined : (c: Character) => onSetProtagonist(c.id)}
                    specialActionTooltip={(c: Character) => `set ${c.name} as the protagonist`}
                    activeSpecialActionId={localProtagonist?.id}
                />
            )}

            {modals.contextList.isOpen && (
                <ManagerModal title="Contexts" items={allContexts} isOpen={modals.contextList.isOpen} onClose={modals.contextList.close}
                    onSelect={(c: Context) => contextModal.open(c)} onDelete={onDeleteContext} onCreateNew={() => contextModal.open()}
                    renderSubtext={renderContextSubtext} emptyMessage="No contexts found." actionLabel="Delete"
                    orderedListMode={true} currentOrderIds={interactionData?.contexts?.map(i => i.id) || []} onToggleOrder={onToggleContext} />
            )}

            {modals.locationList.isOpen && (
                <ManagerModal title="Locations" items={allLocations} isOpen={modals.locationList.isOpen} onClose={modals.locationList.close}
                    onSelect={(l: Location) => locationModal.open(l)} onDelete={onDeleteLocation} onCreateNew={() => locationModal.open()}
                    renderSubtext={renderLocationSubtext} emptyMessage="No locations found." actionLabel="Delete"
                    orderedListMode={true} currentOrderIds={interactionData?.locations?.map(l => l.id) || []} onToggleOrder={onToggleLocation} />
            )}

            {modals.audioTrackList.isOpen && (
                <ManagerModal title="Audio Tracks" items={allAudioTracks} isOpen={modals.audioTrackList.isOpen} onClose={modals.audioTrackList.close}
                    onSelect={(t: AudioTrack) => audioTrackModal.open(t)} onDelete={onDeleteAudioTrack} onCreateNew={() => audioTrackModal.open()}
                    renderSubtext={(t: AudioTrack) => `${t.audioCategory === 'ambient' ? '🌿' : t.audioCategory === 'music' ? '🎵' : '💥'} ${t.loop ? '🔁' : '▶️'} Vol: ${Math.round(t.volume * 100)}%${t.priority > 0 ? ` • ⬆${t.priority}` : ''}${t.locationBindings.length > 0 ? ` • 📍${t.locationBindings.length}` : ''}${t.contextBindings.length > 0 ? ` • 📜${t.contextBindings.length}` : ''}${t.characterBindings.length > 0 ? ` • 🎭${t.characterBindings.length}` : ''}`}
                    emptyMessage="No audio tracks found." actionLabel="Delete"
                    orderedListMode={true} currentOrderIds={interactionData?.audioTracks?.map(t => t.id) || []} onToggleOrder={onToggleAudioTrack} />
            )}

            {modals.worldManager.isOpen && (
                <ManagerModal title="Worlds" items={allWorlds} isOpen={modals.worldManager.isOpen} onClose={modals.worldManager.close}
                    onSelect={(w: World) => worldModal.open(w)} onDelete={onDeleteWorld} onCreateNew={() => worldModal.open()}
                    renderSubtext={(w: World) => {
                        const parts = [
                            w.characterIds.length > 0 ? `${w.characterIds.length} characters` : null,
                            w.contextIds.length > 0 ? `${w.contextIds.length} contexts` : null,
                            w.locationIds.length > 0 ? `${w.locationIds.length} locations` : null,
                            w.audioTrackIds?.length > 0 ? `${w.audioTrackIds.length} audios` : null,
                            w.promptBlockIds?.length > 0 ? `${w.promptBlockIds.length} prompts` : null,
                            w.profileId ? 'Has profile' : null,
                            w.description ? `— ${w.description}` : null,
                        ].filter(Boolean);

                        return parts.join(' • ');
                    }}
                    emptyMessage="No worlds saved yet." actionLabel="Delete" />
            )}

            {modals.promptBlockList.isOpen && (
                <ManagerModal title="Prompt Blocks" items={allPromptBlocks} isOpen={modals.promptBlockList.isOpen} onClose={modals.promptBlockList.close}
                    onSelect={(b: PromptBlock) => promptBlockModal.open(b)} onDelete={promptBlockModal.handleDelete} onCreateNew={() => promptBlockModal.open()}
                    renderSubtext={(b: PromptBlock) => `${b.textContent ? `📝 ${b.textContent.length} characters` : ''}${b.images.length > 0 ? ` • 🖼️ ${b.images.length}` : ''}${b.characterBindings.length > 0 ? ` • 🎭${b.characterBindings.length}` : ''}${b.contextBindings.length > 0 ? ` • 📜${b.contextBindings.length}` : ''}${b.locationBindings.length > 0 ? ` • 📍${b.locationBindings.length}` : ''}`}
                    emptyMessage="No prompt blocks found." actionLabel="Delete" />
            )}

            {useMemo(() => {
                if (!modals.modelList.isOpen) return null;
                const strategyModelIds = new Set<string>();
                if (activeStrategy) {
                    for (const m of activeStrategy.onlineModels) strategyModelIds.add(m.id);
                    for (const m of activeStrategy.localModels) strategyModelIds.add(m.id);
                }
                return (
                    <ManagerModal title="Language Models" items={allModels} isOpen={modals.modelList.isOpen} onClose={modals.modelList.close}
                        onSelect={(m: LanguageModel) => modelModal.open(m)} onDelete={onDeleteModel} onCreateNew={() => modelModal.open()}
                        renderSubtext={(m: LanguageModel) => renderModelSubtext(m, runningModels, selectedModelId)}
                        emptyMessage="No models available." actionLabel="Delete" orderedListMode={false}
                        activeSpecialActionId={selectedModelId || undefined} secondaryActiveIds={strategyModelIds}
                        specialActionIcon="★" onSpecialAction={(m: LanguageModel) => onToggleModelLoad(m.id)}
                        specialActionTooltip={(m: LanguageModel) => {
                            const ms = runningModels[m.id];
                            const isCloud = !!m.apiKey && !!m.backend && cloudBackends.includes(m.backend as cloudBackend);
                            const inStrategy = strategyModelIds.has(m.id);
                            if (inStrategy && activeStrategy && selectedModelId !== m.id) return `★ In strategy "${activeStrategy.name}" — Click to override & select`;
                            if (isCloud && selectedModelId === m.id) return '☁️ Cloud Model — Click to Deselect';
                            if (isCloud) return '☁️ Cloud Model — Click to Select';
                            if (ms?.isRunning && ms?.isIdle && selectedModelId === m.id) return '⏹ Stop & Deselect';
                            if (ms?.isRunning && ms?.isIdle) return '⏹ Stop Model';
                            if (ms?.isRunning && !ms?.isIdle) return '⏳ Loading...';
                            if (selectedModelId === m.id) return '✓ Already Selected — Click to Load';
                            return '▶ Load & Select Model';
                        }} />
                );
            }, [modals.modelList.isOpen, modals.modelList.close, allModels, modelModal, onDeleteModel, runningModels, selectedModelId, activeStrategy, onToggleModelLoad])}

            {modals.samplerList.isOpen && (
                <ManagerModal title="Samplers" items={allSamplers} isOpen={modals.samplerList.isOpen} onClose={modals.samplerList.close}
                    onSelect={(s: Sampler) => samplerModal.open(s)} onDelete={onDeleteSampler} onCreateNew={() => samplerModal.open()}
                    renderSubtext={(s: Sampler) => `Temp: ${s?.parameters?.temperature}, TopP: ${s?.parameters?.top_p}, Tokens: ${s?.maximumNumberOfTokens}`}
                    emptyMessage="No samplers found." actionLabel="Delete" />
            )}

            {modals.stopList.isOpen && (
                <ManagerModal title="Stop Patterns" items={allStopPatterns} isOpen={modals.stopList.isOpen} onClose={modals.stopList.close}
                    onSelect={(s: StopPattern) => stopModal.open(s)} onDelete={onDeleteStopPattern} onCreateNew={() => stopModal.open()}
                    renderSubtext={(s: StopPattern) => {
                        const hasActivationTriggers = (s.regularExpressionActivationTriggers?.length ?? 0) > 0;
                        return (<span style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block' }}>{hasActivationTriggers ? '⚡' : '📌'} Pattern: {s.pattern}</span>);
                    }}
                    emptyMessage="No stop patterns found." actionLabel="Delete" orderedListMode={false} />
            )}

            {modals.budgetStrategyList.isOpen && (
                <ManagerModal title="Budget Strategies" items={allBudgetStrategies} isOpen={modals.budgetStrategyList.isOpen} onClose={modals.budgetStrategyList.close}
                    onSelect={(s: BudgetStrategy) => budgetModal.open(s)} onDelete={onDeleteBudgetStrategy} onCreateNew={() => budgetModal.open()}
                    renderSubtext={renderBudgetStrategySubtext} emptyMessage="No budget strategies found." actionLabel="Delete" orderedListMode={false}
                    activeSpecialActionId={selectedBudgetStrategyId || undefined} specialActionIcon="★"
                    onSpecialAction={(s: BudgetStrategy) => onActivateBudgetStrategy(s.id)}
                    specialActionTooltip={(s: BudgetStrategy) => selectedBudgetStrategyId === s.id ? `Deactivate ${s.name}` : `Activate ${s.name}`} />
            )}

            {modals.profileList.isOpen && (
                <ManagerModal title="Profiles" items={allProfiles} isOpen={modals.profileList.isOpen} onClose={modals.profileList.close}
                    onSelect={(p: Profile) => profileModal.open(p)} onDelete={onDeleteProfile} onCreateNew={() => profileModal.open()}
                    renderSubtext={renderProfileSubtext} emptyMessage="No profiles found." actionLabel="Delete" orderedListMode={false}
                    activeSpecialActionId={interactionData?.Profile?.id || undefined} specialActionIcon="★"
                    onSpecialAction={(p: Profile) => onActivateProfile(p.id)}
                    specialActionTooltip={(p: Profile) => interactionData?.Profile?.id === p.id ? `Deactivate ${p.name}` : `Activate ${p.name}`} />
            )}

            {modals.extList.isOpen && (
                <ManagerModal title="Extensions" items={allExtensions} isOpen={modals.extList.isOpen} onClose={modals.extList.close}
                    onSelect={undefined} onDelete={onDeleteExtension} onCreateNew={() => addToast('Create Extension Modal coming soon!', 'info')}
                    renderSubtext={(ext: Extension) => renderExtensionSubtext({ extensionType: ext.extensionType, description: ext.description ?? '' })}
                    emptyMessage="No extensions available." actionLabel="Delete" orderedListMode={true} onToggleOrder={onToggleExtension} />
            )}

            {/* ─── Tool / Utility Modals ─── */}

            {modals.settings.isOpen && (
                <SettingsModal
                    isOpen={modals.settings.isOpen}
                    onClose={modals.settings.close}
                    onOpenBudgetControl={modals.budgetControl.open}
                    onOpenGpuMonitor={() => { setGpuMonitorOpen(true); }}
                    onOpenParticipantControl={modals.participantControl.open}
                    onOpenAccountData={modals.accountList.open}
                    onOpenMultiplayerData={modals.multiplayerDataList.open}
                    onOpenJoinSession={() => { setJoinSessionOpen(true); }}
                    onOpenAIRecommendation={modals.aiRecommendation.open}
                    onOpenAlternateTimelines={modals.alternateTimelines.open}
                    onOpenImportCharacterCard={modals.cardImport.open}
                    onOpenExportData={modals.exportData.open}
                    onOpenImportData={modals.importData.open}
                    onOpenDataManager={modals.dataManager.open}
                />
            )}

            {modals.budgetControl.isOpen && (
                <BudgetControlModal isOpen={modals.budgetControl.isOpen} onClose={modals.budgetControl.close} activeStrategy={activeStrategy} />
            )}

            <GpuMonitorModal isOpen={gpuMonitorOpen} onClose={() => setGpuMonitorOpen(false)} />

            {modals.participantControl.isOpen && (
                <ParticipantControlModal isOpen={modals.participantControl.isOpen} onClose={modals.participantControl.close}
                    interactionData={interactionData} onUpdateInteractionData={onUpdateInteractionData}
                    onForceFirstMessage={onForceFirstMessage} onSendCustomMessage={onSendCustomMessage}
                    onInjectCustomMessage={onInjectCustomMessage} onInjectFirstMessage={onInjectFirstMessage} />
            )}

            {modals.accountList.isOpen && (
                <ManagerModal title="Accounts" items={allAccounts} isOpen={modals.accountList.isOpen} onClose={modals.accountList.close}
                    onSelect={(a: Account) => accountModal.open(a)} onDelete={accountModal.handleDelete} onCreateNew={() => accountModal.open()}
                    renderSubtext={(a: Account) => `👤 ${a.username}${a.url ? ` • 🔗 ${a.url}` : ''}`}
                    emptyMessage="No accounts found." actionLabel="Delete"
                    specialActionIcon="★"
                    onSpecialAction={(a: Account) => onToggleAccount(a.id)}
                    specialActionTooltip={(a: Account) => currentAccountId === a.id ? `Deactivate ${a.name}` : `Activate ${a.name}`}
                    activeSpecialActionId={currentAccountId || undefined} />
            )}

            {modals.multiplayerDataList.isOpen && (
                <ManagerModal title="Multiplayer Data" items={allMultiplayerData} isOpen={modals.multiplayerDataList.isOpen} onClose={modals.multiplayerDataList.close}
                    onSelect={(m: MultiplayerData) => multiplayerDataModal.open(m)} onDelete={onDeleteMultiplayerData} onCreateNew={() => multiplayerDataModal.open()}
                    renderSubtext={(m: MultiplayerData) => `${m.password ? '🔒' : '🔓'} ${Object.keys(m.multiplayerDataAccountConfigurations || {}).length} accounts • ${m.interactionDataIds.length} sessions`}
                    emptyMessage="No multiplayer data found." actionLabel="Delete" />
            )}

            {modals.aiRecommendation.isOpen && (
                <AIRecommendationModal isOpen={modals.aiRecommendation.isOpen} onClose={modals.aiRecommendation.close}
                    onSaveCharacter={async (c: Character) => { onSaveCharacter(c); return true; }}
                    onSaveContext={async (c: Context) => { onSaveContext(c); return true; }}
                    onSaveLocation={async (l: Location) => { onSaveLocation(l); return true; }}
                    onSaveAudioTrack={async (t: AudioTrack) => { onSaveAudioTrack(t); return true; }}
                    onSaveProfile={async (p: Profile) => { onSaveProfile(p); return true; }}
                    onSaveWorld={async (w: World) => { onSaveWorld(w); return true; }}
                    onSavePromptBlock={async (b: PromptBlock) => { promptBlockModal.handleSave(b); return true; }}
                    onOpenCharacterEditor={(char, onApplyToRecommendation) => { setAiCharacterSaveRedirect(() => onApplyToRecommendation); charModal.open(char ?? undefined); }}
                    onOpenContextEditor={(context, onApplyToRecommendation) => { setAiContextSaveRedirect(() => onApplyToRecommendation); contextModal.open(context ?? undefined); }}
                    onOpenLocationEditor={(loc, onApplyToRecommendation) => { setAiLocationSaveRedirect(() => onApplyToRecommendation); locationModal.open(loc ?? undefined); }}
                    onOpenAudioTrackEditor={(track, onApplyToRecommendation) => { setAiAudioTrackSaveRedirect(() => onApplyToRecommendation); audioTrackModal.open(track ?? undefined); }}
                    onOpenPromptBlockEditor={(block, onApplyToRecommendation) => { setAiPromptBlockSaveRedirect(() => onApplyToRecommendation); promptBlockModal.open(block ?? undefined); }}
                    onOpenProfileEditor={(profile, onApplyToRecommendation) => { setAiProfileSaveRedirect(() => onApplyToRecommendation); profileModal.open(profile ?? undefined); }}
                    allSamplers={allSamplers} allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations}
                    allAudioTracks={allAudioTracks} allPromptBlocks={allPromptBlocks} selectedModel={effectiveTokenizerModel} runningModels={runningModels} />
            )}

            {modals.alternateTimelines.isOpen && (
                <AlternateTimelinesModal isOpen={modals.alternateTimelines.isOpen} onClose={modals.alternateTimelines.close}
                    currentInteractionId={interactionData?.id ?? ''} rawChatShells={chatShellsWithIds}
                    onSwitchChat={onSwitchChat} onDeleteChat={onDeleteChat} onInspectChat={handleOpenChatInspection} onRenameChat={onRenameChat} />
            )}

            {modals.cardImport.isOpen && (
                <CharacterCardImportModal isOpen={modals.cardImport.isOpen} onClose={modals.cardImport.close}
                    onSaveCharacter={async (c: Character) => { onSaveCharacter(c); return true; }}
                    onSaveContext={async (c: Context) => { onSaveContext(c); return true; }}
                    allSamplers={allSamplers} />
            )}

            {modals.importData.isOpen && (
                <DataImportModal isOpen={modals.importData.isOpen} onClose={modals.importData.close} onImportComplete={onImportComplete} />
            )}

            {modals.exportData.isOpen && (
                <DataExportModal isOpen={modals.exportData.isOpen} onClose={modals.exportData.close}
                    allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations} allAudioTracks={allAudioTracks}
                    allWorlds={allWorlds} allModels={allModels} allSamplers={allSamplers} allPromptBlocks={allPromptBlocks}
                    allStopPatterns={allStopPatterns} allBudgetStrategies={allBudgetStrategies} allProfiles={allProfiles}
                    allMemories={allMemories} allAccounts={allAccounts} allMultiplayerData={allMultiplayerData}
                    rawChatShells={chatShellsWithIds} />
            )}

            {modals.dataManager.isOpen && (
                <DataManagerModal isOpen={modals.dataManager.isOpen} onClose={modals.dataManager.close}
                    allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations} allAudioTracks={allAudioTracks}
                    allWorlds={allWorlds} allModels={allModels} allSamplers={allSamplers} allPromptBlocks={allPromptBlocks}
                    allStopPatterns={allStopPatterns} allBudgetStrategies={allBudgetStrategies} allProfiles={allProfiles}
                    allMemories={allMemories} allAccounts={allAccounts} allMultiplayerData={allMultiplayerData} rawChatShells={chatShellsWithIds}
                    onDeleteCharacter={onDeleteCharacter} onDeleteContext={onDeleteContext} onDeleteLocation={onDeleteLocation}
                    onDeleteAudioTrack={onDeleteAudioTrack} onDeleteWorld={onDeleteWorld} onDeleteModel={onDeleteModel}
                    onDeleteSampler={onDeleteSampler} onDeletePromptBlock={onDeletePromptBlock} onDeleteStopPattern={onDeleteStopPattern}
                    onDeleteBudgetStrategy={onDeleteBudgetStrategy} onDeleteProfile={onDeleteProfile} onDeleteMemory={onDeleteMemory}
                    onDeleteAccount={onDeleteAccount} onDeleteMultiplayerData={onDeleteMultiplayerData} onDeleteChat={onDeleteChat} />
            )}

            {/* ─── Editor Modals ─── */}

            {charModal.isOpen && (
                <CharacterEditorModal isOpen={charModal.isOpen} onClose={() => { setAiCharacterSaveRedirect(null); charModal.close(); }}
                    onSave={(c: Character) => { if (aiCharacterSaveRedirect) { aiCharacterSaveRedirect(c); addToast('Applied character changes to AI recommendation.', 'success'); } else { charModal.handleSave(c); } }}
                    existingCharacter={charModal.itemToEdit} allSamplers={allSamplers} allCharacters={allCharacters} selectedModel={effectiveTokenizerModel} runningModels={runningModels} chatNameMap={chatNameMap} />
            )}

            {contextModal.isOpen && (
                <ContextEditorModal isOpen={contextModal.isOpen} onClose={() => { setAiContextSaveRedirect(null); contextModal.close(); }}
                    onSave={(c: Context) => { if (aiContextSaveRedirect) { aiContextSaveRedirect(c); addToast('Applied context changes to AI recommendation.', 'success'); } else { contextModal.handleSave(c); } }}
                    existingContext={contextModal.itemToEdit} allCharacters={allCharacters} />
            )}

            {locationModal.isOpen && (
                <LocationEditorModal isOpen={locationModal.isOpen} onClose={() => { setAiLocationSaveRedirect(null); locationModal.close(); }}
                    onSave={(l: Location) => { if (aiLocationSaveRedirect) { aiLocationSaveRedirect(l); addToast('Applied location changes to AI recommendation.', 'success'); } else { locationModal.handleSave(l); } }}
                    existingLocation={locationModal.itemToEdit} allCharacters={allCharacters} allLocations={allLocations} allAudioTracks={allAudioTracks} />
            )}

            {audioTrackModal.isOpen && (
                <AudioTrackEditorModal isOpen={audioTrackModal.isOpen} onClose={() => { setAiAudioTrackSaveRedirect(null); audioTrackModal.close(); }}
                    onSave={(t: AudioTrack) => { if (aiAudioTrackSaveRedirect) { aiAudioTrackSaveRedirect(t); addToast('Applied audio track changes to AI recommendation.', 'success'); } else { audioTrackModal.handleSave(t); } }}
                    existingTrack={audioTrackModal.itemToEdit} allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations} />
            )}

            {worldModal.isOpen && (
                <WorldEditorModal isOpen={worldModal.isOpen} onClose={worldModal.close} onSave={worldModal.handleSave} onLoadWorld={onLoadWorld}
                    existingWorld={worldModal.itemToEdit} allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations}
                    allProfiles={allProfiles} allAudioTracks={allAudioTracks} allPromptBlocks={allPromptBlocks}
                    currentCharacterIds={interactionData?.participants.map(p => p.id) || []}
                    currentContextIds={interactionData?.contexts?.map(c => c.id) || []}
                    currentLocationIds={interactionData?.locations?.map(l => l.id) || []}
                    currentProfileId={interactionData?.Profile?.id}
                    currentAudioTrackIds={interactionData?.audioTracks?.map(t => t.id) || []} />
            )}

            {modelModal.isOpen && (
                <ModelEditorModal isOpen={modelModal.isOpen} onClose={modelModal.close} onSave={modelModal.handleSave}
                    existingModel={modelModal.itemToEdit} allStopPatterns={allStopPatterns} />
            )}

            {samplerModal.isOpen && (
                <SamplerEditorModal isOpen={samplerModal.isOpen} onClose={samplerModal.close} onSave={samplerModal.handleSave}
                    existingSampler={samplerModal.itemToEdit} allStopPatterns={allStopPatterns} />
            )}

            {promptBlockModal.isOpen && (
                <PromptBlockEditorModal isOpen={promptBlockModal.isOpen} onClose={() => { setAiPromptBlockSaveRedirect(null); promptBlockModal.close(); }}
                    onSave={(b: PromptBlock) => { if (aiPromptBlockSaveRedirect) { aiPromptBlockSaveRedirect(b); addToast('Applied prompt block changes to AI recommendation.', 'success'); } else { promptBlockModal.handleSave(b); } }}
                    existingBlock={promptBlockModal.itemToEdit} allCharacters={allCharacters} allContexts={allContexts} allLocations={allLocations} />
            )}

            {stopModal.isOpen && (
                <StopPatternEditorModal isOpen={stopModal.isOpen} onClose={stopModal.close} onSave={stopModal.handleSave}
                    existingStopPattern={stopModal.itemToEdit} />
            )}

            {budgetModal.isOpen && (
                <BudgetStrategyEditorModal isOpen={budgetModal.isOpen} onClose={budgetModal.close} onSave={budgetModal.handleSave}
                    existingStrategy={budgetModal.itemToEdit} allModels={allModels} />
            )}

            {profileModal.isOpen && (
                <ProfileEditorModal isOpen={profileModal.isOpen} onClose={() => { setAiProfileSaveRedirect(null); profileModal.close(); }}
                    onSave={(p: Profile) => { if (aiProfileSaveRedirect) { aiProfileSaveRedirect(p); addToast('Applied profile changes to AI recommendation.', 'success'); } else { profileModal.handleSave(p); } }}
                    existingProfile={profileModal.itemToEdit} allPromptBlocks={allPromptBlocks} allSamplers={allSamplers} />
            )}

            {accountModal.isOpen && (
                <AccountEditorModal isOpen={accountModal.isOpen} onClose={accountModal.close} onSave={accountModal.handleSave}
                    existingAccount={accountModal.itemToEdit} />
            )}

            {multiplayerDataModal.isOpen && (
                <MultiplayerEditorModal
                    isOpen={multiplayerDataModal.isOpen}
                    onClose={multiplayerDataModal.close}
                    onSave={multiplayerDataModal.handleSave}
                    existingMultiplayerData={multiplayerDataModal.itemToEdit}
                    allCharacters={allCharacters}
                    rawChatShells={chatShellsWithIds}
                    pendingJoinRequests={pendingJoinRequests}
                    onAcceptJoinRequest={onAcceptJoinRequest}
                    onRejectJoinRequest={onRejectJoinRequest}
                />
            )}

            {/* ─── Join Session Modal ─── */}
            <JoinSessionModal
                isOpen={joinSessionOpen}
                onClose={() => setJoinSessionOpen(false)}
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