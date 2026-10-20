// src/frontend_src/hooks/useChatSender.ts
import { useCallback } from 'react';
import type { Character, InteractionData, HistoryMessage, InterjectableAction, ToolExecutionResult, TextMessage, InteractionMessage } from '../types';
import { createChatMessage } from '../utilities/interactionDataLogic';
import { processPendingToolActions, executeTool, parsePythonArgs, type ToolExecutionContext } from '../services/ToolExecutor';
import { parseSlashCommand } from '../services/ToolInvocationParser';
import { getCurrentLocationId, findReachableLocationByRegularExpression } from '../utilities/locationLogic';
import { detectName } from '../utilities/nameDetection';
import { getLocalMessageHistory } from '../utilities/timelineLogic';
import {
    computeModulatedStaminaRegenationAmounts,
    computeChatStaminaConsumptionCost,
    computeMovementCost
} from '../utilities/dynamicCharacterLogic';
import {
    generateChatStaminaForInteractionData,
    generateActionStaminaForInteractionData,
    consumeChatStaminaForMessage
} from '../utilities/characterLogic';
import { v4 as uuidv4 } from 'uuid';
import {
    NO_ARG_TOOLS,
    HOST_ONLY_TOOLS,
    hasTextContent,
    broadcastToolStateChanges,
    type GenerationTurnOptions,
} from '../utilities/chatSessionLogic';
import { learnFromUserMessage } from '../services/ActionFormatEngine';
import { textToSpeechEngine } from '../services/TextToSpeechEngine';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

interface UseChatSenderOptions {
    isMultiplayerClient: boolean;
    joinProtagonistRef: React.RefObject<Character | null>;
    allCharactersRef: React.RefObject<Character[]>;
    allActionsRef: React.RefObject<InterjectableAction[]>;
    onMessageBroadcastRef: React.RefObject<((message: HistoryMessage) => void) | undefined>;
    onStateBroadcastRef: React.RefObject<((state: Partial<InteractionData>) => void) | undefined>;
    buildToolContext: () => ToolExecutionContext;
    executeTurnPipeline: (opts: GenerationTurnOptions) => Promise<void>;
    acquireLock: () => boolean;
    releaseLock: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    setInteractionData: (data: InteractionData) => void;
    getState: () => any;
}

