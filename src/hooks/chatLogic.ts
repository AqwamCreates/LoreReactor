// src/services/chatLogic.ts
import { v4 as uuidv4 } from 'uuid';
import type { Character, ChatData, ChatMessage, Context, StopPattern } from '../types';
import { detectName } from './nameDetection';

// --- Helpers ---

export function getParticipantId(character: Character, participants: Character[]): string {
    const index = participants.findIndex(p => p.id === character.id);
    return index !== -1 ? `Character ${index + 1}` : 'Unknown';
}

export function getFatigueContext(currentChatStamina: number, maximumChatStamina: number): string {
    if (maximumChatStamina === Number.POSITIVE_INFINITY) return "";
    const ratio = currentChatStamina / maximumChatStamina;
    if (ratio > 0.5) return "[You are starting to feel slightly winded.]";
    if (ratio > 0.3) return "[You are quite exhausted. You somewhat have the energy to speak.]";
    if (ratio > 0.1) return "[You are completely drained. You barely have the energy to speak.]";
    return "[You have no energy left to do anything.]";
}

export function findPreviousChatMessage(chatData: ChatData, characterId: string): ChatMessage | null {
    const chatMessageHistory = chatData.chatMessageHistory;
    for (let i = chatMessageHistory.length - 1; i >= 0; i--) {
        if (chatMessageHistory[i].character.id === characterId) return chatMessageHistory[i];
    }
    return null;
}

// --- Unified Filtering Logic (The Core Engine) ---

