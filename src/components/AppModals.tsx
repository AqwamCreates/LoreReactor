// src/components/AppModals.tsx
import type { Character, Context, Location, Sampler, StopPattern, LanguageModel, BudgetStrategy, Profile, Extension, InteractionData, World, AudioTrack, PromptBlock, RawInteractionData, Memory, cloudBackend } from '../types';
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
import { SettingsModal } from './SettingsModal';
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
import { renderModelSubtext, renderBudgetStrategySubtext, renderProfileSubtext, renderChatSubtext, renderContextSubtext, renderLocationSubtext, renderExtensionSubtext } from './renderHelpers';
import { cloudBackends } from '../languageModelInformation';
import { useSessionStore } from '../hooks/useSessionStore';
import { useMemo, useState, useEffect } from 'react';

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
    // Modals & data
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
    // Entity modals
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
    // Chat callbacks
    onSwitchChat: (id: string) => void;
    onInspectChat: (id: string) => void;
    onDeleteChat: (id: string) => void;
    onNewChat: () => void;
    onRenameChat: (id: string, name: string) => void;
    // Character callbacks
    onDeleteCharacter: (id: string) => void;
    onLoadFullCharacter: (id: string) => Promise<Character | null>;
    onToggleParticipant: (id: string) => void;
    onSetProtagonist: (id: string) => void;
    onSaveCharacter: (c: Character) => void;
    // Context callbacks
    onDeleteContext: (id: string) => void;
    onToggleContext: (id: string) => void;
    onSaveContext: (c: Context) => void;
    // Location callbacks
    onDeleteLocation: (id: string) => void;
    onToggleLocation: (id: string) => void;
    onSaveLocation: (l: Location) => void;
    // Audio track callbacks
    onDeleteAudioTrack: (id: string) => void;
    onToggleAudioTrack: (id: string) => void;
    onSaveAudioTrack: (t: AudioTrack) => void;
    // Prompt block callbacks
    onDeletePromptBlock: (id: string) => void;
    // Model callbacks
    onDeleteModel: (id: string) => void;
    onToggleModelLoad: (id: string) => void;
    // Sampler callbacks
    onDeleteSampler: (id: string) => void;
    // Stop pattern callbacks
    onDeleteStopPattern: (id: string) => void;
    // Budget strategy callbacks
    onDeleteBudgetStrategy: (id: string) => void;
    onActivateBudgetStrategy: (id: string) => void;
    // Profile callbacks
    onDeleteProfile: (id: string) => void;
    onActivateProfile: (id: string) => void;
    onSaveProfile: (p: Profile) => void;
    // Extension callbacks
    onDeleteExtension: (id: string) => void;
    onToggleExtension: (id: string) => void;
    // World callbacks
    onSaveWorld: (w: World) => void;
    onLoadWorld: (world: World) => void;
    onDeleteWorld: (id: string) => void;
    // Memory callbacks
    onDeleteMemory: (id: string) => void;
    // Interaction data callbacks
    onUpdateInteractionData: (data: InteractionData) => void;
    onForceFirstMessage: (c: Character) => void;
    onSendCustomMessage: (c: Character, t: string) => void;
    onInjectCustomMessage: (c: Character, t: string) => void;
    onInjectFirstMessage: (c: Character) => void;
    // General callbacks
    onImportComplete: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    ensureChatsLoaded: () => void;
}

type ChatShellWithId = RawInteractionData & { id: string };

