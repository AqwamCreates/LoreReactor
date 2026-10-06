// frontend_src/hooks/useChatSender.ts
import { useCallback } from 'react';
import type { Character, PromptBlock, InteractionData, HistoryMessage, InterjectableAction, ToolExecutionResult } from '../types';
import { createChatMessage } from '../utilities/chatLogic';
import { processPendingToolActions, executeTool, type ToolExecutionContext } from '../services/ToolExecutor';
import { parseSlashCommand } from '../services/ToolInvocationParser';
import { getCurrentLocationId, findReachableLocationByRegularExpression } from '../utilities/locationLogic';
import { detectName } from '../utilities/nameDetection';
import { getFilteredChatMessages } from '../utilities/promptLogic';
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

interface UseChatSenderOptions {
    isMultiplayerClient: boolean;
    joinProtagonistRef: React.MutableRefObject<Character | null>;
    allCharactersRef: React.MutableRefObject<Character[]>;
    allActionsRef: React.MutableRefObject<InterjectableAction[]>;
    allPromptBlocksRef: React.MutableRefObject<PromptBlock[] | undefined>;
    onMessageBroadcastRef: React.MutableRefObject<((message: HistoryMessage) => void) | undefined>;
    onStateBroadcastRef: React.MutableRefObject<((state: Partial<InteractionData>) => void) | undefined>;
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
        isMultiplayerClient, joinProtagonistRef, allCharactersRef, allActionsRef, allPromptBlocksRef,
        onMessageBroadcastRef, onStateBroadcastRef, buildToolContext, executeTurnPipeline,
        acquireLock, releaseLock, addToast, setInteractionData, getState,
    } = opts;

    const sendMessage = useCallback(async (
        text: string,
        allPromptBlocks: PromptBlock[] | undefined,
        files: File[] | undefined,
        frontCameraImageBase64: string | undefined
    ) => {
        const currentState = getState();
        const activeCharacter = isMultiplayerClient
            ? (joinProtagonistRef.current || currentState.localProtagonist)
            : currentState.localProtagonist;

        if (!currentState.interactionData || !activeCharacter || (!text && (!files || !files.length))) return;

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
                const slashMessage = createChatMessage(currentState.interactionData, activeCharacter, '', {});
                const toolContext = buildToolContext();
                const toolResult = await executeTool(
                    slashInvocation,
                    slashMessage,
                    currentState.interactionData,
                    toolContext,
                    currentState.interactionData.profile?.toolUsageDisplayMode
                );

                // ✅ Store the tool execution result for on-the-fly compilation
                const toolExecutionResult: ToolExecutionResult = {
                    rawMatch: slashInvocation.rawMatch || `<<tool: ${slashInvocation.toolType} ${slashInvocation.args}>>`,
                    toolType: slashInvocation.toolType,
                    args: slashInvocation.args,
                    content: toolResult.content,
                    displayReplacement: toolResult.displayReplacement
                };
                
                if (!slashMessage.toolExecutionResults) {
                    slashMessage.toolExecutionResults = [];
                }
                slashMessage.toolExecutionResults.push(toolExecutionResult);

                const rawCmd = text;
                slashMessage.textContent = rawCmd;
                // Note: processedTextContent is no longer set here - compilation happens on-the-fly

                const preSlashData = currentState.interactionData;
                const currentLocId = getCurrentLocationId(currentState.interactionData, activeCharacter) || 'global';
                const newHistories = { ...currentState.interactionData.interactionHistories };
                if (!newHistories[currentLocId]) newHistories[currentLocId] = [];
                newHistories[currentLocId].push(slashMessage);

                let updatedData = { ...currentState.interactionData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
                updatedData = processPendingToolActions(updatedData, allCharactersRef.current, { onToast: addToast });

                broadcastToolStateChanges(preSlashData, updatedData, onStateBroadcastRef.current);
                setInteractionData(updatedData);

                if (isMultiplayerClient) {
                    onMessageBroadcastRef.current?.(slashMessage);
                    releaseLock();
                    return;
                }

                await executeTurnPipeline({
                    data: updatedData,
                    protagonistId: activeCharacter.id,
                    allPromptBlocks,
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
            const currentInteractionData = currentState.interactionData;

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

            const filteredMessages = getFilteredChatMessages(currentInteractionData, activeCharacter.id, allPromptBlocks || []);
            const knownCharacterNames = detectName(activeCharacter, filteredMessages, text);

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
            if (!newHistories[currentLocId]) newHistories[currentLocId] = [];
            newHistories[currentLocId].push(chatMessage);

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

                    const arrivalInteraction: HistoryMessage = {
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
                    if (!updatedHistories[finalLocId]) {
                        updatedHistories[finalLocId] = [];
                    }
                    updatedHistories[finalLocId].push(arrivalInteraction);
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
                allPromptBlocks,
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

        const filteredMessages = getFilteredChatMessages(currentInteractionData, activeProtagonist.id, allPromptBlocksRef.current || []);
        const knownCharacterNames = detectName(activeProtagonist, filteredMessages);

        const chatMessage = createChatMessage(currentInteractionData, activeProtagonist, actionText, { knownCharacterNames });

        const currentLocId = getCurrentLocationId(currentInteractionData, activeProtagonist) || 'global';
        const newHistories = { ...currentInteractionData.interactionHistories };
        if (!newHistories[currentLocId]) newHistories[currentLocId] = [];
        newHistories[currentLocId].push(chatMessage);

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
    }, [getState, acquireLock, addToast, isMultiplayerClient, setInteractionData, executeTurnPipeline, releaseLock, joinProtagonistRef, allPromptBlocksRef, onMessageBroadcastRef]);

    return {
        sendMessage,
        sendActionAndGetResponse,
    };
}