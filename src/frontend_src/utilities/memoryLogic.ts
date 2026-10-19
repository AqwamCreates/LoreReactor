import type {
  Character,
  InteractionData,
  RawInteractionData,
  Memory,
  memorySearchSpace,
} from '../types';
import { getCurrentLocationId } from './locationLogic';
import { getLocalMessageHistory } from './timelineLogic';
import { embeddingEngine } from '../services/EmbeddingEngine';
import { retrieveRelevantContext, type RetrievableItem } from '../services/RetrievalEngine';

/**
 * Resolves participant display tag (e.g. "Character 1").
 * Inlined to prevent circular dependency with promptLogic.
 */
function getParticipantTag(character: Character, participants: Character[]): string {
  const index = participants.findIndex(p => p.id === character.id);
  return index !== -1 ? `Character ${index + 1}` : 'Unknown';
}

/**
 * Resolves known name from character and knownNames map.
 */
function getKnownDisplayName(
  targetChar: Character,
  knownNames?: Record<string, Record<string, boolean>>,
): string | null {
  if (!knownNames) return null;
  const candidates = [targetChar.name, ...(targetChar.aliases ?? [])];
  const knownMap = knownNames[targetChar.id];
  if (!knownMap) return null;

  for (const candidate of candidates) {
    if (knownMap[candidate]) return candidate;
  }
  return null;
}

/**
 * Replaces runtime index tags ("Character 1", "Character 2") with immutable "{{character@uuid}}" tokens.
 * Call this immediately before saving a new memory string to RawMemory.
 */
export function tokenizeMemoryContent(
  text: string,
  participants: Character[],
): string {
  if (!text || participants.length === 0) return text;

  let tokenized = text;

  // Process in reverse numerical order so "Character 10" is replaced before "Character 1"
  const indexedParticipants = participants
    .map((p, idx) => ({ p, tagNumber: idx + 1 }))
    .sort((a, b) => b.tagNumber - a.tagNumber);

  for (const { p, tagNumber } of indexedParticipants) {
    const regex = new RegExp(`\\bCharacter\\s+${tagNumber}\\b`, 'g');
    tokenized = tokenized.replace(regex, `{{character@${p.id}}}`);
  }

  return tokenized;
}

/**
 * Resolves "{{character@uuid}}" tokens back into the current turn's participant tags/names.
 * Call this before injecting retrieved memories into prompts or returning them from tools.
 */
export function detokenizeMemoryContent(
  text: string,
  currentParticipants: Character[],
  knownNames?: Record<string, Record<string, boolean>>,
): string {
  if (!text) return text;

  const TOKEN_REGEX = /\{\{character@([a-zA-Z0-9-]+)\}\}/g;

  return text.replace(TOKEN_REGEX, (_match, uuid: string) => {
    const participant = currentParticipants.find(p => p.id === uuid);

    if (!participant) {
      return 'Unknown';
    }

    const tag = getParticipantTag(participant, currentParticipants);
    const knownName = getKnownDisplayName(participant, knownNames);
    const displayName = knownName ?? participant.name;

    // Detect if multiple characters in current session share the exact same name
    const hasNameCollision = currentParticipants.filter(p => p.name === participant.name).length > 1;

    if (hasNameCollision) {
      return `${tag} (${displayName})`;
    }

    return displayName ? `${tag} (${displayName})` : tag;
  });
}

export interface TurnSearchTargets {
  selfId: string;
  listenerId?: string;
  coLocatedProtagonistIds: Set<string>;
  nonCoLocatedProtagonistIds: Set<string>;
  coLocatedNonProtagonistIds: Set<string>;
  nonCoLocatedNonProtagonistIds: Set<string>;
}

/**
 * Computes the 6 target entity sets for the active turn.
 */
