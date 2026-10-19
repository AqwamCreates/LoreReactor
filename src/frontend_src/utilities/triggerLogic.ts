// src/frontend_src/utilities/triggerLogic.ts
import type {
  RegularExpressionTrigger,
  regularExpressionContext,
  regularExpressionTarget,
} from '../types';

export type CombinationCache = Record<string, Record<string, { characterIdArray: string[]; textContentArray: string[] }>>;

export interface TriggerEvaluationContext {
  characterIdArray: string[];
  textContentArray: string[];
  selectedCharacterId: string;
  protagonistIds: string[];
  fallbackSearchSpace?: string;
  combinationCache?: CombinationCache;
  sensitivityMultiplier?: number;
}

export function doesRegularExpressionMatch(regexString: string | undefined, searchSpace: string, sensitivityMultiplier = 1): boolean {
  if (!regexString) return true;
  try {
    const regex = new RegExp(regexString);
    const matched = regex.test(searchSpace);
    if (!matched) return false;
    if (sensitivityMultiplier >= 1) return true;
    return Math.random() < sensitivityMultiplier;
  } catch (e) {
    console.warn(`Invalid regex: ${regexString}`, e);
    return false;
  }
}

export function filterArrayBasedOnContext(
  characterIdArray: string[],
  textContentArray: string[],
  selectedCharacterId: string,
  contextType: regularExpressionContext
): { characterIdArray: string[]; textContentArray: string[] } {
  const length = characterIdArray.length;
  if (length === 0) return { characterIdArray: [], textContentArray: [] };
  if (contextType === "global") return { characterIdArray, textContentArray };
  if (contextType === "previous") {
    for (let i = length - 1; i >= 0; i--) {
      if (characterIdArray[i] === selectedCharacterId) {
        return { characterIdArray: [characterIdArray[i]], textContentArray: [textContentArray[i]] };
      }
    }
    return { characterIdArray: [], textContentArray: [] };
  }
  if (contextType === "local") {
    let targetIndex = -1;
    const endIndex = length - 1;
    for (let i = endIndex; i >= 0; i--) {
      if ((characterIdArray[i] === selectedCharacterId) && (i === endIndex)) continue;
      if ((characterIdArray[i] !== selectedCharacterId) && (i === endIndex)) {
        targetIndex = i;
        break;
      }
      if ((characterIdArray[i] === selectedCharacterId) && (characterIdArray[i + 1] !== selectedCharacterId)) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) return { characterIdArray: [], textContentArray: [] };
    const startIndex = targetIndex + 1;
    if (startIndex >= length) return { characterIdArray: [], textContentArray: [] };
    return {
      characterIdArray: characterIdArray.slice(startIndex),
      textContentArray: textContentArray.slice(startIndex)
    };
  }
  return { characterIdArray: [], textContentArray: [] };
}

export function filterArrayBasedOnTarget(
  characterIdArray: string[],
  textContentArray: string[],
  selectedCharacterId: string,
  targetType: regularExpressionTarget,
  protagonistIds: string[],
): { characterIdArray: string[]; textContentArray: string[] } {
  const length = characterIdArray.length;
  if (length === 0 || targetType === "everyone") return { characterIdArray, textContentArray };
  if (targetType === "listener") {
    for (let i = length - 1; i >= 0; i--) {
      if (characterIdArray[i] !== selectedCharacterId) {
        return { characterIdArray: [characterIdArray[i]], textContentArray: [textContentArray[i]] };
      }
    }
    return { characterIdArray: [], textContentArray: [] };
  }
  const protagonistIdSet = new Set(protagonistIds);
  const matchesTarget: Record<Exclude<regularExpressionTarget, 'everyone' | 'listener'>, (id: string) => boolean> = {
    'self': (id) => id === selectedCharacterId,
    'protagonist': (id) => protagonistIdSet.has(id),
    'non-protagonist': (id) => !protagonistIdSet.has(id),
    'narrator': () => false, // Narrator messages are filtered out by the caller before reaching this logic
  };
  const predicate = matchesTarget[targetType];
  if (!predicate) return { characterIdArray: [], textContentArray: [] };
  const extractedCharacterIdArray: string[] = [];
  const extractedTextContentArray: string[] = [];
  for (let i = 0; i < length; i++) {
    if (predicate(characterIdArray[i])) {
      extractedCharacterIdArray.push(characterIdArray[i]);
      extractedTextContentArray.push(textContentArray[i]);
    }
  }
  return {
    characterIdArray: extractedCharacterIdArray,
    textContentArray: extractedTextContentArray
  };
}

