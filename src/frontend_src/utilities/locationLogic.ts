import type { Character, InteractionData, Location, InteractionMessage } from '../types';
import { findLatestMessage, createMessage } from './messageLogic';
import { doesRegularExpressionMatch } from './triggerLogic';
import { weightedSample } from './dynamicCharacterLogic';

export function getCurrentLocationId(interactionData: InteractionData, character: Character): string | undefined {
    return findLatestMessage(interactionData, character)?.locationId;
}

export function getCurrentLocation(interactionData: InteractionData, character: Character): Location | undefined {
    const locationId = getCurrentLocationId(interactionData, character);
    if (!locationId || !interactionData.locations) return undefined;
    return interactionData.locations.find(l => l.id === locationId);
}

export function getCoLocatedParticipants(interactionData: InteractionData, character: Character): Character[] {
    const locationId = getCurrentLocationId(interactionData, character);
    if (!locationId) return [];
    return interactionData.participants.filter(p => p.id !== character.id && getCurrentLocationId(interactionData, p) === locationId);
}

export function getCoLocatedProtagonists(interactionData: InteractionData, character: Character): Character[] {
    const locationId = getCurrentLocationId(interactionData, character);
    if (!locationId) return [];
    const protagIds = new Set(interactionData.protagonistIds || []);
    return interactionData.participants.filter(p => protagIds.has(p.id) && p.id !== character.id && getCurrentLocationId(interactionData, p) === locationId);
}

export function getLatestLockedLocations(interactionData: InteractionData, characterId?: string): Record<string, boolean> {
    const allMessages = Object.values(interactionData.interactionHistories || {}).flat().sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
    const locks: Record<string, boolean> = {};

    for (const msg of allMessages) {
        if (characterId && msg.character.id !== characterId) continue;
        if (msg.characterLockedLocations) {
            for (const [locId, isLocked] of Object.entries(msg.characterLockedLocations)) {
                if (isLocked) locks[locId] = true;
                else delete locks[locId];
            }
        }
    }
    return locks;
}

export function isCharacterLockedFromLocation(interactionData: InteractionData, characterId: string, locationId: string): boolean {
    return getLatestLockedLocations(interactionData, characterId)[locationId] === true;
}

export function getReachableLocations(locations: Location[], currentLocationId: string | undefined, messageText?: string): Location[] {
    const currentLocation = locations.find(l => l.id === currentLocationId);
    if (!currentLocation) return locations.filter(l => !l.locationBindings || l.locationBindings.length === 0);

    return locations.filter(location => {
        if (location.id === currentLocationId) return false;
        const targetHasBindings = !!(location.locationBindings && location.locationBindings.length > 0);
        if (!targetHasBindings) return true;

        const isBound = location.locationBindings!.includes(currentLocation.id) ||
                        (currentLocation.locationBindings?.includes(location.id) ?? false);
        if (!isBound) return false;

        const trigger = location.locationBindingRegularExpressionTriggers?.[currentLocation.id] ||
                        currentLocation.locationBindingRegularExpressionTriggers?.[location.id];
        if (!trigger) return true;
        if (!messageText) return false;

        return doesRegularExpressionMatch(trigger, messageText);
    });
}

export function getReachableLocationsByCharacter(interactionData: InteractionData, character: Character, messageText?: string): Location[] {
    const currentLocationId = getCurrentLocationId(interactionData, character);
    const locations = interactionData.locations || [];
    const structurallyReachable = getReachableLocations(locations, currentLocationId, messageText);
    const lockedLocations = getLatestLockedLocations(interactionData, character.id);

    return structurallyReachable.filter(location => {
        if (location.characterBindings && location.characterBindings.length > 0 && !location.characterBindings.includes(character.id)) {
            return false;
        }
        return lockedLocations[location.id] !== true;
    });
}

