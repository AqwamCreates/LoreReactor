// src/frontend_src/services/RetrievalEngine.ts
import type { RetrievalConfiguration } from '../types';
import { normalizedDotProduct, computeBestMatch25Scores, reciprocalRankFusion } from '../utilities/vectorMath';
import { maximalMarginalRelevance } from '../utilities/maximalMarginalRelevance';
import { getLanguageModelEngine } from './LanguageModelEngine';

export interface RetrievableItem {
    id: string;
    textContent: string;
    embedding?: number[];
    firstCreatedTimestamp?: number;
    name?: string;
}

/**
 * The On-Demand RAG Orchestrator.
 * Called ONLY during manual tool execution (knowledge/dialogue/memory recall) or Starter Prompt selection.
 */
export async function retrieveRelevantContext(
    queryVector: number[] | null,
    queryText: string,
    items: RetrievableItem[],
    config: RetrievalConfiguration | undefined
): Promise<RetrievableItem[]> {
    if (!config || items.length === 0) return [];
    
    const validItems = items.filter(item => item.textContent);
    if (validItems.length === 0) return [];

    const texts = validItems.map(i => i.textContent);
    
    // 1. Calculate Sparse (BM25) Scores
    const sparseScores = computeBestMatch25Scores(queryText, texts);
    
    // 2. Calculate Dense (Vector) Scores
    const denseScores = new Array(validItems.length).fill(0);
    let hasDense = false;
    
    if (queryVector) {
        for (let i = 0; i < validItems.length; i++) {
            const emb = validItems[i].embedding;
            if (emb && emb.length === queryVector.length) {
                denseScores[i] = normalizedDotProduct(queryVector, emb);
                hasDense = true;
            }
        }
    }

    // 3. Apply Strategy & Fuse
    let finalScores: number[];
    
    if (config.retrievalStrategy === 'sparse') {
        finalScores = sparseScores;
    } else if (config.retrievalStrategy === 'dense' || !hasDense) {
        finalScores = denseScores;
    } else if (config.retrievalStrategy === 'hybrid') {
        finalScores = reciprocalRankFusion(denseScores, sparseScores);
    } else {
        finalScores = reciprocalRankFusion(denseScores, sparseScores);
    }

    // 4. Filter by Threshold & Get Top K candidates
    let scoredItems = validItems.map((item, i) => ({ item, score: finalScores[i] }))
        .filter(s => config.retrievalStrategy === 'sparse' ? s.score > 0 : s.score >= config.similarityThreshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, config.topK * 2); // Grab 2x TopK to feed into MMR/Sorting

    if (scoredItems.length === 0) return [];

    // 5. Apply MMR (If requested)
    if (config.retrievalStrategy === 'maximal marginal relevance' && hasDense && queryVector) {
        const candidateVectors = scoredItems.map(s => s.item.embedding!);
        const mmrIndices = maximalMarginalRelevance(queryVector, candidateVectors, 0.7, config.topK);
        scoredItems = mmrIndices.map(i => scoredItems[i]);
    } else {
        scoredItems = scoredItems.slice(0, config.topK);
    }

    const topItems = scoredItems.map(s => ({ ...s.item, score: s.score }));

    // 6. Apply Sort Order (Defaulting to 'lowest' to combat "Lost in the Middle")
    const sortOrder = config.sortOrderFromTop || 'lowest';
    if (sortOrder === 'lowest') topItems.sort((a, b) => (a.score || 0) - (b.score || 0));
    else if (sortOrder === 'highest') topItems.sort((a, b) => (b.score || 0) - (a.score || 0));
    else if (sortOrder === 'chronological') topItems.sort((a, b) => (a.firstCreatedTimestamp || 0) - (b.firstCreatedTimestamp || 0));
    else if (sortOrder === 'reverse_chronological') topItems.sort((a, b) => (b.firstCreatedTimestamp || 0) - (a.firstCreatedTimestamp || 0));

    // 7. Token Budget Truncation
    if (config.tokenBudget > 0) {
        const engine = getLanguageModelEngine();
        const finalItems: RetrievableItem[] = [];
        let currentTokenCount = 0;

        for (const item of topItems) {
            const estimatedTokens = Math.ceil(item.textContent.length / 4);
            if (currentTokenCount + estimatedTokens > config.tokenBudget) {
                const exactTokens = await engine.countTokens(item.textContent);
                if (currentTokenCount + exactTokens > config.tokenBudget) break;
                currentTokenCount += exactTokens;
            } else {
                currentTokenCount += estimatedTokens;
            }
            finalItems.push(item);
        }
        return finalItems;
    }

    return topItems;
}