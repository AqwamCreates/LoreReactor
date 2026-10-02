// src/utilities/chatLogic.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage, WhisperMessage, PromptBlock, TextCharacterInjection } from '../types';
import type { OpenAIMessage } from '../services/ProviderCachingStrategy';
import { getKnownDisplayName, deriveDelimiters } from './promptLogic';
import type { EntityImageRef } from './promptLogic';
import { v4 as uuidv4 } from 'uuid';
import { getCharacterImageUrlWithFallBack, getContextImageUrl, getLocationImageUrl, getPromptBlockImageUrl } from '../storages/serverStorage';
import { getEffectiveUseFrontCameraImage, getEffectiveMaximumChatStamina, getEffectiveMaximumActionStamina, initializeClothingWearingStatuses } from './characterLogic';
import { buildPrompt, getParticipantTag } from './promptLogic';
import { getCoLocatedParticipants } from './locationLogic';
import { getModelTemplate } from '../dictionaries/modelTemplates';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { findLatestMessage } from './messageLogic';
import { getGlobalMessageHistory, getLocalMessageHistory } from './timelineLogic';

// ─── Core Functions ────────────────────────────────────────────────

export const getImageBase64 = async (url: string): Promise<string | null> => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error(`Failed to convert image: ${url}`, error);
        return null;
    }
};

function generateInitialCharacterText(character: Character): string {
    const textCharacterInjections = character.textCharacterInjections;
    if (!textCharacterInjections || textCharacterInjections.length === 0) return '';

    const injectionMap = new Map<string, TextCharacterInjection>();
    for (const inj of textCharacterInjections) {
        injectionMap.set(inj.id, inj);
    }

    const startPool: { inj: TextCharacterInjection; weight: number }[] = [];
    let totalStartWeight = 0;
    for (const inj of textCharacterInjections) {
        const w = inj.textCharacterInjectionWeight ?? 1;
        if (w > 0) {
            startPool.push({ inj, weight: w });
            totalStartWeight += w;
        }
    }
    if (startPool.length === 0 || totalStartWeight <= 0) return '';

    let result = '';
    let currentInj: TextCharacterInjection | undefined;

    let roll = Math.random() * totalStartWeight;
    for (const entry of startPool) {
        roll -= entry.weight;
        if (roll <= 0) { currentInj = entry.inj; break; }
    }
    if (!currentInj) currentInj = startPool[startPool.length - 1].inj;

    while (currentInj) {
        const skipProb = currentInj.textCharacterSkipProbability ?? 0;
        const isSkipped = skipProb > 0 && Math.random() < skipProb;

        if (!isSkipped) {
            const textPool: { text: string; weight: number }[] = [];
            let totalTextWeight = 0;
            for (let i = 0; i < currentInj.textCharacters.length; i++) {
                const w = currentInj.textCharacterWeights[i] ?? 0;
                if (w > 0) {
                    textPool.push({ text: currentInj.textCharacters[i], weight: w });
                    totalTextWeight += w;
                }
            }

            if (textPool.length > 0 && totalTextWeight > 0) {
                let textRoll = Math.random() * totalTextWeight;
                let pickedText = '';
                for (const entry of textPool) {
                    textRoll -= entry.weight;
                    if (textRoll <= 0) { pickedText = entry.text; break; }
                }
                if (!pickedText) pickedText = textPool[textPool.length - 1].text;
                result += pickedText;
            }
        }

        const breakProb = currentInj.textCharacterBreakProbability ?? 0;
        if (breakProb > 0 && Math.random() < breakProb) break;

        const bindings = currentInj.textCharacterInjectionBindings;
        if (!bindings || bindings.length === 0) break;

        const nextPool: { inj: TextCharacterInjection; weight: number }[] = [];
        let totalNextWeight = 0;
        for (const bindId of bindings) {
            const nextInj = injectionMap.get(bindId);
            if (!nextInj) continue;
            const w = nextInj.textCharacterInjectionWeight ?? 1;
            if (w > 0) {
                nextPool.push({ inj: nextInj, weight: w });
                totalNextWeight += w;
            }
        }

        if (nextPool.length === 0 || totalNextWeight <= 0) break;

        let nextRoll = Math.random() * totalNextWeight;
        let nextInj: TextCharacterInjection | undefined;
        for (const entry of nextPool) {
            nextRoll -= entry.weight;
            if (nextRoll <= 0) { nextInj = entry.inj; break; }
        }
        if (!nextInj) nextInj = nextPool[nextPool.length - 1].inj;

        currentInj = nextInj;
    }

    return result;
}

