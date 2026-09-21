// src/hooks/chatLogic.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage, PromptBlock, Location, RegularExpressionTrigger, TextCharacterInjection } from '../types';
import { detectName } from './nameDetection';
import { v4 as uuidv4 } from 'uuid';
import { getCharacterImageUrlWithFallBack, getContextImageUrl, getLocationImageUrl, getPromptBlockImageUrl } from '../storage/serverStorage';
import { getEffectiveUseFrontCameraImage, getEffectiveMaximumChatStamina, initializeClothingWearingStatuses } from './characterLogic';
import { generalStartString, generalEndString } from '../dictionaries/stringList';
import { buildPrompt, getParticipantTag } from './promptLogic';
import { getCoLocatedParticipants } from './locationLogic';

// ─── Front Camera Capture ──────────────────────────────────────────

let _cameraStream: MediaStream | null = null;
let _cameraVideo: HTMLVideoElement | null = null;
let _cameraCleanupTimer: ReturnType<typeof setTimeout> | null = null;

const CAMERA_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function scheduleCameraCleanup(): void {
    if (_cameraCleanupTimer) clearTimeout(_cameraCleanupTimer);
    _cameraCleanupTimer = setTimeout(() => {
        if (_cameraStream) {
            _cameraStream.getTracks().forEach(t => t.stop());
            _cameraStream = null;
        }
        if (_cameraVideo) {
            _cameraVideo.srcObject = null;
            _cameraVideo.remove();
            _cameraVideo = null;
        }
        _cameraCleanupTimer = null;
    }, CAMERA_IDLE_TIMEOUT_MS);
}

export async function captureFrontCameraImage(): Promise<string | null> {
    try {
        if (!_cameraStream || !_cameraStream.active) {
            if (_cameraVideo) {
                _cameraVideo.srcObject = null;
                _cameraVideo.remove();
                _cameraVideo = null;
            }
            _cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 512 }, height: { ideal: 512 } },
                audio: false,
            });
            _cameraVideo = document.createElement('video');
            _cameraVideo.srcObject = _cameraStream;
            _cameraVideo.setAttribute('playsinline', '');
            _cameraVideo.muted = true;
            await _cameraVideo.play();
            await new Promise<void>(resolve => {
                const check = () => {
                    if (_cameraVideo && _cameraVideo.readyState >= 2) resolve();
                    else requestAnimationFrame(check);
                };
                check();
            });
        }

        scheduleCameraCleanup();

        if (!_cameraVideo || _cameraVideo.readyState < 2) return null;

        const canvas = document.createElement('canvas');
        canvas.width = _cameraVideo.videoWidth || 512;
        canvas.height = _cameraVideo.videoHeight || 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(_cameraVideo, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.8);
    } catch (e) {
        console.error('Front camera capture failed:', e);
        return null;
    }
}

// ─── Core Functions ────────────────────────────────────────────────

export function findPreviousMessage(interactionData: InteractionData, characterId: string): HistoryMessage | null {
    const interactionHistory = interactionData.interactionHistory;
    for (let i = interactionHistory.length - 1; i >= 0; i--) {
        if (interactionHistory[i].character.id === characterId) return interactionHistory[i];
    }
    return null;
}

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

function detectLocationFromText(text: string, locations: Location[]): number | undefined {
    for (let i = 0; i < locations.length; i++) {
        const location = locations[i];
        const triggers = location.regularExpressionActivationTriggers;
        if (!triggers || triggers.length === 0) continue;
        for (const trigger of triggers) {
            if (!trigger.trigger.trim()) continue;
            try {
                const regex = new RegExp(trigger.trigger, 'i');
                if (regex.test(text)) return i;
            } catch { /* invalid regex, skip */ }
        }
    }
    return undefined;
}

/**
 * Compiles regex patterns from trigger arrays for sequential message filtering.
 * Returns compiled regex arrays, skipping invalid patterns.
 */
export function compileTriggerRegexes(triggers: RegularExpressionTrigger[] | undefined): RegExp[] {
    if (!triggers || triggers.length === 0) return [];
    const regexes: RegExp[] = [];
    for (const t of triggers) {
        if (!t.trigger.trim()) continue;
        try { regexes.push(new RegExp(t.trigger)); } catch { /* skip invalid */ }
    }
    return regexes;
}

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