export function getFilteredIndices(
  characterIdArray: string[],
  selectedCharacterId: string,
  contextType: regularExpressionContext,
  targetType: regularExpressionTarget,
  protagonistIds: string[],
): number[] {
  const length = characterIdArray.length;
  if (length === 0) return [];
  let indices: number[] = [];
  if (contextType === 'global') {
    indices = Array.from({ length }, (_, i) => i);
  } else if (contextType === 'previous') {
    for (let i = length - 1; i >= 0; i--) {
      if (characterIdArray[i] === selectedCharacterId) return [i];
    }
    return [];
  } else if (contextType === 'local') {
    let targetIndex = -1;
    const endIndex = length - 1;
    for (let i = endIndex; i >= 0; i--) {
      if ((characterIdArray[i] === selectedCharacterId) && (i === endIndex)) continue;
      if ((characterIdArray[i] !== selectedCharacterId) && (i === endIndex)) {
        targetIndex = i;
        break;
      }
      if ((characterIdArray[i] === selectedCharacterId) && (characterIdArray[i + 1] !== selectedCharacterId)) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) return [];
    const startIndex = targetIndex + 1;
    if (startIndex >= length) return [];
    indices = Array.from({ length: length - startIndex }, (_, k) => startIndex + k);
  } else {
    return [];
  }
  if (targetType === 'everyone') return indices;
  if (targetType === 'listener') {
    for (let i = indices.length - 1; i >= 0; i--) {
      const idx = indices[i];
      if (characterIdArray[idx] !== selectedCharacterId) return [idx];
    }
    return [];
  }
  const protagonistIdSet = new Set(protagonistIds);
  const matchesTarget: Record<Exclude<regularExpressionTarget, 'everyone' | 'listener'>, (id: string) => boolean> = {
    self: (id) => id === selectedCharacterId,
    protagonist: (id) => protagonistIdSet.has(id),
    'non-protagonist': (id) => !protagonistIdSet.has(id),
    narrator: () => false, // Narrator messages are filtered out by the caller before reaching this logic
  };
  const predicate = matchesTarget[targetType as Exclude<regularExpressionTarget, 'everyone' | 'listener'>];
  if (!predicate) return [];
  return indices.filter((idx) => predicate(characterIdArray[idx]));
}

export function getFilteredDataCached(
  cache: CombinationCache,
  characterIdArray: string[],
  textContentArray: string[],
  characterId: string,
  protagonistIds: string[],
  ctxType: regularExpressionContext,
  tgtType: regularExpressionTarget,
): { characterIdArray: string[]; textContentArray: string[] } {
  const cacheKey = protagonistIds.join(',');
  if (!cache[ctxType]) cache[ctxType] = {};
  const subCache = cache[ctxType];
  if (!subCache[`${tgtType}:${cacheKey}`]) {
    const step1 = filterArrayBasedOnContext(characterIdArray, textContentArray, characterId, ctxType);
    const step2 = filterArrayBasedOnTarget(step1.characterIdArray, step1.textContentArray, characterId, tgtType, protagonistIds);
    subCache[`${tgtType}:${cacheKey}`] = step2;
  }
  return subCache[`${tgtType}:${cacheKey}`];
}

export function doesAnyTriggerMatchCached(
  triggers: RegularExpressionTrigger[] | undefined,
  characterIdArray: string[],
  textContentArray: string[],
  selectedCharacterId: string,
  protagonistIds: string[],
  fallbackSearchSpace: string,
  combinationCache: CombinationCache,
  sensitivityMultiplier?: number,
): boolean {
  if (!triggers || triggers.length === 0) return false;
  for (const trigger of triggers) {
    if (!trigger.trigger) continue;
    const { textContentArray: filteredTexts } = getFilteredDataCached(
      combinationCache,
      characterIdArray,
      textContentArray,
      selectedCharacterId,
      protagonistIds,
      trigger.context || 'global',
      trigger.target || 'everyone'
    );
    const searchSpace = filteredTexts.length > 0
      ? `${filteredTexts.join('\n')}\n${fallbackSearchSpace}`
      : fallbackSearchSpace;
    if (doesRegularExpressionMatch(trigger.trigger, searchSpace, sensitivityMultiplier)) return true;
  }
  return false;
}

type ExclusionEvent = {
  order: number;
  subOrder: number;
  type: 'activation' | 'deactivation';
};

