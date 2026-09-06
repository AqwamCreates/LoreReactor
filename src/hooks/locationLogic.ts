import type { Character, InteractionData, Location } from "../types";

/**
 * Get the current location index for a character by finding their most recent message.
 * Returns undefined if the character has never spoken.
 */
export function getCurrentLocationIndex(interactionData: InteractionData, character: Character): number | undefined {
  const characterId = character.id
  for (let i = interactionData.interactionHistory.length - 1; i >= 0; i--) {
    if (interactionData.interactionHistory[i].character.id === characterId) {
      return interactionData.interactionHistory[i].locationIndex;
    }
  }
  return undefined;
}

/**
 * Check if two characters are currently at the same location.
 * Returns false if either character has no known location.
 */
export function areCharactersCoLocated(interactionData: InteractionData, characterA: Character, characterB: Character): boolean {
  const locA = getCurrentLocationIndex(interactionData, characterA);
  const locB = getCurrentLocationIndex(interactionData, characterB);
  if (locA === undefined || locB === undefined) return false;
  return locA === locB;
}

/**
 * Sample a location index from weights for a given character.
 * Uses characterWeights if available for that character, otherwise globalWeight.
 * Returns undefined if no locations exist.
 */
export function sampleLocationByWeight(locations: Location[], character: Character): number | undefined {
    if (locations.length === 0) return undefined;

    const characterId = character.id

    const pool: { index: number; weight: number }[] = [];
    let totalWeight = 0;

    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i] as Location;
        // Check character bindings — if bindings exist, only include if character is bound
        if (loc.characterBindings && loc.characterBindings.length > 0) {
        if (!loc.characterBindings.includes(characterId)) continue;
        }
        const charWeight = loc.characterWeights?.[characterId];
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
 * Find a location index by matching regex against text.
 * Returns the first matching location's index, or undefined if no match.
 */
export function findLocationByRegex(locations: Location[], text: string, character: Character): number | undefined {
  const characterId = character.id
  for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        if (!loc.regularExpressionActivationTrigger) continue;
        // Check character bindings
        if (loc.characterBindings && loc.characterBindings.length > 0) {
        if (!loc.characterBindings.includes(characterId)) continue;
        }
        try {
        const regex = new RegExp(loc.regularExpressionActivationTrigger);
        if (regex.test(text)) return i;
        } catch {
        // Invalid regex, skip
        }
    }
    return undefined;
}