export async function buildChatRequestBody(
    interactionData: InteractionData,
    character: Character,
    knownCharacterNames: Record<string, Record<string, boolean>>,
    existingCharacterText: string,
    allPromptBlocks: PromptBlock[],
    modelId: string,
): Promise<{ body: Record<string, unknown>; knownCharacterNames: Record<string, Record<string, boolean>>; fetchErrors: string[]; characterClothingWearingStatuses: Record<string, boolean> }> {

    const profile = interactionData.profile;

    const { messages, stops, contextImages, locationImages, promptBlockImages, characterClothingWearingStatuses, fetchErrors } = await buildPrompt(interactionData, character, knownCharacterNames, existingCharacterText, allPromptBlocks, modelId);

    const sampler = character.sampler;
    const forceNoCharacterImageInjection = profile?.forceNoCharacterImageInjection;

    const filesBase64: { data: string; id: number }[] = [];
    let imageIdCounter = 1;
    const imageInjectionMessages: OpenAIMessage[] = [];

    const activeModel = getLanguageModelEngine().getContext();
    const effectiveChatTemplateKey = activeModel?.chatTemplate;
    const resolvedChatTemplate = effectiveChatTemplateKey ? getModelTemplate(effectiveChatTemplateKey) : undefined;
    const delimiters = deriveDelimiters(resolvedChatTemplate);

    if (!forceNoCharacterImageInjection) {
        if (!character.doNotInjectCharacterImage) {
            const characterMessage = findLatestMessage(interactionData, character);
            const characterExpression = characterMessage?.message.characterExpression;
            const characterImagePath = await getCharacterImageUrlWithFallBack(character.id, characterExpression);

            if (characterImagePath) {
                const characterImageBase64 = await getImageBase64(characterImagePath);
                if (characterImageBase64) {
                    const rawData = characterImageBase64.includes(',') ? characterImageBase64.split(',')[1] : characterImageBase64;
                    filesBase64.push({ data: rawData, id: imageIdCounter++ });
                    imageInjectionMessages.push({
                        role: 'system',
                        content: `${delimiters.blockStart('system')}I understand that the image ${imageIdCounter} is my appearance. This visual reference applies only to my body description. All formatting rules, dialogue structure, and response style remain governed by the prompts below.${delimiters.blockEnd}`,
                    });
                }
            }
        }

        const colocatedParticipants = getCoLocatedParticipants(interactionData, character);
        const protagonistIds = new Set(interactionData.protagonists?.map(p => p.id) ?? []);
        const effectiveUseFrontCameraImage = getEffectiveUseFrontCameraImage(character, profile);

        for (const participant of colocatedParticipants) {
            if (participant.id === character.id) continue;
            if (participant.doNotInjectCharacterImage) continue;

            const participantMessage = findLatestMessage(interactionData, participant);
            const participantExpression = participantMessage?.message.characterExpression;
            let participantImageBase64: string | null = null;

            const chatMsg = participantMessage?.message as ChatMessage | null;
            if (protagonistIds.has(participant.id) && effectiveUseFrontCameraImage && chatMsg?.frontCameraImage) {
                participantImageBase64 = chatMsg.frontCameraImage;
            } else {
                const participantImagePath = await getCharacterImageUrlWithFallBack(participant.id, participantExpression);
                if (participantImagePath) {
                    participantImageBase64 = await getImageBase64(participantImagePath);
                }
            }

            if (!participantImageBase64) continue;

            const rawData = participantImageBase64.includes(',') ? participantImageBase64.split(',')[1] : participantImageBase64;
            const participantTag = getParticipantTag(participant, interactionData.participants);
            const knownName = getKnownDisplayName(participant, knownCharacterNames);
            const participantString = knownName ? `${participantTag} (${knownName})` : participantTag;

            filesBase64.push({ data: rawData, id: imageIdCounter++ });
            imageInjectionMessages.push({
                role: 'system',
                content: `${delimiters.blockStart('system')}I understand that the image ${imageIdCounter} is the appearance of ${participantString}.${delimiters.blockEnd}`,
            });
        }

        for (const participant of colocatedParticipants) {
            if (!protagonistIds.has(participant.id)) continue;
            const lastMsg = findLatestMessage(interactionData, participant)?.message;
            if (!lastMsg || lastMsg.messageType !== 'chat') continue;
            const lastChatMsg = lastMsg as ChatMessage;
            if (lastChatMsg.files?.length) {
                for (const fileBase64 of lastChatMsg.files) {
                    const rawData = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
                    filesBase64.push({ data: rawData, id: imageIdCounter++ });
                }
            }
        }
    }

    if (!profile?.forceNoContextImageInjection && contextImages.length > 0) {
        const contextImagePromises = contextImages.map(async (imgRef: EntityImageRef) => {
            try {
                const imageUrl = getContextImageUrl(imgRef.entityId, imgRef.filename);
                if (!imageUrl) return null;
                const response = await fetch(imageUrl);
                if (!response.ok) return null;
                const blob = await response.blob();
                const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                });
                const rawData = base64.includes(',') ? base64.split(',')[1] : base64;
                return { data: rawData, id: imageIdCounter++ };
            } catch { return null; }
        });
        const resolvedContextImages = (await Promise.all(contextImagePromises)).filter(img => img !== null);
        filesBase64.push(...resolvedContextImages);
    }

    if (!profile?.forceNoContextImageInjection && locationImages.length > 0) {
        const locationImagePromises = locationImages.map(async (imgRef: EntityImageRef) => {
            try {
                const imageUrl = getLocationImageUrl(imgRef.entityId, imgRef.filename);
                if (!imageUrl) return null;
                const response = await fetch(imageUrl);
                if (!response.ok) return null;
                const blob = await response.blob();
                const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                });
                const rawData = base64.includes(',') ? base64.split(',')[1] : base64;
                return { data: rawData, id: imageIdCounter++ };
            } catch { return null; }
        });
        const resolvedLocationImages = (await Promise.all(locationImagePromises)).filter(img => img !== null);
        filesBase64.push(...resolvedLocationImages);
    }

    if (!profile?.forceNoContextImageInjection && promptBlockImages.length > 0) {
        const promptBlockImagePromises = promptBlockImages.map(async (imgRef: EntityImageRef) => {
            try {
                const imageUrl = getPromptBlockImageUrl(imgRef.entityId, imgRef.filename);
                if (!imageUrl) return null;
                const response = await fetch(imageUrl);
                if (!response.ok) return null;
                const blob = await response.blob();
                const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                });
                const rawData = base64.includes(',') ? base64.split(',')[1] : base64;
                return { data: rawData, id: imageIdCounter++ };
            } catch { return null; }
        });
        const resolvedPromptBlockImages = (await Promise.all(promptBlockImagePromises)).filter(img => img !== null);
        filesBase64.push(...resolvedPromptBlockImages);
    }

    const finalMessages: OpenAIMessage[] = [...imageInjectionMessages, ...messages];
    const { stop: paramStops, ...otherParams } = sampler?.parameters || {};

    const finalStops = [...(Array.isArray(paramStops) ? paramStops : []), ...stops];
    const uniqueStops = Array.from(new Set(finalStops)).filter(s => typeof s === 'string' && s.trim().length > 0);

    const body: Record<string, unknown> = {
        ...otherParams,
        messages: finalMessages,
        n_predict: sampler?.maximumNumberOfTokens ?? 512,
        stream: true,
        stop: uniqueStops,
    };

    if (profile?.randomizeTextCharacterInjection) {
        const maxRetries = profile.maximumNumberOfTextCharacterRandomizationPerModel ?? 1;
        const injections: string[] = [];
        for (let i = 0; i < maxRetries; i++) {
            injections.push(generateInitialCharacterText(character));
        }

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

    if (filesBase64.length > 0) body.image_data = filesBase64;
    body.session_id = interactionData.id;

    return { body, knownCharacterNames, fetchErrors, characterClothingWearingStatuses };
}

