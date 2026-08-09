// src/services/chatLogic.ts
import { v4 as uuidv4 } from 'uuid';
import type { Character, ChatData, ChatMessage, Context, StopPattern, Profile, PromptBlockType } from '../types';
import { detectName } from './nameDetection';
import { countTokens, estimateTokens } from '../utilities/tokenCounter';

const contextStartString = "{"
const contextEndString = "}"
const turnStartString = "{"
const turnEndString = "}"
const thinkStartString = ""
const thinkEndString = ""

// ✅ Default prompt order: System Prompt → Think Prompt → Context → Chat History
const DEFAULT_INPUT_STRATEGY: PromptBlockType[] = [
    'System Prompt', 'Think Prompt', 'Context', 'Chat History'
];

// ✅ Maximum recursion depth for lorebook scanning — prevents infinite loops
const MAX_RECURSION_DEPTH = 5;

// ✅ Default total token budget for all context entries combined
// Entries are dropped from the bottom of the list first when this is exceeded
const DEFAULT_CONTEXT_TOKEN_BUDGET = 2048;

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

export function getEffectiveChatProbability(character: Character, profile?: Profile): number {
    const profileOverride = profile?.chatProbability ?? 0;
    if (profileOverride > 0) return profileOverride;
    return character.chatProbability ?? 0.5;
}

export function getEffectiveMaxChatStamina(character: Character, profile?: Profile): number {
    const profileOverride = profile?.maximumChatStamina ?? 0;
    if (profileOverride > 0) return profileOverride;
    return character.maximumChatStamina ?? Number.POSITIVE_INFINITY;
}

export function getEffectiveInitiativeWeight(character: Character, profile?: Profile): number {
    if (profile?.forceEqualInitiative) return 1;
    return character.initiativeWeight ?? 1;
}

/**
 * ✅ Checks if a context entry's keyword/regex matches against a search string.
 */
function doesContextMatch(context: Context, searchSpace: string): boolean {
    const regexTrigger = context.regularExpressionTrigger;
    if (!regexTrigger) return true;
    try {
        const regex = new RegExp(regexTrigger);
        return regex.test(searchSpace);
    } catch (e) {
        console.warn(`Invalid regex in context ${context.name}`, e);
        return true;
    }
}

/**
 * ✅ Checks if a context entry is bound to the current speaking character.
 */
function isCharacterBound(context: Context, currentCharacterId: string): boolean {
    if (!context.characterBindings || context.characterBindings.length === 0) return true;
    return context.characterBindings.includes(currentCharacterId);
}

/**
 * ✅ Lorebook-style recursive context resolution.
 */