export function resolveTurnSearchTargets(
  interactionData: InteractionData,
  character: Character,
): TurnSearchTargets {
  const selfId = character.id;
  const currentLocationId = getCurrentLocationId(interactionData, character);
  const protagonistIds = new Set(interactionData.protagonistIds || []);
  const participants = interactionData.participants || [];

  const coLocatedProtagonistIds = new Set<string>();
  const nonCoLocatedProtagonistIds = new Set<string>();
  const coLocatedNonProtagonistIds = new Set<string>();
  const nonCoLocatedNonProtagonistIds = new Set<string>();

  for (const p of participants) {
    const isSelf = p.id === selfId;
    const isProtag = protagonistIds.has(p.id);
    const pLocId = getCurrentLocationId(interactionData, p);
    const isCoLocated = pLocId !== undefined && pLocId === currentLocationId;

    if (isProtag) {
      if (isCoLocated) {
        coLocatedProtagonistIds.add(p.id);
      } else {
        nonCoLocatedProtagonistIds.add(p.id);
      }
    } else if (!isSelf) {
      // Strictly other NPCs (Self is NEVER in non-protagonist sets)
      if (isCoLocated) {
        coLocatedNonProtagonistIds.add(p.id);
      } else {
        nonCoLocatedNonProtagonistIds.add(p.id);
      }
    }
  }

  // Derive listener: previous speaker in local history before this character's turn
  let listenerId: string | undefined = undefined;
  const localHistory = getLocalMessageHistory(interactionData, character, ['chat', 'whisper']);

  for (let i = localHistory.length - 1; i >= 0; i--) {
    const msg = localHistory[i];
    if (msg.character.id !== selfId) {
      listenerId = msg.character.id;
      break;
    }
  }

  return {
    selfId,
    listenerId,
    coLocatedProtagonistIds,
    nonCoLocatedProtagonistIds,
    coLocatedNonProtagonistIds,
    nonCoLocatedNonProtagonistIds,
  };
}

/**
 * Builds an O(1) lookup map from interactionDataId to participant and protagonist sets.
 */
export function buildSessionLookupMap(
  allSessions?: (InteractionData | RawInteractionData)[],
): Map<string, { protagonistIds: Set<string>; participantIds: Set<string> }> {
  const map = new Map<string, { protagonistIds: Set<string>; participantIds: Set<string> }>();

  if (!allSessions || allSessions.length === 0) return map;

  for (const session of allSessions) {
    if (!session.id) continue;

    const protagonistIds = new Set<string>(session.protagonistIds || []);
    let participantIds = new Set<string>();

    if ('participants' in session && Array.isArray((session as InteractionData).participants)) {
      participantIds = new Set((session as InteractionData).participants.map(p => p.id));
    } else if ('participantIds' in session && Array.isArray((session as RawInteractionData).participantIds)) {
      participantIds = new Set((session as RawInteractionData).participantIds);
    }

    map.set(session.id, { protagonistIds, participantIds });
  }

  return map;
}

/**
 * Resolves the entity footprint of a memory.
 */
export function resolveMemoryParticipants(
  memory: Memory,
  characterId: string,
  sessionMap: Map<string, { protagonistIds: Set<string>; participantIds: Set<string> }>,
  memoryDictKey?: string,
): { protagonistIds: Set<string>; participantIds: Set<string>; isSelfOnly: boolean } {
  if (memory.interactionDataId && sessionMap.has(memory.interactionDataId)) {
    const session = sessionMap.get(memory.interactionDataId)!;
    const isSelfOnly = session.participantIds.size === 1 && session.participantIds.has(characterId);
    return {
      protagonistIds: session.protagonistIds,
      participantIds: session.participantIds,
      isSelfOnly,
    };
  }

  // Fallback for manually authored memories lacking interactionDataId
  if (memoryDictKey) {
    if (memoryDictKey === characterId || memoryDictKey === 'self') {
      return {
        protagonistIds: new Set<string>(),
        participantIds: new Set<string>([characterId]),
        isSelfOnly: true,
      };
    }

    return {
      protagonistIds: new Set<string>([memoryDictKey]),
      participantIds: new Set<string>([characterId, memoryDictKey]),
      isSelfOnly: false,
    };
  }

  // Pure self fallback if no metadata exists
  return {
    protagonistIds: new Set<string>(),
    participantIds: new Set<string>([characterId]),
    isSelfOnly: true,
  };
}

/**
 * Evaluates whether a memory intersects with any of the active memorySearchSpaces.
 */
