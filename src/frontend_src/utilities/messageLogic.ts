// frontend_src/utilities/messageLogic.ts
import { deleteRawMessage, saveRawInteractionData, loadAllRawInteractionDataShells } from '../storages/serverStorage';
import type { 
    InteractionData, HistoryMessage, ChatMessage, Character, messageType, 
    ActiveToolActions, BaseMessage, InteractionMessage, Inventory, 
    NarrationMessage, PendingToolAction, ToolExecutionResult, ToolMessage, WhisperMessage 
} from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getGlobalMessageHistory } from './timelineLogic';
import { getEffectiveMaximumChatStamina, getEffectiveMaximumActionStamina, initializeClothingWearingStatuses } from './characterLogic';
import { isToolMessageText } from './interactionDataLogic';

// Helper: Returns a Set of all Message IDs in this chat that are branch points for OTHER chats
async function getParentMessageIds(chatId: string): Promise<Set<string>> {
    const allChats = await loadAllRawInteractionDataShells();
    const points = new Set<string>();
    
    for (const c of allChats) {
        if (c && c.parentInteractionDataId === chatId && c.parentMessageId) {
            points.add(c.parentMessageId);
        }
    }
    return points;
}

/**
 * Finds the most recent message where the character is currently present.
 * Returns both the message and the locationId it belongs to in a single pass.
 */
export function findLatestMessage(
    interactionData: InteractionData, 
    character: Character, 
    messageTypes?: messageType[]
): { message: HistoryMessage; locationId: string } | undefined {
    let latestMessage: HistoryMessage | undefined = undefined;
    let latestLocationId: string | undefined = undefined;
    let maxTime = -1;

    for (const [locationId, messages] of Object.entries(interactionData.interactionHistories || {})) {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.character.id === character.id) {
                if (messageTypes && messageTypes.length > 0 && !messageTypes.includes(msg.messageType)) {
                    continue; 
                }
                
                // Compare timestamps across ALL locations to find their true chronological state
                if (msg.firstCreatedTimestamp > maxTime) {
                    maxTime = msg.firstCreatedTimestamp;
                    latestMessage = msg;
                    latestLocationId = locationId;
                }
                break; // Found the newest message for this character IN THIS LOCATION array. Move to next location array.
            }
        }
    }

    if (latestMessage && (latestMessage as HistoryMessage).isPresent !== false && latestLocationId) {
        return { message: latestMessage, locationId: latestLocationId };
    }
    
    return undefined;
}

/**
 * Clears the partial flag on a message after successful resume completion.
 */
export async function clearPartialFlag(interactionData: InteractionData, messageId: string): Promise<InteractionData> {
    const updatedHistories = { ...interactionData.interactionHistories };
    let found = false;

    for (const [locId, messages] of Object.entries(updatedHistories)) {
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            const msg = messages[index];
            if (msg.messageType === 'chat') {
                updatedHistories[locId] = [...messages];
                updatedHistories[locId][index] = { ...msg }; 
            }
            found = true;
            break;
        }
    }

    if (!found) return interactionData;

    const updatedChat = {
        ...interactionData,
        interactionHistories: updatedHistories,
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawInteractionData(updatedChat);
    return updatedChat;
}

export async function deleteMessage(currentChat: InteractionData, messageId: string): Promise<InteractionData> {
    const parentInteractionMessageIds = await getParentMessageIds(currentChat.id);
    
    if (parentInteractionMessageIds.has(messageId)) {
        throw new Error("Cannot delete: Other chat sessions branch from this message.");
    }

    await deleteRawMessage(messageId);
    
    const updatedHistories = { ...currentChat.interactionHistories };
    let found = false;

    for (const [locId, messages] of Object.entries(updatedHistories)) {
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            updatedHistories[locId] = messages.filter(m => m.id !== messageId);
            found = true;
            break;
        }
    }

    if (!found) return currentChat;

    const updatedChat: InteractionData = {
        ...currentChat,
        interactionHistories: updatedHistories,
        numberOfMessages: Object.values(updatedHistories).reduce((acc, curr) => acc + curr.length, 0),
        lastUpdatedTimestamp: Date.now(),
    };

    // ✅ SAVE IMMEDIATELY: Prevents useServerSync from reloading the old chat shell
    await saveRawInteractionData(updatedChat);

    return updatedChat;
}

