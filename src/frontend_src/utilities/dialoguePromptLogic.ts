// src/frontend_src/utilities/dialoguePromptLogic.ts
import type { DialoguePrompt, RetrievalConfiguration } from '../types';
import { isEntityActiveWithCache, type TriggerEvaluationContext } from './triggerLogic';
import { embeddingEngine } from '../services/EmbeddingEngine';
import { retrieveRelevantContext, type RetrievableItem } from '../services/RetrievalEngine';

export function buildDialogueSearchSpace(textContentArray: string[]): string {
  return textContentArray.join('\n');
}

/**
 * Evaluates whether a dialogue prompt is active using the full context and trigger cache.
 */
export function isDialoguePromptActive(
  dp: DialoguePrompt,
  evalContext: TriggerEvaluationContext,
): boolean {
  return isEntityActiveWithCache(
    dp.regularExpressionActivationTriggers,
    dp.regularExpressionDeactivationTriggers,
    dp.regularExpressionExclusionActivationTriggers,
    dp.regularExpressionExclusionDeactivationTriggers,
    evalContext.characterIdArray,
    evalContext.textContentArray,
    evalContext.selectedCharacterId,
    evalContext.protagonistIds,
    evalContext.fallbackSearchSpace ?? evalContext.textContentArray.join('\n'),
    evalContext.combinationCache ?? {},
    evalContext.sensitivityMultiplier,
  );
}

/**
 * Returns all active dialogue prompts that pass their activation/exclusion triggers.
 */
export function getActiveDialoguePrompts(
  dialoguePrompts: DialoguePrompt[] | undefined,
  evalContext: TriggerEvaluationContext,
): DialoguePrompt[] {
  if (!dialoguePrompts || dialoguePrompts.length === 0) return [];
  return dialoguePrompts.filter(dp => isDialoguePromptActive(dp, evalContext));
}

export interface DialogueCollectionOptions {
  useEmbedding?: boolean;
  retrievalConfiguration?: RetrievalConfiguration;
  queryText?: string;
}

/**
 * Selects an initial root node (via RAG or weighted roll) and traverses its
 * dialoguePromptBindings chain to generate the final dialogue sequence.
 */
export async function collectActiveDialoguePromptContent(
  dialoguePrompts: DialoguePrompt[] | undefined,
  evalContext: TriggerEvaluationContext,
  options?: DialogueCollectionOptions,
): Promise<string[]> {
  if (!dialoguePrompts || dialoguePrompts.length === 0) return [];

  // Filter all prompts that pass activation triggers
  const activePrompts = getActiveDialoguePrompts(dialoguePrompts, evalContext);
  if (activePrompts.length === 0) return [];

  const promptMap = new Map<string, DialoguePrompt>();
  for (const dp of dialoguePrompts) {
    promptMap.set(dp.id, dp);
  }

  // Set of actively triggered prompts for Option B verification during chaining
  const activeIdSet = new Set<string>(activePrompts.map(dp => dp.id));

  let startNode: DialoguePrompt | undefined;

  // ─── 1. Determine Starting Node ────────────────────────────────────
  if (options?.useEmbedding && options.retrievalConfiguration && options.queryText) {
    const queryVector = await embeddingEngine.embed(options.queryText);
    if (queryVector) {
      const items: RetrievableItem[] = activePrompts.map(dp => ({
        id: dp.id,
        name: dp.name,
        textContent: dp.textContent,
        embedding: dp.embedding,
        firstCreatedTimestamp: dp.firstCreatedTimestamp,
      }));

      const results = await retrieveRelevantContext(
        queryVector,
        options.queryText,
        items,
        options.retrievalConfiguration,
      );

      if (results.length > 0) {
        startNode = promptMap.get(results[0].id);
      }
    }
  }

  // Fallback to weighted start pool if embeddings are disabled or returned no match
  if (!startNode) {
    const startPool: { prompt: DialoguePrompt; weight: number }[] = [];
    let totalStartWeight = 0;

    for (const dp of activePrompts) {
      const w = dp.weight > 0 ? dp.weight : 1;
      startPool.push({ prompt: dp, weight: w });
      totalStartWeight += w;
    }

    if (startPool.length === 0 || totalStartWeight <= 0) return [];

    let roll = Math.random() * totalStartWeight;
    for (const entry of startPool) {
      roll -= entry.weight;
      if (roll <= 0) {
        startNode = entry.prompt;
        break;
      }
    }
    if (!startNode) {
      startNode = startPool[startPool.length - 1].prompt;
    }
  }

  if (!startNode) return [];

  // ─── 2. Graph Traversal (Chaining) ─────────────────────────────────
  const collectedContents: string[] = [];
  let currentNode: DialoguePrompt | undefined = startNode;

  while (currentNode) {
    const skipProb = currentNode.skipProbability ?? 0;
    const isSkipped = skipProb > 0 && Math.random() < skipProb;

    if (!isSkipped && currentNode.textContent) {
      collectedContents.push(currentNode.textContent);
    }

    const breakProb = currentNode.breakProbability ?? 0;
    if (breakProb > 0 && Math.random() < breakProb) {
      break;
    }

    const bindings = currentNode.dialoguePromptBindings;
    if (!bindings || bindings.length === 0) {
      break;
    }

    // Option B: A candidate target node MUST also independently be active
    const nextPool: { prompt: DialoguePrompt; weight: number }[] = [];
    let totalNextWeight = 0;

    for (const bindId of bindings) {
      if (!activeIdSet.has(bindId)) continue;

      const nextPrompt = promptMap.get(bindId);
      if (!nextPrompt) continue;

      const w = nextPrompt.weight > 0 ? nextPrompt.weight : 1;
      nextPool.push({ prompt: nextPrompt, weight: w });
      totalNextWeight += w;
    }

    if (nextPool.length === 0 || totalNextWeight <= 0) {
      break;
    }

    let nextRoll = Math.random() * totalNextWeight;
    let nextNode: DialoguePrompt | undefined;

    for (const entry of nextPool) {
      nextRoll -= entry.weight;
      if (nextRoll <= 0) {
        nextNode = entry.prompt;
        break;
      }
    }

    if (!nextNode) {
      nextNode = nextPool[nextPool.length - 1].prompt;
    }

    currentNode = nextNode;
  }

  return collectedContents;
}