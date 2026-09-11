// src/hooks/locationLogic.ts
import type { Character, InteractionData, Location } from '../types';
import { findPreviousMessage } from './chatLogic';
import { v4 as uuidv4 } from 'uuid';


/**
 * Get the current location index for a character from their last interaction entry.
 */
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

/**
 * Find a location by matching text against its regex activation trigger.
 * Returns the index in the locations array, or undefined if no match.
 */
export function findLocationByRegex(locations: Location[], text: string, character: Character): number | undefined {
    if (!text || !locations.length) return undefined;

    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        if (!loc.regularExpressionActivationTrigger) continue;

        // Check character bindings — only match if character is bound or no bindings exist
        if (loc.characterBindings && loc.characterBindings.length > 0 && !loc.characterBindings.includes(character.id)) {
            continue;
        }

        try {
            const regex = new RegExp(loc.regularExpressionActivationTrigger, 'i');
            if (regex.test(text)) return i;
        } catch {
            console.warn(`Invalid regex on location ${loc.id}: ${loc.regularExpressionActivationTrigger}`);
        }
    }

    return undefined;
}

/**
 * Sample a location by weight from all locations (unfiltered).
 * Returns the index in the locations array, or undefined if no valid targets.
 */
export function sampleLocationByWeight(locations: Location[], character: Character): number | undefined {
    if (!locations || locations.length === 0) return undefined;

    const pool: { index: number; weight: number }[] = [];
    let totalWeight = 0;

    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        const charWeight = loc.characterWeights?.[character.id];
        const weight = charWeight !== undefined ? charWeight : loc.globalWeight;
        if (weight > 0) {
            pool.push({ index: i, weight });
            totalWeight += weight;
        }
    }

    if (pool.length === 0 || totalWeight <= 0) return undefined;

    let Dice = Math.random() * totalWeight;
    for (const entry of pool) {
        Dice -= entry.weight;
        if (Dice <= 0) return entry.index;
    }

    return pool[pool.length - 1].index;
}

/**
 * Filter locations to only those reachable from the character's current location.
 * A location is reachable if:
 * - Its locationBindings array is empty or undefined (unrestricted)
 * - The character's current location ID is in its locationBindings AND
 *   either no conditional regex is set for that binding, or the message text matches it
 * - The character has no current location (fallback to unrestricted)
 */
