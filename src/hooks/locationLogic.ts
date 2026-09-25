// src/hooks/locationLogic.ts
import type { Character, InteractionData, Location } from '../types';
import { initializeClothingWearingStatuses } from './characterLogic';
import { findPreviousMessage } from './chatLogic';
import { v4 as uuidv4 } from 'uuid';

export function getCurrentLocationIndex(interactionData: InteractionData, character: Character): number | undefined {
    const locations = interactionData.locations;
    if (!locations || locations.length <= 0) return undefined;
    const message = findPreviousMessage(interactionData, character.id);
    if (!message) return undefined;
    return message.locationIndex;
}

export function getCurrentLocation(interactionData: InteractionData, character: Character): Location | undefined {
    const currentLocationIndex = getCurrentLocationIndex(interactionData, character);
    if (currentLocationIndex === undefined) return undefined;
    const locations = interactionData.locations;
    if (!locations) return undefined;
    return locations[currentLocationIndex];
}

export function getCoLocatedParticipants(interactionData: InteractionData, character: Character): Character[] {
    const locationIndex = getCurrentLocationIndex(interactionData, character);
    if (locationIndex === undefined) return [];
    return interactionData.participants.filter(p => {
        if (p.id === character.id) return false;
        const pLocIdx = getCurrentLocationIndex(interactionData, p);
        return pLocIdx === locationIndex;
    });
}

export function getCoLocatedProtagonists(interactionData: InteractionData, character: Character): Character[] {
    const locationIndex = getCurrentLocationIndex(interactionData, character);
    if (locationIndex === undefined) return [];
    return interactionData.protagonists.filter(p => {
        if (p.id === character.id) return false;
        const pLocIdx = getCurrentLocationIndex(interactionData, p);
        return pLocIdx === locationIndex;
    });
}

export function getCoLocatedParticipantCount(interactionData: InteractionData, character: Character): number {
    return getCoLocatedParticipants(interactionData, character).length;
}

/**
 * Get the latest characterLockedLocations map for a character by scanning
 * their most recent message in the interaction history.
 */
export function getLatestLockedLocations(interactionData: InteractionData, characterId: string): Record<string, string[]> {
    for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
        const msg = interactionData.interactionHistory[i];
        if (msg.character.id === characterId && msg.characterLockedLocations) {
            return msg.characterLockedLocations;
        }
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
 * Get structurally reachable locations from a given origin.
 *
 * Directional semantics: "Accessible to [character] from [currentLocation]"
 * A target location is reachable if its `locationBindings` array includes
 * the current location's ID (i.e., the target declares the origin as a valid
 * departure point). If `locationBindings` is empty/undefined, the location
 * is universally reachable from anywhere.
 *
 * Optional conditional regex: If the target location has a
 * `locationBindingRegularExpressionTriggers` entry keyed by the current
 * location's ID, the regex must match `messageText` for the connection to
 * be considered open (e.g., "the door is unlocked").
 *
 * @param locations - All locations in the interaction
 * @param currentLocationIndex - The origin location index (where the character currently is)
 * @param messageText - Optional text to test against conditional regex triggers
 * @returns Array of reachable locations with their indices, excluding the current location
 */