function filterArrayBasedOnContext(
    characterIdArray: string[], 
    textContentArray: string[], 
    currentCharacterId: string, 
    contextType: 'global' | 'local' | 'previous'
): { characterIdArray: string[]; textContentArray: string[] } {

    const length = characterIdArray.length;

    if (contextType === "global") {
        return { characterIdArray, textContentArray };
    }

    if (contextType === "previous") {
        if (length === 0) return { characterIdArray: [], textContentArray: [] };
        return {
            characterIdArray: [characterIdArray[length - 1]],
            textContentArray: [textContentArray[length - 1]]
        };
    }

    if (contextType === "local") {
        let targetIndex = -1;

        const endIndex = length - 1

        for (let i = endIndex; i >= 0; i--) {

            // To avoid grabbing previous current character message if nobody has spoken to the current character.
            // This effectively makes it local memory between current character's response.

            if ((characterIdArray[i] === currentCharacterId) && (i === endIndex)) {continue}

            if ((characterIdArray[i] !== currentCharacterId) && (i === endIndex)) {

                targetIndex = i;
                break;

            }

            if ((characterIdArray[i] === currentCharacterId) && (characterIdArray[i + 1] !== currentCharacterId)) {

                targetIndex = i;
                break;
            }
        }

        if (targetIndex === -1) return { characterIdArray: [], textContentArray: [] };

        const startIndex = targetIndex + 1;
        if (startIndex >= length) return { characterIdArray: [], textContentArray: [] };

        return {
            characterIdArray: characterIdArray.slice(startIndex),
            textContentArray: textContentArray.slice(startIndex)
        };
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

    if (targetType === "everyone") {
        return { characterIdArray, textContentArray };
    }

    let targetCharacterId: string | undefined = undefined;

    if (targetType === "self") {
        targetCharacterId = currentCharacterId;
    } else if (targetType === "listener") {
        // Find the most recent speaker who is NOT the current character
        for (let i = length - 1; i >= 0; i--) {
            if (characterIdArray[i] !== currentCharacterId) {
                targetCharacterId = characterIdArray[i];
                break;
            }
        }
    }

    if (!targetCharacterId) {
        return { characterIdArray: [], textContentArray: [] };
    }

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

// --- Main Builder with Shared Cache ---

interface BuildResult {
    prompt: string;
    activeStopPatterns: StopPattern[];
    activeContextsForImages: Context[]; // Contexts that passed regex and have images/base64 flag
}

export function buildPromptAndStopPatterns(chatData: ChatData, character: Character): BuildResult {
    const chatMessageHistory = chatData.chatMessageHistory;
    const contexts = chatData.contexts || [];
    const sampler = character.sampler;
    const allStopPatterns = sampler?.stopPatterns || [];
    const currentCharacterId = character.id;

    // 1. Flatten History into Arrays
    const characterIdArray: string[] = [];
    const textContentArray: string[] = [];
    const revealedNamesMap = new Map<string, boolean>();

    for (const msg of chatMessageHistory) {
        characterIdArray.push(msg.character.id);
        textContentArray.push(msg.textContent);
        if (msg.isNameRevealed) {
            revealedNamesMap.set(msg.character.id, true);
        }
    }

    // 2. Initialize Shared Cache
    // Key: ContextType -> Key: TargetType -> Value: Filtered Result
    const combinationCache: Record<string, Record<string, { characterIdArray: string[], textContentArray: string[] }>> = {};

    const promptLines: string[] = [];
    const activeStopPatterns: StopPattern[] = [];
    const activeContextsForImages: Context[] = [];

    // Helper to get filtered data from cache
    const getFilteredData = (ctxType: string, tgtType: string) => {
        if (!combinationCache[ctxType]) {
            combinationCache[ctxType] = {};
        }
        
        if (!combinationCache[ctxType][tgtType]) {
            const step1 = filterArrayBasedOnContext(characterIdArray, textContentArray, currentCharacterId, ctxType as any);
            const step2 = filterArrayBasedOnTarget(step1.characterIdArray, step1.textContentArray, currentCharacterId, tgtType as any);
            combinationCache[ctxType][tgtType] = step2;
        }
        
        return combinationCache[ctxType][tgtType];
    };

    // 3. Process CONTEXTS (Injection & Image Flagging)
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

        if (!regexTrigger) {
            shouldInject = true;
        } else {
            try {
                const regex = new RegExp(regexTrigger);
                if (regex.test(searchSpace)) {
                    shouldInject = true;
                }
            } catch (e) {
                console.warn(`Invalid regex in context ${context.name}`, e);
                shouldInject = true;
            }
        }

        if (shouldInject) {
            if (context.text) {
                promptLines.push(`[Context: ${context.text}]`);
            }
            // Track contexts that have images AND want base64 encoding for later processing
            if (context.images && context.images.length > 0 && context.useBase64Encoding) {
                activeContextsForImages.push(context);
            }
        }
    }

    // 4. Process STOP PATTERNS (Activation)
    for (const stopPattern of allStopPatterns) {
        const ctxType = stopPattern.regularExpressionContext || 'global';
        const tgtType = stopPattern.regularExpressionTarget || 'everyone';
        const regexTrigger = stopPattern.regularExpressionTrigger;

        // Use the SAME cache entry calculated above
        const { textContentArray: filteredTexts } = getFilteredData(ctxType, tgtType);

        if (!regexTrigger) {
            // If no regex, the stop pattern is always active (standard behavior)
            activeStopPatterns.push(stopPattern);
            continue;
        }

        if (filteredTexts.length === 0) continue;

        const searchSpace = filteredTexts.join('\n');

        try {
            const regex = new RegExp(regexTrigger);
            if (regex.test(searchSpace)) {
                activeStopPatterns.push(stopPattern);
            }
        } catch (e) {
            console.warn(`Invalid regex in stop pattern ${stopPattern.name}`, e);
            activeStopPatterns.push(stopPattern);
        }
    }

    // 5. Construct Final Prompt String
    if (character.systemPrompt) promptLines.push(`[${character.systemPrompt}]`);

    // Fatigue
    const previousMessage = findPreviousChatMessage(chatData, character.id);
    const maximumChatStamina = character.maximumChatStamina ?? Number.POSITIVE_INFINITY;
    const currentChatStamina = previousMessage?.remainingChatStamina ?? maximumChatStamina;

    const participantId = getParticipantId(character, chatData.participants);
    
    promptLines.push(`[You must reply as ${participantId} / ${character.name}. Your response must be in character.]`);
    
    if (currentChatStamina !== undefined && maximumChatStamina !== Number.POSITIVE_INFINITY) {
        const fatigue = getFatigueContext(currentChatStamina, maximumChatStamina);
        if (fatigue) promptLines.push(fatigue);
    }

    // Identity Map
    const identityMapEntries = chatData.participants.map(p => {
        const id = getParticipantId(p, chatData.participants);
        const isCurrent = id === participantId;
        const isRevealed = revealedNamesMap.has(p.id);
        const displayName = (isRevealed || isCurrent) ? p.name : "Unknown";
        return `${id} = ${displayName}`;
    });
    
    if (identityMapEntries.length > 0) {
        promptLines.push(`[Identity Map: ${identityMapEntries.join('; ')}]`);
    }

    if (chatMessageHistory.length > 0) {
        const historyLines: string[] = [];
        
        for (const msg of chatMessageHistory) {
            const participantId = getParticipantId(msg.character, chatData.participants);
            historyLines.push(`Character ${participantId}: ${msg.textContent}`);
        }
        
        promptLines.push(historyLines.join('\n'));

    }

    promptLines.push(`Character ${participantId}:`);

    return {
        prompt: promptLines.join('\n'),
        activeStopPatterns,
        activeContextsForImages
    };
}

// --- Request Preparation ---

export async function prepareRequestBody(chatData: ChatData, character: Character, characterImageBase64?: string | null): Promise<any> {
    const sampler = character.sampler;
    const participants = chatData.participants;
    
    // 1. Run the Unified Builder
    const { prompt, activeStopPatterns, activeContextsForImages } = buildPromptAndStopPatterns(chatData, character);

    // 2. Calculate Dynamic Stops
    const roleplayStops = participants.flatMap(p => {
        const id = getParticipantId(p, participants);
        return [`\n${id}:`, `\n${p.name}:`];
    });

    const { stop: paramStops, ...otherParams } = sampler?.parameters || {};
    
    const finalStops = [
        '<|end_of_turn|>',
        '<|start_of_turn|>',
        ...roleplayStops,
        ...(Array.isArray(paramStops) ? paramStops : []),
        ...activeStopPatterns.map(sp => sp.pattern), // Inject activated stop patterns
    ];

    // 🛡️ SANITIZATION: Filter out empty strings, nulls, or undefined to prevent 400 errors
    const uniqueStops = Array.from(new Set(finalStops)).filter(s => typeof s === 'string' && s.trim().length > 0);

    // 3. Collect Images (Character + Contexts)
    const allImageData: { data: string; id: number }[] = [];
    let imageIdCounter = 13; // Start after character image ID (12)

    if (characterImageBase64) {
        allImageData.push({ data: characterImageBase64, id: 12 });
    }

    // Process Context Images that flagged for Base64
    if (activeContextsForImages.length > 0) {
        const imagePromises = activeContextsForImages.flatMap(context => {
            if (!context.images) return [];
            return context.images.map(async (filename) => {
                // Fetch and Convert
                try {
                    // Adjust path if necessary based on your storage.tsx PATHS
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

    // 4. Construct Body
    const body: any = {
        ...otherParams, 
        prompt,
        n_predict: sampler?.maximumNumberOfTokens ?? 512,
        stream: true,
        stop: uniqueStops, // ✅ Now guaranteed to be clean
    };

    // ✅ Only add image_data if the array is not empty
    if (allImageData.length > 0) {
        body.image_data = allImageData;
    }

    return body;
}

// --- Message Management (Unchanged) ---

export function convertIdsToDisplayNames(text: string, chatData: ChatData): string {
    let result = text;
    chatData.participants.forEach((p, i) => {
        const id = `Character ${i + 1}`;
        const isRevealed = chatData.chatMessageHistory.some(m => m.character.id === p.id && m.isNameRevealed);
        if (isRevealed) {
        result = result.replace(new RegExp(`\\b${id}\\b`, 'g'), p.name);
        }
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
    const isRevealed = wasRevealed || detectName(chatData.chatMessageHistory, character.id, character.name, textContent);
    const maximumChatStamina = character.maximumChatStamina ?? Number.POSITIVE_INFINITY;
    const remainingChatStamina = previousMessage?.remainingChatStamina ?? maximumChatStamina;
    const lastMessageId = chatData.chatMessageHistory.length > 0 ? chatData.chatMessageHistory[chatData.chatMessageHistory.length - 1].id : null;
    const now = Date.now();

    return {
        id: uuidv4(),
        character: { ...character },
        textContent,
        remainingChatStamina: remainingChatStamina,
        isNameRevealed: isRevealed,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentChatMessageId: lastMessageId,
    };
}

export function addMessageToChatData(chatData: ChatData, newChatMessage: ChatMessage): ChatData {
    return {
        ...chatData,
        chatMessageHistory: [...chatData.chatMessageHistory, newChatMessage],
        lastUpdatedTimestamp: Date.now(),
    };
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