async function resolveContextEntries(
    contexts: Context[],
    chatSearchSpace: string,
    currentCharacterId: string,
    getFilteredData: (ctxType: string, tgtType: string) => { characterIdArray: string[]; textContentArray: string[] },
    runtimePort?: number
): Promise<{ context: Context; formattedLine: string }[]> {
    const activated = new Set<string>();
    const activatedMap = new Map<string, Context>();

    // --- Phase 1: Direct scan (preserves list order) ---
    for (const context of contexts) {
        if (activated.has(context.id)) continue;
        if (context.preventRecursion) continue;
        if (!isCharacterBound(context, currentCharacterId)) continue;

        const ctxType = context.regularExpressionContext || 'global';
        const tgtType = context.regularExpressionTarget || 'everyone';
        const { textContentArray: filteredTexts } = getFilteredData(ctxType, tgtType);

        if (filteredTexts.length === 0 && !context.regularExpressionTrigger) {
            if (ctxType !== 'global' || tgtType !== 'everyone') continue;
        }

        const searchSpace = filteredTexts.join('\n');
        const combinedSearch = searchSpace + '\n' + chatSearchSpace;

        if (doesContextMatch(context, combinedSearch)) {
            activated.add(context.id);
            activatedMap.set(context.id, context);
        }
    }

    // --- Phase 2: Recursive scanning ---
    let recursionDepth = 0;
    let newActivations = true;

    while (newActivations && recursionDepth < MAX_RECURSION_DEPTH) {
        newActivations = false;
        recursionDepth++;

        const activatedText = Array.from(activatedMap.values())
            .map(c => c.text || '')
            .join('\n');

        if (!activatedText.trim()) break;

        for (const context of contexts) {
            if (activated.has(context.id)) continue;
            if (!isCharacterBound(context, currentCharacterId)) continue;

            if (doesContextMatch(context, activatedText)) {
                activated.add(context.id);
                activatedMap.set(context.id, context);
                newActivations = true;
            }
        }
    }

    // --- Phase 3: Format, enforce budget by list order, sort by depth ---

    const orderedActivated: Context[] = [];
    for (const context of contexts) {
        if (activatedMap.has(context.id)) {
            orderedActivated.push(context);
        }
    }

    const formattedEntries: { context: Context; formattedLine: string; tokenCount: number }[] = [];

    for (const context of orderedActivated) {
        const contextText = context.text;
        if (!contextText) continue;

        const formattedLine = `${contextStartString}${contextText}${contextEndString}`;

        let tokenCount: number;
        if (context.tokenBudget && context.tokenBudget > 0) {
            tokenCount = context.tokenBudget;
        } else if (runtimePort) {
            tokenCount = await countTokens(formattedLine, runtimePort);
        } else {
            tokenCount = estimateTokens(formattedLine);
        }

        formattedEntries.push({ context, formattedLine, tokenCount });
    }

    let totalTokens = 0;
    const budgetEntries: typeof formattedEntries = [];

    for (const entry of formattedEntries) {
        if (totalTokens + entry.tokenCount <= DEFAULT_CONTEXT_TOKEN_BUDGET) {
            totalTokens += entry.tokenCount;
            budgetEntries.push(entry);
        }
    }

    budgetEntries.sort((a, b) => {
        const depthA = a.context.insertionDepth ?? 0;
        const depthB = b.context.insertionDepth ?? 0;
        return depthA - depthB;
    });

    return budgetEntries.map(e => ({ context: e.context, formattedLine: e.formattedLine }));
}

interface BuildResult {
    prompt: string;
    activeStopPatterns: StopPattern[];
    activeContextsForImages: Context[];
}

