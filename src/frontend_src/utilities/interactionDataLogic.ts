// src/frontend_src/utilities/interactionDataLogic.ts
import type { 
    Character, InteractionData, HistoryMessage, ChatMessage, PromptBlock, 
    TextMessage, RawInteractionData,
} from '../types';
import type { OpenAIMessage } from '../services/ProviderCacheStrategy';
import { v4 as uuidv4 } from 'uuid';
import { generateInitialCharacterText } from './characterLogic';
import { buildPrompt } from './promptLogic';
import { findLatestMessage, getMessageById } from './messageLogic';
import { getGlobalMessageHistory, getLocalMessageHistory } from './timelineLogic';
import { toolCallStartString, toolCallEndString } from '../dictionaries/stringList';

// ─── Core Functions ────────────────────────────────────────────────

export async function buildRequestBody(
    interactionData: InteractionData,
    character: Character,
    knownCharacterNames: Record<string, Record<string, boolean>>,
    existingCharacterText: string,
    allPromptBlocks: PromptBlock[],
    modelId: string,
    isToolMessage: boolean,
    allRawInteractionDataShells: RawInteractionData[],
): Promise<{ 
    body: Record<string, unknown>; 
    knownCharacterNames: Record<string, Record<string, boolean>>; 
    fetchErrors: string[]; 
    characterClothingWearingStatuses: Record<string, boolean> 
}> {
    const profile = interactionData.profile;

    const { 
        messages, 
        stops, 
        imagePayloads, 
        characterClothingWearingStatuses, 
        fetchErrors 
    } = await buildPrompt(interactionData, character, knownCharacterNames, existingCharacterText, allPromptBlocks, modelId, isToolMessage, allRawInteractionDataShells);

    const languageModelSampler = character.languageModelSampler;

    const finalMessages: OpenAIMessage[] = messages;
    const { stop: paramStops, ...otherParams } = languageModelSampler?.parameters || {};

    const finalStops = [...(Array.isArray(paramStops) ? paramStops : []), ...stops];
    const uniqueStops = Array.from(new Set(finalStops)).filter(s => typeof s === 'string' && s.length > 0);

    const body: Record<string, unknown> = {
        ...otherParams,
        messages: finalMessages,
        n_predict: languageModelSampler?.maximumNumberOfTokens ?? 512,
        stream: true,
        stop: uniqueStops,
    };

    if (profile?.randomizeTextCharacterInjection) {
        const maxRetries = profile.maximumNumberOfTextCharacterRandomizationPerModel ?? 1;
        const injections: string[] = [];
        for (let i = 0; i < maxRetries; i++) injections.push(generateInitialCharacterText(character));
        body._baseMessages = finalMessages.map(m => ({ ...m }));

        if (!profile.randomizeTextCharacterInjectionOnRetry && injections.length > 0) {
            const firstInjection = injections.shift();
            if (firstInjection !== undefined && finalMessages.length > 0) {
                finalMessages[0] = {
                    ...finalMessages[0],
                    content: firstInjection + (typeof finalMessages[0].content === 'string' ? finalMessages[0].content : ''),
                };
                body.messages = finalMessages;
            }
        }

        if (injections.length > 0) {
            body._injectionStrings = injections;
        }
    }

    if (imagePayloads && imagePayloads.length > 0) {
        body.image_data = imagePayloads;
    }
    body.session_id = interactionData.id;

    return { body, knownCharacterNames, fetchErrors, characterClothingWearingStatuses };
}

export function convertIdsToDisplayNames(text: string, interactionData: InteractionData, character: Character): string {

    let result = text;

    result = result.replace(/<memory>\}/g, '');
    result = result.replace(/<memory>[\s\S]*?\}/g, '');

    const localHistory = getLocalMessageHistory(interactionData, character);
    
    interactionData.participants.forEach((p, i) => {
        const tag = `Character ${i + 1}`;
        let knownName: string | null = null;
        
        for (let mi = localHistory.length - 1; mi >= 0; mi--) {
            const msg = localHistory[mi];
            if (msg.knownCharacterNames) {
                const candidates = [p.name, ...(p.aliases ?? [])];
                for (const candidate of candidates) {
                    if (msg.knownCharacterNames[p.id]?.[candidate]) {
                        knownName = candidate;
                        break;
                    }
                }
            }
            if (knownName) break;
        }
        if (knownName) {
            result = result.replace(new RegExp(`\\b${tag}\\b`, 'g'), `${tag} (${knownName})`);
        }
    });
    return result;
}

