// frontend-src/utilities/locationLogic.ts
import type { Character, InteractionData, Location, HistoryMessage } from '../types';
import { initializeClothingWearingStatuses } from './characterLogic';
import { findLatestMessage } from './messageLogic';
import { v4 as uuidv4 } from 'uuid';

export function getCurrentLocationId(interactionData: InteractionData, character: Character): string | undefined {
    const latest = findLatestMessage(interactionData, character);
    return latest?.locationId;
}

export function getCurrentLocation(interactionData: InteractionData, character: Character): Location | undefined {
    const locationId = getCurrentLocationId(interactionData, character);
    if (!locationId || !interactionData.locations) return undefined;
    return interactionData.locations.find(l => l.id === locationId);
}

export function getCoLocatedParticipants(interactionData: InteractionData, character: Character): Character[] {
    const locationId = getCurrentLocationId(interactionData, character);
    if (!locationId) return [];
    return interactionData.participants.filter(p => {
        if (p.id === character.id) return false;
        return getCurrentLocationId(interactionData, p) === locationId;
    });
}

export function getCoLocatedProtagonists(interactionData: InteractionData, character: Character): Character[] {
    const locationId = getCurrentLocationId(interactionData, character);
    if (!locationId) return [];
    const protagIds = new Set(interactionData.protagonistIds || []);
    return interactionData.participants.filter(p => {
        if (!protagIds.has(p.id)) return false;
        if (p.id === character.id) return false;
        return getCurrentLocationId(interactionData, p) === locationId;
    });
}

export function getCoLocatedParticipantCount(interactionData: InteractionData, character: Character): number {
    return getCoLocatedParticipants(interactionData, character).length;
}

/**
 * Get the latest characterLockedLocations map for a character by scanning
 * their most recent message across all locations.
 */
export function getLatestLockedLocations(interactionData: InteractionData, characterId: string): Record<string, string[]> {
    let latestMsg: HistoryMessage | undefined = undefined;
    let maxTime = -1;

    for (const messages of Object.values(interactionData.interactionHistories || {})) {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].character.id === characterId) {
                if (messages[i].firstCreatedTimestamp > maxTime) {
                    maxTime = messages[i].firstCreatedTimestamp;
                    latestMsg = messages[i];
                }
                break; // Found the latest in this specific location's array, move to next location
            }
        }
    }
    
    return latestMsg?.characterLockedLocations || {};
}

/**
 * Check if a character is locked out of a specific location.
 */
export function isCharacterLockedFromLocation(interactionData: InteractionData, characterId: string, locationId: string): boolean {
    const locks = getLatestLockedLocations(interactionData, characterId);
    const lockedChars = locks[locationId];
    if (!lockedChars || lockedChars.length === 0) return false;
    return lockedChars.includes(characterId);
}

/**
 * Get structurally reachable locations from a given origin.
 */
export function getReachableLocations(
    locations: Location[],
    currentLocationId: string | undefined,
    messageText?: string,
): Location[] {
    const currentLocation = locations.find(l => l.id === currentLocationId);
    return locations.filter(location => {
        if (location.id === currentLocationId) return false;
        if (!location.locationBindings || location.locationBindings.length === 0) return true;
        if (!currentLocation) return true;
        if (!location.locationBindings.includes(currentLocation.id)) return false;

        const conditionalRegex = location.locationBindingRegularExpressionTriggers?.[currentLocation.id];
        if (!conditionalRegex || !conditionalRegex.trim()) return true;
        if (!messageText) return false;
        try {
            const regex = new RegExp(conditionalRegex, 'i');
            return regex.test(messageText);
        } catch {
            console.warn(`Invalid conditional regex on location ${location.id} for binding ${currentLocation.id}: ${conditionalRegex}`);
            return false;
        }
    });
}

/**
 * Get reachable locations for a specific character, combining structural
 * reachability with lock state.
 */
