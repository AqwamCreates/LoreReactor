// src/services/ChatMessageSummarizationEngine.ts

import type { Context } from "react";
import type { LanguageModelContext } from "../../infrastructure";
import { LanguageModelEngine } from "../../infrastructure/models/languageModelEngine";
import { contextStartString, contextEndString, commonThinkStartString, commonThinkEndString, gemmaThinkStartString, gemmaThinkEndString } from "../../stringList";
import type { ChatMessage, ChatData, Character } from "../../types";
import { getParticipantTag, replacePlaceholders, getRevealIndexByCharacterId, createChatHistoryPrompt } from "./chatService";


const engine = new LanguageModelEngine();

const startOfMemoryLine = `${contextStartString}The Start Of My Memory${contextEndString}`;
const endOfMemoryLine = `${contextStartString}The End Of My Memory${contextEndString}`;

const SUMMARIZE_SYSTEM_PROMPT = "You are a concise summarizer for roleplay chat messages. Given a single chat message, produce a brief summary that preserves: character actions, key dialogue points, emotional tone, and plot-relevant details. Output ONLY the summary text with no preamble, no markdown, no quotes.";

const COMPRESS_CHUNK_PROMPT = "You are a narrative compressor for roleplay chat history. Given a chunk of conversation messages, produce a single dense paragraph that preserves: character names, key actions, dialogue substance, emotional beats, and plot progression. Write in past tense, third person. Output ONLY the compressed paragraph with no preamble, no markdown, no quotes.";

const RECURSIVE_MERGE_PROMPT = "You are a narrative merger for roleplay chat history. Given multiple summary paragraphs from consecutive conversation segments, merge them into a single coherent paragraph that preserves the chronological flow, character arcs, and plot progression. Eliminate redundancy. Write in past tense, third person. Output ONLY the merged paragraph with no preamble, no markdown, no quotes.";

/**
 * Generates a summary for a single chat message using the LLM.
 */
export async function generateMessageSummary(
    message: ChatMessage,
    languageModelContext: LanguageModelContext,
    maxTokens = 256
): Promise<string | null> {
    const prompt = `${SUMMARIZE_SYSTEM_PROMPT}\n\nMessage from ${message.character.name}:\n${message.textContent}\n\nSummary:`;
    const requestBody: any = {
        prompt,
        n_predict: maxTokens,
        temperature: 1,
        stop: ['\n\n', '\nMessage from'],
    };
    const result = await engine.generateCompletion(requestBody, languageModelContext);
    return result.text || null;
}

/**
 * Generates summaries for all messages outside the sliding window
 * that don't already have a summary.
 */
export async function generateMissingSummaries(
    chatData: ChatData,
    windowSize: number,
    languageModelContext: LanguageModelContext,
    maxTokens = 256
): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const history = chatData.chatMessageHistory;
    const cutoff = Math.max(0, history.length - windowSize);
    const toSummarize = history.slice(0, cutoff).filter(m => !m.textContentSummary);
    if (toSummarize.length === 0) return results;
    for (const msg of toSummarize) {
        const summary = await generateMessageSummary(msg, languageModelContext, maxTokens);
        if (summary) {
            results.set(msg.id, summary);
        }
    }
    return results;
}

/**
 * Compresses a chunk of messages into a single narrative paragraph.
 */
async function compressChunk(
    messages: ChatMessage[],
    languageModelContext: LanguageModelContext,
    maxTokens = 512
): Promise<string | null> {
    const formattedMessages = messages.map(m =>
        `${m.character.name}: ${m.textContent}`
    ).join('\n\n');
    const prompt = `${COMPRESS_CHUNK_PROMPT}\n\nConversation chunk:\n${formattedMessages}\n\nCompressed paragraph:`;
    const requestBody: any = {
        prompt,
        n_predict: maxTokens,
        temperature: 1,
        stop: ['\n\n\n'],
    };
    const result = await engine.generateCompletion(requestBody, languageModelContext);
    return result.text || null;
}

/**
 * Creates a character-specific memory entry.
 * Uses participant tags for identity safety and injects system/think prompts for personality.
 */