export async function buildPromptAndStopPatterns(chatData: ChatData, character: Character, runtimePort?: number): Promise<BuildResult> {
    const chatMessageHistory = chatData.chatMessageHistory;
    const contexts = chatData.contexts || [];
    const sampler = character.sampler;
    const allStopPatterns = sampler?.stopPatterns || [];
    const currentCharacterId = character.id;
    const characterName = character.name;
    const protagonistName = chatData.protagonist.name;
    let systemPrompt = character.systemPrompt;
    let thinkPrompt = character.thinkPrompt;

    const profile = chatData.Profile;
    const cacheLevel = profile?.cacheInvalidationReductionLevel ?? 0;
    const inputStrategy = profile?.inputStrategy ?? DEFAULT_INPUT_STRATEGY;

    const characterIdArray: string[] = [];
    const textContentArray: string[] = [];
    const revealedNamesMap = new Map<string, boolean>();

    for (const msg of chatMessageHistory) {
        characterIdArray.push(msg.character.id);
        textContentArray.push(msg.textContent);
        if (msg.isNameRevealed) revealedNamesMap.set(msg.character.id, true);
    }

    const combinationCache: Record<string, Record<string, { characterIdArray: string[], textContentArray: string[] }>> = {};
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

    // ✅ CONTEXT BLOCK — lorebook-style resolution with async token counting
    const contextLines: string[] = [];
    const globalChatSearch = textContentArray.join('\n');

    const resolvedContexts = await resolveContextEntries(
        contexts,
        globalChatSearch,
        currentCharacterId,
        getFilteredData,
        runtimePort
    );

    for (const { context, formattedLine } of resolvedContexts) {
        let line = formattedLine;
        if (context.text) {
            const replacedText = replacePlaceholders(context.text, characterName, protagonistName);
            if (context.useBase64Encoding) {
                const encodedText = btoa(unescape(encodeURIComponent(replacedText)));
                line = `${contextStartString}[base64:${encodedText}]${contextEndString}`;
            } else {
                line = `${contextStartString}${replacedText}${contextEndString}`;
            }
        }
        contextLines.push(line);

        if (context.images && context.images.length > 0) {
            activeContextsForImages.push(context);
        }
    }

    // STOP PATTERNS
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

    // SYSTEM PROMPT BLOCK
    const systemPromptLines: string[] = [];
    if (cacheLevel >= 2) {
        for (const p of chatData.participants) {
            if (p.systemPrompt) {
                const pId = getParticipantId(p, chatData.participants);
                const pName = p.name;
                systemPromptLines.push(`${contextStartString}Character ${pId} (${pName}) Prompt: ${replacePlaceholders(p.systemPrompt, characterName, protagonistName)}${contextEndString}`);
            }
        }
    } else if (systemPrompt) {
        systemPrompt = replacePlaceholders(systemPrompt, characterName, chatData.protagonist.name);
        systemPromptLines.push(`${contextStartString}Character ${participantId} (${characterName}) Prompt: ${systemPrompt}${contextEndString}`);
    }

    // THINK PROMPT BLOCK
    const thinkPromptLines: string[] = [];
    if (cacheLevel >= 3) {
        for (const p of chatData.participants) {
            if (p.thinkPrompt) {
                const pId = getParticipantId(p, chatData.participants);
                const pName = p.name;
                thinkPromptLines.push(`${contextStartString}${thinkStartString}${replacePlaceholders(p.thinkPrompt, characterName, protagonistName)}${thinkEndString}${contextEndString}`);
            }
        }
    } else if (thinkPrompt) {
        thinkPrompt = replacePlaceholders(thinkPrompt, characterName, protagonistName);
        thinkPromptLines.push(`${contextStartString}${thinkStartString}${thinkPrompt}${thinkEndString}${contextEndString}`);
    }

    // META THINK BLOCK
    const metaThinkLines: string[] = [];
    let nameInjection = '';
    if (cacheLevel >= 1) {
        const allNames = chatData.participants.map(p => {
            const pId = getParticipantId(p, chatData.participants);
            return `${pId}=${p.name}`;
        }).join(', ');
        nameInjection = ` Known participants: ${allNames}.`;
    }

    metaThinkLines.push(`${contextStartString}${thinkStartString}I have thought out on how to respond as Character ${participantId} (${characterName}) without repeating phrases and with clean formatting. If the conversation becomes stagnant or repetitive, I will naturally introduce a related but fresh topic that aligns with my character's perspective and keeps the dialogue engaging. If I find myself wanting to repeat myself, I will talk about something else. Anytime a character ignores me talking, I would feel awkward. If I don't know a character's name, I would use any information that I could use to describe the character and stick with what I know. If I don't know anything, I will not create non-existent information.${nameInjection}${thinkEndString}${contextEndString}`);

    // FATIGUE BLOCK
    const fatigueLines: string[] = [];
    const previousMessage = findPreviousChatMessage(chatData, character.id);
    const effectiveMaxStamina = getEffectiveMaxChatStamina(character, profile);
    const currentChatStamina = previousMessage?.remainingChatStamina ?? effectiveMaxStamina;

    if (currentChatStamina !== undefined && effectiveMaxStamina !== Number.POSITIVE_INFINITY) {
        const fatigue = getFatigueContext(currentChatStamina, effectiveMaxStamina);
        if (fatigue) fatigueLines.push(fatigue);
    }

    // ✅ Build chat history with summarization pipeline applied in step order
    const historyLines: string[] = [];
    if (chatMessageHistory.length > 0) {
        // Get enabled summarization steps sorted by order
        const enabledSteps = (profile?.summarizationSteps || [])
            .filter(s => s.enabled)
            .sort((a, b) => a.order - b.order);

        // Start with full message list — each step may transform it
        let processedMessages = chatMessageHistory.map((msg, idx) => ({
            msg,
            idx,
            text: msg.textContent,
        }));

        // Apply each enabled step in order
        for (const step of enabledSteps) {
            if (step.strategyType === 'Sliding Window Replace') {
                const windowSize = step.slidingWindowSize ?? 10;
                const cutoff = Math.max(0, processedMessages.length - windowSize);
                for (let i = 0; i < processedMessages.length; i++) {
                    if (i < cutoff && processedMessages[i].msg.textContentSummary) {
                        processedMessages[i].text = processedMessages[i].msg.textContentSummary;
                    }
                }
            }

            if (step.strategyType === 'Observation Masking') {
                const threshold = step.maskingRelevanceThreshold ?? 0.3;
                const keywordWeight = step.maskingKeywordWeight ?? 0.7;
                const recencyWeight = 1 - keywordWeight;

                // Build keyword set from recent messages (last 5)
                const recentText = processedMessages
                    .slice(-5)
                    .map(p => p.text.toLowerCase())
                    .join(' ');
                const keywords = new Set(
                    recentText.split(/\s+/).filter(w => w.length > 3)
                );

                // Score each message and filter
                processedMessages = processedMessages.filter((p, i) => {
                    const totalMessages = processedMessages.length;
                    const recencyScore = (i + 1) / totalMessages;

                    let keywordScore = 0;
                    const words = p.text.toLowerCase().split(/\s+/);
                    for (const word of words) {
                        if (keywords.has(word)) keywordScore++;
                    }
                    keywordScore = words.length > 0 ? keywordScore / words.length : 0;

                    const combinedScore = (keywordWeight * keywordScore) + (recencyWeight * recencyScore);
                    return combinedScore >= threshold;
                });
            }

            // Periodic Compression and Recursive Summary produce Context entries
            // and are handled by SummarizationEngine, not here
        }

        // Render processed messages into prompt lines
        for (const p of processedMessages) {
            const otherCharacter = p.msg.character;
            const otherParticipantId = getParticipantId(otherCharacter, chatData.participants);
            const isCurrent = otherParticipantId === participantId;
            const isRevealed = revealedNamesMap.has(otherParticipantId);
            const displayName = (isRevealed || isCurrent) ? otherCharacter.name : otherParticipantId;

            if (isRevealed) {
                historyLines.push(`${turnStartString}Character ${otherParticipantId} (${displayName}): ${p.text}${turnEndString}`);
            } else {
                historyLines.push(`${turnStartString}Character ${otherParticipantId}: ${p.text}${turnEndString}`);
            }
        }
    }

    const userInputLine = `${turnStartString}${participantId} (${characterName}):`;

    // ✅ Assemble prompt blocks according to inputStrategy order
    const blockMap: Record<string, string[]> = {
        'Context': contextLines,
        'System Prompt': systemPromptLines,
        'Think Prompt': thinkPromptLines,
        'Chat History': [...metaThinkLines, ...fatigueLines, ...historyLines],
    };

    const promptLines: string[] = [];
    const usedTypes = new Set<string>();

    for (const blockType of inputStrategy) {
        const lines = blockMap[blockType];
        if (lines && lines.length > 0) {
            promptLines.push(...lines);
        }
        usedTypes.add(blockType);
    }

    for (const blockType of DEFAULT_INPUT_STRATEGY) {
        if (!usedTypes.has(blockType)) {
            const lines = blockMap[blockType];
            if (lines && lines.length > 0) {
                promptLines.push(...lines);
            }
        }
    }

    promptLines.push(userInputLine);

    return { prompt: promptLines.join('\n'), activeStopPatterns, activeContextsForImages };
}

export async function prepareRequestBody(
    chatData: ChatData, 
    character: Character, 
    characterImageBase64?: string | null,
    userImageBase64s?: string[],
    runtimePort?: number
): Promise<any> {
    const sampler = character.sampler;
    
    const { prompt, activeStopPatterns, activeContextsForImages } = await buildPromptAndStopPatterns(chatData, character, runtimePort);

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
    const profile = chatData.Profile;
    const stripThinkTokens = profile?.stripThinkTokens ?? false;

    let result = text;

    if (stripThinkTokens) {
        result = result.replace(/[\s\S]*?<\/think>/g, '');
        result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
    }

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
    const effectiveMaxStamina = getEffectiveMaxChatStamina(character, chatData.Profile);
    const remainingChatStamina = previousMessage?.remainingChatStamina ?? effectiveMaxStamina;
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
        Profile: chatData.Profile,
    };
}