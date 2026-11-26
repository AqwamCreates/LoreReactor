// src/frontend_src/services/ChatSessionCoordinator.ts

import { useChatStore } from '../hooks/useChatStore';
import { useGenerationStore } from '../hooks/useGenerationStore';
import { CharacterActor, type TurnExecutionParams } from './CharacterActor';
import { CharacterSoul } from './CharacterSoul';
import { runTurnSequence } from './InteractionOrchestrator';
import { getBudgetStrategyEngine } from './BudgetStrategyEngine';
import { getLanguageModelEngine } from './LanguageModelEngine';
import { processPendingToolActions, executeTool, type ToolExecutionContext } from './ToolExecutor';
import { parseSlashCommand } from './ToolInvocationParser';
import { StreamingVoiceTracker } from './StreamingVoiceTracker';
import { sentimentEngine } from './SentimentAnalysisEngine';
import { speculativeMarkovEngine } from './SpeculativeMarkovEngine';
import { runSummarization } from './SummarizationEngine';
import { textToSpeechEngine } from './TextToSpeechEngine';
import { frontCameraEngine } from './FrontCameraEngine';
import { faceDetectionEngine } from './FaceDetectionEngine';
import { detectContext, composeFallbackSentence } from '../ambientNarration/composer';

import { createMessage, findLatestMessage, getMessageById } from '../utilities/messageLogic';
import { addMessageToInteractionData, updatePartialMessageInInteractionData } from '../utilities/interactionDataLogic';
import { getCurrentLocationId, getCoLocatedParticipants, findReachableLocationByRegularExpression } from '../utilities/locationLogic';
import { getGlobalMessageHistory, getLocalMessageHistory } from '../utilities/timelineLogic';
import { detectName } from '../utilities/nameDetection';
import { getUniversalMessageFilterFlags } from '../utilities/promptLogic';
import { evaluateAutoResumeSignals, injectStopSignals, broadcastToolStateChanges, hasTextContent, NO_ARG_TOOLS, HOST_ONLY_TOOLS, finalizeMessageById } from '../utilities/chatSessionLogic';
import { computeModulatedStaminaRegenationAmounts, computeChatStaminaConsumptionCost, computeMovementCost } from '../utilities/dynamicCharacterLogic';
import { generateChatStaminaForInteractionData, generateActionStaminaForInteractionData, consumeChatStaminaForMessage, getEffectiveUseFrontCameraImage, getEffectiveVisualSensitivity } from '../utilities/characterLogic';
import { saveRawInteractionData } from '../storages/serverStorage';
import { learnFromUserMessage } from './ActionFormatEngine';
import { defaultInputStrategy } from '../dictionaries/defaults';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';
import { findActiveThinkEndToken } from '../dictionaries/modelTemplates';

import type { Character, InteractionData, PromptBlock, Context, Location, AudioTrack, World, LanguageModel, SpatiotemporalModel, TokenSampler, StopPattern, RetrievalConfiguration, BudgetStrategy, Profile, Memory, Account, MultiplayerData, RawInteractionData, EntityFolder, ChatMessage, WhisperMessage, ToolMessage, HistoryMessage, InterjectableAction, NarrationMessage, TextMessage, InteractionMessage } from '../types';

export interface CoordinatorDependencies {
    isMultiplayerClient: boolean;
    joinProtagonist: Character | null;
    allCharacters: Character[];
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allWorlds: World[];
    allLanguageModels: LanguageModel[];
    allSpatiotemporalModels: SpatiotemporalModel[];
    allTokenSamplers: TokenSampler[];
    allPromptBlocks: PromptBlock[];
    allStopPatterns: StopPattern[];
    allRetrievalConfigurations: RetrievalConfiguration[];
    allBudgetStrategies: BudgetStrategy[];
    allProfiles: Profile[];
    allMemories: Memory[];
    allAccounts: Account[];
    allMultiplayerData: MultiplayerData[];
    allRawInteractionDataShells: RawInteractionData[];
    allEntityFolders: EntityFolder[];
    allActions: InterjectableAction[];
    requestBorrowedModel?: () => Promise<LanguageModel | null>;
    requestPeerInference?: (peerAccountId: string, modelName: string, promptOrMessages: any, onToken: (token: string) => void, signal?: AbortSignal) => Promise<void>;
    addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
    onMessageBroadcast?: (message: HistoryMessage) => void;
    onStateBroadcast?: (state: Partial<InteractionData>) => void;
}

const AMBIENT_SYSTEM_PROMPT = "You are an ambient narration engine for a roleplay chat. Your ONLY job is to write a single short sentence (1-2 sentences max) describing the environment, atmosphere, or sensory details of the current moment. You must NOT write dialogue, character actions, thoughts, or advance the plot. You describe only the physical space, sounds, light, temperature, weather, and mood of the setting. Write in third person, present tense. Output ONLY the narration text with no preamble, no quotes, no markdown.";

function encodeFileToDataUrl(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const commaIdx = dataUrl.indexOf(',');
            if (commaIdx !== -1 && file.name) {
                const header = dataUrl.slice(0, commaIdx);
                const base64Part = dataUrl.slice(commaIdx);
                if (!header.includes(';name=')) {
                    const encodedName = encodeURIComponent(file.name);
                    const base64Idx = header.indexOf(';base64');
                    const newHeader = base64Idx !== -1
                        ? `${header.slice(0, base64Idx)};name=${encodedName}${header.slice(base64Idx)}`
                        : `${header};name=${encodedName}`;
                    resolve(`${newHeader}${base64Part}`);
                    return;
                }
            }
            resolve(dataUrl);
        };
        reader.onerror = reject;
    });
}

class ChatSessionCoordinator {
    private isGenerating = false;
    private currentLockEpoch = 0;
    private abortController: AbortController | null = null;
    private voiceTracker: StreamingVoiceTracker | null = null;
    private wasStopped = false;
    private isSkippingThinking = false;
    private pendingSkipText: string | null = null;
    private activeMessageId: string | null = null;
    private lastFaceMotionCheckAt = 0;
    private deps!: CoordinatorDependencies;

    private characterActor = new CharacterActor();
    private characterSoul = new CharacterSoul();

    public setDependencies(deps: CoordinatorDependencies) {
        this.deps = deps;
    }