export async function makeCharacterMemory(
    chatData: ChatData, 
    character: Character,
    languageModelContext: LanguageModelContext, 
    maxTokens = 512
): Promise<Context | null> {
    const history = chatData.chatMessageHistory;
    if (history.length === 0) return null;

    const participants = chatData.participants;
    const participantTag = getParticipantTag(character, participants);
    const protagonistTag = getParticipantTag(chatData.protagonist, participants);
    const systemPrompt = character.systemPrompt ? `${contextStartString}System Prompt: ${replacePlaceholders(character.systemPrompt, participantTag, character.name, protagonistTag, chatData.protagonist?.name || null)}${contextEndString}` : '';
    const thinkPrompt = character.thinkPrompt ? `${contextStartString}Think Prompt: ${replacePlaceholders(character.thinkPrompt, participantTag, character.name, protagonistTag, chatData.protagonist?.name || null)}${contextEndString}` : '';

    const revealIndexByCharacterId = getRevealIndexByCharacterId(chatData);

    const {chatHistoryPrompt} = createChatHistoryPrompt(chatData, character, revealIndexByCharacterId);

    const perspectiveInstruction = `${contextStartString}I am ${participantTag}. I am reflecting on what I have experienced. I will express my memory as natural, personal thoughts that others will not hear, read or respond to. I will use this memory in the future. Only I can access this memory. I will never use 'Character #' or 'Character # (Name)' unless I require it.${contextEndString}`;

    const memoryInjection = `${contextStartString}`;

    const promptLines = [systemPrompt, thinkPrompt, startOfMemoryLine, chatHistoryPrompt, endOfMemoryLine, perspectiveInstruction, memoryInjection];

    const prompt = promptLines.join('\n\n');
    
    const requestBody: any = {
        prompt,
        n_predict: maxTokens,
        temperature: 1,
        stop: [contextStartString, contextEndString, commonThinkStartString, commonThinkEndString, gemmaThinkStartString, gemmaThinkEndString],
    };

    const result = await engine.generateCompletion(requestBody, languageModelContext);
    if (!result.text) return null;

    const now = Date.now();
    return {
        id: `memory-${character.id}-${uuidv4()}`,
        name: `[Memory] ${character.name}'s Perspective`,
        description: `Character-specific memory for ID: ${character.id}`,
        text: result.text.trim(),
        isAutoGenerated: true,
        useBase64Encoding: false,
        insertionDepth: 0,
        tokenBudget: maxTokens,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    } as Context;
}

/**
 * Periodic Compression: finds chunks of messages that haven't been
 * compressed yet and produces auto-generated Context entries.
 */
export async function generatePeriodicCompression(
    chatData: ChatData,
    compressionInterval: number,
    compressionChunkSize: number,
    languageModelContext: LanguageModelContext,
    maxTokens: number = 512
): Promise<Context[]> {
    const history = chatData.chatMessageHistory;
    const existingContexts = chatData.contexts || [];
    const compressedRanges = new Set<string>();
    for (const ctx of existingContexts) {
        if (ctx.isAutoGenerated && ctx.description) {
            const match = ctx.description.match(/msgs:(\d+)-(\d+)/);
            if (match) {
                compressedRanges.add(`${match[1]}-${match[2]}`);
            }
        }
    }
    const newContexts: Context[] = [];
    const now = Date.now();
    const compressibleEnd = Math.max(0, history.length - compressionInterval);
    for (let startIdx = 0; startIdx < compressibleEnd; startIdx += compressionChunkSize) {
        const endIdx = Math.min(startIdx + compressionChunkSize, compressibleEnd);
        const rangeKey = `${startIdx}-${endIdx}`;
        if (compressedRanges.has(rangeKey)) continue;
        const chunk = history.slice(startIdx, endIdx);
        if (chunk.length === 0) continue;
        const compressed = await compressChunk(chunk, languageModelContext, maxTokens);
        if (!compressed) continue;
        newContexts.push({
            id: `auto-summary-${uuidv4()}`,
            name: `[Auto-Summary] Messages ${startIdx + 1}–${endIdx}`,
            description: `msgs:${startIdx}-${endIdx}`,
            text: compressed,
            isAutoGenerated: true,
            useBase64Encoding: false,
            insertionDepth: 0,
            tokenBudget: maxTokens,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        } as Context);
    }
    return newContexts;
}

/**
 * Merges multiple summary paragraphs into one coherent paragraph.
 */
async function mergeSummaries(
    summaries: string[],
    languageModelContext: LanguageModelContext,
    maxTokens = 512
): Promise<string | null> {
    if (summaries.length === 0) return null;
    if (summaries.length === 1) return summaries[0];
    const formatted = summaries.map((s, i) => `Segment ${i + 1}: ${s}`).join('\n\n');
    const prompt = `${RECURSIVE_MERGE_PROMPT}\n\nSegments to merge:\n${formatted}\n\nMerged paragraph:`;
    const requestBody: any = {
        prompt,
        n_predict: maxTokens,
        temperature: 1,
        stop: ['\n\n\n'],
    };
    const result = await engine.generateCompletion(requestBody, languageModelContext);
    return result.text || null;
}

/**
 * Recursive Summary: builds hierarchical summaries across multiple layers.
 */
