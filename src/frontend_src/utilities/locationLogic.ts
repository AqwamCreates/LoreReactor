// src/frontend_src/utilities/locationLogic.ts
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
 * FIX 1: Scan across all messages in the session to find the most recently established locks.
 * Locks are established by keyholders, not necessarily by the character being checked.
 */
export function getLatestLockedLocations(interactionData: InteractionData, characterId?: string): Record<string, string[]> {
    let latestLocks: Record<string, string[]> | undefined = undefined;
    let maxTime = -1;

    for (const messages of Object.values(interactionData.interactionHistories || {})) {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.characterLockedLocations && Object.keys(msg.characterLockedLocations).length > 0) {
                if (msg.firstCreatedTimestamp > maxTime) {
                    maxTime = msg.firstCreatedTimestamp;
                    latestLocks = msg.characterLockedLocations;
                }
            }
        }
    }

    if (latestLocks) return latestLocks;

    // Fallback: check character's own latest message
    if (characterId) {
        const latest = findLatestMessage(interactionData, { id: characterId } as Character);
        return latest?.message?.characterLockedLocations || {};
    }

    return {};
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
 * FIX 2: Check reachability bidirectionally and cleanly validate conditional regex triggers.
 */
export function getReachableLocations(
    locations: Location[],
    currentLocationId: string | undefined,
    messageText?: string,
): Location[] {
    const currentLocation = locations.find(l => l.id === currentLocationId);
    if (!currentLocation) return locations.filter(l => l.id !== currentLocationId);

    return locations.filter(location => {
        if (location.id === currentLocationId) return false;

        const hasCurrentBindings = currentLocation.locationBindings && currentLocation.locationBindings.length > 0;
        const hasTargetBindings = location.locationBindings && location.locationBindings.length > 0;

        // If neither room has restrictions defined, they are freely accessible
        if (!hasCurrentBindings && !hasTargetBindings) return true;

        // Connected if current location links to target, or target links to current
        const isBound = (hasCurrentBindings && currentLocation.locationBindings!.includes(location.id)) ||
                        (hasTargetBindings && location.locationBindings!.includes(currentLocation.id));

        if (!isBound) return false;

        // Check conditional regex triggers if defined on either binding endpoint
        const conditionalRegex = location.locationBindingRegularExpressionTriggers?.[currentLocation.id] ||
                                 currentLocation.locationBindingRegularExpressionTriggers?.[location.id];
        if (!conditionalRegex) return true;
        if (!messageText) return false;

        try {
            const regex = new RegExp(conditionalRegex, 'i');
            return regex.test(messageText);
        } catch {
            console.warn(`Invalid conditional regex between ${currentLocation.id} and ${location.id}: ${conditionalRegex}`);
            return false;
        }
    });
}

/**
 * FIX 3: Enforce reachability, door locks, AND characterBindings so private rooms are respected.
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
        // Enforce character bindings (e.g. private bedroom restricted to specific character)
        if (location.characterBindings && location.characterBindings.length > 0 && !location.characterBindings.includes(character.id)) {
            return false;
        }

        // Enforce key lockouts
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
            if (!trigger.trigger) continue;
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
        // Check characterBindings
        if (loc.characterBindings && loc.characterBindings.length > 0 && !loc.characterBindings.includes(character.id)) {
            continue;
        }

        const triggers = loc.regularExpressionActivationTriggers;
        if (!triggers || triggers.length === 0) continue;
        for (const trigger of triggers) {
            if (!trigger.trigger) continue;
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

/**
 * FIX 4: Sequentially increment timestamps when placing multiple initial characters
 * to avoid identical timestamps and race conditions in timeline sorting.
 */
export function assignInitialLocationsIfNeeded(interactionData: InteractionData): InteractionData {
    const locations = interactionData.locations;
    if (!locations || locations.length === 0) return interactionData;

    const allParticipantIds = new Set<string>();
    for (const id of (interactionData.protagonistIds || [])) allParticipantIds.add(id);
    for (const p of interactionData.participants) allParticipantIds.add(p.id);

    const updatedHistories = { ...interactionData.interactionHistories };
    let changed = false;
    let sequenceTime = Date.now();

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
            sequenceTime++; // Increment per character to guarantee strict chronological order

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
                
                const allMsgs = Object.values(updatedHistories).flat().sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
                const lastMessageId = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1].id : null;

                updatedHistories[sampledLocation.id].push({
                    messageType: 'interaction',
                    id: uuidv4(),
                    character: { ...picked },
                    isPresent: true,
                    characterClothingWearingStatuses: initializeClothingWearingStatuses(picked),
                    characterLockedLocations: {},
                    parentMessageId: lastMessageId,
                    firstCreatedTimestamp: sequenceTime,
                    lastUpdatedTimestamp: sequenceTime,
                });
                changed = true;
            }
        }
    }

    if (!changed) return interactionData;
    return { ...interactionData, interactionHistories: updatedHistories, lastUpdatedTimestamp: sequenceTime };
}

export function isLocationOwner(character: Character, location: Location | undefined): boolean {
    if (!location) return false;
    return location.ownerBindings?.includes(character.id) || false;
}