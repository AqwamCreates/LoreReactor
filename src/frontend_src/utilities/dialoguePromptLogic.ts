import type { DialoguePrompt, RetrievalConfiguration } from '../types';
import { isEntityActiveWithCache, type TriggerEvaluationContext } from './triggerLogic';
import { embeddingEngine } from '../services/EmbeddingEngine';
import { retrieveRelevantContext, type RetrievableItem } from '../services/RetrievalEngine';
import { traverseStochasticGraph, type StochasticGraphNode } from './graphLogic';

export function buildDialogueSearchSpace(textContentArray: string[]): string {
    return textContentArray.join('\n');
}

export function isDialoguePromptActive(dp: DialoguePrompt, evalContext: TriggerEvaluationContext): boolean {
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
 * Traverses dialogue prompt sequences using universal stochastic graph traversal.
 */
export async function collectActiveDialoguePromptContent(
    dialoguePrompts: DialoguePrompt[] | undefined,
    evalContext: TriggerEvaluationContext,
    options?: DialogueCollectionOptions,
): Promise<string[]> {
    if (!dialoguePrompts || dialoguePrompts.length === 0) return [];

    const activePrompts = getActiveDialoguePrompts(dialoguePrompts, evalContext);
    if (activePrompts.length === 0) return [];

    let startNodeId: string | undefined;

    // Optional RAG root resolution
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
            const results = await retrieveRelevantContext(queryVector, options.queryText, items, options.retrievalConfiguration);
            if (results.length > 0) startNodeId = results[0].id;
        }
    }

    const activeIdSet = new Set<string>(activePrompts.map(dp => dp.id));

    const nodes: StochasticGraphNode<string>[] = dialoguePrompts.map(dp => ({
        id: dp.id,
        weight: dp.weight > 0 ? dp.weight : 1,
        skipProbability: dp.skipProbability ?? 0,
        breakProbability: dp.breakProbability ?? 0,
        bindings: dp.dialoguePromptBindings,
        payload: dp.textContent,
    }));

    return traverseStochasticGraph(
        nodes,
        startNodeId,
        (targetId) => activeIdSet.has(targetId)
    );
}