export function getReachableLocationsByCharacter(
    interactionData: InteractionData,
    character: Character,
    messageText?: string,
): Location[] {
    const currentLocationId = getCurrentLocationId(interactionData, character);
    const locations = interactionData.locations || [];

    const structurallyReachable = getReachableLocations(locations, currentLocationId, messageText);
    const lockedLocations = getLatestLockedLocations(interactionData, character.id);

    return structurallyReachable.filter(location => {
        const lockedChars = lockedLocations[location.id];
        if (!lockedChars || lockedChars.length === 0) return true;
        return !lockedChars.includes(character.id);
    });
}

export function findLocationByRegularExpression(locations: Location[], text: string, character: Character): Location | undefined {
    if (!text || !locations.length) return undefined;
    for (const loc of locations) {
        const triggers = loc.regularExpressionActivationTriggers;
        if (!triggers || triggers.length === 0) continue;
        if (loc.characterBindings && loc.characterBindings.length > 0 && !loc.characterBindings.includes(character.id)) continue;
        for (const trigger of triggers) {
            if (!trigger.trigger.trim()) continue;
            try {
                const regex = new RegExp(trigger.trigger, 'i');
                if (regex.test(text)) return loc;
            } catch {
                console.warn(`Invalid regex on location ${loc.id}: ${trigger.trigger}`);
            }
        }
    }
    return undefined;
}

export function findReachableLocationByRegularExpression(
    interactionData: InteractionData,
    text: string,
    character: Character
): Location | undefined {
    if (!text) return undefined;
    // Get only locations structurally reachable, unlocked, and binding-validated for this character
    const reachableLocations = getReachableLocationsByCharacter(interactionData, character, text);
    if (reachableLocations.length === 0) return undefined;

    for (const loc of reachableLocations) {
        const triggers = loc.regularExpressionActivationTriggers;
        if (!triggers || triggers.length === 0) continue;
        for (const trigger of triggers) {
            if (!trigger.trigger.trim()) continue;
            try {
                const regex = new RegExp(trigger.trigger, 'i');
                if (regex.test(text)) return loc;
            } catch {
                console.warn(`Invalid regex on reachable location ${loc.id}: ${trigger.trigger}`);
            }
        }
    }
    return undefined;
}

export function sampleLocationByWeight(locations: Location[], character: Character): Location | undefined {
    if (!locations || locations.length === 0) return undefined;
    const pool: { location: Location; weight: number }[] = [];
    let totalWeight = 0;
    for (const loc of locations) {
        const charWeight = loc.characterWeights?.[character.id];
        const weight = charWeight !== undefined ? charWeight : loc.globalWeight || 0;
        if (weight > 0) { pool.push({ location: loc, weight }); totalWeight += weight; }
    }
    if (pool.length === 0 || totalWeight <= 0) return undefined;
    let randomValue = Math.random() * totalWeight;
    for (const entry of pool) { 
        randomValue -= entry.weight; 
        if (randomValue <= 0) return entry.location; 
    }
    return pool[pool.length - 1].location;
}

export function sampleReachableLocationByWeight(
    reachable: Location[],
    character: Character,
): Location | undefined {
    if (reachable.length === 0) return undefined;
    const pool: { location: Location; weight: number }[] = [];
    let totalWeight = 0;
    for (const location of reachable) {
        const charWeight = location.characterWeights?.[character.id];
        const weight = charWeight !== undefined ? charWeight : location.globalWeight || 0;
        if (weight > 0) { pool.push({ location, weight }); totalWeight += weight; }
    }
    if (pool.length === 0 || totalWeight <= 0) return undefined;
    let randomValue = Math.random() * totalWeight;
    for (const entry of pool) { 
        randomValue -= entry.weight; 
        if (randomValue <= 0) return entry.location; 
    }
    return pool[pool.length - 1].location;
}