export function findLocationByRegularExpression(locations: Location[], text: string, character: Character): Location | undefined {
    if (!text || !locations.length) return undefined;
    for (const loc of locations) {
        const triggers = loc.regularExpressionActivationTriggers;
        if (!triggers || triggers.length === 0) continue;
        if (loc.characterBindings && loc.characterBindings.length > 0 && !loc.characterBindings.includes(character.id)) continue;
        for (const t of triggers) {
            if (t.trigger && doesRegularExpressionMatch(t.trigger, text)) return loc;
        }
    }
    return undefined;
}

export function findReachableLocationByRegularExpression(interactionData: InteractionData, text: string, character: Character): Location | undefined {
    if (!text) return undefined;
    const reachable = getReachableLocationsByCharacter(interactionData, character, text);
    return findLocationByRegularExpression(reachable, text, character);
}

// ─── Consolidated Location Sampling ──────────────────────────────
export function sampleLocationForCharacter(
    locations: Location[],
    character: Character,
    options?: { enforceBindings?: boolean }
): Location | undefined {
    if (!locations || locations.length === 0) return undefined;

    const eligible = options?.enforceBindings
        ? locations.filter(loc => !loc.characterBindings?.length || loc.characterBindings.includes(character.id))
        : locations;

    const pool = eligible
        .map(loc => {
            const charWeight = loc.characterWeights?.[character.id];
            const weight = charWeight !== undefined ? charWeight : (loc.globalWeight || 0);
            return { item: loc, weight: Math.max(0, weight) };
        })
        .filter(entry => entry.weight > 0);

    return weightedSample(pool) ?? undefined;
}

export const sampleLocationByWeight = (locs: Location[], c: Character) => sampleLocationForCharacter(locs, c);
export const sampleReachableLocationByWeight = (locs: Location[], c: Character) => sampleLocationForCharacter(locs, c);
export const sampleInitialLocationForCharacter = (locs: Location[], c: Character) => sampleLocationForCharacter(locs, c, { enforceBindings: true });

export function assignInitialLocationsIfNeeded(interactionData: InteractionData): InteractionData {
    const locations = interactionData.locations;
    if (!locations || locations.length === 0) return interactionData;

    const allParticipantIds = new Set<string>();
    for (const id of (interactionData.protagonistIds || [])) allParticipantIds.add(id);
    for (const p of interactionData.participants) allParticipantIds.add(p.id);

    const updatedHistories = { ...interactionData.interactionHistories };
    let changed = false;
    let sequenceTime = Date.now();

    const noHistoryAtAll = Array.from(allParticipantIds)
        .map(id => interactionData.participants.find(p => p.id === id))
        .filter((c): c is Character => !!c && !findLatestMessage(interactionData, c));

    if (noHistoryAtAll.length > 0) {
        const remaining = [...noHistoryAtAll];
        while (remaining.length > 0) {
            sequenceTime++;
            const charPool = remaining.map(c => ({ item: c, weight: Math.max(0, c.initiativeWeight ?? 1) }));
            const picked = weightedSample(charPool) ?? remaining[0];
            const idx = remaining.indexOf(picked);
            if (idx !== -1) remaining.splice(idx, 1);

            const sampledLocation = sampleLocationForCharacter(locations, picked, { enforceBindings: true });
            if (sampledLocation) {
                if (!updatedHistories[sampledLocation.id]) updatedHistories[sampledLocation.id] = [];
                const allMsgs = Object.values(updatedHistories).flat().sort((a, b) => a.firstCreatedTimestamp - b.firstCreatedTimestamp);
                const lastMessageId = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1].id : null;

                const initMsg = createMessage(picked, {
                    messageType: 'interaction',
                    parentMessageId: lastMessageId,
                    timestamp: sequenceTime,
                    interactionData: { ...interactionData, interactionHistories: updatedHistories },
                }) as InteractionMessage;

                updatedHistories[sampledLocation.id].push(initMsg);
                changed = true;
            }
        }
    }

    if (!changed) return interactionData;
    return { ...interactionData, interactionHistories: updatedHistories, lastUpdatedTimestamp: sequenceTime };
}

export function isLocationOwner(character: Character, location: Location | undefined): boolean {
    return Boolean(location?.ownerBindings?.includes(character.id));
}