export function isMemoryEligible(
  memory: Memory,
  characterId: string,
  activeSpaces: memorySearchSpace[],
  targets: TurnSearchTargets,
  sessionMap: Map<string, { protagonistIds: Set<string>; participantIds: Set<string> }>,
  memoryDictKey?: string,
): boolean {
  if (activeSpaces.length === 0) return false;

  const { protagonistIds, participantIds, isSelfOnly } = resolveMemoryParticipants(
    memory,
    characterId,
    sessionMap,
    memoryDictKey,
  );

  for (const space of activeSpaces) {
    if (space === 'self') {
      if (isSelfOnly) return true;
    }

    if (space === 'listener') {
      if (targets.listenerId && participantIds.has(targets.listenerId)) return true;
    }

    if (space === 'co-located protagonists') {
      for (const pId of targets.coLocatedProtagonistIds) {
        if (protagonistIds.has(pId) || participantIds.has(pId)) return true;
      }
    }

    if (space === 'non-co-located protagonists') {
      for (const pId of targets.nonCoLocatedProtagonistIds) {
        if (protagonistIds.has(pId) || participantIds.has(pId)) return true;
      }
    }

    if (space === 'co-located non-protagonists') {
      for (const npcId of targets.coLocatedNonProtagonistIds) {
        if (participantIds.has(npcId)) return true;
      }
    }

    if (space === 'non-co-located non-protagonists') {
      for (const npcId of targets.nonCoLocatedNonProtagonistIds) {
        if (participantIds.has(npcId)) return true;
      }
    }
  }

  return false;
}

/**
 * Filters all memories belonging to the character down to eligible candidates based on memorySearchSpaces.
 */
export function filterMemoriesBySearchSpace(
  character: Character,
  interactionData: InteractionData,
  allRawInteractionDataShells: RawInteractionData[],
): Memory[] {
  const activeSpaces = character.memorySearchSpaces || [];
  if (activeSpaces.length === 0) return [];

  const targets = resolveTurnSearchTargets(interactionData, character);
  const sessionMap = buildSessionLookupMap(allRawInteractionDataShells);

  // Guarantee current session is present in the lookup map
  if (interactionData.id && !sessionMap.has(interactionData.id)) {
    sessionMap.set(interactionData.id, {
      protagonistIds: new Set(interactionData.protagonistIds || []),
      participantIds: new Set((interactionData.participants || []).map(p => p.id)),
    });
  }

  const memoriesDict = character.memories || {};
  const eligibleMemories: Memory[] = [];

  for (const [dictKey, memoryList] of Object.entries(memoriesDict)) {
    for (const memory of memoryList) {
      if (isMemoryEligible(memory, character.id, activeSpaces, targets, sessionMap, dictKey)) {
        eligibleMemories.push(memory);
      }
    }
  }

  return eligibleMemories;
}

/**
 * Complete retrieval and detokenization pipeline for memories.
 * Shared between promptLogic (buildMemoryPromptText) and ToolExecutor (memory tool).
 */
export async function retrieveEligibleMemories(
  character: Character,
  interactionData: InteractionData,
  queryText: string,
  allRawInteractionDataShells: RawInteractionData[],
  knownNames?: Record<string, Record<string, boolean>>,
): Promise<string> {
  const eligibleMemories = filterMemoriesBySearchSpace(character, interactionData, allRawInteractionDataShells);
  if (eligibleMemories.length === 0) return '';

  if (character.useEmbeddingModelForMemories && character.memoryRetrievalConfiguration && queryText) {
    const queryVector = await embeddingEngine.embed(queryText);

    if (queryVector) {
      const items: RetrievableItem[] = eligibleMemories.map(m => ({
        id: m.id,
        name: m.name,
        textContent: m.textContent,
        embedding: m.embedding,
        firstCreatedTimestamp: m.firstCreatedTimestamp,
      }));

      const results = await retrieveRelevantContext(
        queryVector,
        queryText,
        items,
        character.memoryRetrievalConfiguration,
      );

      if (results.length > 0) {
        return results
          .map(r => detokenizeMemoryContent(r.textContent, interactionData.participants, knownNames))
          .join('\n---\n');
      }
    }
  }

  // Fallback when embeddings are disabled: return all eligible memories detokenized
  return eligibleMemories
    .map(m => detokenizeMemoryContent(m.textContent, interactionData.participants, knownNames))
    .join('\n---\n');
}