    public setupPeerInference() {
        const engineInstance = getLanguageModelEngine();
        if (typeof (engineInstance as any).setPeerInferenceHandler === 'function') {
            if (this.deps.requestPeerInference) {
                (engineInstance as any).setPeerInferenceHandler(async (modelId: string, prompt: any, onToken: (token: string) => void, signal?: AbortSignal) => {
                    if (modelId.startsWith('borrowed-')) {
                        const parts = modelId.split('-');
                        const ownerAccountId = parts[1];
                        if (ownerAccountId && this.deps.requestPeerInference) {
                            await this.deps.requestPeerInference(ownerAccountId, modelId, prompt, onToken, signal);
                            return true;
                        }
                    }
                    return false;
                });
            } else {
                (engineInstance as any).setPeerInferenceHandler(undefined);
            }
        }
    }

    private acquireLock(): boolean {
        if (this.isGenerating) return false;
        this.currentLockEpoch++;
        this.isGenerating = true;
        this.wasStopped = false;
        this.isSkippingThinking = false;
        this.pendingSkipText = null;
        useGenerationStore.setState({ streamingText: '', streamingCharacter: null, streamingMessageId: null });
        return true;
    }

    private releaseLock(): void {
        this.isGenerating = false;
        this.activeMessageId = null;
        this.isSkippingThinking = false;
        this.pendingSkipText = null;
        useGenerationStore.setState({ streamingText: '', streamingCharacter: null, streamingMessageId: null });
        if (this.abortController) {
            this.abortController = null;
        }
    }

    private releaseLockIfCurrent(epoch: number): void {
        if (this.currentLockEpoch === epoch) {
            this.releaseLock();
        }
    }

    private buildToolContext(): ToolExecutionContext {
        return {
            allCharacters: this.deps.allCharacters,
            allContexts: this.deps.allContexts,
            allLocations: this.deps.allLocations,
            allAudioTracks: this.deps.allAudioTracks,
            allWorlds: this.deps.allWorlds,
            allLanguageModels: this.deps.allLanguageModels,
            allSpatiotemporalModels: this.deps.allSpatiotemporalModels,
            allTokenSamplers: this.deps.allTokenSamplers,
            allPromptBlocks: this.deps.allPromptBlocks,
            allStopPatterns: this.deps.allStopPatterns,
            allRetrievalConfigurations: this.deps.allRetrievalConfigurations,
            allBudgetStrategies: this.deps.allBudgetStrategies,
            allProfiles: this.deps.allProfiles,
            allMemories: this.deps.allMemories,
            allAccounts: this.deps.allAccounts,
            allMultiplayerData: this.deps.allMultiplayerData,
            allRawInteractionDataShells: this.deps.allRawInteractionDataShells,
            allEntityFolders: this.deps.allEntityFolders,
            allExtensions: [],
            captureFrontCameraImage: () => frontCameraEngine.captureImage(),
            addToast: this.deps.addToast,
        };
    }

    private getActivePromptBlocks(data: InteractionData): PromptBlock[] {
        const strategy = data.profile?.inputStrategy ?? defaultInputStrategy;
        return this.deps.allPromptBlocks.filter(pb => strategy.includes(pb.id));
    }

    public resetAutonomousPacing(): void {
        const state = useChatStore.getState();
        if (state.interactionData?.profile?.autonomousMode && !this.deps?.isMultiplayerClient) {
            this.stopAutonomousMode();
            this.startAutonomousMode();
        }
    }

