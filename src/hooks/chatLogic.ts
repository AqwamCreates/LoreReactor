// src/services/chatLogic.ts
import { v4 as uuidv4 } from 'uuid';
import type { Character, ChatData, ChatMessage, Context, StopPattern } from '../types';
import { detectName } from './nameDetection';

// Apparently tokens like "{" and "}" (without the quotation marks) works quite well!
// "{" and "}" (without the quotation marks) is basically common in programming languages. Very often, for a code to work, the syntax must be correct. As a result, there is an implicit assumption that the words must be selected to certain rules in roleplay.
// "<" and ">" (without the quotation marks) also works nicely.
// "[" and "]" (without the quotation marks) somewhat works.

// When you combine this pattern "{ : }" (without the quotation marks), it looks like a JSON-file to be processed.

const contextStartString = "{"

const contextEndString = "}"

const turnStartString = "{"

const turnEndString = "}"

const thinkStartString = "<think>"

const thinkEndString = "</think>"

function replacePlaceholders(text: string, characterName: string, protagonistName: string): string {
    if (!text) return text;
    
    let result = text;
    result = result.replace(/\{\{char\}\}/g, characterName);
    result = result.replace(/\{\{user\}\}/g, protagonistName);
    
    return result;
}

export function getParticipantId(character: Character, participants: Character[]): string {
    const index = participants.findIndex(p => p.id === character.id);
    return index !== -1 ? `Character ${index + 1}` : 'Unknown';
}

export function getFatigueContext(currentChatStamina: number, maximumChatStamina: number): string {
    if (maximumChatStamina === Number.POSITIVE_INFINITY) return "";
    const ratio = currentChatStamina / maximumChatStamina;
    if (ratio > 0.7) return "";

    const initialString = `${contextStartString}${thinkStartString} I am`

    if (ratio > 0.5) return `${initialString} starting to feel slightly winded, but still have plenty of energy to speak.${thinkEndString}${contextEndString}`;
    if (ratio > 0.3) return `${initialString} somewhat exhausted from talking, but somewhat have the energy to speak.${thinkEndString}${contextEndString}`;
    if (ratio > 0.1) return `${initialString} quite drained from talking and barely have the energy to speak.${thinkEndString}${contextEndString}`;
    return `${initialString} have no energy left to speak.${contextEndString}`;
}

export function findPreviousChatMessage(chatData: ChatData, characterId: string): ChatMessage | null {
    const chatMessageHistory = chatData.chatMessageHistory;
    for (let i = chatMessageHistory.length - 1; i >= 0; i--) {
        if (chatMessageHistory[i].character.id === characterId) return chatMessageHistory[i];
    }
    return null;
}

function filterArrayBasedOnContext(
    characterIdArray: string[], 
    textContentArray: string[], 
    currentCharacterId: string, 
    contextType: 'global' | 'local' | 'previous'
): { characterIdArray: string[]; textContentArray: string[] } {
    const length = characterIdArray.length;
    if (contextType === "global") return { characterIdArray, textContentArray };
    if (contextType === "previous") {
        if (length === 0) return { characterIdArray: [], textContentArray: [] };
        return { characterIdArray: [characterIdArray[length - 1]], textContentArray: [textContentArray[length - 1]] };
    }
    if (contextType === "local") {
        let targetIndex = -1;
        const endIndex = length - 1;
        for (let i = endIndex; i >= 0; i--) {
            if ((characterIdArray[i] === currentCharacterId) && (i === endIndex)) continue;
            if ((characterIdArray[i] !== currentCharacterId) && (i === endIndex)) { targetIndex = i; break; }
            if ((characterIdArray[i] === currentCharacterId) && (characterIdArray[i + 1] !== currentCharacterId)) { targetIndex = i; break; }
        }
        if (targetIndex === -1) return { characterIdArray: [], textContentArray: [] };
        const startIndex = targetIndex + 1;
        if (startIndex >= length) return { characterIdArray: [], textContentArray: [] };
        return { characterIdArray: characterIdArray.slice(startIndex), textContentArray: textContentArray.slice(startIndex) };
    }
    return { characterIdArray: [], textContentArray: [] };
}