export async function generateRecursiveSummary(
    chatData: ChatData,
    chunkSize: number,
    maxDepth: number,
    languageModelContext: LanguageModelContext,
    maxTokens = 1024
): Promise<Context[]> {
    const history = chatData.chatMessageHistory;
    const existingContexts = chatData.contexts || [];
    const now = Date.now();

    const fullRangeKey = `recursive-global:0-${history.length}`;
    for (const ctx of existingContexts) {
        if (ctx.isAutoGenerated && ctx.description === fullRangeKey) return [];
    }

    const newContexts: Context[] = [];

    const layer0Summaries: string[] = [];
    for (let startIdx = 0; startIdx < history.length; startIdx += chunkSize) {
        const endIdx = Math.min(startIdx + chunkSize, history.length);
        const chunk = history.slice(startIdx, endIdx);
        if (chunk.length === 0) continue;
        const compressed = await compressChunk(chunk, languageModelContext, maxTokens);
        if (!compressed) continue;
        layer0Summaries.push(compressed);
        newContexts.push({
            id: `auto-recursive-l0-${uuidv4()}`,
            name: `[Recursive L0] Messages ${startIdx + 1}–${endIdx}`,
            description: `recursive-l0:${startIdx}-${endIdx}`,
            text: compressed,
            isAutoGenerated: true,
            useBase64Encoding: false,
            insertionDepth: 2,
            tokenBudget: maxTokens,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        } as Context);
    }

    if (layer0Summaries.length === 0) return newContexts;

    let currentLayerSummaries = layer0Summaries;
    let currentLayerIndex = 0;

    while (currentLayerIndex < maxDepth && currentLayerSummaries.length > 1) {
        currentLayerIndex++;
        const nextLayerSummaries: string[] = [];
        for (let i = 0; i < currentLayerSummaries.length; i += 2) {
            const batch = currentLayerSummaries.slice(i, Math.min(i + 2, currentLayerSummaries.length));
            const merged = await mergeSummaries(batch, languageModelContext, maxTokens);
            if (merged) {
                nextLayerSummaries.push(merged);
                newContexts.push({
                    id: `auto-recursive-l${currentLayerIndex}-${uuidv4()}`,
                    name: `[Recursive L${currentLayerIndex}] Merged segment ${Math.floor(i / 2) + 1}`,
                    description: `recursive-l${currentLayerIndex}:segment-${Math.floor(i / 2)}`,
                    text: merged,
                    isAutoGenerated: true,
                    useBase64Encoding: false,
                    insertionDepth: 2 + currentLayerIndex,
                    tokenBudget: maxTokens,
                    firstCreatedTimestamp: now,
                    lastUpdatedTimestamp: now,
                } as Context);
            }
        }
        currentLayerSummaries = nextLayerSummaries;
    }

    if (currentLayerSummaries.length > 1) {
        const globalSummary = await mergeSummaries(currentLayerSummaries, languageModelContext, maxTokens);
        if (globalSummary) {
            newContexts.push({
                id: `auto-recursive-global-${uuidv4()}`,
                name: "[Recursive Global] Full conversation summary",
                description: fullRangeKey,
                text: globalSummary,
                isAutoGenerated: true,
                useBase64Encoding: false,
                insertionDepth: 0,
                tokenBudget: maxTokens,
                firstCreatedTimestamp: now,
                lastUpdatedTimestamp: now,
            } as Context);
        }
    } else if (currentLayerSummaries.length === 1 && currentLayerIndex > 0) {
        newContexts.push({
            id: `auto-recursive-global-${uuidv4()}`,
            name: "[Recursive Global] Full conversation summary",
            description: fullRangeKey,
            text: currentLayerSummaries[0],
            isAutoGenerated: true,
            useBase64Encoding: false,
            insertionDepth: 0,
            tokenBudget: maxTokens,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        } as Context);
    }

    return newContexts;
}

/**
 * Checks whether any summarization step should trigger based on token count.
 */
export function checkTriggerThreshold(
    chatData: ChatData,
    currentnumberOfTokens: number,
    languageModelContextLength: number
): {
    strategyType: string;
    slidingWindowSize?: number;
    compressionInterval?: number;
    compressionChunkSize?: number;
    recursiveChunkSize?: number;
    recursiveMaxDepth?: number;
} | null {
    const profile = chatData.Profile;
    if (!profile?.summarizationSteps) return null;

    const activeSteps = [...profile.summarizationSteps]
        .sort((a, b) => a.order - b.order);

    for (const step of activeSteps) {
        const threshold = step.triggerTokenThreshold ?? 0;
        const effectiveThreshold = threshold > 0
            ? threshold
            : Math.floor(languageModelContextLength * 0.7);

        if (currentnumberOfTokens >= effectiveThreshold) {
            if (step.strategyType === 'Sliding Window Replace') {
                return {
                    strategyType: step.strategyType,
                    slidingWindowSize: step.slidingWindowSize,
                };
            }
            if (step.strategyType === 'Periodic Compression') {
                return {
                    strategyType: step.strategyType,
                    compressionInterval: step.compressionInterval,
                    compressionChunkSize: step.compressionChunkSize,
                };
            }
            if (step.strategyType === 'Recursive Summary') {
                return {
                    strategyType: step.strategyType,
                    recursiveChunkSize: step.recursiveChunkSize,
                    recursiveMaxDepth: step.recursiveMaxDepth,
                };
            }
        }
    }
    return null;
}