export function convertIdsToDisplayNames(text: string, interactionData: InteractionData, character: Character): string {
    const profile = interactionData.profile;
    const stripThinkTokens = profile?.stripThinkTokens ?? false;

    let result = text;

    if (stripThinkTokens) {
        result = result.replace(/[\s\S]*?<\/think>/g, '');
        result = result.replace(/<\|channel>[\s\S]*?<channel\|>/g, '');
        result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
    }

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
        name: "Untitled Chat",
        protagonists: [character],
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

export function createChatMessage(
    interactionData: InteractionData,
    character: Character,
    textContent: string,
    options?: { files?: string[]; frontCameraImage?: string; knownCharacterNames?: Record<string, Record<string, boolean>>; clothingWearingStatuses?: Record<string, boolean> }
): ChatMessage {
    const latest = findLatestMessage(interactionData, character);
    const previousMessage = latest?.message;
    
    const effectiveMaximumChatStamina = getEffectiveMaximumChatStamina(character, interactionData.profile);
    const effectiveMaximumActionStamina = getEffectiveMaximumActionStamina(character, interactionData.profile);
    const remainingChatStamina = previousMessage?.remainingChatStamina ?? effectiveMaximumChatStamina;
    const remainingActionStamina = previousMessage?.remainingActionStamina ?? effectiveMaximumActionStamina;
    
    const globalMessages = getGlobalMessageHistory(interactionData);
    const lastMessageId = globalMessages.length > 0 ? globalMessages[globalMessages.length - 1].id : null;
    const now = Date.now();

    const id = uuidv4();
    const files = options?.files ?? [];
    const frontCameraImage = options?.frontCameraImage;

    const knownCharacterNames = options?.knownCharacterNames ??
        (character.knownCharacterNames
            ? Object.fromEntries(
                Object.entries(character.knownCharacterNames).map(([charId, names]) =>
                    [charId, Object.fromEntries(names.map(n => [n, true] as const))]
                )
            )
            : {});
    const prevClothingStatuses = (previousMessage as ChatMessage)?.characterClothingWearingStatuses;
    const clothingWearingStatuses = options?.clothingWearingStatuses ?? prevClothingStatuses ?? initializeClothingWearingStatuses(character);
    const prevLockedLocations = previousMessage?.characterLockedLocations ?? {};

    return {
        id,
        messageType: 'chat',
        character: { ...character },
        textContent,
        isPresent: true,
        files,
        frontCameraImage,
        remainingChatStamina,
        remainingActionStamina,
        knownCharacterNames,
        characterClothingWearingStatuses: clothingWearingStatuses,
        characterLockedLocations: { ...prevLockedLocations },
        modelTextContentSummaries: {},
        modelInteractionTextContentSummaries: {},
        kvCacheTextContentPaths: {},
        kvCacheTextContentSummaryPaths: {},
        kvCacheInteractionTextContentSummaries: {},
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentMessageId: lastMessageId,
    } as ChatMessage;
}

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
                } as ChatMessage | WhisperMessage;
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
                    return { ...m, kvCacheTextContentPaths: {}, kvCacheTextContentSummaryPaths: {}, kvCacheInteractionTextContentSummaries: {} } as ChatMessage | WhisperMessage;
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
    characterId: string,
    newText: string,
    characterExpression?: string,
): InteractionData {
    const newHistories = { ...interactionData.interactionHistories };
    
    const latest = findLatestMessage(interactionData, { id: characterId } as Character);
    if (!latest) return interactionData;

    const { message, locationId } = latest;
    if (message.messageType !== 'chat') return interactionData;

    const locMessages = newHistories[locationId];
    const index = locMessages.findIndex((m: HistoryMessage) => m.id === message.id);
    if (index !== -1) {
        newHistories[locationId] = [...locMessages];
        newHistories[locationId][index] = { 
            ...message, 
            textContent: newText, 
            characterExpression: characterExpression ?? (message as ChatMessage).characterExpression, 
            lastUpdatedTimestamp: Date.now() 
        } as ChatMessage;
    }

    return { ...interactionData, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
}