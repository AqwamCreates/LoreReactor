// src/utilities/chatSaveHelper.ts
import type { InteractionData, Character } from '../types';

export function isChatSaveable(data: InteractionData | null): boolean {
    if (!data) return false;

    // 1. Save if any messages exist (user, AI, actions, etc.)
    // FIX: Replaced the non-existent flat `interactionHistory` array with a check 
    // across the spatially-partitioned `interactionHistories` Record.
    const hasMessages = Object.values(data.interactionHistories || {}).some(messages => messages.length > 0);
    if (hasMessages) {
        return true;
    }

    // 2. Save if any contexts are attached
    if (data.contexts && data.contexts.length > 0) {
        return true;
    }

    // 3. Save if any locations are attached
    if (data.locations && data.locations.length > 0) {
        return true;
    }

    // 4. Save if any audio tracks are attached
    if (data.audioTracks && data.audioTracks.length > 0) {
        return true;
    }

    // 5. Save if characters/participants were added beyond the initial protagonist
    const protagonistIds = new Set(data.protagonists?.map((p: Character) => p.id) ?? []);
    const nonProtagonistParticipants = data.participants?.filter((p: Character) => !protagonistIds.has(p.id)) ?? [];

    // If more than 1 protagonist exists, or if extra participants exist:
    if (nonProtagonistParticipants.length > 0 || (data.protagonists?.length ?? 0) > 1) {
        return true;
    }

    // Initial protagonist and initial profile alone do NOT trigger saving
    return false;
}