export function useChatSender(opts: UseChatSenderOptions) {
    const {
        isMultiplayerClient, joinProtagonistRef, allCharactersRef, allActionsRef,
        onMessageBroadcastRef, onStateBroadcastRef, buildToolContext, executeTurnPipeline,
        acquireLock, releaseLock, addToast, setInteractionData, getState,
    } = opts;

    const sendMessage = useCallback(async (
        text: string,
        files: File[] | undefined,
        frontCameraImageBase64: string | undefined
    ) => {
        const currentState = getState();
        const currentInteractionData = currentState.interactionData;
        const activeCharacter = isMultiplayerClient
            ? (joinProtagonistRef.current || currentState.localProtagonist)
            : currentState.localProtagonist;

        if (!currentInteractionData || !activeCharacter || (!text && (!files || !files.length))) return;

        const activeProfile = currentInteractionData.profile;

        const isNarrationEnabled = activeProfile?.narrateTexts 
            ? Object.values(activeProfile.narrateTexts).some(v => v === true) 
            : false;

        if (isNarrationEnabled) {
            textToSpeechEngine.load(); 
        } else {
            textToSpeechEngine.unload();
        }

        const slashInvocation = parseSlashCommand(text);
        const isSlashCommand = !!(slashInvocation && !files?.length && !frontCameraImageBase64);

        if (isSlashCommand && slashInvocation) {
            if (isMultiplayerClient && HOST_ONLY_TOOLS.includes(slashInvocation.toolType)) {
                const mpData = getState().multiplayerData;
                const accountId = getState().currentAccountId;
                const accountConfig = accountId ? mpData?.multiplayerDataAccountConfigurations[accountId] : undefined;
                const isAdmin = accountConfig?.isAdministrator;

                if (!isAdmin) {
                    addToast(`/${slashInvocation.toolType} requires administrator privileges.`, 'error');
                    return;
                }
            }

            if (!slashInvocation.args && !NO_ARG_TOOLS.includes(slashInvocation.toolType)) {
                addToast(`/${slashInvocation.toolType} requires arguments.`, 'error');
                return;
            }

            if (!acquireLock()) { addToast('Already processing...', 'info'); return; }
            try {
                const slashMessage = createChatMessage(currentInteractionData, activeCharacter, '', {});
                const toolContext = buildToolContext();
                const toolResult = await executeTool(
                    slashInvocation,
                    slashMessage,
                    currentInteractionData,
                    toolContext,
                    activeProfile?.toolUsageDisplayMode
                );

                // Convert raw slash command to canonical tool call marker (e.g. ⟪dice(2d6+3)⟫)
                const canonicalInvocation = `${toolCallStartString}${slashInvocation.toolType}(${slashInvocation.args || ''})${toolCallEndString}`;

                const toolExecutionResult: ToolExecutionResult = {
                    rawMatch: canonicalInvocation,
                    toolType: slashInvocation.toolType,
                    args: slashInvocation.args,
                    textContent: toolResult.textContent,
                    displayReplacement: toolResult.displayReplacement
                };
                
                if (!slashMessage.toolExecutionResults) {
                    slashMessage.toolExecutionResults = [];
                }
                slashMessage.toolExecutionResults.push(toolExecutionResult);

                // Format with observation delimiters so compileMessageDisplayText and LLM prompt recognize it
                slashMessage.textContent = `${canonicalInvocation}${toolResultStartString}result: ${toolResult.textContent}${toolResultEndString} `;

                const preSlashData = currentInteractionData;
                const currentLocId = getCurrentLocationId(currentInteractionData, activeCharacter) || 'global';
                const newHistories = { ...currentInteractionData.interactionHistories };
                const currentLocMessages = newHistories[currentLocId] || [];
                newHistories[currentLocId] = [...currentLocMessages, slashMessage];

                // Check and handle physical location transitions for /move and /teleport
                const hasLocations = currentInteractionData.locations && currentInteractionData.locations.length > 0;
                let finalLocId: string | undefined = undefined;

                if (hasLocations && (slashInvocation.toolType === 'move' || slashInvocation.toolType === 'teleport')) {
                    if (!toolResult.textContent.startsWith('[Error:') && !toolResult.textContent.startsWith('Already at')) {
                        const pArgs = parsePythonArgs(slashInvocation.args);
                        const targetQuery = (pArgs.get(0, 'location_id', 'location', 'target', 'destination', 'to') || pArgs.positional.join(' ')).toLowerCase().replace(/^["']|["']$/g, '');
                        const targetLoc = currentInteractionData.locations.find(l => 
                            l.id.toLowerCase() === targetQuery || 
                            l.name.toLowerCase() === targetQuery || 
                            l.id.toLowerCase().startsWith(targetQuery)
                        );
                        if (targetLoc) {
                            finalLocId = targetLoc.id;
                        }
                    }
                }

                let currentActionStamina = slashMessage.remainingActionStamina;

                if (hasLocations && finalLocId && currentLocId !== finalLocId) {
                    if (slashInvocation.toolType === 'move') {
                        const movementCost = computeMovementCost(currentLocId, finalLocId, currentInteractionData.locations);
                        if (movementCost > 0 && currentActionStamina !== undefined) {
                            currentActionStamina = Math.max(0, currentActionStamina - movementCost);
                            slashMessage.remainingActionStamina = currentActionStamina;
                        }
                    }

                    const arrivalInteraction: InteractionMessage = {
                        messageType: 'interaction',
                        id: uuidv4(),
                        character: { ...activeCharacter },
                        isPresent: true,
                        remainingChatStamina: slashMessage.remainingChatStamina,
                        remainingActionStamina: currentActionStamina,
                        characterClothingWearingStatuses: slashMessage.characterClothingWearingStatuses,
                        characterLockedLocations: slashMessage.characterLockedLocations,
                        parentMessageId: slashMessage.id,
                        firstCreatedTimestamp: slashMessage.firstCreatedTimestamp + 1,
                        lastUpdatedTimestamp: slashMessage.firstCreatedTimestamp + 1,
                    };

                    onMessageBroadcastRef.current?.(arrivalInteraction);

                    const finalLocMessages = newHistories[finalLocId] || [];
                    newHistories[finalLocId] = [...finalLocMessages, arrivalInteraction];
                }

                let updatedData = { ...currentInteractionData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
                updatedData = processPendingToolActions(updatedData, allCharactersRef.current, { onToast: addToast });

                broadcastToolStateChanges(preSlashData, updatedData, onStateBroadcastRef.current);
                setInteractionData(updatedData);

                onMessageBroadcastRef.current?.(slashMessage);

                if (isMultiplayerClient) {
                    releaseLock();
                    return;
                }

                await executeTurnPipeline({
                    data: updatedData,
                    protagonistId: activeCharacter.id,
                    errorPrefix: 'Send failed',
                    lockAlreadyAcquired: true,
                });
                return;
            } catch (e) {
                console.error('Slash command failed:', e);
                addToast(`Command failed: ${(e as Error).message}`, 'error');
                releaseLock();
                return;
            }
        }

        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }

        try {
            const { chatRegen, actionRegen } = computeModulatedStaminaRegenationAmounts(activeCharacter, currentInteractionData);
            if (chatRegen > 0) {
                generateChatStaminaForInteractionData(currentInteractionData, chatRegen, activeCharacter);
            }
            if (actionRegen > 0) {
                generateActionStaminaForInteractionData(currentInteractionData, actionRegen, activeCharacter);
            }

            const convertFileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = error => reject(error);
            });
            const encodedFiles = files?.length ? await Promise.all(files.map(f => convertFileToBase64(f))) : undefined;

            // Filter history to only include text messages (chat/whisper) to prevent crashes in detectName
            const textMessages = getLocalMessageHistory(currentInteractionData, activeCharacter, ['chat', 'whisper']) as TextMessage[];
            const knownCharacterNames = detectName(activeCharacter, textMessages, text);

            const chatMessage = createChatMessage(currentInteractionData, activeCharacter, text, {
                files: encodedFiles,
                frontCameraImage: frontCameraImageBase64,
                knownCharacterNames
            });

            const paragraphs = (text.match(/\n\n/g) || []).length + 1;
            const chatCost = computeChatStaminaConsumptionCost(activeCharacter, currentInteractionData, paragraphs);
            if (chatCost > 0) {
                consumeChatStaminaForMessage(chatMessage, chatCost);
            }

            const currentLocId = getCurrentLocationId(currentInteractionData, activeCharacter) || 'global';
            const newHistories = { ...currentInteractionData.interactionHistories };
            const currentLocMessages = newHistories[currentLocId] || [];
            newHistories[currentLocId] = [...currentLocMessages, chatMessage];

            let td = { ...currentInteractionData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };

            onMessageBroadcastRef.current?.(chatMessage);

            if (allActionsRef.current.length > 0) {
                let prevWrap: '*' | '()' | 'none' | 'unknown' = 'unknown';
                const localHistory = getLocalMessageHistory(td, activeCharacter);
                for (let i = localHistory.length - 2; i >= 0; i--) {
                    const prevMsg = localHistory[i];
                    if (hasTextContent(prevMsg)) {
                        const prevText = prevMsg.textContent;
                        if (prevText.includes('*')) prevWrap = '*';
                        else if (prevText.includes('(') && prevText.includes(')')) prevWrap = '()';
                        else prevWrap = 'none';
                        break;
                    }
                }
                learnFromUserMessage(text, allActionsRef.current.map(a => a.label), prevWrap);
            }

            const hasLocations = td.locations && td.locations.length > 0;
            if (hasLocations) {
                const currentLocId = getCurrentLocationId(td, activeCharacter);
                const regexLoc = findReachableLocationByRegularExpression(td, chatMessage.textContent, activeCharacter);
                const finalLocId = regexLoc?.id ?? currentLocId;

                if (currentLocId && finalLocId && finalLocId !== currentLocId) {
                    let currentActionStamina = chatMessage.remainingActionStamina;
                    const movementCost = computeMovementCost(currentLocId, finalLocId, td.locations);
                    if (movementCost > 0 && currentActionStamina !== undefined) {
                        currentActionStamina = Math.max(0, currentActionStamina - movementCost);
                    }

                    const arrivalInteraction: InteractionMessage = {
                        messageType: 'interaction',
                        id: uuidv4(),
                        character: { ...activeCharacter },
                        isPresent: true,
                        remainingChatStamina: chatMessage.remainingChatStamina,
                        remainingActionStamina: currentActionStamina,
                        characterClothingWearingStatuses: chatMessage.characterClothingWearingStatuses,
                        characterLockedLocations: chatMessage.characterLockedLocations,
                        parentMessageId: chatMessage.id,
                        firstCreatedTimestamp: chatMessage.firstCreatedTimestamp + 1,
                        lastUpdatedTimestamp: chatMessage.firstCreatedTimestamp + 1,
                    };

                    onMessageBroadcastRef.current?.(arrivalInteraction);

                    const updatedHistories = { ...td.interactionHistories };
                    const finalLocMessages = updatedHistories[finalLocId] || [];
                    updatedHistories[finalLocId] = [...finalLocMessages, arrivalInteraction];
                    td = { ...td, interactionHistories: updatedHistories, lastUpdatedTimestamp: Date.now() };
                }
            }

            setInteractionData(td);

            if (isMultiplayerClient) {
                releaseLock();
                return;
            }

            await executeTurnPipeline({
                data: td,
                protagonistId: activeCharacter.id,
                errorPrefix: 'Send failed',
                lockAlreadyAcquired: true,
            });
        } catch (e) {
            console.error('Send error:', e);
            releaseLock();
        }
    }, [
        getState, isMultiplayerClient, buildToolContext, addToast,
        acquireLock, releaseLock, executeTurnPipeline, setInteractionData,
        joinProtagonistRef, allCharactersRef, allActionsRef, onMessageBroadcastRef, onStateBroadcastRef
    ]);

    const sendActionAndGetResponse = useCallback(async (
        actionText: string,
        targetChar: Character,
        protagonist: Character
    ) => {
        const currentState = getState();
        const currentInteractionData = currentState.interactionData;
        if (!currentInteractionData) return;
        if (!acquireLock()) { addToast('Already generating...', 'info'); return; }

        const activeProtagonist = isMultiplayerClient
            ? (joinProtagonistRef.current || protagonist)
            : protagonist;

        // Filter history to only include text messages (chat/whisper) to prevent crashes in detectName
        const textMessages = getLocalMessageHistory(currentInteractionData, activeProtagonist, ['chat', 'whisper']) as TextMessage[];
        const knownCharacterNames = detectName(activeProtagonist, textMessages);

        const chatMessage = createChatMessage(currentInteractionData, activeProtagonist, actionText, { knownCharacterNames });

        const currentLocId = getCurrentLocationId(currentInteractionData, activeProtagonist) || 'global';
        const newHistories = { ...currentInteractionData.interactionHistories };
        const currentLocMessages = newHistories[currentLocId] || [];
        newHistories[currentLocId] = [...currentLocMessages, chatMessage];

        const td = { ...currentInteractionData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };

        onMessageBroadcastRef.current?.(chatMessage);
        setInteractionData(td);

        if (isMultiplayerClient) {
            releaseLock();
            return;
        }

        const allProtagonistIds = new Set(td.protagonistIds || [protagonist.id]);

        await executeTurnPipeline({
            data: td,
            protagonistId: protagonist.id,
            respondingCharacter: targetChar,
            isProtagonistCharId: (id: string) => allProtagonistIds.has(id),
            errorPrefix: 'Action failed',
            lockAlreadyAcquired: true,
        });
    }, [getState, acquireLock, addToast, isMultiplayerClient, setInteractionData, executeTurnPipeline, releaseLock, joinProtagonistRef, onMessageBroadcastRef]);

    return {
        sendMessage,
        sendActionAndGetResponse,
    };
}