export function sampleInitialLocationForCharacter(locations: Location[], character: Character): Location | undefined {
    if (!locations || locations.length === 0) return undefined;
    const pool: { location: Location; weight: number }[] = [];
    let totalWeight = 0;
    for (const loc of locations) {
        if (loc.characterBindings && loc.characterBindings.length > 0 && !loc.characterBindings.includes(character.id)) continue;
        const charWeight = loc.characterWeights?.[character.id];
        const weight = charWeight !== undefined ? charWeight : loc.globalWeight || 0;
        if (weight > 0) { pool.push({ location: loc, weight }); totalWeight += weight; }
    }
    if (pool.length === 0 || totalWeight <= 0) return undefined;
    let randomValue = Math.random() * totalWeight;
    for (const entry of pool) { 
        randomValue -= entry.weight; 
        if (randomValue <= 0) return entry.location; 
    }
    return pool[pool.length - 1].location;
}

// frontend-src/utilities/locationLogic.ts (inside assignInitialLocationsIfNeeded)

export function assignInitialLocationsIfNeeded(interactionData: InteractionData): InteractionData {
    const locations = interactionData.locations;
    if (!locations || locations.length === 0) return interactionData;

    const allParticipantIds = new Set<string>();
    for (const id of (interactionData.protagonistIds || [])) allParticipantIds.add(id);
    for (const p of interactionData.participants) allParticipantIds.add(p.id);

    const updatedHistories = { ...interactionData.interactionHistories };
    let changed = false;
    const now = Date.now();

    const noHistoryAtAll: Character[] = [];
    for (const id of allParticipantIds) {
        const character = interactionData.participants.find(p => p.id === id);
        if (!character) continue;

        const latest = findLatestMessage(interactionData, character);
        if (latest) continue; // Already has a location/presence

        noHistoryAtAll.push(character);
    }

    if (noHistoryAtAll.length > 0) {
        const remaining = [...noHistoryAtAll];
        while (remaining.length > 0) {
            const pool: { char: Character; weight: number }[] = [];
            let totalWeight = 0;
            for (const c of remaining) {
                const w = c.initiativeWeight ?? 1;
                if (w > 0) { pool.push({ char: c, weight: w }); totalWeight += w; }
            }
            
            let picked: Character;
            if (pool.length === 0 || totalWeight <= 0) {
                picked = remaining.shift()!;
            } else {
                let randomValue = Math.random() * totalWeight;
                picked = pool[pool.length - 1].char;
                for (const entry of pool) {
                    randomValue -= entry.weight;
                    if (randomValue <= 0) { picked = entry.char; break; }
                }
                const idx = remaining.indexOf(picked);
                if (idx !== -1) remaining.splice(idx, 1);
            }

            const sampledLocation = sampleInitialLocationForCharacter(locations, picked);
            if (sampledLocation) {
                if (!updatedHistories[sampledLocation.id]) {
                    updatedHistories[sampledLocation.id] = [];
                }
                
                // FIX: Get the absolute last message ID in the current interaction histories to chain the parentMessageId properly
                const allMsgs = Object.values(updatedHistories).flat().sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
                const lastMessageId = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1].id : null;

                updatedHistories[sampledLocation.id].push({
                    messageType: 'interaction',
                    id: uuidv4(),
                    character: { ...picked },
                    isPresent: true,
                    characterClothingWearingStatuses: initializeClothingWearingStatuses(picked),
                    characterLockedLocations: {},
                    parentMessageId: lastMessageId, // <--- Chain correctly instead of null!
                    firstCreatedTimestamp: now,
                    lastUpdatedTimestamp: now,
                });
                changed = true;
            }
        }
    }

    if (!changed) return interactionData;
    return { ...interactionData, interactionHistories: updatedHistories, lastUpdatedTimestamp: now };
}

export function isLocationOwner(character: Character, location: Location | undefined): boolean {
    if (!location) return false;
    return location.ownerBindings?.includes(character.id) || false;
}