export function createNewInteractionData(character: Character): InteractionData {
    const now = Date.now();
    return {
        id: uuidv4(),
        name: "Untitled Session",
        protagonistIds: [character.id],
        participants: [character],
        contexts: [],
        locations: [],
        audioTracks: [],
        interactionHistories: {},
        numberOfMessages: 0,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentInteractionDataId: null,
        parentMessageId: null,
        profile: undefined,
    };
}

// ─── Interaction Data Mutations ────────────────────────────────────

export function addMessageToInteractionData(
    interactionData: InteractionData, 
    newInteractionMessage: HistoryMessage,
    locationId?: string
): InteractionData {
    const targetLocationId = locationId || 'global';
    const newHistories = { ...interactionData.interactionHistories };
    if (!newHistories[targetLocationId]) {
        newHistories[targetLocationId] = [];
    }
    newHistories[targetLocationId] = [...newHistories[targetLocationId], newInteractionMessage];
    
    const totalMessages = Object.values(newHistories).reduce((acc, curr) => acc + curr.length, 0);
    
    return {
        ...interactionData,
        interactionHistories: newHistories,
        numberOfMessages: totalMessages,
        lastUpdatedTimestamp: Date.now()
    };
}

export function editInteractionMessageInInteractionData(interactionData: InteractionData, messageId: string, newText: string): InteractionData {
    const newHistories = { ...interactionData.interactionHistories };
    let found = false;
    
    for (const [locId, messages] of Object.entries(newHistories)) {
        const index = messages.findIndex((m: HistoryMessage) => m.id === messageId);
        if (index !== -1) {
            newHistories[locId] = [...messages];
            const targetMsg = newHistories[locId][index];
            
            if (targetMsg.messageType === 'chat' || targetMsg.messageType === 'whisper') {
                newHistories[locId][index] = { 
                    ...targetMsg, 
                    textContent: newText, 
                    kvCacheTextContentPaths: {}, 
                    kvCacheTextContentSummaryPaths: {}, 
                    kvCacheInteractionTextContentSummaries: {} 
                } as TextMessage;
            }
            found = true;
            break;
        }
    }
    
    if (!found) return interactionData;

    const allMessages = getGlobalMessageHistory({ ...interactionData, interactionHistories: newHistories });
    const msgIndex = allMessages.findIndex((m: HistoryMessage) => m.id === messageId);
    
    if (msgIndex !== -1) {
        for (const [locId, messages] of Object.entries(newHistories)) {
            newHistories[locId] = messages.map((m: HistoryMessage) => {
                const globalIdx = allMessages.findIndex((am: HistoryMessage) => am.id === m.id);
                if (globalIdx > msgIndex && (m.messageType === 'chat' || m.messageType === 'whisper')) {
                    return { ...m, kvCacheTextContentPaths: {}, kvCacheTextContentSummaryPaths: {}, kvCacheInteractionTextContentSummaries: {} } as TextMessage;
                }
                return m;
            });
        }
    }

    return {
        ...interactionData,
        interactionHistories: newHistories,
        lastUpdatedTimestamp: Date.now()
    };
}

export function updatePartialMessageInInteractionData(
    interactionData: InteractionData,
    character: Character,
    newText: string,
    characterExpression?: string,
    targetMessageId?: string,
): InteractionData {
    // If targetMessageId is provided (e.g. during a resume turn), look up that exact message.
    // Otherwise, find the latest message from the generating character.
    const target = targetMessageId
        ? getMessageById(interactionData, targetMessageId)
        : findLatestMessage(interactionData, character);

    if (!target) return interactionData;

    const { message, locationId } = target;
    if (message.messageType !== 'chat' && message.messageType !== 'whisper') return interactionData;

    const locMessages = interactionData.interactionHistories[locationId];
    if (!locMessages) return interactionData;

    const index = locMessages.findIndex((m: HistoryMessage) => m.id === message.id);
    if (index === -1) return interactionData;

    const updatedLocMessages = [...locMessages];
    updatedLocMessages[index] = { 
        ...message, 
        textContent: newText, 
        characterExpression: characterExpression ?? message.characterExpression, 
        lastUpdatedTimestamp: Date.now() 
    } as ChatMessage;

    return {
        ...interactionData,
        interactionHistories: {
            ...interactionData.interactionHistories,
            [locationId]: updatedLocMessages,
        },
        lastUpdatedTimestamp: Date.now(),
    };
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isToolMessageText(text: string): boolean {
    const trimmed = text;
    const bracketedPattern = new RegExp(`^\\s*${escapeRegExp(toolCallStartString)}\\s*tool\\s*\\(\\s*\\)\\s*${escapeRegExp(toolCallEndString)}`, 'i');
    const plainPattern = /^tool\s*\(\s*\)/i;
    return bracketedPattern.test(trimmed) || plainPattern.test(trimmed);
}