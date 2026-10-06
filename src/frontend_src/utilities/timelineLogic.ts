// frontend_src/utilities/timelineLogic.ts
import type { InteractionData, HistoryMessage, Character } from '../types';
import { getMessageById } from './messageLogic';

// ─── Timeline Cache ────────────────────────────────────────────────

interface TimelineCacheEntry {
    globalHistory: HistoryMessage[];
    msgLocMap: Map<string, string>;
    localHistoryCache: Map<string, HistoryMessage[]>; // Key: character.id
    lastUpdated: number;
}

const timelineCache = new Map<string, TimelineCacheEntry>();

/**
 * Retrieves or computes the cached timeline for a given InteractionData.
 * Invalidates automatically if the data's lastUpdatedTimestamp has changed.
 */
function getTimelineCache(interactionData: InteractionData): TimelineCacheEntry {
    const id = interactionData.id || 'unknown';
    const lastUpdated = interactionData.lastUpdatedTimestamp;
    const cached = timelineCache.get(id);

    if (cached && cached.lastUpdated === lastUpdated) {
        return cached;
    }

    // Compute O(N log N) sort and O(N) map build only when necessary
    const histories = interactionData.interactionHistories || {};
    const globalHistory = Object.values(histories)
        .flat()
        .sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
    
    const msgLocMap = new Map<string, string>();
    for (const [locId, msgs] of Object.entries(histories)) {
        for (const msg of msgs) {
            msgLocMap.set(msg.id, locId);
        }
    }

    const newEntry: TimelineCacheEntry = { 
        globalHistory, 
        msgLocMap, 
        localHistoryCache: new Map(), // Fresh cache for local histories
        lastUpdated 
    };
    
    timelineCache.set(id, newEntry);
    return newEntry;
}

/**
 * Clears the cache for a specific interaction data ID. 
 */
