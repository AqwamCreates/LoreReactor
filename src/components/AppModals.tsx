// src/components/AppModals.tsx
import type { Character, Context, Location, Sampler, StopPattern, LanguageModel, BudgetStrategy, Profile, Extension, InteractionData, World } from '../types';
import { ManagerModal } from './ManagerModal';
import { CharacterEditorModal } from './CharacterEditorModal';
import { ModelEditorModal } from './ModelEditorModal';
import { SamplerEditorModal } from './SamplerEditorModal';
import { ContextEditorModal } from './ContextEditorModal';
import { LocationEditorModal } from './LocationEditorModal';
import { StopPatternEditorModal } from './StopPatternEditorModal';
import { BudgetStrategyEditorModal } from './BudgetStrategyEditorModal';
import { ProfileEditorModal } from './ProfileEditorModal';
import { SettingsModal } from './SettingsModal';
import { BudgetControlModal } from './BudgetControlModal';
import { WorldEditorModal } from './WorldEditorModal';
import { ParticipantControlModal } from './ParticipantControlModal';
import { AIRecommendationModal } from './AIRecommendationModal';
import { CharacterCardImportModal } from './CharacterCardImportModal';
import { DataImportModal } from './DataImportModal';
import { DataExportModal } from './DataExportModal';
import { renderModelSubtext, renderBudgetStrategySubtext, renderProfileSubtext, renderChatSubtext, renderContextSubtext, renderLocationSubtext, renderExtensionSubtext } from './renderHelpers';
import { cloudBackends } from '../languageModelInformation';
import { useSessionStore } from '../store/useSessionStore';
import { useMemo, useState } from 'react';

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
    modals: Record<string, ModalVisibility>;
    // Data
    allChats: InteractionData[];
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allSamplers: Sampler[];
    allStopPatterns: StopPattern[];
    allModels: LanguageModel[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allExtensions: Extension[];
    allWorlds: World[];
    runningModels: Record<string, { isRunning?: boolean; isIdle?: boolean; port?: number }>;
    samplerToEdit: Sampler | null;
    // Entity modals
    charModal: EntityModalState<Character>;
    contextModal: EntityModalState<Context>;
    locationModal: EntityModalState<Location>;
    stopModal: EntityModalState<StopPattern>;
    modelModal: EntityModalState<LanguageModel>;
    budgetModal: EntityModalState<BudgetStrategy>;
    profileModal: EntityModalState<Profile>;
    worldModal: EntityModalState<World>;
    // Callbacks
    onSwitchChat: (id: string) => void;
    onDeleteChat: (id: string) => void;
    onNewChat: () => void;
    onDeleteCharacter: (id: string) => void;
    onLoadFullCharacter: (id: string) => Promise<Character | null>;
    onToggleParticipant: (id: string) => void;
    onSetProtagonist: (id: string) => void;
    onDeleteContext: (id: string) => void;
    onToggleContext: (id: string) => void;
    onDeleteLocation: (id: string) => void;
    onToggleLocation: (id: string) => void;
    onDeleteModel: (id: string) => void;
    onToggleModelLoad: (id: string) => void;
    onDeleteSampler: (id: string) => void;
    onSaveSampler: (s: Sampler) => void;
    onOpenSamplerEditor: (s?: Sampler | null) => void;
    onDeleteStopPattern: (id: string) => void;
    onDeleteBudgetStrategy: (id: string) => void;
    onActivateBudgetStrategy: (id: string) => void;
    onDeleteProfile: (id: string) => void;
    onActivateProfile: (id: string) => void;
    onDeleteExtension: (id: string) => void;
    onToggleExtension: (id: string) => void;
    onUpdateInteractionData: (data: InteractionData) => void;
    onForceFirstMessage: (c: Character) => void;
    onSendCustomMessage: (c: Character, t: string) => void;
    onInjectCustomMessage: (c: Character, t: string) => void;
    onInjectFirstMessage: (c: Character) => void;
    onSaveCharacter: (c: Character) => void;
    onSaveContext: (c: Context) => void;
    onSaveLocation: (l: Location) => void;
    onSaveProfile: (p: Profile) => void;
    onSaveWorld: (w: World) => void;
    onLoadWorld: (world: World) => void;
    onDeleteWorld: (id: string) => void;
    onImportComplete: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function AppModals({
    modals, allChats, allCharacters, allContexts, allLocations, allSamplers,
    allStopPatterns, allModels, allBudgetStrategies, allProfiles, allExtensions, allWorlds,
    runningModels, samplerToEdit, charModal, contextModal, locationModal, stopModal, modelModal,
    budgetModal, profileModal, worldModal,
    onSwitchChat, onDeleteChat, onNewChat, onDeleteCharacter, onLoadFullCharacter,
    onToggleParticipant, onSetProtagonist, onDeleteContext, onToggleContext,
    onDeleteLocation, onToggleLocation, onDeleteModel, onToggleModelLoad,
    onDeleteSampler, onSaveSampler, onOpenSamplerEditor, onDeleteStopPattern,
    onDeleteBudgetStrategy, onActivateBudgetStrategy, onDeleteProfile, onActivateProfile,
    onDeleteExtension, onToggleExtension, onUpdateInteractionData,
    onForceFirstMessage, onSendCustomMessage, onInjectCustomMessage, onInjectFirstMessage,
    onSaveCharacter, onSaveContext, onSaveLocation, onSaveProfile, onSaveWorld,
    onLoadWorld, onDeleteWorld, onImportComplete, addToast,
}: AppModalsProps) {
    const interactionData = useSessionStore(s => s.interactionData);
    const activeStrategy = useSessionStore(s => s.activeStrategy);
    const selectedModelId = useSessionStore(s => s.selectedModel?.id ?? null);
    const selectedBudgetStrategyId = useSessionStore(s => s.activeStrategy?.id ?? null);

    // Save redirect callbacks for AI recommendation refinement flow.
    // When set, the editor's onSave is redirected to update the AI recommendation
    // output instead of persisting to storage. Cleared when the editor closes.
    const [aiCharacterSaveRedirect, setAiCharacterSaveRedirect] = useState<((c: Character) => void) | null>(null);
    const [aiContextSaveRedirect, setAiContextSaveRedirect] = useState<((c: Context) => void) | null>(null);
    const [aiLocationSaveRedirect, setAiLocationSaveRedirect] = useState<((l: Location) => void) | null>(null);
    const [aiProfileSaveRedirect, setAiProfileSaveRedirect] = useState<((p: Profile) => void) | null>(null);

    return (
        <>
            {/* Chat Sessions */}
            {modals.chatList.isOpen && (
                <ManagerModal
                    title="Chat Sessions"
                    items={allChats}
                    isOpen={modals.chatList.isOpen}
                    onClose={modals.chatList.close}
                    onSelect={(item: InteractionData) => {
                        onSwitchChat(item.id);
                        modals.chatList.close();
                    }}
                    onDelete={onDeleteChat}
                    onCreateNew={onNewChat}
                    renderSubtext={renderChatSubtext}
                    emptyMessage="No saved chat sessions found."
                />
            )}

            {/* Characters */}
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
                    selectedModel={allModels.find(m => m.id === selectedModelId) || null}
                    runningModels={runningModels}
                />
            )}

            {/* Contexts */}
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

            {/* Locations */}
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
                />
            )}

            {/* Worlds */}
            {modals.worldManager.isOpen && (
                <ManagerModal
                    title="Worlds"
                    items={allWorlds}
                    isOpen={modals.worldManager.isOpen}
                    onClose={modals.worldManager.close}
                    onSelect={(w: World) => { onLoadWorld(w); modals.worldManager.close(); }}
                    onDelete={onDeleteWorld}
                    onCreateNew={() => worldModal.open()}
                    renderSubtext={(w: World) =>
                        `${w.characterIds.length} char • ${w.contextIds.length} ctx • ${w.locationIds.length} loc${w.profileId ? ' • 📋' : ''}${w.description ? ` — ${w.description}` : ''}`
                    }
                    emptyMessage="No worlds saved yet."
                    actionLabel="Delete"
                />
            )}
            {worldModal.isOpen && (
                <WorldEditorModal
                    isOpen={worldModal.isOpen}
                    onClose={worldModal.close}
                    onSave={worldModal.handleSave}
                    existingWorld={worldModal.itemToEdit}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                    allProfiles={allProfiles}
                    currentCharacterIds={interactionData?.participants.map(p => p.id) || []}
                    currentContextIds={interactionData?.contexts?.map(c => c.id) || []}
                    currentLocationIds={interactionData?.locations?.map(l => l.id) || []}
                    currentProfileId={interactionData?.Profile?.id}
                />
            )}

            {/* Models */}
            {useMemo(() => {
                if (!modals.modelList.isOpen) return null;
                
                const strategyModelIds = new Set<string>();
                if (activeStrategy) {
                    for (const m of activeStrategy.onlineModels) strategyModelIds.add(m.id);
                    for (const m of activeStrategy.localModels) strategyModelIds.add(m.id);
                }

                return (
                    <ManagerModal
                        title="Models"
                        items={allModels}
                        isOpen={modals.modelList.isOpen}
                        onClose={modals.modelList.close}
                        onSelect={(m: LanguageModel) => modelModal.open(m)}
                        onDelete={onDeleteModel}
                        onCreateNew={() => modelModal.open()}
                        renderSubtext={(m: LanguageModel) => renderModelSubtext(m, runningModels, selectedModelId, activeStrategy)}
                        emptyMessage="No models available."
                        actionLabel="Delete"
                        orderedListMode={false}
                        activeSpecialActionId={selectedModelId || undefined}
                        secondaryActiveIds={strategyModelIds}
                        specialActionIcon="★"
                        onSpecialAction={(m: LanguageModel) => onToggleModelLoad(m.id)}
                        specialActionTooltip={(m: LanguageModel) => {
                            const ms = runningModels[m.id];
                            const isCloud = !!m.apiKey && !!m.backend && cloudBackends.includes(m.backend);
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
            {modelModal.isOpen && (
                <ModelEditorModal
                    isOpen={modelModal.isOpen}
                    onClose={modelModal.close}
                    onSave={modelModal.handleSave}
                    existingModel={modelModal.itemToEdit}
                    allStopPatterns={allStopPatterns}
                />
            )}

            {/* Samplers */}
            {modals.samplerList.isOpen && (
                <ManagerModal
                    title="Samplers"
                    items={allSamplers}
                    isOpen={modals.samplerList.isOpen}
                    onClose={modals.samplerList.close}
                    onSelect={onOpenSamplerEditor}
                    onDelete={onDeleteSampler}
                    onCreateNew={() => onOpenSamplerEditor(null)}
                    renderSubtext={(s: Sampler) => `Temp: ${s?.parameters?.temperature}, TopP: ${s?.parameters?.top_p}, Tokens: ${s?.maximumNumberOfTokens}`}
                    emptyMessage="No samplers found."
                    actionLabel="Delete"
                />
            )}
            {modals.samplerEditor.isOpen && (
                <SamplerEditorModal
                    isOpen={modals.samplerEditor.isOpen}
                    onClose={() => { modals.samplerEditor.close(); }}
                    onSave={onSaveSampler}
                    existingSampler={samplerToEdit}
                    allStopPatterns={allStopPatterns}
                />
            )}

            {/* Stop Patterns */}
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
            {stopModal.isOpen && (
                <StopPatternEditorModal
                    isOpen={stopModal.isOpen}
                    onClose={stopModal.close}
                    onSave={stopModal.handleSave}
                    existingStopPattern={stopModal.itemToEdit}
                />
            )}

            {/* Budget Strategies */}
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
            {budgetModal.isOpen && (
                <BudgetStrategyEditorModal
                    isOpen={budgetModal.isOpen}
                    onClose={budgetModal.close}
                    onSave={budgetModal.handleSave}
                    existingStrategy={budgetModal.itemToEdit}
                    allModels={allModels}
                />
            )}

            {/* Profiles */}
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
                />
            )}

            {/* Extensions */}
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
                    currentOrderIds={(interactionData as InteractionData)?.extensions?.map((e: Extension) => e.id) || []}
                    onToggleOrder={onToggleExtension}
                />
            )}

            {/* Settings & Tool Modals */}
            {modals.settings.isOpen && (
                <SettingsModal
                    isOpen={modals.settings.isOpen}
                    onClose={modals.settings.close}
                    onOpenImportCharacterCard={modals.cardImport.open}
                    onOpenAIRecommendation={modals.aiRecommendation.open}
                    onOpenExportData={modals.exportData.open}
                    onOpenImportData={modals.importData.open}
                    onOpenParticipantControl={modals.participantControl.open}
                    onOpenBudgetControl={modals.budgetControl.open}
                />
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
            {modals.aiRecommendation.isOpen && (
                <AIRecommendationModal
                    isOpen={modals.aiRecommendation.isOpen}
                    onClose={modals.aiRecommendation.close}
                    onSaveCharacter={async (c: Character) => { onSaveCharacter(c); return true; }}
                    onSaveContext={async (c: Context) => { onSaveContext(c); return true; }}
                    onSaveLocation={async (l: Location) => { onSaveLocation(l); return true; }}
                    onSaveProfile={async (p: Profile) => { onSaveProfile(p); return true; }}
                    onSaveWorld={async (w: World) => { onSaveWorld(w); return true; }}
                    onOpenCharacterEditor={(char, onApplyToRecommendation) => {
                        setAiCharacterSaveRedirect(() => onApplyToRecommendation);
                        charModal.open(char ?? undefined);
                    }}
                    onOpenContextEditor={(ctx, onApplyToRecommendation) => {
                        setAiContextSaveRedirect(() => onApplyToRecommendation);
                        contextModal.open(ctx ?? undefined);
                    }}
                    onOpenLocationEditor={(loc, onApplyToRecommendation) => {
                        setAiLocationSaveRedirect(() => onApplyToRecommendation);
                        locationModal.open(loc ?? undefined);
                    }}
                    onOpenProfileEditor={(profile, onApplyToRecommendation) => {
                        setAiProfileSaveRedirect(() => onApplyToRecommendation);
                        profileModal.open(profile ?? undefined);
                    }}
                    allSamplers={allSamplers}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                    selectedModel={allModels.find(m => m.id === selectedModelId) || null}
                    runningModels={runningModels}
                />
            )}
            {modals.cardImport.isOpen && (
                <CharacterCardImportModal
                    isOpen={modals.cardImport.isOpen}
                    onClose={modals.cardImport.close}
                    onSaveCharacter={async (c: Character) => { onSaveCharacter(c); return true; }}
                    onSaveContext={async (c: Context) => { onSaveContext(c); return true; }}
                    allSamplers={allSamplers}
                />
            )}
            {modals.importData.isOpen && (
                <DataImportModal
                    isOpen={modals.importData.isOpen}
                    onClose={modals.importData.close}
                    onImportComplete={onImportComplete}
                />
            )}
            {modals.exportData.isOpen && (
                <DataExportModal
                    isOpen={modals.exportData.isOpen}
                    onClose={modals.exportData.close}
                    allCharacters={allCharacters}
                    allContexts={allContexts}
                    allLocations={allLocations}
                    allSamplers={allSamplers}
                    allStopPatterns={allStopPatterns}
                    allModels={allModels}
                    allBudgetStrategies={allBudgetStrategies}
                    allProfiles={allProfiles}
                    allWorlds={allWorlds}
                    allChats={allChats}
                />
            )}
            {modals.budgetControl.isOpen && (
                <BudgetControlModal
                    isOpen={modals.budgetControl.isOpen}
                    onClose={modals.budgetControl.close}
                    allBudgetStrategies={allBudgetStrategies}
                    activeStrategy={activeStrategy}
                />
            )}
        </>
    );
}