export function AppModals({
    // Modals & data
    modals, runningModels,
    rawChatShells, allCharacters, allContexts, allLocations, allAudioTracks,
    allSamplers, allStopPatterns, allModels, allBudgetStrategies,
    allProfiles, allExtensions, allWorlds, allPromptBlocks, allMemories,
    // Entity modals
    charModal, contextModal, locationModal, audioTrackModal,
    samplerModal, stopModal, modelModal, budgetModal,
    profileModal, worldModal, promptBlockModal,
    // Chat callbacks
    onSwitchChat, onInspectChat, onDeleteChat, onNewChat, onRenameChat,
    // Character callbacks
    onDeleteCharacter, onLoadFullCharacter, onToggleParticipant, onSetProtagonist, onSaveCharacter,
    // Context callbacks
    onDeleteContext, onToggleContext, onSaveContext,
    // Location callbacks
    onDeleteLocation, onToggleLocation, onSaveLocation,
    // Audio track callbacks
    onDeleteAudioTrack, onToggleAudioTrack, onSaveAudioTrack,
    // Model callbacks
    onDeleteModel, onToggleModelLoad,
    // Sampler callbacks
    onDeleteSampler,
    // Stop pattern callbacks
    onDeleteStopPattern,
    // Budget strategy callbacks
    onDeleteBudgetStrategy, onActivateBudgetStrategy,
    // Profile callbacks
    onDeleteProfile, onActivateProfile, onSaveProfile,
    // Extension callbacks
    onDeleteExtension, onToggleExtension,
    // World callbacks
    onSaveWorld, onLoadWorld, onDeleteWorld,
    // Prompt block callbacks
    onDeletePromptBlock,
    // Memory callbacks
    onDeleteMemory,
    // Interaction data callbacks
    onUpdateInteractionData, onForceFirstMessage, onSendCustomMessage, onInjectCustomMessage, onInjectFirstMessage,
    // General callbacks
    onImportComplete, addToast, ensureChatsLoaded,
}: AppModalsProps) {
    const interactionData = useSessionStore(s => s.interactionData);
    const activeStrategy = useSessionStore(s => s.activeStrategy);
    const selectedModelId = useSessionStore(s => s.selectedModel?.id ?? null);
    const lastSelectedModelId = useSessionStore(s => s.lastSelectedModelId);
    const selectedBudgetStrategyId = useSessionStore(s => s.activeStrategy?.id ?? null);

    // Resolve effective tokenizer model: explicit selection > last budget engine pick > null
    const effectiveTokenizerModel = useMemo(() => {
        if (selectedModelId) return allModels.find(m => m.id === selectedModelId) ?? null;
        if (lastSelectedModelId) return allModels.find(m => m.id === lastSelectedModelId) ?? null;
        return null;
    }, [selectedModelId, lastSelectedModelId, allModels]);

    // Save redirect callbacks for AI recommendation refinement flow
    const [aiCharacterSaveRedirect, setAiCharacterSaveRedirect] = useState<((c: Character) => void) | null>(null);
    const [aiContextSaveRedirect, setAiContextSaveRedirect] = useState<((c: Context) => void) | null>(null);
    const [aiLocationSaveRedirect, setAiLocationSaveRedirect] = useState<((l: Location) => void) | null>(null);
    const [aiAudioTrackSaveRedirect, setAiAudioTrackSaveRedirect] = useState<((t: AudioTrack) => void) | null>(null);
    const [aiPromptBlockSaveRedirect, setAiPromptBlockSaveRedirect] = useState<((b: PromptBlock) => void) | null>(null);
    const [aiProfileSaveRedirect, setAiProfileSaveRedirect] = useState<((p: Profile) => void) | null>(null);

    // GPU Monitor modal state
    const [gpuMonitorOpen, setGpuMonitorOpen] = useState(false);

    // Filter chat shells to only those with defined IDs
    const chatShellsWithIds = useMemo(
        () => rawChatShells.filter((s): s is ChatShellWithId => !!s.id),
        [rawChatShells],
    );

    // Pre-resolved chat name map — built once from already-loaded shells, passed down to avoid redundant fetches
    const chatNameMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const shell of chatShellsWithIds) {
            map.set(shell.id, shell.name || 'Untitled Chat');
        }
        return map;
    }, [chatShellsWithIds]);

    // Lazy-load chat shells when chat list modal opens
    useEffect(() => {
        if (modals.chatList.isOpen) {
            ensureChatsLoaded();
        }
    }, [modals.chatList.isOpen, ensureChatsLoaded]);

    return (
        <>
            {/* ─── Manager Lists (non-editor, lower z-priority) ─── */}

            {/* Chat Sessions */}
            {modals.chatList.isOpen && (
                <ManagerModal
                    title="Chat Sessions"
                    items={chatShellsWithIds}
                    isOpen={modals.chatList.isOpen}
                    onClose={modals.chatList.close}
                    onSelect={(item) => {
                        onInspectChat(item.id);
                        modals.chatList.close();
                    }}
                    onDelete={(id: string) => onDeleteChat(id)}
                    onCreateNew={onNewChat}
                    renderSubtext={renderChatSubtext}
                    emptyMessage="No saved chat sessions found."
                    specialActionIcon="★"
                    onSpecialAction={(item) => onSwitchChat(item.id)}
                    specialActionTooltip={(item) =>
                        interactionData?.id === item.id ? `✓ Active — "${item.name}"` : `Activate "${item.name}"`
                    }
                    activeSpecialActionId={interactionData?.id}
                />
            )}

            {/* Characters List */}
            {modals.charList.isOpen && (
                <ManagerModal
                    title="Characters"
                    items={allCharacters}
                    isOpen={modals.charList.isOpen}
                    onClose={modals.charList.close}
                    onSelect={async (c: Character) => { const f = c.sampler ? c : await onLoadFullCharacter(c.id); charModal.open(f || c); }}
                    onDelete={onDeleteCharacter}
                    onCreateNew={() => charModal.open()}
                    renderSubtext={(c: Character) => c.description || 'No description'}
                    emptyMessage="No characters found."
                    actionLabel="Delete"
                    orderedListMode={!!interactionData}
                    currentOrderIds={interactionData?.participants.map(p => p.id) || []}
                    onToggleOrder={onToggleParticipant}
                    specialActionIcon="★"
                    onSpecialAction={(c: Character) => onSetProtagonist(c.id)}
                    specialActionTooltip={(c: Character) => `set ${c.name} as the protagonist`}
                    activeSpecialActionId={interactionData?.protagonist?.id}
                />
            )}

            {/* Contexts List */}
            {modals.contextList.isOpen && (
                <ManagerModal
                    title="Contexts"
                    items={allContexts}
                    isOpen={modals.contextList.isOpen}
                    onClose={modals.contextList.close}
                    onSelect={(c: Context) => contextModal.open(c)}
                    onDelete={onDeleteContext}
                    onCreateNew={() => contextModal.open()}
                    renderSubtext={renderContextSubtext}
                    emptyMessage="No contexts found."
                    actionLabel="Delete"
                    orderedListMode={true}
                    currentOrderIds={interactionData?.contexts?.map(i => i.id) || []}
                    onToggleOrder={onToggleContext}
                />
            )}

            {/* Locations List */}
            {modals.locationList.isOpen && (
                <ManagerModal
                    title="Locations"
                    items={allLocations}
                    isOpen={modals.locationList.isOpen}
                    onClose={modals.locationList.close}
                    onSelect={(l: Location) => locationModal.open(l)}
                    onDelete={onDeleteLocation}
                    onCreateNew={() => locationModal.open()}
                    renderSubtext={renderLocationSubtext}
                    emptyMessage="No locations found."
                    actionLabel="Delete"
                    orderedListMode={true}
                    currentOrderIds={interactionData?.locations?.map(l => l.id) || []}
                    onToggleOrder={onToggleLocation}
                />
            )}

            {/* Audio Tracks List */}
            {modals.audioTrackList.isOpen && (
                <ManagerModal
                    title="Audio Tracks"
                    items={allAudioTracks}
                    isOpen={modals.audioTrackList.isOpen}
                    onClose={modals.audioTrackList.close}
                    onSelect={(t: AudioTrack) => audioTrackModal.open(t)}
                    onDelete={onDeleteAudioTrack}
                    onCreateNew={() => audioTrackModal.open()}
                    renderSubtext={(t: AudioTrack) => `${t.audioCategory === 'ambient' ? '🌿' : t.audioCategory === 'music' ? '🎵' : '💥'} ${t.loop ? '🔁' : '▶️'} Vol: ${Math.round(t.volume * 100)}%${t.locationBindings.length > 0 ? ` • 📍${t.locationBindings.length}` : ''}${t.contextBindings.length > 0 ? ` • 📜${t.contextBindings.length}` : ''}`}
                    emptyMessage="No audio tracks found."
                    actionLabel="Delete"
                    orderedListMode={true}
                    currentOrderIds={interactionData?.audioTracks?.map(t => t.id) || []}
                    onToggleOrder={onToggleAudioTrack}
                />
            )}

            {/* Worlds List */}
            {modals.worldManager.isOpen && (
                <ManagerModal
                    title="Worlds"
                    items={allWorlds}
                    isOpen={modals.worldManager.isOpen}
                    onClose={modals.worldManager.close}
                    onSelect={(w: World) => worldModal.open(w)}
                    onDelete={onDeleteWorld}
                    onCreateNew={() => worldModal.open()}
                    renderSubtext={(w: World) =>
                        `${w.characterIds.length} char • ${w.contextIds.length} context • ${w.locationIds.length} loc${(w.audioTrackIds?.length ?? 0) > 0 ? ` • 🔊${w.audioTrackIds!.length}` : ''}${(w.promptBlockIds?.length ?? 0) > 0 ? ` • 🧱${w.promptBlockIds!.length}` : ''}${w.profileId ? ' • 📋' : ''}${w.description ? ` — ${w.description}` : ''}`
                    }
                    emptyMessage="No worlds saved yet."
                    actionLabel="Delete"
                />
            )}

            {/* Prompt Blocks List */}
            {modals.promptBlockList.isOpen && (
                <ManagerModal
                    title="Prompt Blocks"
                    items={allPromptBlocks}
                    isOpen={modals.promptBlockList.isOpen}
                    onClose={modals.promptBlockList.close}
                    onSelect={(b: PromptBlock) => promptBlockModal.open(b)}
                    onDelete={promptBlockModal.handleDelete}
                    onCreateNew={() => promptBlockModal.open()}
                    renderSubtext={(b: PromptBlock) => `${b.textContent ? `📝 ${b.textContent.length} chars` : ''}${b.images.length > 0 ? ` • 🖼️ ${b.images.length}` : ''}${b.characterBindings.length > 0 ? ` • 🎭${b.characterBindings.length}` : ''}${b.contextBindings.length > 0 ? ` • 📜${b.contextBindings.length}` : ''}${b.locationBindings.length > 0 ? ` • 📍${b.locationBindings.length}` : ''}`}
                    emptyMessage="No prompt blocks found."
                    actionLabel="Delete"
                />
            )}

            {/* Language Models List */}
            {useMemo(() => {
                if (!modals.modelList.isOpen) return null;

                const strategyModelIds = new Set<string>();
                if (activeStrategy) {
                    for (const m of activeStrategy.onlineModels) strategyModelIds.add(m.id);
                    for (const m of activeStrategy.localModels) strategyModelIds.add(m.id);
                }

                return (
                    <ManagerModal
                        title="Language Models"
                        items={allModels}
                        isOpen={modals.modelList.isOpen}
                        onClose={modals.modelList.close}
                        onSelect={(m: LanguageModel) => modelModal.open(m)}
                        onDelete={onDeleteModel}
                        onCreateNew={() => modelModal.open()}
                        renderSubtext={(m: LanguageModel) => renderModelSubtext(m, runningModels, selectedModelId)}
                        emptyMessage="No models available."
                        actionLabel="Delete"
                        orderedListMode={false}
                        activeSpecialActionId={selectedModelId || undefined}
                        secondaryActiveIds={strategyModelIds}
                        specialActionIcon="★"
                        onSpecialAction={(m: LanguageModel) => onToggleModelLoad(m.id)}
                        specialActionTooltip={(m: LanguageModel) => {
                            const ms = runningModels[m.id];
                            const isCloud = !!m.apiKey && !!m.backend && cloudBackends.includes(m.backend as cloudBackend);
                            const inStrategy = strategyModelIds.has(m.id);
                            if (inStrategy && activeStrategy && selectedModelId !== m.id) {
                                return `★ In strategy "${activeStrategy.name}" — Click to override & select`;
                            }
                            if (isCloud && selectedModelId === m.id) return '☁️ Cloud Model — Click to Deselect';
                            if (isCloud) return '☁️ Cloud Model — Click to Select';
                            if (ms?.isRunning && ms?.isIdle && selectedModelId === m.id) return '⏹ Stop & Deselect';
                            if (ms?.isRunning && ms?.isIdle) return '⏹ Stop Model';
                            if (ms?.isRunning && !ms?.isIdle) return '⏳ Loading...';
                            if (selectedModelId === m.id) return '✓ Already Selected — Click to Load';
                            return '▶ Load & Select Model';
                        }}
                    />
                );
            }, [modals.modelList.isOpen, modals.modelList.close, allModels, modelModal, onDeleteModel, runningModels, selectedModelId, activeStrategy, onToggleModelLoad])}

            {/* Samplers List */}
            {modals.samplerList.isOpen && (
                <ManagerModal
                    title="Samplers"
                    items={allSamplers}
                    isOpen={modals.samplerList.isOpen}
                    onClose={modals.samplerList.close}
                    onSelect={(s: Sampler) => samplerModal.open(s)}
                    onDelete={onDeleteSampler}
                    onCreateNew={() => samplerModal.open()}
                    renderSubtext={(s: Sampler) => `Temp: ${s?.parameters?.temperature}, TopP: ${s?.parameters?.top_p}, Tokens: ${s?.maximumNumberOfTokens}`}
                    emptyMessage="No samplers found."
                    actionLabel="Delete"
                />
            )}

            {/* Stop Patterns List */}
            {modals.stopList.isOpen && (
                <ManagerModal
                    title="Stop Patterns"
                    items={allStopPatterns}
                    isOpen={modals.stopList.isOpen}
                    onClose={modals.stopList.close}
                    onSelect={(s: StopPattern) => stopModal.open(s)}
                    onDelete={onDeleteStopPattern}
                    onCreateNew={() => stopModal.open()}
                    renderSubtext={(s: StopPattern) => (
                        <span style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', display: 'block' }}>
                            {s.regularExpressionActivationTrigger ? '⚡' : '📌'} Pattern: {s.pattern}
                        </span>
                    )}
                    emptyMessage="No stop patterns found."
                    actionLabel="Delete"
                    orderedListMode={false}
                />
            )}

            {/* Budget Strategies List */}
            {modals.budgetStrategyList.isOpen && (
                <ManagerModal
                    title="Budget Strategies"
                    items={allBudgetStrategies}
                    isOpen={modals.budgetStrategyList.isOpen}
                    onClose={modals.budgetStrategyList.close}
                    onSelect={(s: BudgetStrategy) => budgetModal.open(s)}
                    onDelete={onDeleteBudgetStrategy}
                    onCreateNew={() => budgetModal.open()}
                    renderSubtext={renderBudgetStrategySubtext}
                    emptyMessage="No budget strategies found."
                    actionLabel="Delete"
                    orderedListMode={false}
                    activeSpecialActionId={selectedBudgetStrategyId || undefined}
                    specialActionIcon="★"
                    onSpecialAction={(s: BudgetStrategy) => onActivateBudgetStrategy(s.id)}
                    specialActionTooltip={(s: BudgetStrategy) => selectedBudgetStrategyId === s.id ? `Deactivate ${s.name}` : `Activate ${s.name}`}
                />
            )}

            {/* Profiles List */}
            {modals.profileList.isOpen && (
                <ManagerModal
                    title="Profiles"
                    items={allProfiles}
                    isOpen={modals.profileList.isOpen}
                    onClose={modals.profileList.close}
                    onSelect={(p: Profile) => profileModal.open(p)}
                    onDelete={onDeleteProfile}
                    onCreateNew={() => profileModal.open()}
                    renderSubtext={renderProfileSubtext}
                    emptyMessage="No profiles found."
                    actionLabel="Delete"
                    orderedListMode={false}
                    activeSpecialActionId={interactionData?.Profile?.id || undefined}
                    specialActionIcon="★"
                    onSpecialAction={(p: Profile) => onActivateProfile(p.id)}
                    specialActionTooltip={(p: Profile) => interactionData?.Profile?.id === p.id ? `Deactivate ${p.name}` : `Activate ${p.name}`}
                />
            )}

            {/* Extensions List */}
            {modals.extList.isOpen && (
                <ManagerModal
                    title="Extensions"
                    items={allExtensions}
                    isOpen={modals.extList.isOpen}
                    onClose={modals.extList.close}
                    onSelect={undefined}
                    onDelete={onDeleteExtension}
                    onCreateNew={() => addToast('Create Extension Modal coming soon!', 'info')}
                    renderSubtext={(ext: Extension) => renderExtensionSubtext({ extensionType: ext.extensionType, description: ext.description ?? '' })}
                    emptyMessage="No extensions available."
                    actionLabel="Delete"
                    orderedListMode={true}
                    onToggleOrder={onToggleExtension}
                />
            )}

            {/* ─── Tool / Utility Modals (mid z-priority) ─── */}

            {/* Settings */}
            {modals.settings.isOpen && (
                <SettingsModal
                    isOpen={modals.settings.isOpen}
                    onClose={modals.settings.close}
                    onOpenBudgetControl={modals.budgetControl.open}
                    onOpenGpuMonitor={() => { modals.settings.close(); setGpuMonitorOpen(true); }}
                    onOpenParticipantControl={modals.participantControl.open}
                    onOpenAIRecommendation={modals.aiRecommendation.open}
                    onOpenAlternateTimelines={modals.alternateTimelines.open}
                    onOpenImportCharacterCard={modals.cardImport.open}
                    onOpenExportData={modals.exportData.open}
                    onOpenImportData={modals.importData.open}
                    onOpenDataManager={modals.dataManager.open}
                />
            )}

            {/* Budget Control */}
            {modals.budgetControl.isOpen && (
                <BudgetControlModal
                    isOpen={modals.budgetControl.isOpen}
                    onClose={modals.budgetControl.close}
                    activeStrategy={activeStrategy}
                />
            )}

            {/* GPU Monitor */}
            <GpuMonitorModal
                isOpen={gpuMonitorOpen}
                onClose={() => setGpuMonitorOpen(false)}
            />

            {/* Participant Control */}
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

            {/* AI Recommendation */}
            {modals.aiRecommendation.isOpen && (
                <AIRecommendationModal
                    isOpen={modals.aiRecommendation.isOpen}
                    onClose={modals.aiRecommendation.close}
                    onSaveCharacter={async (c: Character) => { onSaveCharacter(c); return true; }}
                    onSaveContext={async (c: Context) => { onSaveContext(c); return true; }}
                    onSaveLocation={async (l: Location) => { onSaveLocation(l); return true; }}
                    onSaveAudioTrack={async (t: AudioTrack) => { onSaveAudioTrack(t); return true; }}
                    onSaveProfile={async (p: Profile) => { onSaveProfile(p); return true; }}
                    onSaveWorld={async (w: World) => { onSaveWorld(w); return true; }}
                    onSavePromptBlock={async (b: PromptBlock) => { promptBlockModal.handleSave(b); return true; }}
                    onOpenCharacterEditor={(char, onApplyToRecommendation) => {
                        setAiCharacterSaveRedirect(() => onApplyToRecommendation);
                        charModal.open(char ?? undefined);
                    }}
                    onOpenContextEditor={(context, onApplyToRecommendation) => {
                        setAiContextSaveRedirect(() => onApplyToRecommendation);
                        contextModal.open(context ?? undefined);
                    }}
                    onOpenLocationEditor={(loc, onApplyToRecommendation) => {
                        setAiLocationSaveRedirect(() => onApplyToRecommendation);
                        locationModal.open(loc ?? undefined);
                    }}
                    onOpenAudioTrackEditor={(track, onApplyToRecommendation) => {
                        setAiAudioTrackSaveRedirect(() => onApplyToRecommendation);
                        audioTrackModal.open(track ?? undefined);
                    }}
                    onOpenPromptBlockEditor={(block, onApplyToRecommendation) => {
                        setAiPromptBlockSaveRedirect(() => onApplyToRecommendation);
                        promptBlockModal.open(block ?? undefined);
                    }}
                    onOpenProfileEditor={(profile, onApplyToRecommendation) => {
                        setAiProfileSaveRedirect(() => onApplyToRecommendation);
                        profileModal.open(profile ?? undefined);
                    }}
                    allSamplers={allSamplers}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                    allAudioTracks={allAudioTracks}
                    allPromptBlocks={allPromptBlocks}
                    selectedModel={effectiveTokenizerModel}
                    runningModels={runningModels}
                />
            )}

            {/* Alternate Timelines */}
            {modals.alternateTimelines.isOpen && (
                <AlternateTimelinesModal
                    isOpen={modals.alternateTimelines.isOpen}
                    onClose={modals.alternateTimelines.close}
                    currentInteractionId={interactionData?.id ?? ''}
                    rawChatShells={chatShellsWithIds}
                    onSwitchChat={onSwitchChat}
                    onDeleteChat={onDeleteChat}
                    onInspectChat={onInspectChat}
                    onRenameChat={onRenameChat}
                />
            )}

            {/* Character Card Import */}
            {modals.cardImport.isOpen && (
                <CharacterCardImportModal
                    isOpen={modals.cardImport.isOpen}
                    onClose={modals.cardImport.close}
                    onSaveCharacter={async (c: Character) => { onSaveCharacter(c); return true; }}
                    onSaveContext={async (c: Context) => { onSaveContext(c); return true; }}
                    allSamplers={allSamplers}
                />
            )}

            {/* Data Import */}
            {modals.importData.isOpen && (
                <DataImportModal
                    isOpen={modals.importData.isOpen}
                    onClose={modals.importData.close}
                    onImportComplete={onImportComplete}
                />
            )}

            {/* Data Export */}
            {modals.exportData.isOpen && (
                <DataExportModal
                    isOpen={modals.exportData.isOpen}
                    onClose={modals.exportData.close}
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
                    rawChatShells={chatShellsWithIds}
                />
            )}

            {/* Data Manager */}
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
                    rawChatShells={chatShellsWithIds}
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
                    onDeleteChat={onDeleteChat}
                />
            )}

            {/* ─── Editor Modals (highest z-priority via DOM order) ─── */}

            {/* Character Editor */}
            {charModal.isOpen && (
                <CharacterEditorModal
                    isOpen={charModal.isOpen}
                    onClose={() => {
                        setAiCharacterSaveRedirect(null);
                        charModal.close();
                    }}
                    onSave={(c: Character) => {
                        if (aiCharacterSaveRedirect) {
                            aiCharacterSaveRedirect(c);
                            addToast('Applied character changes to AI recommendation.', 'success');
                        } else {
                            charModal.handleSave(c);
                        }
                    }}
                    existingCharacter={charModal.itemToEdit}
                    allSamplers={allSamplers}
                    selectedModel={effectiveTokenizerModel}
                    runningModels={runningModels}
                    chatNameMap={chatNameMap}
                />
            )}

            {/* Context Editor */}
            {contextModal.isOpen && (
                <ContextEditorModal
                    isOpen={contextModal.isOpen}
                    onClose={() => {
                        setAiContextSaveRedirect(null);
                        contextModal.close();
                    }}
                    onSave={(c: Context) => {
                        if (aiContextSaveRedirect) {
                            aiContextSaveRedirect(c);
                            addToast('Applied context changes to AI recommendation.', 'success');
                        } else {
                            contextModal.handleSave(c);
                        }
                    }}
                    existingContext={contextModal.itemToEdit}
                    allCharacters={allCharacters}
                />
            )}

            {/* Location Editor */}
            {locationModal.isOpen && (
                <LocationEditorModal
                    isOpen={locationModal.isOpen}
                    onClose={() => {
                        setAiLocationSaveRedirect(null);
                        locationModal.close();
                    }}
                    onSave={(l: Location) => {
                        if (aiLocationSaveRedirect) {
                            aiLocationSaveRedirect(l);
                            addToast('Applied location changes to AI recommendation.', 'success');
                        } else {
                            locationModal.handleSave(l);
                        }
                    }}
                    existingLocation={locationModal.itemToEdit}
                    allCharacters={allCharacters}
                    allLocations={allLocations}
                    allAudioTracks={allAudioTracks}
                />
            )}

            {/* Audio Track Editor */}
            {audioTrackModal.isOpen && (
                <AudioTrackEditorModal
                    isOpen={audioTrackModal.isOpen}
                    onClose={() => {
                        setAiAudioTrackSaveRedirect(null);
                        audioTrackModal.close();
                    }}
                    onSave={(t: AudioTrack) => {
                        if (aiAudioTrackSaveRedirect) {
                            aiAudioTrackSaveRedirect(t);
                            addToast('Applied audio track changes to AI recommendation.', 'success');
                        } else {
                            audioTrackModal.handleSave(t);
                        }
                    }}
                    existingTrack={audioTrackModal.itemToEdit}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                />
            )}

            {/* World Editor */}
            {worldModal.isOpen && (
                <WorldEditorModal
                    isOpen={worldModal.isOpen}
                    onClose={worldModal.close}
                    onSave={worldModal.handleSave}
                    onLoadWorld={onLoadWorld}
                    existingWorld={worldModal.itemToEdit}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                    allProfiles={allProfiles}
                    allAudioTracks={allAudioTracks}
                    allPromptBlocks={allPromptBlocks}
                    currentCharacterIds={interactionData?.participants.map(p => p.id) || []}
                    currentContextIds={interactionData?.contexts?.map(c => c.id) || []}
                    currentLocationIds={interactionData?.locations?.map(l => l.id) || []}
                    currentProfileId={interactionData?.Profile?.id}
                    currentAudioTrackIds={interactionData?.audioTracks?.map(t => t.id) || []}
                />
            )}

            {/* Model Editor */}
            {modelModal.isOpen && (
                <ModelEditorModal
                    isOpen={modelModal.isOpen}
                    onClose={modelModal.close}
                    onSave={modelModal.handleSave}
                    existingModel={modelModal.itemToEdit}
                    allStopPatterns={allStopPatterns}
                />
            )}

            {/* Sampler Editor */}
            {samplerModal.isOpen && (
                <SamplerEditorModal
                    isOpen={samplerModal.isOpen}
                    onClose={samplerModal.close}
                    onSave={samplerModal.handleSave}
                    existingSampler={samplerModal.itemToEdit}
                    allStopPatterns={allStopPatterns}
                />
            )}

            {/* Prompt Block Editor */}
            {promptBlockModal.isOpen && (
                <PromptBlockEditorModal
                    isOpen={promptBlockModal.isOpen}
                    onClose={() => {
                        setAiPromptBlockSaveRedirect(null);
                        promptBlockModal.close();
                    }}
                    onSave={(b: PromptBlock) => {
                        if (aiPromptBlockSaveRedirect) {
                            aiPromptBlockSaveRedirect(b);
                            addToast('Applied prompt block changes to AI recommendation.', 'success');
                        } else {
                            promptBlockModal.handleSave(b);
                        }
                    }}
                    existingBlock={promptBlockModal.itemToEdit}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                />
            )}

            {/* Stop Pattern Editor */}
            {stopModal.isOpen && (
                <StopPatternEditorModal
                    isOpen={stopModal.isOpen}
                    onClose={stopModal.close}
                    onSave={stopModal.handleSave}
                    existingStopPattern={stopModal.itemToEdit}
                />
            )}

            {/* Budget Strategy Editor */}
            {budgetModal.isOpen && (
                <BudgetStrategyEditorModal
                    isOpen={budgetModal.isOpen}
                    onClose={budgetModal.close}
                    onSave={budgetModal.handleSave}
                    existingStrategy={budgetModal.itemToEdit}
                    allModels={allModels}
                />
            )}

            {/* Profile Editor */}
            {profileModal.isOpen && (
                <ProfileEditorModal
                    isOpen={profileModal.isOpen}
                    onClose={() => {
                        setAiProfileSaveRedirect(null);
                        profileModal.close();
                    }}
                    onSave={(p: Profile) => {
                        if (aiProfileSaveRedirect) {
                            aiProfileSaveRedirect(p);
                            addToast('Applied profile changes to AI recommendation.', 'success');
                        } else {
                            profileModal.handleSave(p);
                        }
                    }}
                    existingProfile={profileModal.itemToEdit}
                    allPromptBlocks={allPromptBlocks}
                    allSamplers={allSamplers}
                />
            )}
        </>
    );
}