    public startAutonomousMode(): void {
        if (this.deps?.isMultiplayerClient) {
            this.stopAutonomousMode();
            return;
        }

        const executor = async (d: InteractionData, c: Character, _signal: AbortSignal) => {
            useGenerationStore.setState({ streamingCharacter: c, streamingText: '', streamingMessageId: null });
            
            let turnData = d;
            const protagonistId = useChatStore.getState().localProtagonist?.id || turnData.protagonistIds?.[0];
            if (protagonistId) {
                const protagonist = turnData.participants.find(p => p.id === protagonistId);
                if (protagonist && getEffectiveUseFrontCameraImage(protagonist, turnData.profile) && !frontCameraEngine.isFrameStreamingActive()) {
                    try {
                        const freshImageBase64 = await frontCameraEngine.captureImage();
                        if (freshImageBase64) {
                            const latestMsgInfo = findLatestMessage(turnData, protagonist, ['chat', 'whisper', 'tool']);
                            if (
                                latestMsgInfo &&
                                (latestMsgInfo.message.messageType === 'chat' ||
                                    latestMsgInfo.message.messageType === 'whisper' ||
                                    latestMsgInfo.message.messageType === 'tool')
                            ) {
                                const locMessages = turnData.interactionHistories[latestMsgInfo.locationId];
                                if (locMessages) {
                                    const msgIdx = locMessages.findIndex(m => m.id === latestMsgInfo.message.id);
                                    if (msgIdx !== -1) {
                                        const updatedLocMessages = [...locMessages];
                                        updatedLocMessages[msgIdx] = {
                                            ...latestMsgInfo.message,
                                            frontCameraImage: freshImageBase64,
                                        } as ChatMessage | WhisperMessage | ToolMessage;
                                        turnData = {
                                            ...turnData,
                                            interactionHistories: {
                                                ...turnData.interactionHistories,
                                                [latestMsgInfo.locationId]: updatedLocMessages,
                                            },
                                        };
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('Autonomous front camera capture failed:', e);
                    }
                }
            }

            let updatedData = await this.runSingleTurn(turnData, c);

            const preToolData = updatedData;
            updatedData = processPendingToolActions(updatedData, this.deps?.allCharacters || [], { onToast: this.deps?.addToast });
            broadcastToolStateChanges(preToolData, updatedData, this.deps?.onStateBroadcast);

            faceDetectionEngine.resetAccumulatedMotion();

            return { interactionData: updatedData, isCompleted: true };
        };

        const checkCanAct = (): boolean => {
            if (this.isGenerating) return false;
            const state = useChatStore.getState();
            const hasActiveModel = Boolean(state.selectedLanguageModel || state.activeStrategy);
            return hasActiveModel && Boolean(state.interactionData?.profile?.autonomousMode);
        };

        const getData = (): InteractionData | null => useChatStore.getState().interactionData;

        const setData = (data: InteractionData): void => {
            useChatStore.setState({ interactionData: data });
            saveRawInteractionData(data).catch(console.warn);
            this.deps?.onStateBroadcast?.({});
        };

        const onSpeakerChange = (char: Character | null): void => {
            useGenerationStore.setState({ streamingCharacter: char, streamingText: '', streamingMessageId: null });
        };

        this.characterSoul.start(
            executor,
            checkCanAct,
            getData,
            setData,
            onSpeakerChange,
            () => this.acquireLock(),
            () => this.releaseLock(),
            () => this.deps?.allCharacters || [],
        );
    }

    public stopAutonomousMode(): void {
        this.characterSoul.stop();
    }

    private async runSingleTurn(
        currentData: InteractionData,
        character: Character,
        resumingMessageId?: string,
        existingText: string = '',
    ): Promise<InteractionData> {
        let activeData = currentData;
        const profile = activeData.profile;
        const promptBlocks = this.getActivePromptBlocks(activeData);
        let currentExistingText = existingText;
        let autoResumeCount = 0;
        const narratorBehaviour = profile?.textGenerationBehaviourOnNarration ?? 'wait';

        const charLocationId = getCurrentLocationId(activeData, character) || 'global';
        const protagonistId = activeData.protagonistIds?.[0];
        const protagonist = protagonistId ? activeData.participants.find(p => p.id === protagonistId) : null;
        const protagonistLocationId = protagonist ? (getCurrentLocationId(activeData, protagonist) || 'global') : 'global';
        
        const isBackground = charLocationId !== protagonistLocationId;

        if (!resumingMessageId) {
            const aiMessage = createMessage(character, {
                textContent: currentExistingText,
                interactionData: activeData,
            }) as ChatMessage;

            activeData = addMessageToInteractionData(activeData, aiMessage, charLocationId);
            resumingMessageId = aiMessage.id;
            this.activeMessageId = aiMessage.id;
            
            const currentLoading = useGenerationStore.getState().loadingLocations || {};
            useGenerationStore.setState({
                loadingLocations: { ...currentLoading, [charLocationId]: true },
                isLoading: isBackground ? useGenerationStore.getState().isLoading : true,
                streamingCharacter: character,
                streamingText: currentExistingText,
                streamingMessageId: this.activeMessageId
            });
            useChatStore.setState({ interactionData: activeData });
            saveRawInteractionData(activeData).catch(console.warn);
        } else {
            this.activeMessageId = resumingMessageId;
            
            const currentLoading = useGenerationStore.getState().loadingLocations || {};
            useGenerationStore.setState({
                loadingLocations: { ...currentLoading, [charLocationId]: true },
                isLoading: isBackground ? useGenerationStore.getState().isLoading : true,
                streamingCharacter: character,
                streamingText: currentExistingText,
                streamingMessageId: this.activeMessageId
            });
        }

        try {
            if (profile?.enableCharacterExpression) {
                sentimentEngine.initialize().catch(() => {});
            } else {
                sentimentEngine.unload();
            }

            let borrowedModel: LanguageModel | null = null;
            if (this.deps.requestBorrowedModel) {
                try {
                    borrowedModel = await this.deps.requestBorrowedModel();
                } catch (e) {
                    console.warn('Failed to borrow model from peer:', e);
                }
            }

            const charHistory = getLocalMessageHistory(activeData, character, ['chat', 'whisper']) as TextMessage[];
            speculativeMarkovEngine.syncMessages(
                charHistory.map(m => ({ textContent: m.textContent, lastUpdatedTimestamp: m.lastUpdatedTimestamp })),
                character.id, activeData.id
            );

            while (true) {
                this.abortController = new AbortController();
                
                if (this.voiceTracker && narratorBehaviour !== 'continue') {
                    this.voiceTracker.stopImmediate();
                    this.voiceTracker = null;
                }

                const isVoiceEnabledInProfile = profile?.narrateTexts ? Object.values(profile.narrateTexts).some(v => v === true) : false;

                if (isVoiceEnabledInProfile) {
                    this.voiceTracker = new StreamingVoiceTracker(character, this.deps.allCharacters);
                    if (currentExistingText) this.voiceTracker.seed(currentExistingText);
                    await this.voiceTracker.start().catch(() => {});
                } else {
                    this.voiceTracker = null;
                }

                useGenerationStore.setState({ 
                    streamingCharacter: character, 
                    streamingText: currentExistingText,
                    streamingMessageId: this.activeMessageId 
                });

                const currentState = useChatStore.getState();
                
                const callbacks = {
                    onDisplayText: (text: string) => {
                        useGenerationStore.setState({ streamingText: text });
                        const updated = updatePartialMessageInInteractionData(
                            useChatStore.getState().interactionData!, 
                            character, 
                            text, 
                            undefined, 
                            resumingMessageId!
                        );
                        useChatStore.setState({ interactionData: updated });
                    },
                    onLatency: (ms: number) => useGenerationStore.getState().setStats({ latency: ms }),
                    onTimeToFirstToken: (ms: number) => useGenerationStore.getState().setStats({ timeToFirstToken: ms }),
                    onExpression: (expr: string) => useGenerationStore.setState({ currentCharacterExpression: expr }),
                };

                const params: TurnExecutionParams = {
                    data: activeData,
                    character,
                    signal: this.abortController.signal,
                    selectedLanguageModel: currentState.selectedLanguageModel,
                    runningLanguageModels: currentState.runningLanguageModels,
                    activeStrategy: currentState.activeStrategy,
                    allPromptBlocks: promptBlocks,
                    existingCharacterText: currentExistingText,
                    callbacks,
                    isMultiplayerClient: this.deps.isMultiplayerClient,
                    borrowedModel,
                    toolContext: this.buildToolContext(),
                    voiceTracker: this.voiceTracker ?? undefined,
                    resumingMessageId: resumingMessageId,
                };

                const outcome = await this.characterActor.executeTurn(params);

                if (this.isSkippingThinking && this.pendingSkipText) {
                    this.isSkippingThinking = false;
                    currentExistingText = this.pendingSkipText;
                    this.pendingSkipText = null;

                    useGenerationStore.setState({ streamingText: currentExistingText });
                    activeData = updatePartialMessageInInteractionData(
                        useChatStore.getState().interactionData!,
                        character,
                        currentExistingText,
                        undefined,
                        resumingMessageId!
                    );
                    useChatStore.setState({ interactionData: activeData });

                    continue;
                }

                if ('error' in outcome) {
                    if (outcome.error.type !== 'aborted') {
                        this.deps.addToast(`Inference Error: ${outcome.error.message}`, 'error');
                    }
                    activeData = useChatStore.getState().interactionData || activeData;
                    break;
                }

                const { result } = outcome;
                if (result.budgetData) useChatStore.setState({ budgetData: result.budgetData });
                
                activeData = result.updatedData;

                if (activeData) {
                    useChatStore.setState({ interactionData: activeData });
                    saveRawInteractionData(activeData).catch(console.warn);
                    this.deps.onStateBroadcast?.({});
                    
                    const targetBroadcastMsg = resumingMessageId 
                        ? getMessageById(activeData, resumingMessageId)?.message
                        : findLatestMessage(activeData, character)?.message;
                        
                    if (targetBroadcastMsg) this.deps.onMessageBroadcast?.(targetBroadcastMsg);
                }

                const evaluation = evaluateAutoResumeSignals(profile, result.rawText, autoResumeCount);
                if (evaluation.shouldResume && !this.wasStopped && !result.isCompleted) {
                    autoResumeCount++;
                    activeData = injectStopSignals(activeData, evaluation.patternsToInject);
                    currentExistingText = result.rawText;
                    continue;
                }

                this.activeMessageId = null;
                if (!useGenerationStore.getState().streamingText && (result.displayText || result.rawText)) {
                    useGenerationStore.setState({
                        streamingText: result.displayText || result.rawText,
                        streamingMessageId: resumingMessageId,
                    });
                }

                if (this.voiceTracker && narratorBehaviour === 'wait' && !this.wasStopped) {
                    await this.voiceTracker.waitForPlaybackCompletion().catch(() => {});
                }

                currentExistingText = result.rawText;
                break; 
            }

            this.activeMessageId = null;

            const history = getGlobalMessageHistory(activeData);
            const isAtTip = !resumingMessageId || (history.length > 0 && history[history.length - 1].id === resumingMessageId);

            if (!this.wasStopped && isAtTip) {
                await runSummarization({
                    data: activeData,
                    character,
                    promptBlocks,
                    setInteractionData: (d) => {
                        if (this.wasStopped) return;
                        activeData = d;
                        useChatStore.setState({ interactionData: d });
                    },
                    addToast: this.deps.addToast
                });
            }
        } finally {
            this.activeMessageId = null;
            const currentLoading = { ...(useGenerationStore.getState().loadingLocations || {}) };
            delete currentLoading[charLocationId];
            useGenerationStore.setState({ 
                loadingLocations: currentLoading,
                isLoading: isBackground ? useGenerationStore.getState().isLoading : false,
                streamingText: '', 
                streamingCharacter: null, 
                streamingMessageId: null 
            });
        }

        return activeData;
    }

    private async runSequence(
        startData: InteractionData, 
        excludeFromSequence?: Set<string>,
        options?: { skipAmbientNarration?: boolean },
    ): Promise<InteractionData> {
        let currentData = startData;
        const preTurnCount = getGlobalMessageHistory(currentData).length;
        
        this.abortController = new AbortController();

        const executor = async (d: InteractionData, c: Character, _signal?: AbortSignal) => {
            useGenerationStore.setState({ streamingCharacter: c, streamingText: '', streamingMessageId: null });
            currentData = await this.runSingleTurn(d, c);
            
            const preToolData = currentData;
            currentData = processPendingToolActions(currentData, this.deps.allCharacters, { onToast: this.deps.addToast });
            broadcastToolStateChanges(preToolData, currentData, this.deps.onStateBroadcast);
            
            return { interactionData: currentData, isCompleted: true }; 
        };

        const result = await runTurnSequence(
            currentData, 
            executor, 
            this.abortController,
            (c) => useGenerationStore.setState({ streamingCharacter: c, streamingText: '', streamingMessageId: null }),
            (d) => { currentData = d; useChatStore.setState({ interactionData: d }); },
            { excludeFromSequence }
        );

        if (result) {
            currentData = result.interactionData;
            useChatStore.setState({ interactionData: currentData });
            saveRawInteractionData(currentData).catch(console.warn);
        }

        const postTurnCount = getGlobalMessageHistory(currentData).length;
        if (postTurnCount > preTurnCount) {
            faceDetectionEngine.resetAccumulatedMotion();
        }

        if (!options?.skipAmbientNarration && postTurnCount <= preTurnCount && currentData.profile?.enableAmbientNarration && !this.wasStopped) {
            const ambientData = await this.generateAmbientNarration(currentData, this.abortController.signal);
            if (ambientData) {
                currentData = ambientData;
                useChatStore.setState({ interactionData: currentData });
                saveRawInteractionData(currentData).catch(console.warn);
                const latestMsg = findLatestMessage(currentData, currentData.participants[0])?.message;
                if (latestMsg) this.deps.onMessageBroadcast?.(latestMsg);
            }
        }

        return currentData;
    }

    private async generateAmbientNarration(data: InteractionData, signal: AbortSignal): Promise<InteractionData | null> {
        const protagonistId = data.protagonistIds?.[0];
        const protagonistStub = protagonistId ? { id: protagonistId } as Character : null;
        const coLocatedCount = protagonistStub ? getCoLocatedParticipants(data, protagonistStub).length : 0;
        
        const allRelevantMessages = getGlobalMessageHistory(data, ['chat', 'narration']) as HistoryMessage[];
        const filterFlags = getUniversalMessageFilterFlags(allRelevantMessages as TextMessage[], this.getActivePromptBlocks(data), data.contexts || [], data.locations || []);
        const visibleMessages = allRelevantMessages.filter((_, i) => !filterFlags[i]);

        const recentChatMessages = visibleMessages.filter(m => m.messageType === 'chat').slice(-(coLocatedCount + 1)) as ChatMessage[];
        const recentText = recentChatMessages.map(m => m.textContent).join('\n');
        const { tags, dominantMood } = detectContext(recentText);
        
        const recentAmbient = visibleMessages.filter(m => m.messageType === 'narration').slice(-5).map(m => m.textContent);
        const tagList = [...tags].slice(0, 10).join(', ');
        
        const userPrompt = `Recent conversation context:\n${recentText}\n\nDetected environmental cues: ${tagList || 'none'}\nDominant mood: ${dominantMood}\n\nWrite one ambient narration sentence for this moment. Do NOT repeat any of these previous narrations: ${recentAmbient.join(' | ')}`;

        let selected = '';
        try {
            const requestBody = { prompt: `${AMBIENT_SYSTEM_PROMPT}\n\n${userPrompt}`, n_predict: 128, temperature: 1, stop: ['\n\n', '\nUser:', '\nCharacter'] };
            const state = useChatStore.getState();
            
            if (state.activeStrategy) {
                const bse = getBudgetStrategyEngine();
                const res = await bse.generateCompletion(requestBody, signal);
                selected = res.text;
            } else if (state.selectedLanguageModel) {
                const engine = getLanguageModelEngine();
                engine.setRunningModels(state.runningLanguageModels);
                engine.setContext(state.selectedLanguageModel);
                const res = await engine.generateCompletion(requestBody);
                selected = res.text;
            }
        } catch (e) {
            console.warn('LLM ambient narration failed:', e);
        }

        if (!selected) selected = composeFallbackSentence(tags, dominantMood, recentAmbient);
        const cleaned = selected.replace(/^["']|["']$/g, '');
        const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
        const finalText = sentences ? sentences.slice(0, 2).join(' ') : cleaned;

        const currentLocId = protagonistStub ? getCurrentLocationId(data, protagonistStub) : 'global';
        const narrationMessage: NarrationMessage = {
            id: `nar-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            messageType: 'narration',
            textContent: '',
            character: null as unknown as Character, 
            firstCreatedTimestamp: Date.now(),
            lastUpdatedTimestamp: Date.now(),
            characterClothingWearingStatuses: {},
            characterLockedLocations: {},
        };

        let updatedData = addMessageToInteractionData(data, narrationMessage, currentLocId || 'global');
        useChatStore.setState({ interactionData: updatedData });

        const ambientLocId = currentLocId || 'global';
        const currentLoading = useGenerationStore.getState().loadingLocations || {};
        useGenerationStore.setState({
            loadingLocations: { ...currentLoading, [ambientLocId]: true },
            streamingText: '',
            streamingCharacter: null,
            streamingMessageId: narrationMessage.id
        });

        try {
            for (let i = 0; i < finalText.length; i++) {
                if (signal.aborted) break;
                const p = finalText.substring(0, i + 1);
                useGenerationStore.setState({ streamingText: p });
                updatedData = updatePartialMessageInInteractionData(updatedData, null as any, p, undefined, narrationMessage.id);
                useChatStore.setState({ interactionData: updatedData });
                await new Promise(r => setTimeout(r, 20));
            }
        } finally {
            const endLoading = { ...(useGenerationStore.getState().loadingLocations || {}) };
            delete endLoading[ambientLocId];
            useGenerationStore.setState({ 
                loadingLocations: endLoading,
                streamingText: '', 
                streamingCharacter: null, 
                streamingMessageId: null 
            });
        }

        return updatedData;
    }

    public async sendMessage(text: string, files?: File[], frontCameraImageBase64?: string) {
        const state = useChatStore.getState();
        const currentData = state.interactionData;
        const protagonist = this.deps.isMultiplayerClient ? (this.deps.joinProtagonist || state.localProtagonist) : state.localProtagonist;
        if (!currentData || !protagonist || (!text && !files?.length)) return;

        const isNarrationEnabled = currentData.profile?.narrateTexts ? Object.values(currentData.profile.narrateTexts).some(v => v === true) : false;
        if (isNarrationEnabled) textToSpeechEngine.load(); else textToSpeechEngine.unload();

        const slashInvocation = parseSlashCommand(text);
        if (slashInvocation && !files?.length) {
            if (this.deps.isMultiplayerClient && HOST_ONLY_TOOLS.includes(slashInvocation.toolType)) {
                this.deps.addToast(`/${slashInvocation.toolType} requires administrator privileges.`, 'error');
                return;
            }
            if (!slashInvocation.args && !NO_ARG_TOOLS.includes(slashInvocation.toolType)) {
                this.deps.addToast(`/${slashInvocation.toolType} requires arguments.`, 'error');
                return;
            }

            if (!slashInvocation.args) {
                slashInvocation.args = '{}';
            }

            if (!this.acquireLock()) { this.deps.addToast('Already processing...', 'info'); return; }
            const lockEpoch = this.currentLockEpoch;
            try {
                const slashMessage = createMessage(protagonist, {
                    textContent: '',
                    frontCameraImage: frontCameraImageBase64,
                    interactionData: currentData,
                }) as ChatMessage;
                const toolResult = await executeTool(slashInvocation, slashMessage, currentData, this.buildToolContext(), currentData.profile?.toolUsageDisplayMode);

                const canonicalInvocation = `${toolCallStartString}${slashInvocation.toolType}(${slashInvocation.args || ''})${toolCallEndString}`;
                slashMessage.toolExecutionResults = [{ rawMatch: canonicalInvocation, toolType: slashInvocation.toolType, args: slashInvocation.args, textContent: toolResult.textContent, displayReplacement: toolResult.displayReplacement }];
                slashMessage.textContent = `${canonicalInvocation}${toolResultStartString}result: ${toolResult.textContent}${toolResultEndString} `;

                const currentLocId = getCurrentLocationId(currentData, protagonist) || 'global';
                const newHistories = { ...currentData.interactionHistories };
                newHistories[currentLocId] = [...(newHistories[currentLocId] || []), slashMessage];
                
                let updatedData = { ...currentData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
                const preToolData = updatedData;
                
                updatedData = processPendingToolActions(updatedData, this.deps.allCharacters, { onToast: this.deps.addToast });
                
                broadcastToolStateChanges(preToolData, updatedData, this.deps?.onStateBroadcast);
                useChatStore.setState({ interactionData: updatedData });
                this.deps.onMessageBroadcast?.(slashMessage);

                if (this.deps.isMultiplayerClient) { this.releaseLockIfCurrent(lockEpoch); return; }
                await this.runSequence(updatedData);
                this.resetAutonomousPacing();
            } catch (e) {
                this.deps.addToast(`Command failed: ${(e as Error).message}`, 'error');
            } finally {
                this.releaseLockIfCurrent(lockEpoch);
            }
            return;
        }

        if (!this.acquireLock()) { this.deps.addToast('Already generating...', 'info'); return; }
        const lockEpoch = this.currentLockEpoch;
        
        try {
            let updatedData = { ...currentData };
            const { chatRegen, actionRegen } = computeModulatedStaminaRegenationAmounts(protagonist, updatedData);
            if (chatRegen > 0) generateChatStaminaForInteractionData(updatedData, chatRegen, protagonist);
            if (actionRegen > 0) generateActionStaminaForInteractionData(updatedData, actionRegen, protagonist);

            const encodedFiles = files?.length ? await Promise.all(files.map(encodeFileToDataUrl)) : undefined;
            const textMessages = getLocalMessageHistory(updatedData, protagonist, ['chat', 'whisper']) as TextMessage[];
            const knownNames = detectName(protagonist, textMessages, text);

            const chatMessage = createMessage(protagonist, { textContent: text, files: encodedFiles, frontCameraImage: frontCameraImageBase64, knownCharacterNames: knownNames, interactionData: updatedData }) as ChatMessage;

            const paragraphs = (text.match(/\n\n/g) || []).length + 1;
            const chatCost = computeChatStaminaConsumptionCost(protagonist, updatedData, paragraphs);
            if (chatCost > 0) consumeChatStaminaForMessage(chatMessage, chatCost);

            const currentLocId = getCurrentLocationId(updatedData, protagonist) || 'global';
            const newHistories = { ...updatedData.interactionHistories };
            newHistories[currentLocId] = [...(newHistories[currentLocId] || []), chatMessage];
            updatedData = { ...updatedData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };

            this.deps.onMessageBroadcast?.(chatMessage);
            if (this.deps.allActions.length > 0) {
                const prevMsg = textMessages[textMessages.length - 1];
                let prevWrap: '*' | '()' | 'none' | 'unknown' = 'unknown';
                const textContent = prevMsg?.textContent || '';
                if (textContent.includes('*')) prevWrap = '*';
                else if (textContent.includes('(') && textContent.includes(')')) prevWrap = '()';
                else prevWrap = 'none';
                learnFromUserMessage(text, this.deps.allActions.map(a => a.label), prevWrap);
            }

            if (updatedData.locations && updatedData.locations.length > 0) {
                const regexLoc = findReachableLocationByRegularExpression(updatedData, text, protagonist);
                if (regexLoc && regexLoc.id !== currentLocId) {
                    let currentActionStamina = chatMessage.remainingActionStamina;
                    const movementCost = computeMovementCost(currentLocId, regexLoc.id, updatedData.locations);
                    if (movementCost > 0 && currentActionStamina !== undefined) currentActionStamina = Math.max(0, currentActionStamina - movementCost);

                    const arrivalInteraction = createMessage(protagonist, { remainingActionStamina: currentActionStamina, parentMessageId: chatMessage.id, timestamp: chatMessage.firstCreatedTimestamp + 1, previousMessage: chatMessage, interactionData: updatedData }) as InteractionMessage;
                    this.deps.onMessageBroadcast?.(arrivalInteraction);

                    const finalHistories = { ...updatedData.interactionHistories };
                    finalHistories[regexLoc.id] = [...(finalHistories[regexLoc.id] || []), arrivalInteraction];
                    updatedData = { ...updatedData, interactionHistories: finalHistories, lastUpdatedTimestamp: Date.now() };
                }
            }

            useChatStore.setState({ interactionData: updatedData });
            saveRawInteractionData(updatedData).catch(console.warn);

            if (this.deps.isMultiplayerClient) { this.releaseLockIfCurrent(lockEpoch); return; }
            await this.runSequence(updatedData);
            this.resetAutonomousPacing();

        } catch (e) {
            console.error('Send Error:', e);
        } finally {
            this.releaseLockIfCurrent(lockEpoch);
        }
    }

    public async sendDirectedAction(actionText: string, targetChar: Character, protagonistOverride: Character, files?: File[]) {
        const state = useChatStore.getState();
        const currentData = state.interactionData;
        if (!currentData) return;
        if (!this.acquireLock()) { this.deps.addToast('Already generating...', 'info'); return; }
        const lockEpoch = this.currentLockEpoch;

        const protagonist = this.deps.isMultiplayerClient ? (this.deps.joinProtagonist || protagonistOverride) : protagonistOverride;

        try {
            let frontCameraImageBase64: string | undefined;
            if (getEffectiveUseFrontCameraImage(protagonist, currentData.profile)) {
                try {
                    const img = await frontCameraEngine.captureImage();
                    if (img) frontCameraImageBase64 = img;
                } catch (e) {
                    console.warn('Directed action front camera capture failed:', e);
                }
            }

            const encodedFiles = files?.length ? await Promise.all(files.map(encodeFileToDataUrl)) : undefined;
            const textMessages = getLocalMessageHistory(currentData, protagonist, ['chat', 'whisper']) as TextMessage[];
            const chatMessage = createMessage(protagonist, {
                textContent: actionText,
                files: encodedFiles,
                frontCameraImage: frontCameraImageBase64,
                knownCharacterNames: detectName(protagonist, textMessages),
                interactionData: currentData,
            }) as ChatMessage;

            const currentLocId = getCurrentLocationId(currentData, protagonist) || 'global';
            const newHistories = { ...currentData.interactionHistories };
            newHistories[currentLocId] = [...(newHistories[currentLocId] || []), chatMessage];
            let updatedData = { ...currentData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };

            useChatStore.setState({ interactionData: updatedData });
            this.deps.onMessageBroadcast?.(chatMessage);
            saveRawInteractionData(updatedData).catch(console.warn);

            if (this.deps.isMultiplayerClient) { this.releaseLockIfCurrent(lockEpoch); return; }

            updatedData = await this.runSingleTurn(updatedData, targetChar);
            await this.runSequence(updatedData, new Set([targetChar.id]));
            this.resetAutonomousPacing();
        } finally {
            this.releaseLockIfCurrent(lockEpoch);
        }
    }

    public async resumeGeneration(messageId: string) {
        if (this.deps.isMultiplayerClient) { this.deps.addToast('Generation is handled by the host.', 'info'); return; }
        const state = useChatStore.getState();
        const currentData = state.interactionData;
        if (!currentData) return;

        const history = getGlobalMessageHistory(currentData);
        const targetIdx = history.findIndex(m => m.id === messageId);
        if (targetIdx === -1) { this.deps.addToast('Message not found.', 'error'); return; }
        const msg = history[targetIdx];
        if (!hasTextContent(msg)) { this.deps.addToast('Message not found.', 'error'); return; }

        if (!this.acquireLock()) { this.deps.addToast('Already generating...', 'info'); return; }
        const lockEpoch = this.currentLockEpoch;
        
        this.activeMessageId = messageId;
        
        try {
            const char = currentData.participants.find(p => p.id === msg.character.id) || msg.character || this.deps.allCharacters.find(c => c.id === msg.character.id);
            await this.runSingleTurn(currentData, char, messageId, msg.textContent);
            this.resetAutonomousPacing();
        } catch (e) {
            console.error('Resume failed:', e);
            this.deps.addToast(`Resume error: ${(e as Error).message}`, 'error');
        } finally {
            this.activeMessageId = null;
            this.releaseLockIfCurrent(lockEpoch);
        }
    }

    public async regenerateFromMessage(messageId: string, protagonistIds: string[]) {
        if (this.deps.isMultiplayerClient) { this.deps.addToast('Generation handled by host.', 'info'); return; }
        const state = useChatStore.getState();
        const currentData = state.interactionData;
        if (!currentData) return;

        if (!this.acquireLock()) { this.deps.addToast('Already generating...', 'info'); return; }
        const lockEpoch = this.currentLockEpoch;
        try {
            const protagonistIdSet = new Set([
                ...(protagonistIds || []),
                ...(currentData.protagonistIds || [])
            ]);
            const history = getGlobalMessageHistory(currentData);
            const targetIdx = history.findIndex(m => m.id === messageId);
            if (targetIdx === -1) { this.deps.addToast('Message not found.', 'error'); return; }

            const targetMsg = history[targetIdx];
            const isProtagonist = protagonistIdSet.has(targetMsg.character.id);

            let freshFrontCameraImage: string | undefined;
            const localProtagonist = state.localProtagonist;
            const isLocalUsersMessage = !localProtagonist || targetMsg.character.id === localProtagonist.id;

            if (
                isProtagonist &&
                isLocalUsersMessage &&
                (targetMsg.messageType === 'chat' || targetMsg.messageType === 'whisper' || targetMsg.messageType === 'tool')
            ) {
                const protagonistChar =
                    (localProtagonist?.id === targetMsg.character.id ? localProtagonist : undefined) ||
                    currentData.participants.find(p => p.id === targetMsg.character.id) ||
                    this.deps.allCharacters.find(c => c.id === targetMsg.character.id) ||
                    targetMsg.character;

                if (getEffectiveUseFrontCameraImage(protagonistChar, currentData.profile)) {
                    try {
                        const img = await frontCameraEngine.captureImage();
                        if (img) freshFrontCameraImage = img;
                    } catch (e) {
                        console.warn('Regenerate front camera capture failed:', e);
                    }
                    if (this.currentLockEpoch !== lockEpoch || this.wasStopped) return;
                }
            }

            const trimIdx = isProtagonist ? targetIdx + 1 : targetIdx;
            const keptHistories: Record<string, HistoryMessage[]> = {};
            for (const [locId, msgs] of Object.entries(currentData.interactionHistories || {})) {
                keptHistories[locId] = msgs
                    .filter(m => {
                        const globalIdx = history.findIndex(hm => hm.id === m.id);
                        return globalIdx !== -1 && globalIdx < trimIdx;
                    })
                    .map(m => {
                        if (
                            freshFrontCameraImage &&
                            m.id === targetMsg.id &&
                            (m.messageType === 'chat' || m.messageType === 'whisper' || m.messageType === 'tool')
                        ) {
                            if (m.messageType === 'tool') {
                                return {
                                    ...m,
                                    frontCameraImage: freshFrontCameraImage,
                                    lastUpdatedTimestamp: Date.now(),
                                };
                            }
                            return {
                                ...m,
                                frontCameraImage: freshFrontCameraImage,
                                kvCacheTextContentPaths: {},
                                kvCacheTextContentSummaryPaths: {},
                                kvCacheInteractionTextContentSummaries: {},
                                lastUpdatedTimestamp: Date.now(),
                            };
                        }
                        return m;
                    });
            }

            const numberOfMessages = Object.values(keptHistories).reduce((sum, msgs) => sum + msgs.length, 0);
            let updatedData: InteractionData = {
                ...currentData,
                interactionHistories: keptHistories,
                numberOfMessages,
                lastUpdatedTimestamp: Date.now(),
            };
            useChatStore.setState({ interactionData: updatedData });
            saveRawInteractionData(updatedData).catch(console.warn);

            if (isProtagonist) {
                await this.runSequence(updatedData);
            } else {
                const char = currentData.participants.find(p => p.id === targetMsg.character.id) || targetMsg.character || this.deps.allCharacters.find(c => c.id === targetMsg.character.id);

                let lastProtagonistIdx = -1;
                for (let i = targetIdx - 1; i >= 0; i--) {
                    if (protagonistIdSet.has(history[i].character.id)) {
                        lastProtagonistIdx = i;
                        break;
                    }
                }

                const excludedFromSequence = new Set<string>();
                excludedFromSequence.add(char.id);

                const startIdx = lastProtagonistIdx !== -1 ? lastProtagonistIdx + 1 : 0;
                for (let i = startIdx; i < targetIdx; i++) {
                    const msg = history[i];
                    if (msg.character?.id && !protagonistIdSet.has(msg.character.id)) {
                        excludedFromSequence.add(msg.character.id);
                    }
                }

                updatedData = await this.runSingleTurn(updatedData, char);
                await this.runSequence(updatedData, excludedFromSequence);
            }
            this.resetAutonomousPacing();
        } finally {
            this.releaseLockIfCurrent(lockEpoch);
        }
    }

    public stopGeneration() {
        this.wasStopped = true;
        this.isSkippingThinking = false;
        this.pendingSkipText = null;
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (this.voiceTracker) {
            this.voiceTracker.stopImmediate();
            this.voiceTracker = null;
        }

        const state = useChatStore.getState();
        const genState = useGenerationStore.getState();
        
        if (this.activeMessageId && state.interactionData) {
            const targetInfo = getMessageById(state.interactionData, this.activeMessageId);
            const targetMsg = targetInfo?.message;
            const existingMsgText = (targetMsg && hasTextContent(targetMsg)) ? targetMsg.textContent : '';
            const hasAttachedMedia = Boolean(
                targetMsg &&
                ((targetMsg as ChatMessage).files?.length || (targetMsg as ChatMessage).frontCameraImage)
            );
            const textToKeep = genState.streamingText || existingMsgText;

            if (textToKeep) {
                const updated = finalizeMessageById(state.interactionData, this.activeMessageId, true, textToKeep);
                useChatStore.setState({ interactionData: updated });
                saveRawInteractionData(updated).catch(console.warn);
            } else if (!hasAttachedMedia) {
                const cleanedHistories = { ...state.interactionData.interactionHistories };
                for (const [locId, msgs] of Object.entries(cleanedHistories)) {
                    cleanedHistories[locId] = msgs.filter(m => m.id !== this.activeMessageId);
                }
                const updated = { ...state.interactionData, interactionHistories: cleanedHistories };
                useChatStore.setState({ interactionData: updated });
                saveRawInteractionData(updated).catch(console.warn);
            }
        }

        const currentLoading = { ...(genState.loadingLocations || {}) };
        if (this.activeMessageId && state.interactionData) {
             for (const [locId, msgs] of Object.entries(state.interactionData.interactionHistories || {})) {
                 if (msgs.some(m => m.id === this.activeMessageId)) {
                     delete currentLoading[locId];
                     break;
                 }
             }
        }
        
        useGenerationStore.setState({ 
            loadingLocations: Object.keys(currentLoading).length > 0 ? currentLoading : {},
            isLoading: false,
            streamingText: '', 
            streamingCharacter: null, 
            streamingMessageId: null 
        });

        this.currentLockEpoch++;
        this.activeMessageId = null;
        this.releaseLock();
        this.resetAutonomousPacing();
    }

    public skipThinking() {
        if (!this.isGenerating || !this.abortController || this.isSkippingThinking) return;

        const genState = useGenerationStore.getState();
        const chatState = useChatStore.getState();
        const text = genState.streamingText;
        if (!text) return;

        const matchingEndToken = findActiveThinkEndToken(text, chatState.selectedLanguageModel);
        if (!matchingEndToken) return;

        this.isSkippingThinking = true;
        this.pendingSkipText = `${text}\n${matchingEndToken}\n\n`;

        this.abortController.abort();
    }
    
    public triggerHostResponse() {
        if (this.deps.isMultiplayerClient) return;
        if (this.isGenerating) return; 
        const state = useChatStore.getState();
        if (state.interactionData) {
            if (!this.acquireLock()) return;
            const lockEpoch = this.currentLockEpoch;
            this.runSequence(state.interactionData)
                .then(() => this.resetAutonomousPacing())
                .finally(() => this.releaseLockIfCurrent(lockEpoch));
        }
    }

    public handleFacePresenceChange(_isDetected: boolean): void {
        if (!this.deps || this.deps.isMultiplayerClient) return;
        if (this.isGenerating) return;

        const state = useChatStore.getState();
        const currentData = state.interactionData;
        if (!currentData || !currentData.profile?.enableFaceDetection) return;

        const hasActiveModel = Boolean(state.selectedLanguageModel || state.activeStrategy);
        if (!hasActiveModel) return;

        if (!this.acquireLock()) return;
        const lockEpoch = this.currentLockEpoch;

        this.runSequence(currentData, undefined, { skipAmbientNarration: true })
            .then(() => this.resetAutonomousPacing())
            .catch((e) => console.warn('Face detection turn sequence failed:', e))
            .finally(() => this.releaseLockIfCurrent(lockEpoch));
    }

    public handleFaceMotion(accumulatedMotion: number): void {
        if (!this.deps || this.deps.isMultiplayerClient) return;
        if (this.isGenerating) return;

        const state = useChatStore.getState();
        const currentData = state.interactionData;
        if (!currentData || !currentData.profile?.enableFaceDetection) return;

        const hasActiveModel = Boolean(state.selectedLanguageModel || state.activeStrategy);
        if (!hasActiveModel) return;

        const now = Date.now();
        const minCooldown = Math.max(1000, currentData.profile.faceDetectionIntervalMs || 1000);
        if (now - this.lastFaceMotionCheckAt < minCooldown) return;
        this.lastFaceMotionCheckAt = now;

        const hasLocations = Boolean(currentData.locations && currentData.locations.length > 0);
        const protagonistIdSet = new Set(currentData.protagonistIds || []);
        const protagonistId = currentData.protagonistIds?.[0];
        const protagonist = protagonistId ? currentData.participants.find(p => p.id === protagonistId) : null;

        const aiCandidates = (hasLocations && protagonist)
            ? getCoLocatedParticipants(currentData, protagonist).filter(p => !protagonistIdSet.has(p.id))
            : currentData.participants.filter(p => !protagonistIdSet.has(p.id));

        let maxVisualSensitivity = 0;
        for (const char of aiCandidates) {
            const vs = getEffectiveVisualSensitivity(char, currentData.profile);
            if (vs > maxVisualSensitivity) maxVisualSensitivity = vs;
        }
        if (maxVisualSensitivity <= 0) return;

        const triggerProbability = 1 - Math.exp(-0.35 * accumulatedMotion * maxVisualSensitivity);
        if (Math.random() >= triggerProbability) return;

        if (!this.acquireLock()) return;
        const lockEpoch = this.currentLockEpoch;

        this.runSequence(currentData, undefined, { skipAmbientNarration: true })
            .then(() => this.resetAutonomousPacing())
            .catch((e) => console.warn('Face motion turn sequence failed:', e))
            .finally(() => {
                faceDetectionEngine.resetAccumulatedMotion();
                this.releaseLockIfCurrent(lockEpoch);
            });
    }
}

export const chatCoordinator = new ChatSessionCoordinator();