export async function editChatMessage(interactionData: InteractionData, messageId: string, newText: string): Promise<InteractionData> {
    const parentInteractionMessageIds = await getParentMessageIds(interactionData.id);

    if (parentInteractionMessageIds.has(messageId)) {
        throw new Error("Cannot edit: Other chat sessions branch from this message.");
    }

    const updatedHistories = { ...interactionData.interactionHistories };
    let found = false;

    for (const [locId, messages] of Object.entries(updatedHistories)) {
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            const msg = messages[index];
            const messageType = msg.messageType;
            if (messageType === 'chat' || messageType === "whisper") {
                updatedHistories[locId] = [...messages];
                updatedHistories[locId][index] = { 
                    ...msg, 
                    textContent: newText, 
                    // Clear fields tied to the old text
                    toolExecutionResults: [], 
                    lastUpdatedTimestamp: Date.now() 
                } as ChatMessage;
            }
            found = true;
            break;
        }
    }

    if (!found) return interactionData;

    const updatedChat = {
        ...interactionData,
        interactionHistories: updatedHistories,
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawInteractionData(updatedChat);
    return updatedChat;
}

/**
 * Mass deletes messages from the target message's location onwards.
 * Automatically resolves the locationId from the messageId.
 */
export async function massDeleteMessages(interactionData: InteractionData, messageId: string): Promise<InteractionData> {
    const parentInteractionMessageIds = await getParentMessageIds(interactionData.id);
    
    // 1. Get the global flattened history to find chronological order
    const globalHistory = getGlobalMessageHistory(interactionData);
    const targetGlobalIndex = globalHistory.findIndex(m => m.id === messageId);
    
    if (targetGlobalIndex === -1) {
        throw new Error("Message not found.");
    }

    // 2. Identify all messages from this message onwards in the global timeline
    const messagesToDelete = globalHistory.slice(targetGlobalIndex);

    for (const msg of messagesToDelete) {
        if (parentInteractionMessageIds.has(msg.id)) {
            throw new Error("Cannot delete: Other chats branch from this message.");
        }
    }

    // 3. Delete raw messages from server storage
    await Promise.all(messagesToDelete.map(m => deleteRawMessage(m.id)));
    
    // 4. Rebuild all location histories keeping only messages BEFORE targetGlobalIndex
    const updatedHistories: Record<string, HistoryMessage[]> = {};
    for (const [locId, messages] of Object.entries(interactionData.interactionHistories || {})) {
        const keptMsgs = messages.filter(m => {
            const globalIdx = globalHistory.findIndex(hm => hm.id === m.id);
            return globalIdx !== -1 && globalIdx < targetGlobalIndex;
        });
        
        updatedHistories[locId] = keptMsgs;
    }

    const totalMessages = Object.values(updatedHistories).reduce((acc, curr) => acc + curr.length, 0);

    return {
        ...interactionData,
        interactionHistories: updatedHistories,
        numberOfMessages: totalMessages,
        lastUpdatedTimestamp: Date.now(),
    };
}

/**
 * Branches the chat at the target message.
 * Automatically resolves the locationId from the messageId.
 */
export async function branchMessage(interactionData: InteractionData, messageId: string): Promise<InteractionData> {
    const target = getMessageById(interactionData, messageId);
    if (!target) {
        throw new Error("Message not found");
    }
    
    const locationId = target.locationId;
    const messages = interactionData.interactionHistories[locationId] || [];
    const branchIndex = messages.findIndex(m => m.id === messageId);
    
    if (branchIndex === -1) {
        throw new Error("Message not found in this location");
    }

    const branchedHistories: Record<string, HistoryMessage[]> = {};
    
    for (const [locId, msgs] of Object.entries(interactionData.interactionHistories)) {
        if (locId === locationId) {
            branchedHistories[locId] = msgs.slice(0, branchIndex + 1);
        } else {
            branchedHistories[locId] = [...msgs];
        }
    }

    const branchedChat: InteractionData = {
        ...interactionData,
        id: uuidv4(),
        name: `${interactionData.name} (Branch)`,
        interactionHistories: branchedHistories,
        parentInteractionDataId: interactionData.id,
        parentMessageId: messageId,
        firstCreatedTimestamp: Date.now(),
        lastUpdatedTimestamp: Date.now(),
    };

    await saveRawInteractionData(branchedChat);
    return branchedChat;
}