export function getReachableLocations(
    locations: Location[],
    currentLocationIndex: number | undefined,
    messageText?: string,
): { location: Location; originalIndex: number }[] {
    const currentLocation = currentLocationIndex !== undefined ? locations[currentLocationIndex] : undefined;

    return locations
        .map((loc, i) => ({ location: loc, originalIndex: i }))
        .filter(({ location }) => {
            // No bindings = always reachable
            if (!location.locationBindings || location.locationBindings.length === 0) return true;

            // No current location = fallback to unrestricted
            if (!currentLocation) return true;

            // Check if current location is in bindings
            if (!location.locationBindings.includes(currentLocation.id)) return false;

            // Check conditional regex trigger for this specific binding
            const conditionalRegex = location.locationBindingRegularExpressionTriggers?.[currentLocation.id];
            if (!conditionalRegex || !conditionalRegex.trim()) return true; // Unconditional binding

            // Conditional binding — must match message text
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
 * Sample a location by weight from a pre-filtered list of reachable locations.
 * Returns the original index in the full locations array, or undefined if no valid targets.
 */
export function sampleReachableLocationByWeight(
    reachable: { location: Location; originalIndex: number }[],
    character: Character,
): number | undefined {
    if (reachable.length === 0) return undefined;

    const pool: { originalIndex: number; weight: number }[] = [];
    let totalWeight = 0;

    for (const { location, originalIndex } of reachable) {
        const charWeight = location.characterWeights?.[character.id];
        const weight = charWeight !== undefined ? charWeight : location.globalWeight;
        if (weight > 0) {
            pool.push({ originalIndex, weight });
            totalWeight += weight;
        }
    }

    if (pool.length === 0 || totalWeight <= 0) return undefined;

    let Dice = Math.random() * totalWeight;
    for (const entry of pool) {
        Dice -= entry.weight;
        if (Dice <= 0) return entry.originalIndex;
    }

    return pool[pool.length - 1].originalIndex;
}

/**
 * Sample an initial location for a character who has never had one.
 * Excludes locations with characterBindings that don't include this character.
 * Uses characterWeights when available, falls back to globalWeight.
 */
export function sampleInitialLocationForCharacter(locations: Location[], character: Character): number | undefined {
    if (!locations || locations.length === 0) return undefined;

    const pool: { index: number; weight: number }[] = [];
    let totalWeight = 0;

    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];

        // Exclude locations bound to specific characters that don't include this one
        if (loc.characterBindings && loc.characterBindings.length > 0 && !loc.characterBindings.includes(character.id)) {
            continue;
        }

        // Use character-specific weight if defined, otherwise global weight
        const charWeight = loc.characterWeights?.[character.id];
        const weight = charWeight !== undefined ? charWeight : loc.globalWeight;

        if (weight > 0) {
            pool.push({ index: i, weight });
            totalWeight += weight;
        }
    }

    if (pool.length === 0 || totalWeight <= 0) return undefined;

    let Dice = Math.random() * totalWeight;
    for (const entry of pool) {
        Dice -= entry.weight;
        if (Dice <= 0) return entry.index;
    }

    return pool[pool.length - 1].index;
}

/**
 * Assign initial locations to all participants who have never had one.
 * Runs at any point — checks per-character whether they have a location entry
 * in history, not whether history itself is empty.
 * Uses character-bound locations with characterWeights first,
 * falls back to globalWeight sampling.
 */
/**
 * Assign initial locations to all participants who have never had one.
 * Also backfills missing locations for characters who have history entries
 * but no locationIndex on their last entry.
 * Uses character-bound locations with characterWeights first,
 * falls back to globalWeight sampling.
 */
export function assignInitialLocationsIfNeeded(interactionData: InteractionData): InteractionData {
    const locations = interactionData.locations;
    if (!locations || locations.length === 0) return interactionData;

    // Collect all participant IDs
    const allParticipantIds = new Set<string>();
    allParticipantIds.add(interactionData.protagonist.id);
    for (const p of interactionData.participants) allParticipantIds.add(p.id);

    const newHistory = [...interactionData.interactionHistory];
    const now = Date.now();
    let changed = false;

    // Phase 1: Patch existing entries that have undefined locationIndex
    const noHistoryAtAll: Character[] = [];
    for (const id of allParticipantIds) {
        const character = id === interactionData.protagonist.id
            ? interactionData.protagonist
            : interactionData.participants.find(p => p.id === id);
        if (!character) continue;

        const lastMsg = findPreviousMessage(interactionData, character.id);

        if (!lastMsg) {
            // No previous message at all — goes to sampling pool
            noHistoryAtAll.push(character);
            continue;
        }

        if (lastMsg.locationIndex !== undefined) continue;

        // Has a previous message but no locationIndex — assign and patch in place
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

    // Phase 2: Sample remaining characters (no history at all) by initiative weight
    if (noHistoryAtAll.length > 0) {
        const remaining = [...noHistoryAtAll];
        while (remaining.length > 0) {
            const pool: { char: Character; weight: number }[] = [];
            let totalWeight = 0;
            for (const c of remaining) {
                const w = c.initiativeWeight ?? 1;
                if (w > 0) {
                    pool.push({ char: c, weight: w });
                    totalWeight += w;
                }
            }

            if (pool.length === 0 || totalWeight <= 0) {
                // Fallback: take first remaining
                const fallback = remaining.shift()!;
                const locationIndex = sampleInitialLocationForCharacter(locations, fallback);
                if (locationIndex !== undefined) {
                    newHistory.push({
                        messageType: 'interaction',
                        id: uuidv4(),
                        character: { ...fallback },
                        locationIndex,
                        parentInteractionMessageId: null,
                        firstCreatedTimestamp: now,
                        lastUpdatedTimestamp: now,
                    });
                    changed = true;
                }
                continue;
            }

            let Dice = Math.random() * totalWeight;
            let picked: Character | null = null;
            for (const entry of pool) {
                Dice -= entry.weight;
                if (Dice <= 0) { picked = entry.char; break; }
            }
            if (!picked) picked = pool[pool.length - 1].char;

            const locationIndex = sampleInitialLocationForCharacter(locations, picked);
            if (locationIndex !== undefined) {
                newHistory.push({
                    messageType: 'interaction',
                    id: uuidv4(),
                    character: { ...picked },
                    locationIndex,
                    parentInteractionMessageId: null,
                    firstCreatedTimestamp: now,
                    lastUpdatedTimestamp: now,
                });
                changed = true;
            }

            const idx = remaining.indexOf(picked);
            if (idx !== -1) remaining.splice(idx, 1);
        }
    }

    if (!changed) return interactionData;

    return {
        ...interactionData,
        interactionHistory: newHistory,
        lastUpdatedTimestamp: now,
    };
}