export function getLatestExclusionEvent(
  triggers: RegularExpressionTrigger[] | undefined,
  type: 'activation' | 'deactivation',
  characterIdArray: string[],
  textContentArray: string[],
  selectedCharacterId: string,
  protagonistIds: string[],
  fallbackSearchSpace: string,
  sensitivityMultiplier?: number,
): ExclusionEvent | null {
  let latest: ExclusionEvent | null = null;
  const consider = (order: number, subOrder: number): void => {
    if (
      !latest ||
      order > latest.order ||
      (order === latest.order && subOrder > latest.subOrder)
    ) {
      latest = { order, subOrder, type };
    }
  };
  for (const trigger of triggers ?? []) {
    if (!trigger.trigger) continue;
    const indices = getFilteredIndices(
      characterIdArray,
      selectedCharacterId,
      trigger.context || 'global',
      trigger.target || 'everyone',
      protagonistIds,
    );
    for (const idx of indices) {
      const text = textContentArray[idx] ?? '';
      if (doesRegularExpressionMatch(trigger.trigger, text, sensitivityMultiplier)) {
        consider(idx, 0);
      }
    }
    if (fallbackSearchSpace && doesRegularExpressionMatch(trigger.trigger, fallbackSearchSpace, sensitivityMultiplier)) {
      let subOrder = 0;
      try {
        const regex = new RegExp(trigger.trigger);
        const index = fallbackSearchSpace.search(regex);
        if (index !== -1) subOrder = index;
      } catch {
        // ignore
      }
      consider(characterIdArray.length, subOrder);
    }
  }
  return latest;
}

export function isExclusionActiveOrdered(
  exclusionActivationTriggers: RegularExpressionTrigger[] | undefined,
  exclusionDeactivationTriggers: RegularExpressionTrigger[] | undefined,
  characterIdArray: string[],
  textContentArray: string[],
  selectedCharacterId: string,
  protagonistIds: string[],
  fallbackSearchSpace: string,
  sensitivityMultiplier?: number,
): boolean {
  if (!exclusionActivationTriggers || exclusionActivationTriggers.length === 0) {
    return false;
  }
  const latestActivation = getLatestExclusionEvent(
    exclusionActivationTriggers,
    'activation',
    characterIdArray,
    textContentArray,
    selectedCharacterId,
    protagonistIds,
    fallbackSearchSpace,
    sensitivityMultiplier,
  );
  if (!latestActivation) return false;
  const latestDeactivation = getLatestExclusionEvent(
    exclusionDeactivationTriggers,
    'deactivation',
    characterIdArray,
    textContentArray,
    selectedCharacterId,
    protagonistIds,
    fallbackSearchSpace,
    sensitivityMultiplier,
  );
  if (!latestDeactivation) return true;
  if (latestDeactivation.order > latestActivation.order) return false;
  if (latestActivation.order > latestDeactivation.order) return true;
  return false;
}

export function isEntityActiveWithCache(
  activationTriggers: RegularExpressionTrigger[] | undefined,
  deactivationTriggers: RegularExpressionTrigger[] | undefined,
  exclusionActivationTriggers: RegularExpressionTrigger[] | undefined,
  exclusionDeactivationTriggers: RegularExpressionTrigger[] | undefined,
  characterIdArray: string[],
  textContentArray: string[],
  selectedCharacterId: string,
  protagonistIds: string[],
  fallbackSearchSpace: string,
  combinationCache: CombinationCache,
  sensitivityMultiplier?: number,
): boolean {
  const hasActivationTriggers = !!activationTriggers && activationTriggers.length > 0;
  if (hasActivationTriggers) {
    if (!doesAnyTriggerMatchCached(
      activationTriggers,
      characterIdArray,
      textContentArray,
      selectedCharacterId,
      protagonistIds,
      fallbackSearchSpace,
      combinationCache,
      sensitivityMultiplier,
    )) {
      return false;
    }
  }
  if (doesAnyTriggerMatchCached(
    deactivationTriggers,
    characterIdArray,
    textContentArray,
    selectedCharacterId,
    protagonistIds,
    fallbackSearchSpace,
    combinationCache,
  )) {
    return false;
  }
  if (isExclusionActiveOrdered(
    exclusionActivationTriggers,
    exclusionDeactivationTriggers,
    characterIdArray,
    textContentArray,
    selectedCharacterId,
    protagonistIds,
    fallbackSearchSpace,
    sensitivityMultiplier,
  )) {
    return false;
  }
  return true;
}