/**
 * Clones the chat up to the target message.
 * Automatically resolves the locationId from the messageId.
 */
export async function cloneChatUpToMessage(interactionData: InteractionData, messageId: string): Promise<InteractionData> {
    const globalHistory = getGlobalMessageHistory(interactionData);
    const targetGlobalIndex = globalHistory.findIndex(m => m.id === messageId);
    
    if (targetGlobalIndex === -1) {
        throw new Error("Message not found in global timeline.");
    }

    const now = Date.now();
    const clonedHistories: Record<string, HistoryMessage[]> = {};

    // Filter all locations based on the global chronological index
    for (const [locId, messages] of Object.entries(interactionData.interactionHistories || {})) {
        const keptMsgs = messages.filter(m => {
            const globalIdx = globalHistory.findIndex(hm => hm.id === m.id);
            return globalIdx !== -1 && globalIdx <= targetGlobalIndex;
        });
        
        // Generate new IDs and timestamps for the independent clone
        clonedHistories[locId] = keptMsgs.map(msg => ({
            ...msg,
            id: uuidv4(),
            character: { ...msg.character },
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
            parentMessageId: null,
        }));
    }

    const clonedChat: InteractionData = {
        id: uuidv4(),
        name: `${interactionData.name} (Clone)`,
        protagonistIds: [...(interactionData.protagonistIds || [])],
        participants: interactionData.participants.map(p => ({ ...p })),
        contexts: (interactionData.contexts || []).map(c => ({ ...c })),
        locations: (interactionData.locations || []).map(l => ({ ...l })),
        audioTracks: (interactionData.audioTracks || []).map(a => ({ ...a })),
        interactionHistories: clonedHistories,
        profile: interactionData.profile,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        parentInteractionDataId: null,
        parentMessageId: null,
    };

    await saveRawInteractionData(clonedChat);
    return clonedChat;
}

/**
 * Finds a specific message by its ID across all locations.
 * Returns the message and the locationId it belongs to.
 */
export function getMessageById(interactionData: InteractionData, messageId: string): { message: HistoryMessage; locationId: string } | undefined {
    for (const [locationId, messages] of Object.entries(interactionData.interactionHistories || {})) {
        const msg = messages.find(m => m.id === messageId);
        if (msg) {
            return { message: msg, locationId };
        }
    }
    return undefined;
}

// ─── Unified Message Factory ───────────────────────────────────────

export interface CreateMessageOptions {
    messageType?: messageType;
    textContent?: string;
    files?: string[];
    frontCameraImage?: string;
    targetCharacterIds?: string[];
    toolExecutionResults?: ToolExecutionResult[];
    knownCharacterNames?: Record<string, Record<string, boolean>>;
    clothingWearingStatuses?: Record<string, boolean>;
    characterLockedLocations?: Record<string, boolean>;
    pendingToolActions?: PendingToolAction[];
    activeToolActions?: ActiveToolActions;
    inventory?: Inventory;
    characterExpression?: string;
    isPresent?: boolean;
    remainingChatStamina?: number;
    remainingActionStamina?: number;
    parentMessageId?: string | null;
    timestamp?: number;
    interactionData?: InteractionData;
    previousMessage?: HistoryMessage | null;
    doNotRespond?: boolean;
}

function inferMessageType(options?: CreateMessageOptions): messageType {
    if (options?.messageType) {
        return options.messageType;
    }

    if (options?.targetCharacterIds && options.targetCharacterIds.length > 0) {
        return 'whisper';
    }

    if (options?.textContent === undefined) {
        return 'interaction';
    }

    if (isToolMessageText(options.textContent)) {
        return 'tool';
    }

    return 'chat';
}

