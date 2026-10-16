// src/frontend_src/hooks/useSpeculativeStreamHandler.ts
import { useCallback, useRef, type RefObject } from 'react';
import type { Character, InteractionData, ChatMessage, HistoryMessage, PromptBlock, TextMessage } from '../types';
import { calculateLatencyFactor } from '../utilities/chatSessionLogic';
import { speculativeMarkovEngine } from '../services/SpeculativeMarkovEngine';
import { createChatMessage } from '../utilities/interactionDataLogic';
import { getCurrentLocationId } from '../utilities/locationLogic';
import { getGlobalMessageHistory } from '../utilities/timelineLogic';

interface SpeculativeStreamHandlerParams {
    throttledSetStreamingText: (text: string) => void;
    streamingTextRef: RefObject<string>;
    streamingCharacterRef: RefObject<Character | null>;
    streamingMessageIdRef: RefObject<string | null>;
    abortControllerRef: RefObject<AbortController | null>;
    resumeGenerationRef: RefObject<((messageId: string, allPromptBlocks?: PromptBlock[]) => Promise<void>) | null>;
    onMessageBroadcastRef: RefObject<((message: HistoryMessage) => void) | undefined>;
    getState: () => any;
    setInteractionData: (data: InteractionData) => void;
}

export function useSpeculativeStreamHandler({
    throttledSetStreamingText,
    streamingTextRef,
    streamingCharacterRef,
    streamingMessageIdRef,
    abortControllerRef,
    resumeGenerationRef,
    onMessageBroadcastRef,
    getState,
    setInteractionData,
}: SpeculativeStreamHandlerParams) {
    const isSpeculatingRef = useRef(false);
    const lastTokenTimestampRef = useRef(0);

    const throttledSetStreamingTextWithBroadcast = useCallback((text: string) => {
        throttledSetStreamingText(text);
        streamingTextRef.current = text;

        const char = streamingCharacterRef.current;
        const msgId = streamingMessageIdRef.current;

        const now = Date.now();
        const timeSinceLastToken = lastTokenTimestampRef.current > 0 ? (now - lastTokenTimestampRef.current) : 25;
        lastTokenTimestampRef.current = now;

        const profile = getState().interactionData?.profile;
        if (profile?.enableSpeculativeMarkov && char && msgId && abortControllerRef.current && !isSpeculatingRef.current) {
            const model = getState().selectedModel;
            const currentData = getState().interactionData;
            const currentDataId = currentData?.id || 'unknown';
            const budgetData = getState().budgetData;

            const outputCost = model?.outputGenerationCostPerOneMillionOfTokens || 3;
            const cacheMissCost = model?.cacheMissCostPerOneMillionOfTokens || 0.3;

            const profileTemp = Number(profile.characterLanguageModelSampler?.parameters?.temperature);
            const charTemp = Number(char.languageModelSampler?.parameters?.temperature);

            let temperature = 1.0;
            if (!Number.isNaN(profileTemp)) {
                temperature = profileTemp;
            } else if (!Number.isNaN(charTemp)) {
                temperature = charTemp;
            }
            temperature = Math.max(0.1, temperature);

            if (text.endsWith(' ') || text.endsWith('\n') || text.match(/[.!?]$/)) {
                const prediction = speculativeMarkovEngine.predictSequence(
                    text, outputCost, cacheMissCost, temperature, char.id, currentDataId
                );

                if (prediction) {
                    const estimatedTokens = prediction.split(/\s+/).length;
                    const costRatio = cacheMissCost / outputCost;

                    let minimumTokensThreshold = Number.POSITIVE_INFINITY;
                    if (costRatio < 1) {
                        const modelId = model?.id || '';
                        const TTFT_ms = budgetData?.modelAverageTimeToFirstToken?.[modelId] ?? 500;
                        const msPerToken = budgetData?.modelAverageLatencyMsPerToken?.[modelId] ?? 25;

                        const latencyFactor = calculateLatencyFactor(timeSinceLastToken, TTFT_ms, msPerToken);
                        const TTFT_seconds = TTFT_ms / 1000;
                        const TPS = 1000 / msPerToken;
                        const baseThreshold = (TTFT_seconds * TPS) / (1 - costRatio);
                        minimumTokensThreshold = Math.ceil(baseThreshold * latencyFactor);
                    }

                    if (estimatedTokens >= minimumTokensThreshold) {
                        isSpeculatingRef.current = true;
                        const completedText = text + prediction;
                        throttledSetStreamingText(completedText);
                        streamingTextRef.current = completedText;
                        abortControllerRef.current?.abort();

                        const freshData = getState().interactionData;
                        if (freshData && char) {
                            const history = getGlobalMessageHistory(freshData);
                            const existingMsg = history.find(m => m.id === msgId);
                            let updatedData: InteractionData;

                            if (!existingMsg) {
                                const currentLocId = getCurrentLocationId(freshData, char) || 'global';
                                // createChatMessage already assigns completedText to textContent
                                const speculativeMsg = createChatMessage(freshData, char, completedText);
                                speculativeMsg.id = msgId;
                                speculativeMsg.textContent = completedText;

                                const newHistories = { ...freshData.interactionHistories };
                                if (!newHistories[currentLocId]) newHistories[currentLocId] = [];
                                newHistories[currentLocId].push(speculativeMsg);

                                updatedData = {
                                    ...freshData,
                                    interactionHistories: newHistories,
                                    lastUpdatedTimestamp: Date.now(),
                                };
                            } else {
                                const updatedHistories = { ...freshData.interactionHistories };
                                for (const [locId, msgs] of Object.entries(updatedHistories) as [string, HistoryMessage[]][]) {
                                    const idx = msgs.findIndex((m: { id: string }) => m.id === msgId);
                                    if (idx !== -1) {
                                        updatedHistories[locId] = [...msgs];
                                        updatedHistories[locId][idx] = {
                                            ...existingMsg,
                                            textContent: completedText,
                                            lastUpdatedTimestamp: Date.now(),
                                        } as TextMessage;
                                        break;
                                    }
                                }
                                updatedData = {
                                    ...freshData,
                                    interactionHistories: updatedHistories,
                                    lastUpdatedTimestamp: Date.now(),
                                };
                            }

                            setInteractionData(updatedData);

                            setTimeout(() => {
                                isSpeculatingRef.current = false;
                                resumeGenerationRef.current?.(msgId, undefined);
                            }, 60);
                        } else {
                            isSpeculatingRef.current = false;
                        }
                        return;
                    }
                }
            }
        }

        if (char && msgId && onMessageBroadcastRef.current) {
            const partialMsg: ChatMessage = {
                id: msgId,
                messageType: 'chat',
                character: char,
                textContent: text,
                doNotRespond: false,
                files: [],
                modelTextContentSummaries: {},
                modelInteractionTextContentSummaries: {},
                kvCacheTextContentPaths: {},
                kvCacheTextContentSummaryPaths: {},
                kvCacheInteractionTextContentSummaries: {},
                characterClothingWearingStatuses: {},
                characterLockedLocations: {},
                parentMessageId: null,
                firstCreatedTimestamp: now,
                lastUpdatedTimestamp: now,
            };
            onMessageBroadcastRef.current(partialMsg);
        }
    }, [
        throttledSetStreamingText,
        getState,
        setInteractionData,
        streamingTextRef,
        streamingCharacterRef,
        streamingMessageIdRef,
        abortControllerRef,
        resumeGenerationRef,
        onMessageBroadcastRef,
    ]);

    return {
        throttledSetStreamingTextWithBroadcast,
        isSpeculatingRef,
        lastTokenTimestampRef,
    };
}