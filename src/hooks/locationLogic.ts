import type { Character, InteractionData, Location } from '../types';

/**
 * Get the current location index for a character from their last interaction entry.
 */
export function getCurrentLocationIndex(data: InteractionData, character: Character): number | undefined {
    const interactionHistory = data.interactionHistory
    for (let i = interactionHistory.length - 1; i >= 0; i--) {
        if (interactionHistory[i].character.id === character.id && interactionHistory[i].locationIndex !== undefined) {
            return interactionHistory[i].locationIndex;
        }
    }
    return undefined;
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

    let roll = Math.random() * totalWeight;
    for (const entry of pool) {
        roll -= entry.weight;
        if (roll <= 0) return entry.index;
    }

    return pool[pool.length - 1].index;
}

/**
 * Filter locations to only those reachable from the character's current location.
 * A location is reachable if:
 * - Its locationBindings array is empty or undefined (unrestricted)
 * - The character's current location ID is in its locationBindings
 * - The character has no current location (fallback to unrestricted)
 */
export function getReachableLocations(
    locations: Location[],
    currentLocationIndex: number | undefined,
): { location: Location; originalIndex: number }[] {
    const currentLocation = currentLocationIndex !== undefined ? locations[currentLocationIndex] : undefined;

    return locations
        .map((loc, i) => ({ location: loc, originalIndex: i }))
        .filter(({ location }) => {
            if (!location.locationBindings || location.locationBindings.length === 0) return true;
            if (!currentLocation) return true;
            return location.locationBindings.includes(currentLocation.id);
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

    let roll = Math.random() * totalWeight;
    for (const entry of pool) {
        roll -= entry.weight;
        if (roll <= 0) return entry.originalIndex;
    }

    return pool[pool.length - 1].originalIndex;
}