export function createMessage(character: Character, options?: CreateMessageOptions): HistoryMessage {
    const interactionData = options?.interactionData;
    const prev = options?.previousMessage !== undefined
        ? options.previousMessage
        : (interactionData ? findLatestMessage(interactionData, character)?.message : undefined);

    const effectiveMaxChatStamina = getEffectiveMaximumChatStamina(character, interactionData?.profile);
    const effectiveMaxActionStamina = getEffectiveMaximumActionStamina(character, interactionData?.profile);
    const remainingChatStamina = options?.remainingChatStamina 
        ?? prev?.remainingChatStamina 
        ?? effectiveMaxChatStamina;
    const remainingActionStamina = options?.remainingActionStamina 
        ?? prev?.remainingActionStamina 
        ?? effectiveMaxActionStamina;

    const globalMessages = interactionData ? getGlobalMessageHistory(interactionData) : [];
    const defaultParentId = globalMessages.length > 0 ? globalMessages[globalMessages.length - 1].id : null;
    const parentMessageId = options?.parentMessageId !== undefined ? options.parentMessageId : defaultParentId;
    const now = options?.timestamp ?? Date.now();

    const knownCharacterNames = options?.knownCharacterNames ??
        (character.knownCharacterNames
            ? Object.fromEntries(
                Object.entries(character.knownCharacterNames).map(([charId, names]) =>
                    [charId, Object.fromEntries(names.map(n => [n, true] as const))]
                )
            )
            : {});

    const prevClothing = (prev as ChatMessage)?.characterClothingWearingStatuses;
    const clothingWearingStatuses = options?.clothingWearingStatuses 
        ?? prevClothing 
        ?? initializeClothingWearingStatuses(character);

    const characterLockedLocations = options?.characterLockedLocations 
        ?? (prev?.characterLockedLocations ? { ...prev.characterLockedLocations } : {});

    const inventory = options?.inventory 
        ?? (prev?.inventory ? { ...prev.inventory } : undefined);

    const activeToolActions = options?.activeToolActions 
        ?? (prev?.activeToolActions ? { ...prev.activeToolActions } : undefined);

    const resolvedType = inferMessageType(options);
    const textContent = options?.textContent ?? '';

    const baseMessage: BaseMessage = {
        id: uuidv4(),
        character: { ...character },
        isPresent: options?.isPresent ?? true,
        characterExpression: options?.characterExpression ?? prev?.characterExpression,
        remainingChatStamina,
        remainingActionStamina,
        knownCharacterNames,
        characterClothingWearingStatuses: clothingWearingStatuses,
        characterLockedLocations,
        inventory,
        activeToolActions,
        pendingToolActions: options?.pendingToolActions,
        parentMessageId,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };

    switch (resolvedType) {
        case 'interaction':
            return {
                ...baseMessage,
                messageType: 'interaction',
            } as InteractionMessage;

        case 'whisper':
            return {
                ...baseMessage,
                messageType: 'whisper',
                textContent,
                targetCharacterIds: options?.targetCharacterIds ?? [],
                files: options?.files ?? [],
                frontCameraImage: options?.frontCameraImage,
                toolExecutionResults: options?.toolExecutionResults,
                doNotRespond: options?.doNotRespond,
                modelTextContentSummaries: {},
                modelInteractionTextContentSummaries: {},
                kvCacheTextContentPaths: {},
                kvCacheTextContentSummaryPaths: {},
                kvCacheInteractionTextContentSummaries: {},
            } as WhisperMessage;

        case 'tool':
            return {
                ...baseMessage,
                messageType: 'tool',
                textContent,
                files: options?.files ?? [],
                frontCameraImage: options?.frontCameraImage,
                toolExecutionResults: options?.toolExecutionResults,
            } as ToolMessage;

        case 'narration':
            return {
                ...baseMessage,
                messageType: 'narration',
                textContent,
            } as NarrationMessage;

        default:
            return {
                ...baseMessage,
                messageType: 'chat',
                textContent,
                files: options?.files ?? [],
                frontCameraImage: options?.frontCameraImage,
                toolExecutionResults: options?.toolExecutionResults,
                doNotRespond: options?.doNotRespond,
                modelTextContentSummaries: {},
                modelInteractionTextContentSummaries: {},
                kvCacheTextContentPaths: {},
                kvCacheTextContentSummaryPaths: {},
                kvCacheInteractionTextContentSummaries: {},
            } as ChatMessage;
    }
}