// frontend-src/utilities/protagonistLogic.ts
import type { Character, InteractionData, MultiplayerData } from '../types';

/**
 * Resolves the full Character objects for all protagonists in a chat session.
 * Safely handles the new protagonistIds string array structure.
 */
export function getProtagonists(data: InteractionData | null | undefined): Character[] {
    if (!data || !data.protagonistIds) return [];
    return data.protagonistIds
        .map(id => data.participants.find(p => p.id === id))
        .filter((c): c is Character => !!c);
}

/**
 * Returns the primary (first) protagonist, or null if none exist.
 * Index 0 is strictly treated as the "Primary" or "Active" protagonist.
 */
export function getPrimaryProtagonist(data: InteractionData | null | undefined): Character | null {
    const protagonists = getProtagonists(data);
    return protagonists.length > 0 ? protagonists[0] : null;
}

/**
 * O(N) check to see if a specific character ID is a protagonist in the given session.
 */
export function isProtagonist(data: InteractionData | null | undefined, characterId: string): boolean {
    if (!data || !data.protagonistIds) return false;
    return data.protagonistIds.includes(characterId);
}

/**
 * Unified logic to determine the "active" protagonist for the current user,
 * accounting for multiplayer assignments and fallbacks.
 * 
 * Priority:
 * 1. Multiplayer Override (Account-specific protagonist claim)
 * 2. Primary Protagonist (Index 0 of protagonistIds)
 * 3. Ultimate Fallback (First available participant)
 */
export function deriveCurrentProtagonist(
    interactionData: InteractionData | null | undefined,
    multiplayerData: MultiplayerData | null | undefined,
    currentAccountId: string | null | undefined,
): Character | null {
    if (!interactionData) return null;

    // 1. Multiplayer Override
    if (multiplayerData && currentAccountId) {
        const activeCharId = multiplayerData.multiplayerDataAccountConfigurations?.[currentAccountId]?.protagonistCharacterId;
        if (activeCharId) {
            const found = interactionData.participants.find((p: Character) => p.id === activeCharId);
            if (found) return found;
        }
    }

    // 2. Primary Protagonist Fallback
    const primary = getPrimaryProtagonist(interactionData);
    if (primary) return primary;

    // 3. Ultimate Fallback
    return interactionData.participants?.[0] ?? null;
}