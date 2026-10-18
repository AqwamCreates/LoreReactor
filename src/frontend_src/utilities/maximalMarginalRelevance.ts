// src/frontend_src/utilities/mmr.ts
import { normalizedDotProduct } from './vectorMath';

/**
 * Maximal Marginal Relevance (MMR)
 * Balances relevance to the query with diversity among selected results.
 * 
 * @param queryVector - The embedded user prompt / recent chat context
 * @param candidateVectors - Array of embeddings for the lore/memories
 * @param lambda - Diversity parameter (0.0 = max diversity, 1.0 = pure relevance). 0.7 is ideal for lore.
 * @param topK - Maximum number of items to select
 * @returns Array of indices corresponding to the selected candidates
 */
export function maximalMarginalRelevance(
    queryVector: number[],
    candidateVectors: number[][],
    lambda: number = 0.7, 
    topK: number = 5
): number[] {
    const selectedIndices: number[] = [];
    const remainingIndices = new Set(candidateVectors.map((_, i) => i));

    while (selectedIndices.length < topK && remainingIndices.size > 0) {
        let bestMmrScore = -Infinity;
        let bestIndex = -1;

        for (const i of remainingIndices) {
            // 1. Relevance to the query
            const relevance = normalizedDotProduct(queryVector, candidateVectors[i]);
            
            // 2. Max similarity to already selected documents (Penalty for redundancy)
            let maxSimToSelected = 0;
            if (selectedIndices.length > 0) {
                for (const j of selectedIndices) {
                    const sim = normalizedDotProduct(candidateVectors[i], candidateVectors[j]);
                    if (sim > maxSimToSelected) maxSimToSelected = sim;
                }
            }

            // 3. MMR Formula
            const mmrScore = (lambda * relevance) - ((1 - lambda) * maxSimToSelected);

            if (mmrScore > bestMmrScore) {
                bestMmrScore = mmrScore;
                bestIndex = i;
            }
        }

        if (bestIndex !== -1) {
            selectedIndices.push(bestIndex);
            remainingIndices.delete(bestIndex);
        } else {
            break;
        }
    }

    return selectedIndices;
}