function filterArrayBasedOnTarget(
    characterIdArray: string[], 
    textContentArray: string[], 
    currentCharacterId: string, 
    targetType: 'everyone' | 'listener' | 'self'
): { characterIdArray: string[]; textContentArray: string[] } {
    const length = characterIdArray.length;
    if (length === 0) return { characterIdArray: [], textContentArray: [] };
    if (targetType === "everyone") return { characterIdArray, textContentArray };

    let targetCharacterId: string | undefined = undefined;
    if (targetType === "self") targetCharacterId = currentCharacterId;
    else if (targetType === "listener") {
        for (let i = length - 1; i >= 0; i--) {
            if (characterIdArray[i] !== currentCharacterId) { targetCharacterId = characterIdArray[i]; break; }
        }
    }
    if (!targetCharacterId) return { characterIdArray: [], textContentArray: [] };

    const extractedCharacterIdArray: string[] = [];
    const extractedTextContentArray: string[] = [];
    for (let i = 0; i < length; i++) {
        if (characterIdArray[i] === targetCharacterId) {
            extractedCharacterIdArray.push(characterIdArray[i]);
            extractedTextContentArray.push(textContentArray[i]);
        }
    }
    return { characterIdArray: extractedCharacterIdArray, textContentArray: extractedTextContentArray };
}

interface BuildResult {
    prompt: string;
    activeStopPatterns: StopPattern[];
    activeContextsForImages: Context[];
}

export function buildPromptAndStopPatterns(chatData: ChatData, character: Character): BuildResult {
    const chatMessageHistory = chatData.chatMessageHistory;
    const contexts = chatData.contexts || [];
    const sampler = character.sampler;
    const allStopPatterns = sampler?.stopPatterns || [];
    const currentCharacterId = character.id;
    const characterName = character.name
    const protagonistName = chatData.protagonist.name
    let systemPrompt = character.systemPrompt
    let thinkPrompt = character.thinkPrompt

    const characterIdArray: string[] = [];
    const textContentArray: string[] = [];
    const revealedNamesMap = new Map<string, boolean>();

    for (const msg of chatMessageHistory) {
        characterIdArray.push(msg.character.id);
        textContentArray.push(msg.textContent);
        if (msg.isNameRevealed) revealedNamesMap.set(msg.character.id, true);
    }

    const combinationCache: Record<string, Record<string, { characterIdArray: string[], textContentArray: string[] }>> = {};
    const promptLines: string[] = [];
    const activeStopPatterns: StopPattern[] = [];
    const activeContextsForImages: Context[] = [];

    const getFilteredData = (ctxType: string, tgtType: string) => {
        if (!combinationCache[ctxType]) combinationCache[ctxType] = {};
        if (!combinationCache[ctxType][tgtType]) {
            const step1 = filterArrayBasedOnContext(characterIdArray, textContentArray, currentCharacterId, ctxType as any);
            const step2 = filterArrayBasedOnTarget(step1.characterIdArray, step1.textContentArray, currentCharacterId, tgtType as any);
            combinationCache[ctxType][tgtType] = step2;
        }
        return combinationCache[ctxType][tgtType];
    };

    for (const context of contexts) {
        const ctxType = context.regularExpressionContext || 'global';
        const tgtType = context.regularExpressionTarget || 'everyone';
        const regexTrigger = context.regularExpressionTrigger;
        const { textContentArray: filteredTexts } = getFilteredData(ctxType, tgtType);

        if (filteredTexts.length === 0 && !regexTrigger) {
            if (ctxType !== 'global' || tgtType !== 'everyone') continue;
        }

        const searchSpace = filteredTexts.join('\n');
        let shouldInject = false;
        if (!regexTrigger) shouldInject = true;
        else {
            try {
                const regex = new RegExp(regexTrigger);
                if (regex.test(searchSpace)) shouldInject = true;
            } catch (e) {
                console.warn(`Invalid regex in context ${context.name}`, e);
                shouldInject = true;
            }
        }

        let contextText = context.text

        if (shouldInject) {

            if (contextText) {

                contextText = replacePlaceholders(contextText, characterName, protagonistName)

                promptLines.push(`${contextStartString}${contextText}${contextEndString}`);

            }

            if (context.images && context.images.length > 0 && context.useBase64Encoding) activeContextsForImages.push(context);
        }
    }

    for (const stopPattern of allStopPatterns) {
        const ctxType = stopPattern.regularExpressionContext || 'global';
        const tgtType = stopPattern.regularExpressionTarget || 'everyone';
        const regexTrigger = stopPattern.regularExpressionTrigger;
        const { textContentArray: filteredTexts } = getFilteredData(ctxType, tgtType);

        if (!regexTrigger) { activeStopPatterns.push(stopPattern); continue; }
        if (filteredTexts.length === 0) continue;

        const searchSpace = filteredTexts.join('\n');
        try {
            const regex = new RegExp(regexTrigger);
            if (regex.test(searchSpace)) activeStopPatterns.push(stopPattern);
        } catch (e) {
            console.warn(`Invalid regex in stop pattern ${stopPattern.name}`, e);
            activeStopPatterns.push(stopPattern);
        }
    }

    const participantId = getParticipantId(character, chatData.participants);

    if (systemPrompt) {

        systemPrompt = replacePlaceholders(systemPrompt, characterName, chatData.protagonist.name)

        promptLines.push(`${contextStartString}Character ${participantId} (${characterName}) Prompt: ${systemPrompt}${contextStartString}`);

    }
        
    if (thinkPrompt) {

        thinkPrompt = replacePlaceholders(thinkPrompt, characterName, protagonistName)

        promptLines.push(`${contextStartString}${thinkStartString}${thinkPrompt}${thinkEndString}${contextStartString}`);

    }

    // Don't delete this comment. Uhm... Thinking hijacking worked a little too well. Also do not use "perfect" or "correct" before the word "formatting" as it will cause over-correction. Meanwhile, "consistent" works slightly weaker than "clean", which is weaker than "proper".

    // Don't delete this comment. The phrase "figured out" is slightly robotic when compared to "thought out".

    // We also need a phrase that stops the the language model from sticking the same topics. So the phrase for topic expansion and exploration is added to give more varied response.

    // I also added awkwardness to avoid the language model from talking to itself.

    // Using UUID is a bad idea as they will flood the attention with irrelevant context, leading a more broken output for some models.

    promptLines.push(`${contextStartString}${thinkStartString}I have thought out on how to respond as Character ${participantId} (${characterName}) without repeating phrases and with clean formatting. If the conversation becomes stagnant or repetitive, I will naturally introduce a related but fresh topic that aligns with my character's perspective and keeps the dialogue engaging. If I find myself wanting to repeat myself, I will talk about something else. Anytime a character ignores me talking, I would feel awkward. If I don't know a character's name, I would use any information that I could use to describe the character and stick with what I know. If I don't know anything, I will not create non-existent information.${thinkEndString}${contextStartString}`)

    const previousMessage = findPreviousChatMessage(chatData, character.id);
    const maximumChatStamina = character.maximumChatStamina ?? Number.POSITIVE_INFINITY;
    const currentChatStamina = previousMessage?.remainingChatStamina ?? maximumChatStamina;

    if (currentChatStamina !== undefined && maximumChatStamina !== Number.POSITIVE_INFINITY) {
        const fatigue = getFatigueContext(currentChatStamina, maximumChatStamina);
        if (fatigue) promptLines.push(fatigue);
    }

    if (chatMessageHistory.length > 0) {
        const historyLines: string[] = [];
        for (const msg of chatMessageHistory) { // Do not remove the participant ID as the names would be unknown in the past text and the ID is the only way to identify people.
            const otherCharacter = msg.character;
            const otherParticipantId = getParticipantId(otherCharacter, chatData.participants);
            const isCurrent = otherParticipantId === participantId;
            const isRevealed = revealedNamesMap.has(otherParticipantId);
            const displayName = (isRevealed || isCurrent) ? otherCharacter.name : "Unknown Name";
            if (isRevealed){

                historyLines.push(`${turnStartString}Character ${otherParticipantId} (${displayName}): ${msg.textContent}${turnEndString}`);

            } else{

                historyLines.push(`${turnStartString}Character ${otherParticipantId}: ${msg.textContent}${turnEndString}`);

            }
        }
        promptLines.push(historyLines.join('\n'));
    }

    //promptLines.push(`${contextStartString}${thinkStartString}I am now responding as Character ${participantId} (${characterName})${thinkEndString}${contextStartString}`)

    promptLines.push(`${turnStartString}${participantId} (${characterName}):`);

    return { prompt: promptLines.join('\n'), activeStopPatterns, activeContextsForImages };
}