export function getReachableLocations(
    locations: Location[],
    currentLocationIndex: number | undefined,
    messageText?: string,
): { location: Location; locationIndex: number }[] {
    const currentLocation = currentLocationIndex !== undefined ? locations[currentLocationIndex] : undefined;
    return locations
        .map((loc, i) => ({ location: loc, locationIndex: i }))
        .filter(({ location, locationIndex }) => {
            // Exclude the current location itself
            if (locationIndex === currentLocationIndex) return false;

            // No bindings = universally reachable from anywhere
            if (!location.locationBindings || location.locationBindings.length === 0) return true;

            // No known current location = can't evaluate bindings, treat as reachable
            if (!currentLocation) return true;

            // Target must declare current location as a valid origin ("accessible FROM here")
            if (!location.locationBindings.includes(currentLocation.id)) return false;

            // Check conditional regex gate (e.g., "door is unlocked", "bridge is repaired")
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
 *
 * Directional semantics: "Accessible to [character] from [currentLocation]"
 * First computes structurally reachable locations via `getReachableLocations`,
 * then filters out any locations the character is currently locked out of
 * (via `characterLockedLocations` on their most recent message).
 *
 * @param interactionData - The full interaction state
 * @param character - The character whose reachability is being evaluated
 * @param messageText - Optional text to test against conditional regex triggers
 * @returns Array of locations accessible to this character from their current position
 */
export function getReachableLocationsByCharacter(
    interactionData: InteractionData,
    character: Character,
    messageText?: string,
): { location: Location; locationIndex: number }[] {
    const currentLocationIndex = getCurrentLocationIndex(interactionData, character);
    const locations = interactionData.locations || [];

    const structurallyReachable = getReachableLocations(locations, currentLocationIndex, messageText);

    // Filter out locations this character is locked from
    const lockedLocations = getLatestLockedLocations(interactionData, character.id);

    return structurallyReachable.filter(({ location }) => {
        const lockedChars = lockedLocations[location.id];
        if (!lockedChars || lockedChars.length === 0) return true;
        return !lockedChars.includes(character.id);
    });
}

export function findLocationByRegex(locations: Location[], text: string, character: Character): number | undefined {
    if (!text || !locations.length) return undefined;
    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        const triggers = loc.regularExpressionActivationTriggers;
        if (!triggers || triggers.length === 0) continue;
        if (loc.characterBindings && loc.characterBindings.length > 0 && !loc.characterBindings.includes(character.id)) continue;
        for (const trigger of triggers) {
            if (!trigger.trigger.trim()) continue;
            try {
                const regex = new RegExp(trigger.trigger, 'i');
                if (regex.test(text)) return i;
            } catch {
                console.warn(`Invalid regex on location ${loc.id}: ${trigger.trigger}`);
            }
        }
    }
    return undefined;
}

export function sampleLocationByWeight(locations: Location[], character: Character): number | undefined {
    if (!locations || locations.length === 0) return undefined;
    const pool: { index: number; weight: number }[] = [];
    let totalWeight = 0;
    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        const charWeight = loc.characterWeights?.[character.id];
        const weight = charWeight !== undefined ? charWeight : loc.globalWeight;
        if (weight > 0) { pool.push({ index: i, weight }); totalWeight += weight; }
    }
    if (pool.length === 0 || totalWeight <= 0) return undefined;
    let randomValue = Math.random() * totalWeight;
    for (const entry of pool) { randomValue -= entry.weight; if (randomValue <= 0) return entry.index; }
    return pool[pool.length - 1].index;
}

export function sampleReachableLocationByWeight(
    reachable: { location: Location; locationIndex: number }[],
    character: Character,
): number | undefined {
    if (reachable.length === 0) return undefined;
    const pool: { locationIndex: number; weight: number }[] = [];
    let totalWeight = 0;
    for (const { location, locationIndex } of reachable) {
        const charWeight = location.characterWeights?.[character.id];
        const weight = charWeight !== undefined ? charWeight : location.globalWeight;
        if (weight > 0) { pool.push({ locationIndex, weight }); totalWeight += weight; }
    }
    if (pool.length === 0 || totalWeight <= 0) return undefined;
    let randomValue = Math.random() * totalWeight;
    for (const entry of pool) { randomValue -= entry.weight; if (randomValue <= 0) return entry.locationIndex; }
    return pool[pool.length - 1].locationIndex;
}

export function sampleInitialLocationForCharacter(locations: Location[], character: Character): number | undefined {
    if (!locations || locations.length === 0) return undefined;
    const pool: { index: number; weight: number }[] = [];
    let totalWeight = 0;
    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        if (loc.characterBindings && loc.characterBindings.length > 0 && !loc.characterBindings.includes(character.id)) continue;
        const charWeight = loc.characterWeights?.[character.id];
        const weight = charWeight !== undefined ? charWeight : loc.globalWeight;
        if (weight > 0) { pool.push({ index: i, weight }); totalWeight += weight; }
    }
    if (pool.length === 0 || totalWeight <= 0) return undefined;
    let randomValue = Math.random() * totalWeight;
    for (const entry of pool) { randomValue -= entry.weight; if (randomValue <= 0) return entry.index; }
    return pool[pool.length - 1].index;
}

export function assignInitialLocationsIfNeeded(interactionData: InteractionData): InteractionData {
    const locations = interactionData.locations;
    if (!locations || locations.length === 0) return interactionData;

    const allParticipantIds = new Set<string>();
    // Include all protagonists
    for (const p of interactionData.protagonists) allParticipantIds.add(p.id);
    // Include all AI participants
    for (const p of interactionData.participants) allParticipantIds.add(p.id);

    const newHistory = [...interactionData.interactionHistory];
    const now = Date.now();
    let changed = false;

    const noHistoryAtAll: Character[] = [];
    for (const id of allParticipantIds) {
        // Check protagonists first
        let character = interactionData.protagonists.find(p => p.id === id);
        // Then check participants
        if (!character) character = interactionData.participants.find(p => p.id === id);
        if (!character) continue;

        const lastMsg = findPreviousMessage(interactionData, character.id);
        if (!lastMsg) { noHistoryAtAll.push(character); continue; }
        if (lastMsg.locationIndex !== undefined) continue;

        const locationIndex = sampleInitialLocationForCharacter(locations, character);
        if (locationIndex === undefined) continue;

        for (let i = newHistory.length - 1; i >= 0; i--) {
            if (newHistory[i].character.id === character.id && newHistory[i].locationIndex === undefined) {
                newHistory[i] = { ...newHistory[i], locationIndex };
                changed = true;
                break;
            }
        }
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
            if (pool.length === 0 || totalWeight <= 0) {
                const fallback = remaining.shift()!;
                const locationIndex = sampleInitialLocationForCharacter(locations, fallback);
                if (locationIndex !== undefined) {
                    newHistory.push({
                        messageType: 'interaction', id: uuidv4(), character: { ...fallback },
                        locationIndex,
                        characterClothingWearingStatuses: initializeClothingWearingStatuses(fallback),
                        characterLockedLocations: {},
                        parentInteractionMessageId: null,
                        firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                    });
                    changed = true;
                }
                continue;
            }
            let randomValue = Math.random() * totalWeight;
            let picked: Character | null = null;
            for (const entry of pool) { randomValue -= entry.weight; if (randomValue <= 0) { picked = entry.char; break; } }
            if (!picked) picked = pool[pool.length - 1].char;
            const locationIndex = sampleInitialLocationForCharacter(locations, picked);
            if (locationIndex !== undefined) {
                newHistory.push({
                    messageType: 'interaction', id: uuidv4(), character: { ...picked },
                    locationIndex,
                    characterClothingWearingStatuses: initializeClothingWearingStatuses(picked),
                    characterLockedLocations: {},
                    parentInteractionMessageId: null,
                    firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
                });
                changed = true;
            }
            const idx = remaining.indexOf(picked);
            if (idx !== -1) remaining.splice(idx, 1);
        }
    }

    if (!changed) return interactionData;
    return { ...interactionData, interactionHistory: newHistory, lastUpdatedTimestamp: now };
}

export function isLocationOwner(character: Character, location: Location | undefined): boolean {
    if (!location) return false;
    return location.ownerBindings.includes(character.id);
}