export async function prepareRequestBody(
    interactionData: InteractionData,
    character: Character,
    existingCharacterText: string,
    allPromptBlocks: PromptBlock[],
    modelId: string,
): Promise<{ body: Record<string, unknown>; fetchErrors: string[]; characterClothingWearingStatuses: Record<string, boolean> }> {

    const profile = interactionData.Profile;

    const { prompt, stops, contextImages, locationImages, promptBlockImages, characterClothingWearingStatuses, fetchErrors } = await buildPrompt(interactionData, character, existingCharacterText, allPromptBlocks, modelId);

    const sampler = character.sampler;
    const forceNoCharacterImageInjection = profile?.forceNoCharacterImageInjection;

    const filesBase64: { data: string; id: number }[] = [];
    let imageIdCounter = 1;
    let initialPrompt = "";

    if (!forceNoCharacterImageInjection) {

        if (!character.doNotInjectCharacterImage) {
            const characterMessage = findPreviousMessage(interactionData, character.id);
            const characterExpression = characterMessage?.characterExpression;
            const characterImagePath = await getCharacterImageUrlWithFallBack(character.id, characterExpression);

            if (characterImagePath) {
                const characterImageBase64 = await getImageBase64(characterImagePath);
                if (characterImageBase64) {
                    const rawData = characterImageBase64.includes(',') ? characterImageBase64.split(',')[1] : characterImageBase64;
                    filesBase64.push({ data: rawData, id: imageIdCounter++ });
                    initialPrompt = `${generalStartString}I understand that the image ${imageIdCounter} is my appearance. This visual reference applies only to my body description. All formatting rules, dialogue structure, and response style remain governed by the prompts below.${generalEndString}`;
                }
            }
        }

        // Inject all co-located participant images (includes protagonists if co-located)
        const colocatedParticipants = getCoLocatedParticipants(interactionData, character);
        const protagonistIds = new Set(interactionData.protagonists?.map(p => p.id) ?? []);
        const effectiveUseFrontCameraImage = getEffectiveUseFrontCameraImage(character, profile);

        for (const participant of colocatedParticipants) {
            // Skip self — already injected above
            if (participant.id === character.id) continue;

            if (participant.doNotInjectCharacterImage) continue;

            const participantMessage = findPreviousMessage(interactionData, participant.id);
            const participantExpression = participantMessage?.characterExpression;

            let participantImageBase64: string | null = null;

            // If this participant is a protagonist and front camera is enabled,
            // use the front camera image from their last message if available
            const chatMsg = participantMessage as ChatMessage | null;
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
            let participantString = getParticipantTag(participant, interactionData.participants);
            if (participantMessage?.isNameRevealed) {
                participantString = `${participantString} (${participant.name})`;
            }

            filesBase64.push({ data: rawData, id: imageIdCounter++ });

            initialPrompt = `${initialPrompt}${generalStartString}I understand that the image ${imageIdCounter} is the appearance of ${participantString}.${generalEndString}`;
        }

        // Attach files from co-located protagonists' most recent messages only
        for (const participant of colocatedParticipants) {
            if (!protagonistIds.has(participant.id)) continue;
            const lastMsg = findPreviousMessage(interactionData, participant.id);
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
        const contextImagePromises = contextImages.map(async (filename) => {
            try {
                const imageUrl = getContextImageUrl(filename);
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
        const locationImagePromises = locationImages.map(async (filename) => {
            try {
                const imageUrl = getLocationImageUrl(filename);
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
            } catch{ return null; }
        });
        const resolvedLocationImages = (await Promise.all(locationImagePromises)).filter(img => img !== null);
        filesBase64.push(...resolvedLocationImages);
    }

    if (!profile?.forceNoContextImageInjection && promptBlockImages.length > 0) {
        const promptBlockImagePromises = promptBlockImages.map(async (filename) => {
            try {
                const imageUrl = getPromptBlockImageUrl(filename);
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

    const fullPrompt = `${initialPrompt}${prompt}`;
    const { stop: paramStops, ...otherParams } = sampler?.parameters || {};

    const finalStops = [
        ...(Array.isArray(paramStops) ? paramStops : []),
        ...stops,
    ];
    const uniqueStops = Array.from(new Set(finalStops)).filter(s => typeof s === 'string' && s.trim().length > 0);

    const body: Record<string, unknown> = {
        ...otherParams,
        prompt: fullPrompt,
        n_predict: sampler?.maximumNumberOfTokens ?? 512,
        stream: true,
        stop: uniqueStops,
    };

    // ─── Text Character Injection Logic ─────────────────────────────
    if (profile?.randomizeTextCharacterInjection) {
        const maxRetries = profile.maximumNumberOfTextCharacterRandomizationPerModel ?? 1;
        const injections: string[] = [];
        for (let i = 0; i < maxRetries; i++) {
            injections.push(generateInitialCharacterText(character));
        }

        body._basePrompt = fullPrompt;

        if (!profile.randomizeTextCharacterInjectionOnRetry && injections.length > 0) {
            const firstInjection = injections.shift()!;
            body.prompt = firstInjection + (body.prompt as string);
        }

        if (injections.length > 0) {
            body._injectionStrings = injections;
        }
    }

    if (filesBase64.length > 0) body.image_data = filesBase64;

    return { body, fetchErrors, characterClothingWearingStatuses };
}

export function convertIdsToDisplayNames(text: string, interactionData: InteractionData): string {
    const profile = interactionData.Profile;
    const stripThinkTokens = profile?.stripThinkTokens ?? false;

    let result = text;

    if (stripThinkTokens) {
        result = result.replace(/[\s\S]*?<\/think>/g, '');
        result = result.replace(/<\|channel>[\s\S]*?<channel\|>/g, '');
        result = result.replace(/\n\s*\n\s*\n/g, '\n\n');
    }

    result = result.replace(/<memory>\}/g, '');
    result = result.replace(/<memory>[\s\S]*?\}/g, '');

    interactionData.participants.forEach((p, i) => {
        const id = `Character ${i + 1}`;
        const isRevealed = interactionData.interactionHistory.some(m => m.character.id === p.id && m.isNameRevealed);
        if (isRevealed) result = result.replace(new RegExp(`\\b${id}\\b`, 'g'), p.name);
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
        interactionHistory: [],
        numberOfMessages: 0,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentInteractionDataId: null,
        parentInteractionMessageId: null,
        isMultiplayerEnabled: false,
    };
}

export function createChatMessage(
    interactionData: InteractionData,
    character: Character,
    textContent: string,
    options?: { isPartial?: boolean; locationIndex?: number; files?: string[]; frontCameraImage?: string, clothingWearingStatuses?: Record<string, boolean> }
): ChatMessage {
    const previousMessage = findPreviousMessage(interactionData, character.id);
    const wasRevealed = previousMessage?.isNameRevealed ?? false;
    const isNameRevealed = wasRevealed || detectName(interactionData, character, textContent);
    const effectiveMaximumChatStamina = getEffectiveMaximumChatStamina(character, interactionData.Profile);
    const effectiveMaximumActionStamina = getEffectiveMaximumChatStamina(character, interactionData.Profile);
    const remainingChatStamina = previousMessage?.remainingChatStamina ?? effectiveMaximumChatStamina;
    const remainingActionStamina = previousMessage?.remainingActionStamina ?? effectiveMaximumActionStamina;
    const lastMessageId = interactionData.interactionHistory.length > 0 ? interactionData.interactionHistory[interactionData.interactionHistory.length - 1].id : null;
    const now = Date.now();

    const id = uuidv4();
    const files = options?.files ?? [];
    const frontCameraImage = options?.frontCameraImage;
    const isProtagonist = interactionData.protagonists?.some(p => p.id === character.id) ?? false;
    const isPartial = options?.isPartial ?? !isProtagonist;

    let locationIndex = options?.locationIndex;
    if (locationIndex === undefined && interactionData.locations && interactionData.locations.length > 0) {
        locationIndex = detectLocationFromText(textContent, interactionData.locations);
    }

    const prevClothingStatuses = (previousMessage as ChatMessage)?.characterClothingWearingStatuses;
    const clothingWearingStatuses = options?.clothingWearingStatuses ?? prevClothingStatuses ?? initializeClothingWearingStatuses(character);
    const prevLockedLocations = previousMessage?.characterLockedLocations ?? {};

    return {
        id,
        messageType: 'chat',
        character: { ...character },
        textContent,
        files,
        frontCameraImage,
        remainingChatStamina,
        remainingActionStamina,
        isNameRevealed,
        locationIndex,
        isPartial,
        characterClothingWearingStatuses: clothingWearingStatuses,
        characterLockedLocations: { ...prevLockedLocations },
        modelTextContentSummaries: {},
        modelInteractionTextContentSummaries: {},
        kvCacheTextContentPaths: {},
        kvCacheTextContentSummaryPaths: {},
        kvCacheInteractionTextContentSummaries: {},
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentInteractionMessageId: lastMessageId,
    } as ChatMessage;
}

export function addMessageToInteractionData(interactionData: InteractionData, newInteractionMessage: HistoryMessage): InteractionData {
    return {
        ...interactionData,
        interactionHistory: [...interactionData.interactionHistory, newInteractionMessage],
        numberOfMessages: (interactionData.numberOfMessages ?? interactionData.interactionHistory.length) + 1,
        lastUpdatedTimestamp: Date.now()
    };
}

export function editInteractionMessageInInteractionData(interactionData: InteractionData, messageId: string, newText: string): InteractionData {
    const { interactionHistory } = interactionData;
    const index = interactionHistory.findIndex(m => m.id === messageId);
    if (index === -1) return interactionData;
    return {
        ...interactionData,
        interactionHistory: interactionHistory.map((message, idx) => {
            if (idx === index && message.messageType === 'chat') {
                return { ...message, textContent: newText, kvCacheTextContentPaths: {}, kvCacheTextContentSummaryPaths: {}, kvCacheInteractionTextContentSummaries: {} };
            }
            if (idx > index && message.messageType === 'chat') {
                return { ...message, kvCacheTextContentPaths: {}, kvCacheTextContentSummaryPaths: {}, kvCacheInteractionTextContentSummaries: {} };
            }
            return message;
        })
    };
}

export function updatePartialMessageInInteractionData(
    interactionData: InteractionData,
    characterId: string,
    newText: string,
    characterExpression?: string,
): InteractionData {
    const history = [...interactionData.interactionHistory];
    for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.character.id === characterId && m.messageType === 'chat' && (m as ChatMessage).isPartial) {
            history[i] = { ...m, textContent: newText, characterExpression: characterExpression ?? (m as ChatMessage).characterExpression, lastUpdatedTimestamp: Date.now() } as ChatMessage;
            return { ...interactionData, interactionHistory: history, lastUpdatedTimestamp: Date.now() };
        }
    }
    return interactionData;
}

export function deleteInteractionMessage(interactionData: InteractionData, messageId: string): { newHistory: HistoryMessage[]; invalidatedIds: string[] } {
    const interactionHistory = interactionData.interactionHistory;
    const targetIndex = interactionHistory.findIndex(m => m.id === messageId);
    if (targetIndex === -1) return { newHistory: interactionHistory, invalidatedIds: [] };
    const newHistory = interactionHistory.filter(m => m.id !== messageId);
    const finalHistory = newHistory.map((message, idx) => {
        if (idx >= targetIndex && message.messageType === 'chat') {
            return { ...message, kvCacheTextContentPaths: {}, kvCacheTextContentSummaryPaths: {}, kvCacheInteractionTextContentSummaries: {} };
        }
        return message;
    });
    return { newHistory: finalHistory, invalidatedIds: [messageId] };
}

export function branchInteractionMessage(interactionData: InteractionData, branchPointMessageId: string): InteractionData {
    const branchIndex = interactionData.interactionHistory.findIndex(m => m.id === branchPointMessageId);
    if (branchIndex === -1) throw new Error('Branch point message not found');
    const currentTimestamp = Date.now();
    const branchedHistory = interactionData.interactionHistory.slice(0, branchIndex + 1);
    return {
        id: uuidv4(),
        name: `${interactionData.name} [#${branchIndex + 1}]`,
        protagonists: interactionData.protagonists,
        participants: interactionData.participants,
        contexts: interactionData.contexts,
        locations: interactionData.locations,
        audioTracks: interactionData.audioTracks,
        interactionHistory: branchedHistory,
        numberOfMessages: branchedHistory.length,
        firstCreatedTimestamp: currentTimestamp,
        lastUpdatedTimestamp: currentTimestamp,
        Profile: interactionData.Profile,
        parentInteractionDataId: interactionData.id,
        parentInteractionMessageId: branchPointMessageId,
        isMultiplayerEnabled: interactionData.isMultiplayerEnabled,
        multiplayerData: interactionData.multiplayerData,
    };
}