// ✅ UPDATED: Accept userImageBase64s
export async function prepareRequestBody(
    chatData: ChatData, 
    character: Character, 
    characterImageBase64?: string | null,
    userImageBase64s?: string[]
): Promise<any> {
    const sampler = character.sampler;
    
    const { prompt, activeStopPatterns, activeContextsForImages } = buildPromptAndStopPatterns(chatData, character);

    const { stop: paramStops, ...otherParams } = sampler?.parameters || {};
    
    const finalStops = [
        turnEndString,
        turnStartString,
        thinkEndString,
        thinkStartString,
        ...(Array.isArray(paramStops) ? paramStops : []),
        ...activeStopPatterns.map(sp => sp.pattern),
    ];

    const uniqueStops = Array.from(new Set(finalStops)).filter(s => typeof s === 'string' && s.trim().length > 0);

    const allImageData: { data: string; id: number }[] = [];
    let imageIdCounter = 13;

    if (characterImageBase64) allImageData.push({ data: characterImageBase64, id: 12 });

    if (activeContextsForImages.length > 0) {
        const imagePromises = activeContextsForImages.flatMap(context => {
            if (!context.images) return [];
            return context.images.map(async (filename) => {
                try {
                    const imageUrl = `/user_data/context_data/${filename}`; 
                    const response = await fetch(imageUrl);
                    if (!response.ok) return null;
                    const blob = await response.blob();
                    const base64 = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(blob);
                    });
                    return { data: base64, id: imageIdCounter++ };
                } catch (e) {
                    console.warn(`Failed to load context image ${filename}`, e);
                    return null;
                }
            });
        });
        const resolvedImages = (await Promise.all(imagePromises)).filter(img => img !== null);
        allImageData.push(...resolvedImages);
    }

    if (userImageBase64s && userImageBase64s.length > 0) {
        for (const base64 of userImageBase64s) {
            allImageData.push({ data: base64, id: imageIdCounter++ });
        }
    }

    const body: any = {
        ...otherParams, 
        prompt,
        n_predict: sampler?.maximumNumberOfTokens ?? 512,
        stream: true,
        stop: uniqueStops,
    };

    if (allImageData.length > 0) body.image_data = allImageData;

    return body;
}