export function clearTimelineCache(interactionDataId: string): void {
    timelineCache.delete(interactionDataId);
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Flattens all location-specific message histories into a single, 
 * chronologically sorted array. (Cached)
 */
export function getGlobalMessageHistory(
    interactionData: InteractionData, 
    messageTypes?: string[], 
    limit?: number, 
    startingMessageId?: string
): HistoryMessage[] {
    const { globalHistory } = getTimelineCache(interactionData);
    
    let result = globalHistory;
    
    if (messageTypes && messageTypes.length > 0) {
        result = result.filter(msg => messageTypes.includes(msg.messageType));
    }

    if (startingMessageId) {
        const startIdx = result.findIndex(m => m.id === startingMessageId);
        if (startIdx !== -1) {
            result = result.slice(startIdx);
        }
    }

    if (limit !== undefined && limit > 0) {
        return result.slice(-limit);
    }

    return result;
}

/**
 * Gets the message history from a specific character's perspective.
 * Traces back the conversation thread using parentMessageId.
 * Handles convergence points by defining a strict search space gap. (CACHED)
 */
// frontend_src/utilities/timelineLogic.ts

export function getLocalMessageHistory(
    interactionData: InteractionData, 
    character: Character, 
    messageTypes?: string[], 
    limit?: number
): HistoryMessage[] {
    const cache = getTimelineCache(interactionData);
    const { globalHistory, msgLocMap } = cache;
    if (globalHistory.length === 0) return [];
    
    // 1. Check cache for this character's thread
    let chain = cache.localHistoryCache.get(character.id);
    
    if (!chain) {
        // 2. Start from the absolute latest message in the global session timeline (the tip)
        const latestGlobal = globalHistory[globalHistory.length - 1];
        const newChain: HistoryMessage[] = [];
        const visitedIds = new Set<string>();
        let currentMsg: HistoryMessage | undefined = latestGlobal;

        while (currentMsg) {
            if (visitedIds.has(currentMsg.id)) break; // Circular reference protection
            visitedIds.add(currentMsg.id);
            newChain.push(currentMsg);

            // --- CONVERGENCE HANDLING ---
            if (currentMsg.isConverged) {
                const currentLocId = msgLocMap.get(currentMsg.id);
                const globalIdx = globalHistory.findIndex(m => m.id === currentMsg?.id);
                
                let prevCharIdx = -1;
                for (let i = globalIdx - 1; i >= 0; i--) {
                    if (globalHistory[i].character.id === currentMsg.character.id) {
                        prevCharIdx = i;
                        break;
                    }
                }
                
                const searchSpaceStart = prevCharIdx !== -1 ? prevCharIdx + 1 : 0;
                const searchSpaceEnd = globalIdx - 1;
                
                let predecessor: HistoryMessage | undefined = undefined;
                
                if (currentLocId && searchSpaceEnd >= searchSpaceStart) {
                    for (let i = searchSpaceEnd; i >= searchSpaceStart; i--) {
                        if (msgLocMap.get(globalHistory[i].id) === currentLocId) {
                            predecessor = globalHistory[i]; 
                            break;
                        }
                    }
                }
                
                if (!predecessor) {
                    if (prevCharIdx !== -1) {
                        predecessor = globalHistory[prevCharIdx]; 
                    } else if (searchSpaceEnd >= searchSpaceStart) {
                        predecessor = globalHistory[searchSpaceEnd]; 
                    }
                }
                
                currentMsg = predecessor;

            // --- STANDARD CHAIN REACTION ---
            } else if (currentMsg.parentMessageId) {
                const parent = getMessageById(interactionData, currentMsg.parentMessageId);
                currentMsg = parent?.message;
            } else {
                currentMsg = undefined;
            }
        }
        
        // Reverse to make it chronological (oldest to newest)
        newChain.reverse();
        chain = newChain;
        
        // 3. Store in cache
        cache.localHistoryCache.set(character.id, chain);
    }

    // 4. Apply filters
    let filteredHistory = chain;
    if (messageTypes && messageTypes.length > 0) {
        filteredHistory = chain.filter(msg => messageTypes.includes(msg.messageType));
    }

    if (limit !== undefined && limit > 0) {
        return filteredHistory.slice(-limit);
    }

    return filteredHistory;
}

/**
 * Gets all messages from a specific location, sorted chronologically.
 */
export function getLocationMessageHistory(
    interactionData: InteractionData, 
    locationId: string, 
    messageTypes?: string[], 
    limit?: number
): HistoryMessage[] {
    const messages = interactionData.interactionHistories?.[locationId] || [];
    
    // Note: Sorting a single location's messages is already very fast (O(K log K) where K << N).
    let sortedMessages = [...messages].sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
    
    if (messageTypes && messageTypes.length > 0) {
        sortedMessages = sortedMessages.filter(msg => messageTypes.includes(msg.messageType));
    }

    if (limit !== undefined && limit > 0) {
        return sortedMessages.slice(-limit);
    }

    return sortedMessages;
}

/**
 * Finds the chronological index of a message in the global flattened history. (Cached)
 */
export function getGlobalMessageIndex(interactionData: InteractionData, messageId: string): number {
    const { globalHistory } = getTimelineCache(interactionData);
    return globalHistory.findIndex(m => m.id === messageId);
}

/**
 * Checks if a message is the absolute latest message in the entire session. (Cached)
 */
export function isLatestGlobalMessage(interactionData: InteractionData, messageId: string): boolean {
    const { globalHistory } = getTimelineCache(interactionData);
    if (globalHistory.length === 0) return false;
    return globalHistory[globalHistory.length - 1].id === messageId;
}

/**
 * Gets all messages that occurred *after* a specific message in the global timeline. (Cached)
 */
export function getMessagesAfter(interactionData: InteractionData, messageId: string): HistoryMessage[] {
    const { globalHistory } = getTimelineCache(interactionData);
    const index = globalHistory.findIndex(m => m.id === messageId);
    
    if (index === -1) return [];
    return globalHistory.slice(index + 1);
}