export function convertIdsToDisplayNames(text: string, chatData: ChatData): string {
    let result = text;
    chatData.participants.forEach((p, i) => {
        const id = `Character ${i + 1}`;
        const isRevealed = chatData.chatMessageHistory.some(m => m.character.id === p.id && m.isNameRevealed);
        if (isRevealed) result = result.replace(new RegExp(`\\b${id}\\b`, 'g'), p.name);
    });
    return result;
}

export function createNewChatData(character: Character): ChatData {
    const now = Date.now();
    return {
        id: uuidv4(),
        name: "Untitled Chat",
        protagonist: character,
        participants: [character],
        contexts: [],
        chatMessageHistory: [],
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentChatDataId: null,
        parentChatMessageId: null,
    };
}

export function createChatMessage(chatData: ChatData, character: Character, textContent: string): ChatMessage {
    const previousMessage = findPreviousChatMessage(chatData, character.id);
    const wasRevealed = previousMessage?.isNameRevealed ?? false;
    const isNameRevealed = wasRevealed || detectName(chatData.chatMessageHistory, character.id, character.name, textContent);
    const maximumChatStamina = character.maximumChatStamina ?? Number.POSITIVE_INFINITY;
    const remainingChatStamina = previousMessage?.remainingChatStamina ?? maximumChatStamina;
    const lastMessageId = chatData.chatMessageHistory.length > 0 ? chatData.chatMessageHistory[chatData.chatMessageHistory.length - 1].id : null;
    const now = Date.now();

    return {
        id: uuidv4(),
        character: { ...character },
        textContent,
        remainingChatStamina,
        isNameRevealed,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentChatMessageId: lastMessageId,
    };
}

export function addMessageToChatData(chatData: ChatData, newChatMessage: ChatMessage): ChatData {
    return { ...chatData, chatMessageHistory: [...chatData.chatMessageHistory, newChatMessage], lastUpdatedTimestamp: Date.now() };
}

export function editChatMessageInChatData(chatData: ChatData, messageId: string, newText: string): ChatData {
    const { chatMessageHistory } = chatData;
    const index = chatMessageHistory.findIndex(m => m.id === messageId);
    if (index === -1) return chatData;
    return {
        ...chatData,
        chatMessageHistory: chatMessageHistory.map((message, idx) => {
            if (idx === index) return { ...message, textContent: newText, kvCachePath: undefined };
            if (idx > index) return { ...message, kvCachePath: undefined };
            return message;
        })
    };
}

export function deleteChatMessage(chatData: ChatData, messageId: string): { newHistory: ChatMessage[], invalidatedIds: string[] } {
    const chatMessageHistory = chatData.chatMessageHistory;
    const targetIndex = chatMessageHistory.findIndex(m => m.id === messageId);
    if (targetIndex === -1) return { newHistory: chatMessageHistory, invalidatedIds: [] };
    const newHistory = chatMessageHistory.filter(m => m.id !== messageId);
    const finalHistory = newHistory.map((message, idx) => {
        if (idx >= targetIndex) return { ...message, kvCachePath: undefined };
        return message;
    });
    return { newHistory: finalHistory, invalidatedIds: [messageId] };
}

export function branchChatMessage(chatData: ChatData, branchPointMessageId: string): ChatData {
    const branchIndex = chatData.chatMessageHistory.findIndex(m => m.id === branchPointMessageId);
    if (branchIndex === -1) throw new Error('Branch point message not found');
    const currentTimestamp = Date.now();
    return {
        id: uuidv4(),
        name: `${chatData.name} [#${branchIndex + 1}]`,
        protagonist: chatData.protagonist,
        participants: chatData.participants,
        chatMessageHistory: chatData.chatMessageHistory.slice(0, branchIndex + 1),
        firstCreatedTimestamp: currentTimestamp,
        lastUpdatedTimestamp: currentTimestamp,
    };
}